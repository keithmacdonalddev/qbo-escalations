# Contracts — qbo-escalations Stress Testing

Fixture and assertion guidance for this repo.

## Supported contract kinds

### `http`

Single request/response assertions.

Use for:

- escalation CRUD and search
- config and health endpoints
- Gmail and Calendar JSON endpoints

### `sse`

Event-stream transcript assertions.

Use for:

- chat
- workspace assistant
- rooms
- test-runner streams

### `workflow`

Multi-step flows with intermediate assertions and side effects.

Use for:

- image parse followed by escalation creation
- workspace action rounds
- room interruptions and retries
- Google-connected flows with token refresh

### `client`

Browser-driven or render-focused assertions.

Use for:

- route load and render timing
- long-lived UI churn
- SSE/WebSocket client behavior
- large-data rendering

## Base fixture fields

Every fixture should include:

- `id`
- `slice`
- `kind`
- `description`
- `seed`
- `action`
- `stubs`
- `expected`
- `invariants`
- `tags`
- `source`

## Notes for this repo

1. `expected` may be a final JSON payload, an ordered transcript, a set of state deltas, or a combination.
2. AI-heavy fixtures need explicit expectations for:
   - tool calls
   - fallback behavior
   - traces and usage side effects
   - hallucination guards where relevant
3. Real Google or provider-backed fixtures must document how the source data was redacted.
