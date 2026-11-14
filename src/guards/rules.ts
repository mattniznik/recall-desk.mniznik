// The rules every answer is checked against before a customer sees it (PLAN.md section 6).
//
// They run in code, after the model answers, in three places: the Lambda, the eval
// runner and the tests. A prompt that says "only cite real recalls" is a request; this
// is the check. Each rule returns violations with a reason the model can read, because
// a failed check gets one retry with that reason before the run hands off to a person.

import type { Answer } from "../agent/answer.ts";
import type { CatalogHit } from "../tools/catalog.ts";
import type { HandoffReason } from "../tools/handoff.ts";
import type { BodyStyle, Recall } from "../tools/nhtsa.ts";

// What the tools returned during this run. The rules only trust this.
export type RunEvidence = {
  recalls: Recall[];
  catalogHits: CatalogHit[];
  question: string;
  // From decode_vehicle, or the make, model, year and body style the agent passed to
  // its tools. bodyStyle stays undefined until a VIN or the customer settles it.
  vehicle?: { make: string; model: string; year: number; bodyStyle?: BodyStyle };
  // The ticket id when create_handoff ran in this run.
  handoffTicket?: string;
  // How many tools ran before this answer; set by the loop. Undefined skips the rule below.
  toolsUsed?: number;
};

export type Violation = { rule: string; detail: string };

// NHTSA campaign numbers: two-digit year, a type letter (V vehicle, E equipment,
// T tires, C child seats), six digits. "17V706000".
const CAMPAIGN = /\b\d{2}[VETC]\d{6}\b/gi;

export const campaignsIn = (text: string) => [...new Set((text.match(CAMPAIGN) ?? []).map((c) => c.toUpperCase()))];

// Every rule, in the order a reader would fix them. An empty list means the answer may
// go to the customer.
export function checkAnswer(answer: Answer, evidence: RunEvidence): Violation[] {
  return [
    ...checkSafetyFirst(answer, evidence),
    ...checkCitations(answer, evidence),
    ...checkApplicability(answer, evidence),
    ...checkFits(answer, evidence),
    ...checkHandoff(answer, evidence),
    ...checkNoLookupsShort(answer, evidence),
  ];
}

