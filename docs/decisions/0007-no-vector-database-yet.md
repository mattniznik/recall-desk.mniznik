# 0007. No vector database until retrieval needs one

**Status:** in use since 2026-11-13; first commit pending. Sources read 2026-11-14.

## Decision

`search_complaints` ([src/tools/nhtsa.ts](../../src/tools/nhtsa.ts)) does not search complaint text by meaning. It
fetches one vehicle's complaints from NHTSA, filters them by NHTSA's own component field (SERVICE BRAKES,
STEERING and so on) when the agent asks for one, and returns the total, the count per component (top 8), and the 5
newest matching summaries cut to 300 characters, with ISO dates and no VIN. The agent reports counts and says that
complaints are owners' reports, not proof of a defect.

Embeddings and a vector store come in only if the eval set shows the component filter missing complaints that
matter, measured against keyword search and the filter first.

## Sources

[Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), best practices:

- "**Design tool responses to return only high-signal information.** Return semantic, stable identifiers (for
  example, slugs or UUIDs) rather than opaque internal references, and include only the fields Claude needs to
  reason about its next step. Bloated responses waste context and make it harder for Claude to extract what
  matters."

NHTSA's complaint records carry the classification already: each has a `components` field written by NHTSA, so
"which complaints are about the brakes" is a filter, not a similarity search.

## Evidence (this repository)

Measured on the recorded 2017 Honda Civic complaints (n=606):

| Way to find brake complaints for "grinding brakes" | Complaints found |
|---|---:|
| NHTSA component is SERVICE BRAKES | 37 |
| "BRAKE" anywhere in the components | 38 |
| SERVICE BRAKES complaints whose text contains "grind" | 0 |
| Any complaint whose text contains "grind" | 5, none about the brakes |

The 5 complaints that mention grinding are filed under the engine, the fuel system, the power train, steering and
"unknown or other". Matching the customer's word would have handed the agent 5 complaints about other parts and
missed all 37 about the brakes. The component filter finds them without a model, an index or a second service.

- Size: NHTSA's raw reply for the car is 577,432 bytes; the tool's reply filtered to SERVICE BRAKES is 2,769 bytes
  (n=1), and [test/search-complaints.test.ts](../../test/search-complaints.test.ts) holds every reply under 8 KB.
- The recorded brakes run used it as intended: `search_complaints` with component "brake" returned 38 of 606, and
  the answer called them unverified reports, not recalls ([README Results](../../README.md#results)).

## Rejected

- **A vector database now.** A new service, an embedding model and an index to keep in step with NHTSA, for a
  question the component field already answers. Its cost and setup on AWS are worked out in the sister project's
  [decision 0006](https://github.com/mattniznik/rag.irs.mniznik/blob/main/docs/decisions/0006-cloudflare-not-aws.md).
- **Handing the model all the complaints.** 577,432 bytes for one car, paid for in tokens on every later call in
  the run.
- **Keyword search on the complaint text.** 0 of the 37 brake complaints contain "grind", and the 5 complaints
  that do are about other parts (table above).

## What would change it

The planned retrieval comparison, which needs no model and costs nothing: for each complaint question in the eval
set, does keyword search, the component filter or embedding search return the relevant complaints? If the filter
misses cases the eval marks as relevant and embeddings find them, add embeddings for those cases and show the
measurement on the Evals tab.
