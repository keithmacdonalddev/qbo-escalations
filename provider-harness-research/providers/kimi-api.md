# kimi-api Provider Harness Contract

## Summary

- Provider path type: Direct HTTPS to Moonshot REST endpoint (OpenAI-compatible chat completions). No SDK, no streaming.
- Current implementation status: Two application model paths plus one key-validation probe exist today — (1) image parser leg (`callKimi` in `server/src/services/image-parser.js`); (2) chat/agent leg via `requestKimiChat` in `server/src/services/remote-api-providers.js`, dispatched through `server/src/services/providers/registry.js`; (3) key-validation probe (`REMOTE_PROVIDER_TEST_CONFIGS.kimi` driven by `validateRemoteProvider('kimi', …)`).
- Full package preservation status: Not preserved. At the true raw boundary the Node HTTP response object exposes status, headers, raw headers, and ordered body chunks, but current helpers collapse that to `{ statusCode, body }` for model calls and `{ statusCode, body, model }` for the validation probe. After provider-specific parsing, only the extracted assistant `text` and a small `usage` subset (`inputTokens`, `outputTokens`, `model`) flow downstream. Raw HTTP body, headers, `id`, `created`, `object`, `finish_reason`, `cached_tokens`, and any `reasoning_content` are discarded before durable storage.
- Main uncertainty: Whether the Moonshot endpoint actually returns provider request id headers (e.g., `x-request-id` / `Msh-Trace-Id`) — current code never reads response headers, so this cannot be confirmed from logs in-repo.

## Provider IDs In This App

- Exact app id: `kimi` (transport id and catalog id). No provider id literally named `kimi-api` exists in source — that is a research-folder naming convention only.
- Research label: `kimi-api` (maps to app id/transport `kimi`).
- Aliases / catalog ids: Single catalog entry `id: "kimi"`, `family: "kimi"`, `transport: "kimi"`. No additional aliases.
- UI labels: `label: "Kimi API"`, `shortLabel: "Kimi"`. `getRemoteProviderLabel('kimi')` returns `"Moonshot"` (server-side logs/errors).
- Default model: `kimi-k2.5` (defined in catalog at `shared/ai-provider-catalog.json:156`, in `image-parser.js:212`, in `image-parser.js:1268`, and in `remote-api-providers.js:42`).
- Environment variables:
  - `MOONSHOT_API_KEY` (auth; mapped in `image-parser.js:169` and `remote-api-providers.js:44`).
  - `KIMI_TRANSCRIBE_TIMEOUT_MS` / `MOONSHOT_TRANSCRIBE_TIMEOUT_MS`
  - `KIMI_PARSE_TIMEOUT_MS` / `MOONSHOT_PARSE_TIMEOUT_MS`
  - `KIMI_CHAT_TIMEOUT_MS` / `MOONSHOT_CHAT_TIMEOUT_MS` (all in `providers/registry.js:96-101`)
- Evidence: `shared/ai-provider-catalog.json:148-161`, `server/src/services/image-parser.js:66,169,209-213`, `server/src/services/remote-api-providers.js:41-46`, `server/.env.example:37`.

## Current App Call Sites

Two application model paths plus one key-validation probe send real HTTPS requests to Moonshot today.

1. Image parser leg — `server/src/services/image-parser.js:1260` `callKimi(systemPrompt, imageDataUrl, model, timeoutMs)`
   - What it does: Resolves the Moonshot API key (stored file -> `MOONSHOT_API_KEY` env fallback), builds an OpenAI-compatible chat-completions body with `system` + `user` messages where the user content is a two-part array (`{type:"text"}` + `{type:"image_url"}` with a base64 data URL), POSTs to `https://api.moonshot.ai/v1/chat/completions` via the local `jsonRequest` helper, parses the JSON, returns `{ text, usage }` where `text = parsed.choices[0].message.content` and `usage = { model, inputTokens: prompt_tokens, outputTokens: completion_tokens }`.
   - Provider path type: Direct HTTPS, non-streaming, single round-trip.
   - Dispatched from: `image-parser.js:1627-1628` (switch on `provider === 'kimi'`).

