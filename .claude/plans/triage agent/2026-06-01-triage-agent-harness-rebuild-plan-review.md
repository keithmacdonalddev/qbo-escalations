# Plan Review - Triage Agent Harness Rebuild

**Reviewed plan:** `.claude/plans/triage-agent-harness-rebuild.md`
**Review date:** 2026-06-01
**Review stance:** strict implementation-readiness review

## Bottom line

The plan is directionally right and high value. Rebuilding triage as a real provider-package-backed harness is the right move if the goal is forensic debugging, honest fallback behavior, and provider parity with the image parser.

I would not treat the current draft as implementation-ready yet. It needs a few contract fixes before work starts, mostly around how the new triage service actually invokes direct providers, how live chat continues after parser output, and how validation/fallback responses are represented.

## What the plan gets right

1. **The core problem is real.** Current triage is embedded in `POST /api/chat` through `buildAgentBackedTriageContext()` and `runTriageAgentCompletion()` in `server/src/services/chat-request-service.js`. It uses `startChatOrchestration()`, not the parser's package readback flow.

2. **The parser reference architecture is the right model.** The image parser already proves the durable pattern: force provider-package capture, await capture confirmation, read the package back from Mongo, extract the model response from the package, validate, persist, and stream stage events.

3. **The profile-honesty concern is valid.** `AGENT_OPERATION_META['triage-agent']` still contains invented owner/risk/workflow values, and `buildOperationalProfile()` still turns those static values into rendered operation fields.

4. **P7 being last is correct.** Removing the inline triage path before the standalone route and client cutover are proven would be risky.

5. **The dirty-worktree guard is necessary.** The repo currently has a large amount of modified and untracked WIP, so strict per-phase file allowlists are not optional.

## Findings

### Blocker 1 - The direct-provider invocation contract is underspecified

The plan says triage should use "provider-handoff + forceCapture + Mongo-readback", but the repo does not have a generic provider handoff call that can be dropped into the current chat path. `server/src/services/providers/provider-handoff.js` is a helper module for capture promises and confirmation. The parser gets package-backed output by calling provider-specific harness functions directly, such as `sendLmStudioChatCompletion()`, `sendAnthropicMessages()`, `sendOpenAiChatCompletion()`, `sendGeminiGenerateContent()`, `sendKimiChatCompletion()`, and `sendLlmGatewayChatCompletion()`.

The current chat orchestration path is the wrong base for the new harness:

- `chat-orchestrator.js` calls `provider.chat(...)` and returns `fullResponse`, `usage`, and attempts, but it does not preserve `providerTrace` or `providerPackageId`.
- `providers/chat-provider.js` validates only the chat callback contract and does not expose package capture as a first-class contract.
- `remote-api-providers.js` has its own chat capture contexts, but `createBufferedChatProvider()` does not accept or forward a caller-supplied `captureContext`, and capture is gated by `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE`, not `forceCapture`.

Required plan fix:

- Add an explicit P1 contract for `runDirectTriageProviderCall()` or equivalent inside `server/src/services/triage.js`.
- It must dispatch by provider to the provider-specific harness functions, not to `startChatOrchestration()` or the registry chat adapter.
- It must pass `captureContext.forceCapture = true`, `operation: 'triage'`, `callSite: 'triage:...'`, `agent: 'triage-agent'`, and `modelRequested`.
- Add an acceptance criterion that the new service does not call `startChatOrchestration()` and that every supported direct provider returns a `providerTrace.providerPackageId` before triage attempts to parse the response.

### Blocker 2 - Live chat sequencing and INV decoupling need a clearer contract

Today `buildAgentBackedTriageContext()` does two jobs: it runs model-backed triage and it also runs the known-issue search pass. It then returns `knownIssueSearchResult` alongside the triage card. The chat-v5 flow currently parses the image, then sends `parsedEscalationText` to `/api/chat`; the server handles INV search, triage, and then the main analyst flow.

