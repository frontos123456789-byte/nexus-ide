import { buildAccountState, configuredFlags } from "@/lib/auth/state";
import { getSession } from "@/lib/auth/session";
import { json } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current Nexus account + provider connections. Contains no tokens. Anonymous callers get only the "what is configured" flags. */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await getSession(req);
    return json(await buildAccountState(ctx));
  } catch {
    return json({ configured: configuredFlags(), user: null, github: null, vercel: null });
  }
}