2. Chat/agent leg — `server/src/services/remote-api-providers.js:508` `requestKimiChat({ messages, systemPrompt, model, timeoutMs, ... })`
   - What it does: Resolves API key via shared `getApiKey('kimi')`, then delegates to `requestOpenAiLikeChat` (same file, line 380) with `providerId: 'kimi'`, `baseUrl: 'https://api.moonshot.ai'`. That helper POSTs `/v1/chat/completions` with `model`, `messages` (system prepended), `max_tokens: 4096`, `temperature: 0.2`, returns `{ text: extractOpenAiText(parsed.choices[0].message), usage }`.
   - Wrapped by `createBufferedChatProvider('kimi', requestKimiChat)` at line 684, exposed as `kimi.chat`. Called by `providers/registry.js:55` for the `kimi` transport. No `transcribeImage` method is registered for `kimi` here (image parser leg is separate).
   - Provider path type: Direct HTTPS, non-streaming, buffered — the wrapper invokes `onChunk(result.text)` once with the full text and then `onDone`.
   - Evidence: `server/src/services/remote-api-providers.js:380-441,508-538,683-685`; `server/src/services/providers/registry.js:54-55`.

3. Key-validation probe — `server/src/services/image-parser.js:209-218` `REMOTE_PROVIDER_TEST_CONFIGS.kimi`, invoked through `validateRemoteProvider('kimi', kimiKey)` at `image-parser.js:1748-1749`.
   - What it does: Issues a minimal `POST /v1/chat/completions` with `{ model: 'kimi-k2.5', max_tokens: 1, temperature: 1, messages: [{ role: 'user', content: 'hi' }] }` and `Authorization: Bearer <key>` to verify the key works. The probe is a real Moonshot HTTPS request. It uses the inline `testRemoteProviderKey()` request wrapper, not `jsonRequest`; that wrapper buffers the response into `{ statusCode, body, model: cfg.model }` and then `validateRemoteProvider()` uses it only to compute an availability boolean.

## Request Package Sent Today

### Image parser leg (multimodal)

- Endpoint: `POST https://api.moonshot.ai/v1/chat/completions`
- Auth mechanism: HTTP `Authorization: Bearer <MOONSHOT_API_KEY>` header.
- Headers (set by `jsonRequest` in `image-parser.js:754`): `Content-Type: application/json`, `Accept: application/json`, `Content-Length`, plus the `Authorization` header.
- Request body (JSON):
  - `model`: `"kimi-k2.5"` (or override)
  - `max_tokens`: `4096`
  - `temperature`: `1`
  - `messages`: `[ { role: "system", content: <systemPrompt> }, { role: "user", content: [ { type: "text", text: "Parse this image." }, { type: "image_url", image_url: { url: "data:<mediaType>;base64,<...>" } } ] } ]`
- Streaming flag: Not set (defaults to non-streaming).
- Timeout: Passed in by caller; resolved in `providers/registry.js` via `KIMI_*` / `MOONSHOT_*` env vars; otherwise the global `DEFAULT_TIMEOUT_MS` (120000 ms) applies inside `jsonRequest` (default `30000` ms there if undefined).
- Evidence: `server/src/services/image-parser.js:1260-1307`, `jsonRequest` at `image-parser.js:754-784`.

### Chat/agent leg (text)

- Endpoint: `POST https://api.moonshot.ai/v1/chat/completions`
- Auth mechanism: `Authorization: Bearer <MOONSHOT_API_KEY>`.
- Request body (built by `requestOpenAiLikeChat`):
  - `model`: `"kimi-k2.5"` (or override)
  - `messages`: system prepended, then normalized user/assistant turns (string content only).
  - `max_tokens`: `4096`
  - `temperature`: `0.2`
- Streaming flag: Not set; non-streaming.
- Timeout: Resolved per leg (transcribe/parse/chat) via the `KIMI_*` / `MOONSHOT_*` env vars in `providers/registry.js:96-101`.
- Evidence: `server/src/services/remote-api-providers.js:380-441,508-538`.

### Key-validation probe

- Endpoint: `POST https://api.moonshot.ai/v1/chat/completions`
- Auth mechanism: `Authorization: Bearer <MOONSHOT_API_KEY>`.
- Request body (JSON): `{ "model": "kimi-k2.5", "max_tokens": 1, "temperature": 1, "messages": [{ "role": "user", "content": "hi" }] }`.
- Streaming flag: Not set.
- Evidence: `server/src/services/image-parser.js:209-218,470-514,1748-1749`.

## Official Response Package

Sources (all confirmed via WebFetch on the dates this document was written):
- `https://platform.kimi.ai/docs/api/chat` (canonical; `https://platform.moonshot.ai/docs/api/chat` returns 301 to this host)
- `https://platform.kimi.ai/docs/api/overview`
- `https://platform.kimi.ai/docs/api/errors`
- `https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model`
- `https://platform.kimi.ai/docs/guide/utilize-the-streaming-output-feature-of-kimi-api`

Base URL (overview doc): `https://api.moonshot.ai`; full chat path `https://api.moonshot.ai/v1/chat/completions`. OpenAI Chat Completions compatible.

