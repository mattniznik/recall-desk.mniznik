// Helpers between a Lambda function URL event and the chat core. Kept apart from the handler
// so they run in tests without the Lambda runtime.

import type { FetchJson } from "../tools/http.ts";

type Headers = Record<string, string | undefined>;

// CloudFront appends the viewer's address to the end of X-Forwarded-For; entries before it
// were sent by the visitor and can be anything (CloudFront docs, custom origins, "Client IP
// addresses"). Take the last entry, skipping the edge's own address if something after
// CloudFront appended it.
export function viewerIp(headers: Headers, sourceIp?: string): string {
  const entries = (headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  while (entries.length > 1 && entries.at(-1) === sourceIp) entries.pop();
  return entries.at(-1) ?? sourceIp ?? "unknown";
}

export function bodyOf(event: { body?: string; isBase64Encoded?: boolean }): unknown {
  if (!event.body) return undefined;
  try {
    const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// NHTSA's data changes slowly; a warm container answers repeat lookups (the same car asked
// about twice, a comparison followed by a follow-up) from memory. Failures are not cached.
export function cachedFetch(inner: FetchJson, ttlMs = 3_600_000, max = 500, now: () => number = Date.now): FetchJson {
  const cache = new Map<string, { at: number; value: unknown }>();
  return async (url) => {
    const hit = cache.get(url);
    if (hit && now() - hit.at <= ttlMs) return hit.value;
    const value = await inner(url);
    if (cache.size >= max) cache.delete(cache.keys().next().value!);
    cache.set(url, { at: now(), value });
    return value;
  };
}
