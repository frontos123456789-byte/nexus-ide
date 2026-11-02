export type SlideLayout = "title" | "bullets" | "image" | "quote";

export interface Slide {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets: string[];
  image?: string;
  notes?: string;
}

export interface Theme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
  muted: string;
}

export interface Deck {
  id: string;
  title: string;
  theme: string;
  slides: Slide[];
}

export const THEMES: Theme[] = [
  { id: "midnight", name: "Midnight", bg: "#0f1020", fg: "#f4f4f8", accent: "#818cf8", muted: "#a1a1b5" },
  { id: "paper", name: "Paper", bg: "#fafaf7", fg: "#1c1c1e", accent: "#4f46e5", muted: "#6b6b76" },
  { id: "corporate", name: "Corporate", bg: "#0b2545", fg: "#ffffff", accent: "#38bdf8", muted: "#b6c6dc" },
  { id: "vivid", name: "Vivid", bg: "#1a0b2e", fg: "#ffffff", accent: "#f472b6", muted: "#c9b6e4" },
  { id: "forest", name: "Forest", bg: "#10241c", fg: "#eefaf3", accent: "#34d399", muted: "#9bbdad" },
  { id: "warm", name: "Warm", bg: "#fff4e6", fg: "#2b1d0e", accent: "#ea580c", muted: "#7a6650" },
];

export const themeOf = (id: string): Theme => THEMES.find((t) => t.id === id) ?? (THEMES[0] as Theme);

const uid = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const newSlide = (p: Partial<Slide> = {}): Slide => ({ id: uid(), layout: "bullets", title: "Новый слайд", bullets: ["Тезис"], ...p });

export const DECK_TEMPLATES: { id: string; title: string; theme: string; slides: [SlideLayout, string, string[]][] }[] = [
  { id: "business", title: "Бизнес-презентация", theme: "corporate", slides: [["title", "Название компании", ["Презентация для партнёров"]], ["bullets", "О компании", ["Миссия и ценности", "Ключевые цифры", "География"]], ["bullets", "Продукты и услуги", ["Направление 1", "Направление 2", "Направление 3"]], ["bullets", "Результаты", ["Рост выручки", "Новые клиенты", "Награды"]], ["bullets", "Следующие шаги", ["Планы на год", "Как начать сотрудничество"]]] },
  { id: "education", title: "Учебная презентация", theme: "paper", slides: [["title", "Тема урока", ["Курс · Автор"]], ["bullets", "Цели занятия", ["Что узнаем", "Чему научимся"]], ["bullets", "Основные понятия", ["Понятие 1", "Понятие 2", "Понятие 3"]], ["quote", "Главная идея", ["Сформулируйте ключевой вывод одной фразой."]], ["bullets", "Итоги и вопросы", ["Повторим главное", "Домашнее задание"]]] },
  { id: "pitch", title: "Pitch Deck", theme: "vivid", slides: [["title", "Название стартапа", ["Одной строкой: что вы делаете"]], ["bullets", "Проблема", ["Кто страдает", "Насколько это больно"]], ["bullets", "Решение", ["Как работает продукт", "Почему это лучше"]], ["bullets", "Рынок", ["TAM / SAM / SOM", "Тренды"]], ["bullets", "Бизнес-модель", ["Как зарабатываем", "Unit-экономика"]], ["bullets", "Команда", ["Основатели", "Ключевые роли"]], ["bullets", "Запрос", ["Сумма раунда", "На что пойдут деньги"]]] },
  { id: "report", title: "Отчёт", theme: "midnight", slides: [["title", "Отчёт за период", ["Подготовил: имя"]], ["bullets", "Краткое резюме", ["Главный итог", "Ключевой риск"]], ["bullets", "Показатели", ["Метрика 1", "Метрика 2", "Метрика 3"]], ["bullets", "Выводы и рекомендации", ["Вывод 1", "Рекомендация 1"]]] },
  { id: "portfolio", title: "Портфолио", theme: "warm", slides: [["title", "Имя Фамилия", ["Профессия · Город"]], ["bullets", "Обо мне", ["Опыт", "Специализация"]], ["bullets", "Избранные проекты", ["Проект 1", "Проект 2", "Проект 3"]], ["bullets", "Контакты", ["email@example.com", "@telegram"]]] },
  { id: "product", title: "Презентация продукта", theme: "forest", slides: [["title", "Название продукта", ["Слоган"]], ["bullets", "Для кого", ["Аудитория", "Боли"]], ["bullets", "Возможности", ["Функция 1", "Функция 2", "Функция 3"]], ["bullets", "Тарифы", ["Free", "Pro", "Team"]], ["bullets", "Как начать", ["Шаг 1", "Шаг 2"]]] },
];

