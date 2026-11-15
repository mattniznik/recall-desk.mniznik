// Usage events and Microsoft Clarity, ported from rag.irs's shared/track.js. Events go with
// sendBeacon to EVENTS_URL, which keeps only fields of a fixed shape and adds what it knows about
// the request (place, network, browser).
//   view          one per page load: the look, the link code, the referrer's host, size, setup, visitor id
//   studio_*      Studio open and picks            example   a recorded run, the Replay button or a suggestion
//   tab           Ask, Examples or Evals opened    link      a link out (GitHub, NHTSA, ...)
//   section       seconds each part of the page was in view
//   ask_focus     the question box got focus       ask_abandon   something was typed and never asked
//   ask           a live question: its words, outcome, seconds and cost (Chat.tsx calls trackAnswer)
//   copy          text copied, where and how long  error     a script error (5 at most)
//   perf          TTFB, FCP, LCP, CLS, load        leave     furthest point read, seconds in view
// Off in the local preview, with Global Privacy Control, or in this browser after ?track=off (until
// ?track=on): then no events, no visitor id and no Clarity. A ?src=<code> on the link is kept for the
// visit in sessionStorage. Live questions and answers are masked in Clarity's recordings
// (data-clarity-mask in Chat.tsx).
//
// The helpers above startTracking are pure and tested in test/web-track.test.ts.

import type { AskEvent } from "../../src/server/ask.ts";
import type { Choice } from "./studio/choice.ts";

const EVENTS_URL = "https://events.mniznik.com/api/event";
const CLARITY = "ze4mrsxqee"; // the Clarity project id; empty: no Clarity
const OFF = "recall-desk-no-track", SRC = "recall-desk-src", VID = "recall-desk-vid";

/** A suggestion's id: its label in lower case, words joined by "-", at most 40 characters. */
export function sampleId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

/** What a link out points at ("github", "linkedin", "nhtsa", "rag", or the host); "" for this page. */
export function linkKind(href: string, here: string): string {
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return "";
  }
  if (!host || host === here) return "";
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (host === "nhtsa.gov" || host.endsWith(".nhtsa.gov")) return "nhtsa";
  if (host === "rag.irs.mniznik.com") return "rag";
  return host.slice(0, 40);
}

/** The tab a hash opens (evals.ts routes), or null for a section anchor such as #how. */
export function tabOf(hash: string): "ask" | "examples" | "evals" | null {
  if (hash === "" || hash === "#" || hash === "#/") return "ask";
  return hash === "#/examples" ? "examples" : hash === "#/evals" ? "evals" : null;
}

/** How a question's stream ended: done's status, the error's code, or "failed" when it was cut off. */
export function outcomeOf(events: AskEvent[]): string {
  for (const e of events) {
    if (e.type === "done") return e.status;
    if (e.type === "error") return e.code;
  }
  return "failed";
}

export function trackingOff(s: { dev: boolean; gpc: boolean; optedOut: boolean }): boolean {
  return s.dev || s.gpc || s.optedOut;
}

// ---------- in the browser ----------

type Send = (t: string, fields: Record<string, unknown>) => void;
let send: Send | null = null; // set by startTracking when tracking is on
let typed = 0;
const clarity = (...a: unknown[]) => {
  try {
    (window as unknown as { clarity?: (...x: unknown[]) => void }).clarity?.(...a);
  } catch {
    /* never in the way */
  }
};

/** A live question was sent (Chat.tsx): it is no longer "typed, never asked". */
export function trackAsked() {
  typed = 0;
  if (!send) return;
  clarity("event", "asked_question");
  clarity("upgrade", "asked a question");
}

/** A live question ended (Chat.tsx): its words, how it ended, seconds and cost. */
export function trackAnswer(question: string, events: AskEvent[], ms: number) {
  if (!send) return;
  const outcome = outcomeOf(events);
  const done = events.find((e) => e.type === "done");
  const cost = done && done.type === "done" ? (done.costUsd ?? 0) : 0;
  send("ask", { text: question, value: outcome, ms: done && done.type === "done" ? done.seconds * 1000 : ms, cost });
  clarity("event", `answer_${outcome}`);
}

