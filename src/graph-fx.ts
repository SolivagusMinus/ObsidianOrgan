import { Platform, View } from "obsidian";
import type FolderHubPlugin from "./main";

// ---------------------------------------------------------------------------
// Visual effects drawn on a transparent canvas laid over the graph view:
// pulses from index notes, a wave that runs down each branch, link flow,
// level-up bursts. The graph itself is never modified; we only read node
// positions (undocumented renderer fields, all feature-checked).
// ---------------------------------------------------------------------------

interface FxNode {
	id: string;
	x: number;
	y: number;
	circle?: {
		getGlobalPosition?: () => { x: number; y: number };
		getBounds?: () => { width: number };
		visible?: boolean;
	} | null;
	getSize?: () => number;
}

interface FxLink {
	source: FxNode;
	target: FxNode;
}

interface FxRenderer {
	nodes?: FxNode[];
	links?: FxLink[];
	panX?: number;
	panY?: number;
	scale?: number;
	containerEl?: HTMLElement;
	px?: { screen?: { width: number } };
}

interface Layer {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
}

interface Burst {
	id: string;
	start: number;
}

const MAX_LINKS = 1500;
const TRAVEL = 0.9; // seconds for a wave to cross one link
const RING = 1.4; // seconds a ring lives

function rgba(hex: string, alpha: number): string {
	const h = hex.replace("#", "");
	const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
	const n = parseInt(full, 16);
	if (Number.isNaN(n)) return `rgba(229,165,10,${alpha})`;
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class GraphFx {
	private layers = new Map<FxRenderer, Layer>();
	private raf: number | null = null;
	private t0 = performance.now();
	private bursts: Burst[] = [];
	private frame = 0;

	constructor(private plugin: FolderHubPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	get active(): boolean {
		const s = this.plugin.settings;
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		const anything = s.fxRing || s.fxWave || s.fxGlow || s.linkFlow !== "off";
		return s.fxEnabled && s.animations && !reduced && anything;
	}

	start() {
		this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
		this.plugin.register(() => this.stop());
		this.sync();
	}

	stop() {
		if (this.raf !== null) window.cancelAnimationFrame(this.raf);
		this.raf = null;
		for (const l of this.layers.values()) l.canvas.remove();
		this.layers.clear();
	}

	/** Attaches/detaches overlay canvases to open graph views. */
	sync() {
		const alive = new Set<FxRenderer>();
		if (this.active) {
			const leaves = [
				...this.app.workspace.getLeavesOfType("graph"),
				...this.app.workspace.getLeavesOfType("localgraph"),
			];
			for (const leaf of leaves) {
				const r = (leaf.view as View & { renderer?: FxRenderer }).renderer;
				const host = r?.containerEl;
				if (!r || !host) continue;
				alive.add(r);
				if (!this.layers.has(r)) {
					if (getComputedStyle(host).position === "static") host.style.position = "relative";
					const canvas = host.createEl("canvas", { cls: "fh-graph-fx" });
					const ctx = canvas.getContext("2d");
					if (!ctx) {
						canvas.remove();
						continue;
					}
					this.layers.set(r, { canvas, ctx });
				}
			}
		}
		for (const [r, l] of [...this.layers]) {
			if (alive.has(r)) continue;
			l.canvas.remove();
			this.layers.delete(r);
		}
		if (this.layers.size && this.raf === null) this.raf = window.requestAnimationFrame(this.loop);
		if (!this.layers.size && this.raf !== null) {
			window.cancelAnimationFrame(this.raf);
			this.raf = null;
		}
	}

	/** Big celebratory pulse on one node (e.g. a branch levelled up). */
	burst(id: string) {
		this.bursts.push({ id, start: performance.now() });
	}

	private loop = (now: number) => {
		this.raf = window.requestAnimationFrame(this.loop);
		if (document.hidden) return;
		// Phones: ~30 fps is plenty and saves battery.
		if (Platform.isMobile && this.frame++ % 2) return;
		this.bursts = this.bursts.filter((b) => now - b.start < 2600);
		for (const [r, layer] of this.layers) {
			try {
				this.draw(r, layer, now);
			} catch (e) {
				console.warn("Folder Hub: graph effects failed, turning them off for this view", e);
				layer.canvas.remove();
				this.layers.delete(r);
			}
		}
	};

	private draw(r: FxRenderer, { canvas, ctx }: Layer, now: number) {
		const host = r.containerEl!;
		const w = host.clientWidth;
		const h = host.clientHeight;
		if (!w || !h) return;
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		const s = this.plugin.settings;
		const nodes = r.nodes ?? [];
		if (!nodes.length) return;
		const ratio = w / (r.px?.screen?.width || w);
		const scale = r.scale ?? 1;

		// Screen position of each node, computed once per frame.
		const cache = new Map<FxNode, { x: number; y: number }>();
		const pos = (n: FxNode) => {
			let p = cache.get(n);
			if (!p) {
				const g = n.circle?.getGlobalPosition?.();
				p = g
					? { x: g.x * ratio, y: g.y * ratio }
					: { x: (n.x * scale + (r.panX ?? 0)) * ratio, y: (n.y * scale + (r.panY ?? 0)) * ratio };
				cache.set(n, p);
			}
			return p;
		};
		const radius = (n: FxNode) => {
			try {
				const b = n.circle?.getBounds?.();
				if (b && b.width > 0) return (b.width / 2) * ratio;
			} catch {
				/* ignore */
			}
			return (n.getSize?.() ?? 6) * scale * ratio;
		};
		const onScreen = (p: { x: number; y: number }, pad = 120) =>
			p.x > -pad && p.y > -pad && p.x < w + pad && p.y < h + pad;

		const hubs = this.plugin.graphTree.hubDepths();
		const t = (now - this.t0) / 1000;
		const interval = Math.max(1, s.fxInterval);
		const phase = t % interval;
		const links = r.links ?? [];

		// ---- link flow (moving dashes, source → target)
		if (s.linkFlow !== "off" && links.length) {
			ctx.save();
			ctx.beginPath();
			let count = 0;
			for (const l of links) {
				if (count >= MAX_LINKS) break;
				if (s.linkFlow === "hubs" && !hubs.has(l.source.id)) continue;
				const a = pos(l.source);
				const b = pos(l.target);
				if (!onScreen(a, 0) && !onScreen(b, 0)) continue;
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				count++;
			}
			ctx.setLineDash([3, 9]);
			ctx.lineDashOffset = -((t * s.linkFlowSpeed) % 12);
			ctx.strokeStyle = rgba(s.linkFlowColor, 0.7);
			ctx.lineWidth = 1.4;
			ctx.lineCap = "round";
			ctx.stroke();
			ctx.restore();
		}

		const hubNodes = nodes.filter((n) => hubs.has(n.id));

		// ---- breathing glow
		if (s.fxGlow) {
			const a = 0.18 + 0.14 * Math.sin((t * Math.PI * 2) / 2.6);
			for (const n of hubNodes) {
				const p = pos(n);
				if (!onScreen(p)) continue;
				const rr = radius(n) * 2.8 + 6;
				const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
				g.addColorStop(0, rgba(s.fxColor, a));
				g.addColorStop(1, rgba(s.fxColor, 0));
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// Each hub fires when the wave reaches its depth: top-level first, then deeper.
		const emitAt = (id: string) => ((hubs.get(id) ?? 1) - 1) * (s.fxWave ? TRAVEL : 0);

		// ---- pulse rings
		if (s.fxRing) {
			for (const n of hubNodes) {
				const age = phase - emitAt(n.id);
				if (age < 0 || age > RING) continue;
				const p = pos(n);
				if (!onScreen(p)) continue;
				const k = age / RING;
				const base = radius(n);
				ctx.beginPath();
				ctx.arc(p.x, p.y, base + 4 + k * (28 + base * 1.5), 0, Math.PI * 2);
				ctx.strokeStyle = rgba(s.fxColor, (1 - k) * 0.85);
				ctx.lineWidth = 2.5 * (1 - k) + 0.6;
				ctx.stroke();
			}
		}

		// ---- wave: a glowing spark runs from each hub along its links
		if (s.fxWave && links.length) {
			ctx.save();
			ctx.shadowColor = rgba(s.fxColor, 0.9);
			ctx.shadowBlur = 10;
			ctx.fillStyle = rgba(s.fxColor, 0.95);
			for (const l of links) {
				if (!hubs.has(l.source.id)) continue;
				const age = phase - emitAt(l.source.id);
				if (age < 0 || age > TRAVEL) continue;
				const a = pos(l.source);
				const b = pos(l.target);
				if (!onScreen(a) && !onScreen(b)) continue;
				const k = easeInOut(age / TRAVEL);
				ctx.beginPath();
				ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 2.6, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();
		}

		// ---- level-up bursts: three big rings
		for (const b of this.bursts) {
			const n = nodes.find((x) => x.id === b.id);
			if (!n) continue;
			const p = pos(n);
			const base = radius(n);
			for (let i = 0; i < 3; i++) {
				const age = (now - b.start) / 1000 - i * 0.35;
				if (age < 0 || age > 1.6) continue;
				const k = age / 1.6;
				ctx.beginPath();
				ctx.arc(p.x, p.y, base + 6 + k * 110, 0, Math.PI * 2);
				ctx.strokeStyle = rgba(s.fxColor, (1 - k) * 0.95);
				ctx.lineWidth = 4 * (1 - k) + 1;
				ctx.stroke();
			}
		}
	}
}
