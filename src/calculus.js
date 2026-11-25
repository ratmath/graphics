// Calculus pictures: tangents and secants, areas and Riemann sums, Taylor
// polynomials, gradient and vector fields, contour lines.
//
// Each function returns what a scene needs (geometry objects and frames,
// ready for drawScene and every exporter) together with the numbers behind
// the picture. The numbers come from @ratmath/analytic, so a slope, an
// integral or a gradient is exact where it is rational and a certified
// enclosure otherwise.
//
//   const t = tangent("x^3 - x", 1);            // slope 2, exactly
//   const a = areaUnder("sin(x)", [0, "pi"], {}, vp);
//   drawScene(ctx, vp, [graph("sin(x)", {}, vp).quick.value, a.quick.value, ...t.layers]);
//   a.exact().integral                          // an interval around 2

import { Rational, RationalInterval } from "@ratmath/core";
import { Refinement } from "@ratmath/core/refine";
import { fn as analyticFn, field as analyticField, differentiate, format as formatAst } from "@ratmath/analytic";
import { compileExact, compileFloat, constValue, paramsToFloat, paramsToRational, toAst, toRational, op, num, v } from "./expr.js";
import { point, line } from "./geometry.js";
import { viewport as makeViewport } from "./viewport.js";
import { implicit } from "./region.js";
import { simplestBetween } from "./roots.js";

const asViewport = (vp) => (vp && vp.f ? vp : makeViewport(vp));
const mid = (x) => (x instanceof RationalInterval ? x.low.add(x.high).divide(new Rational(2n)) : x);
const isPoint = (x) => !(x instanceof RationalInterval) || x.low.equals(x.high);
const collapse = (x) => (x instanceof RationalInterval && x.low.equals(x.high) ? x.low : x);
const two = new Rational(2n);

/** A rational close to a float (for drawing a line whose slope is irrational). */
function nearRational(x) {
  const scaled = Math.round(x * 2 ** 40);
  return new Rational(BigInt(scaled), 1n << 40n);
}

/** An end of an interval: a number, a fraction string, a Rational, or a constant such as "pi/2". */
function endValue(x, params) {
  if (x instanceof Rational) return { exact: x, float: x.toNumber() };
  if (typeof x === "string" && /[a-z]/i.test(x)) {
    const ast = toAst(x);
    const c = constValue(ast);
    if (c) return { exact: c, float: c.toNumber() };
    return { exact: null, float: compileFloat(ast)(0, paramsToFloat(paramsToRational(params))), ast };
  }
  const q = toRational(x);
  return { exact: q, float: q.toNumber() };
}

function exactOrEnclosed(f, x, variable, params, digits) {
  const rp = paramsToRational(params);
  const exact = compileExact(f.ast, variable);
  if (exact) {
    const y = exact(x, rp);
    if (y) return y;
  }
  return collapse(f.value(x, { digits }).exact());
}

/**
 * The tangent to y = f(x) at x0: { x, value, slope, exact, point, line,
 * equation, layers }. `value` and `slope` are Rationals when f is rational
 * at x0 and certified RationalIntervals otherwise (to `digits`). `layers`
 * holds the line and the point of contact.
 */
export function tangent(f, x0, params = {}, { digits = 12, variable = "x" } = {}) {
  const F = analyticFn(toAst(f), { variable, params });
  const x = toRational(x0);
  const value = exactOrEnclosed(F, x, variable, params, digits);
  const slope = exactOrEnclosed(F.derivative(), x, variable, params, digits);
  const exact = isPoint(value) && isPoint(slope);
  const y = mid(value);
  const m = mid(slope);
  const P = point(x, y);
  const L = line(P, point(x.add(new Rational(1n)), y.add(m)));
  const fmt = (q) => (exact ? q.toString() : q.toNumber().toPrecision(6).replace(/\.?0+$/, ""));
  const b = y.subtract(m.multiply(x));
  // y = 2x - 2, y = x + 1, y = -x, y = 3 (no "1x", no "+ 0")
  const one = new Rational(1n);
  const mx = m.numerator === 0n ? "" : m.equals(one) ? variable : m.equals(one.negate()) ? `-${variable}` : `${fmt(m)}${m.denominator === 1n || !exact ? "" : "·"}${variable}`;
  const tail = b.numerator === 0n ? "" : mx ? ` ${b.numerator < 0n ? "-" : "+"} ${fmt(b.abs())}` : fmt(b);
  const equation = `y = ${mx || tail ? mx + tail : "0"}`;
  return { x, value, slope, exact, point: P, line: L, equation, layers: [L, P] };
}

