// Zeros of f on an interval. The certified search is @ratmath/analytic's
// (adapted in features.js); this file keeps the float guesses for the quick
// stage, the exact sign test used to classify domain ends, and
// simplestBetween.

import { Rational } from "@ratmath/core";
import { compileFloat, paramsToFloat, paramsToRational, parse, toRational } from "./expr.js";
import * as I from "./interval.js";
import { Refinement } from "./refine.js";
import { zerosGenerator2 } from "./features.js";

/** The rational with the smallest denominator in [lo, hi] (Stern–Brocot descent). */
export function simplestBetween(lo, hi) {
  if (lo.greaterThan(hi)) [lo, hi] = [hi, lo];
  if (lo.numerator <= 0n && hi.numerator >= 0n) return new Rational(0n);
  if (hi.numerator < 0n) return simplestBetween(hi.negate(), lo.negate()).negate();
  // 0 < lo <= hi. Continued-fraction recursion on [p/q, r/s].
  const go = (p, q, r, s) => {
    const a = p / q; // floor, p, q > 0
    if (a * q === p) return [a, 1n]; // lo is an integer
    if ((a + 1n) * s <= r) return [a + 1n, 1n]; // an integer lies in (lo, hi]
    // Both in (a, a+1): x = a + 1/y with y in [s/(r - a s), q/(p - a q)].
    const [n, d] = go(s, r - a * s, q, p - a * q);
    return [a * n + d, n];
  };
  const [n, d] = go(lo.numerator, lo.denominator, hi.numerator, hi.denominator);
  return new Rational(n, d);
}

export function signAt(ctx, enclose, exact, P, rp, r) {
  // Sign of f at a rational point: exact when possible, else from an enclosure
  // that excludes 0 (raising precision a few times), else 0 meaning unknown.
  if (exact) {
    const v = exact(r, rp);
    if (v === null) return { sign: NaN, exact: true }; // f is undefined at r
    return { sign: v.numerator > 0n ? 1 : v.numerator < 0n ? -1 : 0, exact: true };
  }
  for (let extra = 0; extra <= 96; extra += 32) {
    const c = I.context(ctx.k + extra);
    const X = I.fromRational(c, r.numerator, r.denominator);
    const Pc = extra === 0 ? P : paramsToIntervals(c, rp);
    const y = enclose(c, X, Pc);
    if (!y) return { sign: NaN };
    // An enclosure of exactly [0, 0] at an exact point proves f(r) = 0.
    if (y.lo === 0n && y.hi === 0n) return { sign: 0, exact: true };
    if (y.lo > 0n) return { sign: 1 };
    if (y.hi < 0n) return { sign: -1 };
  }
  return { sign: 0, exact: false };
}

/** Generator form of findZeros: yields progress, returns the list. */
export const zerosGenerator = zerosGenerator2;

/** Synchronous: all zeros of f on [a, b], certified by @ratmath/analytic. */
export function findZeros(f, params, range, options) {
  const gen = zerosGenerator2(f, params, range, options);
  let s;
  while (!(s = gen.next()).done);
  return s.value;
}

/** Zeros as a Refinement: quick float guesses, then certified results (from analytic). */
export function zeros(f, params, range, options = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  return new Refinement(
    () => ({ value: floatZeros(ast, params, range, options), trust: "rough" }),
    function* () {
      return { value: yield* zerosGenerator2(ast, params, range, options), via: "analytic-roots" };
    },
  );
}

/** Float guesses: sign changes on a grid, refined by a few bisection steps. */
export function floatZeros(f, params, [a, b], { variable = "x", samples = 512 } = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  const fn = compileFloat(ast, variable);
  const p = paramsToFloat(paramsToRational(params));
  const lo = toRational(a).toNumber();
  const hi = toRational(b).toNumber();
  const out = [];
  let x0 = lo;
  let y0 = fn(x0, p);
  for (let i = 1; i <= samples; i++) {
    const x1 = lo + ((hi - lo) * i) / samples;
    const y1 = fn(x1, p);
    if (y0 === 0) out.push(x0);
    else if (Number.isFinite(y0) && Number.isFinite(y1) && y0 * y1 < 0) {
      let l = x0, r = x1, fl = y0;
      for (let k = 0; k < 50; k++) {
        const m = (l + r) / 2;
        const fm = fn(m, p);
        if (fm === 0) { l = r = m; break; }
        if (fm * fl < 0) r = m;
        else { l = m; fl = fm; }
      }
      // A huge jump is a pole, not a zero.
      const mid = fn((l + r) / 2, p);
      if (Math.abs(mid) < 1e-6 * (1 + Math.abs(y0) + Math.abs(y1))) out.push((l + r) / 2);
    }
    x0 = x1;
    y0 = y1;
  }
  if (y0 === 0) out.push(x0);
  return out;
}
