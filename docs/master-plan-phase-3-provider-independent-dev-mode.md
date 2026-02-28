# Phase 3 Master Plan: Full-Service Provider Parity (Dev Mode + Co-pilot)

## Mission
Make non-chat AI services provider-independent so Codex and Claude can each run the full service surface, with fallback resilience when one provider is unavailable.

This phase upgrades Dev Mode and Co-pilot from Claude-first to dual-provider operation.

Local context note:
1. This is a local single-user tool; controls should prevent accidental damage without unnecessary policy complexity.

## Current State (Code-Validated)
1. Dev mode routes spawn Claude directly.
2. Dev mode UI labels and logic are Claude-centric.
3. Co-pilot endpoints call Claude only.
4. No provider/mode controls on `/api/dev/chat` or `/api/copilot/*`.
5. No fallback orchestration for dev/co-pilot services.

Validated files:
1. `server/src/routes/dev.js`
2. `server/src/routes/copilot.js`
3. `server/src/models/DevConversation.js`
4. `client/src/components/DevMode.jsx`
5. `client/src/hooks/useDevChat.js`
6. `client/src/components/CopilotPanel.jsx`

## Scope

### In Scope
1. Provider abstraction for dev and co-pilot services.
2. Bidirectional fallback for dev and co-pilot where safe.
3. Unified provider-agnostic event model.
4. Dev conversation provenance metadata.
5. Co-pilot endpoint provider controls.
6. Tool policy harmonization and safety checks.

### Out of Scope
1. Parallel write-capable dev execution.
2. Automatic merge of conflicting file edits from multiple providers.

## Architecture

### 1. Dev Provider Contract
New interface module: `server/src/services/providers/dev-provider.js`.

Contract:
1. `startDevSession({ message, sessionId, cwd, toolPolicy, timeoutMs, onEvent, onError, onClose }) -> stop`

Adapters:
1. `server/src/services/providers/claude-dev.js`
2. `server/src/services/providers/codex-dev.js`

### 2. Co-pilot Provider Contract
New interface module: `server/src/services/providers/copilot-provider.js`.

Contract:
1. `runCopilotTask({ taskType, prompt, systemPrompt, timeoutMs, onChunk, onDone, onError }) -> cleanup`

Adapters:
1. `server/src/services/providers/claude-copilot.js`
2. `server/src/services/providers/codex-copilot.js`

### 3. Shared Orchestrators
New modules:
1. `server/src/services/dev-orchestrator.js`
2. `server/src/services/copilot-orchestrator.js`

Both implement `single` and `fallback` mode with shared policy validation.

## API Contract Changes

### Endpoint: `POST /api/dev/chat`
Request extension:
```json
{
  "message": "...",
  "conversationId": "optional",
  "sessionId": "optional",
  "mode": "single",
  "primaryProvider": "claude",
  "fallbackProvider": "chatgpt-5.3-codex-high",
  "toolPolicy": "safe"
}
```

SSE canonical events:
1. `start`
2. `session`
3. `text_delta`
4. `tool_call_started`
5. `tool_call_result`
6. `provider_error`
7. `fallback`
8. `done`

### Co-pilot endpoints
Existing endpoints remain but accept provider policy fields:
1. `mode`
2. `primaryProvider`
3. `fallbackProvider`

Alternative optional path:
1. Add generic `POST /api/copilot/run` for task-driven unified handling.

## Data Model Changes

### DevConversation enhancements
File: `server/src/models/DevConversation.js`

Add conversation-level:
1. `provider`
2. `mode`

Add message-level:
1. `provider`
2. `fallbackFrom`
3. `attempt`
4. `errorMeta`

Backward compatibility:
1. Existing docs default `provider="claude"`, `mode="single"` at read-time.

## Frontend Changes

### Dev Mode UI
Files:
1. `client/src/components/DevMode.jsx`
2. `client/src/hooks/useDevChat.js`
3. `client/src/api/devApi.js`

Requirements:
1. Provider selector.
2. Mode selector (`single`, `fallback`).
3. Fallback ribbon with explicit cause.
4. Provider badges for tool and text events.

### Co-pilot UI
Files:
1. `client/src/components/CopilotPanel.jsx`
2. `client/src/api/copilotApi.js`

Requirements:
1. Provider/mode controls.
2. Fallback notice in output stream.
3. Preserve simple defaults for low-friction use.

## Safety and Policy

### Tool policy profiles
`toolPolicy` options:
1. `safe` (default): read-only + non-destructive shell
2. `full`: advanced editing/commands (local power mode)

Enforcement:
1. Must be server-side.
2. Must not trust client-supplied policy without validation.

### Blocking rules
1. Keep path traversal guards on file endpoints.
2. Deny destructive command patterns by default.
3. Log blocked attempts with provider/session metadata.

## Reliability and Observability
Per dev/copilot turn record:
1. provider requested/used
2. mode
3. fallbackUsed and fallback reason
4. latency and completion
5. tool error counts (dev)

Track locally (health endpoint/logs):
1. dev success rate
2. copilot success rate
3. fallback frequency by service

## File-Level Work Plan

### New files
1. `server/src/services/providers/dev-provider.js`
2. `server/src/services/providers/claude-dev.js`
3. `server/src/services/providers/codex-dev.js`
4. `server/src/services/providers/copilot-provider.js`
5. `server/src/services/providers/claude-copilot.js`
6. `server/src/services/providers/codex-copilot.js`
7. `server/src/services/dev-orchestrator.js`
8. `server/src/services/copilot-orchestrator.js`
9. `server/src/lib/dev-event-normalizer.js`
10. `server/test/dev-orchestrator.test.js`
11. `server/test/copilot-orchestrator.test.js`

### Modified files
1. `server/src/routes/dev.js`
2. `server/src/routes/copilot.js`
3. `server/src/models/DevConversation.js`
4. `client/src/api/devApi.js`
5. `client/src/hooks/useDevChat.js`
6. `client/src/components/DevMode.jsx`
7. `client/src/api/copilotApi.js`
8. `client/src/components/CopilotPanel.jsx`

## Test Plan

### Unit
1. Event normalization mapping across providers.
2. Fallback routing decisions.
3. Tool policy enforcement logic.

### Integration
1. Dev single success for each provider.
2. Dev fallback in both directions.
3. Co-pilot single success for each provider.
4. Co-pilot fallback in both directions.
5. Abort behavior during fallback attempt.

### Safety tests
1. Path traversal blocked.
2. Disallowed command blocked in `safe` mode.
3. Policy gating for `full` tool policy.

## Rollout Strategy
Flags:
1. `FEATURE_DEV_PROVIDER_PARITY`
2. `FEATURE_DEV_FALLBACK_MODE`
3. `FEATURE_COPILOT_PROVIDER_PARITY`
4. `FEATURE_COPILOT_FALLBACK_MODE`

Rollout:
1. Enable Dev parity first.
2. Enable Co-pilot parity second.
3. Enable fallback after local stability checks.

Rollback:
1. Disable fallback flags first.
2. Disable parity flags to revert to Claude-only handlers.

## Exit Criteria
1. Dev mode works with either provider in `single` and `fallback`.
2. Co-pilot works with either provider in `single` and `fallback`.
3. Provider provenance is visible in persisted records and UI.
4. Safety policy is enforced consistently regardless of provider.
5. Failure and recovery behavior is test-covered and operationally observable.
