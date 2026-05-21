# LM Studio Provider Harness Master Checklist

Source plan:

- `provider-harness-research/plan-lm-studio-end-to-end/v0.1.md`

Provider identity:

- App provider id: `lm-studio`
- Research id: `lm-studio-openai-compatible`

Working rule:

```text
LM Studio provider attempt starts
-> app sends request package
-> LM Studio sends response/error/stream package
-> app receives that package
-> Mongo preserves that package in the LM Studio-specific shape
-> existing app behavior continues unchanged
```

Do not mark this complete because generic HTTP capture exists. This checklist is for the provider-specific LM Studio harness.

## Status Legend

- `[ ]` Not started
- `[~]` Started / partial
- `[x]` Complete
- `[!]` Blocked or needs decision

## Current Known State

- `[x]` LM Studio provider research document exists.
- `[x]` LM Studio end-to-end plan exists.
- `[x]` LM Studio-specific capture exists for `lm-studio.js` non-streaming paths.
- `[x]` A strict `lmStudio` schema exists in `server/src/models/ProviderCallPackage.js`.
- `[x]` LM Studio-specific recorder functions exist.
- `[x]` LM Studio streaming chat capture exists.
- `[x]` `image-parser.js` `callLmStudio` writes the LM Studio-specific package shape.
- `[x]` Targeted LM Studio schema, recorder, non-streaming service, streaming service, and image-parser tests pass.
- `[x]` Real LM Studio runtime verification is complete.

## Phase 0: Reconcile Current Worktree

- `[x]` Run `git status --short`.
- `[x]` Identify unrelated modified files before implementation starts.
- `[x]` Review current diff for `server/src/models/ProviderCallPackage.js`.
- `[x]` Decide whether to keep, replace, or revise the partial `lmStudio` schema.
- `[x]` Confirm no unrelated client/UI files are included in the LM Studio implementation diff.
- `[x]` Confirm `server/src/lib/provider-harness-trace.js` state before relying on any harness tracing imports.
- `[x]` Confirm the implementation starts from a known baseline.

Exit gate:

- `[x]` Worktree state is understood and the LM Studio implementation files are clearly separated from unrelated changes.

## Phase 1: Strict LM Studio Storage Shape

Files:

- `server/src/models/ProviderCallPackage.js`
- focused model/recorder tests

Schema checklist:

- `[x]` Add or finalize strict `lmStudio` subdocument.
- `[x]` Add strict LM Studio request schema.
- `[x]` Add strict LM Studio response schema.
- `[x]` Add strict LM Studio stream schema.
- `[x]` Add strict LM Studio raw chunk schema.
- `[x]` Add strict LM Studio SSE frame schema.
- `[x]` Add strict LM Studio JSON parse error schema.
- `[x]` Add strict LM Studio provider error schema.
- `[x]` Confirm `ProviderCallPackage.lmStudio` is accepted by the top-level schema.
- `[x]` Keep provider-returned JSON flexible enough to preserve arbitrary LM Studio/OpenAI-compatible fields.

Required fields checklist:

