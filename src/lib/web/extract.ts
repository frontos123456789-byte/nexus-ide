import * as cheerio from "cheerio";

export interface PageLink {
  text: string;
  url: string;
}

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  published?: string;
  lang?: string;
  headings: { level: number; text: string }[];
  text: string;
  links: PageLink[];
  /** True when the page is almost empty — typical for JS-rendered apps that plain HTTP cannot read. */
  likelyNeedsJs: boolean;
}

const NOISE = "script,style,noscript,svg,iframe,canvas,form,nav,footer,aside,header,template,dialog,[role=navigation],[role=banner],[aria-hidden=true],.cookie,.cookies,.advert,.ads,#cookie-banner";

function clean(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2060\ufeff]/g, "").replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function jsonLdDate(html: string): string | undefined {
  const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(html);
  return parseDate(m?.[1]);
}

export function extractPage(html: string, pageUrl: string, maxChars = 12_000): ExtractedPage {
  const $ = cheerio.load(html);
  const meta = (sel: string) => $(sel).attr("content")?.trim() ?? "";
  const title = clean($("meta[property='og:title']").attr("content") || $("title").first().text() || $("h1").first().text() || pageUrl);
  const description = clean(meta("meta[name=description]") || meta("meta[property='og:description']"));
  const published =
    parseDate(meta("meta[property='article:published_time']")) ||
    parseDate(meta("meta[name='date']")) ||
    parseDate(meta("meta[itemprop=datePublished]")) ||
    parseDate($("time[datetime]").first().attr("datetime")) ||
    jsonLdDate(html);
  const lang = $("html").attr("lang")?.slice(0, 8);

  // Links first (before noise removal drops nav), resolved against the page URL.
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const root = $("article, main, [role=main]").first();
  const scope = root.length ? root : $("body");
  scope.find("a[href]").each((_, el) => {
    if (links.length >= 40) return;
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      abs.hash = "";
      const key = abs.toString();
      if (seen.has(key)) return;
      seen.add(key);
      const text = clean($(el).text()).slice(0, 120);
      if (text) links.push({ text, url: key });
    } catch {
      /* skip malformed href */
    }
  });

  $(NOISE).remove();
  $("[hidden]").remove();
  const main = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");

  const headings: { level: number; text: string }[] = [];
  main.find("h1,h2,h3").each((_, el) => {
    const text = clean($(el).text());
    if (text && headings.length < 30) headings.push({ level: Number(el.tagName.slice(1)), text: text.slice(0, 160) });
  });

  const parts: string[] = [];
  main.find("h1,h2,h3,h4,p,li,pre,blockquote,td,th,figcaption").each((_, el) => {
    const t = clean($(el).text());
    if (!t) return;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) parts.push(`\n${"#".repeat(Number(tag[1]))} ${t}`);
    else if (tag === "li") parts.push(`- ${t}`);
    else parts.push(t);
  });
  let text = clean(parts.join("\n"));
  if (text.length < 200) text = clean(main.text());
  const truncated = text.length > maxChars;
  text = truncated ? `${text.slice(0, maxChars)}\n[…обрезано]` : text;

  return {
    url: pageUrl,
    title: title.slice(0, 200),
    description: description.slice(0, 400),
    published,
    lang,
    headings,
    text,
    links,
    likelyNeedsJs: text.length < 200 && /<script/i.test(html),
  };
}
