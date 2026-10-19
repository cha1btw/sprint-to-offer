// Database side of the planner. The web pages, the Telegram bot and the
// reminder job all go through these functions, so the rules live in one place.
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import {
  dayLogs,
  dayPlans,
  fixedBlocks,
  planBlocks,
  settings,
  tasks,
  weeks,
  type BlockStatus,
} from "../db/schema.ts";
import { daysBetween, kyivDate, kyivMinutes, minuteToUtc, weekday } from "../time.ts";
import { buildDay, type DayRules, type FixedInput } from "./build-day.ts";
import { buildDemand } from "./demand.ts";

export type Settings = typeof settings.$inferSelect;
export type Block = typeof planBlocks.$inferSelect;
export type DayLog = typeof dayLogs.$inferSelect;
export type Week = typeof weeks.$inferSelect;
export type Task = typeof tasks.$inferSelect;

export const LOG_COUNTERS = ["lc", "apps", "net", "mock", "trainer"] as const;
export type LogCounter = (typeof LOG_COUNTERS)[number];

export async function getSettings(db: Db): Promise<Settings | null> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row ?? null;
}

export const rulesOf = (s: Settings): DayRules => ({
  wakeMin: s.wakeMin,
  sleepMin: s.sleepMin,
  focusBudgetMin: s.focusBudgetMin,
  blockMin: s.blockMin,
  breakMin: s.breakMin,
});

export async function getFixedFor(db: Db, date: string): Promise<FixedInput[]> {
  const rows = await db
    .select()
    .from(fixedBlocks)
    .where(sql`${weekday(date)} = any(${fixedBlocks.weekdays})`)
    .orderBy(asc(fixedBlocks.startMin));
  return rows.map((r) => ({ title: r.title, kind: r.kind, startMin: r.startMin, endMin: r.endMin }));
}

export async function getWeekFor(db: Db, date: string): Promise<Week | null> {
  const [row] = await db.select().from(weeks).where(and(lte(weeks.startDate, date), gte(weeks.endDate, date)));
  return row ?? null;
}

const emptyLog = (date: string): DayLog => ({
  date,
  focusMin: 0,
  lc: 0,
  apps: 0,
  net: 0,
  mock: 0,
  trainer: 0,
  algo: false,
  note: "",
  updatedAt: new Date(0),
});

export async function getDayLog(db: Db, date: string): Promise<DayLog> {
  const [row] = await db.select().from(dayLogs).where(eq(dayLogs.date, date));
  return row ?? emptyLog(date);
}

export async function getWeekTotals(db: Db, week: Week) {
  const [row] = await db
    .select({
      focusMin: sql<number>`coalesce(sum(${dayLogs.focusMin}), 0)::int`,
      lc: sql<number>`coalesce(sum(${dayLogs.lc}), 0)::int`,
      apps: sql<number>`coalesce(sum(${dayLogs.apps}), 0)::int`,
      net: sql<number>`coalesce(sum(${dayLogs.net}), 0)::int`,
      mock: sql<number>`coalesce(sum(${dayLogs.mock}), 0)::int`,
    })
    .from(dayLogs)
    .where(and(gte(dayLogs.date, week.startDate), lte(dayLogs.date, week.endDate)));
  return row;
}

export async function getWeekTasks(db: Db, n: number): Promise<Task[]> {
  return db.select().from(tasks).where(eq(tasks.week, n)).orderBy(asc(tasks.done), asc(tasks.sort));
}

export async function getBlocks(db: Db, date: string): Promise<Block[]> {
  return db.select().from(planBlocks).where(eq(planBlocks.date, date)).orderBy(asc(planBlocks.startMin));
}

// The block that covers `now`, and the one after it.
export function currentAndNext(blocks: Block[], now: Date) {
  const t = now.getTime();
  const current = blocks.find((b) => b.startAt.getTime() <= t && t < b.endAt.getTime()) ?? null;
  const next = blocks.find((b) => b.startAt.getTime() > t) ?? null;
  return { current, next };
}

type PlanOptions = { now?: Date; fromMin?: number };

