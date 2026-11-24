import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  viewport, graph, region, implicit, circle, point, segment, label, sceneTikZ, tikzElements, simplifyPolyline,
  sceneASCII, asciiText, primitives, scenePGFPlots, scenePDF, pdfTextRuns, scenePNG, rasterize, encodePNG, polygon,
} from "../index.js";

const vp = viewport({ x: [-1, 5], y: [-1, 4], width: 360, height: 300 });
const triangle = region("x + y <= 4, x >= 0, y > 0", {}, vp).exact();

const balanced = (s) => {
  let depth = 0;
  for (const ch of s.replace(/\\[{}]/g, "")) {
    if (ch === "{") depth++;
    if (ch === "}" && --depth < 0) return false;
  }
  return depth === 0;
};

describe("TikZ export", () => {
  test("world coordinates, scaled to the requested width", () => {
    const tex = sceneTikZ(vp, [{ item: triangle, color: "#0f766e" }], { width: 6 });
    expect(tex).toContain("\\begin{tikzpicture}[x=1cm, y=1cm]");
    expect(tex.trim().endsWith("\\end{tikzpicture}")).toBe(true);
    expect(tex).toContain("% @ratmath/graphics: x in [-1, 5], y in [-1, 4]");
    // The exact corners appear as written, not as pixel positions.
    expect(tex).toContain("(4,0) -- (0,4)");
    expect(tex).toContain("\\definecolor{rm1}{HTML}{0F766E}");
    // The strict side y > 0 is dashed; the closed sides are solid.
    expect(tex).toMatch(/dash pattern=on 3pt off 2pt[^\]]*\]\n\s+\(0,0\) -- \(4,0\);/);
    expect(balanced(tex)).toBe(true);
    const tall = sceneTikZ(vp, [triangle], { width: 6, height: 10 });
    expect(tall).toContain("[x=1cm, y=2cm]");
  });

  test("circles stay circles, points and labels keep their TeX", () => {
    const tex = sceneTikZ(vp, [circle([2, 1], 1), { item: point("1/3", 2), label: true }, label([3, "3.4"], "y \\le 3 - \\tfrac{x}{2}")]);
    expect(tex).toContain("(2,1) ellipse [x radius=1, y radius=1]");
    expect(tex).toContain("circle [radius=2pt]");
    expect(tex).toContain("{$\\left(\\frac{1}{3},\\ 2\\right)$}");
    expect(tex).toContain("anchor=south west");
    expect(tex).toContain("{$y \\le 3 - \\tfrac{x}{2}$}");
    expect(balanced(tex)).toBe(true);
  });

  test("axes at exact tick values, tick labels last", () => {
    const tex = sceneTikZ(vp, [triangle], { axes: true });
    expect(tex).toContain("(0,-1) -- (0,4)");
    expect(tex).toContain("(-1,0) -- (5,0)");
    expect(tex).toContain("at (2,0) {\\scriptsize $2$}");
    expect(tex.lastIndexOf("\\scriptsize")).toBeGreaterThan(tex.indexOf("\\end{scope}"));
  });

  test("certified cells become merged rectangles; dashed asymptotes", () => {
    const v = viewport({ x: [-4, 4], y: [-4, 4], width: 80, height: 80 });
    const g = graph("1/x", {}, v).exact();
    const tex = sceneTikZ(v, [g]);
    const rects = (tex.match(/rectangle/g) ?? []).length;
    const cells = g.columns.reduce((n, s) => n + (s ? s.length / 2 : 0), 0);
    expect(rects - 1).toBeLessThanOrEqual(cells); // minus the clip rectangle
    expect(tex).toContain("dash pattern=on 3pt off 2pt");
    expect(tex).toContain("(0,4) -- (0,-4)");
  });

  test("polylines are simplified within tolerance", () => {
    const pts = [];
    for (let i = 0; i <= 100; i++) pts.push(i, 2 * i);
    expect(simplifyPolyline(pts, 0.25)).toEqual([0, 0, 100, 200]);
    const bent = [0, 0, 5, 5, 10, 0];
    expect(simplifyPolyline(bent, 0.25)).toEqual(bent);
    expect(simplifyPolyline(pts, 0).length).toBe(pts.length);
  });

  test("standalone documents, background, plain-text labels escaped", () => {
    const doc = sceneTikZ(vp, [triangle, { type: "label", x: 1, y: 1, text: "50% & $5", anchor: "c", dx: 0, dy: 0, size: 14, plain: false }], { standalone: true, background: "#fffbea" });
    expect(doc.startsWith("\\documentclass[tikz,border=2pt]{standalone}")).toBe(true);
    expect(doc).toContain("\\begin{document}");
    expect(doc).toContain("{HTML}{FFFBEA}");
    expect(doc).toContain("{50\\% \\& \\$5}");
    const body = tikzElements(vp, primitives(vp, [triangle]), { clip: false });
    expect(body).not.toContain("\\clip");
  });

  const pdflatex = spawnSync("pdflatex", ["--version"]).status === 0;
  test.skipIf(!pdflatex)("compiles with pdflatex", () => {
    const v = viewport({ x: [-6, 6], y: [-6, 8], width: 420, height: 380 });
    const dir = mkdtempSync(join(tmpdir(), "rm-tikz-"));
    const layers = [
      { item: region("x^2 + y^2 < 4", {}, v).exact(), color: "#2563eb" },
      { item: implicit("x^2/9 + y^2/4 = 1", {}, v).exact(), color: "#dc2626" },
      { item: graph("(x^2 - 1)/(x - 1) + 1/(x + 2)", {}, v).quick.value, color: "#0f766e" },
      { item: segment([0, 0], [3, 5]), label: true },
      { item: point(1, 2), open: true },
      label([2, 6], "y = \\frac{x^2-1}{x-1} + \\frac{1}{x+2}"),
    ];
    writeFileSync(join(dir, "fig.tex"), sceneTikZ(v, layers, { axes: true, standalone: true, width: 8 }));
    const run = spawnSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "fig.tex"], { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) console.error(run.stdout.slice(-2000));
    expect(run.status).toBe(0);
    expect(existsSync(join(dir, "fig.pdf"))).toBe(true);
  }, 60000);
});

