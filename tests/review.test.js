// Review fixes and the features added with them.
import { describe, expect, test } from "bun:test";
const ex = (f, r = [-4, 4]) => features(f, {}, r, { tolerance: "1/100000" }).exact();
import { graph as graphOf, parametric, polar, intersections, findIntersections, describe as describeGraph, features, area as areaOf, isSimple, scatter, bars, histogram, slopeField, solutionCurve, sceneSVG, axesPrimitives, logScale, compileFloat as cf, parse as parseExpr, viewport as vpOf } from "../index.js";

describe("asymptotes are only drawn where a pole is proven", () => {
  const vp = vpOf({ x: [-2, 2], y: [-2, 2], width: 200, height: 200 });
  test.each(["sin(1/x)", "x*sin(1/x)", "exp(-1/x^2)"])("%s has no asymptote, one undefined point", (e) => {
    const g = graphOf(e, {}, vp);
    expect(g.quick.value.asymptotes).toEqual([]);
    const f = g.exact();
    expect(f.asymptotes).toEqual([]);
    expect(f.undefined.length).toBe(1);
  });
  test("1/x keeps its asymptote and x^(-1/3) gets one", () => {
    expect(graphOf("1/x", {}, vp).exact().asymptotes.length).toBe(1);
    expect(graphOf("x^(-1/3)", {}, vp).exact().asymptotes.length).toBe(1);
    expect(graphOf("1/x", {}, vp).quick.value.asymptotes.length).toBe(1);
  });
});

describe("odd roots and the functions shared with analytic", () => {
  const vp = vpOf({ x: [-2, 2], y: [-2, 2], width: 120, height: 120 });
  test("x^(1/3) is drawn for negative x", () => {
    expect(cf(parseExpr("x^(1/3)"))(-8, {})).toBeCloseTo(-2, 12);
    expect(cf(parseExpr("x^(2/3)"))(-8, {})).toBeCloseTo(4, 12);
    const f = graphOf("x^(1/3)", {}, vp).exact();
    expect(f.columns.filter((c) => c && c.length).length).toBe(120);
    expect(ex("x^(1/3)").endpoints).toEqual([]);
  });
  test.each([
    ["atan(x)", Math.atan], ["asin(x/2)", (x) => Math.asin(x / 2)], ["erf(x)", null], ["sinh(x)", Math.sinh], ["tanh(2x)", (x) => Math.tanh(2 * x)], ["cbrt(x)", Math.cbrt], ["cosh(x) - 1", (x) => Math.cosh(x) - 1], ["acos(x/2)", (x) => Math.acos(x / 2)],
  ])("%s: the certified cells hold the true curve", (e, ref) => {
    const f = graphOf(e, {}, vp).exact();
    expect(f.tight).toBe(true);
    if (!ref) return;
    for (let i = 0; i < 120; i++) {
      const x = -2 + (i + 0.5) / 30;
      const row = Math.floor((2 - ref(x)) * 30);
      if (row < 0 || row >= 120) continue;
      const s = f.columns[i];
      expect(s && s[0] <= row && row <= s[s.length - 1]).toBe(true);
    }
  });
  test("asin has domain ends", () => {
    const e = ex("asin(x/2)", [-3, 3]).endpoints;
    expect(e.map((p) => [p.side, p.included, p.at.toString()])).toEqual([["right", true, "-2"], ["left", true, "2"]]);
  });
});

describe("parametric and polar curves", () => {
  const vp = vpOf({ x: [-2, 2], y: [-2, 2], width: 160, height: 160 });
  const lit = (f, i, j) => { const s = f.columns[i]; if (!s) return false; for (let k = 0; k < s.length; k += 2) if (j >= s[k] && j <= s[k + 1]) return true; return false; };
  test.each([
    ["circle", () => parametric({ x: "cos(t)", y: "sin(t)" }, {}, [0, 7], vp), (t) => [Math.cos(t), Math.sin(t)]],
    ["cardioid", () => polar("1 + cos(t)", {}, [0, 7], vp), (t) => [(1 + Math.cos(t)) * Math.cos(t), (1 + Math.cos(t)) * Math.sin(t)]],
    ["rose", () => polar("2cos(3t)", {}, [0, 7], vp), (t) => [2 * Math.cos(3 * t) * Math.cos(t), 2 * Math.cos(3 * t) * Math.sin(t)]],
  ])("%s: every sample lies in a lit pixel and the curve stays thin", (_, make, at) => {
    const r = make();
    expect(r.quick.value.kind).toBe("polyline");
    const f = r.exact();
    expect(f.tight).toBe(true);
    let count = 0;
    for (const s of f.columns) if (s) for (let k = 0; k < s.length; k += 2) count += s[k + 1] - s[k] + 1;
    for (let k = 0; k <= 20000; k++) {
      const [x, y] = at((7 * k) / 20000);
      const i = Math.floor((x + 2) * 40);
      const j = Math.floor((2 - y) * 40);
      if (i < 0 || i >= 160 || j < 0 || j >= 160) continue;
      expect(lit(f, i, j)).toBe(true);
    }
    expect(count).toBeLessThan(4000);
  });
});

