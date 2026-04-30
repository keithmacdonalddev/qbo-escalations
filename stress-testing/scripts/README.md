# Scripts — qbo-escalations Stress Testing

Shared harness code belongs here.

## Implemented

### `fixtures/`
Shared scenario libraries for the current slice runners. Covers:
- `fixtures/common.js` — sample data constants plus `runWithHarness(context, execute)` for the common harness lifecycle
- `fixtures/chat.js` — shared chat stub factories, `/api/chat` + `/api/chat/retry` SSE helpers, and conversation persistence waits
- `fixtures/workspace.js` — shared workspace session creation and status polling
- `fixtures/rooms.js` — shared room creation, `/api/rooms/:id/send` SSE helpers, and room persistence waits

### `harness-env.js`
Applies the stable harness env profile and refuses to boot against non-hermetic infrastructure.

Defaults:
- disables provider warmup
- disables workspace scheduler
- disables workspace monitor
- disables image-parser startup check
- disables image-parser periodic health check
- disables image-parser keys migration
- disables runtime pruning intervals (`ai-runtime`, `workspace-runtime`, `background-runtime`, `agent-session-runtime`)
- disables rate limiting
- enables provider-call gating (`HARNESS_PROVIDERS_STUBBED=1`)
- enables connected-service gating (`HARNESS_CONNECTED_SERVICES_STUBBED=1`)
- defaults harness boot to `127.0.0.1` on an ephemeral port

Exports:
- `DEFAULT_HARNESS_ENV` — frozen env profile
- `buildHarnessEnv(overrides)` — merged profile
- `applyHarnessEnv(env, overrides)` — writes defaults into any `undefined` keys on the target env
- `isUriSafe(uri)` — true if URI contains a hermetic marker (`stress`, `harness`, `mongodb-memory-server`, `127.0.0.1`, `localhost`)
- `assertSafeMongoUri(env, { allowOverride })` — throws if the configured Mongo URI looks like production and promotes `STRESS_MONGODB_URI` to `MONGODB_URI` on success
- `resolveHarnessMongoUri(env)` — returns `STRESS_MONGODB_URI` if set, else `MONGODB_URI`
- `loadServerEnv(env)` — parses `server/.env` directly so the URI guard can inspect what the server would have loaded even when `dotenv` only exists under `server/node_modules`

### `bootstrap-server.js`
Starts the real server entrypoint with the harness env profile applied, the URI guard run, and default provider plus connected-service stubs installed.

Order of operations:
1. `loadServerEnv` — reads `server/.env` so the URI guard sees the real target
2. `applyHarnessEnv` — applies defaults to any missing keys
3. `assertSafeMongoUri` — fails fast on a non-hermetic URI
4. `installDefaultProviderStubs` — registers deterministic stubs unless `HARNESS_PROVIDERS_NO_DEFAULT_STUBS=1`
5. `installDefaultConnectedServiceStubs` — registers deterministic Gmail and Calendar stubs unless `HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS=1`
6. `start({ exitProcess: true, installSignalHandlers: true })`

### `harness-provider-stubs.js`
Deterministic default stubs for every provider+kind gated by `server/src/lib/harness-provider-gate.js`. Covers:
- chat: claude, codex, lm-studio, anthropic, llm-gateway, openai, gemini, kimi
- parseEscalation, transcribeImage, warmUp: claude, codex, lm-studio
- parseImage: llm-gateway, lm-studio, anthropic, openai, gemini, kimi
- validateRemoteProvider: llm-gateway, anthropic, openai, gemini, kimi
- providerAvailability: lm-studio
- prompt: claude

Replace any stub per-slice by calling `registerProviderStub(provider, kind, impl)` after `installDefaultProviderStubs()`.

### `harness-service-stubs.js`
Deterministic default stubs for connected services gated by `server/src/lib/harness-service-gate.js`. Covers:
- Gmail auth, inbox, labels, drafts, send/modify flows, filters, unified inbox, and subscriptions
- Calendar list/get/create/update/delete/freebusy flows

Replace any stub per-slice by calling `registerServiceStub(service, kind, impl)` after `installDefaultConnectedServiceStubs()`.

### `harness-runner-utils.js`
Shared execution helpers for the slice runners. Covers:
- in-process harness boot via `start({ host:'127.0.0.1', port:0 })`
- deterministic stub reset before each slice
- JSON and SSE request helpers
- polling helpers for async persistence
- JSON report writing to `stress-testing/reports/<slice>/`
- baseline attachment from `stress-testing/baselines/<slice>.json`
- direct trace and usage summaries for slice reports

### `agent-browser-utils.js`
Shared browser-driver helpers for `client-surfaces`. Covers:
- starting a Vite client dev server pointed at the hermetic test server via `VITE_PROXY_TARGET`
- running `agent-browser` commands under isolated browser sessions
- running deterministic `agent-browser batch` scenarios inside one live browser session
- command-level timeout and cleanup handling for browser subprocesses
- interactive snapshots and `@eN` ref lookup helpers
- browser `wait`, `eval`, screenshot, and session cleanup helpers

### `report-baselines.js`
Shared baseline comparison helpers. Covers:
- dotted-path and array-path lookups into slice reports
- regression checks (`equals`, `equalsPath`, `oneOf`, `min`, `max`, `lengthMin`, `includes`, `truthy`)
- loading `stress-testing/baselines/<slice>.json`
- attaching per-check results to `report.baselineComparison`

