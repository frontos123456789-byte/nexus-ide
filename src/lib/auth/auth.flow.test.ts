import { createHmac, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * End-to-end flow against a REAL PostgreSQL with the route handlers called directly. GitHub and Vercel are replaced by a
 * fetch stub that behaves like the documented endpoints. This verifies OUR callback / session / isolation logic –
 * it does NOT prove that a real GitHub/Vercel OAuth app works (that needs the owner's registered credentials).
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

/* ----------------------------- provider stub ----------------------------- */

const calls: { method: string; url: string; auth?: string; body?: string }[] = [];
let vercelNonce = "";
const SECRET_PATTERNS = [/gho_/, /ghs_/, /vcp_int_/, /vcp_login_/];

const people: Record<string, { gh: { id: string; login: string; inst: number }; vc: { id: string; login: string } }> = {
  alice: { gh: { id: `${RUN}-gh-a`, login: `t_alice_${RUN}`, inst: 555001 }, vc: { id: `${RUN}-vc-a`, login: `t_alice_vc_${RUN}` } },
  bob: { gh: { id: `${RUN}-gh-b`, login: `t_bob_${RUN}`, inst: 777001 }, vc: { id: `${RUN}-vc-b`, login: `t_bob_vc_${RUN}` } },
  carol: { gh: { id: `${RUN}-gh-c`, login: `t_carol_${RUN}`, inst: 0 }, vc: { id: `${RUN}-vc-c`, login: `t_carol_vc_${RUN}` } }, // never installs the GitHub App
};
const byGhToken = (t: string) => Object.values(people).find((p) => `gho_${p.gh.login}` === t);
const byInstToken = (t: string) => Object.entries(people).find(([, p]) => t.startsWith(`ghs_inst${p.gh.inst}`));
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function providerFetch(input: URL | string | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  const auth = headers.get("authorization")?.replace(/^Bearer /, "");
  const body = init?.body ? String(init.body) : undefined;
  calls.push({ method, url: url.toString(), auth, body });
  const path = url.pathname;

  if (url.hostname === "github.com" && path === "/login/oauth/access_token") {
    const code = new URLSearchParams(body).get("code") ?? "";
    const who = people[code];
    if (!who) return Promise.resolve(j({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }));
    return Promise.resolve(j({ access_token: `gho_${who.gh.login}`, scope: "", token_type: "bearer" }));
  }
  if (url.hostname === "api.github.com") {
    if (path === "/user") {
      const p = byGhToken(auth ?? "");
      return Promise.resolve(p ? j({ id: p.gh.id, login: p.gh.login, name: `Name ${p.gh.login}`, avatar_url: "https://avatars.test/x.png", email: "same@example.com" }) : j({ message: "Bad credentials" }, 401));
    }
    if (path === "/user/installations") {
      const p = byGhToken(auth ?? "");
      if (!p) return Promise.resolve(j({ message: "Bad credentials" }, 401));
      return Promise.resolve(j({ installations: !p.gh.inst ? [] : [{ id: p.gh.inst, app_id: 42, account: { login: p.gh.login, id: 1, type: "User", avatar_url: "https://avatars.test/x.png" }, repository_selection: "selected", permissions: { contents: "write", metadata: "read" }, suspended_at: null }, { id: 999, app_id: 7, account: { login: "other-app", id: 2, type: "User" }, repository_selection: "all", permissions: {}, suspended_at: null }] }));
    }
    const tokMatch = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (tokMatch && method === "POST") {
      const sel = body ? (JSON.parse(body) as { repositories?: string[] }).repositories : undefined;
      return Promise.resolve(j({ token: `ghs_inst${tokMatch[1]}${sel ? `_sel_${sel.join("+")}` : ""}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }));
    }
    if (path === "/installation/repositories") {
      const owner = byInstToken(auth ?? "");
      if (!owner) return Promise.resolve(j({ message: "Bad credentials" }, 401));
      const login = owner[1].gh.login;
      const sel = auth!.includes("_sel_") ? auth!.split("_sel_")[1]!.split("+") : null;
      const all = ["one", "two"].map((n) => ({ full_name: `${login}/${n}`, private: true, default_branch: "main", updated_at: "2026-01-01T00:00:00Z", html_url: `https://github.com/${login}/${n}`, description: null, id: n === "one" ? 1 : 2, permissions: { push: true } }));
      return Promise.resolve(j({ repositories: sel ? all.filter((r) => sel.includes(r.full_name.split("/")[1]!)) : all }));
    }
    const contents = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/?$/);
    if (contents) {
      const owner = byInstToken(auth ?? "");
      if (!owner || owner[1].gh.login !== contents[1]) return Promise.resolve(j({ message: "Not Found" }, 404));
      return Promise.resolve(j([{ name: "README.md", path: "README.md", type: "file", size: 5 }]));
    }
  }
  if (url.hostname === "vercel.com" || url.hostname === "api.vercel.com") {
    if (path === "/login/oauth/token") {
      const code = new URLSearchParams(body).get("code") ?? "";
      const who = Object.values(people).find((p) => p.vc.id === code);
      if (!who) return Promise.resolve(j({ error: "invalid_grant" }, 400));
      const idToken = `h.${Buffer.from(JSON.stringify({ aud: "vc_app", nonce: vercelNonce, exp: Math.floor(Date.now() / 1000) + 600, sub: who.vc.id })).toString("base64url")}.s`;
      return Promise.resolve(j({ access_token: `vcp_login_${who.vc.id}`, id_token: idToken, refresh_token: "r", expires_in: 3600 }));
    }
    if (path === "/login/oauth/userinfo") {
      const who = Object.values(people).find((p) => `vcp_login_${p.vc.id}` === auth);
      return Promise.resolve(who ? j({ sub: who.vc.id, name: who.vc.login, preferred_username: who.vc.login, picture: "https://p.test/p.png", email: "same@example.com" }) : j({}, 401));
    }
    if (path === "/v2/oauth/access_token") {
      const code = new URLSearchParams(body).get("code") ?? "";
      if (!people[code]) return Promise.resolve(j({ error: "invalid_code" }, 400));
      return Promise.resolve(j({ access_token: `vcp_int_${code}`, team_id: null, installation_id: `icfg_${code}`, user_id: `u_${code}` }));
    }
    if (path === "/v2/user") return Promise.resolve(j({ user: { username: `vc_${auth}` } }));
    if (path === "/v2/teams") return Promise.resolve(j({ teams: [] }));
    if (path === "/v9/projects" || path.startsWith("/v9/projects")) {
      const owner = auth?.replace("vcp_int_", "");
      return Promise.resolve(j({ projects: [{ id: `prj_${owner}`, name: `${owner}-site`, framework: "nextjs", updatedAt: 1, latestDeployments: [] }] }));
    }
    if (path.startsWith("/v1/integrations/configuration/") && method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.resolve(j({ message: `unmocked ${method} ${url}` }, 599));
}

/* ----------------------------- tiny browser ----------------------------- */

class Browser {
  jar = new Map<string, string>();
  constructor(private origin = "https://nexus.test") {}
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair = "", ...attrs] = sc.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0/i.test(a)) || value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  req(path: string, init: { method?: string; body?: unknown; csrf?: boolean; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { host: "nexus.test", cookie: this.cookieHeader(), "user-agent": "vitest", ...(init.headers ?? {}) };
    if (init.method && init.method !== "GET") {
      headers.origin ??= this.origin;
      if (init.csrf !== false) headers["x-nexus-csrf"] = "1";
      if (init.body !== undefined) headers["content-type"] = "application/json";
    }
    return new Request(`${this.origin}${path}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, redirect: "manual" });
  }
}

type Handler = (req: Request, ctx?: { params: Promise<{ provider: string }> }) => Promise<Response>;
let H: Record<string, Handler>;
let sessionCookie: () => string;
let pool: import("pg").Pool;

async function call(b: Browser, h: string, path: string, init: Parameters<Browser["req"]>[1] = {}, provider?: string) {
  const res = await H[h]!(b.req(path, init), provider ? { params: Promise.resolve({ provider }) } : undefined);
  b.absorb(res);
  return res;
}
const loc = (r: Response) => new URL(r.headers.get("location") ?? "http://none");
const body = async (r: Response) => (await r.json()) as Record<string, any>;

async function login(b: Browser, provider: "github" | "vercel", code: string, intent: "login" | "link" = "login", next = "/") {
  const start = await call(b, "loginStart", `/api/auth/login/${provider}?intent=${intent}&next=${encodeURIComponent(next)}`, {}, provider);
  expect(start.status).toBe(302);
  const authorize = loc(start);
  vercelNonce = authorize.searchParams.get("nonce") ?? vercelNonce;
  const state = authorize.searchParams.get("state") ?? "";
  return { start, authorize, state, finish: (st = state, c = code) => call(b, "loginCallback", `/api/auth/callback/${provider}?code=${encodeURIComponent(c)}&state=${encodeURIComponent(st)}`, {}, provider) };
}

const countUsersFor = async (provider: string, pid: string) => (await pool.query("SELECT count(DISTINCT user_id)::int AS n FROM accounts WHERE provider=$1 AND provider_account_id=$2", [provider, pid])).rows[0].n as number;

describe.skipIf(!HAS_DB)("account system – end to end (real Postgres, stubbed providers)", () => {
  const alice = new Browser();
  const bob = new Browser();
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    Object.assign(process.env, {
      DATABASE_URL: DB_URL,
      NEXUS_BASE_URL: "https://nexus.test",
      NEXUS_ENCRYPTION_KEY: "flow-test-key",
      GITHUB_OAUTH_CLIENT_ID: "gh_client",
      GITHUB_OAUTH_CLIENT_SECRET: "gh_secret",
      GITHUB_APP_ID: "42",
      GITHUB_APP_SLUG: "nexus-test",
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"),
      GITHUB_APP_WEBHOOK_SECRET: "gh-hook-secret",
      VERCEL_APP_CLIENT_ID: "vc_app",
      VERCEL_APP_CLIENT_SECRET: "vc_secret",
      VERCEL_INTEGRATION_CLIENT_ID: "vc_int",
      VERCEL_INTEGRATION_CLIENT_SECRET: "vc_int_secret",
      VERCEL_INTEGRATION_SLUG: "nexus-test",
    });
    vi.stubGlobal("fetch", providerFetch);
    H = {
      loginStart: (await import("@/app/api/auth/login/[provider]/route")).GET as Handler,
      loginCallback: (await import("@/app/api/auth/callback/[provider]/route")).GET as Handler,
      session: (await import("@/app/api/auth/session/route")).GET as Handler,
      logout: (await import("@/app/api/auth/logout/route")).POST as Handler,
      unlink: (await import("@/app/api/auth/unlink/route")).POST as Handler,
      ghInstall: (await import("@/app/api/integrations/github/install/route")).GET as Handler,
      ghCallback: (await import("@/app/api/integrations/github/callback/route")).GET as Handler,
      vcStart: (await import("@/app/api/integrations/vercel/start/route")).GET as Handler,
      vcCallback: (await import("@/app/api/integrations/vercel/callback/route")).GET as Handler,
      conns: (await import("@/app/api/integrations/connections/route")).POST as Handler,
      connsDel: (await import("@/app/api/integrations/connections/route")).DELETE as Handler,
      gh: (await import("@/app/api/integrations/github/route")).POST as Handler,
      vc: (await import("@/app/api/integrations/vercel/route")).POST as Handler,
      ghHook: (await import("@/app/api/webhooks/github/route")).POST as Handler,
      vcHook: (await import("@/app/api/webhooks/vercel/route")).POST as Handler,
      legacySession: (await import("@/app/api/integrations/session/route")).GET as Handler,
    };
    sessionCookie = (await import("./session")).sessionCookieName as () => string;
    pool = (await import("@/db")).pool;
    await (await import("./ddl")).ensureSchema();
  });

  afterAll(async () => {
    vi.stubGlobal("fetch", origFetch);
    if (!pool) return;
    await pool.query("DELETE FROM users WHERE id IN (SELECT user_id FROM accounts WHERE provider_account_id LIKE $1)", [`${RUN}-%`]);
    await pool.query("DELETE FROM integration_audit_logs WHERE actor LIKE $1 OR target LIKE $2", [`t\\_%\\_${RUN}%`, `%${RUN}%`]);
    await pool.end();
  });

  it("1. GitHub login: official redirect with state + PKCE S256; first login creates exactly one user", async () => {
    const f = await login(alice, "github", "alice");
    expect(f.authorize.origin + f.authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(f.authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(f.authorize.searchParams.get("code_challenge")?.length).toBeGreaterThan(30);
    expect(f.authorize.searchParams.get("redirect_uri")).toBe("https://nexus.test/api/auth/callback/github");
    expect(f.state.length).toBeGreaterThan(30);
    const startCookie = f.start.headers.getSetCookie().join(";");
    expect(startCookie).toMatch(/HttpOnly/);
    expect(startCookie).toMatch(/SameSite=Lax/);
    expect(startCookie).toMatch(/Secure/);
    const cb = await f.finish();
    expect(cb.status).toBe(303);
    expect(loc(cb).pathname).toBe("/");
    expect(alice.jar.has(sessionCookie())).toBe(true);
    const sc = cb.headers.getSetCookie().find((c) => c.startsWith(sessionCookie()))!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/Secure/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Path=\//);
    expect(await countUsersFor("github", people.alice!.gh.id)).toBe(1);
    const tokens = (await pool.query("SELECT access_token_enc FROM accounts WHERE provider_account_id=$1", [people.alice!.gh.id])).rows[0].access_token_enc as string;
    expect(tokens.startsWith("v1.")).toBe(true);
    expect(tokens).not.toContain("gho_");
  });

  it("2. state CSRF: forged / missing state is rejected and creates no session", async () => {
    const b = new Browser();
    const f = await login(b, "github", "alice");
    const bad = await f.finish("forged-state");
    expect(loc(bad).pathname).toBe("/login");
    expect(loc(bad).searchParams.get("error")).toBe("state_mismatch");
    expect(b.jar.has(sessionCookie())).toBe(false);
    // callback with no flow cookie at all (attacker-initiated link sent to the victim)
    const fresh = new Browser();
    const r = await call(fresh, "loginCallback", `/api/auth/callback/github?code=alice&state=${f.state}`, {}, "github");
    expect(loc(r).searchParams.get("error")).toBe("state_mismatch");
    expect(fresh.jar.has(sessionCookie())).toBe(false);
  });

  it("3. re-login from another device reuses the same user (no duplicates), even with the same e-mail", async () => {
    const other = new Browser();
    const f = await login(other, "github", "alice");
    await f.finish();
    expect(other.jar.has(sessionCookie())).toBe(true);
    expect(await countUsersFor("github", people.alice!.gh.id)).toBe(1);
    const a = await body(await call(alice, "session", "/api/auth/session"));
    const o = await body(await call(other, "session", "/api/auth/session"));
    expect(a.user.id).toBe(o.user.id);
  });

  it("4. session persists, exposes no secrets; legacy status reports signedIn", async () => {
    const res = await call(alice, "session", "/api/auth/session");
    const text = JSON.stringify(await res.clone().json());
    for (const p of SECRET_PATTERNS) expect(text).not.toMatch(p);
    const s = await body(res);
    expect(s.user.name).toContain(`Name t_alice_${RUN}`);
    expect(s.user.identities[0].provider).toBe("github");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const legacy = await body(await call(alice, "legacySession", "/api/integrations/session"));
    expect(legacy.signedIn).toBe(true);
  });

  it("5. cancel on the consent screen → friendly 'cancelled', nothing created", async () => {
    const b = new Browser();
    const f = await login(b, "github", "alice");
    const r = await call(b, "loginCallback", `/api/auth/callback/github?error=access_denied&state=${f.state}`, {}, "github");
    expect(loc(r).searchParams.get("error")).toBe("cancelled");
    expect(b.jar.has(sessionCookie())).toBe(false);
  });

  it("6. provider failure (bad code) is reported, no session", async () => {
    const b = new Browser();
    const f = await login(b, "github", "alice");
    const r = await f.finish(f.state, "totally-wrong");
    expect(loc(r).searchParams.get("error")).toBe("provider_error");
    expect(b.jar.has(sessionCookie())).toBe(false);
  });

  it("7. GitHub App install: ownership is verified server-side; foreign installation ids are refused", async () => {
    const inst = await call(alice, "ghInstall", "/api/integrations/github/install");
    const u = loc(inst);
    expect(u.origin + u.pathname).toBe("https://github.com/apps/nexus-test/installations/new");
    const state = u.searchParams.get("state")!;
    // tampered installation id (Bob's) with Alice's valid state
    const bad = await call(alice, "ghCallback", `/api/integrations/github/callback?installation_id=${people.bob!.gh.inst}&setup_action=install&state=${state}`);
    expect(loc(bad).searchParams.get("auth_error")).toBe("installation_not_owned");
    // state replay after failure is impossible (cookie cleared) …
    const inst2 = await call(alice, "ghInstall", "/api/integrations/github/install");
    const state2 = loc(inst2).searchParams.get("state")!;
    const ok = await call(alice, "ghCallback", `/api/integrations/github/callback?installation_id=${people.alice!.gh.inst}&setup_action=install&state=${state2}`);
    expect(loc(ok).searchParams.get("connected")).toBe("github");
    const s = await body(await call(alice, "session", "/api/auth/session"));
    expect(s.github.connected).toBe(true);
    expect(s.github.login).toBe(people.alice!.gh.login);
    expect(s.github.permissions.contents).toBe("write");
    // wrong state
    const inst3 = await call(alice, "ghInstall", "/api/integrations/github/install");
    void inst3;
    const wrong = await call(alice, "ghCallback", `/api/integrations/github/callback?installation_id=${people.alice!.gh.inst}&setup_action=install&state=nope`);
    expect(loc(wrong).searchParams.get("auth_error")).toBe("state_mismatch");
  });

  it("8. GitHub API through the installation: short-lived server-side token, repo allow-list enforced", async () => {
    const list = await body(await call(alice, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } }));
    expect((list.data as { full_name: string }[]).map((r) => r.full_name)).toEqual([`${people.alice!.gh.login}/one`, `${people.alice!.gh.login}/two`]);
    expect(calls.some((c) => c.url.endsWith("/app/installations/555001/access_tokens") && c.method === "POST" && c.auth?.split(".").length === 3)).toBe(true); // App JWT used to mint
    // narrow to one repo
    const sel = await call(alice, "conns", "/api/integrations/connections", { method: "POST", body: { action: "setRepoSelection", mode: "selected", repos: [`${people.alice!.gh.login}/one`] } });
    expect(sel.status).toBe(200);
    expect((await body(sel)).github.selectedRepos).toEqual([`${people.alice!.gh.login}/one`]);
    const allowed = await call(alice, "gh", "/api/integrations/github", { method: "POST", body: { action: "contents", repo: `${people.alice!.gh.login}/one`, path: "" } });
    expect(allowed.status).toBe(200);
    const denied = await call(alice, "gh", "/api/integrations/github", { method: "POST", body: { action: "contents", repo: `${people.alice!.gh.login}/two`, path: "" } });
    expect(denied.status).toBe(403);
    expect((await body(denied)).code).toBe("repo_not_allowed");
    // down-scoped token was requested from GitHub
    expect(calls.some((c) => c.url.endsWith("/access_tokens") && c.body?.includes('"repositories":["one"]'))).toBe(true);
    // selecting a repo that is not in the installation is refused
    const foreign = await call(alice, "conns", "/api/integrations/connections", { method: "POST", body: { action: "setRepoSelection", mode: "selected", repos: ["someone/else"] } });
    expect(foreign.status).toBe(400);
  });

  it("9. CSRF: state-changing endpoints reject requests without the header / with a foreign Origin", async () => {
    const noHeader = await call(alice, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" }, csrf: false });
    expect(noHeader.status).toBe(403);
    const foreign = await call(alice, "logout", "/api/auth/logout", { method: "POST", headers: { origin: "https://evil.test" } });
    expect(foreign.status).toBe(403);
    expect((await body(await call(alice, "session", "/api/auth/session"))).user).not.toBeNull();
  });

  it("10. isolation: Bob has his own data and can never see or use Alice's connection", async () => {
    const f = await login(bob, "github", "bob");
    await f.finish();
    // Bob's own installation was auto-connected at sign-in (verified with HIS token). He must get HIS repos – never Alice's.
    const first = await body(await call(bob, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } }));
    expect((first.data as { full_name: string }[]).length).toBeGreaterThan(0);
    expect((first.data as { full_name: string }[]).every((r) => r.full_name.startsWith(people.bob!.gh.login))).toBe(true);
    // A user who never installed the app is simply "not connected" (no fallback to anybody else's token)
    const carol = new Browser();
    await (await login(carol, "github", "carol")).finish();
    const none = await call(carol, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } });
    expect(none.status).toBe(401);
    expect((await body(none)).code).toBe("not_connected");
    const i = await call(bob, "ghInstall", "/api/integrations/github/install");
    const st = loc(i).searchParams.get("state")!;
    // Bob tries to claim Alice's installation
    const steal = await call(bob, "ghCallback", `/api/integrations/github/callback?installation_id=${people.alice!.gh.inst}&setup_action=install&state=${st}`);
    expect(loc(steal).searchParams.get("auth_error")).toBe("installation_not_owned");
    const i2 = await call(bob, "ghInstall", "/api/integrations/github/install");
    const ok = await call(bob, "ghCallback", `/api/integrations/github/callback?installation_id=${people.bob!.gh.inst}&setup_action=install&state=${loc(i2).searchParams.get("state")}`);
    expect(loc(ok).searchParams.get("connected")).toBe("github");
    const bobRepos = await body(await call(bob, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } }));
    expect((bobRepos.data as { full_name: string }[]).every((r) => r.full_name.startsWith(people.bob!.gh.login))).toBe(true);
    const peek = await call(bob, "gh", "/api/integrations/github", { method: "POST", body: { action: "contents", repo: `${people.alice!.gh.login}/one`, path: "" } });
    expect(peek.status).toBe(404);
    const bs = await body(await call(bob, "session", "/api/auth/session"));
    const as = await body(await call(alice, "session", "/api/auth/session"));
    expect(bs.github.installationId).not.toBe(as.github.installationId);
    expect(bs.github.selectedRepos).toEqual([]);
    // anonymous caller gets nothing
    const anon = new Browser();
    expect((await call(anon, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } })).status).toBe(401);
    expect((await body(await call(anon, "session", "/api/auth/session"))).user).toBeNull();
  });

  it("11. linking Vercel needs the verified session; identity owned by someone else cannot be taken over", async () => {
    // anonymous link attempt
    const anon = new Browser();
    const a = await call(anon, "loginStart", "/api/auth/login/vercel?intent=link", {}, "vercel");
    expect(loc(a).searchParams.get("auth_error")).toBe("session_required");
    // Alice links her Vercel identity
    const f = await login(alice, "vercel", people.alice!.vc.id, "link", "/?settings=account");
    expect(f.authorize.origin + f.authorize.pathname).toBe("https://vercel.com/oauth/authorize");
    expect(f.authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(f.authorize.searchParams.get("nonce")).toBeTruthy();
    const done = await f.finish();
    expect(loc(done).searchParams.get("linked")).toBe("vercel");
    const s = await body(await call(alice, "session", "/api/auth/session"));
    expect(s.user.identities.map((x: { provider: string }) => x.provider).sort()).toEqual(["github", "vercel"]);
    // Bob (signed in) tries to link ALICE's Vercel identity → refused, nothing moves
    const g = await login(bob, "vercel", people.alice!.vc.id, "link");
    const deny = await g.finish();
    expect(loc(deny).searchParams.get("auth_error")).toBe("already_linked_elsewhere");
    expect(await countUsersFor("vercel", people.alice!.vc.id)).toBe(1);
    expect((await body(await call(bob, "session", "/api/auth/session"))).user.identities).toHaveLength(1);
    // Fresh browser logging in with the linked Vercel identity lands in Alice's account (no duplicate user)
    const c = new Browser();
    const lf = await login(c, "vercel", people.alice!.vc.id);
    await lf.finish();
    expect((await body(await call(c, "session", "/api/auth/session"))).user.id).toBe(s.user.id);
    // same e-mail on a different identity does NOT merge
    const d = new Browser();
    const df = await login(d, "vercel", people.bob!.vc.id);
    await df.finish();
    const ds = await body(await call(d, "session", "/api/auth/session"));
    expect(ds.user.id).not.toBe(s.user.id);
    const bobUser = (await body(await call(bob, "session", "/api/auth/session"))).user.id;
    expect(ds.user.id).not.toBe(bobUser);
  });

  it("12. link callback is bound to the session that started it", async () => {
    const e = new Browser();
    const ef = await login(e, "github", "bob"); // Bob's GitHub identity in a throwaway browser = Bob's user
    await ef.finish();
    const start = await login(alice, "vercel", people.bob!.vc.id, "link");
    const hijack = new Browser();
    hijack.jar = new Map(e.jar); // someone else's session…
    for (const [k, v] of alice.jar) if (k.includes("oauth")) hijack.jar.set(k, v); // …with Alice's flow cookie
    const r = await call(hijack, "loginCallback", `/api/auth/callback/vercel?code=${people.bob!.vc.id}&state=${start.state}`, {}, "vercel");
    expect(loc(r).searchParams.get("auth_error")).toBe("session_changed");
  });

  it("13. Vercel Integration: install flow, own projects only, env policy, dangerous ops need confirmation", async () => {
    const st = await call(alice, "vcStart", "/api/integrations/vercel/start?popup=1");
    const u = loc(st);
    expect(u.origin + u.pathname).toBe("https://vercel.com/integrations/nexus-test/new");
    const state = u.searchParams.get("state")!;
    const bad = await call(alice, "vcCallback", `/api/integrations/vercel/callback?code=alice&configurationId=icfg_a_${RUN}&state=wrong`);
    expect(loc(bad).searchParams.get("auth_error")).toBe("state_mismatch");
    const st2 = await call(alice, "vcStart", "/api/integrations/vercel/start?popup=1");
    const state2 = loc(st2).searchParams.get("state")!;
    void state;
    const ok = await call(alice, "vcCallback", `/api/integrations/vercel/callback?code=alice&configurationId=icfg_a_${RUN}&state=${state2}&next=${encodeURIComponent("https://vercel.com/done")}`);
    expect(ok.headers.get("location")).toBe("https://vercel.com/done"); // popup mode returns to Vercel's own URL
    const evil = await call(alice, "vcStart", "/api/integrations/vercel/start?popup=1");
    const evilState = loc(evil).searchParams.get("state")!;
    const refused = await call(alice, "vcCallback", `/api/integrations/vercel/callback?code=alice&configurationId=icfg_a_${RUN}&state=${evilState}&next=${encodeURIComponent("https://evil.test/")}`);
    expect(loc(refused).origin).toBe("https://nexus.test"); // arbitrary `next` is never followed
    const enc = (await pool.query("SELECT access_token_enc FROM connected_providers WHERE external_id='icfg_a_'||$1", [RUN])).rows[0].access_token_enc as string;
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain("vcp_int");

    const projects = await call(alice, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "projects" } });
    const pj = await body(projects);
    expect(JSON.stringify(pj)).not.toMatch(/vcp_int_/);
    expect((pj.data as { name: string }[])[0]!.name).toBe("alice-site");
    // Bob has no Vercel connection → cannot reach Alice's projects
    expect((await call(bob, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "projects" } })).status).toBe(401);
    // env policy
    const reserved = await call(alice, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "envAdd", projectId: "prj_alice", key: "VERCEL_TOKEN", value: "x", target: ["preview"], confirm: true } });
    expect((await body(reserved)).code).toBe("env_reserved");
    await call(alice, "conns", "/api/integrations/connections", { method: "POST", body: { action: "setEnvAllowlist", patterns: ["NEXT_PUBLIC_*"] } });
    const notAllowed = await call(alice, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "envAdd", projectId: "prj_alice", key: "DATABASE_URL", value: "x", target: ["preview"], confirm: true } });
    expect((await body(notAllowed)).code).toBe("env_not_allowed");
    // production deploy / redeploy need explicit confirmation
    const prod = await call(alice, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "deploy", projectId: "prj_alice", target: "production" } });
    expect(prod.status).toBe(409);
    expect((await body(prod)).code).toBe("confirm_required");
    const redeploy = await call(alice, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "redeploy", deploymentId: "dpl_1", target: "production" } });
    expect((await body(redeploy)).code).toBe("confirm_required");
  });

  it("14. dangerous GitHub operations need confirmation; audit is stored per user", async () => {
    const r = await call(alice, "gh", "/api/integrations/github", { method: "POST", body: { action: "createPull", repo: `${people.alice!.gh.login}/one`, title: "t", head: "a", base: "main" } });
    expect(r.status).toBe(409);
    expect((await body(r)).code).toBe("confirm_required");
    const rows = (await pool.query("SELECT l.provider, l.action FROM integration_audit_logs l JOIN users u ON u.id=l.user_id JOIN accounts a ON a.user_id=u.id WHERE a.provider_account_id=$1", [people.alice!.gh.id])).rows;
    expect(rows.some((x) => x.action === "auth:login")).toBe(true);
    expect(rows.some((x) => x.action === "github:connect")).toBe(true);
    expect(rows.some((x) => x.action === "vercel:connect")).toBe(true);
  });

  it("15. webhooks: signatures verified; removing the installation on GitHub revokes the connection", async () => {
    const payload = JSON.stringify({ action: "deleted", installation: { id: people.bob!.gh.inst }, sender: { login: "bob" } });
    const unsigned = new Request("https://nexus.test/api/webhooks/github", { method: "POST", body: payload, headers: { "x-github-event": "installation" } });
    expect((await H.ghHook!(unsigned)).status).toBe(401);
    const forged = new Request("https://nexus.test/api/webhooks/github", { method: "POST", body: payload, headers: { "x-github-event": "installation", "x-hub-signature-256": "sha256=deadbeef" } });
    expect((await H.ghHook!(forged)).status).toBe(401);
    expect((await body(await call(bob, "session", "/api/auth/session"))).github.connected).toBe(true);
    const sig = `sha256=${createHmac("sha256", "gh-hook-secret").update(payload).digest("hex")}`;
    const good = new Request("https://nexus.test/api/webhooks/github", { method: "POST", body: payload, headers: { "x-github-event": "installation", "x-hub-signature-256": sig } });
    expect((await H.ghHook!(good)).status).toBe(200);
    expect((await body(await call(bob, "session", "/api/auth/session"))).github.connected).toBe(false);
    expect((await call(bob, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } })).status).toBe(401);
    // Vercel webhook (HMAC-SHA1)
    const vp = JSON.stringify({ type: "integration-configuration.removed", payload: { configuration: { id: `icfg_a_${RUN}` } } });
    const bad = new Request("https://nexus.test/api/webhooks/vercel", { method: "POST", body: vp, headers: { "x-vercel-signature": "0".repeat(40) } });
    expect((await H.vcHook!(bad)).status).toBe(401);
    expect((await body(await call(alice, "session", "/api/auth/session"))).vercel.connected).toBe(true);
    const vgood = new Request("https://nexus.test/api/webhooks/vercel", { method: "POST", body: vp, headers: { "x-vercel-signature": createHmac("sha1", "vc_int_secret").update(vp).digest("hex") } });
    expect((await H.vcHook!(vgood)).status).toBe(200);
    expect((await body(await call(alice, "session", "/api/auth/session"))).vercel.connected).toBe(false);
  });

  it("16. revoke access: disconnect uninstalls on Vercel, wipes the token, API stops working", async () => {
    const st = await call(alice, "vcStart", "/api/integrations/vercel/start");
    await call(alice, "vcCallback", `/api/integrations/vercel/callback?code=alice&configurationId=icfg_a_${RUN}&state=${loc(st).searchParams.get("state")}`);
    expect((await body(await call(alice, "session", "/api/auth/session"))).vercel.connected).toBe(true);
    const noConfirm = await call(alice, "connsDel", "/api/integrations/connections?provider=vercel", { method: "DELETE" });
    expect(noConfirm.status).toBe(409);
    const del = await call(alice, "connsDel", "/api/integrations/connections?provider=vercel&confirm=1", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes(`/v1/integrations/configuration/icfg_a_${RUN}`))).toBe(true);
    const row = (await pool.query("SELECT status, access_token_enc FROM connected_providers WHERE external_id='icfg_a_'||$1", [RUN])).rows[0];
    expect(row.status).toBe("revoked");
    expect(row.access_token_enc).toBeNull();
    expect((await call(alice, "vc", "/api/integrations/vercel", { method: "POST", body: { action: "projects" } })).status).toBe(401);
    // GitHub: disconnect + the App can be uninstalled upstream
    const gdel = await call(alice, "connsDel", "/api/integrations/connections?provider=github&confirm=1&uninstall=0", { method: "DELETE" });
    expect(gdel.status).toBe(200);
    expect((await call(alice, "gh", "/api/integrations/github", { method: "POST", body: { action: "repos" } })).status).toBe(401);
    // identity (login) survives disconnecting the API connection
    expect((await body(await call(alice, "session", "/api/auth/session"))).user).not.toBeNull();
  });

  it("17. unlink keeps at least one way to sign in", async () => {
    const s = await body(await call(alice, "session", "/api/auth/session"));
    expect(s.user.identities).toHaveLength(2);
    const noConfirm = await call(alice, "unlink", "/api/auth/unlink", { method: "POST", body: { provider: "vercel" } });
    expect(noConfirm.status).toBe(409);
    expect((await call(alice, "unlink", "/api/auth/unlink", { method: "POST", body: { provider: "vercel", confirm: true } })).status).toBe(200);
    const last = await call(alice, "unlink", "/api/auth/unlink", { method: "POST", body: { provider: "github", confirm: true } });
    expect(last.status).toBe(409);
    expect((await body(last)).code).toBe("last_identity");
  });

  it("18. session expiry (idle + absolute) and logout revoke the session server-side", async () => {
    const idle = new Browser();
    await (await login(idle, "github", "alice")).finish();
    expect((await body(await call(idle, "session", "/api/auth/session"))).user).not.toBeNull();
    await pool.query("UPDATE sessions SET idle_expires_at = now() - interval '1 minute' WHERE id = encode(sha256($1::bytea),'hex')", [idle.jar.get(sessionCookie())]);
    expect((await body(await call(idle, "session", "/api/auth/session"))).user).toBeNull();

    const abs = new Browser();
    await (await login(abs, "github", "alice")).finish();
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = encode(sha256($1::bytea),'hex')", [abs.jar.get(sessionCookie())]);
    expect((await body(await call(abs, "session", "/api/auth/session"))).user).toBeNull();

    const out = new Browser();
    await (await login(out, "github", "alice")).finish();
    const token = out.jar.get(sessionCookie())!;
    const lo = await call(out, "logout", "/api/auth/logout", { method: "POST" });
    expect(lo.status).toBe(200);
    expect(out.jar.has(sessionCookie())).toBe(false);
    // the old cookie, replayed, is dead
    const replay = new Browser();
    replay.jar.set(sessionCookie(), token);
    expect((await body(await call(replay, "session", "/api/auth/session"))).user).toBeNull();
  });

  it("19. a new sign-in rotates the session (fixation protection)", async () => {
    const b = new Browser();
    await (await login(b, "github", "alice")).finish();
    const first = b.jar.get(sessionCookie())!;
    await (await login(b, "github", "alice")).finish();
    const second = b.jar.get(sessionCookie())!;
    expect(second).not.toBe(first);
    const replay = new Browser();
    replay.jar.set(sessionCookie(), first);
    expect((await body(await call(replay, "session", "/api/auth/session"))).user).toBeNull();
  });

  it("20. no provider token ever appears in any response body or Location header", async () => {
    // Re-run a representative flow collecting outputs.
    const b = new Browser();
    const f = await login(b, "github", "alice");
    const cb = await f.finish();
    const outputs = [f.authorize.toString(), cb.headers.get("location") ?? ""];
    const s = await call(b, "session", "/api/auth/session");
    outputs.push(await s.text());
    for (const o of outputs) for (const p of SECRET_PATTERNS) expect(o).not.toMatch(p);
  });
});
