import { App, PluginSettingTab, Setting } from "obsidian";
import type FolderHubPlugin from "./main";
import type { Layout, SortBy, SortOrder } from "./render";

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
			.setDesc("Добавить в граф цветовую группу tag:#<тег> выбранного цвета.")
			.addButton((b) =>
				b.setButtonText("Добавить в граф").onClick(() => this.plugin.addGraphColorGroup()),
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
