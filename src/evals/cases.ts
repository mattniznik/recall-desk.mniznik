// The eval cases (PLAN.md section 9): a question, the vehicle its answer is checked
// against, and what the code grader checks. The cases live in evals/cases.json; this file
// is their type and the loader, which refuses a malformed file instead of grading it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CASES_FILE = join(import.meta.dirname, "..", "..", "evals", "cases.json");

export const CASE_TYPES = [
  "recall_lookup",
  "applies_body_style",
  "no_recall",
  "fit_not_confirmed",
  "safety_first",
  "handoff",
  "off_topic_injection",
  "asks_for_vin",
] as const;

export type CaseType = (typeof CASE_TYPES)[number];

// Every check the grader knows (src/evals/grade.ts). Campaign numbers and part numbers are
// written as NHTSA and the catalog write them.
export type Expect = {
  handoff?: boolean; // answer.handoff must equal this; default false
  tools_called?: string[]; // each tool ran at least once
  cited_equals?: string[]; // cited_recall_ids is exactly this set
  cited_includes?: string[];
  cited_excludes?: string[];
  cited_none?: boolean;
  applies_includes?: string[];
  applies_excludes?: string[];
  applies_none?: boolean;
  fits_none?: boolean;
  fits_excludes?: string[];
  opening_warns?: "park_it" | "park_outside"; // the first sentence carries NHTSA's warning
  says_no_recall?: string; // regex source for the topic the answer must say has no recall
  asks_for_vin_or_body?: boolean;
  max_chars?: number;
  text_excludes?: string[]; // case-insensitive substrings
};

const EXPECT_KEYS = new Set([
  "handoff",
  "tools_called",
  "cited_equals",
  "cited_includes",
  "cited_excludes",
  "cited_none",
  "applies_includes",
  "applies_excludes",
  "applies_none",
  "fits_none",
  "fits_excludes",
  "opening_warns",
  "says_no_recall",
  "asks_for_vin_or_body",
  "max_chars",
  "text_excludes",
]);

// One invented complaint added to the recorded complaints for one case (the injection case).
// `filed` is MM/DD/YYYY, as NHTSA writes it.
export type PlantedComplaint = { make: string; model: string; year: number; components: string; filed: string; summary: string };

export type EvalCase = {
  id: string;
  type: CaseType;
  question: string;
  vehicle?: { make: string; model: string; year: number; bodyStyle?: string };
  plant?: PlantedComplaint;
  expect: Expect;
};

type CaseFile = { smoke: string[]; cases: EvalCase[] };

const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as CaseFile;

export function validateCases(cases: EvalCase[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) errors.push(`duplicate id ${c.id}`);
    seen.add(c.id);
    if (!(CASE_TYPES as readonly string[]).includes(c.type)) errors.push(`${c.id}: type "${c.type}" is not one of ${CASE_TYPES.join(", ")}`);
    if (!c.question?.trim()) errors.push(`${c.id}: no question`);
    for (const k of Object.keys(c.expect ?? {})) if (!EXPECT_KEYS.has(k)) errors.push(`${c.id}: unknown check "${k}"`);
    if (c.expect?.says_no_recall !== undefined) {
      try {
        new RegExp(c.expect.says_no_recall, "i");
      } catch {
        errors.push(`${c.id}: says_no_recall is not a regex`);
      }
    }
  }
  return errors;
}

export function loadCases(file = CASES_FILE): EvalCase[] {
  const { cases } = read(file);
  const errors = validateCases(cases);
  if (errors.length) throw new Error(`evals/cases.json: ${errors.join("; ")}`);
  return cases;
}

// The 3 cases a smoke run uses: one recall lookup, one safety warning, one handoff.
export function loadSmokeIds(file = CASES_FILE): string[] {
  return read(file).smoke;
}
