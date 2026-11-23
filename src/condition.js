// Conditions on x and y: comparisons joined by and / or / not.
//
//   "x^2 + y^2 < 4"            one comparison
//   "0 <= x <= 3"              chains mean "and"
//   "y >= x and x + y <= 4"    also && , || , ! and , (comma means and)
//   "(y > 1 or y < -1) and x > 0"
//   "x^2 = y"                  an equation (a curve)
//
// parseCondition returns a tree:
//   { op: "and" | "or", args: [...] } | { op: "not", arg } |
//   { op: "cmp", rel: "<" | "<=" | "=" | "!=", F, text }
// where each comparison is normalized to F rel 0 with F = left − right
// (a > b becomes b − a < 0).

import { op, parse } from "./expr.js";

const REL = /^(<=|>=|!=|==|≤|≥|≠|<|>|=)/;
const NORMAL = { "≤": "<=", "≥": ">=", "≠": "!=", "==": "=" };

function tokenize(text) {
  // Logic-level tokens: ( ) and or not , relations, and runs of math text.
  const toks = [];
  let i = 0;
  let buf = "";
  let start = 0;
  const flush = () => {
    if (buf.trim()) toks.push({ t: "math", text: buf.trim(), pos: start });
    buf = "";
  };
  while (i < text.length) {
    const rest = text.slice(i);
    const m = REL.exec(rest);
    if (m) {
      flush();
      toks.push({ t: "rel", rel: NORMAL[m[1]] ?? m[1], pos: i });
      i += m[1].length;
      start = i;
      continue;
    }
    const w = /^(and|or|not)\b/i.exec(rest);
    const prev = text[i - 1];
    if (w && (i === 0 || !/[A-Za-z0-9_]/.test(prev))) {
      flush();
      toks.push({ t: w[1].toLowerCase(), pos: i });
      i += w[1].length;
      start = i;
      continue;
    }
    if (rest.startsWith("&&") || rest.startsWith("||")) {
      flush();
      toks.push({ t: rest[0] === "&" ? "and" : "or", pos: i });
      i += 2;
      start = i;
      continue;
    }
    const c = text[i];
    if (c === "!" || c === "¬") {
      flush();
      toks.push({ t: "not", pos: i });
      i++;
      start = i;
      continue;
    }
    if (c === "," || c === "∧" || c === "∨") {
      flush();
      toks.push({ t: c === "∨" ? "or" : "and", pos: i });
      i++;
      start = i;
      continue;
    }
    if (c === "(" || c === ")") {
      flush();
      toks.push({ t: c, pos: i });
      i++;
      start = i;
      continue;
    }
    if (!buf) start = i;
    buf += c;
    i++;
  }
  flush();
  return toks;
}

/** Parse a condition (see the file comment). */
export function parseCondition(text) {
  const toks = tokenize(text);
  let i = 0;
  const peek = () => toks[i];
  const fail = (msg) => {
    throw new SyntaxError(`${msg} in "${text}"`);
  };

  function orExpr() {
    const args = [andExpr()];
    while (peek()?.t === "or") {
      i++;
      args.push(andExpr());
    }
    return args.length === 1 ? args[0] : { op: "or", args };
  }
  function andExpr() {
    const args = [notExpr()];
    while (peek()?.t === "and") {
      i++;
      args.push(notExpr());
    }
    return args.length === 1 ? args[0] : { op: "and", args };
  }
  function notExpr() {
    if (peek()?.t === "not") {
      i++;
      return { op: "not", arg: notExpr() };
    }
    return comparison();
  }
  // A comparison chain: side rel side (rel side)*. A side is math text,
  // possibly with parentheses; a parenthesized group that holds logic or a
  // relation at its top level is a sub-condition instead.
  function side() {
    let s = "";
    let depth = 0;
    const startI = i;
    for (;;) {
      const k = peek();
      if (!k) break;
      if (k.t === "(") {
        // Is this a logic group? Look for a rel/and/or/not at depth 1 before it closes.
        if (depth === 0 && s.trim() === "" && isLogicGroup(i)) {
          if (i !== startI) break;
          i++;
          const inner = orExpr();
          if (peek()?.t !== ")") fail("missing )");
          i++;
          return { group: inner };
        }
        depth++;
        s += "(";
        i++;
        continue;
      }
      if (k.t === ")") {
        if (depth === 0) break;
        depth--;
        s += ")";
        i++;
        continue;
      }
      if (k.t === "math") {
        s += k.text;
        i++;
        continue;
      }
      if (depth > 0) fail(`unexpected ${k.t} inside parentheses`);
      break;
    }
    if (!s.trim()) fail(`expected an expression at ${peek()?.pos ?? text.length}`);
    return { text: s.trim() };
  }
  function isLogicGroup(j) {
    let depth = 0;
    for (let k = j; k < toks.length; k++) {
      const t = toks[k].t;
      if (t === "(") depth++;
      else if (t === ")") {
        depth--;
        if (depth === 0) return false;
      } else if (depth === 1 && (t === "rel" || t === "and" || t === "or" || t === "not")) return true;
    }
    return false;
  }
  function comparison() {
    const first = side();
    if (first.group) return first.group;
    const sides = [first];
    const rels = [];
    while (peek()?.t === "rel") {
      rels.push(peek().rel);
      i++;
      sides.push(side());
    }
    if (!rels.length) {
      // A bare expression means "= 0" (an implicit curve).
      return atom(first.text, "=", "0");
    }
    const parts = rels.map((rel, k) => atom(sides[k].text, rel, sides[k + 1].text));
    return parts.length === 1 ? parts[0] : { op: "and", args: parts };
  }

  const tree = orExpr();
  if (i < toks.length) fail(`unexpected ${toks[i].t} at ${toks[i].pos}`);
  return tree;
}

