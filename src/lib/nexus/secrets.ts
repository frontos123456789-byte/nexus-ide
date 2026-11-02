/** Secret detection + redaction. Used by the scanner, replay log, snapshots and the AI gateway. */

export interface SecretRule {
  id: string;
  name: string;
  re: RegExp;
  severity: "high" | "medium";
  /** Capture group holding the secret value (0 = whole match). */
  group?: number;
  generic?: boolean;
}

export const SECRET_RULES: SecretRule[] = [
  { id: "aws-key", name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/g, severity: "high" },
  { id: "github-token", name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, severity: "high" },
  { id: "openrouter-key", name: "OpenRouter key", re: /\bsk-or-v1-[a-f0-9]{32,}\b/g, severity: "high" },
  { id: "vercel-token", name: "Vercel token", re: /\bvcp_[A-Za-z0-9]{30,}\b/g, severity: "high" },
  { id: "openai-key", name: "API key (sk-…)", re: /\bsk-[A-Za-z0-9_-]{24,}\b/g, severity: "high" },
  { id: "slack-token", name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, severity: "high" },
  { id: "stripe-key", name: "Stripe key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, severity: "high" },
  { id: "google-key", name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "high" },
  { id: "figma-token", name: "Figma token", re: /\bfigd_[A-Za-z0-9_-]{20,}\b/g, severity: "high" },
  { id: "private-key", name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, severity: "high" },
  { id: "jwt", name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: "medium" },
  {
    id: "db-url",
    name: "URL БД с паролем",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/'"]+:([^\s@/'"]+)@[^\s'"]+/g,
    severity: "high",
    group: 1,
  },
  {
    id: "generic-secret",
    name: "Жёстко заданный секрет",
    re: /(?:api[_-]?key|secret|token|passw(?:or)?d|auth)\w*["']?\s*[:=]\s*["']([A-Za-z0-9_\-/+=.]{16,})["']/gi,
    severity: "medium",
    group: 1,
    generic: true,
  },
];

const PLACEHOLDER = /(your[_-]|example|xxxx|changeme|placeholder|<[^>]+>|process\.env|\$\{|\*{3,}|redacted|dummy|sample|test[_-]?key)/i;

export function entropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function maskSecret(s: string): string {
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.min(12, s.length - 6))}${s.slice(-2)}`;
}

export function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface SecretFinding {
  path: string;
  line: number;
  ruleId: string;
  rule: string;
  severity: "high" | "medium";
  preview: string;
  fingerprint: string;
  advice: string;
}

const ADVICE =
  "Отзовите ключ у провайдера, вынесите значение в переменную окружения (process.env.NAME), добавьте файл с секретом в .gitignore и храните шаблон в .env.example.";

export function scanText(path: string, text: string, allowlist: string[] = []): SecretFinding[] {
  const out: SecretFinding[] = [];
  const isExample = /\.env\.example$|\.md$/i.test(path);
  const isTest = /\.(test|spec)\.[jt]sx?$/.test(path);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line.includes("nexus-ignore")) return;
    const seen = new Set<string>();
    for (const rule of SECRET_RULES) {
      if (rule.generic && (isExample || isTest)) continue;
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(line))) {
        const value = m[rule.group ?? 0] ?? m[0];
        if (m[0] === "") rule.re.lastIndex++;
        if (PLACEHOLDER.test(value) || PLACEHOLDER.test(m[0])) continue;
        if (rule.generic && entropy(value) < 3) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        const fp = fingerprint(`${path}:${rule.id}:${value}`);
        if (allowlist.includes(fp)) continue;
        out.push({
          path,
          line: i + 1,
          ruleId: rule.id,
          rule: rule.name,
          severity: rule.severity,
          preview: maskSecret(value),
          fingerprint: fp,
          advice: ADVICE,
        });
      }
    }
  });
  return out;
}

export function scanFiles(files: Record<string, string>, allowlist: string[] = []): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (/node_modules\/|\.lock$|package-lock\.json$/.test(path)) continue;
    out.push(...scanText(path, text, allowlist));
  }
  return out;
}

/** Replaces anything that looks like a secret so it never lands in logs. */
export function redact(text: string): string {
  let out = text;
  for (const rule of SECRET_RULES) {
    out = out.replace(rule.re, (match: string, ...args: unknown[]) => {
      if (rule.generic || rule.group) {
        const g = args[(rule.group ?? 1) - 1];
        if (typeof g === "string" && g) return match.replace(g, `[REDACTED:${rule.id}]`);
      }
      return `[REDACTED:${rule.id}]`;
    });
  }
  return out;
}
