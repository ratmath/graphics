// Pictures for the extensions of analytic (roadmap section 13):
//
// Differential equations (13.1)
//   phasePortrait       direction arrows, nullclines, orbits and the
//                       equilibria of x′ = f(x, y), y′ = g(x, y), each
//                       equilibrium proved by analytic's planarSystem and
//                       labelled with its kind
//   solutionFrames      u(x, t) at a list of times, for animating heat and
//                       wave solutions
// Differential geometry (13.2)
//   frameAlongCurve     a plane curve with its unit tangent, normal and
//                       osculating circle at a parameter value (certified
//                       values, drawn as doubles); frameFrames animates it
//   curvatureSurface    a parametric surface coloured by Gaussian (or mean)
//                       curvature: red where K > 0, blue where K < 0
//   curveOnSurface      a path (u(t), v(t)) drawn on that surface (a geodesic
//                       or the path of a transported vector)
// Numerical analysis (13.3)
//   newtonFigure        Newton's method: each tangent line and where it meets
//                       the axis
//   interpolationFigure a function, its interpolating polynomial through the
//                       nodes, and the error (Runge's phenomenon)
//   quadratureFigure    the trapezoids, rectangles or parabolas of a rule
//   stabilityRegion     where |R(z)| ≤ 1 for a one-step method's stability
//                       function R, on a grid of the complex plane
//   convergenceFigure   errors against step size on log scales, with the
//                       observed order

import { curve as geoCurve, surface as geoSurface, planarSystem, format } from "@ratmath/analytic";
import { compileFloat, parse } from "./expr.js";
import { figure, shapes, path, dot, text, arrow, image, extentOf, divergingColor, toNumber, CATEGORY } from "./figure.js";
import { camera, project3d } from "./space.js";

const num = toNumber;
const f1 = (expr, v = "x") => {
  const g = compileFloat(parse(String(expr)), v);
  return (x) => g(x, {});
};
const f2 = (expr, [a, b] = ["x", "y"]) => {
  const g = compileFloat(parse(String(expr)), a);
  return (x, y) => g(x, { [b]: y });
};

// ---- differential equations -------------------------------------------------------------------

/** Zero contours of F on a grid, by marching squares: a list of segments [x1, y1, x2, y2]. */
export function zeroContour(F, X, Y, n = 80) {
  const [nx, ny] = [n, Math.round((n * (Y[1] - Y[0])) / (X[1] - X[0])) || n];
  const xs = Array.from({ length: nx + 1 }, (_, i) => X[0] + ((X[1] - X[0]) * i) / nx);
  const ys = Array.from({ length: ny + 1 }, (_, j) => Y[0] + ((Y[1] - Y[0]) * j) / ny);
  const v = ys.map((y) => xs.map((x) => F(x, y)));
  const segs = [];
  const lerp = (a, b, fa, fb) => a + ((b - a) * fa) / (fa - fb);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = [v[j][i], v[j][i + 1], v[j + 1][i + 1], v[j + 1][i]];
      if (!c.every(Number.isFinite)) continue;
      const P = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
      const hits = [];
      for (let k = 0; k < 4; k++) {
        const a = c[k];
        const b = c[(k + 1) % 4];
        if ((a < 0) !== (b < 0)) {
          const [p, q] = [P[k], P[(k + 1) % 4]];
          hits.push([lerp(p[0], q[0], a, b), lerp(p[1], q[1], a, b)]);
        }
      }
      if (hits.length === 2) segs.push([...hits[0], ...hits[1]]);
      else if (hits.length === 4) segs.push([...hits[0], ...hits[1]], [...hits[2], ...hits[3]]);
    }
  return segs;
}

function rk4Path(F, G, start, { dt, steps, X, Y }) {
  const out = [start];
  let [x, y] = start;
  for (let s = 0; s < steps; s++) {
    const k1 = [F(x, y), G(x, y)];
    const k2 = [F(x + (dt / 2) * k1[0], y + (dt / 2) * k1[1]), G(x + (dt / 2) * k1[0], y + (dt / 2) * k1[1])];
    const k3 = [F(x + (dt / 2) * k2[0], y + (dt / 2) * k2[1]), G(x + (dt / 2) * k2[0], y + (dt / 2) * k2[1])];
    const k4 = [F(x + dt * k3[0], y + dt * k3[1]), G(x + dt * k3[0], y + dt * k3[1])];
    x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    out.push([x, y]);
    const w = X[1] - X[0];
    const h = Y[1] - Y[0];
    if (x < X[0] - w || x > X[1] + w || y < Y[0] - h || y > Y[1] + h) break;
  }
  return out;
}

