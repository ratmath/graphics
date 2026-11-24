// Run the certified stage in a Web Worker, so a slow proof never blocks the
// page. The float preview still runs on the calling side (it is cheap and
// must be instant); only the exact work is sent to the worker.
//
// In the worker script:
//   import { serveGraphics } from "@ratmath/graphics/worker";
//   serveGraphics(self);
//
// On the page:
//   import { workerClient } from "@ratmath/graphics/worker";
//   const gx = workerClient(new Worker("graphics-worker.js", { type: "module" }));
//   const job = gx.graph("sin(x)/x", {}, vp);   // job.quick is ready now
//   job.settle({ onStage, onProgress, signal }).then(draw);
//
// Arguments and results cross as plain data: exact values (Rational, Surd,
// Point, Line, Polygon, Circle) are packed on one side and rebuilt on the
// other, typed arrays are transferred as they are.

import { Rational } from "@ratmath/core";
import * as ops from "../index.js";
import { Surd } from "./surd.js";
import { Point, Line, Polygon, Circle } from "./geometry.js";

export const OPERATIONS = ["graph", "parametric", "polar", "region", "implicit", "features", "zeros", "intersections"];

/** Pack a value for postMessage. */
export function toPlain(x) {
  if (x === null || x === undefined) return x;
  if (typeof x === "bigint") return { $: "n", v: x.toString() };
  if (typeof x === "function") return undefined;
  if (typeof x !== "object") return x;
  if (x instanceof Rational) return { $: "q", v: [x.numerator.toString(), x.denominator.toString()] };
  if (x instanceof Surd) return { $: "s", v: [toPlain(x.a), toPlain(x.b), x.d.toString()] };
  if (x instanceof Point) return { $: "p", v: [toPlain(x.x), toPlain(x.y)] };
  if (x instanceof Line) return { $: "l", v: [x.a, x.b, x.c, x.p, x.q].map(toPlain), type: x.type };
  if (x instanceof Polygon) return { $: "g", v: x.vertices.map(toPlain) };
  if (x instanceof Circle) return { $: "c", v: [toPlain(x.center), toPlain(x.r2)] };
  if (ArrayBuffer.isView(x)) return x;
  if (Array.isArray(x)) return x.map(toPlain);
  const out = {};
  for (const [k, val] of Object.entries(x)) {
    const p = toPlain(val);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

/** Rebuild a value packed by toPlain. */
export function fromPlain(x) {
  if (x === null || typeof x !== "object") return x;
  if (ArrayBuffer.isView(x)) return x;
  if (Array.isArray(x)) return x.map(fromPlain);
  if (typeof x.$ === "string" && "v" in x) {
    const val = x.v;
    switch (x.$) {
      case "n": return BigInt(val);
      case "q": return new Rational(BigInt(val[0]), BigInt(val[1]));
      case "s": return new Surd(fromPlain(val[0]), fromPlain(val[1]), BigInt(val[2]));
      case "p": return new Point(fromPlain(val[0]), fromPlain(val[1]));
      case "l": return new Line(...val.map(fromPlain), x.type);
      case "g": return new Polygon(val.map(fromPlain));
      case "c": return new Circle(fromPlain(val[0]), fromPlain(val[1]));
    }
  }
  const out = {};
  for (const [k, val] of Object.entries(x)) out[k] = fromPlain(val);
  return out;
}

/** Answer requests { id, op, args } with { id, stage } messages; { id, cancel } stops one. */
export function serveGraphics(scope) {
  const running = new Map();
  scope.addEventListener("message", async (event) => {
    const { id, op, args, cancel } = event.data ?? {};
    if (cancel) {
      running.get(id)?.abort();
      return;
    }
    if (!OPERATIONS.includes(op)) {
      scope.postMessage({ id, error: `Unknown operation ${op}` });
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const job = ops[op](...fromPlain(args));
      await job.settle({
        signal: controller.signal,
        onProgress: (p) => scope.postMessage({ id, progress: toPlain({ done: p.done, of: p.of, step: p.step }) }),
        onStage: (s) => s.exact && scope.postMessage({ id, stage: toPlain(s) }),
      });
    } catch (e) {
      if (e?.name !== "AbortError") scope.postMessage({ id, error: String(e?.message ?? e) });
    } finally {
      running.delete(id);
    }
  });
}

/**
 * The same calls as the library (graph, parametric, polar, region, implicit,
 * features, zeros, intersections). Each returns an object with `quick`
 * (computed here, at once), `settled`, and `settle({ signal, onStage,
 * onProgress })`, which resolves with the certified value from the worker.
 */
export function workerClient(worker) {
  let next = 1;
  const waiting = new Map();
  worker.addEventListener("message", (event) => {
    const { id, stage, progress, error } = event.data ?? {};
    const w = waiting.get(id);
    if (!w) return;
    if (progress) w.onProgress?.(fromPlain(progress));
    else if (error) {
      waiting.delete(id);
      w.reject(new Error(error));
    } else if (stage) {
      waiting.delete(id);
      w.resolve(fromPlain(stage));
    }
  });
  const client = {};
  for (const op of OPERATIONS) {
    client[op] = (...args) => {
      const local = ops[op](...args);
      let exactStage = null;
      return {
        get quick() {
          return local.quick;
        },
        get settled() {
          return exactStage !== null;
        },
        settle({ signal, onStage, onProgress } = {}) {
          onStage?.(local.quick);
          if (exactStage) {
            onStage?.(exactStage);
            return Promise.resolve(exactStage.value);
          }
          const id = next++;
          return new Promise((resolve, reject) => {
            const abort = () => {
              worker.postMessage({ id, cancel: true });
              waiting.delete(id);
              const e = new Error("Refinement aborted");
              e.name = "AbortError";
              reject(e);
            };
            if (signal?.aborted) return abort();
            signal?.addEventListener("abort", abort, { once: true });
            waiting.set(id, {
              onProgress,
              reject,
              resolve: (s) => {
                exactStage = s;
                onStage?.(s);
                resolve(s.value);
              },
            });
            worker.postMessage({ id, op, args: toPlain(args) });
          });
        },
      };
    };
  }
  return client;
}
