// PNG back end. In a browser (or anywhere with OffscreenCanvas) the scene is
// painted on a canvas and encoded by the platform; elsewhere (Node, Bun,
// Workers without canvas) a small software rasterizer paints the same
// primitives, anti-aliased, with a built-in bitmap font for labels, and the
// PNG is encoded here.
//
//   const png = await scenePNG(vp, layers, { axes: true, scale: 2 });   // Uint8Array
//
// Labels are plain text (the canvas cannot typeset TeX); for TeX labels in a
// picture, export SVG with KaTeX, or TikZ and run pdflatex.

import { primitives, axesPrimitives, drawScene, ANCHOR, texToText } from "./scene.js";
import { asciiText } from "./ascii.js";
import { FONT_SIZE, ASCENT, DESCENT, GLYPHS } from "./font-data.js";

const SUBROWS = 4; // vertical samples per pixel; horizontal coverage is exact

function rgb(c, fallback = [0, 0, 0]) {
  const s = String(c ?? "");
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return m.slice(1, 4).map((h) => parseInt(h + h, 16) / 255);
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(s);
  if (m) return m.slice(1, 4).map((h) => parseInt(h, 16) / 255);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return m.slice(1, 4).map((x) => Math.min(255, +x) / 255);
  const named = { white: [1, 1, 1], black: [0, 0, 0], red: [1, 0, 0], green: [0, 0.5, 0], blue: [0, 0, 1], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5] };
  return named[s.toLowerCase()] ?? fallback;
}

// ---- the canvas: premultiplied float RGBA -------------------------------------------

class Surface {
  constructor(width, height, background) {
    this.width = width;
    this.height = height;
    this.px = new Float32Array(width * height * 4);
    if (background) {
      const [r, g, b] = rgb(background, [1, 1, 1]);
      for (let i = 0; i < width * height; i++) this.px.set([r, g, b, 1], i * 4);
    }
  }

  /** Composite a color over a coverage mask (bbox-local Float32Array). */
  paint(mask, color, alpha) {
    const { cov, x0, y0, w, h } = mask;
    const [r, g, b] = color;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = cov[y * w + x];
        if (c <= 0) continue;
        const a = Math.min(1, c) * alpha;
        const k = ((y0 + y) * this.width + x0 + x) * 4;
        const p = this.px;
        p[k] = r * a + p[k] * (1 - a);
        p[k + 1] = g * a + p[k + 1] * (1 - a);
        p[k + 2] = b * a + p[k + 2] * (1 - a);
        p[k + 3] = a + p[k + 3] * (1 - a);
      }
    }
  }

  /** 8-bit straight RGBA. */
  toRGBA() {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const p = this.px;
    for (let i = 0; i < out.length; i += 4) {
      const a = p[i + 3];
      out[i + 3] = Math.round(a * 255);
      if (a > 0) for (let j = 0; j < 3; j++) out[i + j] = Math.round((p[i + j] / a) * 255);
    }
    return out;
  }
}

// ---- coverage masks -------------------------------------------------------------------

function bboxOf(polys, pad, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of polys) {
    for (let i = 0; i < s.length; i += 2) {
      if (s[i] < x0) x0 = s[i];
      if (s[i] > x1) x1 = s[i];
      if (s[i + 1] < y0) y0 = s[i + 1];
      if (s[i + 1] > y1) y1 = s[i + 1];
    }
  }
  x0 = Math.max(0, Math.floor(x0 - pad));
  y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(W, Math.ceil(x1 + pad));
  y1 = Math.min(H, Math.ceil(y1 + pad));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** Add the horizontal spans of one sub-row to a mask row (exact horizontal coverage). */
