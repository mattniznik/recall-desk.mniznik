// Which layout, colours and type a visitor sees, and what a Studio pick saves. Pure: the
// caller passes what it read from the URL and storage. Ported from rag.irs's
// studio/choice.js; tested in test/web-studio.test.ts.
//
// Order: a ?layout= link (shown, not saved) > the visitor's saved pick > the site default.

import type { LayoutCfg, Presets } from "./presets.ts";

export const STORAGE_KEY = "recall-desk-choice";

export type Source = "link" | "saved" | "default";
export type Pick = { option: string; palette: string; font: string };
export type Choice = Pick & { source: Source };
export type Saved = { option?: unknown; palette?: unknown; font?: unknown };

export function resolveChoice({ query = "", saved = null, presets, fallback }: { query?: string; saved?: Saved | null; presets: Presets; fallback: Pick }): Choice {
  const { OPTIONS, PALETTES, FONTS } = presets;
  const pick = (src: Saved | null): Pick | null => {
    const o = src && OPTIONS.find((x) => x.id === src.option);
    if (!o || !src) return null;
    return {
      option: o.id,
      palette: typeof src.palette === "string" && PALETTES[src.palette] ? src.palette : o.cfg.palette,
      font: typeof src.font === "string" && FONTS[src.font] ? src.font : o.cfg.font,
    };
  };
  const q = new URLSearchParams(query);
  const fromLink = q.get("layout") ? pick({ option: q.get("layout"), palette: q.get("palette"), font: q.get("font") }) : null;
  if (fromLink) return { ...fromLink, source: "link" };
  const fromSaved = pick(saved);
  if (fromSaved) return { ...fromSaved, source: "saved" };
  return { ...(pick(fallback) ?? pick({ option: OPTIONS[0].id })!), source: "default" };
}

export type Cfg = LayoutCfg & { option: string; simple: 1 | 2 | 3 | null };

/** The render config: the layout's own sections, then the chosen colours and type. */
export function configFor(choice: Pick, presets: Presets): Cfg {
  const o = presets.OPTIONS.find((x) => x.id === choice.option)!;
  return { ...o.cfg, option: o.id, palette: choice.palette, font: choice.font, simple: o.simple ?? null };
}

/** Storage can hold anything (an older version, another tab, a hand edit): only an object counts. */
export function parseSaved(raw: unknown): Saved | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** What a click in the Studio saves. A new layout comes with its own colours and type; a colour
 *  set or a typeface changes only itself; the layout already on screen keeps the look on screen. */
export function pickFor(cur: Pick, change: { option?: string; palette?: string; font?: string }, presets: Presets): Pick {
  if (change.option && change.option !== cur.option) {
    const o = presets.OPTIONS.find((x) => x.id === change.option)!;
    return { option: o.id, palette: o.cfg.palette, font: o.cfg.font };
  }
  return { option: cur.option, palette: change.palette ?? cur.palette, font: change.font ?? cur.font };
}

/** After a pick the page reloads without the link's layout, palette and font, so the saved pick shows. */
export function cleanSearch(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of ["layout", "palette", "font"]) q.delete(k);
  const s = q.toString();
  return s ? "?" + s : "";
}

export function statusFor(source: Source): string {
  return {
    saved: "Saved in this browser. You will see this look next time.",
    link: "Shown from a link, not saved. Pick anything to keep a look.",
    default: "This is the default look. Pick anything to save your own.",
  }[source];
}
