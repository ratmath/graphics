// Certified classification of pixels for conditions in x and y.
//
// The viewport is split into boxes of pixels. Each box's exact x- and
// y-intervals go through interval arithmetic for every comparison F rel 0 of
// the condition. A comparison is then true on the whole box, false on the
// whole box, or undecided; and/or/not combine these three values. Decided
// parts of the condition are dropped as the boxes get smaller, so deep boxes
// only evaluate what is still open.
//
// A box that is true is inside the region, a box that is false is outside,
// and an undecided box is split, down to single pixels and then to
// sub-pixel boxes. A pixel that stays undecided is a boundary pixel: it may
// hold points on both sides. The guarantee:
//
//   every pixel reported inside lies entirely in the region,
//   every pixel not reported (inside or boundary) lies entirely outside.
//
// Where a function is undefined (sqrt of a negative, ln of 0, division by 0)
// the condition is false, so domain edges show up as boundary pixels too.

import { Rational } from "@ratmath/core";
import * as I from "./interval.js";
import { compileInterval, paramsToIntervals, paramsToRational } from "./expr.js";
import { precisionFor } from "./viewport.js";

const TRUE = 1;
const FALSE = 0;

/** Compile the comparisons of a condition tree for interval evaluation. */
export function compileTree(tree) {
  const go = (n) => {
    if (n.op === "cmp") return { op: "cmp", rel: n.rel, enclose: compileInterval(n.F, "x"), src: n };
    if (n.op === "not") return { op: "not", arg: go(n.arg) };
    return { op: n.op, args: n.args.map(go) };
  };
  return go(tree);
}

function decideAtom(ctx, n, X, P) {
  let r;
  I.resetClipped();
  try {
    r = n.enclose(ctx, X, P);
  } catch (e) {
    if (e instanceof RangeError) return n; // the kernel gave up (overflow): undecided
    throw e;
  }
  const clipped = I.wasClipped();
  if (!r) return FALSE; // undefined on the whole box
  const lo = r.lo;
  const hi = r.hi;
  switch (n.rel) {
    case "<":
      if (lo >= 0n) return FALSE;
      if (hi < 0n && !clipped) return TRUE;
      return n;
    case "<=":
      if (lo > 0n) return FALSE;
      if (hi <= 0n && !clipped) return TRUE;
      return n;
    case "=":
      if (lo > 0n || hi < 0n) return FALSE;
      return n;
    case "!=":
      if ((lo > 0n || hi < 0n) && !clipped) return TRUE;
      return n;
  }
  return n;
}

/**
 * Evaluate a compiled tree on a box. Returns TRUE, FALSE, or the residual
 * tree (only the parts still undecided).
 */
export function decide(ctx, n, X, P) {
  if (n === TRUE || n === FALSE) return n;
  switch (n.op) {
    case "cmp":
      return decideAtom(ctx, n, X, P);
    case "not": {
      const a = decide(ctx, n.arg, X, P);
      if (a === TRUE) return FALSE;
      if (a === FALSE) return TRUE;
      return { op: "not", arg: a };
    }
    case "and":
    case "or": {
      const stop = n.op === "and" ? FALSE : TRUE;
      const rest = [];
      for (const a of n.args) {
        const v = decide(ctx, a, X, P);
        if (v === stop) return stop;
        if (v !== TRUE && v !== FALSE) rest.push(v);
      }
      if (!rest.length) return n.op === "and" ? TRUE : FALSE;
      return rest.length === 1 ? rest[0] : { op: n.op, args: rest };
    }
  }
  return n;
}

/** Exact fixed-point x-interval of pixel columns [i0, i1). */
export function colsInterval(ctx, vp, i0, i1) {
  const a = vp.xmin.add(vp.dx.multiply(rat(i0)));
  const b = vp.xmin.add(vp.dx.multiply(rat(i1)));
  return { lo: I.floorDiv(a.numerator << ctx.K, a.denominator), hi: I.ceilDiv(b.numerator << ctx.K, b.denominator) };
}

/** Exact fixed-point y-interval of pixel rows [j0, j1) (row 0 at the top). */
export function rowsInterval(ctx, vp, j0, j1) {
  const top = vp.ymax.subtract(vp.dy.multiply(rat(j0)));
  const bot = vp.ymax.subtract(vp.dy.multiply(rat(j1)));
  return { lo: I.floorDiv(bot.numerator << ctx.K, bot.denominator), hi: I.ceilDiv(top.numerator << ctx.K, top.denominator) };
}

const rat = (n) => new Rational(BigInt(n));

