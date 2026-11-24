// PDF back end: a scene as a one-page vector PDF, with no dependencies.
//
//   const bytes = scenePDF(vp, layers, { axes: true });   // Uint8Array
//   writeFileSync("figure.pdf", bytes);
//
// The page is the viewport, `pt` points per pixel (default 0.75, so a CSS
// pixel is a PDF point at 96 dpi). Paths, fills, dashes and opacity are
// vector; circles are Bézier ellipses. Labels use the PDF base fonts
// (Helvetica, with Symbol for ≤ ≥ π √ and Greek), so they are plain text, not
// typeset TeX: for TeX labels, export TikZ and run pdflatex.

import { primitives, axesPrimitives, ANCHOR, texToText } from "./scene.js";
import { asciiText } from "./ascii.js";

// Helvetica advance widths (per 1000 em) for WinAnsi codes 32..126.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Latin-1 characters Helvetica has in WinAnsi encoding: [code, width].
const WIN = { "²": [0xb2, 333], "³": [0xb3, 333], "¹": [0xb9, 333], "·": [0xb7, 278], "×": [0xd7, 584], "±": [0xb1, 584], "µ": [0xb5, 556], "°": [0xb0, 400], "…": [0x85, 1000] };
// Characters taken from the Symbol font: [code, width].
const SYM = {
  "≤": [0xa3, 549], "≥": [0xb3, 549], "≠": [0xb9, 549], "π": [0x70, 549], "√": [0xd6, 549], "∞": [0xa5, 713], "θ": [0x71, 521],
  "α": [0x61, 631], "β": [0x62, 549], "γ": [0x67, 411], "δ": [0x64, 494], "Δ": [0x44, 612], "ε": [0x65, 439], "λ": [0x6c, 549],
  "μ": [0x6d, 576], "σ": [0x73, 603], "φ": [0x66, 521], "ω": [0x77, 686], "∈": [0xce, 713], "∩": [0xc7, 768], "∪": [0xc8, 768],
  "→": [0xae, 987], "−": [0x2d, 549], "∓": [0xb1, 549],
};

/** Split text into runs of [font, bytes-string, width per 1000 em]. */
export function pdfTextRuns(text) {
  const runs = [];
  const push = (font, code, w) => {
    const last = runs[runs.length - 1];
    if (last && last[0] === font) {
      last[1] += String.fromCharCode(code);
      last[2] += w;
    } else runs.push([font, String.fromCharCode(code), w]);
  };
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) push("F1", c, HELV[c - 32]);
    else if (WIN[ch]) push("F1", WIN[ch][0], WIN[ch][1]);
    else if (SYM[ch]) push("F2", SYM[ch][0], SYM[ch][1]);
    else for (const a of asciiText(ch)) push("F1", a.charCodeAt(0), HELV[a.charCodeAt(0) - 32] ?? 556);
  }
  return runs;
}

const n = (v) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === "-0" ? "0" : s;
};
const pdfStr = (s) => "(" + s.replace(/[\\()]/g, (c) => "\\" + c).replace(/\r/g, "\\r") + ")";

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

const K = 0.5522847498; // Bézier circle constant

function ellipsePath(cx, cy, rx, ry) {
  const ox = rx * K;
  const oy = ry * K;
  return [
    `${n(cx + rx)} ${n(cy)} m`,
    `${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)} c`,
    `${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)} c`,
    "h",
  ].join(" ");
}

/**
 * The content stream (PDF operators, in pixel coordinates under a flipped
 * transform) and the opacity states it uses, for a list of primitives.
 */
