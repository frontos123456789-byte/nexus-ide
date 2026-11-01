import { basename, dirname } from "./path";

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  type: "file" | "folder";
  expanded: boolean;
  hasChildren: boolean;
}

interface NodeLike {
  path: string;
  type: "file" | "folder";
}

/** Flattens the node map into the visible rows of the explorer (folders first, natural sort). */
export function buildRows(nodes: Record<string, NodeLike>, expanded: Record<string, boolean>): TreeRow[] {
  const children = new Map<string, NodeLike[]>();
  for (const node of Object.values(nodes)) {
    const parent = dirname(node.path);
    const list = children.get(parent);
    if (list) list.push(node);
    else children.set(parent, [node]);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const list of children.values()) {
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return collator.compare(basename(a.path), basename(b.path));
    });
  }

  const rows: TreeRow[] = [];
  const walk = (parent: string, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      const isFolder = node.type === "folder";
      const open = isFolder && !!expanded[node.path];
      rows.push({
        path: node.path,
        name: basename(node.path),
        depth,
        type: node.type,
        expanded: open,
        hasChildren: isFolder && (children.get(node.path)?.length ?? 0) > 0,
      });
      if (open) walk(node.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}
