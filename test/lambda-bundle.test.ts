// The bundle Lambda will run: it builds, loads as an ES module, and routes. Lambda's
// `awslambda` global is stubbed; the AWS SDK is not installed here, so a chat request takes
// the error path, which is itself worth proving: it answers with an event, not a crash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

test("the Lambda bundle builds, loads and routes", { timeout: 120_000 }, async () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "build-lambda.ts")], { cwd: ROOT, stdio: "pipe" });

  (globalThis as Record<string, unknown>).awslambda = { streamifyResponse: (fn: unknown) => fn };
  const mod = await import(pathToFileURL(join(ROOT, "dist", "lambda", "index.mjs")).href + `?t=${Date.now()}`);
  assert.equal(typeof mod.handler, "function");

  const run = async (event: unknown) => {
    let text = "";
    let ended = false;
    await mod.handler(event, { write: (c: string) => (text += c), end: () => (ended = true) });
    return { text, ended };
  };

  const notFound = await run({ rawPath: "/api/nope", requestContext: { http: { method: "GET" } } });
  assert.deepEqual(JSON.parse(notFound.text), { error: "not found" });
  assert.ok(notFound.ended);

  const ask = await run({ rawPath: "/api/ask", requestContext: { http: { method: "POST", sourceIp: "64.252.1.1" } }, body: "{}" });
  const lines = ask.text.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).type, "error");
  assert.ok(ask.ended);
});
