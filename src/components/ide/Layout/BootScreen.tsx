import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "./Logo";

/** Skeleton shell shown during SSR and while the workspace boots from IndexedDB. */
export function BootScreen() {
  return (
    <div className="flex h-dvh w-screen flex-col bg-background" role="status" aria-label="Загрузка Nexus IDE">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3">
        <Logo className="size-4" />
        <Skeleton className="h-3 w-24" />
        <div className="mx-auto">
          <Skeleton className="h-5 w-72 rounded-md" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-11 flex-col items-center gap-3 border-r border-border py-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="size-5" />
          ))}
        </div>
        <div className="w-[240px] space-y-2 border-r border-border p-3">
          <Skeleton className="h-3 w-20" />
          {[70, 55, 80, 60, 75, 50, 65].map((w, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: `${w}%`, marginLeft: i % 3 === 0 ? 0 : 14 }} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 items-center gap-2 border-b border-border px-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="flex-1 space-y-2 p-6">
            {[40, 65, 30, 55, 48, 72, 36, 60].map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
        <div className="hidden w-[340px] space-y-3 border-l border-border p-3 md:block">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
      <div className="h-6 border-t border-border bg-accent/10" />
    </div>
  );
}
