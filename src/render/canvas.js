// Draw a stage value onto a 2D canvas context (browser or worker
// OffscreenCanvas). The canvas is assumed to be width x height CSS pixels,
// scaled by `scale` device pixels (pass devicePixelRatio).

export function drawCanvas(ctx2d, value, { color = "#2563eb", lineWidth = 2, scale = 1, cellAlpha = 1, asymptoteColor = color } = {}) {
  if (!value) return;
  drawGraph(ctx2d, value, { color, lineWidth, scale, cellAlpha });
  drawAsymptotes(ctx2d, value, { color: asymptoteColor, scale });
}

/**
 * Dashed vertical lines at asymptotes. Certified poles get a dashed line;
 * float estimates and unsettled spots a fainter dotted one.
 */
export function drawAsymptotes(ctx2d, value, { color = "#2563eb", scale = 1 } = {}) {
  const list = value.asymptotes;
  if (!list || !list.length) return;
  const h = (value.height ?? ctx2d.canvas.height / scale) * scale;
  ctx2d.save();
  ctx2d.strokeStyle = color;
  for (const a of list) {
    const x = Math.round(a.px * scale) + 0.5;
    ctx2d.lineWidth = Math.max(1, scale);
    ctx2d.globalAlpha = a.certain ? 0.9 : 0.45;
    ctx2d.setLineDash(a.certain ? [6 * scale, 4 * scale] : [2 * scale, 4 * scale]);
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, h);
    ctx2d.stroke();
  }
  ctx2d.restore();
}

function drawGraph(ctx2d, value, { color, lineWidth, scale, cellAlpha }) {
  if (value.kind === "polyline") {
    const p = value.points;
    ctx2d.save();
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = lineWidth * scale;
    ctx2d.lineJoin = "round";
    ctx2d.lineCap = "round";
    ctx2d.beginPath();
    let pen = false;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i];
      const y = p[i + 1];
      if (Number.isNaN(x)) {
        pen = false;
        continue;
      }
      if (pen) ctx2d.lineTo(x * scale, y * scale);
      else ctx2d.moveTo(x * scale, y * scale);
      pen = true;
    }
    ctx2d.stroke();
    ctx2d.restore();
    return;
  }
  if (value.kind === "cells") {
    ctx2d.save();
    ctx2d.fillStyle = color;
    ctx2d.globalAlpha = cellAlpha;
    const cols = value.columns;
    // A column holding a certified pole is filled top to bottom (the graph
    // really passes through it); draw it faint so the dashed line reads.
    // Interval arithmetic cannot bound f tightly in the column of a hole
    // either (x/x over an interval holding 0), so that column is tall too;
    // draw it faint and let the hole marker show the missing point.
    // Columns are closed intervals, so a point on a column edge is in both.
    const colsOf = (list) => new Set(list.flatMap((a) => {
      const c = Math.floor(a.px);
      return Math.abs(a.px - Math.round(a.px)) < 1e-9 ? [Math.round(a.px) - 1, Math.round(a.px)] : [c];
    }));
    const poleCols = colsOf((value.asymptotes ?? []).filter((a) => a.certain));
    const holeCols = colsOf(value.holes ?? []);
    for (let i = 0; i < cols.length; i++) {
      const s = cols[i];
      if (!s) continue;
      const faint = holeCols.has(i) || (poleCols.has(i) && s.length === 2 && s[1] - s[0] + 1 >= value.height);
      ctx2d.globalAlpha = faint ? cellAlpha * 0.2 : cellAlpha;
      for (let j = 0; j < s.length; j += 2) {
        ctx2d.fillRect(i * scale, s[j] * scale, scale, (s[j + 1] - s[j] + 1) * scale);
      }
    }
    ctx2d.restore();
  }
}
