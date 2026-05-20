# openai-api Provider Harness Contract

## Summary

This document describes how the qbo-escalations server makes direct HTTPS calls to OpenAI's Chat Completions API at `https://api.openai.com/v1/chat/completions`. This is the "direct API" transport for OpenAI — entirely separate from the OpenAI Codex CLI subprocess transport, which is a different provider id (`codex`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`) and a different document.

The research label is `openai-api`; the actual app catalog id is `openai`. There is no `openai-api` id in the catalog — `openai` is the only direct-HTTPS-to-OpenAI id this app exposes.

There are currently three distinct call paths that hit OpenAI's HTTPS endpoint:

1. **Image-parser direct call** (`callOpenAI`) — used by the image-parser pipeline when `provider === 'openai'`. Non-streaming, single-shot, vision (text + `image_url` content parts with a `data:image/...;base64,...` URL).
2. **Chat-leg direct call** (`requestOpenAiChat` -> `requestOpenAiLikeChat`) — used by the workspace/chat provider registry when an agent is routed to transport `openai`. Non-streaming, single-shot, text-only. Same `/v1/chat/completions` endpoint, no images.
3. **Key-validation probe** (`testRemoteProviderKey` for `openai`) — minimal HTTP POST to validate a stored API key (`max_completion_tokens: 64` for reasoning models / `max_tokens: 64` for legacy models, `messages: [{role:'user', content:'Reply with OK only.'}]`).

A separate "OpenAI Codex CLI" path exists (`server/src/services/codex.js`, transport `codex`). That path uses the Codex CLI subprocess and is **out of scope** for this document — it does not hit `api.openai.com` directly from this server.

All three direct-API paths are **non-streaming** (no `stream: true` flag, no SSE parsing on the server). The earliest server-visible package is the Node `http.IncomingMessage` inside the request callback: status code, status message, headers, raw headers, and ordered body chunks. The helper then collapses that to `{ statusCode, body }` (or `{ statusCode, body, model }` for the validation probe), discarding headers, raw header order, status message, and chunk boundaries before later app code sees the response.

The proposed preservation shape captures the full HTTPS package: status, headers, raw headers, ordered body data, the raw body string exactly as received, the parsed JSON when parseable, request metadata (model, endpoint path, timeouts), timestamps, and error payloads. OpenAI supports streaming, but no current direct-API call site requests it; current-app records should only note that streaming was not requested.

## Provider IDs In This App

Catalog entry (single direct-API entry, no aliases):

- `shared/ai-provider-catalog.json:90-103` — `id: "openai"`, `family: "openai"`, `transport: "openai"`, default `model: "gpt-5.4-mini"`, label `"OpenAI API"`, shortLabel `"OpenAI"`, `allowedEfforts: ["none","low","medium","high","xhigh"]`, `supportsThinking: false`.

Other names this id appears under in code:

- `provider === 'openai'` — switch cases and validation lists in `server/src/services/image-parser.js:65`, `server/src/services/image-parser.js:1621`, `server/src/routes/image-parser.js:31`.
- Transport string `'openai'` — registry routing in `server/src/services/providers/registry.js:50-51, 84-89`.
- ENV key mapping: `openai -> OPENAI_API_KEY` at `server/src/services/image-parser.js:168` and `server/src/services/remote-api-providers.js:29-34`.
- Display labels: `"OpenAI"` in `getRemoteProviderLabel` at `server/src/services/image-parser.js:331-332`; `"OpenAI"` in pipeline-tests labels at `server/src/routes/pipeline-tests.js:68`; `"OpenAI API"` in `PROVIDER_CONFIG.openai.displayName` at `server/src/services/remote-api-providers.js:29-34`.
- Default model strings: `OPENAI_DEFAULT_IMAGE_MODEL` resolves to `process.env.OPENAI_IMAGE_PARSE_MODEL || process.env.OPENAI_PARSE_MODEL || 'gpt-5.4-mini'` at `server/src/services/image-parser.js:55`; `PROVIDER_CONFIG.openai.defaultModel = 'gpt-5.4-mini'` at `server/src/services/remote-api-providers.js:30`.
- Pricing key: `openai` and `codex` get the same per-token pricing entry at `server/src/lib/pricing.js:53-54`.
- Mongo schema: `ImageParseResult.provider` comment lists `'openai'` as a valid value at `server/src/models/ImageParseResult.js:7`.

**Research-label-vs-actual-id**: The research label is `openai-api`. The actual app id is `openai`. The rest of this document uses the actual id `openai` whenever referring to source code, configuration, or storage, and uses `openai-api` only to refer to this research artifact.

Distinct catalog ids that share the OpenAI brand (called out so they are not confused with this provider):

- `codex`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` — all `family: "codex"`, `transport: "codex"`. Routed through Codex CLI subprocess (`server/src/services/codex.js`). **Not** documented here.

## Current App Call Sites

All factual; line numbers verified by Read/Grep on the current `master` HEAD.

### 1. Image-parser direct path

- `server/src/services/image-parser.js:1071-1122` — `async function callOpenAI(systemPrompt, imageDataUrl, model, reasoningEffort, timeoutMs)`
  - Resolves the API key via `resolveApiKey('openai')` (`image-parser.js:1075`), which checks `data/image-parser-keys.json` first, then `process.env.OPENAI_API_KEY`, then a Mongo `ImageParserApiKey` doc (`image-parser.js:239-266`).
  - Builds a single-turn `messages` body: one `system` message with `content: systemPrompt`, and one `user` message whose `content` is an array of two parts — a text part with type text and a part with type image_url whose `image_url.url` is the data URL produced by `normalizeBase64` at `image-parser.js:789-825`.
  - The body is finalized by `applyOpenAiGenerationOptions(body, effectiveModel, reasoningEffort)` (`image-parser.js:129-140`). For reasoning models (regex match against gpt-5 family or o-digit family at `image-parser.js:124-127`) this sets `max_completion_tokens: 4096` and (when an effort is supplied and valid) `reasoning_effort: <effort>` where effort is one of `none|low|medium|high|xhigh`. For non-reasoning models it sets `max_tokens: 4096` and `temperature: 0.1`. **No `stream`, no `stream_options`, no `top_p`, no `service_tier`, no `tools`, no `response_format`, no `seed`.**
  - Sends `POST https://api.openai.com/v1/chat/completions` via the in-module `jsonRequest()` helper (`image-parser.js:754-784`), which is a thin `https.request` wrapper that accumulates the response body as a string and resolves `{ statusCode, body }`.
  - Treats anything other than HTTP 200 as a hard error, throwing `Error("OpenAI API error (HTTP N): ...")` with `err.code = 'PROVIDER_ERROR'` (`image-parser.js:1102-1106`).
  - Parses the body with `JSON.parse`; on parse failure throws `'PROVIDER_ERROR'` (`image-parser.js:1108-1115`).
  - Pulls `parsed.choices?.[0]?.message?.content` for the answer text and a small `{ model, inputTokens, outputTokens }` object from `parsed.usage.prompt_tokens` / `parsed.usage.completion_tokens` (`image-parser.js:1116-1119`).
  - **Returns only**: `{ text: text.trim(), usage }`. The original `res.body` string, `res.statusCode`, response headers, `parsed.id`, `parsed.object`, `parsed.created`, `parsed.system_fingerprint`, `parsed.service_tier`, `choices[0].finish_reason`, `choices[0].logprobs`, `choices[0].message.refusal`, `choices[0].message.tool_calls`, `choices[0].message.annotations`, `usage.total_tokens`, `usage.prompt_tokens_details`, `usage.completion_tokens_details` (including `reasoning_tokens`) — all dropped on the floor.

