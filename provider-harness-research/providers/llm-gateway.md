# llm-gateway Provider Harness Contract

## Summary

The `llm-gateway` provider is a **local Express service** at `http://127.0.0.1:4100` (separate project at `C:\Projects\llm-gateway`) that qbo-escalations talks to over plain HTTP. The gateway exposes an OpenAI-shaped surface (`POST /v1/chat/completions`, `GET /v1/provider-status`, `GET /v1/models`, `GET /v1/usage`) protected by a bearer-token API key, and proxies chat requests to a local LM Studio instance at `http://127.0.0.1:1234`.

Research label: `llm-gateway`. Actual app provider id: also `llm-gateway` — confirmed in `shared/ai-provider-catalog.json:48-59` (`id: "llm-gateway"`, `transport: "llm-gateway"`, `family: "llm-gateway"`, default `model: "auto"`).

There are **two distinct package boundaries** at play, and this document keeps them separate throughout:

1. **qbo -> llm-gateway -> qbo** (the package qbo actually receives). This is the boundary the harness needs to preserve.
2. **llm-gateway -> LM Studio -> llm-gateway** (everything the gateway does upstream). This is gateway-side context and clearly labelled as **not qbo-visible** in this document. Preserving the upstream LM Studio package would require a separate gateway-side harness, not the qbo provider harness.

The qbo-escalations server hits the gateway from **three call sites**, all non-streaming on the wire from qbo's point of view:

1. **Image-parser direct path** — `server/src/services/image-parser.js:1124-1179` `callLlmGateway()`. `POST /v1/chat/completions` with an OpenAI-shape multi-part user message that inlines the screenshot as a `data:` URL. **This path is the only one that sends `chat_template_kwargs: { enable_thinking: false }`.**
2. **Chat / workspace path** — `server/src/services/remote-api-providers.js:443-472` `requestLlmGatewayChat()` -> `requestOpenAiLikeChat({ providerId: 'llm-gateway' })` (lines 380-441). `POST /v1/chat/completions` with text-only messages. Body fields are `model`, `messages`, `max_tokens`, `temperature` only — **no `chat_template_kwargs`, no `stream`.**
3. **Key-validation probe** — `server/src/services/image-parser.js:173-184` `REMOTE_PROVIDER_TEST_CONFIGS['llm-gateway']`. `GET /v1/provider-status` with the bearer token; **no body.**

The **raw package boundary** on the qbo side is two-layered:

- **First layer (true raw)**: the Node `http.IncomingMessage` (`res`) inside each helper's `transport.request(options, (res) => {...})` callback. At that point qbo's process has access to `res.statusCode`, `res.statusMessage`, `res.headers`, `res.rawHeaders`, and the response body as a sequence of chunks via `res.on('data', chunk => ...)`. This is the earliest observable provider-response unit in qbo server code.
- **Second layer (after helper buffering)**: the helper concatenates chunks into a UTF-8 string and resolves either `{ statusCode, body }` (the two POST helpers) or `{ statusCode, body, model: cfg.model }` (the probe helper). **At the resolve step the helper discards all response headers, X-Request-Id, raw header order, the status message, the raw chunk boundaries, and the per-chunk timing.** Sources: `server/src/services/image-parser.js:754-784` (the `jsonRequest` helper), `server/src/services/remote-api-providers.js:108-118` (the `jsonRequestCancelable` helper), and `server/src/services/image-parser.js:491-503` (the inline wrapper for the provider-status probe).

For non-streaming `POST /v1/chat/completions`, the gateway's response body is an OpenAI-shape JSON object (`id`, `object`, `created`, `model`, `choices[]`, `usage`) with an **additional `gateway` object** the gateway adds before returning to qbo — `gateway.usage`, `gateway.cost`, optionally `gateway.credits` (documented in `docs/API.md:1032-1054`, code at `C:\Projects\llm-gateway\src\routes\chat.js:111-152, 299-312`). qbo currently extracts only `choices[0].message.content` (with `reasoning_content` fallback) and `{ model, inputTokens, outputTokens }` from `usage.prompt_tokens`/`usage.completion_tokens`. The `gateway` object, the `X-Request-Id` header, `system_fingerprint`, `finish_reason`, `total_tokens`, and the raw body string are all discarded.

## Provider IDs In This App

Catalog entry (single entry, no aliases):

- `shared/ai-provider-catalog.json:48-59` — `id: "llm-gateway"`, `label: "LLM Gateway API"`, `shortLabel: "Gateway"`, `family: "llm-gateway"`, `transport: "llm-gateway"`, default `model: "auto"`, `selectable: true`, `order: 28`, `allowedEfforts: ["low","medium","high","xhigh"]`, `supportsThinking: false`, `iconStrategy: "runtime-model-family"` (icon picked at runtime from whatever model LM Studio reports).

Names this id appears under in qbo-escalations code:

- Switch / case `'llm-gateway'`:
  - `server/src/services/image-parser.js:62` — in `DIRECT_IMAGE_PARSER_PROVIDER_IDS`.
  - `server/src/services/image-parser.js:327` — `getRemoteProviderLabel` returns `'LLM Gateway'`.
  - `server/src/services/image-parser.js:540, 641` — `validateRemoteProvider` provider-specific branches.
  - `server/src/services/image-parser.js:1600-1601` — switch-case wiring inside `parseImage` -> `callLlmGateway`.
  - `server/src/services/providers/registry.js:48-49` — transport `'llm-gateway'` -> `remoteApiProviders.llmGateway`.
  - `server/src/services/providers/registry.js:78-83` — per-kind timeout env vars (`LLM_GATEWAY_TRANSCRIBE_TIMEOUT_MS`, `LLM_GATEWAY_PARSE_TIMEOUT_MS`, `LLM_GATEWAY_CHAT_TIMEOUT_MS`).
  - `server/src/routes/image-parser.js:29` — `'llm-gateway'` in `VALID_KEY_PROVIDERS`.
  - `server/src/routes/image-parser.js:348` — `'llm-gateway'` listed in stored-keys status.
  - `server/src/routes/pipeline-tests.js:65, 75` — pipeline-tests label `'Gateway'`, default model `'auto'`.
  - `server/src/models/ImageParseResult.js:7` — `'llm-gateway'` listed as a valid `provider` value in the schema comment.

- Env var consumers (`server/src/services/image-parser.js:53-54, 166`; `server/src/services/remote-api-providers.js:17-22`):
  - `LLM_GATEWAY_API_URL` (default `http://127.0.0.1:4100`) — base URL for both modules.
  - `LLM_GATEWAY_API_KEY` — bearer token. Optional: if absent, qbo still sends the request without an `Authorization` header (`image-parser.js:1149`, `remote-api-providers.js:410`).
  - `LLM_GATEWAY_DEFAULT_MODEL` (default `auto`) — model id sent in the request body when the caller does not specify one.
  - `LLM_GATEWAY_CHAT_TIMEOUT_MS`, `LLM_GATEWAY_PARSE_TIMEOUT_MS`, `LLM_GATEWAY_TRANSCRIBE_TIMEOUT_MS` — per-kind timeout overrides.

- Test-runner env strip list (`server/src/services/test-runner.js:69, 72-73`): `LLM_GATEWAY_API_KEY`, `LLM_GATEWAY_API_URL`, `LLM_GATEWAY_DEFAULT_MODEL`.

UI labels: `label: "LLM Gateway API"`, `shortLabel: "Gateway"` (catalog). Display label inside the image-parser availability path: `'LLM Gateway'` (`image-parser.js:328`).

**No `llm-gateway` SDK is installed.** qbo speaks raw HTTP via Node's built-in `http`/`https` modules (`image-parser.js:754-784`, `remote-api-providers.js:81-147`).

