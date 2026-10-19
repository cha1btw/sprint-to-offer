// Usage: python3 artifact/scripts/seeds.py && npm run db:seed
// Loads the 19 weeks and their tasks, creates the settings row and a starter
// daily routine. Safe to run again: existing rows (and ticked tasks) are kept.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../lib/db/index.ts";
import { fixedBlocks, settings, tasks, weeks, type Track, type WeekTargets } from "../lib/db/schema.ts";

type Seed = {
  settings: { main: { start: string; deadline: string } };
  weeks: Record<string, { n: number; start: string; end: string; phase: number; phaseName: string; theme: string; lcTopic: string; light: boolean; milestone?: string; targets: WeekTargets }>;
  tasks: Record<string, { week: number; track: Track; title: string; done: boolean; order: number }>;
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}
const path = new URL("../artifact/seed/all.json", import.meta.url);
let seed: Seed;
try {
  seed = JSON.parse(readFileSync(path, "utf8"));
} catch {
  console.error("artifact/seed/all.json is missing: run python3 artifact/scripts/seeds.py first.");
  process.exit(1);
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const db = createDb(url);
try {
  await db
    .insert(settings)
    .values({ id: 1, startDate: seed.settings.main.start, deadline: seed.settings.main.deadline })
    .onConflictDoNothing();

  await db
    .insert(weeks)
    .values(
      Object.values(seed.weeks).map((w) => ({
        n: w.n,
        startDate: w.start,
        endDate: w.end,
        phase: w.phase,
        phaseName: w.phaseName,
        theme: w.theme,
        lcTopic: w.lcTopic,
        light: w.light,
        milestone: w.milestone ?? null,
        targets: w.targets,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(tasks)
    .values(Object.entries(seed.tasks).map(([id, t]) => ({ id, week: t.week, track: t.track, title: t.title, done: t.done, sort: t.order })))
    .onConflictDoNothing();

  // A starter routine, only into an empty table; edit it on the Settings page.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(fixedBlocks);
  if (count === 0) {
    await db.insert(fixedBlocks).values([
      { title: "Утро: подъём, душ, завтрак", kind: "routine", weekdays: EVERY_DAY, startMin: 7 * 60 + 30, endMin: 8 * 60 },
      { title: "Обед", kind: "meal", weekdays: EVERY_DAY, startMin: 13 * 60 + 30, endMin: 14 * 60 + 15 },
      { title: "Ужин", kind: "meal", weekdays: EVERY_DAY, startMin: 19 * 60, endMin: 19 * 60 + 45 },
    ]);
  }
  console.log(`Seed loaded: ${Object.keys(seed.weeks).length} weeks, ${Object.keys(seed.tasks).length} tasks.`);
} finally {
  await db.$client.end();
}
