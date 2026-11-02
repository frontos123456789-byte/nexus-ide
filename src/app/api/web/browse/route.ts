import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { detectInjection } from "@/lib/web/inject";
import { browse, renderServiceConfigured } from "@/lib/web/research";
import { WebFetchError } from "@/lib/web/safe-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  url: z.string().url().max(2000),
  render: z.boolean().optional(),
  maxChars: z.number().int().min(500).max(30_000).optional(),
});

/** Server-side web page reader: redirects, timeout, SSRF protection, content extraction + links. */
export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "web-browse", 30);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос: нужен url" }, { status: 400 });
  try {
    const page = await browse(parsed.data.url, { render: parsed.data.render, maxChars: parsed.data.maxChars, signal: req.signal });
    return Response.json({ ...page, injectionWarnings: detectInjection(page.text) });
  } catch (e) {
    if (e instanceof WebFetchError) {
      const status = e.code === "blocked" ? 403 : e.code === "timeout" ? 504 : 502;
      return Response.json({ error: e.message, code: e.code }, { status });
    }
    return Response.json({ error: "Не удалось открыть страницу" }, { status: 502 });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({
    tool: "web-browse",
    engine: "http-fetch+html-extraction",
    jsRendering: renderServiceConfigured() ? "browserless" : "not-configured",
    note: "Обычный HTTP-запрос не является полноценным браузером: сайты, рендерящиеся JavaScript'ом, требуют BROWSERLESS_URL и BROWSERLESS_TOKEN.",
  });
}
