// The pictures phases: figures, charts, graph drawing, logic diagrams,
// dynamics, the section 13 pictures, polygons and solids. Each picture is
// checked against something computed another way.
import { describe, expect, test } from "bun:test";
import { Rational } from "@ratmath/core";
import {
  figure, figureSVG, figureTikZ, figureASCII, figurePDF, figurePNG, framesSVG, shapes, path, dot, text, image, toNumber,
  fiveNumbers, boxPlot, histogramFigure, densityFigure, qqPlot, scatterFit, lineChart, powerCurve, samplingBuildUp,
  amortisationChart, balanceChart, fanChart, yieldCurveFigure, payoffFigure,
  graphData, circleLayout, layeredLayout, treeLayout, springLayout, bipartiteLayout, tutteLayout, countCrossings, drawGraph, automatonFigure, kripkeFigure,
  treeLayoutOf, proofTreeFigure, truthTreeFigure, vennFigure,
  cobwebFigure, orbitFigure, returnMapFigure, bifurcationFigure, escapeFigure, pointCloudFigure, attractor3d, segmentsFigure, spacetimeFigure, lifeFigure, parameterFrames,
  zeroContour, phasePortrait, solutionFrames, frameAlongCurve, frameFrames, curvatureSurface, curveOnSurface,
  newtonFigure, interpolationFigure, quadratureFigure, stabilityRegion, convergenceFigure,
  polygonsFigure, solidFigure, stepsFigures,
} from "../index.js";

const shapesOf = (fig) => fig.layers.filter((l) => l.kind === "shapes").flatMap((l) => l.shapes);
const paths = (fig) => shapesOf(fig).filter((s) => s.path);
const allBackends = async (fig) => {
  expect(figureSVG(fig)).toContain("<svg");
  expect(figureTikZ(fig)).toContain("tikzpicture");
  expect(figureASCII(fig).length).toBeGreaterThan(0);
  expect(figurePDF(fig).length).toBeGreaterThan(100);
  expect((await figurePNG(fig, { width: 120, height: 90 })).length).toBeGreaterThan(100);
};

