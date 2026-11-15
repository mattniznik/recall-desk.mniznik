// One live chat request: everything between the HTTP body and the stream of events, with no
// AWS in it. The Lambda handler (src/lambda/handler.ts) supplies the real bot check, run
// counters, model client and NHTSA client; the tests supply fakes.
//
// Order matters, cheapest refusal first, so nothing is spent on a request that will be
// refused: shape -> bot check -> key present -> day's budget -> visitor's day -> global day
// -> the model.

import { createHash } from "node:crypto";

import { runAgent, type ChatTurn, type ModelClient, type TraceEvent } from "../agent/loop.ts";
import { budgetUsd, costUsd } from "../agent/cost.ts";
import { MODEL } from "../agent/anthropic.ts";
import type { FetchJson } from "../tools/http.ts";
import { CHAT_LIMITS } from "./limits.ts";

export { CHAT_LIMITS };

export type ErrorCode = "bad_request" | "bot_check" | "not_live" | "visitor_limit" | "daily_limit" | "budget" | "busy" | "failed";

export type AskEvent =
  | { type: "start"; left: number }
  | TraceEvent
  | {
      type: "done";
      status: "answered" | "handoff";
      costUsd: number | null;
      tokens: { input: number; cacheWrite: number; cacheRead: number; output: number };
      modelCalls: number;
      toolCalls: number;
      seconds: number;
    }
  | { type: "error"; code: ErrorCode; message: string };

export type AskDeps = {
  verifyHuman: (token: string, ip: string) => Promise<boolean>;
  // Adds one to the counter at `key` unless that would pass `limit`; the item expires at
  // `expiresAt` (epoch seconds). Must be atomic: two parallel requests cannot both get the
  // last run.
  takeRun: (key: string, limit: number, expiresAt: number) => Promise<{ ok: boolean; count: number }>;
  // null when no Anthropic key is configured yet: the chat is not switched on.
  modelClient: () => Promise<ModelClient | null>;
  // Dollars spent on the model today (UTC), and adding a run's cost to it.
  spentToday: (day: string) => Promise<number>;
  addSpend: (day: string, usd: number) => Promise<void>;
  fetchJson: FetchJson;
  salt: string;
  now?: () => Date;
  // Told why a run failed (upstreamDetail), for the operator's log only; the visitor gets the
  // generic message.
  onFailure?: (detail: UpstreamDetail) => void;
};

export type UpstreamDetail = { status: number | undefined; type: string; message: string; cause?: string };

const MESSAGES: Record<ErrorCode, string> = {
  bad_request: "That request could not be read. Questions are up to 500 characters.",
  bot_check: "The bot check did not pass. Reload the page and try again.",
  not_live: "Live answers are not switched on yet. The recorded examples show real runs.",
  visitor_limit: `That was your last live question for today (${CHAT_LIMITS.perVisitorPerDay} a day). The recorded examples are still here.`,
  daily_limit: "The demo has used today's live questions. Try again tomorrow, or watch the recorded examples.",
  budget: "This month's live budget is used up. The recorded examples still work.",
  busy: "The model is busy right now. Try again in a minute.",
  failed: "Something went wrong on our side. Try again, or watch the recorded examples.",
};

export const ndjson = (e: AskEvent): string => JSON.stringify(e) + "\n";

export const errorEvent = (code: ErrorCode): AskEvent => ({ type: "error", code, message: MESSAGES[code] });

export function visitorHash(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex");
}

type Parsed = { ok: true; question: string; history: ChatTurn[]; token: string } | { ok: false };

// The body comes from the internet. Anything off-shape is refused rather than repaired.
export function parseAskRequest(body: unknown): Parsed {
  if (!body || typeof body !== "object") return { ok: false };
  const b = body as Record<string, unknown>;
  const question = typeof b.question === "string" ? b.question.trim() : "";
  const token = typeof b.turnstileToken === "string" ? b.turnstileToken : "";
  if (!question || question.length > CHAT_LIMITS.questionChars || !token || token.length > 4096) return { ok: false };

  const raw = b.history ?? [];
  if (!Array.isArray(raw) || raw.length > CHAT_LIMITS.historyTurns) return { ok: false };
  const history: ChatTurn[] = [];
  for (const [i, t] of raw.entries()) {
    const turn = t as Record<string, unknown>;
    const want = i % 2 === 0 ? "user" : "assistant";
    if (turn?.role !== want || typeof turn.text !== "string" || !turn.text.trim() || turn.text.length > CHAT_LIMITS.turnChars) return { ok: false };
    history.push({ role: want, text: turn.text });
  }
  // History is complete exchanges: it ends with the assistant, the new question follows.
  if (history.length % 2 !== 0) return { ok: false };
  return { ok: true, question, history, token };
}

