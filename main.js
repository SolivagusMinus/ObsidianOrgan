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
var import_obsidian10 = require("obsidian");

// src/calendar-view.ts
var import_obsidian3 = require("obsidian");

// src/daily.ts
var import_obsidian = require("obsidian");
function dailyConfig(app, s) {
  let core = {};
  try {
    core = app.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
  } catch {
  }
  return {
    folder: (s.dailyFolder.trim() || core.folder || "").replace(/^\/+|\/+$/g, ""),
    format: s.dailyFormat.trim() || core.format || "YYYY-MM-DD",
    template: s.dailyTemplate.trim() || core.template || ""
  };
}
function dailyPath(app, s, key) {
  const cfg = dailyConfig(app, s);
  const name = (0, import_obsidian.moment)(key, "YYYY-MM-DD").format(cfg.format);
  return (0, import_obsidian.normalizePath)(cfg.folder ? `${cfg.folder}/${name}.md` : `${name}.md`);
}
function findDaily(app, s, key) {
  const f = app.vault.getAbstractFileByPath(dailyPath(app, s, key));
  return f instanceof import_obsidian.TFile ? f : null;
}
async function ensureFolder(app, path) {
  const parts = path.split("/").slice(0, -1);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(app.vault.getAbstractFileByPath(cur) instanceof import_obsidian.TFolder)) {
      await app.vault.createFolder(cur).catch(() => void 0);
    }
  }
}
async function readTemplate(app, template) {
  if (!template) return "";
  const file = app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(template)) ?? app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(template + ".md")) ?? app.metadataCache.getFirstLinkpathDest(template, "");
  return file instanceof import_obsidian.TFile ? app.vault.read(file) : "";
}
async function openDaily(app, s, key) {
  let file = findDaily(app, s, key);
  if (!file) {
    const cfg = dailyConfig(app, s);
    const path = dailyPath(app, s, key);
    const date = (0, import_obsidian.moment)(key, "YYYY-MM-DD");
    const title = path.split("/").pop().replace(/\.md$/, "");
    const content = (await readTemplate(app, cfg.template)).replace(/\{\{date:([^}]+)\}\}/g, (_, f) => date.format(f.trim())).replace(/\{\{time:([^}]+)\}\}/g, (_, f) => (0, import_obsidian.moment)().format(f.trim())).replace(/\{\{date\}\}/g, date.format(cfg.format)).replace(/\{\{time\}\}/g, (0, import_obsidian.moment)().format("HH:mm")).replace(/\{\{title\}\}/g, title);
    await ensureFolder(app, path);
    file = await app.vault.create(path, content);
  }
  await app.workspace.getLeaf(false).openFile(file);
  return file;
}

// src/tracker.ts
var import_obsidian2 = require("obsidian");

// src/words.ts
var CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
var WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;
function countWords(text) {
  let body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  body = body.replace(/%%[\s\S]*?%%/g, " ");
  const cjk = body.match(CJK)?.length ?? 0;
  const words = body.replace(CJK, " ").match(WORD)?.length ?? 0;
  return cjk + words;
}
var pad = (n) => String(n).padStart(2, "0");
function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function computeStreak(stats, todayKey2, goal) {
  const min = goal > 0 ? goal : 1;
  const met = (k2) => (stats[k2]?.added ?? 0) >= min;
  let k = met(todayKey2) ? todayKey2 : addDays(todayKey2, -1);
  let n = 0;
  while (met(k) && n < 1e4) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}
function heatLevel(words, goal) {
  if (words <= 0) return 0;
  const r = words / (goal > 0 ? goal : 500);
  if (r >= 1) return 4;
  if (r >= 0.5) return 3;
  if (r >= 0.25) return 2;
  return 1;
}
function pluralRu(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// src/tracker.ts
var todayKey = () => (0, import_obsidian2.moment)().format("YYYY-MM-DD");
var WordTracker = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.baselines = /* @__PURE__ */ new Map();
    /** True once every note in the vault has been counted (needed for branch levels). */
    this.ready = false;
  }
  start() {
    const { app } = this.plugin;
    const p = this.plugin;
    p.registerEvent(app.workspace.on("file-open", (f) => f && void this.ensureBaseline(f)));
    p.registerEvent(
      app.vault.on("create", async (f) => {
        await this.ensureBaseline(f);
        if (f instanceof import_obsidian2.TFile) this.plugin.levels.onWordsUpdated(f);
      })
    );
    p.registerEvent(app.vault.on("modify", (f) => void this.onModify(f)));
    p.registerEvent(
      app.vault.on("delete", (f) => {
        this.baselines.delete(f.path);
        this.plugin.levels.scheduleRefresh();
      })
    );
    p.registerEvent(
      app.vault.on("rename", (f, old) => {
        const v = this.baselines.get(old);
        this.baselines.delete(old);
        if (v !== void 0) this.baselines.set(f.path, v);
      })
    );
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof import_obsidian2.MarkdownView && leaf.view.file) void this.ensureBaseline(leaf.view.file);
    });
    window.setTimeout(() => void this.warmUp(), 1500);
  }
  async warmUp() {
    const files = this.plugin.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
      await this.ensureBaseline(files[i]);
      if (i % 40 === 39) await new Promise((r) => window.setTimeout(r, 0));
    }
    this.ready = true;
    this.plugin.levels.onReady();
  }
  /** Last known word count of a note, or undefined if not counted yet. */
  wordsOf(path) {
    return this.baselines.get(path);
  }
  today() {
    return this.plugin.wordStats[todayKey()] ?? { added: 0, removed: 0 };
  }
  isMd(f) {
    return f instanceof import_obsidian2.TFile && f.extension === "md";
  }
  async ensureBaseline(f) {
    if (!this.isMd(f) || this.baselines.has(f.path)) return;
    const n = countWords(await this.plugin.app.vault.cachedRead(f));
    if (!this.baselines.has(f.path)) this.baselines.set(f.path, n);
  }
  isOpenInEditor(f) {
    return this.plugin.app.workspace.getLeavesOfType("markdown").some((l) => l.view instanceof import_obsidian2.MarkdownView && l.view.file?.path === f.path);
  }
  async onModify(f) {
    var _a;
    if (!this.isMd(f)) return;
    const n = countWords(await this.plugin.app.vault.read(f));
    const prev = this.baselines.get(f.path);
    this.baselines.set(f.path, n);
    if (n === prev) return;
    this.plugin.levels.onWordsUpdated(f);
    if (prev === void 0 || !this.plugin.settings.wordCountEnabled) return;
    if (!this.isOpenInEditor(f) || this.plugin.isIndexNote(f)) return;
    const key = todayKey();
    const day = (_a = this.plugin.wordStats)[key] ?? (_a[key] = { added: 0, removed: 0 });
    const before = day.added;
    if (n > prev) day.added += n - prev;
    else day.removed += prev - n;
    this.plugin.onWordsChanged(before, day.added);
  }
};

