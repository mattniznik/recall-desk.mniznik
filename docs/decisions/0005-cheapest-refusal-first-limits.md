# 0005. Limits in layers, cheapest refusal first

**Status:** in use since 2026-11-14; first commit pending. Sources read 2026-11-14.

## Decision

A live question passes these checks in this order, and each one refuses before anything after it runs
([src/server/ask.ts](../../src/server/ask.ts), limits in [src/server/limits.ts](../../src/server/limits.ts)):

1. **Shape**: a question of 1 to 500 characters, a Turnstile token, and well-formed history.
2. **Bot check**: Cloudflare Turnstile's server-side check, which must succeed for this site's hostname. A network
   error is a "no".
3. **Switched on**: an Anthropic key is present.
4. **The day's dollar budget**: under **$0.30** of model spend so far today (UTC).
5. **The visitor's day**: under **5** questions, counted by a salted SHA-256 of the IP address.
6. **Everyone's day**: under **40** questions.
7. **The model**, with per-run caps: 6 calls, 12 tool calls, 4,000 output tokens per call, a 45-second deadline.

Behind all of it, the live key belongs in an Anthropic workspace with its own monthly spend limit, so a bug in every
layer above still stops there. The counters are single conditional writes in DynamoDB; each run's cost is added to
the day's spend after it ends, even when it failed half way.

Each layer stops a different failure: bots (Turnstile), one person (the visitor count), many people (the daily
count), an expensive mix of questions (the dollar budget), and a bug in all of those (the workspace limit).

## Sources

[Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/):

- "The client-side widget alone does not protect your forms."
- "Validity period: 300 seconds (5 minutes) from generation" and "Single use: Tokens are intended for one
  validation".
- The response's hostname field: "Hostname where the challenge was served". The server compares it with this
  site's hostname, so a token from another page is refused ([src/server/turnstile.ts](../../src/server/turnstile.ts)).

[DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html):

- "To perform a conditional update, you use an `UpdateItem` operation with a condition expression. The condition
  expression must evaluate to true in order for the operation to succeed; otherwise, the operation fails." The
  counter's update is `ADD n 1` on the condition `n < limit` ([src/lambda/handler.ts](../../src/lambda/handler.ts)),
  so two parallel requests cannot both take the last run.

[Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits):

- "When usage reaches a spend limit you set, requests return HTTP 400 with error type `invalid_request_error`. The
  message starts with `You have reached your specified API usage limits`, or `You have reached your specified
  workspace API usage limits` for a workspace limit, and states when access resumes." The server maps that error
  to its budget message instead of a crash.
- The organization's own monthly cap answers differently: "While usage is paused, API requests return HTTP 429",
  and "On the Messages API, `error.details.error_code` is `enforced_spend_limit_reached`. Use it to tell this
  response apart from a rate limit." The server maps that 429 to the budget message too, and any other 429 to
  "busy" ([src/server/ask.ts](../../src/server/ask.ts)).

## Evidence (this repository)

- [test/server-ask.test.ts](../../test/server-ask.test.ts), 12 tests: bad requests are refused before the bot
  check, the counters or the model; a failed bot check, a missing key, the visitor's limit, the global limit and
  a spent budget each stop the run before the model, and the earlier checks take no run from a counter; the
  visitor is counted by a salted hash, never the raw IP; Anthropic's workspace-limit error becomes the budget
  message; each run's cost is added to the day; the tier spend cap's 429 is the budget message while a plain 429
  is "busy". That last test was added after the first version mapped every 429 to "busy", which it fails on.
- Live, 2026-11-14 (n=1): a POST with a fake Turnstile token got one `bot_check` event; the function's log line was
  `{"outcome":"bot_check","seconds":0.5}`.
- Why a dollar budget as well as counts: an independent review of the chat worked out that 40 runs a day at the
  measured cost could spend a $10 month in about 8 days. At the measured mean of $0.0330 per run (n=6), $0.30 a day
  is about 9 runs, and 31 days of it is $9.30, inside a $10 monthly limit (derived).
- Why 4,000 output tokens per call: the largest call in the recorded runs wrote 803 (n=12 calls); the adapter's
  default, 16,000 per call over 6 calls, would allow about $1.92 of output for one question (96,000 tokens at $20
  per million).

## Rejected

- **One limit only.** Each layer above fails differently; any single one leaves one of those failures open.
- **AWS WAF rate rules.** They count HTTP requests, not agent runs, and add a monthly charge per rule set (price
  not checked). The counters here cost a fraction of a cent at this traffic.
- **Reserved concurrency on the function.** Not possible in this account: it allows 10 concurrent runs in all and
  keeps 10 unreserved (`get-account-settings`, 2026-11-14).
- **Giving a visitor's run back when the model is busy.** Accepted as a loss: one of 5 questions, rarely.
- **Checking the budget again during a run.** Not done: a run that starts just under the budget can finish over it
  ([SECURITY.md](../../SECURITY.md), known gaps).

## What would change it

The first weeks of live logs. If the dollar budget is reached most days, or almost never, move it with the measured
cost per run; if the workspace limit is ever the layer that stops a run, a layer above it has a bug.
