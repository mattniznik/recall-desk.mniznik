// "How it works" and "How it was built" never carry a number typed by hand. Every count on
// them comes from scripts/export-site.ts, which reads the repository (the test run, the
// recorded real runs, the agent's limits, tools and rules, the decision records when there
// are any) and writes web/src/site-data.json. These tests check the export's pure parts on
// made-up inputs, so a changed input must show up as a changed number.

import { test } from "node:test";
import assert from "node:assert/strict";

import { builtSteps, countTap, decisionsOf, fieldOf, modelName, recordOf, repoUrl, ruleIds, runsSummary } from "../scripts/export-site.ts";
import { howSteps, money, ruleTitle, spansOf, terminalLines, walkthrough } from "../web/src/site.ts";
import type { Replay } from "../web/src/trace.ts";

const call = (n: number) => ({ type: "model_call", n, stopReason: "tool_use", model: "m", usage: {} });
const tool = (name: string, input: unknown, summary: string, ms = 5) => [
  { type: "tool_call", n: 1, name, input },
  { type: "tool_result", name, ok: true, summary, ms },
];
const answer = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "answer",
  answer: { text, cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false, ...extra },
});

const brakes = {
  label: "Real run",
  question: "2017 Civic, grinding brakes. Any recall?",
  status: "answered",
  real: true,
  costUsd: 0.04,
  tokens: { input: 100, cacheWrite: 10, cacheRead: 20, output: 30 },
  seconds: 12.5,
  events: [call(1), ...tool("get_recalls", { make: "Honda", model: "Civic", year: 2017 }, "6 recalls"), ...tool("search_complaints", { make: "Honda", model: "Civic", year: 2017, component: "brake" }, "38 of 606 complaints (brake)"), call(2), answer("No brake recall.", { cited_recall_ids: ["17V706000"] })],
} as unknown as Replay;

const safety = {
  label: "Real run",
  question: "Any open recalls on my 2006 Ford Ranger?",
  status: "answered",
  real: true,
  costUsd: 0.1,
  tokens: { input: 1000, cacheWrite: 0, cacheRead: 0, output: 50 },
  seconds: 16,
  events: [call(1), ...tool("get_recalls", { make: "Ford", model: "Ranger", year: 2006 }, "12 recalls"), call(2), { type: "rule_failed", violations: [{ rule: "safety_warning_first", detail: "Open with the warning." }] }, call(3), answer("Do not drive it.")],
} as unknown as Replay;

const refund = {
  label: "Real run",
  question: "I want a refund.",
  status: "answered",
  real: true,
  costUsd: 0.01,
  tokens: { input: 10, cacheWrite: 0, cacheRead: 0, output: 5 },
  seconds: 5,
  events: [call(1), ...tool("create_handoff", { reason: "refund" }, "ticket HO-123456"), call(2), answer("A person will help.", { handoff: true })],
} as unknown as Replay;

const scripted = { label: "Scripted", question: "q", status: "answered", events: [call(1), answer("x")] } as unknown as Replay;

test("countTap reads the totals node --test prints, and refuses output without them", () => {
  const tap = "TAP version 13\nok 1 - a\n1..137\n# tests 137\n# suites 0\n# pass 136\n# fail 1\n# cancelled 0\n";
  assert.deepEqual(countTap(tap), { tests: 137, pass: 136, fail: 1 });
  assert.throws(() => countTap("no totals here"), /tests/);
});

