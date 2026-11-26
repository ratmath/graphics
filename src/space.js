// Three dimensions: surfaces z = f(x, y), parametric surfaces, space curves,
// points, arrows and a box of axes, projected to the plane.
//
// A 3D object is evaluated once (float preview, then certified values at the
// grid points) and kept in space coordinates. `project3d(camera, items)` turns
// any mix of them into one "mesh" frame: faces and strokes in plane
// coordinates, sorted from far to near, which drawScene and every exporter
// paint like any other layer. Turning the camera only repeats the projection.
//
//   const cam = camera({ azimuth: 35, elevation: 25 });
//   const s = surface("sin(x)*cos(y)", {}, { x: [-3, 3], y: [-3, 3] });
//   const c = spaceCurve(["cos(t)", "sin(t)", "t/4"], {}, { t: [0, 12] });
//   const vp = spaceViewport(600, 450);
//   drawScene(ctx, vp, [project3d(cam, [s.quick.value, c.quick.value], { axes: true })]);

import { Rational } from "@ratmath/core";
import { Refinement } from "@ratmath/core/refine";
import { differentiate } from "@ratmath/analytic";
import { compileFloat, compileInterval, paramsToFloat, paramsToIntervals, paramsToRational, toAst, toRational } from "./expr.js";
import * as I from "./interval.js";
import { viewport as makeViewport } from "./viewport.js";
import { shade } from "./render/markers.js";

const DEG = Math.PI / 180;

/**
 * A camera looking at the scene's centre. `azimuth` turns it around the
 * vertical axis and `elevation` lifts it above the horizontal plane, both in
 * degrees. `distance` is how far the eye is, in half-widths of the scene box
 * (Infinity, the default, gives a parallel projection). `zoom` scales the
 * picture.
 */
export function camera({ azimuth = 35, elevation = 25, distance = Infinity, zoom = 1 } = {}) {
  return { azimuth, elevation: Math.max(-90, Math.min(90, elevation)), distance, zoom };
}

/** The camera after a drag of (dx, dy) pixels: a turn and a tilt. */
export function orbit(cam, dx, dy, { speed = 0.5 } = {}) {
  return camera({ ...cam, azimuth: cam.azimuth - dx * speed, elevation: cam.elevation + dy * speed });
}

/** A viewport that fits a projected scene: the unit cube stays inside at any angle. */
export function spaceViewport(width = 600, height = 450) {
  const r = 1.85;
  const ax = width >= height ? (r * width) / height : r;
  const ay = width >= height ? r : (r * height) / width;
  const q = (x) => new Rational(BigInt(Math.round(x * 1000)), 1000n);
  return makeViewport({ x: [q(-ax), q(ax)], y: [q(-ay), q(ay)], width, height });
}

const rangeOf = (r) => r.map((x) => toRational(x));

function evaluator(asts, names, params) {
  const rp = paramsToRational(params);
  const fp = { ...paramsToFloat(rp) };
  const floats = asts.map((a) => compileFloat(a, names[0]));
  return {
    rp,
    float(u, w) {
      if (names[1]) fp[names[1]] = w;
      return floats.map((f) => f(u, fp));
    },
  };
}

/** Certified values of the trees at exact parameter values: [mid, halfWidth] per tree, NaN where undefined. */
function certifier(asts, names, params, bits) {
  const rp = paramsToRational(params);
  const ctx = I.context(bits);
  const base = paramsToIntervals(ctx, rp);
  const ivs = asts.map((a) => compileInterval(a, names[0]));
  const one = Number(ctx.one);
  return (u, w) => {
    const U = I.fromRational(ctx, u.numerator, u.denominator);
    const P = names[1] ? { ...base, [names[1]]: I.fromRational(ctx, w.numerator, w.denominator) } : base;
    return ivs.map((f) => {
      let iv = null;
      try {
        iv = f(ctx, U, P);
      } catch {
        iv = null;
      }
      if (!iv || !I.isFinite(iv.lo) || !I.isFinite(iv.hi)) return [NaN, NaN];
      return [Number(iv.lo + iv.hi) / (2 * one), Number(iv.hi - iv.lo) / (2 * one)];
    });
  };
}

