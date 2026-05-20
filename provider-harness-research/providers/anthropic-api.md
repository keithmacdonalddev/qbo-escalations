# anthropic-api Provider Harness Contract

## Summary

This document describes how the qbo-escalations server makes direct HTTPS calls to Anthropic's Messages API at `https://api.anthropic.com/v1/messages`. This is the "direct API" transport — entirely separate from the Claude CLI subprocess transport documented elsewhere.

There are currently three distinct call paths that hit Anthropic's HTTPS endpoint:

1. **Image-parser direct call** (`callAnthropic`) — used by the image-parser pipeline when `provider === 'anthropic'` and the SDK path is opted out via `useStructured === false`. Non-streaming, single-shot, vision (image + text content blocks).
2. **Chat-leg direct call** (`requestAnthropicChat`) — used by the workspace/chat provider registry when an agent is routed to transport `anthropic`. Non-streaming, single-shot, text-only.
3. **Key-validation probe** (`testRemoteProviderKey` for `anthropic`) — minimal HTTP POST to validate a stored API key (`max_tokens: 1`, "hi" message).

**Scope of this contract**: this document covers only the raw HTTPS `POST /v1/messages` exchange between this server and `api.anthropic.com`. A separate "Anthropic Agent SDK" path exists in `server/src/services/sdk-image-parse.js` that uses the `@anthropic-ai/claude-agent-sdk` package and shares the same `ANTHROPIC_API_KEY` env var, but its wire-level package is **not** raw `POST /v1/messages` — the host process never observes the SDK's inner HTTP request/response, only the SDK's own framed message objects. The SDK path is therefore listed in this document as adjacent evidence only; it is **not** the same provider package as the direct API and **must not** be stored in the same raw-HTTPS record shape.

All current paths are **non-streaming** (no `stream: true` flag, no SSE parsing on the server). The earliest server-visible package is the Node `http.IncomingMessage` inside the request callback: status code, status message, headers, raw headers, and ordered body chunks. The helper then collapses that to `{ statusCode, body }` (or `{ statusCode, body, model }` for the validation probe), discarding headers, raw header order, status message, and chunk boundaries before later app code sees the response.

The proposed preservation shape captures the full HTTPS package: status, headers, raw headers, ordered body data, the raw body string exactly as received, the parsed JSON when parseable, request metadata (model, endpoint path, anthropic-version, timeouts), timestamps, and error payloads. Anthropic supports streaming, but no current call site requests it; current-app records should only note that streaming was not requested.

## Provider IDs In This App

Catalog entry (single entry, no aliases):

- `shared/ai-provider-catalog.json:33-46` — `id: "anthropic"`, `family: "anthropic"`, `transport: "anthropic"`, default `model: "claude-sonnet-4-20250514"`, label `"Anthropic API"`.

Other names this id appears under in code:

- `provider === 'anthropic'` — switch cases and validation lists in `server/src/services/image-parser.js:64`, `server/src/services/image-parser.js:1606`, `server/src/services/remote-api-providers.js:23-28`.
- Transport string `'anthropic'` — registry routing in `server/src/services/providers/registry.js:46-47, 72-77`.
- ENV key mapping: `anthropic -> ANTHROPIC_API_KEY` at `server/src/services/image-parser.js:167` and `server/src/services/remote-api-providers.js:26`.
- Display labels: `"Anthropic"` in `getRemoteProviderLabel` at `server/src/services/image-parser.js:330`; `"Anthropic API"` in `PROVIDER_CONFIG.anthropic.displayName` at `server/src/services/remote-api-providers.js:27`.

No additional aliases. There is no `anthropic-api` provider id in the catalog — the catalog id is just `anthropic`. The CLI subprocess transport uses separate catalog ids (`claude`, `claude-opus-4-7`) with `transport: "claude"` and is out of scope here.

## Current App Call Sites

All factual; line numbers verified by Read/Grep on the current `master` HEAD.

### 1. Image-parser direct path

