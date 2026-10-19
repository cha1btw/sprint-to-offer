import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { consumeLoginToken, createLoginToken } from "../lib/auth.ts";
import { createDb, type Db } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { dayLogs, fixedBlocks, planBlocks, settings, tasks, weeks } from "../lib/db/schema.ts";
import { getBlocks, getDayLog, planDay, setBlockStatus } from "../lib/planner/service.ts";
import { runTick } from "../lib/planner/tick.ts";
import { minuteToUtc } from "../lib/time.ts";

const url = process.env.TEST_DATABASE_URL;
const DATE = "2026-10-20"; // a Tuesday in week 1
const at = (min: number) => minuteToUtc(DATE, min);

describe("planner service", { skip: !url && "TEST_DATABASE_URL is not set" }, () => {
  let db: Db;

  before(async () => {
    await runMigrations(url!);
    db = createDb(url!, 3);
  });
  after(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate plan_blocks, day_plans, day_logs, tasks, weeks, fixed_blocks, settings, login_tokens`);
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
  });

  test("builds a day with fixed blocks, the minimum first and tasks", async () => {
    const blocks = await planDay(db, DATE, { now: at(420) });
    assert.ok(blocks.some((b) => b.title === "Лекция КНУ" && b.startMin === 600));
    const focus = blocks.filter((b) => b.kind === "focus");
    assert.equal(focus[0].demandKey, "algo");
    assert.ok(focus.some((b) => b.taskId === "t1"));
    assert.equal(blocks[0].startAt.toISOString(), at(450).toISOString());
  });

  test("building today in the evening plans from now, not from wake-up", async () => {
    const blocks = await planDay(db, DATE, { now: at(18 * 60 + 2) });
    const focus = blocks.filter((b) => b.kind === "focus");
    assert.ok(focus.length > 0);
    assert.ok(focus.every((b) => b.startMin >= 18 * 60 + 5));
    assert.equal(focus[0].demandKey, "algo");
  });

  test("replanning keeps finished and running blocks and plans the rest after now", async () => {
    const first = await planDay(db, DATE, { now: at(420) });
    const algo = first.find((b) => b.demandKey === "algo")!;
    await setBlockStatus(db, algo.id, "doing", at(algo.startMin));
    const replanned = await planDay(db, DATE, { now: at(algo.startMin + 20), replan: true, fromMin: algo.startMin + 20 });
    assert.ok(replanned.some((b) => b.id === algo.id && b.status === "doing"), "running block kept");
    assert.equal(replanned.filter((b) => b.demandKey === "algo").length, 1, "algorithms not planned twice");
    const overlaps = replanned.some((b, i) => i > 0 && replanned[i - 1].endMin > b.startMin);
    assert.equal(overlaps, false);
    assert.ok(replanned.some((b) => b.title === "Лекция КНУ"), "fixed block kept");
  });

  test("finishing a focus block adds the real minutes and marks algorithms done", async () => {
    const blocks = await planDay(db, DATE, { now: at(420) });
    const algo = blocks.find((b) => b.demandKey === "algo")!;
    await setBlockStatus(db, algo.id, "doing", at(algo.startMin));
    await setBlockStatus(db, algo.id, "done", at(algo.startMin + 35));
    const log = await getDayLog(db, DATE);
    assert.equal(log.focusMin, 35);
    assert.equal(log.algo, true);
  });

  test("the tick builds the day in the morning, announces each block once and nudges a stalled block", async () => {
    const sent: string[] = [];
    const send = async (text: string) => {
      sent.push(text);
      return true;
    };
    const morning = await runTick(db, send, at(452));
    assert.equal(morning.planned, true);
    assert.match(sent[0], /Доброе утро/);

    const blocks = await getBlocks(db, DATE);
    const algo = blocks.find((b) => b.demandKey === "algo")!;
    const r1 = await runTick(db, send, at(algo.startMin + 1));
    const r2 = await runTick(db, send, at(algo.startMin + 3));
    assert.equal(r1.announced, 1);
    assert.equal(r2.announced, 0, "no second message for the same block");

    const r3 = await runTick(db, send, at(algo.startMin + 12));
    assert.equal(r3.nudged, 1);
    const r4 = await runTick(db, send, at(algo.startMin + 17));
    assert.equal(r4.nudged, 0, "the nudge is sent once");

    await db.update(planBlocks).set({ status: "doing", startedAt: at(algo.startMin) }).where(eq(planBlocks.id, algo.id));
    const [row] = await db.select().from(dayLogs).where(eq(dayLogs.date, DATE));
    assert.equal(row, undefined, "the tick itself does not touch the day log");
  });

  test("a login link works once and expires", async () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const token = await createLoginToken(db, now);
    assert.equal(await consumeLoginToken(db, token, now), true);
    assert.equal(await consumeLoginToken(db, token, now), false);
    const late = await createLoginToken(db, now);
    assert.equal(await consumeLoginToken(db, late, new Date(now.getTime() + 11 * 60_000)), false);
    assert.equal(await consumeLoginToken(db, "wrong", now), false);
  });
});
