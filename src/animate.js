// Animation along a parameter.
//
// The parameter takes exact rational values, so every frame is the same
// computation a slider would ask for. While it plays, each frame draws the
// quick stage; when it pauses or ends, `onSettle` is the place to draw the
// certified one.
//
//   const anim = animate((a) => {
//     drawScene(ctx, vp, [graph("sin(a*x)", { a }, vp).quick.value], { axes: true, background: "#fff" });
//   }, { from: 1, to: 4, steps: 90, duration: 3000, bounce: true,
//        onSettle: async (a) => drawScene(ctx, vp, [await graph("sin(a*x)", { a }, vp).settle()], { axes: true, background: "#fff" }) });
//   anim.play();
//
// The same frames export as one animated SVG or an animated PNG.

import { Rational } from "@ratmath/core";
import { toRational } from "./expr.js";
import { axesPrimitives, primitives, svgElements } from "./render/scene.js";
import { rasterize, pngChunks } from "./render/raster.js";

/** n + 1 exact values from `from` to `to`, evenly spaced. */
export function parameterSteps(from, to, n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("parameterSteps needs a whole number of steps");
  const a = toRational(from);
  const b = toRational(to);
  const h = b.subtract(a).divide(new Rational(BigInt(n)));
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? b : a.add(h.multiply(new Rational(BigInt(i))))));
}

/**
 * Play a parameter from `from` to `to`. `draw(value, info)` is called for each
 * frame with the exact Rational value and { index, steps, playing }.
 * Options: steps (default 60), duration in ms for one pass (default 3000),
 * loop (default true), bounce (run back and forth), onSettle(value, info)
 * when the animation pauses, is sought, or finishes, and `clock` =
 * { now(), request(fn), cancel(id) } to replace requestAnimationFrame.
 * Returns { play, pause, toggle, seek(index), seekTo(fraction), stop,
 * playing, index, value, values }.
 */
export function animate(draw, { from = 0, to = 1, steps = 60, duration = 3000, loop = true, bounce = false, onSettle, clock } = {}) {
  const values = parameterSteps(from, to, steps);
  const raf = typeof requestAnimationFrame === "function";
  const c = clock ?? {
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    request: (fn) => (raf ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
    cancel: (id) => (raf ? cancelAnimationFrame(id) : clearTimeout(id)),
  };
  const state = { playing: false, index: 0, handle: null, origin: 0 };
  const info = () => ({ index: state.index, steps, playing: state.playing });
  const show = () => draw(values[state.index], info());
  const settle = () => onSettle?.(values[state.index], info());
  /** Frame index at a time since the start: a sawtooth, or a triangle when bouncing. */
  const indexAt = (elapsed) => {
    const pass = elapsed / duration;
    if (!loop && pass >= (bounce ? 2 : 1)) return { index: bounce ? 0 : steps, done: true };
    const t = bounce ? 1 - Math.abs((pass % 2) - 1) : pass % 1;
    return { index: Math.min(steps, Math.floor(t * (steps + (bounce ? 0 : 1)) + (bounce ? 0.5 : 0))), done: false };
  };
  const tick = () => {
    if (!state.playing) return;
    const { index, done } = indexAt(c.now() - state.origin);
    if (done) state.playing = false;
    if (index !== state.index) {
      state.index = index;
      show();
    }
    if (done) {
      state.handle = null;
      settle();
      return;
    }
    state.handle = c.request(tick);
  };
  const api = {
    values,
    get playing() { return state.playing; },
    get index() { return state.index; },
    get value() { return values[state.index]; },
    play() {
      if (state.playing) return api;
      state.playing = true;
      // resume from the current frame
      const frac = bounce ? state.index / steps : state.index / (steps + 1);
      state.origin = c.now() - frac * duration;
      show();
      state.handle = c.request(tick);
      return api;
    },
    pause() {
      if (!state.playing) return api;
      state.playing = false;
      if (state.handle !== null) c.cancel(state.handle);
      state.handle = null;
      settle();
      return api;
    },
    toggle() { return state.playing ? api.pause() : api.play(); },
    seek(index) {
      const wasPlaying = state.playing;
      if (wasPlaying) { state.playing = false; if (state.handle !== null) c.cancel(state.handle); state.handle = null; }
      state.index = Math.max(0, Math.min(steps, Math.round(index)));
      show();
      settle();
      return api;
    },
    seekTo(fraction) { return api.seek(fraction * steps); },
    stop() {
      if (state.handle !== null) c.cancel(state.handle);
      state.handle = null;
      state.playing = false;
      state.index = 0;
      return api;
    },
  };
  return api;
}

const frameList = (frames) => {
  const list = typeof frames === "function" ? null : frames;
  if (!list || !list.length) throw new RangeError("an animation needs at least one frame (an array of layer lists)");
  return list;
};

/**
 * Frames as one animated SVG (SMIL: it plays wherever SVG images do, with no
 * script). `frames` is a list of layer lists, one per frame, all drawn on the
 * same viewport. Options: duration in ms for the whole run (default 3000),
 * loop, axes, background, tex, width/height.
 */
export function animationSVG(vp, frames, options = {}) {
  const list = frameList(frames);
  const { duration = 3000, loop = true, axes, background, width = vp.width, height = vp.height } = options;
  const n = list.length;
  const dur = `${(duration / 1000).toFixed(3)}s`;
  const bg = background ? `<rect width="${vp.width}" height="${vp.height}" fill="${background}"/>` : "";
  const fixed = axes ? svgElements(axesPrimitives(vp, axes === true ? {} : axes), options) : "";
  const groups = list.map((layers, k) => {
    const body = svgElements(primitives(vp, layers, options), options);
    if (n === 1) return `<g>${body}</g>`;
    // visible only during its own slice of the run
    const t0 = (k / n).toFixed(5);
    const t1 = ((k + 1) / n).toFixed(5);
    const values = k === 0 ? "visible;hidden" : k === n - 1 ? "hidden;visible" : "hidden;visible;hidden";
    const keyTimes = k === 0 ? `0;${t1}` : k === n - 1 ? `0;${t0}` : `0;${t0};${t1}`;
    return `<g visibility="${k === 0 ? "visible" : "hidden"}"><animate attributeName="visibility" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}" repeatCount="${loop ? "indefinite" : "1"}" fill="freeze"/>${body}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vp.width} ${vp.height}" style="max-width:100%;height:auto">${bg}<g>${fixed}</g>${groups.join("")}</svg>`;
}

/**
 * Frames as an animated PNG (APNG), a Promise of the file's bytes. Browsers
 * play it in an <img>; other viewers show the first frame. Options: duration
 * in ms for the whole run, loop, axes, background (default white), scale.
 */
export async function animationPNG(vp, frames, options = {}) {
  const list = frameList(frames);
  const { duration = 3000, loop = true, axes, background = "#ffffff" } = options;
  const images = list.map((layers) => {
    const prims = [...(axes ? axesPrimitives(vp, axes === true ? {} : axes) : []), ...primitives(vp, layers, options)];
    return rasterize(vp, prims, { ...options, background });
  });
  return pngChunks(images, { delayMs: duration / list.length, loop });
}