/**
 * A phase portrait of x′ = f, y′ = g over the window x × y. field is [f, g]
 * as text (or analytic's PlanarSystem). Options: orbits (starting points,
 * each followed forward and back), arrows (grid size), nullclines (true),
 * equilibria (true: found and proved by analytic, labelled by kind),
 * t (how long to follow each orbit), variables.
 *
 * The arrows, nullclines and orbits are floats (estimated); each equilibrium
 * mark is a certified box from analytic, and fig.equilibria lists them.
 */
export function phasePortrait(field, { x = [-3, 3], y = [-3, 3], orbits = [], arrows = 17, nullclines = true, equilibria = true, t = 8, variables = ["x", "y"], params = {}, title = "Phase portrait" } = {}) {
  const comps = field?.f ? field.f.map((a) => format(a)) : field.map(String);
  const vars = field?.variables ?? variables;
  const [F, G] = comps.map((c) => f2(c, vars));
  const X = x.map(num);
  const Y = y.map(num);
  const out = [];
  // direction arrows of equal length
  const step = (X[1] - X[0]) / arrows;
  for (let i = 0; i < arrows; i++)
    for (let j = 0; j < Math.round(((Y[1] - Y[0]) / (X[1] - X[0])) * arrows); j++) {
      const px = X[0] + (i + 0.5) * step;
      const py = Y[0] + (j + 0.5) * step;
      const [u, v] = [F(px, py), G(px, py)];
      const m = Math.hypot(u, v);
      if (!(m > 0)) continue;
      const l = 0.38 * step;
      out.push(arrow([px - (u / m) * l, py - (v / m) * l], [px + (u / m) * l, py + (v / m) * l], { color: "#94a3b8", width: 1, head: 4, alpha: 0.9 }));
    }
  if (nullclines) {
    for (const s of zeroContour(F, X, Y)) out.push(path([s[0], s[1], s[2], s[3]], { color: CATEGORY[2], width: 1.6, dash: [5, 3] }));
    for (const s of zeroContour(G, X, Y)) out.push(path([s[0], s[1], s[2], s[3]], { color: CATEGORY[3], width: 1.6, dash: [5, 3] }));
  }
  const dt = 0.01;
  for (const p of orbits) {
    const start = p.map(num);
    const fwd = rk4Path(F, G, start, { dt, steps: Math.round(t / dt), X, Y });
    const back = rk4Path((a, b) => -F(a, b), (a, b) => -G(a, b), start, { dt, steps: Math.round(t / dt), X, Y });
    const line = [...back.reverse(), ...fwd.slice(1)];
    out.push(path(line, { color: CATEGORY[0], width: 1.8 }));
    const k = Math.min(fwd.length - 1, 40);
    if (k > 1) out.push(arrow(fwd[k - 1], fwd[k], { color: CATEGORY[0], width: 1.8, head: 7 }));
    out.push(dot(start, { r: 3, color: CATEGORY[0] }));
  }
  let eq = [];
  if (equilibria) {
    const sys = field?.equilibria ? field : planarSystem(comps, vars, { params });
    eq = sys.equilibria({ [vars[0]]: X.map(String), [vars[1]]: Y.map(String) });
    for (const e of eq) {
      const p = e.point.map((iv) => (num(iv.low) + num(iv.high)) / 2);
      const stable = e.stability === "asymptotically stable";
      out.push(dot(p, { r: 5, fill: stable ? CATEGORY[1] : "#fff", color: CATEGORY[1], width: 2 }));
      if (e.kind) out.push(text(p, e.kind, { anchor: "ne", label: e.kind, color: CATEGORY[1], size: 11 }));
    }
  }
  return figure({ layers: [shapes(out)], x: X, y: Y, equal: true, axes: true, status: "estimated", title, equilibria: eq, notes: [`${eq.length} equilibri${eq.length === 1 ? "um" : "a"} proved in the window${eq.complete ? " (and no others)" : ""}`, "arrows, nullclines and orbits from floats"] });
}

