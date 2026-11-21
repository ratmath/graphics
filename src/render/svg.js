// Serialize a stage value to an SVG string (export, tests, server rendering).

export function toSVG(value, { width = value.width, height = value.height, color = "#2563eb", lineWidth = 2, background } = {}) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  if (background) parts.push(`<rect width="${width}" height="${height}" fill="${background}"/>`);
  if (value.kind === "polyline") {
    let d = "";
    let pen = false;
    const p = value.points;
    for (let i = 0; i < p.length; i += 2) {
      if (Number.isNaN(p[i])) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${round(p[i])} ${round(p[i + 1])}`;
      pen = true;
    }
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else if (value.kind === "cells") {
    // One path of unit-width rectangles keeps the file small.
    let d = "";
    value.columns.forEach((s, i) => {
      if (!s) return;
      for (let j = 0; j < s.length; j += 2) d += `M${i} ${s[j]}h1v${s[j + 1] - s[j] + 1}h-1z`;
    });
    parts.push(`<path d="${d}" fill="${color}" shape-rendering="crispEdges"/>`);
  }
  for (const a of value.asymptotes ?? []) {
    const x = Math.round(a.px * 100) / 100;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${color}" stroke-width="1" stroke-dasharray="${a.certain ? "6 4" : "2 4"}" opacity="${a.certain ? 0.9 : 0.45}"/>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

function round(v) {
  return Math.round(v * 100) / 100;
}
