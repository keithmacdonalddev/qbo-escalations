# AGENTS.md

> **FOR OPENAI CODEX ONLY** — Claude Code sessions defer to `CLAUDE.md` and root `CLAUDE.md` for authoritative guidance. Content in this file that overlaps with those files applies to Codex only.

## Project Agent Rules

The user is a self-taught / solo hobbyist developer. Explain clearly, warn about risks, suggest next steps.

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

### Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
### Development Commands and Environment

- Root commands:
  - `npm run dev` (client + server concurrently)
  - `npm run dev:client`
  - `npm run dev:server`
  - `npm run build`
  - `npm start`
- Server commands:
  - `npm --prefix server test`
  - `npm --prefix server run dev`
- Client commands:
  - `npm --prefix client run dev`
  - `npm --prefix client run build`
  - `npm --prefix client run preview`
- Server runtime environment variables (keep explicit and version-controlled via `server/.env.example`):
  - `PORT`
  - `MONGODB_URI`
  - `MONGODB_DNS_SERVERS`
  - `CLAUDE_CHAT_TIMEOUT_MS`
  - `PARSE_TIMEOUT_MS`
  - `CLAUDE_IMAGE_HELP_TIMEOUT_MS`
  - `CLAUDE_SUPPORTS_IMAGE_INPUT`
  - `CLAUDE_CHAT_MODEL`
  - `CLAUDE_PARSE_MODEL`
  - `CODEX_CHAT_MODEL`
  - `CODEX_REASONING_EFFORT`
  - `CODEX_CHAT_TIMEOUT_MS`
  - `CODEX_PARSE_MODEL`
  - `CODEX_PARSE_REASONING_EFFORT`
  - `CODEX_PARSE_TIMEOUT_MS`
- Server startup should fail fast if required runtime settings are missing.

### Incident Note (2026-02-28)

- A stale-state reporting mistake occurred: a debug-log finding was reported after the file had already been updated.
- Preventive rule: all factual code-state assertions must be backed by a fresh on-disk check in the same turn.
