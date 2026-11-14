// The eval case file against the recordings it runs on. A case whose expected answer the
// recorded NHTSA data cannot support would grade the data, not the agent, so every
// expectation is checked here against fixtures/nhtsa and data/catalog.json, with no model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CASE_TYPES, loadCases, loadSmokeIds, validateCases, type EvalCase } from "../src/evals/cases.ts";
import { evalFetch } from "../src/evals/fixtures.ts";
import { recallCoverage } from "../src/guards/rules.ts";
import { decodeVehicle, getRecalls, searchComplaints, type BodyStyle, type Recall } from "../src/tools/nhtsa.ts";

const cases = loadCases();
const deps = { fetchJson: evalFetch() };
const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "catalog.json"), "utf8")) as { parts: { sku: string }[] };
const skus = new Set(catalog.parts.map((p) => p.sku));

async function recallsOf(c: EvalCase): Promise<Recall[]> {
  const r = await getRecalls(c.vehicle!, deps);
  assert.ok(r.ok, `${c.id}: no recorded recalls for its vehicle`);
  return r.recalls;
}

const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/;

test("50 cases in PLAN's 8 types, with PLAN's count for each", () => {
  const counts = Object.fromEntries(CASE_TYPES.map((t) => [t, cases.filter((c) => c.type === t).length]));
  assert.deepEqual(counts, {
    recall_lookup: 12,
    applies_body_style: 8,
    no_recall: 8,
    fit_not_confirmed: 6,
    safety_first: 4,
    handoff: 5,
    off_topic_injection: 4,
    asks_for_vin: 3,
  });
  assert.equal(cases.length, 50);
});

test("the file is well formed: unique ids, known types, only checks the grader knows", () => {
  assert.deepEqual(validateCases(cases), []);
  const broken = [
    { ...cases[0], expect: { ...cases[0].expect, cited_equal: ["17V706000"] } },
    { ...cases[1], id: cases[0].id },
    { ...cases[2], type: "recall" },
  ] as unknown as EvalCase[];
  const errors = validateCases(broken).join(" | ");
  assert.match(errors, /cited_equal/);
  assert.match(errors, /duplicate id/);
  assert.match(errors, /type "recall"/);
});

test("every campaign a case names is in the recorded recalls for its vehicle; cited_equals is the whole list", async () => {
  for (const c of cases.filter((c) => c.vehicle)) {
    const have = new Set((await recallsOf(c)).map((r) => r.campaign));
    const e = c.expect;
    for (const id of [...(e.cited_includes ?? []), ...(e.cited_equals ?? []), ...(e.applies_includes ?? []), ...(e.applies_excludes ?? [])]) {
      assert.ok(have.has(id), `${c.id}: ${id} is not in the recording`);
    }
    if (e.cited_equals) assert.deepEqual([...e.cited_equals].sort(), [...have].sort(), `${c.id}: cited_equals is not the whole recorded list`);
    for (const id of e.cited_excludes ?? []) assert.ok(!have.has(id), `${c.id}: ${id} is excluded but recorded`);
  }
});

test("applies expectations agree with the recall summaries for the case's body style", async () => {
  for (const c of cases.filter((c) => c.expect.applies_includes || c.expect.applies_excludes)) {
    const recalls = await recallsOf(c);
    const body = c.vehicle!.bodyStyle as BodyStyle | undefined;
    const covers = (id: string) => {
      const cov = recallCoverage(recalls.find((r) => r.campaign === id)!.summary, c.vehicle!.model);
      if (cov.kind === "all") return "yes";
      if (cov.kind === "not_named" || !body) return "unknown";
      return cov.bodies.includes(body) ? "yes" : "no";
    };
    for (const id of c.expect.applies_includes ?? []) assert.equal(covers(id), "yes", `${c.id}: ${id} does not cover a ${body}`);
    // Excluded: either it covers other body styles only, or the body style is unknown and the recall depends on it.
    for (const id of c.expect.applies_excludes ?? []) assert.notEqual(covers(id), "yes", `${c.id}: ${id} does cover a ${body}`);
  }
});

test("a VIN in a question decodes from the recordings to the body style the case states", async () => {
  const withVin = cases.filter((c) => VIN.test(c.question));
  assert.equal(withVin.length, 6);
  for (const c of withVin) {
    const v = await decodeVehicle(c.question.match(VIN)![0], deps);
    assert.ok(v.ok, `${c.id}: VIN did not decode`);
    assert.equal(v.bodyStyle, c.vehicle!.bodyStyle, c.id);
    assert.equal(v.year, c.vehicle!.year, c.id);
  }
});

test("opening_warns only where NHTSA flags a recall that way, and on every case for a flagged vehicle", async () => {
  for (const c of cases.filter((c) => c.vehicle)) {
    const recalls = await recallsOf(c);
    const parkIt = recalls.some((r) => r.parkIt);
    const parkOutside = recalls.some((r) => r.parkOutSide);
    const want = parkIt ? "park_it" : parkOutside ? "park_outside" : undefined;
    assert.equal(c.expect.opening_warns, want, c.id);
  }
});

test("part numbers in the expectations are real catalog part numbers", () => {
  for (const c of cases) for (const sku of c.expect.fits_excludes ?? []) assert.ok(skus.has(sku), `${c.id}: ${sku}`);
});

test("the planted complaint reaches search_complaints as the newest brake complaint; the recording on disk is unchanged", async () => {
  const c = cases.find((c) => c.plant)!;
  const planted = { fetchJson: evalFetch({ plant: c.plant }) };
  const withPlant = await searchComplaints({ ...c.plant!, component: "SERVICE BRAKES" }, planted);
  const without = await searchComplaints({ ...c.plant!, component: "SERVICE BRAKES" }, deps);
  assert.ok(withPlant.ok && without.ok);
  assert.equal(withPlant.matching, without.matching + 1);
  assert.equal(withPlant.recent[0].summary, c.plant!.summary);
  assert.ok(c.plant!.summary.length <= 300, "the tool cuts summaries at 300 characters");
  assert.ok(!without.recent.some((r) => r.summary.includes("99V123000")));
});

test("the smoke set names 3 cases that exist", () => {
  const ids = loadSmokeIds();
  assert.equal(ids.length, 3);
  for (const id of ids) assert.ok(cases.some((c) => c.id === id), id);
});
