// Run the eval cases (evals/cases.json) through Claude Code on Mat's Claude subscription
// login, never an API key, and grade every answer in code (src/evals/grade.ts).
//
//   npm run eval:sub -- --model haiku --smoke             the 3 smoke cases
//   npm run eval:sub -- --model haiku --cases id1,id2     chosen cases
//   npm run eval:sub -- --model opus                      all 50 cases: uses plan limits, Mat decides
//   npm run eval:sub -- --model haiku --smoke --dry-run   check the login, print the command, run nothing
//   add --debug to keep each case's temp folder with a Claude Code debug log (never in the repo)
//
// Run npm from Bash, not PowerShell: npm.ps1 drops the arguments after "--".
//
// Per case: an empty temp folder as the working directory, a second temp folder for the
// system prompt, the MCP config and the session record, then one `claude -p` with the
// flags in src/evals/claude-cli.ts. The model reaches the agent's tools only through the
// MCP server (src/mcp/server.ts), which runs them on the recorded NHTSA data and checks
// submit_answer with the production rules. The runner refuses to start unless
// `claude auth status` reports a claude.ai login, and checks it again before every case.
//
// This is not the production path. Production calls the Anthropic API with the app's own
// key (src/agent/anthropic.ts); this path exists so evals can run on the subscription.
// Known differences: tool names reach the model as mcp__recalldesk__<name>; submit_answer
// is not a strict tool (parseAnswer still checks it); Claude Code adds its own request
// settings and a final text turn after the answer; a model that stops without
// submit_answer gets no nudge (the loop gives one) and is graded as a no_answer handoff.
// The results file says it is a subscription run, and its costs are estimates.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { LIMITS } from "../src/agent/loop.ts";
import { SYSTEM_PROMPT } from "../src/agent/prompt.ts";
import { TOOL_DEFS } from "../src/agent/tools.ts";
import { loadCases, loadSmokeIds, type EvalCase } from "../src/evals/cases.ts";
import {
  MODELS,
  SETTINGS,
  checkAuthStatus,
  childEnv,
  claudeArgs,
  mcpConfig,
  parseClaudeJson,
  resultsPath,
  toEvalRun,
  type CaseRow,
  type ClaudeRun,
  type ModelAlias,
} from "../src/evals/claude-cli.ts";
import { gradeCase, groundFor, outcomeOf } from "../src/evals/grade.ts";
import { serverCommand } from "../src/mcp/server-command.ts";
import { finishUnanswered, type SessionRecord } from "../src/mcp/session.ts";

const ROOT = join(import.meta.dirname, "..");
// One more turn than the loop's model calls: Claude Code ends a run with a text-only turn
// after the last tool call, which the loop does not make (docs/en/agent-sdk/agent-loop).
const MAX_TURNS = LIMITS.modelCalls + 1;
const CASE_TIMEOUT_MS = 240_000;

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);

function die(message: string): never {
  console.error(`eval:sub: ${message}`);
  process.exit(1);
}

function assertSubscription(env: Record<string, string>) {
  const r = spawnSync("claude", ["auth", "status"], { env, encoding: "utf8", windowsHide: true });
  const check = checkAuthStatus(r.stdout ?? "");
  if (!check.ok) die(`refusing to run: ${check.error}. Log in with \`claude auth login\` (claude.ai account); never set an API key.`);
  return check.authMethod;
}

