// Animated "rays" drawn along graph links: spark, beam, energy, electricity.
// Pure canvas drawing, no Obsidian dependency.
//
// Performance: no shadowBlur anywhere (it is the slowest thing canvas can do,
// especially on phones). Glow comes from a wide, faint stroke under a thin
// bright core, drawn with additive blending by the caller.

export type RayStyle = "spark" | "beam" | "energy" | "lightning";

/** 0 = low, 1 = medium, 2 = high detail. */
export type Quality = 0 | 1 | 2;

export const RAY_STYLES: Record<RayStyle, string> = {
	spark: "Искра",
	beam: "Луч",
	energy: "Энергия",
	lightning: "Электричество",
};

export interface Pt {
	x: number;
	y: number;
}

export interface RayParams {
	style: RayStyle;
	/** 0..1 — how far the ray's head has travelled from a to b. */
	head: number;
	/** 0..1 — overall opacity (fades out after arrival). */
	alpha: number;
	/** Seconds, for continuous motion. */
	t: number;
	/** Stable per-link number, so links don't move in lockstep. */
	seed: number;
	/** CSS rgba() builder for the effect colour. */
	color: (alpha: number) => string;
	/** Thickness multiplier (1 = default). */
	width: number;
	/** True when the ray is shown permanently rather than as a travelling pulse. */
	constant: boolean;
	/** Detail level (adaptive). Defaults to high. */
	quality?: Quality;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WHITE = (a: number) => `rgba(255,255,255,${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;

export function drawRay(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, p: RayParams) {
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

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: string) {
	ctx.fillStyle = style;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, width: number, style: string | CanvasGradient) {
	ctx.strokeStyle = style;
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.moveTo(ax, ay);
	ctx.lineTo(bx, by);
	ctx.stroke();
}

function drawSpark(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, p: RayParams) {
	// In constant mode the spark loops along the link forever.
	const k = p.constant ? (p.t * 0.55 + p.seed * 0.137) % 1 : p.head;
	const x = a.x + (b.x - a.x) * k;
	const y = a.y + (b.y - a.y) * k;
	dot(ctx, x, y, 6 * p.width, p.color(0.25 * p.alpha)); // halo
	dot(ctx, x, y, 2.6 * p.width, p.color(0.95 * p.alpha));
}

/** A laser beam: glowing line with a white-hot head and a fading tail. */
function drawBeam(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, p: RayParams) {
	let alpha = p.alpha;
	if (p.constant) alpha *= 0.55 + 0.45 * Math.sin(p.t * 3.2 + p.seed);
	const hk = p.head;
	const tk = p.constant ? 0 : Math.max(0, hk - 0.5);
	const hx = a.x + (b.x - a.x) * hk;
	const hy = a.y + (b.y - a.y) * hk;
	const tx = a.x + (b.x - a.x) * tk;
	const ty = a.y + (b.y - a.y) * tk;

	if ((p.quality ?? 2) === 2) line(ctx, tx, ty, hx, hy, 7 * p.width, p.color(0.12 * alpha)); // wide glow
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

/** A wavy plasma stream with bright blobs running along it. */
function drawEnergy(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, len: number, p: RayParams) {
	const q = p.quality ?? 2;
	const ux = (b.x - a.x) / len;
	const uy = (b.y - a.y) / len;
	const amp = 3.6 * p.width;
	const steps = Math.min(q === 2 ? 36 : q === 1 ? 24 : 14, Math.max(8, Math.round((len * p.head) / 9)));
	const wave = (s: number, shift: number) =>
		amp * Math.sin(Math.PI * Math.min(1, s)) * Math.sin((s * len) / 9 - p.t * 7 + p.seed + shift);

	const strand = (shift: number, width: number, style: string) => {
		ctx.strokeStyle = style;
		ctx.lineWidth = width;
		ctx.beginPath();
		for (let i = 0; i <= steps; i++) {
			const s = (i / steps) * p.head;
			const off = wave(s, shift);
			const x = a.x + ux * s * len - uy * off;
			const y = a.y + uy * s * len + ux * off;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	};

	strand(0, (q === 2 ? 6 : 4) * p.width, p.color(0.16 * p.alpha)); // glow
	strand(0, 1.6 * p.width, p.color(0.95 * p.alpha));
	if (q > 0) strand(Math.PI, 1.1 * p.width, p.color(0.6 * p.alpha));

	// Energy blobs
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

/** A flickering lightning bolt with side branches, re-rolled ~18 times a second. */
function drawLightning(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, len: number, p: RayParams) {
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

	const xs = new Array<number>(n + 1);
	const ys = new Array<number>(n + 1);
	for (let i = 0; i <= n; i++) {
		const s = i / n;
		const off = i === 0 || i === n ? 0 : (r() * 2 - 1) * jitter * Math.sin(Math.PI * s);
		xs[i] = a.x + ux * s * segLen - uy * off;
		ys[i] = a.y + uy * s * segLen + ux * off;
	}
	const alpha = p.alpha * (0.55 + r() * 0.45); // flicker

	const path = (px: number[], py: number[], width: number, style: string) => {
		ctx.strokeStyle = style;
		ctx.lineWidth = width;
		ctx.beginPath();
		ctx.moveTo(px[0], py[0]);
		for (let i = 1; i < px.length; i++) ctx.lineTo(px[i], py[i]);
		ctx.stroke();
	};

	if (q === 2) path(xs, ys, 6 * p.width, p.color(0.16 * alpha)); // glow
	path(xs, ys, 2.6 * p.width, p.color(0.45 * alpha));
	path(xs, ys, 1.1 * p.width, WHITE(0.95 * alpha));

	// Side branches
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
