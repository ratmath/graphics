// Mounts the demos on each docs page.
import * as G from "./graphics.js?v=049ecde060";
import { mountRunboxes, KATEX_BASE } from "./runbox.js?v=049ecde060";

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== undefined && c !== null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colors = () => ["--c1", "--c2", "--c3", "--c4", "--c5"].map(css);

let katexPromise = null;
function katex() {
  if (!katexPromise) {
    if (!document.querySelector(`link[href^="${KATEX_BASE}"]`)) document.head.append(h("link", { rel: "stylesheet", href: `${KATEX_BASE}katex.min.css` }));
    katexPromise = import(/* @vite-ignore */ `${KATEX_BASE}katex.mjs`).then((m) => m.default ?? m).catch(() => null);
  }
  return katexPromise;
}

/** Typeset TeX into an element (plain text until KaTeX arrives). */
function tex(el, latex, display = false) {
  el.textContent = G.texToText(latex);
  katex().then((k) => k && k.render(latex, el, { throwOnError: false, displayMode: display }));
  return el;
}
const T = (latex, display) => tex(h("span"), latex, display);

/** A canvas plot with exact viewport, axes, TeX label overlay, and optional pan and zoom. */
class Plot {
  constructor(host, { x = [-6, 6], y = [-4, 4], width = 640, height = 400, pan = false, onView } = {}) {
    this.width = width;
    this.height = height;
    this.home = { x, y };
    this.canvas = h("canvas", { width, height, role: "img", "aria-label": "plot" });
    this.wrap = h("div", { class: "plotwrap" }, this.canvas);
    host.append(this.wrap);
    this.scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    this.canvas.width = width * this.scale;
    this.canvas.height = height * this.scale;
    this.ctx = this.canvas.getContext("2d");
    this.onView = onView;
    this.setView(x, y);
    if (pan) this.enablePan();
  }
  setView(x, y) {
    this.vp = G.viewport({ x, y, width: this.width, height: this.height });
  }
  enablePan() {
    let start = null;
    const c = this.canvas;
    c.style.cursor = "grab";
    c.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY, vp: this.vp };
      c.setPointerCapture(e.pointerId);
      c.style.cursor = "grabbing";
    });
    c.addEventListener("pointermove", (e) => {
      if (!start) return;
      const k = this.width / c.getBoundingClientRect().width;
      // Whole-pixel shifts keep the viewport exact: each is a multiple of dx, dy.
      const di = Math.round((e.clientX - start.x) * k);
      const dj = Math.round((e.clientY - start.y) * k);
      const v = start.vp;
      const sx = v.dx.multiply(new G.Rational(BigInt(di)));
      const sy = v.dy.multiply(new G.Rational(BigInt(dj)));
      this.setView([v.xmin.subtract(sx), v.xmax.subtract(sx)], [v.ymin.add(sy), v.ymax.add(sy)]);
      this.onView?.();
    });
    const end = () => {
      start = null;
      c.style.cursor = "grab";
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }
  zoom(factor) {
    // factor is "1/2" (in) or 2 (out), about the centre; exact.
    const v = this.vp;
    const f = new G.Rational(factor);
    const cx = v.xmin.add(v.xmax).divide(new G.Rational(2n));
    const cy = v.ymin.add(v.ymax).divide(new G.Rational(2n));
    const hx = v.xmax.subtract(v.xmin).multiply(f).divide(new G.Rational(2n));
    const hy = v.ymax.subtract(v.ymin).multiply(f).divide(new G.Rational(2n));
    this.setView([cx.subtract(hx), cx.add(hx)], [cy.subtract(hy), cy.add(hy)]);
    this.onView?.();
  }
  reset() {
    this.setView(this.home.x, this.home.y);
    this.onView?.();
  }
  zoomBar() {
    return h("span", { class: "seg" },
      h("button", { type: "button", title: "Zoom in", onclick: () => this.zoom("1/2") }, "+"),
      h("button", { type: "button", title: "Zoom out", onclick: () => this.zoom(2) }, "−"),
      h("button", { type: "button", title: "Reset view", onclick: () => this.reset() }, "Reset"));
  }
  /** Draw layers (see the library's drawScene); `after(ctx, vp, scale)` may paint more (markers). */
  draw(layers, { after, labels = true } = {}) {
    const bg = css("--surface") || "#fff";
    const prims = G.drawScene(this.ctx, this.vp, layers, {
      scale: this.scale, background: bg, labels: false, colors: colors(),
      axes: { grid: css("--grid"), axis: css("--axis"), text: css("--muted") },
    });
    // tick labels are plain text; draw them on the canvas
    G.paint(this.ctx, prims.filter((p) => p.t === "label" && p.plain), { scale: this.scale, background: bg });
    after?.(this.ctx, this.vp, this.scale);
    if (labels) katex().then((k) => G.mountLabels(this.wrap, this.vp, prims, { katex: k }));
  }
}

function status() {
  const s = h("span", { class: "gstatus" }, "…");
  s.set = (text, exact) => {
    s.textContent = text;
    s.classList.toggle("exact", !!exact);
  };
  return s;
}

function card(el, title, ...kids) {
  el.classList.add("gdemo");
  el.replaceChildren(h("h3", { class: "demo-title" }, title), ...kids.filter(Boolean));
  return el;
}

/** Sliders for free parameters: exact values k/den. */
function sliders(host, names, { den = 8, range = 5, values = {}, oninput }) {
  host.replaceChildren();
  const state = {};
  for (const n of names) {
    const v0 = Math.round((values[n] ?? 1) * den);
    const out = h("output", {}, "");
    const show = (k) => {
      const q = new G.Rational(BigInt(k), BigInt(den));
      out.textContent = q.toString();
      state[n] = q.toString();
    };
    const input = h("input", { type: "range", min: -range * den, max: range * den, step: 1, value: v0, "aria-label": n });
    input.addEventListener("input", () => {
      show(Number(input.value));
      oninput();
    });
    show(v0);
    host.append(h("span", {}, n), input, out);
  }
  return state;
}

const freeParams = (text, skip) => {
  try {
    return [...G.freeVariables(G.parse(text))].filter((n) => !skip.includes(n)).sort();
  } catch {
    return [];
  }
};

