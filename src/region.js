// Regions of the plane given by conditions on x and y, and implicit curves.
//
//   region("y >= x^2 - 2 and y <= 2", {}, vp)     shaded set, certified per pixel
//   region("x + y <= 4, x >= 0, y >= 0", {}, vp)  bounded by lines: an exact polygon
//   implicit("x^2 + y^2 = 4", {}, vp)             the curve itself
//
// Each returns a Refinement (see refine.js): a float sketch at once, then
// the certified or exact answer.
//
// When every comparison is affine in x and y with rational coefficients, the
// region is computed exactly: each "and" piece is the viewport rectangle
// clipped by half-planes, with rational corners. Boundary edges remember
// whether their inequality is strict (drawn dashed) or not (solid), and
// corners where two boundary lines meet are listed with whether the region
// includes them. A union ("or") reports only the outer boundary.
//
// Anything else goes through the certified pixel classifier in quadtree.js.

import { Rational } from "@ratmath/core";
import { compileFloat, compileInterval, paramsToFloat, paramsToIntervals, paramsToRational } from "./expr.js";
import { atoms, dnf, evalFloat, parseCondition } from "./condition.js";
import { classify } from "./quadtree.js";
import { linearForm } from "./linear.js";
import { Refinement } from "@ratmath/core/refine";
import { viewport as makeViewport, precisionFor } from "./viewport.js";
import { Point, point, segment } from "./geometry.js";
import { surd } from "./surd.js";
import * as I from "./interval.js";
import { colsInterval, rowsInterval } from "./quadtree.js";
import { conicAtoms, exactConicRegion, NotConic } from "./conic.js";

const asViewport = (vp) => (vp && vp.dx ? vp : makeViewport(vp));
const asTree = (c) => (typeof c === "string" ? parseCondition(c) : c);

// ---- float sketches ----------------------------------------------------------------

/** Values of a float function on a grid of nodes every `step` pixels (row-major, (nx+1) x (ny+1)). */
function nodeGrid(fn, p, vp, step) {
  const nx = Math.ceil(vp.width / step);
  const ny = Math.ceil(vp.height / step);
  const vals = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    const y = vp.f.ymax - Math.min(j * step, vp.height) * vp.f.dy;
    for (let i = 0; i <= nx; i++) {
      const x = vp.f.xmin + Math.min(i * step, vp.width) * vp.f.dx;
      vals[j * (nx + 1) + i] = fn(x, { ...p, y });
    }
  }
  return { nx, ny, vals };
}

/**
 * Marching squares on node values: zero-crossing segments in pixel
 * coordinates, as a polyline value with NaN breaks. `keep(i, j)` may veto a cell.
 */
function marching({ nx, ny, vals }, step, vp, keep) {
  const pts = [];
  const at = (i, j) => vals[j * (nx + 1) + i];
  const px = (i) => Math.min(i * step, vp.width);
  const py = (j) => Math.min(j * step, vp.height);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (keep && !keep(i, j)) continue;
      const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (!c.every(Number.isFinite)) continue;
      const corners = [[px(i), py(j)], [px(i + 1), py(j)], [px(i + 1), py(j + 1)], [px(i), py(j + 1)]];
      const cross = [];
      for (let e = 0; e < 4; e++) {
        const a = c[e];
        const b = c[(e + 1) % 4];
        if ((a < 0) !== (b < 0)) {
          const t = a / (a - b);
          const [x0, y0] = corners[e];
          const [x1, y1] = corners[(e + 1) % 4];
          cross.push([x0 + t * (x1 - x0), y0 + t * (y1 - y0)]);
        }
      }
      if (cross.length === 2) pts.push(cross[0][0], cross[0][1], cross[1][0], cross[1][1], NaN, NaN);
      else if (cross.length === 4) {
        // Saddle: pair by the centre value.
        const mid = (c[0] + c[1] + c[2] + c[3]) / 4;
        const [a, b, d, e] = cross;
        if ((mid < 0) === (c[0] < 0)) pts.push(a[0], a[1], e[0], e[1], NaN, NaN, b[0], b[1], d[0], d[1], NaN, NaN);
        else pts.push(a[0], a[1], b[0], b[1], NaN, NaN, d[0], d[1], e[0], e[1], NaN, NaN);
      }
    }
  }
  return { kind: "polyline", points: Float64Array.from(pts), asymptotes: [] };
}

