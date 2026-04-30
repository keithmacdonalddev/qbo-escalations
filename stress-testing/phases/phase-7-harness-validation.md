# Phase 7 — Failure Shapes, Capacity, and Recovery

## Goal

Add the extended shapes that measure capacity and resilience after the core harnesses exist.

## Shapes in scope

- spike
- ramp
- brownout
- chaos
- restart-recovery
- concurrency-race
- boundary
- data-scale
- traffic-replay where safely possible

## Why this phase exists

Core burst and soak harnesses prove baseline correctness and stability. This phase answers where the system actually breaks and how it behaves while breaking.

## Acceptance criteria

- [ ] Each slice has an explicit applicability matrix for the shapes above.
- [ ] Every implemented shape reuses the shared report format and fixture/assertion model.
- [ ] Brownout and chaos scenarios exist for provider-backed and Google-backed slices where meaningful.
- [ ] Restart and recovery scenarios exist for startup/runtime-sensitive slices.
- [ ] Data-scale scenarios exist for persistence-heavy slices once data seeding is repeatable.
- [ ] Deferred shapes are recorded as active confidence gaps, not hidden omissions.

## Work items

1. Define the applicability matrix by slice.
2. Build the highest-value failure shapes first:
   - provider brownout and timeout
   - Google brownout and token-refresh failure
   - SSE interruption and reconnect
   - startup / restart recovery
   - concurrency races on writes
3. Add data-scale and replay only when their prerequisites exist.

## Artifacts

- extended-shape harnesses under the relevant `slices/*/harness/`
- updated baselines for each implemented shape
- reports that call out deferred or blocked shapes explicitly

## Dependencies

Implemented harnesses from phases 4 through 6.

## How to verify done

Inject a known provider slowdown, Google error, or restart event and confirm the corresponding harness fails or passes for the documented reason.

## Non-goals

- no automation policy yet
- no confidence governance yet
