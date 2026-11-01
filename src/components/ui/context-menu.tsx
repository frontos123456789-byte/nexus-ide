"use client";

import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils/cn";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-[90] min-w-[190px] overflow-hidden rounded-lg border border-border-strong bg-panel-2 p-1 text-xs text-foreground shadow-2xl shadow-black/60 animate-fade-in",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  danger,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { danger?: boolean; shortcut?: string }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors data-[highlighted]:bg-accent/20 data-[highlighted]:text-white",
        danger && "text-red-400 data-[highlighted]:bg-red-500/15 data-[highlighted]:text-red-300",
        "data-[disabled]:opacity-40 [&_svg]:size-3.5 [&_svg]:text-muted",
        className,
      )}
      {...props}
    >
      {children}
      {shortcut && <span className="ml-auto pl-4 font-mono text-[10px] text-muted">{shortcut}</span>}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn("my-1 h-px bg-border-strong", className)} {...props} />;
}
