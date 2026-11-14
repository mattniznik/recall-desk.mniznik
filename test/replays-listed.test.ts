// Every recorded run in web/src/replays/ must be on the page. A replay saved with
// `npm run live:run -- --save <name>` and never added to App.tsx's list is money spent on a
// run nobody can see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WEB_SRC = join(import.meta.dirname, "..", "web", "src");

test("every saved replay is listed on the page", () => {
  const app = readFileSync(join(WEB_SRC, "App.tsx"), "utf8");
  const saved = readdirSync(join(WEB_SRC, "replays")).filter((f) => f.endsWith(".json"));
  assert.ok(saved.length > 0, "there are replays to list");
  const missing = saved.filter((f) => !app.includes(`./replays/${f}`));
  assert.deepEqual(missing, [], "replays saved but not imported in App.tsx");
});
