// Graphs of y = f(x), at two levels of sharpness.
//
// Float stage ("float"): one double-precision sample per sub-pixel step, kept
// as a polyline in pixel coordinates with breaks where the function is
// undefined or jumps off screen. Microseconds to a few milliseconds; this is
// what a slider drag shows.
//
// Exact stage ("exact"): for every pixel column the exact x-interval is fed
// through certified interval arithmetic, bisecting where that tightens the
// result. The output lists, per column, the pixel rows the graph can touch.
// Guarantee: every point (x, f(x)) of the graph inside the viewport lies in a
// listed cell. A cell that is not listed contains no point of the graph. The
// work yields after each column so it can run in time slices, and each
// progress tick carries the columns finished so far.

import { Refinement } from "./refine.js";
import { compileFloat, compileInterval, paramsToFloat, paramsToIntervals, paramsToRational, parse } from "./expr.js";
import * as I from "./interval.js";
import { columnInterval, precisionFor, rowSpan, toPixelX, toPixelY, viewport as makeViewport } from "./viewport.js";
import { denominators, polesGenerator } from "./features.js";
import { floatZeros } from "./roots.js";
import { Rational } from "@ratmath/core";
import { fn as analyticFn } from "@ratmath/analytic";

const compiled = new WeakMap();

function compile(ast, variable) {
  let c = compiled.get(ast);
  if (!c || c.variable !== variable) {
    c = { variable, float: compileFloat(ast, variable), interval: compileInterval(ast, variable) };
    compiled.set(ast, c);
  }
  return c;
}

function asAst(f) {
  return typeof f === "string" ? parse(f) : f;
}

const regular = new WeakMap();
/** The tree with holes of its rational summands cancelled (or the tree itself). */
function regularAst(ast, params, variable) {
  const key = JSON.stringify([variable, Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])]);
  let m = regular.get(ast);
  if (!m) regular.set(ast, (m = new Map()));
  if (!m.has(key)) {
    let r = ast;
    try {
      r = analyticFn(ast, { variable, params: params ?? {} }).regular().ast;
    } catch {
      r = ast; // anything analytic cannot read is enclosed as written
    }
    m.set(key, r);
  }
  return m.get(key);
}

function asViewport(vp) {
  return vp && vp.dx ? vp : makeViewport(vp);
}

/**
 * Float preview of y = f(x): a polyline in pixel coordinates.
 * Returns { kind: "polyline", points: Float64Array [px0, py0, px1, py1, ...],
 * with NaN pairs marking breaks }.
 */
export function sampleFloat(f, params, vp, { samplesPerPixel = 1, variable = "x" } = {}) {
  const ast = asAst(f);
  vp = asViewport(vp);
  const fn = compile(ast, variable).float;
  const p = paramsToFloat(paramsToRational(params));
  const n = Math.max(2, Math.ceil(vp.width * samplesPerPixel) + 1);
  const pts = new Float64Array(2 * n + 2 * n); // room for break markers
  const H = vp.height;
  let k = 0;
  let prev = NaN;
  const step = vp.width / (n - 1);
  for (let i = 0; i < n; i++) {
    const px = i * step;
    const x = vp.f.xmin + px * vp.f.dx;
    const y = fn(x, p);
    if (!Number.isFinite(y)) {
      if (k > 0 && !Number.isNaN(pts[k - 2])) {
        pts[k++] = NaN;
        pts[k++] = NaN;
      }
      prev = NaN;
      continue;
    }
    const py = toPixelY(vp, y);
    // Neighbouring samples on opposite sides beyond the screen: treat as a
    // pole and break the line rather than draw a vertical bar through it.
    if (!Number.isNaN(prev) && ((py < 0 && prev > H) || (py > H && prev < 0))) {
      pts[k++] = NaN;
      pts[k++] = NaN;
    }
    pts[k++] = px;
    pts[k++] = clampPx(py, H);
    prev = py;
  }
  // Where a denominator crosses zero, mark a (float, unproven) asymptote.
  const asymptotes = [];
  for (const { D } of denominators(ast)) {
    for (const x of floatZeros(D, params, [vp.f.xmin, vp.f.xmax], { variable, samples: Math.max(64, vp.width >> 2) })) {
      asymptotes.push({ px: toPixelX(vp, x), certain: false });
    }
  }
  return { kind: "polyline", points: pts.slice(0, k), asymptotes };
}

function clampPx(py, H) {
  // Keep coordinates in a range canvases draw reliably.
  const lim = 4 * H + 1000;
  return py < -lim ? -lim : py > lim ? lim : py;
}

/**
 * Certified enclosure of the graph over one pixel column.
 * Returns { spans: [top, bot, top, bot, ...] (merged, inclusive rows),
 * tight: boolean, evaluations: number }.
 */
