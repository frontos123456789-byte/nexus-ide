import { describe, expect, it } from "vitest";
import {
  ancestors,
  basename,
  dirname,
  extname,
  isDescendant,
  joinPath,
  languageFromPath,
  normalizePath,
  uniqueCopyPath,
  validateName,
} from "./path";

describe("path utils", () => {
  it("normalizes paths", () => {
    expect(normalizePath("/src//lib/./a.ts")).toBe("src/lib/a.ts");
    expect(normalizePath("a/b/../c")).toBe("a/c");
    expect(normalizePath("../../etc/passwd")).toBe("etc/passwd");
    expect(normalizePath("\\win\\path")).toBe("win/path");
    expect(normalizePath("")).toBe("");
  });

  it("splits and joins", () => {
    expect(dirname("a/b/c.ts")).toBe("a/b");
    expect(dirname("c.ts")).toBe("");
    expect(basename("a/b/c.ts")).toBe("c.ts");
    expect(extname("a/b/C.TS")).toBe(".ts");
    expect(extname(".env")).toBe("");
    expect(joinPath("a", "", "b/c")).toBe("a/b/c");
  });

  it("detects descendants and ancestors", () => {
    expect(isDescendant("src", "src/a.ts")).toBe(true);
    expect(isDescendant("src", "src2/a.ts")).toBe(false);
    expect(isDescendant("src", "src")).toBe(false);
    expect(isDescendant("", "a")).toBe(true);
    expect(ancestors("a/b/c.ts")).toEqual(["a", "a/b"]);
  });

  it("validates names", () => {
    expect(validateName("ok.ts")).toBeNull();
    expect(validateName("  ")).not.toBeNull();
    expect(validateName("a/b")).not.toBeNull();
    expect(validateName("..")).not.toBeNull();
  });

  it("generates unique copy names", () => {
    const taken = new Set(["src/a copy.ts", "src/a copy 2.ts"]);
    expect(uniqueCopyPath("src/a.ts", (p) => taken.has(p))).toBe("src/a copy 3.ts");
    expect(uniqueCopyPath("README", () => false)).toBe("README copy");
  });

  it("maps languages", () => {
    expect(languageFromPath("a.tsx")).toBe("typescript");
    expect(languageFromPath("x/package.json")).toBe("json");
    expect(languageFromPath("Dockerfile")).toBe("dockerfile");
    expect(languageFromPath(".env.local")).toBe("ini");
    expect(languageFromPath("unknown.xyz")).toBe("plaintext");
  });
});