test("runsSummary counts only real runs, and measures cost, time and rule catches", () => {
  const s = runsSummary([
    { key: "real-brakes", replay: brakes },
    { key: "real-safety", replay: safety },
    { key: "real-refund", replay: refund },
    { key: "brakes", replay: scripted },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.scripted, 1);
  assert.deepEqual(s.costUsd, { total: 0.15, min: 0.01, max: 0.1 });
  assert.deepEqual(s.seconds, { min: 5, max: 16 });
  assert.equal(s.caught, 1, "one real answer was sent back by a rule");
  assert.equal(s.fixedOnRetry, 1, "and it passed on the retry");
  assert.equal(s.handoffs, 1);
  const row = s.runs.find((r) => r.key === "real-brakes")!;
  assert.deepEqual(
    { modelCalls: row.modelCalls, toolCalls: row.toolCalls, tokens: row.tokens, costUsd: row.costUsd, seconds: row.seconds },
    { modelCalls: 2, toolCalls: 2, tokens: 160, costUsd: 0.04, seconds: 12.5 },
  );
});

test("ruleIds lists each rule the checks can report, once, in file order", () => {
  const src = `{ rule: "b_rule", detail }\n{ rule: "a_rule" }\nout.push({ rule: "b_rule", detail: "x" })`;
  assert.deepEqual(ruleIds(src), ["b_rule", "a_rule"]);
});

test("decisionsOf counts records and their distinct provider links; none gives null", () => {
  assert.equal(decisionsOf([]), null);
  const d = decisionsOf([
    { name: "0001-a.md", text: "# 0001. First\nSee [docs](https://a.example/x) and [again](https://a.example/x)." },
    { name: "0002-b.md", text: "# 0002. Second\n[one](https://b.example/y)" },
  ]);
  assert.deepEqual(d, { count: 2, sources: 2, first: { id: "0001", title: "First", file: "0001-a.md" } });
});

test("fieldOf reads the dot field's numbers from the run's own tool results", () => {
  assert.deepEqual(fieldOf("real-brakes", brakes), { key: "real-brakes", question: brakes.question, recalls: 6, complaints: 606, matching: 38, component: "brake" });
  assert.throws(() => fieldOf("refund", refund), /complaints/);
});

test("recordOf takes one recall from a recorded NHTSA reply", () => {
  const reply = { results: [{ NHTSACampaignNumber: "17V706000", Component: "DRIVESHAFT", Summary: "certain Civic Sedan and Coupe vehicles." }] };
  assert.deepEqual(recordOf(reply, "17V706000", "https://api.example/recalls"), { campaign: "17V706000", component: "DRIVESHAFT", summary: "certain Civic Sedan and Coupe vehicles.", url: "https://api.example/recalls" });
  assert.throws(() => recordOf(reply, "99V999000", ""), /99V999000/);
});

test("modelName and repoUrl", () => {
  assert.equal(modelName("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(repoUrl("https://github.com/mattniznik/recall-desk.git"), "https://github.com/mattniznik/recall-desk");
  assert.equal(repoUrl("git@github.com:mattniznik/recall-desk.git"), "https://github.com/mattniznik/recall-desk");
  assert.equal(repoUrl(null), null);
  assert.equal(repoUrl("https://example.com/x.git"), null);
});

const facts = {
  tests: { tests: 137, pass: 137, fail: 0, files: 28, ruleFiles: 6 },
  runs: runsSummary([
    { key: "real-brakes", replay: brakes },
    { key: "real-safety", replay: safety },
  ]),
  rules: 6,
  decisions: null,
  fixtures: { count: 11, recordedAt: "2026-11-14T01:21:31.157Z" },
};

test("How it was built: six steps, each fact counted from the inputs", () => {
  const steps = builtSteps(facts, null);
  assert.equal(steps.length, 6);
  const all = steps.map((s) => s.fact).join(" | ");
  assert.match(all, /137 tests in 28 files/);
  assert.match(all, /2 real runs/);
  assert.match(all, /\$0\.14/);
  assert.match(all, /11 NHTSA replies/);
  assert.match(all, /1 of 2/);
  // no repository yet: no links
  assert.ok(steps.every((s) => s.url === null));
  // a changed input shows up
  assert.match(builtSteps({ ...facts, tests: { ...facts.tests, tests: 140 } }, null).map((s) => s.fact).join(), /140 tests/);
  // decision records, when there are some, replace the fixtures fact
  const withD = builtSteps({ ...facts, decisions: { count: 3, sources: 9, first: { id: "0001", title: "T", file: "0001-t.md" } } }, "https://github.com/o/r");
  assert.match(withD[0].fact, /3 decision records cite 9 provider pages/);
  assert.equal(withD[0].url, "https://github.com/o/r/tree/main/docs/decisions");
});

test("the page's How it works steps carry the agent's real limits", () => {
  const steps = howSteps({
    model: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    agent: { tools: Array.from({ length: 7 }, (_, i) => ({ name: `t${i}`, description: "" })), rules: ["a", "b", "c"], limits: { modelCalls: 6, toolCalls: 12, retries: 1 } },
    chat: { questionChars: 500, perVisitorPerDay: 5, perDay: 40, usdPerDay: 0.3, runMs: 45000 },
  });
  assert.equal(steps.length, 6);
  const text = JSON.stringify(steps);
  for (const n of ["500 characters", "7 tools", "3 rules", "6 model calls", "12 lookups", "45 s", "Claude Opus 5.5", "5 per visitor"]) assert.ok(text.includes(n), n);
});

test("walkthrough turns one recorded run into the six steps a player shows", () => {
  const w = walkthrough(safety, { modelCalls: 6, toolCalls: 12, retries: 1 }, 45);
  assert.equal(w.length, 6);
  assert.equal(w[0].kind === "question" && w[0].question, safety.question);
  assert.ok(w[1].kind === "tools" && w[1].tools.length === 1 && w[1].tools[0].summary === "12 recalls");
  assert.ok(w[2].kind === "json" && JSON.parse(w[2].json).handoff === false);
  assert.ok(w[3].kind === "rules" && w[3].blocked.length === 1 && w[3].blocked[0].rule === "safety_warning_first");
  assert.ok(w[4].kind === "result" && w[4].status === "answered" && w[4].text === "Do not drive it.");
  assert.deepEqual(w[5].kind === "limits" && [w[5].modelCalls, w[5].toolCalls, w[5].seconds], [3, 1, 16]);
  const h = walkthrough(refund, { modelCalls: 6, toolCalls: 12, retries: 1 }, 45);
  assert.ok(h[4].kind === "result" && h[4].ticket === "HO-123456");
});

test("the console hero writes a run as log lines", () => {
  const lines = terminalLines(safety);
  assert.deepEqual(lines.map((l) => l.k), ["model", "tool", "model", "rule", "model", "result"]);
  assert.match(lines[3].d, /safety_warning_first|warning/);
  assert.equal(lines[1].t, "5 ms");
});

test("small formatting helpers", () => {
  assert.equal(money(0.04789), "$0.0479");
  assert.equal(money(0.198, 2), "$0.20");
  assert.match(ruleTitle("cite_only_returned"), /NHTSA returned/);
  assert.equal(ruleTitle("some_new_rule"), "Some new rule");
  assert.deepEqual(spansOf("certain Civic Sedan and Coupe vehicles", ["sedan", "coupe"]), [[14, 19], [24, 29]]);
});

// "provider pages" means the providers' own docs. A link to GitHub (the sister repo, this repo)
// is not one; counting them made the page say 15 where 13 were provider pages (2026-11-14).
test("decisionsOf does not count GitHub links as provider pages", () => {
  const d = decisionsOf([
    { name: "0001-a.md", text: "# 0001. First\n[aws](https://docs.aws.amazon.com/x) [sister](https://github.com/mattniznik/rag.irs.mniznik/blob/main/docs/decisions/0001.md)" },
  ]);
  assert.equal(d?.sources, 1);
});
