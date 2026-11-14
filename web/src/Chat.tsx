// The live chat: ask about any car, or compare two or three before buying. Each answer
// streams in as the agent works, with the same trace panel and answer card as the recorded
// examples. Turnstile proves a person is asking; the server caps questions per visitor and
// per day; /api/status says whether live answers are switched on at all.

import { useEffect, useRef, useState } from "react";

import { TURNSTILE_SITE_KEY } from "../../src/config.ts";
import { CHAT_LIMITS } from "../../src/server/limits.ts";
import type { AskEvent } from "../../src/server/ask.ts";
import type { TraceEvent } from "../../src/agent/loop.ts";
import { historyFor, sha256Hex, splitLines, SUGGESTIONS, type Exchange } from "./chat.ts";
import { toSteps } from "./trace.ts";
import { TracePanel } from "./TracePanel.tsx";
import { AnswerCard } from "./AnswerCard.tsx";
import { publish } from "./map-feed.ts";

type Turnstile = { render(el: HTMLElement, opts: Record<string, unknown>): string; reset(id?: string): void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

// The local preview (npm run web:dev) plays recorded runs instead of calling the model, so
// its suggestions are the recorded questions. Cloudflare's test site key always passes and
// works on localhost (Turnstile docs, testing); the real key only works on our domain.
const PREVIEW = import.meta.env.DEV;
const SITE_KEY = PREVIEW ? "1x00000000000000000000AA" : TURNSTILE_SITE_KEY;

const TRACE_TYPES = new Set(["model_call", "tool_call", "tool_result", "rule_failed", "answer", "handoff"]);
const isTrace = (e: AskEvent): e is TraceEvent => TRACE_TYPES.has(e.type);

function useTurnstile(enabled: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!enabled || !box.current) return;
    const render = () => {
      if (!window.turnstile || !box.current || widget.current) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    };
    if (window.turnstile) return render();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [enabled]);

  // Tokens are one-use: after each question, get a fresh one.
  const reset = () => {
    setToken("");
    if (widget.current) window.turnstile?.reset(widget.current);
  };
  return { box, token, reset };
}

export function Chat({ live }: { live: boolean | null }) {
  const [left, setLeft] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const busy = exchanges.at(-1)?.state === "streaming";
  const human = useTurnstile(live === true);

  const update = (i: number, f: (x: Exchange) => Exchange) => setExchanges((all) => all.map((x, j) => (j === i ? f(x) : x)));

  // the system map lights up with the newest question's events as they stream in
  useEffect(() => {
    const i = exchanges.length - 1;
    const x = exchanges[i];
    if (x) publish({ id: `live-${i}`, title: x.question, mode: "live", events: x.events, stream: true });
  }, [exchanges]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !human.token) return;
    const body = JSON.stringify({ question: q, history: historyFor(exchanges), turnstileToken: human.token });
    const i = exchanges.length;
    setExchanges((all) => [...all, { question: q, events: [], state: "streaming" }]);
    setQuestion("");
    human.reset();

    let failed = false;
    let ended = false;
    const push = (e: AskEvent) => {
      if (e.type === "start") setLeft(e.left);
      if (e.type === "error") failed = true;
      if (e.type === "done" || e.type === "error") ended = true;
      update(i, (x) => ({ ...x, events: [...x.events, e] }));
    };
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", "x-amz-content-sha256": await sha256Hex(body) },
        body,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { lines, rest } = splitLines(buffer + decoder.decode(value, { stream: true }));
        buffer = rest;
        for (const line of lines) push(JSON.parse(line) as AskEvent);
      }
      if (buffer.trim()) push(JSON.parse(buffer) as AskEvent);
      // A stream that closes without done or error was cut off (a timeout on the way).
      if (!ended) push({ type: "error", code: "failed", message: "The answer was cut off. Try again, or ask a shorter question." });
    } catch {
      push({ type: "error", code: "failed", message: "The answer could not be loaded. Try again." });
    }
    update(i, (x) => ({ ...x, state: failed ? "error" : "done" }));
  }

  if (live === null) return <p className="left">Checking whether live answers are on...</p>;
  if (!live)
    return (
      <p className="notice">
        Live answers are not switched on yet. The <a href="#/examples">recorded examples</a> are real runs of the same agent.
      </p>
    );

  return (
    <div className="chat">
      {PREVIEW && <p className="notice">Local preview: answers are recorded real runs played back, picked by keyword. No AI is called and nothing is spent.</p>}
      {exchanges.map((x, i) => (
        <ExchangeView key={i} x={x} />
      ))}

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <label htmlFor="q" className="left">
          Ask about any car sold in the US: recalls, owners' complaints, safety ratings, parts, or compare two or three before you buy.
        </label>
        {/* the ring turns around the box (faster while an answer streams) and stands still under reduced motion */}
        <div className={busy ? "askring fast" : "askring"}>
          <textarea
            id="q"
            value={question}
            maxLength={CHAT_LIMITS.questionChars}
            placeholder="e.g. 2015 Jeep Cherokee or 2015 Honda CR-V, which is safer?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
          />
        </div>
        <WhatToTry onPick={(q) => setQuestion(q)} />
        <div className="chat-actions">
          <div ref={human.box} />
          <button type="submit" className="send" disabled={busy || !human.token || !question.trim()}>
            {busy ? "Working..." : "Ask"}
          </button>
          <span className="left">
            {left === null ? `${CHAT_LIMITS.perVisitorPerDay} live questions a day.` : `${left} live question${left === 1 ? "" : "s"} left today.`}
          </span>
        </div>
      </form>
    </div>
  );
}

function WhatToTry({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="try">
      <p className="left">What to try. Each answer shows every lookup it made and the checks it passed. A click fills the box; edit it or press Ask.</p>
      {SUGGESTIONS.map((g) => (
        <div key={g.group} className="try-group">
          <h3>{g.group}</h3>
          <div className="replays">
            {g.items.map((i) => (
              <button type="button" key={i.question} title={i.question} onClick={() => onPick(i.question)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExchangeView({ x }: { x: Exchange }) {
  const steps = toSteps(x.events.filter(isTrace));
  const last = steps.at(-1);
  const error = x.events.find((e) => e.type === "error");
  const done = x.events.find((e) => e.type === "done");
  return (
    <section className="exchange">
      <p className="question">{x.question}</p>
      {steps.length > 0 && (
        <div className="work">
          <TracePanel steps={steps} />
          {last?.kind === "answer" && <AnswerCard answer={last.answer} />}
        </div>
      )}
      {x.state === "streaming" && steps.length === 0 && <p className="left">Starting...</p>}
      {error && error.type === "error" && <p className="notice">{error.message}</p>}
      {done && done.type === "done" && (
        <p className="metrics">
          {done.modelCalls} model calls, {done.toolCalls} lookups, {(done.tokens.input + done.tokens.cacheWrite + done.tokens.cacheRead + done.tokens.output).toLocaleString("en-US")} tokens,{" "}
          {done.costUsd === null ? "cost unknown" : `$${done.costUsd.toFixed(4)}`}, {done.seconds} s.
        </p>
      )}
    </section>
  );
}
