// Zeros of f on an interval, certified.
//
// Each result is one of:
//   { kind: "exact",  at: Rational }                  f(at) = 0 exactly (rational-only f)
//   { kind: "sign-change", lo: Rational, hi: Rational } f is continuous on [lo, hi] and changes sign:
//                                                     a zero is certainly inside
//   { kind: "possible", lo, hi }                       enclosure contains 0 but no proof either way
//                                                     (a pole of a non-rational f, a near-touch)
//   { kind: "zero-interval", lo, hi }                  f is identically 0 on [lo, hi]
//   { kind: "undefined", at, lo, hi }                  rational-only f is undefined at `at` (a pole);
//                                                     no zero is proven in [lo, hi]
// Intervals with no listed result certainly contain no zero.

import { Rational } from "@ratmath/core";
import { compileExact, compileFloat, compileInterval, integerExponent, paramsToFloat, paramsToIntervals, paramsToRational, parse, toRational } from "./expr.js";
import * as I from "./interval.js";
import { Refinement } from "./refine.js";

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

/**
 * Generator form of findZeros (yields progress, returns { value, via }).
 * `tolerance` is the width at which sign-change brackets stop narrowing.
 */
export function* zerosGenerator(f, params, [a, b], { variable = "x", tolerance = "1/1000000", pieces = 64, maxDepth = 40, budget = 20000 } = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  const lo0 = toRational(a);
  const hi0 = toRational(b);
  const tol = toRational(tolerance);
  const enclose = compileInterval(ast, variable);
  const exact = compileExact(ast, variable);
  const rp = paramsToRational(params);
  // Precision: enough to resolve the tolerance comfortably.
  const bits = I.bitLength(tol.denominator) - I.bitLength(tol.numerator) + 24;
  const ctx = I.context(Math.max(32, bits));
  const P = paramsToIntervals(ctx, rp);
  const results = [];
  const seenExact = new Set();
  const addExact = (r) => {
    const key = r.toString();
    if (!seenExact.has(key)) {
      seenExact.add(key);
      results.push({ kind: "exact", at: r });
    }
  };
  const addUndefined = (r) => {
    const key = "u" + r.toString();
    if (!seenExact.has(key)) {
      seenExact.add(key);
      results.push({ kind: "undefined", at: r, lo: r, hi: r });
    }
  };
  const step = hi0.subtract(lo0).divide(new Rational(pieces));
  const two = new Rational(2);

  let spent = 0;
  const work = (lo, hi, sLo, sHi, depth) => {
    if (++spent > budget) {
      // Out of budget (f may vanish on a whole stretch): say so honestly.
      results.push({ kind: "possible", lo, hi });
      return;
    }
    if (sLo.sign === 0 && sLo.exact) addExact(lo);
    if (sHi.sign === 0 && sHi.exact) addExact(hi);
    if (Number.isNaN(sLo.sign) && sLo.exact) addUndefined(lo);
    if (Number.isNaN(sHi.sign) && sHi.exact) addUndefined(hi);
    const X = I.fromBounds(ctx, lo.numerator, lo.denominator, hi.numerator, hi.denominator);
    let y;
    I.resetClipped();
    try {
      y = enclose(ctx, X, P);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      y = I.WHOLE;
    }
    const clipped = I.wasClipped();
    if (!y) return; // undefined on the whole piece
    if (!I.containsZero(y)) return; // certainly no zero
    if (y.lo === 0n && y.hi === 0n && !clipped) {
      // The enclosure is exactly 0: f vanishes on the whole piece.
      results.push({ kind: "zero-interval", lo, hi });
      return;
    }
    if (hi.subtract(lo).lessThan(tol)) {
      // Near a zero, rounding can make an enclosure touch 0; try once more
      // with 64 extra bits before treating the piece as a candidate.
      const c2 = I.context(ctx.k + 64);
      const y2 = enclose(c2, I.fromBounds(c2, lo.numerator, lo.denominator, hi.numerator, hi.denominator), paramsToIntervals(c2, rp));
      if (!y2 || !I.containsZero(y2)) return;
    }
    const finite = I.isFinite(y.lo) && I.isFinite(y.hi);
    const strictSigns = sLo.sign * sHi.sign < 0;
    const width = hi.subtract(lo);
    if (strictSigns && finite && !width.greaterThan(tol)) {
      results.push({ kind: "sign-change", lo, hi });
      return;
    }
    if (depth >= maxDepth || !width.greaterThan(tol.divide(new Rational(1024)))) {
      if (strictSigns && finite) results.push({ kind: "sign-change", lo, hi });
      else if (!(sLo.exact && sLo.sign === 0) && !(sHi.exact && sHi.sign === 0)) results.push({ kind: "possible", lo, hi });
      return;
    }
    // Split at the simplest rational inside (so zeros like 2 or 1/3 are hit
    // exactly), else at a point whose sign is known.
    let mid = null;
    let sMid = null;
    const quarter = width.divide(new Rational(4));
    const inner = [lo.add(quarter), hi.subtract(quarter)];
    const candidates = [simplestBetween(inner[0], inner[1]), lo.add(hi).divide(two), lo.add(width.divide(new Rational(3))), lo.add(width.multiply(new Rational(5, 8)))];
    for (const c of candidates) {
      const sc = signAt(ctx, enclose, exact, P, rp, c);
      if (sc.sign !== 0 || sc.exact || c === candidates[candidates.length - 1]) {
        mid = c;
        sMid = sc;
        break;
      }
    }
    work(lo, mid, sLo, sMid, depth + 1);
    work(mid, hi, sMid, sHi, depth + 1);
  };

  // A rational function whose numerator has degree <= n and which is 0 at
  // n + 1 points is 0 wherever it is defined.
  if (exact) {
    const n = degreeBound(ast, variable);
    if (n !== null && n < 64) {
      let zerosSeen = 0;
      let defined = 0;
      for (let i = 0; i <= 4 * n + 8 && zerosSeen <= n; i++) {
        const r = lo0.add(hi0.subtract(lo0).multiply(new Rational(BigInt(2 * i + 1), BigInt(8 * n + 18))));
        const v = exact(r, rp);
        if (v === null) continue;
        defined++;
        if (v.numerator !== 0n) break;
        zerosSeen++;
      }
      if (zerosSeen > n) return { value: [{ kind: "zero-interval", lo: lo0, hi: hi0 }], via: "degree-bound" };
    }
  }

  let left = lo0;
  let sLeft = signAt(ctx, enclose, exact, P, rp, left);
  for (let i = 0; i < pieces; i++) {
    const right = i === pieces - 1 ? hi0 : lo0.add(step.multiply(new Rational(i + 1)));
    const sRight = signAt(ctx, enclose, exact, P, rp, right);
    work(left, right, sLeft, sRight, 0);
    left = right;
    sLeft = sRight;
    yield { done: i + 1, of: pieces, step: "piece" };
  }
  // A merged "possible" interval whose ends have opposite signs, with a
  // finite enclosure (no pole), certainly holds a zero.
  const merged = mergeResults(results).map((r) => {
    if (r.kind !== "possible") return r;
    if (exact) {
      // A rational-only f that is undefined at the simplest point inside is a
      // pole there (division by zero), not a zero.
      const at = simplestBetween(r.lo, r.hi);
      if (exact(at, rp) === null) return { kind: "undefined", at, lo: r.lo, hi: r.hi };
    }
    const sl = signAt(ctx, enclose, exact, P, rp, r.lo);
    const sh = signAt(ctx, enclose, exact, P, rp, r.hi);
    if (sl.sign * sh.sign < 0) {
      const y = enclose(ctx, I.fromBounds(ctx, r.lo.numerator, r.lo.denominator, r.hi.numerator, r.hi.denominator), P);
      if (y && I.isFinite(y.lo) && I.isFinite(y.hi)) return { kind: "sign-change", lo: r.lo, hi: r.hi };
    }
    return r;
  });
  return { value: merged, via: exact ? "exact-rational-bisection" : "interval-bisection" };
}

