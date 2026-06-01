# Provider Harness Status And Task Reminders

Last checked: 2026-06-01
Repo: `C:\Projects\qbo-escalations`

This is a working review and task reminder for the server provider harnesses. It corrects the earlier count by separating **OpenAI CLI / Codex CLI** from **OpenAI API**.

## Scope

This review covers provider harness behavior in:

- `server/src/services/providers/*-provider-harness.js`
- `server/src/services/codex.js`
- `server/src/services/claude.js`
- `server/src/services/image-parser.js`
- `server/src/services/remote-api-providers.js`
- `server/src/services/provider-call-package-recorder.js`
- `server/src/models/ProviderCallPackage.js`

The practical standard used here:

- The provider is wired into the server path that uses it.
- The call stores a `ProviderCallPackage` with enough request, response, timing, and error facts to prove what happened.
- Required image-parser handoff paths wait for capture and Mongo readback before extracting parser output.
- Tests cover success, HTTP error, invalid JSON, timeout or network failure, and capture failure where applicable.

## Corrected Count

There are **8 provider harness targets** in the current server provider surface:

1. OpenAI CLI / Codex CLI
2. OpenAI API
3. Anthropic API
4. LM Studio
5. LLM Gateway
6. Gemini API
7. Kimi API
8. Claude CLI

Current status:

- **4 fully implemented / strongest:** OpenAI CLI, OpenAI API, Anthropic API, LM Studio.
- **3 implemented but need hardening:** LLM Gateway, Gemini API, Kimi API.
- **1 still needs real provider-package harness implementation:** Claude CLI.

## Harness Ranking

| Rank | Harness | Current status | Why |
| --- | --- | --- | --- |
| 1 | OpenAI CLI / Codex CLI | Strong / fully implemented | CLI package capture exists in `server/src/services/codex.js`, covers chat, parse, transcribe, aborts, timeouts, spawn errors, malformed JSONL, and recorder failures. `image-parser:callCodex` force-captures and the parse path waits for required package capture before reading package content. |
| 2 | OpenAI API | Strong / fully implemented | Direct HTTP harness in `openai-api-provider-harness.js`; success, HTTP errors, invalid JSON, network errors, timeouts, capture failure, and readback failure are covered. |
| 3 | Anthropic API | Strong / fully implemented | Direct HTTP harness in `anthropic-provider-harness.js`; success and failure paths wait for required package capture before handoff. |
| 4 | LM Studio | Strong / fully implemented | Dedicated LM Studio package shape, strict schema tests, non-stream and stream recorder coverage, and image-parser required-capture behavior. |
| 5 | LLM Gateway | Implemented, needs hardening | Dedicated gateway package shape and good image-parser/provider-status coverage. Weakness: direct harness catch path rethrows no-response failures without awaiting required package capture first. Also still prints colored happy-path console logs. |
| 6 | Gemini API | Implemented, needs hardening | Dedicated Gemini API package shape and image-parser/provider-status coverage. Weakness: direct harness catch path rethrows no-response failures without awaiting required package capture first. |
| 7 | Kimi API | Implemented, currently weakest | Harness mechanics are present, but the current image-parser Kimi request body does not include `temperature: 1`, while tests require it. This makes the Kimi integration not fully trustworthy until fixed. |
| 8 | Claude CLI | Not fully implemented | Runtime exists in `server/src/services/claude.js`, but there is no comparable `ProviderCallPackage` harness capture for Claude chat, parse, transcribe, prompt, or warm-up subprocess paths. |

## Findings

### 1. OpenAI CLI and OpenAI API are separate harnesses

Do not combine them in future counts.

- OpenAI CLI / Codex CLI lives mainly in `server/src/services/codex.js`.
- OpenAI API lives in `server/src/services/providers/openai-api-provider-harness.js`.
- They have different transports, failure modes, package shapes, and test surfaces.

### 2. Claude CLI is the main missing implementation

`server/src/services/claude.js` spawns `claude` for chat, parse, prompt, and transcribe paths, but it does not have the same provider-package capture harness as Codex CLI.

Task reminder:

- [ ] Add a Claude CLI package shape or reuse the existing CLI package shape with `providerId: claude`, `providerResearchId: anthropic-cli`, and `providerPathType: cli`.
- [ ] Capture subprocess args, stdin, stdout, stderr, parsed stream-json events, malformed lines, exit code, signal, timeout, killed state, and usage.
- [ ] Cover `chat`, `parseEscalation`, `transcribeImage`, and `prompt`.
- [ ] Be careful with `parseEscalation`; it has multi-step and fallback behavior.
- [ ] Add tests mirroring the Codex CLI package tests.