- `[x]` `lmStudio.mode`
- `[x]` `lmStudio.request.method`
- `[x]` `lmStudio.request.baseUrl`
- `[x]` `lmStudio.request.url`
- `[x]` `lmStudio.request.headers`
- `[x]` `lmStudio.request.bodyText`
- `[x]` `lmStudio.request.bodyJson`
- `[x]` `lmStudio.request.bodyByteLength`
- `[x]` `lmStudio.request.bodySha256`
- `[x]` `lmStudio.request.modelRequested`
- `[x]` `lmStudio.request.stream`
- `[x]` `lmStudio.request.timeoutMs`
- `[x]` `lmStudio.response.received`
- `[x]` `lmStudio.response.statusCode`
- `[x]` `lmStudio.response.statusMessage`
- `[x]` `lmStudio.response.httpVersion`
- `[x]` `lmStudio.response.headers`
- `[x]` `lmStudio.response.rawHeaders`
- `[x]` `lmStudio.response.trailers`
- `[x]` `lmStudio.response.rawTrailers`
- `[x]` `lmStudio.response.bodyChunks`
- `[x]` `lmStudio.response.bodyText`
- `[x]` `lmStudio.response.bodyByteLength`
- `[x]` `lmStudio.response.bodySha256`
- `[x]` `lmStudio.response.parsedJson`
- `[x]` `lmStudio.response.jsonParseError`
- `[x]` `lmStudio.stream.rawChunks` or equivalent ordered raw stream chunk storage
- `[x]` `lmStudio.stream.frames`
- `[x]` `lmStudio.stream.parsedChunks`
- `[x]` `lmStudio.stream.doneSeen`
- `[x]` `lmStudio.stream.terminator`
- `[x]` `lmStudio.stream.finalBuffer`
- `[x]` `lmStudio.stream.fullResponse`
- `[x]` `lmStudio.stream.usage`
- `[x]` `lmStudio.error.rawBody`
- `[x]` `lmStudio.error.object`

Tests:

- `[x]` Valid LM Studio non-stream package saves.
- `[x]` Valid LM Studio stream package saves.
- `[x]` Unknown field inside strict LM Studio request schema is rejected.
- `[x]` Unknown field inside strict LM Studio response schema is rejected.
- `[x]` Unknown field inside strict LM Studio stream schema is rejected.
- `[x]` Arbitrary provider JSON inside `parsedJson` is preserved.
- `[x]` Arbitrary provider JSON inside `parsedChunks` is preserved.

Exit gate:

- `[x]` Strict LM Studio schema tests pass.

## Phase 2: LM Studio Recorder Builder

Files:

- `server/src/services/provider-call-package-recorder.js`
- `server/src/services/provider-call-package-redaction.js`
- `server/src/services/provider-call-package-payload-store.js`
- focused recorder/redaction/payload tests

Recorder API:

- `[x]` Add `buildLmStudioProviderCallPackage(input)`.
- `[x]` Add `recordLmStudioProviderCallPackage(input, options)`.
- `[x]` Add `recordLmStudioProviderCallPackageInBackground(input, options)`.
- `[x]` Export LM Studio recorder functions.
- `[x]` Use the existing test-only recorder settled hook for background assertions.

Builder requirements:

- `[x]` Builds `providerId: 'lm-studio'`.
- `[x]` Builds `providerResearchId: 'lm-studio-openai-compatible'`.
- `[x]` Builds `providerPathType: 'lm-studio-http-nonstream'` for non-stream calls.
- `[x]` Builds `providerPathType: 'lm-studio-http-stream'` for streaming calls.
- `[x]` Builds correct `callSite`.
- `[x]` Builds correct `operation`.
- `[x]` Builds top-level `timing`.
- `[x]` Builds top-level `outcome`.
- `[x]` Builds top-level `error` when applicable.
- `[x]` Builds strict `lmStudio` package.
- `[x]` Leaves `cli` null for LM Studio packages.

Outcome classification:

- `[x]` `success`
- `[x]` `http_error`
- `[x]` `network_error`
- `[x]` `timeout`
- `[x]` `aborted`
- `[x]` `invalid_json`
- `[x]` `malformed_sse`
- `[x]` `stream_end_without_done` or equivalent terminator metadata preserving current behavior

Redaction:

- `[x]` Outgoing `Authorization` header is redacted.
- `[x]` Outgoing `Proxy-Authorization` is redacted if present.
- `[x]` Cookie-like outgoing headers are redacted if present.
- `[x]` Secret-like request body keys are redacted.
- `[x]` Redaction notes record redacted paths.
- `[x]` Provider output is not cleaned or summarized.

Payload externalization:

