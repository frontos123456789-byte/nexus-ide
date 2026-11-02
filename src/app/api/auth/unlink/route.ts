import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { csrfCheck } from "@/lib/integrations/server";
import { AuthError } from "@/lib/auth/db";
import { json } from "@/lib/auth/http";
import { getSession } from "@/lib/auth/session";
import { unlinkAccount, writeAudit, userAccessToken } from "@/lib/auth/service";
import { revokeGrant } from "@/lib/auth/providers/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ provider: z.enum(["github", "vercel"]), confirm: z.literal(true) });

/** Detaches a login identity from the account (at least one must remain). Revokes the OAuth grant on GitHub. */
export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "auth-unlink", 10);
  if (limited) return limited;
  const ctx = await getSession(req);
  if (!ctx) return json({ error: "Требуется вход в Nexus", code: "unauthenticated" }, { status: 401 });
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Требуется подтверждение отвязки", code: "confirm_required" }, { status: 409 });
  try {
    // Read the token first, unlink (this refuses to remove the last identity), and only THEN revoke the grant at GitHub.
    const grant = p.data.provider === "github" ? await userAccessToken(ctx.user.id, "github") : null;
    await unlinkAccount(ctx.user.id, p.data.provider);
    if (grant) await revokeGrant(grant);
    await writeAudit({ userId: ctx.user.id, provider: p.data.provider, actor: ctx.user.displayName, action: "auth:unlink" });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, { status: e.status });
    return json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
