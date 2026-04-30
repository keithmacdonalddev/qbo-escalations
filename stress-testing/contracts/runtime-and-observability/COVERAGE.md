# Coverage — runtime-and-observability

## Current status

Started.

## Contract priorities

- startup and shutdown
- runtime health
- provider health
- usage and traces
- realtime server behavior
- test-runner endpoints

## Known gaps

- no reusable fixture library yet; the current runner still carries inline scenarios
- no realtime browser canary yet
- no startup/shutdown soak scenario yet

## Implemented coverage

- `/api/health` and `/api/runtime/health` during an actively held `/api/chat` request
- `/api/health/providers` catalog and provider-health failure recording after a forced fallback
- `/api/usage/summary`, `/api/usage/by-service`, `/api/usage/recent`, `/api/usage/conversation/:id`, and `/api/usage/models`
- `/api/traces/summary`, `/api/traces/recent`, `/api/traces/:id`, and `/api/traces/conversation/:id`
- `/api/test-runner/groups`, `/api/test-runner/groups/:group/tests`, unknown-group handling, and `/api/test-runner/run` SSE lifecycle validation
