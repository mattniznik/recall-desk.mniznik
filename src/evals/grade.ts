// The eval graders. Every pass or fail is decided here, by code, from
// the answer the run produced and the recorded data the case is about. No model grades.
//
// The ground truth is read from the same recordings the agent's tools read
// (fixtures/nhtsa) and the same catalog (data/catalog.json), so a case can only expect
// what the data holds. Text checks (says no recall, asks for the VIN) are regex heuristics
// and are labelled so in their reasons; the structured fields carry the hard checks.

import catalogJson from "../../data/catalog.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Answer } from "../agent/answer.ts";
import { campaignsIn, checkSafetyFirst, skusIn } from "../guards/rules.ts";
import type { FetchJson } from "../tools/http.ts";
import { getRecalls, type Recall } from "../tools/nhtsa.ts";
import type { EvalCase } from "./cases.ts";
import { evalFetch } from "./fixtures.ts";
import type { SessionRecord } from "../mcp/session.ts";

// What a run produced, as the grader sees it. `status` is "handoff" only when the harness
// handed the customer over (the rules failed twice, a cap, no answer); a handoff the model
// chose is an answered run with answer.handoff true.
export type CaseOutcome = {
  status: "answered" | "handoff";
  reason?: string;
  answer: Answer;
  toolsCalled: string[];
};

// What the recordings say about the case's vehicle.
export type Ground = { recalls: Recall[] | null; campaigns: Set<string>; skus: Set<string> };

export type Grade = { passed: boolean; reasons: string[] };

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "nhtsa");
const SKUS = new Set((catalogJson as { parts: { sku: string }[] }).parts.map((p) => p.sku.toUpperCase()));

// Every campaign in every recorded recall list: what a case without a vehicle may cite.
function allRecordedCampaigns(): Set<string> {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as { files: Record<string, { file: string; url: string }> };
  const out = new Set<string>();
  for (const f of Object.values(manifest.files)) {
    if (!f.url.includes("/recalls/recallsByVehicle")) continue;
    const body = JSON.parse(readFileSync(join(FIXTURES, f.file), "utf8")) as { results?: { NHTSACampaignNumber: string }[] };
    for (const r of body.results ?? []) out.add(r.NHTSACampaignNumber.toUpperCase());
  }
  return out;
}

export async function groundFor(c: EvalCase, fetchJson: FetchJson = evalFetch()): Promise<Ground> {
  if (!c.vehicle) return { recalls: null, campaigns: allRecordedCampaigns(), skus: SKUS };
  const r = await getRecalls({ make: c.vehicle.make, model: c.vehicle.model, year: c.vehicle.year }, { fetchJson });
  if (!r.ok) throw new Error(`${c.id}: no recorded recalls for its vehicle (${r.error})`);
  return { recalls: r.recalls, campaigns: new Set(r.recalls.map((x) => x.campaign.toUpperCase())), skus: SKUS };
}

export function outcomeOf(record: SessionRecord): CaseOutcome {
  if (record.status === "pending" || !record.answer) throw new Error("the session has no final answer; finish it with finishUnanswered first");
  return { status: record.status, reason: record.reason, answer: record.answer, toolsCalled: record.toolCalls.map((t) => t.name) };
}

// ---------------------------------------------------------------- text heuristics

// Models write curly apostrophes as often as straight ones.
const plain = (text: string) => text.replace(/[‘’]/g, "'");
const sentences = (text: string) => plain(text).split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
const NEGATION = /\b(?:no|not|none|never|nothing|neither|nor|without)\b|n't\b/i;

// The answer says plainly that no recall covers the topic: one sentence carries a negation
// and the topic, and "recall" is in that sentence or the one before it ("The 2017 Civic has
// 6 recalls. None of them involve the brakes.").
export function saysNoRecall(text: string, topic: RegExp): boolean {
  const s = sentences(text);
  return s.some((cur, i) => NEGATION.test(cur) && topic.test(cur) && /recall/i.test(`${s[i - 1] ?? ""} ${cur}`));
}

// The answer asks for what decides applicability: the VIN or the body style, as a question
// or a request. Pointing the customer to nhtsa.gov with the VIN counts; guessing does not.
const MENTIONS = /\bVIN\b|\bbody style\b|\b(?:sedan|coupe|hatchback)\b[^.?!]*\b(?:sedan|coupe|hatchback)\b/i;
const REQUEST = /\?|\b(?:send|share|tell|give|provide|enter|check|let me know|reply with)\b/i;

export function asksForVinOrBody(text: string): boolean {
  const t = plain(text);
  return MENTIONS.test(t) && REQUEST.test(t);
}

