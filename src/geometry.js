// Exact plane geometry: points, lines, segments, rays, polygons and circles
// with coordinates in Q or Q(√d) (see surd.js), and exact constructions and
// intersections. Nothing here draws or rounds; the renderers in render/ turn
// these objects into pixels.
//
//   const A = point(0, 0), B = point(4, 0), C = point(1, 3);
//   intersect(line(A, C), circle(B, 3));   // points with coordinates like 2 ± √7/... exactly
//   area(polygon([A, B, C]));             // 6
//
// Objects are immutable. Every object has `type`, `toString()` (a readable
// equation or coordinate list) and `toTeX()`.

import { Rational } from "@ratmath/core";
import { Surd, surd } from "./surd.js";
import { linearForm } from "./linear.js";

const S = (x) => (x instanceof Surd ? x : surd(x));
const ZERO = surd(0);
const ONE = surd(1);
const TWO = surd(2);

// ---- objects -------------------------------------------------------------------

export class Point {
  constructor(x, y) {
    this.type = "point";
    this.x = S(x);
    this.y = S(y);
    Object.freeze(this);
  }
  equals(o) {
    return o instanceof Point && this.x.equals(o.x) && this.y.equals(o.y);
  }
  toNumbers() {
    return [this.x.toNumber(), this.y.toNumber()];
  }
  toString() {
    return `(${this.x}, ${this.y})`;
  }
  toTeX() {
    return `\\left(${this.x.toTeX()},\\ ${this.y.toTeX()}\\right)`;
  }
}

/** The line a·x + b·y = c. `p` and `q` are two points on it that fix its direction (q − p). */
export class Line {
  constructor(a, b, c, p, q, type = "line") {
    this.type = type;
    this.a = a;
    this.b = b;
    this.c = c;
    this.p = p;
    this.q = q;
    Object.freeze(this);
  }
  /** Direction vector q − p. */
  get direction() {
    return [this.q.x.subtract(this.p.x), this.q.y.subtract(this.p.y)];
  }
  /** Signed side of a point: sign of a·x + b·y − c (0 on the line). */
  side(P) {
    return this.a.multiply(P.x).add(this.b.multiply(P.y)).subtract(this.c).sign();
  }
  /** Point at parameter t: p + t(q − p). */
  at(t) {
    t = S(t);
    const [dx, dy] = this.direction;
    return new Point(this.p.x.add(dx.multiply(t)), this.p.y.add(dy.multiply(t)));
  }
  /** Parameter t of a point on the line (projection onto the direction). */
  paramOf(P) {
    const [dx, dy] = this.direction;
    return P.x.subtract(this.p.x).multiply(dx).add(P.y.subtract(this.p.y).multiply(dy)).divide(dx.square().add(dy.square()));
  }
  /** Whether parameter t lies on this object (always for a line, t >= 0 for a ray, 0 <= t <= 1 for a segment). */
  allows(t) {
    if (this.type === "line") return true;
    if (t.sign() < 0) return false;
    return this.type === "ray" || t.compareTo(ONE) <= 0;
  }
  contains(P) {
    return this.side(P) === 0 && this.allows(this.paramOf(P));
  }
  /** The infinite line through this object. */
  get carrier() {
    return this.type === "line" ? this : new Line(this.a, this.b, this.c, this.p, this.q, "line");
  }
  toString() {
    const eq = equationString(this.a, this.b, this.c);
    if (this.type === "segment") return `segment ${this.p}–${this.q}`;
    if (this.type === "ray") return `ray from ${this.p} through ${this.q}`;
    return eq;
  }
  toTeX() {
    if (this.type === "segment") return `\\overline{${this.p.toTeX()}\\,${this.q.toTeX()}}`;
    return equationTeX(this.a, this.b, this.c);
  }
}

