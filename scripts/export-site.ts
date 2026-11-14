// Writes web/src/site-data.json: every number the page's "How it works", "Results" and "How
// it was built" sections show, read from the repository so none is typed in by hand.
//
// Usage (from the repo root):
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/export-site.ts
//
// What it reads:
// - the test suite, by RUNNING it (node --test with the TAP reporter, the same files as
//   `npm test`) and reading its "# tests / # pass / # fail" totals. It refuses to export while
//   any test fails, so the page never shows a count from a red suite.
// - the recorded runs in web/src/replays/ (real ones carry the cost, tokens and time the API
//   reported), the agent's limits, tools and model (src/agent), the rule ids (src/guards),
//   the NHTSA recordings' manifest, and docs/decisions/ when it exists.
// - `git remote get-url origin`: GitHub links appear only once the repository has one.
//
// Ported from rag.irs.mniznik's scripts/export_site.py. The pure parts are exported and
// tested in test/web-site-data.test.ts; main() runs only when this file is run directly.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Replay } from "../web/src/trace.ts";

const ROOT = join(import.meta.dirname, "..");

// ---------------------------------------------------------------- pure parts

/** The totals node --test prints at the end ("# tests 137", "# pass 137", "# fail 0"). */
export function countTap(output: string): { tests: number; pass: number; fail: number } {
  const n = (k: string) => {
    const m = output.match(new RegExp(`^# ${k} (\\d+)$`, "m"));
    if (!m) throw new Error(`no "# ${k} N" line in the node --test output`);
    return Number(m[1]);
  };
  return { tests: n("tests"), pass: n("pass"), fail: n("fail") };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export type RunRow = {
  key: string;
  question: string;
  status: string;
  modelCalls: number;
  toolCalls: number;
  tokens: number;
  costUsd: number;
  seconds: number;
  caught: number;
  handoff: boolean;
};

export type RunsSummary = {
  count: number;
  scripted: number;
  costUsd: { total: number; min: number; max: number };
  seconds: { min: number; max: number };
  caught: number;
  fixedOnRetry: number;
  handoffs: number;
  runs: RunRow[];
};

/** The recorded real runs: what each cost and took, and how often a rule sent an answer back. */
export function runsSummary(replays: { key: string; replay: Replay }[]): RunsSummary {
  const real = replays.filter((r) => r.replay.real === true);
  const runs: RunRow[] = real.map(({ key, replay }) => {
    const count = (t: string) => replay.events.filter((e) => e.type === t).length;
    const t = replay.tokens ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    const answer = replay.events.find((e) => e.type === "answer");
    return {
      key,
      question: replay.question,
      status: replay.status,
      modelCalls: count("model_call"),
      toolCalls: count("tool_call"),
      tokens: t.input + t.cacheWrite + t.cacheRead + t.output,
      costUsd: replay.costUsd ?? 0,
      seconds: replay.seconds ?? 0,
      caught: count("rule_failed"),
      handoff: count("handoff") > 0 || (answer?.type === "answer" && answer.answer.handoff === true),
    };
  });
  const costs = runs.map((r) => r.costUsd);
  const secs = runs.map((r) => r.seconds);
  return {
    count: runs.length,
    scripted: replays.length - real.length,
    costUsd: { total: round(costs.reduce((s, x) => s + x, 0)), min: Math.min(...costs), max: Math.max(...costs) },
    seconds: { min: Math.min(...secs), max: Math.max(...secs) },
    caught: runs.filter((r) => r.caught > 0).length,
    fixedOnRetry: runs.filter((r) => r.caught > 0 && r.status === "answered" && !r.handoff).length,
    handoffs: runs.filter((r) => r.handoff).length,
    runs,
  };
}

/** Each rule id the checks can report ({ rule: "..." }), once, in the order they appear. */
export function ruleIds(source: string): string[] {
  return [...new Set([...source.matchAll(/rule: "([a-z_]+)"/g)].map((m) => m[1]))];
}

export type Decisions = { count: number; sources: number; first: { id: string; title: string; file: string } } | null;

/** Decision records ("# 0001. Title"), and how many distinct provider pages they cite. */
export function decisionsOf(files: { name: string; text: string }[]): Decisions {
  if (!files.length) return null;
  const links = new Set<string>();
  const heads = files.map((f) => {
    // Provider docs only: a link to GitHub (the sister repo, this repo) is not a provider page.
    for (const m of f.text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) if (!/^https?:\/\/github\.com\//.test(m[1])) links.add(m[1]);
    const h = f.text.trimStart().match(/^#\s+(\d{4})\.\s+(.+)/);
    if (!h) throw new Error(`${f.name}: a decision record must start with "# NNNN. Title"`);
    return { id: h[1], title: h[2].trim(), file: f.name };
  });
  return { count: files.length, sources: links.size, first: heads[0] };
}

/** The dot field's numbers, from the run's own tool results ("6 recalls", "38 of 606 complaints (brake)"). */
export function fieldOf(key: string, replay: Replay) {
  const summaries = replay.events.flatMap((e) => (e.type === "tool_result" ? [e.summary] : []));
  const recalls = summaries.map((s) => s.match(/^(\d+) recalls$/)).find(Boolean);
  const complaints = summaries.map((s) => s.match(/^(\d+) of (\d+) complaints(?: \((.+)\))?$/)).find(Boolean);
  if (!recalls || !complaints) throw new Error(`${key}: the field needs a recalls and a complaints lookup`);
  return { key, question: replay.question, recalls: Number(recalls[1]), complaints: Number(complaints[2]), matching: Number(complaints[1]), component: complaints[3] ?? "" };
}

/** One recall from a recorded NHTSA reply, for the page that shows the record an answer read. */
export function recordOf(reply: { results?: Record<string, string>[] }, campaign: string, url: string) {
  const r = (reply.results ?? []).find((x) => x.NHTSACampaignNumber === campaign);
  if (!r) throw new Error(`recall ${campaign} is not in the recording`);
  return { campaign, component: r.Component, summary: r.Summary.replace(/\s+/g, " ").trim(), url };
}

/** The body styles the applicability rule itself reads in the record's summary (src/guards/rules.ts). */
function withBodies<T extends { summary: string }>(record: T, coverage: (summary: string, model: string) => { kind: string; bodies?: string[] }) {
  const c = coverage(record.summary, "Civic");
  return { ...record, bodies: c.kind === "bodies" ? (c.bodies ?? []) : [] };
}

/** "claude-opus-5-5" -> "Claude Opus 5.5" */
export function modelName(id: string): string {
  const m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)$/);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

/** The GitHub page of the origin remote, or null when there is none yet. */
export function repoUrl(remote: string | null): string | null {
  const m = remote?.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

export type Facts = {
  tests: { tests: number; pass: number; fail: number; files: number; ruleFiles: number };
  runs: RunsSummary;
  rules: number;
  decisions: Decisions;
  fixtures: { count: number; recordedAt: string };
};

export type BuiltStep = { title: string; text: string; fact: string; url: string | null };

const usd = (x: number, d = 4) => "$" + x.toFixed(d);

/** "How it was built": rag.irs's loop, adapted. Every number in a fact comes from `facts`. */
export function builtSteps(f: Facts, repo: string | null): BuiltStep[] {
  const at = (path: string) => (repo ? `${repo}/${path}` : null);
  const r = f.runs;
  return [
    {
      title: "Plan with sources",
      text: "The plan came first: each piece of technology, why it was picked, and the provider's own docs for how it behaves, read before relying on it.",
      ...(f.decisions
        ? { fact: `${f.decisions.count} decision records cite ${f.decisions.sources} provider pages`, url: at("tree/main/docs/decisions") }
        : { fact: `${f.fixtures.count} NHTSA replies recorded on ${f.fixtures.recordedAt.slice(0, 10)}, so the tests run on real data`, url: at("tree/main/fixtures/nhtsa") }),
    },
    {
      title: "Write the test, watch it fail",
      text: "Each change starts with a test, and it has to fail on the old code for the reason expected before the code is written.",
      fact: `${f.tests.tests} tests in ${f.tests.files} files, all passing`,
      url: at("tree/main/test"),
    },
    {
      title: "Change the code",
      text: "Small steps, each with its tests. What the model must not do is checked by code after it answers, not only asked for in the prompt.",
      fact: `${f.rules} rules checked in code, with ${f.tests.ruleFiles} test files of their own`,
      url: at("blob/main/src/guards/rules.ts"),
    },
    {
      title: "Measure on real runs",
      text: "Real Claude runs are recorded with the tokens, cost and time the API reported, then replayed on this page at no cost.",
      fact: `${r.count} real runs recorded, ${usd(r.costUsd.total, 2)} measured in all, ${usd(r.costUsd.min)} to ${usd(r.costUsd.max)} each`,
      url: at("tree/main/web/src/replays"),
    },
    {
      title: "Independent review",
      text: "Code reviews every answer before a customer sees it, and a reviewer with fresh context reads each change that touches money, the live model or more than one area.",
      fact: `The rules sent back ${r.caught} of ${r.count} recorded real answers; ${r.fixedOnRetry} passed on the retry`,
      url: at("blob/main/src/guards/rules.ts"),
    },
    {
      title: "Deploy, then check live",
      text: "The page is built fresh and uploaded, then the live site is checked: the page itself, the API's status, and requests that must be refused.",
      fact: "The production build runs inside the test suite on every change",
      url: at("blob/main/test/web-build.test.ts"),
    },
  ];
}

// ---------------------------------------------------------------- main

const NODE_TEST = ["--test", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--test-reporter=tap", "test/**/*.test.ts"];

function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(keep);
}

async function main() {
  // the suite, run for real
  const run = spawnSync(process.execPath, NODE_TEST, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const totals = countTap(run.stdout + run.stderr);
  if (totals.fail > 0 || totals.pass !== totals.tests) throw new Error(`the suite is not green (${totals.pass} of ${totals.tests} pass): fix it before exporting`);
  const testFiles = filesIn(join(ROOT, "test"), (f) => f.endsWith(".test.ts"));

  const replayDir = join(ROOT, "web", "src", "replays");
  const replays = filesIn(replayDir, (f) => f.endsWith(".json")).map((f) => ({ key: f.slice(0, -5), replay: JSON.parse(readFileSync(join(replayDir, f), "utf8")) as Replay }));
  const runs = runsSummary(replays);

  const rules = ruleIds(readFileSync(join(ROOT, "src", "guards", "rules.ts"), "utf8"));
  const decDir = join(ROOT, "docs", "decisions");
  const decisions = existsSync(decDir)
    ? decisionsOf(filesIn(decDir, (f) => /^\d{4}-.+\.md$/.test(f)).sort().map((name) => ({ name, text: readFileSync(join(decDir, name), "utf8") })))
    : null;
  const manifest = JSON.parse(readFileSync(join(ROOT, "fixtures", "nhtsa", "manifest.json"), "utf8"));

  const { TOOL_DEFS } = await import("../src/agent/tools.ts");
  const { LIMITS } = await import("../src/agent/loop.ts");
  const { MODEL } = await import("../src/agent/anthropic.ts");
  const { recallCoverage } = await import("../src/guards/rules.ts");

  let remote: string | null = null;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    remote = null; // no remote yet
  }
  const repo = repoUrl(remote);
  const ci = repo && existsSync(join(ROOT, ".github", "workflows", "ci.yml"));

  const facts: Facts = {
    tests: { ...totals, files: testFiles.length, ruleFiles: testFiles.filter((f) => /(^|[\\/])rule-[^\\/]+\.test\.ts$/.test(f)).length },
    runs,
    rules: rules.length,
    decisions,
    fixtures: { count: Object.keys(manifest.files).length, recordedAt: manifest.recordedAt },
  };
  const brakes = replays.find((r) => r.key === "real-brakes");
  if (!brakes) throw new Error("web/src/replays/real-brakes.json is gone: the dot field needs a run with a recalls and a complaints lookup");
  const civic = manifest.files.civic2017Recalls;

  const data = {
    tests: { ...facts.tests, method: "ran npm test's files with node --test and read its totals" },
    model: { id: MODEL, name: modelName(MODEL) },
    agent: {
      tools: TOOL_DEFS.filter((t) => t.name !== "submit_answer").map((t) => ({ name: t.name, description: t.description })),
      rules,
      limits: LIMITS,
    },
    runs,
    field: fieldOf(brakes.key, brakes.replay),
    record: withBodies(recordOf(JSON.parse(readFileSync(join(ROOT, "fixtures", "nhtsa", civic.file), "utf8")), "17V706000", civic.url), recallCoverage),
    decisions,
    fixtures: facts.fixtures,
    built: {
      repo,
      steps: builtSteps(facts, repo),
      badge: ci ? `${repo}/actions/workflows/ci.yml/badge.svg` : null,
      links: repo
        ? [
            ...["AGENTS.md", "SECURITY.md"].filter((f) => existsSync(join(ROOT, f))).map((f) => ({ label: f, url: `${repo}/blob/main/${f}` })),
            { label: "The code", url: repo },
          ]
        : [],
    },
  };
  const out = join(ROOT, "web", "src", "site-data.json");
  writeFileSync(out, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`wrote web/src/site-data.json: ${totals.tests} tests in ${testFiles.length} files, ${runs.count} real runs (${usd(runs.costUsd.total, 4)}), ${rules.length} rules, repo ${repo ?? "none yet"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
