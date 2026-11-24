// TikZ back end: a scene as a LaTeX tikzpicture.
//
// Coordinates are written in WORLD units (the viewport's x and y), with the
// picture's x and y unit vectors chosen so the whole viewport is `width` cm
// wide. So a point at (1/2, 3) is `(0.5,3)` in the file, labels are real TeX
// typeset by the document, and the picture can be edited by hand afterwards.
//
//   const tex = sceneTikZ(vp, layers, { axes: true, width: 8 });
//   const doc = sceneTikZ(vp, layers, { standalone: true });   // compiles with pdflatex
//
// Line widths, dashes and dot radii are given in pixels by the scene and
// written as `pt` lengths (times `pt`, default 0.5), so they stay the same
// size whatever `width` is, as TeX users expect.

import { primitives, niceStep, ANCHOR } from "./scene.js";

/** Number formatting with `d` decimals, no trailing zeros and no "-0". */
function fmt(v, d) {
  let s = v.toFixed(d);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** Normalize a CSS color to RRGGBB hex, an xcolor name, or null (= document default). */
function colorKey(c) {
  if (c === undefined || c === null || c === "currentColor" || c === "inherit") return null;
  const s = String(c).trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return m.slice(1, 4).map((x) => Math.min(255, +x).toString(16).padStart(2, "0")).join("").toUpperCase();
  if (/^[a-z]+(?:![0-9]+(?:![a-z]+)?)?$/i.test(s)) return { name: s };
  return null;
}

/** Ramer–Douglas–Peucker on a flat [x, y, x, y, ...] list, tolerance in pixels. */
export function simplifyPolyline(pts, tol) {
  const n = pts.length / 2;
  if (tol <= 0 || n <= 2) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], ay = pts[2 * a + 1];
    const dx = pts[2 * b] - ax, dy = pts[2 * b + 1] - ay;
    const L2 = dx * dx + dy * dy;
    let best = -1, far = t2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
      let d2;
      if (L2 === 0) d2 = px * px + py * py;
      else {
        const c = px * dy - py * dx;
        d2 = (c * c) / L2;
        // Points beyond the ends of the chord measure to the nearer end.
        const t = (px * dx + py * dy) / L2;
        if (t < 0) d2 = px * px + py * py;
        else if (t > 1) d2 = (px - dx) ** 2 + (py - dy) ** 2;
      }
      if (d2 > far) {
        far = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** Merge pixel rectangles [x, y, w, h, ...] that sit side by side with the same rows. */
function mergeRects(rects) {
  const byRow = new Map();
  for (let i = 0; i < rects.length; i += 4) {
    const k = `${rects[i + 1]},${rects[i + 3]}`;
    if (!byRow.has(k)) byRow.set(k, []);
    byRow.get(k).push([rects[i], rects[i + 2]]);
  }
  const out = [];
  for (const [k, list] of byRow) {
    const [y, h] = k.split(",").map(Number);
    list.sort((a, b) => a[0] - b[0]);
    let [x, w] = list[0];
    for (let i = 1; i < list.length; i++) {
      const [x2, w2] = list[i];
      if (x2 <= x + w + 1e-9) w = Math.max(w, x2 + w2 - x);
      else {
        out.push(x, y, w, h);
        [x, w] = [x2, w2];
      }
    }
    out.push(x, y, w, h);
  }
  return out;
}

const TEX_ESC = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#", "%": "\\%", _: "\\_", "^": "\\^{}", "~": "\\~{}" };
const texEscape = (s) => String(s).replace(/[\\{}$&#%_^~]/g, (c) => TEX_ESC[c]);

/**
 * Primitives as the body of a tikzpicture (a string of TikZ commands, in
 * world coordinates; `vp` converts back from pixels). Options: pt (points
 * per scene pixel for widths, dashes and dots; default 0.5), precision
 * (decimals; default enough for a tenth of a pixel), simplify (polyline
 * tolerance in pixels, default 0.25; 0 keeps every point), background,
 * clip (default true), colors (a Map collecting color definitions).
 */
export function tikzElements(vp, prims, options = {}) {
  const { pt = 0.5, simplify = 0.25, clip = true, background } = options;
  const W = vp.width;
  const H = vp.height;
  const { xmin, xmax, ymin, ymax } = vp.f;
  const sx = (xmax - xmin) / W;
  const sy = (ymax - ymin) / H;
  const d = options.precision ?? Math.max(0, Math.ceil(-Math.log10(Math.min(sx, sy) / 10)));
  const X = (px) => fmt(xmin + px * sx, d);
  const Y = (py) => fmt(ymax - py * sy, d);
  const P = (px, py) => `(${X(px)},${Y(py)})`;
  const L = (v) => `${fmt(v * pt, 2)}pt`;
  const colors = options.colors ?? new Map();
  const col = (c, fallback = null) => {
    const k = colorKey(c);
    if (k === null) return fallback;
    if (typeof k === "object") return k.name;
    if (!colors.has(k)) colors.set(k, `rm${colors.size + 1}`);
    return colors.get(k);
  };
  const bg = () => col(background ?? "#fff", "white");

  const shapes = [];
  const labels = [];
  for (const p of prims) {
    if (p.t === "rects") {
      if (!p.rects.length) continue;
      const r = mergeRects(p.rects);
      const opts = [`fill=${col(p.fill, "black")}`];
      if (p.alpha !== undefined && p.alpha !== 1) opts.push(`fill opacity=${fmt(p.alpha, 3)}`);
      const items = [];
      for (let i = 0; i < r.length; i += 4) items.push(`${P(r[i], r[i + 1] + r[i + 3])} rectangle ${P(r[i] + r[i + 2], r[i + 1])}`);
      shapes.push(`\\fill[${opts.join(", ")}]\n  ${wrap(items, 3)};`);
    } else if (p.t === "path") {
      const opts = [];
      const filled = p.fill && (p.fillAlpha ?? 1) > 0;
      if (filled) {
        opts.push(`fill=${col(p.fill, "black")}`);
        if ((p.fillAlpha ?? 1) !== 1) opts.push(`fill opacity=${fmt(p.fillAlpha, 3)}`);
      }
      if (p.stroke) {
        opts.push(`draw=${col(p.stroke, "black")}`, `line width=${L(p.width ?? 1)}`);
        if (p.dash) opts.push(`dash pattern=${p.dash.map((v, i) => `${i % 2 ? "off" : "on"} ${L(v)}`).join(" ")}`);
        if (p.alpha !== undefined && p.alpha !== 1) opts.push(`draw opacity=${fmt(p.alpha, 3)}`);
        opts.push("line join=round", "line cap=round");
      }
      if (!filled && !p.stroke) continue;
      if (p.role === "grid" || p.role === "axis") opts.splice(opts.indexOf("line join=round"), 2);
      if (p.ellipse) {
        // A circle in world units is an ellipse on screen when the axes are
        // scaled differently; TikZ applies its x and y units to the radii.
        const [cx, cy, rx, ry] = p.ellipse;
        shapes.push(`\\path[${opts.join(", ")}] ${P(cx, cy)} ellipse [x radius=${fmt(rx * sx, d)}, y radius=${fmt(ry * sy, d)}];`);
        continue;
      }
      // In PGFPlots, curves become \addplot coordinates (one per piece).
      const asPlot = options.pgfplots && !p.closed && !filled && !p.role;
      const parts = [];
      for (const s of p.subpaths) {
        if (s.length < 4) continue;
        const pts = p.closed ? s : simplifyPolyline(s, simplify);
        if (asPlot) {
          const coords = [];
          for (let i = 0; i < pts.length; i += 2) coords.push(P(pts[i], pts[i + 1]));
          const uniq = coords.filter((c, i) => i === 0 || c !== coords[i - 1]);
          if (uniq.length >= 2) shapes.push(`\\addplot[${opts.join(", ")}, no marks] coordinates {\n  ${wrap(uniq, 6)}\n};`);
          continue;
        }
        const coords = [];
        for (let i = 0; i < pts.length; i += 2) coords.push(P(pts[i], pts[i + 1]));
        // Drop repeated coordinates after rounding.
        const uniq = coords.filter((c, i) => i === 0 || c !== coords[i - 1]);
        if (uniq.length < 2 && !p.closed) continue;
        parts.push(wrap(uniq, 6, " -- ") + (p.closed ? " -- cycle" : ""));
      }
      if (parts.length) shapes.push(`\\path[${opts.join(", ")}]\n  ${parts.join("\n  ")};`);
    } else if (p.t === "dot") {
      const open = p.fill === "background" || (p.fill !== p.stroke && colorKey(p.fill) !== null && colorKey(p.fill) === colorKey(background ?? "#fff"));
      const fill = p.fill === "background" ? bg() : col(p.fill, open ? bg() : "black");
      shapes.push(`\\path[fill=${fill}, draw=${col(p.stroke, "black")}, line width=${L(p.width ?? 1)}] ${P(p.x, p.y)} circle [radius=${L(p.r)}];`);
    } else if (p.t === "label") {
      labels.push(p);
    }
  }

  const out = [];
  if (background) out.push(`\\fill[${bg()}] (${fmt(xmin, d)},${fmt(ymin, d)}) rectangle (${fmt(xmax, d)},${fmt(ymax, d)});`);
  if (options.before) out.push(...options.before);
  if (clip && shapes.length && !options.pgfplots) {
    out.push("\\begin{scope}", `  \\clip (${fmt(xmin, d)},${fmt(ymin, d)}) rectangle (${fmt(xmax, d)},${fmt(ymax, d)});`);
    out.push(...shapes.map((s) => "  " + s.replace(/\n/g, "\n  ")));
    out.push("\\end{scope}");
  } else out.push(...shapes);

  if (options.after) out.push(...options.after);
  for (const p of labels) {
    if (options.labels === false && !p.plain) continue;
    const [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
    const gap = p.plain ? 2 : 6;
    const anchor = [ay < 0 ? "south" : ay > 0 ? "north" : "", ax > 0 ? "west" : ax < 0 ? "east" : ""].filter(Boolean).join(" ") || "center";
    const opts = [`anchor=${anchor}`, "inner sep=1pt"];
    const c = col(p.color);
    if (c) opts.push(`text=${c}`);
    const xs = ax * gap + (p.dx ?? 0);
    const ys = -(ay * gap + (p.dy ?? 0));
    if (xs) opts.push(`xshift=${L(xs)}`);
    if (ys) opts.push(`yshift=${L(ys)}`);
    const size = p.size ?? 14;
    const font = size <= 11 ? "\\scriptsize " : size <= 13 ? "\\footnotesize " : "";
    let body;
    if (p.plain && p.value !== undefined) body = `$${String(p.text).replace(/−/g, "-")}$`;
    else if (p.tex !== undefined && !p.plain) body = `$${p.tex}$`;
    else body = texEscape(p.text ?? "");
    out.push(`\\node[${opts.join(", ")}] at ${P(p.x, p.y)} {${font}${body}};`);
  }
  return out.join("\n");
}

function wrap(items, per, sep = " ") {
  const lines = [];
  for (let i = 0; i < items.length; i += per) lines.push(items.slice(i, i + per).join(sep));
  return lines.join(sep.trim() ? `${sep.trimEnd()}\n  ` : "\n  ");
}

/**
 * Grid, axis lines and tick labels in world coordinates (the same ticks as
 * axesPrimitives, but at their exact values rather than snapped to pixels).
 * Returns { lines, labels }, lists of TikZ commands.
 */
export function tikzAxes(vp, { grid = "#e5e7eb", axis = "#9ca3af", text = "#6b7280", ticks = true, target } = {}, { colors = new Map(), pt = 0.5, precision } = {}) {
  const { xmin, xmax, ymin, ymax } = vp.f;
  const W = vp.width;
  const H = vp.height;
  const sx = niceStep(xmax - xmin, target ?? Math.max(4, Math.round(W / 80)));
  const sy = niceStep(ymax - ymin, target ?? Math.max(4, Math.round(H / 70)));
  const d = precision ?? Math.max(0, Math.ceil(-Math.log10(Math.min((xmax - xmin) / W, (ymax - ymin) / H) / 10)));
  const dx = Math.max(0, Math.ceil(-Math.log10(sx) - 1e-9));
  const dy = Math.max(0, Math.ceil(-Math.log10(sy) - 1e-9));
  const col = (c) => {
    const k = colorKey(c);
    if (k === null) return "black";
    if (typeof k === "object") return k.name;
    if (!colors.has(k)) colors.set(k, `rm${colors.size + 1}`);
    return colors.get(k);
  };
  const xs = [];
  const ys = [];
  for (let i = Math.ceil(xmin / sx - 1e-9); i * sx <= xmax + 1e-12; i++) xs.push(i * sx);
  for (let i = Math.ceil(ymin / sy - 1e-9); i * sy <= ymax + 1e-12; i++) ys.push(i * sy);
  const [X0, X1, Y0, Y1] = [xmin, xmax, ymin, ymax].map((v) => fmt(v, d));
  const out = [];
  const labels = [];
  const w = `line width=${fmt(pt, 2)}pt`;
  if (grid) {
    const lines = [...xs.map((x) => `(${fmt(x, dx)},${Y0}) -- (${fmt(x, dx)},${Y1})`), ...ys.map((y) => `(${X0},${fmt(y, dy)}) -- (${X1},${fmt(y, dy)})`)];
    out.push(`\\draw[${col(grid)}, ${w}]\n  ${lines.join("\n  ")};`);
  }
  const hasX = xmin <= 0 && xmax >= 0;
  const hasY = ymin <= 0 && ymax >= 0;
  const axes = [];
  if (hasX) axes.push(`(0,${Y0}) -- (0,${Y1})`);
  if (hasY) axes.push(`(${X0},0) -- (${X1},0)`);
  if (axes.length) out.push(`\\draw[${col(axis)}, ${w}]\n  ${axes.join("\n  ")};`);
  if (ticks) {
    const yLine = hasY ? "0" : Y0;
    const xLine = hasX ? "0" : X0;
    const edgeX = 12 * ((xmax - xmin) / W);
    const edgeY = 10 * ((ymax - ymin) / H);
    for (const x of xs) if (Math.abs(x) > sx / 2 && x > xmin + edgeX && x < xmax - edgeX) labels.push(`\\node[anchor=north, inner sep=1pt, text=${col(text)}, yshift=-${fmt(2 * pt, 2)}pt] at (${fmt(x, dx)},${yLine}) {\\scriptsize $${fmt(x, dx)}$};`);
    for (const y of ys) if (Math.abs(y) > sy / 2 && y > ymin + edgeY && y < ymax - edgeY) labels.push(`\\node[anchor=west, inner sep=1pt, text=${col(text)}, xshift=${fmt(3 * pt, 2)}pt] at (${xLine},${fmt(y, dy)}) {\\scriptsize $${fmt(y, dy)}$};`);
  }
  return { lines: out, labels };
}

/**
 * A whole scene as a PGFPlots axis inside a tikzpicture. PGFPlots draws its
 * own axes, ticks and grid (axes: true), clips to the viewport, and the layers
 * go in axis coordinates: curves as \addplot coordinates, everything else as
 * TikZ paths. Options as sceneTikZ, plus axisOptions (extra keys for the
 * axis environment, a string). Needs \pgfplotsset{compat=1.11} or later,
 * which standalone documents set (1.18).
 */
export function scenePGFPlots(vp, layers, options = {}) {
  const { axes, width = 10, standalone = false, comment = true } = options;
  const height = options.height ?? (width * vp.height) / vp.width;
  const prims = primitives(vp, layers, options);
  const colors = new Map();
  const body = tikzElements(vp, prims, { ...options, colors, pgfplots: true, clip: false });
  const d = Math.max(0, Math.ceil(-Math.log10(Math.min(vp.f.dx, vp.f.dy) / 10)));
  const keys = [`width=${fmt(width, 3)}cm`, `height=${fmt(height, 3)}cm`, "scale only axis", `xmin=${fmt(vp.f.xmin, d)}`, `xmax=${fmt(vp.f.xmax, d)}`, `ymin=${fmt(vp.f.ymin, d)}`, `ymax=${fmt(vp.f.ymax, d)}`];
  if (axes) {
    const zero = vp.f.xmin <= 0 && vp.f.xmax >= 0 && vp.f.ymin <= 0 && vp.f.ymax >= 0;
    keys.push(zero ? "axis lines=middle" : "axis lines=box", "grid=major", "major grid style={line width=0.25pt, draw=black!12}", "tick label style={font=\\scriptsize}", "axis line style={draw=black!45}");
  } else keys.push("hide axis");
  if (options.axisOptions) keys.push(options.axisOptions);
  const lines = [];
  if (comment) lines.push(`% @ratmath/graphics (PGFPlots): x in [${vp.xmin}, ${vp.xmax}], y in [${vp.ymin}, ${vp.ymax}]; needs \\pgfplotsset{compat=1.11} or later`);
  lines.push("\\begin{tikzpicture}");
  for (const [hex, name] of colors) lines.push(`\\definecolor{${name}}{HTML}{${hex}}`);
  lines.push(`\\begin{axis}[\n  ${keys.join(",\n  ")}\n]`, body, "\\end{axis}", "\\end{tikzpicture}");
  const pic = lines.join("\n");
  if (!standalone) return pic;
  return ["\\documentclass[tikz,border=2pt]{standalone}", "\\usepackage{amsmath,amssymb}", "\\usepackage{pgfplots}", "\\pgfplotsset{compat=1.18}", options.preamble ?? "", "\\begin{document}", pic, "\\end{document}", ""].filter((l) => l !== "").join("\n");
}

/**
 * A whole scene as a tikzpicture. Options (besides tikzElements'): axes
 * (true or axes options), width (cm, default 10), height (cm, default keeps
 * the viewport's pixel aspect ratio), labels (false drops non-axis labels),
 * standalone (true wraps a complete document for the standalone class),
 * colors (layer palette), comment (false drops the header comment).
 */
export function sceneTikZ(vp, layers, options = {}) {
  const { axes, width = 10, standalone = false, comment = true } = options;
  const height = options.height ?? (width * vp.height) / vp.width;
  const prims = primitives(vp, layers, options);
  const colors = new Map();
  const pt = options.pt ?? 0.5;
  const ax = axes ? tikzAxes(vp, axes === true ? {} : axes, { colors, pt, precision: options.precision }) : { lines: [], labels: [] };
  const body = tikzElements(vp, prims, { ...options, colors, before: ax.lines, after: ax.labels });
  const xu = width / (vp.f.xmax - vp.f.xmin);
  const yu = height / (vp.f.ymax - vp.f.ymin);
  const lines = [];
  if (comment) lines.push(`% @ratmath/graphics: x in [${vp.xmin}, ${vp.xmax}], y in [${vp.ymin}, ${vp.ymax}], ${fmt(width, 3)}cm x ${fmt(height, 3)}cm`);
  lines.push(`\\begin{tikzpicture}[x=${fmt(xu, 5)}cm, y=${fmt(yu, 5)}cm]`);
  for (const [hex, name] of colors) lines.push(`\\definecolor{${name}}{HTML}{${hex}}`);
  lines.push(body, "\\end{tikzpicture}");
  const pic = lines.join("\n");
  if (!standalone) return pic;
  return ["\\documentclass[tikz,border=2pt]{standalone}", "\\usepackage{amsmath,amssymb}", options.preamble ?? "", "\\begin{document}", pic, "\\end{document}", ""].filter((l) => l !== "").join("\n");
}