describe("ASCII export", () => {
  const box = viewport({ x: [0, 8], y: [0, 4], width: 160, height: 80 });
  const lines = (s) => s.split("\n");

  test("size, border and line characters", () => {
    const s = sceneASCII(box, [segment([0, 2], [8, 2]), segment(["1/2", "1/4"], ["7/2", "15/4"])], { cols: 40, rows: 20, border: true });
    const L = lines(s);
    expect(L.length).toBe(22);
    expect(L.every((l) => l.length === 42)).toBe(true);
    expect(L[0]).toBe("+" + "-".repeat(40) + "+");
    expect(L.slice(1, -1).filter((l) => /-{20}/.test(l)).length).toBe(1);
    expect(s).toMatch(/\//);
    expect(s).not.toMatch(/[^\x00-\x7f]/);
  });

  test("direction picks - | / \\", () => {
    const pick = (a, b) => sceneASCII(box, [{ item: segment(a, b), endpoints: false }], { cols: 40, rows: 20 }).replace(/\s/g, "");
    expect(new Set(pick([1, 2], [7, 2]))).toEqual(new Set(["-"]));
    expect(new Set(pick([4, "1/2"], [4, "7/2"]))).toEqual(new Set(["|"]));
    // Equal steps in characters: 1 column across, 1 row (= 2 columns' height) up.
    expect(new Set(pick([1, "1/2"], [5, "5/2"]))).toEqual(new Set(["/"]));
    expect(new Set(pick([1, "5/2"], [5, "1/2"]))).toEqual(new Set(["\\"]));
  });

  test("a certified graph keeps every cell it passes through", () => {
    // One character per certified pixel: the viewport is cols x rows.
    const v = viewport({ x: [-3, 3], y: [-2, 2], width: 60, height: 20 });
    const g = graph("x^3/4 - x", {}, v).exact();
    for (const mode of ["ascii", "braille", "blocks"]) {
      const L = lines(sceneASCII(v, [g], { cols: 60, rows: 20, mode, border: true })).slice(1, -1).map((l) => [...l].slice(1, -1));
      g.columns.forEach((spans, i) => {
        for (let j = 0; spans && j < spans.length; j += 2) {
          for (let r = spans[j]; r <= spans[j + 1]; r++) expect(L[r][i]).not.toBe(" ");
        }
      });
      // and nothing else is inked
      const inked = L.flat().filter((ch) => ch !== " ").length;
      expect(inked).toBe(g.columns.reduce((n, s) => n + (s ? s.reduce((a, x, k) => a + (k % 2 ? x + 1 : -x), 0) : 0), 0));
    }
  });

  test("braille and block modes", () => {
    const g = graph("sin(x)", {}, viewport({ x: [-4, 4], y: [-2, 2], width: 200, height: 100 })).quick.value;
    const v = viewport({ x: [-4, 4], y: [-2, 2], width: 200, height: 100 });
    const br = sceneASCII(v, [g], { mode: "braille", cols: 40 });
    expect(br.replace(/\s/g, "")).toMatch(/^[⠁-⣿]+$/);
    const bl = sceneASCII(v, [g], { mode: "blocks", cols: 40 });
    expect(bl.replace(/\s/g, "")).toMatch(/^[▘▝▀▖▌▞▛▗▚▐▜▄▙▟█]+$/);
    expect(() => sceneASCII(v, [g], { mode: "sixel" })).toThrow(/unknown text mode/);
  });

  test("axes, tick labels, dots, region fill and labels", () => {
    const s = sceneASCII(vp, [{ item: triangle, color: "#0f766e" }, { item: point(3, 3), open: true }, label([1, "3.5"], "x^2 \\le \\frac{1}{2}")], { axes: true, cols: 60 });
    expect(s).toContain("x^2 <= 1/2");
    expect(s).toContain("O");
    expect(s).toContain("@"); // the included corner (0, 4)
    expect(s).toContain(".");
    expect(s).toMatch(/^-+.*-+$/m); // the x-axis row
    expect(s).toMatch(/ 1 +2 +3 +4/); // x tick labels
    const u = sceneASCII(vp, [{ item: triangle }, label([1, "3.5"], "x^2 \\le \\frac{1}{2}")], { axes: true, cols: 60, mode: "braille" });
    expect(u).toContain("x² ≤ 1/2");
    expect(u).toContain("─");
    expect(u).toContain("│");
    expect(u).toContain("░");
  });

  test("ANSI colors and ASCII transliteration", () => {
    const s = sceneASCII(box, [{ item: segment([0, 2], [8, 2]), color: "#dc2626" }], { cols: 20, rows: 10, color: true });
    expect(s).toContain("\x1b[38;2;220;38;38m");
    expect(s).toContain("\x1b[0m");
    expect(asciiText("x² + y³⁴ ≤ π·r")).toBe("x^2 + y^34 <= pi*r");
  });
});

describe("PGFPlots export", () => {
  test("an axis environment with curves as \\addplot", () => {
    const v = viewport({ x: [-4, 4], y: [-3, 3], width: 320, height: 240 });
    const tex = scenePGFPlots(v, [graph("x^3/4 - x", {}, v).quick.value, { item: circle([0, 0], 1), color: "#dc2626" }, label([1, 2], "y = \\tfrac{x^3}{4} - x")], { axes: true, width: 8 });
    expect(tex).toContain("\\begin{axis}[");
    expect(tex).toContain("xmin=-4");
    expect(tex).toContain("ymax=3");
    expect(tex).toContain("axis lines=middle");
    expect(tex).toMatch(/\\addplot\[draw=rm1, [^\]]*no marks\] coordinates \{/);
    expect(tex).toContain("(0,0) ellipse [x radius=1, y radius=1]");
    expect(tex).not.toContain("\\clip");
    expect(balanced(tex)).toBe(true);
    expect(scenePGFPlots(v, [], {})).toContain("hide axis");
  });
  const pdflatex = spawnSync("pdflatex", ["--version"]).status === 0;
  test.skipIf(!pdflatex)("compiles with pdflatex", () => {
    const v = viewport({ x: [-6, 6], y: [-6, 8], width: 420, height: 380 });
    const dir = mkdtempSync(join(tmpdir(), "rm-pgf-"));
    const layers = [{ item: graph("(x^2 - 1)/(x - 1) + 1/(x + 2)", {}, v).exact() }, { item: region("x^2 + y^2 < 4", {}, v).exact(), color: "#2563eb" }, { item: point(1, "7/3"), open: true }, label([2, 6], "\\frac{x^2-1}{x-1}")];
    writeFileSync(join(dir, "fig.tex"), scenePGFPlots(v, layers, { axes: true, standalone: true }));
    const run = spawnSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "fig.tex"], { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) console.error(run.stdout.slice(-2000));
    expect(run.status).toBe(0);
  }, 60000);
});

