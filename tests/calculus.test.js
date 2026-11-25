import { describe, expect, test } from "bun:test";
import { Rational, RationalInterval } from "@ratmath/core";
import {
  viewport, graph, tangent, secant, areaUnder, areaBetween, riemannSum, taylorPolynomial, vectorField, gradientField, gradientAt, contours,
  sceneSVG, sceneASCII, features, intersections, featureLabels, describe as describeGraph, radicalTeX, rationalForm, parse,
} from "../index.js";

const vp = viewport({ x: [-4, 4], y: [-3, 3], width: 400, height: 300 });
const within = (iv, x, tol = 1e-9) => iv.low.toNumber() <= x + tol && iv.high.toNumber() >= x - tol;

describe("tangents and secants", () => {
  test("exact where the function is rational", () => {
    const t = tangent("x^3 - x", 1);
    expect(t.exact).toBe(true);
    expect(String(t.slope)).toBe("2");
    expect(String(t.value)).toBe("0");
    expect(t.equation).toBe("y = 2x - 2");
    expect(t.layers.length).toBe(2);
    expect(String(secant("x^2", 0, 2).slope)).toBe("2");
    expect(String(tangent("a*x^2", 3, { a: "1/2" }).slope)).toBe("3");
  });
  test("a certified enclosure otherwise", () => {
    const t = tangent("sin(x)", 1);
    expect(t.exact).toBe(false);
    expect(t.slope).toBeInstanceOf(RationalInterval);
    expect(within(t.slope, Math.cos(1))).toBe(true);
    expect(t.slope.high.subtract(t.slope.low).toNumber()).toBeLessThan(1e-10);
    expect(sceneSVG(vp, [graph("sin(x)", {}, vp).quick.value, ...t.layers]).length).toBeGreaterThan(500);
  });
});

describe("areas", () => {
  test("an exact integral of a polynomial", () => {
    const a = areaUnder("x^2", [0, 3], {}, vp);
    expect(a.quick.value.kind).toBe("area");
    expect(a.quick.value.integral).toBeCloseTo(9, 6);
    const e = a.exact();
    expect(e.integral).toBeInstanceOf(Rational);
    expect(String(e.integral)).toBe("9");
    expect(e.above.length).toBe(1);
  });
  test("ends such as pi, and signed area between two graphs", () => {
    const s = areaUnder("sin(x)", [0, "pi"], {}, vp).exact();
    expect(within(s.integral, 2)).toBe(true);
    expect(s.improper).toBe(false);
    const b = areaBetween("x", "x^2", [0, 2], {}, vp).exact();
    expect(String(b.integral)).toBe("-2/3");
    expect(b.above.length).toBe(1);
    expect(b.below.length).toBe(1);
  });
  test("improper integrals converge or are proven to diverge", () => {
    const c = areaUnder("1/x^2", [1, "inf"], {}, vp).exact();
    expect(c.improper).toBe(true);
    expect(within(c.integral, 1)).toBe(true);
    expect(areaUnder("1/x", [1, "inf"], {}, vp).exact().integral).toBe(Infinity);
  });
  test("Riemann sums", () => {
    const sum = (rule) => riemannSum("x^2", [0, 1], 4, {}, { rule });
    expect(String(sum("left").sum)).toBe("7/32");
    expect(String(sum("right").sum)).toBe("15/32");
    expect(String(sum("midpoint").sum)).toBe("21/64");
    expect(String(sum("trapezoid").sum)).toBe("11/32");
    expect(sum("left").kind).toBe("bars");
    expect(sum("trapezoid").kind).toBe("area");
    expect(sum("lower").sum).toBeCloseTo(7 / 32, 12);
    expect(sum("upper").sum).toBeCloseTo(15 / 32, 12);
    expect(sceneSVG(vp, [sum("midpoint")]).length).toBeGreaterThan(300);
    expect(sceneASCII(vp, [sum("trapezoid")], { columns: 40 }).length).toBeGreaterThan(50);
  });
});

