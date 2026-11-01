/**
 * Parser for the Work-mode response format:
 *   <thinking>…</thinking>
 *   <plan>
 *   goal: …
 *   1. Title | detail | S
 *   </plan>
 * Tolerant of partially streamed (unclosed) tags and of untagged numbered lists.
 */

export type StepSize = "XS" | "S" | "M" | "L" | "XL";

export interface ParsedStep {
  title: string;
  detail: string;
  size: StepSize;
}

export interface ParsedWork {
  thinking: string;
  thinkingClosed: boolean;
  goal: string;
  steps: ParsedStep[];
  planClosed: boolean;
  /** Text outside of the tags (shown only if the model ignored the format). */
  rest: string;
}

const SIZES = new Set(["XS", "S", "M", "L", "XL"]);

export function parseStepLine(line: string): ParsedStep | null {
  const cleaned = line
    .trim()
    .replace(/^(?:[-*•]\s+)?(?:\[[ xX]\]\s*)?(?:\d+[.):]\s*)?/, "")
    .replace(/\*\*/g, "")
    .trim();
  if (!cleaned || /^(goal|цель)\s*:/i.test(cleaned)) return null;
  const parts = cleaned.split("|").map((p) => p.trim());
  const title = parts[0];
  if (!title || title.length < 2) return null;
  let size: StepSize = "M";
  const details: string[] = [];
  for (const p of parts.slice(1)) {
    const up = p.toUpperCase();
    if (SIZES.has(up)) size = up as StepSize;
    else if (p) details.push(p);
  }
  return { title, detail: details.join(" — "), size };
}

function between(text: string, open: string, close: string): { body: string; closed: boolean; found: boolean } {
  const start = text.indexOf(open);
  if (start === -1) return { body: "", closed: false, found: false };
  const from = start + open.length;
  const end = text.indexOf(close, from);
  if (end === -1) return { body: text.slice(from), closed: false, found: true };
  return { body: text.slice(from, end), closed: true, found: true };
}

export function parseWork(text: string): ParsedWork {
  const thinking = between(text, "<thinking>", "</thinking>");
  const plan = between(text, "<plan>", "</plan>");

  let goal = "";
  const steps: ParsedStep[] = [];
  const planLines = plan.found ? plan.body.split("\n") : [];

  if (plan.found) {
    for (const line of planLines) {
      const g = line.trim().match(/^(?:goal|цель)\s*:\s*(.+)$/i);
      if (g) {
        goal = g[1].trim();
        continue;
      }
      const step = parseStepLine(line);
      if (step && /^\s*(?:[-*•]|\d+[.):]|\[[ xX]\])/.test(line)) steps.push(step);
    }
  } else {
    // Fallback: a plain numbered list somewhere in the text.
    for (const line of text.split("\n")) {
      if (/^\s*\d+[.)]\s+\S/.test(line)) {
        const step = parseStepLine(line);
        if (step) steps.push(step);
      }
    }
  }

  let rest = text;
  if (thinking.found) rest = rest.replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/, "");
  if (plan.found) rest = rest.replace(/<plan>[\s\S]*?(?:<\/plan>|$)/, "");

  return {
    thinking: thinking.body.trim(),
    thinkingClosed: thinking.closed,
    goal,
    steps,
    planClosed: plan.closed,
    rest: plan.found || thinking.found ? rest.trim() : "",
  };
}