function atom(left, rel, right) {
  const L = parse(left);
  const R = parse(right);
  const isZero = (a) => a.type === "num" && a.value.numerator === 0n;
  const diff = (a, b) => (isZero(b) ? a : isZero(a) ? op("neg", b) : op("-", a, b));
  const text = `${left} ${rel} ${right}`;
  switch (rel) {
    case "<": case "<=": case "=": case "!=":
      return { op: "cmp", rel, F: diff(L, R), text };
    case ">":
      return { op: "cmp", rel: "<", F: diff(R, L), text };
    case ">=":
      return { op: "cmp", rel: "<=", F: diff(R, L), text };
  }
  throw new SyntaxError(`unknown relation ${rel}`);
}

/** All comparison atoms of a condition tree, in order. */
export function atoms(tree, out = []) {
  if (tree.op === "cmp") out.push(tree);
  else if (tree.op === "not") atoms(tree.arg, out);
  else for (const a of tree.args) atoms(a, out);
  return out;
}

const FLIP = { "<": "<=", "<=": "<", "=": "!=", "!=": "=" };

/** Push "not" down to the comparisons: not(F < 0) is −F <= 0, and so on. */
export function negationFree(tree, negate = false) {
  if (tree.op === "not") return negationFree(tree.arg, !negate);
  if (tree.op === "cmp") {
    if (!negate) return tree;
    if (tree.rel === "=" || tree.rel === "!=") return { ...tree, rel: FLIP[tree.rel] };
    return { ...tree, rel: FLIP[tree.rel], F: op("neg", tree.F), text: `not (${tree.text})` };
  }
  const flip = negate ? (tree.op === "and" ? "or" : "and") : tree.op;
  return { op: flip, args: tree.args.map((a) => negationFree(a, negate)) };
}

/** Disjunctive normal form: a list of conjunctions (lists of comparisons). Throws past `limit` terms. */
export function dnf(tree, limit = 64) {
  const t = negationFree(tree);
  const go = (n) => {
    if (n.op === "cmp") return [[n]];
    const parts = n.args.map(go);
    if (n.op === "or") return parts.flat();
    let acc = [[]];
    for (const p of parts) {
      const next = [];
      for (const a of acc) for (const b of p) next.push([...a, ...b]);
      if (next.length > limit) throw new RangeError("condition too large to split into pieces");
      acc = next;
    }
    return acc;
  };
  return go(t);
}

/** Float evaluation of a condition tree, given compiled float atoms. */
export function evalFloat(tree, values) {
  switch (tree.op) {
    case "cmp": {
      const v = values.get(tree);
      if (!Number.isFinite(v)) return false;
      if (tree.rel === "<") return v < 0;
      if (tree.rel === "<=") return v <= 0;
      if (tree.rel === "=") return v === 0;
      return v !== 0;
    }
    case "not": return !evalFloat(tree.arg, values);
    case "and": return tree.args.every((a) => evalFloat(a, values));
    case "or": return tree.args.some((a) => evalFloat(a, values));
  }
  return false;
}
