// Draw a stage value onto a 2D canvas context (browser or worker
// OffscreenCanvas). The canvas is assumed to be width x height CSS pixels,
// scaled by `scale` device pixels (pass devicePixelRatio).

export function drawCanvas(ctx2d, value, { color = "#2563eb", lineWidth = 2, scale = 1, cellAlpha = 1 } = {}) {
  if (!value) return;
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
    for (let i = 0; i < cols.length; i++) {
      const s = cols[i];
      if (!s) continue;
      for (let j = 0; j < s.length; j += 2) {
        ctx2d.fillRect(i * scale, s[j] * scale, scale, (s[j + 1] - s[j] + 1) * scale);
      }
    }
    ctx2d.restore();
  }
}
