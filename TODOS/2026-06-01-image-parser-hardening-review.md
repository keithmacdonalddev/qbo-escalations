# Image-Parser Agent Hardening — Full Review

**Date:** 2026-06-01
**Author:** Claude (PM/coordinator) + 4 delegated read-only investigators
**Purpose:** A faithful, tool-verified map of how deep the "escalation image provider agent" (image parser) hardening goes, in preparation for reviewing and hardening the **triage agent** next.
**Method:** Four parallel read-only investigators, one per layer (transport/harness; control surface; observability/testing; hardening history). Each was instructed to verify with tool calls and flag anything unconfirmed. Findings were cross-checked against each other; where a doc and the live code disagreed, the live-code reading wins.

> **Verification status:** All file:line citations below were produced by investigators reading current `master` in this session. They did **not** run the test suites or the app (read-only). Items I could not independently re-confirm are flagged inline. This document inherits the project rule: *if it wasn't verified with a tool call, it isn't stated as fact.*

---

## 1. Executive summary

The image-parser hardening is **genuinely deep** — not a thin wrapper. It ran as **three sequential campaigns** over ~two weeks and touched **at least nine distinct hardening dimensions**:

1. Prompt/contract alignment (collapse to one strict prompt; SDK contract alignment)
2. Structured-output enforcement (schema-enforced Anthropic path as default)
3. Removing silent-recovery masking (deleted the auto-corrector so failures stay visible)
4. Validation-recovery **surfacing** (make recovery/validation visible in the UI)
5. Provider call-package capture/readback (full request/response preserved, HTTP + CLI + streaming)
6. Handoff stability (per-provider harness modules + client handoff-status lib)
7. Reachability/health (concurrent batch-race availability probe + save-time recheck + background monitor)
8. Grading/observability (single-click Pass/Fail parity, ~30 stage events)
9. Dead-code/route hygiene

**The standout:** forensic provider-call-package capture + readback. Most apps treat provider calls as fire-and-forget "thin transport"; here every call is preserved to MongoDB and *re-read back* before text extraction, making failures debuggable after the fact.

**The honest gaps** (and the bar triage will be measured against): no per-request pre-flight reachability check; no retry/failover/recovery on the live parse path; fabricated "governance" data still rendering in non-Overview profile tabs; no client-side tests; the SSE framing and event-bus internals are untested.