/** The secant through (a, f(a)) and (b, f(b)): { slope, exact, points, line, layers }. */
export function secant(f, a, b, params = {}, { digits = 12, variable = "x" } = {}) {
  const F = analyticFn(toAst(f), { variable, params });
  const xa = toRational(a);
  const xb = toRational(b);
  if (xa.equals(xb)) throw new RangeError("a secant needs two different points");
  const ya = exactOrEnclosed(F, xa, variable, params, digits);
  const yb = exactOrEnclosed(F, xb, variable, params, digits);
  const exact = isPoint(ya) && isPoint(yb);
  const A = point(xa, mid(ya));
  const B = point(xb, mid(yb));
  const run = xb.subtract(xa);
  const slope = exact ? yb.subtract(ya).divide(run)
    : new RationalInterval(asInterval(yb).low.subtract(asInterval(ya).high).divide(run), asInterval(yb).high.subtract(asInterval(ya).low).divide(run));
  return { slope: run.numerator < 0n && !exact ? new RationalInterval(slope.high, slope.low) : slope, exact, points: [A, B], line: line(A, B), layers: [line(A, B), A, B] };
}
const asInterval = (x) => (x instanceof RationalInterval ? x : new RationalInterval(x, x));

// ---- areas ---------------------------------------------------------------------------

function shadeBetween(fa, ga, p, a, b, vp, samples) {
  // closed polygons between the two curves, split where they cross so that
  // the part with f above g and the part below can be coloured apart
  const lo = Math.max(Math.min(a, b), vp.f.xmin);
  const hi = Math.min(Math.max(a, b), vp.f.xmax);
  const above = [];
  const below = [];
  if (!(hi > lo)) return { above, below };
  const n = Math.max(8, samples);
  const clampY = (y) => Math.max(vp.f.ymin - 10 * (vp.f.ymax - vp.f.ymin), Math.min(vp.f.ymax + 10 * (vp.f.ymax - vp.f.ymin), y));
  let top = [];
  let bottom = [];
  let sign = 0;
  const flush = () => {
    if (top.length >= 2) {
      const poly = [];
      for (const [x, y] of top) poly.push(x, clampY(y));
      for (let i = bottom.length - 1; i >= 0; i -= 1) poly.push(bottom[i][0], clampY(bottom[i][1]));
      (sign >= 0 ? above : below).push(Float64Array.from(poly));
    }
    top = [];
    bottom = [];
  };
  let prev = null;
  for (let i = 0; i <= n; i += 1) {
    const x = lo + ((hi - lo) * i) / n;
    const yf = fa(x, p);
    const yg = ga(x, p);
    if (!Number.isFinite(yf) || !Number.isFinite(yg)) { flush(); prev = null; sign = 0; continue; }
    const s = Math.sign(yf - yg);
    if (prev && s !== 0 && sign !== 0 && s !== sign) {
      // the curves cross between prev.x and x: end one polygon there, start the next
      const t = (prev.yf - prev.yg) / (prev.yf - prev.yg - (yf - yg));
      const xc = prev.x + t * (x - prev.x);
      const yc = prev.yf + t * (yf - prev.yf);
      top.push([xc, yc]);
      bottom.push([xc, yc]);
      flush();
      top.push([xc, yc]);
      bottom.push([xc, yc]);
    }
    if (s !== 0) sign = s;
    top.push([x, yf]);
    bottom.push([x, yg]);
    prev = { x, yf, yg };
  }
  flush();
  return { above, below };
}

