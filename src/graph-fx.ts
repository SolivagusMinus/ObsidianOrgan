import { Platform, View } from "obsidian";
import type FolderHubPlugin from "./main";
import { Quality, drawRay } from "./rays";
import { Pt, drawBoundary, fillOutline, moduleOutline, smoothClosed } from "./module-shapes";
import type { ModuleDef } from "./modules";

// ---------------------------------------------------------------------------
// Visual effects drawn on a transparent canvas laid over the graph view:
// pulses from index notes, rays down each branch, link flow, level-up bursts.
// The graph itself is never modified; we only read node positions
// (undocumented renderer fields, all feature-checked).
//
// Performance notes (the loop runs every frame, 60 fps):
//  - no PIXI calls per node: one calibration per frame maps world → screen,
//    then positions are plain arithmetic;
//  - hub/link lists are cached and rebuilt only when the graph data changes;
//  - no canvas shadowBlur (very slow); glow is additive blending + a cached sprite;
//  - frames with nothing to draw are skipped entirely;
//  - adaptive quality: if a frame takes too long, resolution and detail drop.
// ---------------------------------------------------------------------------

interface WorldTransform {
	tx: number;
	ty: number;
}

interface FxNode {
	id: string;
	x: number;
	y: number;
	circle?: { worldTransform?: WorldTransform } | null;
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

/** Per-graph cached lists, rebuilt only when the graph data changes. */
interface Lists {
	nodesRef: FxNode[] | undefined;
	linksRef: FxLink[] | undefined;
	nodeCount: number;
	linkCount: number;
	hubsRef: Map<string, number>;
	hubNodes: FxNode[];
	/** depth of each entry in hubNodes */
	hubDepth: number[];
	hubLinks: FxLink[];
	hubLinkDepth: number[];
	byId: Map<string, FxNode>;
}

/** A module's member nodes in one graph, with its outline in graph (world) units. */
interface ModEntry {
	def: ModuleDef;
	nodes: FxNode[];
	outline: Pt[];
	colorFn: (a: number) => string;
	fill: string;
}

interface ModCache {
	version: number;
	defsRef: ModuleDef[];
	defsKey: string;
	listsRef: Lists;
	entries: ModEntry[];
	/** Frames since outlines were recomputed. */
	age: number;
}

interface Layer {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	lists: Lists | null;
	mods: ModCache | null;
	/** Whether the canvas currently has something drawn on it. */
	dirty: boolean;
}

interface Burst {
	id: string;
	start: number;
}

const TRAVEL = 0.9; // seconds for a pulse to cross one link
const LINGER = 0.35; // seconds a ray stays visible after arriving
const RING = 1.4; // seconds a ring lives

/** Limits per quality level: [low, medium, high]. */
const MAX_RAYS = [60, 180, 400];
const MAX_FLOW = [250, 700, 1500];
/** Canvas resolution cap. Effects are soft glows, so a lower resolution is barely visible but much cheaper. */
const DPR_CAP = [0.75, 1, 1.5];

function parseHex(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
	const n = parseInt(full, 16);
	if (Number.isNaN(n)) return [229, 165, 10];
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class GraphFx {
	private layers = new Map<FxRenderer, Layer>();
	private raf: number | null = null;
	private t0 = performance.now();
	private bursts: Burst[] = [];

	// Adaptive quality
	// Phones start at medium detail; desktops at high. Adjusted every 1.5 s.
	private quality: Quality = Platform.isMobile ? 1 : 2;
	private costEma = 0;
	private lastQualityChange = 0;

	// FPS meter
	private lastFrame = 0;
	private fpsEma = 60;

	// Colour caches
	private colorKey = "";
	private colorFn: (a: number) => string = () => "";
	private flowStyle = "";
	private glowSprite: HTMLCanvasElement | null = null;

	constructor(private plugin: FolderHubPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	/** Pulses, rays, flow and glow (animations). */
	private get effectsOn(): boolean {
		const s = this.plugin.settings;
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		const anything = s.fxRing || s.fxWave || s.fxGlow || s.linkFlow !== "off" || s.fxShowFps;
		return s.fxEnabled && s.animations && !reduced && anything;
	}

	/** Module barriers are structure, not decoration: shown even with animations off. */
	private get modulesOn(): boolean {
		const s = this.plugin.settings;
		return s.modulesEnabled && s.modules.length > 0;
	}

	get active(): boolean {
		return this.effectsOn || this.modulesOn;
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
					this.layers.set(r, { canvas, ctx, lists: null, mods: null, dirty: false });
				}
			}
		}
		for (const [r, l] of [...this.layers]) {
			if (alive.has(r)) continue;
			l.canvas.remove();
			this.layers.delete(r);
		}
		// Settings may have changed: drop caches.
		this.colorKey = "";
		for (const l of this.layers.values()) {
			l.lists = null;
			l.mods = null;
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
		if (this.lastFrame) {
			const dt = now - this.lastFrame;
			if (dt > 0 && dt < 1000) this.fpsEma = this.fpsEma * 0.92 + (1000 / dt) * 0.08;
		}
		this.lastFrame = now;
		if (document.hidden) return;
		if (this.bursts.length) this.bursts = this.bursts.filter((b) => now - b.start < 2600);

		const start = performance.now();
		for (const [r, layer] of this.layers) {
			try {
				this.draw(r, layer, now);
			} catch (e) {
				console.warn("ObsOrg: graph effects failed, turning them off for this view", e);
				layer.canvas.remove();
				this.layers.delete(r);
			}
		}
		this.adapt(performance.now() - start, now);
	};

	/**
	 * Lowers detail when frames get expensive or the frame rate drops below
	 * ~50 fps (the GPU can be the bottleneck even when our code is fast),
	 * raises it again when there's clear headroom.
	 */
	private adapt(cost: number, now: number) {
		this.costEma = this.costEma * 0.9 + cost * 0.1;
		if (now - this.lastQualityChange < 1500) return;
		if ((this.costEma > 6 || this.fpsEma < 50) && this.quality > 0) {
			this.quality = (this.quality - 1) as Quality;
			this.lastQualityChange = now;
		} else if (this.costEma < 2 && this.fpsEma > 57 && this.quality < 2) {
			this.quality = (this.quality + 1) as Quality;
			this.lastQualityChange = now;
		}
	}

	private colors() {
		const s = this.plugin.settings;
		const key = `${s.fxColor}|${s.linkFlowColor}`;
		if (key !== this.colorKey) {
			this.colorKey = key;
			const [r, g, b] = parseHex(s.fxColor);
			this.colorFn = (a: number) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;
			const [fr, fg, fb] = parseHex(s.linkFlowColor);
			this.flowStyle = `rgba(${fr},${fg},${fb},0.7)`;
			// Soft glow sprite, drawn once and stamped with drawImage.
			const sprite = document.createElement("canvas");
			sprite.width = sprite.height = 64;
			const sc = sprite.getContext("2d");
			if (sc) {
				const grad = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
				grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
				grad.addColorStop(0.4, `rgba(${r},${g},${b},0.45)`);
				grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
				sc.fillStyle = grad;
				sc.fillRect(0, 0, 64, 64);
			}
			this.glowSprite = sprite;
		}
		return this.colorFn;
	}

	private lists(layer: Layer, r: FxRenderer): Lists {
		const hubs = this.plugin.graphTree.hubDepths();
		const nodes = r.nodes;
		const links = r.links;
		const l = layer.lists;
		if (
			l &&
			l.nodesRef === nodes &&
			l.linksRef === links &&
			l.nodeCount === (nodes?.length ?? 0) &&
			l.linkCount === (links?.length ?? 0) &&
			l.hubsRef === hubs
		) {
			return l;
		}
		const byId = new Map<string, FxNode>();
		const hubNodes: FxNode[] = [];
		const hubDepth: number[] = [];
		for (const n of nodes ?? []) {
			byId.set(n.id, n);
			const d = hubs.get(n.id);
			if (d !== undefined) {
				hubNodes.push(n);
				hubDepth.push(d);
			}
		}
		const hubLinks: FxLink[] = [];
		const hubLinkDepth: number[] = [];
		for (const link of links ?? []) {
			const d = hubs.get(link.source.id);
			if (d !== undefined) {
				hubLinks.push(link);
				hubLinkDepth.push(d);
			}
		}
		layer.lists = {
			nodesRef: nodes,
			linksRef: links,
			nodeCount: nodes?.length ?? 0,
			linkCount: links?.length ?? 0,
			hubsRef: hubs,
			hubNodes,
			hubDepth,
			hubLinks,
			hubLinkDepth,
			byId,
		};
		return layer.lists;
	}

	private rgbaFn(hex: string): (a: number) => string {
		const h = hex.replace("#", "");
		const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
		const n = parseInt(full, 16);
		const [r, g, b] = Number.isNaN(n) ? [57, 135, 229] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		return (a: number) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;
	}

	/** Module members present in this graph (rebuilt when graph data or modules change). */
	private modEntries(layer: Layer, lists: Lists): ModCache {
		const modules = this.plugin.modules;
		const defs = this.plugin.settings.modules;
		const key = defs.map((d) => `${d.id}|${d.color}|${d.line}|${d.kind}|${d.value}`).join(";");
		const c = layer.mods;
		if (c && c.version === modules.version && c.defsRef === defs && c.defsKey === key && c.listsRef === lists) return c;
		const members = modules.members();
		const entries: ModEntry[] = [];
		for (const def of defs) {
			const set = members.get(def.id);
			if (!set?.size) continue;
			const nodes: FxNode[] = [];
			for (const [id, n] of lists.byId) if (set.has(id)) nodes.push(n);
			if (!nodes.length) continue;
			const colorFn = this.rgbaFn(def.color);
			entries.push({ def, nodes, outline: [], colorFn, fill: colorFn(0.07) });
		}
		layer.mods = { version: modules.version, defsRef: defs, defsKey: key, listsRef: lists, entries, age: 1e9 };
		return layer.mods;
	}

	/** Outlines in graph units; nodes move slowly, so every few frames is enough. */
	private updateOutlines(mods: ModCache) {
		if (mods.age++ < 5) return;
		mods.age = 0;
		const s = this.plugin.settings;
		for (const e of mods.entries) {
			const pts = e.nodes.map((n) => ({ x: n.x, y: n.y }));
			const R = this.plugin.modules.radius(e.def.id, pts.length);
			const pad = 38 * s.moduleSize;
			e.outline = moduleOutline(pts, s.moduleShape, pad, s.moduleShape === "circle" ? R : R * 0.55);
		}
	}

	/**
	 * World → screen mapping for this frame: screen = world · S + offset.
	 * Calibrated from the node sprites' world transforms (read-only, no PIXI
	 * calls), checked against a second node; falls back to pan/scale.
	 */
	private mapping(r: FxRenderer, nodes: FxNode[], ratio: number) {
		let S = r.scale ?? 1;
		let ox = r.panX ?? 0;
		let oy = r.panY ?? 0;
		const samples: FxNode[] = [];
		for (let i = 0; i < nodes.length && samples.length < 4; i++) {
			const n = nodes[i] as FxNode & { rendered?: boolean };
			const wt = n.circle?.worldTransform;
			if (n.rendered !== false && wt && Number.isFinite(wt.tx) && Number.isFinite(wt.ty)) samples.push(n);
		}
		if (samples.length) {
			const a = samples[0];
			const wa = a.circle!.worldTransform!;
			let cS = S;
			const b = samples.find((n) => Math.abs(n.x - a.x) > 1);
			if (b) {
				const s2 = (b.circle!.worldTransform!.tx - wa.tx) / (b.x - a.x);
				if (Number.isFinite(s2) && s2 > 0) cS = s2;
			}
			const cx = wa.tx - a.x * cS;
			const cy = wa.ty - a.y * cS;
			// Every sample must agree with the mapping, otherwise keep pan/scale.
			const ok = samples.every((n) => {
				const wt = n.circle!.worldTransform!;
				return Math.abs(n.x * cS + cx - wt.tx) < 2 && Math.abs(n.y * cS + cy - wt.ty) < 2;
			});
			if (ok) {
				S = cS;
				ox = cx;
				oy = cy;
			}
		}
		return { S: S * ratio, ox: ox * ratio, oy: oy * ratio };
	}

	private draw(r: FxRenderer, layer: Layer, now: number) {
		const { canvas, ctx } = layer;
		const host = r.containerEl!;
		const w = host.clientWidth;
		const h = host.clientHeight;
		if (!w || !h || host.offsetParent === null) return; // hidden tab

		const s = this.plugin.settings;
		const t = (now - this.t0) / 1000;
		const interval = Math.max(1, s.fxInterval);
		const phase = t % interval;
		const nodes = r.nodes ?? [];
		const lists = this.lists(layer, r);
		const q = this.quality;

		// Is anything visible this frame? Pulse-only setups are idle most of the time.
		const maxDepth = lists.hubDepth.length ? Math.max(...lists.hubDepth) : 1;
		const pulseWindow = (maxDepth - 1) * (s.fxWave ? TRAVEL : 0) + Math.max(RING, TRAVEL + LINGER);
		const fxOn = this.effectsOn;
		const modsOn = this.modulesOn;
		const busy =
			modsOn ||
			(fxOn &&
				(s.fxGlow ||
			s.fxShowFps ||
			s.linkFlow !== "off" ||
			(s.fxWave && s.rayMode === "constant") ||
			this.bursts.length > 0 ||
			((s.fxRing || s.fxWave) && phase < pulseWindow)));
		if (!busy) {
			if (layer.dirty) {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				layer.dirty = false;
			}
			return;
		}

		const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[q]);
		const cw = Math.round(w * dpr);
		const ch = Math.round(h * dpr);
		if (canvas.width !== cw || canvas.height !== ch) {
			canvas.width = cw;
			canvas.height = ch;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		layer.dirty = true;
		if (!nodes.length) return;

		const color = this.colors();
		const ratio = w / (r.px?.screen?.width || w);
		const { S, ox, oy } = this.mapping(r, nodes, ratio);
		const X = (n: FxNode) => n.x * S + ox;
		const Y = (n: FxNode) => n.y * S + oy;
		const radius = (n: FxNode) => Math.max(3, (n.getSize?.() ?? 6) * S);
		const PAD = 120;
		const visible = (x: number, y: number) => x > -PAD && y > -PAD && x < w + PAD && y < h + PAD;
		const segVisible = (ax: number, ay: number, bx: number, by: number) =>
			!((ax < -PAD && bx < -PAD) || (ay < -PAD && by < -PAD) || (ax > w + PAD && bx > w + PAD) || (ay > h + PAD && by > h + PAD));
		const emitAt = (depth: number) => (depth - 1) * (s.fxWave ? TRAVEL : 0);

		// ---- modules: barriers around groups of notes (drawn underneath everything)
		if (modsOn) {
			const mods = this.modEntries(layer, lists);
			this.updateOutlines(mods);
			const animate = s.moduleAnimate && s.animations;
			mods.entries.forEach((e, idx) => {
				if (e.outline.length < 3) return;
				let screen = e.outline.map((p) => ({ x: p.x * S + ox, y: p.y * S + oy }));
				let minX = Infinity;
				let minY = Infinity;
				let maxX = -Infinity;
				let maxY = -Infinity;
				for (const p of screen) {
					if (p.x < minX) minX = p.x;
					if (p.y < minY) minY = p.y;
					if (p.x > maxX) maxX = p.x;
					if (p.y > maxY) maxY = p.y;
				}
				if (maxX < -20 || maxY < -20 || minX > w + 20 || minY > h + 20) return;
				if (s.moduleShape === "cloud") screen = smoothClosed(screen, q === 0 ? 3 : 6);
				if (s.moduleFill) fillOutline(ctx, screen, e.fill);
				drawBoundary(ctx, screen, {
					style: e.def.line === "default" ? s.moduleLine : e.def.line,
					color: e.colorFn,
					t,
					animate,
					width: s.moduleLineWidth,
					seed: idx + 1,
				});
				if (s.moduleLabels) {
					let top = screen[0];
					for (const p of screen) if (p.y < top.y) top = p;
					const label = `${e.def.name} · ${e.nodes.length}`;
					ctx.font = "600 12px var(--font-interface, sans-serif)";
					const tw = ctx.measureText(label).width;
					const lx = Math.min(Math.max(top.x - tw / 2, 4), w - tw - 4);
					const ly = Math.max(top.y - 10, 16);
					ctx.fillStyle = "rgba(0,0,0,0.5)";
					ctx.fillRect(lx - 6, ly - 13, tw + 12, 18);
					ctx.fillStyle = e.colorFn(1);
					ctx.fillText(label, lx, ly);
				}
			});
		}
		if (!fxOn) return;

		// ---- link flow: moving dashes (one batched path)
		if (s.linkFlow !== "off") {
			const source = s.linkFlow === "hubs" ? lists.hubLinks : r.links ?? [];
			const limit = MAX_FLOW[q];
			ctx.beginPath();
			let count = 0;
			for (let i = 0; i < source.length && count < limit; i++) {
				const l = source[i];
				const ax = X(l.source);
				const ay = Y(l.source);
				const bx = X(l.target);
				const by = Y(l.target);
				if (!segVisible(ax, ay, bx, by)) continue;
				ctx.moveTo(ax, ay);
				ctx.lineTo(bx, by);
				count++;
			}
			if (count) {
				ctx.setLineDash([3, 9]);
				ctx.lineDashOffset = -((t * s.linkFlowSpeed) % 12);
				ctx.strokeStyle = this.flowStyle;
				ctx.lineWidth = 1.4;
				ctx.lineCap = "round";
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}

		ctx.globalCompositeOperation = "lighter"; // additive light: cheap glow

		// ---- breathing glow (cached sprite)
		if (s.fxGlow && this.glowSprite) {
			ctx.globalAlpha = 0.3 + 0.2 * Math.sin((t * Math.PI * 2) / 2.6);
			for (const n of lists.hubNodes) {
				const x = X(n);
				const y = Y(n);
				if (!visible(x, y)) continue;
				const rr = radius(n) * 3 + 8;
				ctx.drawImage(this.glowSprite, x - rr, y - rr, rr * 2, rr * 2);
			}
			ctx.globalAlpha = 1;
		}

		// ---- pulse rings
		if (s.fxRing) {
			for (let i = 0; i < lists.hubNodes.length; i++) {
				const age = phase - emitAt(lists.hubDepth[i]);
				if (age < 0 || age > RING) continue;
				const n = lists.hubNodes[i];
				const x = X(n);
				const y = Y(n);
				if (!visible(x, y)) continue;
				const k = age / RING;
				const base = radius(n);
				ctx.beginPath();
				ctx.arc(x, y, base + 4 + k * (28 + base * 1.5), 0, Math.PI * 2);
				ctx.strokeStyle = color((1 - k) * 0.85);
				ctx.lineWidth = 2.5 * (1 - k) + 0.6;
				ctx.stroke();
			}
		}

		// ---- rays: spark / beam / energy / electricity from each hub along its links
		if (s.fxWave) {
			const constant = s.rayMode === "constant";
			const limit = MAX_RAYS[q];
			let count = 0;
			const a = { x: 0, y: 0 };
			const b = { x: 0, y: 0 };
			for (let i = 0; i < lists.hubLinks.length && count < limit; i++) {
				let head = 1;
				let alpha = 1;
				if (!constant) {
					const age = phase - emitAt(lists.hubLinkDepth[i]);
					if (age < 0 || age > TRAVEL + LINGER) continue;
					head = easeInOut(Math.min(1, age / TRAVEL));
					alpha = age <= TRAVEL ? 1 : 1 - (age - TRAVEL) / LINGER;
				}
				const l = lists.hubLinks[i];
				a.x = X(l.source);
				a.y = Y(l.source);
				b.x = X(l.target);
				b.y = Y(l.target);
				if (!segVisible(a.x, a.y, b.x, b.y)) continue;
				count++;
				drawRay(ctx, a, b, { style: s.rayStyle, head, alpha, t, seed: i, color, width: s.rayWidth, constant, quality: q });
			}
		}

		// ---- level-up bursts: three big rings
		for (const burst of this.bursts) {
			const n = lists.byId.get(burst.id);
			if (!n) continue;
			const x = X(n);
			const y = Y(n);
			const base = radius(n);
			for (let i = 0; i < 3; i++) {
				const age = (now - burst.start) / 1000 - i * 0.35;
				if (age < 0 || age > 1.6) continue;
				const k = age / 1.6;
				ctx.beginPath();
				ctx.arc(x, y, base + 6 + k * 110, 0, Math.PI * 2);
				ctx.strokeStyle = color((1 - k) * 0.95);
				ctx.lineWidth = 4 * (1 - k) + 1;
				ctx.stroke();
			}
		}
		ctx.globalCompositeOperation = "source-over";

		// ---- FPS meter
		if (s.fxShowFps) {
			const fps = Math.round(this.fpsEma);
			const label = `${fps} FPS · ${["низкое", "среднее", "высокое"][q]}`;
			ctx.font = "600 12px var(--font-interface, sans-serif)";
			const tw = ctx.measureText(label).width;
			ctx.fillStyle = "rgba(0,0,0,0.55)";
			ctx.fillRect(w - tw - 22, 8, tw + 14, 22);
			ctx.fillStyle = fps >= 55 ? "#44cf6e" : fps >= 40 ? "#e0de71" : "#fb464c";
			ctx.fillText(label, w - tw - 15, 23);
		}
	}
}
