import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LONG_BREAK,
  MAX_BLOCK,
  buildDay,
  freeWindows,
  validatePlan,
  type DayRules,
  type DemandItem,
  type FixedInput,
} from "../lib/planner/build-day.ts";
import { buildDemand } from "../lib/planner/demand.ts";

const rules: DayRules = { wakeMin: 7 * 60 + 30, sleepMin: 23 * 60 + 30, focusBudgetMin: 360, blockMin: 50, breakMin: 10 };
const fixed: FixedInput[] = [
  { title: "Утро: подъём, завтрак", kind: "routine", startMin: 450, endMin: 480 },
  { title: "Лекция КНУ", kind: "study", startMin: 600, endMin: 690 },
  { title: "Обед", kind: "meal", startMin: 810, endMin: 855 },
  { title: "Ужин", kind: "meal", startMin: 1140, endMin: 1185 },
];
const demand: DemandItem[] = [
  { key: "algo", title: "Алгоритмы", track: "algo", minutes: 60 },
  { key: "trainer", title: "Тренажёр", track: "prep", minutes: 25 },
  { key: "apps", title: "Отклики", track: "job", minutes: 30 },
  { key: "task:a", title: "Задача A", track: "fund", minutes: 50, taskId: "a" },
  { key: "task:b", title: "Задача B", track: "proj", minutes: 90, taskId: "b" },
  { key: "task:c", title: "Задача C", track: "fund", minutes: 50, taskId: "c" },
];
const focusOf = (blocks: ReturnType<typeof buildDay>) =>
  blocks.filter((b) => b.kind === "focus").reduce((s, b) => s + b.endMin - b.startMin, 0);

describe("freeWindows", () => {
  test("returns the gaps between busy blocks", () => {
    const w = freeWindows(0, 100, [
      { startMin: 10, endMin: 20, resets: true },
      { startMin: 15, endMin: 30, resets: true },
      { startMin: 50, endMin: 60, resets: true },
    ]);
    assert.deepEqual(w, [[0, 10], [30, 50], [60, 100]]);
  });
});

