"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { detectIntent } from "@/lib/simple/intent";
import { allDrafts, KIND_LABEL, listUnified, type Draft, type UnifiedProject } from "@/lib/simple/projects";
import { useSettings } from "@/lib/settings/store";
import { Logo } from "@/components/ide/Layout/Logo";
import { Button, Panel, TextArea } from "./ui";
import { CREATE_ACTIONS, EXTRA_ACTIONS, formatDate, KIND_ICON, KIND_TINT } from "./kinds";

const EXAMPLES = [
  "Хочу красивый сайт для продажи домашних тортов",
  "Сделай презентацию про космос на 10 слайдов",
  "Сделай Telegram-бота для записи клиентов",
  "Сделай приложение для записи клиентов в парикмахерскую",
];

export function Home() {
  const router = useRouter();
  const hydrated = useSettings((s) => s.hydrated);
  const welcomeDone = useSettings((s) => s.welcomeDone);
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<UnifiedProject[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    // Returning from GitHub/Vercel sign-in: show the result where the connections live.
    if (new URLSearchParams(window.location.search).has("settings")) {
      router.replace(`/settings${window.location.search}#accounts`);
      return;
    }
    void listUnified().then((l) => setRecent(l.slice(0, 3))).catch(() => undefined);
    setDrafts(allDrafts());
  }, [router]);

  const go = (value: string) => {
    const v = value.trim();
    if (!v) return;
    useSettings.getState().set({ welcomeDone: true });
    const intent = detectIntent(v);
    router.push(intent === "chat" ? `/chat?q=${encodeURIComponent(v)}` : `/create/${intent}?q=${encodeURIComponent(v)}`);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6 sm:px-8 sm:py-10">
      {hydrated && !welcomeDone && (
        <Panel className="relative border-indigo-400/60 bg-indigo-500/10" role="region" aria-label="Приветствие">
          <button onClick={() => useSettings.getState().set({ welcomeDone: true })} aria-label="Закрыть приветствие" className="absolute right-3 top-3 grid size-12 place-items-center rounded-xl text-subtle hover:bg-hover"><X className="size-6" /></button>
          <div className="flex items-start gap-4 pr-10">
            <Logo className="size-12 shrink-0" />
            <div>
              <p className="text-[1.25rem] font-bold leading-snug">Привет! Я Nexus.</p>
              <p className="mt-1 text-[1.0625rem] leading-relaxed text-subtle">Помогу создать сайт, бота, презентацию или приложение. Что хотите сделать?</p>
            </div>
          </div>
          <Button variant="ghost" className="mt-3" onClick={() => useSettings.getState().set({ welcomeDone: true })}>Пропустить подсказки</Button>
        </Panel>
      )}

      <section aria-labelledby="home-title">
        <h1 id="home-title" className="text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.5rem]">Что вы хотите сделать?</h1>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            go(text);
          }}
        >
          <TextArea
            label="Опишите, что хотите создать или о чём хотите спросить…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go(text);
            }}
            placeholder="Например: хочу сайт для моей кофейни"
            className="min-h-36 text-[1.1875rem]"
          />
          <Button type="submit" disabled={!text.trim()} className="w-full sm:w-auto sm:min-w-56">
            Начать<ArrowRight className="size-5" aria-hidden />
          </Button>
        </form>
        {hydrated && !welcomeDone && (
          <div className="mt-5">
            <p className="mb-2 text-base font-semibold">Например, нажмите на любую фразу:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => go(e)} className="min-h-[3.25rem] rounded-2xl border-2 border-border-strong bg-panel px-4 py-2 text-left text-[1.0625rem] leading-snug hover:border-indigo-400">{e}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-label="Что можно сделать">
        <div className="grid gap-3 sm:grid-cols-2">
          {[...CREATE_ACTIONS, ...EXTRA_ACTIONS].map((a) => (
            <Link key={a.href} href={a.href} className="flex min-h-[5.5rem] items-center gap-4 rounded-3xl border-2 border-border-strong bg-panel-2 p-4 transition-colors hover:border-indigo-400">
              <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${a.tint}`} aria-hidden><a.icon className="size-8" /></span>
              <span className="min-w-0">
                <span className="block text-[1.1875rem] font-bold leading-tight">{a.title}</span>
                <span className="mt-0.5 block text-base leading-snug text-subtle">{a.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {(drafts.length > 0 || recent.length > 0) && (
        <section aria-labelledby="continue-title" className="space-y-3">
          <h2 id="continue-title" className="text-xl font-bold">Продолжить работу</h2>
          {drafts.map((d) => (
            <Link key={d.kind} href={`/create/${d.kind}`} className="flex min-h-[4.25rem] items-center justify-between gap-3 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 px-4 py-3 hover:border-amber-400">
              <span className="min-w-0"><span className="block text-[1.0625rem] font-semibold">Незавершённое: {KIND_LABEL[d.kind].toLowerCase()}</span><span className="block text-base text-subtle">Сохранено {formatDate(d.updatedAt)}. Нажмите, чтобы продолжить.</span></span>
              <ArrowRight className="size-6 shrink-0" aria-hidden />
            </Link>
          ))}
          {recent.map((p) => {
            const Icon = KIND_ICON[p.kind];
            return (
              <Link key={p.key} href={`/projects/${p.key}`} className="flex min-h-[4.25rem] items-center gap-3 rounded-2xl border-2 border-border-strong bg-panel-2 px-4 py-3 hover:border-indigo-400">
                <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${KIND_TINT[p.kind]}`} aria-hidden><Icon className="size-6" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[1.0625rem] font-semibold">{p.name}</span><span className="block text-base text-subtle">{KIND_LABEL[p.kind]} · изменено {formatDate(p.updatedAt)}</span></span>
                <span className="shrink-0 text-base font-semibold text-indigo-200">Открыть</span>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