If P7 removes the inline triage code too broadly, it could accidentally break INV search or the data the analyst still needs. Also, because the plan says the triage card remains operator-facing and is not consumed by the analyst, the new `/api/triage` call should not block the main answer.

Required plan fix:

- Split "known issue search from parsed escalation" from "triage card generation" before deleting the old inline triage.
- Define the post-parser client schedule explicitly:
  - parser completes;
  - client fires `/api/triage` for the operator-facing card;
  - client fires `/api/chat` with `parsedEscalationText` for INV + main answer;
  - `/api/chat` no longer creates the triage card, but still preserves INV search and analyst context.
- Add an acceptance criterion that the main analyst request can start and complete even if `/api/triage` fails, because the analyst does not consume the triage card by design.

### High 1 - Runtime provider options conflict with the "direct API only" decision

The plan says triage should use direct-provider API transport and should drop the Claude Max subscription path. That is correct, but the current client runtime definitions make triage a chat-style runtime with fallback support:

- `client/src/lib/agentRuntimeSettings.js` defines `triage-agent` with `supportsModes: true` and `supportedModes: ['single', 'fallback']`.
- The image-parser option set is not safe to reuse as-is because `IMAGE_PARSER_PROVIDER_OPTIONS` includes Codex-family CLI options from the provider catalog.

Required plan fix:

- Create an explicit direct-text-provider option set for triage, for example `TRIAGE_PROVIDER_OPTIONS`.
- Exclude CLI transports unless this plan explicitly implements package capture for that CLI. For this draft, exclude Claude CLI and Codex CLI.
- Make the intended direct-provider list explicit: Local LM Studio, LLM Gateway, Anthropic API, OpenAI API, Gemini API, and Kimi API are the natural supported targets for this rebuild.
- Set triage to single-shot direct-provider behavior in the runtime UI. If a new runtime kind is introduced, update every helper that currently treats only `kind === 'image-parser'` as direct-provider transport.

### High 2 - The harness should prefer a canonical structured output, not only labeled prose

The current plan keeps the seven labeled fields as the model output contract. That matches the visible triage card, but it is weaker than what a harness should validate internally. Parsing labeled prose is workable, but it gives the harness more chances to misread formatting drift and makes field-level validation less clean.

The user-facing card can still render the same labels:

- `Category`
- `Severity`
- `Fast read`
- `Immediate next step`
- `Missing info`
- `Confidence`
- `Category check`

But the provider response should preferably be normalized into a strict internal object first, for example:

```json
{
  "category": "payroll",
  "severity": "P3",
  "fastRead": "...",
  "immediateNextStep": "...",
  "missingInfo": ["..."],
  "confidence": "Medium",
  "categoryCheck": "..."
}
```

Required plan fix:

- Add a canonical triage result schema to the harness contract.
- Treat the seven-label display card as a rendering of the canonical object, not as the only source of truth.
- Preserve the raw provider text/object in `triageMeta.rawOutput` so reviewers can compare the raw model output to the normalized card.
- If the provider cannot be forced to emit JSON reliably, keep the labeled parser as a compatibility layer but validate against the canonical object after parsing.

### High 3 - Deterministic severity should be a guardrail, not only a fallback

The plan correctly says out-of-rubric severity should not be silently coerced. It should go one step further: deterministic triage rules should act as guardrails around the model's severity, especially for cases where the prompt already defines hard policy.

Example: payroll/direct-deposit cases should not visually land as a clean `P2` simply because the model says `P2` when the pay date/deadline is missing. The harness should preserve the model's raw severity for audit, then either downgrade/normalize the displayed severity according to deterministic policy or show a prominent validation warning that the model severity is not accepted.

Required plan fix:

- Split `rawSeverity`, `validatedSeverity`, and displayed `severity` in `triageMeta` or the canonical schema.
- Add deterministic severity guardrails for the known hard rules, starting with payroll/direct deposit without a pay date.
- Decide whether guardrail violations become a corrected display severity, a warning-only display, or a hard validation failure. Do not leave this to implementation judgment.
- Add tests where the model returns `P2` for a payroll/direct-deposit case with no pay date and the harness refuses to present that as an unqualified `P2`.

### High 4 - Validation behavior and HTTP behavior currently conflict

The plan says invalid severity/category should be flagged rather than silently coerced. That is right. But the acceptance criteria also say malformed/invalid model output maps to HTTP 422, while another criterion says out-of-rubric severity/category should return a card with `triageMeta.validationPassed=false`.

Those are different cases and need separate contracts:

- **Shape failure:** the model did not produce the required seven labeled fields. This can be a hard failure or explicit rule fallback.
- **Rubric violation:** the model produced the seven fields, but severity/category/confidence violates the rubric. This should usually return the card with `validationPassed=false`, validation issues, and no silent coercion.
- **Provider/capture/readback failure:** the model response is unavailable. If a fallback card is attached, the client must render it as fallback, not model triage.

Required plan fix:

- Define which failures return `ok:false` and which return `ok:true` with validation issues.
- Do not use one generic "invalid model output -> 422" rule for both shape failures and rubric violations.
- Preserve raw model values in `triageMeta.rawFields` when validation fails so reviewers can see exactly what the provider returned.

### High 5 - Fallback card semantics need to be explicit for non-stream and SSE clients

D2 says to keep an honest deterministic fallback card, but the route plan also maps provider/capture/readback failures to non-2xx HTTP codes. Many client helpers throw on non-2xx or `ok:false`, so a fallback card in the body may never render unless `useTriage` handles it deliberately.

Required plan fix:

- Define the exact response contract for failures:
  - non-stream failure body shape;
  - SSE `triage_complete` failure body shape;
  - where `fallbackCard` lives;
  - how the client marks stage status when a fallback card exists.
- Add an acceptance criterion that a provider failure renders a visible fallback card with `source: 'rule-fallback'`, `triageMeta.usedRuleFallback=true`, and the real failure code/reason.

### High 6 - `/api/triage-tests` should move earlier, not wait for P7

The current test route already exists at `server/src/routes/triage-tests.js`, and `TriageTestResult` already has `providerPackageId`. The route persists `providerPackageId` from `context.triageMeta.providerPackageId`, but the current chat-backed triage context does not populate it.

The plan says the existing test route "currently injects a fake `providerPackageId`." The live route does not appear to do that; the fake package id is in the route test stub. The real issue is that the route still calls `runTriageAgent()` from `chat-request-service.js`.

Required plan fix:

- Repoint `/api/triage-tests/run` to the new harness immediately after `server/src/services/triage.js` and `server/src/routes/triage.js` are stable.
- Treat this as a proving ground before live chat-v5 cutover.
- Move `triage-tests.js` out of P7 and into an earlier phase, probably after P2.

### Medium 1 - Shared provider-package readback should be core scope, not stretch

The parser's `waitForProviderPackage()` is currently private to `server/src/services/image-parser.js`. The plan marks a shared readback helper as stretch, but this is the most important duplicated behavior in the new harness.

Recommendation:

- Make `server/src/services/provider-package-readback.js` or similar part of P1.
- Move the parser readback logic there first, or extract a compatible helper used by triage only with a follow-up parser migration if churn risk is too high.
- Add tests around missing package id, Mongo unavailable, timeout, payload ref loading, and provider mismatch.

### Medium 2 - Pre-flight reachability needs a provider-specific definition

The plan says "per-request pre-flight", but the obvious existing helper, `checkProviderAvailability()`, is a broad cached provider-availability sweep used by image-parser status and agent health. Running a broad sweep before every triage request may add latency and may not be strict enough for a selected provider/model pair.

Recommendation:

- Define `checkTriageProviderReachability(provider, model, opts)` or an equivalent provider-specific check.
- Include package-store health in `/api/triage/status`, but do not confuse "package store writable" with "selected model reachable".
- Use explicit reachability codes such as `TRIAGE_PROVIDER_UNREACHABLE`, `TRIAGE_PROVIDER_NOT_SUPPORTED`, `TRIAGE_PROVIDER_KEY_MISSING`, and `TRIAGE_PACKAGE_STORE_UNAVAILABLE`.

### Medium 3 - Event naming needs an exact contract

The plan asks for at least 12 `triage.*` events but mixes generic names with existing conventions. The current stage bus sends a single `event: stage_event` frame whose payload has `stageId` and `kind`.

Recommendation:

- Freeze exact event kinds before implementation. Suggested minimum:
  - `triage.server_request_received`
  - `triage.provider_preflight_started`
  - `triage.provider_preflight_passed`
  - `triage.prompt_resolved`
  - `triage.context_built`
  - `triage.provider_selected`
  - `triage.agent_handoff_to_provider`
  - `triage.provider_trace_received`
  - `triage.provider_package_retrieval_started`
  - `triage.provider_package_load_retry`
  - `triage.provider_package_loaded`
  - `triage.provider_payload_selected`
  - `triage.fields_extracted`
  - `triage.output_validated`
  - `triage.result_persisted`
  - `triage.response_sent`
- Keep provider-level events as `provider.*` only if the event log clearly maps them under the triage run.

### Medium 4 - Persistence needs its own operational details

`TriageResult` should not simply mirror `ImageParseResult` without triage-specific fields. It needs to distinguish model success, rubric-invalid output, provider failure, and rule fallback.

Recommendation:

- Include at least: `status`, `provider`, `model`, `modelRequested`, `providerPackageId`, `latencyMs`, `severity`, `category`, `confidence`, `validationPassed`, `validationIssues`, `rawFields`, `cardSource`, `fallbackUsed`, `fallbackReason`, `errorCode`, `errorMsg`, and `expiresAt`.
- Add `TRIAGE_RESULT_TTL_DAYS` to `server/.env.example` if the model has TTL.
- Persist error rows even when no card exists.

### Medium 5 - Profile honesty is broader than one grep

The plan says to remove `AGENT_OPERATION_META['triage-agent']` reads from the Configuration/Workflows/Harness tabs. That is necessary, but the actual static values flow through `getAgentMeta()` and `buildOperationalProfile()`, then the tabs read `operation.department`, `operation.owner`, `operation.risk`, `operation.workflows`, `operation.harnessType`, and other fields.

Recommendation:

- For triage only, replace those fields with real identity/runtime/test-result/prompt data or explicit empty states.
- Do not rely only on grepping for `AGENT_OPERATION_META['triage-agent']`; the values may flow through `operation`.
- Add a targeted test or grep checklist for the rendered paths, not only the literal table access.

## Suggested revised phase order

1. **P0 - Contract cleanup before coding**
   - Freeze direct provider list.
   - Freeze canonical structured triage schema.
   - Freeze severity guardrail behavior.
   - Freeze response shapes for success, validation issue, fallback, and hard error.
   - Freeze event kind names.
   - Freeze client sequencing: `/api/triage` does not gate `/api/chat`.

2. **P1 - Shared readback + triage service**
   - Create `server/src/services/triage.js`.
   - Use provider-specific direct harness functions with `forceCapture:true`.
   - Read back from Mongo and build the card only from the package.
   - Add canonical structured output normalization, strict field parser compatibility, raw field retention, and basic validation.

3. **P2 - Standalone `/api/triage` route**
   - JSON and SSE modes.
   - Single `triage_complete` terminal frame.
   - Explicit error map.
   - Persist `TriageResult` success/error rows.

4. **P3 - Repoint `/api/triage-tests`**
   - Use the new triage service.
   - Persist real `providerPackageId`.
   - Keep `test_complete` if this remains a test-only terminal, but make the internal event vocabulary match the live route.

