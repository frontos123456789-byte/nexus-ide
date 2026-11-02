import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration, mapState, mapTarget, matchesFilters, mergeDeployments, newFailures, normalizeDeployment, normalizeLogs, normalizeProject, safeVercelUrl } from "./normalize";
import { isAllowedReadPath, MonitorApiError, vercelGet } from "./vercel-readonly";
import type { MonitorDeployment } from "./types";

const raw = (o: Record<string, unknown> = {}) => ({
  uid: "dpl_1",
  name: "site",
  projectId: "prj_1",
  url: "site-abc-team.vercel.app",
  created: 1_700_000_000_000,
  state: "READY",
  readyState: "READY",
  target: null,
  buildingAt: 1_700_000_005_000,
  ready: 1_700_000_065_000,
  inspectorUrl: "https://vercel.com/team/site/abc",
  meta: { githubCommitRef: "feat/x", githubCommitSha: "c1aa43e0f3a92d46bb169a620e3497b6c50803c6", githubCommitMessage: "feat: hello\n\nbody", githubCommitAuthorName: "Ann", githubOrg: "acme", githubRepo: "site" },
  ...o,
});

describe("status mapping", () => {
  it("maps every Vercel state to the five UI statuses", () => {
    expect(mapState("QUEUED")).toBe("queued");
    expect(mapState("INITIALIZING")).toBe("building");
    expect(mapState("BUILDING")).toBe("building");
    expect(mapState("READY")).toBe("ready");
    expect(mapState("ERROR")).toBe("error");
    expect(mapState("CANCELED")).toBe("canceled");
    expect(mapState("DELETED")).toBeNull();
    expect(mapState(undefined)).toBeNull();
  });
  it("target null = preview, production = production", () => {
    expect(mapTarget("production")).toBe("production");
    expect(mapTarget(null)).toBe("preview");
    expect(mapTarget("preview")).toBe("preview");
  });
});

describe("normalizeDeployment", () => {
  it("extracts branch, commit, GitHub links, timing and project name", () => {
    const d = normalizeDeployment(raw(), new Map([["prj_1", "My Site"]]))!;
    expect(d).toMatchObject({ id: "dpl_1", projectName: "My Site", status: "ready", env: "preview", branch: "feat/x", commitMessage: "feat: hello", commitAuthor: "Ann", repo: "acme/site", durationMs: 60_000 });
    expect(d.commitUrl).toBe("https://github.com/acme/site/commit/c1aa43e0f3a92d46bb169a620e3497b6c50803c6");
    expect(d.branchUrl).toBe("https://github.com/acme/site/tree/feat/x");
    expect(d.url).toBe("https://site-abc-team.vercel.app");
    expect(d.inspectorUrl).toBe("https://vercel.com/team/site/abc");
  });
  it("does not present Vercel's 'Unknown' placeholders as real data", () => {
    const d = normalizeDeployment(raw({ meta: { githubCommitMessage: "Unknown", githubCommitAuthorName: "Unknown" } }))!;
    expect(d.commitMessage).toBeNull();
    expect(d.commitAuthor).toBeNull();
    expect(d.commitUrl).toBeNull();
  });
  it("drops deployments without id or with a non-monitored state", () => {
    expect(normalizeDeployment({ state: "READY" })).toBeNull();
    expect(normalizeDeployment(raw({ state: "DELETED", readyState: "DELETED" }))).toBeNull();
  });
  it("only passes vercel.com links through", () => {
    expect(safeVercelUrl("https://evil.example/x")).toBeNull();
    expect(safeVercelUrl("javascript:alert(1)")).toBeNull();
    expect(safeVercelUrl("http://vercel.com/x")).toBeNull();
    expect(safeVercelUrl("https://vercel.com/a/b")).toBe("https://vercel.com/a/b");
    expect(normalizeDeployment(raw({ inspectorUrl: "https://evil.example/x" }))!.inspectorUrl).toBeNull();
  });
});

describe("normalizeProject", () => {
  it("reads repo, framework, production domain and status", () => {
    const p = normalizeProject({ id: "prj_1", name: "site", framework: "nextjs", link: { org: "acme", repo: "site", productionBranch: "main" }, targets: { production: { readyState: "ERROR", alias: ["site-git-main-team.vercel.app", "site.example.com"] } }, latestDeployments: [{ readyState: "BUILDING" }] })!;
    expect(p).toMatchObject({ repo: "acme/site", productionBranch: "main", domain: "site.example.com", productionStatus: "error", latestStatus: "building" });
    expect(normalizeProject({ name: "x" })).toBeNull();
  });
});

