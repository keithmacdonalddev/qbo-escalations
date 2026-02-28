t# Token Usage & Cost Monitoring — V2 Implementation Plan

## Context

The app uses two AI providers (Claude CLI and Codex CLI) across chat, parse, dev mode, and copilot features. Both CLIs output token usage in their responses, but the current code **discards** all usage data — only extracting text. There is zero visibility into token consumption or cost.

The original v1 plan was reviewed and **17 issues** were found (9 from senior review, 8 additional from codebase analysis). The v2 plan was reviewed with **8 findings** (R1–R8), v2.1 with **7 more** (R9–R15), and v2.2 with **5 more** (R16–R20). This v2.3 revision addresses all of them.

**Copilot is Claude-only today** (not both providers as v1 stated).

### V2 Review Findings Incorporated

| # | Severity | Finding | Resolution |
|---|----------|---------|-----------|
| R1 | High | Dev abort logging misclassifies normal completions — `cleanup()` is called on success/error/disconnect | Phase 4D: `streamSettled` guard; only log abort if `!streamSettled` |
| R2 | High | Frontend missing wiring — Chat.jsx doesn't pass `usage` prop, DevMode.jsx doesn't use ChatMessage | Phase 6: add Chat.jsx and DevMode.jsx to modified files |
| R3 | High | Tests miss route-write integration paths | Phase 7: new `usage-integration.test.js` for full endpoint→UsageLog assertions |
| R4 | Medium | Copilot endpoint count wrong (8, not 7) | Fixed in endpoint coverage table |
| R5 | Medium | dateFilter end-of-day undercounting — `$lte` midnight excludes whole day | Phase 5: usage routes use end-of-day `23:59:59.999` for dateTo |
| R6 | Medium | `usageAvailable` not exposed to message/SSE consumers | Phase 4/6: include in message subdoc and SSE payload |
| R7 | Low | Dev route accepts parallel mode but only runs single/fallback | Documented as pre-existing; dev.js should reject `mode: 'parallel'` |
| R8 | Low | File count says 17 but lists 19 (now 21 with R2 additions) | Fixed |

### V2.1 Review Findings Incorporated

| # | Severity | Finding | Resolution |
|---|----------|---------|-----------|
| R9 | High | Abort misclassification applies to chat/copilot too, not just dev — `req.on('close')` fires after normal completion (chat.js:468, copilot.js:56) and first-write-wins dedup would lock incorrect `abort` status | `streamSettled` guard required on ALL route handlers that log abort, not just dev.js. Phase 4B and 4E updated. |
| R10 | Medium | `/api/chat/retry` missing from integration test assertions | Phase 7: added to `usage-integration.test.js` |
| R11 | Medium | `category` field overloaded — escalation category vs copilot action name — makes `/api/usage/by-category` semantically mixed | Phase 5: `/api/usage/by-category` filters by `service` by default; response groups include `service` alongside `category` for disambiguation |
| R12 | Medium | No usage coverage metric — totals look complete when partial due to providers not reporting usage | Phase 5: `/api/usage/summary` returns `usageReportedCount` and `usageCoveragePercent` |
| R13 | Medium | `usage-writer.js` pending array can grow unbounded if completed promises are not removed | Phase 1C: spec now explicitly requires cleanup of resolved promises via `.finally()` |
| R14 | Low | Date boundary needs explicit timezone definition — end-of-day correction is ambiguous without it | Phase 5: all date handling is **UTC**; documented explicitly |
| R15 | Low | `/api/usage/conversation/:id` needs ObjectId validation | Phase 5: validate `:id` as valid ObjectId, return 400 with `INVALID_ID` if malformed |

### V2.2 Review Findings Incorporated

| # | Severity | Finding | Resolution |
|---|----------|---------|-----------|
| R16 | High | Parallel abort leaves hung promises — `runAttempt` cancel sets `settled=true` but never calls `onSettled`, so `Promise.all` in parallel mode never resolves, leaking the async IIFE | Phase 3A: cancel cleanup must force-resolve via `onSettled` with an abort result so `Promise.all` completes |
| R17 | High | Dev abort drops in-flight attempt usage — `req.on('close')` sets `killed=true`, `runDevAttempt` eventually resolves, but route checks `killed` at dev.js:608 and returns early without processing the result | Phase 4D: after `runDevAttempt` resolves, log usage from the result BEFORE checking the killed guard |
| R18 | Medium | Only input/output tokens tracked — providers may emit cache/reasoning tokens that are billable but unmeasured | Phase 1B/1D: store raw usage payload (`rawUsage: Mixed`); add `usageComplete` flag |
| R19 | Medium | Conversation fork drops usage — fork at chat.js:891 copies only `role/content/images/provider/timestamp`, not `usage` | Phase 4B: add `usage` to fork field list |
| R20 | Medium | Index-dependent behavior has no rollout/verification step — dedup and TTL rely on indexes that may not exist if `autoIndex` is disabled | Phase 4F: add `syncIndexes()` call on startup |

**Open questions resolved:**
- **Per-copilot-action reporting:** `copilotAction` stored in UsageLog `category` field. For `service: 'copilot'`, `category` contains the action name (e.g., `'analyze-escalation'`). The `/api/usage/by-category` endpoint includes `service` in its grouping to disambiguate (R11).
- **Status precedence for duplicates:** First-write-wins via `$setOnInsert` is correct once the `streamSettled` guard (applied to ALL routes per R9) prevents double-logging. Abort and error become mutually exclusive per attempt.
- **Badge scope:** Per-message badge shows only the winning attempt's tokens (what the user sees). Total request spend including failed fallback attempts is tracked in UsageLog and visible in the UsageDashboard.
- **Copilot short-circuit:** Copilot endpoints that return early without an AI call (e.g., no templates found, no candidates) do NOT write a UsageLog row. No AI invocation = nothing to track.

---

## Issue-to-Resolution Traceability

