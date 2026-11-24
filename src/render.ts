// Pure helpers with no Obsidian dependency, so they can be unit-tested in Node.

export const BLOCK_START = "%% folder-hub:start %%";
export const BLOCK_END = "%% folder-hub:end %%";

export type Layout = "list" | "numbered" | "table" | "custom";
export type SortBy = "name" | "ctime" | "mtime";
export type SortOrder = "asc" | "desc";

export interface Item {
	/** Text to put inside [[ ]] (shortest unambiguous link). */
	linktext: string;
	/** File name without extension. */
	name: string;
	/** Extension without the dot. */
	ext: string;
	/** Full vault path. */
	path: string;
	ctime: number;
	mtime: number;
	/** True when the item is the index note of a subfolder. */
	isSubIndex: boolean;
}

export interface RenderOptions {
	layout: Layout;
	columns: number;
	/** Comma-separated table headers. */
	tableHeaders: string;
	/** Per-item template for the "custom" layout. */
	itemTemplate: string;
	formatDate: (ms: number) => string;
}

export function wikilink(linktext: string): string {
	return `[[${linktext}]]`;
}

export function sortItems(
	items: Item[],
	sortBy: SortBy,
	order: SortOrder,
	subfoldersFirst: boolean,
): Item[] {
	const dir = order === "asc" ? 1 : -1;
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
	return [...items].sort((a, b) => {
		if (subfoldersFirst && a.isSubIndex !== b.isSubIndex) return a.isSubIndex ? -1 : 1;
		let cmp: number;
		if (sortBy === "ctime") cmp = a.ctime - b.ctime;
		else if (sortBy === "mtime") cmp = a.mtime - b.mtime;
		else cmp = collator.compare(a.name, b.name);
		if (cmp === 0) cmp = collator.compare(a.path, b.path);
		return cmp * dir;
	});
}

/** Renders one item as a single line (for list-like layouts). */
export function renderLine(item: Item, index: number, opts: RenderOptions): string {
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

export function applyItemTemplate(
	template: string,
	item: Item,
	index: number,
	opts: RenderOptions,
): string {
	const values: Record<string, string> = {
		link: wikilink(item.linktext),
		linktext: item.linktext,
		name: item.name,
		ext: item.ext,
		path: item.path,
		n: String(index + 1),
		ctime: opts.formatDate(item.ctime),
		mtime: opts.formatDate(item.mtime),
		type: item.isSubIndex ? "folder" : "file",
	};
	return (template || "- {{link}}").replace(/\{\{(\w+)\}\}/g, (m, key: string) =>
		key in values ? values[key] : m,
	);
}

/** Renders the whole list body (without markers). */
export function renderItems(items: Item[], opts: RenderOptions): string[] {
	if (opts.layout !== "table") return items.map((it, i) => renderLine(it, i, opts));
	return renderTable(items, opts);
}

/** Table filled column by column, so every column reads top-to-bottom. */
export function renderTable(items: Item[], opts: RenderOptions): string[] {
	const cols = Math.max(1, Math.min(10, Math.floor(opts.columns) || 1));
	const headers = opts.tableHeaders
		.split(",")
		.map((h) => h.trim());
	while (headers.length < cols) headers.push("");
	headers.length = cols;

	const lines: string[] = [];
	lines.push(`| ${headers.map((h) => h || " ").join(" | ")} |`);
	lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
	const rows = Math.ceil(items.length / cols);
	for (let r = 0; r < rows; r++) {
		const cells: string[] = [];
		for (let c = 0; c < cols; c++) {
			const it = items[c * rows + r];
			cells.push(it ? wikilink(it.linktext) : " ");
		}
		lines.push(`| ${cells.join(" | ")} |`);
	}
	return lines;
}

/** Returns lines between the markers, or null when the note has no managed block. */
export function extractBlockBody(content: string): string[] | null {
	const start = content.indexOf(BLOCK_START);
	if (start < 0) return null;
	const end = content.indexOf(BLOCK_END, start + BLOCK_START.length);
	if (end < 0) return null;
	const inner = content.slice(start + BLOCK_START.length, end);
	const lines = inner.split("\n");
	// Drop the line breaks that directly follow/precede the markers.
	if (lines.length && lines[0].trim() === "") lines.shift();
	if (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
	return lines;
}

export function buildBlock(body: string[]): string {
	return [BLOCK_START, ...body, BLOCK_END].join("\n");
}

/** Replaces the managed block in `content`, or appends it when absent. */
export function applyBlock(content: string, body: string[]): string {
	const block = buildBlock(body);
	const start = content.indexOf(BLOCK_START);
	const end = start >= 0 ? content.indexOf(BLOCK_END, start + BLOCK_START.length) : -1;
	if (start >= 0 && end >= 0) {
		return content.slice(0, start) + block + content.slice(end + BLOCK_END.length);
	}
	const trimmed = content.replace(/\s+$/, "");
	return (trimmed ? trimmed + "\n\n" : "") + block + "\n";
}

const LINK_RE = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Link paths (the part before #, ^ or |) of all wikilinks in a line. */
export function extractLinkpaths(line: string): string[] {
	const out: string[] = [];
	for (const m of line.matchAll(LINK_RE)) out.push(m[1].trim());
	return out;
}

/**
 * Merges the existing block with the current folder contents while keeping
 * the user's manual edits:
 *  - lines without links (comments, headings, blank lines) are kept;
 *  - lines whose link points to a file still in the folder are kept as written
 *    (so order and descriptions survive);
 *  - lines whose links no longer point into the folder are removed;
 *  - files not mentioned yet are appended in sorted order.
 *
 * `resolve` maps a linkpath to a vault path, or null when unresolved.
 */
export function mergePreserving(
	existing: string[],
	items: Item[],
	resolve: (linkpath: string) => string | null,
	opts: RenderOptions,
): string[] {
	const wanted = new Set(items.map((i) => i.path));
	const linked = new Set<string>();
	const kept: string[] = [];
	let linkLines = 0;

	for (const line of existing) {
		const linkpaths = extractLinkpaths(line);
		if (linkpaths.length === 0) {
			kept.push(line);
			continue;
		}
		const targets = linkpaths.map(resolve).filter((p): p is string => !!p && wanted.has(p));
		if (targets.length === 0) continue; // file was deleted or moved out
		targets.forEach((t) => linked.add(t));
		kept.push(line);
		linkLines++;
	}

	// Trim trailing blank lines before appending.
	while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();

	for (const item of items) {
		if (linked.has(item.path)) continue;
		kept.push(renderLine(item, linkLines++, opts));
	}
	return kept;
}

export function fillNoteTemplate(
	template: string,
	vars: { folder: string; tag: string; date: string },
	block: string,
): string {
	let text = template
		.replace(/\{\{folder\}\}/g, vars.folder)
		.replace(/\{\{date\}\}/g, vars.date);
	// Drop the "- {{tag}}" line entirely when no tag is configured.
	text = vars.tag
		? text.replace(/\{\{tag\}\}/g, vars.tag)
		: text.replace(/^[ \t]*-[ \t]*\{\{tag\}\}[ \t]*\n?/gm, "").replace(/\{\{tag\}\}/g, "");
	if (text.includes("{{list}}")) return text.replace("{{list}}", block);
	return text.replace(/\s+$/, "") + (text.trim() ? "\n\n" : "") + block + "\n";
}

export function parentPath(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

export function baseName(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}

/** Escapes a value for use inside a double-quoted CSS string. */
export function cssString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}
