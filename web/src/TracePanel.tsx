// The trace panel: what the agent did, one row per tool, in order, while it works. Rows
// for blocked answers carry the rule's own words, because "the answer was checked and
// fixed" is the point of the demo.

import { TOOL_LABEL, type Step } from "./trace.ts";

export function TracePanel({ steps }: { steps: Step[] }) {
  return (
    <ol className="trace" aria-label="What the agent did">
      {steps.map((s, i) => {
        if (s.kind === "tool") {
          return (
            <li key={i} className={`step ${s.ok ? "ok" : "err"}`}>
              <span className="step-name">{TOOL_LABEL[s.name] ?? s.name}</span>
              {s.input && <span className="step-input">{s.input}</span>}
              <span className="step-summary">
                {s.summary} <span className="step-ms">{s.ms} ms</span>
              </span>
            </li>
          );
        }
        if (s.kind === "blocked") {
          return (
            <li key={i} className="step blocked">
              <span className="step-name">Answer blocked by a rule, sent back once</span>
              <ul>
                {s.reasons.map((r, j) => (
                  <li key={j}>{r}</li>
                ))}
              </ul>
            </li>
          );
        }
        if (s.kind === "handoff") {
          return (
            <li key={i} className="step handoff">
              <span className="step-name">Handed to a person</span>
              <span className="step-summary">ticket {s.ticketId}</span>
            </li>
          );
        }
        return (
          <li key={i} className="step done">
            <span className="step-name">Answer passed every rule</span>
          </li>
        );
      })}
    </ol>
  );
}
