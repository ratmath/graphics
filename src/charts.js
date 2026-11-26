// Charts for statistics and finance: the pictures phases of @ratmath/stats
// (phase 8) and @ratmath/finance (phase 7).
//
// Nothing here imports those packages. Each chart takes plain data, or an
// object with the shape the package returns (a distribution with pdf, cdf,
// quantile and fast float versions; a loan with a schedule; a simulation
// with bands; an option strategy with payoff and kinks), so graphics stays
// below them in the dependency order.
//
// Data charts place marks at the data's values (as doubles) and are marked
// exact; curves drawn from floating-point densities are estimated, with any
// certified number (an area, a probability) given in the notes; pictures of
// seeded simulations are marked simulated.

import { figure, shapes, path, dot, text, extentOf, CATEGORY, toNumber } from "./figure.js";
import { histogram as histogramFrame } from "./data.js";

const num = toNumber;
const fmt = (v, d = 4) => String(Number(Number(v).toPrecision(d)));
const pad = ([a, b], m = 0.06) => {
  const w = b - a || 1;
  return [a - w * m, b + w * m];
};
const asNumbers = (values) => values.map(num).filter(Number.isFinite);

/** Legend entries [{ label, color, kind: "line" | "box" }] at the top left of a window. */
export function legend(entries, X, Y, { corner = "nw" } = {}) {
  const w = X[1] - X[0];
  const h = Y[1] - Y[0];
  const right = corner.includes("e");
  const x = right ? X[1] - 0.3 * w : X[0] + 0.03 * w;
  const out = [];
  entries.forEach((e, i) => {
    const y = Y[1] - (0.06 + 0.07 * i) * h;
    if (e.kind === "box") out.push(path([[x, y - 0.015 * h], [x + 0.04 * w, y - 0.015 * h], [x + 0.04 * w, y + 0.015 * h], [x, y + 0.015 * h]], { closed: true, fill: e.color, fillAlpha: 0.35, color: e.color, width: 1 }));
    else out.push(path([[x, y], [x + 0.04 * w, y]], { color: e.color, width: 2.5, dash: e.dash }));
    out.push(text([x + 0.055 * w, y], e.tex ?? e.label, { anchor: "e", label: e.label, color: "currentColor", size: 12 }));
  });
  return shapes(out);
}

// ---- statistics ------------------------------------------------------------------------------

/**
 * The five numbers of a box plot, by Tukey's hinges: the medians of the lower
 * and upper halves (the median included in both when n is odd). Whiskers go
 * to the furthest data within 1.5 IQR of the box; the rest are outliers.
 */
export function fiveNumbers(values) {
  const v = asNumbers(values).sort((a, b) => a - b);
  if (!v.length) throw new RangeError("a box plot needs data");
  const med = (a) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const n = v.length;
  const half = Math.ceil(n / 2);
  const q1 = med(v.slice(0, half));
  const q3 = med(v.slice(n - half));
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const inside = v.filter((x) => x >= lo && x <= hi);
  return Object.freeze({ min: v[0], q1, median: med(v), q3, max: v[n - 1], whiskers: [inside[0], inside[inside.length - 1]], outliers: v.filter((x) => x < lo || x > hi), n });
}

/** Box plots side by side: groups is { name: values } or [[name, values], …]. */
export function boxPlot(groups, { title = "Box plot" } = {}) {
  const entries = Array.isArray(groups) ? groups : Object.entries(groups);
  const out = [];
  const stats = [];
  entries.forEach(([name, values], k) => {
    const s = fiveNumbers(values);
    stats.push({ name, ...s });
    const x = k + 1;
    const c = CATEGORY[k % CATEGORY.length];
    const w = 0.3;
    out.push(path([[x - w, s.q1], [x + w, s.q1], [x + w, s.q3], [x - w, s.q3]], { closed: true, fill: c, fillAlpha: 0.25, color: c }));
    out.push(path([[x - w, s.median], [x + w, s.median]], { color: c, width: 3 }));
    out.push(path([[x, s.q3], [x, s.whiskers[1]]], { color: c, width: 1.5 }), path([[x, s.q1], [x, s.whiskers[0]]], { color: c, width: 1.5 }));
    out.push(path([[x - w / 2, s.whiskers[1]], [x + w / 2, s.whiskers[1]]], { color: c, width: 1.5 }), path([[x - w / 2, s.whiskers[0]], [x + w / 2, s.whiskers[0]]], { color: c, width: 1.5 }));
    for (const o of s.outliers) out.push(dot([x, o], { r: 3.5, fill: "#fff", color: c }));
  });
  const ext = extentOf([shapes(out)]);
  const Y = pad(ext.y, 0.1);
  entries.forEach(([name], k) => out.push(text([k + 1, Y[0] + 0.04 * (Y[1] - Y[0])], name, { label: String(name), color: "currentColor", size: 12 })));
  return figure({ layers: [shapes(out)], x: [0.4, entries.length + 0.6], y: Y, axes: true, status: "exact", title, notes: ["boxes from Q1 to Q3 by Tukey's hinges, whiskers to the furthest data within 1.5 IQR"], stats });
}

