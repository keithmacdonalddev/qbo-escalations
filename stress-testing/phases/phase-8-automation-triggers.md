# Phase 8 — Harness Validation and Automation

## Goal

Prove the harness is trustworthy and then automate the right triggers.

## Why this phase exists

Automating an untrusted harness just automates noise. Validation comes first.

## Acceptance criteria

- [ ] Harness validation exists for the implemented slices:
  - mutation or deliberate regression checks where practical
  - canary scenarios
  - flake tracking
  - at least one cross-check path on a high-risk slice
- [ ] Automation exists for the real repo triggers:
  - code changes
  - prompt changes
  - playbook changes
  - dependency changes
  - scheduled sweeps
- [ ] On-demand commands are defined for:
  - single-slice quick check
  - reassurance run across selected slices
  - pre-handoff summary run
- [ ] Reports update a central index under `reports/`.

## Work items

1. Add harness validation for the first completed slices.
2. Decide which changes trigger which slice runs.
3. Build the report index and summary generation.
4. Wire scheduled sweeps only after flake is understood.

## Artifacts

- harness validation utilities under `scripts/`
- automation trigger docs or scripts
- `reports/INDEX.md`

## Dependencies

Working harnesses from earlier phases.

## How to verify done

Introduce a deliberate regression in a slice, trigger the automation path that should catch it, and confirm the report index shows the failure clearly.

## Non-goals

- no baseline refresh policy yet
