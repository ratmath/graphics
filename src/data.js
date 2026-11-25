// Data plots, slope fields and certified ODE solution curves. Each returns a
// frame that the scene renderers draw (canvas, SVG, TikZ, PDF, PNG, ASCII).
//
//   scatter([[1, 2], [2, 3.5]])                     dots (join: true connects them)
//   bars([[1, 4], [2, 7]])                          one bar per [x, height]
//   histogram([2.1, 2.4, 3.3, ...], { bins: 8 })    counts per bin
//   slopeField("x - y", {}, vp)                     short segments of slope f(x, y)
//   solutionCurve({ f: "x - y", y0: 1, t0: 0, until: 3 }, vp)
//                                                   Refinement: RK4 polyline, then cells
//                                                   that provably hold the solution
//
// Data frames hold floating-point world coordinates: data is measured, not
// exact, so nothing here is a proof except solutionCurve's exact stage.

import { RationalInterval } from "@ratmath/core";
import { ode } from "@ratmath/analytic";
import { Refinement } from "@ratmath/core/refine";
import { compileFloat, paramsToFloat, paramsToRational, parse, toRational, toAst } from "./expr.js";
import * as I from "./interval.js";
import { columnRationals, precisionFor, rowSpan, toPixelX, toPixelY, viewport as makeViewport } from "./viewport.js";

const asAst = (f) => (toAst(f));
const asViewport = (vp) => (vp && vp.f ? vp : makeViewport(vp));
const numberOf = (x) => (typeof x === "number" ? x : toRational(x).toNumber());

function pairs(data) {
  const out = new Float64Array(data.length * 2);
  data.forEach((d, i) => {
    const [x, y] = Array.isArray(d) ? d : [d.x, d.y];
    out[2 * i] = numberOf(x);
    out[2 * i + 1] = numberOf(y);
  });
  return out;
}

/** Points [[x, y], ...] (or { x, y }) as dots; `join: true` also connects them in order. */
export function scatter(data, { join = false } = {}) {
  return { kind: "points", data: pairs(data), join };
}

/** Bars from [[x, height], ...]: each centred at x, `width` wide (default 80% of the smallest gap), from `baseline`. */
export function bars(data, { width, baseline = 0 } = {}) {
  const p = pairs(data);
  const xs = [];
  for (let i = 0; i < p.length; i += 2) xs.push(p[i]);
  const sorted = [...xs].sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] > sorted[i - 1]) gap = Math.min(gap, sorted[i] - sorted[i - 1]);
  const w = width !== undefined ? numberOf(width) : Number.isFinite(gap) ? 0.8 * gap : 1;
  const rects = new Float64Array(p.length * 2);
  for (let i = 0; i < p.length; i += 2) rects.set([p[i] - w / 2, p[i] + w / 2, baseline, p[i + 1]], 2 * i);
  return { kind: "bars", bars: rects };
}

/**
 * Histogram of a list of values: `bins` equal bins over `range` (default the
 * data's own span). A value on an inner edge goes to the bin on its right;
 * the last bin includes its right end. Returns a bars frame with `edges`
 * and `counts`; `density: true` scales heights so the total area is 1.
 */
export function histogram(values, { bins = 10, range, density = false } = {}) {
  const v = values.map(numberOf);
  const lo = range ? numberOf(range[0]) : Math.min(...v);
  let hi = range ? numberOf(range[1]) : Math.max(...v);
  if (!(hi > lo)) hi = lo + 1;
  const counts = new Array(bins).fill(0);
  let used = 0;
  for (const x of v) {
    if (x < lo || x > hi) continue;
    counts[Math.min(bins - 1, Math.floor(((x - lo) / (hi - lo)) * bins))]++;
    used++;
  }
  const w = (hi - lo) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  const rects = new Float64Array(bins * 4);
  counts.forEach((c, i) => rects.set([edges[i], edges[i + 1], 0, density && used ? c / (used * w) : c], 4 * i));
  return { kind: "bars", bars: rects, edges, counts };
}

