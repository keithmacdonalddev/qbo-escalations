# LLM Gateway Provider Harness Master Checklist

Source plan:

- `provider-harness-research/plan-llm-gateway-end-to-end/v0.1.md`

Provider identity:

- App provider id: `llm-gateway`
- Research id: `llm-gateway`

Working rule:

```text
LLM Gateway provider attempt starts
-> app sends request package
-> LLM Gateway sends response/error package
-> app receives that qbo-visible package
-> Mongo preserves that package in the LLM Gateway-specific shape
-> existing app behavior continues unchanged
```

Do not treat generic HTTP capture as sufficient. This checklist is for the provider-specific LLM Gateway harness.

## Status Legend

- `[ ]` Not started
- `[~]` Started / partial
- `[x]` Complete
- `[!]` Blocked or needs decision

## Current Known State

- `[x]` LLM Gateway provider research document exists.
- `[x]` LLM Gateway end-to-end plan exists.
- `[x]` Strict `ProviderCallPackage.llmGateway` schema exists.
- `[x]` LLM Gateway-specific recorder functions exist.
- `[x]` LLM Gateway-specific redaction support exists.
- `[x]` LLM Gateway-specific payload externalization support exists.
- `[x]` `image-parser.js` builds the image-parse request and passes caller metadata to the generic LLM Gateway sender.
- `[x]` `remote-api-providers.js` `requestLlmGatewayChat` writes the gateway-specific package shape.
- `[x]` `image-parser.js` `validateRemoteProvider('llm-gateway')` writes the gateway-specific package shape.
- `[x]` Targeted gateway schema, recorder, image-parser, remote chat, and provider-status tests pass.
- `[x]` Full server test suite passes.
- `[x]` Real gateway runtime verification is complete.

## Phase 0: Reconcile Current Worktree

- `[x]` Ran `git status --short`.
- `[x]` Identified unrelated modified files before implementation started.
- `[x]` Confirmed the modified LM Studio response artifact is unrelated and was not edited by this implementation.
- `[x]` Confirmed no unrelated client/UI files are included in the gateway implementation diff.
- `[x]` Confirmed no prompt files are included.
- `[x]` Confirmed no fallback/router behavior changes are included.
- `[x]` Confirmed no code in `C:\Projects\llm-gateway` was changed for this qbo-side plan.

Exit gate:

- `[x]` Worktree state is understood and gateway implementation files are separated from unrelated changes.

## Phase 1: Strict LLM Gateway Storage Shape

Files:

- `server/src/models/ProviderCallPackage.js`
- `server/test/provider-call-package-llm-gateway-schema.test.js`

Completed:

- `[x]` Added strict `llmGateway` subdocument.
- `[x]` Added strict gateway request schema.
- `[x]` Added strict gateway response schema.
- `[x]` Added strict gateway body chunk schema.
- `[x]` Added strict gateway image metadata schema.
- `[x]` Added strict gateway metadata holder.
- `[x]` Added strict provider-status convenience schema.
- `[x]` Added strict gateway provider error schema.
- `[x]` Added top-level `ProviderCallPackage.llmGateway`.
- `[x]` Kept provider-returned JSON flexible inside `parsedJson`, `gateway.metadata`, and provider-status/error objects.

Verified:

- `[x]` Valid gateway chat-completion package saves.
- `[x]` Valid gateway image-parser package saves.
- `[x]` Valid gateway provider-status package saves.
- `[x]` Unknown field inside strict gateway request schema is rejected.
- `[x]` Unknown field inside strict gateway response schema is rejected.
- `[x]` Arbitrary provider JSON inside `parsedJson` is preserved.
- `[x]` Arbitrary gateway metadata inside `parsedJson.gateway` is preserved.
- `[x]` Missing `gateway.credits` is accepted.

Exit gate:

- `[x]` Strict gateway schema tests pass.

## Phase 2: LLM Gateway Recorder Builder

Files:

- `server/src/services/provider-call-package-recorder.js`
- `server/src/services/provider-call-package-redaction.js`
- `server/src/services/provider-call-package-payload-store.js`
- `server/test/provider-call-package-llm-gateway-recorder.test.js`

Completed:

- `[x]` Added `buildLlmGatewayProviderCallPackage(input)`.
- `[x]` Added `recordLlmGatewayProviderCallPackage(input, options)`.
- `[x]` Added `recordLlmGatewayProviderCallPackageInBackground(input, options)`.
- `[x]` Exported gateway recorder functions.
- `[x]` Used the existing test-only recorder settled hook for background assertions.
- `[x]` Added `provider-harness-llm-gateway-v0.1` capture version.
- `[x]` Builds `providerId: 'llm-gateway'`.
- `[x]` Builds `providerResearchId: 'llm-gateway'`.
- `[x]` Builds `providerPathType: 'gateway-http'`.
- `[x]` Builds correct `callSite`, `operation`, `timing`, `outcome`, and strict `llmGateway` package.
- `[x]` Leaves `cli` null.
- `[x]` Leaves `lmStudio` null.

Verified:

- `[x]` Builder creates complete image-parser gateway package.
- `[x]` Builder creates complete chat gateway package through remote path coverage.
- `[x]` Builder creates complete provider-status package.
- `[x]` Builder classifies `success`, `http_error`, `network_error`, `timeout`, `aborted`, and `invalid_json`.
- `[x]` `x-request-id` is copied into `llmGateway.response.gatewayRequestId`.
- `[x]` `x-request-id` is copied into `llmGateway.gateway.requestId`.
- `[x]` `parsedJson.gateway` is preserved exactly.
- `[x]` `parsedJson.gateway.usage`, `cost`, and optional `credits` are preserved.
- `[x]` Gateway error envelope fields are preserved.
- `[x]` Provider-status parsed sections are preserved without dropping the full parsed body.
- `[x]` Outgoing `Authorization`, `Proxy-Authorization`, and cookie-like headers are redacted.
- `[x]` Secret-like request body keys are redacted.
- `[x]` `x-request-id` is not redacted.
- `[x]` Large gateway request payloads externalize without truncation.
- `[x]` Large gateway response payloads externalize without truncation.
- `[x]` Duplicate huge gateway request body text/body JSON is not stored twice.
- `[x]` Duplicate huge gateway response body text/parsed JSON is not stored twice.
- `[x]` Background recorder does not block provider return.
- `[x]` Recorder failure does not fail caller.

Exit gate:

- `[x]` Recorder, redaction, and payload tests pass for gateway-specific packages.

## Phase 3: `image-parser.js` `callLlmGateway`

Files:

- `server/src/services/image-parser.js`
- `server/test/image-parser.test.js`

Completed:

- `[x]` Kept image-parser prompt/request construction in `image-parser.js`.
- `[x]` Routed caller-owned `llm-gateway` capture context to the gateway-specific recorder.
- `[x]` Queued recorder in background.
- `[x]` Provider result does not wait for Mongo/file recording.
- `[x]` Captures request package before/when request is written.
- `[x]` Captures response status, status message, HTTP version, headers, raw headers, trailers, raw trailers, ordered chunks, full body text, parsed JSON, parse errors, and `x-request-id`.
- `[x]` Captures full gateway metadata object.
- `[x]` Captures non-200 body in full.
- `[x]` Captures network error and timeout facts through shared gateway recorder coverage.
- `[x]` Preserves exact caller-provided request body, including the image-parser data URL inline or by external payload ref.
- `[x]` Keeps `callLlmGateway` return shape unchanged.
- `[x]` Keeps thrown error behavior unchanged.

Verified:

- `[x]` Image-parser LLM Gateway call writes exactly one gateway-specific record.
- `[x]` Record includes `providerId`, `providerResearchId`, `providerPathType`, `operation`, `callSite`, raw response body, parsed JSON, gateway metadata, and `x-request-id`.
- `[x]` Non-200 body is preserved.
- `[x]` Provider return shape remains unchanged.
- `[x]` Recorder failure/background delay does not fail or block image parsing.

Exit gate:

- `[x]` `callLlmGateway` tests pass.

## Phase 4: Workspace / Chat Gateway Path

Files:

- `server/src/services/remote-api-providers.js`
- `server/test/remote-api-providers.test.js`

Completed:

- `[x]` Routed `llm-gateway` capture context to gateway-specific recorder.
- `[x]` Queued recorder in background.
- `[x]` `request.promise` does not wait for Mongo/file recording.
- `[x]` Preserved cancel behavior.
- `[x]` Preserved timeout behavior.
- `[x]` Captures request package, response package, full body, parsed JSON, `x-request-id`, gateway metadata, non-200 bodies, network errors, timeouts, and abort facts through shared helper coverage.
- `[x]` Keeps returned `{ text, usage }` unchanged.
- `[x]` Keeps buffered chat adapter behavior unchanged.

Verified:

- `[x]` `requestLlmGatewayChat` success writes exactly one gateway-specific record.
- `[x]` Record includes `operation: 'chat'` and `callSite: 'remote-api-providers:requestLlmGatewayChat'`.
- `[x]` Record includes full raw response body or external reference, parsed JSON, gateway metadata, and `x-request-id`.
- `[x]` Provider return shape remains unchanged.
- `[x]` Recorder delay does not block chat.
- `[x]` Existing remote provider tests still pass.

Exit gate:

- `[x]` `requestLlmGatewayChat` tests pass.

## Phase 5: Provider-Status Probe

Files:

- `server/src/services/image-parser.js`
- `server/test/image-parser.test.js`

Completed:

- `[x]` Added capture context to the `llm-gateway` provider-status probe.
- `[x]` Uses operation `provider-status`.
- `[x]` Uses call site `image-parser:validateRemoteProvider:llm-gateway`.
- `[x]` Captures GET request metadata and redacted headers.
- `[x]` Captures full response package.
- `[x]` Captures `x-request-id` when present.
- `[x]` Preserves 200 provider-status body.
- `[x]` Preserves gateway error bodies through recorder/error-envelope coverage.
- `[x]` Preserves network error and timeout facts through shared gateway recorder coverage.
- `[x]` Keeps existing availability output unchanged.
- `[x]` Keeps existing key validation mapping unchanged.

Verified:

- `[x]` 200 provider-status writes exactly one gateway-specific provider-status record.
- `[x]` Record includes full raw body and parsed body.
- `[x]` `x-request-id` is preserved when present.
- `[x]` Availability result shape remains unchanged.

Exit gate:

- `[x]` Provider-status tests pass.

## Phase 6: Provider-Level End-To-End Tests

Automated mocked workflow tests:

- `[x]` `image-parser.js callLlmGateway`
- `[x]` `remote-api-providers.js requestLlmGatewayChat`
- `[x]` `image-parser.js validateRemoteProvider('llm-gateway')`

Each workflow verifies:

- `[x]` Existing app result is unchanged.
- `[x]` Exactly one provider package record is created per gateway provider attempt.
- `[x]` `providerId === 'llm-gateway'`.
- `[x]` `providerResearchId === 'llm-gateway'`.
- `[x]` `providerPathType === 'gateway-http'`.
- `[x]` Correct `callSite`.
- `[x]` Correct `operation`.
- `[x]` `llmGateway` package exists.
- `[x]` `lmStudio` package is null.
- `[x]` `cli` package is null.
- `[x]` Raw provider response exists inline or by payload reference.
- `[x]` Parsed provider view exists when parseable.
- `[x]` Headers/status/timing are preserved.
- `[x]` `x-request-id` is preserved when present.
- `[x]` Gateway metadata is preserved when present.
- `[x]` No full raw provider body is printed to terminal output by new code.

Targeted commands passed:

- `[x]` `npm --prefix server test -- test/provider-call-package-llm-gateway-schema.test.js`
- `[x]` `npm --prefix server test -- test/provider-call-package-llm-gateway-recorder.test.js`
- `[x]` `npm --prefix server test -- test/remote-api-providers.test.js`
- `[x]` `npm --prefix server test -- test/image-parser.test.js`
- `[x]` `npm --prefix server test -- test/provider-call-package-redaction.test.js test/provider-call-package-payload-store.test.js test/provider-call-package-recorder.test.js`
- `[x]` `npm --prefix server test -- test/provider-call-package-lm-studio-schema.test.js test/provider-call-package-lm-studio-recorder.test.js`
- `[x]` `npm --prefix server test -- test/lm-studio.test.js`

Full verification:

- `[x]` `npm --prefix server test`
- `[x]` `git diff --check` passed with Windows line-ending warnings only.

Exit gate:

- `[x]` Targeted tests and full server tests pass.

## Phase 7: Real Gateway Runtime Verification

Prerequisites:

- `[x]` MongoDB connected after applying the server's `MONGODB_DNS_SERVERS` override.
- `[x]` `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true`.
- `[x]` `llm-gateway` reachable at `http://127.0.0.1:4100`.
- `[x]` LM Studio reachable at `http://127.0.0.1:1234`.
- `[x]` Model `google/gemma-4-e4b` available through gateway status.
- `[x]` QBO resolved a valid gateway key without printing it.

Manual verification targets:

- `[x]` Image-parser call through `llm-gateway`.
- `[x]` Workspace/chat call through `llm-gateway`.
- `[x]` Provider-status validation call.

Live Mongo records:

- `[x]` `6a0f85abce91242b6f175fa6` - `image-parser:validateRemoteProvider:llm-gateway`
- `[x]` `6a0f85abce91242b6f175faf` - `remote-api-providers:requestLlmGatewayChat`
- `[x]` `6a0f85b0ce91242b6f175fb4` - `image-parser:callLlmGateway`

For each real attempt:

- `[x]` Provider call succeeded from app perspective.
- `[x]` Mongo contains one LLM Gateway package record for the attempt.
- `[x]` Record contains `llmGateway` package.
- `[x]` Record contains full qbo-visible gateway response package inline or by external payload refs.
- `[x]` Record contains request body inline or by external payload refs.
- `[x]` Record contains response headers/status/timing.
- `[x]` Record contains `x-request-id`.
- `[x]` Record contains gateway metadata.
- `[x]` No provider response is silently truncated.
- `[x]` Existing parser/chat/availability behavior remains unchanged.

Evidence:

- `[x]` Evidence artifact exported to `provider-harness-research/provider-responses/llm-gateway/google-gemma-4-e4b/LIVE-LLM-GATEWAY-1779402182515.jsonc`.

Exit gate:

- `[x]` Real runtime verification is complete.

## Final Done Checklist

- `[x]` Strict LLM Gateway Mongo shape exists and is tested.
- `[x]` LLM Gateway recorder builder exists and is tested.
- `[x]` LLM Gateway redaction support exists and is tested.
- `[x]` LLM Gateway payload externalization exists and is tested.
- `[x]` `callLlmGateway` writes a complete gateway package.
- `[x]` `requestLlmGatewayChat` writes a complete gateway package.
- `[x]` Provider-status probe writes a complete gateway package.
- `[x]` Full qbo-visible gateway response bodies are preserved inline or by explicit payload reference.
- `[x]` Full request bodies are preserved inline or by explicit payload reference.
- `[x]` Gateway `x-request-id` is preserved.
- `[x]` Gateway metadata is preserved.
- `[x]` Gateway error envelope is preserved.
- `[x]` Non-200 error bodies are preserved beyond current truncated error messages.
- `[x]` Malformed JSON facts are preserved.
- `[x]` Network error facts are preserved.
- `[x]` Timeout facts are preserved.
- `[x]` Abort/cancel facts are preserved where applicable.
- `[x]` Provider calls do not wait for Mongo/file recording.
- `[x]` Recorder failures do not fail provider calls.
- `[x]` Existing provider return/callback behavior is unchanged.
- `[x]` Parser logic is unchanged.
- `[x]` Prompt text is unchanged.
- `[x]` Fallback behavior is unchanged.
- `[x]` UI is unchanged.
- `[x]` No code in `C:\Projects\llm-gateway` was changed for this qbo-side harness.
- `[x]` Targeted tests pass.
- `[x]` Full server tests pass.
- `[x]` Stop-and-review notes are written.

## Commit Checklist

- `[x]` Run `git status --short`.
- `[ ]` Confirm no client/UI files are staged.
- `[ ]` Confirm no prompt files are staged.
- `[ ]` Confirm no fallback/router files are staged.
- `[ ]` Confirm no unrelated provider files are staged.
- `[ ]` Confirm the dirty LM Studio artifact is not staged unless explicitly requested.
- `[ ]` Run `git diff --cached --check` after staging.
- `[ ]` Commit message names LLM Gateway provider harness work.
- `[ ]` Push only after tests and staged diff are reviewed.
