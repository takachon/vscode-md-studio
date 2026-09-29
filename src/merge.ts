// Keeps WYSIWYG edits from rewriting lines the user did not touch.
//
// Vditor (Lute) re-serialises the whole document, so its Markdown differs from the file even when
// nothing was edited (list markers, table padding, blank lines ...). We therefore diff the editor's
// output against its own output for the original text (`norm`) and replay only the changed regions
// onto the original text (`orig`):
//
//   orig  --(Lute)-->  norm  --(user edit)-->  next
//
// Lines equal in orig and norm are anchors. Between anchors lies a "gap" whose formatting Lute
// changed. A region (anchor or gap) no edit touches is copied from orig verbatim; a touched region
// is taken from next. If next === norm the result is exactly orig.
//
// A touched gap (e.g. a table whose padding Lute changed, with one edited row) is split once more,
// pairing lines that differ only in whitespace, so only the edited lines come from next.

export type Pair = [number, number];

/** Monotone list of index pairs (i, j) with a[i] === b[j], close to a longest common subsequence. */
export function matchLines(a: readonly string[], b: readonly string[]): Pair[] {
  const out: Pair[] = [];
  matchRange(a, 0, a.length, b, 0, b.length, out);
  return out;
}

const MYERS_LIMIT = 4000; // max edit distance before we give up on an exact diff of a range

