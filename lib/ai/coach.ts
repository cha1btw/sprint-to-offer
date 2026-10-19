// Coach chat: free text to the bot or the web chat. Claude sees today's plan,
// the week's progress, the last note and the recent messages of the chat.
import { desc, ne } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/index.ts";
import { chatMessages, dayLogs } from "../db/schema.ts";
import { currentAndNext, getBlocks, getDayLog, getWeekFor, getWeekTasks, getWeekTotals } from "../planner/service.ts";
import { formatDayRu, formatHm, kyivDate, kyivMinutes } from "../time.ts";
import { callClaude } from "./budget.ts";
import type { ClaudeClient } from "./client.ts";
import { goalsFor } from "./review.ts";

export type ChatMessage = typeof chatMessages.$inferSelect;
export type Channel = ChatMessage["channel"];

export const MAX_MESSAGE = 2000;
const HISTORY = 12; // messages of earlier conversation sent with each question

const SYSTEM = `You are a direct, practical coach for a 20-year-old student in Kyiv who is working toward a first junior full-stack developer offer or internship by 28 February 2027 (TypeScript, React/Next.js, Node/Nest.js, PostgreSQL). The app plans the day in focus blocks with planned rest.
Answer in Russian, briefly: usually 2-6 sentences, a short list only when it really helps. Plain text, no markdown headings or tables.
Be honest: if the plan is slipping, say so and suggest the smallest next step that brings the day back. If a question has nothing to do with getting the offer, answer briefly and say so.
The context below is the current state of the plan; use it instead of asking for it.`;

const STATUS_RU: Record<string, string> = { planned: "", doing: " (идёт)", done: " (сделано)", skipped: " (пропущено)" };

export async function coachContext(db: Db, now: Date = new Date()): Promise<string> {
  const date = kyivDate(now);
  const [blocks, log, week, goals, [lastNote]] = await Promise.all([
    getBlocks(db, date),
    getDayLog(db, date),
    getWeekFor(db, date),
    goalsFor(db, date),
    db.select({ date: dayLogs.date, note: dayLogs.note }).from(dayLogs).where(ne(dayLogs.note, "")).orderBy(desc(dayLogs.date)).limit(1),
  ]);
  const { current } = currentAndNext(blocks, now);
  const totals = week ? await getWeekTotals(db, week) : null;
  const tasks = week ? await getWeekTasks(db, week.n) : [];
  return [
    `Сейчас ${formatDayRu(date)}, ${formatHm(kyivMinutes(now))} по Киеву.`,
    `Текущий блок: ${current ? `${current.title}${STATUS_RU[current.status]}` : "нет"}.`,
    "План на сегодня:",
    ...(blocks.length
      ? blocks.filter((b) => b.kind !== "break").map((b) => `- ${formatHm(b.startMin)}–${formatHm(b.endMin)} ${b.title}${STATUS_RU[b.status]}`)
      : ["- ещё не собран"]),
    `Сегодня: фокус ${log.focusMin} мин, LeetCode ${log.lc}, отклики ${log.apps}, вопросы ${log.trainer}.`,
    week && totals
      ? `Неделя ${week.n} (${week.theme}): часы ${Math.round(totals.focusMin / 60)}/${week.targets.hours}, LC ${totals.lc}/${week.targets.lc}, отклики ${totals.apps}/${week.targets.apps}, задачи ${tasks.filter((t) => t.done).length}/${tasks.length}.`
      : "",
    goals.length ? `Цели на сегодня из вчерашнего разбора: ${goals.join("; ")}.` : "",
    lastNote ? `Последняя заметка (${lastNote.date}): ${lastNote.note.slice(0, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function recentMessages(db: Db, limit = 30): Promise<ChatMessage[]> {
  const rows = await db.select().from(chatMessages).orderBy(desc(chatMessages.createdAt)).limit(limit);
  return rows.reverse();
}

// Saves the question, asks Claude and saves the answer. On failure the
// question stays in the history and the error goes to the caller.
export async function askCoach(db: Db, claude: ClaudeClient | null, text: string, channel: Channel, now: Date = new Date()): Promise<string> {
  const question = text.trim().slice(0, MAX_MESSAGE);
  if (!question) throw new Error("Empty message.");
  const history = await recentMessages(db, HISTORY);
  // The API needs the conversation to start with a user message.
  while (history.length > 0 && history[0].role !== "user") history.shift();
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];
  await db.insert(chatMessages).values({ role: "user", channel, content: question, createdAt: now });
  const answer = await callClaude(
    db,
    claude,
    "coach",
    { system: `${SYSTEM}\n\n${await coachContext(db, now)}`, messages, maxTokens: 4000, effort: "low" },
    now,
  );
  await db.insert(chatMessages).values({ role: "assistant", channel, content: answer, createdAt: new Date(now.getTime() + 1) });
  return answer;
}