function floatIntegral(h, p, a, b) {
  // composite Simpson, for the preview only
  const n = 256;
  let s = 0;
  for (let i = 0; i <= n; i += 1) {
    const y = h(a + ((b - a) * i) / n, p);
    if (!Number.isFinite(y)) return NaN;
    s += y * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return (s * (b - a)) / (3 * n);
}

/**
 * The area between y = f(x) and y = g(x) from a to b, as a Refinement.
 * quick: { kind: "area", above, below, integral } with a float integral.
 * exact: the same shading with `integral` a certified RationalInterval, as
 * narrow as `digits` asks. An end may be a constant such as "pi/2", "inf" or
 * "-inf", or a point where the integrand is undefined: the integral is then
 * improper, and `integral` is Infinity or -Infinity when it is proven to
 * diverge. `above` is where f is above g, `below` the rest; the integral
 * counts `below` negative.
 */
export function areaBetween(f, g, [a, b], params = {}, vp, { digits = 10, variable = "x", samples } = {}) {
  const view = asViewport(vp);
  const fAst = toAst(f);
  const gAst = toAst(g);
  const diff = isZeroAst(gAst) ? fAst : op("-", fAst, gAst);
  const fa = compileFloat(fAst, variable);
  const ga = compileFloat(gAst, variable);
  const ha = compileFloat(diff, variable);
  const p = paramsToFloat(paramsToRational(params));
  const inf = (x) => typeof x === "string" && /^[+-]?(inf|infinity|∞)$/i.test(x.trim());
  const A = inf(a) ? { exact: null, float: /^-/.test(a.trim()) ? -Infinity : Infinity, infinite: true } : endValue(a, params);
  const B = inf(b) ? { exact: null, float: /^-/.test(b.trim()) ? -Infinity : Infinity, infinite: true } : endValue(b, params);
  const shading = (n) => shadeBetween(fa, ga, p, A.float, B.float, view, n);
  const frame = (n, integral, extra = {}) => ({ kind: "area", ...shading(n), from: A.float, to: B.float, integral, ...extra });
  return new Refinement(
    () => {
      const lo = Math.max(-1e3, A.float);
      const hi = Math.min(1e3, B.float);
      return { value: frame(Math.ceil(view.width / 2), floatIntegral(ha, p, lo, hi)), trust: "rough" };
    },
    function* () {
      yield { done: 0, of: 1, step: "integral" };
      const F = analyticFn(diff, { variable, params });
      // an end such as pi is enclosed; the integral runs to the middle of the
      // enclosure and the sliver that is left is bounded by max |f| times its width
      let slack = new Rational(0n);
      const end = (E) => {
        if (E.infinite) return E.float < 0 ? "-inf" : "inf";
        if (E.exact) return E.exact;
        const iv = analyticFn(E.ast, { params }).value(0, { digits: digits + 6 }).exact();
        const m = mid(iv);
        if (!isPoint(iv)) {
          const r = F.range(iv, { digits: 3 }).exact();
          const top = r.low.abs().greaterThan(r.high.abs()) ? r.low.abs() : r.high.abs();
          slack = slack.add(top.multiply(iv.high.subtract(iv.low)).divide(two));
        }
        return m;
      };
      const ea = end(A);
      const eb = end(B);
      let integral;
      let improper = Boolean(A.infinite || B.infinite);
      if (!improper) {
        try {
          integral = F.integral(ea, eb, { digits }).exact();
        } catch (e) {
          if (e?.name !== "AnalyticError") throw e;
          improper = true;
        }
      }
      if (improper) integral = F.improperIntegral(ea, eb, { digits }).exact();
      if (integral instanceof RationalInterval || integral instanceof Rational) {
        const iv = asInterval(integral);
        integral = collapse(new RationalInterval(iv.low.subtract(slack), iv.high.add(slack)));
      }
      return { value: frame(view.width * 2, integral, { improper, certified: true }), via: improper ? "improper-integral" : "taylor-models" };
    },
  );
}
const isZeroAst = (ast) => ast.type === "num" && ast.value.numerator === 0n;

/** The area between y = f(x) and the x-axis from a to b (see areaBetween). */
export const areaUnder = (f, interval, params, vp, options) => areaBetween(f, num(0), interval, params, vp, options);

/**
 * A Riemann sum of f over [a, b] with n equal pieces. rule: "left", "right",
 * "midpoint", "trapezoid", "lower" or "upper". Returns { kind, sum, exact,
 * width, heights, … } where the frame draws the rectangles (or trapezoids);
 * `sum` is a Rational when f is rational at the sample points, and a float
 * otherwise. "lower" and "upper" use the least and greatest of f on each
 * piece as found by sampling, which is right for monotone pieces.
 */
export function riemannSum(f, [a, b], n, params = {}, { rule = "midpoint", variable = "x" } = {}) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("riemannSum needs a whole number of pieces");
  const ast = toAst(f);
  const xa = toRational(a);
  const xb = toRational(b);
  const h = xb.subtract(xa).divide(new Rational(BigInt(n)));
  const rp = paramsToRational(params);
  const exactFn = compileExact(ast, variable);
  const floatFn = compileFloat(ast, variable);
  const fp = paramsToFloat(rp);
  let exact = Boolean(exactFn);
  const at = (x) => {
    if (exact) {
      const y = exactFn(x, rp);
      if (y) return y;
      exact = false;
    }
    return null;
  };
  const xs = Array.from({ length: n + 1 }, (_, i) => xa.add(h.multiply(new Rational(BigInt(i)))));
  const heights = [];
  const frame = { rule, n, width: h };
  if (rule === "trapezoid") {
    const ys = xs.map((x) => at(x));
    const yf = xs.map((x, i) => (exact && ys[i] ? ys[i].toNumber() : floatFn(x.toNumber(), fp)));
    const polys = [];
    for (let i = 0; i < n; i += 1) polys.push(Float64Array.from([xs[i].toNumber(), 0, xs[i].toNumber(), yf[i], xs[i + 1].toNumber(), yf[i + 1], xs[i + 1].toNumber(), 0]));
    let sum;
    if (exact) {
      sum = new Rational(0n);
      for (let i = 0; i < n; i += 1) sum = sum.add(ys[i].add(ys[i + 1]));
      sum = sum.multiply(h).divide(two);
    } else {
      sum = 0;
      for (let i = 0; i < n; i += 1) sum += ((yf[i] + yf[i + 1]) * h.toNumber()) / 2;
    }
    return { kind: "area", above: polys, below: [], outline: true, sum, exact, ...frame };
  }
  const bars = new Float64Array(4 * n);
  let sum = exact ? new Rational(0n) : 0;
  const floatSum = [];
  for (let i = 0; i < n; i += 1) {
    let y;
    let yNum;
    if (rule === "lower" || rule === "upper") {
      exact = false;
      const x0 = xs[i].toNumber();
      const x1 = xs[i + 1].toNumber();
      yNum = rule === "lower" ? Infinity : -Infinity;
      for (let k = 0; k <= 32; k += 1) {
        const t = floatFn(x0 + ((x1 - x0) * k) / 32, fp);
        yNum = rule === "lower" ? Math.min(yNum, t) : Math.max(yNum, t);
      }
    } else {
      const x = rule === "left" ? xs[i] : rule === "right" ? xs[i + 1] : rule === "midpoint" ? xs[i].add(xs[i + 1]).divide(two) : null;
      if (!x) throw new RangeError(`unknown rule ${rule}`);
      y = at(x);
      yNum = y ? y.toNumber() : floatFn(x.toNumber(), fp);
    }
    heights.push(y ?? yNum);
    floatSum.push(yNum);
    bars.set([xs[i].toNumber(), xs[i + 1].toNumber(), 0, yNum], 4 * i);
  }
  if (exact) {
    for (const y of heights) sum = sum.add(y);
    sum = sum.multiply(h);
  } else sum = floatSum.reduce((s, y) => s + y, 0) * h.toNumber();
  return { kind: "bars", bars, sum, exact, heights, ...frame };
}

