// A fetchJson that answers from fixtures/nhtsa/ instead of the network, looked up by
// exact URL through the manifest. Used by `ask --offline` and by the eval runner, so a
// run on the recordings is repeatable and free. A URL that was never recorded is an
// error, never a quiet fall-through to the live API.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { FetchJson } from "./http.ts";

const DIR = join(import.meta.dirname, "..", "..", "fixtures", "nhtsa");

export function recordedFetch(dir = DIR): FetchJson {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { files: Record<string, { file: string; url: string }> };
  const byUrl = new Map(Object.values(manifest.files).map((f) => [f.url, f.file]));
  return async (url) => {
    const file = byUrl.get(url);
    if (!file) throw new Error(`no recording for ${url} (offline; run npm run fixtures:refresh to record it)`);
    return JSON.parse(readFileSync(join(dir, file), "utf8"));
  };
}
