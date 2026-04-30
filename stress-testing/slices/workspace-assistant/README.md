# Slice — workspace-assistant

## Purpose

Stress the workspace assistant runtime: action loop, memory, alerts, briefings, auto-actions, and session streaming.

## In scope

- `server/src/routes/workspace/**`
- `server/src/routes/agents.js`
- `server/src/services/workspace-*.js`
- `server/src/services/agent-identity-service.js`
- `server/src/services/shared-agent-tools.js`
- `server/src/services/room-agents/agent-profiles.js`
- `server/src/models/Workspace*.js`
- `server/src/models/AgentIdentity.js`
- workspace client surfaces including `client/src/components/WorkspaceShell.jsx`, `WorkspaceAgentPanel.jsx`, `client/src/components/workspace/*`, and `client/src/hooks/useWorkspace*.js`

## Out of scope

- multi-agent room runtime
- standalone main chat
- standalone Gmail and Calendar connector APIs except where the workspace consumes them

## Entry points

- `/api/workspace/*`
- `/api/agents/sessions*`

## External dependencies

- provider APIs and CLIs
- Gmail and Calendar access via connected-services
- MongoDB workspace collections
- SSE streams
- background scheduler and monitor behavior

## Known shared surfaces

- connected-services slice for Gmail and Calendar
- shipment-domain slice for shipment context and workspace shipment tools
- runtime-and-observability slice for session health, traces, and usage
- agent prompts and identities