### 3. Kimi request shape is currently a blocker

`server/src/services/image-parser.js` builds the Kimi body without `temperature: 1`. The tests explicitly require it.

Evidence from current check:

- `callKimi` logs `temperature: body.temperature`, but the body does not set `temperature`.
- `server/test/image-parser.test.js` asserts Kimi must send `temperature: 1`.
- Focused test command failed:

```powershell
node --test --test-name-pattern "kimi|temperature" server/test/image-parser.test.js
```

Observed result:

- 5 passed
- 1 failed
- failing test: `parseImage routes to kimi and returns parsed result`
- failure: `Kimi request must include temperature: 1`, actual value was `undefined`

Task reminder:

- [ ] Add `temperature: 1` to the Kimi image-parser request body.
- [ ] Re-run the Kimi request-shape tests.
- [ ] Re-run the broader `server/test/image-parser.test.js` after the fix.

### 4. LLM Gateway direct harness needs no-response capture hardening

The harness queues package capture in `sendJsonRequest`, but `sendLlmGatewayChatCompletion` catches request-level failures and immediately rethrows with the attached provider trace.

Task reminder:

- [ ] In the catch path, if `err.providerTrace?.captureEnabled`, await `requireProviderPackageCapture(...)` before rethrowing.
- [ ] Add direct harness tests for network error and timeout that assert `packageCaptureStatus: saved`.
- [ ] Remove or gate unconditional colored `console.log` happy-path output from `llm-gateway-provider-harness.js`.

### 5. Gemini direct harness needs no-response capture hardening

Same class of issue as LLM Gateway: the catch path rethrows request-level failures without first waiting for required capture.

Task reminder:

- [ ] In the catch path, if `err.providerTrace?.captureEnabled`, await `requireProviderPackageCapture(...)` before rethrowing.
- [ ] Add direct harness tests for network error and timeout that assert `packageCaptureStatus: saved`.

### 6. OpenAI, Anthropic, and LM Studio are the model implementations to copy

Use these as the implementation pattern:

- OpenAI API waits for package capture on request-level errors, HTTP errors, invalid JSON, and success.
- Anthropic API uses a helper wrapper around `requireProviderPackageCapture`.
- LM Studio has dedicated package shape and strict schema coverage.

Task reminder:

- [ ] When hardening LLM Gateway and Gemini, copy the OpenAI/Anthropic catch-path pattern rather than creating a new pattern.
- [ ] Keep provider events consistent: request started, response headers, response received, package capture queued, package ready, package capture failed.

### 7. Generic HTTP package shape is still weaker than provider-specific shapes

OpenAI API, Anthropic API, and Kimi API currently use the generic HTTP package recorder. LLM Gateway, Gemini, and LM Studio have stronger provider-specific package shapes.

Task reminder:

- [ ] Consider adding provider-specific strict package schemas for OpenAI API, Anthropic API, and Kimi API.
- [ ] At minimum, ensure the generic HTTP shape captures and redacts enough provider-specific information for request-body debugging.

## Current Verification

Fresh focused verification run:

```powershell
node --test server/test/provider-call-package-cli.test.js server/test/anthropic-provider-harness.test.js server/test/image-parser-openai-provider-harness.test.js server/test/kimi-provider-harness.test.js server/test/provider-call-package-gemini-api-recorder.test.js server/test/provider-call-package-llm-gateway-recorder.test.js server/test/provider-call-package-llm-gateway-schema.test.js server/test/provider-call-package-lm-studio-recorder.test.js server/test/provider-call-package-lm-studio-schema.test.js server/test/remote-api-providers.test.js
```

Result:

- 79 tests passed
- 0 tests failed

Fresh Kimi request-shape check:

```powershell
node --test --test-name-pattern "kimi|temperature" server/test/image-parser.test.js
```

Result:

- 5 tests passed
- 1 test failed
- failure is the missing `temperature: 1` Kimi request field

## Next Work Order

1. Fix Kimi `temperature: 1` in `callKimi`.
2. Re-run `node --test --test-name-pattern "kimi|temperature" server/test/image-parser.test.js`.
3. Re-run full `node --test server/test/image-parser.test.js`.
4. Harden LLM Gateway required-capture catch path.
5. Harden Gemini required-capture catch path.
6. Remove or gate LLM Gateway happy-path console logs.
7. Implement Claude CLI provider-package harness.
8. Consider strict provider-specific schemas for OpenAI API, Anthropic API, and Kimi API.

## Commit Caution

The working tree contains many unrelated modified and untracked files. Before committing provider-harness work, isolate only the intended harness files, tests, and this review document.
