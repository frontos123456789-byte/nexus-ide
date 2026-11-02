import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token encryption (AES-256-GCM) + small helpers shared by the OAuth flows.
 *
 * Key: NEXUS_ENCRYPTION_KEY (any high-entropy string; 32 random bytes as base64/hex recommended).
 * Rotation: put the old key into NEXUS_ENCRYPTION_KEY_PREVIOUS – it is only used for decryption.
 * In production there is NO built-in fallback key: without NEXUS_ENCRYPTION_KEY no provider token is ever stored.
 */

const VERSION = "v1";

function deriveKey(raw: string): Buffer {
  return createHash("sha256").update(`nexus-token-key:${raw}`).digest();
}

function keys(): Buffer[] {
  const out: Buffer[] = [];
  const cur = process.env.NEXUS_ENCRYPTION_KEY?.trim();
  const prev = process.env.NEXUS_ENCRYPTION_KEY_PREVIOUS?.trim();
  if (cur) out.push(deriveKey(cur));
  if (prev) out.push(deriveKey(prev));
  if (out.length === 0 && process.env.NODE_ENV !== "production") out.push(deriveKey("nexus-dev-only-encryption-key"));
  return out;
}

export function encryptionAvailable(): boolean {
  return keys().length > 0;
}

/** `aad` binds the ciphertext to its owner (e.g. `github:<userId>`) so rows cannot be swapped between users. */
export function encryptSecret(plain: string, aad: string): string {
  const key = keys()[0];
  if (!key) throw new Error("NEXUS_ENCRYPTION_KEY не задан — токены провайдеров не сохраняются");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${VERSION}.${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url")}`;
}

export function decryptSecret(envelope: string, aad: string): string | null {
  if (!envelope.startsWith(`${VERSION}.`)) return null;
  const buf = Buffer.from(envelope.slice(VERSION.length + 1), "base64url");
  if (buf.length < 29) return null;
  for (const key of keys()) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAAD(Buffer.from(aad));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    } catch {
      /* try the next key */
    }
  }
  return null;
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Vercel webhooks are signed with HMAC-SHA1 (hex) of the raw body using the integration client secret. */
export function verifyHmacSha1(secret: string, payload: string, signature: string | null): boolean {
  if (!signature) return false;
  return safeEqual(createHmac("sha1", secret).update(payload).digest("hex"), signature.trim());
}

/** Open-redirect protection: only same-origin relative paths are accepted. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  if (next.startsWith("/api/")) return fallback;
  return next.slice(0, 300);
}
