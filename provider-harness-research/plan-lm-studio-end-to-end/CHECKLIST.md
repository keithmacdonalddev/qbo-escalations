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
- `[~]` Generic HTTP capture exists for some LM Studio non-streaming paths.
- `[~]` A partial `lmStudio` schema exists in `server/src/models/ProviderCallPackage.js`.
- `[ ]` LM Studio-specific recorder functions exist.
- `[ ]` LM Studio streaming chat capture exists.
- `[ ]` `image-parser.js` `callLmStudio` writes the LM Studio-specific package shape.
- `[ ]` Targeted LM Studio end-to-end tests pass.
- `[ ]` Real LM Studio runtime verification is complete.

## Phase 0: Reconcile Current Worktree

- `[ ]` Run `git status --short`.
- `[ ]` Identify unrelated modified files before implementation starts.
- `[ ]` Review current diff for `server/src/models/ProviderCallPackage.js`.
- `[ ]` Decide whether to keep, replace, or revise the partial `lmStudio` schema.
- `[ ]` Confirm no unrelated client/UI files are included in the LM Studio implementation diff.
- `[ ]` Confirm `server/src/lib/provider-harness-trace.js` state before relying on any harness tracing imports.
- `[ ]` Confirm the implementation starts from a known baseline.

Exit gate:

- `[ ]` Worktree state is understood and the LM Studio implementation files are clearly separated from unrelated changes.

## Phase 1: Strict LM Studio Storage Shape

Files:

- `server/src/models/ProviderCallPackage.js`
- focused model/recorder tests

Schema checklist:

- `[ ]` Add or finalize strict `lmStudio` subdocument.
- `[ ]` Add strict LM Studio request schema.
- `[ ]` Add strict LM Studio response schema.
- `[ ]` Add strict LM Studio stream schema.
- `[ ]` Add strict LM Studio raw chunk schema.
- `[ ]` Add strict LM Studio SSE frame schema.
- `[ ]` Add strict LM Studio JSON parse error schema.
- `[ ]` Add strict LM Studio provider error schema.
- `[ ]` Confirm `ProviderCallPackage.lmStudio` is accepted by the top-level schema.
- `[ ]` Keep provider-returned JSON flexible enough to preserve arbitrary LM Studio/OpenAI-compatible fields.

Required fields checklist:

- `[ ]` `lmStudio.mode`
- `[ ]` `lmStudio.request.method`
- `[ ]` `lmStudio.request.baseUrl`
- `[ ]` `lmStudio.request.url`
- `[ ]` `lmStudio.request.headers`
- `[ ]` `lmStudio.request.bodyText`
- `[ ]` `lmStudio.request.bodyJson`
- `[ ]` `lmStudio.request.bodyByteLength`
- `[ ]` `lmStudio.request.bodySha256`
- `[ ]` `lmStudio.request.modelRequested`
- `[ ]` `lmStudio.request.stream`
- `[ ]` `lmStudio.request.timeoutMs`
- `[ ]` `lmStudio.response.received`
- `[ ]` `lmStudio.response.statusCode`
- `[ ]` `lmStudio.response.statusMessage`
- `[ ]` `lmStudio.response.httpVersion`
- `[ ]` `lmStudio.response.headers`
- `[ ]` `lmStudio.response.rawHeaders`
- `[ ]` `lmStudio.response.trailers`
- `[ ]` `lmStudio.response.rawTrailers`
- `[ ]` `lmStudio.response.bodyChunks`
- `[ ]` `lmStudio.response.bodyText`
- `[ ]` `lmStudio.response.bodyByteLength`
- `[ ]` `lmStudio.response.bodySha256`
- `[ ]` `lmStudio.response.parsedJson`
- `[ ]` `lmStudio.response.jsonParseError`
- `[ ]` `lmStudio.stream.rawChunks` or equivalent ordered raw stream chunk storage
- `[ ]` `lmStudio.stream.frames`
- `[ ]` `lmStudio.stream.parsedChunks`
- `[ ]` `lmStudio.stream.doneSeen`
- `[ ]` `lmStudio.stream.terminator`
- `[ ]` `lmStudio.stream.finalBuffer`
- `[ ]` `lmStudio.stream.fullResponse`
- `[ ]` `lmStudio.stream.usage`
- `[ ]` `lmStudio.error.rawBody`
- `[ ]` `lmStudio.error.object`