- `server/src/services/image-parser.js:986-1034` — `async function callAnthropic(systemPrompt, rawBase64, mediaType, model, timeoutMs)`
  - Resolves the API key via `resolveApiKey('anthropic')` (`image-parser.js:987`), which checks `data/image-parser-keys.json` first, then `process.env.ANTHROPIC_API_KEY`, then a Mongo `ImageParserApiKey` doc (`image-parser.js:239-266`).
  - Builds a single-turn `messages` body with one user message whose `content` is an array of two blocks: an `image` block (`type: "image"`, `source: { type: "base64", media_type, data }`) and a `text` block.
  - Sends `POST https://api.anthropic.com/v1/messages` via the in-module `jsonRequest()` helper (`image-parser.js:754-784`), which is a thin `https.request` wrapper that accumulates the response body as a string and resolves `{ statusCode, body }`.
  - Treats anything other than HTTP 200 as a hard error, throwing `Error("Anthropic API error (HTTP N): ...")` with `err.code = 'PROVIDER_ERROR'` (`image-parser.js:1014-1018`).
  - Parses the body with `JSON.parse`; on parse failure throws `'PROVIDER_ERROR'` (`image-parser.js:1020-1027`).
  - Pulls `parsed.content?.[0]?.text` for the answer text and a small `{ model, inputTokens, outputTokens }` object from `parsed.usage` (`image-parser.js:1028-1031`).
  - **Returns only**: `{ text: text.trim(), usage }`. The original `res.body` string, `res.statusCode`, response headers, and any non-zero content blocks beyond index 0 are dropped on the floor.

- `server/src/services/image-parser.js:1606-1620` — switch-case wiring inside the main `parseImage` pipeline. When the requested provider is `'anthropic'`:
  - If `useStructured` is truthy, the Anthropic Agent SDK path is taken (see "Adjacent: Anthropic Agent SDK transport" below — that path does **not** speak raw HTTPS `POST /v1/messages` and is not covered by this contract).
  - Otherwise `callAnthropic(...)` is invoked. This is the only place in production code that invokes the raw HTTPS Messages API for image parsing.

### Adjacent: Anthropic Agent SDK transport (different wire protocol — not covered by this contract)

- `server/src/services/image-parser.js:1041-1069` — `async function callAnthropicSdk(...)` delegates to `parseImageWithSDK` in `server/src/services/sdk-image-parse.js`.
- `server/src/services/sdk-image-parse.js:25-31` — lazy-loads `@anthropic-ai/claude-agent-sdk` via dynamic `import()`.
- `server/src/services/sdk-image-parse.js:162-177` — calls `sdk.query({ prompt, options })`, iterates an async generator of SDK message objects (types include `result`, `assistant`).
- This is the **Claude Agent SDK**, not the raw Messages API. It still requires `ANTHROPIC_API_KEY` (`sdk-image-parse.js:140-144` clears the `CLAUDECODE` env var before invocation to avoid nested-session crashes), but the wire format is the SDK's own framed message protocol, not the HTTPS `POST /v1/messages` documented at platform.claude.com. The harness contract for this path is therefore meaningfully different — flagged in Gaps.

### 2. Chat/workspace direct path

- `server/src/services/remote-api-providers.js:317-378` — `function requestAnthropicChat({ messages, systemPrompt, model, timeoutMs, ... })`
  - Same key resolution (`getImageParserApiKey('anthropic')`) at line 326.
  - Builds a text-only body: `{ model, max_tokens: 4096, system: systemPrompt?, messages: [{role, content: text}, ...] }`. Images are intentionally not included in this path — `buildAnthropicMessages` (line 303-308) flattens any structured content via `contentToText` and emits string `content`.
  - POSTs to `/v1/messages` via the in-module `jsonRequestCancelable` (`remote-api-providers.js:81-147`), a cancellable variant of the same `https.request` pattern. Accumulates the full body string and resolves `{ statusCode, body }`.
  - Non-200 → throws `PROVIDER_ERROR` (`remote-api-providers.js:356-358`).
  - On success, `extractAnthropicText(parsed.content)` (line 207-213) joins every `content[].text` block where `type === 'text'`; usage object is the same `{ model, inputTokens, outputTokens }` shape (line 369-376).
  - Returns `{ text, usage }`. Same dropping of raw body/headers/statusCode as the image-parser direct path (section 1).

- `server/src/services/remote-api-providers.js:667-669` — exports `anthropic = { chat: createBufferedChatProvider('anthropic', requestAnthropicChat) }`.
- `createBufferedChatProvider` (line 611-665) wraps the promise and surfaces results via `onChunk`/`onDone`/`onError` callbacks. There is no actual streaming — `onChunk` is called once with the full text right before `onDone` (line 649-650). It's a "buffered" pseudo-stream adapter.
- `server/src/services/providers/registry.js:4, 46-47` — imports `remote-api-providers` and routes `transport: 'anthropic'` to its `chat` function. This is what the workspace/chat routes hit when a user picks an Anthropic-API model from the dropdown.

### 3. Key-validation probe (admin "test API key" button)

