// No flash of the wrong colours: index.html carries a small inline script (made by
// bootScript, injected by vite.config.ts) that paints the visitor's background before the
// page's JavaScript has loaded, and hides the page until it has rendered, with a 6 s
// failsafe. It must pick the same palette the page will: these tests run the script in a
// sandbox and compare it with resolveChoice for links, saved picks, the default and junk.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { bootScript } from "../web/src/studio/boot.ts";
import { resolveChoice, STORAGE_KEY } from "../web/src/studio/choice.ts";
import { DEFAULT, PALETTES, PRESETS } from "../web/src/studio/presets.ts";

function run(search: string, stored: string | null, storageThrows = false) {
  const style: Record<string, string> = {};
  const classes = new Set<string>();
  const timers: { fn: () => void; ms: number }[] = [];
  const sandbox = {
    URLSearchParams,
    JSON,
    location: { search },
    localStorage: {
      getItem: (k: string) => {
        if (storageThrows) throw new Error("blocked");
        return k === STORAGE_KEY ? stored : null;
      },
    },
    document: { documentElement: { style, classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } },
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
  };
  vm.runInNewContext(bootScript(PRESETS, STORAGE_KEY), sandbox);
  return { style, classes, timers };
}

const expected = (search: string, stored: string | null) => {
  let saved = null;
  try {
    saved = JSON.parse(stored ?? "null");
  } catch {
    saved = null;
  }
  const c = resolveChoice({ query: search, saved: saved && typeof saved === "object" && !Array.isArray(saved) ? saved : null, presets: PRESETS, fallback: DEFAULT });
  return PALETTES[c.palette];
};

test("the boot script paints the same background the page resolves", () => {
  const cases: [string, string | null][] = [
    ["", null],
    ["", '{"option":"04"}'],
    ["", '{"option":"08","palette":"lime","font":"inter"}'],
    ["", '{"option":"05","palette":"nope"}'],
    ["", "not json"],
    ["", "[1,2]"],
    ["", '{"option":"99","palette":"lime"}'],
    ["?layout=04", null],
    ["?layout=06&palette=ocean", '{"option":"08","palette":"lime"}'],
    ["?layout=99", '{"option":"09"}'],
    ["?layout=07&palette=nope", null],
  ];
  for (const [search, stored] of cases) {
    const { style } = run(search, stored);
    const p = expected(search, stored);
    assert.equal(style.background, p.bg, `${search || "(no link)"} with ${stored}`);
    assert.equal(style.colorScheme, p.light ? "light" : "dark", `${search} ${stored}: color scheme`);
  }
});

test("the page stays hidden until it has rendered, and never longer than 6 s", () => {
  const { classes, timers } = run("", null);
  assert.ok(classes.has("boot"));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 6000);
  timers[0].fn();
  assert.ok(!classes.has("boot"), "the failsafe shows the page");
});

test("blocked storage shows the default, without an error", () => {
  const { style } = run("", null, true);
  assert.equal(style.background, PALETTES[DEFAULT.palette].bg);
});