export function deckFromTemplate(id: string, title?: string): Deck {
  const t = DECK_TEMPLATES.find((x) => x.id === id) ?? (DECK_TEMPLATES[0] as (typeof DECK_TEMPLATES)[number]);
  return {
    id: uid(),
    title: title || t.title,
    theme: t.theme,
    slides: t.slides.map(([layout, tt, b], i) => newSlide({ layout, title: i === 0 && title ? title : tt, bullets: layout === "title" ? [] : b, subtitle: layout === "title" ? b[0] : undefined })),
  };
}

interface AiDeck {
  title?: string;
  slides?: { layout?: string; title?: string; subtitle?: string; bullets?: unknown; notes?: string }[];
}

export function deckFromAi(raw: AiDeck, theme: string, count: number): Deck | null {
  const slides = (raw.slides ?? []).slice(0, Math.max(3, Math.min(count, 30))).map((s, i) =>
    newSlide({
      layout: (["title", "bullets", "image", "quote"].includes(String(s.layout)) ? s.layout : i === 0 ? "title" : "bullets") as SlideLayout,
      title: String(s.title ?? `Слайд ${i + 1}`).slice(0, 120),
      subtitle: s.subtitle ? String(s.subtitle).slice(0, 160) : undefined,
      bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 220)).slice(0, 7) : [],
      notes: s.notes ? String(s.notes).slice(0, 600) : undefined,
    }),
  );
  if (slides.length === 0) return null;
  return { id: uid(), title: String(raw.title ?? slides[0]?.title ?? "Презентация").slice(0, 120), theme, slides };
}

/* ------------------------------ image helpers ------------------------------ */

export async function toDataUrl(src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ------------------------------ PPTX export (PptxGenJS) ------------------------------ */

const hex = (c: string): string => c.replace("#", "");

export async function exportPptx(deck: Deck): Promise<{ warnings: string[] }> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const t = themeOf(deck.theme);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pptx.title = deck.title;
  const warnings: string[] = [];
  for (const [i, s] of deck.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(t.bg) };
    let img: string | null = null;
    if (s.image) {
      img = await toDataUrl(s.image);
      if (!img) warnings.push(`Слайд ${i + 1}: изображение недоступно (CORS) и не добавлено`);
    }
    if (s.layout === "title") {
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.0, w: 0.12, h: 1.5, fill: { color: hex(t.accent) } });
      slide.addText(s.title, { x: 0.95, y: 1.9, w: 8.2, h: 1.1, fontSize: 38, bold: true, color: hex(t.fg), fontFace: "Calibri", fit: "shrink" });
      if (s.subtitle) slide.addText(s.subtitle, { x: 0.95, y: 3.05, w: 8.2, h: 0.7, fontSize: 20, color: hex(t.muted), fontFace: "Calibri" });
    } else if (s.layout === "quote") {
      slide.addText(`«${s.bullets[0] ?? s.title}»`, { x: 0.9, y: 1.4, w: 8.2, h: 2.4, fontSize: 30, italic: true, color: hex(t.fg), fontFace: "Calibri", fit: "shrink" });
      slide.addText(s.title, { x: 0.9, y: 4.0, w: 8.2, h: 0.5, fontSize: 16, color: hex(t.accent), fontFace: "Calibri" });
    } else {
      slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.5, w: 0.08, h: 0.7, fill: { color: hex(t.accent) } });
      slide.addText(s.title, { x: 0.75, y: 0.4, w: 8.6, h: 0.9, fontSize: 28, bold: true, color: hex(t.fg), fontFace: "Calibri", fit: "shrink" });
      const w = img ? 4.9 : 8.8;
      if (s.bullets.length) slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.5, w, h: 3.6, fontSize: 18, color: hex(t.fg), fontFace: "Calibri", valign: "top", paraSpaceAfter: 8, fit: "shrink" });
      if (img) slide.addImage({ data: img, x: 5.8, y: 1.5, w: 3.7, h: 3.6, sizing: { type: "contain", w: 3.7, h: 3.6 } });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  await pptx.writeFile({ fileName: `${(deck.title || "presentation").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.pptx` });
  return { warnings };
}