- `server/src/services/image-parser.js:185-195` — `REMOTE_PROVIDER_TEST_CONFIGS.anthropic`:
  - hostname `api.anthropic.com`
  - path `/v1/messages`
  - model `claude-sonnet-4-20250514`
  - body `{ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }`
  - headers `x-api-key`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey(provider, apiKey)` constructs the minimal request and POSTs it, again accumulating the body string and resolving `{ statusCode, body, model }`.
- `server/src/services/image-parser.js:516-659` — `validateRemoteProvider(...)` interprets the result: 2xx → `available: true`, 401/403 → `INVALID_KEY`, timeout → `TIMEOUT`, else `PROVIDER_TEST_FAILED`.
- This path also discards the response body string after a quick `JSON.parse` to extract `error.message`.

### Transport summary

All three in-scope production call sites use Node's built-in `https.request` directly (no `fetch`, no `axios`, no `@anthropic-ai/sdk` package). The Anthropic Agent SDK path (listed in the adjacent subsection above) uses dynamic `import('@anthropic-ai/claude-agent-sdk')`, which is a different package and a different wire protocol than the raw Messages API — it is **not** part of this contract.

## Request Package Sent Today

Inferred from current app code at the call sites above. All paths share:

- **Method**: `POST`
- **Scheme/host**: `https://api.anthropic.com`
- **Path**: `/v1/messages`
- **Auth header**: `x-api-key: <ANTHROPIC_API_KEY>` (env var name only; no secret values quoted).
- **Required version header**: `anthropic-version: 2023-06-01`.
- **Content type**: `Content-Type: application/json`; `Accept: application/json` (set by the shared `jsonRequest`/`jsonRequestCancelable` helpers).
- **Content-Length**: computed from `Buffer.byteLength(payload)` (`image-parser.js:767`, `remote-api-providers.js:104-106`).
- **Timeout**: socket-level `timeout` option on the `https.request` options object. Source values:
  - Image-parser default `DEFAULT_TIMEOUT_MS = 120000` (`image-parser.js:57`); callable override via the parser route timeoutMs arg.
  - Chat-leg default `DEFAULT_TIMEOUT_MS = 120_000` (`remote-api-providers.js:12`); per-kind overrides via env vars `ANTHROPIC_CHAT_TIMEOUT_MS`, `ANTHROPIC_PARSE_TIMEOUT_MS`, `ANTHROPIC_TRANSCRIBE_TIMEOUT_MS` (`registry.js:72-77`).
  - Validation probe hardcoded to `10_000` ms (`image-parser.js:498`).
- **No streaming flag**. None of the bodies set `stream: true`.
- **No tools, no thinking, no cache_control, no tool_choice, no metadata fields**. The bodies are minimal.

Mode A — Image-parser (vision, `callAnthropic`):

```
body = {
  model: <effectiveModel> || 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  messages: [{
    role: 'user',
    content: [
      { type: 'image',
        source: { type: 'base64', media_type: <mediaType>, data: <rawBase64> } },
      { type: 'text', text: 'Parse this image.' }
    ]
  }]
}
```

Notes:
- `media_type` is autodetected from base64 magic numbers if no data-URL prefix is supplied (`image-parser.js:808-844`); valid values produced: `image/png`, `image/jpeg`, `image/gif`, `image/webp` (PNG fallback).
- No `temperature`, no `top_p`, no `top_k`. Anthropic uses its own defaults.

Mode B — Chat (text-only, `requestAnthropicChat`):

```
body = {
  model: <effectiveModel> || 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  // system: systemPrompt when provided
  messages: buildAnthropicMessages(messages)
}
```

Notes:
- Chat path coerces all content blocks down to strings — `image` blocks would be discarded if passed in. Consistent with `supportsImageInput: false` for `transport: 'anthropic'` in the registry (no `transcribeImage` function on the `anthropic` service in `remote-api-providers.js`).
- `reasoningEffort` is accepted by the function signature but **ignored** for Anthropic in this path (line 317-324 — no `thinking` field is set). It is honored only for OpenAI in the same module.

Mode C — Validation probe:

```
body = { model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }
```

Used only to confirm a key authenticates. Same headers.

## Official Response Package

Sources (cited in Evidence):

- platform.claude.com Messages API reference (non-streaming success shape, headers).
- platform.claude.com Streaming reference (SSE event types, deltas).
- platform.claude.com Errors reference (HTTP status codes, error.type values, error body shape, request-id header, retry-after, request_id field in body).

### Non-streaming success (HTTP 200)

Top-level body fields (all named exactly):

