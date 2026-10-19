import { Bot, type Context } from "grammy";
import { aiErrorText, aiStatus } from "../ai/budget.ts";
import type { ClaudeClient } from "../ai/client.ts";
import { firstStep } from "../ai/first-step.ts";
import { createLoginToken } from "../auth.ts";
import type { Db } from "../db/index.ts";
import { currentAndNext, getBlocks, getSettings, planDay, setBlockStatus } from "../planner/service.ts";
import { kyivDate, kyivMinutes } from "../time.ts";
import { blockKeyboard, dayText, nowText } from "./views.ts";

const HELP = [
  "Это бот твоего плана дня.",
  "",
  "/now — что делать прямо сейчас",
  "/today — план на сегодня",
  "/replan — пересобрать день с текущего момента",
  "/login — ссылка для входа в приложение",
].join("\n");

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

export function createBot(db: Db, token: string, ownerId: number, appUrl: string, claude: ClaudeClient | null = null) {
  const bot = new Bot(token);

  // Only the owner gets answers; everyone else is ignored without a reply.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ownerId) await next();
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

  bot.command("login", async (ctx) => {
    const token = await createLoginToken(db);
    const link = `${appUrl.replace(/\/$/, "")}/auth?token=${token}`;
    await ctx.reply(`Ссылка для входа, действует 10 минут и один раз:\n${link}`, { link_preview_options: { is_disabled: true } });
  });

  bot.command("today", async (ctx) => {
    const date = kyivDate();
    await ctx.reply(dayText(date, await getBlocks(db, date)), html);
  });

  bot.command("now", (ctx) => replyNow(ctx));

  bot.command("replan", async (ctx) => {
    await replanFrom(kyivMinutes());
    await replyNow(ctx);
  });

  bot.callbackQuery(/^(start|done|skip):([0-9a-f-]{36})$/, async (ctx) => {
    const [, action, id] = ctx.match;
    const status = action === "start" ? "doing" : action === "done" ? "done" : "skipped";
    await setBlockStatus(db, id, status);
    await ctx.answerCallbackQuery({ text: status === "doing" ? "Поехали!" : status === "done" ? "Засчитано" : "Пропущено" });
    await replyNow(ctx);
  });

  bot.callbackQuery(/^stuck:([0-9a-f-]{36})$/, async (ctx) => {
    // Answer the button at once: Telegram shows a spinner until we do.
    await ctx.answerCallbackQuery({ text: "Спрашиваю Claude…" });
    await ctx.replyWithChatAction("typing");
    try {
      await ctx.reply(`🧩 ${await firstStep(db, claude, ctx.match[1])}`);
    } catch (error) {
      await ctx.reply(aiErrorText(error));
    }
  });

  bot.callbackQuery("later", async (ctx) => {
    await replanFrom(kyivMinutes() + 30);
    await ctx.answerCallbackQuery({ text: "Сдвинул план на 30 минут" });
    await replyNow(ctx);
  });

  bot.callbackQuery("replan", async (ctx) => {
    await replanFrom(kyivMinutes());
    await ctx.answerCallbackQuery({ text: "Пересобрал день" });
    await replyNow(ctx);
  });

  bot.on("message:text", (ctx) => ctx.reply(`Чат с Claude появится на следующем этапе.\n\n${HELP}`));

  async function replanFrom(fromMin: number) {
    if (!(await getSettings(db))) return;
    await planDay(db, kyivDate(), { replan: true, fromMin });
  }

  async function replyNow(ctx: Context) {
    const blocks = await getBlocks(db, kyivDate());
    const { current, next } = currentAndNext(blocks, new Date());
    const ai = (await aiStatus(db, claude)).enabled;
    await ctx.reply(nowText(current, next), { ...html, reply_markup: blockKeyboard(current, ai) });
  }

  bot.catch((err) => console.error("Bot error", err.error));
  return bot;
}
