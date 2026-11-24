import { App, PluginSettingTab, Setting } from "obsidian";
import type FolderHubPlugin from "./main";
import type { Layout, SortBy, SortOrder } from "./render";
import { DIRECTIONS, TreeStyle } from "./skilltree";

export interface FolderHubSettings {
	// Creation
	autoCreate: boolean;
	indexName: string;
	newNoteTemplate: string;
	renameWithFolder: boolean;
	tag: string;

	// Format
	layout: Layout;
	columns: number;
	tableHeaders: string;
	itemTemplate: string;
	dateFormat: string;
	preserveEdits: boolean;
	sortBy: SortBy;
	sortOrder: SortOrder;
	subfoldersFirst: boolean;

	// What to include
	includeNonMarkdown: boolean;
	excludedExtensions: string;
	linkSubfolderIndexes: boolean;
	includeNested: boolean;
	excludedFolders: string;

	// Highlight
	highlightEnabled: boolean;
	highlightColor: string;
	highlightIcon: string;
	highlightBold: boolean;
	highlightFolders: boolean;

	// Word counter & calendar
	wordCountEnabled: boolean;
	dailyGoal: number;
	showStatusBar: boolean;
	animations: boolean;
	dailyFolder: string;
	dailyFormat: string;
	dailyTemplate: string;

	// Graph: skill tree
	skillTreeEnabled: boolean;
	skillTreeStyle: TreeStyle;
	skillTreeStep: number;
	skillTreeSpread: number;
	skillTreePinFiles: boolean;
	/** Top-level folder name → key of DIRECTIONS ("auto" when absent). */
	branchDirections: Record<string, string>;
	branchColors: boolean;
	/** Colour-group queries this plugin wrote to graph.json (so it can replace them). */
	managedGraphQueries: string[];
}

export const DEFAULT_NOTE_TEMPLATE = `---
tags:
  - {{tag}}
folder-index: true
cssclasses:
  - folder-hub-index
---

{{list}}
`;

export const DEFAULT_SETTINGS: FolderHubSettings = {
	autoCreate: true,
	indexName: "{{folder}}",
	newNoteTemplate: DEFAULT_NOTE_TEMPLATE,
	renameWithFolder: true,
	tag: "folder-index",

	layout: "list",
	columns: 3,
	tableHeaders: "Файлы",
	itemTemplate: "- {{link}}",
	dateFormat: "YYYY-MM-DD",
	preserveEdits: true,
	sortBy: "name",
	sortOrder: "asc",
	subfoldersFirst: true,

	includeNonMarkdown: true,
	excludedExtensions: "",
	linkSubfolderIndexes: true,
	includeNested: false,
	excludedFolders: "",

	highlightEnabled: true,
	highlightColor: "#e5a50a",
	highlightIcon: "★",
	highlightBold: true,
	highlightFolders: false,

	wordCountEnabled: true,
	dailyGoal: 500,
	showStatusBar: true,
	animations: true,
	dailyFolder: "",
	dailyFormat: "",
	dailyTemplate: "",

	skillTreeEnabled: true,
	skillTreeStyle: "radial",
	skillTreeStep: 300,
	skillTreeSpread: 110,
	skillTreePinFiles: false,
	branchDirections: {},
	branchColors: true,
	managedGraphQueries: [],
};

