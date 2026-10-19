// Lays out one day. Pure functions only: no database, no clock, no network,
// so every rule here is covered by tests/build-day.test.ts.
import type { BlockKind, Track } from "../db/schema.ts";

export type DayRules = {
  wakeMin: number;
  sleepMin: number;
  focusBudgetMin: number;
  blockMin: number; // longest focus block
  breakMin: number; // short break between focus blocks
};

// Rules that are not settings: the shortest useful block, when a long rest is
// due, and the evening review that sits one hour before sleep.
export const MIN_BLOCK = 25;
export const MAX_BLOCK = 90;
export const LONG_BREAK_AFTER = 100;
export const LONG_BREAK = 20;
export const REVIEW_MIN = 15;
export const REVIEW_BEFORE_SLEEP = 60;
const MIN_REST = 15;
const MIN_TAIL = 15;

export type FixedInput = {
  title: string;
  kind: string; // routine | meal | study | sport | other
  startMin: number;
  endMin: number;
};

// Something the day should contain, in priority order.
export type DemandItem = {
  key: string;
  title: string;
  track: Track | null;
  minutes: number;
  taskId?: string | null;
};

export type PlannedBlock = {
  startMin: number;
  endMin: number;
  kind: BlockKind;
  title: string;
  track: Track | null;
  taskId: string | null;
  demandKey: string | null;
};

export type BuildInput = {
  rules: DayRules;
  fixed: FixedInput[];
  demand: DemandItem[];
  // Replan: lay out only the time after this minute. Defaults to wake-up.
  fromMin?: number;
  // Focus minutes already spent today; they count against the budget.
  focusDoneMin?: number;
};

const roundUp5 = (m: number) => Math.ceil(m / 5) * 5;
const roundDown5 = (m: number) => Math.floor(m / 5) * 5;

type Busy = { startMin: number; endMin: number; resets: boolean };

// Free intervals between `from` and `to` that no busy block covers.
export function freeWindows(from: number, to: number, busy: Busy[]): Array<[number, number]> {
  const sorted = [...busy].sort((a, b) => a.startMin - b.startMin);
  const out: Array<[number, number]> = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.endMin <= cursor) continue;
    if (b.startMin >= to) break;
    if (b.startMin > cursor) out.push([cursor, Math.min(b.startMin, to)]);
    cursor = Math.max(cursor, b.endMin);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

