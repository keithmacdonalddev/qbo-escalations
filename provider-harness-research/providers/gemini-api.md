# gemini-api Provider Harness Contract

## Current-state correction — 2026-07-21

This section is the current Gemini contract. The older research snapshot below is retained as historical evidence and its old model IDs, line numbers, request shapes, and “current” wording are superseded by this section.

- Current default: `gemini-3.6-flash`. Other current choices: `gemini-3.5-flash`, `gemini-3.5-flash-lite`, and `gemini-3.1-pro-preview`.
- Google lists Gemini 3.6 Flash and Gemini 3.5 Flash as separate current stable choices: 3.6 is the balanced default, while 3.5 is positioned for sustained frontier agentic and coding work. Gemini 3.5 Flash-Lite replaces Gemini 3.1 Flash-Lite.
- The app still uses the supported `generateContent` REST surface. Chat, image parsing, triage, and the key-validation probe now use the current default where a model is not explicitly selected.
- Current Gemini reasoning control is `generationConfig.thinkingConfig.thinkingLevel`. The app normalizes its shared effort selection to supported Gemini levels and does not send `minimal` to Gemini 3.1 Pro Preview.
- Beginning with Gemini 3.6 Flash and Gemini 3.5 Flash-Lite, `temperature`, `topP`, and `topK` are deprecated and may produce errors. All current app Gemini paths omit those fields.
- Current catalog metadata records a 1,048,576-token input context and 65,536-token maximum output for these choices. Pricing records use the 2026-07-21 paid-tier rates: Gemini 3.6 Flash at $1.50 input / $7.50 output per million tokens, Gemini 3.5 Flash at $1.50 / $9, and Gemini 3.5 Flash-Lite at $0.30 / $2.50.