/** Float sketch of f(x, y) = 0 as line segments (marching squares, every `step` pixels). */
export function sketchImplicit(F, params, vp, { step = 2 } = {}) {
  vp = asViewport(vp);
  const tree = asTree(F);
  const eq = atoms(tree)[0];
  const fn = compileFloat(eq.F, "x");
  const p = paramsToFloat(paramsToRational(params));
  return marching(nodeGrid(fn, p, vp, step), step, vp);
}

/**
 * Float sketch of a region: { kind: "region-sketch", fill: [x, y, w, h, ...]
 * pixel rectangles (runs of cells whose centre satisfies the condition),
 * edges: polyline of boundary segments }.
 */
export function sketchRegion(cond, params, vp, { step = 3 } = {}) {
  vp = asViewport(vp);
  const tree = asTree(cond);
  const list = atoms(tree);
  const p = paramsToFloat(paramsToRational(params));
  const fns = list.map((a) => compileFloat(a.F, "x"));
  const nx = Math.ceil(vp.width / step);
  const ny = Math.ceil(vp.height / step);
  const truth = new Uint8Array(nx * ny);
  const values = new Map();
  const fill = [];
  for (let j = 0; j < ny; j++) {
    const y = vp.f.ymax - Math.min((j + 0.5) * step, vp.height) * vp.f.dy;
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      let t = false;
      if (i < nx) {
        const x = vp.f.xmin + Math.min((i + 0.5) * step, vp.width) * vp.f.dx;
        list.forEach((a, k) => values.set(a, fns[k](x, { ...p, y })));
        t = evalFloat(tree, values);
        truth[j * nx + i] = t ? 1 : 0;
      }
      if (t && run < 0) run = i;
      if (!t && run >= 0) {
        fill.push(run * step, j * step, Math.min((i - run) * step, vp.width - run * step), Math.min(step, vp.height - j * step));
        run = -1;
      }
    }
  }
  // Boundary: each comparison's zero curve, where it separates cells in and out.
  const T = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? truth[j * nx + i] : 0);
  const keep = (i, j) => {
    // node cell (i, j) spans centre cells (i-1..i, j-1..j) approximately
    const s = T(i, j) + T(i - 1, j) + T(i, j - 1) + T(i - 1, j - 1);
    return s > 0 && s < 4;
  };
  const edges = [];
  for (const [k, a] of list.entries()) {
    if (a.rel === "!=") continue;
    const seg = marching(nodeGrid(fns[k], p, vp, step), step, vp, keep);
    edges.push({ strict: a.rel === "<", points: seg.points });
  }
  return { kind: "region-sketch", width: vp.width, height: vp.height, fill, edges };
}

// ---- exact regions bounded by lines ------------------------------------------------------

/**
 * If every comparison is affine with rational coefficients, the half-planes
 * of each "and" piece: [{ a, b, c, rel, atom }] meaning a·x + b·y + c rel 0.
 * Returns null otherwise.
 */
export function linearPieces(cond, params = {}) {
  const tree = asTree(cond);
  const all = atoms(tree);
  const forms = new Map();
  for (const a of all) {
    const f = linearForm(a.F, params);
    if (!f) return null;
    forms.set(a.F, f);
  }
  const terms = dnf(tree);
  const pieces = [];
  for (const term of terms) {
    // "!=" splits into "<" and ">".
    let variants = [[]];
    for (const a of term) {
      const f = linearForm(a.F, params) ?? forms.get(a.F);
      const h = { a: surd(f.a), b: surd(f.b), c: surd(f.c), rel: a.rel, atom: a };
      if (a.rel === "!=") {
        const neg = { a: h.a.negate(), b: h.b.negate(), c: h.c.negate(), rel: "<", atom: a };
        variants = variants.flatMap((v) => [[...v, { ...h, rel: "<" }], [...v, neg]]);
      } else variants = variants.map((v) => [...v, h]);
    }
    pieces.push(...variants);
  }
  return pieces;
}

const valueAt = (h, P) => h.a.multiply(P.x).add(h.b.multiply(P.y)).add(h.c);

function crossing(h, P, Q) {
  // Point on PQ where a·x + b·y + c = 0.
  const fp = valueAt(h, P);
  const fq = valueAt(h, Q);
  const t = fp.divide(fp.subtract(fq));
  return new Point(P.x.add(Q.x.subtract(P.x).multiply(t)), P.y.add(Q.y.subtract(P.y).multiply(t)));
}

