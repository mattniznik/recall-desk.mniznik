// The small pieces between Lambda and the chat core: who the visitor is, what they sent,
// NHTSA answers cached for the container's life, and Cloudflare's bot check.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, cachedFetch, viewerIp } from "../src/lambda/request.ts";
import { verifyTurnstile } from "../src/server/turnstile.ts";

test("the viewer IP is the one CloudFront appended, not one the visitor wrote", () => {
  // CloudFront appends the viewer's address to the end of X-Forwarded-For (CloudFront docs,
  // custom origins, Client IP addresses). Anything before it came from the visitor.
  assert.equal(viewerIp({ "x-forwarded-for": "198.51.100.9" }, "64.252.1.1"), "198.51.100.9");
  assert.equal(viewerIp({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 198.51.100.9" }, "64.252.1.1"), "198.51.100.9");
  // If something after CloudFront appended the edge's own address, skip it.
  assert.equal(viewerIp({ "x-forwarded-for": "1.2.3.4, 198.51.100.9, 64.252.1.1" }, "64.252.1.1"), "198.51.100.9");
  assert.equal(viewerIp({}, "64.252.1.1"), "64.252.1.1");
});

test("the body is read as JSON, base64 or not, and garbage becomes undefined", () => {
  const json = JSON.stringify({ question: "hi" });
  assert.deepEqual(bodyOf({ body: json }), { question: "hi" });
  assert.deepEqual(bodyOf({ body: Buffer.from(json).toString("base64"), isBase64Encoded: true }), { question: "hi" });
  assert.equal(bodyOf({ body: "{not json" }), undefined);
  assert.equal(bodyOf({}), undefined);
});

test("NHTSA answers are cached for the container's life, up to the TTL", async () => {
  let calls = 0;
  let t = 0;
  const f = cachedFetch(
    async (url) => {
      calls++;
      return { url };
    },
    1000,
    10,
    () => t,
  );
  await f("https://api.nhtsa.gov/a");
  await f("https://api.nhtsa.gov/a");
  assert.equal(calls, 1);
  t = 1001;
  await f("https://api.nhtsa.gov/a");
  assert.equal(calls, 2);
});

test("a failed NHTSA call is not cached", async () => {
  let calls = 0;
  const f = cachedFetch(async () => {
    calls++;
    throw new Error("NHTSA answered 503");
  });
  await assert.rejects(f("https://api.nhtsa.gov/b"));
  await assert.rejects(f("https://api.nhtsa.gov/b"));
  assert.equal(calls, 2);
});

function fakeFetch(reply: unknown, sent: { body?: string } = {}) {
  return (async (_url: string, init?: RequestInit) => {
    sent.body = String(init?.body);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply));
  }) as typeof fetch;
}

test("Turnstile: a success for our hostname passes, and the form carries secret, token and IP", async () => {
  const sent: { body?: string } = {};
  const ok = await verifyTurnstile({ secret: "s3cret", token: "tok", ip: "198.51.100.9", hostnames: ["recall-desk.mniznik.com"], fetchImpl: fakeFetch({ success: true, hostname: "recall-desk.mniznik.com" }, sent) });
  assert.equal(ok, true);
  const form = new URLSearchParams(sent.body);
  assert.deepEqual([form.get("secret"), form.get("response"), form.get("remoteip")], ["s3cret", "tok", "198.51.100.9"]);
});

test("Turnstile: failure, another hostname, or a network error all refuse", async () => {
  const base = { secret: "s", token: "t", ip: "198.51.100.9", hostnames: ["recall-desk.mniznik.com"] };
  assert.equal(await verifyTurnstile({ ...base, fetchImpl: fakeFetch({ success: false, "error-codes": ["invalid-input-response"] }) }), false);
  assert.equal(await verifyTurnstile({ ...base, fetchImpl: fakeFetch({ success: true, hostname: "evil.example" }) }), false);
  assert.equal(await verifyTurnstile({ ...base, fetchImpl: fakeFetch(new Error("network down")) }), false);
});