- `server/src/services/image-parser.js:1621-1623` — switch-case wiring inside the main `parseImage` pipeline. When the requested provider is `'openai'`, `callOpenAI(systemPrompt, normalized.dataUrl, model, reasoningEffort, timeoutMs)` is invoked. This is the only place in production code that invokes the direct-API OpenAI Chat Completions endpoint for image parsing.

### 2. Chat/workspace direct path

- `server/src/services/remote-api-providers.js:474-506` — `function requestOpenAiChat({ messages, systemPrompt, model, reasoningEffort, timeoutMs, requestFn, getApiKeyFn })`
  - Same key resolution (`getApiKey('openai')` -> `getImageParserApiKey('openai')`) at line 484, with the `'OpenAI API key not configured'` `PROVIDER_UNAVAILABLE` early-out at lines 485-487.
  - Delegates to `requestOpenAiLikeChat({ providerId: 'openai', baseUrl: PROVIDER_CONFIG.openai.baseUrl, apiKey, messages, systemPrompt, model, reasoningEffort, timeoutMs, requestFn })` at lines 492-502.

- `server/src/services/remote-api-providers.js:380-441` — `function requestOpenAiLikeChat({ providerId, baseUrl, apiKey, apiKeyOptional, messages, systemPrompt, model, reasoningEffort, timeoutMs, requestFn })`
  - Builds a text-only body. `messages` is constructed by `buildOpenAiMessages(messages, systemPrompt)` at `remote-api-providers.js:293-301`, which produces a leading system message (if `systemPrompt` is set) followed by the caller-supplied messages normalized to string content. `normalizeMessages` (line 175-188) flattens any structured content via `contentToText` and emits string `content` per message. Images are **not** sent on this path — there is no `image_url` content part in the chat-leg.
  - When `providerId === 'openai'`, `applyOpenAiGenerationOptions(body, effectiveModel, reasoningEffort)` (lines 59-70 in the same file) sets `max_completion_tokens: 4096` and optional `reasoning_effort` for reasoning models, or `max_tokens: 4096` and `temperature: 0.2` for non-reasoning models. (Note temperature differs from the parser path: 0.2 here vs 0.1 there.)
  - POSTs to `/v1/chat/completions` via the in-module `jsonRequestCancelable` (`remote-api-providers.js:81-147`), a cancellable variant of the same `https.request` pattern. Accumulates the full body string and resolves `{ statusCode, body }`.
  - Non-200 throws `PROVIDER_ERROR` (`remote-api-providers.js:416-420`), except when status is 401/403 and the api key is absent **and** `apiKeyOptional === true` — that throws `PROVIDER_UNAVAILABLE` instead. For `openai` the path is invoked with `apiKey` already validated as non-empty, so the unavailable branch only fires for the LLM Gateway sibling (line 417-418).
  - On success, `extractOpenAiText(parsed.choices?.[0]?.message)` (line 190-205) returns `message.content` if string, otherwise joins `content[].text` / `content[].content` for array form, otherwise falls back to `message.reasoning_content` if present. The usage object is the same `{ model, inputTokens, outputTokens }` shape from `parsed.usage.prompt_tokens` / `parsed.usage.completion_tokens` at lines 432-438.
  - Returns `{ text, usage }`. Same dropping of raw body / headers / statusCode / `system_fingerprint` / `finish_reason` / `service_tier` / `usage.total_tokens` / `usage.prompt_tokens_details` / `usage.completion_tokens_details` as path #1.

- `server/src/services/remote-api-providers.js:675-677, 690` — exports `openai = { chat: createBufferedChatProvider('openai', requestOpenAiChat) }`.
- `createBufferedChatProvider` (line 611-665) wraps the promise and surfaces results via `onChunk`/`onDone`/`onError` callbacks. There is no actual streaming — `onChunk` is called once with the full text right before `onDone` (line 646-650). It is a "buffered" pseudo-stream adapter.
- `server/src/services/providers/registry.js:4, 50-51` — registry imports `remote-api-providers` and routes `transport: 'openai'` to its `chat` function (`remoteApiProviders.openai`). This is what the workspace/chat routes hit when a user picks the `openai` model from the dropdown.
- `server/src/services/providers/registry.js:84-89` — per-kind OpenAI timeout env var lookup: `OPENAI_TRANSCRIBE_TIMEOUT_MS` for `'transcribe'`, `OPENAI_PARSE_TIMEOUT_MS` for `'parse'`, `OPENAI_CHAT_TIMEOUT_MS` for `'chat'` (the default).

### 3. Key-validation probe (admin "test API key" button)