function runClaude(args: string[], cwd: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      // The MCP server is claude's child; take the whole tree down.
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    }, CASE_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${e.message}`, timedOut });
    });
  });
}

function chooseCases(all: EvalCase[]): EvalCase[] {
  const ids = flag("smoke") ? loadSmokeIds() : arg("cases")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids) return all;
  const unknown = ids.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) die(`unknown case id ${unknown.join(", ")}`);
  return ids.map((id) => all.find((c) => c.id === id)!);
}

async function runCase(c: EvalCase, model: string, env: Record<string, string>, debug: boolean): Promise<CaseRow> {
  const cwd = mkdtempSync(join(tmpdir(), "recall-desk-eval-cwd-"));
  const cfg = mkdtempSync(join(tmpdir(), "recall-desk-eval-cfg-"));
  const file = (name: string) => join(cfg, name);
  writeFileSync(file("system-prompt.txt"), SYSTEM_PROMPT);
  writeFileSync(file("settings.json"), JSON.stringify(SETTINGS));
  writeFileSync(file("session.json"), JSON.stringify({ question: c.question, record: file("record.json"), ...(c.plant ? { plant: c.plant } : {}) }));
  writeFileSync(file("mcp.json"), JSON.stringify(mcpConfig(serverCommand(file("session.json")))));

  const args = claudeArgs({ model, systemPromptFile: file("system-prompt.txt"), mcpConfigFile: file("mcp.json"), settingsFile: file("settings.json"), maxTurns: MAX_TURNS, question: c.question });
  if (debug) args.splice(1, 0, "--debug-file", file("claude-debug.log"));

  const started = Date.now();
  const out = await runClaude(args, cwd, env);
  const seconds = Math.round((Date.now() - started) / 100) / 10;

  let run: ClaudeRun | null = null;
  let runError = "";
  try {
    run = parseClaudeJson(out.stdout);
  } catch (e) {
    runError = out.timedOut ? `timed out after ${CASE_TIMEOUT_MS / 1000} s` : `claude exited ${out.code}: ${(out.stderr || (e as Error).message).trim().slice(0, 300)}`;
  }

  let record: SessionRecord = existsSync(file("record.json"))
    ? JSON.parse(readFileSync(file("record.json"), "utf8"))
    : { question: c.question, status: "pending", toolCalls: [], submits: [] };
  record = finishUnanswered(record, run?.subtype === "error_max_turns" ? "cap" : "no_answer");
  const outcome = outcomeOf(record);
  const grade = gradeCase(c, outcome, await groundFor(c));
  const reasons = runError ? [`the run failed: ${runError}`, ...grade.reasons] : grade.reasons;

  if (debug) console.log(`    kept ${cfg}`);
  else for (const d of [cwd, cfg]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

  return {
    id: c.id,
    type: c.type,
    passed: grade.passed && !runError,
    reasons,
    question: c.question,
    status: record.status,
    ...(record.reason ? { handoffReason: record.reason } : {}),
    answer: record.answer,
    toolCalls: record.toolCalls.map((t) => ({ name: t.name, ok: t.ok, summary: t.summary })),
    rulesFailed: record.submits.filter((s) => !s.ok).map((s) => s.violations.map((v) => v.rule)),
    claudeResult: run?.subtype ?? "none",
    turns: run?.numTurns ?? null,
    seconds,
    tokens: run?.tokens ?? null,
    estCostUsd: run?.estCostUsd ?? null,
    models: run?.models ?? [],
  };
}

async function main() {
  const alias = arg("model") as ModelAlias | undefined;
  if (!alias || !(alias in MODELS)) die(`--model must be one of ${Object.keys(MODELS).join(", ")}`);
  const model = MODELS[alias];
  const all = loadCases();
  const cases = chooseCases(all);
  const complete = cases.length === all.length;
  const version = arg("version") ?? (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
  const env = childEnv(process.env);
  const debug = flag("debug");

  const authMethod = assertSubscription(env);
  const claudeVersion = spawnSync("claude", ["--version"], { env, encoding: "utf8", windowsHide: true }).stdout.trim();
  const template = claudeArgs({ model, systemPromptFile: "<tmp>/system-prompt.txt", mcpConfigFile: "<tmp>/mcp.json", settingsFile: "<tmp>/settings.json", maxTurns: MAX_TURNS, question: "<question>" });
  const commandLine = `claude ${template.map((a) => (a === "" ? '""' : /\s/.test(a) ? `"${a}"` : a)).join(" ")}`;

  console.log(`login: ${authMethod} (subscription), Claude Code ${claudeVersion}`);
  console.log(`model: ${model}; ${cases.length} of ${all.length} cases; max turns ${MAX_TURNS}`);
  console.log(`command: ${commandLine}`);
  if (flag("dry-run")) return;

  const ranAt = new Date().toISOString();
  const started = Date.now();
  const rows: CaseRow[] = [];
  for (const c of cases) {
    assertSubscription(env);
    const row = await runCase(c, model, env, debug);
    rows.push(row);
    const t = row.tokens as ClaudeRun["tokens"] | null;
    const tok = t ? `in ${t.input} / out ${t.output} / cache read ${t.cacheRead} / cache write ${t.cacheWrite}` : "no usage";
    const cost = typeof row.estCostUsd === "number" ? `est. $${row.estCostUsd.toFixed(4)}` : "est. cost unknown";
    console.log(`${row.passed ? "PASS" : "FAIL"} ${c.id} (${c.type}): ${row.status}, ${row.turns ?? "?"} turns, ${row.seconds} s, ${tok}, ${cost}`);
    for (const r of row.reasons) console.log(`    - ${r}`);
  }

  const wallSeconds = Math.round((Date.now() - started) / 100) / 10;
  // Which prompt and tool definitions produced these answers, so a later run can tell.
  const promptHash = createHash("sha256").update(SYSTEM_PROMPT).update(JSON.stringify(TOOL_DEFS)).digest("hex").slice(0, 12);
  const run = toEvalRun({
    version,
    model,
    ranAt,
    cases: rows,
    complete,
    meta: { claudeCode: claudeVersion, command: commandLine, maxTurns: MAX_TURNS, promptHash, wallSeconds },
  });
  const out = resultsPath(ROOT, version, alias, complete);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(run, null, 2) + "\n");

  const passed = rows.filter((r) => r.passed).length;
  console.log(`\n${passed} of ${rows.length} passed; est. API-equivalent cost $${run.estimatedApiCostUsd.toFixed(4)} (client-side estimate, nothing billed per token); wall ${wallSeconds} s`);
  console.log(`wrote ${out}${complete ? "" : " (partial run: kept off the Evals page)"}`);
}

await main();
