"use client";

import type { MonitorFilters, MonitorLogs, MonitorOverview, MonitorStatus } from "./types";

/** Browser helpers of the Vercel Monitor. No tokens ever reach the browser: auth is the HttpOnly Nexus session cookie. */

export class MonitorHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly resetAt?: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; code?: string; resetAt?: number };
  if (!r.ok) throw new MonitorHttpError(j.error ?? `HTTP ${r.status}`, r.status, j.code, j.resetAt);
  return j;
}

export const fetchMonitorStatus = (signal?: AbortSignal) => get<MonitorStatus>("/api/monitor/vercel", signal);

export function fetchOverview(o: { filters?: Partial<MonitorFilters>; until?: number | null; limit?: number; projects?: boolean }, signal?: AbortSignal): Promise<MonitorOverview> {
  const q = new URLSearchParams();
  const f = o.filters ?? {};
  if (f.projectId) q.set("projectId", f.projectId);
  if (f.env && f.env !== "all") q.set("env", f.env);
  if (f.status && f.status !== "all") q.set("status", f.status);
  if (o.until) q.set("until", String(o.until));
  q.set("limit", String(o.limit ?? 50));
  q.set("projects", o.projects === false ? "0" : "1");
  return get<MonitorOverview>(`/api/monitor/vercel/overview?${q.toString()}`, signal);
}

export const fetchLogs = (deploymentId: string) => get<MonitorLogs>(`/api/monitor/vercel/logs?deploymentId=${encodeURIComponent(deploymentId)}`);

export async function disconnectMonitor(): Promise<{ note?: string }> {
  const r = await fetch("/api/monitor/vercel", { method: "DELETE", headers: { "x-nexus-csrf": "1" }, credentials: "same-origin" });
  const j = (await r.json().catch(() => ({}))) as { error?: string; note?: string };
  if (!r.ok) throw new MonitorHttpError(j.error ?? `HTTP ${r.status}`, r.status);
  return j;
}

export const connectUrl = (next = "/code?view=vercel") => `/api/integrations/vercel-monitor/start?next=${encodeURIComponent(next)}`;

/* -------- failure-notification bookkeeping (per account, in localStorage; contains only deployment ids) -------- */

interface Seen {
  notified: string[];
  acked: string[];
}
const KEY = (scope: string) => `nexus.vmon.failures.${scope}`;
const CAP = 300;

export function loadSeen(scope: string): Seen | null {
  try {
    const raw = localStorage.getItem(KEY(scope));
    if (!raw) return null;
    const j = JSON.parse(raw) as Seen;
    return { notified: Array.isArray(j.notified) ? j.notified : [], acked: Array.isArray(j.acked) ? j.acked : [] };
  } catch {
    return null;
  }
}

export function saveSeen(scope: string, s: Seen): void {
  try {
    localStorage.setItem(KEY(scope), JSON.stringify({ notified: s.notified.slice(-CAP), acked: s.acked.slice(-CAP) }));
  } catch {
    /* storage unavailable (private mode) – notifications still work for this session */
  }
}
