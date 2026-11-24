// Text back end: a scene as a grid of characters, for terminals, plain-text
// email, code comments, README files and screen readers' "show me roughly".
//
//   console.log(sceneASCII(vp, [graph("x^2 - 2", {}, vp).exact()], { axes: true }));
//
// Modes:
//   "ascii"   (default) 7-bit characters only: - | / \ _ for curves, # for
//             solid blocks, . for shaded regions, @ and O for filled and open
//             dots, - | + for axes. Labels are transliterated (x² -> x^2).
//   "braille" Unicode Braille patterns: 2 x 4 dots per character, the
//             sharpest curves a monospace font can show.
//   "blocks"  Unicode quadrant blocks (▖▗▘▝▀▄▌▐█…): 2 x 2 per character.
//
// Each character is a cell of the picture, and it is inked when ANY of the
// scene's ink touches it. So a certified frame stays certified: every
// character that the graph passes through is marked (the picture is coarser,
// never wrong). For one character per certified pixel, make the viewport
// `cols` by `rows` pixels.

import { primitives, axesPrimitives, ANCHOR, texToText } from "./scene.js";

const SUB = { ascii: [2, 4], braille: [2, 4], blocks: [2, 2] };
const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];
const QUADRANT = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];

const TO_ASCII = {
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9", "⁻": "^-", "ⁿ": "^n", "⁺": "^+",
  "≤": "<=", "≥": ">=", "≠": "!=", "·": "*", "×": "x", "±": "+-", "∓": "-+", "∞": "inf", "π": "pi", "θ": "theta", "α": "alpha", "β": "beta",
  "γ": "gamma", "δ": "delta", "Δ": "Delta", "ε": "eps", "λ": "lambda", "μ": "mu", "σ": "sigma", "φ": "phi", "ω": "omega", "∈": " in ",
  "∩": "&", "∪": "|", "→": "->", "√": "sqrt", "…": "...", "−": "-",
};

/** Transliterate the Unicode that texToText produces into 7-bit ASCII. */
export function asciiText(s) {
  // Collapse runs of superscripts: x²³ -> x^23 rather than x^2^3.
  return String(s)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻ⁿ⁺]+/g, (run) => "^" + [...run].map((c) => TO_ASCII[c].slice(1)).join(""))
    .replace(/[^\x00-\x7f]/g, (c) => TO_ASCII[c] ?? "?");
}

function hexRGB(c) {
  const s = String(c ?? "");
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return m.slice(1, 4).map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(s);
  if (m) return m.slice(1, 4).map((h) => parseInt(h, 16));
  return null;
}

/**
 * Primitives as text. Options: cols (default 72), rows (default keeps the
 * viewport's aspect with characters twice as tall as wide), mode ("ascii",
 * "braille", "blocks"), labels (default true), color (true for 24-bit ANSI
 * terminal colors), border (true draws a frame), background (the color that
 * marks an open dot's inside; default "#fff").
 */
