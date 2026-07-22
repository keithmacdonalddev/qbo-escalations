# Coverage — client-surfaces

## Current status

Implemented but not yet trusted as a required gate.

The slice now defines the five critical QBO Chat V5 journeys:
- deterministic image-intake happy path, exact visible and saved triage/known-issue values, saved route, evidence terminal state, and reload de-duplication
- parser failure with no false downstream completion, reset, and successful retry
- triage persistence failure, visible recovery copy, stay, and explicit leave
- saved-session route return plus hard-reload evidence integrity
- linked escalation handoff, resolved outcome through the real form, reload persistence, and bounded cleanup

Each scenario has an absolute deadline, bounded command and close operations, structured assertions, a success screenshot, and a JSON failure artifact when the browser cannot reach screenshot capture. A fixture and slice are incomplete when session cleanup cannot be proven.

## Contract priorities

- route load and navigation stability
- streaming UI churn
- large list and detail rendering
- image parser and workspace panels
- dev tools and observability overlays

## Known gaps

- the five QBO journeys are structurally implemented but must pass repeatedly before becoming trusted gates
- native browser transport currently times out on the initial `open` command even for a static local known-good page in a disposable session
- no UI data-scale plan yet
