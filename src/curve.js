// Parametric and polar curves.
//
//   parametric({ x: "cos(3t)", y: "sin(2t)" }, {}, [0, "44/7"], vp)
//   polar("1 + cos(t)", {}, [0, "44/7"], vp)
//
// Both return a Refinement. `quick` is a float polyline. The exact stage is a
// "cells" frame, the same kind a certified graph uses, so every renderer
// draws it: each lit pixel provably touches the curve's enclosure, and every
// point of the curve for t in the range lies in a lit pixel.
//
// The certified stage bisects the parameter range. On a piece T it encloses
// (x(T), y(T)) with interval arithmetic; a box that misses the screen is
// dropped, a box no larger than a pixel is lit, and anything else is split.

import { Refinement } from "./refine.js";
import { compileFloat, compileInterval, op, call, v, paramsToFloat, paramsToIntervals, paramsToRational, parse, toRational } from "./expr.js";
import * as I from "./interval.js";
import { precisionFor, rowSpan, toPixelX, toPixelY, viewport as makeViewport } from "./viewport.js";

const asAst = (f) => (typeof f === "string" ? parse(f) : f);
const asViewport = (vp) => (vp && vp.f ? vp : makeViewport(vp));

/** Pixel columns (left, right inclusive, clipped) that the x-interval touches, or null when it misses the screen. */
function colSpan(ctx, vp, iv) {
  if (!iv) return null;
  const W = vp.width;
  const span = vp.xmax.subtract(vp.xmin);
  const colOf = (X) => {
    if (X === -Infinity) return -1;
    if (X === Infinity) return W;
    // (X/2^k − xmin) · W / span, with xmin = a/b and span = c/d
    const a = vp.xmin.numerator;
    const b = vp.xmin.denominator;
    const num = (X * b - a * ctx.one) * BigInt(W) * span.denominator;
    const den = b * span.numerator * ctx.one;
    const r = I.floorDiv(num, den);
    if (r < -1n) return -1;
    if (r > BigInt(W)) return W;
    return Number(r);
  };
  let left = colOf(iv.lo);
  let right = colOf(iv.hi);
  if (right < 0 || left >= W) return null;
  if (left < 0) left = 0;
  if (right >= W) right = W - 1;
  return [left, right];
}

/** Float preview: a polyline in pixel coordinates with NaN pairs at breaks. */
export function sampleParametric(curve, params, range, vp, { variable = "t", samples } = {}) {
  vp = asViewport(vp);
  const fx = compileFloat(asAst(curve.x), variable);
  const fy = compileFloat(asAst(curve.y), variable);
  const p = paramsToFloat(paramsToRational(params));
  const t0 = toRational(range[0]).toNumber();
  const t1 = toRational(range[1]).toNumber();
  const n = samples ?? Math.max(600, 2 * (vp.width + vp.height));
  const pts = [];
  const clamp = (q) => Math.max(-1e5, Math.min(1e5, q));
  let pen = false;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const x = fx(t, p);
    const y = fy(t, p);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (pen) pts.push(NaN, NaN);
      pen = false;
      continue;
    }
    pts.push(clamp(toPixelX(vp, x)), clamp(toPixelY(vp, y)));
    pen = true;
  }
  return { kind: "polyline", points: Float64Array.from(pts), asymptotes: [] };
}

/** Certified cells of a parametric curve (generator: yields progress, returns { value, via }). */
export function* certifyParametric(curve, params, range, vp, { variable = "t", maxDepth = 40, maxBoxes = 400000, pieces = 64 } = {}) {
  vp = asViewport(vp);
  const ctx = I.context(precisionFor(vp));
  const ex = compileInterval(asAst(curve.x), variable);
  const ey = compileInterval(asAst(curve.y), variable);
  const P = paramsToIntervals(ctx, paramsToRational(params));
  const W = vp.width;
  const H = vp.height;
  const lit = new Uint8Array(W * H);
  const a = toRational(range[0]);
  const b = toRational(range[1]);
  if (!a.lessThan(b)) throw new RangeError("a parametric curve needs a parameter range [t0, t1] with t0 < t1");
  const lo = I.floorDiv(a.numerator << ctx.K, a.denominator);
  const hi = I.ceilDiv(b.numerator << ctx.K, b.denominator);
  // start from equal pieces so progress is visible and long ranges split early
  const stack = [];
  for (let i = pieces - 1; i >= 0; i--) {
    const l = lo + ((hi - lo) * BigInt(i)) / BigInt(pieces);
    const h = lo + ((hi - lo) * BigInt(i + 1)) / BigInt(pieces);
    stack.push([l, h, 0, i]);
  }
  let boxes = 0;
  let tight = true;
  let done = 0;
  const light = (cs, rs) => {
    for (let i = cs[0]; i <= cs[1]; i++) for (let j = rs[0]; j <= rs[1]; j++) lit[j * W + i] = 1;
  };
  while (stack.length) {
    const [l, h, depth, piece] = stack.pop();
    if (depth === 0 && piece > done) {
      done = piece;
      yield { done, of: pieces, step: "curve" };
    }
    boxes++;
    const T = { lo: l, hi: h };
    let X = null;
    let Y = null;
    try {
      X = ex(ctx, T, P);
      Y = X && ey(ctx, T, P);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      X = Y = I.WHOLE;
    }
    if (!X || !Y) continue; // not defined anywhere on this piece
    const cs = colSpan(ctx, vp, X);
    const rs = cs && rowSpan(ctx, vp, Y);
    if (!cs || !rs) continue; // off screen
    const small = cs[1] - cs[0] <= 1 && rs[1] - rs[0] <= 1;
    const atEnd = depth >= maxDepth || h - l <= 1n || boxes >= maxBoxes;
    if (small || atEnd) {
      if (!small) tight = false;
      light(cs, rs);
      continue;
    }
    const m = (l + h) >> 1n;
    stack.push([m, h, depth + 1, piece], [l, m, depth + 1, piece]);
  }
  const columns = new Array(W);
  for (let i = 0; i < W; i++) {
    const s = [];
    let j = 0;
    while (j < H) {
      if (!lit[j * W + i]) {
        j++;
        continue;
      }
      const top = j;
      while (j < H && lit[j * W + i]) j++;
      s.push(top, j - 1);
    }
    columns[i] = s.length ? s : undefined;
  }
  return {
    value: { kind: "cells", width: W, height: H, columns, tight, complete: true, evaluations: boxes, asymptotes: [], holes: [], undefined: [] },
    via: "interval-boxes",
  };
}

/**
 * A parametric curve (x(t), y(t)) for t in [t0, t1] as a Refinement.
 * Options: variable ("t"), samples (quick stage), maxDepth, maxBoxes.
 */
export function parametric(curve, params, range, vp, options = {}) {
  const c = { x: asAst(curve.x), y: asAst(curve.y) };
  const view = asViewport(vp);
  return new Refinement(
    () => ({ value: sampleParametric(c, params, range, view, options), trust: "rough" }),
    () => certifyParametric(c, params, range, view, options),
  );
}

/** A polar curve r = r(θ) for θ in [θ0, θ1]: the parametric curve (r cos θ, r sin θ). */
export function polar(r, params, range, vp, options = {}) {
  const name = options.variable ?? "t";
  const R = asAst(r);
  return parametric({ x: op("*", R, call("cos", v(name))), y: op("*", R, call("sin", v(name))) }, params, range, vp, { ...options, variable: name });
}
