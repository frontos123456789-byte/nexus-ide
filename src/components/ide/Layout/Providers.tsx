"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSettings } from "@/lib/settings/store";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => useSettings.getState().hydrate(), []);
  return (
    <TooltipProvider>
      {children}
      <Toaster
        theme="dark"
        position="top-right"
        offset={{ top: 48, right: 16 }}
        mobileOffset={{ top: 60, left: 12, right: 12 }}
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
