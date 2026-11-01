"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <Toaster
        theme="dark"
        position="top-right"
        offset={{ top: 48, right: 16 }}
        closeButton
        toastOptions={{
          classNames: {
            toast:
              "!bg-panel-2 !border !border-border-strong !text-foreground !text-xs !shadow-2xl !shadow-black/60 !rounded-lg",
            description: "!text-subtle",
          },
        }}
      />
    </TooltipProvider>
  );
}
