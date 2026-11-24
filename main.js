"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  INDEX_KEY: () => INDEX_KEY,
  default: () => FolderHubPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/render.ts
var BLOCK_START = "%% folder-hub:start %%";
var BLOCK_END = "%% folder-hub:end %%";
function wikilink(linktext) {
  return `[[${linktext}]]`;
}
function sortItems(items, sortBy, order, subfoldersFirst) {
  const dir = order === "asc" ? 1 : -1;
  const collator = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
  return [...items].sort((a, b) => {
    if (subfoldersFirst && a.isSubIndex !== b.isSubIndex) return a.isSubIndex ? -1 : 1;
    let cmp;
    if (sortBy === "ctime") cmp = a.ctime - b.ctime;
    else if (sortBy === "mtime") cmp = a.mtime - b.mtime;
    else cmp = collator.compare(a.name, b.name);
    if (cmp === 0) cmp = collator.compare(a.path, b.path);
    return cmp * dir;
  });
}
function renderLine(item, index, opts) {
  const link = wikilink(item.linktext);
  switch (opts.layout) {
    case "numbered":
      return `${index + 1}. ${link}`;
    case "custom":
      return applyItemTemplate(opts.itemTemplate, item, index, opts);
    case "list":
    case "table":
    default:
      return `- ${link}`;
  }
}
function applyItemTemplate(template, item, index, opts) {
  const values = {
    link: wikilink(item.linktext),
    linktext: item.linktext,
    name: item.name,
    ext: item.ext,
    path: item.path,
    n: String(index + 1),
    ctime: opts.formatDate(item.ctime),
    mtime: opts.formatDate(item.mtime),
    type: item.isSubIndex ? "folder" : "file"
  };
  return (template || "- {{link}}").replace(
    /\{\{(\w+)\}\}/g,
    (m, key) => key in values ? values[key] : m
  );
}
function renderItems(items, opts) {
  if (opts.layout !== "table") return items.map((it, i) => renderLine(it, i, opts));
  return renderTable(items, opts);
}
function renderTable(items, opts) {
  const cols = Math.max(1, Math.min(10, Math.floor(opts.columns) || 1));
  const headers = opts.tableHeaders.split(",").map((h) => h.trim());
  while (headers.length < cols) headers.push("");
  headers.length = cols;
  const lines = [];
  lines.push(`| ${headers.map((h) => h || " ").join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  const rows = Math.ceil(items.length / cols);
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const it = items[c * rows + r];
      cells.push(it ? wikilink(it.linktext) : " ");
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines;
}
function extractBlockBody(content) {
  const start = content.indexOf(BLOCK_START);
  if (start < 0) return null;
  const end = content.indexOf(BLOCK_END, start + BLOCK_START.length);
  if (end < 0) return null;
  const inner = content.slice(start + BLOCK_START.length, end);
  const lines = inner.split("\n");
  if (lines.length && lines[0].trim() === "") lines.shift();
  if (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}
function buildBlock(body) {
  return [BLOCK_START, ...body, BLOCK_END].join("\n");
}
function applyBlock(content, body) {
  const block = buildBlock(body);
  const start = content.indexOf(BLOCK_START);
  const end = start >= 0 ? content.indexOf(BLOCK_END, start + BLOCK_START.length) : -1;
  if (start >= 0 && end >= 0) {
    return content.slice(0, start) + block + content.slice(end + BLOCK_END.length);
  }
  const trimmed = content.replace(/\s+$/, "");
  return (trimmed ? trimmed + "\n\n" : "") + block + "\n";
}
var LINK_RE = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
function extractLinkpaths(line) {
  const out = [];
  for (const m of line.matchAll(LINK_RE)) out.push(m[1].trim());
  return out;
}
function mergePreserving(existing, items, resolve, opts) {
  const wanted = new Set(items.map((i) => i.path));
  const linked = /* @__PURE__ */ new Set();
  const kept = [];
  let linkLines = 0;
  for (const line of existing) {
    const linkpaths = extractLinkpaths(line);
    if (linkpaths.length === 0) {
      kept.push(line);
      continue;
    }
    const targets = linkpaths.map(resolve).filter((p) => !!p && wanted.has(p));
    if (targets.length === 0) continue;
    targets.forEach((t) => linked.add(t));
    kept.push(line);
    linkLines++;
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  for (const item of items) {
    if (linked.has(item.path)) continue;
    kept.push(renderLine(item, linkLines++, opts));
  }
  return kept;
}
function fillNoteTemplate(template, vars, block) {
  let text = template.replace(/\{\{folder\}\}/g, vars.folder).replace(/\{\{date\}\}/g, vars.date);
  text = vars.tag ? text.replace(/\{\{tag\}\}/g, vars.tag) : text.replace(/^[ \t]*-[ \t]*\{\{tag\}\}[ \t]*\n?/gm, "").replace(/\{\{tag\}\}/g, "");
  if (text.includes("{{list}}")) return text.replace("{{list}}", block);
  return text.replace(/\s+$/, "") + (text.trim() ? "\n\n" : "") + block + "\n";
}
function parentPath(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
function baseName(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}
function cssString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_NOTE_TEMPLATE = `---
tags:
  - {{tag}}
folder-index: true
cssclasses:
  - folder-hub-index
---

{{list}}
`;
var DEFAULT_SETTINGS = {
  autoCreate: true,
  indexName: "{{folder}}",
  newNoteTemplate: DEFAULT_NOTE_TEMPLATE,
  renameWithFolder: true,
  tag: "folder-index",
  layout: "list",
  columns: 3,
  tableHeaders: "\u0424\u0430\u0439\u043B\u044B",
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
  highlightIcon: "\u2605",
  highlightBold: true,
  highlightFolders: false
};
var FolderHubSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u0421\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u0421\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438").setDesc("\u041F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u043D\u043E\u0432\u043E\u0439 \u043F\u0430\u043F\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u043D\u0435\u0451 \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B.").addToggle(
      (t) => t.setValue(s.autoCreate).onChange(async (v) => {
        s.autoCreate = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0418\u043C\u044F \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setDesc("{{folder}} \u2014 \u0438\u043C\u044F \u043F\u0430\u043F\u043A\u0438. \u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 \xAB{{folder}}\xBB \u0438\u043B\u0438 \xAB_{{folder}}\xBB \u0438\u043B\u0438 \xAB{{folder}} (\u043E\u0433\u043B\u0430\u0432\u043B\u0435\u043D\u0438\u0435)\xBB.").addText(
      (t) => t.setPlaceholder("{{folder}}").setValue(s.indexName).onChange(async (v) => {
        s.indexName = v || "{{folder}}";
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u044B\u0432\u0430\u0442\u044C \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043F\u0430\u043F\u043A\u043E\u0439").setDesc("\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043B\u0438 \u043F\u0430\u043F\u043A\u0443 \u2014 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u0443\u0435\u0442\u0441\u044F \u0441\u043B\u0435\u0434\u043E\u043C (\u0441\u0441\u044B\u043B\u043A\u0438 \u043D\u0430 \u043D\u0435\u0433\u043E \u043E\u0431\u043D\u043E\u0432\u044F\u0442\u0441\u044F).").addToggle(
      (t) => t.setValue(s.renameWithFolder).onChange(async (v) => {
        s.renameWithFolder = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0422\u0435\u0433 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432").setDesc("\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430. \u041D\u0443\u0436\u0435\u043D \u0434\u043B\u044F \u0440\u0430\u0441\u043A\u0440\u0430\u0441\u043A\u0438 \u0432 \u0433\u0440\u0430\u0444\u0435 (\u0437\u0430\u043F\u0440\u043E\u0441 tag:#\u0442\u0435\u0433).").addText(
      (t) => t.setPlaceholder("folder-index").setValue(s.tag).onChange(async (v) => {
        s.tag = v.replace(/^#/, "").trim();
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0428\u0430\u0431\u043B\u043E\u043D \u043D\u043E\u0432\u043E\u0433\u043E \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setDesc(
      "{{list}} \u2014 \u043C\u0435\u0441\u0442\u043E \u0434\u043B\u044F \u0441\u043F\u0438\u0441\u043A\u0430 \u0441\u0441\u044B\u043B\u043E\u043A, {{folder}} \u2014 \u0438\u043C\u044F \u043F\u0430\u043F\u043A\u0438, {{tag}} \u2014 \u0442\u0435\u0433, {{date}} \u2014 \u0434\u0430\u0442\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F. \u0412\u0441\u0451 \u0432\u043D\u0435 \u0441\u043F\u0438\u0441\u043A\u0430 \u043C\u043E\u0436\u043D\u043E \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C."
    ).addTextArea((t) => {
      t.setValue(s.newNoteTemplate).onChange(async (v) => {
        s.newNoteTemplate = v;
        await save();
      });
      t.inputEl.rows = 9;
      t.inputEl.addClass("folder-hub-textarea");
    }).addExtraButton(
      (b) => b.setIcon("rotate-ccw").setTooltip("\u0412\u0435\u0440\u043D\u0443\u0442\u044C \u0448\u0430\u0431\u043B\u043E\u043D \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E").onClick(async () => {
        s.newNoteTemplate = DEFAULT_NOTE_TEMPLATE;
        await save();
        this.display();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u041A\u0430\u043A \u0432\u044B\u0433\u043B\u044F\u0434\u0438\u0442 \u0441\u043F\u0438\u0441\u043E\u043A").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u0420\u0430\u0441\u043A\u043B\u0430\u0434\u043A\u0430").setDesc("\u041A\u0430\u043A \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0438 [[...]] \u043D\u0430 \u0444\u0430\u0439\u043B\u044B \u043F\u0430\u043F\u043A\u0438.").addDropdown(
      (d) => d.addOptions({
        list: "\u0421\u0442\u043E\u043B\u0431\u0438\u043A (\u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A)",
        numbered: "\u041D\u0443\u043C\u0435\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A",
        table: "\u0422\u0430\u0431\u043B\u0438\u0446\u0430 \u0432 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u043B\u043E\u043D\u043E\u043A",
        custom: "\u0421\u0432\u043E\u0439 \u0448\u0430\u0431\u043B\u043E\u043D \u0441\u0442\u0440\u043E\u043A\u0438"
      }).setValue(s.layout).onChange(async (v) => {
        s.layout = v;
        await save();
        this.display();
      })
    );
    if (s.layout === "table") {
      new import_obsidian.Setting(containerEl).setName("\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043A\u043E\u043B\u043E\u043D\u043E\u043A").addSlider(
        (sl) => sl.setLimits(1, 6, 1).setValue(s.columns).setDynamicTooltip().onChange(async (v) => {
          s.columns = v;
          await save();
        })
      );
      new import_obsidian.Setting(containerEl).setName("\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438 \u043A\u043E\u043B\u043E\u043D\u043E\u043A").setDesc("\u0427\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E. \u041F\u0443\u0441\u0442\u044B\u0435 \u2014 \u0431\u0435\u0437 \u043F\u043E\u0434\u043F\u0438\u0441\u0438.").addText(
        (t) => t.setValue(s.tableHeaders).onChange(async (v) => {
          s.tableHeaders = v;
          await save();
        })
      );
    }
    if (s.layout === "custom") {
      new import_obsidian.Setting(containerEl).setName("\u0428\u0430\u0431\u043B\u043E\u043D \u0441\u0442\u0440\u043E\u043A\u0438").setDesc(
        "{{link}} \u2014 \u0441\u0441\u044B\u043B\u043A\u0430 [[...]], {{name}} \u2014 \u0438\u043C\u044F, {{ext}} \u2014 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435, {{path}} \u2014 \u043F\u0443\u0442\u044C, {{n}} \u2014 \u043D\u043E\u043C\u0435\u0440, {{ctime}}/{{mtime}} \u2014 \u0434\u0430\u0442\u044B \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F/\u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F, {{type}} \u2014 file/folder. \u041F\u0440\u0438\u043C\u0435\u0440: \xAB- [ ] {{link}} ({{ctime}})\xBB."
      ).addText(
        (t) => t.setValue(s.itemTemplate).onChange(async (v) => {
          s.itemTemplate = v;
          await save();
        })
      );
      new import_obsidian.Setting(containerEl).setName("\u0424\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u0442\u044B").setDesc("\u0424\u043E\u0440\u043C\u0430\u0442 moment.js, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 YYYY-MM-DD \u0438\u043B\u0438 DD.MM.YYYY.").addText(
        (t) => t.setValue(s.dateFormat).onChange(async (v) => {
          s.dateFormat = v;
          await save();
        })
      );
    }
    new import_obsidian.Setting(containerEl).setName("\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C \u0440\u0443\u0447\u043D\u044B\u0435 \u043F\u0440\u0430\u0432\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u043F\u0438\u0441\u043A\u0430").setDesc(
      "\u041C\u043E\u0436\u043D\u043E \u043C\u0435\u043D\u044F\u0442\u044C \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u0442\u0440\u043E\u043A, \u0434\u043E\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u044F \u0440\u044F\u0434\u043E\u043C \u0441\u043E \u0441\u0441\u044B\u043B\u043A\u0430\u043C\u0438, \u0432\u0441\u0442\u0430\u0432\u043B\u044F\u0442\u044C \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438 \u2014 \u043F\u043B\u0430\u0433\u0438\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442 \u043D\u043E\u0432\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432 \u043A\u043E\u043D\u0435\u0446 \u0438 \u0443\u0431\u0435\u0440\u0451\u0442 \u0441\u0442\u0440\u043E\u043A\u0438 \u0443\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0445. \u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u043F\u0438\u0441\u043E\u043A \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0435\u0440\u0435\u0441\u043E\u0431\u0438\u0440\u0430\u043B\u0441\u044F \u0441 \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u043E\u0439. (\u0414\u043B\u044F \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0435\u0440\u0435\u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F.)"
    ).addToggle(
      (t) => t.setValue(s.preserveEdits).onChange(async (v) => {
        s.preserveEdits = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0430").addDropdown(
      (d) => d.addOptions({ name: "\u041F\u043E \u0438\u043C\u0435\u043D\u0438", ctime: "\u041F\u043E \u0434\u0430\u0442\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F", mtime: "\u041F\u043E \u0434\u0430\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F" }).setValue(s.sortBy).onChange(async (v) => {
        s.sortBy = v;
        await save();
      })
    ).addDropdown(
      (d) => d.addOptions({ asc: "\u041F\u043E \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0430\u043D\u0438\u044E", desc: "\u041F\u043E \u0443\u0431\u044B\u0432\u0430\u043D\u0438\u044E" }).setValue(s.sortOrder).onChange(async (v) => {
        s.sortOrder = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u041F\u043E\u0434\u043F\u0430\u043F\u043A\u0438 \u0441\u043D\u0430\u0447\u0430\u043B\u0430").setDesc("\u0421\u0441\u044B\u043B\u043A\u0438 \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u043E\u0434\u043F\u0430\u043F\u043E\u043A \u2014 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0441\u043F\u0438\u0441\u043A\u0430.").addToggle(
      (t) => t.setValue(s.subfoldersFirst).onChange(async (v) => {
        s.subfoldersFirst = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u041A\u0430\u043A\u0438\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u0432 \u0441\u043F\u0438\u0441\u043E\u043A").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u041D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u043C\u0435\u0442\u043A\u0438").setDesc("\u0412\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438, PDF, canvas \u0438 \u0442.\u0434. \u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2014 \u0442\u043E\u043B\u044C\u043A\u043E .md.").addToggle(
      (t) => t.setValue(s.includeNonMarkdown).onChange(async (v) => {
        s.includeNonMarkdown = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0418\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F").setDesc("\u0427\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: png, jpg, pdf").addText(
      (t) => t.setValue(s.excludedExtensions).onChange(async (v) => {
        s.excludedExtensions = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0421\u0432\u044F\u0437\u044B\u0432\u0430\u0442\u044C \u0441 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430\u043C\u0438").setDesc("\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443 \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043A\u0430\u0436\u0434\u043E\u0439 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0438 \u2014 \u0432 \u0433\u0440\u0430\u0444\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0441\u044F \u0434\u0435\u0440\u0435\u0432\u043E: \u041C\u0435\u043D\u044E \u2192 \u041F\u043E\u0434\u043C\u0435\u043D\u044E \u2192 \u0444\u0430\u0439\u043B\u044B.").addToggle(
      (t) => t.setValue(s.linkSubfolderIndexes).onChange(async (v) => {
        s.linkSubfolderIndexes = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0412\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u0444\u0430\u0439\u043B\u044B \u0438\u0437 \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u043F\u0430\u043F\u043E\u043A").setDesc("\u041F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u044F\u0442\u044C \u0432 \u0433\u043B\u0430\u0432\u043D\u043E\u043C \u0444\u0430\u0439\u043B\u0435 \u0432\u043E\u043E\u0431\u0449\u0435 \u0432\u0441\u0435 \u0444\u0430\u0439\u043B\u044B, \u0432\u043A\u043B\u044E\u0447\u0430\u044F \u0444\u0430\u0439\u043B\u044B \u043F\u043E\u0434\u043F\u0430\u043F\u043E\u043A \u043B\u044E\u0431\u043E\u0439 \u0433\u043B\u0443\u0431\u0438\u043D\u044B.").addToggle(
      (t) => t.setValue(s.includeNested).onChange(async (v) => {
        s.includeNested = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0418\u0441\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u044B\u0435 \u043F\u0430\u043F\u043A\u0438").setDesc("\u041F\u043E \u043E\u0434\u043D\u043E\u0439 \u043D\u0430 \u0441\u0442\u0440\u043E\u043A\u0443 (\u043F\u0443\u0442\u044C \u043E\u0442 \u043A\u043E\u0440\u043D\u044F \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430). \u0412 \u043D\u0438\u0445 \u0438 \u0438\u0445 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430\u0445 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u044E\u0442\u0441\u044F.").addTextArea((t) => {
      t.setPlaceholder("Templates\nAttachments").setValue(s.excludedFolders).onChange(async (v) => {
        s.excludedFolders = v;
        await save();
      });
      t.inputEl.rows = 4;
    });
    new import_obsidian.Setting(containerEl).setName("\u0412\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u0412\u044B\u0434\u0435\u043B\u044F\u0442\u044C \u0432 \u043F\u0440\u043E\u0432\u043E\u0434\u043D\u0438\u043A\u0435 \u0444\u0430\u0439\u043B\u043E\u0432").addToggle(
      (t) => t.setValue(s.highlightEnabled).onChange(async (v) => {
        s.highlightEnabled = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0426\u0432\u0435\u0442").setDesc("\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 \u043F\u0440\u043E\u0432\u043E\u0434\u043D\u0438\u043A\u0435, \u0432 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0438 \u0434\u043B\u044F \u0433\u0440\u0443\u043F\u043F\u044B \u0432 \u0433\u0440\u0430\u0444\u0435.").addColorPicker(
      (c) => c.setValue(s.highlightColor).onChange(async (v) => {
        s.highlightColor = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0417\u043D\u0430\u0447\u043E\u043A").setDesc("\u0421\u0438\u043C\u0432\u043E\u043B \u043F\u0435\u0440\u0435\u0434 \u0438\u043C\u0435\u043D\u0435\u043C \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430 (\u2605, \u{1F4CC}, \u{1F5C2}, \u25C6 \u2026). \u041F\u0443\u0441\u0442\u043E \u2014 \u0431\u0435\u0437 \u0437\u043D\u0430\u0447\u043A\u0430.").addText(
      (t) => t.setValue(s.highlightIcon).onChange(async (v) => {
        s.highlightIcon = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0416\u0438\u0440\u043D\u044B\u0439 \u0448\u0440\u0438\u0444\u0442").addToggle(
      (t) => t.setValue(s.highlightBold).onChange(async (v) => {
        s.highlightBold = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u041F\u043E\u0434\u043A\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C \u0438 \u0441\u0430\u043C\u0443 \u043F\u0430\u043F\u043A\u0443").setDesc("\u041F\u0430\u043F\u043A\u0438, \u0432 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0435\u0441\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B, \u0442\u043E\u0436\u0435 \u043E\u043A\u0440\u0430\u0448\u0438\u0432\u0430\u044E\u0442\u0441\u044F.").addToggle(
      (t) => t.setValue(s.highlightFolders).onChange(async (v) => {
        s.highlightFolders = v;
        await save();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0426\u0432\u0435\u0442 \u0432 \u0433\u0440\u0430\u0444\u0435").setDesc("\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0433\u0440\u0430\u0444 \u0446\u0432\u0435\u0442\u043E\u0432\u0443\u044E \u0433\u0440\u0443\u043F\u043F\u0443 tag:#<\u0442\u0435\u0433> \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0446\u0432\u0435\u0442\u0430.").addButton(
      (b) => b.setButtonText("\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0433\u0440\u0430\u0444").onClick(() => this.plugin.addGraphColorGroup())
    );
    new import_obsidian.Setting(containerEl).setName("\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432\u043E \u0432\u0441\u0435\u0445 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0445 \u043F\u0430\u043F\u043A\u0430\u0445").addButton((b) => b.setButtonText("\u0421\u043E\u0437\u0434\u0430\u0442\u044C").onClick(() => this.plugin.createAll()));
    new import_obsidian.Setting(containerEl).setName("\u041F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0432\u0441\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B").setDesc("\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C \u043D\u043E\u0432\u0443\u044E \u0440\u0430\u0441\u043A\u043B\u0430\u0434\u043A\u0443/\u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0443 \u043A\u043E \u0432\u0441\u0435\u043C. \u0420\u0443\u0447\u043D\u044B\u0435 \u043F\u0440\u0430\u0432\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u043F\u0438\u0441\u043A\u0430 \u0431\u0443\u0434\u0443\u0442 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u044B (\u0442\u0435\u043A\u0441\u0442 \u0432\u043D\u0435 \u0441\u043F\u0438\u0441\u043A\u0430 \u043D\u0435 \u0442\u0440\u043E\u0433\u0430\u0435\u0442\u0441\u044F).").addButton(
      (b) => b.setButtonText("\u041F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C").setWarning().onClick(async () => {
        await this.plugin.updateAll(true);
      })
    );
  }
};

// src/main.ts
var INDEX_KEY = "folder-index";
var FolderHubPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.pending = /* @__PURE__ */ new Set();
    this.flushTimer = null;
    this.highlightTimer = null;
    this.queue = Promise.resolve();
    this.styleEl = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new FolderHubSettingTab(this.app, this));
    this.styleEl = document.head.createEl("style", { attr: { id: "folder-hub-dynamic" } });
    this.register(() => this.styleEl?.remove());
    this.addCommand({
      id: "create-index-current-folder",
      name: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C/\u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u0432 \u043F\u0430\u043F\u043A\u0435 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438",
      checkCallback: (checking) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder || folder.isRoot()) return false;
        if (!checking) void this.createIndex(folder, true);
        return true;
      }
    });
    this.addCommand({
      id: "open-index-current-folder",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u043F\u0430\u043F\u043A\u0438",
      checkCallback: (checking) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        const index = folder && !folder.isRoot() ? this.findIndex(folder) : null;
        if (!index) return false;
        if (!checking) void this.app.workspace.getLeaf(false).openFile(index);
        return true;
      }
    });
    this.addCommand({
      id: "create-index-all-folders",
      name: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432\u043E \u0432\u0441\u0435\u0445 \u043F\u0430\u043F\u043A\u0430\u0445 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430",
      callback: () => void this.createAll()
    });
    this.addCommand({
      id: "update-all-indexes",
      name: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B",
      callback: async () => {
        const n = await this.updateAll(false);
        new import_obsidian2.Notice(`Folder Hub: \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432 \u2014 ${n}`);
      }
    });
    this.addCommand({
      id: "rebuild-all-indexes",
      name: "\u041F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0432\u0441\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0437\u0430\u043D\u043E\u0432\u043E (\u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u0440\u0430\u0432\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0431\u043B\u043E\u043A\u0430)",
      callback: async () => {
        const n = await this.updateAll(true);
        new import_obsidian2.Notice(`Folder Hub: \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0435\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432 \u2014 ${n}`);
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof import_obsidian2.TFolder) || file.isRoot()) return;
        const index = this.findIndex(file);
        if (index) {
          menu.addItem(
            (i) => i.setTitle("\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438").setIcon("star").onClick(() => this.app.workspace.getLeaf(false).openFile(index))
          );
          menu.addItem(
            (i) => i.setTitle("\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438").setIcon("refresh-cw").onClick(() => this.enqueue(() => this.updateFolder(file, false)))
          );
        } else {
          menu.addItem(
            (i) => i.setTitle("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438").setIcon("star").onClick(() => this.createIndex(file, true))
          );
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (f) => this.onCreate(f)));
      this.registerEvent(this.app.vault.on("delete", (f) => this.onDelete(f)));
      this.registerEvent(this.app.vault.on("rename", (f, old) => this.onRename(f, old)));
      void this.updateAll(false);
      this.refreshHighlight();
    });
  }
  onunload() {
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshHighlight();
  }
  // ---------------------------------------------------------------- events
  onCreate(file) {
    if (file instanceof import_obsidian2.TFolder && this.settings.autoCreate && !this.isExcluded(file)) {
      window.setTimeout(() => {
        const folder = this.app.vault.getAbstractFileByPath(file.path);
        if (folder instanceof import_obsidian2.TFolder && !this.findIndex(folder)) {
          void this.createIndex(folder, false);
        }
      }, 800);
    }
    this.scheduleAncestors(parentPath(file.path));
  }
  onDelete(file) {
    this.scheduleAncestors(parentPath(file.path));
    this.refreshHighlight();
  }
  onRename(file, oldPath) {
    if (file instanceof import_obsidian2.TFolder && this.settings.renameWithFolder) {
      const oldName = baseName(oldPath);
      if (oldName !== file.name) {
        window.setTimeout(() => void this.renameIndexWithFolder(file, oldName), 150);
      }
    }
    const oldParent = parentPath(oldPath);
    const newParent = parentPath(file.path);
    this.scheduleAncestors(oldParent);
    if (newParent !== oldParent) this.scheduleAncestors(newParent);
    this.refreshHighlight();
  }
  async renameIndexWithFolder(folder, oldFolderName) {
    if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof import_obsidian2.TFolder)) return;
    const oldIndex = this.app.vault.getAbstractFileByPath(
      (0, import_obsidian2.normalizePath)(`${folder.path}/${this.indexNameFor(oldFolderName)}.md`)
    );
    const newPath = this.expectedIndexPath(folder);
    if (!(oldIndex instanceof import_obsidian2.TFile) || oldIndex.path === newPath) return;
    if (this.app.vault.getAbstractFileByPath(newPath)) return;
    try {
      await this.app.fileManager.renameFile(oldIndex, newPath);
    } catch (e) {
      console.error("Folder Hub: failed to rename index", e);
    }
  }
  // ------------------------------------------------------------ scheduling
  /** Schedules an update for the folder at `path` and all its ancestors. */
  scheduleAncestors(path) {
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
      paths.sort((a, b) => b.split("/").length - a.split("/").length);
      for (const p2 of paths) {
        const folder = this.app.vault.getAbstractFileByPath(p2);
        if (folder instanceof import_obsidian2.TFolder) this.enqueue(() => this.updateFolder(folder, false));
      }
    }, 400);
  }
  /** Serialises writes so two updates never race on the same note. */
  enqueue(task) {
    this.queue = this.queue.then(task).then(
      () => void 0,
      (e) => console.error("Folder Hub:", e)
    );
    return this.queue;
  }
  // --------------------------------------------------------- index lookup
  indexNameFor(folderName) {
    const name = this.settings.indexName.replace(/\{\{folder\}\}/g, folderName).trim();
    return name || folderName;
  }
  expectedIndexPath(folder) {
    return (0, import_obsidian2.normalizePath)(`${folder.path}/${this.indexNameFor(folder.name)}.md`);
  }
  findIndex(folder) {
    if (folder.isRoot()) return null;
    const byName = this.app.vault.getAbstractFileByPath(this.expectedIndexPath(folder));
    if (byName instanceof import_obsidian2.TFile) return byName;
    for (const child of folder.children) {
      if (child instanceof import_obsidian2.TFile && child.extension === "md" && this.app.metadataCache.getFileCache(child)?.frontmatter?.[INDEX_KEY] === true) {
        return child;
      }
    }
    return null;
  }
  isExcluded(folder) {
    if (folder.isRoot()) return true;
    const list = this.settings.excludedFolders.split("\n").map((s) => (0, import_obsidian2.normalizePath)(s.trim())).filter((s) => s && s !== "/");
    return list.some((p) => folder.path === p || folder.path.startsWith(p + "/"));
  }
  allFolders() {
    return this.app.vault.getAllLoadedFiles().filter((f) => f instanceof import_obsidian2.TFolder && !f.isRoot());
  }
  // -------------------------------------------------------- index content
  fileAllowed(file) {
    if (!this.settings.includeNonMarkdown && file.extension !== "md") return false;
    const excluded = this.settings.excludedExtensions.split(",").map((s) => s.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
    return !excluded.includes(file.extension.toLowerCase());
  }
  collectItems(folder, index) {
    const files = /* @__PURE__ */ new Map();
    const walk = (dir) => {
      for (const child of dir.children) {
        if (child instanceof import_obsidian2.TFile) {
          if (child === index) continue;
          if (dir !== folder && this.findIndex(dir) === child) continue;
          if (this.fileAllowed(child)) files.set(child.path, { file: child, sub: false });
        } else if (child instanceof import_obsidian2.TFolder) {
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
    const items = [];
    for (const { file, sub } of files.values()) {
      items.push({
        linktext: this.app.metadataCache.fileToLinktext(file, index.path, true),
        name: file.basename,
        ext: file.extension,
        path: file.path,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        isSubIndex: sub
      });
    }
    return sortItems(items, this.settings.sortBy, this.settings.sortOrder, this.settings.subfoldersFirst);
  }
  renderOptions() {
    const fmt = this.settings.dateFormat || "YYYY-MM-DD";
    return {
      layout: this.settings.layout,
      columns: this.settings.columns,
      tableHeaders: this.settings.tableHeaders,
      itemTemplate: this.settings.itemTemplate,
      formatDate: (ms) => (0, import_obsidian2.moment)(ms).format(fmt)
    };
  }
  computeBody(index, items, content, force) {
    const opts = this.renderOptions();
    const existing = extractBlockBody(content);
    const preserve = !force && this.settings.preserveEdits && this.settings.layout !== "table" && existing !== null;
    if (!preserve) return renderItems(items, opts);
    return mergePreserving(
      existing,
      items,
      (linkpath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, index.path)?.path ?? null,
      opts
    );
  }
  /** Rewrites the managed block of the folder's index note. Returns true if it changed. */
  async updateFolder(folder, force) {
    if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof import_obsidian2.TFolder)) return false;
    if (this.isExcluded(folder)) return false;
    const index = this.findIndex(folder);
    if (!index) return false;
    const items = this.collectItems(folder, index);
    const current = await this.app.vault.read(index);
    const next = applyBlock(current, this.computeBody(index, items, current, force));
    if (next === current) return false;
    await this.app.vault.process(
      index,
      (data) => applyBlock(data, this.computeBody(index, items, data, force))
    );
    return true;
  }
  async updateAll(force) {
    let changed = 0;
    const folders = this.allFolders().sort(
      (a, b) => b.path.split("/").length - a.path.split("/").length
    );
    for (const folder of folders) {
      await this.enqueue(async () => {
        if (await this.updateFolder(folder, force)) changed++;
      });
    }
    return changed;
  }
  async createIndex(folder, open) {
    if (folder.isRoot()) return null;
    let index = this.findIndex(folder);
    if (!index) {
      const path = this.expectedIndexPath(folder);
      try {
        const content = fillNoteTemplate(
          this.settings.newNoteTemplate,
          {
            folder: folder.name,
            tag: this.settings.tag.replace(/^#/, "").trim(),
            date: (0, import_obsidian2.moment)().format(this.settings.dateFormat || "YYYY-MM-DD")
          },
          buildBlock([])
        );
        index = await this.app.vault.create(path, content);
      } catch (e) {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (!(existing instanceof import_obsidian2.TFile)) {
          console.error("Folder Hub: failed to create index", e);
          new import_obsidian2.Notice(`Folder Hub: \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C ${path}`);
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
  async adoptExisting(index) {
    const tag = this.settings.tag.replace(/^#/, "").trim();
    await this.app.fileManager.processFrontMatter(index, (fm) => {
      fm[INDEX_KEY] = true;
      if (tag) {
        const tags = fm.tags;
        const list = Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? tags.split(/[,\s]+/).filter(Boolean) : [];
        if (!list.map((t) => t.replace(/^#/, "")).includes(tag)) list.push(tag);
        fm.tags = list;
      }
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
    new import_obsidian2.Notice(`Folder Hub: \u0441\u043E\u0437\u0434\u0430\u043D\u043E \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432 \u2014 ${created}`);
  }
  // ------------------------------------------------------------ highlight
  refreshHighlight() {
    if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
    this.highlightTimer = window.setTimeout(() => {
      this.highlightTimer = null;
      if (this.styleEl) this.styleEl.textContent = this.buildCss();
    }, 200);
  }
  buildCss() {
    const s = this.settings;
    const color = /^#[0-9a-fA-F]{3,8}$/.test(s.highlightColor) ? s.highlightColor : "#e5a50a";
    const rules = [`body { --folder-hub-color: ${color}; }`];
    if (!s.highlightEnabled) return rules.join("\n");
    const filePaths = [];
    const folderPaths = [];
    for (const folder of this.allFolders()) {
      const index = this.findIndex(folder);
      if (!index) continue;
      filePaths.push(index.path);
      folderPaths.push(folder.path);
    }
    const weight = s.highlightBold ? "font-weight: 600;" : "";
    const icon = s.highlightIcon ? `content: ${cssString(s.highlightIcon + " ")};` : "";
    rules.push(`.folder-hub-index .inline-title { color: var(--folder-hub-color); }`);
    if (icon) rules.push(`.folder-hub-index .inline-title::before { ${icon} }`);
    if (filePaths.length) {
      const sel = (suffix) => filePaths.map((p) => `.nav-file-title[data-path=${cssString(p)}]${suffix}`).join(",\n");
      rules.push(`${sel("")} { color: var(--folder-hub-color); ${weight} }`);
      if (icon) rules.push(`${sel(" .nav-file-title-content::before")} { ${icon} }`);
    }
    if (s.highlightFolders && folderPaths.length) {
      const sel = folderPaths.map((p) => `.nav-folder-title[data-path=${cssString(p)}]`).join(",\n");
      rules.push(`${sel} { color: var(--folder-hub-color); }`);
    }
    return rules.join("\n");
  }
  // ---------------------------------------------------------------- graph
  /** Adds (or recolours) a graph colour group "tag:#<tag>" in graph.json. */
  async addGraphColorGroup() {
    const tag = this.settings.tag.replace(/^#/, "").trim();
    if (!tag) {
      new import_obsidian2.Notice("Folder Hub: \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u0442\u0435\u0433 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432.");
      return;
    }
    const adapter = this.app.vault.adapter;
    const path = (0, import_obsidian2.normalizePath)(`${this.app.vault.configDir}/graph.json`);
    let cfg = {};
    try {
      if (await adapter.exists(path)) cfg = JSON.parse(await adapter.read(path));
    } catch (e) {
      console.error("Folder Hub: cannot read graph.json", e);
    }
    const query = `tag:#${tag}`;
    const hex = this.settings.highlightColor.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
    const color = { a: 1, rgb: parseInt(full, 16) || 15049994 };
    cfg.colorGroups = cfg.colorGroups ?? [];
    const existing = cfg.colorGroups.find((g) => g.query === query);
    if (existing) existing.color = color;
    else cfg.colorGroups.unshift({ query, color });
    await adapter.write(path, JSON.stringify(cfg, null, 2));
    try {
      const graph = this.app.internalPlugins?.getPluginById?.("graph");
      const opts = graph?.instance?.options;
      if (opts) opts.colorGroups = cfg.colorGroups;
    } catch {
    }
    new import_obsidian2.Notice(
      "Folder Hub: \u0446\u0432\u0435\u0442\u043E\u0432\u0430\u044F \u0433\u0440\u0443\u043F\u043F\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0430 \u0432 \u0433\u0440\u0430\u0444. \u0417\u0430\u043A\u0440\u043E\u0439\u0442\u0435 \u0438 \u0441\u043D\u043E\u0432\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0433\u0440\u0430\u0444 (\u0435\u0441\u043B\u0438 \u0446\u0432\u0435\u0442 \u043D\u0435 \u043F\u043E\u044F\u0432\u0438\u043B\u0441\u044F \u2014 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 Obsidian).",
      8e3
    );
  }
};
