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

// ---------------------------------------------------------------- skill tree
import { TreeNode, branchAngles, layoutSkillTree } from "../src/skilltree";

const node = (name: string, children: TreeNode[] = [], files = 0): TreeNode => ({
	id: `${name}/${name}.md`,
	name,
	children,
	files: Array.from({ length: files }, (_, i) => `${name}/f${i}.md`),
});
const opts3 = { style: "radial" as const, step: 300, spreadDeg: 110, pinFiles: false, directions: {} };

test("branches point in different directions, deeper levels further out", () => {
	const roots = [node("A", [node("A1"), node("A2")]), node("B", [node("B1")]), node("C")];
	const pos = layoutSkillTree(roots, opts3);
	const ang = (id: string) => Math.atan2(pos.get(id)!.y, pos.get(id)!.x);
	const dist = (id: string) => Math.hypot(pos.get(id)!.x, pos.get(id)!.y);
	assert.ok(Math.abs(dist("A/A.md") - 300) < 1e-6);
	assert.ok(Math.abs(dist("A1/A1.md") - 600) < 1e-6);
	// children stay inside their branch: A's kids closer in angle to A than to B or C
	const d = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
	for (const kid of ["A1/A1.md", "A2/A2.md"]) {
		assert.ok(d(ang(kid), ang("A/A.md")) < d(ang(kid), ang("B/B.md")));
		assert.ok(d(ang(kid), ang("A/A.md")) < d(ang(kid), ang("C/C.md")));
	}
	// branch centres are at least 60° apart
	const c = [ang("A/A.md"), ang("B/B.md"), ang("C/C.md")];
	for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(d(c[i], c[j]) > Math.PI / 3);
});

test("direction overrides are respected, auto branches take the largest gap", () => {
	const a = branchAngles([node("Меню"), node("Учёба")], { Меню: -90 });
	assert.ok(Math.abs(a[0] - (3 * Math.PI) / 2) < 1e-9); // -90° normalised = up
	assert.ok(Math.abs(a[1] - Math.PI / 2) < 1e-9); // opposite side = down
});

test("up style grows upward, files fan when pinned", () => {
	const roots = [node("A", [node("A1", [], 3)]), node("B")];
	const pos = layoutSkillTree(roots, { ...opts3, style: "up", pinFiles: true });
	assert.ok(pos.get("A1/A1.md")!.y < pos.get("A/A.md")!.y, "child above parent");
	assert.ok(pos.has("A1/f0.md") && pos.has("A1/f2.md"));
	assert.ok(pos.get("A1/f1.md")!.y < pos.get("A1/A1.md")!.y, "files above their node");
});

// ---------------------------------------------------------------- levels
import { LEVEL_FENCE, branchXp, levelFromXp, stripLevelFence, xpForLevel } from "../src/levels";

test("level thresholds grow and progress is inside the level", () => {
	assert.deepEqual([1, 2, 3, 4, 5].map(xpForLevel), [200, 600, 1200, 2000, 3000]);
	assert.equal(levelFromXp(0).level, 0);
	assert.equal(levelFromXp(199).level, 0);
	assert.equal(levelFromXp(200).level, 1);
	assert.equal(levelFromXp(1999).level, 3);
	const l = levelFromXp(1600);
	assert.equal(l.level, 3);
	assert.equal(l.progress, 0.5);
	assert.equal(branchXp(1000, 4), 1100);
	for (let xp = 0; xp < 50000; xp += 137) {
		const i = levelFromXp(xp);
		assert.ok(i.floor <= xp && xp < i.next && i.progress >= 0 && i.progress < 1);
	}
});

test("level fence is stripped wherever it is, other lines kept", () => {
	const body = ["- [[A]]", ...LEVEL_FENCE, "text", ...LEVEL_FENCE];
	assert.deepEqual(stripLevelFence([...LEVEL_FENCE, ...body]), ["- [[A]]", "text"]);
	assert.deepEqual(stripLevelFence(["```", "```folder-hub-level"]), ["```", "```folder-hub-level"]);
});

