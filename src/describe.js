// A plain-language description of a graph, built from its certified
// features, for screen readers and alt text.
//
//   describe("sin(x)/x", {}, [-10, 10])
//   → "Graph of y = sin(x)/x for x from −10 to 10. It crosses or touches the
//      x-axis 6 times, near x = −9.425, −6.283, … It has a hole at x = 0,
//      where the value would be 1. …"
//
// Every statement comes from a proven record; anything that could not be
// decided is reported as such, never guessed.

import { format } from "@ratmath/analytic";
import { parse, toRational } from "./expr.js";
import { features as featuresOf } from "./features.js";

const minus = (s) => s.replace(/^-/, "−");

/** A number for prose: a small fraction as written, anything else to `digits` significant digits. */
function say(q, digits) {
  if (q === undefined || q === null) return "unknown";
  if (typeof q !== "number") {
    if (q.denominator <= 1000n && q.numerator.toString().length <= 6) return minus(q.toString());
    q = q.toNumber();
  }
  if (q === 0) return "0";
  return minus(String(Number(q.toPrecision(digits))));
}

const xOf = (r, digits) => (r.at ? say(r.at, digits) : say((r.lo.toNumber() + r.hi.toNumber()) / 2, digits));
function yOf(r, digits) {
  if (r.value) return say(r.value, digits);
  if (!r.valueLo || !r.valueHi) return null;
  const lo = r.valueLo.toNumber();
  const hi = r.valueHi.toNumber();
  // an enclosure around 0 is reported as 0, not as its tiny midpoint
  return lo <= 0 && hi >= 0 ? "0" : say((lo + hi) / 2, digits);
}
const near = (r) => (r.at ? "at" : "near");

function list(items, max) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const text = shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")}${rest ? ", " : " and "}${shown[shown.length - 1]}`;
  return rest ? `${text} and ${rest} more` : text;
}

const count = (n, one, many) => (n === 1 ? `one ${one}` : `${n} ${many}`);

/**
 * Describe a features value (from `features(...).exact()`) in sentences.
 * Options: `digits` (4), `max` (how many points to list of each kind, 6).
 */
export function describeFeatures(f, range, feats, { digits = 4, max = 6, variable = "x" } = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  const [a, b] = range.map((t) => say(toRational(t), digits));
  const out = [`Graph of y = ${format(ast)} for ${variable} from ${a} to ${b}.`];
  const zeros = feats.zeros ?? [];
  const everywhere = zeros.filter((z) => z.kind === "everywhere");
  const proven = zeros.filter((z) => z.kind === "exact" || z.kind === "sign-change" || z.kind === "isolated");
  const unsure = zeros.filter((z) => z.kind === "possible");
  if (everywhere.length) out.push(`It is zero on all of ${everywhere.map((z) => `${say(z.lo, digits)} to ${say(z.hi, digits)}`).join(", ")}.`);
  else if (proven.length) {
    const exact = proven.every((z) => z.at);
    out.push(`It meets the ${variable}-axis ${proven.length === 1 ? "once" : `${proven.length} times`}, ${exact ? "at" : "near"} ${variable} = ${list(proven.map((z) => xOf(z, digits)), max)}.`);
  } else if (!unsure.length) out.push(`It does not meet the ${variable}-axis.`);
  if (unsure.length) out.push(`${count(unsure.length, "possible zero", "possible zeros")} could not be decided, near ${variable} = ${list(unsure.map((z) => xOf(z, digits)), max)}.`);

  const poles = feats.poles ?? [];
  if (poles.length) out.push(`It has ${count(poles.length, "vertical asymptote", "vertical asymptotes")}, ${poles.every((p) => p.at) ? "at" : "near"} ${variable} = ${list(poles.map((p) => xOf(p, digits)), max)}.`);
  for (const h of (feats.holes ?? []).slice(0, max)) {
    const y = yOf(h, digits);
    out.push(`It has a hole ${near(h)} ${variable} = ${xOf(h, digits)}${y ? `, where the value would be ${y}` : ""}.`);
  }
  const undef = feats.undefined ?? [];
  if (undef.length) out.push(`It is not defined ${undef.every((p) => p.at) ? "at" : "near"} ${variable} = ${list(undef.map((p) => xOf(p, digits)), max)}, without a vertical asymptote there.`);

  const point = (r) => {
    const y = yOf(r, digits);
    return y === null ? `${variable} = ${xOf(r, digits)}` : `(${xOf(r, digits)}, ${y})`;
  };
  const ex = feats.extrema ?? [];
  const maxima = ex.filter((e) => e.kind === "max");
  const minima = ex.filter((e) => e.kind === "min");
  if (maxima.length) out.push(`It has ${count(maxima.length, "local maximum", "local maxima")}, ${maxima.every((e) => e.at) ? "at" : "near"} ${list(maxima.map(point), max)}.`);
  if (minima.length) out.push(`It has ${count(minima.length, "local minimum", "local minima")}, ${minima.every((e) => e.at) ? "at" : "near"} ${list(minima.map(point), max)}.`);
  if (!maxima.length && !minima.length && !ex.length) out.push("It has no local maximum or minimum inside the range.");
  const infl = (feats.inflections ?? []).filter((i) => i.kind === "inflection");
  if (infl.length) out.push(`It changes the way it bends at ${count(infl.length, "inflection point", "inflection points")}, ${infl.every((e) => e.at) ? "at" : "near"} ${list(infl.map(point), max)}.`);
  for (const e of (feats.endpoints ?? []).slice(0, max)) {
    const where = `${variable} = ${xOf(e, digits)}`;
    if (e.side === "isolated") out.push(`It is defined at the single point ${where}.`);
    else out.push(`It is only defined to the ${e.side} of ${where}, ${e.included ? "which is included" : "which is not included"}.`);
  }
  return out.join(" ");
}

/** Describe y = f(x) on a range from its certified features (this runs the certified search). */
export function describe(f, params, range, options = {}) {
  const ast = typeof f === "string" ? parse(f) : f;
  return describeFeatures(ast, range, featuresOf(ast, params, range, options).exact(), options);
}
