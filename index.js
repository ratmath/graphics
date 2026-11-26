// @ratmath/graphics: exact-rational graphics with fast previews.
export { Refinement, live } from "@ratmath/core/refine";
export {
  parse, num, v, op, call, toRational, freeVariables, isRationalOnly,
  compileFloat, compileInterval, compileExact, FUNCTIONS, CONSTANTS, logScale, toAst,
} from "./src/expr.js";
export { viewport, precisionFor, columnRationals } from "./src/viewport.js";
export { graph, sampleFloat, certifyGraph } from "./src/plot.js";
export { parametric, polar, sampleParametric, certifyParametric } from "./src/curve.js";
export { scatter, bars, histogram, slopeField, solutionCurve } from "./src/data.js";
export { describe, describeFeatures } from "./src/describe.js";
export { zeros, findZeros, floatZeros, zerosGenerator, simplestBetween } from "./src/roots.js";
export {
  features, featuresGenerator, floatFeatures, findPoles, polesGenerator, findExtrema, extremaGenerator,
  findInflections, inflectionsGenerator, findHoles, denominators, findEndpoints, endpointsGenerator, domainArguments,
  intersections, findIntersections, intersectionsGenerator,
} from "./src/features.js";
export { differentiate as derive, format } from "@ratmath/analytic";
export * as interval from "./src/interval.js";
export { drawCanvas, drawAsymptotes } from "./src/render/canvas.js";
export { toSVG } from "./src/render/svg.js";
export { drawMarkers, markerList, shade } from "./src/render/markers.js";

// Exact geometry, regions and implicit curves, labels and scenes.
export { Surd, surd, sqrt, squareFree } from "./src/surd.js";
export {
  Point, Line, Polygon, Circle, point, line, segment, ray, polygon, circle, circumcircle,
  dist2, distance, midpoint, orientation, parallel, perpendicular, bisector, project, reflect,
  signedArea, area, isSimple, centroid, locate, convexHull, intersect,
} from "./src/geometry.js";
export { linearForm } from "./src/linear.js";
export { parseCondition, atoms, dnf, negationFree } from "./src/condition.js";
export { classify } from "./src/quadtree.js";
export { region, implicit, sketchRegion, sketchImplicit, linearPieces, exactLinearRegion } from "./src/region.js";
export { conicAtoms, exactConicRegion, conicType, NotConic } from "./src/conic.js";
export {
  label, texToText, primitives, axesPrimitives, niceStep, paint, drawScene, mountLabels, svgElements, sceneSVG, PALETTE,
} from "./src/render/scene.js";
export { sceneTikZ, scenePGFPlots, tikzElements, tikzAxes, simplifyPolyline } from "./src/render/tikz.js";
export { sceneASCII, asciiElements, asciiText } from "./src/render/ascii.js";
export { scenePDF, pdfContent, pdfTextRuns } from "./src/render/pdf.js";
export { scenePNG, rasterize, encodePNG } from "./src/render/raster.js";

// Calculus pictures, backed by @ratmath/analytic.
export {
  tangent, secant, areaUnder, areaBetween, riemannSum, taylorPolynomial, vectorField, gradientField, gradientAt, contours,
} from "./src/calculus.js";

// Three dimensions: surfaces, space curves and their projection.
export {
  camera, orbit, spaceViewport, surface, parametricSurface, spaceCurve, points3d, segment3d, arrow3d, tangentPlane, project3d,
} from "./src/space.js";

// Animation along an exact parameter.
export { animate, parameterSteps, animationSVG, animationPNG } from "./src/animate.js";

// Closed forms for irrational points, from @ratmath/algebraic.
export { withAlgebraicForms, featureLabels, radicalTeX } from "./src/exactform.js";
export { rationalForm } from "./src/polyform.js";

// Pictures for the Shelf packages: figures, charts, graph drawing, logic
// diagrams, dynamics, the section 13 pictures, polygons and solids.
export {
  figure, figureViewport, figureSize, figureSVG, figureTikZ, figureASCII, figurePDF, figurePNG, framesSVG, framesPNG,
  shapes, path, dot, arrow, text, image, extentOf, toNumber, rampColor, divergingColor, CATEGORY,
} from "./src/figure.js";
export {
  legend, fiveNumbers, boxPlot, histogramFigure, densityFigure, qqPlot, scatterFit, lineChart, powerCurve, samplingBuildUp,
  amortisationChart, balanceChart, fanChart, yieldCurveFigure, payoffFigure,
} from "./src/charts.js";
export {
  graphData, circleLayout, gridLayout, bipartiteLayout, layeredLayout, treeLayout, springLayout, tutteLayout, countCrossings,
  drawGraph, automatonFigure, kripkeFigure,
} from "./src/network.js";
export { treeLayoutOf, proofTreeFigure, truthTreeFigure, vennFigure } from "./src/diagrams.js";
export {
  cobwebFigure, orbitFigure, returnMapFigure, bifurcationFigure, escapeFigure, pointCloudFigure, attractor3d, segmentsFigure,
  spacetimeFigure, lifeFigure, parameterFrames,
} from "./src/dynamics.js";
export {
  zeroContour, phasePortrait, solutionFrames, frameAlongCurve, frameFrames, curvatureSurface, curveOnSurface, equalBox,
  newtonFigure, interpolationFigure, quadratureFigure, stabilityRegion, convergenceFigure,
} from "./src/analysis.js";
export { polygonsFigure, solidFigure, stepsFigures } from "./src/tiles.js";