Tests:

- `[ ]` Valid LM Studio non-stream package saves.
- `[ ]` Valid LM Studio stream package saves.
- `[ ]` Unknown field inside strict LM Studio request schema is rejected.
- `[ ]` Unknown field inside strict LM Studio response schema is rejected.
- `[ ]` Unknown field inside strict LM Studio stream schema is rejected.
- `[ ]` Arbitrary provider JSON inside `parsedJson` is preserved.
- `[ ]` Arbitrary provider JSON inside `parsedChunks` is preserved.

Exit gate:

- `[ ]` Strict LM Studio schema tests pass.

## Phase 2: LM Studio Recorder Builder

Files:

- `server/src/services/provider-call-package-recorder.js`
- `server/src/services/provider-call-package-redaction.js`
- `server/src/services/provider-call-package-payload-store.js`
- focused recorder/redaction/payload tests

Recorder API:

- `[ ]` Add `buildLmStudioProviderCallPackage(input)`.
- `[ ]` Add `recordLmStudioProviderCallPackage(input, options)`.
- `[ ]` Add `recordLmStudioProviderCallPackageInBackground(input, options)`.
- `[ ]` Export LM Studio recorder functions.
- `[ ]` Use the existing test-only recorder settled hook for background assertions.

Builder requirements:

- `[ ]` Builds `providerId: 'lm-studio'`.
- `[ ]` Builds `providerResearchId: 'lm-studio-openai-compatible'`.
- `[ ]` Builds `providerPathType: 'lm-studio-http-nonstream'` for non-stream calls.
- `[ ]` Builds `providerPathType: 'lm-studio-http-stream'` for streaming calls.
- `[ ]` Builds correct `callSite`.
- `[ ]` Builds correct `operation`.
- `[ ]` Builds top-level `timing`.
- `[ ]` Builds top-level `outcome`.
- `[ ]` Builds top-level `error` when applicable.
- `[ ]` Builds strict `lmStudio` package.
- `[ ]` Leaves `cli` null for LM Studio packages.

Outcome classification:

- `[ ]` `success`
- `[ ]` `http_error`
- `[ ]` `network_error`
- `[ ]` `timeout`
- `[ ]` `aborted`
- `[ ]` `invalid_json`
- `[ ]` `malformed_sse`
- `[ ]` `stream_end_without_done` or equivalent terminator metadata preserving current behavior

Redaction:

- `[ ]` Outgoing `Authorization` header is redacted.
- `[ ]` Outgoing `Proxy-Authorization` is redacted if present.
- `[ ]` Cookie-like outgoing headers are redacted if present.
- `[ ]` Secret-like request body keys are redacted.
- `[ ]` Redaction notes record redacted paths.
- `[ ]` Provider output is not cleaned or summarized.

Payload externalization:

- `[ ]` `lmStudio.request.bodyText` can externalize.
- `[ ]` `lmStudio.request.bodyJson` can externalize.
- `[ ]` `lmStudio.response.bodyText` can externalize.
- `[ ]` `lmStudio.response.parsedJson` can externalize.
- `[ ]` `lmStudio.response.bodyChunks[].text` can externalize.
- `[ ]` `lmStudio.stream.rawChunks[].text` or equivalent can externalize.
- `[ ]` `lmStudio.stream.frames[].rawLine` can externalize.
- `[ ]` `lmStudio.stream.frames[].data` can externalize.
- `[ ]` `lmStudio.stream.parsedChunks` can externalize.
- `[ ]` `lmStudio.stream.finalBuffer` can externalize.
- `[ ]` `lmStudio.stream.fullResponse` can externalize.
- `[ ]` `lmStudio.error.rawBody` can externalize.
- `[ ]` Duplicate huge body text/body JSON is not stored twice when equivalent.
- `[ ]` No silent truncation.

