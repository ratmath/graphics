# @ratmath/graphics

Graphs for the RatMath calculator that are fast while you explore and exact
when you stop.

While a slider moves, you get a floating-point sketch in well under a
millisecond. When the input settles, every pixel column is recomputed with
certified interval arithmetic over exact rational inputs. The result is a set
of pixel cells with a guarantee:

> Every point (x, f(x)) of the graph inside the viewport lies in a shaded
> cell. A cell that is not shaded contains no point of the graph.

Zeros get the same treatment. A quick float guess comes first. Then come
certified answers: exact rationals where the zero is rational, and otherwise
brackets `[lo, hi]` with a proven sign change.

```js
import { graph, zeros, live, viewport, drawCanvas } from "@ratmath/graphics";

const vp = viewport({ x: [-8, 8], y: [-6, 6], width: 800, height: 480 });

// One graph: quick sketch now, certified cells later.
const g = graph("a*sin(b*x) + c*x", { a: 2, b: 1, c: "1/4" }, vp);
drawCanvas(ctx, g.quick.value);          // float polyline, immediate
drawCanvas(ctx, await g.settle());       // certified cells, time-sliced

// Wired to a slider: every input shows a sketch at once; certification
// starts once the slider has been still for idleMs, and newer input cancels it.
const update = live((a) => graph("a*x^2 - 3", { a }, vp), (stage) => {
  clear();
  drawCanvas(ctx, stage.value, { color: stage.exact ? "teal" : "royalblue" });
}, { idleMs: 120, onProgress: (p) => p.partial && drawCanvas(ctx, p.partial) });
slider.oninput = () => update(`${slider.value}/8`);   // exact slider values

zeros("x^2 - 4", {}, [-3, 3]).exact();
// [{ kind: "exact", at: -2 }, { kind: "exact", at: 2 }]
zeros("x^2 - 2", {}, [0, 2]).exact();
// [{ kind: "sign-change", lo: 1393/985, hi: 1970/1393 }]
```

## The fast-then-exact shape

`graph()` and `zeros()` return a `Refinement`. This is the same class the
linear algebra library (`ratmath/linalg`, `src/refine.js`) uses, so one
`live()` loop can drive both.

| Member | What it gives |
|---|---|
| `quick` | `{ stage: "float", exact: false, value, trust }`, computed on first read |
| `stages()` | generator: the float stage, then `{ stage: "progress", done, of, step, partial? }` ticks, then `{ stage: "exact", exact: true, value, via }` |
| `exact()` / `exactStage()` | run to the end synchronously (fine in a Worker) |
| `settle({ signal, sliceMs, onStage, onProgress })` | run in time slices; rejects with `AbortError` when aborted |
| `live(compute, onStage, { idleMs, sliceMs, onProgress, onError })` | wires a Refinement to a control that changes often |

For graphs, progress ticks come once per pixel column. Every
`partialEvery` columns (16 by default), a tick carries `partial`, the frame
so far, so the certified picture can sweep in over the sketch.

## Stage values

- **Sketch** (`kind: "polyline"`): `points` is a `Float64Array` of pixel
  coordinates `[px0, py0, px1, py1, ...]`. A `NaN` pair marks a break where
  the function is undefined or jumps across the screen at a pole.
- **Certified** (`kind: "cells"`): `columns[i]` is a flat list of inclusive
  row ranges `[top, bottom, top, bottom, ...]` for pixel column `i`, with row
  0 at the top. `tight` is false if some column hit the subdivision depth
  limit before it became narrow. `evaluations` counts interval evaluations.

`drawCanvas(ctx2d, value, { color, lineWidth, scale })` draws either kind.
`toSVG(value, options)` serializes either kind to an SVG string.

## How exactness works

- **Viewport.** The viewport edges are exact rationals. Pixel column `i`
  covers exactly `[xmin + i·dx, xmin + (i+1)·dx]`, and the pixel row for a
  y value is computed exactly.
- **Interval kernel** (`src/interval.js`). Arithmetic is on dyadic
  fixed-point BigInts with outward rounding. The precision is chosen from the
  pixel size, about 12 bits finer than a pixel. Rational inputs (viewport
  edges, slider values, decimal literals such as `0.1`) are rounded outward
  once. Supported: `+ - * /`, integer powers (tight even powers), `sqrt`,
  `exp`, `ln`/`log`, `sin`, `cos`, `tan`, `abs`, `min`, `max`, general
  powers through exp and ln, and the constants `pi` and `e`. Transcendental
  functions use series with explicit error bounds. `pi` comes from Machin's
  formula.
- **Columns.** Each column's x-interval is enclosed. Where the enclosure
  spans more than two rows, the column is bisected, but only while bisection
  keeps reducing the rows covered. Steep segments therefore stop early, and
  only curved parts subdivide. A column holding a pole is filled top to
  bottom, because the graph really does pass through all of it.
- **Domains.** Where a function is undefined, such as `sqrt` of a negative
  number, `ln` of a non-positive number, or division by exactly zero, the
  enclosure is empty, so no cells are drawn.
- **Zeros.** Rational-only expressions (`+ - * /`, integer powers, `abs`,
  `min`, `max`) are also evaluated exactly with Core `Rational`s. Bisection
  splits at the simplest rational in the middle of each bracket (a
  Stern–Brocot descent), so zeros like `2` or `-5/7` are found exactly, and
  irrational zeros get continued-fraction-like brackets such as
  `[1393/985, 1970/1393]` for √2. Each result has one of these kinds:
  - `exact`: the zero is a rational, found exactly.
  - `sign-change`: the interval certainly contains a zero.
  - `possible`: no proof either way.
  - `undefined`: the bracket holds a pole of a rational function.

Measured in this container at 800×400 pixels: a sketch takes 0.2–1 ms, and a
fully certified plot takes 10–60 ms for the curves in the tests (polynomials,
`sin`, `exp·cos`, poles). In the demo, a slider input takes about 1 ms on the
main thread, and the certified picture arrives about 120 ms after the slider
stops.

## Expressions

`parse(text)` reads conventional calculator notation:

- `^` (or `**`) is right-associative, and `-x^2` means `-(x^2)`.
- A number followed by a factor multiplies it: `2x`, `3(x+1)`, `2sin(x)`.
- Decimals are exact (`0.1` is 1/10).
- A name is a whole run of letters and digits, so write `a*x` or `a x` rather
  than `ax`.

The AST is plain objects built with `num`, `v`, `op` and `call`, so the
calculator can hand over its own parse tree instead of a string. Names other
than the plotted variable (`x` by default, set with `{ variable }`) are
parameters. Parameters can be numbers, `"p/q"` strings, decimal strings, or
Core `Rational`s.

## Demo

```sh
bun install
bun run demo:build
cd demo && python3 -m http.server 4180   # then open http://localhost:4180
```

Type an expression. A slider appears for each parameter, with exact steps of
1/8. The status pill moves from "sketch" through "certifying n%" to
"certified".

## Tests

```sh
bun test ./tests
```

The tests check soundness directly. For ten functions (with poles, domain
edges, transcendentals and parameters), every column is sampled at rational
points. Each point is enclosed at 200 bits, and the tests check that its row
was shaded. The interval kernel is checked against exact Core rational
arithmetic and against itself at 240 bits.

## Not yet

These are next in roughly this order:

- implicit curves `f(x, y) = 0` and inequalities on a certified quadtree
- parametric and polar curves
- points of interest: extrema and intersections, using the zeros machinery
- a Worker wrapper with a Stop button
- hooks so `@ratmath/analytic` functions can supply their own enclosures
