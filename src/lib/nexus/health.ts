import { parseImports } from "./graph";

export interface HealthComponent {
  id: string;
  name: string;
  weight: number;
  available: boolean;
  /** 0–100. */
  value: number;
  detail: string;
}

export interface HealthReport {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: HealthComponent[];
  hotspots: { path: string; density: number; decisions: number; lines: number }[];
  formula: string;
}

const CODE = /\.[mc]?[jt]sx?$/;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export function decisionCount(src: string): number {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  const m = stripped.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?\?|\?(?=[^.?])/g);
  return m ? m.length : 0;
}

export function duplicationPercent(files: Record<string, string>, window = 6): number {
  const seen = new Map<string, number>();
  let total = 0;
  const marks: { key: string; path: string; line: number }[] = [];
  for (const [path, src] of Object.entries(files)) {
    if (!CODE.test(path)) continue;
    const lines = src.split("\n").map((l) => l.trim()).filter((l) => l.length > 3 && !/^[{}()\];,]*$/.test(l) && !l.startsWith("import "));
    total += lines.length;
    for (let i = 0; i + window <= lines.length; i++) {
      const key = lines.slice(i, i + window).join("\n");
      seen.set(key, (seen.get(key) ?? 0) + 1);
      marks.push({ key, path, line: i });
    }
  }
  if (total === 0) return 0;
  const dupLines = new Set<string>();
  for (const m of marks) if ((seen.get(m.key) ?? 0) > 1) for (let k = 0; k < window; k++) dupLines.add(`${m.path}:${m.line + k}`);
  return (dupLines.size / total) * 100;
}

const LINT_RULES: { id: string; re: RegExp }[] = [
  { id: "console", re: /\bconsole\.(log|debug)\(/ },
  { id: "any", re: /:\s*any\b|\bas any\b/ },
  { id: "debugger", re: /\bdebugger\b/ },
  { id: "eqeq", re: /[^=!]==[^=]/ },
  { id: "todo", re: /\b(TODO|FIXME|HACK)\b/ },
  { id: "eval", re: /\beval\(/ },
];

export function lintIssues(files: Record<string, string>): { total: number; lines: number; byRule: Record<string, number> } {
  let total = 0;
  let lines = 0;
  const byRule: Record<string, number> = {};
  for (const [path, src] of Object.entries(files)) {
    if (!CODE.test(path) || /\.(test|spec)\./.test(path)) continue;
    const ls = src.split("\n");
    lines += ls.length;
    for (const l of ls) for (const r of LINT_RULES) if (r.re.test(l)) {
      total++;
      byRule[r.id] = (byRule[r.id] ?? 0) + 1;
    }
  }
  return { total, lines, byRule };
}

export function dependencyHealth(files: Record<string, string>): { value: number; detail: string } | null {
  const raw = files["package.json"];
  if (!raw) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch {
    return { value: 0, detail: "package.json содержит невалидный JSON" };
  }
  const deps = { ...pkg.dependencies };
  const names = Object.keys(deps);
  const used = new Set<string>();
  for (const [p, s] of Object.entries(files)) {
    if (!CODE.test(p)) continue;
    for (const spec of parseImports(s)) {
      if (spec.startsWith(".") || spec.startsWith("@/")) continue;
      used.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec));
    }
  }
  const unused = names.filter((n) => !used.has(n) && !/^(react-dom|next|typescript)$/.test(n));
  const loose = names.filter((n) => /^(\*|latest|git|http)/.test(deps[n] ?? ""));
  const penalty = unused.length * 6 + loose.length * 10 + Math.max(0, names.length - 40) * 1.5;
  return { value: clamp(100 - penalty), detail: `${names.length} зависимостей, неиспользуемых: ${unused.length}, нефиксированных версий: ${loose.length}` };
}

export const HEALTH_FORMULA =
  "Score = Σ(вес_i × значение_i) / Σ(вес_i доступных). Сложность (25%): 100 − 2.5×(плотность ветвлений на 100 строк − 10). Дублирование (20%): 100 − 4×(% дублированных строк). Типы (20%): 100 − 5×(ошибки TS из Monaco). Линтер (15%): 100 − 10×(замечаний на 100 строк). Зависимости (10%): 100 − штрафы за неиспользуемые/нефиксированные. Покрытие (10%): недоступно в браузере → исключается, веса пересчитываются.";

export function computeHealth(files: Record<string, string>, typeErrors: number | null): HealthReport {
  const code = Object.entries(files).filter(([p]) => CODE.test(p) && !/\.(test|spec)\./.test(p));
  let decisions = 0;
  let lines = 0;
  const hotspots = code.map(([path, src]) => {
    const d = decisionCount(src);
    const l = src.split("\n").filter((x) => x.trim()).length;
    decisions += d;
    lines += l;
    return { path, density: l ? (d / l) * 100 : 0, decisions: d, lines: l };
  });
  const density = lines ? (decisions / lines) * 100 : 0;
  const dup = duplicationPercent(files);
  const lint = lintIssues(files);
  const lintDensity = lint.lines ? (lint.total / lint.lines) * 100 : 0;
  const dep = dependencyHealth(files);
  const components: HealthComponent[] = [
    { id: "complexity", name: "Сложность", weight: 25, available: lines > 0, value: clamp(100 - clamp((density - 10) * 2.5)), detail: `${density.toFixed(1)} ветвлений на 100 строк` },
    { id: "duplication", name: "Дублирование", weight: 20, available: lines > 0, value: clamp(100 - dup * 4), detail: `${dup.toFixed(1)}% дублированных строк` },
    { id: "types", name: "Ошибки типов", weight: 20, available: typeErrors !== null, value: clamp(100 - (typeErrors ?? 0) * 5), detail: typeErrors === null ? "Monaco ещё не проанализировал файлы — откройте TS-файлы" : `${typeErrors} ошибок TS` },
    { id: "lint", name: "Линтер (эвристики)", weight: 15, available: lint.lines > 0, value: clamp(100 - lintDensity * 10), detail: `${lint.total} замечаний (${Object.entries(lint.byRule).map(([k, v]) => `${k}:${v}`).join(", ") || "нет"})` },
    { id: "deps", name: "Зависимости", weight: 10, available: dep !== null, value: dep?.value ?? 0, detail: dep?.detail ?? "package.json не найден" },
    { id: "coverage", name: "Покрытие тестами", weight: 10, available: false, value: 0, detail: "Покрытие недоступно: тесты не исполняются в браузере" },
  ];
  const avail = components.filter((c) => c.available);
  const wsum = avail.reduce((n, c) => n + c.weight, 0);
  const score = wsum ? Math.round(avail.reduce((n, c) => n + c.weight * c.value, 0) / wsum) : 0;
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, components, hotspots: hotspots.sort((a, b) => b.density * Math.log(b.lines + 2) - a.density * Math.log(a.lines + 2)).slice(0, 8), formula: HEALTH_FORMULA };
}