Tests:

- `[ ]` Builder creates complete non-stream package.
- `[ ]` Builder creates complete stream package.
- `[ ]` Builder classifies HTTP error.
- `[ ]` Builder classifies network error.
- `[ ]` Builder classifies timeout.
- `[ ]` Builder classifies invalid JSON.
- `[ ]` Redaction removes outgoing Authorization.
- `[ ]` Large LM Studio payloads externalize without truncation.
- `[ ]` Background recorder does not block provider return.
- `[ ]` Recorder failure does not fail caller.

Exit gate:

- `[ ]` Recorder, redaction, and payload tests pass for LM Studio-specific packages.

## Phase 3: `lm-studio.js` Non-Streaming Paths

Files:

- `server/src/services/lm-studio.js`
- `server/test/lm-studio.test.js`

Paths:

- `[ ]` Wire `parseEscalation`.
- `[ ]` Wire `transcribeImage`.

Implementation requirements:

- `[ ]` Capture request package before/when request is written.
- `[ ]` Capture response headers immediately when Node `IncomingMessage` arrives.
- `[ ]` Capture status code and status message.
- `[ ]` Capture HTTP version.
- `[ ]` Capture response headers and raw headers.
- `[ ]` Capture trailers and raw trailers.
- `[ ]` Capture ordered body chunks.
- `[ ]` Capture full body text.
- `[ ]` Capture parsed JSON when parseable.
- `[ ]` Capture parse error when not parseable.
- `[ ]` Capture non-200 body in full.
- `[ ]` Capture network error facts when no HTTP response exists.
- `[ ]` Capture timeout facts.
- `[ ]` Queue recorder in background.
- `[ ]` Do not await recorder writes before returning provider result.
- `[ ]` Keep `parseEscalation` return shape unchanged.
- `[ ]` Keep `transcribeImage` return shape unchanged.

Tests:

- `[ ]` `parseEscalation` success writes exactly one LM Studio-specific record.
- `[ ]` `transcribeImage` success writes exactly one LM Studio-specific record.
- `[ ]` Non-200 response preserves full error body.
- `[ ]` Invalid JSON response preserves raw body and parse error.
- `[ ]` Network error records package when possible.
- `[ ]` Timeout records timeout facts when possible.
- `[ ]` Provider return shape remains unchanged.
- `[ ]` Recorder failure does not fail the provider call.
- `[ ]` Capture disabled writes no record.

Exit gate:

- `[ ]` `lm-studio.js` non-streaming tests pass.

## Phase 4: `lm-studio.js` Streaming Chat

Files:

- `server/src/services/lm-studio.js`
- `server/test/lm-studio.test.js`

Path:

- `[ ]` Wire `chat`.

Implementation requirements:

- `[ ]` Capture request package before `req.end()`.
- `[ ]` Capture response headers immediately in response callback.
- `[ ]` Capture non-200 streaming response body in full.
- `[ ]` Capture every raw network chunk in order.
- `[ ]` Capture every complete SSE frame in order.
- `[ ]` Capture `data: [DONE]` frame.
- `[ ]` Capture parsed JSON chunk object before extracting `delta.content`.
- `[ ]` Preserve fields not forwarded to UI, including `reasoning_content` when present.
- `[ ]` Preserve malformed frame text and parse error.
- `[ ]` Preserve final incomplete `sseBuffer`.
- `[ ]` Preserve end-without-`[DONE]` terminator.
- `[ ]` Preserve timeout facts.
- `[ ]` Preserve network error facts.
- `[ ]` Preserve app-visible `fullResponse` as a derived field.
- `[ ]` Preserve usage chunk/object if present.
- `[ ]` Queue recorder in background after terminal stream event.
- `[ ]` Keep `onChunk(delta.content)` behavior unchanged.
- `[ ]` Keep `onDone(fullResponse, usage)` behavior unchanged.
- `[ ]` Keep `onError(error)` behavior unchanged.
- `[ ]` Cleanup still aborts/destroys request as before.

