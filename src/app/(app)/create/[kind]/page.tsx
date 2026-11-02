import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BotWizard } from "@/components/simple/wizards/BotWizard";
import { BuildWizard } from "@/components/simple/wizards/BuildWizard";
import { DeckWizard } from "@/components/simple/wizards/DeckWizard";
import { Loading } from "@/components/simple/ui";

export const metadata = { title: "Создание — Nexus" };

export default async function CreateKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const body =
    kind === "site" || kind === "app" ? <BuildWizard kind={kind} /> : kind === "bot" ? <BotWizard /> : kind === "presentation" ? <DeckWizard /> : null;
  if (!body) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <Suspense fallback={<Loading text="Открываю…" />}>{body}</Suspense>
    </div>
  );
}
