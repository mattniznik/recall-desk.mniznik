// Shows the visitor's layout: resolves the choice (a ?layout= link, their saved pick, or the
// default), dresses the page in its colours and type, loads only that layout family's code
// (rich/, simple/, or looks/ for the five built around the system map)
// and styles, and renders it. index.html's inline boot script has already painted the right
// background and keeps the page hidden (html.boot) until the layout has rendered, or 6 s.
// Ported from rag.irs's studio/loader.js.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./app.css";
import "./studio/studio.css";
import "./shared/shared.css";
import { DEFAULT, FONTS, PALETTES, PRESETS } from "./studio/presets.ts";
import { configFor, parseSaved, resolveChoice, STORAGE_KEY } from "./studio/choice.ts";
import { fontsHref, themeVars } from "./studio/theme.ts";

let saved = null;
try {
  saved = parseSaved(localStorage.getItem(STORAGE_KEY));
} catch {
  /* storage blocked: show the default */
}
const choice = resolveChoice({ query: location.search, saved, presets: PRESETS, fallback: DEFAULT });
const cfg = configFor(choice, PRESETS);
const P = PALETTES[cfg.palette];
const F = FONTS[cfg.font];

const root = document.documentElement;
for (const [k, v] of Object.entries(themeVars(P, F))) root.style.setProperty(k, v);
root.style.background = P.bg;
root.style.colorScheme = P.light ? "light" : "dark";
root.classList.toggle("motion", !matchMedia("(prefers-reduced-motion: reduce)").matches);
document.body.className = [P.light ? "light" : "dark", F.caps ? "caps" : "", cfg.font === "serif" ? "serif" : "", cfg.font === "mono" ? "mono-font" : "", cfg.simple ? `simple s${cfg.simple}` : cfg.look ? `look look-${cfg.look}` : "rich"]
  .filter(Boolean)
  .join(" ");

// type: the chosen pairing plus the mono labels, from Google Fonts; not waited for (display=swap)
const fonts = document.createElement("link");
fonts.rel = "stylesheet";
fonts.href = fontsHref([F]);
document.head.append(fonts);

const page = cfg.simple
  ? import("./simple/SimplePage.tsx").then((m) => m.SimplePage)
  : cfg.look
    ? import("./looks/LookPage.tsx").then((m) => m.LookPage)
    : import("./rich/RichPage.tsx").then((m) => m.RichPage);
page
  .then((Page) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <Page cfg={cfg} choice={choice} />
      </StrictMode>,
    );
  })
  .catch((e) => {
    console.error(e);
    document.getElementById("root")!.innerHTML =
      '<p style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px">The page did not load. Reload to try again.</p>';
    root.classList.remove("boot");
  });