### `runner-registry.js`
Registry for the implemented slice runners:
- `escalation-domain`
- `shipment-domain`
- `image-intake-and-parse`
- `main-chat`
- `workspace-assistant`
- `room-orchestration`
- `connected-services`
- `runtime-and-observability`
- `client-surfaces`

### `run-slices.js`
Top-level runner entrypoint.

Examples:
- `node stress-testing/scripts/run-slices.js`
- `node stress-testing/scripts/run-slices.js main-chat workspace-assistant`
- `node stress-testing/scripts/run-slices.js --list`

Behavior:
- exits non-zero when a runner throws
- also exits non-zero when a completed report has `ok: false`, including baseline regressions

## Environment flags

| Flag | Purpose |
|---|---|
| `STRESS_MONGODB_URI` | Explicit hermetic URI. Preferred over `MONGODB_URI`. |
| `STRESS_MONGODB_UNSAFE_ALLOW=1` | Bypass the URI guard. Do not use unless intentionally pointing at a disposable prod-shaped cluster. |
| `DISABLE_PROVIDER_WARMUP=1` | Skip `claude`/`codex` warmUp calls at boot. |
| `DISABLE_WORKSPACE_SCHEDULER=1` | Skip `startBriefingScheduler()`. |
| `DISABLE_WORKSPACE_MONITOR=1` | Skip `startWorkspaceMonitor()`. |
| `DISABLE_IMAGE_PARSER_STARTUP_CHECK=1` | Skip the one-time provider availability probe. |
| `DISABLE_IMAGE_PARSER_HEALTHCHECK=1` | Skip the 5-minute provider probe interval. |
| `DISABLE_IMAGE_PARSER_KEYS_MIGRATION=1` | Skip the JSON→Mongo key migration on boot. |
| `DISABLE_RUNTIME_PRUNING=1` | Skip auto-start of in-memory prune intervals. |
| `RATE_LIMIT_DISABLED=1` | Short-circuit the shared `createRateLimiter()` middleware. |
| `HARNESS_PROVIDERS_STUBBED=1` | Gate every provider call through the stub registry. Real calls throw `MissingProviderStubError`. |
| `HARNESS_PROVIDERS_NO_DEFAULT_STUBS=1` | Do not install default stubs in `bootstrap-server.js`. Used when a harness wants to install its own stubs before booting. |
| `HARNESS_CONNECTED_SERVICES_STUBBED=1` | Gate Gmail and Calendar service calls through the connected-service stub registry. Real calls throw `MissingServiceStubError`. |
| `HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS=1` | Do not install default Gmail/Calendar stubs in `bootstrap-server.js`. Used when a harness wants custom connected-service fixtures. |

## Still planned

- broader fixture libraries for connected services, image-parser, and runtime/report scenarios
- baseline promotion/update automation
- traffic replay adapters
- validation and automation utilities

## Reuse targets

Before building new plumbing, prefer integrating with:

- `server/src/routes/test-runner.js`
- `server/src/services/test-runner.js`
- `server/src/routes/usage.js`
- `server/src/routes/traces.js`
- `server/src/app.js`
- `server/src/index.js`

## Rule

If a new script duplicates functionality already exposed by the repo, document why the existing surface was insufficient.

## Tests

Root verification now includes these harness-script tests through `npm test` in the repo root.

- `scripts/test/harness-env.test.js` — asserts URI guard rejects Atlas-shaped URIs, promotes the chosen URI correctly, and loads server-style env files without `dotenv`.
- `scripts/test/harness-provider-stubs.test.js` — asserts the default parse stub satisfies the provider contract and the default registrations cover image-parser paths.
- `scripts/test/harness-service-stubs.test.js` — asserts the default Gmail and Calendar registrations install deterministic connected-service stubs.
- `scripts/test/report-baselines.test.js` — asserts baseline path parsing and comparison behavior for the slice report checks.
- `server/test/harness-provider-gate.test.js` — asserts the stub registry + `MissingProviderStubError` contract.
- `server/test/harness-service-gate.test.js` — asserts the connected-service stub registry + `MissingServiceStubError` contract.
- `server/test/startup-controls.test.js` — asserts env flags flip every startup control, including the new `imageParserKeysMigration`.
- `server/test/image-parser-harness.test.js` — asserts `parseImage`, `validateRemoteProvider`, and `checkProviderAvailability` stay hermetic under harness mode.
- `server/test/connected-services-harness.test.js` — asserts Gmail and Calendar routes stay hermetic under harness mode and return deterministic stubbed data.

## Runner outputs

The current slice runners emit:
- `stress-testing/reports/image-intake-and-parse/latest.json`
- `stress-testing/reports/escalation-domain/latest.json`
- `stress-testing/reports/shipment-domain/latest.json`
- `stress-testing/reports/main-chat/latest.json`
- `stress-testing/reports/workspace-assistant/latest.json`
- `stress-testing/reports/room-orchestration/latest.json`
- `stress-testing/reports/connected-services/latest.json`
- `stress-testing/reports/runtime-and-observability/latest.json`
- `stress-testing/reports/client-surfaces/latest.json`

Each report now also carries `baselineComparison`, which reflects the corresponding file in `stress-testing/baselines/` when present.
Generated JSON reports and browser artifact directories are ignored by Git; baseline files remain tracked.

The current nine runners each emit multiple fixtures per run:
- success/happy-path coverage
- request validation failures
- targeted service/provider failure coverage where appropriate
- one small load or replay/persistence scenario
- for `client-surfaces`, real browser canaries for `main-chat`, the workspace shipment tracker, and two-agent room turns driven by `agent-browser batch`