/**
 * A histogram of the data, with a density curve over it when `distribution`
 * is given (anything with fast.pdf or a numeric pdf). density: true scales
 * the bars to area 1 (the default when a curve is drawn).
 */
export function histogramFigure(values, { bins = 12, range, distribution, density = Boolean(distribution), title = "Histogram" } = {}) {
  const h = histogramFrame(asNumbers(values), { bins, range, density });
  const layers = [{ item: h, color: CATEGORY[0] }];
  let status = "exact";
  if (distribution) {
    const f = densityFunction(distribution);
    const [a, b] = [h.edges[0], h.edges[h.edges.length - 1]];
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const x = a + ((b - a) * i) / 200;
      pts.push([x, f(x)]);
    }
    layers.push(shapes([path(pts, { color: CATEGORY[1], width: 2.5 })]));
    status = "estimated";
  }
  return figure({ layers, axes: true, status, title, notes: [`${bins} bins of width ${fmt(h.edges[1] - h.edges[0])}`], counts: h.counts, edges: h.edges });
}

const densityFunction = (d) => {
  if (typeof d === "function") return d;
  if (d?.fast?.pdf) return d.fast.pdf;
  if (typeof d?.pdf === "function") return (x) => num(d.pdf(x));
  throw new TypeError("expected a distribution with a pdf");
};

/**
 * The density curve of a distribution over `range`, with P(a ≤ X ≤ b)
 * shaded when `shade: [a, b]` is given. The curve comes from floats
 * (estimated); the shaded probability is the distribution's own prob(a, b)
 * when it has one (certified for the stats package) and is given in notes.
 */
export function densityFigure(distribution, { range, shade, samples = 240, title = "Density" } = {}) {
  const f = densityFunction(distribution);
  const q = distribution?.fast?.quantile;
  const R = (range ?? (q ? [q(0.001), q(0.999)] : [-4, 4])).map(num);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const x = R[0] + ((R[1] - R[0]) * i) / samples;
    const y = f(x);
    pts.push([x, Number.isFinite(y) ? y : NaN]);
  }
  const layers = [];
  const notes = [];
  let area = null;
  if (shade) {
    const [a, b] = shade.map(num);
    const poly = [[a, 0]];
    for (let i = 0; i <= samples; i++) {
      const x = a + ((b - a) * i) / samples;
      const y = f(x);
      if (Number.isFinite(y)) poly.push([x, y]);
    }
    poly.push([b, 0]);
    layers.push(shapes([path(poly, { closed: true, fill: CATEGORY[0], fillAlpha: 0.25, stroke: null })]));
    if (typeof distribution?.prob === "function") {
      area = distribution.prob(shade[0], shade[1]);
      const lo = area?.low ?? area?.lo ?? area;
      const hi = area?.high ?? area?.hi ?? area;
      notes.push(`shaded: P(${fmt(a)} ≤ X ≤ ${fmt(b)}) in [${fmt(num(lo), 10)}, ${fmt(num(hi), 10)}] (${distribution.kind ?? "computed"})`);
    }
  }
  const good = pts.filter((p) => Number.isFinite(p[1]));
  layers.push(shapes([path(good, { color: CATEGORY[0], width: 2.5 })]));
  const top = Math.max(...good.map((p) => p[1]));
  return figure({ layers, x: R, y: [-0.04 * top, 1.1 * top], axes: true, status: "estimated", title, notes, area });
}

/**
 * A normal (or any) quantile plot: the sorted data against the
 * distribution's quantiles at (i − 1/2)/n, with the line through the
 * quartiles. Points near the line mean the data fit the distribution's shape.
 */
