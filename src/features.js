// Points of interest on y = f(x): zeros, poles, holes, extrema, inflection
// points and domain ends, all certified.
//
// Zeros, poles, holes, extrema and inflections come from @ratmath/analytic
// (its src/roots.js): symbolic derivatives, an exact engine for rational
// functions (gcd cancellation for holes, Yun for multiplicity, Sturm
// isolation), and Krawczyk/Rolle proofs otherwise. This file adapts its
// records to the shapes graphics draws, and keeps one thing analytic leaves
// to graphics: domain ends (where an argument of sqrt or of a fractional
// power crosses 0, with whether the end itself is included).
//
// Record shapes after adapting:
//   zeros        { kind: "exact" | "sign-change" | "isolated" | "possible" | "everywhere", at?, lo, hi, unique?, multiplicity? }
//                ("everywhere": f is zero on all of [lo, hi])
//   poles        { kind: "pole" | "log", certain: true, exact, at?, lo, hi, order? }
//   undefined    { kind: "undefined", certain: false, exact, at?, lo, hi }    f has no value there and no pole was proven (sin(1/x) at 0)
//   holes        { kind: "hole", exact, at?, lo, hi, value? | valueLo, valueHi, valueApprox }
//   extrema      { kind: "max" | "min" | "flat" | "critical" | "constant", exact, at?, lo, hi, value? | valueLo, valueHi, unique? }
//   inflections  { kind: "inflection" | "possible", exact, at?, lo, hi, value? | valueLo, valueHi, unique? }
//   endpoints    { kind: "endpoint", side: "left" | "right" | "isolated", included, exact, at?, lo, hi, value... }

import { Rational } from "@ratmath/core";
import { compileExact, compileFloat, constValue, compileInterval, paramsToFloat, paramsToIntervals, paramsToRational, parse, toRational } from "./expr.js";
import * as A from "@ratmath/analytic";
import * as I from "./interval.js";
import { Refinement } from "./refine.js";
import { floatZeros, signAt } from "./roots.js";

const asAst = (f) => (typeof f === "string" ? parse(f) : f);

// ---- setup shared by the analyses ------------------------------------------------

export function setup(ast, params, tolerance, variable) {
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
      const c = constValue(ast.args[1]);
      if (c !== null && c.numerator < 0n) out.push({ D: ast.args[0], N: { type: "num", value: new Rational(1n) }, kind: "pole" });
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

function finish(gen) {
  let s;
  while (!(s = gen.next()).done);
  return s.value;
}

export const findEndpoints = (f, params, range, options) => finish(endpointsGenerator(f, params, range, options));

// ---- domain endpoints and holes ----------------------------------------------------

/** Arguments u that bound the domain from one side with u = 0 included: sqrt(u), u^c (c > 0 with an even denominator), 1 ± u for asin(u) and acos(u). */
export function domainArguments(ast, out = []) {
  if (ast.type === "call" && ast.name === "sqrt") out.push(ast.args[0]);
  if (ast.type === "op" && ast.op === "^") {
    const c = constValue(ast.args[1]);
    // an even root ends the domain; an odd root (x^(1/3)) is defined on both sides
    if (c !== null && c.numerator > 0n && c.denominator % 2n === 0n) out.push(ast.args[0]);
  }
  if (ast.type === "call" && (ast.name === "asin" || ast.name === "acos")) {
    // defined for -1 <= u <= 1: both 1 - u and 1 + u must stay non-negative
    const one = { type: "num", value: new Rational(1n) };
    out.push({ type: "op", op: "-", args: [one, ast.args[0]] }, { type: "op", op: "+", args: [one, ast.args[0]] });
  }
  if (ast.args) for (const a of ast.args) domainArguments(a, out);
  return out;
}

/** Is f defined at the located point? Exact rational points are evaluated directly. */
function definedAt(F, loc) {
  if (loc.exact && F.exact) return F.exact(loc.at, F.rp) !== null;
  const { y } = encloseOn(F, F.enclose, loc.lo, loc.hi);
  return finite(y);
}

/**
 * Ends of the domain inside (a, b): where an argument of sqrt (or of a
 * fractional power) crosses 0. `side` says which side the domain lies on;
 * `included` whether f is defined at the end itself (filled dot) or not
 * (open dot). An isolated point of the domain (sqrt(-x^2) at 0) has side
 * "isolated".
 */
export function* endpointsGenerator(f, params, [a, b], { variable = "x", tolerance = "1/1000000", pieces = 64 } = {}) {
  const ast = asAst(f);
  const lo0 = toRational(a);
  const hi0 = toRational(b);
  const F = setup(ast, params, tolerance, variable);
  const args = domainArguments(ast);
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const u = args[k];
    const U = setup(u, params, tolerance, variable);
    const zs = yield* zerosGenerator2(u, params, [lo0, hi0], { variable, tolerance, pieces });
    for (const { z, left, right } of classify(U, zs, [lo0, hi0])) {
      const loc = location(z);
      if (loc.lo.equals(lo0) || loc.hi.equals(hi0)) continue; // the edge of the view, not of the domain
      let side;
      if (left < 0 && right > 0) side = "right";
      else if (left > 0 && right < 0) side = "left";
      else if (left < 0 && right < 0) side = "isolated";
      else continue; // u >= 0 on both sides: an interior point of the domain
      // It is an end of f's domain only if f is defined just inside it (in
      // ln(x) + sqrt(16 - x^2), x = -4 ends sqrt's domain but not f's).
      if (side !== "isolated") {
        const step = F.tol.multiply(new Rational(4n));
        const q = side === "right" ? loc.hi.add(step) : loc.lo.subtract(step);
        if (!definedAt(F, { exact: true, at: q, lo: q, hi: q })) continue;
      }
      const included = definedAt(F, loc);
      out.push({ kind: "endpoint", side, included, ...loc, ...(included ? valueAt(F, loc) : {}) });
    }
  }
  out.sort((p, q) => p.lo.compareTo(q.lo));
  return out.filter((e, i) => i === 0 || !e.lo.equals(out[i - 1].lo));
}

