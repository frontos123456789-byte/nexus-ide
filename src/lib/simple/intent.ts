import type { SimpleKind } from "./projects";

export type Intent = Exclude<SimpleKind, "other"> | "chat";

/** Very small, predictable keyword router for the big input on the home screen. No AI call, so it never fails. */
export function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/(презентаци|слайд|powerpoint|pptx)/.test(t)) return "presentation";
  if (/(telegram|телеграм|телеграмм|телега|\bбот\b|бота\b|боту\b|ботом\b|чат-бот|чатбот)/.test(t)) return "bot";
  if (/(приложени|интерфейс|дизайн|экран|макет|прототип)/.test(t)) return "app";
  if (/(сайт|лендинг|страниц|интернет-магазин|магазин|портфолио|визитк|веб)/.test(t) && /(созда|сдела|хочу|нужн|постро|собер|разработ|нарису|сайт)/.test(t)) return "site";
  if (/(^|\s)сайт/.test(t)) return "site";
  return "chat";
}

const FALLBACK_NAME: Record<string, string> = {
  business: "Мой бизнес",
  shop: "Мой магазин",
  personal: "Мой личный сайт",
  portfolio: "Моё портфолио",
  event: "Моё мероприятие",
  custom: "Мой проект",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A sensible default name, so a person who doesn't know what to answer can simply press "Продолжить". */
export function suggestName(text: string, option: string, fallback?: string): string {
  const m = /(?:^|\s)(?:для|про|о|об)\s+([а-яёa-z0-9-]+(?:\s+[а-яёa-z0-9-]+){0,2})/i.exec(text.replace(/[.,!?;:]/g, " "));
  if (m?.[1]) {
    const words = m[1].trim().split(/\s+/);
    // "продажи домашних тортов" → "Домашние торты" is too clever; keep the user's own words.
    if (/^продаж[иа]$/i.test(words[0] ?? "") && words.length > 1) words[0] = "Продажа";
    return capitalize(words.join(" ")).slice(0, 40);
  }
  return fallback ?? FALLBACK_NAME[option] ?? "Мой проект";
}
