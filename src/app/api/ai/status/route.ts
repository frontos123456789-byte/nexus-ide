import { getApiKey } from "@/lib/openrouter/client";
import { FREE_MODEL_CHAIN } from "@/lib/openrouter/models";
import { envToken } from "@/lib/nexus/server/guard";
import { configuredSearchProviders } from "@/lib/web/search";
import { renderServiceConfigured } from "@/lib/web/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability probe for the UI. Never returns secret values — only booleans. */
export async function GET(): Promise<Response> {
  return Response.json({
    ai: Boolean(getApiKey()),
    models: FREE_MODEL_CHAIN.map((m) => ({ id: m.id, label: m.label, vendor: m.vendor })),
    search: configuredSearchProviders().map((p) => ({ id: p.id, keyed: p.keyed, ready: p.ready })),
    jsRendering: renderServiceConfigured(),
    githubOwnerToken: Boolean(envToken("github")) && Boolean(process.env.NEXUS_ADMIN_KEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    sessionSecret: Boolean(process.env.NEXUS_SESSION_SECRET?.trim()),
    githubOAuth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    webhookSecret: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
  });
}
