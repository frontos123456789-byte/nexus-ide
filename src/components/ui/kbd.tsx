import { cn } from "@/lib/utils/cn";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-panel-2 px-1 font-mono text-[10px] text-subtle",
        className,
      )}
      {...props}
    />
  );
}
