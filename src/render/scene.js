// Scenes: geometry objects, graph and region frames, and labels drawn
// together, on a canvas or as SVG.
//
// Everything is first turned into pixel-space primitives (paths, rectangles,
// dots, labels) by `primitives()`; the two back ends only paint those. This
// is the only place where exact values become floating-point pixels.
//
//   drawScene(ctx2d, vp, [
//     { item: region("x + y <= 4, x >= 0, y >= 0", {}, vp).exact(), color: "#0f766e" },
//     { item: circle([0, 0], 2), color: "#2563eb" },
//     label([1, 1], "x + y \\le 4"),
//   ], { axes: true, scale: devicePixelRatio });
//
//   const svg = sceneSVG(vp, layers, { axes: true, tex: (s) => katex.renderToString(s) });
//
// A layer is a geometry object (point, line, segment, ray, polygon, circle),
// a frame from graph(), implicit() or region() (quick or exact), a label, or
// { item, ...style }. Style: color, fill, fillAlpha, width, dash (array),
// radius (points), label (TeX string, or true for the object's own TeX).

import { Point, Line, Polygon, Circle } from "../geometry.js";
import { toPixelX, toPixelY } from "../viewport.js";
import { shade } from "./markers.js";

export const PALETTE = ["#2563eb", "#dc2626", "#0f766e", "#9333ea", "#ea580c", "#0891b2"];

// ---- labels -----------------------------------------------------------------------

/**
 * A label at a world point: label([x, y], "\\frac{1}{2}", { anchor: "ne" }).
 * `tex` is LaTeX; `text` (optional) is a plain-text fallback. Anchors: n, ne,
 * e, se, s, sw, w, nw, c (where the label sits relative to the point).
 */
export function label(at, tex, { anchor = "ne", dx = 0, dy = 0, color, size = 14, text } = {}) {
  const P = at instanceof Point ? at : null;
  const xy = P ? P.toNumbers() : [num(at[0]), num(at[1])];
  return { type: "label", x: xy[0], y: xy[1], tex: String(tex), text: text ?? texToText(String(tex)), anchor, dx, dy, color, size };
}

function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*$/.exec(v);
    return m ? Number(m[1]) / Number(m[2]) : Number(v);
  }
  return v.toNumber();
}

const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻", n: "ⁿ", "+": "⁺" };
const SYMBOLS = {
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", cdot: "·", times: "×", pm: "±", mp: "∓", infty: "∞",
  pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", lambda: "λ", mu: "μ",
  sigma: "σ", phi: "φ", omega: "ω", in: "∈", cap: "∩", cup: "∪", to: "→", rightarrow: "→", sqrt: "√", ldots: "…", dots: "…",
};

/** A rough plain-text reading of simple LaTeX, for canvases and fallbacks. */
export function texToText(tex) {
  let s = tex;
  const group = String.raw`\{((?:[^{}]|\{[^{}]*\})*)\}`;
  const wrap = (x) => (/^[\w.√⁰¹²³⁴⁵⁶⁷⁸⁹⁻ⁿ]+$/.test(x) ? x : `(${x})`);
  const sups = (t) => t.replace(/\^\{([0-9n+-]+)\}|\^([0-9n])/g, (m, a, b) => [...(a ?? b)].map((c) => SUP[c] ?? c).join(""));
  for (let k = 0; k < 4; k++) {
    s = sups(s);
    s = s.replace(new RegExp(String.raw`\\[dt]?frac` + group + group, "g"), (m, a, b) => `${wrap(a)}/${wrap(b)}`);
    s = s.replace(new RegExp(String.raw`\\sqrt` + group, "g"), (m, a) => `√${wrap(a)}`);
    s = s.replace(new RegExp(String.raw`\\(?:overline|mathrm|text|mathbf|operatorname)` + group, "g"), "$1");
  }
  s = s.replace(/\\left|\\right/g, "").replace(/\\[,;:! ]/g, " ").replace(/~/g, " ");
  s = s.replace(/\^\{([0-9n+-]+)\}|\^([0-9n])/g, (m, a, b) => [...(a ?? b)].map((c) => SUP[c] ?? c).join(""));
  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)");
  s = s.replace(/_\{([^{}]*)\}/g, "_$1");
  s = s.replace(/\\([A-Za-z]+)/g, (m, w) => SYMBOLS[w] ?? w);
  return s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