/* ------------------------------ PDF export (canvas → jsPDF) ------------------------------ */

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

async function drawSlide(s: Slide, t: Theme, W: number, H: number): Promise<{ canvas: HTMLCanvasElement; warn?: string }> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  const font = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  let warn: string | undefined;
  let img: HTMLImageElement | null = null;
  if (s.image) {
    const data = await toDataUrl(s.image);
    img = data ? await loadImage(data) : null;
    if (!img) warn = "изображение недоступно (CORS) и не добавлено";
  }
  ctx.textBaseline = "top";
  if (s.layout === "title") {
    ctx.fillStyle = t.accent;
    ctx.fillRect(W * 0.06, H * 0.34, 14, H * 0.27);
    ctx.fillStyle = t.fg;
    ctx.font = `bold ${Math.round(H * 0.09)}px ${font}`;
    const lines = wrap(ctx, s.title, W * 0.82);
    lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, W * 0.06 + 44, H * 0.33 + i * H * 0.1));
    if (s.subtitle) {
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(H * 0.04)}px ${font}`;
      wrap(ctx, s.subtitle, W * 0.8).slice(0, 2).forEach((l, i) => ctx.fillText(l, W * 0.06 + 44, H * 0.33 + Math.min(lines.length, 3) * H * 0.1 + 20 + i * H * 0.055));
    }
  } else if (s.layout === "quote") {
    ctx.fillStyle = t.fg;
    ctx.font = `italic ${Math.round(H * 0.06)}px ${font}`;
    wrap(ctx, `«${s.bullets[0] ?? s.title}»`, W * 0.8).slice(0, 5).forEach((l, i) => ctx.fillText(l, W * 0.1, H * 0.22 + i * H * 0.085));
    ctx.fillStyle = t.accent;
    ctx.font = `${Math.round(H * 0.035)}px ${font}`;
    ctx.fillText(s.title, W * 0.1, H * 0.78);
  } else {
    ctx.fillStyle = t.accent;
    ctx.fillRect(W * 0.05, H * 0.09, 10, H * 0.1);
    ctx.fillStyle = t.fg;
    ctx.font = `bold ${Math.round(H * 0.065)}px ${font}`;
    wrap(ctx, s.title, W * 0.85).slice(0, 2).forEach((l, i) => ctx.fillText(l, W * 0.05 + 32, H * 0.085 + i * H * 0.075));
    const textW = img ? W * 0.5 : W * 0.88;
    ctx.font = `${Math.round(H * 0.043)}px ${font}`;
    let y = H * 0.3;
    for (const b of s.bullets) {
      ctx.fillStyle = t.accent;
      ctx.fillText("•", W * 0.06, y);
      ctx.fillStyle = t.fg;
      for (const l of wrap(ctx, b, textW - 50).slice(0, 3)) {
        ctx.fillText(l, W * 0.06 + 44, y);
        y += H * 0.06;
      }
      y += H * 0.025;
      if (y > H * 0.92) break;
    }
    if (img) {
      const bw = W * 0.38;
      const bh = H * 0.6;
      const r = Math.min(bw / img.width, bh / img.height);
      ctx.drawImage(img, W * 0.57 + (bw - img.width * r) / 2, H * 0.3, img.width * r, img.height * r);
    }
  }
  return { canvas, warn };
}

export async function exportPdf(deck: Deck): Promise<{ warnings: string[] }> {
  const { jsPDF } = await import("jspdf");
  const t = themeOf(deck.theme);
  const W = 1600;
  const H = 900;
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [W, H], compress: true });
  pdf.setProperties({ title: deck.title });
  const warnings: string[] = [];
  for (const [i, s] of deck.slides.entries()) {
    if (i > 0) pdf.addPage([W, H], "landscape");
    const { canvas, warn } = await drawSlide(s, t, W, H);
    if (warn) warnings.push(`Слайд ${i + 1}: ${warn}`);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, W, H);
  }
  pdf.save(`${(deck.title || "presentation").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.pdf`);
  return { warnings };
}
