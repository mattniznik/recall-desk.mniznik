// The page's usage events, the parts that decide what an event says: a suggestion's id, what a
// link out points at, which tab a hash opens, a question's outcome from its stream, and when
// nothing is sent at all.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { AskEvent } from "../src/server/ask.ts";
import { SUGGESTIONS } from "../web/src/chat.ts";
import { linkKind, outcomeOf, sampleId, tabOf, trackingOff } from "../web/src/track.ts";

test("a suggestion is named by a short id made from its label", () => {
  assert.equal(sampleId('2006 Ford Ranger (a "park it" recall)'), "2006-ford-ranger-a-park-it-recall");
  assert.equal(sampleId("Grinding brakes"), "grinding-brakes");
  assert.equal(sampleId("x".repeat(60)).length, 40);
  // every suggestion on the page gets an id the event endpoint accepts, and no two share one
  const ids = SUGGESTIONS.flatMap((g) => g.items.map((i) => sampleId(i.label)));
  for (const id of ids) assert.match(id, /^[a-z0-9-]{1,40}$/, id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a link out is named by where it goes; links within the page are not links out", () => {
  const here = "recall-desk.mniznik.com";
  assert.equal(linkKind("https://github.com/someone/recall-desk.mniznik/blob/main/src/guards/rules.ts", here), "github");
  assert.equal(linkKind("https://www.linkedin.com/in/someone", here), "linkedin");
  assert.equal(linkKind("https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda", here), "nhtsa");
  assert.equal(linkKind("https://www.nhtsa.gov/recalls", here), "nhtsa");
  assert.equal(linkKind("https://rag.irs.mniznik.com/", here), "rag");
  assert.equal(linkKind("https://example.org/a/b", here), "example.org");
  assert.equal(linkKind("https://recall-desk.mniznik.com/#how", here), "");
  assert.equal(linkKind("not a url", here), "");
});

test("a hash names a tab only when it is a tab's route", () => {
  assert.deepEqual(["", "#", "#/", "#/examples", "#/evals", "#how", "#/nope"].map(tabOf), ["ask", "ask", "ask", "examples", "evals", null, null]);
});

test("a question's outcome comes from how its stream ended", () => {
  const done = (status: "answered" | "handoff"): AskEvent => ({ type: "done", status, costUsd: 0.03, tokens: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 }, modelCalls: 1, toolCalls: 1, seconds: 9 });
  assert.equal(outcomeOf([{ type: "start", left: 4 }, done("answered")]), "answered");
  assert.equal(outcomeOf([done("handoff")]), "handoff");
  assert.equal(outcomeOf([{ type: "error", code: "visitor_limit", message: "..." }]), "visitor_limit");
  assert.equal(outcomeOf([{ type: "start", left: 4 }]), "failed", "a stream cut off before the end");
});

test("nothing is sent in the local preview, under Global Privacy Control, or after ?track=off", () => {
  assert.equal(trackingOff({ dev: false, gpc: false, optedOut: false }), false);
  assert.equal(trackingOff({ dev: true, gpc: false, optedOut: false }), true);
  assert.equal(trackingOff({ dev: false, gpc: true, optedOut: false }), true);
  assert.equal(trackingOff({ dev: false, gpc: false, optedOut: true }), true);
});