export class FolderHubSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolderHubPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Создание главного файла").setHeading();

		new Setting(containerEl)
			.setName("Создавать автоматически")
			.setDesc("При создании новой папки внутри неё сразу появляется главный файл.")
			.addToggle((t) =>
				t.setValue(s.autoCreate).onChange(async (v) => {
					s.autoCreate = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Имя главного файла")
			.setDesc("{{folder}} — имя папки. Например «{{folder}}» или «_{{folder}}» или «{{folder}} (оглавление)».")
			.addText((t) =>
				t.setPlaceholder("{{folder}}").setValue(s.indexName).onChange(async (v) => {
					s.indexName = v || "{{folder}}";
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Переименовывать вместе с папкой")
			.setDesc("Переименовали папку — главный файл переименуется следом (ссылки на него обновятся).")
			.addToggle((t) =>
				t.setValue(s.renameWithFolder).onChange(async (v) => {
					s.renameWithFolder = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Тег главных файлов")
			.setDesc("Добавляется в свойства главного файла. Нужен для раскраски в графе (запрос tag:#тег).")
			.addText((t) =>
				t.setPlaceholder("folder-index").setValue(s.tag).onChange(async (v) => {
					s.tag = v.replace(/^#/, "").trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Шаблон нового главного файла")
			.setDesc(
				"{{list}} — место для списка ссылок, {{folder}} — имя папки, {{tag}} — тег, {{date}} — дата создания. " +
					"Всё вне списка можно свободно редактировать.",
			)
			.addTextArea((t) => {
				t.setValue(s.newNoteTemplate).onChange(async (v) => {
					s.newNoteTemplate = v;
					await save();
				});
				t.inputEl.rows = 9;
				t.inputEl.addClass("folder-hub-textarea");
			})
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Вернуть шаблон по умолчанию")
					.onClick(async () => {
						s.newNoteTemplate = DEFAULT_NOTE_TEMPLATE;
						await save();
						this.display();
					}),
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Как выглядит список").setHeading();

		new Setting(containerEl)
			.setName("Раскладка")
			.setDesc("Как записывать ссылки [[...]] на файлы папки.")
			.addDropdown((d) =>
				d
					.addOptions({
						list: "Столбик (маркированный список)",
						numbered: "Нумерованный список",
						table: "Таблица в несколько колонок",
						custom: "Свой шаблон строки",
					})
					.setValue(s.layout)
					.onChange(async (v) => {
						s.layout = v as Layout;
						await save();
						this.display();
					}),
			);

		if (s.layout === "table") {
			new Setting(containerEl)
				.setName("Количество колонок")
				.addSlider((sl) =>
					sl
						.setLimits(1, 6, 1)
						.setValue(s.columns)
						.setDynamicTooltip()
						.onChange(async (v) => {
							s.columns = v;
							await save();
						}),
				);
			new Setting(containerEl)
				.setName("Заголовки колонок")
				.setDesc("Через запятую. Пустые — без подписи.")
				.addText((t) =>
					t.setValue(s.tableHeaders).onChange(async (v) => {
						s.tableHeaders = v;
						await save();
					}),
				);
		}

		if (s.layout === "custom") {
			new Setting(containerEl)
				.setName("Шаблон строки")
				.setDesc(
					"{{link}} — ссылка [[...]], {{name}} — имя, {{ext}} — расширение, {{path}} — путь, " +
						"{{n}} — номер, {{ctime}}/{{mtime}} — даты создания/изменения, {{type}} — file/folder. " +
						"Пример: «- [ ] {{link}} ({{ctime}})».",
				)
				.addText((t) =>
					t.setValue(s.itemTemplate).onChange(async (v) => {
						s.itemTemplate = v;
						await save();
					}),
				);
			new Setting(containerEl)
				.setName("Формат даты")
				.setDesc("Формат moment.js, например YYYY-MM-DD или DD.MM.YYYY.")
				.addText((t) =>
					t.setValue(s.dateFormat).onChange(async (v) => {
						s.dateFormat = v;
						await save();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Сохранять ручные правки внутри списка")
			.setDesc(
				"Можно менять порядок строк, дописывать пояснения рядом со ссылками, вставлять заголовки — " +
					"плагин только добавит новые файлы в конец и уберёт строки удалённых. " +
					"Выключите, чтобы список всегда пересобирался с сортировкой. (Для таблицы всегда пересобирается.)",
			)
			.addToggle((t) =>
				t.setValue(s.preserveEdits).onChange(async (v) => {
					s.preserveEdits = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Сортировка")
			.addDropdown((d) =>
				d
					.addOptions({ name: "По имени", ctime: "По дате создания", mtime: "По дате изменения" })
					.setValue(s.sortBy)
					.onChange(async (v) => {
						s.sortBy = v as SortBy;
						await save();
					}),
			)
			.addDropdown((d) =>
				d
					.addOptions({ asc: "По возрастанию", desc: "По убыванию" })
					.setValue(s.sortOrder)
					.onChange(async (v) => {
						s.sortOrder = v as SortOrder;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Подпапки сначала")
			.setDesc("Ссылки на главные файлы подпапок — в начале списка.")
			.addToggle((t) =>
				t.setValue(s.subfoldersFirst).onChange(async (v) => {
					s.subfoldersFirst = v;
					await save();
				}),
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Какие файлы попадают в список").setHeading();

		new Setting(containerEl)
			.setName("Не только заметки")
			.setDesc("Включать картинки, PDF, canvas и т.д. Выключено — только .md.")
			.addToggle((t) =>
				t.setValue(s.includeNonMarkdown).onChange(async (v) => {
					s.includeNonMarkdown = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Исключить расширения")
			.setDesc("Через запятую, например: png, jpg, pdf")
			.addText((t) =>
				t.setValue(s.excludedExtensions).onChange(async (v) => {
					s.excludedExtensions = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Связывать с подпапками")
			.setDesc("Добавлять ссылку на главный файл каждой подпапки — в графе получится дерево: Меню → Подменю → файлы.")
			.addToggle((t) =>
				t.setValue(s.linkSubfolderIndexes).onChange(async (v) => {
					s.linkSubfolderIndexes = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Включать файлы из вложенных папок")
			.setDesc("Перечислять в главном файле вообще все файлы, включая файлы подпапок любой глубины.")
			.addToggle((t) =>
				t.setValue(s.includeNested).onChange(async (v) => {
					s.includeNested = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Исключённые папки")
			.setDesc("По одной на строку (путь от корня хранилища). В них и их подпапках главные файлы не создаются.")
			.addTextArea((t) => {
				t.setPlaceholder("Templates\nAttachments").setValue(s.excludedFolders).onChange(async (v) => {
					s.excludedFolders = v;
					await save();
				});
				t.inputEl.rows = 4;
			});

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Выделение главного файла").setHeading();

		new Setting(containerEl)
			.setName("Выделять в проводнике файлов")
			.addToggle((t) =>
				t.setValue(s.highlightEnabled).onChange(async (v) => {
					s.highlightEnabled = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Цвет")
			.setDesc("Используется в проводнике, в заголовке заметки и для группы в графе.")
			.addColorPicker((c) =>
				c.setValue(s.highlightColor).onChange(async (v) => {
					s.highlightColor = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Значок")
			.setDesc("Символ перед именем главного файла (★, 📌, 🗂, ◆ …). Пусто — без значка.")
			.addText((t) =>
				t.setValue(s.highlightIcon).onChange(async (v) => {
					s.highlightIcon = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Жирный шрифт")
			.addToggle((t) =>
				t.setValue(s.highlightBold).onChange(async (v) => {
					s.highlightBold = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Подкрашивать и саму папку")
			.setDesc("Папки, в которых есть главный файл, тоже окрашиваются.")
			.addToggle((t) =>
				t.setValue(s.highlightFolders).onChange(async (v) => {
					s.highlightFolders = v;
					await save();
				}),
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Счётчик слов и календарь").setHeading();

		new Setting(containerEl)
			.setName("Считать слова за день")
			.setDesc(
				"Учитываются слова, которые вы пишете в открытой заметке. Изменения от синхронизации и других плагинов не считаются. " +
					"Календарь открывается значком 📅 на боковой ленте или командой «Открыть календарь и счётчик слов».",
			)
			.addToggle((t) =>
				t.setValue(s.wordCountEnabled).onChange(async (v) => {
					s.wordCountEnabled = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Цель на день (слов)")
			.setDesc("0 — без цели.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "0";
				t.setValue(String(s.dailyGoal)).onChange(async (v) => {
					const n = Math.max(0, Math.floor(Number(v)) || 0);
					s.dailyGoal = n;
					await save();
				});
			});

		new Setting(containerEl)
			.setName("Показывать в строке состояния")
			.setDesc("Только на компьютере: «✍ 342 / 500» внизу окна.")
			.addToggle((t) =>
				t.setValue(s.showStatusBar).onChange(async (v) => {
					s.showStatusBar = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Анимации")
			.setDesc("Кольцо прогресса, конфетти, перелистывание месяцев. Если в системе включено «уменьшить движение», анимации отключаются сами.")
			.addToggle((t) =>
				t.setValue(s.animations).onChange(async (v) => {
					s.animations = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Папка заметок дня")
			.setDesc("Пусто — взять из встроенного плагина «Ежедневные заметки».")
			.addText((t) =>
				t.setPlaceholder("Дневник").setValue(s.dailyFolder).onChange(async (v) => {
					s.dailyFolder = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Формат имени заметки дня")
			.setDesc("Формат moment.js, например YYYY-MM-DD или YYYY/MM/YYYY-MM-DD. Пусто — из «Ежедневных заметок» или YYYY-MM-DD.")
			.addText((t) =>
				t.setPlaceholder("YYYY-MM-DD").setValue(s.dailyFormat).onChange(async (v) => {
					s.dailyFormat = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Шаблон заметки дня")
			.setDesc("Путь к файлу-шаблону. Поддерживаются {{date}}, {{date:DD.MM}}, {{time}}, {{title}}.")
			.addText((t) =>
				t.setPlaceholder("Шаблоны/День").setValue(s.dailyTemplate).onChange(async (v) => {
					s.dailyTemplate = v;
					await save();
				}),
			);

		let armed = false;
		new Setting(containerEl)
			.setName("Сбросить статистику слов")
			.setDesc("Удаляет историю по всем дням. Заметки не затрагиваются.")
			.addButton((b) =>
				b.setButtonText("Сбросить").onClick(async () => {
					if (!armed) {
						armed = true;
						b.setButtonText("Точно сбросить?").setWarning();
						window.setTimeout(() => {
							armed = false;
							b.setButtonText("Сбросить").buttonEl.removeClass("mod-warning");
						}, 4000);
						return;
					}
					armed = false;
					await this.plugin.resetStats();
					b.setButtonText("Сброшено ✓").buttonEl.removeClass("mod-warning");
				}),
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Граф: дерево прокачки").setHeading();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Каждая папка верхнего уровня — ветка, которая растёт в свою сторону. Главные файлы папок закрепляются " +
				"как узлы навыков, файлы висят на них листьями. Использует внутренние механизмы графа Obsidian: " +
				"после обновления Obsidian может перестать работать — тогда просто выключите.",
		});

		new Setting(containerEl)
			.setName("Раскладывать граф ветками")
			.addToggle((t) =>
				t.setValue(s.skillTreeEnabled).onChange(async (v) => {
					s.skillTreeEnabled = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Форма")
			.addDropdown((d) =>
				d
					.addOptions({ radial: "Звезда — ветки во все стороны", up: "Дерево прокачки — ветки растут вверх" })
					.setValue(s.skillTreeStyle)
					.onChange(async (v) => {
						s.skillTreeStyle = v as TreeStyle;
						await save();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Длина ветки")
			.setDesc("Расстояние между уровнями.")
			.addSlider((sl) =>
				sl
					.setLimits(120, 700, 20)
					.setValue(s.skillTreeStep)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.skillTreeStep = v;
						await save();
					}),
			);

		if (s.skillTreeStyle === "radial") {
			new Setting(containerEl)
				.setName("Ширина веера ветки")
				.setDesc("Насколько широко расходятся подпапки одной ветки, в градусах.")
				.addSlider((sl) =>
					sl
						.setLimits(30, 180, 5)
						.setValue(s.skillTreeSpread)
						.setDynamicTooltip()
						.onChange(async (v) => {
							s.skillTreeSpread = v;
							await save();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Закреплять и файлы")
			.setDesc("Выключено — файлы свободно «плавают» вокруг своего узла. Включено — выстраиваются аккуратным веером.")
			.addToggle((t) =>
				t.setValue(s.skillTreePinFiles).onChange(async (v) => {
					s.skillTreePinFiles = v;
					await save();
				}),
			);

		const roots = this.plugin.graphTree.buildTree().sort((a, b) => a.name.localeCompare(b.name));
		if (s.skillTreeStyle === "radial" && roots.length) {
			const dirOptions: Record<string, string> = { auto: "Авто" };
			for (const [k, v] of Object.entries(DIRECTIONS)) dirOptions[k] = v.label;
			containerEl.createEl("div", { cls: "setting-item-name fh-subheading", text: "Направления веток" });
			for (const root of roots) {
				new Setting(containerEl).setName(root.name).addDropdown((d) =>
					d
						.addOptions(dirOptions)
						.setValue(s.branchDirections[root.name] ?? "auto")
						.onChange(async (v) => {
							if (v === "auto") delete s.branchDirections[root.name];
							else s.branchDirections[root.name] = v;
							await save();
						}),
				);
			}
		}

		new Setting(containerEl)
			.setName("Свой цвет каждой ветке")
			.setDesc("Файлы ветки окрашиваются в её цвет, главные файлы — в цвет выделения. Новые ветки раскрашиваются сами.")
			.addToggle((t) =>
				t.setValue(s.branchColors).onChange(async (v) => {
					s.branchColors = v;
					await save();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Раскрасить сейчас").onClick(() => this.plugin.graphTree.applyBranchColors(true)),
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Действия").setHeading();

		new Setting(containerEl)
			.setName("Создать главные файлы во всех существующих папках")
			.addButton((b) => b.setButtonText("Создать").onClick(() => this.plugin.createAll()));

		new Setting(containerEl)
			.setName("Перестроить все главные файлы")
			.setDesc("Применить новую раскладку/сортировку ко всем. Ручные правки внутри списка будут сброшены (текст вне списка не трогается).")
			.addButton((b) =>
				b
					.setButtonText("Перестроить")
					.setWarning()
					.onClick(async () => {
						await this.plugin.updateAll(true);
					}),
			);
	}
}
