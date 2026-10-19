// Evening review: Claude reads what was done and skipped today and proposes
// three goals for tomorrow. Saved on the day's plan, so the web shows it and
// tomorrow's plan with Claude starts from these goals.
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { dayPlans, type DayReview } from "../db/schema.ts";
import { MINIMUM } from "../planner/demand.ts";
import { getBlocks, getDayLog, getDayPlan, getFixedFor, getWeekFor, getWeekTasks, getWeekTotals } from "../planner/service.ts";
import { escapeTelegramHtml as esc } from "../telegram.ts";
import { addDays, formatDayRu, formatHm } from "../time.ts";
import { AiUnavailableError, callClaude } from "./budget.ts";
import type { ClaudeClient } from "./client.ts";

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-4 sentences in Russian: what got done, what was skipped and the likely reason" },
    goals: { type: "array", items: { type: "string" }, description: "exactly 3 concrete goals for tomorrow, in Russian" },
  },
  required: ["summary", "goals"],
  additionalProperties: false,
};

const SYSTEM = `You write the evening review for a student working toward a first junior full-stack developer offer by 28 February 2027.
Be honest and brief, like a good mentor: name what got done, what was skipped and what probably got in the way. No praise for nothing, no guilt-tripping.
Then give exactly three goals for tomorrow. Each goal is concrete and checkable by evening ("решить 2 задачи на Two Pointers", not "больше заниматься"); the minimum day (algorithms, trainer questions, one application) comes first if it was missed today.
Write in Russian.`;

const STATUS_RU: Record<string, string> = { planned: "не начат", doing: "начат, не закрыт", done: "сделан", skipped: "пропущен" };

export async function reviewPrompt(db: Db, date: string): Promise<string> {
  const tomorrow = addDays(date, 1);
  const [blocks, log, week, tomorrowWeek, tomorrowFixed] = await Promise.all([
    getBlocks(db, date),
    getDayLog(db, date),
    getWeekFor(db, date),
    getWeekFor(db, tomorrow),
    getFixedFor(db, tomorrow),
  ]);
  const totals = week ? await getWeekTotals(db, week) : null;
  const openTasks = tomorrowWeek ? (await getWeekTasks(db, tomorrowWeek.n)).filter((t) => !t.done) : [];
  const lines = [
    `Сегодня ${formatDayRu(date)}.`,
    "Блоки фокуса:",
    ...blocks
      .filter((b) => b.kind === "focus")
      .map((b) => `- ${formatHm(b.startMin)}–${formatHm(b.endMin)} ${b.title}: ${STATUS_RU[b.status]}`),
    `Счётчики: фокус ${log.focusMin} мин, LeetCode ${log.lc}, отклики ${log.apps}, вопросы тренажёра ${log.trainer}, нетворкинг ${log.net}, mock ${log.mock}.`,
    `Минимальный день: алгоритмы ${log.algo || log.lc > 0 ? "да" : "нет"}, тренажёр ${log.trainer}/${MINIMUM.trainer}, отклики ${log.apps}/${MINIMUM.apps}.`,
    log.note ? `Заметка дня: ${log.note.slice(0, 1000)}` : "Заметки дня нет.",
    week && totals
      ? `Неделя ${week.n} (${week.theme}), цели: ${week.targets.hours} ч, LC ${week.targets.lc}, отклики ${week.targets.apps}; сделано: ${Math.round(totals.focusMin / 60)} ч, LC ${totals.lc}, отклики ${totals.apps}. Неделя заканчивается ${week.endDate}.`
      : "",
    `Завтра ${formatDayRu(tomorrow)}. Фиксированные блоки: ${tomorrowFixed.map((f) => `${f.title} ${formatHm(f.startMin)}–${formatHm(f.endMin)}`).join(", ") || "нет"}.`,
    tomorrowWeek ? `Открытые задачи недели ${tomorrowWeek.n}: ${openTasks.map((t) => t.title).join("; ") || "нет"}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function eveningReview(db: Db, claude: ClaudeClient | null, date: string, now: Date = new Date()): Promise<DayReview> {
  if (!(await getDayPlan(db, date))) throw new Error("There is no plan for this day.");
  const text = await callClaude(
    db,
    claude,
    "review",
    {
      system: SYSTEM,
      messages: [{ role: "user", content: await reviewPrompt(db, date) }],
      maxTokens: 4000,
      effort: "low",
      schema: REVIEW_SCHEMA,
    },
    now,
  );
  let review: DayReview;
  try {
    const raw = JSON.parse(text) as { summary?: unknown; goals?: unknown };
    const goals = Array.isArray(raw.goals) ? raw.goals.map((g) => String(g).trim().slice(0, 200)).filter(Boolean).slice(0, 3) : [];
    if (typeof raw.summary !== "string" || goals.length === 0) throw new Error("bad shape");
    review = { summary: raw.summary.trim().slice(0, 1500), goals, createdAt: now.toISOString() };
  } catch {
    throw new AiUnavailableError("bad_output");
  }
  await db.update(dayPlans).set({ review }).where(eq(dayPlans.date, date));
  return review;
}

// Goals from yesterday's review, for today's plan and the Now screen.
export async function goalsFor(db: Db, date: string): Promise<string[]> {
  return (await getDayPlan(db, addDays(date, -1)))?.review?.goals ?? [];
}

export function reviewText(review: DayReview): string {
  return [
    "<b>Разбор дня</b>",
    esc(review.summary),
    "",
    "<b>Цели на завтра</b>",
    ...review.goals.map((g, i) => `${i + 1}. ${esc(g)}`),
  ].join("\n");
}
