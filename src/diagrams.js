// Diagrams for logic: the pictures phase of @ratmath/logic (phase 8).
//
//   proofTreeFigure   a sequent derivation drawn as a Gentzen tree: each
//                     inference a bar with the conclusion below, premises
//                     above and the rule's name to the right
//   truthTreeFigure   a truth tree (analytic tableau): blocks of numbered
//                     lines, branching below, ✗ under a closed branch and ○
//                     under an open one
//   vennFigure        one, two or three sets as circles, with the regions
//                     that a condition picks shaded
//   treeLayoutOf      the tidy layout both trees use, for any nested data
//
// Automata and Kripke frames are graphs: see automatonFigure and
// kripkeFigure in network.js. Nothing here imports the logic package; a
// derivation is anything with sequent, rule and premises, a truth tree
// anything with root: { lines, children, closed, open }.
//
// The layouts are exact: positions are whole numbers of character widths
// and rows. Text widths are counted in characters, so a long formula in a
// proportional font can run a little wider than its slot.

import { figure, shapes, path, text, image, CATEGORY } from "./figure.js";

const CHAR = 1; // one character
const ROW = 2.6; // one row of text
const GAP = 3; // between neighbouring subtrees
const STEP = 1.7 * ROW; // from a conclusion up to its premises
const len = (s) => [...String(s)].length * CHAR;
const show = (x, options) => (typeof x === "string" ? x : x?.toString ? x.toString(options) : String(x));

/**
 * A tidy layout for a tree given by width(node) and children(node): every
 * node is centred over its children's span, and subtrees sit GAP apart.
 * Returns [{ node, x, depth, width, span: [a, b] }] in pre-order.
 */
export function treeLayoutOf(root, { width, children, gap = GAP }) {
  const measure = (n) => {
    const cs = children(n).map(measure);
    const kids = cs.length ? cs.reduce((s, c) => s + c.total, 0) + gap * (cs.length - 1) : 0;
    const w = width(n);
    return { n, cs, w, total: Math.max(w, kids), kids };
  };
  const out = [];
  const place = (m, left, depth) => {
    const centre = left + m.total / 2;
    out.push({ node: m.n, x: centre, depth, width: m.w, span: [left, left + m.total] });
    let x = centre - m.kids / 2;
    for (const c of m.cs) {
      place(c, x, depth + 1);
      x += c.total + gap;
    }
  };
  place(measure(root), 0, 0);
  return out;
}

/**
 * A sequent derivation (logic's Derivation, or { sequent, rule, premises })
 * as a proof tree, conclusion at the bottom. Exact layout.
 */
export function proofTreeFigure(derivation, { title = "", options } = {}) {
  const label = (d) => show(d.sequent ?? d.conclusion ?? d.formula, options);
  const rule = (d) => String(d.rule ?? "");
  const items = treeLayoutOf(derivation, { width: (d) => len(label(d)) + 2 + 2 * (len(rule(d)) + 1), children: (d) => d.premises ?? [] });
  const height = Math.max(...items.map((i) => i.depth));
  const out = [];
  const byNode = new Map(items.map((i) => [i.node, i]));
  for (const it of items) {
    const yy = it.depth * STEP; // the conclusion (depth 0) is lowest
    out.push(text([it.x, yy], label(it.node), { label: label(it.node), color: "currentColor", size: 13, anchor: "c" }));
    const prem = it.node.premises ?? [];
    // the inference bar spans the conclusion and its premises
    const ps = prem.map((p) => byNode.get(p));
    const half = (p) => (len(label(p.node)) + 2) / 2;
    const left = Math.min(it.x - half(it), ...ps.map((p) => p.x - half(p)));
    const right = Math.max(it.x + half(it), ...ps.map((p) => p.x + half(p)));
    const bar = yy + STEP / 2;
    out.push(path([[left, bar], [right, bar]], { color: "currentColor", width: 1.2 }));
    if (rule(it.node)) out.push(text([right + 0.6, bar], rule(it.node), { label: rule(it.node), color: CATEGORY[0], size: 11, anchor: "e" }));
  }
  const xs = items.flatMap((i) => [i.x - i.width / 2, i.x + i.width / 2]);
  const X = [Math.min(...xs) - 1, Math.max(...xs) + 1];
  const Y = [-ROW, height * STEP + ROW];
  return figure({ layers: [shapes(out)], x: X, y: Y, equal: true, status: "exact", title, size: sizeFor(X, Y), inferences: items.length });
}
const sizeFor = (X, Y) => {
  const px = 8.2; // pixels per character width at 13 px text
  const w = Math.max(240, Math.min(1400, Math.round((X[1] - X[0]) * px)));
  return { width: w, height: Math.max(120, Math.round((w * (Y[1] - Y[0])) / (X[1] - X[0]))) };
};

