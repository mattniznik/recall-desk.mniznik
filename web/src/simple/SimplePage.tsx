// The three one-column layouts (07, 08, 09): the page the demo started as, in three looks. The
// desk (Ask, Examples, Evals), the system map, then How it works (a moving line, a dot field or a step-through
// player), the measured runs, how it was built and the footer. Ported from rag.irs's simple/.

import { useEffect } from "react";

import "./simple.css";
import { App, REPLAYS } from "../App.tsx";
import { Studio } from "../studio/Studio.tsx";
import type { Cfg, Choice } from "../studio/choice.ts";
import { Built } from "../shared/Built.tsx";
import { Field, Line, Player } from "../shared/How.tsx";
import { SystemMapSection } from "../shared/SystemMap.tsx";
import { COST_RANGE, COST_TOTAL, DISCLAIMER, EVALS, site, STORE_NAME } from "../shared/data.ts";
import { money } from "../site.ts";

const runs = site.runs;
const titleOf = (key: string) => REPLAYS.find((r) => r.key === key)?.title ?? key;

export function SimplePage({ cfg, choice }: { cfg: Cfg; choice: Choice }) {
  useEffect(() => document.documentElement.classList.remove("boot"), []);
  const d = cfg.simple ?? 1;
  const f = site.field;
  return (
    <>
      <main className="smain">
        <p className="s-eyebrow">{STORE_NAME}</p>
        <h1>
          Recall answers, {d === 2 ? <span className="grad">checked by code</span> : d === 3 ? <em>checked by code</em> : "checked by code"}
        </h1>
        <p className="lede">
          A support agent wired into a store's systems: NHTSA's recall, complaint and safety data, the parts catalog and a handoff to a person. Code checks every answer before a
          customer sees it.
        </p>

        <App />

        <SystemMapSection />

        <h2 id="how">How it works</h2>
        {d === 1 && <Line />}
        {d === 2 && (
          <>
            <p className="sub">
              One dot per owner complaint NHTSA holds for the car in a real run ({f.complaints}), a square per recall ({f.recalls}). Click a step.
            </p>
            <Field />
          </>
        )}
        {d === 3 && (
          <>
            <p className="sub">One real run at a time, step by step. It plays once when it scrolls into view; click a step to stop there.</p>
            <Player />
          </>
        )}

        <h2 id="results">How well it works</h2>
        <p className="sub">
          {runs.count} real runs of {site.model.name}, with the tokens, cost and time the API reported: {COST_TOTAL} for all of them, {COST_RANGE} each. The rules sent back{" "}
          {runs.caught} of {runs.count} answers; {runs.fixedOnRetry} passed on the retry. {site.tests.tests} tests in {site.tests.files} files run on every change.
        </p>
        <div className="stable-wrap">
          <table className="stable">
            <thead>
              <tr>
                <th>Real run</th>
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
                    {r.caught > 0 && <span className="tag">sent back by a rule</span>}
                    {r.handoff && <span className="tag">to a person</span>}
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
        <p className="note">{EVALS.state === "empty" ? EVALS.message : "Every eval run, with each failure, is on the Evals tab."}</p>

        <Built inMain />

        <footer className="sfoot">{DISCLAIMER}</footer>
      </main>
      <Studio choice={choice} placement="fab" />
    </>
  );
}
