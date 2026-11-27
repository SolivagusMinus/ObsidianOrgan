import { TFile, TFolder, getAllTags, normalizePath } from "obsidian";
import type FolderHubPlugin from "./main";
import { LineStyle, moduleRadius } from "./module-shapes";

export interface ModuleDef {
	id: string;
	name: string;
	/** Members: every file in a folder (with sub-folders), or every note with a tag. */
	kind: "folder" | "tag";
	value: string;
	color: string;
	/** Paint member nodes in the module colour (graph colour group). */
	colorNodes: boolean;
	/** Boundary line; "default" uses the global setting. */
	line: LineStyle | "default";
	/** Parent module id: this module is a sub-module drawn inside it (topics/chapters). */
	parent?: string;
}

/** Distinct, colour-blind-safe defaults for new modules (cycled). */
export const MODULE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function newModuleId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Keeps track of which vault paths belong to which module. Membership is
 * recomputed lazily after vault or metadata changes; `version` bumps every
 * time it changes so graph caches know to rebuild.
 */
export class GraphModules {
	version = 0;
	private cache: Map<string, Set<string>> | null = null;
	private timer: number | null = null;
	/** Extra radius a barrier gained because notes kept escaping it (world units). */
	private extra = new Map<string, number>();
	/** Where each module sits in the graph after separation (graph units). */
	centers = new Map<string, { x: number; y: number; hold?: number }>();

	constructor(private plugin: FolderHubPlugin) {}

	start() {
		const p = this.plugin;
		const dirty = () => this.invalidateSoon();
		p.registerEvent(p.app.vault.on("create", dirty));
		p.registerEvent(p.app.vault.on("delete", dirty));
		p.registerEvent(p.app.vault.on("rename", dirty));
		p.registerEvent(p.app.metadataCache.on("resolved", dirty));
	}

	get list(): ModuleDef[] {
		return this.plugin.settings.modules;
	}

	invalidate() {
		this.cache = null;
		this.version++;
	}