describe("Taylor polynomials", () => {
  test("exact coefficients at a rational point", () => {
    const t = taylorPolynomial("exp(x)", 0, 3);
    expect(t.exact).toBe(true);
    expect(t.coefficients.map(String)).toEqual(["1", "1", "1/2", "1/6"]);
    expect(graph(t.expression, {}, vp).quick.value.kind).toBe("polyline");
  });
  test("enclosures elsewhere", () => {
    const t = taylorPolynomial("sin(x)", 1, 2);
    expect(t.exact).toBe(false);
    expect(within(t.coefficients[0], Math.sin(1))).toBe(true);
    expect(within(t.coefficients[2], -Math.sin(1) / 2)).toBe(true);
  });
});

describe("fields, gradients and contours", () => {
  test("a vector field is a frame of arrows", () => {
    const f = vectorField(["-y", "x"], {}, vp);
    expect(f.kind).toBe("arrows");
    expect(f.segments.length % 4).toBe(0);
    expect(f.magnitudes.length).toBe(f.segments.length / 4);
    // each arrow of a rotation field is perpendicular to its position
    for (let k = 0; k < f.segments.length; k += 4) {
      const [x0, y0, x1, y1] = f.segments.slice(k, k + 4);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      expect(Math.abs(mx * (x1 - x0) + my * (y1 - y0))).toBeLessThan(1e-9);
    }
    expect(gradientField("x^2 + y^2", {}, vp, { normalize: true }).kind).toBe("arrows");
    expect(sceneSVG(vp, [f]).length).toBeGreaterThan(1000);
  });
  test("the gradient at a point", () => {
    const g = gradientAt("x^2 + y^2", [1, 2]);
    expect(g.exact).toBe(true);
    expect(g.gradient.map(String)).toEqual(["2", "4"]);
    expect(String(g.value)).toBe("5");
    expect(g.layers.length).toBe(3);
    const h = gradientAt("sin(x*y)", [1, 2]);
    expect(within(h.gradient[0], 2 * Math.cos(2))).toBe(true);
  });
  test("contour lines are implicit curves", () => {
    const cs = contours("x^2 + y^2", [1, 4], {}, vp);
    expect(cs.length).toBe(2);
    expect(cs[1].curve.quick.value.kind).toBe("polyline");
    expect(cs[1].curve.exact().kind).toBe("cells");
  });
});

