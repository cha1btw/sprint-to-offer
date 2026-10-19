// What today should contain, in priority order. Pure: the caller loads the
// numbers. The order is the plan's rule "boring first": algorithms, then the
// trainer and applications (the minimum day), then the week's tasks.
import type { Track, WeekTargets } from "../db/schema.ts";
import type { DemandItem } from "./build-day.ts";

export const MINIMUM = { algoMin: 30, trainer: 10, apps: 1 } as const;

export type DemandInput = {
  log: { algo: boolean; lc: number; apps: number; trainer: number };
  week: { lcTopic: string; targets: WeekTargets } | null;
  // Totals for the whole current week, today included.
  weekActual: { lc: number; apps: number; net: number };
  // Days left in the week, today included (1 on Sunday).
  daysLeft: number;
  // Open tasks of the current week.
  tasks: Array<{ id: string; track: Track; title: string; sort: number }>;
};

// Default length of a task by track, in minutes.
const TASK_MINUTES: Record<Track, number> = {
  algo: 45,
  fund: 50,
  proj: 90,
  job: 45,
  prep: 45,
  py: 50,
  misc: 30,
};
const TRACK_ORDER: Track[] = ["job", "fund", "proj", "prep", "py", "algo", "misc"];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const perDay = (target: number, actual: number, daysLeft: number) =>
  Math.ceil(Math.max(0, target - actual) / Math.max(1, daysLeft));

export function buildDemand(input: DemandInput): DemandItem[] {
  const items: DemandItem[] = [];
  const targets = input.week?.targets;
  const algoDone = input.log.algo || input.log.lc > 0;

  const lcToday = targets ? perDay(targets.lc, input.weekActual.lc, input.daysLeft) : 0;
  const algoMinutes = algoDone ? lcToday * 45 : clamp(lcToday * 45, MINIMUM.algoMin, 90);
  if (algoMinutes > 0) {
    items.push({
      key: "algo",
      title: `Алгоритмы${input.week ? `: ${input.week.lcTopic}` : ""}${lcToday ? ` (${lcToday} задач)` : ""}`,
      track: "algo",
      minutes: clamp(algoMinutes, 30, 90),
    });
  }

  if (input.log.trainer < MINIMUM.trainer) {
    items.push({ key: "trainer", title: `Тренажёр: ${MINIMUM.trainer - input.log.trainer} вопросов`, track: "prep", minutes: 25 });
  }

  let apps = targets ? perDay(targets.apps, input.weekActual.apps, input.daysLeft) : 0;
  if (input.log.apps < MINIMUM.apps) apps = Math.max(apps, MINIMUM.apps);
  if (apps > 0) {
    items.push({ key: "apps", title: `Отклики: ${apps} шт.`, track: "job", minutes: clamp(apps * 15, 25, 90) });
  }

  const tasks = [...input.tasks].sort(
    (a, b) => TRACK_ORDER.indexOf(a.track) - TRACK_ORDER.indexOf(b.track) || a.sort - b.sort,
  );
  for (const t of tasks) {
    items.push({ key: `task:${t.id}`, title: t.title, track: t.track, minutes: TASK_MINUTES[t.track], taskId: t.id });
  }

  const net = targets ? perDay(targets.net, input.weekActual.net, input.daysLeft) : 0;
  if (net > 0) items.push({ key: "net", title: `Нетворкинг: ${net} сообщ.`, track: "job", minutes: 25 });

  return items;
}