/** u(x, t) at each time in `times`, as figures sharing a window: frames to animate (heat, wave, any family). */
export function solutionFrames(u, times, { x = [0, 1], y, samples = 200, variables = ["x", "t"], title = "u(x, t)" } = {}) {
  const U = typeof u === "function" ? u : f2(u, variables);
  const X = x.map(num);
  const curves = times.map((t) => {
    const tt = num(t);
    return Array.from({ length: samples + 1 }, (_, i) => {
      const xx = X[0] + ((X[1] - X[0]) * i) / samples;
      return [xx, U(xx, tt)];
    });
  });
  const ys = curves.flat().map((p) => p[1]).filter(Number.isFinite);
  const Y = y ? y.map(num) : [Math.min(0, ...ys) - 0.05, Math.max(...ys) + 0.1];
  const frames = curves.map((c, k) => figure({ layers: [shapes([path(c.filter((p) => Number.isFinite(p[1])), { color: CATEGORY[0], width: 2.4 })])], x: X, y: Y, axes: true, status: "estimated", title: `${title}, t = ${times[k]}` }));
  return Object.freeze({ kind: "frames", frames, steps: times });
}

// ---- differential geometry --------------------------------------------------------------------

/**
 * A plane curve (x(t), y(t)) on [a, b] with, at t, the point, unit tangent
 * and normal and the osculating circle, from analytic's certified curve.at(t)
 * (drawn as the midpoints of its intervals).
 */
export function frameAlongCurve(components, t, { range = [0, 1], parameter = "t", samples = 300, title = "" } = {}) {
  const C = geoCurve(components.map(String), parameter);
  if (C.dimension !== 2) throw new RangeError("frameAlongCurve draws plane curves; use curveOnSurface or project3d for space curves");
  const [X, Y] = components.map((c) => f1(c, parameter));
  const [a, b] = range.map(num);
  const pts = Array.from({ length: samples + 1 }, (_, i) => {
    const s = a + ((b - a) * i) / samples;
    return [X(s), Y(s)];
  });
  const at = C.at(String(t));
  const mid = (iv) => num(iv);
  const P = at.point.map(mid);
  const T = at.tangent.map(mid);
  const N = at.normal.map(mid);
  const out = [path(pts.filter((p) => p.every(Number.isFinite)), { color: CATEGORY[0], width: 2.2 })];
  if (at.radius) {
    const r = mid(at.radius);
    const c = at.centre.map(mid);
    if (r < 1e3) out.push(path(Array.from({ length: 121 }, (_, k) => [c[0] + r * Math.cos((2 * Math.PI * k) / 120), c[1] + r * Math.sin((2 * Math.PI * k) / 120)]), { color: CATEGORY[3], width: 1.2, dash: [5, 3] }), dot(c, { r: 2.5, color: CATEGORY[3] }));
  }
  out.push(arrow(P, [P[0] + T[0], P[1] + T[1]], { color: CATEGORY[1], width: 2.2 }), arrow(P, [P[0] + N[0], P[1] + N[1]], { color: CATEGORY[2], width: 2.2 }), dot(P, { r: 4, color: "#111827" }));
  out.push(text([P[0] + T[0], P[1] + T[1]], "T", { anchor: "ne", color: CATEGORY[1], size: 13 }), text([P[0] + N[0], P[1] + N[1]], "N", { anchor: "ne", color: CATEGORY[2], size: 13 }));
  const ext = extentOf([shapes(out.slice(0, 1)), shapes(out.slice(-4))]);
  const span = Math.max(ext.x[1] - ext.x[0], ext.y[1] - ext.y[0]);
  return figure({ layers: [shapes(out)], x: [ext.x[0] - 0.1 * span, ext.x[1] + 0.1 * span], y: [ext.y[0] - 0.1 * span, ext.y[1] + 0.1 * span], equal: true, axes: true, status: "certified", title, frame: at, notes: [`curvature at t = ${t}: ${at.curvature}`] });
}

/** Frames of frameAlongCurve at each parameter value in ts, in one window: an animation of the moving frame. */
export function frameFrames(components, ts, options = {}) {
  const frames = ts.map((t) => frameAlongCurve(components, t, options));
  const x = [Math.min(...frames.map((f) => f.x[0])), Math.max(...frames.map((f) => f.x[1]))];
  const y = [Math.min(...frames.map((f) => f.y[0])), Math.max(...frames.map((f) => f.y[1]))];
  return Object.freeze({ kind: "frames", frames: frames.map((f) => figure({ ...f, x, y })), steps: ts });
}

