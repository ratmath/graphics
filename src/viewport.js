// An exact viewport: the world rectangle has rational edges and the screen is
// a grid of width x height pixel cells. Pixel column i covers the closed
// x-interval [xmin + i*dx, xmin + (i+1)*dx]; pixel row j (0 at the top) covers
// y in [ymax - (j+1)*dy, ymax - j*dy]. All of this is exact.

import { Rational } from "@ratmath/core";
import { toRational } from "./expr.js";
import * as I from "./interval.js";

export function viewport({ x, y, width, height }) {
  const [xmin, xmax] = x.map(toRational);
  const [ymin, ymax] = y.map(toRational);
  if (!xmin.lessThan(xmax) || !ymin.lessThan(ymax)) throw new RangeError("viewport needs min < max on both axes");
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new RangeError("viewport width and height must be positive integers");
  }
  const dx = xmax.subtract(xmin).divide(new Rational(width));
  const dy = ymax.subtract(ymin).divide(new Rational(height));
  const vp = { xmin, xmax, ymin, ymax, width, height, dx, dy };
  // Float copies for previews and drawing.
  vp.f = {
    xmin: xmin.toNumber(), xmax: xmax.toNumber(), ymin: ymin.toNumber(), ymax: ymax.toNumber(),
  };
  vp.f.dx = (vp.f.xmax - vp.f.xmin) / width;
  vp.f.dy = (vp.f.ymax - vp.f.ymin) / height;
  return Object.freeze(vp);
}

/** Bits of precision that make one ulp far smaller than a pixel. */
export function precisionFor(vp, extraBits = 12) {
  const small = vp.dx.lessThan(vp.dy) ? vp.dx : vp.dy;
  // log2(1/small), rounded up, using bit lengths of numerator and denominator.
  const bits = I.bitLength(small.denominator) - I.bitLength(small.numerator) + 1;
  return Math.max(16, bits + extraBits);
}

/** Exact x-interval of pixel column i, as an outward-rounded fixed-point interval. */
export function columnInterval(ctx, vp, i) {
  // xmin + i*dx  and  xmin + (i+1)*dx, both exact rationals.
  const a = vp.xmin.add(vp.dx.multiply(new Rational(i)));
  const b = vp.xmin.add(vp.dx.multiply(new Rational(i + 1)));
  return {
    lo: I.floorDiv(a.numerator << ctx.K, a.denominator),
    hi: I.ceilDiv(b.numerator << ctx.K, b.denominator),
  };
}

/** Exact x-interval of column i as two Core Rationals. */
export function columnRationals(vp, i) {
  return [vp.xmin.add(vp.dx.multiply(new Rational(i))), vp.xmin.add(vp.dx.multiply(new Rational(i + 1)))];
}

/**
 * The pixel rows (top, bottom inclusive, clipped to the screen) that the
 * y-interval [lo, hi] (fixed point at ctx) touches, or null if it misses the
 * screen. Computed exactly: row(y) = floor((ymax - y) / dy).
 */
export function rowSpan(ctx, vp, iv) {
  if (!iv) return null;
  const H = vp.height;
  // (ymax - y)/dy = (ymax*2^k - Y) * height / ((ymax - ymin) * 2^k)
  const span = vp.ymax.subtract(vp.ymin);
  const rowOf = (Y) => {
    if (Y === Infinity) return -1;
    if (Y === -Infinity) return H;
    // ymax = a/b, span = c/d: ((a*2^k - Y*b)/b) * H * d / (c * 2^k)
    const a = vp.ymax.numerator;
    const b = vp.ymax.denominator;
    const c = span.numerator;
    const d = span.denominator;
    const num = (a * ctx.one - Y * b) * BigInt(H) * d;
    const den = b * c * ctx.one;
    const r = I.floorDiv(num, den);
    // Clamp to a range that safely converts to a JS number.
    if (r < -1n) return -1;
    if (r > BigInt(H)) return H;
    return Number(r);
  };
  let top = rowOf(iv.hi);
  let bot = rowOf(iv.lo);
  if (bot < 0 || top >= H) return null; // entirely above or below the screen
  if (top < 0) top = 0;
  if (bot >= H) bot = H - 1;
  return [top, bot];
}

/** Float world -> pixel helpers (for previews and drawing). */
export function toPixelX(vp, x) {
  return ((x - vp.f.xmin) / (vp.f.xmax - vp.f.xmin)) * vp.width;
}

export function toPixelY(vp, y) {
  return ((vp.f.ymax - y) / (vp.f.ymax - vp.f.ymin)) * vp.height;
}
