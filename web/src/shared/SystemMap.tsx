// The system map: every piece of the system as one SVG graph, lit step by step while a run
// plays. It follows whatever the page is playing (the Examples tab's replay, a live answer as
// it streams, a layout's own run list: map-feed.ts), plays a recorded run once when it first
// scrolls into view, and has a guided tour of the Ranger park-it run. Hover, focus or tap a
// node for one sentence on what it is.
//
// Which node and edge each event lights, and the captions, are in system-map.ts (pure, tested in
// test/web-system-map.test.ts); this file only draws them and moves a packet along the lit edge.
// Two drawings of the same graph: wide (left to right) from 860 px, tall (top to bottom) below,
// so a phone never scrolls sideways. Under reduced motion nothing travels or plays on its own:
// each step is still lit, and every step is listed.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import "./map.css";
import { MAP_CTX } from "./data.ts";
import { REPLAYS, replayOf } from "../App.tsx";
import { publish, useFeed, useTourRequests } from "../map-feed.ts";
import { mapBeats, mapGraph, mapState, tourFor, type Beat, type MapNode, type TourStep } from "../system-map.ts";
import { useMotion } from "../live.ts";

/* ---------------------------------------------------------------- the two drawings */

type Box = { x: number; y: number; w: number; h: number };
type Side = "l" | "r" | "t" | "b";
type Geo = { tall: boolean; W: number; H: number; box: Record<string, Box>; route: Record<string, string> };

const TOOLS = MAP_CTX.tools.map((t) => t.name);
const GRAPH = mapGraph(MAP_CTX);

function anchor(b: Box, s: Side, off = 0): [number, number] {
  if (s === "l") return [b.x - b.w / 2, b.y + off];
  if (s === "r") return [b.x + b.w / 2, b.y + off];
  if (s === "t") return [b.x + off, b.y - b.h / 2];
  return [b.x + off, b.y + b.h / 2];
}
const NORMAL: Record<Side, [number, number]> = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
function curve(a: Box, sa: Side, b: Box, sb: Side, offA = 0, offB = 0): string {
  const [x1, y1] = anchor(a, sa, offA), [x2, y2] = anchor(b, sb, offB);
  const d = Math.min(120, Math.max(18, Math.hypot(x2 - x1, y2 - y1) * 0.42));
  const [ax, ay] = NORMAL[sa], [bx, by] = NORMAL[sb];
  const r = (v: number) => Math.round(v * 10) / 10;
  return `M${r(x1)} ${r(y1)} C${r(x1 + ax * d)} ${r(y1 + ay * d)} ${r(x2 + bx * d)} ${r(y2 + by * d)} ${r(x2)} ${r(y2)}`;
}

function wideGeo(): Geo {
  const box: Record<string, Box> = {
    visitor: { x: 70, y: 250, w: 112, h: 54 },
    cdn: { x: 208, y: 250, w: 120, h: 54 },
    lambda: { x: 350, y: 250, w: 126, h: 54 },
    turnstile: { x: 250, y: 92, w: 132, h: 54 },
    limits: { x: 420, y: 92, w: 172, h: 84 },
    model: { x: 610, y: 92, w: 170, h: 54 },
    loop: { x: 610, y: 250, w: 160, h: 84 },
    rules: { x: 610, y: 430, w: 172, h: 54 },
    answer: { x: 215, y: 548, w: 150, h: 50 },
    handoff: { x: 440, y: 560, w: 140, h: 50 },
  };
  TOOLS.forEach((t, i) => {
    const y = 48 + i * 80;
    box[`tool:${t}`] = { x: 862, y, w: 190, h: 56 };
    box[`src:${t}`] = { x: 1090, y, w: 214, h: 56 };
  });
  const B = (id: string) => box[id];
  const route: Record<string, string> = {
    "visitor>cdn": curve(B("visitor"), "r", B("cdn"), "l"),
    "cdn>lambda": curve(B("cdn"), "r", B("lambda"), "l"),
    "lambda>turnstile": curve(B("lambda"), "t", B("turnstile"), "b", -20),
    "lambda>limits": curve(B("lambda"), "t", B("limits"), "b", 20),
    "lambda>loop": curve(B("lambda"), "r", B("loop"), "l"),
    "loop>model": curve(B("loop"), "t", B("model"), "b"),
    "loop>rules": curve(B("loop"), "b", B("rules"), "t"),
    "rules>answer": curve(B("rules"), "l", B("answer"), "r"),
    "rules>handoff": curve(B("rules"), "b", B("handoff"), "r"),
    "loop>handoff": curve(B("loop"), "b", B("handoff"), "t", -52),
  };
  for (const t of TOOLS) {
    route[`loop>tool:${t}`] = curve(B("loop"), "r", B(`tool:${t}`), "l");
    route[`tool:${t}>src:${t}`] = curve(B(`tool:${t}`), "r", B(`src:${t}`), "l");
  }
  return { tall: false, W: 1214, H: 600, box, route };
}

