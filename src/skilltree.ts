// Pure "skill tree" layout for the graph view: every top-level folder is a
// branch that grows in its own direction. No Obsidian dependency.

export interface TreeNode {
	/** Graph node id = vault path of the folder's index note. */
	id: string;
	/** Folder name (used for per-branch direction overrides). */
	name: string;
	children: TreeNode[];
	/** Vault paths of plain files that hang off this node. */
	files: string[];
}

export type TreeStyle = "radial" | "up";

export interface LayoutOptions {
	style: TreeStyle;
	/** Distance between levels, in graph units (Obsidian's default link distance is 250). */
	step: number;
	/** Max angular width of one branch, degrees (radial style). */
	spreadDeg: number;
	/** Also pin plain files in a fan around their node. */
	pinFiles: boolean;
	/** Top-level folder name → direction in degrees (0 = right, -90 = up, 90 = down). */
	directions: Record<string, number | undefined>;
}

export interface Point {
	x: number;
	y: number;
}

/** Compass directions offered in the settings (screen coordinates: y grows downward). */
export const DIRECTIONS: Record<string, { label: string; deg: number }> = {
	up: { label: "↑ Вверх", deg: -90 },
	"up-right": { label: "↗ Вверх-вправо", deg: -45 },
	right: { label: "→ Вправо", deg: 0 },
	"down-right": { label: "↘ Вниз-вправо", deg: 45 },
	down: { label: "↓ Вниз", deg: 90 },
	"down-left": { label: "↙ Вниз-влево", deg: 135 },
	left: { label: "← Влево", deg: 180 },
	"up-left": { label: "↖ Вверх-влево", deg: -135 },
};

const TAU = Math.PI * 2;
const rad = (deg: number) => (deg * Math.PI) / 180;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Sector width weight: sub-folders count fully, files a little. */
export function weightOf(n: TreeNode): number {
	return 1 + Math.min(n.files.length, 20) * 0.1 + n.children.reduce((s, c) => s + weightOf(c), 0);
}

/**
 * Centre angle of every branch. Branches with a direction override keep it;
 * the rest are placed one by one into the largest free gap. Without overrides
 * the circle is shared in proportion to branch size, starting from "up".
 */
