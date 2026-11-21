import { describe, expect, test } from "bun:test";
import { parse, viewport, graph, toSVG } from "../index.js";
import { derive, format } from "../src/derive.js";
import { compileFloat } from "../src/expr.js";
import { features, findExtrema, findInflections, findPoles } from "../src/features.js";

const show = (r) => `${r.kind}${r.certain === false ? "?" : ""} ${r.exact ? r.at : `[${r.lo}, ${r.hi}]`}`;
const contains = (r, x) => r.lo.toNumber() <= x + 1e-12 && r.hi.toNumber() >= x - 1e-12;

describe("symbolic derivative", () => {
  test("agrees with a numerical derivative", () => {
    const cases = ["x^3 - 3x", "a*sin(b*x) + c*x", "exp(x/3)*cos(x)", "sqrt(9 - x^2)", "ln(x)/x", "tan(x)", "x^(3/2)", "2^x", "abs(x - 1)", "1/(x^2 + 1)"];
    const p = { a: 2, b: 1.5, c: 0.25 };
    for (const s of cases) {
      const f = compileFloat(parse(s));
      const d = compileFloat(derive(parse(s)));
      for (const x of [0.3, 0.7, 1.3, 2.1]) {
        const h = 1e-6;
        const num = (f(x + h, p) - f(x - h, p)) / (2 * h);
        expect(Math.abs(d(x, p) - num)).toBeLessThan(1e-5 * (1 + Math.abs(num)));
      }
    }
  });
  test("simplifies constants", () => {
    expect(format(derive(parse("x^3 - 3x")))).toBe("3 * x^2 - 3");
    expect(format(derive(derive(parse("x^3 - 3x"))))).toBe("6 * x");
  });
});

describe("poles", () => {
  test("rational poles are exact", () => {
    expect(findPoles("1/(x - 1/3) + x^2/8 - 2", {}, [-8, 8]).map(show)).toEqual(["pole 1/3"]);
    expect(findPoles("x^-2", {}, [-1, 1]).map(show)).toEqual(["pole 0"]);
    expect(findPoles("ln(x)", {}, [-1, 1]).map(show)).toEqual(["log 0"]);
  });
  test("irrational poles are certified brackets", () => {
    const sq = findPoles("1/(x^2 - 2)", {}, [-8, 8], { tolerance: "1/100000" });
    expect(sq.length).toBe(2);
    expect(sq.every((p) => p.certain && !p.exact)).toBe(true);
    expect(contains(sq[1], Math.SQRT2)).toBe(true);
    const t = findPoles("tan(x)", {}, [-4, 4], { tolerance: "1/100000" });
    expect(t.map((p) => p.certain)).toEqual([true, true]);
    expect(contains(t[1], Math.PI / 2)).toBe(true);
    expect(contains(t[0], -Math.PI / 2)).toBe(true);
  });
  test("a removable singularity is not claimed as a pole", () => {
    expect(findPoles("x/x", {}, [-1, 1]).map(show)).toEqual(["pole? 0"]);
  });
});

describe("extrema", () => {
  test("polynomials: exact points and values", () => {
    expect(findExtrema("x^3 - 3x", {}, [-4, 4]).map((e) => `${show(e)} ${e.value}`)).toEqual(["max -1 2", "min 1 -2"]);
    expect(findExtrema("x^4 - 2x^2", {}, [-4, 4]).map(show)).toEqual(["min -1", "max 0", "min 1"]);
    expect(findExtrema("x^3", {}, [-1, 1]).map(show)).toEqual(["flat 0"]);
  });
  test("transcendental: proven brackets", () => {
    const e = findExtrema("a*sin(b*x) + c*x", { a: 2, b: 1, c: "1/4" }, [-8, 8], { tolerance: "1/100000" });
    expect(e.map((r) => r.kind)).toEqual(["min", "max", "min", "max", "min", "max"]);
    // 2cos(x) + 1/4 = 0 at x = acos(-1/8)
    const x0 = Math.acos(-1 / 8);
    expect(e.some((r) => r.kind === "max" && contains(r, x0))).toBe(true);
    const s = findExtrema("sqrt(9 - x^2)", {}, [-8, 8]);
    expect(s.map((r) => r.kind)).toEqual(["max"]);
    expect(s[0].valueLo.toNumber()).toBeCloseTo(3, 4);
  });
  test("a pole between extrema does not confuse the sides", () => {
    expect(findExtrema("1/(x - 1/3) + x^2/8 - 2", {}, [-8, 8]).map((r) => r.kind)).toEqual(["min"]);
    expect(findExtrema("x + 1/x", {}, [-4, 4]).map(show)).toEqual(["max -1", "min 1"]);
  });
});

describe("inflection points", () => {
  test("exact and bracketed", () => {
    expect(findInflections("x^3 - 3x", {}, [-4, 4]).map(show)).toEqual(["concave-to-convex 0"]);
    expect(findInflections("x^4", {}, [-4, 4])).toEqual([]);
    const s = findInflections("sin(x)", {}, [1, 7], { tolerance: "1/100000" });
    expect(s.length).toBe(2);
    expect(contains(s[0], Math.PI) && contains(s[1], 2 * Math.PI)).toBe(true);
  });
});

describe("features() and asymptotes in graphs", () => {
  test("quick then certified", () => {
    const f = features("x^3 - 3x", {}, [-4, 4]);
    expect(f.quick.value.extrema.map((e) => e.kind)).toEqual(["max", "min"]);
    const v = f.exact();
    expect(v.extrema.map(show)).toEqual(["max -1", "min 1"]);
    expect(v.inflections.map(show)).toEqual(["concave-to-convex 0"]);
    expect(v.zeros.length).toBe(3);
  });
  test("certified graph frames carry dashed asymptotes", () => {
    const vp = viewport({ x: [-4, 4], y: [-3, 3], width: 320, height: 200 });
    const g = graph("tan(x)", {}, vp);
    expect(g.quick.value.asymptotes.length).toBe(2);
    const frame = g.exact();
    expect(frame.asymptotes.map((a) => a.certain)).toEqual([true, true]);
    expect(Math.abs(frame.asymptotes[1].px - ((Math.PI / 2 + 4) / 8) * 320)).toBeLessThan(0.1);
    expect(toSVG(frame)).toContain('stroke-dasharray="6 4"');
  });
});

test("features() does not list a pole of tan as a possible zero", () => {
  const v = features("tan(x)", {}, [-4, 4], { tolerance: "1/10000" }).exact();
  expect(v.zeros.map((r) => r.kind)).toEqual(["sign-change", "sign-change", "sign-change"]);
  expect(v.poles.length).toBe(2);
});
