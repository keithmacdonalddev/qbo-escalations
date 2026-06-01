# Implementation Plan — Triage Agent Harness Rebuild

**Date:** 2026-06-01
**Slug:** `triage-agent-harness-rebuild`
**Status:** **FINAL (v2)** — incorporates the 2026-06-01 plan review (`./2026-06-01-triage-agent-harness-rebuild-plan-review.md`) and the "less strict, still structured" design refinement. Pairs with `/cto-review`.
**Supersedes:** `.claude/plans/triage-test-route.md` — that plan assumed "package IDs flow through naturally" for triage; false today (triage captures no provider package).
**Provenance:** Built from tool-verified, read-only traces this session of the current triage path + the image-parser reference architecture (see `TODOS/2026-06-01-image-parser-hardening-review.md`). All `file:line` anchors are reference points verified at trace time — re-confirm before editing.

> **What changed v1 → v2 (this final version):** (1) softened the strictness posture — triage is now explicitly *less strict* than the parser (§3); (2) reworked the failure model so content problems never hard-fail and the operator always gets a card (§5); (3) added the review's two Blockers — explicit direct-provider dispatch contract (§6) and known-issue-search decoupling/preservation (§7, §12); (4) corrected the false "triage-tests injects a fake providerPackageId" claim; (5) froze the event-name list, enumerated `TriageResult` fields, scoped a CLI-free provider option set, and tightened profile-honesty wording to `operation.*`; (6) recorded the deliberate scope pushbacks (§16).

---

## 1. Problem statement

Triage works but is **not a harness** like the image parser. Today it runs *inline inside* `POST /api/chat` (`chat-request-service.js:668-816`) on the shared chat engine (`chat-orchestrator.js`). Consequences (all verified):

- **No forensic capture** — its provider call produces no `ProviderCallPackage`; a run can't be reconstructed (the live path can't even produce a `providerPackageId`).
- **Thin observability** — only 2 domain events (`triage.context_built`, `triage.decision`) vs the parser's ~26.
- **Weak data quality** — presence-only check; a junk severity silently becomes **P3**, an unknown category silently becomes **"technical"** (no honest flag).
- **No per-request reachability pre-flight.**
- **Fabricated profile data** — `AGENT_OPERATION_META['triage-agent']` (invented owner "Olivia Chen", "Medium" risk, "Human-reviewed", 6 fake workflows) still renders in the Config/Workflows/Harness tabs.
- **Coupled to the chat request** rather than an independent, testable unit.

**Who / cost:** escalation specialists rely on the triage card as their fast first-pass read. When the model or provider misbehaves there is no captured artifact, no honest signal the card was degraded, and no guard against a confidently-wrong severity.

## 2. Goals / non-goals

**Goal:** Rebuild triage as its **own independent harness** that mirrors the image-parser's *plumbing* end to end — receive escalation-template **text** → run independently → provider handoff with forced capture → provider's raw response saved to a `ProviderCallPackage` in Mongo → harness **reads the package back from Mongo** → builds + (softly) validates the structured triage card → surfaces it in the client over SSE — while being **less strict than the parser** about content (see §3).

**Non-goals (explicit):**
- The triage card is **not** wired into the analyst/main answer (operator-facing signal only). Verified: only the parser's fields feed the analyst prompt; the card is used post-hoc for formatting repair.
- **Not** building Claude-CLI provider-call-package capture (only needed to keep the Claude Max subscription path — see Deferred).
- **Not** changing the image-parser harness (reuse only).
- **Not** taking ownership of the known-issue/INV search — that is a separate agent (§7).

## 3. Strictness posture (the governing principle)

The image parser is a **gatekeeper**: if the answer isn't byte-perfect it rejects it (hard 422). Triage is a **fast triage nurse**: it always gives the operator a read, and it tells them how confident it is. **Same solid plumbing, softer judgment.**

- **Encourage structure, don't enforce it rigidly.** Keep the labeled-field contract; normalize loose phrasing ("Sev: high", "P2 - urgent") into the clean fields. Do **not** force the model to emit strict JSON (unreliable on local models; unnecessary because *our harness* is the enforcer on readback).
- **Reliable data = honesty about quality, not rejection.** When a field is missing, out-of-range, or low-confidence, **flag it** on the card/`triageMeta` — never silently invent a value, never silently coerce to P3/"technical", and never hard-fail the run over content.
- **Always return a usable card.** Content problems → best-effort card (model or deterministic fallback), clearly flagged. Hard errors are reserved for the narrow unrecoverable cases (§5).
- **"Loud failure" means visible, not blocking.** Failures are surfaced honestly in the event log + `triageMeta` (source, failure stage, validation issues) while the operator still receives a card.

