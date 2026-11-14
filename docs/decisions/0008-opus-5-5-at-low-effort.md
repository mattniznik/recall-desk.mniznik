# 0008. Claude Opus 5.5 at low effort

**Status:** in use since the first real run, 2026-11-13; kept after the three-model eval comparison of 2026-11-14;
first commit pending. Sources read 2026-11-14.

## Decision

The agent runs on `claude-opus-5-5` with `output_config.effort` set to `low`
([src/agent/anthropic.ts](../../src/agent/anthropic.ts)). Other settings in the same call:

- adaptive thinking with `display: "summarized"`;
- the system prompt marked for caching, because it and the tool definitions repeat on every call in a run;
- server-side refusal fallbacks, `fallbacks: "default"`;
- no `tool_choice`: the model is asked to finish with `submit_answer` and the loop checks that it did
  ([decision 0002](0002-strict-submit-answer-checked-by-code.md));
- the key handed to the client explicitly, never read from `ANTHROPIC_API_KEY`;
- in the live chat, 4,000 output tokens per call ([decision 0005](0005-cheapest-refusal-first-limits.md)).

## Sources

[Pricing](https://platform.claude.com/docs/en/about-claude/pricing), per million tokens:

| Model | Base input | 5m cache writes | Cache hits and refreshes | Output |
|---|---:|---:|---:|---:|
| "Claude Opus 5.5" | "$4 / MTok" | "$5 / MTok" | "$0.20 / MTok" | "$20 / MTok" |

These are the prices in [src/agent/cost.ts](../../src/agent/cost.ts), which prices every call from the usage the
API returns.

[Effort](https://platform.claude.com/docs/en/build-with-claude/effort):

- "Claude Opus 5.5 supports all five effort levels, and `medium` is the default."
- "Adaptive thinking is always on and can't be turned off, so effort is the primary control for how much the model
  reasons and what a request costs. Requests that set `thinking: {"type": "disabled"}` return a 400 error at every
  effort level."
- "`low` | Most efficient. Significant token savings with some capability reduction." Its typical use, from the
  same table: "Simpler tasks that need the best speed and lowest costs, such as subagents".

[Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback):

- "set `fallbacks` to `"default"`, and the API retries a declined request on the fallback model Anthropic
  recommends for its refusal category. For categories with no recommended fallback, the refusal stands." A refusal
  that still stands ends the run in a handoff ([src/agent/loop.ts](../../src/agent/loop.ts)).

## Evidence (this repository)

Two kinds of measurement, on two paths, kept apart: they differ in how the model is reached, in the questions and
in how cost is counted, so their numbers are not compared with each other.

**The production path.** Six real runs through this adapter's API calls, one per kind of question, on the
recorded NHTSA data, priced from the usage the API returned (n=6, [README Results](../../README.md#results)):

| | Value |
|---|---:|
| Runs that ended with an answer passing every rule | 6 of 6 |
| Runs where a rule sent the first answer back | 1 of 6 |
| Cost per run, mean / median | $0.0330 / $0.0190 |
| Cost per run, lowest / highest | $0.0059 / $0.0961 |
| Seconds per run, mean / median | 8.2 / 6.7 |
| Model calls that read the cached prompt prefix (2,826 to 2,828 tokens) | 10 of 12 |
| Largest output of a single call | 803 tokens |

A two-car comparison on live NHTSA data cost $0.0680 in 2 model calls (n=1). Before any run, the plan estimated
$0.12 to $0.16 per run on Opus from list prices; the measured mean is about a quarter of the low end.

**The model comparison.** The 50 eval cases, one run per model, through Claude Code on a subscription at effort
low, Claude Code 2.1.314, 2026-11-14 (n=50 per model, [README Evaluation](../../README.md#evaluation), files in
[web/src/evals/](../../web/src/evals/)). Costs are Claude Code's client-side estimates, not bills.

| | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---:|---:|---:|
| Passed, of 50 | 44 | 46 | 50 |
| Safety warning first, of 4 | 1 | 4 | 4 |
| Cases about a vehicle with a flagged recall where the first answer left out the warning, of 12 | 11 | 2 | 1 |
| ... and the second one too, so the customer went to a person | 5 | 0 | 0 |
| Handed to a person for any reason | 5 | 3 | 0 |
| Wrote code for the off-topic coding request | yes | yes | no |
| Estimated cost per question | $0.0017 | $0.0245 | $0.0500 |
| Wall time, 50 questions | 468.3 s | 408.6 s | 590.9 s |

On this path Opus's estimated cost per question is about 29 times Haiku's ($0.0500 against $0.0017) and about twice
Sonnet's ($0.0245).

## Rejected

- **`medium` effort, the default.** Not measured. `low` is the documented token-saving level, and the rules, not
  the depth of the model's reasoning, are what keep an answer safe: a careless answer is sent back. At `low`, Opus
  passed all 50 eval cases (one run), so the set shows no miss that more reasoning would have to fix.
- **Claude Haiku 5.5.** The cheapest by far, about a twenty-ninth of Opus's estimated cost per question, and it
  passed 44 of 50. Its misses are on the rule this demo exists for: on the 12 cases about a vehicle with a "park
  it" or "park outside" recall, its first answer left out the warning 11 times and its second 5 times, and those 5
  customers were handed to a person. The rule held every time, so no answer without the warning went out, but on 5
  of those 12 cases the customer got a person instead of an answer. It also wrote code for the off-topic request.
- **Claude Sonnet 5.5.** About half of Opus's estimated cost per question, and it passed 46 of 50, with all 4
  safety-first cases right. It handed off 3 customers: twice it ended without calling `submit_answer` (this path
  sends no reminder, the production loop sends one, so these may partly be the harness; not measured), and once it
  claimed a fit the catalog had not confirmed, twice. It also wrote code for the off-topic request, which no rule
  catches ([SECURITY.md](../../SECURITY.md), known gaps).
- **Claude Opus 5.5, kept.** 50 of 50, no handoff, and the only one of the three that declined the coding request.
  The live demo's budget is set for it: $0.30 a day against a measured production mean of $0.0330 per run (n=6,
  [decision 0005](0005-cheapest-refusal-first-limits.md)). A cheaper model that passes as often has not been found.
- **Thinking off.** Not possible on this model (quoted above).
- **Forcing `submit_answer` with `tool_choice`.** Returns a 400 on this model
  ([decision 0002](0002-strict-submit-answer-checked-by-code.md)).

## What would change it

A cheaper model that passes as often. Each model has run the set once, so how much a pass count moves between runs
is not known; a second run of each would show it. Sonnet is the closest: if a rule caught short off-topic answers
and its two no-answer handoffs did not recur with the production loop's reminder, it could match Opus at about half
the estimated cost. Neither has been measured. The comparison runs through Claude Code rather than the production
API path ([README, The eval set](../../README.md#the-eval-set)), and is read with that difference in mind.