function addSpans(mask, py, spans) {
  const { cov, x0, w } = mask;
  const row = py * w;
  for (let i = 0; i < spans.length; i += 2) {
    const a = Math.max(spans[i] - x0, 0);
    const b = Math.min(spans[i + 1] - x0, w);
    if (b <= a) continue;
    const ia = Math.floor(a);
    const ib = Math.ceil(b) - 1;
    if (ia === ib) {
      cov[row + ia] += (b - a) / SUBROWS;
      continue;
    }
    cov[row + ia] += (ia + 1 - a) / SUBROWS;
    for (let x = ia + 1; x < ib; x++) cov[row + x] += 1 / SUBROWS;
    cov[row + ib] += (b - ib) / SUBROWS;
  }
}

function mergeSpans(list) {
  if (list.length <= 2) return list;
  const pairs = [];
  for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  pairs.sort((p, q) => p[0] - q[0]);
  const out = [pairs[0][0], pairs[0][1]];
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i][0] <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], pairs[i][1]);
    else out.push(pairs[i][0], pairs[i][1]);
  }
  return out;
}

/** Coverage of polygons filled with the nonzero rule (all subpaths together). */
function fillMask(polys, W, H) {
  const box = bboxOf(polys, 1, W, H);
  if (!box) return null;
  const mask = { ...box, cov: new Float32Array(box.w * box.h) };
  const edges = [];
  for (const s of polys) {
    const n = s.length / 2;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, ay, bx, by] = [s[2 * i], s[2 * i + 1], s[2 * j], s[2 * j + 1]];
      if (ay === by) continue;
      edges.push(ay < by ? [ay, by, ax, (bx - ax) / (by - ay), 1] : [by, ay, bx, (ax - bx) / (ay - by), -1]);
    }
  }
  for (let py = 0; py < box.h; py++) {
    for (let k = 0; k < SUBROWS; k++) {
      const y = box.y0 + py + (k + 0.5) / SUBROWS;
      const xs = [];
      for (const [ya, yb, xa, slope, dir] of edges) if (y >= ya && y < yb) xs.push([xa + (y - ya) * slope, dir]);
      if (!xs.length) continue;
      xs.sort((p, q) => p[0] - q[0]);
      const spans = [];
      let wind = 0;
      for (const [x, d] of xs) {
        const was = wind;
        wind += d;
        if (was === 0 && wind !== 0) spans.push(x);
        else if (was !== 0 && wind === 0) spans.push(x);
      }
      addSpans(mask, py, spans);
    }
  }
  return mask;
}

/** Coverage of the UNION of convex pieces (stroke segments, joins, cells): overlaps count once. */
function unionMask(pieces, W, H) {
  const box = bboxOf(pieces, 1, W, H);
  if (!box) return null;
  const mask = { ...box, cov: new Float32Array(box.w * box.h) };
  const rows = new Array(box.h * SUBROWS);
  for (const s of pieces) {
    const n = s.length / 2;
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 1; i < s.length; i += 2) {
      ymin = Math.min(ymin, s[i]);
      ymax = Math.max(ymax, s[i]);
    }
    const r0 = Math.max(0, Math.ceil((ymin - box.y0) * SUBROWS - 0.5));
    const r1 = Math.min(box.h * SUBROWS - 1, Math.floor((ymax - box.y0) * SUBROWS - 0.5));
    for (let r = r0; r <= r1; r++) {
      const y = box.y0 + (r + 0.5) / SUBROWS;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [ax, ay, bx, by] = [s[2 * i], s[2 * i + 1], s[2 * j], s[2 * j + 1]];
        if ((ay <= y) === (by <= y)) continue;
        const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (hi > lo) (rows[r] ??= []).push(lo, hi);
    }
  }
  for (let r = 0; r < rows.length; r++) if (rows[r]) addSpans(mask, Math.floor(r / SUBROWS), mergeSpans(rows[r]));
  return mask;
}

function circlePoly(cx, cy, r, minSides = 8) {
  const n = Math.max(minSides, Math.min(64, Math.ceil(r * 2.5)));
  const out = [];
  for (let k = 0; k < n; k++) out.push(cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n));
  return out;
}