| # | Severity | Issue | Resolution |
|---|----------|-------|-----------|
| 1 | High | Success-only logging undercounts spend | Phase 4: log on `onDone`, `onError`, AND `onAbort` paths |
| 2 | High | Parallel usage needs per-result shape | Phase 3: each parallel result carries own `usage` object |
| 3 | High | Missing endpoints (`/chat/parse-escalation`, quick-parse undocumented) | Phase 4: all 8 AI-calling endpoint groups covered; quick-parse excluded with comment |
| 4 | High | Tests miss riskiest parts | Phase 7: provider extraction, failure-path, parallel, abort, route tests |
| 5 | Medium | No fallback precedence for missing usage | Phase 1: `usage-extractor.js` with 4-tier fallback |
| 6 | Medium | Float USD drifts in aggregates | Phase 1: integer microdollars (`inputCostMicros`, etc.) |
| 7 | Medium | No dedup strategy | Phase 1: compound unique index `{ requestId, attemptIndex, provider }` |
| 8 | Medium | API missing validation/limits | Phase 5: reuse analytics `dateFilter`, pagination caps (max 200) |
| 9 | Low | Context says copilot uses both providers | Fixed in this document |
| 10 | High | Dev mode bypasses claude.js/codex.js AND orchestrator | Phase 1: shared `usage-extractor.js`; Phase 4: dev.js uses it directly |
| 11 | High | Client abort = permanent token loss | Phase 2-4: cleanup returns partial usage; ALL routes (chat, dev, copilot) log on `req.on('close')` with `streamSettled` guard to prevent misclassification (R1, R9) |
| 12 | Medium | Usage badges don't survive page refresh | Phase 4: `usage` subdoc on Conversation/DevConversation message schema |
| 13 | Medium | `_usage` on parseEscalation pollutes fields | Phase 2: return `{ fields, usage }` wrapper instead |
| 14 | Medium | Codex may not emit usage data | Phase 1: `usageAvailable` boolean; extractor returns null gracefully |
| 15 | Medium | 90-day TTL creates invisible data cliffs | Phase 1: 365-day TTL; Phase 5: `dataAvailableFrom` in API responses |
| 16 | Low | Async writes lost on shutdown | Phase 1: `usage-writer.js` drain queue; Phase 4: shutdown waits for drain |
| 17 | Low | Cost at write-time unrevisable | Phase 1: store raw `inputTokens`, `outputTokens`, `model` alongside cost |

---

## Architecture

```
CLI stdout (usage in result/summary event)
  → usage-extractor.js (shared extraction — claude, codex, AND dev.js)
  → claude.js / codex.js pass usage via onDone 2nd param + err._usage
  → chat-orchestrator / parse-orchestrator thread usage into attempts[] + results[]
  → route handlers call usage-writer.js on ALL terminal paths (ok/error/timeout/abort)
  → usage-writer.js: non-blocking upsert with dedup + drain queue
  → UsageLog collection (integer micros, 365-day TTL, compound unique index)
  → /api/usage/* endpoints aggregate with date validation + pagination
  → UsageDashboard.jsx renders charts/tables + ChatMessage shows per-msg tokens
```

**Three distinct code paths for AI calls:**

| Path | Provider access | Orchestrator | Usage extraction |
|------|----------------|-------------|-----------------|
| Chat | via `registry.js` → `claude.chat`/`codex.chat` | `chat-orchestrator.js` | From provider `onDone`/`onError` |
| Parse | via `registry.js` → `provider.parseEscalation` | `parse-orchestrator.js` | From `{ fields, usage }` return |
| Dev | direct `spawn()` in `dev.js` | None (own fallback loop) | Inline via `usage-extractor.js` |
| Copilot | direct `claude.chat()` | None | From `onDone` 2nd param |

---

## Implementation Protocol

**Phases are gated.** Each phase is implemented, reviewed, and approved before the next begins. No phase may start until the previous phase has explicit user approval.

**Per-phase workflow:**
1. **Implement** — write the code for the current phase only
2. **Verify** — run the phase-specific checks listed under each phase
3. **Submit for review** — present changes to user with a summary of what was done
4. **Await approval** — user reviews and either approves (proceed to next phase) or requests changes (iterate on current phase)
5. **Proceed** — only after approval, begin the next phase

**Phase dependency chain:**
```
Phase 1 (Foundation) ──approve──▶ Phase 2 (Provider Extraction) ──approve──▶ Phase 3 (Orchestrators)
  ──approve──▶ Phase 4 (Routes) ──approve──▶ Phase 5 (API) ──approve──▶ Phase 6 (Frontend)
  ──approve──▶ Phase 7 (Tests)
```

Each phase includes a **"Phase Gate"** section listing what to verify before submitting for review.

---

## Phase 1 — Foundation (new files only, no breaking changes)

### 1A. New: `server/src/lib/pricing.js`

- Pricing table: cost per token in **integer microdollars** (1 micro = $0.000001), keyed by model ID
- Provider-level fallback rates when model unknown
- `calculateCost(inputTokens, outputTokens, model, provider)` → `{ inputCostMicros, outputCostMicros, totalCostMicros }`
- `microsToUsd(micros)` → formatted string for API responses
- Configurable via `PRICING_CONFIG_PATH` env var (optional JSON override)

### 1B. New: `server/src/models/UsageLog.js`

| Field | Type | Notes |
|-------|------|-------|
| `requestId` | String (required) | UUID per request |
| `attemptIndex` | Number (required) | 0-based attempt within orchestration |
| `service` | Enum: chat, parse, dev, copilot | Which feature |
| `provider` | String (indexed) | claude or chatgpt-5.3-codex-high |
| `model` | String | Exact model ID from CLI (for cost re-derivation) |
| `inputTokens` | Number | Raw prompt tokens |
| `outputTokens` | Number | Raw completion tokens |
| `totalTokens` | Number | Sum |
| `usageAvailable` | Boolean | `true` if provider reported usage; `false` if absent (handles Issue 14) |
| `usageComplete` | Boolean | `true` if all billable dimensions captured; `false` if provider emitted dimensions we don't parse (R18) |
| `rawUsage` | Mixed (JSON blob) | Raw usage payload from CLI, stored verbatim for audit and future re-parsing (R18) |
| `inputCostMicros` | Number | Integer microdollars |
| `outputCostMicros` | Number | Integer microdollars |
| `totalCostMicros` | Number | Integer microdollars |
| `conversationId` | ObjectId ref | Link to conversation |
| `escalationId` | ObjectId ref | Link to escalation (for parse) |
| `category` | String | Escalation category if known |
| `mode` | Enum: single, fallback, parallel | Orchestration mode |
| `status` | Enum: ok, error, timeout, **abort** | Attempt outcome (abort = Issue 11) |
| `latencyMs` | Number | Request duration |
| `expiresAt` | Date (TTL index) | **365 days** (configurable `USAGE_LOG_TTL_DAYS`) |