/** Clip a convex polygon (vertices with outgoing-edge labels) by h ≤ 0. */
function clip(poly, h) {
  if (h.a.isZero && h.b.isZero) {
    const s = h.c.sign();
    const ok = h.rel === "<" ? s < 0 : h.rel === "=" ? s === 0 : s <= 0;
    return ok ? poly : [];
  }
  const out = [];
  const push = (P, label) => {
    if (out.length && out[out.length - 1].P.equals(P)) out[out.length - 1].label = label;
    else out.push({ P, label });
  };
  const n = poly.length;
  for (let k = 0; k < n; k++) {
    const { P, label } = poly[k];
    const Q = poly[(k + 1) % n].P;
    const sp = valueAt(h, P).sign();
    const sq = valueAt(h, Q).sign();
    if (sp <= 0) {
      if (sq <= 0) push(P, label);
      else {
        push(P, label);
        push(sp === 0 ? P : crossing(h, P, Q), h);
      }
    } else if (sq <= 0) {
      push(sq === 0 ? Q : crossing(h, P, Q), label);
    }
  }
  if (out.length > 1 && out[0].P.equals(out[out.length - 1].P)) {
    out.pop(); // a zero-length closing edge
  }
  return out.length >= 3 ? out : [];
}

/** Portion [t0, t1] of segment P→Q inside the convex set of half-planes (closed), or null. */
function segmentInside(P, Q, hs) {
  let t0 = surd(0);
  let t1 = surd(1);
  for (const h of hs) {
    const f0 = valueAt(h, P);
    const f1 = valueAt(h, Q);
    const df = f1.subtract(f0);
    if (df.isZero) {
      if (f0.sign() > 0) return null;
      continue;
    }
    const t = f0.negate().divide(df); // where f = 0
    if (df.sign() > 0) {
      if (t.compareTo(t1) < 0) t1 = t;
    } else if (t.compareTo(t0) > 0) t0 = t;
    if (t0.compareTo(t1) > 0) return null;
  }
  return [t0, t1];
}

const lerp = (P, Q, t) => new Point(P.x.add(Q.x.subtract(P.x).multiply(t)), P.y.add(Q.y.subtract(P.y).multiply(t)));

