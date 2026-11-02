export type SqlKind = "read" | "write" | "ddl" | "dangerous";

export interface SqlClass {
  kind: SqlKind;
  statements: number;
  reasons: string[];
  /** Needs an explicit confirmation from the user. */
  needsConfirm: boolean;
}

/** Removes comments and string literals so keyword detection cannot be fooled by them. */
export function stripSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''");
}

export function classifySql(sql: string): SqlClass {
  const clean = stripSql(sql).trim();
  const stmts = clean.split(";").map((s) => s.trim()).filter(Boolean);
  const reasons: string[] = [];
  if (stmts.length === 0) return { kind: "read", statements: 0, reasons: ["пустой запрос"], needsConfirm: false };
  let kind: SqlKind = "read";
  const bump = (k: SqlKind) => {
    const order: SqlKind[] = ["read", "write", "ddl", "dangerous"];
    if (order.indexOf(k) > order.indexOf(kind)) kind = k;
  };
  for (const s of stmts) {
    const l = s.toLowerCase();
    const first = l.split(/\s+/)[0] ?? "";
    if (/^(drop|truncate|grant|revoke)\b/.test(l) || /\balter\s+(system|role|user)\b/.test(l) || /\bcreate\s+(role|user)\b/.test(l)) {
      bump("dangerous");
      reasons.push(`Опасная операция: ${first.toUpperCase()}`);
    } else if (/^(delete|update)\b/.test(l) && !/\bwhere\b/.test(l)) {
      bump("dangerous");
      reasons.push(`${first.toUpperCase()} без WHERE затронет все строки`);
    } else if (/^(create|alter|comment|vacuum|reindex|cluster)\b/.test(l)) {
      bump("ddl");
      reasons.push("Изменение схемы");
    } else if (/^(insert|update|delete|merge|copy|call|do|lock|set|reset|begin|commit|rollback)\b/.test(l)) {
      bump("write");
      reasons.push("Изменение данных");
    } else if (/^explain\b/.test(l) && /\banalyze\b/.test(l)) {
      bump("write");
      reasons.push("EXPLAIN ANALYZE выполняет запрос");
    } else if (/^(select|with|show|values|explain|table)\b/.test(l)) {
      if (/\b(insert|update|delete|into)\b/.test(l.replace(/\bselect\b[^;]*\binto\b/, "select into"))) {
        if (/\b(insert\s+into|update\s+\w|delete\s+from)\b/.test(l) || /\bselect\b[\s\S]*\binto\b/.test(l)) {
          bump("write");
          reasons.push("Запрос содержит запись данных");
        }
      }
    } else {
      bump("write");
      reasons.push(`Неизвестная команда ${first.toUpperCase()}`);
    }
  }
  return { kind, statements: stmts.length, reasons, needsConfirm: kind !== "read" };
}