describe("intersections", () => {
  test("a parabola and a line meet at exact points", () => {
    const r = findIntersections("x^2", "x + 2", {}, [-3, 3]);
    expect(r.map((p) => [p.at.toString(), p.value.toString()])).toEqual([["-1", "1"], ["2", "4"]]);
  });
  test("sin and cos meet at π/4 with value √2/2", () => {
    const [p] = intersections("sin(x)", "cos(x)", {}, [0, 2]).exact();
    expect(p.lo.toNumber()).toBeLessThanOrEqual(Math.PI / 4);
    expect(p.hi.toNumber()).toBeGreaterThanOrEqual(Math.PI / 4);
    expect(p.valueLo.toNumber()).toBeLessThanOrEqual(Math.SQRT1_2);
    expect(p.valueHi.toNumber()).toBeGreaterThanOrEqual(Math.SQRT1_2);
    expect(intersections("sin(x)", "cos(x)", {}, [0, 2]).quick.value[0].x).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe("polygons, data and descriptions", () => {
  test("area refuses a bow tie", () => {
    expect(areaOf([[0, 0], [4, 0], [0, 3]]).toString()).toBe("6");
    expect(isSimple([[0, 0], [2, 2], [2, 0], [0, 2]])).toBe(false);
    expect(() => areaOf([[0, 0], [2, 2], [2, 0], [0, 2]])).toThrow(RangeError);
  });
  test("histogram counts and bins", () => {
    const h = histogram([0, 1, 1.2, 1.9, 2, 2.5, 3.9, 4], { bins: 4, range: [0, 4] });
    expect(h.counts).toEqual([1, 3, 2, 2]);
    expect(h.edges).toEqual([0, 1, 2, 3, 4]);
  });
  test("data frames and slope fields draw in a scene", () => {
    const vp = vpOf({ x: [0, 4], y: [-1, 3], width: 200, height: 160 });
    const svg = sceneSVG(vp, [slopeField("x - y", {}, vp), scatter([[1, 1], [2, "3/2"]], { join: true }), bars([[1, 1], [2, 2]])], { axes: true });
    expect((svg.match(/<circle/g) ?? []).length).toBe(2);
    expect(slopeField("x - y", {}, vp, { spacing: 40 }).segments.length).toBe(5 * 4 * 4);
  });
  test("an ODE solution curve holds the true solution", () => {
    const vp = vpOf({ x: [0, 2], y: [0, 2], width: 100, height: 100 });
    const f = solutionCurve({ f: "t - y", y0: 1, until: 2 }, vp).exact();
    expect(f.complete).toBe(true);
    for (let i = 0; i < 100; i++) {
      const t = (i + 0.5) / 50;
      const row = Math.floor((2 - (t - 1 + 2 * Math.exp(-t))) * 50);
      expect(f.columns[i][0] <= row && row <= f.columns[i][1]).toBe(true);
      expect(f.columns[i][1] - f.columns[i][0]).toBeLessThanOrEqual(2);
    }
  });
  test("axis ticks in π, fractions and powers of ten", () => {
    const labels = (vp, o) => axesPrimitives(vp, o).filter((p) => p.t === "label").map((p) => p.text);
    expect(labels(vpOf({ x: [-7, 7], y: [-2, 2], width: 600, height: 300 }), { xUnit: "pi" }).slice(0, 4)).toEqual(["−2π", "−π", "π", "2π"]);
    expect(labels(vpOf({ x: [0, 2], y: [0, 1], width: 400, height: 300 }), { xUnit: "fraction", yUnit: "fraction" })).toEqual(["1/2", "1", "3/2", "1/4", "1/2", "3/4"]);
    expect(labels(vpOf({ x: [-3, 3], y: [-2, 2], width: 600, height: 300 }), { xScale: "log" })).toContain("10⁻²");
    expect(cf(logScale("x^2", { x: true, y: true }))(1, {})).toBeCloseTo(2, 12);
  });
  test("describe reads the certified features", () => {
    const s = describeGraph("x^3 - 3x", {}, [-3, 3]);
    expect(s).toContain("meets the x-axis 3 times");
    expect(s).toContain("one local maximum, at (−1, 2)");
    expect(s).toContain("one local minimum, at (1, −2)");
    expect(describeGraph("sin(x)/x", {}, [-4, 4])).toContain("hole at x = 0, where the value would be 1");
    expect(describeGraph("x - x", {}, [0, 1])).toContain("zero on all of 0 to 1");
  });
});