describe("figures", () => {
  test("text numbers, windows and statuses", () => {
    expect(toNumber("1/5")).toBe(0.2);
    expect(toNumber("6%")).toBe(0.06);
    expect(toNumber(new Rational(3n, 4n))).toBe(0.75);
    expect(toNumber({ low: 1, high: 2 })).toBe(1.5);
    const f = figure({ layers: [shapes([path([[0, 0], [2, 1]])])], margin: 0 });
    expect(f.x).toEqual([0, 2]);
    expect(f.y).toEqual([0, 1]);
    expect(() => figure({ layers: [], status: "guessed" })).toThrow();
  });
  test("shapes and image frames draw in every back end", async () => {
    const cells = [null, "#f00", "#f00", "#00f"];
    const f = figure({ layers: [image({ x: [0, 2], y: [0, 2], width: 2, height: 2, cells }), shapes([path([[0, 0], [2, 2]]), dot([1, 1]), text([1, 0.5], "x^2"), { arrow: [0, 2, 2, 0] }])], axes: true });
    await allBackends(f);
    const svg = figureSVG(f, { width: 100, height: 100 });
    // two red cells in one row merge into one rectangle; the blue one is separate
    expect((svg.match(/#f00/g) ?? []).length).toBe(1);
  });
  test("animated frames", () => {
    const fr = parameterFrames([1, 2, 3], (a) => figure({ layers: [shapes([path([[0, 0], [1, a]])])], x: [0, 1], y: [0, 3] }));
    expect(framesSVG(fr)).toContain("<animate");
  });
});

describe("charts for statistics", () => {
  test("Tukey's five numbers against the definition", () => {
    const s = fiveNumbers([7, 1, 3, 5, 9, 11, 2, 40]);
    // sorted 1 2 3 5 7 9 11 40: lower half 1 2 3 5, upper half 7 9 11 40
    expect([s.min, s.q1, s.median, s.q3, s.max]).toEqual([1, 2.5, 6, 10, 40]);
    expect(s.outliers).toEqual([40]); // above 10 + 1.5 · 7.5
    expect(s.whiskers).toEqual([1, 11]);
    const odd = fiveNumbers([1, 2, 3, 4, 5]);
    expect([odd.q1, odd.median, odd.q3]).toEqual([2, 3, 4]);
    expect(boxPlot({ a: [1, 2, 3], b: [4, 5, 6, 7] }).stats.map((x) => x.median)).toEqual([2, 5.5]);
  });
  test("histogram counts add to the data, and density bars have area 1", () => {
    const v = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 3);
    const h = histogramFigure(v, { bins: 9 });
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(200);
    const d = histogramFigure(v, { bins: 9, density: true });
    const bars = d.layers[0].item.bars;
    let area = 0;
    for (let i = 0; i < bars.length; i += 4) area += (bars[i + 1] - bars[i]) * bars[i + 3];
    expect(area).toBeCloseTo(1, 12);
  });
  const stdNormal = {
    kind: "certified",
    fast: { pdf: (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI), quantile: (p) => {
      let [lo, hi] = [-10, 10];
      for (let i = 0; i < 80; i++) {
        const m = (lo + hi) / 2;
        // the normal cdf by a series of erf, enough for a test
        const cdf = 0.5 * (1 + erf(m / Math.SQRT2));
        if (cdf < p) lo = m; else hi = m;
      }
      return (lo + hi) / 2;
    } },
    prob: (a, b) => ({ low: 0.6826894921, high: 0.6826894922 }),
  };
  test("a shaded density: the drawn area agrees with the stated probability", () => {
    const f = densityFigure(stdNormal, { shade: [-1, 1], range: [-4, 4] });
    const poly = paths(f)[0].path;
    let a = 0;
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      a += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
    }
    expect(Math.abs(a / 2)).toBeCloseTo(0.6827, 3);
    expect(f.notes[0]).toContain("0.6826894921");
  });
  test("quantile plot of normal-looking data lies near its line", () => {
    const v = Array.from({ length: 99 }, (_, i) => stdNormal.fast.quantile((i + 0.5) / 99) * 2 + 5);
    const f = qqPlot(v, stdNormal);
    expect(Math.abs(f.line.slope - 2)).toBeLessThan(0.05);
    expect(Math.abs(f.line.intercept - 5)).toBeLessThan(0.02);
  });
  test("fitted line, power curves and the build-up of a sampling distribution", () => {
    const f = scatterFit([[0, 1], [1, 3], [2, 5]], { fit: { coefficients: [1, 2] }, band: (x) => [2 * x, 2 * x + 2] });
    expect(f.line).toEqual({ intercept: 1, slope: 2 });
    expect(f.status).toBe("estimated");
    const p = powerCurve([[0, 0.05], [1, 0.3], [2, 0.8]]);
    expect(p.y).toEqual([-0.04, 1.04]);
    const v = Array.from({ length: 500 }, (_, i) => ((i * 37) % 101) / 100);
    const b = samplingBuildUp(v, { bins: 10, steps: [10, 100, 500] });
    expect(b.frames.length).toBe(3);
    expect(b.frames.every((f) => f.status === "simulated" && f.y[1] === b.frames[0].y[1])).toBe(true);
  });
});

describe("charts for finance", () => {
  const schedule = [
    { period: 1, interest: "10", principal: "90", balance: "910" },
    { period: 2, interest: "9.10", principal: "90.90", balance: "819.10" },
  ];
  test("amortisation bars stack interest under principal, to the payment", () => {
    const f = amortisationChart({ principal: 1000, schedule });
    const [I, P] = [f.layers[0].item.bars, f.layers[1].item.bars];
    expect(I[3]).toBe(10);
    expect(P[2]).toBe(10);
    expect(P[3]).toBe(100);
    expect(P[7]).toBeCloseTo(100, 12);
    expect(balanceChart({ principal: 1000, schedule }).layers[0].shapes[0].path.slice(0, 4)).toEqual([0, 1000, 1, 910]);
  });
  test("fan chart bands and the median", () => {
    const bands = [0, 1, 2].map((k) => ({ period: k, 5: 100 - 5 * k, 25: 100, 50: 100 + k, 75: 102 + k, 95: 105 + 5 * k }));
    const f = fanChart({ bands });
    expect(f.status).toBe("simulated");
    const ps = f.layers[0].shapes;
    expect(ps.filter((p) => p.closed && p.fill).length).toBe(2);
    expect(ps.find((p) => !p.closed).path).toEqual([0, 100, 1, 101, 2, 102]);
  });
  test("yield curve from a curve object", () => {
    const curve = { periods: 3, frequency: 2, spot: (k) => ["0.02", "0.025", "0.03"][k - 1] };
    const f = yieldCurveFigure(curve);
    expect(f.layers[0].shapes[0].path).toEqual([0.5, 2, 1, 2.5, 1.5, 3]);
  });
  test("payoff lines pass exactly through the kinks", () => {
    // a bull call spread: long the 100 call, short the 110 call, for a net 4
    const payoff = (s) => {
      const S = Number(s);
      return Math.max(0, S - 100) - Math.max(0, S - 110);
    };
    const f = payoffFigure({ payoff, profit: (s) => payoff(s) - 4, kinks: [100, 110], breakEvens: [104] }, { range: [80, 130] });
    const pay = paths(f)[1].path;
    expect(pay).toEqual([80, 0, 100, 0, 110, 10, 130, 10]);
    expect(f.status).toBe("exact");
  });
});

describe("graph drawing", () => {
  const cube = { vertices: [0, 1, 2, 3, 4, 5, 6, 7], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] };
  test("graphs, automata and Kripke models read alike", () => {
    const fake = { directed: true, weighted: true, vertices: () => ["a", "b"], edges: () => [{ from: "a", to: "b", weight: 3 }] };
    expect(graphData(fake).edges[0]).toEqual({ from: "a", to: "b", weight: 3, label: "3" });
    const auto = { states: ["p", "q"], start: "p", accept: new Set(["q"]), delta: new Map([["p", new Map([["a", new Set(["q"])], ["b", new Set(["q"])]])], ["q", new Map([["", new Set(["q"])]])]]) };
    const G = graphData(auto);
    expect(G.edges).toEqual([{ from: "p", to: "q", label: "a,b" }, { from: "q", to: "q", label: "ε" }]);
    const k = { worlds: ["w1", "w2"], R: new Map([["w1", new Set(["w2"])], ["w2", new Set()]]), valuation: { p: new Set(["w2"]) } };
    expect(graphData(k).edges).toEqual([{ from: "w1", to: "w2" }]);
    expect(automatonFigure(auto).layers[0].shapes.length).toBeGreaterThan(5);
    expect(shapesOf(kripkeFigure(k)).some((s) => s.tex === "p")).toBe(true);
  });
  test("Tutte's drawing of the cube is exact and plane, each inner vertex the average of its neighbours", () => {
    const t = tutteLayout(cube, { outer: [0, 1, 2, 3] });
    expect(t.planarDrawing).toBe(true);
    const G = graphData(cube);
    for (const v of ["4", "5", "6", "7"]) {
      const nb = G.edges.filter((e) => e.from === v || e.to === v).map((e) => (e.from === v ? e.to : e.from));
      for (const c of [0, 1]) {
        const avg = nb.reduce((s, w) => s.add(t.exact.get(w)[c]), new Rational(0n)).divide(new Rational(BigInt(nb.length)));
        expect(avg.equals(t.exact.get(v)[c])).toBe(true);
      }
    }
    // the outer corners are on the unit circle exactly
    for (const v of t.outer) {
      const [x, y] = t.exact.get(v);
      expect(x.multiply(x).add(y.multiply(y)).equals(new Rational(1n))).toBe(true);
    }
    expect(countCrossings(cube, t.positions)).toEqual([]);
  });
  test("wheels and grids draw without crossings; K5 and K3,3 cannot", () => {
    for (let n = 4; n <= 9; n++) {
      const wheel = { edges: [...Array.from({ length: n }, (_, i) => [i, (i + 1) % n]), ...Array.from({ length: n }, (_, i) => ["hub", i])] };
      expect(tutteLayout(wheel, { outer: Array.from({ length: n }, (_, i) => i) }).planarDrawing).toBe(true);
    }
    const grid = { edges: [] };
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (i < 3) grid.edges.push([`${i},${j}`, `${i + 1},${j}`]);
      if (j < 3) grid.edges.push([`${i},${j}`, `${i},${j + 1}`]);
    }
    const outer = ["0,0", "1,0", "2,0", "3,0", "3,1", "3,2", "3,3", "2,3", "1,3", "0,3", "0,2", "0,1"];
    expect(tutteLayout(grid, { outer }).planarDrawing).toBe(true);
    const K5 = { edges: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]] };
    expect(tutteLayout(K5, { outer: [0, 1, 2] }).planarDrawing).toBe(false);
    const K33 = { edges: [["a", 1], ["a", 2], ["a", 3], ["b", 1], ["b", 2], ["b", 3], ["c", 1], ["c", 2], ["c", 3]] };
    expect(tutteLayout(K33, { outer: ["a", 1, "b", 2] }).planarDrawing).toBe(false);
  });
  test("tree and layered layouts: parents centred, layers by distance", () => {
    const tree = { edges: [["r", "a"], ["r", "b"], ["a", "c"], ["a", "d"], ["b", "e"]] };
    const P = treeLayout(tree, { root: "r" });
    expect(P.get("a")[0]).toBe((P.get("c")[0] + P.get("d")[0]) / 2);
    expect(P.get("r")[0]).toBe((P.get("a")[0] + P.get("b")[0]) / 2);
    expect(P.get("c")[1]).toBe(-2);
    const L = layeredLayout(cube, { roots: [0] });
    // in the cube graph, distance from 0: 1, 3, 4 at 1; 2, 5, 7 at 2; 6 at 3
    expect(["1", "3", "4"].map((v) => L.get(v)[1])).toEqual([-1, -1, -1]);
    expect(L.get("6")[1]).toBe(-3);
    expect(bipartiteLayout(cube, { left: [0, 2, 5, 7] }).get("0")[0]).toBe(0);
  });
  test("spring layout is reproducible and marked estimated; colourings and highlights", () => {
    const a = springLayout(cube);
    const b = springLayout(cube);
    expect([...a.values()]).toEqual([...b.values()]);
    const f = drawGraph(cube, { layout: "spring", colours: { 0: 0, 2: 0, 5: 0, 7: 0, 1: 1, 3: 1, 4: 1, 6: 1 }, highlight: { edges: [[0, 1]] } });
    expect(f.status).toBe("estimated");
    expect(paths(f).filter((p) => p.width === 3.2).length).toBe(1);
    expect(circleLayout(cube).get("0")).toEqual([0, 1]);
  });
});

