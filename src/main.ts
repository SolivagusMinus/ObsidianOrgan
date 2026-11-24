import {
	App,
	FuzzySuggestModal,
	Menu,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
	moment,
	normalizePath,
	setTooltip,
} from "obsidian";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./calendar-view";
import { BranchLevels } from "./branch-levels";
import { GraphTree } from "./graph";
import { GraphFx } from "./graph-fx";
import { GraphModules } from "./modules";
import { LEVEL_FENCE, stripLevelFence } from "./levels";
import { WordTracker } from "./tracker";
import { StatsData, pluralRu } from "./words";
import {
	BLOCK_START,
	Item,
	RenderOptions,
	applyBlock,
	baseName,
	buildBlock,
	cssString,
	extractBlockBody,
	fillNoteTemplate,
	mergePreserving,
	removeBlock,
	parentPath,
	renderItems,
	sortItems,
} from "./render";
import { DEFAULT_SETTINGS, FolderHubSettings, FolderHubSettingTab } from "./settings";

/** Frontmatter key that marks a note as a folder index. */
export const INDEX_KEY = "folder-index";

export default class FolderHubPlugin extends Plugin {
	settings!: FolderHubSettings;
	wordStats: StatsData = {};
	tracker = new WordTracker(this);
	graphTree = new GraphTree(this);
	graphFx = new GraphFx(this);
	modules = new GraphModules(this);
	private colorSyncTimer: number | null = null;
	levels = new BranchLevels(this);

	private statusEl: HTMLElement | null = null;
	private saveStatsTimer: number | null = null;

