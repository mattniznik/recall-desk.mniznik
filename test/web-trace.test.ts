// The trace panel turns the agent's events into the steps a visitor reads: one row per
// tool (what was asked, what came back, how long), a row when an answer was blocked by a
// rule and why, and the final answer or handoff. The replays it plays are scripted runs:
// real tools on recorded NHTSA data, a fake model choosing the steps. They must say so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { toSteps, describeInput, replayMetrics } from "../web/src/trace.ts";
import { SAMPLES } from "../src/cli/ask.ts";

const replay = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "web", "src", "replays", `${name}.json`), "utf8"));

test("tool inputs read as plain words, vehicle first", () => {
  assert.equal(describeInput({ make: "Honda", model: "Civic", year: 2017, component: "SERVICE BRAKES" }), "2017 Honda Civic, component: SERVICE BRAKES");
  assert.equal(describeInput({ part: "front brake pads", make: "Honda", model: "Civic", year: 2017 }), "2017 Honda Civic, part: front brake pads");
  assert.equal(describeInput({}), "");
});

test("a call and its result become one tool step", () => {
  const steps = toSteps([
    { type: "model_call", n: 1, stopReason: "tool_use" },
    { type: "tool_call", n: 1, name: "get_recalls", input: { make: "Honda", model: "Civic", year: 2017 } },
    { type: "tool_result", name: "get_recalls", ok: true, summary: "6 recalls", ms: 3 },
  ]);
  assert.deepEqual(steps, [{ kind: "tool", name: "get_recalls", input: "2017 Honda Civic", summary: "6 recalls", ok: true, ms: 3 }]);
});

test("a blocked answer shows each broken rule, and the final answer closes the list", () => {
  const answer = { text: "ok", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false };
  const steps = toSteps([
    { type: "rule_failed", violations: [{ rule: "cite_only_returned", detail: "99V999000 is cited but no tool returned it in this run." }] },
    { type: "answer", answer },
  ]);
  assert.deepEqual(steps, [
    { kind: "blocked", reasons: ["99V999000 is cited but no tool returned it in this run."] },
    { kind: "answer", answer },
  ]);
});

test("the replays are labeled scripted and end in an answer to the sample question", () => {
  for (const name of ["brakes", "guard"]) {
    const r = replay(name);
    assert.match(r.label, /scripted/i, `${name} says it is scripted`);
    assert.match(r.label, /no model/i);
    assert.equal(r.question, SAMPLES[0].question);
    assert.equal(r.events.at(-1).type, "answer");
  }
});

test("the real replay says it is real and shows its measured tokens and cost", () => {
  const r = replay("real-brakes");
  assert.equal(r.real, true);
  assert.match(r.label, /^Real run: claude-opus-5-5/);
  assert.equal(r.events.at(-1).type, "answer");
  assert.ok(r.costUsd > 0);
  const line = replayMetrics(r);
  assert.match(line, /\$0\.\d{4}/);
  assert.match(line, /tokens/);
});

test("a scripted replay's metrics line says no model was called", () => {
  assert.match(replayMetrics(replay("brakes")), /scripted, no model call, \$0/i);
});

test("the brakes replay shows three tools; the guard replay shows the block", () => {
  const brakes = toSteps(replay("brakes").events);
  assert.deepEqual(brakes.filter((s) => s.kind === "tool").map((s) => s.kind === "tool" && s.name), ["get_recalls", "search_complaints", "search_catalog"]);
  const guard = toSteps(replay("guard").events);
  const blocked = guard.find((s) => s.kind === "blocked");
  assert.ok(blocked && blocked.kind === "blocked" && /99V999000/.test(blocked.reasons.join(" ")));
});
