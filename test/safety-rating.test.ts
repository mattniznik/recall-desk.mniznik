// get_safety_rating returns NHTSA's 5-Star ratings per variant. A 2017 Civic has three
// (2-door, 4-door, 5-door hatchback) and they differ, so when the body style is known the
// tool fetches only that one, and otherwise returns all of them, cut to the star values.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getSafetyRating } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const LIST = "https://api.nhtsa.gov/SafetyRatings/modelyear/2017/make/honda/model/civic";
const detail = (id: number) => `https://api.nhtsa.gov/SafetyRatings/VehicleId/${id}`;
const routes = () => ({
  [LIST]: fixture("ratings-honda-civic-2017.json"),
  [detail(11469)]: fixture("ratings-vehicle-11469.json"),
  [detail(11168)]: fixture("ratings-vehicle-11168.json"),
  [detail(11167)]: fixture("ratings-vehicle-11167.json"),
});
const ARGS = { make: "Honda", model: "Civic", year: 2017 };

test("without a body style, every variant comes back with its stars", async () => {
  const { fetchJson, calls } = fakeFetch(routes());
  const r = await getSafetyRating(ARGS, { fetchJson });
  assert.ok(r.ok);
  assert.deepEqual(
    r.variants.map((v) => [v.vehicleId, v.bodyStyle]),
    [[11469, "coupe"], [11168, "hatchback"], [11167, "sedan"]],
  );
  assert.equal(calls.length, 4);
  const coupe = r.variants[0];
  assert.deepEqual(
    { overall: coupe.overall, frontCrash: coupe.frontCrash, sideCrash: coupe.sideCrash, rollover: coupe.rollover },
    { overall: 5, frontCrash: 4, sideCrash: 5, rollover: 5 },
  );
});

test("with a body style, only that variant is fetched", async () => {
  const { fetchJson, calls } = fakeFetch(routes());
  const r = await getSafetyRating({ ...ARGS, bodyStyle: "hatchback" }, { fetchJson });
  assert.ok(r.ok);
  assert.deepEqual(r.variants.map((v) => v.vehicleId), [11168]);
  assert.deepEqual(calls, [LIST, detail(11168)]);
});

test("a vehicle NHTSA did not rate is an answer, not an error", async () => {
  const { fetchJson } = fakeFetch({ [LIST]: { Count: 0, Message: "No results found for this request", Results: [] } });
  const r = await getSafetyRating(ARGS, { fetchJson });
  assert.ok(r.ok);
  assert.deepEqual(r.variants, []);
});

test("'Not Rated' becomes null instead of a number", async () => {
  const notRated = { Count: 1, Results: [{ ...fixture("ratings-vehicle-11469.json").Results[0], OverallRating: "Not Rated" }] };
  const { fetchJson } = fakeFetch({ ...routes(), [detail(11469)]: notRated });
  const r = await getSafetyRating({ ...ARGS, bodyStyle: "coupe" }, { fetchJson });
  assert.ok(r.ok);
  assert.equal(r.variants[0].overall, null);
});

test("a bad model name never reaches NHTSA", async () => {
  const { fetchJson, calls } = fakeFetch({});
  assert.equal((await getSafetyRating({ ...ARGS, model: "civic/../x" }, { fetchJson })).ok, false);
  assert.equal(calls.length, 0);
});
