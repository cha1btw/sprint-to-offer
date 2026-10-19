import { timingSafeEqual } from "node:crypto";
import type { InlineKeyboard } from "grammy";
import { ownerTelegramId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { runTick } from "@/lib/planner/tick";
import { sendTelegramHtml } from "@/lib/telegram";

function isAuthorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Called by Vercel Cron once a day and by .github/workflows/tick.yml every
// 5 minutes, both with "Authorization: Bearer <CRON_SECRET>". Unconfigured
// means closed: without the secret anyone could make the bot write to you.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const ownerId = ownerTelegramId();
  if (!secret || !ownerId) return new Response("Not configured", { status: 503 });
  if (!isAuthorized(request, secret)) return new Response("Unauthorized", { status: 401 });

  const send = (text: string, keyboard?: InlineKeyboard) =>
    sendTelegramHtml(ownerId, text, keyboard ? { reply_markup: keyboard } : {});
  try {
    return Response.json(await runTick(getDb(), send));
  } catch (error) {
    console.error("Tick failed.", error);
    return new Response("Error", { status: 500 });
  }
}