	private pending = new Set<string>();
	private flushTimer: number | null = null;
	private highlightTimer: number | null = null;
	private queue: Promise<void> = Promise.resolve();
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new FolderHubSettingTab(this.app, this));

		this.styleEl = document.head.createEl("style", { attr: { id: "folder-hub-dynamic" } });
		this.register(() => this.styleEl?.remove());

		this.levels.start();
		this.modules.start();

		// Index lookups are cached; any change to files or frontmatter clears the cache.
		const clearIndex = () => this.invalidateIndexCache();
		this.registerEvent(this.app.vault.on("create", clearIndex));
		this.registerEvent(this.app.vault.on("delete", clearIndex));
		this.registerEvent(this.app.vault.on("rename", clearIndex));
		this.registerEvent(this.app.metadataCache.on("changed", clearIndex));

		// ---- Calendar & daily word counter
		this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));
		this.addRibbonIcon("calendar-days", "ObsOrg: календарь и счётчик слов", () => void this.activateCalendar());
		this.addCommand({
			id: "set-current-note-as-index",
			name: "Папки: сделать текущую заметку главным файлом папки",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md" || !file.parent || file.parent.isRoot()) return false;
				if (this.findIndex(file.parent) === file) return false;
				if (!checking) void this.setAsIndex(file);
				return true;
			},
		});
		this.addCommand({
			id: "module-from-current-folder",
			name: "Граф: сделать папку текущей заметки модулем",
			checkCallback: (checking) => {
				const folder = this.app.workspace.getActiveFile()?.parent;
				if (!folder || folder.isRoot()) return false;
				if (!checking) void this.toggleFolderModule(folder, true);
				return true;
			},
		});
		this.addCommand({
			id: "toggle-modules",
			name: "Граф: показать/скрыть модули",
			callback: async () => {
				this.settings.modulesEnabled = !this.settings.modulesEnabled;
				await this.saveSettings();
				new Notice(`Модули в графе ${this.settings.modulesEnabled ? "показаны" : "скрыты"}`);
			},
		});
		this.addCommand({
			id: "toggle-skill-tree",
			name: "Граф: включить/выключить дерево прокачки",
			callback: async () => {
				this.settings.skillTreeEnabled = !this.settings.skillTreeEnabled;
				await this.saveSettings();
				new Notice(`Дерево прокачки в графе ${this.settings.skillTreeEnabled ? "включено" : "выключено"}`);
			},
		});
		this.addCommand({
			id: "open-calendar",
			name: "Календарь: открыть календарь и счётчик слов",
			callback: () => void this.activateCalendar(),
		});
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("fh-status", "mod-clickable");
		this.statusEl.addEventListener("click", () => void this.activateCalendar());

		this.addCommand({
			id: "create-index-current-folder",
			name: "Папки: создать/обновить главный файл в папке текущей заметки",
			checkCallback: (checking) => {
				const folder = this.app.workspace.getActiveFile()?.parent;
				if (!folder || folder.isRoot()) return false;
				if (!checking) void this.createIndex(folder, true);
				return true;
			},
		});
		this.addCommand({
			id: "open-index-current-folder",
			name: "Папки: открыть главный файл текущей папки",
			checkCallback: (checking) => {
				const folder = this.app.workspace.getActiveFile()?.parent;
				const index = folder && !folder.isRoot() ? this.findIndex(folder) : null;
				if (!index) return false;
				if (!checking) void this.app.workspace.getLeaf(false).openFile(index);
				return true;
			},
		});
		this.addCommand({
			id: "create-index-all-folders",
			name: "Папки: создать главные файлы во всех папках хранилища",
			callback: () => void this.createAll(),
		});
		this.addCommand({
			id: "update-all-indexes",
			name: "Папки: обновить все главные файлы",
			callback: async () => {
				const n = await this.updateAll(false);
				new Notice(`ObsOrg: обновлено файлов — ${n}`);
			},
		});
		this.addCommand({
			id: "rebuild-all-indexes",
			name: "Папки: перестроить все главные файлы заново (сбросить правки внутри блока)",
			callback: async () => {
				const n = await this.updateAll(true);
				new Notice(`ObsOrg: перестроено файлов — ${n}`);
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (file instanceof TFile) {
					this.fileMenuForNote(menu, file);
					return;
				}
				if (!(file instanceof TFolder) || file.isRoot()) return;
				const index = this.findIndex(file);
				if (index) {
					menu.addItem((i) =>
						i
							.setTitle("Открыть главный файл папки")
							.setIcon("star")
							.onClick(() => this.app.workspace.getLeaf(false).openFile(index)),
					);
					menu.addItem((i) =>
						i
							.setTitle("Обновить главный файл папки")
							.setIcon("refresh-cw")
							.onClick(() => this.enqueue(() => this.updateFolder(file, false))),
					);
				} else {
					menu.addItem((i) =>
						i
							.setTitle("Создать главный файл папки")
							.setIcon("star")
							.onClick(() => this.createIndex(file, true)),
					);
				}
				if (file.children.some((c) => c instanceof TFile && c.extension === "md")) {
					menu.addItem((i) =>
						i
							.setTitle("Выбрать главный файл…")
							.setIcon("list-checks")
							.onClick(() => new ChooseIndexModal(this, file).open()),
					);
				}
				const isModule = !!this.modules.findFolderModule(file);
				menu.addItem((i) =>
					i
						.setTitle(isModule ? "Убрать модуль графа" : "Сделать модулем графа")
						.setIcon(isModule ? "circle-off" : "circle-dashed")
						.onClick(() => this.toggleFolderModule(file, !isModule)),
				);
			}),
		);

		// Vault events fire for every file during startup, so subscribe only once
		// the workspace is ready.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on("create", (f) => this.onCreate(f)));
			this.registerEvent(this.app.vault.on("delete", (f) => this.onDelete(f)));
			this.registerEvent(this.app.vault.on("rename", (f, old) => this.onRename(f, old)));
			this.tracker.start();
			this.updateStatusBar();
			this.graphTree.start();
			this.graphFx.start();
			// Catch up with changes made while Obsidian was closed.
			void this.updateAll(false);
			this.refreshHighlight();
		});
	}

	onunload() {
		this.graphTree.stop();
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
		if (this.saveStatsTimer !== null) {
			window.clearTimeout(this.saveStatsTimer);
			void this.persist();
		}
	}

	async loadSettings() {
		const raw = ((await this.loadData()) ?? {}) as Partial<FolderHubSettings> & { wordStats?: StatsData };
		const { wordStats, ...settings } = raw;
		this.wordStats = wordStats ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
		// Copy nested objects so DEFAULT_SETTINGS is never mutated.
		this.settings.branchDirections = { ...(settings.branchDirections ?? {}) };
		this.settings.managedGraphQueries = [...(settings.managedGraphQueries ?? [])];
		this.settings.modules = (settings.modules ?? []).map((m) => ({ ...m }));
		this.lastCalendarSig = this.calendarSignature();
		this.lastTreeSig = this.treeSignature();
	}

	/** Settings and word statistics live together in data.json. */
	private async persist() {
		await this.saveData({ ...this.settings, wordStats: this.wordStats });
	}

	async saveSettings() {
		await this.persist();
		this.refreshHighlight();
		this.updateStatusBar();
		this.graphFx.sync();
		const treeSig = this.treeSignature();
		if (treeSig !== this.lastTreeSig) {
			this.lastTreeSig = treeSig;
			this.graphTree.refresh();
		}
		// Re-render the calendar only when settings it depends on changed.
		const sig = this.calendarSignature();
		if (sig !== this.lastCalendarSig) {
			this.lastCalendarSig = sig;
			this.calendarViews().forEach((v) => v.render());
		}
	}

	private lastCalendarSig = "";
	private lastTreeSig = "";
	private treeSignature(): string {
		const s = this.settings;
		return JSON.stringify([
			s.skillTreeEnabled, s.skillTreeStyle, s.skillTreeStep, s.skillTreeSpread,
			s.skillTreePinFiles, s.branchDirections, s.indexName, s.excludedFolders, s.graphFreeze,
			s.moduleSeparate, s.moduleGap, s.moduleSize, s.modulesEnabled, s.modules.map((m) => [m.id, m.kind, m.value]),
		]);
	}
	private calendarSignature(): string {
		const s = this.settings;
		return JSON.stringify([s.dailyGoal, s.animations, s.dailyFolder, s.dailyFormat, s.tag, s.indexName]);
	}

	// ------------------------------------------------------------ modules

	/** Call after editing modules: refreshes membership, colours and the graph overlay. */
	async onModulesChanged() {
		this.modules.invalidate();
		await this.saveSettings();
		this.graphFx.sync();
		if (this.colorSyncTimer !== null) window.clearTimeout(this.colorSyncTimer);
		this.colorSyncTimer = window.setTimeout(() => {
			this.colorSyncTimer = null;
			void this.graphTree.syncColorGroups(false, false);
		}, 1000);
	}

	async toggleFolderModule(folder: TFolder, on: boolean) {
		if (on) {
			const m = this.modules.addFolderModule(folder);
			new Notice(`Модуль «${m.name}» добавлен в граф`);
		} else {
			const m = this.modules.findFolderModule(folder);
			if (m) this.modules.remove(m.id);
			new Notice(`Модуль «${folder.name}» убран из графа`);
		}
		await this.onModulesChanged();
	}

	// ------------------------------------------------------ words & calendar

	calendarViews(): CalendarView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_CALENDAR)
			.map((l) => l.view)
			.filter((v): v is CalendarView => v instanceof CalendarView);
	}

	async activateCalendar() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	isIndexNote(file: TFile): boolean {
		return !!file.parent && !file.parent.isRoot() && this.findIndex(file.parent) === file;
	}

	/** Called by the tracker after today's word count changed. */
	onWordsChanged(before: number, after: number) {
		if (this.saveStatsTimer !== null) window.clearTimeout(this.saveStatsTimer);
		this.saveStatsTimer = window.setTimeout(() => {
			this.saveStatsTimer = null;
			void this.persist();
		}, 3000);

		this.updateStatusBar(true);
		const views = this.calendarViews();
		views.forEach((v) => v.updateToday());

		const goal = this.settings.dailyGoal;
		if (goal > 0 && before < goal && after >= goal) {
			views.forEach((v) => v.celebrate());
			new Notice(`🎉 Цель на сегодня выполнена: ${after.toLocaleString()} ${pluralRu(after, ["слово", "слова", "слов"])}!`);
		}
	}

	private updateStatusBar(pulse = false) {
		const el = this.statusEl;
		if (!el) return;
		const show = this.settings.wordCountEnabled && this.settings.showStatusBar;
		el.toggle(show);
		if (!show) return;
		const added = this.tracker.today().added;
		const goal = this.settings.dailyGoal;
		el.setText(goal > 0 ? `✍ ${added.toLocaleString()} / ${goal.toLocaleString()}` : `✍ ${added.toLocaleString()}`);
		el.toggleClass("is-done", goal > 0 && added >= goal);
		setTooltip(el, "Слов написано сегодня. Нажмите, чтобы открыть календарь.", { placement: "top" });
		if (pulse && this.settings.animations) {
			el.removeClass("fh-pulse");
			void el.offsetWidth;
			el.addClass("fh-pulse");
		}
	}

	async resetStats() {
		this.wordStats = {};
		await this.persist();
		this.updateStatusBar();
		this.calendarViews().forEach((v) => v.render());
	}

	// ---------------------------------------------------------------- events

	private onCreate(file: TAbstractFile) {
		if (file instanceof TFolder && this.settings.autoCreate && !this.isExcluded(file)) {
			// Small delay: sync tools may deliver the folder's existing index right
			// after the folder itself, and we don't want a duplicate.
			window.setTimeout(() => {
				const folder = this.app.vault.getAbstractFileByPath(file.path);
				if (folder instanceof TFolder && !this.findIndex(folder)) {
					void this.createIndex(folder, false);
				}
			}, 800);
		}
		this.scheduleAncestors(parentPath(file.path));
	}

	private onDelete(file: TAbstractFile) {
		this.scheduleAncestors(parentPath(file.path));
		this.refreshHighlight();
	}

	private onRename(file: TAbstractFile, oldPath: string) {
		if (file instanceof TFolder && this.settings.renameWithFolder) {
			const oldName = baseName(oldPath);
			if (oldName !== file.name) {
				// Obsidian also fires rename for every child; let that settle first.
				window.setTimeout(() => void this.renameIndexWithFolder(file, oldName), 150);
			}
		}
		const oldParent = parentPath(oldPath);
		const newParent = parentPath(file.path);
		this.scheduleAncestors(oldParent);
		if (newParent !== oldParent) this.scheduleAncestors(newParent);
		this.refreshHighlight();
	}

	private async renameIndexWithFolder(folder: TFolder, oldFolderName: string) {
		if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof TFolder)) return;
		const oldIndex = this.app.vault.getAbstractFileByPath(
			normalizePath(`${folder.path}/${this.indexNameFor(oldFolderName)}.md`),
		);
		const newPath = this.expectedIndexPath(folder);
		if (!(oldIndex instanceof TFile) || oldIndex.path === newPath) return;
		if (this.app.vault.getAbstractFileByPath(newPath)) return;
		try {
			// fileManager.renameFile also rewrites links to the note.
			await this.app.fileManager.renameFile(oldIndex, newPath);
		} catch (e) {
			console.error("ObsOrg: failed to rename index", e);
		}
	}

	// ------------------------------------------------------------ scheduling

	/** Schedules an update for the folder at `path` and all its ancestors. */
	private scheduleAncestors(path: string) {
		let p = path;
		while (p && p !== "/") {
			this.pending.add(p);
			p = parentPath(p);
		}
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			const paths = [...this.pending];
			this.pending.clear();
			// Deepest folders first, so sub-index notes exist before parents link them.
			paths.sort((a, b) => b.split("/").length - a.split("/").length);
			for (const p of paths) {
				const folder = this.app.vault.getAbstractFileByPath(p);
				if (folder instanceof TFolder) this.enqueue(() => this.updateFolder(folder, false));
			}
		}, 400);
	}

	/** Serialises writes so two updates never race on the same note. */
	private enqueue(task: () => Promise<unknown>): Promise<void> {
		this.queue = this.queue.then(task).then(
			() => undefined,
			(e) => console.error("Folder Hub:", e),
		);
		return this.queue;
	}

	// --------------------------------------------------------- index lookup

	indexNameFor(folderName: string): string {
		const name = this.settings.indexName.replace(/\{\{folder\}\}/g, folderName).trim();
		return name || folderName;
	}

	expectedIndexPath(folder: TFolder): string {
		return normalizePath(`${folder.path}/${this.indexNameFor(folder.name)}.md`);
	}

	/** Folder path → index note path (null = none). Cleared on any vault/metadata change. */
	private indexCache = new Map<string, string | null>();
	/** Choices made in this session, before the metadata cache has caught up. */
	private indexOverride = new Map<string, string>();

	/**
	 * The folder's index note. An explicit choice wins (frontmatter
	 * `folder-index: true`, or a choice just made from the menu); otherwise
	 * the note named after the folder, unless it was explicitly demoted
	 * (`folder-index: false`).
	 */
	findIndex(folder: TFolder): TFile | null {
		if (folder.isRoot()) return null;
		const cached = this.indexCache.get(folder.path);
		if (cached !== undefined) {
			if (cached === null) return null;
			const f = this.app.vault.getAbstractFileByPath(cached);
			if (f instanceof TFile && f.parent === folder) return f;
		}
		const found = this.computeIndex(folder);
		this.indexCache.set(folder.path, found?.path ?? null);
		return found;
	}

	private computeIndex(folder: TFolder): TFile | null {
		const flag = (f: TFile) => this.app.metadataCache.getFileCache(f)?.frontmatter?.[INDEX_KEY];
		const override = this.indexOverride.get(folder.path);
		if (override) {
			const f = this.app.vault.getAbstractFileByPath(override);
			if (f instanceof TFile && f.parent === folder && flag(f) !== false) return f;
			this.indexOverride.delete(folder.path);
		}
		const expected = this.expectedIndexPath(folder);
		const flagged: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md" && flag(child) === true) flagged.push(child);
		}
		if (flagged.length) return flagged.find((f) => f.path === expected) ?? flagged[0];
		const byName = this.app.vault.getAbstractFileByPath(expected);
		if (byName instanceof TFile && flag(byName) !== false) return byName;
		return null;
	}

	invalidateIndexCache() {
		this.indexCache.clear();
	}

	/** Makes `file` the index note of its folder; the previous one becomes a plain note. */
	async setAsIndex(file: TFile) {
		const folder = file.parent;
		if (!folder || folder.isRoot() || file.extension !== "md") return;
		const old = this.findIndex(folder);
		if (old === file) {
			new Notice(`«${file.basename}» уже главный файл папки «${folder.name}»`);
			return;
		}
		this.indexOverride.set(folder.path, file.path);
		this.invalidateIndexCache();
		if (old) await this.demoteIndex(old);
		await this.adoptExisting(file);
		this.invalidateIndexCache();
		await this.enqueue(() => this.updateFolder(folder, false));
		this.scheduleAncestors(parentPath(folder.path));
		this.afterIndexChange();
		new Notice(`Главный файл папки «${folder.name}»: ${file.basename}`);
	}

	/** Stops `file` from being an index note (its list is removed, the rest of the note stays). */
	async unsetIndex(file: TFile) {
		const folder = file.parent;
		if (!folder) return;
		this.indexOverride.delete(folder.path);
		await this.demoteIndex(file);
		this.invalidateIndexCache();
		this.scheduleAncestors(parentPath(folder.path));
		this.afterIndexChange();
		new Notice(`«${file.basename}» больше не главный файл папки «${folder.name}»`);
	}

	private async demoteIndex(file: TFile) {
		const tag = this.settings.tag.replace(/^#/, "").trim();
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[INDEX_KEY] = false;
			if (tag && fm.tags !== undefined) {
				const list = Array.isArray(fm.tags) ? fm.tags.map(String) : String(fm.tags).split(/[,\s]+/).filter(Boolean);
				const rest = list.filter((t) => t.replace(/^#/, "") !== tag);
				if (rest.length) fm.tags = rest;
				else delete fm.tags;
			}
			if (Array.isArray(fm.cssclasses)) {
				const rest = fm.cssclasses.filter((c) => c !== "folder-hub-index");
				if (rest.length) fm.cssclasses = rest;
				else delete fm.cssclasses;
			}
		});
		await this.app.vault.process(file, (data) => removeBlock(data));
	}

	/** Right-click / long-press on a note: make it (or stop it being) the folder's index. */
	private fileMenuForNote(menu: Menu, file: TFile) {
		const folder = file.parent;
		if (file.extension !== "md" || !folder || folder.isRoot() || this.isExcluded(folder)) return;
		if (this.findIndex(folder) === file) {
			menu.addItem((i) =>
				i
					.setTitle("Перестать быть главным файлом")
					.setIcon("star-off")
					.onClick(() => this.unsetIndex(file)),
			);
		} else {
			menu.addItem((i) =>
				i
					.setTitle(`Сделать главным файлом папки «${folder.name}»`)
					.setIcon("star")
					.onClick(() => this.setAsIndex(file)),
			);
		}
	}

	/** Everything that depends on which notes are index notes. */
	private afterIndexChange() {
		this.refreshHighlight();
		this.graphTree.refresh();
		this.levels.scheduleRefresh();
	}

	isExcluded(folder: TFolder): boolean {
		if (folder.isRoot()) return true;
		const list = this.settings.excludedFolders
			.split("\n")
			.map((s) => normalizePath(s.trim()))
			.filter((s) => s && s !== "/");
		return list.some((p) => folder.path === p || folder.path.startsWith(p + "/"));
	}

	private allFolders(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot());
	}

	// -------------------------------------------------------- index content

	private fileAllowed(file: TFile): boolean {
		if (!this.settings.includeNonMarkdown && file.extension !== "md") return false;
		const excluded = this.settings.excludedExtensions
			.split(",")
			.map((s) => s.trim().replace(/^\./, "").toLowerCase())
			.filter(Boolean);
		return !excluded.includes(file.extension.toLowerCase());
	}

	private collectItems(folder: TFolder, index: TFile): Item[] {
		const files = new Map<string, { file: TFile; sub: boolean }>();
		const walk = (dir: TFolder) => {
			for (const child of dir.children) {
				if (child instanceof TFile) {
					if (child === index) continue;
					// Index notes of nested folders are handled in the folder branch.
					if (dir !== folder && this.findIndex(dir) === child) continue;
					if (this.fileAllowed(child)) files.set(child.path, { file: child, sub: false });
				} else if (child instanceof TFolder) {
					if (this.isExcluded(child)) continue;
					const sub = this.findIndex(child);
					if (sub && this.settings.linkSubfolderIndexes) {
						files.set(sub.path, { file: sub, sub: true });
					}
					if (this.settings.includeNested) walk(child);
				}
			}
		};
		walk(folder);

		const items: Item[] = [];
		for (const { file, sub } of files.values()) {
			items.push({
				linktext: this.app.metadataCache.fileToLinktext(file, index.path, true),
				name: file.basename,
				ext: file.extension,
				path: file.path,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				isSubIndex: sub,
			});
		}
		return sortItems(items, this.settings.sortBy, this.settings.sortOrder, this.settings.subfoldersFirst);
	}

	private renderOptions(): RenderOptions {
		const fmt = this.settings.dateFormat || "YYYY-MM-DD";
		return {
			layout: this.settings.layout,
			columns: this.settings.columns,
			tableHeaders: this.settings.tableHeaders,
			itemTemplate: this.settings.itemTemplate,
			formatDate: (ms) => moment(ms).format(fmt),
		};
	}

	private computeBody(index: TFile, items: Item[], content: string, force: boolean): string[] {
		const opts = this.renderOptions();
		const raw = extractBlockBody(content);
		const existing = raw ? stripLevelFence(raw) : null;
		const preserve =
			!force && this.settings.preserveEdits && this.settings.layout !== "table" && existing !== null;
		const body = preserve
			? mergePreserving(
					existing,
					items,
					(linkpath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, index.path)?.path ?? null,
					opts,
				)
			: renderItems(items, opts);
		// The level card is a constant code block, so it never causes extra writes.
		return this.settings.branchLevels ? [...LEVEL_FENCE, ...body] : body;
	}

	/** Rewrites the managed block of the folder's index note. Returns true if it changed. */
	async updateFolder(folder: TFolder, force: boolean): Promise<boolean> {
		if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof TFolder)) return false;
		if (this.isExcluded(folder)) return false;
		const index = this.findIndex(folder);
		if (!index) return false;

		const items = this.collectItems(folder, index);
		const current = await this.app.vault.read(index);
		const next = applyBlock(current, this.computeBody(index, items, current, force));
		if (next === current) return false;

		await this.app.vault.process(index, (data) =>
			applyBlock(data, this.computeBody(index, items, data, force)),
		);
		return true;
	}

	async updateAll(force: boolean): Promise<number> {
		let changed = 0;
		const folders = this.allFolders().sort(
			(a, b) => b.path.split("/").length - a.path.split("/").length,
		);
		for (const folder of folders) {
			await this.enqueue(async () => {
				if (await this.updateFolder(folder, force)) changed++;
			});
		}
		return changed;
	}

	async createIndex(folder: TFolder, open: boolean): Promise<TFile | null> {
		if (folder.isRoot()) return null;
		let index = this.findIndex(folder);

		if (!index) {
			const path = this.expectedIndexPath(folder);
			try {
				// Create with an empty block first so the index exists before we
				// compute links relative to it.
				const content = fillNoteTemplate(
					this.settings.newNoteTemplate,
					{
						folder: folder.name,
						tag: this.settings.tag.replace(/^#/, "").trim(),
						date: moment().format(this.settings.dateFormat || "YYYY-MM-DD"),
					},
					buildBlock([]),
				);
				index = await this.app.vault.create(path, content);
			} catch (e) {
				// Most likely the file appeared in the meantime (sync, double event).
				const existing = this.app.vault.getAbstractFileByPath(path);
				if (!(existing instanceof TFile)) {
					console.error("ObsOrg: failed to create index", e);
					new Notice(`ObsOrg: не удалось создать ${path}`);
					return null;
				}
				index = existing;
			}
		} else {
			await this.adoptExisting(index);
		}

		await this.enqueue(() => this.updateFolder(folder, false));
		this.scheduleAncestors(parentPath(folder.path));
		this.refreshHighlight();
		if (open) await this.app.workspace.getLeaf(false).openFile(index);
		return index;
	}

	/** Makes an existing note a proper index: frontmatter flag, tag, block. */
	private async adoptExisting(index: TFile) {
		const tag = this.settings.tag.replace(/^#/, "").trim();
		await this.app.fileManager.processFrontMatter(index, (fm: Record<string, unknown>) => {
			fm[INDEX_KEY] = true;
			if (tag) {
				const tags = fm.tags;
				const list = Array.isArray(tags)
					? tags.map(String)
					: typeof tags === "string"
						? tags.split(/[,\s]+/).filter(Boolean)
						: [];
				if (!list.map((t) => t.replace(/^#/, "")).includes(tag)) list.push(tag);
				fm.tags = list;
			}
			const css = Array.isArray(fm.cssclasses) ? fm.cssclasses.map(String) : fm.cssclasses ? [String(fm.cssclasses)] : [];
			if (!css.includes("folder-hub-index")) css.push("folder-hub-index");
			fm.cssclasses = css;
		});
		const content = await this.app.vault.read(index);
		if (!content.includes(BLOCK_START)) {
			await this.app.vault.process(index, (data) => applyBlock(data, []));
		}
	}

	async createAll() {
		let created = 0;
		for (const folder of this.allFolders()) {
			if (this.isExcluded(folder) || this.findIndex(folder)) continue;
			if (await this.createIndex(folder, false)) created++;
		}
		new Notice(`ObsOrg: создано главных файлов — ${created}`);
	}

	// ------------------------------------------------------------ highlight

	refreshHighlight() {
		if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
		this.highlightTimer = window.setTimeout(() => {
			this.highlightTimer = null;
			if (this.styleEl) this.styleEl.textContent = this.buildCss();
		}, 200);
	}

	private buildCss(): string {
		const s = this.settings;
		const color = /^#[0-9a-fA-F]{3,8}$/.test(s.highlightColor) ? s.highlightColor : "#e5a50a";
		const rules: string[] = [`body { --folder-hub-color: ${color}; }`];
		if (!s.highlightEnabled) return rules.join("\n");

		const filePaths: string[] = [];
		const folderPaths: string[] = [];
		for (const folder of this.allFolders()) {
			const index = this.findIndex(folder);
			if (!index) continue;
			filePaths.push(index.path);
			folderPaths.push(folder.path);
		}

		const weight = s.highlightBold ? "font-weight: 600;" : "";
		const icon = s.highlightIcon ? `content: ${cssString(s.highlightIcon + " ")};` : "";

		// Note title inside the editor (via cssclasses: folder-hub-index).
		rules.push(`.folder-hub-index .inline-title { color: var(--folder-hub-color); }`);
		if (icon) rules.push(`.folder-hub-index .inline-title::before { ${icon} }`);

		if (filePaths.length) {
			const sel = (suffix: string) =>
				filePaths.map((p) => `.nav-file-title[data-path=${cssString(p)}]${suffix}`).join(",\n");
			rules.push(`${sel("")} { color: var(--folder-hub-color); ${weight} }`);
			if (icon) rules.push(`${sel(" .nav-file-title-content::before")} { ${icon} }`);
		}
		if (s.highlightFolders && folderPaths.length) {
			const sel = folderPaths
				.map((p) => `.nav-folder-title[data-path=${cssString(p)}]`)
				.join(",\n");
			rules.push(`${sel} { color: var(--folder-hub-color); }`);
		}
		return rules.join("\n");
	}

	// ---------------------------------------------------------------- graph

	/** Adds the index-note colour group ("tag:#<tag>") to the graph. */
	async addGraphColorGroup() {
		await this.graphTree.syncColorGroups(true, true);
	}
}

/** Picker of notes in a folder, to choose its index note. */
class ChooseIndexModal extends FuzzySuggestModal<TFile> {
	constructor(
		private plugin: FolderHubPlugin,
		private folder: TFolder,
	) {
		super(plugin.app);
		this.setPlaceholder(`Главный файл папки «${folder.name}»`);
	}

	getItems(): TFile[] {
		const current = this.plugin.findIndex(this.folder);
		return this.folder.children
			.filter((c): c is TFile => c instanceof TFile && c.extension === "md")
			.sort((a, b) => (a === current ? -1 : b === current ? 1 : a.basename.localeCompare(b.basename)));
	}

	getItemText(file: TFile): string {
		return file === this.plugin.findIndex(this.folder) ? `★ ${file.basename} (сейчас главный)` : file.basename;
	}

	onChooseItem(file: TFile): void {
		void this.plugin.setAsIndex(file);
	}
}