describe("closed forms for the points of a graph", () => {
  const range = [-4, 4];
  test("zeros, extrema and inflections", async () => {
    const f = await features("x^4 - 2x^2 - 1", {}, range).settle();
    expect(f.zeros.map((z) => z.algebraic.text)).toEqual(["−√(1 + √2)", "√(1 + √2)"]);
    expect(f.zeros[0].algebraic.polynomial).toEqual([-1n, 0n, -2n, 0n, 1n]);
    expect(f.zeros[0].algebraic.tex).toBe("-\\sqrt{1 + \\sqrt{2}}");
    expect(f.inflections.map((p) => p.algebraic.text)).toEqual(["−√3/3", "√3/3"]);
    expect(String(f.inflections[0].value)).toBe("-14/9");
    expect(f.extrema.filter((e) => e.exact).length).toBe(3);
    const g = await features("x^3 - 2", {}, range).settle();
    expect(g.zeros[0].algebraic.text).toBe("∛2");
    expect((await features("x^4 - 2x^2 - 1", {}, range, { forms: false }).settle()).zeros[0].algebraic).toBeUndefined();
  });
  test("intersections", async () => {
    const pts = await intersections("x^2", "x + 1", {}, range).settle();
    expect(pts.map((p) => p.algebraic.text)).toEqual(["(1 − √5)/2", "(1 + √5)/2"]);
    expect(pts.map((p) => p.valueAlgebraic.text)).toEqual(["(3 − √5)/2", "(3 + √5)/2"]);
  });
  test("no closed form: digits, and transcendental functions are left alone", async () => {
    const f = await features("x^5 - x - 1", {}, range).settle();
    expect(f.zeros[0].algebraic.closedForm).toBe(false);
    expect(f.zeros[0].algebraic.degree).toBe(5);
    const s = await features("sin(x)", {}, [1, 4]).settle();
    expect(s.zeros[0].algebraic).toBeUndefined();
  });
  test("labels and prose use them", async () => {
    const f = await features("x^2 - 2", {}, range).settle();
    const labels = featureLabels(f);
    expect(labels.some((l) => l.tex === "\\sqrt{2}")).toBe(true);
    expect(describeGraph("x^2 - 2", {}, range)).toContain("√2");
    expect(sceneSVG(vp, [graph("x^2 - 2", {}, vp).quick.value, ...labels]).length).toBeGreaterThan(500);
  });
  test("radicals in TeX, and rational forms", () => {
    expect(radicalTeX("(1 + √5)/2")).toBe("\\frac{1 + \\sqrt{5}}{2}");
    expect(radicalTeX("−∛2")).toBe("-\\sqrt[3]{2}");
    expect(radicalTeX("√(1 + √2)")).toBe("\\sqrt{1 + \\sqrt{2}}");
    expect(radicalTeX("1.4142…")).toBe("1.4142\\ldots");
    const r = rationalForm(parse("(x^2 - 1)/(x + a)"), ["x"], { a: 2 });
    expect([...r.num].map(([k, c]) => `${k}:${c}`).sort()).toEqual(["0,0:-1", "2,0:1"]);
    expect(r.den.size).toBe(2);
    expect(rationalForm(parse("sin(x)"), ["x"])).toBe(null);
  });
});

describe("special functions in graphs", () => {
  test("float values", async () => {
    const { compileFloat } = await import("../src/expr.js");
    const val = (s, x) => compileFloat(parse(s))(x, {});
    expect(val("gamma(x)", 5)).toBeCloseTo(24, 9);
    expect(val("gamma(x)", 0.5)).toBeCloseTo(Math.sqrt(Math.PI), 9);
    expect(val("lgamma(x)", 10)).toBeCloseTo(Math.log(362880), 9);
    expect(val("besselJ(0, x)", 2.404825557695773)).toBeCloseTo(0, 9);
    expect(val("Si(x)", 1)).toBeCloseTo(0.946083070367183, 9);
    expect(val("digamma(x)", 1)).toBeCloseTo(-0.5772156649015329, 9);
  });
  test("certified cells hold the true values", () => {
    const view = viewport({ x: [1, 5], y: [0, 25], width: 40, height: 50 });
    const g = graph("gamma(x)", {}, view);
    expect(g.quick.value.kind).toBe("polyline");
    const cells = g.exact();
    expect(cells.kind).toBe("cells");
    // Γ(3) = 2 and Γ(4) = 6 at the left edges of columns 20 and 30
    const holds = (i, y) => {
      const row = Math.floor((25 - y) / 0.5);
      const s = cells.columns[i];
      for (let k = 0; k < s.length; k += 2) if (row >= s[k] - 1 && row <= s[k + 1] + 1) return true;
      return false;
    };
    expect(holds(20, 2)).toBe(true);
    expect(holds(30, 6)).toBe(true);
    expect(holds(30, 12)).toBe(false);
  });
});

test("tangent equations read naturally", () => {
  expect(tangent("x^2/2 - x + 1", 2).equation).toBe("y = x - 1");
  expect(tangent("-x^2/2", 1).equation).toBe("y = -x + 1/2");
  expect(tangent("x^2", 0).equation).toBe("y = 0");
  expect(tangent("x^2 + 3", 0).equation).toBe("y = 3");
  expect(tangent("x^2/4", 1).equation).toBe("y = 1/2·x - 1/4");
  expect(tangent("3x", 5).equation).toBe("y = 3x");
});