// An answer that looked nothing up and hands nothing off stays short and carries no code:
// asking for the car, or saying what the assistant can help with. Anything else is the chat
// used as a free general-purpose assistant (review, 2026-11-14).
//
// Code refused outright, and 450 characters instead of 600, after the full eval (case
// offtopic-code, one run per model): asked for a Python function, Haiku wrote it in 520
// characters and Sonnet in 415, both under the old 600; Opus declined in 295 (Mat: "ok do
// it", 2026-11-14). 450 because the good no-lookup refusals ran 251 to 384 characters (n=7,
// eval and replays); 350 sent Opus's 384-character weather refusal back.
export const NO_LOOKUP_MAX_CHARS = 450;
// Code-shaped text: a fence, a Python def or import, a JS function or arrow, a print or
// console call. Car answers do not contain these.
const CODE = /```|^\s*(?:def|class|import|from)\s+\w+|\bfunction\s*\w*\s*\(|=>\s*[{(\w]|\b(?:print|console\.log)\s*\(|\breturn\s+[\w(]/m;
export function checkNoLookupsShort(answer: Answer, evidence: RunEvidence): Violation[] {
  if (evidence.toolsUsed !== 0 || answer.handoff) return [];
  if (answer.text.length <= NO_LOOKUP_MAX_CHARS && !CODE.test(answer.text)) return [];
  return [{ rule: "short_without_lookups", detail: `This answer looked nothing up. Keep it under ${NO_LOOKUP_MAX_CHARS} characters and write no code: ask for the year, make and model, or say what you can help with (recalls, complaints, ratings, parts, comparing cars).` }];
}

// ---------------------------------------------------------------- rule 1

// Cite only recalls a tool returned in this run, in the structured list and in the text,
// and keep the two in step so the page can link every recall it shows.
export function checkCitations(answer: Answer, evidence: RunEvidence): Violation[] {
  const returned = new Set(evidence.recalls.map((r) => r.campaign.toUpperCase()));
  const cited = new Set(answer.cited_recall_ids.map((c) => c.toUpperCase()));
  const out: Violation[] = [];
  const v = (detail: string) => out.push({ rule: "cite_only_returned", detail });

  for (const id of cited) {
    if (!returned.has(id)) v(`${id} is cited but no tool returned it in this run.`);
  }
  for (const id of campaignsIn(answer.text)) {
    if (!returned.has(id)) v(`${id} appears in the text but no tool returned it in this run.`);
    else if (!cited.has(id)) v(`${id} appears in the text but is missing from cited_recall_ids.`);
  }
  for (const id of answer.applies_to_vehicle.map((c) => c.toUpperCase())) {
    if (!returned.has(id)) v(`${id} is said to apply but no tool returned it in this run.`);
  }
  return out;
}

// ---------------------------------------------------------------- rule 2

// Which body styles of a model a recall covers, read from its summary. NHTSA's recall
// list is filtered by make, model and year only; the body styles are written in prose:
//   "certain 2017 Honda Civic Sedan and Coupe vehicles"          -> sedan, coupe
//   "certain 2017-2018 Honda Civic and CR-V vehicles"           -> every body style
//   "Civic Hatchback and Civic Type R vehicles", model "Civic"  -> hatchback
// A mention followed by another word ("Civic Type R", "Civic Si") is a different model
// or a trim and is skipped, so a recall for those alone reads as "not_named" for the
// plain model. That errs toward refusing an "applies" claim, never toward allowing one.
// Years in the summary are not read: NHTSA already filtered the list by year.
export type Coverage = { kind: "all" } | { kind: "bodies"; bodies: BodyStyle[] } | { kind: "not_named" };

const BODY = "(sedan|coupe|hatchback|wagon|convertible)";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function recallCoverage(summary: string, model: string): Coverage {
  const text = summary.replace(/\s+/g, " ");
  const mention = new RegExp(`\\b${escape(model)}\\b`, "gi");
  const bodiesAfter = new RegExp(`^ ${BODY}((?:\\s*(?:,|and|&)\\s*${BODY}\\b)*)`, "i");
  // "Ranger trucks" is as plain as "Civic vehicles": Ford names the 2006 Ranger only as
  // "Ranger trucks" in 4 of its 12 recorded recalls (17V787000, 17V788000, 15V322000, 11V352000).
  const bareAfter = /^\s*(?:$|[,.;)]|and\b|or\b|(?:vehicles?|trucks?|cars?|suvs?|vans?)\b)/i;

  const bodies = new Set<BodyStyle>();
  let bare = false;
  for (const m of text.matchAll(mention)) {
    const rest = text.slice(m.index! + m[0].length);
    const b = bodiesAfter.exec(rest);
    if (b) {
      for (const word of b[0].match(new RegExp(BODY, "gi")) ?? []) bodies.add(word.toLowerCase() as BodyStyle);
    } else if (bareAfter.test(rest)) {
      bare = true;
    }
  }
  if (bare) return { kind: "all" };
  if (bodies.size) return { kind: "bodies", bodies: [...bodies] };
  return { kind: "not_named" };
}

// Say a recall applies only when its summary covers the vehicle's body style, or covers
// every body style of the model. Otherwise the agent must ask for the body style or the
// VIN, and for the final word point to NHTSA's own VIN lookup.
export function checkApplicability(answer: Answer, evidence: RunEvidence): Violation[] {
  const out: Violation[] = [];
  const v = (detail: string) => out.push({ rule: "applies_needs_body_style", detail });
  const model = evidence.vehicle?.model;
  const body = evidence.vehicle?.bodyStyle;

  for (const id of answer.applies_to_vehicle.map((c) => c.toUpperCase())) {
    const recall = evidence.recalls.find((r) => r.campaign.toUpperCase() === id);
    if (!recall) continue; // rule 1 reports recalls that were never returned
    if (!model) {
      v(`${id} is said to apply, but the vehicle's model is not known in this run.`);
      continue;
    }
    const cov = recallCoverage(recall.summary, model);
    if (cov.kind === "all") continue;
    if (cov.kind === "not_named") {
      v(`${id} is said to apply, but its summary does not name the ${model}. Point the customer to NHTSA's VIN lookup instead.`);
    } else if (!body) {
      v(`${id} covers only the ${model} ${cov.bodies.join(", ")}. Ask for the body style or the VIN before saying it applies.`);
    } else if (!cov.bodies.includes(body)) {
      v(`${id} covers the ${model} ${cov.bodies.join(", ")}, not a ${body}.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- rule 3

// The fictional store's part numbers: "DP-BRK-F-CIV-SC".
const SKU = /\bDP-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi;

export const skusIn = (text: string) => [...new Set((text.match(SKU) ?? []).map((s) => s.toUpperCase()))];

// Say a part fits only when search_catalog returned it in this run, marked it
// "confirmed", and listed the vehicle's body style and year. Candidates that still
// need a body style may be shown, never called a fit. Every part number in the text
// must be a real catalog hit from this run.
export function checkFits(answer: Answer, evidence: RunEvidence): Violation[] {
  const out: Violation[] = [];
  const v = (detail: string) => out.push({ rule: "fits_needs_exact_match", detail });
  const hit = (sku: string) => evidence.catalogHits.find((h) => h.sku.toUpperCase() === sku);
  const body = evidence.vehicle?.bodyStyle;
  const year = evidence.vehicle?.year;

  for (const sku of answer.fits.map((s) => s.toUpperCase())) {
    const h = hit(sku);
    if (!h) {
      v(`${sku} is said to fit but the catalog did not return it in this run.`);
    } else if (h.fit !== "confirmed" || !body) {
      v(`${sku} is said to fit, but the catalog has not confirmed it for this body style. Ask for the body style or the VIN.`);
    } else if (!h.bodies.includes(body)) {
      v(`${sku} fits the ${h.bodies.join(", ")}, not a ${body}.`);
    } else if (year !== undefined) {
      const [from, to] = h.years.split("-").map(Number);
      if (year < from || year > to) v(`${sku} fits ${h.years}, not ${year}.`);
    }
  }

  for (const sku of skusIn(answer.text)) {
    if (!hit(sku)) v(`${sku} appears in the text but the catalog did not return it in this run.`);
  }
  return out;
}

// ---------------------------------------------------------------- rule 4

// NHTSA flags some recalls "park it" (do not drive until repaired) and some "park
// outside" (fire risk while parked). When one comes back for this car, the opening
// sentence carries that exact warning and names a flagged recall, before anything the
// customer asked about. A flagged recall whose summary covers other body styles only
// does not force it; one whose coverage cannot be read still does, because a missing
// warning is worse than an extra one.
// ['’]: models often write the typographic apostrophe, "Don’t drive" (U+2019).
const DO_NOT_DRIVE = /\b(?:do not|don['’]t|should not|must not|stop)\s+driv|\bnot\s+(?:be\s+)?driven\b/i;
const PARK_OUTSIDE = /\bpark[\w ,]*\b(?:outside|outdoors)\b/i;

const openingSentence = (text: string) => (text.trim().match(/^[\s\S]*?(?:[.!?](?=\s|$)|\n|$)/)?.[0] ?? "");

export function checkSafetyFirst(answer: Answer, evidence: RunEvidence): Violation[] {
  const model = evidence.vehicle?.model;
  const body = evidence.vehicle?.bodyStyle;
  const relevant = evidence.recalls.filter((r) => {
    if (!model || !body) return true;
    const cov = recallCoverage(r.summary, model);
    return !(cov.kind === "bodies" && !cov.bodies.includes(body));
  });

  const opening = openingSentence(answer.text);
  const named = new Set(campaignsIn(opening));
  const out: Violation[] = [];

  const kinds: [string, (r: Recall) => boolean, RegExp, string][] = [
    ["park it", (r) => r.parkIt, DO_NOT_DRIVE, "do not drive it until it is repaired"],
    ["park outside", (r) => r.parkOutSide, PARK_OUTSIDE, "park it outside, away from buildings, until it is repaired"],
  ];
  for (const [label, flagged, phrase, wording] of kinds) {
    const ids = relevant.filter(flagged).map((r) => r.campaign.toUpperCase());
    if (!ids.length) continue;
    if (!phrase.test(opening) || !ids.some((id) => named.has(id))) {
      out.push({
        rule: "safety_warning_first",
        detail: `${ids.join(", ")} ${ids.length > 1 ? "are" : "is"} marked "${label}" by NHTSA. Open the answer with that warning (${wording}) and name the recall in the same sentence.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- rule 5

// Refunds, orders, an upset customer and a request for a person go to a person: the
// agent has no order system and no authority to refund. Plain keyword patterns, written
// so recall questions do not trip them ("complaints about brakes" are NHTSA complaints;
// "in order to" is not an order). Checked in this order; the first match names the reason.
const INTENTS: [HandoffReason, RegExp][] = [
  ["refund", /\b(?:refund|money back|reimburse|chargeback)\b|\breturn (?:it|this|these|them|the|my)\b/i],
  [
    "order_problem",
    /\b(?:my order|order (?:number|status)|order\s*#|cancel (?:my|the|an|this) order|where(?:'s| is) my (?:order|package|parts?)|track(?:ing)? (?:my )?(?:order|package)|(?:never|hasn't|has not|didn't|did not) (?:arrive|arrived|come|ship|shipped))\b/i,
  ],
  [
    "angry_customer",
    /\b(?:unacceptable|ridiculous|terrible service|worst (?:service|store|company)|furious|i want to complain|file a complaint|make a complaint|speak (?:to|with) (?:a|your|the) manager|scam)\b/i,
  ],
  ["customer_asked", /\b(?:talk|speak|chat) (?:to|with) (?:a |an )?(?:human|person|real person|someone|agent|representative)\b/i],
];

export function handoffIntent(question: string): HandoffReason | null {
  for (const [reason, pattern] of INTENTS) if (pattern.test(question)) return reason;
  return null;
}

export function checkHandoff(answer: Answer, evidence: RunEvidence): Violation[] {
  const out: Violation[] = [];
  const intent = handoffIntent(evidence.question);
  if (intent && !answer.handoff) {
    out.push({ rule: "handoff_when_asked", detail: `The customer's request reads as "${intent}". Call create_handoff and set handoff to true.` });
  }
  if (answer.handoff && !evidence.handoffTicket) {
    out.push({ rule: "handoff_when_asked", detail: "The answer says it hands off, but create_handoff did not run in this run." });
  }
  return out;
}