function paramsOfCondition(text) {
  const tree = G.parseCondition(text);
  const names = new Set();
  for (const a of G.atoms(tree)) for (const n of G.freeVariables(a.F)) if (n !== "x" && n !== "y") names.add(n);
  return [...names].sort();
}

// ---------------------------------------------------------------- graph y = f(x)

function graphDemo(el, { title = "y = f(x)", expr = "a*sin(b*x) + c*x", values = { a: 2, b: 1, c: 0.25 }, x = [-8, 8], y = [-6, 6], markers = true, note } = {}) {
  const input = h("input", { class: "expr", value: expr, spellcheck: "false", "aria-label": "f(x)" });
  const st = status();
  const box = h("div", { class: "gsliders" });
  const plotHost = h("div");
  const out = h("div", { class: "gout" });
  card(el, title, h("div", { class: "row" }, h("label", {}, "y ="), input, st), box, plotHost, note ? h("p", { class: "gnote" }, note) : null, out);
  let ast = null;
  let shown = null;
  let feats = null;
  let params = {};
  const plot = new Plot(plotHost, { x, y, pan: true, onView: () => update() });
  plotHost.prepend(h("div", { class: "row", style: "margin-bottom:.4rem" }, plot.zoomBar(), h("span", { class: "gnote" }, "Drag to pan.")));
  const redraw = () => {
    if (!shown) return;
    const c = shown.exact ? css("--c3") : css("--c1");
    plot.draw([{ item: shown.value, color: c, asymptoteColor: css("--muted") }], {
      after: (ctx, vp, scale) => feats && G.drawMarkers(ctx, vp, feats, { color: c, background: css("--surface"), scale }),
    });
  };
  let featJob = null;
  const update = G.live(
    () => G.graph(ast, params, plot.vp),
    (stage) => {
      shown = stage;
      st.set(stage.exact ? (stage.value.tight ? "certified" : "certified (coarse)") : "sketch", stage.exact);
      if (stage.exact && markers) runFeatures();
      else feats = null;
      redraw();
    },
    { idleMs: 120, onProgress: (p) => p.partial && st.set(`certifying ${Math.round((100 * p.done) / p.of)}%`) },
  );
  const runFeatures = () => {
    featJob?.abort();
    const ac = new AbortController();
    featJob = ac;
    const job = G.features(ast, params, [plot.vp.xmin, plot.vp.xmax]);
    feats = job.quick.value;
    job.settle({ signal: ac.signal }).then((f) => {
      if (ac.signal.aborted) return;
      feats = f;
      redraw();
      listFeatures(f);
    }).catch(() => {});
  };
  const fmt = (r) => (r.at ? r.at.toString() : `[${r.lo.toDecimal(6)}, ${r.hi.toDecimal(6)}]`);
  const listFeatures = (f) => {
    const where = (r) => {
      const x = r.algebraic?.closedForm ? T(r.algebraic.tex) : fmt(r);
      const y = r.valueAlgebraic?.closedForm ? T(r.valueAlgebraic.tex) : r.value ? r.value.toString() : null;
      return y && (r.algebraic || r.valueAlgebraic) ? ["(", x, ", ", y, ")"] : [x];
    };
    const sec = (k, list) => (list.length ? [h("div", { class: "k" }, k), h("ul", {}, list.map((r) => h("li", {}, `${r.kind}: `, ...where(r))))] : []);
    out.replaceChildren(...sec("zeros", f.zeros), ...sec("extrema", f.extrema), ...sec("inflections", f.inflections), ...sec("holes", f.holes), ...sec("poles", f.poles));
  };
  const setExpr = () => {
    try {
      ast = G.parse(input.value);
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    const names = freeParams(input.value, ["x"]);
    params = sliders(box, names, { values, oninput: () => update() });
    out.replaceChildren();
    update();
  };
  input.addEventListener("change", setExpr);
  setExpr();
}

// ---------------------------------------------------------------- sketch vs certified

function fastCertified(el) {
  const st = status();
  let mode = "both";
  const seg = h("span", { class: "seg" });
  const plotHost = h("div");
  card(el, "The same graph, twice: y = sin(1/x)", h("div", { class: "row" }, seg, st), plotHost,
    h("p", { class: "gnote" }, "The float sketch samples one point per pixel and connects them, so near 0 it draws a few confident zigzags. The certified cells shade every pixel the graph can touch: near 0 that is the whole band from −1 to 1, which is the truth."));
  const plot = new Plot(plotHost, { x: [-1, 1], y: ["-3/2", "3/2"], width: 640, height: 320, pan: true, onView: () => go() });
  plotHost.prepend(h("div", { class: "row", style: "margin-bottom:.4rem" }, plot.zoomBar()));
  for (const m of ["sketch", "certified", "both"]) {
    seg.append(h("button", { type: "button", class: m === mode ? "on" : "", onclick: (e) => {
      mode = m;
      for (const b of seg.children) b.classList.toggle("on", b === e.target);
      draw();
    } }, m));
  }
  let quick = null;
  let cells = null;
  const draw = () => {
    const layers = [];
    if (cells && mode !== "sketch") layers.push({ item: cells, color: css("--c3") });
    if (quick && mode !== "certified") layers.push({ item: quick, color: css("--c2"), width: 1.5 });
    plot.draw(layers);
  };
  let ac = null;
  const go = () => {
    ac?.abort();
    ac = new AbortController();
    const g = G.graph("sin(1/x)", {}, plot.vp, { asymptotes: false });
    quick = g.quick.value;
    cells = null;
    st.set("sketch");
    draw();
    const t0 = performance.now();
    g.settle({ signal: ac.signal, onProgress: (p) => p.partial && ((cells = p.partial), draw()) }).then((c) => {
      cells = c;
      st.set(`certified in ${Math.round(performance.now() - t0)} ms`, true);
      draw();
    }).catch(() => {});
  };
  go();
}

// ---------------------------------------------------------------- implicit curves

const IMPLICIT_EXAMPLES = ["x^2 + y^2 = a", "y^2 = x^3 - 2x + a", "x^3 + y^3 = 3a x y", "sin(x) + cos(y) = a/2", "(x^2 + y^2)^2 = 8a(x^2 - y^2)", "x^4 + y^4 - 4(x^2 + y^2) + a = 0"];

function implicitDemo(el, { expr = IMPLICIT_EXAMPLES[1], x = [-4, 4], y = ["-5/2", "5/2"], examples = IMPLICIT_EXAMPLES } = {}) {
  const input = h("input", { class: "expr", value: expr, spellcheck: "false", "aria-label": "equation" });
  const st = status();
  const box = h("div", { class: "gsliders" });
  const plotHost = h("div");
  const ex = h("div", { class: "row" }, examples.map((e) => h("button", { type: "button", class: "ghost", onclick: () => {
    input.value = e;
    setExpr();
  } }, e)));
  const legend = h("div", { class: "legend" },
    h("span", {}, h("i", { style: `background:${css("--c1")}` }), "sketch (marching squares)"),
    h("span", {}, h("i", { style: `background:${css("--c3")}` }), "curve proven to pass through"),
    h("span", {}, h("i", { style: `background:${css("--c3")};opacity:.35` }), "may pass through"));
  card(el, "Implicit curve F(x, y) = 0", h("div", { class: "row" }, input, st), box, ex, plotHost, legend);
  const plot = new Plot(plotHost, { x, y, width: 640, height: 400, pan: true, onView: () => update() });
  plotHost.prepend(h("div", { class: "row", style: "margin-bottom:.4rem" }, plot.zoomBar()));
  let cond = null;
  let params = {};
  let shown = null;
  const redraw = () => {
    if (!shown) return;
    if (!shown.exact) return plot.draw([{ item: shown.value, color: css("--c1"), width: 1.5 }]);
    const v = shown.value;
    const sure = { ...v, columns: v.sure.map((rows) => rows.flatMap((r) => [r, r])) };
    plot.draw([{ item: v, color: fade(css("--c3"), 0.35) }, { item: sure, color: css("--c3") }]);
  };
  const update = G.live(
    () => G.implicit(cond, params, plot.vp),
    (stage) => {
      shown = stage;
      const v = stage.value;
      st.set(stage.exact ? `certified: ${v.sure.count} of ${countCells(v.columns)} pixels proven` : "sketch", stage.exact);
      redraw();
    },
    { idleMs: 150, onProgress: (p) => st.set(`certifying ${Math.round((100 * p.done) / p.of)}%`) },
  );
  const setExpr = () => {
    try {
      cond = G.parseCondition(input.value);
      G.implicit(cond, {}, G.viewport({ x: [0, 1], y: [0, 1], width: 1, height: 1 })); // shape check
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    params = sliders(box, paramsOfCondition(input.value), { values: { a: 1 }, oninput: () => update() });
    update();
  };
  input.addEventListener("change", setExpr);
  setExpr();
}

function countCells(columns) {
  let n = 0;
  for (const s of columns) for (let k = 0; k < s.length; k += 2) n += s[k + 1] - s[k] + 1;
  return n;
}

function fade(color, t) {
  // Mix toward the surface colour.
  const bg = css("--surface") || "#ffffff";
  const parse = (c) => {
    const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const a = parse(color);
  const b = parse(bg);
  if (!a || !b) return color;
  return `rgb(${a.map((v, i) => Math.round(b[i] + (v - b[i]) * t)).join(",")})`;
}

// ---------------------------------------------------------------- regions

const REGION_EXAMPLES = [
  "x + y <= 4, x >= 0, y > 0",
  "y >= x/2 - 1 and y <= 3 - x and y > -2",
  "x <= 1 or y <= -1",
  "abs(x) + abs(y) <= 3",
  "x^2 + y^2 <= 4 and y >= x^2 - 1",
  "x^2 + y^2 < 9 and y > x^2 - 4",
  "x^2/4 + y^2 <= 1 or (x - a)^2 + y^2 < 1",
  "x*y >= 1 and x^2 + y^2 < 8",
  "y < sin(2x) + a or x^2/9 + y^2 < 1",
  "y^2 <= x^3 - 2x + a",
];

function regionsDemo(el, { expr = REGION_EXAMPLES[1], examples = REGION_EXAMPLES, x = [-5, 5], y = [-3, 4] } = {}) {
  const input = h("input", { class: "expr", value: expr, spellcheck: "false", "aria-label": "condition" });
  const st = status();
  const box = h("div", { class: "gsliders" });
  const plotHost = h("div");
  const out = h("div", { class: "gout" });
  const ex = h("div", { class: "row" }, examples.map((e) => h("button", { type: "button", class: "ghost", onclick: () => {
    input.value = e;
    setExpr();
  } }, e)));
  card(el, "Region where a condition holds", h("div", { class: "row" }, input, st), box, ex, plotHost,
    h("p", { class: "gnote" }, "Solid edges are ≤ or ≥ (included), dashed edges are < or > (left out). Filled corner dots belong to the region; open ones do not. Conditions bounded by lines, circles and other conics are solved exactly; others are certified pixel by pixel, with the undecided boundary pixels drawn solid."), out);
  const plot = new Plot(plotHost, { x, y, width: 640, height: 448, pan: true, onView: () => update() });
  plotHost.prepend(h("div", { class: "row", style: "margin-bottom:.4rem" }, plot.zoomBar()));
  let cond = null;
  let params = {};
  const update = G.live(
    () => G.region(cond, params, plot.vp),
    (stage) => {
      const v = stage.value;
      const color = stage.exact ? css("--c3") : css("--c1");
      plot.draw([{ item: v, color, background: css("--surface"), cornerLabels: false }]);
      if (!stage.exact) return st.set("sketch");
      if (v.kind === "polygons") {
        st.set("exact polygons", true);
        out.replaceChildren(
          h("div", { class: "k" }, "corners (exact)"),
          v.corners.length ? h("ul", {}, v.corners.map((c) => h("li", {}, T(c.point.toTeX()), c.included ? " included" : " not included", h("span", { class: "muted" }, `  (${c.between.join(" meets ")})`)))) : h("p", { class: "gnote" }, "none in view"),
          h("div", { class: "k" }, "area in view"),
          h("div", {}, T(v.pieces.length === 1 ? v.pieces[0].area.toTeX() : v.pieces.map((p) => p.area.toTeX()).join(" + ") + "\\ \\text{(pieces may overlap)}")),
        );
      } else if (v.kind === "conics") {
        st.set("exact arcs", true);
        const marked = [...v.corners.map((c) => ({ ...c, what: c.between.join(" meets ") })), ...v.points.map((c) => ({ ...c, what: c.kind }))];
        const coords = (c) => (c.tex ? T(c.tex) : `(${c.x.toPrecision(6)}…, ${c.y.toPrecision(6)}…)`);
        out.replaceChildren(
          h("div", { class: "k" }, "curves"),
          h("ul", {}, v.curves.map((c) => h("li", {}, `${c.type}: ${c.text}`))),
          h("div", { class: "k" }, "corners and single points (exact)"),
          marked.length ? h("ul", {}, marked.map((c) => h("li", {}, coords(c), c.included ? " included" : " not included", h("span", { class: "muted" }, `  (${c.what})`)))) : h("p", { class: "gnote" }, "none in view"),
          h("div", { class: "k" }, "area in view"),
          h("div", {}, `≈ ${v.area.toPrecision(8)}`),
        );
      } else {
        st.set(`certified pixels (${v.boxes} boxes)`, true);
        out.replaceChildren(h("p", { class: "gnote" }, `${countRects(v.inside)} pixels proven inside, ${countCells(v.boundary)} boundary pixels undecided.`));
      }
    },
    { idleMs: 150, onProgress: (p) => st.set(`certifying ${Math.round((100 * p.done) / p.of)}%`) },
  );
  const setExpr = () => {
    try {
      cond = G.parseCondition(input.value);
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    out.replaceChildren();
    params = sliders(box, paramsOfCondition(input.value), { values: { a: 1 }, oninput: () => update() });
    update();
  };
  input.addEventListener("change", setExpr);
  setExpr();
}

function countRects(r) {
  let n = 0;
  for (let k = 0; k < r.length; k += 4) n += r[k + 2] * r[k + 3];
  return n;
}

// ---------------------------------------------------------------- calculus pictures

const certifiedText = (v, digits = 10) => {
  if (v === Infinity) return "diverges to +∞";
  if (v === -Infinity) return "diverges to −∞";
  if (typeof v === "number") return `≈ ${Number(v.toPrecision(digits))}`;
  if (v.low) return v.low.equals(v.high) ? v.low.toString() : `${Number(((v.low.toNumber() + v.high.toNumber()) / 2).toPrecision(digits))}… (certified)`;
  return `${v}`;
};
const isExact = (v) => typeof v === "object" && v !== null && !v.low;

function numberSlider(label, { min, max, value, oninput }) {
  const out = h("output", {}, String(value));
  const input = h("input", { type: "range", min, max, step: 1, value, "aria-label": label });
  input.addEventListener("input", () => {
    out.textContent = input.value;
    oninput(Number(input.value));
  });
  return [h("span", {}, label), input, out];
}

function calculusDemo(el) {
  const input = h("input", { class: "expr", value: "x^3/4 - x + 1", spellcheck: "false", "aria-label": "f(x)" });
  const st = status();
  const box = h("div", { class: "gsliders" });
  const box2 = h("div", { class: "gsliders" });
  const plotHost = h("div");
  const out = h("div", { class: "gout" });
  const rule = h("select", { "aria-label": "rule" }, ["midpoint", "left", "right", "trapezoid", "lower", "upper"].map((r) => h("option", {}, r)));
  const show = { tangent: true, area: true, riemann: true, taylor: false };
  const toggles = Object.keys(show).map((k) => {
    const c = h("input", { type: "checkbox" });
    c.checked = show[k];
    c.addEventListener("change", () => {
      show[k] = c.checked;
      update();
    });
    return h("label", { class: "gnote" }, c, ` ${k === "riemann" ? "Riemann sum" : k === "taylor" ? "Taylor polynomial" : k}`);
  });
  const examples = ["x^3/4 - x + 1", "sin(x) + 1", "exp(-x^2/2)", "1/(1 + x^2)", "sqrt(x + 3)"];
  const ex = h("div", { class: "row" }, examples.map((e) => h("button", { type: "button", class: "ghost", onclick: () => {
    input.value = e;
    setExpr();
  } }, e)));
  card(el, "Tangent, area, Riemann sum and Taylor polynomial", h("div", { class: "row" }, h("label", {}, "y ="), input, st), ex, box, box2, h("div", { class: "row" }, ...toggles, h("label", { class: "gnote" }, "rule ", rule)), plotHost, out);
  const plot = new Plot(plotHost, { x: [-4, 4], y: [-2, 4], pan: true, onView: () => update() });
  let ast = null;
  let n = 6;
  let degree = 3;
  let run = 0;
  const p = sliders(box, ["x0", "a", "b"], { values: { x0: 1, a: -1, b: 2 }, range: 4, oninput: () => update() });
  box2.append(...numberSlider("rectangles", { min: 1, max: 40, value: n, oninput: (v) => { n = v; update(); } }), ...numberSlider("degree", { min: 0, max: 8, value: degree, oninput: (v) => { degree = v; update(); } }));
  rule.addEventListener("change", () => update());
  const update = () => {
    if (!ast) return;
    const id = ++run;
    const [c1, c2, c3, c4, c5] = colors();
    const layers = [];
    const lines = [];
    const row = (k, ...v) => lines.push(h("div", { class: "k" }, k), h("div", {}, ...v));
    const attempt = (name, fn) => {
      try {
        fn();
      } catch (e) {
        row(name, h("span", { class: "muted" }, e.message));
      }
    };
    const a = new G.Rational(p.a);
    const b = new G.Rational(p.b);
    const ordered = a.lessThan(b);
    const integral = h("span", {}, "…");
    if (show.area && ordered) {
      attempt("area", () => {
        const job = G.areaUnder(ast, [a, b], {}, plot.vp);
        layers.push({ item: job.quick.value, color: c2 });
        integral.textContent = `≈ ${Number(job.quick.value.integral.toPrecision(8))}`;
        row(`integral from ${a} to ${b}`, integral);
        st.set("sketch");
        job.settle().then((v) => {
          if (id !== run) return;
          integral.textContent = `${certifiedText(v.integral, 12)}${isExact(v.integral) ? " (exact)" : ""}`;
          st.set("certified", true);
        }).catch((e) => {
          if (id === run) integral.textContent = e.message;
        });
      });
    }
    if (show.riemann && ordered) {
      attempt("Riemann sum", () => {
        const r = G.riemannSum(ast, [a, b], n, {}, { rule: rule.value });
        layers.push({ item: r, color: c4, fillAlpha: 0.18 });
        row(`${rule.value} sum, ${n} pieces`, r.exact ? `${r.sum} = ${Number(r.sum.toNumber().toPrecision(8))}` : `≈ ${Number(r.sum.toPrecision(8))}`);
      });
    }
    layers.push({ item: G.graph(ast, {}, plot.vp).quick.value, color: c1, width: 2 });
    if (show.taylor) {
      attempt("Taylor polynomial", () => {
        const tp = G.taylorPolynomial(ast, p.x0, degree);
        layers.push({ item: G.graph(tp.expression, {}, plot.vp).quick.value, color: c5, dash: [5, 4] });
        row(`Taylor polynomial at ${p.x0}, degree ${degree}`, h("code", {}, tp.exact ? tp.expression : tp.coefficients.map((c, k) => `${Number((c.low ? (c.low.toNumber() + c.high.toNumber()) / 2 : c.toNumber()).toPrecision(6))}${k ? `·(x − ${p.x0})${k > 1 ? `^${k}` : ""}` : ""}`).join(" + ")));
      });
    }
    if (show.tangent) {
      attempt("tangent", () => {
        const t = G.tangent(ast, p.x0);
        layers.push({ item: t.line, color: c3 }, { item: t.point, color: c3 });
        row(`tangent at ${p.x0}`, t.exact ? t.equation : `slope ${certifiedText(t.slope)}`, t.exact ? h("span", { class: "muted" }, "  (exact)") : "");
      });
    }
    if (!ordered) row("interval", h("span", { class: "muted" }, "a must be less than b"));
    plot.draw(layers);
    out.replaceChildren(...lines);
    if (!(show.area && ordered)) st.set("sketch");
  };
  const setExpr = () => {
    try {
      ast = G.parse(input.value);
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    update();
  };
  input.addEventListener("change", setExpr);
  setExpr();
}

function gradientDemo(el) {
  const input = h("input", { class: "expr", value: "x^2/4 + y^2 - x*y/2", spellcheck: "false", "aria-label": "F(x, y)" });
  const plotHost = h("div");
  const out = h("div", { class: "gout" });
  const normalize = h("input", { type: "checkbox" });
  const examples = ["x^2/4 + y^2 - x*y/2", "sin(x)*cos(y)", "x*y", "x^2 - y^2", "exp(-(x^2 + y^2)/4)"];
  const ex = h("div", { class: "row" }, examples.map((e) => h("button", { type: "button", class: "ghost", onclick: () => {
    input.value = e;
    setExpr();
  } }, e)));
  card(el, "Gradient field and level curves", h("div", { class: "row" }, h("label", {}, "F(x, y) ="), input), ex, h("div", { class: "row" }, h("label", { class: "gnote" }, normalize, " arrows of equal length")), plotHost,
    h("p", { class: "gnote" }, "Click or drag in the picture to move the point. The arrow is the gradient there and the dashed line touches the level curve through it."), out);
  const plot = new Plot(plotHost, { x: [-4, 4], y: [-3, 3] });
  let ast = null;
  let at = ["1", "1"];
  const pick = (e) => {
    const r = plot.canvas.getBoundingClientRect();
    const x = plot.vp.f.xmin + ((e.clientX - r.left) / r.width) * (plot.vp.f.xmax - plot.vp.f.xmin);
    const y = plot.vp.f.ymax - ((e.clientY - r.top) / r.height) * (plot.vp.f.ymax - plot.vp.f.ymin);
    at = [new G.Rational(BigInt(Math.round(x * 8)), 8n).toString(), new G.Rational(BigInt(Math.round(y * 8)), 8n).toString()];
    update();
  };
  let down = false;
  plot.canvas.style.cursor = "crosshair";
  plot.canvas.addEventListener("pointerdown", (e) => { down = true; plot.canvas.setPointerCapture(e.pointerId); pick(e); });
  plot.canvas.addEventListener("pointermove", (e) => down && pick(e));
  plot.canvas.addEventListener("pointerup", () => { down = false; });
  normalize.addEventListener("change", () => update());
  const update = () => {
    if (!ast) return;
    const [c1, c2, c3] = colors();
    const layers = [{ item: G.gradientField(ast, {}, plot.vp, { normalize: normalize.checked, spacing: 36 }), color: fade(c1, 0.55) }];
    const lines = [];
    try {
      const g = G.gradientAt(ast, at, {}, { scale: 0.5 });
      if (g.value.numerator !== undefined) layers.push({ item: G.contours(ast, [g.value], {}, plot.vp)[0].curve.quick.value, color: c3 });
      if (g.level) layers.push({ item: g.level, color: c3, dash: [5, 4], width: 1 });
      layers.push({ item: g.arrow, color: c2, width: 2 }, { item: g.point, color: c2 });
      lines.push(h("div", { class: "k" }, `at (${at[0]}, ${at[1]})`),
        h("div", {}, `F = ${certifiedText(g.value)}`),
        h("div", {}, `gradient = (${certifiedText(g.gradient[0])}, ${certifiedText(g.gradient[1])})${g.exact ? ", exact" : ""}`));
    } catch (e) {
      lines.push(h("p", { class: "gnote" }, e.message));
    }
    plot.draw(layers);
    out.replaceChildren(...lines);
  };
  const setExpr = () => {
    try {
      ast = G.parse(input.value);
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    update();
  };
  input.addEventListener("change", setExpr);
  setExpr();
}

// ---------------------------------------------------------------- three dimensions

/** A canvas showing projected 3D items; dragging turns the camera. `scene(settled)` returns { items, options }. */
function orbitCanvas(host, scene, { width = 640, height = 448, camera = { azimuth: 35, elevation: 25 }, onSettle } = {}) {
  const canvas = h("canvas", { width, height, role: "img", "aria-label": "3D plot", style: "touch-action:none;cursor:grab" });
  host.append(h("div", { class: "plotwrap" }, canvas));
  const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  const vp = G.spaceViewport(width, height);
  const state = { cam: G.camera(camera) };
  let timer = null;
  const draw = (settled) => {
    const { items, options } = scene(settled);
    G.drawScene(ctx, vp, [G.project3d(state.cam, items, { axes: { color: css("--muted") }, ...options })], { scale, background: css("--surface") || "#fff" });
  };
  state.redraw = () => {
    draw(false);
    clearTimeout(timer);
    timer = setTimeout(() => {
      draw(true);
      onSettle?.();
    }, 250);
  };
  let last = null;
  canvas.addEventListener("pointerdown", (e) => {
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    state.cam = G.orbit(state.cam, e.clientX - last[0], e.clientY - last[1]);
    last = [e.clientX, e.clientY];
    state.redraw();
  });
  const end = () => {
    last = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  return state;
}

function surfaceDemo(el) {
  const input = h("input", { class: "expr", value: "sin(x)*cos(y)", spellcheck: "false", "aria-label": "f(x, y)" });
  const st = status();
  const host = h("div");
  const box = h("div", { class: "gsliders" });
  const out = h("div", { class: "gout" });
  const shading = h("select", { "aria-label": "shading" }, ["light", "height"].map((r) => h("option", {}, r)));
  const plane = h("input", { type: "checkbox" });
  const examples = ["sin(x)*cos(y)", "x^2/4 - y^2/4", "exp(-(x^2 + y^2)/3)*2", "sin(sqrt(x^2 + y^2)*2)", "sqrt(9 - x^2 - y^2)", "x*y/(x^2 + y^2)"];
  const ex = h("div", { class: "row" }, examples.map((e) => h("button", { type: "button", class: "ghost", onclick: () => {
    input.value = e;
    setExpr();
  } }, e)));
  card(el, "A surface z = f(x, y)", h("div", { class: "row" }, h("label", {}, "z ="), input, st), ex,
    h("div", { class: "row" }, h("label", { class: "gnote" }, "shading ", shading), h("label", { class: "gnote" }, plane, " tangent plane at (x0, y0)")), box, host,
    h("p", { class: "gnote" }, "Drag to turn the surface. While it moves you see the float grid; when it rests, every vertex is replaced by a certified height."), out);
  let job = null;
  let exact = null;
  const p = sliders(box, ["x0", "y0"], { values: { x0: 1, y0: 0.5 }, range: 3, oninput: () => view.redraw() });
  const view = orbitCanvas(host, (settled) => {
    if (settled && !exact) exact = job.exact();
    const s = settled ? exact : job.quick.value;
    const items = [{ item: s, shading: shading.value, color: colors()[0] }];
    let note = "";
    if (plane.checked) {
      try {
        const t = G.tangentPlane(input.value, [p.x0, p.y0], {}, { size: 1 });
        items.push(...t.layers);
        note = `tangent plane at (${p.x0}, ${p.y0}): height ${Number(t.point[2].toPrecision(6))}, gradient (${t.gradient.map((v) => Number(v.toPrecision(6))).join(", ")})`;
      } catch (e) {
        note = e.message;
      }
    }
    st.set(settled ? `certified, error below ${exact.error === 0 ? "0" : exact.error.toExponential(1)}` : "sketch", settled);
    out.replaceChildren(note ? h("p", { class: "gnote" }, note) : "", settled && exact.undefined ? h("p", { class: "gnote" }, `${exact.undefined} grid points lie outside the domain and are left out.`) : "");
    return { items, options: {} };
  });
  const setExpr = () => {
    try {
      G.parse(input.value);
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    job = G.surface(input.value, {}, { x: [-3, 3], y: [-3, 3], grid: 36 });
    exact = null;
    view.redraw();
  };
  input.addEventListener("change", setExpr);
  shading.addEventListener("change", () => view.redraw());
  plane.addEventListener("change", () => view.redraw());
  setExpr();
}

const SPACE_CURVES = {
  helix: { xyz: ["cos(t)", "sin(t)", "t/8 - 1"], t: [0, 16] },
  "trefoil knot": { xyz: ["sin(t) + 2*sin(2t)", "cos(t) - 2*cos(2t)", "-sin(3t)"], t: [0, "6.2832"] },
  "Viviani's curve": { xyz: ["1 + cos(t)", "sin(t)", "2*sin(t/2)"], t: [0, "12.5664"] },
  "twisted cubic": { xyz: ["t", "t^2", "t^3"], t: [-1, 1] },
};

function spaceCurveDemo(el) {
  const st = status();
  const host = h("div");
  const pick = h("select", { "aria-label": "curve" }, Object.keys(SPACE_CURVES).map((k) => h("option", {}, k)));
  const formula = h("code", {});
  card(el, "Space curves", h("div", { class: "row" }, pick, formula, st), host, h("p", { class: "gnote" }, "Drag to turn. Viviani's curve is drawn on the sphere it lies on, which hides the far side of it."));
  let job = null;
  let exact = null;
  let sphere = null;
  const view = orbitCanvas(host, (settled) => {
    if (settled && !exact) exact = job.exact();
    st.set(settled ? `certified, error below ${exact.error.toExponential(1)}` : "sketch", settled);
    const items = [{ item: settled ? exact : job.quick.value, color: colors()[1], width: 2.5 }];
    if (sphere) items.unshift({ item: sphere, color: colors()[0], opacity: 0.35, wire: false });
    return { items, options: {} };
  }, { camera: { azimuth: 40, elevation: 20 } });
  const set = () => {
    const c = SPACE_CURVES[pick.value];
    formula.textContent = `(${c.xyz.join(", ")})`;
    job = G.spaceCurve(c.xyz, {}, { t: c.t, samples: 400 });
    exact = null;
    sphere = pick.value === "Viviani's curve" ? G.parametricSurface(["2*cos(u)*sin(v)", "2*sin(u)*sin(v)", "2*cos(v)"], {}, { u: [0, "6.2832"], v: [0, "3.1416"], grid: 24 }).quick.value : null;
    view.redraw();
  };
  pick.addEventListener("change", set);
  set();
}

// ---------------------------------------------------------------- animation

function download(name, type, data) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function animationDemo(el) {
  const input = h("input", { class: "expr", value: "sin(a*x) + a/2", spellcheck: "false", "aria-label": "f(x) with a" });
  const st = status();
  const plotHost = h("div");
  const play = h("button", { type: "button" }, "Pause");
  const scrub = h("input", { type: "range", min: 0, max: 90, step: 1, value: 0, "aria-label": "frame", style: "flex:1" });
  const value = h("output", {}, "");
  const bounce = h("input", { type: "checkbox" });
  bounce.checked = true;
  const examples = ["sin(a*x) + a/2", "x^3/4 - a*x", "a/(1 + x^2)", "exp(-(x - a)^2)*2", "tan(x/a)"];
  const ex = h("div", { class: "row" }, examples.map((e) => h("button", { type: "button", class: "ghost", onclick: () => {
    input.value = e;
    restart();
  } }, e)));
  card(el, "A parameter in motion", h("div", { class: "row" }, h("label", {}, "y ="), input, st), ex, h("div", { class: "row" }, play, scrub, h("span", {}, "a ="), value, h("label", { class: "gnote" }, bounce, " back and forth")), plotHost,
    h("div", { class: "row" },
      h("button", { type: "button", class: "ghost", onclick: () => download("animation.svg", "image/svg+xml", G.animationSVG(plot.vp, frames(24), { duration: 3000, axes: true, background: "#fff" })) }, "Download animated SVG"),
      h("button", { type: "button", class: "ghost", onclick: async () => download("animation.png", "image/png", await G.animationPNG(plot.vp, frames(24), { duration: 3000, axes: true })) }, "Download animated PNG")),
    h("p", { class: "gnote" }, "Each frame is the quick sketch at an exact value of a. When the animation pauses, the frame is certified."));
  const plot = new Plot(plotHost, { x: [-6, 6], y: [-4, 4] });
  let ast = null;
  let anim = null;
  const frames = (n) => G.parameterSteps("1/2", 3, n).map((a) => [{ item: G.graph(ast, { a }, plot.vp).quick.value, color: "#2563eb", width: 2 }]);
  const drawAt = (a, info) => {
    plot.draw([{ item: G.graph(ast, { a }, plot.vp).quick.value, color: colors()[0], asymptoteColor: css("--muted") }], { labels: false });
    scrub.value = info.index;
    value.textContent = a.toString();
    st.set("sketch");
  };
  const settle = async (a) => {
    const g = await G.graph(ast, { a }, plot.vp).settle();
    if (anim.playing || !anim.value.equals(a)) return;
    plot.draw([{ item: g, color: colors()[2], asymptoteColor: css("--muted") }], { labels: false });
    st.set("certified", true);
  };
  const restart = () => {
    try {
      ast = G.parse(input.value);
      input.classList.remove("bad");
    } catch {
      input.classList.add("bad");
      return;
    }
    anim?.stop();
    anim = G.animate(drawAt, { from: "1/2", to: 3, steps: 90, duration: 4000, loop: true, bounce: bounce.checked, onSettle: settle });
    anim.play();
    play.textContent = "Pause";
  };
  play.addEventListener("click", () => {
    anim.toggle();
    play.textContent = anim.playing ? "Pause" : "Play";
  });
  scrub.addEventListener("input", () => {
    anim.pause();
    play.textContent = "Play";
    anim.seek(Number(scrub.value));
  });
  bounce.addEventListener("change", restart);
  input.addEventListener("change", restart);
  restart();
}

// ---------------------------------------------------------------- geometry

function geometryDemo(el) {
  const out = h("div", { class: "gout" });
  const plotHost = h("div");
  card(el, "Drag the points (they snap to halves)", plotHost,
    h("p", { class: "gnote" }, "Triangle ABC, its circumcircle (center O), and the line DE. Every number below is exact: rational where it can be, otherwise a + b√d."), out);
  const plot = new Plot(plotHost, { x: [-6, 6], y: [-4, 4], width: 640, height: 428 });
  const pts = { A: [-3, -1], B: [3, -1], C: [1, 3], D: [-5, 1], E: [5, -1] };
  const draw = () => {
    const P = Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, G.point(v)]));
    const layers = [];
    const tri = G.polygon([P.A, P.B, P.C]);
    layers.push({ item: tri, color: css("--c1"), fillAlpha: 0.1 });
    const cc = G.circumcircle(P.A, P.B, P.C);
    const DE = G.line(P.D, P.E);
    layers.push({ item: DE, color: css("--c5") });
    let hits = [];
    if (cc) {
      layers.push({ item: cc, color: css("--c2") });
      layers.push({ item: cc.center, color: css("--c2"), radius: 3, label: "O" });
      try {
        hits = G.intersect(DE, cc);
      } catch {
        hits = [];
      }
      for (const q of hits) layers.push({ item: q, color: css("--fg"), radius: 3.5 });
    }
    for (const k of ["A", "B", "C", "D", "E"]) layers.push({ item: P[k], color: k < "D" ? css("--c1") : css("--c5"), radius: 6, label: k });
    plot.draw(layers);
    const row = (k, latex) => h("li", {}, h("span", { class: "muted" }, `${k}: `), T(latex));
    out.replaceChildren(
      h("ul", {},
        row("area of ABC", G.area(tri).toTeX()),
        cc ? row("circumcircle", cc.toTeX()) : row("circumcircle", "\\text{none: A, B, C are collinear}"),
        row("line DE", DE.toTeX()),
        ...hits.map((q, i) => row(`DE meets the circle (${i + 1})`, q.toTeX())),
        cc && !hits.length ? row("DE meets the circle", "\\text{nowhere}") : null,
      ),
    );
  };
  // Dragging: nearest point within 14 px, snapped to multiples of 1/2.
  let drag = null;
  const c = plot.canvas;
  const toWorld = (e) => {
    const r = c.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * plot.width;
    const py = ((e.clientY - r.top) / r.height) * plot.height;
    const vp = plot.vp;
    return [vp.f.xmin + px * vp.f.dx, vp.f.ymax - py * vp.f.dy, px, py];
  };
  c.style.touchAction = "none";
  c.addEventListener("pointerdown", (e) => {
    const [, , px, py] = toWorld(e);
    let best = null;
    for (const [k, v] of Object.entries(pts)) {
      const P = G.point(v).toNumbers();
      const d = Math.hypot((P[0] - plot.vp.f.xmin) / plot.vp.f.dx - px, (plot.vp.f.ymax - P[1]) / plot.vp.f.dy - py);
      if (d < 18 && (!best || d < best.d)) best = { k, d };
    }
    if (best) {
      drag = best.k;
      c.setPointerCapture(e.pointerId);
    }
  });
  c.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = toWorld(e);
    const snap = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 2))) / 2;
    const nx = snap(x, -12, 12);
    const ny = snap(y, -8, 8);
    const cur = pts[drag];
    if (String(cur[0]) === String(nx) && String(cur[1]) === String(ny)) return;
    pts[drag] = [String(nx), String(ny)];
    draw();
  });
  const end = () => (drag = null);
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  draw();
}

