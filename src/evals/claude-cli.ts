// The pure parts of the subscription eval runner (scripts/eval-subscription.ts): the
// `claude -p` command line, the environment it runs in, the login check, and reading its
// JSON result. Kept apart from the runner so tests can check them without starting Claude.
//
// The rule: evals run on a Claude subscription login only, never on an API key. So
// the child gets no ANTHROPIC_* variable at all, --bare is never used (bare mode never
// reads the OAuth login and needs a key: code.claude.com/docs/en/headless, "Start faster
// with bare mode"), and the runner refuses to start unless `claude auth status` reports a
// claude.ai login.
//
// Isolation from the developer's own Claude Code setup, each flag from code.claude.com/docs/en/
// cli-reference unless noted (read 2026-11-14, Claude Code 2.1.314):
// - --restricted: "Use it when an evaluation harness drives claude on a shared machine";
//   loads only managed settings and --settings, so no user, project or local settings
//   file (hooks, plugins, permissions, env) is read. Needs v2.1.248 or later.
// - --strict-mcp-config + --mcp-config: only this repo's MCP server.
// - --tools "": no built-in tools ("Use "" to disable all").
// - --disable-slash-commands: no skills or commands.
// - --settings {"disableAllHooks": true}: hooks off even if a settings source loads.
// - --no-session-persistence: the run is not saved to disk.
// - --system-prompt-file: the recall-desk prompt replaces Claude Code's.
// - env (docs/en/env-vars): CLAUDE_CODE_DISABLE_CLAUDE_MDS (no CLAUDE.md of any kind),
//   CLAUDE_CODE_DISABLE_AUTO_MEMORY, ENABLE_CLAUDEAI_MCP_SERVERS=false (no claude.ai
//   connectors), ENABLE_TOOL_SEARCH=false (tools loaded up front, as the API path sends
//   them), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC (no auto-update mid-run, no feature
//   flags), CLAUDE_CODE_DISABLE_TERMINAL_TITLE (no side request for a session title),
//   CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS.
// - The parent's CLAUDE* variables are dropped, so a run started from inside a Claude Code
//   session does not inherit that session's id, effort or messaging socket.

import { join } from "node:path";

export const MODELS = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" } as const;
export type ModelAlias = keyof typeof MODELS;

export const MCP_SERVER = "recalldesk";
export const RUN_LABEL = "Claude Code subscription run";

export function claudeArgs(o: { model: string; systemPromptFile: string; mcpConfigFile: string; settingsFile: string; maxTurns: number; question: string }): string[] {
  return [
    "-p",
    "--restricted",
    "--model", o.model,
    // The production adapter runs at effort low (src/agent/anthropic.ts).
    "--effort", "low",
    "--system-prompt-file", o.systemPromptFile,
    "--mcp-config", o.mcpConfigFile,
    "--strict-mcp-config",
    "--tools", "",
    "--allowedTools", `mcp__${MCP_SERVER}__*`,
    "--permission-mode", "dontAsk",
    "--settings", o.settingsFile,
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-turns", String(o.maxTurns),
    "--output-format", "json",
    "--",
    o.question,
  ];
}

export const SETTINGS = { disableAllHooks: true };

const ISOLATION_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  ENABLE_TOOL_SEARCH: "false",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
  CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
};

export function childEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v === undefined || /^(?:ANTHROPIC_|CLAUDE)/i.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...ISOLATION_ENV };
}

export function mcpConfig(server: { command: string; args: string[] }) {
  return { mcpServers: { [MCP_SERVER]: { type: "stdio", command: server.command, args: server.args, alwaysLoad: true } } };
}

// `claude auth status` prints JSON. Only loggedIn, authMethod and apiProvider are read;
// the account's email and organization never leave this function.
export type AuthCheck = { ok: true; authMethod: string } | { ok: false; error: string };

export function checkAuthStatus(stdout: string): AuthCheck {
  let s: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown };
  try {
    s = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "claude auth status did not print JSON" };
  }
  if (s.loggedIn !== true) return { ok: false, error: "Claude Code is not logged in" };
  if (s.authMethod !== "claude.ai") return { ok: false, error: `auth method is "${String(s.authMethod)}", not a claude.ai subscription login` };
  if (s.apiProvider !== "firstParty") return { ok: false, error: `API provider is "${String(s.apiProvider)}", not Anthropic` };
  return { ok: true, authMethod: s.authMethod };
}

