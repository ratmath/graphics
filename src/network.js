// Drawing graphs: the graph-drawing phase of @ratmath/discrete (phase 9),
// shared with @ratmath/logic for automata and Kripke frames.
//
// A graph is anything with vertices() and edges() (discrete's Graph), or
// plain data { vertices, edges: [[u, v], …] or [{ from, to, label }], directed }.
// An automaton (states, start, accept, delta) and a Kripke model (worlds, R,
// valuation) are read the same way.
//
// Layouts return positions; drawGraph turns positions into a figure. The
// circle, grid, layered, tree and bipartite layouts are deterministic. The
// spring layout runs a fixed number of float steps from the circle layout,
// so it is reproducible but estimated. The Tutte layout of a planar graph is
// exact: the outer face goes on a convex polygon with rational corners,
// every other vertex at the average of its neighbours (a linear system
// solved over the rationals), and tutteLayout checks, exactly, that no two
// edges cross.

import { Rational } from "@ratmath/core";
import { figure, shapes, path, dot, text, extentOf, CATEGORY } from "./figure.js";

const S = (v) => String(v);

/** Read a graph, automaton or Kripke model as { vertices, edges: [{ from, to, label, weight }], directed }. */
export function graphData(g) {
  if (g?.kind === "graph-data") return g;
  let vertices;
  let edges;
  let directed = Boolean(g?.directed);
  if (typeof g?.vertices === "function") {
    vertices = g.vertices().map(S);
    edges = g.edges().map((e) => ({ from: S(e.from), to: S(e.to), weight: e.weight, label: g.weighted && e.weight !== undefined ? String(e.weight) : undefined }));
  } else if (g?.delta instanceof Map && g.states) {
    // an automaton: one edge per (state, target) with its symbols joined
    vertices = g.states.map(S);
    const lab = new Map();
    for (const [q, row] of g.delta) for (const [a, ts] of row) for (const t of ts) {
      const k = `${q}\u0000${t}`;
      if (!lab.has(k)) lab.set(k, []);
      lab.get(k).push(a === "" ? "ε" : a);
    }
    edges = [...lab].map(([k, syms]) => {
      const [from, to] = k.split("\u0000");
      return { from, to, label: syms.sort().join(",") };
    });
    directed = true;
  } else if (g?.R instanceof Map && g.worlds) {
    vertices = g.worlds.map(S);
    edges = [...g.R].flatMap(([w, vs]) => [...vs].map((v) => ({ from: S(w), to: S(v) })));
    directed = true;
  } else if (Array.isArray(g?.edges)) {
    edges = g.edges.map((e) => (Array.isArray(e) ? { from: S(e[0]), to: S(e[1]), label: e[2] === undefined ? undefined : String(e[2]) } : { ...e, from: S(e.from), to: S(e.to) }));
    vertices = (g.vertices ?? [...new Set(edges.flatMap((e) => [e.from, e.to]))]).map(S);
  } else throw new TypeError("expected a graph: vertices() and edges(), or { vertices, edges }");
  return { kind: "graph-data", vertices, edges, directed };
}

const neighbours = (G) => {
  const N = new Map(G.vertices.map((v) => [v, new Set()]));
  for (const e of G.edges) {
    if (e.from === e.to) continue;
    N.get(e.from).add(e.to);
    N.get(e.to).add(e.from);
  }
  return N;
};

// ---- layouts -----------------------------------------------------------------------------------

/** Vertices evenly round a circle, in order, starting at the top. */
export function circleLayout(g, { order } = {}) {
  const G = graphData(g);
  const vs = order ? order.map(S) : G.vertices;
  const n = vs.length;
  return new Map(vs.map((v, i) => [v, [Math.sin((2 * Math.PI * i) / n), Math.cos((2 * Math.PI * i) / n)]]));
}

/** Vertices in rows of `columns`, left to right and top to bottom. */
export function gridLayout(g, { columns } = {}) {
  const G = graphData(g);
  const c = columns ?? Math.ceil(Math.sqrt(G.vertices.length));
  return new Map(G.vertices.map((v, i) => [v, [i % c, -Math.floor(i / c)]]));
}

