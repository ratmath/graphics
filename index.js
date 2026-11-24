// @ratmath/graphics: exact-rational graphics with fast previews.
export { Refinement, live } from "@ratmath/core/refine";
export {
  parse, num, v, op, call, toRational, freeVariables, isRationalOnly,
  compileFloat, compileInterval, compileExact, FUNCTIONS, CONSTANTS, logScale,
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
export {
  label, texToText, primitives, axesPrimitives, niceStep, paint, drawScene, mountLabels, svgElements, sceneSVG, PALETTE,
} from "./src/render/scene.js";
export { sceneTikZ, scenePGFPlots, tikzElements, tikzAxes, simplifyPolyline } from "./src/render/tikz.js";
export { sceneASCII, asciiElements, asciiText } from "./src/render/ascii.js";
export { scenePDF, pdfContent, pdfTextRuns } from "./src/render/pdf.js";
export { scenePNG, rasterize, encodePNG } from "./src/render/raster.js";