describe("logic diagrams", () => {
  const leaf = (s) => ({ sequent: s, rule: "Ax", premises: [] });
  const deriv = { sequent: "p ∧ q ⊢ q ∧ p", rule: "∧L", premises: [{ sequent: "p, q ⊢ q ∧ p", rule: "∧R", premises: [leaf("p, q ⊢ q"), leaf("p, q ⊢ p")] }] };
  test("a proof tree: one bar per inference, premises above their conclusion", () => {
    const f = proofTreeFigure(deriv);
    expect(f.inferences).toBe(4);
    const labels = shapesOf(f).filter((s) => s.text);
    const y = (t) => labels.find((s) => s.tex === t).text[1];
    expect(y("p, q ⊢ q")).toBeGreaterThan(y("p, q ⊢ q ∧ p"));
    expect(y("p, q ⊢ q ∧ p")).toBeGreaterThan(y("p ∧ q ⊢ q ∧ p"));
    expect(paths(f).length).toBe(4);
  });
  test("tidy tree layout keeps subtrees apart", () => {
    const items = treeLayoutOf({ w: 4, c: [{ w: 10, c: [] }, { w: 2, c: [{ w: 6, c: [] }] }] }, { width: (n) => n.w, children: (n) => n.c, gap: 3 });
    const kids = items.filter((i) => i.depth === 1);
    expect(kids[1].span[0] - kids[0].span[1]).toBe(3);
    expect(items[0].x).toBe((kids[0].span[0] + kids[1].span[1]) / 2);
  });
  test("a truth tree: blocks, branches and closures", () => {
    const line = (n, formula, rule, from) => ({ n, formula, rule, from });
    const root = { lines: [line(1, "p → q", "premise"), line(2, "p", "premise"), line(3, "¬q", "premise")], children: [{ lines: [line(4, "¬p", "→", 1)], children: [], closed: [2, 4] }, { lines: [line(5, "q", "→", 1)], children: [], closed: [3, 5] }] };
    const f = truthTreeFigure({ root });
    expect(f.branches).toBe(2);
    expect(shapesOf(f).filter((s) => s.label?.startsWith("✗")).length).toBe(2);
  });
  test("Venn regions and their pixels", () => {
    const f = vennFigure(["A", "B"], { shade: (m) => m.A && !m.B });
    expect(f.regions).toEqual(["10"]);
    const img = f.layers[0];
    // the pixel at the centre of A only (x = −1.1, y = 0) is shaded, the middle (in both) is not
    const at = (x, y) => img.cells[Math.floor(((y - img.y[0]) / (img.y[1] - img.y[0])) * img.height) * img.width + Math.floor(((x - img.x[0]) / (img.x[1] - img.x[0])) * img.width)];
    expect(at(-1.1, 0)).not.toBeNull();
    expect(at(0, 0)).toBeNull();
    expect(at(1.1, 0)).toBeNull();
    expect(vennFigure(["A", "B", "C"], { shade: ["111"] }).regions).toEqual(["111"]);
  });
});

