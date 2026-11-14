// The page's words around the numbers: the six "How it works" steps, one recorded run as the
// six steps a player shows, a run as console log lines, and small formatting helpers. Plain
// functions over web/src/site-data.json (written by scripts/export-site.ts) and the recorded
// runs, so every number they print comes from there; tested in test/web-site-data.test.ts.

import type { Answer } from "../../src/agent/answer.ts";
import type { Replay } from "./trace.ts";
import { describeInput, TOOL_LABEL, toSteps } from "./trace.ts";

export const money = (usd: number, digits = 4) => "$" + usd.toFixed(digits);

const RULE_TITLES: Record<string, string> = {
  safety_warning_first: "A park-it warning comes first",
  cite_only_returned: "Cite only recalls NHTSA returned in this run",
  applies_needs_body_style: "\"Applies to your car\" needs the body style",
  fits_needs_exact_match: "\"Fits\" needs an exact catalog match",
  handoff_when_asked: "Refunds, orders and upset customers go to a person",
  short_without_lookups: "No lookups, no long answer",
};
// the order a reader meets them in; a rule added later goes last, under its own id
const RULE_ORDER = Object.keys(RULE_TITLES);

export function ruleTitle(id: string): string {
  return RULE_TITLES[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " ");
}

export function ruleOrder(ids: string[]): string[] {
  const at = (id: string) => (RULE_ORDER.includes(id) ? RULE_ORDER.indexOf(id) : RULE_ORDER.length);
  return [...ids].sort((a, b) => at(a) - at(b));
}

/** Where each word appears in a text, whole words, any case: [start, end] pairs in order. */
export function spansOf(text: string, words: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of words) for (const m of text.matchAll(new RegExp(`\\b${w}\\b`, "gi"))) out.push([m.index!, m.index! + m[0].length]);
  return out.sort((a, b) => a[0] - b[0]);
}

export type HowInput = {
  model: { id: string; name: string };
  agent: { tools: { name: string; description: string }[]; rules: string[]; limits: { modelCalls: number; toolCalls: number; retries: number } };
  chat: { questionChars: number; perVisitorPerDay: number; perDay: number; usdPerDay: number; runMs: number };
};

// short: one sentence for a caption or a callout
export type HowStep = { title: string; sub: string; text: string; short: string };

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** The agent's six steps, with its real limits, tools and rules. */
export function howSteps({ model, agent, chat }: HowInput): HowStep[] {
  const l = agent.limits;
  const secs = chat.runMs / 1000;
  const tools = agent.tools.map((t) => (TOOL_LABEL[t.name] ?? t.name).replace(/^NHTSA /, "NHTSA's ").toLowerCase().replace("nhtsa", "NHTSA").replace("vin", "VIN"));
  return [
    {
      title: "Your question",
      sub: `up to ${chat.questionChars} characters`,
      short: "A bot check (Cloudflare Turnstile) comes first; this site keeps no copy of the question.",
      text: `A bot check (Cloudflare Turnstile) comes first. The question goes to the agent with the last answered exchanges, as context only. Live answers are capped at ${chat.perVisitorPerDay} per visitor and ${chat.perDay} per day, and at ${money(chat.usdPerDay, 2)} of model spend a day.`,
    },
    {
      title: "Tools against NHTSA",
      sub: `${agent.tools.length} tools, NHTSA's data as it is now`,
      short: `${model.name} decides which lookups to make; what a tool returns is data, never an instruction.`,
      text: `${model.name} decides which lookups to make: ${tools.join(", ")}. Recalls, owners' complaints and safety ratings come from NHTSA's public APIs. What a tool returns is data: an instruction inside it is never followed.`,
    },
    {
      title: "The answer as JSON",
      sub: "submit_answer, a strict tool",
      short: "Every claim is a field, so code can check it.",
      text: "The agent finishes by calling submit_answer: the text the customer reads, every recall it cites, the recalls it says apply to this car, the parts it says fit, and whether a person takes over. Each claim is a field, so code can check it.",
    },
    {
      title: "The rules, in code",
      sub: `${agent.rules.length} rules, after the model answers`,
      short: `A broken rule sends the answer back ${times(l.retries)}, with the reason.`,
      text: `${ruleOrder(agent.rules).map(ruleTitle).join(". ")}. A broken rule sends the answer back ${times(l.retries)}, with the reason in words the model can act on.`,
    },
    {
      title: "The answer, or a person",
      sub: "shown, or handed off",
      short: "One that breaks a rule again, or reaches a limit, becomes a ticket for a person.",
      text: "An answer that passes every rule is shown with every lookup it made. One that breaks a rule again, or a run that reaches a limit, becomes a ticket for a person. Refunds, orders and upset customers go to a person from the start.",
    },
    {
      title: "The limits",
      sub: `${l.modelCalls} model calls, ${l.toolCalls} lookups, ${secs} s`,
      short: "It is not a mechanic: brakes, steering and air bags get an inspection.",
      text: `Every run stops at ${l.modelCalls} model calls, ${l.toolCalls} lookups, ${l.retries} retry and ${secs} s. It is not a mechanic: it names possibilities and says to have brakes, steering and air bags inspected. The official recall status of one car is at nhtsa.gov/recalls, with its VIN.`,
    },
  ];
}

