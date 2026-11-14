// The system map every layout shows: an SVG graph of the whole system (the visitor,
// CloudFront, the Lambda, Turnstile, the limits, the agent loop, the model, each tool with its
// data source, the rules, and the answer or a person), lit step by step from the same event
// stream the trace panel reads. These tests check the pure part (web/src/system-map.ts): which
// node and edge each event lights and what the caption says. Every number in a caption must
// come from the event or the context it was given, so the context here is made up on purpose
// (7 a visitor a day, not 5) and a changed input has to show up as a changed caption.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { entryBeats, eventsThroughStep, mapBeats, mapGraph, mapState, SOURCES, tourFor, type MapCtx } from "../web/src/system-map.ts";
import { toSteps, type Replay } from "../web/src/trace.ts";

const ROOT = join(import.meta.dirname, "..");
const replay = (name: string) => JSON.parse(readFileSync(join(ROOT, "web", "src", "replays", `${name}.json`), "utf8")) as Replay;

const TOOLS = ["decode_vehicle", "list_models", "get_recalls", "search_complaints", "get_safety_rating", "search_catalog", "create_handoff"];
const ctx: MapCtx = {
  model: { id: "m-1", name: "Test Model 9" },
  tools: TOOLS.map((name) => ({ name, description: `what ${name} does` })),
  rules: ["short_without_lookups", "cite_only_returned", "applies_needs_body_style", "fits_needs_exact_match", "safety_warning_first", "handoff_when_asked"],
  limits: { modelCalls: 6, toolCalls: 12, retries: 1 },
  chat: { perVisitorPerDay: 7, perDay: 41, usdPerDay: 0.35, runMs: 45_000 },
  mode: "live",
};
const answer = (extra: Record<string, unknown> = {}) => ({
  type: "answer" as const,
  answer: { text: "ok", cited_recall_ids: ["17V706000", "18V022000"], applies_to_vehicle: [], fits: [], handoff: false, ...extra },
});

test("the graph has every piece of the system, each tool with its own data source", () => {
  const { nodes, edges } = mapGraph(ctx);
  const ids = nodes.map((n) => n.id);
  for (const id of ["visitor", "cdn", "lambda", "turnstile", "limits", "loop", "model", "rules", "answer", "handoff"]) assert.ok(ids.includes(id), id);
  for (const t of TOOLS) {
    assert.ok(ids.includes(`tool:${t}`), `tool ${t}`);
    assert.ok(ids.includes(`src:${t}`), `source of ${t}`);
    assert.ok(edges.some((e) => e.id === `loop>tool:${t}`), `loop reaches ${t}`);
    assert.ok(edges.some((e) => e.id === `tool:${t}>src:${t}`), `${t} reaches its source`);
  }
  for (const e of edges) {
    assert.ok(ids.includes(e.from) && ids.includes(e.to), `edge ${e.id} joins two nodes`);
    assert.equal(e.id, `${e.from}>${e.to}`);
  }
  // every node says in one sentence what it is
  for (const n of nodes) assert.match(n.info, /^[A-Z0-9].+\.$/, `${n.id} has a sentence`);
  const node = (id: string) => nodes.find((n) => n.id === id)!;
  assert.equal(node("model").label, "Test Model 9");
  assert.match(node("limits").sub + node("limits").info, /7 a visitor/);
  assert.match(node("limits").sub + node("limits").info, /41 a day/);
  assert.match(node("limits").sub + node("limits").info, /\$0\.35/);
  assert.match(node("tool:get_recalls").info, /what get_recalls does/, "a tool says what the model is told it does");
  assert.match(node("rules").info, /6 rules/);
  assert.match(node("loop").info, /6 model calls, 12 lookups/);
});

