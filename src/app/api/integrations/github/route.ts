import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { ApiError, audit, csrfCheck, requireConfirm } from "@/lib/integrations/server";
import { assertRepoAllowed, githubCredentials, type GithubCred } from "@/lib/auth/credentials";
import { installationToken, listInstallationRepos } from "@/lib/auth/providers/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API = "https://api.github.com";

async function gh<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "nexus-ai",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429 || (res.status === 403 && remaining === "0")) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      throw new ApiError("Достигнут лимит GitHub API — повторите позже", 429, "rate_limited", { resetAt: reset || undefined });
    }
    const msg = (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new ApiError("Токен GitHub недействителен или отозван", 401, "unauthorized");
    if (res.status === 403) throw new ApiError(`Недостаточно прав для операции: ${msg}`, 403, "forbidden");
    throw new ApiError(msg, res.status === 404 ? 404 : res.status === 409 ? 409 : 502, "github_error");
  }
  return json as T;
}

const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Формат owner/name");
const base = z.object({ confirm: z.boolean().optional() });

const actions = {
  repos: z.object({ page: z.number().int().min(1).max(20).optional(), all: z.boolean().optional() }),
  createRepo: z.object({ name: z.string().regex(/^[\w.-]{1,100}$/), description: z.string().max(300).optional(), private: z.boolean().default(true) }),
  contents: z.object({ repo: repoName, path: z.string().max(400).default(""), ref: z.string().max(200).optional() }),
  branches: z.object({ repo: repoName }),
  createBranch: z.object({ repo: repoName, name: z.string().regex(/^[\w./-]{1,100}$/), from: z.string().max(200).optional() }),
  deleteBranch: z.object({ repo: repoName, name: z.string().regex(/^[\w./-]{1,100}$/) }),
  commits: z.object({ repo: repoName, sha: z.string().max(200).optional(), perPage: z.number().int().min(1).max(50).default(20) }),
  commit: z.object({ repo: repoName, sha: z.string().max(80) }),
  commitFiles: z.object({
    repo: repoName,
    branch: z.string().regex(/^[\w./-]{1,100}$/),
    message: z.string().min(1).max(500),
    files: z.array(z.object({ path: z.string().min(1).max(400), content: z.string().max(1_500_000) })).min(1).max(200),
    deletes: z.array(z.string().max(400)).max(200).optional(),
  }),
  pulls: z.object({ repo: repoName, state: z.enum(["open", "closed", "all"]).default("open") }),
  createPull: z.object({ repo: repoName, title: z.string().min(1).max(250), head: z.string().max(200), base: z.string().max(200), body: z.string().max(10_000).optional() }),
  runs: z.object({ repo: repoName, branch: z.string().max(200).optional() }),
  runDetail: z.object({ repo: repoName, runId: z.number().int() }),
  compare: z.object({ repo: repoName, base: z.string().max(200), head: z.string().max(200) }),
  revertToCommit: z.object({ repo: repoName, branch: z.string().max(200), sha: z.string().max(80) }),
  events: z.object({ repo: repoName }),
} as const;

type Action = keyof typeof actions;

interface Ref { object: { sha: string } }

