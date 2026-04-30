# FEEDBACK — qbo-escalations Stress Testing

Living handoff file for planning and implementation decisions.

## Rules of use

- Every entry gets a date and status: `active`, `open`, `resolved`, or `superseded`.
- Do not silently replace a decision. Mark the old one `superseded` and record the replacement.
- Use this file for constraints, blockers, and handoff notes. Keep long-form design in the phase files.

---

## Decisions made

### 2026-04-19 — Original draft superseded — `superseded`
The original stress-testing draft was replaced because it assumed repo slices that do not currently exist, including a generic auth/session subsystem and a QuickBooks outbound integration slice. The replacement plan is in `PLAN.md` and the slice docs under `slices/`.

### 2026-04-19 — Slice model now follows repo surfaces — `active`
Stress coverage is split across:

- escalation-domain
- image-intake-and-parse
- main-chat
- workspace-assistant
- room-orchestration
- connected-services
- runtime-and-observability
- client-surfaces

### 2026-04-19 — Existing observability must be reused — `active`
Harness infrastructure must build on the observability the repo already has:

- `/api/runtime/health`
- `/api/health/providers`
- `/api/usage/*`
- `/api/traces/*`
- `/api/test-runner/*`

Do not build a second disconnected metrics universe unless a gap is proven first.

### 2026-04-19 — Hermetic environment is mandatory before baselines — `active`
No latency, throughput, or soak baseline is trusted until the harness can control:

- provider calls
- Gmail and Calendar responses
- shipment lookups
- startup warmups
- schedulers and background monitors

### 2026-04-19 — Event streams need first-class contracts — `active`
JSON request/response fixtures are not sufficient for this repo. Contracts must support:

- SSE transcript assertions
- multi-round action workflows
- persistence assertions
- side-effect assertions

### 2026-04-19 — Prompt and playbook edits are regression triggers — `active`
Behavior-changing changes are not limited to code and dependencies. Prompt edits, playbook edits, and provider-configuration changes must trigger targeted harness runs once automation exists.

---

## Open questions

### 2026-04-19 — Provider stub strategy — `resolved`
Resolved by the pluggable-gate approach in `server/src/lib/harness-provider-gate.js`. When `HARNESS_PROVIDERS_STUBBED=1`, every `claude`/`codex`/`lm-studio`/remote-API provider entry point (`chat`, `parseEscalation`, `transcribeImage`, `warmUp`, `prompt`) checks the registry; a missing stub throws `MissingProviderStubError` with provider+kind metadata instead of making a real call. Deterministic defaults live in `stress-testing/scripts/harness-provider-stubs.js` and can be overridden per-slice by calling `registerProviderStub(provider, kind, impl)` before the test runs.

### 2026-04-19 — Gmail and Calendar fixture sourcing — `open`
Need a redaction and replay strategy for real Google-backed scenarios. Decide whether fixtures are DB-backed, API-response-backed, or both.

### 2026-04-19 — Scaled data generation — `open`
Need a repeatable way to seed large Mongo datasets for escalations, conversations, workspace memory, traces, and usage logs without using production copies directly.

### 2026-04-19 — Client performance harness level — `open`
Need to decide whether client stress coverage starts with browser-driven route loads only or includes scripting for prolonged SSE/UI churn and memory capture.

### 2026-04-19 — Traffic replay viability — `open`
No safe replay source is defined yet for chat, workspace, or rooms. Treat replay as unavailable until capture/redaction is designed explicitly.

---

## Gotchas discovered

### 2026-04-19 — Background jobs will pollute baselines unless controlled — `active`
Server startup currently warms providers, starts the workspace scheduler, starts the workspace monitor, and runs recurring provider health checks. Any harness that boots the app must be able to disable or control these behaviors before collecting baseline data.

### 2026-04-19 — Workspace and rooms are not single-response APIs — `active`
These surfaces stream status, chunks, action rounds, and completion/error events. A harness that only inspects the final payload will miss major correctness failures.

---

## Agent handoff notes

### 2026-04-19 — Planning package corrected and scaffolded — `active`
Completed:

- replaced the repo-misaligned plan
- defined repo-aligned slices
- created starter directories for slices, contracts, baselines, reports, scripts, and playbooks
- added phase docs oriented around real implementation waves

### 2026-04-19 — Phase 2 boot surface landed — `active`
Completed:

- `server/src/index.js` is library-safe (`start({ exitProcess, installSignalHandlers })`)
- `server/src/lib/startup-controls.js` now includes `imageParserKeysMigration`
- `DISABLE_RUNTIME_PRUNING=1` gates auto-start pruning in `ai-runtime`, `workspace-runtime`, `background-runtime`, `agent-session-runtime`
- `routes/room/send.js` unified onto shared `createRateLimiter()` middleware (room burst tests now honor `RATE_LIMIT_DISABLED=1`)
- `server/src/lib/harness-provider-gate.js` + `stress-testing/scripts/harness-provider-stubs.js` give every AI-path provider a gated, stub-or-throw entry point
- `stress-testing/scripts/harness-env.js` enforces Mongo URI hermeticity before boot
- `stress-testing/scripts/bootstrap-server.js` wires the full boot pipeline

Next:

1. Start phase 3 — define fixture schemas for wave A slices.
2. Decide Gmail/Calendar fixture sourcing (still open).
3. Decide scaled data generation strategy (still open).
