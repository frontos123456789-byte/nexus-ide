import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  copyEntry,
  createFile,
  createFolder,
  deleteEntry,
  getKv,
  listEntries,
  renameEntry,
  resetWorkspace,
  seedIfNeeded,
  setKv,
  writeFile,
} from "./fs";
import { NexusDB } from "./schema";
import { SEED_FILES } from "./seed";

let n = 0;
let db: NexusDB;
beforeEach(() => {
  db = new NexusDB(`test-db-${++n}`);
});

const paths = async () => (await listEntries(db)).map((e) => e.path).sort();

describe("virtual file system (IndexedDB)", () => {
  it("seeds the demo project once and never reseeds", async () => {
    expect(await seedIfNeeded(db)).toBe(true);
    const all = await listEntries(db);
    for (const f of SEED_FILES) expect(all.find((e) => e.path === f.path)?.content).toBe(f.content);
    expect(all.some((e) => e.path === "src/lib" && e.type === "folder")).toBe(true);

    await deleteEntry("src", db);
    expect(await seedIfNeeded(db)).toBe(false);
    expect((await paths()).some((p) => p.startsWith("src"))).toBe(false);
  });

  it("creates files with missing parent folders and persists content", async () => {
    await writeFile("a/b/c.ts", "export {}", db);
    expect(await paths()).toEqual(["a", "a/b", "a/b/c.ts"]);
    await writeFile("a/b/c.ts", "updated", db);
    expect((await db.files.get("a/b/c.ts"))?.content).toBe("updated");
  });

  it("refuses duplicates, folder writes and files-as-folders", async () => {
    await createFile("x.ts", "", db);
    await expect(createFile("x.ts", "", db)).rejects.toThrow(/уже существует/);
    await createFolder("dir", db);
    await expect(writeFile("dir", "x", db)).rejects.toThrow();
    await expect(writeFile("x.ts/inner.ts", "x", db)).rejects.toThrow();
  });

  it("renames folders with their subtree", async () => {
    await writeFile("old/a.ts", "A", db);
    await writeFile("old/sub/b.ts", "B", db);
    await writeFile("other/c.ts", "C", db);
    const map = await renameEntry("old", "new", db);
    expect(map).toMatchObject({ old: "new", "old/a.ts": "new/a.ts", "old/sub/b.ts": "new/sub/b.ts" });
    expect(await paths()).toEqual(["new", "new/a.ts", "new/sub", "new/sub/b.ts", "other", "other/c.ts"]);
    expect((await db.files.get("new/sub/b.ts"))?.content).toBe("B");
  });

  it("does not confuse sibling prefixes (src vs src2)", async () => {
    await writeFile("src/a.ts", "1", db);
    await writeFile("src2/b.ts", "2", db);
    await deleteEntry("src", db);
    expect(await paths()).toEqual(["src2", "src2/b.ts"]);
  });

  it("blocks moving a folder into itself and overwriting", async () => {
    await writeFile("f/a.ts", "", db);
    await writeFile("g.ts", "", db);
    await expect(renameEntry("f", "f/inner", db)).rejects.toThrow();
    await expect(renameEntry("f/a.ts", "g.ts", db)).rejects.toThrow(/уже существует/);
  });

  it("copies subtrees", async () => {
    await writeFile("p/a.ts", "A", db);
    await copyEntry("p", "p copy", db);
    expect(await paths()).toEqual(["p", "p copy", "p copy/a.ts", "p/a.ts"]);
  });

  it("stores key/value data and resets the workspace", async () => {
    await setKv("ui", { a: 1 }, db);
    expect(await getKv<{ a: number }>("ui", db)).toEqual({ a: 1 });
    await writeFile("junk.ts", "", db);
    await resetWorkspace(db);
    const all = await paths();
    expect(all).not.toContain("junk.ts");
    expect(all).toContain("README.md");
  });
});
