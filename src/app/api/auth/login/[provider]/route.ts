import { rateLimit } from "@/lib/nexus/server/guard";
import { callbackUrl, databaseConfigured, githubConfig, vercelConfig } from "@/lib/auth/config";
import { encryptionAvailable, pkcePair, randomToken, safeNext } from "@/lib/auth/crypto";
import { flowCookie, newFlow } from "@/lib/auth/oauth-state";
import { getSession } from "@/lib/auth/session";
import { redirectExternal, redirectTo, withQuery } from "@/lib/auth/http";
import * as github from "@/lib/auth/providers/github";
import * as vercel from "@/lib/auth/providers/vercel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts "Continue with GitHub / Vercel". Redirects the browser to the OFFICIAL provider consent screen.
 * GET is safe here: login CSRF is prevented by the `state` bound to a cookie of this browser (+ PKCE).
 *   ?intent=link  → attach this identity to the CURRENT, verified session (never merged by e-mail).
 */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await ctx.params;
  if (provider !== "github" && provider !== "vercel") return Response.json({ error: "Неизвестный провайдер" }, { status: 404 });
  const limited = rateLimit(req, "auth-start", 30);
  if (limited) return limited;

  const url = new URL(req.url);
  const intent = url.searchParams.get("intent") === "link" ? "link" : "login";
  const next = safeNext(url.searchParams.get("next"), "/");
  const fail = (code: string) => redirectTo(req, intent === "link" ? withQuery(next, { auth_error: code, provider }) : withQuery("/login", { error: code, provider, next }));

  const configured = provider === "github" ? githubConfig().oauth : vercelConfig().signIn;
  if (!configured) return fail("not_configured");
  if (!databaseConfigured()) return fail("database_not_configured");
  if (!encryptionAvailable()) return fail("encryption_not_configured");

  const session = await getSession(req);
  if (intent === "link" && !session) return fail("session_required");

  const { verifier, challenge } = pkcePair();
  const nonce = provider === "vercel" ? randomToken(24) : undefined;
  const flow = newFlow({ kind: intent, provider, verifier, nonce, sid: session?.sessionId ?? "", next });
  const redirectUri = callbackUrl(req, provider);
  const target = provider === "github" ? github.authorizeUrl({ redirectUri, state: flow.state, challenge }) : vercel.signInUrl({ redirectUri, state: flow.state, nonce: nonce ?? "", challenge });
  return redirectExternal(target, [flowCookie(flow)]);
}
