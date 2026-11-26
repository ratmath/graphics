// Figures: a picture with its own window, ready for any back end.
//
// The pictures phases of the Shelf packages (statistics, discrete
// mathematics, logic, dynamics, geometry, finance) all build figures. A
// figure holds layers (the frames the scene renderers already draw), the
// window of the plane it shows, whether to draw axes, and a status saying
// how far to trust it:
//
//   exact       every coordinate is the exact value (exact data, exact layout)
//   certified   every mark is within a stated error of the true one
//   estimated   floating-point values, not proved
//   simulated   the result of seeded random runs: rerunning gives the same
//               picture, another seed a different one
//
// Two new frame kinds carry what the older frames could not:
//   shapes  world-coordinate paths, dots, arrows and text, each styled
//   image   a grid of coloured cells (escape-time pictures, basins, colouring)
//
// figureSVG, figurePNG, figureTikZ, figurePDF and figureASCII draw a figure
// at a size; figureViewport gives the viewport they use.

import { viewport } from "./viewport.js";
import { sceneSVG } from "./render/scene.js";
import { sceneTikZ } from "./render/tikz.js";
import { sceneASCII } from "./render/ascii.js";
import { scenePDF } from "./render/pdf.js";
import { scenePNG } from "./render/raster.js";
import { animationSVG, animationPNG } from "./animate.js";

const STATUSES = new Set(["exact", "certified", "estimated", "simulated"]);
/** A number as a double: numbers, bigints, Rationals (toNumber), intervals (their midpoint) and text such as "1/5". */
export function toNumber(x) {
  if (typeof x === "number") return x;
  if (typeof x === "bigint") return Number(x);
  if (typeof x?.toNumber === "function") return x.toNumber();
  if (x && typeof x === "object" && x.low !== undefined && x.high !== undefined) return (toNumber(x.low) + toNumber(x.high)) / 2;
  if (x && typeof x === "object" && x.lo !== undefined && x.hi !== undefined) return (toNumber(x.lo) + toNumber(x.hi)) / 2;
  if (typeof x === "string") {
    const m = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)\s*\/\s*([\d.]+(?:e[+-]?\d+)?)\s*$/i.exec(x);
    if (m) return Number(m[1]) / Number(m[2]);
    const pc = /^\s*([+-]?[\d.]+)\s*%\s*$/.exec(x);
    if (pc) return Number(pc[1]) / 100;
  }
  return Number(x);
}
const num = toNumber;

/** A frame of styled shapes in world coordinates. */
export const shapes = (list) => ({ kind: "shapes", shapes: list.filter(Boolean) });
/** A path through [x, y, x, y, …] or [[x, y], …]. */
export function path(points, style = {}) {
  const flat = Array.isArray(points[0]) ? points.flatMap((p) => p.map(num)) : points.map(num);
  return { path: flat, ...style };
}
export const dot = (at, style = {}) => ({ dot: at.map(num), ...style });
export const arrow = (from, to, style = {}) => ({ arrow: [...from.map(num), ...to.map(num)], ...style });
/** Text at a point: `tex` is LaTeX; `label` is the plain-text form (default: derived from tex). */
export const text = (at, tex, style = {}) => ({ text: at.map(num), tex: String(tex), ...style });

/** A grid of coloured cells over x × y; cells[j·width + i] is a CSS colour or null, row 0 at the bottom. */
export function image({ x, y, width, height, cells }) {
  if (cells.length !== width * height) throw new RangeError("image: cells must have width × height entries");
  return { kind: "image", x: x.map(num), y: y.map(num), width, height, cells };
}

/** The bounding box of shapes and frames, as { x: [a, b], y: [c, d] } (null when empty). */
export function extentOf(layers) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  const flat = (a) => {
    for (let i = 0; i + 1 < a.length; i += 2) add(a[i], a[i + 1]);
  };
  for (const l of layers) {
    const f = l && l.item !== undefined && typeof l.kind !== "string" ? l.item : l;
    if (!f) continue;
    if (f.kind === "shapes") for (const s of f.shapes) flat(s.path ?? s.dot ?? s.arrow ?? s.text ?? []);
    else if (f.kind === "image") {
      add(f.x[0], f.y[0]);
      add(f.x[1], f.y[1]);
    } else if (f.kind === "points") flat(f.data);
    else if (f.kind === "segments" || f.kind === "arrows") flat(f.segments);
    else if (f.kind === "bars") for (let i = 0; i < f.bars.length; i += 4) add(f.bars[i], f.bars[i + 2]), add(f.bars[i + 1], f.bars[i + 3]);
    else if (f.kind === "area") for (const p of [...(f.above ?? []), ...(f.below ?? [])]) flat(p);
  }
  return x0 <= x1 ? { x: [x0, x1], y: [y0, y1] } : null;
}