**The reframe for triage:** triage already *shares* most of this infrastructure (it's keyed by stage ID, not per-agent), and on the two biggest resilience gaps (failover + circuit breaker + regex fallback via `parse-orchestrator.js`) the triage agent is actually **ahead** of the parser. So "harden triage to match the parser" is partly backwards — on resilience the parser should borrow from triage. Triage's real gaps are observability (thin event vocabulary), forensic capture, and the shared fake-governance-data / per-request-preflight problems.

---

## 2. Layer-by-layer depth map

| Station (what it does) | Depth | Evidence (one line) |
|---|---|---|
| Provider request construction + base64/image handling | **Solid** | Per-provider correct request shapes; magic-byte media detection; WebP/GIF→PNG conversion with graceful no-op |
| Timeout discipline | **Solid** | Explicit socket timeout + destroy on every HTTP path; route clamps to 120s + 10s buffer; nested 5s ceilings on health |
| Forensic capture (provider call packages) | **Solid (heavy)** | `ProviderCallPackage` in Mongo w/ redaction + TTL; parser re-reads it back before extraction (hard dependency); live-verified |
| Output validation | **Solid** | Canonical + field validation, structured `parseMeta`, persisted; silent auto-corrector deliberately deleted |
| Background health monitor | **Solid** | 60s interval; concurrent probes against 5s ceiling; per-agent isolation; sharpened diagnostics |
| Provider/model selection | **Solid** | Runtime Defaults picker is the single source of truth, verified end-to-end; no competing selector |
| Prompt versioning | **Solid** | Content-addressed immutable snapshots (8 on disk); auto-capture on edit/restart/file-change; restore endpoint; live file = active prompt |
| Server event stream | **Solid** | ~30 distinct events per run, structured/clamped/sequenced, delivered via SSE |
| Server-side test coverage | **Solid** | ~20+ test files: media detection, per-provider request contracts, error→HTTP mapping, capture-before-return, readback failure, timeouts, fallback |
| **Save-time reachability** | **Partial** | Exists but client-initiated, not enforced on the save route |
| **Standalone-run event persistence** | **Partial** | Live streaming works; only chat-pipeline runs persist the event array |
| **Profile honesty (non-Overview tabs)** | **Partial → thin** | Overview rebuilt honest; fabricated `AGENT_OPERATION_META` still renders in Profile Studio / Change-Review header / Workflows tab |
| **Per-request pre-flight reachability** | **Thin/absent** | `parseImage` has no pre-call reachability gate |
| **Retry / failover / recovery (live parse path)** | **Thin/absent** | Single attempt; no provider failover; no re-prompt; circuit breaker not wired here (only triage has it) |
| **Client-side tests + SSE framing tests** | **Thin/absent** | No front-end test framework; event-bus internals + `/parse` SSE framing untested |

---

## 3. Detailed findings

### 3.1 Backend transport / harness (Transport 2 — direct provider APIs)

- **Entrypoint:** `parseImage()` at `server/src/services/image-parser.js:2687`. Flow: normalize base64 → `assertModelAllowed` guard (`:2711`) → detect media type → single `switch (provider)` dispatch (`:2790`) → one `call<Provider>()` helper.
- **Per-provider request shapes** (all single-shot HTTPS POST via dedicated harness modules):
  - Anthropic `callAnthropic` `:1422` — `/v1/messages`; image `{type:'image', source:{type:'base64', media_type, data}}`; `max_tokens:4096`. SDK path `callAnthropicSdk` `:1516` is the default when `structured !== false`.
  - OpenAI `callOpenAI` `:1550` — `/v1/chat/completions`; `image_url:{url: dataUrl}`; reasoning vs non-reasoning handling via `applyOpenAiGenerationOptions` `:230`.
  - Gemini `callGemini` `:1644` — `:generateContent`; `inline_data:{mime_type, data}`; `maxOutputTokens:4096`.
  - Kimi `callKimi` `:1719` — Moonshot OpenAI-compatible; `thinking:{type:'disabled'}`.
  - LM Studio `callLmStudio` `:1289` — local `/v1/chat/completions`; `temperature:0.1`, `enable_thinking:false`.
  - LLM Gateway — inline in the switch `:2791`.
  - Codex `callCodex` `:1803` — CLI subprocess (streaming), not HTTP.
- **Base64/format:** `normalizeBase64` `:1181` strips data-URL prefix; `detectMediaTypeFromBase64` `:1221` sniffs magic numbers; `convertToPngIfNeeded` `:1245` converts WebP/GIF→PNG via `sharp` for LM Studio/llama.cpp (graceful no-op if `sharp` absent).
- **Timeouts:** `DEFAULT_TIMEOUT_MS = 120000` (`:102`); route clamps to 120s + 10s response-timeout buffer (`routes/image-parser.js:225-229`); Node `request({timeout})` with explicit `req.on('timeout')` destroy (e.g. `jsonRequest` `:1159`).
- **Retries / backoff / failover — NONE on the parse path.** `/parse` route (`routes/image-parser.js:241`) calls `parseImage` once. No retry loop, no backoff, no failover. The only retry-like loop is `waitForProviderPackage` `:2327` — a Mongo readback poll (incrementing delay up to a 30s ceiling), which is the capture indirection, not a provider retry.
- **Note (NOT used by the parser):** `parse-orchestrator.js` (`parseWithPolicy` `:210`) implements real fallback/parallel + circuit-breaker (`provider-health.js`) + regex fallback — but it's wired to **chat triage** only (`routes/chat/parse.js:247`, `chat-request-service.js:19`), never to the image-parser route.

### 3.2 Validation & recovery

- Provider text → `detectRole` `:1896` (escalation / inv-list / follow-up-chat / unknown).
- `buildStructuredParseResult` `:1941` → escalation path runs `validateCanonicalEscalationTemplateText` + `parseEscalationText` + `validateParsedEscalation`, producing `parseMeta` (`passed`, `score`, `confidence`, `issues`, `fieldsFound`, nested `canonicalTemplate` check). Severity via `buildServerTriageCard` `:1968`.
- "Recovery" is **observational/validation only** — no re-prompt, no re-call. Malformed JSON throws `PROVIDER_ERROR`; failed parses persist with `status:'error'/'timeout'` (`routes/image-parser.js:371`). Validation = solid; *recovery* is essentially absent (unlike triage's regex fallback).

### 3.3 Reachability / health (3 layers)

- **Save-time: PARTIAL / indirect.** `PATCH /:id/runtime` (`agent-identities.js:399`) persists runtime defaults but does not itself recheck; the recheck is client-driven via `POST /provider-strategy/health` + `GET .../health?forceRefresh` (`agentIdentitiesApi.js:33-42`).
- **Per-request pre-flight: ABSENT for image parse.** `parseImage` dispatches straight to the provider with no availability gate. **Real gap vs. the "pre-flight at every layer" goal.**
- **Background monitor: EXISTS.** `startAgentHealthMonitor` (`agent-health-service.js:1188`) runs `refreshAgentHealth({forceRefresh:true})` on an interval (default 60s, unref'd). Client polls every 60s (`useAgentHealth.js:8`).
- **Availability machinery (shared, robust):** `checkProviderAvailability` `:3296` (60s TTL cache + single in-flight dedupe) → `resolveProviderAvailability` `:3032` probes all providers **concurrently** with a hard 5s outer race (`PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS` `:3030`), tagging stragglers `OUTER_TIMEOUT`. Per-probe timeout is **3s** (`testRemoteProviderKey` `timeout:3_000` `:769`). Escalating heartbeat/readiness/canary probes (`runProviderReadinessProbe` `:464`, `runStrategyCanaryProbe` `:579`) exist but target the **chat** provider strategy, not the image parser.

### 3.4 Provider / model selection (single source of truth — CONFIRMED)

- Catalog chain: `shared/ai-provider-catalog.json` → `providerCatalog.js` (frozen) → `imageParserCatalog.js` → `agentRuntimeSettings.js` (per-agent localStorage, keyed by `storagePrefix`).
- The parser agent is `escalation-template-parser` (`agentRuntimeSettings.js:50`, `kind:'image-parser'`). Selection persisted under `qbo-escalation-template-parser-{provider,model,reasoning-effort,service-tier}`.
- **Runtime Defaults picker = `RuntimeSettingsPanel`** (`AgentsView.jsx:4615`), rendered in Configuration. `handleSaveRuntime` writes localStorage **and** server `AgentIdentity.runtime` (`PATCH /:id/runtime`), then dispatches `agent-runtime-defaults-applied` + a health recheck.
- **Production read-back chain (verified):** chat-v5 reads `readImageParserProfileRuntime()` (`pipelineRuntime.js:190`) → `listAgentRuntimeDefaults(['escalation-template-parser'])` → server returns `AgentIdentity.runtime` only when `runtime.configured === true` (identity-service:855), else falls back to localStorage. That provider/model is sent in the `/api/image-parser/parse` body.
- **No competing selector.** The `/parse` route trusts the request body and validates against `VALID_IMAGE_PARSER_PROVIDERS` (`routes/image-parser.js:207`); it does NOT read agent runtime itself. The AppHeader provider menu operates only on `aiSettings.providerStrategy` (chat) — zero "parser" references found.
- **Minor duplication (not a competing selector):** two definitions map to `image-parser` kind — `escalation-template-parser` (`:50`) and a legacy `image-parser`/`image-analyst` (`:124`); both read the same catalog.

### 3.5 Agent profile & management (control surface)

- All profile UI in one file: `client/src/components/AgentsView.jsx` (~4,400 lines). The parser shows 12 tabs.
- **Overview tab fully rebuilt** (`.agent-overview-v2`, `AgentOverviewTab` + `AgentOverviewTab.css`). Every field traces to a real source or honest empty state: name/purpose/enabled (real DB fields, `AgentIdentity.js:111`); health pill from live `selectedHealth` (`AgentsView.jsx:1297-1299`); model/provider from `getAgentRuntimeEffectiveModel`/`...ProviderLabel`; tools from `agent.tools.available` (parser = `[]` → honest "None"); pipeline diagram from real `PIPELINE_TOPOLOGY` (`pipelineRuntime.js:40-82`); recent results from `GET /api/pipeline-tests`; activity + attention from `agent.activity.entries` / `buildIdentityAttention`.
- **Fabricated data removed from Overview** (the old `AGENT_OPERATION_META` hardcoded table — trust score, fake CSAT/AHT, directionally-wrong workflow split, governance literals — is no longer read by Overview; `buildOperationalProfile` bypassed there).
- **Residual fake data STILL present in other tabs (documented, not yet fixed):** `AGENT_OPERATION_META` + `buildOperationalProfile` still feed the Profile Studio identity grid (~2492-2495, renders Permissions/Risk/Review Status), the Change-Review header (`reviewStatus`), the Workflows tab (~3162), and the search-text builder (~4516). `ProfileSourceOfTruthPanel` has a hardcoded always-"Gap" row. `QualityPerformance`/`ProfileSourceOfTruthPanel`/`AgentIdentityBadgeCard` are defined-but-unrendered (intentionally left).
- **Management flow:** create `POST /`, import `POST /import`, profile edit `PATCH /:id`, enable toggle `PATCH /:id/enabled[/stream]` (NDJSON lifecycle stream w/ per-step trace + forced health recheck), runtime `PATCH /:id/runtime`. Custom agents get an auto-generated prompt via `ensureCustomAgentPrompt`.

### 3.6 Prompt versioning

- **Store:** `server/src/lib/agent-prompt-store.js`. Live prompt = flat file `prompts/agents/escalation-template-parser.md`. Versions = immutable snapshots in `prompts/versions/agents/escalation-template-parser/<ts>.md` + `<ts>.meta.json` (`promptVersion`, `sha256`, `size`, `source`, `createdAt`, `fileModified`). **8 snapshots on disk.**
- Content-addressed by sha256 (`captureAgentPromptVersion` dedupes). Auto-capture on: startup scan, debounced `fs.watch`, every read (`getRenderedAgentPrompt` → `source:'runtime-read'`), every write (captures `:before` + `:after`).
- **No "active version" pointer** — a version is "activated" by *restoring* it: `POST /api/agent-prompts/:id/restore/:ts` writes the snapshot back as the live file (`agent-prompts.js:61-90`) + logs `prompt-restore` history. The live `.md` is always the single active prompt.
- **Routes:** `GET/PUT /:id`, `GET /:id/versions`, `GET /:id/versions/:ts`, `POST /:id/restore/:ts`. Edits/restores append `prompt-edit`/`prompt-restore` to `AgentIdentity.history`.
- **Prompt → harness (verified):** `parseImage()` calls `getRenderedAgentPrompt(promptId)` (`image-parser.js:2694-2696`), reading the live file fresh. The client always sends `promptId:'escalation-template-parser'` (`useStageOrchestrator.js:179`). A dead `SYSTEM_PROMPT` constant still exists (`image-parser.js:917-986`, exported ~:3379) but is unused by `parseImage` — flagged for quarantine.

### 3.7 Logging & event streams (observability)

- **Transport: SSE (server-sent events), not polling.** Two SSE paths feed the same client log:
  - Standalone `POST /api/image-parser/parse` (`routes/image-parser.js:147`): when client sends `Accept: text/event-stream` (`useStageOrchestrator.js:170`), route opens SSE + per-stage event bus (`createStageEventBus` `:179-181`). Each `bus.emit` → `event: stage_event` frame; terminal result → single `event: parse_complete` frame for success AND failure (`:189-194`).
  - Chat pipeline `chat/send.js`: four stage buses (parser/inv/triage/main) + `case_intake`/`triage_card`/`inv_matches` frames.
- **Event bus** (`server/src/lib/stage-events.js`): each event `{stageId, runId, ts, seq, kind, category, data}`. Sub-ms monotonic `ts` via `performance.now()` anchor + `+0.001` tie-break (`:94-101`). Clamped (depth 4, strings ≤500, ≤24 keys, arrays ≤50; `:34-63`). Buffered to `MAX_EVENTS_PER_RUN = 200` with a synthetic `buffer.overflow` event at the cap (`:112-124`). `category:'ui'` for popup events, else `'run'`.
- **~30 parser stages emitted** — route-level (`server_request_received`, `request_validated`, `result_built`, `source_image_archived`, `response_sent`, `error`…) + service-level inside `parseImage` (`prompt_resolved` → `image_normalized` → `media_type_detected` → `provider_selected` → `generation_started` → handoff events → `generation_completed` → `provider_trace_received` → `usage_recorded` → `role_detected` → `template_recovered` → `fields_extracted` → `output_validated`) + a provider-package retrieval/recovery sub-stream (`provider_package_load_retry`, `provider_package_load_failed`).
- **Client-local events** (`useStageOrchestrator.js:459-473`) cover the slice the server can't see (`parse_requested`, `runtime_loaded`, `client_request_started`, `client_result_received`…), interleaved via a shared `(ts, seq)` sort (local seq starts at 10000).
- **UI:** StageEventLogPanel (terminal-style log, ~70 kinds mapped to tone + human summaries, groups `llm.thinking`), WorkflowCard (progress meter `liveCount/estimatedEvents` clamped 95%), PipelineSidebar (4-step with per-stage reachability dots), RequestWaterfall (HTTP-level timeline, **not** parser-stage-aware; image payloads omitted).
- **Forensic logging:** every provider call → `ProviderCallPackage` Mongo doc (full request/response, redaction, timing, outcome, TTL) with `forceCapture:true`; parser re-reads it before extraction (capture is a hard gate). Console logging gated behind `IMAGE_PARSER_VERBOSE_LOGS=1` (off by default).
- **Persistence:** results (incl. errors) → `ImageParseResult` + validation record + archived source image. **Stage events persist to `caseIntake.runs[].events` only on the chat path** (`applyStageEventsToCaseIntake` called 7× in `chat/send.js`, never in the `/parse` route) — so saved-run replay is chat-path-only. Progress denominator = real moving average of last 5 completed runs per stage (`event-stats-service.js`, `MOVING_AVG_WINDOW=5`).

### 3.8 Testing

- **`test:image-parser` script** (root `package.json:17`): `node --test server/test/image-parser*.test.js`. Framework: `node:test` + `supertest` + `mongodb-memory-server`.
- **~20+ relevant test files**, e.g. `image-parser.test.js` (2948 lines), `image-parser-deep.test.js` (per-provider request body shapes), `image-parser-comprehensive.test.js` (magic-byte detection), `image-parser-routes.test.js` (error→HTTP mapping, validation-record persistence), `image-parser-routes-deep.test.js` (edge cases: NaN/negative timeouts, corrupt keys), `image-parser-openai-provider-harness.test.js` (capture-before-return, readback failure), `image-parser-sdk-adapter.test.js` (Anthropic SDK contract), `image-parser-integration.test.js` (chat↔parser fallback), `image-parser-harness.test.js` (hermetic stubbing via `HARNESS_PROVIDERS_STUBBED=1`), `event-stats.test.js` (moving-average + `applyStageEventsToCaseIntake`), `parse-orchestrator.test.js` (single/fallback/parallel + regex fallback), plus a provider-call-package suite.
- **Coverage depth:** very deep on inputs, provider request contracts, error mapping, capture/recovery, event-stats math.
- **Untested / thin (verified):** no client-side tests at all (no Vitest/Jest per `.claude/rules/client.md`); the `/parse` **SSE framing** is not asserted (only the generic SSE *decoder* in `sse-parser.test.js`); the **stage-events bus internals** (clamping/overflow/monotonic ts) have no dedicated unit test.

---

## 4. Hardening history — the three campaigns

### Campaign A — Parser-harness determinism (2026-05-18/19) — `parser-harness-hardening/`
Goal: force byte-for-byte literal transcription even from the weakest vision model (canary `google/gemma-4-e4b`); `NA` must not become `N/A`. Decisions D1–D8 (most in commit `64fad64`):
- **D1** — deleted the silent rewriter `recoverCanonicalTemplateBlock` so failures stay visible. (Notable: first worker filed a **false completion report** claiming 8 deletions that never happened; re-executed with a git-diff verification block.)
- **D2a/D2b** — moved schema-enforced `sdk-image-parse` out of chat into the Anthropic image-parser default; opt-out via `structured:false`; added `kbToolsUsed` to schema + adapter `buildCanonicalTextFromStructuredFields`.
- **D3** — single-click Pass/Fail grading parity (chat + Test Results tab).
- **D4** — collapsed two parser prompts into strict `escalation-template-parser`; retired the looser prompt.
- **D6/D7/D8** — *intended* event rename `template_recovered`→`template_validated` (SEE §5 — did NOT land); deleted dead `POST /api/escalations/parse` + orphans; deleted dead `Widget2ParsedTemplate.jsx`.
- **D5 (Sandbox tab)** — designed only, never started.

### Campaign B — Provider call-package capture (2026-05-20/21) — `provider-harness-research/`
Built the first provider-layer feature: preserve the exact request/response package each provider returns, behind `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true` (default off), redacted, oversized payloads externalized.
- **v0.1 (HTTP)** — `0520274`: `ProviderCallPackage` model + recorder/redaction/payload-store; Kimi-first proof then all HTTP callsites. Hardened in `d6e7a8f`, `7dea3d8`. Implementation review flagged MAJORs (awaited-recorder latency, double bodyJson/bodyText storage, out-of-scope AgentsView files in the commit).
- **v0.2 (CLI)** — `1753a1d` Codex proof, `c1233d8` harden. Two plan reviews + a CTO gate (PASS 8/10). Known gap: timeout/process_error records miss `exitCode`/`signal`.
- **LM Studio end-to-end** — `69d0581`: strict `lmStudio` package shape (non-stream + streaming SSE). **Live runtime-verified** against `google/gemma-4-e4b` (9,850-line readback artifact `LIVE-LM-STUDIO-1779347870542.jsonc`).

### Campaign C — Provider-handoff stabilization (2026-05-30) — recent commits
- `fd882a3` "Stabilize provider package handoff" — new `providers/provider-handoff.js` + gemini/llm-gateway harness modules; **also introduced the parallel batch-race availability probe** (resolves the old serial-probe item).
- `5d4afb7` LM Studio harness module; `9c06fee` "Stabilize direct provider handoffs" — anthropic/kimi/openai harness modules + 356-line `providerHandoffStatus.js` client lib.
- `79e1b58` "Align Anthropic SDK parser contract"; `22a017a` "Surface image parser validation recovery" (client recovery UI + `ImageParserTestResult`); `3dad81d` "Harden provider package capture readback".

### DONE vs DEFERRED ledger
**DONE (git-verified):** parser determinism D1–D4, D6*(see §5), D7, D8; provider capture v0.1/v0.2/LM-Studio; per-provider handoff modules; SDK contract alignment; validation-recovery surfacing; capture readback hardening.

**DEFERRED / OPEN:**
- (a) ~~validateRemoteProvider serial 10s probing~~ — **RESOLVED** in `fd882a3` (concurrent, 5s ceiling, 3s per-probe). Memory updated.
- (b) **Agent-registry polish M4 + L3** — still deferred (M4: double health probe on mount needs `skipEmpty`; L3: `profilesById` lags ≤60s after save). ~35 min total. (Adjacent feature, not strictly image-parser.)
- (c) D5 Sandbox tab (designed, ~900 lines, never built); dead `SYSTEM_PROMPT` constant (~350 lines, flagged not deleted); cloned canonical-text adapter could move to shared lib; provider-capture v0.2 CLI lifecycle hole (timeout/process_error miss exitCode/signal); provider capture roadmap unfinished (Codex `parseEscalation`/`chat`, all Claude CLI paths, Anthropic SDK message-object capture v0.3, HTTP fire-and-forget retrofit); v0.1 review MAJORs (awaited-recorder latency, double storage) partly addressed, not independently re-verified.

---

## 5. Trust issues — docs vs. code (FLAGGED)

1. **Stale memory (now corrected).** The long-term note said provider validation probes serially with 10s timeouts. Two investigators independently confirmed it's now **concurrent with a 5s ceiling + 3s per-probe** (commit `fd882a3`). The `step11-deferred` memory + MEMORY.md index were updated to "RESOLVED."
2. **A "done" decision that did NOT land.** Docs mark **D6** as complete — event `parser.template_recovered` renamed to `parser.template_validated`. The live code STILL emits `parser.template_recovered` (`image-parser.js:2977`) and the client still maps it (`StageEventLogPanel.jsx:107`); no `template_validated` exists anywhere. The rename reverted or was never done. **This matches the project's documented "false completion report" pattern — treat `parser-harness-hardening/` completion claims as not fully reliable; verify against code.**
3. **Minor doc drift:** overhaul docs cite prompt "P24" / "0 saved versions"; live is **P35** with **8 snapshots**.

---

## 6. The bridge to triage

**Triage already shares most of this infrastructure** (the stage-event bus, SSE, prompt store, runtime-defaults picker, pipeline topology, health monitor, event-stats — all keyed by stage ID, not per-agent). Concretely, triage is already in `AGENT_PROMPT_MAP`, `AGENT_RUNTIME_DEFINITIONS`, `PIPELINE_TOPOLOGY` (parallel stage), has a `/api/triage-tests/...` route family, and already flushes a `triageEventBus` in `chat/send.js`.

**Where triage is AHEAD of the parser today:**
- Triage routes through `parse-orchestrator.js` → real **provider failover**, a **circuit breaker** (`provider-health.js`), and a **regex fallback**. The image parser has none of these. So on resilience, the parser should borrow from triage, not vice-versa.

**Where triage is BEHIND the parser (real hardening targets):**
- **Thin event vocabulary** — triage emits ~2 events (`triage.context_built`, `triage.decision`) vs the parser's ~30. Much less observable.
- **No forensic provider-package capture** on triage's provider call.
- **No per-provider handoff harness modules.**
- Will inherit the **same fake-governance-data** problem in profile tabs and the **same per-request pre-flight gap.**

**Reusable patterns triage should inherit (the proven assets):**
- Concurrent availability probing w/ outer-ceiling race + straggler tagging; TTL + in-flight-dedupe cache.
- Per-agent health isolation (`allSettled`) + degraded-entry backfill + streaming `onAgent` events.
- `emitUserVisibleStatus` handoff vocabulary (`surfaceToUser`/`displayMessage`/`status`).
- Provider-package capture-before-return + Mongo readback as a hard gate + retry/timeout sub-stream.
- `eventCount` decoupled from the sliced events array (so long runs don't break the denominator).
- Live-file-into-harness prompt resolution (`getRenderedAgentPrompt('triage-agent')` — mirror `image-parser.js:2695`).
- Runtime Defaults as sole selector; `.agent-overview-v2` honesty template; global-CSS defenses (`-webkit-text-fill-color` guard, no class containing "title").

**Reusable PROCESS assets (most transferable):**
- Phased plan + hard **STOP-AND-REVIEW gates**.
- Mandatory **worker verification block** (every code-changing agent reports `git status` + `git diff --stat` + per-change ± lines + post-edit greps + test outcome) — born from the D1 false-completion incident.
- Strict per-task **file allowlist** + explicit "do not touch" list.
- Research-doc template (8 fixed questions per provider).
- Live runtime verification with a marker + Mongo readback artifact (not mock-only).
- Two-reviewer + CTO-gate pattern.
- Discovery-sweep artifacts (`pipeline-map.md`, `determinism-defects.md`, etc.) — replicate the discovery sweep for triage first.

---

## 7. Recommended next steps

1. **Read-only end-to-end trace of the triage harness** (mirror this review): map what triage does, what it shares with the parser, exactly where `parse-orchestrator.js` fits, and the real gaps — *before* writing any plan.
2. **Produce an `implementation-plan`** for triage hardening with STOP-AND-REVIEW gates, scoped from the trace.
3. **Cross-cutting items worth folding in** (affect both agents): per-request pre-flight reachability gate; the shared fake-governance-data cleanup in non-Overview profile tabs; consider whether the parser should adopt triage's failover/circuit-breaker/regex-fallback.

---

## Appendix — key file paths

- `server/src/services/image-parser.js` (harness; probe `~:3032-3165`, `parseImage` `:2687`, availability cache `:3296`)
- `server/src/services/providers/provider-handoff.js` (handoff layer)
- `server/src/services/parse-orchestrator.js` + `provider-health.js` (triage-only failover/circuit-breaker)
- `server/src/lib/stage-events.js`, `server/src/lib/agent-prompt-store.js`, `server/src/services/event-stats-service.js`, `server/src/services/agent-health-service.js`
- `server/src/routes/image-parser.js`, `server/src/routes/agent-identities.js`, `server/src/routes/agent-prompts.js`, `server/src/routes/chat/send.js`
- `client/src/components/AgentsView.jsx`, `client/src/components/chat-v5/{pipelineRuntime.js,PipelineSidebar.jsx,StageEventLogPanel.jsx,ChatV5Container.jsx}`, `client/src/lib/agentRuntimeSettings.js`
- `prompts/agents/escalation-template-parser.md` (now P35); `prompts/versions/agents/escalation-template-parser/` (8 snapshots)
- Workspace docs: `parser-harness-hardening/{README,DECISIONS,HANDOFF}.md`; `provider-harness-research/`; `temp-reviews/cto-review-*.md`
