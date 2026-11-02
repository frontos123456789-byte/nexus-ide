import { diffArrays } from "diff";

interface Region {
  s: number;
  e: number;
  lines: string[];
}

function regions(base: string[], other: string[]): Region[] {
  const parts = diffArrays(base, other);
  const out: Region[] = [];
  let bi = 0;
  let cur: Region | null = null;
  for (const p of parts) {
    const n = p.value.length;
    if (!p.added && !p.removed) {
      if (cur) out.push(cur);
      cur = null;
      bi += n;
    } else {
      if (!cur) cur = { s: bi, e: bi, lines: [] };
      if (p.removed) {
        cur.e += n;
        bi += n;
      } else cur.lines.push(...p.value);
    }
  }
  if (cur) out.push(cur);
  return out;
}

export type MergeSegment =
  | { type: "ok"; lines: string[] }
  | { type: "conflict"; base: string[]; ours: string[]; theirs: string[] };

function overlap(a: Region, b: Region): boolean {
  if (a.s === a.e && b.s === b.e) return a.s === b.s;
  return a.s < b.e && b.s < a.e;
}

function applyRegions(base: string[], s: number, e: number, rs: Region[]): string[] {
  const out: string[] = [];
  let pos = s;
  for (const r of rs) {
    out.push(...base.slice(pos, r.s), ...r.lines);
    pos = r.e;
  }
  out.push(...base.slice(pos, e));
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/** Line-based three-way merge (diff3). `ours` and `theirs` are both derived from `base`. */
export function merge3(baseText: string, oursText: string, theirsText: string): MergeSegment[] {
  const base = baseText.split("\n");
  const A = regions(base, oursText.split("\n"));
  const B = regions(base, theirsText.split("\n"));
  const segs: MergeSegment[] = [];
  let pos = 0;
  let i = 0;
  let j = 0;
  const push = (lines: string[]) => {
    if (lines.length === 0) return;
    const last = segs[segs.length - 1];
    if (last && last.type === "ok") last.lines.push(...lines);
    else segs.push({ type: "ok", lines: [...lines] });
  };
  while (i < A.length || j < B.length) {
    const ra = A[i];
    const rb = B[j];
    if (ra && (!rb || (!overlap(ra, rb) && ra.s <= rb.s))) {
      push(base.slice(pos, ra.s));
      push(ra.lines);
      pos = ra.e;
      i++;
    } else if (rb && (!ra || !overlap(ra, rb))) {
      push(base.slice(pos, rb.s));
      push(rb.lines);
      pos = rb.e;
      j++;
    } else if (ra && rb) {
      let s = Math.min(ra.s, rb.s);
      let e = Math.max(ra.e, rb.e);
      const ga: Region[] = [ra];
      const gb: Region[] = [rb];
      i++;
      j++;
      let grew = true;
      while (grew) {
        grew = false;
        const na = A[i];
        const nb = B[j];
        if (na && na.s < e) {
          ga.push(na);
          e = Math.max(e, na.e);
          i++;
          grew = true;
        }
        if (nb && nb.s < e) {
          gb.push(nb);
          e = Math.max(e, nb.e);
          j++;
          grew = true;
        }
      }
      s = Math.min(s, ga[0]?.s ?? s, gb[0]?.s ?? s);
      push(base.slice(pos, s));
      const ours = applyRegions(base, s, e, ga);
      const theirs = applyRegions(base, s, e, gb);
      if (same(ours, theirs)) push(ours);
      else segs.push({ type: "conflict", base: base.slice(s, e), ours, theirs });
      pos = e;
    }
  }
  push(base.slice(pos));
  return segs;
}

export function hasConflicts(segs: MergeSegment[]): boolean {
  return segs.some((s) => s.type === "conflict");
}

export function renderMerge(segs: MergeSegment[], labels = { ours: "ours", theirs: "theirs" }): string {
  const out: string[] = [];
  for (const s of segs) {
    if (s.type === "ok") out.push(...s.lines);
    else out.push(`<<<<<<< ${labels.ours}`, ...s.ours, "=======", ...s.theirs, `>>>>>>> ${labels.theirs}`);
  }
  return out.join("\n");
}

export interface ConflictBlock {
  index: number;
  start: number;
  end: number;
  ours: string[];
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
}

/** Finds git-style conflict blocks in a text. */
export function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split("\n");
  const out: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("<<<<<<<")) {
      let mid = -1;
      let end = -1;
      for (let k = i + 1; k < lines.length; k++) {
        const l = lines[k] ?? "";
        if (l.startsWith("=======") && mid === -1) mid = k;
        else if (l.startsWith(">>>>>>>")) {
          end = k;
          break;
        }
      }
      if (mid === -1 || end === -1) break;
      out.push({
        index: out.length,
        start: i,
        end,
        ours: lines.slice(i + 1, mid),
        theirs: lines.slice(mid + 1, end),
        oursLabel: line.slice(7).trim(),
        theirsLabel: (lines[end] ?? "").slice(7).trim(),
      });
      i = end + 1;
    } else i++;
  }
  return out;
}

export function resolveConflict(
  text: string,
  index: number,
  choice: "ours" | "theirs" | "both" | { custom: string },
): string {
  const blocks = parseConflicts(text);
  const b = blocks[index];
  if (!b) return text;
  const lines = text.split("\n");
  const repl =
    choice === "ours"
      ? b.ours
      : choice === "theirs"
        ? b.theirs
        : choice === "both"
          ? [...b.ours, ...b.theirs]
          : choice.custom.split("\n");
  lines.splice(b.start, b.end - b.start + 1, ...repl);
  return lines.join("\n");
}
