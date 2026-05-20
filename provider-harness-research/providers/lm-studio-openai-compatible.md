# lm-studio-openai-compatible Provider Harness Contract

## Summary

- Provider path type: direct HTTP to a local LM Studio server using its OpenAI-compatible REST surface (`POST /v1/chat/completions`). Default base URL `http://127.0.0.1:1234` (`server/src/services/lm-studio.js:16`).
- Current implementation status: implemented via raw Node `http`/`https.request` (no `openai` SDK). Two POST modes are used today — streaming for chat, non-streaming for parse and the image-parser branch. The streaming chat path is the only on-wire SSE consumer in this provider's set of call sites in this app.
- Full package preservation status: current code preserves none of the response package for replay/debug/audit. Non-streaming paths resolve `{ statusCode, body }` (body is response text) and then throw or `JSON.parse` it; `res.headers` are visible inside the callback but discarded before resolve (`server/src/services/lm-studio.js:68-72`, `server/src/services/image-parser.js:769-773`). The streaming path holds a live `res` stream (with `res.statusCode` and `res.headers` available) but stores only the concatenated `delta.content` text and the last-seen `usage` object; raw chunks, raw SSE frames, response headers, every per-chunk JSON, finish reasons, ids, model echoes, and `choices` beyond `choices[0].delta.content` are dropped (`server/src/services/lm-studio.js:395-436`).
- Main uncertainty: whether LM Studio emits `usage` on a final SSE chunk in this app's call (current request body does not set `stream_options.include_usage: true`). Documented behavior is that streaming usage requires that opt-in (LM Studio 0.3.18 changelog, 2025-07-10).

Research label: `lm-studio-openai-compatible`. Actual app id: `lm-studio` (single catalog entry — `shared/ai-provider-catalog.json:162-176`).

## Provider IDs In This App

- Exact app id: `lm-studio` (`shared/ai-provider-catalog.json:163`).
- Aliases/catalog ids: none. Family `lm-studio`, transport `lm-studio`, default `model: "local"` sentinel (resolved at call time via `getLoadedModel`), label `"LM Studio (Local)"`, shortLabel `"LM Studio"`, `allowedEfforts: ["low","medium","high"]`, `supportsThinking: false`, `supportsImageInput: true`, `order: 90` (`shared/ai-provider-catalog.json:162-176`).
- UI labels: `"LM Studio (Local)"` / `"LM Studio"` from catalog; `"LM Studio"` in pipeline-tests (`server/src/routes/pipeline-tests.js:66`).
- Environment variables consumed by code:
  - `LM_STUDIO_API_URL` (default `http://127.0.0.1:1234`) — read in two places independently: `server/src/services/lm-studio.js:16` and `server/src/services/image-parser.js:51`.
  - `LM_STUDIO_API_TOKEN` (or `LM_STUDIO_API_KEY` fallback) — both optional; bearer auth sent only if set (`server/src/services/lm-studio.js:17, 41-47`, `server/src/services/image-parser.js:52, 956`).
  - `LM_STUDIO_CHAT_TIMEOUT_MS` (default 180000) — `server/src/services/lm-studio.js:18`. Also consumed by registry timeout lookup (`server/src/services/providers/registry.js:64-65`).
  - `LM_STUDIO_PARSE_TIMEOUT_MS` (default 120000) — `server/src/services/lm-studio.js:19`.
  - `LM_STUDIO_SUPPORTS_IMAGE_INPUT` (default true) — `server/src/services/providers/registry.js:120`.
- Evidence:
  - `shared/ai-provider-catalog.json:162-176` — catalog entry.
  - `server/src/models/ImageParseResult.js:7` — `'lm-studio'` listed as valid `provider` value.
  - `server/src/routes/pipeline-tests.js:66, 76` — pipeline-tests label and default model `'local'`.
  - `server/.env.example:29` — `# LM Studio uses the existing LM_STUDIO_API_URL setting.`

## Current App Call Sites

### 1. Streaming chat — `chat()` in `server/src/services/lm-studio.js:320-475`

- File/function: `chat({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onDone, onError })`.
- What it does: resolves the loaded model via `getLoadedModel(baseUrl)` (line 357), builds OpenAI-style messages with optional vision parts via `buildOpenAIMessages` (lines 272-300), composes the body inline at lines 363-368 with `stream: true`, opens `transport.request({ method: 'POST', hostname, port, path: '/v1/chat/completions', headers: { 'Content-Type', 'Content-Length', ...buildDefaultHeaders() }, timeout })` at lines 373-384, then consumes SSE frames in `res.on('data', ...)` at lines 397-431.
- Provider path type: direct HTTP, streaming (SSE).
- Wired in: `server/src/services/providers/registry.js:42-43` routes transport `lm-studio` to the entire `lm-studio` service module.
- Evidence: `server/src/services/lm-studio.js:320-475`.

### 2. Non-streaming escalation parse — `parseEscalation()` in `server/src/services/lm-studio.js:480-549`

- File/function: `parseEscalation(imageBase64OrText, options)`.
- What it does: detects image-vs-text input (line 487), resolves model (line 489), builds messages (image or text branch), posts body `{ model, messages, stream: false, temperature: 0.1, max_tokens: 2048, chat_template_kwargs: { enable_thinking: false } }` (lines 524-531) to `/v1/chat/completions` via `jsonRequest` (line 524). Throws on non-200; otherwise `JSON.parse(res.body)` and returns `{ fields, usage }`.
- Provider path type: direct HTTP, non-streaming.
- Evidence: `server/src/services/lm-studio.js:480-549`.

