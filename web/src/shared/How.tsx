// "How it works": the agent's six steps (site.ts howSteps, with its real limits) shown five
// ways, each on a recorded real run. Ported from rag.irs's rich/flows.js and simple/s1-s3.js:
//   Field    - one dot per owner complaint NHTSA holds for the car, narrowing to one answer (01, 08)
//   Player   - one real run stepped through the six steps (06, 09)
//   Story    - the steps as you scroll, a sticky panel showing each (05)
//   Pipeline - the whole agent as one figure (04)
//   Line     - the six steps as boxes, a dot travelling a line under them (07)
// Colours come from the palette variables. Under reduced motion nothing moves on its own: the
// field shows its last frame, the player waits for a click, the dot does not travel.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { HOW, site, walk } from "./data.ts";
import { money, ruleOrder, ruleTitle, type Walk } from "../site.ts";
import { useMotion } from "../live.ts";
import { markSizes } from "./field.ts";

/* ---------------------------------------------------------------- one step of one run */

function Typed({ text, ms, run }: { text: string; ms: number; run: boolean }) {
  const [n, setN] = useState(run ? 0 : text.length);
  useEffect(() => {
    if (!run) return setN(text.length);
    setN(0);
    const per = Math.max(1, Math.ceil(text.length / (ms / 16)));
    const t = setInterval(() => setN((x) => (x + per >= text.length ? (clearInterval(t), text.length) : x + per)), 16);
    return () => clearInterval(t);
  }, [text, ms, run]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="caret" />}
    </>
  );
}

const meter = (label: string, v: number, max: number, unit = "") => (
  <div className="meter in" key={label}>
    <span className="mlab">{label}</span>
    <span className="mbar">
      <i style={{ width: `${Math.min(100, (100 * v) / max).toFixed(1)}%` }} />
    </span>
    <span className="mval">
      {v}
      {unit} of {max}
      {unit}
    </span>
  </div>
);

