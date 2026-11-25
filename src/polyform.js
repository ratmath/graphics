// Polynomials and rational functions in one or two variables with exact
// rational coefficients, read off an expression tree.
//
// A polynomial is a Map from "i,j" (the exponents of the two variables) to a
// non-zero Core Rational. Used to recognise conics in region conditions and
// to find the polynomial whose roots are a graph's zeros, extrema and
// inflection points.

import { Rational } from "@ratmath/core";
import { integerExponent, paramsToRational } from "./expr.js";

const ZERO = new Rational(0n);
const ONE = new Rational(1n);
const MAX_DEGREE = 48;

export const constant = (c) => (c.numerator === 0n ? new Map() : new Map([["0,0", c]]));
const exps = (key) => key.split(",").map(Number);

export function addPoly(a, b, sign = 1) {
  const out = new Map(a);
  for (const [k, c] of b) {
    const s = (out.get(k) ?? ZERO).add(sign < 0 ? c.negate() : c);
    if (s.numerator === 0n) out.delete(k);
    else out.set(k, s);
  }
  return out;
}

export function mulPoly(a, b) {
  const out = new Map();
  for (const [ka, ca] of a) {
    const [i, j] = exps(ka);
    for (const [kb, cb] of b) {
      const [m, n] = exps(kb);
      if (i + m + j + n > MAX_DEGREE) throw new RangeError("polynomial degree too high");
      const k = `${i + m},${j + n}`;
      const s = (out.get(k) ?? ZERO).add(ca.multiply(cb));
      if (s.numerator === 0n) out.delete(k);
      else out.set(k, s);
    }
  }
  return out;
}

export function powPoly(a, n) {
  let out = constant(ONE);
  for (let i = 0; i < n; i += 1) out = mulPoly(out, a);
  return out;
}

export const totalDegree = (p) => {
  let d = -1;
  for (const k of p.keys()) {
    const [i, j] = exps(k);
    d = Math.max(d, i + j);
  }
  return d;
};
export const coefficient = (p, i, j = 0) => p.get(`${i},${j}`) ?? ZERO;

/**
 * The tree as a quotient of two polynomials in the named variables (one or
 * two), parameters replaced by their exact values: { num, den }. Returns
 * null when the tree is not a rational function of them.
 */
export function rationalForm(ast, variables, params = {}) {
  const rp = paramsToRational(params);
  const frac = (num, den = constant(ONE)) => ({ num, den });
  const go = (n) => {
    switch (n.type) {
      case "num":
        return frac(constant(n.value));
      case "var": {
        const idx = variables.indexOf(n.name);
        if (idx === 0) return frac(new Map([["1,0", ONE]]));
        if (idx === 1) return frac(new Map([["0,1", ONE]]));
        const val = rp[n.name];
        if (!val) return null;
        return frac(constant(val));
      }
      case "op": {
        if (n.op === "^") {
          const k = integerExponent(n.args[1]);
          const a = go(n.args[0]);
          if (k === null || !a || Math.abs(k) > MAX_DEGREE) return null;
          const p = frac(powPoly(a.num, Math.abs(k)), powPoly(a.den, Math.abs(k)));
          if (k >= 0) return p;
          return p.num.size ? frac(p.den, p.num) : null;
        }
        const a = go(n.args[0]);
        if (!a) return null;
        if (n.op === "neg") return frac(addPoly(new Map(), a.num, -1), a.den);
        const b = go(n.args[1]);
        if (!b) return null;
        const same = b.den.size === 1 && a.den.size === 1 && a.den.get("0,0")?.equals(ONE) && b.den.get("0,0")?.equals(ONE);
        switch (n.op) {
          case "+":
          case "-":
            if (same) return frac(addPoly(a.num, b.num, n.op === "-" ? -1 : 1));
            return frac(addPoly(mulPoly(a.num, b.den), mulPoly(b.num, a.den), n.op === "-" ? -1 : 1), mulPoly(a.den, b.den));
          case "*":
            return frac(mulPoly(a.num, b.num), mulPoly(a.den, b.den));
          case "/":
            return b.num.size ? frac(mulPoly(a.num, b.den), mulPoly(a.den, b.num)) : null;
        }
        return null;
      }
    }
    return null;
  };
  try {
    return go(ast);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** A polynomial in the first variable only as integer coefficients, constant first (scaled to clear denominators), or null. */
export function integerCoefficients(p) {
  let deg = -1;
  for (const k of p.keys()) {
    const [i, j] = exps(k);
    if (j !== 0) return null;
    deg = Math.max(deg, i);
  }
  if (deg < 0) return [];
  const g = (a, b) => (b ? g(b, a % b) : a < 0n ? -a : a);
  let L = 1n;
  for (const c of p.values()) L = (L * c.denominator) / g(L, c.denominator);
  return Array.from({ length: deg + 1 }, (_, i) => {
    const c = coefficient(p, i);
    return c.numerator * (L / c.denominator);
  });
}
