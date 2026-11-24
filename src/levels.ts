// Branch levels ("skill tree" progression). Pure, no Obsidian dependency.

/** XP granted per note in a branch, on top of its words. */
export const XP_PER_NOTE = 25;

export function branchXp(words: number, notes: number): number {
	return Math.max(0, Math.round(words)) + Math.max(0, notes) * XP_PER_NOTE;
}

/** Total XP needed to reach `level`: 200, 600, 1200, 2000, 3000 … (grows quadratically). */
export function xpForLevel(level: number): number {
	return 100 * level * (level + 1);
}

export interface LevelInfo {
	level: number;
	xp: number;
	/** XP at the start of the current level. */
	floor: number;
	/** XP needed for the next level. */
	next: number;
	/** 0..1 progress inside the current level. */
	progress: number;
}

export function levelFromXp(xp: number): LevelInfo {
	const safe = Math.max(0, xp);
	// Solve 100·L·(L+1) ≤ xp for the largest integer L.
	let level = Math.floor((-1 + Math.sqrt(1 + safe / 25)) / 2);
	while (xpForLevel(level + 1) <= safe) level++;
	while (level > 0 && xpForLevel(level) > safe) level--;
	const floor = xpForLevel(level);
	const next = xpForLevel(level + 1);
	return { level, xp: safe, floor, next, progress: (safe - floor) / (next - floor) };
}

/** The constant code block the plugin keeps at the top of an index note's list. */
export const LEVEL_FENCE = ["```folder-hub-level", "```"];

/** Removes every LEVEL_FENCE pair from the block body. */
export function stripLevelFence(lines: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === LEVEL_FENCE[0] && lines[i + 1]?.trim() === LEVEL_FENCE[1]) {
			i++;
			continue;
		}
		out.push(lines[i]);
	}
	return out;
}
