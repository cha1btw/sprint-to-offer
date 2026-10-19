import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { aiPlanToBlocks, hm, planDayWithAi, type PlanInput } from "../lib/ai/plan.ts";
import { createDb, type Db } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { aiUsage, dayPlans } from "../lib/db/schema.ts";
import { buildDay, type PlannedBlock } from "../lib/planner/build-day.ts";
import { planDay, setBlockStatus } from "../lib/planner/service.ts";
import { DATE, at, resetDb } from "./db-fixture.ts";
import { fakeClaude } from "./fake-claude.ts";

const input: PlanInput = {
  rules: { wakeMin: 450, sleepMin: 1410, focusBudgetMin: 300, blockMin: 50, breakMin: 10 },
  fixed: [
    { title: "Утро", kind: "routine", startMin: 450, endMin: 480 },
    { title: "Лекция", kind: "study", startMin: 600, endMin: 690 },
  ],
  demand: [
    { key: "algo", title: "Алгоритмы", track: "algo", minutes: 60 },
    { key: "task:t1", title: "CV v1", track: "job", minutes: 45, taskId: "t1" },
  ],
  focusDoneMin: 0,
};

// The rule-based plan written the way Claude answers: a valid answer to start from.
function asClaudeJson(blocks: PlannedBlock[], extra: object[] = []) {
  const items = blocks
    .filter((b) => b.kind !== "fixed")
    .map((b) => ({ start: hm(b.startMin), end: hm(b.endMin), kind: b.kind, demandKey: b.demandKey ?? "", title: b.title }));
  return JSON.stringify({ blocks: [...items, ...extra], comment: "Сначала алгоритмы." });
}

