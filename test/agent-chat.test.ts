// The loop as a chat: earlier turns reach the model as context, and a comparison of two or
// three cars has room for its lookups. Fake model, recorded NHTSA data, no API call.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type ModelTurn, type ModelRequest, type TraceEvent } from "../src/agent/loop.ts";
import { recordedFetch } from "../src/tools/recorded.ts";

const deps = { fetchJson: recordedFetch() };
const CIVIC = { make: "Honda", model: "Civic", year: 2017 };

let ids = 0;
const use = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `tc_${++ids}`, name, input });
const turn = (...content: ModelTurn["content"]): ModelTurn => ({ content, stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn" });
const submit = (over: Record<string, unknown>) =>
  use("submit_answer", { text: "Here is what NHTSA shows.", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false, ...over });

function fakeModel(turns: ModelTurn[]) {
  const requests: ModelRequest[] = [];
  const client = async (req: ModelRequest) => {
    requests.push(structuredClone(req));
    return turns[Math.min(requests.length - 1, turns.length - 1)];
  };
  return { client, requests };
}

test("earlier turns reach the model before the new question, in order", async () => {
  const fake = fakeModel([turn(submit({}))]);
  await runAgent({
    question: "And the 2018?",
    history: [
      { role: "user", text: "Any recalls on a 2017 Civic?" },
      { role: "assistant", text: "NHTSA lists 6 recalls for the 2017 Civic." },
    ],
    client: fake.client,
    deps,
  });
  const sent = fake.requests[0].messages;
  assert.deepEqual(
    sent.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.equal(sent[0].content, "Any recalls on a 2017 Civic?");
  assert.deepEqual(sent[1].content, [{ type: "text", text: "NHTSA lists 6 recalls for the 2017 Civic." }]);
  assert.equal(sent[2].content, "And the 2018?");
});

// Civic data only: the Ranger's park-it recalls would (rightly) send a warning-less answer
// back, which is the safety rule's test, not this one.
test("a comparison with 10 lookups finishes instead of hitting the tool cap", async () => {
  const lookups = Array.from({ length: 10 }, (_, i) => (i % 2 ? use("search_complaints", { ...CIVIC, component: "brake" }) : use("get_recalls", CIVIC)));
  const events: TraceEvent[] = [];
  const result = await runAgent({
    question: "2017 Civic or 2006 Ranger: which has more recalls?",
    client: fakeModel([turn(...lookups), turn(submit({}))]).client,
    deps,
    emit: (e) => events.push(e),
  });
  assert.equal(result.status, "answered");
  assert.equal(events.filter((e) => e.type === "tool_call").length, 10);
  assert.equal(events.filter((e) => e.type === "tool_result" && !e.ok).length, 0);
});

// A review found no time limit: 12 NHTSA calls of up to 8 s each can outlast the 60 s
// Lambda timeout, which ends the stream with no answer. A deadline hands off cleanly.
test("past the deadline the run hands off instead of making more calls", async () => {
  let t = 0;
  const fake = fakeModel([turn(use("get_recalls", CIVIC)), turn(submit({}))]);
  const events: TraceEvent[] = [];
  const result = await runAgent({
    question: "2017 Civic recalls?",
    client: async (req) => {
      const out = await fake.client(req);
      t = 50_000; // the first model call took the run past its deadline
      return out;
    },
    deps,
    deadline: 45_000,
    now: () => t,
    emit: (e) => events.push(e),
  });
  assert.equal(result.status, "handoff");
  assert.equal(result.reason, "time");
  assert.equal(fake.requests.length, 1);
  assert.equal(events.filter((e) => e.type === "tool_call").length, 0);
});