- `server/src/services/image-parser.js:196-208` — `REMOTE_PROVIDER_TEST_CONFIGS.openai`:
  - hostname `api.openai.com`
  - path `/v1/chat/completions`
  - model `OPENAI_DEFAULT_IMAGE_MODEL` (resolves to `gpt-5.4-mini` unless overridden via env)
  - body — built by `applyOpenAiGenerationOptions({ model, messages: [{ role: 'user', content: 'Reply with OK only.' }] }, model, 'low', OPENAI_PROVIDER_TEST_MAX_TOKENS)`. With `OPENAI_PROVIDER_TEST_MAX_TOKENS = 64` (line 56), this yields `max_completion_tokens: 64` + `reasoning_effort: 'low'` for reasoning models or `max_tokens: 64` + `temperature: 0.1` for legacy models. `gpt-5.4-mini` is matched by the reasoning-model regex (line 126) so the reasoning-model branch is taken by default.
  - headers `Authorization: Bearer <key>`, `Content-Type: application/json`
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey(provider, apiKey)` constructs the minimal request and POSTs it, accumulating the body string and resolving `{ statusCode, body, model }`.
- `server/src/services/image-parser.js:516-659` — `validateRemoteProvider(provider, apiKey)` interprets the result: 2xx -> `available: true`, 401/403 -> `INVALID_KEY`, timeout -> `TIMEOUT`, else `PROVIDER_TEST_FAILED`. The path also discards the response body string after a quick `JSON.parse` to extract `error.message` (line 624).

### Transport summary

All three production call sites use Node's built-in `https.request` directly (no `fetch`, no `axios`, no `openai` / `@openai/sdk` npm package). The `openai` package is **not** installed — grep over `package.json` files in this repo turns up no dependency. The Codex CLI is a separately-installed binary used by the `codex` transport, not this provider.

## Request Package Sent Today

Inferred from current app code at the call sites above. All three paths share:

- **Method**: `POST`
- **Scheme/host**: `https://api.openai.com`
- **Path**: `/v1/chat/completions`
- **Auth header**: `Authorization: Bearer <OPENAI_API_KEY>` (env var name only; no secret values quoted). Source: `image-parser.js:1099`, `image-parser.js:204-207`, `remote-api-providers.js:410`.
- **Content type**: `Content-Type: application/json`; `Accept: application/json` (set by the shared `jsonRequest`/`jsonRequestCancelable` helpers at `image-parser.js:764` and `remote-api-providers.js:96-99`).
- **Content-Length**: computed from `Buffer.byteLength(payload)` (`image-parser.js:767`, `remote-api-providers.js:104-106`).
- **Timeout**: socket-level `timeout` option on the `https.request` options object. Source values:
  - Image-parser default `DEFAULT_TIMEOUT_MS = 120000` (`image-parser.js:57`); callable override via the parser route timeoutMs arg.
  - Chat-leg default `DEFAULT_TIMEOUT_MS = 120_000` (`remote-api-providers.js:12`); per-kind overrides via env vars `OPENAI_CHAT_TIMEOUT_MS`, `OPENAI_PARSE_TIMEOUT_MS`, `OPENAI_TRANSCRIBE_TIMEOUT_MS` (`registry.js:84-89`).
  - Validation probe hardcoded to `10_000` ms (`image-parser.js:498`).
- **No `stream` flag**. None of the three bodies set `stream: true`.
- **No `stream_options`, `tools`, `tool_choice`, `response_format`, `seed`, `top_p`, `frequency_penalty`, `presence_penalty`, `service_tier`, `modalities`, `audio`, `verbosity`, `web_search_options`, `user`**. The bodies are minimal.

Mode A — Image-parser (vision, `callOpenAI`):

```
body = {
  model: <effectiveModel> || 'gpt-5.4-mini',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Parse this image.' },
        { type: 'image_url', image_url: { url: 'data:image/<type>;base64,<rawBase64>' } }
      ]
    }
  ],
  // For reasoning models (gpt-5*, o*):
  max_completion_tokens: 4096,
  reasoning_effort: '<low|medium|high|xhigh>'    // only if the caller supplied a recognized value; absent for 'none' or unset
  // For non-reasoning models:
  max_tokens: 4096,
  temperature: 0.1
}
```

Notes:
- `image_url.url` is a full base64 data URL produced by `normalizeBase64` (`image-parser.js:789-825`). Media type detected from data-URL prefix or from base64 magic numbers (`detectMediaTypeFromBase64`, `image-parser.js:831-844`); valid values produced: `image/png`, `image/jpeg`, `image/gif`, `image/webp` (PNG fallback).
- `image_url.detail` is **not** set, so OpenAI defaults to `auto` (per the OpenAPI spec; see Official Response Package section).
- No `temperature` is sent for reasoning models — they reject non-default values for that parameter. The branch in `applyOpenAiGenerationOptions` enforces this.

Mode B — Chat (text-only, `requestOpenAiChat` -> `requestOpenAiLikeChat`):

```
body = {
  model: <effectiveModel> || 'gpt-5.4-mini',
  messages: [
    // optional, only if systemPrompt provided:
    { role: 'system', content: systemPrompt },
    // then for each caller-supplied message, normalized to string content:
    { role: 'user'|'assistant'|'system', content: '<flattened text>' }
    // ...
  ],
  // For reasoning models:
  max_completion_tokens: 4096,
  reasoning_effort: '<low|medium|high|xhigh>'
  // For non-reasoning models:
  max_tokens: 4096,
  temperature: 0.2
}
```

Notes:
- Chat path coerces all content blocks down to strings — `image` or `image_url` parts would be discarded if passed in. Consistent with the registry not exposing a `transcribeImage` function on the `openai` service in `remote-api-providers.js`.
- `reasoningEffort` is honored on this path (unlike the Anthropic chat path).

Mode C — Validation probe (`testRemoteProviderKey('openai')`):

```
body = applyOpenAiGenerationOptions({
  model: 'gpt-5.4-mini',  // or whatever OPENAI_DEFAULT_IMAGE_MODEL resolves to
  messages: [{ role: 'user', content: 'Reply with OK only.' }]
}, model, 'low', 64)

// Result for reasoning model: { model, messages, max_completion_tokens: 64, reasoning_effort: 'low' }
// Result for non-reasoning model: { model, messages, max_tokens: 64, temperature: 0.1 }
```

Used only to confirm a key authenticates. Same headers (`Authorization: Bearer <key>`, `Content-Type: application/json`).

## Official Response Package

Sources (cited in Evidence):

- OpenAI OpenAPI specification at `https://github.com/openai/openai-openapi` — `openapi.yaml`. The repo is the canonical machine-readable spec OpenAI publishes for its REST API. Fetched via `gh api repos/openai/openai-openapi/contents/openapi.yaml` (2.8 MB file). Quoted schema names and field definitions below are from that file.
- OpenAI Python SDK source — `https://github.com/openai/openai-python` — for confirmation of the `x-request-id` HTTP response header and retry semantics.

The OpenAI documentation site at `platform.openai.com/docs` returns HTTP 403 to `WebFetch`, so non-spec docs (rate-limit headers, error code human descriptions, streaming SSE prose) could not be quoted directly. Where docs could not be fetched, I have noted the gap in Gaps And Questions.

### Non-streaming success (HTTP 200) — `CreateChatCompletionResponse`

Top-level body fields (verbatim from `openai-openapi.yaml`, schema `CreateChatCompletionResponse`, lines 42967-43117):

- `id` — string. Unique identifier for the chat completion. Example: `"chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG"`.
- `object` — string, always the literal `"chat.completion"` (enum-const).
- `created` — integer (Unix timestamp seconds). When the chat completion was created.
- `model` — string. The model used for the chat completion (echo; may differ from the requested alias).
- `choices` — array. Each element has:
  - `index` — integer. Zero-based index of the choice.
  - `finish_reason` — string, enum: `"stop" | "length" | "tool_calls" | "content_filter" | "function_call"` (function_call is deprecated). Required.
  - `message` — `ChatCompletionResponseMessage` (schema lines 41151-41281):
    - `role` — string, always `"assistant"` (enum-const).
    - `content` — string or `null`. Required.
    - `refusal` — string or `null`. The refusal message generated by the model when applicable.
    - `tool_calls` — `ChatCompletionMessageToolCalls` (array of tool-call objects); absent when not used.
    - `function_call` — deprecated object with `arguments` and `name`. Absent on modern models.
    - `annotations` — array of URL-citation objects when web search tool is used. Each has `type: "url_citation"` and `url_citation: { end_index, start_index, url, title }`.
    - `audio` — object or `null` (only when audio modality is requested; includes `id`, `expires_at`, `data` base64, `transcript`).
  - `logprobs` — object or `null`. When present: `{ content: ChatCompletionTokenLogprob[] | null, refusal: ChatCompletionTokenLogprob[] | null }`.