/**
 * An upper bound on the degree (in the variable) of the numerator of a
 * rational-only expression written over a common denominator, or null.
 */
export function degreeBound(ast, x = "x") {
  const go = (n) => {
    switch (n.type) {
      case "num": return [0, 0];
      case "var": return n.name === x ? [1, 0] : [0, 0];
      case "op": {
        const [a, b] = n.args.map(go);
        if (!a || (n.args.length > 1 && !b)) return null;
        switch (n.op) {
          case "neg": return a;
          case "+": case "-": return [Math.max(a[0] + b[1], b[0] + a[1]), a[1] + b[1]];
          case "*": return [a[0] + b[0], a[1] + b[1]];
          case "/": return [a[0] + b[1], a[1] + b[0]];
          case "^": {
            const k = integerExponent(n.args[1]);
            if (k === null) return null;
            return k >= 0 ? [a[0] * k, a[1] * k] : [a[1] * -k, a[0] * -k];
          }
        }
        return null;
      }
    }
    return null;
  };
  const r = go(ast);
  return r ? r[0] : null;
}

function mergeResults(results) {
  const zi = results.filter((r) => r.kind === "zero-interval");
  if (zi.length) {
    const inside = (r) => zi.some((z) => r !== z && !(r.lo ?? r.at).lessThan(z.lo) && !(r.hi ?? r.at).greaterThan(z.hi));
    results = results.filter((r) => r.kind === "zero-interval" || !inside(r));
  }
  const key = (r) => (r.kind === "exact" ? r.at : r.lo);
  results.sort((p, q) => key(p).compareTo(key(q)));
  // Merge touching "possible" intervals into one.
  const out = [];
  for (const r of results) {
    const last = out[out.length - 1];
    if ((r.kind === "possible" || r.kind === "zero-interval") && last && last.kind === r.kind && last.hi.equals(r.lo)) {
      out[out.length - 1] = { kind: r.kind, lo: last.lo, hi: r.hi };
    } else if (r.kind === "exact" && last && last.kind === "zero-interval" && !r.at.greaterThan(last.hi)) {
      continue;
    } else if (r.kind === "possible" && last && (last.kind === "exact" || last.kind === "undefined") && last.at.equals(r.lo)) {
      // a possible interval starting at an exact zero adds nothing new
      continue;
    } else out.push(r);
  }
  return out;
}

/** Synchronous: all zeros of f on [a, b]. */
export function findZeros(f, params, range, options) {
  const gen = zerosGenerator(f, params, range, options);
  let s;
  while (!(s = gen.next()).done);
  return s.value.value;
}

/** Zeros as a Refinement: quick float guesses, then certified results. */
export function zeros(f, params, range, options = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  return new Refinement(
    () => ({ value: floatZeros(ast, params, range, options), trust: "rough" }),
    () => zerosGenerator(ast, params, range, options),
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