/** What one step of one recorded run looked like. `typing` animates the question and the JSON. */
export function StepView({ w, typing = false }: { w: Walk; typing?: boolean }) {
  switch (w.kind) {
    case "question":
      return (
        <>
          <p className="lbl">Real run · the question</p>
          <p className="qtext">
            <Typed text={w.question} ms={1300} run={typing} />
          </p>
          <p className="pfoot">{HOW[0].sub}. A bot check first, then the agent.</p>
        </>
      );
    case "tools":
      return (
        <>
          <p className="lbl in">
            Lookups · {w.tools.length} in this run, each with its input and what came back
          </p>
          {w.tools.length ? (
            <div className="rows">
              {w.tools.map((t, i) => (
                <div className={`rrow in${t.ok ? "" : " bad"}`} key={i}>
                  <span className="rk">{t.label}</span>
                  <span className="rs" title={t.input}>
                    {t.input || "no input"}
                  </span>
                  <span className="rsum">{t.summary}</span>
                  <span className="rmath">{t.ms} ms</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="pquote in">No lookups. The question needed none, so the answer must stay short.</p>
          )}
          <p className="pfoot in">Recalls, complaints and ratings come from NHTSA's public APIs; the catalog and the handoff are the store's.</p>
        </>
      );
    case "json":
      return (
        <>
          <p className="lbl">submit_answer · the answer as JSON</p>
          <pre className="pjson">
            <Typed text={w.json} ms={1800} run={typing} />
          </pre>
          <p className="pfoot">{w.shortened ? "The text is shortened here; step 5 shows it whole. " : ""}Every claim is a field, so code can check it.</p>
        </>
      );
    case "rules":
      return (
        <>
          <p className="lbl in">The rules, in code · after the model answers</p>
          {w.blocked.length ? (
            <>
              {w.blocked.map((b, i) => (
                <div key={i} className="in">
                  <p className="pquote">{ruleTitle(b.rule)}</p>
                  <span className="stamp bad" style={{ "--d": `${500 + i * 400}ms` } as CSSProperties}>
                    ✗ Sent back
                  </span>
                  <p className="pctx">The rule's words to the model: "{b.detail}"</p>
                </div>
              ))}
              {w.passed && (
                <p className="pend in">
                  <span className="stamp ok" style={{ "--d": "1300ms" } as CSSProperties}>
                    ✓ Passed on the retry
                  </span>
                </p>
              )}
            </>
          ) : (
            <div className="rows">
              {ruleOrder(site.agent.rules).map((r) => (
                <div className="rrow in ok" key={r}>
                  <span className="rk">✓</span>
                  <span className="rs">{ruleTitle(r)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      );
    case "result":
      return (
        <>
          <p className="lbl in">{w.handoff ? "Handed to a person" : "Shown to the customer"}</p>
          {w.handoff && w.ticket && <span className="stamp ok in">Ticket {w.ticket}</span>}
          <p className="pend in answer-whole">{w.text}</p>
        </>
      );
    case "limits":
      return (
        <>
          <p className="lbl in">The limits · this run against them</p>
          <div className="meters">
            {meter("Model calls", w.modelCalls, w.max.modelCalls)}
            {meter("Lookups", w.toolCalls, w.max.toolCalls)}
            {meter("Seconds", Math.round(w.seconds * 10) / 10, w.max.seconds, " s")}
          </div>
          <p className="pfoot in">
            {w.tokens.toLocaleString("en-US")} tokens{w.costUsd !== null ? `, ${money(w.costUsd)} measured from the tokens the API reported` : ", scripted: no model was called"}.
          </p>
        </>
      );
  }
}

/** The explanation of one step, under a visual. */
export function Explain({ i }: { i: number | null }) {
  if (i === null) return null;
  return (
    <div className="fexplain">
      <div className="h3">{HOW[i].title}</div>
      <p>{HOW[i].text}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- the dot field */

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();

export function Field() {
  const f = site.field;
  const w = walk(f.key);
  const motion = useMotion();
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<{ pick(i: number): void; toggle(): void } | null>(null);
  const [stage, setStage] = useState(motion ? 0 : 5);
  const [playing, setPlaying] = useState(motion);
  const [open, setOpen] = useState<number | null>(null);

  const json = w[2].kind === "json" ? w[2] : null;
  const rules = w[3].kind === "rules" ? w[3] : null;
  const lim = w[5].kind === "limits" ? w[5] : null;
  const result = w[4].kind === "result" ? w[4] : null;
  const captions = [
    `Real run: "${f.question}"`,
    `Lookups: ${f.recalls} recalls, then ${f.matching} of ${f.complaints} owner complaints (${f.component})`,
    `${site.model.name} answers in JSON through submit_answer`,
    rules && rules.blocked.length ? `A rule sent the first answer back; the retry passed` : `Code checks the answer against ${site.agent.rules.length} rules: all passed`,
    "Shown to the customer, with every lookup it made",
    lim ? `Inside the limits: ${lim.modelCalls} of ${lim.max.modelCalls} model calls, ${lim.toolCalls} of ${lim.max.toolCalls} lookups, ${lim.seconds.toFixed(1)} of ${lim.max.seconds} s` : "",
  ];

  useEffect(() => {
    const root = box.current!, canvas = cv.current!, ctx = canvas.getContext("2d")!;
    const light = document.body.classList.contains("light");
    const C = { a1: cssVar("a1"), a2: cssVar("a2"), a3: cssVar("a3"), dim: cssVar("line"), tx: cssVar("tx"), mu: cssVar("mu"), bg: cssVar("bg"), card: cssVar("card"), ok: light ? "#1f8a4c" : "#3fbf7f", bad: light ? "#b42b2b" : "#ef7a6a", fb: cssVar("fb") };
    const N = f.complaints + f.recalls;
    // which dots light up is illustrative and seeded; how many is the run's own count
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const used = new Set<number>();
    const pickDot = () => {
      let i;
      do i = Math.floor(rnd() * N);
      while (used.has(i));
      used.add(i);
      return i;
    };
    const R = new Set(Array.from({ length: f.recalls }, pickDot));
    const M = new Set(Array.from({ length: f.matching }, pickDot));
    const jsonLines = json ? json.json.split("\n").filter((l) => l.trim() !== "{" && l.trim() !== "}").map((l) => l.trim()) : [];
    const ruleLines = rules ? (rules.blocked.length ? [...rules.blocked.map((b) => `✗ ${ruleTitle(b.rule)}: sent back`), ...(rules.passed ? ["✓ Passed on the retry"] : [])] : ruleOrder(site.agent.rules).map((r) => `✓ ${ruleTitle(r)}`)) : [];

    let W = 0, H = 0, pitch = 0, pos: [number, number][] = [], card = { x: 0, y: 0, w: 0, h: 0 };
    function layout() {
      W = root.clientWidth;
      const narrow = W < 560, pad = 12;
      pitch = Math.max(5, Math.floor(Math.sqrt(((W - 2 * pad) * (narrow ? 300 : 240)) / N)));
      const cols = Math.floor((W - 2 * pad) / pitch), rows = Math.ceil(N / cols);
      H = Math.max(rows * pitch + 2 * pad, 230);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ox = (W - cols * pitch) / 2 + pitch / 2, oy = (H - rows * pitch) / 2 + pitch / 2;
      pos = Array.from({ length: N }, (_, i) => [ox + (i % cols) * pitch, oy + Math.floor(i / cols) * pitch]);
      const cw = narrow ? W - 24 : Math.min(W * 0.46, 470), ch = Math.min(H - 24, 200);
      card = { x: narrow ? 12 : W - cw - 16, y: (H - ch) / 2, w: cw, h: ch };
    }
    const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const rrect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    };
    const fit = (s: string, w: number) => {
      if (ctx.measureText(s).width <= w) return s;
      while (s.length > 1 && ctx.measureText(s + "…").width > w) s = s.slice(0, -1);
      return s + "…";
    };
    const wrap = (s: string, w: number, max: number) => {
      const out: string[] = [];
      let line = "";
      for (const word of s.split(/\s+/)) {
        const next = line ? line + " " + word : word;
        if (ctx.measureText(next).width > w && line) {
          out.push(line);
          line = word;
          if (out.length === max) break;
        } else line = next;
      }
      if (out.length < max && line) out.push(line);
      if (out.length === max) out[max - 1] = fit(out[max - 1] + " …", w);
      return out;
    };

    function draw(s: number, p: number) {
      ctx.clearRect(0, 0, W, H);
      const e = ease(p * 1.6), size = markSizes(pitch), r = size.dot;
      const gridA = s < 2 ? 1 : s === 2 ? 1 - 0.8 * e : 0.2;
      for (let i = 0; i < N; i++) {
        const isR = R.has(i), isM = M.has(i);
        const litR = isR && s >= 1 && (s > 1 || p > 0.05), litM = isM && s >= 1 && (s > 1 || p > 0.45);
        let col = C.dim, a = gridA, rr = r, d = r * 1.7;
        if (litR || litM) {
          col = litR ? C.a3 : C.a1;
          const fresh = s === 1 && ((litR && p < 0.45) || (litM && p >= 0.45));
          const k = s === 1 ? ease(((litR ? p : p - 0.45) * 1.8)) : 1;
          // inside its own cell: grows to the pulse size, settles at the lit size (field.ts)
          rr = fresh ? r + (size.pulse - r) * k : size.lit;
          d = fresh ? r * 1.7 + (size.square - r * 1.7) * k : size.square;
          a = s >= 2 ? Math.max(0.55, gridA) : Math.max(0.35, k);
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        if (isR) {
          rrect(pos[i][0] - d / 2, pos[i][1] - d / 2, d, d, 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(pos[i][0], pos[i][1], rr, 0, 7);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (s === 0) {
        ctx.font = `500 14px ${C.fb}`;
        const k = ease(p * 2.2), txt = fit(f.question, W - 80), bw = ctx.measureText(txt).width + 30, bx = (W - bw) / 2, by = H / 2 - 20 + (1 - k) * 8;
        ctx.globalAlpha = k;
        ctx.fillStyle = C.bg;
        rrect(bx, by, bw, 40, 20);
        ctx.fill();
        ctx.strokeStyle = C.a1;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = C.tx;
        ctx.textBaseline = "middle";
        ctx.fillText(txt, bx + 15, by + 20);
        ctx.globalAlpha = 1;
      }
      if (s >= 2) {
        const c = card, a = s === 2 ? ease(p * 2.5) : 1, done = s >= 4;
        ctx.globalAlpha = a;
        ctx.fillStyle = C.bg;
        rrect(c.x, c.y, c.w, c.h, 12);
        ctx.fill();
        ctx.strokeStyle = done ? C.ok : C.mu;
        ctx.lineWidth = done ? 2 : 1;
        ctx.stroke();
        ctx.textBaseline = "top";
        ctx.fillStyle = C.mu;
        ctx.font = "500 10.5px 'JetBrains Mono', monospace";
        ctx.fillText(["", "", "SUBMIT_ANSWER · JSON", "THE RULES, IN CODE", "SHOWN", "THE LIMITS"][s], c.x + 14, c.y + 12);
        const lineH = 19, top = c.y + 34, inner = c.w - 28;
        if (s === 2) {
          ctx.font = `400 ${c.w < 300 ? 10.5 : 11.5}px 'JetBrains Mono', monospace`;
          const total = jsonLines.join("").length;
          let budget = Math.floor(total * ease(p * 1.3));
          jsonLines.slice(0, Math.floor((c.h - 44) / lineH)).forEach((ln, k) => {
            if (budget <= 0) return;
            ctx.fillStyle = k === 0 ? C.tx : C.mu;
            ctx.fillText(fit(ln.slice(0, budget), inner), c.x + 14, top + k * lineH);
            budget -= ln.length;
          });
        }
        if (s === 3) {
          ctx.font = `500 ${c.w < 300 ? 12 : 13}px ${C.fb}`;
          const shown = Math.ceil(ruleLines.length * ease(p * 1.4));
          ruleLines.slice(0, Math.min(shown, Math.floor((c.h - 44) / lineH))).forEach((ln, k) => {
            ctx.fillStyle = ln.startsWith("✗") ? C.bad : C.ok;
            ctx.fillText(fit(ln, inner), c.x + 14, top + k * lineH);
          });
        }
        if (s === 4 && result) {
          ctx.font = `400 ${c.w < 300 ? 13 : 14}px ${C.fb}`;
          ctx.fillStyle = C.tx;
          wrap(result.text.replace(/\s+/g, " "), inner - 24, Math.floor((c.h - 44) / 21)).forEach((ln, k) => ctx.fillText(ln, c.x + 14, top + k * 21));
          const k = ease(p * 2.2), cx = c.x + c.w - 6, cy = c.y + 6;
          ctx.fillStyle = C.ok;
          ctx.beginPath();
          ctx.arc(cx, cy, 14 * k, 0, 7);
          ctx.fill();
          if (k > 0.6) {
            ctx.strokeStyle = C.bg;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(cx - 6, cy);
            ctx.lineTo(cx - 1.5, cy + 4.5);
            ctx.lineTo(cx + 6, cy - 4.5);
            ctx.stroke();
          }
        }
        if (s === 5 && lim) {
          const rows: [string, number, number][] = [
            ["Model calls", lim.modelCalls, lim.max.modelCalls],
            ["Lookups", lim.toolCalls, lim.max.toolCalls],
            ["Seconds", Math.round(lim.seconds * 10) / 10, lim.max.seconds],
          ];
          const g = ease(p * 1.5), lw = Math.min(110, inner * 0.38);
          rows.forEach(([label, v, max], k) => {
            const y = top + 6 + k * 36;
            ctx.font = `500 12.5px ${C.fb}`;
            ctx.fillStyle = C.tx;
            ctx.fillText(label, c.x + 14, y);
            ctx.fillStyle = C.mu;
            ctx.font = "400 11px 'JetBrains Mono', monospace";
            ctx.fillText(`${v} of ${max}`, c.x + 14, y + 15);
            const bx = c.x + 14 + lw, bw = inner - lw;
            ctx.fillStyle = C.dim;
            rrect(bx, y + 4, bw, 8, 4);
            ctx.fill();
            const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
            grad.addColorStop(0, C.a1);
            grad.addColorStop(1, C.a2);
            ctx.fillStyle = grad;
            rrect(bx, y + 4, Math.max(8, (bw * v * g) / max), 8, 4);
            ctx.fill();
          });
        }
        ctx.globalAlpha = 1;
      }
    }

    const DUR = [2200, 3000, 2800, 2800, 2600, 2800];
    let s = motion ? 0 : 5, t0 = performance.now(), play = motion, visible = false, raf = 0, dead = false;
    const set = (k: number) => {
      s = k;
      t0 = performance.now();
      setStage(k);
    };
    function frame(now: number) {
      raf = 0;
      if (dead || !play || !visible) return;
      let p = (now - t0) / DUR[s];
      if (p >= 1) {
        set((s + 1) % 6);
        p = 0;
      }
      draw(s, p);
      raf = requestAnimationFrame(frame);
    }
    const run = () => {
      if (!raf && play && visible) raf = requestAnimationFrame(frame);
    };
    ctl.current = {
      pick(i) {
        play = false;
        setPlaying(false);
        set(i);
        draw(i, 1);
      },
      toggle() {
        play = !play;
        setPlaying(play);
        if (play) {
          t0 = performance.now();
          run();
        } else draw(s, 1);
      },
    };
    layout();
    draw(s, motion ? 0 : 1);
    const ro = new ResizeObserver(() => {
      if (root.clientWidth && root.clientWidth !== W) {
        layout();
        draw(s, play ? 0 : 1);
      }
    });
    ro.observe(root);
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      visible = en.isIntersecting;
      if (visible) {
        t0 = performance.now();
        run();
      }
    }), { threshold: 0.25 });
    io.observe(root);
    // web fonts can land after the first frame: draw again once they have
    document.fonts?.ready.then(() => !dead && draw(s, 1));
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
    // the run is fixed for the page's life; only reduced motion changes the set-up
  }, [motion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="funnel" ref={box}>
        <canvas
          ref={cv}
          role="img"
          aria-label={`Animation of a recorded real run: ${f.complaints} owner complaints and ${f.recalls} recalls for the car, ${f.matching} complaints and the recalls light up, ${site.model.name} answers in JSON, code checks ${site.agent.rules.length} rules, the answer is shown.`}
        />
        <div className="ftop">
          <p className="fcap">{captions[stage]}</p>
          {motion && (
            <button type="button" className="fplay" onClick={() => ctl.current?.toggle()}>
              {playing ? "Pause" : "Play"}
            </button>
          )}
        </div>
        <div className="fsteps">
          {HOW.map((h, i) => (
            <button
              type="button"
              key={h.title}
              className={`fstep${i === stage ? " on" : ""}${i === open ? " open" : ""}`}
              aria-pressed={i === open}
              onClick={() => {
                ctl.current?.pick(i);
                setOpen(open === i ? null : i);
              }}
            >
              {h.title}
            </button>
          ))}
        </div>
      </div>
      <Explain i={open} />
    </>
  );
}

/* ---------------------------------------------------------------- the step-through player */

const PLAYER_RUNS: [string, string][] = [
  ["real-brakes", "A passed answer"],
  ["real-safety", "Sent back, then fixed"],
  ["real-refund", "Handed to a person"],
];
const PLAYER_MS = [3000, 3600, 3800, 4200, 4200, 3800];

export function Player({ explain = true }: { explain?: boolean }) {
  const motion = useMotion();
  const [runKey, setRunKey] = useState(PLAYER_RUNS[0][0]);
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [typing, setTyping] = useState(false);
  const [minH, setMinH] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const measureBox = useRef<HTMLDivElement>(null);
  const played = useRef(false);
  const steps = walk(runKey);

  // advance while playing; stop at the last step
  useEffect(() => {
    if (!playing) return;
    if (k >= 5) return setPlaying(false);
    const t = setTimeout(() => setK((x) => x + 1), PLAYER_MS[k]);
    return () => clearTimeout(t);
  }, [playing, k]);
  useEffect(() => setTyping(playing), [playing, k]);

  // plays once, the first time it scrolls into view
  useEffect(() => {
    if (!motion || !root.current) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !played.current) {
        played.current = true;
        io.disconnect();
        setK(0);
        setPlaying(true);
      }
    }), { threshold: 0.45 });
    io.observe(root.current);
    return () => io.disconnect();
  }, [motion]);

  // the stage keeps its tallest step's height, so the page does not jump while it plays; capped,
  // because on a phone the whole answer in step 5 is far taller than every other step
  useLayoutEffect(() => {
    const m = measureBox.current;
    if (!m) return;
    const measure = () => setMinH(Math.min(640, Math.max(...[...m.children].map((c) => (c as HTMLElement).offsetHeight))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(m);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [runKey]);

  const go = (i: number) => {
    setPlaying(false);
    setK(i);
  };
  return (
    <>
      <div className="player" ref={root}>
        <div className="prail">
          <i className="pprog" style={{ width: `calc((100% - 24px) * ${k} / 6)` }} />
          {HOW.map((h, i) => (
            <button type="button" key={h.title} className={`pstep${i === k ? " on" : ""}${i < k ? " past" : ""}`} aria-current={i === k ? "step" : undefined} onClick={() => go(i)}>
              <span className="pn">{i + 1}</span>
              <span className="pt">{h.title}</span>
            </button>
          ))}
        </div>
        <div className="pstage-wrap">
          <div className="pstage" aria-live="polite" style={{ minHeight: minH || undefined }} key={`${runKey}-${k}`}>
            <StepView w={steps[k]} typing={typing && motion} />
          </div>
          <div className="pstage pmeasure" ref={measureBox} aria-hidden="true">
            {steps.map((w, i) => (
              <div key={i}>
                <StepView w={w} />
              </div>
            ))}
          </div>
        </div>
        <div className="pctl">
          <div className="ptogs">
            {PLAYER_RUNS.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className="ptog"
                aria-pressed={key === runKey}
                onClick={() => {
                  setRunKey(key);
                  setK(0);
                  setPlaying(motion);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pbtn"
            onClick={() => {
              if (playing) return setPlaying(false);
              if (k >= 5) setK(0);
              setPlaying(true);
            }}
          >
            {playing ? "Pause" : k >= 5 ? "Play again" : "Play"}
          </button>
        </div>
      </div>
      {explain && <Explain i={k} />}
    </>
  );
}

/* ---------------------------------------------------------------- the scroll story */

export function Story() {
  const steps = walk("real-safety");
  const [cur, setCur] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>(".st") ?? [])];
    const io = new IntersectionObserver((es) => es.forEach((x) => x.isIntersecting && setCur(Number((x.target as HTMLElement).dataset.st))), { rootMargin: "-45% 0px -45% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <div className="story">
      <div className="sticky">
        <div className="svis player-like" key={cur}>
          <StepView w={steps[cur]} />
        </div>
      </div>
      <div className="steps" ref={list}>
        {HOW.map((h, i) => (
          <div className={`st${i === cur ? " on" : ""}`} data-st={i} key={h.title}>
            <span className="n">0{i + 1}</span>
            <div className="h3">{h.title}</div>
            <p>{h.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the pipeline figure */

export function Pipeline() {
  const tools = site.agent.tools.length, rules = site.agent.rules.length, l = site.agent.limits;
  const nodes = ["Question", `${site.model.name} · decides each lookup`, `${tools} tools · NHTSA, catalog, handoff`, "submit_answer · strict JSON", `${rules} rules · code, after the model`, "Shown, or a person"];
  return (
    <div className="fig">
      <div className="cap">Fig 1 · the recall desk agent</div>
      <svg viewBox="0 0 1100 340" role="img" aria-label={`The agent: a question goes to ${site.model.name}, which calls up to ${l.toolCalls} lookups across ${tools} tools, answers through submit_answer, and ${rules} rules in code show the answer, send it back once, or hand it to a person.`}>
        <defs>
          <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--acc)" />
          </marker>
          <linearGradient id="gw" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1100" y2="0">
            <stop offset="0" stopColor="var(--a1)" />
            <stop offset=".5" stopColor="var(--a2)" />
            <stop offset="1" stopColor="var(--a3)" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#gw)" strokeWidth="2">
          <path d="M150 190 L200 190" markerEnd="url(#ar)" />
          <path d="M270 160 L270 108" markerEnd="url(#ar)" />
          <path d="M310 108 L310 160" markerEnd="url(#ar)" />
          <path d="M380 190 L430 190" markerEnd="url(#ar)" />
          <path d="M610 190 L660 190" markerEnd="url(#ar)" />
          <path d="M850 175 C880 175 880 90 905 90" markerEnd="url(#ar)" />
          <path d="M850 205 C880 205 880 290 905 290" markerEnd="url(#ar)" strokeDasharray="5 5" />
          <path d="M755 220 C755 300 290 300 290 222" markerEnd="url(#ar)" strokeDasharray="5 5" />
        </g>
        <g fontSize="13" fill="var(--tx)">
          <rect x="20" y="160" width="130" height="60" rx="12" fill="var(--card2)" stroke="var(--line)" />
          <text x="85" y="195" textAnchor="middle">QUESTION</text>
          <rect x="200" y="160" width="180" height="60" rx="12" fill="var(--card2)" stroke="var(--line)" />
          <text x="290" y="187" textAnchor="middle">{site.model.name.toUpperCase()}</text>
          <text x="290" y="206" textAnchor="middle" fill="var(--mu)" fontSize="11">decides each lookup</text>
          <rect x="180" y="30" width="220" height="78" rx="12" fill="var(--card2)" stroke="var(--line)" />
          <text x="290" y="58" textAnchor="middle">{tools} TOOLS</text>
          <text x="290" y="77" textAnchor="middle" fill="var(--mu)" fontSize="11">NHTSA recalls · complaints · ratings</text>
          <text x="290" y="94" textAnchor="middle" fill="var(--mu)" fontSize="11">VIN · catalog · handoff</text>
          <rect x="430" y="160" width="180" height="60" rx="12" fill="var(--card2)" stroke="var(--line)" />
          <text x="520" y="187" textAnchor="middle">SUBMIT_ANSWER</text>
          <text x="520" y="206" textAnchor="middle" fill="var(--mu)" fontSize="11">strict JSON</text>
          <rect x="660" y="160" width="190" height="60" rx="12" fill="none" stroke="var(--acc)" strokeWidth="2" />
          <text x="755" y="187" textAnchor="middle" fill="var(--acc)">{rules} RULES</text>
          <text x="755" y="206" textAnchor="middle" fill="var(--mu)" fontSize="11">code, after the model</text>
          <rect x="905" y="66" width="170" height="48" rx="24" fill="var(--card)" stroke="var(--line)" />
          <text x="990" y="95" textAnchor="middle">✓ SHOWN</text>
          <rect x="905" y="266" width="170" height="48" rx="24" fill="var(--card)" stroke="var(--line)" />
          <text x="990" y="295" textAnchor="middle" fill="var(--mu)">A PERSON</text>
          <text x="522" y="318" textAnchor="middle" fill="var(--mu)" fontSize="11">sent back {l.retries === 1 ? "once" : `${l.retries} times`}, with the reason</text>
          <g fill="var(--acc)" fontSize="11">
            <text x="20" y="150">1</text>
            <text x="180" y="22">2</text>
            <text x="430" y="150">3</text>
            <text x="660" y="150">4</text>
            <text x="905" y="58">5</text>
          </g>
        </g>
      </svg>
      <div className="vpipe">
        {nodes.map((t, i) => (
          <div className="nd" key={t}>
            <b>{i + 1}</b>
            {t}
          </div>
        ))}
      </div>
      <div className="callouts">
        {HOW.map((h, i) => (
          <div className="co" key={h.title}>
            <b>
              {i + 1} · {h.title.toUpperCase()}
            </b>
            <span>
              {h.sub}. {h.short}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the moving line (one-column) */

export function Line() {
  const motion = useMotion();
  const [k, setK] = useState(0);
  const [running, setRunning] = useState(motion);
  const [open, setOpen] = useState<number | null>(null);
  const line = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<number[]>([]);
  const stations = ["the question", `${site.agent.tools.length} tools`, "JSON", `${site.agent.rules.length} rules`, "shown or a person", "the limits"];

  useLayoutEffect(() => {
    const el = line.current;
    if (!el) return;
    const measure = () => setGeo([...el.querySelectorAll<HTMLElement>(".station")].map((s) => s.offsetLeft + s.offsetWidth / 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the dot moves only while the diagram is on screen
  useEffect(() => {
    if (!motion || !running || !line.current) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      clearInterval(t);
      if (e.isIntersecting) t = setInterval(() => setK((x) => (x + 1) % 6), 1400);
    }), { threshold: 0.2 });
    io.observe(line.current);
    return () => {
      clearInterval(t);
      io.disconnect();
    };
  }, [motion, running]);

  const x = (i: number) => geo[i] ?? 0;
  return (
    <>
      <div className="howbar">
        <p className="sub">Click a step.</p>
        {motion && (
          <button type="button" className="playbtn" onClick={() => setRunning(!running)}>
            {running ? "Pause" : "Play the flow"}
          </button>
        )}
      </div>
      <div className="flow">
        {HOW.map((h, i) => (
          <button
            type="button"
            className={`node${i === k ? " lit" : ""}`}
            aria-expanded={open === i}
            key={h.title}
            onClick={() => {
              setRunning(false);
              setK(i);
              setOpen(open === i ? null : i);
            }}
          >
            <b>{h.title}</b>
            <span>{h.sub}</span>
          </button>
        ))}
      </div>
      <div className="line" ref={line} aria-hidden="true">
        <i className="track" style={{ left: x(0), width: x(5) - x(0) }} />
        <i className="fillbar" style={{ left: x(0), width: x(k) - x(0) }} />
        {stations.map((s, i) => (
          <div key={s} className={`station${i === k ? " on" : ""}${i < k ? " past" : ""}`}>
            {s}
          </div>
        ))}
        {motion && geo.length > 0 && <i className={`dot${k === 4 ? " ok" : ""}`} style={{ transform: `translate(${x(k)}px, 0)` }} />}
      </div>
      <Explain i={open} />
    </>
  );
}