/** Two columns: `left` on the left, the rest on the right (a bipartite graph's sides). */
export function bipartiteLayout(g, { left }) {
  const G = graphData(g);
  const L = new Set(left.map(S));
  const a = G.vertices.filter((v) => L.has(v));
  const b = G.vertices.filter((v) => !L.has(v));
  const pos = new Map();
  a.forEach((v, i) => pos.set(v, [0, -i + (a.length - 1) / 2]));
  b.forEach((v, i) => pos.set(v, [2, -i + (b.length - 1) / 2]));
  return pos;
}

/**
 * Layers by distance (along edges, ignoring direction unless `directed`)
 * from the roots, top to bottom; within a layer, vertices are ordered by the
 * average place of their neighbours in the layer above, in a few sweeps, to
 * cut crossings. Good for trees, DAGs and automata.
 */
export function layeredLayout(g, { roots, sweeps = 4 } = {}) {
  const G = graphData(g);
  const N = neighbours(G);
  const level = new Map();
  const starts = roots ? roots.map(S) : [G.vertices[0]];
  const queue = [];
  for (const r of starts) if (!level.has(r)) level.set(r, 0), queue.push(r);
  const visit = () => {
    while (queue.length) {
      const u = queue.shift();
      for (const w of [...N.get(u)].sort()) if (!level.has(w)) level.set(w, level.get(u) + 1), queue.push(w);
    }
  };
  visit();
  for (const v of G.vertices) if (!level.has(v)) level.set(v, 0), queue.push(v), visit();
  const layers = [];
  for (const v of G.vertices) (layers[level.get(v)] ??= []).push(v);
  const place = new Map();
  layers.forEach((L) => L.forEach((v, i) => place.set(v, i)));
  for (let s = 0; s < sweeps; s++) {
    for (let k = 1; k < layers.length; k++) {
      const bary = (v) => {
        const up = [...N.get(v)].filter((w) => level.get(w) === k - 1).map((w) => place.get(w));
        return up.length ? up.reduce((a, b) => a + b, 0) / up.length : place.get(v);
      };
      layers[k].sort((a, b) => bary(a) - bary(b) || (a < b ? -1 : 1));
      layers[k].forEach((v, i) => place.set(v, i));
    }
  }
  const pos = new Map();
  layers.forEach((L, k) => L.forEach((v, i) => pos.set(v, [i - (L.length - 1) / 2, -k])));
  return pos;
}

/**
 * A tidy drawing of a tree (or of a breadth-first spanning tree of a
 * graph) from `root`: leaves one unit apart in order, each parent centred
 * over its children, depth downward.
 */
export function treeLayout(g, { root } = {}) {
  const G = graphData(g);
  const N = neighbours(G);
  const r = S(root ?? G.vertices[0]);
  const children = new Map();
  const seen = new Set([r]);
  const queue = [r];
  while (queue.length) {
    const u = queue.shift();
    children.set(u, []);
    for (const w of G.edges.filter((e) => e.from === u || (!G.directed && e.to === u)).map((e) => (e.from === u ? e.to : e.from))) {
      if (seen.has(w)) continue;
      seen.add(w);
      children.get(u).push(w);
      queue.push(w);
    }
  }
  const pos = new Map();
  let next = 0;
  const walk = (u, depth) => {
    const cs = children.get(u) ?? [];
    if (!cs.length) pos.set(u, [next++, -depth]);
    else {
      cs.forEach((c) => walk(c, depth + 1));
      pos.set(u, [(pos.get(cs[0])[0] + pos.get(cs[cs.length - 1])[0]) / 2, -depth]);
    }
  };
  walk(r, 0);
  let extra = Math.max(0, ...[...pos.values()].map((p) => -p[1])) + 1;
  for (const v of G.vertices) if (!pos.has(v)) pos.set(v, [next++, -extra]);
  return pos;
}

/**
 * A force-directed layout (Fruchterman and Reingold), from the circle
 * layout, for `iterations` steps with a cooling temperature. Deterministic
 * (no random start) but floating-point: estimated.
 */