	private invalidateSoon() {
		if (!this.list.length) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.invalidate();
		}, 800);
	}

	/** Module id → set of member paths. */
	members(): Map<string, Set<string>> {
		if (this.cache) return this.cache;
		const out = new Map<string, Set<string>>();
		const files = this.plugin.app.vault.getFiles();
		for (const m of this.list) {
			const set = new Set<string>();
			if (m.kind === "folder") {
				// No folder chosen yet (a module just added in settings) → no members, not the whole vault.
				const folder = m.value.trim() ? normalizePath(m.value) : "";
				if (folder && folder !== "/") {
					const prefix = folder + "/";
					for (const f of files) if (f.path.startsWith(prefix)) set.add(f.path);
				}
			} else {
				const tag = "#" + m.value.replace(/^#/, "").trim().toLowerCase();
				if (tag.length > 1) {
					for (const f of files) {
						if (f.extension !== "md") continue;
						const cache = this.plugin.app.metadataCache.getFileCache(f);
						const tags = cache ? getAllTags(cache) ?? [] : [];
						if (tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(tag + "/"))) set.add(f.path);
					}
				}
			}
			// Notes that don't exist yet but are linked from the module ([[…]]) are
			// shown as nodes in the graph too — they belong inside the barrier.
			const unresolved = this.plugin.app.metadataCache.unresolvedLinks ?? {};
			for (const path of [...set]) {
				const links = unresolved[path];
				if (!links) continue;
				for (const link of Object.keys(links)) {
					set.add(link);
					if (!link.endsWith(".md")) set.add(`${link}.md`);
				}
			}
			out.set(m.id, set);
		}
		// Each note belongs to one module only — the most specific one — so
		// modules never sit inside each other: a sub-folder module takes its
		// notes away from the parent folder's module; a tag module wins over folders.
		// Sub-modules only take notes that belong to their parent (folder or tag).
		for (const m of [...this.list].sort((a, b) => this.depth(a.id) - this.depth(b.id))) {
			const p = this.parentOf(m.id);
			if (!p) continue;
			const mine = out.get(m.id);
			const theirs = out.get(p.id);
			if (mine && theirs) for (const path of [...mine]) if (!theirs.has(path)) mine.delete(path);
		}
		// Deepest in the module tree wins, then the most specific (tag > deeper folder).
		const specificity = (m: ModuleDef) =>
			this.depth(m.id) * 10000 + (m.kind === "tag" ? 1000 : normalizePath(m.value || "/").split("/").length);
		const order = [...this.list].sort((a, b) => specificity(b) - specificity(a));
		const owner = new Map<string, string>();
		for (const m of order) for (const path of out.get(m.id) ?? []) if (!owner.has(path)) owner.set(path, m.id);
		for (const [id, set] of out) for (const path of [...set]) if (owner.get(path) !== id) set.delete(path);
		this.cache = out;
		return out;
	}

	// ------------------------------------------------------- module tree

	/** The parent module, if this is a sub-module (ignores broken or cyclic links). */
	parentOf(id: string): ModuleDef | undefined {
		const m = this.list.find((x) => x.id === id);
		if (!m?.parent) return undefined;
		const p = this.list.find((x) => x.id === m.parent);
		if (!p) return undefined;
		// Guard against cycles (a → b → a): walk up at most list.length steps.
		let cur: ModuleDef | undefined = p;
		for (let i = 0; i <= this.list.length && cur; i++) {
			if (cur.id === id) return undefined;
			cur = cur.parent ? this.list.find((x) => x.id === cur!.parent) : undefined;
		}
		return p;
	}

	/** 0 for top-level modules, 1 for their sub-modules, … */
	depth(id: string): number {
		let d = 0;
		for (let p = this.parentOf(id); p && d <= this.list.length; p = this.parentOf(p.id)) d++;
		return d;
	}

	children(id: string): ModuleDef[] {
		return this.list.filter((m) => this.parentOf(m.id)?.id === id);
	}

	/** This module and every module below it. */
	descendants(id: string): ModuleDef[] {
		const out: ModuleDef[] = [];
		const walk = (pid: string) => {
			for (const c of this.children(pid)) {
				out.push(c);
				walk(c.id);
			}
		};
		walk(id);
		return out;
	}

	/**
	 * Notes of a module including those of its sub-modules (what its barrier
	 * holds). Cached until membership changes — don't modify the returned set.
	 */
	allMembers(id: string): Set<string> {
		const members = this.members();
		if (this.allFor !== members) {
			this.allFor = members;
			this.allCache.clear();
		}
		let out = this.allCache.get(id);
		if (!out) {
			out = new Set(members.get(id) ?? []);
			for (const d of this.descendants(id)) for (const p of members.get(d.id) ?? []) out.add(p);
			this.allCache.set(id, out);
		}
		return out;
	}
	private allFor: Map<string, Set<string>> | null = null;
	private allCache = new Map<string, Set<string>>();

	/** Deepest folder module whose folder contains `folder` (candidate parent for a sub-module). */
	moduleAroundFolder(folder: TFolder): ModuleDef | undefined {
		let best: ModuleDef | undefined;
		for (const m of this.list) {
			if (m.kind !== "folder" || !m.value.trim()) continue;
			const p = normalizePath(m.value);
			if (folder.path !== p && folder.path.startsWith(p + "/")) {
				if (!best || p.length > normalizePath(best.value).length) best = m;
			}
		}
		return best;
	}

	/** Barrier radius in graph units: grows with the number of notes, plus any widening. */
	radius(id: string, count: number): number {
		return moduleRadius(count, this.plugin.settings.moduleSize) + (this.extra.get(id) ?? 0);
	}

	/**
	 * Radius of a module's barrier around its centre (graph units). Shared by
	 * the layout (to reserve room) and the overlay (to draw it), so a barrier
	 * never pokes outside its reserved place. Mostly follows how far the notes
	 * really are (80th percentile), within sensible bounds for the note count;
	 * notes dragged far away by links to other modules simply stay outside.
	 */
	barrierRadius(count: number, distances: number[]): number {
		// Sizes are in "graph units" (a typical link length of this graph), so they
		// fit whatever link distance / repel force the graph is set to.
		const u = this.unit * this.plugin.settings.moduleSize;
		const n = Math.max(1, count);
		const floor = u * (1.3 + 0.45 * Math.sqrt(n));
		const cap = u * (2.5 + 1.2 * Math.sqrt(n));
		const d = distances.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
		// Small modules: their notes are easily dragged away by links, so size by count only.
		if (n < 6 || !d.length) return floor;
		const measured = d[Math.floor(0.8 * (d.length - 1))] * 1.3 + u * 0.5;
		return Math.min(cap, Math.max(floor, measured));
	}

	/** Typical link length of the current graph (graph units); measured by the layout. */
	unit = 60;

	/** Lets a barrier grow when the layout keeps pushing notes out of it. */
	widen(id: string, by: number) {
		const cur = this.extra.get(id) ?? 0;
		this.extra.set(id, Math.min(cur + Math.max(0, by), 2000));
	}

	/** Slowly gives the extra room back once notes stop escaping. */
	relax(id: string) {
		const cur = this.extra.get(id);
		if (!cur) return;
		const next = cur * 0.97;
		if (next < 1) this.extra.delete(id);
		else this.extra.set(id, next);
	}

	/** Coarse fingerprint of barrier sizes (for layout caches). */
	sizeKey(): string {
		return [...this.extra].map(([id, v]) => `${id}:${Math.round(v / 50)}`).join(",");
	}

	/** Graph search query that matches the module's members (for colour groups). */
	query(m: ModuleDef): string | null {
		if (m.kind === "folder") {
			const folder = m.value.trim() ? normalizePath(m.value) : "";
			if (!folder || folder === "/") return null;
			return `path:/^${escapeRegex(folder)}\\//`;
		}
		const tag = m.value.replace(/^#/, "").trim();
		return tag ? `tag:#${tag}` : null;
	}

	/** Colour groups for modules that paint their nodes, most specific first. */
	colorGroups(): { query: string; color: string }[] {
		// Deeper modules first: a sub-module's colour wins over its parent's.
		const depth = (m: ModuleDef) => this.depth(m.id) * 1000 + (m.kind === "folder" ? m.value.split("/").length : 100);
		return this.list
			.filter((m) => m.colorNodes)
			.sort((a, b) => depth(b) - depth(a))
			.map((m) => ({ query: this.query(m), color: m.color }))
			.filter((g): g is { query: string; color: string } => !!g.query);
	}

	/** Creates a module for a folder (or returns the existing one). */
	addFolderModule(folder: TFolder, parent?: string): ModuleDef {
		const existing = this.list.find((m) => m.kind === "folder" && m.value === folder.path);
		if (existing) {
			// Never under itself or one of its own sub-modules (that would be a loop).
			const below = new Set([existing.id, ...this.descendants(existing.id).map((d) => d.id)]);
			if (parent !== undefined && !(parent && below.has(parent))) existing.parent = parent || undefined;
			this.invalidate();
			return existing;
		}
		const m: ModuleDef = {
			id: newModuleId(),
			name: folder.name,
			kind: "folder",
			value: folder.path,
			color: MODULE_COLORS[this.list.length % MODULE_COLORS.length],
			colorNodes: true,
			line: "default",
			parent: parent || undefined,
		};
		this.list.push(m);
		this.invalidate();
		return m;
	}

	findFolderModule(folder: TFolder): ModuleDef | undefined {
		return this.list.find((m) => m.kind === "folder" && m.value === folder.path);
	}

	remove(id: string) {
		const m = this.list.find((x) => x.id === id);
		// Its sub-modules move up one level instead of disappearing.
		for (const c of this.list) if (c.parent === id) c.parent = m?.parent;
		const i = this.list.findIndex((x) => x.id === id);
		if (i >= 0) this.list.splice(i, 1);
		this.invalidate();
	}

	/** True if the file belongs to any module (used by tests / UI). */
	isMember(file: TFile): boolean {
		for (const set of this.members().values()) if (set.has(file.path)) return true;
		return false;
	}
}
