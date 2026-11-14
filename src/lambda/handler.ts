// The live chat on AWS Lambda, behind CloudFront at /api/*.
//
//   GET  /api/status  {"live": true|false, "perVisitorPerDay": 5}
//   POST /api/ask     {"question", "history", "turnstileToken"} -> one JSON event per line
//
// Glue only: Parameter Store for the secrets, DynamoDB for the run counters, the Anthropic
// client, live NHTSA. Everything that decides something is in src/server/ask.ts and tested
// there. Built into one file by scripts/build-lambda.ts; the AWS SDK is left out because every
// Lambda Node.js runtime includes v3 (Lambda docs, "Runtime-included SDK versions").

import { CHAT_LIMITS, errorEvent, handleAsk, ndjson, type AskDeps, type AskEvent } from "../server/ask.ts";
import { verifyTurnstile } from "../server/turnstile.ts";
import { anthropicClient } from "../agent/anthropic.ts";
import { fetchJson as liveFetch } from "../tools/http.ts";
import { bodyOf, cachedFetch, viewerIp } from "./request.ts";

type Writable = { write(chunk: string): void; end(): void };
declare const awslambda: {
  streamifyResponse: (fn: (event: LambdaUrlEvent, stream: Writable) => Promise<void>) => unknown;
  HttpResponseStream?: { from(stream: Writable, meta: { statusCode: number; headers: Record<string, string> }): Writable };
};
type LambdaUrlEvent = {
  rawPath?: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string; path?: string; sourceIp?: string } };
};

const PREFIX = process.env.PARAM_PREFIX ?? "/recall-desk";
const TABLE = process.env.LIMITS_TABLE ?? "recall-desk-limits";
const HOSTNAMES = ["recall-desk.mniznik.com"];
// At most 60 cached answers: a raw complaints reply can be about 690 KB (one fixture), and
// the function has 256 MB (review, 2026-11-14).
const nhtsa = cachedFetch(liveFetch, 3_600_000, 60);
// Output tokens per model call. The most any recorded call produced was 803 (n=12 calls);
// 16,000 x 6 calls would allow about $1.92 for one question (review, 2026-11-14).
const MAX_TOKENS = 4000;

// ------------------------------------------------------------------ secrets

type Secrets = { anthropicKey?: string; turnstileSecret?: string; salt?: string };
let secrets: { at: number; value: Secrets } | undefined;

// Re-read every 5 minutes (every minute while the key is missing), so writing the key
// switches the chat on and deleting it switches it off without a redeploy. Never logged.
async function loadSecrets(): Promise<Secrets> {
  const ttl = secrets?.value.anthropicKey ? 300_000 : 60_000;
  if (secrets && Date.now() - secrets.at < ttl) return secrets.value;
  const { SSMClient, GetParametersCommand } = await import("@aws-sdk/client-ssm");
  const names = { anthropicKey: `${PREFIX}/anthropic-key`, turnstileSecret: `${PREFIX}/turnstile-secret`, salt: `${PREFIX}/salt` };
  const out = await new SSMClient({}).send(new GetParametersCommand({ Names: Object.values(names), WithDecryption: true }));
  const byName = new Map((out.Parameters ?? []).map((p) => [p.Name, p.Value]));
  const value: Secrets = { anthropicKey: byName.get(names.anthropicKey), turnstileSecret: byName.get(names.turnstileSecret), salt: byName.get(names.salt) };
  secrets = { at: Date.now(), value };
  return value;
}

const isLive = (s: Secrets) => Boolean(s.anthropicKey && s.turnstileSecret && s.salt);

// ------------------------------------------------------------------ run counters

// One conditional ADD: the counter only moves while it is under the limit, so two parallel
// requests cannot both take the last run. Items expire through the table's TTL.
let ddb: { send(cmd: unknown): Promise<{ Attributes?: Record<string, { N?: string }> }> } | undefined;
async function takeRun(key: string, limit: number, expiresAt: number): Promise<{ ok: boolean; count: number }> {
  const { DynamoDBClient, UpdateItemCommand } = await import("@aws-sdk/client-dynamodb");
  ddb ??= new DynamoDBClient({}) as never;
  try {
    const out = await ddb!.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { pk: { S: key } },
        UpdateExpression: "ADD #n :one SET expiresAt = :exp",
        ConditionExpression: "attribute_not_exists(#n) OR #n < :limit",
        ExpressionAttributeNames: { "#n": "n" },
        ExpressionAttributeValues: { ":one": { N: "1" }, ":limit": { N: String(limit) }, ":exp": { N: String(expiresAt) } },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return { ok: true, count: Number(out.Attributes?.n?.N ?? 1) };
  } catch (e) {
    if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return { ok: false, count: limit };
    throw e;
  }
}

