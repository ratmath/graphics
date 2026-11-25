import { describe, expect, test } from "bun:test";
import {
  viewport, graph, camera, orbit, spaceViewport, surface, parametricSurface, spaceCurve, points3d, segment3d, arrow3d, tangentPlane, project3d,
  sceneSVG, sceneASCII, scenePNG, sceneTikZ, parameterSteps, animate, animationSVG, animationPNG,
} from "../index.js";

const cam = camera({ azimuth: 35, elevation: 25 });
const svp = spaceViewport(300, 200);

describe("surfaces and space curves", () => {
  test("a surface: float grid first, then certified heights", () => {
    const s = surface("x^2 - y^2", {}, { x: [-1, 1], y: [-1, 1], grid: 8 });
    const q = s.quick.value;
    expect(q).toMatchObject({ kind: "surface3d", nu: 8, nv: 8, graph: true });
    expect(q.points.length).toBe(9 * 9 * 3);
    const e = s.exact();
    expect(e.certified).toBe(true);
    expect(e.error).toBeLessThan(1e-9);
    for (let k = 0; k < e.points.length; k += 3) {
      const [x, y, z] = e.points.slice(k, k + 3);
      expect(Math.abs(z - (x * x - y * y))).toBeLessThan(1e-9);
    }
    const t = surface("sin(a*x)*cos(y)", { a: 2 }, { grid: [6, 4] }).exact();
    expect([t.nu, t.nv]).toEqual([6, 4]);
    expect(t.error).toBeLessThan(1e-9);
  });
  test("points where the function is undefined are left out", () => {
    const s = surface("sqrt(1 - x^2 - y^2)", {}, { x: [-2, 2], y: [-2, 2], grid: 8 }).exact();
    expect(s.undefined).toBeGreaterThan(0);
    expect(Number.isNaN(s.points[2])).toBe(true);
    const m = project3d(cam, [s]);
    expect(m.faces.length).toBeGreaterThan(0);
    expect(m.faces.length).toBeLessThan(64);
  });
  test("parametric surfaces and curves", () => {
    const sphere = parametricSurface(["cos(u)*sin(v)", "sin(u)*sin(v)", "cos(v)"], {}, { u: [0, "6.2832"], v: [0, "3.1416"], grid: 8 }).exact();
    expect(sphere.error).toBeLessThan(1e-9);
    for (let k = 0; k < sphere.points.length; k += 3) expect(Math.hypot(...sphere.points.slice(k, k + 3))).toBeCloseTo(1, 9);
    const helix = spaceCurve(["cos(t)", "sin(t)", "t/4"], {}, { t: [0, 12], samples: 50 });
    expect(helix.quick.value.kind).toBe("curve3d");
    expect(helix.quick.value.points.length).toBe(51 * 3);
    const h = helix.exact();
    expect(h.error).toBeLessThan(1e-9);
    for (let k = 0; k < h.points.length; k += 3) expect(Math.hypot(h.points[k], h.points[k + 1])).toBeCloseTo(1, 9);
  });
  test("the tangent plane", () => {
    const t = tangentPlane("x^2 + y^2", [1, 1]);
    expect(t.point).toEqual([1, 1, 2]);
    expect(t.gradient).toEqual([2, 2]);
    expect(Math.hypot(...t.normal)).toBeCloseTo(1, 12);
    expect(t.normal[0] / t.normal[2]).toBeCloseTo(-2, 12);
    expect(t.layers.length).toBe(3);
  });
});