function tallGeo(): Geo {
  const L = 98, LW = 152, R = 258, RW = 146;
  const box: Record<string, Box> = {
    visitor: { x: L, y: 30, w: LW, h: 44 },
    cdn: { x: R, y: 30, w: RW, h: 44 },
    turnstile: { x: L, y: 104, w: LW, h: 44 },
    lambda: { x: R, y: 104, w: RW, h: 44 },
    limits: { x: L, y: 186, w: LW, h: 70 },
    model: { x: L, y: 272, w: LW, h: 44 },
    loop: { x: R, y: 272, w: RW, h: 70 },
  };
  TOOLS.forEach((t, i) => {
    const y = 352 + i * 58;
    box[`tool:${t}`] = { x: L, y, w: LW, h: 44 };
    box[`src:${t}`] = { x: R, y, w: RW, h: 44 };
  });
  const last = 352 + (TOOLS.length - 1) * 58;
  box.rules = { x: L, y: last + 76, w: LW, h: 44 };
  box.answer = { x: L, y: last + 156, w: LW, h: 44 };
  box.handoff = { x: R, y: last + 156, w: RW, h: 44 };
  const B = (id: string) => box[id];
  // the loop reaches the tools and the rules down a bus on the left edge
  const lb = anchor(B("loop"), "b");
  const bus = (y: number) => `M${lb[0]} ${lb[1]} L${lb[0]} ${lb[1] + 11} Q${lb[0]} ${lb[1] + 17} ${lb[0] - 6} ${lb[1] + 17} L14 ${lb[1] + 17} Q8 ${lb[1] + 17} 8 ${lb[1] + 23} L8 ${y - 6} Q8 ${y} 14 ${y} L${L - LW / 2} ${y}`;
  const ho = B("handoff"), lp = B("loop");
  const route: Record<string, string> = {
    "visitor>cdn": curve(B("visitor"), "r", B("cdn"), "l"),
    "cdn>lambda": curve(B("cdn"), "b", B("lambda"), "t"),
    "lambda>turnstile": curve(B("lambda"), "l", B("turnstile"), "r"),
    "lambda>limits": curve(B("lambda"), "b", B("limits"), "r", -44),
    "lambda>loop": curve(B("lambda"), "b", B("loop"), "t", 20, 20),
    "loop>model": curve(B("loop"), "l", B("model"), "r"),
    "loop>rules": bus(B("rules").y),
    "rules>answer": curve(B("rules"), "b", B("answer"), "t"),
    "rules>handoff": curve(B("rules"), "r", B("handoff"), "t"),
    // down the right edge, past the sources
    "loop>handoff": `M${lp.x + lp.w / 2} ${lp.y} Q${336} ${lp.y} 336 ${lp.y + 8} L336 ${ho.y - 8} Q336 ${ho.y} ${ho.x + ho.w / 2} ${ho.y}`,
  };
  for (const t of TOOLS) {
    route[`loop>tool:${t}`] = bus(B(`tool:${t}`).y);
    route[`tool:${t}>src:${t}`] = curve(B(`tool:${t}`), "r", B(`src:${t}`), "l");
  }
  return { tall: true, W: 340, H: box.answer.y + 34, box, route };
}

const WIDE = wideGeo();
const TALL = tallGeo();

