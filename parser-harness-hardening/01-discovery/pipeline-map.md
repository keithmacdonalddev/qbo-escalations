# Image parsing pipeline — server-side map

## Entry point

`server/src/routes/image-parser.js`

- `POST /api/image-parser/parse` at `server/src/routes/image-parser.js:134`
- Rate limit: 10 req / 60s per IP, `server/src/routes/image-parser.js:116`
- Same handler serves both JSON and SSE (Accept: text/event-stream or `?stream=1`).
- Validates required `image` and `provider`; rejects unknown providers (`routes/image-parser.js:188-193`).
- Resolves effective prompt id at `routes/image-parser.js:218` via `normalizeImageParsePromptId(promptId || parserPromptId)`.

## Prompt-id normalization

`server/src/services/image-parser.js:74-78` whitelist:
```
image-parser
escalation-template-parser
follow-up-chat-parser
```

`normalizeImageParsePromptId()` at `services/image-parser.js:107-110` returns `DEFAULT_IMAGE_PARSE_PROMPT_ID` (= `image-parser`, the looser dual-role auto-detect prompt) when caller omits or sends an out-of-whitelist value. The chat-side UI (`client/src/components/chat/ImageParserPopup.jsx:30`) explicitly defaults to `escalation-template-parser`, so the looser fallback bites only headless callers or callers that drop the field.

## parseImage()

`server/src/services/image-parser.js:1518`

Order of operations:
1. Resolve system prompt: `getRenderedAgentPrompt(promptId)` — fresh disk read every call. `services/image-parser.js:1521`.
2. Normalize base64, detect media type (PNG/JPEG/GIF/WebP magic bytes). `services/image-parser.js:1533, 824`.
3. Emit `parser.provider_selected` on event bus.
4. Dispatch to one of seven provider call functions based on `provider`. `services/image-parser.js:1581-1605`.
   - `callLmStudio` — `image-parser.js:892`, sets `temperature: 0.1`, `max_tokens: 4096`, `chat_template_kwargs: { enable_thinking: false }`.
   - `callAnthropic` — `image-parser.js:979`, **omits temperature** (defaults to 1.0), `max_tokens: 4096`.
   - `callOpenAI` — `image-parser.js:1032`, uses `applyOpenAiGenerationOptions()` which sets `temperature: 0.1` for non-reasoning models or `max_completion_tokens` + `reasoning_effort` for reasoning ones.
   - `callLlmGateway` — `image-parser.js:1085`, `temperature: 0.1`, `enable_thinking: false`.
   - `callGemini` — `image-parser.js:1142`, **omits temperature**, `responseMimeType: 'text/plain'`.
   - `callKimi` — `image-parser.js:1218`, `temperature: 1` (yes, one — the Moonshot default).
   - `callCodex` — `image-parser.js:1308`, spawns Codex CLI subprocess, optional reasoning effort.
5. Detect role from response text: `detectRole()` at `services/image-parser.js:1368`. Returns `'follow-up-chat'`, `'escalation'`, `'inv-list'`, or `'unknown'`.
6. Build structured parse result `buildStructuredParseResult()` at `services/image-parser.js:1439`. For `escalation` role:
   - `recoverCanonicalTemplateBlock(text)` at `services/image-parser.js:1417` silently rewrites non-canonical output into the canonical shape before validation.
   - `validateCanonicalEscalationTemplateText()` from `server/src/lib/escalation-template-contract.js:47` checks the 9 required labels in order.
   - `parseEscalationText()` / `validateParsedEscalation()` extract semantic fields (category, severity hints).
7. Return `{ text, role, promptId, usage, parseFields, parseMeta, stats }` to the route.
8. Route persists via `persistParseResult` → `ImageParseResult.create` + on-disk image archive (fire-and-forget). `routes/image-parser.js:60`.

## Structured-output enforcement (or lack of it)

Grepping `services/image-parser.js` for `response_format`, `json_schema`, `tool_use`, `tool_choice`, `responseSchema` returns nothing. None of the seven provider call functions in `image-parser.js` request structured output. The only place structured output is requested is the **separate** SDK path at `server/src/services/sdk-image-parse.js:182-185` which uses `outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA }` — see `agents-roster.md` for status of that path.

## Validators

- `server/src/lib/escalation-template-contract.js` — shape check: 9 canonical labels in fixed order, no extra text, no markdown fences.
- `server/src/lib/parse-validation.js` — semantic check: weighted score over `coid`, `mid`, `caseNumber`, `clientContact`, `agentName`, `attemptingTo`, `actualOutcome`, `expectedOutcome`, `tsSteps`, `triedTestAccount`, `category`. Drives `parseMeta.score` / `parseMeta.confidence`.
- Neither validator catches byte-level normalization (e.g. `NA` → `N/A`, capitalisation drift, date reformatting).

## Recovery layers (silent rewrites)

- `recoverCanonicalTemplateBlock()` at `services/image-parser.js:1417-1437` is the main one — it walks any label that matches the canonical set anywhere in the response and rewrites them as line-starts. This converts "Here is the parse: COID/MID: ..." into a clean canonical block. Failure to follow the template looks like a success after this step.
- No regex normalization of values themselves at this layer.

## Persistence

- `server/src/models/ImageParseResult.js` — Mongoose model. Stores `provider`, `model`, `modelRequested`, `image.*`, token usage, `parserPromptId`, `parsedText`, `textLength`, `streamRunId`, `streamEvents`, `streamEventCount`, source image bytes archived to disk under `data/`.
- Reads/listings used by Agent Mission Control under `/api/image-parser/history*` and `/api/agent-identities/escalation-template-parser/chat-sessions`.

## Provider availability cache

`services/image-parser.js:79-87` + `resolveProviderAvailability()` at `1685`. 60s TTL by default, overridable via `IMAGE_PARSER_STATUS_CACHE_TTL_MS`. Not relevant to byte-fidelity, included for completeness.

Last updated: 2026-05-19
