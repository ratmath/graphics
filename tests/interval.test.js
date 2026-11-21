import { describe, expect, test } from "bun:test";
import { Rational } from "@ratmath/core";
import * as I from "../src/interval.js";

const ctx = I.context(48);
const ref = I.context(240);

// A deterministic pseudo-random generator so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randRational(r, scale = 10) {
  const d = BigInt(1 + Math.floor(r() * 997));
  const n = BigInt(Math.floor((r() * 2 - 1) * scale * Number(d)));
  return new Rational(n, d);
}

/** Does the fixed-point interval at ctx contain the exact rational q? */
function containsRational(c, iv, q) {
  // lo/2^k <= n/d <= hi/2^k
  const n = q.numerator << c.K;
  const d = q.denominator;
  const loOk = !I.isFinite(iv.lo) || iv.lo * d <= n;
  const hiOk = !I.isFinite(iv.hi) || iv.hi * d >= n;
  return loOk && hiOk;
}

/** Does iv (at c) contain the reference interval r (at ref)? */
function containsRef(c, iv, r) {
  const s = ref.K - c.K;
  return (iv.lo << s) <= r.lo && (iv.hi << s) >= r.hi;
}

describe("rational operations enclose the exact result", () => {
  const r = rng(7);
  test("add, sub, mul, div, powInt over random rationals", () => {
    for (let t = 0; t < 400; t++) {
      const a = randRational(r);
      const b = randRational(r);
      const A = I.fromRational(ctx, a.numerator, a.denominator);
      const B = I.fromRational(ctx, b.numerator, b.denominator);
      expect(containsRational(ctx, A, a)).toBe(true);
      expect(containsRational(ctx, I.add(ctx, A, B), a.add(b))).toBe(true);
      expect(containsRational(ctx, I.sub(ctx, A, B), a.subtract(b))).toBe(true);
      expect(containsRational(ctx, I.mul(ctx, A, B), a.multiply(b))).toBe(true);
      if (b.numerator !== 0n) expect(containsRational(ctx, I.div(ctx, A, B), a.divide(b))).toBe(true);
      const n = 1 + Math.floor(r() * 6);
      expect(containsRational(ctx, I.powInt(ctx, A, n), a.pow(n))).toBe(true);
      if (a.numerator !== 0n) expect(containsRational(ctx, I.powInt(ctx, A, -n), a.pow(-n))).toBe(true);
    }
  });

  test("even powers of an interval straddling zero start at zero", () => {
    const X = { lo: -ctx.one, hi: 2n * ctx.one };
    expect(I.powInt(ctx, X, 2)).toEqual({ lo: 0n, hi: 4n * ctx.one });
  });

  test("division by an interval containing zero", () => {
    const one = I.fromRational(ctx, 1n);
    expect(I.div(ctx, one, { lo: -ctx.one, hi: ctx.one })).toEqual(I.WHOLE);
    expect(I.div(ctx, one, { lo: 0n, hi: 0n })).toBe(null);
    const r = I.div(ctx, one, { lo: 0n, hi: ctx.one });
    expect(r.lo).toBe(ctx.one);
    expect(r.hi).toBe(Infinity);
  });

  test("sqrt encloses and respects the domain", () => {
    for (const [n, d] of [[2n, 1n], [9n, 4n], [1n, 3n], [10n ** 20n, 7n]]) {
      const X = I.fromRational(ctx, n, d);
      const S = I.sqrt(ctx, X);
      // S.lo^2 <= n/d <= S.hi^2 (scaled)
      expect(S.lo * S.lo * d <= n << (2n * ctx.K)).toBe(true);
      expect(S.hi * S.hi * d >= n << (2n * ctx.K)).toBe(true);
    }
    expect(I.sqrt(ctx, { lo: -2n * ctx.one, hi: -ctx.one })).toBe(null);
    expect(I.sqrt(ctx, { lo: -ctx.one, hi: 4n * ctx.one })).toEqual({ lo: 0n, hi: 2n * ctx.one });
  });
});

describe("transcendental enclosures", () => {
  const r = rng(11);
  const fns = ["exp", "log", "sin", "cos"];
  test("low-precision enclosures contain high-precision ones", () => {
    for (let t = 0; t < 150; t++) {
      const a = randRational(r, 30);
      for (const f of fns) {
        if (f === "log" && a.numerator <= 0n) continue;
        const lo = I[f](ctx, I.fromRational(ctx, a.numerator, a.denominator));
        const hi = I[f](ref, I.fromRational(ref, a.numerator, a.denominator));
        expect(containsRef(ctx, lo, hi)).toBe(true);
      }
    }
  });

  test("point enclosures agree with Math to double precision and are narrow", () => {
    for (let t = 0; t < 200; t++) {
      const a = randRational(r, 20);
      const x = a.toNumber();
      for (const [f, m] of [["exp", Math.exp], ["sin", Math.sin], ["cos", Math.cos], ["log", Math.log]]) {
        if (f === "log" && x <= 0) continue;
        if (f === "exp" && x > 30) continue;
        const iv = I[f](ctx, I.fromRational(ctx, a.numerator, a.denominator));
        const lo = I.toNumber(ctx, iv.lo);
        const hi = I.toNumber(ctx, iv.hi);
        const tol = 1e-9 * Math.max(1, Math.abs(m(x)));
        expect(lo).toBeLessThanOrEqual(m(x) + tol);
        expect(hi).toBeGreaterThanOrEqual(m(x) - tol);
        expect(hi - lo).toBeLessThan(1e-9 * Math.max(1, Math.abs(m(x))));
      }
    }
  });

  test("pi is enclosed", () => {
    const p = I.piInterval(ref);
    // 3.14159265358979323846264338327950288419716939937510 (50 digits)
    const piDigits = new Rational(314159265358979323846264338327950288419716939937510n, 10n ** 50n);
    const lo = new Rational(p.lo, ref.one);
    const hi = new Rational(p.hi, ref.one);
    const err = new Rational(1n, 10n ** 49n);
    expect(lo.lessThanOrEqual(piDigits.add(err))).toBe(true);
    expect(hi.greaterThanOrEqual(piDigits.subtract(err))).toBe(true);
  });

  test("sin over a wide interval includes its extrema", () => {
    const s = I.sin(ctx, { lo: ctx.one, hi: 2n * ctx.one }); // contains pi/2
    expect(s.hi).toBe(ctx.one);
    const c = I.cos(ctx, { lo: 3n * ctx.one, hi: 4n * ctx.one }); // contains pi
    expect(c.lo).toBe(-ctx.one);
    expect(I.sin(ctx, { lo: 0n, hi: 10n * ctx.one })).toEqual({ lo: -ctx.one, hi: ctx.one });
  });

  test("log is undefined for non-positive input and unbounded at zero", () => {
    expect(I.log(ctx, { lo: -ctx.one, hi: 0n })).toBe(null);
    expect(I.log(ctx, { lo: 0n, hi: ctx.one }).lo).toBe(-Infinity);
  });
});
