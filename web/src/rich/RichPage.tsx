// The four section-built layouts (01, 04, 05, 06): a nav, a hero holding the desk (Ask,
// Examples, Evals), the system map, what the agent promises, how it answers, the measured
// results, how it was built, and the footer, each in the variant the layout names (studio/presets.ts). Ported from
// rag.irs's rich/sections.js. Every number comes from site-data.json or a recorded run.

import { useEffect, useState, type ReactNode } from "react";

import "./rich.css";
import { App, REPLAYS, replayOf } from "../App.tsx";
import { Studio } from "../studio/Studio.tsx";
import type { Cfg, Choice } from "../studio/choice.ts";
import { Built } from "../shared/Built.tsx";
import { Field, Pipeline, Player, Story } from "../shared/How.tsx";
import { SystemMapSection } from "../shared/SystemMap.tsx";
import { CHAT_LIMITS, COST_RANGE, COST_TOTAL, DISCLAIMER, EVALS, site, STACK, STORE_NAME, walk } from "../shared/data.ts";
import { jumpToDesk, useLive, useMotion } from "../live.ts";
import { money, ruleTitle, spansOf, terminalLines } from "../site.ts";
import { describeInput, TOOL_LABEL, type Replay } from "../trace.ts";

const runs = site.runs;
const TOOLS = site.agent.tools.length;
const RULES = site.agent.rules.length;
const LEDE =
  "A support agent wired into a store's systems: NHTSA's recall, complaint and safety data, the parts catalog and a handoff to a person. Code checks every answer before a customer sees it.";
// the rule that sent the park-it run's first answer back, read from that run
const safetyRules = walk("real-safety")[3];
const SAFETY_RULE = safetyRules.kind === "rules" && safetyRules.blocked.length ? safetyRules.blocked[0].rule : "safety_warning_first";
const titleOf = (key: string) => REPLAYS.find((r) => r.key === key)?.title ?? key;
const answerOf = (r: Replay) => {
  const a = [...r.events].reverse().find((e) => e.type === "answer");
  return a && a.type === "answer" ? a.answer : null;
};
const firstPara = (t: string) => t.split(/\n\s*\n/)[0];

export function RichPage({ cfg, choice }: { cfg: Cfg; choice: Choice }) {
  const live = useLive();
  useEffect(() => document.documentElement.classList.remove("boot"), []);
  return (
    <>
      <Nav choice={choice} live={live} />
      <div data-slot="hero">{cfg.hero === "console" ? <HeroConsole /> : cfg.hero === "split" ? <HeroSplit /> : cfg.hero === "editorial" ? <HeroEditorial /> : <HeroSearch />}</div>
      <div className="wrap">
        <SystemMapSection />
      </div>
      <div data-slot="features">{cfg.features === "bento" ? <Bento /> : cfg.features === "list" ? <List /> : null}</div>
      <How kind={cfg.how ?? "field"} />
      <Proof kind={cfg.proof ?? "numbers"} />
      <Built />
      <Footer live={live} />
    </>
  );
}

/* ---------------------------------------------------------------- nav and footer */

export function AskLink({ live, className, children }: { live: boolean | null; className: string; children?: ReactNode }) {
  const motion = useMotion();
  return (
    <a className={className} href={live ? "#/" : "#/examples"} onClick={() => requestAnimationFrame(() => jumpToDesk(motion))}>
      {children ?? (live ? "Ask a question" : "See a real run")}
    </a>
  );
}

function Nav({ choice, live }: { choice: Choice; live: boolean | null }) {
  return (
    <nav className="nav" aria-label="Sections">
      <div className="wrap">
        <span className="brand">
          <i />
          {STORE_NAME}
        </span>
        <Studio choice={choice} placement="nav" />
        <span className="links">
          <a href="#map">System map</a>
          <a href="#how">How it works</a>
          <a href="#proof">Results</a>
          <a href="#built">How it was built</a>
        </span>
        <AskLink live={live} className="btn go small" />
      </div>
    </nav>
  );
}

