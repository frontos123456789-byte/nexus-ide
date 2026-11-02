import type { GeneratedFile } from "./projects";

export type SiteTemplateId = "landing" | "portfolio" | "blog" | "shop" | "dashboard" | "saas" | "admin";
export type SiteStack = "static" | "next";

export interface SiteConfig {
  name: string;
  tagline: string;
  template: SiteTemplateId;
  accent: string;
  stack: SiteStack;
  auth: boolean;
}

export const SITE_TEMPLATES: { id: SiteTemplateId; title: string; desc: string }[] = [
  { id: "landing", title: "Лендинг", desc: "Hero, преимущества, призыв к действию" },
  { id: "portfolio", title: "Портфолио", desc: "Обо мне, проекты, навыки, контакты" },
  { id: "blog", title: "Блог", desc: "Лента статей и страница автора" },
  { id: "shop", title: "Интернет-магазин", desc: "Каталог товаров и корзина" },
  { id: "dashboard", title: "Dashboard", desc: "Метрики, таблица, боковое меню" },
  { id: "saas", title: "SaaS-приложение", desc: "Тарифы, FAQ, регистрация" },
  { id: "admin", title: "Админ-панель", desc: "Таблица пользователей с поиском" },
];

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");

const CSS = (accent: string) => `:root{--accent:${/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#6366f1"};--bg:#0b0b10;--panel:#14141c;--text:#ececf1;--muted:#9a9aab;--border:#262633}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:inherit;text-decoration:none}img{max-width:100%}.wrap{max-width:1100px;margin:0 auto;padding:0 20px}
.nav{position:sticky;top:0;z-index:10;background:rgba(11,11,16,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.nav .wrap{display:flex;align-items:center;gap:20px;height:60px}.brand{font-weight:700;font-size:18px}.nav .links{margin-left:auto;display:flex;gap:18px;align-items:center;font-size:14px;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:12px;background:var(--accent);color:#fff;font-weight:600;border:0;cursor:pointer;font-size:15px}.btn.ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.hero{padding:88px 0 64px;text-align:center}.hero h1{font-size:clamp(32px,6vw,58px);line-height:1.1;margin:0 0 16px}.hero p{color:var(--muted);font-size:18px;max-width:640px;margin:0 auto 28px}.hero .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
section{padding:56px 0}h2{font-size:clamp(24px,4vw,34px);margin:0 0 24px}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px}.card h3{margin:0 0 6px}.card p{margin:0;color:var(--muted)}.price{font-size:32px;font-weight:700}.tag{display:inline-block;padding:2px 10px;border-radius:99px;background:rgba(99,102,241,.15);color:var(--accent);font-size:12px}
.thumb{height:140px;border-radius:12px;margin-bottom:12px;background:linear-gradient(135deg,var(--accent),#0b0b10)}
footer{border-top:1px solid var(--border);padding:28px 0;color:var(--muted);font-size:14px;text-align:center}
.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh}.side{background:var(--panel);border-right:1px solid var(--border);padding:20px 16px}.side a{display:block;padding:10px 12px;border-radius:10px;color:var(--muted)}.side a.on,.side a:hover{background:rgba(255,255,255,.06);color:var(--text)}.content{padding:24px;min-width:0}
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:14px}table{width:100%;border-collapse:collapse;min-width:520px}th,td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--border);font-size:14px}th{color:var(--muted);font-weight:500}
input,textarea{width:100%;min-height:44px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:16px}label{display:block;margin:12px 0 6px;color:var(--muted);font-size:14px}.form{max-width:380px;margin:64px auto}
@media(max-width:760px){.layout{grid-template-columns:1fr}.side{display:flex;overflow-x:auto;gap:6px;border-right:0;border-bottom:1px solid var(--border);padding:10px}.side a{white-space:nowrap}.nav .links a:not(.btn){display:none}.hero{padding:56px 0 40px}}
`;