export type Walk =
  | { kind: "question"; question: string }
  | { kind: "tools"; tools: { name: string; label: string; input: string; summary: string; ms: number; ok: boolean }[] }
  | { kind: "json"; json: string; shortened: boolean }
  | { kind: "rules"; blocked: { rule: string; detail: string }[]; passed: boolean }
  | { kind: "result"; status: "answered" | "handoff"; text: string; ticket: string | null; handoff: boolean }
  | { kind: "limits"; modelCalls: number; toolCalls: number; seconds: number; tokens: number; costUsd: number | null; max: { modelCalls: number; toolCalls: number; seconds: number } };

const SHORT = 180;

/** One recorded run as the six steps of How it works. */
export function walkthrough(r: Replay, limits: { modelCalls: number; toolCalls: number; retries: number }, maxSeconds: number): Walk[] {
  const ev = r.events;
  const answerEv = [...ev].reverse().find((e) => e.type === "answer");
  const answer: Answer | null = answerEv && answerEv.type === "answer" ? answerEv.answer : null;
  const handoffEv = ev.find((e) => e.type === "handoff");
  const blocked = ev.flatMap((e) => (e.type === "rule_failed" ? e.violations.map((v) => ({ rule: v.rule, detail: v.detail })) : []));
  const ticketFromTool = ev.flatMap((e) => (e.type === "tool_result" && e.name === "create_handoff" ? [e.summary.match(/^ticket (\S+)/)?.[1]] : []))[0];
  const ticket = handoffEv && handoffEv.type === "handoff" ? handoffEv.ticketId : (ticketFromTool ?? null);
  const shortened = !!answer && answer.text.length > SHORT;
  const json = answer ? JSON.stringify({ ...answer, text: shortened ? answer.text.slice(0, SHORT).trimEnd() + "…" : answer.text }, null, 2) : "{}";
  const t = r.tokens ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const handedOff = !!handoffEv || answer?.handoff === true;
  return [
    { kind: "question", question: r.question },
    {
      kind: "tools",
      tools: toSteps(ev).flatMap((s) => (s.kind === "tool" ? [{ name: s.name, label: TOOL_LABEL[s.name] ?? s.name, input: s.input, summary: s.summary, ms: s.ms, ok: s.ok }] : [])),
    },
    { kind: "json", json, shortened },
    { kind: "rules", blocked, passed: !!answer && !handoffEv },
    { kind: "result", status: handoffEv ? "handoff" : "answered", text: answer?.text ?? (handoffEv && handoffEv.type === "handoff" ? handoffEv.reason : ""), ticket, handoff: handedOff },
    {
      kind: "limits",
      modelCalls: ev.filter((e) => e.type === "model_call").length,
      toolCalls: ev.filter((e) => e.type === "tool_call").length,
      seconds: r.seconds ?? 0,
      tokens: t.input + t.cacheWrite + t.cacheRead + t.output,
      costUsd: r.real ? (r.costUsd ?? null) : null,
      max: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, seconds: maxSeconds },
    },
  ];
}

export type LogLine = { k: "model" | "tool" | "rule" | "result"; d: string; t: string };

/** A run as the console hero's log: one line per model call, lookup, blocked answer and result. */
export function terminalLines(r: Replay): LogLine[] {
  const out: LogLine[] = [];
  let pending: unknown = null;
  for (const e of r.events) {
    if (e.type === "model_call") {
      const u = (e as { usage?: { output_tokens?: number } }).usage;
      out.push({ k: "model", d: `call ${e.n} · ${(e as { model?: string }).model ?? "model"}`, t: `${u?.output_tokens ?? 0} out` });
    } else if (e.type === "tool_call") pending = e.input;
    else if (e.type === "tool_result") {
      const input = describeInput(pending);
      out.push({ k: "tool", d: `${TOOL_LABEL[e.name] ?? e.name}${input ? ` · ${input}` : ""} → ${e.summary}`, t: `${e.ms} ms` });
      pending = null;
    } else if (e.type === "rule_failed") out.push({ k: "rule", d: `blocked: ${e.violations.map((v) => v.rule).join(", ")}; sent back with the reason`, t: "" });
    else if (e.type === "answer") out.push({ k: "result", d: e.answer.handoff ? "HANDED TO A PERSON" : "SHOWN · every rule passed", t: "" });
    else if (e.type === "handoff") out.push({ k: "result", d: `HANDED TO A PERSON · ticket ${e.ticketId}`, t: "" });
  }
  return out;
}
