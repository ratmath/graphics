// Expressions: a small AST, a parser for conventional calculator notation, and
// three compilers that share it:
//
//   compileFloat(ast)    -> (x, params) => number              fast previews
//   compileInterval(ast) -> (ctx, X, P) => interval | null     certified enclosures
//   compileExact(ast)    -> (x, params) => Rational | null | undefined
//                            exact values for rational-only expressions
//                            (undefined when the expression is not rational-only)
//
// The AST is deliberately plain so the calculator can build it from its own
// parser instead of going through a string.

import { Rational } from "@ratmath/core";
import { num, v, op, call, toRational, parse, freeVariables, FUNCTIONS, CONSTANTS, erfFloat } from "@ratmath/analytic";
import * as I from "./interval.js";

// ---- AST, parser ------------------------------------------------------------------
//
// The grammar, the AST builders and the number reader live in
// @ratmath/analytic, so both libraries read the same notation and can pass
// parse trees to each other.

export { num, v, op, call, toRational, parse, freeVariables, FUNCTIONS, CONSTANTS };

// Functions that are not rational even at rational points.
const EXACT_CALLS = new Set(["abs", "min", "max"]);

/** p/q for a constant exponent with an odd denominator q > 1 (a real root, defined for negative bases), else null. */
export function oddRootExponent(ast) {
  const c = constValue(ast);
  if (!c || c.denominator === 1n || c.denominator % 2n === 0n) return null;
  if (c.denominator > 99n || c.numerator > 4096n || c.numerator < -4096n) return null;
  return { p: Number(c.numerator), q: Number(c.denominator) };
}

/** True when the expression uses only + - * / and integer powers (no pi, sin, ...). */
export function isRationalOnly(ast) {
  switch (ast.type) {
    case "num":
    case "var":
      return true;
    case "const":
    case "call":
      return ast.type === "call" && EXACT_CALLS.has(ast.name) ? ast.args.every(isRationalOnly) : false;
    case "op":
      if (ast.op === "^") return integerExponent(ast.args[1]) !== null && isRationalOnly(ast.args[0]);
      return ast.args.every(isRationalOnly);
  }
  return false;
}

/**
 * The exact value of a constant, rational-only subexpression (no variables,
 * no pi or functions), or null. So `1/2`, `-3` and `(1/2 - 1)` are constants.
 */
export function constValue(ast) {
  switch (ast.type) {
    case "num":
      return ast.value;
    case "op": {
      const vals = ast.args.map(constValue);
      if (vals.some((x) => x === null)) return null;
      const [a, b] = vals;
      switch (ast.op) {
        case "+": return a.add(b);
        case "-": return a.subtract(b);
        case "*": return a.multiply(b);
        case "/": return b.numerator === 0n ? null : a.divide(b);
        case "neg": return a.negate();
        case "^": {
          if (b.denominator !== 1n || b.numerator > 4096n || b.numerator < -4096n) return null;
          if (a.numerator === 0n && b.numerator <= 0n) return null;
          return a.pow(Number(b.numerator));
        }
      }
    }
  }
  return null;
}

/** The exponent as a JS integer when it is a constant integer. */
export function integerExponent(ast) {
  const c = constValue(ast);
  if (c && c.denominator === 1n && c.numerator >= -4096n && c.numerator <= 4096n) return Number(c.numerator);
  return null;
}

// ---- float compiler -----------------------------------------------------------------------

/**
 * Compile to a closure over doubles. `variable` names the plotted variable
 * (default "x"); other names are read from the params object, which should
 * hold plain numbers (see `paramsToFloat`).
 */