export class Polygon {
  constructor(vertices) {
    this.type = "polygon";
    this.vertices = Object.freeze(vertices);
    Object.freeze(this);
  }
  get edges() {
    const v = this.vertices;
    return v.map((P, i) => segment(P, v[(i + 1) % v.length]));
  }
  toString() {
    return `polygon ${this.vertices.join(" ")}`;
  }
  toTeX() {
    return this.vertices.map((v) => v.toTeX()).join("\\,");
  }
}

/** Circle with center and squared radius r2 (r2 can be any non-negative surd; r = √r2 when that is exact). */
export class Circle {
  constructor(center, r2) {
    this.type = "circle";
    this.center = center;
    this.r2 = S(r2);
    if (this.r2.sign() < 0) throw new RangeError("circle needs a non-negative squared radius");
    Object.freeze(this);
  }
  get radius() {
    return this.r2.isRational ? Surd.sqrt(this.r2) : null;
  }
  /** -1 inside, 0 on, 1 outside. */
  side(P) {
    return dist2(P, this.center).compareTo(this.r2);
  }
  contains(P) {
    return this.side(P) === 0;
  }
  toString() {
    return `${shifted("x", this.center.x)}^2 + ${shifted("y", this.center.y)}^2 = ${this.r2}`;
  }
  toTeX() {
    const sh = (v, c) => (c.isZero ? `${v}^2` : `\\left(${v} ${c.sign() < 0 ? "+" : "-"} ${c.abs().toTeX()}\\right)^2`);
    return `${sh("x", this.center.x)} + ${sh("y", this.center.y)} = ${this.r2.toTeX()}`;
  }
}

function shifted(v, c) {
  if (c.isZero) return v;
  return `(${v} ${c.sign() < 0 ? "+" : "-"} ${c.abs()})`;
}

// ---- builders --------------------------------------------------------------------

/** point(x, y), point([x, y]) or a Point. Coordinates may be numbers, "3/4", Rationals or Surds. */
export function point(x, y) {
  if (x instanceof Point) return x;
  if (Array.isArray(x)) return new Point(x[0], x[1]);
  if (x && typeof x === "object" && "x" in x && !(x instanceof Rational) && !(x instanceof Surd)) return new Point(x.x, x.y);
  return new Point(x, y);
}

function through(P, Q, type) {
  P = point(P);
  Q = point(Q);
  if (P.equals(Q)) throw new RangeError(`a ${type} needs two different points`);
  // (y1 − y2) x + (x2 − x1) y = x2 y1 − x1 y2
  const a = P.y.subtract(Q.y);
  const b = Q.x.subtract(P.x);
  const c = Q.x.multiply(P.y).subtract(P.x.multiply(Q.y));
  return new Line(a, b, c, P, Q, type);
}

/**
 * line(P, Q): the line through two points.
 * line({ a, b, c }): the line a·x + b·y = c.
 * line("2x - y = 3") is also accepted for linear equations with rational coefficients.
 */
export function line(P, Q) {
  if (typeof P === "string") return lineFromText(P);
  if (P && typeof P === "object" && "a" in P && "b" in P && !(P instanceof Point)) {
    const a = S(P.a);
    const b = S(P.b);
    const c = S(P.c ?? 0);
    if (a.isZero && b.isZero) throw new RangeError("a line needs a or b non-zero");
    // Two points on it: the foot of the perpendicular from the origin, and one step along (−b, a).
    const n2 = a.square().add(b.square());
    const p = new Point(a.multiply(c).divide(n2), b.multiply(c).divide(n2));
    const q = new Point(p.x.subtract(b), p.y.add(a));
    return new Line(a, b, c, p, q, "line");
  }
  return through(P, Q, "line");
}

export const segment = (P, Q) => through(P, Q, "segment");
/** ray(P, Q): starts at P and passes through Q. */
export const ray = (P, Q) => through(P, Q, "ray");

export function polygon(vertices) {
  const v = vertices.map((p) => point(p));
  if (v.length < 3) throw new RangeError("a polygon needs at least 3 vertices");
  return new Polygon(v);
}

