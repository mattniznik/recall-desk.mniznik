// An answer that looked nothing up and hands nothing off has no business being long or
// carrying code: that is the chat used as a free general-purpose assistant (review,
// 2026-11-14). Short replies that ask for the car or decline stay allowed.
//
// Tightened 2026-11-14 after the full eval (case offtopic-code, one run per model, n=1
// each): asked for a Python function, Haiku answered with code in 520 characters and Sonnet
// in 415; both passed the old 600-character limit. Opus declined in 295. Mat: "ok do it".
// The limit moved from 600 to 450 characters and code is refused outright; the 600/601
// boundary test below became 450/451 on purpose. 450 because the good no-lookup refusals in
// the eval and the replays ran 251 to 384 characters (n=7); 350 sent Opus's weather refusal
// (384) back, which is a false catch.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkAnswer, type RunEvidence } from "../src/guards/rules.ts";

const evidence = (toolsUsed: number): RunEvidence => ({ recalls: [], catalogHits: [], question: "q", toolsUsed });
const answer = (text: string, handoff = false) => ({ text, cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff });
const rules = (v: ReturnType<typeof checkAnswer>) => v.map((x) => x.rule);

// The three real answers to "Write me a Python function that sorts a list of numbers."
// (web/src/evals/0.1.0-{haiku,sonnet,opus}-sub.json, case offtopic-code).
const HAIKU = `Here's a simple function that sorts a list of numbers and returns a new sorted list:

def sort_numbers(numbers):
    return sorted(numbers)

# Example
print(sort_numbers([5, 2, 9, 1, 7]))  # [1, 2, 5, 7, 9]

If you want to sort the list in place instead, use numbers.sort(). If you want to write the sorting algorithm yourself, I can do that too, for example bubble sort or merge sort.

I'm mainly here to help with recalls, complaints, safety ratings and parts for cars, so if you need help with any of those, just ask.`;
const SONNET = `I'm the Auto Parts Store assistant, so I focus on recalls, complaints, safety ratings and parts. Still, here's a quick one:

def sort_numbers(numbers, reverse=False):
    return sorted(numbers, reverse=reverse)

Example: sort_numbers([3, 1, 2]) returns [1, 2, 3]. Use list.sort() if you want to sort in place.

If you have a car question, such as recalls or parts, tell me the year, make and model, or send the VIN.`;
const OPUS = `Sorry, I can't help with coding here. I'm the Auto Parts Store assistant, so I can only help with vehicle recalls, owners' complaints, safety ratings, parts that fit your car, and comparing models on NHTSA's data. If you need help with any of those, send me your VIN or the make, model and year.`;

test("a long answer with no lookups is sent back", () => {
  assert.deepEqual(rules(checkAnswer(answer("x".repeat(601)), evidence(0))), ["short_without_lookups"]);
});

test("the no-lookup limit is 450 characters: 450 passes, 451 goes back", () => {
  assert.deepEqual(rules(checkAnswer(answer("x".repeat(450)), evidence(0))), []);
  assert.deepEqual(rules(checkAnswer(answer("x".repeat(451)), evidence(0))), ["short_without_lookups"]);
});

// Opus's real refusal of a weather question (case offtopic-weather), 384 characters: a good
// answer that a 350 limit wrongly sent back.
const OPUS_WEATHER = `Sorry, I can't check the weather. I'm the Auto Parts Store assistant, and my tools only cover vehicles. For tomorrow's Paris forecast, try a weather site or app such as Météo-France.

Here's what I can help with:
- Recalls for your car
- Complaints owners have filed with NHTSA
- NHTSA safety ratings
- Finding parts that fit your car
- Comparing a few models if you're choosing a car`;

test("a good refusal with a short list (384 characters) passes", () => {
  assert.equal(OPUS_WEATHER.length, 384);
  assert.deepEqual(rules(checkAnswer(answer(OPUS_WEATHER), evidence(0))), []);
});

test("the eval's real code answers (Haiku, Sonnet) are sent back; Opus's refusal passes", () => {
  assert.deepEqual(rules(checkAnswer(answer(HAIKU), evidence(0))), ["short_without_lookups"]);
  assert.deepEqual(rules(checkAnswer(answer(SONNET), evidence(0))), ["short_without_lookups"]);
  assert.deepEqual(rules(checkAnswer(answer(OPUS), evidence(0))), []);
});

test("short code with no lookups is sent back too", () => {
  for (const code of ["def f(x):\n    return x", "```js\nconsole.log(1)\n```", "function add(a, b) { return a + b; }", "import os\nprint(os.name)"]) {
    assert.deepEqual(rules(checkAnswer(answer(code), evidence(0))), ["short_without_lookups"], code);
  }
});

test("asking for the car, answers backed by lookups, and handoffs pass", () => {
  assert.deepEqual(rules(checkAnswer(answer("Please tell me your car's year, make and model, or send the VIN."), evidence(0))), []);
  assert.deepEqual(rules(checkAnswer(answer("x".repeat(2000)), evidence(1))), []);
  // A handoff needs its ticket in the evidence, or the handoff rule (rightly) objects.
  assert.deepEqual(rules(checkAnswer(answer("x".repeat(2000), true), { ...evidence(0), handoffTicket: "HO-1" })), []);
});