function errorCodeOf(e: unknown): ErrorCode {
  const status = (e as { status?: number })?.status;
  const message = String((e as { message?: string })?.message ?? "");
  // Anthropic's spend limits (rate limits docs, read 2026-11-14): a workspace spend limit answers HTTP
  // 400 "You have reached your specified [workspace] API usage limits"; the tier's monthly cap
  // answers HTTP 429 with error_code enforced_spend_limit_reached and "You have reached your API
  // usage limits", no retry-after. Both are the budget, not "busy".
  const code = (e as { error?: { error?: { details?: { error_code?: string } } } })?.error?.error?.details?.error_code;
  if ((status === 400 || status === 429) && (/usage limits/i.test(message) || code === "enforced_spend_limit_reached")) return "budget";
  if (status === 429 || status === 529) return "busy";
  return "failed";
}

// An error message made safe for the log. Quoted text goes first, because undici quotes a whole
// header value (the key included, newlines and all) when it refuses one; then anything shaped like
// a key, and any 24+ character run of key alphabet, which catches a key's tail split off by a
// newline. Hostnames and error codes survive: their runs are short.
const cleanMessage = (s: unknown, max: number): string =>
  String(s ?? "")
    .replace(/"[^"]*"/g, '"[removed]"')
    .replace(/sk-ant-[A-Za-z0-9_-]*/g, "sk-ant-[removed]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

type ErrorLike = { status?: number; name?: string; code?: string; message?: string; cause?: unknown; error?: { error?: { type?: string; message?: string } } };

// Why a run failed, short enough for one log line: the HTTP status, Anthropic's error type (or the
// JavaScript error name), the start of the message, and for a connection failure the errors behind
// it (`cause`), each with its code. Added after the first production question failed with nothing
// in the log but "failed"; the cause chain after the second said only "Connection error." (both
// 2026-11-14).
export function upstreamDetail(e: unknown): UpstreamDetail {
  const err = e as ErrorLike;
  const detail: UpstreamDetail = {
    status: typeof err?.status === "number" ? err.status : undefined,
    type: err?.error?.error?.type ?? err?.name ?? "Error",
    message: cleanMessage(err?.error?.error?.message ?? err?.message, 160),
  };
  const chain: string[] = [];
  for (let c = err?.cause as ErrorLike | undefined, i = 0; c && typeof c === "object" && i < 3; c = c.cause as ErrorLike | undefined, i++) {
    chain.push(`${c.name ?? "Error"}${c.code ? `(${c.code})` : ""}: ${cleanMessage(c.message, 120)}`);
  }
  if (chain.length) detail.cause = chain.join(" <- ");
  return detail;
}

export async function handleAsk(body: unknown, ip: string, deps: AskDeps, write: (e: AskEvent) => void): Promise<void> {
  const fail = (code: ErrorCode) => write(errorEvent(code));

  const req = parseAskRequest(body);
  if (!req.ok) return fail("bad_request");
  if (!(await deps.verifyHuman(req.token, ip))) return fail("bot_check");

  const client = await deps.modelClient();
  if (!client) return fail("not_live");

  const now = deps.now?.() ?? new Date();
  const day = now.toISOString().slice(0, 10);
  if ((await deps.spentToday(day)) >= CHAT_LIMITS.usdPerDay) return fail("daily_limit");
  const expiresAt = Math.floor(now.getTime() / 1000) + 2 * 24 * 3600;
  const visitor = await deps.takeRun(`ip#${visitorHash(ip, deps.salt)}#${day}`, CHAT_LIMITS.perVisitorPerDay, expiresAt);
  if (!visitor.ok) return fail("visitor_limit");
  const global = await deps.takeRun(`day#${day}`, CHAT_LIMITS.perDay, expiresAt);
  if (!global.ok) return fail("daily_limit");

  write({ type: "start", left: CHAT_LIMITS.perVisitorPerDay - visitor.count });

  const started = Date.now();
  const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let cost: number | null = 0;
  // What the day's budget is charged: the shown cost, or a ceiling for a model missing from the
  // price table, so an unknown model never counts as free (cost.ts, budgetUsd).
  let charged = 0;
  try {
    const result = await runAgent({
      question: req.question,
      history: req.history,
      client,
      deps: { fetchJson: deps.fetchJson },
      deadline: started + CHAT_LIMITS.runMs,
      emit: (e) => {
        if (e.type === "model_call" && e.usage) {
          tokens.input += e.usage.input_tokens;
          tokens.cacheWrite += e.usage.cache_creation_input_tokens ?? 0;
          tokens.cacheRead += e.usage.cache_read_input_tokens ?? 0;
          tokens.output += e.usage.output_tokens;
          const c = costUsd(e.model ?? MODEL, e.usage);
          cost = cost === null || c === null ? null : cost + c;
          charged += budgetUsd(e.model ?? MODEL, e.usage);
        }
        write(e);
      },
    });
    write({
      type: "done",
      status: result.status,
      costUsd: cost,
      tokens,
      modelCalls: result.modelCalls,
      toolCalls: result.toolCalls,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    });
  } catch (e) {
    deps.onFailure?.(upstreamDetail(e));
    fail(errorCodeOf(e));
  } finally {
    // What the model calls cost counts against the day even when the run failed half way.
    if (charged > 0) await deps.addSpend(day, charged);
  }
}