**Indexes:**
- `{ requestId, attemptIndex, provider }` — **compound unique** (dedup, Issue 7)
- `{ createdAt: -1 }`, `{ provider, createdAt: -1 }`, `{ service, createdAt: -1 }`, `{ conversationId, createdAt: -1 }`

### 1C. New: `server/src/lib/usage-writer.js`

Non-blocking write queue with shutdown drain:
- `logUsage({...})` — builds UsageLog doc, calculates cost, writes via `updateOne` with `upsert: true` keyed on the compound unique index. `$setOnInsert` ensures second write is a no-op (dedup). Ignores dup-key errors (code 11000).
- Tracks pending write promises in an array. Each promise removes itself from the array via `.finally()` when settled (R13 — prevents unbounded growth).
- `drainPendingWrites(timeoutMs)` — returns a Promise that resolves when all pending writes complete or timeout fires. Called during graceful shutdown.
- `getPendingCount()` — for diagnostics.

### 1D. New: `server/src/lib/usage-extractor.js`

Shared utility for extracting usage from CLI JSON events. Used by claude.js, codex.js, **AND dev.js** (Issue 10).

- `extractClaudeUsage(msg)` — checks `msg.type === 'result'` for `msg.usage.input_tokens`, `msg.usage.output_tokens`, `msg.model`. Returns `{ inputTokens, outputTokens, model, rawUsage, usageComplete }` or `null`. Detects additional billable dimensions (`cache_creation_input_tokens`, `cache_read_input_tokens`) and sets `usageComplete: false` if present but not included in cost calculation (R18). Stores the full `msg.usage` object as `rawUsage`.
- `extractCodexUsage(event)` — checks multiple Codex event shapes (`event.usage`, `event.item.type === 'usage'`, `event.type === 'usage'`). Returns same shape or `null`. Gracefully handles Codex not emitting usage (Issue 14). Detects reasoning tokens and sets `usageComplete` accordingly. Stores raw payload.
- `extractUsageFromMessage(msg, provider)` — dispatches to the correct extractor by provider ID.

**Fallback precedence (Issue 5):** event usage → result usage → configured model env var → provider default. When no usage data found, returns `null` (not zeros) so callers can distinguish "zero tokens" from "unknown tokens" via `usageAvailable`.

**Known billable dimensions to detect (R18):** `cache_creation_input_tokens`, `cache_read_input_tokens` (Claude); `reasoning_tokens`, `cached_tokens` (Codex). If any are present and non-zero, set `usageComplete: false`. The raw payload is always stored for future re-parsing when cost calculation is extended to cover these dimensions.

### Phase 1 Gate
- [ ] `pricing.js` — `calculateCost()` returns correct integer micros for known models, unknown models, and zero-token inputs
- [ ] `UsageLog.js` — model loads without error; indexes defined (compound unique + TTL + query indexes)
- [ ] `usage-writer.js` — `logUsage()` callable without error (can be tested against an in-memory mock or dev MongoDB)
- [ ] `usage-extractor.js` — `extractClaudeUsage()` and `extractCodexUsage()` return expected shapes for sample JSON inputs, return `null` for non-usage events
- [ ] All 4 new files created, no existing files modified, `npm run dev` still starts cleanly
- [ ] **Submit for review → await approval before proceeding to Phase 2**

---

## Phase 2 — Provider-Level Usage Extraction

**Depends on:** Phase 1

### 2A. Modify: `server/src/services/claude.js`

**`chat()` function:**
1. Import `extractClaudeUsage` from `../lib/usage-extractor`
2. Add `let capturedUsage = null;` alongside `fullResponse`
3. In stdout data handler, after parsing each JSON line: `const usage = extractClaudeUsage(msg); if (usage) capturedUsage = usage;`
4. Same extraction in the final buffer parse block in `child.on('close')`
5. `finishWithSuccess(text)` → `finishWithSuccess(text, capturedUsage)` → calls `onDone(text, usage || null)`
6. `finishWithError(err)` → attach `err._usage = capturedUsage || null` before calling `onError(err)` (partial usage on error, Issue 1)
7. `cleanup()` return value: when aborting an unsettled request, return `{ usage: capturedUsage, partialResponse: fullResponse }` (Issue 11)

**`parseEscalation()` function (Issue 13):**
- After parsing stdout JSON, extract usage from the result object
- Change all `resolve(data)` → `resolve({ fields: data, usage })`
- Change fallback resolves similarly: `resolve({ fields: { category: 'unknown', ... }, usage: null })`
- This is a **breaking change** to the return shape, coordinated with Phase 3

### 2B. Modify: `server/src/services/codex.js`

Same pattern as claude.js:
1. Import `extractCodexUsage`
2. In the event processing loop, parse each line and check for usage alongside delta extraction
3. Same `finishWithSuccess`/`finishWithError`/`cleanup` changes
4. Same `parseEscalation` → `{ fields, usage }` restructuring

### 2C. `server/src/services/providers/registry.js` — No changes needed

`getProvider()` returns raw function refs (`claude.chat`, `codex.chat`). The modified functions are backward-compatible through the additional `onDone` argument.

### Phase 2 Gate
- [ ] `claude.js` `chat()` — `onDone` now called with `(text, usageMeta)`, `onError` receives `err._usage`, cleanup returns abort data
- [ ] `claude.js` `parseEscalation()` — returns `{ fields, usage }` shape instead of raw fields
- [ ] `codex.js` — same changes verified
- [ ] Existing chat functionality still works end-to-end (`npm run dev`, send a message, get a response)
- [ ] No regressions — existing callers that ignore the 2nd `onDone` param still work
- [ ] **Submit for review → await approval before proceeding to Phase 3**

---

## Phase 3 — Orchestrator Propagation

