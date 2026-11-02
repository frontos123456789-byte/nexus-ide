import { Bot, FolderOpen, Globe, LayoutTemplate, MessageCircle, Presentation, type LucideIcon } from "lucide-react";
import type { SimpleKind } from "@/lib/simple/projects";

export interface CreateAction {
  id: "site" | "bot" | "presentation" | "app";
  href: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  tint: string;
}

export const CREATE_ACTIONS: CreateAction[] = [
  { id: "site", href: "/create/site", title: "Создать сайт", hint: "Для бизнеса, магазина, портфолио", icon: Globe, tint: "bg-emerald-500/20 text-emerald-200" },
  { id: "bot", href: "/create/bot", title: "Создать Telegram-бота", hint: "Отвечает клиентам и принимает заявки", icon: Bot, tint: "bg-sky-500/20 text-sky-200" },
  { id: "presentation", href: "/create/presentation", title: "Создать презентацию", hint: "Слайды из одного описания", icon: Presentation, tint: "bg-fuchsia-500/20 text-fuchsia-200" },
  { id: "app", href: "/create/app", title: "Создать дизайн приложения", hint: "Экраны для телефона, которые можно потрогать", icon: LayoutTemplate, tint: "bg-amber-500/20 text-amber-200" },
];

export const EXTRA_ACTIONS = [
  { href: "/chat", title: "Поговорить с AI", hint: "Вопросы, письма, советы", icon: MessageCircle, tint: "bg-indigo-500/25 text-indigo-200" },
  { href: "/projects", title: "Мои проекты", hint: "Всё, что вы уже создали", icon: FolderOpen, tint: "bg-zinc-500/25 text-zinc-100" },
] as const;

export const KIND_ICON: Record<SimpleKind, LucideIcon> = {
  site: Globe,
  bot: Bot,
  presentation: Presentation,
  app: LayoutTemplate,
  other: FolderOpen,
};

export const KIND_TINT: Record<SimpleKind, string> = {
  site: "bg-emerald-500/20 text-emerald-200",
  bot: "bg-sky-500/20 text-sky-200",
  presentation: "bg-fuchsia-500/20 text-fuchsia-200",
  app: "bg-amber-500/20 text-amber-200",
  other: "bg-zinc-500/25 text-zinc-100",
};

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `сегодня, ${time}`;
  if (diff === 1) return `вчера, ${time}`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
