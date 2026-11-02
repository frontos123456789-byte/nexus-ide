/**
 * OAuth / integration configuration, read from the environment only. Nothing here is a secret default:
 * if the owner has not registered the apps with GitHub / Vercel, the corresponding flow reports "not configured".
 */

const env = (k: string): string | undefined => process.env[k]?.trim() || undefined;

/** Test-only switch that lets the provider base URLs point to a local mock. Never honoured in production unless explicitly set. */
const testMode = () => env("NEXUS_TEST_MODE") === "1";

export const urls = {
  githubWeb: () => (testMode() && env("MOCK_GITHUB_WEB")) || "https://github.com",
  githubApi: () => (testMode() && env("MOCK_GITHUB_API")) || "https://api.github.com",
  vercelWeb: () => (testMode() && env("MOCK_VERCEL_WEB")) || "https://vercel.com",
  vercelApi: () => (testMode() && env("MOCK_VERCEL_API")) || "https://api.vercel.com",
};

export function githubConfig() {
  // GitHub App user-authorization and classic OAuth Apps share the same web flow; either credential pair works.
  const clientId = env("GITHUB_OAUTH_CLIENT_ID") ?? env("GITHUB_APP_CLIENT_ID");
  const clientSecret = env("GITHUB_OAUTH_CLIENT_SECRET") ?? env("GITHUB_APP_CLIENT_SECRET");
  const rawKey = env("GITHUB_APP_PRIVATE_KEY");
  const privateKey = rawKey ? (rawKey.includes("BEGIN") ? rawKey.replace(/\\n/g, "\n") : Buffer.from(rawKey, "base64").toString("utf8")) : undefined;
  return {
    oauth: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    /** true when the credentials come from a GitHub App (tokens may expire and carry a refresh token). */
    oauthIsApp: !env("GITHUB_OAUTH_CLIENT_ID"),
    app: Boolean(env("GITHUB_APP_ID") && env("GITHUB_APP_SLUG") && privateKey),
    appId: env("GITHUB_APP_ID"),
    appSlug: env("GITHUB_APP_SLUG"),
    privateKey,
    webhookSecret: env("GITHUB_APP_WEBHOOK_SECRET") ?? env("GITHUB_WEBHOOK_SECRET"),
  };
}

export function vercelConfig() {
  const signInId = env("VERCEL_APP_CLIENT_ID") ?? env("NEXT_PUBLIC_VERCEL_APP_CLIENT_ID");
  const signInSecret = env("VERCEL_APP_CLIENT_SECRET");
  const intId = env("VERCEL_INTEGRATION_CLIENT_ID");
  const intSecret = env("VERCEL_INTEGRATION_CLIENT_SECRET");
  const slug = env("VERCEL_INTEGRATION_SLUG");
  return {
    signIn: Boolean(signInId && signInSecret),
    signInId,
    signInSecret,
    integration: Boolean(intId && intSecret && slug),
    integrationId: intId,
    integrationSecret: intSecret,
    integrationSlug: slug,
  };
}

export function databaseConfigured(): boolean {
  return Boolean(env("DATABASE_URL"));
}

export function isSecureDeployment(): boolean {
  const base = env("NEXUS_BASE_URL");
  if (base) return base.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

/**
 * Public origin used to build OAuth callback URLs. A pinned NEXUS_BASE_URL is preferred, because it cannot be
 * influenced by a forged Host header; otherwise the Vercel production domain, then the request origin.
 */
export function baseUrl(req: Request): string {
  const pinned = env("NEXUS_BASE_URL");
  if (pinned) return pinned.replace(/\/+$/, "");
  const vercel = env("VERCEL_PROJECT_PRODUCTION_URL");
  if (vercel && process.env.NODE_ENV === "production" && env("VERCEL")) return `https://${vercel}`;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : new URL(req.url).protocol.replace(":", ""));
  return `${proto}://${host}`;
}

export const callbackUrl = (req: Request, provider: "github" | "vercel") => `${baseUrl(req)}/api/auth/callback/${provider}`;

export const SESSION_ABSOLUTE_MS = 30 * 24 * 3600_000;
export const SESSION_IDLE_MS = 7 * 24 * 3600_000;
