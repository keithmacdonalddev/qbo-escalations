# LLM Gateway Provider Research Prompt

You are researching one provider for the qbo-escalations provider-harness work.

Provider to research: llm-gateway

Your only editable file is:

provider-harness-research/providers/llm-gateway.md

Do not edit production source.
Do not edit any other provider document.
Do not commit.

Before starting, read:

- provider-harness-research/HANDOFF.md
- provider-harness-research/RESEARCH_PLAN.md
- provider-harness-research/providers/_template.md

These files are required context, not optional references. If you cannot access them in your environment, stop and ask for the handoff files before doing the research.

## Local Meaning Of `llm-gateway`

`llm-gateway` is not a normal third-party cloud provider in this app.

It is a separate local sibling project at:

C:\Projects\llm-gateway

The qbo-escalations app calls this local gateway service, usually at:

http://127.0.0.1:4100

The gateway then proxies chat-completion requests to its own upstream provider, currently LM Studio, usually at:

http://127.0.0.1:1234

That means this provider has two important package boundaries:

1. qbo-escalations -> llm-gateway -> qbo-escalations
2. llm-gateway -> LM Studio -> llm-gateway

For the qbo-escalations provider harness, the primary package to preserve is the package that qbo-escalations receives from `llm-gateway`.

The upstream LM Studio package is still important context because the gateway may modify, wrap, normalize, bill, stream, or discard parts of it before qbo-escalations receives anything. Document that upstream package separately and clearly label it as gateway-side, not qbo-visible, unless current qbo source proves it reaches qbo.

## Deterministic Stopping Point

Stop at this boundary:

provider path returns package -> app server receives package -> proposed Mongo record preserves package

For `llm-gateway`, define "provider path" carefully:

- qbo-side provider path: `qbo-escalations` calls `llm-gateway`.
- gateway-side upstream path: `llm-gateway` calls LM Studio.

Do not design what happens after the package is stored.

Do not design or discuss:

- parser validation
- model answer cleanup
- canonical text conversion
- prompt improvements
- retry behavior
- provider fallback behavior
- UI behavior
- route design
- tests
- production implementation
- Mongo model implementation
- indexes
- retention policy
- dashboard views
- background jobs

## Required Source Review

Review the current qbo-escalations source first:

- `shared/ai-provider-catalog.json`
- `server/src/services/remote-api-providers.js`
- `server/src/services/image-parser.js`
- `server/src/services/providers/registry.js`
- `server/src/routes/image-parser.js`
- any tests that describe expected `llm-gateway` request paths or status behavior

Then review the sibling llm-gateway source:

- `C:\Projects\llm-gateway\README.md`
- `C:\Projects\llm-gateway\docs\API.md`
- `C:\Projects\llm-gateway\src\app.js`
- `C:\Projects\llm-gateway\src\routes\chat.js`
- `C:\Projects\llm-gateway\src\routes\provider-status.js`
- `C:\Projects\llm-gateway\src\services\lm-studio.js`
- `C:\Projects\llm-gateway\src\middleware\auth.js`
- `C:\Projects\llm-gateway\src\middleware\request-logger.js`
- `C:\Projects\llm-gateway\src\lib\usage-log.js`
- `C:\Projects\llm-gateway\src\lib\live-requests.js`
- `C:\Projects\llm-gateway\src\lib\activity-log.js`

Use local llm-gateway docs and source as the provider documentation for this provider. Do not rely on generic OpenAI docs as the primary contract. If OpenAI-compatible behavior matters, label it as compatibility context and tie it back to llm-gateway source or local docs.

## Current Facts To Re-Check Before Writing

Do not copy these as truth without re-checking source. They are a starting checklist.

In qbo-escalations:

- The app provider id is expected to be `llm-gateway`.
- The provider catalog entry is expected to use `transport: "llm-gateway"` and model `"auto"`.
- The remote chat provider is expected to use `LLM_GATEWAY_API_URL || "http://127.0.0.1:4100"`.
- The remote chat provider is expected to send `POST /v1/chat/completions`.
- The image parser is expected to send `POST /v1/chat/completions`.
- Provider validation is expected to use `GET /v1/provider-status`.
- The gateway API key env var is expected to be `LLM_GATEWAY_API_KEY`.
- The qbo helper currently receives only `{ statusCode, body }` from HTTP calls and discards response headers.
- Direct OpenAI, LM Studio, Codex CLI, and Claude CLI providers are separate provider paths and are out of scope except where they help explain boundaries.

