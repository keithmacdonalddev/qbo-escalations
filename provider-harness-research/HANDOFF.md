# Provider Harness Research Handoff

This document gives a fresh agent or chat session enough context to work on provider-harness research without reading the original discussion.

## Mission

For each provider, document the full response package that reaches this app's server today and the Mongo storage shape needed to preserve that package.

The mission is not to make the response useful yet. The mission is to prove what arrives.

## Deterministic Boundary

Every provider research document must stop at this boundary:

provider path returns package -> app server receives package -> proposed Mongo record preserves package

The provider package may contain a perfect model answer, an empty answer, a bad answer, a hallucination, a structured object, a stream of chunks, stdout text, stderr text, an error payload, metadata, usage counts, or all of those. At this stage, that does not matter.

The only question is:

What exact package reached the server, and what would we need to store to preserve it?

## Hard Stop

Do not design what happens after the package is stored.

Do not design or modify:

- answer extraction
- answer cleanup
- parser validation
- canonical text conversion
- prompt behavior
- retry behavior
- provider fallback behavior
- UI behavior
- routing
- tests
- Mongo models
- production source code

The research document may say current code discards part of the package. It must not decide whether the model's answer inside the package is correct.

## Why This Exists

This application can call model providers through more than one path. Each provider path wraps the provider/model output differently.

Examples:

- A direct API provider may return HTTP status, headers, and JSON.
- A streaming API provider may return ordered events or chunks.
- A CLI provider may return stdout, stderr, and an exit code.
- A local gateway may return its own response while also hiding an upstream provider response.
- An OpenAI-compatible local server may return a familiar response shape even though the provider is not OpenAI.

This folder collects the source-backed facts needed to describe each provider package deterministically.

## Terms

Provider path:

The exact route this app uses to reach a model provider. It may be direct HTTP API, local gateway, SDK, CLI command, spawned process, login-backed local tool, or OpenAI-compatible local server.

Response package:

The full thing returned by that provider path. It may include status code, headers, raw body text, parsed JSON, stream chunks, SDK objects, stdout, stderr, exit code, request ids, usage metadata, timing, and error payloads.

Raw package that reaches this server:

The first observable provider response unit in this app's server code before this app normalizes, extracts, validates, or discards anything.

Preserve:

Store enough of the response package that a developer can inspect what the provider path actually returned. This does not mean the workflow can replay the call perfectly. It means the received package is not lost.

Mongo storage shape:

A proposed provider-specific record that preserves the response package. This is documentation only, not an implementation instruction.

Fact:

Something proven by current source code, current config, command output, or official provider documentation.

Assumption:

Something the agent believes is likely but cannot prove from current source or official documentation. Assumptions must be labeled.

Gap:

Something needed for a complete provider harness contract that current source or official documentation did not prove.

## Provider IDs

Use this provider queue unless current source proves a different app id:

- `anthropic-api`
- `anthropic-cli`
- `openai-api`
- `openai-cli`
- `gemini-api`
- `kimi-api`
- `lm-studio-openai-compatible`
- `llm-gateway`

Provider id meanings:

- `anthropic-api`: direct Anthropic HTTP/API-key path.
- `anthropic-cli`: local command-line, spawned-process, or login-backed local path to Anthropic/Claude for this app.
- `openai-api`: direct OpenAI HTTP/API-key path.
- `openai-cli`: local command-line, spawned-process, or login-backed local path to OpenAI for this app.
- `gemini-api`: direct Google Gemini API path if present in this app.
- `kimi-api`: direct Moonshot/Kimi API path if present in this app.
- `lm-studio-openai-compatible`: local LM Studio path using an OpenAI-compatible response shape.
- `llm-gateway`: local gateway service path used by this app. The document should separate what qbo-escalations receives from what the gateway may receive upstream.

If a provider id does not exist in current source, the provider document should say that directly and list the closest related paths. Do not invent an implementation.

## Handoff Files

Use these files:

- `README.md`: folder summary and quick usage.
- `HANDOFF.md`: this context document.
- `RESEARCH_PLAN.md`: step-by-step operating plan.
- `provider-research-prompt.md`: generic prompt for any provider id.
- `anthropic-cli-prompt.md`: specific prompt for `anthropic-cli`.
- `openai-cli-prompt.md`: specific prompt for `openai-cli`.
- `llm-gateway-prompt.md`: specific prompt for the local `llm-gateway` service and its upstream LM Studio boundary.
- `providers/_template.md`: provider document skeleton.
- `providers/README.md`: rules for completed provider documents.

Write completed research documents here:

- `providers/<provider-id>.md`

## Agent Assignment Pattern

Give one agent exactly one provider id.

The agent should create or update exactly one file:

`provider-harness-research/providers/<provider-id>.md`

The agent should not modify production app code. The agent should not modify prompts for other agents. The agent should not create shared implementation files.

If the agent needs to note uncertainty, it should write that uncertainty in the provider document under `Gaps And Questions`.

## Evidence Standard

Every important claim should point to one of these:

- a source file path and line number in this repo
- a package/config file in this repo
- a command result from the local checkout
- official provider documentation
- a clearly labeled inference from the above

Do not write "the app probably" without labeling it as an assumption.

Do not use old chat context as proof. Re-check the current files on disk.

## Recommended Source Search

Agents should start by searching the current repo for provider ids, command names, SDK clients, environment variables, and gateway endpoints.

Useful search terms:

- `anthropic`
- `claude`
- `openai`
- `codex`
- `gemini`
- `google`
- `kimi`
- `moonshot`
- `lm studio`
- `lm-studio`
- `llm-gateway`
- `chat/completions`
- `responses`
- `messages`
- `stream`
- `spawn`
- `execFile`
- `stdout`
- `stderr`
- `OPENAI_`
- `ANTHROPIC_`
- `CLAUDE_`
- `CODEX_`
- `GEMINI_`
- `KIMI_`

The search is only a starting point. The final document must cite the actual call path and the first raw response object/string/event that reaches the server.

## Completion Criteria

A provider document is complete enough for handoff when it answers:

1. What provider id or ids does this app use?
2. What source path sends the request?
3. What request package does this app send today?
4. What official or documented response package can return?
5. Does this app receive non-streaming responses, streaming responses, or both?
6. What exact raw response package first reaches this server?
7. Does current code preserve or discard the full package?
8. What Mongo record shape would preserve the full package?
9. What facts remain unknown?

If any answer cannot be proven, the document should say so under `Gaps And Questions`.

## Final Reminder

This folder prepares research for a provider harness.

It does not design the provider harness implementation.

It does not decide whether a model response is correct.

It does not process the model answer.
