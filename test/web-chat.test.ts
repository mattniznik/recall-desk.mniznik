// The chat page's pure parts: reading the event stream line by line even when a line
// arrives in pieces, the history the next question carries, and the body hash CloudFront's
// signed origin needs on every POST.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { historyFor, sha256Hex, splitLines, type Exchange } from "../web/src/chat.ts";

test("splitLines returns whole lines and keeps the unfinished tail", () => {
  assert.deepEqual(splitLines('{"a":1}\n{"b"'), { lines: ['{"a":1}'], rest: '{"b"' });
  assert.deepEqual(splitLines('{"a":1}\n{"b":2}\n'), { lines: ['{"a":1}', '{"b":2}'], rest: "" });
  assert.deepEqual(splitLines(""), { lines: [], rest: "" });
});

const ex = (question: string, answer?: string): Exchange => ({
  question,
  events: answer ? [{ type: "answer", answer: { text: answer, cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false } }] : [],
  state: answer ? "done" : "error",
});

test("history carries the last three answered exchanges, oldest first", () => {
  const h = historyFor([ex("q1", "a1"), ex("q2", "a2"), ex("q3"), ex("q4", "a4"), ex("q5", "a5")]);
  assert.deepEqual(h, [
    { role: "user", text: "q2" },
    { role: "assistant", text: "a2" },
    { role: "user", text: "q4" },
    { role: "assistant", text: "a4" },
    { role: "user", text: "q5" },
    { role: "assistant", text: "a5" },
  ]);
});

test("history cuts long answers to the server's per-turn limit", () => {
  const h = historyFor([ex("q", "x".repeat(5000))]);
  assert.equal(h[1].text.length, 2000);
});

test("sha256Hex matches Node's hash of the same text", async () => {
  const body = JSON.stringify({ question: "Any recall? Żółć" });
  assert.equal(await sha256Hex(body), createHash("sha256").update(body, "utf8").digest("hex"));
});

// "What to try", so a visitor knows what to ask about: every capability and every guard has a question, each
// fits the server's limit, and none repeats.
test("the suggested questions cover each kind of question and fit the limit", async () => {
  const { SUGGESTIONS } = await import("../web/src/chat.ts");
  const { CHAT_LIMITS } = await import("../src/server/limits.ts");
  const groups = SUGGESTIONS.map((g) => g.group);
  assert.deepEqual(groups, ["Recalls", "Before you buy", "Problems and parts", "Customer service", "Try to break it"]);
  const questions = SUGGESTIONS.flatMap((g) => g.items.map((i) => i.question));
  for (const g of SUGGESTIONS) assert.ok(g.items.length >= 4, `${g.group}: ${g.items.length} questions`);
  assert.equal(new Set(questions).size, questions.length);
  for (const q of questions) assert.ok(q.length <= CHAT_LIMITS.questionChars, q);
});