export function compileFloat(ast, variable = "x") {
  const go = (n) => {
    switch (n.type) {
      case "num": {
        const c = n.value.toNumber();
        return () => c;
      }
      case "const": {
        const c = n.name === "pi" ? Math.PI : Math.E;
        return () => c;
      }
      case "var":
        if (n.name === variable) return (x) => x;
        return (x, p) => p[n.name];
      case "op": {
        const [a, b] = n.args.map(go);
        switch (n.op) {
          case "+": return (x, p) => a(x, p) + b(x, p);
          case "-": return (x, p) => a(x, p) - b(x, p);
          case "*": return (x, p) => a(x, p) * b(x, p);
          case "/": return (x, p) => a(x, p) / b(x, p);
          case "neg": return (x, p) => -a(x, p);
          case "^": {
            const k = integerExponent(n.args[1]);
            if (k === 2) return (x, p) => { const t = a(x, p); return t * t; };
            if (k !== null) return (x, p) => a(x, p) ** k;
            const r = oddRootExponent(n.args[1]);
            if (r) {
              // the real root: (-8)^(1/3) = -2
              return (x, p) => {
                const t = a(x, p);
                const root = t < 0 ? -Math.pow(-t, 1 / r.q) : Math.pow(t, 1 / r.q);
                return root ** r.p;
              };
            }
            return (x, p) => Math.pow(a(x, p), b(x, p));
          }
        }
        break;
      }
      case "call": {
        const args = n.args.map(go);
        const [a, b] = args;
        const f = {
          sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
          ln: Math.log, log: Math.log, sqrt: Math.sqrt, abs: Math.abs,
          atan: Math.atan, asin: Math.asin, acos: Math.acos, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
          log1p: Math.log1p, cbrt: Math.cbrt, erf: erfFloat,
        }[n.name];
        if (f) return (x, p) => f(a(x, p));
        if (n.name === "min") return (x, p) => Math.min(a(x, p), b(x, p));
        if (n.name === "max") return (x, p) => Math.max(a(x, p), b(x, p));
        break;
      }
    }
    throw new Error(`cannot compile ${n.type} ${n.op ?? n.name ?? ""}`);
  };
  return go(ast);
}

// ---- interval compiler ---------------------------------------------------------------------

/**
 * Compile to a certified enclosure function `(ctx, X, P) => interval | null`.
 * X is the interval of the plotted variable; P maps other names to intervals
 * (see `paramsToIntervals`). Literals are converted once per precision.
 */
export function compileInterval(ast, variable = "x") {
  const go = (n) => {
    switch (n.type) {
      case "num": {
        const { numerator, denominator } = n.value;
        const cache = new Map();
        return (ctx) => {
          let iv = cache.get(ctx.k);
          if (!iv) cache.set(ctx.k, (iv = I.fromRational(ctx, numerator, denominator)));
          return iv;
        };
      }
      case "const":
        if (n.name === "pi") return (ctx) => I.piInterval(ctx);
        return (ctx) => I.exp(ctx, { lo: ctx.one, hi: ctx.one });
      case "var":
        if (n.name === variable) return (ctx, X) => X;
        return (ctx, X, P) => {
          const iv = P[n.name];
          if (!iv) throw new ReferenceError(`no value for ${n.name}`);
          return iv;
        };
      case "op": {
        const [a, b] = n.args.map(go);
        switch (n.op) {
          case "+": return (c, X, P) => I.add(c, a(c, X, P), b(c, X, P));
          case "-": return (c, X, P) => I.sub(c, a(c, X, P), b(c, X, P));
          case "*": return (c, X, P) => I.mul(c, a(c, X, P), b(c, X, P));
          case "/": return (c, X, P) => I.div(c, a(c, X, P), b(c, X, P));
          case "neg": return (c, X, P) => I.neg(c, a(c, X, P));
          case "^": {
            const k = integerExponent(n.args[1]);
            if (k !== null) return (c, X, P) => I.powInt(c, a(c, X, P), k);
            const r = oddRootExponent(n.args[1]);
            if (r) return (c, X, P) => I.powOddRoot(c, a(c, X, P), r.p, r.q);
            const cv = constValue(n.args[1]);
            if (cv !== null) {
              // Constant exponent: x^c is defined at x = 0 for c > 0.
              if (cv.numerator > 0n) return (c, X, P) => I.powPos(c, a(c, X, P), b(c, X, P));
              return (c, X, P) => I.recip(c, I.powPos(c, a(c, X, P), I.neg(c, b(c, X, P))));
            }
            // General power: base^e = exp(e * ln(base)) for base > 0.
            return (c, X, P) => I.exp(c, I.mul(c, b(c, X, P), I.log(c, a(c, X, P))));
          }
        }
        break;
      }
      case "call": {
        const args = n.args.map(go);
        const [a, b] = args;
        const f = {
          sin: I.sin, cos: I.cos, tan: I.tan, exp: I.exp, ln: I.log, log: I.log,
          sqrt: I.sqrt, abs: I.abs,
          atan: I.atan, asin: I.asin, acos: I.acos, sinh: I.sinh, cosh: I.cosh, tanh: I.tanh,
          log1p: I.log1p, cbrt: I.cbrt, erf: I.erf,
        }[n.name];
        if (f) return (c, X, P) => f(c, a(c, X, P));
        if (n.name === "min") return (c, X, P) => I.min(c, a(c, X, P), b(c, X, P));
        if (n.name === "max") return (c, X, P) => I.max(c, a(c, X, P), b(c, X, P));
        break;
      }
    }
    throw new Error(`cannot compile ${n.type} ${n.op ?? n.name ?? ""}`);
  };
  return go(ast);
}

