// The MCP server over stdio, driven by the official SDK client: the same protocol Claude
// Code speaks to it during an eval run. No model is involved; the test plays the model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { SERVER_PATH, serverCommand } from "../src/mcp/server-command.ts";

test("the stdio server lists the tools, runs them on the recordings and records the accepted answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-desk-mcp-test-"));
  try {
    const sessionFile = join(dir, "session.json");
    const recordFile = join(dir, "record.json");
    writeFileSync(sessionFile, JSON.stringify({ question: "2017 Civic, grinding brakes. Any recall?", record: recordFile }));

    const { command, args } = serverCommand(sessionFile);
    assert.ok(args.includes(SERVER_PATH));
    const client = new Client({ name: "recall-desk-test", version: "0" });
    await client.connect(new StdioClientTransport({ command, args, stderr: "pipe" }));
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 8);
      assert.ok(tools.some((t) => t.name === "submit_answer"));

      const recalls = await client.callTool({ name: "get_recalls", arguments: { make: "Honda", model: "Civic", year: 2017 } });
      assert.equal(JSON.parse((recalls.content as { text: string }[])[0].text).count, 6);

      const bad = await client.callTool({
        name: "submit_answer",
        arguments: { text: "See 99V999000.", cited_recall_ids: ["99V999000"], applies_to_vehicle: [], fits: [], handoff: false },
      });
      assert.equal(bad.isError, true);

      const ok = await client.callTool({
        name: "submit_answer",
        arguments: { text: "No recall covers the brakes on a 2017 Civic.", cited_recall_ids: [], applies_to_vehicle: [], fits: [], handoff: false },
      });
      assert.notEqual(ok.isError, true);
    } finally {
      await client.close();
    }

    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    assert.equal(record.status, "answered");
    assert.equal(record.question, "2017 Civic, grinding brakes. Any recall?");
    assert.deepEqual(record.toolCalls.map((t: { name: string }) => t.name), ["get_recalls"]);
    assert.equal(record.submits.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
