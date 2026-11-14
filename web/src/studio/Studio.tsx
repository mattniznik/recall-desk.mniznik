// The Studio: a visitor picks a layout, a colour set and a typeface. The pick is saved in this
// browser (localStorage, read by main.tsx and by the inline boot script) and shown on every
// later visit. Each pick reloads the page into it, and the panel opens again where it was.
// On a section-built layout the button sits in the nav; on the one-column ones it floats.
// On a phone the panel is a bottom sheet. Ported from rag.irs's studio/panel.js.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FONTS, OPTIONS, PALETTES, PRESETS, type Palette } from "./presets.ts";
import { cleanSearch, pickFor, statusFor, STORAGE_KEY, type Choice, type Pick } from "./choice.ts";
import { fontsHref } from "./theme.ts";

const REOPEN = "recall-desk-studio-reopen";

const Swatch = ({ p }: { p: Palette }) => (
  <span className="sp-sw" aria-hidden="true">
    {[p.bg, p.a1, p.a2, p.a3].map((c, i) => (
      <i key={i} style={{ background: c }} />
    ))}
  </span>
);

const Icon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M10 2a8 8 0 0 0 0 16c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.8-.5-1.2-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6h1.8A3.7 3.7 0 0 0 18 8.8C18 5 14.4 2 10 2Zm-4.5 8a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm2.3-3.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm2.3 3.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"
    />
  </svg>
);

let fontsIn = false;
function loadEveryFont() {
  if (fontsIn) return; // every typeface once, so each Type button shows itself
  fontsIn = true;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = fontsHref(Object.values(FONTS));
  document.head.append(l);
}

/** A pick: save it, then reload into it (a ?layout= link is dropped so the saved pick shows). */
function go(next: Pick | null, keepScroll: boolean, bodyScroll: number) {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the pick shows once */
  }
  try {
    sessionStorage.setItem(REOPEN, JSON.stringify({ y: keepScroll ? scrollY : 0, body: bodyScroll }));
  } catch {
    /* no reopen */
  }
  const target = location.pathname + cleanSearch(location.search) + location.hash;
  if (target === location.pathname + location.search + location.hash) location.reload();
  else location.replace(target);
}

export function Studio({ choice, placement }: { choice: Choice; placement: "nav" | "fab" }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const o = OPTIONS.find((x) => x.id === choice.option)!;
  const P = PALETTES[choice.palette];
  const F = FONTS[choice.font];
  const palettes = Object.entries(PALETTES);
  const pick = (change: Partial<Pick>, keepScroll: boolean) => {
    const next = pickFor(choice, change, PRESETS);
    const same = next.option === choice.option && next.palette === choice.palette && next.font === choice.font;
    if (same && choice.source === "saved") return; // already saved and on screen
    go(next, keepScroll, body.current?.scrollTop ?? 0);
  };

  const show = (from: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    loadEveryFont();
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    opener.current?.focus({ preventScroll: true });
  };

  // the close button takes the focus when the panel opens
  useEffect(() => {
    document.documentElement.classList.toggle("sp-open", open);
    if (open) panel.current?.querySelector<HTMLButtonElement>(".sp-x")?.focus({ preventScroll: true });
  }, [open]);

  // after a pick the page reloads: open the panel again, at the same place
  useEffect(() => {
    let back: { y?: number; body?: number } | null = null;
    try {
      back = JSON.parse(sessionStorage.getItem(REOPEN) ?? "null");
      sessionStorage.removeItem(REOPEN);
    } catch {
      back = null;
    }
    if (!back) return;
    if (back.y) requestAnimationFrame(() => window.scrollTo(0, back!.y!));
    show(btn.current);
    requestAnimationFrame(() => body.current && (body.current.scrollTop = back!.body ?? 0));
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      return hide();
    }
    if (e.key !== "Tab" || !panel.current) return; // keep the focus inside the panel while it is open
    const f = [...panel.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const lay = (x: (typeof OPTIONS)[number]) => (
    <button type="button" key={x.id} className={`sp-lay${x.id === choice.option ? " on" : ""}`} aria-pressed={x.id === choice.option} onClick={() => pick({ option: x.id }, x.id === choice.option)}>
      <Swatch p={PALETTES[x.cfg.palette]} />
      <b>{x.name}</b>
      <small>{x.short}</small>
    </button>
  );
  const pal = ([k, p]: [string, Palette]) => (
    <button type="button" key={k} className={`sp-pal${k === choice.palette ? " on" : ""}`} title={p.name} aria-label={p.name} aria-pressed={k === choice.palette} onClick={() => pick({ palette: k }, true)}>
      <Swatch p={p} />
    </button>
  );

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`sp-btn ${placement === "nav" ? "sp-nav" : "sp-fab"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change the layout, colours and type"
        onClick={(e) => show(e.currentTarget)}
      >
        <Icon />
        <span>Studio</span>
      </button>
      {createPortal(
        <>
          <div className="sp-backdrop" onClick={hide} />
          <div ref={panel} className="sp-panel" role="dialog" aria-modal="true" aria-labelledby="sp-title" aria-hidden={!open} inert={!open} onKeyDown={onKey}>
            <div className="sp-head">
              <div>
                <div className="sp-title" id="sp-title">
                  Studio
                </div>
                <div className="sp-sub">Make this page yours</div>
              </div>
              <button type="button" className="sp-x" aria-label="Close the studio" onClick={hide}>
                ×
              </button>
            </div>
            <div className="sp-body" ref={body}>
              <p className="sp-info">
                This page comes in {OPTIONS.length} layouts, {palettes.length} colour sets and {Object.keys(FONTS).length} typefaces. The answers and the numbers are the same in
                all of them. Pick the look you like best: it is saved in this browser and shown next time you come back.
              </p>
              <div className="sp-h">Layout</div>
              <div className="sp-group">{OPTIONS.filter((x) => !x.simple && !x.cfg.look).map(lay)}</div>
              <div className="sp-h sp-h2">Built around the system map</div>
              <div className="sp-group">{OPTIONS.filter((x) => x.cfg.look).map(lay)}</div>
              <div className="sp-h sp-h2">One-column layouts</div>
              <div className="sp-group">{OPTIONS.filter((x) => x.simple).map(lay)}</div>
              <div className="sp-h">
                Colours <span>{P.name}</span>
              </div>
              <div className="sp-pals">
                <span className="sp-k">Dark</span>
                {palettes.filter(([, p]) => !p.light).map(pal)}
              </div>
              <div className="sp-pals">
                <span className="sp-k">Light</span>
                {palettes.filter(([, p]) => p.light).map(pal)}
              </div>
              <div className="sp-h">
                Type <span>{F.name}</span>
              </div>
              <div className="sp-fonts">
                {Object.entries(FONTS).map(([k, f]) => (
                  <button type="button" key={k} className={`sp-font${k === choice.font ? " on" : ""}`} aria-pressed={k === choice.font} onClick={() => pick({ font: k }, true)}>
                    <span style={{ fontFamily: f.head, fontWeight: f.hw, textTransform: f.caps ? "uppercase" : undefined }}>Recall answers you can check</span>
                    <small>{f.name}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="sp-foot">
              <p className="sp-status">
                {statusFor(choice.source)}
                <br />
                <b>{o.name}</b> · {P.name} · {F.name}
              </p>
              <button type="button" className="sp-reset" disabled={choice.source === "default"} onClick={() => go(null, false, 0)}>
                Back to the default
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