/**
 * A truth tree (logic's Tableau, or { root }) top down. Each node's lines
 * are numbered with the rule and the line they came from; ✗ marks a closed
 * branch (with the lines that close it), ○ a finished open branch.
 */
export function truthTreeFigure(tree, { title = "", options, rules = true } = {}) {
  const root = tree.root ?? tree;
  const lineText = (l) => `${l.n}. ${show(l.formula, options)}${rules && l.rule && l.rule !== "premise" ? `   ${l.rule}${l.from ? " " + l.from : ""}` : ""}`;
  const width = (n) => Math.max(4, ...n.lines.map((l) => len(lineText(l)))) + 2;
  const items = treeLayoutOf(root, { width, children: (n) => n.children ?? [] });
  // depth → y of the node's first line: nodes at one depth start together
  const rowsAt = [];
  for (const it of items) rowsAt[it.depth] = Math.max(rowsAt[it.depth] ?? 0, it.node.lines.length + (it.node.closed || it.node.open ? 1 : 0));
  const top = [];
  let y = 0;
  rowsAt.forEach((r, d) => {
    top[d] = y;
    y -= (r + 1.4) * ROW;
  });
  const out = [];
  const pos = new Map();
  for (const it of items) {
    const y0 = top[it.depth];
    pos.set(it.node, { x: it.x, y0, y1: y0 - (it.node.lines.length - 1) * ROW });
    it.node.lines.forEach((l, k) => out.push(text([it.x, y0 - k * ROW], lineText(l), { label: lineText(l), color: "currentColor", size: 13 })));
    const end = y0 - it.node.lines.length * ROW;
    if (it.node.closed) out.push(text([it.x, end], `✗ ${it.node.closed.join(", ")}`, { tex: `\\times\\ ${it.node.closed.join(", ")}`, label: `✗ ${it.node.closed.join(", ")}`, color: CATEGORY[1], size: 13 }));
    else if (it.node.open) out.push(text([it.x, end], "○ open", { tex: "\\circ\\ \\text{open}", label: "○ open", color: CATEGORY[2], size: 13 }));
  }
  for (const it of items) {
    const p = pos.get(it.node);
    for (const c of it.node.children ?? []) {
      const q = pos.get(c);
      out.push(path([[p.x, p.y1 - 0.6 * ROW], [q.x, q.y0 + 0.6 * ROW]], { color: "#64748b", width: 1.2 }));
    }
  }
  const xs = items.flatMap((i) => [i.x - i.width / 2, i.x + i.width / 2]);
  const X = [Math.min(...xs) - 1, Math.max(...xs) + 1];
  const Y = [y + ROW, ROW];
  return figure({ layers: [shapes(out)], x: X, y: Y, equal: true, status: "exact", title, size: sizeFor(X, Y), branches: items.filter((i) => !(i.node.children ?? []).length).length });
}

const VENN = {
  1: [[0, 0, 1]],
  2: [[-0.55, 0, 1], [0.55, 0, 1]],
  3: [[-0.55, 0.35, 1], [0.55, 0.35, 1], [0, -0.6, 1]],
};