function surfaceGrid(components, { u, v, grid, parameters }) {
  const [U, V] = [u.map(num), v.map(num)];
  const [nu, nv] = Array.isArray(grid) ? grid : [grid, grid];
  const comp = components.map((c) => {
    const g = compileFloat(parse(String(c)), parameters[0]);
    return (a, b) => g(a, { [parameters[1]]: b });
  });
  const pts = new Float64Array(3 * (nu + 1) * (nv + 1));
  const uv = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const a = U[0] + ((U[1] - U[0]) * i) / nu;
      const b = V[0] + ((V[1] - V[0]) * j) / nv;
      const k = 3 * (j * (nu + 1) + i);
      pts[k] = comp[0](a, b);
      pts[k + 1] = comp[1](a, b);
      pts[k + 2] = comp[2](a, b);
      uv.push([a, b]);
    }
  return { nu, nv, pts, comp, U, V };
}

/**
 * A parametric surface coloured by curvature: Gaussian (default) or mean,
 * from analytic's formulas evaluated in floats at each cell's centre; red
 * for positive, blue for negative, white for zero (scaled by the largest
 * |value|, or `scale`). fig.range gives the least and greatest values seen.
 */
export function curvatureSurface(components, { u = [0, 1], v = [0, 1], grid = 24, parameters = ["u", "v"], which = "gaussian", scale, cam = camera(), title = "", extra = [] } = {}) {
  const S = geoSurface(components.map(String), parameters);
  const K = f2(format(which === "mean" ? S.meanAst() : S.gaussianAst()), parameters);
  const { nu, nv, pts, U, V } = surfaceGrid(components, { u, v, grid, parameters });
  const vals = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) vals.push(K(U[0] + ((U[1] - U[0]) * (i + 0.5)) / nu, V[0] + ((V[1] - V[0]) * (j + 0.5)) / nv));
  const fin = vals.filter(Number.isFinite);
  const top = num(scale ?? Math.max(1e-12, ...fin.map(Math.abs)));
  const colors = vals.map((k) => divergingColor(k / top));
  const mesh = project3d(cam, [{ item: { kind: "surface3d", nu, nv, points: pts }, cellColors: colors, wire: true, opacity: 0.95 }, ...extra], { box: equalBox(pts) });
  return figure({ layers: [mesh], x: [-1.9, 1.9], y: [-1.5, 1.5], equal: true, status: "estimated", title, range: [Math.min(...fin), Math.max(...fin)], which });
}

/** A cube around points [x, y, z, …], so that project3d keeps their proportions. */
export function equalBox(points) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3)
    for (let c = 0; c < 3; c++) {
      const x = points[i + c];
      if (!Number.isFinite(x)) continue;
      lo[c] = Math.min(lo[c], x);
      hi[c] = Math.max(hi[c], x);
    }
  const half = Math.max(...[0, 1, 2].map((c) => (hi[c] - lo[c]) / 2)) || 1;
  const mid = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
  return { x: [mid[0] - half, mid[0] + half], y: [mid[1] - half, mid[1] + half], z: [mid[2] - half, mid[2] + half] };
}

/** The 3D points of a path given in the surface's parameters: [[u, v], …] → a curve3d item for project3d (or curvatureSurface's extra). */
export function curveOnSurface(components, uvPoints, { parameters = ["u", "v"] } = {}) {
  const comp = components.map((c) => f2(c, parameters));
  return { kind: "curve3d", points: Float64Array.from(uvPoints.flatMap(([a, b]) => comp.map((g) => g(num(a), num(b))))) };
}

// ---- numerical analysis -----------------------------------------------------------------------

/**
 * Newton's method on f from x0 for n steps: the graph, each tangent from
 * (xₖ, f(xₖ)) down to the axis at xₖ₊₁. Floats (estimated); fig.iterates
 * lists the xₖ.
 */
