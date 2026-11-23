import { describe, expect, test } from "bun:test";
import {
  surd, sqrt, point, line, segment, ray, polygon, circle, circumcircle, intersect, area, centroid,
  locate, convexHull, reflect, project, distance, bisector, orientation,
} from "../index.js";

describe("surds", () => {
  test("arithmetic stays in Q(√d)", () => {
    const x = surd("1/2").add(sqrt("9/8"));
    expect(x.toString()).toBe("1/2 + 3√2/4");
    expect(x.multiply(x.conjugate()).toString()).toBe("-7/8");
    expect(x.multiply(x.reciprocal()).toString()).toBe("1");
    expect(sqrt(2).multiply(sqrt(8)).toString()).toBe("4");
    expect(sqrt(12).toString()).toBe("2√3");
    expect(sqrt("1/3").toTeX()).toBe("\\frac{\\sqrt{3}}{3}");
  });
  test("exact signs and comparisons", () => {
    expect(sqrt(2).subtract(surd("1.4142")).sign()).toBe(1);
    expect(sqrt(2).subtract(surd("1.4143")).sign()).toBe(-1);
    expect(surd(3).subtract(sqrt(8)).sign()).toBe(1);
    const [lo, hi] = sqrt(2).bounds(40);
    expect(lo.lessThan(hi)).toBe(true);
    expect(lo.multiply(lo).lessThan(surd(2).a)).toBe(true);
    expect(hi.multiply(hi).greaterThan(surd(2).a)).toBe(true);
  });
  test("different fields throw", () => {
    expect(() => sqrt(2).add(sqrt(3))).toThrow(/algebraic/);
  });
});

describe("lines and circles", () => {
  const A = point(0, 0), B = point(4, 0), C = point(1, 3);
  test("equations", () => {
    expect(line(A, C).toString()).toBe("3x - y = 0");
    expect(line("2x - y = 3").toString()).toBe("2x - y = 3");
    expect(line({ a: 1, b: 1, c: 2 }).contains(point(2, 0))).toBe(true);
    expect(circle([1, -2], 2).toString()).toBe("(x - 1)^2 + (y + 2)^2 = 4");
  });
  test("line-line, segments and rays", () => {
    expect(intersect(segment(A, C), segment(B, point(0, 2))).map(String)).toEqual(["(4/7, 12/7)"]);
    expect(intersect(segment(A, point(1, 1)), segment(B, point(0, 2)))).toEqual([]);
    expect(intersect(ray(A, point(1, 1)), line("x + y = 4")).map(String)).toEqual(["(2, 2)"]);
    expect(intersect(ray(A, point(-1, -1)), line("x + y = 4"))).toEqual([]);
    expect(intersect(segment(A, B), segment(point(2, 0), point(6, 0))).map(String)).toEqual(["segment (2, 0)–(4, 0)"]);
    expect(intersect(line(A, B), line("y = 3"))).toEqual([]);
  });
  test("line-circle gives exact surd points", () => {
    const pts = intersect(line("y = x"), circle([0, 0], 2));
    expect(pts.map(String)).toEqual(["(√2, √2)", "(-√2, -√2)"]);
    for (const P of pts) expect(circle([0, 0], 2).contains(P)).toBe(true);
    expect(intersect(line("y = 3"), circle([0, 0], 3)).map(String)).toEqual(["(0, 3)"]); // tangent
  });
  test("circle-circle via the radical axis", () => {
    const pts = intersect(circle(A, 2), circle(B, 3));
    expect(pts.map(String)).toEqual(["(11/8, -3√15/8)", "(11/8, 3√15/8)"]);
    for (const P of pts) {
      expect(circle(A, 2).contains(P)).toBe(true);
      expect(circle(B, 3).contains(P)).toBe(true);
    }
    expect(intersect(circle(A, 1), circle(B, 1))).toEqual([]);
  });
  test("constructions", () => {
    expect(String(circumcircle(A, B, C))).toBe("(x - 2)^2 + (y - 1)^2 = 5");
    expect(String(reflect([0, 2], line("y = x")))).toBe("(2, 0)");
    expect(String(project([0, 2], line("y = x")))).toBe("(1, 1)");
    expect(String(distance(A, C))).toBe("√10");
    expect(bisector(A, B).toString()).toBe("x = 2");
    expect(orientation(A, B, C)).toBe(1);
  });
});

describe("polygons", () => {
  const T = polygon([[0, 0], [4, 0], [1, 3]]);
  test("area, centroid, point location", () => {
    expect(String(area(T))).toBe("6");
    expect(String(centroid(T))).toBe("(5/3, 1)");
    expect(locate(T, [1, 1])).toBe("inside");
    expect(locate(T, [2, 0])).toBe("boundary");
    expect(locate(T, [5, 1])).toBe("outside");
    expect(locate(T, ["1/2", "3/2"])).toBe("boundary");
  });
  test("convex hull", () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0]]).map(String)).toEqual(["(0, 0)", "(2, 0)", "(2, 2)", "(0, 2)"]);
  });
  test("polygon edges meet a line", () => {
    expect(intersect(T, line("y = 1")).map(String)).toEqual(["(3, 1)", "(1/3, 1)"]);
  });
});
