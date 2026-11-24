// Pure helpers for the daily word counter (no Obsidian dependency).

export interface DayStat {
	/** Words added (sum of positive deltas). */
	added: number;
	/** Words removed (sum of negative deltas, as a positive number). */
	removed: number;
}

export type StatsData = Record<string, DayStat>;

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;

/** Counts words in a Markdown note, ignoring frontmatter and %% comments %%. */
export function countWords(text: string): number {
	let body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
	body = body.replace(/%%[\s\S]*?%%/g, " ");
	const cjk = body.match(CJK)?.length ?? 0;
	const words = body.replace(CJK, " ").match(WORD)?.length ?? 0;
	return cjk + words;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
	const d = fromKey(key);
	d.setDate(d.getDate() + n);
	return toKey(d);
}

/** Days in a row (ending today, or yesterday if today isn't done yet) meeting the goal. */
export function computeStreak(stats: StatsData, todayKey: string, goal: number): number {
	const min = goal > 0 ? goal : 1;
	const met = (k: string) => (stats[k]?.added ?? 0) >= min;
	let k = met(todayKey) ? todayKey : addDays(todayKey, -1);
	let n = 0;
	while (met(k) && n < 10000) {
		n++;
		k = addDays(k, -1);
	}
	return n;
}

/** 0 = nothing written, 1..4 = share of the goal (or of 500 words without a goal). */
export function heatLevel(words: number, goal: number): 0 | 1 | 2 | 3 | 4 {
	if (words <= 0) return 0;
	const r = words / (goal > 0 ? goal : 500);
	if (r >= 1) return 4;
	if (r >= 0.5) return 3;
	if (r >= 0.25) return 2;
	return 1;
}

/** Russian plural form: pluralRu(5, ["слово", "слова", "слов"]) → "слов". */
export function pluralRu(n: number, forms: [string, string, string]): string {
	const a = Math.abs(n) % 100;
	const b = a % 10;
	if (a > 10 && a < 20) return forms[2];
	if (b > 1 && b < 5) return forms[1];
	if (b === 1) return forms[0];
	return forms[2];
}
