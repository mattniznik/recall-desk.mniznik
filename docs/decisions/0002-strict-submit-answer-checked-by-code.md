# 0002. The answer is a strict `submit_answer` tool, checked by rules in code

**Status:** in use since 2026-11-13; first commit pending. Sources read 2026-11-14.

## Decision

Every run ends with the model calling `submit_answer`
([src/agent/answer-schema.ts](../../src/agent/answer-schema.ts)), a tool marked `strict: true` with five required
fields and nothing else allowed:

- `text` - what the customer reads;
- `cited_recall_ids` - every campaign number the text mentions;
- `applies_to_vehicle` - the recalls it says apply to this car;
- `fits` - the catalog part numbers it says fit;
- `handoff` - whether it passes the customer to a person.

`parseAnswer` then checks in code what the schema leaves out: campaign numbers look like `17V706000`, part numbers
like `DP-BRK-F-CIV-HB`, the text is 1 to 4,000 characters, nothing extra is present. Then the six rules in
[src/guards/rules.ts](../../src/guards/rules.ts) check each claim against what the tools returned in this run. A
broken answer goes back as an error `tool_result` listing the reasons; the model gets one retry; after that the
customer is handed to a person.

## Sources

[Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), the forced tool use
table, row "Claude Fable 5.2, Claude Mythos 5.2, Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, and Claude
Mythos 5.1":

- Restriction: "`any` and `tool` return a 400 error".
- What to use instead: "`auto` with strict tool use to guarantee schema-valid tool inputs, or structured outputs
  when you need a response in a fixed JSON shape. Prompting still influences which tool `auto` picks."

[Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use):

- "Setting `strict: true` on a tool definition guarantees Claude's tool inputs match your JSON Schema by
  constraining the model's token sampling to schema-valid outputs".
- "For the supported JSON Schema subset, see JSON Schema limitations." The schema here sticks to types, required
  fields and `additionalProperties: false`, and leaves patterns and lengths to `parseAnswer`, so nothing depends on
  which keywords that subset accepts.

So the tool cannot be forced on this model. The prompt asks for it ("Finish every answer by calling submit_answer
once", [src/agent/prompt.ts](../../src/agent/prompt.ts)), and the loop treats a turn that ends without it as a miss
that uses the one retry.

## Evidence (this repository)

- 38 rule tests ([test/rule-*.test.ts](../../test/)) and 5 schema tests
  ([test/answer-schema.test.ts](../../test/answer-schema.test.ts)). Five came from the eval work: one for an
  answer opening "Don’t drive", with a typographic apostrophe, which read as carrying no warning (the test does
  not match the earlier pattern and does match the fixed one), and four for the tightened `short_without_lookups`
  (450 characters, no code), one of which runs the eval's real Haiku and Sonnet code answers through the rule.
- In the full eval (50 cases, one run each on Haiku 5.5, Sonnet 5.5 and Opus 5.5, Claude Code subscription path),
  the rules sent an answer back in 23 of the 150 runs: 17 were put right on the retry and 6 went to a person after
  a second miss. Every accepted answer that then failed grading was a reply to the off-topic coding request (2 of
  150), which no rule covers ([README Evaluation](../../README.md#evaluation)).
- The eval path checks the answer the same way. Through Claude Code the model reaches `submit_answer` as an MCP
  tool ([src/mcp/session.ts](../../src/mcp/session.ts)), which is not strict there, so `parseAnswer` and the same
  six rules are the only check on it; [test/mcp-session.test.ts](../../test/mcp-session.test.ts) gives the MCP
  session and the loop the same scripted answers and compares the outcomes.
- 6 real runs on Claude Opus 5.5 (n=6, [README Results](../../README.md#results)): all 6 ended in `submit_answer`
  with arguments that parsed; 7 `submit_answer` calls in all, 0 refused for their shape.
- 1 of the 6 was caught by a rule: the 2006 Ford Ranger answer did not open with the "do not drive" warning for
  its 4 "park it" recalls. The reasons went back, the second answer opened with them and passed.
- The rules can only judge what they can read. The Ranger catch works because the warning names campaign numbers
  that `get_recalls` returned in the same run; a free-text answer would have needed the rule to guess which
  recalls the text meant.

## Rejected

- **Free text, read with patterns.** The rules would have to infer from prose which recalls are said to apply and
  which parts are said to fit. The text is still scanned (every campaign number and part number in it must be in
  the structured lists or the run's results), but as a cross-check, not as the source of the claims.
- **Structured outputs (`output_config.format`) for the final answer.** The docs offer it as the other option. Not
  measured here. A tool keeps the answer inside the tool-use protocol, so a refused answer goes back as a
  `tool_result` with `is_error` and the reasons, the same way a failed lookup does.
- **A second model call to judge each answer.** More cost per run, and a judge can be argued with; the rules
  return the same verdict for the same answer every time. A model-graded score for tone may come later, reported
  separately, never deciding what a customer sees.
- **Patterns and lengths inside the strict schema.** Whether strict mode accepts them was not checked; `parseAnswer`
  does the same work in code with a reason the model can act on.

## What would change it

A claim the schema cannot express, such as "this complaint matches your symptom", would need a new field and a new
rule before the agent may make it. If a model change made `submit_answer` misses common, measure structured
outputs against the tool on the eval set.
