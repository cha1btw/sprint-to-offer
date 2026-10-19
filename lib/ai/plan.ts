// "Составить день с Claude": Claude proposes the blocks, the server checks them
// with the same hard rules as the rule-based planner and falls back to
// buildDay() on any problem. Claude never chooses task ids or fixed blocks:
// it only arranges items from the demand list around them.
import type { Db } from "../db/index.ts";
import { MIN_BLOCK, buildDay, validatePlan, type DayRules, type DemandItem, type FixedInput, type PlannedBlock } from "../planner/build-day.ts";
import { buildInputOf, prepareDay, savePlan, type Block, type DayContext } from "../planner/service.ts";
import { formatDayRu } from "../time.ts";
import { AiUnavailableError, callClaude } from "./budget.ts";
import type { ClaudeClient } from "./client.ts";
import { goalsFor } from "./review.ts";

const AI_KINDS = ["focus", "break", "rest", "review"] as const;

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "HH:MM; after midnight continue past 24, e.g. 24:30" },
          end: { type: "string", description: "HH:MM, same convention as start" },
          kind: { type: "string", enum: [...AI_KINDS] },
          demandKey: { type: "string", description: "key of the demand item for focus blocks, \"review\" for the review, empty otherwise" },
          title: { type: "string", description: "short title in Russian for break and rest blocks" },
        },
        required: ["start", "end", "kind", "demandKey", "title"],
        additionalProperties: false,
      },
    },
    comment: { type: "string", description: "one sentence in Russian: why the day is arranged this way" },
  },
  required: ["blocks", "comment"],
  additionalProperties: false,
};

const SYSTEM = `You plan one day for a student who is preparing for a first junior full-stack developer job and tends to drift into YouTube when the day has no shape.
You receive the day's rules, the fixed blocks and a priority-ordered list of what the day should contain (the demand list). Return the blocks for the free time.

Hard rules (a plan that breaks any of them is thrown away):
- Every block starts at or after "planFrom" and ends by "sleep". Blocks do not overlap each other or any fixed or occupied block.
- Do not return fixed or occupied blocks; they are already placed.
- Total focus minutes must not exceed "focusBudgetLeft". A focus block is at most 90 minutes.
- Every focus block uses the exact "key" of a demand item as demandKey. Do not invent tasks.

How a good day looks:
- Boring first: follow the order of the demand list unless a fixed block makes another order clearly better.
- Focus blocks of about "blockMin" minutes, at least ${MIN_BLOCK}; split a long item into several blocks.
- A short break of "breakMin" minutes after each focus block, a 20-minute break after about 100 minutes of focus in a row.
- A 15-minute review block (demandKey "review") one hour before sleep, if that time is free.
- Fill every remaining gap of 15 minutes or more with a "rest" block: rest is planned and guilt-free, and it has an end.
- Times in multiples of 5 minutes. Titles in Russian, short and concrete.`;

const pad = (n: number) => String(n).padStart(2, "0");
// Like formatHm, but without wrapping at midnight, so 00:30 after midnight is "24:30".
export const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function parseTime(value: unknown, wakeMin: number): number | null {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 29 || minute > 59) return null;
  const min = hour * 60 + minute;
  // "00:30" written for a time after midnight.
  return min < wakeMin ? min + 1440 : min;
}

const clip = (f: FixedInput, rules: DayRules) => ({
  ...f,
  startMin: Math.max(f.startMin, rules.wakeMin),
  endMin: Math.min(f.endMin, rules.sleepMin),
});

export type PlanInput = {
  rules: DayRules;
  fixed: FixedInput[]; // fixed and occupied blocks
  demand: DemandItem[];
  fromMin?: number;
  focusDoneMin: number;
};

