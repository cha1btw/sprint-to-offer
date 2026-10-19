// Shared database setup for tests that need TEST_DATABASE_URL: one week, two
// tasks, a morning routine and a Tuesday lecture.
import { sql } from "drizzle-orm";
import type { Db } from "../lib/db/index.ts";
import { fixedBlocks, settings, tasks, weeks } from "../lib/db/schema.ts";
import { minuteToUtc } from "../lib/time.ts";

export const DATE = "2026-10-20"; // a Tuesday in week 1
export const at = (min: number, date = DATE) => minuteToUtc(date, min);

export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate plan_blocks, day_plans, day_logs, tasks, weeks, fixed_blocks, settings, login_tokens, ai_usage, chat_messages`,
  );
  await db.insert(settings).values({ id: 1, startDate: "2026-10-19", deadline: "2027-02-28", wakeMin: 450, sleepMin: 1410 });
  await db.insert(weeks).values({
    n: 1, startDate: "2026-10-19", endDate: "2026-10-25", phase: 0, phaseName: "Старт", theme: "Старт",
    lcTopic: "Arrays", light: false, targets: { hours: 40, lc: 3, apps: 5, net: 0, mock: 0 },
  });
  await db.insert(tasks).values([
    { id: "t1", week: 1, track: "job", title: "CV v1", sort: 1 },
    { id: "t2", week: 1, track: "fund", title: "Auth-flow", sort: 2 },
  ]);
  await db.insert(fixedBlocks).values([
    { title: "Утро", kind: "routine", weekdays: [1, 2, 3, 4, 5, 6, 7], startMin: 450, endMin: 480 },
    { title: "Лекция КНУ", kind: "study", weekdays: [2], startMin: 600, endMin: 690 },
  ]);
}
