// Rule 3: a part may only be said to fit when the catalog confirmed it for this exact
// vehicle in this run. A part the catalog marked "needs_body_style" can be shown as a
// candidate, but not called a fit. Part numbers in the text must be real catalog hits,
// so the model cannot invent one.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkFits, type RunEvidence } from "../src/guards/rules.ts";
import type { Answer } from "../src/agent/answer.ts";
import { searchCatalog, type CatalogHit } from "../src/tools/catalog.ts";
import type { BodyStyle } from "../src/tools/nhtsa.ts";

function hits(bodyStyle?: BodyStyle): CatalogHit[] {
  const r = searchCatalog({ part: "front brake pads", make: "Honda", model: "Civic", year: 2017, bodyStyle });
  assert.ok(r.ok);
  return r.parts;
}

const evidence = (catalogHits: CatalogHit[], bodyStyle?: BodyStyle): RunEvidence => ({
  recalls: [],
  catalogHits,
  question: "",
  vehicle: { make: "Honda", model: "Civic", year: 2017, bodyStyle },
});

const answer = (over: Partial<Answer>): Answer => ({
  text: "",
  cited_recall_ids: [],
  applies_to_vehicle: [],
  fits: [],
  handoff: false,
  ...over,
});

test("a part the catalog confirmed for this sedan may be said to fit", () => {
  const a = answer({ text: "DP-BRK-F-CIV-SC fits your 2017 Civic sedan.", fits: ["DP-BRK-F-CIV-SC"] });
  assert.deepEqual(checkFits(a, evidence(hits("sedan"), "sedan")), []);
});

test("a part the catalog did not return cannot be said to fit", () => {
  const v = checkFits(answer({ fits: ["DP-BRK-F-CTR"] }), evidence(hits("sedan"), "sedan"));
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "fits_needs_exact_match");
  assert.match(v[0].detail, /DP-BRK-F-CTR/);
});

test("a candidate that still needs the body style is not a fit", () => {
  const v = checkFits(answer({ fits: ["DP-BRK-F-CIV-SC"] }), evidence(hits()));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /body style/);
});

test("a part confirmed for a sedan is not a fit once the car turns out to be a hatchback", () => {
  const v = checkFits(answer({ fits: ["DP-BRK-F-CIV-SC"] }), evidence(hits("sedan"), "hatchback"));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /hatchback/);
});

test("an invented part number in the text is a violation", () => {
  const v = checkFits(answer({ text: "Try DP-PADS-9000, it should work." }), evidence(hits("sedan"), "sedan"));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /DP-PADS-9000/);
});

test("showing unconfirmed candidates without calling them a fit passes", () => {
  const a = answer({ text: "DP-BRK-F-CIV-SC fits sedans and coupes, DP-BRK-F-CIV-HB fits hatchbacks. Which is yours?" });
  assert.deepEqual(checkFits(a, evidence(hits())), []);
});