// ---- Taylor polynomials ------------------------------------------------------------------

/**
 * The Taylor polynomial of f at c of degree n: { coefficients, exact,
 * expression, ast }. `coefficients[k]` multiplies (x − c)^k: Rationals where
 * they are rational, certified RationalIntervals otherwise. `expression` is
 * text that graph() draws (irrational coefficients at their midpoints).
 */
export function taylorPolynomial(f, c, n = 3, params = {}, { variable = "x", digits = 20 } = {}) {
  const F = analyticFn(toAst(f), { variable, params });
  const centre = toRational(c);
  const coefficients = F.taylor(centre, n, { digits }).map(collapse);
  const exact = coefficients.every(isPoint);
  const X = centre.numerator === 0n ? v(variable) : op("-", v(variable), num(centre));
  let ast = null;
  coefficients.forEach((ck, k) => {
    // an irrational coefficient is drawn at the simplest fraction inside its enclosure
    const m = isPoint(ck) ? mid(ck) : simplestBetween(ck.low, ck.high);
    if (m.numerator === 0n) return;
    const term = k === 0 ? num(m) : op("*", num(m), k === 1 ? X : op("^", X, num(k)));
    ast = ast ? op("+", ast, term) : term;
  });
  ast ??= num(0);
  return { coefficients, exact, centre, degree: n, ast, expression: formatAst(ast) };
}

// ---- fields in the plane -----------------------------------------------------------------

