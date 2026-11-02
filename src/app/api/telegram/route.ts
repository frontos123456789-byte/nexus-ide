import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { audit, csrfCheck, readSession, tokenFor } from "@/lib/integrations/server";
import { checkUrl } from "@/lib/nexus/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram Bot API proxy. The bot token lives only on the server (encrypted session cookie or owner env) and is never
 * returned to the browser; it is also scrubbed from every error message.
 */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("me") }),
  z.object({ action: z.literal("webhookInfo") }),
  z.object({ action: z.literal("setWebhook"), url: z.string().url().max(500), secret: z.string().max(256).regex(/^[A-Za-z0-9_-]*$/).optional(), confirm: z.literal(true) }),
  z.object({ action: z.literal("deleteWebhook"), confirm: z.literal(true) }),
  z.object({ action: z.literal("updates") }),
  z.object({ action: z.literal("send"), chatId: z.union([z.string().max(64), z.number()]), text: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("setCommands"), commands: z.array(z.object({ command: z.string().regex(/^[a-z0-9_]{1,32}$/), description: z.string().min(1).max(256) })).max(100) }),
]);

export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "telegram", 40);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const needsConfirm = parsed.error.issues.some((i) => i.path.includes("confirm"));
    return Response.json({ error: needsConfirm ? "Требуется подтверждение операции" : "Некорректный запрос", code: needsConfirm ? "confirm_required" : undefined }, { status: needsConfirm ? 409 : 400 });
  }
  const token = tokenFor(req, "telegram");
  if (!token) return Response.json({ error: "Токен Telegram-бота не подключён (Studio → Telegram → Подключить токен)", code: "not_connected" }, { status: 401 });
  const a = parsed.data;
  const call = async (method: string, body?: object) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), cache: "no-store" });
    const j = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!j.ok) throw new Error((j.description ?? `HTTP ${r.status}`).replaceAll(token, "***"));
    return j.result;
  };
  const actor = readSession(req).logins?.telegram ?? "owner";
  try {
    switch (a.action) {
      case "me":
        return Response.json({ data: await call("getMe") });
      case "webhookInfo":
        return Response.json({ data: await call("getWebhookInfo") });
      case "setWebhook": {
        const c = checkUrl(a.url);
        if (!c.ok || c.url.protocol !== "https:") return Response.json({ error: "Webhook должен быть публичным HTTPS-адресом" }, { status: 400 });
        const data = await call("setWebhook", { url: a.url, secret_token: a.secret || undefined, drop_pending_updates: false });
        await audit({ actor, action: "telegram:setWebhook", target: c.url.host, ok: true });
        return Response.json({ data });
      }
      case "deleteWebhook": {
        const data = await call("deleteWebhook", { drop_pending_updates: false });
        await audit({ actor, action: "telegram:deleteWebhook", target: "bot", ok: true });
        return Response.json({ data });
      }
      case "updates": {
        // getUpdates only works while no webhook is set; the error is surfaced as is.
        const data = (await call("getUpdates", { limit: 20, timeout: 0, allowed_updates: ["message", "callback_query"] })) as Record<string, unknown>[];
        return Response.json({ data: data.map((u) => ({ id: u.update_id, message: (u.message as Record<string, unknown> | undefined) ?? null, callback: (u.callback_query as Record<string, unknown> | undefined)?.data ?? null })) });
      }
      case "send": {
        const data = await call("sendMessage", { chat_id: a.chatId, text: a.text });
        await audit({ actor, action: "telegram:send", target: String(a.chatId), ok: true });
        return Response.json({ data });
      }
      case "setCommands": {
        const data = await call("setMyCommands", { commands: a.commands });
        await audit({ actor, action: "telegram:setCommands", target: "bot", ok: true, detail: `${a.commands.length} команд` });
        return Response.json({ data });
      }
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.replaceAll(token, "***") : "Ошибка Telegram API" }, { status: 502 });
  }
}
