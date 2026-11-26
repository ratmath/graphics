// Polygons in the plane and solids in space: the drawing half of the
// pictures phase of @ratmath/geo (phase 7). Geo computes the geometry
// (tilings, wallpaper patterns, polyhedra, constructions) and hands the
// shapes to these.
//
//   polygonsFigure   filled polygons, coloured by a key (a tiling's
//                    polygons by number of sides, a pattern's orbits)
//   solidFigure      a polyhedron's faces, lit and depth-sorted, under a
//                    camera, in a box that keeps its proportions
//   stepsFigures     a construction step by step: frame k shows the first
//                    k + 1 steps, the newest one highlighted

import { figure, shapes, path, extentOf, toNumber, CATEGORY } from "./figure.js";
import { camera, project3d } from "./space.js";
import { equalBox } from "./analysis.js";

const num = toNumber;
const SIDE_COLORS = { 3: "#fde68a", 4: "#93c5fd", 6: "#fca5a5", 8: "#86efac", 12: "#c4b5fd" };

/**
 * Polygons [{ points: [[x, y], …], key?, color? }] (or bare point lists).
 * colorBy: "sides" (default: by the number of corners), "key", or a
 * function polygon → css. window: { x, y } to crop (default: all of them).
 */
export function polygonsFigure(polygons, { colorBy = "sides", stroke = "#334155", width = 1, x, y, title = "", status = "exact" } = {}) {
  const list = polygons.map((p) => (Array.isArray(p) ? { points: p } : p));
  const keys = [...new Set(list.map((p) => p.key))];
  const colorOf = (p) => {
    if (p.color) return p.color;
    if (typeof colorBy === "function") return colorBy(p);
    if (colorBy === "key") return CATEGORY[keys.indexOf(p.key) % CATEGORY.length];
    return SIDE_COLORS[p.points.length] ?? CATEGORY[p.points.length % CATEGORY.length];
  };
  const out = list.map((p) => path(p.points.map((q) => q.map(num)), { closed: true, fill: colorOf(p), fillAlpha: colorBy === "key" ? 0.55 : 1, color: stroke, width }));
  const ext = extentOf([shapes(out)]) ?? { x: [0, 1], y: [0, 1] };
  return figure({ layers: [shapes(out)], x: x ?? ext.x, y: y ?? ext.y, equal: true, status, title, count: list.length, margin: 0 });
}

/**
 * A solid from its vertices [[x, y, z], …] and faces (lists of vertex
 * indices, in order round each face). colors: one per face, or a function
 * face → css (default: by the number of sides).
 */
export function solidFigure(vertices, faces, { cam = camera({ azimuth: 30, elevation: 22 }), colors, opacity = 0.92, title = "", status = "exact", edgeWidth = 1.2 } = {}) {
  const V = vertices.map((v) => v.map(num));
  const F = faces.map((f) => Float64Array.from(f.flatMap((i) => V[i])));
  const cols = faces.map((f, k) => (Array.isArray(colors) ? colors[k] : typeof colors === "function" ? colors(f, k) : SIDE_COLORS[f.length] ?? CATEGORY[f.length % CATEGORY.length]));
  const box = equalBox(Float64Array.from(V.flat()));
  const mesh = project3d(cam, [{ item: { kind: "faces3d", faces: F, colors: cols }, opacity, width: edgeWidth }], { box });
  return figure({ layers: [mesh], x: [-1.8, 1.8], y: [-1.6, 1.6], equal: true, status, title, faces: faces.length, vertices: V.length });
}

/**
 * The frames of a construction: steps is [{ shapes: [shape, …], note }]
 * (shapes as made by path, dot, text). Frame k draws steps 0..k, the last
 * in the highlight colour, in one shared window.
 */
export function stepsFigures(steps, { highlight = CATEGORY[1], title = "Construction", status = "exact" } = {}) {
  const all = shapes(steps.flatMap((s) => s.shapes));
  const ext = extentOf([all]) ?? { x: [0, 1], y: [0, 1] };
  const pad = 0.08 * Math.max(ext.x[1] - ext.x[0], ext.y[1] - ext.y[0]);
  const X = [ext.x[0] - pad, ext.x[1] + pad];
  const Y = [ext.y[0] - pad, ext.y[1] + pad];
  const frames = steps.map((_, k) => {
    const done = steps.slice(0, k).flatMap((s) => s.shapes.map((sh) => ({ ...sh, color: sh.color ?? "#64748b" })));
    const now = steps[k].shapes.map((sh) => ({ ...sh, color: highlight, ...(sh.fill ? { fill: highlight } : {}) }));
    return figure({ layers: [shapes([...done, ...now])], x: X, y: Y, equal: true, status, title: `${title}: step ${k + 1} of ${steps.length}`, notes: steps[k].note ? [steps[k].note] : [] });
  });
  return Object.freeze({ kind: "frames", frames, steps: steps.map((s, i) => s.note ?? `step ${i + 1}`) });
}