async function commitFiles(token: string, a: z.infer<typeof actions.commitFiles>) {
  const { repo, branch } = a;
  let head: string | null = null;
  try {
    head = (await gh<Ref>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`)).object.sha;
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 409)) throw e;
  }
  let files = a.files;
  if (!head) {
    // Empty repository (or new branch): bootstrap with the Contents API, which can create the first commit.
    const first = files[0] as (typeof files)[number];
    await gh(token, `/repos/${repo}/contents/${first.path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      body: { message: a.message, content: Buffer.from(first.content, "utf8").toString("base64"), branch },
    });
    files = files.slice(1);
    head = (await gh<Ref>(token, `/repos/${repo}/git/ref/heads/${branch}`)).object.sha;
    if (files.length === 0 && !a.deletes?.length) return { sha: head, files: 1 };
  }
  const headCommit = await gh<{ tree: { sha: string } }>(token, `/repos/${repo}/git/commits/${head}`);
  const tree: { path: string; mode: string; type: string; sha: string | null }[] = [];
  for (const f of files) {
    const blob = await gh<{ sha: string }>(token, `/repos/${repo}/git/blobs`, { method: "POST", body: { content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" } });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  for (const d of a.deletes ?? []) tree.push({ path: d, mode: "100644", type: "blob", sha: null });
  const newTree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, { method: "POST", body: { base_tree: headCommit.tree.sha, tree } });
  const commit = await gh<{ sha: string; html_url: string }>(token, `/repos/${repo}/git/commits`, { method: "POST", body: { message: a.message, tree: newTree.sha, parents: [head] } });
  await gh(token, `/repos/${repo}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
  return { sha: commit.sha, url: commit.html_url, files: files.length + (a.deletes?.length ?? 0) };
}

async function run(cred: GithubCred, action: Action, p: Record<string, unknown>, raw: { confirm?: unknown }) {
  const token = cred.token;
  if (cred.via === "account" && typeof p.repo === "string") assertRepoAllowed(cred, p.repo);
  switch (action) {
    case "repos": {
      const a = actions.repos.parse(p);
      if (cred.via === "account") {
        // Account connection: only repositories of the GitHub App installation (narrowed by the user's Nexus allow-list).
        // `all` = unrestricted installation view (used by the access-management UI to let the user widen the selection).
        const list = await listInstallationRepos(a.all && cred.installationId ? await installationToken(cred.installationId) : token);
        return list.map((r) => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch, updated_at: r.updated_at, html_url: r.html_url, description: r.description, permissions: r.permissions, id: r.id }));
      }
      const list = await gh<Record<string, unknown>[]>(token, `/user/repos?sort=updated&per_page=50&page=${a.page ?? 1}&affiliation=owner,collaborator,organization_member`);
      return list.map((r) => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch, updated_at: r.updated_at, html_url: r.html_url, description: r.description, permissions: r.permissions, id: r.id }));
    }
    case "createRepo": {
      const a = actions.createRepo.parse(p);
      requireConfirm(raw, `создать ${a.private ? "приватный" : "ПУБЛИЧНЫЙ"} репозиторий ${a.name}`);
      if (cred.via === "account") {
        // GitHub does not let installation tokens create repositories in PERSONAL accounts; organizations are allowed
        // (needs the "Administration: write" app permission). Personal accounts use the user-to-server token.
        const body = { name: a.name, description: a.description, private: a.private, auto_init: false };
        if (cred.accountType === "Organization" && cred.accountLogin) {
          const r = await gh<{ full_name: string; html_url: string; default_branch: string }>(token, `/orgs/${cred.accountLogin}/repos`, { method: "POST", body });
          return r;
        }
        const ut = await cred.userToken();
        if (!ut) throw new ApiError("Для создания репозитория в личном аккаунте нужна авторизация GitHub — войдите через GitHub заново.", 401, "reauth_required");
        try {
          return await gh<{ full_name: string; html_url: string; default_branch: string }>(ut, "/user/repos", { method: "POST", body });
        } catch (e) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) throw new ApiError("GitHub запрещает приложению создавать репозитории в личном аккаунте. Создайте пустой репозиторий на github.com/new и добавьте его в доступ GitHub App («Управление доступом»).", 403, "forbidden", { newRepoUrl: "https://github.com/new" });
          throw e;
        }
      }
      const r = await gh<{ full_name: string; html_url: string; default_branch: string }>(token, "/user/repos", { method: "POST", body: { name: a.name, description: a.description, private: a.private, auto_init: false } });
      return r;
    }
    case "contents": {
      const a = actions.contents.parse(p);
      const path = a.path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
      const r = await gh<unknown>(token, `/repos/${a.repo}/contents/${path}${a.ref ? `?ref=${encodeURIComponent(a.ref)}` : ""}`);
      if (Array.isArray(r)) return { type: "dir", entries: (r as { name: string; path: string; type: string; size: number }[]).map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size })) };
      const f = r as { type: string; path: string; size: number; content?: string; encoding?: string; html_url: string };
      if (f.size > 400_000 || !f.content) return { type: "file", path: f.path, size: f.size, text: null, note: "Файл слишком большой для предпросмотра", html_url: f.html_url };
      return { type: "file", path: f.path, size: f.size, text: Buffer.from(f.content, "base64").toString("utf8"), html_url: f.html_url };
    }
    case "branches": {
      const a = actions.branches.parse(p);
      const list = await gh<{ name: string; protected: boolean; commit: { sha: string } }[]>(token, `/repos/${a.repo}/branches?per_page=100`);
      return list.map((b) => ({ name: b.name, protected: b.protected, sha: b.commit.sha }));
    }
    case "createBranch": {
      const a = actions.createBranch.parse(p);
      let from = a.from;
      if (!from) from = (await gh<{ default_branch: string }>(token, `/repos/${a.repo}`)).default_branch;
      const ref = await gh<Ref>(token, `/repos/${a.repo}/git/ref/heads/${from}`);
      await gh(token, `/repos/${a.repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${a.name}`, sha: ref.object.sha } });
      return { name: a.name, from, sha: ref.object.sha };
    }
    case "deleteBranch": {
      const a = actions.deleteBranch.parse(p);
      requireConfirm(raw, `удалить ветку ${a.name} в ${a.repo}`);
      const def = (await gh<{ default_branch: string }>(token, `/repos/${a.repo}`)).default_branch;
      if (a.name === def) throw new ApiError("Ветку по умолчанию удалять нельзя", 400, "refused");
      await gh(token, `/repos/${a.repo}/git/refs/heads/${a.name}`, { method: "DELETE" });
      return { deleted: a.name };
    }
    case "commits": {
      const a = actions.commits.parse(p);
      const list = await gh<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; author?: { login: string } }[]>(token, `/repos/${a.repo}/commits?per_page=${a.perPage}${a.sha ? `&sha=${encodeURIComponent(a.sha)}` : ""}`);
      return list.map((c) => ({ sha: c.sha, message: c.commit.message, author: c.author?.login ?? c.commit.author.name, date: c.commit.author.date, url: c.html_url }));
    }
    case "commit": {
      const a = actions.commit.parse(p);
      const c = await gh<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; stats?: unknown; files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] }>(token, `/repos/${a.repo}/commits/${a.sha}`);
      return { sha: c.sha, message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date, url: c.html_url, stats: c.stats, files: (c.files ?? []).slice(0, 60).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch?.slice(0, 6000) })) };
    }
    case "commitFiles": {
      const a = actions.commitFiles.parse(p);
      requireConfirm(raw, `создать коммит в ${a.repo}@${a.branch}: ${a.files.length} файл(ов)`);
      return commitFiles(token, a);
    }
    case "pulls": {
      const a = actions.pulls.parse(p);
      const list = await gh<{ number: number; title: string; state: string; draft: boolean; merged_at: string | null; html_url: string; user: { login: string }; head: { ref: string }; base: { ref: string }; updated_at: string }[]>(token, `/repos/${a.repo}/pulls?state=${a.state}&per_page=30`);
      return list.map((x) => ({ number: x.number, title: x.title, state: x.merged_at ? "merged" : x.state, draft: x.draft, url: x.html_url, user: x.user.login, head: x.head.ref, base: x.base.ref, updated_at: x.updated_at }));
    }
    case "createPull": {
      const a = actions.createPull.parse(p);
      requireConfirm(raw, `создать pull request ${a.head} → ${a.base} в ${a.repo}`);
      const r = await gh<{ number: number; html_url: string }>(token, `/repos/${a.repo}/pulls`, { method: "POST", body: { title: a.title, head: a.head, base: a.base, body: a.body } });
      return { number: r.number, url: r.html_url };
    }
    case "runs": {
      const a = actions.runs.parse(p);
      const r = await gh<{ workflow_runs: { id: number; name: string; status: string; conclusion: string | null; head_branch: string; head_sha: string; html_url: string; event: string; created_at: string; updated_at: string; run_number: number }[] }>(token, `/repos/${a.repo}/actions/runs?per_page=15${a.branch ? `&branch=${encodeURIComponent(a.branch)}` : ""}`);
      return r.workflow_runs.map((x) => ({ id: x.id, name: x.name, status: x.status, conclusion: x.conclusion, branch: x.head_branch, sha: x.head_sha, url: x.html_url, event: x.event, created_at: x.created_at, updated_at: x.updated_at, number: x.run_number }));
    }
    case "runDetail": {
      const a = actions.runDetail.parse(p);
      const j = await gh<{ jobs: { id: number; name: string; status: string; conclusion: string | null; html_url: string; steps?: { name: string; conclusion: string | null; number: number }[] }[] }>(token, `/repos/${a.repo}/actions/runs/${a.runId}/jobs`);
      const jobs = await Promise.all(
        j.jobs.map(async (job) => {
          let annotations: { message: string; path: string; start_line: number; annotation_level: string }[] = [];
          if (job.conclusion === "failure") {
            annotations = await gh<typeof annotations>(token, `/repos/${a.repo}/check-runs/${job.id}/annotations`).catch(() => []);
          }
          return { id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, url: job.html_url, failedSteps: (job.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => s.name), annotations: annotations.slice(0, 20).map((n) => ({ message: n.message, path: n.path, line: n.start_line, level: n.annotation_level })) };
        }),
      );
      return { jobs };
    }
    case "compare": {
      const a = actions.compare.parse(p);
      const c = await gh<{ status: string; ahead_by: number; behind_by: number; total_commits: number; html_url: string; commits: { sha: string; commit: { message: string } }[]; files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] }>(token, `/repos/${a.repo}/compare/${encodeURIComponent(a.base)}...${encodeURIComponent(a.head)}`);
      return { status: c.status, ahead_by: c.ahead_by, behind_by: c.behind_by, total_commits: c.total_commits, url: c.html_url, commits: c.commits.slice(-30).map((x) => ({ sha: x.sha, message: x.commit.message })), files: c.files.slice(0, 60).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch?.slice(0, 6000) })) };
    }
    case "revertToCommit": {
      const a = actions.revertToCommit.parse(p);
      requireConfirm(raw, `откатить содержимое ${a.branch} к коммиту ${a.sha.slice(0, 7)} (создаётся НОВЫЙ коммит, история сохраняется)`);
      const target = await gh<{ tree: { sha: string } }>(token, `/repos/${a.repo}/git/commits/${a.sha}`);
      const head = (await gh<Ref>(token, `/repos/${a.repo}/git/ref/heads/${a.branch}`)).object.sha;
      const c = await gh<{ sha: string }>(token, `/repos/${a.repo}/git/commits`, { method: "POST", body: { message: `Revert branch content to ${a.sha.slice(0, 7)} (via Nexus)`, tree: target.tree.sha, parents: [head] } });
      await gh(token, `/repos/${a.repo}/git/refs/heads/${a.branch}`, { method: "PATCH", body: { sha: c.sha, force: false } });
      return { sha: c.sha };
    }
    case "events": {
      const a = actions.events.parse(p);
      const ev = await gh<{ id: string; type: string; actor: { login: string }; created_at: string; payload: { ref?: string; commits?: { message: string }[]; action?: string; pull_request?: { title: string; number: number } } }[]>(token, `/repos/${a.repo}/events?per_page=20`);
      return ev.map((e) => ({ id: e.id, type: e.type, actor: e.actor.login, created_at: e.created_at, ref: e.payload.ref, commits: e.payload.commits?.slice(0, 3).map((c) => c.message), pr: e.payload.pull_request ? `#${e.payload.pull_request.number} ${e.payload.pull_request.title}` : undefined, action: e.payload.action }));
    }
  }
}

const READ = new Set<Action>(["repos", "contents", "branches", "commits", "commit", "pulls", "runs", "runDetail", "compare", "events"]);

export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "int-github", 120);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as ({ action?: string } & Record<string, unknown>) | null;
  const action = body?.action as Action | undefined;
  if (!body || !action || !(action in actions)) return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  let cred: GithubCred | null;
  try {
    cred = await githubCredentials(req);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return Response.json({ error: "Внутренняя ошибка интеграции GitHub" }, { status: 500 });
  }
  if (!cred) return Response.json({ error: "GitHub не подключён", code: "not_connected" }, { status: 401 });
  const actor = cred.actor;
  const userId = cred.userId;
  const parsedBase = base.safeParse(body);
  try {
    const data = await run(cred, action, body, { confirm: parsedBase.success ? parsedBase.data.confirm : undefined });
    if (!READ.has(action)) await audit({ actor, userId, action: `github:${action}`, target: String(body.repo ?? body.name ?? ""), ok: true });
    return Response.json({ data });
  } catch (e) {
    if (!READ.has(action) && !(e instanceof ApiError && e.code === "confirm_required")) {
      await audit({ actor, userId, action: `github:${action}`, target: String(body.repo ?? body.name ?? ""), ok: false, detail: e instanceof Error ? e.message : undefined });
    }
    if (e instanceof ApiError) return e.toResponse();
    if (e instanceof z.ZodError) return Response.json({ error: `Некорректные параметры: ${e.issues[0]?.message ?? ""}` }, { status: 400 });
    return Response.json({ error: "Внутренняя ошибка интеграции GitHub" }, { status: 500 });
  }
}
