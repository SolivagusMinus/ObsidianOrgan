import { test } from "node:test";
import assert from "node:assert/strict";
import {
	BLOCK_END,
	BLOCK_START,
	Item,
	RenderOptions,
	applyBlock,
	extractBlockBody,
	extractLinkpaths,
	fillNoteTemplate,
	mergePreserving,
	renderItems,
	sortItems,
} from "../src/render";

const item = (name: string, extra: Partial<Item> = {}): Item => ({
	linktext: name,
	name,
	ext: "md",
	path: `Menu/${name}.md`,
	ctime: 0,
	mtime: 0,
	isSubIndex: false,
	...extra,
});

const opts = (o: Partial<RenderOptions> = {}): RenderOptions => ({
	layout: "list",
	columns: 3,
	tableHeaders: "Файлы",
	itemTemplate: "- {{link}}",
	formatDate: (ms) => new Date(ms).toISOString().slice(0, 10),
	...o,
});

test("list layout renders a column of wikilinks", () => {
	assert.deepEqual(renderItems([item("Суп"), item("Салат")], opts()), ["- [[Суп]]", "- [[Салат]]"]);
});

test("numbered and custom layouts", () => {
	assert.deepEqual(renderItems([item("A"), item("B")], opts({ layout: "numbered" })), [
		"1. [[A]]",
		"2. [[B]]",
	]);
	assert.deepEqual(
		renderItems([item("A", { ctime: 0 })], opts({ layout: "custom", itemTemplate: "- [ ] {{link}} ({{ctime}}) {{x}}" })),
		["- [ ] [[A]] (1970-01-01) {{x}}"],
	);
});

test("table layout fills column by column", () => {
	const lines = renderItems(["A", "B", "C", "D", "E"].map((n) => item(n)), opts({ layout: "table", columns: 2 }));
	assert.deepEqual(lines, [
		"| Файлы |   |",
		"| --- | --- |",
		"| [[A]] | [[D]] |",
		"| [[B]] | [[E]] |",
		"| [[C]] |   |",
	]);
});

test("sorting: subfolders first, natural name order", () => {
	const sorted = sortItems(
		[item("File 10"), item("File 2"), item("Sub", { isSubIndex: true })],
		"name",
		"asc",
		true,
	);
	assert.deepEqual(sorted.map((i) => i.name), ["Sub", "File 2", "File 10"]);
});

test("applyBlock appends when missing and replaces in place when present", () => {
	const first = applyBlock("---\ntags: [x]\n---\n\nМоё описание", ["- [[A]]"]);
	assert.equal(first, `---\ntags: [x]\n---\n\nМоё описание\n\n${BLOCK_START}\n- [[A]]\n${BLOCK_END}\n`);

	const edited = first + "\nТекст после списка";
	const second = applyBlock(edited, ["- [[A]]", "- [[B]]"]);
	assert.ok(second.startsWith("---\ntags: [x]\n---\n\nМоё описание\n\n"));
	assert.ok(second.endsWith("\nТекст после списка"));
	assert.deepEqual(extractBlockBody(second), ["- [[A]]", "- [[B]]"]);
});

test("empty block round-trips", () => {
	const c = applyBlock("", []);
	assert.deepEqual(extractBlockBody(c), []);
	assert.equal(applyBlock(c, []), c);
});

test("extractLinkpaths handles aliases, headings and embeds", () => {
	assert.deepEqual(extractLinkpaths("- [[A|Алиас]] и [[B#Раздел]] и ![[img.png]]"), ["A", "B", "img.png"]);
});

test("mergePreserving keeps user edits, drops removed, appends new", () => {
	const existing = [
		"### Горячее",
		"- [[Суп]] — любимый",
		"- [[Удалённый]]",
		"",
		"просто заметка",
		"- [[Салат]]",
	];
	const items = [item("Салат"), item("Суп"), item("Новый")];
	const resolve = (lp: string) => (["Суп", "Салат", "Новый"].includes(lp) ? `Menu/${lp}.md` : null);
	const merged = mergePreserving(existing, items, resolve, opts());
	assert.deepEqual(merged, [
		"### Горячее",
		"- [[Суп]] — любимый",
		"",
		"просто заметка",
		"- [[Салат]]",
		"- [[Новый]]",
	]);
});

test("mergePreserving drops links to files moved out of the folder", () => {
	const resolve = (lp: string) => `Elsewhere/${lp}.md`;
	assert.deepEqual(mergePreserving(["- [[Moved]]"], [], resolve, opts()), []);
});

test("fillNoteTemplate substitutes vars and drops empty tag line", () => {
	const tpl = "---\ntags:\n  - {{tag}}\n---\n# {{folder}}\n{{list}}\n";
	assert.equal(fillNoteTemplate(tpl, { folder: "Меню", tag: "folder-index", date: "d" }, "B"), "---\ntags:\n  - folder-index\n---\n# Меню\nB\n");
	assert.equal(fillNoteTemplate(tpl, { folder: "Меню", tag: "", date: "d" }, "B"), "---\ntags:\n---\n# Меню\nB\n");
	assert.equal(fillNoteTemplate("Intro", { folder: "M", tag: "", date: "d" }, "B"), "Intro\n\nB\n");
});

// ---------------------------------------------------------------- words
import { addDays, computeStreak, countWords, heatLevel, pluralRu } from "../src/words";

test("countWords ignores frontmatter and comments, handles Cyrillic and CJK", () => {
	assert.equal(countWords("---\ntags: [a, b]\n---\nПривет, мир! Это тест."), 4);
	assert.equal(countWords("one %%hidden words here%% two"), 2);
	assert.equal(countWords("[[Суп]] и [[План статьи|план]] — don't stop"), 7);
	assert.equal(countWords("日本語 text"), 4);
	assert.equal(countWords(""), 0);
});

test("streak counts back from today or yesterday", () => {
	const s = { "2026-11-21": { added: 600, removed: 0 }, "2026-11-22": { added: 500, removed: 0 }, "2026-11-23": { added: 501, removed: 0 }, "2026-11-24": { added: 10, removed: 0 } };
	assert.equal(computeStreak(s, "2026-11-24", 500), 3); // today not done yet → from yesterday
	assert.equal(computeStreak(s, "2026-11-24", 0), 4); // no goal → any words
	assert.equal(computeStreak(s, "2026-11-26", 500), 0);
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("heat levels and Russian plurals", () => {
	assert.deepEqual([0, 50, 200, 300, 500, 900].map((w) => heatLevel(w, 500)), [0, 1, 2, 3, 4, 4]);
	const f: [string, string, string] = ["слово", "слова", "слов"];
	assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map((n) => pluralRu(n, f)), ["слово", "слова", "слов", "слов", "слово", "слова", "слов"]);
});
