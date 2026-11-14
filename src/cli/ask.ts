// Run the agent's tools from a terminal, without a model.
//
//   npm run ask -- get_recalls --make Honda --model Civic --year 2017
//   npm run ask -- search_catalog --part "front brake pads" --make Honda --model Civic --year 2017 --bodyStyle sedan
//   npm run ask -- --samples              live NHTSA
//   npm run ask -- --samples --offline    recordings only, no network
//
// This is how the tools get checked by eye before any money is spent on a model: what
// the agent will read for each of the three sample questions, exactly as it will read it.
// Run npm from Bash, not PowerShell: npm.ps1 drops the arguments after "--".

import { fileURLToPath } from "node:url";

import { fetchJson as liveFetch, type Deps } from "../tools/http.ts";
import { recordedFetch } from "../tools/recorded.ts";
import { TOOLS, runTool } from "../agent/tools.ts";

export { TOOLS, runTool };

type Args = Record<string, unknown>;

export function parseArgs(argv: string[]): { tool: string | null; args: Args; offline: boolean; samples: boolean } {
  const out = { tool: null as string | null, args: {} as Args, offline: false, samples: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") out.offline = true;
    else if (a === "--samples") out.samples = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[++i] ?? "";
      out.args[key] = key === "year" ? Number(value) : value;
    } else if (!out.tool) out.tool = a;
  }
  return out;
}

const CIVIC = { make: "Honda", model: "Civic", year: 2017 };

export const SAMPLES: { question: string; steps: { tool: string; args: Args }[] }[] = [
  {
    question: "2017 Civic, grinding brakes when I stop. Any recall?",
    steps: [
      { tool: "get_recalls", args: CIVIC },
      { tool: "search_complaints", args: { ...CIVIC, component: "SERVICE BRAKES" } },
      { tool: "search_catalog", args: { ...CIVIC, part: "front brake pads" } },
    ],
  },
  {
    question: "Does recall 17V706000 apply to my 2017 Civic hatchback?",
    steps: [
      { tool: "list_models", args: { make: "Honda", year: 2017, query: "civic" } },
      { tool: "get_recalls", args: CIVIC },
    ],
  },
  {
    question: "Front brake pads for a 2017 Civic sedan, and how safe is that car?",
    steps: [
      { tool: "search_catalog", args: { ...CIVIC, part: "front brake pads", bodyStyle: "sedan" } },
      { tool: "get_safety_rating", args: { ...CIVIC, bodyStyle: "sedan" } },
    ],
  },
];

export async function runSamples(deps: Deps) {
  const results = [];
  for (const s of SAMPLES) {
    const steps = [];
    for (const step of s.steps) steps.push({ ...step, result: await runTool(step.tool, step.args, deps) });
    results.push({ question: s.question, steps });
  }
  return results;
}

async function main() {
  const { tool, args, offline, samples } = parseArgs(process.argv.slice(2));
  const deps: Deps = { fetchJson: offline ? recordedFetch() : liveFetch };
  if (samples) {
    for (const s of await runSamples(deps)) {
      console.log(`\n=== ${s.question}`);
      for (const step of s.steps) console.log(`\n--> ${step.tool} ${JSON.stringify(step.args)}\n${JSON.stringify(step.result, null, 2)}`);
    }
  } else if (tool) {
    console.log(JSON.stringify(await runTool(tool, args, deps), null, 2));
  } else {
    console.error("usage: ask <tool> --name value ... | ask --samples [--offline]");
    console.error(`tools: ${Object.keys(TOOLS).join(", ")}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