// src/calendar-view.ts
var VIEW_TYPE_CALENDAR = "folder-hub-calendar";
var KEY = "YYYY-MM-DD";
var SVG_NS = "http://www.w3.org/2000/svg";
var RING_R = 46;
var RING_C = 2 * Math.PI * RING_R;
var WORDS = ["\u0441\u043B\u043E\u0432\u043E", "\u0441\u043B\u043E\u0432\u0430", "\u0441\u043B\u043E\u0432"];
var DAYS = ["\u0434\u0435\u043D\u044C", "\u0434\u043D\u044F", "\u0434\u043D\u0435\u0439"];
var NOTES = ["\u0437\u0430\u043C\u0435\u0442\u043A\u0430", "\u0437\u0430\u043C\u0435\u0442\u043A\u0438", "\u0437\u0430\u043C\u0435\u0442\u043E\u043A"];
var CalendarView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.month = (0, import_obsidian3.moment)().startOf("month");
    this.selected = todayKey();
    this.lastToday = todayKey();
    this.shownToday = 0;
    this.branchesEl = null;
    this.cells = /* @__PURE__ */ new Map();
  }
  getViewType() {
    return VIEW_TYPE_CALENDAR;
  }
  getDisplayText() {
    return "\u041A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C \u0438 \u0441\u043B\u043E\u0432\u0430";
  }
  getIcon() {
    return "calendar-days";
  }
  get animated() {
    return this.plugin.settings.animations && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }
  async onOpen() {
    this.render();
    this.registerInterval(
      window.setInterval(() => {
        if (todayKey() !== this.lastToday) {
          this.lastToday = todayKey();
          this.selected = this.lastToday;
          this.month = (0, import_obsidian3.moment)().startOf("month");
          this.render();
        }
      }, 6e4)
    );
    const refreshMonth = () => this.renderMonth("none");
    this.registerEvent(this.app.vault.on("create", refreshMonth));
    this.registerEvent(this.app.vault.on("delete", refreshMonth));
    this.registerEvent(this.app.vault.on("rename", refreshMonth));
  }
  async onClose() {
    this.contentEl.empty();
  }
  // ------------------------------------------------------------ rendering
  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("fh-cal");
    root.toggleClass("fh-no-anim", !this.animated);
    this.renderToday(root.createDiv({ cls: "fh-card fh-today" }));
    this.weekEl = root.createDiv({ cls: "fh-card fh-week" });
    this.renderWeek(true);
    this.branchesEl = root.createDiv({ cls: "fh-card fh-branches" });
    this.renderBranches(true);
    const monthCard = root.createDiv({ cls: "fh-card fh-month" });
    this.renderMonthHeader(monthCard);
    this.gridWrap = monthCard.createDiv({ cls: "fh-grid-wrap" });
    this.renderMonth("none");
    this.detailsEl = root.createDiv({ cls: "fh-card fh-details" });
    this.renderDetails();
  }
  renderToday(card) {
    const goal = this.plugin.settings.dailyGoal;
    const day = this.plugin.tracker.today();
    this.ringWrap = card.createDiv({ cls: "fh-ring" });
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 112 112");
    const track = document.createElementNS(SVG_NS, "circle");
    const fg = document.createElementNS(SVG_NS, "circle");
    for (const c of [track, fg]) {
      c.setAttribute("cx", "56");
      c.setAttribute("cy", "56");
      c.setAttribute("r", String(RING_R));
    }
    track.setAttribute("class", "fh-ring-track");
    fg.setAttribute("class", "fh-ring-fg");
    fg.style.strokeDasharray = String(RING_C);
    fg.style.strokeDashoffset = String(RING_C);
    svg.append(track, fg);
    this.ringWrap.appendChild(svg);
    this.ringFg = fg;
    const center = this.ringWrap.createDiv({ cls: "fh-ring-center" });
    this.numEl = center.createDiv({ cls: "fh-ring-num", text: "0" });
    this.goalEl = center.createDiv({ cls: "fh-ring-goal" });
    const side = card.createDiv({ cls: "fh-today-side" });
    side.createDiv({ cls: "fh-title", text: "\u0421\u0435\u0433\u043E\u0434\u043D\u044F" });
    this.metaEl = side.createDiv({ cls: "fh-meta" });
    this.shownToday = 0;
    window.requestAnimationFrame(() => this.updateToday(day.added, goal));
  }
  /** Updates the ring, number and meta in place (called on every save). */
  updateToday(added = this.plugin.tracker.today().added, goal = this.plugin.settings.dailyGoal) {
    if (!this.numEl) return;
    const day = this.plugin.tracker.today();
    const progress = goal > 0 ? Math.min(1, added / goal) : added > 0 ? 1 : 0;
    this.ringFg.style.strokeDashoffset = String(RING_C * (1 - progress));
    this.ringWrap.toggleClass("is-done", goal > 0 && added >= goal);
    this.animateNumber(this.numEl, this.shownToday, added);
    this.shownToday = added;
    this.goalEl.setText(goal > 0 ? `\u0438\u0437 ${goal.toLocaleString()}` : pluralRu(added, WORDS));
    const streak = computeStreak(this.plugin.wordStats, todayKey(), goal);
    this.metaEl.empty();
    if (goal > 0 && added >= goal) {
      const b = this.metaEl.createDiv({ cls: "fh-badge" });
      (0, import_obsidian3.setIcon)(b.createSpan(), "check-circle");
      b.createSpan({ text: "\u0426\u0435\u043B\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430" });
    } else if (goal > 0) {
      this.metaEl.createDiv({
        cls: "fh-muted",
        text: `\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ${(goal - added).toLocaleString()} ${pluralRu(goal - added, WORDS)}`
      });
    }
    const st = this.metaEl.createDiv({ cls: "fh-streak" + (streak > 0 ? " is-active" : "") });
    st.createSpan({ cls: "fh-flame", text: "\u{1F525}" });
    st.createSpan({ text: streak > 0 ? `${streak} ${pluralRu(streak, DAYS)} \u043F\u043E\u0434\u0440\u044F\u0434` : "\u0421\u0435\u0440\u0438\u044F \u043D\u0435 \u043D\u0430\u0447\u0430\u0442\u0430" });
    if (day.removed > 0) {
      this.metaEl.createDiv({ cls: "fh-muted", text: `\u0423\u0434\u0430\u043B\u0435\u043D\u043E: ${day.removed.toLocaleString()}` });
    }
    const cell = this.cells.get(todayKey());
    if (cell) this.applyHeat(cell, added);
    this.renderWeek(false);
    if (this.selected === todayKey()) this.renderDetails(false);
  }
  celebrate() {
    if (!this.ringWrap) return;
    this.ringWrap.removeClass("is-celebrating");
    void this.ringWrap.offsetWidth;
    this.ringWrap.addClass("is-celebrating");
    if (!this.animated) return;
    const burst = this.ringWrap.createDiv({ cls: "fh-confetti" });
    const colors = ["var(--interactive-accent)", "var(--color-yellow)", "var(--color-green)", "var(--color-pink)", "var(--color-blue)"];
    for (let i = 0; i < 28; i++) {
      const p = burst.createSpan();
      const angle = Math.PI * 2 * i / 28 + Math.random() * 0.4;
      const dist = 50 + Math.random() * 45;
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 80}ms`;
    }
    window.setTimeout(() => burst.remove(), 1400);
  }
  animateNumber(el, from, to) {
    if (!this.animated || from === to) {
      el.setText(to.toLocaleString());
      return;
    }
    const start = performance.now();
    const dur = 700;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.setText(Math.round(from + (to - from) * eased).toLocaleString());
      if (t < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }
  /** Single-series bar chart of the last 7 days, with a goal reference line. */
  renderWeek(initial) {
    const goal = this.plugin.settings.dailyGoal;
    const today = todayKey();
    const keys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const values = keys.map((k) => this.plugin.wordStats[k]?.added ?? 0);
    const max = Math.max(goal, ...values, 1);
    const total = values.reduce((a, b) => a + b, 0);
    if (initial || !this.weekEl.querySelector(".fh-bars")) {
      this.weekEl.empty();
      const head = this.weekEl.createDiv({ cls: "fh-row-between" });
      head.createDiv({ cls: "fh-title", text: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 7 \u0434\u043D\u0435\u0439" });
      head.createDiv({ cls: "fh-muted fh-week-total" });
      const plot = this.weekEl.createDiv({ cls: "fh-bars" });
      if (goal > 0) plot.createDiv({ cls: "fh-goal-line" });
      const labels = this.weekEl.createDiv({ cls: "fh-bar-labels" });
      keys.forEach((k, i) => {
        const col = plot.createDiv({ cls: "fh-bar-col" + (k === today ? " is-today" : "") });
        const bar = col.createDiv({ cls: "fh-bar" });
        bar.style.animationDelay = `${i * 50}ms`;
        col.addEventListener("click", () => this.select(k));
        labels.createDiv({
          cls: "fh-bar-label" + (k === today ? " is-today" : ""),
          text: (0, import_obsidian3.moment)(k, KEY).format("dd")
        });
      });
    }
    this.weekEl.querySelector(".fh-week-total")?.setText(`${total.toLocaleString()} ${pluralRu(total, WORDS)}`);
    const line2 = this.weekEl.querySelector(".fh-goal-line");
    if (line2) {
      line2.style.bottom = `${goal / max * 100}%`;
      (0, import_obsidian3.setTooltip)(line2, `\u0426\u0435\u043B\u044C: ${goal.toLocaleString()}`);
    }
    this.weekEl.querySelectorAll(".fh-bar-col").forEach((col, i) => {
      const v = values[i];
      const bar = col.querySelector(".fh-bar");
      bar.style.height = v > 0 ? `max(4px, ${v / max * 100}%)` : "0";
      bar.toggleClass("is-done", goal > 0 && v >= goal);
      (0, import_obsidian3.setTooltip)(col, `${(0, import_obsidian3.moment)(keys[i], KEY).format("dd, D MMM")}: ${v.toLocaleString()} ${pluralRu(v, WORDS)}`);
    });
  }
  /** Top-level branches with their level and XP bar. */
  renderBranches(initial = false) {
    const el = this.branchesEl;
    if (!el) return;
    const list = this.plugin.settings.branchLevels ? this.plugin.levels.topBranches().slice(0, 10) : [];
    el.toggle(list.length > 0);
    if (!list.length) return;
    el.empty();
    const head = el.createDiv({ cls: "fh-row-between" });
    head.createDiv({ cls: "fh-title", text: "\u0412\u0435\u0442\u043A\u0438" });
    if (!this.plugin.tracker.ready) head.createDiv({ cls: "fh-muted", text: "\u043F\u043E\u0434\u0441\u0447\u0451\u0442\u2026" });
    list.forEach((b, i) => {
      const row = el.createDiv({ cls: "fh-branch-row" });
      row.style.setProperty("--i", String(i));
      row.createSpan({ cls: "fh-level-sub-badge", text: String(b.info.level) });
      const mid = row.createDiv({ cls: "fh-branch-mid" });
      mid.createDiv({ cls: "fh-branch-name", text: b.folder.name });
      const fill = mid.createDiv({ cls: "fh-level-bar is-small" }).createDiv({ cls: "fh-level-fill" });
      const pct = `${Math.round(b.info.progress * 100)}%`;
      if (initial && this.animated) {
        fill.style.width = "0%";
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => fill.style.width = pct));
      } else {
        fill.style.width = pct;
      }
      row.createSpan({ cls: "fh-muted fh-branch-xp", text: `${b.info.xp.toLocaleString()} XP` });
      (0, import_obsidian3.setTooltip)(
        row,
        `\u0423\u0440\u043E\u0432\u0435\u043D\u044C ${b.info.level}: ${b.info.xp.toLocaleString()} / ${b.info.next.toLocaleString()} XP \xB7 ${b.notes} ${pluralRu(b.notes, NOTES)} \xB7 ${b.words.toLocaleString()} ${pluralRu(b.words, WORDS)}`
      );
      row.addEventListener("click", () => {
        const index = this.plugin.findIndex(b.folder);
        if (index) void this.app.workspace.getLeaf(false).openFile(index);
      });
    });
  }
  renderMonthHeader(card) {
    const head = card.createDiv({ cls: "fh-month-head" });
    const prev = head.createEl("button", { cls: "clickable-icon fh-nav", attr: { "aria-label": "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446" } });
    (0, import_obsidian3.setIcon)(prev, "chevron-left");
    head.createDiv({ cls: "fh-month-title" });
    const next = head.createEl("button", { cls: "clickable-icon fh-nav", attr: { "aria-label": "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446" } });
    (0, import_obsidian3.setIcon)(next, "chevron-right");
    const todayBtn = head.createEl("button", { cls: "fh-today-btn", text: "\u0421\u0435\u0433\u043E\u0434\u043D\u044F" });
    prev.addEventListener("click", () => {
      this.month = this.month.clone().subtract(1, "month");
      this.renderMonth("right");
    });
    next.addEventListener("click", () => {
      this.month = this.month.clone().add(1, "month");
      this.renderMonth("left");
    });
    todayBtn.addEventListener("click", () => {
      const target = (0, import_obsidian3.moment)().startOf("month");
      const dir = target.isSame(this.month) ? "none" : target.isAfter(this.month) ? "left" : "right";
      this.month = target;
      this.select(todayKey());
      this.renderMonth(dir);
    });
  }
  renderMonth(dir) {
    if (!this.gridWrap) return;
    const title = this.contentEl.querySelector(".fh-month-title");
    const label = this.month.format("MMMM YYYY");
    title?.setText(label.charAt(0).toUpperCase() + label.slice(1));
    const createdByDay = this.createdNotesByDay();
    const today = todayKey();
    const monthIdx = this.month.month();
    const start = this.month.clone().startOf("isoWeek");
    const end = this.month.clone().endOf("month").endOf("isoWeek");
    this.gridWrap.empty();
    this.cells.clear();
    const grid = this.gridWrap.createDiv({ cls: "fh-grid" });
    if (dir !== "none") grid.addClass(dir === "left" ? "fh-slide-left" : "fh-slide-right");
    for (let i2 = 0; i2 < 7; i2++) {
      grid.createDiv({ cls: "fh-weekday", text: start.clone().add(i2, "day").format("dd") });
    }
    let i = 0;
    for (const d = start.clone(); d.isSameOrBefore(end, "day"); d.add(1, "day"), i++) {
      const key = d.format(KEY);
      const words = this.plugin.wordStats[key]?.added ?? 0;
      const created = createdByDay.get(key)?.length ?? 0;
      const cell = grid.createEl("button", { cls: "fh-day" });
      cell.style.setProperty("--i", String(i));
      cell.createSpan({ cls: "fh-day-num", text: String(d.date()) });
      if (d.month() !== monthIdx) cell.addClass("is-other");
      if (key === today) cell.addClass("is-today");
      if (key === this.selected) cell.addClass("is-selected");
      if (findDaily(this.app, this.plugin.settings, key)) cell.addClass("has-daily");
      if (created > 0) {
        const dots = cell.createDiv({ cls: "fh-dots" });
        for (let k = 0; k < Math.min(3, created); k++) dots.createSpan();
      }
      this.applyHeat(cell, words);
      const parts = [`${d.format("D MMMM")}: ${words.toLocaleString()} ${pluralRu(words, WORDS)}`];
      if (created) parts.push(`${created} ${pluralRu(created, NOTES)} \u0441\u043E\u0437\u0434\u0430\u043D\u043E`);
      (0, import_obsidian3.setTooltip)(cell, parts.join(" \xB7 "));
      cell.addEventListener("click", () => {
        if (this.selected === key) void this.openDay(key);
        else this.select(key);
      });
      this.cells.set(key, cell);
    }
  }
  applyHeat(cell, words) {
    for (let l = 0; l <= 4; l++) cell.removeClass(`fh-heat-${l}`);
    cell.addClass(`fh-heat-${heatLevel(words, this.plugin.settings.dailyGoal)}`);
  }
  select(key) {
    this.cells.get(this.selected)?.removeClass("is-selected");
    this.selected = key;
    const cell = this.cells.get(key);
    if (cell) {
      cell.addClass("is-selected");
    } else {
      const m = (0, import_obsidian3.moment)(key, KEY).startOf("month");
      const dir = m.isAfter(this.month) ? "left" : "right";
      this.month = m;
      this.renderMonth(dir);
    }
    this.renderDetails();
  }
  async openDay(key) {
    await openDaily(this.app, this.plugin.settings, key);
    this.renderMonth("none");
    this.renderDetails(false);
  }
  renderDetails(animate = true) {
    const el = this.detailsEl;
    if (!el) return;
    const key = this.selected;
    const date = (0, import_obsidian3.moment)(key, KEY);
    const stat = this.plugin.wordStats[key] ?? { added: 0, removed: 0 };
    const created = this.createdNotesByDay().get(key) ?? [];
    const daily = findDaily(this.app, this.plugin.settings, key);
    el.empty();
    if (animate) {
      el.removeClass("fh-fade");
      void el.offsetWidth;
      el.addClass("fh-fade");
    }
    const title = date.format("D MMMM YYYY, dddd");
    el.createDiv({ cls: "fh-title", text: title.charAt(0).toUpperCase() + title.slice(1) });
    const line2 = el.createDiv({ cls: "fh-detail-line" });
    (0, import_obsidian3.setIcon)(line2.createSpan({ cls: "fh-icon" }), "pencil");
    line2.createSpan({ text: `${stat.added.toLocaleString()} ${pluralRu(stat.added, WORDS)} \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u043E` });
    if (stat.removed) line2.createSpan({ cls: "fh-muted", text: ` \xB7 ${stat.removed.toLocaleString()} \u0443\u0434\u0430\u043B\u0435\u043D\u043E` });
    const btn = el.createEl("button", { cls: "mod-cta fh-daily-btn" });
    (0, import_obsidian3.setIcon)(btn.createSpan(), daily ? "file-text" : "file-plus");
    btn.createSpan({ text: daily ? "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0434\u043D\u044F" : "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0434\u043D\u044F" });
    btn.addEventListener("click", () => void this.openDay(key));
    if (created.length) {
      el.createDiv({ cls: "fh-subtitle", text: `\u041D\u043E\u0432\u044B\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 (${created.length})` });
      const list = el.createEl("ul", { cls: "fh-note-list" });
      created.slice(0, 30).forEach((f, i) => {
        const li = list.createEl("li");
        li.style.setProperty("--i", String(i));
        const a = li.createEl("a", { cls: "internal-link", text: f.basename });
        a.addEventListener("click", (e) => {
          e.preventDefault();
          void this.app.workspace.getLeaf(false).openFile(f);
        });
      });
    }
  }
  createdNotesByDay() {
    const map = /* @__PURE__ */ new Map();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.plugin.isIndexNote(f)) continue;
      const k = toKey(new Date(f.stat.ctime));
      const list = map.get(k);
      if (list) list.push(f);
      else map.set(k, [f]);
    }
    for (const list of map.values()) list.sort((a, b) => a.stat.ctime - b.stat.ctime);
    return map;
  }
};

// src/branch-levels.ts
var import_obsidian4 = require("obsidian");

// src/levels.ts
var XP_PER_NOTE = 25;
function branchXp(words, notes) {
  return Math.max(0, Math.round(words)) + Math.max(0, notes) * XP_PER_NOTE;
}
function xpForLevel(level) {
  return 100 * level * (level + 1);
}
function levelFromXp(xp) {
  const safe = Math.max(0, xp);
  let level = Math.floor((-1 + Math.sqrt(1 + safe / 25)) / 2);
  while (xpForLevel(level + 1) <= safe) level++;
  while (level > 0 && xpForLevel(level) > safe) level--;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp: safe, floor, next, progress: (safe - floor) / (next - floor) };
}
var LEVEL_FENCE = ["```folder-hub-level", "```"];
function stripLevelFence(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === LEVEL_FENCE[0] && lines[i + 1]?.trim() === LEVEL_FENCE[1]) {
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

// src/branch-levels.ts
var NOTES2 = ["\u0437\u0430\u043C\u0435\u0442\u043A\u0430", "\u0437\u0430\u043C\u0435\u0442\u043A\u0438", "\u0437\u0430\u043C\u0435\u0442\u043E\u043A"];
var WORDS2 = ["\u0441\u043B\u043E\u0432\u043E", "\u0441\u043B\u043E\u0432\u0430", "\u0441\u043B\u043E\u0432"];
var LevelCard = class extends import_obsidian4.MarkdownRenderChild {
  constructor(el, levels, sourcePath) {
    super(el);
    this.levels = levels;
    this.sourcePath = sourcePath;
    this.shownLevel = -1;
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
    const folder = file instanceof import_obsidian4.TFile ? file.parent : null;
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
    const badge = el.querySelector(".fh-level-badge");
    badge.setText(String(st.info.level));
    if (levelChanged) {
      badge.removeClass("fh-level-up");
      void badge.offsetWidth;
      badge.addClass("fh-level-up");
    }
    el.querySelector(".fh-level-title").setText(`\u0423\u0440\u043E\u0432\u0435\u043D\u044C ${st.info.level} \xB7 ${folder.name}`);
    const fill = el.querySelector(".fh-level-fill");
    const pct = `${Math.round(st.info.progress * 100)}%`;
    if (first) {
      fill.style.width = "0%";
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => fill.style.width = pct));
    } else {
      fill.style.width = pct;
    }
    const toNext = st.info.next - st.info.xp;
    el.querySelector(".fh-level-meta").setText(
      st.complete ? `${st.info.xp.toLocaleString()} / ${st.info.next.toLocaleString()} XP \xB7 \u0434\u043E ${st.info.level + 1}-\u0433\u043E: ${toNext.toLocaleString()} \xB7 ${st.notes} ${pluralRu(st.notes, NOTES2)} \xB7 ${st.words.toLocaleString()} ${pluralRu(st.words, WORDS2)}` : "\u041F\u043E\u0434\u0441\u0447\u0451\u0442 \u0441\u043B\u043E\u0432\u2026"
    );
    const subsEl = el.querySelector(".fh-level-subs");
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
};
var BranchLevels = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.cards = /* @__PURE__ */ new Set();
    this.lastLevels = /* @__PURE__ */ new Map();
    this.updateTimer = null;
  }
  start() {
    this.plugin.registerMarkdownCodeBlockProcessor(
      "folder-hub-level",
      (_src, el, ctx) => {
        if (!this.plugin.settings.branchLevels) return;
        ctx.addChild(new LevelCard(el, this, ctx.sourcePath));
      }
    );
  }
  stats(folder) {
    let words = 0;
    let notes = 0;
    let complete = this.plugin.tracker.ready;
    const walk = (dir) => {
      for (const child of dir.children) {
        if (child instanceof import_obsidian4.TFolder) {
          if (!this.plugin.isExcluded(child)) walk(child);
        } else if (child instanceof import_obsidian4.TFile && child.extension === "md" && !this.plugin.isIndexNote(child)) {
          notes++;
          const w = this.plugin.tracker.wordsOf(child.path);
          if (w === void 0) complete = false;
          else words += w;
        }
      }
    };
    walk(folder);
    return { folder, words, notes, info: levelFromXp(branchXp(words, notes)), complete };
  }
  /** Nearest descendant folders that have their own index note. */
  subBranches(folder) {
    const out = [];
    const walk = (dir) => {
      for (const child of dir.children) {
        if (!(child instanceof import_obsidian4.TFolder) || this.plugin.isExcluded(child)) continue;
        if (this.plugin.findIndex(child)) out.push(this.stats(child));
        else walk(child);
      }
    };
    walk(folder);
    return out.sort((a, b) => b.info.xp - a.info.xp);
  }
  /** Top-level branches (for the calendar panel). */
  topBranches() {
    return this.subBranches(this.plugin.app.vault.getRoot());
  }
  /** Called once the tracker has counted every note. */
  onReady() {
    for (const folder of this.indexFolders()) this.lastLevels.set(folder.path, this.stats(folder).info.level);
    this.refreshViews();
  }
  /** Called after a note's word count changed. */
  onWordsUpdated(file) {
    if (!this.plugin.tracker.ready || !this.plugin.settings.branchLevels) return;
    for (let dir = file.parent; dir && !dir.isRoot(); dir = dir.parent) {
      const index = this.plugin.findIndex(dir);
      if (!index) continue;
      const level = this.stats(dir).info.level;
      const prev = this.lastLevels.get(dir.path);
      this.lastLevels.set(dir.path, level);
      if (prev !== void 0 && level > prev) {
        new import_obsidian4.Notice(`\u2B06 \u0412\u0435\u0442\u043A\u0430 \xAB${dir.name}\xBB \u0434\u043E\u0441\u0442\u0438\u0433\u043B\u0430 ${level}-\u0433\u043E \u0443\u0440\u043E\u0432\u043D\u044F!`, 6e3);
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
  indexFolders() {
    return this.plugin.app.vault.getAllLoadedFiles().filter((f) => f instanceof import_obsidian4.TFolder && !f.isRoot() && !!this.plugin.findIndex(f));
  }
};

// src/graph.ts
var import_obsidian5 = require("obsidian");

// src/skilltree.ts
var DIRECTIONS = {
  up: { label: "\u2191 \u0412\u0432\u0435\u0440\u0445", deg: -90 },
  "up-right": { label: "\u2197 \u0412\u0432\u0435\u0440\u0445-\u0432\u043F\u0440\u0430\u0432\u043E", deg: -45 },
  right: { label: "\u2192 \u0412\u043F\u0440\u0430\u0432\u043E", deg: 0 },
  "down-right": { label: "\u2198 \u0412\u043D\u0438\u0437-\u0432\u043F\u0440\u0430\u0432\u043E", deg: 45 },
  down: { label: "\u2193 \u0412\u043D\u0438\u0437", deg: 90 },
  "down-left": { label: "\u2199 \u0412\u043D\u0438\u0437-\u0432\u043B\u0435\u0432\u043E", deg: 135 },
  left: { label: "\u2190 \u0412\u043B\u0435\u0432\u043E", deg: 180 },
  "up-left": { label: "\u2196 \u0412\u0432\u0435\u0440\u0445-\u0432\u043B\u0435\u0432\u043E", deg: -135 }
};
var TAU = Math.PI * 2;
var rad = (deg) => deg * Math.PI / 180;
var norm = (a) => (a % TAU + TAU) % TAU;
function weightOf(n) {
  return 1 + Math.min(n.files.length, 20) * 0.1 + n.children.reduce((s, c) => s + weightOf(c), 0);
}
function branchAngles(roots, directions) {
  const n = roots.length;
  if (n === 0) return [];
  const fixed = roots.map((r) => directions[r.name]);
  const weights = roots.map(weightOf);
  if (fixed.every((d) => d === void 0)) {
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return weights.map((w) => {
      const a = -Math.PI / 2 + (acc + w / 2) / total * TAU;
      acc += w;
      return norm(a);
    });
  }
  const angles = fixed.map((d) => d === void 0 ? void 0 : norm(rad(d)));
  const auto = roots.map((_, i) => i).filter((i) => angles[i] === void 0);
  auto.sort((a, b) => weights[b] - weights[a]);
  for (const i of auto) {
    const taken = angles.filter((a) => a !== void 0).sort((a, b) => a - b);
    let bestStart = taken[0];
    let bestSize = -1;
    for (let k = 0; k < taken.length; k++) {
      const start = taken[k];
      const end = k + 1 < taken.length ? taken[k + 1] : taken[0] + TAU;
      if (end - start > bestSize) {
        bestSize = end - start;
        bestStart = start;
      }
    }
    angles[i] = norm(bestStart + bestSize / 2);
  }
  return angles;
}
function branchSectors(centres, spread) {
  const n = centres.length;
  if (n === 1) {
    const half = Math.min(spread, TAU) / 2;
    return [[centres[0] - half, centres[0] + half]];
  }
  const order = centres.map((a, i) => ({ a, i })).sort((p, q) => p.a - q.a);
  const out = new Array(n);
  order.forEach(({ a, i }, k) => {
    const prev = order[(k - 1 + n) % n].a - (k === 0 ? TAU : 0);
    const next = order[(k + 1) % n].a + (k === n - 1 ? TAU : 0);
    const left = Math.min((a - prev) / 2, spread / 2);
    const right = Math.min((next - a) / 2, spread / 2);
    out[i] = [a - left * 0.92, a + right * 0.92];
  });
  return out;
}
function polar(r, a) {
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}
function fanFiles(out, node, at, dir, step) {
  const perRow = 9;
  node.files.forEach((id, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, node.files.length - row * perRow);
    const k = i % perRow;
    const width = Math.min(rad(150), rad(18) * Math.max(inRow - 1, 0));
    const a = inRow === 1 ? dir : dir - width / 2 + width * k / (inRow - 1);
    const r = step * (0.38 + row * 0.16);
    out.set(id, { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r });
  });
}
function layoutRadial(roots, o) {
  const out = /* @__PURE__ */ new Map();
  const centres = branchAngles(roots, o.directions);
  const sectors = branchSectors(centres, rad(Math.max(20, Math.min(360, o.spreadDeg))));
  const place = (node, depth, a0, a1) => {
    const a = (a0 + a1) / 2;
    const p = polar(depth * o.step, a);
    out.set(node.id, p);
    if (o.pinFiles && node.files.length) fanFiles(out, node, p, a, o.step);
    const total = node.children.reduce((s, c) => s + weightOf(c), 0);
    let cur = a0;
    for (const child of node.children) {
      const w = (a1 - a0) * weightOf(child) / total;
      place(child, depth + 1, cur, cur + w);
      cur += w;
    }
  };
  roots.forEach((r, i) => place(r, 1, sectors[i][0], sectors[i][1]));
  return out;
}
function layoutUp(roots, o) {
  const out = /* @__PURE__ */ new Map();
  const slot = o.step * 0.56;
  const rise = o.step * 1.1;
  let next = 0;
  const xs = /* @__PURE__ */ new Map();
  let maxDepth = 1;
  const assign = (node, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    let x;
    if (node.children.length === 0) {
      x = next;
      next += slot * (o.pinFiles && node.files.length > 4 ? 1.6 : 1);
    } else {
      const cx2 = node.children.map((c) => assign(c, depth + 1));
      x = (cx2[0] + cx2[cx2.length - 1]) / 2;
    }
    xs.set(node.id, x);
    out.set(node.id, { x, y: -depth * rise });
    return x;
  };
  const sorted = [...roots].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach((r, i) => {
    if (i > 0) next += slot * 0.8;
    assign(r, 1);
  });
  const cx = (Math.min(...xs.values()) + Math.max(...xs.values())) / 2;
  const cy = (-rise - maxDepth * rise) / 2;
  for (const [id, p] of out) out.set(id, { x: p.x - cx, y: p.y - cy });
  if (o.pinFiles) {
    const walk = (n) => {
      const p = out.get(n.id);
      if (n.files.length) fanFiles(out, n, p, -Math.PI / 2, o.step * 0.75);
      n.children.forEach(walk);
    };
    roots.forEach(walk);
  }
  return out;
}
function layoutSkillTree(roots, o) {
  if (roots.length === 0) return /* @__PURE__ */ new Map();
  return o.style === "up" ? layoutUp(roots, o) : layoutRadial(roots, o);
}

// src/graph.ts
var hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return parseInt(full, 16) || 0;
};
var GraphTree = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.originals = /* @__PURE__ */ new Map();
    this.views = /* @__PURE__ */ new Map();
    this.pinned = /* @__PURE__ */ new Map();
    this.timers = /* @__PURE__ */ new Map();
    this.refreshTimer = null;
    /** Renderers that already played the "grow" animation. */
    this.grown = /* @__PURE__ */ new WeakSet();
    this.growing = /* @__PURE__ */ new Map();
    this.frozen = /* @__PURE__ */ new Map();
    this.freezeTimers = /* @__PURE__ */ new Map();
    this.depthCache = null;
    this.posCache = null;
    this.holdTimer = null;
    /** Per graph: notes clamped on the last tick (released on the next one). */
    this.holdRelease = /* @__PURE__ */ new Map();
    /** How often each note had to be pulled back; repeat offenders widen the barrier instead. */
    this.holdStrikes = /* @__PURE__ */ new Map();
    this.holdStrikesReset = 0;
    /** Target positions last sent to each graph, to skip no-op updates. */
    this.sent = /* @__PURE__ */ new Map();
  }
  get app() {
    return this.plugin.app;
  }
  start() {
    const p = this.plugin;
    p.registerEvent(this.app.workspace.on("layout-change", () => this.scan()));
    const onTreeChange = (f) => {
      if (f instanceof import_obsidian5.TFolder || f instanceof import_obsidian5.TFile && f.extension === "md") {
        this.depthCache = null;
        this.posCache = null;
        this.refreshSoon();
      }
    };
    p.registerEvent(this.app.vault.on("create", onTreeChange));
    p.registerEvent(this.app.vault.on("delete", onTreeChange));
    p.registerEvent(this.app.vault.on("rename", onTreeChange));
    this.scan();
    void this.syncColorGroups(false, false);
    this.holdTimer = window.setInterval(() => this.holdTick(), 400);
    this.plugin.registerInterval(this.holdTimer);
  }
  stop() {
    if (this.holdTimer !== null) window.clearInterval(this.holdTimer);
    for (const [r, ids] of this.holdRelease) for (const id of ids) this.post(r, { forceNode: { id, x: null, y: null } });
    this.holdRelease.clear();
    this.growing.forEach((id) => window.cancelAnimationFrame(id));
    this.freezeTimers.forEach((t) => window.clearTimeout(t));
    for (const r of [...this.originals.keys()]) {
      this.unfreeze(r);
      this.unpinAll(r);
      const orig = this.originals.get(r);
      if (orig) r.setData = orig;
    }
    this.originals.clear();
    this.views.clear();
    this.timers.forEach((t) => window.clearTimeout(t));
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }
  /** Re-applies the layout to every open global graph. */
  refresh() {
    this.depthCache = null;
    this.posCache = null;
    this.scan();
    for (const r of this.originals.keys()) this.schedule(r);
  }
  refreshSoon() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 1200);
  }
  /** Finds open graph views and hooks their renderer. */
  scan() {
    const alive = /* @__PURE__ */ new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
      const view = leaf.view;
      const r = view.renderer;
      if (!r || typeof r.setData !== "function" || !r.worker) continue;
      alive.add(r);
      if (!this.originals.has(r)) {
        const orig = r.setData;
        this.originals.set(r, orig);
        this.views.set(r, view);
        r.setData = (data) => {
          orig.call(r, data);
          this.schedule(r);
        };
        this.schedule(r);
      }
    }
    for (const r of [...this.originals.keys()]) {
      if (alive.has(r)) continue;
      this.originals.delete(r);
      this.views.delete(r);
      this.pinned.delete(r);
      this.sent.delete(r);
    }
  }
  schedule(r, tries = 0, delay = 120) {
    const t = this.timers.get(r);
    if (t !== void 0) window.clearTimeout(t);
    this.timers.set(
      r,
      window.setTimeout(() => {
        this.timers.delete(r);
        this.apply(r, tries);
      }, delay)
    );
  }
  post(r, msg) {
    try {
      r.worker?.postMessage(msg);
    } catch (e) {
      console.warn("ObsOrg: graph worker message failed", e);
    }
  }
  hasNode(r, id) {
    if (r.nodeLookup) return id in r.nodeLookup;
    return !!r.nodes?.some((n) => n.id === id);
  }
  apply(r, tries) {
    if (!r.nodes || r.nodes.length === 0) {
      if (tries < 20) this.schedule(r, tries + 1, 250);
      return;
    }
    const s = this.plugin.settings;
    const prev = this.pinned.get(r) ?? /* @__PURE__ */ new Set();
    const target = s.skillTreeEnabled ? this.positions() : /* @__PURE__ */ new Map();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (target.size && !this.grown.has(r) && s.graphGrow && s.animations && !reduced) {
      this.grown.add(r);
      this.animateGrow(r, target);
      return;
    }
    this.grown.add(r);
    if (this.growing.has(r)) return;
    const last = this.sent.get(r) ?? /* @__PURE__ */ new Map();
    const now = /* @__PURE__ */ new Set();
    let moved = false;
    for (const [id, p] of target) {
      if (!this.hasNode(r, id)) continue;
      this.post(r, { forceNode: { id, x: p.x, y: p.y } });
      now.add(id);
      const q = last.get(id);
      if (!q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5) moved = true;
    }
    for (const id of prev) {
      if (!now.has(id)) {
        this.post(r, { forceNode: { id, x: null, y: null } });
        moved = true;
      }
    }
    this.pinned.set(r, now);
    this.sent.set(r, new Map([...now].map((id) => [id, target.get(id)])));
    if (moved) {
      this.reheat(r);
      this.scheduleFreeze(r);
    } else if (this.plugin.settings.graphFreeze && !this.frozen.has(r)) {
      this.scheduleFreeze(r);
    }
  }
  /** Branch by branch, level by level: nodes glide from the centre to their places. */
  animateGrow(r, target) {
    const depth = this.depths().all;
    const ids = [...target.keys()].filter((id) => this.hasNode(r, id));
    const pinned = new Set(ids);
    for (const id of this.pinned.get(r) ?? []) {
      if (!pinned.has(id)) this.post(r, { forceNode: { id, x: null, y: null } });
    }
    this.pinned.set(r, pinned);
    const DUR = 650;
    const STAGGER = 380;
    const t0 = performance.now();
    const ease = (k) => 1 - Math.pow(1 - k, 3);
    const step = (now) => {
      let done = true;
      for (const id of ids) {
        const p = target.get(id);
        const k = Math.min(1, Math.max(0, (now - t0 - ((depth.get(id) ?? 1) - 1) * STAGGER) / DUR));
        if (k < 1) done = false;
        const e = ease(k);
        this.post(r, { forceNode: { id, x: p.x * e, y: p.y * e } });
      }
      if (done) {
        this.growing.delete(r);
        this.sent.set(r, new Map(ids.map((id) => [id, target.get(id)])));
        this.scheduleFreeze(r);
      } else {
        this.growing.set(r, window.requestAnimationFrame(step));
      }
    };
    this.reheat(r);
    this.growing.set(r, window.requestAnimationFrame(step));
  }
  /** "Frozen" graph: once nodes have settled, pin every node where it is. */
  scheduleFreeze(r) {
    const t = this.freezeTimers.get(r);
    if (t !== void 0) window.clearTimeout(t);
    if (!this.plugin.settings.graphFreeze) {
      this.unfreeze(r);
      return;
    }
    this.freezeTimers.set(
      r,
      window.setTimeout(() => {
        this.freezeTimers.delete(r);
        const pins = this.pinned.get(r) ?? /* @__PURE__ */ new Set();
        const set = /* @__PURE__ */ new Set();
        for (const n of r.nodes ?? []) {
          if (pins.has(n.id) || typeof n.x !== "number") continue;
          this.post(r, { forceNode: { id: n.id, x: n.x, y: n.y } });
          set.add(n.id);
        }
        this.frozen.set(r, set);
      }, 3e3)
    );
  }
  unfreeze(r) {
    const set = this.frozen.get(r);
    if (!set?.size) return;
    for (const id of set) this.post(r, { forceNode: { id, x: null, y: null } });
    this.frozen.delete(r);
    this.reheat(r);
  }
  unpinAll(r) {
    const prev = this.pinned.get(r);
    if (!prev?.size) return;
    for (const id of prev) this.post(r, { forceNode: { id, x: null, y: null } });
    this.pinned.set(r, /* @__PURE__ */ new Set());
    this.reheat(r);
  }
  /** Wakes the simulation up so nodes glide to their new places. */
  reheat(r) {
    this.post(r, { alpha: 0.3, run: true });
    try {
      r.changed?.();
    } catch {
    }
  }
  // ------------------------------------------------------------- layout
  /** Folder tree of index notes; folders without an index are skipped through. */
  buildTree() {
    const build = (folder) => {
      const childNodes = folder.children.filter((c) => c instanceof import_obsidian5.TFolder && !this.plugin.isExcluded(c)).flatMap(build);
      const index = folder.isRoot() ? null : this.plugin.findIndex(folder);
      if (!index) return childNodes;
      const files = folder.children.filter((c) => c instanceof import_obsidian5.TFile && c !== index).map((f) => f.path);
      return [{ id: index.path, name: folder.name, children: childNodes, files }];
    };
    return build(this.app.vault.getRoot());
  }
  layoutOptions() {
    const s = this.plugin.settings;
    const directions = {};
    for (const [name, key] of Object.entries(s.branchDirections)) {
      if (DIRECTIONS[key]) directions[name] = DIRECTIONS[key].deg;
    }
    return {
      style: s.skillTreeStyle,
      step: s.skillTreeStep,
      spreadDeg: s.skillTreeSpread,
      pinFiles: s.skillTreePinFiles,
      directions
    };
  }
  /** Depth of every index note (1 = top-level branch) and of pinned files. */
  depths() {
    if (this.depthCache) return this.depthCache;
    const hubs = /* @__PURE__ */ new Map();
    const all = /* @__PURE__ */ new Map();
    const walk = (n, d) => {
      hubs.set(n.id, d);
      all.set(n.id, d);
      for (const f of n.files) all.set(f, d + 0.5);
      n.children.forEach((c) => walk(c, d + 1));
    };
    this.buildTree().forEach((r) => walk(r, 1));
    this.depthCache = { hubs, all };
    return this.depthCache;
  }
  /** Index notes and their depth in the folder tree (used by graph effects). */
  hubDepths() {
    return this.depths().hubs;
  }
  positions() {
    if (!this.posCache) this.posCache = layoutSkillTree(this.buildTree(), this.layoutOptions());
    return this.posCache;
  }
  // ------------------------------------------------------------- modules
  /**
   * Keeps module members inside their barrier: a note that drifted outside
   * is pinned just inside for one tick and released on the next, so the
   * physics carries on from there. If a note keeps escaping (the layout
   * wants it outside), the barrier grows instead of fighting the physics.
   */
  holdTick() {
    const s = this.plugin.settings;
    const modules = this.plugin.modules;
    const now = performance.now();
    if (now - this.holdStrikesReset > 3e4) {
      this.holdStrikes.clear();
      this.holdStrikesReset = now;
    }
    for (const r of this.originals.keys()) {
      const release = this.holdRelease.get(r) ?? /* @__PURE__ */ new Set();
      for (const id of release) this.post(r, { forceNode: { id, x: null, y: null } });
      release.clear();
      this.holdRelease.set(r, release);
      if (!s.moduleHold || !modules.list.length || !r.nodes?.length || this.growing.has(r)) continue;
      const pinned = this.pinned.get(r);
      const frozen = this.frozen.get(r);
      const members = modules.members();
      let clamped = 0;
      for (const m of modules.list) {
        const set = members.get(m.id);
        if (!set?.size) continue;
        const nodes = r.nodes.filter((n) => set.has(n.id));
        if (!nodes.length) continue;
        const median = (v) => {
          v.sort((p, q) => p - q);
          const mid = v.length >> 1;
          return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
        };
        const cx = median(nodes.map((n) => n.x));
        const cy = median(nodes.map((n) => n.y));
        const R = modules.radius(m.id, nodes.length);
        for (const n of nodes) {
          if (pinned?.has(n.id) || frozen?.has(n.id)) continue;
          const dx = n.x - cx;
          const dy = n.y - cy;
          const d = Math.hypot(dx, dy);
          if (d <= R || d === 0) continue;
          const strikes = (this.holdStrikes.get(n.id) ?? 0) + 1;
          this.holdStrikes.set(n.id, strikes);
          if (strikes > 6) {
            modules.widen(m.id, d - R + 20);
            continue;
          }
          const k = R * 0.85 / d;
          this.post(r, { forceNode: { id: n.id, x: cx + dx * k, y: cy + dy * k } });
          release.add(n.id);
          clamped++;
        }
      }
      if (clamped) this.post(r, { alpha: 0.05, run: true });
    }
  }
  // ------------------------------------------------------------- colours
  /**
   * Keeps graph colour groups in line with the settings: the index-note tag
   * group (only once the user asked for it) and one group per module that
   * paints its nodes. Groups the user created are never touched; groups this
   * plugin wrote earlier but no longer wants are removed.
   */
  async syncColorGroups(addIndexGroup, notify) {
    const s = this.plugin.settings;
    const tag = s.tag.replace(/^#/, "").trim();
    if (addIndexGroup && !tag) {
      if (notify) new import_obsidian5.Notice("ObsOrg: \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u0442\u0435\u0433 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432.");
      return;
    }
    const adapter = this.app.vault.adapter;
    const path = (0, import_obsidian5.normalizePath)(`${this.app.vault.configDir}/graph.json`);
    let cfg = {};
    try {
      if (await adapter.exists(path)) cfg = JSON.parse(await adapter.read(path));
    } catch (e) {
      console.error("ObsOrg: cannot read graph.json", e);
      if (notify) new import_obsidian5.Notice("ObsOrg: \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0433\u0440\u0430\u0444\u0430.");
      return;
    }
    const managed = new Set(s.managedGraphQueries);
    const tagQuery = tag ? `tag:#${tag}` : null;
    const desired = [];
    if (tagQuery && (addIndexGroup || managed.has(tagQuery))) {
      desired.push({ query: tagQuery, color: { a: 1, rgb: hexToRgb(s.highlightColor) } });
    }
    for (const g of this.plugin.modules.colorGroups()) {
      if (!desired.some((d) => d.query === g.query)) desired.push({ query: g.query, color: { a: 1, rgb: hexToRgb(g.color) } });
    }
    const desiredQ = new Set(desired.map((g) => g.query));
    const userGroups = (cfg.colorGroups ?? []).filter((g) => !managed.has(g.query) && !desiredQ.has(g.query));
    const groups = [...desired, ...userGroups];
    const nextManaged = desired.map((g) => g.query);
    if (JSON.stringify(groups) !== JSON.stringify(cfg.colorGroups ?? [])) {
      cfg.colorGroups = groups;
      await adapter.write(path, JSON.stringify(cfg, null, 2));
      try {
        const graph = this.app.internalPlugins?.getPluginById?.("graph");
        const opts = graph?.instance?.options;
        if (opts) opts.colorGroups = groups;
      } catch {
      }
    }
    if (JSON.stringify(nextManaged) !== JSON.stringify(s.managedGraphQueries)) {
      s.managedGraphQueries = nextManaged;
      await this.plugin.saveSettings();
    }
    if (notify) {
      new import_obsidian5.Notice("ObsOrg: \u0446\u0432\u0435\u0442 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u0433\u0440\u0430\u0444. \u0417\u0430\u043A\u0440\u043E\u0439\u0442\u0435 \u0438 \u0441\u043D\u043E\u0432\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0433\u0440\u0430\u0444.", 8e3);
    }
  }
};

