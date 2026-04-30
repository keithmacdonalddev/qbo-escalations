# STATUS — qbo-escalations Stress Testing

## Current verdict

`NOT AT CONFIDENCE`

The harness boot surface is hermetic by default, nine executable slice runners now cover targeted server and browser scenarios, first-pass baseline gates are in place, and the first shared fixture libraries now exist for common harness lifecycle plus chat/workspace/room flows, but broader confidence coverage is still missing.

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

1. **Phase 4**: widen second-wave scenarios and baseline checks carefully as each fixture becomes stable enough to gate on.
2. **Phase 5**: extend harness coverage to broader browser/realtime surfaces beyond the current chat, shipment, and room canaries.
3. **Phase 6**: build operator-facing UI only after the browser artifacts and baseline gates are stable enough to trust.

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
- `client-surfaces` now has real browser canaries for `main-chat`, the workspace shipment tracker, and two-agent room turns, but it does not yet cover workspace streaming, image parser, dashboard, or large-list render pressure in the browser.
- No replay source for traffic-replay shapes.
- Gmail and Calendar replay/redaction strategy still unresolved, but harness mode can now run those routes without live Google credentials.
- Large-data seeding strategy still unresolved.
- No baseline promotion workflow exists yet; today the JSON files in `stress-testing/baselines/` are maintained manually.

## Notes

This file is now the source of truth for the current partial coverage state: runnable harnesses and first-pass baseline gates exist for nine slices, including chat, shipment, and room browser-driven `client-surfaces` canaries, but they do not yet provide broad confidence on their own.