The reliability/observability machinery (capture → Mongo → readback, rich events, pre-flight, persistence, honest fallback) is **kept in full** — that is what makes triage trustworthy and debuggable; it is independent of how strict the content validation is.

## 4. Locked decisions

- **Transport = direct-provider-API (Option 1).** Reuse the parser's `provider-handoff` + `forceCapture` + Mongo-readback. The user's **local AI server / LM Studio counts as direct-API**, so a no-key/no-cost path remains; only the Claude Max *subscription* (CLI) path is dropped for triage. Reversible via deferred Option 2.
- **Standalone, client-invoked** `/api/triage`, replacing the inline `/api/chat` triage path.
- **Operator-facing signal only.**
- **D1 — Resilience: single-shot + per-request pre-flight + honest surfaced degradation.** No automatic failover to a second provider (parser doesn't either). Pre-flight short-circuits a doomed call to the fallback card; failures are flagged, not hard-blocked (§5).
- **D2 — Fallback card: keep-but-honest.** Retain the deterministic rule-based card, but only as an **explicitly-flagged fallback** carrying the real failure reason + stage. Never presented as a genuine model triage.
- **D3 — Persistence: add a `TriageResult` Mongo model** with triage-specific fields (§9), alongside the existing `TriageTestResult`.
- **Provider options:** triage gets a **CLI-free direct-API option set** (no Codex/Claude CLI), and its Runtime Defaults UI is **single-shot** (no fallback-mode toggle), consistent with D1.

## 5. Failure model (content vs. infrastructure)

The endpoint returns **HTTP 200 with a card whenever a card can be produced.** Two clearly separated paths:

**A. Content imperfection (model answered, but loose/partial/out-of-range):**
- Normalize what is reasonable; flag what isn't in `triageMeta.validation.issues`; `validation.passed=false` when issues exist.
- Severity tracked as `{ raw, validated, displayed }` so we can always see what the model said vs. what we show.
- **Result:** 200, `source:'agent'`, card always present. Never a 422 on content.

**B. No usable model answer (provider error / capture failure / readback timeout / pre-flight unreachable):**
- Produce the **deterministic fallback card** from the parsed fields (no model needed); `source:'fallback'`, `fallback.reason` + `failureStage` set; emit an `error` stage-event for observability; persist a degraded `TriageResult` row.
- Pre-flight unreachable **short-circuits** to this fallback before any provider-handoff event.
- **Result:** 200 with a flagged fallback card.

**C. Truly unrecoverable (no input text, or Mongo entirely unavailable so neither readback nor a meaningful run is possible):**
- HTTP 4xx/5xx with a `code`; SSE emits `stage_event{kind:'error'}` + the terminal frame carries `{ ok:false, code, error }` plus any computable `fallbackCard`. **This is the only non-200 path**, and the client is written to still render a `fallbackCard` if present (avoids the "fallback hidden behind a thrown non-2xx" trap the review flagged).

Hard infra codes still exist internally for diagnostics/logging (`PROVIDER_PACKAGE_LOAD_TIMEOUT`, `..._MONGO_UNAVAILABLE`, `..._CAPTURE_FAILED`, `PROVIDER_ERROR`, reachability) and are recorded in `triageMeta.failureStage` / the error event even when the HTTP response is a 200 fallback.

## 6. Reference architecture to mirror (verified) + the explicit dispatch contract

Mirror these parser mechanics (adapting strictness per §3/§5):

- **Direct-provider dispatch (review Blocker 1 — make this explicit).** The harness MUST call a **provider-specific direct-call path** (e.g. a `runDirectTriageProviderCall()` that dispatches to the same per-provider harness functions the parser uses — `sendLmStudioChatCompletion`, the Anthropic/OpenAI/Gemini/Kimi harnesses) passing `captureContext:{ forceCapture:true, callSite:'triage', operation:'triage' }`. It **must never** call `startChatOrchestration` — that path preserves no `providerPackageId` (verified: `chat-orchestrator.js` `onDone` payloads at `:558-569`, `:601-613` carry no provider trace). This is the crux of the whole rebuild.
- **Forced capture (write):** handoff returns `providerTrace` with `providerPackageId` + a non-enumerable `packageCapturePromise` (`provider-handoff.js:17-25`); `requireProviderPackageCapture` (`:204-260`) awaits it; `confirmProviderPackageReadable` (`:87-151`) polls `ProviderCallPackage.exists` 5×50ms → `PROVIDER_PACKAGE_CAPTURE_FAILED`. **Await-then-confirm on the HTTP path** (state this per-transport per review-history drift).
- **Readback (`waitForProviderPackage`, `image-parser.js:2327-2410`):** require `providerPackageId` + `readyState===1`; ceiling default **30s**; poll `findById().lean()`; backoff `min(25+attempt·10, 250)ms`; emit retry/loaded/failed events; throw `PROVIDER_PACKAGE_LOAD_TIMEOUT` on ceiling → routes to fallback (§5B), not a hard fail.
- **Build from package:** the model's answer is a STRING inside the captured **response envelope** (`parsedJson.choices[0].message.content` etc., `image-parser.js:2487-2628`). Read `response.parsedJson` → `bodyText` → `*PayloadRef`. Parse the labeled fields from that string; normalize + softly validate.
- **Route/SSE shape (`routes/image-parser.js:147-399`):** SSE on `Accept: text/event-stream` or `?stream`; bus `createStageEventBus({ stageId:'triage', runId })`; frames `event:<name>\ndata:<json>\n\n`; single terminal `triage_complete` frame; client consumes via `consumeSSEStream` treating the terminal frame as sole completion and `stage_event{kind:'error'}` as the failure signal (`useImageParser.js:49-95`).
- **Models:** `ProviderCallPackage` TTL via `expiresAt` (default 30d) + store-health check (`checkProviderPackageStoreHealth`, `image-parser.js:428-511`). `TriageTestResult` already has an unused `providerPackageId` (`:57`).

## 7. Known-issue / INV search — separate agent, must be preserved (review Blocker 2)

The known-issue search is **not** triage's job. It is a separate agent — `known-issue-search-agent` (`server/src/services/known-issue-search-agent.js:8`, runner `runKnownIssueSearchAgent` `:354`) — that runs **in parallel** with triage (`Promise.all([knownIssuePromise, triagePromise])`, `chat-request-service.js:1207`) and shares only inputs (`parserText` + `parseFields`), not triage's output. The analyst answer consumes `knownIssueSearchResult` (`:1724-1728`); the triage card text does **not** feed the analyst. The **only** triage→INV link is a *fallback-only* hint: `triageCard.category` is passed to `runInvMatching` (`:1735`, applied `:1363`) and only when the known-issue agent didn't return a result.

**Required when triage moves to its own harness (verify at the P3 gate):**
1. Keep launching `runKnownIssueSearchAgent` in parallel (its `/api/chat` lifecycle is unchanged).
2. Keep the analyst leg consuming `knownIssueSearchResult` + `knownIssueSearchToInvMatchResult`.
3. Preserve the fallback `category` hand-off into `runInvMatching` — pass the parser's category (or recomputed) at that call site — **or** explicitly accept its loss (degrades only the no-agent-result fallback branch).
4. `/api/chat` must still return the analyst answer + known-issue result **even if `/api/triage` fails or is skipped** — triage and the analyst leg fire independently.

## 8. Target data flow (end-to-end)

1. Parser runs (client, existing) → canonical escalation-template **text**.
2. Client calls `POST /api/triage` with `{ text, provider, model, reasoningEffort?, serviceTier?, timeoutMs?, stream }`, `Accept: text/event-stream`. Independently, the client's `/api/chat` call proceeds for the analyst answer (which triggers the known-issue search) — triage does **not** gate it.
3. Route opens SSE, creates the `triage` bus, calls `runTriage(text, opts, { eventBus })`.
4. Harness: per-request pre-flight (specific provider/model) → resolve prompt (`getRenderedAgentPrompt('triage-agent')`) → build prompt input → emit `triage.context_built` → `runDirectTriageProviderCall(... forceCapture:true)`.
5. Provider responds; package written to Mongo; `providerTrace.providerPackageId` returned; capture confirmed.
6. Harness reads the package back from Mongo, emitting retry/loaded events.
7. Harness extracts the labeled text, parses the 7 fields, normalizes, softly validates (flags issues; `severity{raw,validated,displayed}`), builds the card + `triageMeta`.
8. Failure routing per §5 (content → flagged best-effort card; no-usable-answer / pre-flight-unreachable → flagged deterministic fallback; unrecoverable → hard error + any fallback card).
9. Persist a `TriageResult` doc (success / degraded / error).
10. Emit terminal `triage_complete`; client renders the card + full event log.

## 9. Files to create / modify

**Create (7)**
- `server/src/services/triage.js` — the harness (incl. `runDirectTriageProviderCall`, build + soft-validate).
- `server/src/routes/triage.js` — standalone SSE route.
- `server/src/models/TriageResult.js` — per-run persistence. Fields: `status` (`success|degraded|error`), `severity` (`{raw,validated,displayed}`), `category`, `rawOutput`, `card`, `validationIssues[]`, `fallbackUsed`, `fallbackReason`, `failureStage`, `errorCode`, `providerPackageId`, `provider`, `model`, `latencyMs`, `promptVersion`, `expiresAt` (TTL via `TRIAGE_RESULT_TTL_DAYS`, default 30d).
- `client/src/hooks/useTriage.js` — client invocation + SSE consume (mirror `useImageParser.js`); fired independently of the analyst `/api/chat` call.
- `server/test/triage-harness.test.js` — capture/readback/build + fallback paths.
- `server/test/triage-routes.test.js` — SSE framing + failure model (200-with-card vs hard error).
- `server/test/triage-validation.test.js` — normalize/flag, severity raw/validated/displayed, payroll rule, pre-flight.

**Modify (14)**
- `server/src/app.js` — mount `/api/triage`.
- `server/src/services/providers/provider-handoff.js` — add triage `callSite`/`operation` constants; (stretch) extract a shared readback helper.
- `server/src/lib/chat-triage.js` — reuse the labeled-output parser + deterministic fallback; add the **soft** rubric validator (`{raw,validated,displayed}`, issues), pinned to the payroll/pay-date rule.
- `server/src/services/chat-request-service.js` — **P7**: retire inline triage (`runTriageAgentCompletion`); **preserve** the known-issue parallel launch, analyst consumption, and the `runInvMatching` category fallback (§7). Note: the live label-parser `parseLabeledTriageOutput` lives here (`:550-587`) — relocate/share with the harness.
- `server/src/routes/chat/send.js` — **P7**: remove inline `triageEventBus` flush + `applyStageEventsToCaseIntake('triage', …)`; ensure analyst answer + known-issue result still return without triage.
- `server/src/models/TriageTestResult.js` — populate `providerPackageId` (currently unused).
- `server/src/routes/triage-tests.js` — repoint to the new harness **at ~P3 as a proving ground**. *(Correction from v1: this route does NOT inject a fake `providerPackageId`; it reads `triageMeta?.providerPackageId` at `:239`/`:569`, which is empty today — the fake id lives only in a test stub.)*
- `client/src/components/chat-v5/useStageOrchestrator.js` — invoke standalone `/api/triage` after the parser; preserve skip gating; independent of the analyst call.
- `client/src/components/chat-v5/ChatV5Container.jsx` — consume SSE + render the card / run-test action; render `fallbackCard` from a hard-error frame if present.
- `client/src/api/chatApi.js` (or new `triageApi.js`) — the triage call.
- `client/src/components/chat-v5/StageEventLogPanel.jsx` — map the **frozen** `triage.*` event vocabulary (§ AC9).
- `client/src/components/AgentsView.jsx` — remove all `operation.*` (AGENT_OPERATION_META-derived) reads in the triage Config/Workflows/Harness tabs; real data or honest empty state.
- `client/src/lib/agentRuntimeSettings.js` — define `TRIAGE_PROVIDER_OPTIONS` (CLI-free direct-API set; excludes Codex/Claude CLI); flip triage runtime UI to single-shot (drop fallback-mode toggle), keeping the single-source-of-truth picker.
- `server/.env.example` — add `TRIAGE_RESULT_TTL_DAYS` (and any triage readback-wait env if introduced).

**Touch with care**
- `prompts/agents/triage-agent.md` — add a `PROMPT_VERSION` header (none today); optionally a gentle "structure your answer with these labels" nudge — but no JSON mandate.

## 10. Phased implementation (each phase ends in a STOP-AND-REVIEW gate)

Every phase: (a) **strict file allowlist**; (b) explicit exclusion of pre-existing dirty WIP from the phase review; (c) mandatory **worker verification block** (`git status`, `git diff --stat`, per-change ± lines, post-edit greps, test outcome); (d) lead re-reads modified files before the gate closes.

- **P1 — Harness service + dispatch contract** (`triage.js`, reuse `provider-handoff.js`, `chat-triage.js`). `runDirectTriageProviderCall` with `forceCapture` (never `startChatOrchestration`) → Mongo readback → build + soft-validate card. **Gate:** capture write + readback proven against a stubbed package; an assertion that the path does not touch `startChatOrchestration`.
- **P2 — Standalone route + failure model** (`routes/triage.js`, `app.js`). SSE + event bus + terminal frame + the §5 failure model (200-with-card vs the single hard-error path) + the response/SSE body shapes. **Gate:** content-imperfection → 200+flagged card; provider/readback failure → 200+fallback card; unrecoverable → hard error carrying `fallbackCard`.
- **P3 — Client cutover + known-issue preservation** (`useTriage.js`, `useStageOrchestrator.js`, `ChatV5Container.jsx`, `chatApi.js`; repoint `triage-tests.js`). Invoke standalone triage after the parser, independent of the analyst call; preserve skip gating and the §7 known-issue wires. **Gate:** a real flow renders the card from `/api/triage`, AND `/api/chat` still returns analyst answer + known-issue result when triage fails.
- **P4 — Soft validation depth + pre-flight** (`chat-triage.js`, `triage.js`). Normalize→flag, `severity{raw,validated,displayed}`, payroll/pay-date guardrail, provider/model-specific pre-flight. **Gate:** rubric-flag + pre-flight tests pass; no silent coercion.
- **P5 — Profile honesty + persistence + provider options** (`AgentsView.jsx`, `agentRuntimeSettings.js`, `TriageResult.js`, `TriageTestResult.js`, `triage-agent.md`, `.env.example`). **Gate:** grep shows no `operation.*` reads in triage Config/Workflows/Harness paths; runs persist; single-shot CLI-free picker. (Independent — parallelizable.)
- **P6 — Tests** (the three new files). **Gate:** wired failure outcomes, readback retry, normalize/flag, payroll rule, pre-flight, SSE framing — added and runnable (run as a separate explicit step).
- **P7 — Retire inline triage** (`chat-request-service.js`, `chat/send.js`). Remove the old path once standalone is proven AND §7 is verified intact. **Candidate to defer** if the cutover risk is high at gate time.

## 11. Acceptance criteria (yes/no testable — the cto-review plan-fidelity gate)

1. The harness calls a provider-specific direct-call path with `captureContext.forceCapture=true` and **never** calls `startChatOrchestration` (grep + a test asserting the dispatch path).
2. On success, `POST /api/triage` returns HTTP 200 `{ ok:true, card, triageMeta, elapsedMs }` with all 7 card fields; `triageMeta.source==='agent'`.
3. Every successful run writes a `ProviderCallPackage` to Mongo and `triageMeta.providerPackageId` equals an existing package doc's `_id`.
4. The card is built from the **read-back package**: a test where the in-memory provider return is emptied but the package exists still yields the card.
5. **Content imperfection never hard-fails:** a model answer with an out-of-range severity/category or a missing field returns HTTP 200 with a card, `triageMeta.validation.passed===false`, the issue recorded in `validation.issues`, and `severity.raw` preserved alongside `severity.validated`/`displayed` — no silent coercion to P3/"technical".
6. **No-usable-answer routes to a flagged fallback at 200:** provider error / capture failure / readback timeout / pre-flight-unreachable returns HTTP 200 with a deterministic fallback card, `triageMeta.source==='fallback'`, `fallback.reason` + `failureStage` set, and an `error` stage-event emitted.
7. **Pre-flight** checks the specific selected provider/model (not the broad cached availability sweep) and, when unreachable, short-circuits to the fallback **before** any provider-handoff stage-event.
8. The **only** non-200 response is the unrecoverable case (e.g. missing input text); that response carries a `code`, an SSE `stage_event{kind:'error'}`, and any computable `fallbackCard` in the terminal frame; the client renders that `fallbackCard`.
9. A payroll/direct-deposit input with no pay date does not produce Severity P2 (it produces P3 + a missing-info request for the pay date) — verified by a test.
10. SSE: `stage_event` frames + **exactly one** terminal `triage_complete` frame on both success and failure.
11. A triage run emits these **frozen, named** `triage.*` event kinds (≥12): `triage.server_request_received`, `triage.prompt_resolved`, `triage.context_built`, `triage.provider_selected`, `triage.preflight_checked`, `triage.generation_started`, `triage.agent_handoff_to_provider`, `triage.provider_package_load_retry`, `triage.provider_package_loaded` (or `..._load_failed`), `triage.fields_extracted`, `triage.output_validated`, `triage.response_sent`, plus `error`.
12. The harness resolves its prompt via `getRenderedAgentPrompt('triage-agent')` (no embedded constant), and `prompts/agents/triage-agent.md` carries a `PROMPT_VERSION` header.
13. No value rendered in the triage profile's Configuration, Workflows, or Harness tabs is sourced from `AGENT_OPERATION_META`; a grep of `AgentsView.jsx` shows no `operation.*` reads in those triage paths; each former field shows real data or an explicit empty state.
14. The chat-v5 pipeline invokes the standalone `/api/triage` endpoint (not the inline `/api/chat` triage path) and renders the card; the non-escalation / inv-list skip behavior is preserved.
15. `/api/chat` still returns the analyst answer **and** the known-issue search result when `/api/triage` errors or is skipped (triage and the analyst leg are independent); the `known-issue-search-agent` still runs in parallel and the `runInvMatching` category-fallback hint is preserved (or its loss explicitly accepted in code comments).
16. A `TriageResult` doc is persisted per run with `status`, `severity{raw,validated,displayed}`, `category`, `validationIssues`, `fallbackUsed`/`fallbackReason`, `errorCode`/`failureStage`, `providerPackageId`, `provider`, `model`, `latencyMs`; degraded/error rows persisted; TTL via `TRIAGE_RESULT_TTL_DAYS`.
17. Triage's Runtime Defaults picker offers a CLI-free direct-API option set (`TRIAGE_PROVIDER_OPTIONS`, no Codex/Claude CLI) and is single-shot (no fallback-mode toggle).

## 12. Risks & edge cases (with handling)

1. **Breaking the known-issue search on P7 (review Blocker 2).** *Handling:* §7's four preservation requirements + AC15; P7 gate explicitly verifies analyst answer + known-issue result survive triage failure.
2. **Pipeline timing change.** Triage moves from server-side-parallel to a client call after the parser. *Handling:* fire it independently of the analyst call; preserve `shouldRunTriage` gates; AC14.
3. **Over-strict validation.** *Handling (§3/§5):* tolerant normalizer vs. soft validator; flags never hard-fail content; `severity{raw,validated,displayed}`.
4. **Fallback card hidden behind a non-2xx (review High 5).** *Handling:* content/recoverable failures stay 200-with-card; the single hard-error path still carries `fallbackCard` and the client renders it (AC8).
5. **Readback stall.** *Handling:* bounded 30s poll → routes to fallback (§5B), not a hang; clear event.
6. **Loss of failover.** *Handling (D1):* pre-flight + honest fallback; both surfaced.
7. **Dirty working tree.** *Handling:* per-phase allowlist + pass the pre-existing-modified list to every verifier.
8. **Stale-closure after refresh (recurring past bug).** *Handling:* read the returned payload directly, not React state after an `await`.
9. **On-disk payload growth.** Triage now also writes `ProviderCallPackage` docs, so the (deferred) externalized-payload orphan problem grows faster once TTLs fire. *Handling:* acknowledge; the cleanup job remains deferred but its priority rises.

## 13. Adopted from the plan review (traceability)

- **Blocker 1** → §6 explicit dispatch contract + AC1.
- **Blocker 2** → §7 + AC15.
- **High 1** → §4 CLI-free `TRIAGE_PROVIDER_OPTIONS`, single-shot + AC17.
- **High 2 (partial)** → §3 canonical internal object + keep `rawOutput`; **no** provider JSON mandate.
- **High 3 (partial)** → §5/§9 `severity{raw,validated,displayed}`; guardrail pinned to the payroll rule only (AC9).
- **High 4/High 5** → §5 failure model + AC5/6/8.
- **High 6** → triage-tests correction (§9) + repoint at P3.
- **Med 1** → shared readback helper kept as stretch (deliberate, §16).
- **Med 2** → provider/model-specific pre-flight (AC7).
- **Med 3** → frozen event names (AC11).
- **Med 4** → enumerated `TriageResult` fields + error rows + TTL (AC16).
- **Med 5** → profile honesty tightened to `operation.*` (AC13).

## 14. Review-history blind spots to pre-empt (from `temp-reviews/`)

- **Recorder await policy stated per transport** — triage's HTTP capture uses the parser's await-then-confirm contract (§6).
- **`undefined`/missing-key defaults** — build status/label maps from the authoritative list, default unknowns.
- **Reachability at every layer** — pre-flight catches "provider configured but unresponsive," not just "zero agents."
- **Wired failure-path tests** — every failure outcome gets an end-to-end test, not just a unit test.
- **No out-of-scope edits** — strict allowlists; exclude dirty WIP.

## 15. Exceeds bar (concrete)

- A shared, transport-agnostic readback helper used by both parser and triage.
- A fallback card that names the exact failure stage + provider diagnostic, not a generic "fallback used".
- Per-stage timing + reasoning-token chips in the triage event log at parser parity.
- A `/api/triage/status` endpoint exposing provider availability + the package-store health check.

## 16. Deliberate scope pushbacks (decided, not omissions)

- **No "force the model to emit JSON" rule.** Big-provider APIs do schema-constrained output reliably; small local models do not, and it would jeopardize the locked no-key local path. Our harness enforces structure on readback instead (§3). The reviewer agrees as a fallback.
- **Guardrails pinned to the payroll/pay-date rule only** — not an open-ended rules engine.
- **Shared readback helper stays a stretch goal** — a triage-only thin extraction is fine in P1; a full parser migration mid-effort is out of scope (churn risk on a working parser).

## 17. Dependencies & sequencing

- P1 → P2 → P3 strictly ordered. P4 depends on P1's shape; can land before/after P3. P5 is independent (parallelizable). P7 last, only after P3 + §7 verified; deferrable.
- No new library dependencies; reuses `provider-handoff`, `stage-events`, `event-stats`, prompt store, Mongo models.

## 18. Testing strategy

- **Automated (`node:test` + `supertest` + `mongodb-memory-server`):** capture+readback, the §5 failure model (200-with-card vs single hard-error), readback retry, normalize/flag + `severity{raw,validated,displayed}`, payroll rule, provider-specific pre-flight, SSE framing, and AC15 (analyst/known-issue survive triage failure). Run as a separate explicit step.
- **Manual / agent-browser:** after P3/P5, screenshot the chat-v5 triage widget + the triage profile tabs at a real viewport (card renders, event log populated, no fabricated governance data). Save to `review-screenshots/`.
- **Production confidence:** a real run writes both a `ProviderCallPackage` and a `TriageResult`, and `triageMeta.providerPackageId` resolves to a real doc.

## 19. Deferred items `[deferred]`

- `[deferred]` **Option 2 — Claude Max (CLI) path for triage** (greenfield Claude-CLI capture; `claude.js` has zero capture refs; codex CLI template carries the close-timing hole).
- `[deferred]` **Wiring the triage card into the analyst's answer** (Option B; out of scope by decision A).
- `[deferred]` **On-disk externalized-payload cleanup job** (pre-existing gap; priority rises now that triage also writes packages — §12.9).
- `[deferred]` **P7 (retire inline triage)** may split into a follow-up if the P3 gate judges cutover risk too high to also remove the old path this iteration.

## 20. Open assumptions (confirm at first gate)

- Triage's standalone input is the parser's canonical template **text** (already client-side after the parser) — not the raw user message. Verified true today.
- Provider/model continues to come solely from the Runtime Defaults picker, now a CLI-free direct-API option set.
- The existing `shouldRunTriage` gating (skip on non-escalation / inv-list / empty text) is preserved in the new client invocation.