describe("dynamics", () => {
  test("cobweb follows the orbit", () => {
    const f = (x) => 3.5 * x * (1 - x);
    const c = cobwebFigure(f, "1/5", 10);
    let x = 0.2;
    for (let i = 0; i < 10; i++) x = f(x);
    expect(c.orbit[10]).toBe(x);
    const stair = paths(c)[2].path;
    expect(stair.slice(2, 4)).toEqual([0.2, f(0.2)]);
    expect(cobwebFigure({ float: f }, 0.3, 3).orbit.length).toBe(4);
    expect(orbitFigure([1, 2, 3]).orbit).toEqual([1, 2, 3]);
    expect(shapesOf(returnMapFigure([1, 2, 3, 4], { lag: 2 })).map((s) => s.dot)).toEqual([[1, 3], [2, 4]]);
  });
  test("bifurcation dots, one per long-run value", () => {
    const f = bifurcationFigure([{ parameter: 3, points: [0.66] }, { parameter: 3.2, points: [0.51, 0.8] }], { marks: [{ at: 3, label: "r = 3" }] });
    expect(shapesOf(f).filter((s) => s.dot).length).toBe(3);
  });
  test("escape pictures keep undecided pixels apart", () => {
    const grid = { width: 3, height: 2, kind: Uint8Array.from([1, 2, 0, 2, 1, 2]), escape: Uint32Array.from([0, 3, 0, 9, 0, 1]), re: new Rational(-2n), reHigh: new Rational(1n), im: new Rational(-1n), imHigh: new Rational(1n), counts: { inside: 2, outside: 3, undecided: 1 } };
    const f = escapeFigure(grid);
    const cells = f.layers[0].cells;
    expect(cells.filter((c) => c === "#111827").length).toBe(2);
    expect(cells.filter((c) => c === "#f97316").length).toBe(1);
    expect(f.status).toBe("certified");
    const basins = escapeFigure({ ...grid, labels: true, kind: Uint8Array.from([1, 2, 3, 1, 2, 3]) });
    expect(new Set(basins.layers[0].cells).size).toBe(3);
  });
  test("automata, Life, point clouds and segments", () => {
    const rows = [[0, 1, 0], [1, 1, 1]];
    const s = spacetimeFigure(rows);
    expect(s.layers[0].cells.filter(Boolean).length).toBe(4);
    // time goes down: the first row is the top row of the image
    expect(s.layers[0].cells.slice(3)).toEqual([null, "#111827", null]);
    expect(lifeFigure({ cells: new Set(["0,0", "1,0", "2,0"]) }).population).toBe(3);
    expect(pointCloudFigure([0, 0, 1, 1]).count).toBe(2);
    expect(segmentsFigure({ segments: [[0, 0, 1, 0]], exact: [[]] }).status).toBe("exact");
    expect(attractor3d([[0, 0, 0], [1, 1, 1]]).layers[0].kind).toBe("mesh");
  });
});

