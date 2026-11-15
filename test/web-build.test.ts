// The web page builds to plain static files for S3 (no server
// rendering). This test runs the real Vite build and checks what lands in web/dist: an
// index.html with the app's root element and a script, and the store name from
// src/config.ts, so the page and the agent can never name the store differently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { STORE_NAME } from "../src/config.ts";

const ROOT = join(import.meta.dirname, "..");
const WEB = join(ROOT, "web");
const DIST = join(WEB, "dist");

test("vite builds the page into web/dist", { timeout: 120_000 }, () => {
  // vite's "exports" field hides bin/vite.js from require.resolve, so find the package
  // first and build the path to its command from there.
  const vite = join(dirname(createRequire(join(WEB, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
  execFileSync(process.execPath, [vite, "build", "--logLevel", "error"], { cwd: WEB, stdio: "pipe" });

  const html = readFileSync(join(DIST, "index.html"), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="module"[^>]+src="\/assets\/[^"]+\.js"/);
  assert.ok(html.includes(STORE_NAME), "index.html names the store the same way as src/config.ts");

  const assets = readdirSync(join(DIST, "assets"));
  assert.ok(assets.some((f) => f.endsWith(".js")));
  assert.ok(existsSync(join(DIST, "index.html")));
});
