// Animated "rays" drawn along graph links: spark, beam, energy, electricity.
// Pure canvas drawing, no Obsidian dependency.

export type RayStyle = "spark" | "beam" | "energy" | "lightning";

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

const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const WHITE = (a: number) => `rgba(255,255,255,${a})`;

export function drawRay(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, p: RayParams) {
	const len = Math.hypot(b.x - a.x, b.y - a.y);
	if (len < 2 || p.alpha <= 0.01 || p.head <= 0) return;
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	switch (p.style) {
		case "beam":
			drawBeam(ctx, a, b, len, p);
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
	ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, p: RayParams) {
	// In constant mode the spark loops along the link forever.
	const k = p.constant ? (p.t * 0.55 + p.seed * 0.137) % 1 : p.head;
	const h = lerp(a, b, k);
	ctx.shadowColor = p.color(0.9 * p.alpha);
	ctx.shadowBlur = 10;
	ctx.fillStyle = p.color(0.95 * p.alpha);
	ctx.beginPath();
	ctx.arc(h.x, h.y, 2.6 * p.width, 0, Math.PI * 2);
	ctx.fill();
}

/** A laser beam: glowing line with a white-hot head and a fading tail. */
function drawBeam(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, _len: number, p: RayParams) {
	let alpha = p.alpha;
	if (p.constant) alpha *= 0.55 + 0.45 * Math.sin(p.t * 3.2 + p.seed);
	const head = lerp(a, b, p.head);
	const tail = p.constant ? a : lerp(a, b, Math.max(0, p.head - 0.5));

	// Outer glow
	ctx.shadowColor = p.color(alpha);
	ctx.shadowBlur = 14;
	ctx.strokeStyle = p.color(0.22 * alpha);
	ctx.lineWidth = 6 * p.width;
	ctx.beginPath();
	ctx.moveTo(tail.x, tail.y);
	ctx.lineTo(head.x, head.y);
	ctx.stroke();

	// Core: transparent tail → colour → white head
	const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
	g.addColorStop(0, p.color(p.constant ? 0.5 * alpha : 0));
	g.addColorStop(0.7, p.color(0.9 * alpha));
	g.addColorStop(1, WHITE(alpha));
	ctx.shadowBlur = 6;
	ctx.strokeStyle = g;
	ctx.lineWidth = 1.8 * p.width;
	ctx.beginPath();
	ctx.moveTo(tail.x, tail.y);
	ctx.lineTo(head.x, head.y);
	ctx.stroke();

	if (!p.constant && p.head < 1) {
		ctx.fillStyle = WHITE(alpha);
		ctx.shadowBlur = 12;
		ctx.beginPath();
		ctx.arc(head.x, head.y, 2.4 * p.width, 0, Math.PI * 2);
		ctx.fill();
	}
}

/** A wavy plasma stream with bright blobs running along it. */
function drawEnergy(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, len: number, p: RayParams) {
	const ux = (b.x - a.x) / len;
	const uy = (b.y - a.y) / len;
	const nx = -uy;
	const ny = ux;
	const amp = 3.6 * p.width;
	const steps = Math.max(10, Math.round((len * p.head) / 5));
	const at = (s: number, phaseShift: number): Pt => {
		const taper = Math.sin(Math.PI * Math.min(1, s)); // calm at both ends
		const off = amp * taper * Math.sin((s * len) / 9 - p.t * 7 + p.seed + phaseShift);
		return { x: a.x + ux * s * len + nx * off, y: a.y + uy * s * len + ny * off };
	};

	// Two intertwined strands
	for (const [shift, width, alpha] of [
		[0, 4.5, 0.22],
		[0, 1.6, 0.95],
		[Math.PI, 1.1, 0.6],
	] as const) {
		ctx.shadowColor = p.color(p.alpha);
		ctx.shadowBlur = width > 2 ? 16 : 8;
		ctx.strokeStyle = p.color(alpha * p.alpha);
		ctx.lineWidth = width * p.width;
		ctx.beginPath();
		for (let i = 0; i <= steps; i++) {
			const pt = at((i / steps) * p.head, shift);
			if (i === 0) ctx.moveTo(pt.x, pt.y);
			else ctx.lineTo(pt.x, pt.y);
		}
		ctx.stroke();
	}

	// Energy blobs
	ctx.shadowBlur = 12;
	for (let j = 0; j < 3; j++) {
		const s = (p.t * 0.7 + j / 3 + p.seed * 0.171) % 1;
		if (s > p.head) continue;
		const pt = at(s, 0);
		ctx.fillStyle = WHITE(0.9 * p.alpha);
		ctx.beginPath();
		ctx.arc(pt.x, pt.y, 2.2 * p.width, 0, Math.PI * 2);
		ctx.fill();
	}
}

/** A flickering lightning bolt with side branches, re-rolled ~18 times a second. */
function drawLightning(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, len: number, p: RayParams) {
	const r = rng(Math.floor(p.t * 18) * 9973 + p.seed * 7919);
	const end = lerp(a, b, p.head);
	const segLen = Math.hypot(end.x - a.x, end.y - a.y);
	if (segLen < 2) return;
	const ux = (end.x - a.x) / segLen;
	const uy = (end.y - a.y) / segLen;
	const nx = -uy;
	const ny = ux;
	const n = Math.max(4, Math.round(segLen / 13));
	const jitter = Math.min(14, len * 0.08) * (0.7 + 0.3 * p.width);

	const pts: Pt[] = [];
	for (let i = 0; i <= n; i++) {
		const s = i / n;
		const off = i === 0 || i === n ? 0 : (r() * 2 - 1) * jitter * Math.sin(Math.PI * s);
		pts.push({ x: a.x + ux * s * segLen + nx * off, y: a.y + uy * s * segLen + ny * off });
	}
	const alpha = p.alpha * (0.55 + r() * 0.45); // flicker

	const stroke = (path: Pt[], width: number, style: string, blur: number) => {
		ctx.shadowColor = p.color(alpha);
		ctx.shadowBlur = blur;
		ctx.strokeStyle = style;
		ctx.lineWidth = width;
		ctx.beginPath();
		path.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
		ctx.stroke();
	};

	stroke(pts, 4.5 * p.width, p.color(0.35 * alpha), 18);
	stroke(pts, 1.3 * p.width, WHITE(0.95 * alpha), 6);

	// Side branches
	for (let i = 1; i < pts.length - 1; i++) {
		if (r() > 0.2) continue;
		const dir = Math.atan2(uy, ux) + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6);
		const branch: Pt[] = [pts[i]];
		let cur = pts[i];
		const parts = 2 + Math.floor(r() * 2);
		for (let k = 0; k < parts; k++) {
			const l = 6 + r() * 10;
			const d = dir + (r() * 2 - 1) * 0.5;
			cur = { x: cur.x + Math.cos(d) * l, y: cur.y + Math.sin(d) * l };
			branch.push(cur);
		}
		stroke(branch, 2.4 * p.width, p.color(0.3 * alpha), 10);
		stroke(branch, 0.8 * p.width, WHITE(0.8 * alpha), 4);
	}
}
