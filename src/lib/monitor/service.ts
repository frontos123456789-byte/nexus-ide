import { baseUrl, databaseConfigured, vercelMonitorConfig } from "@/lib/auth/config";
import { encryptionAvailable } from "@/lib/auth/crypto";
import { connectionToken, getConnection, revokeConnection, writeAudit } from "@/lib/auth/service";
import { getSession, type SessionContext } from "@/lib/auth/session";
import { normalizeDeployment, normalizeLogs, normalizeProject, safeVercelUrl } from "./normalize";
import type { MonitorDeployment, MonitorLogs, MonitorOverview, MonitorProject, MonitorStatus } from "./types";
import { MonitorApiError, vercelGet } from "./vercel-readonly";

export const MONITOR_PROVIDER = "vercel_monitor" as const;

export interface MonitorCred {
  token: string;
  teamId: string | null;
  label: string | null;
  userId: string;
}

/**
 * Credentials of the Vercel Monitor for THIS request. Only the signed-in user's own `vercel_monitor` connection counts:
 * no owner env token, no legacy cookie, no fallback to the Control Center connection.
 */
export async function monitorCredentials(req: Request, ctx?: SessionContext | null): Promise<MonitorCred | null> {
  const session = ctx === undefined ? await getSession(req) : ctx;
  if (!session) return null;
  const conn = await getConnection(session.user.id, MONITOR_PROVIDER);
  if (!conn) return null;
  const token = connectionToken(conn);
  if (!token) {
    await revokeConnection(session.user.id, MONITOR_PROVIDER);
    throw new MonitorApiError("Токен Vercel не удалось расшифровать — подключите Vercel заново.", 401, "integration_revoked");
  }
  return { token, teamId: conn.teamId ?? null, label: conn.externalLogin ?? null, userId: session.user.id };
}

export async function monitorStatus(req: Request): Promise<MonitorStatus> {
  const configured = { database: databaseConfigured(), encryption: encryptionAvailable(), integration: vercelMonitorConfig().configured };
  const origin = baseUrl(req);
  const base = {
    configured,
    vercelManageUrl: "https://vercel.com/dashboard/integrations",
    setup: { redirectUrl: `${origin}/api/integrations/vercel-monitor/callback`, webhookUrl: `${origin}/api/webhooks/vercel`, envVars: ["VERCEL_MONITOR_CLIENT_ID", "VERCEL_MONITOR_CLIENT_SECRET", "VERCEL_MONITOR_SLUG"] },
  };
  const ctx = await getSession(req);
  if (!ctx) return { ...base, signedIn: false, connected: false, label: null, teamId: null, connectedAt: null };
  const conn = await getConnection(ctx.user.id, MONITOR_PROVIDER);
  return { ...base, signedIn: true, connected: Boolean(conn), label: conn?.externalLogin ?? null, teamId: conn?.teamId ?? null, connectedAt: conn?.connectedAt?.getTime() ?? null };
}

export async function loadProjects(cred: MonitorCred): Promise<MonitorProject[]> {
  const out: MonitorProject[] = [];
  let from: number | undefined;
  for (let page = 0; page < 3; page++) {
    const r = await vercelGet<{ projects?: unknown[]; pagination?: { next?: number | null } }>(cred.token, cred.teamId, "/v9/projects", { limit: 100, from });
    for (const p of r.projects ?? []) {
      const n = normalizeProject(p);
      if (n) out.push(n);
    }
    if (!r.pagination?.next || (r.projects?.length ?? 0) < 100) break;
    from = r.pagination.next;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface OverviewQuery {
  projectId?: string;
  env?: "production" | "preview";
  status?: "queued" | "building" | "ready" | "error" | "canceled";
  until?: number;
  limit: number;
  withProjects: boolean;
  /** project id → name, to label deployments when the project list is not re-fetched. */
  knownProjects?: Map<string, string>;
}

const STATE_FILTER: Record<NonNullable<OverviewQuery["status"]>, string> = {
  queued: "QUEUED",
  building: "BUILDING,INITIALIZING",
  ready: "READY",
  error: "ERROR",
  canceled: "CANCELED",
};

export async function loadOverview(cred: MonitorCred, q: OverviewQuery): Promise<MonitorOverview> {
  const projects = q.withProjects || !q.knownProjects ? await loadProjects(cred) : [];
  const names = new Map<string, string>(q.knownProjects ?? []);
  for (const p of projects) names.set(p.id, p.name);

  const r = await vercelGet<{ deployments?: unknown[]; pagination?: { next?: number | null } }>(cred.token, cred.teamId, "/v6/deployments", {
    limit: q.limit,
    projectId: q.projectId,
    target: q.env,
    state: q.status ? STATE_FILTER[q.status] : undefined,
    until: q.until,
  });
  const deployments = (r.deployments ?? []).map((d) => normalizeDeployment(d, names)).filter((d): d is MonitorDeployment => d !== null);
  // The list endpoint returns the whole team; if Vercel ignored a filter, enforce it here as well.
  const filtered = deployments.filter((d) => (!q.env || d.env === q.env) && (!q.status || d.status === q.status) && (!q.projectId || d.projectId === q.projectId));
  return {
    account: { label: cred.label, teamId: cred.teamId },
    projects,
    deployments: filtered,
    nextCursor: r.pagination?.next ?? null,
    fetchedAt: Date.now(),
  };
}

export async function loadLogs(cred: MonitorCred, deploymentId: string): Promise<MonitorLogs> {
  // The deployment lookup both verifies it belongs to the connected account/team and gives the dashboard link.
  const dep = await vercelGet<{ inspectorUrl?: string }>(cred.token, cred.teamId, `/v13/deployments/${encodeURIComponent(deploymentId)}`);
  const events = await vercelGet<unknown>(cred.token, cred.teamId, `/v3/deployments/${encodeURIComponent(deploymentId)}/events`, { direction: "backward", limit: 400 });
  const { lines, truncated } = normalizeLogs(events);
  return { deploymentId, lines, truncated, inspectorUrl: safeVercelUrl(dep.inspectorUrl ?? null) };
}

export async function disconnectMonitor(ctx: SessionContext): Promise<void> {
  await revokeConnection(ctx.user.id, MONITOR_PROVIDER);
  await writeAudit({ userId: ctx.user.id, provider: MONITOR_PROVIDER, actor: ctx.user.displayName, action: "vercel_monitor:disconnect" });
}
