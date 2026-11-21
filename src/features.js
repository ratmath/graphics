// Points of interest on y = f(x): poles, extrema (max/min), inflection points
// and stationary points, all certified.
//
// Poles. Every place f divides (u/v, u^-k, tan u = sin u / cos u) or takes a
// logarithm (ln u) has a "denominator" D. A pole is where D has a proven zero
// (exact, or a sign change) while the matching numerator stays away from 0
// there. Rational poles come out exactly (`at`); irrational ones as a
// rational bracket [lo, hi] of the requested width that certainly holds the
// pole. `certain: false` marks a spot that could not be settled either way.
// (A pole in one term can in principle be cancelled by an equal pole in
// another, as in 1/x - 1/x; such cancellations are not detected.)
//
// Extrema and inflections. f' and f'' are symbolic derivatives, so they get
// the same certified arithmetic. Each zero of f' is classified by the sign of
// f' just to its left and right. Those signs are proven: the zero search
// certifies there is no other zero of f' between neighbouring results, and an
// enclosure computed without domain clipping proves f' is continuous on the
// neighbourhood used. + then - is a max, - then + a min, no change a flat
// point (like x^3 at 0). Inflections are sign changes of f'' the same way.

import { Rational } from "@ratmath/core";
import { compileExact, compileFloat, compileInterval, paramsToFloat, paramsToIntervals, paramsToRational, parse, toRational } from "./expr.js";
import { derive, format } from "./derive.js";
import * as I from "./interval.js";
import { Refinement } from "./refine.js";
import { floatZeros, signAt, simplestBetween, zerosGenerator } from "./roots.js";

const asAst = (f) => (typeof f === "string" ? parse(f) : f);

/** Run a generator to completion, re-yielding its progress under a step name. */
function* run(gen, step) {
  let s;
  while (!(s = gen.next()).done) yield { ...s.value, step };
  return s.value.value;
}

// ---- setup shared by the analyses ------------------------------------------------

function setup(ast, params, tolerance, variable) {
  const tol = toRational(tolerance);
  const bits = I.bitLength(tol.denominator) - I.bitLength(tol.numerator) + 24;
  const ctx = I.context(Math.max(32, bits));
  const rp = paramsToRational(params);
  const P = paramsToIntervals(ctx, rp);
  return {
    ctx, rp, P, tol, variable,
    enclose: compileInterval(ast, variable),
    exact: compileExact(ast, variable),
  };
}

function encloseOn(S, enclose, lo, hi) {
  I.resetClipped();
  let y;
  try {
    y = enclose(S.ctx, I.fromBounds(S.ctx, lo.numerator, lo.denominator, hi.numerator, hi.denominator), S.P);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    y = I.WHOLE;
  }
  return { y, clipped: I.wasClipped() };
}

const finite = (y) => y && I.isFinite(y.lo) && I.isFinite(y.hi);
const excludesZero = (y) => y && (y.lo > 0n || y.hi < 0n);

/** An interval of fixed-point endpoints as a pair of Core Rationals. */
function toRationals(ctx, y) {
  if (!y) return null;
  return [
    I.isFinite(y.lo) ? new Rational(y.lo, ctx.one) : null,
    I.isFinite(y.hi) ? new Rational(y.hi, ctx.one) : null,
  ];
}

// ---- poles -------------------------------------------------------------------------

/** Every (denominator, numerator, kind) pair in an expression. */
export function denominators(ast, out = []) {
  if (ast.type === "op") {
    if (ast.op === "/") out.push({ D: ast.args[1], N: ast.args[0], kind: "pole" });
    if (ast.op === "^") {
      const e = ast.args[1];
      const negInt = (e.type === "op" && e.op === "neg") || (e.type === "num" && e.value.numerator < 0n);
      if (negInt) out.push({ D: ast.args[0], N: { type: "num", value: new Rational(1n) }, kind: "pole" });
    }
  }
  if (ast.type === "call") {
    const [u] = ast.args;
    if (ast.name === "tan") out.push({ D: { type: "call", name: "cos", args: [u] }, N: { type: "call", name: "sin", args: [u] }, kind: "pole" });
    if (ast.name === "ln" || ast.name === "log") out.push({ D: u, N: { type: "num", value: new Rational(1n) }, kind: "log" });
  }
  if (ast.args) for (const a of ast.args) denominators(a, out);
  return out;
}

