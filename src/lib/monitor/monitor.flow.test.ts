import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Vercel Monitor end to end: REAL PostgreSQL + the real route handlers; Vercel is replaced by a fetch stub that behaves
 * like the documented endpoints. It verifies OUR logic (connect flow, token storage, isolation, read-only guarantees).
 * It does not prove that the owner's registered Vercel integration works – that needs the real credentials.
 */

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const RUN = Math.random().toString(36).slice(2, 8);

async function dbUp(): Promise<boolean> {
  try {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 1500 });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const HAS_DB = await dbUp();

const calls: { method: string; url: URL; auth?: string; body?: string }[] = [];
const jr = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const DEPLOYMENTS = [
  { uid: "dpl_ok", name: "site", projectId: "prj_a", url: "site-a.vercel.app", created: Date.now() - 60_000, readyState: "READY", target: "production", buildingAt: Date.now() - 55_000, ready: Date.now() - 20_000, inspectorUrl: "https://vercel.com/t/site/ok", meta: { githubCommitRef: "main", githubCommitSha: "abcdef1234567", githubCommitMessage: "ship it", githubOrg: "acme", githubRepo: "site" } },
  { uid: "dpl_bad", name: "site", projectId: "prj_a", url: "site-b.vercel.app", created: Date.now() - 30_000, readyState: "ERROR", target: null, inspectorUrl: "https://vercel.com/t/site/bad", errorMessage: "Build failed", meta: { githubCommitRef: "feat/x", githubCommitMessage: "break build" } },
  { uid: "dpl_other", name: "api", projectId: "prj_b", url: "api.vercel.app", created: Date.now() - 10_000, readyState: "BUILDING", target: null, meta: {} },
];

function vercelStub(input: URL | string | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const auth = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
  const body = init?.body ? String(init.body) : undefined;
  calls.push({ method, url, auth, body });
  const p = url.pathname;
  if (p === "/v2/oauth/access_token") {
    const f = new URLSearchParams(body);
    if (f.get("client_id") !== "mon_id" || f.get("client_secret") !== "mon_secret") return Promise.resolve(jr({ error: "bad client" }, 401));
    const code = f.get("code") ?? "";
    if (!code.startsWith("code_")) return Promise.resolve(jr({ error: "invalid_code" }, 400));
    return Promise.resolve(jr({ access_token: `vcp_mon_${code}`, team_id: "team_1", installation_id: `icfg_${code}`, user_id: "u1" }));
  }
  if (p === "/v2/teams/team_1") return Promise.resolve(jr({ name: "Acme Team" }));
  if (!auth?.startsWith("vcp_mon_")) return Promise.resolve(jr({ error: { code: "forbidden", message: "bad token" } }, 403));
  if (p === "/v9/projects") return Promise.resolve(jr({ projects: [{ id: "prj_a", name: "site", framework: "nextjs", targets: { production: { readyState: "READY", alias: ["site.example.com"] } } }, { id: "prj_b", name: "api", latestDeployments: [{ readyState: "BUILDING" }] }], pagination: { next: null } }));
  if (p === "/v6/deployments") {
    const q = url.searchParams;
    let l = DEPLOYMENTS;
    if (q.get("projectId")) l = l.filter((d) => d.projectId === q.get("projectId"));
    if (q.get("target") === "production") l = l.filter((d) => d.target === "production");
    if (q.get("target") === "preview") l = l.filter((d) => d.target !== "production");
    if (q.get("state")) l = l.filter((d) => q.get("state")!.split(",").includes(d.readyState));
    return Promise.resolve(jr({ deployments: l, pagination: { next: null } }));
  }
  if (p === "/v13/deployments/dpl_bad") return Promise.resolve(jr({ inspectorUrl: "https://vercel.com/t/site/bad" }));
  if (p === "/v3/deployments/dpl_bad/events") return Promise.resolve(jr([{ type: "stderr", created: 2, text: "Error: Module not found" }, { type: "stdout", created: 1, text: "Running build" }]));
  return Promise.resolve(jr({ error: { message: `unmocked ${method} ${p}` } }, 599));
}

type Handler = (req: Request) => Promise<Response>;
let H: Record<string, Handler>;
let pool: import("pg").Pool;
let cookieName: () => string;