export function springLayout(g, { iterations = 300 } = {}) {
  const G = graphData(g);
  const vs = G.vertices;
  const n = vs.length;
  const start = circleLayout(G);
  const P = vs.map((v) => [...start.get(v)]);
  const idx = new Map(vs.map((v, i) => [v, i]));
  const k = Math.sqrt(4 / Math.max(1, n));
  const E = G.edges.filter((e) => e.from !== e.to).map((e) => [idx.get(e.from), idx.get(e.to)]);
  for (let it = 0; it < iterations; it++) {
    const t = 0.1 * (1 - it / iterations) + 0.002;
    const D = P.map(() => [0, 0]);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = P[i][0] - P[j][0];
        let dy = P[i][1] - P[j][1];
        let d = Math.hypot(dx, dy);
        if (d < 1e-9) [dx, dy, d] = [1e-3 * (i - j), 1e-3, 1e-3];
        const f = (k * k) / d;
        D[i][0] += (dx / d) * f;
        D[i][1] += (dy / d) * f;
        D[j][0] -= (dx / d) * f;
        D[j][1] -= (dy / d) * f;
      }
    for (const [i, j] of E) {
      const dx = P[i][0] - P[j][0];
      const dy = P[i][1] - P[j][1];
      const d = Math.hypot(dx, dy) || 1e-9;
      const f = (d * d) / k;
      D[i][0] -= (dx / d) * f;
      D[i][1] -= (dy / d) * f;
      D[j][0] += (dx / d) * f;
      D[j][1] += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(...D[i]) || 1;
      P[i][0] += (D[i][0] / d) * Math.min(d, t);
      P[i][1] += (D[i][1] / d) * Math.min(d, t);
    }
  }
  return new Map(vs.map((v, i) => [v, P[i]]));
}

// ---- the exact planar layout -----------------------------------------------------------------

const Q = (n, d = 1n) => new Rational(BigInt(n), BigInt(d));
/** n points on the unit circle with rational coordinates, in counter-clockwise order (exactly in convex position). */
function rationalCircle(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const theta = Math.PI / 2 + (2 * Math.PI * k) / n;
    if (Math.abs(Math.cos(theta / 2)) < 1e-9) {
      out.push([Q(-1), Q(0)]);
      continue;
    }
    // t = tan(θ/2) rounded to a fraction; ((1 − t²)/(1 + t²), 2t/(1 + t²)) is on the circle exactly
    const t = new Rational(BigInt(Math.round(Math.tan(theta / 2) * 4096)), 4096n);
    const t2 = t.multiply(t);
    const den = Q(1).add(t2);
    out.push([Q(1).subtract(t2).divide(den), Q(2).multiply(t).divide(den)]);
  }
  return out;
}
/** Solve A x = b over the rationals (A square, nonsingular), by Gaussian elimination. */
function solveRational(A, B) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  const w = M[0].length;
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && M[p][c].numerator === 0n) p++;
    if (p === n) throw new RangeError("the Tutte system is singular (is the graph connected?)");
    [M[c], M[p]] = [M[p], M[c]];
    const inv = Q(1).divide(M[c][c]);
    for (let j = c; j < w; j++) M[c][j] = M[c][j].multiply(inv);
    for (let r = 0; r < n; r++) {
      if (r === c || M[r][c].numerator === 0n) continue;
      const f = M[r][c];
      for (let j = c; j < w; j++) M[r][j] = M[r][j].subtract(f.multiply(M[c][j]));
    }
  }
  return M.map((row) => row.slice(n));
}
const orient = (a, b, c) => {
  const v = b[0].subtract(a[0]).multiply(c[1].subtract(a[1])).subtract(b[1].subtract(a[1]).multiply(c[0].subtract(a[0])));
  return v.numerator === 0n ? 0 : v.numerator > 0n ? 1 : -1;
};
/** Do the open segments ab and cd cross (exactly)? Segments that share an end do not count. */
function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  // collinear overlaps count as crossings too
  const on = (p, q, r) => orient(p, q, r) === 0 && [0, 1].every((i) => (r[i].compareTo(p[i]) >= 0 && r[i].compareTo(q[i]) <= 0) || (r[i].compareTo(q[i]) >= 0 && r[i].compareTo(p[i]) <= 0));
  const eq = (p, q) => p[0].equals(q[0]) && p[1].equals(q[1]);
  return (o1 === 0 && on(a, b, c) && !eq(c, a) && !eq(c, b)) || (o2 === 0 && on(a, b, d) && !eq(d, a) && !eq(d, b)) || (o3 === 0 && on(c, d, a) && !eq(a, c) && !eq(a, d)) || (o4 === 0 && on(c, d, b) && !eq(b, c) && !eq(b, d));
}

