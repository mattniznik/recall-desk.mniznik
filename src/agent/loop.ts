// The agent loop: call the model, run the tools it asks for, check its answer, repeat.
//
// Hand-written instead of a framework (PLAN.md section 5) because two things have to
// happen between steps: each step goes out as a trace event for the page, and the answer
// is checked by code before a customer sees it. The model is reached through a
// `ModelClient` function, so tests drive the loop with a scripted fake and the real
// Anthropic client is a thin adapter added later.
//
// What the loop guarantees, whatever the model does:
// - at most LIMITS.modelCalls model calls and LIMITS.toolCalls tool calls;
// - an answer reaches the customer only if it passes every rule in src/guards/rules.ts;
// - one retry, with the reasons, for a broken answer or a missing submit_answer; after
//   that, or at a cap, or on a refusal, the customer is handed to a person.

import type { Answer } from "./answer.ts";
import type { Usage } from "./cost.ts";
import { parseAnswer } from "./answer-schema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { TOOL_DEFS, runTool, type ToolDef } from "./tools.ts";
import { checkAnswer, type RunEvidence, type Violation } from "../guards/rules.ts";
import type { Deps } from "../tools/http.ts";
import type { CatalogHit } from "../tools/catalog.ts";
import { createHandoff } from "../tools/handoff.ts";
import type { BodyStyle, Recall } from "../tools/nhtsa.ts";

// 12 tool calls: a comparison of two or three cars needs recalls, complaints and ratings for
// each (live chat, 2026-11-14). Was 8 for one-car questions.
export const LIMITS = { modelCalls: 6, toolCalls: 12, retries: 1 } as const;

// An earlier turn of the chat, as the visitor's browser sent it. Text only: it is context
// for the model, never evidence for the rules, because the browser could have written it.
export type ChatTurn = { role: "user" | "assistant"; text: string };

// ---------------------------------------------------------------- the model port

// The slice of the Messages API the loop uses. The Anthropic SDK adapter maps its own
// types onto these; nothing here depends on the SDK.
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type TextBlock = { type: "text"; text: string };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
// Any other block the API returns (thinking, fallback, ...) is kept as it came and passed
// back unchanged; the loop only reads tool_use and text.
export type OtherBlock = { type: string; [key: string]: unknown };
export type ModelTurn = {
  content: (ToolUseBlock | TextBlock | OtherBlock)[];
  stop_reason: "tool_use" | "end_turn" | "max_tokens" | "refusal" | (string & {});
  model?: string;
  usage?: Usage;
};
export type Message =
  | { role: "user"; content: string | (ToolResultBlock | TextBlock)[] }
  | { role: "assistant"; content: ModelTurn["content"] };
export type ModelRequest = { system: string; messages: Message[]; tools: ToolDef[] };
export type ModelClient = (req: ModelRequest) => Promise<ModelTurn>;

// ---------------------------------------------------------------- trace and result

export type TraceEvent =
  | { type: "model_call"; n: number; stopReason: ModelTurn["stop_reason"]; model?: string; usage?: Usage }
  | { type: "tool_call"; n: number; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary: string; ms: number }
  | { type: "rule_failed"; violations: Violation[] }
  | { type: "answer"; answer: Answer }
  | { type: "handoff"; ticketId: string; reason: HandoffCause };

type HandoffCause = "rules" | "no_answer" | "cap" | "refusal" | "time";

export type RunResult = {
  status: "answered" | "handoff";
  reason?: HandoffCause;
  answer: Answer;
  modelCalls: number;
  toolCalls: number;
  usage: { input_tokens: number; output_tokens: number };
};

// ---------------------------------------------------------------- the loop

