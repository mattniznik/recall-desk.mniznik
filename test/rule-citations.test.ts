// Rule 1: the answer may only cite recalls a tool returned in this run. This is the
// fact-locked-resume rule again: the model points at facts by id, code checks every id.
// It reads both the structured list and the answer text, because a campaign number
// written into the prose reaches the customer just the same.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkCitations, type RunEvidence } from "../src/guards/rules.ts";
import type { Answer } from "../src/agent/answer.ts";
import { getRecalls } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const URL = "https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=civic&modelYear=2017";

async function civicEvidence(): Promise<RunEvidence> {
  const { fetchJson } = fakeFetch({ [URL]: fixture("recalls-honda-civic-2017.json") });
  const r = await getRecalls({ make: "Honda", model: "Civic", year: 2017 }, { fetchJson });
  assert.ok(r.ok);
  return { recalls: r.recalls, catalogHits: [], question: "2017 Civic, grinding brakes. Any recall?" };
}

const answer = (over: Partial<Answer>): Answer => ({
  text: "",
  cited_recall_ids: [],
  applies_to_vehicle: [],
  fits: [],
  handoff: false,
  ...over,
});

test("citing a returned recall in the list and the text is fine", async () => {
  const a = answer({ text: "No brake recall. 17V706000 covers the driveshaft on sedans and coupes.", cited_recall_ids: ["17V706000"] });
  assert.deepEqual(checkCitations(a, await civicEvidence()), []);
});

test("a cited id no tool returned is a violation", async () => {
  const v = checkCitations(answer({ cited_recall_ids: ["99V999000"] }), await civicEvidence());
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "cite_only_returned");
  assert.match(v[0].detail, /99V999000/);
});

test("a campaign number written in the text counts, in any case", async () => {
  const v = checkCitations(answer({ text: "See recall 25v123456 for your brakes." }), await civicEvidence());
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /25V123456/);
});

test("a returned recall named in the text must also be in the cited list", async () => {
  const v = checkCitations(answer({ text: "Recall 18V266000 may apply." }), await civicEvidence());
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "cite_only_returned");
  assert.match(v[0].detail, /18V266000.*cited_recall_ids/);
});

test("saying a recall applies needs that recall to have been returned", async () => {
  const v = checkCitations(answer({ applies_to_vehicle: ["20V543000"] }), await civicEvidence());
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /20V543000/);
});

test("an honest no-recall answer with no ids passes, even when no recall tool ran", () => {
  const a = answer({ text: "I found no recall that covers brakes on this car." });
  assert.deepEqual(checkCitations(a, { recalls: [], catalogHits: [], question: "" }), []);
});
