// Exact algebraic forms for the points of a graph: √2 instead of a bracket.
//
// When f is a rational function with rational coefficients, each of its
// zeros, extrema, inflection points, poles and holes is a root of a
// polynomial with integer coefficients. @ratmath/algebraic isolates those
// roots exactly, and the one inside a certified bracket is the point. It is
// attached to the record as
//
//   algebraic: { value, text, tex, polynomial, degree }
//
// `value` is the AlgebraicReal, `text` its closed form where it has one
// ("(1 + √5)/2", "∛2") and digits otherwise, `tex` the same in LaTeX, and
// `polynomial` its minimal polynomial (integers, constant first). A point's
// height gets `valueAlgebraic` in the same shape.

import { roots, format as formatAlgebraic, fromRational, compare, add, mul, div, minimalPolynomial } from "@ratmath/algebraic";
import { differentiate } from "@ratmath/analytic";
import { Rational } from "@ratmath/core";
import { rationalForm, integerCoefficients, coefficient } from "./polyform.js";
import { label } from "./render/scene.js";

const SUPER = { "⁰": 0, "¹": 1, "²": 2, "³": 3, "⁴": 4, "⁵": 5, "⁶": 6, "⁷": 7, "⁸": 8, "⁹": 9 };

/** LaTeX for the text algebraic's format() writes: √, ∛, ∜, ⁿ√, fractions. */
export function radicalTeX(text) {
  if (text.endsWith("…")) return `${text.slice(0, -1).replace("−", "-")}\\ldots`;
  // one radical with its radicand: a digit run or a parenthesised group
  const convert = (s) => {
    let out = "";
    let i = 0;
    while (i < s.length) {
      let index = null;
      let j = i;
      let sup = "";
      while (SUPER[s[j]] !== undefined) { sup += SUPER[s[j]]; j += 1; }
      if (s[j] === "√" && sup) { index = sup; i = j; }
      const ch = s[i];
      if (ch === "√" || ch === "∛" || ch === "∜") {
        const n = index ?? (ch === "∛" ? "3" : ch === "∜" ? "4" : null);
        i += 1;
        let body;
        if (s[i] === "(") {
          let depth = 0;
          let k = i;
          for (; k < s.length; k += 1) {
            if (s[k] === "(") depth += 1;
            else if (s[k] === ")") { depth -= 1; if (depth === 0) break; }
          }
          body = convert(s.slice(i + 1, k));
          i = k + 1;
        } else {
          let k = i;
          while (k < s.length && /[0-9]/.test(s[k])) k += 1;
          body = s.slice(i, k);
          i = k;
        }
        out += n ? `\\sqrt[${n}]{${body}}` : `\\sqrt{${body}}`;
      } else {
        out += ch === "−" ? "-" : ch;
        i += 1;
      }
    }
    return out;
  };
  // a fraction over everything: "(…)/d", or one term "a√b/d"
  const whole = /^(−?)\((.*)\)\/(\d+)$/.exec(text);
  if (whole && balanced(whole[2])) return `${whole[1] ? "-" : ""}\\frac{${convert(whole[2])}}{${whole[3]}}`;
  // otherwise term by term: a term may end in "/d"
  const terms = splitTerms(text);
  return terms.map(({ sign, body }, k) => {
    const m = /^(.*)\/(\d+)$/.exec(body);
    const core = m ? `\\frac{${convert(m[1])}}{${m[2]}}` : convert(body);
    return `${k === 0 ? (sign < 0 ? "-" : "") : sign < 0 ? " - " : " + "}${core}`;
  }).join("");
}

function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth += 1;
    else if (ch === ")") { depth -= 1; if (depth < 0) return false; }
  }
  return depth === 0;
}

function splitTerms(text) {
  const terms = [];
  let depth = 0;
  let cur = "";
  let sign = 1;
  let s = text;
  if (s.startsWith("−")) { sign = -1; s = s.slice(1); }
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && s[i] === " " && (s[i + 1] === "+" || s[i + 1] === "−") && s[i + 2] === " ") {
      terms.push({ sign, body: cur });
      sign = s[i + 1] === "+" ? 1 : -1;
      cur = "";
      i += 2;
    } else cur += ch;
  }
  terms.push({ sign, body: cur });
  return terms;
}

export function describeNumber(a) {
  if (a.rational) return null;
  const text = formatAlgebraic(a);
  const poly = minimalPolynomial(a);
  return { value: a, text, tex: radicalTeX(text), polynomial: poly, degree: poly.length - 1, closedForm: !text.endsWith("…") };
}

const pairOf = (q) => [q.numerator, q.denominator];

/** Evaluate a polynomial (Map form, one variable) at an algebraic number. */
function evalPoly(p, a) {
  let deg = 0;
  for (const k of p.keys()) deg = Math.max(deg, Number(k.split(",")[0]));
  let acc = fromRational(pairOf(coefficient(p, deg)));
  for (let i = deg - 1; i >= 0; i -= 1) acc = add(mul(acc, a), fromRational(pairOf(coefficient(p, i))));
  return acc;
}

