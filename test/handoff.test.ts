// create_handoff is how the agent stops and passes a customer to a person: refunds,
// order problems, an upset customer, a safety worry, or a question it could not answer
// from its tools. The ticket goes back to the page to show what a human agent would
// receive. The function does not store it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createHandoff } from "../src/tools/handoff.ts";

const fixed = { newId: () => "HO-1A2B3C", now: () => new Date("2026-11-13T20:00:00Z") };

test("a handoff returns a ticket a person can pick up", () => {
  const r = createHandoff({ reason: "refund", summary: "Customer wants a refund for front brake pads that did not fit." }, fixed);
  assert.deepEqual(r, {
    ok: true,
    ticketId: "HO-1A2B3C",
    reason: "refund",
    summary: "Customer wants a refund for front brake pads that did not fit.",
    createdAt: "2026-11-13T20:00:00.000Z",
    note: "Demo: this ticket is shown to you and not stored. In a real store it would go to the support queue.",
  });
});

test("the default ticket id is HO- and 6 hex characters", () => {
  const r = createHandoff({ reason: "could_not_answer", summary: "Asked about towing capacity." });
  assert.ok(r.ok);
  assert.match(r.ticketId, /^HO-[0-9A-F]{6}$/);
});

test("only the known reasons are accepted", () => {
  assert.equal(createHandoff({ reason: "free_parts" as never, summary: "x" }, fixed).ok, false);
});

test("a summary must be 1 to 600 characters, and control characters are removed", () => {
  assert.equal(createHandoff({ reason: "order_problem", summary: "   " }, fixed).ok, false);
  assert.equal(createHandoff({ reason: "order_problem", summary: "x".repeat(601) }, fixed).ok, false);
  const r = createHandoff({ reason: "order_problem", summary: "Order late\u0007 again\u0000" }, fixed);
  assert.ok(r.ok);
  assert.equal(r.summary, "Order late again");
});
