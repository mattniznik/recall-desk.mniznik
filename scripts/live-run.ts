// One real run of the agent with Claude, on the recorded NHTSA data by default.
//
//   npm run live:run -- [--question "..."] [--save <name>] [--live-nhtsa]
//
// This spends real money from the Anthropic account behind RECALL_DESK_ANTHROPIC_KEY.
// The key is read from .env.local (gitignored) and never printed. The tools run on the
// recordings unless --live-nhtsa, so the only cost is the model. Every model call's usage
// is priced with src/agent/cost.ts and the total is printed, so the plan's estimate gets
// replaced by measured numbers. --save writes the run as a replay the page can play,
// labeled as a real run with its model, tokens and cost.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { anthropicClient, MODEL } from "../src/agent/anthropic.ts";
import { costUsd } from "../src/agent/cost.ts";
import { runAgent, type TraceEvent } from "../src/agent/loop.ts";
import { SAMPLES } from "../src/cli/ask.ts";
import { fetchJson as liveFetch } from "../src/tools/http.ts";
import { recordedFetch } from "../src/tools/recorded.ts";

const ROOT = join(import.meta.dirname, "..");

function readKey(): string {
  const text = readFileSync(join(ROOT, ".env.local"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("RECALL_DESK_ANTHROPIC_KEY="));
  const key = line?.slice("RECALL_DESK_ANTHROPIC_KEY=".length).trim() ?? "";
  if (!key) throw new Error("RECALL_DESK_ANTHROPIC_KEY is empty in .env.local");
  return key;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function show(e: TraceEvent) {
  switch (e.type) {
    case "model_call": {
      const u = e.usage;
      console.log(`model ${e.n}: ${e.stopReason}, ${e.model ?? "?"}, in ${u?.input_tokens ?? 0} / cache write ${u?.cache_creation_input_tokens ?? 0} / cache read ${u?.cache_read_input_tokens ?? 0} / out ${u?.output_tokens ?? 0}`);
      break;
    }
    case "tool_call":
      console.log(`  tool ${e.name} ${JSON.stringify(e.input)}`);
      break;
    case "tool_result":
      console.log(`  -> ${e.ok ? "ok" : "error"}: ${e.summary} (${e.ms} ms)`);
      break;
    case "rule_failed":
      console.log(`  BLOCKED: ${e.violations.map((v) => v.detail).join(" | ")}`);
      break;
    case "answer":
      console.log(`\nANSWER (passed every rule):\n${e.answer.text}\ncited: ${e.answer.cited_recall_ids.join(", ") || "none"}; applies: ${e.answer.applies_to_vehicle.join(", ") || "none"}; fits: ${e.answer.fits.join(", ") || "none"}; handoff: ${e.answer.handoff}`);
      break;
    case "handoff":
      console.log(`\nHANDED OFF (${e.reason}), ticket ${e.ticketId}`);
      break;
  }
}

async function main() {
  const question = arg("question") ?? SAMPLES[0].question;
  const save = arg("save");
  const fetchJson = process.argv.includes("--live-nhtsa") ? liveFetch : recordedFetch();
  const events: TraceEvent[] = [];
  const started = Date.now();

  console.log(`question: ${question}\nmodel: ${MODEL}, effort low, NHTSA data: ${fetchJson === liveFetch ? "live" : "recorded"}\n`);
  const result = await runAgent({
    question,
    client: anthropicClient({ apiKey: readKey() }),
    deps: { fetchJson },
    emit: (e) => {
      events.push(e);
      show(e);
    },
  });

  const calls = events.filter((e): e is Extract<TraceEvent, { type: "model_call" }> => e.type === "model_call");
  const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let cost: number | null = 0;
  for (const c of calls) {
    const u = c.usage ?? { input_tokens: 0, output_tokens: 0 };
    tokens.input += u.input_tokens;
    tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
    tokens.cacheRead += u.cache_read_input_tokens ?? 0;
    tokens.output += u.output_tokens;
    const c$ = costUsd(c.model ?? MODEL, u);
    cost = cost === null || c$ === null ? null : cost + c$;
  }
  const seconds = (Date.now() - started) / 1000;
  const costText = cost === null ? "unknown (a model without a price entry answered)" : `$${cost.toFixed(4)}`;
  console.log(
    `\nstatus: ${result.status}${result.reason ? ` (${result.reason})` : ""}; ${calls.length} model calls, ${result.toolCalls} tool calls, ${seconds.toFixed(1)} s` +
      `\ntokens: input ${tokens.input}, cache write ${tokens.cacheWrite}, cache read ${tokens.cacheRead}, output ${tokens.output}\ncost: ${costText}`,
  );

  if (save) {
    const date = new Date().toISOString().slice(0, 10);
    const total = tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output;
    const label = `Real run: ${calls.at(-1)?.model ?? MODEL}, effort low, on recorded NHTSA data, ${date}. ${calls.length} model calls, ${total.toLocaleString("en-US")} tokens, ${costText}.`;
    const file = join(ROOT, "web", "src", "replays", `${save}.json`);
    writeFileSync(file, JSON.stringify({ label, question, status: result.status, real: true, costUsd: cost, tokens, seconds, events }, null, 2) + "\n");
    console.log(`saved ${file}`);
  }
}

main().catch((e) => {
  // SDK errors carry a status and a message; neither includes the key.
  console.error(`run failed: ${e?.status ?? ""} ${e?.message ?? e}`);
  process.exitCode = 1;
});
