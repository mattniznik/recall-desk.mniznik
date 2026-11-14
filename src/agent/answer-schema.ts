// The submit_answer tool: its definition for the model, and the check of what comes back.
//
// Every run ends with the model calling this tool. Two layers keep the answer checkable:
// - `strict: true` asks the API to keep the arguments valid against the schema. The schema
//   sticks to types and required fields, because a strict schema accepts only a subset of
//   JSON Schema and that subset was not verified for patterns or lengths.
// - parseAnswer checks the rest in code: campaign numbers and part numbers have their real
//   shape, the text has a sane length, nothing extra is present. A malformed answer is
//   refused with a reason the model can act on, never quietly repaired.
//
// Forcing the tool with tool_choice is not an option: on Claude Opus 5.5 a forced
// `any` or named tool returns a 400 (Claude API skill, model notes). The prompt asks for
// it, and a run that ends without it counts as a failed check in the agent loop.

import type { Answer } from "./answer.ts";

const FIELDS = ["text", "cited_recall_ids", "applies_to_vehicle", "fits", "handoff"] as const;

const idList = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const SUBMIT_ANSWER_TOOL = {
  name: "submit_answer",
  description:
    "Finish every answer by calling this tool exactly once. Put every recall campaign number you mention in " +
    "cited_recall_ids, the ones you say apply to the customer's vehicle in applies_to_vehicle, and the catalog " +
    "part numbers you say fit in fits. Set handoff to true only after create_handoff has run.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [...FIELDS],
    properties: {
      text: { type: "string", description: "The answer the customer reads. Plain text." },
      cited_recall_ids: idList("Every NHTSA campaign number mentioned in text, e.g. 17V706000."),
      applies_to_vehicle: idList("Campaign numbers you say apply to this customer's vehicle."),
      fits: idList("Catalog part numbers (DP-...) you say fit this customer's vehicle."),
      handoff: { type: "boolean", description: "True when the customer is passed to a person." },
    },
  },
} as const;

const CAMPAIGN = /^\d{2}[VETC]\d{6}$/i;
const SKU = /^DP-[A-Z0-9]+(?:-[A-Z0-9]+)*$/i;
const MAX_TEXT = 4000;

export type Parsed = { ok: true; answer: Answer } | { ok: false; error: string };

export function parseAnswer(input: unknown): Parsed {
  const fail = (error: string): Parsed => ({ ok: false, error: `submit_answer: ${error}` });
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("the input must be an object.");
  const o = input as Record<string, unknown>;

  const extra = Object.keys(o).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) return fail(`unknown field ${extra.join(", ")}.`);
  const missing = FIELDS.filter((k) => !(k in o));
  if (missing.length) return fail(`missing field ${missing.join(", ")}.`);

  const text = typeof o.text === "string" ? o.text.trim() : null;
  if (text === null || text.length === 0 || text.length > MAX_TEXT) return fail(`text must be 1 to ${MAX_TEXT} characters.`);
  if (typeof o.handoff !== "boolean") return fail("handoff must be true or false.");

  const ids = (field: string, shape: RegExp, what: string): string[] | string => {
    const v = o[field];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `${field} must be a list of strings.`;
    const bad = (v as string[]).filter((x) => !shape.test(x.trim()));
    if (bad.length) return `${field} has ${bad.join(", ")}, which is not a ${what}.`;
    return [...new Set((v as string[]).map((x) => x.trim().toUpperCase()))];
  };

  const cited = ids("cited_recall_ids", CAMPAIGN, "campaign number like 17V706000");
  if (typeof cited === "string") return fail(cited);
  const applies = ids("applies_to_vehicle", CAMPAIGN, "campaign number like 17V706000");
  if (typeof applies === "string") return fail(applies);
  const fits = ids("fits", SKU, "catalog part number like DP-BRK-F-CIV-SC");
  if (typeof fits === "string") return fail(fits);

  return { ok: true, answer: { text, cited_recall_ids: cited, applies_to_vehicle: applies, fits, handoff: o.handoff } };
}