Primary sources: [Gemini latest models](https://ai.google.dev/gemini-api/docs/generate-content/latest-model), [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations), and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Historical research snapshot (superseded by the correction above)

### Original summary

- **Provider path type**: direct Google Gemini Developer API path over HTTPS, authenticated by API key in an `x-goog-api-key` request header. No SDK; raw `https.request` from Node.
- **Current implementation status**: this app exposes the runtime provider id `gemini` (catalog id, transport id, registry id all `gemini`). The research file id `gemini-api` is only this document's workstream label, not a runtime provider id.
- **Full package preservation status**: implemented through `server/src/services/providers/gemini-api-provider-harness.js` plus `ProviderCallPackage.geminiApi`. The harness receives a caller-provided Gemini request body, sends it to `generativelanguage.googleapis.com`, records the full structural request/response package, and returns only provider trace metadata. The image-parser caller owns the prompt and reads the saved Gemini response from Mongo before interpreting answer text.
- **Implemented capture surfaces**: image parsing (`image-parser:callGemini`), workspace chat (`remote-api-providers:requestGeminiChat`), and provider-key validation (`image-parser:validateRemoteProvider:gemini`) now save Gemini-specific packages with request headers/body, inline-image metadata, response headers/body chunks/body text/parsed JSON, `responseId`, `modelVersion`, `promptFeedback`, `usageMetadata`, and Google error details.
- **Main uncertainty**: official Gemini Developer API documentation does not publicly enumerate a guaranteed HTTP correlation header, does not publicly document rate-limit response headers, and the exact runtime-observed Gemini header/error variants are not captured by current code (`res.headers` is never read). Until a harness records `res.headers` and the unparsed body, the runtime shape of those parts of the package remains uninspected.

## Provider IDs In This App

- **Exact app id**: `gemini`
- **Aliases / catalog ids**: none. There is exactly one catalog entry. (Note: `server/test/image-parser-comprehensive.test.js:451` references a string `'google-gemini'` inside an "invalid provider" rejection test — this is *not* a real provider id, just a negative-test input.)
- **Research label**: `gemini-api` (this document's filename). The in-app id is `gemini`; `gemini-api` is only the research workstream label.
- **UI labels**: `"Google Gemini API"` (long), `"Gemini"` (short). Source: `shared/ai-provider-catalog.json:136-137`.
- **Catalog transport**: `"gemini"` at `shared/ai-provider-catalog.json:141`.
- **Pipeline-test label**: `"Gemini"` at `server/src/routes/pipeline-tests.js:70`.
- **Image-parser display label**: `"Gemini"` returned by `getRemoteProviderLabel('gemini')` at `server/src/services/image-parser.js:335-336`.
- **PROVIDER_CONFIG display name**: `"Gemini API"` at `server/src/services/remote-api-providers.js:39`.
- **Env var**: `GEMINI_API_KEY`. Declared at `server/.env.example:38`; mapped in `server/src/services/image-parser.js:170` and `server/src/services/remote-api-providers.js:38`.
- **Per-kind timeout env vars**: `GEMINI_TRANSCRIBE_TIMEOUT_MS`, `GEMINI_PARSE_TIMEOUT_MS`, `GEMINI_CHAT_TIMEOUT_MS` (`server/src/services/providers/registry.js:90-95`). None set in `.env.example`.
- **Optional feature flag**: `ENABLE_GEMINI_IMAGE_PARSER` is listed among env vars tracked by the harness test-runner at `server/src/services/test-runner.js:78`.
- **Default model**: `gemini-3.6-flash` in the provider catalog, image parser, chat adapter, provider harness, pipeline tests, and validation probe.
- **Base URL constant**: `https://generativelanguage.googleapis.com` at `server/src/services/remote-api-providers.js:37`.

There is no `gemini-api` id in the catalog. The transport string in the registry is also `gemini` (`server/src/services/providers/registry.js:52-53`).

## Current App Call Sites

All facts; line numbers verified against the current `master` HEAD.

### 1. Image-parser direct path

- `server/src/services/image-parser.js` — `async function callGemini(systemPrompt, rawBase64, mediaType, model, reasoningEffort, timeoutMs)`.
  - Resolves the API key via `resolveApiKey('gemini')` (`image-parser.js:1185`), which checks `data/image-parser-keys.json` first, then `process.env.GEMINI_API_KEY`, then a Mongo `ImageParserApiKey` doc (`image-parser.js:239-266`).
  - Builds a single-turn body with `system_instruction.parts[0].text` and a single `contents[0]` user message whose `parts` array contains a `{ text: 'Parse this image.' }` part plus an `{ inline_data: { mime_type, data } }` part.
  - Sends `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` via the in-module `jsonRequest()` helper (`image-parser.js:754-784`). Path uses `encodeURIComponent(effectiveModel)`. Auth header `x-goog-api-key`.
  - Treats anything other than HTTP 200 as a hard error, throwing `Error('Gemini API error (HTTP N): ...')` with `err.code = 'PROVIDER_ERROR'` (`image-parser.js:1224-1228`).
  - Parses the body with `JSON.parse`; on parse failure throws `'PROVIDER_ERROR'` (`image-parser.js:1230-1237`).
  - Pulls `parsed.candidates?.[0]?.content?.parts[].text` joined with `\n` for the answer text; usage is `{ model: parsed.modelVersion || effectiveModel, inputTokens: usageMetadata.promptTokenCount, outputTokens: usageMetadata.candidatesTokenCount ?? max(totalTokenCount - promptTokenCount, 0) }` (`image-parser.js:1239-1252`).
  - **Returns only**: `{ text: text.trim(), usage }`. Original `res.body` string, `res.statusCode`, response headers, `parsed.responseId`, `parsed.promptFeedback`, `safetyRatings`, `finishReason`, `citationMetadata`, any candidates beyond index 0, and per-modality token detail arrays are all dropped on the floor.

- `server/src/services/image-parser.js:1624-1625` — switch-case wiring inside the main `parseImage` pipeline. When the requested provider is `'gemini'`, `callGemini(...)` is invoked. Gemini has no SDK path in this app.

- `server/src/services/image-parser.js:1751-1752` — startup/health check calls `validateRemoteProvider('gemini', geminiKey)` to populate provider availability.

### 2. Chat/workspace direct path

- `server/src/services/remote-api-providers.js:540-609` — `function requestGeminiChat({ messages, systemPrompt, model, timeoutMs, requestFn, getApiKeyFn })`.
  - Same key resolution (`getImageParserApiKey('gemini')` via `getApiKey` at line 549).
  - Builds a text-only body: `{ system_instruction?: { parts: [{ text }] }, contents: [{ role: 'user'|'model', parts: [{ text }] }, ...], generationConfig: { maxOutputTokens: DEFAULT_MAX_TOKENS, responseMimeType: 'text/plain' } }` (`remote-api-providers.js:557-569`). Images are intentionally not included — `buildGeminiContents` (line 310-315) flattens content via `normalizeMessages → contentToText`.
  - Role mapping: assistant messages become `role: 'model'` (Gemini's name for the assistant role); everything else becomes `role: 'user'`.
  - POSTs to `/v1beta/models/{encodedModel}:generateContent` via the in-module `jsonRequestCancelable` (`remote-api-providers.js:81-147`), a cancellable variant of the same `https.request` pattern. Accumulates the full body string and resolves `{ statusCode, body }` (line 113-117). Auth header `x-goog-api-key` (line 577).
  - Non-200 → throws `PROVIDER_ERROR` via `toStatusError('gemini', ...)` (line 584-586).
  - On success, `extractGeminiText(parsed)` (line 215-220) joins every `candidates[0].content.parts[].text` value; usage object same shape as the image-parser path (line 595-606).
  - Returns `{ text, usage }`. Same dropping of raw body/headers/statusCode as path #1.
  - `reasoningEffort` is normalized to Gemini's supported `thinkingLevel` values and sent as `generationConfig.thinkingConfig`. The catalog advertises thinking support.

- `server/src/services/remote-api-providers.js:679-680` — exports `gemini = { chat: createBufferedChatProvider('gemini', requestGeminiChat) }`.
- `createBufferedChatProvider` (line 611-665) wraps the promise and surfaces results via `onChunk`/`onDone`/`onError` callbacks. There is no actual streaming — `onChunk` is called once with the full text right before `onDone`. Buffer-then-fire, not real SSE.
- `server/src/services/providers/registry.js:52-53` — `case 'gemini': return remoteApiProviders.gemini;`. This is what the workspace/chat routes hit when a user picks the Gemini model from the dropdown.

### 3. Key-validation probe (admin "test API key" button)

- `server/src/services/image-parser.js:219-231` — `REMOTE_PROVIDER_TEST_CONFIGS.gemini`:
  - hostname `generativelanguage.googleapis.com`
  - path `/v1beta/models/gemini-3.6-flash:generateContent` (current default hardcoded in the validation URL)
  - body `{ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1, responseMimeType: 'text/plain' } }`
  - headers `x-goog-api-key`, `Content-Type: application/json`
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey(provider, apiKey)` constructs the minimal request and POSTs it, accumulating the body string and resolving `{ statusCode, body, model }`.
- `server/src/services/image-parser.js:516-659` — `validateRemoteProvider(...)` interprets the result: 2xx → `available: true`, 401/403 → `INVALID_KEY`, timeout → `TIMEOUT`, else `PROVIDER_TEST_FAILED`.
- This path also discards the response body string after a quick `JSON.parse` to extract `error.message`.

### Transport summary

All three production call sites use Node's built-in `https.request` directly (no `fetch`, no `axios`, no `@google/generative-ai` SDK, no Vertex SDK). Endpoint is always `generativelanguage.googleapis.com` (the Gemini Developer API), never the Vertex AI endpoint.

## Request Package Sent Today

Inferred from current app code at the call sites above. All three paths share:

- **Method**: `POST`
- **Scheme/host**: `https://generativelanguage.googleapis.com`
- **Path**: `/v1beta/models/{model}:generateContent` (path includes the model id, URL-encoded in the production paths; current default `gemini-3.6-flash` in the probe).
- **Auth header**: `x-goog-api-key: <GEMINI_API_KEY>` (env var name only; no secret values quoted). Note: Google also supports `?key=...` query-string auth; this app uses the header form.
- **Content type**: `Content-Type: application/json` (probe and image-parser paths set this explicitly; chat path's `jsonRequestCancelable` sets `Accept: application/json` + `Content-Type: application/json` by default).
- **Content-Length**: computed from `Buffer.byteLength(payload)` (`image-parser.js:767`, `remote-api-providers.js:104-106`).
- **Timeout**: socket-level `timeout` option on the `https.request` options object. Source values:
  - Image-parser default `DEFAULT_TIMEOUT_MS = 120000` (`image-parser.js:57`); per-call override possible.
  - Chat-leg default `DEFAULT_TIMEOUT_MS = 120_000` (`remote-api-providers.js:12`); per-kind overrides via env vars `GEMINI_CHAT_TIMEOUT_MS`, `GEMINI_PARSE_TIMEOUT_MS`, `GEMINI_TRANSCRIBE_TIMEOUT_MS` (`registry.js:90-95`).
  - Validation probe hardcoded to `10_000` ms (`image-parser.js:498`).
- **No streaming.** None of the request URLs use `:streamGenerateContent` and none append `?alt=sse`.
- **No tools, no `responseSchema`, no `safetySettings`, no `cachedContent`, no `temperature`, no `topP`, no `topK`.** `thinkingConfig.thinkingLevel` is included only when the selected app effort maps to a supported Gemini level.

Mode A — Image-parser (vision, `callGemini`):

```
body = {
  system_instruction: { parts: [{ text: <systemPrompt> }] },
  contents: [{
    role: 'user',
    parts: [
      { text: 'Parse this image.' },
      { inline_data: { mime_type: <mediaType>, data: <rawBase64> } }
    ]
  }],
  generationConfig: {
    maxOutputTokens: 4096,
    responseMimeType: 'text/plain',
    thinkingConfig: { thinkingLevel: <normalized level> } // when valid
  }
}
```

Notes:
- `mime_type` is autodetected from base64 magic numbers if no data-URL prefix is supplied (`image-parser.js:808-844`); valid values produced: `image/png`, `image/jpeg`, `image/gif`, `image/webp` (PNG fallback).
- Image data sent inline as base64 inside the JSON body — no `file_data` / Files API usage. This means request bodies for image parses can be several MB.

Mode B — Chat (text-only, `requestGeminiChat`):

```
body = {
  // system_instruction included only when systemPrompt is non-empty
  system_instruction: { parts: [{ text: <systemPrompt> }] },
  contents: [
    { role: 'user'|'model', parts: [{ text: <message text> }] },
    ...
  ],
  generationConfig: {
    maxOutputTokens: 4096,
    responseMimeType: 'text/plain',
    thinkingConfig: { thinkingLevel: <normalized level> } // when valid
  }
}
```

Notes:
- All content blocks are coerced down to strings — image blocks would be discarded if passed in. Consistent with the catalog entry (no `supportsImageInput: true`).
- `reasoningEffort` is normalized and sent as `thinkingLevel` when valid.

Mode C — Validation probe:

```
body = {
  contents: [{ parts: [{ text: 'hi' }] }],
  generationConfig: { maxOutputTokens: 1, responseMimeType: 'text/plain' }
}
```

Used only to confirm a key authenticates. URL has the model hardcoded; no `system_instruction`; no `role` on the content (defaults to `user` per the API).

## Official Response Package

Source: Google Gemini Developer API REST reference (`ai.google.dev`). Citations in Evidence.

### Non-streaming success (HTTP 200)

Top-level `GenerateContentResponse` fields (per `ai.google.dev/api/generate-content`):

- `candidates` — array of `Candidate` objects (one per requested candidate; default is 1 unless `generationConfig.candidateCount > 1`).
- `promptFeedback` — feedback on the input prompt. Object with `blockReason` (enum: `SAFETY` | `BLOCKLIST` | `PROHIBITED_CONTENT` | `IMAGE_SAFETY` | `OTHER`) and `safetyRatings[]`.
- `usageMetadata` — token-usage statistics; see below.
- `modelVersion` — string. The exact model variant that generated the response (may differ from the requested alias).
- `responseId` — string. Unique id for the response (canonical correlation id at the body level).
- `modelStatus` — current operational status of the model (rarely populated for normal responses).

Per-candidate fields (per `ai.google.dev/api/generate-content`):

- `content` — `Content` object with `parts[]` (each part may contain `text`, `inlineData`, `functionCall`, `functionResponse`, `executableCode`, `codeExecutionResult`, `thought`, etc.) and `role` (typically `"model"` on the response side).
- `finishReason` — enum string. See note below; store as free-form string.
- `finishMessage` — string. Optional human-readable elaboration of why the candidate finished.
- `safetyRatings` — array of `{ category, probability, blocked?, severity? }` objects.
- `citationMetadata` — `{ citationSources: [{ startIndex, endIndex, uri, license }] }`.
- `tokenCount` — integer tokens used for this candidate.
- `groundingAttributions` — array; legacy/grounding citation attributions.
- `groundingMetadata` — object; populated when search-grounding is enabled (not used in this app).
- `avgLogprobs` — number. Average log-probability across the candidate.
- `logprobsResult` — object. Per-token log-probability output when `responseLogprobs` is requested.
- `urlContextMetadata` — object. Populated when the URL-context tool is enabled.
- `index` — position in the candidates array.

`finishReason` handling: the enum is documented on Google's GenerateContent reference page (`ai.google.dev/api/generate-content#FinishReason`). Examples of values that have appeared in the documented enum include `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `OTHER`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`, and `IMAGE_SAFETY`. The full enum can be extended by Google without notice, so the Mongo shape must preserve `finishReason` verbatim as a free-form provider string. The preservation record must not enforce or validate against any enum list; preservation here is about audit fidelity, not parser validation.

`usageMetadata` fields (per `ai.google.dev/api/generate-content`):

- `promptTokenCount` — total tokens in the prompt (includes cached content).
- `cachedContentTokenCount` — tokens served from cached context (only when `cachedContent` is used).
- `candidatesTokenCount` — total tokens across all candidates.
- `toolUsePromptTokenCount` — tokens spent on tool-use prompts.
- `thoughtsTokenCount` — tokens spent on thinking (for thinking-capable models).
- `totalTokenCount` — `promptTokenCount + candidatesTokenCount` (plus thoughts when applicable).
- `promptTokensDetails[]` — per-modality breakdown: `[{ modality: 'TEXT'|'IMAGE'|'AUDIO'|'VIDEO'|'DOCUMENT', tokenCount }]`.
- `cacheTokensDetails[]` — per-modality breakdown of cached tokens.
- `candidatesTokensDetails[]` — per-modality breakdown of response content tokens.
- `toolUsePromptTokensDetails[]` — per-modality breakdown of tool-use prompt tokens.

### Response headers

- The Gemini Developer API documents the body-level `responseId` field as the response identifier (see `ai.google.dev/api/generate-content`). It is part of `GenerateContentResponse`, not an HTTP header.
- This research did not find a publicly guaranteed Gemini HTTP correlation header. No header is documented by `ai.google.dev` as the canonical request/response correlation id for `generativelanguage.googleapis.com`.
- Current app code (`server/src/services/image-parser.js:769-773` and `server/src/services/remote-api-providers.js:113-117`) reads `res.statusCode` and the accumulated body string but does **not** read `res.headers`. All response headers are discarded before any later app logic sees them.
- Rate-limit headers are not publicly documented for `generativelanguage.googleapis.com`. The API surfaces quota information through 429 responses and through structured `error.details[]` payloads (e.g. `google.rpc.QuotaFailure`, `google.rpc.RetryInfo`) inside the JSON body. Flagged in Gaps.
- The preservation shape should store all response headers verbatim from the true raw boundary (`res.headers`) even though current helpers discard them before the caller sees the response.

### Error responses

HTTP status codes explicitly documented at `ai.google.dev/gemini-api/docs/troubleshooting`:

| status | `error.status` enum |
|---|---|
| 400 | `INVALID_ARGUMENT` (malformed request) or `FAILED_PRECONDITION` (e.g. free tier unavailable in region) |
| 403 | `PERMISSION_DENIED` (covers API-key permission errors) |
| 404 | `NOT_FOUND` |
| 429 | `RESOURCE_EXHAUSTED` (quota / rate limit) |
| 500 | `INTERNAL` |
| 503 | `UNAVAILABLE` |
| 504 | `DEADLINE_EXCEEDED` |

Not in the Gemini troubleshooting table but observed as local-code-handled status (inference, labeled): the standard Google API error model (AIP-193) defines an `UNAUTHENTICATED` (`code: 16`) status that maps to HTTP `401` per Google's standard code mapping. Local app code in `server/src/services/image-parser.js:516-659` treats both `401` and `403` as `INVALID_KEY` in `validateRemoteProvider(...)`. This is app behavior; the Gemini troubleshooting page itself documents key-permission errors under `403 PERMISSION_DENIED`, not under `401`. The Mongo shape must therefore preserve the raw `statusCode` and the raw `error.status` string as received, without assuming any specific status mapping.

JSON error body shape (standard Google API error per AIP-193):

```
{
  "error": {
    "code": 429,
    "message": "Resource has been exhausted ...",
    "status": "RESOURCE_EXHAUSTED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "RATE_LIMIT_EXCEEDED",
        "domain": "googleapis.com",
        "metadata": { ... }
      }
      // additional typed payloads: QuotaFailure, RetryInfo, Help, LocalizedMessage, BadRequest, etc.
    ]
  }
}
```

Note: `error.details` is an array of `google.protobuf.Any`-typed entries; the `@type` URL distinguishes them. `RetryInfo` (`type.googleapis.com/google.rpc.RetryInfo`) carries a `retryDelay` (seconds + nanos) for 429/503 responses and is part of the provider error package.

### Streaming response (`:streamGenerateContent?alt=sse`)

Not currently used by this app (confirmed via grep — see Streaming section), documented for completeness.

Wire format with `?alt=sse`: Server-Sent Events.

- `Content-Type: text/event-stream`.
- Each event is a single `data: <json>` line followed by a blank line. The JSON payload is a **full `GenerateContentResponse` object** containing a partial `candidates[0].content.parts[]` slice — not a delta. Successive chunks may also include incremental `usageMetadata` and `promptFeedback` updates.
- The stream terminates by closing the connection after the last chunk; the last chunk contains the final `finishReason` and the cumulative `usageMetadata`.
- Without `?alt=sse`, `:streamGenerateContent` returns a **JSON array** streamed incrementally (newline-delimited JSON objects in array form).

Final response reconstruction: concatenate each chunk's `candidates[i].content.parts[].text` in order to rebuild the full answer. Take `usageMetadata` and `finishReason` from the final chunk.

## Streaming vs Non-Streaming

**This app currently uses non-streaming for all direct-API Gemini calls.** Verified via `Grep` over `server/src/services/remote-api-providers.js` for `stream` (no matches) and inspection of `callGemini` and `requestGeminiChat` URL paths (no `:streamGenerateContent`, no `alt=sse`).

Notes:

- The `createBufferedChatProvider` wrapper (`remote-api-providers.js:611-665`) simulates a "stream" for downstream callers by emitting one `onChunk` with the full text right before `onDone`. This is buffer-then-fire, not a real SSE stream. The wire request is non-streaming.
- The catalog advertises thinking support. The current buffered transport reports reasoning activity but does not stream Gemini thought text to the UI.
- Because the app does not use streaming today, no ordered stream events are captured. Gemini streaming is provider-capability reference only in this document.

## Raw Package That Reaches This Server Today

For all three direct-API call sites the same two-layer boundary exists:

- True raw boundary: the Node `http.IncomingMessage` (`res`) inside the request callback. At this point the server can still see `res.statusCode`, `res.statusMessage`, `res.headers`, `res.rawHeaders`, `res.httpVersion`, and ordered body chunks from `res.on('data', chunk => ...)`.
- Helper-normalized boundary: after `res.on('end')`, the helper resolves a smaller object. The two model-call helpers resolve `{ statusCode, body }`; the validation probe resolves `{ statusCode, body, model: cfg.model }`.

Exact variable names from source:

- `server/src/services/image-parser.js:769-773` — inside `jsonRequest`:
  ```
  const req = transport.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
  });
  ```
  - `res` is the `http.IncomingMessage`, the true raw boundary.
  - `data` is the accumulated body string.
  - The resolved helper object is `{ statusCode, body }` — `body` is the unparsed JSON text exactly as sent over the wire.
- `server/src/services/remote-api-providers.js:108-117` — same pattern inside `jsonRequestCancelable`.
- `server/src/services/image-parser.js:499-503` — same pattern inside `testRemoteProviderKey`.

At the call site, the helper-normalized object is bound to `const res = await jsonRequest(...)` (image-parser path) or `const response = await request.promise` (chat path). So **`res.body`** / **`response.body`** is the helper-normalized raw response string. It is not the complete raw HTTP package because headers, raw header order, status message, HTTP version, and chunk boundaries have already been discarded.

### What is preserved vs discarded today

Preserved through the immediate helper:

- `res.statusCode` — survives as far as the call site, where it is checked but not stored.
- `res.body` — the full unparsed JSON string. The call site uses up to 500 chars of it in error messages, then `JSON.parse`s it and only keeps `parsed.candidates[0].content.parts[].text` (joined), `parsed.modelVersion`, and selected `parsed.usageMetadata` numeric fields.

The helper boundary preserves only `{ statusCode, body }` (`image-parser.js:769-773`, `remote-api-providers.js:113-117`). Response headers are not captured today; preserving the full HTTP package requires capturing `res.headers` at the true raw boundary before the helper resolves.

Discarded (currently never escapes the helper):

- **All response headers**, including `content-type`, any Google-frontend correlation headers. The `res.on('end', ...)` callback resolves only `{ statusCode, body }` — `res.headers` is never captured.
- `parsed.responseId` — the canonical body-level correlation id. Fully discarded.
- `parsed.promptFeedback` — including `blockReason` and `safetyRatings`. Discarded.
- `parsed.candidates[0].finishReason` — discarded. (A `SAFETY` or `MAX_TOKENS` finish would silently look like a successful response with truncated/empty text.)
- `parsed.candidates[0].safetyRatings` — discarded.
- `parsed.candidates[0].citationMetadata` — discarded.
- `parsed.candidates[0].tokenCount` — discarded (only the aggregate `usageMetadata` numbers are kept).
- Every candidate past index 0 — discarded. Default `candidateCount` is 1 so this is rarely material today.
- `usageMetadata.cachedContentTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount`, `promptTokensDetails`, `cacheTokensDetails`, `candidatesTokensDetails`, `toolUsePromptTokensDetails` — discarded by the `{ model, inputTokens, outputTokens }` shape.
- Error response body details (`error.code`, `error.status`, `error.details[]`) — only `error.message` is surfaced into a thrown Error.message during validation; for `callGemini` / `requestGeminiChat`, only the first 500 chars of the raw body appear in the thrown `Error.message` and even that is later truncated by callers.

There are no SSE chunks today because no path opts into streaming.

## Proposed Mongo Storage Shape

Goal: preserve the full HTTPS response package for the direct `POST /v1beta/models/{model}:generateContent` call, sufficient for later inspection/correlation. Field naming below is suggestive only. Required vs Optional is from the perspective of "does omitting this lose audit value".

### Required fields

- `provider` — `"gemini"` (matches catalog id).
- `transport` — `"gemini"` (matches catalog transport).
- `callerSite` — one of `"image-parser"`, `"chat"`, `"validation-probe"`. Identifies which code path made the call.
- `requestStartedAt` — ISO timestamp captured immediately before `req.end()`.
- `requestFinishedAt` — ISO timestamp captured at the `res.on('end')` resolve.
- `durationMs` — elapsed time between `requestStartedAt` and `requestFinishedAt`.
- `request`:
  - `method` — `"POST"`.
  - `url` — full URL string: `https://generativelanguage.googleapis.com/v1beta/models/{encodedModel}:generateContent`.
  - `model` — the unencoded model id used to build the URL (e.g. `"gemini-3.6-flash"`).
  - `headersSent` — object map. **Must redact `x-goog-api-key`** (store `"<redacted>"` or `null`); store everything else verbatim.
  - `body` — the exact JSON object posted, stored as a Mongo subdocument. Includes `system_instruction`, `contents`, `generationConfig`, and any provider request fields the app sends.
  - `bodyByteLength` — `Buffer.byteLength(JSON.stringify(body))`.
  - `timeoutMs` — value passed to `https.request`.
- `response`:
  - `statusCode` — integer.
  - `statusMessage` — string if present on the Node response object.
  - `headers` — full object map of `res.headers` (Node lowercases header names). Not captured by current helpers; would need a capture change to preserve.
  - `rawHeaders` — raw header array from `res.rawHeaders`, preserving original order/casing as Node exposes it.
  - `rawBody` — the **unparsed** UTF-8 body string exactly as received. Audit-grade record; do not store only the parsed JSON. Type: string.
  - `bodyByteLength` — `Buffer.byteLength(rawBody)`.
  - `bodyChunks` — ordered raw chunk records or external payload references if exact chunk boundaries are preserved.
  - `parsedBody` — `JSON.parse(rawBody)` if parsing succeeds; otherwise `null` plus a `parseError` field.
- `outcome` — one of `"success"` (HTTP 2xx, JSON parsed, has `candidates[0]`), `"http_error"` (non-2xx), `"network_error"` (socket error, timeout, abort), `"invalid_json"`, `"safety_blocked"` (200 with `promptFeedback.blockReason` or candidate `finishReason: 'SAFETY'`).

### Optional but high-value

- `request.geminiApiVersion` — `"v1beta"` (denormalized from the URL).
- `response.parsedBody.responseId` — denormalized for correlation. Canonical body-level id for Gemini.
- `response.parsedBody.modelVersion` — the model variant Gemini actually used (echo).
- `response.parsedBody.candidates[0].finishReason` — denormalized as a free-form string for inspection/correlation.
- `response.parsedBody.promptFeedback` — full subdocument including `blockReason` and `safetyRatings`.
- `response.parsedBody.usageMetadata` — full subdocument including `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount`, and the four `*TokensDetails[]` per-modality arrays.
- `response.parsedBody.candidates` — full array of candidates, each with full `content.parts[]`, `safetyRatings`, `citationMetadata`, `tokenCount`, `finishReason`, `finishMessage`, `index`, plus optional `avgLogprobs`, `logprobsResult`, `groundingMetadata`, `groundingAttributions`, `urlContextMetadata`.
- `error` — populated when `outcome !== "success"`:
  - `kind` — `"http_error"` | `"network_error"` | `"invalid_json"` | `"safety_blocked"`.
  - `httpStatus` — HTTP status copied from the raw response when present.
  - `googleErrorCode` — from `parsedBody.error.code` (integer matching HTTP status).
  - `googleErrorStatus` — from `parsedBody.error.status` (free-form provider string, e.g. `"RESOURCE_EXHAUSTED"`).
  - `googleErrorMessage` — from `parsedBody.error.message`.
  - `googleErrorDetails` — `parsedBody.error.details` array verbatim (preserves `@type`, `reason`, `domain`, `metadata`, `retryDelay`, `quotaMetric`, etc.). Includes any `google.rpc.RetryInfo` entries as-is, because they are part of the provider error payload.
  - `nodeErrorCode` — e.g. `"ECONNRESET"`, `"ETIMEDOUT"`, `"ABORT_ERR"`.
- `images` — when the image-parser path made the call:
  - `count`.
  - For each image: `mimeType`, `byteLength` (decoded), `sha256Digest`, and an optional raw-byte reference if preserving the full request body inline would exceed storage limits.

### Streaming reference only (not current)

The app does not use streaming today, so this section is empty in current records. If a response is ever streamed, preserve the provider package as ordered raw stream events/chunks:

- `streaming.requested` — boolean.
- `streaming.transport` — `"sse"` (with `?alt=sse`) or `"json-array"` (default `:streamGenerateContent` without `alt=sse`).
- `streaming.eventCount` — integer.
- `streaming.events` — ordered array. Each element:
  - `seq` — 0-based index (defines order).
  - `receivedAt` — ISO timestamp when the frame finished arriving.
  - `data` — the parsed JSON from the `data:` line — a full partial `GenerateContentResponse` (Mongo subdocument).
  - `rawFrame` — the literal `data: ...\n\n` text.
- `streaming.terminated` — `"close"` | `"error"` | `"abort"` | `"timeout"`.

### Storage / size notes

- Gemini image requests can include large base64 image payloads. The image-parser path inlines image bytes as base64 inside `contents[].parts[].inline_data.data`, so a single request body for an image parse may run to several MB.
- MongoDB has a 16 MB document limit. Preserve large raw request/response payloads inline when they fit, or by external payload reference when they do not.
- This document does not pick a storage implementation. Choice of inline-vs-external storage and reference format is implementation design, not this research document.
- Response bodies for non-streaming `generateContent` calls are typically small (a few KB).
- Header redaction: only `x-goog-api-key` is sensitive in this app's outgoing headers and must be redacted on the request side. Gemini response headers are not currently captured at all; if a harness ever captures them, none of the documented or publicly-known Gemini response fields are secrets — `responseId` (body-level) is non-sensitive by design.

## Gaps And Questions

### Facts vs assumptions

Everything in "Provider IDs In This App", "Current App Call Sites", "Request Package Sent Today", and "Raw Package That Reaches This Server Today" is fact, confirmed by reading the named source files at the named line numbers on the current master HEAD.

Everything in "Official Response Package" non-streaming and "Error responses" is fact from official docs (`ai.google.dev/api/generate-content`, `ai.google.dev/gemini-api/docs/troubleshooting`, `google.aip.dev/193`). Field names are quoted verbatim from those pages.

Everything in "Proposed Mongo Storage Shape" is a preservation-field proposal, not a production schema. Naming and structure are suggestions.

### Unconfirmed / could not verify

1. Current model availability is governed by dynamic discovery plus the dated official-document review recorded at the top of this file. A discovered ID remains disabled until validated.

2. Correlation header. Gemini docs reference `responseId` in the response body but do not publicly guarantee any specific HTTP correlation header. The Mongo shape stores all headers verbatim so any present header is preserved.

3. Rate-limit headers. Unlike Anthropic, `generativelanguage.googleapis.com` does not publicly document ratelimit response headers. The API returns 429 with `error.status RESOURCE_EXHAUSTED` and a `google.rpc.QuotaFailure` / `google.rpc.RetryInfo` payload inside `error.details` instead. The Mongo shape exposes both `response.headers` verbatim and `error.googleErrorDetails` to cover both possibilities.

4. Full enumeration of `finishReason` values. The reference page (`ai.google.dev/api/generate-content#FinishReason`) documents values including `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `OTHER` and may document additional values such as `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`, `IMAGE_SAFETY`. The full enum can grow without notice. Store as free-form string; do not enum-check in the preservation record.

5. `responseMimeType: 'text/plain'` impact on `candidates[0].content.parts`. Setting this in the request usually constrains the response to a single text part. I did not verify whether safety-block paths return `parts` with different shapes (e.g. empty content). The Mongo shape stores `candidates` as a free-form array so any shape is preserved.

6. Streaming wire-format ambiguity. `:streamGenerateContent` defaults to a streamed JSON array; `?alt=sse` flips to standard SSE with `data:` lines. No current qbo path chooses either streaming transport. If that changes, the record must say which transport was used.

7. `safetySettings` defaults. The app never sends `safetySettings`, so Google applies defaults. Responses may carry a non-empty `promptFeedback.blockReason` or candidate `finishReason SAFETY/PROHIBITED_CONTENT` for inputs the model judges unsafe, and the current call sites' first-text-part extraction will silently produce an empty string in those cases.

8. HTTP/2 trailing headers. Google frontends serve over HTTP/2; trailing headers are theoretically possible but I have not seen Gemini use them. `res.trailers` is not captured by the current helpers.

9. Validation probe behavior with `maxOutputTokens: 1`. The probe code treats any 2xx as success regardless of body shape (`image-parser.js:608-617`). Gemini may return a 200 with an empty `candidates[0].content` or a `finishReason MAX_TOKENS`; probe-tagged records may have non-empty `parsedBody` but empty text.

10. `GEMINI_API_KEY` vs OAuth / service-account auth. The Vertex AI variant of Gemini uses OAuth bearer tokens against a different host. This app uses only the Developer API (api-key auth, `generativelanguage.googleapis.com`). The Mongo shape would need an `auth.kind` field if Vertex is ever added.

## Evidence

### Repo source (read on current master HEAD; line numbers verified)

- `shared/ai-provider-catalog.json:135-147` — gemini catalog entry.
- `server/src/services/image-parser.js:67` — `gemini` in `DIRECT_IMAGE_PARSER_PROVIDER_IDS`.
- `server/src/services/image-parser.js:170` — `gemini -> GEMINI_API_KEY` in `ENV_KEY_MAP`.
- `server/src/services/image-parser.js:219-231` — validation probe `REMOTE_PROVIDER_TEST_CONFIGS.gemini`.
- `server/src/services/image-parser.js:239-266` — `getApiKey` / `resolveApiKey` precedence (file → env → Mongo `ImageParserApiKey`).
- `server/src/services/image-parser.js:335-336` — `getRemoteProviderLabel('gemini')` returns `"Gemini"`.
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey` HTTPS call.
- `server/src/services/image-parser.js:754-784` — `jsonRequest` (the raw `https.request` helper used by image-parser).
- `server/src/services/image-parser.js:1184-1256` — `callGemini` (the production direct-API image-parser call).
- `server/src/services/image-parser.js:1624-1625` — switch-case wiring `gemini` to `callGemini`.
- `server/src/services/image-parser.js:1751-1752` — startup validation call.
- `server/src/services/remote-api-providers.js:35-40` — `PROVIDER_CONFIG.gemini` (`defaultModel`, `baseUrl`, `envKey`, `displayName`).
- `server/src/services/remote-api-providers.js:81-147` — `jsonRequestCancelable`.
- `server/src/services/remote-api-providers.js:215-220` — `extractGeminiText`.
- `server/src/services/remote-api-providers.js:310-315` — `buildGeminiContents`.
- `server/src/services/remote-api-providers.js:540-609` — `requestGeminiChat` (the production direct-API chat call).
- `server/src/services/remote-api-providers.js:611-665` — `createBufferedChatProvider` (the buffered pseudo-stream adapter).
- `server/src/services/remote-api-providers.js:679-680` — `gemini` export wired to `requestGeminiChat`.
- `server/src/services/providers/registry.js:52-53` — registry routes transport `gemini` to `remoteApiProviders.gemini`.
- `server/src/services/providers/registry.js:90-95` — per-kind Gemini timeout env vars (`GEMINI_*_TIMEOUT_MS`).
- `server/src/routes/pipeline-tests.js:70, 80` — pipeline test label and default model id.
- `server/src/routes/image-parser.js:33, 352` — `gemini` accepted as a valid provider in routes.
- `server/src/services/test-runner.js:68, 78` — `GEMINI_API_KEY` and `ENABLE_GEMINI_IMAGE_PARSER` tracked by the harness.
- `server/.env.example:38` — `GEMINI_API_KEY` env var.

### Official documentation

- Gemini REST `generateContent` reference: https://ai.google.dev/api/generate-content
  - Confirmed top-level fields: `candidates`, `promptFeedback`, `usageMetadata`, `modelVersion`, `responseId`, `modelStatus`.
  - Confirmed candidate fields: `content`, `finishReason`, `finishMessage`, `safetyRatings`, `citationMetadata`, `tokenCount`, `groundingAttributions`, `groundingMetadata`, `avgLogprobs`, `logprobsResult`, `urlContextMetadata`, `index`.
  - `finishReason` is documented at `ai.google.dev/api/generate-content#FinishReason`; documented values include `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `OTHER` and may include additional values such as `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`, `IMAGE_SAFETY`. Store as a free-form string; the preservation record must not enforce or validate against any enum list.
  - Confirmed `promptFeedback.blockReason`: `SAFETY`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `IMAGE_SAFETY`, `OTHER`.
  - Confirmed `usageMetadata` fields: `promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `toolUsePromptTokenCount`, `thoughtsTokenCount`, `totalTokenCount`, `promptTokensDetails[]`, `cacheTokensDetails[]`, `candidatesTokensDetails[]`, `toolUsePromptTokensDetails[]`.
  - Confirmed streaming endpoint: `POST /v1beta/{model}:streamGenerateContent?alt=sse` returning SSE chunks where each chunk is a full `GenerateContentResponse`.
- Gemini API troubleshooting: https://ai.google.dev/gemini-api/docs/troubleshooting
  - Confirmed HTTP status code list explicitly documented on the page (400 `INVALID_ARGUMENT` / `FAILED_PRECONDITION`, 403 `PERMISSION_DENIED`, 404 `NOT_FOUND`, 429 `RESOURCE_EXHAUSTED`, 500 `INTERNAL`, 503 `UNAVAILABLE`, 504 `DEADLINE_EXCEEDED`). The page does NOT explicitly document HTTP 401 / `UNAUTHENTICATED`; key-permission errors are listed under 403 `PERMISSION_DENIED` on this page.
- Google API error design (AIP-193): https://google.aip.dev/193
  - Confirmed standard error JSON shape with `code` (int http), `message` (string), `status` (CODE enum), `details` array (`google.protobuf.Any`-typed).
  - Confirmed `details[]` supports `ErrorInfo`, `LocalizedMessage`, `Help`, `QuotaFailure`, `RetryInfo`, `BadRequest`, etc.
