import { App, PluginSettingTab, Setting } from "obsidian";
import type FolderHubPlugin from "./main";
import type { Layout, SortBy, SortOrder } from "./render";
import { DIRECTIONS, TreeStyle } from "./skilltree";
import { RAY_STYLES, RayStyle } from "./rays";
import { LINE_STYLES, LineStyle, ModuleShape } from "./module-shapes";
import { MODULE_COLORS, ModuleDef, newModuleId } from "./modules";
import { TFolder } from "obsidian";

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
	/** Colour-group queries this plugin wrote to graph.json (so it can replace them). */
	managedGraphQueries: string[];

	// Branch levels
	branchLevels: boolean;

	// Graph effects
	fxEnabled: boolean;
	fxColor: string;
	fxInterval: number;
	fxRing: boolean;
	fxWave: boolean;
	rayStyle: RayStyle;
	rayMode: "pulse" | "constant";
	rayWidth: number;
	fxGlow: boolean;
	linkFlow: "off" | "all" | "hubs";
	linkFlowColor: string;
	linkFlowSpeed: number;
	graphGrow: boolean;
	graphFreeze: boolean;
	fxShowFps: boolean;

	// Graph modules
	modulesEnabled: boolean;
	modules: ModuleDef[];
	moduleShape: ModuleShape;
	moduleLine: LineStyle;
	moduleLineWidth: number;
	moduleHold: boolean;
	moduleSize: number;
	moduleFill: boolean;
	moduleLabels: boolean;
	moduleAnimate: boolean;
	moduleIntro: "bubble" | "draw" | "none";
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
	managedGraphQueries: [],

	branchLevels: true,

	fxEnabled: true,
	fxColor: "#e5a50a",
	fxInterval: 4,
	fxRing: true,
	fxWave: true,
	rayStyle: "beam",
	rayMode: "pulse",
	rayWidth: 1,
	fxGlow: false,
	linkFlow: "hubs",
	linkFlowColor: "#9a9a9a",
	linkFlowSpeed: 30,
	graphGrow: true,
	graphFreeze: false,
	fxShowFps: false,

	modulesEnabled: true,
	modules: [],
	moduleShape: "cloud",
	moduleLine: "zigzag",
	moduleLineWidth: 1,
	moduleHold: true,
	moduleSize: 1,
	moduleFill: true,
	moduleLabels: true,
	moduleAnimate: true,
	moduleIntro: "bubble",
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

		new Setting(containerEl)
			.setName("Цвет в графе")
			.setDesc("Добавить в граф цветовую группу tag:#<тег> выбранного цвета — главные файлы будут выделены в графе.")
			.addButton((b) =>
				b.setButtonText("Добавить в граф").onClick(() => this.plugin.addGraphColorGroup()),
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

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Граф: эффекты").setHeading();

		new Setting(containerEl)
			.setName("Эффекты в графе")
			.setDesc("Рисуются поверх графа, сам граф не меняется. Отключаются вместе с общим переключателем «Анимации».")
			.addToggle((t) =>
				t.setValue(s.fxEnabled).onChange(async (v) => {
					s.fxEnabled = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Цвет импульса")
			.addColorPicker((c) =>
				c.setValue(s.fxColor).onChange(async (v) => {
					s.fxColor = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Интервал импульса, секунд")
			.addSlider((sl) =>
				sl
					.setLimits(1, 20, 1)
					.setValue(s.fxInterval)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.fxInterval = v;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Кольцо")
			.setDesc("От главного файла расходится кольцо.")
			.addToggle((t) =>
				t.setValue(s.fxRing).onChange(async (v) => {
					s.fxRing = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Лучи по связям")
			.setDesc("От главного файла по связям к файлам и подпапкам бегут лучи.")
			.addToggle((t) =>
				t.setValue(s.fxWave).onChange(async (v) => {
					s.fxWave = v;
					await save();
					this.display();
				}),
			);

		if (s.fxWave) {
			new Setting(containerEl)
				.setName("Вид луча")
				.setDesc("Искра — светящаяся точка; Луч — лазер с ярким концом; Энергия — волнистый поток плазмы; Электричество — мерцающая молния с разрядами.")
				.addDropdown((d) =>
					d
						.addOptions(RAY_STYLES)
						.setValue(s.rayStyle)
						.onChange(async (v) => {
							s.rayStyle = v as RayStyle;
							await save();
						}),
				);

			new Setting(containerEl)
				.setName("Режим лучей")
				.addDropdown((d) =>
					d
						.addOptions({
							pulse: "По импульсу — волной по ветке",
							constant: "Постоянно",
						})
						.setValue(s.rayMode)
						.onChange(async (v) => {
							s.rayMode = v as FolderHubSettings["rayMode"];
							await save();
						}),
				);

			new Setting(containerEl)
				.setName("Толщина лучей")
				.addSlider((sl) =>
					sl
						.setLimits(0.5, 3, 0.25)
						.setValue(s.rayWidth)
						.setDynamicTooltip()
						.onChange(async (v) => {
							s.rayWidth = v;
							await save();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Свечение")
			.setDesc("Главные файлы мягко «дышат» светом.")
			.addToggle((t) =>
				t.setValue(s.fxGlow).onChange(async (v) => {
					s.fxGlow = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Анимация связей")
			.setDesc("По линиям бегут штрихи в направлении ссылки — как анимированные стрелки.")
			.addDropdown((d) =>
				d
					.addOptions({ off: "Статично", hubs: "Только от главных файлов", all: "Все связи" })
					.setValue(s.linkFlow)
					.onChange(async (v) => {
						s.linkFlow = v as FolderHubSettings["linkFlow"];
						await save();
						this.display();
					}),
			);

		if (s.linkFlow !== "off") {
			new Setting(containerEl)
				.setName("Цвет и скорость потока")
				.addColorPicker((c) =>
					c.setValue(s.linkFlowColor).onChange(async (v) => {
						s.linkFlowColor = v;
						await save();
					}),
				)
				.addSlider((sl) =>
					sl
						.setLimits(5, 120, 5)
						.setValue(s.linkFlowSpeed)
						.setDynamicTooltip()
						.onChange(async (v) => {
							s.linkFlowSpeed = v;
							await save();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Рост дерева при открытии")
			.setDesc("Узлы вырастают из центра ветка за веткой, уровень за уровнем (нужна раскладка ветками).")
			.addToggle((t) =>
				t.setValue(s.graphGrow).onChange(async (v) => {
					s.graphGrow = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Показывать FPS")
			.setDesc(
				"Счётчик кадров в углу графа и текущее качество эффектов. Качество подстраивается само: " +
					"если кадр рисуется слишком долго, эффекты упрощаются, чтобы держать 60 FPS.",
			)
			.addToggle((t) =>
				t.setValue(s.fxShowFps).onChange(async (v) => {
					s.fxShowFps = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Заморозить граф")
			.setDesc("Когда узлы улягутся, они перестают двигаться. Меньше нагрузка на телефон. Эффекты продолжают работать.")
			.addToggle((t) =>
				t.setValue(s.graphFreeze).onChange(async (v) => {
					s.graphFreeze = v;
					await save();
				}),
			);

		this.displayModules(containerEl);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Уровни веток").setHeading();

		new Setting(containerEl)
			.setName("Показывать уровень ветки")
			.setDesc(
				"Опыт ветки = слова во всех её заметках + 25 за каждую заметку. Карточка уровня появляется в начале списка " +
					"главного файла, в панели календаря — список веток. При повышении уровня — уведомление и вспышка в графе.",
			)
			.addToggle((t) =>
				t.setValue(s.branchLevels).onChange(async (v) => {
					s.branchLevels = v;
					await save();
					await this.plugin.updateAll(false);
				}),
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

	/** "Graph: modules" section with a small editor for each module. */
	private displayModules(containerEl: HTMLElement) {
		const s = this.plugin.settings;
		const changed = () => this.plugin.onModulesChanged();

		new Setting(containerEl).setName("Граф: модули").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Модуль — барьер вокруг группы заметок (папки или тега): граница своего цвета, которая растёт " +
				"вместе с числом заметок и удерживает их внутри. Быстро создать: правый клик по папке → «Сделать модулем графа».",
		});

		new Setting(containerEl).setName("Показывать модули").addToggle((t) =>
			t.setValue(s.modulesEnabled).onChange(async (v) => {
				s.modulesEnabled = v;
				await changed();
			}),
		);

		new Setting(containerEl)
			.setName("Форма границы")
			.addDropdown((d) =>
				d
					.addOptions({ cloud: "Облако — по форме группы", circle: "Круг" })
					.setValue(s.moduleShape)
					.onChange(async (v) => {
						s.moduleShape = v as ModuleShape;
						await changed();
					}),
			);

		new Setting(containerEl)
			.setName("Линия границы по умолчанию")
			.addDropdown((d) =>
				d
					.addOptions(LINE_STYLES)
					.setValue(s.moduleLine)
					.onChange(async (v) => {
						s.moduleLine = v as LineStyle;
						await changed();
					}),
			)
			.addSlider((sl) =>
				sl
					.setLimits(0.5, 3, 0.25)
					.setValue(s.moduleLineWidth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.moduleLineWidth = v;
						await changed();
					}),
			);

		new Setting(containerEl)
			.setName("Появление модуля")
			.setDesc("Как барьер возникает при открытии графа или создании модуля.")
			.addDropdown((d) =>
				d
					.addOptions({ bubble: "Пузырь — надувается и колышется", draw: "Закрывается по кругу", none: "Без анимации" })
					.setValue(s.moduleIntro)
					.onChange(async (v) => {
						s.moduleIntro = v as FolderHubSettings["moduleIntro"];
						await changed();
					}),
			);

		new Setting(containerEl)
			.setName("Размер барьера")
			.setDesc("Множитель: барьер растёт с количеством заметок (√n), это — общий масштаб.")
			.addSlider((sl) =>
				sl
					.setLimits(0.5, 2.5, 0.1)
					.setValue(s.moduleSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.moduleSize = v;
						await changed();
					}),
			);

		new Setting(containerEl)
			.setName("Удерживать заметки внутри")
			.setDesc("Вылетевшую за барьер заметку мягко возвращает внутрь; если её постоянно выталкивает — барьер расширяется.")
			.addToggle((t) =>
				t.setValue(s.moduleHold).onChange(async (v) => {
					s.moduleHold = v;
					await changed();
				}),
			);

		new Setting(containerEl)
			.setName("Заливка, подписи, анимация границы")
			.addToggle((t) =>
				t.setTooltip("Полупрозрачная заливка").setValue(s.moduleFill).onChange(async (v) => {
					s.moduleFill = v;
					await changed();
				}),
			)
			.addToggle((t) =>
				t.setTooltip("Подпись с названием и числом заметок").setValue(s.moduleLabels).onChange(async (v) => {
					s.moduleLabels = v;
					await changed();
				}),
			)
			.addToggle((t) =>
				t.setTooltip("Зубцы/штрихи/волна ползут вдоль границы").setValue(s.moduleAnimate).onChange(async (v) => {
					s.moduleAnimate = v;
					await changed();
				}),
			);

		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
			.map((f) => f.path)
			.sort((a, b) => a.localeCompare(b));
		const lineOptions: Record<string, string> = { default: `По умолчанию (${LINE_STYLES[s.moduleLine]})` };
		for (const [k, v] of Object.entries(LINE_STYLES)) lineOptions[k] = v;

		s.modules.forEach((m, i) => {
			const box = containerEl.createDiv({ cls: "fh-module-box" });
			box.style.setProperty("--fh-module-color", m.color);

			new Setting(box)
				.setName(`Модуль ${i + 1}`)
				.addText((t) =>
					t.setPlaceholder("Название").setValue(m.name).onChange(async (v) => {
						m.name = v;
						await changed();
					}),
				)
				.addColorPicker((c) =>
					c.setValue(m.color).onChange(async (v) => {
						m.color = v;
						box.style.setProperty("--fh-module-color", v);
						await changed();
					}),
				)
				.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip("Удалить модуль")
						.onClick(async () => {
							s.modules.splice(i, 1);
							await changed();
							this.display();
						}),
				);

			const member = new Setting(box).setName("Состав").addDropdown((d) =>
				d
					.addOptions({ folder: "Папка", tag: "Тег" })
					.setValue(m.kind)
					.onChange(async (v) => {
						m.kind = v as ModuleDef["kind"];
						m.value = "";
						await changed();
						this.display();
					}),
			);
			if (m.kind === "folder" && folders.length <= 400) {
				member.addDropdown((d) => {
					d.addOption("", "— выберите папку —");
					for (const f of folders) d.addOption(f, f);
					d.setValue(m.value).onChange(async (v) => {
						m.value = v;
						if (!m.name || m.name === "Новый модуль") m.name = v.split("/").pop() ?? v;
						await changed();
						this.display();
					});
				});
			} else {
				member.addText((t) =>
					t
						.setPlaceholder(m.kind === "tag" ? "тег без #" : "Путь к папке")
						.setValue(m.value)
						.onChange(async (v) => {
							m.value = v.trim();
							await changed();
						}),
				);
			}

			new Setting(box)
				.setName("Граница и точки")
				.addDropdown((d) =>
					d
						.addOptions(lineOptions)
						.setValue(m.line)
						.onChange(async (v) => {
							m.line = v as ModuleDef["line"];
							await changed();
						}),
				)
				.addToggle((t) =>
					t
						.setTooltip("Красить точки модуля в его цвет (появится после повторного открытия графа)")
						.setValue(m.colorNodes)
						.onChange(async (v) => {
							m.colorNodes = v;
							await changed();
						}),
				);
		});

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Добавить модуль")
				.setCta()
				.onClick(async () => {
					s.modules.push({
						id: newModuleId(),
						name: "Новый модуль",
						kind: "folder",
						value: "",
						color: MODULE_COLORS[s.modules.length % MODULE_COLORS.length],
						colorNodes: true,
						line: "default",
					});
					await changed();
					this.display();
				}),
		);
	}
}
