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