/**
 * Tutte's barycentric drawing. `outer` is the outer face (a cycle of
 * vertices); by default the longest face that `faces` lists (pass
 * discrete's planarity(g).faces), else the first cycle found. Returns
 * { positions (floats, for drawing), exact (Map to [Rational, Rational]),
 * crossings: [[edge, edge], …] (checked exactly), planarDrawing }.
 * For a 3-connected planar graph, Tutte's theorem says the drawing has no
 * crossings and convex faces; the check confirms it for the graph at hand.
 */
export function tutteLayout(g, { outer, faces } = {}) {
  const G = graphData(g);
  const N = neighbours(G);
  let face = outer?.map(S);
  if (!face && faces) {
    const all = faces.flat().filter((f) => Array.isArray(f) && f.length >= 3);
    face = all.reduce((a, b) => (b.length > a.length ? b : a), all[0])?.map(S);
  }
  if (!face) face = findCycle(G, N);
  if (!face || face.length < 3) throw new RangeError("tutteLayout needs a cycle for the outer face");
  const fixed = new Map(face.map((v, i) => [v, rationalCircle(face.length)[i]]));
  const free = G.vertices.filter((v) => !fixed.has(v));
  const idx = new Map(free.map((v, i) => [v, i]));
  const A = free.map(() => free.map(() => Q(0)));
  const B = free.map(() => [Q(0), Q(0)]);
  free.forEach((v, i) => {
    const nb = [...N.get(v)];
    if (!nb.length) throw new RangeError(`vertex ${v} has no neighbours`);
    A[i][i] = Q(nb.length);
    for (const w of nb) {
      if (idx.has(w)) A[i][idx.get(w)] = A[i][idx.get(w)].subtract(Q(1));
      else {
        const p = fixed.get(w);
        B[i][0] = B[i][0].add(p[0]);
        B[i][1] = B[i][1].add(p[1]);
      }
    }
  });
  const X = free.length ? solveRational(A, B) : [];
  const exact = new Map([...fixed, ...free.map((v, i) => [v, X[i]])]);
  const E = G.edges.filter((e) => e.from !== e.to);
  const crossings = [];
  for (let i = 0; i < E.length; i++)
    for (let j = i + 1; j < E.length; j++) {
      const [e, f] = [E[i], E[j]];
      if (e.from === f.from || e.from === f.to || e.to === f.from || e.to === f.to) continue;
      if (segmentsCross(exact.get(e.from), exact.get(e.to), exact.get(f.from), exact.get(f.to))) crossings.push([[e.from, e.to], [f.from, f.to]]);
    }
  const coincide = [];
  const seen = new Map();
  for (const [v, p] of exact) {
    const k = `${p[0]}|${p[1]}`;
    if (seen.has(k)) coincide.push([seen.get(k), v]);
    else seen.set(k, v);
  }
  return Object.freeze({
    positions: new Map([...exact].map(([v, p]) => [v, p.map((c) => c.toNumber())])),
    exact,
    outer: face,
    crossings,
    coincident: coincide,
    planarDrawing: crossings.length === 0 && coincide.length === 0,
  });
}
function findCycle(G, N) {
  // depth-first search for a back edge; returns the cycle it closes
  const parent = new Map();
  const depth = new Map();
  for (const s of G.vertices) {
    if (depth.has(s)) continue;
    const stack = [[s, null]];
    while (stack.length) {
      const [u, p] = stack.pop();
      if (depth.has(u)) continue;
      depth.set(u, p === null ? 0 : depth.get(p) + 1);
      parent.set(u, p);
      for (const w of N.get(u)) {
        if (w === p) continue;
        if (depth.has(w) && depth.get(w) < depth.get(u)) {
          const cyc = [u];
          let x = u;
          while (x !== w) cyc.push((x = parent.get(x)));
          return cyc;
        }
        if (!depth.has(w)) stack.push([w, u]);
      }
    }
  }
  return null;
}

