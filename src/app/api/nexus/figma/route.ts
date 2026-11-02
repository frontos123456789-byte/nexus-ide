import { bad, envToken, rateLimit, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = /^[A-Za-z0-9]{10,64}$/;

async function figma(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.figma.com/v1${path}`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 403) throw new Error("Figma отклонил токен (403)");
  if (res.status === 404) throw new Error("Файл не найден (404)");
  if (!res.ok) throw new Error(`Figma ${res.status}`);
  return res.json();
}

interface FigmaFile {
  name?: string;
  lastModified?: string;
  styles?: Record<string, { name: string; styleType: string; description?: string }>;
  document?: unknown;
}

function collectFills(node: unknown, out: Map<string, string>, depth = 0): void {
  if (!node || typeof node !== "object" || depth > 12 || out.size > 200) return;
  const n = node as { name?: string; fills?: { type: string; color?: { r: number; g: number; b: number } }[]; styles?: Record<string, string>; children?: unknown[] };
  const fill = n.fills?.find((f) => f.type === "SOLID" && f.color);
  if (fill?.color && n.styles?.fill) {
    const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
    out.set(n.styles.fill, `#${hex(fill.color.r)}${hex(fill.color.g)}${hex(fill.color.b)}`);
  }
  for (const c of n.children ?? []) collectFills(c, out, depth + 1);
}

/** Imports components and styles/color tokens from a Figma file. Requires FIGMA_TOKEN on the server. */
export async function GET(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const limited = rateLimit(req, "nexus-figma", 15);
  if (limited) return limited;
  const token = envToken("figma");
  if (!token) return bad("FIGMA_TOKEN не задан на сервере — интеграция недоступна", 503);
  const file = new URL(req.url).searchParams.get("file") ?? "";
  if (!KEY.test(file)) return bad("Укажите file key из URL Figma");
  try {
    const [comps, doc] = await Promise.all([
      figma(`/files/${file}/components`, token) as Promise<{ meta?: { components?: { key: string; name: string; description?: string; containing_frame?: { name?: string } }[] } }>,
      figma(`/files/${file}?depth=4`, token) as Promise<FigmaFile>,
    ]);
    const fills = new Map<string, string>();
    collectFills(doc.document, fills);
    const colors = Object.entries(doc.styles ?? {})
      .filter(([, s]) => s.styleType === "FILL")
      .map(([id, s]) => ({ name: s.name, value: fills.get(id) ?? null }));
    return Response.json({
      name: doc.name,
      lastModified: doc.lastModified,
      components: (comps.meta?.components ?? []).slice(0, 200).map((c) => ({ key: c.key, name: c.name, description: c.description, frame: c.containing_frame?.name })),
      colors,
    });
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Ошибка Figma", 502);
  }
}
