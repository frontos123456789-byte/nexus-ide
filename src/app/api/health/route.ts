import { sql } from "drizzle-orm";
import { getApiKey } from "@/lib/openrouter/client";

export const dynamic = "force-dynamic";

/**
 * Health probe. Nexus IDE itself keeps all user data in the browser (IndexedDB),
 * so PostgreSQL is optional: it is only checked when DATABASE_URL is configured.
 */
export async function GET() {
  const ai = Boolean(getApiKey());
  if (!process.env.DATABASE_URL) {
    return Response.json({ ok: true, db: "not-configured", ai });
  }
  try {
    const { db } = await import("@/db");
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: "ok", ai });
  } catch {
    return Response.json({ ok: false, db: "error", ai }, { status: 500 });
  }
}
