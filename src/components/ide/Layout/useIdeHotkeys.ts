"use client";

import { toast } from "sonner";
import { useHotkeys, type Hotkey } from "@/lib/utils/hotkeys";
import { useIdeStore } from "@/lib/store/ide";
import { playSound } from "@/lib/utils/sound";

export const SHORTCUTS = {
  palette: { key: "k", mod: true },
  quickOpen: { key: "p", mod: true },
  agent: { key: "l", mod: true },
  sidebar: { key: "b", mod: true },
  terminal: { key: "j", mod: true },
  save: { key: "s", mod: true },
  toggleAgent: { key: "\\", mod: true },
  closeTab: { key: "w", alt: true },
} as const;

/** Global IDE shortcuts. Registered in the capture phase so Monaco can't swallow them. */
export function useIdeHotkeys(): void {
  const s = () => useIdeStore.getState();

  const list: Hotkey[] = [
    { ...SHORTCUTS.palette, handler: () => (s().paletteOpen ? s().closePalette() : s().openPalette("all")) },
    { ...SHORTCUTS.quickOpen, handler: () => s().openPalette("files") },
    { ...SHORTCUTS.agent, handler: () => s().focusAgent() },
    { ...SHORTCUTS.sidebar, handler: () => s().setSidebarVisible(!s().sidebarVisible) },
    { ...SHORTCUTS.terminal, handler: () => s().setBottomVisible(!s().bottomVisible) },
    { ...SHORTCUTS.toggleAgent, handler: () => s().setAgentVisible(!s().agentVisible) },
    {
      ...SHORTCUTS.save,
      handler: () => {
        void s()
          .flushWrites()
          .then(() => {
            toast.success("Сохранено", { id: "saved", duration: 1200 });
            playSound("toggle");
          });
      },
    },
    {
      ...SHORTCUTS.closeTab,
      allowInInput: true,
      handler: () => {
        const active = s().activePath;
        if (active) s().closeTab(active);
      },
    },
    { code: "Digit1", alt: true, allowInInput: true, handler: () => { s().setAgentMode("chat"); s().focusAgent(); } },
    { code: "Digit2", alt: true, allowInInput: true, handler: () => { s().setAgentMode("work"); s().focusAgent(); } },
    { code: "Digit3", alt: true, allowInInput: true, handler: () => { s().setAgentMode("code"); s().focusAgent(); } },
  ];

  useHotkeys(list);
}