Success shape (non-streaming, `Content-Type: application/json`):
- `id`: string (e.g., `"cmpl-04ea926191a14749b7f2c7a48a68abc6"`)
- `object`: `"chat.completion"`
- `created`: unix-seconds integer
- `model`: string (provider-confirmed model id, may differ from request)
- `choices`: array of `{ index, message: { role, content }, finish_reason }`
- `usage`: `{ prompt_tokens, completion_tokens, total_tokens, cached_tokens }`

Finish reasons (chat docs): `stop`, `length`, `tool_calls`.

Thinking-mode message field — `choices[].message.reasoning_content`:
- Official-doc-backed for thinking-capable Kimi models. The K2 thinking guide (`docs/guide/use-kimi-k2-thinking-model`) names the field literally as `reasoning_content` and states it appears on both streaming and non-streaming responses; in streaming it always appears before `content`. The same docs say `reasoning_content` is enabled by default on `kimi-k2-thinking` and `kimi-k2.6` (the latter can be disabled via `extra_body.thinking = {"type":"disabled"}`).
- Also confirmed by app source: `image-parser.js:1338` explicitly inspects `parsed.choices[0].message.reasoning_content` in the verbose log. If present in a response, this field is part of the package and should be preserved.

Error response package (errors doc + overview doc):
- JSON body shape (errors doc): `{ "error": { "type": "...", "message": "..." } }`. The errors page documents only `type` and `message` inside `error` — no `code` field is shown there. (Earlier draft of this document showed `error.code`; that was not confirmed by the current Kimi errors docs and has been removed from the official shape. If a `code` field appears in real responses it is unconfirmed/provider-added and would still land in `parsedJson` because the proposed Mongo shape stores both the raw body text and the parsed JSON verbatim.)
- HTTP status codes documented (errors doc):
  - `400` Bad Request
  - `401` Authentication Error
  - `403` Permission Denied
  - `404` Not Found
  - `429` Rate Limit / Quota Exceeded
  - `500` Server Error
- 429 is part of the official Kimi error package. This document does not design retry behavior; the point is only that if a 429 response reaches this server, its status, headers, and body should be preserved like any other response.

Streaming chunk shape (reference only — this app does not stream Kimi):
- Streaming is enabled in the request by setting `stream: true` (streaming guide).
- Per-chunk shape (from the streaming guide): each SSE `data:` line carries an object like `{ "id": "cmpl-…", "object": "chat.completion.chunk", "created": <int>, "model": "kimi-k2.6", "choices": [{ "index": 0, "delta": { "content": "Hello" }, "finish_reason": null }] }`. `delta.role` appears only in the first chunk; the terminator is `data: [DONE]`.
- Final chunk and usage: current Kimi streaming docs show a final SSE chunk that carries `"delta":{}`, `"finish_reason":"stop"`, and a `"usage":{ "prompt_tokens", "completion_tokens", "total_tokens" }` block. Preserve ordered chunks exactly as received rather than assuming a separate option controls usage emission.

Documentation links: see the five Sources URLs at the top of this section.

## Streaming vs Non-Streaming

- Current app behavior: Non-streaming for all three call sites. No `stream: true` flag is set in `callKimi`, `requestOpenAiLikeChat`, or `REMOTE_PROVIDER_TEST_CONFIGS.kimi`. The full HTTP response body is buffered into `data` inside `jsonRequest`, `jsonRequestCancelable`, or the inline `testRemoteProviderKey()` wrapper before resolving.
- Final response detection: HTTP `res.on('end', ...)` fires once after the response body is fully received. The model-call helpers resolve `{ statusCode, body }`; the validation wrapper resolves `{ statusCode, body, model: cfg.model }`. The chat-leg wrapper then synthesises a single `onChunk(text)` followed by `onDone(text, usage)` (`remote-api-providers.js:646-651`).
- Provider capability: Streaming is supported by Moonshot/Kimi (`stream: true`, OpenAI-style SSE chunks with `chat.completion.chunk` objects and a `data: [DONE]` terminator). Documented but unused here; no current call site receives or stores Kimi SSE chunks.
- Evidence: `server/src/services/image-parser.js:470-514,754-784,1305-1307`; `server/src/services/remote-api-providers.js:81-147,415,646-651`.

## Raw Package That Reaches This Server Today