export async function runAgent(opts: {
  question: string;
  history?: ChatTurn[];
  client: ModelClient;
  deps: Deps;
  emit?: (e: TraceEvent) => void;
  // Epoch ms. Past it, the run hands off instead of making another call, so it ends with a
  // message before the Lambda timeout cuts the stream (review, 2026-11-14).
  deadline?: number;
  now?: () => number;
}): Promise<RunResult> {
  const emit = opts.emit ?? (() => {});
  const now = opts.now ?? Date.now;
  const late = () => opts.deadline !== undefined && now() > opts.deadline;
  // Evidence starts empty every turn: what earlier turns found is not trusted, so the model
  // looks it up again before citing it.
  const evidence: RunEvidence = { recalls: [], catalogHits: [], question: opts.question };
  const messages: Message[] = [
    ...(opts.history ?? []).map((t): Message => (t.role === "user" ? { role: "user", content: t.text } : { role: "assistant", content: [{ type: "text", text: t.text }] })),
    { role: "user", content: opts.question },
  ];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let modelCalls = 0;
  let toolCalls = 0;
  let retries = 0;

  const finish = (status: RunResult["status"], answer: Answer, reason?: HandoffCause): RunResult => ({
    status,
    reason,
    answer,
    modelCalls,
    toolCalls,
    usage,
  });

  const handOff = (reason: HandoffCause): RunResult => {
    const ticket = createHandoff({
      reason: "could_not_answer",
      summary: `The assistant could not finish (${reason}). Question: ${opts.question.slice(0, 400)}`,
    });
    const ticketId = ticket.ok ? ticket.ticketId : "HO-UNKNOWN";
    emit({ type: "handoff", ticketId, reason });
    return finish(
      "handoff",
      {
        text: `I could not answer this one reliably, so I have passed it to a person (ticket ${ticketId}).`,
        cited_recall_ids: [],
        applies_to_vehicle: [],
        fits: [],
        handoff: true,
      },
      reason,
    );
  };

  while (modelCalls < LIMITS.modelCalls) {
    if (late()) return handOff("time");
    const turn = await opts.client({ system: SYSTEM_PROMPT, messages, tools: TOOL_DEFS });
    modelCalls++;
    usage.input_tokens += turn.usage?.input_tokens ?? 0;
    usage.output_tokens += turn.usage?.output_tokens ?? 0;
    emit({ type: "model_call", n: modelCalls, stopReason: turn.stop_reason, model: turn.model, usage: turn.usage });

    if (turn.stop_reason === "refusal") return handOff("refusal");
    messages.push({ role: "assistant", content: turn.content });

    const uses = turn.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
    if (uses.length === 0) {
      if (retries >= LIMITS.retries) return handOff("no_answer");
      retries++;
      messages.push({ role: "user", content: "Finish by calling submit_answer with your answer." });
      continue;
    }

    const results: ToolResultBlock[] = [];
    for (const u of uses) {
      if (u.name === "submit_answer") {
        evidence.toolsUsed = toolCalls;
        const parsed = parseAnswer(u.input);
        const violations: Violation[] = parsed.ok ? checkAnswer(parsed.answer, evidence) : [{ rule: "answer_shape", detail: parsed.error }];
        if (parsed.ok && violations.length === 0) {
          emit({ type: "answer", answer: parsed.answer });
          return finish("answered", parsed.answer);
        }
        emit({ type: "rule_failed", violations });
        if (retries >= LIMITS.retries) return handOff("rules");
        retries++;
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          is_error: true,
          content: `Your answer was not sent. Fix these and call submit_answer again:\n${violations.map((v) => `- ${v.detail}`).join("\n")}`,
        });
        continue;
      }

      if (late()) return handOff("time");
      if (toolCalls >= LIMITS.toolCalls) {
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Tool budget used up. Call submit_answer now with what you have." });
        continue;
      }
      toolCalls++;
      emit({ type: "tool_call", n: toolCalls, name: u.name, input: u.input });
      const started = Date.now();
      let result: unknown;
      try {
        result = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, opts.deps);
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      const ok = (result as { ok?: boolean }).ok !== false;
      if (ok) absorb(evidence, u.name, u.input as Record<string, unknown>, result);
      emit({ type: "tool_result", name: u.name, ok, summary: summarize(u.name, result), ms: Date.now() - started });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(result), ...(ok ? {} : { is_error: true }) });
    }
    messages.push({ role: "user", content: results });
  }
  return handOff("cap");
}

// ---------------------------------------------------------------- evidence

// What the rules may trust: only what tools returned in this run. When a run touches
// more than one vehicle, the last one wins; the demo's questions are about one car.
// Exported for the MCP session (src/mcp/session.ts), which must build evidence the same way.
export function absorb(evidence: RunEvidence, name: string, input: Record<string, unknown>, result: unknown) {
  const r = result as Record<string, unknown>;
  const setVehicle = (make: unknown, model: unknown, year: unknown, body?: unknown) => {
    const same = evidence.vehicle && evidence.vehicle.model.toLowerCase() === String(model).toLowerCase() && evidence.vehicle.year === Number(year);
    evidence.vehicle = {
      make: String(make),
      model: String(model),
      year: Number(year),
      bodyStyle: (body as BodyStyle | undefined) ?? (same ? evidence.vehicle!.bodyStyle : undefined),
    };
  };
  switch (name) {
    case "decode_vehicle":
      setVehicle(r.make, r.model, r.year, r.bodyStyle);
      break;
    case "get_recalls": {
      const known = new Set(evidence.recalls.map((x) => x.campaign));
      for (const recall of r.recalls as Recall[]) if (!known.has(recall.campaign)) evidence.recalls.push(recall);
      setVehicle(input.make, input.model, input.year);
      break;
    }
    case "search_catalog":
      evidence.catalogHits.push(...(r.parts as CatalogHit[]));
      setVehicle(input.make, input.model, input.year, input.bodyStyle);
      break;
    case "get_safety_rating":
      setVehicle(input.make, input.model, input.year, input.bodyStyle);
      break;
    case "create_handoff":
      evidence.handoffTicket = String(r.ticketId);
      break;
  }
}

// One line per tool result for the trace panel.
export function summarize(name: string, result: unknown): string {
  const r = result as Record<string, any>;
  if (r?.ok === false) return `error: ${r.error}`;
  switch (name) {
    case "decode_vehicle":
      return `${r.year} ${r.make} ${r.model}, ${r.bodyStyle}`;
    case "list_models":
      return `${r.models.length} of ${r.total} models`;
    case "get_recalls":
      return `${r.count} recalls`;
    case "search_complaints":
      return `${r.matching} of ${r.total} complaints${r.component ? ` (${r.component})` : ""}`;
    case "get_safety_rating":
      return `${r.variants.length} rated variants`;
    case "search_catalog":
      return `${r.parts.length} parts`;
    case "create_handoff":
      return `ticket ${r.ticketId}`;
    default:
      return "done";
  }
}
