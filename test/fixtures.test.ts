// The recorded NHTSA replies are the ground truth for every tool test and every eval.
// They are frozen on purpose: NHTSA keeps adding recalls, and a score that moves
// because the data moved would look like a prompt change. These tests pin what the
// rest of the suite relies on being in them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "fixtures", "nhtsa");
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), "utf8"));

test("the manifest dates the recording and every file it lists exists", () => {
  const manifest = read("manifest.json");
  assert.match(manifest.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  const files = Object.values(manifest.files) as { file: string; url: string }[];
  assert.ok(files.length >= 9, `expected at least 9 recordings, got ${files.length}`);
  for (const f of files) {
    assert.ok(existsSync(join(DIR, f.file)), `missing ${f.file}`);
    assert.match(f.url, /^https:\/\/(api\.nhtsa\.gov|vpic\.nhtsa\.dot\.gov)\//);
  }
});

test("the 2017 Civic has the 6 recalls the plan is built on", () => {
  const ids = read("recalls-honda-civic-2017.json").results.map(
    (r: { NHTSACampaignNumber: string }) => r.NHTSACampaignNumber,
  );
  assert.equal(ids.length, 6);
  assert.ok(ids.includes("17V706000"));
  assert.ok(ids.includes("18V266000"));
});

test("no recorded complaint carries a VIN", () => {
  const complaints = read("complaints-honda-civic-2017.json").results;
  assert.ok(complaints.length > 500);
  assert.equal(complaints.filter((c: object) => "vin" in c).length, 0);
});

test("there is a park-it recall and a park-outside recall for the safety rule", () => {
  const ranger = read("recalls-ford-ranger-2006.json").results;
  const tucson = read("recalls-hyundai-tucson-2019.json").results;
  assert.ok(ranger.some((r: { parkIt: boolean }) => r.parkIt === true));
  assert.ok(tucson.some((r: { parkOutSide: boolean }) => r.parkOutSide === true));
});

test("the partial VINs decode to a 2017 Civic sedan and hatchback", () => {
  const sedan = read("vin-19XFC2F5_HE.json").Results[0];
  const hatch = read("vin-SHHFK7H5_HU.json").Results[0];
  assert.equal(sedan.ModelYear, "2017");
  assert.match(sedan.BodyClass, /Sedan/);
  assert.match(hatch.BodyClass, /Hatchback/);
});
