import { contrastRatio, parseColor } from "./design";

export interface A11yIssue {
  id: string;
  /** objective = measurable rule violation; suggestion = subjective recommendation. */
  kind: "objective" | "suggestion";
  severity: "error" | "warn" | "info";
  category: "contrast" | "semantics" | "aria" | "focus" | "typography" | "spacing" | "responsive" | "consistency";
  message: string;
  selector: string;
  wcag?: string;
}

const ROLES = new Set("alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem".split(" "));
const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex],summary,[contenteditable='true']";

export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML" && parts.length < 6) {
    const parent: Element | null = cur.parentElement;
    const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 1;
    parts.unshift(`${cur.tagName.toLowerCase()}${cur.id ? `#${cur.id}` : `:nth-child(${idx})`}`);
    cur = parent;
  }
  return parts.join(" > ");
}

function effectiveBg(el: Element, win: Window): string {
  let cur: Element | null = el;
  while (cur) {
    const bg = win.getComputedStyle(cur).backgroundColor;
    const c = parseColor(bg);
    if (c && c[3] > 0.95) return bg;
    cur = cur.parentElement;
  }
  return "rgb(255,255,255)";
}

function accName(el: Element): string {
  const aria = el.getAttribute("aria-label") ?? "";
  if (aria.trim()) return aria.trim();
  const lb = el.getAttribute("aria-labelledby");
  if (lb) return lb.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").trim();
  return (el.textContent ?? "").trim() || el.getAttribute("title")?.trim() || (el.querySelector("img[alt]")?.getAttribute("alt") ?? "").trim();
}

