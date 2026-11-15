// Write the scripted replays the page plays until real model runs are recorded.
//
//   npm run replays:scripted
//
// Each replay is the real agent loop, the real tools and the real rules, run on the
// recorded NHTSA data, with a scripted fake model choosing the steps. No model is called
// and nothing is spent. The label says exactly that, and the page shows the label, so a
// scripted run is never passed off as a model's work. Real recordings replace these once
// a model may be called.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runAgent, type ModelTurn, type TraceEvent } from "../src/agent/loop.ts";
import { SAMPLES } from "../src/cli/ask.ts";
import { recordedFetch } from "../src/tools/recorded.ts";

const OUT = join(import.meta.dirname, "..", "web", "src", "replays");
const LABEL = "Scripted example: the tools and the rules ran for real on recorded NHTSA data, and the model's steps were scripted. No model was called.";
const CIVIC = { make: "Honda", model: "Civic", year: 2017 };
const QUESTION = SAMPLES[0].question;

let n = 0;
const use = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `scripted_${++n}`, name, input });
const turn = (...content: ModelTurn["content"]): ModelTurn => ({ content, stop_reason: "tool_use" });

const GOOD_TEXT =
  "No recall covers the brakes on a 2017 Civic. NHTSA lists 6 recalls for this car and none is for brakes; " +
  "37 owners have reported brake problems, which are complaints, not recalls. Grinding when you stop usually " +
  "means worn pads or rotors, so please have the brakes inspected soon. For pads, DP-BRK-F-CIV-SC fits the sedan " +
  "and coupe and DP-BRK-F-CIV-HB fits the hatchback. Which body style is your Civic? If you share the VIN I can " +
  "also check which of the 6 recalls apply to it.";

const answer = (text: string, cited: string[] = []) =>
  use("submit_answer", { text, cited_recall_ids: cited, applies_to_vehicle: [], fits: [], handoff: false });

const lookups = [
  turn(use("get_recalls", CIVIC)),
  turn(use("search_complaints", { ...CIVIC, component: "SERVICE BRAKES" })),
  turn(use("search_catalog", { ...CIVIC, part: "front brake pads" })),
];

const scripts: Record<string, ModelTurn[]> = {
  brakes: [...lookups, turn(answer(GOOD_TEXT))],
  guard: [
    ...lookups,
    turn(answer("Your brakes are covered by recall 99V999000. Book a free repair at a dealer.", ["99V999000"])),
    turn(answer(GOOD_TEXT)),
  ],
};

mkdirSync(OUT, { recursive: true });
for (const [name, turns] of Object.entries(scripts)) {
  let i = 0;
  const events: TraceEvent[] = [];
  const result = await runAgent({
    question: QUESTION,
    client: async () => turns[Math.min(i++, turns.length - 1)],
    deps: { fetchJson: recordedFetch() },
    emit: (e) => events.push(e),
  });
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, JSON.stringify({ label: LABEL, question: QUESTION, status: result.status, events }, null, 2) + "\n");
  console.log(`${name}: ${result.status}, ${events.length} events -> ${file}`);
}
