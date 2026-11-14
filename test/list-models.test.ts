// list_models lets the agent turn "my Civic" into NHTSA's exact model name, and tell
// a Civic from a Civic Type R. Honda's 2017 list has 68 names, motorcycles and ATVs
// included, so the tool filters by a search word and caps what it returns.

import { test } from "node:test";
import assert from "node:assert/strict";

import { listModels } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const URL_HONDA_2017 = "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/honda/modelyear/2017?format=json";
const routes = () => ({ [URL_HONDA_2017]: fixture("models-honda-2017.json") });

test("a search word narrows the list to the matching models", async () => {
  const { fetchJson, calls } = fakeFetch(routes());
  const r = await listModels({ make: "Honda", year: 2017, query: "civic" }, { fetchJson });
  assert.deepEqual(r, { ok: true, make: "Honda", year: 2017, total: 68, models: ["Civic", "Civic Type R"], truncated: false });
  assert.deepEqual(calls, [URL_HONDA_2017]);
});

test("without a search word the list is capped at 30 names and says so", async () => {
  const { fetchJson } = fakeFetch(routes());
  const r = await listModels({ make: "honda", year: 2017 }, { fetchJson });
  assert.ok(r.ok);
  assert.equal(r.models.length, 30);
  assert.equal(r.truncated, true);
});

test("a make with path characters or an impossible year is refused without calling NHTSA", async () => {
  const { fetchJson, calls } = fakeFetch({});
  assert.equal((await listModels({ make: "honda/../x", year: 2017 }, { fetchJson })).ok, false);
  assert.equal((await listModels({ make: "honda", year: 1800 }, { fetchJson })).ok, false);
  assert.equal((await listModels({ make: "honda", year: 2017.5 }, { fetchJson })).ok, false);
  assert.equal(calls.length, 0);
});
