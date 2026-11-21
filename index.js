// @ratmath/graphics: exact-rational graphics with fast previews.
export { Refinement, live } from "./src/refine.js";
export {
  parse, num, v, op, call, toRational, freeVariables, isRationalOnly,
  compileFloat, compileInterval, compileExact, FUNCTIONS, CONSTANTS,
} from "./src/expr.js";
export { viewport, precisionFor, columnRationals } from "./src/viewport.js";
export { graph, sampleFloat, certifyGraph } from "./src/plot.js";
export { zeros, findZeros, floatZeros, zerosGenerator } from "./src/roots.js";
export * as interval from "./src/interval.js";
export { drawCanvas } from "./src/render/canvas.js";
export { toSVG } from "./src/render/svg.js";
