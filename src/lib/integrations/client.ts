"use client";

/** Browser-side helper for the integration routes. Tokens never pass through here — auth is an httpOnly cookie. */
export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly resetAt?: number,
  ) {
    super(message);
  }
}

export async function callIntegration<T>(provider: "github" | "vercel" | "telegram", body: Record<string, unknown>): Promise<T> {
  const path = provider === "telegram" ? "/api/telegram" : `/api/integrations/${provider}`;
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-nexus-csrf": "1" }, body: JSON.stringify(body), credentials: "same-origin" });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: string; code?: string; resetAt?: number };
  if (!res.ok) throw new IntegrationError(json.error ?? `HTTP ${res.status}`, res.status, json.code, json.resetAt);
  return json.data as T;
}

export interface ConnState {
  github: { connected: boolean; login?: string; via?: string | null };
  vercel: { connected: boolean; login?: string; teamId?: string; via?: string | null };
  telegram: { connected: boolean; login?: string; via?: string | null };
  owner: boolean;
}

export async function fetchConnections(): Promise<ConnState | null> {
  try {
    const r = await fetch("/api/integrations/session", { credentials: "same-origin" });
    return r.ok ? ((await r.json()) as ConnState) : null;
  } catch {
    return null;
  }
}

export async function connectProvider(provider: "github" | "vercel" | "telegram", token: string, teamId?: string): Promise<{ login: string }> {
  const r = await fetch("/api/integrations/session", { method: "POST", headers: { "content-type": "application/json", "x-nexus-csrf": "1" }, body: JSON.stringify({ provider, token, teamId }), credentials: "same-origin" });
  const j = (await r.json().catch(() => ({}))) as { login?: string; error?: string };
  if (!r.ok) throw new IntegrationError(j.error ?? "Не удалось подключить", r.status);
  return { login: j.login ?? "" };
}

export async function disconnectProvider(provider: "github" | "vercel" | "telegram"): Promise<void> {
  await fetch(`/api/integrations/session?provider=${provider}`, { method: "DELETE", headers: { "x-nexus-csrf": "1" }, credentials: "same-origin" });
}
