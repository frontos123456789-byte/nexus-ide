import { describe, expect, it, vi } from "vitest";
import { formatShortcut, matchHotkey, type Hotkey } from "./hotkeys";
import { formatDuration, truncate } from "./format";
import { createBatcher } from "./sse-client";
import { resolveTerminalPath, runCommand, tokenize, type TerminalContext } from "./terminal-commands";

function makeCtx(overrides: Partial<TerminalContext> = {}): TerminalContext & { files: Record<string, string> } {
  const files: Record<string, string> = { "README.md": "# hi\n", "src/a.ts": "export const a = 1;\n" };
  const nodes: TerminalContext["nodes"] = {
    src: { type: "folder" },
    "README.md": { type: "file" },
    "src/a.ts": { type: "file" },
  };
  return {
    cwd: "",
    nodes,
    files,
    read: (p) => files[p],
    createFile: async (p) => {
      nodes[p] = { type: "file" };
      files[p] = "";
    },
    createFolder: async (p) => {
      nodes[p] = { type: "folder" };
    },
    remove: async (p) => {
      delete nodes[p];
    },
    move: async (a, b) => {
      nodes[b] = nodes[a];
      delete nodes[a];
    },
    open: vi.fn(),
    ask: vi.fn(),
    models: [{ id: "a:free", label: "A" }],
    aiStatus: { state: "idle", modelLabel: null, configured: true },
    history: ["ls"],
    ...overrides,
  };
}

const text = (r: { lines: { text: string }[] }) => r.lines.map((l) => l.text).join("\n");

describe("terminal commands", () => {
  it("tokenizes quotes", () => {
    expect(tokenize(`echo "hello world" 'a b' c`)).toEqual(["echo", "hello world", "a b", "c"]);
  });

  it("resolves paths relative to cwd", () => {
    expect(resolveTerminalPath("src", "a.ts")).toBe("src/a.ts");
    expect(resolveTerminalPath("src", "/README.md")).toBe("README.md");
    expect(resolveTerminalPath("src", "..")).toBe("");
    expect(resolveTerminalPath("src", "~")).toBe("");
    expect(resolveTerminalPath("src", undefined)).toBe("src");
  });

  it("ls / cd / pwd / cat / tree", async () => {
    const ctx = makeCtx();
    expect(text(await runCommand("ls", ctx))).toBe("src/\nREADME.md");
    const cd = await runCommand("cd src", ctx);
    expect(cd.cwd).toBe("src");
    expect(text(await runCommand("ls", { ...ctx, cwd: "src" }))).toBe("a.ts");
    expect(text(await runCommand("pwd", { ...ctx, cwd: "src" }))).toBe("/src");
    expect(text(await runCommand("cat src/a.ts", ctx))).toBe("export const a = 1;");
    expect(text(await runCommand("tree", ctx))).toContain("└── README.md");
    expect((await runCommand("cd README.md", ctx)).lines[0].level).toBe("err");
    expect((await runCommand("cat nope", ctx)).lines[0].level).toBe("err");
  });

  it("mutating commands", async () => {
    const ctx = makeCtx();
    expect(text(await runCommand("touch new.ts", ctx))).toContain("создан");
    expect(ctx.nodes["new.ts"]).toBeTruthy();
    expect((await runCommand("touch new.ts", ctx)).lines[0].level).toBe("err");
    await runCommand("mkdir lib", ctx);
    expect(ctx.nodes["lib"].type).toBe("folder");
    await runCommand("mv new.ts lib", ctx);
    expect(ctx.nodes["lib/new.ts"]).toBeTruthy();
    await runCommand("rm lib/new.ts", ctx);
    expect(ctx.nodes["lib/new.ts"]).toBeUndefined();
    expect((await runCommand("rm", ctx)).lines[0].text).toContain("Использование");
  });

  it("open / ai / clear / unknown / errors from context", async () => {
    const ctx = makeCtx();
    await runCommand("open src/a.ts", ctx);
    expect(ctx.open).toHaveBeenCalledWith("src/a.ts");
    await runCommand("ai how are you", ctx);
    expect(ctx.ask).toHaveBeenCalledWith("how are you");
    expect((await runCommand("clear", ctx)).clear).toBe(true);
    expect((await runCommand("wat", ctx)).lines[0].level).toBe("err");
    const failing = makeCtx({ createFile: async () => { throw new Error("boom"); } });
    expect(text(await runCommand("touch x", failing))).toContain("boom");
    expect(text(await runCommand("status", ctx))).toContain("ключ настроен");
    expect(text(await runCommand("models", ctx))).toContain("a:free");
  });
});

describe("hotkeys", () => {
  const ev = (o: Partial<KeyboardEvent>) =>
    ({ key: "k", code: "KeyK", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;
  const h: Hotkey = { key: "k", mod: true, handler: () => undefined };

  it("uses Cmd on mac and Ctrl elsewhere", () => {
    expect(matchHotkey(ev({ metaKey: true }), h, true)).toBe(true);
    expect(matchHotkey(ev({ ctrlKey: true }), h, true)).toBe(false);
    expect(matchHotkey(ev({ ctrlKey: true }), h, false)).toBe(true);
    expect(matchHotkey(ev({ metaKey: true }), h, false)).toBe(false);
  });

  it("respects shift/alt and code matching", () => {
    expect(matchHotkey(ev({ metaKey: true, shiftKey: true }), h, true)).toBe(false);
    const digit: Hotkey = { code: "Digit1", alt: true, handler: () => undefined };
    expect(matchHotkey(ev({ key: "¡", code: "Digit1", altKey: true }), digit, true)).toBe(true);
  });

  it("formats shortcuts", () => {
    expect(formatShortcut({ key: "k", mod: true }, true)).toBe("⌘K");
    expect(formatShortcut({ key: "k", mod: true, shift: true }, false)).toBe("Ctrl+Shift+K");
  });
});

describe("misc utils", () => {
  it("formats durations and truncates", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(3200)).toBe("3.2s");
    expect(formatDuration(125000)).toBe("2m 5s");
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("batches deltas", async () => {
    const flush = vi.fn();
    const b = createBatcher(flush, 10);
    b.push("a");
    b.push("b");
    expect(flush).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 25));
    expect(flush).toHaveBeenCalledWith("ab");
    b.push("c");
    b.flush();
    expect(flush).toHaveBeenLastCalledWith("c");
    b.push("x");
    b.discard();
    await new Promise((r) => setTimeout(r, 25));
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
