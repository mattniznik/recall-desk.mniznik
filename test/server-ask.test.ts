// The live chat's request handling, with fakes for the bot check, the run counters and the
// model: what is refused before any money is spent, and what a normal run streams.

import { test } from "node:test";
import assert from "node:assert/strict";

import { handleAsk, ndjson, upstreamDetail, CHAT_LIMITS, type AskDeps, type AskEvent } from "../src/server/ask.ts";
import type { ModelClient, ModelTurn } from "../src/agent/loop.ts";
import { recordedFetch } from "../src/tools/recorded.ts";

const IP = "203.0.113.7";
const CIVIC = { make: "Honda", model: "Civic", year: 2017 };
const answer = {
  type: "tool_use" as const,
  id: "tu_1",
  name: "submit_answer",
  input: { text: "No recall covers brakes on a 2017 Civic.", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false },
};
const usage = { input_tokens: 1000, output_tokens: 200 };
const turns: ModelTurn[] = [
  { content: [{ type: "tool_use", id: "tu_0", name: "get_recalls", input: CIVIC }], stop_reason: "tool_use", model: "claude-opus-5-5", usage },
  { content: [answer], stop_reason: "tool_use", model: "claude-opus-5-5", usage },
];

function setup(over: Partial<AskDeps> & { counts?: Record<string, number> } = {}) {
  const counts: Record<string, number> = over.counts ?? {};
  const calls = { model: 0, takeRun: [] as string[], human: 0, spend: [] as [string, number][] };
  let n = 0;
  const client: ModelClient = async () => {
    calls.model++;
    return turns[Math.min(n++, turns.length - 1)];
  };
  const deps: AskDeps = {
    verifyHuman: async () => {
      calls.human++;
      return true;
    },
    takeRun: async (key, limit) => {
      calls.takeRun.push(key);
      const next = (counts[key] ?? 0) + 1;
      if (next > limit) return { ok: false, count: counts[key] ?? 0 };
      counts[key] = next;
      return { ok: true, count: next };
    },
    modelClient: async () => client,
    fetchJson: recordedFetch(),
    salt: "test-salt",
    spentToday: async () => 0,
    addSpend: async (day, usd) => {
      calls.spend.push([day, usd]);
    },
    now: () => new Date("2026-11-14T12:00:00Z"),
    ...over,
  };
  return { deps, calls, counts };
}

async function ask(body: unknown, deps: AskDeps) {
  const events: AskEvent[] = [];
  await handleAsk(body, IP, deps, (e) => events.push(e));
  return events;
}

const good = { question: "2017 Civic, grinding brakes. Any recall?", history: [], turnstileToken: "tok" };
const errorOf = (events: AskEvent[]) => events.find((e) => e.type === "error") as Extract<AskEvent, { type: "error" }> | undefined;

test("a normal run streams start, the trace, the answer and done with its cost", async () => {
  const { deps } = setup();
  const events = await ask(good, deps);
  assert.equal(events[0].type, "start");
  assert.equal((events[0] as { left: number }).left, CHAT_LIMITS.perVisitorPerDay - 1);
  assert.ok(events.some((e) => e.type === "tool_call"));
  assert.ok(events.some((e) => e.type === "answer"));
  const done = events.at(-1) as Extract<AskEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.equal(done.status, "answered");
  assert.equal(typeof done.costUsd, "number");
  assert.ok(done.costUsd! > 0);
});

test("bad requests are refused before the bot check, the counters or the model", async () => {
  const bad = [
    {},
    { ...good, question: "" },
    { ...good, question: "x".repeat(CHAT_LIMITS.questionChars + 1) },
    { ...good, turnstileToken: "" },
    { ...good, history: [{ role: "assistant", text: "starts with the assistant" }] },
    { ...good, history: [{ role: "user", text: "a" }, { role: "user", text: "two users in a row" }] },
    { ...good, history: [{ role: "user", text: "x".repeat(CHAT_LIMITS.turnChars + 1) }, { role: "assistant", text: "ok" }] },
    { ...good, history: Array.from({ length: CHAT_LIMITS.historyTurns + 2 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "t" })) },
  ];
  for (const body of bad) {
    const { deps, calls } = setup();
    const events = await ask(body, deps);
    assert.equal(errorOf(events)?.code, "bad_request", JSON.stringify(body).slice(0, 80));
    assert.deepEqual([calls.human, calls.takeRun.length, calls.model], [0, 0, 0]);
  }
});