function gridSurface(asts, names, params, [u0, u1], [v0, v1], nu, nv) {
  const ev = evaluator(asts, names, params);
  const [a, b, c, d] = [u0, u1, v0, v1].map((q) => q.toNumber());
  const points = new Float64Array(3 * (nu + 1) * (nv + 1));
  let k = 0;
  for (let j = 0; j <= nv; j += 1) {
    for (let i = 0; i <= nu; i += 1) {
      const [x, y, z] = ev.float(a + ((b - a) * i) / nu, c + ((d - c) * j) / nv);
      points[k++] = x; points[k++] = y; points[k++] = z;
    }
  }
  return { kind: "surface3d", nu, nv, points };
}

function surfaceRefinement(asts, names, params, uRange, vRange, { grid = 36, preview = 20, bits = 48, graph = false } = {}) {
  const [nu, nv] = Array.isArray(grid) ? grid : [grid, grid];
  return new Refinement(
    () => ({ value: { ...gridSurface(asts, names, params, uRange, vRange, Math.min(nu, preview), Math.min(nv, preview)), graph }, trust: "rough" }),
    function* () {
      const at = certifier(asts, names, params, bits);
      const points = new Float64Array(3 * (nu + 1) * (nv + 1));
      let error = 0;
      let undefinedCount = 0;
      const du = uRange[1].subtract(uRange[0]).divide(new Rational(BigInt(nu)));
      const dv = vRange[1].subtract(vRange[0]).divide(new Rational(BigInt(nv)));
      let k = 0;
      for (let j = 0; j <= nv; j += 1) {
        const w = vRange[0].add(dv.multiply(new Rational(BigInt(j))));
        for (let i = 0; i <= nu; i += 1) {
          const u = uRange[0].add(du.multiply(new Rational(BigInt(i))));
          const vals = at(u, w);
          for (const [m, r] of vals) {
            points[k++] = m;
            if (Number.isNaN(m)) undefinedCount += 1;
            else if (r > error) error = r;
          }
        }
        yield { done: j + 1, of: nv + 1, step: "row" };
      }
      return { value: { kind: "surface3d", nu, nv, points, graph, certified: true, error, undefined: undefinedCount }, via: "interval-grid" };
    },
  );
}

/**
 * The surface z = f(x, y) over a rectangle, as a Refinement. quick: a float
 * grid. exact: a finer grid whose every vertex is certified: its height is
 * within `error` of the true value (vertices where f is undefined are left
 * out). Options: grid (cells per side, or [nx, ny]), variables, bits.
 */
export function surface(f, params = {}, { x = [-3, 3], y = [-3, 3], variables = ["x", "y"], ...options } = {}) {
  const [xn, yn] = variables;
  const X = { type: "var", name: xn };
  const Y = { type: "var", name: yn };
  return surfaceRefinement([X, Y, toAst(f)], [xn, yn], params, rangeOf(x), rangeOf(y), { ...options, graph: true });
}

/**
 * A parametric surface (x(u, v), y(u, v), z(u, v)) as a Refinement, like
 * surface(). A sphere: parametricSurface(["cos(u)*sin(v)", "sin(u)*sin(v)",
 * "cos(v)"], {}, { u: [0, "6.2832"], v: [0, "3.1416"] }).
 */
export function parametricSurface(xyz, params = {}, { u = [0, 1], v = [0, 1], variables = ["u", "v"], ...options } = {}) {
  if (!Array.isArray(xyz) || xyz.length !== 3) throw new RangeError("parametricSurface needs three expressions");
  return surfaceRefinement(xyz.map(toAst), variables, params, rangeOf(u), rangeOf(v), options);
}

/**
 * A space curve (x(t), y(t), z(t)) as a Refinement: a float polyline first,
 * then certified points (each within `error` of the curve).
 */
