# Token Usage & Cost Monitoring — Implementation Plan

## Context

The app uses two AI providers (Claude CLI and Codex CLI) for chat, parse, dev mode, and copilot features. Both CLIs output token usage data in their stream-json/JSON responses, but the current code **discards** this data — only extracting text content. There is no visibility into how many tokens each request consumes or what it costs. This plan adds comprehensive, end-to-end token and cost tracking.

---

## Architecture Summary

```
CLI stdout (usage in result msg)
  → claude.js / codex.js extract usage + pass via onDone 2nd param
  → chat-orchestrator / parse-orchestrator thread usage into attempts[]
  → route handlers write UsageLog documents + embed in attemptMeta + SSE
  → /api/usage/* endpoints aggregate UsageLog collection
  → UsageDashboard.jsx renders charts/tables + ChatMessage shows per-msg tokens
```

---

## Phase 1 — Foundation (new files, no breaking changes)

### New: `server/src/lib/pricing.js`
- Pricing table: cost per 1M tokens (input/output) keyed by model ID
- Provider-level fallback rates when model is unknown
- `calculateCost(inputTokens, outputTokens, model, provider)` → `{ inputCostUsd, outputCostUsd, totalCostUsd }`
- Configurable via `PRICING_CONFIG_PATH` env var (optional JSON override)

### New: `server/src/models/UsageLog.js`
Dedicated collection for per-request usage tracking (not embedded in Conversation):

| Field | Type | Purpose |
|-------|------|---------|
| `requestId` | String (indexed) | UUID per request |
| `service` | Enum: chat, parse, dev, copilot | Which feature |
| `provider` | String (indexed) | claude or codex |
| `model` | String | Exact model ID from CLI |
| `inputTokens` | Number | Prompt tokens |
| `outputTokens` | Number | Completion tokens |
| `totalTokens` | Number | Sum |
| `inputCostUsd` | Number | Calculated at write time |
| `outputCostUsd` | Number | Calculated at write time |
| `totalCostUsd` | Number | Calculated at write time |
| `conversationId` | ObjectId ref | Link to conversation |
| `escalationId` | ObjectId ref | Link to escalation (for parse) |
| `category` | String | Escalation category if known |
| `mode` | Enum: single, fallback, parallel | Orchestration mode |
| `attemptIndex` | Number | 0-based attempt within orchestration |
| `status` | Enum: ok, error, timeout | Attempt outcome |
| `latencyMs` | Number | Request duration |
| `expiresAt` | Date (TTL index) | Auto-delete after 90 days (configurable `USAGE_LOG_TTL_DAYS`) |

Compound indexes: `{ createdAt: -1 }`, `{ provider, createdAt: -1 }`, `{ service, createdAt: -1 }`, `{ conversationId, createdAt: -1 }`.

---

## Phase 2 — Provider-Level Usage Extraction

### Modify: `server/src/services/claude.js`
- **chat()**: In the NDJSON parsing loop, when `msg.type === 'result'`, capture `msg.usage.input_tokens`, `msg.usage.output_tokens`, and `msg.model`. Pass as 2nd arg to `onDone(fullResponse, { inputTokens, outputTokens, model })`. Backward-compatible — existing callers ignore the extra arg.
- **parseEscalation()**: After `JSON.parse(stdout)`, extract `usage` and `model` from the result object. Attach as `_usage` on the resolved fields object so `parse-orchestrator` can pick it off.

### Modify: `server/src/services/codex.js`
- **chat()**: Add `extractUsageFromEventLine()` to capture usage from Codex JSON events. Same `onDone(fullResponse, usageMeta)` pattern.
- **parseEscalation()**: Same `_usage` attachment pattern.

---

## Phase 3 — Orchestrator Propagation

### Modify: `server/src/services/chat-orchestrator.js`
- **runAttempt()**: Capture `usageMeta` from `onDone` 2nd param, include `usage` in the finalized result object.
- **toAttempt()**: Add `inputTokens`, `outputTokens`, `model` to attempt objects when usage data exists.
- **startChatOrchestration()**: Thread `usage` through to the route-level `onDone` payload for single/fallback. For parallel, include per-result usage in the `results` array.

### Modify: `server/src/services/parse-orchestrator.js`
- **runParseAttempt()**: Extract `_usage` from provider's resolved parse result, include in attempt result.
- **buildAttemptFromSuccess/Failure()**: Add usage fields to attempt objects.

---

## Phase 4 — Route-Level Persistence

### Modify: `server/src/routes/chat.js`
- Import `UsageLog` and `calculateCost`.
- Generate `requestId` (UUID) at request start.
- In `onDone`: for each attempt with usage data, create a `UsageLog` document (non-blocking `.catch()`).
- Include `usage: { inputTokens, outputTokens, totalCostUsd }` in the SSE `done` event payload.
- Apply same changes to the retry handler's `onDone`.

### Modify: `server/src/routes/escalations.js`
- After `parseWithPolicy()` completes, write `UsageLog` entries with `service: 'parse'` for each attempt.

### Modify: `server/src/routes/dev.js`
- In `runDevAttempt()`: extract usage from CLI result messages (same pattern as claude.js/codex.js).
- After saving the assistant message, write `UsageLog` with `service: 'dev'`.

### Modify: `server/src/routes/copilot.js`
- In `streamClaude()` helper: capture `usageMeta` from `claude.chat()` onDone 2nd param.
- Write `UsageLog` with `service: 'copilot'`.

