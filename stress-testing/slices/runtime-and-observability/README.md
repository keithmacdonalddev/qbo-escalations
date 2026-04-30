# Slice — runtime-and-observability

## Purpose

Stress the runtime scaffolding the rest of the product depends on: startup, health, traces, usage, provider health, realtime, and shared config.

## In scope

- `server/src/index.js`
- `server/src/app.js`
- `server/src/middleware/*`
- `server/src/services/request-runtime.js`
- `server/src/services/ai-runtime.js`
- `server/src/services/ai-traces.js`
- `server/src/services/background-runtime.js`
- `server/src/services/provider-health.js`
- `server/src/services/remote-api-providers.js`
- `server/src/services/realtime-server.js`
- `server/src/services/realtime-channels/**`
- `server/src/services/providers/**`
- `server/src/routes/usage.js`
- `server/src/routes/traces.js`
- `server/src/routes/test-runner.js`
- `server/src/routes/agent-prompts.js`
- `server/src/routes/agent-identities.js`
- `server/src/routes/preferences.js`
- `server/src/models/UsageLog.js`
- `server/src/models/AiTrace.js`
- `server/src/models/AgentIdentity.js`
- `server/src/models/UserPreferences.js`
- dev and observability client surfaces such as `UsageDashboard.jsx`, `TraceDashboard.jsx`, `RequestWaterfall.jsx`, `HealthBanner.jsx`, `HealthToast.jsx`, and AI settings panels

## Out of scope

- business-logic correctness for escalations, chat, workspace, rooms, or Google workflows

## Entry points

- `/api/health`
- `/api/runtime/health`
- `/api/health/providers`
- `/api/usage/*`
- `/api/traces/*`
- `/api/test-runner/*`
- `/api/agent-prompts/*`
- `/api/agent-identities/*`
- `/api/preferences`

## External dependencies

- MongoDB connection lifecycle
- provider APIs and CLIs
- WebSocket server
- prompt and config files on disk

## Known shared surfaces

- every other slice depends on this one for trustable traces, usage, health, or startup behavior
