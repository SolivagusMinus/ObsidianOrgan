import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice, TFile, TFolder } from "obsidian";
import type FolderHubPlugin from "./main";
import { LevelInfo, branchXp, levelFromXp } from "./levels";
import { pluralRu } from "./words";

export interface BranchStats {
	folder: TFolder;
	words: number;
	notes: number;
	info: LevelInfo;
	/** False while some notes haven't been counted yet. */
	complete: boolean;
}

const NOTES: [string, string, string] = ["заметка", "заметки", "заметок"];
const WORDS: [string, string, string] = ["слово", "слова", "слов"];

/** Live level card rendered in place of the ```folder-hub-level``` block. */
class LevelCard extends MarkdownRenderChild {
	private shownLevel = -1;

	constructor(
		el: HTMLElement,
		private levels: BranchLevels,
		private sourcePath: string,
	) {
		super(el);
	}

	onload() {
		this.levels.cards.add(this);
		this.update();
	}

	onunload() {
		this.levels.cards.delete(this);
	}

	update() {
		const file = this.levels.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		const folder = file instanceof TFile ? file.parent : null;
		const el = this.containerEl;
		el.toggleClass("fh-no-anim", !this.levels.plugin.settings.animations);
		if (!folder || folder.isRoot()) {
			el.empty();
			return;
		}
		const st = this.levels.stats(folder);
		const levelChanged = this.shownLevel !== -1 && st.info.level !== this.shownLevel;
		const first = this.shownLevel === -1;
		this.shownLevel = st.info.level;

		if (first || !el.querySelector(".fh-level-card")) {
			el.empty();
			const card = el.createDiv({ cls: "fh-level-card" });
			card.createDiv({ cls: "fh-level-badge" });
			const body = card.createDiv({ cls: "fh-level-body" });
			body.createDiv({ cls: "fh-level-title" });
			body.createDiv({ cls: "fh-level-bar" }).createDiv({ cls: "fh-level-fill" });
			body.createDiv({ cls: "fh-level-meta" });
			el.createDiv({ cls: "fh-level-subs" });
		}

		const badge = el.querySelector<HTMLElement>(".fh-level-badge")!;
		badge.setText(String(st.info.level));
		if (levelChanged) {
			badge.removeClass("fh-level-up");
			void badge.offsetWidth;
			badge.addClass("fh-level-up");
		}
		el.querySelector(".fh-level-title")!.setText(`Уровень ${st.info.level} · ${folder.name}`);
		const fill = el.querySelector<HTMLElement>(".fh-level-fill")!;
		const pct = `${Math.round(st.info.progress * 100)}%`;
		if (first) {
			fill.style.width = "0%";
			window.requestAnimationFrame(() => window.requestAnimationFrame(() => (fill.style.width = pct)));
		} else {
			fill.style.width = pct;
		}
		const toNext = st.info.next - st.info.xp;
		el.querySelector(".fh-level-meta")!.setText(
			st.complete
				? `${st.info.xp.toLocaleString()} / ${st.info.next.toLocaleString()} XP · до ${st.info.level + 1}-го: ${toNext.toLocaleString()} · ` +
						`${st.notes} ${pluralRu(st.notes, NOTES)} · ${st.words.toLocaleString()} ${pluralRu(st.words, WORDS)}`
				: "Подсчёт слов…",
		);

		// Sub-branches with their own level.
		const subsEl = el.querySelector<HTMLElement>(".fh-level-subs")!;
		subsEl.empty();
		const subs = this.levels.subBranches(folder);
		subs.forEach((sub, i) => {
			const row = subsEl.createDiv({ cls: "fh-level-sub" });
			row.style.setProperty("--i", String(i));
			row.createSpan({ cls: "fh-level-sub-badge", text: String(sub.info.level) });
			row.createSpan({ cls: "fh-level-sub-name", text: sub.folder.name });
			const bar = row.createDiv({ cls: "fh-level-bar is-small" }).createDiv({ cls: "fh-level-fill" });
			bar.style.width = `${Math.round(sub.info.progress * 100)}%`;
		});
	}
}

/**
 * Branch XP = words in all notes of the folder subtree + a bonus per note.
 * Word counts come from the tracker's per-note cache, which is filled in the
 * background at startup and kept current on every save.
 */
export class BranchLevels {
	cards = new Set<LevelCard>();
	private lastLevels = new Map<string, number>();
	private updateTimer: number | null = null;

	constructor(public plugin: FolderHubPlugin) {}

	start() {
		this.plugin.registerMarkdownCodeBlockProcessor(
			"folder-hub-level",
			(_src: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				if (!this.plugin.settings.branchLevels) return;
				ctx.addChild(new LevelCard(el, this, ctx.sourcePath));
			},
		);
	}

	stats(folder: TFolder): BranchStats {
		let words = 0;
		let notes = 0;
		let complete = this.plugin.tracker.ready;
		const walk = (dir: TFolder) => {
			for (const child of dir.children) {
				if (child instanceof TFolder) {
					if (!this.plugin.isExcluded(child)) walk(child);
				} else if (child instanceof TFile && child.extension === "md" && !this.plugin.isIndexNote(child)) {
					notes++;
					const w = this.plugin.tracker.wordsOf(child.path);
					if (w === undefined) complete = false;
					else words += w;
				}
			}
		};
		walk(folder);
		return { folder, words, notes, info: levelFromXp(branchXp(words, notes)), complete };
	}

	/** Nearest descendant folders that have their own index note. */
	subBranches(folder: TFolder): BranchStats[] {
		const out: BranchStats[] = [];
		const walk = (dir: TFolder) => {
			for (const child of dir.children) {
				if (!(child instanceof TFolder) || this.plugin.isExcluded(child)) continue;
				if (this.plugin.findIndex(child)) out.push(this.stats(child));
				else walk(child);
			}
		};
		walk(folder);
		return out.sort((a, b) => b.info.xp - a.info.xp);
	}

	/** Top-level branches (for the calendar panel). */
	topBranches(): BranchStats[] {
		return this.subBranches(this.plugin.app.vault.getRoot());
	}

	/** Called once the tracker has counted every note. */
	onReady() {
		for (const folder of this.indexFolders()) this.lastLevels.set(folder.path, this.stats(folder).info.level);
		this.refreshViews();
	}

	/** Called after a note's word count changed. */
	onWordsUpdated(file: TFile) {
		if (!this.plugin.tracker.ready || !this.plugin.settings.branchLevels) return;
		for (let dir = file.parent; dir && !dir.isRoot(); dir = dir.parent) {
			const index = this.plugin.findIndex(dir);
			if (!index) continue;
			const level = this.stats(dir).info.level;
			const prev = this.lastLevels.get(dir.path);
			this.lastLevels.set(dir.path, level);
			if (prev !== undefined && level > prev) {
				new Notice(`⬆ Ветка «${dir.name}» достигла ${level}-го уровня!`, 6000);
				this.plugin.graphFx.burst(index.path);
			}
		}
		this.scheduleRefresh();
	}

	scheduleRefresh() {
		if (this.updateTimer !== null) window.clearTimeout(this.updateTimer);
		this.updateTimer = window.setTimeout(() => {
			this.updateTimer = null;
			this.refreshViews();
		}, 1200);
	}

	refreshViews() {
		this.cards.forEach((c) => c.update());
		this.plugin.calendarViews().forEach((v) => v.renderBranches());
	}

	private indexFolders(): TFolder[] {
		return this.plugin.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && !!this.plugin.findIndex(f));
	}
}