export function* polesGenerator(f, params, [a, b], { variable = "x", tolerance = "1/1000000", pieces = 64 } = {}) {
  const ast = asAst(f);
  const dens = denominators(ast);
  const found = [];
  for (let k = 0; k < dens.length; k++) {
    const { D, N, kind } = dens[k];
    const S = setup(N, params, tolerance, variable);
    const zs = yield* run(zerosGenerator(D, params, [a, b], { variable, tolerance, pieces }), `poles ${k + 1}/${dens.length}`);
    for (const z of zs) {
      if (z.kind === "undefined") continue; // D itself undefined there; its own poles are listed separately
      const term = format(D);
      if (z.kind === "exact") {
        let nonzero;
        if (S.exact) {
          const v = S.exact(z.at, S.rp);
          nonzero = v !== null && v.numerator !== 0n;
        } else nonzero = excludesZero(encloseOn(S, S.enclose, z.at, z.at).y);
        found.push({ kind, at: z.at, lo: z.at, hi: z.at, certain: nonzero, exact: true, denominator: term });
      } else if (z.kind === "sign-change") {
        const nonzero = excludesZero(encloseOn(S, S.enclose, z.lo, z.hi).y);
        found.push({ kind, lo: z.lo, hi: z.hi, certain: nonzero, exact: false, denominator: term });
      } else {
        found.push({ kind, lo: z.lo, hi: z.hi, certain: false, exact: false, denominator: term });
      }
    }
  }
  return mergePoles(found);
}

