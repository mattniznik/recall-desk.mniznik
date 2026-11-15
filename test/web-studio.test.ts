// The page's Studio, ported from rag.irs.mniznik (cite-or-abstain/worker/public/presets.js and
// studio/choice.js): seven layouts, fifteen colour sets, ten typefaces, and which one a
// visitor sees. Since 2026-11-14 also five layouts built around the system map (10-14), each
// with its own colour set and typeface: twelve layouts, twenty-one colour sets, fifteen typefaces. Order: a ?layout= link (shown, not saved) > the visitor's saved pick > the
// site default. Pure modules, so node --test checks them without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT, FONTS, OPTIONS, PALETTES, PRESETS } from "../web/src/studio/presets.ts";
import { cleanSearch, configFor, parseSaved, pickFor, resolveChoice, statusFor, STORAGE_KEY } from "../web/src/studio/choice.ts";
import { contrast, fontsHref, themeVars } from "../web/src/studio/theme.ts";

test("twelve layouts: four section-built (01, 04-06), three one-column (07-09), five map-first (10-14)", () => {
  assert.deepEqual(OPTIONS.map((o) => o.id), ["01", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"]);
  assert.deepEqual(OPTIONS.filter((o) => o.simple).map((o) => o.simple), [1, 2, 3]);
  assert.deepEqual(OPTIONS.filter((o) => o.cfg.look).map((o) => o.cfg.look), ["canvas", "waterfall", "workshop", "spec", "garage"]);
  for (const o of OPTIONS) {
    assert.ok(PALETTES[o.cfg.palette], `${o.id} names a real palette`);
    assert.ok(FONTS[o.cfg.font], `${o.id} names a real font`);
    if (!o.simple && !o.cfg.look) for (const k of ["hero", "features", "how", "proof"] as const) assert.ok(o.cfg[k], `${o.id} has a ${k} variant`);
  }
});

test("twenty-one palettes, split dark and light, each with every colour key", () => {
  const keys = ["bg", "card", "card2", "line", "tx", "mu", "a1", "a2", "a3", "acc", "on", "mark"];
  assert.equal(Object.keys(PALETTES).length, 21);
  for (const [k, p] of Object.entries(PALETTES)) for (const c of keys) assert.ok(typeof (p as Record<string, unknown>)[c] === "string", `${k}.${c}`);
  const light = Object.values(PALETTES).filter((p) => p.light).length;
  assert.ok(light > 0 && light < 21, "both groups have members");
});

// The five map-first layouts each came from one design reference and
// bring a look none of the older seven uses: a palette and a typeface of their own,
// each palette meeting the same contrast as the rest, its success and failure colours included.
test("each map-first layout brings its own palette and typeface, and they pass the contrast checks", () => {
  const older = OPTIONS.filter((o) => !o.cfg.look);
  const looks = OPTIONS.filter((o) => o.cfg.look);
  assert.equal(looks.length, 5);
  assert.equal(new Set(looks.map((o) => o.cfg.palette)).size, 5, "five different palettes");
  assert.equal(new Set(looks.map((o) => o.cfg.font)).size, 5, "five different typefaces");
  for (const o of looks) {
    assert.ok(!older.some((x) => x.cfg.palette === o.cfg.palette), `${o.id}'s palette is new`);
    assert.ok(!older.some((x) => x.cfg.font === o.cfg.font), `${o.id}'s typeface is new`);
    assert.ok(!["grotesk", "serif", "mono", "condensed", "system", "inter", "sora", "plex", "fraunces", "playfair"].includes(o.cfg.font), `${o.id}: not one of the first ten pairings`);
    const p = PALETTES[o.cfg.palette];
    const v = themeVars(p, FONTS[o.cfg.font]);
    assert.ok(contrast(p.tx, p.bg) >= 4.5 && contrast(p.mu, p.bg) >= 4.5, `${o.id}: text`);
    assert.ok(contrast(p.tx, p.card) >= 4.5 && contrast(p.mu, p.card) >= 4.5, `${o.id}: text on cards`);
    assert.ok(contrast(v["--ok"], p.bg) >= 4.5 && contrast(v["--bad"], p.bg) >= 4.5, `${o.id}: passed and failed colours`);
    assert.ok(contrast(v["--on-fill"], v["--fill"]) >= 4.5, `${o.id}: the solid button`);
    assert.match(FONTS[o.cfg.font].gf, /^[A-Z][A-Za-z+]+:/, `${o.id}: a Google Fonts family`);
  }
  assert.equal(PALETTES.canvasDay.light, true, "the canvas layout also comes in daylight");
});

// The claim the presets file makes in its comment: text and muted text >= 4.5:1 on the
// background, the accent >= 3:1, button text >= 4.5:1 on each gradient stop (and on the fill
// where a palette has its own button fill). rag.irs's "demo" a1 was 4.42:1.
test("every palette meets the contrast it claims", () => {
  for (const [k, p] of Object.entries(PALETTES)) {
    assert.ok(contrast(p.tx, p.bg) >= 4.5, `${k}: text on background`);
    assert.ok(contrast(p.mu, p.bg) >= 4.5, `${k}: muted text on background`);
    assert.ok(contrast(p.acc, p.bg) >= 3, `${k}: accent on background`);
    for (const a of [p.a1, p.a2, p.a3]) assert.ok(contrast(p.on, a) >= 4.5, `${k}: button text on ${a} is ${contrast(p.on, a).toFixed(2)}`);
    if (p.fill) assert.ok(contrast(p.onFill!, p.fill) >= 4.5, `${k}: button text on its fill`);
  }
});

// The default (chosen 2026-11-15) is Ask anything (01) with Golden hour on paper and Plus
// Jakarta Sans + IBM Plex Mono; before that it was Run canvas (10) with Barlow Condensed caps.
test("fifteen font pairings; the default is Ask anything on golden hour on paper with Plus Jakarta Sans", () => {
  assert.equal(Object.keys(FONTS).length, 15);
  assert.deepEqual(DEFAULT, { option: "01", palette: "coverPaper", font: "jakarta" });
  assert.match(FONTS.condensed.head, /Barlow Condensed/);
  assert.match(FONTS.condensed.body, /DM Sans/);
  assert.equal(FONTS.condensed.caps, true);
});

const resolve = (query: string, saved: unknown = null) => resolveChoice({ query, saved: saved as never, presets: PRESETS, fallback: DEFAULT });

test("a ?layout= link is shown and says it came from a link", () => {
  assert.deepEqual(resolve("?layout=04"), { option: "04", palette: "mono", font: "mono", source: "link" });
  assert.deepEqual(resolve("?layout=05&palette=ocean&font=serif"), { option: "05", palette: "ocean", font: "serif", source: "link" });
  // an unknown palette or font in the link falls back to the layout's own
  assert.deepEqual(resolve("?layout=06&palette=nope&font=nope"), { option: "06", palette: "coverPaper", font: "serif", source: "link" });
  // the link beats a saved pick
  assert.equal(resolve("?layout=07", { option: "04", palette: "lime", font: "inter" }).option, "07");
});

test("without a link the saved pick shows; without either, the default", () => {
  assert.deepEqual(resolve("", { option: "08", palette: "lime", font: "inter" }), { option: "08", palette: "lime", font: "inter", source: "saved" });
  assert.deepEqual(resolve(""), { option: "01", palette: "coverPaper", font: "jakarta", source: "default" });
  assert.deepEqual(resolve("?layout=99"), { option: "01", palette: "coverPaper", font: "jakarta", source: "default" });
  assert.equal(resolve("", { option: "99" }).source, "default");
});

test("storage can hold anything: only an object counts as a saved pick", () => {
  assert.equal(STORAGE_KEY, "recall-desk-choice");
  assert.deepEqual(parseSaved('{"option":"04"}'), { option: "04" });
  for (const raw of [null, "", "not json", "[1,2]", "42", '"04"']) assert.equal(parseSaved(raw), null, String(raw));
});

test("configFor merges the layout's own sections with the chosen colours and type", () => {
  const cfg = configFor({ option: "01", palette: "ocean", font: "plex" }, PRESETS);
  assert.equal(cfg.hero, "search");
  assert.equal(cfg.palette, "ocean");
  assert.equal(cfg.font, "plex");
  assert.equal(cfg.simple, null);
  assert.equal(configFor({ option: "09", palette: "demo", font: "serif" }, PRESETS).simple, 3);
});

test("a Studio pick: a layout brings its own look, a palette or font changes only itself", () => {
  const cur = { option: "01", palette: "coverPaper", font: "condensed", source: "default" as const };
  assert.deepEqual(pickFor(cur, { option: "04" }, PRESETS), { option: "04", palette: "mono", font: "mono" });
  assert.deepEqual(pickFor(cur, { palette: "lime" }, PRESETS), { option: "01", palette: "lime", font: "condensed" });
  assert.deepEqual(pickFor(cur, { font: "inter" }, PRESETS), { option: "01", palette: "coverPaper", font: "inter" });
  // clicking the layout on screen keeps the look on screen (and saves it when it was not saved)
  assert.deepEqual(pickFor(cur, { option: "01" }, PRESETS), { option: "01", palette: "coverPaper", font: "condensed" });
});

test("after a pick the link's layout, palette and font are dropped, other parameters stay", () => {
  assert.equal(cleanSearch("?layout=04&palette=mono&font=mono"), "");
  assert.equal(cleanSearch("?layout=04&x=1"), "?x=1");
  assert.equal(cleanSearch(""), "");
});

test("the status line says where the look came from", () => {
  assert.match(statusFor("saved"), /^Saved in this browser/);
  assert.match(statusFor("link"), /not saved/);
  assert.match(statusFor("default"), /default look/);
});

test("themeVars sets every colour variable, and picks readable text for the accent", () => {
  const v = themeVars(PALETTES.coverPaper, FONTS.condensed);
  for (const k of ["--bg", "--card", "--card2", "--line", "--tx", "--mu", "--a1", "--a2", "--a3", "--acc", "--on", "--mark", "--fh", "--fb", "--hw", "--ok", "--bad", "--fill", "--on-fill", "--on-acc"]) {
    assert.ok(k in v, k);
  }
  assert.equal(v["--bg"], "#f6f0e6");
  assert.equal(v["--on-acc"], "#ffffff", "white reads better on the rust accent");
  assert.equal(themeVars(PALETTES.coverDark, FONTS.grotesk)["--on-acc"], "#111111");
  // a palette with its own button fill keeps it
  assert.equal(themeVars(PALETTES.paperRust, FONTS.serif)["--fill"], "#1a1714");
});

test("fonts load from Google Fonts: the chosen pairing plus the mono labels, each family once", () => {
  const href = fontsHref([FONTS.condensed]);
  assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(href, /family=Barlow\+Condensed/);
  assert.match(href, /family=DM\+Sans/);
  assert.match(href, /family=JetBrains\+Mono/);
  assert.match(href, /&display=swap$/);
  assert.equal(href.match(/family=DM\+Sans/g)!.length, 1);
  // the system pairing needs no web font except the labels
  assert.equal(fontsHref([FONTS.system]), "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap");
  // every pairing at once (the Studio's type buttons), with DM Sans and JetBrains Mono once
  const all = fontsHref(Object.values(FONTS));
  assert.equal(all.match(/family=DM\+Sans/g)!.length, 1);
  assert.equal(all.match(/family=JetBrains\+Mono/g)!.length, 1);
});
