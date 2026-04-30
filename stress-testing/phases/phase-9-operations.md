# Phase 9 — Operations and Confidence Governance

## Goal

Define how this system stays honest after harnesses exist.

## Why this phase exists

Stress harnesses decay if their baselines go stale, their fixtures stop matching reality, or their validation stops running.

## Acceptance criteria

- [ ] Baseline refresh cadence is documented.
- [ ] Fixture refresh and redaction cadence is documented.
- [ ] Prompt/playbook regression cadence is documented.
- [ ] Harness validation cadence is documented.
- [ ] `STATUS.md` is updated from real reports, not memory.
- [ ] Confidence rescind conditions are explicit.

## Work items

1. Define when burst, soak, and extended-shape baselines are considered stale.
2. Define how fixture sets are refreshed safely.
3. Define what immediately rescinds confidence.
4. Define how confidence is restored after a red run or stale baseline.

## Artifacts

- operational playbooks under `playbook/`
- staleness and status utilities under `scripts/`
- a living `STATUS.md`

## Dependencies

All prior phases.

## How to verify done

Simulate a stale baseline or failed canary and confirm the written process clearly says the repo is no longer at confidence.

## Non-goals

None. This is the steady-state phase.