/** Exact region for linear pieces, clipped to the viewport. */
export function exactLinearRegion(pieces, vp) {
  vp = asViewport(vp);
  const X0 = surd(vp.xmin);
  const X1 = surd(vp.xmax);
  const Y0 = surd(vp.ymin);
  const Y1 = surd(vp.ymax);
  const FRAME = "frame";
  // Frame as half-planes too (for segment clipping).
  const frameH = [
    { a: surd(-1), b: surd(0), c: X0, rel: "<=" },
    { a: surd(1), b: surd(0), c: X1.negate(), rel: "<=" },
    { a: surd(0), b: surd(-1), c: Y0, rel: "<=" },
    { a: surd(0), b: surd(1), c: Y1.negate(), rel: "<=" },
  ];
  const rect = [
    { P: new Point(X0, Y0), label: FRAME },
    { P: new Point(X1, Y0), label: FRAME },
    { P: new Point(X1, Y1), label: FRAME },
    { P: new Point(X0, Y1), label: FRAME },
  ];
  const polys = [];
  const lines = [];
  for (const hs of pieces) {
    const eqs = hs.filter((h) => h.rel === "=");
    const ineq = hs.filter((h) => h.rel !== "=");
    if (eqs.length) {
      // A piece on a line: the line clipped by everything else.
      const e = eqs[0];
      const others = [...frameH, ...ineq, ...eqs.slice(1).flatMap((h) => [{ ...h, rel: "<=" }, { a: h.a.negate(), b: h.b.negate(), c: h.c.negate(), rel: "<=" }])];
      if (e.a.isZero && e.b.isZero) continue;
      // Two far points on the line, spanning the frame.
      const big = X1.subtract(X0).abs().add(Y1.subtract(Y0).abs()).multiply(surd(4));
      const n2 = e.a.square().add(e.b.square());
      const foot = new Point(e.a.multiply(e.c.negate()).divide(n2), e.b.multiply(e.c.negate()).divide(n2));
      const cx = X0.add(X1).divide(surd(2));
      const cy = Y0.add(Y1).divide(surd(2));
      // Move the foot near the frame centre along the line, then extend.
      const dir = [e.b.negate(), e.a];
      const s = cx.subtract(foot.x).multiply(dir[0]).add(cy.subtract(foot.y).multiply(dir[1])).divide(n2);
      const C = new Point(foot.x.add(dir[0].multiply(s)), foot.y.add(dir[1].multiply(s)));
      const scale = big.divide(dir[0].abs().add(dir[1].abs()));
      const P = new Point(C.x.subtract(dir[0].multiply(scale)), C.y.subtract(dir[1].multiply(scale)));
      const Q = new Point(C.x.add(dir[0].multiply(scale)), C.y.add(dir[1].multiply(scale)));
      const r = segmentInside(P, Q, others);
      if (r) {
        const A = lerp(P, Q, r[0]);
        const B = lerp(P, Q, r[1]);
        lines.push(A.equals(B) ? { point: A, atom: e.atom } : { segment: segment(A, B), atom: e.atom });
      }
      continue;
    }
    let poly = rect;
    for (const h of ineq) {
      poly = clip(poly, h);
      if (!poly.length) break;
    }
    if (poly.length) polys.push({ poly, hs: ineq });
  }

  // Boundary edges, minus the parts shared with or covered by other pieces.
  const boundary = [];
  for (const [k, { poly }] of polys.entries()) {
    for (let e = 0; e < poly.length; e++) {
      const { P, label } = poly[e];
      if (label === FRAME) continue;
      const Q = poly[(e + 1) % poly.length].P;
      let free = [[surd(0), surd(1)]];
      for (const [m, other] of polys.entries()) {
        if (m === k) continue;
        const r = segmentInside(P, Q, [...frameH, ...other.hs]);
        if (!r || r[0].compareTo(r[1]) >= 0) continue;
        // Same boundary line with the other piece on the same side: not covered.
        const same = other.hs.map((h) => parallelSame(h, label)).find(Boolean);
        if (same && same.dir > 0) continue;
        free = subtract(free, r);
        if (!free.length) break;
      }
      for (const [t0, t1] of free) {
        if (t0.compareTo(t1) >= 0) continue;
        boundary.push({ from: lerp(P, Q, t0), to: lerp(P, Q, t1), strict: label.rel === "<", text: label.atom.text });
      }
    }
  }

  // Corners: points where boundary edges on two different lines meet.
  const corners = [];
  const ends = boundary.flatMap((b) => [{ P: b.from, b }, { P: b.to, b }]);
  for (const { P, b } of ends) {
    if (corners.some((c) => c.point.equals(P))) continue;
    const other = ends.find((e) => e.b !== b && e.b.text !== b.text && e.P.equals(P));
    if (!other) continue;
    const included = pieces.some((hs) => hs.every((h) => holds(h, P)));
    corners.push({ point: P, included, between: [b.text, other.b.text] });
  }

  return {
    kind: "polygons",
    viewport: vp,
    pieces: polys.map(({ poly }) => ({ vertices: poly.map((v) => v.P), area: shoelace(poly.map((v) => v.P)) })),
    boundary,
    corners,
    lines,
    complete: true,
  };
}

function holds(h, P) {
  const s = valueAt(h, P).sign();
  return h.rel === "<" ? s < 0 : h.rel === "=" ? s === 0 : s <= 0;
}

// Is h the same line as g, and do they keep the same side? Returns { dir } or null.
function parallelSame(h, g) {
  const cross = h.a.multiply(g.b).subtract(h.b.multiply(g.a));
  if (!cross.isZero) return null;
  // h = λ g: compare via a non-zero coefficient.
  const lam = !g.a.isZero ? h.a.divide(g.a) : h.b.divide(g.b);
  if (!h.c.equals(g.c.multiply(lam))) return null;
  return { dir: lam.sign() };
}

function subtract(intervals, [a, b]) {
  const out = [];
  for (const [s, t] of intervals) {
    if (b.compareTo(s) <= 0 || a.compareTo(t) >= 0) {
      out.push([s, t]);
      continue;
    }
    if (a.compareTo(s) > 0) out.push([s, a]);
    if (b.compareTo(t) < 0) out.push([b, t]);
  }
  return out;
}

function shoelace(v) {
  let s = surd(0);
  for (let i = 0; i < v.length; i++) {
    const P = v[i];
    const Q = v[(i + 1) % v.length];
    s = s.add(P.x.multiply(Q.y).subtract(Q.x.multiply(P.y)));
  }
  return s.divide(surd(2)).abs();
}

// ---- public API ---------------------------------------------------------------------------

