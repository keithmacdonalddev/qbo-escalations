# Escalation Image Parser Agent Review

**Date:** 2026-05-30
**Agent reviewed:** `escalation-template-parser` / Escalation Image Parser
**Reviewed against:** `agent-profiles-overhaul/01-overview-page-review.md` and the repo rule that profile data must be real, traceable, or honestly empty.

## Bottom Line

The Escalation Image Parser is shaped correctly as a narrow agent: one screenshot template in, one canonical text template out. The current prompt, validation layer, and chat-v5 client path mostly protect that boundary.

It is **not yet safe to describe the whole agent as fully deterministic, fully proven, or fully remembered by the app**. The biggest gaps are not in the prompt. They are in production provenance, provider determinism, and how much parse-validation metadata survives after the parser hands off to the rest of the workflow.

Plain-English note: this report uses "canonical template" to mean "the exact QBO escalation format the app expects." In the product UI, this should be written as "expected format" or "required format," not "canonical."

## What I Reviewed

- Prompt: `prompts/agents/escalation-template-parser.md`
- Parser service: `server/src/services/image-parser.js`
- Anthropic SDK adapter: `server/src/services/sdk-image-parse.js`
- Parser HTTP route and history persistence: `server/src/routes/image-parser.js`
- Parser result models: `server/src/models/ImageParseResult.js`, `server/src/models/ImageParserTestResult.js`
- Pipeline test route: `server/src/routes/pipeline-tests.js`
- Chat-v5 parser orchestration: `client/src/components/chat-v5/useStageOrchestrator.js`
- Case-intake handoff: `server/src/services/chat-request-service.js`, `server/src/lib/case-intake.js`, `server/src/routes/chat/send.js`
- Current profile-overview source-of-truth notes: `agent-profiles-overhaul/01-overview-page-review.md`

## Current Agent Shape

The active prompt is short and appropriately strict. `prompts/agents/escalation-template-parser.md` starts with `PROMPT_VERSION: P24`, asks the model to copy screenshot values, and requires exactly these labels:

```text
COID/MID:
CASE:
CLIENT/CONTACT:
CX IS ATTEMPTING TO:
EXPECTED OUTCOME:
ACTUAL OUTCOME:
KB/TOOLS USED:
TRIED TEST ACCOUNT:
TS STEPS:
```

That matches the desired boundary. The prompt does not ask the agent to remember state, detect duplicates, create knowledge, or decide workflow outcomes.

The runtime also resolves the prompt from the prompt store at parse time: `parseImage()` calls `getRenderedAgentPrompt(promptId)` in `server/src/services/image-parser.js:2592-2597`. That means the live prompt file, not the old embedded prompt constant, is the active parser instruction.

## Findings

### 1. High - Production parse history does not store the validation record

Normal `/api/image-parser/parse` responses include `parseFields` and `parseMeta`, but the production history record saved to `ImageParseResult` does not persist those fields. The route saves provider/model/tokens/status/role/parsed text/provider trace in `server/src/routes/image-parser.js:252-274`, while the model schema only has result fields like `status`, `role`, `parsedText`, and `providerTrace` in `server/src/models/ImageParseResult.js`.

The test-result model is better: `ImageParserTestResult` stores `canonicalPassed`, `semanticPassed`, `parserIssues`, `canonicalIssues`, `fieldsFound`, `parseFields`, and `parseMeta`.

Practical impact:

- Parser history can show that a parse happened, but not the canonical pass/fail state as a first-class field.
- The agent profile cannot truthfully compute production accuracy or validation trends from normal parse history.
- A later audit has to reconstruct validation from `parsedText`, and that may not match the exact validation state returned at run time.

Recommended fix:

Add `parseFields`, `parseMeta`, `canonicalPassed`, `semanticPassed`, `parserIssues`, `canonicalIssues`, and `fieldsFound` to `ImageParseResult`, then persist them from `/api/image-parser/parse`. Keep `parsedText` as the human-readable output, but make validation metadata queryable.

Implementation update:

Added the production history fields to `ImageParseResult`, persisted the validation record from `/api/image-parser/parse`, and added a route test that proves `parseFields`, `parseMeta`, pass/fail flags, issue lists, and `fieldsFound` are stored on the history row.

### 2. High - Determinism is a prompt goal, not a runtime guarantee across providers

The document goal is deterministic parser behavior. The current runtime does not enforce that consistently:

- LM Studio sends `temperature: 0.1` in `server/src/services/image-parser.js:1277-1283`.
- LLM Gateway sends `temperature: 0.1` in `server/src/services/image-parser.js:2678-2682`.
- Kimi sends `temperature: 1` in `server/src/services/image-parser.js:1641-1647`; the test suite explicitly guards this because Kimi rejects the lower value.
- Gemini sends `generationConfig` with `maxOutputTokens` and `responseMimeType`, but no explicit temperature in `server/src/services/image-parser.js:1568-1590`.
- The Anthropic SDK path returns answer text and relies on downstream validation; it does not enforce a structured output schema in `server/src/services/sdk-image-parse.js:96-249`.

This does not mean the parser is unusable. It means "deterministic" is currently enforced by prompt discipline plus post-validation, not by generation settings or schema constraints for every provider.

Practical impact:

- The profile should not claim deterministic behavior without qualifying the provider/model path.
- Kimi can be a supported provider, but it should be labeled as not suitable for deterministic baseline testing unless another control exists.
- Provider comparisons need to separate "accepted by route" from "eligible as deterministic parser baseline."

Recommended fix:

Add a provider capability field for parser determinism. Pin deterministic settings where the provider supports them. For providers that cannot be pinned, mark them as "experimental / validation-gated" in the profile and exclude them from deterministic pass-rate claims. Where possible, use schema/tool/JSON output for the parser and render that back to the canonical text template.

Implementation update:

Added a shared image-parser reliability helper and surfaced the note in three operator-facing places: the parser Overview, Runtime Settings, and Test Results provider breakdown. The visible UI now says plain things like "Consistency," "Checked after AI reply," "Reliability note," and "Review recent pass/fail results" instead of exposing implementation terms.

### 3. Medium - The chat-v5 handoff drops parser metadata before `/api/chat`

The chat-v5 client calls `/api/image-parser/parse` and receives `text`, `parseFields`, `parseMeta`, provider trace, provider/model, and elapsed time in `client/src/components/chat-v5/useStageOrchestrator.js:159-250`.

But when it sends the next request to `/api/chat`, it forwards only the text plus provider/model/elapsed fields: `parsedEscalationText`, `parsedEscalationSource`, `parsedEscalationProvider`, `parsedEscalationModel`, and `parsedEscalationElapsedMs` in `client/src/components/chat-v5/useStageOrchestrator.js:707-710` and the payload block immediately below it.

The server then reparses and revalidates the text in `buildParserDerivedTriageContext()` (`server/src/services/chat-request-service.js:932-1029`) and builds case intake from that derived context in `server/src/lib/case-intake.js:205-270`.

Practical impact:

- The downstream `caseIntake` record preserves a useful rederived validation result, but not the original `/api/image-parser/parse` `parseMeta` object exactly as returned.
- Provider trace/package id and original parse route validation metadata are not cleanly connected to the case-intake record.
- If the parse route ever changes its validation rules, future audits may not know which validation result was used at the parser boundary.

Recommended fix:

Forward `parseFields`, `parseMeta`, `promptId`, and `providerTrace.providerPackageId` from the client to `/api/chat`, or better, have `/api/image-parser/parse` create a durable intake/parse record and pass its id into `/api/chat`. The server can still revalidate defensively, but the original parser result should remain attached.

### 4. Medium - Normal parse persistence is fire-and-forget, so provenance is best-effort

`persistParseResult()` intentionally returns early if Mongo is unavailable and catches save/archive errors without failing the parse response in `server/src/routes/image-parser.js:61-92`. The parse route calls it without `await` after building a successful response in `server/src/routes/image-parser.js:252-274`.

That is pragmatic for user experience, but it weakens the "app should remember" promise.

Practical impact:

- The user may get a successful parse while the history record or source-image archive fails in the background.
- JSON-mode callers do not get a durable parse id or save-status signal.
- Profile history and event-stream panels can be incomplete without the parser response warning the operator.

Recommended fix:

For normal production parses, return a `parseResultId` and `persistenceStatus`. If source-image archiving is required for canonical intake reliability, await the metadata save and surface a warning when the image archive fails. If the product intentionally wants "parse succeeds even when history fails," label that as degraded provenance.

### 5. Medium - The old embedded `SYSTEM_PROMPT` is stale and conflicts with the current single-template boundary

`server/src/services/image-parser.js:917-986` still defines an old dual-role `SYSTEM_PROMPT` for escalation-template parsing and INV-list parsing. Current `parseImage()` does not use it; it loads the prompt store instead at `server/src/services/image-parser.js:2592-2597`.

Practical impact:

- A future reviewer or test may read the exported constant and think the live parser still has two roles.
- It conflicts with the desired product boundary: this parser profile is supposed to be one screenshot template to one text template.
- It increases the chance of prompt drift between dead constants, prompt files, tests, and profile UI.

Recommended fix:

Delete the exported `SYSTEM_PROMPT` if no current code needs it. If tests still need a fixture prompt, rename it to `LEGACY_DUAL_ROLE_SYSTEM_PROMPT_FOR_TESTS` and add a comment that it is not the live parser prompt.

### 6. Low - The current profile test runner is useful but not yet a reproducible parser benchmark

The profile test path stores rich results in `ImageParserTestResult`, which is good. But the runner selects an image fixture randomly: `chooseRandomFixture()` and `chooseImageParserFixture()` in `server/src/routes/pipeline-tests.js`.

Practical impact:

- A single profile "Run test" result is useful operational evidence, but it is not a stable benchmark unless the selected fixture is recorded and replayable.
- Random fixture selection makes pass-rate investigation noisier when comparing prompt/provider changes.

Recommended fix:

Add a fixture picker and a "run all fixtures" mode. Keep random smoke tests if useful, but make deterministic provider/prompt comparisons run against a named fixture set.

## Strengths To Preserve

- The active prompt is narrow and clear.
- `parseImage()` resolves the prompt file dynamically through the prompt store.
- The canonical template validator checks exact field order and extra text in `server/src/lib/escalation-template-contract.js`.
- `buildStructuredParseResult()` combines semantic validation with canonical-template validation before setting `parseMeta.passed` in `server/src/services/image-parser.js:1845-1897`.
- Chat-v5 refuses to use invalid parser output for the staged parser flow: `summarizeImageParserValidationFailure()` causes the client to stop before downstream stages in `client/src/components/chat-v5/useStageOrchestrator.js:230-240`.
- Test results already store the richer validation metadata that production history should also store.
- The profile overview now uses a real pipeline topology source instead of the old fabricated `AGENT_OPERATION_META` workflow split.

## Profile Truthfulness Implications

The profile can truthfully show:

- Enabled/disabled state from the agent identity record.
- Provider/model runtime defaults.
- Current provider reachability.
- Prompt text and prompt history.
- Test-result pass/fail stats from `ImageParserTestResult`.
- Event stream and chat-session history where records exist.

The profile should not yet claim:

- Production parser accuracy over normal parse history.
- Deterministic behavior across all selectable providers.
- Complete provenance for every successful parse.
- A guaranteed source-image receipt for every successful parse.

## Suggested Next Work

1. Persist parser validation metadata on `ImageParseResult`.
2. Pass original parse metadata into `/api/chat` or pass a durable parse-result id.
3. Add deterministic-capability labels for parser providers.
4. Remove or quarantine the stale `SYSTEM_PROMPT`.
5. Add fixed fixture selection and "run all fixtures" to the profile test path.

## Verification

Focused parser contract tests passed:

```powershell
npm --prefix server test -- test/image-parser.test.js test/image-parser-routes.test.js test/image-parser-sdk-adapter.test.js test/parse-validation.test.js test/escalation-template-contract.test.js
```

Result: `5 test files passed`.

No app server, client dev server, gateway, or MongoDB process was started or restarted for this review.
