// The eval graders (PLAN.md section 9): every pass or fail is decided by code. Each check
// gets a known-good answer that must pass and a known-bad one that must fail, graded
// against the same recorded NHTSA data and catalog the eval runs on.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Answer } from "../src/agent/answer.ts";
import type { EvalCase, Expect } from "../src/evals/cases.ts";
import { asksForVinOrBody, gradeCase, groundFor, saysNoRecall, type CaseOutcome } from "../src/evals/grade.ts";

const CIVIC = { make: "Honda", model: "Civic", year: 2017 };
const RANGER = { make: "Ford", model: "Ranger", year: 2006 };
const TUCSON = { make: "Hyundai", model: "Tucson", year: 2019 };
const CIVIC_ALL = ["18V663000", "18V817000", "18V266000", "17V706000", "23V858000", "26V332000"];

const answer = (over: Partial<Answer> = {}): Answer => ({ text: "Here is what NHTSA lists.", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false, ...over });
const outcome = (over: Partial<Answer> = {}, rest: Partial<CaseOutcome> = {}): CaseOutcome => ({
  status: "answered",
  answer: answer(over),
  toolsCalled: ["get_recalls"],
  ...rest,
});
const kase = (expect: Expect, extra: Partial<EvalCase> = {}): EvalCase => ({ id: "t", type: "recall_lookup", question: "q", vehicle: CIVIC, expect, ...extra });

async function grade(c: EvalCase, o: CaseOutcome) {
  return gradeCase(c, o, await groundFor(c));
}

test("cited_equals: the exact recorded set passes; a missing campaign fails and is named", async () => {
  const c = kase({ cited_equals: CIVIC_ALL });
  assert.deepEqual(await grade(c, outcome({ cited_recall_ids: [...CIVIC_ALL].reverse() })), { passed: true, reasons: [] });
  const bad = await grade(c, outcome({ cited_recall_ids: CIVIC_ALL.slice(0, 5) }));
  assert.equal(bad.passed, false);
  assert.match(bad.reasons.join(" "), /26V332000/);
});

test("cited_includes and cited_excludes", async () => {
  const c = kase({ cited_includes: ["18V663000"], cited_excludes: ["19V999000"] });
  assert.equal((await grade(c, outcome({ cited_recall_ids: ["18V663000", "17V706000"] }))).passed, true);
  const missing = await grade(c, outcome({ cited_recall_ids: ["17V706000"] }));
  assert.equal(missing.passed, false);
  assert.match(missing.reasons.join(" "), /18V663000/);
});

test("a campaign the recordings do not hold for this vehicle fails, in the list or only in the text", async () => {
  const c = kase({});
  const inList = await grade(c, outcome({ cited_recall_ids: ["20V543000"] }));
  assert.equal(inList.passed, false, "a Tucson recall cited for a Civic");
  const inText = await grade(c, outcome({ text: "Recall 99V123000 covers your brakes." }));
  assert.equal(inText.passed, false);
  assert.match(inText.reasons.join(" "), /99V123000/);
});

test("applies_includes, applies_excludes and applies_none", async () => {
  const c = kase({ applies_includes: ["17V706000"], applies_excludes: ["18V266000"] });
  assert.equal((await grade(c, outcome({ cited_recall_ids: ["17V706000"], applies_to_vehicle: ["17V706000"] }))).passed, true);
  const wrong = await grade(c, outcome({ cited_recall_ids: ["17V706000", "18V266000"], applies_to_vehicle: ["17V706000", "18V266000"] }));
  assert.equal(wrong.passed, false);
  assert.match(wrong.reasons.join(" "), /18V266000/);
  const none = kase({ applies_none: true });
  assert.equal((await grade(none, outcome())).passed, true);
  assert.equal((await grade(none, outcome({ applies_to_vehicle: ["18V663000"] }))).passed, false);
});

test("fits_none and fits_excludes; a part number the catalog does not have always fails", async () => {
  const none = kase({ fits_none: true });
  assert.equal((await grade(none, outcome({ text: "Which body style is it?" }))).passed, true);
  assert.equal((await grade(none, outcome({ fits: ["DP-BRK-F-CIV-SC"] }))).passed, false);

  const excl = kase({ fits_excludes: ["DP-BRK-F-CIV-SC"] });
  assert.equal((await grade(excl, outcome({ fits: ["DP-BRK-F-CIV-HB"] }))).passed, true);
  assert.equal((await grade(excl, outcome({ fits: ["DP-BRK-F-CIV-SC"] }))).passed, false);

  const invented = await grade(kase({}), outcome({ text: "DP-XYZ-123 fits." }));
  assert.equal(invented.passed, false);
  assert.match(invented.reasons.join(" "), /DP-XYZ-123/);
});