const JS = `// Demo interactivity (no backend). Replace with real logic.
(function(){
  var cart=0,badge=document.querySelector('[data-cart]');
  document.querySelectorAll('[data-add]').forEach(function(b){b.addEventListener('click',function(){cart++;if(badge)badge.textContent=String(cart);b.textContent='Добавлено ✓';setTimeout(function(){b.textContent='В корзину'},1200)})});
  var q=document.querySelector('[data-filter]');
  if(q)q.addEventListener('input',function(){var v=q.value.toLowerCase();document.querySelectorAll('[data-row]').forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(v)>-1?'':'none'})});
  var out=document.querySelector('[data-logout]');
  if(out)out.addEventListener('click',function(e){e.preventDefault();localStorage.removeItem('demo-user');location.href='login.html'});
})();
`;

function nav(c: SiteConfig, links: [string, string][]): string {
  return `<header class="nav"><div class="wrap"><a class="brand" href="index.html">${esc(c.name)}</a><nav class="links">${links.map(([t, h]) => `<a href="${h}">${esc(t)}</a>`).join("")}${c.template === "shop" ? '<span>🛒 <b data-cart>0</b></span>' : ""}${c.auth ? '<a class="btn" href="login.html">Войти</a>' : ""}</nav></div></header>`;
}
const footer = (c: SiteConfig) => `<footer><div class="wrap">&copy; ${new Date().getFullYear()} ${esc(c.name)}. Все права защищены.</div></footer>`;
const cards = (items: [string, string][]) => `<div class="grid">${items.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}</div>`;
const hero = (c: SiteConfig, cta = "Начать") => `<section class="hero"><div class="wrap"><h1>${esc(c.name)}</h1><p>${esc(c.tagline)}</p><div class="actions"><a class="btn" href="${c.auth ? "login.html" : "#features"}">${cta}</a><a class="btn ghost" href="#features">Подробнее</a></div></div></section>`;

function indexBody(c: SiteConfig): string {
  switch (c.template) {
    case "portfolio":
      return `${nav(c, [["Проекты", "#projects"], ["Навыки", "#skills"], ["Контакты", "#contact"]])}<main>${hero(c, "Смотреть работы")}<section id="projects"><div class="wrap"><h2>Проекты</h2><div class="grid">${["Проект Альфа", "Проект Бета", "Проект Гамма"].map((p) => `<div class="card"><div class="thumb"></div><h3>${p}</h3><p>Краткое описание задачи, подхода и результата.</p></div>`).join("")}</div></div></section><section id="skills"><div class="wrap"><h2>Навыки</h2>${cards([["Дизайн", "Интерфейсы, прототипы, дизайн-системы"], ["Разработка", "Frontend и backend"], ["Продукт", "Исследования и аналитика"]])}</div></section><section id="contact"><div class="wrap"><h2>Контакты</h2><div class="card"><p>hello@example.com</p></div></div></section></main>${footer(c)}`;
    case "blog":
      return `${nav(c, [["Статьи", "#posts"], ["Об авторе", "#about"]])}<main><section class="hero"><div class="wrap"><h1>${esc(c.name)}</h1><p>${esc(c.tagline)}</p></div></section><section id="posts"><div class="wrap"><h2>Последние статьи</h2><div class="grid">${["Как начать", "Заметки из практики", "Инструменты, которые я использую"].map((p, i) => `<article class="card"><div class="thumb"></div><span class="tag">Статья ${i + 1}</span><h3>${p}</h3><p>Короткий анонс статьи, который заинтересует читателя.</p></article>`).join("")}</div></div></section><section id="about"><div class="wrap"><h2>Об авторе</h2><div class="card"><p>Расскажите о себе и о теме блога.</p></div></div></section></main>${footer(c)}`;
    case "shop":
      return `${nav(c, [["Каталог", "#catalog"], ["Доставка", "#delivery"]])}<main>${hero(c, "В каталог")}<section id="catalog"><div class="wrap"><h2>Каталог</h2><div class="grid">${[["Футболка", 1500], ["Кружка", 600], ["Худи", 3900], ["Блокнот", 450], ["Рюкзак", 4200], ["Кепка", 900]].map(([n, p]) => `<div class="card"><div class="thumb"></div><h3>${n}</h3><div class="price">${p} ₽</div><br><button class="btn" data-add>В корзину</button></div>`).join("")}</div></div></section><section id="delivery"><div class="wrap"><h2>Доставка и оплата</h2>${cards([["Быстрая доставка", "По всей стране за 2–5 дней"], ["Безопасная оплата", "Подключите платёжный сервис"]])}</div></section></main>${footer(c)}`;
    case "saas":
      return `${nav(c, [["Возможности", "#features"], ["Тарифы", "#pricing"], ["FAQ", "#faq"]])}<main>${hero(c, "Попробовать бесплатно")}<section id="features"><div class="wrap"><h2>Возможности</h2>${cards([["Быстрый старт", "Начните работу за пару минут"], ["Командная работа", "Роли, комментарии, история"], ["Аналитика", "Отчёты и метрики в реальном времени"]])}</div></section><section id="pricing"><div class="wrap"><h2>Тарифы</h2><div class="grid">${[["Free", "0 ₽", "1 проект"], ["Pro", "990 ₽/мес", "Безлимит проектов"], ["Team", "2 990 ₽/мес", "Команда и роли"]].map(([n, p, d]) => `<div class="card"><h3>${n}</h3><div class="price">${p}</div><p>${d}</p><br><a class="btn" href="${c.auth ? "login.html" : "#"}">Выбрать</a></div>`).join("")}</div></div></section><section id="faq"><div class="wrap"><h2>FAQ</h2>${cards([["Можно ли отменить подписку?", "Да, в любой момент."], ["Есть ли пробный период?", "Да, на тарифе Free."]])}</div></section></main>${footer(c)}`;
    case "dashboard":
    case "admin":
      return dashBody(c);
    default:
      return `${nav(c, [["Возможности", "#features"], ["Контакты", "#contact"]])}<main>${hero(c)}<section id="features"><div class="wrap"><h2>Преимущества</h2>${cards([["Просто", "Понятный интерфейс без лишнего"], ["Быстро", "Оптимизированная загрузка"], ["Надёжно", "Современные технологии"]])}</div></section><section id="contact"><div class="wrap"><h2>Свяжитесь с нами</h2><div class="card"><p>hello@example.com</p></div></div></section></main>${footer(c)}`;
  }
}

