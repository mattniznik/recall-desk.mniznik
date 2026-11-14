// Shared by the tool tests: read a recorded NHTSA reply, and a fake fetch that serves
// recordings by URL and remembers every URL it was asked for. No test touches the network.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "fixtures", "nhtsa");

export function fixture(file: string): any {
  return JSON.parse(readFileSync(join(DIR, file), "utf8"));
}

export function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    if (!(url in routes)) throw new Error(`no recording for ${url}`);
    return routes[url];
  };
  return { fetchJson, calls };
}
