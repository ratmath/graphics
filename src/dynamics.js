// Pictures of dynamical systems: the pictures phase of @ratmath/chaos
// (phase 6).
//
//   cobwebFigure        y = f(x), y = x and the staircase of an orbit
//   orbitFigure         an orbit against time
//   returnMapFigure     (xₙ, xₙ₊ₖ) pairs: the shape a chaotic series hides
//   bifurcationFigure   the long-run values of a family against its parameter
//   escapeFigure        a classified pixel grid (Mandelbrot, Julia, Newton
//                       basins) with inside, outside and undecided kept apart
//   pointCloudFigure    an attractor or an IFS's points, in the plane
//   attractor3d         the same in space, through project3d
//   segmentsFigure      an L-system's turtle path (or any segments)
//   spacetimeFigure     an elementary automaton's rows, time downward
//   lifeFigure          a Life pattern's live cells
//   parameterFrames     one figure per parameter value, for animation
//
// Nothing here imports the chaos package: a map is a float function or
// anything with float(x) (chaos's IteratedMap), a pixel grid anything with
// width, height, kind and the ranges re, reHigh, im, imHigh.

import { figure, shapes, path, dot, text, image, extentOf, rampColor, CATEGORY, toNumber } from "./figure.js";
import { camera, points3d, project3d } from "./space.js";

const num = toNumber;
const floatOf = (m) => (typeof m === "function" ? m : typeof m?.float === "function" ? (x) => m.float(x) : null);
const pad = ([a, b], m = 0.05) => {
  const w = b - a || 1;
  return [a - w * m, b + w * m];
};

/**
 * A cobweb: the graph of f, the diagonal, and the orbit of x0 for n steps
 * as a staircase, over `range` (default the orbit's span). Floats: estimated.
 */
export function cobwebFigure(map, x0, n = 30, { range, samples = 300, title = "Cobweb" } = {}) {
  const f = floatOf(map);
  if (!f) throw new TypeError("expected a function or a map with float(x)");
  const xs = [num(x0)];
  for (let i = 0; i < n; i++) xs.push(f(xs[i]));
  const fin = xs.filter(Number.isFinite);
  const R = range ? range.map(num) : pad([Math.min(...fin), Math.max(...fin)], 0.15);
  const curve = [];
  for (let i = 0; i <= samples; i++) {
    const x = R[0] + ((R[1] - R[0]) * i) / samples;
    const y = f(x);
    curve.push([x, Number.isFinite(y) ? y : NaN]);
  }
  const stair = [[xs[0], R[0] < 0 && R[1] > 0 ? 0 : R[0]]];
  for (let i = 0; i < n && Number.isFinite(xs[i + 1]); i++) stair.push([xs[i], xs[i + 1]], [xs[i + 1], xs[i + 1]]);
  const out = [
    path([[R[0], R[0]], [R[1], R[1]]], { color: "#9ca3af", width: 1.2, dash: [5, 4] }),
    path(curve.filter((p) => Number.isFinite(p[1])), { color: CATEGORY[0], width: 2.2 }),
    path(stair, { color: CATEGORY[1], width: 1.4 }),
    dot([xs[0], stair[0][1]], { r: 4, color: CATEGORY[1] }),
  ];
  return figure({ layers: [shapes(out)], x: R, y: R, axes: true, equal: true, status: "estimated", title, orbit: xs });
}

/** An orbit (a list of values, or map and x0) against step number. */
export function orbitFigure(mapOrValues, x0, n = 60, { title = "Orbit" } = {}) {
  let xs;
  if (Array.isArray(mapOrValues)) xs = mapOrValues.map(num);
  else {
    const f = floatOf(mapOrValues);
    xs = [num(x0)];
    for (let i = 0; i < n; i++) xs.push(f(xs[i]));
  }
  const pts = xs.map((x, i) => [i, x]);
  return figure({ layers: [shapes([path(pts, { color: CATEGORY[0], width: 1.2, alpha: 0.6 }), ...pts.map((p) => dot(p, { r: 2.5, color: CATEGORY[0] }))])], axes: true, status: "estimated", title, orbit: xs });
}

/** The pairs (xₙ, xₙ₊lag) of a series: a return map. */
export function returnMapFigure(values, { lag = 1, title = "Return map" } = {}) {
  const v = values.map(num);
  const pts = [];
  for (let i = 0; i + lag < v.length; i++) pts.push([v[i], v[i + lag]]);
  return figure({ layers: [shapes(pts.map((p) => dot(p, { r: 1.8, color: CATEGORY[0], width: 0.5 })))], axes: true, equal: true, status: "estimated", title });
}

/**
 * A bifurcation diagram from columns [{ parameter, points: [x, …] }] (chaos's
 * bifurcationDiagram), one dot per long-run value. Marks may be added at
 * certified bifurcation points: marks: [{ at, label }].
 */
export function bifurcationFigure(diagram, { marks = [], title = "Bifurcation diagram" } = {}) {
  const cols = diagram.columns ?? diagram;
  const pts = [];
  for (const c of cols) for (const x of c.points) pts.push(num(c.parameter), num(x));
  const ext = extentOf([{ kind: "points", data: pts }]);
  const Y = pad(ext.y, 0.08);
  const out = [];
  for (let i = 0; i < pts.length; i += 2) out.push(dot([pts[i], pts[i + 1]], { r: 0.9, color: "#1e293b", width: 0 }));
  for (const m of marks) {
    const a = num(m.at);
    out.push(path([[a, Y[0]], [a, Y[1]]], { color: CATEGORY[1], width: 1, dash: [4, 3] }));
    if (m.label) out.push(text([a, Y[1]], m.label, { anchor: "s", label: m.label, color: CATEGORY[1], size: 11 }));
  }
  return figure({ layers: [shapes(out)], x: pad(ext.x, 0.02), y: Y, axes: true, status: "estimated", title });
}