function dashBody(c: SiteConfig): string {
  const admin = c.template === "admin";
  const rows = [["Анна", "anna@example.com", "Админ", "Активен"], ["Игорь", "igor@example.com", "Редактор", "Активен"], ["Мария", "maria@example.com", "Пользователь", "Заблокирован"], ["Пётр", "petr@example.com", "Пользователь", "Активен"]];
  return `<div class="layout"><aside class="side"><div class="brand" style="padding:8px 12px 16px">${esc(c.name)}</div><a class="on" href="index.html">${admin ? "Пользователи" : "Обзор"}</a><a href="#">Отчёты</a><a href="#">Настройки</a>${c.auth ? '<a href="login.html" data-logout>Выйти</a>' : ""}</aside><main class="content"><h2>${admin ? "Пользователи" : "Обзор"}</h2><p style="color:var(--muted)">${esc(c.tagline)} · демо-данные</p>${admin ? '<input data-filter placeholder="Поиск по таблице" aria-label="Поиск"><br><br>' : `<div class="grid" style="margin-bottom:20px">${[["Посетители", "12 480"], ["Заказы", "342"], ["Выручка", "845 000 ₽"], ["Конверсия", "2,7%"]].map(([t, v]) => `<div class="card"><p>${t}</p><div class="price">${v}</div></div>`).join("")}</div>`}<div class="table-wrap"><table><thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Статус</th></tr></thead><tbody>${rows.map((r) => `<tr data-row>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div></main></div>`;
}

function loginHtml(c: SiteConfig): string {
  return `<main class="wrap"><form class="form card" id="f"><h2>Вход в ${esc(c.name)}</h2><label for="e">Email</label><input id="e" type="email" required autocomplete="email"><label for="p">Пароль</label><input id="p" type="password" required minlength="6" autocomplete="current-password"><br><br><button class="btn" style="width:100%">Войти</button><p style="color:var(--muted);font-size:12px">Демо-вход: данные сохраняются только в браузере. Для продакшена подключите реальную авторизацию (NextAuth, Clerk, Supabase Auth).</p></form></main>`;
}
const LOGIN_JS = `document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();localStorage.setItem('demo-user',document.getElementById('e').value);location.href='dashboard.html'});`;
const GUARD_JS = `if(!localStorage.getItem('demo-user'))location.replace('login.html');`;

const doc = (c: SiteConfig, title: string, body: string, extra = "") => `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(title)}</title>\n<meta name="description" content="${esc(c.tagline)}">\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n${body}\n<script src="script.js"></script>\n${extra}</body>\n</html>\n`;

function toJsx(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sclass=/g, " className=")
    .replace(/\sfor=/g, " htmlFor=")
    .replace(/\sdata-([a-z]+)(?=[\s>])/g, " data-$1=\"\"")
    .replace(/<(img|input|br|hr)\b([^>]*?)\s*\/?>/g, "<$1$2 />")
    .replace(/\sstyle="([^"]*)"/g, (_, s: string) => ` style={{${s.split(";").filter(Boolean).map((d) => { const [k, ...v] = d.split(":"); return `${(k ?? "").trim().replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase())}:${JSON.stringify(v.join(":").trim())}`; }).join(",")}}}`)
    .replace(/\shref="(?!http|#|mailto)([^"]*)\.html"/g, (_, p: string) => ` href="${p === "index" ? "/" : `/${p}`}"`)
    .replace(/&copy;/g, "©");
}

export function buildSite(c: SiteConfig): GeneratedFile[] {
  const css = CSS(c.accent);
  const body = indexBody(c);
  const files: GeneratedFile[] = [];
  if (c.stack === "static") {
    files.push({ path: "index.html", content: doc(c, c.name, body, c.template === "dashboard" || c.template === "admin" ? (c.auth ? `<script>${GUARD_JS}</script>\n` : "") : "") });
    files.push({ path: "style.css", content: css }, { path: "script.js", content: JS });
    if (c.auth) {
      files.push({ path: "login.html", content: doc(c, `Вход — ${c.name}`, loginHtml(c), `<script>${LOGIN_JS}</script>\n`) });
      if (c.template !== "dashboard" && c.template !== "admin") files.push({ path: "dashboard.html", content: doc(c, `Кабинет — ${c.name}`, dashBody({ ...c, template: "dashboard" }), `<script>${GUARD_JS}</script>\n`) });
    }
    files.push({ path: "README.md", content: `# ${c.name}\n\nСтатический сайт (HTML/CSS/JS). Откройте index.html или задеплойте на Vercel/GitHub Pages — сборка не требуется.\n` });
    files.push({ path: "vercel.json", content: JSON.stringify({ cleanUrls: true }, null, 2) + "\n" });
    return files;
  }
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  files.push({ path: "package.json", content: JSON.stringify({ name: slug, version: "0.1.0", private: true, scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "^15.1.0", react: "^19.0.0", "react-dom": "^19.0.0" }, devDependencies: { "@types/node": "^22.0.0", "@types/react": "^19.0.0", typescript: "^5.6.0" } }, null, 2) + "\n" });
  files.push({ path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2) + "\n" });
  files.push({ path: "next.config.mjs", content: "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nexport default nextConfig;\n" });
  files.push({ path: "app/globals.css", content: css }, { path: "public/script.js", content: JS });
  files.push({ path: "app/layout.tsx", content: `import type { Metadata } from "next";\nimport Script from "next/script";\nimport "./globals.css";\n\nexport const metadata: Metadata = { title: ${JSON.stringify(c.name)}, description: ${JSON.stringify(c.tagline)} };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="ru">\n      <body>\n        {children}\n        <Script src="/script.js" strategy="afterInteractive" />\n      </body>\n    </html>\n  );\n}\n` });
  const page = (jsx: string, client = "", imp = "") => `${client}${imp}export default function Page() {\n  return (\n    <>\n${toJsx(jsx).split("\n").map((l) => `      ${l}`).join("\n")}\n    </>\n  );\n}\n`;
  const guarded = c.auth && (c.template === "dashboard" || c.template === "admin");
  files.push({ path: "app/page.tsx", content: guarded ? page(body, '"use client";\n\n', 'import { useEffect } from "react";\n\n').replace("export default function Page() {", "export default function Page() {\n  useEffect(() => { if (!localStorage.getItem(\"demo-user\")) location.replace(\"/login\"); }, []);") : page(body) });
  if (c.auth) {
    files.push({ path: "app/login/page.tsx", content: `"use client";\n\nimport { useRouter } from "next/navigation";\n\nexport default function Login() {\n  const router = useRouter();\n  return (\n    <main className="wrap">\n      <form className="form card" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); localStorage.setItem("demo-user", String(f.get("email"))); router.push("/dashboard"); }}>\n        <h2>Вход в ${esc(c.name)}</h2>\n        <label htmlFor="e">Email</label>\n        <input id="e" name="email" type="email" required autoComplete="email" />\n        <label htmlFor="p">Пароль</label>\n        <input id="p" name="password" type="password" required minLength={6} autoComplete="current-password" />\n        <br /><br />\n        <button className="btn" style={{ width: "100%" }}>Войти</button>\n        <p style={{ color: "var(--muted)", fontSize: 12 }}>Демо-вход: данные только в браузере. Для продакшена подключите NextAuth, Clerk или Supabase Auth.</p>\n      </form>\n    </main>\n  );\n}\n` });
    if (!guarded) files.push({ path: "app/dashboard/page.tsx", content: page(dashBody({ ...c, template: "dashboard" }), '"use client";\n\n', 'import { useEffect } from "react";\n\n').replace("export default function Page() {", "export default function Page() {\n  useEffect(() => { if (!localStorage.getItem(\"demo-user\")) location.replace(\"/login\"); }, []);") });
  }
  files.push({ path: ".env.example", content: "# Переменные окружения (значения задайте в Vercel → Settings → Environment Variables)\n# DATABASE_URL=\n# NEXT_PUBLIC_API_URL=\n" });
  files.push({ path: ".gitignore", content: "node_modules\n.next\n.env\n.env.*\n!.env.example\n" });
  files.push({ path: "README.md", content: `# ${c.name}\n\nNext.js (App Router) проект. \`npm install && npm run dev\`. Деплой: Vercel (подключите GitHub-репозиторий).\n` });
  return files;
}

