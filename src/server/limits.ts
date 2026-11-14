// The live chat's limits, shared by the server (src/server/ask.ts) and the page, so the page
// can stop a too-long question before sending it. No Node imports here: the page bundles it.

export const CHAT_LIMITS = {
  questionChars: 500,
  turnChars: 2000,
  historyTurns: 6,
  perVisitorPerDay: 5,
  perDay: 40,
  // Dollars of model spend per day, from each run's measured cost: about $9 a month, inside
  // the $10 Anthropic workspace cap (review, 2026-11-14).
  usdPerDay: 0.3,
  // A run hands off after this long, before the 60 s Lambda timeout cuts the stream.
  runMs: 45_000,
} as const;