/**
 * Slope field of y′ = f(x, y): a short segment through each grid point with
 * slope f there. `spacing` is the grid step in pixels, `length` the segment
 * length as a fraction of it. Names: `variables: ["x", "y"]`.
 */
export function slopeField(f, params, vp, { spacing = 24, length = 0.6, variables = ["x", "y"] } = {}) {
  vp = asViewport(vp);
  const [xn, yn] = variables;
  const fn = compileFloat(asAst(f), xn);
  const p = { ...paramsToFloat(paramsToRational(params)) };
  const nx = Math.max(1, Math.floor(vp.width / spacing));
  const ny = Math.max(1, Math.floor(vp.height / spacing));
  const half = (spacing * length) / 2;
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const px = ((i + 0.5) * vp.width) / nx;
      const py = ((j + 0.5) * vp.height) / ny;
      const x = vp.f.xmin + px * vp.f.dx;
      const y = vp.f.ymax - py * vp.f.dy;
      p[yn] = y;
      const m = fn(x, p);
      if (Number.isNaN(m)) continue;
      // direction in pixels: (1, −m·dx/dy), or straight up for an infinite slope
      let ux = 1;
      let uy = Number.isFinite(m) ? (-m * vp.f.dx) / vp.f.dy : -1;
      if (!Number.isFinite(m)) ux = 0;
      const n = Math.hypot(ux, uy);
      ux = (ux / n) * half;
      uy = (uy / n) * half;
      const wx = (q) => vp.f.xmin + q * vp.f.dx;
      const wy = (q) => vp.f.ymax - q * vp.f.dy;
      out.push(wx(px - ux), wy(py - uy), wx(px + ux), wy(py + uy));
    }
  }
  return { kind: "segments", segments: Float64Array.from(out) };
}

/**
 * The solution of y′ = f(t, y), y(t0) = y0 as a curve. `spec` is what
 * analytic's ode.solve takes (f, y0, t0, until, params, time, …; one
 * equation). quick: the RK4 polyline. exact: a cells frame in which every
 * lit pixel column span provably holds the solution over that column;
 * `complete` is false when the solver stopped early (blow-up), with `reason`.
 */
export function solutionCurve(spec, vp) {
  const view = asViewport(vp);
  const job = ode.solve({ t0: 0, ...spec });
  return new Refinement(
    () => {
      const q = job.quick.value;
      const pts = [];
      if (q) for (let i = 0; i < q.t.length; i++) pts.push(toPixelX(view, q.t[i]), Math.max(-1e5, Math.min(1e5, toPixelY(view, q.y[i]))));
      return { value: { kind: "polyline", points: Float64Array.from(pts), asymptotes: [] }, trust: "rough" };
    },
    function* () {
      const sol = job.exact();
      const ctx = I.context(precisionFor(view));
      const columns = new Array(view.width);
      const lo = sol.t0.lessThan(sol.t1) ? sol.t0 : sol.t1;
      const hi = sol.t0.lessThan(sol.t1) ? sol.t1 : sol.t0;
      for (let i = 0; i < view.width; i++) {
        const [ca, cb] = columnRationals(view, i);
        const a = ca.lessThan(lo) ? lo : ca;
        const b = cb.greaterThan(hi) ? hi : cb;
        if (a.greaterThan(b)) continue;
        // the solution's enclosure over this column's whole stretch of t
        const piece = sol.at(a.equals(b) ? a : new RationalInterval(a, b));
        const iv = { lo: I.floorDiv(piece.low.numerator << ctx.K, piece.low.denominator), hi: I.ceilDiv(piece.high.numerator << ctx.K, piece.high.denominator) };
        const span = rowSpan(ctx, view, iv);
        if (span) columns[i] = span;
        if (i % 16 === 0) yield { done: i, of: view.width, step: "column" };
      }
      return {
        value: { kind: "cells", width: view.width, height: view.height, columns, tight: true, complete: sol.complete, reason: sol.reason ?? null, asymptotes: [], holes: [], undefined: [], final: sol.complete ? sol.final : null },
        via: "validated-ode",
      };
    },
  );
}
