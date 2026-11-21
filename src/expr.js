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
import * as I from "./interval.js";

// ---- AST builders -----------------------------------------------------------------

export const num = (value) => ({ type: "num", value: toRational(value) });
export const v = (name) => ({ type: "var", name });
export const op = (o, ...args) => ({ type: "op", op: o, args });
export const call = (name, ...args) => ({ type: "call", name, args });

export function toRational(value) {
  if (value instanceof Rational) return value;
  if (typeof value === "bigint") return new Rational(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`not a finite number: ${value}`);
    // Use the shortest decimal that round-trips, so 0.1 means 1/10.
    return parseDecimalString(String(value));
  }
  if (typeof value === "string") return parseDecimalString(value.trim());
  if (value && typeof value.numerator === "bigint") return new Rational(value.numerator, value.denominator);
  throw new TypeError(`cannot read ${value} as a rational`);
}

function parseDecimalString(s) {
  const frac = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) return new Rational(BigInt(frac[1]), BigInt(frac[2]));
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new SyntaxError(`not a number: ${s}`);
  const digits = (m[2] || "0") + (m[3] ?? "");
  let n = BigInt(digits) * (m[1] === "-" ? -1n : 1n);
  let d = 10n ** BigInt((m[3] ?? "").length);
  const e = m[4] ? Number(m[4]) : 0;
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  return new Rational(n, d);
}

// ---- parser -----------------------------------------------------------------------------

export const FUNCTIONS = new Set(["sin", "cos", "tan", "exp", "ln", "log", "sqrt", "abs", "min", "max"]);
export const CONSTANTS = new Set(["pi", "e"]);

/**
 * Parse calculator notation: + - * / ^, parentheses, unary minus, implicit
 * multiplication between a number and what follows (`2x`, `3(x+1)`,
 * `2sin(x)`), decimals as exact rationals, and the functions in FUNCTIONS.
 * Names are maximal runs of letters, digits and _ starting with a letter, so
 * `ax` is one name; write `a x` or `a*x`. `^` is right-associative and binds
 * tighter than unary minus: `-x^2` is `-(x^2)`.
 */
export function parse(text) {
  const toks = tokenize(text);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (t) => {
    const k = next();
    if (!k || k.t !== t) throw new SyntaxError(`expected ${t} at ${k ? k.pos : text.length} in ${text}`);
    return k;
  };

  function expr() {
    let left = term();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const o = next().t;
      left = op(o, left, term());
    }
    return left;
  }

  function startsFactor(k) {
    return k && (k.t === "num" || k.t === "name" || k.t === "(");
  }

  function term() {
    let left = unary();
    for (;;) {
      const k = peek();
      if (k && (k.t === "*" || k.t === "/")) {
        next();
        left = op(k.t, left, unary());
      } else if (startsFactor(k)) {
        left = op("*", left, power());
      } else return left;
    }
  }

  function unary() {
    if (peek() && peek().t === "-") {
      next();
      return op("neg", unary());
    }
    if (peek() && peek().t === "+") {
      next();
      return unary();
    }
    return power();
  }

  function power() {
    const base = primary();
    if (peek() && peek().t === "^") {
      next();
      return op("^", base, unary());
    }
    return base;
  }

  function primary() {
    const k = next();
    if (!k) throw new SyntaxError(`unexpected end of ${text}`);
    if (k.t === "num") return { type: "num", value: parseDecimalString(k.v) };
    if (k.t === "(") {
      const e = expr();
      expect(")");
      return e;
    }
    if (k.t === "name") {
      if (FUNCTIONS.has(k.v)) {
        if (peek() && peek().t === "(") {
          next();
          const args = [expr()];
          while (peek() && peek().t === ",") {
            next();
            args.push(expr());
          }
          expect(")");
          return call(k.v, ...args);
        }
        // sin x  (function applied to the following power)
        return call(k.v, power());
      }
      if (CONSTANTS.has(k.v)) return { type: "const", name: k.v };
      return v(k.v);
    }
    throw new SyntaxError(`unexpected ${k.t} at ${k.pos} in ${text}`);
  }

  const result = expr();
  if (i < toks.length) throw new SyntaxError(`unexpected ${toks[i].t} at ${toks[i].pos} in ${text}`);
  return result;
}

function tokenize(text) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/y;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw new SyntaxError(`cannot read ${JSON.stringify(text.slice(pos))}`);
    const at = m.index + (m[0].length - (m[1] ?? m[2] ?? m[3]).length);
    if (m[1]) out.push({ t: "num", v: m[1], pos: at });
    else if (m[2]) out.push({ t: "name", v: m[2], pos: at });
    else out.push({ t: m[3] === "**" ? "^" : m[3], pos: at });
    pos = re.lastIndex;
  }
  return out;
}

/** Names used as variables in an expression (excluding functions and constants). */
export function freeVariables(ast, out = new Set()) {
  if (ast.type === "var") out.add(ast.name);
  else if (ast.args) for (const a of ast.args) freeVariables(a, out);
  return out;
}

/** True when the expression uses only + - * / and integer powers (no pi, sin, ...). */
export function isRationalOnly(ast) {
  switch (ast.type) {
    case "num":
    case "var":
      return true;
    case "const":
    case "call":
      return ast.name === "abs" || ast.name === "min" || ast.name === "max"
        ? ast.args.every(isRationalOnly)
        : false;
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
