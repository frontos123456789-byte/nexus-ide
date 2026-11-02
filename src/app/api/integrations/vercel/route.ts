import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { ApiError, audit, csrfCheck, requireConfirm } from "@/lib/integrations/server";
import { assertEnvKeyAllowed, vercelCredentials, type VercelCred } from "@/lib/auth/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function vc<T>(token: string, teamId: string | undefined, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      throw new ApiError("Достигнут лимит Vercel API — повторите позже", 429, "rate_limited", { resetAt: reset || undefined });
    }
    if (res.status === 401) throw new ApiError("Токен Vercel недействителен", 401, "unauthorized");
    if (res.status === 403) throw new ApiError(`Недостаточно прав или ограничение тарифа: ${err?.message ?? ""}`, 403, "forbidden");
    throw new ApiError(err?.message ?? `Vercel HTTP ${res.status}`, res.status === 404 ? 404 : 502, err?.code ?? "vercel_error");
  }
  return json as T;
}

const id = z.string().regex(/^[\w.-]{1,128}$/);
const targets = z.array(z.enum(["production", "preview", "development"])).min(1);

const actions = {
  projects: z.object({}),
  teams: z.object({}),
  deployments: z.object({ projectId: id, limit: z.number().int().min(1).max(30).default(12), target: z.enum(["production", "preview"]).optional() }),
  deployment: z.object({ deploymentId: id }),
  logs: z.object({ deploymentId: id }),
  createProject: z.object({ name: z.string().regex(/^[a-z0-9._-]{1,100}$/), repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), framework: z.string().max(40).nullable().optional() }),
  deploy: z.object({ projectId: id, ref: z.string().max(200).optional(), target: z.enum(["production", "preview"]).default("preview") }),
  redeploy: z.object({ deploymentId: id, target: z.enum(["production", "preview"]).default("preview") }),
  rollback: z.object({ projectId: id, deploymentId: id }),
  env: z.object({ projectId: id }),
  envAdd: z.object({ projectId: id, key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), value: z.string().max(10_000), target: targets, type: z.enum(["encrypted", "plain", "sensitive"]).default("encrypted") }),
  envDelete: z.object({ projectId: id, envId: id }),
} as const;

type Action = keyof typeof actions;
type Obj = Record<string, unknown>;

