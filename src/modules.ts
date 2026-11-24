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
				const folder = normalizePath(m.value || "/");
				const prefix = folder === "/" ? "" : folder + "/";
				for (const f of files) if (f.path.startsWith(prefix)) set.add(f.path);
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
			out.set(m.id, set);
		}
		this.cache = out;
		return out;
	}

	/** Barrier radius in graph units: grows with the number of notes, plus any widening. */
	radius(id: string, count: number): number {
		return moduleRadius(count, this.plugin.settings.moduleSize) + (this.extra.get(id) ?? 0);
	}

	/** Lets a barrier grow when the layout keeps pushing notes out of it. */
	widen(id: string, by: number) {
		const cur = this.extra.get(id) ?? 0;
		this.extra.set(id, Math.min(cur + Math.max(0, by), 2000));
	}

	/** Graph search query that matches the module's members (for colour groups). */
	query(m: ModuleDef): string | null {
		if (m.kind === "folder") {
			const folder = normalizePath(m.value || "");
			if (!folder || folder === "/") return null;
			return `path:/^${escapeRegex(folder)}\\//`;
		}
		const tag = m.value.replace(/^#/, "").trim();
		return tag ? `tag:#${tag}` : null;
	}

	/** Colour groups for modules that paint their nodes, most specific first. */
	colorGroups(): { query: string; color: string }[] {
		const depth = (m: ModuleDef) => (m.kind === "folder" ? m.value.split("/").length : 100);
		return this.list
			.filter((m) => m.colorNodes)
			.sort((a, b) => depth(b) - depth(a))
			.map((m) => ({ query: this.query(m), color: m.color }))
			.filter((g): g is { query: string; color: string } => !!g.query);
	}

	/** Creates a module for a folder (or returns the existing one). */
	addFolderModule(folder: TFolder): ModuleDef {
		const existing = this.list.find((m) => m.kind === "folder" && m.value === folder.path);
		if (existing) return existing;
		const m: ModuleDef = {
			id: newModuleId(),
			name: folder.name,
			kind: "folder",
			value: folder.path,
			color: MODULE_COLORS[this.list.length % MODULE_COLORS.length],
			colorNodes: true,
			line: "default",
		};
		this.list.push(m);
		this.invalidate();
		return m;
	}

	findFolderModule(folder: TFolder): ModuleDef | undefined {
		return this.list.find((m) => m.kind === "folder" && m.value === folder.path);
	}

	remove(id: string) {
		const i = this.list.findIndex((m) => m.id === id);
		if (i >= 0) this.list.splice(i, 1);
		this.invalidate();
	}

	/** True if the file belongs to any module (used by tests / UI). */
	isMember(file: TFile): boolean {
		for (const set of this.members().values()) if (set.has(file.path)) return true;
		return false;
	}
}