// ---- analytic adapters ----------------------------------------------------------------

/** Analytic's options from graphics' (params travel inside the options there). */
function aOpts(params, { variable = "x", tolerance = "1/1000000", pieces } = {}) {
  return { variable, params: params ?? {}, tolerance, ...(pieces ? { pieces } : {}) };
}

/** Run an analytic Refinement's exact stage, re-yielding its progress ticks. */
function* drive(ref, step) {
  for (const s of ref.stages()) {
    if (s.stage === "progress") yield { done: s.done, of: s.of, step };
    else if (s.exact) return s.value;
  }
}

// Analytic may run on its own copy of Core; normalise to this one.
const R = (q) => (q === undefined || q === null ? q : toRational(q));

function place(r) {
  const at = R(r.at);
  return at ? { exact: true, at, lo: at, hi: at } : { exact: false, lo: R(r.lo), hi: R(r.hi) };
}

/** A RationalInterval value as `value` (a point) or `valueLo` / `valueHi`. */
function valued(v) {
  if (!v) return {};
  if (v.low === undefined) return { value: R(v) };
  const lo = R(v.low);
  const hi = R(v.high);
  return lo.equals(hi) ? { value: lo } : { valueLo: lo, valueHi: hi };
}

function adaptZero(z) {
  const { kind, unique, multiplicity, atMost, bound, budget } = z;
  return { kind, ...place(z), ...(unique ? { unique } : {}), ...(multiplicity ? { multiplicity } : {}), ...(atMost ? { atMost } : {}), ...(bound ? { bound: R(bound) } : {}), ...(budget ? { budget } : {}) };
}

function adaptSingularity(p) {
  if (p.kind === "hole") {
    const v = valued(p.value);
    const mid = v.value ? v.value.toNumber() : v.valueLo ? (v.valueLo.toNumber() + v.valueHi.toNumber()) / 2 : undefined;
    return { kind: "hole", ...place(p), ...v, valueApprox: mid };
  }
  // "undefined": f has no value there and no pole was proven (sin(1/x) at 0).
  if (p.kind !== "pole") return { kind: "undefined", certain: false, ...place(p) };
  return { kind: p.source === "log" ? "log" : "pole", certain: true, ...place(p), ...(p.order ? { order: p.order } : {}) };
}

function adaptPoint(r, kinds) {
  return { kind: kinds[r.kind] ?? r.kind, ...place(r), ...valued(r.value), ...(r.unique ? { unique: true } : {}), ...(r.touching ? { touching: true } : {}) };
}

export function* zerosGenerator2(f, params, range, options = {}) {
  const list = yield* drive(A.zeros(asAst(f), range, aOpts(params, options)), "zeros");
  return list.filter((z) => z.kind !== "undefined").map(adaptZero);
}