export function qqPlot(values, distribution, { title = "Quantile plot" } = {}) {
  const q = distribution?.fast?.quantile ?? distribution;
  if (typeof q !== "function") throw new TypeError("expected a distribution with fast.quantile, or a quantile function");
  const v = asNumbers(values).sort((a, b) => a - b);
  const n = v.length;
  const pts = v.map((y, i) => [q((i + 0.5) / n), y]);
  const qx = [q(0.25), q(0.75)];
  const s = fiveNumbers(v);
  const slope = (s.q3 - s.q1) / (qx[1] - qx[0]);
  const icept = s.q1 - slope * qx[0];
  const X = pad([pts[0][0], pts[n - 1][0]]);
  return figure({
    layers: [shapes([path([[X[0], icept + slope * X[0]], [X[1], icept + slope * X[1]]], { color: CATEGORY[1], width: 1.5, dash: [6, 4] }), ...pts.map((p) => dot(p, { r: 3, color: CATEGORY[0] }))])],
    x: X, axes: true, status: "estimated", title, notes: ["theoretical quantiles from floats; data exact"], line: { slope, intercept: icept },
  });
}

/**
 * Data with a fitted line and an optional band. fit is { intercept, slope }
 * or a regression result with coefficients [b0, b1]; band is a function
 * x → [low, high] (a confidence or prediction band).
 */
export function scatterFit(points, { fit, band, range, title = "Scatter plot" } = {}) {
  const P = points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]).map(num));
  const xs = P.map((p) => p[0]);
  const X = range ? range.map(num) : pad([Math.min(...xs), Math.max(...xs)]);
  const out = [];
  let line = null;
  if (fit) {
    const b0 = num(fit.intercept ?? fit.coefficients?.[0] ?? fit[0]);
    const b1 = num(fit.slope ?? fit.coefficients?.[1] ?? fit[1]);
    line = { intercept: b0, slope: b1 };
    if (band) {
      const up = [];
      const down = [];
      for (let i = 0; i <= 80; i++) {
        const x = X[0] + ((X[1] - X[0]) * i) / 80;
        const [lo, hi] = band(x).map(num);
        up.push([x, hi]);
        down.push([x, lo]);
      }
      out.push(path([...up, ...down.reverse()], { closed: true, fill: CATEGORY[1], fillAlpha: 0.15, stroke: null }));
    }
    out.push(path([[X[0], b0 + b1 * X[0]], [X[1], b0 + b1 * X[1]]], { color: CATEGORY[1], width: 2 }));
  }
  for (const p of P) out.push(dot(p, { r: 3, color: CATEGORY[0] }));
  return figure({ layers: [shapes(out)], x: X, axes: true, status: band ? "estimated" : "exact", title, line, notes: line ? [`fitted line y = ${fmt(line.intercept)} + ${fmt(line.slope)}x`] : [] });
}

/**
 * Lines through series of points: series is [{ name, points: [[x, y], …], color?, dash? }].
 * The general chart behind power curves, balances and yield curves.
 */
export function lineChart(series, { x, y, title = "", status = "exact", markers = false, legendCorner = "nw", notes = [] } = {}) {
  const out = [];
  series.forEach((s, k) => {
    const c = s.color ?? CATEGORY[k % CATEGORY.length];
    const pts = s.points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]).map(num));
    out.push(path(pts, { color: c, width: 2.2, dash: s.dash }));
    if (markers || s.markers) for (const p of pts) out.push(dot(p, { r: 3, color: c }));
  });
  const ext = extentOf([shapes(out)]);
  const X = x ? x.map(num) : ext.x;
  const Y = y ? y.map(num) : pad(ext.y, 0.12);
  const layers = [shapes(out)];
  if (series.length > 1 || series[0]?.name) layers.push(legend(series.map((s, k) => ({ label: s.name ?? `series ${k + 1}`, color: s.color ?? CATEGORY[k % CATEGORY.length], dash: s.dash })), X, Y, { corner: legendCorner }));
  return figure({ layers, x: X, y: Y, axes: true, title, status, notes });
}

/**
 * Power curves: the probability that a test rejects, against the true
 * effect. curves is [{ name, points: [[effect, power], …] }]; the level
 * (default 0.05) is drawn as a dashed line.
 */