- `[x]` `lmStudio.request.bodyText` can externalize.
- `[x]` `lmStudio.request.bodyJson` can externalize.
- `[x]` `lmStudio.response.bodyText` can externalize.
- `[x]` `lmStudio.response.parsedJson` can externalize.
- `[x]` `lmStudio.response.bodyChunks[].text` can externalize.
- `[x]` `lmStudio.stream.rawChunks[].text` or equivalent can externalize.
- `[x]` `lmStudio.stream.frames[].rawLine` can externalize.
- `[x]` `lmStudio.stream.frames[].data` can externalize.
- `[x]` `lmStudio.stream.parsedChunks` can externalize.
- `[x]` `lmStudio.stream.finalBuffer` can externalize.
- `[x]` `lmStudio.stream.fullResponse` can externalize.
- `[x]` `lmStudio.error.rawBody` can externalize.
- `[x]` Duplicate huge body text/body JSON is not stored twice when equivalent.
- `[x]` No silent truncation.

Tests:

- `[x]` Builder creates complete non-stream package.
- `[x]` Builder creates complete stream package.
- `[x]` Builder classifies HTTP error.
- `[x]` Builder classifies network error.
- `[x]` Builder classifies timeout.
- `[x]` Builder classifies invalid JSON.
- `[x]` Redaction removes outgoing Authorization.
- `[x]` Large LM Studio payloads externalize without truncation.
- `[x]` Background recorder does not block provider return.
- `[x]` Recorder failure does not fail caller.

Exit gate:

- `[x]` Recorder, redaction, and payload tests pass for LM Studio-specific packages.

## Phase 3: `lm-studio.js` Non-Streaming Paths

Files:

- `server/src/services/lm-studio.js`
- `server/test/lm-studio.test.js`

Paths:

- `[x]` Wire `parseEscalation`.
- `[x]` Wire `transcribeImage`.

Implementation requirements:

- `[x]` Capture request package before/when request is written.
- `[x]` Capture response headers immediately when Node `IncomingMessage` arrives.
- `[x]` Capture status code and status message.
- `[x]` Capture HTTP version.
- `[x]` Capture response headers and raw headers.
- `[x]` Capture trailers and raw trailers.
- `[x]` Capture ordered body chunks.
- `[x]` Capture full body text.
- `[x]` Capture parsed JSON when parseable.
- `[x]` Capture parse error when not parseable.
- `[x]` Capture non-200 body in full.
- `[x]` Capture network error facts when no HTTP response exists.
- `[x]` Capture timeout facts.
- `[x]` Queue recorder in background.
- `[x]` Do not await recorder writes before returning provider result.
- `[x]` Keep `parseEscalation` return shape unchanged.
- `[x]` Keep `transcribeImage` return shape unchanged.

Tests:

- `[x]` `parseEscalation` success writes exactly one LM Studio-specific record.
- `[x]` `transcribeImage` success writes exactly one LM Studio-specific record.
- `[x]` Non-200 response preserves full error body.
- `[x]` Invalid JSON response preserves raw body and parse error.
- `[x]` Network error records package when possible.
- `[x]` Timeout records timeout facts when possible.
- `[x]` Provider return shape remains unchanged.
- `[x]` Recorder failure does not fail the provider call.
- `[x]` Capture disabled writes no record.

Exit gate:

- `[x]` `lm-studio.js` non-streaming tests pass.

## Phase 4: `lm-studio.js` Streaming Chat

Files:

- `server/src/services/lm-studio.js`
- `server/test/lm-studio.test.js`

Path:

- `[x]` Wire `chat`.

Implementation requirements:

- `[x]` Capture request package before `req.end()`.
- `[x]` Capture response headers immediately in response callback.
- `[x]` Capture non-200 streaming response body in full.
- `[x]` Capture every raw network chunk in order.
- `[x]` Capture every complete SSE frame in order.
- `[x]` Capture `data: [DONE]` frame.
- `[x]` Capture parsed JSON chunk object before extracting `delta.content`.
- `[x]` Preserve fields not forwarded to UI, including `reasoning_content` when present.
- `[x]` Preserve malformed frame text and parse error.
- `[x]` Preserve final incomplete `sseBuffer`.
- `[x]` Preserve end-without-`[DONE]` terminator.
- `[x]` Preserve timeout facts.
- `[x]` Preserve network error facts.
- `[x]` Preserve app-visible `fullResponse` as a derived field.
- `[x]` Preserve usage chunk/object if present.
- `[x]` Queue recorder in background after terminal stream event.
- `[x]` Keep `onChunk(delta.content)` behavior unchanged.
- `[x]` Keep `onDone(fullResponse, usage)` behavior unchanged.
- `[x]` Keep `onError(error)` behavior unchanged.
- `[x]` Cleanup still aborts/destroys request as before.

