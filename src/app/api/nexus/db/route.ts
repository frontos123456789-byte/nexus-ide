import { Pool, type QueryResult } from "pg";
import { z } from "zod";
import { classifySql } from "@/lib/nexus/sql-guard";
import { bad, rateLimit, readJson, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let pool: Pool | null = null;
function getPool(): Pool | null {
  const url = process.env.NEXUS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) return null;
  pool ??= new Pool({ connectionString: url, max: 3, statement_timeout: 10_000, connectionTimeoutMillis: 5000 });
  return pool;
}

const MAX_ROWS = 500;

export async function GET(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const p = getPool();
  if (!p) return bad("База данных не настроена (DATABASE_URL / NEXUS_DATABASE_URL)", 503);
  try {
    const cols = await p.query<{ table_schema: string; table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `select table_schema, table_name, column_name, data_type, is_nullable from information_schema.columns
       where table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name, ordinal_position`,
    );
    const fks = await p.query<{ from_table: string; from_column: string; to_table: string; to_column: string }>(
      `select tc.table_name as from_table, kcu.column_name as from_column, ccu.table_name as to_table, ccu.column_name as to_column
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
       where tc.constraint_type = 'FOREIGN KEY'`,
    );
    const tables: Record<string, { schema: string; name: string; columns: { name: string; type: string; nullable: boolean }[] }> = {};
    for (const c of cols.rows) {
      const key = `${c.table_schema}.${c.table_name}`;
      (tables[key] ??= { schema: c.table_schema, name: c.table_name, columns: [] }).columns.push({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES" });
    }
    return Response.json({ driver: "postgres", tables: Object.values(tables), relations: fks.rows, readOnly: process.env.NEXUS_DB_READONLY === "1" });
  } catch (err) {
    return bad(`Ошибка БД: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}

const schema = z.object({ sql: z.string().min(1).max(20_000), confirm: z.string().max(20).optional() });

export async function POST(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const limited = rateLimit(req, "nexus-db", 60);
  if (limited) return limited;
  const parsed = schema.safeParse(await readJson<unknown>(req, 100_000));
  if (!parsed.success) return bad("Ожидается { sql, confirm? }");
  const p = getPool();
  if (!p) return bad("База данных не настроена (DATABASE_URL / NEXUS_DATABASE_URL)", 503);
  const cls = classifySql(parsed.data.sql);
  if (cls.kind !== "read") {
    if (process.env.NEXUS_DB_READONLY === "1") return bad("Сервер запущен в режиме NEXUS_DB_READONLY — изменения запрещены", 403);
    const need = cls.kind === "dangerous" ? "CONFIRM" : "YES";
    if (parsed.data.confirm !== need) {
      return Response.json({ error: "Требуется подтверждение опасной операции", code: "confirm_required", need, class: cls }, { status: 409 });
    }
  }
  const client = await p.connect().catch(() => null);
  if (!client) return bad("Не удалось подключиться к БД", 502);
  const started = Date.now();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 10000");
    if (cls.kind === "read") await client.query("SET TRANSACTION READ ONLY");
    const res = await client.query(parsed.data.sql);
    await client.query(cls.kind === "read" ? "ROLLBACK" : "COMMIT");
    const last: QueryResult | undefined = Array.isArray(res) ? (res[res.length - 1] as QueryResult | undefined) : (res as QueryResult);
    return Response.json({
      class: cls,
      command: last?.command,
      rowCount: last?.rowCount ?? 0,
      fields: (last?.fields ?? []).map((f) => f.name),
      rows: (last?.rows ?? []).slice(0, MAX_ROWS),
      truncated: (last?.rows?.length ?? 0) > MAX_ROWS,
      ms: Date.now() - started,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    return bad(`SQL: ${err instanceof Error ? err.message : String(err)}`, 400);
  } finally {
    client.release();
  }
}
