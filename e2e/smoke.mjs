/**
 * End-to-end smoke test (Playwright). Run against a running app that talks to
 * the mock OpenRouter server:
 *
 *   node scripts/mock-openrouter.mjs &
 *   OPENROUTER_BASE_URL=http://127.0.0.1:4010/v1 OPENROUTER_API_KEY=mock npm run start -- -p 3100 &
 *   BASE_URL=http://127.0.0.1:3100 node e2e/smoke.mjs
 *
 * Playwright is intentionally not a project dependency:  npm i -g playwright (or set PW_PATH).
 */
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(process.env.PW_PATH ?? import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_EXE
    ? { executablePath: process.env.CHROMIUM_EXE, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] }
    : {},
);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message} [${e.stack?.split("\n").slice(1, 4).join(" <- ")}] after "${results.at(-1)?.name}"`));

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const mod = "Control";

try {
  /* ---------- boot & layout ---------- */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('aside[aria-label="Проводник"]', { timeout: 20000 });
  check("IDE shell renders", true);
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
  check("Monaco editor loads (README.md opens by default)", true);
  const tree = await page.locator('[role="treeitem"]').allInnerTexts();
  check("File tree shows seeded project", tree.some((t) => t.includes("src")) && tree.some((t) => t.includes("README.md")), tree.join(","));
  check("Three modes visible", (await page.locator('[role="tab"]:has-text("Chat"), [role="tab"]:has-text("Work"), [role="tab"]:has-text("Code")').count()) === 3);
  await shot("01-boot");

  /* ---------- editing + persistence ---------- */
  await page.locator('[role="treeitem"]:has-text("index.ts")').first().click();
  await page.waitForSelector('[role="tab"]:has-text("index.ts")');
  await page.locator(".monaco-editor textarea").first().focus();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type("\n// persisted-marker-42");
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
  await page.waitForTimeout(800);
  const afterReload = await page.locator(".view-lines").first().innerText();
  check("Edits persist after reload (IndexedDB)", afterReload.includes("persisted-marker-42"));
  check("Open tabs restored after reload", (await page.locator('[role="tab"]:has-text("index.ts")').count()) === 1);

  /* ---------- hotkeys ---------- */
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector("[cmdk-root]");
  check("Ctrl+K opens command palette", true);
  await shot("02-palette");
  await page.keyboard.type("math");
  check("Palette filters files", (await page.locator('[cmdk-item]:has-text("math.ts")').count()) >= 1);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[cmdk-root]", { state: "detached" });
  await page.keyboard.press(`${mod}+b`);
  await page.waitForTimeout(300);
  check("Ctrl+B hides sidebar", (await page.locator('aside[aria-label="Проводник"]').count()) === 0);
  await page.keyboard.press(`${mod}+b`);
  await page.waitForSelector('aside[aria-label="Проводник"]');
  check("Ctrl+B shows sidebar", true);
  await page.keyboard.press(`${mod}+l`);
  await page.waitForTimeout(200);
  const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  check("Ctrl+L focuses agent composer", focusedLabel.startsWith("Сообщение агенту"), focusedLabel);

  /* ---------- chat with fallback ---------- */
  await page.keyboard.type("Объясни fibonacci");
  await page.keyboard.press("Enter");
  await page.waitForSelector('text=Итог:', { timeout: 30000 });
  check("Chat streams a markdown answer", true);
  check("Chat renders a code block", (await page.locator(".md pre code").count()) >= 1);
  await page.waitForTimeout(500);
  const statusText = await page.locator("footer").innerText();
  check("Status bar shows the model that answered", statusText.includes("Nemotron 3 Ultra"), statusText.replace(/\n/g, " | "));
  check("Fallback notice shown in chat", (await page.locator("text=Переключение на North Mini Code").count()) >= 1);
  await shot("03-chat");
  await page.getByRole("tab", { name: "Терминал" }).click();
  await page.getByRole("tab", { name: "Логи" }).click();
  const logs = await page.locator('[role="log"]').last().innerText();
  check("Fallback switches are logged to the terminal panel", logs.includes("Переключение на") && logs.includes("Nemotron 3 Ultra"));

  /* ---------- work ---------- */
  await page.keyboard.press("Alt+Digit2");
  await page.locator('textarea[aria-label^="Сообщение агенту"]').fill("Добавить TodoList");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[role="progressbar"]', { timeout: 30000 });
  check("Work mode builds a plan with progress bar", true);
  check("Work plan has 3 steps", (await page.locator("ol > li").count()) === 3);
  check("Chain of thought shown", (await page.locator("text=Ход мыслей").count()) >= 1);
  await page.getByRole("button", { name: "Выполнить шаг 1" }).click();
  await page.waitForSelector('text=Результат шага', { timeout: 30000 });
  await page.waitForTimeout(400);
  const progress = await page.locator('[role="progressbar"]').getAttribute("aria-valuenow");
  check("Executing a step advances progress", Number(progress) > 0, `progress=${progress}`);
  await shot("04-work");

  /* ---------- code (multi-agent) ---------- */
  await page.keyboard.press("Alt+Digit3");
  await page.locator('textarea[aria-label^="Сообщение агенту"]').fill("Оптимизируй fibonacci и добавь тесты");
  await page.keyboard.press("Enter");
  let sawParallel = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const running = await page.locator('article[aria-busy="true"]').count();
    if (running >= 2) sawParallel = true;
    if ((await page.locator("text=Сводка Director").count()) > 0 && (await page.locator('article[aria-busy="true"]').count()) === 0) break;
    await page.waitForTimeout(120);
  }
  check("Code mode runs multiple sub-agents in parallel", sawParallel);
  check("Director, Architect, 2 Coders and Reviewer cards present", (await page.locator("article[aria-label]").count()) === 5, String(await page.locator("article[aria-label]").count()));
  check("Summary produced", (await page.locator("text=Сводка Director").count()) === 1);
  check("Reviewer verdict shown", (await page.locator("text=Одобрено").count()) >= 1);
  const rows = await page.locator('section[aria-label="Предложенные изменения"] li').count();
  check("Two file proposals listed", rows === 2, String(rows));
  await shot("05-code");
  await page.getByRole("button", { name: /Показать diff src\/lib\/math\.ts/ }).click();
  await page.waitForSelector(".monaco-diff-editor", { timeout: 30000 });
  check("Diff viewer opens (Monaco diff editor)", true);
  await page.waitForTimeout(600);
  await shot("06-diff");
  await page.getByRole("button", { name: /Применить все/ }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Закрыть diff" }).first().click().catch(() => {});
  await page.keyboard.press(`${mod}+p`);
  await page.keyboard.type("math.test");
  check("Applied proposals created files in the workspace", (await page.locator('[cmdk-item]:has-text("src/lib/math.test.ts")').count()) >= 1);
  await page.keyboard.press("Escape");

  /* ---------- terminal ---------- */
  await page.getByRole("tab", { name: "Терминал" }).click();
  const input = page.locator('input[aria-label="Ввод команды терминала"]');
  await input.fill("ls");
  await input.press("Enter");
  await input.fill("cat README.md");
  await input.press("Enter");
  await page.waitForTimeout(300);
  const termText = await page.locator("section[aria-label='Терминал и логи']").innerText();
  check("Terminal runs ls / cat", termText.includes("package.json") && termText.includes("Nexus Demo Project"));
  await input.fill("touch from-terminal.txt");
  await input.press("Enter");
  await page.waitForTimeout(300);
  check("Terminal touch creates a file visible in the tree", (await page.locator('[role="treeitem"]:has-text("from-terminal.txt")').count()) === 1);
  await shot("07-terminal");

  /* ---------- file tree context menu ---------- */
  await page.locator('[role="treeitem"]:has-text("from-terminal.txt")').click({ button: "right" });
  await page.getByRole("menuitem", { name: /Переименовать/ }).click();
  await page.locator('[role="treeitem"] input').waitFor();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("renamed.txt");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("Rename via context menu", (await page.locator('[role="treeitem"]:has-text("renamed.txt")').count()) === 1);
  await page.locator('[role="treeitem"]:has-text("renamed.txt")').click({ button: "right" });
  await page.getByRole("menuitem", { name: /Удалить/ }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.waitForTimeout(400);
  check("Delete via context menu with confirmation", (await page.locator('[role="treeitem"]:has-text("renamed.txt")').count()) === 0);
  await page.locator('[role="tree"]').click({ button: "right", position: { x: 20, y: 300 } });
  await page.getByRole("menuitem", { name: /Новый файл/ }).click();
  await page.keyboard.type("docs/new-note.md");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("Create nested file through dialog", (await page.locator('[role="tab"]:has-text("new-note.md")').count()) === 1);

  /* ---------- reload keeps agent history ---------- */
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('aside[aria-label="ИИ-агент"]');
  await page.waitForTimeout(800);
  await page.keyboard.press("Alt+Digit1");
  check("Chat history persists after reload", (await page.locator("text=Объясни fibonacci").count()) >= 1);
  await shot("08-final");

  // Monaco's diff widget rejects an in-flight computation with "Canceled" on dispose (benign, internal to the CDN bundle).
  const real = consoleErrors.filter((e) => !(e.startsWith("pageerror: Canceled") && e.includes("monaco-editor")));
  check("No console errors", real.length === 0, real.slice(0, 5).join(" || "));
} catch (err) {
  failures++;
  console.log("FAIL  unexpected exception:", err instanceof Error ? err.message : err);
  await shot("99-failure").catch(() => {});
  if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 8));
} finally {
  await browser.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