/** Audits a rendered document. `win` must be the window that owns `doc` (needed for computed styles). */
export function auditDocument(doc: Document, win: Window): A11yIssue[] {
  const out: A11yIssue[] = [];
  const add = (i: Omit<A11yIssue, "selector"> & { el?: Element }) => out.push({ ...i, selector: i.el ? selectorOf(i.el) : "document" });
  const root = doc.documentElement;
  if (!root.getAttribute("lang")) add({ id: "html-lang", kind: "objective", severity: "error", category: "semantics", message: "У <html> нет атрибута lang", wcag: "3.1.1", el: root });
  if (!doc.title.trim()) add({ id: "title", kind: "objective", severity: "warn", category: "semantics", message: "Нет <title>", wcag: "2.4.2" });
  if (!doc.querySelector("main,[role=main]")) add({ id: "landmark-main", kind: "objective", severity: "warn", category: "semantics", message: "Нет ориентира <main>", wcag: "1.3.1" });
  if (!doc.querySelector("meta[name=viewport]")) add({ id: "viewport", kind: "objective", severity: "warn", category: "responsive", message: "Нет meta viewport — страница не адаптируется на мобильных", wcag: "1.4.10" });
  doc.querySelectorAll("img").forEach((el) => { if (!el.hasAttribute("alt")) add({ id: "img-alt", kind: "objective", severity: "error", category: "semantics", message: "Изображение без alt", wcag: "1.1.1", el }); });
  doc.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea").forEach((el) => {
    const id = el.getAttribute("id");
    const labelled = el.closest("label") || (id && doc.querySelector(`label[for="${id}"]`)) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    if (!labelled) add({ id: "label", kind: "objective", severity: "error", category: "semantics", message: "Поле формы без подписи", wcag: "1.3.1 / 4.1.2", el });
  });
  doc.querySelectorAll("button,[role=button]").forEach((el) => { if (!accName(el)) add({ id: "button-name", kind: "objective", severity: "error", category: "aria", message: "Кнопка без доступного имени", wcag: "4.1.2", el }); });
  doc.querySelectorAll("a").forEach((el) => {
    if (!el.hasAttribute("href")) add({ id: "a-href", kind: "objective", severity: "warn", category: "semantics", message: "<a> без href не фокусируется с клавиатуры", wcag: "2.1.1", el });
    else if (!accName(el)) add({ id: "link-name", kind: "objective", severity: "error", category: "aria", message: "Ссылка без текста", wcag: "2.4.4", el });
  });
  const heads = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  if (doc.querySelectorAll("h1").length !== 1 && heads.length) add({ id: "h1", kind: "objective", severity: "warn", category: "semantics", message: `Заголовков h1: ${doc.querySelectorAll("h1").length} (ожидается один)`, wcag: "1.3.1" });
  let prev = 0;
  for (const h of heads) { const lvl = Number(h.tagName[1]); if (prev && lvl > prev + 1) add({ id: "heading-order", kind: "objective", severity: "warn", category: "semantics", message: `Пропущен уровень заголовка (h${prev} → h${lvl})`, wcag: "1.3.1", el: h }); prev = lvl; }
  const ids = new Map<string, number>();
  doc.querySelectorAll("[id]").forEach((el) => ids.set(el.id, (ids.get(el.id) ?? 0) + 1));
  ids.forEach((n, id) => { if (n > 1) add({ id: "dup-id", kind: "objective", severity: "error", category: "aria", message: `Дублирующийся id="${id}"`, wcag: "4.1.1" }); });
  doc.querySelectorAll("[role]").forEach((el) => { const r = el.getAttribute("role") ?? ""; if (!ROLES.has(r)) add({ id: "aria-role", kind: "objective", severity: "error", category: "aria", message: `Недопустимая роль ARIA «${r}»`, wcag: "4.1.2", el }); });
  doc.querySelectorAll("[aria-labelledby],[aria-describedby],[aria-controls]").forEach((el) => {
    for (const a of ["aria-labelledby", "aria-describedby", "aria-controls"]) for (const id of (el.getAttribute(a) ?? "").split(/\s+/).filter(Boolean)) if (!doc.getElementById(id)) add({ id: "aria-ref", kind: "objective", severity: "error", category: "aria", message: `${a} ссылается на несуществующий id «${id}»`, wcag: "4.1.2", el });
  });
  doc.querySelectorAll("[tabindex]").forEach((el) => { if (Number(el.getAttribute("tabindex")) > 0) add({ id: "tabindex", kind: "objective", severity: "warn", category: "focus", message: "tabindex > 0 ломает естественный порядок фокуса", wcag: "2.4.3", el }); });
  doc.querySelectorAll(`[aria-hidden=true]`).forEach((el) => { if (el.matches(FOCUSABLE) || el.querySelector(FOCUSABLE)) add({ id: "aria-hidden-focus", kind: "objective", severity: "error", category: "focus", message: "aria-hidden скрывает фокусируемый элемент", wcag: "4.1.2", el }); });
  doc.querySelectorAll("div[onclick],span[onclick]").forEach((el) => { if (!el.hasAttribute("tabindex") && !el.hasAttribute("role")) add({ id: "click-keyboard", kind: "objective", severity: "error", category: "focus", message: "Интерактивный элемент недоступен с клавиатуры (нет role/tabindex)", wcag: "2.1.1", el }); });
  // visual checks on rendered text
  const fonts = new Map<string, number>();
  const sizes = new Set<string>();
  const margins = new Set<string>();
  let checked = 0;
  doc.querySelectorAll("body *").forEach((el) => {
    if (checked > 400) return;
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    if (hasText) {
      checked++;
      const ratio = contrastRatio(cs.color, effectiveBg(el, win));
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      if (ratio !== null && ratio < (large ? 3 : 4.5)) add({ id: "contrast", kind: "objective", severity: "error", category: "contrast", message: `Контраст ${ratio.toFixed(2)}:1 ниже нормы ${large ? "3" : "4.5"}:1`, wcag: "1.4.3", el });
      if (size < 12) add({ id: "font-size", kind: "objective", severity: "warn", category: "typography", message: `Мелкий шрифт ${size}px`, wcag: "1.4.4", el });
      fonts.set(cs.fontFamily.split(",")[0]?.trim() ?? "", (fonts.get(cs.fontFamily.split(",")[0]?.trim() ?? "") ?? 0) + 1);
      sizes.add(cs.fontSize);
      const lh = parseFloat(cs.lineHeight);
      if (!Number.isNaN(lh) && size > 0 && lh / size < 1.3 && (el.textContent ?? "").length > 120) add({ id: "line-height", kind: "suggestion", severity: "info", category: "typography", message: `Межстрочный интервал ${(lh / size).toFixed(2)} при длинном тексте — рекомендуется ≥1.5`, wcag: "1.4.12", el });
    }
    if (el.matches("a,button,input,select,textarea,[role=button]")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.width < 24 || r.height < 24)) add({ id: "target-size", kind: "objective", severity: "warn", category: "focus", message: `Маленькая цель нажатия ${Math.round(r.width)}×${Math.round(r.height)}px (минимум 24×24)`, wcag: "2.5.8", el });
    }
    if (cs.outlineStyle === "none" && el.matches("a,button,input") && !el.getAttribute("style")?.includes("outline")) { /* focus style cannot be measured statically */ }
    margins.add(cs.marginTop); margins.add(cs.paddingTop);
  });
  if (fonts.size > 3) add({ id: "font-families", kind: "suggestion", severity: "info", category: "consistency", message: `Используется ${fonts.size} разных шрифтов (${[...fonts.keys()].join(", ")}) — лучше не более 2–3` });
  if (sizes.size > 8) add({ id: "font-scale", kind: "suggestion", severity: "info", category: "typography", message: `${sizes.size} разных размеров шрифта — стоит свести к типографической шкале` });
  if (margins.size > 12) add({ id: "spacing-scale", kind: "suggestion", severity: "info", category: "spacing", message: `${margins.size} разных значений отступов — рассмотрите шкалу кратную 4/8px` });
  const wide = Array.from(doc.querySelectorAll("body *")).find((el) => el.scrollWidth > (win.innerWidth || 1024) + 4);
  if (wide) add({ id: "overflow-x", kind: "objective", severity: "warn", category: "responsive", message: "Контент шире окна — возможен горизонтальный скролл", wcag: "1.4.10", el: wide });
  return out;
}