/**
 * A classified pixel grid as a picture. kind 0 is undecided, 1 inside, 2
 * outside; for Newton basins, k + 1 is root k (labels set). Outside pixels
 * are shaded by escape time when the grid has it. Undecided pixels get their
 * own colour, so the picture never claims more than was proved: certified.
 */
export function escapeFigure(grid, { inside = "#111827", undecided = "#f97316", outside, title = grid.name ?? "Escape-time picture" } = {}) {
  const { width, height, kind } = grid;
  const X = [num(grid.re), num(grid.reHigh)];
  const Y = [num(grid.im), num(grid.imHigh)];
  const cells = new Array(width * height);
  const maxEsc = grid.escape ? Math.max(1, ...Array.from(grid.escape).filter((e) => e > 0)) : 1;
  for (let i = 0; i < width * height; i++) {
    const k = kind[i];
    if (k === 0) cells[i] = undecided;
    else if (grid.labels) cells[i] = CATEGORY[(k - 1) % CATEGORY.length];
    else if (k === 1) cells[i] = inside;
    else cells[i] = outside ?? (grid.escape ? rampColor(0.15 + 0.85 * (1 - Math.log(grid.escape[i] + 1) / Math.log(maxEsc + 1))) : "#e0e7ff");
  }
  const counts = grid.counts ?? null;
  return figure({ layers: [image({ x: X, y: Y, width, height, cells })], x: X, y: Y, equal: true, axes: true, status: "certified", title, notes: counts ? [Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")] : [], size: { width: Math.min(900, width * 6), height: Math.min(900, width * 6) * (Y[1] - Y[0]) / (X[1] - X[0]) } });
}

/** Points in the plane (an attractor, an IFS stage): [[x, y], …] or a flat list. */
export function pointCloudFigure(points, { r = 1, color = CATEGORY[0], title = "", status = "estimated", equal = true } = {}) {
  const P = Array.isArray(points[0]) ? points.map((p) => p.map(num)) : Array.from({ length: points.length / 2 }, (_, i) => [num(points[2 * i]), num(points[2 * i + 1])]);
  return figure({ layers: [shapes(P.map((p) => dot(p, { r, color, width: 0 })))], equal, status, title, axes: true, count: P.length });
}

/** Points in space (a Lorenz-type attractor) projected by a camera. */
export function attractor3d(points, { cam = camera({ azimuth: 40, elevation: 20 }), radius = 1.2, title = "", axes = true } = {}) {
  const mesh = project3d(cam, [{ item: points3d(points.map((p) => p.map(num))), radius, color: CATEGORY[0] }], { axes });
  return figure({ layers: [mesh], x: [-1.9, 1.9], y: [-1.5, 1.5], equal: true, status: "estimated", title });
}

/**
 * Segments [[x1, y1, x2, y2], …] (an L-system's turtle path; chaos's
 * LSystem.turtle(n) gives { segments, exact }). Exact when `exact` end
 * points are given and the figure only places them (they are drawn as
 * doubles of exact values).
 */
export function segmentsFigure(turtleOrSegments, { color = CATEGORY[2], width = 1.2, title = "" } = {}) {
  const segs = turtleOrSegments.segments ?? turtleOrSegments;
  const flat = Float64Array.from(segs.flatMap((s) => s.map(num)));
  return figure({ layers: [{ item: { kind: "segments", segments: flat }, color, width, alpha: 1 }], equal: true, status: turtleOrSegments.exact ? "exact" : "estimated", title, count: segs.length });
}

/** Rows of 0/1 cells (an elementary automaton's run), time going down. Exact. */
export function spacetimeFigure(rows, { on = "#111827", off = null, title = "" } = {}) {
  const h = rows.length;
  const w = rows[0].length;
  const cells = new Array(w * h).fill(off);
  rows.forEach((row, t) => {
    for (let i = 0; i < w; i++) if (row[i]) cells[(h - 1 - t) * w + i] = on;
  });
  return figure({ layers: [image({ x: [0, w], y: [-h, 0], width: w, height: h, cells })], x: [0, w], y: [-h, 0], equal: true, status: "exact", title, size: { width: Math.min(900, 6 * w), height: Math.min(900, 6 * w) * (h / w) } });
}

/** A Life pattern (chaos's Life, or [[x, y], …] live cells): one square per live cell, y downward. Exact. */
export function lifeFigure(pattern, { color = "#111827", title = "" } = {}) {
  const cells = pattern.cells instanceof Set ? [...pattern.cells].map((k) => String(k).split(",").map(Number)) : pattern.map((p) => p.map(num));
  const out = cells.map(([x, y]) => path([[x, -y], [x + 1, -y], [x + 1, -y - 1], [x, -y - 1]], { closed: true, fill: color, stroke: null }));
  const ext = extentOf([shapes(out)]) ?? { x: [0, 1], y: [-1, 0] };
  return figure({ layers: [shapes(out)], x: [ext.x[0] - 1, ext.x[1] + 1], y: [ext.y[0] - 1, ext.y[1] + 1], equal: true, status: "exact", title, population: cells.length });
}

/** One figure per parameter value, from build(value): the frames of an animation in the parameter. */
export function parameterFrames(values, build) {
  const frames = values.map((v, i) => {
    const f = build(v, i);
    return f;
  });
  return Object.freeze({ kind: "frames", frames, steps: values });
}
