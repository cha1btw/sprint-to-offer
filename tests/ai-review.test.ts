import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { planDayWithAi } from "../lib/ai/plan.ts";
import { eveningReview, goalsFor, reviewText } from "../lib/ai/review.ts";
import { createDb, type Db } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { getBlocks, getDayPlan, planDay, setBlockStatus } from "../lib/planner/service.ts";
import { runTick } from "../lib/planner/tick.ts";
import { DATE, at, resetDb } from "./db-fixture.ts";
import { fakeClaude } from "./fake-claude.ts";

const url = process.env.TEST_DATABASE_URL;
const REVIEW = JSON.stringify({
  summary: "Алгоритмы сделаны, CV пропущено <из-за лекции>.",
  goals: ["Дописать CV v1", "Решить 2 задачи Arrays", "Отправить 1 отклик", "лишняя цель"],
});

describe("evening review", { skip: !url && "TEST_DATABASE_URL is not set" }, () => {
  let db: Db;
  before(async () => {
    await runMigrations(url!);
    db = createDb(url!, 3);
  });
  after(async () => {
    await db.$client.end();
  });
  beforeEach(async () => {
    await resetDb(db);
    process.env.AI_MONTHLY_TOKEN_CAP = "";
  });

  test("sums up done and skipped blocks and keeps three goals", async () => {
    const blocks = await planDay(db, DATE, { now: at(420) });
    const algo = blocks.find((b) => b.demandKey === "algo")!;
    const cv = blocks.find((b) => b.taskId === "t1")!;
    await setBlockStatus(db, algo.id, "done", at(algo.endMin));
    await setBlockStatus(db, cv.id, "skipped", at(cv.startMin));
    const claude = fakeClaude(REVIEW);
    const review = await eveningReview(db, claude, DATE, at(1340));
    const prompt = String(claude.calls[0].messages[0].content);
    assert.match(prompt, /Алгоритмы.*сделан/);
    assert.match(prompt, /CV v1: пропущен/);
    assert.equal(review.goals.length, 3);
    assert.deepEqual((await getDayPlan(db, DATE))!.review!.goals, review.goals);
    assert.match(reviewText(review), /&lt;из-за лекции&gt;/, "Telegram HTML is escaped");
  });

  test("the tick sends the review once when the review block starts", async () => {
    const sent: string[] = [];
    const send = async (text: string) => {
      sent.push(text);
      return true;
    };
    await planDay(db, DATE, { now: at(420) });
    const review = (await getBlocks(db, DATE)).find((b) => b.kind === "review")!;
    const claude = fakeClaude(REVIEW);
    const r1 = await runTick(db, send, at(review.startMin + 1), claude);
    assert.equal(r1.reviewed, true);
    assert.match(sent.at(-1)!, /Цели на завтра/);
    const r2 = await runTick(db, send, at(review.startMin + 4), claude);
    assert.equal(r2.reviewed, false);
    assert.equal(claude.calls.length, 1);
  });

  test("tomorrow's plan with Claude starts from the review's goals", async () => {
    await planDay(db, DATE, { now: at(420) });
    await eveningReview(db, fakeClaude(REVIEW), DATE, at(1340));
    const tomorrow = "2026-10-21";
    assert.equal((await goalsFor(db, tomorrow)).length, 3);
    const claude = fakeClaude(JSON.stringify({ blocks: [], comment: "" }));
    await planDayWithAi(db, claude, tomorrow, { now: at(420, tomorrow) });
    assert.match(String(claude.calls[0].messages[0].content), /Дописать CV v1/);
  });
});
