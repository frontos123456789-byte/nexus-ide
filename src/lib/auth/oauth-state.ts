import { isSecureDeployment } from "./config";
import { decryptSecret, encryptSecret, randomToken, safeEqual } from "./crypto";
import { clearCookie, parseCookies, serializeCookie } from "./session";

/**
 * Short-lived (10 min) encrypted cookie that binds an OAuth round-trip to the browser that started it:
 *   state (CSRF), PKCE verifier, OIDC nonce, the intent (login / link / install), and the id of the Nexus session
 *   that was active when the flow began (so a "link" callback can only complete inside the same verified session).
 * SameSite=Lax is required here: the provider redirects back with a top-level GET navigation.
 */

export type FlowKind = "login" | "link" | "github-install" | "vercel-install";

export interface OAuthFlow {
  kind: FlowKind;
  provider: "github" | "vercel";
  state: string;
  verifier?: string;
  nonce?: string;
  /** session id (sha256) active at the start; "" for anonymous logins */
  sid: string;
  next: string;
  popup?: boolean;
  exp: number;
}

const FLOW_TTL_MS = 10 * 60_000;
const name = () => (isSecureDeployment() ? "__Host-nexus_oauth" : "nexus_oauth");
const AAD = "oauth-flow";

export function newFlow(f: Omit<OAuthFlow, "state" | "exp"> & { state?: string }): OAuthFlow {
  return { ...f, state: f.state ?? randomToken(32), exp: Date.now() + FLOW_TTL_MS };
}

export const flowCookie = (f: OAuthFlow): string => serializeCookie(name(), encryptSecret(JSON.stringify(f), AAD), { maxAge: FLOW_TTL_MS / 1000 });
export const clearFlowCookie = (): string => clearCookie(name());

export function readFlow(req: Request): OAuthFlow | null {
  const raw = parseCookies(req)[name()];
  if (!raw) return null;
  const json = decryptSecret(raw, AAD);
  if (!json) return null;
  try {
    const f = JSON.parse(json) as OAuthFlow;
    return f.exp > Date.now() ? f : null;
  } catch {
    return null;
  }
}

/** Validates the callback `state` against the cookie in constant time. Returns the flow or an error code. */
export function verifyState(req: Request, given: string | null, expected: { provider: OAuthFlow["provider"]; kinds: FlowKind[] }): OAuthFlow | "missing" | "mismatch" {
  const flow = readFlow(req);
  if (!flow || !given) return "missing";
  if (flow.provider !== expected.provider || !expected.kinds.includes(flow.kind)) return "mismatch";
  return safeEqual(flow.state, given) ? flow : "mismatch";
}
