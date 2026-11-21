import { describe, expect, test } from "bun:test";
import { Rational } from "@ratmath/core";
import { parse, compileFloat, compileExact, isRationalOnly, freeVariables, findZeros, zeros, viewport, precisionFor } from "../index.js";
import { simplestBetween } from "../src/roots.js";

const R = (n, d = 1) => new Rational(BigInt(n), BigInt(d));

describe("parser", () => {
  const f = (s, x, p = {}) => compileFloat(parse(s))(x, p);
  test("precedence and implicit multiplication", () => {
    expect(f("1 + 2*x^2", 3)).toBe(19);
    expect(f("-x^2", 3)).toBe(-9);
    expect(f("2^3^2", 0)).toBe(512);
    expect(f("2x + 3(x+1)", 2)).toBe(13);
    expect(f("2sin(x)", 0)).toBe(0);
    expect(f("a*x - b", 2, { a: 3, b: 1 })).toBe(5);
    expect(f("x**2", 4)).toBe(16);
    expect(f("min(x, 1) + max(x, 1)", 5)).toBe(6);
    expect(f("pi", 0)).toBe(Math.PI);
  });
  test("decimals are exact rationals", () => {
    const e = compileExact(parse("0.1 + 0.2"));
    expect(e(R(0), {}).equals(R(3, 10))).toBe(true);
    expect(compileExact(parse("1.5e-3"))(R(0), {}).equals(R(3, 2000))).toBe(true);
  });
  test("rational-only detection and exact evaluation", () => {
    expect(isRationalOnly(parse("x^2/3 - 1/x"))).toBe(true);
    expect(isRationalOnly(parse("sin(x)"))).toBe(false);
    expect(isRationalOnly(parse("x^(1/2)"))).toBe(false);
    const e = compileExact(parse("1/(x - 1/3)"));
    expect(e(R(1, 3), {})).toBe(null);
    expect(e(R(1), {}).equals(R(3, 2))).toBe(true);
    expect(compileExact(parse("x^0"))(R(0), {})).toBe(null); // 0^0 is undefined in RatMath
  });
  test("free variables", () => {
    expect([...freeVariables(parse("a*sin(b*x) + c"))].sort()).toEqual(["a", "b", "c", "x"]);
  });
  test("errors", () => {
    expect(() => parse("2 +")).toThrow(SyntaxError);
    expect(() => parse("(x")).toThrow(SyntaxError);
    expect(() => parse("x $ 2")).toThrow(SyntaxError);
  });
});

describe("simplest rational between", () => {
  test("Stern–Brocot picks", () => {
    expect(simplestBetween(R(3, 10), R(4, 10)).equals(R(1, 3))).toBe(true);
    expect(simplestBetween(R(-7, 3), R(-2, 1)).equals(R(-2))).toBe(true);
    expect(simplestBetween(R(1414, 1000), R(1415, 1000)).equals(R(58, 41))).toBe(true);
    expect(simplestBetween(R(-1, 2), R(1, 3)).equals(R(0))).toBe(true);
  });
});

describe("zeros", () => {
  const show = (rs) => rs.map((r) => (r.kind === "exact" ? `exact ${r.at}` : `${r.kind} ${r.lo}..${r.hi}`));
  test("rational zeros are found exactly", () => {
    expect(show(findZeros("x^2 - 4", {}, [-3, 3]))).toEqual(["exact -2", "exact 2"]);
    expect(show(findZeros("(3x - 1)(x + 5/7)", {}, [-1, 1]))).toEqual(["exact -5/7", "exact 1/3"]);
    expect(show(findZeros("x^2", {}, [-1, 1]))).toEqual(["exact 0"]);
  });
  test("irrational zeros are bracketed with a certified sign change", () => {
    const rs = findZeros("x^2 - 2", {}, [0, 2], { tolerance: "1/1000000" });
    expect(rs.length).toBe(1);
    expect(rs[0].kind).toBe("sign-change");
    expect(rs[0].lo.toNumber()).toBeLessThanOrEqual(Math.SQRT2);
    expect(rs[0].hi.toNumber()).toBeGreaterThanOrEqual(Math.SQRT2);
    expect(rs[0].hi.subtract(rs[0].lo).toNumber()).toBeLessThanOrEqual(1e-6);
    const s = findZeros("sin(x)", {}, [1, 7], { tolerance: "1/1000" });
    expect(s.map((r) => r.kind)).toEqual(["sign-change", "sign-change"]);
    expect(s[0].lo.toNumber()).toBeLessThan(Math.PI);
    expect(s[0].hi.toNumber()).toBeGreaterThan(Math.PI);
  });
  test("poles are not zeros", () => {
    expect(findZeros("1/x", {}, [-1, 1]).map((r) => `${r.kind} ${r.at}`)).toEqual(["undefined 0"]);
    // Near the pole of tan at pi/2 the enclosure is unbounded, so the most
    // honest answer is "possible", never a certified zero.
    expect(findZeros("tan(x)", {}, [1, 2]).every((r) => r.kind === "possible")).toBe(true);
  });
  test("as a Refinement", () => {
    const z = zeros("x^2 - a", { a: 9 }, [-5, 5]);
    expect(z.quick.value.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-3, 3]);
    expect(show(z.exact())).toEqual(["exact -3", "exact 3"]);
  });
});

describe("viewport", () => {
  test("validates and sets precision from pixel size", () => {
    expect(() => viewport({ x: [1, 0], y: [0, 1], width: 10, height: 10 })).toThrow(RangeError);
    const vp = viewport({ x: ["-1/3", "1/3"], y: [0, 1], width: 300, height: 100 });
    expect(vp.dx.equals(R(1, 450))).toBe(true);
    expect(precisionFor(vp)).toBeGreaterThanOrEqual(20);
  });
});

describe("zeros near poles of rational functions", () => {
  test("the pole is reported as undefined, not as a zero", () => {
    const rs = findZeros("1/(x - 1/3) + x^2/8 - 2", {}, [-8, 8], { tolerance: "1/10000" });
    const kinds = rs.map((r) => r.kind);
    expect(kinds.filter((k) => k === "sign-change").length).toBe(3);
    const pole = rs.find((r) => r.kind === "undefined");
    expect(String(pole.at)).toBe("1/3");
  });
});
