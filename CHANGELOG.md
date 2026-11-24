# Changelog

## Unreleased

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

- The parser, AST builders and number reader are `@ratmath/analytic`'s; the
  local copy and the local certified zero finder are gone (about 380 lines).
  `zerosGenerator` is now the analytic-backed generator and returns the list.
- `features` returns `undefined` next to `poles` and `holes`; `poles` holds
  proven poles only. Zeros may have kind `everywhere` (f is zero on a whole
  stretch).
- Requires `@ratmath/core` ^0.9.0.

### Added

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