// The day's model spend, in millionths of a dollar so DynamoDB's ADD stays exact, on key
// usd#<day> in the counters table.
async function spentToday(day: string): Promise<number> {
  const { DynamoDBClient, GetItemCommand } = await import("@aws-sdk/client-dynamodb");
  ddb ??= new DynamoDBClient({}) as never;
  const out = (await ddb!.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `usd#${day}` } }, ConsistentRead: true }))) as { Item?: Record<string, { N?: string }> };
  return Number(out.Item?.n?.N ?? 0) / 1e6;
}

async function addSpend(day: string, usd: number): Promise<void> {
  const { DynamoDBClient, UpdateItemCommand } = await import("@aws-sdk/client-dynamodb");
  ddb ??= new DynamoDBClient({}) as never;
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 24 * 3600;
  await ddb!.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { pk: { S: `usd#${day}` } },
      UpdateExpression: "ADD #n :micro SET expiresAt = :exp",
      ExpressionAttributeNames: { "#n": "n" },
      ExpressionAttributeValues: { ":micro": { N: String(Math.ceil(usd * 1e6)) }, ":exp": { N: String(expiresAt) } },
    }),
  );
}

// ------------------------------------------------------------------ the handler

function open(stream: Writable, statusCode: number, contentType: string): Writable {
  const headers = { "content-type": contentType, "cache-control": "no-store" };
  return awslambda.HttpResponseStream ? awslambda.HttpResponseStream.from(stream, { statusCode, headers }) : stream;
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext?.http?.method ?? "";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";

  if (method === "GET" && path === "/api/status") {
    const s = await loadSecrets().catch(() => ({}) as Secrets);
    const out = open(responseStream, 200, "application/json");
    out.write(JSON.stringify({ live: isLive(s), perVisitorPerDay: CHAT_LIMITS.perVisitorPerDay }));
    out.end();
    return;
  }

  if (method !== "POST" || path !== "/api/ask") {
    const out = open(responseStream, 404, "application/json");
    out.write(JSON.stringify({ error: "not found" }));
    out.end();
    return;
  }

  const out = open(responseStream, 200, "application/x-ndjson; charset=utf-8");
  const started = Date.now();
  const log: Record<string, unknown> = { outcome: "unknown" };
  const write = (e: AskEvent) => {
    out.write(ndjson(e));
    if (e.type === "done") Object.assign(log, { outcome: e.status, costUsd: e.costUsd, modelCalls: e.modelCalls, toolCalls: e.toolCalls });
    if (e.type === "error") log.outcome = e.code;
    if (e.type === "rule_failed") log.ruleFailed = e.violations.map((v) => v.rule);
  };

  try {
    const s = await loadSecrets();
    if (!s.turnstileSecret || !s.salt) {
      write(errorEvent("not_live"));
    } else {
      const ip = viewerIp(event.headers ?? {}, event.requestContext?.http?.sourceIp);
      const deps: AskDeps = {
        verifyHuman: (token, viewer) => verifyTurnstile({ secret: s.turnstileSecret!, token, ip: viewer, hostnames: HOSTNAMES }),
        takeRun,
        modelClient: async () => (s.anthropicKey ? anthropicClient({ apiKey: s.anthropicKey, maxTokens: MAX_TOKENS }) : null),
        spentToday,
        addSpend,
        fetchJson: nhtsa,
        salt: s.salt,
        onFailure: (detail) => {
          log.upstream = detail;
        },
      };
      await handleAsk(bodyOf(event), ip, deps, write);
    }
  } catch (e) {
    write(errorEvent("failed"));
    log.error = (e as { name?: string })?.name ?? "Error";
  } finally {
    // One metadata line per request: no question text, no IP, no secret. A failed run adds
    // `upstream` (status, error type, 160 characters of message, key-shaped strings removed).
    console.log(JSON.stringify({ at: new Date().toISOString(), ...log, seconds: Math.round((Date.now() - started) / 100) / 10 }));
    out.end();
  }
});