export function buildDay(input: BuildInput): PlannedBlock[] {
  const { rules } = input;
  const dayStart = Math.max(rules.wakeMin, roundUp5(input.fromMin ?? rules.wakeMin));
  const blocks: PlannedBlock[] = [];

  // Fixed blocks keep their place; the parts outside the waking day are cut off.
  const fixed = input.fixed
    .map((f) => ({ ...f, startMin: Math.max(f.startMin, rules.wakeMin), endMin: Math.min(f.endMin, rules.sleepMin) }))
    .filter((f) => f.startMin < f.endMin);
  for (const f of fixed) {
    blocks.push({ startMin: f.startMin, endMin: f.endMin, kind: "fixed", title: f.title, track: null, taskId: null, demandKey: null });
  }
  // A lecture is not rest: focus counted before it keeps counting after it.
  const busy: Busy[] = fixed.map((f) => ({ startMin: f.startMin, endMin: f.endMin, resets: f.kind !== "study" }));

  // Evening review, one hour before sleep, when that slot is free.
  const reviewEnd = rules.sleepMin - REVIEW_BEFORE_SLEEP;
  const reviewStart = reviewEnd - REVIEW_MIN;
  if (reviewStart >= dayStart && !busy.some((b) => b.startMin < reviewEnd && b.endMin > reviewStart)) {
    blocks.push({ startMin: reviewStart, endMin: reviewEnd, kind: "review", title: "Разбор дня и план на завтра", track: null, taskId: null, demandKey: "review" });
    busy.push({ startMin: reviewStart, endMin: reviewEnd, resets: true });
  }

  const queue = input.demand
    .filter((d) => d.minutes > 0)
    .map((d) => ({ ...d, remaining: d.minutes }));
  let budget = Math.max(0, rules.focusBudgetMin - (input.focusDoneMin ?? 0));
  let streak = 0; // focus minutes since the last real rest

  const windows = freeWindows(dayStart, rules.sleepMin, busy);
  for (const [winStart, winEnd] of windows) {
    const before = busy.find((b) => b.endMin === winStart);
    if (!before || before.resets) streak = 0;
    let cursor = winStart;
    let lastWasFocus = false;

    while (queue.length > 0 && budget >= Math.min(MIN_BLOCK, queue[0].remaining)) {
      if (lastWasFocus) {
        const restLen = streak >= LONG_BREAK_AFTER ? LONG_BREAK : rules.breakMin;
        if (winEnd - cursor < restLen + MIN_BLOCK) break;
        blocks.push({
          startMin: cursor,
          endMin: cursor + restLen,
          kind: "break",
          title: restLen === LONG_BREAK ? "Длинный перерыв: встать, вода, без телефона" : "Перерыв",
          track: null,
          taskId: null,
          demandKey: null,
        });
        cursor += restLen;
        if (restLen === LONG_BREAK) streak = 0;
      }
      const item = queue[0];
      const minLen = Math.min(MIN_BLOCK, item.remaining);
      const room = Math.min(MAX_BLOCK, budget, winEnd - cursor);
      let len = Math.min(item.remaining, rules.blockMin, room);
      // A tail under 15 minutes is not worth its own block: take it now if it fits.
      if (item.remaining - len > 0 && item.remaining - len < MIN_TAIL && item.remaining <= room) len = item.remaining;
      len = roundDown5(len);
      if (len < minLen || len <= 0) break;
      blocks.push({
        startMin: cursor,
        endMin: cursor + len,
        kind: "focus",
        title: item.title,
        track: item.track,
        taskId: item.taskId ?? null,
        demandKey: item.key,
      });
      cursor += len;
      budget -= len;
      streak += len;
      item.remaining -= len;
      if (item.remaining < MIN_TAIL) queue.shift();
      lastWasFocus = true;
    }

    // What is left of the window is planned rest, so free time has an end.
    if (winEnd - cursor >= MIN_REST) {
      blocks.push({
        startMin: cursor,
        endMin: winEnd,
        kind: "rest",
        title: winEnd === rules.sleepMin ? "Отдых и подготовка ко сну" : "Свободное время",
        track: null,
        taskId: null,
        demandKey: null,
      });
    }
  }

  return blocks.sort((a, b) => a.startMin - b.startMin);
}

// Hard rules every plan must pass, including one proposed by Claude.
// Returns human-readable problems; an empty list means the plan is valid.
export function validatePlan(blocks: PlannedBlock[], rules: DayRules, fixed: FixedInput[], focusDoneMin = 0): string[] {
  const problems: string[] = [];
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
  let focus = 0;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.startMin >= b.endMin) problems.push(`«${b.title}»: конец раньше начала`);
    if (b.startMin < rules.wakeMin || b.endMin > rules.sleepMin) problems.push(`«${b.title}»: за пределами дня`);
    if (i > 0 && sorted[i - 1].endMin > b.startMin) problems.push(`«${sorted[i - 1].title}» пересекается с «${b.title}»`);
    if (b.kind === "focus") {
      const len = b.endMin - b.startMin;
      if (len > MAX_BLOCK) problems.push(`«${b.title}»: блок длиннее ${MAX_BLOCK} минут`);
      focus += len;
    }
  }
  if (focus + focusDoneMin > rules.focusBudgetMin) problems.push("фокуса больше дневного бюджета");
  for (const f of fixed) {
    const start = Math.max(f.startMin, rules.wakeMin);
    const end = Math.min(f.endMin, rules.sleepMin);
    if (start >= end) continue;
    if (!sorted.some((b) => b.kind === "fixed" && b.startMin === start && b.endMin === end)) {
      problems.push(`фиксированный блок «${f.title}» сдвинут или пропал`);
    }
  }
  return problems;
}
