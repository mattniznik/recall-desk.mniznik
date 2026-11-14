// The five layouts built around the system map (10-14), one per design reference
// (2026-11-14). Patterns are borrowed, nothing is copied: no
// logo, product name, illustration or copy text from any of them.
//
//   10 canvas    - a workflow-run canvas: runs in a rail, the map as the canvas, the desk as its logs
//   11 waterfall - an observability trace: one run as a span tree with measured bars, a detail panel
//   12 workshop  - a light tabbed sheet: a tab per tool beside the map on graph paper
//   13 spec      - a dark spec sheet: a numbered index, the map as Fig. 1 with numbered callouts
//   14 garage    - friendly status cards, like a car app; a tap finds the piece on the map
//
// Each keeps everything the other layouts have: the desk (Ask with What to try while live,
// Examples with replays, Evals), the system map with its tour, how it works, the measured runs,
// how it was built, and the footer's disclaimer. Every number comes from site-data.json, a
// recorded run or the server's limits module.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import "../rich/rich.css";
import "./looks.css";
import { App, REPLAYS, replayOf } from "../App.tsx";
import { Studio } from "../studio/Studio.tsx";
import type { Cfg, Choice } from "../studio/choice.ts";
import { Built } from "../shared/Built.tsx";
import { SystemMap } from "../shared/SystemMap.tsx";
import { AskLink, Proof } from "../rich/RichPage.tsx";
import { CHAT_LIMITS, COST_RANGE, DISCLAIMER, HOW, MAP_CTX, site, STACK, STORE_NAME } from "../shared/data.ts";
import { useLive, useMotion } from "../live.ts";
import { publish, requestTour } from "../map-feed.ts";
import { mapGraph, SOURCES } from "../system-map.ts";
import { money, ruleOrder, ruleTitle } from "../site.ts";
import { describeInput, TOOL_LABEL, type Replay } from "../trace.ts";

const runs = site.runs;
const GRAPH = mapGraph(MAP_CTX);
const nodeOf = (id: string) => GRAPH.nodes.find((n) => n.id === id)!;
const titleOf = (key: string) => REPLAYS.find((r) => r.key === key)?.title ?? key;
const REAL = REPLAYS.filter((r) => r.replay.real);
const LEDE =
  "A support agent wired into a store's systems: NHTSA's recall, complaint and safety data, the parts catalog and a handoff to a person. Code checks every answer before a customer sees it.";

/** Play a recorded run on the map (and say so in its caption). */
const playRun = (key: string, from: string) => publish({ id: `${from}-${key}-${Date.now()}`, title: titleOf(key), mode: "replay", events: replayOf(key).events });

/** A tool's first call in the recorded real runs: the run, what was asked, what came back. */
function firstCall(tool: string) {
  for (const r of REAL) {
    const ev = r.replay.events;
    const i = ev.findIndex((e) => e.type === "tool_call" && e.name === tool);
    if (i < 0) continue;
    const call = ev[i], res = ev.slice(i).find((e) => e.type === "tool_result" && e.name === tool);
    if (call.type === "tool_call" && res && res.type === "tool_result") return { key: r.key, title: r.title, question: r.replay.question, input: describeInput(call.input), summary: res.summary, ms: res.ms };
  }
  return null;
}

/** How often each rule sent a recorded real answer back. */
const caughtBy = (rule: string) => REAL.reduce((n, r) => n + r.replay.events.filter((e) => e.type === "rule_failed" && e.violations.some((v) => v.rule === rule)).length, 0);

const runLine = (key: string) => {
  const r = runs.runs.find((x) => x.key === key);
  if (!r) return "";
  const how = r.handoff ? "Handed to a person" : r.caught ? "Sent back once, then passed" : "Passed";
  return `${how} in ${r.seconds.toFixed(1)} s · ${money(r.costUsd)}`;
};
const runTone = (key: string) => {
  const r = runs.runs.find((x) => x.key === key);
  return !r ? "" : r.handoff ? "hand" : r.caught ? "held" : "ok";
};

/* ---------------------------------------------------------------- shared frame */