// ---------------------------------------------------------------- drawing: canvas and SVG side by side

function drawingDemo(el) {
  const vp = G.viewport({ x: [-1, 5], y: [-1, 4], width: 360, height: 300 });
  const build = () => {
    const reg = G.region("y <= 3 - x/2, y >= x - 1, x >= 0, y >= 0", {}, vp).exact();
    const c = G.circle([2, 1], 1);
    const hits = G.intersect(G.line("y = x/2"), c);
    return [
      { item: reg, color: css("--c3") },
      { item: c, color: css("--c2") },
      ...hits.map((p, i) => ({ item: p, color: css("--c2"), radius: 3.5, label: true, anchor: i ? "s" : "n" })),
      G.label([3, "3.4"], "y \\le 3 - \\tfrac{x}{2}", { color: css("--muted") }),
    ];
  };
  const left = h("div");
  const right = h("div", { class: "plotwrap", style: "padding:0" });
  const dl = h("button", { type: "button", class: "ghost" }, "Download SVG");
  card(el, "One scene, two back ends", h("div", { class: "demo-grid", style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:1rem" },
    h("figure", { style: "margin:0" }, left, h("figcaption", {}, "Canvas, with a KaTeX label layer on top")),
    h("figure", { style: "margin:0" }, right, h("figcaption", {}, "SVG from sceneSVG(), labels as KaTeX HTML"))), h("div", { class: "row" }, dl));
  const plot = new Plot(left, { x: [-1, 5], y: [-1, 4], width: 360, height: 300 });
  const layers = build();
  plot.draw(layers);
  katex().then((k) => {
    const svg = G.sceneSVG(vp, layers, { axes: { grid: css("--grid"), axis: css("--axis"), text: css("--muted") }, background: css("--surface"), tex: k ? (s) => k.renderToString(s, { throwOnError: false }) : undefined });
    right.innerHTML = svg;
    dl.onclick = () => {
      const plain = G.sceneSVG(vp, layers, { axes: true, background: "#fff" });
      const a = h("a", { href: URL.createObjectURL(new Blob([plain], { type: "image/svg+xml" })), download: "scene.svg" });
      a.click();
    };
  });
}

// ---------------------------------------------------------------- explore

function explore(el) {
  const modes = { graph: "y = f(x)", curve: "curve F(x, y) = 0", region: "region" };
  const defaults = { graph: "a*sin(b*x) + c*x", curve: "x^3 + y^3 = 3a x y", region: "x^2 + y^2 < 9 and y > x^2 - a" };
  let mode = "graph";
  const seg = h("span", { class: "seg" });
  const host = h("div");
  card(el, "Explore", h("div", { class: "row" }, seg), host);
  const mount = () => {
    host.replaceChildren();
    const d = h("div");
    host.append(d);
    if (mode === "graph") graphDemo(d, { title: "Graph", expr: defaults.graph });
    else if (mode === "curve") implicitDemo(d, { expr: defaults.curve, x: [-4, 4], y: ["-5/2", "5/2"] });
    else regionsDemo(d, { expr: defaults.region });
    d.classList.remove("gdemo");
    d.style.cssText = "display:flex;flex-direction:column;gap:.7rem";
    d.querySelector(".demo-title")?.remove();
  };
  for (const [m, label] of Object.entries(modes)) {
    seg.append(h("button", { type: "button", class: m === mode ? "on" : "", onclick: (e) => {
      mode = m;
      for (const b of seg.children) b.classList.toggle("on", b === e.target);
      mount();
    } }, label));
  }
  mount();
}

// ---------------------------------------------------------------- mount

const DEMOS = {
  hero: (el) => graphDemo(el, { title: "Move a slider", markers: true }),
  fastCertified,
  graphs: (el) => graphDemo(el, { title: "Graph with certified features", expr: "x^3/8 - 2x + a", values: { a: 0 }, x: [-8, 8], y: [-6, 6] }),
  graphsHole: (el) => graphDemo(el, { title: "Holes and poles", expr: "(x^2 - 1)/(x - 1) + a/(x + 2)", values: { a: 1 }, x: [-6, 6], y: [-6, 8] }),
  implicit: (el) => implicitDemo(el),
  regions: (el) => regionsDemo(el),
  calculus: calculusDemo,
  gradient: gradientDemo,
  surface: surfaceDemo,
  "space-curve": spaceCurveDemo,
  animation: animationDemo,
  geometry: geometryDemo,
  drawing: drawingDemo,
  explore,
};

for (const el of document.querySelectorAll("[data-demo]")) {
  try {
    DEMOS[el.dataset.demo](el);
  } catch (e) {
    el.replaceChildren(h("p", { class: "err" }, `Demo failed: ${e.message}`));
    console.error(e);
  }
}
document.getElementById("toc-select")?.addEventListener("change", (e) => {
  location.href = e.target.value === "intro" ? "index.html" : `${e.target.value}.html`;
});
mountRunboxes(document, { scope: G });
