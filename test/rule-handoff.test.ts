// Rule 5: refunds, order problems, an upset customer and a request for a person go to a
// person. The agent has no order system and no authority to refund, so answering those
// itself would be making things up. And a handoff the answer claims must be a real one:
// create_handoff has to have run.
//
// The intent check is plain keyword matching on purpose, written so ordinary recall
// questions do not trip it: "are there complaints about brakes" is about NHTSA
// complaints, and "in order to" is not an order.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkHandoff, handoffIntent, type RunEvidence } from "../src/guards/rules.ts";
import type { Answer } from "../src/agent/answer.ts";

const evidence = (question: string, handoffTicket?: string): RunEvidence => ({
  recalls: [],
  catalogHits: [],
  question,
  handoffTicket,
});

const answer = (handoff: boolean): Answer => ({ text: "", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff });

test("intent: refunds, orders, anger and asking for a person are recognised", () => {
  assert.equal(handoffIntent("I want a refund for the brake pads I bought"), "refund");
  assert.equal(handoffIntent("Where is my order? It never arrived."), "order_problem");
  assert.equal(handoffIntent("Can I cancel my order #1234?"), "order_problem");
  assert.equal(handoffIntent("This is unacceptable, I want to speak to a manager"), "angry_customer");
  assert.equal(handoffIntent("Can I talk to a human?"), "customer_asked");
});

test("intent: ordinary recall and parts questions are not handoffs", () => {
  assert.equal(handoffIntent("Are there complaints about 2017 Civic brakes?"), null);
  assert.equal(handoffIntent("2017 Civic, grinding brakes when I stop. Any recall?"), null);
  assert.equal(handoffIntent("In order to fix it, which front pads do I need?"), null);
});

test("a refund request answered without a handoff is a violation", () => {
  const v = checkHandoff(answer(false), evidence("I want a refund for the brake pads I bought"));
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "handoff_when_asked");
  assert.match(v[0].detail, /refund/);
});

test("a refund request handed off with a ticket passes", () => {
  assert.deepEqual(checkHandoff(answer(true), evidence("I want a refund for the brake pads I bought", "HO-1A2B3C")), []);
});

test("an answer that claims a handoff needs create_handoff to have run", () => {
  const v = checkHandoff(answer(true), evidence("Can I talk to a human?"));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /create_handoff/);
});

test("an ordinary question with no handoff passes", () => {
  assert.deepEqual(checkHandoff(answer(false), evidence("2017 Civic, any recall?")), []);
});
