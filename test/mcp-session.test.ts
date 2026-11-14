// The MCP session: the agent's tools on the recordings, behind the same rules as the agent
// loop. A Claude Code eval run reaches the agent only through this, so it must treat an
// answer exactly as runAgent does: one retry with the reasons, then a person. The last
// test drives both with the same script and compares what the customer would get.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgent, LIMITS, type ModelTurn } from "../src/agent/loop.ts";
import { TOOL_DEFS } from "../src/agent/tools.ts";
import { evalFetch } from "../src/evals/fixtures.ts";
import { createSession, finishUnanswered, type SessionRecord } from "../src/mcp/session.ts";

const deps = { fetchJson: evalFetch() };
const CIVIC = { make: "Honda", model: "Civic", year: 2017 };
const good = { text: "No recall covers brakes on a 2017 Civic. 17V706000 covers the driveshaft on sedans and coupes.", cited_recall_ids: ["17V706000"], applies_to_vehicle: [], fits: [], handoff: false };
const invented = { ...good, text: "See 99V999000.", cited_recall_ids: ["99V999000"] };

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("");

test("lists the agent's tools with their JSON schemas, submit_answer included", () => {
  const s = createSession({ question: "q", deps });
  assert.deepEqual(s.tools.map((t) => t.name), TOOL_DEFS.map((t) => t.name));
  assert.ok(s.tools.some((t) => t.name === "submit_answer"));
  for (const t of s.tools) assert.deepEqual(t.inputSchema, TOOL_DEFS.find((d) => d.name === t.name)!.input_schema);
});

test("a tool runs on the recordings, and the call is recorded", async () => {
  const records: SessionRecord[] = [];
  const s = createSession({ question: "2017 Civic recalls?", deps, onChange: (r) => records.push(structuredClone(r)) });
  const r = await s.call("get_recalls", CIVIC);
  assert.equal(r.isError, undefined);
  assert.equal(JSON.parse(text(r)).count, 6);
  assert.deepEqual(s.record().toolCalls.map((t) => [t.name, t.ok, t.summary]), [["get_recalls", true, "6 recalls"]]);
  assert.equal(records.length, 1);
});

test("a failing tool comes back as an MCP error the model can read, not a crash", async () => {
  const s = createSession({ question: "q", deps });
  const r = await s.call("get_recalls", { make: "Ford", model: "Ranger", year: 2005 });
  assert.equal(r.isError, true);
  assert.match(text(r), /no recording/);
  assert.equal(s.record().toolCalls[0].ok, false);
});

test("a VIN decodes from the partial-VIN recording", async () => {
  const s = createSession({ question: "q", deps });
  const r = JSON.parse(text(await s.call("decode_vehicle", { vin: "19XFC2F5XHE000000" })));
  assert.equal(r.bodyStyle, "sedan");
});

test("submit_answer runs the loop's rules: a broken answer gets the reasons once, as an error", async () => {
  const s = createSession({ question: "2017 Civic recalls?", deps });
  await s.call("get_recalls", CIVIC);
  const r = await s.call("submit_answer", invented);
  assert.equal(r.isError, true);
  assert.match(text(r), /99V999000/);
  assert.match(text(r), /call submit_answer again/);
  assert.equal(s.record().status, "pending");
  assert.equal(s.record().submits[0].violations[0].rule, "cite_only_returned");
});

test("a second broken answer hands the customer to a person, as the loop does", async () => {
  const s = createSession({ question: "2017 Civic recalls?", deps });
  await s.call("get_recalls", CIVIC);
  await s.call("submit_answer", invented);
  const r = await s.call("submit_answer", invented);
  assert.equal(r.isError, true);
  const rec = s.record();
  assert.equal(rec.status, "handoff");
  assert.equal(rec.reason, "rules");
  assert.equal(rec.answer!.handoff, true);
  assert.doesNotMatch(rec.answer!.text, /99V999000/);
  assert.match(rec.answer!.text, /HO-/);
});

test("an answer that passes is recorded and ends the session; later calls are refused", async () => {
  const s = createSession({ question: "2017 Civic, grinding brakes. Any recall?", deps });
  await s.call("get_recalls", CIVIC);
  const r = await s.call("submit_answer", good);
  assert.equal(r.isError, undefined);
  assert.equal(s.record().status, "answered");
  assert.deepEqual(s.record().answer!.cited_recall_ids, ["17V706000"]);
  const after = await s.call("get_recalls", CIVIC);
  assert.equal(after.isError, true);
  assert.equal(s.record().toolCalls.length, 1, "the refused call did not run");
});

