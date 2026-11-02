import Link from "next/link";
import { CREATE_ACTIONS } from "@/components/simple/kinds";
import { PageTitle } from "@/components/simple/ui";

export const metadata = { title: "Создать — Nexus" };

export default function CreatePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <PageTitle title="Что создаём?" subtitle="Выберите, что хотите получить. Дальше я задам несколько простых вопросов и всё сделаю сама." />
      <div className="grid gap-3 sm:grid-cols-2">
        {CREATE_ACTIONS.map((a) => (
          <Link key={a.id} href={a.href} className="flex min-h-[7rem] items-center gap-4 rounded-3xl border-2 border-border-strong bg-panel-2 p-5 transition-colors hover:border-indigo-400">
            <span className={`grid size-16 shrink-0 place-items-center rounded-2xl ${a.tint}`} aria-hidden><a.icon className="size-9" /></span>
            <span className="min-w-0">
              <span className="block text-[1.3125rem] font-bold leading-tight">{a.title.replace("Создать ", "").replace(/^./, (c) => c.toUpperCase())}</span>
              <span className="mt-1 block text-[1.0625rem] leading-snug text-subtle">{a.hint}</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-[1.0625rem] text-subtle">Не знаете, с чего начать? <Link href="/chat" className="font-semibold text-indigo-200 underline underline-offset-4">Спросите у AI-чата</Link>.</p>
    </div>
  );
}