/** circle(center, radius), or circle(center, { r2 }) to give the squared radius (e.g. r2: 2 for radius √2). */
export function circle(center, radius) {
  center = point(center);
  if (radius && typeof radius === "object" && "r2" in radius) return new Circle(center, radius.r2);
  const r = S(radius);
  if (r.sign() < 0) throw new RangeError("radius must be non-negative");
  return new Circle(center, r.square());
}

/** The circle through three points (null when they are collinear). */
export function circumcircle(A, B, C) {
  A = point(A);
  B = point(B);
  C = point(C);
  const O = intersect(bisector(A, B), bisector(B, C));
  if (O.length !== 1 || O[0].type !== "point") return null;
  return new Circle(O[0], dist2(O[0], A));
}

// ---- measurements and constructions ---------------------------------------------------

export const dist2 = (P, Q) => {
  P = point(P);
  Q = point(Q);
  return P.x.subtract(Q.x).square().add(P.y.subtract(Q.y).square());
};

/** Exact distance when |PQ|² is rational (it is a Surd like 3√2); throws otherwise. */
export const distance = (P, Q) => Surd.sqrt(dist2(P, Q));

export const midpoint = (P, Q) => {
  P = point(P);
  Q = point(Q);
  return new Point(P.x.add(Q.x).divide(TWO), P.y.add(Q.y).divide(TWO));
};

/** Orientation of P, Q, R: 1 counter-clockwise, -1 clockwise, 0 collinear. */
export function orientation(P, Q, R) {
  [P, Q, R] = [P, Q, R].map((p) => point(p));
  return Q.x.subtract(P.x).multiply(R.y.subtract(P.y)).subtract(Q.y.subtract(P.y).multiply(R.x.subtract(P.x))).sign();
}

/** The line through P parallel to L. */
export function parallel(L, P) {
  P = point(P);
  const [dx, dy] = L.direction;
  return through(P, new Point(P.x.add(dx), P.y.add(dy)), "line");
}

/** The line through P perpendicular to L. */
export function perpendicular(L, P) {
  P = point(P);
  const [dx, dy] = L.direction;
  return through(P, new Point(P.x.subtract(dy), P.y.add(dx)), "line");
}

/** The perpendicular bisector of PQ. */
export function bisector(P, Q) {
  return perpendicular(through(P, Q, "line"), midpoint(P, Q));
}

/** Foot of the perpendicular from P to the line through L. */
export function project(P, L) {
  P = point(P);
  return L.carrier.at(L.paramOf(P));
}

/** Mirror image of P in the line through L. */
export function reflect(P, L) {
  P = point(P);
  const F = project(P, L);
  return new Point(F.x.multiply(TWO).subtract(P.x), F.y.multiply(TWO).subtract(P.y));
}

/** Signed area (positive for counter-clockwise vertices), by the shoelace formula. */
export function signedArea(poly) {
  const v = (poly instanceof Polygon ? poly.vertices : poly).map((p) => point(p));
  let s = ZERO;
  for (let i = 0; i < v.length; i++) {
    const P = v[i];
    const Q = v[(i + 1) % v.length];
    s = s.add(P.x.multiply(Q.y).subtract(Q.x.multiply(P.y)));
  }
  return s.divide(TWO);
}

/**
 * True when no two edges of the polygon meet except neighbours at their
 * shared vertex (so the boundary does not cross or touch itself).
 */
export function isSimple(poly) {
  const P = poly instanceof Polygon ? poly : polygon(poly);
  const e = P.edges;
  const n = e.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const hits = intersect(e[i], e[j]);
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent) {
        if (hits.length) return false;
        continue;
      }
      // neighbours may share only their common vertex
      const shared = j === i + 1 ? P.vertices[j] : P.vertices[0];
      if (hits.length !== 1 || !(hits[0] instanceof Point) || !hits[0].equals(point(shared))) return false;
    }
  }
  return true;
}

