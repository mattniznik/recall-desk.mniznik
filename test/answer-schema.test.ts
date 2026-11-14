// submit_answer is how every run ends: the model hands over its answer as fields the
// rules can check. The tool is strict (schema-valid arguments), and parseAnswer checks
// what the schema cannot say: campaign numbers and part numbers have their real shape,
// and the text has a sane length. A malformed answer is refused, never repaired.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SUBMIT_ANSWER_TOOL, parseAnswer } from "../src/agent/answer-schema.ts";

const good = {
  text: "No recall covers brakes on a 2017 Civic. 17V706000 covers the driveshaft on sedans and coupes.",
  cited_recall_ids: ["17v706000", "17V706000"],
  applies_to_vehicle: [],
  fits: ["dp-brk-f-civ-sc"],
  handoff: false,
};

test("the tool is strict, closed, and requires all five fields", () => {
  assert.equal(SUBMIT_ANSWER_TOOL.name, "submit_answer");
  assert.equal(SUBMIT_ANSWER_TOOL.strict, true);
  const s = SUBMIT_ANSWER_TOOL.input_schema;
  assert.equal(s.additionalProperties, false);
  assert.deepEqual([...s.required].sort(), ["applies_to_vehicle", "cited_recall_ids", "fits", "handoff", "text"]);
});

test("a good answer parses, with ids upper-cased and de-duplicated", () => {
  const r = parseAnswer(good);
  assert.ok(r.ok);
  assert.deepEqual(r.answer.cited_recall_ids, ["17V706000"]);
  assert.deepEqual(r.answer.fits, ["DP-BRK-F-CIV-SC"]);
});

test("a missing field, an extra field or a wrong type is refused and named", () => {
  const { handoff: _, ...noHandoff } = good;
  assert.match(errorOf(noHandoff), /handoff/);
  assert.match(errorOf({ ...good, confidence: 0.9 }), /confidence/);
  assert.match(errorOf({ ...good, handoff: "yes" }), /handoff/);
  assert.match(errorOf({ ...good, fits: "DP-BRK-F-CIV-SC" }), /fits/);
  assert.match(errorOf("{\"text\":\"hi\"}"), /object/);
});

test("ids must look like campaign numbers and catalog part numbers", () => {
  assert.match(errorOf({ ...good, cited_recall_ids: ["recall-1"] }), /campaign/);
  assert.match(errorOf({ ...good, applies_to_vehicle: ["17V70600"] }), /campaign/);
  assert.match(errorOf({ ...good, fits: ["BRAKE-PADS"] }), /part number/);
});

test("the text must be 1 to 4000 characters", () => {
  assert.match(errorOf({ ...good, text: "  " }), /text/);
  assert.match(errorOf({ ...good, text: "x".repeat(4001) }), /text/);
});

function errorOf(input: unknown): string {
  const r = parseAnswer(input);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? "" : r.error;
}
