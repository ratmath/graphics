import type { Rational, RationalInterval } from "@ratmath/core";

export type RationalInput = number | bigint | string | Rational;
export type Params = Record<string, RationalInput>;

export type Ast =
  | { type: "num"; value: Rational }
  | { type: "var"; name: string }
  | { type: "const"; name: "pi" | "e" }
  | { type: "op"; op: "+" | "-" | "*" | "/" | "^" | "neg"; args: Ast[] }
  | { type: "call"; name: string; args: Ast[] };

export interface ViewportSpec {
  x: [RationalInput, RationalInput];
  y: [RationalInput, RationalInput];
  width: number;
  height: number;
}
export interface Viewport {
  readonly xmin: Rational; readonly xmax: Rational; readonly ymin: Rational; readonly ymax: Rational;
  readonly width: number; readonly height: number; readonly dx: Rational; readonly dy: Rational;
}

export interface Asymptote { px: number; certain: boolean; kind?: "pole" | "log"; exact?: boolean; at?: Rational; lo?: Rational; hi?: Rational; denominator?: string }
export interface Polyline { kind: "polyline"; points: Float64Array; asymptotes: Asymptote[] }
export interface Cells {
  kind: "cells"; width: number; height: number;
  /** columns[i] = [top, bottom, top, bottom, ...], inclusive rows, 0 at the top. */
  columns: number[][];
  tight: boolean; evaluations: number; complete: boolean;
  /** Certified vertical asymptotes. */
  asymptotes: Asymptote[];
  /** Removable points, drawn as open dots. */
  holes?: (Hole & { px: number })[];
  /** Points where f has no value and no pole was proven (sin(1/x) at 0). */
  undefined?: (UndefinedPoint & { px: number })[];
}

export type FloatStage<T> = { stage: "float"; exact: false; value: T; trust: "good" | "rough" | "unsure" };
export type ProgressStage<P = unknown> = { stage: "progress"; exact: false; done: number; of: number; step?: string; partial?: P };
export type ExactStage<E> = { stage: "exact"; exact: true; value: E; via: string };

export class Refinement<T, E, P = unknown> {
  constructor(quick: () => { value: T; trust: FloatStage<T>["trust"] }, exact: () => Generator<Omit<ProgressStage<P>, "stage" | "exact">, { value: E; via: string }>);
  readonly quick: FloatStage<T>;
  readonly settled: boolean;
  stages(): Generator<FloatStage<T> | ProgressStage<P> | ExactStage<E>>;
  exactStage(): ExactStage<E>;
  exact(): E;
  settle(options?: { signal?: AbortSignal; sliceMs?: number; onStage?: (s: FloatStage<T> | ExactStage<E>) => void; onProgress?: (p: ProgressStage<P>) => void }): Promise<E>;
}

export function live<A extends unknown[], T, E, P>(
  compute: (...args: A) => Refinement<T, E, P>,
  onStage: (stage: FloatStage<T> | ExactStage<E>, job: Refinement<T, E, P>) => void,
  options?: { idleMs?: number; sliceMs?: number; onProgress?: (p: ProgressStage<P>) => void; onError?: (e: unknown) => void },
): ((...args: A) => Refinement<T, E, P>) & { cancel(): void };

export interface GraphOptions { variable?: string; samplesPerPixel?: number; maxDepth?: number; extraBits?: number; partialEvery?: number }
export function graph(f: string | Ast, params: Params, vp: ViewportSpec | Viewport, options?: GraphOptions): Refinement<Polyline, Cells, Cells>;
export function sampleFloat(f: string | Ast, params: Params, vp: ViewportSpec | Viewport, options?: GraphOptions): Polyline;
export function certifyGraph(f: string | Ast, params: Params, vp: ViewportSpec | Viewport, options?: GraphOptions): Generator<{ done: number; of: number; step: string; partial?: Cells }, { value: Cells; via: string }>;

/**
 * A zero. "exact", "sign-change" and "isolated" are proven; "possible" could
 * not be decided; "everywhere" means f is zero on all of [lo, hi].
 */
export interface Zero {
  kind: "exact" | "sign-change" | "isolated" | "possible" | "everywhere";
  exact: boolean; at?: Rational; lo: Rational; hi: Rational;
  unique?: boolean; multiplicity?: number; atMost?: number;
  /** The zero in closed form (√2, ∛2, (1 + √5)/2), when f is a rational function. */
  algebraic?: AlgebraicForm;
}
/**
 * An algebraic number written out: `text` and `tex` are a closed form when
 * `closedForm` is true and certified digits otherwise; `polynomial` is its
 * minimal polynomial (integer coefficients, constant first) and `value` the
 * AlgebraicReal from @ratmath/algebraic.
 */