export function newtonFigure(f, x0, n = 4, { range, derivative, title = "Newton's method", variable = "x" } = {}) {
  const F = typeof f === "function" ? f : f1(f, variable);
  const dF = derivative ? (typeof derivative === "function" ? derivative : f1(derivative, variable)) : (x) => (F(x + 1e-6) - F(x - 1e-6)) / 2e-6;
  const xs = [num(x0)];
  for (let i = 0; i < n; i++) xs.push(xs[i] - F(xs[i]) / dF(xs[i]));
  const R = range ? range.map(num) : (() => {
    const fin = xs.filter(Number.isFinite);
    const lo = Math.min(...fin);
    const hi = Math.max(...fin);
    const w = hi - lo || 1;
    return [lo - 0.3 * w, hi + 0.3 * w];
  })();
  const curve = Array.from({ length: 301 }, (_, i) => {
    const x = R[0] + ((R[1] - R[0]) * i) / 300;
    return [x, F(x)];
  }).filter((p) => Number.isFinite(p[1]));
  const out = [path([[R[0], 0], [R[1], 0]], { color: "#9ca3af", width: 1 }), path(curve, { color: CATEGORY[0], width: 2.2 })];
  for (let i = 0; i < n && Number.isFinite(xs[i + 1]); i++) {
    const p = [xs[i], F(xs[i])];
    out.push(path([[xs[i], 0], p], { color: "#9ca3af", width: 1, dash: [3, 3] }), path([p, [xs[i + 1], 0]], { color: CATEGORY[1], width: 1.6 }), dot(p, { r: 3, color: CATEGORY[1] }), dot([xs[i + 1], 0], { r: 3, color: CATEGORY[1] }));
    out.push(text([xs[i], 0], `x_{${i}}`, { anchor: i % 2 ? "n" : "s", label: `x${i}`, color: CATEGORY[1], size: 11 }));
  }
  const ys = curve.map((p) => p[1]);
  const Y = [Math.min(0, ...ys), Math.max(0, ...ys)];
  const h = Y[1] - Y[0] || 1;
  return figure({ layers: [shapes(out)], x: R, y: [Y[0] - 0.08 * h, Y[1] + 0.08 * h], axes: true, status: "estimated", title, iterates: xs });
}

/**
 * f and the polynomial of degree n − 1 through it at the nodes (default n
 * equally spaced; nodes: "chebyshev" for Chebyshev points), with the error
 * f − p below. The interpolant is built in floats by divided differences.
 */
export function interpolationFigure(f, n, { range = [-1, 1], nodes = "equal", title = "Interpolation", variable = "x", error = true } = {}) {
  const F = typeof f === "function" ? f : f1(f, variable);
  const [a, b] = range.map(num);
  const xs = Array.isArray(nodes) ? nodes.map(num) : Array.from({ length: n }, (_, i) => (nodes === "chebyshev" ? (a + b) / 2 + ((b - a) / 2) * Math.cos(((2 * i + 1) * Math.PI) / (2 * n)) : n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)));
  const ys = xs.map(F);
  const c = [...ys];
  for (let j = 1; j < xs.length; j++) for (let i = xs.length - 1; i >= j; i--) c[i] = (c[i] - c[i - 1]) / (xs[i] - xs[i - j]);
  const P = (x) => {
    let s = c[c.length - 1];
    for (let i = c.length - 2; i >= 0; i--) s = s * (x - xs[i]) + c[i];
    return s;
  };
  const grid = Array.from({ length: 401 }, (_, i) => a + ((b - a) * i) / 400);
  const out = [path(grid.map((x) => [x, F(x)]), { color: CATEGORY[0], width: 2.2 }), path(grid.map((x) => [x, P(x)]), { color: CATEGORY[1], width: 1.8, dash: [6, 3] })];
  if (error) out.push(path(grid.map((x) => [x, F(x) - P(x)]), { color: CATEGORY[2], width: 1.2 }));
  xs.forEach((x, i) => out.push(dot([x, ys[i]], { r: 3.5, color: CATEGORY[1] })));
  const maxErr = Math.max(...grid.map((x) => Math.abs(F(x) - P(x))));
  return figure({ layers: [shapes(out)], axes: true, status: "estimated", title, maxError: maxErr, nodes: xs, notes: [`largest |f − p| on the grid: ${Number(maxErr.toPrecision(4))}`] });
}

/**
 * The pieces a quadrature rule integrates over [a, b] with n panels:
 * "trapezoid", "midpoint" or "simpson" (n even: a parabola through each
 * pair of panels). fig.value is the rule's value in floats.
 */
