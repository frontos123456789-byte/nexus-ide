/** Design tokens + animation export helpers (pure). */

export interface TokenSet {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  fonts: Record<string, string>;
}

export interface ThemeDef {
  name: string;
  tokens: TokenSet;
}

export const DEFAULT_TOKENS: TokenSet = {
  colors: { background: "#0a0a0a", foreground: "#e4e4e7", accent: "#6366f1", muted: "#71717a" },
  spacing: { sm: "8px", md: "16px", lg: "24px" },
  radius: { sm: "4px", md: "8px", lg: "16px" },
  fonts: { sans: "ui-sans-serif, system-ui, sans-serif", mono: "ui-monospace, Menlo, monospace" },
};

const safeName = (s: string) => s.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

export function tokensToCss(themes: ThemeDef[]): string {
  const block = (sel: string, t: TokenSet) => {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(t.colors)) lines.push(`  --color-${safeName(k)}: ${v};`);
    for (const [k, v] of Object.entries(t.spacing)) lines.push(`  --space-${safeName(k)}: ${v};`);
    for (const [k, v] of Object.entries(t.radius)) lines.push(`  --radius-${safeName(k)}: ${v};`);
    for (const [k, v] of Object.entries(t.fonts)) lines.push(`  --font-${safeName(k)}: ${v};`);
    return `${sel} {\n${lines.join("\n")}\n}`;
  };
  return themes
    .map((th, i) => block(i === 0 ? ":root" : `[data-theme="${safeName(th.name)}"]`, th.tokens))
    .join("\n\n")
    .concat("\n");
}

/** Tailwind v4 `@theme` block. */
export function tokensToTailwind(t: TokenSet): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(t.colors)) lines.push(`  --color-${safeName(k)}: ${v};`);
  for (const [k, v] of Object.entries(t.spacing)) lines.push(`  --spacing-${safeName(k)}: ${v};`);
  for (const [k, v] of Object.entries(t.radius)) lines.push(`  --radius-${safeName(k)}: ${v};`);
  for (const [k, v] of Object.entries(t.fonts)) lines.push(`  --font-${safeName(k)}: ${v};`);
  return `@theme {\n${lines.join("\n")}\n}\n`;
}

/** Parses `--name: value;` declarations from CSS to sync tokens from the project. */
export function parseCssVars(css: string): TokenSet {
  const out: TokenSet = { colors: {}, spacing: {}, radius: {}, fonts: {} };
  for (const m of css.matchAll(/--(color|space|spacing|radius|font)-([\w-]+)\s*:\s*([^;]+);/g)) {
    const kind = m[1];
    const name = m[2] ?? "";
    const value = (m[3] ?? "").trim();
    if (kind === "color") out.colors[name] = value;
    else if (kind === "space" || kind === "spacing") out.spacing[name] = value;
    else if (kind === "radius") out.radius[name] = value;
    else out.fonts[name] = value;
  }
  return out;
}

export interface Keyframe {
  at: number; // 0..100
  props: Record<string, string>;
}
export interface Animation {
  name: string;
  duration: number;
  easing: string;
  iterations: number | "infinite";
  keyframes: Keyframe[];
}

export const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out", "cubic-bezier(0.16, 1, 0.3, 1)", "steps(6, end)"];

export function animationToCss(a: Animation): string {
  const name = safeName(a.name) || "anim";
  const frames = [...a.keyframes]
    .sort((x, y) => x.at - y.at)
    .map((k) => `  ${k.at}% {\n${Object.entries(k.props).map(([p, v]) => `    ${p}: ${v};`).join("\n")}\n  }`)
    .join("\n");
  return `@keyframes ${name} {\n${frames}\n}\n\n.${name} {\n  animation: ${name} ${a.duration}ms ${a.easing} ${a.iterations};\n}\n`;
}

/** Framer-motion-like export for projects that use it. */
export function animationToJs(a: Animation): string {
  const ks = [...a.keyframes].sort((x, y) => x.at - y.at);
  const props = new Set(ks.flatMap((k) => Object.keys(k.props)));
  const obj: Record<string, string[]> = {};
  for (const p of props) obj[p] = ks.map((k) => k.props[p] ?? "");
  return `export const ${safeName(a.name).replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) || "anim"} = {\n  animate: ${JSON.stringify(obj, null, 2)},\n  transition: { duration: ${a.duration / 1000}, ease: ${JSON.stringify(a.easing)}, times: ${JSON.stringify(ks.map((k) => k.at / 100))} },\n};\n`;
}

/* --------------------------------- colors --------------------------------- */

export function parseColor(input: string): [number, number, number, number] | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m?.[1]) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    if (h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  return null;
}

function lum([r, g, b]: [number, number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
