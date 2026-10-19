// Monthly token budget. Every Claude call goes through callClaude(), which
// refuses to call when the month's cap is used up and records what each call cost.
import { gte, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aiUsage, type AiFeature } from "../db/schema.ts";
import { kyivDate, minuteToUtc } from "../time.ts";
import { MODELS, type ClaudeClient, type ClaudeReply, type ClaudeRequest } from "./client.ts";

export const DEFAULT_MONTHLY_CAP = 2_000_000;

// Empty or invalid means the default; 0 turns AI off.
export function monthlyCap(value = process.env.AI_MONTHLY_TOKEN_CAP): number {
  if (value === undefined || value.trim() === "") return DEFAULT_MONTHLY_CAP;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MONTHLY_CAP;
}

// Start of the current Kyiv calendar month as a UTC instant.
export function monthStart(now: Date): Date {
  return minuteToUtc(`${kyivDate(now).slice(0, 7)}-01`, 0);
}

export async function monthTokens(db: Db, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, monthStart(now)));
  return row.total;
}

export type AiStatus = { enabled: boolean; reason: "ok" | "no_key" | "cap"; used: number; cap: number };

// Pages and the bot call this to decide whether to show AI buttons at all.
export async function aiStatus(db: Db, claude: ClaudeClient | null, now: Date = new Date()): Promise<AiStatus> {
  const cap = monthlyCap();
  if (!claude) return { enabled: false, reason: "no_key", used: 0, cap };
  const used = await monthTokens(db, now);
  return used < cap ? { enabled: true, reason: "ok", used, cap } : { enabled: false, reason: "cap", used, cap };
}

export type AiFailure = "no_key" | "cap" | "refusal" | "truncated" | "bad_output";

export class AiUnavailableError extends Error {
  readonly reason: AiFailure;
  constructor(reason: AiFailure) {
    super(`Claude is unavailable: ${reason}`);
    this.reason = reason;
  }
}

export async function recordUsage(db: Db, feature: AiFeature, model: string, reply: Pick<ClaudeReply, "inputTokens" | "outputTokens">, now: Date = new Date()) {
  await db.insert(aiUsage).values({ feature, model, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, createdAt: now });
}

// Checks the budget, calls the model chosen for the feature and records the
// tokens even when the answer turns out to be unusable: they are billed anyway.
export async function callClaude(
  db: Db,
  claude: ClaudeClient | null,
  feature: AiFeature,
  request: Omit<ClaudeRequest, "model">,
  now: Date = new Date(),
): Promise<string> {
  const status = await aiStatus(db, claude, now);
  if (!status.enabled) throw new AiUnavailableError(status.reason as "no_key" | "cap");
  const model = MODELS[feature];
  const reply = await claude!.send({ ...request, model });
  await recordUsage(db, feature, model, reply, now);
  if (reply.stopReason === "refusal") throw new AiUnavailableError("refusal");
  if (reply.stopReason === "max_tokens") throw new AiUnavailableError("truncated");
  if (!reply.text.trim()) throw new AiUnavailableError("bad_output");
  return reply.text.trim();
}
