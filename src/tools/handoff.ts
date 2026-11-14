// create_handoff: the agent stops and passes the customer to a person.
//
// It is a tool, not a sentence in the answer, so a handoff is something code can see:
// the rules check that refund and order requests end in one, and the eval counts them.
//
// In this demo the ticket is returned to the page to show what a human agent would
// receive, and it is not stored. Live visitors' questions are not kept anywhere
// (PLAN.md section 7), and a ticket would be the one place they could leak into.

import { randomBytes } from "node:crypto";

import type { Failure } from "./nhtsa.ts";

export const HANDOFF_REASONS = [
  "refund",
  "order_problem",
  "angry_customer",
  "safety_concern",
  "could_not_answer",
  "customer_asked",
] as const;

export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export type Handoff = {
  ok: true;
  ticketId: string;
  reason: HandoffReason;
  summary: string;
  createdAt: string;
  note: string;
};

const MAX_SUMMARY = 600;

const defaults = {
  newId: () => `HO-${randomBytes(3).toString("hex").toUpperCase()}`,
  now: () => new Date(),
};

export function createHandoff(
  args: { reason: HandoffReason; summary: string },
  deps: Partial<typeof defaults> = {},
): Handoff | Failure {
  const { newId, now } = { ...defaults, ...deps };
  if (!HANDOFF_REASONS.includes(args.reason)) {
    return { ok: false, error: `reason must be one of: ${HANDOFF_REASONS.join(", ")}.` };
  }
  // Control characters have no place in a ticket a person reads.
  const summary = String(args.summary ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (summary.length === 0 || summary.length > MAX_SUMMARY) {
    return { ok: false, error: `summary must be 1 to ${MAX_SUMMARY} characters.` };
  }
  return {
    ok: true,
    ticketId: newId(),
    reason: args.reason,
    summary,
    createdAt: now().toISOString(),
    note: "Demo: this ticket is shown to you and not stored. In a real store it would go to the support queue.",
  };
}