test("the tool budget holds at LIMITS.toolCalls", async () => {
  const s = createSession({ question: "q", deps });
  for (let i = 0; i < LIMITS.toolCalls; i++) assert.equal((await s.call("list_models", { make: "Honda", year: 2017 })).isError, undefined);
  const over = await s.call("list_models", { make: "Honda", year: 2017 });
  assert.equal(over.isError, true);
  assert.match(text(over), /Tool budget used up/);
  assert.equal(s.record().toolCalls.length, LIMITS.toolCalls);
});

test("a session the model left without an answer becomes a handoff: cap or no_answer", () => {
  const s = createSession({ question: "q", deps });
  const capped = finishUnanswered(s.record(), "cap");
  assert.equal(capped.status, "handoff");
  assert.equal(capped.reason, "cap");
  assert.equal(capped.answer!.handoff, true);
  const done = createSession({ question: "q", deps });
  assert.equal(finishUnanswered(done.record(), "no_answer").reason, "no_answer");
});

// ---------------------------------------------------------------- same script, same outcome

type Step = { name: string; input: Record<string, unknown> };

async function viaLoop(question: string, steps: Step[][]) {
  let ids = 0;
  const turns: ModelTurn[] = steps.map((group) => ({
    content: group.map((s) => ({ type: "tool_use" as const, id: `tu_${++ids}`, name: s.name, input: s.input })),
    stop_reason: "tool_use",
  }));
  let i = 0;
  const result = await runAgent({ question, deps, client: async () => turns[Math.min(i++, turns.length - 1)] });
  return { status: result.status, reason: result.reason, handoff: result.answer.handoff, cited: result.answer.cited_recall_ids, fits: result.answer.fits };
}

async function viaSession(question: string, steps: Step[][]) {
  const s = createSession({ question, deps });
  for (const group of steps) for (const step of group) if (s.record().status === "pending") await s.call(step.name, step.input);
  const r = s.record();
  return { status: r.status, reason: r.reason, handoff: r.answer?.handoff, cited: r.answer?.cited_recall_ids, fits: r.answer?.fits };
}

test("same script, same outcome as the agent loop", async () => {
  const handoffAnswer = { text: "I have passed this to a person.", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: true };
  const scripts: [string, string, Step[][]][] = [
    ["clean", "2017 Civic, grinding brakes. Any recall?", [[{ name: "get_recalls", input: CIVIC }], [{ name: "submit_answer", input: good }]]],
    ["retry then pass", "2017 Civic recalls?", [[{ name: "get_recalls", input: CIVIC }], [{ name: "submit_answer", input: invented }], [{ name: "submit_answer", input: good }]]],
    ["two failures", "2017 Civic recalls?", [[{ name: "get_recalls", input: CIVIC }], [{ name: "submit_answer", input: invented }], [{ name: "submit_answer", input: invented }]]],
    [
      "refund handoff",
      "I want a refund for my brake pads.",
      [[{ name: "create_handoff", input: { reason: "refund", summary: "Refund for brake pads." } }], [{ name: "submit_answer", input: handoffAnswer }]],
    ],
    ["refund without handoff", "I want a refund for my brake pads.", [[{ name: "submit_answer", input: { ...handoffAnswer, handoff: false } }], [{ name: "submit_answer", input: { ...handoffAnswer, handoff: false } }]]],
    [
      "fit needs a body style",
      "Front brake pads for a 2017 Civic?",
      [
        [{ name: "search_catalog", input: { ...CIVIC, part: "front brake pads" } }],
        [{ name: "submit_answer", input: { ...good, text: "DP-BRK-F-CIV-SC fits.", cited_recall_ids: [], fits: ["DP-BRK-F-CIV-SC"] } }],
        [{ name: "submit_answer", input: { ...good, text: "Which body style is it? DP-BRK-F-CIV-SC is for sedans and coupes.", cited_recall_ids: [], fits: [] } }],
      ],
    ],
  ];
  for (const [label, question, steps] of scripts) {
    assert.deepEqual(await viaSession(question, steps), await viaLoop(question, steps), label);
  }
});