function certifyColumn(ctx, vp, enclose, P, X, { maxDepth }) {
  const spans = [];
  let tight = true;
  let evaluations = 0;
  const span = (iv) => {
    evaluations++;
    let y;
    try {
      y = enclose(ctx, iv, P);
    } catch (e) {
      if (e instanceof RangeError) y = I.WHOLE;
      else throw e;
    }
    return rowSpan(ctx, vp, y);
  };
  // Depth-first bisection. Stop when the rows touched are at most 2, or
  // splitting no longer reduces the number of rows covered.
  const visit = (iv, rows, depth) => {
    if (!rows) return;
    const count = rows[1] - rows[0] + 1;
    if (count <= 2) {
      spans.push(rows[0], rows[1]);
      return;
    }
    if (depth >= maxDepth || iv.hi - iv.lo < 2n) {
      tight = false;
      spans.push(rows[0], rows[1]);
      return;
    }
    const mid = (iv.lo + iv.hi) >> 1n;
    const L = { lo: iv.lo, hi: mid };
    const R = { lo: mid, hi: iv.hi };
    const rl = span(L);
    const rr = span(R);
    const covered = coveredRows(rl, rr);
    if (covered >= count - 1 && depth >= 1) {
      // Splitting did not help; accept the children as they are.
      if (rl) spans.push(rl[0], rl[1]);
      if (rr) spans.push(rr[0], rr[1]);
      return;
    }
    visit(L, rl, depth + 1);
    visit(R, rr, depth + 1);
  };
  visit(X, span(X), 0);
  return { spans: mergeSpans(spans), tight, evaluations };
}

function coveredRows(a, b) {
  if (!a && !b) return 0;
  if (!a) return b[1] - b[0] + 1;
  if (!b) return a[1] - a[0] + 1;
  const lo = Math.min(a[0], b[0]);
  const hi = Math.max(a[1], b[1]);
  const gap = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[1], b[1]) - 1);
  return hi - lo + 1 - gap;
}

function mergeSpans(flat) {
  if (flat.length <= 2) return flat;
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
  pairs.sort((a, b) => a[0] - b[0]);
  const out = [pairs[0][0], pairs[0][1]];
  for (let i = 1; i < pairs.length; i++) {
    const [t, b] = pairs[i];
    if (t <= out[out.length - 1] + 1) {
      if (b > out[out.length - 1]) out[out.length - 1] = b;
    } else out.push(t, b);
  }
  return out;
}

/**
 * Generator for the certified graph. Yields after each column with
 * { done, of, step: "column", partial } where partial is the frame so far,
 * and returns { value: frame, via: "interval-columns" }.
 */
export function* certifyGraph(f, params, vp, { variable = "x", maxDepth = 8, extraBits = 12, partialEvery = 16, asymptotes = true } = {}) {
  const ast = asAst(f);
  vp = asViewport(vp);
  // Removable singularities (holes) of the rational part are cancelled first:
  // (x^2 - 1)/(x - 1) is enclosed as x + 1, which equals it wherever it is
  // defined. Otherwise every column whose x-interval touches the hole would
  // be the whole column. At the hole itself the cells hold the limit, the
  // closure of the graph; the hole is still reported in frame.holes.
  const enclose = compile(regularAst(ast, params, variable), variable).interval;
  const ctx = I.context(precisionFor(vp, extraBits));
  const P = paramsToIntervals(ctx, paramsToRational(params));
  const columns = new Array(vp.width);
  const frame = { kind: "cells", width: vp.width, height: vp.height, columns, tight: true, evaluations: 0, complete: false, asymptotes: [], holes: [] };
  for (let i = 0; i < vp.width; i++) {
    const X = columnInterval(ctx, vp, i);
    const r = certifyColumn(ctx, vp, enclose, P, X, { maxDepth });
    columns[i] = r.spans;
    frame.evaluations += r.evaluations;
    if (!r.tight) frame.tight = false;
    yield { done: i + 1, of: vp.width, step: "column", partial: (i + 1) % partialEvery === 0 ? frame : undefined };
  }
  if (asymptotes) {
    // Vertical asymptotes, located to well under a pixel.
    const tolerance = vp.dx.divide(new Rational(16n));
    const poles = yield* polesGenerator(ast, params, [vp.xmin, vp.xmax], { variable, tolerance });
    // Poles and holes come from @ratmath/analytic (see features.js).
    const at = (p) => toPixelX(vp, p.lo.add(p.hi).divide(new Rational(2n)).toNumber());
    frame.holes = [];
    frame.asymptotes = [];
    for (const p of poles) {
      if (p.kind === "hole") frame.holes.push({ ...p, px: at(p) });
      else frame.asymptotes.push({ ...p, px: at(p) });
    }
  }
  frame.complete = true;
  return { value: frame, via: "interval-columns" };
}

/**
 * A graph of y = f(x) as a Refinement: `quick` is the float polyline,
 * `exact()` / `settle()` give the certified cell frame.
 *
 *   const g = graph("a*sin(x)", { a: "3/2" }, { x: [-5, 5], y: [-3, 3], width: 600, height: 360 });
 *   draw(g.quick.value);              // immediate
 *   draw(await g.settle());           // certified
 */
export function graph(f, params, vp, options = {}) {
  const ast = asAst(f);
  const view = asViewport(vp);
  return new Refinement(
    () => {
      const value = sampleFloat(ast, params, view, options);
      return { value, trust: "rough" };
    },
    () => certifyGraph(ast, params, view, options),
  );
}
