// Certified interval arithmetic on dyadic fixed-point numbers.
//
// An endpoint is a BigInt `m` standing for the exact rational m / 2^k, or one of
// the JavaScript numbers -Infinity / +Infinity. Every operation rounds its lower
// endpoint down and its upper endpoint up, so the true real result is always
// inside the returned interval. Exact rationals (viewport edges, slider values,
// literals) enter through `fromRational`, which rounds outward once.
//
// Intervals are plain objects `{ lo, hi }`. `null` is the empty interval (for
// example sqrt of a negative interval: the function is not defined there).

import { Rational } from "@ratmath/core";
import { enclose as analytic } from "@ratmath/analytic";

const NEG = -Infinity;
const POS = Infinity;

export const isFinite = (v) => typeof v === "bigint";

export function floorDiv(a, b) {
  if (b < 0n) { a = -a; b = -b; }
  const q = a / b;
  return a < 0n && q * b !== a ? q - 1n : q;
}

export function ceilDiv(a, b) {
  if (b < 0n) { a = -a; b = -b; }
  const q = a / b;
  return a > 0n && q * b !== a ? q + 1n : q;
}

export function bitLength(n) {
  if (n < 0n) n = -n;
  return n === 0n ? 0 : n.toString(2).length;
}

/** Floor of the square root of a non-negative BigInt. */
export function isqrt(n) {
  if (n < 0n) throw new RangeError("isqrt of a negative number");
  if (n < 2n) return n;
  let x = 1n << BigInt((bitLength(n) >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * A precision context. `k` is the number of fractional bits; `one` is 2^k.
 * Contexts are cheap and cached per k because the constants (pi, ln 2) are.
 */
const contexts = new Map();
export function context(k) {
  k = Math.max(8, Math.min(4000, Math.ceil(k)));
  let ctx = contexts.get(k);
  if (!ctx) {
    ctx = { k, K: BigInt(k), one: 1n << BigInt(k), cache: new Map() };
    contexts.set(k, ctx);
  }
  return ctx;
}

export const WHOLE = Object.freeze({ lo: NEG, hi: POS });

// Domain clipping flag. Operations that cut an input down to their domain
// (sqrt of an interval reaching below 0, ln reaching 0 or below, division by
// an interval containing 0) set it. An enclosure computed with the flag left
// clear proves the function is defined, and therefore continuous, on the
// whole input interval: every operation here is continuous on its domain.
let clipped = false;
export function resetClipped() {
  clipped = false;
}
export function wasClipped() {
  return clipped;
}

/** Outward-rounded enclosure of the exact rational n/d. */
export function fromRational(ctx, n, d = 1n) {
  n = BigInt(n);
  d = BigInt(d);
  const s = n << ctx.K;
  return { lo: floorDiv(s, d), hi: ceilDiv(s, d) };
}

export function fromBounds(ctx, loN, loD, hiN, hiD) {
  return { lo: floorDiv(BigInt(loN) << ctx.K, BigInt(loD)), hi: ceilDiv(BigInt(hiN) << ctx.K, BigInt(hiD)) };
}

export function width(iv) {
  if (!isFinite(iv.lo) || !isFinite(iv.hi)) return POS;
  return iv.hi - iv.lo;
}

export function hull(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { lo: a.lo < b.lo ? a.lo : b.lo, hi: a.hi > b.hi ? a.hi : b.hi };
}

export function intersect(a, b) {
  if (!a || !b) return null;
  const lo = a.lo > b.lo ? a.lo : b.lo;
  const hi = a.hi < b.hi ? a.hi : b.hi;
  return lo > hi ? null : { lo, hi };
}

export function containsZero(iv) {
  return iv.lo <= 0n && iv.hi >= 0n;
}

// ---- endpoint helpers (BigInt or ±Infinity) --------------------------------

function addE(a, b) {
  if (isFinite(a) && isFinite(b)) return a + b;
  if (!isFinite(a)) return a;
  return b;
}

function sgn(v) {
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}

/** Product of two endpoints at scale k, rounded down (dir=-1) or up (dir=+1). */
function mulE(ctx, a, b, dir) {
  if (a === 0n || b === 0n) return 0n;
  if (!isFinite(a) || !isFinite(b)) return sgn(a) * sgn(b) > 0 ? POS : NEG;
  const p = a * b;
  return dir < 0 ? p >> ctx.K : -((-p) >> ctx.K);
}

// ---- arithmetic --------------------------------------------------------------

export function add(ctx, a, b) {
  if (!a || !b) return null;
  return { lo: addE(a.lo, b.lo), hi: addE(a.hi, b.hi) };
}

export function neg(ctx, a) {
  if (!a) return null;
  return { lo: isFinite(a.hi) ? -a.hi : -a.hi, hi: isFinite(a.lo) ? -a.lo : -a.lo };
}

export function sub(ctx, a, b) {
  return add(ctx, a, neg(ctx, b));
}

export function mul(ctx, a, b) {
  if (!a || !b) return null;
  const c = [a.lo, a.hi];
  const d = [b.lo, b.hi];
  let lo = POS;
  let hi = NEG;
  for (const x of c) {
    for (const y of d) {
      const l = mulE(ctx, x, y, -1);
      const h = mulE(ctx, x, y, 1);
      if (l < lo) lo = l;
      if (h > hi) hi = h;
    }
  }
  return { lo, hi };
}

/** Square, which is tighter than mul(a, a) when a straddles zero. */
export function sqr(ctx, a) {
  return powInt(ctx, a, 2);
}

function recipPos(ctx, lo, hi) {
  // 1 / [lo, hi] with 0 < lo <= hi (hi may be +Infinity).
  const one2 = ctx.one * ctx.one;
  return {
    lo: isFinite(hi) ? floorDiv(one2, hi) : 0n,
    hi: isFinite(lo) ? ceilDiv(one2, lo) : 0n,
  };
}

export function recip(ctx, a) {
  if (!a) return null;
  if (a.lo > 0n) return recipPos(ctx, a.lo, a.hi);
  if (a.hi < 0n) return neg(ctx, recipPos(ctx, -a.hi, isFinite(a.lo) ? -a.lo : POS));
  clipped = true;
  if (a.lo === 0n && a.hi === 0n) return null; // 1/0 is undefined
  if (a.lo === 0n) return { lo: isFinite(a.hi) ? floorDiv(ctx.one * ctx.one, a.hi) : 0n, hi: POS };
  if (a.hi === 0n) return { lo: NEG, hi: isFinite(a.lo) ? ceilDiv(ctx.one * ctx.one, a.lo) : 0n };
  return WHOLE;
}

export function div(ctx, a, b) {
  if (!a || !b) return null;
  return mul(ctx, a, recip(ctx, b));
}

function powE(ctx, v, n, dir) {
  // v^n at scale k for a finite or infinite endpoint, n >= 1.
  if (!isFinite(v)) return n % 2 === 0 ? POS : v;
  const p = v ** BigInt(n);
  const shift = ctx.K * BigInt(n - 1);
  return dir < 0 ? p >> shift : -((-p) >> shift);
}

export function powInt(ctx, a, n) {
  if (!a) return null;
  if (n === 0) return { lo: ctx.one, hi: ctx.one };
  if (n < 0) return recip(ctx, powInt(ctx, a, -n));
  if (n === 1) return a;
  if (n % 2 === 1) return { lo: powE(ctx, a.lo, n, -1), hi: powE(ctx, a.hi, n, 1) };
  if (a.lo >= 0n) return { lo: powE(ctx, a.lo, n, -1), hi: powE(ctx, a.hi, n, 1) };
  if (a.hi <= 0n) return { lo: powE(ctx, a.hi, n, -1), hi: powE(ctx, a.lo, n, 1) };
  const m = -a.lo > a.hi ? a.lo : a.hi;
  return { lo: 0n, hi: powE(ctx, m, n, 1) };
}

export function abs(ctx, a) {
  if (!a) return null;
  if (a.lo >= 0n) return a;
  if (a.hi <= 0n) return neg(ctx, a);
  return { lo: 0n, hi: -a.lo > a.hi ? -a.lo : a.hi };
}

export function min(ctx, a, b) {
  if (!a || !b) return null;
  return { lo: a.lo < b.lo ? a.lo : b.lo, hi: a.hi < b.hi ? a.hi : b.hi };
}

export function max(ctx, a, b) {
  if (!a || !b) return null;
  return { lo: a.lo > b.lo ? a.lo : b.lo, hi: a.hi > b.hi ? a.hi : b.hi };
}

export function sqrt(ctx, a) {
  if (a && a.lo < 0n) clipped = true;
  if (!a || a.hi < 0n) return null;
  const lo = a.lo > 0n ? isqrt(a.lo << ctx.K) : 0n;
  let hi;
  if (!isFinite(a.hi)) hi = POS;
  else {
    const s = a.hi << ctx.K;
    const r = isqrt(s);
    hi = r * r === s ? r : r + 1n;
  }
  return { lo, hi };
}

// ---- transcendental functions -------------------------------------------------
//
// Each is computed at a working precision with guard bits, with an explicit
// bound on truncation and rounding error, and then rounded outward to ctx.

function guard(ctx, extra = 24) {
  return context(ctx.k + extra);
}

/** Rescale an interval from context `from` down to context `to` (outward). */
function rescale(from, to, iv) {
  if (!iv) return null;
  const s = from.K - to.K;
  return {
    lo: isFinite(iv.lo) ? iv.lo >> s : iv.lo,
    hi: isFinite(iv.hi) ? -((-iv.hi) >> s) : iv.hi,
  };
}

function lift(from, to, iv) {
  if (!iv) return null;
  const s = to.K - from.K;
  return { lo: isFinite(iv.lo) ? iv.lo << s : iv.lo, hi: isFinite(iv.hi) ? iv.hi << s : iv.hi };
}

/** atan(1/n) as an interval at context g (n a positive BigInt >= 2). */
function atanInv(g, n) {
  // Alternating series sum_j (-1)^j / ((2j+1) n^(2j+1)); every term is
  // floor-divided, so each term carries at most one ulp of error.
  let sum = 0n;
  let errUlps = 1n;
  const n2 = n * n;
  let j = 0n;
  let denom = n; // n^(2j+1), exact
  for (;;) {
    const term = g.one / ((2n * j + 1n) * denom);
    if (term === 0n) break;
    sum += j % 2n === 0n ? term : -term;
    errUlps += 1n;
    j += 1n;
    denom *= n2;
  }
  // Truncation error is at most the first omitted term, which floored to 0,
  // so it is below one ulp.
  return { lo: sum - errUlps - 1n, hi: sum + errUlps + 1n };
}

export function piInterval(ctx) {
  let v = ctx.cache.get("pi");
  if (v) return v;
  const g = guard(ctx, 16);
  const a = atanInv(g, 5n);
  const b = atanInv(g, 239n);
  // pi = 16 atan(1/5) - 4 atan(1/239)
  const lo = 16n * a.lo - 4n * b.hi;
  const hi = 16n * a.hi - 4n * b.lo;
  v = rescale(g, ctx, { lo, hi });
  ctx.cache.set("pi", v);
  return v;
}

/** 2 atanh(t) for an exact rational point t = tn/td with 0 <= t <= 1/3. */
function twoAtanh(g, tn, td) {
  // sum_j t^(2j+1)/(2j+1); remainder after N terms is below
  // t^(2N+1)/(2N+1) * 1/(1-t^2) <= (9/8) * next term.
  let sum = 0n;
  let errUlps = 1n;
  let num = tn;
  let den = td;
  const tn2 = tn * tn;
  const td2 = td * td;
  for (let j = 0n; ; j++) {
    const term = (g.one * num) / (den * (2n * j + 1n));
    if (term === 0n) break;
    sum += term;
    errUlps += 1n;
    num *= tn2;
    den *= td2;
    if (j > 100000n) break;
  }
  // Remainder: next term < 1 ulp, times 9/8, so < 2 ulps.
  return { lo: 2n * sum - 2n * errUlps, hi: 2n * (sum + errUlps + 2n) };
}

function ln2(ctx) {
  let v = ctx.cache.get("ln2");
  if (v) return v;
  v = twoAtanh(ctx, 1n, 3n);
  ctx.cache.set("ln2", v);
  return v;
}

/** Enclosure of log(m / one_g) for a positive fixed-point BigInt m. */
function logPoint(g, m) {
  // m / 2^k = f * 2^e with f in [1, 2): e = bitLength(m) - 1 - k.
  const bl = bitLength(m);
  const e = BigInt(bl - 1 - g.k);
  // f = m / 2^(bl-1), as the rational m / 2^(bl-1).
  const fd = 1n << BigInt(bl - 1);
  // t = (f - 1) / (f + 1) = (m - fd) / (m + fd), in [0, 1/3).
  const t = twoAtanh(g, m - fd, m + fd);
  const l2 = ln2(g);
  const eLo = e >= 0n ? e * l2.lo : e * l2.hi;
  const eHi = e >= 0n ? e * l2.hi : e * l2.lo;
  return { lo: t.lo + eLo, hi: t.hi + eHi };
}

export function log(ctx, a) {
  if (a && a.lo <= 0n) clipped = true;
  if (!a || a.hi <= 0n) return null;
  const g = guard(ctx);
  const up = lift(ctx, g, a);
  const lo = up.lo > 0n ? logPoint(g, up.lo).lo : NEG;
  const hi = isFinite(up.hi) ? logPoint(g, up.hi).hi : POS;
  return rescale(g, ctx, { lo, hi });
}

/** Enclosure of exp(m / one_g) for a finite fixed-point BigInt m. */
function expPoint(g, m) {
  // Large arguments: return a valid but loose enclosure; the viewport clips.
  const limit = 2000n * g.one;
  if (m > limit) return { lo: g.one << 1000n, hi: POS };
  if (m < -limit) return { lo: 0n, hi: 1n };
  // Range reduction: t = m / 2^s with |t| <= 1/2.
  let s = 0n;
  const half = g.one >> 1n;
  let am = m < 0n ? -m : m;
  while (am > half) {
    am >>= 1n;
    s += 1n;
  }
  // Work with t exactly as m / 2^(k+s) to avoid an extra rounding.
  const denShift = g.K + s;
  // Taylor: sum t^j / j!; every term floor-divided (error < 1 ulp each).
  let sum = 0n;
  let errUlps = 1n;
  let num = 1n; // m^j
  let fact = 1n; // j!
  let shift = 0n; // (k+s)*j
  for (let j = 0n; ; j++) {
    if (j > 0n) {
      num *= m;
      fact *= j;
      shift += denShift;
    }
    // term = one * m^j / (2^(shift) * j!)
    const full = (num << g.K) >> shift;
    const term = full / fact;
    if (term === 0n && j > 2n) break;
    sum += term;
    errUlps += 2n;
    if (j > 4000n) break;
  }
  // Truncation remainder for |t| <= 1/2: < 2 * next term < 2 ulps.
  let lo = sum - errUlps - 2n;
  let hi = sum + errUlps + 2n;
  if (lo < 0n) lo = 0n;
  // Undo the reduction: square s times (values positive, so monotone).
  for (let i = 0n; i < s; i++) {
    lo = (lo * lo) >> g.K;
    hi = -((-(hi * hi)) >> g.K);
  }
  return { lo, hi };
}

export function exp(ctx, a) {
  if (!a) return null;
  // Squaring after reduction loses about s bits, so add guard bits for it.
  const mag = Math.max(bitLengthOf(a.lo), bitLengthOf(a.hi)) - ctx.k;
  const g = guard(ctx, 24 + Math.max(0, mag) * 2);
  const up = lift(ctx, g, a);
  const lo = isFinite(up.lo) ? expPoint(g, up.lo).lo : 0n;
  const hi = isFinite(up.hi) ? expPoint(g, up.hi).hi : POS;
  return rescale(g, ctx, { lo, hi });
}

function bitLengthOf(v) {
  return isFinite(v) ? bitLength(v) : 0;
}

/** Taylor enclosure of sin or cos on a narrow interval t with |t| <= 1. */
function sinCosSmall(g, t, which) {
  // Evaluate at the midpoint and widen by the radius (|derivative| <= 1).
  const mid = (t.lo + t.hi) >> 1n;
  const rad = t.hi - mid + 1n;
  let sum = 0n;
  let errUlps = 1n;
  let term = which === "sin" ? mid : g.one;
  let j = which === "sin" ? 1n : 0n;
  const m2 = mid * mid;
  for (let i = 0n; ; i++) {
    if (term === 0n) break;
    sum += i % 2n === 0n ? term : -term;
    errUlps += 1n;
    // next term: term * mid^2 / (one^2 * (j+1)(j+2))
    term = (term * m2) / (g.one * g.one * (j + 1n) * (j + 2n));
    j += 2n;
    if (i > 2000n) break;
  }
  // Alternating series with decreasing terms (|mid| <= 1): the remainder is
  // below the first omitted term, which floored to 0, so below one ulp.
  return { lo: sum - errUlps - 1n - rad, hi: sum + errUlps + 1n + rad };
}

/** Enclosure of sin(x) for a narrow fixed-point interval x at context g. */
function sinNarrow(g, x) {
  const pi = piInterval(g);
  // q = nearest integer to x / (pi/2), chosen with floats (any q is valid).
  const xf = Number(x.lo >> (g.K > 40n ? g.K - 40n : 0n)) / 2 ** Math.min(g.k, 40);
  const q = BigInt(Math.round(xf / (Math.PI / 2)));
  // t = x - q*pi/2 as an interval.
  const qpLo = q >= 0n ? q * pi.lo : q * pi.hi;
  const qpHi = q >= 0n ? q * pi.hi : q * pi.lo;
  const t = { lo: x.lo - ceilDiv(qpHi, 2n), hi: x.hi - floorDiv(qpLo, 2n) };
  const r = ((q % 4n) + 4n) % 4n;
  if (r === 0n) return sinCosSmall(g, t, "sin");
  if (r === 1n) return sinCosSmall(g, t, "cos");
  const v = sinCosSmall(g, t, r === 2n ? "sin" : "cos");
  return { lo: -v.hi, hi: -v.lo };
}

function clampUnit(g, iv) {
  return {
    lo: iv.lo < -g.one ? -g.one : iv.lo,
    hi: iv.hi > g.one ? g.one : iv.hi,
  };
}

/** sin over an interval: endpoint values plus any extremum inside. */
export function sin(ctx, a) {
  return sinShift(ctx, a, 0);
}

export function cos(ctx, a) {
  // cos(x) = sin(x + pi/2)
  return sinShift(ctx, a, 1);
}

function sinShift(ctx, a, quarter) {
  if (!a) return null;
  if (!isFinite(a.lo) || !isFinite(a.hi)) return { lo: -ctx.one, hi: ctx.one };
  if (a.hi - a.lo >= 7n * ctx.one) return { lo: -ctx.one, hi: ctx.one };
  const g = guard(ctx);
  const pi = piInterval(g);
  let x = lift(ctx, g, a);
  if (quarter) {
    x = { lo: x.lo + (pi.lo >> 1n), hi: x.hi + ceilDiv(pi.hi, 2n) };
  }
  const lo = sinNarrow(g, { lo: x.lo, hi: x.lo });
  const hi = sinNarrow(g, { lo: x.hi, hi: x.hi });
  let res = hull(lo, hi);
  // Extrema of sin at pi/2 + j*pi. Enumerate candidate j with floats and test
  // each rigorously with the pi enclosure.
  const scale = 2 ** g.k;
  const xl = Number(x.lo) / scale;
  const xh = Number(x.hi) / scale;
  const j0 = Math.floor((xl - Math.PI / 2) / Math.PI) - 1;
  const j1 = Math.ceil((xh - Math.PI / 2) / Math.PI) + 1;
  for (let j = j0; j <= j1; j++) {
    const J = BigInt(2 * j + 1); // critical point = J * pi / 2
    const cLo = J >= 0n ? floorDiv(J * pi.lo, 2n) : floorDiv(J * pi.hi, 2n);
    const cHi = J >= 0n ? ceilDiv(J * pi.hi, 2n) : ceilDiv(J * pi.lo, 2n);
    if (cHi < x.lo || cLo > x.hi) continue;
    // sin(J*pi/2) = +1 when j is even, -1 when odd.
    const v = j % 2 === 0 ? g.one : -g.one;
    res = hull(res, { lo: v, hi: v });
  }
  return rescale(g, ctx, clampUnit(g, res));
}

/**
 * a^c for an exponent interval c > 0, on the domain a >= 0 (0^c = 0).
 * x^c is increasing on [0, inf) for c > 0, so the ends of a give the ends.
 */
export function powPos(ctx, a, c) {
  if (a && a.lo < 0n) clipped = true;
  if (!a || !c || a.hi < 0n) return null;
  const at = (m) => exp(ctx, mul(ctx, c, log(ctx, { lo: m, hi: m })));
  const lo = a.lo > 0n ? at(a.lo).lo : 0n;
  const hi = !isFinite(a.hi) ? POS : a.hi === 0n ? 0n : at(a.hi).hi;
  return { lo, hi };
}

export function tan(ctx, a) {
  return div(ctx, sin(ctx, a), cos(ctx, a));
}

// ---- functions borrowed from @ratmath/analytic ------------------------------------
//
// atan, asin, acos, sinh, cosh, tanh, log1p, cbrt and erf are evaluated at the
// two ends of the interval with analytic's certified point enclosures and
// rounded outward to this precision. All of them are monotone (cosh on each
// side of 0), so the ends give the range.

/** Certified [lo, hi] of f at one finite endpoint. */
function pointOf(ctx, name, m) {
  const key = `${name}:${m}`;
  let r = ctx.cache.get(key);
  if (!r) {
    const iv = analytic[name](new Rational(m, ctx.one), ctx.k + 8);
    r = { lo: floorDiv(iv.low.numerator << ctx.K, iv.low.denominator), hi: ceilDiv(iv.high.numerator << ctx.K, iv.high.denominator) };
    if (ctx.cache.size > 20000) ctx.cache.clear();
    ctx.cache.set(key, r);
  }
  return r;
}

/** An increasing function from its values at the ends; `atNeg` / `atPos` are the limits at −∞ and +∞ as functions of ctx. */
function increasing(name, atNeg, atPos) {
  return (ctx, a) => {
    if (!a) return null;
    const lo = isFinite(a.lo) ? pointOf(ctx, name, a.lo).lo : atNeg(ctx);
    const hi = isFinite(a.hi) ? pointOf(ctx, name, a.hi).hi : atPos(ctx);
    return { lo, hi };
  };
}

const halfPi = (ctx, sign) => {
  const pi = piInterval(ctx);
  return sign < 0 ? floorDiv(-pi.hi, 2n) : ceilDiv(pi.hi, 2n);
};

export const atan = increasing("atan", (c) => halfPi(c, -1), (c) => halfPi(c, 1));
export const sinh = increasing("sinh", () => NEG, () => POS);
export const tanh = increasing("tanh", (c) => -c.one, (c) => c.one);
export const cbrt = increasing("cbrt", () => NEG, () => POS);
export const erf = increasing("erf", (c) => -c.one, (c) => c.one);

/** The part of a inside [-1, 1], flagging a cut. */
function unitDomain(ctx, a) {
  if (!a) return null;
  if (a.lo < -ctx.one || a.hi > ctx.one) clipped = true;
  if (a.hi < -ctx.one || a.lo > ctx.one) return null;
  return { lo: a.lo < -ctx.one ? -ctx.one : a.lo, hi: a.hi > ctx.one ? ctx.one : a.hi };
}

export function asin(ctx, a) {
  const d = unitDomain(ctx, a);
  return d && { lo: pointOf(ctx, "asin", d.lo).lo, hi: pointOf(ctx, "asin", d.hi).hi };
}

export function acos(ctx, a) {
  const d = unitDomain(ctx, a);
  return d && { lo: pointOf(ctx, "acos", d.hi).lo, hi: pointOf(ctx, "acos", d.lo).hi };
}

export function cosh(ctx, a) {
  const m = abs(ctx, a);
  if (!m) return null;
  return { lo: pointOf(ctx, "cosh", m.lo).lo, hi: isFinite(m.hi) ? pointOf(ctx, "cosh", m.hi).hi : POS };
}

export function log1p(ctx, a) {
  if (!a) return null;
  return log(ctx, add(ctx, a, { lo: ctx.one, hi: ctx.one }));
}

/** a^(p/q) for an odd q: the real root, defined for negative a (and for a = 0 when p > 0). */
export function powOddRoot(ctx, a, p, q) {
  if (!a) return null;
  const root = (m, dir) => {
    if (!isFinite(m)) return m;
    if (m === 0n) return 0n;
    if (q === 3) return dir < 0 ? pointOf(ctx, "cbrt", m).lo : pointOf(ctx, "cbrt", m).hi;
    // |m|^(1/q) through exp and log, with the sign put back
    const pos = m > 0n ? m : -m;
    const e = fromRational(ctx, 1n, BigInt(q));
    const r = exp(ctx, mul(ctx, e, log(ctx, { lo: pos, hi: pos })));
    return m > 0n ? (dir < 0 ? r.lo : r.hi) : dir < 0 ? -r.hi : -r.lo;
  };
  return powInt(ctx, { lo: root(a.lo, -1), hi: root(a.hi, 1) }, p);
}

// ---- conversions ---------------------------------------------------------------

export function toNumber(ctx, v) {
  if (!isFinite(v)) return v;
  const shift = ctx.k > 52 ? BigInt(ctx.k - 52) : 0n;
  return Number(v >> shift) / 2 ** (ctx.k - Number(shift));
}

/** An endpoint as an exact Core-style pair [numerator, denominator] (finite only). */
export function toFraction(ctx, v) {
  return [v, ctx.one];
}