In llm-gateway:

- The gateway is expected to expose `/v1/provider-status`.
- The gateway is expected to expose `/v1/chat/completions`.
- `/v1/*` endpoints are expected to require bearer-token authentication.
- The gateway is expected to set `X-Request-Id` on responses.
- The gateway is expected to proxy chat requests to LM Studio `/v1/chat/completions`.
- The gateway is expected to support both non-streaming and streaming chat-completion requests.
- For non-streaming requests, the gateway is expected to read the LM Studio response body, calculate usage/cost, and add a `gateway` object before returning JSON to qbo.
- For streaming requests, the gateway is expected to relay SSE chunks and not inject a final `gateway` cost object into the stream.
- The gateway usage logs are expected to be metadata/activity logs, not raw full provider-package preservation.

If current source proves any of these wrong, document the source-backed fact instead.

## Research Requirements

1. Provider name used in this app

- State the research provider id: `llm-gateway`.
- State the actual app provider id from source.
- Include catalog id, transport, family, model, display labels, environment variables, and UI labels if present.
- Do not rename source behavior to match assumptions.

2. Current qbo-escalations call paths

Document every current qbo call path that reaches llm-gateway.

At minimum, verify whether these exist:

- chat/workspace provider path through `server/src/services/remote-api-providers.js`
- image-parser path through `server/src/services/image-parser.js`
- provider-status/key-validation path through `server/src/services/image-parser.js`
- registry routing through `server/src/services/providers/registry.js`

For each path, include:

- source file and line numbers
- function name
- endpoint path
- method
- request body shape
- request headers
- timeout source
- whether qbo treats the response as non-streaming or streaming
- the first qbo-side raw response object/string/event after llm-gateway responds

3. Current llm-gateway internal paths

Document the gateway-side route and upstream path.

At minimum, verify:

- Express route registration for `/v1/provider-status` and `/v1/chat/completions`
- bearer auth middleware behavior
- request id behavior
- chat route behavior for non-streaming requests
- chat route behavior for streaming requests
- upstream LM Studio request construction
- upstream LM Studio response/error handling
- usage/cost augmentation
- usage/activity logging boundaries

Clearly separate:

- gateway response package visible to qbo
- upstream LM Studio package visible only inside llm-gateway
- gateway metadata added before qbo receives the response
- gateway logs that are summaries, not raw package preservation

4. Request package qbo sends today

Document qbo's request to llm-gateway.

Include:

- base URL and env override
- endpoint path
- method
- bearer auth header name only, not secret value
- body shape for chat/workspace
- body shape for image parser, including image payload shape
- body shape for provider-status validation
- model behavior, especially `auto`
- max token / temperature / chat_template_kwargs fields if present
- timeout source
- whether qbo sets `stream`

5. Response package qbo receives today

Document the package qbo receives from llm-gateway.

Include:

- HTTP status code
- response body raw string
- response headers that exist at the HTTP layer, especially `X-Request-Id`, even if qbo currently discards them
- parsed JSON shape for non-streaming chat completions
- parsed JSON shape for provider-status
- error body shape returned by llm-gateway
- gateway-added fields such as `gateway.cost`, `gateway.usage`, and `gateway.credits` if current source/docs prove them
- whether qbo preserves or discards each part

Important: qbo currently may only preserve `{ statusCode, body }` in the immediate helper. If headers are discarded, say so clearly.

6. Upstream LM Studio package inside llm-gateway

Document this as gateway-side context, not qbo-visible provider package unless it actually reaches qbo.

Include:

- LM Studio base URL/env override
- upstream `/v1/chat/completions` endpoint
- upstream request body after gateway modifications
- image conversion effects, if any
- `stream_options.include_usage` behavior for streaming
- upstream response object type used by Node `fetch`
- non-streaming body parsing
- streaming chunk handling and relay behavior
- upstream error normalization
- what upstream headers/body/chunks are visible to qbo after the gateway response is formed

