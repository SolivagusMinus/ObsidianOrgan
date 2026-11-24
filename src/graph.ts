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
	nodes?: { id: string }[];
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

/** Validated categorical palette (8 hues), stepped separately for light and dark themes. */
const PALETTE = {
	light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
	dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export class GraphTree {
	private originals = new Map<GraphRenderer, (data: unknown) => void>();
	private views = new Map<GraphRenderer, GraphLeafView>();
	private pinned = new Map<GraphRenderer, Set<string>>();
	private timers = new Map<GraphRenderer, number>();
	private refreshTimer: number | null = null;
	private colorTimer: number | null = null;

	constructor(private plugin: FolderHubPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	start() {
		const p = this.plugin;
		p.registerEvent(this.app.workspace.on("layout-change", () => this.scan()));
		const onTreeChange = (f: unknown) => {
			if (f instanceof TFolder || (f instanceof TFile && f.extension === "md")) this.refreshSoon();
			if (f instanceof TFolder && this.plugin.settings.branchColors) this.recolorSoon();
		};
		p.registerEvent(this.app.vault.on("create", onTreeChange));
		p.registerEvent(this.app.vault.on("delete", onTreeChange));
		p.registerEvent(this.app.vault.on("rename", onTreeChange));
		this.scan();
	}

	stop() {
		for (const r of [...this.originals.keys()]) {
			this.unpinAll(r);
			const orig = this.originals.get(r);
			if (orig) r.setData = orig;
		}
		this.originals.clear();
		this.views.clear();
		this.timers.forEach((t) => window.clearTimeout(t));
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		if (this.colorTimer !== null) window.clearTimeout(this.colorTimer);
	}

	/** Re-applies the layout to every open global graph. */
	refresh() {
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

	private recolorSoon() {
		if (this.colorTimer !== null) window.clearTimeout(this.colorTimer);
		this.colorTimer = window.setTimeout(() => {
			this.colorTimer = null;
			void this.applyBranchColors(false);
		}, 2000);
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
			console.warn("Folder Hub: graph worker message failed", e);
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
		const prev = this.pinned.get(r) ?? new Set<string>();
		const target = this.plugin.settings.skillTreeEnabled ? this.positions() : new Map<string, Point>();
		const now = new Set<string>();
		for (const [id, p] of target) {
			if (!this.hasNode(r, id)) continue;
			this.post(r, { forceNode: { id, x: p.x, y: p.y } });
			now.add(id);
		}
		for (const id of prev) {
			if (!now.has(id)) this.post(r, { forceNode: { id, x: null, y: null } });
		}
		this.pinned.set(r, now);
		if (now.size || prev.size) this.reheat(r);
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
		this.post(r, { alpha: 0.6, run: true });
		try {
			const opts = this.views.get(r)?.dataEngine?.getOptions?.();
			if (opts && typeof r.setForces === "function") {
				const forces: Record<string, number> = {};
				for (const k of ["centerStrength", "linkStrength", "linkDistance", "repelStrength"]) {
					if (typeof opts[k] === "number") forces[k] = opts[k] as number;
				}
				if (Object.keys(forces).length) r.setForces(forces);
			}
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

	positions(): Map<string, Point> {
		return layoutSkillTree(this.buildTree(), this.layoutOptions());
	}

	// ------------------------------------------------------------- colours

	/**
	 * Writes graph colour groups: the index-note tag first (highest priority),
	 * then one group per top-level branch. Groups the user created are kept;
	 * groups this plugin created earlier are replaced.
	 */
	async applyBranchColors(notify: boolean) {
		const s = this.plugin.settings;
		const adapter = this.app.vault.adapter;
		const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
		let cfg: { colorGroups?: ColorGroup[] } & Record<string, unknown> = {};
		try {
			if (await adapter.exists(path)) cfg = JSON.parse(await adapter.read(path));
		} catch (e) {
			console.error("Folder Hub: cannot read graph.json", e);
			if (notify) new Notice("Folder Hub: не удалось прочитать настройки графа.");
			return;
		}

		const ours: ColorGroup[] = [];
		const tag = s.tag.replace(/^#/, "").trim();
		if (tag) ours.push({ query: `tag:#${tag}`, color: { a: 1, rgb: hexToRgb(s.highlightColor) } });

		let skipped = 0;
		if (s.branchColors) {
			const palette = document.body.hasClass("theme-dark") ? PALETTE.dark : PALETTE.light;
			const roots = this.buildTree().sort((a, b) => a.name.localeCompare(b.name));
			roots.forEach((root, i) => {
				if (i >= palette.length) {
					skipped++;
					return;
				}
				const folder = root.id.slice(0, root.id.lastIndexOf("/"));
				ours.push({ query: `path:/^${escapeRegex(folder)}\\//`, color: { a: 1, rgb: hexToRgb(palette[i]) } });
			});
		}

		const managed = new Set(s.managedGraphQueries);
		const userGroups = (cfg.colorGroups ?? []).filter((g) => !managed.has(g.query) && !ours.some((o) => o.query === g.query));
		const next = [...ours, ...userGroups];
		const changed = JSON.stringify(next) !== JSON.stringify(cfg.colorGroups ?? []);

		if (changed) {
			cfg.colorGroups = next;
			await adapter.write(path, JSON.stringify(cfg, null, 2));
			try {
				const graph = (this.app as AppWithInternals).internalPlugins?.getPluginById?.("graph");
				const opts = graph?.instance?.options;
				if (opts) opts.colorGroups = next;
			} catch {
				/* ignore */
			}
		}
		s.managedGraphQueries = ours.map((g) => g.query);
		await this.plugin.saveSettings();

		if (notify) {
			const extra = skipped ? ` Веток больше 8 — ещё ${skipped} остались без своего цвета.` : "";
			new Notice(`Folder Hub: цвета веток записаны.${extra} Закройте и снова откройте граф.`, 8000);
		}
	}
}