**Depends on:** Phase 2

### 3A. Modify: `server/src/services/chat-orchestrator.js`

**`runAttempt()` (line 35):**
- `onDone` callback: capture 2nd param `usageMeta`, include `usage: usageMeta || null` in finalized result
- `onError` callback: read `err._usage`, include `usage: err._usage || null` in finalized result
- Timeout handler: call `cleanup()` which now returns abort data, include its usage
- **Cancel cleanup (R16):** must call `onSettled` with an abort result instead of just setting `settled = true`. Current code (line 147-152) sets `settled = true` and kills the subprocess but never resolves the `runSingleAttempt` Promise. In parallel mode, `Promise.all` (line 198) hangs forever and the async IIFE leaks. Fix: the cancel cleanup must call `finalize()` with `{ ok: false, provider, error: { code: 'ABORT' }, usage: abortData?.usage, latencyMs }` so the Promise resolves and `Promise.all` completes.

**`toAttempt()` (line 130):**
- Add `inputTokens`, `outputTokens`, `model` to attempt objects when `result.usage` exists

**`startChatOrchestration()` (line 147):**
- **Parallel mode:** each entry in `results[]` carries its own `usage` object (Issue 2)
- **Single/fallback `onDone`:** includes `usage` from the successful result
- **`onError`:** includes usage from the last failed attempt (Issue 1)
- **New `onAbort` callback** (Issue 11): called from the cancel function with collected abort data from all active providers. Routes use this to log partial usage on client disconnect.

### 3B. Modify: `server/src/services/parse-orchestrator.js`

**`runParseAttempt()` (line 41):**
- Provider's `parseEscalation` now returns `{ fields, usage }` — destructure with backward compat: `const raw = rawResult.fields || rawResult;`
- Include `usage: providerUsage` in success and failure result objects

**`buildAttemptFromSuccess/Failure`:** Add `inputTokens`, `outputTokens`, `model` from usage.

**`parseWithPolicy` return:** Include per-attempt usage so routes can log each attempt.

### Phase 3 Gate
- [ ] `chat-orchestrator.js` — `runAttempt` onDone captures `usageMeta`, onError captures `err._usage`, cancel calls `onSettled` with abort result (R16)
- [ ] `chat-orchestrator.js` — `toAttempt()` includes `inputTokens`, `outputTokens`, `model` when usage present
- [ ] `chat-orchestrator.js` — parallel mode `results[]` entries each carry their own `usage` (Issue 2)
- [ ] `chat-orchestrator.js` — `onAbort` callback fires with usage data on cancel
- [ ] `parse-orchestrator.js` — destructures `{ fields, usage }` from provider, threads usage through attempts
- [ ] Existing orchestrator tests pass (`npm --prefix server test`)
- [ ] Chat and parse still work end-to-end
- [ ] **Submit for review → await approval before proceeding to Phase 4**

---

## Phase 4 — Route-Level Persistence

**Depends on:** Phases 1, 2, 3

### 4A. Add `usage` subdoc to message schemas (Issue 12)

**Modify: `server/src/models/Conversation.js`** — add to `messageSchema`:
```
usage: { inputTokens: Number, outputTokens: Number, totalTokens: Number, model: String, totalCostMicros: Number, usageAvailable: Boolean }
```

**Modify: `server/src/models/DevConversation.js`** — same addition.

Additive, backward-compatible (defaults to null). Existing docs without `usage` show no badge. The `usageAvailable` field (R6) lets the UI distinguish "provider reported zero tokens" from "provider didn't report usage at all."

### 4B. Modify: `server/src/routes/chat.js` (3 AI endpoints)

**Common:** Import `logUsage` from `usage-writer`, generate `requestId = randomUUID()` at request start. Add `let streamSettled = false;` flag (R9 — same pattern as dev.js R1, required here because `req.on('close')` at chat.js:468 fires after normal completion too).

**`POST /api/chat` and `POST /api/chat/retry`:**
- `onDone`: set `streamSettled = true;`. Iterate `data.attempts[]`, call `logUsage()` for each. For parallel, iterate `data.results[]` with per-result usage (Issue 2). Persist `usage` (including `usageAvailable`, R6) on conversation message subdoc (Issue 12). Include `usage` with `usageAvailable` in SSE `done` event.
- `onError`: set `streamSettled = true;`. Iterate `err.attempts[]`, call `logUsage()` for each with status `error`/`timeout` (Issue 1)
- `onAbort` (new callback): **only if `!streamSettled`** (R9), log partial usage for all in-flight attempts with status `abort` (Issue 11)
- `req.on('close')`: call cleanup; the `onAbort` callback only fires if the orchestration hasn't already settled

**`POST /api/conversations/:id/fork` (R19):**
- Add `usage: m.usage || null` to the fork field copy at chat.js:891. Current fork copies `role`, `content`, `images`, `provider`, `timestamp` but omits `usage`, `mode`, `fallbackFrom`, and `attemptMeta`. Add all four so forked conversations retain usage badges and metadata.

**`POST /api/chat/parse-escalation` (Issue 3):**
- After `parseWithPolicy()`, log usage from `parseResult.meta.attempts[]` (skip `provider: 'regex'`)
- On catch, log same pattern from `err.attempts[]`

### 4C. Modify: `server/src/routes/escalations.js`

**`POST /api/escalations/parse`:** Same pattern as chat/parse-escalation.

**`POST /api/escalations/quick-parse`:** No changes — regex-only, no AI. Add explicit comment documenting exclusion.

### 4D. Modify: `server/src/routes/dev.js` (Issue 10 — the trickiest integration)

**`runDevAttempt()` (line 259):**
1. Import `extractUsageFromMessage` from `usage-extractor`
2. Add `let capturedUsage = null;`
3. In `processParsedMessage()` (line 311): `const usage = extractUsageFromMessage(msg, providerId); if (usage) capturedUsage = usage;`
4. Include `capturedUsage` in ALL finalize paths (ok, error, timeout, abort)