/** Edge crossings of a drawing in floats (for any layout): [[edge, edge], …]. */
export function countCrossings(g, positions) {
  const G = graphData(g);
  const E = G.edges.filter((e) => e.from !== e.to);
  const out = [];
  const cr = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < E.length; i++)
    for (let j = i + 1; j < E.length; j++) {
      const [e, f] = [E[i], E[j]];
      if (new Set([e.from, e.to, f.from, f.to]).size < 4) continue;
      if (cr(positions.get(e.from), positions.get(e.to), positions.get(f.from), positions.get(f.to))) out.push([[e.from, e.to], [f.from, f.to]]);
    }
  return out;
}

// ---- drawing ----------------------------------------------------------------------------------

const LAYOUTS = { circle: circleLayout, grid: gridLayout, layered: layeredLayout, tree: treeLayout, spring: springLayout, bipartite: bipartiteLayout };

/**
 * A graph as a figure. Options:
 *   layout      "circle" (default), "grid", "layered", "tree", "spring",
 *               "bipartite" (with left), "tutte" (with faces or outer), or a
 *               Map of positions
 *   colours     { vertex: k } colour classes (a colouring), or { vertex: css }
 *   highlight   { edges: [[u, v], …], vertices: [...] } drawn bold (a path,
 *               matching, spanning tree, cut)
 *   edgeLabels  true to write each edge's label or weight
 *   accept, start   for automata: double circles and an entry arrow
 *   notes       vertex → text written under it (a Kripke model's atoms)
 */
