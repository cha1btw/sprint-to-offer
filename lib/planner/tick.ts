// Runs every few minutes from a scheduler. Sends Telegram messages when a block
// starts, when a focus block was not started 10 minutes in, and builds the day
// in the morning if it is not built yet. Each block is announced at most once.
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { InlineKeyboard } from "grammy";
import { aiStatus } from "../ai/budget.ts";
import type { ClaudeClient } from "../ai/client.ts";
import { blockKeyboard, dayText, driftKeyboard, span } from "../bot/views.ts";
import type { Db } from "../db/index.ts";
import { dayPlans, planBlocks } from "../db/schema.ts";
import { escapeTelegramHtml as esc } from "../telegram.ts";
import { kyivDate, kyivMinutes } from "../time.ts";
import { getSettings, planDay } from "./service.ts";

export type Send = (text: string, keyboard?: InlineKeyboard) => Promise<boolean>;

const ANNOUNCE_WINDOW_MIN = 15; // a late scheduler run still announces the block
const DRIFT_AFTER_MIN = 10;

export async function runTick(db: Db, send: Send, now: Date = new Date(), claude: ClaudeClient | null = null) {
  const result = { planned: false, announced: 0, nudged: 0 };
  const s = await getSettings(db);
  if (!s) return result;
  const date = kyivDate(now);

  // Morning: build today's plan once the owner is awake.
  const [plan] = await db.select().from(dayPlans).where(eq(dayPlans.date, date));
  if (!plan && kyivMinutes(now) >= s.wakeMin) {
    const blocks = await planDay(db, date, { now });
    result.planned = true;
    await send(`Доброе утро! ${dayText(date, blocks)}`);
  }

  const t = now.getTime();
  // Asked once per tick, only when a message is about to go out.
  let ai: boolean | undefined;
  const aiOn = async () => (ai ??= (await aiStatus(db, claude, now)).enabled);
  const due = await db
    .select()
    .from(planBlocks)
    .where(
      and(
        inArray(planBlocks.kind, ["focus", "review", "rest"]),
        eq(planBlocks.status, "planned"),
        isNull(planBlocks.notifiedAt),
        lte(planBlocks.startAt, now),
        gt(planBlocks.startAt, new Date(t - ANNOUNCE_WINDOW_MIN * 60_000)),
      ),
    );
  for (const b of due) {
    const text =
      b.kind === "rest"
        ? `Свободное время до ${span(b).split("–")[1]}. Отдыхай без чувства вины, потом следующий блок.`
        : `Начинается: <b>${esc(b.title)}</b>\n${span(b)}`;
    // Mark first, so a slow Telegram call cannot cause a second message.
    await db.update(planBlocks).set({ notifiedAt: now }).where(eq(planBlocks.id, b.id));
    if (await send(text, b.kind === "focus" ? blockKeyboard(b, await aiOn()) : undefined)) result.announced++;
  }

  const drifting = await db
    .select()
    .from(planBlocks)
    .where(
      and(
        eq(planBlocks.kind, "focus"),
        eq(planBlocks.status, "planned"),
        isNull(planBlocks.startedAt),
        isNull(planBlocks.driftNotifiedAt),
        lte(planBlocks.startAt, new Date(t - DRIFT_AFTER_MIN * 60_000)),
        gt(planBlocks.endAt, now),
      ),
    );
  for (const b of drifting) {
    await db.update(planBlocks).set({ driftNotifiedAt: now }).where(eq(planBlocks.id, b.id));
    const text = `Блок «${esc(b.title)}» идёт уже ${DRIFT_AFTER_MIN} минут, а старта нет. Начни с пяти минут: открой задачу и сделай первый маленький шаг.`;
    if (await send(text, driftKeyboard(b, await aiOn()))) result.nudged++;
  }

  return result;
}