async function run(cred: VercelCred, action: Action, p: Obj, raw: { confirm?: unknown }) {
  const token = cred.token;
  const team = cred.teamId;
  switch (action) {
    case "teams": {
      // Teams / account visible to this authorization (an integration is installed on exactly one team or personal account).
      const r = await vc<{ teams?: Obj[] }>(token, undefined, "/v2/teams?limit=20").catch(() => ({ teams: [] as Obj[] }));
      const list = (r.teams ?? []).map((t) => ({ id: t.id, slug: t.slug, name: t.name, current: t.id === team }));
      if (list.length === 0) list.push({ id: team ?? null, slug: null, name: team ? `Команда ${team}` : "Личный аккаунт", current: true });
      return list;
    }
    case "projects": {
      const r = await vc<{ projects: Obj[] }>(token, team, "/v9/projects?limit=60");
      return r.projects.map((x) => {
        const latest = (x.latestDeployments as Obj[] | undefined)?.[0];
        const link = x.link as Obj | undefined;
        const prod = (x.targets as { production?: Obj } | undefined)?.production;
        return {
          id: x.id,
          name: x.name,
          framework: x.framework,
          updatedAt: x.updatedAt,
          link: link ? { type: link.type, repo: link.repo, org: link.org, repoId: link.repoId, productionBranch: link.productionBranch } : null,
          latest: latest ? { id: latest.id, state: latest.readyState, url: latest.url, createdAt: latest.createdAt } : null,
          productionUrl: prod?.alias && Array.isArray(prod.alias) ? (prod.alias as string[])[0] : null,
        };
      });
    }
    case "deployments": {
      const a = actions.deployments.parse(p);
      const r = await vc<{ deployments: Obj[] }>(token, team, `/v6/deployments?projectId=${a.projectId}&limit=${a.limit}${a.target ? `&target=${a.target}` : ""}`);
      return r.deployments.map((d) => ({ id: d.uid, state: d.readyState ?? d.state, target: d.target ?? "preview", url: d.url, created: d.created, ready: d.ready, creator: (d.creator as Obj | undefined)?.username, source: d.source, meta: { commit: (d.meta as Obj | undefined)?.githubCommitMessage, sha: (d.meta as Obj | undefined)?.githubCommitSha, branch: (d.meta as Obj | undefined)?.githubCommitRef }, error: d.errorMessage }));
    }
    case "deployment": {
      const a = actions.deployment.parse(p);
      const d = await vc<Obj>(token, team, `/v13/deployments/${a.deploymentId}`);
      return { id: d.id, state: d.readyState, target: d.target, url: d.url, createdAt: d.createdAt, alias: d.alias, errorMessage: d.errorMessage, errorCode: d.errorCode, name: d.name, projectId: d.projectId };
    }
    case "logs": {
      const a = actions.logs.parse(p);
      const r = await vc<Obj[] | { events?: Obj[] }>(token, team, `/v3/deployments/${a.deploymentId}/events?limit=400&builds=1`);
      const list = Array.isArray(r) ? r : (r.events ?? []);
      return list.map((e) => ({ ts: e.created ?? (e.payload as Obj | undefined)?.date, type: e.type, text: String(e.text ?? (e.payload as Obj | undefined)?.text ?? "") })).filter((e) => e.text);
    }
    case "createProject": {
      const a = actions.createProject.parse(p);
      requireConfirm(raw, `создать проект Vercel «${a.name}» и подключить ${a.repo}`);
      const r = await vc<Obj>(token, team, "/v11/projects", { method: "POST", body: { name: a.name, framework: a.framework ?? undefined, gitRepository: { type: "github", repo: a.repo } } });
      return { id: r.id, name: r.name };
    }
    case "deploy": {
      const a = actions.deploy.parse(p);
      if (a.target === "production") requireConfirm(raw, "ДЕПЛОЙ В PRODUCTION");
      else requireConfirm(raw, "запустить preview-деплой");
      const proj = await vc<{ name: string; link?: { type?: string; repoId?: number; productionBranch?: string } }>(token, team, `/v9/projects/${a.projectId}`);
      if (!proj.link?.repoId || proj.link.type !== "github") throw new ApiError("К проекту Vercel не подключён GitHub-репозиторий", 400, "not_linked");
      const d = await vc<Obj>(token, team, "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1", {
        method: "POST",
        body: { name: proj.name, project: a.projectId, target: a.target === "production" ? "production" : undefined, gitSource: { type: "github", repoId: proj.link.repoId, ref: a.ref ?? proj.link.productionBranch ?? "main" } },
      });
      return { id: d.id, url: d.url, state: d.readyState };
    }
    case "redeploy": {
      const a = actions.redeploy.parse(p);
      if (a.target === "production") requireConfirm(raw, "ПОВТОРНЫЙ ДЕПЛОЙ В PRODUCTION");
      else requireConfirm(raw, "повторный preview-деплой");
      const old = await vc<{ name: string }>(token, team, `/v13/deployments/${a.deploymentId}`);
      const d = await vc<Obj>(token, team, "/v13/deployments?forceNew=1", { method: "POST", body: { name: old.name, deploymentId: a.deploymentId, target: a.target === "production" ? "production" : undefined } });
      return { id: d.id, url: d.url, state: d.readyState };
    }
    case "rollback": {
      const a = actions.rollback.parse(p);
      requireConfirm(raw, "ОТКАТ production на выбранный деплой (изменяет боевое окружение)");
      await vc(token, team, `/v10/projects/${a.projectId}/promote/${a.deploymentId}`, { method: "POST", body: {} });
      return { promoted: a.deploymentId };
    }
    case "env": {
      const a = actions.env.parse(p);
      const r = await vc<{ envs: Obj[] }>(token, team, `/v10/projects/${a.projectId}/env`);
      // Values are never returned to the browser — only metadata.
      return r.envs.map((e) => ({ id: e.id, key: e.key, type: e.type, target: e.target, updatedAt: e.updatedAt }));
    }
    case "envAdd": {
      const a = actions.envAdd.parse(p);
      assertEnvKeyAllowed(cred, a.key);
      requireConfirm(raw, `добавить переменную ${a.key} (${a.target.join(", ")})`);
      const r = await vc<Obj>(token, team, `/v10/projects/${a.projectId}/env?upsert=true`, { method: "POST", body: { key: a.key, value: a.value, target: a.target, type: a.type } });
      return { ok: true, created: Boolean(r.created) };
    }
    case "envDelete": {
      const a = actions.envDelete.parse(p);
      const list = await vc<{ envs: Obj[] }>(token, team, `/v10/projects/${a.projectId}/env`);
      const found = list.envs.find((e) => e.id === a.envId);
      if (!found) throw new ApiError("Переменная не найдена в этом проекте", 404, "not_found");
      assertEnvKeyAllowed(cred, String(found.key));
      requireConfirm(raw, "УДАЛИТЬ переменную окружения");
      await vc(token, team, `/v9/projects/${a.projectId}/env/${a.envId}`, { method: "DELETE" });
      return { deleted: a.envId };
    }
  }
}

const READ = new Set<Action>(["teams", "projects", "deployments", "deployment", "logs", "env"]);

export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "int-vercel", 120);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as ({ action?: string; confirm?: unknown } & Obj) | null;
  const action = body?.action as Action | undefined;
  if (!body || !action || !(action in actions)) return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  let cred: VercelCred | null;
  try {
    cred = await vercelCredentials(req);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return Response.json({ error: "Внутренняя ошибка интеграции Vercel" }, { status: 500 });
  }
  if (!cred) return Response.json({ error: "Vercel не подключён", code: "not_connected" }, { status: 401 });
  const actor = cred.actor;
  const userId = cred.userId;
  const target = String(body.projectId ?? body.deploymentId ?? body.name ?? "");
  try {
    const data = await run(cred, action, body, { confirm: body.confirm });
    if (!READ.has(action)) await audit({ actor, userId, action: `vercel:${action}`, target, ok: true, detail: body.target ? `target=${String(body.target)}` : undefined });
    return Response.json({ data });
  } catch (e) {
    if (!READ.has(action) && !(e instanceof ApiError && e.code === "confirm_required")) {
      await audit({ actor, userId, action: `vercel:${action}`, target, ok: false, detail: e instanceof Error ? e.message : undefined });
    }
    if (e instanceof ApiError) return e.toResponse();
    if (e instanceof z.ZodError) return Response.json({ error: `Некорректные параметры: ${e.issues[0]?.message ?? ""}` }, { status: 400 });
    return Response.json({ error: "Внутренняя ошибка интеграции Vercel" }, { status: 500 });
  }
}