function Footer({ live }: { live: boolean | null }) {
  return (
    <footer className="foot">
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
            <a className="btn" href="#how">
              How it works
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------- heroes */

const DeskStage = ({ className = "" }: { className?: string }) => (
  <div className={`desk-stage ${className}`}>
    <App />
  </div>
);

function HeroSearch() {
  return (
    <section className="hero-search sec" id="top">
      <div className="glow" />
      <div className="wrap">
        <p className="eyebrow">
          [ <b>{STORE_NAME}</b> · support agent · {site.model.name} ]
        </p>
        <h1 className="h1">
          Recall answers,
          <br />
          <span className="grad">checked by code.</span>
        </h1>
        <p className="lede">{LEDE}</p>
        <DeskStage className="center" />
        <div className="trust">
          <span>{runs.count} real runs recorded</span>
          <span>{RULES} rules checked in code</span>
          <span>{COST_RANGE} per answer</span>
          <span>{TOOLS} tools on NHTSA's data</span>
        </div>
      </div>
    </section>
  );
}

const TERM_RUNS = ["real-safety", "real-brakes", "real-body-style", "real-refund"];

function Terminal() {
  const motion = useMotion();
  const [key, setKey] = useState(TERM_RUNS[0]);
  const [shown, setShown] = useState(0);
  const r = replayOf(key);
  const lines = terminalLines(r);
  const a = answerOf(r);
  useEffect(() => {
    if (!motion) return setShown(lines.length + 1);
    setShown(0);
    const t = setInterval(() => setShown((n) => (n > lines.length ? (clearInterval(t), n) : n + 1)), 420);
    return () => clearInterval(t);
  }, [key, motion, lines.length]);
  return (
    <div className="term">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>recall desk · recorded real run</span>
      </div>
      <div className="runs" role="group" aria-label="Recorded runs">
        {TERM_RUNS.map((k) => (
          <button type="button" key={k} aria-pressed={k === key} onClick={() => setKey(k)}>
            {titleOf(k)}
          </button>
        ))}
      </div>
      <div className="body">
        <div className="cmd">
          $ ask <b>"{r.question}"</b>
        </div>
        {lines.map((l, i) => (
          <div key={`${key}-${i}`} className={`ln${i < shown ? " on" : ""}`}>
            <span className={`k ${l.k}`}>{l.k}</span>
            <span className="d">{l.d}</span>
            <span className="t">{l.t}</span>
          </div>
        ))}
        {a && <div className={`out${shown > lines.length ? " on" : ""}`}>{firstPara(a.text)}</div>}
        <div className={`ln${shown > lines.length ? " on" : ""}`}>
          <span className="k">cost</span>
          <span className="d">
            {(r.tokens ? r.tokens.input + r.tokens.cacheWrite + r.tokens.cacheRead + r.tokens.output : 0).toLocaleString("en-US")} tokens · {r.seconds?.toFixed(1)} s ·{" "}
            {money(r.costUsd ?? 0)}
          </span>
          <span className="t" />
        </div>
      </div>
    </div>
  );
}

function HeroConsole() {
  return (
    <section className="hero-console sec" id="top">
      <div className="wrap">
        <div className="grid">
          <div>
            <p className="eyebrow">
              [ <b>Under the hood</b> · {STORE_NAME} ]
            </p>
            <h1 className="h1">
              Every answer <span className="grad">shows its work.</span>
            </h1>
            <p className="lede">
              One model, {TOOLS} tools and {RULES} rules written in code. Each run on the right is a real one: every lookup it made, what came back, and the rule that sent an answer
              back.
            </p>
          </div>
          <Terminal />
        </div>
        <DeskStage />
      </div>
    </section>
  );
}

function Marked({ text, words }: { text: string; words: string[] }) {
  const spans = spansOf(text, words);
  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach(([s, e], i) => {
    out.push(text.slice(at, s), <mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

function HeroSplit() {
  const rec = site.record;
  const r = replayOf("real-body-style");
  const a = answerOf(r);
  return (
    <section className="hero-split sec" id="top">
      <div className="wrap">
        <div className="grid">
          <div>
            <p className="eyebrow">
              [ <b>Answers from NHTSA's records</b> ]
            </p>
            <h1 className="h1 h1-split">
              The answer, <span className="grad">and the record it read.</span>
            </h1>
            <p className="lede">
              Ask about a car's recalls, owners' complaints, crash ratings or parts. The agent looks them up in NHTSA's data, and code checks each claim against what came back before you
              see it.
            </p>
            <ul className="promises">
              <li>
                <span className="ic">✓</span>
                <span>Recall numbers only from NHTSA's reply in the same run, checked by code</span>
              </li>
              <li>
                <span className="ic">⌖</span>
                <span>"Applies to your car" only when the recall covers its body style</span>
              </li>
              <li>
                <span className="ic">!</span>
                <span>A park-it warning first, or the answer goes back</span>
              </li>
            </ul>
          </div>
          <div className="mock">
            <div className="page fade">
              <div className="ph">
                <a href={rec.url} target="_blank" rel="noopener">
                  NHTSA recall {rec.campaign} ↗
                </a>
                <span>{rec.component.split(":").at(-1)}</span>
              </div>
              <div className="fake" style={{ width: "92%" }} />
              <div className="fake" style={{ width: "76%" }} />
              <div>
                <Marked text={rec.summary} words={rec.bodies} />
              </div>
              <div className="fake" style={{ width: "88%" }} />
              <div className="fake" style={{ width: "64%" }} />
              <p className="rule-note">
                The rule reads: {rec.bodies.join(" and ")} only. A hatchback is not covered.
              </p>
            </div>
            <div className="wire" />
            <div className="float">
              <div className="card answer-card fade">
                <div className="top">
                  <span className="pill ok">Real run</span>
                  <span className="mono muted small">
                    {money(r.costUsd ?? 0)} · {r.seconds?.toFixed(1)} s
                  </span>
                </div>
                <p className="q">{r.question}</p>
                {a && <p className="a">{firstPara(a.text)}</p>}
              </div>
            </div>
          </div>
        </div>
        <DeskStage />
      </div>
    </section>
  );
}

function HeroEditorial() {
  const rec = site.record;
  const r = replayOf("real-body-style");
  const a = answerOf(r);
  return (
    <section className="hero-editorial sec" id="top">
      <div className="wrap">
        <div className="grid">
          <div>
            <p className="eyebrow">No. 01 · A question about one car, answered from NHTSA's records</p>
            <h1 className="h1">{r.question}</h1>
            {a && (
              <p className="pull">
                {firstPara(a.text)}
                <sup>1</sup>
              </p>
            )}
            <ol className="footnotes">
              <li>
                <b>1</b>
                <span>
                  {rec.campaign}, {rec.component.toLowerCase()}: "{rec.summary}"{" "}
                  <a href={rec.url} target="_blank" rel="noopener">
                    NHTSA's reply ↗
                  </a>
                </span>
              </li>
            </ol>
            <p className="ask-own">Ask your own question, or replay the real runs:</p>
            <DeskStage />
          </div>
          <aside className="side-note">
            <div className="h3">Every claim was checked</div>
            <p className="muted">
              Before this answer was shown, code confirmed that each recall number came from NHTSA's reply in the same run, and that "applies" named a body style the recall covers.
              When a claim does not check out, the answer goes back once, then to a person.
            </p>
            <p className="mono small">
              {runs.caught} of {runs.count} real answers sent back by a rule · {COST_RANGE} per answer
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- what it promises */

function toolRow(r: Replay, name: string) {
  const call = r.events.find((e) => e.type === "tool_call" && e.name === name);
  const res = r.events.find((e) => e.type === "tool_result" && e.name === name);
  return call && call.type === "tool_call" && res && res.type === "tool_result" ? `${TOOL_LABEL[name]} · ${describeInput(call.input)} → ${res.summary}` : "";
}

function Bento() {
  const brakes = replayOf("real-brakes"), fit = replayOf("real-parts-fit"), refund = replayOf("real-refund");
  const ab = answerOf(brakes), af = answerOf(fit);
  const ticket = refund.events.flatMap((e) => (e.type === "tool_result" && e.name === "create_handoff" ? [e.summary] : []))[0];
  return (
    <section className="sec" id="features">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="h2">
            What it promises, <span className="grad">on every answer.</span>
          </h2>
          <p>Each tile is a recorded real run of the agent, not a mock-up.</p>
        </div>
        <div className="bento">
          <div className="tile w4">
            <div className="mini-quote mono small">{toolRow(brakes, "get_recalls")}</div>
            <div className="mini-row" style={{ marginTop: 10 }}>
              {ab?.cited_recall_ids.map((id) => (
                <span className="cite" key={id}>
                  {id}
                </span>
              ))}
            </div>
            <div className="h3">Only recalls NHTSA returned</div>
            <p>Every campaign number in an answer must be in a get_recalls reply from the same run. Code checks it, not the model.</p>
          </div>
          <div className="tile w2">
            <div className="mini-row muted">"{replayOf("real-body-style").question}"</div>
            <div className="mini-row" style={{ marginTop: 12 }}>
              <span className="pill nf">Covers: {site.record.bodies.join(", ")}</span>
            </div>
            <div className="h3">Body style before "applies"</div>
            <p>NHTSA lists recalls by make, model and year; many cover some body styles only.</p>
          </div>
          <div className="tile w3">
            <div className="mini-row">
              <span className="pill held">Sent back: {ruleTitle(SAFETY_RULE)}</span>
            </div>
            <div className="mini-row" style={{ marginTop: 10 }}>
              <span className="pill ok">Passed on the retry</span>
            </div>
            <div className="h3">A park-it warning, first</div>
            <p>
              When NHTSA marks a recall "park it", the answer must open with the warning. In a recorded real run the first answer did not, and the rule sent it back.
            </p>
          </div>
          <div className="tile w3">
            <div className="mini-quote mono small">{toolRow(fit, "search_catalog")}</div>
            <div className="mini-row" style={{ marginTop: 10 }}>
              {af?.fits.map((sku) => (
                <span className="cite" key={sku}>
                  {sku}
                </span>
              ))}
            </div>
            <div className="h3">"Fits" needs an exact match</div>
            <p>A part is said to fit only when the catalog lists the car's year, model and body style.</p>
          </div>
          <div className="tile w2">
            <div className="mini-row">
              <span className="pill ok">{ticket}</span>
            </div>
            <div className="h3">A person for refunds</div>
            <p>Refunds, orders and upset customers go to a person, with a ticket a human would pick up.</p>
          </div>
          <div className="tile w4 money">
            <div>
              <div className="big grad">{COST_TOTAL}</div>
              <p>for all {runs.count} recorded real runs</p>
            </div>
            <div className="money-text">
              <div className="h3">Measured, run by run</div>
              <p>
                {COST_RANGE} per answer, from the tokens {site.model.name} reported. Live answers stop for the day at {money(CHAT_LIMITS.usdPerDay, 2)} of model spend.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function List() {
  const items: [string, string, string][] = [
    ["✓", "Only recalls NHTSA returned", "Every campaign number must be in a get_recalls reply from the same run."],
    ["⌖", "Body style before \"applies\"", "A recall is said to apply only when it covers the car's body style."],
    ["!", "A park-it warning, first", `When NHTSA marks a recall "park it", the answer opens with the warning. The rules sent back ${runs.caught} of ${runs.count} real answers.`],
    ["⚙", "\"Fits\" needs an exact match", "A part fits only when the catalog lists the car's year, model and body style."],
    ["→", "A person when it should be", "Refunds, orders and upset customers get a ticket for a person."],
    ["$", `${COST_RANGE} per answer`, `Measured from the tokens ${site.model.name} reported, ${runs.count} real runs.`],
  ];
  return (
    <section className="sec" id="features">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="h2">
            {items.length} promises, <span className="grad">each one checked.</span>
          </h2>
          <p>Each line is a rule in code or a number measured on recorded real runs.</p>
        </div>
        <div className="ilist">
          {items.map(([i, h, p]) => (
            <div className="it" key={h}>
              <span className="ic">{i}</span>
              <div>
                <div className="h3">{h}</div>
                <p>{p}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- how it answers */

function How({ kind }: { kind: "field" | "pipeline" | "story" | "player" }) {
  const f = site.field;
  const sub = {
    field: `One dot per owner complaint NHTSA holds for the car in a real run (${f.complaints}), a square per recall (${f.recalls}). Watch the run narrow them to one checked answer. Click a step.`,
    pipeline: "The whole agent on one figure. The model decides the lookups; the last box is code, and it can say no.",
    story: "Follow one real run through the agent: the one where a rule sent the first answer back. Scroll; the panel shows each step.",
    player: "One real run at a time, step by step, with every value it produced. It plays once when it scrolls into view; click a step to stop there.",
  }[kind];
  return (
    <section className="sec" id="how">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="h2">
            How it <span className="grad">answers.</span>
          </h2>
          <p>{sub}</p>
        </div>
        {kind === "pipeline" ? <Pipeline /> : kind === "story" ? <Story /> : kind === "player" ? <Player /> : <Field />}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the measured results */

function ProofHead() {
  return (
    <div className="sec-head">
      <h2 className="h2">
        Measured, <span className="grad">not promised.</span>
      </h2>
      <p>
        {runs.count} real runs of {site.model.name}, each with the tokens, cost and time the API reported, and {site.tests.tests} tests that run on every change.
      </p>
    </div>
  );
}

const EvalsLine = () => <p className="small-print">{EVALS.state === "empty" ? EVALS.message : "Every eval run, with each failure, is on the Evals tab."}</p>;

export function Proof({ kind }: { kind: "numbers" | "table" | "cards" | "versus" }) {
  const [inView, setIn] = useState(false);
  const motion = useMotion();
  // the bars and numbers grow the first time the section scrolls into view
  useEffect(() => {
    const el = document.getElementById("proof");
    if (!motion || !el || !("IntersectionObserver" in window)) return setIn(true);
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (setIn(true), io.disconnect())), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [motion]);
  const body = kind === "table" ? <ProofTable /> : kind === "cards" ? <ProofCards /> : kind === "versus" ? <ProofVersus /> : <ProofNumbers />;
  return (
    <section className={`sec${inView ? " in" : ""}`} id="proof">
      <div className="wrap">
        {kind !== "table" && <ProofHead />}
        {body}
        <EvalsLine />
      </div>
    </section>
  );
}

function ProofNumbers() {
  const cells: [string, string][] = [
    [String(runs.count), "real runs recorded, replayed on this page at no cost"],
    [COST_TOTAL, `measured for all of them, ${COST_RANGE} each`],
    [`${runs.caught}/${runs.count}`, `answers sent back by a rule; ${runs.fixedOnRetry} passed on the retry`],
    [String(site.tests.tests), `tests in ${site.tests.files} files, all passing`],
  ];
  return (
    <div className="numrow">
      {cells.map(([v, l]) => (
        <div className="c" key={l}>
          <div className="v grad">{v}</div>
          <div className="l">{l}</div>
        </div>
      ))}
    </div>
  );
}

function ProofTable() {
  return (
    <>
      <div className="evhead">
        <div className="v grad">{runs.count}</div>
        <div>
          <div className="h3">real runs of {site.model.name}, every number measured</div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Tokens, cost and seconds as the API reported them; {COST_TOTAL} for all of them. The rules sent back {runs.caught} of {runs.count}; {runs.fixedOnRetry} passed on the
            retry.
          </p>
        </div>
      </div>
      <div className="tablewrap">
        <table className="evtable">
          <thead>
            <tr>
              <th>Run</th>
              <th className="n">Model calls</th>
              <th className="n">Lookups</th>
              <th className="n">Tokens</th>
              <th className="n">Seconds</th>
              <th className="n">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.runs.map((r) => (
              <tr key={r.key}>
                <td>
                  {titleOf(r.key)}
                  {r.caught > 0 && <span className="pill held tiny">sent back by a rule</span>}
                  {r.handoff && <span className="pill nf tiny">to a person</span>}
                </td>
                <td className="n">{r.modelCalls}</td>
                <td className="n">{r.toolCalls}</td>
                <td className="n">{r.tokens.toLocaleString("en-US")}</td>
                <td className="n">{r.seconds.toFixed(1)}</td>
                <td className="n">{money(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Bars({ rows, unit }: { rows: [string, number, string][]; unit: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div className="viz hb">
      {rows.map(([l, v, k]) => (
        <div className="r" key={k}>
          <span>{l}</span>
          <span className="tr">
            <i style={{ width: `${Math.max(2, (100 * v) / max).toFixed(1)}%` }} />
          </span>
          <span>{unit(v)}</span>
        </div>
      ))}
    </div>
  );
}

function ProofCards() {
  const short = (key: string) => titleOf(key).replace(/, real Claude run$/, "");
  const dots = runs.runs.map((r) => (r.handoff ? "h" : r.caught ? "p" : "c"));
  return (
    <div className="mcards">
      <div className="mcard">
        <span className="k">Cost</span>
        <div className="h3">{COST_TOTAL} for all of them</div>
        <p>Per run, from the tokens the API reported.</p>
        <Bars rows={runs.runs.map((r) => [short(r.key), r.costUsd, r.key])} unit={(v) => money(v)} />
      </div>
      <div className="mcard">
        <span className="k">Time</span>
        <div className="h3">
          {runs.seconds.min.toFixed(1)} to {runs.seconds.max.toFixed(1)} s
        </div>
        <p>From the question to the checked answer, per run.</p>
        <Bars rows={runs.runs.map((r) => [short(r.key), r.seconds, r.key])} unit={(v) => v.toFixed(1) + " s"} />
      </div>
      <div className="mcard">
        <span className="k">The rules</span>
        <div className="h3">
          {runs.caught} of {runs.count} sent back
        </div>
        <p>One dot per real run.</p>
        <div className="viz">
          <div className="dots big">
            {dots.map((d, i) => (
              <i key={i} className={d} />
            ))}
          </div>
          <div className="leg">
            <span>
              <i style={{ background: "var(--a1)" }} />
              passed first time
            </span>
            <span>
              <i style={{ background: "var(--a2)" }} />
              sent back, then passed
            </span>
            <span>
              <i style={{ background: "var(--mu)" }} />
              handed to a person
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProofVersus() {
  const cheap = runs.runs.reduce((a, b) => (b.costUsd < a.costUsd ? b : a));
  const dear = runs.runs.reduce((a, b) => (b.costUsd > a.costUsd ? b : a));
  return (
    <div className="vs">
      <div className="vbox">
        <div className="v">{money(cheap.costUsd)}</div>
        <div className="l">the cheapest real run: {titleOf(cheap.key).toLowerCase()}</div>
      </div>
      <div className="vbox">
        <div className="v">{money(dear.costUsd)}</div>
        <div className="l">
          the dearest: {titleOf(dear.key).toLowerCase()}
          {dear.caught > 0 ? ", sent back once by a rule" : ""}
        </div>
      </div>
      <div className="vbox">
        <div className="v">{COST_TOTAL}</div>
        <div className="l">for all {runs.count} recorded real runs, measured</div>
      </div>
      <div className="vbox">
        <div className="v">
          {runs.caught} / {runs.count}
        </div>
        <div className="l">real answers sent back by a rule; {runs.fixedOnRetry} passed on the retry</div>
      </div>
      <div className="vbox wide">
        <div className="v">{site.tests.tests}</div>
        <div className="l">tests in {site.tests.files} files, all passing</div>
      </div>
    </div>
  );
}
