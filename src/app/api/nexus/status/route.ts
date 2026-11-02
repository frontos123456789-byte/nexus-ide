import { FREE_MODEL_CHAIN } from "@/lib/openrouter/models";
import { envToken } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OrModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

let cache: { at: number; models: OrModel[] } | null = null;

async function providerModels(): Promise<OrModel[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.models;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return cache?.models ?? [];
    const j = (await res.json()) as { data?: OrModel[] };
    const ids = new Set(FREE_MODEL_CHAIN.map((m) => m.id));
    const models = (j.data ?? []).filter((m) => ids.has(m.id));
    cache = { at: Date.now(), models };
    return models;
  } catch {
    return cache?.models ?? [];
  }
}

/** Public, secret-free capability report. Only booleans and public model metadata leave the server. */
export async function GET(): Promise<Response> {
  const provider = await providerModels();
  const models = FREE_MODEL_CHAIN.map((m) => {
    const p = provider.find((x) => x.id === m.id);
    return {
      id: m.id,
      label: m.label,
      vendor: m.vendor,
      contextWindow: p?.context_length,
      promptPrice: p?.pricing?.prompt ? Number(p.pricing.prompt) * 1_000_000 : undefined,
      completionPrice: p?.pricing?.completion ? Number(p.pricing.completion) * 1_000_000 : undefined,
    };
  });
  return Response.json({
    features: {
      ai: Boolean(envToken("openrouter")),
      adminKeyConfigured: Boolean(process.env.NEXUS_ADMIN_KEY?.trim()),
      database: Boolean(process.env.NEXUS_DATABASE_URL || process.env.DATABASE_URL),
      github: Boolean(envToken("github")),
      vercel: Boolean(envToken("vercel")),
      figma: Boolean(envToken("figma")),
      docker: process.env.NEXUS_DOCKER === "1",
    },
    production: process.env.NODE_ENV === "production",
    models,
    providerMetadata: provider.length > 0,
    serverTime: Date.now(),
  });
}
