/** SSRF protection for the API-testing proxy. */

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  const mapped = v.startsWith("::ffff:") ? v.slice(7) : v;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Некорректный URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Разрешены только http/https" };
  if (url.username || url.password) return { ok: false, reason: "Учётные данные в URL запрещены" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "Локальные адреса заблокированы" };
  }
  if (isPrivateIp(host)) return { ok: false, reason: "Приватные IP-адреса заблокированы" };
  return { ok: true, url };
}
