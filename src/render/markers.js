// Point markers for features: the convention is
//   zeros                    filled, in the curve's color
//   max / min                filled, darker than the curve
//   inflection points        filled, lighter than the curve
//   holes                    open dot (the function is not defined there)
//   domain endpoints         filled when the endpoint is included, open when not
// Works for both the float estimates (quick stage) and certified features.

/** Mix a #rgb / #rrggbb / rgb() color toward black (amount < 0) or white (amount > 0). */
export function shade(color, amount) {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const t = Math.abs(amount);
  const target = amount < 0 ? 0 : 255;
  const [r, g, b] = rgb.map((c) => Math.round(c + (target - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

function parseColor(c) {
  c = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
  if (m) return [1, 2, 3].map((i) => Number(m[i]));
  return null;
}

const num = (q) => (typeof q === "number" ? q : q?.toNumber());

/** Float x of a located feature (exact point or bracket midpoint). */
function xOf(r) {
  if (typeof r === "number") return r;
  if (r.x !== undefined) return r.x;
  if (r.at) return num(r.at);
  return (num(r.lo) + num(r.hi)) / 2;
}

/** Float y of a feature's value, when it has one. */
function yOf(r) {
  if (r.y !== undefined) return r.y;
  if (r.value) return num(r.value);
  if (r.valueLo && r.valueHi) return (num(r.valueLo) + num(r.valueHi)) / 2;
  if (r.valueApprox !== undefined) return r.valueApprox;
  return undefined;
}

/**
 * The markers to draw for a features value, as
 * [{ x, y, role: "zero" | "extremum" | "inflection" | "hole" | "endpoint", filled }].
 */
export function markerList(features) {
  const out = [];
  for (const z of features.zeros ?? []) {
    if (typeof z === "number" || z.kind === "exact" || z.kind === "sign-change") out.push({ x: xOf(z), y: 0, role: "zero", filled: true });
  }
  for (const e of features.extrema ?? []) {
    if (e.kind === "max" || e.kind === "min") out.push({ x: xOf(e), y: yOf(e), role: "extremum", filled: true });
  }
  for (const i of features.inflections ?? []) {
    if (i.kind === "possible") continue;
    out.push({ x: xOf(i), y: yOf(i), role: "inflection", filled: true });
  }
  for (const h of features.holes ?? []) out.push({ x: xOf(h), y: yOf(h), role: "hole", filled: false });
  for (const e of features.endpoints ?? []) {
    const y = yOf(e);
    if (y !== undefined) out.push({ x: xOf(e), y, role: "endpoint", filled: !!e.included });
  }
  return out.filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y));
}

/**
 * Draw feature markers on a canvas. `vp` is the viewport (from `viewport()`),
 * `color` the curve's color, `background` the color inside open dots.
 */
export function drawMarkers(ctx2d, vp, features, { color = "#2563eb", background = "#ffffff", scale = 1, radius = 4.5 } = {}) {
  const fill = { zero: color, extremum: shade(color, -0.45), inflection: shade(color, 0.5), hole: background, endpoint: color };
  ctx2d.save();
  for (const m of markerList(features)) {
    const px = ((m.x - vp.f.xmin) / (vp.f.xmax - vp.f.xmin)) * vp.width * scale;
    const py = ((vp.f.ymax - m.y) / (vp.f.ymax - vp.f.ymin)) * vp.height * scale;
    if (px < -radius * scale || px > (vp.width + radius) * scale || py < -radius * scale || py > (vp.height + radius) * scale) continue;
    ctx2d.beginPath();
    ctx2d.arc(px, py, radius * scale, 0, 2 * Math.PI);
    ctx2d.fillStyle = m.filled ? fill[m.role] : background;
    ctx2d.fill();
    ctx2d.lineWidth = 1.5 * scale;
    ctx2d.strokeStyle = m.filled ? (m.role === "inflection" ? color : fill[m.role]) : color;
    ctx2d.stroke();
  }
  ctx2d.restore();
}
