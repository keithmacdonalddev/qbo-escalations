# Phase 1 — Repo Alignment and Slice Boundaries

## Goal

Lock the stress-testing scope to the code that actually exists in this repo.

## Why this phase exists

The original draft failed here. If the slice map is wrong, every later metric, contract, and baseline is built on a false system model.

## Acceptance criteria

- [x] `stress-testing/` contains the corrected planning package and starter directories.
- [x] Every active slice has a README in `slices/<slice>/README.md`.
- [x] Every slice README lists:
  - purpose
  - in-scope paths
  - out-of-scope paths
  - entry points
  - external dependencies
  - known shared surfaces
- [x] `slices/README.md` indexes all slices and implementation waves.
- [x] Nonexistent slices from the original draft are explicitly gone from the active plan.

## Work items

1. Inventory real routes, services, models, and client surfaces.
2. Group them into repo-aligned slices.
3. Record the shared surfaces between slices.
4. Mark implementation wave order so the team does not try to build every harness at once.
5. Update `FEEDBACK.md` with the decisions and gotchas.

## Artifacts

- `slices/README.md`
- `slices/*/README.md`
- corrected `README.md`, `PLAN.md`, `FEEDBACK.md`, and `STATUS.md`

## Dependencies

None.

## How to verify done

Open any slice README and confirm a new engineer could name the routes and services that belong in that slice without guessing.

## Non-goals

- no harness code
- no contracts
- no baselines