function matchRange(
  a: readonly string[], aLo: number, aHi: number,
  b: readonly string[], bLo: number, bHi: number,
  out: Pair[],
): void {
  // Common prefix.
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out.push([aLo++, bLo++]);
  // Common suffix (pushed after the middle).
  let aEnd = aHi, bEnd = bHi;
  while (aEnd > aLo && bEnd > bLo && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
  if (aLo < aEnd && bLo < bEnd) {
    const anchors = uniqueAnchors(a, aLo, aEnd, b, bLo, bEnd);
    if (anchors.length > 0) {
      // Patience: recurse between lines that are unique on both sides.
      let pa = aLo, pb = bLo;
      for (const [i, j] of anchors) {
        matchRange(a, pa, i, b, pb, j, out);
        out.push([i, j]);
        pa = i + 1; pb = j + 1;
      }
      matchRange(a, pa, aEnd, b, pb, bEnd, out);
    } else {
      myers(a, aLo, aEnd, b, bLo, bEnd, out);
    }
  }
  for (let k = 0; k < aHi - aEnd; k++) out.push([aEnd + k, bEnd + k]);
}

function uniqueAnchors(
  a: readonly string[], aLo: number, aHi: number,
  b: readonly string[], bLo: number, bHi: number,
): Pair[] {
  const ca = new Map<string, { n: number; i: number }>();
  for (let i = aLo; i < aHi; i++) {
    const e = ca.get(a[i]);
    if (e) e.n++; else ca.set(a[i], { n: 1, i });
  }
  const cb = new Map<string, { n: number; j: number }>();
  for (let j = bLo; j < bHi; j++) {
    const e = cb.get(b[j]);
    if (e) e.n++; else cb.set(b[j], { n: 1, j });
  }
  const pairs: Pair[] = [];
  for (const [line, ea] of ca) {
    const eb = cb.get(line);
    if (ea.n === 1 && eb && eb.n === 1) pairs.push([ea.i, eb.j]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  return longestIncreasing(pairs);
}

/** Longest subsequence of pairs (sorted by [0]) that is increasing in [1]. */
function longestIncreasing(pairs: Pair[]): Pair[] {
  const tails: number[] = []; // index into pairs
  const prev = new Array<number>(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    const v = pairs[k][1];
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const res: Pair[] = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) res.push(pairs[k]);
  return res.reverse();
}

/** Myers O(ND) diff; pushes matched pairs. Falls back to "no match" when D is too large. */
function myers(
  a: readonly string[], aLo: number, aHi: number,
  b: readonly string[], bLo: number, bHi: number,
  out: Pair[],
): void {
  const n = aHi - aLo, m = bHi - bLo;
  const max = Math.min(n + m, MYERS_LIMIT);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return; // too different: treat the whole range as replaced
  const pairs: Pair[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; pairs.push([aLo + x, bLo + y]); }
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { x--; y--; pairs.push([aLo + x, bLo + y]); }
  for (let k = pairs.length - 1; k >= 0; k--) out.push(pairs[k]);
}

interface Hunk { s: number; e: number; lines: string[]; done: boolean }

/** Hunks that turn `a` into `b`: a[s..e) is replaced by `lines`. */
function hunks(a: readonly string[], b: readonly string[]): Hunk[] {
  const res: Hunk[] = [];
  let pa = 0, pb = 0;
  for (const [i, j] of [...matchLines(a, b), [a.length, b.length] as Pair]) {
    if (i > pa || j > pb) res.push({ s: pa, e: i, lines: b.slice(pb, j), done: false });
    pa = i + 1; pb = j + 1;
  }
  return res;
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Applies the change norm -> next onto orig, keeping orig's formatting wherever the change did not reach.
 * Line endings follow orig.
 */
export function mergeEdit(orig: string, norm: string, next: string): string {
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  const O = splitLines(orig);
  const N0 = splitLines(norm);
  const N1 = splitLines(next);
  if (N0.length === N1.length && N0.every((l, k) => l === N1[k])) return orig;

  const H = hunks(N0, N1);
  const anchors = matchLines(O, N0);

  // Regions: [oStart, oEnd) in O  <->  [nStart, nEnd) in N0, alternating gap / anchor.
  const regions = toRegions(anchors, 0, O.length, 0, N0.length);

  const deleted = new Uint8Array(N0.length);
  for (const h of H) for (let j = h.s; j < h.e; j++) deleted[j] = 1;
  const startsAt = new Map<number, Hunk[]>();
  for (const h of H) {
    const l = startsAt.get(h.s);
    if (l) l.push(h); else startsAt.set(h.s, [h]);
  }
  const emitAt = (j: number, res: string[]) => {
    for (const h of startsAt.get(j) ?? []) {
      if (!h.done) { res.push(...h.lines); h.done = true; }
    }
  };

  const res: string[] = [];
  const emit = (r: Region, refine: boolean): void => {
    const dirty = H.some((h) => (h.s < r.ne && h.e > r.ns) || (h.s === h.e && h.s > r.ns && h.s < r.ne));
    if (!dirty) {
      emitAt(r.ns, res);
      for (let i = r.os; i < r.oe; i++) res.push(O[i]);
    } else if (refine && (r.oe - r.os > 1 || r.ne - r.ns > 1)) {
      const oKeys = O.slice(r.os, r.oe).map(looseKey);
      const nKeys = N0.slice(r.ns, r.ne).map(looseKey);
      const pairs = matchLines(oKeys, nKeys).map(([i, j]): Pair => [r.os + i, r.ns + j]);
      for (const sub of toRegions(pairs, r.os, r.oe, r.ns, r.ne)) emit(sub, false);
    } else {
      for (let j = r.ns; j < r.ne; j++) {
        emitAt(j, res);
        if (!deleted[j]) res.push(N0[j]);
      }
    }
  };
  for (const r of regions) emit(r, true);
  emitAt(N0.length, res);
  return res.join(eol);
}

interface Region { os: number; oe: number; ns: number; ne: number }

/** Splits [os, oe) x [ns, ne) into alternating gap / single-line anchor regions. */
function toRegions(anchors: readonly Pair[], os: number, oe: number, ns: number, ne: number): Region[] {
  const regions: Region[] = [];
  let po = os, pn = ns;
  for (const [i, j] of anchors) {
    if (i > po || j > pn) regions.push({ os: po, oe: i, ns: pn, ne: j });
    regions.push({ os: i, oe: i + 1, ns: j, ne: j + 1 });
    po = i + 1; pn = j + 1;
  }
  if (oe > po || ne > pn) regions.push({ os: po, oe, ns: pn, ne });
  return regions;
}

/** Line identity ignoring whitespace: Lute pads table cells and spaces CJK next to code. */
function looseKey(line: string): string {
  return line.replace(/\s+/g, '');
}

/** Smallest single replacement that turns `from` into `to` (offsets into `from`). */
export function minimalReplace(from: string, to: string): { start: number; end: number; text: string } | undefined {
  if (from === to) return undefined;
  let s = 0;
  const max = Math.min(from.length, to.length);
  while (s < max && from.charCodeAt(s) === to.charCodeAt(s)) s++;
  let ef = from.length, et = to.length;
  while (ef > s && et > s && from.charCodeAt(ef - 1) === to.charCodeAt(et - 1)) { ef--; et--; }
  // Do not split a CRLF pair or a surrogate pair.
  while (s > 0 && (isLow(from.charCodeAt(s)) || (from[s] === '\n' && from[s - 1] === '\r'))) s--;
  return { start: s, end: ef, text: to.slice(s, et) };
}

function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}