- First server-visible package: the Node `http.IncomingMessage` response object inside each request callback.
  - Image-parser leg: `transport.request(options, (res) => { ... })` inside `jsonRequest` (`image-parser.js:769-773`), called by `callKimi` at `image-parser.js:1305`.
  - Chat leg: `transport.request(options, (res) => { ... })` inside `jsonRequestCancelable` (`remote-api-providers.js:108-117`), called by `requestOpenAiLikeChat` for Kimi.
  - Key-validation probe: `requestLib.request(..., (res) => { ... })` inside `testRemoteProviderKey` (`image-parser.js:491-503`). This path is inline and does not use `jsonRequest`.
- Fields present at the true raw boundary: `res.statusCode`, `res.statusMessage`, `res.headers`, `res.rawHeaders`, `res.httpVersion`, ordered body chunks from `res.on('data', chunk => ...)`, and socket/error/timeout events on the request object.
- Helper-normalized object after buffering:
  - Image-parser leg variable: `res` at `image-parser.js:1305`, shape `{ statusCode, body }`.
  - Chat leg variable: `response` at `remote-api-providers.js:415`, shape `{ statusCode, body }`.
  - Validation probe variable: `result` inside `validateRemoteProvider`, shape `{ statusCode, body, model: cfg.model }`.
- Fields still present at the helper-normalized boundary: HTTP status code; full response body string, which (on success) JSON-parses into the complete Moonshot payload — `id`, `object`, `created`, `model`, `choices[*]` (including `index`, `message.role`, `message.content`, `message.reasoning_content`, `finish_reason`), `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`, `usage.cached_tokens` (when present).
- Fields already discarded by the time the response reaches the helper's caller: response headers, raw header order, HTTP status message, HTTP version, body chunk boundaries, per-chunk timing, and request socket event detail.
- After provider-specific parsing, only `{ text, usage }` survives:
    - `text` is `parsed.choices[0].message.content` trimmed.
    - `usage` is `{ model, inputTokens, outputTokens }` (no `total_tokens`, no `cached_tokens`).
    - Discarded from the JSON itself by the caller: `id`, `object`, `created`, top-level `model` (kept only inside `usage.model`), `choices[].index`, `choices[].finish_reason`, `choices[].message.role`, `choices[].message.reasoning_content`, `usage.total_tokens`, `usage.cached_tokens`, anything else Moonshot may add.
- On error: `res.body` is truncated to `slice(0, 500)` and embedded into an Error message (`image-parser.js:1317`, `remote-api-providers.js:222-226`); the raw body string is never persisted.
- Evidence: `server/src/services/image-parser.js:470-514,754-784,1305-1347`; `server/src/services/remote-api-providers.js:108-118,415-439`; `server/src/models/ImageParseResult.js` schema lacks any raw-package field.

## Proposed Mongo Storage Shape

Goal: preserve the full provider package for inspection/debug/audit — exactly what Moonshot returned. Record-shape level only; implementation choices are out of scope.

Required fields:

- `providerId`: `"kimi"` (matches app transport id).
- `providerPathType`: `"direct-https"` (literal label; differentiates from CLI/SDK/gateway).
- `request`:
  - `endpointUrl`: `"https://api.moonshot.ai/v1/chat/completions"`
  - `method`: `"POST"`
  - `headersSent`: object with `Content-Type`, `Accept`, `Content-Length` (do NOT store `Authorization`; record `authScheme: "bearer"` and `authKeyEnv: "MOONSHOT_API_KEY"` instead).
  - `bodyJson`: the exact request body object (`model`, `messages`, `max_tokens`, `temperature`, plus any future fields).
  - `modelRequested`: e.g. `"kimi-k2.5"`.
  - `timeoutMs`: number passed to `jsonRequest`.
  - `leg`: `"image-parse" | "chat" | "validate"` (which call site).
- `response`:
  - `statusCode`: HTTP integer (e.g., 200, 400, 401, 403, 404, 429, 500).
  - `statusMessage`: HTTP status message if present on the Node response object.
  - `headers`: full response header object from `res.headers`.
  - `rawHeaders`: raw header array from `res.rawHeaders`, preserving original order/casing as Node exposes it.
  - `rawBodyText`: raw response body string exactly as received (pre-`JSON.parse`).
  - `bodyChunks`: ordered raw chunk records or external payload references if exact chunk boundaries are preserved.
  - `parsedJson`: `JSON.parse(rawBodyText)` if it parsed successfully; otherwise `null`.
- `timing`:
  - `requestStartedAt`: Date.
  - `responseReceivedAt`: Date.
  - `providerLatencyMs`: integer (`responseReceivedAt - requestStartedAt`).
