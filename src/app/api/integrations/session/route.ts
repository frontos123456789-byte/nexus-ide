import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { audit, csrfCheck, isOwner, readSession, sessionCookie, type SessionData } from "@/lib/integrations/server";
import { envToken } from "@/lib/nexus/server/guard";
import { getSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const connectSchema = z.object({
  provider: z.enum(["github", "vercel", "telegram"]),
  token: z.string().trim().min(8).max(400),
  teamId: z.string().trim().max(80).optional(),
});

async function validate(provider: "github" | "vercel" | "telegram", token: string): Promise<{ login: string; scopes?: string } | string> {
  try {
    if (provider === "github") {
      const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nexus-ai" } });
      if (!r.ok) return `GitHub отклонил токен (HTTP ${r.status})`;
      const j = (await r.json()) as { login: string };
      return { login: j.login, scopes: r.headers.get("x-oauth-scopes") ?? "fine-grained" };
    }
    if (provider === "vercel") {
      const r = await fetch("https://api.vercel.com/v2/user", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) return `Vercel отклонил токен (HTTP ${r.status})`;
      const j = (await r.json()) as { user?: { username?: string; email?: string } };
      return { login: j.user?.username ?? j.user?.email ?? "vercel-user" };
    }
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`);
    const j = (await r.json()) as { ok: boolean; result?: { username?: string }; description?: string };
    if (!j.ok) return `Telegram отклонил токен: ${j.description ?? r.status}`;
    return { login: `@${j.result?.username ?? "bot"}` };
  } catch {
    return "Сервис недоступен — попробуйте позже";
  }
}

/** Connection status. Never returns tokens. Account connections (GitHub App / Vercel Integration) win over legacy manual tokens. */
export async function GET(req: Request): Promise<Response> {
  const s = readSession(req);
  const owner = isOwner(req);
  const ctx = await getSession(req).catch(() => null);
  const [ghc, vcc] = ctx ? await Promise.all([getConnection(ctx.user.id, "github").catch(() => null), getConnection(ctx.user.id, "vercel").catch(() => null)]) : [null, null];
  return Response.json({
    github: { connected: Boolean(ghc) || Boolean(s.github) || (owner && Boolean(envToken("github"))), login: ghc?.externalLogin ?? s.logins?.github, via: ghc ? "account" : s.github ? "user-token" : owner ? "owner-env" : null },
    vercel: { connected: Boolean(vcc) || Boolean(s.vercel) || (owner && Boolean(envToken("vercel"))), login: vcc?.externalLogin ?? s.logins?.vercel, teamId: vcc?.teamId ?? s.teamId, via: vcc ? "account" : s.vercel ? "user-token" : owner ? "owner-env" : null },
    telegram: { connected: Boolean(s.telegram) || (owner && Boolean(process.env.TELEGRAM_BOT_TOKEN)), login: s.logins?.telegram, via: s.telegram ? "user-token" : owner && process.env.TELEGRAM_BOT_TOKEN ? "owner-env" : null },
    owner,
    signedIn: Boolean(ctx),
    legacy: { github: Boolean(s.github), vercel: Boolean(s.vercel) },
  });
}

export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "int-session", 10);
  if (limited) return limited;
  const parsed = connectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  const { provider, token, teamId } = parsed.data;
  const v = await validate(provider, token);
  if (typeof v === "string") {
    await audit({ actor: "anonymous", action: `connect:${provider}`, target: provider, ok: false, detail: v });
    return Response.json({ error: v }, { status: 401 });
  }
  const s: SessionData = readSession(req);
  s[provider] = token;
  s.logins = { ...s.logins, [provider]: v.login };
  if (provider === "vercel") s.teamId = teamId || undefined;
  await audit({ actor: v.login, action: `connect:${provider}`, target: provider, ok: true, detail: v.scopes ? `scopes: ${v.scopes}` : undefined });
  return Response.json({ ok: true, login: v.login, scopes: v.scopes }, { headers: { "set-cookie": sessionCookie(s) } });
}

export async function DELETE(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const s = readSession(req);
  if (provider === "github" || provider === "vercel" || provider === "telegram") {
    await audit({ actor: s.logins?.[provider] ?? "anonymous", action: `disconnect:${provider}`, target: provider, ok: true });
    delete s[provider];
    if (s.logins) delete s.logins[provider];
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(s) } });
}