/** Split a polyline into its dashes (lengths in device pixels). */
function dashed(pts, dash) {
  const period = dash.reduce((a, b) => a + b, 0);
  if (!(period > 0)) return [pts];
  const out = [];
  let cur = null;
  let idx = 0;
  let left = dash[0];
  let on = true;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    let [x, y] = [pts[i], pts[i + 1]];
    const [ex, ey] = [pts[i + 2], pts[i + 3]];
    let len = Math.hypot(ex - x, ey - y);
    while (len > 0) {
      const step = Math.min(left, len);
      const t = step / len;
      const nx = x + (ex - x) * t;
      const ny = y + (ey - y) * t;
      if (on) {
        if (!cur) cur = [x, y];
        cur.push(nx, ny);
      }
      x = nx;
      y = ny;
      len -= step;
      left -= step;
      if (left <= 1e-9) {
        if (on && cur) out.push(cur);
        cur = null;
        on = !on;
        idx = (idx + 1) % dash.length;
        left = dash[idx];
      }
    }
  }
  if (on && cur && cur.length >= 4) out.push(cur);
  return out;
}

/** Convex pieces covering a stroked polyline with round joins and caps. */
function strokePieces(pts, width, closed) {
  const r = width / 2;
  const pieces = [];
  const p = closed ? [...pts, pts[0], pts[1]] : pts;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    const L = Math.hypot(bx - ax, by - ay);
    if (L === 0) continue;
    const nx = (-(by - ay) / L) * r;
    const ny = ((bx - ax) / L) * r;
    pieces.push([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]);
  }
  if (r >= 0.35) for (let i = 0; i < p.length; i += 2) pieces.push(circlePoly(p[i], p[i + 1], r));
  return pieces;
}

// ---- text -------------------------------------------------------------------------------

const glyphCache = new Map();
function glyph(ch) {
  let g = glyphCache.get(ch);
  if (g) return g;
  const raw = GLYPHS[ch];
  if (!raw) return null;
  const [adv, left, top, w, h, hex] = raw;
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex[i], 16) / 15;
  g = { adv, left, top, w, h, a };
  glyphCache.set(ch, g);
  return g;
}

function textGlyphs(text) {
  const out = [];
  for (const ch of String(text)) {
    if (GLYPHS[ch]) out.push(glyph(ch));
    else for (const c of asciiText(ch)) out.push(glyph(GLYPHS[c] ? c : "?"));
  }
  return out;
}

/** Coverage of a line of text with its baseline starting at (x, y), size in device px. */
function textMask(glyphs, x, y, size, W, H) {
  const f = size / FONT_SIZE;
  const width = glyphs.reduce((s, g) => s + g.adv, 0) * f;
  const box = bboxOf([[x - 1, y - ASCENT * f - 1, x + width + 1, y + DESCENT * f + 1]], 1, W, H);
  if (!box) return null;
  const mask = { ...box, cov: new Float32Array(box.w * box.h) };
  const S = 3; // samples per axis per pixel
  let pen = x;
  for (const g of glyphs) {
    if (g.w) {
      const gx = pen + g.left * f;
      const gy = y + g.top * f;
      const X0 = Math.max(box.x0, Math.floor(gx));
      const X1 = Math.min(box.x0 + box.w, Math.ceil(gx + g.w * f));
      const Y0 = Math.max(box.y0, Math.floor(gy));
      const Y1 = Math.min(box.y0 + box.h, Math.ceil(gy + g.h * f));
      for (let py = Y0; py < Y1; py++) {
        for (let px = X0; px < X1; px++) {
          let sum = 0;
          for (let sy = 0; sy < S; sy++) {
            for (let sx = 0; sx < S; sx++) {
              // bilinear sample of the glyph bitmap
              const u = (px + (sx + 0.5) / S - gx) / f - 0.5;
              const v = (py + (sy + 0.5) / S - gy) / f - 0.5;
              const i0 = Math.floor(u);
              const j0 = Math.floor(v);
              const fu = u - i0;
              const fv = v - j0;
              const at = (i, j) => (i < 0 || j < 0 || i >= g.w || j >= g.h ? 0 : g.a[j * g.w + i]);
              sum += (at(i0, j0) * (1 - fu) + at(i0 + 1, j0) * fu) * (1 - fv) + (at(i0, j0 + 1) * (1 - fu) + at(i0 + 1, j0 + 1) * fu) * fv;
            }
          }
          mask.cov[(py - box.y0) * box.w + px - box.x0] += sum / (S * S);
        }
      }
    }
    pen += g.adv * f;
  }
  return mask;
}

