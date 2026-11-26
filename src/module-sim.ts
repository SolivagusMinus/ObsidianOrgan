// "Bubbles": a small physics of its own for graph modules. Pure, no Obsidian.
//
// Each module is a bubble of a fixed size (from its note count). Bubbles
// collide and push each other apart (never overlap, never shrink) and are
// gently pulled back to their home place. A module's notes float inside its
// bubble: they repel each other, drift a little, and bounce off its wall.

export interface SimNote {
	id: string;
	/** Position relative to the bubble centre. */
	rx: number;
	ry: number;
	vx: number;
	vy: number;
	/** Per-note phase for the floating drift. */
	seed: number;
}

export interface Bubble {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Radius (graph units). */
	R: number;
	/** Where the bubble likes to be (set by a sort). */
	homeX: number;
	homeY: number;
	notes: SimNote[];
	/** Links between notes of this bubble (index pairs): springs that keep its structure. */
	links?: [number, number][];
}

export interface SimOptions {
	/** Typical link length of the graph (graph units). */
	unit: number;
	/** Gap between touching bubbles (graph units). */
	gap: number;
	/** 0..1 — how much notes drift around inside their bubble. */
	float: number;
	/** Seconds since start (drives the drift). */
	t: number;
}

/** Bubble size from its note count: grows with √n, never with how notes are spread. */
export function bubbleRadius(count: number, unit: number, size = 1): number {
	return unit * (1.5 + 0.6 * Math.sqrt(Math.max(1, count))) * size;
}

/** A tidy starting spot inside the bubble for note i of n (sunflower spiral). */
export function spiralSpot(i: number, n: number, R: number): { x: number; y: number } {
	const golden = Math.PI * (3 - Math.sqrt(5));
	const r = R * 0.8 * Math.sqrt((i + 0.5) / Math.max(1, n));
	return { x: Math.cos(i * golden) * r, y: Math.sin(i * golden) * r };
}

/**
 * Advances the bubbles by dt seconds (clamped). Returns the largest distance
 * any note moved, so the caller can tell when everything has come to rest.
 */
export function stepBubbles(bubbles: Bubble[], dt: number, o: SimOptions): number {
	const h = Math.min(0.05, Math.max(0.001, dt));
	let maxMove = 0;

	// ---- bubbles: spring home, damping, then hard collisions
	for (const b of bubbles) {
		const k = 1.2; // 1/s² — gentle pull home
		b.vx += (b.homeX - b.x) * k * h;
		b.vy += (b.homeY - b.y) * k * h;
		const damp = Math.exp(-3 * h);
		b.vx *= damp;
		b.vy *= damp;
		b.x += b.vx * h;
		b.y += b.vy * h;
	}
	for (let it = 0; it < 4; it++) {
		for (let i = 0; i < bubbles.length; i++) {
			for (let j = i + 1; j < bubbles.length; j++) {
				const a = bubbles[i];
				const b = bubbles[j];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let d = Math.hypot(dx, dy);
				const need = a.R + b.R + o.gap;
				if (d >= need) continue;
				if (d < 1e-6) {
					dx = 1;
					dy = 0;
					d = 1;
				}
				const push = need - d;
				const wa = (b.R * b.R) / (a.R * a.R + b.R * b.R); // small bubbles move more
				const nx = dx / d;
				const ny = dy / d;
				a.x -= nx * push * wa;
				a.y -= ny * push * wa;
				b.x += nx * push * (1 - wa);
				b.y += ny * push * (1 - wa);
				// Bounce: drop the approaching part of their velocities.
				const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
				if (rel < 0) {
					a.vx += nx * rel * wa;
					a.vy += ny * rel * wa;
					b.vx -= nx * rel * (1 - wa);
					b.vy -= ny * rel * (1 - wa);
				}
			}
		}
	}

	// ---- notes inside each bubble
	const u = o.unit;
	for (const b of bubbles) {
		const n = b.notes.length;
		const wall = Math.max(u * 0.3, b.R - u * 0.35);
		// Personal space grows when the bubble has room, so notes fill it.
		const minGap = Math.max(u * 0.75, (b.R * 1.5) / Math.sqrt(Math.max(1, n)));
		// Links inside the module pull their notes together (keeps sub-branches).
		for (const [i, j] of b.links ?? []) {
			const p = b.notes[i];
			const q = b.notes[j];
			if (!p || !q) continue;
			const dx = q.rx - p.rx;
			const dy = q.ry - p.ry;
			const d = Math.hypot(dx, dy) || 1e-3;
			const f = (d - u * 0.9) * 1.5;
			p.vx += (dx / d) * f * h;
			p.vy += (dy / d) * f * h;
			q.vx -= (dx / d) * f * h;
			q.vy -= (dy / d) * f * h;
		}
		// Repulsion between close notes (a uniform grid keeps it near-linear).
		const cell = minGap;
		const grid = new Map<string, number[]>();
		b.notes.forEach((p, i) => {
			const key = `${Math.floor(p.rx / cell)},${Math.floor(p.ry / cell)}`;
			const list = grid.get(key);
			if (list) list.push(i);
			else grid.set(key, [i]);
		});
		for (let i = 0; i < n; i++) {
			const p = b.notes[i];
			const gx = Math.floor(p.rx / cell);
			const gy = Math.floor(p.ry / cell);
			for (let ox = -1; ox <= 1; ox++) {
				for (let oy = -1; oy <= 1; oy++) {
					const list = grid.get(`${gx + ox},${gy + oy}`);
					if (!list) continue;
					for (const j of list) {
						if (j <= i) continue;
						const q = b.notes[j];
						let dx = q.rx - p.rx;
						let dy = q.ry - p.ry;
						let d = Math.hypot(dx, dy);
						if (d >= minGap) continue;
						if (d < 1e-6) {
							dx = Math.cos(i + j);
							dy = Math.sin(i + j);
							d = 1e-3;
						}
						const f = ((minGap - d) / minGap) * u * 6;
						p.vx -= (dx / d) * f * h;
						p.vy -= (dy / d) * f * h;
						q.vx += (dx / d) * f * h;
						q.vy += (dy / d) * f * h;
					}
				}
			}
		}
		for (const p of b.notes) {
			// A faint pull to the middle (the wall does the holding) + slow drift.
			p.vx += -p.rx * 0.08 * h;
			p.vy += -p.ry * 0.08 * h;
			if (o.float > 0) {
				const s = p.seed;
				p.vx += Math.sin(o.t * 0.7 + s) * u * 0.9 * o.float * h;
				p.vy += Math.cos(o.t * 0.6 + s * 1.3) * u * 0.9 * o.float * h;
			}
			const damp = Math.exp(-2.5 * h);
			p.vx *= damp;
			p.vy *= damp;
			const ox = p.rx;
			const oy = p.ry;
			p.rx += p.vx * h;
			p.ry += p.vy * h;
			// The wall: notes bounce back inside, they never leave.
			const d = Math.hypot(p.rx, p.ry);
			if (d > wall) {
				const nx = p.rx / d;
				const ny = p.ry / d;
				p.rx = nx * wall;
				p.ry = ny * wall;
				const vr = p.vx * nx + p.vy * ny;
				if (vr > 0) {
					p.vx -= 1.6 * vr * nx;
					p.vy -= 1.6 * vr * ny;
				}
			}
			maxMove = Math.max(maxMove, Math.hypot(p.rx - ox, p.ry - oy));
		}
	}
	return maxMove;
}
