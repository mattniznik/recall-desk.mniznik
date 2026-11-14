// get_recalls is the source of every recall the agent may cite. It keeps the fields
// the rules and the answer need: the campaign number (what gets cited), the summary
// (which body styles a recall covers is written there), consequence and remedy (what
// the customer is told), and the two safety flags (what must come first).

import { test } from "node:test";
import assert from "node:assert/strict";

import { getRecalls } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const url = (make: string, model: string, year: number) =>
  `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${make}&model=${model}&modelYear=${year}`;

const KEYS = ["campaign", "component", "summary", "consequence", "remedy", "parkIt", "parkOutSide"];

test("a 2017 Civic has 6 recalls, each cut to the fields the agent uses", async () => {
  const { fetchJson, calls } = fakeFetch({ [url("honda", "civic", 2017)]: fixture("recalls-honda-civic-2017.json") });
  const r = await getRecalls({ make: "Honda", model: "Civic", year: 2017 }, { fetchJson });
  assert.ok(r.ok);
  assert.equal(r.count, 6);
  assert.deepEqual(calls, [url("honda", "civic", 2017)]);
  for (const recall of r.recalls) assert.deepEqual(Object.keys(recall), KEYS);
  const driveshaft = r.recalls.find((x) => x.campaign === "17V706000");
  assert.match(driveshaft?.summary ?? "", /Civic Sedan and Coupe/);
});

test("the safety flags come through as booleans", async () => {
  const { fetchJson } = fakeFetch({
    [url("ford", "ranger", 2006)]: fixture("recalls-ford-ranger-2006.json"),
    [url("hyundai", "tucson", 2019)]: fixture("recalls-hyundai-tucson-2019.json"),
  });
  const ranger = await getRecalls({ make: "Ford", model: "Ranger", year: 2006 }, { fetchJson });
  const tucson = await getRecalls({ make: "Hyundai", model: "Tucson", year: 2019 }, { fetchJson });
  assert.ok(ranger.ok && tucson.ok);
  assert.ok(ranger.recalls.filter((x) => x.parkIt === true).length >= 1);
  assert.deepEqual(tucson.recalls.map((x) => [x.campaign, x.parkOutSide]), [["20V543000", true]]);
});

test("no recalls is an answer, not an error", async () => {
  const { fetchJson } = fakeFetch({ [url("honda", "fit", 2017)]: { Count: 0, Message: "Results returned successfully", results: [] } });
  const r = await getRecalls({ make: "Honda", model: "Fit", year: 2017 }, { fetchJson });
  assert.deepEqual(r, { ok: true, make: "Honda", model: "Fit", year: 2017, count: 0, recalls: [], truncated: false });
});

test("a model name with spaces is encoded, and a bad one never reaches NHTSA", async () => {
  const { fetchJson, calls } = fakeFetch({ [url("honda", "civic%20type%20r", 2017)]: { Count: 0, results: [] } });
  assert.ok((await getRecalls({ make: "Honda", model: "Civic Type R", year: 2017 }, { fetchJson })).ok);
  assert.equal((await getRecalls({ make: "Honda", model: "civic&modelYear=1999", year: 2017 }, { fetchJson })).ok, false);
  assert.equal(calls.length, 1);
});
