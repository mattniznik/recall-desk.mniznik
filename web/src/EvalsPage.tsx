// The Evals page: one card per eval run, newest first, with its pass rate, the rate per
// case type, and each failure opened by a tap. Empty until milestone 3, and it says so.

import { evalsView, type EvalRun } from "./evals.ts";

export function EvalsPage({ runs }: { runs: EvalRun[] }) {
  const view = evalsView(runs);
  if (view.state === "empty") {
    return (
      <section className="evals" aria-label="Evals">
        <h2>Evals</h2>
        <p className="evals-empty">{view.message}</p>
      </section>
    );
  }
  return (
    <section className="evals" aria-label="Evals">
      <h2>Evals</h2>
      {view.rows.map((row) => (
        <article key={row.label + row.ranAt} className="eval-run">
          <header>
            <strong>{row.label}</strong> <span className="eval-rate">{row.rate}%</span>{" "}
            <span className="eval-meta">
              {row.passed} of {row.total} cases, {row.ranAt.slice(0, 10)}
              {row.costUsd !== undefined && `, $${row.costUsd.toFixed(2)}`}
            </span>
          </header>
          <ul className="eval-types">
            {row.byType.map((t) => (
              <li key={t.type}>
                {t.type}: {t.passed}/{t.total}
              </li>
            ))}
          </ul>
          {row.failures.length > 0 && (
            <details>
              <summary>{row.failures.length} failed</summary>
              <ul>
                {row.failures.map((f) => (
                  <li key={f.id}>
                    <code>{f.id}</code> ({f.type}): {f.reasons.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
