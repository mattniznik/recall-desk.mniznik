// The inline script index.html runs before anything else (vite.config.ts injects it): it
// paints the background of the colour set the page is about to show, so a dark look never
// flashes white, and hides the page (html.boot) until main.tsx has rendered it, with a 6 s
// failsafe. It resolves the palette the way choice.ts does (a ?layout= link, else the saved
// pick, else the default); test/web-boot.test.ts runs it in a sandbox against resolveChoice.
//
// Plain ES5 on purpose: it runs as written, before any bundle, in every browser.

import type { Presets } from "./presets.ts";

export function bootScript(presets: Presets, key: string): string {
  // only what the script needs: each layout's own palette, each palette's background and
  // whether it is light, and the default
  const data = {
    o: Object.fromEntries(presets.OPTIONS.map((o) => [o.id, o.cfg.palette])),
    p: Object.fromEntries(Object.entries(presets.PALETTES).map(([k, p]) => [k, [p.bg, p.light ? 1 : 0]])),
    d: presets.DEFAULT,
  };
  return `(function(){var D=${JSON.stringify(data)},c=null,q,o,pal;
try{c=JSON.parse(localStorage.getItem(${JSON.stringify(key)}))}catch(e){}
if(!c||typeof c!=="object"||Array.isArray(c))c=null;
function pick(s){if(!s||!D.o.hasOwnProperty(s.option))return null;return D.p.hasOwnProperty(s.palette)?s.palette:D.o[s.option]}
try{q=new URLSearchParams(location.search);if(q.get("layout"))pal=pick({option:q.get("layout"),palette:q.get("palette")})}catch(e){}
pal=pal||pick(c)||pick(D.d)||D.o[Object.keys(D.o)[0]];
var p=D.p[pal],h=document.documentElement;h.style.background=p[0];h.style.colorScheme=p[1]?"light":"dark";
h.classList.add("boot");setTimeout(function(){h.classList.remove("boot")},6000)})();`;
}