/**
 * A Venn diagram of up to three sets. shade picks regions: a function of
 * the memberships ({ A: true, B: false, … } → boolean), or a list of
 * membership strings such as "110" (in the first two sets, not the third).
 * marks: { "10": "×" } puts a mark in a region (an "at least one" claim in a
 * syllogism). The circles are drawn as paths; the shading is a grid of cells
 * (pixels), so it is estimated at the boundaries.
 */
export function vennFigure(sets, { shade = () => false, marks = {}, resolution = 220, title = "", universe = true } = {}) {
  const names = sets.map(String);
  const n = names.length;
  if (n < 1 || n > 3) throw new RangeError("a Venn diagram here has one, two or three sets");
  const C = VENN[n];
  const pick = typeof shade === "function" ? shade : (m) => shade.includes(names.map((s) => (m[s] ? "1" : "0")).join(""));
  const X = [-2, 2];
  const Y = [-1.9, 1.6];
  const w = resolution;
  const h = Math.round((resolution * (Y[1] - Y[0])) / (X[1] - X[0]));
  const cells = new Array(w * h).fill(null);
  const memberAt = (x, y) => Object.fromEntries(names.map((s, i) => [s, (x - C[i][0]) ** 2 + (y - C[i][1]) ** 2 < C[i][2] ** 2]));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = X[0] + ((i + 0.5) * (X[1] - X[0])) / w;
      const y = Y[0] + ((j + 0.5) * (Y[1] - Y[0])) / h;
      const m = memberAt(x, y);
      if (!universe && !names.some((s) => m[s])) continue;
      if (pick(m)) cells[j * w + i] = "#c7d2fe";
    }
  const out = [];
  if (universe) out.push(path([[X[0] + 0.1, Y[0] + 0.1], [X[1] - 0.1, Y[0] + 0.1], [X[1] - 0.1, Y[1] - 0.1], [X[0] + 0.1, Y[1] - 0.1]], { closed: true, color: "#64748b", width: 1.2 }));
  C.forEach(([cx, cy, r], i) => {
    out.push(path(Array.from({ length: 97 }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / 96), cy + r * Math.sin((2 * Math.PI * k) / 96)]), { color: CATEGORY[i], width: 2 }));
    const lx = cx + (n === 1 ? 0 : 1.15 * (cx === 0 ? 0 : Math.sign(cx))) * r * 0.7;
    const ly = cy + (cy < 0 ? -1.12 : 1.12) * r;
    out.push(text([lx, ly], names[i], { label: names[i], color: CATEGORY[i], size: 15 }));
  });
  for (const [key, mark] of Object.entries(marks)) {
    const p = regionPoint(C, key);
    if (p) out.push(text(p, mark, { label: mark, color: "currentColor", size: 16 }));
  }
  const regions = [];
  for (let m = 0; m < 1 << n; m++) {
    const key = names.map((_, i) => ((m >> (n - 1 - i)) & 1 ? "1" : "0")).join("");
    const memb = Object.fromEntries(names.map((s, i) => [s, key[i] === "1"]));
    if (pick(memb)) regions.push(key);
  }
  return figure({ layers: [image({ x: X, y: Y, width: w, height: h, cells }), shapes(out)], x: X, y: Y, equal: true, status: "estimated", title, regions, size: { width: 400, height: 350 } });
}
/** A point inside the region with this membership string (found on a grid). */
function regionPoint(C, key) {
  let best = null;
  for (let y = -1.8; y <= 1.5; y += 0.05)
    for (let x = -1.9; x <= 1.9; x += 0.05) {
      const m = C.map(([cx, cy, r]) => ((x - cx) ** 2 + (y - cy) ** 2 < r * r ? "1" : "0")).join("");
      if (m !== key) continue;
      // prefer the point furthest from every circle's edge
      const depth = Math.min(...C.map(([cx, cy, r]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));
      if (!best || depth > best[2]) best = [x, y, depth];
    }
  return best ? [best[0], best[1]] : null;
}
