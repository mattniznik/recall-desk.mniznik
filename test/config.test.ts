// The store has no brand: Mat chose the plain "Auto Parts Store" on 2026-11-13 so no real
// retailer's name can appear (PLAN.md D4), and dropped the "(fictional)" suffix the same day
// ("the will know"). Every page and every prompt reads the name from one place, so this test
// pins that place.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STORE_NAME } from "../src/config.ts";

test("the store name is the generic one Mat chose", () => {
  assert.equal(STORE_NAME, "Auto Parts Store");
});
