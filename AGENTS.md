# AGENTS.md

## Project Agent Rules

### Prototype Isolation (Default)

- Build prototypes as standalone files in `prototypes/<prototype-name>/`.
- Required minimum files:
  - `prototypes/<prototype-name>/index.html`
  - `prototypes/<prototype-name>/styles.css`
  - `prototypes/<prototype-name>/script.js`
- Do **not** place prototype code in production app paths (`client/src`, `server/src`) unless explicitly requested.

### If Prototype Must Be Integrated Temporarily

- Gate all prototype behavior behind feature flags that are **off by default**.
- Client flag naming: `VITE_ENABLE_<FEATURE_NAME>_PROTOTYPE`
- Server flag naming: `ENABLE_<FEATURE_NAME>_PROTOTYPE`
- When flags are off:
  - No route registration
  - No background jobs/watchers
  - No UI rendering
  - No test/review scope impact for normal code paths

### Review/Test Scope Protection

- Keep prototype files and experiments out of core test/review paths by default.
- Prefer separate branch for prototypes when feasible.

### Process Control Safety (Strict)

- Never start, restart, stop, kill, or otherwise manage server/client processes unless the user explicitly asks for it in the current prompt message.
- This includes app servers, API servers, frontend dev servers, workers, watchers, and local client processes.
- If process control is not explicitly requested, do not perform it.

### Verification and Accuracy Discipline (Strict)

- Do not make status claims (e.g., "fixed", "removed", "not present") from memory, prior outputs, or editor state alone.
- Before any final claim, re-verify directly from disk in the current workspace using:
  - `git diff` (or `git status --short`) for change presence
  - `rg` for symbol/log-string confirmation
  - `Get-Content`/file read for line-level proof when needed
- If new commits or edits may have landed during review, re-run verification commands immediately before responding.
- If uncertainty remains, state uncertainty explicitly and verify again before asserting.

### Incident Note (2026-02-28)

- A stale-state reporting mistake occurred: a debug-log finding was reported after the file had already been updated.
- Preventive rule: all factual code-state assertions must be backed by a fresh on-disk check in the same turn.