function mergePoles(list) {
  list.sort((p, q) => p.lo.compareTo(q.lo));
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && !p.lo.greaterThan(last.hi)) {
      // Overlapping reports of the same pole: keep the sharper, more certain one.
      const better = (p.certain && !last.certain) || (p.certain === last.certain && p.exact && !last.exact);
      if (better) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

export function findPoles(f, params, range, options) {
  return finish(polesGenerator(f, params, range, options));
}

// ---- sign-change classification ----------------------------------------------------

/**
 * Proven sign of g on an open neighbourhood on one side of [lo, hi], within
 * `room` (a Rational distance that holds no other zero of g). Returns 1, -1
 * or 0 for unknown.
 */
function sideSign(S, lo, hi, room, side) {
  let width = room.divide(new Rational(2n));
  for (let i = 0; i < 40; i++) {
    const [nlo, nhi] = side < 0 ? [lo.subtract(width), lo] : [hi, hi.add(width)];
    const { y, clipped } = encloseOn(S, S.enclose, nlo, nhi);
    if (y && !clipped && finite(y)) {
      // g is continuous on [nlo, nhi] and has no zero inside it other than
      // possibly at the shared end, so one interior point fixes the sign.
      const q = side < 0 ? nlo.add(width.divide(new Rational(2n))) : nhi.subtract(width.divide(new Rational(2n)));
      const s = signAt(S.ctx, S.enclose, S.exact, S.P, S.rp, q);
      if (s.sign === 1 || s.sign === -1) return s.sign;
    }
    width = width.divide(new Rational(2n));
  }
  return 0;
}

/** Classify each zero of g (exact points and brackets) by g's sign on each side. */
function classify(S, zeros, [a, b]) {
  const out = [];
  for (let i = 0; i < zeros.length; i++) {
    const z = zeros[i];
    if (z.kind !== "exact" && z.kind !== "sign-change") continue;
    const lo = z.kind === "exact" ? z.at : z.lo;
    const hi = z.kind === "exact" ? z.at : z.hi;
    const prevEnd = i > 0 ? zeros[i - 1].hi ?? zeros[i - 1].at : a;
    const nextStart = i + 1 < zeros.length ? zeros[i + 1].lo ?? zeros[i + 1].at : b;
    const roomL = lo.subtract(prevEnd);
    const roomR = nextStart.subtract(hi);
    // The bracket itself must be a stretch where g is continuous.
    if (z.kind === "sign-change") {
      const { y, clipped } = encloseOn(S, S.enclose, lo, hi);
      if (!y || clipped || !finite(y)) {
        out.push({ z, left: 0, right: 0 });
        continue;
      }
    }
    const left = roomL.numerator > 0n ? sideSign(S, lo, hi, roomL, -1) : 0;
    const right = roomR.numerator > 0n ? sideSign(S, lo, hi, roomR, 1) : 0;
    out.push({ z, left, right });
  }
  return out;
}

function location(z) {
  return z.kind === "exact" ? { at: z.at, lo: z.at, hi: z.at, exact: true } : { lo: z.lo, hi: z.hi, exact: false };
}

/** f's value at a located point: exact Rational, or a [lo, hi] Rational enclosure. */
function valueAt(F, loc) {
  if (loc.exact && F.exact) {
    const v = F.exact(loc.at, F.rp);
    if (v !== null) return { value: v };
  }
  const { y } = encloseOn(F, F.enclose, loc.lo, loc.hi);
  const r = toRationals(F.ctx, y);
  return r ? { valueLo: r[0], valueHi: r[1] } : {};
}

export function* extremaGenerator(f, params, range, { variable = "x", tolerance = "1/1000000", pieces = 64 } = {}) {
  const ast = asAst(f);
  const d1 = derive(ast, variable);
  const lo0 = toRational(range[0]);
  const hi0 = toRational(range[1]);
  const S = setup(d1, params, tolerance, variable);
  const F = setup(ast, params, tolerance, variable);
  const zs = yield* run(zerosGenerator(d1, params, [lo0, hi0], { variable, tolerance, pieces }), "f'");
  const out = [];
  for (const { z, left, right } of classify(S, zs, [lo0, hi0])) {
    const loc = location(z);
    // f must be defined at the point (f' exists there, so f is continuous).
    let kind;
    if (left === 1 && right === -1) kind = "max";
    else if (left === -1 && right === 1) kind = "min";
    else if (left !== 0 && left === right) kind = "flat";
    else kind = "critical"; // f' = 0 here, but the sides could not be settled
    out.push({ kind, ...loc, ...valueAt(F, loc) });
  }
  return out;
}

export function* inflectionsGenerator(f, params, range, { variable = "x", tolerance = "1/1000000", pieces = 64 } = {}) {
  const ast = asAst(f);
  const d2 = derive(derive(ast, variable), variable);
  const lo0 = toRational(range[0]);
  const hi0 = toRational(range[1]);
  const S = setup(d2, params, tolerance, variable);
  const F = setup(ast, params, tolerance, variable);
  const zs = yield* run(zerosGenerator(d2, params, [lo0, hi0], { variable, tolerance, pieces }), "f''");
  const out = [];
  for (const { z, left, right } of classify(S, zs, [lo0, hi0])) {
    if (left === 0 || right === 0) {
      out.push({ kind: "possible", ...location(z), ...valueAt(F, location(z)) });
    } else if (left !== right) {
      out.push({ kind: left > 0 ? "convex-to-concave" : "concave-to-convex", ...location(z), ...valueAt(F, location(z)) });
    }
    // Same sign on both sides (like x^4 at 0): not an inflection.
  }
  return out;
}

function finish(gen) {
  let s;
  while (!(s = gen.next()).done);
  return s.value;
}

export const findExtrema = (f, params, range, options) => finish(extremaGenerator(f, params, range, options));
export const findInflections = (f, params, range, options) => finish(inflectionsGenerator(f, params, range, options));

// ---- everything together ---------------------------------------------------------------

/** Float estimates of all features, for the quick stage. */
export function floatFeatures(f, params, range, { variable = "x", samples = 512 } = {}) {
  const ast = asAst(f);
  const d1 = derive(ast, variable);
  const d2 = derive(d1, variable);
  const fn = compileFloat(ast, variable);
  const g1 = compileFloat(d1, variable);
  const g2 = compileFloat(d2, variable);
  const p = paramsToFloat(paramsToRational(params));
  const opt = { variable, samples };
  const ex = floatZeros(d1, params, range, opt).map((x) => {
    const h = 1e-6 * (1 + Math.abs(x));
    const l = g1(x - h, p);
    const r = g1(x + h, p);
    return { kind: l > 0 && r < 0 ? "max" : l < 0 && r > 0 ? "min" : "flat", x, y: fn(x, p) };
  });
  const infl = floatZeros(d2, params, range, opt)
    .filter((x) => {
      const h = 1e-6 * (1 + Math.abs(x));
      return g2(x - h, p) * g2(x + h, p) < 0;
    })
    .map((x) => ({ x, y: fn(x, p) }));
  const poles = [];
  for (const { D } of denominators(ast)) for (const x of floatZeros(D, params, range, opt)) poles.push({ x });
  return { zeros: floatZeros(ast, params, range, opt), poles, extrema: ex, inflections: infl };
}

export function* featuresGenerator(f, params, range, options = {}) {
  const ast = asAst(f);
  const zeros = yield* run(zerosGenerator(ast, params, range, options), "zeros");
  const poles = yield* polesGenerator(ast, params, range, options);
  const extrema = yield* extremaGenerator(ast, params, range, options);
  const inflections = yield* inflectionsGenerator(ast, params, range, options);
  // An unsettled "possible" zero that overlaps a proven pole is that pole.
  const atPole = (r) => poles.some((p) => p.certain && !r.lo.greaterThan(p.hi) && !p.lo.greaterThan(r.hi));
  const cleanZeros = zeros.filter((r) => r.kind !== "undefined" && !(r.kind === "possible" && atPole(r)));
  return { value: { zeros: cleanZeros, poles, extrema, inflections }, via: "certified-derivatives" };
}

/**
 * Zeros, poles, extrema and inflection points as a Refinement: float
 * estimates at once, certified results when settled.
 */
export function features(f, params, range, options = {}) {
  const ast = asAst(f);
  return new Refinement(
    () => ({ value: floatFeatures(ast, params, range, options), trust: "rough" }),
    () => featuresGenerator(ast, params, range, options),
  );
}
