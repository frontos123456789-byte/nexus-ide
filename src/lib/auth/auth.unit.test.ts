import { createHash, createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, pkcePair, safeNext, verifyHmacSha1 } from "./crypto";
import { baseUrl, githubConfig } from "./config";
import { appJwt } from "./providers/github";
import { assertEnvKeyAllowed, assertRepoAllowed, type GithubCred, type VercelCred } from "./credentials";
import { verifyHmacSha256 } from "@/lib/integrations/server";
import { checkIdToken } from "./providers/vercel";

const saved = { ...process.env };
beforeEach(() => {
  process.env.NEXUS_ENCRYPTION_KEY = "unit-test-key-1";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("token encryption", () => {
  it("round-trips and binds to the AAD", () => {
    const env = encryptSecret("ghs_secret", "connection:github:u1");
    expect(env.startsWith("v1.")).toBe(true);
    expect(env).not.toContain("ghs_secret");
    expect(decryptSecret(env, "connection:github:u1")).toBe("ghs_secret");
    expect(decryptSecret(env, "connection:github:u2")).toBeNull(); // swapped between users
  });
  it("rejects tampering and unknown versions", () => {
    const env = encryptSecret("x", "a");
    const i = env.length - 2; // a fully-used base64 character inside the GCM payload; guaranteed to differ from the original
    const flipped = env.slice(0, i) + (env[i] === "A" ? "B" : "A") + env.slice(i + 1);
    expect(decryptSecret(flipped, "a")).toBeNull();
    expect(decryptSecret("v9.abc", "a")).toBeNull();
  });
  it("supports key rotation via NEXUS_ENCRYPTION_KEY_PREVIOUS", () => {
    const env = encryptSecret("rotate-me", "a");
    process.env.NEXUS_ENCRYPTION_KEY = "new-key";
    expect(decryptSecret(env, "a")).toBeNull();
    process.env.NEXUS_ENCRYPTION_KEY_PREVIOUS = "unit-test-key-1";
    expect(decryptSecret(env, "a")).toBe("rotate-me");
  });
  it("refuses to encrypt in production without a key", () => {
    delete process.env.NEXUS_ENCRYPTION_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => encryptSecret("x", "a")).toThrow(/NEXUS_ENCRYPTION_KEY/);
  });
});

describe("pkce / redirects / signatures", () => {
  it("PKCE challenge is base64url(sha256(verifier))", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
  it("safeNext blocks open redirects", () => {
    expect(safeNext("/code")).toBe("/code");
    expect(safeNext("/?settings=account")).toBe("/?settings=account");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/api/auth/logout", "/a\r\nSet-Cookie: x=1", "", null, undefined]) {
      expect(safeNext(bad as string | null)).toBe("/");
    }
  });
  it("verifies GitHub (sha256) and Vercel (sha1) webhook signatures", () => {
    const body = '{"a":1}';
    const s256 = `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`;
    expect(verifyHmacSha256("s", body, s256)).toBe(true);
    expect(verifyHmacSha256("s", body + " ", s256)).toBe(false);
    expect(verifyHmacSha256("s", body, null)).toBe(false);
    const s1 = createHmac("sha1", "s").update(body).digest("hex");
    expect(verifyHmacSha1("s", body, s1)).toBe(true);
    expect(verifyHmacSha1("s", body, s1.replace(/.$/, "0"))).toBe(false);
    expect(verifyHmacSha1("s", body, null)).toBe(false);
  });
  it("pinned NEXUS_BASE_URL wins over a forged Host header", () => {
    process.env.NEXUS_BASE_URL = "https://nexus.example.com/";
    const req = new Request("http://evil.test/x", { headers: { host: "evil.test", "x-forwarded-host": "evil.test" } });
    expect(baseUrl(req)).toBe("https://nexus.example.com");
  });
});

describe("GitHub App JWT", () => {
  it("is RS256-signed with the configured key and short-lived", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_SLUG = "nexus";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
    expect(githubConfig().app).toBe(true);
    const now = 1_700_000_000;
    const [h, b, sig] = appJwt(now).split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(b, "base64url").toString()) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe("123");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60 + 60);
    expect(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("resource policies", () => {
  const gh = (allowed: string[] | null): GithubCred => ({ token: "t", actor: "a", via: "account", allowedRepos: allowed, userToken: async () => null });
  const vc = (envAllow: string[]): VercelCred => ({ token: "t", actor: "a", via: "account", envAllow });
  it("repo allow-list is case-insensitive and enforced", () => {
    expect(() => assertRepoAllowed(gh(null), "any/repo")).not.toThrow();
    expect(() => assertRepoAllowed(gh(["Me/One"]), "me/one")).not.toThrow();
    expect(() => assertRepoAllowed(gh(["me/one"]), "me/two")).toThrow(/не разрешён/);
  });
  it("env keys: reserved are always blocked, patterns narrow the rest", () => {
    expect(() => assertEnvKeyAllowed(vc([]), "MY_KEY")).not.toThrow();
    expect(() => assertEnvKeyAllowed(vc([]), "VERCEL_TOKEN")).toThrow(/зарезервирована/);
    expect(() => assertEnvKeyAllowed(vc(["NEXT_PUBLIC_*"]), "NEXT_PUBLIC_API")).not.toThrow();
    expect(() => assertEnvKeyAllowed(vc(["NEXT_PUBLIC_*"]), "DATABASE_URL")).toThrow(/не входит/);
  });
});

describe("Vercel id_token check", () => {
  it("requires matching aud, nonce and a future exp", () => {
    process.env.VERCEL_APP_CLIENT_ID = "app_1";
    const tok = (c: object) => `h.${Buffer.from(JSON.stringify(c)).toString("base64url")}.s`;
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(checkIdToken(tok({ aud: "app_1", nonce: "n", exp }), "n")).toBe(true);
    expect(checkIdToken(tok({ aud: "app_1", nonce: "other", exp }), "n")).toBe(false);
    expect(checkIdToken(tok({ aud: "app_2", nonce: "n", exp }), "n")).toBe(false);
    expect(checkIdToken(tok({ aud: "app_1", nonce: "n", exp: 1 }), "n")).toBe(false);
    expect(checkIdToken(undefined, "n")).toBe(false);
  });
});
