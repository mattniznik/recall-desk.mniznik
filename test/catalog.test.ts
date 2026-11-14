// search_catalog is the store's own system, the part an FDE would integrate with. Its
// one hard rule: a part "fits" only when the catalog lists that exact model, year and
// body style. When the body style is not known yet, a body-specific part comes back as
// "needs_body_style" so the agent asks instead of guessing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { searchCatalog } from "../src/tools/catalog.ts";
import { buildCatalog } from "../scripts/build-catalog.ts";

const CIVIC_2017 = { make: "Honda", model: "Civic", year: 2017 };

test("front brake pads for a 2017 Civic sedan: one part, fit confirmed", () => {
  const r = searchCatalog({ part: "front brake pads", ...CIVIC_2017, bodyStyle: "sedan" });
  assert.ok(r.ok);
  assert.deepEqual(r.parts.map((p) => [p.sku, p.fit]), [["DP-BRK-F-CIV-SC", "confirmed"]]);
});

test("without a body style, the sedan/coupe and hatchback pads both come back unconfirmed", () => {
  const r = searchCatalog({ part: "front brake pads", ...CIVIC_2017 });
  assert.ok(r.ok);
  assert.deepEqual(
    r.parts.map((p) => [p.sku, p.fit]).sort(),
    [["DP-BRK-F-CIV-HB", "needs_body_style"], ["DP-BRK-F-CIV-SC", "needs_body_style"]],
  );
});

test("a rear wiper exists for the hatchback and not for the sedan", () => {
  const hatch = searchCatalog({ part: "rear wiper", ...CIVIC_2017, bodyStyle: "hatchback" });
  const sedan = searchCatalog({ part: "rear wiper", ...CIVIC_2017, bodyStyle: "sedan" });
  assert.ok(hatch.ok && sedan.ok);
  assert.deepEqual(hatch.parts.map((p) => p.fit), ["confirmed"]);
  assert.deepEqual(sedan.parts, []);
});

test("a Civic never gets Civic Type R parts, and a year outside the range gets nothing", () => {
  const civic = searchCatalog({ part: "brake pads", ...CIVIC_2017, bodyStyle: "hatchback" });
  const typeR = searchCatalog({ part: "brake pads", make: "Honda", model: "Civic Type R", year: 2017, bodyStyle: "hatchback" });
  const old = searchCatalog({ part: "brake pads", make: "Honda", model: "Civic", year: 2015, bodyStyle: "sedan" });
  assert.ok(civic.ok && typeR.ok && old.ok);
  assert.ok(civic.parts.every((p) => !p.sku.includes("CTR")));
  assert.ok(typeR.parts.length > 0 && typeR.parts.every((p) => p.sku.includes("CTR")));
  assert.deepEqual(old.parts, []);
});

test("every answer says the fitment data is invented", () => {
  const r = searchCatalog({ part: "oil filter", ...CIVIC_2017, bodyStyle: "coupe" });
  assert.ok(r.ok);
  assert.match(r.note, /invented for this demo/);
});

test("a part query with odd characters is refused", () => {
  assert.equal(searchCatalog({ part: "pads<script>", ...CIVIC_2017 }).ok, false);
});

test("the committed catalog is what the builder makes: about 100 fictional parts", () => {
  const committed = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "catalog.json"), "utf8"));
  assert.deepEqual(committed, buildCatalog());
  assert.ok(committed.parts.length >= 90);
  for (const p of committed.parts) {
    assert.match(p.sku, /^DP-/);
    assert.ok(p.price > 0);
    assert.ok(p.fits.make && p.fits.model && p.fits.years.length === 2 && p.fits.bodies.length > 0);
  }
});