// ---------------------------------------------------------------- the JSON result

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ClaudeRun = {
  subtype: string;
  isError: boolean;
  numTurns: number | null;
  durationMs: number | null;
  // total_cost_usd: Claude Code's client-side estimate from its bundled price table, "not
  // authoritative billing data" (docs/en/agent-sdk/cost-tracking). On a subscription
  // nothing is billed per token; this is what the same tokens would cost on the API.
  estCostUsd: number | null;
  tokens: Tokens;
  models: string[];
  resultText: string;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseClaudeJson(stdout: string): ClaudeRun {
  let r: Record<string, any>;
  try {
    r = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`claude's output is not JSON: ${stdout.slice(0, 200)}`);
  }
  // modelUsage counts every request, side requests included; usage can undercount
  // (docs/en/agent-sdk/cost-tracking), so tokens come from modelUsage when it is there.
  const byModel = (r.modelUsage ?? {}) as Record<string, Record<string, unknown>>;
  const models = Object.keys(byModel);
  const tokens: Tokens = models.length
    ? models.reduce(
        (t, m) => ({
          input: t.input + num(byModel[m].inputTokens),
          output: t.output + num(byModel[m].outputTokens),
          cacheRead: t.cacheRead + num(byModel[m].cacheReadInputTokens),
          cacheWrite: t.cacheWrite + num(byModel[m].cacheCreationInputTokens),
        }),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      )
    : {
        input: num(r.usage?.input_tokens),
        output: num(r.usage?.output_tokens),
        cacheRead: num(r.usage?.cache_read_input_tokens),
        cacheWrite: num(r.usage?.cache_creation_input_tokens),
      };
  return {
    subtype: String(r.subtype ?? "unknown"),
    isError: r.is_error === true,
    numTurns: typeof r.num_turns === "number" ? r.num_turns : null,
    durationMs: typeof r.duration_ms === "number" ? r.duration_ms : null,
    estCostUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
    tokens,
    models,
    resultText: typeof r.result === "string" ? r.result : "",
  };
}

// ---------------------------------------------------------------- the results file

export type CaseRow = { id: string; type: string; passed: boolean; reasons: string[]; estCostUsd?: number | null; [k: string]: unknown };

// The EvalRun shape the Evals page reads (web/src/evals.ts), marked as a subscription run.
// costUsd is left out on purpose: the page prints it as dollars spent, and a subscription
// run spends no dollars per token. The estimate is kept as estimatedApiCostUsd instead.
export function toEvalRun(o: { version: string; model: string; ranAt: string; cases: CaseRow[]; complete: boolean; meta: Record<string, unknown> }) {
  const costs = o.cases.map((c) => c.estCostUsd);
  const known = costs.filter((c): c is number => typeof c === "number");
  return {
    version: o.version,
    model: `${o.model}, ${RUN_LABEL}`,
    ranAt: o.ranAt,
    path: RUN_LABEL,
    note:
      "Run with `claude -p` on a Claude subscription login, not through the production Anthropic API path (src/agent/anthropic.ts). " +
      "Same system prompt, tools, recorded NHTSA data and rules, reached through an MCP server. Costs are Claude Code's client-side " +
      "estimate (total_cost_usd) of what the same tokens would cost on the API; nothing was billed per token.",
    complete: o.complete,
    estimatedApiCostUsd: Math.round(known.reduce((a, b) => a + b, 0) * 1e6) / 1e6,
    estimatedApiCostComplete: known.length === costs.length,
    ...o.meta,
    cases: o.cases,
  };
}

// A run over the whole case set goes where the Evals page reads it; anything less is kept
// out of the page, so a 3-case smoke run can never be shown as a score.
export function resultsPath(root: string, version: string, alias: string, complete: boolean): string {
  return complete ? join(root, "web", "src", "evals", `${version}-${alias}-sub.json`) : join(root, "evals", "results", `${version}-${alias}-sub-partial.json`);
}