describe("buildDay", () => {
  const plan = buildDay({ rules, fixed, demand });

  test("passes every hard rule", () => {
    assert.deepEqual(validatePlan(plan, rules, fixed), []);
  });

  test("keeps fixed blocks exactly where they are", () => {
    for (const f of fixed) {
      assert.ok(plan.some((b) => b.kind === "fixed" && b.startMin === f.startMin && b.endMin === f.endMin), f.title);
    }
  });

  test("starts with algorithms, the boring part first", () => {
    const first = plan.find((b) => b.kind === "focus");
    assert.equal(first?.demandKey, "algo");
    assert.equal(first?.startMin, 480);
  });

  test("puts a break between two focus blocks in a row", () => {
    for (let i = 1; i < plan.length; i++) {
      assert.ok(!(plan[i - 1].kind === "focus" && plan[i].kind === "focus"), "two focus blocks touch");
    }
  });

  test("no focus block is longer than the setting plus a short tail, or the hard cap", () => {
    for (const b of plan.filter((x) => x.kind === "focus")) {
      assert.ok(b.endMin - b.startMin <= Math.min(rules.blockMin + 15, MAX_BLOCK));
    }
  });

  test("does not leave a tiny leftover block", () => {
    for (const b of plan.filter((x) => x.kind === "focus")) assert.ok(b.endMin - b.startMin >= 15);
  });

  test("schedules the evening review one hour before sleep", () => {
    const review = plan.find((b) => b.kind === "review");
    assert.deepEqual([review?.startMin, review?.endMin], [rules.sleepMin - 75, rules.sleepMin - 60]);
  });

  test("leftover time becomes planned rest that ends at sleep", () => {
    const last = plan[plan.length - 1];
    assert.equal(last.kind, "rest");
    assert.equal(last.endMin, rules.sleepMin);
  });

  test("splits a long task into several blocks", () => {
    const b = plan.filter((x) => x.demandKey === "task:b");
    assert.equal(b.reduce((s, x) => s + x.endMin - x.startMin, 0), 90);
    assert.ok(b.length >= 2);
  });

  test("never exceeds the focus budget", () => {
    const small = buildDay({ rules: { ...rules, focusBudgetMin: 100 }, fixed, demand });
    assert.ok(focusOf(small) <= 100);
    assert.deepEqual(validatePlan(small, { ...rules, focusBudgetMin: 100 }, fixed), []);
  });

  test("counts focus already done today against the budget", () => {
    const later = buildDay({ rules, fixed, demand, focusDoneMin: 300 });
    assert.ok(focusOf(later) <= 60);
  });

  test("inserts a long break after about 100 minutes of focus", () => {
    const long = buildDay({
      rules: { ...rules, sleepMin: 23 * 60 + 30 },
      fixed: [],
      demand: [{ key: "x", title: "Долгая задача", track: "proj", minutes: 300 }],
    });
    assert.ok(long.some((b) => b.kind === "break" && b.endMin - b.startMin === LONG_BREAK));
  });

  test("a long day around a lecture still passes every rule", () => {
    const streakFixed: FixedInput[] = [{ title: "Лекция", kind: "study", startMin: 540, endMin: 600 }];
    const plan2 = buildDay({ rules, fixed: streakFixed, demand: [{ key: "x", title: "X", track: "fund", minutes: 400 }] });
    assert.deepEqual(validatePlan(plan2, rules, streakFixed), []);
  });

  test("does not split a task into a scrap shorter than a block", () => {
    // 30 free minutes before the evening review, then the rest of the evening.
    const evening = buildDay({
      rules,
      fixed: [],
      demand: [{ key: "algo", title: "Алгоритмы", track: "algo", minutes: 45 }],
      fromMin: rules.sleepMin - 105,
    });
    const algo = evening.filter((b) => b.demandKey === "algo");
    assert.equal(algo.length, 1);
    assert.equal(algo[0].endMin - algo[0].startMin, 30);
  });

  test("replanning lays out only the time after now", () => {
    const now = 14 * 60 + 2;
    const replan = buildDay({ rules, fixed, demand, fromMin: now });
    for (const b of replan.filter((x) => x.kind !== "fixed")) assert.ok(b.startMin >= 14 * 60 + 5);
  });

  test("a day with no time left returns only fixed blocks and no focus", () => {
    const late = buildDay({ rules, fixed, demand, fromMin: rules.sleepMin - 10 });
    assert.equal(focusOf(late), 0);
  });

  test("validatePlan catches overlaps, a moved fixed block and an over-budget plan", () => {
    const bad = [
      { startMin: 480, endMin: 560, kind: "focus" as const, title: "A", track: null, taskId: null, demandKey: null },
      { startMin: 550, endMin: 600, kind: "focus" as const, title: "B", track: null, taskId: null, demandKey: null },
    ];
    const problems = validatePlan(bad, { ...rules, focusBudgetMin: 60 }, fixed);
    assert.ok(problems.some((p) => p.includes("пересекается")));
    assert.ok(problems.some((p) => p.includes("бюджета")));
    assert.ok(problems.some((p) => p.includes("сдвинут")));
  });
});

describe("buildDemand", () => {
  const week = { lcTopic: "Arrays & Hashing", targets: { hours: 40, lc: 6, apps: 8, net: 0, mock: 0 } };

  test("an empty day asks for the minimum first, in order", () => {
    const d = buildDemand({
      log: { algo: false, lc: 0, apps: 0, trainer: 0 },
      week,
      weekActual: { lc: 0, apps: 0, net: 0 },
      daysLeft: 7,
      tasks: [{ id: "t1", track: "fund", title: "JS core", sort: 1 }, { id: "t2", track: "job", title: "CV", sort: 2 }],
    });
    assert.deepEqual(d.map((x) => x.key), ["algo", "trainer", "apps", "task:t2", "task:t1"]);
  });

  test("a closed minimum day leaves only what the weekly targets still need", () => {
    const d = buildDemand({
      log: { algo: true, lc: 1, apps: 2, trainer: 10 },
      week,
      weekActual: { lc: 6, apps: 8, net: 0 },
      daysLeft: 3,
      tasks: [],
    });
    assert.deepEqual(d, []);
  });

  test("falling behind raises the daily share", () => {
    const d = buildDemand({
      log: { algo: false, lc: 0, apps: 0, trainer: 0 },
      week,
      weekActual: { lc: 0, apps: 0, net: 0 },
      daysLeft: 2,
      tasks: [],
    });
    assert.match(d.find((x) => x.key === "apps")!.title, /4 шт/);
    assert.match(d.find((x) => x.key === "algo")!.title, /3 задачи$/);
    assert.equal(d.find((x) => x.key === "algo")!.minutes, 90);
  });
});