const TourButton = ({ className = "btn" }: { className?: string }) => (
  <button type="button" className={className} onClick={() => requestTour()}>
    Take the tour
  </button>
);

function Nav({ choice, live, links, center = false }: { choice: Choice; live: boolean | null; links: [string, string][]; center?: boolean }) {
  return (
    <nav className={`nav lk-nav${center ? " lk-center" : ""}`} aria-label="Sections">
      <div className="wrap">
        <span className="brand">
          <i />
          {STORE_NAME}
        </span>
        <Studio choice={choice} placement="nav" />
        <span className="links">
          {links.map(([h, t]) => (
            <a key={h} href={h}>
              {t}
            </a>
          ))}
        </span>
        <AskLink live={live} className="btn go small" />
      </div>
    </nav>
  );
}

function Foot({ live }: { live: boolean | null }) {
  return (
    <footer className="foot lk-foot">
      <div className="wrap">
        <div className="grid">
          <div>
            <span className="brand">
              <i />
              {STORE_NAME}
            </span>
            <p className="muted disclaimer">{DISCLAIMER}</p>
            <div className="stack">
              {STACK.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </div>
          <div className="btns end">
            <AskLink live={live} className="btn go" />
            <a className="btn" href="#map">
              The system map
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** How it works in words: the six steps, numbered, for the layouts whose map needs a text beside it. */
function Steps({ className = "" }: { className?: string }) {
  return (
    <ol className={`lk-steps ${className}`}>
      {HOW.map((h, i) => (
        <li key={h.title}>
          <span className="lk-sn">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <b>{h.title}</b> <span className="lk-sub">{h.sub}</span>
            <p>{h.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const Desk = ({ className = "" }: { className?: string }) => (
  <div className={`desk-stage lk-desk ${className}`}>
    <App />
  </div>
);

export function LookPage({ cfg, choice }: { cfg: Cfg; choice: Choice }) {
  const live = useLive();
  useEffect(() => document.documentElement.classList.remove("boot"), []);
  const props = { choice, live };
  switch (cfg.look) {
    case "waterfall":
      return <Waterfall {...props} />;
    case "workshop":
      return <Workshop {...props} />;
    case "spec":
      return <Spec {...props} />;
    case "garage":
      return <Garage {...props} />;
    default:
      return <Canvas {...props} />;
  }
}

type PageProps = { choice: Choice; live: boolean | null };

/* ---------------------------------------------------------------- 10 · run canvas */

function Canvas({ choice, live }: PageProps) {
  const [on, setOn] = useState<string | null>(null);
  return (
    <>
      <Nav choice={choice} live={live} links={[["#map", "Canvas"], ["#how", "How it works"], ["#proof", "Results"], ["#built", "How it was built"]]} />
      <header className="lk-c-head wrap">
        <p className="lk-crumb">
          {STORE_NAME} <span>/</span> recall desk agent <span>/</span> <b>runs</b>
        </p>
        <div className="lk-c-title">
          <h1 className="h1">Watch the agent work, one piece at a time.</h1>
          <span className={`pill ${live ? "ok" : "nf"}`}>{live === null ? "Checking live answers" : live ? "Live answers on" : "Recorded runs only"}</span>
        </div>
        <p className="lede">{LEDE}</p>
      </header>
      <section className="lk-c-shell wrap" id="map">
        <aside className="lk-c-rail" aria-label="Recorded real runs">
          <div className="lk-c-railhead">
            <b>Runs</b>
            <span>{runs.count} recorded</span>
          </div>
          <ul>
            {runs.runs.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  className={`lk-run ${runTone(r.key)}${on === r.key ? " on" : ""}`}
                  aria-pressed={on === r.key}
                  onClick={() => {
                    setOn(r.key);
                    playRun(r.key, "rail");
                  }}
                >
                  <b>{titleOf(r.key)}</b>
                  <span>{runLine(r.key)}</span>
                </button>
              </li>
            ))}
          </ul>
          <TourButton className="btn lk-c-tour" />
        </aside>
        <div className="lk-c-main">
          <SystemMap compact className="lk-c-map" />
          <div className="lk-c-logs" id="desk-panel">
            <div className="lk-c-loghead">
              <b>Logs</b>
              <span>the trace panel and the answer, as on every layout</span>
            </div>
            <App />
          </div>
        </div>
      </section>
      <section className="sec lk-sec" id="how">
        <div className="wrap">
          <h2 className="h2">How a run moves across the canvas</h2>
          <Steps />
        </div>
      </section>
      <Proof kind="table" />
      <Built />
      <Foot live={live} />
    </>
  );
}

/* ---------------------------------------------------------------- 11 · trace waterfall */

type Span = { id: string; depth: number; kind: "root" | "model" | "tool" | "rules" | "answer" | "handoff"; name: string; detail: string; value: string; share: number; node: string; bad: boolean; attrs: [string, string][] };

function spansOf(r: Replay): Span[] {
  const ev = r.events;
  const t = r.tokens ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const total = t.input + t.cacheWrite + t.cacheRead + t.output || 1;
  const runMs = (r.seconds ?? 0) * 1000 || 1;
  const count = (type: string) => ev.filter((e) => e.type === type).length;
  const out: Span[] = [
    {
      id: "root",
      depth: 0,
      kind: "root",
      name: "ask",
      detail: r.question,
      value: `${(r.seconds ?? 0).toFixed(1)} s`,
      share: 1,
      node: "loop",
      bad: false,
      attrs: [
        ["question", r.question],
        ["model calls", String(count("model_call"))],
        ["lookups", String(count("tool_call"))],
        ["tokens", total.toLocaleString("en-US")],
        ["seconds", (r.seconds ?? 0).toFixed(1)],
        ["cost", r.real ? money(r.costUsd ?? 0) : "$0, scripted"],
        ["recorded", r.label],
      ],
    },
  ];
  let pending: { name: string; input: unknown } | null = null;
  ev.forEach((e, i) => {
    if (e.type === "model_call") {
      const u = e.usage ?? { input_tokens: 0, output_tokens: 0 };
      const tok = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + u.output_tokens;
      out.push({
        id: `e${i}`,
        depth: 1,
        kind: "model",
        name: `model · call ${e.n}`,
        detail: e.model ?? MAP_CTX.model.id,
        value: `${tok.toLocaleString("en-US")} tok`,
        share: tok / total,
        node: "model",
        bad: false,
        attrs: [
          ["model", e.model ?? "?"],
          ["stop reason", e.stopReason],
          ["input tokens", String(u.input_tokens)],
          ["cache write", String(u.cache_creation_input_tokens ?? 0)],
          ["cache read", String(u.cache_read_input_tokens ?? 0)],
          ["output tokens", String(u.output_tokens)],
        ],
      });
    } else if (e.type === "tool_call") pending = { name: e.name, input: e.input };
    else if (e.type === "tool_result") {
      const s = SOURCES[e.name];
      out.push({
        id: `e${i}`,
        depth: 2,
        kind: "tool",
        name: `tool · ${e.name}`,
        detail: `${describeInput(pending?.input)} → ${e.summary}`,
        value: `${e.ms} ms`,
        share: e.ms / runMs,
        node: `tool:${e.name}`,
        bad: !e.ok,
        attrs: [
          ["tool", `${e.name} (${TOOL_LABEL[e.name] ?? e.name})`],
          ["input", describeInput(pending?.input) || "none"],
          ["reads", s ? `${s.host} ${s.path}` : "?"],
          ["returned", e.summary],
          ["ms", String(e.ms)],
          ["ok", String(e.ok)],
        ],
      });
      pending = null;
    } else if (e.type === "rule_failed") {
      out.push({
        id: `e${i}`,
        depth: 2,
        kind: "rules",
        name: "rules · sent back",
        detail: e.violations.map((v) => ruleTitle(v.rule)).join("; "),
        value: e.violations.map((v) => v.rule).join(", "),
        share: 0,
        node: "rules",
        bad: true,
        attrs: e.violations.flatMap((v): [string, string][] => [
          ["rule", v.rule],
          ["title", ruleTitle(v.rule)],
          ["told the model", v.detail],
        ]),
      });
    } else if (e.type === "answer") {
      const a = e.answer;
      out.push({
        id: `e${i}`,
        depth: 2,
        kind: a.handoff ? "handoff" : "answer",
        name: a.handoff ? "answer · to a person" : "answer · shown",
        detail: `all ${MAP_CTX.rules.length} rules passed`,
        value: `${a.cited_recall_ids.length} cited`,
        share: 0,
        node: a.handoff ? "handoff" : "answer",
        bad: false,
        attrs: [
          ["text", a.text],
          ["cited", a.cited_recall_ids.join(", ") || "none"],
          ["applies", a.applies_to_vehicle.join(", ") || "none"],
          ["fits", a.fits.join(", ") || "none"],
          ["handoff", String(a.handoff)],
        ],
      });
    } else if (e.type === "handoff") {
      out.push({ id: `e${i}`, depth: 1, kind: "handoff", name: "handoff", detail: `ticket ${e.ticketId}`, value: e.reason, share: 0, node: "handoff", bad: true, attrs: [["ticket", e.ticketId], ["reason", e.reason]] });
    }
  });
  return out;
}

function Waterfall({ choice, live }: PageProps) {
  const [key, setKey] = useState("real-safety");
  const r = replayOf(key);
  const spans = useMemo(() => spansOf(r), [r]);
  const [sel, setSel] = useState("root");
  const span = spans.find((s) => s.id === sel) ?? spans[0];
  const t = r.tokens ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const chips: [string, string][] = [
    ["Model calls", String(r.events.filter((e) => e.type === "model_call").length)],
    ["Lookups", String(r.events.filter((e) => e.type === "tool_call").length)],
    ["Tokens", (t.input + t.cacheWrite + t.cacheRead + t.output).toLocaleString("en-US")],
    ["Seconds", (r.seconds ?? 0).toFixed(1)],
    ["Cost", money(r.costUsd ?? 0)],
    ["Sent back", String(r.events.filter((e) => e.type === "rule_failed").length)],
  ];
  return (
    <>
      <Nav choice={choice} live={live} links={[["#trace", "Trace"], ["#map", "System map"], ["#ask", "Ask"], ["#proof", "Results"]]} />
      <section className="lk-w-head wrap" id="trace">
        <p className="lk-crumb">
          Traces <span>/</span> recorded real runs <span>/</span> <b>{key}</b>
        </p>
        <div className="lk-w-top">
          <div>
            <h1 className="h1">{r.question}</h1>
            <p className="lede">Every recorded run as a trace: each model call, each lookup and each rule check, with what it measured. Pick a row to see it, and where it sits on the map.</p>
          </div>
          <dl className="lk-w-chips">
            {chips.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lk-w-tabs" role="group" aria-label="Recorded real runs">
          {REAL.map((x) => (
            <button
              type="button"
              key={x.key}
              aria-pressed={x.key === key}
              onClick={() => {
                setKey(x.key);
                setSel("root");
                playRun(x.key, "trace");
              }}
            >
              {x.title}
            </button>
          ))}
        </div>
        <div className="lk-w-grid">
          <div className="lk-w-tree" role="table" aria-label="The run's spans">
            <div className="lk-w-row lk-w-th" role="row">
              <span role="columnheader">Span</span>
              <span role="columnheader">Share of the run: tokens for a model call, time for a lookup</span>
            </div>
            {spans.map((s) => (
              <button type="button" role="row" key={s.id} className={`lk-w-row k-${s.kind}${s.bad ? " bad" : ""}${s.id === span.id ? " on" : ""}`} onClick={() => setSel(s.id)}>
                <span className="lk-w-name" role="cell" style={{ paddingLeft: 6 + s.depth * 16 }}>
                  <i className="lk-w-dot" />
                  <b>{s.name}</b>
                  <small>{s.detail}</small>
                </span>
                <span className="lk-w-bar" role="cell">
                  <i style={{ width: s.share > 0 ? `${Math.max(1.2, s.share * 100).toFixed(1)}%` : undefined }} className={s.share > 0 ? "" : "mark"} />
                  <em>{s.value}</em>
                </span>
              </button>
            ))}
          </div>
          <aside className="lk-w-span" aria-live="polite">
            <p className="lk-w-kind">{span.kind === "root" ? "Run" : "Span"}</p>
            <h2 className="h3">{span.name}</h2>
            <dl>
              {span.attrs.map(([k, v], i) => (
                <div key={i}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="lk-w-where">
              On the map: <b>{nodeOf(span.node).label}</b>. {nodeOf(span.node).info}
            </p>
          </aside>
        </div>
      </section>
      <section className="lk-w-map wrap" id="map">
        <h2 className="h2">The same run on the system map</h2>
        <SystemMap focus={span.node} />
      </section>
      <section className="sec lk-sec" id="ask">
        <div className="wrap">
          <h2 className="h2">Ask, or replay any run</h2>
          <p className="lk-note">The desk: live questions while live answers are on, every recorded run step by step, and the evals.</p>
          <Desk />
        </div>
      </section>
      <section className="sec lk-sec lk-tight" id="how">
        <div className="wrap">
          <h2 className="h2">How it works</h2>
          <Steps />
        </div>
      </section>
      <Proof kind="cards" />
      <Built />
      <Foot live={live} />
    </>
  );
}

/* ---------------------------------------------------------------- 12 · workshop sheet */

function Workshop({ choice, live }: PageProps) {
  const tabs = [...MAP_CTX.tools.map((t) => t.name), "rules"];
  const [tab, setTab] = useState("get_recalls");
  const isRules = tab === "rules";
  const tool = MAP_CTX.tools.find((t) => t.name === tab);
  const src = SOURCES[tab];
  const call = isRules ? null : firstCall(tab);
  const focus = isRules ? "rules" : `tool:${tab}`;
  return (
    <>
      <Nav choice={choice} live={live} links={[["#tools", "Tools"], ["#map", "System map"], ["#ask", "Ask"], ["#proof", "Results"]]} />
      <header className="lk-k-hero wrap">
        <p className="eyebrow">
          [ <b>{STORE_NAME}</b> · support agent · {site.model.name} ]
        </p>
        <h1 className="h1">Every tool the agent can reach, on one sheet.</h1>
        <p className="lede">{LEDE}</p>
        <div className="btns">
          <AskLink live={live} className="btn go" />
          <TourButton />
        </div>
      </header>
      <section className="lk-k-sheet wrap" id="tools">
        <div className="lk-k-tabs" role="tablist" aria-label="The agent's tools and its rules">
          {tabs.map((t) => (
            <button type="button" role="tab" key={t} aria-selected={t === tab} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
              {t === "rules" ? `${MAP_CTX.rules.length} rules` : (TOOL_LABEL[t] ?? t)}
            </button>
          ))}
        </div>
        <div className="lk-k-panel" role="tabpanel">
          <div className="lk-k-text">
            {isRules ? (
              <>
                <h2 className="h2">{MAP_CTX.rules.length} rules, in code</h2>
                <p>Checked after the model answers, before a customer sees anything. A broken rule sends the answer back once, with the reason.</p>
                <ul className="lk-k-rules">
                  {ruleOrder(MAP_CTX.rules).map((r) => (
                    <li key={r}>
                      <b>{ruleTitle(r)}</b>
                      <code>{r}</code>
                      <span>{caughtBy(r) ? `sent back ${caughtBy(r)} of ${runs.count} real answers` : "no real answer broke it"}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 className="h2">{TOOL_LABEL[tab] ?? tab}</h2>
                <p>{tool?.description}</p>
                <dl className="lk-k-facts">
                  <div>
                    <dt>Tool</dt>
                    <dd>
                      <code>{tab}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Reads</dt>
                    <dd>
                      {src.label} · <code>{src.host === "this repository" || src.host === "the page" ? src.path : `${src.host}${src.path}`}</code>
                    </dd>
                  </div>
                </dl>
              </>
            )}
          </div>
          <div className="lk-k-call">
            <p className="lk-k-lab">{isRules ? "A real catch" : "A real call"}</p>
            {isRules ? (
              <RuleCatch />
            ) : call ? (
              <>
                <p className="lk-k-q">"{call.question}"</p>
                <div className="lk-k-io">
                  <span>in</span>
                  <b>{call.input || "no input"}</b>
                  <span>out</span>
                  <b>{call.summary}</b>
                  <span>time</span>
                  <b>{call.ms} ms</b>
                </div>
                <button type="button" className="btn" onClick={() => playRun(call.key, "sheet")}>
                  Play this run on the map
                </button>
              </>
            ) : (
              <p className="lk-k-none">None of the {runs.count} recorded real runs needed it. The live chat can call it; try "What to try" in the desk.</p>
            )}
            <p className="lk-k-src">{src ? src.info : nodeOf("rules").info}</p>
          </div>
        </div>
      </section>
      <section className="lk-k-map wrap" id="map">
        <SystemMap focus={focus} onPick={(id) => (id.startsWith("tool:") ? setTab(id.slice(5)) : id.startsWith("src:") ? setTab(id.slice(4)) : id === "rules" ? setTab("rules") : null)} />
      </section>
      <section className="sec lk-sec" id="ask">
        <div className="wrap">
          <h2 className="h2">Try it</h2>
          <Desk />
        </div>
      </section>
      <section className="sec lk-sec lk-tight" id="how">
        <div className="wrap">
          <h2 className="h2">How it works</h2>
          <Steps />
        </div>
      </section>
      <Proof kind="versus" />
      <Built />
      <Foot live={live} />
    </>
  );
}

function RuleCatch() {
  const r = REAL.find((x) => x.replay.events.some((e) => e.type === "rule_failed"));
  if (!r) return <p className="lk-k-none">No recorded real answer broke a rule.</p>;
  const f = r.replay.events.find((e) => e.type === "rule_failed");
  const v = f && f.type === "rule_failed" ? f.violations[0] : null;
  return (
    <>
      <p className="lk-k-q">"{r.replay.question}"</p>
      {v && (
        <div className="lk-k-io">
          <span>rule</span>
          <b>{ruleTitle(v.rule)}</b>
          <span>told</span>
          <b>{v.detail}</b>
        </div>
      )}
      <button type="button" className="btn" onClick={() => playRun(r.key, "sheet")}>
        Play this run on the map
      </button>
    </>
  );
}

/* ---------------------------------------------------------------- 13 · spec sheet */

const SPEC = [
  ["s1", "System"],
  ["ask", "Ask"],
  ["s3", "Rules"],
  ["proof", "Results"],
  ["built", "Build"],
] as const;

const CALLOUTS: [string, string][] = [
  ["turnstile", "The way in"],
  ["limits", "The limits"],
  ["loop", "The loop"],
  ["model", "The model"],
  ["tool:get_recalls", "The tools"],
  ["rules", "The rules"],
];

function Spec({ choice, live }: PageProps) {
  const [cur, setCur] = useState("s1");
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    const els = SPEC.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setCur(e.target.id)), { rootMargin: "-40% 0px -55% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <>
      <Nav choice={choice} live={live} links={[["#s1", "System"], ["#ask", "Ask"], ["#s3", "Rules"], ["#proof", "Results"]]} />
      <div className="lk-s wrap">
        <nav className="lk-s-index" aria-label="On this page">
          {SPEC.map(([id, t], i) => (
            <a key={id} href={`#${id}`} className={cur === id ? "on" : ""} aria-current={cur === id ? "true" : undefined}>
              <span>{String(i + 1).padStart(2, "0")}</span> {t}
            </a>
          ))}
        </nav>
        <div className="lk-s-main">
          <section id="s1" className="lk-s-sec">
            <p className="lk-s-eye">
              <i /> Recall desk agent · {site.model.name}
            </p>
            <h1 className="h1">An agent that answers from the record, and code that checks it.</h1>
            <div className="lk-s-para">
              <span>01</span>
              <p>{LEDE}</p>
            </div>
            <div className="btns">
              <AskLink live={live} className="btn go" />
              <TourButton />
            </div>
            <figure className="lk-s-fig" id="map">
              <figcaption>
                <span>Fig 1.A</span> The recall desk, end to end
              </figcaption>
              <SystemMap focus={focus} onPick={setFocus} />
            </figure>
            <ol className="lk-s-callouts">
              {CALLOUTS.map(([id, t], i) => (
                <li key={id}>
                  <button type="button" aria-pressed={focus === id} onClick={() => setFocus(focus === id ? null : id)}>
                    <span>[1.A.{i + 1}]</span> {t}
                  </button>
                  <p>{nodeOf(id).info}</p>
                </li>
              ))}
            </ol>
          </section>
          <section id="ask" className="lk-s-sec">
            <p className="lk-s-eye">
              <i /> 02 · Ask
            </p>
            <h2 className="h2">Ask it, or replay what it did.</h2>
            <figure className="lk-s-fig">
              <figcaption>
                <span>Fig 2</span> The desk: live chat, recorded runs, evals
              </figcaption>
              <div className="lk-s-desk">
                <App />
              </div>
            </figure>
          </section>
          <section id="s3" className="lk-s-sec">
            <p className="lk-s-eye">
              <i /> 03 · Rules
            </p>
            <h2 className="h2">{MAP_CTX.rules.length} rules, checked by code after the model answers.</h2>
            <div className="lk-s-table">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Rule</th>
                    <th>In code</th>
                    <th className="n">Real answers sent back</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleOrder(MAP_CTX.rules).map((r, i) => (
                    <tr key={r}>
                      <td className="mono">[3.{i + 1}]</td>
                      <td>{ruleTitle(r)}</td>
                      <td>
                        <code>{r}</code>
                      </td>
                      <td className="n">
                        {caughtBy(r)} of {runs.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Steps className="lk-s-steps" />
          </section>
          <Proof kind="numbers" />
          <Built />
        </div>
      </div>
      <Foot live={live} />
    </>
  );
}

/* ---------------------------------------------------------------- 14 · status cards */

type Card = { id: string; node: string | null; title: string; status: string; tone?: "bad" | "ok"; icon: ReactNode };

const I = (d: string) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICON = {
  live: I("M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v7"),
  shield: I("M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3zM9 12l2 2 4-4"),
  gauge: I("M4 15a8 8 0 1 1 16 0M12 15l4-5M4 19h16"),
  chip: I("M8 8h8v8H8zM4 10h4M4 14h4M16 10h4M16 14h4M10 4v4M14 4v4M10 16v4M14 16v4"),
  doc: I("M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"),
  chat: I("M4 5h16v11H9l-5 4zM8 9h8M8 12h5"),
  wrench: I("M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5L15 12l-3-3z"),
  check: I("M5 12l4 4 10-10"),
  person: I("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"),
  coin: I("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.7 2.5 1.6-1 1.4-2.5 1.6-2.5.6-2.5 1.6 1 1.6 2.5 1.6 2.5-.6 2.5-1.6"),
  flask: I("M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"),
  star: I("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"),
};

function Garage({ choice, live }: PageProps) {
  const [focus, setFocus] = useState<string | null>(null);
  const motion = useMotion();
  const recalls = firstCall("get_recalls"), complaints = firstCall("search_complaints"), parts = firstCall("search_catalog"), ticket = firstCall("create_handoff");
  const cards: Card[] = [
    { id: "live", node: "lambda", title: "Live answers", status: live === null ? "Checking" : live ? "On" : "Off: recorded runs only", tone: live === false ? "bad" : undefined, icon: ICON.live },
    { id: "bot", node: "turnstile", title: "Bot check", status: "Cloudflare Turnstile, every question", icon: ICON.shield },
    { id: "limits", node: "limits", title: "Daily limits", status: `${CHAT_LIMITS.perVisitorPerDay} a visitor · ${CHAT_LIMITS.perDay} a day · ${money(CHAT_LIMITS.usdPerDay, 2)}`, icon: ICON.gauge },
    { id: "model", node: "model", title: "Model", status: site.model.name, icon: ICON.chip },
    { id: "recalls", node: "tool:get_recalls", title: "NHTSA recalls", status: recalls ? `${recalls.summary} for the ${recalls.input.split(", ")[0]}` : "Ready", icon: ICON.doc },
    { id: "complaints", node: "tool:search_complaints", title: "Owner complaints", status: complaints ? `${complaints.summary}` : "Ready", icon: ICON.chat },
    { id: "parts", node: "tool:search_catalog", title: "Parts catalog", status: parts ? `${parts.summary} for the ${parts.input.split(", ")[0]}` : "Ready", icon: ICON.wrench },
    { id: "rules", node: "rules", title: "Rules in code", status: `${MAP_CTX.rules.length} checked · ${runs.caught} of ${runs.count} sent back`, tone: runs.caught ? "bad" : undefined, icon: ICON.check },
    { id: "person", node: "handoff", title: "A person", status: ticket ? `${ticket.summary} in the refund run` : "On request", icon: ICON.person },
    { id: "cost", node: null, title: "Cost an answer", status: COST_RANGE, icon: ICON.coin },
    { id: "tests", node: null, title: "Tests", status: `${site.tests.tests} of ${site.tests.tests} passing`, tone: "ok", icon: ICON.flask },
    { id: "ratings", node: "tool:get_safety_rating", title: "Crash ratings", status: "NHTSA 5-Star, per variant", icon: ICON.star },
  ];
  const tap = (c: Card) => {
    if (!c.node) return;
    setFocus(c.node);
    document.getElementById("map")?.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" });
  };
  return (
    <>
      <Nav choice={choice} live={live} center links={[["#status", "Status"], ["#ask", "Ask"], ["#map", "Map"], ["#proof", "Results"]]} />
      <main className="lk-g wrap">
        <section className="lk-g-hello" id="status">
          <h1 className="h1">
            All good.
            <br />
            Every answer checked.
          </h1>
          <p className="lede">{LEDE}</p>
        </section>
        <p className="lk-g-label">Agent status</p>
        <div className="lk-g-cards">
          {cards.map((c) => (
            <button type="button" key={c.id} className={`lk-g-card${c.node ? "" : " still"}${focus && focus === c.node ? " on" : ""}`} onClick={() => tap(c)} disabled={!c.node} aria-label={`${c.title}: ${c.status}${c.node ? ". Show it on the map" : ""}`}>
              <span className="lk-g-ic">{c.icon}</span>
              <b>{c.title}</b>
              <span className={`lk-g-st${c.tone ? ` ${c.tone}` : ""}`}>{c.status}</span>
            </button>
          ))}
        </div>
        <p className="lk-g-label" id="ask">
          Ask
        </p>
        <div className="lk-g-panel">
          <App />
        </div>
        <p className="lk-g-label" id="map">
          How it works · tap a card above, or any piece
        </p>
        <SystemMap focus={focus} onPick={setFocus} />
        <p className="lk-g-label">The six steps</p>
        <div className="lk-g-panel">
          <Steps />
        </div>
        <p className="lk-g-label">Recorded runs</p>
        <div className="lk-g-runs">
          {runs.runs.map((r) => (
            <button type="button" key={r.key} className="lk-g-card lk-g-run" onClick={() => (playRun(r.key, "card"), document.getElementById("map")?.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" }))}>
              <b>{titleOf(r.key)}</b>
              <span className={`lk-g-st${r.caught ? " bad" : ""}`}>{runLine(r.key)}</span>
            </button>
          ))}
        </div>
      </main>
      <Proof kind="numbers" />
      <Built />
      <Foot live={live} />
      <nav className="lk-g-tabbar" aria-label="Jump to">
        {[
          ["#status", "Status", ICON.gauge],
          ["#ask", "Ask", ICON.chat],
          ["#map", "Map", ICON.chip],
          ["#proof", "Results", ICON.star],
        ].map(([h, t, ic]) => (
          <a key={h as string} href={h as string}>
            {ic}
            <span>{t as string}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