export function spaceCurve(xyz, params = {}, { t = [0, 1], variable = "t", samples = 400, bits = 48 } = {}) {
  if (!Array.isArray(xyz) || xyz.length !== 3) throw new RangeError("spaceCurve needs three expressions");
  const asts = xyz.map(toAst);
  const [t0, t1] = rangeOf(t);
  return new Refinement(
    () => {
      const ev = evaluator(asts, [variable], params);
      const n = Math.min(samples, 200);
      const points = new Float64Array(3 * (n + 1));
      for (let i = 0; i <= n; i += 1) points.set(ev.float(t0.toNumber() + ((t1.toNumber() - t0.toNumber()) * i) / n), 3 * i);
      return { value: { kind: "curve3d", points }, trust: "rough" };
    },
    function* () {
      const at = certifier(asts, [variable], params, bits);
      const points = new Float64Array(3 * (samples + 1));
      const dt = t1.subtract(t0).divide(new Rational(BigInt(samples)));
      let error = 0;
      for (let i = 0; i <= samples; i += 1) {
        const vals = at(t0.add(dt.multiply(new Rational(BigInt(i)))));
        vals.forEach(([m, r], c) => {
          points[3 * i + c] = m;
          if (r > error) error = r;
        });
        if (i % 64 === 0) yield { done: i, of: samples, step: "point" };
      }
      return { value: { kind: "curve3d", points, certified: true, error }, via: "interval-points" };
    },
  );
}

const triple = (p) => p.map((x) => (typeof x === "number" ? x : toRational(x).toNumber()));

/** Dots at points in space. */
export const points3d = (list) => ({ kind: "points3d", points: Float64Array.from(list.flatMap(triple)) });
/** A segment between two points in space. */
export const segment3d = (a, b) => ({ kind: "curve3d", points: Float64Array.from([...triple(a), ...triple(b)]) });
/** An arrow from one point in space to another. */
export const arrow3d = (from, to) => ({ kind: "arrow3d", points: Float64Array.from([...triple(from), ...triple(to)]) });

/**
 * The tangent plane to z = f(x, y) at (x0, y0): { point, normal, gradient,
 * plane, layers }. `plane` is a small surface patch of half-width `size`,
 * `layers` holds it with the point of contact and the normal arrow, ready
 * for project3d().
 */
export function tangentPlane(f, at, params = {}, { size = 1, variables = ["x", "y"], normalLength = 1 } = {}) {
  const [xn, yn] = variables;
  const ast = toAst(f);
  const fp = { ...paramsToFloat(paramsToRational(params)) };
  const [x0, y0] = at.map((q) => toRational(q).toNumber());
  const val = (tree) => {
    fp[yn] = y0;
    return compileFloat(tree, xn)(x0, fp);
  };
  const z0 = val(ast);
  const fx = val(differentiate(ast, xn));
  const fy = val(differentiate(ast, yn));
  const pts = [];
  for (const dy of [-size, size]) for (const dx of [-size, size]) pts.push(x0 + dx, y0 + dy, z0 + fx * dx + fy * dy);
  const plane = { kind: "surface3d", nu: 1, nv: 1, points: Float64Array.from(pts) };
  const len = Math.hypot(fx, fy, 1);
  const normal = [-fx / len, -fy / len, 1 / len];
  const point = [x0, y0, z0];
  return {
    point, gradient: [fx, fy], normal, plane,
    layers: [{ item: plane, color: "#ea580c", opacity: 0.55, wire: true }, { item: points3d([point]), color: "#111827" }, { item: arrow3d(point, point.map((c, i) => c + normal[i] * normalLength)), color: "#111827" }],
  };
}

// ---- projection ------------------------------------------------------------------------