- `status`: `"ok" | "error" | "timeout" | "aborted" | "invalid_json"`.
- `error`:
  - `code`: app-side error code (`"PROVIDER_ERROR" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "ABORT"`).
  - `message`: error message string.
  - `httpStatusCode`: copy of `response.statusCode` when error came from HTTP.
  - `bodySnippet`: present-day code already truncates body to 500 chars for Error messages — keep the full body in `response.rawBodyText` instead.

Optional / provider-specific fields:

- `parsedJson` (already required): explicitly includes the Moonshot-specific fields — `id`, `object`, `created`, `model`, `choices[].index`, `choices[].finish_reason`, `choices[].message.role`, `choices[].message.content`, `choices[].message.reasoning_content` (thinking-capable models), `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`, `usage.cached_tokens`. Any unexpected extras (e.g., a `code` inside `error`) are preserved by `rawBodyText` + `parsedJson` even though the official errors doc lists only `type` + `message`.
- `streamChunks`: NOT CURRENT. Kimi supports `stream: true`, but this app does not set it on any Kimi path today. Current-app records should store this as absent/null or `requested: false`; a future streamed Kimi path would need its own researched package boundary.
- `usage` (denormalised mirror for inspection/correlation without re-parsing): `{ model, promptTokens, completionTokens, totalTokens, cachedTokens }`.
- `providerRequestId`: extracted from response headers (e.g., `x-request-id`) when available — see `headers` caveat. Not present in the JSON body.
- `model`: `parsedJson.model` (provider-confirmed model id, may differ from `request.bodyJson.model`).
- `finishReason`: `parsedJson.choices[0].finish_reason` for inspection/correlation without re-parsing.
- `reasoningContentPresent`: boolean — Moonshot may emit `reasoning_content` on thinking-capable models (see Official Response Package).

Storage notes:

- `request.bodyJson` will include base64 image data URLs for the image-parser leg; a single image request can be sizeable. Preserve the full value inline or by external payload reference if it is too large for one document. MongoDB's 16 MB BSON document limit is a factual constraint to keep in mind; the exact storage mechanism is out of scope.
- `response.rawBodyText` is typically small (single-digit KB) for non-streaming chat completions, so storing inline is usually fine.
- Do NOT store `Authorization` header values. Record `authScheme` and the env var name instead.

## Gaps And Questions

- Facts not confirmed:
  - Whether Moonshot returns an `x-request-id` (or equivalent) HTTP header. The overview/errors/chat docs did not enumerate response headers; the app never reads them, so logs cannot answer this either.
  - Whether the China endpoint (`api.moonshot.cn`) is interchangeable for this account or returns identical shapes — this app only uses `api.moonshot.ai`.
  - Whether real Moonshot error bodies sometimes include an `error.code` field even though the current errors doc lists only `error.type` + `error.message`.
- Assumptions (not confirmed in code or in the docs pages fetched):
  - That `usage.cached_tokens` always appears when applicable (the chat docs example shows it; the docs do not say whether it is omitted on non-cached responses).
- Questions for follow-up research:
  - Are there per-account/per-model request-id headers that would let us correlate Mongo records with Moonshot's own logs?

## Evidence

- Source references:
  - `shared/ai-provider-catalog.json:148-161`
  - `server/src/services/image-parser.js:60-68` (provider id list), `:165-171` (env map), `:209-218` (validation probe config), `:325-340` (label mapper), `:754-784` (`jsonRequest`), `:1258-1348` (`callKimi`), `:1627-1628` (dispatch), `:1748-1749` (`validateRemoteProvider`).
  - `server/src/services/remote-api-providers.js:41-46` (PROVIDER_CONFIG.kimi), `:81-147` (`jsonRequestCancelable`), `:380-441` (`requestOpenAiLikeChat`), `:508-538` (`requestKimiChat`), `:611-665` (`createBufferedChatProvider`), `:683-685,692,709` (exports).
  - `server/src/services/providers/registry.js:40-60,54-55,96-101`.
  - `server/src/models/ImageParseResult.js:1-55` (no raw-package fields today).
  - `server/.env.example:37` (`MOONSHOT_API_KEY`).
- Official docs:
  - `https://platform.kimi.ai/docs/api/chat`
  - `https://platform.kimi.ai/docs/api/overview`
  - `https://platform.kimi.ai/docs/api/errors`
  - `https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model`
  - `https://platform.kimi.ai/docs/guide/utilize-the-streaming-output-feature-of-kimi-api`
  - `https://platform.moonshot.ai/docs/api/chat` (returns 301 to the kimi.ai host above)
- Command outputs: `rg -n "kimi|moonshot" server/src` (case-insensitive sweep) returned only the call sites listed under Source references above — no other production source files reference the provider.
