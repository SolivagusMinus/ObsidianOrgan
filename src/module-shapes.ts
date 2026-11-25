// Geometry and drawing of graph "modules" (barriers around groups of notes).
// Pure, no Obsidian dependency.

export type LineStyle = "zigzag" | "solid" | "dashed" | "dotted" | "wave" | "double" | "electric";
export type ModuleShape = "cloud" | "circle";

export const LINE_STYLES: Record<LineStyle, string> = {
	zigzag: "Зигзаг",
	solid: "Сплошная",
	dashed: "Пунктир",
	dotted: "Точки",
	wave: "Волна",
	double: "Двойная",
	electric: "Электрическая",
};

export interface Pt {
	x: number;
	y: number;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, no duplicate end point. */
export function convexHull(input: Pt[]): Pt[] {
	const pts = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
	if (pts.length < 3) return pts;
	const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Pt[] = [];
	for (const p of pts) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper: Pt[] = [];
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
		upper.push(p);
	}
	upper.pop();
	lower.pop();
	return lower.concat(upper);
}

export function centroid(pts: Pt[]): Pt {
	let x = 0;
	let y = 0;
	for (const p of pts) {
		x += p.x;
		y += p.y;
	}
	return pts.length ? { x: x / pts.length, y: y / pts.length } : { x: 0, y: 0 };
}

/** Boundary radius (world units) for a module with `n` notes: grows with √n. */
export function moduleRadius(n: number, size = 1): number {
	return (110 + 42 * Math.sqrt(Math.max(1, n))) * size;
}

/**
 * Outline around member points: the hull of every point inflated by `pad`
 * (Minkowski sum with a circle), always at least a circle of `minRadius`
 * around the centre. For "circle" the outline is a circle that encloses all.
 */
export function moduleOutline(points: Pt[], shape: ModuleShape, pad: number, minRadius: number): Pt[] {
	if (!points.length) return [];
	const c = centroid(points);
	if (shape === "circle") {
		let r = minRadius;
		for (const p of points) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y) + pad);
		return circlePoints(c, r, 48);
	}
	const cloud: Pt[] = [];
	const K = 10;
	for (const p of points) {
		for (let k = 0; k < K; k++) {
			const a = (k / K) * Math.PI * 2;
			cloud.push({ x: p.x + Math.cos(a) * pad, y: p.y + Math.sin(a) * pad });
		}
	}
	for (const p of circlePoints(c, minRadius, 16)) cloud.push(p);
	return convexHull(cloud);
}

export function circlePoints(c: Pt, r: number, n: number): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
	}
	return out;
}

/** Closed Catmull-Rom spline through the points: a soft, organic outline. */
export function smoothClosed(pts: Pt[], perSegment = 6): Pt[] {
	const n = pts.length;
	if (n < 3) return pts;
	const out: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n];
		const p1 = pts[i];
		const p2 = pts[(i + 1) % n];
		const p3 = pts[(i + 2) % n];
		for (let s = 0; s < perSegment; s++) {
			const t = s / perSegment;
			const t2 = t * t;
			const t3 = t2 * t;
			out.push({
				x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
				y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
			});
		}
	}
	return out;
}

/** Evenly spaced points along a closed polyline, starting `offset` along it. */
export function resampleClosed(pts: Pt[], spacing: number, offset = 0, maxPoints = 1200): Pt[] {
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
	const out: Pt[] = [];
	let seg = 0;
	let segStart = 0;
	let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
	for (let k = 0; k < count; k++) {
		const d = (((offset % perimeter) + perimeter) % perimeter + k * (perimeter / count)) % perimeter;
		// Restart the walk when we wrapped around.
		if (d < segStart) {
			seg = 0;
			segStart = 0;
			segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
		}
		while (d > segStart + segLen && seg < n - 1) {
			segStart += segLen;
			seg++;
			const a = pts[seg];
			const b = pts[(seg + 1) % n];
			segLen = Math.hypot(b.x - a.x, b.y - a.y);
		}
		const a = pts[seg];
		const b = pts[(seg + 1) % n];
		const k2 = segLen > 0 ? (d - segStart) / segLen : 0;
		out.push({ x: a.x + (b.x - a.x) * k2, y: a.y + (b.y - a.y) * k2 });
	}
	return out;
}

/** Outward unit normals of a closed, counter-clockwise (in y-down screen space: clockwise) polyline. */
function normals(pts: Pt[]): Pt[] {
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
		// Make sure it points away from the centre.
		if (nx * (p.x - c.x) + ny * (p.y - c.y) < 0) {
			nx = -nx;
			ny = -ny;
		}
		return { x: nx, y: ny };
	});
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[]) {
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
	ctx.closePath();
}