Tests:

- `[x]` Streaming success with `[DONE]` writes exactly one LM Studio stream record.
- `[x]` Record contains ordered raw chunks.
- `[x]` Record contains ordered SSE frames.
- `[x]` Record contains parsed chunk JSON.
- `[x]` Record preserves fields not forwarded to UI.
- `[x]` `delta.reasoning_content` is preserved when present.
- `[x]` `[DONE]` is preserved.
- `[x]` End without `[DONE]` is preserved.
- `[x]` Non-200 streaming error preserves full error body.
- `[x]` Malformed SSE JSON frame is preserved with parse error.
- `[x]` Timeout preserves timeout facts.
- `[x]` Recorder failure does not fail chat callbacks.
- `[x]` Provider callback behavior remains unchanged.
- `[x]` Capture disabled writes no record.

Exit gate:

- `[x]` LM Studio streaming chat tests pass.

## Phase 5: `image-parser.js` `callLmStudio`

Files:

- `server/src/services/image-parser.js`
- `server/test/image-parser.test.js`

Path:

- `[x]` Wire only `callLmStudio`.

Implementation requirements:

- `[x]` Do not alter other image-parser provider branches.
- `[x]` Preserve existing image-parser behavior.
- `[x]` Route LM Studio capture context to LM Studio-specific recorder.
- `[x]` Preserve exact request body sent after image conversion.
- `[~]` Preserve conversion stats if already available without broad refactor. Exact post-conversion request body is preserved; conversion telemetry is app-side metadata and was not added to the provider package.
- `[x]` Preserve full LM Studio response body or external reference.
- `[x]` Preserve parsed JSON view when parseable.
- `[x]` Preserve non-200 body in full.
- `[x]` Queue recorder in background.
- `[x]` Do not await recorder writes before returning provider result.

Tests:

- `[x]` `callLmStudio` success writes exactly one LM Studio-specific record.
- `[x]` Record includes `providerId: 'lm-studio'`.
- `[x]` Record includes `providerResearchId: 'lm-studio-openai-compatible'`.
- `[x]` Record includes `providerPathType: 'lm-studio-http-nonstream'`.
- `[x]` Record includes `operation: 'image-parse'`.
- `[x]` Record includes `callSite: 'image-parser:callLmStudio'`.
- `[x]` Record includes full raw response body or external reference.
- `[x]` Record includes parsed JSON view.
- `[x]` Non-200 body is preserved.
- `[~]` Image conversion stats are preserved if available. The provider package preserves the exact converted request body; separate conversion telemetry remains outside this provider package.
- `[x]` Other image-parser provider tests still pass.

Exit gate:

- `[x]` `image-parser.js` `callLmStudio` tests pass.

## Phase 6: Provider-Level End-To-End Tests

Automated mocked workflow tests:

- `[x]` `lm-studio.js parseEscalation`
- `[x]` `lm-studio.js transcribeImage`
- `[x]` `lm-studio.js chat` streaming
- `[x]` `image-parser.js callLmStudio`

Each workflow test asserts:

- `[x]` Existing app result is unchanged.
- `[x]` Exactly one provider package record is created per LM Studio provider attempt.
- `[x]` `providerId === 'lm-studio'`.
- `[x]` `providerResearchId === 'lm-studio-openai-compatible'`.
- `[x]` Correct `providerPathType`.
- `[x]` Correct `callSite`.
- `[x]` Correct `operation`.
- `[x]` `lmStudio` package exists.
- `[x]` Raw provider response exists inline or by payload reference.
- `[x]` Parsed provider view exists when parseable.
- `[x]` Headers/status/timing are preserved.
- `[x]` No full raw provider body is printed to terminal output by new code.

