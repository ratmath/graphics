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
