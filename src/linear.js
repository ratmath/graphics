// Recognize expressions that are affine in x and y with rational
// coefficients (a·x + b·y + c), so regions bounded by lines can be computed
// as exact polygons instead of pixel by pixel.

import { Rational } from "@ratmath/core";
import { integerExponent, paramsToRational, parse } from "./expr.js";

const Z = new Rational(0n);

/**
 * { a, b, c } (Rationals) with expr = a·x + b·y + c, or null when the
 * expression is not affine in x and y with rational coefficients. Other names
 * are read from params.
 */
export function linearForm(f, params = {}, { x = "x", y = "y" } = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  const P = paramsToRational(params);
  const go = (n) => {
    switch (n.type) {
      case "num":
        return { a: Z, b: Z, c: n.value };
      case "var":
        if (n.name === x) return { a: new Rational(1n), b: Z, c: Z };
        if (n.name === y) return { a: Z, b: new Rational(1n), c: Z };
        if (P[n.name]) return { a: Z, b: Z, c: P[n.name] };
        return null;
      case "op": {
        const [u, w] = n.args.map(go);
        if (!u || (n.args.length > 1 && !w)) return null;
        const isConst = (t) => t.a.numerator === 0n && t.b.numerator === 0n;
        const scale = (t, k) => ({ a: t.a.multiply(k), b: t.b.multiply(k), c: t.c.multiply(k) });
        switch (n.op) {
          case "+": return { a: u.a.add(w.a), b: u.b.add(w.b), c: u.c.add(w.c) };
          case "-": return { a: u.a.subtract(w.a), b: u.b.subtract(w.b), c: u.c.subtract(w.c) };
          case "neg": return scale(u, new Rational(-1n));
          case "*":
            if (isConst(u)) return scale(w, u.c);
            if (isConst(w)) return scale(u, w.c);
            return null;
          case "/":
            if (!isConst(w) || w.c.numerator === 0n) return null;
            return scale(u, w.c.reciprocal());
          case "^": {
            const k = integerExponent(n.args[1]);
            if (k === null) return null;
            if (isConst(u)) {
              if (u.c.numerator === 0n && k <= 0) return null;
              return { a: Z, b: Z, c: u.c.pow(k) };
            }
            return k === 1 ? u : null;
          }
        }
        return null;
      }
      default:
        return null; // constants pi, e and function calls are not rational-affine
    }
  };
  return go(ast);
}
