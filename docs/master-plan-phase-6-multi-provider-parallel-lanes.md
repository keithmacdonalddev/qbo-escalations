# Phase 6 Master Plan: Multi-Provider Parallel Lanes (3 to 4 Real-Time Lanes)

## Mission
Extend chat parallel mode from fixed two-lane behavior to N-way parallel with 2 to 4 providers per turn, with real-time lane streaming, deterministic acceptance, and backward-compatible APIs.

## Current State (Code-Validated)
1. Parallel mode is currently derived from `primaryProvider + fallbackProvider`.
2. Orchestrators only run one or two providers in parallel.
3. UI lane rendering assumes `provider` and `fallbackProvider` only.
4. Acceptance/discard endpoints work per turn and selected provider but do not track requested provider list explicitly.

## Scope

### In Scope
1. Add `parallelProviders: string[]` request support for chat and retry.
2. Validate 2 to 4 unique providers in parallel mode.
3. Stream one lane per provider in real time.
4. Persist and expose N candidate results per turn.
5. Keep accept/discard semantics idempotent and deterministic.
6. Preserve backward compatibility for current clients.

### Out of Scope
1. Dev mode N-way parallel.
2. Copilot N-way parallel.
3. Parse route N-way support in this phase (optional follow-up).

## API Contract Changes (Exact)

### 1) POST `/api/chat`
New optional field:
```json
{
  "parallelProviders": ["claude-sonnet-4-6", "gpt-5-mini", "claude"]
}
```

Validation rules:
1. Allowed only when `mode === "parallel"`.
2. Must be an array of strings.
3. Must contain 2 to 4 unique valid provider IDs.
4. If absent, server uses legacy behavior from `primaryProvider/fallbackProvider`.
5. If present and `primaryProvider` also present, `primaryProvider` must be included in `parallelProviders` or request fails with `400 INVALID_PARALLEL_PROVIDERS`.

Error contract additions:
1. `INVALID_PARALLEL_PROVIDERS`
2. `PARALLEL_PROVIDER_LIMIT_EXCEEDED`
3. `PARALLEL_PROVIDER_COUNT_INVALID`

### 2) POST `/api/chat/retry`
Same `parallelProviders` field and rules as `/api/chat`.

### 3) SSE `start` event (parallel mode)
Must include:
```json
{
  "mode": "parallel",
  "parallelProviders": ["p1", "p2", "p3"]
}
```

Backward compatibility:
1. Keep existing fields (`provider`, `primaryProvider`, `fallbackProvider`) for old clients.
2. `fallbackProvider` remains populated only for legacy two-lane path.

### 4) SSE `chunk` event
No shape change:
```json
{ "provider": "p1", "text": "..." }
```
Client must render by provider key for N lanes.

### 5) SSE `done` event (parallel mode)
`results` array now supports 2 to 4 provider entries:
```json
{
  "mode": "parallel",
  "results": [
    { "provider": "p1", "status": "ok", "fullResponse": "...", "latencyMs": 1200 },
    { "provider": "p2", "status": "error", "errorCode": "TIMEOUT", "errorMessage": "...", "latencyMs": 30000 }
  ]
}
```

### 6) POST `/api/chat/parallel/:turnId/accept`
Request unchanged:
```json
{ "conversationId": "...", "provider": "p2", "editedContent": "optional" }
```
New validation:
1. If `requestedProviders` exists on turn record, `provider` must be in that set.
2. Else fallback to existing behavior from messages/candidates.

### 7) POST `/api/chat/parallel/:turnId/discard`
No request contract changes.

## Backward Compatibility Rules
1. If `parallelProviders` is not provided, behavior is exactly current.
2. Existing clients and tests using `primaryProvider/fallbackProvider` continue to pass.
3. New clients should prefer `parallelProviders` in `mode=parallel`.

## Data Model Changes

### ParallelCandidateTurn
Add field:
1. `requestedProviders: [String]` with enum of provider IDs.

Purpose:
1. Auditability: exact providers requested for the turn.
2. Validation: accept/discard correctness guard.
3. Debugging: compare requested vs completed candidates.

## File-Level Work Plan

### Backend
- [ ] Extend policy normalization in [server/src/services/chat-orchestrator.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/services/chat-orchestrator.js)
  - Accept `parallelProviders` input.
  - Dedupe, validate, and order provider list.
  - Execute `Promise.all` across N providers for parallel mode.
  - Return ordered `results` aligned to requested providers.
- [ ] Update route validation and payload wiring in [server/src/routes/chat.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/routes/chat.js)
  - Parse and validate `parallelProviders` for chat and retry.
  - Emit `parallelProviders` in `start`.
  - Persist `requestedProviders` with turn records.
  - Keep legacy fields for compatibility.
- [ ] Update turn model in [server/src/models/ParallelCandidateTurn.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/models/ParallelCandidateTurn.js)
  - Add `requestedProviders`.
  - Keep existing candidate schema and TTL behavior.
- [ ] Optional follow-up parity in [server/src/services/parse-orchestrator.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/services/parse-orchestrator.js)
  - Not required for this phase, but document future compatibility.

### Client
- [ ] Extend chat state model in [client/src/hooks/useChat.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/hooks/useChat.js)
  - Add `parallelProviders` state.
  - Send `parallelProviders` on chat and retry when mode is parallel.
  - Manage streaming map and lane state by dynamic provider list.
