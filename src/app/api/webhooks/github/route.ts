import { audit, verifyHmacSha256 } from "@/lib/integrations/server";
import { databaseConfigured, githubConfig } from "@/lib/auth/config";
import { revokeByExternal, writeAudit } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GitHub webhook receiver. The X-Hub-Signature-256 HMAC is verified against GITHUB_WEBHOOK_SECRET
 * BEFORE the payload is parsed. Without the secret the endpoint refuses all traffic.
 * Events end up in the Nexus audit journal and are shown in the Agent Activity Monitor.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = githubConfig().webhookSecret;
  if (!secret) return Response.json({ error: "GITHUB_WEBHOOK_SECRET (или GITHUB_APP_WEBHOOK_SECRET) не настроен" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return Response.json({ error: "Слишком большой payload" }, { status: 413 });
  if (!verifyHmacSha256(secret, raw, req.headers.get("x-hub-signature-256"))) return Response.json({ error: "Неверная подпись" }, { status: 401 });
  const event = req.headers.get("x-github-event") ?? "unknown";
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  // GitHub App lifecycle: the user removed/suspended the installation on GitHub → drop the Nexus connection immediately.
  if (event === "installation") {
    const inst = p.installation as { id?: number } | undefined;
    if (inst?.id && (p.action === "deleted" || p.action === "suspend") && databaseConfigured()) {
      const n = await revokeByExternal("github", String(inst.id)).catch(() => 0);
      await writeAudit({ provider: "github", actor: (p.sender as { login?: string } | undefined)?.login ?? "github", action: `webhook:installation_${String(p.action)}`, target: String(inst.id), detail: `${n} connection(s) revoked`, source: "github-webhook" });
    }
    return Response.json({ ok: true });
  }
  if (event === "github_app_authorization" && p.action === "revoked") {
    await audit({ source: "github-webhook", actor: (p.sender as { login?: string } | undefined)?.login ?? "github", action: "webhook:github_app_authorization", target: "oauth", ok: true, detail: "user revoked authorization" });
    return Response.json({ ok: true });
  }
  const repo = (p.repository as { full_name?: string } | undefined)?.full_name ?? "?";
  const sender = (p.sender as { login?: string } | undefined)?.login ?? "github";
  let detail = typeof p.action === "string" ? p.action : "";
  if (event === "push") detail = `${String(p.ref ?? "")}: ${((p.commits as { message: string }[] | undefined) ?? []).map((c) => c.message.split("\n")[0]).slice(0, 3).join(" | ")}`;
  if (event === "workflow_run") {
    const w = p.workflow_run as { name?: string; status?: string; conclusion?: string | null } | undefined;
    detail = `${w?.name ?? ""}: ${w?.status ?? ""}${w?.conclusion ? ` → ${w.conclusion}` : ""}`;
  }
  if (event === "pull_request") detail = `${String(p.action)} #${String((p.pull_request as { number?: number } | undefined)?.number ?? "")}`;
  await audit({ source: "github-webhook", actor: sender, action: `webhook:${event}`, target: repo, ok: true, detail });
  return Response.json({ ok: true });
}

export async function GET(): Promise<Response> {
  return Response.json({ configured: Boolean(githubConfig().webhookSecret) });
}
