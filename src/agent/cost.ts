// Dollars per model call, from the usage the API returns. Every real run reports its cost
// from this, so the plan's estimate gets replaced by measured numbers.
//
// USD per million tokens, from Anthropic's pricing page (read 2026-11-12): base input,
// 5-minute cache write, cache read, output. A model not listed returns null rather than a
// guess; a server-side fallback can answer on a different model than the one requested.

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

const PER_MTOK: Record<string, { input: number; cacheWrite: number; cacheRead: number; output: number }> = {
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  // Haiku 5.5 prices for prompts up to 100,000 tokens; this agent's prompts stay far below.
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
};

// What the daily budget charges for a model missing from the table: the highest Claude price in
// the claude-api skill's table (Fable 5.1, $10 input and $50 output per million; cache write
// 1.25x and read 0.1x of input). Shown costs stay honest (null = unknown); the budget never
// counts an unknown model as free (security review, 2026-11-14).
const CEILING = { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 };

export function budgetUsd(model: string, u: Usage): number {
  return costUsd(model, u) ?? priced(CEILING, u);
}

export function costUsd(model: string, u: Usage): number | null {
  const p = PER_MTOK[model];
  if (!p) return null;
  return priced(p, u);
}

function priced(p: { input: number; cacheWrite: number; cacheRead: number; output: number }, u: Usage): number {
  const usd =
    (u.input_tokens * p.input +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      u.output_tokens * p.output) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
