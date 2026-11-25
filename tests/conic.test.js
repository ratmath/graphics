import { describe, expect, test } from "bun:test";
import { region, viewport, sceneSVG, sceneASCII, conicType, conicAtoms, parseCondition } from "../index.js";
import { atoms, evalFloat } from "../src/condition.js";
import { compileFloat } from "../src/expr.js";

const vp = viewport({ x: [-3, 3], y: [-3, 3], width: 240, height: 240 });
const exact = (cond, params = {}, view = vp) => region(cond, params, view).exact();

/** Is (x, y) inside any polygon of the fill? */
function inFill(f, x, y) {
  let inside = false;
  for (const p of f.fill) {
    let c = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      if ((p[i + 1] > y) !== (p[j + 1] > y) && x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c;
    }
    inside = inside || c;
  }
  return inside;
}

describe("regions bounded by conics", () => {
  test("a disc: one closed arc and the area of the circle", async () => {
    const r = region("x^2 + y^2 <= 4", {}, vp);
    expect(r.quick.value.kind).toBe("region-sketch");
    const f = r.exact();
    expect(f.kind).toBe("conics");
    expect(f.curves).toEqual([{ text: "x^2 + y^2 <= 4", type: "circle" }]);
    expect(f.arcs.length).toBe(1);
    expect(f.arcs[0]).toMatchObject({ role: "boundary", strict: false, closed: true });
    expect(Math.abs(f.area - 4 * Math.PI)).toBeLessThan(1e-6);
    expect(f.corners).toEqual([]);
    // every drawn point is on the circle
    const p = f.arcs[0].points;
    for (let k = 0; k < p.length; k += 2) expect(Math.abs(Math.hypot(p[k], p[k + 1]) - 2)).toBeLessThan(1e-9);
  });
  test("corners where two curves meet come in closed form", () => {
    const f = exact("x^2 + y^2 <= 4 and y >= x^2 - 1");
    expect(f.arcs.map((a) => a.text).sort()).toEqual(["x^2 + y^2 <= 4", "y >= x^2 - 1"]);
    expect(f.corners.map((c) => c.text)).toEqual(["(−√(2 + 2√13)/2, (−1 + √13)/2)", "(√(2 + 2√13)/2, (−1 + √13)/2)"]);
    for (const c of f.corners) {
      expect(c.included).toBe(true);
      expect(c.exact.x.polynomial).toEqual([-3n, 0n, -1n, 0n, 1n]);
      expect(Math.abs(c.x * c.x + c.y * c.y - 4)).toBeLessThan(1e-12);
      expect(c.tex).toContain("\\sqrt{13}");
    }
    const g = exact("x^2 + y^2 <= 4 and x >= 1");
    expect(g.corners.map((c) => c.text).sort()).toEqual(["(1, −√3)", "(1, √3)"]);
    expect(Math.abs(g.area - ((4 * Math.PI) / 3 - Math.sqrt(3)))).toBeLessThan(1e-6);
  });
  test("strict comparisons give dashed arcs and corners left out", () => {
    const f = exact("x^2 + y^2 < 4 and y > x");
    expect(f.arcs.every((a) => a.strict)).toBe(true);
    expect(f.corners.map((c) => [c.text, c.included])).toEqual([["(−√2, −√2)", false], ["(√2, √2)", false]]);
    const u = exact("x^2/4 + y^2 <= 1 or (x-1)^2 + y^2 < 1");
    expect(u.curves.map((c) => c.type)).toEqual(["ellipse", "circle"]);
    expect(u.arcs.filter((a) => a.strict).length).toBe(2);
    expect(u.corners.map((c) => c.text)).toEqual(["(2/3, 2√2/3)", "(2/3, −2√2/3)"]);
    // the curves touch at (2, 0), which the ellipse keeps in the region
    expect(u.points).toMatchObject([{ kind: "included", text: "(2, 0)", included: true }]);
  });
  test("hyperbolas, parabolas and rings", () => {
    const h = exact("x*y >= 1");
    expect(h.curves[0].type).toBe("hyperbola");
    expect(h.arcs.length).toBe(2);
    expect(Math.abs(h.area - 2 * (8 - Math.log(9)))).toBeLessThan(1e-6);
    const p = exact("y >= x^2 and y <= 2 - x^2");
    expect(p.corners.map((c) => c.text)).toEqual(["(−1, 1)", "(1, 1)"]);
    expect(Math.abs(p.area - 8 / 3)).toBeLessThan(1e-8);
    const ring = exact("1 <= x^2 + y^2 <= 4");
    expect(ring.arcs.length).toBe(2);
    expect(ring.arcs.every((a) => a.closed)).toBe(true);
    expect(Math.abs(ring.area - 3 * Math.PI)).toBeLessThan(1e-6);
  });
  test("single points, missing points and crossings", () => {
    const two = exact("x^2 + y^2 = 4 and y = x");
    expect(two.arcs).toEqual([]);
    expect(two.points.map((p) => [p.kind, p.text])).toEqual([["isolated", "(−√2, −√2)"], ["isolated", "(√2, √2)"]]);
    const hole = exact("x^2 + y^2 < 4 and (x != 0 or y != 0)");
    expect(hole.points).toMatchObject([{ kind: "puncture", text: "(0, 0)", included: false }]);
    const cross = exact("x^2 - y^2 = 0");
    expect(cross.curves[0].type).toBe("two lines");
    expect(cross.arcs.every((a) => a.role === "curve")).toBe(true);
    expect(cross.points).toMatchObject([{ kind: "node", text: "(0, 0)" }]);
    const cut = exact("x^2 + y^2 < 4 and not (y = 0 and x > 0)");
    expect(cut.arcs.filter((a) => a.role === "cut").length).toBe(1);
    expect(exact("x^2 + y^2 < -1").fill).toEqual([]);
  });
  test("agrees with the certified pixel classification", () => {
    const view = viewport({ x: [-5, 5], y: [-4, 4], width: 100, height: 80 });
    for (const cond of ["x^2 + y^2 < 9 and y > x^2 - 4", "x*y <= 2 and (x - 1)^2/9 + y^2/4 <= 1 or x^2 + y^2 < 1/2", "y^2 - x^2 >= 1 and x^2 + y^2 <= 10"]) {
      const f = region(cond, {}, view).exact();
      expect(f.kind).toBe("conics");
      const px = region(cond, {}, view, { method: "pixels" }).exact();
      const inside = new Uint8Array(view.width * view.height);
      for (let k = 0; k < px.inside.length; k += 4) {
        for (let i = px.inside[k]; i < px.inside[k] + px.inside[k + 2]; i++) for (let j = px.inside[k + 1]; j < px.inside[k + 1] + px.inside[k + 3]; j++) inside[j * view.width + i] = 1;
      }
      const onBoundary = (i, j) => {
        const s = px.boundary[i];
        for (let k = 0; k < s.length; k += 2) if (j >= s[k] && j <= s[k + 1]) return true;
        return false;
      };
      let checked = 0;
      for (let i = 0; i < view.width; i++) {
        for (let j = 0; j < view.height; j++) {
          if (onBoundary(i, j)) continue;
          expect(inFill(f, -5 + (i + 0.37) * 0.1, 4 - (j + 0.61) * 0.1)).toBe(inside[j * view.width + i] === 1);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(6000);
    }
  });
  test("the fill matches the condition at random points", () => {
    const cond = "(x^2 + y^2 <= 4 and y >= x^2 - 1) or (x - 1)^2 + (y + 1)^2 < 1";
    const f = exact(cond);
    const tree = parseCondition(cond);
    const list = atoms(tree);
    const fns = list.map((a) => compileFloat(a.F, "x"));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 6 - 3;
    for (let k = 0; k < 3000; k++) {
      const x = rnd();
      const y = rnd();
      const values = new Map(list.map((a, m) => [a, fns[m](x, { y })]));
      if ([...values.values()].some((v) => Math.abs(v) < 1e-3)) continue;
      expect(inFill(f, x, y)).toBe(evalFloat(tree, values));
    }
  });
  test("parameters, other degrees and the pixel method", () => {
    const f = exact("x^2 + y^2 <= r^2", { r: "3/2" });
    expect(Math.abs(f.area - 2.25 * Math.PI)).toBeLessThan(1e-6);
    expect(exact("y^2 <= x^3 - 2x + 1").kind).toBe("region");
    expect(region("x^2 + y^2 <= 4", {}, vp, { method: "pixels" }).exact().kind).toBe("region");
    expect(exact("x + y <= 1, x >= 0, y >= 0").kind).toBe("polygons");
    expect(conicAtoms(parseCondition("sin(x) < y"))).toBe(null);
    expect(conicAtoms(parseCondition("x^2 < y")).length).toBe(1);
  });
  test("names of conics", () => {
    const type = (s) => conicType(conicAtoms(parseCondition(`${s} = 0 and x^2 = y`))[0].poly);
    expect(type("x^2 + y^2 - 1")).toBe("circle");
    expect(type("x^2 + 2y^2 - 1")).toBe("ellipse");
    expect(type("x^2 - y")).toBe("parabola");
    expect(type("x*y - 1")).toBe("hyperbola");
    expect(type("x^2 - y^2")).toBe("two lines");
    expect(type("x^2 + y^2")).toBe("point");
    expect(type("x^2 + y^2 + 1")).toBe("empty");
    expect(type("x^2 - 1")).toBe("parallel lines");
    expect(type("x + y")).toBe("line");
  });
  test("draws in every back end", () => {
    const f = exact("x^2 + y^2 < 4 and y > x");
    const svg = sceneSVG(vp, [{ item: f, color: "#0f766e", cornerLabels: true }], { axes: true });
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("√2");
    expect(sceneASCII(vp, [f], { columns: 40 }).length).toBeGreaterThan(100);
  });
});