- `service_tier` — `ServiceTier` ref. Indicates which tier serviced the request (e.g. `default`, `scale`, etc.).
- `system_fingerprint` — string. Marked `deprecated: true` in the spec but still emitted. Represents the backend configuration the model runs with; usable with `seed` for determinism diagnostics.
- `usage` — `CompletionUsage` object (schema lines 41739-41802):
  - `prompt_tokens` — integer. Required.
  - `completion_tokens` — integer. Required.
  - `total_tokens` — integer. Required.
  - `prompt_tokens_details` — object: `{ audio_tokens: int, cached_tokens: int }`.
  - `completion_tokens_details` — object: `{ accepted_prediction_tokens: int, audio_tokens: int, reasoning_tokens: int, rejected_prediction_tokens: int }`.

`required` fields on the top-level response: `choices`, `created`, `id`, `model`, `object`.

Example payload from the OpenAPI spec (lines 43082-43117):

```
{
  "id": "chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG",
  "object": "chat.completion",
  "created": 1741570283,
  "model": "gpt-4o-2024-08-06",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The image shows a wooden boardwalk...",
        "refusal": null,
        "annotations": []
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1117,
    "completion_tokens": 46,
    "total_tokens": 1163,
    "prompt_tokens_details": { "cached_tokens": 0, "audio_tokens": 0 },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  },
  "service_tier": "default",
  "system_fingerprint": "fp_fc9f1d7035"
}
```

### Response headers (success and error)

The OpenAPI spec does not document HTTP response headers explicitly. Header names below come from official OpenAI client behavior (Python SDK) and the OpenAPI repo's own examples — see Evidence:

- `x-request-id` — lowercase. Confirmed by the OpenAI Python SDK README: "All object responses in the SDK provide a `_request_id` property which is added from the `x-request-id` response header." Confirmed in the OpenAPI spec's `curl` example for image edits (`openapi.yaml:12637`: `grep -i x-request-id >&2`). Value shape: `req_<opaque>`. This is the canonical correlation id and the value the SDK exposes as `response._request_id` / `APIStatusError.request_id`.
- `openai-organization` — string. Documented in OpenAI's web help pages and Cookbook. Not quoted directly here (platform.openai.com fetch returned 403). Flagged in Gaps.
- `openai-processing-ms` — string (integer-like). Server-side processing time. Documented in OpenAI's web help pages. Not quoted directly here. Flagged in Gaps.
- `openai-version` — string. The API date version that served the request. Documented in OpenAI's web help pages. Not quoted directly here. Flagged in Gaps.
- `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests` — request-quota headers.
- `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens` — token-quota headers.
- `retry-after` — present on 429 responses. The Python SDK's `_base_client.py` also recognizes a non-standard `retry-after-ms` header for millisecond precision.

The OpenAPI spec is silent about all the headers above except via incidental examples; treat their presence as "expected by ecosystem convention and OpenAI SDKs" rather than spec-guaranteed. The Mongo storage shape below recommends preserving the entire `res.headers` map regardless of name.

### Error responses — `ErrorResponse` / `Error`

JSON error body shape (from `openapi.yaml` schema `Error` at lines 47730-47749 and `ErrorResponse` at lines 47768-47774):

```
{
  "error": {
    "type":    "string",                       // required, e.g. "invalid_request_error", "authentication_error", "rate_limit_exceeded"
    "message": "string",                       // required, human-readable
    "param":   "string" | null,                // required (nullable). The request parameter that triggered the error, when applicable.
    "code":    "string" | null                 // required (nullable). Machine-readable error code (e.g. "invalid_api_key", "context_length_exceeded")
  }
}
```

HTTP status codes the OpenAI Python SDK explicitly maps (`src/openai/_exceptions.py` — confirmed via WebFetch):

| status | SDK exception |
|---|---|
| 400 | `BadRequestError` (invalid_request_error) |
| 401 | `AuthenticationError` |
| 403 | `PermissionDeniedError` |
| 404 | `NotFoundError` |
| 409 | `ConflictError` |
| 422 | `UnprocessableEntityError` |
| 429 | `RateLimitError` |
| >=500 | `InternalServerError` (generic 5xx) |

408, 413, 502, 503, 504 are not given dedicated exception classes in the SDK file inspected but still occur in practice (timeouts, payload-too-large, gateway issues). They surface as generic `APIStatusError`s. The SDK automatically retries on 408, 409, 429, and 5xx by default.

Each error response also includes the `x-request-id` HTTP header. The SDK exposes that as `APIStatusError.request_id` when raised.

### Streaming response (when `stream: true` is set) — `CreateChatCompletionStreamResponse`

Not currently used by this app (confirmed by grep — see Streaming section). This section is provider-capability reference only.

Wire format: Server-Sent Events. `Content-Type: text/event-stream`. Each event has a `data: <json>` line followed by a blank line. The stream is terminated by a literal `data: [DONE]` sentinel (quoted in the OpenAPI spec for the `stream` request field at `openapi.yaml:43461`: "the stream terminated by a `data: [DONE]` message").

Chunk shape (`CreateChatCompletionStreamResponse`, schema lines 43118-43248):

- `id` — string. Same id across all chunks for a single completion.
- `object` — string, always the literal `"chat.completion.chunk"` (enum-const).
- `created` — integer (Unix timestamp seconds). Same timestamp across all chunks.
- `model` — string.
- `system_fingerprint` — string. Deprecated but emitted.
- `service_tier` — `ServiceTier` ref.
- `choices` — array. Each element:
  - `index` — integer. Required.
  - `delta` — `ChatCompletionStreamResponseDelta` (schema lines 41346-41390):
    - `role` — string, enum `"developer"|"system"|"user"|"assistant"|"tool"` — only present on the first chunk for each choice.
    - `content` — string or `null`. The text increment.
    - `refusal` — string or `null`. Refusal text increment.
    - `tool_calls` — array of `ChatCompletionMessageToolCallChunk` when tool use is active.
    - `function_call` — deprecated. `{ arguments, name }`.
  - `finish_reason` — string, enum `"stop"|"length"|"tool_calls"|"content_filter"|"function_call"`, nullable. `null` for intermediate chunks; populated on the final chunk for that choice. Required.
  - `logprobs` — object or `null`. Same `{ content, refusal }` shape as the non-streaming variant.
- `usage` — `CompletionUsage` object (nullable). **Only present when the request sets `stream_options: { include_usage: true }`. When present, it is `null` on intermediate chunks and contains the final token totals on the very last chunk before `data: [DONE]`.** Quoted from spec lines 43222-43242. The spec explicitly warns: "If the stream is interrupted or cancelled, you may not receive the final usage chunk."