describe("section 13 pictures", () => {
  test("phase portrait of a double well: three equilibria, proved, with their kinds", () => {
    const f = phasePortrait(["y", "x - x^3 - y/4"], { x: [-2, 2], y: [-1.5, 1.5], orbits: [[0.1, 0]] });
    expect(f.equilibria.length).toBe(3);
    expect(f.equilibria.complete).toBe(true);
    expect(f.equilibria.map((e) => e.kind)).toEqual(["stable spiral", "saddle", "stable spiral"]);
  });
  test("zero contour of the unit circle lies on it", () => {
    const segs = zeroContour((x, y) => x * x + y * y - 1, [-2, 2], [-2, 2], 60);
    expect(segs.length).toBeGreaterThan(40);
    for (const s of segs) for (const k of [0, 2]) expect(Math.abs(Math.hypot(s[k], s[k + 1]) - 1)).toBeLessThan(0.02);
  });
  test("heat-equation frames share a window", () => {
    const fr = solutionFrames("exp(-t)*sin(pi*x)", [0, 0.5, 1]);
    expect(fr.frames.every((f) => f.y[1] === fr.frames[0].y[1])).toBe(true);
  });
  test("the moving frame on a circle of radius 2: unit tangent, perpendicular normal, curvature 1/2", () => {
    const f = frameAlongCurve(["2*cos(t)", "2*sin(t)"], "1/2", { range: [0, 6.3] });
    const T = f.frame.tangent.map(toNumber);
    const N = f.frame.normal.map(toNumber);
    expect(Math.hypot(...T)).toBeCloseTo(1, 10);
    expect(T[0] * N[0] + T[1] * N[1]).toBeCloseTo(0, 10);
    expect(toNumber(f.frame.curvature)).toBeCloseTo(0.5, 10);
    expect(f.frame.centre.map(toNumber)[0]).toBeCloseTo(0, 9);
    expect(frameFrames(["cos(t)", "sin(t)"], ["0", "1"], { range: [0, 6.3] }).frames.length).toBe(2);
  });
  test("curvature colours: a sphere is positive everywhere, a torus changes sign", () => {
    const sphere = curvatureSurface(["2*cos(u)*sin(v)", "2*sin(u)*sin(v)", "2*cos(v)"], { u: [0, 6.28], v: [0.2, 2.9], grid: 10 });
    expect(sphere.range[0]).toBeCloseTo(0.25, 6);
    expect(sphere.range[1]).toBeCloseTo(0.25, 6);
    const torus = curvatureSurface(["(2+cos(v))*cos(u)", "(2+cos(v))*sin(u)", "sin(v)"], { u: [0, 6.28], v: [0, 6.28], grid: 12 });
    expect(torus.range[0]).toBeLessThan(0);
    expect(torus.range[1]).toBeGreaterThan(0);
    expect(curveOnSurface(["u", "v", "u*v"], [[1, 2]]).points).toEqual(Float64Array.from([1, 2, 2]));
  });
  test("Newton's tangents converge to √2; interpolation passes through its nodes", () => {
    const f = newtonFigure("x^2 - 2", 2, 5, { derivative: "2*x" });
    expect(f.iterates[5]).toBeCloseTo(Math.SQRT2, 14);
    const eq = interpolationFigure("1/(1+25*x^2)", 11);
    const ch = interpolationFigure("1/(1+25*x^2)", 11, { nodes: "chebyshev" });
    expect(ch.maxError).toBeLessThan(eq.maxError / 5); // Runge's phenomenon, and its cure
    expect(eq.maxError).toBeGreaterThan(1.5);
  });
  test("quadrature values: the trapezoid sum, and Simpson exact on cubics", () => {
    const t = quadratureFigure("x^2", [0, 1], 4);
    expect(t.value).toBeCloseTo((0 + 2 * (1 / 16 + 1 / 4 + 9 / 16) + 1) / 8, 14);
    const s = quadratureFigure("x^3 - x", [0, 2], 2, { rule: "simpson" });
    expect(s.value).toBeCloseTo(2, 14);
    expect(quadratureFigure("x", [0, 1], 2, { rule: "midpoint" }).value).toBeCloseTo(0.5, 14);
    expect(() => quadratureFigure("x", [0, 1], 3, { rule: "simpson" })).toThrow();
  });
  test("stability regions: Euler's is the unit disc about −1; observed order", () => {
    expect(stabilityRegion("euler", { resolution: 300 }).area).toBeCloseTo(Math.PI, 1);
    expect(stabilityRegion("rk4").area).toBeGreaterThan(stabilityRegion("euler").area);
    expect(convergenceFigure([[0.1, 1e-4], [0.05, 6.25e-6], [0.025, 3.90625e-7]]).order).toBeCloseTo(4, 10);
  });
});

