# Phase 4 — Wave A Harnesses: Escalation Domain and Image Intake

## Goal

Implement the first production harnesses on the least ambiguous but still high-value slices:

- `escalation-domain`
- `image-intake-and-parse`

## Why this phase exists

These slices exercise persistence, parsing, uploads, provider fallback, and file handling without immediately taking on the full complexity of long-lived workspace and room action loops.

## Acceptance criteria

- [ ] `escalation-domain` has:
  - contract replay harness
  - burst harness
  - soak harness
- [ ] `image-intake-and-parse` has:
  - contract replay harness
  - burst harness
  - soak harness
- [ ] Harnesses assert both correctness and operational signals:
  - route results
  - DB state
  - trace records
  - usage records when applicable
  - file-system side effects when applicable
- [ ] Reports are generated in a consistent format.
- [ ] Initial baselines exist only after repeatable harness runs in the controlled environment.

## Work items

1. Build the first reusable harness runner on these slices.
2. Capture the first real fixture set for create/update/search/knowledge/image parse/upload/archive flows.
3. Implement report generation against real assertions instead of placeholder prose.
4. Collect early calibration data, but do not lock long-term baselines until environment noise is understood.

## Artifacts

- `slices/escalation-domain/harness/*`
- `slices/image-intake-and-parse/harness/*`
- first reports under `reports/`
- initial baseline files once justified

## Dependencies

Phases 2 and 3.

## How to verify done

The team can deliberately break an escalation write or image parse invariant and see a harness report fail for the correct reason.

## Non-goals

- no workspace or room harnesses yet
- no repo-wide automation yet