function extent(items) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const { item } of items) {
    const p = item.points ?? Float64Array.from((item.faces ?? []).flatMap((f) => [...f]));
    for (let i = 0; i < p.length; i += 3) {
      for (let c = 0; c < 3; c += 1) {
        const x = p[i + c];
        if (!Number.isFinite(x)) continue;
        if (x < lo[c]) lo[c] = x;
        if (x > hi[c]) hi[c] = x;
      }
    }
  }
  for (let c = 0; c < 3; c += 1) {
    if (!(lo[c] <= hi[c])) { lo[c] = -1; hi[c] = 1; }
    if (lo[c] === hi[c]) { lo[c] -= 1; hi[c] += 1; }
  }
  return { x: [lo[0], hi[0]], y: [lo[1], hi[1]], z: [lo[2], hi[2]] };
}

const niceTicks = (a, b) => {
  const raw = (b - a) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let t = Math.ceil(a / step - 1e-9) * step; t <= b + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return out;
};
const tickText = (t) => String(Number(t.toPrecision(6))).replace("-", "−");

/**
 * Project 3D items to one mesh frame for drawScene, sceneSVG and the other
 * exporters. An item is a frame from surface(), parametricSurface(),
 * spaceCurve(), points3d(), segment3d() or arrow3d(), or { item, color,
 * opacity, wire, width, shading } for a style. Options:
 *   box      { x: [a, b], y: [c, d], z: [e, f] } to fix the scene's extent
 *            (default: what the items span); heights outside z are clipped
 *   axes     true for a box with ticks on three edges (or { color, labels })
 *   light    direction to the light, default [-1, -1, 2]
 * The scene's box is drawn as a cube, whatever its three ranges are.
 */