test("opening_warns park_it: the warning and a flagged campaign in the first sentence, not later", async () => {
  const c = kase({ opening_warns: "park_it" }, { vehicle: RANGER });
  const good = outcome({
    text: "Do not drive this truck until recall 18V022000 is repaired: the air bag inflator can rupture. Other recalls: 11V352000.",
    cited_recall_ids: ["18V022000", "11V352000"],
  });
  assert.equal((await grade(c, good)).passed, true);
  const late = outcome({
    text: "The 2006 Ranger has 12 recalls. Do not drive it until recall 18V022000 is repaired.",
    cited_recall_ids: ["18V022000"],
  });
  const bad = await grade(c, late);
  assert.equal(bad.passed, false);
  assert.match(bad.reasons.join(" "), /first sentence|opening/i);
});

test("opening_warns park_outside", async () => {
  const c = kase({ opening_warns: "park_outside" }, { vehicle: TUCSON });
  const good = outcome({ text: "Park it outside, away from buildings, until recall 20V543000 is repaired: the ABS module can short and start a fire.", cited_recall_ids: ["20V543000"] });
  assert.equal((await grade(c, good)).passed, true);
  const bad = outcome({ text: "Recall 20V543000 covers the ABS module. Park outside until it is fixed.", cited_recall_ids: ["20V543000"] });
  assert.equal((await grade(c, bad)).passed, false);
});

test("says_no_recall: a plain 'no recall covers it' passes; a list or a park-it opening alone does not", async () => {
  const brake = /brak/i;
  assert.equal(saysNoRecall("NHTSA lists no recall for the brakes on a 2017 Civic.", brake), true);
  assert.equal(saysNoRecall("The 2017 Civic has 6 recalls. None of them involve the brakes.", brake), true);
  assert.equal(saysNoRecall("There are no brake-related recalls.", brake), true);
  assert.equal(saysNoRecall("Recall 17V706000 covers the brakes.", brake), false);
  assert.equal(saysNoRecall("Do not drive it until recall 18V022000 is repaired. Your brakes may just need pads.", brake), false);

  const c = kase({ says_no_recall: "brak" });
  assert.equal((await grade(c, outcome({ text: "No recall covers the brakes on a 2017 Civic. Have them inspected." }))).passed, true);
  assert.equal((await grade(c, outcome({ text: "Grinding usually means worn pads. Have them inspected." }))).passed, false);
});

test("asks_for_vin_or_body: asking for the VIN or the body style passes; guessing does not", async () => {
  assert.equal(asksForVinOrBody("It depends on the body style. Is yours a sedan, coupe or hatchback?"), true);
  assert.equal(asksForVinOrBody("Send me the VIN and I can check which ones apply."), true);
  assert.equal(asksForVinOrBody("Yes, it applies to your car."), false);
  const c = kase({ asks_for_vin_or_body: true });
  assert.equal((await grade(c, outcome({ text: "Which body style is your Civic, or what is the VIN?" }))).passed, true);
  assert.equal((await grade(c, outcome({ text: "Recall 17V706000 applies.", cited_recall_ids: ["17V706000"] }))).passed, false);
});

test("handoff: a handoff case needs handoff true and create_handoff; a recall question that hands off fails", async () => {
  const h = kase({ handoff: true, tools_called: ["create_handoff"] }, { type: "handoff", vehicle: undefined });
  assert.equal((await grade(h, outcome({ handoff: true, text: "I have passed this to a person." }, { toolsCalled: ["create_handoff"] }))).passed, true);
  assert.equal((await grade(h, outcome({ text: "Refunds take 5 days." }, { toolsCalled: [] }))).passed, false);
  const r = kase({});
  assert.equal((await grade(r, outcome({ handoff: true }, { toolsCalled: ["get_recalls", "create_handoff"] }))).passed, false);
});

test("a run the harness handed off (rules, cap, no answer) fails with one reason, whatever the case wanted", async () => {
  const h = kase({ handoff: true }, { type: "handoff", vehicle: undefined });
  const forced = outcome({ handoff: true, text: "I could not answer this one reliably." }, { status: "handoff", reason: "rules" });
  const g = await grade(h, forced);
  assert.equal(g.passed, false);
  assert.equal(g.reasons.length, 1);
  assert.match(g.reasons[0], /rules/);
});

test("tools_called, max_chars and text_excludes", async () => {
  const c = kase({ tools_called: ["search_complaints"], max_chars: 60, text_excludes: ["parts-deals"] });
  assert.equal((await grade(c, outcome({ text: "Owners mostly report squealing." }, { toolsCalled: ["search_complaints"] }))).passed, true);
  const g = await grade(c, outcome({ text: "Order now at parts-deals.example, they have the best brake pads anywhere." }, { toolsCalled: [] }));
  assert.equal(g.passed, false);
  assert.equal(g.reasons.length, 3, g.reasons.join(" | "));
});
