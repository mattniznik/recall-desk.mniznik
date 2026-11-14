// The subscription eval runner's pure parts: the claude command line, the environment it
// runs in, the login check, and reading its JSON result. The rule these guard is Mat's:
// Claude runs only on his subscription login, never on an API key, and the eval run sees
// none of his own Claude Code setup (CLAUDE.md, memory, hooks, plugins, other MCP servers).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MODELS,
  RUN_LABEL,
  checkAuthStatus,
  childEnv,
  claudeArgs,
  mcpConfig,
  parseClaudeJson,
  resultsPath,
  toEvalRun,
} from "../src/evals/claude-cli.ts";

const base = { model: MODELS.haiku, systemPromptFile: "C:/t/system-prompt.txt", mcpConfigFile: "C:/t/mcp.json", settingsFile: "C:/t/settings.json", maxTurns: 7, question: "Any recalls?" };

test("the command line: restricted print mode, only our MCP server, no built-in tools, our system prompt, never --bare", () => {
  const args = claudeArgs(base);
  const has = (flag: string, value?: string) => {
    const i = args.indexOf(flag);
    assert.ok(i >= 0, `missing ${flag}`);
    if (value !== undefined) assert.equal(args[i + 1], value, flag);
  };
  has("-p");
  has("--restricted");
  has("--model", "claude-haiku-5-5");
  has("--effort", "low");
  has("--system-prompt-file", base.systemPromptFile);
  has("--mcp-config", base.mcpConfigFile);
  has("--strict-mcp-config");
  has("--tools", "");
  has("--allowedTools", "mcp__recalldesk__*");
  has("--permission-mode", "dontAsk");
  has("--settings", base.settingsFile);
  has("--disable-slash-commands");
  has("--no-session-persistence");
  has("--max-turns", "7");
  has("--output-format", "json");
  assert.ok(!args.includes("--bare"), "--bare ignores the subscription login");
  assert.ok(!args.some((a) => /dangerously|bypassPermissions/.test(a)));
  assert.equal(args.at(-1), "Any recalls?");
  assert.equal(args.at(-2), "--", "the question can never be read as a flag");
});

test("the child environment: no API key or token can reach claude, and Mat's setup is switched off", () => {
  const env = childEnv({
    PATH: "C:/bin",
    USERPROFILE: "C:/Users/x",
    ANTHROPIC_API_KEY: "sk-ant-should-not-pass",
    ANTHROPIC_AUTH_TOKEN: "tok",
    ANTHROPIC_BASE_URL: "https://proxy",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "parent",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_EFFORT: "max",
  });
  for (const k of Object.keys(env)) assert.doesNotMatch(k, /^ANTHROPIC_/, k);
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_EFFORT"]) assert.equal(env[k], undefined, k);
  assert.equal(env.PATH, "C:/bin");
  assert.equal(env.USERPROFILE, "C:/Users/x");
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.equal(env.ENABLE_TOOL_SEARCH, "false");
});

test("the login check passes only a claude.ai subscription login, and never repeats the account's email", () => {
  const status = (o: Record<string, unknown>) => JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "someone@example.com", ...o });
  const ok = checkAuthStatus(status({}));
  assert.deepEqual(ok, { ok: true, authMethod: "claude.ai" });
  assert.equal(checkAuthStatus(status({ authMethod: "api_key" })).ok, false);
  assert.equal(checkAuthStatus(status({ loggedIn: false })).ok, false);
  assert.equal(checkAuthStatus(status({ apiProvider: "bedrock" })).ok, false);
  assert.equal(checkAuthStatus("not json").ok, false);
  const bad = checkAuthStatus(status({ authMethod: "api_key" }));
  assert.doesNotMatch(JSON.stringify(bad), /example\.com/);
});

test("the MCP config: one stdio server, loaded up front", () => {
  const cfg = mcpConfig({ command: "node.exe", args: ["server.ts", "--session", "s.json"] }) as { mcpServers: Record<string, any> };
  assert.deepEqual(Object.keys(cfg.mcpServers), ["recalldesk"]);
  assert.equal(cfg.mcpServers.recalldesk.type, "stdio");
  assert.equal(cfg.mcpServers.recalldesk.alwaysLoad, true);
});

test("the JSON result: tokens summed over every model, the estimated cost, the turns", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 12000,
    num_turns: 3,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
    modelUsage: {
      "claude-haiku-5-5": { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 300, cacheCreationInputTokens: 400, costUSD: 0.012 },
      "claude-other": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.0003 },
    },
    result: "Done.",
  });
  const r = parseClaudeJson(stdout);
  assert.equal(r.subtype, "success");
  assert.equal(r.numTurns, 3);
  assert.equal(r.estCostUsd, 0.0123);
  assert.deepEqual(r.tokens, { input: 101, output: 202, cacheRead: 303, cacheWrite: 404 });
  assert.deepEqual(r.models, ["claude-haiku-5-5", "claude-other"]);
  assert.throws(() => parseClaudeJson("oops"), /not JSON/);
});

test("a subscription run says so, keeps costUsd off the page, and only a complete run goes to web/src/evals", () => {
  const cases = [{ id: "a", type: "handoff", passed: true, reasons: [], estCostUsd: 0.01 }];
  const run = toEvalRun({ version: "0.1.0", model: MODELS.haiku, ranAt: "2026-11-14T00:00:00Z", cases, complete: false, meta: {} });
  assert.match(run.model, /Claude Code subscription run/);
  assert.equal(run.path, RUN_LABEL);
  assert.equal(run.costUsd, undefined, "the page shows costUsd as dollars spent; a subscription run spent none per token");
  assert.equal(run.estimatedApiCostUsd, 0.01);
  assert.match(resultsPath("C:/repo", "0.1.0", "haiku", true).replaceAll("\\", "/"), /web\/src\/evals\/0\.1\.0-haiku-sub\.json$/);
  assert.match(resultsPath("C:/repo", "0.1.0", "haiku", false).replaceAll("\\", "/"), /evals\/results\/0\.1\.0-haiku-sub-partial\.json$/);
  assert.doesNotMatch(resultsPath("C:/repo", "0.1.0", "haiku", false).replaceAll("\\", "/"), /web\//);
});
