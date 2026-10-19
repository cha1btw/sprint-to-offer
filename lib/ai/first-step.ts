// "Не могу начать": one concrete action for the first five minutes of a block.
// Haiku is enough for this and costs a fraction of Sonnet.
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { planBlocks } from "../db/schema.ts";
import { getDayLog, getWeekFor } from "../planner/service.ts";
import { callClaude } from "./budget.ts";
import type { ClaudeClient } from "./client.ts";

const SYSTEM = `You help a student who is stuck at the start of a planned work block and is about to procrastinate.
Reply in Russian with one first step that takes about five minutes and needs no decisions: start with a verb, name the exact thing to open or write (a file, a page, a LeetCode problem, a sentence of a cover letter).
One to three short sentences. No greeting, no motivation speech, no list of alternatives, no markdown.`;

export async function firstStep(db: Db, claude: ClaudeClient | null, blockId: string, now: Date = new Date()): Promise<string> {
  const [block] = await db.select().from(planBlocks).where(eq(planBlocks.id, blockId));
  if (!block) throw new Error("Block not found.");
  const [week, log] = await Promise.all([getWeekFor(db, block.date), getDayLog(db, block.date)]);
  const context = [
    `Блок: ${block.title} (${block.endMin - block.startMin} мин, трек ${block.track ?? "нет"}).`,
    week ? `Неделя ${week.n}: ${week.theme}. Тема LeetCode: ${week.lcTopic}.` : "",
    log.note ? `Заметка дня: ${log.note.slice(0, 400)}` : "",
  ].filter(Boolean);
  return callClaude(
    db,
    claude,
    "first_step",
    { system: SYSTEM, messages: [{ role: "user", content: context.join("\n") }], maxTokens: 1500, effort: "low" },
    now,
  );
}