7. Streaming vs non-streaming

Separate three questions:

- Does qbo currently ask llm-gateway for streaming?
- Does llm-gateway support streaming?
- Does qbo currently receive gateway streaming chunks for this provider path?

If qbo does not currently use streaming for this provider, document gateway streaming support only as reference.

Mark all streaming Mongo fields as optional/not-current unless current qbo source proves qbo receives streaming responses from llm-gateway.

Do not discuss enabling streaming, future flips to streaming, or future streaming architecture.

8. Raw package that reaches qbo server today

Identify the first raw unit in qbo server code after llm-gateway responds.

Examples:

- `http.IncomingMessage` headers/status/body chunks
- accumulated `data` string
- resolved `{ statusCode, body }`
- parsed JSON object

Name exact variables where visible.

State exactly what is lost before qbo returns `{ text, usage }` or provider-status summary.

9. Proposed Mongo storage shape

The storage shape should preserve qbo's full gateway response package.

Required qbo-side fields should include:

- `providerId`
- `researchProviderId`
- `actualAppProviderId`
- `transport`
- `callerSite`
- `baseUrl`
- `method`
- `path`
- `requestHeadersRedacted`
- `requestBody` or body reference
- `requestBodyByteLength`
- `timeoutMs`
- `requestStartedAt`
- `responseFinishedAt`
- `durationMs`
- `statusCode`
- `responseHeaders`
- `rawBody`
- `rawBodyByteLength`
- `parsedBody`
- `parseError`
- `outcome`
- `gatewayRequestId` from response header/body if available
- `gatewayMetadata` when returned in the response body
- `errorPayload`

For image requests, include only preservation-safe image fields unless the doc proves the raw image body should be stored inline:

- media type
- decoded byte length
- digest
- stored reference if one exists
- note whether qbo currently sends a `data:` URL body

Optional gateway-side context fields may be proposed only if clearly labeled as not qbo-visible:

- `gatewaySide.upstreamBaseUrl`
- `gatewaySide.upstreamPath`
- `gatewaySide.upstreamStatusCode`
- `gatewaySide.upstreamHeaders`
- `gatewaySide.upstreamRawBody`
- `gatewaySide.upstreamStreamChunks`
- `gatewaySide.upstreamErrorPayload`

Do not design indexes, retention, dashboards, background jobs, app-level tracing, user/session linkage, or production models.

10. Existing logs and models

Document whether current qbo or llm-gateway logs/models preserve full packages.

Do not treat metadata logs as equivalent to full package capture.

Specifically check whether:

- qbo `ImageParseResult`, `AiTrace`, or `UsageLog` preserve full gateway response packages
- llm-gateway usage/activity logs preserve full request/response packages or only summaries/text/metadata
- raw image data is saved or intentionally omitted

11. Gaps and questions

List unknowns separately from facts.

Include anything not proven from:

- qbo source
- llm-gateway source
- llm-gateway local docs
- command output from this checkout

Do not silently fill gaps.

## Document Format

# llm-gateway Provider Harness Contract

## Summary

## Provider IDs In This App

## Current App Call Sites

## Request Package Sent Today

## Official Response Package

## Streaming vs Non-Streaming

## Raw Package That Reaches This Server Today

## Proposed Mongo Storage Shape

## Gaps And Questions

## Evidence

## Evidence Rules

- Every important claim must include a source path and line number, local docs link/path, command output, or clearly labeled inference.
- Clearly label qbo-side facts vs llm-gateway-side facts.
- Clearly label local llm-gateway docs as local provider documentation.
- Do not cite generic OpenAI docs as the primary contract unless a claim truly depends on OpenAI-compatible behavior and is also tied back to llm-gateway docs/source.
- Do not include secret values.
- Do not modify anything outside `provider-harness-research/providers/llm-gateway.md`.
- Before finishing, run `git diff -- provider-harness-research/providers/llm-gateway.md` and make sure the only changed file is your provider document.
- In your final response, summarize the document you created and list any uncertainties.
