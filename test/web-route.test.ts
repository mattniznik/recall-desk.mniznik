// The desk's tabs are hash routes (#/, #/examples, #/evals); the long page's own links are
// section anchors (#how, #built, #proof). Before the layouts, every hash was a route, so a
// click on "How it works" from Examples would have switched the desk to Ask.

import { test } from "node:test";
import assert from "node:assert/strict";

import { routeFromHash } from "../web/src/evals.ts";

test("route hashes change the tab", () => {
  assert.equal(routeFromHash("#/evals", "ask"), "evals");
  assert.equal(routeFromHash("#/examples", "evals"), "demo");
  assert.equal(routeFromHash("#/", "demo"), "ask");
  assert.equal(routeFromHash("", "demo"), "ask");
});

test("a section anchor keeps the tab that was open", () => {
  assert.equal(routeFromHash("#how", "demo"), "demo");
  assert.equal(routeFromHash("#built", "evals"), "evals");
  assert.equal(routeFromHash("#top", "ask"), "ask");
});