**Route handler (line 443):**
- Generate `requestId`
- Add `let streamSettled = false;` flag (R1: prevents abort misclassification)
- **Critical control flow change (R17):** after `runDevAttempt` resolves, log usage from the attempt result BEFORE checking `sessionEntry.killed`. Current code (dev.js:608) checks `if (sessionEntry.killed) return` and exits without processing. This drops in-flight attempt usage on disconnect. Restructured flow:
  1. `const attemptResult = await runDevAttempt({...});`
  2. `logUsage({ ..., status: attemptResult.ok ? 'ok' : (sessionEntry.killed ? 'abort' : 'error'), ... });` — always log
  3. `if (sessionEntry.killed || streamClosed) return;` — then check for abort
  4. Process the result (save message, write SSE) only if not killed
- Persist `usage` on DevConversation message subdoc (Issue 12)
- Include `usage`, `usageAvailable`, and `rawUsage` in SSE `done` event (R6, R18)
- Set `streamSettled = true;` in both done and error write paths BEFORE calling cleanup
- In cleanup/disconnect handler: **only** log with status `abort` if `!streamSettled` (R1). Current dev.js calls `cleanup()` on success (line 650), error (line 677), AND disconnect (line 583) — without this guard, every completed request would also be logged as abort.

**Reject parallel mode (R7):** Dev route accepts `mode: 'parallel'` as valid (dev.js:32) but only runs single/fallback (dev.js:553). Add explicit rejection:
```
if (mode === 'parallel') {
  return res.status(400).json({ ok: false, code: 'UNSUPPORTED_MODE', error: 'Dev mode does not support parallel' });
}
```

### 4E. Modify: `server/src/routes/copilot.js`

**`streamClaude()` helper (line 30):**
- Accept `requestId` and `copilotAction` params. Add `let streamSettled = false;` (R9).
- `onDone(response, usageMeta)`: set `streamSettled = true;`. Log via `logUsage()` with `service: 'copilot'`, include usage in SSE done event.
- `onError(err)`: set `streamSettled = true;`. Log `err._usage` with status `error`.
- `req.on('close')`: **only if `!streamSettled`** (R9), call `cleanupFn()` and log returned abort data with status `abort`. Current copilot.js:56 `req.on('close')` fires after normal completion — without the guard, every completed copilot request would also write an abort log, and first-write-wins dedup could lock the wrong status.

Each copilot route passes `requestId: randomUUID()` and `copilotAction` (e.g., `'analyze-escalation'`). Include `usageAvailable` in SSE done payload (R6). The `copilotAction` is stored in UsageLog's `category` field — for `service: 'copilot'`, `category` contains the action name rather than an escalation category.

### 4F. Modify: `server/src/index.js` — Startup index sync + graceful shutdown drain

**Index sync (R20):** After MongoDB connection is established, call `await UsageLog.syncIndexes()` to ensure the compound unique index and TTL index exist. This is critical — dedup via `$setOnInsert` silently fails without the unique index, and data retention silently fails without the TTL index. Mongoose `autoIndex` is often disabled in production, so explicit sync is required. Log a warning if sync fails but do not block startup.

**Graceful shutdown drain (Issue 16):** Import `drainPendingWrites`. In shutdown handler, call `await drainPendingWrites(5000)` between closing HTTP server and closing MongoDB connection.

### 4G. Endpoint Coverage Summary

| Endpoint | Service | Logged | Notes |
|----------|---------|--------|-------|
| `POST /api/chat` | chat | All attempts | Single/fallback/parallel |
| `POST /api/chat/retry` | chat | All attempts | Same as /api/chat |
| `POST /api/chat/parse-escalation` | parse | All attempts | Skips regex provider |
| `POST /api/escalations/parse` | parse | All attempts | mode=quick = regex-only, skipped |
| `POST /api/escalations/quick-parse` | N/A | No | Regex-only, no AI |
| `POST /api/dev/chat` | dev | All attempts | Direct CLI spawn |
| `POST /api/copilot/*` (8 endpoints) | copilot | Per-call | Claude-only |

### Phase 4 Gate
- [ ] Send a chat message → `usagelogs` collection has a new document with correct `service`, `provider`, `model`, token counts, integer micros
- [ ] SSE `done` event includes `usage` with `usageAvailable`
- [ ] Reload the conversation → assistant messages still show usage data from MongoDB (Issue 12)
- [ ] Force a provider error → `usagelogs` entry with `status: 'error'` and partial tokens
- [ ] Disconnect client mid-stream → `usagelogs` entry with `status: 'abort'`, NOT logged on normal completion (R1/R9)
- [ ] Dev mode chat → `usagelogs` entry with `service: 'dev'`; usage logged BEFORE killed guard (R17)
- [ ] Dev mode `mode: 'parallel'` → returns 400 (R7)
- [ ] Copilot action → `usagelogs` entry with `service: 'copilot'`, `category: '<action-name>'`
- [ ] Parse escalation → `usagelogs` entry with `service: 'parse'`
- [ ] Fork a conversation → forked messages retain `usage` field (R19)
- [ ] `syncIndexes()` runs on startup; `db.usagelogs.getIndexes()` shows compound unique + TTL (R20)
- [ ] Graceful shutdown drains pending writes (R16)
- [ ] All existing tests pass (`npm --prefix server test`)
- [ ] **Submit for review → await approval before proceeding to Phase 5**

---

## Phase 5 — Usage Analytics API

**Depends on:** Phases 1, 4

### New: `server/src/routes/usage.js`

8 endpoints following `analytics.js` patterns:

| Endpoint | Description |
|----------|-------------|
| `GET /api/usage/summary` | Total requests, tokens, cost for period |
| `GET /api/usage/by-provider` | Breakdown per provider |
| `GET /api/usage/by-service` | Breakdown per service |
| `GET /api/usage/trends` | Time-series (daily/weekly/monthly) |
| `GET /api/usage/by-category` | Token usage per escalation category |
| `GET /api/usage/recent` | Paginated recent requests table |
| `GET /api/usage/conversation/:id` | Aggregate usage for one conversation |
| `GET /api/usage/models` | Breakdown per model |