/**
 * Area of a simple polygon. A polygon whose boundary crosses itself has no
 * single area, and the shoelace sum cancels parts of it (a bow tie gives 0),
 * so that case is refused; `signedArea` returns the raw sum.
 */
export function area(poly) {
  if (!isSimple(poly)) throw new RangeError("area: the polygon crosses or touches itself; use signedArea for the shoelace sum");
  return signedArea(poly).abs();
}

/** Centroid of a polygon's area. */
export function centroid(poly) {
  const v = (poly instanceof Polygon ? poly.vertices : poly).map((p) => point(p));
  let cx = ZERO;
  let cy = ZERO;
  for (let i = 0; i < v.length; i++) {
    const P = v[i];
    const Q = v[(i + 1) % v.length];
    const cr = P.x.multiply(Q.y).subtract(Q.x.multiply(P.y));
    cx = cx.add(P.x.add(Q.x).multiply(cr));
    cy = cy.add(P.y.add(Q.y).multiply(cr));
  }
  const six = signedArea(v).multiply(surd(6));
  return new Point(cx.divide(six), cy.divide(six));
}

/** Where P lies relative to a polygon (any simple polygon): "inside", "boundary" or "outside". Exact. */
export function locate(poly, P) {
  P = point(P);
  const v = poly.vertices;
  let inside = false;
  for (let i = 0; i < v.length; i++) {
    const A = v[i];
    const B = v[(i + 1) % v.length];
    if (orientation(A, B, P) === 0) {
      const lo = (s, t) => (s.compareTo(t) <= 0 ? [s, t] : [t, s]);
      const [x0, x1] = lo(A.x, B.x);
      const [y0, y1] = lo(A.y, B.y);
      if (P.x.compareTo(x0) >= 0 && P.x.compareTo(x1) <= 0 && P.y.compareTo(y0) >= 0 && P.y.compareTo(y1) <= 0) return "boundary";
    }
    // Ray casting to the right, with the half-open rule on y.
    const ay = A.y.compareTo(P.y) > 0;
    const by = B.y.compareTo(P.y) > 0;
    if (ay !== by) {
      // x of the edge at height P.y, compared with P.x without dividing:
      // sign((B.x − A.x)(P.y − A.y) − (P.x − A.x)(B.y − A.y)) · sign(B.y − A.y)
      const s = B.x.subtract(A.x).multiply(P.y.subtract(A.y)).subtract(P.x.subtract(A.x).multiply(B.y.subtract(A.y))).sign();
      const dir = B.y.compareTo(A.y);
      if (s * dir > 0) inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

/** Convex hull (counter-clockwise, no collinear points), by Andrew's monotone chain. Exact. */
export function convexHull(points) {
  const pts = points.map((p) => point(p)).sort((P, Q) => P.x.compareTo(Q.x) || P.y.compareTo(Q.y));
  const uniq = pts.filter((p, i) => i === 0 || !p.equals(pts[i - 1]));
  if (uniq.length < 3) return uniq;
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && orientation(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(uniq), ...half([...uniq].reverse())];
}

// ---- intersections -----------------------------------------------------------------

const isLinear = (o) => o instanceof Line;

/**
 * Exact intersection of two objects (Point on objects, Line/segment/ray,
 * Circle, Polygon edges). Returns a list: points, or for overlapping
 * collinear pieces the shared line, segment or ray. Coordinates are exact,
 * in Q(√d) where a circle is involved.
 */
export function intersect(A, B) {
  if (A instanceof Point) return B.contains?.(A) || (B instanceof Polygon && locate(B, A) === "boundary") ? [A] : [];
  if (B instanceof Point) return intersect(B, A);
  if (A instanceof Polygon || B instanceof Polygon) {
    const [P, other] = A instanceof Polygon ? [A, B] : [B, A];
    const out = [];
    for (const e of P.edges) for (const r of intersect(e, other)) if (!out.some((s) => sameObject(s, r))) out.push(r);
    return out;
  }
  if (isLinear(A) && isLinear(B)) return linearLinear(A, B);
  if (isLinear(A) && B instanceof Circle) return linearCircle(A, B);
  if (A instanceof Circle && isLinear(B)) return linearCircle(B, A);
  if (A instanceof Circle && B instanceof Circle) return circleCircle(A, B);
  throw new TypeError(`cannot intersect ${A?.type} with ${B?.type}`);
}

function sameObject(r, s) {
  if (r instanceof Point && s instanceof Point) return r.equals(s);
  return false;
}

function linearLinear(L, M) {
  const det = L.a.multiply(M.b).subtract(L.b.multiply(M.a));
  if (det.isZero) {
    // Parallel. Coincident when L's point lies on M's carrier.
    if (M.carrier.side(L.p) !== 0) return [];
    return collinearOverlap(L, M);
  }
  const x = L.c.multiply(M.b).subtract(L.b.multiply(M.c)).divide(det);
  const y = L.a.multiply(M.c).subtract(L.c.multiply(M.a)).divide(det);
  const P = new Point(x, y);
  return L.allows(L.paramOf(P)) && M.allows(M.paramOf(P)) ? [P] : [];
}

// Overlap of two collinear linear objects, in L's parameter.
function collinearOverlap(L, M) {
  const range = (o) => {
    // [lo, hi] in L's parameter; null for unbounded.
    if (o.type === "line") return [null, null];
    const t0 = L.paramOf(o.p);
    const t1 = L.paramOf(o.q);
    if (o.type === "segment") return t0.compareTo(t1) <= 0 ? [t0, t1] : [t1, t0];
    return t1.compareTo(t0) > 0 ? [t0, null] : [null, t0];
  };
  const [a0, a1] = range(L);
  const [b0, b1] = range(M);
  const lo = a0 === null ? b0 : b0 === null ? a0 : a0.compareTo(b0) >= 0 ? a0 : b0;
  const hi = a1 === null ? b1 : b1 === null ? a1 : a1.compareTo(b1) <= 0 ? a1 : b1;
  if (lo !== null && hi !== null) {
    const c = lo.compareTo(hi);
    if (c > 0) return [];
    if (c === 0) return [L.carrier.at(lo)];
    return [segment(L.carrier.at(lo), L.carrier.at(hi))];
  }
  if (lo === null && hi === null) return [L.carrier];
  const C = L.carrier;
  if (lo !== null) return [ray(C.at(lo), C.at(lo.add(ONE)))];
  return [ray(C.at(hi), C.at(hi.subtract(ONE)))];
}

function linearCircle(L, C) {
  // |p + t d − c|² = r²:  (d·d) t² + 2 d·(p − c) t + |p − c|² − r² = 0
  const [dx, dy] = L.direction;
  const ex = L.p.x.subtract(C.center.x);
  const ey = L.p.y.subtract(C.center.y);
  const a = dx.square().add(dy.square());
  const b = dx.multiply(ex).add(dy.multiply(ey)); // half of the linear coefficient
  const c = ex.square().add(ey.square()).subtract(C.r2);
  const disc = b.square().subtract(a.multiply(c)); // quarter discriminant
  const s = disc.sign();
  if (s < 0) return [];
  let ts;
  if (s === 0) ts = [b.negate().divide(a)];
  else {
    if (!disc.isRational) throw new RangeError("this intersection needs nested square roots; that needs @ratmath/algebraic");
    const r = Surd.sqrt(disc);
    ts = [b.negate().subtract(r).divide(a), b.negate().add(r).divide(a)];
  }
  return ts.filter((t) => L.allows(t)).map((t) => L.carrier.at(t));
}

function circleCircle(C, D) {
  if (C.center.equals(D.center)) return C.r2.equals(D.r2) ? [C] : [];
  // Subtracting the equations gives the radical axis:
  // 2(c2 − c1)·X = |c2|² − |c1|² − r2² + r1²
  const a = D.center.x.subtract(C.center.x).multiply(TWO);
  const b = D.center.y.subtract(C.center.y).multiply(TWO);
  const n = (P) => P.x.square().add(P.y.square());
  const c = n(D.center).subtract(n(C.center)).subtract(D.r2).add(C.r2);
  return linearCircle(line({ a, b, c }), C);
}

// ---- text forms ----------------------------------------------------------------------

/** Scale a, b, c (all rational) to coprime integers with a > 0 (or b > 0 when a = 0). */
function integerCoefficients(a, b, c) {
  if (![a, b, c].every((s) => s.isRational)) return null;
  const qs = [a.a, b.a, c.a];
  const gcd = (x, y) => {
    x = x < 0n ? -x : x;
    y = y < 0n ? -y : y;
    while (y) [x, y] = [y, x % y];
    return x;
  };
  let l = 1n;
  for (const q of qs) l = (l / gcd(l, q.denominator)) * q.denominator;
  let ints = qs.map((q) => (q.numerator * l) / q.denominator);
  const g = ints.reduce((x, y) => gcd(x, y), 0n) || 1n;
  ints = ints.map((v) => v / g);
  if (ints[0] < 0n || (ints[0] === 0n && ints[1] < 0n)) ints = ints.map((v) => -v);
  return ints;
}

function equationString(a, b, c) {
  const ints = integerCoefficients(a, b, c);
  const terms = ints ? [[ints[0], "x"], [ints[1], "y"]] : [[a, "x"], [b, "y"]];
  const rhs = ints ? ints[2] : c;
  let s = "";
  for (const [k, v] of terms) {
    const z = typeof k === "bigint" ? k === 0n : k.isZero;
    if (z) continue;
    const neg = typeof k === "bigint" ? k < 0n : k.sign() < 0;
    const mag = typeof k === "bigint" ? (neg ? -k : k) : k.abs();
    const coef = String(mag) === "1" ? "" : typeof k === "bigint" || mag.isRational ? String(mag) : `(${mag})`;
    s += s ? ` ${neg ? "-" : "+"} ${coef}${v}` : `${neg ? "-" : ""}${coef}${v}`;
  }
  return `${s} = ${rhs}`;
}

function equationTeX(a, b, c) {
  const ints = integerCoefficients(a, b, c);
  if (ints) return equationString(a, b, c).replace(/ - /g, " - ");
  const term = (k, v, first) => {
    if (k.isZero) return "";
    const neg = k.sign() < 0;
    const m = k.abs();
    const coef = m.equals(ONE) ? "" : m.isRational ? m.toTeX() : `\\left(${m.toTeX()}\\right)`;
    return first ? `${neg ? "-" : ""}${coef}${v}` : ` ${neg ? "-" : "+"} ${coef}${v}`;
  };
  const x = term(a, "x", true);
  return `${x}${term(b, "y", !x)} = ${c.toTeX()}`;
}

function lineFromText(text) {
  const m = /^([^=]+)=([^=]+)$/.exec(text);
  if (!m) throw new SyntaxError(`expected an equation like 2x - y = 3: ${text}`);
  const coeffs = linearCoefficients(m[1]);
  const right = linearCoefficients(m[2]);
  // a x + b y + c = a' x + b' y + c'
  return line({ a: coeffs.a.subtract(right.a), b: coeffs.b.subtract(right.b), c: right.c.subtract(coeffs.c) });
}

function linearCoefficients(text) {
  const f = linearForm(text);
  if (!f) throw new SyntaxError(`not linear in x and y: ${text}`);
  return { a: surd(f.a), b: surd(f.b), c: surd(f.c) };
}