/**
 * Generator: classify every pixel of the viewport for a condition tree.
 * Yields progress { done, of, step: "tile", partial } per tile and returns
 * { inside: [x, y, w, h, ...] pixel rectangles, boundary: columns of row
 * spans (like a graph's cells), boxes: evaluations }.
 *
 * options.subpixel: how many halvings below one pixel to try before a pixel
 * is reported as boundary (default 2, so up to 4 x 4 sub-boxes).
 */
export function* classify(tree, params, vp, { subpixel = 2, tile = 32, extraBits = 12, partialEvery = 4, yName = "y" } = {}) {
  const ctx = I.context(precisionFor(vp, extraBits + subpixel));
  const base = paramsToIntervals(ctx, paramsToRational(params));
  const compiled = compileTree(tree);
  const W = vp.width;
  const H = vp.height;
  const inside = [];
  const boundaryCols = Array.from({ length: W }, () => []);
  let boxes = 0;
  const frame = { kind: "region", width: W, height: H, inside, boundary: boundaryCols, tight: true, complete: false, boxes: 0 };

  const P = (Y) => ({ ...base, [yName]: Y });
  const evalBox = (node, X, Y) => {
    boxes++;
    return decide(ctx, node, X, P(Y));
  };

  // Sub-pixel test of one undecided pixel: returns "in", "out" or "mixed".
  const subTest = (node, X, Y, depth) => {
    const v = evalBox(node, X, Y);
    if (v === TRUE) return "in";
    if (v === FALSE) return "out";
    if (depth >= subpixel) return "mixed";
    const xm = (X.lo + X.hi) >> 1n;
    const ym = (Y.lo + Y.hi) >> 1n;
    let seen = null;
    for (const [Xs, Ys] of [
      [{ lo: X.lo, hi: xm }, { lo: Y.lo, hi: ym }],
      [{ lo: xm, hi: X.hi }, { lo: Y.lo, hi: ym }],
      [{ lo: X.lo, hi: xm }, { lo: ym, hi: Y.hi }],
      [{ lo: xm, hi: X.hi }, { lo: ym, hi: Y.hi }],
    ]) {
      const r = subTest(v, Xs, Ys, depth + 1);
      if (r === "mixed") return "mixed";
      if (seen && r !== seen) return "mixed";
      seen = r;
    }
    return seen;
  };

  const visit = (node, i0, i1, j0, j1) => {
    const X = colsInterval(ctx, vp, i0, i1);
    const Y = rowsInterval(ctx, vp, j0, j1);
    const v = evalBox(node, X, Y);
    if (v === TRUE) {
      inside.push(i0, j0, i1 - i0, j1 - j0);
      return;
    }
    if (v === FALSE) return;
    if (i1 - i0 === 1 && j1 - j0 === 1) {
      const r = subpixel > 0 ? subTest(v, X, Y, 0) : "mixed";
      if (r === "in") inside.push(i0, j0, 1, 1);
      else if (r === "mixed") boundaryCols[i0].push(j0, j0);
      return;
    }
    if (i1 - i0 >= j1 - j0) {
      const m = (i0 + i1) >> 1;
      visit(v, i0, m, j0, j1);
      visit(v, m, i1, j0, j1);
    } else {
      const m = (j0 + j1) >> 1;
      visit(v, i0, i1, j0, m);
      visit(v, i0, i1, m, j1);
    }
  };

  const tilesX = Math.ceil(W / tile);
  const tilesY = Math.ceil(H / tile);
  const of = tilesX * tilesY;
  let done = 0;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      visit(compiled, tx * tile, Math.min(W, (tx + 1) * tile), ty * tile, Math.min(H, (ty + 1) * tile));
      done++;
      frame.boxes = boxes;
      yield { done, of, step: "tile", partial: done % partialEvery === 0 ? frame : undefined };
    }
  }
  for (let i = 0; i < W; i++) boundaryCols[i] = mergeRows(boundaryCols[i]);
  frame.boxes = boxes;
  frame.complete = true;
  return frame;
}

function mergeRows(flat) {
  if (flat.length <= 2) return flat;
  const rows = [];
  for (let k = 0; k < flat.length; k += 2) rows.push(flat[k]);
  rows.sort((a, b) => a - b);
  const out = [rows[0], rows[0]];
  for (let k = 1; k < rows.length; k++) {
    if (rows[k] <= out[out.length - 1] + 1) out[out.length - 1] = Math.max(out[out.length - 1], rows[k]);
    else out.push(rows[k], rows[k]);
  }
  return out;
}

export { TRUE, FALSE };
