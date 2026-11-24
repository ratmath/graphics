// The worker wrapper, with the two sides joined by structuredClone (what postMessage does).
import { describe, test, expect } from "bun:test";
import { serveGraphics, workerClient, toPlain, fromPlain } from "../src/worker.js";
import { graph, features, region, viewport, point, circle, surd } from "../index.js";
import { Rational } from "@ratmath/core";

function pair() {
  const side = () => {
    const listeners = [];
    return { listeners, addEventListener: (_, f) => listeners.push(f), peer: null, postMessage(m) { const data = structuredClone(m); queueMicrotask(() => this.peer.listeners.forEach((f) => f({ data }))); } };
  };
  const a = side();
  const b = side();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const vp = viewport({ x: [-3, 3], y: [-2, 2], width: 120, height: 80 });

describe("worker wrapper", () => {
  test("exact values survive packing", () => {
    const back = fromPlain(structuredClone(toPlain({ q: new Rational(3n, 7n), p: point(1, surd(0, 1, 2)), c: circle([0, 0], 2), n: 5n, a: new Float64Array([1, 2]) })));
    expect(back.q.toString()).toBe("3/7");
    expect(back.p.equals(point(1, surd(0, 1, 2)))).toBe(true);
    expect(back.c.center.equals(point(0, 0))).toBe(true);
    expect(back.n).toBe(5n);
    expect(back.a).toBeInstanceOf(Float64Array);
  });
  test("a graph settles to the same frame as a direct call", async () => {
    const [page, worker] = pair();
    serveGraphics(worker);
    const gx = workerClient(page);
    const job = gx.graph("sin(x)/x", {}, vp);
    expect(job.quick.value.kind).toBe("polyline");
    const stages = [];
    const frame = await job.settle({ onStage: (s) => stages.push(s.exact) });
    const direct = graph("sin(x)/x", {}, vp).exact();
    expect(frame.columns).toEqual(direct.columns);
    expect(frame.holes.length).toBe(1);
    expect(stages).toEqual([false, true]);
    expect(job.settled).toBe(true);
  });
  test("features come back with exact Rationals", async () => {
    const [page, worker] = pair();
    serveGraphics(worker);
    const f = await workerClient(page).features("x^2 - 4", {}, [-3, 3]).settle();
    expect(f.zeros.map((z) => z.at.toString())).toEqual(["-2", "2"]);
    expect(f.extrema[0].at).toBeInstanceOf(Rational);
    expect(features("x^2 - 4", {}, [-3, 3]).exact().extrema[0].value.equals(f.extrema[0].value)).toBe(true);
  });
  test("exact regions keep their corner points", async () => {
    const [page, worker] = pair();
    serveGraphics(worker);
    const r = await workerClient(page).region("x + y <= 2, x >= 0, y >= 0", {}, vp).settle();
    const direct = region("x + y <= 2, x >= 0, y >= 0", {}, vp).exact();
    expect(r.kind).toBe(direct.kind);
    expect(r.corners.map((c) => String(c.point))).toEqual(direct.corners.map((c) => String(c.point)));
  });
  test("abort rejects and an unknown call is refused", async () => {
    const [page, worker] = pair();
    serveGraphics(worker);
    const gx = workerClient(page);
    const ac = new AbortController();
    const p = gx.graph("sin(x)", {}, vp).settle({ signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow("aborted");
    expect(gx.nonsense).toBeUndefined();
  });
});