describe("PDF export", () => {
  const text = (bytes) => String.fromCharCode(...bytes);
  test("a valid one-page PDF with a correct cross-reference table", () => {
    const bytes = scenePDF(vp, [{ item: triangle, color: "#0f766e" }, circle([2, 1], 1), label([3, "3.4"], "y \\le 3 - \\tfrac{x}{2}")], { axes: true, background: "#fff" });
    const s = text(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/MediaBox [0 0 270 225]");
    const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
    const len = Number(/\/Length (\d+) >>\nstream\n/.exec(s)[1]);
    const start = s.indexOf("stream\n") + 7;
    expect(s.slice(start + len, start + len + 9)).toBe("endstream");
    expect(s).toMatch(/ c\n?/); // Bézier circle
    expect(s).toContain("/F2 14 Tf (\xa3) Tj"); // ≤ from the Symbol font
    expect(s).toContain("/ca 0.22");
  });
  test("text runs pick Helvetica or Symbol", () => {
    expect(pdfTextRuns("x² ≤ π")).toEqual([["F1", "x\xb2 ", 500 + 333 + 278], ["F2", "\xa3", 549], ["F1", " ", 278], ["F2", "p", 549]]);
  });
  const pdftoppm = spawnSync("pdftoppm", ["-v"]).status === 0;
  test.skipIf(!pdftoppm)("renders with poppler", () => {
    const dir = mkdtempSync(join(tmpdir(), "rm-pdf-"));
    writeFileSync(join(dir, "f.pdf"), scenePDF(vp, [{ item: triangle, color: "#0f766e" }], { axes: true }));
    expect(spawnSync("pdftoppm", ["-png", join(dir, "f.pdf"), join(dir, "f")]).status).toBe(0);
  });
});

describe("PNG export", () => {
  async function decode(png) {
    const dv = new DataView(png.buffer, png.byteOffset);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    let o = 8;
    const idat = [];
    while (o < png.length) {
      const len = dv.getUint32(o);
      const type = String.fromCharCode(...png.slice(o + 4, o + 8));
      if (type === "IDAT") idat.push(png.slice(o + 8, o + 8 + len));
      o += 12 + len;
    }
    const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"));
    const raw = new Uint8Array(await new Response(stream).arrayBuffer());
    const px = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const r = y * (width * 4 + 1);
      expect(raw[r]).toBe(1);
      for (let i = 0; i < width * 4; i++) px[y * width * 4 + i] = (raw[r + 1 + i] + (i >= 4 ? px[y * width * 4 + i - 4] : 0)) & 0xff;
    }
    return { width, height, at: (x, y) => [...px.slice((y * width + x) * 4, (y * width + x) * 4 + 4)] };
  }

  test("software rendering: fills, strokes, background, scale", async () => {
    const v = viewport({ x: [0, 10], y: [0, 10], width: 100, height: 100 });
    const sq = polygon([[2, 2], [8, 2], [8, 8], [2, 8]]);
    const img = await decode(await scenePNG(v, [{ item: sq, color: "#ff0000", fillAlpha: 1 }], { background: "#ffffff" }));
    expect([img.width, img.height]).toEqual([100, 100]);
    expect(img.at(50, 50)).toEqual([255, 0, 0, 255]);
    expect(img.at(5, 5)).toEqual([255, 255, 255, 255]);
    const hi = await decode(await scenePNG(v, [{ item: sq, color: "#0000ff", fillAlpha: 0 }], { scale: 2 }));
    expect([hi.width, hi.height]).toEqual([200, 200]);
    expect(hi.at(100, 100)[3]).toBe(0); // transparent inside an unfilled square
    expect(hi.at(40, 100)).toEqual([0, 0, 255, 255]); // on its left edge, 2 px wide
  });

  test("certified cells are painted exactly on their pixels", async () => {
    const v = viewport({ x: [-3, 3], y: [-2, 2], width: 60, height: 40 });
    const g = graph("x^3/4 - x", {}, v).exact();
    const img = await decode(await scenePNG(v, [{ item: g, color: "#000000" }], { background: "#ffffff" }));
    g.columns.forEach((spans, i) => {
      for (let j = 0; spans && j < spans.length; j += 2) for (let r = spans[j]; r <= spans[j + 1]; r++) expect(img.at(i, r)).toEqual([0, 0, 0, 255]);
    });
  });

  test("labels and tick labels are drawn", async () => {
    const v = viewport({ x: [-1, 5], y: [-1, 4], width: 180, height: 150 });
    const plain = await decode(await scenePNG(v, [], { background: "#fff" }));
    const withText = await decode(await scenePNG(v, [label([2, 2], "x^2 \\le \\pi")], { axes: true, background: "#fff" }));
    let changed = 0;
    for (let y = 0; y < 150; y++) for (let x = 0; x < 180; x++) if (withText.at(x, y)[0] !== plain.at(x, y)[0]) changed++;
    expect(changed).toBeGreaterThan(200);
  });

  test("rasterize and encodePNG work on their own", async () => {
    const v = viewport({ x: [0, 1], y: [0, 1], width: 3, height: 2 });
    const img = rasterize(v, [], { background: "#102030" });
    expect([...img.data.slice(0, 4)]).toEqual([16, 32, 48, 255]);
    const back = await decode(await encodePNG(img));
    expect(back.at(2, 1)).toEqual([16, 32, 48, 255]);
  });
});