/** Self-contained HTML for the live preview iframe (inlines local CSS/JS, rewrites page links). */
export function previewHtml(files: { rel: string; content: string }[], page = "index.html"): string {
  const get = (p: string) => files.find((f) => f.rel === p)?.content;
  let html = get(page) ?? get("index.html");
  if (!html) {
    const next = get("app/page.tsx");
    if (!next) return "<p style='font:14px system-ui;padding:20px;color:#888'>Нет index.html для предпросмотра. Для Next.js-проектов предпросмотр доступен только у шаблонов Nexus; соберите проект на Vercel для полной проверки.</p>";
    return "<p style='font:14px system-ui;padding:20px;color:#888'>Предпросмотр кастомного Next.js-кода недоступен в браузере. Используйте деплой preview на Vercel.</p>";
  }
  html = html.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (m, h: string) => (get(h) ? `<style>${get(h)}</style>` : m));
  html = html.replace(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g, (m, s: string) => (get(s) ? `<script>${get(s)}</script>` : m));
  html = html.replace(/href="([\w-]+\.html)"/g, 'href="#" data-page="$1"');
  return html;
}

/** Preview for the Next.js stack of Nexus templates: render the equivalent static template. */
export function previewFromConfig(c: SiteConfig, page = "index.html"): string {
  const files = buildSite({ ...c, stack: "static" }).map((f) => ({ rel: f.path, content: f.content }));
  return previewHtml(files, page);
}