/**
 * A figure. layers: frames (or { item, color, … } wrappers); x, y: the
 * window (default: what the layers span, with a margin); axes: true or axes
 * options; equal: keep one unit the same length on both axes; status: how
 * far to trust it (see above); notes: what it shows, for a caption.
 */
export function figure({ layers, x, y, axes = false, equal = false, status = "exact", title = "", notes = [], margin = 0.06, ...rest }) {
  if (!STATUSES.has(status)) throw new RangeError(`figure status is one of ${[...STATUSES].join(", ")}`);
  const ext = extentOf(layers) ?? { x: [0, 1], y: [0, 1] };
  const pad = ([a, b]) => {
    const w = b - a || 1;
    return b - a ? [a - w * margin, b + w * margin] : [a - 0.5, b + 0.5];
  };
  const X = x ? x.map(num) : pad(ext.x);
  const Y = y ? y.map(num) : pad(ext.y);
  return Object.freeze({ kind: "figure", layers, x: X, y: Y, axes, equal, status, title, notes, ...rest });
}

/** The viewport a figure is drawn in at this size; with `equal`, the window grows so that units match. */
export function figureViewport(fig, width = 480, height = 360) {
  let [x0, x1] = fig.x;
  let [y0, y1] = fig.y;
  if (fig.equal) {
    const sx = (x1 - x0) / width;
    const sy = (y1 - y0) / height;
    if (sx > sy) {
      const h = sx * height;
      const c = (y0 + y1) / 2;
      [y0, y1] = [c - h / 2, c + h / 2];
    } else {
      const w = sy * width;
      const c = (x0 + x1) / 2;
      [x0, x1] = [c - w / 2, c + w / 2];
    }
  }
  const r = (v) => String(Math.round(v * 1e9) / 1e9);
  return viewport({ x: [r(x0), r(x1)], y: [r(y0), r(y1)], width, height });
}

const draw = (scene) => (fig, { width = fig?.size?.width ?? 480, height = fig?.size?.height ?? 360, ...options } = {}) => {
  if (fig?.kind !== "figure") throw new TypeError("expected a figure");
  return scene(figureViewport(fig, width, height), fig.layers, { axes: fig.axes, ...options });
};
/** A figure as a standalone SVG string. */
export const figureSVG = draw(sceneSVG);
/** A figure as TikZ source. */
export const figureTikZ = draw(sceneTikZ);
/** A figure as characters, for a terminal. */
export const figureASCII = (fig, { width = 72, height = 24, ...o } = {}) => draw(sceneASCII)(fig, { width, height, ...o });
/** The size a figure asks to be drawn at (its own hint, else 480 by 360). */
export const figureSize = (fig) => ({ width: fig?.size?.width ?? 480, height: fig?.size?.height ?? 360 });
/** A figure as a one-page PDF (bytes). */
export const figurePDF = draw(scenePDF);
/** A figure as PNG bytes (a promise). */
export const figurePNG = draw(scenePNG);

/**
 * Frames ({ kind: "frames", frames: [figure, …] } or a list of figures) as
 * one animated SVG, drawn in the first frame's window. Options as
 * animationSVG: duration, loop, width, height.
 */
export function framesSVG(frames, { width, height, ...options } = {}) {
  const list = frames.frames ?? frames;
  const size = figureSize(list[0]);
  const vp = figureViewport(list[0], width ?? size.width, height ?? size.height);
  return animationSVG(vp, list.map((f) => f.layers), { axes: list[0].axes, ...options });
}
/** Frames as an animated PNG (a promise of bytes). */
export function framesPNG(frames, { width, height, ...options } = {}) {
  const list = frames.frames ?? frames;
  const size = figureSize(list[0]);
  return animationPNG(figureViewport(list[0], width ?? size.width, height ?? size.height), list.map((f) => f.layers), { axes: list[0].axes, ...options });
}

// ---- colours ----------------------------------------------------------------------------

/** A sequential colour for t in [0, 1] (dark blue through green to yellow). */
export function rampColor(t) {
  const stops = [[49, 54, 149], [33, 144, 141], [94, 201, 98], [253, 231, 37]];
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(u));
  const f = u - k;
  const c = stops[k].map((a, i) => Math.round(a + (stops[k + 1][i] - a) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
/** A diverging colour for t in [−1, 1]: blue below 0, white at 0, red above. */
export function divergingColor(t) {
  const u = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  const [r, g, b] = u < 0 ? [37, 99, 235] : [220, 38, 38];
  const a = Math.abs(u);
  const mix = (c) => Math.round(255 + (c - 255) * a);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
/** Distinct colours for categories (the scene palette, then more). */
export const CATEGORY = Object.freeze(["#2563eb", "#dc2626", "#0f766e", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#be185d", "#4d7c0f", "#64748b"]);