export interface AlgebraicForm { value: unknown; text: string; tex: string; polynomial: bigint[]; degree: number; closedForm: boolean }
export interface ZeroOptions { variable?: string; tolerance?: RationalInput; pieces?: number; maxDepth?: number; samples?: number }
export function zeros(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): Refinement<number[], Zero[]>;
export function findZeros(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): Zero[];
export function floatZeros(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): number[];
export function zerosGenerator(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Zero[]>;

export function simplestBetween(lo: Rational, hi: Rational): Rational;

/** A located point: exact (`at`) or a certified bracket [lo, hi]. */
interface Located { exact: boolean; at?: Rational; lo: Rational; hi: Rational; /** The point in closed form, when f is a rational function. */ algebraic?: AlgebraicForm }
/** f's value there: exact `value`, or a certified enclosure [valueLo, valueHi]. */
interface Valued { value?: Rational; valueLo?: Rational | null; valueHi?: Rational | null; /** The height in closed form. */ valueAlgebraic?: AlgebraicForm }
export interface Pole extends Located { kind: "pole" | "log"; certain: true; order?: number }
export interface Hole extends Located, Valued { kind: "hole"; valueApprox?: number }
/** f has no value there and no pole was proven. */
export interface UndefinedPoint extends Located { kind: "undefined"; certain: false }
export interface Endpoint extends Located, Valued { kind: "endpoint"; side: "left" | "right" | "isolated"; included: boolean }
/** Where two graphs meet: a zero of f − g with the common value. */
export type Intersection = Zero & Valued;
export interface Extremum extends Located, Valued { kind: "max" | "min" | "flat" | "critical"; unique?: boolean }
export interface Inflection extends Located, Valued { kind: "inflection" | "possible"; unique?: boolean }
export interface Features {
  zeros: Zero[]; poles: Pole[]; holes: Hole[]; undefined: UndefinedPoint[];
  endpoints: Endpoint[]; extrema: Extremum[]; inflections: Inflection[];
}
export interface FloatFeatures {
  zeros: number[]; poles: { x: number }[];
  extrema: { kind: "max" | "min" | "flat"; x: number; y: number }[];
  inflections: { x: number; y: number }[];
}
type Range = [RationalInput, RationalInput];
export function features(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Refinement<FloatFeatures, Features>;
export function featuresGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, { value: Features; via: string }>;
export function floatFeatures(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): FloatFeatures;
export function findPoles(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Pole[];
export function findHoles(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Hole[];
/** Poles, holes and undefined points together. */
export function polesGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, (Pole | Hole | UndefinedPoint)[]>;
/** Ends of the domain inside the range (sqrt, even roots, asin, acos). */
export function findEndpoints(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Endpoint[];
export function endpointsGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Endpoint[]>;
/** Arguments u whose sign bounds the domain (u ≥ 0 required). */
export function domainArguments(ast: Ast): Ast[];
/** Where y = f(x) and y = g(x) meet. */
export function intersections(f: string | Ast, g: string | Ast, params: Params, range: Range, options?: ZeroOptions): Refinement<{ x: number; y: number }[], Intersection[]>;
export function findIntersections(f: string | Ast, g: string | Ast, params: Params, range: Range, options?: ZeroOptions): Intersection[];
export function intersectionsGenerator(f: string | Ast, g: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Intersection[]>;

// ---- parametric and polar curves ---------------------------------------------------------------
export interface CurveOptions { variable?: string; samples?: number; maxDepth?: number; maxBoxes?: number; pieces?: number }
/** The curve (x(t), y(t)) for t in [t0, t1]: float polyline, then certified cells. */
export function parametric(curve: { x: string | Ast; y: string | Ast }, params: Params, range: Range, vp: ViewportSpec | Viewport, options?: CurveOptions): Refinement<Polyline, Cells>;
/** The polar curve r = r(t): (r cos t, r sin t). */
export function polar(r: string | Ast, params: Params, range: Range, vp: ViewportSpec | Viewport, options?: CurveOptions): Refinement<Polyline, Cells>;
export function sampleParametric(curve: { x: string | Ast; y: string | Ast }, params: Params, range: Range, vp: ViewportSpec | Viewport, options?: CurveOptions): Polyline;
export function certifyParametric(curve: { x: string | Ast; y: string | Ast }, params: Params, range: Range, vp: ViewportSpec | Viewport, options?: CurveOptions): Generator<{ done: number; of: number; step: string }, { value: Cells; via: string }>;

// ---- data plots, slope fields, ODE solutions ---------------------------------------------------
export type DataPoint = [RationalInput, RationalInput] | { x: RationalInput; y: RationalInput };
/** Data points in world coordinates [x0, y0, x1, y1, …]. */
export interface PointsFrame { kind: "points"; data: Float64Array; join: boolean }
/** Bars as [x0, x1, y0, y1, …] in world coordinates. */
export interface BarsFrame { kind: "bars"; bars: Float64Array; edges?: number[]; counts?: number[] }
/** Segments as [x0, y0, x1, y1, …] in world coordinates. */
export interface SegmentsFrame { kind: "segments"; segments: Float64Array }
export function scatter(data: DataPoint[], options?: { join?: boolean }): PointsFrame;
export function bars(data: DataPoint[], options?: { width?: RationalInput; baseline?: number }): BarsFrame;
export function histogram(values: RationalInput[], options?: { bins?: number; range?: [RationalInput, RationalInput]; density?: boolean }): BarsFrame & { edges: number[]; counts: number[] };
/** Slope field of y′ = f(x, y). */
export function slopeField(f: string | Ast, params: Params, vp: ViewportSpec | Viewport, options?: { spacing?: number; length?: number; variables?: [string, string] }): SegmentsFrame;
/** The solution of one ODE as a curve; `spec` is what @ratmath/analytic's ode.solve takes. */
export function solutionCurve(spec: { f: string | Ast; y0: RationalInput; t0?: RationalInput; until: RationalInput; [option: string]: unknown }, vp: ViewportSpec | Viewport): Refinement<Polyline, Cells & { reason: string | null; final: unknown }>;

// ---- descriptions ------------------------------------------------------------------------------
export interface DescribeOptions extends ZeroOptions { digits?: number; max?: number }
/** A plain-language description of the graph from its certified features (for alt text). */
export function describe(f: string | Ast, params: Params, range: Range, options?: DescribeOptions): string;
export function describeFeatures(f: string | Ast, range: Range, features: Partial<Features>, options?: DescribeOptions): string;
export function findExtrema(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Extremum[];
export function extremaGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Extremum[]>;
export function findInflections(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Inflection[];
export function inflectionsGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Inflection[]>;
export function denominators(ast: Ast): { D: Ast; N: Ast; kind: "pole" | "log" }[];
/** f rewritten for logarithmic axes: u = log10 x on the x-axis, log10 f on the y-axis. */
export function logScale(f: string | Ast, options?: { x?: boolean; y?: boolean; variable?: string }): Ast;
export function derive(ast: Ast, variable?: string): Ast;
export function format(ast: Ast): string;

export function viewport(spec: ViewportSpec): Viewport;
export function precisionFor(vp: Viewport, extraBits?: number): number;
export function columnRationals(vp: Viewport, i: number): [Rational, Rational];

export function parse(text: string): Ast;
export function num(value: RationalInput): Ast;
export function v(name: string): Ast;
export function op(o: "+" | "-" | "*" | "/" | "^" | "neg", ...args: Ast[]): Ast;
export function call(name: string, ...args: Ast[]): Ast;
export function toRational(value: RationalInput): Rational;
export function freeVariables(ast: Ast): Set<string>;
export function isRationalOnly(ast: Ast): boolean;
export function compileFloat(ast: Ast, variable?: string): (x: number, params: Record<string, number>) => number;
export function compileInterval(ast: Ast, variable?: string): (ctx: unknown, X: unknown, P: Record<string, unknown>) => unknown;
export function compileExact(ast: Ast, variable?: string): ((x: Rational, params: Record<string, Rational>) => Rational | null) | undefined;
export const FUNCTIONS: Set<string>;
export const CONSTANTS: Set<string>;

export function drawCanvas(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, value: Polyline | Cells, options?: { color?: string; lineWidth?: number; scale?: number; cellAlpha?: number; asymptoteColor?: string }): void;
// ---- feature markers ---------------------------------------------------------------------------
export interface Marker { x: number; y: number; role: "zero" | "extremum" | "inflection" | "hole" | "endpoint"; filled: boolean }
/** The dots to draw for a features value (float estimates or certified). */
export function markerList(features: Partial<Features> | Partial<FloatFeatures>): Marker[];
export function drawMarkers(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, vp: Viewport, features: Partial<Features> | Partial<FloatFeatures>, options?: { color?: string; background?: string; scale?: number; radius?: number }): void;
/** Mix a color toward black (amount < 0) or white (amount > 0). */
export function shade(color: string, amount: number): string;
export function drawAsymptotes(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, value: Polyline | Cells, options?: { color?: string; scale?: number }): void;
export function toSVG(value: Polyline | Cells, options?: { width?: number; height?: number; color?: string; lineWidth?: number; background?: string }): string;

export const interval: Record<string, unknown>;

// ---- exact numbers a + b√d ----------------------------------------------------------
export class Surd {
  readonly a: Rational; readonly b: Rational; readonly d: bigint;
  static from(x: RationalInput | Surd): Surd;
  static sqrt(q: RationalInput | Surd): Surd;
  readonly isRational: boolean; readonly isZero: boolean;
  add(o: RationalInput | Surd): Surd; subtract(o: RationalInput | Surd): Surd; multiply(o: RationalInput | Surd): Surd; divide(o: RationalInput | Surd): Surd;
  negate(): Surd; reciprocal(): Surd; square(): Surd; conjugate(): Surd; norm(): Rational; abs(): Surd; sqrt(): Surd;
  sign(): -1 | 0 | 1; compareTo(o: RationalInput | Surd): -1 | 0 | 1; equals(o: RationalInput | Surd): boolean; lessThan(o: RationalInput | Surd): boolean;
  toRational(): Rational; bounds(bits?: number): [Rational, Rational]; toNumber(): number; toString(): string; toTeX(): string;
}
export function surd(a: RationalInput | Surd, b?: RationalInput, d?: bigint | number): Surd;
export function sqrt(q: RationalInput | Surd): Surd;
export function squareFree(n: bigint): [bigint, bigint];

// ---- geometry --------------------------------------------------------------------------
type Coord = RationalInput | Surd;
export type PointInput = Point | [Coord, Coord] | { x: Coord; y: Coord };
export class Point { readonly type: "point"; readonly x: Surd; readonly y: Surd; equals(o: Point): boolean; toNumbers(): [number, number]; toString(): string; toTeX(): string }
export class Line {
  readonly type: "line" | "segment" | "ray"; readonly a: Surd; readonly b: Surd; readonly c: Surd; readonly p: Point; readonly q: Point;
  readonly direction: [Surd, Surd]; readonly carrier: Line;
  side(P: Point): -1 | 0 | 1; at(t: Coord): Point; paramOf(P: Point): Surd; allows(t: Surd): boolean; contains(P: Point): boolean; toString(): string; toTeX(): string;
}
export class Polygon { readonly type: "polygon"; readonly vertices: readonly Point[]; readonly edges: Line[]; toString(): string; toTeX(): string }
export class Circle { readonly type: "circle"; readonly center: Point; readonly r2: Surd; readonly radius: Surd | null; side(P: Point): -1 | 0 | 1; contains(P: Point): boolean; toString(): string; toTeX(): string }
export type Shape = Point | Line | Polygon | Circle;
export function point(x: Coord | PointInput, y?: Coord): Point;
export function line(P: PointInput | string | { a: Coord; b: Coord; c?: Coord }, Q?: PointInput): Line;
export function segment(P: PointInput, Q: PointInput): Line;
export function ray(P: PointInput, Q: PointInput): Line;
export function polygon(vertices: PointInput[]): Polygon;
export function circle(center: PointInput, radius: Coord | { r2: Coord }): Circle;
export function circumcircle(A: PointInput, B: PointInput, C: PointInput): Circle | null;
export function intersect(A: Shape, B: Shape): Shape[];
export function dist2(P: PointInput, Q: PointInput): Surd;
export function distance(P: PointInput, Q: PointInput): Surd;
export function midpoint(P: PointInput, Q: PointInput): Point;
export function orientation(P: PointInput, Q: PointInput, R: PointInput): -1 | 0 | 1;
export function parallel(L: Line, P: PointInput): Line;
export function perpendicular(L: Line, P: PointInput): Line;
export function bisector(P: PointInput, Q: PointInput): Line;
export function project(P: PointInput, L: Line): Point;
export function reflect(P: PointInput, L: Line): Point;
export function signedArea(poly: Polygon | PointInput[]): Surd;
/** Area of a simple polygon; throws a RangeError when the boundary crosses or touches itself. */
export function area(poly: Polygon | PointInput[]): Surd;
/** True when no two edges meet except neighbours at their shared vertex. */
export function isSimple(poly: Polygon | PointInput[]): boolean;
export function centroid(poly: Polygon | PointInput[]): Point;
export function locate(poly: Polygon, P: PointInput): "inside" | "boundary" | "outside";
export function convexHull(points: PointInput[]): Point[];

// ---- conditions, regions, implicit curves ------------------------------------------------
export type Condition =
  | { op: "and" | "or"; args: Condition[] }
  | { op: "not"; arg: Condition }
  | { op: "cmp"; rel: "<" | "<=" | "=" | "!="; F: Ast; text: string };
export function parseCondition(text: string): Condition;
export function atoms(tree: Condition): Extract<Condition, { op: "cmp" }>[];
export function dnf(tree: Condition, limit?: number): Extract<Condition, { op: "cmp" }>[][];
export function negationFree(tree: Condition): Condition;
export function linearForm(f: string | Ast, params?: Params): { a: Rational; b: Rational; c: Rational } | null;

export interface RegionSketch { kind: "region-sketch"; width: number; height: number; fill: number[]; edges: { strict: boolean; points: Float64Array }[] }
export interface RegionCells { kind: "region"; width: number; height: number; inside: number[]; boundary: number[][]; boxes: number; complete: boolean }
export interface RegionPolygons {
  kind: "polygons"; viewport: Viewport; complete: true;
  pieces: { vertices: Point[]; area: Surd }[];
  boundary: { from: Point; to: Point; strict: boolean; text: string }[];
  corners: { point: Point; included: boolean; between: [string, string] }[];
  lines: ({ segment: Line; atom: unknown } | { point: Point; atom: unknown })[];
}
export interface ImplicitCells extends Cells { sure: number[][] & { count: number }; boxes: number }
/** An exact coordinate: a Rational, or an algebraic number with its closed form. */
export type ExactCoordinate = { value: Rational; text: string; tex: string; closedForm: true } | AlgebraicForm;
/** A marked point of a conic region: floats for drawing, exact coordinates where they were found. */
export interface ConicPoint { x: number; y: number; included: boolean; exact?: { x: ExactCoordinate; y: ExactCoordinate }; text?: string; tex?: string }
/**
 * A region bounded by conics, worked out exactly. `arcs` are the pieces of
 * curve that bound it ("boundary"), are removed from it ("cut") or stand
 * alone ("curve"): strict ones are not part of the region and draw dashed.
 * `corners` are where arcs of different curves meet. `points` are single
 * points that differ from their surroundings: "isolated" (in the region,
 * alone), "puncture" (missing from its inside), "included" / "excluded" (on
 * an arc that says otherwise) and "node" (where one curve crosses itself or
 * ends). `fill` holds polygons (world coordinates, x then y) that draw the
 * region, and `area` is its area to about seven digits.
 */
export interface RegionConics {
  kind: "conics"; viewport: Viewport; complete: true;
  curves: { text: string; type: ConicType }[];
  fill: Float64Array[];
  arcs: { curve: number; text: string; role: "boundary" | "cut" | "curve"; strict: boolean; closed: boolean; from: [number, number]; to: [number, number]; points: Float64Array }[];
  corners: (ConicPoint & { between: string[] })[];
  points: (ConicPoint & { kind: "isolated" | "puncture" | "included" | "excluded" | "node"; on?: string })[];
  area: number;
}
export type ConicType = "circle" | "ellipse" | "parabola" | "hyperbola" | "two lines" | "parallel lines" | "point" | "empty" | "line" | "none";
/** A polynomial in two variables: exponents "i,j" to coefficient. */
export type Polynomial2 = Map<string, Rational>;
/** The comparisons of a condition as polynomials of degree at most two, or null when it is not bounded by conics. */
export function conicAtoms(tree: Condition, params?: Params): { atom: Extract<Condition, { op: "cmp" }>; poly: Polynomial2 }[] | null;
/** The exact region for conicAtoms' result; throws NotConic when the method does not apply. */
export function exactConicRegion(tree: Condition, atoms: { atom: unknown; poly: Polynomial2 }[], vp: Viewport, options?: { samples?: number }): RegionConics;
export function conicType(poly: Polynomial2): ConicType;
export class NotConic extends Error {}
export interface RegionOptions { method?: "pixels"; subpixel?: number; tile?: number; extraBits?: number; step?: number; /** Points per strip on a conic arc. */ samples?: number }
export function region(cond: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: RegionOptions): Refinement<RegionSketch, RegionPolygons | RegionConics | RegionCells, RegionCells>;
export function implicit(eq: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: RegionOptions): Refinement<Polyline, ImplicitCells>;
/** The condition as convex pieces with exact linear edges, or null when some part is not linear. */
export function linearPieces(cond: string | Condition, params?: Params): unknown[] | null;
/** The exact polygons of linear pieces clipped to the viewport. */
export function exactLinearRegion(pieces: unknown[], vp: Viewport): RegionPolygons;
export function sketchRegion(cond: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: { step?: number }): RegionSketch;
export function sketchImplicit(eq: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: { step?: number }): Polyline;
export function classify(tree: Condition, params: Params, vp: Viewport, options?: RegionOptions): Generator<{ done: number; of: number; step: string; partial?: RegionCells }, RegionCells>;

// ---- scenes and labels ----------------------------------------------------------------------
export interface Label { type: "label"; x: number; y: number; tex: string; text: string; anchor: string; dx: number; dy: number; color?: string; size: number }
export interface Style { color?: string; width?: number; dash?: number[]; fill?: string; fillAlpha?: number; radius?: number; open?: boolean; background?: string; label?: string | true; anchor?: string; corners?: boolean; cornerLabels?: boolean; labelColor?: string; negativeFill?: string; alpha?: number; asymptoteColor?: string }
export type Frame = Polyline | Cells | RegionSketch | RegionCells | RegionPolygons | RegionConics | PointsFrame | BarsFrame | SegmentsFrame | AreaFrame | ArrowsFrame | MeshFrame | ShapesFrame | ImageFrame;
export type Layer = Shape | Label | Frame | ({ item: Shape | Frame } & Style);
export type Primitive =
  | { t: "path"; subpaths: number[][]; closed?: boolean; fill?: string; fillAlpha?: number; stroke?: string | null; width?: number; dash?: number[]; alpha?: number }
  | { t: "rects"; rects: number[]; fill: string; alpha?: number }
  | { t: "dot"; x: number; y: number; r: number; fill: string; stroke: string; width?: number }
  | { t: "label"; x: number; y: number; tex?: string; text: string; anchor: string; color?: string; size?: number; plain?: boolean };
export interface AxesOptions {
  grid?: string | false; axis?: string; text?: string; ticks?: boolean; target?: number;
  /** "pi" labels multiples of π, "fraction" labels fractions. */
  xUnit?: "pi" | "fraction"; yUnit?: "pi" | "fraction";
  /** "log": the coordinate is log10 of the quantity; ticks are powers of ten. */
  xScale?: "log"; yScale?: "log";
}
export interface SceneOptions { axes?: boolean | AxesOptions; background?: string; scale?: number; colors?: string[]; labels?: boolean; font?: string }
export function label(at: PointInput | [RationalInput, RationalInput], tex: string, options?: { anchor?: string; dx?: number; dy?: number; color?: string; size?: number; text?: string }): Label;
export function texToText(tex: string): string;
export function primitives(vp: Viewport, layers: Layer[], options?: { colors?: string[] }): Primitive[];
export function axesPrimitives(vp: Viewport, options?: AxesOptions): Primitive[];
export function niceStep(span: number, target?: number): number;
export function paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, prims: Primitive[], options?: { scale?: number; background?: string; font?: string; labels?: boolean }): void;
export function drawScene(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, vp: Viewport, layers: Layer[], options?: SceneOptions): Primitive[];
export function mountLabels(container: HTMLElement, vp: Viewport, layersOrPrims: Layer[] | Primitive[], options?: { katex?: { render(tex: string, el: HTMLElement, opts?: object): void }; className?: string }): HTMLElement;
export function svgElements(prims: Primitive[], options?: { tex?: (latex: string) => string; font?: string }): string;
export function sceneSVG(vp: Viewport, layers: Layer[], options?: SceneOptions & { tex?: (latex: string) => string; width?: number; height?: number }): string;
export const PALETTE: string[];

// ---- export: TikZ and text ----------------------------------------------------------------------
export interface TikZOptions extends SceneOptions {
  /** Picture width in cm (default 10). */ width?: number;
  /** Picture height in cm (default keeps the viewport's aspect ratio). */ height?: number;
  /** Points per scene pixel for line widths, dashes and dot radii (default 0.5). */ pt?: number;
  /** Decimals in coordinates (default: a tenth of a pixel). */ precision?: number;
  /** Polyline tolerance in pixels (default 0.25; 0 keeps every point). */ simplify?: number;
  /** Clip drawing to the viewport (default true). */ clip?: boolean;
  /** Wrap in a complete standalone LaTeX document. */ standalone?: boolean;
  /** Extra preamble lines for standalone documents. */ preamble?: string;
  /** Header comment with the viewport (default true). */ comment?: boolean;
}
export function sceneTikZ(vp: Viewport, layers: Layer[], options?: TikZOptions): string;
export function scenePGFPlots(vp: Viewport, layers: Layer[], options?: TikZOptions & { axisOptions?: string }): string;
export function tikzElements(vp: Viewport, prims: Primitive[], options?: Omit<TikZOptions, "width" | "height" | "standalone" | "preamble" | "comment" | "axes"> & { colors?: Map<string, string>; before?: string[]; after?: string[] }): string;
export function tikzAxes(vp: Viewport, axes?: AxesOptions, options?: { colors?: Map<string, string>; pt?: number; precision?: number }): { lines: string[]; labels: string[] };
export function simplifyPolyline(points: number[], tolerance: number): number[];
export interface TextOptions extends SceneOptions {
  /** Characters across (default 72). */ cols?: number;
  /** Lines (default keeps the viewport's shape with 2:1 characters). */ rows?: number;
  /** Character set (default "ascii"). */ mode?: "ascii" | "braille" | "blocks";
  /** Frame the picture. */ border?: boolean;
  /** 24-bit ANSI terminal colors. */ color?: boolean;
  /** Axis character color with color: true. */ axisColor?: string;
}
export function sceneASCII(vp: Viewport, layers: Layer[], options?: TextOptions): string;
export function asciiElements(vp: Viewport, prims: Primitive[], options?: TextOptions): string;
export function asciiText(text: string): string;
export interface PNGOptions extends SceneOptions { scale?: number; engine?: "auto" | "canvas" | "software" }
export function scenePNG(vp: Viewport, layers: Layer[], options?: PNGOptions): Promise<Uint8Array>;
export function rasterize(vp: Viewport, prims: Primitive[], options?: { scale?: number; background?: string; labels?: boolean }): { width: number; height: number; data: Uint8ClampedArray };
export function encodePNG(image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, options?: { dpi?: number }): Promise<Uint8Array>;
export function scenePDF(vp: Viewport, layers: Layer[], options?: SceneOptions & { pt?: number; title?: string }): Uint8Array;
export function pdfContent(vp: Viewport, prims: Primitive[], options?: { background?: string; labels?: boolean }): { content: string; states: Map<string, string> };
export function pdfTextRuns(text: string): [font: "F1" | "F2", bytes: string, width: number][];

// ---- exact forms ------------------------------------------------------------------------------
/** A string, a parsed tree, or an object carrying one in `.ast` (an @ratmath/analytic function). */
export function toAst(f: string | Ast | { ast: Ast }): Ast;
/** LaTeX for a closed form written with √, ∛ and fractions. */
export function radicalTeX(text: string): string;
/** The tree as a quotient of polynomials in one or two variables, or null when it is not one. */
export function rationalForm(ast: Ast, variables: string[], params?: Params): { num: Polynomial2; den: Polynomial2 } | null;
/** Attach closed forms to feature records of f (features() and intersections() already do). */
export function withAlgebraicForms<T extends object>(records: T[], ast: Ast, params: Params, options?: { variable?: string; derivativeOrder?: number | "denominator"; values?: boolean; valueAst?: Ast | null; maxDegree?: number }): T[];
/** Labels for the points in a features value, in exact form where one is known. */
export function featureLabels(features: Partial<Features> & { intersections?: Intersection[] }, options?: { digits?: number; kinds?: string[]; anchor?: string; size?: number; color?: string }): Label[];

// ---- calculus pictures --------------------------------------------------------------------------
export type Fn = string | Ast | { ast: Ast };
/** Exact when rational, a certified enclosure otherwise. */
export type Certified = Rational | RationalInterval;
export interface CalculusOptions { digits?: number; variable?: string }
export interface Tangent { x: Rational; value: Certified; slope: Certified; exact: boolean; point: Point; line: Line; equation: string; layers: Layer[] }
export function tangent(f: Fn, x0: RationalInput, params?: Params, options?: CalculusOptions): Tangent;
export function secant(f: Fn, a: RationalInput, b: RationalInput, params?: Params, options?: CalculusOptions): { slope: Certified; exact: boolean; points: [Point, Point]; line: Line; layers: Layer[] };
/** Shading between two graphs: polygons in world coordinates where f is above g and where it is below. */
export interface AreaFrame { kind: "area"; above: Float64Array[]; below: Float64Array[]; outline?: boolean; from?: number; to?: number }
export interface AreaSketch extends AreaFrame { integral: number }
export interface AreaResult extends AreaFrame { integral: Certified | number; improper: boolean; certified: boolean }
/** An end of an interval: a number, a fraction, a constant such as "pi/2", or "inf" / "-inf". */
export type End = RationalInput;
export function areaBetween(f: Fn, g: Fn, interval: [End, End], params: Params, vp: ViewportSpec | Viewport, options?: CalculusOptions & { samples?: number }): Refinement<AreaSketch, AreaResult>;
export function areaUnder(f: Fn, interval: [End, End], params: Params, vp: ViewportSpec | Viewport, options?: CalculusOptions & { samples?: number }): Refinement<AreaSketch, AreaResult>;
export type RiemannRule = "left" | "right" | "midpoint" | "trapezoid" | "lower" | "upper";
export type RiemannSum = (BarsFrame | AreaFrame) & { sum: Rational | number; exact: boolean; rule: RiemannRule; n: number; width: Rational; heights?: (Rational | number)[] };
export function riemannSum(f: Fn, interval: [RationalInput, RationalInput], n: number, params?: Params, options?: { rule?: RiemannRule; variable?: string }): RiemannSum;
export function taylorPolynomial(f: Fn, c: RationalInput, n?: number, params?: Params, options?: CalculusOptions): { coefficients: Certified[]; exact: boolean; expression: string; ast: Ast };
/** Arrows: segments [x0, y0, x1, y1, ...] in world coordinates, tail to head. */
export interface ArrowsFrame { kind: "arrows"; segments: Float64Array; magnitudes?: number[] }
export interface FieldOptions { spacing?: number; length?: number; normalize?: boolean; variables?: [string, string] }
export function vectorField(field: [Fn, Fn], params: Params, vp: ViewportSpec | Viewport, options?: FieldOptions): ArrowsFrame;
export function gradientField(F: Fn, params: Params, vp: ViewportSpec | Viewport, options?: FieldOptions): ArrowsFrame;
export function gradientAt(F: Fn, at: [RationalInput, RationalInput], params?: Params, options?: { variables?: [string, string]; digits?: number; scale?: number }): { point: Point; value: Certified; gradient: [Certified, Certified]; exact: boolean; arrow: ArrowsFrame; level: Line | null; layers: Layer[] };
export function contours(F: Fn, levels: RationalInput[], params: Params, vp: ViewportSpec | Viewport, options?: RegionOptions): { level: Rational; curve: Refinement<Polyline, ImplicitCells> }[];

// ---- three dimensions -----------------------------------------------------------------------------
export interface Camera { azimuth: number; elevation: number; distance: number; zoom: number }
export function camera(options?: Partial<Camera>): Camera;
export function orbit(cam: Camera, dx: number, dy: number, options?: { speed?: number }): Camera;
export function spaceViewport(width?: number, height?: number): Viewport;
/** A grid of (nu + 1) × (nv + 1) points in space, x, y, z in turn; NaN where undefined. */
export interface Surface3d { kind: "surface3d"; nu: number; nv: number; points: Float64Array; graph: boolean; certified?: boolean; /** Every vertex is within this of the true surface. */ error?: number; undefined?: number }
export interface Curve3d { kind: "curve3d"; points: Float64Array; certified?: boolean; error?: number }
export interface Points3d { kind: "points3d"; points: Float64Array }
export interface Arrow3d { kind: "arrow3d"; points: Float64Array }
/** Flat polygons in space, each [x, y, z, x, y, z, …], with a colour per face. */
export interface Faces3d { kind: "faces3d"; faces: Float64Array[]; colors?: string[] }
export type Item3d = Surface3d | Curve3d | Points3d | Arrow3d | Faces3d;
export interface SurfaceOptions { grid?: number | [number, number]; bits?: number }
export function surface(f: Fn, params?: Params, options?: SurfaceOptions & { x?: [RationalInput, RationalInput]; y?: [RationalInput, RationalInput]; variables?: [string, string] }): Refinement<Surface3d, Surface3d>;
export function parametricSurface(xyz: [Fn, Fn, Fn], params?: Params, options?: SurfaceOptions & { u?: [RationalInput, RationalInput]; v?: [RationalInput, RationalInput]; variables?: [string, string] }): Refinement<Surface3d, Surface3d>;
export function spaceCurve(xyz: [Fn, Fn, Fn], params?: Params, options?: { t?: [RationalInput, RationalInput]; variable?: string; samples?: number; bits?: number }): Refinement<Curve3d, Curve3d>;
export function points3d(list: [number, number, number][]): Points3d;
export function segment3d(a: [number, number, number], b: [number, number, number]): Curve3d;
export function arrow3d(from: [number, number, number], to: [number, number, number]): Arrow3d;
export interface Style3d { color?: string; opacity?: number; wire?: boolean; width?: number; shading?: "light" | "height" | "flat"; twoSided?: boolean; radius?: number; /** One colour per surface cell, row by row. */ cellColors?: string[] }
export function tangentPlane(f: Fn, at: [RationalInput, RationalInput], params?: Params, options?: { size?: number; variables?: [string, string]; normalLength?: number }): { point: [number, number, number]; gradient: [number, number]; normal: [number, number, number]; plane: Surface3d; layers: (Item3d | ({ item: Item3d } & Style3d))[] };
/** Faces and strokes in plane coordinates, far to near, with labels for the axes. */
export interface MeshFrame {
  kind: "mesh";
  faces: { depth: number; points: Float64Array; fill?: string; fillAlpha?: number; stroke?: string | null; width?: number; alpha?: number; dot?: number; closed?: boolean }[];
  labels: { x: number; y: number; tex: string; text: string; anchor: string; color: string; size: number }[];
  box: { x: [number, number]; y: [number, number]; z: [number, number] };
  camera: Camera;
}
export function project3d(cam: Camera, items: (Item3d | ({ item: Item3d } & Style3d))[], options?: { box?: { x?: [number, number]; y?: [number, number]; z?: [number, number] }; axes?: boolean | { color?: string; labels?: [string, string, string] | false }; light?: [number, number, number]; colors?: string[] }): MeshFrame;

// ---- animation ----------------------------------------------------------------------------------
export function parameterSteps(from: RationalInput, to: RationalInput, n: number): Rational[];
export interface AnimationInfo { index: number; steps: number; playing: boolean }
export interface AnimationOptions {
  from?: RationalInput; to?: RationalInput; steps?: number;
  /** Milliseconds for one pass (default 3000). */ duration?: number;
  loop?: boolean; bounce?: boolean;
  /** Called when the animation pauses, is sought or finishes: the place to draw the certified stage. */
  onSettle?: (value: Rational, info: AnimationInfo) => void;
  clock?: { now(): number; request(fn: (t: number) => void): unknown; cancel(id: unknown): void };
}
export interface Animation {
  readonly values: Rational[]; readonly playing: boolean; readonly index: number; readonly value: Rational;
  play(): void; pause(): void; toggle(): void; seek(index: number): void; seekTo(fraction: number): void; stop(): void;
}
export function animate(draw: (value: Rational, info: AnimationInfo) => void, options?: AnimationOptions): Animation;
export function animationSVG(vp: Viewport, frames: Layer[][], options?: SceneOptions & { duration?: number; loop?: boolean; tex?: (tex: string) => string; width?: number; height?: number }): string;
export function animationPNG(vp: Viewport, frames: Layer[][], options?: SceneOptions & { duration?: number; loop?: boolean }): Promise<Uint8Array>;


// ---- pictures for the Shelf ----

export type Num = number | bigint | string | Rational | { toNumber(): number } | { low: unknown; high: unknown };
export type XY = [number, number];
export interface ShapeStyle { color?: string; fill?: string | null; fillAlpha?: number; stroke?: string | null; width?: number; dash?: number[]; alpha?: number; closed?: boolean; r?: number; head?: number; anchor?: string; size?: number; label?: string }
export type PictureShape =
  | ({ path: number[] } & ShapeStyle)
  | ({ dot: XY } & ShapeStyle)
  | ({ arrow: [number, number, number, number] } & ShapeStyle)
  | ({ text: XY; tex: string } & ShapeStyle);
export interface ShapesFrame { kind: "shapes"; shapes: PictureShape[] }
export interface ImageFrame { kind: "image"; x: XY; y: XY; width: number; height: number; cells: (string | null)[] }
export type FigureStatus = "exact" | "certified" | "estimated" | "simulated";
export interface Figure {
  readonly kind: "figure";
  readonly layers: Layer[];
  readonly x: XY;
  readonly y: XY;
  readonly axes: boolean | AxesOptions;
  readonly equal: boolean;
  readonly status: FigureStatus;
  readonly title: string;
  readonly notes: string[];
  readonly size?: { width: number; height: number };
  readonly [extra: string]: unknown;
}
export interface Frames { readonly kind: "frames"; readonly frames: Figure[]; readonly steps: unknown[] }
export interface FigureSpec { layers: Layer[]; x?: [Num, Num]; y?: [Num, Num]; axes?: boolean | AxesOptions; equal?: boolean; status?: FigureStatus; title?: string; notes?: string[]; margin?: number; [extra: string]: unknown }
export function figure(spec: FigureSpec): Figure;
export function figureViewport(fig: Figure, width?: number, height?: number): Viewport;
export function figureSize(fig: Figure): { width: number; height: number };
export interface DrawSize { width?: number; height?: number }
export function figureSVG(fig: Figure, options?: DrawSize & SceneOptions & { tex?: (tex: string) => string }): string;
export function figureTikZ(fig: Figure, options?: DrawSize & SceneOptions): string;
export function figureASCII(fig: Figure, options?: DrawSize & SceneOptions): string;
export function figurePDF(fig: Figure, options?: DrawSize & SceneOptions): Uint8Array;
export function figurePNG(fig: Figure, options?: DrawSize & SceneOptions): Promise<Uint8Array>;
export function framesSVG(frames: Frames | Figure[], options?: DrawSize & { duration?: number; loop?: boolean }): string;
export function framesPNG(frames: Frames | Figure[], options?: DrawSize & { duration?: number; loop?: boolean }): Promise<Uint8Array>;
export function shapes(list: (PictureShape | null | undefined | false)[]): ShapesFrame;
export function path(points: Num[] | [Num, Num][], style?: ShapeStyle): PictureShape;
export function dot(at: [Num, Num], style?: ShapeStyle): PictureShape;
export function arrow(from: [Num, Num], to: [Num, Num], style?: ShapeStyle): PictureShape;
export function text(at: [Num, Num], tex: string, style?: ShapeStyle): PictureShape;
export function image(spec: { x: [Num, Num]; y: [Num, Num]; width: number; height: number; cells: (string | null)[] }): ImageFrame;
export function extentOf(layers: Layer[]): { x: XY; y: XY } | null;
export function toNumber(x: unknown): number;
export function rampColor(t: number): string;
export function divergingColor(t: number): string;
export const CATEGORY: readonly string[];

// charts
export function legend(entries: { label: string; color: string; kind?: "line" | "box"; dash?: number[]; tex?: string }[], x: XY, y: XY, options?: { corner?: string }): ShapesFrame;
export interface FiveNumbers { readonly min: number; readonly q1: number; readonly median: number; readonly q3: number; readonly max: number; readonly whiskers: XY; readonly outliers: number[]; readonly n: number }
export function fiveNumbers(values: Num[]): FiveNumbers;
export function boxPlot(groups: Record<string, Num[]> | [string, Num[]][], options?: { title?: string }): Figure;
/** Anything with a density: a function, { fast: { pdf } } (the stats package's distributions) or pdf(x). */
export type DensityLike = ((x: number) => number) | { fast?: { pdf?: (x: number) => number; quantile?: (p: number) => number }; pdf?: (x: Num) => Num; prob?: (a: Num, b: Num) => unknown; kind?: string };
export function histogramFigure(values: Num[], options?: { bins?: number; range?: [Num, Num]; distribution?: DensityLike; density?: boolean; title?: string }): Figure;
export function densityFigure(distribution: DensityLike, options?: { range?: [Num, Num]; shade?: [Num, Num]; samples?: number; title?: string }): Figure;
export function qqPlot(values: Num[], distribution: DensityLike | ((p: number) => number), options?: { title?: string }): Figure;
export function scatterFit(points: ([Num, Num] | { x: Num; y: Num })[], options?: { fit?: { intercept: Num; slope: Num } | { coefficients: Num[] }; band?: (x: number) => [Num, Num]; range?: [Num, Num]; title?: string }): Figure;
export interface Series { name?: string; points: ([Num, Num] | { x: Num; y: Num })[]; color?: string; dash?: number[]; markers?: boolean }
export function lineChart(series: Series[], options?: { x?: [Num, Num]; y?: [Num, Num]; title?: string; status?: FigureStatus; markers?: boolean; legendCorner?: string; notes?: string[] }): Figure;
export function powerCurve(curves: Series[] | [Num, Num][], options?: { level?: Num; status?: FigureStatus; title?: string }): Figure;
export function samplingBuildUp(values: Num[], options?: { bins?: number; steps?: number[]; range?: [Num, Num]; distribution?: DensityLike; title?: string }): Frames;
export interface ScheduleRow { period: Num; interest: Num; principal: Num; extra?: Num; balloon?: Num; balance?: Num }
export function amortisationChart(loan: { schedule: ScheduleRow[] } | ScheduleRow[], options?: { title?: string }): Figure;
export function balanceChart(loan: { schedule: ScheduleRow[]; principal?: Num } | ScheduleRow[], options?: { title?: string }): Figure;
export function fanChart(simulation: { bands: Record<string, Num>[] } | Record<string, Num>[], options?: { title?: string; periodsPerYear?: number }): Figure;
export function yieldCurveFigure(curve: [Num, Num][] | { periods: number; frequency: number; spot(k: number): Num }, options?: { title?: string; percent?: boolean }): Figure;
export function payoffFigure(strategy: { payoff(S: string): Num; profit?(S: string): Num; kinks?: Num[]; breakEvens?: Num[] }, options?: { range?: [Num, Num]; title?: string }): Figure;

// graph drawing
export interface GraphData { kind: "graph-data"; vertices: string[]; edges: { from: string; to: string; label?: string; weight?: unknown }[]; directed: boolean }
export type GraphLike = GraphData | { vertices(): unknown[]; edges(): { from: unknown; to: unknown; weight?: unknown }[]; directed?: boolean; weighted?: boolean } | { vertices?: unknown[]; edges: ([unknown, unknown] | [unknown, unknown, unknown] | { from: unknown; to: unknown; label?: string })[]; directed?: boolean } | object;
export type Positions = Map<string, XY>;
export function graphData(g: GraphLike): GraphData;
export function circleLayout(g: GraphLike, options?: { order?: unknown[] }): Positions;
export function gridLayout(g: GraphLike, options?: { columns?: number }): Positions;
export function bipartiteLayout(g: GraphLike, options: { left: unknown[] }): Positions;
export function layeredLayout(g: GraphLike, options?: { roots?: unknown[]; sweeps?: number }): Positions;
export function treeLayout(g: GraphLike, options?: { root?: unknown }): Positions;
export function springLayout(g: GraphLike, options?: { iterations?: number }): Positions;
export interface TutteLayout { readonly positions: Positions; readonly exact: Map<string, [Rational, Rational]>; readonly outer: string[]; readonly crossings: [[string, string], [string, string]][]; readonly coincident: [string, string][]; readonly planarDrawing: boolean }
export function tutteLayout(g: GraphLike, options?: { outer?: unknown[]; faces?: unknown[] }): TutteLayout;
export function countCrossings(g: GraphLike, positions: Positions): [[string, string], [string, string]][];
export interface DrawGraphOptions {
  layout?: "circle" | "grid" | "layered" | "tree" | "spring" | "bipartite" | "tutte" | Positions;
  colours?: Record<string, number | string> | Map<unknown, number | string>;
  highlight?: { edges?: [unknown, unknown][]; vertices?: unknown[] };
  edgeLabels?: boolean;
  start?: unknown;
  accept?: Iterable<unknown>;
  notes?: Record<string, string>;
  title?: string;
  left?: unknown[];
  roots?: unknown[];
  root?: unknown;
  outer?: unknown[];
  faces?: unknown[];
}
export function drawGraph(g: GraphLike, options?: DrawGraphOptions): Figure;
export function automatonFigure(a: { states: string[]; start: string; accept: Iterable<string>; delta: Map<string, Map<string, Set<string>>> }, options?: { layout?: DrawGraphOptions["layout"]; title?: string }): Figure;
export function kripkeFigure(k: { worlds: string[]; R: Map<string, Set<string>>; valuation?: Record<string, Set<string> | string[]> }, options?: { layout?: DrawGraphOptions["layout"]; title?: string }): Figure;

// logic diagrams
export function treeLayoutOf<T>(root: T, options: { width(node: T): number; children(node: T): T[]; gap?: number }): { node: T; x: number; depth: number; width: number; span: XY }[];
export interface DerivationLike { sequent?: unknown; conclusion?: unknown; formula?: unknown; rule?: string; premises?: DerivationLike[] }
export function proofTreeFigure(derivation: DerivationLike, options?: { title?: string; options?: unknown }): Figure;
export interface TruthNode { lines: { n: number; formula: unknown; rule?: string; from?: unknown }[]; children?: TruthNode[]; closed?: number[] | null; open?: boolean }
export function truthTreeFigure(tree: { root: TruthNode } | TruthNode, options?: { title?: string; options?: unknown; rules?: boolean }): Figure;
export function vennFigure(sets: string[], options?: { shade?: ((membership: Record<string, boolean>) => boolean) | string[]; marks?: Record<string, string>; resolution?: number; title?: string; universe?: boolean }): Figure;

// dynamics
export type FloatMap = ((x: number) => number) | { float(x: number): number };
export function cobwebFigure(map: FloatMap, x0: Num, n?: number, options?: { range?: [Num, Num]; samples?: number; title?: string }): Figure;
export function orbitFigure(mapOrValues: FloatMap | Num[], x0?: Num, n?: number, options?: { title?: string }): Figure;
export function returnMapFigure(values: Num[], options?: { lag?: number; title?: string }): Figure;
export function bifurcationFigure(diagram: { columns: { parameter: Num; points: Num[] }[] } | { parameter: Num; points: Num[] }[], options?: { marks?: { at: Num; label?: string }[]; title?: string }): Figure;
export interface PixelGridLike { width: number; height: number; kind: ArrayLike<number>; re: Num; reHigh: Num; im: Num; imHigh: Num; escape?: ArrayLike<number>; labels?: unknown; counts?: Record<string, number>; name?: string }
export function escapeFigure(grid: PixelGridLike, options?: { inside?: string; undecided?: string; outside?: string; title?: string }): Figure;
export function pointCloudFigure(points: [Num, Num][] | Num[], options?: { r?: number; color?: string; title?: string; status?: FigureStatus; equal?: boolean }): Figure;
export function attractor3d(points: [Num, Num, Num][], options?: { cam?: Camera; radius?: number; title?: string; axes?: boolean }): Figure;
export function segmentsFigure(turtle: { segments: Num[][]; exact?: unknown } | Num[][], options?: { color?: string; width?: number; title?: string }): Figure;
export function spacetimeFigure(rows: ArrayLike<number>[], options?: { on?: string; off?: string | null; title?: string }): Figure;
export function lifeFigure(pattern: { cells: Set<string> } | [Num, Num][], options?: { color?: string; title?: string }): Figure;
export function parameterFrames<T>(values: T[], build: (value: T, index: number) => Figure): Frames;

// section 13
export function zeroContour(F: (x: number, y: number) => number, x: XY, y: XY, n?: number): [number, number, number, number][];
export interface Equilibrium { point: RationalInterval[]; unique: boolean; jacobian: RationalInterval[][]; trace: RationalInterval; determinant: RationalInterval; kind: string | null; stability: string | null; hyperbolic: boolean | null }
export function phasePortrait(field: [string, string] | object, options?: { x?: [Num, Num]; y?: [Num, Num]; orbits?: [Num, Num][]; arrows?: number; nullclines?: boolean; equilibria?: boolean; t?: number; variables?: [string, string]; params?: Record<string, Num>; title?: string }): Figure & { readonly equilibria: Equilibrium[] & { complete?: boolean } };
export function solutionFrames(u: string | ((x: number, t: number) => number), times: Num[], options?: { x?: [Num, Num]; y?: [Num, Num]; samples?: number; variables?: [string, string]; title?: string }): Frames;
export function frameAlongCurve(components: [string, string], t: Num, options?: { range?: [Num, Num]; parameter?: string; samples?: number; title?: string }): Figure;
export function frameFrames(components: [string, string], ts: Num[], options?: { range?: [Num, Num]; parameter?: string; samples?: number; title?: string }): Frames;
export function curvatureSurface(components: [string, string, string], options?: { u?: [Num, Num]; v?: [Num, Num]; grid?: number | [number, number]; parameters?: [string, string]; which?: "gaussian" | "mean"; scale?: Num; cam?: Camera; title?: string; extra?: (Item3d | ({ item: Item3d } & Style3d))[] }): Figure & { readonly range: XY };
export function curveOnSurface(components: [string, string, string], uvPoints: [Num, Num][], options?: { parameters?: [string, string] }): Curve3d;
export function equalBox(points: ArrayLike<number>): { x: XY; y: XY; z: XY };
export function newtonFigure(f: string | ((x: number) => number), x0: Num, n?: number, options?: { range?: [Num, Num]; derivative?: string | ((x: number) => number); title?: string; variable?: string }): Figure & { readonly iterates: number[] };
export function interpolationFigure(f: string | ((x: number) => number), n: number, options?: { range?: [Num, Num]; nodes?: "equal" | "chebyshev" | Num[]; title?: string; variable?: string; error?: boolean }): Figure & { readonly maxError: number; readonly nodes: number[] };
export function quadratureFigure(f: string | ((x: number) => number), interval: [Num, Num], n?: number, options?: { rule?: "trapezoid" | "midpoint" | "simpson"; title?: string; variable?: string }): Figure & { readonly value: number };
export function stabilityRegion(R?: "euler" | "heun" | "rk2" | "rk3" | "rk4" | Num[], options?: { re?: [Num, Num]; im?: [Num, Num]; resolution?: number; title?: string }): Figure & { readonly area: number };
export function convergenceFigure(rows: ([Num, Num] | { h?: Num; step?: Num; error?: Num; err?: Num })[], options?: { title?: string }): Figure & { readonly order: number };

// polygons and solids
export function polygonsFigure(polygons: ([Num, Num][] | { points: [Num, Num][]; key?: unknown; color?: string })[], options?: { colorBy?: "sides" | "key" | ((p: { points: [Num, Num][]; key?: unknown }) => string); stroke?: string; width?: number; x?: XY; y?: XY; title?: string; status?: FigureStatus }): Figure;
export function solidFigure(vertices: [Num, Num, Num][], faces: number[][], options?: { cam?: Camera; colors?: string[] | ((face: number[], index: number) => string); opacity?: number; title?: string; status?: FigureStatus; edgeWidth?: number }): Figure;
export function stepsFigures(steps: { shapes: PictureShape[]; note?: string }[], options?: { highlight?: string; title?: string; status?: FigureStatus }): Frames;