export function asciiElements(vp, prims, options = {}) {
  const mode = options.mode ?? "ascii";
  if (!SUB[mode]) throw new RangeError(`unknown text mode "${mode}" (ascii, braille or blocks)`);
  const [sw, sh] = SUB[mode];
  const W = vp.width;
  const H = vp.height;
  const cols = options.cols ?? 72;
  const rows = options.rows ?? Math.max(1, Math.round((cols * H) / W / 2));
  if (!(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0)) throw new RangeError("cols and rows must be positive integers");
  const SW = cols * sw;
  const SH = rows * sh;
  const gx = SW / W; // sub-cells per pixel
  const gy = SH / H;
  const cx = cols / W; // characters per pixel
  const cy = rows / H;
  const N = cols * rows;
  const uni = mode !== "ascii";
  const bg = hexRGB(options.background ?? "#fff")?.join();

  const ink = new Uint8Array(SW * SH);
  const inkColor = new Array(N);
  const dirC = new Float64Array(N); // sum of cos 2θ (stroke directions, ascii mode)
  const dirS = new Float64Array(N);
  const dirW = new Float64Array(N);
  const fill = new Array(N); // fill color or undefined
  const axis = new Uint8Array(N); // 1 horizontal, 2 vertical
  const dots = new Array(N); // { open, color }
  const text = new Array(N); // { ch, color, plain }

  const inkAt = (sx, sy, color) => {
    if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) return -1;
    ink[sy * SW + sx] = 1;
    const k = Math.floor(sy / sh) * cols + Math.floor(sx / sw);
    inkColor[k] = color;
    return k;
  };

  // A stroked segment, in pixels, honoring a dash pattern (also in pixels).
  const segment = (x0, y0, x1, y1, color, dash, s0) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0) * gx, Math.abs(y1 - y0) * gy) * 2));
    // Visual direction: characters are about twice as tall as wide.
    const vx = (x1 - x0) * cx;
    const vy = -(y1 - y0) * cy * 2;
    const vl = Math.hypot(vx, vy);
    const c2 = vl ? (vx * vx - vy * vy) / (vl * vl) : 0;
    const s2 = vl ? (2 * vx * vy) / (vl * vl) : 0;
    const period = dash ? dash.reduce((a, b) => a + b, 0) : 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (period > 0) {
        let pos = (s0 + t * len) % period;
        let on = true;
        for (let j = 0; j < dash.length; j++) {
          if (pos < dash[j]) break;
          pos -= dash[j];
          on = !on;
        }
        if (!on) continue;
      }
      const k = inkAt(Math.floor((x0 + t * (x1 - x0)) * gx), Math.floor((y0 + t * (y1 - y0)) * gy), color);
      if (k >= 0 && vl) {
        dirC[k] += c2;
        dirS[k] += s2;
        dirW[k] += 1;
      }
    }
    return s0 + len;
  };

  // Character cells whose centers a closed path winds around (nonzero rule).
  const fillPath = (subpaths, color) => {
    const edges = [];
    for (const s of subpaths) {
      const n = s.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edges.push([s[2 * i], s[2 * i + 1], s[2 * j], s[2 * j + 1]]);
      }
    }
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) / cy;
      const xs = [];
      for (const [x0, y0, x1, y1] of edges) {
        if ((y0 <= y) === (y1 <= y)) continue;
        xs.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1]);
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let w = 0;
      let e = 0;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) / cx;
        while (e < xs.length && xs[e][0] <= x) w += xs[e++][1];
        if (w !== 0) fill[r * cols + c] = color;
      }
    }
  };

  const labels = [];
  for (const p of prims) {
    if (p.t === "path") {
      if (p.role === "grid") continue;
      if (p.role === "axis") {
        for (const s of p.subpaths) {
          const vertical = Math.abs(s[2] - s[0]) < Math.abs(s[3] - s[1]);
          if (vertical) {
            const c = Math.min(cols - 1, Math.max(0, Math.floor(s[0] * cx)));
            for (let r = 0; r < rows; r++) axis[r * cols + c] |= 2;
          } else {
            const r = Math.min(rows - 1, Math.max(0, Math.floor(s[1] * cy)));
            for (let c = 0; c < cols; c++) axis[r * cols + c] |= 1;
          }
        }
        continue;
      }
      if (p.fill && (p.fillAlpha ?? 1) > 0 && p.closed) fillPath(p.subpaths.filter((s) => s.length >= 6), p.fill);
      if (!p.stroke) continue;
      for (const s of p.subpaths) {
        if (s.length < 4) continue;
        let at = 0;
        const n = s.length / 2;
        for (let i = 0; i + 1 < n; i++) at = segment(s[2 * i], s[2 * i + 1], s[2 * i + 2], s[2 * i + 3], p.stroke, p.dash, at);
        if (p.closed) segment(s[2 * n - 2], s[2 * n - 1], s[0], s[1], p.stroke, p.dash, at);
      }
    } else if (p.t === "rects") {
      const solid = (p.alpha ?? 1) >= 0.5;
      for (let i = 0; i < p.rects.length; i += 4) {
        const [x, y, w, h] = [p.rects[i], p.rects[i + 1], p.rects[i + 2], p.rects[i + 3]];
        if (solid) {
          // Every sub-cell the rectangle overlaps (covering, so certified cells stay covered).
          for (let sy = Math.floor(y * gy); sy < Math.ceil((y + h) * gy - 1e-9); sy++) {
            for (let sx = Math.floor(x * gx); sx < Math.ceil((x + w) * gx - 1e-9); sx++) inkAt(sx, sy, p.fill);
          }
        } else {
          for (let r = Math.floor(y * cy); r < Math.ceil((y + h) * cy - 1e-9); r++) {
            for (let c = Math.floor(x * cx); c < Math.ceil((x + w) * cx - 1e-9); c++) if (r >= 0 && c >= 0 && r < rows && c < cols) fill[r * cols + c] = p.fill;
          }
        }
      }
    } else if (p.t === "dot") {
      const c = Math.floor(p.x * cx);
      const r = Math.floor(p.y * cy);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const open = p.fill === "background" || (p.fill !== p.stroke && hexRGB(p.fill)?.join() === bg);
      dots[r * cols + c] = { open, color: p.stroke ?? p.fill };
    } else if (p.t === "label") {
      labels.push(p);
    }
  }

  // Labels: written last, so they stay readable over the picture. Tick labels
  // (plain) give way to anything already drawn; other labels give way only to
  // earlier labels, moving along their row to the nearest free stretch.
  if (options.labels !== false) {
    const sorted = [...labels.filter((p) => !p.plain), ...labels.filter((p) => p.plain)];
    for (const p of sorted) {
      let s = p.plain ? String(p.text) : texToText(p.tex ?? p.text ?? "");
      if (!uni) s = asciiText(s);
      const chars = [...s];
      if (!chars.length) continue;
      const [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
      const c0 = Math.floor((p.x + (p.dx ?? 0)) * cx);
      let r = Math.floor((p.y + (p.dy ?? 0)) * cy) + ay;
      let start = ax > 0 ? c0 + 1 : ax < 0 ? c0 - chars.length : c0 - Math.floor(chars.length / 2);
      r = Math.min(rows - 1, Math.max(0, r));
      start = Math.min(cols - chars.length, Math.max(0, start));
      const busy = (st) => {
        for (let i = 0; i < chars.length; i++) {
          const k = r * cols + st + i;
          if (st + i < 0 || st + i >= cols || text[k]) return true;
          if (p.plain && (dots[k] || inkCell(k))) return true;
        }
        return false;
      };
      let at = null;
      if (!busy(start)) at = start;
      else if (!p.plain) {
        for (let d = 1; d < cols && at === null; d++) {
          if (start + d + chars.length <= cols && !busy(start + d)) at = start + d;
          else if (start - d >= 0 && !busy(start - d)) at = start - d;
        }
      }
      if (at === null) continue;
      // Tick labels keep a blank on each side, so "-1" never reads as part of a curve or another label.
      const taken = (k) => text[k] || dots[k] || inkCell(k);
      if (p.plain && ((at > 0 && taken(r * cols + at - 1)) || (at + chars.length < cols && taken(r * cols + at + chars.length)))) continue;
      chars.forEach((ch, i) => (text[r * cols + at + i] = { ch, color: p.color, plain: p.plain }));
    }
  }

  function inkCell(k) {
    const r = Math.floor(k / cols);
    const c = k % cols;
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) if (ink[(r * sh + j) * SW + c * sw + i]) return true;
    return false;
  }

  const glyphOfInk = (r, c, k) => {
    let bits = 0;
    let count = 0;
    let my = 0;
    const pts = [];
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        if (!ink[(r * sh + j) * SW + c * sw + i]) continue;
        count++;
        pts.push([i, j]);
        my += j;
        if (mode === "braille") bits |= BRAILLE_BIT[j][i];
        else if (mode === "blocks") bits |= 1 << (j * 2 + i);
      }
    }
    if (!count) return null;
    if (mode === "braille") return String.fromCodePoint(0x2800 + bits);
    if (mode === "blocks") return QUADRANT[bits];
    // ascii: from stroke directions when there are any, else from the ink
    // pattern around the character (its 3 x 3 neighborhood, so a run of
    // certified cells reads as one stroke).
    let C, S;
    if (dirW[k] > 0) {
      C = dirC[k];
      S = dirS[k];
    } else {
      const near = [];
      for (let j = (r - 1) * sh; j < (r + 2) * sh; j++) {
        if (j < 0 || j >= SH) continue;
        for (let i = (c - 1) * sw; i < (c + 2) * sw; i++) if (i >= 0 && i < SW && ink[j * SW + i]) near.push([i, j]);
      }
      let nx = 0, ny = 0;
      for (const [i, j] of near) {
        nx += i;
        ny += j;
      }
      nx /= near.length;
      ny /= near.length;
      let xx = 0, yy = 0, xy = 0;
      // Sub-cells are square in visual units (a character is 1 wide, 2 tall, split 2 x 4).
      for (const [i, j] of near) {
        xx += (i - nx) ** 2;
        yy += (j - ny) ** 2;
        xy += -(i - nx) * (j - ny);
      }
      C = xx - yy;
      S = 2 * xy;
      if (near.length < 3 || Math.hypot(C, S) < 0.35 * (xx + yy)) return count >= 6 ? "#" : count === 1 ? (pts[0][1] >= sh / 2 ? "." : "'") : "*";
    }
    const deg = (Math.atan2(S, C) * 90) / Math.PI; // θ in (-90, 90]
    if (Math.abs(deg) < 22.5) {
      // A flat stroke on the bottom sub-row reads better as an underscore.
      return my / count >= sh - 1 && dirW[k] > 0 ? "_" : "-";
    }
    if (Math.abs(deg) > 67.5) return "|";
    return deg > 0 ? "/" : "\\";
  };

  const AX = uni ? [" ", "─", "│", "┼"] : [" ", "-", "|", "+"];
  const FILL = uni ? "░" : ".";
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (text[k]) line.push([text[k].ch, text[k].color]);
      else if (dots[k]) line.push([dots[k].open ? (uni ? "○" : "O") : uni ? "●" : "@", dots[k].color]);
      else {
        const g = glyphOfInk(r, c, k);
        if (g) line.push([g, inkColor[k]]);
        else if (axis[k]) line.push([AX[axis[k]], options.axisColor ?? "#9ca3af"]);
        else if (fill[k]) line.push([FILL, fill[k]]);
        else line.push([" ", null]);
      }
    }
    grid.push(line);
  }

  const border = options.border;
  const paintLine = (cells) => {
    if (!options.color) return cells.map((x) => x[0]).join("");
    let s = "";
    let cur = null;
    for (const [ch, color] of cells) {
      const rgb = ch === " " ? null : hexRGB(color);
      const key = rgb ? rgb.join(";") : null;
      if (key !== cur) {
        s += key ? `\x1b[38;2;${key}m` : "\x1b[0m";
        cur = key;
      }
      s += ch;
    }
    return cur ? s + "\x1b[0m" : s;
  };
  let lines = grid.map(paintLine);
  if (border) {
    const [h, v, tl, tr, bl, br] = uni ? ["─", "│", "┌", "┐", "└", "┘"] : ["-", "|", "+", "+", "+", "+"];
    lines = [tl + h.repeat(cols) + tr, ...lines.map((l) => v + l + v), bl + h.repeat(cols) + br];
  } else lines = lines.map((l) => l.replace(/\s+$/, ""));
  return lines.join("\n");
}

/**
 * A whole scene as text (see asciiElements for options; also axes, true or
 * axes options, and colors, the layer palette).
 */
export function sceneASCII(vp, layers, options = {}) {
  const { axes } = options;
  const prims = [...(axes ? axesPrimitives(vp, axes === true ? {} : axes) : []), ...primitives(vp, layers, options)];
  return asciiElements(vp, prims, options);
}
