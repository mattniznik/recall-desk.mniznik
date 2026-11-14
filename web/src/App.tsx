// The desk: the tabs every layout keeps (Ask, the live chat, only while /api/status says live;
// Examples, the recorded runs replayed step by step; Evals) and what each shows. The layouts
// (rich/, simple/) put their own header, How it works, results and footer around it.
// Hash routes (#/, #/examples, #/evals), so CloudFront needs no rewrite function; the page's
// section links (#how, #built) are anchors and leave the open tab alone.

import { useEffect, useState } from "react";

import { replayMetrics, toSteps, type Replay } from "./trace.ts";
import { TracePanel } from "./TracePanel.tsx";
import { AnswerCard } from "./AnswerCard.tsx";
import { EvalsPage } from "./EvalsPage.tsx";
import { Chat } from "./Chat.tsx";
import { pageFor, routeFromHash, type EvalRun, type Route } from "./evals.ts";
import { useLive, useMotion } from "./live.ts";
import { publish } from "./map-feed.ts";
import { eventsThroughStep } from "./system-map.ts";
import brakes from "./replays/brakes.json";
import guard from "./replays/guard.json";
import realBrakes from "./replays/real-brakes.json";
import realSafety from "./replays/real-safety.json";
import realBodyStyle from "./replays/real-body-style.json";
import realPartsFit from "./replays/real-parts-fit.json";
import realRefund from "./replays/real-refund.json";
import realOffTopic from "./replays/real-off-topic.json";

// Every eval run the runner has written (none before milestone 3).
export const EVAL_RUNS = Object.values(import.meta.glob("./evals/*.json", { eager: true, import: "default" })) as EvalRun[];

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash, "ask"));
  useEffect(() => {
    const onHash = () => setRoute((prev) => routeFromHash(window.location.hash, prev));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

// Real Claude runs first, one per kind of question; the scripted ones last. The park-it run is
// a real guard catch: the first answer left out the warning and the rules sent it back.
export const REPLAYS: { key: string; title: string; replay: Replay }[] = [
  { key: "real-brakes", title: "Brakes, real Claude run", replay: realBrakes as unknown as Replay },
  { key: "real-safety", title: "Park-it recall: warning first", replay: realSafety as unknown as Replay },
  { key: "real-body-style", title: "Recall vs body style", replay: realBodyStyle as unknown as Replay },
  { key: "real-parts-fit", title: "Do these pads fit?", replay: realPartsFit as unknown as Replay },
  { key: "real-refund", title: "Refund: hand to a person", replay: realRefund as unknown as Replay },
  { key: "real-off-topic", title: "Off-topic request", replay: realOffTopic as unknown as Replay },
  { key: "brakes", title: "Brakes, scripted", replay: brakes as unknown as Replay },
  { key: "guard", title: "A made-up recall caught (scripted)", replay: guard as unknown as Replay },
];

export const replayOf = (key: string): Replay => REPLAYS.find((r) => r.key === key)!.replay;

const STEP_MS = 450;

export function App() {
  const route = useRoute();
  const live = useLive();
  const page = pageFor(route, live);
  return (
    <div className="desk" id="desk">
      <nav className="desk-tabs" aria-label="Pages">
        {live && (
          <a href="#/" className={page === "ask" ? "on" : ""} aria-current={page === "ask" ? "page" : undefined}>
            Ask
          </a>
        )}
        <a href="#/examples" className={page === "demo" ? "on" : ""} aria-current={page === "demo" ? "page" : undefined}>
          Examples
        </a>
        <a href="#/evals" className={page === "evals" ? "on" : ""} aria-current={page === "evals" ? "page" : undefined}>
          Evals
        </a>
      </nav>
      <div className="desk-body">{page === "evals" ? <EvalsPage runs={EVAL_RUNS} /> : page === "demo" ? <Demo /> : <Chat live={live} />}</div>
    </div>
  );
}

function Demo() {
  const [current, setCurrent] = useState(REPLAYS[0]);
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);

  const steps = toSteps(current.replay.events);
  const visible = steps.slice(0, shown);
  const last = visible.at(-1);

  const motion = useMotion();
  useEffect(() => {
    // reduced motion: the whole run at once, no step-by-step reveal
    if (!motion) return setShown(steps.length);
    setShown(0);
    const timer = setInterval(() => setShown((n) => (n >= steps.length ? n : n + 1)), STEP_MS);
    return () => clearInterval(timer);
  }, [current, run, steps.length, motion]);

  // the system map plays the same run, a step ahead of the rows on screen
  useEffect(() => {
    publish({ id: `demo-${current.key}-${run}`, title: current.title, mode: "replay", events: eventsThroughStep(current.replay.events, shown), stream: true });
  }, [current, run, shown]);

  return (
    <>
      <nav className="replays" aria-label="Replays">
        {REPLAYS.map((r) => (
          <button key={r.key} className={r.key === current.key ? "on" : ""} aria-pressed={r.key === current.key} onClick={() => setCurrent(r)}>
            {r.title}
          </button>
        ))}
        <button onClick={() => setRun((n) => n + 1)}>Replay</button>
      </nav>

      <p className={current.replay.real ? "label real" : "label"}>{current.replay.label}</p>
      <p className="question">{current.replay.question}</p>

      <div className="work">
        <TracePanel steps={visible} />
        {last?.kind === "answer" && <AnswerCard answer={last.answer} />}
      </div>

      <p className="metrics">{replayMetrics(current.replay)}</p>
    </>
  );
}
