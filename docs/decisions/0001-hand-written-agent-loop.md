# 0001. A hand-written agent loop, not a framework

**Status:** in use since 2026-11-13; first commit pending. Sources read 2026-11-14.

## Decision

The agent loop is plain TypeScript in [src/agent/loop.ts](../../src/agent/loop.ts): call the model, run the tools
it asks for, send the results back, and stop when it calls `submit_answer` or reaches a cap. Two things happen
between steps that a generic loop does not do by itself: every step is written to the trace as it happens, so the
page can stream it, and the answer is checked by the rules in [src/guards/rules.ts](../../src/guards/rules.ts)
before it can leave the loop. The model is reached through a one-function port, `ModelClient`; the Anthropic SDK
sits behind it in [src/agent/anthropic.ts](../../src/agent/anthropic.ts).

Caps, in `LIMITS`: 6 model calls, 12 tool calls, 1 retry shared by a broken answer and a turn without
`submit_answer`. The live chat adds a 45-second deadline. Every way out that is not a checked answer (a cap, a
refusal, the deadline, a second broken answer) ends in a handoff ticket.

## Sources

[Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview):

- "**Client tools** (including user-defined tools and tools with Anthropic-defined schemas, such as `bash` and
  `text_editor`) run in your application. Claude responds with `stop_reason: "tool_use"` and one or more
  `tool_use` blocks. Your code runs the operation and sends back a `tool_result`." All seven tools here are
  client tools: they call NHTSA, the catalog and the handoff queue from the server.
- "To skip writing this round trip yourself, use the tool runner: the SDK runs your tools and sends the results
  back automatically."

[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview):

- "The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code,
  programmable in Python and TypeScript."
- Its built-in tools: "Read, write, edit files, run commands, and search the web".
- Managed Agents, from the same page's comparison: "A hosted agent harness that runs the agent loop, with sessions
  in an Anthropic-managed cloud sandbox or a self-hosted sandbox on your own infrastructure."

## Evidence (this repository)

- The loop is 259 lines including its types, the trace events and the evidence it collects for the rules; the SDK
  adapter is 49. The loop and its tests were written and passing before any model could be called: the
  `ModelClient` port let a scripted fake stand in. When the adapter was added, the loop only gained wider types
  (blocks it does not read, such as thinking, pass through; each model call reports its model and cache usage).
- 13 tests drive the loop with a scripted model ([test/agent-loop.test.ts](../../test/agent-loop.test.ts), 10;
  [test/agent-chat.test.ts](../../test/agent-chat.test.ts), 3): the trace order, one retry then a handoff, the
  model-call cap, the tool-call cap with many tools asked at once, a missing `submit_answer`, a refusal, an
  unknown tool, thinking blocks passed back unchanged, and the deadline.
- On a real run the guard sits where it has to: in the recorded 2006 Ford Ranger run the trace reads model call,
  `get_recalls`, model call, **rule failed** (`safety_warning_first`), model call, answer
  ([web/src/replays/real-safety.json](../../web/src/replays/real-safety.json)).
- The live chat streams the same events the loop emits, one JSON line each, with no translation layer
  ([src/server/ask.ts](../../src/server/ask.ts)).
- For the eval runs, the loop's tool branch is mirrored as an MCP session ([src/mcp/session.ts](../../src/mcp/session.ts)) that imports the loop's `LIMITS` and its evidence
  function `absorb`, and repeats its one retry and its handoff wording; [test/mcp-session.test.ts](../../test/mcp-session.test.ts) gives the session and the loop the same
  scripted model and checks they end the same way. Two things the loop does cannot move into a tool server: the
  model-call cap and the reminder to call `submit_answer`.

## Rejected

- **The SDK's tool runner.** It would run the tools and send results back, and its hooks could probably carry the
  trace and the rules. Not measured. At this size owning the loop was clearer than fitting the retry-with-reasons
  step and the per-step trace into hooks, and the tests needed a fake model at the loop's boundary anyway.
- **The Claude Agent SDK.** It is Claude Code's harness, with tools that read, write and edit files and run
  commands. A public endpoint that answers strangers' questions must not carry those.
- **Managed Agents.** It hosts the loop and a per-session sandbox this job does not need; the tools are three HTTP
  calls and a JSON file.
- **A general agent framework.** A new dependency to save a few hundred lines, and the rules would then run
  wherever the framework allows rather than exactly between the model's answer and the customer.

## What would change it

More tools than one prompt can hold, long sessions that need context management, or a second agent. Then measure
the SDK's tool runner with the same rules in its hooks against this loop's tests and the eval set.
