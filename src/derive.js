// Symbolic differentiation of expression ASTs, with light simplification.
// The derivative is an ordinary AST, so it gets the same float, interval and
// exact compilers as the function itself: certified f' and f'' for free.

import { Rational } from "@ratmath/core";
import { constValue } from "./expr.js";

const N = (q) => ({ type: "num", value: q instanceof Rational ? q : new Rational(BigInt(q)) });
const isNum = (a, q) => a.type === "num" && (q === undefined || a.value.equals(new Rational(BigInt(q))));

export function add(a, b) {
  if (isNum(a, 0)) return b;
  if (isNum(b, 0)) return a;
  if (isNum(a) && isNum(b)) return N(a.value.add(b.value));
  if (b.type === "op" && b.op === "neg") return sub(a, b.args[0]);
  return { type: "op", op: "+", args: [a, b] };
}

/** Structural equality of two ASTs. */
export function same(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === "num") return a.value.equals(b.value);
  if (a.type === "var" || a.type === "const") return a.name === b.name;
  if ((a.op ?? a.name) !== (b.op ?? b.name) || a.args.length !== b.args.length) return false;
  return a.args.every((x, i) => same(x, b.args[i]));
}

export function sub(a, b) {
  if (isNum(b, 0)) return a;
  if (same(a, b)) return N(0);
  if (isNum(a, 0)) return neg(b);
  if (isNum(a) && isNum(b)) return N(a.value.subtract(b.value));
  if (b.type === "op" && b.op === "neg") return add(a, b.args[0]);
  return { type: "op", op: "-", args: [a, b] };
}

export function neg(a) {
  if (isNum(a)) return N(a.value.negate());
  if (a.type === "op" && a.op === "neg") return a.args[0];
  return { type: "op", op: "neg", args: [a] };
}

export function mul(a, b) {
  if (isNum(a, 0) || isNum(b, 0)) return N(0);
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  if (isNum(a) && isNum(b)) return N(a.value.multiply(b.value));
  if (isNum(b)) return mul(b, a); // constants first
  if (a.type === "op" && a.op === "neg") return neg(mul(a.args[0], b));
  if (b.type === "op" && b.op === "neg") return neg(mul(a, b.args[0]));
  if (isNum(a) && b.type === "op" && b.op === "*" && isNum(b.args[0])) return mul(N(a.value.multiply(b.args[0].value)), b.args[1]);
  return { type: "op", op: "*", args: [a, b] };
}

export function div(a, b) {
  if (isNum(a, 0)) return N(0);
  if (isNum(b, 1)) return a;
  if (isNum(a) && isNum(b) && !isNum(b, 0)) return N(a.value.divide(b.value));
  return { type: "op", op: "/", args: [a, b] };
}

export function pow(a, k) {
  // k a JS integer
  if (k === 1) return a;
  if (k === 0) return N(1);
  return { type: "op", op: "^", args: [a, k < 0 ? neg(N(-k)) : N(k)] };
}

const call = (name, ...args) => ({ type: "call", name, args });

function intExp(e) {
  const c = constValue(e);
  return c && c.denominator === 1n ? Number(c.numerator) : null;
}

function dependsOn(ast, x) {
  if (ast.type === "var") return ast.name === x;
  return !!ast.args && ast.args.some((a) => dependsOn(a, x));
}

/** d/dx of an AST. Throws for min and max, which have corners. */
export function derive(ast, x = "x") {
  if (!dependsOn(ast, x)) return N(0);
  switch (ast.type) {
    case "var":
      return N(ast.name === x ? 1 : 0);
    case "op": {
      const [u, v] = ast.args;
      switch (ast.op) {
        case "+": return add(derive(u, x), derive(v, x));
        case "-": return sub(derive(u, x), derive(v, x));
        case "neg": return neg(derive(u, x));
        case "*": return add(mul(derive(u, x), v), mul(u, derive(v, x)));
        case "/":
          if (!dependsOn(v, x)) return div(derive(u, x), v);
          return div(sub(mul(derive(u, x), v), mul(u, derive(v, x))), pow(v, 2));
        case "^": {
          const k = intExp(v);
          if (k !== null) return mul(mul(N(k), pow(u, k - 1)), derive(u, x));
          const c = constValue(v);
          if (c !== null) {
            // u^c with constant non-integer c: c * u^(c-1) * u'
            return mul(mul(N(c), { type: "op", op: "^", args: [u, N(c.subtract(new Rational(1n)))] }), derive(u, x));
          }
          if (!dependsOn(v, x)) {
            return mul(mul(v, { type: "op", op: "^", args: [u, sub(v, N(1))] }), derive(u, x));
          }
          // u^v = exp(v ln u): (u^v) * (v' ln u + v u'/u)
          return mul(ast, add(mul(derive(v, x), call("ln", u)), div(mul(v, derive(u, x)), u)));
        }
      }
      break;
    }
    case "call": {
      const [u] = ast.args;
      const du = derive(u, x);
      switch (ast.name) {
        case "sin": return mul(call("cos", u), du);
        case "cos": return neg(mul(call("sin", u), du));
        case "tan": return div(du, pow(call("cos", u), 2));
        case "exp": return mul(ast, du);
        case "ln":
        case "log": return div(du, u);
        case "sqrt": return div(du, mul(N(2), ast));
        // |u|' = u' * u / |u|, undefined where u = 0 (a corner)
        case "abs": return div(mul(du, u), ast);
      }
      throw new Error(`${ast.name} has corners; it is not differentiated`);
    }
  }
  throw new Error(`cannot differentiate ${ast.type}`);
}

/** Render an AST back to calculator notation (for display and debugging). */
export function format(ast) {
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, neg: 3, "^": 4 };
  const go = (n, outer = 0) => {
    switch (n.type) {
      case "num": {
        const s = n.value.toString();
        return n.value.denominator !== 1n || n.value.numerator < 0n ? (outer > 0 ? `(${s})` : s) : s;
      }
      case "var":
      case "const":
        return n.name;
      case "call":
        return `${n.name}(${n.args.map((a) => go(a)).join(", ")})`;
      case "op": {
        const p = prec[n.op];
        let s;
        if (n.op === "neg") s = `-${go(n.args[0], p)}`;
        else if (n.op === "^") s = `${go(n.args[0], p + 1)}^${go(n.args[1], p)}`;
        else s = `${go(n.args[0], p)} ${n.op} ${go(n.args[1], n.op === "-" || n.op === "/" ? p + 1 : p)}`;
        return p < outer ? `(${s})` : s;
      }
    }
    return "?";
  };
  return go(ast);
}