/** Poles and holes (holes carry kind "hole"). */
export function* polesGenerator(f, params, range, options = {}) {
  const list = yield* drive(A.poles(asAst(f), range, aOpts(params, options)), "poles");
  return list.map(adaptSingularity);
}

export function* extremaGenerator(f, params, range, options = {}) {
  const list = yield* drive(A.extrema(asAst(f), range, aOpts(params, options)), "extrema");
  // a constant stretch has no point to mark
  return list.filter((r) => r.kind !== "constant").map((r) => adaptPoint(r, { possible: "critical" }));
}

export function* inflectionsGenerator(f, params, range, options = {}) {
  const list = yield* drive(A.inflections(asAst(f), range, aOpts(params, options)), "inflections");
  return list.map((r) => adaptPoint(r, {}));
}

export const findPoles = (f, params, range, options) => finish(polesGenerator(f, params, range, options)).filter((p) => p.certain);
export const findHoles = (f, params, range, options) => finish(polesGenerator(f, params, range, options)).filter((p) => p.kind === "hole");
export const findExtrema = (f, params, range, options) => finish(extremaGenerator(f, params, range, options));
export const findInflections = (f, params, range, options) => finish(inflectionsGenerator(f, params, range, options));

// ---- intersections of two graphs -----------------------------------------------------

/**
 * Where y = f(x) and y = g(x) meet on [a, b]: the zeros of f − g, each with
 * the common value. Records: { kind (as for zeros), exact, at?, lo, hi,
 * value? | valueLo, valueHi, unique?, multiplicity? }; a "touching" meeting
 * (even multiplicity) has kind "isolated". "possible" could not be decided.
 */
export function* intersectionsGenerator(f, g, params, range, options = {}) {
  const F = asAst(f);
  const diff = { type: "op", op: "-", args: [F, asAst(g)] };
  const zs = yield* zerosGenerator2(diff, params, range, options);
  const S = setup(F, params, options.tolerance ?? "1/1000000", options.variable ?? "x");
  return zs.map((z) => (z.kind === "everywhere" ? z : { ...z, ...valueAt(S, z) }));
}

export const findIntersections = (f, g, params, range, options) => finish(intersectionsGenerator(f, g, params, range, options));

/** Intersections as a Refinement: float guesses { x, y } at once, certified records when settled. */
export function intersections(f, g, params, range, options = {}) {
  const F = asAst(f);
  const G = asAst(g);
  return new Refinement(
    () => {
      const fn = compileFloat(F, options.variable ?? "x");
      const p = paramsToFloat(paramsToRational(params));
      const xs = floatZeros({ type: "op", op: "-", args: [F, G] }, params, range, options);
      return { value: xs.map((x) => ({ x, y: fn(x, p) })), trust: "rough" };
    },
    function* () {
      return { value: yield* intersectionsGenerator(F, G, params, range, options), via: "analytic-roots" };
    },
  );
}

// ---- everything together ---------------------------------------------------------------

/** Float estimates of all features, for the quick stage. */
export function floatFeatures(f, params, range, { variable = "x", samples = 512 } = {}) {
  const ast = asAst(f);
  const d1 = A.differentiate(ast, variable);
  const d2 = A.differentiate(d1, variable);
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
  const zeros = yield* zerosGenerator2(ast, params, range, options);
  const singular = yield* polesGenerator(ast, params, range, options);
  const extrema = yield* extremaGenerator(ast, params, range, options);
  const inflections = yield* inflectionsGenerator(ast, params, range, options);
  const endpointList = yield* endpointsGenerator(ast, params, range, options);
  const poles = singular.filter((p) => p.certain);
  const undefinedAt = singular.filter((p) => p.kind === "undefined");
  const holes = singular.filter((p) => p.kind === "hole");
  const overlaps = (a, b) => !a.lo.greaterThan(b.hi) && !b.lo.greaterThan(a.hi);
  // An excluded end that blows up is drawn as an asymptote, not a dot.
  const endpoints = endpointList.filter((e) => !poles.some((p) => p.certain && overlaps(e, p)));
  return {
    value: { zeros, poles, holes, undefined: undefinedAt, endpoints, extrema, inflections },
    via: "analytic-roots",
  };
}

/**
 * Zeros, poles, holes, extrema, inflection points and domain ends as a
 * Refinement: float estimates at once, certified results when settled.
 */
export function features(f, params, range, options = {}) {
  const ast = asAst(f);
  return new Refinement(
    () => ({ value: floatFeatures(ast, params, range, options), trust: "rough" }),
    () => featuresGenerator(ast, params, range, options),
  );
}
