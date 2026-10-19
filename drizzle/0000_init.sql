CREATE TABLE "day_logs" (
	"date" date PRIMARY KEY NOT NULL,
	"focus_min" integer DEFAULT 0 NOT NULL,
	"lc" integer DEFAULT 0 NOT NULL,
	"apps" integer DEFAULT 0 NOT NULL,
	"net" integer DEFAULT 0 NOT NULL,
	"mock" integer DEFAULT 0 NOT NULL,
	"trainer" integer DEFAULT 0 NOT NULL,
	"algo" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_plans" (
	"date" date PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replanned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fixed_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_blocks_order" CHECK ("fixed_blocks"."start_min" < "fixed_blocks"."end_min")
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"track" text,
	"task_id" text,
	"demand_key" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"drift_notified_at" timestamp with time zone,
	CONSTRAINT "plan_blocks_order" CHECK ("plan_blocks"."start_min" < "plan_blocks"."end_min")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"deadline" date NOT NULL,
	"wake_min" integer DEFAULT 450 NOT NULL,
	"sleep_min" integer DEFAULT 1410 NOT NULL,
	"focus_budget_min" integer DEFAULT 360 NOT NULL,
	"block_min" integer DEFAULT 50 NOT NULL,
	"break_min" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_day_order" CHECK ("settings"."wake_min" < "settings"."sleep_min")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"week" integer NOT NULL,
	"track" text NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" date,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"n" integer PRIMARY KEY NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"phase" integer NOT NULL,
	"phase_name" text NOT NULL,
	"theme" text NOT NULL,
	"lc_topic" text NOT NULL,
	"light" boolean DEFAULT false NOT NULL,
	"milestone" text,
	"targets" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_blocks" ADD CONSTRAINT "plan_blocks_date_day_plans_date_fk" FOREIGN KEY ("date") REFERENCES "public"."day_plans"("date") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_blocks" ADD CONSTRAINT "plan_blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_week_weeks_n_fk" FOREIGN KEY ("week") REFERENCES "public"."weeks"("n") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_blocks_date_idx" ON "plan_blocks" USING btree ("date");--> statement-breakpoint
CREATE INDEX "plan_blocks_start_at_idx" ON "plan_blocks" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "tasks_week_idx" ON "tasks" USING btree ("week");