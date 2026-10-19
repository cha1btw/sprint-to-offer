// The only place that talks to the Anthropic SDK. Everything else uses the
// small ClaudeClient interface, so tests pass a fake and never touch the network.
import Anthropic from "@anthropic-ai/sdk";
import type { AiFeature } from "../db/schema.ts";

// Sonnet where judgment matters (the plan, the review, the coach), Haiku for
// the quick and cheap "first step" answer.
export const MODELS: Record<AiFeature, string> = {
  plan: "claude-sonnet-5-5",
  first_step: "claude-haiku-5-5",
  review: "claude-sonnet-5-5",
  coach: "claude-sonnet-5-5",
};

export type ClaudeRequest = {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  // How hard the model thinks. It also sets how many tokens a call spends.
  effort: "low" | "medium" | "high";
  // A JSON schema: the reply text is then guaranteed to be JSON of that shape.
  schema?: Record<string, unknown>;
  timeoutMs?: number;
};

export type ClaudeReply = {
  text: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
};

export interface ClaudeClient {
  send(request: ClaudeRequest): Promise<ClaudeReply>;
}

export function createClaudeClient(apiKey: string): ClaudeClient {
  // One retry: a call runs inside a web request or the Telegram webhook, so a
  // long chain of retries would outlive the request anyway.
  const sdk = new Anthropic({ apiKey, maxRetries: 1 });
  return {
    async send(r) {
      const response = await sdk.beta.messages.create(
        {
          model: r.model,
          max_tokens: r.maxTokens,
          system: r.system,
          messages: r.messages,
          output_config: {
            effort: r.effort,
            ...(r.schema ? { format: { type: "json_schema" as const, schema: r.schema } } : {}),
          },
          // If the model declines for policy reasons, the API retries on its
          // default fallback model inside the same call (a no-op for Haiku).
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: r.timeoutMs ?? 25_000 },
      );
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const u = response.usage;
      return {
        text,
        stopReason: response.stop_reason,
        // Cached input is billed too, so it counts against the monthly cap.
        inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
      };
    },
  };
}

let cached: ClaudeClient | undefined;

// null when ANTHROPIC_API_KEY is empty: the app then works without AI.
export function getClaude(): ClaudeClient | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  cached ??= createClaudeClient(key);
  return cached;
}