export function project3d(cam, items, { box, axes = false, light = [-1, -1, 2], colors = ["#2563eb", "#dc2626", "#0f766e", "#9333ea", "#ea580c", "#0891b2"] } = {}) {
  const list = items.filter(Boolean).map((it, i) => {
    const wrapped = it.item !== undefined && typeof it.kind !== "string";
    return { item: wrapped ? it.item : it, style: wrapped ? it : {}, color: (wrapped ? it.color : null) ?? colors[i % colors.length] };
  });
  const ext = extent(list);
  const B = { x: (box?.x ?? ext.x).map(Number), y: (box?.y ?? ext.y).map(Number), z: (box?.z ?? ext.z).map(Number) };
  const norm = (v, [a, b]) => (2 * (v - a)) / (b - a) - 1;
  const az = cam.azimuth * DEG;
  const el = cam.elevation * DEG;
  const [ca, sa, ce, se] = [Math.cos(az), Math.sin(az), Math.cos(el), Math.sin(el)];
  const d = cam.distance;
  /** Space coordinates to [screen x, screen y, depth toward the eye]. */
  const proj = (x, y, z) => {
    const X = norm(x, B.x);
    const Y = norm(y, B.y);
    const Z = Math.max(-1.0001, Math.min(1.0001, norm(z, B.z)));
    const forward = ca * X + sa * Y;
    const sx = -sa * X + ca * Y;
    const sy = -se * forward + ce * Z;
    const depth = ce * forward + se * Z;
    const k = Number.isFinite(d) ? d / (d - depth) : 1;
    return [sx * k * cam.zoom, sy * k * cam.zoom, depth];
  };
  const L = Math.hypot(...light);
  const lightDir = light.map((c) => c / L);
  const eye = [ce * ca, ce * sa, se];
  const faces = [];
  const labels = [];

  for (const { item, style, color } of list) {
    const p = item.points;
    if (item.kind === "surface3d") {
      const { nu, nv } = item;
      const opacity = style.opacity ?? 0.92;
      const wire = style.wire ?? true;
      const twoSided = style.twoSided ?? Boolean(item.graph);
      const at = (i, j) => 3 * (j * (nu + 1) + i);
      for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
          const idx = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
          if (idx.some((o) => !Number.isFinite(p[o]) || !Number.isFinite(p[o + 1]) || !Number.isFinite(p[o + 2]))) continue;
          const zs = idx.map((o) => p[o + 2]);
          if (zs.every((z) => z > B.z[1]) || zs.every((z) => z < B.z[0])) continue;
          const pr = idx.map((o) => proj(p[o], p[o + 1], p[o + 2]));
          // the normal in the scaled box, for shading
          const n3 = (o) => [norm(p[o], B.x), norm(p[o + 1], B.y), norm(p[o + 2], B.z)];
          const [A, Bq, C, D] = idx.map(n3);
          const u = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
          const w = [D[0] - Bq[0], D[1] - Bq[1], D[2] - Bq[2]];
          let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
          const nl = Math.hypot(...n) || 1;
          n = n.map((c) => c / nl);
          const facing = n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2];
          if (facing < 0) n = n.map((c) => -c);
          const lit = Math.max(0, n[0] * lightDir[0] + n[1] * lightDir[1] + n[2] * lightDir[2]);
          let base = style.cellColors?.[j * nu + i] ?? color;
          if (style.shading === "height") {
            const t = Math.max(0, Math.min(1, (zs.reduce((s, z) => s + z, 0) / 4 - B.z[0]) / (B.z[1] - B.z[0])));
            base = heightColor(t);
          }
          // the underside of a graph is drawn darker so that its two sides read apart
          const fill = shade(base, (twoSided && facing < 0 ? -0.22 : 0) + (lit - 0.5) * 0.6);
          faces.push({
            depth: pr.reduce((s, q) => s + q[2], 0) / 4,
            points: Float64Array.from(pr.flatMap((q) => [q[0], q[1]])), closed: true, fill, fillAlpha: opacity,
            stroke: wire ? shade(base, -0.45) : fill, width: wire ? 0.5 : 0.6, alpha: wire ? 0.55 : opacity,
          });
        }
      }
    } else if (item.kind === "faces3d") {
      // flat polygons (a polyhedron's faces), each [x, y, z, x, y, z, …], lit and depth-sorted
      const opacity = style.opacity ?? 0.9;
      item.faces.forEach((F, k) => {
        const pr = [];
        for (let i = 0; i < F.length; i += 3) pr.push(proj(F[i], F[i + 1], F[i + 2]));
        const n3 = (i) => [norm(F[i], B.x), norm(F[i + 1], B.y), norm(F[i + 2], B.z)];
        const [A, Bq, C] = [n3(0), n3(3), n3(6)];
        const u = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]];
        const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const nl = Math.hypot(...n) || 1;
        n = n.map((c) => c / nl);
        if (n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2] < 0) n = n.map((c) => -c);
        const lit = Math.max(0, n[0] * lightDir[0] + n[1] * lightDir[1] + n[2] * lightDir[2]);
        const base = item.colors?.[k] ?? color;
        const fill = shade(base, (lit - 0.5) * 0.5);
        faces.push({ depth: pr.reduce((s, q) => s + q[2], 0) / pr.length, points: Float64Array.from(pr.flatMap((q) => [q[0], q[1]])), closed: true, fill, fillAlpha: opacity, stroke: shade(base, -0.5), width: style.width ?? 1, alpha: 1 });
      });
    } else if (item.kind === "curve3d" || item.kind === "arrow3d") {
      const width = style.width ?? 2;
      for (let i = 0; i + 5 < p.length; i += 3) {
        if (![p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]].every(Number.isFinite)) continue;
        const a = proj(p[i], p[i + 1], p[i + 2]);
        const b = proj(p[i + 3], p[i + 4], p[i + 5]);
        faces.push({ depth: (a[2] + b[2]) / 2 + 0.01, points: Float64Array.from([a[0], a[1], b[0], b[1]]), stroke: color, width, dash: style.dash });
        if (item.kind === "arrow3d") {
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const ux = (b[0] - a[0]) / len;
          const uy = (b[1] - a[1]) / len;
          const h = Math.min(0.09, len * 0.4);
          faces.push({ depth: b[2] + 0.02, points: Float64Array.from([b[0], b[1], b[0] - ux * h - uy * h * 0.4, b[1] - uy * h + ux * h * 0.4, b[0] - ux * h + uy * h * 0.4, b[1] - uy * h - ux * h * 0.4]), closed: true, fill: color, stroke: color, width: 1 });
        }
      }
    } else if (item.kind === "points3d") {
      for (let i = 0; i < p.length; i += 3) {
        const a = proj(p[i], p[i + 1], p[i + 2]);
        faces.push({ depth: a[2] + 0.03, points: Float64Array.from([a[0], a[1]]), dot: true, fill: color, radius: style.radius });
      }
    } else throw new TypeError(`project3d cannot draw ${item.kind ?? typeof item}`);
  }

  if (axes) {
    const o = axes === true ? {} : axes;
    const col = o.color ?? "#9ca3af";
    const text = o.text ?? "#6b7280";
    const names = o.labels ?? ["x", "y", "z"];
    // the bottom edges nearest the eye carry the x and y ticks; the z ticks go on a side edge
    const xs = B.x;
    const ys = B.y;
    const zs = B.z;
    const nearX = ca >= 0 ? xs[1] : xs[0];
    const nearY = sa >= 0 ? ys[1] : ys[0];
    const farX = ca >= 0 ? xs[0] : xs[1];
    const farY = sa >= 0 ? ys[0] : ys[1];
    const zBase = se >= 0 ? zs[0] : zs[1];
    const edge = (a, b, depthShift = -5) => {
      const A = proj(...a);
      const Bp = proj(...b);
      faces.push({ depth: depthShift, points: Float64Array.from([A[0], A[1], Bp[0], Bp[1]]), stroke: col, width: 1 });
    };
    // the three faces behind the scene
    for (const z of zs) {
      edge([xs[0], farY, z], [xs[1], farY, z]);
      edge([farX, ys[0], z], [farX, ys[1], z]);
    }
    for (const x of xs) edge([x, farY, zs[0]], [x, farY, zs[1]]);
    edge([farX, nearY, zs[0]], [farX, nearY, zs[1]]);
    edge([xs[0], nearY, zBase], [xs[1], nearY, zBase]);
    edge([nearX, ys[0], zBase], [nearX, ys[1], zBase]);
    const out = (pt, dx, dy) => { const q = proj(...pt); return [q[0] + dx, q[1] + dy]; };
    const lab = (pt, textValue, anchor, bold = false) => labels.push({ x: pt[0], y: pt[1], tex: textValue.replace("−", "-"), text: textValue, anchor, color: text, size: bold ? 13 : 11 });
    const sy = se >= 0 ? -0.09 : 0.09;
    for (const t of niceTicks(...xs)) lab(out([t, nearY, zBase], 0, sy), tickText(t), "c");
    for (const t of niceTicks(...ys)) lab(out([nearX, t, zBase], 0, sy), tickText(t), "c");
    lab(out([(xs[0] + xs[1]) / 2, nearY, zBase], 0, 2.4 * sy), names[0], "c", true);
    lab(out([nearX, (ys[0] + ys[1]) / 2, zBase], 0, 2.4 * sy), names[1], "c", true);
    // z ticks on the vertical edge that shows at the left of the picture
    const corners = [[xs[0], ys[0]], [xs[0], ys[1]], [xs[1], ys[0]], [xs[1], ys[1]]];
    const leftmost = corners.reduce((best, c) => (proj(c[0], c[1], zs[0])[0] < proj(best[0], best[1], zs[0])[0] ? c : best));
    edge([leftmost[0], leftmost[1], zs[0]], [leftmost[0], leftmost[1], zs[1]]);
    for (const t of niceTicks(...zs)) lab(out([leftmost[0], leftmost[1], t], -0.07, 0), tickText(t), "w");
    lab(out([leftmost[0], leftmost[1], (zs[0] + zs[1]) / 2], -0.3, 0), names[2], "w", true);
  }

  faces.sort((a, b) => a.depth - b.depth);
  return { kind: "mesh", faces, labels, box: B, camera: cam };
}

/** A blue-to-yellow ramp for heights, t in [0, 1]. */
function heightColor(t) {
  const stops = [[49, 54, 149], [33, 144, 141], [94, 201, 98], [253, 231, 37]];
  const s = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - s;
  const c = stops[s].map((a, i) => Math.round(a + (stops[s + 1][i] - a) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
