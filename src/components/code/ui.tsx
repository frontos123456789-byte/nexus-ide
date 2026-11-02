"use client";

import { cn } from "@/lib/utils/cn";

export const inputCls = "min-h-11 w-full rounded-xl border border-border-strong bg-background px-3 text-[16px] text-foreground outline-none placeholder:text-muted focus:border-accent sm:text-sm";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Btn({ variant = "primary", className, ...p }: React.ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" | "success" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-accent text-white hover:bg-accent-soft",
        variant === "ghost" && "border border-border-strong text-subtle hover:bg-hover hover:text-foreground",
        variant === "danger" && "bg-red-500/85 text-white hover:bg-red-500",
        variant === "success" && "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
        className,
      )}
    />
  );
}

export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div {...p} className={cn("min-w-0 rounded-2xl border border-border bg-panel-2 p-4", className)} />;
}

export function Pill({ tone = "muted", children }: { tone?: "ok" | "err" | "warn" | "muted" | "accent"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tone === "ok" && "bg-emerald-500/15 text-emerald-300", tone === "err" && "bg-red-500/15 text-red-300", tone === "warn" && "bg-amber-500/15 text-amber-300", tone === "accent" && "bg-accent/15 text-accent-soft", tone === "muted" && "bg-hover text-subtle")}>
      {children}
    </span>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info" | "err"; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border px-3 py-2 text-xs leading-relaxed", tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-200", tone === "info" && "border-sky-500/30 bg-sky-500/10 text-sky-200", tone === "err" && "border-red-500/30 bg-red-500/10 text-red-200")}>{children}</div>;
}

export async function generateText(system: string, prompt: string, preferredModel?: string, maxTokens = 6000): Promise<string> {
  const res = await fetch("/api/ai/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system, prompt, preferredModel: preferredModel || undefined, maxTokens }) });
  const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || !j.text) throw new Error(j.error ?? "Не удалось получить ответ ИИ");
  return j.text;
}
