// Usage: npm run bot:webhook   (after the app is deployed)
export {};
// Points the bot at APP_URL/api/telegram and registers the command menu.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL;
if (!token || !secret || !appUrl) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL first.");
  process.exit(1);
}

async function call(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
}

await call("setWebhook", {
  url: `${appUrl.replace(/\/$/, "")}/api/telegram`,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
await call("setMyCommands", {
  commands: [
    { command: "now", description: "Что делать прямо сейчас" },
    { command: "today", description: "План на сегодня" },
    { command: "replan", description: "Пересобрать день с текущего момента" },
    { command: "login", description: "Ссылка для входа в приложение" },
  ],
});
console.log("Webhook and commands are set.");
