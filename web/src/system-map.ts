// The system map's pure part: the graph of the whole system (who asks, what serves the page,
// what runs the request, what can refuse it, the agent loop, the model, each tool with the data
// it reads, the rules, and the two ways a run ends), and which node and edge each event of a run
// lights, with a caption. No React, no DOM, so test/web-system-map.test.ts checks it with
// node --test. shared/SystemMap.tsx draws it and moves a packet along the lit edge.
//
// Driven by the same events the trace panel reads (src/agent/loop.ts TraceEvent), plus the
// live stream's start, done and error (src/server/ask.ts AskEvent). Every number in a caption
// comes from the event or from the context (site-data.json, src/server/limits.ts); none is
// typed here. A run read so far always maps to a prefix of the whole run's beats, so a live
// answer can light the map up as it streams.

import type { AskEvent } from "../../src/server/ask.ts";
import { describeInput, TOOL_LABEL, type Replay } from "./trace.ts";
import { money, ruleOrder, ruleTitle } from "./site.ts";

export type MapEvent = AskEvent;

export type MapCtx = {
  model: { id: string; name: string };
  tools: { name: string; description: string }[];
  rules: string[];
  limits: { modelCalls: number; toolCalls: number; retries: number };
  chat: { perVisitorPerDay: number; perDay: number; usdPerDay: number; runMs: number };
  // "replay": a recorded run, whose lookups read recorded NHTSA replies; "live": the chat
  mode: "replay" | "live";
};

export type NodeKind = "person" | "edge" | "server" | "gate" | "agent" | "model" | "tool" | "source" | "rules" | "outcome";
export type MapNode = { id: string; kind: NodeKind; label: string; sub: string; info: string };
export type MapEdge = { id: string; from: string; to: string };

/* ---------------------------------------------------------------- where each tool reads */

// The endpoint each tool calls, as written in src/tools/nhtsa.ts (the test checks each path is
// there), the store's catalog file, and the handoff, which only makes a ticket.
export const SOURCES: Record<string, { label: string; host: string; path: string; info: string }> = {
  decode_vehicle: {
    label: "NHTSA vPIC",
    host: "vpic.nhtsa.dot.gov",
    path: "/DecodeVinValues/",
    info: "NHTSA's vPIC decoder, which turns a 17-character VIN into make, model, year and body style.",
  },
  list_models: {
    label: "NHTSA vPIC",
    host: "vpic.nhtsa.dot.gov",
    path: "/GetModelsForMakeYear/",
    info: "NHTSA's vPIC list of model names for a make and year, so the agent asks for a model the way NHTSA spells it.",
  },
  get_recalls: {
    label: "NHTSA recalls API",
    host: "api.nhtsa.gov",
    path: "/recalls/recallsByVehicle",
    info: "NHTSA's recall list for a make, model and year: the only place a recall number in an answer may come from.",
  },
  search_complaints: {
    label: "NHTSA complaints API",
    host: "api.nhtsa.gov",
    path: "/complaints/complaintsByVehicle",
    info: "Owners' complaints filed with NHTSA for one vehicle; a complaint is not a recall, and the answer has to say so.",
  },
  get_safety_rating: {
    label: "NHTSA 5-Star ratings",
    host: "api.nhtsa.gov",
    path: "/SafetyRatings/",
    info: "NHTSA's 5-Star crash ratings, one set for each variant of a vehicle.",
  },
  search_catalog: {
    label: "Store catalog",
    host: "this repository",
    path: "data/catalog.json",
    info: "The fictional store's parts catalog, a file in the repository: a part fits only when it lists the car's year, model and body style.",
  },
  create_handoff: {
    label: "Ticket for a person",
    host: "the page",
    path: "ticket",
    info: "A ticket a person would pick up, returned to the page to show what they would receive; it is not stored.",
  },
};

const sourceOf = (tool: string) => SOURCES[tool] ?? { label: "data", host: "", path: "", info: "The data this tool reads." };
const labelOf = (tool: string) => TOOL_LABEL[tool] ?? tool;
const n = (x: number) => x.toLocaleString("en-US");
const plural = (k: number, one: string, many = one + "s") => `${n(k)} ${k === 1 ? one : many}`;
const times = (k: number) => (k === 1 ? "once" : `${k} times`);
const secs = (ctx: MapCtx) => ctx.chat.runMs / 1000;

/* ---------------------------------------------------------------- the graph */

