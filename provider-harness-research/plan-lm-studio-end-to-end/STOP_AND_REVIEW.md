# LM Studio Provider Harness Stop And Review

Date: 2026-05-21

## Scope Completed

The LM Studio provider harness now has an end-to-end preservation path for the current LM Studio provider surfaces in this repo:

- `server/src/services/lm-studio.js` `parseEscalation`
- `server/src/services/lm-studio.js` `transcribeImage`
- `server/src/services/lm-studio.js` streaming `chat`
- `server/src/services/image-parser.js` `callLmStudio`

This work stays inside the provider-package preservation boundary. It does not change prompt text, parser validation, fallback routing, or UI behavior.

## What Was Verified With Tests

- Strict `ProviderCallPackage.lmStudio` schema accepts valid LM Studio non-stream and stream packages.
- Strict LM Studio schema rejects unknown fields in the harness-owned package sections.
- LM Studio recorder builds provider-specific packages instead of generic HTTP packages.
- LM Studio redaction covers outgoing auth-like headers and secret-like body fields.
- Large LM Studio request/response/stream fields externalize without silent truncation.
- Non-stream LM Studio service calls record full request and response packages.
- Streaming LM Studio chat records raw chunks, SSE frames, parsed chunks, `[DONE]`, malformed frame parse errors, stream terminators, and full derived response text.
- Image-parser LM Studio calls record the LM Studio-specific package shape.
- Provider behavior does not wait for Mongo/file recording.
- Recorder failure does not fail provider behavior.
- Capture disabled path creates no provider-package records.

## Live Runtime Verification

Live runtime verification was performed against local LM Studio at `http://127.0.0.1:1234` using model `google/gemma-4-e4b`.

Runtime marker:

`LIVE-LM-STUDIO-1779347870542`

Mongo created one LM Studio provider package record for each live attempt:

- `6a0eb1a87822addd86532fb3` - `lm-studio:parseEscalation`
- `6a0eb1b27822addd86532fb6` - `lm-studio:transcribeImage`
- `6a0eb1bf7822addd86532fb9` - `image-parser:callLmStudio`
- `6a0eb1c37822addd86532fbc` - `lm-studio:chat`

Evidence artifact:

`provider-harness-research/provider-responses/lm-studio/google-gemma-4-e4b/LIVE-LM-STUDIO-1779347870542.jsonc`

The artifact contains the exact `ProviderCallPackage` documents read back from Mongo for this run.

## Verification Commands

Passed:

```powershell
npm --prefix server test -- test/lm-studio.test.js test/image-parser.test.js test/provider-call-package-recorder.test.js test/provider-call-package-redaction.test.js test/provider-call-package-payload-store.test.js test/provider-call-package-lm-studio-recorder.test.js test/provider-call-package-lm-studio-schema.test.js
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

- A live non-200 LM Studio failure was not forced during runtime verification. Automated tests cover full non-200 body preservation for LM Studio stream and non-stream paths.
- The live model output quality was intentionally not judged as part of this work. This harness only proves the provider package is preserved.
- Commit and push remain separate operator steps.