`required` chunk fields: `choices`, `created`, `id`, `model`, `object`.

Example chunks (from OpenAPI spec lines 43253-43268):

```
{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o-mini","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}

{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o-mini","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{"content":"Hello"},"logprobs":null,"finish_reason":null}]}

...

{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o-mini","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}]}
```

Final response reconstruction: accumulate `choices[i].delta.content` strings in `index` order onto a per-choice buffer; `finish_reason` lands on the last chunk for that choice; if `stream_options.include_usage=true`, the very last chunk before `[DONE]` carries the `usage` object (with all detail subfields).

Mid-stream errors: OpenAI emits an SSE `event: error` with `data: <Error JSON>` matching the `Error` schema. The OpenAPI spec defines `ErrorEvent` at lines 47750-47767. The Errors schema is the same `{ type, message, param, code }` shape as non-streaming errors.

## Streaming vs Non-Streaming

**This app currently uses non-streaming for all direct-API OpenAI calls.** Verified via:

- Grep over `server/src/services/remote-api-providers.js` and `server/src/services/image-parser.js` for `stream` / `sse` / `text/event-stream` / `[DONE]` — none of the OpenAI bodies set `stream: true`.
- `callOpenAI` (`image-parser.js:1084-1100`) — body has no `stream` field.
- `requestOpenAiLikeChat` (`remote-api-providers.js:392-413`) — body has no `stream` field.
- Validation probe (`image-parser.js:200-203`) — body has no `stream` field.

Notes:

- The `createBufferedChatProvider` wrapper (`remote-api-providers.js:611-665`) simulates a "stream" for downstream callers by emitting one `onChunk` with the full text right before `onDone`. This is buffer-then-fire, not a real SSE stream. The wire request is still non-streaming.
- OpenAI's Chat Completions endpoint supports streaming via `stream: true` and the `stream_options: { include_usage: true }` flag, but this app does not use either.
- OpenAI streaming remains provider-capability reference only in this document. Current direct-API paths do not receive SSE frames.
- Final-response detection (when streaming is on): the `data: [DONE]` sentinel terminates the stream. Per-choice `finish_reason` is the last non-null `finish_reason` seen on `choices[i]`.

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
- `server/src/services/remote-api-providers.js:108-118` — same pattern inside `jsonRequestCancelable` (cancelable variant). The resolved shape is `{ statusCode: res.statusCode || 0, body: data }`.
- `server/src/services/image-parser.js:499-503` — same pattern inside `testRemoteProviderKey`. Resolved as `{ statusCode: res.statusCode, body: data, model: cfg.model }`.

At the call site, the helper-normalized object is bound to `const res = await jsonRequest(...)` (image-parser) or `const response = await request.promise` (chat-leg via `jsonRequestCancelable`). So **`res.body`** / **`response.body`** is the helper-normalized raw response string. It is not the complete raw HTTP package because headers, raw header order, status message, HTTP version, and chunk boundaries have already been discarded.

### What is preserved vs discarded today

Preserved through the immediate helper:

- `res.statusCode` — survives as far as the call site, where it is checked but not stored.
- `res.body` — the full unparsed JSON string. The call site uses up to 500 chars of it in error messages, then calls `JSON.parse` on it.

After parsing, the call site keeps only:
- `parsed.choices[0].message.content` (or for the chat-leg, additionally `message.reasoning_content` via `extractOpenAiText`).
- `parsed.model`, `parsed.usage.prompt_tokens`, `parsed.usage.completion_tokens` (only as `{ model, inputTokens, outputTokens }`).

Discarded (currently never escapes the helper):

- **All response headers**, including `x-request-id`, `openai-organization`, `openai-processing-ms`, `openai-version`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`, `retry-after`. The `res.on('end', ...)` callback resolves only `{ statusCode, body }` — `res.headers` is never captured.
- **Every choice past index 0**. `parsed.choices?.[0]` only reads the first choice. If the app ever set `n > 1`, the extras would be dropped. (Currently `n` is not set, so OpenAI defaults to 1.)
- `parsed.id`, `parsed.object`, `parsed.created`, `parsed.system_fingerprint`, `parsed.service_tier` — fully discarded.
- `choices[0].finish_reason`, `choices[0].logprobs`, `choices[0].message.refusal`, `choices[0].message.tool_calls`, `choices[0].message.annotations`, `choices[0].message.audio` — fully discarded.
- `parsed.usage.total_tokens`, `parsed.usage.prompt_tokens_details.cached_tokens`, `parsed.usage.prompt_tokens_details.audio_tokens`, `parsed.usage.completion_tokens_details.reasoning_tokens`, `completion_tokens_details.audio_tokens`, `completion_tokens_details.accepted_prediction_tokens`, `completion_tokens_details.rejected_prediction_tokens` — fully discarded.
- Error response body details (`error.type`, `error.code`, `error.param`) — only `error.message` is surfaced (via `extractProviderErrorMessage` at `image-parser.js:427-437`) into a thrown `Error.message`, the rest is lost.

There are no SSE chunks today because no path opts into streaming.

## Proposed Mongo Storage Shape

Goal: preserve the full HTTPS response package for the direct `POST /v1/chat/completions` call, sufficient for later inspection / debug / audit. Field naming below is suggestive — the harness can adopt any naming convention. Required vs Optional is from the perspective of "do we lose audit value if it is missing".

### Suggested record shape

#### Required

- `_id` — Mongo default.
- `provider` — `"openai"` (matches catalog id).
- `transport` — `"openai"` (matches catalog transport).
- `callerSite` — enum of `"image-parser"`, `"chat"`, `"validation-probe"`. Identifies which code path made the call and what request/response shape was used.
- `requestStartedAt` — ISO timestamp captured immediately before the `req.end()` call.
- `requestFinishedAt` — ISO timestamp captured at the `res.on('end')` resolve.
- `durationMs` — elapsed time between `requestStartedAt` and `requestFinishedAt`.

- `request`:
  - `method` — `"POST"`.
  - `url` — full URL string: `https://api.openai.com/v1/chat/completions`.
  - `headersSent` — object map. The outgoing `Authorization` header **must be redacted** (store `Bearer <redacted>` or null); store everything else verbatim. Other headers sent: `Content-Type`, `Accept`, `Content-Length`.
  - `body` — the exact JSON object posted (after JSON serialization or before, but stored as a Mongo subdocument). Includes `model`, `messages`, and one or more of `max_tokens` / `max_completion_tokens` / `temperature` / `reasoning_effort` depending on the model branch. Current calls do not include `stream` / `stream_options`.
  - `bodyByteLength` — `Buffer.byteLength(JSON.stringify(body))`. Useful for image-parser bodies that can be a few MB due to inline base64.
  - `timeoutMs` — value passed to `https.request`.