export function powerCurve(curves, { level = 0.05, status = "exact", title = "Power" } = {}) {
  const list = Array.isArray(curves) && Array.isArray(curves[0]) ? [{ name: "power", points: curves }] : curves;
  const fig = lineChart(list, { y: [-0.04, 1.04], title, status, markers: true, legendCorner: "se" });
  const L = num(level);
  return figure({ ...fig, layers: [...fig.layers, shapes([path([[fig.x[0], L], [fig.x[1], L]], { color: "#6b7280", width: 1, dash: [4, 4] }), text([fig.x[1], L], `\\alpha = ${fmt(L)}`, { anchor: "nw", label: `α = ${fmt(L)}`, color: "#6b7280", size: 12 })])] });
}

/**
 * The build-up of a sampling distribution: frames of a histogram of the
 * first k values for k at `steps` (default 10, 30, 100, … up to all). Each
 * frame shares bins and scales, so they animate. Seeded values make a
 * simulated picture: the same seed draws it again.
 */
export function samplingBuildUp(values, { bins = 15, steps, range, distribution, title = "Sampling distribution" } = {}) {
  const v = asNumbers(values);
  const R = range ? range.map(num) : [Math.min(...v), Math.max(...v)];
  const ks = steps ?? [10, 30, 100, 300, 1000, 3000, 10000].filter((k) => k < v.length).concat([v.length]);
  const frames = ks.map((k) => histogramFigure(v.slice(0, k), { bins, range: R, distribution, density: true, title: `${title}: ${k} samples` }));
  const top = Math.max(...frames.flatMap((f) => Array.from(f.layers[0].item.bars).filter((_, i) => i % 4 === 3)));
  return Object.freeze({ kind: "frames", frames: frames.map((f, i) => figure({ ...f, y: [-0.04 * top, 1.15 * top], status: "simulated", notes: [`${ks[i]} of ${v.length} values`] })), steps: ks });
}

// ---- finance ---------------------------------------------------------------------------------

/**
 * A loan's payments split into interest and principal, period by period
 * (stacked bars), from a schedule [{ period, interest, principal, extra?,
 * balloon? }] or a loan with one. Exact: the bars are the schedule's cents.
 */
export function amortisationChart(loanOrSchedule, { title = "Payments: interest and principal" } = {}) {
  const rows = loanOrSchedule.schedule ?? loanOrSchedule;
  const interest = [];
  const principal = [];
  for (const r of rows) {
    const k = num(r.period);
    const i = num(r.interest);
    const p = num(r.principal) + num(r.extra ?? 0) + num(r.balloon ?? 0);
    interest.push(k - 0.4, k + 0.4, 0, i);
    principal.push(k - 0.4, k + 0.4, i, i + p);
  }
  const X = [num(rows[0].period) - 1, num(rows[rows.length - 1].period) + 1];
  const top = Math.max(...principal.filter((_, i) => i % 4 === 3));
  const Y = [-0.03 * top, 1.2 * top];
  return figure({
    layers: [{ item: { kind: "bars", bars: Float64Array.from(interest) }, color: CATEGORY[1], fillAlpha: 0.6, width: 0.5 }, { item: { kind: "bars", bars: Float64Array.from(principal) }, color: CATEGORY[0], fillAlpha: 0.6, width: 0.5 }, legend([{ label: "interest", color: CATEGORY[1], kind: "box" }, { label: "principal", color: CATEGORY[0], kind: "box" }], X, Y, { corner: "ne" })],
    x: X, y: Y, axes: true, status: "exact", title,
  });
}

/** The balance left after each period, from a schedule or a loan (exact cents). */
export function balanceChart(loanOrSchedule, { title = "Balance" } = {}) {
  const rows = loanOrSchedule.schedule ?? loanOrSchedule;
  const start = loanOrSchedule.principal !== undefined ? [[0, num(loanOrSchedule.principal)]] : [];
  return lineChart([{ name: "balance", points: [...start, ...rows.map((r) => [num(r.period), num(r.balance)])] }], { title, legendCorner: "ne" });
}

/**
 * A fan chart of percentile bands over time: bands is [{ period, 5: x, 25: x,
 * 50: x, 75: x, 95: x }] (a simulation's bands, or a simulation itself).
 * The outer band joins the lowest and highest percentiles, the inner one the
 * next pair, and the median is a line. Marked simulated.
 */
