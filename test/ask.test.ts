// The ask CLI runs the tools without a model: one tool by name, or a fixed tool plan for
// each of the three sample questions. It is how the tools get checked by eye before any
// money is spent on a model, and --offline makes it run on the recordings alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { parseArgs, runTool, runSamples, SAMPLES } from "../src/cli/ask.ts";
import { recordedFetch } from "../src/tools/recorded.ts";

const ROOT = join(import.meta.dirname, "..");
const offline = { fetchJson: recordedFetch() };

test("arguments become a tool name and typed arguments", () => {
  assert.deepEqual(parseArgs(["get_recalls", "--make", "Honda", "--model", "Civic", "--year", "2017"]), {
    tool: "get_recalls",
    args: { make: "Honda", model: "Civic", year: 2017 },
    offline: false,
    samples: false,
  });
  assert.deepEqual(parseArgs(["--samples", "--offline"]), { tool: null, args: {}, offline: true, samples: true });
});

test("a tool runs by its snake_case name", async () => {
  const r = (await runTool("get_recalls", { make: "Honda", model: "Civic", year: 2017 }, offline)) as { ok: boolean; count: number };
  assert.equal(r.ok, true);
  assert.equal(r.count, 6);
});

test("an unknown tool name lists the real ones", async () => {
  await assert.rejects(runTool("get_parts", {}, offline), /decode_vehicle.*search_catalog.*create_handoff/s);
});

test("offline, an unrecorded URL is an error, never a network call", async () => {
  await assert.rejects(offline.fetchJson("https://api.nhtsa.gov/recalls/recallsByVehicle?make=kia&model=soul&modelYear=2020"), /no recording/);
});

test("the three sample questions run end to end on the recordings", async () => {
  const results = await runSamples(offline);
  assert.equal(results.length, SAMPLES.length);
  assert.equal(SAMPLES.length, 3);
  for (const s of results) for (const step of s.steps) assert.equal((step.result as { ok: boolean }).ok, true, `${s.question}: ${step.tool}`);
  const brakes = results[0].steps;
  assert.equal((brakes.find((x) => x.tool === "search_complaints")!.result as { matching: number }).matching, 37);
});

test("npm run ask -- --samples --offline prints the steps and exits 0", () => {
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/cli/ask.ts", "--samples", "--offline"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.match(out, /2017 Civic, grinding brakes/);
  assert.match(out, /17V706000/);
  assert.match(out, /search_catalog/);
});