class Person {
  cookie = "";
  userId = "";
  constructor(readonly name: string) {}
  async init() {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { createSession } = await import("@/lib/auth/session");
    const [u] = await db.insert(users).values({ displayName: `t_${this.name}_${RUN}` }).returning();
    this.userId = u!.id;
    const s = await createSession(u!.id, new Request("https://nexus.test/"));
    this.cookie = s.setCookie.split(";")[0]!;
  }
  req(path: string, init: { method?: string; csrf?: boolean; headers?: Record<string, string>; flowCookie?: string } = {}) {
    const cookie = [this.cookie, init.flowCookie].filter(Boolean).join("; ");
    const headers: Record<string, string> = { host: "nexus.test", cookie, ...(init.headers ?? {}) };
    if (init.method && init.method !== "GET") {
      headers.origin = "https://nexus.test";
      if (init.csrf !== false) headers["x-nexus-csrf"] = "1";
    }
    return new Request(`https://nexus.test${path}`, { method: init.method ?? "GET", headers, redirect: "manual" });
  }
  async connect(code: string) {
    const start = await H.start!(this.req("/api/integrations/vercel-monitor/start"));
    const loc = new URL(start.headers.get("location")!);
    const flowCookie = start.headers.getSetCookie().map((c) => c.split(";")[0]!).join("; ");
    const cb = await H.callback!(this.req(`/api/integrations/vercel-monitor/callback?code=${code}&state=${loc.searchParams.get("state")}&configurationId=icfg_${code}`, { flowCookie }));
    return { start, loc, cb };
  }
}

