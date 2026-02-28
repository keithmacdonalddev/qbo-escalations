# Phase 2 Master Plan: Provider-Independent Parsing + Validation + Fallback

## Mission
Remove Claude lock-in from parsing so escalation extraction can run with either provider, fail over automatically, and maintain deterministic quality gates before persistence.

Local context note:
1. This app is single-user/local, so parse controls prioritize reliability and clarity over policy overhead.

## Current State (Code-Validated)
1. `POST /api/chat/parse-escalation` uses Claude only.
2. `POST /api/escalations/parse` is Claude-first with regex fallback for text.
3. No provider/mode parse policy contract.
4. No cross-provider parse score model.
5. Parse metadata persisted only minimally in response, not on records.

Validated files:
1. `server/src/routes/chat.js`
2. `server/src/routes/escalations.js`
3. `server/src/services/claude.js`
4. `server/src/lib/escalation-parser.js`
5. `client/src/api/escalationsApi.js`
6. `client/src/components/Chat.jsx`

## Scope

### In Scope
1. Provider-agnostic parse adapters.
2. Parse orchestrator supporting `single`, `fallback`, and optional `parallel`.
3. Strict parse validation and scoring.
4. Deterministic regex terminal fallback policy.
5. Parse provenance metadata response and persistence.
6. UI controls and parse transparency.

### Out of Scope
1. Dev mode provider parity.
2. Co-pilot provider parity.
3. Chat parallel opinion acceptance UX.

## Target Runtime Design

### 1. Parse Adapter Contract
New module: `server/src/services/providers/parse-provider.js`.

Contract:
1. `parseEscalation({ image, text, schema, timeoutMs }) -> { fields, raw, latencyMs, provider }`

Implementations:
1. `server/src/services/providers/claude-parse.js`
2. `server/src/services/providers/codex-parse.js`

### 2. Parse Orchestrator
New module: `server/src/services/parse-orchestrator.js`.

Responsibilities:
1. Run parse by mode.
2. Apply per-attempt timeout.
3. Validate/normalize fields.
4. Decide fallback or winner.
5. Emit complete parse metadata.

Modes:
1. `single`
2. `fallback`
3. `parallel` (feature-flagged)

### 3. Parse Validation Engine
New module: `server/src/lib/parse-validation.js`.

Validation outputs:
1. `passed` boolean
2. `score` (0.0-1.0)
3. `issues[]`
4. `normalizedFields`

Scoring rubric (deterministic):
1. Required/critical fields present.
2. Enum validity (`category`, `triedTestAccount`).
3. Field quality heuristics (length/noise).
4. Structured pattern confidence.

## API Contract Changes

### Endpoint: `POST /api/chat/parse-escalation`
Request:
```json
{
  "image": "optional data url",
  "text": "optional",
  "mode": "single",
  "primaryProvider": "claude",
  "fallbackProvider": "chatgpt-5.3-codex-high",
  "persist": false
}
```

Response:
```json
{
  "ok": true,
  "escalation": { "category": "bank-feeds" },
  "_meta": {
    "mode": "fallback",
    "providerUsed": "chatgpt-5.3-codex-high",
    "fallbackUsed": true,
    "attempts": [],
    "validation": { "passed": true, "score": 0.84, "issues": [] }
  }
}
```

### Endpoint: `POST /api/escalations/parse`
Must support same policy fields and persist parsed record.

Additional behavior:
1. If model parsing fails and text qualifies, regex fallback may be used.
2. If image-only and both models fail, return `422 PARSE_FAILED`.

## Regex Fallback Policy (Terminal)
Use regex only when all are true:
1. Input includes text.
2. `looksLikeEscalation(text)` is true.
3. All model attempts failed execution or validation threshold.

Do not use regex for image-only requests.

## Data Model Changes

### Escalation schema
File: `server/src/models/Escalation.js`

Add `parseMeta` subdocument:
1. `mode`
2. `providerUsed`
3. `fallbackUsed`
4. `fallbackFrom`
5. `winner` (parallel)
6. `validationScore`
7. `attempts[]` (provider, status, code, latencyMs)
8. `usedRegexFallback`

Keep `_meta` response even if `parseMeta` persistence is disabled by flag.

## Frontend Changes

### Parse controls
Files:
1. `client/src/components/Chat.jsx`
2. `client/src/components/EscalationDashboard.jsx`
3. `client/src/api/escalationsApi.js`

Requirements:
1. Mode selector for parse (`single`, `fallback`, optional `parallel`).
2. Provider selection for primary/fallback.
3. Parse result panel showing provider/warnings/confidence.

### Parse transparency
1. Show warning when regex fallback is used.
2. Show confidence score and missing-field notices.

## Security and Reliability
1. Enforce input size caps for image/text payloads.
2. Redact raw model output from user payload unless debug mode.
3. Guarantee temp image file cleanup.
4. Normalize parse outputs before persistence.
5. Keep safeguards lightweight and local-practical.

## File-Level Work Plan

### New files
1. `server/src/services/providers/parse-provider.js`
2. `server/src/services/providers/claude-parse.js`
3. `server/src/services/providers/codex-parse.js`
4. `server/src/services/parse-orchestrator.js`
5. `server/src/lib/parse-validation.js`
6. `server/test/parse-orchestrator.test.js`
7. `server/test/parse-validation.test.js`

### Modified files
1. `server/src/routes/chat.js`
2. `server/src/routes/escalations.js`
3. `server/src/models/Escalation.js`
4. `server/src/services/claude.js` (adapter extraction as needed)
5. `server/src/services/codex.js` (parse support)
6. `client/src/api/escalationsApi.js`
7. `client/src/components/Chat.jsx`
8. `client/src/components/EscalationDashboard.jsx`

## Test Plan

### Unit
1. Field normalization.
2. Validation scoring.
3. Fallback decision matrix.
4. Parallel winner selection determinism.

### Integration
1. Claude parse success.
2. Codex parse success.
3. Claude failure -> Codex success.
4. Codex failure -> Claude success.
5. Both fail with text -> regex success.
6. Both fail image-only -> 422.

### Regression
1. Existing quick-parse endpoint remains stable.
2. Escalation persistence unchanged for legacy callers.

## Rollout Strategy
1. Flags: `FEATURE_PARSE_PROVIDER_PARITY`, `FEATURE_PARSE_PARALLEL_MODE`.
2. Start with `single`, then enable `fallback`.
3. Enable parse `parallel` only if you need side-by-side extraction quality checks.

Rollback:
1. Disable parity flag to revert parse to Claude-first legacy path.
2. Keep parseMeta non-blocking for backward compatibility.

## Exit Criteria
1. Parse endpoints run with either provider.
2. Fallback works bidirectionally.
3. Validation gates prevent low-quality persistence.
4. Regex fallback behavior is explicit and deterministic.
5. Parse metadata is visible and test-covered.