describe("projection", () => {
  const s = surface("x^2 - y^2", {}, { x: [-1, 1], y: [-1, 1], grid: 8 }).exact();
  test("one mesh frame, far faces first", () => {
    const helix = spaceCurve(["cos(t)", "sin(t)", "t/12 - 1/2"], {}, { t: [0, 12], samples: 50 }).quick.value;
    const m = project3d(cam, [s, helix, points3d([[0, 0, 0]]), arrow3d([0, 0, 0], [1, 1, 1]), segment3d([0, 0, 0], [1, 0, 0])], { axes: true });
    expect(m.kind).toBe("mesh");
    expect(m.faces.length).toBeGreaterThan(64);
    expect(m.labels.length).toBeGreaterThan(6);
    for (let k = 1; k < m.faces.length; k++) expect(m.faces[k].depth).toBeGreaterThanOrEqual(m.faces[k - 1].depth);
    // everything lands inside the viewport made for it
    for (const f of m.faces) {
      for (let k = 0; k < f.points.length; k += 2) {
        expect(Math.abs(f.points[k])).toBeLessThanOrEqual(svp.f.xmax + 1e-9);
        expect(Math.abs(f.points[k + 1])).toBeLessThanOrEqual(svp.f.ymax + 1e-9);
      }
    }
  });
  test("turning the camera changes the picture, not the surface", () => {
    const a = project3d(cam, [s]);
    const turned = orbit(cam, 40, -10);
    expect(turned.azimuth).not.toBe(cam.azimuth);
    const b = project3d(turned, [s]);
    expect(b.faces.length).toBe(a.faces.length);
    expect(Array.from(b.faces[0].points)).not.toEqual(Array.from(a.faces[0].points));
    const near = project3d(camera({ distance: 4 }), [s]);
    expect(near.faces.length).toBe(a.faces.length);
    expect(orbit(camera({ elevation: 89 }), 0, -100).elevation).toBeLessThanOrEqual(90);
  });
  test("styles and every back end", async () => {
    const m = project3d(cam, [{ item: s, shading: "height", opacity: 0.8, wire: true }], { axes: { labels: ["x", "y", "z"] }, box: { z: [-2, 2] } });
    const svg = sceneSVG(svp, [m]);
    expect(svg).toContain("<path");
    expect(sceneASCII(svp, [m], { columns: 40 }).length).toBeGreaterThan(100);
    const tikz = sceneTikZ(svp, [m]);
    expect(tikz).toContain("fill=");
    expect(tikz).not.toContain("−");
    const png = await scenePNG(svp, [m], { engine: "raster" });
    expect([...png.slice(1, 4)]).toEqual([80, 78, 71]);
  });
});

describe("animation", () => {
  const vp = viewport({ x: [-4, 4], y: [-2, 2], width: 200, height: 100 });
  test("exact parameter values", () => {
    expect(parameterSteps(0, 1, 4).map(String)).toEqual(["0", "1/4", "1/2", "3/4", "1"]);
    expect(parameterSteps("1/3", 2, 2).map(String)).toEqual(["1/3", "7/6", "2"]);
    expect(() => parameterSteps(0, 1, 0)).toThrow(RangeError);
  });
  const fakeClock = () => {
    const q = [];
    const c = { t: 0, now: () => c.t, request: (fn) => q.push(fn), cancel: () => { q.length = 0; } };
    c.tick = (ms) => {
      c.t += ms;
      const fn = q.shift();
      if (fn) fn(c.t);
      return !!fn;
    };
    return c;
  };
  test("plays each value once and settles at the end", () => {
    const clock = fakeClock();
    const seen = [];
    const an = animate((v, info) => seen.push(`${v}@${info.index}`), { from: 0, to: 1, steps: 4, duration: 400, loop: false, clock, onSettle: (v) => seen.push(`settle ${v}`) });
    expect(an.values.length).toBe(5);
    an.play();
    for (let k = 0; k < 10 && clock.tick(100); k++);
    expect(seen).toEqual(["0@0", "1/4@1", "1/2@2", "3/4@3", "1@4", "settle 1"]);
    expect(an.playing).toBe(false);
    expect(an.index).toBe(4);
  });
  test("pause, seek and bounce", () => {
    const clock = fakeClock();
    const seen = [];
    const settled = [];
    const an = animate((v) => seen.push(String(v)), { from: 0, to: 2, steps: 2, duration: 200, bounce: true, clock, onSettle: (v) => settled.push(String(v)) });
    an.play();
    for (let k = 0; k < 6; k++) clock.tick(100);
    expect(seen.slice(0, 5)).toEqual(["0", "1", "2", "1", "0"]);
    an.pause();
    expect(an.playing).toBe(false);
    expect(settled.length).toBe(1);
    an.seek(2);
    expect(String(an.value)).toBe("2");
    an.seekTo(0.5);
    expect(an.index).toBe(1);
    an.toggle();
    expect(an.playing).toBe(true);
    an.stop();
    expect(an.playing).toBe(false);
  });
  test("animated SVG and PNG", async () => {
    const frames = parameterSteps(1, 2, 3).map((a) => [graph("sin(a*x)", { a }, vp).quick.value]);
    const svg = animationSVG(vp, frames, { duration: 1000, axes: true });
    expect((svg.match(/<animate/g) ?? []).length).toBe(4);
    expect(svg).toContain('repeatCount="indefinite"');
    expect(animationSVG(vp, frames, { loop: false })).not.toContain('repeatCount="indefinite"');
    const png = await animationPNG(vp, frames, { duration: 1000 });
    const text = new TextDecoder("latin1").decode(png);
    expect(text.slice(1, 4)).toBe("PNG");
    expect(text).toContain("acTL");
    expect((text.match(/fcTL/g) ?? []).length).toBe(4);
    expect(text.indexOf("acTL")).toBeLessThan(text.indexOf("IDAT"));
  });
});