export function mapGraph(ctx: MapCtx): { nodes: MapNode[]; edges: MapEdge[] } {
  const c = ctx.chat, l = ctx.limits;
  const rules = ruleOrder(ctx.rules);
  const nodes: MapNode[] = [
    { id: "visitor", kind: "person", label: "Visitor", sub: "browser", info: "The visitor's browser: it sends the question and shows each step as it streams back, and the site keeps no copy of the question." },
    { id: "cdn", kind: "edge", label: "CloudFront", sub: "page + /api", info: "CloudFront serves the page from a private S3 bucket and signs each /api call to the Lambda function, which accepts nothing else." },
    { id: "lambda", kind: "server", label: "AWS Lambda", sub: "one function", info: "One AWS Lambda function runs the whole request: the bot check, the counters, the agent loop, and the stream of events back to the page." },
    { id: "turnstile", kind: "gate", label: "Turnstile", sub: "bot check", info: "Cloudflare Turnstile checks that a person is asking before anything is spent; a failed check ends the request there." },
    {
      id: "limits",
      kind: "gate",
      label: "Limits",
      sub: `${c.perVisitorPerDay} a visitor a day · ${c.perDay} a day · ${money(c.usdPerDay, 2)} a day`,
      info: `Counters in DynamoDB allow ${c.perVisitorPerDay} a visitor a day and ${c.perDay} a day in all, and live answers stop at ${money(c.usdPerDay, 2)} of model spend a day.`,
    },
    {
      id: "loop",
      kind: "agent",
      label: "Agent loop",
      sub: `${l.modelCalls} calls · ${l.toolCalls} lookups · ${secs(ctx)} s`,
      info: `A hand-written loop that calls the model, runs the lookups it asks for and checks its answer; it stops at ${l.modelCalls} model calls, ${l.toolCalls} lookups or ${secs(ctx)} s, and sends an answer back ${times(l.retries)} at most.`,
    },
    { id: "model", kind: "model", label: ctx.model.name, sub: "decides each lookup", info: `${ctx.model.name} decides which lookups to make and writes the answer as JSON through submit_answer; it never reaches NHTSA itself.` },
    ...ctx.tools.flatMap((t): MapNode[] => [
      { id: `tool:${t.name}`, kind: "tool", label: labelOf(t.name), sub: t.name, info: `What the model is told about ${t.name}: ${t.description.replace(/\.?$/, ".")}` },
      { id: `src:${t.name}`, kind: "source", label: sourceOf(t.name).label, sub: sourceOf(t.name).path, info: sourceOf(t.name).info },
    ]),
    {
      id: "rules",
      kind: "rules",
      label: `${rules.length} rules`,
      sub: "code, after the model",
      info: `Code, not the model, checks every answer against ${rules.length} rules (${rules.map((r) => ruleTitle(r).replace(/^./, (c) => c.toLowerCase())).join("; ")}), and a broken one sends it back ${times(l.retries)}.`,
    },
    { id: "answer", kind: "outcome", label: "Answer shown", sub: "every rule passed", info: "An answer that passed every rule, shown to the customer with every lookup it made." },
    { id: "handoff", kind: "outcome", label: "A person", sub: "ticket", info: "A person takes over for refunds, orders and upset customers, and for any run that breaks a rule again or reaches a limit." },
  ];
  const e = (from: string, to: string): MapEdge => ({ id: `${from}>${to}`, from, to });
  const edges: MapEdge[] = [
    e("visitor", "cdn"),
    e("cdn", "lambda"),
    e("lambda", "turnstile"),
    e("lambda", "limits"),
    e("lambda", "loop"),
    e("loop", "model"),
    ...ctx.tools.flatMap((t) => [e("loop", `tool:${t.name}`), e(`tool:${t.name}`, `src:${t.name}`)]),
    e("loop", "rules"),
    e("rules", "answer"),
    e("rules", "handoff"),
    e("loop", "handoff"),
  ];
  return { nodes, edges };
}

/* ---------------------------------------------------------------- events -> beats */

export type Tone = "flow" | "ok" | "bad";
// One step of the animation: the node that lights, the edge the packet travels (back = from the
// edge's end to its start), and what the caption says. note: a result to write on a node.
export type Beat = { node: string; edge: string | null; back: boolean; tone: Tone; caption: string; note?: { node: string; text: string } };

const beat = (node: string, edge: string | null, caption: string, tone: Tone = "flow", back = false, note?: Beat["note"]): Beat =>
  note ? { node, edge, back, tone, caption, note } : { node, edge, back, tone, caption };