- `id` — string. Unique message id, e.g. `"msg_1nZdL29xx5MUA1yADyHTEsnR8uuvGzszyY"`.
- `type` — string, always `"message"`.
- `role` — string, always `"assistant"`.
- `content` — array of content blocks. Each block has `type`. For text answers: `{ type: "text", text: "..." }`. For tool use: `{ type: "tool_use", id, name, input }`. For extended thinking: `{ type: "thinking", thinking: "...", signature: "..." }`. Other types exist (e.g. `server_tool_use`, `web_search_tool_result`); the spec allows new ones over time.
- `model` — string. Echo of the model that actually generated the response (may differ from the requested alias).
- `stop_reason` — string. Documented values: `"end_turn"`, `"stop_sequence"`, `"max_tokens"`. Additional values exist for tool use flows (`"tool_use"` is shown in the streaming docs).
- `stop_sequence` — string or null.
- `usage` — object with:
  - `input_tokens` (number)
  - `output_tokens` (number)
  - `cache_creation_input_tokens` (number)
  - `cache_read_input_tokens` (number)
  - `server_tool_use` (number when applicable; can also appear as a nested object in some responses — see Gaps)

### Response headers (success and error)

Per the Errors page, **every** response includes:

- `request-id` — lowercase header name, value shape `req_018EeWyXxfu5pfWkrYcMdjWG`. This is the canonical correlation id.

Rate-limit headers (success responses; reported by the docs):

- `anthropic-ratelimit-requests-limit`
- `anthropic-ratelimit-requests-remaining`
- `anthropic-ratelimit-requests-reset`
- `anthropic-ratelimit-tokens-limit`
- `anthropic-ratelimit-tokens-remaining`
- `anthropic-ratelimit-tokens-reset`

On 429 responses there is typically also a `retry-after` header (called out indirectly via the Errors page; flagged in Gaps because I did not find an explicit guarantee in the fetched copy).

### Error responses

HTTP status to `error.type` mapping (from the Errors page):

| status | `error.type` |
|---|---|
| 400 | `invalid_request_error` |
| 401 | `authentication_error` |
| 402 | `billing_error` |
| 403 | `permission_error` |
| 404 | `not_found_error` |
| 413 | `request_too_large` |
| 429 | `rate_limit_error` |
| 500 | `api_error` |
| 504 | `timeout_error` |
| 529 | `overloaded_error` |

JSON error body shape (always returned as JSON):

```
{
  "type": "error",
  "error": { "type": "<one of the values above>", "message": "<human-readable>" },
  "request_id": "req_011CSHoEeqs5C35K2UUqR7Fy"
}
```

Note: `request_id` also appears as a top-level body field, in addition to the `request-id` HTTP header. Both names are documented.

Streaming errors (mid-stream after a 200): can arrive as `event: error` SSE frames with the same `{type: "error", error: {type, message}}` payload shape (see streaming section).

### Streaming response (when `stream: true` is set)

Not currently used by this app (confirmed by grep — see Streaming section). This section is provider-capability reference only.

Wire format: Server-Sent Events.

- `Content-Type: text/event-stream`.
- Each event framed as two lines: `event: <name>` then `data: <json>` then a blank line. Both lines are present and the `data` JSON `type` field mirrors the event name.

Event flow per the docs:

1. `message_start` — `data.message` is a partial Message object with `content: []` and an initial `usage` (input_tokens populated, output_tokens may be ~1).
2. For each content block, in order:
   - `content_block_start` — `data.index`, `data.content_block` (initial block with empty `text` / `input`).
   - One or more `content_block_delta` — `data.index`, `data.delta`. Delta variants:
     - `text_delta` -> `{ type: "text_delta", text: "..." }`
     - `input_json_delta` -> `{ type: "input_json_delta", partial_json: "..." }` (chunked partial JSON; concatenate to rebuild)
     - `thinking_delta` -> `{ type: "thinking_delta", thinking: "..." }`
     - `signature_delta` -> `{ type: "signature_delta", signature: "..." }` (emitted before `content_block_stop` for `thinking` blocks)
   - `content_block_stop` — `data.index`.
3. One or more `message_delta` — `data.delta` with top-level changes (`stop_reason`, `stop_sequence`) and `data.usage` (cumulative output tokens; the docs explicitly warn the token counts here are cumulative).
4. `message_stop` — terminal frame.

Additionally:

- `ping` events can appear at any point; payload `{ "type": "ping" }`. Treat as keepalive.
- `error` events can appear mid-stream after a 200; payload matches the non-streaming error body shape.
- The docs state new event types may be added; consumers should ignore unknown ones.

Final response reconstruction: accumulate deltas onto the `message_start.message` skeleton; final Message is what the SDKs produce as `accumulated_message` / `finalMessage` / `Accumulate(event)`.

