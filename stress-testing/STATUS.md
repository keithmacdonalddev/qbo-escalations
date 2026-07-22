# STATUS — qbo-escalations Stress Testing

## Current verdict

`NOT AT CONFIDENCE`

The harness boot surface is hermetic by default, nine executable slice runners cover targeted server and browser scenarios, first-pass baseline gates are in place, and the five critical QBO Chat V5 browser journeys are structurally implemented. Broader confidence coverage is still missing.

The complete-check foundation now records per-group and per-slice structured results. A completed assertion or reviewed baseline failure is `failed`; a thrown runner, missing report, tool timeout, connection loss, interruption, unverified cleanup, or missing completion is `incomplete`. The Phase 7 reliability gate is still open: the browser command transport timed out even while opening a static local known-good page in a unique disposable native session, so the five dedicated journeys and five consecutive representative full runs were deliberately not attempted.

## Planning status

- Repo alignment: done
- Slice boundaries: done
- Starter scaffold: done
- Harness environment design: done
- Harness boot implementation: done
- Contract fixtures: started
- Per-slice harness code: started
- Baselines: started

## Active priorities

1. Diagnose and resolve the external native `agent-browser open` transport timeout. The installation passes `agent-browser doctor`, but a bounded static local-file check also timed out before navigation; its disposable session closed successfully and existing sessions were preserved.
2. Complete the five dedicated QBO browser journeys repeatedly, then complete five consecutive representative `verify:full` runs with valid durable evidence.
3. Build the deferred operator-facing UI only after the browser artifacts and baseline gates are stable enough to trust.

## Resolved phase-2 work

- `server/src/index.js` supports library-safe startup instead of auto-booting on import.
- `server/src/lib/startup-controls.js` exposes `resolveStartupControls({ providerWarmup, workspaceScheduler, workspaceMonitor, imageParserStartupCheck, imageParserHealthCheck, imageParserKeysMigration })`.
- Startup noise disabled via env flags (all honored in tests):
  - `DISABLE_PROVIDER_WARMUP`
  - `DISABLE_WORKSPACE_SCHEDULER`
  - `DISABLE_WORKSPACE_MONITOR`
  - `DISABLE_IMAGE_PARSER_STARTUP_CHECK`
  - `DISABLE_IMAGE_PARSER_HEALTHCHECK`
  - `DISABLE_IMAGE_PARSER_KEYS_MIGRATION`
- `DISABLE_RUNTIME_PRUNING=1` gates auto-start pruning in `ai-runtime`, `workspace-runtime`, `background-runtime`, `agent-session-runtime`.
- Harness startup now also disables the Knowledge Base Agent scheduler, AI-management scheduler, and scheduled agent health checks while leaving normal application defaults enabled.
- `server/src/middleware/rate-limit.js` respects `RATE_LIMIT_DISABLED=1`; `routes/room/send.js` now uses that shared middleware.
- `server/src/lib/harness-provider-gate.js` gates `claude`, `codex`, `lm-studio`, remote-API chat providers, and image-parser parse/status entry points behind `HARNESS_PROVIDERS_STUBBED=1`. Real calls throw `MissingProviderStubError` when no stub is registered.
- `server/src/lib/harness-service-gate.js` gates Gmail and Calendar service entry points behind `HARNESS_CONNECTED_SERVICES_STUBBED=1`. Real calls throw `MissingServiceStubError` when no stub is registered.
- `stress-testing/scripts/harness-env.js` enforces Mongo URI hermeticity (`STRESS_MONGODB_URI` preferred, or a URI containing `stress`/`harness`/`mongodb-memory-server`/`127.0.0.1`/`localhost`) and refuses to boot otherwise.
- `stress-testing/scripts/harness-provider-stubs.js` installs deterministic defaults for every gated provider/kind pair.
- `stress-testing/scripts/harness-service-stubs.js` installs deterministic Gmail and Calendar defaults for harness mode.
- `stress-testing/scripts/bootstrap-server.js` wires it all together: `loadServerEnv → applyHarnessEnv → assertSafeMongoUri → installDefaultProviderStubs → installDefaultConnectedServiceStubs → start()`.

## Known gaps

- Shared fixture libraries now exist for common harness lifecycle, chat, workspace sessions, and room orchestration, but escalation-domain, shipment-domain, image-parser, connected-service, and observability scenarios still carry mostly inline fixtures.
- The current baseline files only cover the present 2-6 targeted scenarios per slice; they are not broad slice-level confidence on their own.
- `client-surfaces` now defines the five required QBO journeys: happy path, parser recovery, unsaved-navigation protection, saved-session resume, and escalation lifecycle handoff. Their assertions and fail-safe cleanup contracts are implemented, but they are not yet trusted evidence because native browser transport cannot currently open even a static local known-good page within its hard bound.
- No replay source for traffic-replay shapes.
- Gmail and Calendar replay/redaction strategy still unresolved, but harness mode can now run those routes without live Google credentials.
- Large-data seeding strategy still unresolved.
- No baseline promotion workflow exists yet; today the JSON files in `stress-testing/baselines/` are maintained manually.

## Notes

This file is the source of truth for the current partial coverage state: runnable harnesses and first-pass baseline gates exist for nine slices, and the five QBO client-surface journeys are structurally present, but the browser reliability gate remains open and the suite does not yet provide broad confidence on its own.