test("a failed bot check spends nothing", async () => {
  const { deps, calls } = setup({ verifyHuman: async () => false });
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "bot_check");
  assert.deepEqual([calls.takeRun.length, calls.model], [0, 0]);
});

test("without a key the chat says it is not switched on and takes no run", async () => {
  const { deps, calls } = setup({ modelClient: async () => null });
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "not_live");
  assert.deepEqual([calls.takeRun.length, calls.model], [0, 0]);
});

test("the visitor's daily limit stops the run before the model", async () => {
  const { deps, calls } = setup();
  for (let i = 0; i < CHAT_LIMITS.perVisitorPerDay; i++) await ask(good, deps);
  const before = calls.model;
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "visitor_limit");
  assert.equal(calls.model, before);
});

test("the global daily limit stops the run before the model", async () => {
  const day = "day#2026-11-14";
  const { deps, calls } = setup({ counts: { [day]: CHAT_LIMITS.perDay } });
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "daily_limit");
  assert.equal(calls.model, 0);
});

test("the visitor is counted by a salted hash, never the raw IP", async () => {
  const { deps, calls } = setup();
  await ask(good, deps);
  assert.equal(calls.takeRun.length, 2);
  for (const key of calls.takeRun) assert.ok(!key.includes(IP), key);
  assert.match(calls.takeRun[0], /^ip#[0-9a-f]{64}#2026-11-14$/);
});

test("Anthropic's workspace limit becomes a budget message, not a crash", async () => {
  const limitError = Object.assign(new Error("You have reached your specified workspace API usage limits. You will regain access on 2026-12-01."), { status: 400 });
  const { deps } = setup({ modelClient: async () => async () => Promise.reject(limitError) });
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "budget");
});

test("ndjson writes one event per line", () => {
  const line = ndjson({ type: "error", code: "failed", message: "two\nlines" });
  assert.equal(line.split("\n").length, 2);
  assert.ok(line.endsWith("\n"));
  assert.deepEqual(JSON.parse(line), { type: "error", code: "failed", message: "two\nlines" });
});

// A review found 40 questions a day can spend the $10 monthly cap in about 8 days. A daily
// dollar budget, from each run's measured cost, keeps the month inside it.
test("a spent daily budget stops the run before the counters and the model", async () => {
  const { deps, calls } = setup({ spentToday: async () => CHAT_LIMITS.usdPerDay });
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "daily_limit");
  assert.deepEqual([calls.takeRun.length, calls.model], [0, 0]);
});

test("each run's cost is added to the day's spend", async () => {
  const { deps, calls } = setup();
  await ask(good, deps);
  assert.equal(calls.spend.length, 1);
  assert.equal(calls.spend[0][0], "2026-11-14");
  assert.ok(calls.spend[0][1] > 0);
});

// Anthropic's docs (rate limits, "Reaching your spend cap"): at the tier's monthly cap the API
// answers HTTP 429 rate_limit_error, error_code enforced_spend_limit_reached, no retry-after.
// That is the budget, not "busy, try again in a minute". A plain 429 rate limit stays busy.
test("the tier spend cap (a 429) is the budget message; a plain 429 is busy", async () => {
  const cap = Object.assign(new Error("You have reached your API usage limits: your organization has crossed its monthly API usage threshold."), {
    status: 429,
    error: { type: "error", error: { type: "rate_limit_error", details: { error_code: "enforced_spend_limit_reached" } } },
  });
  const capped = setup({ modelClient: async () => async () => Promise.reject(cap) });
  assert.equal(errorOf(await ask(good, capped.deps))?.code, "budget");

  const busy = Object.assign(new Error("Number of request tokens has exceeded your per-minute rate limit"), { status: 429 });
  const limited = setup({ modelClient: async () => async () => Promise.reject(busy) });
  assert.equal(errorOf(await ask(good, limited.deps))?.code, "busy");
});