All endpoints:
- Accept `?dateFrom=&dateTo=` with validation — returns 400 for invalid dates (Issue 8). Use an improved `dateFilter` based on `analytics.js` pattern but with **end-of-day correction** (R5): when `dateTo` is provided, set time to `23:59:59.999` **UTC** before applying `$lte` so the full day is included. **All date handling is UTC** (R14) — documented in code comments and API docs. The existing analytics.js `$lte` midnight bug is not reproduced here.
- Enforce pagination caps: `limit` max 200, default 50 (Issue 8)
- Return `dataAvailableFrom` (oldest UsageLog timestamp) in responses (Issue 15)
- Return cost as both `totalCostMicros` (integer) and `totalCostUsd` (formatted string) (Issue 6)

**Endpoint-specific notes:**

- **`GET /api/usage/summary`**: Include `usageReportedCount` (count where `usageAvailable === true`) and `usageCoveragePercent` (ratio of reported/total, rounded to 1 decimal) so consumers know when totals are partial (R12).
- **`GET /api/usage/by-category`**: Accept optional `?service=` filter. Response groups include both `service` and `category` fields to disambiguate escalation categories from copilot action names (R11). Without a service filter, copilot actions and escalation categories appear as separate groups with their `service` label attached.
- **`GET /api/usage/conversation/:id`**: Validate `:id` as a valid MongoDB ObjectId format. Return 400 with `{ ok: false, code: 'INVALID_ID', error: 'Invalid conversation ID' }` for malformed IDs (R15).

### Modify: `server/src/app.js`

Add: `app.use('/api/usage', require('./routes/usage'));`

### Phase 5 Gate
- [ ] All 8 `/api/usage/*` endpoints return `{ ok: true, ... }` with correct data from seeded `usagelogs`
- [ ] `GET /api/usage/summary` returns `usageCoveragePercent` and `dataAvailableFrom`
- [ ] `GET /api/usage/by-category` groups include `service` field; `?service=copilot` filters correctly (R11)
- [ ] `GET /api/usage/recent` enforces limit cap at 200
- [ ] `GET /api/usage/conversation/invalid` returns 400 `INVALID_ID` (R15)
- [ ] Invalid `dateFrom` → 400 response; `dateTo` includes full end day in UTC (R5, R14)
- [ ] Cost returned as both `totalCostMicros` (integer) and `totalCostUsd` (string)
- [ ] Routes mounted at `/api/usage` in app.js
- [ ] **Submit for review → await approval before proceeding to Phase 6**

---

## Phase 6 — Frontend

**Depends on:** Phases 4, 5

### New: `client/src/api/usageApi.js`
One async function per endpoint, following `analyticsApi.js` pattern.

### New: `client/src/components/UsageDashboard.jsx`
Full monitoring page using existing design system (`stat-card`, `card`, `table` CSS):

**Stat Cards Row (7 cards):**
1. **Total Tokens** — formatted with K/M suffixes (e.g., "2.4M")
2. **Total Cost** — USD from `totalCostMicros / 1_000_000`, formatted to 2 decimals (e.g., "$18.42")
3. **Avg Cost / Request** — `totalCostMicros / totalRequests`, formatted to 4 decimals (e.g., "$0.0089")
4. **Requests Today** — count from summary endpoint with today's date filter
5. **Input : Output Ratio** — `totalInputTokens / totalOutputTokens`, formatted as "3.2:1"
6. **Top Provider** — provider with highest request count, shown with percentage (e.g., "Claude (72%)")
7. **Usage Coverage** — `usageCoveragePercent` from summary endpoint (R12), accent-colored (e.g., "94.2%")

**Controls:**
- Date range: `dateFrom` and `dateTo` date inputs, pre-filled to last 14 days
- Auto-refresh toggle (minimum 30s interval, opt-in)

**Data Available Since notice:** Info bar showing `dataAvailableFrom` from API responses + "All times in UTC" (Issue 15, R14)

**Data Cards Grid (2-column on desktop, 1-column on mobile):**

- **Cost Trends** — daily bar chart (Chart.js) showing cost per day for the selected date range. Teal bars, Y-axis formatted as USD. Same visual pattern as Analytics "Daily Trends."
- **Provider Comparison** — two sections (Tokens and Cost), each showing horizontal bars for Claude vs Codex with provider badges and numeric values. Bar widths proportional to each provider's share.
- **Service Breakdown** — horizontal progress bars for each service (chat, parse, dev, copilot) with `badge-service` labels and request counts. Bar widths proportional to request count.
- **Model Distribution** — horizontal bar chart (Chart.js) showing request count per model ID (e.g., `claude-sonnet-4`, `gpt-5.3-codex`). Color-coded by provider.
- **Category Cost** — table with columns: Category (as `cat-badge`), Service (as `badge-service` for R11 disambiguation), Requests, Tokens, Cost. Mixed rows showing both escalation categories (payroll, bank-feeds) and copilot actions (analyze-escalation, suggest-template) with their service labels to distinguish them. Same visual pattern as Analytics "Resolution Time by Category."

**Recent Requests Table** — paginated table with the following columns:
| Column | Format |
|--------|--------|
| Time | Date + time, `text-xs`, `white-space: nowrap` |
| Service | `badge-service` (chat/parse/dev/copilot) |
| Provider | `badge-claude` or `badge-codex` colored badge |
| Model | Monospace `text-xs` (e.g., `claude-sonnet-4`) |
| In | Right-aligned tabular-nums, input token count |
| Out | Right-aligned tabular-nums, output token count |
| Cost | Right-aligned USD (e.g., "$0.0064") |
| Status | Colored badge: `badge-ok` (green), `badge-error` (red), `badge-timeout` (amber), `badge-abort` (purple) |
| Latency | Right-aligned (e.g., "1.5s") |

Error/timeout/abort rows have tinted backgrounds matching their status color. Pagination controls show "Showing 1–50 of N requests" with Prev/Next buttons, limit capped at 200 per page.

### Modify: `client/src/hooks/useChat.js`
In `onDone` handler: capture `data.usage` (including `usageAvailable`) onto assistant message object. For parallel mode, capture `result.usage` per result message. Persisted usage auto-loads from DB on conversation switch (Issue 12).

### Modify: `client/src/hooks/useDevChat.js`
Same `data.usage` capture (including `usageAvailable`).

### Modify: `client/src/components/Chat.jsx` (R2)
Pass `usage={msg.usage}` prop to `<ChatMessage>` in the message rendering loop. Currently Chat.jsx passes explicit props (Chat.jsx:482) and does not pass usage — without this change, badges won't render even if useChat captures the data.

