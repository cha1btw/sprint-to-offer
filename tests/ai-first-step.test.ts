import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { InlineKeyboard } from "grammy";
import { firstStep } from "../lib/ai/first-step.ts";
import { createDb, type Db } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { aiUsage } from "../lib/db/schema.ts";
import { getBlocks, planDay } from "../lib/planner/service.ts";
import { runTick } from "../lib/planner/tick.ts";
import { DATE, at, resetDb } from "./db-fixture.ts";
import { fakeClaude } from "./fake-claude.ts";

const url = process.env.TEST_DATABASE_URL;
const buttons = (kb?: InlineKeyboard) => (kb?.inline_keyboard ?? []).flat().map((b) => ("callback_data" in b ? b.callback_data : ""));

describe("first step", { skip: !url && "TEST_DATABASE_URL is not set" }, () => {
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

  test("asks Haiku about the block and records the call", async () => {
    const blocks = await planDay(db, DATE, { now: at(420) });
    const algo = blocks.find((b) => b.demandKey === "algo")!;
    const claude = fakeClaude("Открой LeetCode 1. Two Sum и прочитай условие вслух.");
    const text = await firstStep(db, claude, algo.id, at(algo.startMin + 10));
    assert.match(text, /Two Sum/);
    assert.equal(claude.calls[0].model, "claude-haiku-5-5");
    assert.match(String(claude.calls[0].messages[0].content), /Arrays/, "the week's LeetCode topic is in the context");
    const [row] = await db.select().from(aiUsage);
    assert.equal(row.feature, "first_step");
  });

  test("the drift reminder offers the button only when Claude is available", async () => {
    const sent: Array<InlineKeyboard | undefined> = [];
    const send = async (_text: string, kb?: InlineKeyboard) => {
      sent.push(kb);
      return true;
    };
    await planDay(db, DATE, { now: at(420) });
    const algo = (await getBlocks(db, DATE)).find((b) => b.demandKey === "algo")!;

    await runTick(db, send, at(algo.startMin + 12), fakeClaude("x"));
    assert.ok(buttons(sent.at(-1)).includes(`stuck:${algo.id}`));

    await resetDb(db);
    await planDay(db, DATE, { now: at(420) });
    const again = (await getBlocks(db, DATE)).find((b) => b.demandKey === "algo")!;
    await runTick(db, send, at(again.startMin + 12), null);
    assert.ok(!buttons(sent.at(-1)).some((d) => d.startsWith("stuck:")), "no Claude button without a key");
  });
});
