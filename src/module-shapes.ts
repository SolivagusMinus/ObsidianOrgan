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
