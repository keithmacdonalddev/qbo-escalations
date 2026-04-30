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

- browser/realtime canaries implemented for `main-chat`, the workspace shipment tracker, and two-agent room turns
- driven through the real React app with `agent-browser`
- proxied through the hermetic server harness instead of a live backend

## Immediate next expansion

- workspace browser streaming
- image parser browser flow
- dashboard/settings render churn and navigation stability

## External dependencies

- browser memory and render timing
- SSE and WebSocket connections
- localStorage and sessionStorage state
- every backend API slice that feeds the UI

## Known shared surfaces

- depends on all backend slices
- dev tools and observability panels overlap with runtime-and-observability