/** Spread a mask by `r` pixels (a halo behind text). */
function dilate(mask, r) {
  const { w, h, cov } = mask;
  const out = new Float32Array(w * h);
  const R = Math.ceil(r);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          const X = x + dx;
          const Y = y + dy;
          if (X >= 0 && Y >= 0 && X < w && Y < h && cov[Y * w + X] > m) m = cov[Y * w + X];
        }
      }
      out[y * w + x] = m;
    }
  }
  return { ...mask, cov: out };
}

// ---- rasterize ----------------------------------------------------------------------------

/**
 * Paint primitives into an RGBA image: { width, height, data: Uint8ClampedArray }.
 * Options: scale (device pixels per scene pixel, default 1), background
 * (default transparent), labels (false drops non-axis labels).
 */
export function rasterize(vp, prims, { scale = 1, background, labels = true } = {}) {
  const W = Math.round(vp.width * scale);
  const H = Math.round(vp.height * scale);
  const surf = new Surface(W, H, background);
  const bg = rgb(background ?? "#fff", [1, 1, 1]);
  const sc = (s) => s.map((v) => v * scale);
  for (const p of prims) {
    if (p.t === "rects") {
      if (!p.rects.length) continue;
      const pieces = [];
      for (let i = 0; i < p.rects.length; i += 4) {
        const [x, y, w, h] = [p.rects[i] * scale, p.rects[i + 1] * scale, p.rects[i + 2] * scale, p.rects[i + 3] * scale];
        pieces.push([x, y, x + w, y, x + w, y + h, x, y + h]);
      }
      const m = unionMask(pieces, W, H);
      if (m) surf.paint(m, rgb(p.fill), p.alpha ?? 1);
    } else if (p.t === "path") {
      const subs = p.subpaths.filter((s) => s.length >= 4).map(sc);
      if (!subs.length) continue;
      if (p.fill && (p.fillAlpha ?? 1) > 0 && p.closed) {
        const m = fillMask(subs, W, H);
        if (m) surf.paint(m, rgb(p.fill), p.fillAlpha ?? 1);
      }
      if (p.stroke) {
        const width = (p.width ?? 1) * scale;
        const pieces = [];
        for (const s of subs) {
          const runs = p.dash ? dashed(p.closed ? [...s, s[0], s[1]] : s, p.dash.map((d) => d * scale)) : [s];
          for (const r of runs) pieces.push(...strokePieces(r, width, p.closed && !p.dash));
        }
        const m = unionMask(pieces, W, H);
        if (m) surf.paint(m, rgb(p.stroke), p.alpha ?? 1);
      }
    } else if (p.t === "dot") {
      const c = circlePoly(p.x * scale, p.y * scale, p.r * scale, 16);
      const fm = fillMask([c], W, H);
      if (fm) surf.paint(fm, p.fill === "background" ? bg : rgb(p.fill), 1);
      const sm = unionMask(strokePieces(c, (p.width ?? 1) * scale, true), W, H);
      if (sm) surf.paint(sm, rgb(p.stroke), 1);
    }
  }
  for (const p of prims) {
    if (p.t !== "label" || (!labels && !p.plain)) continue;
    const text = p.plain ? String(p.text) : texToText(p.tex ?? p.text ?? "");
    const gl = textGlyphs(text);
    if (!gl.length) continue;
    const size = (p.size ?? 14) * scale;
    const f = size / FONT_SIZE;
    const width = gl.reduce((s, g) => s + g.adv, 0) * f;
    const [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
    const gap = p.plain ? 2 : 6;
    let x = (p.x + ax * gap + (p.dx ?? 0)) * scale;
    const y = (p.y + ay * gap + (p.dy ?? 0)) * scale;
    if (ax < 0) x -= width;
    else if (ax === 0) x -= width / 2;
    const base = ay < 0 ? y - DESCENT * f : ay > 0 ? y + ASCENT * f : y + ((ASCENT - DESCENT) / 2) * f;
    const m = textMask(gl, x, base, size, W, H);
    if (!m) continue;
    if (!p.plain) surf.paint(dilate(m, 1.5 * scale), bg, 1);
    surf.paint(m, rgb(p.color === "currentColor" ? "#111" : p.color ?? "#111"), 1);
  }
  return { width: W, height: H, data: surf.toRGBA() };
}

// ---- PNG encoding ---------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(bytes) {
  if (typeof CompressionStream !== "function") return storedZlib(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zlib data with uncompressed (stored) deflate blocks, for platforms without CompressionStream. */
function storedZlib(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const chunk = bytes.subarray(b * 65535, Math.min(bytes.length, (b + 1) * 65535));
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = chunk.length & 0xff;
    out[o++] = chunk.length >>> 8;
    out[o++] = ~chunk.length & 0xff;
    out[o++] = (~chunk.length >>> 8) & 0xff;
    out.set(chunk, o);
    o += chunk.length;
  }
  let a = 1, s = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    s = (s + a) % 65521;
  }
  const adler = ((s << 16) | a) >>> 0;
  out[o++] = adler >>> 24;
  out[o++] = (adler >>> 16) & 0xff;
  out[o++] = (adler >>> 8) & 0xff;
  out[o++] = adler & 0xff;
  return out;
}

