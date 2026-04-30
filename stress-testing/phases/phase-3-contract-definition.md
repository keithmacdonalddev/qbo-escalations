# Phase 3 — Contract Model and Fixture Capture

## Goal

Define fixture formats that match this repo's real behavior patterns.

## Why this phase exists

For this repo, correctness is not just "HTTP 200 with expected JSON." It also includes:

- streamed status and chunk ordering
- follow-up action rounds
- DB writes and trace/usage side effects
- file creation and retrieval
- client rendering under changing state

## Acceptance criteria

- [ ] `contracts/README.md` defines the supported contract kinds:
  - `http`
  - `sse`
  - `workflow`
  - `client`
- [ ] Each fixture format supports:
  - seed state
  - action
  - stub profile
  - expected output or transcript
  - invariants
  - source and redaction metadata
- [ ] Every slice has a `contracts/<slice>/COVERAGE.md`.
- [ ] Initial fixture directories exist for every slice.
- [ ] The team has chosen how semantic assertions are represented for AI text and tool-call correctness.

## Work items

1. Write the base fixture schema.
2. Write per-kind guidance for request/response, SSE, workflow, and client fixtures.
3. Decide how to represent expected tool calls, expected provider fallback, and expected side effects.
4. Decide how real data is redacted and traced back to a safe source.
5. Start a first fixture backlog for wave A slices.

## Artifacts

- `contracts/README.md`
- `contracts/<slice>/COVERAGE.md`
- `contracts/<slice>/fixtures/`

## Dependencies

Phase 2.

## How to verify done

Pick one future `workspace-assistant` scenario and one future `image-intake-and-parse` scenario. The team should be able to describe both with the chosen fixture schema without inventing new structure ad hoc.

## Non-goals

- no load generation yet
- no baselines yet
