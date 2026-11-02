import http from "node:http";
import { z } from "zod";
import { bad, rateLimit, readJson, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCKET = process.env.NEXUS_DOCKER_SOCKET || "/var/run/docker.sock";
const ID = /^[\w][\w.-]{0,127}$/;

function docker(method: string, path: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, path, method, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size < 2_000_000) chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function gate(req: Request): Response | null {
  const denied = requireAccess(req);
  if (denied) return denied;
  if (process.env.NEXUS_DOCKER !== "1") {
    return Response.json({ error: "Docker-менеджер выключен: задайте NEXUS_DOCKER=1 и смонтируйте сокет Docker на сервере.", code: "not_configured" }, { status: 503 });
  }
  return null;
}

/** Strips Docker's 8-byte multiplexing headers from log streams. */
function demux(buf: Buffer): string {
  let out = "";
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + len).toString("utf8");
    i += 8 + len;
  }
  return out || buf.toString("utf8");
}

export async function GET(req: Request): Promise<Response> {
  const g = gate(req);
  if (g) return g;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  try {
    if (id) {
      if (!ID.test(id)) return bad("Некорректный id");
      const [logs, info] = await Promise.all([docker("GET", `/containers/${id}/logs?stdout=1&stderr=1&tail=200&timestamps=1`), docker("GET", `/containers/${id}/json`)]);
      const cfg = JSON.parse(info.body.toString("utf8")) as { Config?: { Env?: string[]; Image?: string; Cmd?: string[] }; HostConfig?: { PortBindings?: unknown } };
      return Response.json({
        logs: demux(logs.body),
        config: { image: cfg.Config?.Image, cmd: cfg.Config?.Cmd, ports: cfg.HostConfig?.PortBindings, env: (cfg.Config?.Env ?? []).map((e) => e.split("=")[0]) },
      });
    }
    const list = await docker("GET", "/containers/json?all=1");
    const items = JSON.parse(list.body.toString("utf8")) as { Id: string; Names: string[]; Image: string; State: string; Status: string; Ports: { PrivatePort: number; PublicPort?: number }[] }[];
    return Response.json({ containers: items.map((c) => ({ id: c.Id.slice(0, 12), name: c.Names[0]?.replace(/^\//, ""), image: c.Image, state: c.State, status: c.Status, ports: c.Ports })) });
  } catch (err) {
    return bad(`Docker недоступен: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}

const schema = z.object({ action: z.enum(["start", "stop", "restart"]), id: z.string().regex(ID) });

export async function POST(req: Request): Promise<Response> {
  const g = gate(req);
  if (g) return g;
  const limited = rateLimit(req, "nexus-docker", 20);
  if (limited) return limited;
  const parsed = schema.safeParse(await readJson<unknown>(req, 5000));
  if (!parsed.success) return bad("Ожидается { action, id }");
  try {
    const r = await docker("POST", `/containers/${parsed.data.id}/${parsed.data.action}`);
    if (r.status >= 400 && r.status !== 304) return bad(`Docker вернул ${r.status}: ${r.body.toString("utf8").slice(0, 200)}`, 502);
    return Response.json({ ok: true });
  } catch (err) {
    return bad(`Docker недоступен: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
