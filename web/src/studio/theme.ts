// Dresses the page in the visitor's colours and type: the CSS variables every layout reads,
// and the Google Fonts link for the chosen pairing. Pure (main.tsx applies the result), so
// test/web-studio.test.ts checks it. rag.irs had two variable sets, one per layout family;
// here both families read the same names.
//
// Fonts come from Google Fonts, as on rag.irs: the chosen pairing plus JetBrains Mono for
// the small labels, display=swap, never waited for. The Studio loads every pairing once,
// when it opens, so each type button can show itself.

import type { Font, Palette } from "./presets.ts";

const MONO_LABELS = "JetBrains+Mono:wght@400;500;700";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
// black or white text, whichever reads better on a colour
const textOn = (bg: string) => (hex(bg) && contrast("#111111", bg) > contrast("#ffffff", bg) ? "#111111" : "#ffffff");

export function themeVars(p: Palette, f: Font): Record<string, string> {
  return {
    "--bg": p.bg,
    "--card": p.card,
    "--card2": p.card2,
    "--line": p.line,
    "--tx": p.tx,
    "--mu": p.mu,
    "--a1": p.a1,
    "--a2": p.a2,
    "--a3": p.a3,
    "--acc": p.acc,
    "--on": p.on,
    "--mark": p.mark,
    "--on-acc": textOn(p.acc),
    // the solid button: a palette's own fill, else the accent
    "--fill": p.fill ?? p.acc,
    "--on-fill": p.onFill ?? textOn(p.acc),
    // passed and failed, readable on light or dark
    "--ok": p.light ? "#1f6b2a" : "#3fbf7f",
    "--bad": p.light ? "#b42b2b" : "#ef7a6a",
    "--warn": p.light ? "#8a5a00" : "#fab219",
    "--fh": f.head,
    "--fb": f.body,
    "--hw": String(f.hw),
  };
}

/** One Google Fonts stylesheet for the given pairings plus the mono labels, each family once. */
export function fontsHref(fonts: Font[]): string {
  const fam = new Map<string, string>();
  for (const spec of [...fonts.flatMap((f) => f.gf.split("&family=").filter(Boolean)), MONO_LABELS]) {
    const name = spec.split(":")[0];
    if (!fam.has(name)) fam.set(name, spec);
  }
  return "https://fonts.googleapis.com/css2?" + [...fam.values()].map((s) => "family=" + s).join("&") + "&display=swap";
}
