// One conversation's worth of the agent's tools, for an MCP client: the tool handlers the
// stdio server (server.ts) serves. It mirrors the tool branch of the agent loop
// (src/agent/loop.ts) so a model reached through Claude Code meets the same rules as one
// reached through the Anthropic API:
//
// - the same tools and schemas (TOOL_DEFS), the same functions (runTool), the same
//   evidence (absorb), the same tool budget (LIMITS.toolCalls);
// - submit_answer runs parseAnswer and every rule in src/guards/rules.ts; a broken answer
//   comes back as an error with the reasons, once (LIMITS.retries), and a second broken
//   one hands the customer to a person;
// - the first accepted answer or handoff is final; later calls are refused.
//
// Two things the loop does that a tool server cannot: cap model calls (the eval runner
// passes --max-turns instead) and nudge a model that ends without submit_answer (the run
// is then recorded as a "no_answer" handoff with finishUnanswered). test/mcp-session.test.ts
// drives this and runAgent with the same scripts and compares the outcomes.
//
// Everything that happens is kept in a SessionRecord, which the server writes to a file
// after every call so the eval runner can grade the run.

import type { Answer } from "../agent/answer.ts";
import { parseAnswer } from "../agent/answer-schema.ts";
import { LIMITS, absorb, summarize } from "../agent/loop.ts";
import { TOOL_DEFS, runTool } from "../agent/tools.ts";
import { checkAnswer, type RunEvidence, type Violation } from "../guards/rules.ts";
import { createHandoff } from "../tools/handoff.ts";
import type { Deps } from "../tools/http.ts";

export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown> };
export type McpResult = { content: { type: "text"; text: string }[]; isError?: true };

export type HandoffCause = "rules" | "cap" | "no_answer";

export type SessionRecord = {
  question: string;
  status: "pending" | "answered" | "handoff";
  reason?: HandoffCause;
  answer?: Answer;
  toolCalls: { n: number; name: string; input: unknown; ok: boolean; summary: string }[];
  submits: { ok: boolean; violations: Violation[] }[];
};

// The loop's own handoff, word for word, so both paths hand off the same way.
export function handoffAnswer(question: string, cause: HandoffCause): { answer: Answer; ticketId: string } {
  const ticket = createHandoff({ reason: "could_not_answer", summary: `The assistant could not finish (${cause}). Question: ${question.slice(0, 400)}` });
  const ticketId = ticket.ok ? ticket.ticketId : "HO-UNKNOWN";
  return {
    ticketId,
    answer: {
      text: `I could not answer this one reliably, so I have passed it to a person (ticket ${ticketId}).`,
      cited_recall_ids: [],
      applies_to_vehicle: [],
      fits: [],
      handoff: true,
    },
  };
}

// A run that ended without a final answer: the model stopped without submit_answer, or
// Claude Code's turn cap stopped it. The loop hands off in both cases, and so does this.
export function finishUnanswered(record: SessionRecord, cause: "cap" | "no_answer"): SessionRecord {
  if (record.status !== "pending") return record;
  return { ...record, status: "handoff", reason: cause, answer: handoffAnswer(record.question, cause).answer };
}

const reply = (text: string, isError = false): McpResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true as const } : {}) });

export function createSession(opts: { question: string; deps: Deps; onChange?: (r: SessionRecord) => void }) {
  const evidence: RunEvidence = { recalls: [], catalogHits: [], question: opts.question };
  const record: SessionRecord = { question: opts.question, status: "pending", toolCalls: [], submits: [] };
  let toolCalls = 0;
  let retries = 0;
  const changed = () => opts.onChange?.(record);

  const tools: McpTool[] = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

  async function submit(input: unknown): Promise<McpResult> {
    evidence.toolsUsed = toolCalls;
    const parsed = parseAnswer(input);
    const violations: Violation[] = parsed.ok ? checkAnswer(parsed.answer, evidence) : [{ rule: "answer_shape", detail: parsed.error }];
    record.submits.push({ ok: parsed.ok && violations.length === 0, violations });
    if (parsed.ok && violations.length === 0) {
      record.status = "answered";
      record.answer = parsed.answer;
      return reply("Answer accepted and shown to the customer. The conversation is finished: end your turn now, without calling a tool or writing anything else.");
    }
    if (retries >= LIMITS.retries) {
      const h = handoffAnswer(opts.question, "rules");
      record.status = "handoff";
      record.reason = "rules";
      record.answer = h.answer;
      return reply(`Your answer was not sent. The customer has been handed to a person (ticket ${h.ticketId}). End your turn now.`, true);
    }
    retries++;
    return reply(`Your answer was not sent. Fix these and call submit_answer again:\n${violations.map((v) => `- ${v.detail}`).join("\n")}`, true);
  }

  async function call(name: string, args: Record<string, unknown> = {}): Promise<McpResult> {
    if (record.status !== "pending") return reply("This conversation is finished. End your turn now.", true);
    if (name === "submit_answer") {
      const r = await submit(args);
      changed();
      return r;
    }
    if (toolCalls >= LIMITS.toolCalls) return reply("Tool budget used up. Call submit_answer now with what you have.", true);
    toolCalls++;
    let result: unknown;
    try {
      result = await runTool(name, args, opts.deps);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const ok = (result as { ok?: boolean }).ok !== false;
    if (ok) absorb(evidence, name, args, result);
    record.toolCalls.push({ n: toolCalls, name, input: args, ok, summary: summarize(name, result) });
    changed();
    return reply(JSON.stringify(result), !ok);
  }

  return { tools, call, record: () => record };
}
