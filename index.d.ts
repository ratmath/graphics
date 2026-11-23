import type { Rational } from "@ratmath/core";

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
  asymptotes: Asymptote[];
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

export type Zero =
  | { kind: "exact"; at: Rational }
  | { kind: "sign-change"; lo: Rational; hi: Rational }
  | { kind: "possible"; lo: Rational; hi: Rational }
  | { kind: "undefined"; at: Rational; lo: Rational; hi: Rational };
export interface ZeroOptions { variable?: string; tolerance?: RationalInput; pieces?: number; maxDepth?: number; samples?: number }
export function zeros(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): Refinement<number[], Zero[]>;
export function findZeros(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): Zero[];
export function floatZeros(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): number[];
export function zerosGenerator(f: string | Ast, params: Params, range: [RationalInput, RationalInput], options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, { value: Zero[]; via: string }>;

export function simplestBetween(lo: Rational, hi: Rational): Rational;

/** A located point: exact (`at`) or a certified bracket [lo, hi]. */
interface Located { exact: boolean; at?: Rational; lo: Rational; hi: Rational }
/** f's value there: exact `value`, or a certified enclosure [valueLo, valueHi]. */
interface Valued { value?: Rational; valueLo?: Rational | null; valueHi?: Rational | null }
export interface Pole extends Located { kind: "pole" | "log"; certain: boolean; denominator: string }
export interface Extremum extends Located, Valued { kind: "max" | "min" | "flat" | "critical" }
export interface Inflection extends Located, Valued { kind: "convex-to-concave" | "concave-to-convex" | "possible" }
export interface Features { zeros: Zero[]; poles: Pole[]; extrema: Extremum[]; inflections: Inflection[] }
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
export function polesGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Pole[]>;
export function findExtrema(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Extremum[];
export function extremaGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Extremum[]>;
export function findInflections(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Inflection[];
export function inflectionsGenerator(f: string | Ast, params: Params, range: Range, options?: ZeroOptions): Generator<{ done: number; of: number; step: string }, Inflection[]>;
export function denominators(ast: Ast): { D: Ast; N: Ast; kind: "pole" | "log" }[];
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
export function area(poly: Polygon | PointInput[]): Surd;
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
export interface RegionOptions { method?: "pixels"; subpixel?: number; tile?: number; extraBits?: number; step?: number }
export function region(cond: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: RegionOptions): Refinement<RegionSketch, RegionPolygons | RegionCells, RegionCells>;
export function implicit(eq: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: RegionOptions): Refinement<Polyline, ImplicitCells>;
export function sketchRegion(cond: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: { step?: number }): RegionSketch;
export function sketchImplicit(eq: string | Condition, params: Params, vp: ViewportSpec | Viewport, options?: { step?: number }): Polyline;
export function classify(tree: Condition, params: Params, vp: Viewport, options?: RegionOptions): Generator<{ done: number; of: number; step: string; partial?: RegionCells }, RegionCells>;

// ---- scenes and labels ----------------------------------------------------------------------
export interface Label { type: "label"; x: number; y: number; tex: string; text: string; anchor: string; dx: number; dy: number; color?: string; size: number }
export interface Style { color?: string; width?: number; dash?: number[]; fill?: string; fillAlpha?: number; radius?: number; open?: boolean; background?: string; label?: string | true; anchor?: string; corners?: boolean; cornerLabels?: boolean; asymptoteColor?: string }
export type Layer = Shape | Label | Polyline | Cells | RegionSketch | RegionCells | RegionPolygons | ({ item: Shape | Polyline | Cells | RegionSketch | RegionCells | RegionPolygons } & Style);
export type Primitive =
  | { t: "path"; subpaths: number[][]; closed?: boolean; fill?: string; fillAlpha?: number; stroke?: string | null; width?: number; dash?: number[]; alpha?: number }
  | { t: "rects"; rects: number[]; fill: string; alpha?: number }
  | { t: "dot"; x: number; y: number; r: number; fill: string; stroke: string; width?: number }
  | { t: "label"; x: number; y: number; tex?: string; text: string; anchor: string; color?: string; size?: number; plain?: boolean };
export interface AxesOptions { grid?: string | false; axis?: string; text?: string; ticks?: boolean; target?: number }
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
