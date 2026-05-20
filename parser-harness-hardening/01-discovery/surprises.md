# Surprises and in-progress work

Things noticed during discovery that don't match documentation or look incomplete. Not a defect list — that's `determinism-defects.md`.

## S1 — Agent registry is much larger than the discovery brief implied

The previous research framed this work as around "three parser prompts." `server/src/lib/agent-prompt-store.js:13-137` actually holds 13 frozen prompt definitions plus a dynamic custom-agent slot. The Agent Mission Control UI exposes all visible ones with full read/write/version semantics. Documenting in `agents-roster.md`.

## S2 — Versioning is built, working, and unused

`prompts/versions/agents/` is fully wired up in `server/src/routes/agent-prompts.js`: PUT snapshots the prior content, GET lists/reads snapshots, POST restores. 20-version cap. Audit log to `AgentIdentity.history`. But the on-disk versions directory is empty — no edits have happened via the UI on this checkout. All current prompt history is in git. The infrastructure exists but is dormant.

## S3 — `prompts/versions/agents/` is not gitignored

Verified by grep against `.gitignore`. If somebody uses the UI prompt editor, those snapshots will be tracked by git unless we add a rule. Probably want them gitignored.

## S4 — There is a fully working SDK-based image parse path that the route does not use

`server/src/services/sdk-image-parse.js` uses `@anthropic-ai/claude-agent-sdk` with `outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA }` to enforce structured output. The schema is 11 fields with enums for `category` and `triedTestAccount`. This is the **only** code path that requests structured output anywhere. It is invoked by `services/remote-api-providers.js` for the policy-driven `parseWithPolicy` flow in `services/parse-orchestrator.js`. The `/api/image-parser/parse` route never calls it. So we have two parallel parsing implementations: one route-driven and unstructured, one orchestrator-driven and structured.

## S5 — `chat-orchestrator` flow vs. `image-parser` route flow

Two entry points share the parser providers but reach them differently:
- The chat orchestrator pipeline (`services/chat-orchestrator.js`, `services/parse-orchestrator.js`, `services/remote-api-providers.js`) can use the structured SDK path and has a fallback policy (single / fallback / parallel).
- The image-parser route (`routes/image-parser.js`) is a flat single-provider call with no fallback policy.

The user's stated goal is around the route flow (this is what the chat popup hits). The orchestrator flow is independent and uses more sophisticated harness primitives. There might be ideas to port over.

## S6 — `AGENT-PROFILES/` at the project root is documentation-only

Confirmed: nothing under `server/` or `client/` reads `AGENT-PROFILES/`. The five `.md` files inside (4 INV agent stubs + readme) are aspirational. The `INV-image-parser-agent.md` reads "It always must be 100% accuracy to the original raw image" — same goal as the user's hardening target. The user-facing INV pipeline does not yet exist in code.

## S7 — `image-parser` and `escalation-template-parser` both display in UI under name "Image Parser"

`agent-prompt-store.js:56, 65` — both definitions have `name: 'Image Parser'`. In the Agent Mission Control list they appear as two adjacent rows with the same name and different descriptions. Visually confusing. Probably the strict one should be renamed to something like "Escalation Template Parser" to match the prompt id.

## S8 — The chat popup defaults to the strict prompt, the route defaults to the looser one

`ImageParserPopup.jsx:30` sets `DEFAULT_PARSER_MODE = 'escalation-template-parser'`. `image-parser.js:52` sets `DEFAULT_IMAGE_PARSE_PROMPT_ID = 'image-parser'`. Net effect: every chat-initiated parse uses the strict prompt; every direct-API caller that forgets `promptId` uses the looser one. Asymmetry worth flagging.

## S9 — `AGENT_OPERATION_META` is a hardcoded persona facade

`client/src/components/AgentsView.jsx:84-205` defines `AGENT_OPERATION_META` with fields like "department: 'Intake Reliability'", "owner: 'Maya Patel'", "team: 'Parser Ops'", "trust: 4.8". These are display-only fictional personas — not driven by runtime data. They look real on the agent profile page but they're static. Probably a stylistic choice; flagging because it could confuse a future agent that thinks "department" is a real config field.

## S10 — `enable_thinking: false` set on two providers, not the others

`callLmStudio` and `callLlmGateway` send `chat_template_kwargs: { enable_thinking: false }` (`image-parser.js:948, 1104`). `callAnthropic`, `callOpenAI`, `callGemini`, `callKimi`, `callCodex` do not. For reasoning models this is the right toggle on the OpenAI-compatible providers but inconsistently applied. For OpenAI/Anthropic reasoning models, `reasoning_effort: 'low'` is the equivalent and is applied through `applyOpenAiGenerationOptions` for OpenAI, not for Anthropic. Anthropic extended thinking is not currently disabled at the API call level.

## S11 — Recent commit 0aa1c30 actually was about agent profile routing

Confirmed by reading `client/src/components/AgentsView.jsx:1308-1357` — the `AgentProfileDetailPage` component is the route's render target and supports a per-agent dynamic param. The commit also touched `server/src/routes/image-parser.js`. So "agent profile routing" in the commit message means the per-agent hash route `#/agents/:agentId` that lights up the profile detail page. Aligns with `appRoute.js:67-68`.

Last updated: 2026-05-19