export function quadratureFigure(f, [a, b], n = 6, { rule = "trapezoid", title, variable = "x" } = {}) {
  const F = typeof f === "function" ? f : f1(f, variable);
  const [A, B] = [num(a), num(b)];
  const h = (B - A) / n;
  const out = [];
  let value = 0;
  if (rule === "simpson" && n % 2) throw new RangeError("Simpson's rule needs an even number of panels");
  if (rule === "simpson") {
    for (let k = 0; k < n; k += 2) {
      const [x0, x1, x2] = [A + k * h, A + (k + 1) * h, A + (k + 2) * h];
      const [y0, y1, y2] = [F(x0), F(x1), F(x2)];
      value += (h / 3) * (y0 + 4 * y1 + y2);
      const q = (x) => y0 * ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2)) + y1 * ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2)) + y2 * ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
      const top = Array.from({ length: 31 }, (_, i) => [x0 + (2 * h * i) / 30, q(x0 + (2 * h * i) / 30)]);
      out.push(path([[x0, 0], ...top, [x2, 0]], { closed: true, fill: CATEGORY[1], fillAlpha: 0.2, color: CATEGORY[1], width: 1 }));
    }
  } else {
    for (let k = 0; k < n; k++) {
      const [x0, x1] = [A + k * h, A + (k + 1) * h];
      if (rule === "midpoint") {
        const m = F((x0 + x1) / 2);
        value += h * m;
        out.push(path([[x0, 0], [x0, m], [x1, m], [x1, 0]], { closed: true, fill: CATEGORY[1], fillAlpha: 0.2, color: CATEGORY[1], width: 1 }));
      } else {
        const [y0, y1] = [F(x0), F(x1)];
        value += (h * (y0 + y1)) / 2;
        out.push(path([[x0, 0], [x0, y0], [x1, y1], [x1, 0]], { closed: true, fill: CATEGORY[1], fillAlpha: 0.2, color: CATEGORY[1], width: 1 }));
      }
    }
  }
  const grid = Array.from({ length: 301 }, (_, i) => A + ((B - A) * i) / 300);
  out.push(path(grid.map((x) => [x, F(x)]), { color: CATEGORY[0], width: 2.2 }));
  return figure({ layers: [shapes(out)], axes: true, status: "estimated", title: title ?? `${rule} rule, ${n} panels`, value });
}

/**
 * The stability region of a one-step method for y′ = λy: the z = hλ where
 * |R(z)| ≤ 1, on a grid. R is given by its coefficients (constant first),
 * or by name: "euler" (1 + z), "heun" and "rk2" (1 + z + z²/2), "rk4".
 * Cells are classified at their centres in floats (estimated).
 */
export function stabilityRegion(R = "rk4", { re = [-4, 2], im = [-3.5, 3.5], resolution = 220, title } = {}) {
  const named = { euler: [1, 1], heun: [1, 1, 0.5], rk2: [1, 1, 0.5], rk3: [1, 1, 1 / 2, 1 / 6], rk4: [1, 1, 1 / 2, 1 / 6, 1 / 24] };
  const coef = typeof R === "string" ? named[R] : R.map(num);
  if (!coef) throw new RangeError(`unknown method ${R}`);
  const X = re.map(num);
  const Y = im.map(num);
  const w = resolution;
  const h = Math.round((w * (Y[1] - Y[0])) / (X[1] - X[0]));
  const cells = new Array(w * h).fill(null);
  let inside = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = X[0] + ((i + 0.5) * (X[1] - X[0])) / w;
      const y = Y[0] + ((j + 0.5) * (Y[1] - Y[0])) / h;
      let [pr, pi] = [0, 0];
      for (let k = coef.length - 1; k >= 0; k--) [pr, pi] = [pr * x - pi * y + coef[k], pr * y + pi * x];
      if (pr * pr + pi * pi <= 1) {
        cells[j * w + i] = "#a5b4fc";
        inside++;
      }
    }
  const area = (inside * (X[1] - X[0]) * (Y[1] - Y[0])) / (w * h);
  return figure({ layers: [image({ x: X, y: Y, width: w, height: h, cells })], x: X, y: Y, equal: true, axes: true, status: "estimated", title: title ?? `Stability region (${typeof R === "string" ? R : "R"})`, area });
}

/**
 * Errors against step sizes on log–log axes, with the least-squares slope
 * (the observed order). rows: [[h, error], …], or [{ h, error }].
 */
export function convergenceFigure(rows, { title = "Convergence" } = {}) {
  const pts = rows.map((r) => (Array.isArray(r) ? r : [r.h ?? r.step, r.error ?? r.err]).map(num)).filter(([h, e]) => h > 0 && e > 0).map(([h, e]) => [Math.log10(h), Math.log10(e)]);
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const out = [path(pts, { color: CATEGORY[0], width: 1.5 }), ...pts.map((p) => dot(p, { r: 3.5, color: CATEGORY[0] }))];
  const ext = extentOf([shapes(out)]);
  out.push(text([ext.x[0], ext.y[1]], `\\text{observed order} \\approx ${slope.toFixed(2)}`, { anchor: "se", label: `observed order ≈ ${slope.toFixed(2)}`, color: CATEGORY[1], size: 12 }));
  return figure({ layers: [shapes(out)], axes: { xScale: "log", yScale: "log" }, status: "estimated", title, order: slope });
}
