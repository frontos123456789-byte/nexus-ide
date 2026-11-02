import { merge3, hasConflicts, renderMerge } from "./merge";
import type { Change } from "./types";

export interface SwarmResult {
  agent: string;
  changes: Change[];
}

export interface SwarmConflict {
  path: string;
  /** Text with git-style markers; resolve via parseConflicts/resolveConflict. */
  text: string;
  agents: string[];
}

export interface SwarmMerge {
  merged: Change[];
  conflicts: SwarmConflict[];
  /** paths touched by more than one agent (merged automatically or conflicting). */
  overlapping: string[];
}

/**
 * Merges the results of agents that each worked on an isolated copy of `base`.
 * Non-overlapping edits are combined; overlapping edits go through a three-way merge,
 * and unresolved hunks come back as conflicts instead of one agent silently overwriting another.
 */
export function mergeSwarm(base: Record<string, string>, results: SwarmResult[]): SwarmMerge {
  const byPath = new Map<string, { agent: string; after: string | null }[]>();
  for (const r of results) for (const c of r.changes) {
    const list = byPath.get(c.path) ?? [];
    list.push({ agent: r.agent, after: c.after });
    byPath.set(c.path, list);
  }
  const merged: Change[] = [];
  const conflicts: SwarmConflict[] = [];
  const overlapping: string[] = [];
  for (const [path, edits] of byPath) {
    const before = base[path] ?? null;
    if (edits.length === 1) {
      const only = edits[0];
      if (only) merged.push({ path, before, after: only.after });
      continue;
    }
    overlapping.push(path);
    const deleting = edits.filter((e) => e.after === null);
    if (deleting.length > 0 && deleting.length < edits.length) {
      conflicts.push({ path, text: `<<<<<<< ${deleting[0]?.agent} (удалил файл)\n=======\n${edits.find((e) => e.after !== null)?.after ?? ""}\n>>>>>>> ${edits.find((e) => e.after !== null)?.agent}`, agents: edits.map((e) => e.agent) });
      continue;
    }
    if (deleting.length === edits.length) {
      merged.push({ path, before, after: null });
      continue;
    }
    let acc = edits[0]?.after ?? "";
    let accAgent = edits[0]?.agent ?? "";
    let failed = false;
    for (const e of edits.slice(1)) {
      const segs = merge3(before ?? "", acc, e.after ?? "");
      acc = renderMerge(segs, { ours: accAgent, theirs: e.agent });
      accAgent = `${accAgent}+${e.agent}`;
      if (hasConflicts(segs)) failed = true;
    }
    if (failed) conflicts.push({ path, text: acc, agents: edits.map((e) => e.agent) });
    else merged.push({ path, before, after: acc });
  }
  return { merged: merged.filter((c) => c.before !== c.after), conflicts, overlapping };
}
