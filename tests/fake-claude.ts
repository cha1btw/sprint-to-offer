// A ClaudeClient for tests: answers from a script and remembers every request.
import type { ClaudeClient, ClaudeReply, ClaudeRequest } from "../lib/ai/client.ts";

type Answer = string | Partial<ClaudeReply> | Error | ((request: ClaudeRequest) => string | Partial<ClaudeReply>);

export function fakeClaude(...answers: Answer[]): ClaudeClient & { calls: ClaudeRequest[] } {
  const calls: ClaudeRequest[] = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      const value = typeof answer === "function" ? answer(request) : answer;
      const reply = typeof value === "string" ? { text: value } : value;
      return { text: "", stopReason: "end_turn", inputTokens: 100, outputTokens: 50, ...reply };
    },
  };
}