/**
 * The region where a condition holds, as a Refinement. Quick: a float
 * sketch. Exact: an exact polygon frame when the condition is linear, exact
 * arcs and corners when it is bounded by conics (see conic.js), else the
 * certified pixel classification (always, with `{ method: "pixels" }`).
 */
export function region(cond, params = {}, vp, options = {}) {
  const tree = asTree(cond);
  const view = asViewport(vp);
  const pieces = options.method === "pixels" ? null : linearPieces(tree, params);
  const conics = options.method === "pixels" || pieces ? null : conicAtoms(tree, params);
  return new Refinement(
    () => ({ value: sketchRegion(tree, params, view, options), trust: "rough" }),
    function* () {
      if (pieces) {
        yield { done: 0, of: 1, step: "polygons" };
        return { value: exactLinearRegion(pieces, view), via: "exact-polygons" };
      }
      if (conics) {
        yield { done: 0, of: 1, step: "conics" };
        try {
          return { value: exactConicRegion(tree, conics, view, options), via: "exact-conics" };
        } catch (e) {
          if (!(e instanceof NotConic)) throw e;
        }
      }
      const frame = yield* classify(tree, params, view, options);
      return { value: frame, via: "interval-boxes" };
    },
  );
}

/**
 * The curve F(x, y) = 0 ("x^2 + y^2 = 4", or an expression meaning "= 0") as
 * a Refinement. Quick: marching-squares segments. Exact: a cells frame (like
 * a graph's) whose shaded pixels are the only ones the curve can pass
 * through. Pixels where the curve is proven present (F has opposite signs at
 * two corners and is continuous on the pixel) are listed in `sure`.
 */
export function implicit(F, params = {}, vp, options = {}) {
  const tree = asTree(F);
  const list = atoms(tree);
  if (list.length !== 1 || list[0].rel !== "=" || tree.op !== "cmp") throw new SyntaxError("implicit() takes one equation, such as x^2 + y^2 = 4");
  const view = asViewport(vp);
  return new Refinement(
    () => ({ value: sketchImplicit(tree, params, view, options), trust: "rough" }),
    function* () {
      const frame = yield* classify(tree, params, view, { subpixel: 2, ...options });
      const cells = { kind: "cells", width: view.width, height: view.height, columns: frame.boundary, tight: true, complete: true, asymptotes: [], holes: [], boxes: frame.boxes };
      cells.sure = sureCells(list[0].F, params, view, frame.boundary, options);
      return { value: cells, via: "interval-boxes" };
    },
  );
}

/** For each candidate pixel, whether a sign change at its corners proves the curve passes through it. */
function sureCells(F, params, vp, columns, { extraBits = 12 } = {}) {
  const ctx = I.context(precisionFor(vp, extraBits));
  const enclose = compileInterval(F, "x");
  const base = paramsToIntervals(ctx, paramsToRational(params));
  const sure = Array.from({ length: vp.width }, () => []);
  const cache = new Map();
  const signAt = (i, j) => {
    const key = i * 100003 + j;
    if (cache.has(key)) return cache.get(key);
    const X = colsInterval(ctx, vp, i, i);
    const Y = rowsInterval(ctx, vp, j, j);
    let s = 0;
    I.resetClipped();
    try {
      const r = enclose(ctx, X, { ...base, y: Y });
      if (r && !I.wasClipped()) s = r.lo > 0n ? 1 : r.hi < 0n ? -1 : 0;
    } catch {
      s = 0;
    }
    cache.set(key, s);
    return s;
  };
  let count = 0;
  for (let i = 0; i < columns.length; i++) {
    const spans = columns[i];
    for (let k = 0; k < spans.length; k += 2) {
      for (let j = spans[k]; j <= spans[k + 1]; j++) {
        // Continuity on the pixel: the whole-pixel enclosure must not be clipped.
        I.resetClipped();
        let ok = false;
        try {
          const r = enclose(ctx, colsInterval(ctx, vp, i, i + 1), { ...base, y: rowsInterval(ctx, vp, j, j + 1) });
          ok = !!r && !I.wasClipped();
        } catch {
          ok = false;
        }
        if (!ok) continue;
        const s = [signAt(i, j), signAt(i + 1, j), signAt(i + 1, j + 1), signAt(i, j + 1)];
        if (s.includes(1) && s.includes(-1)) {
          sure[i].push(j);
          count++;
        }
      }
    }
  }
  sure.count = count;
  return sure;
}

export { parseCondition };