## Streaming vs Non-Streaming

**This app currently uses non-streaming for all direct-API Anthropic calls.** Verified via `Grep` over `server/src/services/remote-api-providers.js` for `stream` / `sse` (no matches) and inspection of `callAnthropic` and `requestAnthropicChat` bodies (no `stream: true`).

Notes:

- The `createBufferedChatProvider` wrapper (`remote-api-providers.js:611-665`) simulates a "stream" for downstream callers by emitting one `onChunk` with the full text right before `onDone`. This is buffer-then-fire, not a real SSE stream. The wire request is still non-streaming.
- The SDK path (`sdk-image-parse.js`) does iterate an async generator (`for await (const msg of q)`, line 171), but those are SDK message objects, not raw Messages-API SSE frames. The Agent SDK abstracts that away.
- Anthropic docs recommend streaming for any non-streaming request whose `max_tokens` is high enough that it could exceed a 10-minute timeout. Current code caps `max_tokens` at 4096 (image parser + chat) or 1 (validation probe), so the 10-minute risk is not currently triggered.
- Anthropic streaming remains provider-capability reference only in this document. Current app paths do not receive SSE frames from the direct API.

## Raw Package That Reaches This Server Today

This section describes only the three in-scope HTTPS call sites (`callAnthropic`, `requestAnthropicChat`, `testRemoteProviderKey`). The Anthropic Agent SDK path is excluded — the host process never sees its underlying HTTP request/response, only SDK message objects, so its first server-visible object is a different shape and is not part of this contract.

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
- `server/src/services/remote-api-providers.js:108-118` — same pattern inside `jsonRequestCancelable`.
- `server/src/services/image-parser.js:499-503` — same pattern inside `testRemoteProviderKey`.

At the call site, the helper-normalized object is bound to `const res = await jsonRequest(...)` (or `const response = await request.promise` in the cancelable variant). So **`res.body`** / **`response.body`** is the helper-normalized raw response string. It is not the complete raw HTTP package because headers, raw header order, status message, HTTP version, and chunk boundaries have already been discarded.

### What is preserved vs discarded today

Preserved through the immediate helper:

- `res.statusCode` — survives as far as the call site, where it is checked but not stored.
- `res.body` — the full unparsed JSON string. The call site uses up to 500 chars of it in error messages, then calls `JSON.parse` on it and only keeps `parsed.content[0].text`, `parsed.usage.input_tokens`, `parsed.usage.output_tokens`, and `parsed.model`.

Discarded (currently never escapes the helper):

- **All response headers**, including `request-id`, `anthropic-ratelimit-*`, `retry-after`. The `res.on('end', ...)` callback resolves only `{ statusCode, body }` — `res.headers` is never captured.
- **Every content block past index 0**. `parsed.content?.[0]?.text` only reads the first block text. If Anthropic returns a thinking block at index 0 and a text block at index 1, the text answer would be missed by this path. (The chat path uses `extractAnthropicText(parsed.content)` which joins all `type === 'text'` blocks, so it is slightly more robust — but still drops non-text blocks.)
- `parsed.id`, `parsed.type`, `parsed.role`, `parsed.stop_reason`, `parsed.stop_sequence` — fully discarded.
- `parsed.usage.cache_creation_input_tokens`, `parsed.usage.cache_read_input_tokens`, `parsed.usage.server_tool_use` — discarded by the `{ model, inputTokens, outputTokens }` shape.
- Error response body details (`error.message`, `error.type`, body-level `request_id`) — only `error.message` is surfaced into a thrown Error.message, the rest is lost.

There are no SSE chunks today because no path opts into streaming.

## Proposed Mongo Storage Shape

Goal: preserve the full raw HTTPS response package for the direct `POST /v1/messages` call, sufficient for later inspection/debug/audit.

**Scope boundary**: this shape applies only to the three in-scope direct-HTTPS call sites. The Anthropic Agent SDK path is **explicitly out of scope** because it exposes SDK message objects to this server, not this raw HTTP package. Do not co-mingle SDK rows into this record shape. The single value documented for `transport` here is `"anthropic-api-https"`.

Field naming below is suggestive — the harness can adopt any naming convention. Required vs Optional is from the perspective of "do we lose audit value if it is missing".

### Suggested record shape

#### Required

