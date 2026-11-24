import { ItemView, TFile, WorkspaceLeaf, moment, setIcon, setTooltip } from "obsidian";
import type FolderHubPlugin from "./main";
import { findDaily, openDaily } from "./daily";
import { todayKey } from "./tracker";
import { addDays, computeStreak, heatLevel, pluralRu, toKey } from "./words";

export const VIEW_TYPE_CALENDAR = "folder-hub-calendar";

const KEY = "YYYY-MM-DD";
const SVG_NS = "http://www.w3.org/2000/svg";
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;
const WORDS: [string, string, string] = ["слово", "слова", "слов"];
const DAYS: [string, string, string] = ["день", "дня", "дней"];
const NOTES: [string, string, string] = ["заметка", "заметки", "заметок"];

type Moment = ReturnType<typeof moment>;

export class CalendarView extends ItemView {
	private month: Moment = moment().startOf("month");
	private selected = todayKey();
	private lastToday = todayKey();
	private shownToday = 0;

	// Elements updated live while the user types.
	private ringWrap!: HTMLElement;
	private ringFg!: SVGCircleElement;
	private numEl!: HTMLElement;
	private goalEl!: HTMLElement;
	private metaEl!: HTMLElement;
	private weekEl!: HTMLElement;
	private gridWrap!: HTMLElement;
	private detailsEl!: HTMLElement;
	private cells = new Map<string, HTMLElement>();

