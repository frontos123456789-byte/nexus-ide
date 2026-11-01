import { Skeleton } from "@/components/ui/skeleton";

const WIDTHS = [32, 58, 44, 70, 26, 62, 50, 38, 66, 30, 54, 46];

export function EditorSkeleton() {
  return (
    <div className="h-full w-full space-y-2.5 bg-background p-6" role="status" aria-label="Загрузка редактора">
      {WIDTHS.map((w, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-3 w-5 opacity-60" />
          <Skeleton className="h-3" style={{ width: `${w}%`, marginLeft: (i % 4) * 18 }} />
        </div>
      ))}
    </div>
  );
}