/** Encode RGBA pixels ({ width, height, data }) as a PNG file (async: uses CompressionStream when present). */
export async function encodePNG({ width, height, data }, { dpi } = {}) {
  // Filter each row with "Sub" (difference from the pixel to the left).
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (width * 4 + 1);
    raw[o] = 1;
    for (let i = 0; i < width * 4; i++) {
      const v = data[y * width * 4 + i];
      raw[o + 1 + i] = (v - (i >= 4 ? data[y * width * 4 + i - 4] : 0)) & 0xff;
    }
  }
  const chunks = [];
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    chunks.push(out);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  chunk("IHDR", ihdr);
  if (dpi) {
    const phys = new Uint8Array(9);
    const ppm = Math.round(dpi / 0.0254);
    new DataView(phys.buffer).setUint32(0, ppm);
    new DataView(phys.buffer).setUint32(4, ppm);
    phys[8] = 1;
    chunk("pHYs", phys);
  }
  chunk("IDAT", await zlib(raw));
  chunk("IEND", new Uint8Array(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const out = new Uint8Array(8 + chunks.reduce((s, c) => s + c.length, 0));
  out.set(sig, 0);
  let o = 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * A whole scene as PNG bytes (a Promise of a Uint8Array). Options: axes,
 * background (default transparent), scale (default 1; 2 for retina), labels,
 * colors, engine ("auto": canvas where OffscreenCanvas exists, else
 * "software"; or force either).
 */
export async function scenePNG(vp, layers, options = {}) {
  const { axes, scale = 1, engine = "auto" } = options;
  const canvas = engine === "canvas" || (engine === "auto" && typeof OffscreenCanvas === "function");
  if (canvas) {
    const c = new OffscreenCanvas(Math.round(vp.width * scale), Math.round(vp.height * scale));
    drawScene(c.getContext("2d"), vp, layers, { ...options, scale });
    const blob = await c.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const prims = [...(axes ? axesPrimitives(vp, axes === true ? {} : axes) : []), ...primitives(vp, layers, options)];
  return encodePNG(rasterize(vp, prims, options), { dpi: 96 * scale });
}
