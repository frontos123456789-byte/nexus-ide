import { describe, expect, it } from "vitest";
import { buildRows } from "./tree-model";

const n = (path: string, type: "file" | "folder" = "file") => [path, { path, type }] as const;

describe("buildRows", () => {
  const nodes = Object.fromEntries([
    n("src", "folder"),
    n("src/b.ts"),
    n("src/a.ts"),
    n("src/lib", "folder"),
    n("src/lib/x.ts"),
    n("docs", "folder"),
    n("README.md"),
    n("file10.ts"),
    n("file2.ts"),
  ]);

  it("sorts folders first and uses natural ordering", () => {
    const rows = buildRows(nodes, {});
    expect(rows.map((r) => r.path)).toEqual(["docs", "src", "file2.ts", "file10.ts", "README.md"]);
  });

  it("reveals children of expanded folders with depth", () => {
    const rows = buildRows(nodes, { src: true, "src/lib": true });
    expect(rows.map((r) => `${r.depth}:${r.name}`)).toEqual([
      "0:docs",
      "0:src",
      "1:lib",
      "2:x.ts",
      "1:a.ts",
      "1:b.ts",
      "0:file2.ts",
      "0:file10.ts",
      "0:README.md",
    ]);
    expect(rows.find((r) => r.path === "src")).toMatchObject({ expanded: true, hasChildren: true });
    expect(rows.find((r) => r.path === "docs")).toMatchObject({ hasChildren: false });
  });

  it("hides descendants when a parent is collapsed even if the child is marked expanded", () => {
    const rows = buildRows(nodes, { "src/lib": true });
    expect(rows.some((r) => r.path === "src/lib")).toBe(false);
  });
});