export function drawGraph(g, options = {}) {
  const G = graphData(g);
  const { layout = "circle", colours, highlight = {}, edgeLabels = G.edges.some((e) => e.label !== undefined), start, accept, notes, title = "" } = options;
  let positions;
  let status = "exact";
  let check = null;
  if (layout instanceof Map) positions = new Map([...layout].map(([v, p]) => [S(v), p.map(Number)]));
  else if (layout === "tutte") {
    const t = tutteLayout(G, options);
    positions = t.positions;
    check = { planarDrawing: t.planarDrawing, crossings: t.crossings };
  } else if (LAYOUTS[layout]) {
    positions = LAYOUTS[layout](G, options);
    if (layout === "spring") status = "estimated";
  } else throw new RangeError(`unknown layout ${layout}`);
  const pts = [...positions.values()];
  const span = Math.max(1e-9, ...["0", "1"].map((i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]))));
  const r = Math.min(0.09 * span, 0.32 * minDistance(pts)) || 0.1;
  const hiE = new Set((highlight.edges ?? []).flatMap(([u, v]) => [`${S(u)}|${S(v)}`, ...(G.directed ? [] : [`${S(v)}|${S(u)}`])]));
  const hiV = new Set((highlight.vertices ?? []).map(S));
  const both = new Set(G.edges.map((e) => `${e.from}|${e.to}`));
  const out = [];
  const labels = [];
  for (const e of G.edges) {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    const hot = hiE.has(`${e.from}|${e.to}`);
    const style = { color: hot ? CATEGORY[1] : "#64748b", width: hot ? 3.2 : 1.6 };
    if (e.from === e.to) {
      // a loop above the vertex
      const loop = [];
      for (let k = 0; k <= 24; k++) {
        const t = -Math.PI / 2 + (2 * Math.PI * k) / 24;
        loop.push([a[0] + 0.9 * r * Math.cos(t), a[1] + 1.55 * r + 0.9 * r * Math.sin(t)]);
      }
      out.push(path(loop, style));
      if (G.directed) out.push(headAt([a[0] + 0.28 * r, a[1] + 0.95 * r], [0.35, -1], r, style.color));
      if (edgeLabels && e.label !== undefined) labels.push(text([a[0], a[1] + 2.6 * r], e.label, { label: e.label, color: style.color, size: 12, anchor: "s" }));
      continue;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / d, dy / d];
    const bend = G.directed && both.has(`${e.to}|${e.from}`) ? 0.18 * d : 0;
    const mid = [(a[0] + b[0]) / 2 - uy * bend, (a[1] + b[1]) / 2 + ux * bend];
    const curve = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      curve.push([(1 - t) * (1 - t) * a[0] + 2 * t * (1 - t) * (2 * mid[0] - (a[0] + b[0]) / 2) + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * t * (1 - t) * (2 * mid[1] - (a[1] + b[1]) / 2) + t * t * b[1]]);
    }
    // trim the ends to the vertex circles
    const trimmed = curve.filter((p) => Math.hypot(p[0] - a[0], p[1] - a[1]) >= r && Math.hypot(p[0] - b[0], p[1] - b[1]) >= r * (G.directed ? 1.05 : 1));
    if (trimmed.length >= 2) out.push(path(trimmed, style));
    if (G.directed && trimmed.length >= 2) {
      const tip = trimmed[trimmed.length - 1];
      const prev = trimmed[trimmed.length - 2];
      out.push(headAt(tip, [tip[0] - prev[0], tip[1] - prev[1]], r, style.color));
    }
    if (edgeLabels && e.label !== undefined) {
      const off = bend ? 0.06 * d : 0.55 * r;
      labels.push(text([mid[0] - uy * off, mid[1] + ux * off], e.label, { label: e.label, color: style.color, size: 12, anchor: "c" }));
    }
  }
  const classes = colours ? colourMap(colours) : null;
  for (const v of G.vertices) {
    const p = positions.get(v);
    const fill = classes?.get(v) ?? "#fff";
    const ring = hiV.has(v) ? CATEGORY[1] : "#334155";
    out.push(path(circlePts(p, r), { closed: true, fill, fillAlpha: classes ? 0.85 : 1, color: ring, width: hiV.has(v) ? 3 : 1.6 }));
    if (accept && new Set([...accept].map(S)).has(v)) out.push(path(circlePts(p, 0.8 * r), { closed: true, color: ring, width: 1.4 }));
    labels.push(text(p, v, { label: v, color: classes ? "#fff" : "currentColor", size: 13 }));
    if (notes?.[v] !== undefined) labels.push(text([p[0], p[1] - 1.3 * r], notes[v], { label: notes[v], color: "#64748b", size: 11, anchor: "s" }));
  }
  if (start !== undefined) {
    const p = positions.get(S(start));
    out.push(path([[p[0] - 2.4 * r, p[1]], [p[0] - 1.1 * r, p[1]]], { color: "#334155", width: 1.6 }), headAt([p[0] - r, p[1]], [1, 0], r, "#334155"));
  }
  const fig = shapes([...out, ...labels]);
  const ext = extentOf([fig]);
  const m = 1.6 * r;
  return figure({ layers: [fig], x: [ext.x[0] - m, ext.x[1] + m], y: [ext.y[0] - m, ext.y[1] + m], equal: true, status, title, positions, check });
}
const minDistance = (pts) => {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  return Number.isFinite(m) ? m : 1;
};
const circlePts = (c, r) => Array.from({ length: 33 }, (_, k) => [c[0] + r * Math.cos((2 * Math.PI * k) / 32), c[1] + r * Math.sin((2 * Math.PI * k) / 32)]);
function headAt(tip, dir, r, color) {
  const d = Math.hypot(...dir) || 1;
  const [ux, uy] = [dir[0] / d, dir[1] / d];
  const h = 0.42 * r;
  return path([tip, [tip[0] - ux * h - uy * h * 0.5, tip[1] - uy * h + ux * h * 0.5], [tip[0] - ux * h + uy * h * 0.5, tip[1] - uy * h - ux * h * 0.5]], { closed: true, fill: color, color, width: 1 });
}
function colourMap(colours) {
  const entries = colours instanceof Map ? [...colours] : Object.entries(colours);
  return new Map(entries.map(([v, c]) => [S(v), typeof c === "number" ? CATEGORY[c % CATEGORY.length] : String(c)]));
}

/** An automaton (logic's Automaton, or { states, start, accept, delta }): states in layers from the start, accepting states doubled. */
export function automatonFigure(a, { layout = "layered", title = "" } = {}) {
  const G = graphData(a);
  return drawGraph(G, { layout, roots: [a.start], start: a.start, accept: a.accept, edgeLabels: true, title });
}

/** A Kripke model (logic's Kripke): worlds with the atoms true at each written under it, arrows for access. */
export function kripkeFigure(k, { layout = "circle", title = "" } = {}) {
  const G = graphData(k);
  const atoms = Object.entries(k.valuation ?? {});
  const notes = Object.fromEntries(G.vertices.map((w) => [w, atoms.filter(([, ws]) => (ws instanceof Set ? ws.has(w) : ws.includes(w))).map(([p]) => p).join(", ") || "∅"]));
  return drawGraph(G, { layout, notes, title });
}
