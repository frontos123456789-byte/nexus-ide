/** Shared (server + browser) types of the Vercel Monitor. Contains no secrets. */

export const STATUSES = ["queued", "building", "ready", "error", "canceled"] as const;
export type DeployStatus = (typeof STATUSES)[number];
export type DeployEnv = "production" | "preview";

export interface MonitorProject {
  id: string;
  name: string;
  framework: string | null;
  repo: string | null;
  productionBranch: string | null;
  /** Primary production domain (from Vercel `targets.production.alias`). */
  domain: string | null;
  updatedAt: number | null;
  /** State of the last production deployment / last deployment as reported on the project object. */
  productionStatus: DeployStatus | null;
  latestStatus: DeployStatus | null;
}

export interface MonitorDeployment {
  id: string;
  projectId: string;
  projectName: string;
  status: DeployStatus;
  /** Raw Vercel state (QUEUED, INITIALIZING, BUILDING, READY, ERROR, CANCELED). */
  rawState: string;
  env: DeployEnv;
  createdAt: number;
  buildingAt: number | null;
  readyAt: number | null;
  /** Build duration in ms (readyAt - buildingAt) when known. */
  durationMs: number | null;
  url: string | null;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  commitAuthor: string | null;
  repo: string | null;
  commitUrl: string | null;
  branchUrl: string | null;
  /** Vercel dashboard page of the deployment (contains the full build and runtime logs). */
  inspectorUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface MonitorOverview {
  account: { label: string | null; teamId: string | null };
  projects: MonitorProject[];
  deployments: MonitorDeployment[];
  /** Pass as `until` to fetch older deployments; null when the history is exhausted. */
  nextCursor: number | null;
  fetchedAt: number;
}

export interface MonitorStatus {
  configured: { database: boolean; encryption: boolean; integration: boolean };
  signedIn: boolean;
  connected: boolean;
  label: string | null;
  teamId: string | null;
  connectedAt: number | null;
  /** Where the owner/user can remove the integration on Vercel. */
  vercelManageUrl: string;
  /** Values the Nexus owner must enter when registering the integration (shown only while it is not configured). */
  setup: { redirectUrl: string; webhookUrl: string; envVars: string[] };
}

export interface LogLine {
  ts: number;
  type: string;
  text: string;
}

export interface MonitorLogs {
  deploymentId: string;
  lines: LogLine[];
  truncated: boolean;
  inspectorUrl: string | null;
}

export interface MonitorFilters {
  projectId: string; // "" = all
  status: DeployStatus | "all";
  env: DeployEnv | "all";
}