describe("polygons, solids, constructions", () => {
  test("polygons coloured by sides; a cube's six faces", async () => {
    const tri = [[0, 0], [1, 0], [0.5, 0.8]];
    const sq = [[1, 0], [2, 0], [2, 1], [1, 1]];
    const f = polygonsFigure([tri, sq]);
    expect(paths(f).map((p) => p.fill)).toEqual(["#fde68a", "#93c5fd"]);
    const V = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const c = solidFigure(V, F);
    expect(c.layers[0].faces.filter((x) => x.closed).length).toBe(6);
    await allBackends(c);
  });
  test("construction frames build up", () => {
    const steps = [{ shapes: [dot([0, 0])], note: "A" }, { shapes: [dot([1, 0])], note: "B" }, { shapes: [path([[0, 0], [1, 0]])], note: "AB" }];
    const fr = stepsFigures(steps);
    expect(fr.frames.map((f) => shapesOf(f).length)).toEqual([1, 2, 3]);
    expect(fr.frames[2].notes).toEqual(["AB"]);
  });
  test("every kind of chart draws in every back end", async () => {
    await allBackends(lineChart([{ name: "a", points: [[0, 1], [1, 2]] }, { name: "b", points: [[0, 2], [1, 0]] }]));
    await allBackends(vennFigure(["A", "B"], { shade: ["11"], resolution: 40 }));
    await allBackends(drawGraph({ edges: [["a", "b"], ["b", "a"], ["b", "b"]], directed: true }, { layout: "circle" }));
  });
});

function erf(x) {
  // Abramowitz and Stegun 7.1.26 is too coarse; use the series, fine for |x| < 6
  let sum = 0;
  let term = x;
  for (let n = 0; n < 200; n++) {
    sum += term / (2 * n + 1);
    term *= (-x * x) / (n + 1);
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}
