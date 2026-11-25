// Exact regions bounded by conics.
//
//   region("x^2 + y^2 <= 4 and y >= x^2 - 1", {}, vp).exact()
//
// When every comparison is a polynomial of degree at most two in x and y
// with rational coefficients, the region is worked out exactly rather than
// pixel by pixel. The plane is cut into vertical strips at the places where
// something happens: two curves meet, a curve turns back, a curve leaves the
// frame. Those places are real algebraic numbers, found and told apart
// exactly by @ratmath/algebraic. Inside a strip the curves are graphs that
// never touch, so they stack in a fixed order, and the condition is constant
// on each cell between two neighbours: one exact evaluation at a rational
// point settles the whole cell.
//
// The result says which arcs of which curves bound the region, whether each
// arc belongs to it (solid) or not (dashed), and where arcs of different
// curves meet: corners with exact coordinates such as (√2, √2), each marked
// as in or out of the region.
//
// A shear x = u + s·y with a small rational s is applied first so that no
// line of the problem (the frame's sides included) is vertical, and every
// curve is y = a line in u, or the two roots of a monic quadratic in y.

import { Rational } from "@ratmath/core";
import { roots, compare, fromRational, add, mul } from "@ratmath/algebraic";
import { atoms as atomsOf, evalFloat } from "./condition.js";
import { rationalForm, addPoly, mulPoly, powPoly, totalDegree, coefficient, constant } from "./polyform.js";
import { describeNumber } from "./exactform.js";

/** Thrown when a condition is outside what the exact method handles; region() then classifies pixels. */
export class NotConic extends Error {}
class Ambiguous extends Error {}

const Q = (n, d = 1n) => new Rational(BigInt(n), BigInt(d));
const ZERO = Q(0);
const ONE = Q(1);
const HALF = Q(1, 2);
const isZero = (q) => q.numerator === 0n;
const sign = (q) => (q.numerator > 0n ? 1 : q.numerator < 0n ? -1 : 0);
const lt = (a, b) => a.compareTo(b) < 0;
const pair = (q) => [q.numerator, q.denominator];
const BITS = [64, 256, 1024, 4096];

// ---- polynomials in one variable: arrays of Rationals, constant first ---------------------

const trim = (p) => {
  while (p.length && isZero(p[p.length - 1])) p.pop();
  return p;
};
const padd = (a, b, s = 1) => trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? ZERO).add(s < 0 ? (b[i] ?? ZERO).negate() : b[i] ?? ZERO)));
const pmul = (a, b) => {
  if (!a.length || !b.length) return [];
  const out = Array(a.length + b.length - 1).fill(ZERO);
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) out[i + j] = out[i + j].add(a[i].multiply(b[j]));
  return trim(out);
};
const pscale = (a, c) => trim(a.map((x) => x.multiply(c)));
const peval = (p, x) => p.reduceRight((acc, c) => acc.multiply(x).add(c), ZERO);
const pfloat = (p) => {
  const f = p.map((c) => c.toNumber());
  return (x) => {
    let acc = 0;
    for (let i = f.length - 1; i >= 0; i -= 1) acc = acc * x + f[i];
    return acc;
  };
};

// ---- intervals with rational ends ----------------------------------------------------------

const iadd = (a, b) => [a[0].add(b[0]), a[1].add(b[1])];
const imul = (a, b) => {
  const c = [a[0].multiply(b[0]), a[0].multiply(b[1]), a[1].multiply(b[0]), a[1].multiply(b[1])];
  let lo = c[0];
  let hi = c[0];
  for (const v of c) {
    if (lt(v, lo)) lo = v;
    if (lt(hi, v)) hi = v;
  }
  return [lo, hi];
};
const iscale = (a, c) => (sign(c) >= 0 ? [a[0].multiply(c), a[1].multiply(c)] : [a[1].multiply(c), a[0].multiply(c)]);
const ipoint = (c) => [c, c];
const ipeval = (p, X) => p.reduceRight((acc, c) => iadd(imul(acc, X), ipoint(c)), ipoint(ZERO));
const isign = (a) => (sign(a[0]) > 0 ? 1 : sign(a[1]) < 0 ? -1 : sign(a[0]) === 0 && sign(a[1]) === 0 ? 0 : null);

