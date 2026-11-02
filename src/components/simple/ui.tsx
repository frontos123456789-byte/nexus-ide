"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/* One design language: big targets (≥ 52px), 18px body text, solid contrast, text labels next to every icon. */

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

const btnBase =
  "inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-2xl px-5 text-[1.0625rem] font-semibold leading-tight transition-colors disabled:pointer-events-none disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-indigo-500 text-white hover:bg-indigo-400 active:bg-indigo-600",
  secondary: "border-2 border-border-strong bg-panel-2 text-foreground hover:bg-hover",
  ghost: "text-subtle hover:bg-hover hover:text-foreground",
  danger: "bg-red-600 text-white hover:bg-red-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-500",
};

export function Button({ variant = "primary", className, type = "button", ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type={type} {...p} className={cn(btnBase, variants[variant], className)} />;
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={cn(btnBase, variants[variant], className)} />;
}

export function Panel({ className, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cn("min-w-0 rounded-3xl border border-border-strong bg-panel-2 p-5", className)} />;
}

export function PageTitle({ title, subtitle, back }: { title: string; subtitle?: string; back?: { href: string; label: string } }) {
  return (
    <header className="mb-5">
      {back && (
        <LinkButton href={back.href} variant="ghost" className="mb-2 -ml-3 min-h-12 px-3 text-base">
          <ArrowLeft className="size-5" aria-hidden />
          {back.label}
        </LinkButton>
      )}
      <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight sm:text-[2rem]">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[1.0625rem] leading-relaxed text-subtle">{subtitle}</p>}
    </header>
  );
}

const fieldCls =
  "w-full rounded-2xl border-2 border-border-strong bg-background px-4 text-[1.0625rem] text-foreground placeholder:text-muted focus:border-indigo-400";

export function TextInput({ label, hint, className, ...p }: ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-base font-semibold">{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-h` : undefined} {...p} className={cn(fieldCls, "min-h-[3.25rem]", className)} />
      {hint && <p id={`${id}-h`} className="mt-1.5 text-[0.9375rem] text-muted">{hint}</p>}
    </div>
  );
}

export function TextArea({ label, hint, className, ...p }: ComponentProps<"textarea"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-base font-semibold">{label}</label>
      <textarea id={id} aria-describedby={hint ? `${id}-h` : undefined} {...p} className={cn(fieldCls, "min-h-32 resize-y py-3 leading-relaxed", className)} />
      {hint && <p id={`${id}-h`} className="mt-1.5 text-[0.9375rem] text-muted">{hint}</p>}
    </div>
  );
}

/** A tap-able suggestion. Text first — never an icon alone. */
export function Chip({ selected, className, ...p }: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...p}
      className={cn(
        "min-h-[3.25rem] rounded-2xl border-2 px-4 text-left text-[1.0625rem] font-medium leading-snug transition-colors",
        selected ? "border-indigo-400 bg-indigo-500/20 text-foreground" : "border-border-strong bg-panel-2 text-subtle hover:border-indigo-400/60 hover:text-foreground",
        className,
      )}
    >
      {selected && <span className="mr-1.5" aria-hidden>✓</span>}
      {p.children}
    </button>
  );
}

/** Nexus speaking in the first person, like a helper next to you. */
export function NexusSays({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3" role="status">
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-indigo-500/25 text-indigo-200" aria-hidden><Sparkles className="size-5" /></span>
      <div className="min-w-0 rounded-3xl rounded-tl-lg border border-border-strong bg-panel-2 px-4 py-3 text-[1.1875rem] leading-relaxed">{children}</div>
    </div>
  );
}

type Tone = "info" | "success" | "warn" | "error";
const toneCls: Record<Tone, string> = {
  info: "border-sky-500/50 bg-sky-500/10 text-sky-100",
  success: "border-emerald-500/50 bg-emerald-500/10 text-emerald-100",
  warn: "border-amber-500/60 bg-amber-500/10 text-amber-100",
  error: "border-red-500/60 bg-red-500/10 text-red-100",
};
const toneLabel: Record<Tone, string> = { info: "Важно знать", success: "Готово", warn: "Обратите внимание", error: "Не получилось" };

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: string; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-2xl border-2 p-4", toneCls[tone])}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 text-[1.0625rem] leading-relaxed">
          <p className="font-bold">{title ?? toneLabel[tone]}</p>
          <div className="mt-0.5 break-words">{children}</div>
          {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({ message, onRetry, extra }: { message: string; onRetry?: () => void; extra?: ReactNode }) {
  return (
    <Notice
      tone="error"
      title="Не получилось"
      action={
        <>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              <RotateCcw className="size-5" aria-hidden />Попробовать ещё раз
            </Button>
          )}
          {extra}
        </>
      }
    >
      {message}
    </Notice>
  );
}

export function Loading({ text = "Подождите, это займёт меньше минуты…" }: { text?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border-2 border-border-strong bg-panel-2 p-4 text-[1.0625rem]">
      <Loader2 className="size-6 shrink-0 animate-spin text-indigo-300" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-border-strong p-8 text-center">
      <p className="text-xl font-bold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[1.0625rem] leading-relaxed text-subtle">{text}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Every risky action goes through this. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  confirmLabel,
  cancelLabel = "Нет, отмена",
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  text: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/75" />
        <Dialog.Content className="fixed inset-x-3 top-1/2 z-[81] mx-auto max-h-[90dvh] w-auto max-w-md -translate-y-1/2 overflow-y-auto rounded-3xl border-2 border-border-strong bg-panel p-6 shadow-2xl outline-none">
          <Dialog.Title className="text-xl font-bold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-3 text-[1.0625rem] leading-relaxed text-subtle">{text}</div>
          </Dialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
            <Button
              variant={danger ? "danger" : "primary"}
              onClick={async () => {
                await onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Plain-words help that stays out of the way until asked for. */
export function Help({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border-2 border-border-strong bg-panel-2 p-4">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-[1.0625rem] font-semibold [&::-webkit-details-marker]:hidden">
        <Info className="size-5 shrink-0 text-sky-300" aria-hidden />
        {title}
        <span className="ml-auto text-sm font-normal text-muted group-open:hidden">Показать</span>
        <span className="ml-auto hidden text-sm font-normal text-muted group-open:inline">Скрыть</span>
      </summary>
      <div className="mt-3 space-y-2 text-[1.0625rem] leading-relaxed text-subtle">{children}</div>
    </details>
  );
}

export function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <p className="mb-4 text-base font-semibold text-subtle" aria-label={`Шаг ${step} из ${total}`}>
      Шаг {step} из {total}
      <span className="ml-3 inline-flex gap-1.5 align-middle" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-2 w-8 rounded-full", i < step ? "bg-indigo-400" : "bg-border-strong")} />
        ))}
      </span>
    </p>
  );
}
