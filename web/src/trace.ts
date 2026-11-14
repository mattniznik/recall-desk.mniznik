// From the agent's trace events to the rows the trace panel shows. Plain functions, no
// React, so node --test checks them directly.
//
// A tool call and its result become one row. A blocked answer becomes a row that lists
// each broken rule in the words the model was given. Model calls are counted in the
// footer rather than shown as rows: they are the gaps between tool rows.

import type { Answer } from "../../src/agent/answer.ts";
import type { TraceEvent } from "../../src/agent/loop.ts";

export type Step =
  | { kind: "tool"; name: string; input: string; summary: string; ok: boolean; ms: number }
  | { kind: "blocked"; reasons: string[] }
  | { kind: "answer"; answer: Answer }
  | { kind: "handoff"; ticketId: string; reason: string };

// What each tool is called on the page (the trace panel, How it works, the console log).
export const TOOL_LABEL: Record<string, string> = {
  decode_vehicle: "Decode VIN",
  list_models: "Find model name",
  get_recalls: "NHTSA recalls",
  search_complaints: "NHTSA complaints",
  get_safety_rating: "NHTSA safety rating",
  search_catalog: "Store catalog",
  create_handoff: "Hand off to a person",
};

const VEHICLE_KEYS = ["year", "make", "model"];

// "2017 Honda Civic, component: SERVICE BRAKES": the vehicle first, then everything else.
export function describeInput(input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>;
  const vehicle = VEHICLE_KEYS.map((k) => o[k]).filter((v) => v !== undefined && v !== "").join(" ");
  const rest = Object.entries(o)
    .filter(([k, v]) => !VEHICLE_KEYS.includes(k) && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`);
  return [vehicle, ...rest].filter(Boolean).join(", ");
}

export type Replay = {
  label: string;
  question: string;
  status: string;
  events: TraceEvent[];
  real?: boolean;
  costUsd?: number | null;
  tokens?: { input: number; cacheWrite: number; cacheRead: number; output: number };
  seconds?: number;
};

// The line under a replay: what it cost and how big it was. A real run shows its measured
// tokens and dollars; a scripted one says plainly that no model ran.
export function replayMetrics(r: Replay): string {
  const modelCalls = r.events.filter((e) => e.type === "model_call").length;
  const toolCalls = r.events.filter((e) => e.type === "tool_call").length;
  if (!r.real) return `${modelCalls} scripted model steps, ${toolCalls} tool calls. Scripted, no model call, $0.`;
  const t = r.tokens;
  const total = t ? t.input + t.cacheWrite + t.cacheRead + t.output : 0;
  const cost = r.costUsd === null || r.costUsd === undefined ? "cost unknown" : `$${r.costUsd.toFixed(4)}`;
  const time = r.seconds !== undefined ? `, ${r.seconds.toFixed(1)} s` : "";
  return `${modelCalls} model calls, ${toolCalls} tool calls, ${total.toLocaleString("en-US")} tokens, ${cost}${time}.`;
}

export function toSteps(events: TraceEvent[]): Step[] {
  const steps: Step[] = [];
  let pending: { name: string; input: unknown } | null = null;
  for (const e of events) {
    switch (e.type) {
      case "tool_call":
        pending = { name: e.name, input: e.input };
        break;
      case "tool_result":
        steps.push({ kind: "tool", name: e.name, input: describeInput(pending?.input), summary: e.summary, ok: e.ok, ms: e.ms });
        pending = null;
        break;
      case "rule_failed":
        steps.push({ kind: "blocked", reasons: e.violations.map((v) => v.detail) });
        break;
      case "answer":
        steps.push({ kind: "answer", answer: e.answer });
        break;
      case "handoff":
        steps.push({ kind: "handoff", ticketId: e.ticketId, reason: e.reason });
        break;
    }
  }
  return steps;
}
