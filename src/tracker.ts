import { MarkdownView, TAbstractFile, TFile, moment } from "obsidian";
import type FolderHubPlugin from "./main";
import { DayStat, countWords } from "./words";

export const todayKey = () => moment().format("YYYY-MM-DD");

/**
 * Tracks words written per day.
 *
 * For each note we remember its last known word count (the "baseline").
 * When the note is saved while open in an editor, the difference to the
 * baseline is added to today's tally. Changes to notes that aren't open
 * (sync, other plugins, folder index updates) only move the baseline.
 */
export class WordTracker {
	private baselines = new Map<string, number>();

	constructor(private plugin: FolderHubPlugin) {}

	start() {
		const { app } = this.plugin;
		const p = this.plugin;
		p.registerEvent(app.workspace.on("file-open", (f) => f && void this.ensureBaseline(f)));
		p.registerEvent(app.vault.on("create", (f) => void this.ensureBaseline(f)));
		p.registerEvent(app.vault.on("modify", (f) => void this.onModify(f)));
		p.registerEvent(app.vault.on("delete", (f) => this.baselines.delete(f.path)));
		p.registerEvent(
			app.vault.on("rename", (f, old) => {
				const v = this.baselines.get(old);
				this.baselines.delete(old);
				if (v !== undefined) this.baselines.set(f.path, v);
			}),
		);
		// Notes already open when the plugin starts.
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file) void this.ensureBaseline(leaf.view.file);
		});
	}

	today(): DayStat {
		return this.plugin.wordStats[todayKey()] ?? { added: 0, removed: 0 };
	}

	private isMd(f: TAbstractFile | null): f is TFile {
		return f instanceof TFile && f.extension === "md";
	}

	private async ensureBaseline(f: TAbstractFile) {
		if (!this.isMd(f) || this.baselines.has(f.path)) return;
		const n = countWords(await this.plugin.app.vault.cachedRead(f));
		if (!this.baselines.has(f.path)) this.baselines.set(f.path, n);
	}

	private isOpenInEditor(f: TFile): boolean {
		return this.plugin.app.workspace
			.getLeavesOfType("markdown")
			.some((l) => l.view instanceof MarkdownView && l.view.file?.path === f.path);
	}

	private async onModify(f: TAbstractFile) {
		if (!this.isMd(f) || !this.plugin.settings.wordCountEnabled) return;
		const n = countWords(await this.plugin.app.vault.read(f));
		const prev = this.baselines.get(f.path);
		this.baselines.set(f.path, n);
		if (prev === undefined || n === prev) return;
		if (!this.isOpenInEditor(f) || this.plugin.isIndexNote(f)) return;

		const key = todayKey();
		const day = (this.plugin.wordStats[key] ??= { added: 0, removed: 0 });
		const before = day.added;
		if (n > prev) day.added += n - prev;
		else day.removed += prev - n;
		this.plugin.onWordsChanged(before, day.added);
	}
}
