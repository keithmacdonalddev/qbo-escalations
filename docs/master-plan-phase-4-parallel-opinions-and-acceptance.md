# Phase 4 Master Plan: Parallel Opinions + Candidate Acceptance + Auditability

## Mission
Enable side-by-side model opinions in parallel, let users accept the best answer deterministically, and preserve audit trails without corrupting canonical conversation history.

This phase satisfies the requirement for separate opinions and best-response acceptance.

## Current State (Code-Validated)
1. All primary flows are single-stream per request.
2. No candidate store for non-canonical outputs.
3. No acceptance endpoint or idempotent commit logic.
4. No parallel UI compare layout.

## Scope

### In Scope
1. Parallel orchestration for chat and parse (primary).
2. Optional parallel mode for co-pilot tasks.
3. Candidate persistence model and lifecycle.
4. Acceptance/discard endpoints.
5. Side-by-side UI with explicit accept controls.
6. Practical cost and concurrency guardrails.

### Out of Scope
1. Parallel write-enabled Dev mode (dangerous conflicting edits).
2. Mandatory auto-merge of two answers.

## Architecture

### 1. Parallel Orchestrator
New module: `server/src/services/parallel-orchestrator.js`.

Responsibilities:
1. Start two provider executions concurrently.
2. Multiplex provider-tagged SSE events.
3. Track per-provider state (`streaming`, `done`, `error`, `timeout`).
4. Persist candidate snapshots.
5. Emit readiness for user acceptance once at least one candidate completes.

### 2. Candidate Persistence Model
New model: `server/src/models/ParallelCandidateTurn.js`.

Proposed schema:
1. `turnId` (unique)
2. `service` (`chat|parse|copilot`)
3. `conversationId` or service-linked id
4. `status` (`open|accepted|discarded|expired`)
5. `candidates[]`:
   - `provider`
   - `content`
   - `state`
   - `errorCode`
   - `latencyMs`
   - `qualityMeta`
6. `acceptedProvider`
7. `acceptedContent`
8. `acceptedMessageId` (chat)
9. `expiresAt` (TTL)

### 3. Canonical Commit Rule
1. Only accepted winner is committed to canonical transcript/record.
2. Non-accepted candidates remain in candidate store for audit and analytics.

## API Contracts

### Endpoint: `POST /api/chat/parallel` (SSE)
Request:
```json
{
  "conversationId": "optional",
  "message": "...",
  "images": [],
  "providers": ["claude", "chatgpt-5.3-codex-high"],
  "timeoutMs": 90000
}
```

SSE events:
1. `start` (turnId, providers)
2. `provider_chunk` (provider, text)
3. `provider_done` (provider, fullResponse, latency)
4. `provider_error` (provider, code)
5. `ready_for_accept` (availableProviders)
6. `done` (all providers terminal)

### Endpoint: `POST /api/chat/parallel/:turnId/accept`
Request:
```json
{
  "provider": "claude",
  "editedContent": "optional"
}
```

Behavior:
1. Idempotent: duplicate accept returns same committed result.
2. Commits exactly one assistant message.

### Endpoint: `POST /api/chat/parallel/:turnId/discard`
Marks unresolved turn discarded without canonical write.

### Parse parallel endpoint
Either:
1. Extend `POST /api/escalations/parse` with `mode=parallel`
2. Or add `POST /api/escalations/parse/parallel`

Return both candidates + winner with validation scores.

## Frontend UX

### Chat parallel mode
Files:
1. `client/src/components/Chat.jsx`
2. `client/src/hooks/useChat.js` or `useParallelChat.js`
3. `client/src/components/ParallelResponsePanel.jsx` (new)

Requirements:
1. Two live panes with provider badges.
2. Independent error states per provider.
3. `Accept` action per candidate.
4. Optional `Copy` and `Edit+Accept`.
5. Clear state after accept: winner moved into canonical stream.

### Parse parallel UX
1. Show candidate field diffs and validation scores.
2. Permit manual winner selection or auto-winner with override.

## Acceptance Semantics
1. Accepting winner locks turn status to `accepted`.
2. A second accept attempt returns `409 TURN_ALREADY_ACCEPTED`.
3. Discarded turn cannot later be accepted without explicit reopen flow.
4. If both providers fail, no acceptance allowed.

## Cost and Concurrency Controls
1. Configurable max concurrent parallel turns (local sanity cap).
2. Timeout caps per provider.
3. Quick config toggle to disable parallel mode instantly.
4. Optional fast-stop: cancel losing stream after winner accepted.
5. Add usage tracking only if local cost becomes a concern.

## Security and Reliability
1. Maintain same request validation and current local auth behavior as single mode.
2. Keep provider stderr hidden from end users.
3. Ensure partial failure does not break surviving stream.
4. Use lock or atomic DB update for acceptance idempotency.
5. Keep safeguards practical for local single-user operation.

## File-Level Work Plan

### New files
1. `server/src/models/ParallelCandidateTurn.js`
2. `server/src/services/parallel-orchestrator.js`
3. `server/src/routes/chat-parallel.js` (or extend `chat.js`)
4. `server/test/parallel-orchestrator.test.js`
5. `server/test/parallel-acceptance.test.js`
6. `client/src/components/ParallelResponsePanel.jsx`
7. `client/src/api/parallelChatApi.js`
8. `client/src/hooks/useParallelChat.js` (optional but recommended)

### Modified files
1. `server/src/routes/chat.js`
2. `server/src/routes/escalations.js` (parallel parse mode)
3. `client/src/components/Chat.jsx`
4. `client/src/hooks/useChat.js`
5. `client/src/App.jsx` (if route split is used)

## Test Plan

### Unit
1. Parallel state transitions.
2. Acceptance idempotency.
3. Candidate expiration behavior.

### Integration
1. Both succeed, accept provider A.
2. Both succeed, accept provider B.
3. One fails, one succeeds.
4. Both fail.
5. Duplicate accept race.

### UX regression
1. Side-by-side stream rendering.
2. Winner commit exactly once.
3. Non-winner excluded from canonical chat transcript.

## Rollout Strategy
Flags:
1. `FEATURE_CHAT_PARALLEL_MODE`
2. `FEATURE_CHAT_PARALLEL_ACCEPT`
3. `FEATURE_PARSE_PARALLEL_MODE` (if parse enabled)

Rollout:
1. Enable locally behind flags.
2. Turn on for chat first, then parse if needed.
3. Keep as opt-in mode by default.

Rollback:
1. Disable parallel flags.
2. Preserve candidate records for audit but hide UI/routes.

## Exit Criteria
1. Parallel opinions stream independently for both providers.
2. User can accept exactly one winner deterministically.
3. Partial provider failure still yields usable output when one provider succeeds.
4. Candidate lifecycle and acceptance are auditable.
5. Cost and concurrency controls are active and tested.