// ---------------------------------------------------------------- modules
import { convexHull, moduleOutline, moduleRadius, resampleClosed, smoothClosed } from "../src/module-shapes";

const inside = (poly: { x: number; y: number }[], p: { x: number; y: number }) => {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i], b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
	}
	return c;
};

test("convex hull of a square with an inner point", () => {
	const h = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]);
	assert.equal(h.length, 4);
});

test("module outline encloses every member with padding, both shapes", () => {
	const pts = [{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 120, y: 260 }, { x: -80, y: 150 }, { x: 60, y: 90 }];
	for (const shape of ["cloud", "circle"] as const) {
		const o = moduleOutline(pts, shape, 30, 50);
		for (const p of pts) {
			assert.ok(inside(o, p), `${shape}: member inside`);
			for (const d of [{ x: 25, y: 0 }, { x: -25, y: 0 }, { x: 0, y: 25 }, { x: 0, y: -25 }]) {
				assert.ok(inside(o, { x: p.x + d.x, y: p.y + d.y }), `${shape}: padding around member`);
			}
		}
		const smooth = smoothClosed(o, 6);
		assert.ok(smooth.length >= o.length * 5);
	}
	assert.ok(moduleOutline([], "cloud", 30, 50).length === 0);
	assert.ok(moduleOutline([{ x: 5, y: 5 }], "cloud", 30, 50).length >= 3, "single note still gets a barrier");
});

test("barrier grows with the number of notes", () => {
	assert.ok(moduleRadius(1) < moduleRadius(10) && moduleRadius(10) < moduleRadius(100));
	assert.ok(moduleRadius(50, 2) > moduleRadius(50, 1));
});

test("resampleClosed spaces points evenly around the outline", () => {
	const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
	const pts = resampleClosed(square, 10, 3);
	assert.equal(pts.length, 40);
	for (let i = 1; i < pts.length; i++) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		assert.ok(d > 7 && d <= 10.01, `step ${d}`);
	}
});

// ---------------------------------------------------------------- choosing a main file
import { removeBlock } from "../src/render";

test("removeBlock strips the managed list and keeps the user's text", () => {
	const note = `---\ntags: [x]\n---\n\nМоё описание\n\n${BLOCK_START}\n\`\`\`folder-hub-level\n\`\`\`\n- [[A]]\n${BLOCK_END}\n\nТекст после`;
	assert.equal(removeBlock(note), "---\ntags: [x]\n---\n\nМоё описание\n\nТекст после");
	assert.equal(removeBlock(`${BLOCK_START}\n- [[A]]\n${BLOCK_END}\n`), "");
	assert.equal(removeBlock("без блока"), "без блока");
});

import { polarRadii, elasticOut } from "../src/module-shapes";

test("polar radii of a square and a circle", () => {
	const sq = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
	const r = polarRadii(sq, { x: 0, y: 0 }, 8);
	assert.ok(Math.abs(r[0] - 10) < 1e-6, "straight up hits the top edge");
	assert.ok(Math.abs(r[1] - Math.SQRT2 * 10) < 1e-6, "diagonal hits the corner");
	assert.equal(elasticOut(0), 0);
	assert.equal(elasticOut(1), 1);
	assert.ok(Math.max(...[0.2, 0.3, 0.4].map(elasticOut)) > 1, "overshoots like a bubble");
});

import { separateCircles } from "../src/module-shapes";

test("modules are pushed apart: no overlaps, touching allowed, centre of mass kept", () => {
	const cs = [
		{ x: 0, y: 0, r: 200 },
		{ x: 50, y: 30, r: 150 },
		{ x: -40, y: 80, r: 90 },
		{ x: 0, y: 0, r: 60 }, // exactly on top of the first one
	];
	const mass = (a: typeof cs) => a.reduce((s, c) => [s[0] + c.x * (c.r * c.r + 1), s[1] + c.y * (c.r * c.r + 1)], [0, 0]);
	const before = mass(cs);
	separateCircles(cs, 10);
	for (let i = 0; i < cs.length; i++)
		for (let j = i + 1; j < cs.length; j++) {
			const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
			assert.ok(d >= cs[i].r + cs[j].r + 10 - 0.5, `pair ${i}-${j}: ${d.toFixed(1)}`);
		}
	const after = mass(cs);
	assert.ok(Math.abs(before[0] - after[0]) < 1 && Math.abs(before[1] - after[1]) < 1);
	// already apart → untouched
	const far = [{ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 10 }];
	separateCircles(far, 5);
	assert.deepEqual(far.map((c) => c.x), [0, 100]);
});