// ---- primitives --------------------------------------------------------------------

const isFrame = (v) => v && typeof v === "object" && typeof v.kind === "string";

/** Clip the infinite line through (x0, y0) with direction (dx, dy) to [t0, t1] inside the box; returns [ta, tb] or null. */
function clipParam(x0, y0, dx, dy, box, t0 = -Infinity, t1 = Infinity) {
  const [L, T, R, B] = box;
  for (const [p, q] of [[-dx, x0 - L], [dx, R - x0], [-dy, y0 - T], [dy, B - y0]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/**
 * Turn layers into pixel primitives:
 *   { t: "path", subpaths: [[x, y, x, y, ...], ...], closed, fill, fillAlpha, stroke, width, dash, alpha }
 *   { t: "rects", rects: [x, y, w, h, ...], fill, alpha }
 *   { t: "dot", x, y, r, fill, stroke, width }
 *   { t: "label", x, y, tex, text, anchor, color, size }
 */
export function primitives(vp, layers, { colors = PALETTE } = {}) {
  const out = [];
  const W = vp.width;
  const H = vp.height;
  const box = [-4, -4, W + 4, H + 4];
  const px = (P) => [toPixelX(vp, P.x.toNumber()), toPixelY(vp, P.y.toNumber())];
  let auto = 0;
  for (const layer of layers) {
    if (!layer) continue;
    const wrapped = layer.item !== undefined && !isFrame(layer) && !(layer instanceof Point) && layer.type !== "label";
    const item = wrapped ? layer.item : layer;
    const style = wrapped ? layer : {};
    const color = style.color ?? colors[auto++ % colors.length];
    const width = style.width ?? 2;
    const dash = style.dash;
    const labelOf = (P, anchor = "ne") => {
      if (!style.label) return;
      const tex = style.label === true ? item.toTeX() : style.label;
      out.push({ t: "label", x: P[0], y: P[1], tex, text: texToText(tex), anchor: style.anchor ?? anchor, color: style.labelColor ?? color, size: style.size ?? 14, dx: 0, dy: 0 });
    };

    if (item.type === "label") {
      out.push({ t: "label", ...item, x: toPixelX(vp, item.x), y: toPixelY(vp, item.y), color: item.color ?? style.color ?? "currentColor" });
      continue;
    }
    if (item instanceof Point) {
      const [x, y] = px(item);
      out.push({ t: "dot", x, y, r: style.radius ?? 4, fill: style.open ? style.background ?? "#fff" : color, stroke: color, width: 1.5 });
      labelOf([x, y]);
      continue;
    }
    if (item instanceof Line) {
      const [x0, y0] = px(item.p);
      const [x1, y1] = px(item.q);
      const t = clipParam(x0, y0, x1 - x0, y1 - y0, box, item.type === "line" ? -Infinity : 0, item.type === "segment" ? 1 : Infinity);
      if (!t) continue;
      const a = [x0 + t[0] * (x1 - x0), y0 + t[0] * (y1 - y0)];
      const b = [x0 + t[1] * (x1 - x0), y0 + t[1] * (y1 - y0)];
      out.push({ t: "path", subpaths: [[...a, ...b]], closed: false, stroke: color, width, dash });
      if (item.type !== "line" && style.endpoints !== false) {
        out.push({ t: "dot", x: x0, y: y0, r: 3, fill: color, stroke: color, width: 1 });
        if (item.type === "segment") out.push({ t: "dot", x: x1, y: y1, r: 3, fill: color, stroke: color, width: 1 });
      }
      labelOf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      continue;
    }
    if (item instanceof Polygon) {
      const pts = item.vertices.flatMap((P) => px(P));
      out.push({ t: "path", subpaths: [pts], closed: true, fill: style.fill ?? color, fillAlpha: style.fillAlpha ?? 0.15, stroke: color, width, dash });
      if (style.label) {
        const c = item.vertices.map(px).reduce((s, p) => [s[0] + p[0] / item.vertices.length, s[1] + p[1] / item.vertices.length], [0, 0]);
        labelOf(c, "c");
      }
      continue;
    }
    if (item instanceof Circle) {
      const [cx, cy] = px(item.center);
      const r = Math.sqrt(item.r2.toNumber()) * (W / (vp.f.xmax - vp.f.xmin));
      const ry = Math.sqrt(item.r2.toNumber()) * (H / (vp.f.ymax - vp.f.ymin));
      const n = Math.max(32, Math.min(720, Math.ceil(2 * Math.PI * Math.max(r, ry) / 3)));
      const pts = [];
      for (let k = 0; k < n; k++) pts.push(cx + r * Math.cos((2 * Math.PI * k) / n), cy - ry * Math.sin((2 * Math.PI * k) / n));
      // `ellipse` keeps the exact shape for vector back ends (TikZ) that can draw it.
      out.push({ t: "path", subpaths: [pts], closed: true, fill: style.fill, fillAlpha: style.fillAlpha ?? (style.fill ? 0.15 : 0), stroke: color, width, dash, ellipse: [cx, cy, r, ry] });
      labelOf([cx + r * Math.SQRT1_2, cy - ry * Math.SQRT1_2]);
      continue;
    }
    if (isFrame(item)) {
      framePrimitives(out, vp, item, { ...style, color, width, px });
      continue;
    }
    throw new TypeError(`cannot draw ${item?.type ?? typeof item}`);
  }
  // Keep labels on screen: flip a label to the other side of its point when
  // its (estimated) box would run past an edge.
  for (const p of out) {
    if (p.t !== "label" || p.plain) continue;
    const w = (p.text ?? "").length * (p.size ?? 14) * 0.55 + 8;
    const h = (p.size ?? 14) * 1.3 + 6;
    let [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
    if (ax > 0 && p.x + w > W) ax = -1;
    else if (ax < 0 && p.x - w < 0) ax = 1;
    else if (ax === 0 && p.x + w / 2 > W) ax = -1;
    else if (ax === 0 && p.x - w / 2 < 0) ax = 1;
    if (ay < 0 && p.y - h < 0) ay = 1;
    else if (ay > 0 && p.y + h > H) ay = -1;
    p.anchor = Object.keys(ANCHOR).find((k) => ANCHOR[k][0] === ax && ANCHOR[k][1] === ay);
  }
  return out;
}

function polylineSubpaths(points) {
  const subs = [];
  let cur = [];
  for (let i = 0; i < points.length; i += 2) {
    if (Number.isNaN(points[i])) {
      if (cur.length >= 4) subs.push(cur);
      cur = [];
    } else cur.push(points[i], points[i + 1]);
  }
  if (cur.length >= 4) subs.push(cur);
  return subs;
}

function cellRects(columns) {
  const rects = [];
  columns.forEach((s, i) => {
    if (!s) return;
    for (let j = 0; j < s.length; j += 2) rects.push(i, s[j], 1, s[j + 1] - s[j] + 1);
  });
  return rects;
}

function framePrimitives(out, vp, f, style) {
  const { color, width, px } = style;
  const fillAlpha = style.fillAlpha ?? 0.22;
  switch (f.kind) {
    case "polyline":
      out.push({ t: "path", subpaths: polylineSubpaths(f.points), closed: false, stroke: color, width, dash: style.dash });
      for (const a of f.asymptotes ?? []) out.push({ t: "path", subpaths: [[a.px, 0, a.px, vp.height]], stroke: style.asymptoteColor ?? color, width: 1, dash: a.certain ? [6, 4] : [2, 4], alpha: a.certain ? 0.9 : 0.45 });
      return;
    case "cells":
      out.push({ t: "rects", rects: cellRects(f.columns), fill: color, alpha: 1 });
      for (const a of f.asymptotes ?? []) out.push({ t: "path", subpaths: [[a.px, 0, a.px, vp.height]], stroke: style.asymptoteColor ?? color, width: 1, dash: a.certain ? [6, 4] : [2, 4], alpha: a.certain ? 0.9 : 0.45 });
      return;
    case "points": {
      // data points in world coordinates
      const d = f.data;
      if (f.join && d.length >= 4) {
        const path = [];
        for (let i = 0; i < d.length; i += 2) path.push(toPixelX(vp, d[i]), toPixelY(vp, d[i + 1]));
        out.push({ t: "path", subpaths: [path], closed: false, stroke: color, width, dash: style.dash });
      }
      for (let i = 0; i < d.length; i += 2) {
        out.push({ t: "dot", x: toPixelX(vp, d[i]), y: toPixelY(vp, d[i + 1]), r: style.radius ?? 3, fill: style.open ? style.background ?? "#fff" : color, stroke: color, width: 1.5 });
      }
      return;
    }
    case "bars": {
      const b = f.bars;
      const subs = [];
      for (let i = 0; i < b.length; i += 4) {
        const x0 = toPixelX(vp, b[i]);
        const x1 = toPixelX(vp, b[i + 1]);
        const y0 = toPixelY(vp, b[i + 2]);
        const y1 = toPixelY(vp, b[i + 3]);
        subs.push([x0, y0, x0, y1, x1, y1, x1, y0]);
      }
      if (subs.length) out.push({ t: "path", subpaths: subs, closed: true, fill: style.fill ?? color, fillAlpha: style.fillAlpha ?? 0.35, stroke: color, width: style.width ?? 1 });
      return;
    }
    case "segments": {
      const g = f.segments;
      const subs = [];
      for (let i = 0; i < g.length; i += 4) subs.push([toPixelX(vp, g[i]), toPixelY(vp, g[i + 1]), toPixelX(vp, g[i + 2]), toPixelY(vp, g[i + 3])]);
      if (subs.length) out.push({ t: "path", subpaths: subs, closed: false, stroke: color, width: style.width ?? 1, alpha: style.alpha ?? 0.7 });
      return;
    }
    case "region-sketch":
      out.push({ t: "rects", rects: f.fill, fill: style.fill ?? color, alpha: fillAlpha });
      for (const e of f.edges) out.push({ t: "path", subpaths: polylineSubpaths(e.points), stroke: color, width, dash: e.strict ? [6, 4] : undefined });
      return;
    case "region":
      out.push({ t: "rects", rects: f.inside, fill: style.fill ?? color, alpha: fillAlpha });
      out.push({ t: "rects", rects: cellRects(f.boundary), fill: color, alpha: 0.9 });
      return;
    case "polygons": {
      const subs = f.pieces.map((p) => p.vertices.flatMap(px));
      if (subs.length) out.push({ t: "path", subpaths: subs, closed: true, fill: style.fill ?? color, fillAlpha, stroke: null });
      for (const b of f.boundary) out.push({ t: "path", subpaths: [[...px(b.from), ...px(b.to)]], stroke: color, width, dash: b.strict ? [6, 4] : undefined });
      for (const l of f.lines ?? []) {
        if (l.segment) out.push({ t: "path", subpaths: [[...px(l.segment.p), ...px(l.segment.q)]], stroke: color, width });
        else out.push({ t: "dot", x: px(l.point)[0], y: px(l.point)[1], r: 4, fill: color, stroke: color, width: 1.5 });
      }
      if (style.corners !== false) {
        for (const c of f.corners ?? []) {
          const [x, y] = px(c.point);
          out.push({ t: "dot", x, y, r: 4, fill: c.included ? shade(color, -0.3) : style.background ?? "#fff", stroke: shade(color, -0.3), width: 1.5 });
          if (style.cornerLabels) out.push({ t: "label", x, y, tex: c.point.toTeX(), text: String(c.point), anchor: "ne", color: style.labelColor ?? color, size: 13, dx: 0, dy: 0 });
        }
      }
      return;
    }
  }
  throw new TypeError(`cannot draw a ${f.kind} frame`);
}

// ---- axes ------------------------------------------------------------------------------

/** A "nice" tick step (1, 2 or 5 times a power of ten) giving about `target` ticks over span. */
export function niceStep(span, target = 8) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function fmtTick(v, step) {
  const digits = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const s = v.toFixed(digits);
  return s === "-0" ? "0" : s.replace(/^-/, "−");
}

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const gcdInt = (a, b) => (b ? gcdInt(b, a % b) : Math.abs(a));

/** k·(p/q) as a reduced fraction label, with an optional unit symbol: 3/2, −π/2, 2π. */
function fractionLabel(k, p, q, unit = "") {
  let n = k * p;
  let d = q;
  const g = gcdInt(n, d) || 1;
  n /= g;
  d /= g;
  const sign = n < 0 ? "−" : "";
  n = Math.abs(n);
  if (n === 0) return "0";
  const top = unit ? (n === 1 ? unit : `${n}${unit}`) : String(n);
  return d === 1 ? `${sign}${top}` : `${sign}${top}/${d}`;
}

// Steps for fraction and π ticks, as [p, q] (in units of 1 or of π).
const FRACTION_STEPS = [[1, 16], [1, 8], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [5, 1], [10, 1], [20, 1], [50, 1], [100, 1]];
const PI_STEPS = [[1, 12], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [10, 1], [20, 1], [50, 1]];

/** Tick positions and labels for one axis: [[value, label], ...] plus minor grid values. */
function axisTicks(min, max, target, unit, scale) {
  const ticks = [];
  const minor = [];
  if (scale === "log") {
    // the coordinate is log10 of the quantity: label whole powers of ten
    const stride = Math.max(1, Math.ceil((max - min) / target));
    for (let k = Math.ceil(min); k <= max + 1e-12; k++) {
      if (k % stride === 0) ticks.push([k, k >= 0 && k <= 3 ? String(10 ** k) : `10${String(k).split("").map((c) => SUPERSCRIPT[c]).join("")}`]);
      if (stride === 1) for (let m = 2; m <= 9; m++) minor.push(k + Math.log10(m));
    }
    if (stride === 1) for (let m = 2; m <= 9; m++) minor.push(Math.ceil(min) - 1 + Math.log10(m));
    return { ticks, minor: minor.filter((u) => u >= min && u <= max), step: stride };
  }
  if (unit === "pi" || unit === "fraction") {
    const base = unit === "pi" ? Math.PI : 1;
    const raw = (max - min) / target / base;
    const steps = unit === "pi" ? PI_STEPS : FRACTION_STEPS;
    const [p, q] = steps.find(([a, b]) => a / b >= raw) ?? steps[steps.length - 1];
    const step = (p / q) * base;
    for (let k = Math.ceil(min / step - 1e-9); k * step <= max + 1e-9; k++) ticks.push([k * step, fractionLabel(k, p, q, unit === "pi" ? "π" : "")]);
    return { ticks, minor, step };
  }
  const step = niceStep(max - min, target);
  for (let x = Math.ceil(min / step) * step; x <= max + 1e-12; x += step) ticks.push([x, fmtTick(x, step)]);
  return { ticks, minor, step };
}

/**
 * Grid, axis lines and tick labels as primitives. Per axis: `xUnit` /
 * `yUnit` of "pi" labels multiples of π (π/2, π, 3π/2) and "fraction" labels
 * fractions (1/2, 3/4); `xScale` / `yScale` of "log" treats the coordinate as
 * log10 of the quantity and labels powers of ten (plot `logScale(f)`).
 */
export function axesPrimitives(vp, { grid = "#e5e7eb", axis = "#9ca3af", text = "#6b7280", ticks = true, target, xUnit, yUnit, xScale, yScale } = {}) {
  const out = [];
  const W = vp.width;
  const H = vp.height;
  const X = axisTicks(vp.f.xmin, vp.f.xmax, target ?? Math.max(4, Math.round(W / 80)), xUnit, xScale);
  const Y = axisTicks(vp.f.ymin, vp.f.ymax, target ?? Math.max(4, Math.round(H / 70)), yUnit, yScale);
  const colOf = (x) => Math.round(toPixelX(vp, x)) + 0.5;
  const rowOf = (y) => Math.round(toPixelY(vp, y)) + 0.5;
  const gx = X.ticks.map(([x]) => [colOf(x), 0, colOf(x), H]);
  const gy = Y.ticks.map(([y]) => [0, rowOf(y), W, rowOf(y)]);
  const minor = [...X.minor.map((x) => [colOf(x), 0, colOf(x), H]), ...Y.minor.map((y) => [0, rowOf(y), W, rowOf(y)])];
  if (grid && minor.length) out.push({ t: "path", subpaths: minor, stroke: grid, width: 1, alpha: 0.5, role: "grid" });
  if (grid) out.push({ t: "path", subpaths: [...gx, ...gy], stroke: grid, width: 1, role: "grid" });
  // On a log axis the line "0" has no meaning; the axis sits at the edge.
  const ax = xScale !== "log" && vp.f.xmin <= 0 && vp.f.xmax >= 0 ? colOf(0) : null;
  const ay = yScale !== "log" && vp.f.ymin <= 0 && vp.f.ymax >= 0 ? rowOf(0) : null;
  const axes = [];
  if (ax !== null) axes.push([ax, 0, ax, H]);
  if (ay !== null) axes.push([0, ay, W, ay]);
  if (axes.length) out.push({ t: "path", subpaths: axes, stroke: axis, width: 1, role: "axis" });
  if (ticks) {
    const yLine = ay ?? H - 1;
    const xLine = ax ?? 1;
    const skipX = (x) => xScale !== "log" && Math.abs(x) <= X.step / 2;
    const skipY = (y) => yScale !== "log" && Math.abs(y) <= Y.step / 2;
    for (const [x, label] of X.ticks) {
      const p = colOf(x);
      if (!skipX(x) && p > 12 && p < W - 12) out.push({ t: "label", x: p, y: yLine, text: label, anchor: "s", color: text, size: 11, dx: 0, dy: 2, plain: true, value: x });
    }
    for (const [y, label] of Y.ticks) {
      const p = rowOf(y);
      if (!skipY(y) && p > 10 && p < H - 10) out.push({ t: "label", x: xLine, y: p, text: label, anchor: "e", color: text, size: 11, dx: 3, dy: 0, plain: true, value: y });
    }
  }
  return out;
}

// ---- canvas back end -----------------------------------------------------------------------

export const ANCHOR = {
  n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1], c: [0, 0],
};

/** Offset (in px) of a label's box from its point, and the text alignment for canvas. */
function placement(anchor, gap = 6) {
  const [ax, ay] = ANCHOR[anchor] ?? ANCHOR.ne;
  return { ox: ax * gap, oy: ay * gap, align: ax < 0 ? "right" : ax > 0 ? "left" : "center", base: ay < 0 ? "bottom" : ay > 0 ? "top" : "middle" };
}

/** Paint primitives on a 2D canvas context. Labels are drawn as plain text (see mountLabels for TeX). */
export function paint(ctx2d, prims, { scale = 1, background = "#fff", font = "system-ui, sans-serif", labels = true } = {}) {
  ctx2d.save();
  for (const p of prims) {
    if (p.t === "rects") {
      if (!p.rects.length) continue;
      ctx2d.globalAlpha = p.alpha ?? 1;
      ctx2d.fillStyle = p.fill;
      ctx2d.beginPath();
      for (let i = 0; i < p.rects.length; i += 4) ctx2d.rect(p.rects[i] * scale, p.rects[i + 1] * scale, p.rects[i + 2] * scale, p.rects[i + 3] * scale);
      ctx2d.fill();
    } else if (p.t === "path") {
      ctx2d.beginPath();
      for (const s of p.subpaths) {
        if (s.length < 4) continue;
        ctx2d.moveTo(s[0] * scale, s[1] * scale);
        for (let i = 2; i < s.length; i += 2) ctx2d.lineTo(s[i] * scale, s[i + 1] * scale);
        if (p.closed) ctx2d.closePath();
      }
      if (p.fill && (p.fillAlpha ?? 1) > 0) {
        ctx2d.globalAlpha = p.fillAlpha ?? 1;
        ctx2d.fillStyle = p.fill;
        ctx2d.fill("nonzero");
      }
      if (p.stroke) {
        ctx2d.globalAlpha = p.alpha ?? 1;
        ctx2d.strokeStyle = p.stroke;
        ctx2d.lineWidth = (p.width ?? 1) * scale;
        ctx2d.lineJoin = "round";
        ctx2d.lineCap = "round";
        ctx2d.setLineDash(p.dash ? p.dash.map((d) => d * scale) : []);
        ctx2d.stroke();
      }
    } else if (p.t === "dot") {
      ctx2d.globalAlpha = 1;
      ctx2d.setLineDash([]);
      ctx2d.beginPath();
      ctx2d.arc(p.x * scale, p.y * scale, p.r * scale, 0, 2 * Math.PI);
      ctx2d.fillStyle = p.fill === "background" ? background : p.fill;
      ctx2d.fill();
      ctx2d.lineWidth = (p.width ?? 1) * scale;
      ctx2d.strokeStyle = p.stroke;
      ctx2d.stroke();
    } else if (p.t === "label" && labels) {
      const { ox, oy, align, base } = placement(p.anchor, p.plain ? 2 : 6);
      ctx2d.globalAlpha = 1;
      ctx2d.font = `${(p.size ?? 14) * scale}px ${font}`;
      ctx2d.textAlign = align;
      ctx2d.textBaseline = base;
      const x = (p.x + ox + (p.dx ?? 0)) * scale;
      const y = (p.y + oy + (p.dy ?? 0)) * scale;
      if (!p.plain) {
        ctx2d.lineWidth = 3 * scale;
        ctx2d.strokeStyle = background;
        ctx2d.strokeText(p.text, x, y);
      }
      ctx2d.fillStyle = p.color ?? "#111";
      ctx2d.fillText(p.text, x, y);
    }
  }
  ctx2d.restore();
}

/**
 * Draw a whole scene on a canvas context sized vp.width x vp.height CSS
 * pixels times `scale`. options: axes (true or axes options), background,
 * scale, labels (false to leave labels to mountLabels).
 */
export function drawScene(ctx2d, vp, layers, options = {}) {
  const { scale = 1, background, axes } = options;
  if (background) {
    ctx2d.save();
    ctx2d.fillStyle = background;
    ctx2d.fillRect(0, 0, vp.width * scale, vp.height * scale);
    ctx2d.restore();
  }
  const prims = [...(axes ? axesPrimitives(vp, axes === true ? {} : axes) : []), ...primitives(vp, layers, options)];
  paint(ctx2d, prims, { ...options, background: background ?? "#fff" });
  return prims;
}

// ---- TeX labels over a canvas ---------------------------------------------------------------------

/**
 * Position TeX labels in an HTML layer over a canvas. `container` must be
 * the canvas's positioned parent (position: relative), sized like the
 * canvas; labels are placed in percent, so they follow CSS scaling.
 * `katex` is the KaTeX module (labels show plain text until it is given).
 * Returns the layer element.
 */
export function mountLabels(container, vp, layersOrPrims, { katex, className = "rm-labels" } = {}) {
  const prims = layersOrPrims.length && layersOrPrims[0]?.t ? layersOrPrims : primitives(vp, layersOrPrims);
  let layer = container.querySelector(`:scope > .${className}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = className;
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    container.append(layer);
  }
  layer.replaceChildren();
  for (const p of prims) {
    if (p.t !== "label" || p.plain) continue;
    const el = document.createElement("div");
    const [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
    const tx = ax < 0 ? "-100%" : ax > 0 ? "0%" : "-50%";
    const ty = ay < 0 ? "-100%" : ay > 0 ? "0%" : "-50%";
    el.style.cssText = `position:absolute;left:${(100 * p.x) / vp.width}%;top:${(100 * p.y) / vp.height}%;transform:translate(calc(${tx} + ${ax * 6 + (p.dx ?? 0)}px), calc(${ty} + ${ay * 6 + (p.dy ?? 0)}px));color:${p.color ?? "inherit"};font-size:${p.size ?? 14}px;white-space:nowrap;line-height:1.1;text-shadow:0 0 3px var(--bg, #fff),0 0 3px var(--bg, #fff)`;
    if (katex && p.tex) {
      try {
        katex.render(p.tex, el, { throwOnError: false, displayMode: false });
      } catch {
        el.textContent = p.text;
      }
    } else el.textContent = p.text;
    layer.append(el);
  }
  return layer;
}

// ---- SVG back end ------------------------------------------------------------------------------------

const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Primitives as SVG elements (a string). `tex(latex)` may return HTML for labels (e.g. KaTeX's renderToString). */
export function svgElements(prims, { tex, font = "system-ui, sans-serif" } = {}) {
  const parts = [];
  for (const p of prims) {
    if (p.t === "rects") {
      if (!p.rects.length) continue;
      let d = "";
      for (let i = 0; i < p.rects.length; i += 4) d += `M${p.rects[i]} ${p.rects[i + 1]}h${p.rects[i + 2]}v${p.rects[i + 3]}h${-p.rects[i + 2]}z`;
      parts.push(`<path d="${d}" fill="${p.fill}"${p.alpha !== undefined && p.alpha !== 1 ? ` fill-opacity="${p.alpha}"` : ""} shape-rendering="crispEdges"/>`);
    } else if (p.t === "path") {
      let d = "";
      for (const s of p.subpaths) {
        if (s.length < 4) continue;
        d += `M${r2(s[0])} ${r2(s[1])}`;
        for (let i = 2; i < s.length; i += 2) d += `L${r2(s[i])} ${r2(s[i + 1])}`;
        if (p.closed) d += "Z";
      }
      if (!d) continue;
      const fill = p.fill && (p.fillAlpha ?? 1) > 0 ? `fill="${p.fill}" fill-opacity="${p.fillAlpha ?? 1}"` : `fill="none"`;
      const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.width ?? 1}" stroke-linejoin="round" stroke-linecap="round"${p.dash ? ` stroke-dasharray="${p.dash.join(" ")}"` : ""}${p.alpha !== undefined && p.alpha !== 1 ? ` stroke-opacity="${p.alpha}"` : ""}` : "";
      parts.push(`<path d="${d}" ${fill}${stroke}/>`);
    } else if (p.t === "dot") {
      parts.push(`<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="${p.r}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.width ?? 1}"/>`);
    } else if (p.t === "label") {
      const [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
      const gap = p.plain ? 2 : 6;
      const x = p.x + ax * gap + (p.dx ?? 0);
      const y = p.y + ay * gap + (p.dy ?? 0);
      if (tex && p.tex && !p.plain) {
        // A box big enough for the label, aligned by its anchor.
        const w = 240;
        const h = 60;
        const bx = ax < 0 ? x - w : ax > 0 ? x : x - w / 2;
        const by = ay < 0 ? y - h : ay > 0 ? y : y - h / 2;
        const justify = ax < 0 ? "flex-end" : ax > 0 ? "flex-start" : "center";
        const alignItems = ay < 0 ? "flex-end" : ay > 0 ? "flex-start" : "center";
        parts.push(`<foreignObject x="${r2(bx)}" y="${r2(by)}" width="${w}" height="${h}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;width:${w}px;height:${h}px;justify-content:${justify};align-items:${alignItems};color:${p.color ?? "inherit"};font-size:${p.size ?? 14}px;line-height:1.1;white-space:nowrap">${tex(p.tex)}</div></foreignObject>`);
      } else {
        const anchor = ax < 0 ? "end" : ax > 0 ? "start" : "middle";
        const base = ay < 0 ? "text-after-edge" : ay > 0 ? "text-before-edge" : "central";
        parts.push(`<text x="${r2(x)}" y="${r2(y)}" fill="${p.color ?? "currentColor"}" font-size="${p.size ?? 14}" font-family="${esc(font)}" text-anchor="${anchor}" dominant-baseline="${base}"${p.plain ? "" : ` paint-order="stroke" stroke="#fff" stroke-width="3"`}>${esc(p.text)}</text>`);
      }
    }
  }
  return parts.join("");
}

/** A whole scene as a standalone SVG string. options: axes, background, tex, width/height (CSS size). */
export function sceneSVG(vp, layers, options = {}) {
  const { axes, background, width = vp.width, height = vp.height } = options;
  const prims = [...(axes ? axesPrimitives(vp, axes === true ? {} : axes) : []), ...primitives(vp, layers, options)];
  const bg = background ? `<rect width="${vp.width}" height="${vp.height}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vp.width} ${vp.height}" style="max-width:100%;height:auto">${bg}<g>${svgElements(prims, options)}</g></svg>`;
}