- [ ] Replace two-provider picker with multi-select in [client/src/components/Chat.jsx](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/Chat.jsx)
  - Allow selecting 2 to 4 providers.
  - Show validation errors when selection is invalid.
  - Render dynamic lane list from `parallelProviders`.
- [ ] Update API docs/types in [client/src/api/chatApi.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/api/chatApi.js)
  - Include `parallelProviders` in request JSDoc.
- [ ] Confirm label coverage in [client/src/components/ChatMessage.jsx](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/ChatMessage.jsx)
  - Ensure all provider IDs map to labels.

### Tests
- [ ] Add orchestrator unit tests in [server/test/chat-orchestrator.test.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/test/chat-orchestrator.test.js)
  - 3-provider all-success ordering.
  - 4-provider mixed success/failure ordering.
  - duplicate provider dedupe behavior.
  - invalid provider list validation.
- [ ] Add integration tests in [server/test/integration-routes.test.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/test/integration-routes.test.js)
  - `/api/chat` with `parallelProviders` length 3 and 4.
  - `/api/chat/retry` with `parallelProviders`.
  - `start` and `done` payload validation.
  - accept/discard correctness for N lanes.
- [ ] Add client behavior checks (manual script or automated if test harness exists)
  - dynamic lane render and updates.
  - accept flow from non-first provider.
  - lane error and timeout UX.

## Implementation Tickets

### Backend Tickets
1. `P6-BE-01` N-Way Policy and Validation
   - Files: `server/src/services/chat-orchestrator.js`, `server/src/routes/chat.js`
   - Deliverables: `parallelProviders` normalization, error handling, ordering.
   - Acceptance: valid 2 to 4 arrays run; invalid arrays fail with explicit error code.
2. `P6-BE-02` Turn Persistence Enhancements
   - Files: `server/src/routes/chat.js`, `server/src/models/ParallelCandidateTurn.js`
   - Deliverables: persist `requestedProviders`; verify candidate mapping by provider.
   - Acceptance: turn docs include requested list and completed candidate set.
3. `P6-BE-03` Acceptance Validation Hardening
   - Files: `server/src/routes/chat.js`
   - Deliverables: accept provider must belong to requested set when available.
   - Acceptance: invalid provider accept returns deterministic 4xx.

### Client Tickets
1. `P6-FE-01` Parallel Provider Multi-Select
   - Files: `client/src/components/Chat.jsx`
   - Deliverables: 2 to 4 selector UI with validation and persistence behavior.
   - Acceptance: user can configure 2 to 4 providers before send.
2. `P6-FE-02` Dynamic Lane Streaming
   - Files: `client/src/hooks/useChat.js`, `client/src/components/Chat.jsx`
   - Deliverables: render/update lane state by provider key, not fixed pair.
   - Acceptance: chunk streams appear in the correct lane for all selected providers.
3. `P6-FE-03` Retry and Accept Flow Parity
   - Files: `client/src/hooks/useChat.js`, `client/src/api/chatApi.js`
   - Deliverables: retry preserves chosen `parallelProviders`; accept works from any lane.
   - Acceptance: canonical commit works exactly once.

### Test Tickets
1. `P6-TEST-01` Orchestrator N-Way Unit Suite
   - Files: `server/test/chat-orchestrator.test.js`
   - Acceptance: pass scenarios for 2, 3, and 4 providers.
2. `P6-TEST-02` Route N-Way Integration Suite
   - Files: `server/test/integration-routes.test.js`
   - Acceptance: chat/retry/accept/discard contracts pass for N lanes.
3. `P6-TEST-03` UI Lane Regression
   - Files: client tests or manual QA checklist
   - Acceptance: no regressions in single/fallback modes.

## Migration and Rollout Steps
1. Add backend support first with feature flag disabled:
   - `FEATURE_CHAT_PARALLEL_MULTI=0` default.
2. Deploy backend, run old-client regression tests (legacy two-lane path).
3. Enable feature in staging and execute N-way integration suite.
4. Deploy client multi-select UI behind same feature flag.
5. Perform controlled rollout:
   - start with max 3 providers.
   - then allow 4 after stability verification.
6. Monitor throughput and latency impacts:
   - open-turn cap
   - provider timeout/error rates
   - response render stability

## Operational Guardrails
1. Enforce max providers per turn: 4.
2. Enforce min providers per parallel turn: 2.
3. Keep existing open-turn cap and consider reducing while testing.
4. Optional: add per-request estimated concurrency cost warning in UI for 4-lane runs.

## Verification Checklist
- [ ] Legacy parallel (2 providers via fallback field) still works.
- [ ] `parallelProviders` with 3 providers streams 3 lanes.
- [ ] `parallelProviders` with 4 providers streams 4 lanes.
- [ ] Retry preserves same provider list unless user changes it.
- [ ] Accept from any lane commits exactly one canonical answer.
- [ ] Discard removes unaccepted parallel candidates across N lanes.
- [ ] `npm --prefix server test` passes.
- [ ] `npm run build` passes.

## Exit Criteria
1. Chat parallel mode supports 2 to 4 providers in one turn.
2. Real-time per-provider lanes are stable in UI.
3. Accept/discard semantics remain deterministic and idempotent.
4. Legacy clients remain fully functional.

