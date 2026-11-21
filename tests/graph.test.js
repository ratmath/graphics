import { describe, expect, test } from "bun:test";
import { Rational } from "@ratmath/core";
import { certifyGraph, graph, sampleFloat, viewport, live, parse, toSVG } from "../index.js";
import * as I from "../src/interval.js";
import { compileInterval, paramsToIntervals, paramsToRational } from "../src/expr.js";
import { columnRationals, rowSpan } from "../src/viewport.js";

function runCertified(f, params, vp, opts) {
  const gen = certifyGraph(f, params, vp, opts);
  let s;
  let ticks = 0;
  while (!(s = gen.next()).done) ticks++;
  return { frame: s.value.value, via: s.value.via, ticks };
}

function inSpans(spans, row) {
  for (let j = 0; j < spans.length; j += 2) if (spans[j] <= row && row <= spans[j + 1]) return true;
  return false;
}

/**
 * Soundness check: at several rational points inside every column, enclose
 * f(x) at high precision and check its pixel row is one the certified frame
 * listed.
 */
function checkSound(f, params, vp, frame, pointsPerColumn = 5) {
  const ast = parse(f);
  const enclose = compileInterval(ast);
  const ref = I.context(200);
  const P = paramsToIntervals(ref, paramsToRational(params));
  let checked = 0;
  for (let i = 0; i < vp.width; i++) {
    const [a, b] = columnRationals(vp, i);
    for (let k = 0; k <= pointsPerColumn; k++) {
      const x = a.add(b.subtract(a).multiply(new Rational(k, pointsPerColumn)));
      const y = enclose(ref, I.fromRational(ref, x.numerator, x.denominator), P);
      const rows = rowSpan(ref, vp, y);
      if (!rows || !I.isFinite(y.lo) || !I.isFinite(y.hi)) continue;
      // The true value's row is one of rows[0]..rows[1] (usually one row).
      let any = false;
      for (let r = rows[0]; r <= rows[1]; r++) any ||= inSpans(frame.columns[i], r);
      if (!any) throw new Error(`${f}: column ${i}, x=${x}, rows ${rows} not in ${frame.columns[i]}`);
      checked++;
    }
  }
  return checked;
}

const vp = viewport({ x: [-6, 6], y: [-4, 4], width: 240, height: 160 });

describe("certified graphs are sound", () => {
  const cases = [
    ["x^2/4 - 2", {}],
    ["a*x^3 - x", { a: "1/8" }],
    ["a*sin(b*x) + c", { a: "5/2", b: "3/2", c: "-1/3" }],
    ["exp(x/2) - 3", {}],
    ["ln(x) + 1", {}],
    ["sqrt(9 - x^2)", {}],
    ["1/(x - 1/3)", {}],
    ["tan(x)", {}],
    ["abs(x) - 2", {}],
    ["x^(1/2) * cos(3x)", {}],
  ];
  for (const [f, p] of cases) {
    test(f, () => {
      const { frame, via, ticks } = runCertified(f, p, vp);
      expect(via).toBe("interval-columns");
      expect(ticks).toBe(vp.width);
      expect(frame.complete).toBe(true);
      expect(checkSound(f, p, vp, frame)).toBeGreaterThan(50);
    });
  }
});

describe("certified graphs are tight", () => {
  test("a gentle curve uses at most two rows per column away from steep parts", () => {
    const { frame } = runCertified("x^2/10", {}, vp);
    expect(frame.tight).toBe(true);
    let wide = 0;
    frame.columns.forEach((s) => {
      for (let j = 0; j < s.length; j += 2) if (s[j + 1] - s[j] > 3) wide++;
    });
    expect(wide).toBeLessThan(vp.width / 10);
  });

  test("off-screen and undefined parts list no cells", () => {
    const { frame } = runCertified("sqrt(x)", {}, vp);
    for (let i = 0; i < vp.width / 2 - 1; i++) expect(frame.columns[i]).toEqual([]);
    const above = runCertified("x^2 + 100", {}, vp).frame;
    expect(above.columns.every((s) => s.length === 0)).toBe(true);
  });

  test("a pole fills its own column and nothing far from it", () => {
    // Column boundaries are multiples of 1/20; the pole at 1/3 is inside a column.
    const { frame } = runCertified("1/(x - 1/3)", {}, vp);
    const poleColumn = Math.floor((1 / 3 + 6) * 20);
    expect(frame.columns[poleColumn]).toEqual([0, vp.height - 1]);
    expect(frame.columns[poleColumn - 3].length).toBeLessThanOrEqual(4);
  });
});