### Modify: `client/src/components/ChatMessage.jsx`
Add `usage` prop to component signature (R2 — currently has no `usage` prop, ChatMessage.jsx:12). Show token/cost badge on assistant messages when `usage` prop present and `usage.usageAvailable !== false` (R6):
- Format: `1.2K tokens ($0.0034)` in tertiary color, next to response time
- When `usageAvailable === false`: show nothing (don't display "0 tokens")
- `formatTokenCount()` helper (1K/1M suffixes)
- Cost from `totalCostMicros / 1_000_000`

### Modify: `client/src/components/DevMode.jsx` (R2)
DevMode.jsx renders assistant messages with its own inline JSX (DevMode.jsx:227, DevMode.jsx:365) — it does **not** use ChatMessage. Add usage badge rendering inline where dev assistant messages are displayed, using the same format/logic as ChatMessage. Read `usage` from the message objects populated by useDevChat.

### Modify: `client/src/App.jsx` — Add `#/usage` route
### Modify: `client/src/components/Sidebar.jsx` — Add "Usage" nav item
### Modify: `client/src/App.css` — Usage dashboard + badge styles

### Phase 6 Gate
- [ ] Chat view — assistant messages show token badge (e.g., "1.2K tokens ($0.0034)") next to response time
- [ ] Chat view — messages with `usageAvailable: false` show no badge (not "0 tokens")
- [ ] Chat view — parallel mode shows per-provider badges on each response
- [ ] Chat view — reload conversation → badges persist from MongoDB (Issue 12)
- [ ] Dev mode — assistant messages show inline usage badges in dev's own layout
- [ ] Sidebar — "Usage" nav item visible between Analytics and Playbook
- [ ] `#/usage` route — UsageDashboard renders with all 7 stat cards, charts, tables
- [ ] Dashboard — date range filtering works, auto-refresh toggle works
- [ ] Dashboard — "Data available since" notice shows correct date
- [ ] Dashboard — Category Cost table shows service labels for disambiguation (R11)
- [ ] Dashboard — Recent Requests table shows status badges (ok/error/timeout/abort)
- [ ] Dashboard — pagination controls work
- [ ] `npm run build` succeeds (no build errors)
- [ ] **Submit for review → await approval before proceeding to Phase 7**

---

## Phase 7 — Tests

**Depends on:** All previous phases

### New: `server/test/usage-extractor.test.js` (Issue 4: provider extraction)
- Claude: extracts from result message, returns null for non-result, handles missing usage with model fallback, handles missing everything
- Codex: extracts from direct usage event, item-based event, returns null when no usage emitted (Issue 14)
- Fallback precedence verification (Issue 5)
- Auto-detection by provider ID

### New: `server/test/pricing.test.js`
- Known model → correct micros, unknown model → provider fallback, unknown both → zeros
- Negative tokens → zero, microsToUsd formatting, integer sum drift-free (Issue 6)

### New: `server/test/usage-writer.test.js`
- Correct field population, dedup on same compound key (Issue 7)
- drainPendingWrites resolves after completion, times out gracefully (Issue 16)

### Modify: `server/test/chat-orchestrator.test.js`
- Usage flows through onDone in single mode
- Usage flows through onError on failure (Issue 1)
- Parallel mode has per-result usage (Issue 2)
- onAbort fires with partial usage on cancel (Issue 11)
- **Parallel cancel resolves all promises (R16):** cancel during parallel mode must call `onSettled` with abort results so `Promise.all` completes; verify the async IIFE does not hang
- **Cancel cleanup includes usage from aborted providers (R16)**

### New: `server/test/usage-routes.test.js` (Issue 4: usage API tests)
- All 8 usage API endpoints return correct data with seeded UsageLog docs
- Invalid dateFrom → 400 (Issue 8)
- Pagination limit capped at 200 (Issue 8)
- `dataAvailableFrom` present in responses (Issue 15)
- Integer micros aggregate without drift (Issue 6)
- dateTo includes full end day (R5 — end-of-day correction)

### New: `server/test/usage-integration.test.js` (R3: route-write integration)
Full endpoint→UsageLog assertion tests with mocked CLI subprocess. Each test hits a route and verifies UsageLog entries exist in MongoDB with correct fields:
- `POST /api/chat` success → UsageLog with `service: 'chat'`, `status: 'ok'`, token values
- `POST /api/chat` provider error → UsageLog with `status: 'error'`, partial tokens
- `POST /api/chat` client disconnect → UsageLog with `status: 'abort'` (Issue 11)
- `POST /api/chat` normal completion → NO abort UsageLog entry despite `req.on('close')` firing (R9)
- `POST /api/chat` parallel → 2 UsageLog entries, one per provider (Issue 2)
- `POST /api/chat/retry` success → UsageLog with `service: 'chat'`, `status: 'ok'` (R10)
- `POST /api/chat/retry` error → UsageLog with `status: 'error'` (R10)
- `POST /api/dev/chat` success → UsageLog with `service: 'dev'`, `status: 'ok'`
- `POST /api/dev/chat` error → UsageLog with `status: 'error'`
- `POST /api/dev/chat` disconnect → UsageLog with `status: 'abort'`, NOT logged on normal completion (R1)
- `POST /api/copilot/analyze-escalation` → UsageLog with `service: 'copilot'`, `category: 'analyze-escalation'`
- `POST /api/copilot/analyze-escalation` normal completion → NO abort UsageLog entry (R9)
- `POST /api/escalations/parse` → UsageLog with `service: 'parse'`
- `POST /api/chat/parse-escalation` → UsageLog with `service: 'parse'`
- Verify `usageAvailable` is `false` when provider emits no usage data (R6, Issue 14)
- Verify `/api/usage/summary` returns `usageCoveragePercent` reflecting partial reporting (R12)
- Verify `/api/usage/by-category` groups include `service` field for disambiguation (R11)
- Verify `/api/usage/conversation/:id` returns 400 for malformed ID (R15)
- `POST /api/dev/chat` disconnect mid-attempt → UsageLog entry created with usage from resolved attempt (R17)
- `POST /api/conversations/:id/fork` → forked messages retain `usage` field (R19)
- Verify `rawUsage` stored on UsageLog when provider emits usage (R18)
- Verify `usageComplete: false` when provider emits cache/reasoning tokens (R18)
- Verify `UsageLog.syncIndexes()` runs on startup without blocking (R20)

### Phase 7 Gate (Final)
- [ ] All new test files pass: `usage-extractor.test.js`, `pricing.test.js`, `usage-writer.test.js`, `usage-routes.test.js`, `usage-integration.test.js`
- [ ] All existing tests still pass (`npm --prefix server test` — baseline: 58 tests)
- [ ] Integration tests cover all status paths: ok, error, timeout, abort
- [ ] Integration tests verify no abort logged on normal completion (R9)
- [ ] Integration tests verify parallel cancel resolves (R16)
- [ ] Integration tests verify dev abort logs usage before killed guard (R17)
- [ ] `npm run build` succeeds
- [ ] **Submit for final review → await approval → feature complete**

---

## Files Summary

**New files (12):**
| File | Purpose |
|------|---------|
| `server/src/lib/pricing.js` | Integer microdollar cost calculation |
| `server/src/lib/usage-extractor.js` | Shared CLI usage extraction for all providers + dev mode |
| `server/src/lib/usage-writer.js` | Non-blocking write queue with drain |
| `server/src/models/UsageLog.js` | Mongoose model with 365d TTL + compound unique index |
| `server/src/routes/usage.js` | 8 analytics endpoints |
| `client/src/api/usageApi.js` | Client API functions |
| `client/src/components/UsageDashboard.jsx` | Monitoring page |
| `server/test/usage-extractor.test.js` | Provider extraction tests |
| `server/test/pricing.test.js` | Pricing engine tests |
| `server/test/usage-writer.test.js` | Write queue + dedup tests |
| `server/test/usage-routes.test.js` | Usage API endpoint tests |
| `server/test/usage-integration.test.js` | Route→UsageLog write integration tests (R3) |

**Modified files (21):**
| File | Changes |
|------|---------|
| `server/src/services/claude.js` | Extract usage (incl. raw payload + completeness flag), pass via onDone/onError, `parseEscalation` returns `{fields, usage}` |
| `server/src/services/codex.js` | Same pattern as claude.js |
| `server/src/services/chat-orchestrator.js` | Thread usage through attempts/results, add `onAbort`; cancel cleanup force-resolves via `onSettled` for parallel mode (R16) |
| `server/src/services/parse-orchestrator.js` | Thread usage through parse attempts |
| `server/src/models/Conversation.js` | Add `usage` subdoc (with `usageAvailable`) to messageSchema |
| `server/src/models/DevConversation.js` | Add `usage` subdoc (with `usageAvailable`) to devMessageSchema |
| `server/src/routes/chat.js` | Log usage on all paths (3 endpoints), persist on messages, `streamSettled` guard (R9), fork copies `usage` (R19) |
| `server/src/routes/escalations.js` | Log usage for /parse endpoint |
| `server/src/routes/dev.js` | Extract usage via shared extractor, log BEFORE killed guard (R17), `streamSettled` guard (R1), reject parallel mode (R7) |
| `server/src/routes/copilot.js` | Capture usage from claude.chat, log on all paths, `streamSettled` guard (R9) |
| `server/src/index.js` | `syncIndexes()` on startup (R20), drain pending writes on shutdown |
| `server/src/app.js` | Mount /api/usage routes |
| `server/test/chat-orchestrator.test.js` | Usage propagation + failure + parallel + abort + parallel-cancel-resolves tests |
| `client/src/hooks/useChat.js` | Capture usage (incl. `usageAvailable`) from SSE done event |
| `client/src/hooks/useDevChat.js` | Capture usage (incl. `usageAvailable`) from SSE done event |
| `client/src/components/Chat.jsx` | Pass `usage={msg.usage}` prop to ChatMessage (R2) |
| `client/src/components/ChatMessage.jsx` | Add `usage` prop, render token/cost badge, respect `usageAvailable` (R2, R6) |
| `client/src/components/DevMode.jsx` | Add inline usage badge rendering for dev assistant messages (R2) |
| `client/src/App.jsx` | Add #/usage route |
| `client/src/components/Sidebar.jsx` | Add Usage nav item |
| `client/src/App.css` | Usage dashboard + badge styles |

---

## Verification

1. `npm run dev` → send a chat message → check MongoDB `usagelogs` for new document with integer micros
2. Network tab → SSE `done` event includes `usage: { inputTokens, outputTokens, totalCostMicros }`
3. ChatMessage renders token badge below assistant response; survives page refresh
4. Force a provider error (e.g., kill Claude CLI mid-stream) → verify `usagelogs` entry with `status: 'error'` and partial tokens
5. Disconnect client mid-stream → verify `usagelogs` entry with `status: 'abort'`
6. Parse escalation → verify `usagelogs` entry with `service: 'parse'`
7. Dev mode chat → verify `usagelogs` entry with `service: 'dev'`
8. Copilot action → verify `usagelogs` entry with `service: 'copilot'`
9. Parallel mode → verify 2 `usagelogs` entries (one per provider) with per-result tokens
10. Navigate to `#/usage` → dashboard loads with stat cards, charts, tables, `dataAvailableFrom`
11. Test date range filtering, invalid date → 400 response
12. Insert duplicate `{ requestId, attemptIndex, provider }` → second write silently ignored
13. `npm test` in server/ → all existing + new tests pass
14. Shutdown server during active requests → pending writes drain before exit
15. Disconnect client during parallel mode → both providers' promises resolve (no hang), abort usage logged for both (R16)
16. Disconnect client during dev mode mid-attempt → UsageLog entry created with tokens from the in-flight attempt (R17)
17. Check `usagelogs` for `rawUsage` field containing the full CLI usage payload (R18)
18. Fork a conversation → forked messages retain usage badges (R19)
19. Start server with `autoIndex: false` → verify `usagelogs` indexes exist via `db.usagelogs.getIndexes()` (R20)
20. Summary endpoint → verify `usageCoveragePercent` reflects actual reporting rate (R12)