export function pdfContent(vp, prims, { background, labels = true } = {}) {
  const ops = [];
  const states = new Map(); // "ca,CA" -> name
  const gs = (fillA = 1, strokeA = 1) => {
    if (fillA === 1 && strokeA === 1) return "/GS0 gs";
    const key = `${n(fillA)},${n(strokeA)}`;
    if (!states.has(key)) states.set(key, `GS${states.size + 1}`);
    return `/${states.get(key)} gs`;
  };
  const bg = rgb(background ?? "#fff", [1, 1, 1]);
  const W = vp.width;
  const H = vp.height;
  if (background) ops.push(`${bg.map(n).join(" ")} rg 0 0 ${W} ${H} re f`);
  ops.push(`q 0 0 ${W} ${H} re W n 1 J 1 j`);
  const textOps = [];
  for (const p of prims) {
    if (p.t === "rects") {
      if (!p.rects.length) continue;
      const parts = [];
      for (let i = 0; i < p.rects.length; i += 4) parts.push(`${n(p.rects[i])} ${n(p.rects[i + 1])} ${n(p.rects[i + 2])} ${n(p.rects[i + 3])} re`);
      ops.push(`${gs(p.alpha ?? 1, 1)} ${rgb(p.fill).map(n).join(" ")} rg`, parts.join("\n"), "f");
    } else if (p.t === "path") {
      const filled = p.fill && (p.fillAlpha ?? 1) > 0;
      if (!filled && !p.stroke) continue;
      let d;
      if (p.ellipse) d = ellipsePath(...p.ellipse);
      else {
        const parts = [];
        for (const s of p.subpaths) {
          if (s.length < 4) continue;
          let seg = `${n(s[0])} ${n(s[1])} m`;
          for (let i = 2; i < s.length; i += 2) seg += ` ${n(s[i])} ${n(s[i + 1])} l`;
          if (p.closed) seg += " h";
          parts.push(seg);
        }
        if (!parts.length) continue;
        d = parts.join("\n");
      }
      // Fill and stroke separately, as the canvas does, so each has its own opacity.
      if (filled) ops.push(`${gs(p.fillAlpha ?? 1, 1)} ${rgb(p.fill).map(n).join(" ")} rg`, d, "f");
      if (p.stroke) {
        const dash = p.dash ? `[${p.dash.map(n).join(" ")}] 0 d` : "[] 0 d";
        const cap = p.role === "grid" || p.role === "axis" ? "0 J" : "1 J";
        ops.push(`${gs(1, p.alpha ?? 1)} ${rgb(p.stroke).map(n).join(" ")} RG ${n(p.width ?? 1)} w ${dash} ${cap}`, d, "S");
      }
    } else if (p.t === "dot") {
      const fill = p.fill === "background" ? bg : rgb(p.fill);
      ops.push(`/GS0 gs [] 0 d ${fill.map(n).join(" ")} rg ${rgb(p.stroke).map(n).join(" ")} RG ${n(p.width ?? 1)} w`, ellipsePath(p.x, p.y, p.r, p.r), "B");
    } else if (p.t === "label" && (labels || p.plain)) {
      textOps.push(p);
    }
  }
  ops.push("Q");
  // Labels go on top and are not clipped (like the SVG back end).
  for (const p of textOps) {
    const text = p.plain ? String(p.text) : texToText(p.tex ?? p.text ?? "");
    const runs = pdfTextRuns(text);
    const size = p.size ?? 14;
    const width = runs.reduce((a, r) => a + r[2], 0) * size / 1000;
    const [ax, ay] = ANCHOR[p.anchor] ?? ANCHOR.ne;
    const gap = p.plain ? 2 : 6;
    let x = p.x + ax * gap + (p.dx ?? 0);
    const y = p.y + ay * gap + (p.dy ?? 0);
    if (ax < 0) x -= width;
    else if (ax === 0) x -= width / 2;
    // Baseline from the anchor, using Helvetica's ascent 0.718 and descent 0.207.
    const base = ay < 0 ? y - 0.207 * size : ay > 0 ? y + 0.718 * size : y + 0.3 * size;
    const show = runs.map((r) => `/${r[0]} ${n(size)} Tf ${pdfStr(r[1])} Tj`).join(" ");
    const color = rgb(p.color === "currentColor" ? "#111" : p.color ?? "#111");
    // Text runs in a flipped frame, so the glyphs stand upright.
    const tm = `1 0 0 -1 ${n(x)} ${n(base)} Tm`;
    if (!p.plain) ops.push(`/GS0 gs BT ${tm} 1 Tr ${bg.map(n).join(" ")} RG 3 w 1 j ${show} ET`);
    ops.push(`/GS0 gs BT ${tm} 0 Tr ${color.map(n).join(" ")} rg ${show} ET`);
  }
  return { content: ops.join("\n"), states };
}

/** Assemble a one-page PDF file from a content stream. */
function pdfFile(widthPt, heightPt, scale, H, content, states, { title } = {}) {
  const stream = `${n(scale)} 0 0 ${n(-scale)} 0 ${n(H * scale)} cm\n${content}\n`;
  const ext = [`/GS0 << /Type /ExtGState /ca 1 /CA 1 >>`];
  for (const [key, name] of states) {
    const [ca, CA] = key.split(",");
    ext.push(`/${name} << /Type /ExtGState /ca ${ca} /CA ${CA} >>`);
  }
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(widthPt)} ${n(heightPt)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << ${ext.join(" ")} >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>",
    `<< /Producer (@ratmath/graphics)${title ? ` /Title ${pdfStr(String(title).replace(/[^\x20-\x7e]/g, "?"))}` : ""} >>`,
  ];
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * A whole scene as a one-page PDF (a Uint8Array). Options: axes (true or
 * axes options), background, pt (points per pixel, default 0.75), labels
 * (false drops non-axis labels), colors (layer palette), title.
 */
export function scenePDF(vp, layers, options = {}) {
  const { axes, pt = 0.75 } = options;
  const prims = [...(axes ? axesPrimitives(vp, axes === true ? {} : axes) : []), ...primitives(vp, layers, options)];
  const { content, states } = pdfContent(vp, prims, options);
  return pdfFile(vp.width * pt, vp.height * pt, pt, vp.height, content, states, options);
}