### 3. Non-streaming image transcription — `transcribeImage()` in `server/src/services/lm-studio.js:554-621`

- File/function: `transcribeImage(imageBase64OrPath, options)`.
- What it does: accepts base64/data URL/absolute path; if path, reads via `fs.readFileSync` and infers MIME (lines 580-591); posts body `{ model, messages, stream: false, temperature: 0.1, max_tokens: 4096, chat_template_kwargs: { enable_thinking: false } }` (lines 601-608) to `/v1/chat/completions` via `jsonRequest` (line 601). Returns `{ text, usage }`.
- Provider path type: direct HTTP, non-streaming (capability path only — see Classification below).
- Classification — currently uncalled:
  - The function is exported (`server/src/services/lm-studio.js:669`) and registry-exposed (`server/src/services/providers/registry.js:153, 200`).
  - The only chat-side caller of any `transcribeImage` is `server/src/lib/chat-image.js:3` which hardcodes `const { transcribeImage } = require('../services/claude');` — it imports from `claude`, not from the registry, so the lm-studio implementation is not reachable from `transcribeImageForChat`.
  - `rg -n "\.transcribeImage\(|transcribeImage:" server/src` produces matches only in: `registry.js:200` (the registry export site itself), and the lm-studio / claude / codex source modules (definitions / error strings). No concrete production caller invokes `transcribeImage` on the registry-resolved lm-studio object.
  - Therefore: this is an exported provider capability / registry-exposed callable path with no concrete current production caller in this checkout. The harness should still preserve its package shape because the path is reachable through the registry API, but the call site is not exercised by the current chat or image-parser flows.
- Evidence: `server/src/services/lm-studio.js:554-621, 669`; `server/src/lib/chat-image.js:3`; `server/src/services/providers/registry.js:153, 200`; `rg -n "transcribeImage|defaultTranscribeTimeoutMs|transcribeImageForChat" server/src` output captured in this session.

### 4. Non-streaming image-parser pipeline — `callLmStudio()` in `server/src/services/image-parser.js:899-981`

- File/function: `callLmStudio(systemPrompt, imageBase64, mediaType, model, timeoutMs, eventBus)`.
- What it does: imports `getLoadedModel, getModelSnapshot` from the lm-studio service (`server/src/services/image-parser.js:9`), runs `convertToPngIfNeeded` because llama.cpp accepts only PNG/JPEG (line 910), builds `messages` with `system` plus a `user` containing `[{ type: 'text', text: 'Parse this image.' }, { type: 'image_url', image_url: { url: dataUrl } }]` (lines 938-947), posts body `{ model, messages, stream: false, temperature: 0.1, max_tokens: 4096, chat_template_kwargs: { enable_thinking: false } }` (lines 949-956) to `/v1/chat/completions` via the image-parser-module `jsonRequest`. Auth header included only if `LM_STUDIO_API_TOKEN` is set (line 956).
- Provider path type: direct HTTP, non-streaming.
- Wired in: switch-case branch `case 'lm-studio':` at `server/src/services/image-parser.js:1603-1605`.
- Evidence: `server/src/services/image-parser.js:899-981, 1603-1605`.

### 5. Model discovery — `getModelSnapshot()` / `getLoadedModel()` / `warmUp()`

- File/function: `getModelSnapshot(baseUrl, options)` at `server/src/services/lm-studio.js:228-238`.
- What it does: GETs `/api/v1/models` (line 231); on 404/405/501 falls back to `/v1/models` (line 234). Native shape parsed by `parseNativeModelsSnapshot` (lines 113-136) — `{ models: [{ type, key, loaded_instances: [{ id }] }] }`. Compat shape parsed by `parseCompatModelsSnapshot` (lines 138-150) — `{ data: [{ id }] }`.
- Provider path type: direct HTTP GET, non-streaming.
- Callers: `getLoadedModel` cache (line 243-249); `warmUp` (lines 626-640); `resolveProviderAvailability` in image-parser (`server/src/services/image-parser.js:1722-1738`).
- Evidence: `server/src/services/lm-studio.js:113-238, 626-640`.

### Transport summary

All POST/GET use Node's built-in `http`/`https.request` directly (no `fetch`, no `axios`, no `openai` SDK).
## Request Package Sent Today

### Common to all POST paths

- Method: `POST`. Path: `/v1/chat/completions`.
- Scheme/host: defaults to `http://127.0.0.1:1234` (plain HTTP). Overridable via `LM_STUDIO_API_URL`. Transport is picked by URL protocol (`http` vs `https`) at `server/src/services/lm-studio.js:32-39` and `server/src/services/image-parser.js:746-751`.
- Auth: `Authorization: Bearer <LM_STUDIO_API_TOKEN>` only when the env var is set; otherwise no Authorization header is sent. `server/src/services/lm-studio.js:41-47` (`buildDefaultHeaders`), `server/src/services/image-parser.js:956` (image-parser inline branch).
- Content-Length: computed from `Buffer.byteLength(payload)`.
- Default timeouts (registry / module fallbacks):
  - chat path: `LM_STUDIO_CHAT_TIMEOUT_MS` default 180000 (`server/src/services/lm-studio.js:18`).
  - parse/transcribe in service module: `LM_STUDIO_PARSE_TIMEOUT_MS` default 120000 (`server/src/services/lm-studio.js:19`).
  - image-parser `callLmStudio`: caller-provided `timeoutMs` (image-parser default 120000 — `server/src/services/image-parser.js:57`).
