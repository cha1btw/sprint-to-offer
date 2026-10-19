import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { askCoach, recentMessages } from "../lib/ai/coach.ts";
import { createDb, type Db } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { aiUsage, chatMessages } from "../lib/db/schema.ts";
import { planDay, saveNote } from "../lib/planner/service.ts";
import { DATE, at, resetDb } from "./db-fixture.ts";
import { fakeClaude } from "./fake-claude.ts";

const url = process.env.TEST_DATABASE_URL;

describe("coach chat", { skip: !url && "TEST_DATABASE_URL is not set" }, () => {
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

  test("answers with today's plan, the week and the last note in the context", async () => {
    await planDay(db, DATE, { now: at(420) });
    await saveNote(db, "2026-10-19", "Вчера залип в ютуб после обеда");
    const claude = fakeClaude("Начни с алгоритмов, CV после лекции.");
    const answer = await askCoach(db, claude, "  С чего начать?  ", "telegram", at(470));
    assert.equal(answer, "Начни с алгоритмов, CV после лекции.");
    const request = claude.calls[0];
    assert.equal(request.model, "claude-sonnet-5-5");
    assert.match(request.system, /Лекция КНУ/);
    assert.match(request.system, /Неделя 1/);
    assert.match(request.system, /залип в ютуб/);
    assert.deepEqual(request.messages, [{ role: "user", content: "С чего начать?" }]);
    const saved = await recentMessages(db);
    assert.deepEqual(saved.map((m) => [m.role, m.channel]), [["user", "telegram"], ["assistant", "telegram"]]);
    assert.equal((await db.select().from(aiUsage))[0].feature, "coach");
  });

  test("sends the recent history, starting with a user message, across web and Telegram", async () => {
    await db.insert(chatMessages).values([
      { role: "assistant", channel: "web", content: "orphan answer", createdAt: at(400) },
      { role: "user", channel: "web", content: "Первый вопрос", createdAt: at(401) },
      { role: "assistant", channel: "web", content: "Первый ответ", createdAt: at(402) },
    ]);
    const claude = fakeClaude("ok");
    await askCoach(db, claude, "Второй вопрос", "telegram", at(500));
    assert.deepEqual(
      claude.calls[0].messages.map((m) => m.content),
      ["Первый вопрос", "Первый ответ", "Второй вопрос"],
    );
  });

  test("a failed call keeps the question and saves no answer", async () => {
    await assert.rejects(askCoach(db, fakeClaude(new Error("timeout")), "Привет", "web", at(500)));
    const saved = await recentMessages(db);
    assert.deepEqual(saved.map((m) => m.role), ["user"]);
  });
});
