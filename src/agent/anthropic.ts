// The ModelClient the agent loop uses, backed by the Anthropic SDK.
//
// Settings, each from docs/decisions/0008 or Anthropic's documentation for Opus 5.5:
// - claude-opus-5-5 at effort "low": thinking cannot be turned off on this model, effort
//   is the control, and its default is "medium".
// - Adaptive thinking with display "summarized", so a trace can show a one-line why.
// - The system prompt marked for caching: tools and system repeat on every call in a run.
// - Server-side refusal fallbacks ("default"), which the skill recommends by default.
// - No tool_choice: forcing a tool returns a 400 on Opus 5.5; the prompt asks for
//   submit_answer and the loop checks it came.
//
// The key is passed in explicitly, never read from ANTHROPIC_API_KEY: that variable would
// also switch Claude Code on this machine from its subscription login to paid billing.
// The reply is handed back whole. Thinking blocks are tied to the conversation on Opus 5.5
// and must be passed back unchanged.

import Anthropic from "@anthropic-ai/sdk";

import type { ModelClient, ModelTurn } from "./loop.ts";

export const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;

// The one SDK call the adapter makes, so tests can hand in a fake.
type SdkLike = { beta: { messages: { create: (params: any) => Promise<any> } } };

export function anthropicClient(opts: { apiKey: string; model?: string; effort?: "low" | "medium" | "high"; maxTokens?: number; sdk?: SdkLike }): ModelClient {
  const sdk: SdkLike = opts.sdk ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as SdkLike);
  const model = opts.model ?? MODEL;
  return async (req) => {
    const response = await sdk.beta.messages.create({
      model,
      max_tokens: opts.maxTokens ?? MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: opts.effort ?? "low" },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools,
      messages: req.messages,
    });
    return {
      content: response.content,
      stop_reason: response.stop_reason,
      model: response.model,
      usage: response.usage,
    } as ModelTurn;
  };
}