/* ---------------------------------------------------------------- one node */

// Text that does not fit its box is cut with an ellipsis after it is drawn, by measuring it (the typeface is
// the visitor's pick, so a character count cannot know). Only the text node's value changes, so React keeps
// its own node and can still update it.
function fitTexts(root: SVGSVGElement | null) {
  for (const el of root?.querySelectorAll<SVGTextElement>("text[data-max]") ?? []) {
    const node = el.firstChild;
    const full = el.dataset.full ?? "";
    if (!node || node.nodeType !== 3) continue;
    node.nodeValue = full;
    const max = Number(el.dataset.max);
    if (el.getComputedTextLength() <= max) continue;
    let n = full.length;
    while (n > 1 && (node.nodeValue = full.slice(0, n - 1).trimEnd() + "…") && el.getComputedTextLength() > max) n--;
  }
}

function NodeView({ n, b, tall, cls, note, status, onHover, onPick }: { n: MapNode; b: Box; tall: boolean; cls: string; note?: string; status?: "ok" | "bad"; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  const ls = tall ? (n.kind === "source" ? 11.5 : 12.5) : 14.5, ss = tall ? 10 : 11;
  // a source on a phone shows the last part of its endpoint; the loop and the limits list their numbers a line each
  let sub = n.kind === "source" && tall ? n.sub.split("/").filter(Boolean).at(-1) ?? n.sub : n.sub;
  let lines = n.id === "limits" || n.id === "loop" ? sub.split(" · ") : [sub];
  if (note) lines = [note];
  const pad = tall ? 10 : 12;
  const room = b.w - (n.kind === "outcome" ? 18 : pad + 8);
  const label = n.label;
  const top = (b.h - (ls + 4 + lines.length * (ss + 3.5))) / 2;
  const w = b.w, h = b.h;
  const shape =
    n.kind === "source" ? (
      <>
        <path className="sm-shape" d={`M0 7 A${w / 2} 7 0 0 1 ${w} 7 V${h - 7} A${w / 2} 7 0 0 1 0 ${h - 7} Z`} />
        <path className="sm-rim" d={`M0 7 A${w / 2} 7 0 0 0 ${w} 7`} />
      </>
    ) : (
      <rect className="sm-shape" width={w} height={h} rx={n.kind === "outcome" ? h / 2 : 10} />
    );
  return (
    <g
      className={`sm-n k-${n.kind} ${cls}`}
      transform={`translate(${b.x - w / 2} ${b.y - h / 2})`}
      tabIndex={0}
      role="button"
      aria-label={`${n.label}. ${n.info}`}
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(n.id)}
      onBlur={() => onHover(null)}
      onClick={() => onPick(n.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(n.id);
        }
      }}
    >
      <rect className="sm-halo" x={-5} y={-5} width={w + 10} height={h + 10} rx={n.kind === "outcome" ? (h + 10) / 2 : 14} />
      {shape}
      {n.kind !== "outcome" && n.kind !== "source" && <rect className="sm-stripe" x={0} y={10} width={3} height={h - 20} rx={1.5} />}
      <text className="sm-l" x={n.kind === "outcome" ? w / 2 : pad} y={top + ls} fontSize={ls} textAnchor={n.kind === "outcome" ? "middle" : "start"} data-full={label} data-max={room - (status ? 10 : 0)}>
        {label}
      </text>
      {lines.map((l, i) => (
        <text key={i} className={note ? "sm-s sm-note" : "sm-s"} x={n.kind === "outcome" ? w / 2 : pad} y={top + ls + 4 + (i + 1) * (ss + 3.5)} fontSize={ss} textAnchor={n.kind === "outcome" ? "middle" : "start"} data-full={l} data-max={room}>
          {l}
        </text>
      ))}
      {status && (
        <g className={`sm-badge ${status}`} transform={`translate(${w - 3} 3)`}>
          <circle r={9} />
          <path d={status === "ok" ? "M-4 0 L-1 3 L4 -3" : "M-3 -3 L3 3 M3 -3 L-3 3"} />
        </g>
      )}
    </g>
  );
}

/* ---------------------------------------------------------------- the map */