export interface BoundaryStyle {
	style: LineStyle;
	/** rgba() builder for the module colour. */
	color: (a: number) => string;
	/** Seconds, for animation. */
	t: number;
	animate: boolean;
	width: number;
	/** Stable per-module number for the electric flicker. */
	seed: number;
}

/** Strokes the boundary `outline` (a smooth closed polyline in screen space). */
export function drawBoundary(ctx: CanvasRenderingContext2D, outline: Pt[], b: BoundaryStyle) {
	if (outline.length < 3) return;
	const t = b.animate ? b.t : 0;
	const w = b.width;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	switch (b.style) {
		case "zigzag": {
			const half = 6 * w; // half a tooth
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
				const o = amp * Math.sin((dist / lambda) * Math.PI * 2 - t * 3);
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
			let s = (Math.floor(t * 12) * 9973 + b.seed * 7919) >>> 0;
			const rnd = () => {
				s = (s * 1664525 + 1013904223) >>> 0;
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

/** Translucent fill inside the outline. */
export function fillOutline(ctx: CanvasRenderingContext2D, outline: Pt[], style: string) {
	if (outline.length < 3) return;
	ctx.fillStyle = style;
	tracePath(ctx, outline);
	ctx.fill();
}

/**
 * Distance from `c` to a convex polygon along N evenly spaced directions
 * (starting straight up, clockwise on screen). Lets an outline be stored as
 * N radii, so consecutive frames can be blended smoothly.
 */
export function polarRadii(poly: Pt[], c: Pt, n: number): Float32Array {
	const out = new Float32Array(n);
	const m = poly.length;
	for (let i = 0; i < n; i++) {
		const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
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

/** Springy overshoot easing for the "bubble" entrance (0 → 1). */
export function elasticOut(x: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

export interface Circle {
	x: number;
	y: number;
	r: number;
}

/**
 * Pushes circles apart until none overlap (they may touch, `gap` apart).
 * Small circles move more than big ones; the group's centre of mass stays
 * where it was, so the graph doesn't drift. Mutates and returns `circles`.
 */
export function separateCircles(circles: Circle[], gap: number, iterations = 300): Circle[] {
	const n = circles.length;
	if (n < 2) return circles;
	const area = (c: Circle) => c.r * c.r + 1;
	const total = circles.reduce((s, c) => s + area(c), 0);
	const cx0 = circles.reduce((s, c) => s + c.x * area(c), 0) / total;
	const cy0 = circles.reduce((s, c) => s + c.y * area(c), 0) / total;
	for (let it = 0; it < iterations; it++) {
		let moved = false;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const a = circles[i];
				const b = circles[j];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let d = Math.hypot(dx, dy);
				const need = a.r + b.r + gap;
				if (d >= need - 0.01) continue;
				if (d < 1e-6) {
					// Same centre: split along a fixed direction per pair.
					const ang = ((i * 7 + j * 13) % 16) * (Math.PI / 8);
					dx = Math.cos(ang);
					dy = Math.sin(ang);
					d = 1;
				}
				const push = need - d;
				const wa = area(b) / (area(a) + area(b)); // the bigger the other, the more I move
				const wb = 1 - wa;
				a.x -= (dx / d) * push * wa;
				a.y -= (dy / d) * push * wa;
				b.x += (dx / d) * push * wb;
				b.y += (dy / d) * push * wb;
				moved = true;
			}
		}
		if (!moved) break;
	}
	// Keep the centre of mass in place.
	const cx1 = circles.reduce((s, c) => s + c.x * area(c), 0) / total;
	const cy1 = circles.reduce((s, c) => s + c.y * area(c), 0) / total;
	for (const c of circles) {
		c.x += cx0 - cx1;
		c.y += cy0 - cy1;
	}
	return circles;
}

/**
 * "Slime" contact: limits one ray of a barrier (centre c, overall radius R,
 * ray angle a, ray length r) so it stops at the radical line it shares with
 * each overlapping neighbour. Two barriers that meet then press into a flat
 * common edge instead of overlapping; the bigger one gets more of the space.
 */
export function slimeClamp(c: Pt, R: number, a: number, r: number, neighbours: { x: number; y: number; R: number }[], gap: number): number {
	const ux = Math.cos(a);
	const uy = Math.sin(a);
	let out = r;
	for (const n of neighbours) {
		const dx = n.x - c.x;
		const dy = n.y - c.y;
		const d2 = dx * dx + dy * dy;
		const sum = R + n.R;
		if (d2 >= sum * sum) continue; // not touching
		const ud = ux * dx + uy * dy;
		if (ud <= 1e-9) continue; // ray points away from this neighbour
		const t = (d2 + R * R - n.R * n.R) / (2 * ud) - gap / 2;
		if (t < out) out = Math.max(0, t);
	}
	return out;
}
