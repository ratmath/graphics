# @ratmath/graphics

Graphs for the RatMath calculator that are fast while you explore and exact
when you stop.

Docs and live demos: https://ratmath.com/graphics/ · Source:
https://github.com/ratmath/graphics · Siblings:
[core](https://ratmath.com/core/), [analytic](https://ratmath.com/analytic/),
[algebraic](https://ratmath.com/algebraic/), [linalg](https://ratmath.com/linalg/)

```sh
npm install @ratmath/graphics @ratmath/core
```

ES modules for Bun, Node 22+ and browsers, with TypeScript declarations.
While the version is 0.x, a minor version may change an API.

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

## Poles, holes, extrema and inflection points

These come from [`@ratmath/analytic`](https://github.com/ratmath/analytic),
which is vendored as a git submodule in `vendor/analytic`. Graphics asks
analytic and translates the answers for plotting. Analytic differentiates
symbolically. For rational functions it uses exact gcd, square-free and Sturm
steps. For everything else it uses Krawczyk and Rolle tests, which prove that
a bracket holds exactly one zero.

`features(f, params, [a, b])` returns a Refinement. Its quick stage holds
float estimates. Its exact stage holds `{ zeros, poles, holes, undefined,
endpoints, extrema, inflections }`. `poles` are proven poles only; a point
where f has no value and no pole was proven (`sin(1/x)` at 0) is listed under
`undefined` and gets no asymptote line. A function that is zero on a whole
stretch gives one zero of kind `everywhere`:

```js
features("x^3/8 - 2x", {}, [-8, 8]).exact();
// zeros:       exact -4, 0, 4
// extrema:     max near -√(16/3), min near √(16/3), each a proven bracket with a y enclosure
// inflections: 0 (exact)
findPoles("tan(x)", {}, [-4, 4]);      // certified brackets around ±π/2
findPoles("1/(x - 1/3)", {}, [-1, 1]); // exact pole at 1/3
findHoles("sin(x)/x * 4", {}, [-8, 8]); // hole at 0 with exact limit value 4
```

Each result has `at` when it is an exact rational, or `lo`/`hi` for a
bracket that certainly holds it. `unique: true` means it is proven to be the
only one in its bracket.

- **Zeros.** `exact` or `sign-change` (proven), or `possible` (no proof
  either way). Zeros also carry `multiplicity` where analytic can prove it.
- **Poles.** A pole is proven where a denominator has a proven zero and the
  numerator is provably non-zero. A pole from `ln u` has kind `log`. Certified
  graph frames carry the poles as `asymptotes`. The renderers draw them as
  dashed lines, and they draw an unproven float estimate as a fainter dotted
  line.
- **Holes.** A hole is a point where f is undefined but has a finite limit,
  such as `x/x` or `sin(x)/x` at 0. Before searching, analytic rewrites f as
  one quotient, so scaled and summed forms like `4*sin(x)/x + x` are covered.
  The limit is given as `value` when it is exact, otherwise as
  `valueLo`/`valueHi`, plus a float `valueApprox`.
- **Domain ends.** A domain end is where an argument of `sqrt`, or of a
  fractional power, crosses 0. Each end records which side the domain lies on
  and whether f is defined at the end itself (`included`). An end is reported
  only where f is defined just inside it, so `ln(x) + sqrt(16 - x^2)` has an
  end at 4 but not at -4.
- **Extrema** are `max` or `min` (from the proven sign of f' on each side),
  `flat` (f' = 0 without a sign change, as for x^3 at 0), or `critical` when
  it is not settled. A `critical` bracket with `touching: true` has f' with
  the same proven sign at both ends. Either f' only touches 0 there, or a max
  and min pair sits inside. Finite precision cannot rule out the pair when the
  touch is at an irrational point such as π/2.
- **Inflection points** are proven sign changes of f'' (`inflection`), or
  `possible`, with the same `touching` flag. A point where f'' vanishes
  without changing sign, as for x^4 at 0, is not reported.

`derive(ast)` is analytic's `differentiate`, re-exported.

### Markers

`drawMarkers(ctx2d, vp, features, { color, background, scale })` draws
features as dots, using this convention:

| Feature | Dot |
|---|---|
| Zero | Filled, in the curve's color |
| Max or min | Filled, darker than the curve |
| Inflection point | Filled, lighter than the curve |
| Hole | Open (the function is not defined there) |
| Domain end, included | Filled |
| Domain end, excluded | Open |

Graph frames list holes too. Interval arithmetic cannot bound `x/x` tightly
over a column that contains 0, so that column comes out tall. The renderer
draws it faint and lets the open dot show the missing point.

Analytic gives each starting piece of the range its own work budget. A hole
or pole, where interval bounds are poor, therefore cannot use up the work
meant for the rest of the range. A piece that runs out reports `possible`
rather than guessing.

## The fast-then-exact shape

`graph()` and `zeros()` return a `Refinement`. This is the same class the
linear algebra library uses (it lives in `@ratmath/core/refine`), so one
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
- **Zeros** come from analytic (see above). Graphics keeps its own
  Stern–Brocot zero search for domain ends. It splits each bracket at the
  simplest rational inside it, so ends like `4` or `-5/7` are found exactly
  and irrational ones get continued-fraction-like brackets such as
  `[1393/985, 1970/1393]` for √2.

Measured in this container at 800×400 pixels: a sketch takes 0.2–1 ms, and a
fully certified plot takes 10–60 ms for the curves in the tests (polynomials,
`sin`, `exp·cos`, poles). In the demo, a slider input takes about 1 ms on the
main thread, and the certified picture arrives about 120 ms after the slider
stops.

## Parametric and polar curves, intersections

```js
import { parametric, polar, intersections } from "@ratmath/graphics";

parametric({ x: "cos(3t)", y: "sin(2t)" }, {}, [0, "44/7"], vp);   // Refinement
polar("1 + cos(t)", {}, [0, "44/7"], vp);                          // r = r(t)
intersections("sin(x)", "cos(x)", {}, [0, 7]).exact();
// [{ kind: "sign-change", lo, hi, valueLo, valueHi }, …]   brackets around π/4 and 5π/4
intersections("x^2", "x + 2", {}, [-3, 3]).exact();
// [{ kind: "exact", at: -1, value: 1 }, { kind: "exact", at: 2, value: 4 }]
```

A curve's quick stage is a float polyline. Its exact stage is a `cells` frame
like a certified graph's: the parameter range is bisected, each piece is
enclosed as a box with interval arithmetic, boxes off screen are dropped and
boxes no larger than a pixel are lit. Every point of the curve lies in a lit
pixel. `intersections(f, g, …)` are the certified zeros of f − g with the
common value attached.

## Data, slope fields and ODE solutions

```js
import { scatter, bars, histogram, slopeField, solutionCurve } from "@ratmath/graphics";

scatter([[1, 2], [2, "7/2"]], { join: true });     // dots, optionally connected
bars([[1, 4], [2, 7]]);                             // one bar per [x, height]
histogram(values, { bins: 8 });                     // .counts, .edges
slopeField("x - y", {}, vp);                        // y′ = f(x, y)
solutionCurve({ f: "t - y", y0: 1, until: 3 }, vp); // Refinement: RK4 sketch, then proven cells
```

Each is a frame that every renderer draws. `solutionCurve` uses analytic's
validated ODE solver: in the exact frame each column's span provably holds
the solution over that column.

## Describing a graph in words

`describe(f, params, [a, b])` returns sentences built from the certified
features, for alt text and screen readers:

```js
describe("x^3 - 3x", {}, [-3, 3]);
// "Graph of y = x^3 - 3*x for x from −3 to 3. It meets the x-axis 3 times, near
//  x = −1.732, 0 and 1.732. It has one local maximum, at (−1, 2). It has one
//  local minimum, at (1, −2). It changes the way it bends at one inflection point, at (0, 0)."
```

## In a Web Worker

```js
// worker.js
import { serveGraphics } from "@ratmath/graphics/worker";
serveGraphics(self);

// page
import { workerClient } from "@ratmath/graphics/worker";
const gx = workerClient(new Worker("worker.js", { type: "module" }));
const job = gx.graph("sin(x)/x", {}, vp);   // job.quick is ready now, computed here
draw(await job.settle({ signal, onProgress }));   // the certified frame, computed in the worker
```

`graph`, `parametric`, `polar`, `region`, `implicit`, `features`, `zeros` and
`intersections` are available. Exact values (Rational, Surd, Point, …) are
rebuilt on arrival.

## Expressions

`parse(text)` is `@ratmath/analytic`'s parser, so both libraries read the same
notation and share parse trees. Functions: `sin cos tan asin acos atan sinh
cosh tanh exp log ln log1p sqrt cbrt erf abs min max`. A power with an odd
denominator, `x^(1/3)`, is the real root and is drawn for negative x. It reads
conventional calculator notation:

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

## Exact geometry

Points, lines, segments, rays, polygons and circles with coordinates in Q or
Q(√d). A line meets a circle at points like p ± q√d, and two circles meet on
their radical axis, so constructions from rational input stay exact.
Numbers of the form a + b√d are `Surd`s with exact arithmetic, signs and
comparisons; mixing two different roots (√2 + √3) throws, since that needs
`@ratmath/algebraic`.

```js
const A = point(0, 0), B = point(4, 0), C = point(1, 3);
line(A, C).toString();                       // "3x - y = 0"
intersect(circle(A, 2), circle(B, 3));       // (11/8, -3√15/8), (11/8, 3√15/8)
intersect(segment(A, C), segment(B, [0, 2])); // (4/7, 12/7)
area(polygon([A, B, C]));                    // 6
circumcircle(A, B, C).toTeX();               // "\left(x - 2\right)^2 + \left(y - 1\right)^2 = 5"
```

Also: `ray`, `midpoint`, `project`, `reflect`, `parallel`, `perpendicular`,
`bisector`, `dist2`, `distance`, `centroid`, `orientation`, `locate`
(inside/boundary/outside), `convexHull`.

## Regions and implicit curves

`region(condition, params, vp)` shades where a condition holds. Conditions
chain (`0 <= x <= 3`) and join with `and`, `or`, `not` (or `&& || !`, and a
comma for "and"). When every comparison is affine in x and y with rational
coefficients, the exact stage is a `polygons` frame: convex pieces with
rational corners and exact areas, the outer boundary with each edge marked
strict (dashed) or not (solid), and the corners where two boundary lines meet,
each marked included or not. Otherwise the exact stage is a certified pixel
classification: `inside` rectangles lie entirely in the region, `boundary`
pixels are undecided, and every other pixel lies entirely outside.

`implicit("x^2 + y^2 = 4", params, vp)` draws a curve F(x, y) = 0. Its exact
stage is a cells frame like a graph's: the curve passes through no unshaded
pixel. Pixels listed in `sure` are proven to hold part of the curve (F is
continuous there and has opposite signs at two corners).

Both start with a float sketch (cell sampling and marching squares).

## Drawing and labels

`drawScene(ctx2d, vp, layers, { axes, scale })` and `sceneSVG(vp, layers,
{ axes, tex })` draw any mix of geometry objects, graph, curve and region
frames, and labels. Both go through `primitives(vp, layers)`, the one place
exact values become float pixel coordinates; the back ends only paint.
`label([x, y], "\\frac{1}{2}")` places TeX at a world point. On a canvas,
`mountLabels(container, vp, prims, { katex })` typesets labels in an HTML
layer over it; in SVG, pass `tex: (s) => katex.renderToString(s)`.

Axes options: `xUnit` / `yUnit` of `"pi"` label multiples of π (π/2, π, 3π/2)
and `"fraction"` label fractions. For logarithmic axes, plot
`logScale(f, { x: true, y: true })` on a viewport in log10 coordinates and
pass `xScale: "log"` / `yScale: "log"`, which labels powers of ten.

`area(polygon)` refuses a polygon whose boundary crosses itself (the shoelace
sum cancels there); `isSimple` tests for that and `signedArea` gives the raw
sum.

## Exporting: SVG, PNG, PDF, TikZ, PGFPlots, text

The same layers export several ways, with no dependencies:

```js
sceneSVG(vp, layers, { axes: true });                         // <svg> string
await scenePNG(vp, layers, { axes: true, scale: 2 });         // PNG bytes (canvas in browsers, built-in renderer elsewhere)
scenePDF(vp, layers, { axes: true });                         // one-page vector PDF bytes
scenePGFPlots(vp, layers, { axes: true, standalone: true });  // PGFPlots axis, curves as \addplot
sceneTikZ(vp, layers, { axes: true, width: 8 });              // LaTeX tikzpicture, 8 cm wide
sceneTikZ(vp, layers, { standalone: true });                  // a whole file: pdflatex figure.tex
sceneASCII(vp, layers, { axes: true, cols: 72 });             // 7-bit text
sceneASCII(vp, layers, { mode: "braille", color: true });     // Unicode Braille, ANSI colors
```

TikZ is written in world coordinates (a corner at (4, 0) is `(4,0)`), circles
stay circles, labels stay real TeX, and certified cells become merged filled
rectangles. Text marks every character any ink touches, so a certified frame
is still certified at character resolution; modes are `"ascii"` (curves drawn
with `- | / \ _` by direction), `"braille"` (2 x 4 dots per character) and
`"blocks"` (2 x 2 quadrants). PNG and PDF labels are plain text (PDF uses
Helvetica and Symbol); for TeX labels use TikZ or SVG with KaTeX. The PNG
font is DejaVu Sans, built into `src/render/font-data.js` by
`scripts/build-font.cjs`.

## Docs

The docs site lives in `docs/` (published at https://ratmath.com/graphics/):
overview, reference, an explore page, and topic pages, each ending with a
runnable code box (`SHOW(svg)` draws). Edit `docs/src/pages/*.html` and
`docs/assets/pages.js`, then `bun run docs:build`, which bundles
`docs/assets/graphics.js`, typesets math with KaTeX and runs every page's box.
`docs/assets/runbox.js` and `scripts/docs-kit.js` are shared with the other
RatMath docs sites (this copy of runbox.js adds `SHOW`).

## Demo

```sh
git submodule update --init   # vendor/analytic
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

- regions bounded by circles and conics drawn exactly (arcs), not pixel by pixel
- exact algebraic forms for irrational points of polynomials (√2 rather than a
  bracket); this needs `@ratmath/algebraic` as a dependency
- parametric curves with features (self-intersections, cusps, arc length)
- 3D surfaces, animation along a parameter