/** The way into the system for a live question: CloudFront, the Lambda, Turnstile, the limits, the loop. */
export function entryBeats(ctx: MapCtx, left: number | null = null): Beat[] {
  const c = ctx.chat, l = ctx.limits;
  const replay = ctx.mode === "replay";
  return [
    beat(
      "cdn",
      "visitor>cdn",
      replay
        ? "A live question leaves the browser for CloudFront. This recorded run was made from the command line, so its first stop was the agent loop."
        : "The question leaves the browser for CloudFront, which passes /api calls to the Lambda function.",
    ),
    beat("lambda", "cdn>lambda", "CloudFront signs the request; the Lambda function accepts nothing that skipped it."),
    beat("turnstile", "lambda>turnstile", "Cloudflare Turnstile confirms a person is asking, before anything is spent."),
    beat(
      "limits",
      "lambda>limits",
      `Counters: ${c.perVisitorPerDay} a visitor a day, ${c.perDay} a day, ${money(c.usdPerDay, 2)} of model spend a day${left !== null ? `; ${left} left today` : ""}.`,
    ),
    beat("loop", "lambda>loop", `The agent loop starts: at most ${l.modelCalls} model calls, ${l.toolCalls} lookups and ${secs(ctx)} s.`),
  ];
}

const ERROR_NODE: Record<string, string> = {
  bot_check: "turnstile",
  visitor_limit: "limits",
  daily_limit: "limits",
  budget: "model",
  busy: "model",
  not_live: "lambda",
  bad_request: "lambda",
  failed: "lambda",
};

type Memo = { pending: { name: string; input: unknown } | null; ticket: string | null };

function beatsOf(e: MapEvent, ctx: MapCtx, m: Memo): Beat[] {
  const l = ctx.limits;
  switch (e.type) {
    case "start":
      return entryBeats(ctx, e.left);
    case "model_call": {
      const out = e.usage?.output_tokens;
      return [beat("model", "loop>model", `Model call ${e.n} of ${l.modelCalls}: ${ctx.model.name} reads what it has so far${out !== undefined ? ` and writes ${plural(out, "token")}` : ""}.`)];
    }
    case "tool_call": {
      m.pending = { name: e.name, input: e.input };
      const s = sourceOf(e.name);
      const input = describeInput(e.input);
      const where = e.name === "search_catalog" || e.name === "create_handoff" ? `${s.label} (${s.path})` : `${s.label}, ${s.path}${ctx.mode === "replay" ? " (a recorded reply)" : ""}`;
      return [
        beat(`tool:${e.name}`, `loop>tool:${e.name}`, `${ctx.model.name} asks for ${labelOf(e.name)}${input ? `: ${input}` : ""}.`),
        beat(`src:${e.name}`, `tool:${e.name}>src:${e.name}`, `The lookup goes to ${where}.`),
      ];
    }
    case "tool_result": {
      m.pending = null;
      const t = e.summary.match(/^ticket (\S+)/);
      if (t) m.ticket = t[1];
      const text = `${e.summary} · ${n(e.ms)} ms`;
      return [beat(`tool:${e.name}`, `tool:${e.name}>src:${e.name}`, `${labelOf(e.name)} returns ${e.summary} in ${n(e.ms)} ms; the loop hands it to the model as data.`, e.ok ? "ok" : "bad", true, { node: `tool:${e.name}`, text })];
    }
    case "rule_failed": {
      const titles = e.violations.map((v) => ruleTitle(v.rule));
      const detail = e.violations[0]?.detail ?? "";
      return [
        beat("rules", "loop>rules", `submit_answer: the answer reaches the rules. Broken: ${[...new Set(titles)].join("; ")}.`, "bad"),
        beat("loop", "loop>rules", `Sent back ${times(l.retries)}, with the rule's words: "${detail}"`, "bad", true),
      ];
    }
    case "answer": {
      const a = e.answer;
      const pass = beat("rules", "loop>rules", `submit_answer: all ${ctx.rules.length} rules pass.`, "ok");
      if (a.handoff)
        return [pass, beat("handoff", "rules>handoff", `Handed to a person${m.ticket ? `, ticket ${m.ticket}` : ""}; the customer is told who takes it from here.`, "ok")];
      const claims = [
        a.cited_recall_ids.length ? `cites ${plural(a.cited_recall_ids.length, "recall")}` : "",
        a.applies_to_vehicle.length ? `says ${plural(a.applies_to_vehicle.length, "recall")} apply` : "",
        a.fits.length ? `confirms ${plural(a.fits.length, "part")} fit` : "",
      ].filter(Boolean);
      return [pass, beat("answer", "rules>answer", `Shown to the customer${claims.length ? `: it ${claims.join(", ")}, each checked` : ", with every lookup it made"}.`, "ok")];
    }
    case "handoff": {
      const why = {
        rules: "The answer broke a rule again",
        cap: `The run reached a limit (${l.modelCalls} model calls or ${l.toolCalls} lookups)`,
        time: `The run passed ${secs(ctx)} s`,
        refusal: "The model declined to answer",
        no_answer: "No answer came through submit_answer",
      }[e.reason];
      return [beat("handoff", e.reason === "rules" ? "rules>handoff" : "loop>handoff", `${why}: handed to a person, ticket ${e.ticketId}.`, "bad")];
    }
    case "done": {
      const t = e.tokens.input + e.tokens.cacheWrite + e.tokens.cacheRead + e.tokens.output;
      return [beat("visitor", null, doneLine(e.modelCalls, e.toolCalls, t, e.costUsd, e.seconds), "ok")];
    }
    case "error":
      return [beat(ERROR_NODE[e.code] ?? "lambda", null, e.message, "bad")];
  }
  return [];
}