export function branchAngles(roots: TreeNode[], directions: LayoutOptions["directions"]): number[] {
	const n = roots.length;
	if (n === 0) return [];
	const fixed = roots.map((r) => directions[r.name]);
	const weights = roots.map(weightOf);

	if (fixed.every((d) => d === undefined)) {
		const total = weights.reduce((a, b) => a + b, 0);
		let acc = 0;
		return weights.map((w) => {
			const a = -Math.PI / 2 + ((acc + w / 2) / total) * TAU;
			acc += w;
			return norm(a);
		});
	}

	const angles: (number | undefined)[] = fixed.map((d) => (d === undefined ? undefined : norm(rad(d))));
	// Auto branches, biggest first, each into the middle of the largest gap.
	const auto = roots.map((_, i) => i).filter((i) => angles[i] === undefined);
	auto.sort((a, b) => weights[b] - weights[a]);
	for (const i of auto) {
		const taken = angles.filter((a): a is number => a !== undefined).sort((a, b) => a - b);
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
	return angles as number[];
}

/** For each branch: the angular sector it may use (half-way to its neighbours, capped). */
function branchSectors(centres: number[], spread: number): [number, number][] {
	const n = centres.length;
	if (n === 1) {
		const half = Math.min(spread, TAU) / 2;
		return [[centres[0] - half, centres[0] + half]];
	}
	const order = centres.map((a, i) => ({ a, i })).sort((p, q) => p.a - q.a);
	const out: [number, number][] = new Array(n);
	order.forEach(({ a, i }, k) => {
		const prev = order[(k - 1 + n) % n].a - (k === 0 ? TAU : 0);
		const next = order[(k + 1) % n].a + (k === n - 1 ? TAU : 0);
		const left = Math.min((a - prev) / 2, spread / 2);
		const right = Math.min((next - a) / 2, spread / 2);
		out[i] = [a - left * 0.92, a + right * 0.92]; // small gap between branches
	});
	return out;
}

function polar(r: number, a: number): Point {
	return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** Files as leaves: a fan of rows around `dir`, just beyond the node. */
function fanFiles(out: Map<string, Point>, node: TreeNode, at: Point, dir: number, step: number) {
	const perRow = 9;
	node.files.forEach((id, i) => {
		const row = Math.floor(i / perRow);
		const inRow = Math.min(perRow, node.files.length - row * perRow);
		const k = i % perRow;
		const width = Math.min(rad(150), rad(18) * Math.max(inRow - 1, 0));
		const a = inRow === 1 ? dir : dir - width / 2 + (width * k) / (inRow - 1);
		const r = step * (0.38 + row * 0.16);
		out.set(id, { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r });
	});
}

function layoutRadial(roots: TreeNode[], o: LayoutOptions): Map<string, Point> {
	const out = new Map<string, Point>();
	const centres = branchAngles(roots, o.directions);
	const sectors = branchSectors(centres, rad(Math.max(20, Math.min(360, o.spreadDeg))));

	const place = (node: TreeNode, depth: number, a0: number, a1: number) => {
		const a = (a0 + a1) / 2;
		const p = polar(depth * o.step, a);
		out.set(node.id, p);
		if (o.pinFiles && node.files.length) fanFiles(out, node, p, a, o.step);
		const total = node.children.reduce((s, c) => s + weightOf(c), 0);
		let cur = a0;
		for (const child of node.children) {
			const w = ((a1 - a0) * weightOf(child)) / total;
			place(child, depth + 1, cur, cur + w);
			cur += w;
		}
	};
	roots.forEach((r, i) => place(r, 1, sectors[i][0], sectors[i][1]));
	return out;
}

/** Game-style vertical tree: branches side by side, each growing upward. */
function layoutUp(roots: TreeNode[], o: LayoutOptions): Map<string, Point> {
	const out = new Map<string, Point>();
	const slot = o.step * 0.56;
	const rise = o.step * 1.1;
	let next = 0;
	const xs = new Map<string, number>();
	let maxDepth = 1;

	const assign = (node: TreeNode, depth: number): number => {
		maxDepth = Math.max(maxDepth, depth);
		let x: number;
		if (node.children.length === 0) {
			x = next;
			next += slot * (o.pinFiles && node.files.length > 4 ? 1.6 : 1);
		} else {
			const cx = node.children.map((c) => assign(c, depth + 1));
			x = (cx[0] + cx[cx.length - 1]) / 2;
		}
		xs.set(node.id, x);
		out.set(node.id, { x, y: -depth * rise });
		return x;
	};
	const sorted = [...roots].sort((a, b) => a.name.localeCompare(b.name));
	sorted.forEach((r, i) => {
		if (i > 0) next += slot * 0.8; // gap between branches
		assign(r, 1);
	});

	// Centre the whole tree around (0, 0).
	const cx = (Math.min(...xs.values()) + Math.max(...xs.values())) / 2;
	const cy = (-rise - maxDepth * rise) / 2;
	for (const [id, p] of out) out.set(id, { x: p.x - cx, y: p.y - cy });

	if (o.pinFiles) {
		const walk = (n: TreeNode) => {
			const p = out.get(n.id)!;
			if (n.files.length) fanFiles(out, n, p, -Math.PI / 2, o.step * 0.75);
			n.children.forEach(walk);
		};
		roots.forEach(walk);
	}
	return out;
}

export function layoutSkillTree(roots: TreeNode[], o: LayoutOptions): Map<string, Point> {
	if (roots.length === 0) return new Map();
	return o.style === "up" ? layoutUp(roots, o) : layoutRadial(roots, o);
}