---

## Phase 5 — Usage Analytics API

### New: `server/src/routes/usage.js`

8 endpoints (pattern mirrors existing `analytics.js`):

| Endpoint | Description |
|----------|-------------|
| `GET /api/usage/summary` | Total requests, tokens, cost for period |
| `GET /api/usage/by-provider` | Breakdown per provider |
| `GET /api/usage/by-service` | Breakdown per service (chat/parse/dev/copilot) |
| `GET /api/usage/trends` | Time-series (daily/weekly/monthly) |
| `GET /api/usage/by-category` | Token usage per escalation category |
| `GET /api/usage/recent` | Paginated recent requests table |
| `GET /api/usage/conversation/:id` | Aggregate usage for one conversation |
| `GET /api/usage/models` | Breakdown per model |

All accept `?dateFrom=&dateTo=` for date filtering. All return `{ ok: true, ... }`.

### Modify: `server/src/app.js`
- Mount: `app.use('/api/usage', require('./routes/usage'));`

---

## Phase 6 — Frontend

### New: `client/src/api/usageApi.js`
- One async function per endpoint, following `analyticsApi.js` pattern.

### New: `client/src/components/UsageDashboard.jsx`
Full monitoring page using existing design system (`stat-card`, `card`, `table` CSS classes):

**Stat Cards Row (6 cards):**
- Total Tokens / Total Cost / Avg Cost/Request / Requests Today / Input:Output Ratio / Top Provider

**Data Cards Grid:**
- Cost Trends (daily bar chart — same visual pattern as Analytics "Daily Trends")
- Provider Comparison (Claude vs Codex side-by-side bars)
- Service Breakdown (chat/parse/dev/copilot proportional bars)
- Category Cost (table, same pattern as "Resolution Time by Category")
- Model Distribution (bar chart)
- Recent Requests (table with provider badge, service, tokens, cost, latency — paginated)

**Controls:**
- Date range picker (dateFrom/dateTo inputs)
- Auto-refresh toggle

### Modify: `client/src/App.jsx`
- Import `UsageDashboard`, add `#/usage` route case in `parseHashRoute()` and `renderView()`.

### Modify: `client/src/components/Sidebar.jsx`
- Add "Usage" nav item with gauge icon, linking to `#/usage`.

### Modify: `client/src/hooks/useChat.js`
- In `onDone` handler, capture `data.usage` and store on the assistant message object.

### Modify: `client/src/hooks/useDevChat.js`
- Same `data.usage` capture.

### Modify: `client/src/components/ChatMessage.jsx`
- Show token count + cost badge on assistant messages when `usage` prop is present.
- Format: `1.2K tokens ($0.0034)` in `--ink-tertiary` color, next to response time.
- Add `formatTokenCount()` helper (1K/1M suffixes).

### Modify: `client/src/App.css`
- Add `.usage-bar-segment`, `.usage-provider-claude`, `.usage-provider-codex`, `.usage-token-badge` classes.

---

## Phase 7 — Tests

### New: `server/test/pricing.test.js`
- `calculateCost()` with known values, fallback hierarchy, edge cases (zero tokens, unknown model)

### New: `server/test/usage-routes.test.js`
- Test all 8 usage endpoints with `supertest` + `mongodb-memory-server`
- Date filtering, empty data, pagination

### Modify: `server/test/chat-orchestrator.test.js`
- Verify usage propagation through `runAttempt` → `toAttempt` → final `onDone`

---

## Files Summary

**New files (7):**
- `server/src/lib/pricing.js`
- `server/src/models/UsageLog.js`
- `server/src/routes/usage.js`
- `client/src/api/usageApi.js`
- `client/src/components/UsageDashboard.jsx`
- `server/test/pricing.test.js`
- `server/test/usage-routes.test.js`

**Modified files (15):**
- `server/src/services/claude.js` — extract usage from stream-json
- `server/src/services/codex.js` — extract usage from JSON events
- `server/src/services/chat-orchestrator.js` — thread usage through attempts
- `server/src/services/parse-orchestrator.js` — thread usage through attempts
- `server/src/routes/chat.js` — write UsageLog, send usage in SSE
- `server/src/routes/escalations.js` — write UsageLog for parse
- `server/src/routes/dev.js` — extract usage, write UsageLog
- `server/src/routes/copilot.js` — capture usage, write UsageLog
- `server/src/app.js` — mount /api/usage routes
- `client/src/App.jsx` — add #/usage route
- `client/src/components/Sidebar.jsx` — add Usage nav item
- `client/src/hooks/useChat.js` — capture usage on messages
- `client/src/hooks/useDevChat.js` — capture usage on messages
- `client/src/components/ChatMessage.jsx` — render token/cost badge
- `client/src/App.css` — usage dashboard styles

---

## Verification

1. Start dev server (`npm run dev`), send a chat message — check MongoDB `usagelogs` collection for a new document with token counts
2. Check browser Network tab — SSE `done` event should include `usage: { inputTokens, outputTokens, totalCostUsd }`
3. Check ChatMessage renders token badge below assistant responses
4. Parse an escalation — verify `usagelogs` entry with `service: 'parse'`
5. Navigate to `#/usage` — verify dashboard loads with stat cards, charts, tables
6. Test date range filtering on dashboard
7. Run `npm test` in server/ — all existing + new tests pass
8. Verify fallback mode creates separate UsageLog entries per attempt