describe.skipIf(!HAS_DB)("Vercel Monitor – end to end (real Postgres, stubbed Vercel)", () => {
  const alice = new Person("alice");
  const bob = new Person("bob");
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB_URL, NEXUS_BASE_URL: "https://nexus.test", NEXUS_ENCRYPTION_KEY: "monitor-flow-test-key", VERCEL_INTEGRATION_CLIENT_SECRET: "control_secret" });
    delete process.env.VERCEL_MONITOR_CLIENT_ID;
    delete process.env.VERCEL_MONITOR_CLIENT_SECRET;
    delete process.env.VERCEL_MONITOR_SLUG;
    vi.stubGlobal("fetch", vercelStub);
    H = {
      start: (await import("@/app/api/integrations/vercel-monitor/start/route")).GET,
      callback: (await import("@/app/api/integrations/vercel-monitor/callback/route")).GET,
      status: (await import("@/app/api/monitor/vercel/route")).GET,
      disconnect: (await import("@/app/api/monitor/vercel/route")).DELETE,
      overview: (await import("@/app/api/monitor/vercel/overview/route")).GET,
      logs: (await import("@/app/api/monitor/vercel/logs/route")).GET,
      hook: (await import("@/app/api/webhooks/vercel/route")).POST,
    };
    pool = (await import("@/db")).pool;
    cookieName = (await import("@/lib/auth/session")).sessionCookieName;
    await (await import("@/lib/auth/ddl")).ensureSchema();
    await alice.init();
    await bob.init();
  });

  afterAll(async () => {
    vi.stubGlobal("fetch", origFetch);
    if (!pool) return;
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`t\\_%\\_${RUN}`]);
    await pool.query("DELETE FROM integration_audit_logs WHERE actor LIKE $1", [`t\\_%\\_${RUN}`]);
    await pool.end();
  });

  const json = async (r: Response) => (await r.json()) as Record<string, any>;

  it("1. without the owner's integration: honest 'not configured' state with exact setup values, and no install redirect", async () => {
    expect(cookieName()).toBe("__Host-nexus_session");
    const st = await json(await H.status!(alice.req("/api/monitor/vercel")));
    expect(st).toMatchObject({ signedIn: true, connected: false, configured: { integration: false, database: true, encryption: true } });
    expect(st.setup.redirectUrl).toBe("https://nexus.test/api/integrations/vercel-monitor/callback");
    expect(st.setup.envVars).toEqual(["VERCEL_MONITOR_CLIENT_ID", "VERCEL_MONITOR_CLIENT_SECRET", "VERCEL_MONITOR_SLUG"]);
    const start = await H.start!(alice.req("/api/integrations/vercel-monitor/start"));
    expect(start.status).toBe(303);
    expect(start.headers.get("location")).toContain("auth_error=monitor_not_configured");
  });

  it("2. not signed in: status says so; data routes refuse", async () => {
    const anon = new Request("https://nexus.test/api/monitor/vercel", { headers: { host: "nexus.test" } });
    expect(await json(await H.status!(anon))).toMatchObject({ signedIn: false, connected: false });
    const r = await H.overview!(new Request("https://nexus.test/api/monitor/vercel/overview", { headers: { host: "nexus.test" } }));
    expect(r.status).toBe(409);
  });

  it("3. connect via the official integration flow (state-checked), token stored encrypted under vercel_monitor", async () => {
    Object.assign(process.env, { VERCEL_MONITOR_CLIENT_ID: "mon_id", VERCEL_MONITOR_CLIENT_SECRET: "mon_secret", VERCEL_MONITOR_SLUG: "nexus-monitor-test" });
    const ok = await alice.connect("code_alice");
    expect(ok.start.status).toBe(302);
    expect(ok.loc.origin + ok.loc.pathname).toBe("https://vercel.com/integrations/nexus-monitor-test/new");
    expect(ok.cb.status).toBe(303);
    expect(ok.cb.headers.get("location")).toContain("connected=vercel_monitor");

    // a forged callback (wrong state) is rejected
    const forged = await H.callback!(alice.req("/api/integrations/vercel-monitor/callback?code=code_evil&state=forged"));
    expect(forged.headers.get("location")).toContain("auth_error=state_mismatch");

    const row = (await pool.query("SELECT provider, status, access_token_enc, team_id, external_login, metadata FROM connected_providers WHERE user_id=$1", [alice.userId])).rows;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ provider: "vercel_monitor", status: "active", team_id: "team_1", external_login: "Acme Team" });
    expect(row[0].access_token_enc).toMatch(/^v1\./);
    expect(row[0].access_token_enc).not.toContain("vcp_mon_");
    expect(row[0].metadata.readOnly).toBe(true);
    const st = await json(await H.status!(alice.req("/api/monitor/vercel")));
    expect(JSON.stringify(st)).not.toContain("vcp_mon_");
    expect(st).toMatchObject({ connected: true, label: "Acme Team" });
  });

  it("4. overview returns real (stub) projects and Production/Preview deployments with branch/commit/log links", async () => {
    const o = await json(await H.overview!(alice.req("/api/monitor/vercel/overview")));
    expect(o.projects.map((p: { name: string }) => p.name)).toEqual(["api", "site"]);
    const byId = Object.fromEntries(o.deployments.map((d: { id: string }) => [d.id, d]));
    expect(byId.dpl_ok).toMatchObject({ status: "ready", env: "production", branch: "main", commitMessage: "ship it", projectName: "site", commitUrl: "https://github.com/acme/site/commit/abcdef1234567" });
    expect(byId.dpl_bad).toMatchObject({ status: "error", env: "preview", branch: "feat/x", inspectorUrl: "https://vercel.com/t/site/bad", errorMessage: "Build failed" });
    expect(byId.dpl_other).toMatchObject({ status: "building", projectName: "api" });
    const last = calls.filter((c) => c.url.pathname === "/v6/deployments").at(-1)!;
    expect(last.auth).toBe("vcp_mon_code_alice");
    expect(last.url.searchParams.get("teamId")).toBe("team_1");
  });

  it("5. project / status / environment filters work end to end", async () => {
    const q = async (s: string) => (await json(await H.overview!(alice.req(`/api/monitor/vercel/overview?${s}`)))).deployments.map((d: { id: string }) => d.id).sort();
    expect(await q("projectId=prj_b")).toEqual(["dpl_other"]);
    expect(await q("env=production")).toEqual(["dpl_ok"]);
    expect(await q("env=preview")).toEqual(["dpl_bad", "dpl_other"]);
    expect(await q("status=error")).toEqual(["dpl_bad"]);
    expect(await q("status=building&env=preview&projectId=prj_b")).toEqual(["dpl_other"]);
    expect((await H.overview!(alice.req("/api/monitor/vercel/overview?status=exploded"))).status).toBe(400);
    expect((await H.overview!(alice.req("/api/monitor/vercel/overview?projectId=../x"))).status).toBe(400);
  });

  it("6. build logs for a deployment of the connected account", async () => {
    const l = await json(await H.logs!(alice.req("/api/monitor/vercel/logs?deploymentId=dpl_bad")));
    expect(l.lines.map((x: { text: string }) => x.text)).toEqual(["Running build", "Error: Module not found"]);
    expect(l.inspectorUrl).toBe("https://vercel.com/t/site/bad");
    expect((await H.logs!(alice.req("/api/monitor/vercel/logs?deploymentId=a/b"))).status).toBe(400);
  });

  it("7. isolation: another user, the owner's env token and a Control Center connection never give monitor access", async () => {
    expect((await H.overview!(bob.req("/api/monitor/vercel/overview"))).status).toBe(409);
    // owner mode: admin key + env token must NOT unlock the monitor
    Object.assign(process.env, { NEXUS_ADMIN_KEY: "adm", VERCEL_TOKEN: "vcp_owner_token_which_is_long" });
    expect((await H.overview!(bob.req("/api/monitor/vercel/overview", { headers: { "x-nexus-key": "adm" } }))).status).toBe(409);
    // Bob has a Control Center ("vercel") connection only → still no monitor
    const { saveConnection } = await import("@/lib/auth/service");
    await saveConnection({ userId: bob.userId, provider: "vercel", externalId: "icfg_bob", accessToken: "vcp_int_bob", teamId: null });
    expect((await H.overview!(bob.req("/api/monitor/vercel/overview"))).status).toBe(409);
    expect(calls.some((c) => c.auth === "vcp_int_bob" || c.auth === "vcp_owner_token_which_is_long")).toBe(false);
    delete process.env.NEXUS_ADMIN_KEY;
    delete process.env.VERCEL_TOKEN;
  });

  it("8. the monitor never sends a non-GET request to Vercel (apart from the one-time OAuth code exchange)", () => {
    const upstream = calls.filter((c) => c.url.pathname !== "/v2/oauth/access_token");
    expect(upstream.length).toBeGreaterThan(5);
    expect(upstream.every((c) => c.method === "GET" && c.body === undefined)).toBe(true);
  });

  it("9. the monitor routes expose no way to create, change or delete projects/deployments", async () => {
    for (const path of ["@/app/api/monitor/vercel/overview/route", "@/app/api/monitor/vercel/logs/route", "@/app/api/integrations/vercel-monitor/start/route", "@/app/api/integrations/vercel-monitor/callback/route"]) {
      const mod = await import(path);
      const verbs = Object.keys(mod).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k));
      expect(verbs, path).toEqual(["GET"]);
    }
    const status = await import("@/app/api/monitor/vercel/route");
    expect(Object.keys(status).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k)).sort()).toEqual(["DELETE", "GET"]); // DELETE = forget my token inside Nexus
  });

  it("10. a webhook signed with the monitor secret revokes only the monitor connection; forged signatures are refused", async () => {
    const payload = JSON.stringify({ type: "integration-configuration.removed", payload: { configuration: { id: "icfg_code_alice" } } });
    const sign = (secret: string) => createHmac("sha1", secret).update(payload).digest("hex");
    const post = (sig: string) => H.hook!(new Request("https://nexus.test/api/webhooks/vercel", { method: "POST", body: payload, headers: { "x-vercel-signature": sig, host: "nexus.test" } }));
    expect((await post("deadbeef")).status).toBe(401);
    expect((await post(sign("not-the-secret"))).status).toBe(401);
    expect((await post(sign("mon_secret"))).status).toBe(200);
    const st = await json(await H.status!(alice.req("/api/monitor/vercel")));
    expect(st.connected).toBe(false);
    const bobRow = await pool.query("SELECT status FROM connected_providers WHERE user_id=$1 AND provider='vercel'", [bob.userId]);
    expect(bobRow.rows[0].status).toBe("active"); // Control Center connection untouched
  });

  it("11. reconnect, then disconnect (needs CSRF) wipes the token inside Nexus", async () => {
    await alice.connect("code_alice2");
    expect((await json(await H.status!(alice.req("/api/monitor/vercel")))).connected).toBe(true);
    expect((await H.disconnect!(alice.req("/api/monitor/vercel", { method: "DELETE", csrf: false }))).status).toBe(403);
    const del = await H.disconnect!(alice.req("/api/monitor/vercel", { method: "DELETE" }));
    expect(del.status).toBe(200);
    expect((await json(del)).note).toContain("vercel.com/dashboard/integrations");
    const row = await pool.query("SELECT status, access_token_enc FROM connected_providers WHERE user_id=$1 AND provider='vercel_monitor'", [alice.userId]);
    expect(row.rows[0]).toMatchObject({ status: "revoked", access_token_enc: null });
    expect((await H.overview!(alice.req("/api/monitor/vercel/overview"))).status).toBe(409);
  });

  it("12. Vercel revoking the token surfaces as a clear 401 'reconnect' error", async () => {
    await alice.connect("code_alice3");
    vi.stubGlobal("fetch", async (input: URL | string | Request, init?: RequestInit) => {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return u.pathname === "/v9/projects" ? jr({ error: { code: "forbidden", message: "Not authorized" } }, 401) : vercelStub(input, init);
    });
    const r = await H.overview!(alice.req("/api/monitor/vercel/overview"));
    expect(r.status).toBe(401);
    expect((await json(r)).code).toBe("unauthorized");
    vi.stubGlobal("fetch", vercelStub);
  });
});