const doneLine = (modelCalls: number, toolCalls: number, tokens: number, cost: number | null, seconds: number) =>
  `Back to the visitor: ${plural(modelCalls, "model call")}, ${plural(toolCalls, "lookup")}, ${plural(tokens, "token")}, ${cost === null ? "cost unknown" : money(cost)}, ${seconds.toFixed(1)} s.`;

/** Every beat of a run, in order. A run read so far gives a prefix of the whole run's beats. */
export function mapBeats(events: MapEvent[], ctx: MapCtx): Beat[] {
  const m: Memo = { pending: null, ticket: null };
  return events.flatMap((e) => beatsOf(e, ctx, m));
}

/* ---------------------------------------------------------------- what is lit after k beats */

export type MapState = {
  active: Beat | null;
  // every node and edge a beat has reached so far, the active one included
  nodes: string[];
  edges: string[];
  // each node's last outcome, when it had one
  status: Record<string, "ok" | "bad">;
  // the result a tool returned, written on its node
  notes: Record<string, string>;
};

export function mapState(beats: Beat[], k: number): MapState {
  const nodes = new Set<string>(), edges = new Set<string>();
  const status: MapState["status"] = {};
  const notes: MapState["notes"] = {};
  const upto = Math.min(k, beats.length - 1);
  for (let i = 0; i <= upto; i++) {
    const b = beats[i];
    nodes.add(b.node);
    if (b.edge) {
      edges.add(b.edge);
      for (const end of b.edge.split(">")) nodes.add(end);
    }
    // an answer sent back lands on the loop; that is the rules' catch (shown on the rules), not a fault in the loop
    if (b.tone !== "flow" && !(b.back && b.node === "loop")) status[b.node] = b.tone;
    if (b.note) notes[b.note.node] = b.note.text;
  }
  return { active: upto >= 0 ? beats[upto] : null, nodes: [...nodes], edges: [...edges], status, notes };
}

/* ---------------------------------------------------------------- the tour */

export type TourStep = Beat & { title: string; info: string };

/** A recorded run as a guided tour: the way in, every beat of the run, and its measured totals. */
export function tourFor(r: Replay, ctx: MapCtx): TourStep[] {
  const c: MapCtx = { ...ctx, mode: "replay" };
  const { nodes } = mapGraph(c);
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const t = r.tokens ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const count = (type: string) => r.events.filter((e) => e.type === type).length;
  const beats = [
    ...entryBeats(c),
    ...mapBeats(r.events, c),
    beat("visitor", null, doneLine(count("model_call"), count("tool_call"), t.input + t.cacheWrite + t.cacheRead + t.output, r.real ? (r.costUsd ?? null) : 0, r.seconds ?? 0), "ok"),
  ];
  return beats.map((b) => ({ ...b, title: byId.get(b.node)?.label ?? b.node, info: byId.get(b.node)?.info ?? "" }));
}

/* ---------------------------------------------------------------- the Examples tab's pace */

const ROW_EVENTS = new Set(["tool_result", "rule_failed", "answer", "handoff"]);

/** The events behind the first k trace rows: everything before the event that makes row k + 1. */
export function eventsThroughStep(events: MapEvent[], k: number): MapEvent[] {
  let rows = 0;
  for (let i = 0; i < events.length; i++) {
    if (!ROW_EVENTS.has(events[i].type)) continue;
    if (rows === k) return events.slice(0, i);
    rows++;
  }
  return events;
}
