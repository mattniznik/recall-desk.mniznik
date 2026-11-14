// The agent's tools as an MCP server over stdio, on the recorded NHTSA data, with
// submit_answer checked by the same rules as the agent loop (src/mcp/session.ts). The
// subscription eval runner (scripts/eval-subscription.ts) hands this server to
// `claude -p` as its only MCP server, one server process per eval case.
//
//   node --experimental-strip-types src/mcp/server.ts --session <session.json>
//
// session.json: { "question": "...", "record": "<path>", "plant"?: PlantedComplaint }
// The record file is rewritten after every tool call with the run so far.
//
// Built on the SDK's low-level Server rather than McpServer: McpServer.registerTool takes
// zod schemas only, and the agent's tool schemas already exist as JSON Schema in
// src/agent/tools.ts. Serving those exact schemas keeps the model's view of the tools the
// same on both paths, and the tools validate their own input, as they do in the loop.
// stdout carries the protocol, so this file never prints; errors go to stderr.

import { readFileSync, writeFileSync } from "node:fs";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import type { PlantedComplaint } from "../evals/cases.ts";
import { evalFetch } from "../evals/fixtures.ts";
import { createSession } from "./session.ts";

type SessionFile = { question: string; record: string; plant?: PlantedComplaint };

function sessionFileArg(argv: string[]): string {
  const i = argv.indexOf("--session");
  if (i < 0 || !argv[i + 1]) throw new Error("usage: server.ts --session <session.json>");
  return argv[i + 1];
}

async function main() {
  const cfg = JSON.parse(readFileSync(sessionFileArg(process.argv), "utf8")) as SessionFile;
  const session = createSession({
    question: cfg.question,
    deps: { fetchJson: evalFetch({ plant: cfg.plant }) },
    onChange: (r) => writeFileSync(cfg.record, JSON.stringify(r, null, 2)),
  });
  writeFileSync(cfg.record, JSON.stringify(session.record(), null, 2));

  const server = new Server({ name: "recalldesk", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: session.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => session.call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>));
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`recalldesk MCP server: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