function isqrt(n) {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
/** Rational bounds [lo, hi] on √q, within 2^-bits of each other. */
function sqrtBounds(q, bits) {
  if (sign(q) <= 0) return [ZERO, ZERO];
  const scaled = (q.numerator * q.denominator) << BigInt(2 * bits);
  const r = isqrt(scaled);
  const den = q.denominator << BigInt(bits);
  return [new Rational(r, den), new Rational(r * r === scaled ? r : r + 1n, den)];
}
const isqrtI = (a, bits) => [sqrtBounds(a[0], bits)[0], sqrtBounds(a[1], bits)[1]];

/** A simple rational strictly between a < b. */
function between(a, b) {
  const m = a.add(b).multiply(HALF);
  // the shortest decimal-free fraction near the middle: try small denominators
  for (const d of [1n, 2n, 4n, 8n, 16n, 64n, 256n, 1024n]) {
    const n = (m.numerator * d) / m.denominator;
    for (const k of [n, n + 1n, n - 1n]) {
      const c = new Rational(k, d);
      if (lt(a, c) && lt(c, b)) return c;
    }
  }
  return m;
}

// ---- reading the condition ------------------------------------------------------------------

/** Value of a two-variable polynomial (Map form) at a rational point. */
function evalAt(p, x, y) {
  let s = ZERO;
  for (const [key, c] of p) {
    const [i, j] = key.split(",").map(Number);
    let t = c;
    for (let k = 0; k < i; k += 1) t = t.multiply(x);
    for (let k = 0; k < j; k += 1) t = t.multiply(y);
    s = s.add(t);
  }
  return s;
}
function ievalAt(p, X, Y) {
  let s = ipoint(ZERO);
  for (const [key, c] of p) {
    const [i, j] = key.split(",").map(Number);
    let t = ipoint(c);
    for (let k = 0; k < i; k += 1) t = imul(t, X);
    for (let k = 0; k < j; k += 1) t = imul(t, Y);
    s = iadd(s, t);
  }
  return s;
}

/**
 * The comparisons of a condition as polynomials of degree at most two in x
 * and y: [{ atom, poly }], or null when some comparison is not one (or all
 * are lines, which exactLinearRegion handles).
 */
export function conicAtoms(tree, params = {}) {
  const list = atomsOf(tree);
  if (list.length > 10) return null;
  const out = [];
  let curved = false;
  for (const atom of list) {
    const form = rationalForm(atom.F, ["x", "y"], params);
    if (!form || form.den.size !== 1 || !form.den.has("0,0")) return null;
    const poly = new Map([...form.num].map(([k, c]) => [k, c.divide(form.den.get("0,0"))]));
    const deg = totalDegree(poly);
    if (deg > 2) return null;
    if (deg === 2) curved = true;
    out.push({ atom, poly });
  }
  return curved ? out : null;
}

/** The name of a curve of degree at most two. */
export function conicType(poly) {
  const c = (i, j) => coefficient(poly, i, j);
  if (totalDegree(poly) < 2) return totalDegree(poly) === 1 ? "line" : "none";
  const [a, b, cc, d, e, f] = [c(2, 0), c(1, 1), c(0, 2), c(1, 0), c(0, 1), c(0, 0)];
  // 8·det of the conic's matrix
  const det = Q(4).multiply(a).multiply(cc).multiply(f).add(b.multiply(d).multiply(e)).subtract(a.multiply(e).multiply(e)).subtract(cc.multiply(d).multiply(d)).subtract(f.multiply(b).multiply(b));
  const disc = b.multiply(b).subtract(Q(4).multiply(a).multiply(cc));
  if (isZero(det)) return sign(disc) > 0 ? "two lines" : sign(disc) < 0 ? "point" : "parallel lines";
  if (sign(disc) > 0) return "hyperbola";
  if (isZero(disc)) return "parabola";
  // an ellipse with no real points has (a + c)·det > 0
  if (sign(a.add(cc).multiply(det)) > 0) return "empty";
  return isZero(b) && a.equals(cc) ? "circle" : "ellipse";
}

/** p(u + s·y, y) for a polynomial in (x, y). */
function shear(poly, s) {
  const X = new Map([["1,0", ONE]]);
  if (!isZero(s)) X.set("0,1", s);
  let out = new Map();
  for (const [key, c] of poly) {
    const [i, j] = key.split(",").map(Number);
    out = addPoly(out, mulPoly(mulPoly(constant(c), powPoly(X, i)), new Map([[`0,${j}`, ONE]])));
  }
  return out;
}

/** A sheared polynomial as a curve: a line y = L(u), or a monic quadratic y² + B(u)·y + C(u). Null when its top coefficient in y is not constant. */
function curveOf(G) {
  const c = (i, j) => coefficient(G, i, j);
  const deg = totalDegree(G);
  if (deg === 2) {
    const A = c(0, 2);
    if (isZero(A)) return null;
    const B = trim([c(0, 1).divide(A), c(1, 1).divide(A)]);
    const C = trim([c(0, 0).divide(A), c(1, 0).divide(A), c(2, 0).divide(A)]);
    const D = padd(pmul(B, B), pscale(C, Q(4)), -1);
    if (!D.length) return { lin: pscale(B, Q(-1, 2)) }; // a doubled line
    return { B, C, D };
  }
  const b = c(0, 1);
  if (isZero(b)) return null;
  return { lin: trim([c(0, 0).divide(b).negate(), c(1, 0).divide(b).negate()]) };
}
const curveKey = (cv) => (cv.lin ? `L|${cv.lin.join(",")}` : `Q|${cv.B.join(",")}|${cv.C.join(",")}`);

/** The polynomial in u whose roots are where two curves meet. */
function meet(a, b) {
  if (a.lin && b.lin) return padd(a.lin, b.lin, -1);
  if (a.lin || b.lin) {
    const [l, q] = a.lin ? [a.lin, b] : [b.lin, a];
    return padd(padd(pmul(l, l), pmul(q.B, l)), q.C);
  }
  const dc = padd(b.C, a.C, -1);
  const db = padd(b.B, a.B, -1);
  return padd(pmul(dc, dc), pmul(db, padd(pmul(a.B, b.C), pmul(b.B, a.C), -1)), -1);
}

// ---- eliminating a variable, in the original coordinates -------------------------------------

/** p as a polynomial in variable `v` (0 for x, 1 for y) with coefficients in the other. */
function inVariable(p, v) {
  const out = [[], [], []];
  for (const [key, c] of p) {
    const e = key.split(",").map(Number);
    const mine = e[v];
    const other = e[1 - v];
    while (out[mine].length <= other) out[mine].push(ZERO);
    out[mine][other] = c;
  }
  return out.map(trim);
}
/** A polynomial in the other variable that vanishes wherever p = q = 0. Null when there is none of use. */
function eliminate(p, q, v) {
  const P = inVariable(p, v);
  const R = inVariable(q, v);
  const deg = (c) => (c[2].length ? 2 : c[1].length ? 1 : 0);
  let [f, g] = deg(P) <= deg(R) ? [P, R] : [R, P];
  let out;
  if (deg(f) === 0) out = f[0];
  else if (deg(g) === 1) out = padd(pmul(f[1], g[0]), pmul(f[0], g[1]), -1);
  else if (deg(f) === 1) out = padd(padd(pmul(g[2], pmul(f[0], f[0])), pmul(g[1], pmul(f[0], f[1])), -1), pmul(g[0], pmul(f[1], f[1])));
  else {
    const ac = padd(pmul(f[2], g[0]), pmul(g[2], f[0]), -1);
    const ab = padd(pmul(f[2], g[1]), pmul(g[2], f[1]), -1);
    const bc = padd(pmul(f[1], g[0]), pmul(g[1], f[0]), -1);
    out = padd(pmul(ac, ac), pmul(ab, bc), -1);
  }
  return out.length >= 2 ? out : null;
}

// ---- the decomposition ------------------------------------------------------------------------

const SHEARS = [Q(1, 3), Q(-2, 5), Q(3, 7), Q(-1, 4), Q(5, 9), Q(-4, 7), Q(2, 11), Q(-7, 10)];

/**
 * The exact region of a condition whose comparisons are conics (see the file
 * comment), clipped to the viewport. `list` comes from conicAtoms. Throws
 * NotConic when the curves share a component or no shear separates them.
 */
export function exactConicRegion(tree, list, vp, options = {}) {
  let last;
  for (const s of SHEARS) {
    try {
      return decompose(tree, list, vp, s, options);
    } catch (e) {
      if (!(e instanceof Ambiguous)) throw e;
      last = e;
    }
  }
  throw new NotConic(last?.message ?? "no shear separates the curves");
}

function decompose(tree, list, vp, s, { samples = null } = {}) {
  // --- atoms and curves ---
  const frameAtoms = [
    { frame: true, poly: new Map([["0,0", vp.xmin], ["1,0", Q(-1)]]) },
    { frame: true, poly: new Map([["0,0", vp.xmax.negate()], ["1,0", ONE]]) },
    { frame: true, poly: new Map([["0,0", vp.ymin], ["0,1", Q(-1)]]) },
    { frame: true, poly: new Map([["0,0", vp.ymax.negate()], ["0,1", ONE]]) },
  ];
  const all = [...list.map((a) => ({ ...a })), ...frameAtoms];
  const curves = [];
  const byKey = new Map();
  for (const a of all) {
    a.G = shear(a.poly, s);
    a.curve = null;
    if (totalDegree(a.G) < 1) continue;
    const cv = curveOf(a.G);
    if (!cv) throw new Ambiguous("a line of the condition is vertical under this shear");
    const key = curveKey(cv);
    if (!byKey.has(key)) {
      cv.index = curves.length;
      cv.atoms = [];
      cv.user = false;
      byKey.set(key, cv);
      curves.push(cv);
    }
    const curve = byKey.get(key);
    curve.atoms.push(a);
    if (!a.frame) curve.user = true;
    a.curve = curve.index;
  }
  for (const cv of curves) {
    const first = cv.atoms.find((a) => !a.frame) ?? cv.atoms[0];
    cv.poly = first.poly;
    cv.text = first.atom?.text ?? "frame";
    if (cv.lin) {
      const L = pfloat(cv.lin);
      cv.y = [L];
    } else {
      const B = pfloat(cv.B);
      const D = pfloat(cv.D);
      cv.y = [(u) => (-B(u) - Math.sqrt(Math.max(0, D(u)))) / 2, (u) => (-B(u) + Math.sqrt(Math.max(0, D(u)))) / 2];
    }
  }
  const signsMap = (signs) => new Map(list.map((a, k) => [a.atom, signs[k]]));
  const userTruth = (signs) => evalFloat(tree, signsMap(signs));
  const inFrame = (signs) => signs.slice(list.length).every((v) => v <= 0);

  // --- critical values of u ---
  const uCorners = [vp.xmin.subtract(s.multiply(vp.ymin)), vp.xmin.subtract(s.multiply(vp.ymax)), vp.xmax.subtract(s.multiply(vp.ymin)), vp.xmax.subtract(s.multiply(vp.ymax))];
  const uMin = fromRational(uCorners.reduce((a, b) => (lt(b, a) ? b : a)));
  const uMax = fromRational(uCorners.reduce((a, b) => (lt(a, b) ? b : a)));
  const found = [];
  const note = (p, tag) => {
    if (p.length < 2) return;
    for (const { value } of roots(p)) if (compare(value, uMin) >= 0 && compare(value, uMax) <= 0) found.push({ value, tag });
  };
  for (const cv of curves) if (!cv.lin) note(cv.D, `tip:${cv.index}`);
  for (let i = 0; i < curves.length; i += 1) {
    for (let j = i + 1; j < curves.length; j += 1) {
      const p = meet(curves[i], curves[j]);
      if (!p.length) throw new NotConic("two of the curves share a line");
      note(p, `${i},${j}`);
    }
  }
  found.sort((a, b) => compare(a.value, b.value));
  const crit = [];
  for (const f of found) {
    const prev = crit[crit.length - 1];
    if (prev && compare(prev.value, f.value) === 0) prev.tags.add(f.tag);
    else crit.push({ value: f.value, tags: new Set([f.tag]), u: f.value.toNumber() });
  }
  if (crit.length < 2) throw new NotConic("nothing to decompose");

  const enclosureOf = (c, bits) => {
    c.value.refine(bits);
    return [new Rational(c.value.lo[0], c.value.lo[1]), new Rational(c.value.hi[0], c.value.hi[1])];
  };

  // --- the points on each critical line ---
  for (const c of crit) {
    const values = [];
    for (const cv of curves) {
      if (cv.lin) values.push({ k: cv.index, b: 0, at: (U) => ipeval(cv.lin, U) });
      else if (c.tags.has(`tip:${cv.index}`)) values.push({ k: cv.index, b: "tip", at: (U) => iscale(ipeval(cv.B, U), Q(-1, 2)) });
      else {
        let sg = null;
        for (const bits of BITS) {
          sg = isign(ipeval(cv.D, enclosureOf(c, bits)));
          if (sg !== null && sg !== 0) break;
        }
        if (sg === null || sg === 0) throw new NotConic("could not decide a discriminant's sign");
        if (sg < 0) continue;
        for (const b of [0, 1]) {
          values.push({
            k: cv.index, b,
            at: (U, bits) => {
              const r = isqrtI(ipeval(cv.D, U), bits);
              const half = iscale(b ? r : [r[1].negate(), r[0].negate()], HALF);
              return iadd(iscale(ipeval(cv.B, U), Q(-1, 2)), half);
            },
          });
        }
      }
    }
    for (const v of values) {
      v.cache = new Map();
      v.enc = (bits) => {
        if (!v.cache.has(bits)) v.cache.set(bits, v.at(enclosureOf(c, bits), bits));
        return v.cache.get(bits);
      };
      v.parent = v;
    }
    const top = (v) => (v.parent === v ? v : (v.parent = top(v.parent)));
    const apart = (a, b, bits) => lt(a.enc(bits)[1], b.enc(bits)[0]) || lt(b.enc(bits)[1], a.enc(bits)[0]);
    // which values coincide: only where the two curves are known to meet at this u
    for (let i = 0; i < curves.length; i += 1) {
      for (let j = i + 1; j < curves.length; j += 1) {
        if (!c.tags.has(`${i},${j}`)) continue;
        const vi = values.filter((v) => v.k === i);
        const vj = values.filter((v) => v.k === j);
        if (!vi.length || !vj.length) continue;
        let close = null;
        for (const bits of BITS.slice(0, 3)) {
          close = [];
          for (const a of vi) for (const b of vj) if (!apart(a, b, bits)) close.push([a, b]);
          if (close.length <= 1) break;
        }
        if (close.length !== 1) throw new Ambiguous("two crossings share a strip boundary");
        top(close[0][0]).parent = top(close[0][1]);
      }
    }
    const groups = new Map();
    for (const v of values) {
      const t = top(v);
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(v);
    }
    const order = (a, b) => {
      for (const bits of BITS) {
        if (lt(a.enc(bits)[1], b.enc(bits)[0])) return -1;
        if (lt(b.enc(bits)[1], a.enc(bits)[0])) return 1;
      }
      throw new NotConic("could not order two points");
    };
    c.points = [...groups.entries()].map(([rep, members]) => ({ rep, members })).sort((p, q) => order(p.rep, q.rep));
    c.where = new Map();
    c.points.forEach((P, idx) => {
      P.index = idx;
      P.crit = c;
      P.curves = new Set(P.members.map((m) => m.k));
      const e = P.rep.enc(64);
      P.yu = (e[0].toNumber() + e[1].toNumber()) / 2;
      P.x = c.u + s.toNumber() * P.yu;
      P.y = P.yu;
      for (const m of P.members) {
        if (m.b === "tip") {
          c.where.set(`${m.k},0`, idx);
          c.where.set(`${m.k},1`, idx);
        } else c.where.set(`${m.k},${m.b}`, idx);
      }
      // signs of every comparison at the point
      P.signs = all.map((a) => {
        if (a.curve === null) return sign(coefficient(a.G, 0, 0));
        if (P.curves.has(a.curve)) return 0;
        for (const bits of BITS) {
          const sg = isign(ievalAt(a.G, enclosureOf(c, bits), P.rep.enc(bits)));
          if (sg) return sg;
        }
        throw new NotConic("could not decide a sign at a point");
      });
      P.user = userTruth(P.signs);
      P.inFrame = inFrame(P.signs);
      P.arcs = [];
      P.cells = [];
    });
  }

  // --- strips ---
  const strips = [];
  for (let i = 0; i + 1 < crit.length; i += 1) {
    const a = crit[i];
    const b = crit[i + 1];
    let u0 = null;
    for (let bits = 8; bits <= 8192 && !u0; bits *= 2) {
      const ea = enclosureOf(a, bits);
      const eb = enclosureOf(b, bits);
      if (lt(ea[1], eb[0])) u0 = between(ea[1], eb[0]);
    }
    if (!u0) throw new NotConic("could not separate two critical values");
    // the curves over u0, bottom to top
    const vals = [];
    for (const cv of curves) {
      if (cv.lin) {
        const v = peval(cv.lin, u0);
        vals.push({ k: cv.index, b: 0, enc: () => [v, v] });
      } else {
        const D0 = peval(cv.D, u0);
        if (sign(D0) <= 0) continue;
        const mid = peval(cv.B, u0).multiply(Q(-1, 2));
        for (const br of [0, 1]) {
          vals.push({
            k: cv.index, b: br,
            enc: (bits) => {
              const r = sqrtBounds(D0, bits).map((x) => x.multiply(HALF));
              return br ? [mid.add(r[0]), mid.add(r[1])] : [mid.subtract(r[1]), mid.subtract(r[0])];
            },
          });
        }
      }
    }
    const order = (p, q) => {
      for (const bits of BITS) {
        const ep = p.enc(bits);
        const eq = q.enc(bits);
        if (lt(ep[1], eq[0])) return -1;
        if (lt(eq[1], ep[0])) return 1;
      }
      throw new NotConic("could not order two branches");
    };
    vals.sort(order);
    // one rational sample in every cell: below the first branch, between neighbours, above the last
    const ys = [];
    for (let j = 0; j <= vals.length; j += 1) {
      if (j === 0) ys.push(vals[0].enc(64)[0].subtract(ONE));
      else if (j === vals.length) ys.push(vals[j - 1].enc(64)[1].add(ONE));
      else {
        let y0 = null;
        for (const bits of BITS) {
          const lo = vals[j - 1].enc(bits)[1];
          const hi = vals[j].enc(bits)[0];
          if (lt(lo, hi)) {
            y0 = between(lo, hi);
            break;
          }
        }
        ys.push(y0);
      }
    }
    const cells = ys.map((y0) => {
      const x0 = u0.add(s.multiply(y0));
      const signs = all.map((a2) => sign(evalAt(a2.poly, x0, y0)));
      return { signs, user: userTruth(signs), frame: inFrame(signs) };
    });
    for (const cell of cells) cell.full = cell.user && cell.frame;
    const strip = { i, a, b, vals, cells, arcs: [] };
    // where each branch ends on the two critical lines
    for (const v of vals) {
      v.left = a.where.get(`${v.k},${v.b}`);
      v.right = b.where.get(`${v.k},${v.b}`);
      if (v.left === undefined || v.right === undefined) throw new NotConic("a branch has no end point");
    }
    // cells touching each point
    for (let j = 0; j < cells.length; j += 1) {
      const loL = j > 0 ? vals[j - 1].left : -1;
      const hiL = j < vals.length ? vals[j].left : Infinity;
      const loR = j > 0 ? vals[j - 1].right : -1;
      const hiR = j < vals.length ? vals[j].right : Infinity;
      for (const P of a.points) if (P.index >= loL && P.index <= hiL) P.cells.push(cells[j]);
      for (const P of b.points) if (P.index >= loR && P.index <= hiR) P.cells.push(cells[j]);
    }
    // arcs: a branch with different truth on its two sides, or on it
    vals.forEach((v, j) => {
      const cv = curves[v.k];
      if (!cv.user) return;
      const below = cells[j];
      const above = cells[j + 1];
      const on = below.signs.map((sg, k) => (all[k].curve === v.k ? 0 : sg));
      if (!inFrame(on)) return;
      const onTruth = userTruth(on);
      let role = null;
      if (below.user !== above.user) role = "boundary";
      else if (below.user && !onTruth) role = "cut";
      else if (!below.user && onTruth) role = "curve";
      if (!role) return;
      const arc = { k: v.k, role, strict: !onTruth, on: onTruth, strip, j, from: a.points[v.left], to: b.points[v.right] };
      strip.arcs.push(arc);
      arc.from.arcs.push(arc);
      arc.to.arcs.push(arc);
    });
    strips.push(strip);
  }

  // --- drawing data: sample every strip in u, bunched towards its ends ---
  const sf = s.toNumber();
  const dx = vp.f.dx;
  const sampleStrip = (strip) => {
    if (strip.us) return strip.us;
    const w = strip.b.u - strip.a.u;
    const n = samples ?? Math.max(8, Math.min(96, Math.ceil(w / dx / 3)));
    strip.us = Array.from({ length: n + 1 }, (_, k) => strip.a.u + (w * (1 - Math.cos((Math.PI * k) / n))) / 2);
    return strip.us;
  };
  const trace = (strip, v) => {
    const us = sampleStrip(strip);
    const f = curves[v.k].y[v.b];
    const pts = [];
    us.forEach((u, k) => {
      const y = k === 0 ? strip.a.points[v.left].yu : k === us.length - 1 ? strip.b.points[v.right].yu : f(u);
      pts.push(u + sf * y, y);
    });
    return pts;
  };
  const fill = [];
  let area = 0;
  for (const strip of strips) {
    const { vals, cells } = strip;
    for (let j = 1; j < cells.length - 1; j += 1) {
      if (!cells[j].full) continue;
      let top = j;
      while (top + 1 < cells.length - 1 && cells[top + 1].full) top += 1;
      const lower = trace(strip, vals[j - 1]);
      const upper = trace(strip, vals[top]);
      const poly = lower.slice();
      for (let k = upper.length - 2; k >= 0; k -= 2) poly.push(upper[k], upper[k + 1]);
      fill.push(Float64Array.from(poly));
      // area by Simpson's rule in the bunched variable (the shear keeps areas)
      const fl = curves[vals[j - 1].k].y[vals[j - 1].b];
      const fu = curves[vals[top].k].y[vals[top].b];
      const w = strip.b.u - strip.a.u;
      const N = 512;
      let sum = 0;
      for (let k = 0; k <= N; k += 1) {
        const t = (Math.PI * k) / N;
        const u = strip.a.u + (w * (1 - Math.cos(t))) / 2;
        const g = (fu(u) - fl(u)) * Math.sin(t);
        sum += g * (k === 0 || k === N ? 1 : k % 2 ? 4 : 2);
      }
      area += (sum * Math.PI * w) / (2 * 3 * N);
      j = top;
    }
  }

  // --- special points, and joining arcs through ordinary ones ---
  const corners = [];
  const points = [];
  const special = new Set();
  for (const c of crit) {
    for (const P of c.points) {
      if (!P.inFrame) continue;
      const A = P.arcs;
      const through = [...new Set(A.map((arc) => arc.k))];
      const onFrameLine = [...P.curves].some((k) => curves[k].atoms.some((a2) => a2.frame));
      if (!A.length) {
        const inside = P.cells.filter((cell) => cell.frame);
        if (P.user && inside.every((cell) => !cell.user)) points.push(mark(P, "isolated"));
        else if (!P.user && inside.length && inside.every((cell) => cell.user)) points.push(mark(P, "puncture"));
        continue;
      }
      const smooth = A.length === 2 && through.length === 1 && A[0].role === A[1].role && A[0].strict === A[1].strict && A[0] !== A[1];
      if (smooth && P.user === A[0].on) continue;
      if (through.length >= 2) {
        special.add(P);
        corners.push({ ...mark(P), between: through.map((k) => curves[k].text) });
      } else if (smooth || !(onFrameLine && A.length === 1)) {
        special.add(P);
        points.push({ ...mark(P, !smooth ? "node" : P.user ? "included" : "excluded"), on: curves[through[0]].text });
      }
    }
  }
  function mark(P, kind) {
    const out = { x: P.x, y: P.y, included: P.user, ...exactPoint(P) };
    if (kind) out.kind = kind;
    return out;
  }
  function exactPoint(P) {
    try {
      const c = P.crit;
      const ks = [...P.curves];
      let X = null;
      let Y = null;
      const tip = P.members.find((m) => m.b === "tip");
      const line = P.members.find((m) => curves[m.k].lin);
      if (line || tip) {
        // y is a polynomial in u here
        const p = line ? curves[line.k].lin : pscale(curves[tip.k].B, Q(-1, 2));
        // (x is written as its own polynomial in u: adding two irrational numbers is far slower)
        const at = (poly) => poly.reduceRight((acc, co) => add(mul(acc, c.value), fromRational(pair(co))), fromRational(0n));
        Y = at(p);
        X = at(padd([ZERO, ONE], pscale(p, s)));
      } else if (ks.length >= 2) {
        const pick = (v, enc) => {
          const p = eliminate(curves[ks[0]].poly, curves[ks[1]].poly, v);
          if (!p) return null;
          // the coordinate is one of p's roots: the only one whose isolating interval can reach the enclosure
          const inside = roots(p).map((r) => r.value).filter((r) => {
            r.refine(160);
            const lo = new Rational(r.lo[0], r.lo[1]);
            const hi = new Rational(r.hi[0], r.hi[1]);
            return !lt(hi, enc[0]) && !lt(enc[1], lo);
          });
          return inside.length === 1 ? inside[0] : null;
        };
        const U = enclosureOf(c, 128);
        const Yi = P.rep.enc(256);
        Y = pick(0, Yi);
        X = pick(1, iadd(U, iscale(Yi, s)));
      }
      if (!X || !Y) return {};
      const fx = form(X);
      const fy = form(Y);
      return { exact: { x: fx, y: fy }, text: `(${fx.text}, ${fy.text})`, tex: `\\left(${fx.tex},\\ ${fy.tex}\\right)` };
    } catch (e) {
      if (e instanceof NotConic || e instanceof Ambiguous) throw e;
      return {};
    }
  }

  // chains of arcs
  let chains = [];
  for (const strip of strips) {
    for (const arc of strip.arcs) chains.push({ k: arc.k, role: arc.role, strict: arc.strict, pts: trace(strip, strip.vals[arc.j]), from: arc.from, to: arc.to });
  }
  const reverse = (ch) => {
    const pts = [];
    for (let k = ch.pts.length - 2; k >= 0; k -= 2) pts.push(ch.pts[k], ch.pts[k + 1]);
    return { ...ch, pts, from: ch.to, to: ch.from };
  };
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i += 1) {
      for (let j = i + 1; j < chains.length; j += 1) {
        const a = chains[i];
        let b = chains[j];
        if (a.k !== b.k || a.role !== b.role || a.strict !== b.strict) continue;
        let joined = null;
        const ok = (P) => !special.has(P) && P.inFrame && P.arcs.length === 2;
        if (a.to === b.from && ok(a.to)) joined = [a, b];
        else if (a.to === b.to && ok(a.to)) joined = [a, reverse(b)];
        else if (a.from === b.to && ok(a.from)) joined = [b, a];
        else if (a.from === b.from && ok(a.from)) joined = [reverse(b), a];
        if (!joined) continue;
        const [p, q] = joined;
        chains[i] = { ...p, pts: [...p.pts, ...q.pts.slice(2)], to: q.to };
        chains.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  const user = curves.filter((cv) => cv.user);
  const arcs = chains.map((ch) => ({
    curve: user.indexOf(curves[ch.k]),
    text: curves[ch.k].text,
    role: ch.role,
    strict: ch.strict,
    closed: ch.from === ch.to,
    from: [ch.from.x, ch.from.y],
    to: [ch.to.x, ch.to.y],
    points: Float64Array.from(ch.pts),
  }));

  return {
    kind: "conics",
    viewport: vp,
    curves: user.map((cv) => ({ text: cv.text, type: conicType(cv.poly) })),
    fill,
    arcs,
    corners,
    points,
    area,
    complete: true,
  };
}

const fracTeX = (q) => (q.denominator === 1n ? `${q.numerator}` : `${q.numerator < 0n ? "-" : ""}\\frac{${q.numerator < 0n ? -q.numerator : q.numerator}}{${q.denominator}}`);

/** An exact coordinate for display: a fraction, a closed form such as √2, or digits. */
function form(a) {
  if (a.rational) {
    const q = new Rational(a.rational[0], a.rational[1]);
    return { value: q, text: q.toString().replace("-", "−"), tex: fracTeX(q), closedForm: true };
  }
  return describeNumber(a);
}
