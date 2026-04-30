# Phase 5 — Wave B Harnesses: Main Chat, Workspace Assistant, and Rooms

## Goal

Implement harnesses for the highest-risk streaming AI runtimes:

- `main-chat`
- `workspace-assistant`
- `room-orchestration`

## Why this phase exists

These paths carry the most complex failure modes in the repo:

- SSE streaming
- provider fallback
- tool-call loops
- multi-round workflows
- conversation persistence
- interruption and abort behavior
- multi-agent coordination

## Acceptance criteria

- [ ] Each slice has contract replay coverage that can assert on streamed transcripts, not just final payloads.
- [ ] Each slice has burst coverage focused on concurrency, aborts, and provider fallback.
- [ ] Each slice has soak coverage focused on long-lived sessions, state drift, and memory growth.
- [ ] The harness can assert on:
  - event ordering
  - final persisted conversation/room state
  - traces and usage
  - tool-call summaries
  - interruption / retry / abort behavior
- [ ] At least one deliberately broken scenario per slice is proven to fail the harness.

## Work items

1. Implement SSE capture and transcript assertions.
2. Build fixtures for:
   - normal answer
   - fallback path
   - abort/disconnect
   - tool action loop
   - parallel or multi-agent decision flow
3. Add soak scenarios for long-lived chat/workspace/room sessions.
4. Capture the first baseline candidates only after transcript assertions are trustworthy.

## Artifacts

- `slices/main-chat/harness/*`
- `slices/workspace-assistant/harness/*`
- `slices/room-orchestration/harness/*`
- stream-aware reports

## Dependencies

Phases 2 and 3, plus lessons from phase 4.

## How to verify done

Introduce a regression in event ordering, fallback handling, or abort behavior and confirm the harness fails without needing code inspection to explain why.

## Non-goals

- no Gmail/Calendar/client harnesses yet
- no full automation yet