/** Text-only heuristics for JSX/TSX sources (no rendering available). */
export function auditSource(path: string, src: string): A11yIssue[] {
  const out: A11yIssue[] = [];
  src.split("\n").forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    if (/<img\b(?![^>]*\balt=)/.test(line)) out.push({ id: "img-alt", kind: "objective", severity: "error", category: "semantics", message: "<img> без alt", selector: at, wcag: "1.1.1" });
    if (/<(div|span)\b[^>]*onClick/.test(line) && !/role=|tabIndex/.test(line)) out.push({ id: "click-keyboard", kind: "objective", severity: "error", category: "focus", message: "onClick на div/span без role и tabIndex", selector: at, wcag: "2.1.1" });
    if (/<input\b(?![^>]*(aria-label|id=))/.test(line) && !/type=["']hidden/.test(line)) out.push({ id: "label", kind: "objective", severity: "warn", category: "semantics", message: "<input> без aria-label/id для связи с label", selector: at, wcag: "1.3.1" });
    if (/tabIndex=\{?["']?[1-9]/.test(line)) out.push({ id: "tabindex", kind: "objective", severity: "warn", category: "focus", message: "tabIndex > 0", selector: at, wcag: "2.4.3" });
    if (/<a\b(?![^>]*href)/.test(line)) out.push({ id: "a-href", kind: "objective", severity: "warn", category: "semantics", message: "<a> без href", selector: at, wcag: "2.1.1" });
    if (/outline(?:-none|:\s*none)/.test(line) && !/focus/.test(line)) out.push({ id: "outline", kind: "objective", severity: "warn", category: "focus", message: "Удалён outline без замены стиля фокуса", selector: at, wcag: "2.4.7" });
  });
  return out;
}