/**
 * Arrows for the vector field (P(x, y), Q(x, y)) on a grid: an arrows frame.
 * `spacing` is the grid step in pixels. With `normalize: true` every arrow
 * has the same length and only the direction shows; otherwise lengths are
 * proportional to the field, the longest being `length` of a grid step.
 */
export function vectorField([P, Q], params = {}, vp, { spacing = 32, length = 0.85, normalize = false, variables = ["x", "y"] } = {}) {
  const view = asViewport(vp);
  const [xn, yn] = variables;
  const pf = compileFloat(toAst(P), xn);
  const qf = compileFloat(toAst(Q), xn);
  const p = { ...paramsToFloat(paramsToRational(params)) };
  const nx = Math.max(1, Math.floor(view.width / spacing));
  const ny = Math.max(1, Math.floor(view.height / spacing));
  const raw = [];
  let longest = 0;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const x = view.f.xmin + ((i + 0.5) / nx) * (view.f.xmax - view.f.xmin);
      const y = view.f.ymin + ((j + 0.5) / ny) * (view.f.ymax - view.f.ymin);
      p[yn] = y;
      // in pixels, so that arrow lengths compare on screen
      const u = pf(x, p) / view.f.dx;
      const w = qf(x, p) / view.f.dy;
      const len = Math.hypot(u, w);
      if (!Number.isFinite(len) || len === 0) continue;
      raw.push([x, y, u, w, len]);
      longest = Math.max(longest, len);
    }
  }
  const out = [];
  const magnitudes = [];
  for (const [x, y, u, w, len] of raw) {
    const scale = (spacing * length * (normalize ? 1 / len : 1 / longest)) / 2;
    // centred on the grid point
    out.push(x - u * scale * view.f.dx, y - w * scale * view.f.dy, x + u * scale * view.f.dx, y + w * scale * view.f.dy);
    magnitudes.push(len / longest);
  }
  return { kind: "arrows", segments: Float64Array.from(out), magnitudes };
}

/** The gradient field of F(x, y): arrows pointing uphill (see vectorField). */
export function gradientField(F, params, vp, options = {}) {
  const [xn, yn] = options.variables ?? ["x", "y"];
  const ast = toAst(F);
  return vectorField([differentiate(ast, xn), differentiate(ast, yn)], params, vp, options);
}

/**
 * The gradient of F at a point, certified: { point, value, gradient: [gx, gy],
 * exact, arrow, level, layers }. `arrow` points uphill from the point (an
 * arrows frame, scaled by `scale`), and `level` is the line tangent to the
 * level curve there, which is perpendicular to the gradient.
 */
export function gradientAt(F, at, params = {}, { variables = ["x", "y"], digits = 12, scale = 1 } = {}) {
  const fld = analyticField(toAst(F), variables, { params });
  const x = toRational(at[0]);
  const y = toRational(at[1]);
  const j = fld.jet([x, y], { digits, order: 1 });
  if (!j.gradient) throw new RangeError("the function is not differentiable there");
  const gradient = j.gradient.map(collapse);
  const value = collapse(j.value);
  const exact = gradient.every(isPoint);
  const [gx, gy] = gradient.map((g) => mid(g).toNumber());
  const P = point(x, y);
  const layers = [P];
  const arrow = { kind: "arrows", segments: Float64Array.from([x.toNumber(), y.toNumber(), x.toNumber() + gx * scale, y.toNumber() + gy * scale]), magnitudes: [1] };
  layers.push(arrow);
  let level = null;
  if (gx !== 0 || gy !== 0) {
    const [mx, my] = gradient.map(mid);
    level = line(P, point(x.subtract(exact ? my : nearRational(gy)), y.add(exact ? mx : nearRational(gx))));
    layers.push(level);
  }
  return { point: P, value, gradient, exact, arrow, level, layers };
}

/**
 * Level curves F(x, y) = c for each c in `levels`: [{ level, curve }] where
 * `curve` is the Refinement implicit() gives (float sketch, then certified
 * cells).
 */
export function contours(F, levels, params = {}, vp, options = {}) {
  const ast = toAst(F);
  return levels.map((c) => {
    const level = toRational(c);
    return { level, curve: implicit({ op: "cmp", rel: "=", F: level.numerator === 0n ? ast : op("-", ast, num(level)), text: `${formatAst(ast)} = ${level}` }, params, vp, options) };
  });
}