- `response`:
  - `statusCode` — integer.
  - `statusMessage` — string if present on the Node response object.
  - `headers` — full object map of `res.headers` (Node lowercases header names). At minimum the harness should retain: `x-request-id`, `content-type`, `openai-organization`, `openai-processing-ms`, `openai-version`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`, `retry-after` (when present), `retry-after-ms` (sometimes present, non-standard — see Evidence/SDK).
  - `rawHeaders` — raw header array from `res.rawHeaders`, preserving original order/casing as Node exposes it.
  - `rawBody` — the **unparsed** UTF-8 body string exactly as received. This is the audit-grade record; do not store only the parsed JSON. Type: string.
  - `bodyByteLength` — `Buffer.byteLength(rawBody)`. Useful for spotting truncation.
  - `bodyChunks` — ordered raw chunk records or external payload references if exact chunk boundaries are preserved.
  - `parsedBody` — JSON-parsed `rawBody` if parsing succeeds; otherwise null plus a `parseError` field.
- `outcome` — enum: `"success"` (HTTP 2xx, JSON parsed, top-level `object` equals `"chat.completion"`), `"http_error"` (non-2xx), `"network_error"` (socket error, timeout, abort), `"invalid_json"`.

#### Optional but high-value

- `response.parsedBody` must preserve the full provider JSON, including completion id, model echo, `system_fingerprint`, `service_tier`, `created`, full `choices[]`, and full `usage` details. Do not preserve only `choices[0].message.content`.
- `error` — populated when outcome is not `"success"`:
  - `kind` — one of `"http_error"`, `"network_error"`, `"invalid_json"`.
  - `httpStatus` — HTTP status copied from the raw response when present.
  - `openaiErrorType` — from `parsedBody.error.type` (e.g. `invalid_request_error`, `authentication_error`, `rate_limit_exceeded`, `insufficient_quota`).
  - `openaiErrorCode` — from `parsedBody.error.code` (e.g. `invalid_api_key`, `context_length_exceeded`, `model_not_found`).
  - `openaiErrorMessage` — from `parsedBody.error.message`.
  - `openaiErrorParam` — from `parsedBody.error.param`.
  - `openaiRequestId` — from `response.headers["x-request-id"]`.
  - `retryAfter` — number, parsed from `response.headers["retry-after"]` (seconds) or `response.headers["retry-after-ms"]` (ms) when status is 429.
  - `nodeErrorCode` — e.g. ECONNRESET, ETIMEDOUT, ABORT_ERR.
- `images` — when the image-parser path made the call:
  - `count`.
  - For each image: `mediaType`, `byteLength` (decoded), `sha256Digest`, and an optional raw-byte reference if preserving the full request body inline would exceed storage limits.
- `reasoning` — when a reasoning model was used:
  - `reasoningEffortSent` — one of `low`, `medium`, `high`, `xhigh`, or null. From `request.body.reasoning_effort`.
  - `reasoningTokens` — denormalized copy of `parsedBody.usage.completion_tokens_details.reasoning_tokens`.

#### Streaming status (not current)

- `streaming.requested` — `false` for all current direct-API OpenAI calls.
- `streaming.includeUsageRequested` — `false` for all current direct-API OpenAI calls because no request sends `stream_options`.
- No current direct-API OpenAI call receives SSE frames, so ordered streaming events are not part of the current Mongo preservation shape. The official streaming package is documented above only as provider capability context; if this app later sends `stream: true`, that new current package should be researched and documented as a separate update.

#### Storage / size notes (not policy)

- Image-parser request bodies can be a few MB each because the base64 image data is inlined into `messages[].content[].image_url.url` as a data URL. Preserve the full value inline or by external payload reference if it is too large for one document; the exact storage mechanism is out of scope.
- Response bodies for current non-streaming calls are typically small (a few KB) but can be larger when the response contains long answer text and detailed usage. If a future current path streams, large event payloads may require an external payload reference; that future mechanism is out of scope for this document.
- Header redaction: only the outgoing Authorization Bearer header is sensitive. None of the OpenAI response headers known to me are sensitive — `x-request-id`, `openai-organization`, and the `x-ratelimit-*` family are non-sensitive by design.

## Gaps And Questions

### Facts vs assumptions

Everything in "Provider IDs In This App", "Current App Call Sites", and "Raw Package That Reaches This Server Today" is **fact** — confirmed by reading the named source files at the named line numbers on the current `master` HEAD.

Everything in "Official Response Package" body shapes (top-level `CreateChatCompletionResponse`, `CompletionUsage`, `ChatCompletionResponseMessage`, `CreateChatCompletionStreamResponse`, `ChatCompletionStreamResponseDelta`, `Error`, `ErrorResponse`) is **fact from the OpenAI OpenAPI spec** at `github.com/openai/openai-openapi`, schema lines cited in Evidence.

Everything about response **headers** (`x-request-id`, `openai-organization`, `openai-processing-ms`, `openai-version`, the `x-ratelimit-*` family, `retry-after`) is **inference from OpenAI SDK source / Cookbook examples**. The OpenAPI spec does not document HTTP response headers, and `platform.openai.com/docs` returns 403 to WebFetch. Header names below should be considered "ecosystem-standard and emitted by OpenAI" rather than "spec-quoted":

- `x-request-id` is the strongest of these — explicitly read by the OpenAI Python SDK and referenced in the OpenAPI spec's own curl examples.
- `retry-after` is also strong — the Python SDK's `_base_client.py` reads it (along with the non-standard `retry-after-ms`).
- `openai-organization`, `openai-processing-ms`, `openai-version` and the `x-ratelimit-*` family are commonly observed in OpenAI API responses, but I did not verify them from a fetchable official page in this research pass.

Everything in "Proposed Mongo Storage Shape" is **design proposal**, not fact. Naming and structure are suggestions; the harness owner can rename or restructure freely. The intent (preserve full HTTPS package, not just extracted answer) is the load-bearing part.

### Unconfirmed / could not verify

1. **`platform.openai.com/docs` fetch failures**. Every WebFetch to `platform.openai.com/docs/api-reference/chat/...` or `platform.openai.com/docs/guides/error-codes` returned HTTP 403. As a workaround I used the OpenAI OpenAPI spec (`github.com/openai/openai-openapi`) and the OpenAI Python SDK source. Field names below are verbatim from those sources but **the human-readable docs (e.g. "what each error.code value means in plain English") could not be quoted directly**. If the harness owner needs an authoritative source for `error.code` value catalogs (e.g. `invalid_api_key`, `context_length_exceeded`, `rate_limit_exceeded`, `insufficient_quota`), it should be retrieved via an authenticated channel.

2. **Exact `x-ratelimit-*` header names**. I have not seen the OpenAPI spec or Python SDK enumerate them. They are observed in many community write-ups and OpenAI's own (unreachable here) docs. I am including the canonical six (`x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`) because they appear in the OpenAI Cookbook and the OpenAI Node SDK, but I did not see them quoted in either of the sources I could fetch.

3. **`openai-organization`, `openai-processing-ms`, `openai-version` headers**. Same as #2. Commonly observed in API responses, but not confirmed from the OpenAPI spec or Python SDK source I inspected. Including them in the "store every header" recommendation is safe; relying on their presence in code is not.

4. **Full enumeration of `error.code` values**. The `Error` schema marks `code` as nullable string without an enum. Values like `invalid_api_key`, `model_not_found`, `context_length_exceeded`, `rate_limit_exceeded`, `insufficient_quota`, `tokens_limit_reached` are observed in the wild but not exhaustively listed in the OpenAPI spec. Store the field as a free-form string; do not enum-check it.

5. **Full enumeration of `finish_reason` values**. The spec enum is `stop`, `length`, `tool_calls`, `content_filter`, `function_call`. Reasoning models may emit additional values not present in the public OpenAPI spec snapshot fetched (the spec is updated periodically). Store the field as a free-form string; do not enum-check it.

6. **`reasoning_effort` field — request side**. The app sends `reasoning_effort` (lowercase, hyphenless) when the value is one of `low`, `medium`, `high`, `xhigh` per `OPENAI_REASONING_EFFORTS` (`image-parser.js:81`, `remote-api-providers.js:14`). The OpenAI OpenAPI spec defines `reasoning_effort` via a `ReasoningEffort` ref. I did not inspect the `ReasoningEffort` schema directly — there is some risk that OpenAI accepts only a subset (`low`, `medium`, `high`) and the `xhigh` value is rejected at runtime. The app would observe such a rejection as an HTTP 400 with `error.type: invalid_request_error` and `error.param: reasoning_effort`. **Worth confirming against OpenAI's reasoning-effort docs.**

7. **`reasoning_tokens` reporting on non-reasoning models**. The `usage.completion_tokens_details.reasoning_tokens` field is documented as `default: 0`. On a non-reasoning model the field should be 0 (or absent). I have not verified absent vs zero-valued behavior empirically; the Mongo shape stores `usage` as a subdocument so either form is preserved.

8. **`system_fingerprint` deprecated but emitted**. The OpenAPI spec marks `system_fingerprint` as deprecated but it still appears in the example payload. Worth preserving but harness owners should not build new features on top of it.

9. **`refusal` content path**. When OpenAI refuses, `choices[0].message.content` may be null and `choices[0].message.refusal` is a string. The current `callOpenAI` extracts `parsed.choices?.[0]?.message?.content || ''` (line 1116), which yields an empty string on refusal — the refusal text is dropped. Storing `parsedBody` verbatim in Mongo (per the proposed shape) preserves the refusal text for later inspection.

10. **Validation probe behavior on reasoning models with `max_completion_tokens: 64`**. The probe is intended just to confirm the API key authenticates. With `max_completion_tokens: 64` on a reasoning model, the model may exhaust the budget on internal reasoning tokens and return `choices[0].message.content` as an empty string with `finish_reason: length`. The validation logic treats any 2xx as success (`image-parser.js:608-617`), so this works for "is the key valid?" but means the harness should not assume `parsedBody.content` is non-empty for probe-tagged rows.

11. **No use of `stream_options.include_usage`**. None of the current paths opt into the per-stream usage capture, and the OpenAI usage object is only available in streaming via that opt-in. If a future source path streams, its request package should record whether `stream_options.include_usage` was sent.

12. **No use of the OpenAI Responses API (`/v1/responses`)**. Grep for `v1/responses` in the repo returned zero hits. This document covers `/v1/chat/completions` only. The Responses API has a different (newer) response shape; if the app migrates to it, this document does not apply.

13. **No use of the `openai` npm SDK**. Grep over `package.json` files returned no `openai` or `@openai/sdk` dependency. The server speaks raw HTTPS via Node's `https.request`. If the harness ever introduces the SDK, additional fields (e.g. `_request_id` property on response objects, `withRawResponse()` accessor) become available; the Mongo shape would still work but the "raw package" boundary moves up a layer.

## Evidence

### Repo source (read on current `master` HEAD; line numbers verified)

- `shared/ai-provider-catalog.json:90-103` — `openai` catalog entry (`id`, `label`, `family`, `transport`, `model`, `allowedEfforts`, `supportsThinking`).
- `server/src/services/image-parser.js:55` — `OPENAI_DEFAULT_IMAGE_MODEL` env-driven default (`gpt-5.4-mini` fallback).
- `server/src/services/image-parser.js:56` — `OPENAI_PROVIDER_TEST_MAX_TOKENS = 64`.
- `server/src/services/image-parser.js:65` — `'openai'` in `DIRECT_IMAGE_PARSER_PROVIDER_IDS`.
- `server/src/services/image-parser.js:81` — `OPENAI_REASONING_EFFORTS` set with values `none`, `low`, `medium`, `high`, `xhigh`.
- `server/src/services/image-parser.js:119-127` — `normalizeOpenAiReasoningEffort` and `isOpenAiReasoningModel` (regex matches the gpt-5 family or the o-digit family).
- `server/src/services/image-parser.js:129-140` — `applyOpenAiGenerationOptions` (reasoning branch sets `max_completion_tokens` + `reasoning_effort`; non-reasoning sets `max_tokens` + `temperature: 0.1`).
- `server/src/services/image-parser.js:168` — `openai: 'OPENAI_API_KEY'` in `ENV_KEY_MAP`.
- `server/src/services/image-parser.js:196-208` — validation probe `REMOTE_PROVIDER_TEST_CONFIGS.openai`.
- `server/src/services/image-parser.js:239-266` — `getApiKey` / `resolveApiKey` precedence (file then env then Mongo `ImageParserApiKey`).
- `server/src/services/image-parser.js:331-332` — `getRemoteProviderLabel` returns `'OpenAI'`.
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey` HTTPS call.
- `server/src/services/image-parser.js:754-784` — `jsonRequest` (the raw https.request helper used by image-parser).
- `server/src/services/image-parser.js:789-825` — `normalizeBase64` (produces the `data:<mediaType>;base64,<rawBase64>` URL).
- `server/src/services/image-parser.js:1071-1122` — `callOpenAI` (the production direct-API image-parser call).
- `server/src/services/image-parser.js:1621-1623` — switch-case wiring the `'openai'` provider.
- `server/src/services/image-parser.js:1745-1746` — `validateRemoteProvider('openai', openaiKey)` in `resolveProviderAvailability`.
- `server/src/services/remote-api-providers.js:12` — `DEFAULT_TIMEOUT_MS = 120_000`.
- `server/src/services/remote-api-providers.js:14` — `OPENAI_REASONING_EFFORTS` (duplicate of image-parser set).
- `server/src/services/remote-api-providers.js:29-34` — `PROVIDER_CONFIG.openai` (`defaultModel`, `baseUrl`, `envKey`, `displayName`).
- `server/src/services/remote-api-providers.js:49-70` — `normalizeOpenAiReasoningEffort`, `isOpenAiReasoningModel`, `applyOpenAiGenerationOptions` (chat-leg variant uses `temperature: 0.2`).
- `server/src/services/remote-api-providers.js:81-147` — `jsonRequestCancelable`.
- `server/src/services/remote-api-providers.js:190-205` — `extractOpenAiText` (used by chat-leg).
- `server/src/services/remote-api-providers.js:293-301` — `buildOpenAiMessages`.
- `server/src/services/remote-api-providers.js:380-441` — `requestOpenAiLikeChat` (shared OpenAI-compatible chat caller used by `openai`, `llm-gateway`, `kimi`).
- `server/src/services/remote-api-providers.js:474-506` — `requestOpenAiChat`.
- `server/src/services/remote-api-providers.js:611-665` — `createBufferedChatProvider` (the buffered pseudo-stream adapter).
- `server/src/services/remote-api-providers.js:675-677, 690` — `openai` export wired to `requestOpenAiChat`.
- `server/src/services/providers/registry.js:4` — registry imports `remote-api-providers`.
- `server/src/services/providers/registry.js:50-51` — registry routes `transport: 'openai'` to `remoteApiProviders.openai`.
- `server/src/services/providers/registry.js:84-89` — per-kind OpenAI timeout env vars (`OPENAI_*_TIMEOUT_MS`).
- `server/src/routes/image-parser.js:31` — `'openai'` in the valid-providers list returned by the parser route.
- `server/src/routes/image-parser.js:350` — exposes `openai: !!(stored.openai && stored.openai.trim())` in stored-keys status.
- `server/src/routes/pipeline-tests.js:68` — `openai: 'OpenAI'` label.
- `server/src/routes/pipeline-tests.js:78` — `openai: 'gpt-5.4-mini'` default model in pipeline-tests.
- `server/src/lib/pricing.js:31-54` — OpenAI / Codex model pricing entries (per-token rates), with `openai` entry as a fallback.
- `server/src/lib/usage-extractor.js:40-41, 135-143, 180-181` — OpenAI-style usage extraction (`prompt_tokens` / `completion_tokens`, `openai` in `OPENAI_LIKE_PROVIDERS`).
- `server/src/models/ImageParseResult.js:7` — `'openai'` listed as valid `provider` value in the schema comment.
- `server/src/services/test-runner.js:64-67` — `OPENAI_API_KEY` in `TEST_ENV_STRIP_KEYS`.
- `server/.env.example:36` — `OPENAI_API_KEY=` env var.

