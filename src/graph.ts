import { App, Notice, TFile, TFolder, View, normalizePath } from "obsidian";
import type FolderHubPlugin from "./main";
import { DIRECTIONS, LayoutOptions, Point, TreeNode, layoutSkillTree } from "./skilltree";
import { Circle, centroid, separateCircles } from "./module-shapes";
import { Bubble, bubbleRadius, spiralSpot, stepBubbles } from "./module-sim";

// ---------------------------------------------------------------------------
// Undocumented Obsidian internals (graph view). Everything is feature-checked
// and wrapped so that an Obsidian update can only disable the effect, never
// break the vault. Node pinning uses the same `forceNode` worker message that
// Obsidian itself sends while you drag a node.
// ---------------------------------------------------------------------------

/** Bubble physics state of one graph. */
interface SimState {
	bubbles: Bubble[];
	key: string;
	last: number;
	t0: number;
	/** Last position posted for each note (to skip tiny updates). */
	posted: Map<string, Point>;
	/** How long everything has been still (ms). */
	still: number;
}

interface GraphRenderer {
	dragNode?: { id: string } | null;
	nodes?: { id: string; x: number; y: number }[];
	links?: { source: { id?: string; x: number; y: number }; target: { id?: string; x: number; y: number } }[];
	nodeLookup?: Record<string, unknown>;
	worker?: Worker;
	setData?: (data: unknown) => void;
	setForces?: (forces: Record<string, number>) => void;
	changed?: () => void;
}

interface GraphLeafView extends View {
	renderer?: GraphRenderer;
	dataEngine?: { getOptions?: () => Record<string, unknown> };
}

type AppWithInternals = App & {
	internalPlugins?: {
		getPluginById?: (id: string) => { instance?: { options?: Record<string, unknown> } } | null;
	};
};

interface ColorGroup {
	query: string;
	color: { a: number; rgb: number };
}

const hexToRgb = (hex: string): number => {
	const h = hex.replace("#", "");
	const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
	return parseInt(full, 16) || 0;
};


/** A note kept in place by a module: inside it (member) or outside it (outsider). */
interface Held {
	mod: string;
	inside: boolean;
	dx: number;
	dy: number;
	x: number;
	y: number;
}

export class GraphTree {
	private originals = new Map<GraphRenderer, (data: unknown) => void>();
	private views = new Map<GraphRenderer, GraphLeafView>();
	private pinned = new Map<GraphRenderer, Set<string>>();
	private timers = new Map<GraphRenderer, number>();
	private refreshTimer: number | null = null;
	/** Renderers that already played the "grow" animation. */
	private grown = new WeakSet<GraphRenderer>();
	private growing = new Map<GraphRenderer, number>();
	private frozen = new Map<GraphRenderer, Set<string>>();
	private freezeTimers = new Map<GraphRenderer, number>();
	private depthCache: { hubs: Map<string, number>; all: Map<string, number> } | null = null;
	private posCache: Map<string, Point> | null = null;
	/** Pin targets including module placement; rebuilt when modules or the base layout change. */
	private modLayout: { key: string; base: Map<string, Point>; target: Map<string, Point> } | null = null;
	private holdTimer: number | null = null;
	/** Per graph: notes clamped on the last tick (released on the next one). */
	private holdRelease = new Map<GraphRenderer, Set<string>>();
	/** How often each note had to be pulled back; repeat offenders widen the barrier instead. */
	private holdStrikes = new Map<string, number>();
	private holdStrikesReset = 0;
	/** Notes kept in place by their module (offset from the module centre), per graph. */
	private held = new Map<GraphRenderer, Map<string, Held>>();
	private lastNudge = new Map<GraphRenderer, number>();
	/** Physics nudges left in this "episode"; when none are left, stubborn notes rest against the wall. */
	private nudgeBudget = new Map<GraphRenderer, number>();
	/** Notes resting against a barrier (pinned until the layout changes). */
	private resting = new Map<GraphRenderer, Set<string>>();
	private lastNodeCount = new Map<GraphRenderer, number>();
	/** Target positions last sent to each graph, to skip no-op updates. */
	private sent = new Map<GraphRenderer, Map<string, Point>>();
	/** Graphs currently being sorted (button mode): pins and walls are active only then. */
	private sorting = new Map<GraphRenderer, number>();
	/** Anchors kept pinned after a sort (one per module), so modules don't drift back together. */
	private kept = new Map<GraphRenderer, Map<string, Point>>();
	/** Anchor of each module from the last layout (module id → node id). */
	private moduleAnchors = new Map<string, string>();
	/** "Sort graph" buttons added to graph view headers. */
	private actions = new Map<GraphRenderer, HTMLElement>();

	constructor(private plugin: FolderHubPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	start() {
		const p = this.plugin;
		p.registerEvent(this.app.workspace.on("layout-change", () => this.scan()));
		const onTreeChange = (f: unknown) => {
			if (f instanceof TFolder || (f instanceof TFile && f.extension === "md")) {
				this.depthCache = null;
				this.posCache = null;
				this.refreshSoon();
			}
		};
		p.registerEvent(this.app.vault.on("create", onTreeChange));
		p.registerEvent(this.app.vault.on("delete", onTreeChange));
		p.registerEvent(this.app.vault.on("rename", onTreeChange));
		this.scan();
		// Bring graph colour groups in line with the settings (module colours,
		// leftovers from older versions).
		void this.syncColorGroups(false, false);
		// Modules: keep member notes inside their barrier.
		this.holdTimer = window.setInterval(() => this.holdTick(), 150);
		// Module bubbles: their own little physics, ~20 updates a second.
		this.plugin.registerInterval(window.setInterval(() => this.simTick(), 50));
		this.plugin.registerInterval(this.holdTimer);
	}

	stop() {
		if (this.holdTimer !== null) window.clearInterval(this.holdTimer);
		for (const [r, ids] of this.holdRelease) for (const id of ids) this.unpin(r, id);
		this.holdRelease.clear();
		for (const r of this.held.keys()) this.releaseHeld(r);
		for (const r of this.resting.keys()) this.releaseResting(r);
		for (const r of this.simPinned.keys()) this.releaseSim(r);
		this.growing.forEach((id) => window.cancelAnimationFrame(id));
		this.freezeTimers.forEach((t) => window.clearTimeout(t));
		for (const r of [...this.originals.keys()]) {
			this.unfreeze(r);
			this.unpinAll(r);
			const orig = this.originals.get(r);
			if (orig) r.setData = orig;
		}
		this.originals.clear();
		this.views.clear();
		this.actions.forEach((el) => el.remove());
		this.actions.clear();
		this.sorting.forEach((t) => window.clearTimeout(t));
		this.sorting.clear();
		this.timers.forEach((t) => window.clearTimeout(t));
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
	}

	/** Re-applies the layout to every open global graph. */
	refresh() {
		this.depthCache = null;
		this.posCache = null;
		this.modLayout = null;
		// Settings or modules changed: anchors from the last sort may be stale.
		this.kept.clear();
		this.scan();
		for (const r of this.originals.keys()) this.schedule(r);
	}

	private refreshSoon() {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 1200);
	}

