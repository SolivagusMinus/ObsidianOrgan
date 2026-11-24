import { App, Notice, TFile, TFolder, View, normalizePath } from "obsidian";
import type FolderHubPlugin from "./main";
import { DIRECTIONS, LayoutOptions, Point, TreeNode, layoutSkillTree } from "./skilltree";

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

/** Branch colour groups written by v1.2.0 (removed since). */
const isBranchQuery = (q: string) => q.startsWith("path:/^");

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
		// Clean up branch colours left by v1.2.0.
		if (this.plugin.settings.managedGraphQueries.some(isBranchQuery)) void this.syncColorGroups(false, false);
	}

	stop() {
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
		const target = s.skillTreeEnabled ? this.positions() : new Map<string, Point>();

		// First time this graph shows the tree: let it grow out of the centre.
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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

	// ------------------------------------------------------------- colours

	/**
	 * Keeps graph colour groups tidy: optionally puts the index-note tag group
	 * first (highest priority), and removes branch groups written by v1.2.0.
	 * Groups the user created are never touched.
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
		let groups = (cfg.colorGroups ?? []).filter((g) => !(managed.has(g.query) && isBranchQuery(g.query)));
		const nextManaged = s.managedGraphQueries.filter((q) => !isBranchQuery(q));
		if (addIndexGroup) {
			const query = `tag:#${tag}`;
			groups = [{ query, color: { a: 1, rgb: hexToRgb(s.highlightColor) } }, ...groups.filter((g) => g.query !== query)];
			if (!nextManaged.includes(query)) nextManaged.push(query);
		}

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