describe("float preview", () => {
  test("is a polyline with breaks at poles and gaps", () => {
    const { points } = sampleFloat("1/x", {}, vp);
    let breaks = 0;
    for (let i = 0; i < points.length; i += 2) if (Number.isNaN(points[i])) breaks++;
    expect(breaks).toBeGreaterThanOrEqual(1);
    const s = sampleFloat("sqrt(x)", {}, vp);
    expect(s.points[0]).toBeGreaterThanOrEqual(vp.width / 2 - 1);
  });

  test("agrees with the certified cells", () => {
    const { points } = sampleFloat("sin(x)", {}, vp);
    const { frame } = runCertified("sin(x)", {}, vp);
    for (let i = 0; i < points.length; i += 2) {
      const col = Math.min(vp.width - 1, Math.floor(points[i]));
      const row = Math.floor(points[i + 1]);
      if (row < 0 || row >= vp.height) continue;
      const s = frame.columns[col];
      expect(s.some((_, j) => j % 2 === 0 && s[j] - 1 <= row && row <= s[j + 1] + 1)).toBe(true);
    }
  });
});

describe("graph() is a Refinement", () => {
  test("quick, then exact", () => {
    const g = graph("a*x", { a: "1/2" }, vp);
    expect(g.quick.stage).toBe("float");
    expect(g.quick.value.kind).toBe("polyline");
    expect(g.settled).toBe(false);
    const exact = g.exactStage();
    expect(exact.exact).toBe(true);
    expect(exact.via).toBe("interval-columns");
    expect(exact.value.kind).toBe("cells");
  });

  test("progress ticks carry partial frames", () => {
    const g = graph("x", {}, vp, { partialEvery: 40 });
    const partials = [...g.stages()].filter((s) => s.stage === "progress" && s.partial);
    expect(partials.length).toBe(Math.floor(vp.width / 40));
  });

  test("settle in slices and abort", async () => {
    const g = graph("sin(x)*x", {}, vp);
    const seen = [];
    const value = await g.settle({ sliceMs: 1, onStage: (s) => seen.push(s.stage) });
    expect(seen).toEqual(["float", "exact"]);
    expect(value.complete).toBe(true);
    const h = graph("cos(x)*x", {}, vp);
    const ac = new AbortController();
    const p = h.settle({ signal: ac.signal, sliceMs: 0 });
    ac.abort();
    await expect(p).rejects.toThrow("aborted");
  });

  test("live() only finishes the latest request", async () => {
    const stages = [];
    let done;
    const finished = new Promise((r) => (done = r));
    const update = live((a) => graph("a*x^2", { a }, vp), (s) => {
      stages.push(s.stage);
      if (s.exact) done(s);
    }, { idleMs: 5 });
    for (const a of ["1/4", "1/3", "1/2", "1"]) update(a);
    const last = await finished;
    expect(stages.filter((s) => s === "float").length).toBe(4);
    expect(stages.filter((s) => s === "exact").length).toBe(1);
    expect(last.value.complete).toBe(true);
  });
});

describe("rendering", () => {
  test("SVG for both stages", () => {
    const g = graph("x^2/4", {}, vp);
    expect(toSVG(g.quick.value, { width: vp.width, height: vp.height })).toContain("<path d=\"M");
    expect(toSVG(g.exact())).toContain("crispEdges");
  });
});
