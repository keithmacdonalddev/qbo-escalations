# AGENTS.md

> **FOR OPENAI CODEX ONLY** — Claude Code sessions defer to `CLAUDE.md` and root `CLAUDE.md` for authoritative guidance. Content in this file that overlaps with those files applies to Codex only.

## Project Agent Rules

The user is a self-taught / solo hobbyist developer. Explain clearly, warn about risks, suggest next steps.

### Parallel Sessions And Worktree Awareness

Multiple chat sessions or coding agents may be working in this repository at the same time. Assume the worktree can change while you are working.

Before editing:
- Check current `git status`.
- Re-read any file immediately before modifying it.
- Do not overwrite, revert, or clean up changes you did not make unless the user explicitly asks.
- If a file has changed unexpectedly, treat it as another session's work and adapt to it.
- If overlapping edits make the task ambiguous or risky, stop and ask the user before proceeding.

Before reporting:
- Base factual code-state claims on fresh on-disk checks from the current turn.
- Mention any relevant concurrent-work risk if it affected the task.

### Product Framing For Codex

- The current QBO escalation workflow is the first domain module of a broader operational intelligence platform.
- Treat QBO escalation, Knowledge, provider harnesses, prompt editing, observability, agents, and workspace features as components serving a coordinated expert-agent system for the user's work and life.
- Keep this explanation order: user goal, product workflow, agent-team responsibility, evidence/memory/validation, then implementation.
- Do not describe implementation machinery, such as database records, KB pages, provider packages, trace logs, or prompt files, as the user's goal.
- When working narrowly, state how the change supports the platform role and what it deliberately does not try to solve.
- Use `PRODUCT_NORTH_STAR.md` as the repo-level product hierarchy when docs or UI labels drift toward treating one feature as the whole product.

### Runtime Ownership And Server Control

- The user owns local runtime control. Do not start, stop, restart, reload, or replace the app server, client dev server, gateway, MongoDB process, or any long-running local service unless the user explicitly asks for that runtime action in the current conversation.
- This includes `npm run dev`, `npm run dev:server`, `npm --prefix server run dev`, `npm start`, `nodemon` restarts, typing `rs`, `Stop-Process`, `taskkill`, killing port owners, or launching hidden/background server processes.
- It is OK to inspect runtime state without changing it: check ports, list process owners, read logs, call health endpoints, and explain what needs to be restarted.
- If a config/code change requires a restart, make the change and tell the user exactly what to restart. Do not perform the restart unless asked.
- If a port conflict such as `EADDRINUSE` occurs, first identify the current port owner and whether it is serving the app. Preserve a healthy live instance by default. Ask before killing or replacing it unless the user has already explicitly said to close that process.
- Test commands may run their own short-lived isolated test servers when that is part of the test runner, but do not leave persistent dev or production services running after verification.

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