	/** Finds open graph views and hooks their renderer. */
	private scan() {
		const alive = new Set<GraphRenderer>();
		for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
			const view = leaf.view as GraphLeafView;
			const r = view.renderer;
			if (!r || typeof r.setData !== "function" || !r.worker) continue;
			alive.add(r);
			if (!this.originals.has(r)) {
				const orig = r.setData;
				this.originals.set(r, orig);
				this.views.set(r, view);
				// Graph data is reloaded on every vault/filter change; re-pin afterwards.
				r.setData = (data: unknown) => {
					orig.call(r, data);
					this.schedule(r);
				};
				// A "sort" button in the graph's header (on phones: the tab's ⋮ menu).
				try {
					const btn = (view as unknown as { addAction?: (icon: string, title: string, cb: () => void) => HTMLElement }).addAction?.(
						"sparkles",
						"Упорядочить граф (ObsOrg)",
						() => this.sortGraph(),
					);
					if (btn) this.actions.set(r, btn);
				} catch {
					/* ignore */
				}
				this.schedule(r);
			}
		}
		// Forget renderers of closed graph tabs.
		for (const r of [...this.originals.keys()]) {
			if (alive.has(r)) continue;
			this.actions.get(r)?.remove();
			this.actions.delete(r);
			const t = this.sorting.get(r);
			if (t !== undefined) window.clearTimeout(t);
			this.sorting.delete(r);
			this.originals.delete(r);
			this.views.delete(r);
			this.pinned.delete(r);
			this.sent.delete(r);
		}
	}

	private schedule(r: GraphRenderer, tries = 0, delay = 120) {
		const t = this.timers.get(r);
		if (t !== undefined) window.clearTimeout(t);
		this.timers.set(
			r,
			window.setTimeout(() => {
				this.timers.delete(r);
				this.apply(r, tries);
			}, delay),
		);
	}

	private messagesSent = 0;
	private lastApply = { at: 0, note: "ещё не было" };

	private post(r: GraphRenderer, msg: unknown) {
		try {
			this.messagesSent++;
			r.worker?.postMessage(msg);
		} catch (e) {
			console.warn("ObsOrg: graph worker message failed", e);
		}
	}

	/**
	 * Pins a node (x/y = null unpins). Same message shape the graph uses while
	 * dragging and that working plugins use: the wake-up (alpha/alphaTarget/run)
	 * travels in the SAME message as forceNode — a pin sent on its own may not
	 * take effect on a graph that has already come to rest. fx/fy are also set
	 * on the UI-side node object.
	 */
	private pin(r: GraphRenderer, id: string, x: number | null, y: number | null, wake = 0) {
		const msg: Record<string, unknown> = { forceNode: { id, x, y } };
		if (wake > 0) {
			msg.alpha = wake;
			msg.alphaTarget = 0;
			msg.run = true;
		}
		this.post(r, msg);
		const n = (r.nodeLookup?.[id] ?? r.nodes?.find((m) => m.id === id)) as { fx?: number | null; fy?: number | null } | undefined;
		if (n && typeof n === "object") {
			n.fx = x;
			n.fy = y;
		}
	}

	private unpin(r: GraphRenderer, id: string, wake = 0) {
		this.pin(r, id, null, null, wake);
	}

	private hasNode(r: GraphRenderer, id: string): boolean {
		if (r.nodeLookup) return id in r.nodeLookup;
		return !!r.nodes?.some((n) => n.id === id);
	}

	private apply(r: GraphRenderer, tries: number) {
		if (!r.nodes || r.nodes.length === 0) {
			// The graph is still loading its data.
			this.lastApply = { at: performance.now(), note: "граф ещё загружает данные" };
			if (tries < 20) this.schedule(r, tries + 1, 250);
			return;
		}
		const s = this.plugin.settings;
		const prev = this.pinned.get(r) ?? new Set<string>();
		// "By button" mode: the graph floats freely; the layout is applied only
		// while a sort (started by the button) is running.
		const buttonMode = s.layoutMode === "button";
		const active = !buttonMode || this.sorting.has(r);
		const base = active && s.skillTreeEnabled ? this.positions() : new Map<string, Point>();
		let target: Map<string, Point>;
		if (this.bubblesOn()) {
			// Module notes are driven by the bubbles; the layout keeps the rest.
			const members = this.plugin.modules.members();
			target = new Map([...base].filter(([id]) => ![...members.values()].some((set) => set.has(id))));
		} else {
			target = active ? this.withModules(r, base) : new Map(this.kept.get(r) ?? []);
		}

		// First time this graph shows the tree: let it grow out of the centre.
		const reduced = this.plugin.motionReduced();
		if (!buttonMode && target.size && !this.grown.has(r) && s.graphGrow && s.animations && !reduced) {
			this.grown.add(r);
			this.animateGrow(r, target);
			return;
		}
		this.grown.add(r);
		if (this.growing.has(r)) return; // the running animation will finish the job

		// Obsidian reloads graph data on every save. Pins are re-sent (cheap and
		// safe if the worker dropped them), but the physics is only woken up
		// when something actually moved — otherwise the graph would keep
		// re-simulating while you type.
		const last = this.sent.get(r) ?? new Map<string, Point>();
		const now = new Set<string>();
		let moved = false;
		for (const [id, p] of target) {
			if (!this.hasNode(r, id)) continue;
			now.add(id);
			const q = last.get(id);
			if (!q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5) moved = true;
		}
		for (const id of prev) {
			if (!now.has(id)) {
				this.unpin(r, id, 0.3);
				moved = true;
			}
		}
		this.pinned.set(r, now);
		this.lastApply = { at: performance.now(), note: `закреплено ${now.size}, ${moved ? "раскладка изменилась" : "без изменений"}` };
		// A new "episode" for solid barriers only when the picture really changed
		// (not on every autosave while typing).
		if (moved || this.lastNodeCount.get(r) !== r.nodes.length) {
			this.lastNodeCount.set(r, r.nodes.length);
			this.releaseResting(r);
			this.nudgeBudget.set(r, 4);
			this.slimeBudget = 12;
		}
		// Modules bumping into each other: glide to the new places with a little
		// springy overshoot instead of teleporting.
		if (moved && last.size && s.animations && !reduced) {
			this.animatePins(r, last, target, now);
			return;
		}
		for (const id of now) {
			const p = target.get(id)!;
			const q = last.get(id);
			const changed = !q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5;
			// Re-sent pins that didn't change don't wake the physics (no jiggling while typing).
			this.pin(r, id, p.x, p.y, changed ? 0.3 : 0);
		}
		this.sent.set(r, new Map([...now].map((id) => [id, target.get(id)!])));
		if (moved) {
			this.reheat(r);
			this.scheduleFreeze(r);
		} else if (this.plugin.settings.graphFreeze && !this.frozen.has(r)) {
			this.scheduleFreeze(r);
		}
	}

	/** Moves pinned nodes from their old to their new places over ~0.6 s (ease-out-back). */
	private animatePins(r: GraphRenderer, from: Map<string, Point>, to: Map<string, Point>, ids: Set<string>) {
		const list = [...ids].map((id) => ({ id, a: from.get(id) ?? to.get(id)!, b: to.get(id)! }));
		const DUR = 600;
		const t0 = performance.now();
		const back = (k: number) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
		this.reheat(r);
		const step = (now: number) => {
			const k = Math.min(1, (now - t0) / DUR);
			const e = back(k);
			for (const o of list) this.pin(r, o.id, o.a.x + (o.b.x - o.a.x) * e, o.a.y + (o.b.y - o.a.y) * e, 0.3);
			if (k < 1) {
				this.growing.set(r, window.requestAnimationFrame(step));
			} else {
				this.growing.delete(r);
				this.sent.set(r, new Map(list.map((o) => [o.id, o.b])));
				this.scheduleFreeze(r);
				this.schedule(r); // pick up anything that changed meanwhile
			}
		};
		this.growing.set(r, window.requestAnimationFrame(step));
	}

	/** Branch by branch, level by level: nodes glide from the centre to their places. */
	private animateGrow(r: GraphRenderer, target: Map<string, Point>) {
		const depth = this.depths().all;
		const ids = [...target.keys()].filter((id) => this.hasNode(r, id));
		const pinned = new Set(ids);
		for (const id of this.pinned.get(r) ?? []) {
			if (!pinned.has(id)) this.unpin(r, id, 0.3);
		}
		this.pinned.set(r, pinned);
		const DUR = 650;
		const STAGGER = 380;
		const t0 = performance.now();
		const ease = (k: number) => 1 - Math.pow(1 - k, 3);
		const step = (now: number) => {
			let done = true;
			for (const id of ids) {
				const p = target.get(id)!;
				const k = Math.min(1, Math.max(0, (now - t0 - ((depth.get(id) ?? 1) - 1) * STAGGER) / DUR));
				if (k < 1) done = false;
				const e = ease(k);
				this.pin(r, id, p.x * e, p.y * e, 0.3);
			}
			if (done) {
				this.growing.delete(r);
				this.sent.set(r, new Map(ids.map((id) => [id, target.get(id)!])));
				this.scheduleFreeze(r);
				this.schedule(r); // pick up anything that changed meanwhile
			} else {
				this.growing.set(r, window.requestAnimationFrame(step));
			}
		};
		this.reheat(r);
		this.growing.set(r, window.requestAnimationFrame(step));
	}

	/** "Frozen" graph: once nodes have settled, pin every node where it is. */
	private scheduleFreeze(r: GraphRenderer) {
		const t = this.freezeTimers.get(r);
		if (t !== undefined) window.clearTimeout(t);
		if (!this.plugin.settings.graphFreeze) {
			this.unfreeze(r);
			return;
		}
		this.freezeTimers.set(
			r,
			window.setTimeout(() => {
				this.freezeTimers.delete(r);
				const pins = this.pinned.get(r) ?? new Set<string>();
				const set = new Set<string>();
				for (const n of r.nodes ?? []) {
					if (pins.has(n.id) || typeof n.x !== "number") continue;
					this.pin(r, n.id, n.x, n.y);
					set.add(n.id);
				}
				this.frozen.set(r, set);
			}, 3000),
		);
	}

	private unfreeze(r: GraphRenderer) {
		const set = this.frozen.get(r);
		if (!set?.size) return;
		for (const id of set) this.unpin(r, id);
		this.frozen.delete(r);
		this.reheat(r);
	}

	private unpinAll(r: GraphRenderer) {
		const prev = this.pinned.get(r);
		if (!prev?.size) return;
		for (const id of prev) this.unpin(r, id);
		this.pinned.set(r, new Set());
		this.reheat(r);
	}

	/** Wakes the simulation up so nodes glide to their new places. */
	private reheat(r: GraphRenderer) {
		this.post(r, { alpha: 0.3, alphaTarget: 0, run: true });
		try {
			r.changed?.();
		} catch {
			/* ignore */
		}
	}

	// ------------------------------------------------------------- sorting

	/**
	 * "Sort graph" button: notes glide to their places (skill-tree branches,
	 * separated modules, members into their barrier, others out of it), the
	 * order is held for a few seconds while everything settles, then every note
	 * is let go and floats freely again (in "by button" mode).
	 */
	sortGraph() {
		this.scan();
		const s = this.plugin.settings;
		if (!this.originals.size) {
			new Notice("ObsOrg: откройте граф, чтобы упорядочить его.");
			return;
		}
		if (!s.skillTreeEnabled && !(s.modulesEnabled && s.moduleSeparate && this.plugin.modules.list.length)) {
			new Notice("ObsOrg: нечего упорядочивать — включите дерево прокачки или создайте модули.");
			return;
		}
		if (this.bubblesOn()) {
			// Bubbles: spread them out afresh and tidy their notes.
			for (const st of this.sim.values()) {
				const circles = st.bubbles.map((b) => ({ x: b.x, y: b.y, r: b.R, b }));
				separateCircles(circles, s.moduleGap);
				for (const c of circles) {
					c.b.homeX = c.x;
					c.b.homeY = c.y;
					c.b.notes.forEach((p, i) => {
						const spot = spiralSpot(i, c.b.notes.length, c.b.R);
						p.vx += (spot.x - p.rx) * 2;
						p.vy += (spot.y - p.ry) * 2;
					});
				}
				st.still = 0;
			}
			if (s.skillTreeEnabled) for (const r of this.originals.keys()) this.sortOne(r);
			new Notice("ObsOrg: модули разложены.");
			return;
		}
		for (const r of this.originals.keys()) this.sortOne(r);
	}

	private sortOne(r: GraphRenderer) {
		if (!r.nodes?.length) return;
		const s = this.plugin.settings;
		const prevTimer = this.sorting.get(r);
		if (prevTimer !== undefined) window.clearTimeout(prevTimer);
		// Fresh layout from where the notes are right now.
		this.posCache = null;
		this.modLayout = null;
		this.plugin.modules.centers.clear();
		this.sorting.set(r, -1);
		const base = s.skillTreeEnabled ? this.positions() : new Map<string, Point>();
		let target: Map<string, Point>;
		if (this.bubblesOn()) {
			const members = this.plugin.modules.members();
			target = new Map([...base].filter(([id]) => ![...members.values()].some((set) => set.has(id))));
		} else {
			target = this.withModules(r, base);
		}
		const ids = new Set([...target.keys()].filter((id) => this.hasNode(r, id)));
		const from = new Map<string, Point>();
		for (const n of r.nodes) if (ids.has(n.id) && Number.isFinite(n.x)) from.set(n.id, { x: n.x, y: n.y });
		this.pinned.set(r, ids);
		this.releaseResting(r);
		this.nudgeBudget.set(r, 4);
		this.slimeBudget = 12;
		this.wallHits.clear();
		this.lastNodeCount.set(r, r.nodes.length);
		if (s.animations && !this.plugin.motionReduced()) {
			this.animatePins(r, from, target, ids);
		} else {
			for (const id of ids) {
				const p = target.get(id)!;
				this.pin(r, id, p.x, p.y, 0.3);
			}
			this.sent.set(r, new Map([...ids].map((id) => [id, target.get(id)!])));
		}
		// Hold the order while it settles, then let go (button mode).
		if (s.layoutMode === "button") {
			this.sorting.set(r, window.setTimeout(() => this.finishSort(r), 600 + 3200));
		} else {
			this.sorting.delete(r);
		}
	}

	private finishSort(r: GraphRenderer) {
		this.sorting.delete(r);
		if (this.growing.has(r)) {
			window.cancelAnimationFrame(this.growing.get(r)!);
			this.growing.delete(r);
		}
		// Keep one anchor per module (its main file) so the physics can't pull the
		// modules back into one heap; everything else floats. Without modules, the
		// skill tree's top-level branch hubs keep the branches in their directions.
		const keep = new Map<string, Point>();
		if (this.plugin.settings.afterSort === "anchors") {
			const sent = this.sent.get(r) ?? new Map<string, Point>();
			const ids = new Set<string>(this.moduleAnchors.values());
			if (!ids.size && this.plugin.settings.skillTreeEnabled) {
				for (const [id, d] of this.hubDepths()) if (d === 1) ids.add(id);
			}
			for (const id of ids) {
				const p = sent.get(id);
				if (p) keep.set(id, p);
			}
		}
		const pinned = this.pinned.get(r) ?? new Set<string>();
		for (const id of pinned) if (!keep.has(id)) this.unpin(r, id);
		this.pinned.set(r, new Set(keep.keys()));
		this.kept.set(r, keep);
		this.sent.set(r, new Map(keep));
		this.releaseResting(r);
		const release = this.holdRelease.get(r);
		if (release) {
			for (const id of release) this.unpin(r, id);
			release.clear();
		}
		// Barriers now follow their notes wherever the physics takes them.
		this.plugin.modules.centers.clear();
		this.modLayout = null;
		this.post(r, { alpha: 0.1, alphaTarget: 0, run: true });
		try {
			r.changed?.();
		} catch {
			/* ignore */
		}
		new Notice(
			keep.size
				? `ObsOrg: граф упорядочен — заметки свободны, на месте держатся только ${keep.size} главных файлов модулей.`
				: "ObsOrg: граф упорядочен — заметки снова свободны.",
		);
	}

	// ------------------------------------------------------------- bubbles

	private sim = new Map<GraphRenderer, SimState>();
	/** Notes currently pinned by the bubble physics, per graph. */
	private simPinned = new Map<GraphRenderer, Set<string>>();

	bubblesOn(): boolean {
		const s = this.plugin.settings;
		return s.moduleBubbles && s.modulesEnabled && this.plugin.modules.list.length > 0;
	}

	/** A module's bubble (for drawing), if the bubble physics is running. */
	bubbleOf(moduleId: string): { x: number; y: number; R: number } | undefined {
		if (!this.bubblesOn()) return undefined;
		for (const st of this.sim.values()) {
			const b = st.bubbles.find((x) => x.id === moduleId);
			if (b) return b;
		}
		return undefined;
	}

	/** Builds (or rebuilds, keeping positions) the bubbles from the modules. */
	private buildSim(r: GraphRenderer, prev: SimState | undefined): SimState {
		const s = this.plugin.settings;
		const modules = this.plugin.modules;
		const members = modules.members();
		const nodes = r.nodes ?? [];
		const byId = new Map(nodes.map((n) => [n.id, n]));
		const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : 0);
		const bubbles: Bubble[] = [];
		const fresh: Bubble[] = [];
		for (const m of modules.list) {
			const ids = [...(members.get(m.id) ?? [])].filter((id) => byId.has(id));
			if (!ids.length) continue;
			const R = bubbleRadius(ids.length, modules.unit, s.moduleSize);
			const old = prev?.bubbles.find((b) => b.id === m.id);
			const pts = ids.map((id) => byId.get(id)!).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
			const cx = old?.x ?? median(pts.map((n) => n.x));
			const cy = old?.y ?? median(pts.map((n) => n.y));
			const oldNotes = new Map((old?.notes ?? []).map((p) => [p.id, p]));
			const notes = ids.map((id, i) => {
				const keep = oldNotes.get(id);
				if (keep) return keep;
				const n = byId.get(id)!;
				// Start where the note is now (clamped inside), or on a tidy spiral.
				let rx = Number.isFinite(n.x) ? n.x - cx : spiralSpot(i, ids.length, R).x;
				let ry = Number.isFinite(n.y) ? n.y - cy : spiralSpot(i, ids.length, R).y;
				const d = Math.hypot(rx, ry);
				if (d > R * 0.85) {
					rx = (rx / d) * R * 0.85;
					ry = (ry / d) * R * 0.85;
				}
				return { id, rx, ry, vx: 0, vy: 0, seed: (i * 2.399) % (Math.PI * 2) };
			});
			const idx = new Map(notes.map((p, i) => [p.id, i]));
			const links: [number, number][] = [];
			for (const l of r.links ?? []) {
				const i = l.source.id !== undefined ? idx.get(l.source.id) : undefined;
				const j = l.target.id !== undefined ? idx.get(l.target.id) : undefined;
				if (i !== undefined && j !== undefined && i !== j) links.push([i, j]);
			}
			const b: Bubble = old
				? { ...old, R, notes, links }
				: { id: m.id, x: cx, y: cy, vx: 0, vy: 0, R, homeX: cx, homeY: cy, notes, links };
			bubbles.push(b);
			if (!old) fresh.push(b);
		}
		// New bubbles start apart from the others.
		if (fresh.length) {
			const circles = bubbles.map((b) => ({ x: b.homeX, y: b.homeY, r: b.R, b }));
			separateCircles(circles, s.moduleGap);
			for (const c of circles) {
				c.b.homeX = c.x;
				c.b.homeY = c.y;
				if (fresh.includes(c.b)) {
					c.b.x = c.x;
					c.b.y = c.y;
				}
			}
		}
		return {
			bubbles,
			key: this.simKey(r),
			last: performance.now(),
			t0: prev?.t0 ?? performance.now(),
			posted: prev?.posted ?? new Map(),
			still: 0,
		};
	}

	private simKey(r: GraphRenderer): string {
		const s = this.plugin.settings;
		return [this.plugin.modules.version, r.nodes?.length ?? 0, s.moduleSize, s.moduleGap, Math.round(this.plugin.modules.unit)].join("|");
	}

	/** One step of the bubble physics for every graph, then move the notes there. */
	private simTick() {
		const s = this.plugin.settings;
		if (!this.bubblesOn()) {
			for (const r of [...this.simPinned.keys()]) this.releaseSim(r);
			this.sim.clear();
			return;
		}
		const now = performance.now();
		for (const r of this.originals.keys()) {
			if (!r.nodes?.length) continue;
			let st = this.sim.get(r);
			if (!st || st.key !== this.simKey(r)) {
				st = this.buildSim(r, st);
				this.sim.set(r, st);
			}
			const dt = (now - st.last) / 1000;
			st.last = now;
			const moved = stepBubbles(st.bubbles, dt, {
				unit: this.plugin.modules.unit,
				gap: s.moduleGap,
				float: s.animations ? s.moduleFloat : 0,
				t: (now - st.t0) / 1000,
			});
			st.still = moved < 0.05 ? st.still + dt * 1000 : 0;
			// Everything at rest: stop sending, so the graph can cool down.
			if (st.still > 1500) continue;

			const drag = r.dragNode?.id;
			const pinned = this.simPinned.get(r) ?? new Set<string>();
			const alive = new Set<string>();
			for (const b of st.bubbles) {
				for (const p of b.notes) {
					alive.add(p.id);
					if (p.id === drag) continue;
					const x = b.x + p.rx;
					const y = b.y + p.ry;
					const last = st.posted.get(p.id);
					// Only notes that moved visibly (saves thousands of messages a second).
					if (last && Math.abs(last.x - x) < 1.5 && Math.abs(last.y - y) < 1.5 && pinned.has(p.id)) continue;
					this.pin(r, p.id, x, y, 0.05);
					st.posted.set(p.id, { x, y });
					pinned.add(p.id);
				}
			}
			// Notes that left every module go back to the normal physics.
			for (const id of [...pinned]) {
				if (!alive.has(id)) {
					this.unpin(r, id, 0.1);
					pinned.delete(id);
					st.posted.delete(id);
				}
			}
			this.simPinned.set(r, pinned);
		}
	}

	private releaseSim(r: GraphRenderer) {
		const pinned = this.simPinned.get(r);
		if (!pinned?.size) return;
		for (const id of pinned) this.unpin(r, id, 0.1);
		pinned.clear();
	}

	// ------------------------------------------------------------- layout

	/** Folder tree of index notes; folders without an index are skipped through. */
	buildTree(): TreeNode[] {
		const build = (folder: TFolder): TreeNode[] => {
			const childNodes = folder.children
				.filter((c): c is TFolder => c instanceof TFolder && !this.plugin.isExcluded(c))
				.flatMap(build);
			const index = folder.isRoot() ? null : this.plugin.findIndex(folder);
			if (!index) return childNodes;
			const files = folder.children
				.filter((c): c is TFile => c instanceof TFile && c !== index)
				.map((f) => f.path);
			return [{ id: index.path, name: folder.name, children: childNodes, files }];
		};
		return build(this.app.vault.getRoot());
	}

	layoutOptions(): LayoutOptions {
		const s = this.plugin.settings;
		const directions: LayoutOptions["directions"] = {};
		for (const [name, key] of Object.entries(s.branchDirections)) {
			if (DIRECTIONS[key]) directions[name] = DIRECTIONS[key].deg;
		}
		return {
			style: s.skillTreeStyle,
			step: s.skillTreeStep,
			spreadDeg: s.skillTreeSpread,
			pinFiles: s.skillTreePinFiles,
			directions,
		};
	}

	/** Depth of every index note (1 = top-level branch) and of pinned files. */
	private depths(): { hubs: Map<string, number>; all: Map<string, number> } {
		if (this.depthCache) return this.depthCache;
		const hubs = new Map<string, number>();
		const all = new Map<string, number>();
		const walk = (n: TreeNode, d: number) => {
			hubs.set(n.id, d);
			all.set(n.id, d);
			for (const f of n.files) all.set(f, d + 0.5);
			n.children.forEach((c) => walk(c, d + 1));
		};
		this.buildTree().forEach((r) => walk(r, 1));
		this.depthCache = { hubs, all };
		return this.depthCache;
	}

	/** Index notes and their depth in the folder tree (used by graph effects). */
	hubDepths(): Map<string, number> {
		return this.depths().hubs;
	}

	positions(): Map<string, Point> {
		if (!this.posCache) this.posCache = layoutSkillTree(this.buildTree(), this.layoutOptions());
		return this.posCache;
	}

	/** Where a module's anchor (its pinned main file) currently is, if it has one. */
	anchorPosition(moduleId: string): Point | undefined {
		const aid = this.moduleAnchors.get(moduleId);
		if (!aid) return undefined;
		const buttonMode = this.plugin.settings.layoutMode === "button";
		for (const r of this.originals.keys()) {
			const p = (buttonMode ? this.kept.get(r) : this.sent.get(r))?.get(aid);
			if (p) return p;
		}
		return undefined;
	}

	/** Report for the diagnostics command: is the layout connected to the graph engine? */
	diagnose(): string[] {
		const s = this.plugin.settings;
		const leaves = this.app.workspace.getLeavesOfType("graph");
		const out = ["ObsOrg — раскладка графа (дерево, модули):"];
		out.push(`• Дерево прокачки: ${s.skillTreeEnabled ? "вкл" : "выкл"}; модули: ${s.modulesEnabled ? "показ" : "скрыты"}, отдельное место: ${s.moduleSeparate ? "да" : "нет"}, твёрдые барьеры: ${s.moduleSolid ? "да" : "нет"}`);
		out.push(`• Глобальных графов открыто: ${leaves.length}, подключено к движку: ${this.originals.size}`);
		for (const leaf of leaves) {
			const r = (leaf.view as GraphLeafView).renderer;
			if (!r) out.push("  ✗ у графа нет renderer");
			else if (typeof r.setData !== "function") out.push("  ✗ у renderer нет setData");
			else if (!r.worker) out.push("  ✗ у renderer нет worker (движок физики недоступен)");
			else out.push(`  ✓ узлов: ${r.nodes?.length ?? 0}, закреплено раскладкой: ${this.pinned.get(r)?.size ?? 0}, прижато к стенкам: ${this.resting.get(r)?.size ?? 0}`);
		}
		const members = this.plugin.modules.members();
		const placed = this.plugin.settings.modules.map((m) => {
			const c = this.plugin.modules.centers.get(m.id);
			return `${m.name}: ${members.get(m.id)?.size ?? 0} заметок, ${c ? `место ✓ (радиус ${Math.round(c.hold ?? 0)})` : "место не назначено"}`;
		});
		if (placed.length) out.push(`• Модули: ${placed.join("; ")}`);
		out.push(`• Команд движку: ${this.messagesSent}; последняя раскладка: ${this.lastApply.at ? `${Math.round((performance.now() - this.lastApply.at) / 1000)} с назад — ${this.lastApply.note}` : this.lastApply.note}`);
		return out;
	}

	// ------------------------------------------------------------- modules

	/**
	 * Gives every module its own place: module circles (barrier radius + padding)
	 * are pushed apart until they don't overlap (touching is fine), starting from
	 * where they are now so the layout only shifts as much as needed. A module
	 * whose notes are pinned by the skill tree moves as a whole (the branch keeps
	 * its shape); otherwise one anchor note (the folder's index note if it is in
	 * the module) is pinned at the module's place and holding keeps the rest around it.
	 */
	private withModules(r: GraphRenderer, base: Map<string, Point>): Map<string, Point> {
		const s = this.plugin.settings;
		const modules = this.plugin.modules;
		if (!s.moduleSeparate || !s.modulesEnabled || !modules.list.length || !r.nodes?.length) {
			modules.centers.clear();
			return base;
		}
		const members = modules.members();
		const nodeById = new Map(r.nodes.map((n) => [n.id, n]));
		const pad = this.plugin.modules.unit * 0.6 * s.moduleSize;
		// Graph scale: median link length (a sample is enough).
		const lens: number[] = [];
		const links = r.links ?? [];
		for (let i = 0; i < links.length && lens.length < 400; i += Math.max(1, Math.floor(links.length / 400))) {
			const l = links[i];
			const d = Math.hypot(l.source.x - l.target.x, l.source.y - l.target.y);
			if (Number.isFinite(d) && d > 0) lens.push(d);
		}
		if (lens.length >= 5) {
			lens.sort((a, b) => a - b);
			const u = lens[lens.length >> 1];
			// Follow slowly and only on real change, so the layout doesn't wobble.
			if (Math.abs(u - modules.unit) / modules.unit > 0.2) modules.unit = Math.max(10, u);
		}
		const pos = (id: string): Point => {
			const p = base.get(id) ?? nodeById.get(id)!;
			// Nodes that haven't been placed by the physics yet count as the centre.
			return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : { x: 0, y: 0 };
		};

		// Measure each module as it really is: an anchor (its index note) and
		// how far most of its notes sit from it. Sizes are bucketed in 25 %
		// steps so the layout is only redone when a cluster really grows/shrinks.
		const infos: { id: string; ids: string[]; anchor: string; baseC: Point | null; c0: Point; bucket: number }[] = [];
		for (const m of modules.list) {
			const ids = [...(members.get(m.id) ?? [])].filter((id) => nodeById.has(id));
			if (!ids.length) continue;
			const anchor =
				ids.find((id) => {
					const f = this.app.vault.getAbstractFileByPath(id);
					return f instanceof TFile && this.plugin.isIndexNote(f);
				}) ?? ids[0];
			const pinnedIds = ids.filter((id) => base.has(id));
			const baseC = pinnedIds.length ? centroid(pinnedIds.map((id) => base.get(id)!)) : null;
			// Start from where the module's notes actually are (their median), not
			// from wherever its main file happens to sit: the module then lands where
			// its notes are drawn anyway and is only shifted enough to clear others.
			const c0 = baseC ?? {
				x: ids.map((id) => pos(id).x).sort((a, b) => a - b)[ids.length >> 1],
				y: ids.map((id) => pos(id).y).sort((a, b) => a - b)[ids.length >> 1],
			};
			const dists = ids.map((id) => Math.hypot(pos(id).x - c0.x, pos(id).y - c0.y));
			let extent = modules.barrierRadius(ids.length, dists);
			// A skill-tree branch is pinned: the barrier must hold all of it.
			if (baseC) for (const id of pinnedIds) extent = Math.max(extent, Math.hypot(base.get(id)!.x - baseC.x, base.get(id)!.y - baseC.y) + 30);
			infos.push({ id: m.id, ids, anchor, baseC, c0, bucket: Math.ceil(Math.log(Math.max(20, extent)) / Math.log(1.25)) });
		}
		const key = [modules.version, s.moduleSize, s.moduleGap, nodeById.size, infos.map((i) => `${i.id}:${i.bucket}:${i.anchor}`).join(",")].join("|");
		if (this.modLayout && this.modLayout.key === key && this.modLayout.base === base) return this.modLayout.target;

		const circles: (Circle & { info: (typeof infos)[number] })[] = infos.map((info) => {
			const start = modules.centers.get(info.id) ?? info.c0;
			return { x: start.x, y: start.y, r: Math.pow(1.25, info.bucket) + pad, info };
		});
		separateCircles(circles, s.moduleGap);

		// Only anchors move: one pinned note per module (or the module's skill
		// branch as a whole). The rest of the module follows through its links
		// to the index note and keeps floating freely.
		const target = new Map(base);
		const alive = new Set<string>();
		this.moduleAnchors.clear();
		for (const c of circles) {
			const { info } = c;
			alive.add(info.id);
			this.moduleAnchors.set(info.id, info.anchor);
			modules.centers.set(info.id, { x: c.x, y: c.y, hold: c.r - pad });
			if (info.baseC) {
				const dx = c.x - info.baseC.x;
				const dy = c.y - info.baseC.y;
				for (const id of info.ids) {
					const p = base.get(id);
					if (p) target.set(id, { x: p.x + dx, y: p.y + dy });
				}
			} else {
				target.set(info.anchor, { x: c.x, y: c.y });
			}
		}
		for (const id of [...modules.centers.keys()]) if (!alive.has(id)) modules.centers.delete(id);
		this.modLayout = { key, base, target };
		return target;
	}

	/**
	 * Solid barriers. About 7 times a second: a member that left its module is
	 * put back on the inner edge, a note from elsewhere that got inside is put
	 * on the outer edge — pinned for one tick and released on the next, so it
	 * keeps floating (nothing stays frozen). The physics is nudged at most every
	 * 1.5 s and only while something is out of place, so the graph can settle.
	 */
	private holdTick() {
		const s = this.plugin.settings;
		const modules = this.plugin.modules;
		const now = performance.now();
		const median = (v: number[]) => {
			v.sort((p, q) => p - q);
			const mid = v.length >> 1;
			return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
		};
		for (const r of this.originals.keys()) {
			const release = this.holdRelease.get(r) ?? new Set<string>();
			const layoutPins = this.pinned.get(r);
			// Never let go of notes the layout pinned meanwhile (e.g. a module's anchor).
			for (const id of release) if (!layoutPins?.has(id)) this.unpin(r, id);
			release.clear();
			this.holdRelease.set(r, release);
			this.releaseHeld(r); // permanent pins from older versions
			const buttonMode = s.layoutMode === "button";
			const sorting = this.sorting.has(r);
			// Modules keep pushing each other apart (slime), also after a sort.
			const bubbles = this.bubblesOn() ? this.sim.get(r)?.bubbles : undefined;
			if (!bubbles && ++this.slimeFrame % 2 === 0) this.slimeTick(r);
			// Walls: always in "always" mode; in "by button" mode during a sort, and
			// afterwards only for notes of OTHER modules (members float freely).
			const anchors = buttonMode ? this.kept.get(r) : this.sent.get(r);
			// Notes of other modules are kept out once modules have their places;
			// members are held in during a sort (or always, in "always" mode); notes
			// with no links at all are always held in — nothing else ties them to
			// their module, so the graph's repulsion would fling them away.
			const outsidersRule = !buttonMode || sorting || !!anchors?.size;
			const membersRule = !buttonMode || sorting;
			if (!s.moduleSolid || !s.modulesEnabled || !modules.list.length || !r.nodes?.length) {
				this.releaseResting(r);
				continue;
			}
			if (this.growing.has(r)) continue;

			const pinned = this.pinned.get(r);
			const frozen = this.frozen.get(r);
			const members = modules.members();
			const owner = new Map<string, string>();
			for (const [id, set] of members) for (const path of set) owner.set(path, id);
			// Members present in this graph, per module.
			const memberCount = new Map<string, number>();
			for (const n of r.nodes) {
				const o = owner.get(n.id);
				if (o) memberCount.set(o, (memberCount.get(o) ?? 0) + 1);
			}
			const pad = this.plugin.modules.unit * 0.6 * s.moduleSize;

			// Each module's barrier: its bubble, the reserved place, or around its notes.
			const walls: { id: string; x: number; y: number; R: number }[] = [];
			if (bubbles) for (const b of bubbles) walls.push({ id: b.id, x: b.x, y: b.y, R: b.R });
			for (const m of bubbles ? [] : modules.list) {
				const placed = s.moduleSeparate ? modules.centers.get(m.id) : undefined;
				if (placed?.hold) {
					walls.push({ id: m.id, x: placed.x, y: placed.y, R: placed.hold });
					continue;
				}
				const set = members.get(m.id);
				const nodes = set?.size ? r.nodes.filter((n) => set.has(n.id) && Number.isFinite(n.x)) : [];
				if (!nodes.length) continue;
				// After a sort the module's anchor (its pinned main file) is its centre.
				const anchorId = this.moduleAnchors.get(m.id);
				const ap = anchorId ? anchors?.get(anchorId) : undefined;
				const x = ap?.x ?? median(nodes.map((n) => n.x));
				const y = ap?.y ?? median(nodes.map((n) => n.y));
				walls.push({ id: m.id, x, y, R: modules.barrierRadius(nodes.length, nodes.map((n) => Math.hypot(n.x - x, n.y - y))) });
			}
			if (!walls.length) continue;

			const resting = this.resting.get(r) ?? new Set<string>();
			this.resting.set(r, resting);
			// Which notes have at least one link in the graph.
			const linked = new Set<string>();
			for (const l of r.links ?? []) {
				if (l.source.id) linked.add(l.source.id);
				if (l.target.id) linked.add(l.target.id);
			}
			const fixes: { id: string; x: number; y: number; depth: number }[] = [];
			for (const n of r.nodes) {
				if (pinned?.has(n.id) || frozen?.has(n.id) || resting.has(n.id) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
				const own = owner.get(n.id);
				// Own wall first: a member outside its module goes back in.
				const orphan = !linked.has(n.id);
				// Small modules (a few notes) keep all their notes with them; otherwise
				// links to other modules drag them across the graph.
				const small = own ? (memberCount.get(own) ?? 0) < 6 : false;
				// With bubbles, module notes are moved by the bubble physics, not by walls.
				if (bubbles && own) continue;
				const home = own && (membersRule || orphan || small) ? walls.find((w) => w.id === own) : undefined;
				if (home) {
					const dx = n.x - home.x;
					const dy = n.y - home.y;
					const d = Math.hypot(dx, dy) || 0.001;
					// Hysteresis: only clearly outside (5 %), so a note held right at the
					// edge by an outside force (e.g. a magnet) isn't corrected every tick.
					if (d > home.R * 1.05) {
						// Unlinked notes go well inside (not onto the wall they'd keep hitting).
						const k = (home.R * (orphan ? 0.55 : 0.96)) / d;
						fixes.push({ id: n.id, x: home.x + dx * k, y: home.y + dy * k, depth: d - home.R });
						continue;
					}
				}
				if (!outsidersRule) continue;
				// Then other modules' walls: nobody else gets in.
				for (const w of walls) {
					if (w.id === own) continue;
					const dx = n.x - w.x;
					const dy = n.y - w.y;
					const d = Math.hypot(dx, dy) || 0.001;
					if (d < (w.R + pad) * 0.95) {
						const k = (w.R + pad + 10) / d;
						fixes.push({ id: n.id, x: w.x + dx * k, y: w.y + dy * k, depth: w.R + pad - d });
						break;
					}
				}
			}
			if (!fixes.length) continue;
			fixes.sort((a, b) => b.depth - a.depth);
			const budget = this.nudgeBudget.get(r) ?? 4;
			const settle = budget <= 0; // out of nudges: stubborn notes rest against the wall
			const nudge = !settle && now - (this.lastNudge.get(r) ?? 0) > 1500;
			// The wake-up rides in the same messages: a resting graph applies the fixes too.
			const wake = nudge ? 0.04 : settle ? 0.02 : 0;
			for (const f of fixes.slice(0, 80)) {
				// A note corrected again and again in a short time is being pulled by
				// something (links, a magnet force): let it rest at the wall now instead
				// of yanking it back and forth.
				const hits = (this.wallHits.get(f.id) ?? []).filter((t) => now - t < 8000);
				hits.push(now);
				this.wallHits.set(f.id, hits);
				const rest = settle || hits.length >= 3;
				this.pin(r, f.id, f.x, f.y, rest ? Math.max(wake, 0.02) : wake);
				if (rest) resting.add(f.id);
				else release.add(f.id);
			}
			if (nudge) {
				this.lastNudge.set(r, now);
				this.nudgeBudget.set(r, budget - 1);
			}
		}
	}

	private slimeFrame = 0;
	/** When each note was last corrected by a wall (to calm notes that keep hitting it). */
	private wallHits = new Map<string, number[]>();
	/** Smoothed module sizes for collisions, so jittering notes don't shake the modules. */
	private slimeRadius = new Map<string, number>();
	private lastSlimePush = 0;
	/** Pushes left in this episode; refilled when the layout changes. */
	private slimeBudget = 12;

	/**
	 * Modules as soft bodies: when two modules (measured around their anchors
	 * from where their notes really are) overlap, their anchors are pushed apart
	 * a bit each tick — a springy shove rather than a jump. Notes follow their
	 * anchor through their links. Small overlaps (<3 %) are ignored so the graph
	 * can come to rest.
	 */
	private slimeTick(r: GraphRenderer) {
		const s = this.plugin.settings;
		const modules = this.plugin.modules;
		if (!s.modulesEnabled || !s.moduleSeparate || modules.list.length < 2 || !r.nodes?.length || this.growing.has(r)) return;
		const buttonMode = s.layoutMode === "button";
		const anchors = buttonMode ? this.kept.get(r) : this.sent.get(r);
		if (!anchors?.size) return;
		const members = modules.members();
		const pad = modules.unit * 0.6 * s.moduleSize;
		const nodeById = new Map(r.nodes.map((n) => [n.id, n]));
		const circles: (Circle & { aid: string; mid: string; ox: number; oy: number })[] = [];
		for (const [mid, aid] of this.moduleAnchors) {
			const p = anchors.get(aid);
			const set = members.get(mid);
			if (!p || !set) continue;
			const dists: number[] = [];
			for (const id of set) {
				const n = nodeById.get(id);
				if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) dists.push(Math.hypot(n.x - p.x, n.y - p.y));
			}
			if (!dists.length) continue;
			const raw = modules.barrierRadius(dists.length, dists) + pad;
			const prev = this.slimeRadius.get(mid);
			const rad = prev === undefined ? raw : prev + (raw - prev) * 0.2;
			this.slimeRadius.set(mid, rad);
			circles.push({ x: p.x, y: p.y, r: rad, aid, mid, ox: p.x, oy: p.y });
		}
		// Calm: a push at most every 1.2 s, and give up after a dozen in a row
		// (something keeps pulling the modules together) until the layout changes.
		const now = performance.now();
		if (now - this.lastSlimePush < 1200 || this.slimeBudget <= 0) return;
		let overlap = false;
		for (let i = 0; i < circles.length && !overlap; i++) {
			for (let j = i + 1; j < circles.length; j++) {
				const a = circles[i];
				const b = circles[j];
				if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r + s.moduleGap) * 0.92) {
					overlap = true;
					break;
				}
			}
		}
		if (!overlap) return;
		separateCircles(circles, s.moduleGap, 40);
		let moved = false;
		for (const c of circles) {
			const dx = c.x - c.ox;
			const dy = c.y - c.oy;
			if (Math.hypot(dx, dy) < 1) continue;
			// Springy: cover a third of the way each tick. With the skill tree kept
			// pinned ("always"), the module's whole branch moves, keeping its shape.
			const sx = dx * 0.35;
			const sy = dy * 0.35;
			const ids = !buttonMode && s.skillTreeEnabled ? [...(members.get(c.mid) ?? [])].filter((id) => anchors.has(id)) : [c.aid];
			for (const id of ids) {
				const old = anchors.get(id)!;
				const p = { x: old.x + sx, y: old.y + sy };
				this.pin(r, id, p.x, p.y, 0.05);
				anchors.set(id, p);
				if (buttonMode) this.sent.get(r)?.set(id, p);
				if (this.modLayout?.target.has(id)) this.modLayout.target.set(id, p);
			}
			const placed = modules.centers.get(c.mid);
			if (placed) modules.centers.set(c.mid, { ...placed, x: placed.x + sx, y: placed.y + sy });
			moved = true;
		}
		if (moved) {
			this.lastSlimePush = now;
			this.slimeBudget--;
			// Notes knocked around by the shove get a fresh chance at the walls.
			this.nudgeBudget.set(r, Math.max(this.nudgeBudget.get(r) ?? 0, 2));
		}
	}

	private releaseResting(r: GraphRenderer) {
		const set = this.resting.get(r);
		if (!set?.size) return;
		const layoutPins = this.pinned.get(r);
		for (const id of set) if (!layoutPins?.has(id)) this.unpin(r, id);
		set.clear();
	}

	private releaseHeld(r: GraphRenderer) {
		const held = this.held.get(r);
		if (!held?.size) return;
		for (const id of held.keys()) this.unpin(r, id);
		held.clear();
	}

	// ------------------------------------------------------------- colours

	/**
	 * Keeps graph colour groups in line with the settings: the index-note tag
	 * group (only once the user asked for it) and one group per module that
	 * paints its nodes. Groups the user created are never touched; groups this
	 * plugin wrote earlier but no longer wants are removed.
	 */
	async syncColorGroups(addIndexGroup: boolean, notify: boolean) {
		const s = this.plugin.settings;
		const tag = s.tag.replace(/^#/, "").trim();
		if (addIndexGroup && !tag) {
			if (notify) new Notice("ObsOrg: сначала укажите тег главных файлов.");
			return;
		}
		const adapter = this.app.vault.adapter;
		const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
		let cfg: { colorGroups?: ColorGroup[] } & Record<string, unknown> = {};
		try {
			if (await adapter.exists(path)) cfg = JSON.parse(await adapter.read(path));
		} catch (e) {
			console.error("ObsOrg: cannot read graph.json", e);
			if (notify) new Notice("ObsOrg: не удалось прочитать настройки графа.");
			return;
		}

		const managed = new Set(s.managedGraphQueries);
		const tagQuery = tag ? `tag:#${tag}` : null;
		const desired: ColorGroup[] = [];
		if (tagQuery && (addIndexGroup || managed.has(tagQuery))) {
			desired.push({ query: tagQuery, color: { a: 1, rgb: hexToRgb(s.highlightColor) } });
		}
		for (const g of this.plugin.modules.colorGroups()) {
			if (!desired.some((d) => d.query === g.query)) desired.push({ query: g.query, color: { a: 1, rgb: hexToRgb(g.color) } });
		}
		const desiredQ = new Set(desired.map((g) => g.query));
		const userGroups = (cfg.colorGroups ?? []).filter((g) => !managed.has(g.query) && !desiredQ.has(g.query));
		const groups = [...desired, ...userGroups];
		const nextManaged = desired.map((g) => g.query);

		if (JSON.stringify(groups) !== JSON.stringify(cfg.colorGroups ?? [])) {
			cfg.colorGroups = groups;
			await adapter.write(path, JSON.stringify(cfg, null, 2));
			try {
				const graph = (this.app as AppWithInternals).internalPlugins?.getPluginById?.("graph");
				const opts = graph?.instance?.options;
				if (opts) opts.colorGroups = groups;
			} catch {
				/* ignore */
			}
		}
		if (JSON.stringify(nextManaged) !== JSON.stringify(s.managedGraphQueries)) {
			s.managedGraphQueries = nextManaged;
			await this.plugin.saveSettings();
		}
		if (notify) {
			new Notice("ObsOrg: цвет главных файлов добавлен в граф. Закройте и снова откройте граф.", 8000);
		}
	}
}