Targeted command checklist:

- `[x]` `npm --prefix server test -- test/lm-studio.test.js`
- `[x]` `npm --prefix server test -- test/image-parser.test.js`
- `[x]` `npm --prefix server test -- test/provider-call-package-recorder.test.js`
- `[x]` `npm --prefix server test -- test/provider-call-package-redaction.test.js`
- `[x]` `npm --prefix server test -- test/provider-call-package-payload-store.test.js`

Full verification:

- `[x]` `npm --prefix server test`
- `[x]` `git diff --check`

Exit gate:

- `[x]` Targeted tests and full server tests pass.

## Phase 7: Real LM Studio Runtime Verification

Prerequisites:

- `[x]` LM Studio is running locally.
- `[x]` LM Studio local server is enabled.
- `[x]` `LM_STUDIO_API_URL` points to the correct local server.
- `[x]` At least one chat-capable model is loaded or available.
- `[x]` MongoDB is connected.
- `[x]` `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true`.

Manual verification targets:

- `[x]` Non-stream parse attempt.
- `[x]` Non-stream image parse attempt.
- `[x]` Streaming chat attempt.

For each real attempt:

- `[x]` Provider call succeeds from app perspective.
- `[x]` Mongo contains one LM Studio package record for the attempt.
- `[x]` Record contains full provider response package inline or by external payload refs.
- `[x]` Record contains request body inline or by external payload refs.
- `[x]` Record contains response headers/status/timing.
- `[x]` Streaming record contains stream frames.
- `[x]` Streaming record contains parsed chunk objects.
- `[~]` Non-200/manual failure test preserves full error body if performed. Not repeated against live LM Studio; automated non-200 coverage passed for LM Studio stream and non-stream paths.
- `[x]` No provider response is silently truncated.
- `[x]` Existing parser/chat behavior remains unchanged.

Exit gate:

- `[x]` Real runtime verification is complete.

## Final Done Checklist

Do not call LM Studio end-to-end complete until all of these are true:

- `[x]` Strict LM Studio Mongo shape exists and is tested.
- `[x]` LM Studio recorder builder exists and is tested.
- `[x]` LM Studio redaction support exists and is tested.
- `[x]` LM Studio payload externalization exists and is tested.
- `[x]` `parseEscalation` writes a complete LM Studio non-stream package.
- `[x]` `transcribeImage` writes a complete LM Studio non-stream package.
- `[x]` `chat` writes a complete LM Studio stream package.
- `[x]` `callLmStudio` writes a complete LM Studio image-parser package.
- `[x]` Full provider response bodies are preserved inline or by explicit payload reference.
- `[x]` Full streaming frames/chunks are preserved inline or by explicit payload reference.
- `[x]` Non-200 error bodies are preserved beyond current 500-character error messages.
- `[x]` Malformed JSON/SSE facts are preserved.
- `[x]` Provider calls do not wait for Mongo/file recording.
- `[x]` Recorder failures do not fail provider calls.
- `[x]` Existing provider return/callback behavior is unchanged.
- `[x]` Parser logic is unchanged.
- `[x]` Prompt text is unchanged.
- `[x]` Fallback behavior is unchanged.
- `[x]` No other provider harness was changed as part of this implementation.
- `[x]` Targeted tests pass.
- `[x]` Full server tests pass.
- `[x]` Worktree contains only intended LM Studio/provider-package changes.
- `[x]` Stop-and-review notes are written or reviewer has signed off.

## Commit Checklist

- `[x]` Run `git status --short`.
- `[x]` Confirm no client/UI files are staged.
- `[x]` Confirm no prompt files are staged.
- `[x]` Confirm no fallback/router files are staged.
- `[x]` Confirm no unrelated provider files are staged.
- `[x]` Run `git diff --cached --check` after staging.
- `[x]` Commit message names LM Studio provider harness work.
- `[x]` Push only after tests and staged diff are reviewed.
