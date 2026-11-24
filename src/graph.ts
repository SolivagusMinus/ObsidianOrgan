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
		this.holdTimer = window.setInterval(() => this.holdTick(), 400);
		this.plugin.registerInterval(this.holdTimer);
	}

	stop() {
		if (this.holdTimer !== null) window.clearInterval(this.holdTimer);
		for (const [r, ids] of this.holdRelease) for (const id of ids) this.post(r, { forceNode: { id, x: null, y: null } });
		this.holdRelease.clear();
		for (const r of this.held.keys()) this.releaseHeld(r);
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
			this.post(r, { forceNode: { id, x: p.x, y: p.y } });
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
		this.sent.set(r, new Map([...now].map((id) => [id, target.get(id)!])));
		if (moved) {
			this.reheat(r);
			this.scheduleFreeze(r);
		} else if (this.plugin.settings.graphFreeze && !this.frozen.has(r)) {
			this.scheduleFreeze(r);
		}
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
		const key = [modules.version, modules.sizeKey(), s.moduleSize, s.moduleGap, r.nodes.length, JSON.stringify(s.modules.map((m) => [m.id, m.kind, m.value]))].join("|");
		if (this.modLayout && this.modLayout.key === key && this.modLayout.base === base) return this.modLayout.target;

		const members = modules.members();
		const nodeById = new Map(r.nodes.map((n) => [n.id, n]));
		const pad = 38 * s.moduleSize;
		const median = (v: number[]) => {
			v.sort((p, q) => p - q);
			const mid = v.length >> 1;
			return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
		};
		const circles: (Circle & { id: string; ids: string[]; baseC: Point | null })[] = [];
		for (const m of modules.list) {
			const ids = [...(members.get(m.id) ?? [])].filter((id) => nodeById.has(id));
			if (!ids.length) continue;
			const pinnedIds = ids.filter((id) => base.has(id));
			const baseC = pinnedIds.length ? centroid(pinnedIds.map((id) => base.get(id)!)) : null;
			// A skill-tree branch can be wider than "its share" by note count: reserve its real size.
			let extent = modules.radius(m.id, ids.length);
			if (baseC) for (const id of pinnedIds) extent = Math.max(extent, Math.hypot(base.get(id)!.x - baseC.x, base.get(id)!.y - baseC.y) + 30);
			const start =
				modules.centers.get(m.id) ??
				baseC ?? { x: median(ids.map((id) => nodeById.get(id)!.x)), y: median(ids.map((id) => nodeById.get(id)!.y)) };
			circles.push({ x: start.x, y: start.y, r: extent + pad, id: m.id, ids, baseC });
		}
		separateCircles(circles, s.moduleGap);

		const target = new Map(base);
		const alive = new Set<string>();
		for (const c of circles) {
			alive.add(c.id);
			modules.centers.set(c.id, { x: c.x, y: c.y, hold: c.r - pad });
			if (c.baseC) {
				const dx = c.x - c.baseC.x;
				const dy = c.y - c.baseC.y;
				for (const id of c.ids) {
					const p = base.get(id);
					if (p) target.set(id, { x: p.x + dx, y: p.y + dy });
				}
			} else {
				const anchor =
					c.ids.find((id) => {
						const f = this.app.vault.getAbstractFileByPath(id);
						return f instanceof TFile && this.plugin.isIndexNote(f);
					}) ?? c.ids[0];
				target.set(anchor, { x: c.x, y: c.y });
			}
		}
		for (const id of [...modules.centers.keys()]) if (!alive.has(id)) modules.centers.delete(id);
		this.modLayout = { key, base, target };
		return target;
	}

	/**
	 * Keeps module members inside their barrier: a note that drifted outside
	 * is pinned just inside for one tick and released on the next, so the
	 * physics carries on from there. If a note keeps escaping (the layout
	 * wants it outside), the barrier grows instead of fighting the physics.
	 */
	private holdTick() {
		const s = this.plugin.settings;
		const modules = this.plugin.modules;
		const now = performance.now();
		if (now - this.holdStrikesReset > 30000) {
			this.holdStrikes.clear();
			this.holdStrikesReset = now;
		}
		const median = (v: number[]) => {
			v.sort((p, q) => p - q);
			const mid = v.length >> 1;
			return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
		};
		for (const r of this.originals.keys()) {
			const release = this.holdRelease.get(r) ?? new Set<string>();
			for (const id of release) this.post(r, { forceNode: { id, x: null, y: null } });
			release.clear();
			this.holdRelease.set(r, release);
			const held = this.held.get(r) ?? new Map<string, Held>();
			this.held.set(r, held);
			if (!s.moduleHold || !s.modulesEnabled || !modules.list.length || !r.nodes?.length || this.growing.has(r)) {
				this.releaseHeld(r);
				continue;
			}

			const pinned = this.pinned.get(r);
			const frozen = this.frozen.get(r);
			const members = modules.members();
			const live = new Set(modules.list.map((m) => m.id));
			let clamped = 0;

			// Drop held pins whose module is gone or whose note changed module.
			for (const [id, h] of [...held]) {
				const isMember = members.get(h.mod)?.has(id) ?? false;
				if (!live.has(h.mod) || isMember !== h.inside || pinned?.has(id)) {
					this.post(r, { forceNode: { id, x: null, y: null } });
					held.delete(id);
				}
			}

			for (const m of modules.list) {
				modules.relax(m.id); // give back room from older versions' widening
				const set = members.get(m.id);
				if (!set?.size) continue;
				const nodes = r.nodes.filter((n) => set.has(n.id));
				if (!nodes.length) continue;
				const placed = s.moduleSeparate ? modules.centers.get(m.id) : undefined;
				const cx = placed?.x ?? median(nodes.map((n) => n.x));
				const cy = placed?.y ?? median(nodes.map((n) => n.y));
				const R = placed?.hold ?? modules.radius(m.id, nodes.length);

				// Held notes ride along when the module moves.
				for (const [id, h] of held) {
					if (h.mod !== m.id) continue;
					const x = cx + h.dx;
					const y = cy + h.dy;
					if (Math.abs(x - h.x) > 0.5 || Math.abs(y - h.y) > 0.5) {
						this.post(r, { forceNode: { id, x, y } });
						h.x = x;
						h.y = y;
						clamped++;
					}
				}

				/** Soft pull for the first escapes; after that the note is kept in place. */
				const correct = (id: string, dx: number, dy: number, d: number, radius: number, inside: boolean) => {
					const key = inside ? id : `${id}|out`;
					const strikes = (this.holdStrikes.get(key) ?? 0) + 1;
					this.holdStrikes.set(key, strikes);
					const k = radius / (d || 1);
					const rx = (d ? dx : 1) * k;
					const ry = (d ? dy : 0) * k;
					this.post(r, { forceNode: { id, x: cx + rx, y: cy + ry } });
					if (strikes > 2) held.set(id, { mod: m.id, inside, dx: rx, dy: ry, x: cx + rx, y: cy + ry });
					else release.add(id);
					clamped++;
				};

				// Members outside the barrier come back in.
				for (const n of nodes) {
					if (held.has(n.id) || pinned?.has(n.id) || frozen?.has(n.id)) continue;
					const dx = n.x - cx;
					const dy = n.y - cy;
					const d = Math.hypot(dx, dy);
					if (d > R) correct(n.id, dx, dy, d, R * 0.85, true);
				}

				// Separate places: notes that aren't part of this module stay outside it.
				if (s.moduleSeparate) {
					for (const n of r.nodes) {
						if (set.has(n.id) || held.has(n.id) || pinned?.has(n.id) || frozen?.has(n.id)) continue;
						const dx = n.x - cx;
						const dy = n.y - cy;
						const d = Math.hypot(dx, dy);
						if (d < R * 0.98) correct(n.id, dx, dy, d, R * 1.1, false);
					}
				}
			}
			// A gentle nudge so the pins take effect even if the graph had come to rest.
			if (clamped) this.post(r, { alpha: 0.05, run: true });
		}
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
