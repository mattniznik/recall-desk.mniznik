// The agent loop with a scripted fake model: no API call, no key, no SDK. It checks the
// parts the model cannot be trusted with: tools actually run and feed the rules, a bad
// answer gets one retry with the reasons and then a person, the caps hold, and the trace
// the page will show comes out in order.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgent, LIMITS, type ModelTurn, type ModelRequest, type TraceEvent } from "../src/agent/loop.ts";
import { recordedFetch } from "../src/tools/recorded.ts";

const deps = { fetchJson: recordedFetch() };
const CIVIC = { make: "Honda", model: "Civic", year: 2017 };

let ids = 0;
const use = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `tu_${++ids}`, name, input });
const turn = (...content: ModelTurn["content"]): ModelTurn => ({ content, stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn" });
const submit = (over: Record<string, unknown>) =>
  use("submit_answer", { text: "No recall covers brakes on a 2017 Civic.", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false, ...over });

function fakeModel(turns: ModelTurn[]) {
  const requests: ModelRequest[] = [];
  const client = async (req: ModelRequest) => {
    requests.push(structuredClone(req));
    return turns[Math.min(requests.length - 1, turns.length - 1)];
  };
  return { client, requests };
}

async function run(question: string, turns: ModelTurn[]) {
  const events: TraceEvent[] = [];
  const fake = fakeModel(turns);
  const result = await runAgent({ question, client: fake.client, deps, emit: (e) => events.push(e) });
  return { result, events, requests: fake.requests };
}

test("a clean run: tool, then a checked answer, with the trace in order", async () => {
  const { result, events, requests } = await run("2017 Civic, grinding brakes. Any recall?", [
    turn(use("get_recalls", CIVIC)),
    turn(submit({ text: "No recall covers brakes. 17V706000 covers the driveshaft on sedans and coupes.", cited_recall_ids: ["17V706000"] })),
  ]);
  assert.equal(result.status, "answered");
  assert.deepEqual(result.answer.cited_recall_ids, ["17V706000"]);
  assert.deepEqual(events.map((e) => e.type), ["model_call", "tool_call", "tool_result", "model_call", "answer"]);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].tools.some((t) => t.name === "submit_answer"));
});

test("a broken rule gets one retry with the reason, then the fixed answer goes out", async () => {
  const { result, events, requests } = await run("2017 Civic recalls?", [
    turn(use("get_recalls", CIVIC)),
    turn(submit({ text: "See 99V999000.", cited_recall_ids: ["99V999000"] })),
    turn(submit({})),
  ]);
  assert.equal(result.status, "answered");
  assert.equal(events.filter((e) => e.type === "rule_failed").length, 1);
  const feedback = JSON.stringify(requests[2].messages.at(-1));
  assert.match(feedback, /"is_error":true/);
  assert.match(feedback, /99V999000/);
});

test("a second broken answer goes to a person instead of the customer", async () => {
  const bad = submit({ text: "See 99V999000.", cited_recall_ids: ["99V999000"] });
  const { result, events } = await run("2017 Civic recalls?", [turn(use("get_recalls", CIVIC)), turn(bad), turn(bad)]);
  assert.equal(result.status, "handoff");
  assert.equal(result.answer.handoff, true);
  assert.doesNotMatch(result.answer.text, /99V999000/);
  assert.match(events.at(-1)!.type, /handoff/);
});

test("the model-call cap ends a run that never finishes", async () => {
  const { result, requests } = await run("2017 Civic?", [turn(use("get_recalls", CIVIC))]);
  assert.equal(requests.length, LIMITS.modelCalls);
  assert.equal(result.status, "handoff");
  assert.equal(result.reason, "cap");
});

test("the tool-call cap holds even when the model asks for many tools at once", async () => {
  const many = turn(...Array.from({ length: 5 }, () => use("get_recalls", CIVIC)));
  const { events } = await run("2017 Civic?", [many]);
  assert.equal(events.filter((e) => e.type === "tool_call").length, LIMITS.toolCalls);
});

test("ending without submit_answer gets one reminder, then a person", async () => {
  const chatty = turn({ type: "text", text: "Sure, no recall." });
  const { result, requests } = await run("2017 Civic?", [chatty, chatty]);
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /submit_answer/);
  assert.equal(result.status, "handoff");
});

test("a refusal goes straight to a person", async () => {
  const { result } = await run("2017 Civic?", [{ content: [], stop_reason: "refusal" }]);
  assert.equal(result.status, "handoff");
  assert.equal(result.reason, "refusal");
});

test("an unknown tool is an error result the model can read, not a crash", async () => {
  const { result, requests } = await run("2017 Civic?", [turn(use("get_parts", {})), turn(submit({}))]);
  assert.equal(result.status, "answered");
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /unknown tool/);
});

test("blocks the loop does not know, like thinking, go back to the model unchanged", async () => {
  const thinking = { type: "thinking", thinking: "Recalls first.", signature: "sig-1" } as unknown as ModelTurn["content"][number];
  const { requests } = await run("2017 Civic?", [{ content: [thinking, use("get_recalls", CIVIC)], stop_reason: "tool_use" }, turn(submit({}))]);
  const assistant = requests[1].messages.find((m) => m.role === "assistant");
  assert.deepEqual((assistant!.content as unknown[])[0], thinking);
});

test("a refund handed off through create_handoff passes the handoff rule", async () => {
  const { result } = await run("I want a refund for the brake pads I bought", [
    turn(use("create_handoff", { reason: "refund", summary: "Customer wants a refund for brake pads." })),
    turn(submit({ text: "I have passed your refund request to a person.", handoff: true })),
  ]);
  assert.equal(result.status, "answered");
  assert.equal(result.answer.handoff, true);
});
