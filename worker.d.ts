// Type declarations for @ratmath/graphics/worker.
import type * as G from "./index.js";

type Job<F extends (...args: any[]) => G.Refinement<any, any, any>> = F extends (...args: infer A) => G.Refinement<infer T, infer E, infer P>
  ? (...args: A) => {
      /** The float preview, computed on the calling side at once. */
      readonly quick: G.FloatStage<T>;
      readonly settled: boolean;
      /** Resolves with the certified value computed in the worker. */
      settle(options?: { signal?: AbortSignal; onStage?: (s: G.FloatStage<T> | G.ExactStage<E>) => void; onProgress?: (p: { done: number; of: number; step?: string }) => void }): Promise<E>;
    }
  : never;

export const OPERATIONS: readonly ["graph", "parametric", "polar", "region", "implicit", "features", "zeros", "intersections"];

/** Call inside the worker script: serveGraphics(self). */
export function serveGraphics(scope: { addEventListener(type: "message", listener: (event: { data: any }) => void): void; postMessage(message: any): void }): void;

/** Call on the page with the Worker. Each method mirrors the library call of the same name. */
export function workerClient(worker: { addEventListener(type: "message", listener: (event: { data: any }) => void): void; postMessage(message: any): void }): {
  graph: Job<typeof G.graph>;
  parametric: Job<typeof G.parametric>;
  polar: Job<typeof G.polar>;
  region: Job<typeof G.region>;
  implicit: Job<typeof G.implicit>;
  features: Job<typeof G.features>;
  zeros: Job<typeof G.zeros>;
  intersections: Job<typeof G.intersections>;
};

/** Pack and rebuild values for postMessage (Rational, Surd, Point, Line, Polygon, Circle, typed arrays). */
export function toPlain(value: unknown): unknown;
export function fromPlain(value: unknown): unknown;
