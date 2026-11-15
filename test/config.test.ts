// The store has no brand: the plain "Auto Parts Store" (chosen 2026-11-13) means no real
// retailer's name can appear, and the "(fictional)" suffix was dropped the same day. Every page
// and every prompt reads the name from one place, so this test pins that place.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STORE_NAME } from "../src/config.ts";

test("the store name is the generic one", () => {
  assert.equal(STORE_NAME, "Auto Parts Store");
});