// Turns Claude's JSON into planner blocks and lists every rule it breaks.
// Pure, so tests/ai-plan.test.ts covers it without a database.
export function aiPlanToBlocks(text: string, input: PlanInput): { blocks: PlannedBlock[]; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { blocks: [], problems: ["ответ не JSON"] };
  }
  const items = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(items)) return { blocks: [], problems: ["нет списка блоков"] };

  const { rules } = input;
  const demand = new Map(input.demand.map((d) => [d.key, d]));
  const fromMin = Math.max(rules.wakeMin, input.fromMin ?? rules.wakeMin);
  const blocks: PlannedBlock[] = input.fixed
    .map((f) => clip(f, rules))
    .filter((f) => f.startMin < f.endMin)
    .map((f) => ({ startMin: f.startMin, endMin: f.endMin, kind: "fixed", title: f.title, track: null, taskId: null, demandKey: null }));

  for (const item of items as Array<Record<string, unknown>>) {
    const startMin = parseTime(item.start, rules.wakeMin);
    const endMin = parseTime(item.end, rules.wakeMin);
    const kind = AI_KINDS.find((k) => k === item.kind);
    const key = typeof item.demandKey === "string" ? item.demandKey.trim() : "";
    const label = typeof item.title === "string" ? item.title.trim().slice(0, 80) : "";
    if (startMin === null || endMin === null || !kind) {
      problems.push(`блок с неверным временем или типом: ${JSON.stringify(item).slice(0, 80)}`);
      continue;
    }
    if (startMin < fromMin) problems.push(`«${label || kind}» начинается раньше ${hm(fromMin)}`);
    if (kind === "focus") {
      const d = demand.get(key);
      if (!d) {
        problems.push(`неизвестный пункт «${key}»`);
        continue;
      }
      if (endMin - startMin < Math.min(MIN_BLOCK, d.minutes)) problems.push(`«${d.title}»: блок короче ${MIN_BLOCK} минут`);
      blocks.push({ startMin, endMin, kind, title: d.title, track: d.track, taskId: d.taskId ?? null, demandKey: d.key });
    } else if (kind === "review") {
      blocks.push({ startMin, endMin, kind, title: "Разбор дня и план на завтра", track: null, taskId: null, demandKey: "review" });
    } else {
      const fallback = kind === "break" ? "Перерыв" : "Свободное время";
      blocks.push({ startMin, endMin, kind, title: label || fallback, track: null, taskId: null, demandKey: null });
    }
  }

  problems.push(...validatePlan(blocks, rules, input.fixed, input.focusDoneMin));
  return { blocks: blocks.sort((a, b) => a.startMin - b.startMin), problems };
}

// What Claude sees: the rules, the fixed blocks and the demand list, nothing else.
export function planPrompt(ctx: DayContext, goals: string[] = []): string {
  const { rules } = ctx;
  const planFrom = Math.max(rules.wakeMin, Math.ceil((ctx.fromMin ?? rules.wakeMin) / 5) * 5);
  const week = ctx.week;
  return JSON.stringify(
    {
      date: `${ctx.date} (${formatDayRu(ctx.date)})`,
      wake: hm(rules.wakeMin),
      sleep: hm(rules.sleepMin),
      planFrom: hm(planFrom),
      focusBudgetLeft: Math.max(0, rules.focusBudgetMin - ctx.focusDoneMin),
      blockMin: rules.blockMin,
      breakMin: rules.breakMin,
      fixed: ctx.fixed.map((f) => ({ title: f.title, kind: f.kind, start: hm(f.startMin), end: hm(f.endMin) })),
      occupied: ctx.occupied.map((f) => ({ title: f.title, start: hm(f.startMin), end: hm(f.endMin) })),
      demand: ctx.demand.map((d) => ({ key: d.key, title: d.title, track: d.track, minutes: d.minutes })),
      week: week
        ? { n: week.n, theme: week.theme, light: week.light, targets: week.targets, done: ctx.weekTotals }
        : null,
      today: { focusMin: ctx.log.focusMin, lc: ctx.log.lc, apps: ctx.log.apps, trainer: ctx.log.trainer, note: ctx.log.note.slice(0, 500) },
      goalsFromYesterday: goals,
    },
    null,
    1,
  );
}

export type AiPlanResult = { blocks: Block[]; source: "ai" | "auto"; problems: string[]; comment: string };

// Builds (or rebuilds from now) the day with Claude. Never throws because of
// Claude: any failure ends in the rule-based plan, and the reason is returned.
export async function planDayWithAi(
  db: Db,
  claude: ClaudeClient | null,
  date: string,
  options: { now?: Date; goals?: string[] } = {},
): Promise<AiPlanResult> {
  const ctx = await prepareDay(db, date, { now: options.now, replan: true });
  const goals = options.goals ?? (await goalsFor(db, date));
  let problems: string[];
  try {
    const text = await callClaude(
      db,
      claude,
      "plan",
      {
        system: SYSTEM,
        messages: [{ role: "user", content: planPrompt(ctx, goals) }],
        maxTokens: 16_000,
        effort: "medium",
        schema: PLAN_SCHEMA,
        timeoutMs: 90_000,
      },
      ctx.now,
    );
    const result = aiPlanToBlocks(text, {
      rules: ctx.rules,
      fixed: [...ctx.fixed, ...ctx.occupied],
      demand: ctx.demand,
      fromMin: ctx.fromMin,
      focusDoneMin: ctx.focusDoneMin,
    });
    if (result.problems.length === 0) {
      const comment = String((JSON.parse(text) as { comment?: unknown }).comment ?? "").slice(0, 300);
      return { blocks: await savePlan(db, ctx, result.blocks, "ai", comment || null), source: "ai", problems: [], comment };
    }
    problems = result.problems;
    console.warn("Claude's plan broke the rules, using the planner.", problems);
  } catch (error) {
    problems = [error instanceof AiUnavailableError ? error.reason : "ошибка запроса к Claude"];
    if (!(error instanceof AiUnavailableError)) console.error("Claude plan request failed.", error instanceof Error ? error.message : error);
  }
  return { blocks: await savePlan(db, ctx, buildDay(buildInputOf(ctx)), "auto"), source: "auto", problems, comment: "" };
}
