# Phase 1 Master Plan: Provider Foundation + Chat Fallback Parity

## Mission
Establish a robust local provider control plane for chat so you can safely run Claude or Codex as primary, with deterministic bidirectional fallback.

This is the foundational phase for all later provider-independence work.

## Current State (Code-Validated)
1. Chat provider selection exists in API and UI.
2. Conversation and assistant message provider are persisted.
3. No explicit chat `mode` contract (`single` vs `fallback`).
4. No fallback orchestration.
5. No provider circuit breaker/health surface.
6. Retry endpoint mirrors single-provider behavior only.

Validated files:
1. `server/src/routes/chat.js`
2. `server/src/services/claude.js`
3. `server/src/services/codex.js`
4. `server/src/models/Conversation.js`
5. `client/src/hooks/useChat.js`
6. `client/src/components/Chat.jsx`

## Scope

### In Scope
1. Provider registry and normalized chat adapter interface.
2. Chat orchestrator implementing `single` and `fallback` modes.
3. SSE event contract extension for fallback visibility.
4. Message-level provenance metadata updates.
5. UI mode controls and fallback UX states.
6. Provider health visibility baseline.

### Out of Scope
1. Parse provider parity.
2. Dev/co-pilot parity.
3. Parallel opinions.

## Target Runtime Design

### 1. Provider Registry
New module: `server/src/services/providers/registry.js`.

Responsibilities:
1. Canonical provider metadata.
2. Capability declaration (`chat: true`, etc.).
3. Default provider resolution.
4. Per-provider timeout defaults.

Canonical IDs:
1. `claude`
2. `chatgpt-5.3-codex-high`

### 2. Chat Adapter Contract
New module: `server/src/services/providers/chat-provider.js` (interface + validators).

Required adapter function:
1. `chat({ messages, systemPrompt, images, timeoutMs, onChunk, onDone, onError }) -> cleanup`

Existing services (`claude.js`, `codex.js`) are wrapped to conform without breaking current internals.

### 3. Chat Orchestrator
New module: `server/src/services/chat-orchestrator.js`.

Responsibilities:
1. Validate mode/provider policy.
2. Execute primary attempt.
3. Trigger fallback for eligible failure classes.
4. Emit normalized stream callbacks.
5. Return final provenance object.

Execution model:
1. `single`: one provider attempt only.
2. `fallback`: primary then alternate on eligible failure.

Fallback-eligible failures:
1. Spawn error.
2. Timeout.
3. Non-zero exit with no usable response.
4. Stream transport failure before `done`.

Non-eligible failures:
1. Client abort.
2. Request validation errors.

## API Contract Changes

### Endpoint: `POST /api/chat`
Request extension:
```json
{
  "message": "...",
  "conversationId": "optional",
  "images": [],
  "mode": "single",
  "primaryProvider": "claude",
  "fallbackProvider": "chatgpt-5.3-codex-high"
}
```

Rules:
1. `mode` default: `single`.
2. If omitted, `primaryProvider` resolves from conversation or default.
3. In `fallback` mode, `fallbackProvider` must differ from primary.

SSE events (canonical):
1. `start` (conversationId, mode, primaryProvider)
2. `chunk` (provider, text)
3. `provider_error` (provider, code, retriable)
4. `fallback` (from, to, reason)
5. `done` (providerUsed, fallbackUsed, fallbackFrom, fullResponse)

### Endpoint: `POST /api/chat/retry`
Must accept same policy fields as `POST /api/chat`.

## Persistence Changes

### Conversation message schema additions
File: `server/src/models/Conversation.js`
1. `messages[].mode` (`single|fallback`).
2. `messages[].fallbackFrom` (nullable provider id).
3. `messages[].attemptMeta` (optional summary object).

Backward compatibility:
1. Missing provider fields interpreted as `claude`.
2. Missing mode interpreted as `single`.

## UI/UX Changes

### Chat controls
File: `client/src/components/Chat.jsx`
1. Provider selector remains.
2. Add mode selector: `Single`, `Fallback`.
3. Conditionally show fallback provider selector when `mode=fallback`.

### Stream presentation
Files:
1. `client/src/hooks/useChat.js`
2. `client/src/api/chatApi.js`
3. `client/src/components/ChatMessage.jsx`

Behavior:
1. Display active provider badge per assistant turn.
2. Show inline fallback notice when provider switches.
3. Preserve fallback provenance in saved messages.

## Reliability Controls

### Provider health state
New module: `server/src/services/provider-health.js`.

Tracks:
1. last success timestamp
2. recent failures
3. open/closed circuit status

### Failure memory policy (lightweight)
Defaults:
1. Track recent failures per provider in memory.
2. Prefer healthy provider in fallback mode.
3. Full circuit-breaker logic is optional if simple failure memory is sufficient.

### Health route
New endpoint:
1. `GET /api/health/providers`

Payload includes:
1. provider status
2. circuit state
3. rolling error counts

## Security and Guardrails
1. Strict provider/mode allowlist validation.
2. Cap images per request and image bytes.
3. Ensure temp files always clean up on close/error/abort.
4. Redact provider stderr in user-visible errors.
5. Keep controls pragmatic for local single-user usage (no auth redesign complexity).

## Observability
Emit per turn:
1. `mode`
2. `requestedPrimaryProvider`
3. `providerUsed`
4. `fallbackUsed`
5. `fallbackReasonCode`
6. `latencyMs`
7. `errorCode` (if failed)

Suggested sink:
1. structured server logs now
2. metrics backend later

## File-Level Work Plan

### New files
1. `server/src/services/providers/registry.js`
2. `server/src/services/providers/chat-provider.js`
3. `server/src/services/chat-orchestrator.js`
4. `server/src/services/provider-health.js`
5. `server/test/chat-orchestrator.test.js`
6. `server/test/chat-fallback-integration.test.js`

### Modified files
1. `server/src/routes/chat.js`
2. `server/src/services/claude.js`
3. `server/src/services/codex.js`
4. `server/src/models/Conversation.js`
5. `server/src/app.js` (health route mount)
6. `client/src/api/chatApi.js`
7. `client/src/hooks/useChat.js`
8. `client/src/components/Chat.jsx`
9. `client/src/components/ChatMessage.jsx`

## Test Plan

### Unit
1. Policy validation and provider normalization.
2. Fallback trigger logic.
3. Circuit-breaker transitions.

### Integration
1. Claude single success.
2. Codex single success.
3. Claude failure -> Codex fallback success.
4. Codex failure -> Claude fallback success.
5. Both fail -> terminal error with attempts summary.
6. Retry endpoint with fallback policy.

### UX regression
1. Provider/mode settings persist locally.
2. Fallback banner renders correctly.
3. Conversation export includes final provider provenance.

## Rollout Strategy
1. Behind `FEATURE_CHAT_PROVIDER_PARITY` and `FEATURE_CHAT_FALLBACK_MODE`.
2. Enable parity first, fallback second.
3. Validate locally with failure injection before treating as default.

Rollback:
1. Disable fallback flag.
2. Disable parity flag to force legacy provider path.

## Exit Criteria
1. Chat works with either provider as primary.
2. Fallback works bidirectionally.
3. Provider provenance is persisted and visible.
4. Health/circuit state exposed and usable.
5. Tests cover happy path and failover path with stable pass rate.
