import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// One row (id = 1): the owner's daily rhythm. Times are minutes since Kyiv
// midnight; sleep may pass 24:00 (00:30 is 1470).
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    startDate: date("start_date", { mode: "string" }).notNull(),
    deadline: date("deadline", { mode: "string" }).notNull(),
    wakeMin: integer("wake_min").notNull().default(450),
    sleepMin: integer("sleep_min").notNull().default(1410),
    focusBudgetMin: integer("focus_budget_min").notNull().default(360),
    blockMin: integer("block_min").notNull().default(50),
    breakMin: integer("break_min").notNull().default(10),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("settings_single_row", sql`${t.id} = 1`),
    check("settings_day_order", sql`${t.wakeMin} < ${t.sleepMin}`),
  ],
);

export const FIXED_KINDS = ["routine", "meal", "study", "sport", "other"] as const;
export type FixedKind = (typeof FIXED_KINDS)[number];

// Blocks that repeat on given weekdays: KNU lectures, meals, sport.
// weekdays holds ISO numbers, 1 = Monday ... 7 = Sunday.
export const fixedBlocks = pgTable(
  "fixed_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    kind: text("kind", { enum: FIXED_KINDS }).notNull().default("other"),
    weekdays: integer("weekdays").array().notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("fixed_blocks_order", sql`${t.startMin} < ${t.endMin}`)],
);

export type WeekTargets = { hours: number; lc: number; apps: number; net: number; mock: number };

export const weeks = pgTable("weeks", {
  n: integer("n").primaryKey(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  phase: integer("phase").notNull(),
  phaseName: text("phase_name").notNull(),
  theme: text("theme").notNull(),
  lcTopic: text("lc_topic").notNull(),
  light: boolean("light").notNull().default(false),
  milestone: text("milestone"),
  targets: jsonb("targets").$type<WeekTargets>().notNull(),
});

export const TRACKS = ["fund", "algo", "proj", "job", "prep", "py", "misc"] as const;
export type Track = (typeof TRACKS)[number];

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    week: integer("week")
      .notNull()
      .references(() => weeks.n),
    track: text("track", { enum: TRACKS }).notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    doneAt: date("done_at", { mode: "string" }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("tasks_week_idx").on(t.week)],
);

export const dayPlans = pgTable("day_plans", {
  date: date("date", { mode: "string" }).primaryKey(),
  source: text("source", { enum: ["auto", "ai"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  replannedAt: timestamp("replanned_at", { withTimezone: true }),
  // Claude's one-line reason for the plan; empty when the planner built it.
  aiComment: text("ai_comment"),
});

export const BLOCK_KINDS = ["fixed", "focus", "break", "rest", "review"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_STATUSES = ["planned", "doing", "done", "skipped"] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export const planBlocks = pgTable(
  "plan_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => dayPlans.date, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    kind: text("kind", { enum: BLOCK_KINDS }).notNull(),
    title: text("title").notNull(),
    track: text("track", { enum: TRACKS }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    demandKey: text("demand_key"),
    status: text("status", { enum: BLOCK_STATUSES }).notNull().default("planned"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    driftNotifiedAt: timestamp("drift_notified_at", { withTimezone: true }),
  },
  (t) => [
    check("plan_blocks_order", sql`${t.startMin} < ${t.endMin}`),
    index("plan_blocks_date_idx").on(t.date),
    index("plan_blocks_start_at_idx").on(t.startAt),
  ],
);

// Counters for one Kyiv day. algo marks "30 minutes of algorithms" done by hand.
export const dayLogs = pgTable("day_logs", {
  date: date("date", { mode: "string" }).primaryKey(),
  focusMin: integer("focus_min").notNull().default(0),
  lc: integer("lc").notNull().default(0),
  apps: integer("apps").notNull().default(0),
  net: integer("net").notNull().default(0),
  mock: integer("mock").notNull().default(0),
  trainer: integer("trainer").notNull().default(0),
  algo: boolean("algo").notNull().default(false),
  note: text("note").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One-time login links sent by the bot. Only a SHA-256 hash of the token is stored.
export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const AI_FEATURES = ["plan", "first_step", "review", "coach"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

// One row per Claude call: what it was for and how many tokens it used.
// The monthly cap (AI_MONTHLY_TOKEN_CAP) is checked against these sums.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    feature: text("feature", { enum: AI_FEATURES }).notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
  },
  (t) => [index("ai_usage_created_at_idx").on(t.createdAt)],
);