- Discovery GET timeouts: 5000 ms in `getModelSnapshot` default (`server/src/services/lm-studio.js:229`); 3000 ms in `resolveProviderAvailability` (`server/src/services/image-parser.js:1726`).

### Streaming chat path (`chat()`)

Request headers sent in source (`server/src/services/lm-studio.js:378-382`):

- `Content-Type: application/json`
- `Content-Length: <byteLength>`
- `Authorization: Bearer <token>` — only when `LM_STUDIO_API_TOKEN` is set (added by `buildDefaultHeaders()` spread at line 381).
- No `Accept` header is set on this path.

Request body (`server/src/services/lm-studio.js:363-368`):

```
{
  model: <resolvedModel>,
  messages: <buildOpenAIMessages(messages, systemPrompt, images)>,
  stream: true,
  temperature: reasoningEffort === 'low' ? 0.3 : reasoningEffort === 'high' ? 0.8 : 0.5
}
```

Notes:
- `messages` may include vision content parts when `images[]` is non-empty. `base64ToImageUrl` at lines 258-267 hardcodes a `data:image/png;base64,` prefix when the input is not already a data URL.
- No `max_tokens`, no `top_p`, no `chat_template_kwargs`, no `stream_options`.

### Non-streaming paths (`parseEscalation`, `transcribeImage`, `callLmStudio`)

Request headers sent in source — set inside `rawRequest` at `server/src/services/lm-studio.js:54-66` and inside the image-parser `jsonRequest` at `server/src/services/image-parser.js:759-767`:

- `Content-Type: application/json`
- `Accept: application/json`
- `Content-Length: <byteLength>` (when payload present)
- `Authorization: Bearer <token>` — only when `LM_STUDIO_API_TOKEN` is set (lm-studio module: line 43-44; image-parser inline conditional: line 956).

Request body — non-streaming (`server/src/services/lm-studio.js:524-531, 601-608`, `server/src/services/image-parser.js:949-956`):

```
{
  model: <resolvedModel>,
  messages: <built per call site>,
  stream: false,
  temperature: 0.1,
  max_tokens: <2048 in parseEscalation; 4096 in transcribeImage and callLmStudio>,
  chat_template_kwargs: { enable_thinking: false }
}
```

Notes:
- `chat_template_kwargs.enable_thinking: false` is an LM Studio / llama.cpp passthrough not in the OpenAI standard.
- `parseEscalation` builds either a single text-content user message or a `[text, image_url]` parts array depending on whether the input is base64/data-URL.
- `transcribeImage` always sends a `[text, image_url]` parts array.
- `callLmStudio` always sends a leading `{ role: 'system', content: systemPrompt }` plus a `[text, image_url]` user message.

## Official Response Package

### What LM Studio's own docs say (re-fetched in this session)

- `https://lmstudio.ai/docs/developer/openai-compat` (fetched in this session): LM Studio officially documents five OpenAI-compatible endpoints — `GET /v1/models`, `POST /v1/responses`, `POST /v1/chat/completions`, `POST /v1/embeddings`, `POST /v1/completions`. Standard local endpoint `http://localhost:1234/v1`. Existing OpenAI clients work by changing the base URL. This page does not publish a response schema; it links out to per-endpoint pages, which themselves defer to OpenAI for response semantics (see next bullet).
- `https://lmstudio.ai/docs/developer/openai-compat/chat-completions` (fetched in this session): officially lists supported `POST /v1/chat/completions` request parameters as `model`, `top_p`, `top_k`, `messages`, `temperature`, `max_tokens`, `stream`, `stop`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `repeat_penalty`, `seed`. The page does NOT name any response field. It explicitly defers to OpenAI for both parameter and response semantics — `"See https://platform.openai.com/docs/api-reference/chat/create for parameter semantics."` and `"See OpenAI docs: https://platform.openai.com/docs/api-reference/chat"`.
- `https://lmstudio.ai/docs/developer/api-changelog` (fetched in this session): entry **LM Studio 0.3.18 — 2025-07-10**: `"Added support for the stream_options object on OpenAI-compatible endpoints. Setting stream_options.include_usage to true returns prompt and completion token usage during streaming"`.

### Expected response shape

> Expected OpenAI-compatible shape from OpenAI docs/spec. LM Studio documents compatibility but may omit or extend fields. Field presence must be preserved raw, not assumed.

For the field-level shape of `CreateChatCompletionResponse`, `CreateChatCompletionStreamResponse`, `ChatCompletionResponseMessage`, `ChatCompletionStreamResponseDelta`, `CompletionUsage`, `Error`, and `ErrorResponse`, see the sibling document `provider-harness-research/providers/openai-api.md` on this branch, which quotes the OpenAI OpenAPI spec at `https://github.com/openai/openai-openapi/blob/master/openapi.yaml` (`CreateChatCompletionResponse` at schema lines 42967-43117; `CreateChatCompletionStreamResponse` at 43118-43248; `Error` at 47730-47749).

