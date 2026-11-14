// Rule 2: the answer may only say a recall applies to the customer's car when the
// recall covers that car's body style. NHTSA's recall list is filtered by make, model
// and year only, so for a 2017 Civic it returns recalls for sedans and for hatchbacks
// alike. Which body styles a recall covers is written in its summary, and nowhere else.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkApplicability, recallCoverage, type RunEvidence } from "../src/guards/rules.ts";
import type { Answer } from "../src/agent/answer.ts";
import { getRecalls, type BodyStyle, type Recall } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const URL = "https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=civic&modelYear=2017";

async function civicRecalls(): Promise<Recall[]> {
  const { fetchJson } = fakeFetch({ [URL]: fixture("recalls-honda-civic-2017.json") });
  const r = await getRecalls({ make: "Honda", model: "Civic", year: 2017 }, { fetchJson });
  assert.ok(r.ok);
  return r.recalls;
}

const byId = (recalls: Recall[], id: string) => recalls.find((r) => r.campaign === id)!;

const evidence = (recalls: Recall[], bodyStyle?: BodyStyle): RunEvidence => ({
  recalls,
  catalogHits: [],
  question: "",
  vehicle: { make: "Honda", model: "Civic", year: 2017, bodyStyle },
});

const applies = (...ids: string[]): Answer => ({
  text: "",
  cited_recall_ids: ids,
  applies_to_vehicle: ids,
  fits: [],
  handoff: false,
});

test("coverage is read from each 2017 Civic recall summary", async () => {
  const rs = await civicRecalls();
  assert.deepEqual(recallCoverage(byId(rs, "17V706000").summary, "Civic"), { kind: "bodies", bodies: ["sedan", "coupe"] });
  assert.deepEqual(recallCoverage(byId(rs, "18V266000").summary, "Civic"), { kind: "bodies", bodies: ["hatchback"] });
  assert.deepEqual(recallCoverage(byId(rs, "23V858000").summary, "Civic"), { kind: "bodies", bodies: ["coupe", "sedan", "hatchback"] });
  assert.deepEqual(recallCoverage(byId(rs, "18V663000").summary, "Civic"), { kind: "all" });
  assert.deepEqual(recallCoverage(byId(rs, "26V332000").summary, "Civic"), { kind: "all" });
});

test("'Ford Ranger trucks' is a plain mention: every body style", () => {
  // 17V787000 names the Ranger only as "Ranger trucks"; no "Ranger vehicles" anywhere.
  const summary = fixture("recalls-ford-ranger-2006.json").results.find((r: { NHTSACampaignNumber: string }) => r.NHTSACampaignNumber === "17V787000").Summary;
  assert.deepEqual(recallCoverage(summary, "Ranger"), { kind: "all" });
});

test("the Civic Type R is its own model, not a Civic body style", async () => {
  const rs = await civicRecalls();
  assert.deepEqual(recallCoverage(byId(rs, "18V266000").summary, "Civic Type R"), { kind: "all" });
  assert.deepEqual(recallCoverage(byId(rs, "17V706000").summary, "Civic Type R"), { kind: "not_named" });
});

test("17V706000 applies to a sedan and not to a hatchback", async () => {
  const rs = await civicRecalls();
  assert.deepEqual(checkApplicability(applies("17V706000"), evidence(rs, "sedan")), []);
  const v = checkApplicability(applies("17V706000"), evidence(rs, "hatchback"));
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "applies_needs_body_style");
  assert.match(v[0].detail, /sedan, coupe/);
});

test("with no body style known, a body-specific recall cannot be said to apply", async () => {
  const rs = await civicRecalls();
  const v = checkApplicability(applies("18V266000"), evidence(rs));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /body style|VIN/);
});

test("a recall that covers every body style may apply without one", async () => {
  const rs = await civicRecalls();
  assert.deepEqual(checkApplicability(applies("18V663000"), evidence(rs)), []);
});

test("a recall whose summary does not name the model cannot be said to apply", async () => {
  const rs = await civicRecalls();
  const typeR = { ...evidence(rs, "hatchback"), vehicle: { make: "Honda", model: "Civic Type R", year: 2017, bodyStyle: "hatchback" as const } };
  const v = checkApplicability(applies("17V706000"), typeR);
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /does not name/);
});