// The map names real endpoints: each NHTSA path must be in the tool code that calls it, and the
// catalog must be the file the catalog tool reads.
test("each source names the endpoint the tool really calls", () => {
  const nhtsa = readFileSync(join(ROOT, "src", "tools", "nhtsa.ts"), "utf8");
  for (const t of ["decode_vehicle", "list_models", "get_recalls", "search_complaints", "get_safety_rating"]) {
    const s = SOURCES[t];
    assert.ok(s, t);
    assert.ok(nhtsa.includes(s.path), `${t}: ${s.path} is in src/tools/nhtsa.ts`);
  }
  assert.ok(nhtsa.includes(SOURCES.decode_vehicle.host) && nhtsa.includes(SOURCES.get_recalls.host));
  assert.ok(existsSync(join(ROOT, SOURCES.search_catalog.path)), "the catalog file exists");
  assert.ok(readFileSync(join(ROOT, "src", "tools", "catalog.ts"), "utf8").includes(SOURCES.search_catalog.path.replace(/^data\//, "")));
});

test("a live question's start walks the path in: CloudFront, the Lambda, Turnstile, the limits, the loop", () => {
  const beats = mapBeats([{ type: "start", left: 3 }], ctx);
  assert.deepEqual(
    beats.map((b) => [b.node, b.edge]),
    [
      ["cdn", "visitor>cdn"],
      ["lambda", "cdn>lambda"],
      ["turnstile", "lambda>turnstile"],
      ["limits", "lambda>limits"],
      ["loop", "lambda>loop"],
    ],
  );
  assert.match(beats[3].caption, /3 left today/);
  assert.match(beats[4].caption, /6 model calls/);
});

test("a model call lights the model, with its own number and output tokens", () => {
  const [b] = mapBeats([{ type: "model_call", n: 2, stopReason: "tool_use", model: "m-1", usage: { input_tokens: 10, output_tokens: 803 } }], ctx);
  assert.equal(b.node, "model");
  assert.equal(b.edge, "loop>model");
  assert.match(b.caption, /call 2 of 6/);
  assert.match(b.caption, /803 tokens/);
  assert.match(b.caption, /Test Model 9/);
});

test("a lookup goes out to the tool and its source, and the result comes back with the tool's numbers", () => {
  const beats = mapBeats(
    [
      { type: "tool_call", n: 1, name: "get_recalls", input: { make: "Ford", model: "Ranger", year: 2006 } },
      { type: "tool_result", name: "get_recalls", ok: true, summary: "12 recalls", ms: 12 },
    ],
    ctx,
  );
  assert.deepEqual(
    beats.map((b) => [b.node, b.edge, b.back]),
    [
      ["tool:get_recalls", "loop>tool:get_recalls", false],
      ["src:get_recalls", "tool:get_recalls>src:get_recalls", false],
      ["tool:get_recalls", "tool:get_recalls>src:get_recalls", true],
    ],
  );
  assert.match(beats[0].caption, /2006 Ford Ranger/);
  assert.match(beats[1].caption, /recallsByVehicle/);
  assert.match(beats[2].caption, /12 recalls/);
  assert.match(beats[2].caption, /12 ms/);
  assert.equal(beats[2].tone, "ok");
  assert.deepEqual(beats[2].note, { node: "tool:get_recalls", text: "12 recalls · 12 ms" });
  // a failed lookup is shown as one
  const [, , bad] = mapBeats(
    [
      { type: "tool_call", n: 1, name: "get_recalls", input: {} },
      { type: "tool_result", name: "get_recalls", ok: false, summary: "error: NHTSA answered 503", ms: 40 },
    ],
    ctx,
  );
  assert.equal(bad.tone, "bad");
});

test("a broken rule lights the rules red and sends the answer back to the loop once", () => {
  const beats = mapBeats([{ type: "rule_failed", violations: [{ rule: "safety_warning_first", detail: "Open with the warning." }] }], ctx);
  assert.deepEqual(
    beats.map((b) => [b.node, b.edge, b.back, b.tone]),
    [
      ["rules", "loop>rules", false, "bad"],
      ["loop", "loop>rules", true, "bad"],
    ],
  );
  assert.match(beats[0].caption, /A park-it warning comes first/);
  assert.match(beats[1].caption, /once/);
  assert.match(beats[1].caption, /Open with the warning\./);
});

test("an answer that passes every rule is shown; one with handoff goes to a person with its ticket", () => {
  const shown = mapBeats([answer()], ctx);
  assert.deepEqual(
    shown.map((b) => [b.node, b.edge, b.tone]),
    [
      ["rules", "loop>rules", "ok"],
      ["answer", "rules>answer", "ok"],
    ],
  );
  assert.match(shown[0].caption, /all 6 rules/);
  assert.match(shown[1].caption, /2 recalls/);

  const handed = mapBeats(
    [
      { type: "tool_call", n: 1, name: "create_handoff", input: { reason: "refund" } },
      { type: "tool_result", name: "create_handoff", ok: true, summary: "ticket HO-157597", ms: 0 },
      answer({ handoff: true, cited_recall_ids: [] }),
    ],
    ctx,
  );
  const last = handed.at(-1)!;
  assert.equal(last.node, "handoff");
  assert.equal(last.edge, "rules>handoff");
  assert.match(last.caption, /HO-157597/);
});

test("the loop's own handoff: after a second broken rule through the rules, at a limit straight from the loop", () => {
  const [byRules] = mapBeats([{ type: "handoff", ticketId: "HO-111111", reason: "rules" }], ctx);
  assert.deepEqual([byRules.node, byRules.edge, byRules.tone], ["handoff", "rules>handoff", "bad"]);
  assert.match(byRules.caption, /HO-111111/);
  const [byCap] = mapBeats([{ type: "handoff", ticketId: "HO-222222", reason: "cap" }], ctx);
  assert.deepEqual([byCap.node, byCap.edge], ["handoff", "loop>handoff"]);
  assert.match(byCap.caption, /HO-222222/);
  assert.match(byCap.caption, /limit/);
  const [byTime] = mapBeats([{ type: "handoff", ticketId: "HO-3", reason: "time" }], ctx);
  assert.match(byTime.caption, /45 s/);
});

test("done returns to the visitor with the run's own totals; an error lights the piece that refused", () => {
  const [done] = mapBeats(
    [{ type: "done", status: "answered", costUsd: 0.09606, tokens: { input: 12365, cacheWrite: 2826, cacheRead: 5652, output: 1567 }, modelCalls: 3, toolCalls: 1, seconds: 16.3 }],
    ctx,
  );
  assert.equal(done.node, "visitor");
  assert.match(done.caption, /3 model calls/);
  assert.match(done.caption, /1 lookup\b/);
  assert.match(done.caption, /22,410 tokens/);
  assert.match(done.caption, /\$0\.0961/);
  assert.match(done.caption, /16\.3 s/);
  const where = (code: string) => mapBeats([{ type: "error", code: code as never, message: `m-${code}` }], ctx)[0];
  assert.equal(where("bot_check").node, "turnstile");
  assert.equal(where("visitor_limit").node, "limits");
  assert.equal(where("daily_limit").node, "limits");
  assert.equal(where("busy").node, "model");
  assert.equal(where("failed").node, "lambda");
  assert.equal(where("bot_check").tone, "bad");
  assert.equal(where("bot_check").caption, "m-bot_check");
});

test("a stream read so far maps to a prefix of the whole run's beats, so a live answer can light up as it streams", () => {
  for (const name of ["real-safety", "real-refund", "real-brakes", "guard"]) {
    const events = replay(name).events;
    const all = mapBeats(events, { ...ctx, mode: "replay" });
    for (let k = 0; k <= events.length; k++) {
      const part = mapBeats(events.slice(0, k), { ...ctx, mode: "replay" });
      assert.deepEqual(part, all.slice(0, part.length), `${name}, first ${k} events`);
    }
  }
});

test("the Ranger park-it run: one lookup, the rules send it back once, the retry is shown", () => {
  const r = replay("real-safety");
  const beats = mapBeats(r.events, { ...ctx, mode: "replay" });
  assert.deepEqual(
    beats.map((b) => b.node),
    ["model", "tool:get_recalls", "src:get_recalls", "tool:get_recalls", "model", "rules", "loop", "model", "rules", "answer"],
  );
  assert.match(beats[2].caption, /recorded/, "a replay says its NHTSA data was recorded");
  assert.match(beats[3].caption, /12 recalls/);
  assert.match(beats[5].caption, /park-it/);
  assert.equal(beats.filter((b) => b.tone === "bad").length, 2);
});

test("mapState: the active beat, everything visited so far, each node's last status and the tools' results", () => {
  const beats = mapBeats(replay("real-safety").events, { ...ctx, mode: "replay" });
  const atFail = mapState(beats, 5);
  assert.equal(atFail.active?.node, "rules");
  assert.equal(atFail.status.rules, "bad");
  assert.ok(atFail.nodes.includes("tool:get_recalls") && atFail.nodes.includes("src:get_recalls") && atFail.nodes.includes("loop"));
  assert.ok(atFail.edges.includes("loop>tool:get_recalls"));
  assert.ok(!atFail.nodes.includes("answer"));
  assert.equal(atFail.notes["tool:get_recalls"], "12 recalls · 12 ms");
  const end = mapState(beats, beats.length - 1);
  assert.equal(end.status.rules, "ok", "the retry passed");
  assert.equal(end.status.answer, "ok");
  assert.equal(end.status.loop, undefined, "an answer sent back is the rule's catch, not a fault in the loop");
  assert.equal(mapState(beats, -1).active, null);
  assert.deepEqual(mapState(beats, -1).nodes, []);
});

test("the tour plays a real run with a sentence per piece and the run's own numbers", () => {
  const r = replay("real-safety");
  const tour = tourFor(r, ctx);
  // the path in comes first, and says this recorded run skipped it
  assert.deepEqual(tour.slice(0, 5).map((s) => s.node), ["cdn", "lambda", "turnstile", "limits", "loop"]);
  assert.match(tour[0].caption, /recorded/i);
  for (const s of tour) {
    assert.ok(s.title && s.info && s.caption, `step at ${s.node} has a title, a sentence and a caption`);
  }
  const last = tour.at(-1)!;
  assert.equal(last.node, "visitor");
  assert.match(last.caption, /\$0\.0961/);
  assert.match(last.caption, /22,410 tokens/);
  assert.match(last.caption, /16\.3 s/);
  // the numbers are the run's: change the run, the tour changes
  const cheaper = tourFor({ ...r, costUsd: 0.01234, seconds: 4.2 }, ctx).at(-1)!;
  assert.match(cheaper.caption, /\$0\.0123/);
  assert.match(cheaper.caption, /4\.2 s/);
  assert.ok(tour.some((s) => s.node === "rules" && s.tone === "bad"), "the tour shows the rule catch");
  assert.deepEqual(entryBeats({ ...ctx, mode: "replay" }).map((b) => b.node), ["cdn", "lambda", "turnstile", "limits", "loop"]);
});

// The Examples tab reveals a replay one trace row at a time; the map is handed the events up to
// the next row, so it shows what the agent is doing while the panel waits for the result.
test("the events behind the first k trace rows: everything before the next row's event", () => {
  const ev = replay("real-safety").events;
  const types = (k: number) => eventsThroughStep(ev, k).map((e) => e.type);
  assert.deepEqual(types(0), ["model_call", "tool_call"]);
  assert.deepEqual(types(1), ["model_call", "tool_call", "tool_result", "model_call"]);
  assert.deepEqual(types(2), ["model_call", "tool_call", "tool_result", "model_call", "rule_failed", "model_call"]);
  assert.equal(eventsThroughStep(ev, toSteps(ev).length).length, ev.length);
  assert.equal(eventsThroughStep(ev, 99).length, ev.length);
});