// ---------------------------------------------------------------- the grader

const upper = (xs: string[]) => new Set(xs.map((x) => x.trim().toUpperCase()));
const list = (s: Iterable<string>) => [...s].sort().join(", ") || "none";

export function gradeCase(c: EvalCase, o: CaseOutcome, g: Ground): Grade {
  if (o.status !== "answered") {
    return { passed: false, reasons: [`no accepted answer: the harness handed the customer to a person (${o.reason ?? "unknown"})`] };
  }
  const e = c.expect;
  const a = o.answer;
  const reasons: string[] = [];
  const fail = (r: string) => reasons.push(r);
  const cited = upper(a.cited_recall_ids);
  const applies = upper(a.applies_to_vehicle);
  const fits = upper(a.fits);
  const inText = campaignsIn(a.text);
  const where = c.vehicle ? `the ${c.vehicle.year} ${c.vehicle.make} ${c.vehicle.model}` : "any recorded vehicle";

  // Every case: nothing cited that the recordings do not hold, no invented part numbers,
  // a handoff only when the case is one, and the lookups the question needs.
  for (const id of new Set([...cited, ...applies, ...inText])) if (!g.campaigns.has(id)) fail(`${id} is not a recall the recordings hold for ${where}`);
  for (const sku of new Set([...fits, ...skusIn(a.text)])) if (!g.skus.has(sku)) fail(`${sku} is not a catalog part number`);
  const wantHandoff = e.handoff ?? false;
  if (a.handoff !== wantHandoff) fail(wantHandoff ? "did not hand the customer to a person" : "handed off a question it should have answered");
  for (const t of e.tools_called ?? []) if (!o.toolsCalled.includes(t)) fail(`never called ${t}`);

  if (e.cited_equals) {
    const want = upper(e.cited_equals);
    const missing = [...want].filter((x) => !cited.has(x));
    const extra = [...cited].filter((x) => !want.has(x));
    if (missing.length || extra.length) {
      fail(`cited ${cited.size} of ${want.size} expected recalls` + (missing.length ? `; missing ${list(missing)}` : "") + (extra.length ? `; extra ${list(extra)}` : ""));
    }
  }
  for (const id of e.cited_includes ?? []) if (!cited.has(id)) fail(`did not cite ${id}`);
  for (const id of e.cited_excludes ?? []) if (cited.has(id) || inText.includes(id)) fail(`cited ${id}`);
  if (e.cited_none && cited.size) fail(`cited ${list(cited)}; expected none`);

  for (const id of e.applies_includes ?? []) if (!applies.has(id)) fail(`did not say ${id} applies (applies_to_vehicle: ${list(applies)})`);
  for (const id of e.applies_excludes ?? []) if (applies.has(id)) fail(`said ${id} applies to this vehicle`);
  if (e.applies_none && applies.size) fail(`said ${list(applies)} applies; expected none`);

  if (e.fits_none && fits.size) fail(`claimed a fit: ${list(fits)}`);
  for (const sku of e.fits_excludes ?? []) if (fits.has(sku)) fail(`said ${sku} fits`);

  if (e.opening_warns) {
    if (!g.recalls) fail("opening_warns needs a case vehicle with recorded recalls");
    else {
      const parkIt = e.opening_warns === "park_it";
      const flagged = g.recalls.filter((r) => (parkIt ? r.parkIt : r.parkOutSide));
      // Only the flagged recalls of this kind, and no vehicle: every one counts, so the
      // rule asks for that warning and nothing else.
      if (!flagged.length || checkSafetyFirst(a, { recalls: flagged, catalogHits: [], question: c.question }).length) {
        const opening = sentences(a.text)[0] ?? "";
        fail(`the first sentence does not carry the "${parkIt ? "do not drive" : "park outside"}" warning with a flagged recall: "${opening.slice(0, 160)}"`);
      }
    }
  }
  if (e.says_no_recall !== undefined && !saysNoRecall(a.text, new RegExp(e.says_no_recall, "i"))) {
    fail(`does not say plainly that no recall covers it (text heuristic, topic /${e.says_no_recall}/)`);
  }
  if (e.asks_for_vin_or_body && !asksForVinOrBody(a.text)) fail("did not ask for the VIN or the body style (text heuristic)");
  if (e.max_chars !== undefined && a.text.length > e.max_chars) fail(`answer is ${a.text.length} characters; limit ${e.max_chars}`);
  for (const s of e.text_excludes ?? []) if (a.text.toLowerCase().includes(s.toLowerCase())) fail(`text contains "${s}"`);

  return { passed: reasons.length === 0, reasons };
}
