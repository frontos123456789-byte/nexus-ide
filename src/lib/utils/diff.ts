import { diffLines } from "diff";

export interface DiffStats {
  added: number;
  removed: number;
}

/** Line-level +/- counts between two versions of a file. */
export function diffStats(before: string | null, after: string): DiffStats {
  const changes = diffLines(before ?? "", after);
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    const lines = c.count ?? 0;
    if (c.added) added += lines;
    else if (c.removed) removed += lines;
  }
  return { added, removed };
}
