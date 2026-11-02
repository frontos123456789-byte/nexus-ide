import { Suspense } from "react";
import { Loading } from "@/components/simple/ui";
import { ProjectView } from "@/components/simple/ProjectView";

export const metadata = { title: "Проект — Nexus" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="p-6"><Loading text="Открываю проект…" /></div>}>
      <ProjectView id={decodeURIComponent(id)} />
    </Suspense>
  );
}