import { slimeClamp } from "../src/module-shapes";

test("slime contact: touching barriers meet at a flat shared edge", () => {
	// two equal circles of radius 100, centres 150 apart → they overlap by 50
	const a = { x: 0, y: 0 }, b = { x: 150, y: 0, R: 100 };
	// the ray towards the neighbour stops half-way (75), minus half the gap
	assert.ok(Math.abs(slimeClamp(a, 100, 0, 100, [b], 4) - 73) < 1e-9);
	// a ray at 30° stops on the same vertical line x = 75 (flat edge), shorter rays are untouched
	const r30 = slimeClamp(a, 100, Math.PI / 6, 100, [b], 0);
	assert.ok(Math.abs(r30 * Math.cos(Math.PI / 6) - 75) < 1e-6);
	assert.equal(slimeClamp(a, 100, Math.PI / 3, 100, [b], 0), 100); // 100·cos60° = 50 < 75
	// rays pointing away are untouched; far neighbours are ignored
	assert.equal(slimeClamp(a, 100, Math.PI, 100, [b], 4), 100);
	assert.equal(slimeClamp(a, 100, 0, 100, [{ x: 500, y: 0, R: 100 }], 4), 100);
	// the bigger module gets more room: the edge moves towards the smaller one
	assert.ok(slimeClamp(a, 140, 0, 140, [{ x: 150, y: 0, R: 60 }], 0) > 75);
});

// ---------------------------------------------------------------- bubbles (module physics)
import { Bubble, bubbleRadius, spiralSpot, stepBubbles } from "../src/module-sim";

const mkBubble = (id: string, x: number, n: number, unit = 60): Bubble => {
	const R = bubbleRadius(n, unit);
	return {
		id, x, y: 0, vx: 0, vy: 0, R, homeX: x, homeY: 0,
		notes: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, ...((p) => ({ rx: p.x, ry: p.y }))(spiralSpot(i, n, R)), vx: 0, vy: 0, seed: i })),
	};
};

test("bubbles: notes never leave, bubbles never overlap or shrink", () => {
	// three bubbles started on top of each other, notes kicked outwards
	const bs = [mkBubble("a", 0, 40), mkBubble("b", 30, 4), mkBubble("c", -20, 12)];
	const radii = bs.map((b) => b.R);
	bs.forEach((b) => b.notes.forEach((p) => { p.vx = (p.rx || 1) * 50; p.vy = (p.ry || 1) * 50; }));
	for (let i = 0; i < 600; i++) stepBubbles(bs, 1 / 30, { unit: 60, gap: 10, float: 0.5, t: i / 30 });
	assert.deepEqual(bs.map((b) => b.R), radii, "sizes are fixed");
	for (let i = 0; i < bs.length; i++)
		for (let j = i + 1; j < bs.length; j++) {
			const d = Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y);
			assert.ok(d >= bs[i].R + bs[j].R + 10 - 1, `bubbles ${i}/${j} apart: ${d.toFixed(0)}`);
		}
	for (const b of bs) for (const p of b.notes) assert.ok(Math.hypot(p.rx, p.ry) <= b.R, "note inside its bubble");
});

test("bubbles: without drift everything comes to rest", () => {
	const bs = [mkBubble("a", 0, 20), mkBubble("b", 500, 6)];
	let move = Infinity;
	for (let i = 0; i < 900; i++) move = stepBubbles(bs, 1 / 30, { unit: 60, gap: 10, float: 0, t: i / 30 });
	assert.ok(move < 0.05, `at rest (${move})`);
	assert.ok(bubbleRadius(100, 60) > bubbleRadius(4, 60));
});
