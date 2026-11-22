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

describe("holes and domain endpoints", () => {
  const ex = (f, r = [-4, 4]) => features(f, {}, r, { tolerance: "1/100000" }).exact();
  test("holes are removable points, not poles", () => {
    const a = ex("x/x");
    expect(a.poles).toEqual([]);
    expect(a.holes.map((h) => `${h.at} ${h.valueApprox}`)).toEqual(["0 1"]);
    const b = ex("(x^2 - 1)/(x - 1)");
    expect(b.holes.map((h) => `${h.at} ${h.valueApprox}`)).toEqual(["1 2"]);
    const c = ex("sin(x)/x");
    expect(c.holes[0].valueApprox).toBeCloseTo(1, 6);
    expect(c.zeros.every((z) => z.kind === "sign-change")).toBe(true);
  });
  test("domain endpoints: included, with sides", () => {
    const s = ex("sqrt(9 - x^2)");
    expect(s.endpoints.map((e) => `${e.at} ${e.side} ${e.included}`)).toEqual(["-3 right true", "3 left true"]);
    expect(s.zeros.map((z) => `${z.kind} ${z.at}`)).toEqual(["exact -3", "exact 3"]);
    expect(s.extrema.map((e) => `${e.kind} ${e.at}`)).toEqual(["max 0"]);
    expect(ex("x^(1/2)").endpoints.map((e) => `${e.at} ${e.included}`)).toEqual(["0 true"]);
    const irr = ex("sqrt(x^2 - 2)");
    expect(irr.endpoints.map((e) => e.side)).toEqual(["left", "right"]);
    expect(irr.endpoints[1].lo.toNumber()).toBeLessThanOrEqual(Math.SQRT2);
    expect(irr.endpoints[1].hi.toNumber()).toBeGreaterThanOrEqual(Math.SQRT2);
  });
  test("an excluded end that is a pole is drawn as an asymptote, not a dot", () => {
    const v = ex("1/sqrt(x)");
    expect(v.endpoints).toEqual([]);
    expect(v.poles.map((p) => `${p.at} ${p.certain}`)).toEqual(["0 true"]);
  });
  test("a constant derivative has no extrema", () => {
    expect(ex("x/x").extrema).toEqual([]);
    expect(ex("(x^2 - 1)/(x - 1)").inflections).toEqual([]);
  });
});

import { markerList, shade } from "../src/render/markers.js";
test("marker roles and fills follow the convention", () => {
  const v = features("sqrt(9 - x^2) * x", {}, [-4, 4], { tolerance: "1/10000" }).exact();
  const roles = markerList(v).map((m) => `${m.role}${m.filled ? "" : "(open)"}`);
  expect(roles).toContain("zero");
  expect(roles).toContain("extremum");
  expect(roles).toContain("endpoint");
  expect(markerList(features("x/x", {}, [-1, 1]).exact()).map((m) => `${m.role}${m.filled ? "" : "(open)"}`)).toEqual(["hole(open)"]);
  expect(shade("#2563eb", -0.5)).toBe("rgb(19, 50, 118)");
  expect(shade("#000", 1)).toBe("rgb(255, 255, 255)");
});

test("a hole does not starve the rest of the range (per-piece work budget)", () => {
  const v = features("(x^2 - 1)/(x - 1) + sin(2x)/2", {}, [-8, 8], { tolerance: "1/10000" }).exact();
  // f'' = -2 sin(2x): inflections at k*pi/2 for |k| <= 5, on both sides of the hole at 1.
  expect(v.inflections.length).toBe(11);
  for (let k = -5; k <= 5; k++) {
    expect(v.inflections.some((r) => r.lo.toNumber() <= (k * Math.PI) / 2 + 1e-9 && r.hi.toNumber() >= (k * Math.PI) / 2 - 1e-9)).toBe(true);
  }
  expect(v.holes.map((h) => String(h.at))).toEqual(["1"]);
});
