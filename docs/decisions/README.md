# Decision records

Why each part of recall-desk is built the way it is. Each record states the decision, quotes the provider
documentation it rests on (with the date read), gives the measurement from this repository, and names the options
rejected and what would change the decision. Numbers carry their sample size; anything not measured says so.

| | Decision | Rests on |
|---|---|---|
| [0001](0001-hand-written-agent-loop.md) | A hand-written agent loop, not a framework | Anthropic: tool use, the tool runner; Claude Agent SDK and Managed Agents overview |
| [0002](0002-strict-submit-answer-checked-by-code.md) | The answer is a strict `submit_answer` tool, checked by rules in code | Anthropic: define tools (forced tool use), strict tool use |
| [0003](0003-recorded-nhtsa-fixtures.md) | Tests and evals run on recorded NHTSA replies | NHTSA's own replies: new recalls on old cars, body styles in prose |
| [0004](0004-lambda-streaming-behind-cloudfront.md) | A Lambda function URL with response streaming, behind CloudFront with origin access control | AWS: Lambda response streaming, CloudFront origin access control for Lambda |
| [0005](0005-cheapest-refusal-first-limits.md) | Limits in layers, cheapest refusal first | Cloudflare Turnstile server-side validation; DynamoDB condition expressions; Anthropic spend limits |
| [0006](0006-chat-history-is-context-not-evidence.md) | Chat history is context for the model, never evidence for the rules | Anthropic: mitigate jailbreaks and prompt injections |
| [0007](0007-no-vector-database-yet.md) | No vector database until retrieval needs one | Anthropic: tool responses with only high-signal information; NHTSA's component field, measured |
| [0008](0008-opus-5-5-at-low-effort.md) | Claude Opus 5.5 at low effort | Anthropic: pricing, effort, refusals and fallback |

How these are written: [AGENTS.md](../../AGENTS.md), rule 8.