Tests:

- `[ ]` Streaming success with `[DONE]` writes exactly one LM Studio stream record.
- `[ ]` Record contains ordered raw chunks.
- `[ ]` Record contains ordered SSE frames.
- `[ ]` Record contains parsed chunk JSON.
- `[ ]` Record preserves fields not forwarded to UI.
- `[ ]` `delta.reasoning_content` is preserved when present.
- `[ ]` `[DONE]` is preserved.
- `[ ]` End without `[DONE]` is preserved.
- `[ ]` Non-200 streaming error preserves full error body.
- `[ ]` Malformed SSE JSON frame is preserved with parse error.
- `[ ]` Timeout preserves timeout facts.
- `[ ]` Recorder failure does not fail chat callbacks.
- `[ ]` Provider callback behavior remains unchanged.
- `[ ]` Capture disabled writes no record.

Exit gate:

- `[ ]` LM Studio streaming chat tests pass.

## Phase 5: `image-parser.js` `callLmStudio`

Files:

- `server/src/services/image-parser.js`
- `server/test/image-parser.test.js`

Path:

- `[ ]` Wire only `callLmStudio`.

Implementation requirements:

- `[ ]` Do not alter other image-parser provider branches.
- `[ ]` Preserve existing image-parser behavior.
- `[ ]` Route LM Studio capture context to LM Studio-specific recorder.
- `[ ]` Preserve exact request body sent after image conversion.
- `[ ]` Preserve conversion stats if already available without broad refactor.
- `[ ]` Preserve full LM Studio response body or external reference.
- `[ ]` Preserve parsed JSON view when parseable.
- `[ ]` Preserve non-200 body in full.
- `[ ]` Queue recorder in background.
- `[ ]` Do not await recorder writes before returning provider result.

Tests:

- `[ ]` `callLmStudio` success writes exactly one LM Studio-specific record.
- `[ ]` Record includes `providerId: 'lm-studio'`.
- `[ ]` Record includes `providerResearchId: 'lm-studio-openai-compatible'`.
- `[ ]` Record includes `providerPathType: 'lm-studio-http-nonstream'`.
- `[ ]` Record includes `operation: 'image-parse'`.
- `[ ]` Record includes `callSite: 'image-parser:callLmStudio'`.
- `[ ]` Record includes full raw response body or external reference.
- `[ ]` Record includes parsed JSON view.
- `[ ]` Non-200 body is preserved.
- `[ ]` Image conversion stats are preserved if available.
- `[ ]` Other image-parser provider tests still pass.

Exit gate:

- `[ ]` `image-parser.js` `callLmStudio` tests pass.

## Phase 6: Provider-Level End-To-End Tests

Automated mocked workflow tests:

- `[ ]` `lm-studio.js parseEscalation`
- `[ ]` `lm-studio.js transcribeImage`
- `[ ]` `lm-studio.js chat` streaming
- `[ ]` `image-parser.js callLmStudio`

Each workflow test asserts:

- `[ ]` Existing app result is unchanged.
- `[ ]` Exactly one provider package record is created per LM Studio provider attempt.
- `[ ]` `providerId === 'lm-studio'`.
- `[ ]` `providerResearchId === 'lm-studio-openai-compatible'`.
- `[ ]` Correct `providerPathType`.
- `[ ]` Correct `callSite`.
- `[ ]` Correct `operation`.
- `[ ]` `lmStudio` package exists.
- `[ ]` Raw provider response exists inline or by payload reference.
- `[ ]` Parsed provider view exists when parseable.
- `[ ]` Headers/status/timing are preserved.
- `[ ]` No full raw provider body is printed to terminal output by new code.

Targeted command checklist:

- `[ ]` `npm --prefix server test -- test/lm-studio.test.js`
- `[ ]` `npm --prefix server test -- test/image-parser.test.js`
- `[ ]` `npm --prefix server test -- test/provider-call-package-recorder.test.js`
- `[ ]` `npm --prefix server test -- test/provider-call-package-redaction.test.js`
- `[ ]` `npm --prefix server test -- test/provider-call-package-payload-store.test.js`

Full verification:

- `[ ]` `npm --prefix server test`
- `[ ]` `git diff --check`

Exit gate:

- `[ ]` Targeted tests and full server tests pass.

## Phase 7: Real LM Studio Runtime Verification

Prerequisites:

- `[ ]` LM Studio is running locally.
- `[ ]` LM Studio local server is enabled.
- `[ ]` `LM_STUDIO_API_URL` points to the correct local server.
- `[ ]` At least one chat-capable model is loaded or available.
- `[ ]` MongoDB is connected.
- `[ ]` `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true`.

Manual verification targets:

- `[ ]` Non-stream parse attempt.
- `[ ]` Non-stream image parse attempt.
- `[ ]` Streaming chat attempt.

For each real attempt:

- `[ ]` Provider call succeeds from app perspective.
- `[ ]` Mongo contains one LM Studio package record for the attempt.
- `[ ]` Record contains full provider response package inline or by external payload refs.
- `[ ]` Record contains request body inline or by external payload refs.
- `[ ]` Record contains response headers/status/timing.
- `[ ]` Streaming record contains stream frames.
- `[ ]` Streaming record contains parsed chunk objects.
- `[ ]` Non-200/manual failure test preserves full error body if performed.
- `[ ]` No provider response is silently truncated.
- `[ ]` Existing parser/chat behavior remains unchanged.

Exit gate:

- `[ ]` Real runtime verification is complete or explicitly deferred with reason.

## Final Done Checklist

Do not call LM Studio end-to-end complete until all of these are true:

- `[ ]` Strict LM Studio Mongo shape exists and is tested.
- `[ ]` LM Studio recorder builder exists and is tested.
- `[ ]` LM Studio redaction support exists and is tested.
- `[ ]` LM Studio payload externalization exists and is tested.
- `[ ]` `parseEscalation` writes a complete LM Studio non-stream package.
- `[ ]` `transcribeImage` writes a complete LM Studio non-stream package.
- `[ ]` `chat` writes a complete LM Studio stream package.
- `[ ]` `callLmStudio` writes a complete LM Studio image-parser package.
- `[ ]` Full provider response bodies are preserved inline or by explicit payload reference.
- `[ ]` Full streaming frames/chunks are preserved inline or by explicit payload reference.
- `[ ]` Non-200 error bodies are preserved beyond current 500-character error messages.
- `[ ]` Malformed JSON/SSE facts are preserved.
- `[ ]` Provider calls do not wait for Mongo/file recording.
- `[ ]` Recorder failures do not fail provider calls.
- `[ ]` Existing provider return/callback behavior is unchanged.
- `[ ]` Parser logic is unchanged.
- `[ ]` Prompt text is unchanged.
- `[ ]` Fallback behavior is unchanged.
- `[ ]` No other provider harness was changed as part of this implementation.
- `[ ]` Targeted tests pass.
- `[ ]` Full server tests pass.
- `[ ]` Worktree contains only intended LM Studio/provider-package changes.
- `[ ]` Stop-and-review notes are written or reviewer has signed off.

## Commit Checklist

- `[ ]` Run `git status --short`.
- `[ ]` Confirm no client/UI files are staged.
- `[ ]` Confirm no prompt files are staged.
- `[ ]` Confirm no fallback/router files are staged.
- `[ ]` Confirm no unrelated provider files are staged.
- `[ ]` Run `git diff --cached --check` after staging.
- `[ ]` Commit message names LM Studio provider harness work.
- `[ ]` Push only after tests and staged diff are reviewed.
