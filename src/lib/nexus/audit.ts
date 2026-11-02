import { parseImports, resolveImport } from "./graph";
import { scanFiles } from "./secrets";
import type { Change } from "./types";

export type Risk = "critical" | "high" | "medium" | "low";

export interface AuditFinding {
  id: string;
  category: "injection" | "config" | "auth" | "secrets" | "xss" | "crypto" | "dependency";
  risk: Risk;
  path: string;
  line: number;
  title: string;
  evidence: string;
  fix: string;
}

interface Rule {
  id: string;
  category: AuditFinding["category"];
  risk: Risk;
  title: string;
  re: RegExp;
  fix: string;
  only?: RegExp;
}

const RULES: Rule[] = [
  { id: "eval", category: "injection", risk: "high", title: "Использование eval / new Function", re: /\beval\(|new Function\(/, fix: "Уберите динамическое исполнение кода; используйте JSON.parse или явные обработчики." },
  { id: "sql-concat", category: "injection", risk: "critical", title: "SQL собирается конкатенацией/шаблоном", re: /\.(query|execute|raw)\(\s*[`"'][^`"']*(\$\{|["']\s*\+)/, fix: "Используйте параметризованные запросы ($1, $2) или drizzle sql`` с параметрами." },
  { id: "exec-var", category: "injection", risk: "critical", title: "child_process с динамической командой", re: /\b(exec|execSync|spawn)\(\s*[`"'][^`"']*\$\{|\b(exec|execSync)\(\s*[a-z_]\w*\s*[,)]/i, fix: "Передавайте аргументы массивом в execFile/spawn без shell, валидируйте ввод по allowlist." },
  { id: "dangerous-html", category: "xss", risk: "high", title: "dangerouslySetInnerHTML", re: /dangerouslySetInnerHTML/, fix: "Санитизируйте HTML (DOMPurify) или рендерите как текст/Markdown." },
  { id: "innerhtml", category: "xss", risk: "high", title: "Присваивание innerHTML / document.write", re: /\.innerHTML\s*=|document\.write\(/, fix: "Используйте textContent или безопасный шаблонизатор." },
  { id: "cors-star", category: "config", risk: "medium", title: "CORS разрешён для любого origin", re: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*|cors\(\s*\)/, fix: "Ограничьте список доверенных origin." },
  { id: "tls-off", category: "config", risk: "high", title: "Отключена проверка TLS", re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/, fix: "Включите проверку сертификатов; для самоподписанных используйте CA." },
  { id: "http-url", category: "config", risk: "low", title: "Небезопасный http:// URL", re: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[\w.-]+/, fix: "Используйте https://." },
  { id: "weak-random", category: "crypto", risk: "medium", title: "Math.random для токенов/ключей", re: /(token|secret|key|password|nonce)\w*\s*=.*Math\.random\(/i, fix: "Используйте crypto.getRandomValues / crypto.randomUUID." },
  { id: "weak-hash", category: "crypto", risk: "medium", title: "Слабый хеш (md5/sha1)", re: /createHash\(\s*["'](md5|sha1)["']/, fix: "Используйте SHA-256+ (для паролей — argon2/bcrypt)." },
  { id: "token-storage", category: "auth", risk: "medium", title: "Токен в localStorage", re: /localStorage\.setItem\(\s*["'][^"']*(token|jwt|secret)/i, fix: "Храните токены в httpOnly cookie." },
  { id: "blank-rel", category: "xss", risk: "low", title: 'target="_blank" без rel="noopener"', re: /target=["']_blank["'](?![^>]*rel=)/, fix: 'Добавьте rel="noopener noreferrer".' },
];

const MUTATING = /export\s+(?:async\s+)?(?:function\s+)?(POST|PUT|PATCH|DELETE)\b/;
const AUTH_HINT = /(auth|session|getServerSession|verify|authorization|bearer|api[_-]?key|x-nexus-key|checkAccess|jwt|cookies\()/i;

export function auditCode(files: Record<string, string>, secretAllowlist: string[] = []): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const [path, src] of Object.entries(files)) {
    if (!/\.[mc]?[jt]sx?$|\.html?$/.test(path) || /node_modules\//.test(path)) continue;
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (line.includes("nexus-ignore")) return;
      for (const r of RULES) {
        if (r.only && !r.only.test(path)) continue;
        if (r.re.test(line)) out.push({ id: r.id, category: r.category, risk: r.risk, path, line: i + 1, title: r.title, evidence: line.trim().slice(0, 200), fix: r.fix });
      }
    });
    if (/\/api\/.*route\.[jt]s$/.test(path) && MUTATING.test(src) && !AUTH_HINT.test(src)) {
      const ln = lines.findIndex((l) => MUTATING.test(l));
      out.push({ id: "api-no-auth", category: "auth", risk: "high", path, line: ln + 1, title: "Мутирующий API-роут без видимой проверки доступа", evidence: (lines[ln] ?? "").trim(), fix: "Добавьте проверку сессии/ключа до выполнения действия и валидацию входа (zod)." });
    }
  }
  for (const s of scanFiles(files, secretAllowlist)) {
    out.push({ id: `secret:${s.ruleId}`, category: "secrets", risk: s.severity === "high" ? "critical" : "high", path: s.path, line: s.line, title: s.rule, evidence: s.preview, fix: s.advice });
  }
  const order: Record<Risk, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) => order[a.risk] - order[b.risk]);
}

/** Packages (name + minimal version) to send to OSV. Ranges are reduced to their base version. */
export function osvQueries(files: Record<string, string>): { name: string; version: string }[] {
  const raw = files["package.json"];
  if (!raw) return [];
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.devDependencies, ...pkg.dependencies };
    return Object.entries(all)
      .map(([name, range]) => ({ name, version: (/(\d+\.\d+\.\d+)/.exec(range) ?? [])[1] ?? "" }))
      .filter((q) => q.version);
  } catch {
    return [];
  }
}

/* ------------------------------ self-healing ------------------------------ */

export interface HealIssue {
  id: string;
  severity: "error" | "warn" | "info";
  title: string;
  detail: string;
  command?: string;
  fix?: Change[];
}

const major = (v: string | undefined) => Number(/(\d+)\./.exec(v ?? "")?.[1] ?? NaN);

export function diagnoseWorkspace(files: Record<string, string>, serverEnvPresent: Record<string, boolean> | null): HealIssue[] {
  const out: HealIssue[] = [];
  const raw = files["package.json"];
  const set = new Set(Object.keys(files));
  type Pkg = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  let pkg = null as Pkg | null;
  if (!raw) out.push({ id: "no-pkg", severity: "warn", title: "Нет package.json", detail: "Проект без манифеста зависимостей." });
  else {
    try {
      pkg = JSON.parse(raw) as Pkg;
    } catch (e) {
      out.push({ id: "bad-pkg", severity: "error", title: "package.json — невалидный JSON", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
  if (pkg) {
    const missing = new Set<string>();
    const unresolved: string[] = [];
    for (const [p, s] of Object.entries(files)) {
      if (!/\.[mc]?[jt]sx?$/.test(p)) continue;
      for (const spec of parseImports(s)) {
        if (spec.startsWith(".") || spec.startsWith("@/")) {
          if (!resolveImport(p, spec, set)) unresolved.push(`${p} → ${spec}`);
        } else if (!spec.startsWith("node:") && !/^(fs|path|os|crypto|http|https|url|util|stream|events|child_process|net|dns|zlib|buffer|assert|readline)$/.test(spec)) {
          const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec);
          if (!(name in deps) && !name.startsWith("next") && name !== "react") missing.add(name);
        }
      }
    }
    if (missing.size) out.push({ id: "missing-deps", severity: "error", title: `Не объявлены зависимости (${missing.size})`, detail: [...missing].join(", "), command: `npm install ${[...missing].join(" ")}` });
    if (unresolved.length) out.push({ id: "broken-imports", severity: "error", title: `Битые относительные импорты (${unresolved.length})`, detail: unresolved.slice(0, 8).join("\n") });
    const r = major(deps["react"]);
    const rd = major(deps["react-dom"]);
    if (!Number.isNaN(r) && !Number.isNaN(rd) && r !== rd) out.push({ id: "react-mismatch", severity: "error", title: "react и react-dom разных мажорных версий", detail: `react ${deps["react"]} vs react-dom ${deps["react-dom"]}`, command: `npm install react@${r} react-dom@${r}` });
    const tr = major(deps["@types/react"]);
    if (!Number.isNaN(r) && !Number.isNaN(tr) && r !== tr) out.push({ id: "types-react", severity: "warn", title: "@types/react не совпадает с react", detail: `react ${deps["react"]} vs @types/react ${deps["@types/react"]}`, command: `npm install -D @types/react@${r}` });
    const nx = major(deps["next"]);
    const ec = major(deps["eslint-config-next"]);
    if (!Number.isNaN(nx) && !Number.isNaN(ec) && nx !== ec) out.push({ id: "next-eslint", severity: "warn", title: "eslint-config-next не совпадает с next", detail: `next ${deps["next"]} vs eslint-config-next ${deps["eslint-config-next"]}`, command: `npm install -D eslint-config-next@${nx}` });
    if (!pkg.scripts?.build) out.push({ id: "no-build", severity: "warn", title: "Нет скрипта build", detail: "В package.json отсутствует scripts.build.", fix: [{ path: "package.json", before: raw ?? null, after: JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, build: "next build" } }, null, 2) }] });
  }
  if (files["tsconfig.json"]) {
    try {
      JSON.parse(files["tsconfig.json"].replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      out.push({ id: "bad-tsconfig", severity: "error", title: "tsconfig.json не парсится", detail: "Проверьте синтаксис JSON." });
    }
  } else if (Object.keys(files).some((p) => /\.tsx?$/.test(p))) out.push({ id: "no-tsconfig", severity: "warn", title: "Есть TS-файлы, но нет tsconfig.json", detail: "Компилятор TypeScript не сможет проверить проект." });
  // env variables used in code
  const used = new Set<string>();
  for (const [p, s] of Object.entries(files)) {
    if (!/\.[mc]?[jt]sx?$/.test(p)) continue;
    for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) if (m[1] && !/^(NODE_ENV|NEXT_RUNTIME|VERCEL\w*|CI)$/.test(m[1])) used.add(m[1]);
  }
  if (used.size) {
    const example = files[".env.example"] ?? "";
    const undocumented = [...used].filter((n) => !new RegExp(`^#?\\s*${n}=`, "m").test(example));
    if (undocumented.length) out.push({ id: "env-undocumented", severity: "warn", title: `Переменные окружения не описаны в .env.example (${undocumented.length})`, detail: undocumented.join(", "), fix: [{ path: ".env.example", before: files[".env.example"] ?? null, after: `${example.trimEnd()}${example ? "\n" : ""}${undocumented.map((n) => `${n}=`).join("\n")}\n` }] });
    if (serverEnvPresent) {
      const absent = [...used].filter((n) => n in serverEnvPresent && !serverEnvPresent[n]);
      if (absent.length) out.push({ id: "env-missing", severity: "error", title: `На сервере не заданы переменные (${absent.length})`, detail: absent.join(", ") });
    }
  }
  return out;
}
