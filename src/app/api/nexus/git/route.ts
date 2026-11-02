import { bad, envToken, rateLimit, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

async function gh(path: string): Promise<unknown> {
  const token = envToken("github");
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "nexus-ide", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

interface GhCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  author?: { login: string; avatar_url: string } | null;
  parents: { sha: string }[];
}

/** Read-only Git history via the GitHub API (token optional for public repos). */
export async function GET(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const limited = rateLimit(req, "nexus-git", 30);
  if (limited) return limited;
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") ?? process.env.NEXUS_GITHUB_REPO ?? "";
  if (!REPO.test(repo)) return bad("Укажите репозиторий в формате owner/name");
  const sha = url.searchParams.get("sha");
  try {
    if (sha) {
      if (!/^[0-9a-f]{7,40}$/.test(sha)) return bad("Некорректный sha");
      const c = (await gh(`/repos/${repo}/commits/${sha}`)) as { files?: { filename: string; status: string; additions: number; deletions: number }[] };
      return Response.json({ files: (c.files ?? []).slice(0, 100) });
    }
    const [commits, branches] = await Promise.all([
      gh(`/repos/${repo}/commits?per_page=40`) as Promise<GhCommit[]>,
      gh(`/repos/${repo}/branches?per_page=30`) as Promise<{ name: string; commit: { sha: string } }[]>,
    ]);
    return Response.json({
      repo,
      authenticated: Boolean(envToken("github")),
      branches: branches.map((b) => ({ name: b.name, sha: b.commit.sha })),
      commits: commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split("\n")[0],
        author: c.author?.login ?? c.commit.author.name,
        date: c.commit.author.date,
        parents: c.parents.map((p) => p.sha),
      })),
    });
  } catch (err) {
    return bad(`Не удалось получить историю: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
