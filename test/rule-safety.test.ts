// Rule 4: when a recall NHTSA marks "park it" (do not drive) or "park outside" (fire
// risk) comes back, the answer opens with that warning and names the recall, before
// anything else the customer asked about. The fixtures are real: four park-it recalls
// on a 2006 Ford Ranger and one park-outside recall on a 2019 Hyundai Tucson.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSafetyFirst, type RunEvidence } from "../src/guards/rules.ts";
import type { Answer } from "../src/agent/answer.ts";
import { getRecalls, type BodyStyle, type Recall } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const API = "https://api.nhtsa.gov/recalls/recallsByVehicle";

async function recalls(make: string, model: string, year: number, file: string): Promise<Recall[]> {
  const url = `${API}?make=${make}&model=${model}&modelYear=${year}`;
  const { fetchJson } = fakeFetch({ [url]: fixture(file) });
  const r = await getRecalls({ make, model, year }, { fetchJson });
  assert.ok(r.ok);
  return r.recalls;
}

const ranger = () => recalls("ford", "ranger", 2006, "recalls-ford-ranger-2006.json");
const tucson = () => recalls("hyundai", "tucson", 2019, "recalls-hyundai-tucson-2019.json");

const evidence = (rs: Recall[], model: string, year: number, bodyStyle?: BodyStyle): RunEvidence => ({
  recalls: rs,
  catalogHits: [],
  question: "",
  vehicle: { make: "x", model, year, bodyStyle },
});

const answer = (text: string): Answer => ({ text, cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false });

test("a park-it recall: opening with 'do not drive' and the recall passes", async () => {
  const a = answer("Do not drive your 2006 Ranger until recall 18V022000 is repaired. It also has other recalls.");
  assert.deepEqual(checkSafetyFirst(a, evidence(await ranger(), "Ranger", 2006)), []);
});

test("a park-it recall mentioned only after something else is a violation", async () => {
  const a = answer("Your 2006 Ranger has 12 recalls. Do not drive it until 18V022000 is repaired.");
  const v = checkSafetyFirst(a, evidence(await ranger(), "Ranger", 2006));
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "safety_warning_first");
  assert.match(v[0].detail, /do not drive/i);
});

test("the warning has to name one of the flagged recalls", async () => {
  const v = checkSafetyFirst(answer("Do not drive this truck. Several recalls are open."), evidence(await ranger(), "Ranger", 2006));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /17V787000|18V022000|18V023000/);
});

test("a park-outside recall needs the park-outside warning, not just any warning", async () => {
  const good = answer("Park your 2019 Tucson outside, away from buildings, until recall 20V543000 is repaired. Here is the rest.");
  assert.deepEqual(checkSafetyFirst(good, evidence(await tucson(), "Tucson", 2019)), []);
  const v = checkSafetyFirst(answer("Do not drive your Tucson until 20V543000 is repaired."), evidence(await tucson(), "Tucson", 2019));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /park.*outside/i);
});

test("no flagged recall means no warning is required", () => {
  assert.deepEqual(checkSafetyFirst(answer("No recall covers brakes on this car."), evidence([], "Civic", 2017)), []);
});

test("a flagged recall for a body style this car is not does not force the warning", () => {
  const hatchOnly: Recall = {
    campaign: "19V000001",
    component: "AIR BAGS",
    summary: "Honda is recalling certain 2017 Honda Civic Hatchback vehicles.",
    consequence: "",
    remedy: "",
    parkIt: true,
    parkOutSide: false,
  };
  assert.deepEqual(checkSafetyFirst(answer("Your sedan has no open park-it recall."), evidence([hatchOnly], "Civic", 2017, "sedan")), []);
});

// Models often write a typographic apostrophe: "Don’t drive" (U+2019) is the same warning as
// "Don't drive". Found by the eval work, 2026-11-14: the curly form was read as no warning.
test("a curly apostrophe in \"Don’t drive\" still counts as the warning", async () => {
  const a = answer("Don’t drive your truck until it is repaired: 18V022000 is a park-it air bag recall.");
  assert.deepEqual(checkSafetyFirst(a, evidence(await ranger(), "Ranger", 2006)), []);
});