/** Starts the events and Clarity for this page load, once the layout has rendered (main.tsx). */
export function startTracking(choice: Choice) {
  const q = new URLSearchParams(location.search);
  const store = <T,>(s: () => Storage, f: (s: Storage) => T): T | null => {
    try {
      return f(s());
    } catch {
      return null; // storage can be blocked
    }
  };
  if (q.get("track") === "off") store(() => localStorage, (s) => s.setItem(OFF, "1"));
  if (q.get("track") === "on") store(() => localStorage, (s) => s.removeItem(OFF));
  const off = trackingOff({
    dev: import.meta.env?.DEV === true,
    gpc: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
    optedOut: store(() => localStorage, (s) => s.getItem(OFF)) === "1",
  });
  if (off) return;

  const rand = (n: number) => {
    let s = "";
    while (s.length < n) s += Math.random().toString(36).slice(2);
    return s.slice(0, n);
  };
  let src = (q.get("src") || "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(src)) src = "";
  if (src) store(() => sessionStorage, (s) => s.setItem(SRC, src));
  else src = store(() => sessionStorage, (s) => s.getItem(SRC)) || "";
  let vid = store(() => localStorage, (s) => s.getItem(VID)) || "";
  if (!/^[a-z0-9]{12}$/.test(vid)) {
    vid = rand(12);
    store(() => localStorage, (s) => s.setItem(VID, vid));
  }
  const pv = rand(8); // this page load only
  const ctx = { layout: choice.option, palette: choice.palette, font: choice.font, how: choice.source, src, pv, vid };

  send = (t, fields) => {
    const body = JSON.stringify({ t, ...ctx, ...fields });
    try {
      if (!navigator.sendBeacon(EVENTS_URL, body)) fetch(EVENTS_URL, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
    } catch {
      /* never in the way */
    }
  };
  const emit = send;

  // ---------- Microsoft Clarity: recordings and heatmaps, tagged so a recording can be matched to the events ----------
  if (CLARITY && !document.getElementById("clarity-script")) {
    // Microsoft's loader, as in the @microsoft/clarity package (src/utils.js): calls queue until the tag loads
    const w = window as unknown as { clarity?: ((...a: unknown[]) => void) & { q?: IArguments[] } };
    w.clarity =
      w.clarity ||
      function () {
        // eslint-disable-next-line prefer-rest-params
        (w.clarity!.q = w.clarity!.q || []).push(arguments);
      };
    const t = document.createElement("script");
    t.async = true;
    t.src = "https://www.clarity.ms/tag/" + CLARITY;
    t.id = "clarity-script";
    document.head.appendChild(t);
    clarity("identify", vid, undefined, pv);
    clarity("set", "layout", choice.option);
    clarity("set", "vid", vid);
    clarity("set", "pv", pv);
    if (src) {
      clarity("set", "src", src);
      clarity("set", "app_link", "yes");
      clarity("upgrade", "application link");
    }
  }

  // ---------- the view ----------
  const refHost = (() => {
    try {
      const h = new URL(document.referrer).hostname;
      return h && h !== location.hostname ? h : "";
    } catch {
      return "";
    }
  })();
  const size = innerWidth < 700 ? "phone" : innerWidth < 1100 ? "tablet" : "desktop";
  const mq = (m: string) => matchMedia(m).matches;
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const setup = [
    navigator.language || "",
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      } catch {
        return "";
      }
    })(),
    `${screen.width}x${screen.height}`,
    String(Math.round((devicePixelRatio || 1) * 100) / 100),
    mq("(prefers-color-scheme: dark)") ? "dark" : "light",
    mq("(prefers-reduced-motion: reduce)") ? "reduce" : "no-pref",
    conn?.effectiveType || "",
  ]
    .map((s) => String(s).replace(/[^A-Za-z0-9_./+:-]/g, ""))
    .join("|");
  emit("view", { ref: refHost, size, setup });

  // where on the page something happened
  const where = (el: Element) =>
    el.closest(".trace") ? "trace"
      : el.closest(".answer") ? "answer"
      : el.closest("#built, .wf") ? "built"
      : el.closest(".evals") ? "evals"
      : el.closest("#map, .sm-sec") ? "map"
      : el.closest("#how, .howbar") ? "how"
      : el.closest("nav") ? "nav"
      : "page";

  // ---------- clicks ----------
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      const sp = el.closest<HTMLElement>(".sp-btn, .sp-lay, .sp-pal, .sp-font, .sp-reset");
      if (sp) {
        if (sp.matches(".sp-btn")) return emit("studio_open", {});
        if (sp.matches(".sp-reset")) return emit("studio_pick", { kind: "reset" });
        const [kind, value] = sp.matches(".sp-lay") ? ["layout", sp.dataset.o] : sp.matches(".sp-pal") ? ["palette", sp.dataset.p] : ["font", sp.dataset.f];
        return emit("studio_pick", { kind, value });
      }
      const ex = el.closest<HTMLElement>("[data-ex], [data-again], [data-sample]");
      if (ex) {
        clarity("event", "example_clicked");
        const d = ex.dataset;
        return emit("example", d.ex ? { kind: "recorded", value: d.ex } : d.again ? { kind: "replay", value: d.again } : { kind: "sample", value: sampleId(d.sample || "") });
      }
      const a = el.closest<HTMLAnchorElement>("a[href]");
      if (a) {
        const kind = linkKind(a.href, location.hostname);
        if (!kind) return;
        if (kind === "github" || kind === "linkedin") clarity("event", `link_${kind}`);
        emit("link", { value: kind, where: where(a) });
      }
    },
    true, // capture: a Studio pick reloads the page from its own handler, so count it first
  );
  addEventListener("hashchange", () => {
    const tab = tabOf(location.hash);
    if (tab) emit("tab", { value: tab });
  });

  // ---------- the question box: focused, typed into, asked or not ----------
  let focused = false;
  const isAsk = (t: EventTarget | null) => t instanceof HTMLTextAreaElement && t.id === "q";
  document.addEventListener("focusin", (e) => {
    if (isAsk(e.target) && !focused) {
      focused = true;
      emit("ask_focus", {});
    }
  });
  document.addEventListener("input", (e) => {
    if (isAsk(e.target)) typed = (e.target as HTMLTextAreaElement).value.trim().length;
  });

  // ---------- copying ----------
  document.addEventListener("copy", () => {
    const sel = getSelection(), n = sel ? String(sel).length : 0;
    const node = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement) : null;
    if (n) {
      clarity("event", "copied_text");
      emit("copy", { n, where: node ? where(node) : "page" });
    }
  });

  // ---------- script errors (5 per page at most) ----------
  let errors = 0;
  const err = (message: unknown, file: string) => {
    if (errors++ >= 5) return;
    emit("error", { text: String(message || "").slice(0, 200), value: String(file || "").split(/[/?#]/).filter(Boolean).pop() || "" });
  };
  addEventListener("error", (e) => err(e.message, e.filename));
  addEventListener("unhandledrejection", (e) => err(e.reason?.message ?? String(e.reason), ""));

  // ---------- page speed ----------
  const perf = { ttfb: 0, fcp: 0, lcp: 0, cls: 0, load: 0 };
  const watch = (type: string, f: (e: PerformanceEntry & { value?: number; hadRecentInput?: boolean }) => void) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(f)).observe({ type, buffered: true });
    } catch {
      /* not supported */
    }
  };
  watch("paint", (e) => {
    if (e.name === "first-contentful-paint") perf.fcp = e.startTime;
  });
  watch("largest-contentful-paint", (e) => {
    perf.lcp = e.startTime;
  });
  watch("layout-shift", (e) => {
    if (!e.hadRecentInput) perf.cls += e.value ?? 0;
  });
  const nav = () => {
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (n) {
      perf.ttfb = n.responseStart;
      perf.load = n.loadEventEnd;
    }
  };

  // ---------- sections: seconds each part of the page was in view ----------
  const secs = new Map<string, number>(), since = new Map<string, number>(), sentSecs = new Map<string, number>();
  const nameOf = (el: Element) => el.id || el.tagName.toLowerCase();
  const tick = (name: string, on: boolean) => {
    const now = Date.now();
    if (since.has(name)) {
      secs.set(name, (secs.get(name) || 0) + now - since.get(name)!);
      since.delete(name);
    }
    if (on && document.visibilityState === "visible") since.set(name, now);
  };
  let io: IntersectionObserver | null = null;
  const parts = () => [...document.querySelectorAll("section[id], figure[id], main > h2[id], #desk, footer")];
  const observe = () =>
    parts().forEach((el) => {
      io!.unobserve(el);
      io!.observe(el); // observe() reports what is in view now
    });
  try {
    io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          const h = Math.min(e.boundingClientRect.height, innerHeight);
          tick(nameOf(e.target), e.isIntersecting && e.intersectionRect.height >= h * 0.25);
        }),
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    observe();
    setTimeout(observe, 1500); // parts a layout renders a moment later
  } catch {
    io = null; // no IntersectionObserver
  }

  // ---------- leaving: once each time the page is hidden ----------
  let maxScroll = 0, shown = 0, shownSince = document.visibilityState === "visible" ? Date.now() : 0, sent = false, perfSent = false;
  const read = () => {
    const h = document.documentElement.scrollHeight;
    maxScroll = Math.max(maxScroll, h ? Math.min(100, ((scrollY + innerHeight) / h) * 100) : 0);
  };
  addEventListener("scroll", read, { passive: true });
  const leave = () => {
    if (sent) return;
    sent = true;
    read();
    if (shownSince) {
      shown += Date.now() - shownSince;
      shownSince = 0;
    }
    [...since.keys()].forEach((name) => tick(name, false));
    for (const [name, ms] of secs) {
      const s = Math.round(ms / 1000) - (sentSecs.get(name) || 0);
      if (s > 0) {
        sentSecs.set(name, (sentSecs.get(name) || 0) + s);
        emit("section", { kind: name, secs: s });
      }
    }
    if (typed > 0) {
      emit("ask_abandon", { n: typed });
      typed = 0;
    }
    if (!perfSent) {
      perfSent = true;
      nav();
      emit("perf", perf);
    }
    emit("leave", { scroll: Math.round(maxScroll), secs: Math.round(shown / 1000) });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
    else {
      shownSince = Date.now();
      sent = false;
      if (io) observe();
    }
  });
  addEventListener("pagehide", leave);
}