- `_id` — Mongo default.
- `provider` — `"anthropic"` (matches catalog id).
- `transport` — `"anthropic-api-https"`. **Only documented value**. The catalog transport string is `"anthropic"`; this record narrows that to the raw-HTTPS variant. SDK-based calls require a different discriminator (e.g. `"anthropic-agent-sdk"`) and a different record schema; do not insert SDK rows here under `"anthropic"` or any other transport value.
- `callerSite` — enum of `"image-parser"`, `"chat"`, `"validation-probe"`. Identifies which in-scope code path made the raw-HTTPS call. **Does not** include `"sdk-image-parse"` — that path produces a different wire-level package and belongs in its own record (see scope boundary above).
- `requestStartedAt` — ISO timestamp captured immediately before the `req.end()` call.
- `requestFinishedAt` — ISO timestamp captured at the `res.on('end')` resolve.
- `durationMs` — elapsed time between `requestStartedAt` and `requestFinishedAt`.
- `request`:
  - `method` — `"POST"`.
  - `url` — full URL string: `https://api.anthropic.com/v1/messages`.
  - `anthropicVersion` — value of the `anthropic-version` header sent (currently always `"2023-06-01"`).
  - `headersSent` — object map. **Must redact `x-api-key`** (store `"<redacted>"` or `null`); store everything else verbatim.
  - `body` — the exact JSON object posted (after `JSON.stringify` or before, but stored as a Mongo subdocument). Includes `model`, `max_tokens`, `system`, `messages`, and any provider request fields the app sends.
  - `bodyByteLength` — `Buffer.byteLength(JSON.stringify(body))`. Useful for the 32 MB endpoint limit.
  - `timeoutMs` — value passed to `https.request`.
- `response`:
  - `statusCode` — integer.
  - `statusMessage` — string if present on the Node response object.
  - `headers` — full object map of `res.headers` (Node lowercases header names). At minimum the harness should retain: `request-id`, `content-type`, `anthropic-ratelimit-requests-limit`, `anthropic-ratelimit-requests-remaining`, `anthropic-ratelimit-requests-reset`, `anthropic-ratelimit-tokens-limit`, `anthropic-ratelimit-tokens-remaining`, `anthropic-ratelimit-tokens-reset`, `retry-after` (when present), `anthropic-organization-id` (sometimes returned; flagged in Gaps).
  - `rawHeaders` — raw header array from `res.rawHeaders`, preserving original order/casing as Node exposes it.
  - `rawBody` — the **unparsed** UTF-8 body string exactly as received. This is the audit-grade record; do not store only the parsed JSON. Type: string.
  - `bodyByteLength` — `Buffer.byteLength(rawBody)`. Useful for spotting truncation.
  - `bodyChunks` — ordered raw chunk records or external payload references if exact chunk boundaries are preserved.
  - `parsedBody` — `JSON.parse(rawBody)` if parsing succeeds; otherwise `null` plus a `parseError` field.
- `outcome` — enum: `"success"` (HTTP 2xx, JSON parsed, top-level `type === "message"`), `"http_error"` (non-2xx), `"network_error"` (socket error, timeout, abort), `"invalid_json"`.

#### Optional but high-value

- `response.parsedBody` must preserve the full provider JSON, including message id, model echo, `stop_reason`, `usage`, and the complete `content[]` block array. Do not preserve only the first text block.
- `error` — populated when `outcome !== "success"`:
  - `kind` — `"http_error"` | `"network_error"` | `"invalid_json"`.
  - `httpStatus` — HTTP status copied from the raw response when present.
  - `anthropicErrorType` — from `parsedBody.error.type` (e.g. `"invalid_request_error"`).
  - `anthropicErrorMessage` — from `parsedBody.error.message`.
  - `anthropicRequestId` — from `parsedBody.request_id` (body-level) or `response.headers["request-id"]`.
  - `nodeErrorCode` — e.g. `"ECONNRESET"`, `"ETIMEDOUT"`, `"ABORT_ERR"`.
- `images` — when the image-parser path made the call:
  - `count`.
  - For each image: `mediaType`, `byteLength` (decoded), `sha256Digest`, and an optional raw-byte reference if preserving the full request body inline would exceed storage limits.

#### Streaming status (not current)

- `streaming` — `{ requested: false }` for all current direct-API Anthropic calls.
- No current direct-API Anthropic call receives SSE frames, so ordered streaming events are not part of the current Mongo preservation shape. The official streaming package is documented above only as provider capability context; if this app later sends `stream: true`, that new current package should be researched and documented as a separate update.

#### Storage / size notes (not policy)

