# Architecture Flows Artifact TODO

## Purpose

Track improvements to `prototypes/qbo-architecture-flows/` so the artifact becomes useful for reasoning, debugging, and planning rather than only being a visual map.

## Current Status

- [x] Prototype isolated under `prototypes/qbo-architecture-flows/`.
- [x] Source-backed JSON model for app surfaces, routes, services, stores, providers, and ops loops.
- [x] Shared workflow selector and search.
- [x] Two view modes: step-by-step reasoning view and system map view.
- [x] Failure and fallback paths are fully modeled for every workflow.
- [x] Source references are clickable or copyable.
- [x] Test coverage and implementation status are modeled per workflow.

## Implementation Slices

### Slice 1 - Make Workflows Easier To Reason About

- [x] Keep the reasoning board as the default view.
- [x] Keep the system map available as a secondary view.
- [x] Add phase grouping for long flows.
- [x] Add visible failure paths.
- [x] Add selected-step highlighting shared between reasoning and map views.
- [x] Add URL state for `flow`, `view`, and `step`.

### Slice 2 - Make The Artifact Useful During Debugging

- [x] Add failure-path model for image parser unavailable, missing provider key, stream failure, INV lookup unavailable, parse success with chat handoff failure, and save success with SSE failure.
- [x] Add active-only / active-plus-neighbors / full-system filters for the system map.
- [x] Add ownership labels per step: client, route, service, store, provider, ops.
- [x] Add expandable step details so the default view stays compact.

### Slice 3 - Make Source Evidence Actionable

- [x] Add copy-to-clipboard behavior for file-reference chips.
- [x] Distinguish primary source files from supporting evidence.
- [x] Show missing or stale source-reference warnings in the UI.
- [x] Add test coverage links per flow when tests exist.

### Slice 4 - Make It Shareable And Reviewable

- [x] Add deep links for selected flow, view mode, and selected step.
- [x] Add Markdown export for the selected flow.
- [x] Add Mermaid export for the selected flow.
- [x] Add PNG export or print-friendly layout.

### Slice 5 - Model Product State

- [x] Add current-state vs desired-state summaries per workflow.
- [x] Add implementation status labels: implemented, partial, planned, risky, needs review.
- [x] Add owner/area labels for the app surface most likely to change.

## Completion Notes

- The prototype now has complete first-pass metadata for every modeled workflow.
- Failure paths are represented for all twelve flows.
- Test coverage chips point to existing files in this checkout.
- Source references are audited through `source-ref-status.json`; the latest audit found no missing paths.
- The remaining improvement category is future refinement, not an incomplete checklist item: deeper per-test assertions, richer failure simulations, and production integration would require separate scope.

## Suggested Priority

1. Phase grouping.
2. Failure paths.
3. Selected-step highlighting across both views.
4. URL deep links.
5. Copyable evidence chips.

These are the highest leverage because they make the artifact easier to read, easier to debug from, and easier to share during review.
