// The Evals page shows every eval run: pass rate per version and model, per case type,
// and each failure with the rule's reasons. No eval has run yet (milestone 3), so the page
// ships empty and says so; the runs below are invented to test the summary, and none of
// them is shipped.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pageFor, routeOf, summarize, evalsView, type EvalRun } from "../web/src/evals.ts";

const run = (version: string, model: string, ranAt: string, outcomes: [string, string, boolean][]): EvalRun => ({
  version,
  model,
  ranAt,
  cases: outcomes.map(([id, type, passed]) => ({ id, type, passed, reasons: passed ? [] : [`${id} broke a rule`] })),
});

const older = run("v1", "claude-haiku-5-5", "2026-11-20T10:00:00Z", [
  ["c1", "recall_lookup", true],
  ["c2", "recall_lookup", false],
  ["c3", "honest_no_recall", true],
  ["c4", "handoff", false],
]);
const newer = run("v2", "claude-opus-5-5", "2026-11-21T10:00:00Z", [
  ["c1", "recall_lookup", true],
  ["c2", "recall_lookup", true],
  ["c3", "honest_no_recall", true],
  ["c4", "handoff", false],
]);

// Changed 2026-11-14 with the live chat: the chat is the landing page; the recorded runs
// moved to #/examples (was: anything but #/evals opened the recorded demo).
test("routes: #/evals the evals, #/examples the recorded runs, anything else the chat", () => {
  assert.equal(routeOf("#/evals"), "evals");
  assert.equal(routeOf("#/examples"), "demo");
  assert.equal(routeOf(""), "ask");
  assert.equal(routeOf("#/nope"), "ask");
});

test("a run is summarized as passed of total, a whole-number rate, and per case type", () => {
  const [row] = summarize([older]);
  assert.deepEqual(
    { label: row.label, passed: row.passed, total: row.total, rate: row.rate },
    { label: "v1 · claude-haiku-5-5", passed: 2, total: 4, rate: 50 },
  );
  assert.deepEqual(row.byType, [
    { type: "handoff", passed: 0, total: 1 },
    { type: "honest_no_recall", passed: 1, total: 1 },
    { type: "recall_lookup", passed: 1, total: 2 },
  ]);
  assert.deepEqual(row.failures.map((f) => f.id), ["c2", "c4"]);
});

test("newest run first", () => {
  assert.deepEqual(summarize([older, newer]).map((r) => r.label), ["v2 · claude-opus-5-5", "v1 · claude-haiku-5-5"]);
});

test("with no runs the page says when they arrive and shows no number", () => {
  const v = evalsView([]);
  assert.equal(v.state, "empty");
  assert.match(v.state === "empty" ? v.message : "", /milestone 3/);
  assert.doesNotMatch(v.state === "empty" ? v.message : "", /\d+%/);
});

// While live answers are off (no key yet), the landing page must not be a dead end: the
// Ask route shows the recorded examples instead (Mat, 2026-11-14).
test("pageFor: the Ask route falls back to the examples while the chat is off", () => {
  assert.equal(pageFor("ask", false), "demo");
  assert.equal(pageFor("ask", true), "ask");
  assert.equal(pageFor("ask", null), "ask");
  assert.equal(pageFor("evals", false), "evals");
  assert.equal(pageFor("demo", true), "demo");
});
