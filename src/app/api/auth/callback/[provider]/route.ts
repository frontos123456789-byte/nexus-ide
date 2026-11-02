import { rateLimit } from "@/lib/nexus/server/guard";
import { callbackUrl } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/db";
import { autoConnectInstallation } from "@/lib/auth/github-connect";
import { redirectTo, withQuery } from "@/lib/auth/http";
import { clearFlowCookie, verifyState, type OAuthFlow } from "@/lib/auth/oauth-state";
import * as github from "@/lib/auth/providers/github";
import * as vercel from "@/lib/auth/providers/vercel";
import { signInOrLink, writeAudit, type IdentityProfile, type IdentityTokens } from "@/lib/auth/service";
import { createSession, getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fail(req: Request, flow: OAuthFlow | null, provider: string, code: string): Response {
  const clear = [clearFlowCookie()];
  if (flow?.kind === "link") return redirectTo(req, withQuery(flow.next, { auth_error: code, provider }), clear);
  return redirectTo(req, withQuery("/login", { error: code, provider }), clear);
}

/** OAuth callback: verifies `state` (CSRF), exchanges the code with PKCE, creates/links the account, starts a session. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await ctx.params;
  if (provider !== "github" && provider !== "vercel") return Response.json({ error: "Неизвестный провайдер" }, { status: 404 });
  const limited = rateLimit(req, "auth-callback", 40);
  if (limited) return limited;

  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const flowOrErr = verifyState(req, state, { provider, kinds: ["login", "link"] });
  if (typeof flowOrErr === "string") return fail(req, null, provider, "state_mismatch");
  const flow = flowOrErr;

  // User pressed "Cancel" on the provider consent screen (or the provider reported an error).
  const providerError = url.searchParams.get("error");
  if (providerError) return fail(req, flow, provider, providerError === "access_denied" ? "cancelled" : "provider_error");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) return fail(req, flow, provider, "missing_code");

  let current = null;
  if (flow.kind === "link") {
    // A link callback only counts inside the very session that started it – no cross-session / cross-account linking.
    current = await getSession(req);
    if (!current || current.sessionId !== flow.sid) return fail(req, flow, provider, "session_changed");
  }

  let profile: IdentityProfile;
  let tokens: IdentityTokens;
  try {
    const redirectUri = callbackUrl(req, provider);
    if (provider === "github") {
      tokens = await github.exchangeCode(code, redirectUri, flow.verifier ?? "");
      const p = await github.fetchProfile(tokens.accessToken);
      profile = { id: p.id, login: p.login, name: p.name, avatar: p.avatar, email: p.email };
    } else {
      const t = await vercel.exchangeSignInCode(code, redirectUri, flow.verifier ?? "");
      if (!vercel.checkIdToken(t.idToken, flow.nonce ?? "")) return fail(req, flow, provider, "invalid_id_token");
      tokens = t;
      const p = await vercel.fetchSignInProfile(t.accessToken);
      profile = { id: p.id, login: p.login, name: p.name, avatar: p.avatar, email: p.email };
    }
  } catch (e) {
    await writeAudit({ provider, actor: "anonymous", action: `auth:${flow.kind}`, ok: false, detail: e instanceof Error ? e.message : "exchange failed" });
    return fail(req, flow, provider, "provider_error");
  }

  try {
    const r = await signInOrLink({ provider, profile, tokens, kind: flow.kind === "link" ? "link" : "login", currentUserId: current?.user.id });
    await writeAudit({ userId: r.userId, provider, actor: profile.login, action: flow.kind === "link" ? "auth:link" : r.created ? "auth:signup" : "auth:login", target: profile.id });
    if (provider === "github") await autoConnectInstallation(r.userId, profile.login, tokens.accessToken);
    if (flow.kind === "link") return redirectTo(req, withQuery(flow.next, { linked: provider }), [clearFlowCookie()]);
    const s = await createSession(r.userId, req);
    return redirectTo(req, flow.next, [s.setCookie, clearFlowCookie()]);
  } catch (e) {
    if (e instanceof AuthError) {
      await writeAudit({ userId: current?.user.id, provider, actor: profile.login, action: `auth:${flow.kind}`, ok: false, detail: e.code });
      return fail(req, flow, provider, e.code);
    }
    return fail(req, flow, provider, "internal_error");
  }
}