// Security review, 2026-11-14: a model id missing from the price table priced the run at null,
// and `if (cost)` then skipped addSpend, so the $0.30 daily budget stopped counting. A
// server-side fallback can answer on another model. An unknown model is charged at a ceiling.
test("a run answered by a model missing from the price table still counts against the budget", async () => {
  const unknown = (t: ModelTurn): ModelTurn => ({ ...t, model: "claude-model-not-in-the-table" });
  let n = 0;
  const { deps, calls } = setup({ modelClient: async () => async () => unknown(turns[Math.min(n++, turns.length - 1)]) });
  const events = await ask(good, deps);
  const done = events.at(-1) as Extract<AskEvent, { type: "done" }>;
  assert.equal(done.costUsd, null, "the shown cost stays honest: unknown");
  assert.equal(calls.spend.length, 1, "the run is still charged to the day");
  assert.ok(calls.spend[0][1] > 0);
});

// Production, 2026-11-14: the first real question failed in 2.6 s and the log line said only
// {"outcome":"failed"}, so the cause could not be read without the key. A failure now hands the
// upstream status, error type and a short message to the log (deps.onFailure); the visitor still
// gets only the generic message.
test("a model failure reports its status and type to the log, never to the visitor", async () => {
  const auth = Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), {
    status: 401,
    error: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
  });
  const seen: unknown[] = [];
  const { deps } = setup({ modelClient: async () => async () => Promise.reject(auth), onFailure: (d) => seen.push(d) });
  const events = await ask(good, deps);
  assert.equal(errorOf(events)?.code, "failed");
  assert.deepEqual(seen, [{ status: 401, type: "authentication_error", message: "invalid x-api-key" }]);
  assert.ok(!JSON.stringify(events).includes("authentication_error"));
});

test("the failure detail is short, carries no key-shaped string, and names non-API errors", () => {
  const long = upstreamDetail(Object.assign(new Error(`bad key sk-ant-api03-${"x".repeat(40)} ${"y".repeat(400)}`), { status: 400 }));
  assert.equal(long.status, 400);
  assert.ok(!/sk-ant-[A-Za-z0-9_-]{8,}/.test(long.message ?? ""));
  assert.ok((long.message ?? "").length <= 160);
  assert.deepEqual(upstreamDetail(new TypeError("fetch failed")), { status: undefined, type: "TypeError", message: "fetch failed" });
});

// Production, 2026-11-14, second question: the log said {"type":"APIConnectionError","message":
// "Connection error."}. The SDK keeps the real network error in `cause` (client.mjs:697: undici's
// "fetch failed", whose own cause carries a code such as ENOTFOUND), and the log read none of it.
test("a connection failure logs its cause chain with each error's code", () => {
  const net = Object.assign(new Error("getaddrinfo ENOTFOUND api.anthropic.com"), { code: "ENOTFOUND" });
  const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: net });
  const conn = Object.assign(new Error("Connection error."), { name: "APIConnectionError", cause: fetchFailed });
  const d = upstreamDetail(conn);
  assert.equal(d.type, "APIConnectionError");
  assert.equal(d.message, "Connection error.");
  assert.equal(d.cause, "TypeError: fetch failed <- Error(ENOTFOUND): getaddrinfo ENOTFOUND api.anthropic.com");
});

// A local probe (2026-11-14) showed undici quoting a whole header value in its error: a key with a
// newline in it printed everything after the newline, because the old scrub stopped at whitespace.
test("a header error that quotes a broken key logs none of the key", () => {
  const key = `sk-ant-api03-${"a".repeat(20)}`;
  const tail = "b".repeat(80);
  const header = new TypeError(`Headers.append: "Bearer ${key}\n${tail}" is an invalid header value.`);
  for (const e of [header, Object.assign(new Error("Connection error."), { name: "APIConnectionError", cause: header })]) {
    const line = JSON.stringify(upstreamDetail(e));
    assert.ok(!line.includes("aaaaaaaa"), line);
    assert.ok(!line.includes("bbbbbbbb"), line);
    assert.match(line, /invalid header value/);
  }
});