- The Messages API request size limit is 32 MB (per Errors page). Image-parser bodies can be a few MB each because base64 image data is inline. Preserve the full value inline or by external payload reference if it is too large for one document; the exact storage mechanism is out of scope.
- Response bodies for current non-streaming calls are typically small (a few KB). If a future current path streams, large event payloads may require an external payload reference; that future mechanism is out of scope for this document.
- Header redaction: only `x-api-key` is sensitive in our outgoing headers. None of the Anthropic response headers known to me are sensitive — `request-id` is non-sensitive by design.

## Gaps And Questions

### Facts vs assumptions

Everything in "Provider IDs", "Current App Call Sites", and "Raw Package That Reaches This Server Today" is **fact** — confirmed by reading the named source files at the named line numbers on the current `master` HEAD.

Everything in "Official Response Package" and the streaming subsection is **fact from official docs**, confirmed by WebFetch against the platform.claude.com Messages, Streaming, and Errors pages. Field names and event names are quoted verbatim from those pages.

Everything in "Proposed Mongo Storage Shape" is **design proposal**, not fact. Naming and structure are suggestions; the harness owner can rename or restructure freely. The intent (preserve full HTTPS package, not just extracted answer) is the load-bearing part.

### Unconfirmed / could not verify

1. **`server_tool_use` exact shape**. The Messages reference lists `server_tool_use` as a `usage` field (treated like a token count). The streaming web-search example in the Streaming doc shows `usage.server_tool_use: { web_search_requests: 1 }` — i.e. a nested object, not a number. Both forms appear in official docs. The Mongo shape stores `usage` as a subdocument so either form is preserved, but the harness should not assume the type is `number`.

2. **`retry-after` header on 429**. Strongly implied by the Errors page rate-limit discussion, but the page I fetched did not explicitly list `retry-after` as a guaranteed header. I am including it in the Mongo shape because (a) it is HTTP-standard for 429 and (b) Anthropic SDKs honor it, but I did not see a quoted guarantee.

3. **`anthropic-organization-id` response header**. Some Anthropic docs and SDK code mention this header. I did not see it in the platform.claude.com pages I fetched. Including it in the "store every header" recommendation is safe; relying on it for indexing is not.

4. **Full enumeration of `stop_reason` values**. The non-streaming Messages reference lists `end_turn`, `stop_sequence`, `max_tokens`. The Streaming example payloads also show `tool_use` and pause-turn style flows. There may be additional values (e.g. `refusal`) that the harness will eventually see. Store the field as a free-form string; do not enum-check it.

5. **Full enumeration of content block `type` values**. Confirmed: `text`, `tool_use`, `thinking`, `server_tool_use`, `web_search_tool_result`. There are likely more (e.g. image content blocks returned by some tools, citation blocks). The Mongo shape stores `content` as a free-form array so additions do not require a migration.

6. **`max_tokens` ceiling for the current image-parser model**. Code hardcodes `4096` (`image-parser.js:998`). Anthropic models have higher ceilings for `claude-sonnet-4-20250514`; this is not a Mongo-shape concern but should be noted if the harness wants to track per-model limits.

7. **Anthropic Agent SDK path — confirmed out of scope for this document.** The SDK does eventually hit the Anthropic HTTPS endpoint, but the host process only ever sees SDK-level message objects, not the underlying HTTP request/response. Its wire-level package is therefore a different shape from the raw `POST /v1/messages` exchange this contract covers, and the Mongo shape above explicitly excludes it (`transport` is pinned to `"anthropic-api-https"`, `callerSite` does not enumerate `"sdk-image-parse"`). Whether to capture SDK rows at all, and where to store them if so, is a separate design question and is **out of scope for this document** — not an open contract question against this record.

8. **Whether the `request-id` HTTP header and the body-level `request_id` field always agree**. The Errors page treats them as the same value. On non-error 200 responses I do not have a quoted guarantee that the body contains `request_id` at all — the success response examples in the Messages reference do not show it. The Mongo shape stores both independently to avoid that question.

9. **API-key validation probe — does Anthropic reject `max_tokens: 1` with HTTP 200 + a truncated message, or does it 200 normally?** The current probe code treats any 2xx as success regardless of body shape (`image-parser.js:608-617`). That is fine for "is the key valid?" but means the harness should not assume `parsedBody.content` is non-empty for probe-tagged rows.

10. **Streaming over HTTP/2 and trailing headers**. Anthropic supports HTTP/2 for SSE. Trailing headers are theoretically possible; I did not find documentation either way. The Mongo `response.headers` object should be populated from `res.headers` (Node lowercases header names; the harness may want to store `res.trailers` separately if it ever sees them).

## Evidence

### Repo source (read on current `master` HEAD; line numbers verified)

