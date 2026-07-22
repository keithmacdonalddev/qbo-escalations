# Slice — client-surfaces

## Purpose

Stress the browser-facing React application under large datasets, long-lived streams, navigation churn, and render pressure.

## In scope

- `client/src/App.jsx`
- `client/src/api/**`
- `client/src/hooks/**`
- `client/src/components/**`
- `client/src/context/**`
- `client/src/lib/**`
- route-level surfaces for dashboard, chat, workspace, rooms, image parser, gallery, investigations, usage, analytics, and settings
- the CSS/theme files that materially affect render cost or layout stability

## Out of scope

- backend correctness already owned by other slices
- provider or Google stub behavior except as seen through the browser

## Entry points

- app route changes handled in `client/src/App.jsx`
- browser interactions against chat, workspace, rooms, image parser, settings, and dashboard surfaces

## Current harness state

- five QBO Chat V5 journeys cover happy path, parser recovery, unsaved navigation, session resume, and escalation lifecycle handoff
- driven through the real React app with `agent-browser`
- proxied through the hermetic server harness with deterministic provider responses and isolated records
- every command, fixture, session close, client helper, and database cleanup has a bounded terminal path
- cleanup timeout or failure propagates as incomplete evidence; it cannot leave a fixture or slice green
- the happy path compares exact rendered triage and known-issue values before and after reload, as well as the saved API record

## Reliability requirement

- do not count these journeys as trusted until the browser transport completes them repeatedly without unchanged-code failures
- keep structured failure artifacts and an incomplete verdict when the browser tool cannot prove completion

## External dependencies

- browser memory and render timing
- SSE and WebSocket connections
- localStorage and sessionStorage state
- every backend API slice that feeds the UI

## Known shared surfaces

- depends on all backend slices
- dev tools and observability panels overlap with runtime-and-observability
