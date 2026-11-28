# Changelog

## Unreleased

- Docs: the browser bundle is rebuilt against Core 0.12 (the checked-in one
  still rounded 65 to 60 at the tens and returned a bare BigInt from
  `floor()`), is built without identifier minification (Bun renames classes
  even with `keepNames`, which broke `new Rational(q.floor())` and
  `q.add(q.floor())` in the browser), and the docs build now runs every code
  box against the emitted bundle after a mixed Integer/Rational check. Found
  by the external QA review.

- Requires Core 0.12: the `@ratmath/core` peer range is now `>=0.12.0` (Core 0.12 returns Integers from `floor`/`ceil`/`trunc`/`round` and rounds half up by default).
- `@ratmath/core` is now a peer dependency (`>=0.10.0 <0.12.0`): the package
  uses the program's own copy of Core instead of bringing its own, so Core 0.11
  works and there is never a second copy whose `Rational` is not the same class.

### Added

- Pictures for the Shelf (roadmap step 14): figures with a status (exact,
  certified, estimated, simulated), `shapes` and `image` frames drawn by every
  back end, animated frames; charts for statistics and finance; graph drawing
  with an exact Tutte layout and crossing check; proof trees, truth trees and
  Venn diagrams; pictures of dynamics; phase portraits with proved
  equilibria, moving frames, curvature colouring and numerical-method
  pictures; polygons and lit solids (`faces3d` and per-cell colours in
  `project3d`). Eight docs pages.

### Fixed

- A dashed asymptote is drawn only where a pole is proven. `sin(1/x)`,
  `x*sin(1/x)` and `exp(-1/x^2)` used to get an "uncertain" line at 0; such
  points are now listed under `undefined` (in `features` and in graph frames)
  and get no line. The quick sketch marks an asymptote only where the value
  really grows.
- Powers with an odd denominator (`x^(1/3)`, `x^(2/3)`) are real roots and are
  drawn for negative x; `x^(-1/3)` gets its pole.
- `area` refuses a polygon whose boundary crosses itself instead of returning
  the cancelled shoelace sum; `isSimple` tests for it.
- `index.d.ts` declares every export and matches the current record shapes.

### Changed

- `Refinement` and `live` now come from `@ratmath/core/refine` (Core 0.10.0),
  one class shared by every RatMath library. The exports here are unchanged.
- The parser, AST builders and number reader are `@ratmath/analytic`'s; the
  local copy and the local certified zero finder are gone (about 380 lines).
  `zerosGenerator` is now the analytic-backed generator and returns the list.
- `features` returns `undefined` next to `poles` and `holes`; `poles` holds
  proven poles only. Zeros may have kind `everywhere` (f is zero on a whole
  stretch).
- Requires `@ratmath/core` ^0.10.0.

### Added

- Regions bounded by conics are exact. When every comparison has degree at
  most two, `region(...).exact()` returns a `conics` frame: arcs with strict
  flags, corners in closed form such as (√2, √2), isolated and missing points,
  fill polygons and the area. `conicAtoms`, `exactConicRegion`, `conicType`.
- Closed forms for the points of a graph. Zeros, extrema, inflection points,
  poles, holes and intersections of rational functions carry `algebraic`
  (√2, ∛2, (1 + √5)/2, with the minimal polynomial) and `valueAlgebraic`.
  `featureLabels`, `withAlgebraicForms`, `radicalTeX`, `rationalForm`;
  `describe` uses the forms. `@ratmath/algebraic` is now a dependency.
- Calculus pictures: `tangent`, `secant`, `areaUnder`, `areaBetween` (improper
  integrals included), `riemannSum`, `taylorPolynomial`, `vectorField`,
  `gradientField`, `gradientAt`, `contours`. Exact where rational, certified
  otherwise.
- Three dimensions: `surface`, `parametricSurface`, `spaceCurve` (float grid,
  then certified vertices), `tangentPlane`, `points3d`, `segment3d`,
  `arrow3d`, `camera`, `orbit`, `spaceViewport` and `project3d`, which makes a
  `mesh` frame every exporter draws.
- Animation: `animate`, `parameterSteps`, `animationSVG` (SMIL) and
  `animationPNG` (APNG).
- Special functions from analytic in graphs: `gamma lgamma digamma trigamma
  besselJ Si fresnelS fresnelC`, with certified pixels.
- Expressions may be given as anything with an `.ast` (an analytic function).
- Docs pages for calculus pictures, surfaces and space curves, and animation.
- Functions from analytic in graphs and regions: `asin acos atan sinh cosh
  tanh log1p cbrt erf`. `asin` and `acos` report their domain ends.
- `parametric` and `polar` curves with certified cells.
- `intersections(f, g, …)` of two graphs.
- `@ratmath/graphics/worker`: `serveGraphics` and `workerClient`, so the
  certified stage runs in a Web Worker.
- Data frames `scatter`, `bars`, `histogram`; `slopeField`; `solutionCurve`
  for a certified ODE solution.
- `describe(f, params, range)`: a description of a graph in words from its
  certified features.
- Axis ticks in multiples of π or in fractions, and logarithmic axes with
  `logScale`.
- A docs page for curves, data and slope fields; pages link to GitHub, npm and
  the sibling libraries; a CI workflow.

## 0.1.0

First version: certified graphs, zeros and features, implicit curves and
regions, exact geometry, scenes and labels, exports to SVG, PNG, PDF, TikZ,
PGFPlots and text.
