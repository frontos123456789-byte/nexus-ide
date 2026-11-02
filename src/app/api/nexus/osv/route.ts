import { z } from "zod";
import { bad, rateLimit, readJson } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  packages: z.array(z.object({ name: z.string().max(214), version: z.string().regex(/^\d+\.\d+\.\d+/) })).min(1).max(150),
});

interface OsvVuln {
  id: string;
  summary?: string;
  severity?: { score?: string }[];
  database_specific?: { severity?: string };
  affected?: { package?: { name?: string }; ranges?: { events?: { fixed?: string }[] }[] }[];
}

/** Looks up known vulnerabilities in the public OSV.dev database (no secrets involved). */
export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "nexus-osv", 10);
  if (limited) return limited;
  const parsed = schema.safeParse(await readJson<unknown>(req, 100_000));
  if (!parsed.success) return bad("Ожидается { packages: [{name, version}] }");
  const pkgs = parsed.data.packages;
  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: pkgs.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return bad(`OSV вернул ${res.status}`, 502);
    const j = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
    const hits: { name: string; version: string; ids: string[] }[] = [];
    (j.results ?? []).forEach((r, i) => {
      const p = pkgs[i];
      if (p && r.vulns?.length) hits.push({ name: p.name, version: p.version, ids: r.vulns.map((v) => v.id).slice(0, 5) });
    });
    const uniq = [...new Set(hits.flatMap((h) => h.ids))].slice(0, 30);
    const details = await Promise.all(
      uniq.map(async (id) => {
        try {
          const r = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
          return r.ok ? ((await r.json()) as OsvVuln) : null;
        } catch {
          return null;
        }
      }),
    );
    const info = new Map(details.filter((d): d is OsvVuln => Boolean(d)).map((d) => [d.id, d]));
    return Response.json({
      checked: pkgs.length,
      source: "osv.dev",
      vulnerabilities: hits.flatMap((h) =>
        h.ids.map((id) => {
          const d = info.get(id);
          const fixed = d?.affected?.flatMap((a) => a.ranges?.flatMap((r) => r.events?.map((e) => e.fixed).filter(Boolean) ?? []) ?? [])[0];
          return { package: h.name, version: h.version, id, summary: d?.summary ?? "—", severity: d?.database_specific?.severity ?? "UNKNOWN", fixedIn: fixed };
        }),
      ),
    });
  } catch (err) {
    return bad(`OSV недоступен: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