LM Studio's Chat Completions page does NOT publish an independent response schema — it lists supported request parameters only and defers to OpenAI for both parameter and response semantics (deference quote in the bullet above). Therefore the field-level shape used as the harness reference is borrowed OpenAI-compatible shape, not LM-Studio-documented shape. Top-level fields that an OpenAI-compatible non-streaming response carries — `id`, `object`, `created`, `model`, `choices`, `message`, `finish_reason`, `usage` — and any nested fields beyond them (e.g. `system_fingerprint`, `service_tier`, `choices[].message.refusal`, `choices[].message.tool_calls`, `choices[].message.annotations`, `choices[].message.audio`, `choices[].logprobs`, `usage.total_tokens`, `usage.prompt_tokens_details`, `usage.completion_tokens_details`) should all be treated as `may be present or omitted` for LM Studio and preserved raw if present. The source of truth for the field shape itself is OpenAI's OpenAPI spec (see Evidence).

### LM-Studio-specific extensions observed in current source

Labeled inference from code (LM Studio's docs page fetched does not describe these explicitly):

- `choices[0].message.reasoning_content` (non-streaming) — read as a fallback when `content` is empty by `parseEscalation` (`server/src/services/lm-studio.js:542`), `transcribeImage` (`server/src/services/lm-studio.js:618`), and `callLmStudio` (`server/src/services/image-parser.js:974-975`). Implies LM Studio emits a non-standard `reasoning_content` field on certain reasoning models.
- `choices[0].delta.reasoning_content` (streaming) — referenced in the streaming-path comment at `server/src/services/lm-studio.js:419-422`. The comment notes the path forwards only `delta.content`; the streaming code at line 423 reads only `delta.content` and does NOT fall back to `delta.reasoning_content`. If LM Studio emits `delta.reasoning_content`, it reaches the server inside the parsed chunk JSON but is discarded by current code.
- `chat_template_kwargs.enable_thinking: false` (request-side) — used to suppress the `<think>...</think>` preamble on Qwen3-family models. Documented as effective in this codebase only by the fact that it is sent on every non-streaming path; the LM Studio docs page fetched does not list it.

### Error responses

LM Studio's docs page fetched does not document the error JSON shape. Source-backed observation: every non-200 case in this app treats the body as opaque text truncated to 500 chars — `server/src/services/lm-studio.js:390, 534, 611`, `server/src/services/image-parser.js:959`. The body may be JSON (`{ error: { type, message, param, code } }` — OpenAI shape) or a plaintext error from llama.cpp; current code does not branch on shape.

Connection-level errors handled by code:
- `ECONNREFUSED` — `server/src/services/lm-studio.js:446-450` (chat path) and `server/src/services/lm-studio.js:168-179` (discovery).
- `ECONNRESET` / `ENOTFOUND` — `server/src/services/lm-studio.js:168-179`.
- Socket timeout — `Error.code = 'TIMEOUT'` (`server/src/services/lm-studio.js:74, 102-104, 351-353, 457-459`).
- 401 / 403 surfaced as `auth_rejected` / `auth_required` only on the discovery endpoint (`server/src/services/lm-studio.js:185-194`); on chat/parse paths these fall through generic non-200 handling.

## Streaming vs Non-Streaming

- Current app behavior:
  - Streaming: chat path only (`server/src/services/lm-studio.js:366` — `stream: true`).
  - Non-streaming: parse path (`server/src/services/lm-studio.js:527` — `stream: false`), transcribe path (`server/src/services/lm-studio.js:604`), image-parser branch (`server/src/services/image-parser.js:952`).
- Provider capability: LM Studio supports both modes via the same endpoint per `https://lmstudio.ai/docs/developer/openai-compat/chat-completions` (`stream` listed as a supported parameter). The 2025-07-10 changelog entry adds `stream_options.include_usage: true` for prompt/completion token usage during streaming.
- Final response detection (streaming): the SSE parser at `server/src/services/lm-studio.js:407` treats `data: [DONE]` as terminator; if the response `end` fires without `[DONE]`, the path still calls `finishWithSuccess(fullResponse)` (`server/src/services/lm-studio.js:433-436`).
- Streaming usage note: the streaming request body sent by this app does NOT include `stream_options.include_usage: true`. The code captures `usage` from any chunk that has it (`server/src/services/lm-studio.js:416-417`), but per the LM Studio 0.3.18 changelog the final-chunk usage requires the `include_usage` opt-in. Therefore streaming usage may be absent in this app's current call package; this remains an empirical uncertainty until tested against a current LM Studio build.
- Evidence: `server/src/services/lm-studio.js:366, 397-436, 527, 604`; `server/src/services/image-parser.js:952`; LM Studio docs URLs above.
## Raw Package That Reaches This Server Today

The two POST modes produce different first-observable response objects. Document them separately.

### Non-streaming POST (`parseEscalation`, `transcribeImage`, `callLmStudio`)

- Variable name: at the call sites, `const res = await jsonRequest(...)`. Inside the helper, `res` is the Node `http.IncomingMessage`; the resolved promise object is `{ statusCode, body }`.
- Type: a small plain object — `{ statusCode: number, body: string }`. `body` is the UTF-8 response text accumulated from `res.on('data', chunk => { data += chunk; })`, finalized on `res.on('end')`.
- Fields still present at resolve time: `statusCode` and the unparsed body text.
- Fields already discarded at resolve time:
  - `res.headers` — visible inside the response callback but not captured into the resolved object. Verified at `server/src/services/lm-studio.js:68-72` (`rawRequest`) and at `server/src/services/image-parser.js:769-773` (image-parser `jsonRequest`).
  - All Node `http.IncomingMessage` metadata beyond `statusCode` (e.g. `httpVersion`, `rawHeaders`, `complete`, `trailers`).
- After resolve, the call site runs `JSON.parse(res.body)` and keeps only `choices?.[0]?.message?.content` (or `message.reasoning_content` as fallback) plus a small `{ model, inputTokens, outputTokens }` triple. All other parsed fields — `id`, `object`, `created`, `system_fingerprint`, `service_tier`, `choices[0].finish_reason`, `choices[0].logprobs`, `choices[0].message.refusal`, `choices[0].message.tool_calls`, `choices[0].message.annotations`, `choices[0].message.audio`, `usage.total_tokens`, every `choices[i]` past index 0 — are dropped.
- For non-200 responses the body string is interpolated (truncated to 500 chars) into a thrown `Error.message`; no structured error capture (`server/src/services/lm-studio.js:534, 611`, `server/src/services/image-parser.js:958-962`).
- Evidence: `server/src/services/lm-studio.js:49-78, 109-111, 537-548, 614-620`; `server/src/services/image-parser.js:754-784, 964-980`.

### Streaming POST (`chat()`)

- Variable name: `res` (the Node `http.IncomingMessage`) at `server/src/services/lm-studio.js:384`. A rolling string accumulator `sseBuffer` holds bytes not yet split into complete SSE lines (`server/src/services/lm-studio.js:395`).
- Type: a live HTTP response stream. The current code consumes `chunk` strings from `res.on('data', chunk => ...)` at lines 397-431; each chunk is concatenated into `sseBuffer`, split on `\n`, and the resulting lines are inspected.
- Fields still present at the boundary (while the response is live and reachable in scope): `res.statusCode` (read at line 385), `res.headers` (accessible on `res` but not read), each ordered `res.on('data')` chunk string, and — after a `data: ` line is parsed via `JSON.parse(trimmed.slice(6))` at line 415 — each parsed chunk JSON object containing the per-chunk `id`, `object`, `created`, `model`, `system_fingerprint`, `choices[i].delta.{role,content,reasoning_content,tool_calls,refusal}`, `choices[i].finish_reason`, `choices[i].logprobs`, and `usage` when present.
- Fields already discarded by current code (i.e. visible at the boundary but not preserved):
  - Response headers (`res.headers`) — never captured.
  - Raw network chunk strings — used to build `sseBuffer`, never stored.
  - Raw SSE frames (the literal text of each `data: ...` line, including any non-`data:` lines such as `:`-comment heartbeats or `event:` markers) — never stored.
  - Full parsed chunk JSON — `JSON.parse(trimmed.slice(6))` at line 415 produces the object but only `choices?.[0]?.delta?.content` (line 423) and `usage` (when present, lines 416-417) are read; the rest of the parsed object is dropped immediately.
  - Per-chunk `finish_reason`, ids, model echoes, `system_fingerprint` — present in the parsed chunk JSON, not read.
  - `choices` beyond index 0 — only `choices?.[0]?.delta?.content` is read.
  - `delta.reasoning_content` — referenced in the comment at lines 419-422 but not consumed by the code at line 423.
- What current code preserves to the caller: `fullResponse` (concatenation of `choices[0].delta.content` strings) and `capturedUsage` (`{ model, inputTokens, outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }` from `buildUsageObject`, `server/src/services/lm-studio.js:302-311`).
- Non-200 streaming response: the body is accumulated as text and thrown as `Error('LM Studio API error (HTTP N): ...')` (`server/src/services/lm-studio.js:385-392`). No structured error capture.
- Terminator semantics: the code treats `data: [DONE]` (line 407) as success, and also treats `res.on('end')` without `[DONE]` as success (lines 433-436). It treats a socket timeout as error (`Error.code = 'TIMEOUT'`, lines 351-353, 457-459).
- Evidence: `server/src/services/lm-studio.js:320-475` (entire `chat()` body), with specific line refs as cited above.

### Model-discovery GET (`getModelSnapshot`)

- Variable name: `res` inside `inspectModelsEndpoint`, resolved as `{ statusCode, body }` by `rawGet` (`server/src/services/lm-studio.js:80-107, 181-226`).
- Type: same shape as the non-streaming POST resolve — `{ statusCode: number, body: string }`.
- Fields discarded at resolve: `res.headers` (never captured into the resolved object).
- Further processing reduces the parsed JSON to a snapshot `{ source, loadedModel, availableModel, downloadedModelCount, totalModelCount, status, reason? }` (`server/src/services/lm-studio.js:113-150`); the raw GET response body is then dropped.
- Evidence: `server/src/services/lm-studio.js:80-238`.

## Proposed Mongo Storage Shape

Goal: preserve the full provider package, not extract the model answer. Field naming below is suggestive; the harness owner may rename freely. Boundary: provider returns package -> server receives package -> Mongo preserves package. Nothing past that.

### Required fields

Scope note: the required fields below apply to model-response calls. The model-discovery GET is documented because it reaches this server as a provider HTTP package, but it is auxiliary unless v0.1 explicitly decides to capture discovery/status calls.

- `providerId` — `"lm-studio"`.
- `providerPathType` — one of `"lm-studio-http-stream"` (chat) or `"lm-studio-http-nonstream"` (parseEscalation, transcribeImage, callLmStudio). If auxiliary discovery capture is explicitly included, use a separate value such as `"lm-studio-http-discovery"` for GET model-discovery packages.
- `callSite` — one of `"chat"`, `"parseEscalation"`, `"transcribeImage"`, `"image-parser"`. Optional auxiliary value: `"modelDiscovery"` if discovery/status calls are included in the harness scope.
- `request`:
  - `method` — `"POST"` or `"GET"`.
  - `url` — full URL string, e.g. `http://127.0.0.1:1234/v1/chat/completions`. Preserves scheme so HTTPS overrides are visible.
  - `headersSent` — outgoing headers as the code sends them. **`Authorization` must be redacted** (e.g. `"Bearer <redacted>"` or `null`); other headers stored verbatim.
  - `body` — for POST: the exact JSON body as sent (or a reference/blob handle if too large to inline). For GET: `null`.
  - `timeoutMs` — value passed to `http.request`.
- `status`:
  - `httpStatus` — `res.statusCode` integer when an HTTP response was received; absent otherwise.
  - `nodeErrorCode` — e.g. `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `TIMEOUT`, when a transport-level error occurred without an HTTP response.
  - `outcome` — one of `"success"`, `"http_error"`, `"network_error"`, `"invalid_json"`, `"stream_interrupted_no_done"`. The last reflects the `[DONE]`-absent path the streaming code tolerates.
- `timing`:
  - `requestStartedAt` — ISO timestamp captured before `req.end()`.
  - `requestFinishedAt` — ISO timestamp captured at the response-end / `[DONE]` / error event.
- `response`:
  - `headers` — `res.headers` object map if captured. Note: current code does NOT capture headers; this field is for the harness to start capturing them.

### Optional / provider-specific fields

- For non-streaming POST and GET responses:
  - `rawBody` — the unparsed UTF-8 response body string exactly as accumulated (this is what `res.body` holds in current source).
  - `parsedJson` — `JSON.parse(rawBody)` when parsing succeeds; otherwise null with a `parseError` note.
  - Denormalized copies (only if `rawBody`/`parsedJson` are also preserved): `model`, `providerRequestId` (from `parsedJson.id`), `finishReason` (from `parsedJson.choices[0].finish_reason`), `usage` (from `parsedJson.usage`).

- For streaming POST responses:
  - `streamFrames` — ordered list of received SSE frames as text (one entry per `data: ...` line, plus `:`-comment heartbeats and `event: ...` markers if any). This is the raw on-wire representation as the server saw it.
  - `streamChunks` — ordered list of parsed chunk JSON objects (`JSON.parse(trimmed.slice(6))` results), one per `data: ` frame that was JSON. The `[DONE]` sentinel entry is not parsed JSON; record it as a frame only.
  - Each ordered entry should carry `seq` (0-based) and `receivedAt` so order is reconstructable independent of array ordering guarantees.
  - `terminator` — one of `"done_sentinel"`, `"end_without_done"`, `"error_event"`, `"abort"`, `"timeout"`, `"network_error"`. Distinguishes the two success paths the current code tolerates.
  - Denormalized copies (only if `streamFrames`/`streamChunks` are also preserved): `model` from last chunk, `providerRequestId` from chunk `id`, `finishReason` from last non-null `choices[i].finish_reason`, `usage` from the last chunk that carried it.

- For errors:
  - `errorRawBody` — when a non-200 HTTP response carried a body, preserve the raw body string. The current code truncates this to 500 chars in a thrown `Error.message`; the storage shape should preserve the full body untruncated.
  - `errorParsed` — when `errorRawBody` parses as JSON with an `error` field, store the parsed object: `type`, `message`, `param`, `code`. Field presence is not guaranteed by LM Studio docs; preserve whatever is present.

- For image inputs (parseEscalation/transcribeImage/callLmStudio):
  - `inputImages` — list of `{ mediaType, byteLengthDecoded, sha256Digest }` for each image part. The base64 data URL itself is part of `request.body.messages[...].content[...].image_url.url`; preserve it inline unless size forces a reference.
  - `callLmStudio` only: `conversionStats` — `{ wasConverted, originalSizeBytes, convertedSizeBytes, conversionTimeMs }` from the WebP/GIF->PNG step (`server/src/services/image-parser.js:921-926`).

- For auxiliary model-discovery calls (`modelDiscovery`, if included):
  - The same `response.headers` / `rawBody` / `parsedJson` fields apply. Also preserve `discoveredSource` (`"native"` or `"compat"`) and the resulting `snapshot` object (`source`, `loadedModel`, `availableModel`, `downloadedModelCount`, `totalModelCount`, `status`, `reason?`).

### Storage notes

- Image-parser request bodies can be a few MB because base64 data URLs are inlined into `messages[].content[].image_url.url`. If a record would exceed Mongo document size limits, the harness may externalize the data URL by digest. This is a brief note, not an implementation directive.
- Streaming `streamFrames` and `streamChunks` for long answers may also exceed inline limits; the harness may externalize them via reference if needed.
- Authorization is the only sensitive outgoing header; redact at write time. LM Studio response headers are not known to carry secrets.
## Gaps And Questions

- Facts not confirmed:
  - Full LM Studio response JSON schema at field level. The LM Studio chat-completions docs page (fetched in this session) explicitly defers to OpenAI for parameter and response semantics and does not enumerate the nested response schema independently. Any non-top-level field (e.g. `system_fingerprint`, `service_tier`, `choices[].message.refusal`, `choices[].logprobs`, `usage.prompt_tokens_details`, `usage.completion_tokens_details`) is "may be present or omitted" and must be preserved raw.
  - SSE framing specifics (`Content-Type: text/event-stream`, the exact `data: [DONE]` framing, any `event:` / `:`-comment usage). Not described on the LM Studio docs page fetched. The current code parses `data:` lines and treats `data: [DONE]` as terminator, which matches the OpenAI Chat-Completions streaming convention; LM Studio's compatibility claim makes this likely but the docs page does not document the framing directly.
  - LM Studio error JSON shape. The docs page fetched does not document errors. The current code treats the body as opaque text.
  - Whether `choices[].message.reasoning_content` / `choices[].delta.reasoning_content` / request-side `chat_template_kwargs` are emitted/honored by every LM Studio backend (llama.cpp, MLX, etc.) or only some. Their presence is inferred from current source's fallback / passthrough usage; LM Studio's docs page fetched does not list them.
- Assumptions:
  - Streaming usage emission. The streaming request body sent by this app does NOT set `stream_options.include_usage: true`. The LM Studio 0.3.18 changelog (2025-07-10) states that `stream_options.include_usage: true` returns prompt/completion token usage during streaming. The current code captures `usage` from any chunk that carries it (`server/src/services/lm-studio.js:416-417`), which would be a no-op if LM Studio only emits usage under the opt-in. Whether LM Studio emits final-chunk usage absent the opt-in is unverified by this research; it remains an uncertainty until empirically tested.
  - Default base URL scheme. Default `LM_STUDIO_API_URL` is plain HTTP (`http://127.0.0.1:1234`). The transport resolver branches on URL scheme, so HTTPS deployments are supported but not exercised by this research.
- Questions for follow-up research:
  - Empirical capture of a real LM Studio streaming response would confirm/deny (a) whether `usage` is emitted on the final chunk without `stream_options.include_usage`, (b) whether `delta.reasoning_content` is emitted by Qwen3-class models, (c) which response headers LM Studio sets.
  - Whether the registry-exposed `transcribeImage` capability for `lm-studio` should be wired through `chat-image.js` (currently hardcoded to `claude`). Out of research scope; flagged because the lm-studio implementation is reachable through `registry.getProvider('lm-studio').transcribeImage` but has no concrete current invocation.
  - Whether `/v1/responses` (listed by LM Studio docs as supported) is in scope. `rg -n "v1/responses" server/src` returns no hits in this checkout, so it is out of scope today.

## Evidence

### Source references (current `master` HEAD; line numbers verified in this session)

- `shared/ai-provider-catalog.json:162-176` — `lm-studio` catalog entry.
- `server/src/services/lm-studio.js`:
  - `:16-19` — env-var defaults (`LM_STUDIO_API_URL`, `LM_STUDIO_API_TOKEN`/`LM_STUDIO_API_KEY`, `LM_STUDIO_CHAT_TIMEOUT_MS`, `LM_STUDIO_PARSE_TIMEOUT_MS`).
  - `:32-39` — `resolveTransport` (http/https branching).
  - `:41-47` — `buildDefaultHeaders` (optional Bearer auth).
  - `:49-78` — `rawRequest` (the non-streaming `{ statusCode, body }` helper, `Content-Type` + `Accept` + optional `Authorization`).
  - `:80-107` — `rawGet` (discovery GET helper).
  - `:109-111` — `jsonRequest` POST wrapper bound to `DEFAULT_API_URL`.
  - `:113-150` — native / compat models-snapshot parsers.
  - `:181-238` — `inspectModelsEndpoint` and `getModelSnapshot`.
  - `:243-253` — `getLoadedModel` cache + `clearModelCache`.
  - `:258-267` — `base64ToImageUrl` (PNG-fallback data URL prefix).
  - `:272-300` — `buildOpenAIMessages` (system + caller + last-user-image attachment).
  - `:302-311` — `buildUsageObject` (extracts `prompt_tokens` / `completion_tokens`).
  - `:320-475` — streaming `chat()` (SSE consumer). Inline header set at `:378-382` does NOT include `Accept`.
  - `:395-436` — SSE buffer parse, `data: [DONE]` terminator, `end-without-done` success path.
  - `:480-549` — non-streaming `parseEscalation()`. Body at `:524-531`. `reasoning_content` fallback at `:542`.
  - `:554-621` — non-streaming `transcribeImage()`. Body at `:601-608`. `reasoning_content` fallback at `:618`.
  - `:626-640` — `warmUp()`.
  - `:645-657` — `extractJSONObject` (recover JSON from model text).
  - `:666-674` — module exports.
- `server/src/services/image-parser.js`:
  - `:9` — `const { getLoadedModel, getModelSnapshot } = require('./lm-studio');`.
  - `:51-52` — independent re-read of `LM_STUDIO_API_URL` and `LM_STUDIO_API_TOKEN`.
  - `:63` — `'lm-studio'` in `DIRECT_IMAGE_PARSER_PROVIDER_IDS`.
  - `:742-784` — image-parser-module `jsonRequest` (different signature from the lm-studio module's; same `{ statusCode, body }` resolve shape).
  - `:759-767` — outgoing headers: `Content-Type: application/json`, `Accept: application/json`, plus any caller-supplied extras (including conditional `Authorization`).
  - `:769-773` — `res.on('data')` -> `res.on('end')` resolves `{ statusCode: res.statusCode, body: data }`; `res.headers` is not captured.
  - `:899-981` — `callLmStudio()`. Body at `:949-956`. Auth header conditional at `:956`. `reasoning_content` fallback at `:974-975`. Returns `conversionStats`.
  - `:921-926` — `conversionStats` produced from WebP/GIF -> PNG conversion (this is in `image-parser.js`, NOT in `lm-studio.js`; the previous draft mislocated this reference).
  - `:1603-1605` — switch-case wiring `'lm-studio'` to `callLmStudio`.
  - `:1722-1738` — `lm-studio` slot in `resolveProviderAvailability`.
- `server/src/services/providers/registry.js`:
  - `:3` — `const lmStudio = require('../lm-studio');`.
  - `:42-43` — routes transport `'lm-studio'` to `lmStudio`.
  - `:64-65` — per-kind timeout env: `LM_STUDIO_CHAT_TIMEOUT_MS` only.
  - `:119-120` — `LM_STUDIO_SUPPORTS_IMAGE_INPUT` default true.
  - `:153, 200` — `transcribeImage` registry exposure.
- `server/src/lib/chat-image.js:3` — `const { transcribeImage } = require('../services/claude');` (the only concrete chat-side caller of any `transcribeImage`, and it hardcodes the `claude` implementation).
- `server/src/routes/pipeline-tests.js:66, 76` — pipeline-tests label `'LM Studio'`, default model `'local'`.
- `server/src/models/ImageParseResult.js:7` — `'lm-studio'` listed as a valid `provider` value.
- `server/.env.example:29` — `# LM Studio uses the existing LM_STUDIO_API_URL setting.`

### Official documentation (re-fetched in this session)

- `https://lmstudio.ai/docs/developer/openai-compat` — five OpenAI-compatible endpoints; base URL `http://localhost:1234/v1`; existing OpenAI clients work by changing the base URL. Does NOT enumerate the full nested response schema.
- `https://lmstudio.ai/docs/developer/openai-compat/chat-completions` — supported `POST /v1/chat/completions` parameters: `model`, `top_p`, `top_k`, `messages`, `temperature`, `max_tokens`, `stream`, `stop`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `repeat_penalty`, `seed`. Explicit deference to OpenAI: `"See https://platform.openai.com/docs/api-reference/chat/create for parameter semantics."` and `"See OpenAI docs: https://platform.openai.com/docs/api-reference/chat"`. Does NOT enumerate the full response JSON schema.
- `https://lmstudio.ai/docs/developer/api-changelog` — LM Studio 0.3.18 (2025-07-10): `"Added support for the stream_options object on OpenAI-compatible endpoints. Setting stream_options.include_usage to true returns prompt and completion token usage during streaming"`.

### Borrowed shape (LM Studio defers to OpenAI for response semantics)

- OpenAI OpenAPI spec — `https://github.com/openai/openai-openapi/blob/master/openapi.yaml`. Schemas `CreateChatCompletionResponse` (lines 42967-43117), `CreateChatCompletionStreamResponse` (43118-43248), `ChatCompletionResponseMessage` (41151-41281), `ChatCompletionStreamResponseDelta` (41346-41390), `CompletionUsage` (41739-41802), `Error` (47730-47749), `ErrorResponse` (47768-47774), `ErrorEvent` (47750-47767), `data: [DONE]` sentinel (43461). Field-level shapes quoted in detail in the sibling `provider-harness-research/providers/openai-api.md`. Used here as the "Expected OpenAI-compatible shape" reference, not as a guarantee for LM Studio.

### Command outputs (captured in this session)

- `rg -n "transcribeImage|defaultTranscribeTimeoutMs|transcribeImageForChat" server/src` — matches in `chat-request-service.js`, `lib/chat-image.js` (which calls `transcribeImageForChat` and imports from `claude`), `services/{claude,codex,lm-studio}.js` (definitions / error strings), `services/providers/registry.js:153, 200` (registry exposure). No concrete invocation of a registry-resolved `lm-studio` `transcribeImage`.
- `rg -n "require\('\.\./services/lm-studio'\)|require\('\./lm-studio'\)|lmStudio\.transcribeImage|getTranscribe" server/src` — only `server/src/services/image-parser.js:9` and `server/src/services/providers/registry.js:{3,153,200}` import or expose `lm-studio`. No file calls `lmStudio.transcribeImage` directly.
- `wc -l server/src/services/lm-studio.js server/src/services/image-parser.js` — 674 lines and 1826 lines respectively. Confirms that `conversionStats` lines 921-926 cannot be in `lm-studio.js` (file ends at 674); they are in `image-parser.js`.
