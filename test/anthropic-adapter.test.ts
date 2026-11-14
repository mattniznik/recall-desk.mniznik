// The adapter between the agent loop and the Anthropic SDK, tested with a fake SDK so no
// request leaves the machine. It must send what the plan settled (Opus 5.5, low effort,
// the system prompt cached, server-side refusal fallbacks, no forced tool choice) and hand
// the reply back whole: on Opus 5.5 thinking blocks are tied to the conversation and must
// be passed back unchanged (Claude API skill, model notes).

import { test } from "node:test";
import assert from "node:assert/strict";

import { anthropicClient, MODEL } from "../src/agent/anthropic.ts";
import { costUsd } from "../src/agent/cost.ts";
import { TOOL_DEFS } from "../src/agent/tools.ts";

function fakeSdk(reply: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const sdk = { beta: { messages: { create: async (params: Record<string, unknown>) => (calls.push(params), reply) } } };
  return { sdk, calls };
}

const reply = {
  model: "claude-opus-5-5",
  stop_reason: "tool_use",
  content: [
    { type: "thinking", thinking: "Look up recalls first.", signature: "sig-abc" },
    { type: "tool_use", id: "toolu_1", name: "get_recalls", input: { make: "Honda", model: "Civic", year: 2017 } },
  ],
  usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 2500, cache_read_input_tokens: 0 },
};

test("the request carries the model, low effort, a cached system prompt, the tools and fallbacks", async () => {
  const { sdk, calls } = fakeSdk(reply);
  const client = anthropicClient({ apiKey: "test-key-not-real", sdk });
  await client({ system: "SYSTEM", messages: [{ role: "user", content: "hi" }], tools: TOOL_DEFS });
  const p = calls[0];
  assert.equal(p.model, MODEL);
  assert.equal(MODEL, "claude-opus-5-5");
  assert.deepEqual(p.output_config, { effort: "low" });
  assert.deepEqual(p.system, [{ type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.fallbacks, "default");
  assert.equal("tool_choice" in p, false, "forced tool choice returns a 400 on Opus 5.5");
  const submit = (p.tools as { name: string; strict?: boolean }[]).find((t) => t.name === "submit_answer");
  assert.equal(submit?.strict, true);
});

test("the reply comes back whole, thinking block included, with model and usage", async () => {
  const { sdk } = fakeSdk(reply);
  const turn = await anthropicClient({ apiKey: "test-key-not-real", sdk })({ system: "S", messages: [], tools: [] });
  assert.deepEqual(turn.content, reply.content);
  assert.equal(turn.stop_reason, "tool_use");
  assert.equal(turn.model, "claude-opus-5-5");
  assert.deepEqual(turn.usage, reply.usage);
});

test("cost per call uses the model's own prices, cache reads and writes included", () => {
  // Opus 5.5 per million tokens: input $4, output $20, 5-minute cache write $5, cache read $0.20
  // (Anthropic pricing page, read 2026-11-12).
  const usd = costUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 500_000 });
  assert.equal(usd, 4 + 2 + 1 + 0.1);
  assert.equal(costUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.1 + 0.5);
  assert.equal(costUsd("some-unknown-model", { input_tokens: 10, output_tokens: 10 }), null);
});

// Live chat (2026-11-14): a review found 16,000 output tokens x 6 calls = about $1.92 worst
// case per question. The chat passes a lower cap; the most any recorded call produced was
// 803 output tokens (n=12 calls).
test("max_tokens can be capped per client, and defaults to 16000", async () => {
  const capped = fakeSdk(reply);
  await anthropicClient({ apiKey: "test-key-not-real", sdk: capped.sdk, maxTokens: 4000 })({ system: "S", messages: [{ role: "user", content: "hi" }], tools: TOOL_DEFS });
  assert.equal(capped.calls[0].max_tokens, 4000);
  const plain = fakeSdk(reply);
  await anthropicClient({ apiKey: "test-key-not-real", sdk: plain.sdk })({ system: "S", messages: [{ role: "user", content: "hi" }], tools: TOOL_DEFS });
  assert.equal(plain.calls[0].max_tokens, 16000);
});
