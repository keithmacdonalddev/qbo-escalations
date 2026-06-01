# LLM Gateway Provider Harness Stop And Review

Date: 2026-05-21

## Scope Completed

The LLM Gateway provider harness now has an end-to-end qbo-side preservation path for the current gateway provider surfaces in this repo:

- `server/src/services/image-parser.js` `callLlmGateway`
- `server/src/services/remote-api-providers.js` `requestLlmGatewayChat`
- `server/src/services/image-parser.js` `validateRemoteProvider('llm-gateway')`

This work stays inside the provider-package preservation boundary.

It does not change:

- prompt text
- parser validation
- model answer cleanup
- fallback routing
- provider selection
- UI behavior
- code inside `C:\Projects\llm-gateway`

The qbo-side harness preserves the package qbo receives from `llm-gateway`. It does not attempt to preserve the hidden upstream LM Studio package inside the gateway process.

## What Was Verified With Tests

- Strict `ProviderCallPackage.llmGateway` schema accepts valid gateway chat, image-parser, and provider-status packages.
- Strict gateway schema rejects unknown fields in harness-owned package sections.
- Gateway recorder builds provider-specific packages instead of generic HTTP-only packages.
- Gateway redaction covers outgoing auth-like headers and secret-like body fields.
- Gateway `x-request-id` is preserved and is not redacted.
- Gateway `parsedJson.gateway` metadata is preserved exactly.
- Gateway usage, cost, and optional credits are preserved when returned.
- Gateway error envelope fields are preserved when returned.
- Large gateway request/response fields externalize without silent truncation.
- Duplicate huge gateway request body text/body JSON is not stored twice.
- Duplicate huge gateway response body text/parsed JSON is not stored twice.
- Image-parser gateway calls record full qbo-visible request and response packages.
- Workspace/chat gateway calls record full qbo-visible request and response packages.
- Provider-status gateway calls record full qbo-visible request and response packages.
- Provider behavior does not wait for Mongo/file recording.
- Recorder failure does not fail provider behavior.
- Capture disabled path remains covered by existing recorder behavior.
- Existing LM Studio provider harness tests still pass after shared schema/recorder changes.

## Live Runtime Verification

Live runtime verification was performed against local LLM Gateway at `http://127.0.0.1:4100`, with LM Studio reachable at `http://127.0.0.1:1234`.

Gateway status reported model:

```text
google/gemma-4-e4b
```

Runtime marker:

```text
LIVE-LLM-GATEWAY-1779402182515
```

Mongo created one LLM Gateway provider package record for each live attempt:

- `6a0f85abce91242b6f175fa6` - `image-parser:validateRemoteProvider:llm-gateway`
- `6a0f85abce91242b6f175faf` - `remote-api-providers:requestLlmGatewayChat`
- `6a0f85b0ce91242b6f175fb4` - `image-parser:callLlmGateway`

Each live record had:

- `providerId: "llm-gateway"`
- `providerPathType: "gateway-http"`
- `outcome: "success"`
- `llmGateway` package present
- gateway `x-request-id` preserved
- response status `200`
- gateway metadata present
- no external payloads required for this small live run

Evidence artifact:

```text
provider-harness-research/provider-responses/llm-gateway/google-gemma-4-e4b/LIVE-LLM-GATEWAY-1779402182515.jsonc
```

The artifact contains the exact redacted `ProviderCallPackage` documents read back from Mongo for this run.

## Verification Commands

Passed:

```powershell
npm --prefix server test -- test/provider-call-package-llm-gateway-schema.test.js
```

Passed:

```powershell
npm --prefix server test -- test/provider-call-package-llm-gateway-recorder.test.js
```

Passed:

```powershell
npm --prefix server test -- test/remote-api-providers.test.js
```

Passed:

```powershell
npm --prefix server test -- test/image-parser.test.js
```

Passed:

```powershell
npm --prefix server test -- test/provider-call-package-redaction.test.js test/provider-call-package-payload-store.test.js test/provider-call-package-recorder.test.js
```

Passed:

```powershell
npm --prefix server test -- test/provider-call-package-lm-studio-schema.test.js test/provider-call-package-lm-studio-recorder.test.js
```

Passed:

```powershell
npm --prefix server test -- test/lm-studio.test.js
```

Passed:

```powershell
npm --prefix server test
```

Passed with only Windows line-ending warnings:

```powershell
git diff --check
```

## Remaining Notes

- A live non-200 gateway failure was not forced during runtime verification. Automated tests cover non-200 gateway body preservation and gateway error-envelope preservation.
- A live provider-status failure was not forced. Existing tests cover gateway provider-status success and existing provider-status mapping tests cover failed status responses.
- The live gateway response had gateway metadata present.
- The live small-payload run stored request/response data inline; no external payload references were needed.
- No unrelated baseline tests failed.
- The pre-existing modified LM Studio evidence artifact remains dirty in the worktree and was not edited by this implementation.

## Explicit Boundary Confirmation

- `[x]` Mongo preserved the qbo-visible gateway package.
- `[x]` The qbo-side harness did not attempt to preserve the hidden upstream LM Studio package inside `C:\Projects\llm-gateway`.
- `[x]` No parser-quality decision was added.
- `[x]` No prompt change was added.
- `[x]` No fallback change was added.
- `[x]` No UI change was added.
