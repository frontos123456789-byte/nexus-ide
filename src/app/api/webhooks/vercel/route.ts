import { verifyHmacSha1 } from "@/lib/auth/crypto";
import { vercelConfig, vercelMonitorConfig } from "@/lib/auth/config";
import { revokeByExternal, writeAudit } from "@/lib/auth/service";
import { databaseConfigured } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Integration webhooks. The `x-vercel-signature` header (HMAC-SHA1 of the raw body keyed with the
 * integration client secret) is verified BEFORE the payload is parsed. Used to drop connections whose
 * configuration was removed on Vercel (`integration-configuration.removed`).
 */
export async function POST(req: Request): Promise<Response> {
  // Two integrations can post here: the Control Center one and the read-only Monitor one (each signs with its own client secret).
  const candidates: { secret: string; provider: "vercel" | "vercel_monitor" }[] = [];
  const control = vercelConfig().integrationSecret;
  const monitor = vercelMonitorConfig().clientSecret;
  if (control) candidates.push({ secret: control, provider: "vercel" });
  if (monitor) candidates.push({ secret: monitor, provider: "vercel_monitor" });
  if (candidates.length === 0) return Response.json({ error: "Vercel Integration не настроена" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Слишком большой payload" }, { status: 413 });
  const signature = req.headers.get("x-vercel-signature");
  const signer = candidates.find((c) => verifyHmacSha1(c.secret, raw, signature));
  if (!signer) return Response.json({ error: "Неверная подпись" }, { status: 401 });
  let ev: { type?: string; payload?: { configuration?: { id?: string }; configurationId?: string } } = {};
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  if (ev.type === "integration-configuration.removed" && databaseConfigured()) {
    const id = ev.payload?.configuration?.id ?? ev.payload?.configurationId;
    if (id) {
      const n = await revokeByExternal(signer.provider, id);
      await writeAudit({ provider: signer.provider, actor: "vercel-webhook", action: "webhook:configuration_removed", target: id, detail: `${n} connection(s) revoked`, source: "vercel-webhook" });
    }
  }
  return Response.json({ ok: true });
}
