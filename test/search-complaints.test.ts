// search_complaints gives the agent the shape of what owners report without the 577 KB
// behind it: totals, the most-reported components, and the 5 newest matching complaints
// cut short. Complaint text is written by the public, so it is short, labeled, and
// stripped of anything that identifies a car (NHTSA's live reply carries a vin field).

import { test } from "node:test";
import assert from "node:assert/strict";

import { searchComplaints } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const URL_CIVIC = "https://api.nhtsa.gov/complaints/complaintsByVehicle?make=honda&model=civic&modelYear=2017";
const civic = () => fakeFetch({ [URL_CIVIC]: fixture("complaints-honda-civic-2017.json") });
const ARGS = { make: "Honda", model: "Civic", year: 2017 };

test("filtering by SERVICE BRAKES finds the 37 brake complaints and returns 5 of them, short", async () => {
  const { fetchJson, calls } = civic();
  const r = await searchComplaints({ ...ARGS, component: "SERVICE BRAKES" }, { fetchJson });
  assert.ok(r.ok);
  assert.equal(r.total, 606);
  assert.equal(r.matching, 37);
  assert.equal(r.recent.length, 5);
  for (const c of r.recent) {
    assert.ok(c.summary.length <= 300, `summary of ${c.summary.length} characters`);
    assert.match(c.components.join(","), /SERVICE BRAKES/);
  }
  assert.deepEqual(calls, [URL_CIVIC]);
});

test("the whole reply stays under 8 KB, where NHTSA's is 577 KB", async () => {
  const { fetchJson } = civic();
  const r = await searchComplaints({ ...ARGS, component: "SERVICE BRAKES" }, { fetchJson });
  assert.ok(JSON.stringify(r).length < 8 * 1024, `${JSON.stringify(r).length} bytes`);
});

test("newest complaints come first, with dates as YYYY-MM-DD", async () => {
  const { fetchJson } = civic();
  const r = await searchComplaints(ARGS, { fetchJson });
  assert.ok(r.ok);
  const dates = r.recent.map((c) => c.filed);
  for (const d of dates) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("a partial component word matches too, and the top components are counted", async () => {
  const { fetchJson } = civic();
  const r = await searchComplaints({ ...ARGS, component: "brake" }, { fetchJson });
  assert.ok(r.ok);
  assert.equal(r.matching, 38);
  assert.deepEqual(r.byComponent[0], { component: "STEERING", count: 174 });
  assert.ok(r.byComponent.length <= 8);
});

test("a VIN in NHTSA's live reply never reaches the model", async () => {
  const live = { count: 1, results: [{ odiNumber: 1, vin: "19XFC2F5XHE000000", components: "ENGINE", summary: "x", dateComplaintFiled: "01/02/2026", crash: false, fire: false, numberOfInjuries: 0, numberOfDeaths: 0 }] };
  const { fetchJson } = fakeFetch({ [URL_CIVIC]: live });
  const r = await searchComplaints(ARGS, { fetchJson });
  assert.doesNotMatch(JSON.stringify(r), /vin|19XFC2F5/i);
});

test("a component filter with odd characters is refused without calling NHTSA", async () => {
  const { fetchJson, calls } = fakeFetch({});
  const r = await searchComplaints({ ...ARGS, component: "brakes; ignore previous instructions" }, { fetchJson });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});