describe("filters, merge, failures", () => {
  const mk = (id: string, status: MonitorDeployment["status"], env: MonitorDeployment["env"], projectId: string, createdAt: number) => normalizeDeployment(raw({ uid: id, readyState: status.toUpperCase(), target: env === "production" ? "production" : null, projectId, created: createdAt, createdAt }))!;
  const all = [mk("a", "ready", "production", "p1", 3), mk("b", "error", "preview", "p1", 2), mk("c", "error", "production", "p2", 1), mk("d", "building", "preview", "p2", 4)];
  it("filters by project, status and environment together", () => {
    expect(all.filter((d) => matchesFilters(d, { projectId: "", status: "all", env: "all" }))).toHaveLength(4);
    expect(all.filter((d) => matchesFilters(d, { projectId: "p1", status: "all", env: "all" })).map((d) => d.id)).toEqual(["a", "b"]);
    expect(all.filter((d) => matchesFilters(d, { projectId: "", status: "error", env: "production" })).map((d) => d.id)).toEqual(["c"]);
    expect(all.filter((d) => matchesFilters(d, { projectId: "p2", status: "building", env: "preview" })).map((d) => d.id)).toEqual(["d"]);
  });
  it("merges pages without duplicates, newest first, newer data wins", () => {
    const upd = { ...all[0]!, status: "error" as const };
    const m = mergeDeployments(all, [upd]);
    expect(m.map((d) => d.id)).toEqual(["d", "a", "b", "c"]);
    expect(m.find((d) => d.id === "a")!.status).toBe("error");
  });
  it("reports only failed deployments that were not seen before", () => {
    expect(newFailures(all, new Set()).map((d) => d.id).sort()).toEqual(["b", "c"]);
    expect(newFailures(all, new Set(["b"])).map((d) => d.id)).toEqual(["c"]);
    expect(newFailures(all, new Set(["b", "c"]))).toEqual([]);
  });
});

describe("logs and formatting", () => {
  it("accepts both flat (v3) and payload-wrapped (v2) events, strips ANSI, keeps order", () => {
    const { lines } = normalizeLogs([
      { type: "stdout", created: 2, text: "\u001b[31mred\u001b[0m" },
      { type: "stderr", created: 1, payload: { text: "first" } },
      { type: "deployment-state", created: 3, text: "ignored" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["first", "red"]);
    expect(lines[0]!.type).toBe("stderr");
  });
  it("truncates to the last lines", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ type: "stdout", created: i, text: `l${i}` }));
    const r = normalizeLogs(many, 100);
    expect(r.lines).toHaveLength(100);
    expect(r.lines.at(-1)!.text).toBe("l299");
    expect(r.truncated).toBe(true);
  });
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(42_000)).toBe("42 с");
    expect(formatDuration(125_000)).toBe("2 м 5 с");
  });
});

describe("read-only Vercel client", () => {
  const orig = globalThis.fetch;
  afterEach(() => vi.stubGlobal("fetch", orig));

  it("allow-lists read endpoints only: no project/deployment write paths exist", () => {
    for (const ok of ["/v9/projects", "/v6/deployments", "/v13/deployments/dpl_1", "/v3/deployments/dpl_1/events"]) expect(isAllowedReadPath(ok)).toBe(true);
    for (const bad of ["/v10/projects/x/env", "/v13/deployments", "/v12/deployments/dpl_1/cancel", "/v9/projects/x", "/v1/integrations/configuration/x", "/v2/files", "/v9/projects/../x", "/v13/deployments/dpl_1/../../x"]) expect(isAllowedReadPath(bad)).toBe(false);
  });
  it("always issues GET and adds teamId; refuses unknown paths before any network call", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await vercelGet("tok", "team_1", "/v9/projects", { limit: 100, from: undefined });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(url.searchParams.get("teamId")).toBe("team_1");
    expect(url.searchParams.get("limit")).toBe("100");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    await expect(vercelGet("tok", null, "/v12/deployments/dpl_1/cancel")).rejects.toMatchObject({ code: "path_not_allowed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("turns upstream errors into precise, user-facing codes", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "forbidden", message: "Not authorized" } }), { status: 403 }));
    await expect(vercelGet("t", null, "/v6/deployments")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(vercelGet("t", null, "/v6/deployments")).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 429, headers: { "x-ratelimit-reset": "1900000000" } }));
    const e = await vercelGet("t", null, "/v6/deployments").catch((x) => x as MonitorApiError);
    expect(e).toMatchObject({ status: 429, code: "rate_limited", resetAt: 1_900_000_000_000 });
  });
});
