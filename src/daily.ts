import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import type { FolderHubSettings } from "./settings";

interface DailyConfig {
	folder: string;
	format: string;
	template: string;
}

type AppWithInternals = App & {
	internalPlugins?: {
		getPluginById?: (id: string) => { enabled?: boolean; instance?: { options?: Partial<DailyConfig> } } | null;
	};
};

/** Plugin settings first; empty fields fall back to the core "Daily notes" plugin. */
export function dailyConfig(app: App, s: FolderHubSettings): DailyConfig {
	let core: Partial<DailyConfig> = {};
	try {
		core = (app as AppWithInternals).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
	} catch {
		/* undocumented API, ignore */
	}
	return {
		folder: (s.dailyFolder.trim() || core.folder || "").replace(/^\/+|\/+$/g, ""),
		format: s.dailyFormat.trim() || core.format || "YYYY-MM-DD",
		template: s.dailyTemplate.trim() || core.template || "",
	};
}

export function dailyPath(app: App, s: FolderHubSettings, key: string): string {
	const cfg = dailyConfig(app, s);
	const name = moment(key, "YYYY-MM-DD").format(cfg.format);
	return normalizePath(cfg.folder ? `${cfg.folder}/${name}.md` : `${name}.md`);
}

export function findDaily(app: App, s: FolderHubSettings, key: string): TFile | null {
	const f = app.vault.getAbstractFileByPath(dailyPath(app, s, key));
	return f instanceof TFile ? f : null;
}

async function ensureFolder(app: App, path: string) {
	const parts = path.split("/").slice(0, -1);
	let cur = "";
	for (const part of parts) {
		cur = cur ? `${cur}/${part}` : part;
		if (!(app.vault.getAbstractFileByPath(cur) instanceof TFolder)) {
			await app.vault.createFolder(cur).catch(() => undefined);
		}
	}
}

async function readTemplate(app: App, template: string): Promise<string> {
	if (!template) return "";
	const file =
		app.vault.getAbstractFileByPath(normalizePath(template)) ??
		app.vault.getAbstractFileByPath(normalizePath(template + ".md")) ??
		app.metadataCache.getFirstLinkpathDest(template, "");
	return file instanceof TFile ? app.vault.read(file) : "";
}

/** Opens the daily note for `key` (YYYY-MM-DD), creating it from the template if needed. */
export async function openDaily(app: App, s: FolderHubSettings, key: string): Promise<TFile> {
	let file = findDaily(app, s, key);
	if (!file) {
		const cfg = dailyConfig(app, s);
		const path = dailyPath(app, s, key);
		const date = moment(key, "YYYY-MM-DD");
		const title = path.split("/").pop()!.replace(/\.md$/, "");
		const content = (await readTemplate(app, cfg.template))
			.replace(/\{\{date:([^}]+)\}\}/g, (_, f: string) => date.format(f.trim()))
			.replace(/\{\{time:([^}]+)\}\}/g, (_, f: string) => moment().format(f.trim()))
			.replace(/\{\{date\}\}/g, date.format(cfg.format))
			.replace(/\{\{time\}\}/g, moment().format("HH:mm"))
			.replace(/\{\{title\}\}/g, title);
		await ensureFolder(app, path);
		file = await app.vault.create(path, content);
	}
	await app.workspace.getLeaf(false).openFile(file);
	return file;
}