describe("Claude's plan is checked like the planner's", () => {
  test("a valid answer becomes blocks with task ids taken from the demand list", () => {
    const { blocks, problems } = aiPlanToBlocks(asClaudeJson(buildDay(input)), input);
    assert.deepEqual(problems, []);
    const cv = blocks.find((b) => b.demandKey === "task:t1")!;
    assert.equal(cv.taskId, "t1");
    assert.equal(cv.title, "CV v1");
    assert.ok(blocks.some((b) => b.kind === "fixed" && b.title === "Лекция"), "fixed blocks are added by the server");
  });

  test("times after midnight are accepted as 24:xx and as 00:xx", () => {
    const late = { ...input, rules: { ...input.rules, sleepMin: 1470 } };
    for (const end of ["24:30", "00:30"]) {
      const json = JSON.stringify({ blocks: [{ start: "23:30", end, kind: "rest", demandKey: "", title: "" }], comment: "" });
      const { blocks, problems } = aiPlanToBlocks(json, late);
      assert.deepEqual(problems, []);
      assert.equal(blocks.at(-1)!.endMin, 1470);
    }
  });

  test("rejects overlaps, invented tasks, a blown budget, the past and broken JSON", () => {
    const bad = (items: object[], extra: Partial<PlanInput> = {}) =>
      aiPlanToBlocks(JSON.stringify({ blocks: items, comment: "" }), { ...input, ...extra }).problems;
    assert.ok(bad([{ start: "10:30", end: "11:00", kind: "focus", demandKey: "algo", title: "" }]).some((p) => p.includes("пересекается")));
    assert.ok(bad([{ start: "12:00", end: "12:50", kind: "focus", demandKey: "task:nope", title: "" }]).some((p) => p.includes("неизвестный")));
    assert.ok(bad([{ start: "12:00", end: "13:30", kind: "focus", demandKey: "algo", title: "" }], { focusDoneMin: 250 }).some((p) => p.includes("бюджет")));
    assert.ok(bad([{ start: "12:00", end: "12:50", kind: "focus", demandKey: "algo", title: "" }], { fromMin: 800 }).some((p) => p.includes("раньше")));
    assert.ok(bad([{ start: "12:00", end: "14:00", kind: "focus", demandKey: "algo", title: "" }]).some((p) => p.includes("длиннее")));
    assert.deepEqual(aiPlanToBlocks("not json", input).problems, ["ответ не JSON"]);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe("planDayWithAi", { skip: !url && "TEST_DATABASE_URL is not set" }, () => {
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

  // Answers with the rule-based plan for the same request, which is valid by construction.
  const validAnswer = () => {
    const blocks: PlannedBlock[] = [
      { startMin: 480, endMin: 530, kind: "focus", title: "", track: null, taskId: null, demandKey: "algo" },
      { startMin: 530, endMin: 540, kind: "break", title: "Перерыв", track: null, taskId: null, demandKey: null },
      { startMin: 540, endMin: 585, kind: "focus", title: "", track: null, taskId: null, demandKey: "task:t1" },
      { startMin: 1335, endMin: 1350, kind: "review", title: "", track: null, taskId: null, demandKey: "review" },
    ];
    return asClaudeJson(blocks);
  };

  test("saves Claude's plan with source ai and records the tokens", async () => {
    const claude = fakeClaude(validAnswer());
    const result = await planDayWithAi(db, claude, DATE, { now: at(420) });
    assert.deepEqual(result.problems, []);
    assert.equal(result.source, "ai");
    assert.equal(claude.calls[0].model, "claude-sonnet-5-5");
    assert.ok(claude.calls[0].schema, "asks for structured JSON");
    assert.match(String(claude.calls[0].messages[0].content), /task:t1/);
    const [plan] = await db.select().from(dayPlans).where(eq(dayPlans.date, DATE));
    assert.equal(plan.source, "ai");
    assert.equal(plan.aiComment, "Сначала алгоритмы.");
    assert.ok(result.blocks.some((b) => b.taskId === "t1" && b.startMin === 540));
    assert.equal((await db.select().from(aiUsage)).length, 1);
  });

  test("falls back to the planner when the plan breaks a rule or the call fails", async () => {
    const overlap = JSON.stringify({ blocks: [{ start: "10:00", end: "10:50", kind: "focus", demandKey: "algo", title: "" }], comment: "" });
    for (const answer of [overlap, new Error("network down")]) {
      const result = await planDayWithAi(db, fakeClaude(answer), DATE, { now: at(420) });
      assert.equal(result.source, "auto");
      assert.ok(result.problems.length > 0);
      assert.ok(result.blocks.some((b) => b.demandKey === "algo"), "the planner's day is saved");
      const [plan] = await db.select().from(dayPlans).where(eq(dayPlans.date, DATE));
      assert.equal(plan.source, "auto");
    }
  });

  test("without a key or over the cap, Claude is not called and the planner builds the day", async () => {
    assert.equal((await planDayWithAi(db, null, DATE, { now: at(420) })).source, "auto");
    process.env.AI_MONTHLY_TOKEN_CAP = "0";
    const claude = fakeClaude(validAnswer());
    const result = await planDayWithAi(db, claude, DATE, { now: at(420) });
    assert.deepEqual([result.source, result.problems], ["auto", ["cap"]]);
    assert.equal(claude.calls.length, 0);
  });

  test("a replan with Claude keeps the block in progress", async () => {
    const first = await planDay(db, DATE, { now: at(420) });
    const algo = first.find((b) => b.demandKey === "algo")!;
    await setBlockStatus(db, algo.id, "doing", at(algo.startMin));
    const now = at(algo.startMin + 20);
    const claude = fakeClaude(
      JSON.stringify({ blocks: [{ start: hm(algo.endMin), end: hm(algo.endMin + 45), kind: "focus", demandKey: "task:t1", title: "" }], comment: "" }),
    );
    const result = await planDayWithAi(db, claude, DATE, { now });
    assert.deepEqual(result.problems, []);
    assert.ok(result.blocks.some((b) => b.id === algo.id && b.status === "doing"));
    assert.doesNotMatch(String(claude.calls[0].messages[0].content), /"key": "algo"/, "algorithms are not asked for again");
  });
});
