import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { AiUnavailableError, aiStatus, callClaude, monthStart, monthTokens, monthlyCap, recordUsage } from "../lib/ai/budget.ts";
import { createDb, type Db } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { aiUsage } from "../lib/db/schema.ts";
import { at, resetDb } from "./db-fixture.ts";
import { fakeClaude } from "./fake-claude.ts";

describe("monthly cap", () => {
  test("reads the cap from the environment value", () => {
    assert.equal(monthlyCap(undefined), 2_000_000);
    assert.equal(monthlyCap(""), 2_000_000);
    assert.equal(monthlyCap("500000"), 500_000);
    assert.equal(monthlyCap("0"), 0, "0 turns AI off");
    assert.equal(monthlyCap("lots"), 2_000_000);
  });

  test("the month starts at Kyiv midnight on the 1st", () => {
    // 1 Nov 2026 00:30 in Kyiv is still 31 Oct in UTC.
    assert.equal(monthStart(new Date("2026-10-31T22:30:00Z")).toISOString(), "2026-10-31T22:00:00.000Z");
    assert.equal(monthStart(new Date("2026-10-20T12:00:00Z")).toISOString(), "2026-09-30T21:00:00.000Z");
  });
});

const url = process.env.TEST_DATABASE_URL;

describe("budget guard", { skip: !url && "TEST_DATABASE_URL is not set" }, () => {
  let db: Db;
  const savedCap = process.env.AI_MONTHLY_TOKEN_CAP;

  before(async () => {
    await runMigrations(url!);
    db = createDb(url!, 3);
  });
  after(async () => {
    process.env.AI_MONTHLY_TOKEN_CAP = savedCap;
    await db.$client.end();
  });
  beforeEach(async () => {
    await resetDb(db);
    process.env.AI_MONTHLY_TOKEN_CAP = "1000";
  });

  test("without a key AI is off and nothing is called", async () => {
    const status = await aiStatus(db, null);
    assert.equal(status.enabled, false);
    assert.equal(status.reason, "no_key");
    await assert.rejects(callClaude(db, null, "coach", { system: "", messages: [], maxTokens: 10, effort: "low" }), AiUnavailableError);
  });

  test("records tokens per call and stops at the monthly cap", async () => {
    const claude = fakeClaude({ text: "ok", inputTokens: 600, outputTokens: 300 });
    const request = { system: "s", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100, effort: "low" as const };
    assert.equal(await callClaude(db, claude, "coach", request, at(600)), "ok");
    const [row] = await db.select().from(aiUsage);
    assert.equal(row.feature, "coach");
    assert.equal(row.model, "claude-sonnet-5-5");
    assert.equal(row.inputTokens + row.outputTokens, 900);

    assert.equal((await aiStatus(db, claude, at(601))).enabled, true, "900 of 1000 used");
    await callClaude(db, claude, "coach", request, at(602));
    const status = await aiStatus(db, claude, at(603));
    assert.deepEqual([status.enabled, status.reason, status.used], [false, "cap", 1800]);
    await assert.rejects(callClaude(db, claude, "coach", request, at(604)), (e: AiUnavailableError) => e.reason === "cap");
    assert.equal(claude.calls.length, 2, "no call after the cap");
  });

  test("last month's usage does not count", async () => {
    await recordUsage(db, "plan", "m", { inputTokens: 5000, outputTokens: 0 }, new Date("2026-09-15T10:00:00Z"));
    assert.equal(await monthTokens(db, at(600)), 0);
  });

  test("a refusal is recorded and reported as unavailable", async () => {
    const claude = fakeClaude({ text: "", stopReason: "refusal" });
    await assert.rejects(
      callClaude(db, claude, "first_step", { system: "", messages: [{ role: "user", content: "x" }], maxTokens: 10, effort: "low" }, at(600)),
      (e: AiUnavailableError) => e.reason === "refusal",
    );
    assert.equal((await db.select().from(aiUsage)).length, 1);
  });
});
