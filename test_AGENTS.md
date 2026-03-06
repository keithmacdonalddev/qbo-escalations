# AGENTS.md

## Project Agent Rules

### 1) Scope and precedence

- Treat this file as the default instruction set for the whole repository.
- For files under nested directories, a closer `AGENTS.md` overrides conflicting instructions.
- The following nested policy files exist and take precedence in their paths:
  - `prototypes/policy-lab/runner/variants/agents/baseline/AGENTS.md`
  - `prototypes/policy-lab/runner/variants/agents/intent-verified/AGENTS.md`
- Do not assume any instruction here overrides direct user requests.

### 2) Project structure and active stack assumptions

- This repo is a monorepo with separate app layers:
  - `client/` is a Vite + React frontend.
  - `server/` is an Express backend.
  - `playbook/` and `docs/` are non-code content and test fixture-like assets.
- Use commands with explicit package context when touching stack-specific files:
  - `npm --prefix client ...` for frontend changes.
  - `npm --prefix server ...` for backend changes.
  - root commands are orchestration commands only.

### 3) Baseline non-negotiables

- Do not claim completion until changes are confirmed against current disk state.
- Prioritize direct, minimal edits that meet the request.
- Do not make speculative refactors not related to the user task.
- Preserve existing behavior unless the request explicitly asks for broader redesign.

### 4) Prototype handling (Default: isolated mode)

- Build prototypes in `prototypes/<prototype-name>/` as standalone assets.
- Required minimum prototype files:
  - `prototypes/<prototype-name>/index.html`
  - `prototypes/<prototype-name>/styles.css`
  - `prototypes/<prototype-name>/script.js`
- Prototype behavior must not touch production paths by default.
- Do not add prototype code in `client/src/` or `server/src/` unless explicitly requested.
- Treat `prototypes/` files as low-risk experiments, not part of normal review scope.

### 5) If a prototype must be integrated temporarily

- Gate behavior behind explicit feature flags that default to off:
  - Frontend: `VITE_ENABLE_<FEATURE_NAME>_PROTOTYPE`
  - Backend: `ENABLE_<FEATURE_NAME>_PROTOTYPE`
- When prototype flags are off:
  - Do not register routes.
  - Do not render UI branches.
  - Do not start background watchers/jobs.
  - Do not expand normal test or review scope.
- Document every flag in the relevant file where behavior is introduced.

### 6) Development commands and environment context

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
- Environment variables used by server runtime should remain explicit and version controlled via examples:
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
- Server startup must remain database-driven and should fail fast if required runtime settings are missing.

### 7) Testing policy (minimal default)

- Treat tests as emergency-only by default.
- Do not run tests for routine, low-risk edits unless requested.
- If tests are required, run the smallest useful scope once:
  - Single targeted file or related small subset in `server/test` for backend risk.
- In final summaries, always state what was run and why it qualified as emergency.
- If no tests were run, explicitly state that fact.

### 8) Process control safety

- Do not start, restart, stop, kill, or otherwise manage local processes unless the user explicitly asks in the current prompt.
- This includes dev servers, API servers, workers, watchers, and background jobs.

### 9) Safety and data handling

- Preserve input privacy:
  - Do not log secrets, credentials, raw PII, or raw image payloads in user-facing output.
- For AI provider integration paths, preserve subprocess hygiene:
  - Keep command inputs through stdin when piping prompts.
  - Keep process env variable handling explicit and minimal.
  - Clean temporary image files reliably after each operation.
- Do not change CLI provider invocation behavior unless required by the request and ensure error handling still reports meaningful user-facing messages.

### 10) Verification and accuracy discipline

- Before final claims, re-verify from disk in the same turn:
  - `git status --short` for changed paths.
  - `git diff` for exact deltas.
  - `Get-Content` (or equivalent) for line-level proof.
- Do not assert file-state claims from memory.
- Prefer `Get-Content` and targeted file reads for proof because command tooling availability can vary.

### 11) Review-quality constraints

- Prioritize correctness and behavior safety over style micro-optimizations.
- Avoid broad design changes during single-function fixes.
- When ambiguity exists, state assumptions before implementation.
- If you touch production code outside current task scope, call out scope creep explicitly.

### 12) Incident prevention note

- Fresh state reads in each turn are mandatory for any code-state assertion.
- If a claim is changed while reviewing, update it before reporting.

### 13) Communication style

- Be direct and concise.
- Surface tradeoffs and risks explicitly.
- Prefer actionable next steps only when they are directly relevant.

### 14) Optional scoped override files (recommended)

- Add `client/AGENTS.md` for frontend-specific conventions.
- Add `server/AGENTS.md` for API and persistence-specific conventions.
- Do not duplicate this root file; add scope-specific refinements only.
