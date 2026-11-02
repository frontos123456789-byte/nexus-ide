import { baseUrl } from "./config";

/** 303 redirect to a path inside Nexus (never to a caller-supplied absolute URL), with any number of Set-Cookie headers. */
export function redirectTo(req: Request, path: string, cookies: string[] = []): Response {
  const h = new Headers({ location: `${baseUrl(req)}${path}`, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 303, headers: h });
}

/** Redirect to an external provider page (URL is built by our own code from fixed provider hosts). */
export function redirectExternal(url: string, cookies: string[] = []): Response {
  const h = new Headers({ location: url, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}

export function json(data: unknown, init: { status?: number; cookies?: string[] } = {}): Response {
  const h = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of init.cookies ?? []) h.append("set-cookie", c);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers: h });
}

export const withQuery = (path: string, params: Record<string, string>): string => {
  const [p, q = ""] = path.split("?");
  const u = new URLSearchParams(q);
  for (const [k, v] of Object.entries(params)) u.set(k, v);
  return `${p}?${u.toString()}`;
};