const RUNS = ["real-safety", "real-brakes", "real-parts-fit", "real-refund"].map((key) => REPLAYS.find((r) => r.key === key)!);
const TOUR_RUN = "real-safety";
const titleOf = (key: string) => REPLAYS.find((r) => r.key === key)?.title ?? key;

type Mode = "idle" | "follow" | "tour";

export function SystemMap({ focus = null, onPick, compact = false, className = "" }: { focus?: string | null; onPick?: (id: string) => void; compact?: boolean; className?: string }) {
  const motion = useMotion();
  const feed = useFeed();
  const tourAsks = useTourRequests();
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const packet = useRef<SVGCircleElement>(null);
  const [tall, setTall] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [beats, setBeats] = useState<(Beat | TourStep)[]>(() => mapBeats(replayOf(TOUR_RUN).events, { ...MAP_CTX, mode: "replay" }));
  // under reduced motion the default run shows whole from the start, every step lit
  const [k, setK] = useState(() => (motion ? -1 : beats.length - 1));
  const [playing, setPlaying] = useState(false);
  const [label, setLabel] = useState(`Recorded run: ${titleOf(TOUR_RUN)}`);
  const [hover, setHover] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const feedId = useRef<string | null>(null);
  const seen = useRef(false);

  const geo = tall ? TALL : WIDE;
  const st = useMemo(() => mapState(beats, k), [beats, k]);
  const active = st.active;

  // wide from 860 px of room, tall below
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setTall(el.clientWidth < 860);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = (next: (Beat | TourStep)[], m: Mode, text: string) => {
    setBeats(next);
    setMode(m);
    setLabel(text);
    // reduced motion: a run shows its last step at once; the tour waits for Next
    if (!motion) {
      setK(m === "tour" ? 0 : next.length - 1);
      setPlaying(false);
      return;
    }
    setK(-1);
    setPlaying(true);
  };

  // follow the run the page is playing; a new run starts over, more of the same run carries on
  useEffect(() => {
    if (!feed) return;
    const next = mapBeats(feed.events, { ...MAP_CTX, mode: feed.mode });
    const what = feed.mode === "live" ? `Your question: ${feed.title}` : `Recorded run: ${feed.title}`;
    if (feed.id !== feedId.current || next.length < beats.length || mode !== "follow") {
      if (feed.id === feedId.current && mode === "tour") return; // the tour keeps going until a new run starts
      feedId.current = feed.id;
      start(next, "follow", what);
      return;
    }
    setBeats(next);
    if (!motion) setK(next.length - 1);
    else if (next.length - 1 > k) setPlaying(true);
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

  const takeTour = () => {
    setPin(null);
    start(tourFor(replayOf(TOUR_RUN), MAP_CTX), "tour", `Tour: ${titleOf(TOUR_RUN)}`);
  };
  // a "Take the tour" button elsewhere on the page
  const asked = useRef(tourAsks);
  useEffect(() => {
    if (tourAsks === asked.current) return;
    asked.current = tourAsks;
    root.current?.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" });
    takeTour();
  }, [tourAsks]); // eslint-disable-line react-hooks/exhaustive-deps

  // plays once, the first time it scrolls into view
  useEffect(() => {
    const el = root.current;
    if (!motion || !el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting || seen.current) return;
          seen.current = true;
          io.disconnect();
          if (!playing) {
            setK(-1);
            setPlaying(true);
          }
        }),
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [motion]); // eslint-disable-line react-hooks/exhaustive-deps

  // the clock: a step at a time; quicker while a stream is ahead, slower on the tour
  useEffect(() => {
    if (!playing) return;
    if (k >= beats.length - 1) {
      setPlaying(false);
      return;
    }
    const behind = beats.length - 1 - k;
    const next = beats[k + 1];
    const ms = mode === "tour" ? Math.min(6500, 2200 + (next.caption.length + ((next as TourStep).info?.length ?? 0)) * 14) : feed?.stream && mode === "follow" ? (behind > 2 ? 380 : 650) : 1150;
    const t = setTimeout(() => setK((x) => x + 1), k < 0 ? 250 : ms);
    return () => clearTimeout(t);
  }, [playing, k, beats, mode, feed?.stream]);

  // cut what does not fit, once the type has loaded, and again whenever the drawing or a tool's result changes
  const notesKey = JSON.stringify(st.notes) + Object.keys(st.status).join();
  useLayoutEffect(() => fitTexts(svg.current), [tall, notesKey]);
  useEffect(() => {
    let live = true;
    const again = () => live && fitTexts(svg.current);
    document.fonts?.ready.then(again);
    document.fonts?.addEventListener("loadingdone", again);
    return () => {
      live = false;
      document.fonts?.removeEventListener("loadingdone", again);
    };
  }, [tall]);

  // the packet travels the lit edge (from its end back to its start when the result returns)
  useEffect(() => {
    const p = packet.current;
    if (!p) return;
    p.style.opacity = "0";
    if (!motion || !active?.edge) return;
    const path = svg.current?.querySelector<SVGPathElement>(`path[data-edge="${CSS.escape(active.edge)}"]`);
    if (!path) return;
    const len = path.getTotalLength();
    const dur = mode === "tour" ? 900 : 560;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / dur);
      const e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      const pt = path.getPointAtLength(len * (active.back ? 1 - e : e));
      p.setAttribute("cx", String(pt.x));
      p.setAttribute("cy", String(pt.y));
      p.style.opacity = x < 1 ? "1" : "0";
      if (x < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, motion, mode, tall]);

  const pick = (id: string) => {
    setPin((p) => (p === id ? null : id));
    onPick?.(id);
  };
  const shownInfo = hover ?? pin ?? focus;
  const infoNode = shownInfo ? GRAPH.nodes.find((x) => x.id === shownInfo) : null;
  const tourStep = mode === "tour" && active ? (active as TourStep) : null;

  const nodeCls = (id: string) =>
    [
      st.nodes.includes(id) ? "is-seen" : "",
      active?.node === id ? `is-on t-${active.tone}` : "",
      id === focus || id === pin ? "is-focus" : "",
      id === hover ? "is-hover" : "",
    ]
      .filter(Boolean)
      .join(" ");
  const edgeOrder = [...GRAPH.edges].sort((a, b) => rank(a.id) - rank(b.id));
  function rank(id: string) {
    return id === active?.edge ? 2 : st.edges.includes(id) ? 1 : 0;
  }
  const done = k >= beats.length - 1 && beats.length > 0;

  return (
    <div ref={root} className={`sm${tall ? " is-tall" : " is-wide"}${compact ? " is-compact" : ""}${mode === "tour" ? " is-tour" : ""} ${className}`}>
      <div className="sm-top">
        <div className="sm-now">
          <span className={`sm-live${playing ? " on" : ""}`} aria-hidden="true" />
          <span>{label}</span>
        </div>
        <div className="sm-ctl">
          {mode === "tour" ? (
            <>
              <button type="button" onClick={() => (setPlaying(false), setK((x) => Math.max(0, x - 1)))} disabled={k <= 0}>
                Back
              </button>
              <button type="button" onClick={() => (setPlaying(false), setK((x) => Math.min(beats.length - 1, x + 1)))} disabled={done}>
                Next
              </button>
              {motion && (
                <button type="button" onClick={() => (done ? (setK(0), setPlaying(true)) : setPlaying(!playing))}>
                  {playing ? "Pause" : done ? "Again" : "Play"}
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="sm-go" onClick={takeTour}>
                Take the tour
              </button>
              {motion && (
                <button type="button" onClick={() => (playing ? setPlaying(false) : (done && setK(-1), setPlaying(true)))}>
                  {playing ? "Pause" : done ? "Replay" : "Play"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="sm-stage">
        <svg ref={svg} className="sm-svg" viewBox={`0 0 ${geo.W} ${geo.H}`} role="group" aria-label={`System map: ${GRAPH.nodes.length} pieces. Each node is a button that says what it is.`}>
          <defs>
            <pattern id="sm-dots" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.1" className="sm-dot" />
            </pattern>
          </defs>
          <rect className="sm-grid" width={geo.W} height={geo.H} fill="url(#sm-dots)" />
          {!tall && (
            <g className="sm-zones" aria-hidden="true">
              <text x={12} y={18}>THE WAY IN</text>
              <text x={530} y={18}>THE AGENT</text>
              <text x={767} y={14}>TOOLS</text>
              <text x={983} y={14}>WHAT THEY READ</text>
            </g>
          )}
          <g className="sm-edges">
            {edgeOrder.map((e) => (
              <path
                key={e.id}
                data-edge={e.id}
                d={geo.route[e.id]}
                className={`sm-e${st.edges.includes(e.id) ? " is-seen" : ""}${active?.edge === e.id ? ` is-on t-${active.tone}${active.back ? " back" : ""}` : ""}${e.id === "loop>handoff" ? " dash" : ""}`}
              />
            ))}
          </g>
          <g className="sm-nodes">
            {GRAPH.nodes.map((n) => (
              <NodeView key={n.id} n={n} b={geo.box[n.id]} tall={tall} cls={nodeCls(n.id)} note={st.notes[n.id]} status={st.status[n.id]} onHover={setHover} onPick={pick} />
            ))}
          </g>
          <circle ref={packet} className={`sm-pk t-${active?.tone ?? "flow"}`} r={tall ? 5 : 6.5} cx={-20} cy={-20} />
        </svg>
      </div>

      <div className="sm-bar" aria-live="polite">
        {tourStep ? (
          <>
            <p className="sm-step">
              Step {k + 1} of {beats.length} · <b>{tourStep.title}</b>
            </p>
            <p className="sm-info">{tourStep.info}</p>
            <p className={`sm-cap t-${tourStep.tone}`}>{tourStep.caption}</p>
          </>
        ) : (
          <p className={`sm-cap t-${active?.tone ?? "flow"}`}>
            {active ? (
              <>
                <span className="sm-k">
                  {k + 1}/{beats.length}
                </span>{" "}
                {active.caption}
              </>
            ) : (
              "Each lookup, rule check and answer lights the piece that did it. Take the tour, or replay a run."
            )}
          </p>
        )}
      </div>

      <div className="sm-foot">
        <p className="sm-hint">
          {infoNode ? (
            <>
              <b>{infoNode.label}.</b> {infoNode.info}
            </>
          ) : (
            "Hover over or tap any piece to see what it is and why it is there."
          )}
        </p>
        {!compact && (
          <div className="sm-runs" role="group" aria-label="Play a recorded run on the map">
            {RUNS.map((r) => (
              <button
                type="button"
                key={r.key}
                aria-pressed={mode === "follow" && feed?.title === r.title && feedId.current?.startsWith("map-")}
                onClick={() => publish({ id: `map-${r.key}-${Date.now()}`, title: r.title, mode: "replay", events: r.replay.events })}
              >
                {r.title}
              </button>
            ))}
          </div>
        )}
        <details className="sm-list" open={!motion || undefined}>
          <summary>Every step of this run ({beats.length})</summary>
          <ol>
            {beats.map((b, i) => (
              <li key={i} className={`${i === k ? "on" : ""} t-${b.tone}`}>
                <button type="button" onClick={() => (setPlaying(false), setK(i))}>
                  {b.caption}
                </button>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}

/** The map as a page section, with its heading, for the layouts that place it on its own. */
export function SystemMapSection({ className = "", head = true, style }: { className?: string; head?: boolean; style?: CSSProperties }) {
  return (
    <section className={`sm-sec ${className}`} id="map" style={style}>
      {head && (
        <div className="sm-head">
          <p className="sm-eyebrow">The system map</p>
          <h2 className="sm-h">Every piece, and what it did on a real run.</h2>
          <p className="sm-lede">
            The visitor, the AWS and Cloudflare pieces in front, the agent loop, {MAP_CTX.model.name}, the {TOOLS.length} tools with the NHTSA endpoint or store file each reads, the{" "}
            {MAP_CTX.rules.length} rules, and the two ways a run ends. It lights up with whatever the desk is playing, a live answer included.
          </p>
        </div>
      )}
      <SystemMap />
    </section>
  );
}