// Builds today's plan, or rebuilds it from `fromMin` (default: now) while keeping
// fixed blocks, finished blocks and the block in progress.
export async function planDay(db: Db, date: string, options: PlanOptions & { replan?: boolean } = {}) {
  const s = await getSettings(db);
  if (!s) throw new Error("Settings are missing: run npm run db:seed first.");
  const now = options.now ?? new Date();
  const isToday = date === kyivDate(now);
  const [fixed, week, log, existing] = await Promise.all([
    getFixedFor(db, date),
    getWeekFor(db, date),
    getDayLog(db, date),
    getBlocks(db, date),
  ]);
  const totals = week ? await getWeekTotals(db, week) : { lc: 0, apps: 0, net: 0, focusMin: 0, mock: 0 };
  const open = week ? (await getWeekTasks(db, week.n)).filter((t) => !t.done) : [];

  const replan = options.replan && existing.length > 0;
  // Today is always laid out from now: time that has passed cannot hold tasks.
  const fromMin = options.fromMin ?? (isToday ? kyivMinutes(now) : undefined);
  const keep = replan
    ? existing.filter((b) => b.kind === "fixed" || b.status !== "planned" || (fromMin !== undefined && b.endMin <= fromMin))
    : [];
  const keepIds = new Set(keep.map((b) => b.id));
  const handled = new Set(keep.filter((b) => b.status !== "planned" && b.demandKey).map((b) => b.demandKey!));

  const demand = buildDemand({
    log,
    week: week ? { lcTopic: week.lcTopic, targets: week.targets } : null,
    weekActual: totals,
    daysLeft: week ? daysBetween(date, week.endDate) + 1 : 1,
    tasks: open.map((t) => ({ id: t.id, track: t.track, title: t.title, sort: t.sort })),
  }).filter((d) => !handled.has(d.key));

  // Blocks that stay (a block in progress) occupy time like fixed ones.
  const occupied: FixedInput[] = keep
    .filter((b) => b.kind !== "fixed" && b.endMin > (fromMin ?? 0))
    .map((b) => ({ title: b.title, kind: "study", startMin: b.startMin, endMin: b.endMin }));

  const planned = buildDay({
    rules: rulesOf(s),
    fixed: [...fixed, ...occupied],
    demand,
    fromMin,
    focusDoneMin: isToday ? log.focusMin : 0,
  });
  const fresh = replan ? planned.filter((b) => b.kind !== "fixed") : planned;

  await db.transaction(async (tx) => {
    await tx
      .insert(dayPlans)
      .values({ date, source: "auto" })
      .onConflictDoUpdate({ target: dayPlans.date, set: { replannedAt: now } });
    if (replan) {
      for (const b of existing) {
        if (!keepIds.has(b.id)) await tx.delete(planBlocks).where(eq(planBlocks.id, b.id));
      }
    } else {
      await tx.delete(planBlocks).where(eq(planBlocks.date, date));
    }
    if (fresh.length > 0) {
      await tx.insert(planBlocks).values(
        fresh.map((b) => ({
          date,
          startMin: b.startMin,
          endMin: b.endMin,
          startAt: minuteToUtc(date, b.startMin),
          endAt: minuteToUtc(date, b.endMin),
          kind: b.kind,
          title: b.title,
          track: b.track,
          taskId: b.taskId,
          demandKey: b.demandKey,
        })),
      );
    }
  });
  return getBlocks(db, date);
}

async function ensureLog(db: Db, date: string) {
  await db.insert(dayLogs).values({ date }).onConflictDoNothing();
}

export async function bumpCounter(db: Db, date: string, field: LogCounter, delta: number) {
  await ensureLog(db, date);
  const column = dayLogs[field];
  await db
    .update(dayLogs)
    .set({ [field]: sql`greatest(0, ${column} + ${delta})`, updatedAt: new Date() })
    .where(eq(dayLogs.date, date));
}

export async function setAlgoDone(db: Db, date: string, done: boolean) {
  await ensureLog(db, date);
  await db.update(dayLogs).set({ algo: done, updatedAt: new Date() }).where(eq(dayLogs.date, date));
}

export async function saveNote(db: Db, date: string, note: string) {
  await ensureLog(db, date);
  await db.update(dayLogs).set({ note: note.slice(0, 4000), updatedAt: new Date() }).where(eq(dayLogs.date, date));
}

export async function addFocusMinutes(db: Db, date: string, minutes: number) {
  await ensureLog(db, date);
  await db
    .update(dayLogs)
    .set({ focusMin: sql`greatest(0, ${dayLogs.focusMin} + ${Math.round(minutes)})`, updatedAt: new Date() })
    .where(eq(dayLogs.date, date));
}

// Moves a block through planned → doing → done (or skipped). Finishing a focus
// block adds the real minutes, capped at the planned length, to the day's focus.
export async function setBlockStatus(db: Db, id: string, status: BlockStatus, now: Date = new Date()) {
  const [block] = await db.select().from(planBlocks).where(eq(planBlocks.id, id));
  if (!block || block.status === status) return block ?? null;
  const patch: Partial<Block> = { status };
  if (status === "doing") patch.startedAt = now;
  if (status === "done" || status === "skipped") patch.doneAt = now;
  if (status === "planned") Object.assign(patch, { startedAt: null, doneAt: null });
  await db.update(planBlocks).set(patch).where(eq(planBlocks.id, id));

  if (status === "done" && block.kind === "focus") {
    const planned = block.endMin - block.startMin;
    const spent = block.startedAt ? (now.getTime() - block.startedAt.getTime()) / 60_000 : planned;
    await addFocusMinutes(db, block.date, Math.min(planned, Math.max(1, spent)));
    if (block.demandKey === "algo") await setAlgoDone(db, block.date, true);
  }
  return { ...block, ...patch };
}

export async function setTaskDone(db: Db, id: string, done: boolean, date: string) {
  await db.update(tasks).set({ done, doneAt: done ? date : null }).where(eq(tasks.id, id));
}