### Official documentation (fetched via WebFetch / gh)

- **OpenAI OpenAPI specification**: `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`. The raw file is too large for GitHub's web preview (2.7 MB) — fetched in full via `gh api repos/openai/openai-openapi/contents/openapi.yaml`. Verified schema names and field definitions used in this document:
  - `CreateChatCompletionRequest` — request body schema with `messages`, `model`, `reasoning_effort`, `max_completion_tokens`, `stream`, `stream_options`, `temperature`, `response_format`, etc.
  - `CreateChatCompletionResponse` — lines 42967-43117 (response body schema with `id`, `choices`, `created`, `model`, `service_tier`, `system_fingerprint`, `object`, `usage`; required fields `choices`, `created`, `id`, `model`, `object`).
  - `CreateChatCompletionStreamResponse` — lines 43118-43248 (stream chunk schema with `id`, `choices`, `created`, `model`, `service_tier`, `system_fingerprint`, `object: "chat.completion.chunk"`, optional `usage`).
  - `ChatCompletionResponseMessage` — lines 41151-41281 (`role: "assistant"`, `content`, `refusal`, `tool_calls`, `annotations`, `audio`, deprecated `function_call`).
  - `ChatCompletionStreamResponseDelta` — lines 41346-41390 (`role`, `content`, `refusal`, `tool_calls`, deprecated `function_call`).
  - `CompletionUsage` — lines 41739-41802 (`prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details` with `audio_tokens` and `cached_tokens`, `completion_tokens_details` with `accepted_prediction_tokens`, `audio_tokens`, `reasoning_tokens`, `rejected_prediction_tokens`).
  - `ChatCompletionRequestMessageContentPartImage` — lines 40959-40993 (`type: "image_url"`, `image_url: { url, detail }` where url accepts "Either a URL of the image or the base64 encoded image data").
  - `Error` — lines 47730-47749 (`type`, `message`, `param`, `code` — all required, `param` and `code` nullable).
  - `ErrorResponse` — lines 47768-47774 (wraps `error: Error`).
  - `ErrorEvent` — lines 47750-47767 (SSE mid-stream error frame).
  - `data: [DONE]` sentinel quoted at line 43461 in the description of the `stream` request field.
  - Example curl with `grep -i x-request-id` at line 12637 (image-edit example, but confirms `x-request-id` is treated by OpenAI's own examples as a returned response header).
- **OpenAI Python SDK README**: `https://github.com/openai/openai-python/blob/main/README.md` — confirms `x-request-id` is the OpenAI response header used for correlation: "All object responses in the SDK provide a `_request_id` property which is added from the `x-request-id` response header". Confirms automatic retry on 408, 429, and 5xx (default `max_retries=2`).
- **OpenAI Python SDK `_exceptions.py`**: `https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py` — confirms status-to-exception mapping (400/401/403/404/409/422/429/5xx) and confirms the SDK extracts `type`, `code`, `param` from the error JSON body.
- **OpenAI Python SDK `_base_client.py`**: `https://github.com/openai/openai-python/blob/main/src/openai/_base_client.py` — confirms the SDK reads `retry-after` (seconds, float-tolerant) and the non-standard `retry-after-ms` (milliseconds) response headers when handling 429s.

### Sources attempted but blocked (HTTP 403)

- `https://platform.openai.com/docs/api-reference/chat/create` — 403 to WebFetch. Would be the authoritative human-readable reference for chat completion request/response.
- `https://platform.openai.com/docs/api-reference/chat-streaming` — 403 to WebFetch. Would be the authoritative human-readable reference for streaming chunk format.
- `https://platform.openai.com/docs/guides/error-codes/api-errors` — 403 to WebFetch. Would be the authoritative human-readable catalog of HTTP status codes and `error.code` values.
- `https://help.openai.com/en/articles/6891839-api-error-codes` — 403 to WebFetch.

Authoritative response shapes were instead recovered from the OpenAPI spec (which is the same source those human docs are generated from). Response header names that the OpenAPI spec does not encode (the `x-ratelimit-*` family, `openai-organization`, `openai-processing-ms`, `openai-version`) are documented in the platform.openai.com docs that I could not fetch — flagged in Gaps.

### Command outputs

- `git status` before writing — only the existing `provider-harness-research/` files and `provider-harness-research/providers/anthropic-api.md` are staged/untracked.
- `gh api repos/openai/openai-openapi/contents/openapi.yaml` — returned a 2,827,153-byte YAML file.