/**
 * Attach exact algebraic forms to feature records of f. `derivativeOrder`
 * says which polynomial the points are roots of: 0 for zeros (the numerator
 * of f), 1 for extrema (the numerator of f′), 2 for inflection points;
 * "denominator" for poles and holes. Records that already are exact
 * rationals, or whose bracket does not hold exactly one root, are returned
 * unchanged. `values: true` also gives the height f(x) in closed form.
 */
export function withAlgebraicForms(records, ast, params, { variable = "x", derivativeOrder = 0, values = false, valueAst = null, maxDegree = 12 } = {}) {
  if (!records.some((r) => !r.exact && r.lo && r.hi && !r.lo.equals(r.hi))) return records;
  let tree = ast;
  if (typeof derivativeOrder === "number") for (let k = 0; k < derivativeOrder; k += 1) tree = differentiate(tree, variable);
  const form = rationalForm(tree, [variable], params);
  if (!form) return records;
  const coeffs = integerCoefficients(derivativeOrder === "denominator" ? form.den : form.num);
  if (!coeffs || coeffs.length < 3 || coeffs.length - 1 > 4 * maxDegree) return records;
  let all;
  try {
    all = roots(coeffs).map((r) => r.value);
  } catch {
    return records;
  }
  const original = values ? rationalForm(valueAst ?? ast, [variable], params) : null;
  return records.map((r) => {
    if (r.exact || !r.lo || !r.hi || r.kind === "possible" || r.kind === "everywhere" || r.kind === "critical") return r;
    const lo = fromRational(pairOf(r.lo));
    const hi = fromRational(pairOf(r.hi));
    const inside = all.filter((a) => compare(a, lo) >= 0 && compare(a, hi) <= 0);
    if (inside.length !== 1) return r;
    const a = inside[0];
    if (minimalPolynomial(a).length - 1 > maxDegree) return r;
    const algebraic = describeNumber(a);
    if (!algebraic) return r;
    const out = { ...r, algebraic };
    if (original && algebraic.degree <= 4) {
      try {
        const y = div(evalPoly(original.num, a), evalPoly(original.den, a));
        if (y.rational) out.value = new Rational(y.rational[0], y.rational[1]);
        else out.valueAlgebraic = describeNumber(y);
      } catch {
        /* the closed form of the height is a bonus */
      }
    }
    return out;
  });
}

// ---- labels ------------------------------------------------------------------------------

const fracTeX = (q) => (q.denominator === 1n ? `${q.numerator}` : `${q.numerator < 0n ? "-" : ""}\\frac{${q.numerator < 0n ? -q.numerator : q.numerator}}{${q.denominator}}`);
const decimal = (x, digits) => String(Number(x.toPrecision(digits)));

/** The TeX and plain text of a record's position (or height): exact where it is known. */
function coordinate(r, which, digits) {
  const alg = which === "x" ? r.algebraic : r.valueAlgebraic;
  if (alg) return { tex: alg.closedForm ? alg.tex : `${decimal(alg.value.toNumber(), digits)}\\ldots`, text: alg.closedForm ? alg.text : `${decimal(alg.value.toNumber(), digits)}…`, number: alg.value.toNumber() };
  const exact = which === "x" ? r.at : r.value;
  if (exact) return { tex: fracTeX(exact), text: exact.toString(), number: exact.toNumber() };
  const lo = which === "x" ? r.lo : r.valueLo;
  const hi = which === "x" ? r.hi : r.valueHi;
  if (!lo || !hi) return null;
  const m = (lo.toNumber() + hi.toNumber()) / 2;
  return { tex: `${decimal(m, digits)}\\ldots`, text: `${decimal(m, digits)}…`, number: m };
}

/**
 * Labels for the points in a features value (or in lists of records): zeros
 * get their x, the other points "(x, y)", each in exact form where one is
 * known: \sqrt{2}, \frac{1 + \sqrt{5}}{2}, 3/4. Returns label layers for
 * drawScene and the exporters. Options: digits for values with no closed
 * form (default 4), kinds to include, anchor.
 */
export function featureLabels(features, { digits = 4, kinds = ["zeros", "extrema", "inflections", "holes", "intersections"], anchor = "ne", size = 13, color } = {}) {
  const out = [];
  for (const kind of kinds) {
    for (const r of features[kind] ?? []) {
      if (!r || typeof r !== "object" || r.kind === "possible" || r.kind === "everywhere" || r.kind === "critical" || r.kind === "undefined") continue;
      const x = coordinate(r, "x", digits);
      if (!x) continue;
      if (kind === "zeros") {
        out.push(label([x.number, 0], x.tex, { text: x.text, anchor, size, color }));
        continue;
      }
      const y = coordinate(r, "y", digits);
      if (!y) continue;
      out.push(label([x.number, y.number], `\\left(${x.tex},\\ ${y.tex}\\right)`, { text: `(${x.text}, ${y.text})`, anchor, size, color }));
    }
  }
  return out;
}
