import { describe, expect, test } from "bun:test";
import { region, implicit, parseCondition, viewport, dnf, linearForm, sceneSVG, texToText, point, circle, label } from "../index.js";
import { compileFloat } from "../src/expr.js";
import { atoms, evalFloat } from "../src/condition.js";

const vp = viewport({ x: [-5, 5], y: [-4, 4], width: 100, height: 80 });

function inSpans(spans, row) {
  for (let j = 0; j < spans.length; j += 2) if (spans[j] <= row && row <= spans[j + 1]) return true;
  return false;
}

describe("conditions", () => {
  test("chains, and/or/not, commas, groups", () => {
    const t = parseCondition("0 <= x <= 3 and (y > 1 or not y >= -1)");
    expect(t.op).toBe("and");
    expect(atoms(t).map((a) => a.rel)).toEqual(["<=", "<=", "<", "<="]);
    expect(dnf(parseCondition("(x < 0 or x > 1), y < 2")).length).toBe(2);
    expect(parseCondition("x^2 + y^2 = 4").rel).toBe("=");
    expect(parseCondition("x ≤ 2 ∧ y ≥ 0").op).toBe("and");
    expect(() => parseCondition("x < ")).toThrow();
  });
  test("linear forms", () => {
    const f = linearForm("2(x - y)/3 + a", { a: "1/2" });
    expect([f.a, f.b, f.c].map(String)).toEqual(["2/3", "-2/3", "1/2"]);
    expect(linearForm("x*y")).toBe(null);
    expect(linearForm("sin(x)")).toBe(null);
  });
});

describe("regions bounded by lines are exact polygons", () => {
  test("a triangle with a strict side", () => {
    const r = region("x + y <= 4, x >= 0, y > 0", {}, vp).exact();
    expect(r.kind).toBe("polygons");
    expect(r.pieces.length).toBe(1);
    expect(String(r.pieces[0].area)).toBe("8");
    const sides = r.boundary.map((b) => `${b.from}->${b.to}:${b.strict ? "dashed" : "solid"}`).sort();
    expect(sides).toEqual(["(0, 0)->(4, 0):dashed", "(0, 4)->(0, 0):solid", "(4, 0)->(0, 4):solid"]);
    const corners = Object.fromEntries(r.corners.map((c) => [String(c.point), c.included]));
    expect(corners).toEqual({ "(4, 0)": false, "(0, 4)": true, "(0, 0)": false });
  });
  test("rational corners stay exact", () => {
    const r = region("3x + 7y <= 5, x - 2y >= -1, y >= -1/3", {}, vp).exact();
    expect(r.corners.map((c) => String(c.point)).sort()).toEqual(["(22/9, -1/3)", "(3/13, 8/13)", "(-5/3, -1/3)"].sort());
  });
  test("unions keep only the outer boundary", () => {
    const r = region("x <= 1 or y <= 1", {}, vp).exact();
    expect(r.pieces.length).toBe(2);
    expect(r.boundary.map((b) => `${b.from}->${b.to}`).sort()).toEqual(["(1, 1)->(1, 4)", "(5, 1)->(1, 1)"]);
    expect(r.corners.map((c) => `${c.point} ${c.included}`)).toEqual(["(1, 1) true"]);
    expect(region("y < 1 or y >= 1", {}, vp).exact().boundary).toEqual([]);
  });
  test("an equation inside a region is a segment", () => {
    const r = region("x - y = 1 and x >= 0", {}, vp).exact();
    expect(String(r.lines[0].segment)).toBe("segment (0, -1)–(5, 4)");
  });
});

describe("certified regions and curves", () => {
  test("pixels marked inside satisfy the condition; unmarked pixels do not", () => {
    const cond = "x^2 + y^2 < 9 and y > x^2 - 4";
    const r = region(cond, {}, vp, { method: "pixels" }).exact();
    expect(r.kind).toBe("region");
    const tree = parseCondition(cond);
    const list = atoms(tree);
    const fns = list.map((a) => compileFloat(a.F, "x"));
    const inside = new Uint8Array(vp.width * vp.height);
    for (let k = 0; k < r.inside.length; k += 4) {
      for (let i = r.inside[k]; i < r.inside[k] + r.inside[k + 2]; i++) for (let j = r.inside[k + 1]; j < r.inside[k + 1] + r.inside[k + 3]; j++) inside[j * vp.width + i] = 1;
    }
    let checked = 0;
    for (let i = 0; i < vp.width; i++) {
      for (let j = 0; j < vp.height; j++) {
        const isIn = inside[j * vp.width + i] === 1;
        const isB = inSpans(r.boundary[i], j);
        expect(isIn && isB).toBe(false);
        if (isB) continue;
        for (const [u, w] of [[0.3, 0.3], [0.7, 0.6], [0.5, 0.9]]) {
          const x = -5 + (i + u) * 0.1;
          const y = 4 - (j + w) * 0.1;
          const values = new Map(list.map((a, k) => [a, fns[k](x, { y })]));
          expect(evalFloat(tree, values)).toBe(isIn);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20000);
  });
  test("an implicit circle lies in its cells, and most cells are proven", () => {
    const c = implicit("x^2 + y^2 = 9", {}, vp).exact();
    for (let k = 0; k < 2000; k++) {
      const t = (2 * Math.PI * k) / 2000;
      const i = Math.floor((3 * Math.cos(t) + 5) / 0.1);
      const j = Math.floor((4 - 3 * Math.sin(t)) / 0.1);
      if (i < 0 || i >= 100 || j < 0 || j >= 80) continue;
      // points on a pixel edge belong to both neighbours; allow either
      const ok = inSpans(c.columns[i], j) || inSpans(c.columns[i - 1] ?? [], j) || inSpans(c.columns[i], j - 1) || inSpans(c.columns[i - 1] ?? [], j - 1);
      expect(ok).toBe(true);
    }
    const cells = c.columns.reduce((s, col) => { for (let k = 0; k < col.length; k += 2) s += col[k + 1] - col[k] + 1; return s; }, 0);
    expect(c.sure.count).toBeGreaterThan(cells * 0.6);
  });
  test("domain edges: sqrt is undefined left of 0", () => {
    const r = region("y < sqrt(x)", {}, vp).exact();
    // column 10 is x in [-4, -3.9]: nothing there is in the region
    expect(r.boundary[10]).toEqual([]);
    for (let k = 0; k < r.inside.length; k += 4) expect(r.inside[k]).toBeGreaterThanOrEqual(49);
  });
  test("quick sketches exist", () => {
    expect(region("x^2 + y^2 < 4", {}, vp).quick.value.fill.length).toBeGreaterThan(0);
    expect(implicit("x^2 + y^2 = 4", {}, vp).quick.value.points.length).toBeGreaterThan(0);
  });
});

describe("scenes", () => {
  test("SVG with axes, geometry, regions and labels", () => {
    const svg = sceneSVG(vp, [region("x + y <= 2, y > 0, x >= 0", {}, vp).exact(), circle([0, 0], 2), { item: point(1, 1), label: true }, label([0, 3], "\\frac{1}{2}")], { axes: true, tex: (s) => `<span class="k">${s}</span>` });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("foreignObject");
    expect(svg).toContain("\\left(1,\\ 1\\right)");
  });
  test("plain-text TeX fallback", () => {
    expect(texToText("\\frac{x^2}{9}+\\frac{y^2}{4}<1")).toBe("x²/9+y²/4<1");
    expect(texToText("\\left(\\frac{1}{2},\\ 1 + \\sqrt{3}\\right) \\le \\pi")).toBe("(1/2, 1 + √3) ≤ π");
  });
});