5. **P4 - Client live cutover**
   - Add `useTriage` or `triageApi`.
   - After parser completion, start `/api/triage` and `/api/chat` without making main answer depend on triage.
   - Preserve skip gates for non-escalation, INV-only cases, and empty parser text.

6. **P5 - Validation depth + pre-flight**
   - Provider/model-specific reachability pre-flight.
   - Rubric validation and deterministic severity guardrails.
   - Payroll pay-date rule.
   - Tests for shape failure vs rubric issue vs provider failure.

7. **P6 - Profile honesty + runtime options**
   - Direct-provider triage runtime options, no fallback UI unless implemented.
   - No CLI providers in triage's direct-only provider list.
   - Remove or empty fabricated triage profile fields.

8. **P7 - Retire inline triage only**
   - Remove triage card generation from `chat-request-service.js` and `chat/send.js`.
   - Preserve parser-derived fields, known issue search, and analyst flow.
   - Confirm no live client still expects `triage_card` from `/api/chat`.

## Acceptance criteria to add or revise

1. The new triage harness never calls `startChatOrchestration()` or a registry `provider.chat()` adapter.
2. Every successful model-backed triage run builds the visible card from the Mongo-read-back `ProviderCallPackage`, not from the in-memory provider return.
3. Direct-only triage provider options exclude Claude CLI and Codex CLI unless CLI package capture is implemented in this same plan.
4. The harness normalizes provider output into a canonical structured triage object before rendering the seven-label card.
5. The harness preserves raw provider output and raw model severity/category in `triageMeta` for review.
6. A model-returned severity that violates deterministic guardrails is not displayed as a clean accepted severity.
7. A rubric-invalid but shape-valid model response returns a card plus `triageMeta.validationPassed=false`; it is not silently coerced and is not automatically treated the same as a transport failure.
8. A provider/capture/readback failure can render a fallback card, but the UI must label it as deterministic fallback and show the real failure code.
9. `/api/chat` can still produce the main analyst answer when `/api/triage` fails.
10. `/api/chat` still runs or receives the known-issue search result after inline triage is removed.
11. `/api/triage-tests/run` produces a real `providerPackageId` when the selected provider succeeds.
12. The triage stage event log contains the frozen exact event kinds, not only a count of events.
13. Grep and UI verification prove no triage Configuration/Workflows/Harness value is sourced through `AGENT_OPERATION_META` or `operation.*` fields derived from that table.

## Overall recommendation

Proceed with the rebuild, but revise the plan first. The biggest implementation mistake to avoid is accidentally routing the new harness through the current chat orchestrator. The second biggest is treating triage as a prerequisite for the main analyst response even though the plan explicitly says the card is operator-facing only.

Once those contracts are tightened, this is a strong plan and should leave triage in a much more debuggable state than today's inline path.

## Verification performed

- Read `.claude/plans/triage-agent-harness-rebuild.md`.
- Checked current git status to account for existing dirty WIP.
- Verified current inline triage flow in `server/src/services/chat-request-service.js`.
- Verified current chat SSE triage bus wiring in `server/src/routes/chat/send.js`.
- Verified parser capture/readback behavior in `server/src/services/image-parser.js`, `server/src/services/providers/provider-handoff.js`, and `server/src/routes/image-parser.js`.
- Verified current triage test route and `TriageTestResult` behavior in `server/src/routes/triage-tests.js` and `server/src/models/TriageTestResult.js`.
- Verified client runtime and chat-v5 orchestration surfaces in `client/src/lib/agentRuntimeSettings.js`, `client/src/lib/imageParserCatalog.js`, `client/src/components/chat-v5/useStageOrchestrator.js`, and `client/src/components/chat-v5/ChatV5Container.jsx`.
- Verified profile metadata flow in `client/src/components/AgentsView.jsx`.

No tests were run; this was a read-only plan/code review plus this review artifact.
