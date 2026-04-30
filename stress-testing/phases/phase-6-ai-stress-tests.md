# Phase 6 — Wave C Harnesses and AI Regression Coverage

## Goal

Finish coverage of the remaining repo surfaces and add shared AI-regression harnesses that apply across slices.

Targets:

- `connected-services`
- `runtime-and-observability`
- `client-surfaces`
- shared AI regression packs used by `main-chat`, `workspace-assistant`, `room-orchestration`, and AI-dependent flows elsewhere

## Why this phase exists

The remaining slices depend heavily on stubbing, operational controls, and cross-slice reuse. They should be implemented after the harness platform is proven on phases 4 and 5.

## Acceptance criteria

- [ ] `connected-services` has contract and failure-mode coverage for Gmail, Calendar, token refresh, and shipment flows.
- [ ] `runtime-and-observability` has harnesses for health, usage, traces, provider health, and startup/shutdown safety.
- [ ] `client-surfaces` has browser-driven coverage for the most important views and long-lived UI churn scenarios.
- [ ] AI regression packs exist for:
  - golden-set replay
  - tool-call correctness
  - fallback correctness
  - timeout / 429 / malformed-stream handling
  - prompt / playbook change regression
  - hallucination and entity-fabrication checks where applicable

## Work items

1. Build Google and shipment stubs usable by both direct slice harnesses and workspace-triggered flows.
2. Build shared AI regression packs that can be reused across slices instead of copied.
3. Build browser-driven checks for the highest-value client routes.
4. Fold prompt and playbook edits into the regression trigger model.

## Artifacts

- `slices/connected-services/harness/*`
- `slices/runtime-and-observability/harness/*`
- `slices/client-surfaces/harness/*`
- shared AI regression fixtures and scripts

## Dependencies

Phases 2 through 5.

## How to verify done

Change a prompt or playbook entry and confirm the targeted AI regression pack can show whether the behavior changed acceptably or regressively.

## Non-goals

- no full mutation or canary validation yet
- no operational cadence yet