export function fanChart(bandsOrSimulation, { title = "Percentile bands", periodsPerYear = 1 } = {}) {
  const bands = bandsOrSimulation.bands ?? bandsOrSimulation;
  const keys = Object.keys(bands[0]).filter((k) => k !== "period" && Number.isFinite(Number(k))).map(Number).sort((a, b) => a - b);
  const t = (b) => num(b.period) / periodsPerYear;
  const out = [];
  const pairs = [];
  for (let i = 0; i < Math.floor(keys.length / 2); i++) pairs.push([keys[i], keys[keys.length - 1 - i]]);
  pairs.forEach(([lo, hi], i) => {
    const up = bands.map((b) => [t(b), num(b[hi])]);
    const down = bands.map((b) => [t(b), num(b[lo])]).reverse();
    out.push(path([...up, ...down], { closed: true, fill: CATEGORY[0], fillAlpha: 0.15 + 0.15 * i, stroke: null }));
  });
  const mid = keys.length % 2 ? keys[(keys.length - 1) / 2] : null;
  if (mid !== null) out.push(path(bands.map((b) => [t(b), num(b[mid])]), { color: CATEGORY[0], width: 2.2 }));
  const ext = extentOf([shapes(out)]);
  const Y = pad(ext.y, 0.1);
  return figure({ layers: [shapes(out), legend([...pairs.map(([lo, hi], i) => ({ label: `${lo}th to ${hi}th percentile`, color: CATEGORY[0], kind: "box" })), ...(mid !== null ? [{ label: `median (${mid}th)`, color: CATEGORY[0] }] : [])], ext.x, Y)], x: ext.x, y: Y, axes: true, status: "simulated", title });
}

/**
 * A yield curve: spot rates against maturity in years. Takes points
 * [[years, rate], …] or a curve with periods, frequency and spot(k).
 * Exact when the rates are (a curve's spot rates are computed to `digits`).
 */
export function yieldCurveFigure(curve, { title = "Yield curve", percent = true } = {}) {
  const pts = Array.isArray(curve) ? curve.map((p) => p.map(num)) : Array.from({ length: curve.periods }, (_, i) => [(i + 1) / curve.frequency, num(curve.spot(i + 1))]);
  const scale = percent ? 100 : 1;
  return lineChart([{ name: percent ? "spot rate (%)" : "spot rate", points: pts.map(([x, r]) => [x, r * scale]), markers: true }], { title, x: [0, pts[pts.length - 1][0] * 1.05] });
}

/**
 * The payoff and profit of an option position at expiry, against the
 * underlying price. strategy has payoff(S), profit(S), kinks and breakEvens
 * (finance's strategy()); the lines are drawn exactly through the kinks, so
 * the picture is exact.
 */
export function payoffFigure(strategy, { range, title = "Payoff at expiry" } = {}) {
  const kinks = (strategy.kinks ?? []).map(num);
  const R = (range ?? [0, Math.max(1, ...kinks) * 1.6]).map(num);
  const xs = [R[0], ...kinks.filter((k) => k > R[0] && k < R[1]), R[1]].sort((a, b) => a - b);
  const val = (f, x) => num(f(String(x)));
  const pay = xs.map((x) => [x, val(strategy.payoff, x)]);
  const prof = xs.map((x) => [x, val(strategy.profit ?? strategy.payoff, x)]);
  const out = [path([[R[0], 0], [R[1], 0]], { color: "#9ca3af", width: 1 }), path(pay, { color: CATEGORY[0], width: 2.5 }), path(prof, { color: CATEGORY[1], width: 2, dash: [6, 4] })];
  for (const b of strategy.breakEvens ?? []) out.push(dot([num(b), 0], { r: 4, color: CATEGORY[1] }), text([num(b), 0], fmt(num(b)), { anchor: "s", color: CATEGORY[1], size: 12 }));
  const ext = extentOf([shapes(out)]);
  const Y = pad(ext.y, 0.15);
  return figure({ layers: [shapes(out), legend([{ label: "payoff", color: CATEGORY[0] }, { label: "profit", color: CATEGORY[1], dash: [6, 4] }], R, Y)], x: R, y: Y, axes: true, status: "exact", title, notes: kinks.length ? [`kinks at ${kinks.map((k) => fmt(k)).join(", ")}`] : [] });
}
