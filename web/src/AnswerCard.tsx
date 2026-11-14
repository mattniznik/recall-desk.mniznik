// The answer as the customer reads it, with the claims the rules checked shown beside it:
// the recalls it cites, the ones it says apply, the parts it says fit, and whether a person
// takes over. Rendered as text through React, never as HTML.

import type { Answer } from "../../src/agent/answer.ts";

function Chips({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="chips">
      <span className="chips-title">{title}</span>
      {items.map((x) => (
        <span key={x} className="chip">
          {x}
        </span>
      ))}
    </div>
  );
}

export function AnswerCard({ answer }: { answer: Answer }) {
  return (
    <section className="answer" aria-label="Answer">
      <p className="answer-text">{answer.text}</p>
      <Chips title="Recalls cited" items={answer.cited_recall_ids} />
      <Chips title="Said to apply to this car" items={answer.applies_to_vehicle} />
      <Chips title="Parts confirmed to fit" items={answer.fits} />
      {answer.handoff && <p className="answer-handoff">A person will take it from here.</p>}
      <p className="answer-note">Official recall status for one car: nhtsa.gov/recalls with its VIN.</p>
    </section>
  );
}
