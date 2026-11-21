import { graph, features, live, parse, freeVariables, viewport, drawCanvas, drawMarkers } from "../index.js";

const W = 800, H = 480;
const vp = viewport({ x: [-8, 8], y: [-6, 6], width: W, height: H });
const canvas = document.getElementById("plot");
const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
canvas.width = W * scale;
canvas.height = H * scale;
const g2 = canvas.getContext("2d");
const status = document.getElementById("status");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Slider values are exact: integer steps of 1/8.
const DEN = 8;
const defaults = { a: 2 * DEN, b: 1 * DEN, c: DEN / 4 };
const sliderState = {};

function axes() {
  g2.fillStyle = css("--bg");
  g2.fillRect(0, 0, canvas.width, canvas.height);
  g2.strokeStyle = css("--line");
  g2.lineWidth = 1;
  for (let x = -8; x <= 8; x++) line((x + 8) * (W / 16), 0, (x + 8) * (W / 16), H);
  for (let y = -6; y <= 6; y++) line(0, (6 - y) * (H / 12), W, (6 - y) * (H / 12));
  g2.strokeStyle = css("--axis");
  line(W / 2, 0, W / 2, H);
  line(0, H / 2, W, H / 2);
}
function line(x0, y0, x1, y1) {
  g2.beginPath();
  g2.moveTo(x0 * scale + 0.5, y0 * scale + 0.5);
  g2.lineTo(x1 * scale + 0.5, y1 * scale + 0.5);
  g2.stroke();
}

let ast = null;
let lastFloat = null;
let shown = null; // { value, exact }
let marks = null; // { exact, items: [{ x, y, kind }] }

function redraw(partial) {
  axes();
  if (partial) {
    drawCanvas(g2, lastFloat, { color: css("--curve"), scale, lineWidth: 1 });
    drawCanvas(g2, partial, { color: css("--cert"), scale });
  } else if (shown) {
    drawCanvas(g2, shown.value, { color: shown.exact ? css("--cert") : css("--curve"), scale, asymptoteColor: css("--muted") });
  }
  if (marks) drawMarkers(g2, vp, marks, { color: css(shown && shown.exact ? "--cert" : "--curve"), background: css("--bg"), scale });
}

const update = live(
  (params) => graph(ast, params, vp),
  (stage) => {
    if (stage.stage === "float") lastFloat = stage.value;
    shown = { value: stage.value, exact: stage.exact };
    redraw();
    status.textContent = stage.exact ? (stage.value.tight ? "certified" : "certified (coarse)") : "sketch";
    status.className = stage.exact ? "exact" : "";
  },
  {
    idleMs: 120,
    onProgress: (p) => {
      status.textContent = `certifying ${Math.round((100 * p.done) / p.of)}%`;
      if (p.partial) redraw(p.partial);
    },
    onError: (e) => (document.getElementById("err").textContent = e.message),
  },
);

const featureText = document.getElementById("zeros");
const mid = (r) => (r.exact ? r.at.toNumber() : (r.lo.toNumber() + r.hi.toNumber()) / 2);
const where = (r) => (r.exact ? `${r.at}` : `[${r.lo}, ${r.hi}]`);
const yval = (r) => (r.value ? `${r.value}` : r.valueLo ? `≈ ${((r.valueLo.toNumber() + r.valueHi.toNumber()) / 2).toFixed(6)}` : "?");
const updateFeatures = live(
  (params) => features(ast, params, [-8, 8], { tolerance: "1/10000" }),
  (stage) => {
    const v = stage.value;
    if (stage.stage === "float") {
      marks = v;
      featureText.innerHTML = "<b>estimates</b> · zeros ≈ " + (v.zeros.map((x) => x.toFixed(4)).join(", ") || "none") +
        " · extrema ≈ " + (v.extrema.filter((e) => e.kind !== "flat").map((e) => `${e.kind} ${e.x.toFixed(4)}`).join(", ") || "none");
    } else {
      marks = v;
      const line = (label, list, fmt) => `<div><b>${label}</b> ${list.length ? list.map(fmt).join(" · ") : "none"}</div>`;
      featureText.innerHTML =
        line("zeros", v.zeros, (r) => (r.kind === "exact" ? `${r.at} (exact)` : r.kind === "sign-change" ? `in ${where(r)}` : `maybe in ${where(r)}`)) +
        line("poles", v.poles, (p) => `${p.kind === "log" ? "log " : ""}${where(p)}${p.certain ? "" : " (unsettled)"}`) +
        line("holes", v.holes, (h) => `${h.at}, y ≈ ${Number(h.valueApprox.toPrecision(10))}`) +
        line("domain ends", v.endpoints, (e) => `${where(e)} (${e.included ? "included" : "excluded"})`) +
        line("max / min", v.extrema, (e) => `${e.kind} at ${where(e)}, y = ${yval(e)}`) +
        line("inflections", v.inflections, (e) => `${e.kind === "possible" ? "maybe " : ""}${where(e)}`);
    }
    redraw();
  },
  { idleMs: 300 },
);

function params() {
  const p = {};
  for (const [k, n] of Object.entries(sliderState)) p[k] = `${n}/${DEN}`;
  return p;
}

function rebuild() {
  const err = document.getElementById("err");
  try {
    ast = parse(document.getElementById("expr").value);
    err.textContent = "";
  } catch (e) {
    err.textContent = e.message;
    return;
  }
  const names = [...freeVariables(ast)].filter((n) => n !== "x").sort();
  const box = document.getElementById("sliders");
  box.textContent = "";
  for (const k of Object.keys(sliderState)) if (!names.includes(k)) delete sliderState[k];
  for (const name of names) {
    if (!(name in sliderState)) sliderState[name] = defaults[name] ?? DEN;
    const row = document.createElement("label");
    row.className = "slider";
    row.innerHTML = `<span>${name}</span><input type="range" min="${-5 * DEN}" max="${5 * DEN}" step="1"><output></output>`;
    const input = row.querySelector("input");
    const out = row.querySelector("output");
    input.value = sliderState[name];
    const show = () => {
      const n = sliderState[name];
      const g = gcd(Math.abs(n), DEN);
      out.textContent = n % DEN === 0 ? String(n / DEN) : `${n / g}/${DEN / g}`;
    };
    show();
    input.addEventListener("input", () => {
      sliderState[name] = Number(input.value);
      show();
      go();
    });
    box.appendChild(row);
  }
  go();
}
function gcd(a, b) { return b ? gcd(b, a % b) : a || 1; }
function go() {
  update(params());
  updateFeatures(params());
}

document.getElementById("expr").addEventListener("input", rebuild);
rebuild();
window.__demo = { update, status };