// ---- exact compiler ----------------------------------------------------------------------------

const UNDEFINED = null;

/**
 * Compile a rational-only expression to exact evaluation with Core
 * Rationals. Returns `undefined` when the expression is not rational-only.
 * The compiled function returns a Rational, or null where the expression is
 * undefined (division by zero).
 */
export function compileExact(ast, variable = "x") {
  if (!isRationalOnly(ast)) return undefined;
  const go = (n) => {
    switch (n.type) {
      case "num":
        return () => n.value;
      case "var":
        if (n.name === variable) return (x) => x;
        return (x, p) => p[n.name];
      case "op": {
        const [a, b] = n.args.map(go);
        const lift2 = (f) => (x, p) => {
          const u = a(x, p);
          if (u === UNDEFINED) return UNDEFINED;
          const w = b(x, p);
          if (w === UNDEFINED) return UNDEFINED;
          return f(u, w);
        };
        switch (n.op) {
          case "+": return lift2((u, w) => u.add(w));
          case "-": return lift2((u, w) => u.subtract(w));
          case "*": return lift2((u, w) => u.multiply(w));
          case "/": return lift2((u, w) => (w.numerator === 0n ? UNDEFINED : u.divide(w)));
          case "neg": return (x, p) => { const u = a(x, p); return u === UNDEFINED ? u : u.negate(); };
          case "^": {
            const k = integerExponent(n.args[1]);
            return (x, p) => {
              const u = a(x, p);
              if (u === UNDEFINED) return u;
              if (k < 0 && u.numerator === 0n) return UNDEFINED;
              if (k === 0 && u.numerator === 0n) return UNDEFINED; // 0^0 is undefined in RatMath
              return u.pow(k);
            };
          }
        }
        break;
      }
      case "call": {
        const [a, b] = n.args.map(go);
        if (n.name === "abs") return (x, p) => { const u = a(x, p); return u === UNDEFINED ? u : u.abs(); };
        const pick = n.name === "min" ? (u, w) => (u.lessThan(w) ? u : w) : (u, w) => (u.greaterThan(w) ? u : w);
        return (x, p) => {
          const u = a(x, p);
          const w = b(x, p);
          if (u === UNDEFINED || w === UNDEFINED) return UNDEFINED;
          return pick(u, w);
        };
      }
    }
    throw new Error(`cannot compile ${n.type}`);
  };
  return go(ast);
}

// ---- parameters ---------------------------------------------------------------------------------

export function paramsToRational(params = {}) {
  const out = {};
  for (const [k, val] of Object.entries(params)) out[k] = toRational(val);
  return out;
}

export function paramsToFloat(rparams) {
  const out = {};
  for (const [k, val] of Object.entries(rparams)) out[k] = val.toNumber();
  return out;
}

export function paramsToIntervals(ctx, rparams) {
  const out = {};
  for (const [k, val] of Object.entries(rparams)) out[k] = I.fromRational(ctx, val.numerator, val.denominator);
  return out;
}

/**
 * Rewrite y = f(x) for logarithmic axes. With `x`, the plotted variable u
 * stands for log10 of x (f is evaluated at 10^u); with `y`, the plotted value
 * is log10 of f. Draw the result on a viewport in those coordinates with the
 * axes options `xScale: "log"` / `yScale: "log"`.
 */
export function logScale(f, { x = false, y = false, variable = "x" } = {}) {
  let ast = typeof f === "string" ? parse(f) : f;
  if (x) {
    const sub = (n) => (n.type === "var" && n.name === variable ? op("^", num(10), v(variable)) : n.args ? { ...n, args: n.args.map(sub) } : n);
    ast = sub(ast);
  }
  if (y) ast = op("/", call("log", ast), call("log", num(10)));
  return ast;
}
