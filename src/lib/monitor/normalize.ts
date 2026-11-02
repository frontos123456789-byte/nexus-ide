import type { DeployEnv, DeployStatus, LogLine, MonitorDeployment, MonitorFilters, MonitorProject } from "./types";

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Vercel state → UI status. DELETED deployments are not part of the monitor (null). */
export function mapState(state: unknown): DeployStatus | null {
  switch (typeof state === "string" ? state.toUpperCase() : "") {
    case "QUEUED":
      return "queued";
    case "INITIALIZING":
    case "BUILDING":
      return "building";
    case "READY":
      return "ready";
    case "ERROR":
      return "error";
    case "CANCELED":
      return "canceled";
    default:
      return null;
  }
}

/** Vercel marks production deployments with target=production; preview deployments have target=null (or "preview"). */
export const mapTarget = (t: unknown): DeployEnv => (t === "production" ? "production" : "preview");

const firstLine = (s: string | null, max = 200) => (s ? s.split("\n")[0]!.trim().slice(0, max) : null);

export function normalizeDeployment(raw: unknown, projectNames: Map<string, string> = new Map()): MonitorDeployment | null {
  const d = obj(raw);
  const id = str(d.uid) ?? str(d.id);
  const status = mapState(d.readyState ?? d.state);
  if (!id || !status) return null;
  const meta = obj(d.meta);
  const projectId = str(d.projectId) ?? "";
  const org = str(meta.githubCommitOrg) ?? str(meta.githubOrg);
  const repoName = str(meta.githubCommitRepo) ?? str(meta.githubRepo);
  const repo = org && repoName ? `${org}/${repoName}` : null;
  const sha = str(meta.githubCommitSha);
  const branch = str(meta.githubCommitRef);
  const msg = str(meta.githubCommitMessage);
  const createdAt = num(d.createdAt) ?? num(d.created) ?? 0;
  const buildingAt = num(d.buildingAt);
  const readyAt = num(d.ready) ?? num(d.readyAt);
  const url = str(d.url);
  return {
    id,
    projectId,
    projectName: projectNames.get(projectId) ?? str(d.name) ?? projectId,
    status,
    rawState: String(d.readyState ?? d.state ?? "").toUpperCase(),
    env: mapTarget(d.target),
    createdAt,
    buildingAt,
    readyAt,
    durationMs: buildingAt && readyAt && readyAt >= buildingAt ? readyAt - buildingAt : null,
    url: url ? `https://${url.replace(/^https?:\/\//, "")}` : null,
    branch,
    commitSha: sha,
    // "Unknown" is what Vercel puts there for deployments without GitHub metadata – do not present it as a real commit.
    commitMessage: msg && msg !== "Unknown" ? firstLine(msg) : null,
    commitAuthor: [str(meta.githubCommitAuthorLogin), str(meta.githubCommitAuthorName)].find((x) => x && x !== "Unknown") ?? null,
    repo,
    commitUrl: repo && sha && /^[0-9a-f]{7,40}$/i.test(sha) ? `https://github.com/${repo}/commit/${sha}` : null,
    branchUrl: repo && branch ? `https://github.com/${repo}/tree/${branch.split("/").map(encodeURIComponent).join("/")}` : null,
    inspectorUrl: safeVercelUrl(str(d.inspectorUrl)),
    errorCode: str(d.errorCode),
    errorMessage: str(d.errorMessage),
  };
}

/** Only links that point to vercel.com are passed through to the UI. */
export function safeVercelUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === "vercel.com" || x.hostname.endsWith(".vercel.com")) ? x.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeProject(raw: unknown): MonitorProject | null {
  const p = obj(raw);
  const id = str(p.id);
  const name = str(p.name);
  if (!id || !name) return null;
  const link = obj(p.link);
  const prod = obj(obj(p.targets).production);
  const aliases = Array.isArray(prod.alias) ? (prod.alias as unknown[]).filter((a): a is string => typeof a === "string") : [];
  const repo = str(link.org) && str(link.repo) ? `${link.org}/${link.repo}` : str(link.repo);
  return {
    id,
    name,
    framework: str(p.framework),
    repo,
    productionBranch: str(link.productionBranch),
    domain: aliases.find((a) => !a.includes("-git-") && !/-[a-z0-9]{6,}-.*projects\.vercel\.app$/.test(a)) ?? aliases[0] ?? null,
    updatedAt: num(p.updatedAt),
    productionStatus: mapState(prod.readyState),
    latestStatus: mapState(obj(Array.isArray(p.latestDeployments) ? p.latestDeployments[0] : null).readyState),
  };
}

export function matchesFilters(d: MonitorDeployment, f: MonitorFilters): boolean {
  return (!f.projectId || d.projectId === f.projectId) && (f.status === "all" || d.status === f.status) && (f.env === "all" || d.env === f.env);
}

/** Merge pages without duplicates, newest first. */
export function mergeDeployments(...lists: MonitorDeployment[][]): MonitorDeployment[] {
  const m = new Map<string, MonitorDeployment>();
  for (const l of lists) for (const d of l) m.set(d.id, d);
  return [...m.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Events API returns either the flat (v3) or the `payload`-wrapped (v2) shape; both are accepted. */
export function normalizeLogs(raw: unknown, max = 250): { lines: LogLine[]; truncated: boolean } {
  const arr = Array.isArray(raw) ? raw : [];
  const lines: LogLine[] = [];
  for (const e of arr) {
    const o = obj(e);
    const payload = obj(o.payload);
    const text = str(o.text) ?? str(payload.text);
    if (!text) continue;
    const type = String(o.type ?? "stdout");
    if (type !== "stdout" && type !== "stderr" && type !== "command" && type !== "fatal") continue;
    lines.push({ ts: num(o.created) ?? num(o.date) ?? num(payload.date) ?? 0, type, text: text.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 600) });
  }
  lines.sort((a, b) => a.ts - b.ts);
  return { lines: lines.slice(-max), truncated: lines.length > max };
}

/**
 * Failure notifications. `known` = ids of failed deployments the user has already been told about (or that existed
 * when the monitor was first opened). Returns the failed deployments that are new.
 */
export function newFailures(deployments: MonitorDeployment[], known: ReadonlySet<string>): MonitorDeployment[] {
  return deployments.filter((d) => d.status === "error" && !known.has(d.id));
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} м ${s % 60} с` : `${Math.floor(m / 60)} ч ${m % 60} м`;
}
