"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils/cn";
import { useIsMobile } from "@/lib/utils/use-mobile";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

interface TipProps {
  label: React.ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
}

/** Convenience wrapper: <Tip label="Save" shortcut="⌘S"><button/></Tip> */
export function Tip({ label, shortcut, side = "bottom", children }: TipProps) {
  // Hover tooltips are meaningless (and sticky) on touch screens.
  const isMobile = useIsMobile();
  if (isMobile) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[100] flex items-center gap-2 rounded-md border border-border-strong bg-panel-2 px-2 py-1 text-[11px] text-foreground shadow-xl shadow-black/50",
            "animate-fade-in",
          )}
        >
          {label}
          {shortcut && <span className="font-mono text-[10px] text-muted">{shortcut}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