- `shared/ai-provider-catalog.json:33-46` — anthropic catalog entry.
- `server/src/services/image-parser.js:64` — `'anthropic'` in `DIRECT_IMAGE_PARSER_PROVIDER_IDS`.
- `server/src/services/image-parser.js:167` — `anthropic: 'ANTHROPIC_API_KEY'` in `ENV_KEY_MAP`.
- `server/src/services/image-parser.js:185-195` — validation probe `REMOTE_PROVIDER_TEST_CONFIGS.anthropic`.
- `server/src/services/image-parser.js:239-266` — `getApiKey` / `resolveApiKey` precedence (file -> env -> Mongo `ImageParserApiKey`).
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey` HTTPS call.
- `server/src/services/image-parser.js:754-784` — `jsonRequest` (the raw https.request helper used by image-parser).
- `server/src/services/image-parser.js:986-1034` — `callAnthropic` (the production direct-API image-parser call).
- `server/src/services/image-parser.js:1041-1069` — `callAnthropicSdk` (Agent SDK delegate).
- `server/src/services/image-parser.js:1606-1620` — switch-case wiring the `'anthropic'` provider.
- `server/src/services/remote-api-providers.js:23-28` — `PROVIDER_CONFIG.anthropic`.
- `server/src/services/remote-api-providers.js:81-147` — `jsonRequestCancelable`.
- `server/src/services/remote-api-providers.js:207-213` — `extractAnthropicText`.
- `server/src/services/remote-api-providers.js:303-308` — `buildAnthropicMessages`.
- `server/src/services/remote-api-providers.js:317-378` — `requestAnthropicChat` (the production direct-API chat call).
- `server/src/services/remote-api-providers.js:611-665` — `createBufferedChatProvider` (the buffered pseudo-stream adapter).
- `server/src/services/remote-api-providers.js:667-669` — `anthropic` export wired to `requestAnthropicChat`.
- `server/src/services/providers/registry.js:4` — registry imports `remote-api-providers`.
- `server/src/services/providers/registry.js:46-47` — registry routes `transport: 'anthropic'` to `remoteApiProviders.anthropic`.
- `server/src/services/providers/registry.js:72-77` — per-kind Anthropic timeout env vars (`ANTHROPIC_*_TIMEOUT_MS`).
- `server/src/services/sdk-image-parse.js:25-31, 95-247` — Agent SDK delegate (`parseImageWithSDK`).
- `server/.env.example:35` — `ANTHROPIC_API_KEY=` env var.

### Official documentation (fetched via WebFetch)

- **Messages API reference**: `https://platform.claude.com/docs/en/api/messages` (originally `https://docs.anthropic.com/en/api/messages`, 301s to platform.claude.com).
  - Confirmed property names: `id`, `type`, `role`, `content`, `model`, `stop_reason`, `stop_sequence`, `usage`.
  - Confirmed `usage` fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `server_tool_use`.
  - Confirmed response headers: `request-id`, `anthropic-ratelimit-requests-{limit,remaining,reset}`, `anthropic-ratelimit-tokens-{limit,remaining,reset}`.
  - Confirmed `stop_reason` values: `end_turn`, `stop_sequence`, `max_tokens` (additional values exist elsewhere).
- **Streaming reference**: `https://platform.claude.com/docs/en/api/messages-streaming` (originally `https://docs.anthropic.com/en/api/messages-streaming`).
  - Confirmed SSE event types: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error`.
  - Confirmed delta types: `text_delta`, `input_json_delta`, `thinking_delta`, `signature_delta`.
  - Confirmed framing: `event: <name>` then `data: <json>` then a blank line; `data.type` mirrors event name.
  - Confirmed: `message_delta.usage` token counts are cumulative.
  - Confirmed: `error` events can arrive mid-stream after a 200; unknown event types should be ignored.
- **Errors reference**: `https://platform.claude.com/docs/en/api/errors` (originally `https://docs.anthropic.com/en/api/errors`).
  - Confirmed HTTP status to `error.type` table (400 -> `invalid_request_error`, 401 -> `authentication_error`, 402 -> `billing_error`, 403 -> `permission_error`, 404 -> `not_found_error`, 413 -> `request_too_large`, 429 -> `rate_limit_error`, 500 -> `api_error`, 504 -> `timeout_error`, 529 -> `overloaded_error`).
  - Confirmed error body shape: `{ "type": "error", "error": { "type", "message" }, "request_id": "req_..." }`.
  - Confirmed `request-id` HTTP header is canonical correlation id, example value shape `req_018EeWyXxfu5pfWkrYcMdjWG`.
  - Confirmed request size limits: Messages API 32 MB, Files API 500 MB, Batch API 256 MB.