	constructor(leaf: WorkspaceLeaf, private plugin: FolderHubPlugin) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_CALENDAR;
	}
	getDisplayText() {
		return "Календарь и слова";
	}
	getIcon() {
		return "calendar-days";
	}

	private get animated(): boolean {
		return this.plugin.settings.animations && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	}

	async onOpen() {
		this.render();
		// Midnight rollover: start a new day without reopening the panel.
		this.registerInterval(
			window.setInterval(() => {
				if (todayKey() !== this.lastToday) {
					this.lastToday = todayKey();
					this.selected = this.lastToday;
					this.month = moment().startOf("month");
					this.render();
				}
			}, 60_000),
		);
		// Daily notes / new notes change the dots on the calendar.
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
		const monthCard = root.createDiv({ cls: "fh-card fh-month" });
		this.renderMonthHeader(monthCard);
		this.gridWrap = monthCard.createDiv({ cls: "fh-grid-wrap" });
		this.renderMonth("none");
		this.detailsEl = root.createDiv({ cls: "fh-card fh-details" });
		this.renderDetails();
	}

	private renderToday(card: HTMLElement) {
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
		side.createDiv({ cls: "fh-title", text: "Сегодня" });
		this.metaEl = side.createDiv({ cls: "fh-meta" });

		this.shownToday = 0;
		// Start from empty and animate to the current value on the next frame.
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
		this.goalEl.setText(goal > 0 ? `из ${goal.toLocaleString()}` : pluralRu(added, WORDS));

		const streak = computeStreak(this.plugin.wordStats, todayKey(), goal);
		this.metaEl.empty();
		if (goal > 0 && added >= goal) {
			const b = this.metaEl.createDiv({ cls: "fh-badge" });
			setIcon(b.createSpan(), "check-circle");
			b.createSpan({ text: "Цель выполнена" });
		} else if (goal > 0) {
			this.metaEl.createDiv({
				cls: "fh-muted",
				text: `Осталось ${(goal - added).toLocaleString()} ${pluralRu(goal - added, WORDS)}`,
			});
		}
		const st = this.metaEl.createDiv({ cls: "fh-streak" + (streak > 0 ? " is-active" : "") });
		st.createSpan({ cls: "fh-flame", text: "🔥" });
		st.createSpan({ text: streak > 0 ? `${streak} ${pluralRu(streak, DAYS)} подряд` : "Серия не начата" });
		if (day.removed > 0) {
			this.metaEl.createDiv({ cls: "fh-muted", text: `Удалено: ${day.removed.toLocaleString()}` });
		}

		// Keep today's cell and bar in sync.
		const cell = this.cells.get(todayKey());
		if (cell) this.applyHeat(cell, added);
		this.renderWeek(false);
		if (this.selected === todayKey()) this.renderDetails(false);
	}

	celebrate() {
		if (!this.ringWrap) return;
		this.ringWrap.removeClass("is-celebrating");
		void this.ringWrap.offsetWidth; // restart the animation
		this.ringWrap.addClass("is-celebrating");
		if (!this.animated) return;
		const burst = this.ringWrap.createDiv({ cls: "fh-confetti" });
		const colors = ["var(--interactive-accent)", "var(--color-yellow)", "var(--color-green)", "var(--color-pink)", "var(--color-blue)"];
		for (let i = 0; i < 28; i++) {
			const p = burst.createSpan();
			const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
			const dist = 50 + Math.random() * 45;
			p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
			p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
			p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
			p.style.background = colors[i % colors.length];
			p.style.animationDelay = `${Math.random() * 80}ms`;
		}
		window.setTimeout(() => burst.remove(), 1400);
	}

	private animateNumber(el: HTMLElement, from: number, to: number) {
		if (!this.animated || from === to) {
			el.setText(to.toLocaleString());
			return;
		}
		const start = performance.now();
		const dur = 700;
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / dur);
			const eased = 1 - Math.pow(1 - t, 3);
			el.setText(Math.round(from + (to - from) * eased).toLocaleString());
			if (t < 1) window.requestAnimationFrame(step);
		};
		window.requestAnimationFrame(step);
	}

	/** Single-series bar chart of the last 7 days, with a goal reference line. */
	private renderWeek(initial: boolean) {
		const goal = this.plugin.settings.dailyGoal;
		const today = todayKey();
		const keys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
		const values = keys.map((k) => this.plugin.wordStats[k]?.added ?? 0);
		const max = Math.max(goal, ...values, 1);
		const total = values.reduce((a, b) => a + b, 0);

		if (initial || !this.weekEl.querySelector(".fh-bars")) {
			this.weekEl.empty();
			const head = this.weekEl.createDiv({ cls: "fh-row-between" });
			head.createDiv({ cls: "fh-title", text: "Последние 7 дней" });
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
					text: moment(k, KEY).format("dd"),
				});
			});
		}

		this.weekEl.querySelector(".fh-week-total")?.setText(`${total.toLocaleString()} ${pluralRu(total, WORDS)}`);
		const line = this.weekEl.querySelector<HTMLElement>(".fh-goal-line");
		if (line) {
			line.style.bottom = `${(goal / max) * 100}%`;
			setTooltip(line, `Цель: ${goal.toLocaleString()}`);
		}
		this.weekEl.querySelectorAll<HTMLElement>(".fh-bar-col").forEach((col, i) => {
			const v = values[i];
			const bar = col.querySelector<HTMLElement>(".fh-bar")!;
			bar.style.height = v > 0 ? `max(4px, ${(v / max) * 100}%)` : "0";
			bar.toggleClass("is-done", goal > 0 && v >= goal);
			setTooltip(col, `${moment(keys[i], KEY).format("dd, D MMM")}: ${v.toLocaleString()} ${pluralRu(v, WORDS)}`);
		});
	}

	private renderMonthHeader(card: HTMLElement) {
		const head = card.createDiv({ cls: "fh-month-head" });
		const prev = head.createEl("button", { cls: "clickable-icon fh-nav", attr: { "aria-label": "Предыдущий месяц" } });
		setIcon(prev, "chevron-left");
		head.createDiv({ cls: "fh-month-title" });
		const next = head.createEl("button", { cls: "clickable-icon fh-nav", attr: { "aria-label": "Следующий месяц" } });
		setIcon(next, "chevron-right");
		const todayBtn = head.createEl("button", { cls: "fh-today-btn", text: "Сегодня" });

		prev.addEventListener("click", () => {
			this.month = this.month.clone().subtract(1, "month");
			this.renderMonth("right");
		});
		next.addEventListener("click", () => {
			this.month = this.month.clone().add(1, "month");
			this.renderMonth("left");
		});
		todayBtn.addEventListener("click", () => {
			const target = moment().startOf("month");
			const dir = target.isSame(this.month) ? "none" : target.isAfter(this.month) ? "left" : "right";
			this.month = target;
			this.select(todayKey());
			this.renderMonth(dir);
		});
	}

	private renderMonth(dir: "left" | "right" | "none") {
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

		for (let i = 0; i < 7; i++) {
			grid.createDiv({ cls: "fh-weekday", text: start.clone().add(i, "day").format("dd") });
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
			if (created) parts.push(`${created} ${pluralRu(created, NOTES)} создано`);
			setTooltip(cell, parts.join(" · "));
			cell.addEventListener("click", () => {
				if (this.selected === key) void this.openDay(key);
				else this.select(key);
			});
			this.cells.set(key, cell);
		}
	}

	private applyHeat(cell: HTMLElement, words: number) {
		for (let l = 0; l <= 4; l++) cell.removeClass(`fh-heat-${l}`);
		cell.addClass(`fh-heat-${heatLevel(words, this.plugin.settings.dailyGoal)}`);
	}

	private select(key: string) {
		this.cells.get(this.selected)?.removeClass("is-selected");
		this.selected = key;
		const cell = this.cells.get(key);
		if (cell) {
			cell.addClass("is-selected");
		} else {
			// Selected a day outside the visible month (e.g. from the week chart).
			const m = moment(key, KEY).startOf("month");
			const dir = m.isAfter(this.month) ? "left" : "right";
			this.month = m;
			this.renderMonth(dir);
		}
		this.renderDetails();
	}

	private async openDay(key: string) {
		await openDaily(this.app, this.plugin.settings, key);
		this.renderMonth("none");
		this.renderDetails(false);
	}

	private renderDetails(animate = true) {
		const el = this.detailsEl;
		if (!el) return;
		const key = this.selected;
		const date = moment(key, KEY);
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
		const line = el.createDiv({ cls: "fh-detail-line" });
		setIcon(line.createSpan({ cls: "fh-icon" }), "pencil");
		line.createSpan({ text: `${stat.added.toLocaleString()} ${pluralRu(stat.added, WORDS)} написано` });
		if (stat.removed) line.createSpan({ cls: "fh-muted", text: ` · ${stat.removed.toLocaleString()} удалено` });

		const btn = el.createEl("button", { cls: "mod-cta fh-daily-btn" });
		setIcon(btn.createSpan(), daily ? "file-text" : "file-plus");
		btn.createSpan({ text: daily ? "Открыть заметку дня" : "Создать заметку дня" });
		btn.addEventListener("click", () => void this.openDay(key));

		if (created.length) {
			el.createDiv({ cls: "fh-subtitle", text: `Новые заметки (${created.length})` });
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

	private createdNotesByDay(): Map<string, TFile[]> {
		const map = new Map<string, TFile[]>();
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
}