## Current App Call Sites

All factual; line numbers verified against the current branch.

### 1. Image-parser direct path — `callLlmGateway()`

- `server/src/services/image-parser.js:1124-1179` — `async function callLlmGateway(systemPrompt, imageDataUrl, model, timeoutMs)`.
  - Resolves the bearer token via `resolveApiKey('llm-gateway')` (line 1128). Resolution order (`image-parser.js:239-266`): stored file -> `LLM_GATEWAY_API_KEY` env var -> Mongo `ImageParserApiKey` doc. **If no key is found, `apiKey` is `null` and the request is sent without `Authorization`.**
  - Effective model: `model || LLM_GATEWAY_DEFAULT_MODEL` (line 1130). With no overrides this is `'auto'`.
  - Builds a 2-message body (lines 1132-1147): a `system` message with `systemPrompt`, and a `user` message whose `content` is the two-part OpenAI vision shape — `{ type: 'text', text: 'Parse this image.' }` plus `{ type: 'image_url', image_url: { url: <data URL> } }`. The `imageDataUrl` argument is the value produced by `normalizeBase64(...)` -> `dataUrl` in the caller switch (`image-parser.js:1600-1601`), i.e. `data:image/<mediaType>;base64,<rawBase64>`.
  - Sets `chat_template_kwargs: { enable_thinking: false }` at line 1146. This is an LM Studio / llama.cpp passthrough that suppresses chain-of-thought on reasoning models when LM Studio is the upstream. **This field is sent only on this image-parser path; the chat/workspace path does not include it.**
  - Sets `max_tokens: 4096`, `temperature: 0.1`. **No `stream` field.** **No `stream_options`.** **No `top_p`, no `tools`, no `response_format`, no `seed`, no `reasoning_effort`** (even though the catalog declares `allowedEfforts: ["low","medium","high","xhigh"]` — the parser path ignores it).
  - Headers: `{ Authorization: 'Bearer <key>' }` only when a key was resolved; otherwise an empty object (line 1149). The shared `jsonRequest` helper (lines 754-784) then layers on `Content-Type: application/json`, `Accept: application/json`, and `Content-Length`.
  - POST: `jsonRequest('POST', LLM_GATEWAY_API_URL, '/v1/chat/completions', body, headers, timeoutMs)` (line 1150). Default timeout from `parseImage`: `DEFAULT_TIMEOUT_MS = 120000` (`image-parser.js:57, 1533`).
  - Non-200 handling: 401 / 403 with no API key -> throws `Error('LLM Gateway requires an API key')` with `code: 'PROVIDER_UNAVAILABLE'` (lines 1152-1157). Any other non-200 -> `Error('LLM Gateway API error (HTTP N): <first 500 chars of body>')` with `code: 'PROVIDER_ERROR'` (lines 1158-1161).
  - JSON parse failure -> `Error('LLM Gateway returned invalid JSON: <first 200 chars>')` with `code: 'PROVIDER_ERROR'` (lines 1163-1170).
  - Success path: extracts `parsed.choices?.[0]?.message?.content || msg.reasoning_content || ''` (lines 1172-1173). Builds `usage = { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }` (lines 1174-1176). Returns `{ text: text.trim(), usage }` (line 1178).
  - **Discarded by this path**: the raw `res.body` string, `res.statusCode` (only checked, not stored), every response header (including the gateway's `X-Request-Id`), `parsed.id`, `parsed.object`, `parsed.created`, `parsed.system_fingerprint`, `choices[0].finish_reason`, `choices[0].logprobs`, `usage.total_tokens`, and — load-bearing for this provider — the entire `gateway` object that the gateway adds to non-streaming responses (`gateway.usage`, `gateway.cost`, `gateway.credits`).

### 2. Chat / workspace path — `requestLlmGatewayChat()` -> `requestOpenAiLikeChat()`

- `server/src/services/remote-api-providers.js:443-472` — `function requestLlmGatewayChat({ messages, systemPrompt, model, reasoningEffort, timeoutMs, requestFn, getApiKeyFn })`.
  - Resolves the key via `getApiKeyFn('llm-gateway')` (line 453). Reuses the same `resolveApiKey('llm-gateway')` resolver as the parser path (see import at line 5).
  - Delegates to `requestOpenAiLikeChat({ providerId: 'llm-gateway', baseUrl: PROVIDER_CONFIG['llm-gateway'].baseUrl, apiKey, apiKeyOptional: true, messages, systemPrompt, model, timeoutMs, requestFn })` (lines 458-468). **Important: `reasoningEffort` is accepted as a function argument but never forwarded into the request body** — see line 466 (missing from the spread).
- `server/src/services/remote-api-providers.js:380-441` — `requestOpenAiLikeChat({ ... })`. Shared for `openai`, `kimi`, and `llm-gateway`.
  - Effective model: `model || PROVIDER_CONFIG['llm-gateway'].defaultModel` (line 393) — falls back to `process.env.LLM_GATEWAY_DEFAULT_MODEL || 'auto'` (lines 17-22).
  - Body fields actually set on this path (lines 394-403): `model`, `messages`, `max_tokens: 4096`, `temperature: 0.2`. **Nothing else.** No `stream`, no `stream_options`, no `chat_template_kwargs`, no `reasoning_effort`, no `top_p`. `buildOpenAiMessages` (line 293-301) produces text-only messages; image content parts are stripped by `normalizeMessages` -> `contentToText` (lines 175-188, 161-173).
  - Headers: `apiKey ? { Authorization: 'Bearer <key>' } : {}` (line 410). Then `jsonRequestCancelable` adds `Accept: application/json`, `Content-Type: application/json`, `Content-Length`.
  - Request: `requestFn('POST', baseUrl, '/v1/chat/completions', body, ...headers..., timeoutMs)` at lines 405-412. `baseUrl` is `process.env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100'`.
  - Non-200 handling: if status is 401 / 403 **and** `!apiKey && apiKeyOptional` (true for llm-gateway via line 462), throws `'LLM Gateway requires an API key'` with `code: 'PROVIDER_UNAVAILABLE'` (lines 416-419). Otherwise throws `LLM Gateway API error (HTTP N): <first 500 chars>` with `code: 'PROVIDER_ERROR'` (line 420).
  - Success path: `JSON.parse(response.body)` (line 425), then `extractOpenAiText(parsed.choices?.[0]?.message)` (lines 190-205) which returns `message.content` if string, `message.content[].text` joined if array, otherwise `message.reasoning_content`. Usage object: `{ model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }` (lines 432-438). Returns `{ text, usage }`.
- Exposed as `module.exports.llmGateway.chat = createBufferedChatProvider('llm-gateway', requestLlmGatewayChat)` (`remote-api-providers.js:671-672, 689`). The "buffered" adapter (lines 611-665) calls `onThinkingChunk('')`, then `onChunk(result.text)` once, then `onDone(text, usage)` — it is a fake stream, not a real SSE stream.
- Wired via `server/src/services/providers/registry.js:48-49` for `transport: 'llm-gateway'`.

### 3. Provider validation probe — `GET /v1/provider-status`

- `server/src/services/image-parser.js:173-184` — `REMOTE_PROVIDER_TEST_CONFIGS['llm-gateway']`. Configures a `GET` to `LLM_GATEWAY_API_URL` + `/v1/provider-status`, no body, headers `{ Authorization: 'Bearer <key>', Accept: 'application/json' }`.
- `server/src/services/image-parser.js:470-514` — `testRemoteProviderKey(provider, apiKey)`. Hardcoded `timeout: 10_000` ms (line 498). Resolves `{ statusCode, body, model: cfg.model }` (line 502).
- `server/src/services/image-parser.js:516-659` — `validateRemoteProvider('llm-gateway', apiKey)`. Branches at line 540:
  - 2xx -> `{ ok: true, available: true, code: 'OK', reason: 'Authenticated', model: getGatewayProviderStatusModel(parsedBody) }` (lines 541-551). `getGatewayProviderStatusModel` extracts a model name from `parsedBody.upstream.loadedModel` / `availableModel`.
  - 401 / 403 -> `code: 'INVALID_KEY'`, `reason: 'API key rejected'` (lines 561-571).
  - 504 -> `code: 'TIMEOUT'`, `reason: 'Gateway validation timed out'` (lines 573-583).
  - 503 -> `code: 'PROVIDER_UNAVAILABLE'`, `reason: getGatewayUnavailableReason(parsedBody.error?.code, detail)` (lines 585-595).
  - Anything else -> `code: 'PROVIDER_TEST_FAILED'` (lines 597-605).
- The probe response body **is** JSON-parsed (`parseProviderJson(result.body)` at line 539) and inspected for `error.code` and `upstream.loadedModel`/`availableModel`. The raw body string is not stored; only `reason` / `detail` survive (lines 539-605).
- Wired into the parser route at `server/src/services/image-parser.js:1717-1719` (inside `resolveProviderAvailability`).

### Transport summary

All three call sites use Node's built-in `http`/`https.request`. Each path uses its own helper — and each helper independently discards `res.headers`:

- `callLlmGateway()` uses `jsonRequest(...)` at `server/src/services/image-parser.js:1150`. Helper at `image-parser.js:754-784`. Resolves `{ statusCode, body }`. Default fallback timeout 30000 ms (line 765); `callLlmGateway` always passes an explicit timeout.
- `requestOpenAiLikeChat()` (used by the chat path) calls into `jsonRequestCancelable(...)` through its `requestFn` parameter at `server/src/services/remote-api-providers.js:405-415`. Helper at `remote-api-providers.js:81-147`. Resolves `{ statusCode: res.statusCode || 0, body: data }`. Default fallback timeout `DEFAULT_TIMEOUT_MS = 120_000` (line 12).
- `testRemoteProviderKey()` uses its own inline `requestLib.request(...)` wrapper at `server/src/services/image-parser.js:491-503`. Resolves `{ statusCode, body, model: cfg.model }`. Hardcoded 10000 ms timeout.

**Confirmed key fact**: in all three helpers, the `(res) => { ... }` callback only reads `res.on('data')` and `res.on('end')`. `res.headers`, `res.rawHeaders`, `res.httpVersion`, `res.statusMessage` are never referenced.

## Request Package Sent Today

What qbo puts on the wire to the gateway. Common across the two POST paths:

- **Method**: `POST`
- **Scheme/host**: `http://127.0.0.1:4100` (default loopback/localhost URL) or whatever `LLM_GATEWAY_API_URL` is set to.
- **Path**: `/v1/chat/completions`
- **Auth header**: `Authorization: Bearer <LLM_GATEWAY_API_KEY>` only when a key is resolved. **Both POST paths will send the request with no `Authorization` header when no key is configured.** The gateway will then reject with 401 and qbo translates that to `PROVIDER_UNAVAILABLE` (image-parser.js:1153-1156; remote-api-providers.js:417-419).
- **Content type**: `Content-Type: application/json`, `Accept: application/json`. `Content-Length` is computed from `Buffer.byteLength(JSON.stringify(body))`.
- **Streaming**: **`stream` is never set on either POST path.** No `stream_options.include_usage` is ever requested. **qbo does not opt into streaming from the gateway today.**

The two POST paths send **different body shapes**. The image-parser path includes `chat_template_kwargs`; the chat/workspace path does not.

### Mode A — Image parser (`callLlmGateway`)

Source: `server/src/services/image-parser.js:1132-1147`.

```
body = {
  model: <effectiveModel>,                       // 'auto' by default; passed through unchanged to LM Studio if not 'auto'
  max_tokens: 4096,
  temperature: 0.1,
  messages: [
    { role: 'system', content: <systemPrompt> },
    { role: 'user', content: [
        { type: 'text', text: 'Parse this image.' },
        { type: 'image_url', image_url: { url: 'data:image/<mediaType>;base64,<rawBase64>' } }
      ]
    }
  ],
  chat_template_kwargs: { enable_thinking: false }
}
```

Notes:

- `<mediaType>` is `image/png`, `image/jpeg`, `image/gif`, or `image/webp` from `normalizeBase64` / `detectMediaTypeFromBase64`. The screenshot bytes are inlined into the JSON request body as base64 inside a `data:` URL — large screenshots can push the body to several MB.
- Default `timeoutMs` arrives from `parseImage` at `image-parser.js:1533`: `DEFAULT_TIMEOUT_MS = 120000`.

### Mode B — Chat / workspace (`requestOpenAiLikeChat` for `llm-gateway`)

Source: `server/src/services/remote-api-providers.js:394-403`.

```
body = {
  model: <effectiveModel>,            // 'auto' by default
  messages: [
    // optional system message:
    { role: 'system', content: <systemPrompt> },
    // then each caller message flattened to a plain string:
    { role: 'user'|'assistant'|'system', content: '<flattened text>' }
    ...
  ],
  max_tokens: 4096,
  temperature: 0.2
}
```

Notes:

- Only four body fields are set on this path: `model`, `messages`, `max_tokens`, `temperature`. **No `chat_template_kwargs`**, no `stream`, no `stream_options`, no `reasoning_effort`, no `top_p`.
- Image content parts are **stripped** by `normalizeMessages` / `contentToText` — the chat path is text-only.
- `reasoningEffort` is dropped at the providerId === `'llm-gateway'` branch (see line 466 of `remote-api-providers.js` — `reasoningEffort` is named but not spread into the inner call).
- Default timeout comes from `registry.js:151` via `getDefaultTimeoutMs()` which reads `LLM_GATEWAY_CHAT_TIMEOUT_MS`, falling back to `120_000`.

### Mode C — Provider validation probe

Source: `server/src/services/image-parser.js:173-184, 470-514`.

```
GET http://127.0.0.1:4100/v1/provider-status
Authorization: Bearer <key>
Accept: application/json
```

No body. Hardcoded 10_000 ms timeout.

## Official Response Package

Source for everything in this section: local llm-gateway documentation and source. **The local llm-gateway docs are the contract** for this provider, not generic OpenAI docs. Where OpenAI-compat shape is preserved, it is preserved because the gateway forwards LM Studio's body (which itself mirrors OpenAI shape) and then augments it.

### Common response headers

Per `C:\Projects\llm-gateway\src\app.js:25-29`, **every** gateway response sets `X-Request-Id` to a freshly generated UUID v4 (`crypto.randomUUID()`). Also confirmed in `docs/API.md:267`. qbo currently discards this header.

Bodies are returned with `Content-Type: application/json` for non-streaming chat (Express default via `res.json`) or `Content-Type: text/event-stream` for streaming chat (`chat.js:282`).

### Non-streaming `POST /v1/chat/completions` (200)

From `docs/API.md:1009-1054` and code at `C:\Projects\llm-gateway\src\routes\chat.js:299-312, 140-152, 111-138`:

The gateway awaits LM Studio's full JSON response, parses it, calculates token usage and cost from the active billing settings, then returns the LM Studio body **with an additional top-level `gateway` object spread in**. Code (chat.js:140-152):

```
return {
  ...body,
  gateway: {
    ...(body.gateway && typeof body.gateway === 'object' ? body.gateway : {}),
    ...createGatewayUsagePayload(usageMetrics, creditSnapshot)
  }
};
```

`createGatewayUsagePayload` (lines 111-138) produces:

```
{
  usage: {
    prompt_tokens: <int>,
    completion_tokens: <int>,
    total_tokens: <int>
  },
  cost: {
    currency: "USD",
    prompt_cost_usd: <number>,
    completion_cost_usd: <number>,
    total_cost_usd: <number>,
    prompt_cost_per_1m_usd: <number>,
    completion_cost_per_1m_usd: <number>,
    pricing_source: "default" | "model_override"
  },
  credits: {                       // present only when creditSnapshot is truthy — managed key with a billable debit
    balance_usd: <number>,
    total_granted_usd: <number>,
    total_charged_usd: <number>
  }
}
```

Documented example (`docs/API.md:1011-1054`):

```
{
  "id": "chatcmpl-local-123",
  "object": "chat.completion",
  "created": 1760000000,
  "model": "qwen/qwen3.5-9b",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Here is a short summary." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 43, "completion_tokens": 12, "total_tokens": 55 },
  "gateway": {
    "usage": { "prompt_tokens": 43, "completion_tokens": 12, "total_tokens": 55 },
    "cost": {
      "currency": "USD",
      "prompt_cost_usd": 0.000006,
      "completion_cost_usd": 0.000007,
      "total_cost_usd": 0.000013,
      "prompt_cost_per_1m_usd": 0.15,
      "completion_cost_per_1m_usd": 0.60,
      "pricing_source": "default"
    },
    "credits": {
      "balance_usd": 49.999987,
      "total_granted_usd": 50,
      "total_charged_usd": 0.000013
    }
  }
}
```

The `id`, `object`, `created`, `model`, `choices`, `usage` fields come from LM Studio verbatim (gateway only injects `gateway`, see chat.js:140-152). The model identifier is whatever LM Studio echoes — typically the local model id, e.g. `qwen/qwen3.5-9b`.

### Streaming `POST /v1/chat/completions` (when caller sets `stream: true`)

**qbo never opts into streaming today.** Documented for completeness because the gateway supports it.

From `docs/API.md:976-985` and `chat.js:280-296`:

- Wire shape: `Content-Type: text/event-stream` (gateway copies LM Studio's content-type header — chat.js:282). SSE frames are relayed from LM Studio chunk-by-chunk via `pipeline(Readable.fromWeb(response.body), createStreamingUsageTransform(...), res)` (chat.js:290-294).
- The transform (`chat.js:176-240`) parses each SSE `data: <json>` line, captures `payload.model` and `payload.usage` for gateway-side billing, but **the chunks are passed through unmodified** (`callback(null, chunk)` at line 234). No mutation of the chunk content.
- The terminator is whatever LM Studio sends — i.e. `data: [DONE]` (gateway does not synthesize its own).
- **The gateway does NOT inject `gateway.cost` / `gateway.credits` into the SSE stream** (docs/API.md:983: "the gateway does not inject a final `gateway.cost` or `gateway.credits` object into SSE events"). To learn the billed total after a streamed request, a client must call `GET /v1/usage` separately.
- Stream chunk shape mirrors OpenAI's `chat.completion.chunk` (because LM Studio mirrors OpenAI). qbo would see: `id`, `object: "chat.completion.chunk"`, `created`, `model`, `choices[].delta` with `role`/`content`/optional `reasoning_content`, optional `finish_reason`, optional final `usage` (the gateway requests `stream_options.include_usage: true` upstream — see `lm-studio.js:345-352` — so a usage chunk is emitted on the last frame when LM Studio supports it).

### `GET /v1/provider-status` (200)

From `docs/API.md:739-761` and `C:\Projects\llm-gateway\src\routes\provider-status.js:7-31`:

```
{
  "ok": true,
  "provider": "llm-gateway",
  "authenticated": true,
  "gateway": {
    "reachable": true,
    "healthy": <boolean>
  },
  "upstream": {
    "lmStudioConnected": true,
    "loadedModel": "qwen/qwen3.5-9b" | null,
    "availableModel": "qwen/qwen3.5-9b" | null,
    "downloadedModelCount": <int>,
    "source": "native" | "compat" | null,
    "nativeApi": <boolean>,
    "state": "ready" | "no_model_loaded" | "no_models_available" | null,
    "reason": "<string>" | null
  }
}
```

Status codes (from `provider-status.js` and `docs/API.md:763-778`):

- `200 OK` — gateway authenticated and LM Studio has at least one chat-capable model.
- `401 Unauthorized` — `MISSING_API_KEY` or `INVALID_API_KEY` (auth.js).
- `403 Forbidden` — `DISABLED_API_KEY` (auth.js:72-95).
- `503 Service Unavailable` — `UPSTREAM_NOT_READY` (provider-status.js:57-65) or `UPSTREAM_UNAVAILABLE` (provider-status.js:88-101).
- `504 Gateway Timeout` — `UPSTREAM_TIMEOUT` (provider-status.js:38-47 — fires when LM Studio readiness check exceeds `min(config.lmStudioTimeoutMs, 5000)` ms).

### Gateway error body shape

From `C:\Projects\llm-gateway\src\lib\errors.js` (referenced by `chat.js:7, 26-32`, `auth.js:3-5`, `provider-status.js:3`) and `docs/API.md:251-289`:

```
{
  "error": {
    "message": "<human-readable>",
    "type": "authentication_error" | "invalid_request_error"
          | "insufficient_credit_error" | "rate_limit_error"
          | "service_unavailable_error" | "server_busy_error"
          | "timeout_error" | "upstream_error" | "server_error",
    "code": "MISSING_API_KEY" | "INVALID_API_KEY" | "DISABLED_API_KEY"
          | "UPSTREAM_NOT_READY" | "UPSTREAM_UNAVAILABLE" | "UPSTREAM_TIMEOUT"
          | "API_KEY_VALIDATION_UNAVAILABLE" | ... // optional, only on some routes
  }
}
```

When the gateway is relaying an LM Studio error, the body is normalized by `normalizeUpstreamErrorBody` (`C:\Projects\llm-gateway\src\services\lm-studio.js:66-93`) into the same `{ error: { message, type, code?, param? } }` shape.

## Streaming vs Non-Streaming

Three separate questions, three separate answers:

1. **Does qbo ask the gateway for streaming?** **No.** Grep across `image-parser.js`, `remote-api-providers.js`, and the catalog shows the `stream` field is never set on any body sent to `llm-gateway`. `callLlmGateway` (image-parser.js:1132-1147) does not include `stream`. `requestOpenAiLikeChat` (remote-api-providers.js:394-403) does not include `stream`. The "buffered chat provider" wrapper (remote-api-providers.js:611-665) emits `onChunk` once with the full text after `await request.promise`, which is buffer-then-fire, not a real SSE stream.

2. **Does the gateway support streaming?** **Yes.** Documented at `docs/API.md:976-985`. Implemented at `chat.js:280-296` (Express `res.pipe` from `Readable.fromWeb(response.body)` through a transform). Gateway requests `stream_options.include_usage: true` upstream so it can bill streamed requests (`lm-studio.js:345-352`).

3. **Does qbo currently receive streaming chunks?** **No.** Since qbo never sets `stream: true`, the gateway falls through to the non-streaming branch (`chat.js:299-312`) and returns a buffered JSON body with the `gateway` augmentation. From qbo's side, the response is a single `Content-Type: application/json` body buffered by `jsonRequest` / `jsonRequestCancelable`.

**Implication for the Mongo storage shape**: stream-related fields are marked **optional / not-current**. No current call site streams.

Final-response detection (non-streaming, current behavior): qbo waits for `res.on('end')` in the helper, which resolves the entire buffered body string. There is no streaming terminator to detect.

## Raw Package That Reaches This Server Today

Two layers, both important:

### Layer 1 — true raw boundary (`http.IncomingMessage`)

For all three call sites the **first observable provider-response unit in qbo server code** is the Node `http.IncomingMessage` (`res`) inside each helper's `transport.request(options, (res) => {...})` callback. At that point qbo has access to:

- `res.statusCode` — integer.
- `res.statusMessage` — reason phrase.
- `res.headers` — lowercased object map (including the gateway's `X-Request-Id`).
- `res.rawHeaders` — alternating-array form preserving header case/order.
- `res.httpVersion`.
- The body as a sequence of `Buffer` chunks via `res.on('data', chunk => ...)`. Chunk count, chunk byte sizes, and chunk arrival timing are observable here.

This is the same shape across all three helpers. The relevant source files:

- `server/src/services/image-parser.js:754-784` — `jsonRequest` (`callLlmGateway` path).
- `server/src/services/remote-api-providers.js:108-118` — `jsonRequestCancelable` (chat path).
- `server/src/services/image-parser.js:491-503` — inline `requestLib.request(...)` in `testRemoteProviderKey` (provider-status probe).

### Layer 2 — what the helper actually returns to the caller

Each helper then concatenates the body chunks into a single UTF-8 string and resolves a Promise with a stripped-down object:

- `server/src/services/image-parser.js:769-773` (`jsonRequest`, used by `callLlmGateway`):
  ```
  const req = transport.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
  });
  ```
  Resolved object: `{ statusCode, body }`. **No headers, no rawHeaders, no statusMessage, no chunk boundaries.**

- `server/src/services/remote-api-providers.js:108-118` (`jsonRequestCancelable`, used by chat path):
  ```
  req = transport.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (settled) return;
      settled = true;
      resolve({ statusCode: res.statusCode || 0, body: data });
    });
  });
  ```
  Same shape: `{ statusCode, body }`. **No headers, no rawHeaders, no statusMessage, no chunk boundaries.**

- `server/src/services/image-parser.js:491-503` (inline in `testRemoteProviderKey` for provider-status probe):
  ```
  const req = requestLib.request({...}, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, body: data, model: cfg.model }));
  });
  ```
  Resolved object: `{ statusCode, body, model: cfg.model }` where `cfg.model` is `null` for `llm-gateway` (line 178). Still no headers, no rawHeaders, no statusMessage.

At the call site, this resolved object is bound as `const res = await jsonRequest(...)` (`image-parser.js:1150`) or `const response = await request.promise` (`remote-api-providers.js:415`). So `res.body` / `response.body` is the canonical raw response **string** at the call-site layer, and `res.statusCode` / `response.statusCode` is the canonical HTTP status. **Everything from Layer 1 except `statusCode` and the concatenated body string is gone by this point.**

### What survives, what is discarded

**Survives Layer 2 (the helper's resolve)**:

- `statusCode` (int).
- `body` (string — the full unparsed JSON text the gateway returned).
- For the probe only: a static `model: cfg.model` field, which is `null` for `llm-gateway`.

**Discarded inside the helper between Layer 1 and Layer 2** (never reaches the caller):

- **All response headers**, including:
  - `X-Request-Id` — the gateway-generated UUID v4 set on every response by `app.js:27`. This is the gateway's correlation id and is currently lost on the qbo side.
  - `Content-Type`.
  - `Cache-Control` (only forwarded for streaming chunks anyway — chat.js:283).
  - any `Retry-After` header (gateway emits this on 429 — `docs/API.md:208`).
- `res.rawHeaders` (would expose original header case and order).
- `res.statusMessage` (the reason phrase).
- The per-chunk byte sizes, chunk count, and inter-chunk timing.

**Discarded by the call site after JSON parse** (for `callLlmGateway`):

- `parsed.id`, `parsed.object`, `parsed.created`, `parsed.system_fingerprint` if echoed.
- `choices[0].finish_reason`, `choices[0].logprobs`, `choices[0].message.refusal`.
- `parsed.usage.total_tokens`.
- `message.reasoning_content` (preserved only as a fallback when `message.content` is empty).
- **The entire `gateway` object** — `gateway.usage`, `gateway.cost.currency` / `prompt_cost_usd` / `completion_cost_usd` / `total_cost_usd` / `prompt_cost_per_1m_usd` / `completion_cost_per_1m_usd` / `pricing_source`, and `gateway.credits.balance_usd` / `total_granted_usd` / `total_charged_usd`. This is the most provider-specific data on the wire and qbo currently throws it away.
- Error response details — only `Error.message` (truncated to 500 chars) is surfaced; structured `error.type` and `error.code` from the gateway's error envelope are lost.

The chat path (`requestOpenAiLikeChat` for `llm-gateway`) discards the same set plus the full `parsed.choices` array beyond index 0.

The provider-status probe **does** parse the body for `upstream.loadedModel`/`availableModel` and `error.code`, but the raw body string is not stored and `parsedBody` only contributes to the summary `{ ok, code, reason, model }` returned by `validateRemoteProvider` — the full provider-status envelope (gateway object, downstream model count, source, native flag, etc.) is lost.

## Proposed Mongo Storage Shape

Goal: preserve the gateway response package that **qbo receives**. Documentation only — this section does not design the Mongo model, indexes, retention, or any background processing. Field naming is suggestive; the harness owner may rename freely. "Required" means: losing this field would defeat the goal of preserving the qbo-visible gateway package.

**Scope rule, restated**: this storage shape is strictly qbo-visible. The upstream LM Studio package the gateway sees on its own outbound calls is NOT proposed for storage here. See "Gateway-side context, not qbo-visible" below for what that upstream package contains and why preserving it would need a separate gateway-side harness.

### Required (qbo-visible)

- `providerId` — `"llm-gateway"` (matches catalog id).
- `researchProviderId` — `"llm-gateway"` (the research label; same as actual app id here).
- `actualAppProviderId` — `"llm-gateway"`.
- `transport` — `"llm-gateway"` (matches catalog transport).
- `callerSite` — enum: `"image-parser"`, `"chat"`, `"provider-status-probe"`. Identifies which qbo code path made the call.
- `baseUrl` — full URL string, e.g. `http://127.0.0.1:4100`. Capture verbatim.
- `method` — `"POST"` or `"GET"`.
- `path` — `"/v1/chat/completions"` or `"/v1/provider-status"`.
- `requestHeadersRedacted` — object map. `Authorization` value redacted to `"Bearer [redacted]"` or `null` when absent. Other outgoing headers (`Accept`, `Content-Type`, `Content-Length`) stored verbatim.
- `requestBody` — the exact JSON object posted, stored as sent if small enough. For `provider-status-probe` this is `null` (GET, no body). For large inline image payloads see `images` below.
- `requestBodyByteLength` — `Buffer.byteLength(JSON.stringify(body))`.
- `timeoutMs` — value passed to the helper.
- `requestStartedAt` — ISO timestamp captured immediately before `req.end()`.
- `responseFinishedAt` — ISO timestamp captured when the helper Promise resolves.
- `durationMs` — derived.
- `statusCode` — integer.
- `responseHeaders` — full object map of `res.headers` (Node lowercases header names). **Storing this is a harness improvement over current code, which discards headers entirely.** Capture verbatim so that the gateway-generated `x-request-id` is preserved.
- `rawBody` — the unparsed UTF-8 body string exactly as received. For provider-status this is the full `{ ok, provider, authenticated, gateway, upstream }` JSON. For chat completions this is the full augmented JSON including the `gateway` object.
- `rawBodyByteLength` — `Buffer.byteLength(rawBody)`.
- `parsedBody` — `JSON.parse(rawBody)` when parsing succeeds; otherwise null with `parseError` populated.
- `parseError` — string, populated only when JSON parse fails (mirrors qbo's `'LLM Gateway returned invalid JSON'` path).
- `outcome` — enum: `"success"`, `"http_error"`, `"network_error"`, `"invalid_json"`, `"timeout"`, `"abort"`.

### Required (qbo-visible) — chat completions only

These fields exist for `callerSite === "image-parser"` and `callerSite === "chat"`:

- `gatewayRequestId` — denormalized copy of `responseHeaders["x-request-id"]`. The gateway's correlation id (UUID v4). Same value the gateway logs into its own usage log (`C:\Projects\llm-gateway\src\middleware\request-logger.js:20-22`, which reads `req.requestId` set by `C:\Projects\llm-gateway\src\app.js:25-29`).
- `gatewayMetadata` — the gateway-added `parsedBody.gateway` object stored exactly as returned. Sub-document mirroring the gateway's augmentation:
  - `gatewayMetadata.usage.prompt_tokens` / `completion_tokens` / `total_tokens`.
  - `gatewayMetadata.cost.currency` / `prompt_cost_usd` / `completion_cost_usd` / `total_cost_usd` / `prompt_cost_per_1m_usd` / `completion_cost_per_1m_usd` / `pricing_source`.
  - `gatewayMetadata.credits.balance_usd` / `total_granted_usd` / `total_charged_usd` (only present for managed keys with a billable debit).
- `errorPayload` — populated when `outcome !== "success"`. Stores the gateway's error envelope exactly as returned:
  - `kind` — one of `"http_error"`, `"network_error"`, `"invalid_json"`, `"timeout"`, `"abort"`.
  - `gatewayErrorType` — from `parsedBody.error.type` (e.g. `authentication_error`, `upstream_error`).
  - `gatewayErrorCode` — from `parsedBody.error.code` (e.g. `MISSING_API_KEY`, `UPSTREAM_NOT_READY`).
  - `gatewayErrorMessage` — from `parsedBody.error.message`.
  - `nodeErrorCode` — e.g. `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `TIMEOUT` (qbo-internal code), `ABORT_ERR`.

### Optional but high-value (qbo-visible)

- `parsedBody.id`, `parsedBody.object`, `parsedBody.created`, `parsedBody.model` — completion id, type tag, timestamp, echoed model. All already inside `parsedBody`, called out so they are not pruned.
- `parsedBody.system_fingerprint` — if echoed by LM Studio upstream.
- `parsedBody.choices[0].finish_reason`.
- `parsedBody.choices[0].message.content`.
- `parsedBody.choices[0].message.reasoning_content` — LM Studio extension carried through the gateway when the upstream model emits a reasoning preamble; qbo currently only uses it as a fallback.
- `parsedBody.choices` — full array (already in `parsedBody`; flagged so it is not pruned to choice 0).
- `parsedBody.usage` — full sub-document: `prompt_tokens`, `completion_tokens`, `total_tokens`.
- `images` — when the image-parser path made the call. **Confirmed fact**: qbo sends image data as a `data:` URL inline in the JSON request body (image-parser.js:1142). For large inline image payloads, store the exact payload by external blob/reference instead of inlining it inside `requestBody`. For each image record:
  - `mediaType` (e.g. `image/png`).
  - `byteLength` (decoded bytes).
  - `sha256Digest`.
  - `blobReference` — opaque pointer to wherever the bytes are stored, if not inline.

### Optional / not-current (streaming fields)

**Marked optional because qbo never opts into streaming today.** Document, do not require:

- `streaming.requested` — boolean. Whether `stream: true` was set on the outgoing body. Always `false` in current code.
- `streaming.eventCount` — integer.
- `streaming.events[]` — ordered array. Each element: `seq`, `receivedAt`, `rawFrame` (verbatim SSE text), `data` (parsed JSON from the `data:` payload), `isDone` (true for `data: [DONE]`).
- `streaming.terminator` — `"done_sentinel"`, `"connection_end"`, `"abort"`, `"timeout"`, `"network_error"`.
- `streaming.reconstructedContent` — concatenated `delta.content` across chunks.
- `streaming.reconstructedUsage` — final `usage` chunk if the gateway forwarded one (gateway requests `stream_options.include_usage: true` upstream — lm-studio.js:345-352 — so a final-usage chunk is expected when LM Studio supports it).

**Important caveat**: per `docs/API.md:983` and `chat.js:176-240`, the gateway does **not** inject `gateway.cost` / `gateway.credits` into SSE chunks. If qbo ever flips streaming on, the `gatewayMetadata` field above will not be present on the wire.

### Gateway-side context, not qbo-visible

The following describes the upstream LM Studio package that lives inside the gateway. **None of this reaches qbo today** and **none of it is proposed for storage in the qbo Mongo shape above.** Listed only so the harness owner understands what the gateway sees that qbo does not:

- The gateway may mutate `model: "auto"` to a concrete LM Studio model id before forwarding upstream (`lm-studio.js:326-343`).
- The gateway may convert WebP / GIF / BMP `data:` URLs to PNG before forwarding upstream (`docs/API.md:968-972`).
- The gateway may receive upstream LM Studio response headers, raw body, and SSE stream chunks from LM Studio.
- None of those reach qbo today unless the gateway returns them in its own response body to qbo (it does not, except for the model identifier echoed inside the OpenAI-shape body).
- Preserving the upstream LM Studio package would require a separate gateway-side harness running inside `C:\Projects\llm-gateway`, not the qbo provider harness.

### Storage / size notes

- Image-parser request bodies can be a few MB because the base64 image bytes are inlined into `messages[0].content[1].image_url.url`. For preservation, keep the exact payload inline or by external payload reference if needed, and record `mediaType`, `byteLength`, `sha256Digest` per the `images` field above.
- Header redaction: only the outgoing `Authorization` header is sensitive in this provider's path. The gateway's response headers (`X-Request-Id`, `Content-Type`, `Retry-After`) are not sensitive.

## Gaps And Questions

### Facts vs assumptions

Everything in "Provider IDs In This App", "Current App Call Sites", "Request Package Sent Today", "Raw Package That Reaches This Server Today", and "Streaming vs Non-Streaming" is **fact** — confirmed by reading the named source files at the named line numbers in both repos on disk today.

Everything in "Official Response Package" is **fact from local llm-gateway documentation and source** at `C:\Projects\llm-gateway\docs\API.md`, `C:\Projects\llm-gateway\src\routes\chat.js`, `C:\Projects\llm-gateway\src\routes\provider-status.js`, `C:\Projects\llm-gateway\src\services\lm-studio.js`, `C:\Projects\llm-gateway\src\app.js`, `C:\Projects\llm-gateway\src\middleware\auth.js`. Treated as the authoritative local provider contract.

"Proposed Mongo Storage Shape" is **design proposal**, not fact.

### Unconfirmed / could not verify

1. **`X-Request-Id` is set on streaming responses too**. The `app.js:25-29` middleware sets it on every response before any route handler runs, so this is highly likely, but I did not verify with a live request. **Assumption from app-level middleware order.**

2. **Exact LM Studio model id format echoed in `parsedBody.model`**. The documented example uses `"qwen/qwen3.5-9b"` (`docs/API.md:1015`). Other LM Studio installs may echo a different shape. The harness should store `parsedBody.model` verbatim and not try to enum-check it.

3. **`gateway.cost.pricing_source` enum values — confirmed**. Resolved on follow-up. The enum is `"default" | "model_override"` (underscore, not hyphen). Source of truth: `C:\Projects\llm-gateway\src\lib\pricing.js:38` — `source: override ? 'model_override' : 'default'`. Consumed by `C:\Projects\llm-gateway\src\routes\chat.js:125` — `pricing_source: usageMetrics.pricing.source`. Schema enum agrees at `C:\Projects\llm-gateway\docs\openapi.yaml:388` — `enum: [default, model_override]`. The `docs/API.md:1045` example only shows `"default"` but does not contradict the enum. No discrepancy across code, schema, and docs.

4. **Whether the gateway always emits `gateway.credits` or only on managed-key requests**. Code at `chat.js:129-135` only includes `credits` when `creditSnapshot` is truthy. `maybeRecordUsageCharge` (chat.js:154-174) only writes a charge when `req.apiKeyUser` is set (managed key) — so `credits` is **absent for static `.env` keys**. The qbo harness should treat `gateway.credits` as optional.

5. **Whether qbo's static key is "managed" or "static" inside the gateway**. The gateway distinguishes managed keys (dashboard-issued, prepaid-credit-gated) from static keys (defined in the gateway's `API_KEYS` env var) at `auth.js:34-43`. qbo's `LLM_GATEWAY_API_KEY` could be either depending on how the user provisioned it. This affects whether `gateway.credits` shows up.

6. **`provider-status` body shape when 503 / 504**. The 200 shape is fully documented and code-verified. The error envelope is `{ error: { message, type, code } }` per the gateway's `lib/errors.js` (referenced but not read in full). The 503 body specifically should carry `error.code: "UPSTREAM_NOT_READY"` or `"UPSTREAM_UNAVAILABLE"` and 504 should carry `"UPSTREAM_TIMEOUT"` — confirmed via `provider-status.js:38-101`.

7. **No `qbo -> /v1/usage` calls today**. Grep confirmed qbo never calls `GET /v1/usage`. The gateway's `docs/API.md:780-867` documents this as the authoritative endpoint for confirmed billed totals after streamed requests — but since qbo does not stream, qbo currently does not need it.

8. **`reasoningEffort` is silently dropped on the chat path**. `remote-api-providers.js:447, 466` — `reasoningEffort` is a named argument but never forwarded into `requestOpenAiLikeChat`. Combined with the catalog declaring `allowedEfforts: ["low","medium","high","xhigh"]` (catalog entry line 57), this looks like dead config on the request side.

9. **`chat_template_kwargs` is image-parser-only on the qbo side**. The image-parser path sends `chat_template_kwargs: { enable_thinking: false }` (image-parser.js:1146). The chat path does NOT send `chat_template_kwargs` (remote-api-providers.js:394-403 — only `model`, `messages`, `max_tokens`, `temperature` are set). Whether the gateway forwards this field upstream unchanged is implicit from the LM Studio spread (`...payload` at `C:\Projects\llm-gateway\src\services\lm-studio.js:337`).

10. **Existing qbo tests for `llm-gateway`**. There are some qbo tests that exercise the gateway request builder and provider-status mapping, but **no test currently asserts full provider response package preservation because the current code does not preserve the full package**. Tests that touch this provider:
    - `server/test/remote-api-providers.test.js:15-23` — asserts `llm-gateway` is a valid provider and `getProvider('llm-gateway').chat` is a function.
    - `server/test/remote-api-providers.test.js:25-63` — `requestLlmGatewayChat` request builder test: verifies POST, baseUrl `http://127.0.0.1:4100` (or `LLM_GATEWAY_API_URL`), `urlPath /v1/chat/completions`, body `model: 'auto'`, system + user messages, empty headers when no api key, and that the response is parsed into `{ text: 'Gateway reply', usage: { model, inputTokens, outputTokens } }`.
    - `server/test/image-parser.test.js:1004-1027` — `checkProviderAvailability` reports `llm-gateway` authenticated when the mocked `provider-status` returns 200; verifies `result['llm-gateway'].model` is pulled from `upstream.availableModel`.
    - `server/test/image-parser.test.js:1029-1048` — `validateRemoteProvider('llm-gateway', ...)` maps mocked 401 with `error.code: 'INVALID_API_KEY'` to `{ code: 'INVALID_KEY', reason: 'API key rejected' }`.
    - `server/test/image-parser.test.js:1050-1069` — `validateRemoteProvider('llm-gateway', ...)` maps mocked 503 with `error.code: 'UPSTREAM_NOT_READY'` to `{ code: 'PROVIDER_UNAVAILABLE', reason: 'Gateway reachable, model unavailable' }`.
    - `server/test/image-parser-harness.test.js:75-101` — harness-mode stub coverage including `llm-gateway` in `checkProviderAvailability`.

11. **No tests inside `C:\Projects\llm-gateway` were read for this document**. The gateway has a `test/` directory. The source files cited above are the authoritative contract for this document.

12. **The image-parser archive vs the gateway's activity log**. The qbo image-parser archives the source image to disk (`routes/image-parser.js:60-97`). The gateway separately writes a saved activity log row at `data/activity-log.jsonl` with the prompt and response text but with images recorded as `[image omitted]` (`docs/API.md:1153-1157`). These are two independent records; the qbo harness could join against the gateway's log by `gatewayRequestId` if the qbo harness preserves it.

## Evidence

### qbo-escalations source (read on current branch; line numbers verified)

- `shared/ai-provider-catalog.json:48-59` — `llm-gateway` catalog entry.
- `server/src/services/image-parser.js`:
  - `:53-54` — `LLM_GATEWAY_API_URL` default `http://127.0.0.1:4100`; `LLM_GATEWAY_DEFAULT_MODEL` default `'auto'`.
  - `:57` — `DEFAULT_TIMEOUT_MS = 120000`.
  - `:62` — `'llm-gateway'` in valid-providers list.
  - `:166` — `'llm-gateway': 'LLM_GATEWAY_API_KEY'` in `ENV_KEY_MAP`.
  - `:173-184` — `REMOTE_PROVIDER_TEST_CONFIGS['llm-gateway']` (GET `/v1/provider-status`).
  - `:239-266` — `getApiKey` / `resolveApiKey` resolution order (file -> env -> Mongo).
  - `:327-328` — `getRemoteProviderLabel` returns `'LLM Gateway'`.
  - `:470-514` — `testRemoteProviderKey` (raw https/http request, returns `{ statusCode, body, model }`).
  - `:491-503` — inline `requestLib.request(...)` wrapper used only by `testRemoteProviderKey`.
  - `:516-659` — `validateRemoteProvider` with `llm-gateway`-specific status-code mapping at 540-605.
  - `:754-784` — `jsonRequest` helper used by `callLlmGateway` (resolves `{ statusCode, body }`, drops headers).
  - `:1124-1179` — `callLlmGateway` (the image-parser direct path).
  - `:1600-1601` — `case 'llm-gateway':` in `parseImage` switch.
  - `:1713-1719` — gateway slot in `resolveProviderAvailability`.
- `server/src/services/remote-api-providers.js`:
  - `:12` — `DEFAULT_TIMEOUT_MS = 120_000`.
  - `:17-22` — `PROVIDER_CONFIG['llm-gateway']` (`defaultModel`, `baseUrl`, `envKey`, `displayName`).
  - `:81-147` — `jsonRequestCancelable` helper (resolves `{ statusCode, body }`, drops headers).
  - `:175-205` — `normalizeMessages`, `extractOpenAiText`.
  - `:293-301` — `buildOpenAiMessages`.
  - `:380-441` — `requestOpenAiLikeChat` (the shared OpenAI-compat caller; chat path body shape).
  - `:443-472` — `requestLlmGatewayChat` (gateway-specific wrapper).
  - `:611-665` — `createBufferedChatProvider` (the buffered pseudo-stream adapter).
  - `:671-672, 689` — `llmGateway = { chat: createBufferedChatProvider('llm-gateway', requestLlmGatewayChat) }`.
- `server/src/services/providers/registry.js`:
  - `:48-49` — transport `'llm-gateway'` -> `remoteApiProviders.llmGateway`.
  - `:78-83` — per-kind timeout env vars.
- `server/src/routes/image-parser.js`:
  - `:29` — `'llm-gateway'` in `VALID_KEY_PROVIDERS`.
  - `:60-97` — `persistParseResult` and `archiveParserImage` flow.
  - `:348` — `'llm-gateway'` in stored-keys status.
- `server/src/routes/pipeline-tests.js:65, 75` — label `'Gateway'`, default model `'auto'`.
- `server/src/models/ImageParseResult.js:7` — `'llm-gateway'` listed as a valid `provider`.
- `server/src/services/test-runner.js:69, 72-73` — env strip list includes `LLM_GATEWAY_API_KEY`, `LLM_GATEWAY_API_URL`, `LLM_GATEWAY_DEFAULT_MODEL`.
- `server/test/remote-api-providers.test.js:15-23, 25-63` — gateway listed as valid provider; `requestLlmGatewayChat` request-builder test verifies POST, baseUrl, urlPath, body shape, empty headers, and parsed result.
- `server/test/image-parser.test.js:1004-1027, 1029-1048, 1050-1069` — `checkProviderAvailability` / `validateRemoteProvider` mapping tests for gateway 200, 401, and 503.
- `server/test/image-parser-harness.test.js:75-101` — harness-mode stub coverage including `llm-gateway`.

### llm-gateway local source and documentation

Treated as **local provider documentation** — the authoritative contract for this provider. Read directly from the local checkout at `C:\Projects\llm-gateway` on disk.

- `C:\Projects\llm-gateway\README.md:1-115` — high-level surface, default endpoints, `model: "auto"` behavior, streaming guidance, image conversion behavior.
- `C:\Projects\llm-gateway\docs\API.md`:
  - `:24-54` — endpoint list.
  - `:251-289` — gateway error envelope shape, error types, error codes.
  - `:267` — `X-Request-Id` documented as always set on responses.
  - `:718-779` — `GET /v1/provider-status` request, response, status codes, failure codes.
  - `:876-1101` — `POST /v1/chat/completions` request, response (streaming and non-streaming), status codes, model behavior, image handling.
  - `:1103-1224` — logging: daily JSONL usage logs, activity log, audit log. Image data not saved; raw images recorded as `[image omitted]`.
  - `:1226-1262` — environment variables (including `LM_STUDIO_URL`, `LM_STUDIO_TIMEOUT_MS`).
- `C:\Projects\llm-gateway\src\app.js`:
  - `:25-29` — `X-Request-Id` middleware (UUID v4 set on every response via `crypto.randomUUID()`).
  - `:30-42` — middleware order and route wiring.
- `C:\Projects\llm-gateway\src\routes\chat.js`:
  - `:14-25` — imports from `services/lm-studio.js` (`createChatCompletionRequest`, `normalizeUpstreamErrorBody`, `readResponseBody`).
  - `:111-138` — `createGatewayUsagePayload` (the exact shape of `gateway.usage`, `gateway.cost`, `gateway.credits`).
  - `:140-152` — `augmentCompletionBody` (the spread that injects `gateway` into the non-streaming response).
  - `:154-174` — `maybeRecordUsageCharge` (billing-side effect; only writes credits for `req.apiKeyUser`).
  - `:176-240` — `createStreamingUsageTransform` (SSE chunk parsing; gateway records usage for billing but passes chunks through unmodified).
  - `:245-336` — `POST /v1/chat/completions` route handler. Non-streaming branch at `:299-312`. Streaming branch at `:280-296`.
- `C:\Projects\llm-gateway\src\routes\provider-status.js`:
  - `:7-31` — `buildProviderStatusBody` (exact 200 response shape).
  - `:36-106` — route handler with readiness timeout, status code mapping (503 = `UPSTREAM_NOT_READY` / `UPSTREAM_UNAVAILABLE`, 504 = `UPSTREAM_TIMEOUT`).
- `C:\Projects\llm-gateway\src\services\lm-studio.js`:
  - `:26-40` — `readResponseBody` (the gateway's body reader).
  - `:66-93` — `normalizeUpstreamErrorBody` (gateway-side error normalization).
  - `:326-393` — `createChatCompletionRequest`: resolves `auto`, forwards body to LM Studio, injects `stream_options: { include_usage: true }` when streaming, retries without `stream_options` if LM Studio rejects it.
- `C:\Projects\llm-gateway\src\middleware\auth.js:10-131` — bearer auth on `/v1/*`. Static-key vs managed-key branch at `:34-43`. Disabled-key 403 branch at `:72-95`. Invalid-key 401 branch at `:97-119`.
- `C:\Projects\llm-gateway\src\middleware\request-logger.js`:
  - `:20-22` — usage log entry writes `requestId: req.requestId || null` (the value set by `app.js:25-29`).
  - `:7-54` — per-request logger that writes a daily JSONL log entry; calls `finishApiRequest`, `appendActivityEntriesForRequest`, `logConsoleRequest`.
- `C:\Projects\llm-gateway\src\lib\usage-log.js:12-35` — `appendUsageLog` writes one JSONL line per request to `./logs/usage-YYYY-MM-DD.jsonl`. **Metadata only**: requestId, ts, method, path, apiKeyId, apiKeyLabel, apiKeySource, userId, userEmail, model, prompt/completion/total tokens, costs, timeMs, stream, hasImages, status. Does not preserve the full request body or full response body.
- `C:\Projects\llm-gateway\src\lib\live-requests.js`:
  - `:24-29` — `redactText` (redacts bearer tokens and obvious secrets).
  - `:31-57` — `normalizeContentPart` (image content parts recorded as `[image omitted]`).
  - `:123-172` — `startApiRequest` (creates the in-memory live record with truncated prompt text).
  - `:211-224` — `recordStreamChunk` (counts chunk count and bytes; does not persist raw frames).
- `C:\Projects\llm-gateway\src\lib\activity-log.js:1-80` — activity-log writer (saves prompt + response **text** to `./data/activity-log.jsonl`; image data omitted; truncated to 12000 chars per `live-requests.js:5`).

### Sibling gateway checkout state at review time

- qbo source facts in this document were read from the qbo-escalations repo at `C:\Projects\qbo-escalations` on the current branch (`master`).
- Gateway contract facts were read from the local `C:\Projects\llm-gateway` checkout.
- **That gateway checkout was dirty at review time** (`git -C C:\Projects\llm-gateway status --short` reported modified and untracked files). Relevant modified files that this document cites and that could differ from the committed gateway contract:
  - `docs/API.md` — modified.
  - `src/app.js` — modified.
  - `src/middleware/auth.js` — modified.
  - `src/middleware/request-logger.js` — modified.
  - `src/routes/admin.js`, `src/routes/auth.js`, `src/routes/dashboard.js`, `src/routes/health.js` — modified (not cited by this document beyond the dashboard auth surface listed in `docs/API.md`).
  - `src/lib/identity-store.js` — modified (referenced indirectly via `chat.js:154-174 maybeRecordUsageCharge`).
  - `src/lib/activity-log.js`, `src/lib/audit-log.js`, `src/lib/console-request-log.js` — untracked / new files this document cites.
  - `docs/LOGGING.md` — untracked.
  - `src/routes/chat.js`, `src/routes/provider-status.js`, `src/services/lm-studio.js` — **not** marked modified by `git status --short`; the chat / provider-status / lm-studio contract cited above is on whatever revision the checkout currently has, but those three files are clean.
- Do not treat the gateway contract documented here as "committed and frozen" — it reflects the current local checkout, which has uncommitted edits in some adjacent files.

### Command outputs

- `git status --porcelain` in qbo and `git diff --stat -- provider-harness-research/providers/llm-gateway.md` were run before submission — see the final report.
- `git -C C:\Projects\llm-gateway status --short` was run before submission — see "Sibling gateway checkout state at review time" above.
