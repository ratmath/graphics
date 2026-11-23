// Exact numbers of the form a + b·√d, where a and b are rationals and d is a
// square-free positive integer. These are what ruler-and-compass geometry
// produces from rational input: a line meets a circle at points with
// coordinates p ± q√d, and two circles meet on their radical axis, which
// again reduces to a line and a circle.
//
// Arithmetic stays exact within one field Q(√d). Two surds with different d
// combine only when one of them is rational, or when d1·d2 is a perfect
// square (then √d1 is a rational multiple of √d2). Anything else, such as
// √2 + √3, throws: that needs @ratmath/algebraic.
//
// Signs and comparisons are exact: the sign of a + b√d comes from comparing
// a² with b²d.

import { Rational } from "@ratmath/core";
import { toRational } from "./expr.js";
import { isqrt } from "./interval.js";

const ZERO = new Rational(0n);
const sgn = (r) => (r.numerator > 0n ? 1 : r.numerator < 0n ? -1 : 0);
const ONE = new Rational(1n);

const SMALL_PRIMES = (() => {
  const out = [];
  for (let n = 2; n < 1000; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out.map(BigInt);
})();

/**
 * Split a positive integer n as s²·d with d square-free as far as trial
 * division by primes below 1000 (and a final perfect-square test) can tell.
 * Returns [s, d] as BigInts.
 */
export function squareFree(n) {
  if (n <= 0n) throw new RangeError("squareFree needs a positive integer");
  let s = 1n;
  let d = n;
  for (const p of SMALL_PRIMES) {
    const pp = p * p;
    if (pp > d) break;
    while (d % pp === 0n) {
      d /= pp;
      s *= p;
    }
  }
  const r = isqrt(d);
  if (r * r === d) {
    s *= r;
    d = 1n;
  }
  return [s, d];
}

function rat(x) {
  if (x instanceof Rational) return x;
  if (x instanceof Surd) {
    if (!x.isRational) throw new TypeError(`${x} is not rational`);
    return x.a;
  }
  return toRational(x);
}

export class Surd {
  /** a + b·√d. Use `surd()` or `Surd.sqrt()` to build one; d is normalized here. */
  constructor(a, b = ZERO, d = 1n) {
    a = rat(a);
    b = rat(b);
    d = BigInt(d);
    if (d < 0n) throw new RangeError("Surd needs d >= 0 (complex values are not supported)");
    if (d === 0n || b.numerator === 0n) {
      b = ZERO;
      d = 1n;
    } else if (d !== 1n) {
      const [s, f] = squareFree(d);
      if (s !== 1n) b = b.multiply(new Rational(s));
      d = f;
    }
    if (d === 1n && b.numerator !== 0n) {
      a = a.add(b);
      b = ZERO;
    }
    this.a = a;
    this.b = b;
    this.d = d;
    Object.freeze(this);
  }

  static from(x) {
    return x instanceof Surd ? x : new Surd(rat(x));
  }

  /** √q for a rational q >= 0, exactly: (s/den)·√f. */
  static sqrt(q) {
    if (q instanceof Surd) {
      if (!q.isRational) throw new RangeError(`√(${q}) is a nested radical; that needs @ratmath/algebraic`);
      q = q.a;
    }
    q = rat(q);
    if (q.numerator < 0n) throw new RangeError(`√ of a negative number: ${q}`);
    if (q.numerator === 0n) return new Surd(ZERO);
    // √(n/m) = √(n·m)/m
    const [s, f] = squareFree(q.numerator * q.denominator);
    return new Surd(ZERO, new Rational(s, q.denominator), f);
  }

  get isRational() {
    return this.b.numerator === 0n;
  }

  get isZero() {
    return this.a.numerator === 0n && this.b.numerator === 0n;
  }

  /** The value as a Rational; throws when it is irrational. */
  toRational() {
    if (!this.isRational) throw new TypeError(`${this} is not rational`);
    return this.a;
  }

  /** Bring two surds into one field Q(√d). Returns [x, y, d] with x, y as [a, b] pairs. */
  static #align(x, y) {
    if (x.isRational || y.isRational || x.d === y.d) {
      const d = x.isRational ? y.d : x.d;
      return [[x.a, x.b], [y.a, y.b], d];
    }
    // √d1 = (s/d2)·√d2 when d1·d2 = s².
    const p = x.d * y.d;
    const s = isqrt(p);
    if (s * s === p) return [[x.a, x.b.multiply(new Rational(s, y.d))], [y.a, y.b], y.d];
    throw new RangeError(`${x} and ${y} lie in different fields Q(√${x.d}) and Q(√${y.d}); combining them needs @ratmath/algebraic`);
  }

  add(o) {
    o = Surd.from(o);
    const [[a, b], [c, e], d] = Surd.#align(this, o);
    return new Surd(a.add(c), b.add(e), d);
  }

  subtract(o) {
    o = Surd.from(o);
    const [[a, b], [c, e], d] = Surd.#align(this, o);
    return new Surd(a.subtract(c), b.subtract(e), d);
  }

  negate() {
    return new Surd(this.a.negate(), this.b.negate(), this.d);
  }

  multiply(o) {
    o = Surd.from(o);
    const [[a, b], [c, e], d] = Surd.#align(this, o);
    // (a + b√d)(c + e√d) = ac + be·d + (ae + bc)√d
    return new Surd(a.multiply(c).add(b.multiply(e).multiply(new Rational(d))), a.multiply(e).add(b.multiply(c)), d);
  }

  /** a − b√d. */
  conjugate() {
    return new Surd(this.a, this.b.negate(), this.d);
  }

  /** a² − b²d, a rational. */
  norm() {
    return this.a.multiply(this.a).subtract(this.b.multiply(this.b).multiply(new Rational(this.d)));
  }

  reciprocal() {
    if (this.isZero) throw new RangeError("division by zero");
    const n = this.norm();
    return new Surd(this.a.divide(n), this.b.negate().divide(n), this.d);
  }

  divide(o) {
    return this.multiply(Surd.from(o).reciprocal());
  }

  square() {
    return this.multiply(this);
  }

  /** Exact sign: -1, 0 or 1. */
  sign() {
    const sa = sgn(this.a);
    const sb = sgn(this.b);
    if (sb === 0) return sa;
    if (sa === 0 || sa === sb) return sb;
    // Opposite signs: the larger of a² and b²d wins (they are never equal, d is not a square).
    const a2 = this.a.multiply(this.a);
    const b2d = this.b.multiply(this.b).multiply(new Rational(this.d));
    return a2.greaterThan(b2d) ? sa : sb;
  }

  compareTo(o) {
    return this.subtract(o).sign();
  }

  equals(o) {
    try {
      return this.subtract(o).isZero;
    } catch {
      return false; // different quadratic fields: equal only if both rational, handled above
    }
  }

  lessThan(o) {
    return this.compareTo(o) < 0;
  }

  abs() {
    return this.sign() < 0 ? this.negate() : this;
  }

  /** √ of this value, when it is rational. */
  sqrt() {
    return Surd.sqrt(this);
  }

  /**
   * Rational bounds [lo, hi] with lo <= value <= hi and hi - lo <= 2^-bits
   * (times |b|). Exact when the value is rational.
   */
  bounds(bits = 64) {
    if (this.isRational) return [this.a, this.a];
    const K = BigInt(bits);
    const r = isqrt(this.d << (2n * K)); // floor(√d · 2^K)
    const lo = new Rational(r, 1n << K);
    const hi = new Rational(r + 1n, 1n << K);
    const [p, q] = this.b.numerator > 0n ? [lo, hi] : [hi, lo];
    return [this.a.add(this.b.multiply(p)), this.a.add(this.b.multiply(q))];
  }

  toNumber() {
    return this.a.toNumber() + this.b.toNumber() * Math.sqrt(Number(this.d));
  }

  toString() {
    if (this.isRational) return this.a.toString();
    const root = `√${this.d}`;
    const b = this.b.abs();
    const bs = b.equals(ONE) ? root : b.denominator === 1n ? `${b.numerator}${root}` : `${b.numerator === 1n ? "" : b.numerator}${root}/${b.denominator}`;
    if (this.a.numerator === 0n) return this.b.numerator < 0n ? `-${bs}` : bs;
    return `${this.a} ${this.b.numerator < 0n ? "-" : "+"} ${bs}`;
  }

  /** LaTeX, such as \frac{1}{2} + \frac{3}{2}\sqrt{5}. */
  toTeX() {
    const q = (r) => (r.denominator === 1n ? `${r.numerator}` : `\\frac{${r.numerator < 0n ? -r.numerator : r.numerator}}{${r.denominator}}`);
    const signed = (r) => (r.numerator < 0n && r.denominator !== 1n ? `-${q(r)}` : q(r));
    if (this.isRational) return signed(this.a);
    const b = this.b.abs();
    const root = `\\sqrt{${this.d}}`;
    const bs = b.equals(ONE) ? root : b.denominator === 1n ? `${b.numerator}${root}` : `\\frac{${b.numerator === 1n ? "" : b.numerator}${root}}{${b.denominator}}`;
    if (this.a.numerator === 0n) return this.b.numerator < 0n ? `-${bs}` : bs;
    return `${signed(this.a)} ${this.b.numerator < 0n ? "-" : "+"} ${bs}`;
  }

  toJSON() {
    return this.isRational ? this.a.toString() : { a: this.a.toString(), b: this.b.toString(), d: this.d.toString() };
  }
}

/** A surd from a number, string ("3/4"), Rational or Surd; `surd(a, b, d)` is a + b√d. */
export function surd(a, b, d) {
  if (b === undefined) return Surd.from(a);
  return new Surd(rat(a), rat(b), BigInt(d));
}

export const sqrt = (q) => Surd.sqrt(q);
