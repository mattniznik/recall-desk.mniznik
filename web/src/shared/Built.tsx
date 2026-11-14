// "How it was built": the loop every change goes through, from site-data.json (written by
// scripts/export-site.ts from the test run, the recorded runs and the decision records, so no
// number here is typed in). One component for both layout families, just before the footer.
// Ported from rag.irs's shared/workflow.js. Facts link to the repository once it has a
// GitHub remote; until then they are plain text.

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { BUILT } from "./data.ts";
import { useMotion } from "../live.ts";

export function Built({ inMain = false }: { inMain?: boolean }) {
  const b = BUILT;
  const ref = useRef<HTMLElement>(null);
  const motion = useMotion();
  const [lit, setLit] = useState(!motion);
  // the steps light up one after another the first time the section scrolls into view
  useEffect(() => {
    if (!motion || !("IntersectionObserver" in window) || !ref.current) return setLit(true);
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (setLit(true), io.disconnect())), { threshold: 0.2 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [motion]);
  return (
    <section ref={ref} className={`wf${inMain ? " wf-in-main" : ""}${lit ? " in" : ""}`} id="built" aria-labelledby="wf-h">
      <div className="wf-wrap">
        <p className="wf-eyebrow">How it was built</p>
        <h2 className="wf-h" id="wf-h">
          Every change goes through the same loop.
        </h2>
        <p className="wf-lede">
          Plan, a failing test, the change, a measurement, a review, a deploy. The numbers are counted from the repository when the page is built:
          the test run, the recorded real runs and their measured cost.
        </p>
        <div className="wf-track" aria-hidden="true">
          <i />
        </div>
        <ol className="wf-steps">
          {b.steps.map((s, i) => (
            <li key={s.title} className="wf-step" style={{ "--i": i } as CSSProperties}>
              <span className="wf-n" aria-hidden="true">
                {i + 1}
              </span>
              <div className="wf-body">
                <h3 className="wf-t">{s.title}</h3>
                <p className="wf-x">{s.text}</p>
                {s.url ? (
                  <a className="wf-fact" href={s.url} target="_blank" rel="noopener">
                    {s.fact} <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <span className="wf-fact">{s.fact}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
        {(b.badge || b.links.length > 0) && (
          <div className="wf-foot">
            {b.badge && (
              <a className="wf-badge" href={`${b.repo}/actions/workflows/ci.yml`} target="_blank" rel="noopener">
                <img src={b.badge} alt="CI status on GitHub" height="20" />
              </a>
            )}
            {b.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener">
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
