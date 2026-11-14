// What every layout reads: the generated site data (scripts/export-site.ts), the chat's limits
// straight from the server's module, the six How-it-works steps and a few derived lines. No
// number here is typed in; site.ts turns them into words and is tested.

import { CHAT_LIMITS } from "../../../src/server/limits.ts";
import { STORE_NAME } from "../../../src/config.ts";
import site from "../site-data.json";
import { howSteps, money, walkthrough } from "../site.ts";
import { evalsView } from "../evals.ts";
import type { MapCtx } from "../system-map.ts";
import { EVAL_RUNS, replayOf } from "../App.tsx";

export { CHAT_LIMITS, STORE_NAME, site };

export const HOW = howSteps({ model: site.model, agent: site.agent, chat: CHAT_LIMITS });
export const RUN_SECONDS = CHAT_LIMITS.runMs / 1000;
// What the system map draws and says: the model, tools and rules from the export, the limits from the server's module.
export const MAP_CTX: MapCtx = { model: site.model, tools: site.agent.tools, rules: site.agent.rules, limits: site.agent.limits, chat: CHAT_LIMITS, mode: "live" };
export const walk = (key: string) => walkthrough(replayOf(key), site.agent.limits, RUN_SECONDS);

const runs = site.runs;
export const COST_RANGE = `${money(runs.costUsd.min)} to ${money(runs.costUsd.max)}`;
export const COST_TOTAL = money(runs.costUsd.total, 2);
export const EVALS = evalsView(EVAL_RUNS);

export type BuiltData = { repo: string | null; steps: { title: string; text: string; fact: string; url: string | null }[]; badge: string | null; links: { label: string; url: string }[] };
export const BUILT = site.built as BuiltData;

// The disclaimer every layout ends with (PLAN.md section 7), word for word as before the layouts.
export const DISCLAIMER =
  "Fictional store for a demo. Not affiliated with NHTSA, any manufacturer or any retailer. Recall data from NHTSA. For the official recall status of one car, check nhtsa.gov/recalls with its VIN.";

// What the system is made of (PLAN.md section 5), for the footers.
export const STACK = ["TypeScript", "React", "Vite", site.model.name, "NHTSA APIs", "AWS Lambda", "CloudFront", "DynamoDB", "Cloudflare Turnstile"];