// src/graph-fx.ts
var import_obsidian6 = require("obsidian");

// src/rays.ts
var RAY_STYLES = {
  spark: "\u0418\u0441\u043A\u0440\u0430",
  beam: "\u041B\u0443\u0447",
  energy: "\u042D\u043D\u0435\u0440\u0433\u0438\u044F",
  lightning: "\u042D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u0435\u0441\u0442\u0432\u043E"
};
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var WHITE = (a) => `rgba(255,255,255,${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;
function drawRay(ctx, a, b, p) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 2 || p.alpha <= 0.01 || p.head <= 0) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (p.style) {
    case "beam":
      drawBeam(ctx, a, b, p);
      break;
    case "energy":
      drawEnergy(ctx, a, b, len, p);
      break;
    case "lightning":
      drawLightning(ctx, a, b, len, p);
      break;
    default:
      drawSpark(ctx, a, b, p);
  }
}
function dot(ctx, x, y, r, style) {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function line(ctx, ax, ay, bx, by, width, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
function drawSpark(ctx, a, b, p) {
  const k = p.constant ? (p.t * 0.55 + p.seed * 0.137) % 1 : p.head;
  const x = a.x + (b.x - a.x) * k;
  const y = a.y + (b.y - a.y) * k;
  dot(ctx, x, y, 6 * p.width, p.color(0.25 * p.alpha));
  dot(ctx, x, y, 2.6 * p.width, p.color(0.95 * p.alpha));
}
function drawBeam(ctx, a, b, p) {
  let alpha = p.alpha;
  if (p.constant) alpha *= 0.55 + 0.45 * Math.sin(p.t * 3.2 + p.seed);
  const hk = p.head;
  const tk = p.constant ? 0 : Math.max(0, hk - 0.5);
  const hx = a.x + (b.x - a.x) * hk;
  const hy = a.y + (b.y - a.y) * hk;
  const tx = a.x + (b.x - a.x) * tk;
  const ty = a.y + (b.y - a.y) * tk;
  if ((p.quality ?? 2) === 2) line(ctx, tx, ty, hx, hy, 7 * p.width, p.color(0.12 * alpha));
  line(ctx, tx, ty, hx, hy, 3.5 * p.width, p.color(0.26 * alpha));
  const g = ctx.createLinearGradient(tx, ty, hx, hy);
  g.addColorStop(0, p.color(p.constant ? 0.5 * alpha : 0));
  g.addColorStop(0.7, p.color(0.9 * alpha));
  g.addColorStop(1, WHITE(alpha));
  line(ctx, tx, ty, hx, hy, 1.6 * p.width, g);
  if (!p.constant && hk < 1) {
    dot(ctx, hx, hy, 6 * p.width, p.color(0.3 * alpha));
    dot(ctx, hx, hy, 2.2 * p.width, WHITE(alpha));
  }
}
function drawEnergy(ctx, a, b, len, p) {
  const q = p.quality ?? 2;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const amp = 3.6 * p.width;
  const steps = Math.min(q === 2 ? 36 : q === 1 ? 24 : 14, Math.max(8, Math.round(len * p.head / 9)));
  const wave = (s, shift) => amp * Math.sin(Math.PI * Math.min(1, s)) * Math.sin(s * len / 9 - p.t * 7 + p.seed + shift);
  const strand = (shift, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const s = i / steps * p.head;
      const off = wave(s, shift);
      const x = a.x + ux * s * len - uy * off;
      const y = a.y + uy * s * len + ux * off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  strand(0, (q === 2 ? 6 : 4) * p.width, p.color(0.16 * p.alpha));
  strand(0, 1.6 * p.width, p.color(0.95 * p.alpha));
  if (q > 0) strand(Math.PI, 1.1 * p.width, p.color(0.6 * p.alpha));
  const blobs = q === 0 ? 1 : 3;
  for (let j = 0; j < blobs; j++) {
    const s = (p.t * 0.7 + j / 3 + p.seed * 0.171) % 1;
    if (s > p.head) continue;
    const off = wave(s, 0);
    const x = a.x + ux * s * len - uy * off;
    const y = a.y + uy * s * len + ux * off;
    dot(ctx, x, y, 5 * p.width, p.color(0.3 * p.alpha));
    dot(ctx, x, y, 2 * p.width, WHITE(0.9 * p.alpha));
  }
}
function drawLightning(ctx, a, b, len, p) {
  const q = p.quality ?? 2;
  const r = rng(Math.floor(p.t * 18) * 9973 + p.seed * 7919);
  const ex = a.x + (b.x - a.x) * p.head;
  const ey = a.y + (b.y - a.y) * p.head;
  const segLen = Math.hypot(ex - a.x, ey - a.y);
  if (segLen < 2) return;
  const ux = (ex - a.x) / segLen;
  const uy = (ey - a.y) / segLen;
  const n = Math.min(q === 2 ? 18 : q === 1 ? 12 : 7, Math.max(4, Math.round(segLen / 14)));
  const jitter = Math.min(14, len * 0.08) * (0.7 + 0.3 * p.width);
  const xs = new Array(n + 1);
  const ys = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const off = i === 0 || i === n ? 0 : (r() * 2 - 1) * jitter * Math.sin(Math.PI * s);
    xs[i] = a.x + ux * s * segLen - uy * off;
    ys[i] = a.y + uy * s * segLen + ux * off;
  }
  const alpha = p.alpha * (0.55 + r() * 0.45);
  const path = (px, py, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(px[0], py[0]);
    for (let i = 1; i < px.length; i++) ctx.lineTo(px[i], py[i]);
    ctx.stroke();
  };
  if (q === 2) path(xs, ys, 6 * p.width, p.color(0.16 * alpha));
  path(xs, ys, 2.6 * p.width, p.color(0.45 * alpha));
  path(xs, ys, 1.1 * p.width, WHITE(0.95 * alpha));
  if (q === 0) return;
  const chance = q === 2 ? 0.2 : 0.1;
  for (let i = 1; i < n; i++) {
    if (r() > chance) continue;
    const dir = Math.atan2(uy, ux) + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6);
    const bx = [xs[i]];
    const by = [ys[i]];
    const parts = 2 + Math.floor(r() * 2);
    for (let k = 0; k < parts; k++) {
      const l = 6 + r() * 10;
      const d = dir + (r() * 2 - 1) * 0.5;
      bx.push(bx[bx.length - 1] + Math.cos(d) * l);
      by.push(by[by.length - 1] + Math.sin(d) * l);
    }
    path(bx, by, 2.4 * p.width, p.color(0.3 * alpha));
    path(bx, by, 0.8 * p.width, WHITE(0.8 * alpha));
  }
}

// src/module-shapes.ts
var LINE_STYLES = {
  zigzag: "\u0417\u0438\u0433\u0437\u0430\u0433",
  solid: "\u0421\u043F\u043B\u043E\u0448\u043D\u0430\u044F",
  dashed: "\u041F\u0443\u043D\u043A\u0442\u0438\u0440",
  dotted: "\u0422\u043E\u0447\u043A\u0438",
  wave: "\u0412\u043E\u043B\u043D\u0430",
  double: "\u0414\u0432\u043E\u0439\u043D\u0430\u044F",
  electric: "\u042D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u0435\u0441\u043A\u0430\u044F"
};
function convexHull(input) {
  const pts = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
function centroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return pts.length ? { x: x / pts.length, y: y / pts.length } : { x: 0, y: 0 };
}
function moduleRadius(n, size = 1) {
  return (110 + 42 * Math.sqrt(Math.max(1, n))) * size;
}
function moduleOutline(points, shape, pad2, minRadius) {
  if (!points.length) return [];
  const c = centroid(points);
  if (shape === "circle") {
    let r = minRadius;
    for (const p of points) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y) + pad2);
    return circlePoints(c, r, 48);
  }
  const cloud = [];
  const K = 10;
  for (const p of points) {
    for (let k = 0; k < K; k++) {
      const a = k / K * Math.PI * 2;
      cloud.push({ x: p.x + Math.cos(a) * pad2, y: p.y + Math.sin(a) * pad2 });
    }
  }
  for (const p of circlePoints(c, minRadius, 16)) cloud.push(p);
  return convexHull(cloud);
}
function circlePoints(c, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}
function resampleClosed(pts, spacing, offset = 0, maxPoints = 1200) {
  const n = pts.length;
  if (n < 2) return pts;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (perimeter <= 0) return pts;
  const step = Math.max(spacing, perimeter / maxPoints);
  const count = Math.max(3, Math.floor(perimeter / step));
  const out = [];
  let seg = 0;
  let segStart = 0;
  let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  for (let k = 0; k < count; k++) {
    const d = ((offset % perimeter + perimeter) % perimeter + k * (perimeter / count)) % perimeter;
    if (d < segStart) {
      seg = 0;
      segStart = 0;
      segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
    while (d > segStart + segLen && seg < n - 1) {
      segStart += segLen;
      seg++;
      const a2 = pts[seg];
      const b2 = pts[(seg + 1) % n];
      segLen = Math.hypot(b2.x - a2.x, b2.y - a2.y);
    }
    const a = pts[seg];
    const b = pts[(seg + 1) % n];
    const k2 = segLen > 0 ? (d - segStart) / segLen : 0;
    out.push({ x: a.x + (b.x - a.x) * k2, y: a.y + (b.y - a.y) * k2 });
  }
  return out;
}
function normals(pts) {
  const n = pts.length;
  const c = centroid(pts);
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (nx * (p.x - c.x) + ny * (p.y - c.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: nx, y: ny };
  });
}
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}
function drawBoundary(ctx, outline, b) {
  if (outline.length < 3) return;
  const t = b.animate ? b.t : 0;
  const w = b.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (b.style) {
    case "zigzag": {
      const half = 6 * w;
      const pts = resampleClosed(outline, half, -t * 14);
      const nrm = normals(pts);
      const amp = 3.5 * w;
      const zz = pts.map((p, i) => ({ x: p.x + nrm[i].x * (i % 2 ? amp : -amp), y: p.y + nrm[i].y * (i % 2 ? amp : -amp) }));
      ctx.strokeStyle = b.color(0.85);
      ctx.lineWidth = 1.6 * w;
      tracePath(ctx, zz);
      ctx.stroke();
      break;
    }
    case "wave": {
      const pts = resampleClosed(outline, 3);
      const nrm = normals(pts);
      const amp = 3.5 * w;
      const lambda = 26 * w;
      let dist = 0;
      const wv = pts.map((p, i) => {
        if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
        const o = amp * Math.sin(dist / lambda * Math.PI * 2 - t * 3);
        return { x: p.x + nrm[i].x * o, y: p.y + nrm[i].y * o };
      });
      ctx.strokeStyle = b.color(0.85);
      ctx.lineWidth = 1.6 * w;
      tracePath(ctx, wv);
      ctx.stroke();
      break;
    }
    case "double": {
      const pts = resampleClosed(outline, 6);
      const nrm = normals(pts);
      ctx.strokeStyle = b.color(0.8);
      ctx.lineWidth = 1.2 * w;
      for (const o of [-2.6 * w, 2.6 * w]) {
        tracePath(ctx, pts.map((p, i) => ({ x: p.x + nrm[i].x * o, y: p.y + nrm[i].y * o })));
        ctx.stroke();
      }
      break;
    }
    case "electric": {
      const pts = resampleClosed(outline, 9);
      const nrm = normals(pts);
      let s = Math.floor(t * 12) * 9973 + b.seed * 7919 >>> 0;
      const rnd = () => {
        s = s * 1664525 + 1013904223 >>> 0;
        return s / 4294967296;
      };
      const el = pts.map((p, i) => {
        const o = (rnd() * 2 - 1) * 3.2 * w;
        return { x: p.x + nrm[i].x * o, y: p.y + nrm[i].y * o };
      });
      ctx.strokeStyle = b.color(0.22);
      ctx.lineWidth = 5 * w;
      tracePath(ctx, el);
      ctx.stroke();
      ctx.strokeStyle = b.color(0.95);
      ctx.lineWidth = 1.3 * w;
      tracePath(ctx, el);
      ctx.stroke();
      break;
    }
    case "dashed":
    case "dotted": {
      const dotted = b.style === "dotted";
      ctx.setLineDash(dotted ? [0.1, 8 * w] : [11 * w, 7 * w]);
      ctx.lineDashOffset = -t * 18;
      ctx.strokeStyle = b.color(0.85);
      ctx.lineWidth = (dotted ? 3.2 : 1.8) * w;
      tracePath(ctx, outline);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    default: {
      ctx.strokeStyle = b.color(0.85);
      ctx.lineWidth = 1.8 * w;
      tracePath(ctx, outline);
      ctx.stroke();
    }
  }
}
function fillOutline(ctx, outline, style) {
  if (outline.length < 3) return;
  ctx.fillStyle = style;
  tracePath(ctx, outline);
  ctx.fill();
}
function polarRadii(poly, c, n) {
  const out = new Float32Array(n);
  const m = poly.length;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i / n * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 0;
    for (let j = 0; j < m; j++) {
      const p = poly[j];
      const q = poly[(j + 1) % m];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = p.x - c.x;
      const wy = p.y - c.y;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dy - wy * dx) / den;
      if (t > best && u >= -1e-6 && u <= 1 + 1e-6) best = t;
    }
    out[i] = best;
  }
  return out;
}
function elasticOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
}

// src/graph-fx.ts
var MOD_RAYS = 120;
var TRAVEL = 0.9;
var LINGER = 0.35;
var RING = 1.4;
var MAX_RAYS = [60, 180, 400];
var MAX_FLOW = [250, 700, 1500];
var DPR_CAP = [0.75, 1, 1.5];
function parseHex(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [229, 165, 10];
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
var easeInOut = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
var GraphFx = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.layers = /* @__PURE__ */ new Map();
    this.raf = null;
    this.t0 = performance.now();
    this.bursts = [];
    // Adaptive quality
    // Phones start at medium detail; desktops at high. Adjusted every 1.5 s.
    this.quality = import_obsidian6.Platform.isMobile ? 1 : 2;
    this.costEma = 0;
    this.lastQualityChange = 0;
    // FPS meter
    this.lastFrame = 0;
    this.fpsEma = 60;
    // Colour caches
    this.colorKey = "";
    this.colorFn = () => "";
    this.flowStyle = "";
    this.glowSprite = null;
    this.loop = (now) => {
      this.raf = window.requestAnimationFrame(this.loop);
      if (this.lastFrame) {
        const dt = now - this.lastFrame;
        if (dt > 0 && dt < 1e3) this.fpsEma = this.fpsEma * 0.92 + 1e3 / dt * 0.08;
      }
      this.lastFrame = now;
      if (document.hidden) return;
      if (this.bursts.length) this.bursts = this.bursts.filter((b) => now - b.start < 2600);
      const start = performance.now();
      for (const [r, layer] of this.layers) {
        try {
          this.draw(r, layer, now);
        } catch (e) {
          console.warn("ObsOrg: graph effects failed, turning them off for this view", e);
          layer.canvas.remove();
          this.layers.delete(r);
        }
      }
      this.adapt(performance.now() - start, now);
    };
  }
  get app() {
    return this.plugin.app;
  }
  /** Pulses, rays, flow and glow (animations). */
  get effectsOn() {
    const s = this.plugin.settings;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const anything = s.fxRing || s.fxWave || s.fxGlow || s.linkFlow !== "off" || s.fxShowFps;
    return s.fxEnabled && s.animations && !reduced && anything;
  }
  /** Module barriers are structure, not decoration: shown even with animations off. */
  get modulesOn() {
    const s = this.plugin.settings;
    return s.modulesEnabled && s.modules.length > 0;
  }
  get active() {
    return this.effectsOn || this.modulesOn;
  }
  start() {
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
    this.plugin.register(() => this.stop());
    this.sync();
  }
  stop() {
    if (this.raf !== null) window.cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const l of this.layers.values()) l.canvas.remove();
    this.layers.clear();
  }
  /** Attaches/detaches overlay canvases to open graph views. */
  sync() {
    const alive = /* @__PURE__ */ new Set();
    if (this.active) {
      const leaves = [
        ...this.app.workspace.getLeavesOfType("graph"),
        ...this.app.workspace.getLeavesOfType("localgraph")
      ];
      for (const leaf of leaves) {
        const r = leaf.view.renderer;
        const host = r?.containerEl;
        if (!r || !host) continue;
        alive.add(r);
        if (!this.layers.has(r)) {
          if (getComputedStyle(host).position === "static") host.style.position = "relative";
          const canvas = host.createEl("canvas", { cls: "fh-graph-fx" });
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            canvas.remove();
            continue;
          }
          this.layers.set(r, { canvas, ctx, lists: null, mods: null, modState: /* @__PURE__ */ new Map(), frame: 0, dirty: false });
        }
      }
    }
    for (const [r, l] of [...this.layers]) {
      if (alive.has(r)) continue;
      l.canvas.remove();
      this.layers.delete(r);
    }
    this.colorKey = "";
    for (const l of this.layers.values()) {
      l.lists = null;
      l.mods = null;
    }
    if (this.layers.size && this.raf === null) this.raf = window.requestAnimationFrame(this.loop);
    if (!this.layers.size && this.raf !== null) {
      window.cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }
  /** Big celebratory pulse on one node (e.g. a branch levelled up). */
  burst(id) {
    this.bursts.push({ id, start: performance.now() });
  }
  /**
   * Lowers detail when frames get expensive or the frame rate drops below
   * ~50 fps (the GPU can be the bottleneck even when our code is fast),
   * raises it again when there's clear headroom.
   */
  adapt(cost, now) {
    this.costEma = this.costEma * 0.9 + cost * 0.1;
    if (now - this.lastQualityChange < 1500) return;
    if ((this.costEma > 6 || this.fpsEma < 50) && this.quality > 0) {
      this.quality = this.quality - 1;
      this.lastQualityChange = now;
    } else if (this.costEma < 2 && this.fpsEma > 57 && this.quality < 2) {
      this.quality = this.quality + 1;
      this.lastQualityChange = now;
    }
  }
  colors() {
    const s = this.plugin.settings;
    const key = `${s.fxColor}|${s.linkFlowColor}`;
    if (key !== this.colorKey) {
      this.colorKey = key;
      const [r, g, b] = parseHex(s.fxColor);
      this.colorFn = (a) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;
      const [fr, fg, fb] = parseHex(s.linkFlowColor);
      this.flowStyle = `rgba(${fr},${fg},${fb},0.7)`;
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const sc = sprite.getContext("2d");
      if (sc) {
        const grad = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
        grad.addColorStop(0.4, `rgba(${r},${g},${b},0.45)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        sc.fillStyle = grad;
        sc.fillRect(0, 0, 64, 64);
      }
      this.glowSprite = sprite;
    }
    return this.colorFn;
  }
  lists(layer, r) {
    const hubs = this.plugin.graphTree.hubDepths();
    const nodes = r.nodes;
    const links = r.links;
    const l = layer.lists;
    if (l && l.nodesRef === nodes && l.linksRef === links && l.nodeCount === (nodes?.length ?? 0) && l.linkCount === (links?.length ?? 0) && l.hubsRef === hubs) {
      return l;
    }
    const byId = /* @__PURE__ */ new Map();
    const hubNodes = [];
    const hubDepth = [];
    for (const n of nodes ?? []) {
      byId.set(n.id, n);
      const d = hubs.get(n.id);
      if (d !== void 0) {
        hubNodes.push(n);
        hubDepth.push(d);
      }
    }
    const hubLinks = [];
    const hubLinkDepth = [];
    for (const link of links ?? []) {
      const d = hubs.get(link.source.id);
      if (d !== void 0) {
        hubLinks.push(link);
        hubLinkDepth.push(d);
      }
    }
    layer.lists = {
      nodesRef: nodes,
      linksRef: links,
      nodeCount: nodes?.length ?? 0,
      linkCount: links?.length ?? 0,
      hubsRef: hubs,
      hubNodes,
      hubDepth,
      hubLinks,
      hubLinkDepth,
      byId
    };
    return layer.lists;
  }
  rgbaFn(hex) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
    const n = parseInt(full, 16);
    const [r, g, b] = Number.isNaN(n) ? [57, 135, 229] : [n >> 16 & 255, n >> 8 & 255, n & 255];
    return (a) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;
  }
  /** Module members present in this graph (rebuilt when graph data or modules change). */
  modEntries(layer, lists) {
    const modules = this.plugin.modules;
    const defs = this.plugin.settings.modules;
    const key = defs.map((d) => `${d.id}|${d.color}|${d.line}|${d.kind}|${d.value}`).join(";");
    const c = layer.mods;
    if (c && c.version === modules.version && c.defsRef === defs && c.defsKey === key && c.listsRef === lists) return c;
    const members = modules.members();
    const entries = [];
    for (const def of defs) {
      const set = members.get(def.id);
      if (!set?.size) continue;
      const nodes = [];
      for (const [id, n] of lists.byId) if (set.has(id)) nodes.push(n);
      if (!nodes.length) continue;
      entries.push({ def, nodes, colorFn: this.rgbaFn(def.color) });
    }
    const alive = new Set(entries.map((e) => e.def.id));
    for (const id of [...layer.modState.keys()]) if (!alive.has(id)) layer.modState.delete(id);
    layer.mods = { version: modules.version, defsRef: defs, defsKey: key, listsRef: lists, entries };
    return layer.mods;
  }
  /** Moves the barrier's radii towards the current outline of its notes. */
  stepModule(layer, e, now) {
    const s = this.plugin.settings;
    let st = layer.modState.get(e.def.id);
    const recompute = !st || e.nodes.length <= 400 || layer.frame % 3 === 0;
    if (recompute) {
      const pts = e.nodes.map((n) => ({ x: n.x, y: n.y }));
      const R = this.plugin.modules.radius(e.def.id, pts.length);
      const outline = moduleOutline(pts, s.moduleShape, 38 * s.moduleSize, s.moduleShape === "circle" ? R : R * 0.55);
      if (outline.length >= 3) {
        const c = centroid(outline);
        const target = polarRadii(outline, c, MOD_RAYS);
        if (!st) {
          st = { cx: c.x, cy: c.y, radii: target, born: now, last: now };
          layer.modState.set(e.def.id, st);
        } else {
          const k = 1 - Math.pow(0.8, Math.min(4, (now - st.last) / 16.7));
          st.cx += (c.x - st.cx) * k;
          st.cy += (c.y - st.cy) * k;
          for (let i = 0; i < MOD_RAYS; i++) st.radii[i] += (target[i] - st.radii[i]) * k;
        }
      }
    }
    if (st) st.last = now;
    return st;
  }
  /**
   * World → screen mapping for this frame: screen = world · S + offset.
   * Calibrated from the node sprites' world transforms (read-only, no PIXI
   * calls), checked against a second node; falls back to pan/scale.
   */
  mapping(r, nodes, ratio) {
    let S = r.scale ?? 1;
    let ox = r.panX ?? 0;
    let oy = r.panY ?? 0;
    const samples = [];
    for (let i = 0; i < nodes.length && samples.length < 4; i++) {
      const n = nodes[i];
      const wt = n.circle?.worldTransform;
      if (n.rendered !== false && wt && Number.isFinite(wt.tx) && Number.isFinite(wt.ty)) samples.push(n);
    }
    if (samples.length) {
      const a = samples[0];
      const wa = a.circle.worldTransform;
      let cS = S;
      const b = samples.find((n) => Math.abs(n.x - a.x) > 1);
      if (b) {
        const s2 = (b.circle.worldTransform.tx - wa.tx) / (b.x - a.x);
        if (Number.isFinite(s2) && s2 > 0) cS = s2;
      }
      const cx = wa.tx - a.x * cS;
      const cy = wa.ty - a.y * cS;
      const ok = samples.every((n) => {
        const wt = n.circle.worldTransform;
        return Math.abs(n.x * cS + cx - wt.tx) < 2 && Math.abs(n.y * cS + cy - wt.ty) < 2;
      });
      if (ok) {
        S = cS;
        ox = cx;
        oy = cy;
      }
    }
    return { S: S * ratio, ox: ox * ratio, oy: oy * ratio };
  }
  draw(r, layer, now) {
    const { canvas, ctx } = layer;
    const host = r.containerEl;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || host.offsetParent === null) return;
    const s = this.plugin.settings;
    const t = (now - this.t0) / 1e3;
    const interval = Math.max(1, s.fxInterval);
    const phase = t % interval;
    const nodes = r.nodes ?? [];
    const lists = this.lists(layer, r);
    const q = this.quality;
    const maxDepth = lists.hubDepth.length ? Math.max(...lists.hubDepth) : 1;
    const pulseWindow = (maxDepth - 1) * (s.fxWave ? TRAVEL : 0) + Math.max(RING, TRAVEL + LINGER);
    const fxOn = this.effectsOn;
    const modsOn = this.modulesOn;
    const busy = modsOn || fxOn && (s.fxGlow || s.fxShowFps || s.linkFlow !== "off" || s.fxWave && s.rayMode === "constant" || this.bursts.length > 0 || (s.fxRing || s.fxWave) && phase < pulseWindow);
    if (!busy) {
      if (layer.dirty) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        layer.dirty = false;
      }
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[q]);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    layer.dirty = true;
    if (!nodes.length) return;
    const color = this.colors();
    const ratio = w / (r.px?.screen?.width || w);
    const { S, ox, oy } = this.mapping(r, nodes, ratio);
    const X = (n) => n.x * S + ox;
    const Y = (n) => n.y * S + oy;
    const radius = (n) => Math.max(3, (n.getSize?.() ?? 6) * S);
    const PAD = 120;
    const visible = (x, y) => x > -PAD && y > -PAD && x < w + PAD && y < h + PAD;
    const segVisible = (ax, ay, bx, by) => !(ax < -PAD && bx < -PAD || ay < -PAD && by < -PAD || ax > w + PAD && bx > w + PAD || ay > h + PAD && by > h + PAD);
    const emitAt = (depth) => (depth - 1) * (s.fxWave ? TRAVEL : 0);
    if (modsOn) {
      layer.frame++;
      const mods = this.modEntries(layer, lists);
      const animate = s.moduleAnimate && s.animations;
      const intro = s.animations ? s.moduleIntro : "none";
      mods.entries.forEach((e, idx) => {
        const st = this.stepModule(layer, e, now);
        if (!st) return;
        const age = (now - st.born) / 1e3;
        const scale = intro === "bubble" ? elasticOut(Math.min(1, age / 1.1)) : 1;
        let wobble = animate ? 0.012 : 0;
        if (intro === "bubble") wobble += 0.07 * Math.max(0, 1 - age / 1.4);
        const reveal = intro === "draw" ? Math.min(1, age / 1.2) : 1;
        const fade = intro === "none" ? 1 : Math.min(1, age / 0.6);
        const cxs = st.cx * S + ox;
        const cys = st.cy * S + oy;
        const screen = new Array(MOD_RAYS);
        let maxR = 0;
        for (let i = 0; i < MOD_RAYS; i++) {
          const a = -Math.PI / 2 + i / MOD_RAYS * Math.PI * 2;
          const wob = wobble ? 1 + wobble * (Math.sin(3 * a + t * 1.4 + idx) + 0.6 * Math.sin(5 * a - t * 1.1)) : 1;
          const rr = st.radii[i] * scale * wob * S;
          if (rr > maxR) maxR = rr;
          screen[i] = { x: cxs + Math.cos(a) * rr, y: cys + Math.sin(a) * rr };
        }
        if (cxs + maxR < -20 || cys + maxR < -20 || cxs - maxR > w + 20 || cys - maxR > h + 20) return;
        ctx.save();
        if (reveal < 1) {
          const start = -Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(cxs, cys);
          ctx.arc(cxs, cys, maxR * 1.3 + 20, start, start + reveal * Math.PI * 2);
          ctx.closePath();
          ctx.clip();
        }
        ctx.globalAlpha = fade;
        if (s.moduleFill) fillOutline(ctx, screen, e.colorFn(0.07));
        drawBoundary(ctx, screen, {
          style: e.def.line === "default" ? s.moduleLine : e.def.line,
          color: e.colorFn,
          t,
          animate,
          width: s.moduleLineWidth,
          seed: idx + 1
        });
        ctx.restore();
        if (reveal < 1) {
          const k = Math.floor(reveal * MOD_RAYS) % MOD_RAYS;
          const head = screen[k];
          ctx.fillStyle = e.colorFn(0.3);
          ctx.beginPath();
          ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.beginPath();
          ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (s.moduleLabels && fade > 0.05) {
          const top = screen[0];
          const label = `${e.def.name} \xB7 ${e.nodes.length}`;
          ctx.globalAlpha = fade;
          ctx.font = "600 12px var(--font-interface, sans-serif)";
          const tw = ctx.measureText(label).width;
          const lx = Math.min(Math.max(top.x - tw / 2, 4), w - tw - 4);
          const ly = Math.max(top.y - 10, 16);
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(lx - 6, ly - 13, tw + 12, 18);
          ctx.fillStyle = e.colorFn(1);
          ctx.fillText(label, lx, ly);
          ctx.globalAlpha = 1;
        }
      });
    }
    if (!fxOn) return;
    if (s.linkFlow !== "off") {
      const source = s.linkFlow === "hubs" ? lists.hubLinks : r.links ?? [];
      const limit = MAX_FLOW[q];
      ctx.beginPath();
      let count = 0;
      for (let i = 0; i < source.length && count < limit; i++) {
        const l = source[i];
        const ax = X(l.source);
        const ay = Y(l.source);
        const bx = X(l.target);
        const by = Y(l.target);
        if (!segVisible(ax, ay, bx, by)) continue;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        count++;
      }
      if (count) {
        ctx.setLineDash([3, 9]);
        ctx.lineDashOffset = -(t * s.linkFlowSpeed % 12);
        ctx.strokeStyle = this.flowStyle;
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalCompositeOperation = "lighter";
    if (s.fxGlow && this.glowSprite) {
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t * Math.PI * 2 / 2.6);
      for (const n of lists.hubNodes) {
        const x = X(n);
        const y = Y(n);
        if (!visible(x, y)) continue;
        const rr = radius(n) * 3 + 8;
        ctx.drawImage(this.glowSprite, x - rr, y - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = 1;
    }
    if (s.fxRing) {
      for (let i = 0; i < lists.hubNodes.length; i++) {
        const age = phase - emitAt(lists.hubDepth[i]);
        if (age < 0 || age > RING) continue;
        const n = lists.hubNodes[i];
        const x = X(n);
        const y = Y(n);
        if (!visible(x, y)) continue;
        const k = age / RING;
        const base = radius(n);
        ctx.beginPath();
        ctx.arc(x, y, base + 4 + k * (28 + base * 1.5), 0, Math.PI * 2);
        ctx.strokeStyle = color((1 - k) * 0.85);
        ctx.lineWidth = 2.5 * (1 - k) + 0.6;
        ctx.stroke();
      }
    }
    if (s.fxWave) {
      const constant = s.rayMode === "constant";
      const limit = MAX_RAYS[q];
      let count = 0;
      const a = { x: 0, y: 0 };
      const b = { x: 0, y: 0 };
      for (let i = 0; i < lists.hubLinks.length && count < limit; i++) {
        let head = 1;
        let alpha = 1;
        if (!constant) {
          const age = phase - emitAt(lists.hubLinkDepth[i]);
          if (age < 0 || age > TRAVEL + LINGER) continue;
          head = easeInOut(Math.min(1, age / TRAVEL));
          alpha = age <= TRAVEL ? 1 : 1 - (age - TRAVEL) / LINGER;
        }
        const l = lists.hubLinks[i];
        a.x = X(l.source);
        a.y = Y(l.source);
        b.x = X(l.target);
        b.y = Y(l.target);
        if (!segVisible(a.x, a.y, b.x, b.y)) continue;
        count++;
        drawRay(ctx, a, b, { style: s.rayStyle, head, alpha, t, seed: i, color, width: s.rayWidth, constant, quality: q });
      }
    }
    for (const burst of this.bursts) {
      const n = lists.byId.get(burst.id);
      if (!n) continue;
      const x = X(n);
      const y = Y(n);
      const base = radius(n);
      for (let i = 0; i < 3; i++) {
        const age = (now - burst.start) / 1e3 - i * 0.35;
        if (age < 0 || age > 1.6) continue;
        const k = age / 1.6;
        ctx.beginPath();
        ctx.arc(x, y, base + 6 + k * 110, 0, Math.PI * 2);
        ctx.strokeStyle = color((1 - k) * 0.95);
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    if (s.fxShowFps) {
      const fps = Math.round(this.fpsEma);
      const label = `${fps} FPS \xB7 ${["\u043D\u0438\u0437\u043A\u043E\u0435", "\u0441\u0440\u0435\u0434\u043D\u0435\u0435", "\u0432\u044B\u0441\u043E\u043A\u043E\u0435"][q]}`;
      ctx.font = "600 12px var(--font-interface, sans-serif)";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(w - tw - 22, 8, tw + 14, 22);
      ctx.fillStyle = fps >= 55 ? "#44cf6e" : fps >= 40 ? "#e0de71" : "#fb464c";
      ctx.fillText(label, w - tw - 15, 23);
    }
  }
};

// src/modules.ts
var import_obsidian7 = require("obsidian");
var MODULE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];
var escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
function newModuleId() {
  return Math.random().toString(36).slice(2, 10);
}
var GraphModules = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.version = 0;
    this.cache = null;
    this.timer = null;
    /** Extra radius a barrier gained because notes kept escaping it (world units). */
    this.extra = /* @__PURE__ */ new Map();
  }
  start() {
    const p = this.plugin;
    const dirty = () => this.invalidateSoon();
    p.registerEvent(p.app.vault.on("create", dirty));
    p.registerEvent(p.app.vault.on("delete", dirty));
    p.registerEvent(p.app.vault.on("rename", dirty));
    p.registerEvent(p.app.metadataCache.on("resolved", dirty));
  }
  get list() {
    return this.plugin.settings.modules;
  }
  invalidate() {
    this.cache = null;
    this.version++;
  }
  invalidateSoon() {
    if (!this.list.length) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.invalidate();
    }, 800);
  }
  /** Module id → set of member paths. */
  members() {
    if (this.cache) return this.cache;
    const out = /* @__PURE__ */ new Map();
    const files = this.plugin.app.vault.getFiles();
    for (const m of this.list) {
      const set = /* @__PURE__ */ new Set();
      if (m.kind === "folder") {
        const folder = (0, import_obsidian7.normalizePath)(m.value || "/");
        const prefix = folder === "/" ? "" : folder + "/";
        for (const f of files) if (f.path.startsWith(prefix)) set.add(f.path);
      } else {
        const tag = "#" + m.value.replace(/^#/, "").trim().toLowerCase();
        if (tag.length > 1) {
          for (const f of files) {
            if (f.extension !== "md") continue;
            const cache = this.plugin.app.metadataCache.getFileCache(f);
            const tags = cache ? (0, import_obsidian7.getAllTags)(cache) ?? [] : [];
            if (tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(tag + "/"))) set.add(f.path);
          }
        }
      }
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
    this.cache = out;
    return out;
  }
  /** Barrier radius in graph units: grows with the number of notes, plus any widening. */
  radius(id, count) {
    return moduleRadius(count, this.plugin.settings.moduleSize) + (this.extra.get(id) ?? 0);
  }
  /** Lets a barrier grow when the layout keeps pushing notes out of it. */
  widen(id, by) {
    const cur = this.extra.get(id) ?? 0;
    this.extra.set(id, Math.min(cur + Math.max(0, by), 2e3));
  }
  /** Graph search query that matches the module's members (for colour groups). */
  query(m) {
    if (m.kind === "folder") {
      const folder = (0, import_obsidian7.normalizePath)(m.value || "");
      if (!folder || folder === "/") return null;
      return `path:/^${escapeRegex(folder)}\\//`;
    }
    const tag = m.value.replace(/^#/, "").trim();
    return tag ? `tag:#${tag}` : null;
  }
  /** Colour groups for modules that paint their nodes, most specific first. */
  colorGroups() {
    const depth = (m) => m.kind === "folder" ? m.value.split("/").length : 100;
    return this.list.filter((m) => m.colorNodes).sort((a, b) => depth(b) - depth(a)).map((m) => ({ query: this.query(m), color: m.color })).filter((g) => !!g.query);
  }
  /** Creates a module for a folder (or returns the existing one). */
  addFolderModule(folder) {
    const existing = this.list.find((m2) => m2.kind === "folder" && m2.value === folder.path);
    if (existing) return existing;
    const m = {
      id: newModuleId(),
      name: folder.name,
      kind: "folder",
      value: folder.path,
      color: MODULE_COLORS[this.list.length % MODULE_COLORS.length],
      colorNodes: true,
      line: "default"
    };
    this.list.push(m);
    this.invalidate();
    return m;
  }
  findFolderModule(folder) {
    return this.list.find((m) => m.kind === "folder" && m.value === folder.path);
  }
  remove(id) {
    const i = this.list.findIndex((m) => m.id === id);
    if (i >= 0) this.list.splice(i, 1);
    this.invalidate();
  }
  /** True if the file belongs to any module (used by tests / UI). */
  isMember(file) {
    for (const set of this.members().values()) if (set.has(file.path)) return true;
    return false;
  }
};

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
function extractLinkpaths(line2) {
  const out = [];
  for (const m of line2.matchAll(LINK_RE)) out.push(m[1].trim());
  return out;
}
function mergePreserving(existing, items, resolve, opts) {
  const wanted = new Set(items.map((i) => i.path));
  const linked = /* @__PURE__ */ new Set();
  const kept = [];
  let linkLines = 0;
  for (const line2 of existing) {
    const linkpaths = extractLinkpaths(line2);
    if (linkpaths.length === 0) {
      kept.push(line2);
      continue;
    }
    const targets = linkpaths.map(resolve).filter((p) => !!p && wanted.has(p));
    if (targets.length === 0) continue;
    targets.forEach((t) => linked.add(t));
    kept.push(line2);
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
function removeBlock(content) {
  const start = content.indexOf(BLOCK_START);
  if (start < 0) return content;
  const end = content.indexOf(BLOCK_END, start + BLOCK_START.length);
  if (end < 0) return content;
  const before = content.slice(0, start).replace(/[ \t]*\n?[ \t]*$/, "");
  const after = content.slice(end + BLOCK_END.length).replace(/^[ \t]*\n?/, "");
  const joined = before && after ? `${before.replace(/\n+$/, "")}

${after.replace(/^\n+/, "")}` : before + after;
  return joined.replace(/\n{3,}/g, "\n\n");
}

// src/settings.ts
var import_obsidian8 = require("obsidian");
var import_obsidian9 = require("obsidian");
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
  moduleIntro: "bubble"
};
var FolderHubSettingTab = class extends import_obsidian8.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();
    new import_obsidian8.Setting(containerEl).setName("\u0421\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u0421\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438").setDesc("\u041F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u043D\u043E\u0432\u043E\u0439 \u043F\u0430\u043F\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u043D\u0435\u0451 \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B.").addToggle(
      (t) => t.setValue(s.autoCreate).onChange(async (v) => {
        s.autoCreate = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0418\u043C\u044F \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setDesc("{{folder}} \u2014 \u0438\u043C\u044F \u043F\u0430\u043F\u043A\u0438. \u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 \xAB{{folder}}\xBB \u0438\u043B\u0438 \xAB_{{folder}}\xBB \u0438\u043B\u0438 \xAB{{folder}} (\u043E\u0433\u043B\u0430\u0432\u043B\u0435\u043D\u0438\u0435)\xBB.").addText(
      (t) => t.setPlaceholder("{{folder}}").setValue(s.indexName).onChange(async (v) => {
        s.indexName = v || "{{folder}}";
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u044B\u0432\u0430\u0442\u044C \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043F\u0430\u043F\u043A\u043E\u0439").setDesc("\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043B\u0438 \u043F\u0430\u043F\u043A\u0443 \u2014 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u0443\u0435\u0442\u0441\u044F \u0441\u043B\u0435\u0434\u043E\u043C (\u0441\u0441\u044B\u043B\u043A\u0438 \u043D\u0430 \u043D\u0435\u0433\u043E \u043E\u0431\u043D\u043E\u0432\u044F\u0442\u0441\u044F).").addToggle(
      (t) => t.setValue(s.renameWithFolder).onChange(async (v) => {
        s.renameWithFolder = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0422\u0435\u0433 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432").setDesc("\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430. \u041D\u0443\u0436\u0435\u043D \u0434\u043B\u044F \u0440\u0430\u0441\u043A\u0440\u0430\u0441\u043A\u0438 \u0432 \u0433\u0440\u0430\u0444\u0435 (\u0437\u0430\u043F\u0440\u043E\u0441 tag:#\u0442\u0435\u0433).").addText(
      (t) => t.setPlaceholder("folder-index").setValue(s.tag).onChange(async (v) => {
        s.tag = v.replace(/^#/, "").trim();
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0428\u0430\u0431\u043B\u043E\u043D \u043D\u043E\u0432\u043E\u0433\u043E \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setDesc(
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
    new import_obsidian8.Setting(containerEl).setName("\u041A\u0430\u043A \u0432\u044B\u0433\u043B\u044F\u0434\u0438\u0442 \u0441\u043F\u0438\u0441\u043E\u043A").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u0420\u0430\u0441\u043A\u043B\u0430\u0434\u043A\u0430").setDesc("\u041A\u0430\u043A \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0438 [[...]] \u043D\u0430 \u0444\u0430\u0439\u043B\u044B \u043F\u0430\u043F\u043A\u0438.").addDropdown(
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
      new import_obsidian8.Setting(containerEl).setName("\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043A\u043E\u043B\u043E\u043D\u043E\u043A").addSlider(
        (sl) => sl.setLimits(1, 6, 1).setValue(s.columns).setDynamicTooltip().onChange(async (v) => {
          s.columns = v;
          await save();
        })
      );
      new import_obsidian8.Setting(containerEl).setName("\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438 \u043A\u043E\u043B\u043E\u043D\u043E\u043A").setDesc("\u0427\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E. \u041F\u0443\u0441\u0442\u044B\u0435 \u2014 \u0431\u0435\u0437 \u043F\u043E\u0434\u043F\u0438\u0441\u0438.").addText(
        (t) => t.setValue(s.tableHeaders).onChange(async (v) => {
          s.tableHeaders = v;
          await save();
        })
      );
    }
    if (s.layout === "custom") {
      new import_obsidian8.Setting(containerEl).setName("\u0428\u0430\u0431\u043B\u043E\u043D \u0441\u0442\u0440\u043E\u043A\u0438").setDesc(
        "{{link}} \u2014 \u0441\u0441\u044B\u043B\u043A\u0430 [[...]], {{name}} \u2014 \u0438\u043C\u044F, {{ext}} \u2014 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435, {{path}} \u2014 \u043F\u0443\u0442\u044C, {{n}} \u2014 \u043D\u043E\u043C\u0435\u0440, {{ctime}}/{{mtime}} \u2014 \u0434\u0430\u0442\u044B \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F/\u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F, {{type}} \u2014 file/folder. \u041F\u0440\u0438\u043C\u0435\u0440: \xAB- [ ] {{link}} ({{ctime}})\xBB."
      ).addText(
        (t) => t.setValue(s.itemTemplate).onChange(async (v) => {
          s.itemTemplate = v;
          await save();
        })
      );
      new import_obsidian8.Setting(containerEl).setName("\u0424\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u0442\u044B").setDesc("\u0424\u043E\u0440\u043C\u0430\u0442 moment.js, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 YYYY-MM-DD \u0438\u043B\u0438 DD.MM.YYYY.").addText(
        (t) => t.setValue(s.dateFormat).onChange(async (v) => {
          s.dateFormat = v;
          await save();
        })
      );
    }
    new import_obsidian8.Setting(containerEl).setName("\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C \u0440\u0443\u0447\u043D\u044B\u0435 \u043F\u0440\u0430\u0432\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u043F\u0438\u0441\u043A\u0430").setDesc(
      "\u041C\u043E\u0436\u043D\u043E \u043C\u0435\u043D\u044F\u0442\u044C \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u0442\u0440\u043E\u043A, \u0434\u043E\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u044F \u0440\u044F\u0434\u043E\u043C \u0441\u043E \u0441\u0441\u044B\u043B\u043A\u0430\u043C\u0438, \u0432\u0441\u0442\u0430\u0432\u043B\u044F\u0442\u044C \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438 \u2014 \u043F\u043B\u0430\u0433\u0438\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442 \u043D\u043E\u0432\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432 \u043A\u043E\u043D\u0435\u0446 \u0438 \u0443\u0431\u0435\u0440\u0451\u0442 \u0441\u0442\u0440\u043E\u043A\u0438 \u0443\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0445. \u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u043F\u0438\u0441\u043E\u043A \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0435\u0440\u0435\u0441\u043E\u0431\u0438\u0440\u0430\u043B\u0441\u044F \u0441 \u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u043E\u0439. (\u0414\u043B\u044F \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0435\u0440\u0435\u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F.)"
    ).addToggle(
      (t) => t.setValue(s.preserveEdits).onChange(async (v) => {
        s.preserveEdits = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0430").addDropdown(
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
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u0434\u043F\u0430\u043F\u043A\u0438 \u0441\u043D\u0430\u0447\u0430\u043B\u0430").setDesc("\u0421\u0441\u044B\u043B\u043A\u0438 \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u043E\u0434\u043F\u0430\u043F\u043E\u043A \u2014 \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0441\u043F\u0438\u0441\u043A\u0430.").addToggle(
      (t) => t.setValue(s.subfoldersFirst).onChange(async (v) => {
        s.subfoldersFirst = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041A\u0430\u043A\u0438\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u0432 \u0441\u043F\u0438\u0441\u043E\u043A").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u041D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u043C\u0435\u0442\u043A\u0438").setDesc("\u0412\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438, PDF, canvas \u0438 \u0442.\u0434. \u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2014 \u0442\u043E\u043B\u044C\u043A\u043E .md.").addToggle(
      (t) => t.setValue(s.includeNonMarkdown).onChange(async (v) => {
        s.includeNonMarkdown = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0418\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F").setDesc("\u0427\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: png, jpg, pdf").addText(
      (t) => t.setValue(s.excludedExtensions).onChange(async (v) => {
        s.excludedExtensions = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0421\u0432\u044F\u0437\u044B\u0432\u0430\u0442\u044C \u0441 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430\u043C\u0438").setDesc("\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443 \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043A\u0430\u0436\u0434\u043E\u0439 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0438 \u2014 \u0432 \u0433\u0440\u0430\u0444\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0441\u044F \u0434\u0435\u0440\u0435\u0432\u043E: \u041C\u0435\u043D\u044E \u2192 \u041F\u043E\u0434\u043C\u0435\u043D\u044E \u2192 \u0444\u0430\u0439\u043B\u044B.").addToggle(
      (t) => t.setValue(s.linkSubfolderIndexes).onChange(async (v) => {
        s.linkSubfolderIndexes = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0412\u043A\u043B\u044E\u0447\u0430\u0442\u044C \u0444\u0430\u0439\u043B\u044B \u0438\u0437 \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u043F\u0430\u043F\u043E\u043A").setDesc("\u041F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u044F\u0442\u044C \u0432 \u0433\u043B\u0430\u0432\u043D\u043E\u043C \u0444\u0430\u0439\u043B\u0435 \u0432\u043E\u043E\u0431\u0449\u0435 \u0432\u0441\u0435 \u0444\u0430\u0439\u043B\u044B, \u0432\u043A\u043B\u044E\u0447\u0430\u044F \u0444\u0430\u0439\u043B\u044B \u043F\u043E\u0434\u043F\u0430\u043F\u043E\u043A \u043B\u044E\u0431\u043E\u0439 \u0433\u043B\u0443\u0431\u0438\u043D\u044B.").addToggle(
      (t) => t.setValue(s.includeNested).onChange(async (v) => {
        s.includeNested = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0418\u0441\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u044B\u0435 \u043F\u0430\u043F\u043A\u0438").setDesc("\u041F\u043E \u043E\u0434\u043D\u043E\u0439 \u043D\u0430 \u0441\u0442\u0440\u043E\u043A\u0443 (\u043F\u0443\u0442\u044C \u043E\u0442 \u043A\u043E\u0440\u043D\u044F \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430). \u0412 \u043D\u0438\u0445 \u0438 \u0438\u0445 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430\u0445 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u044E\u0442\u0441\u044F.").addTextArea((t) => {
      t.setPlaceholder("Templates\nAttachments").setValue(s.excludedFolders).onChange(async (v) => {
        s.excludedFolders = v;
        await save();
      });
      t.inputEl.rows = 4;
    });
    new import_obsidian8.Setting(containerEl).setName("\u0412\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u0412\u044B\u0434\u0435\u043B\u044F\u0442\u044C \u0432 \u043F\u0440\u043E\u0432\u043E\u0434\u043D\u0438\u043A\u0435 \u0444\u0430\u0439\u043B\u043E\u0432").addToggle(
      (t) => t.setValue(s.highlightEnabled).onChange(async (v) => {
        s.highlightEnabled = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0426\u0432\u0435\u0442").setDesc("\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 \u043F\u0440\u043E\u0432\u043E\u0434\u043D\u0438\u043A\u0435, \u0432 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0438 \u0434\u043B\u044F \u0433\u0440\u0443\u043F\u043F\u044B \u0432 \u0433\u0440\u0430\u0444\u0435.").addColorPicker(
      (c) => c.setValue(s.highlightColor).onChange(async (v) => {
        s.highlightColor = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0417\u043D\u0430\u0447\u043E\u043A").setDesc("\u0421\u0438\u043C\u0432\u043E\u043B \u043F\u0435\u0440\u0435\u0434 \u0438\u043C\u0435\u043D\u0435\u043C \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430 (\u2605, \u{1F4CC}, \u{1F5C2}, \u25C6 \u2026). \u041F\u0443\u0441\u0442\u043E \u2014 \u0431\u0435\u0437 \u0437\u043D\u0430\u0447\u043A\u0430.").addText(
      (t) => t.setValue(s.highlightIcon).onChange(async (v) => {
        s.highlightIcon = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0416\u0438\u0440\u043D\u044B\u0439 \u0448\u0440\u0438\u0444\u0442").addToggle(
      (t) => t.setValue(s.highlightBold).onChange(async (v) => {
        s.highlightBold = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u0434\u043A\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C \u0438 \u0441\u0430\u043C\u0443 \u043F\u0430\u043F\u043A\u0443").setDesc("\u041F\u0430\u043F\u043A\u0438, \u0432 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0435\u0441\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B, \u0442\u043E\u0436\u0435 \u043E\u043A\u0440\u0430\u0448\u0438\u0432\u0430\u044E\u0442\u0441\u044F.").addToggle(
      (t) => t.setValue(s.highlightFolders).onChange(async (v) => {
        s.highlightFolders = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0426\u0432\u0435\u0442 \u0432 \u0433\u0440\u0430\u0444\u0435").setDesc("\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0433\u0440\u0430\u0444 \u0446\u0432\u0435\u0442\u043E\u0432\u0443\u044E \u0433\u0440\u0443\u043F\u043F\u0443 tag:#<\u0442\u0435\u0433> \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0446\u0432\u0435\u0442\u0430 \u2014 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0431\u0443\u0434\u0443\u0442 \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u044B \u0432 \u0433\u0440\u0430\u0444\u0435.").addButton(
      (b) => b.setButtonText("\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0433\u0440\u0430\u0444").onClick(() => this.plugin.addGraphColorGroup())
    );
    new import_obsidian8.Setting(containerEl).setName("\u0421\u0447\u0451\u0442\u0447\u0438\u043A \u0441\u043B\u043E\u0432 \u0438 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u0421\u0447\u0438\u0442\u0430\u0442\u044C \u0441\u043B\u043E\u0432\u0430 \u0437\u0430 \u0434\u0435\u043D\u044C").setDesc(
      "\u0423\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0441\u043B\u043E\u0432\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0432\u044B \u043F\u0438\u0448\u0435\u0442\u0435 \u0432 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0435. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043E\u0442 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u0438 \u0434\u0440\u0443\u0433\u0438\u0445 \u043F\u043B\u0430\u0433\u0438\u043D\u043E\u0432 \u043D\u0435 \u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F. \u041A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0437\u043D\u0430\u0447\u043A\u043E\u043C \u{1F4C5} \u043D\u0430 \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043B\u0435\u043D\u0442\u0435 \u0438\u043B\u0438 \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 \xAB\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C \u0438 \u0441\u0447\u0451\u0442\u0447\u0438\u043A \u0441\u043B\u043E\u0432\xBB."
    ).addToggle(
      (t) => t.setValue(s.wordCountEnabled).onChange(async (v) => {
        s.wordCountEnabled = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0426\u0435\u043B\u044C \u043D\u0430 \u0434\u0435\u043D\u044C (\u0441\u043B\u043E\u0432)").setDesc("0 \u2014 \u0431\u0435\u0437 \u0446\u0435\u043B\u0438.").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.setValue(String(s.dailyGoal)).onChange(async (v) => {
        const n = Math.max(0, Math.floor(Number(v)) || 0);
        s.dailyGoal = n;
        await save();
      });
    });
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u043A\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F").setDesc("\u0422\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0435: \xAB\u270D 342 / 500\xBB \u0432\u043D\u0438\u0437\u0443 \u043E\u043A\u043D\u0430.").addToggle(
      (t) => t.setValue(s.showStatusBar).onChange(async (v) => {
        s.showStatusBar = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0410\u043D\u0438\u043C\u0430\u0446\u0438\u0438").setDesc("\u041A\u043E\u043B\u044C\u0446\u043E \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u0430, \u043A\u043E\u043D\u0444\u0435\u0442\u0442\u0438, \u043F\u0435\u0440\u0435\u043B\u0438\u0441\u0442\u044B\u0432\u0430\u043D\u0438\u0435 \u043C\u0435\u0441\u044F\u0446\u0435\u0432. \u0415\u0441\u043B\u0438 \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E \xAB\u0443\u043C\u0435\u043D\u044C\u0448\u0438\u0442\u044C \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435\xBB, \u0430\u043D\u0438\u043C\u0430\u0446\u0438\u0438 \u043E\u0442\u043A\u043B\u044E\u0447\u0430\u044E\u0442\u0441\u044F \u0441\u0430\u043C\u0438.").addToggle(
      (t) => t.setValue(s.animations).onChange(async (v) => {
        s.animations = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041F\u0430\u043F\u043A\u0430 \u0437\u0430\u043C\u0435\u0442\u043E\u043A \u0434\u043D\u044F").setDesc("\u041F\u0443\u0441\u0442\u043E \u2014 \u0432\u0437\u044F\u0442\u044C \u0438\u0437 \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u043E\u0433\u043E \u043F\u043B\u0430\u0433\u0438\u043D\u0430 \xAB\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438\xBB.").addText(
      (t) => t.setPlaceholder("\u0414\u043D\u0435\u0432\u043D\u0438\u043A").setValue(s.dailyFolder).onChange(async (v) => {
        s.dailyFolder = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0424\u043E\u0440\u043C\u0430\u0442 \u0438\u043C\u0435\u043D\u0438 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0434\u043D\u044F").setDesc("\u0424\u043E\u0440\u043C\u0430\u0442 moment.js, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 YYYY-MM-DD \u0438\u043B\u0438 YYYY/MM/YYYY-MM-DD. \u041F\u0443\u0441\u0442\u043E \u2014 \u0438\u0437 \xAB\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0445 \u0437\u0430\u043C\u0435\u0442\u043E\u043A\xBB \u0438\u043B\u0438 YYYY-MM-DD.").addText(
      (t) => t.setPlaceholder("YYYY-MM-DD").setValue(s.dailyFormat).onChange(async (v) => {
        s.dailyFormat = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0428\u0430\u0431\u043B\u043E\u043D \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0434\u043D\u044F").setDesc("\u041F\u0443\u0442\u044C \u043A \u0444\u0430\u0439\u043B\u0443-\u0448\u0430\u0431\u043B\u043E\u043D\u0443. \u041F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u044E\u0442\u0441\u044F {{date}}, {{date:DD.MM}}, {{time}}, {{title}}.").addText(
      (t) => t.setPlaceholder("\u0428\u0430\u0431\u043B\u043E\u043D\u044B/\u0414\u0435\u043D\u044C").setValue(s.dailyTemplate).onChange(async (v) => {
        s.dailyTemplate = v;
        await save();
      })
    );
    let armed = false;
    new import_obsidian8.Setting(containerEl).setName("\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443 \u0441\u043B\u043E\u0432").setDesc("\u0423\u0434\u0430\u043B\u044F\u0435\u0442 \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043F\u043E \u0432\u0441\u0435\u043C \u0434\u043D\u044F\u043C. \u0417\u0430\u043C\u0435\u0442\u043A\u0438 \u043D\u0435 \u0437\u0430\u0442\u0440\u0430\u0433\u0438\u0432\u0430\u044E\u0442\u0441\u044F.").addButton(
      (b) => b.setButtonText("\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C").onClick(async () => {
        if (!armed) {
          armed = true;
          b.setButtonText("\u0422\u043E\u0447\u043D\u043E \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C?").setWarning();
          window.setTimeout(() => {
            armed = false;
            b.setButtonText("\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C").buttonEl.removeClass("mod-warning");
          }, 4e3);
          return;
        }
        armed = false;
        await this.plugin.resetStats();
        b.setButtonText("\u0421\u0431\u0440\u043E\u0448\u0435\u043D\u043E \u2713").buttonEl.removeClass("mod-warning");
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0413\u0440\u0430\u0444: \u0434\u0435\u0440\u0435\u0432\u043E \u043F\u0440\u043E\u043A\u0430\u0447\u043A\u0438").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u041A\u0430\u0436\u0434\u0430\u044F \u043F\u0430\u043F\u043A\u0430 \u0432\u0435\u0440\u0445\u043D\u0435\u0433\u043E \u0443\u0440\u043E\u0432\u043D\u044F \u2014 \u0432\u0435\u0442\u043A\u0430, \u043A\u043E\u0442\u043E\u0440\u0430\u044F \u0440\u0430\u0441\u0442\u0451\u0442 \u0432 \u0441\u0432\u043E\u044E \u0441\u0442\u043E\u0440\u043E\u043D\u0443. \u0413\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043F\u0430\u043F\u043E\u043A \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u044F\u044E\u0442\u0441\u044F \u043A\u0430\u043A \u0443\u0437\u043B\u044B \u043D\u0430\u0432\u044B\u043A\u043E\u0432, \u0444\u0430\u0439\u043B\u044B \u0432\u0438\u0441\u044F\u0442 \u043D\u0430 \u043D\u0438\u0445 \u043B\u0438\u0441\u0442\u044C\u044F\u043C\u0438. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0435 \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u043C\u044B \u0433\u0440\u0430\u0444\u0430 Obsidian: \u043F\u043E\u0441\u043B\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F Obsidian \u043C\u043E\u0436\u0435\u0442 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u0442\u044C \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u2014 \u0442\u043E\u0433\u0434\u0430 \u043F\u0440\u043E\u0441\u0442\u043E \u0432\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u0435."
    });
    new import_obsidian8.Setting(containerEl).setName("\u0420\u0430\u0441\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u0442\u044C \u0433\u0440\u0430\u0444 \u0432\u0435\u0442\u043A\u0430\u043C\u0438").addToggle(
      (t) => t.setValue(s.skillTreeEnabled).onChange(async (v) => {
        s.skillTreeEnabled = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0424\u043E\u0440\u043C\u0430").addDropdown(
      (d) => d.addOptions({ radial: "\u0417\u0432\u0435\u0437\u0434\u0430 \u2014 \u0432\u0435\u0442\u043A\u0438 \u0432\u043E \u0432\u0441\u0435 \u0441\u0442\u043E\u0440\u043E\u043D\u044B", up: "\u0414\u0435\u0440\u0435\u0432\u043E \u043F\u0440\u043E\u043A\u0430\u0447\u043A\u0438 \u2014 \u0432\u0435\u0442\u043A\u0438 \u0440\u0430\u0441\u0442\u0443\u0442 \u0432\u0432\u0435\u0440\u0445" }).setValue(s.skillTreeStyle).onChange(async (v) => {
        s.skillTreeStyle = v;
        await save();
        this.display();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0414\u043B\u0438\u043D\u0430 \u0432\u0435\u0442\u043A\u0438").setDesc("\u0420\u0430\u0441\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043C\u0435\u0436\u0434\u0443 \u0443\u0440\u043E\u0432\u043D\u044F\u043C\u0438.").addSlider(
      (sl) => sl.setLimits(120, 700, 20).setValue(s.skillTreeStep).setDynamicTooltip().onChange(async (v) => {
        s.skillTreeStep = v;
        await save();
      })
    );
    if (s.skillTreeStyle === "radial") {
      new import_obsidian8.Setting(containerEl).setName("\u0428\u0438\u0440\u0438\u043D\u0430 \u0432\u0435\u0435\u0440\u0430 \u0432\u0435\u0442\u043A\u0438").setDesc("\u041D\u0430\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0448\u0438\u0440\u043E\u043A\u043E \u0440\u0430\u0441\u0445\u043E\u0434\u044F\u0442\u0441\u044F \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0438 \u043E\u0434\u043D\u043E\u0439 \u0432\u0435\u0442\u043A\u0438, \u0432 \u0433\u0440\u0430\u0434\u0443\u0441\u0430\u0445.").addSlider(
        (sl) => sl.setLimits(30, 180, 5).setValue(s.skillTreeSpread).setDynamicTooltip().onChange(async (v) => {
          s.skillTreeSpread = v;
          await save();
        })
      );
    }
    new import_obsidian8.Setting(containerEl).setName("\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u044F\u0442\u044C \u0438 \u0444\u0430\u0439\u043B\u044B").setDesc("\u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2014 \u0444\u0430\u0439\u043B\u044B \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E \xAB\u043F\u043B\u0430\u0432\u0430\u044E\u0442\xBB \u0432\u043E\u043A\u0440\u0443\u0433 \u0441\u0432\u043E\u0435\u0433\u043E \u0443\u0437\u043B\u0430. \u0412\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2014 \u0432\u044B\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u0430\u043A\u043A\u0443\u0440\u0430\u0442\u043D\u044B\u043C \u0432\u0435\u0435\u0440\u043E\u043C.").addToggle(
      (t) => t.setValue(s.skillTreePinFiles).onChange(async (v) => {
        s.skillTreePinFiles = v;
        await save();
      })
    );
    const roots = this.plugin.graphTree.buildTree().sort((a, b) => a.name.localeCompare(b.name));
    if (s.skillTreeStyle === "radial" && roots.length) {
      const dirOptions = { auto: "\u0410\u0432\u0442\u043E" };
      for (const [k, v] of Object.entries(DIRECTIONS)) dirOptions[k] = v.label;
      containerEl.createEl("div", { cls: "setting-item-name fh-subheading", text: "\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0432\u0435\u0442\u043E\u043A" });
      for (const root of roots) {
        new import_obsidian8.Setting(containerEl).setName(root.name).addDropdown(
          (d) => d.addOptions(dirOptions).setValue(s.branchDirections[root.name] ?? "auto").onChange(async (v) => {
            if (v === "auto") delete s.branchDirections[root.name];
            else s.branchDirections[root.name] = v;
            await save();
          })
        );
      }
    }
    new import_obsidian8.Setting(containerEl).setName("\u0413\u0440\u0430\u0444: \u044D\u0444\u0444\u0435\u043A\u0442\u044B").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u042D\u0444\u0444\u0435\u043A\u0442\u044B \u0432 \u0433\u0440\u0430\u0444\u0435").setDesc("\u0420\u0438\u0441\u0443\u044E\u0442\u0441\u044F \u043F\u043E\u0432\u0435\u0440\u0445 \u0433\u0440\u0430\u0444\u0430, \u0441\u0430\u043C \u0433\u0440\u0430\u0444 \u043D\u0435 \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F. \u041E\u0442\u043A\u043B\u044E\u0447\u0430\u044E\u0442\u0441\u044F \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043E\u0431\u0449\u0438\u043C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u0435\u043C \xAB\u0410\u043D\u0438\u043C\u0430\u0446\u0438\u0438\xBB.").addToggle(
      (t) => t.setValue(s.fxEnabled).onChange(async (v) => {
        s.fxEnabled = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0426\u0432\u0435\u0442 \u0438\u043C\u043F\u0443\u043B\u044C\u0441\u0430").addColorPicker(
      (c) => c.setValue(s.fxColor).onChange(async (v) => {
        s.fxColor = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0418\u043D\u0442\u0435\u0440\u0432\u0430\u043B \u0438\u043C\u043F\u0443\u043B\u044C\u0441\u0430, \u0441\u0435\u043A\u0443\u043D\u0434").addSlider(
      (sl) => sl.setLimits(1, 20, 1).setValue(s.fxInterval).setDynamicTooltip().onChange(async (v) => {
        s.fxInterval = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041A\u043E\u043B\u044C\u0446\u043E").setDesc("\u041E\u0442 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430 \u0440\u0430\u0441\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u043A\u043E\u043B\u044C\u0446\u043E.").addToggle(
      (t) => t.setValue(s.fxRing).onChange(async (v) => {
        s.fxRing = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041B\u0443\u0447\u0438 \u043F\u043E \u0441\u0432\u044F\u0437\u044F\u043C").setDesc("\u041E\u0442 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430 \u043F\u043E \u0441\u0432\u044F\u0437\u044F\u043C \u043A \u0444\u0430\u0439\u043B\u0430\u043C \u0438 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430\u043C \u0431\u0435\u0433\u0443\u0442 \u043B\u0443\u0447\u0438.").addToggle(
      (t) => t.setValue(s.fxWave).onChange(async (v) => {
        s.fxWave = v;
        await save();
        this.display();
      })
    );
    if (s.fxWave) {
      new import_obsidian8.Setting(containerEl).setName("\u0412\u0438\u0434 \u043B\u0443\u0447\u0430").setDesc("\u0418\u0441\u043A\u0440\u0430 \u2014 \u0441\u0432\u0435\u0442\u044F\u0449\u0430\u044F\u0441\u044F \u0442\u043E\u0447\u043A\u0430; \u041B\u0443\u0447 \u2014 \u043B\u0430\u0437\u0435\u0440 \u0441 \u044F\u0440\u043A\u0438\u043C \u043A\u043E\u043D\u0446\u043E\u043C; \u042D\u043D\u0435\u0440\u0433\u0438\u044F \u2014 \u0432\u043E\u043B\u043D\u0438\u0441\u0442\u044B\u0439 \u043F\u043E\u0442\u043E\u043A \u043F\u043B\u0430\u0437\u043C\u044B; \u042D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u2014 \u043C\u0435\u0440\u0446\u0430\u044E\u0449\u0430\u044F \u043C\u043E\u043B\u043D\u0438\u044F \u0441 \u0440\u0430\u0437\u0440\u044F\u0434\u0430\u043C\u0438.").addDropdown(
        (d) => d.addOptions(RAY_STYLES).setValue(s.rayStyle).onChange(async (v) => {
          s.rayStyle = v;
          await save();
        })
      );
      new import_obsidian8.Setting(containerEl).setName("\u0420\u0435\u0436\u0438\u043C \u043B\u0443\u0447\u0435\u0439").addDropdown(
        (d) => d.addOptions({
          pulse: "\u041F\u043E \u0438\u043C\u043F\u0443\u043B\u044C\u0441\u0443 \u2014 \u0432\u043E\u043B\u043D\u043E\u0439 \u043F\u043E \u0432\u0435\u0442\u043A\u0435",
          constant: "\u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E"
        }).setValue(s.rayMode).onChange(async (v) => {
          s.rayMode = v;
          await save();
        })
      );
      new import_obsidian8.Setting(containerEl).setName("\u0422\u043E\u043B\u0449\u0438\u043D\u0430 \u043B\u0443\u0447\u0435\u0439").addSlider(
        (sl) => sl.setLimits(0.5, 3, 0.25).setValue(s.rayWidth).setDynamicTooltip().onChange(async (v) => {
          s.rayWidth = v;
          await save();
        })
      );
    }
    new import_obsidian8.Setting(containerEl).setName("\u0421\u0432\u0435\u0447\u0435\u043D\u0438\u0435").setDesc("\u0413\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u043C\u044F\u0433\u043A\u043E \xAB\u0434\u044B\u0448\u0430\u0442\xBB \u0441\u0432\u0435\u0442\u043E\u043C.").addToggle(
      (t) => t.setValue(s.fxGlow).onChange(async (v) => {
        s.fxGlow = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0410\u043D\u0438\u043C\u0430\u0446\u0438\u044F \u0441\u0432\u044F\u0437\u0435\u0439").setDesc("\u041F\u043E \u043B\u0438\u043D\u0438\u044F\u043C \u0431\u0435\u0433\u0443\u0442 \u0448\u0442\u0440\u0438\u0445\u0438 \u0432 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0441\u0441\u044B\u043B\u043A\u0438 \u2014 \u043A\u0430\u043A \u0430\u043D\u0438\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u0435\u043B\u043A\u0438.").addDropdown(
      (d) => d.addOptions({ off: "\u0421\u0442\u0430\u0442\u0438\u0447\u043D\u043E", hubs: "\u0422\u043E\u043B\u044C\u043A\u043E \u043E\u0442 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432", all: "\u0412\u0441\u0435 \u0441\u0432\u044F\u0437\u0438" }).setValue(s.linkFlow).onChange(async (v) => {
        s.linkFlow = v;
        await save();
        this.display();
      })
    );
    if (s.linkFlow !== "off") {
      new import_obsidian8.Setting(containerEl).setName("\u0426\u0432\u0435\u0442 \u0438 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043F\u043E\u0442\u043E\u043A\u0430").addColorPicker(
        (c) => c.setValue(s.linkFlowColor).onChange(async (v) => {
          s.linkFlowColor = v;
          await save();
        })
      ).addSlider(
        (sl) => sl.setLimits(5, 120, 5).setValue(s.linkFlowSpeed).setDynamicTooltip().onChange(async (v) => {
          s.linkFlowSpeed = v;
          await save();
        })
      );
    }
    new import_obsidian8.Setting(containerEl).setName("\u0420\u043E\u0441\u0442 \u0434\u0435\u0440\u0435\u0432\u0430 \u043F\u0440\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0438").setDesc("\u0423\u0437\u043B\u044B \u0432\u044B\u0440\u0430\u0441\u0442\u0430\u044E\u0442 \u0438\u0437 \u0446\u0435\u043D\u0442\u0440\u0430 \u0432\u0435\u0442\u043A\u0430 \u0437\u0430 \u0432\u0435\u0442\u043A\u043E\u0439, \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u0437\u0430 \u0443\u0440\u043E\u0432\u043D\u0435\u043C (\u043D\u0443\u0436\u043D\u0430 \u0440\u0430\u0441\u043A\u043B\u0430\u0434\u043A\u0430 \u0432\u0435\u0442\u043A\u0430\u043C\u0438).").addToggle(
      (t) => t.setValue(s.graphGrow).onChange(async (v) => {
        s.graphGrow = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C FPS").setDesc(
      "\u0421\u0447\u0451\u0442\u0447\u0438\u043A \u043A\u0430\u0434\u0440\u043E\u0432 \u0432 \u0443\u0433\u043B\u0443 \u0433\u0440\u0430\u0444\u0430 \u0438 \u0442\u0435\u043A\u0443\u0449\u0435\u0435 \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u043E \u044D\u0444\u0444\u0435\u043A\u0442\u043E\u0432. \u041A\u0430\u0447\u0435\u0441\u0442\u0432\u043E \u043F\u043E\u0434\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0441\u0430\u043C\u043E: \u0435\u0441\u043B\u0438 \u043A\u0430\u0434\u0440 \u0440\u0438\u0441\u0443\u0435\u0442\u0441\u044F \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0434\u043E\u043B\u0433\u043E, \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u0443\u043F\u0440\u043E\u0449\u0430\u044E\u0442\u0441\u044F, \u0447\u0442\u043E\u0431\u044B \u0434\u0435\u0440\u0436\u0430\u0442\u044C 60 FPS."
    ).addToggle(
      (t) => t.setValue(s.fxShowFps).onChange(async (v) => {
        s.fxShowFps = v;
        await save();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0417\u0430\u043C\u043E\u0440\u043E\u0437\u0438\u0442\u044C \u0433\u0440\u0430\u0444").setDesc("\u041A\u043E\u0433\u0434\u0430 \u0443\u0437\u043B\u044B \u0443\u043B\u044F\u0433\u0443\u0442\u0441\u044F, \u043E\u043D\u0438 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u044E\u0442 \u0434\u0432\u0438\u0433\u0430\u0442\u044C\u0441\u044F. \u041C\u0435\u043D\u044C\u0448\u0435 \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043D\u0430 \u0442\u0435\u043B\u0435\u0444\u043E\u043D. \u042D\u0444\u0444\u0435\u043A\u0442\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u044E\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C.").addToggle(
      (t) => t.setValue(s.graphFreeze).onChange(async (v) => {
        s.graphFreeze = v;
        await save();
      })
    );
    this.displayModules(containerEl);
    new import_obsidian8.Setting(containerEl).setName("\u0423\u0440\u043E\u0432\u043D\u0438 \u0432\u0435\u0442\u043E\u043A").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u0432\u0435\u0442\u043A\u0438").setDesc(
      "\u041E\u043F\u044B\u0442 \u0432\u0435\u0442\u043A\u0438 = \u0441\u043B\u043E\u0432\u0430 \u0432\u043E \u0432\u0441\u0435\u0445 \u0435\u0451 \u0437\u0430\u043C\u0435\u0442\u043A\u0430\u0445 + 25 \u0437\u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443. \u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0443\u0440\u043E\u0432\u043D\u044F \u043F\u043E\u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0441\u043F\u0438\u0441\u043A\u0430 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430, \u0432 \u043F\u0430\u043D\u0435\u043B\u0438 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044F \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u0432\u0435\u0442\u043E\u043A. \u041F\u0440\u0438 \u043F\u043E\u0432\u044B\u0448\u0435\u043D\u0438\u0438 \u0443\u0440\u043E\u0432\u043D\u044F \u2014 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u0438 \u0432\u0441\u043F\u044B\u0448\u043A\u0430 \u0432 \u0433\u0440\u0430\u0444\u0435."
    ).addToggle(
      (t) => t.setValue(s.branchLevels).onChange(async (v) => {
        s.branchLevels = v;
        await save();
        await this.plugin.updateAll(false);
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F").setHeading();
    new import_obsidian8.Setting(containerEl).setName("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432\u043E \u0432\u0441\u0435\u0445 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0445 \u043F\u0430\u043F\u043A\u0430\u0445").addButton((b) => b.setButtonText("\u0421\u043E\u0437\u0434\u0430\u0442\u044C").onClick(() => this.plugin.createAll()));
    new import_obsidian8.Setting(containerEl).setName("\u041F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0432\u0441\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B").setDesc("\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C \u043D\u043E\u0432\u0443\u044E \u0440\u0430\u0441\u043A\u043B\u0430\u0434\u043A\u0443/\u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0443 \u043A\u043E \u0432\u0441\u0435\u043C. \u0420\u0443\u0447\u043D\u044B\u0435 \u043F\u0440\u0430\u0432\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u043F\u0438\u0441\u043A\u0430 \u0431\u0443\u0434\u0443\u0442 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u044B (\u0442\u0435\u043A\u0441\u0442 \u0432\u043D\u0435 \u0441\u043F\u0438\u0441\u043A\u0430 \u043D\u0435 \u0442\u0440\u043E\u0433\u0430\u0435\u0442\u0441\u044F).").addButton(
      (b) => b.setButtonText("\u041F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C").setWarning().onClick(async () => {
        await this.plugin.updateAll(true);
      })
    );
  }
  /** "Graph: modules" section with a small editor for each module. */
  displayModules(containerEl) {
    const s = this.plugin.settings;
    const changed = () => this.plugin.onModulesChanged();
    new import_obsidian8.Setting(containerEl).setName("\u0413\u0440\u0430\u0444: \u043C\u043E\u0434\u0443\u043B\u0438").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u041C\u043E\u0434\u0443\u043B\u044C \u2014 \u0431\u0430\u0440\u044C\u0435\u0440 \u0432\u043E\u043A\u0440\u0443\u0433 \u0433\u0440\u0443\u043F\u043F\u044B \u0437\u0430\u043C\u0435\u0442\u043E\u043A (\u043F\u0430\u043F\u043A\u0438 \u0438\u043B\u0438 \u0442\u0435\u0433\u0430): \u0433\u0440\u0430\u043D\u0438\u0446\u0430 \u0441\u0432\u043E\u0435\u0433\u043E \u0446\u0432\u0435\u0442\u0430, \u043A\u043E\u0442\u043E\u0440\u0430\u044F \u0440\u0430\u0441\u0442\u0451\u0442 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0447\u0438\u0441\u043B\u043E\u043C \u0437\u0430\u043C\u0435\u0442\u043E\u043A \u0438 \u0443\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u0438\u0445 \u0432\u043D\u0443\u0442\u0440\u0438. \u0411\u044B\u0441\u0442\u0440\u043E \u0441\u043E\u0437\u0434\u0430\u0442\u044C: \u043F\u0440\u0430\u0432\u044B\u0439 \u043A\u043B\u0438\u043A \u043F\u043E \u043F\u0430\u043F\u043A\u0435 \u2192 \xAB\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u0435\u043C \u0433\u0440\u0430\u0444\u0430\xBB."
    });
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u0438").addToggle(
      (t) => t.setValue(s.modulesEnabled).onChange(async (v) => {
        s.modulesEnabled = v;
        await changed();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0424\u043E\u0440\u043C\u0430 \u0433\u0440\u0430\u043D\u0438\u0446\u044B").addDropdown(
      (d) => d.addOptions({ cloud: "\u041E\u0431\u043B\u0430\u043A\u043E \u2014 \u043F\u043E \u0444\u043E\u0440\u043C\u0435 \u0433\u0440\u0443\u043F\u043F\u044B", circle: "\u041A\u0440\u0443\u0433" }).setValue(s.moduleShape).onChange(async (v) => {
        s.moduleShape = v;
        await changed();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041B\u0438\u043D\u0438\u044F \u0433\u0440\u0430\u043D\u0438\u0446\u044B \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E").addDropdown(
      (d) => d.addOptions(LINE_STYLES).setValue(s.moduleLine).onChange(async (v) => {
        s.moduleLine = v;
        await changed();
      })
    ).addSlider(
      (sl) => sl.setLimits(0.5, 3, 0.25).setValue(s.moduleLineWidth).setDynamicTooltip().onChange(async (v) => {
        s.moduleLineWidth = v;
        await changed();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u041F\u043E\u044F\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u043E\u0434\u0443\u043B\u044F").setDesc("\u041A\u0430\u043A \u0431\u0430\u0440\u044C\u0435\u0440 \u0432\u043E\u0437\u043D\u0438\u043A\u0430\u0435\u0442 \u043F\u0440\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0438 \u0433\u0440\u0430\u0444\u0430 \u0438\u043B\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u043C\u043E\u0434\u0443\u043B\u044F.").addDropdown(
      (d) => d.addOptions({ bubble: "\u041F\u0443\u0437\u044B\u0440\u044C \u2014 \u043D\u0430\u0434\u0443\u0432\u0430\u0435\u0442\u0441\u044F \u0438 \u043A\u043E\u043B\u044B\u0448\u0435\u0442\u0441\u044F", draw: "\u0417\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u043E \u043A\u0440\u0443\u0433\u0443", none: "\u0411\u0435\u0437 \u0430\u043D\u0438\u043C\u0430\u0446\u0438\u0438" }).setValue(s.moduleIntro).onChange(async (v) => {
        s.moduleIntro = v;
        await changed();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0420\u0430\u0437\u043C\u0435\u0440 \u0431\u0430\u0440\u044C\u0435\u0440\u0430").setDesc("\u041C\u043D\u043E\u0436\u0438\u0442\u0435\u043B\u044C: \u0431\u0430\u0440\u044C\u0435\u0440 \u0440\u0430\u0441\u0442\u0451\u0442 \u0441 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E\u043C \u0437\u0430\u043C\u0435\u0442\u043E\u043A (\u221An), \u044D\u0442\u043E \u2014 \u043E\u0431\u0449\u0438\u0439 \u043C\u0430\u0441\u0448\u0442\u0430\u0431.").addSlider(
      (sl) => sl.setLimits(0.5, 2.5, 0.1).setValue(s.moduleSize).setDynamicTooltip().onChange(async (v) => {
        s.moduleSize = v;
        await changed();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0423\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438").setDesc("\u0412\u044B\u043B\u0435\u0442\u0435\u0432\u0448\u0443\u044E \u0437\u0430 \u0431\u0430\u0440\u044C\u0435\u0440 \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u043C\u044F\u0433\u043A\u043E \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0432\u043D\u0443\u0442\u0440\u044C; \u0435\u0441\u043B\u0438 \u0435\u0451 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u0432\u044B\u0442\u0430\u043B\u043A\u0438\u0432\u0430\u0435\u0442 \u2014 \u0431\u0430\u0440\u044C\u0435\u0440 \u0440\u0430\u0441\u0448\u0438\u0440\u044F\u0435\u0442\u0441\u044F.").addToggle(
      (t) => t.setValue(s.moduleHold).onChange(async (v) => {
        s.moduleHold = v;
        await changed();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("\u0417\u0430\u043B\u0438\u0432\u043A\u0430, \u043F\u043E\u0434\u043F\u0438\u0441\u0438, \u0430\u043D\u0438\u043C\u0430\u0446\u0438\u044F \u0433\u0440\u0430\u043D\u0438\u0446\u044B").addToggle(
      (t) => t.setTooltip("\u041F\u043E\u043B\u0443\u043F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u0430\u044F \u0437\u0430\u043B\u0438\u0432\u043A\u0430").setValue(s.moduleFill).onChange(async (v) => {
        s.moduleFill = v;
        await changed();
      })
    ).addToggle(
      (t) => t.setTooltip("\u041F\u043E\u0434\u043F\u0438\u0441\u044C \u0441 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435\u043C \u0438 \u0447\u0438\u0441\u043B\u043E\u043C \u0437\u0430\u043C\u0435\u0442\u043E\u043A").setValue(s.moduleLabels).onChange(async (v) => {
        s.moduleLabels = v;
        await changed();
      })
    ).addToggle(
      (t) => t.setTooltip("\u0417\u0443\u0431\u0446\u044B/\u0448\u0442\u0440\u0438\u0445\u0438/\u0432\u043E\u043B\u043D\u0430 \u043F\u043E\u043B\u0437\u0443\u0442 \u0432\u0434\u043E\u043B\u044C \u0433\u0440\u0430\u043D\u0438\u0446\u044B").setValue(s.moduleAnimate).onChange(async (v) => {
        s.moduleAnimate = v;
        await changed();
      })
    );
    const folders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof import_obsidian9.TFolder && !f.isRoot()).map((f) => f.path).sort((a, b) => a.localeCompare(b));
    const lineOptions = { default: `\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E (${LINE_STYLES[s.moduleLine]})` };
    for (const [k, v] of Object.entries(LINE_STYLES)) lineOptions[k] = v;
    s.modules.forEach((m, i) => {
      const box = containerEl.createDiv({ cls: "fh-module-box" });
      box.style.setProperty("--fh-module-color", m.color);
      new import_obsidian8.Setting(box).setName(`\u041C\u043E\u0434\u0443\u043B\u044C ${i + 1}`).addText(
        (t) => t.setPlaceholder("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435").setValue(m.name).onChange(async (v) => {
          m.name = v;
          await changed();
        })
      ).addColorPicker(
        (c) => c.setValue(m.color).onChange(async (v) => {
          m.color = v;
          box.style.setProperty("--fh-module-color", v);
          await changed();
        })
      ).addExtraButton(
        (b) => b.setIcon("trash-2").setTooltip("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C").onClick(async () => {
          s.modules.splice(i, 1);
          await changed();
          this.display();
        })
      );
      const member = new import_obsidian8.Setting(box).setName("\u0421\u043E\u0441\u0442\u0430\u0432").addDropdown(
        (d) => d.addOptions({ folder: "\u041F\u0430\u043F\u043A\u0430", tag: "\u0422\u0435\u0433" }).setValue(m.kind).onChange(async (v) => {
          m.kind = v;
          m.value = "";
          await changed();
          this.display();
        })
      );
      if (m.kind === "folder" && folders.length <= 400) {
        member.addDropdown((d) => {
          d.addOption("", "\u2014 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0430\u043F\u043A\u0443 \u2014");
          for (const f of folders) d.addOption(f, f);
          d.setValue(m.value).onChange(async (v) => {
            m.value = v;
            if (!m.name || m.name === "\u041D\u043E\u0432\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C") m.name = v.split("/").pop() ?? v;
            await changed();
            this.display();
          });
        });
      } else {
        member.addText(
          (t) => t.setPlaceholder(m.kind === "tag" ? "\u0442\u0435\u0433 \u0431\u0435\u0437 #" : "\u041F\u0443\u0442\u044C \u043A \u043F\u0430\u043F\u043A\u0435").setValue(m.value).onChange(async (v) => {
            m.value = v.trim();
            await changed();
          })
        );
      }
      new import_obsidian8.Setting(box).setName("\u0413\u0440\u0430\u043D\u0438\u0446\u0430 \u0438 \u0442\u043E\u0447\u043A\u0438").addDropdown(
        (d) => d.addOptions(lineOptions).setValue(m.line).onChange(async (v) => {
          m.line = v;
          await changed();
        })
      ).addToggle(
        (t) => t.setTooltip("\u041A\u0440\u0430\u0441\u0438\u0442\u044C \u0442\u043E\u0447\u043A\u0438 \u043C\u043E\u0434\u0443\u043B\u044F \u0432 \u0435\u0433\u043E \u0446\u0432\u0435\u0442 (\u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0433\u043E \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u0433\u0440\u0430\u0444\u0430)").setValue(m.colorNodes).onChange(async (v) => {
          m.colorNodes = v;
          await changed();
        })
      );
    });
    new import_obsidian8.Setting(containerEl).addButton(
      (b) => b.setButtonText("\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C").setCta().onClick(async () => {
        s.modules.push({
          id: newModuleId(),
          name: "\u041D\u043E\u0432\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C",
          kind: "folder",
          value: "",
          color: MODULE_COLORS[s.modules.length % MODULE_COLORS.length],
          colorNodes: true,
          line: "default"
        });
        await changed();
        this.display();
      })
    );
  }
};

// src/main.ts
var INDEX_KEY = "folder-index";
var FolderHubPlugin = class extends import_obsidian10.Plugin {
  constructor() {
    super(...arguments);
    this.wordStats = {};
    this.tracker = new WordTracker(this);
    this.graphTree = new GraphTree(this);
    this.graphFx = new GraphFx(this);
    this.modules = new GraphModules(this);
    this.colorSyncTimer = null;
    this.levels = new BranchLevels(this);
    this.statusEl = null;
    this.saveStatsTimer = null;
    this.pending = /* @__PURE__ */ new Set();
    this.flushTimer = null;
    this.highlightTimer = null;
    this.queue = Promise.resolve();
    this.styleEl = null;
    this.lastCalendarSig = "";
    this.lastTreeSig = "";
    /** Folder path → index note path (null = none). Cleared on any vault/metadata change. */
    this.indexCache = /* @__PURE__ */ new Map();
    /** Choices made in this session, before the metadata cache has caught up. */
    this.indexOverride = /* @__PURE__ */ new Map();
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new FolderHubSettingTab(this.app, this));
    this.styleEl = document.head.createEl("style", { attr: { id: "folder-hub-dynamic" } });
    this.register(() => this.styleEl?.remove());
    this.levels.start();
    this.modules.start();
    const clearIndex = () => this.invalidateIndexCache();
    this.registerEvent(this.app.vault.on("create", clearIndex));
    this.registerEvent(this.app.vault.on("delete", clearIndex));
    this.registerEvent(this.app.vault.on("rename", clearIndex));
    this.registerEvent(this.app.metadataCache.on("changed", clearIndex));
    this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));
    this.addRibbonIcon("calendar-days", "ObsOrg: \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C \u0438 \u0441\u0447\u0451\u0442\u0447\u0438\u043A \u0441\u043B\u043E\u0432", () => void this.activateCalendar());
    this.addCommand({
      id: "set-current-note-as-index",
      name: "\u041F\u0430\u043F\u043A\u0438: \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0433\u043B\u0430\u0432\u043D\u044B\u043C \u0444\u0430\u0439\u043B\u043E\u043C \u043F\u0430\u043F\u043A\u0438",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || !file.parent || file.parent.isRoot()) return false;
        if (this.findIndex(file.parent) === file) return false;
        if (!checking) void this.setAsIndex(file);
        return true;
      }
    });
    this.addCommand({
      id: "module-from-current-folder",
      name: "\u0413\u0440\u0430\u0444: \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u043F\u0430\u043F\u043A\u0443 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u043C\u043E\u0434\u0443\u043B\u0435\u043C",
      checkCallback: (checking) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder || folder.isRoot()) return false;
        if (!checking) void this.toggleFolderModule(folder, true);
        return true;
      }
    });
    this.addCommand({
      id: "toggle-modules",
      name: "\u0413\u0440\u0430\u0444: \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C/\u0441\u043A\u0440\u044B\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u0438",
      callback: async () => {
        this.settings.modulesEnabled = !this.settings.modulesEnabled;
        await this.saveSettings();
        new import_obsidian10.Notice(`\u041C\u043E\u0434\u0443\u043B\u0438 \u0432 \u0433\u0440\u0430\u0444\u0435 ${this.settings.modulesEnabled ? "\u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B" : "\u0441\u043A\u0440\u044B\u0442\u044B"}`);
      }
    });
    this.addCommand({
      id: "toggle-skill-tree",
      name: "\u0413\u0440\u0430\u0444: \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C/\u0432\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0434\u0435\u0440\u0435\u0432\u043E \u043F\u0440\u043E\u043A\u0430\u0447\u043A\u0438",
      callback: async () => {
        this.settings.skillTreeEnabled = !this.settings.skillTreeEnabled;
        await this.saveSettings();
        new import_obsidian10.Notice(`\u0414\u0435\u0440\u0435\u0432\u043E \u043F\u0440\u043E\u043A\u0430\u0447\u043A\u0438 \u0432 \u0433\u0440\u0430\u0444\u0435 ${this.settings.skillTreeEnabled ? "\u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E" : "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E"}`);
      }
    });
    this.addCommand({
      id: "open-calendar",
      name: "\u041A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C: \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C \u0438 \u0441\u0447\u0451\u0442\u0447\u0438\u043A \u0441\u043B\u043E\u0432",
      callback: () => void this.activateCalendar()
    });
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("fh-status", "mod-clickable");
    this.statusEl.addEventListener("click", () => void this.activateCalendar());
    this.addCommand({
      id: "create-index-current-folder",
      name: "\u041F\u0430\u043F\u043A\u0438: \u0441\u043E\u0437\u0434\u0430\u0442\u044C/\u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u0432 \u043F\u0430\u043F\u043A\u0435 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0437\u0430\u043C\u0435\u0442\u043A\u0438",
      checkCallback: (checking) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder || folder.isRoot()) return false;
        if (!checking) void this.createIndex(folder, true);
        return true;
      }
    });
    this.addCommand({
      id: "open-index-current-folder",
      name: "\u041F\u0430\u043F\u043A\u0438: \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u043F\u0430\u043F\u043A\u0438",
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
      name: "\u041F\u0430\u043F\u043A\u0438: \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432\u043E \u0432\u0441\u0435\u0445 \u043F\u0430\u043F\u043A\u0430\u0445 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430",
      callback: () => void this.createAll()
    });
    this.addCommand({
      id: "update-all-indexes",
      name: "\u041F\u0430\u043F\u043A\u0438: \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B",
      callback: async () => {
        const n = await this.updateAll(false);
        new import_obsidian10.Notice(`ObsOrg: \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432 \u2014 ${n}`);
      }
    });
    this.addCommand({
      id: "rebuild-all-indexes",
      name: "\u041F\u0430\u043F\u043A\u0438: \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0432\u0441\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0437\u0430\u043D\u043E\u0432\u043E (\u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u0440\u0430\u0432\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0431\u043B\u043E\u043A\u0430)",
      callback: async () => {
        const n = await this.updateAll(true);
        new import_obsidian10.Notice(`ObsOrg: \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0435\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432 \u2014 ${n}`);
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian10.TFile) {
          this.fileMenuForNote(menu, file);
          return;
        }
        if (!(file instanceof import_obsidian10.TFolder) || file.isRoot()) return;
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
        if (file.children.some((c) => c instanceof import_obsidian10.TFile && c.extension === "md")) {
          menu.addItem(
            (i) => i.setTitle("\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B\u2026").setIcon("list-checks").onClick(() => new ChooseIndexModal(this, file).open())
          );
        }
        const isModule = !!this.modules.findFolderModule(file);
        menu.addItem(
          (i) => i.setTitle(isModule ? "\u0423\u0431\u0440\u0430\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C \u0433\u0440\u0430\u0444\u0430" : "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u0435\u043C \u0433\u0440\u0430\u0444\u0430").setIcon(isModule ? "circle-off" : "circle-dashed").onClick(() => this.toggleFolderModule(file, !isModule))
        );
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (f) => this.onCreate(f)));
      this.registerEvent(this.app.vault.on("delete", (f) => this.onDelete(f)));
      this.registerEvent(this.app.vault.on("rename", (f, old) => this.onRename(f, old)));
      this.tracker.start();
      this.updateStatusBar();
      this.graphTree.start();
      this.graphFx.start();
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
    const raw = await this.loadData() ?? {};
    const { wordStats, ...settings } = raw;
    this.wordStats = wordStats ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    this.settings.branchDirections = { ...settings.branchDirections ?? {} };
    this.settings.managedGraphQueries = [...settings.managedGraphQueries ?? []];
    this.settings.modules = (settings.modules ?? []).map((m) => ({ ...m }));
    this.lastCalendarSig = this.calendarSignature();
    this.lastTreeSig = this.treeSignature();
  }
  /** Settings and word statistics live together in data.json. */
  async persist() {
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
    const sig = this.calendarSignature();
    if (sig !== this.lastCalendarSig) {
      this.lastCalendarSig = sig;
      this.calendarViews().forEach((v) => v.render());
    }
  }
  treeSignature() {
    const s = this.settings;
    return JSON.stringify([
      s.skillTreeEnabled,
      s.skillTreeStyle,
      s.skillTreeStep,
      s.skillTreeSpread,
      s.skillTreePinFiles,
      s.branchDirections,
      s.indexName,
      s.excludedFolders,
      s.graphFreeze
    ]);
  }
  calendarSignature() {
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
    }, 1e3);
  }
  async toggleFolderModule(folder, on) {
    if (on) {
      const m = this.modules.addFolderModule(folder);
      new import_obsidian10.Notice(`\u041C\u043E\u0434\u0443\u043B\u044C \xAB${m.name}\xBB \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u0433\u0440\u0430\u0444`);
    } else {
      const m = this.modules.findFolderModule(folder);
      if (m) this.modules.remove(m.id);
      new import_obsidian10.Notice(`\u041C\u043E\u0434\u0443\u043B\u044C \xAB${folder.name}\xBB \u0443\u0431\u0440\u0430\u043D \u0438\u0437 \u0433\u0440\u0430\u0444\u0430`);
    }
    await this.onModulesChanged();
  }
  // ------------------------------------------------------ words & calendar
  calendarViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).map((l) => l.view).filter((v) => v instanceof CalendarView);
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
  isIndexNote(file) {
    return !!file.parent && !file.parent.isRoot() && this.findIndex(file.parent) === file;
  }
  /** Called by the tracker after today's word count changed. */
  onWordsChanged(before, after) {
    if (this.saveStatsTimer !== null) window.clearTimeout(this.saveStatsTimer);
    this.saveStatsTimer = window.setTimeout(() => {
      this.saveStatsTimer = null;
      void this.persist();
    }, 3e3);
    this.updateStatusBar(true);
    const views = this.calendarViews();
    views.forEach((v) => v.updateToday());
    const goal = this.settings.dailyGoal;
    if (goal > 0 && before < goal && after >= goal) {
      views.forEach((v) => v.celebrate());
      new import_obsidian10.Notice(`\u{1F389} \u0426\u0435\u043B\u044C \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430: ${after.toLocaleString()} ${pluralRu(after, ["\u0441\u043B\u043E\u0432\u043E", "\u0441\u043B\u043E\u0432\u0430", "\u0441\u043B\u043E\u0432"])}!`);
    }
  }
  updateStatusBar(pulse = false) {
    const el = this.statusEl;
    if (!el) return;
    const show = this.settings.wordCountEnabled && this.settings.showStatusBar;
    el.toggle(show);
    if (!show) return;
    const added = this.tracker.today().added;
    const goal = this.settings.dailyGoal;
    el.setText(goal > 0 ? `\u270D ${added.toLocaleString()} / ${goal.toLocaleString()}` : `\u270D ${added.toLocaleString()}`);
    el.toggleClass("is-done", goal > 0 && added >= goal);
    (0, import_obsidian10.setTooltip)(el, "\u0421\u043B\u043E\u0432 \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u043E \u0441\u0435\u0433\u043E\u0434\u043D\u044F. \u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C.", { placement: "top" });
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
  onCreate(file) {
    if (file instanceof import_obsidian10.TFolder && this.settings.autoCreate && !this.isExcluded(file)) {
      window.setTimeout(() => {
        const folder = this.app.vault.getAbstractFileByPath(file.path);
        if (folder instanceof import_obsidian10.TFolder && !this.findIndex(folder)) {
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
    if (file instanceof import_obsidian10.TFolder && this.settings.renameWithFolder) {
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
    if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof import_obsidian10.TFolder)) return;
    const oldIndex = this.app.vault.getAbstractFileByPath(
      (0, import_obsidian10.normalizePath)(`${folder.path}/${this.indexNameFor(oldFolderName)}.md`)
    );
    const newPath = this.expectedIndexPath(folder);
    if (!(oldIndex instanceof import_obsidian10.TFile) || oldIndex.path === newPath) return;
    if (this.app.vault.getAbstractFileByPath(newPath)) return;
    try {
      await this.app.fileManager.renameFile(oldIndex, newPath);
    } catch (e) {
      console.error("ObsOrg: failed to rename index", e);
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
        if (folder instanceof import_obsidian10.TFolder) this.enqueue(() => this.updateFolder(folder, false));
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
    return (0, import_obsidian10.normalizePath)(`${folder.path}/${this.indexNameFor(folder.name)}.md`);
  }
  /**
   * The folder's index note. An explicit choice wins (frontmatter
   * `folder-index: true`, or a choice just made from the menu); otherwise
   * the note named after the folder, unless it was explicitly demoted
   * (`folder-index: false`).
   */
  findIndex(folder) {
    if (folder.isRoot()) return null;
    const cached = this.indexCache.get(folder.path);
    if (cached !== void 0) {
      if (cached === null) return null;
      const f = this.app.vault.getAbstractFileByPath(cached);
      if (f instanceof import_obsidian10.TFile && f.parent === folder) return f;
    }
    const found = this.computeIndex(folder);
    this.indexCache.set(folder.path, found?.path ?? null);
    return found;
  }
  computeIndex(folder) {
    const flag = (f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.[INDEX_KEY];
    const override = this.indexOverride.get(folder.path);
    if (override) {
      const f = this.app.vault.getAbstractFileByPath(override);
      if (f instanceof import_obsidian10.TFile && f.parent === folder && flag(f) !== false) return f;
      this.indexOverride.delete(folder.path);
    }
    const expected = this.expectedIndexPath(folder);
    const flagged = [];
    for (const child of folder.children) {
      if (child instanceof import_obsidian10.TFile && child.extension === "md" && flag(child) === true) flagged.push(child);
    }
    if (flagged.length) return flagged.find((f) => f.path === expected) ?? flagged[0];
    const byName = this.app.vault.getAbstractFileByPath(expected);
    if (byName instanceof import_obsidian10.TFile && flag(byName) !== false) return byName;
    return null;
  }
  invalidateIndexCache() {
    this.indexCache.clear();
  }
  /** Makes `file` the index note of its folder; the previous one becomes a plain note. */
  async setAsIndex(file) {
    const folder = file.parent;
    if (!folder || folder.isRoot() || file.extension !== "md") return;
    const old = this.findIndex(folder);
    if (old === file) {
      new import_obsidian10.Notice(`\xAB${file.basename}\xBB \u0443\u0436\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438 \xAB${folder.name}\xBB`);
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
    new import_obsidian10.Notice(`\u0413\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438 \xAB${folder.name}\xBB: ${file.basename}`);
  }
  /** Stops `file` from being an index note (its list is removed, the rest of the note stays). */
  async unsetIndex(file) {
    const folder = file.parent;
    if (!folder) return;
    this.indexOverride.delete(folder.path);
    await this.demoteIndex(file);
    this.invalidateIndexCache();
    this.scheduleAncestors(parentPath(folder.path));
    this.afterIndexChange();
    new import_obsidian10.Notice(`\xAB${file.basename}\xBB \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438 \xAB${folder.name}\xBB`);
  }
  async demoteIndex(file) {
    const tag = this.settings.tag.replace(/^#/, "").trim();
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[INDEX_KEY] = false;
      if (tag && fm.tags !== void 0) {
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
  fileMenuForNote(menu, file) {
    const folder = file.parent;
    if (file.extension !== "md" || !folder || folder.isRoot() || this.isExcluded(folder)) return;
    if (this.findIndex(folder) === file) {
      menu.addItem(
        (i) => i.setTitle("\u041F\u0435\u0440\u0435\u0441\u0442\u0430\u0442\u044C \u0431\u044B\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u043C \u0444\u0430\u0439\u043B\u043E\u043C").setIcon("star-off").onClick(() => this.unsetIndex(file))
      );
    } else {
      menu.addItem(
        (i) => i.setTitle(`\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0433\u043B\u0430\u0432\u043D\u044B\u043C \u0444\u0430\u0439\u043B\u043E\u043C \u043F\u0430\u043F\u043A\u0438 \xAB${folder.name}\xBB`).setIcon("star").onClick(() => this.setAsIndex(file))
      );
    }
  }
  /** Everything that depends on which notes are index notes. */
  afterIndexChange() {
    this.refreshHighlight();
    this.graphTree.refresh();
    this.levels.scheduleRefresh();
  }
  isExcluded(folder) {
    if (folder.isRoot()) return true;
    const list = this.settings.excludedFolders.split("\n").map((s) => (0, import_obsidian10.normalizePath)(s.trim())).filter((s) => s && s !== "/");
    return list.some((p) => folder.path === p || folder.path.startsWith(p + "/"));
  }
  allFolders() {
    return this.app.vault.getAllLoadedFiles().filter((f) => f instanceof import_obsidian10.TFolder && !f.isRoot());
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
        if (child instanceof import_obsidian10.TFile) {
          if (child === index) continue;
          if (dir !== folder && this.findIndex(dir) === child) continue;
          if (this.fileAllowed(child)) files.set(child.path, { file: child, sub: false });
        } else if (child instanceof import_obsidian10.TFolder) {
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
      formatDate: (ms) => (0, import_obsidian10.moment)(ms).format(fmt)
    };
  }
  computeBody(index, items, content, force) {
    const opts = this.renderOptions();
    const raw = extractBlockBody(content);
    const existing = raw ? stripLevelFence(raw) : null;
    const preserve = !force && this.settings.preserveEdits && this.settings.layout !== "table" && existing !== null;
    const body = preserve ? mergePreserving(
      existing,
      items,
      (linkpath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, index.path)?.path ?? null,
      opts
    ) : renderItems(items, opts);
    return this.settings.branchLevels ? [...LEVEL_FENCE, ...body] : body;
  }
  /** Rewrites the managed block of the folder's index note. Returns true if it changed. */
  async updateFolder(folder, force) {
    if (!(this.app.vault.getAbstractFileByPath(folder.path) instanceof import_obsidian10.TFolder)) return false;
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
            date: (0, import_obsidian10.moment)().format(this.settings.dateFormat || "YYYY-MM-DD")
          },
          buildBlock([])
        );
        index = await this.app.vault.create(path, content);
      } catch (e) {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (!(existing instanceof import_obsidian10.TFile)) {
          console.error("ObsOrg: failed to create index", e);
          new import_obsidian10.Notice(`ObsOrg: \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C ${path}`);
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
    new import_obsidian10.Notice(`ObsOrg: \u0441\u043E\u0437\u0434\u0430\u043D\u043E \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432 \u2014 ${created}`);
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
  /** Adds the index-note colour group ("tag:#<tag>") to the graph. */
  async addGraphColorGroup() {
    await this.graphTree.syncColorGroups(true, true);
  }
};
var ChooseIndexModal = class extends import_obsidian10.FuzzySuggestModal {
  constructor(plugin, folder) {
    super(plugin.app);
    this.plugin = plugin;
    this.folder = folder;
    this.setPlaceholder(`\u0413\u043B\u0430\u0432\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043F\u0430\u043F\u043A\u0438 \xAB${folder.name}\xBB`);
  }
  getItems() {
    const current = this.plugin.findIndex(this.folder);
    return this.folder.children.filter((c) => c instanceof import_obsidian10.TFile && c.extension === "md").sort((a, b) => a === current ? -1 : b === current ? 1 : a.basename.localeCompare(b.basename));
  }
  getItemText(file) {
    return file === this.plugin.findIndex(this.folder) ? `\u2605 ${file.basename} (\u0441\u0435\u0439\u0447\u0430\u0441 \u0433\u043B\u0430\u0432\u043D\u044B\u0439)` : file.basename;
  }
  onChooseItem(file) {
    void this.plugin.setAsIndex(file);
  }
};
