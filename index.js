// @ratmath/graphics: exact-rational graphics with fast previews.
export { Refinement, live } from "./src/refine.js";
export {
  parse, num, v, op, call, toRational, freeVariables, isRationalOnly,
  compileFloat, compileInterval, compileExact, FUNCTIONS, CONSTANTS,
} from "./src/expr.js";
export { viewport, precisionFor, columnRationals } from "./src/viewport.js";
export { graph, sampleFloat, certifyGraph } from "./src/plot.js";
export { zeros, findZeros, floatZeros, zerosGenerator, simplestBetween } from "./src/roots.js";
export {
  features, featuresGenerator, floatFeatures, findPoles, polesGenerator, findExtrema, extremaGenerator,
  findInflections, inflectionsGenerator, denominators, findEndpoints, endpointsGenerator, domainArguments,
} from "./src/features.js";
export { derive, format } from "./src/derive.js";
export * as interval from "./src/interval.js";
export { drawCanvas, drawAsymptotes } from "./src/render/canvas.js";
export { toSVG } from "./src/render/svg.js";
export { drawMarkers, markerList, shade } from "./src/render/markers.js";
