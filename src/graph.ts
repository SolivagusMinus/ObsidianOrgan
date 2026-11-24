import { App, Notice, TFile, TFolder, View, normalizePath } from "obsidian";
import type FolderHubPlugin from "./main";
import { DIRECTIONS, LayoutOptions, Point, TreeNode, layoutSkillTree } from "./skilltree";
import { Circle, centroid, separateCircles } from "./module-shapes";

// ---------------------------------------------------------------------------
// Undocumented Obsidian internals (graph view). Everything is feature-checked
// and wrapped so that an Obsidian update can only disable the effect, never
// break the vault. Node pinning uses the same `forceNode` worker message that
// Obsidian itself sends while you drag a node.
// ---------------------------------------------------------------------------

interface GraphRenderer {
	nodes?: { id: string; x: number; y: number }[];
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
		this.plugin.registerInterval(this.holdTimer);
	}

	stop() {
		if (this.holdTimer !== null) window.clearInterval(this.holdTimer);
		for (const [r, ids] of this.holdRelease) for (const id of ids) this.post(r, { forceNode: { id, x: null, y: null } });
		this.holdRelease.clear();
		for (const r of this.held.keys()) this.releaseHeld(r);
		for (const r of this.resting.keys()) this.releaseResting(r);
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
		this.timers.forEach((t) => window.clearTimeout(t));
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
	}

	/** Re-applies the layout to every open global graph. */
	refresh() {
		this.depthCache = null;
		this.posCache = null;
		this.modLayout = null;
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
				this.schedule(r);
			}
		}
		// Forget renderers of closed graph tabs.
		for (const r of [...this.originals.keys()]) {
			if (alive.has(r)) continue;
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

	private post(r: GraphRenderer, msg: unknown) {
		try {
			r.worker?.postMessage(msg);
		} catch (e) {
			console.warn("ObsOrg: graph worker message failed", e);
		}
	}

	private hasNode(r: GraphRenderer, id: string): boolean {
		if (r.nodeLookup) return id in r.nodeLookup;
		return !!r.nodes?.some((n) => n.id === id);
	}

	private apply(r: GraphRenderer, tries: number) {
		if (!r.nodes || r.nodes.length === 0) {
			// The graph is still loading its data.
			if (tries < 20) this.schedule(r, tries + 1, 250);
			return;
		}
		const s = this.plugin.settings;
		const prev = this.pinned.get(r) ?? new Set<string>();
		const base = s.skillTreeEnabled ? this.positions() : new Map<string, Point>();
		const target = this.withModules(r, base);

		// First time this graph shows the tree: let it grow out of the centre.
		const reduced = this.plugin.motionReduced();
		if (target.size && !this.grown.has(r) && s.graphGrow && s.animations && !reduced) {
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
				this.post(r, { forceNode: { id, x: null, y: null } });
				moved = true;
			}
		}
		this.pinned.set(r, now);
		// A new "episode" for solid barriers only when the picture really changed
		// (not on every autosave while typing).
		if (moved || this.lastNodeCount.get(r) !== r.nodes.length) {
			this.lastNodeCount.set(r, r.nodes.length);
			this.releaseResting(r);
			this.nudgeBudget.set(r, 4);
		}
		// Modules bumping into each other: glide to the new places with a little
		// springy overshoot instead of teleporting.
		if (moved && last.size && s.animations && !reduced) {
			this.animatePins(r, last, target, now);
			return;
		}
		for (const id of now) {
			const p = target.get(id)!;
			this.post(r, { forceNode: { id, x: p.x, y: p.y } });
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
			for (const o of list) this.post(r, { forceNode: { id: o.id, x: o.a.x + (o.b.x - o.a.x) * e, y: o.a.y + (o.b.y - o.a.y) * e } });
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
			if (!pinned.has(id)) this.post(r, { forceNode: { id, x: null, y: null } });
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
				this.post(r, { forceNode: { id, x: p.x * e, y: p.y * e } });
			}
			if (done) {
				this.growing.delete(r);
				this.sent.set(r, new Map(ids.map((id) => [id, target.get(id)!])));
				this.scheduleFreeze(r);
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
					this.post(r, { forceNode: { id: n.id, x: n.x, y: n.y } });
					set.add(n.id);
				}
				this.frozen.set(r, set);
			}, 3000),
		);
	}

	private unfreeze(r: GraphRenderer) {
		const set = this.frozen.get(r);
		if (!set?.size) return;
		for (const id of set) this.post(r, { forceNode: { id, x: null, y: null } });
		this.frozen.delete(r);
		this.reheat(r);
	}

	private unpinAll(r: GraphRenderer) {
		const prev = this.pinned.get(r);
		if (!prev?.size) return;
		for (const id of prev) this.post(r, { forceNode: { id, x: null, y: null } });
		this.pinned.set(r, new Set());
		this.reheat(r);
	}

	/** Wakes the simulation up so nodes glide to their new places. */
	private reheat(r: GraphRenderer) {
		this.post(r, { alpha: 0.3, run: true });
		try {
			r.changed?.();
		} catch {
			/* ignore */
		}
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
		const pad = 38 * s.moduleSize;
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
			const c0 = baseC ?? pos(anchor);
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
		for (const c of circles) {
			const { info } = c;
			alive.add(info.id);
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
			for (const id of release) if (!layoutPins?.has(id)) this.post(r, { forceNode: { id, x: null, y: null } });
			release.clear();
			this.holdRelease.set(r, release);
			this.releaseHeld(r); // permanent pins from older versions
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
			const pad = 38 * s.moduleSize;

			// Each module's barrier: the reserved place, or (without separation) around its notes.
			const walls: { id: string; x: number; y: number; R: number }[] = [];
			for (const m of modules.list) {
				const placed = s.moduleSeparate ? modules.centers.get(m.id) : undefined;
				if (placed?.hold) {
					walls.push({ id: m.id, x: placed.x, y: placed.y, R: placed.hold });
					continue;
				}
				const set = members.get(m.id);
				const nodes = set?.size ? r.nodes.filter((n) => set.has(n.id) && Number.isFinite(n.x)) : [];
				if (!nodes.length) continue;
				const x = median(nodes.map((n) => n.x));
				const y = median(nodes.map((n) => n.y));
				walls.push({ id: m.id, x, y, R: modules.barrierRadius(nodes.length, nodes.map((n) => Math.hypot(n.x - x, n.y - y))) });
			}
			if (!walls.length) continue;

			const resting = this.resting.get(r) ?? new Set<string>();
			this.resting.set(r, resting);
			const fixes: { id: string; x: number; y: number; depth: number }[] = [];
			for (const n of r.nodes) {
				if (pinned?.has(n.id) || frozen?.has(n.id) || resting.has(n.id) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
				const own = owner.get(n.id);
				// Own wall first: a member outside its module goes back in.
				const home = own ? walls.find((w) => w.id === own) : undefined;
				if (home) {
					const dx = n.x - home.x;
					const dy = n.y - home.y;
					const d = Math.hypot(dx, dy) || 0.001;
					if (d > home.R) {
						const k = (home.R * 0.96) / d;
						fixes.push({ id: n.id, x: home.x + dx * k, y: home.y + dy * k, depth: d - home.R });
						continue;
					}
				}
				// Then other modules' walls: nobody else gets in.
				for (const w of walls) {
					if (w.id === own) continue;
					const dx = n.x - w.x;
					const dy = n.y - w.y;
					const d = Math.hypot(dx, dy) || 0.001;
					if (d < w.R + pad) {
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
			for (const f of fixes.slice(0, 80)) {
				this.post(r, { forceNode: { id: f.id, x: f.x, y: f.y } });
				if (settle) resting.add(f.id);
				else release.add(f.id);
			}
			if (!settle && now - (this.lastNudge.get(r) ?? 0) > 1500) {
				this.post(r, { alpha: 0.04, run: true });
				this.lastNudge.set(r, now);
				this.nudgeBudget.set(r, budget - 1);
			}
		}
	}

	private releaseResting(r: GraphRenderer) {
		const set = this.resting.get(r);
		if (!set?.size) return;
		const layoutPins = this.pinned.get(r);
		for (const id of set) if (!layoutPins?.has(id)) this.post(r, { forceNode: { id, x: null, y: null } });
		set.clear();
	}

	private releaseHeld(r: GraphRenderer) {
		const held = this.held.get(r);
		if (!held?.size) return;
		for (const id of held.keys()) this.post(r, { forceNode: { id, x: null, y: null } });
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
