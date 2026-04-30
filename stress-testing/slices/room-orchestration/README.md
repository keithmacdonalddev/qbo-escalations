# Slice — room-orchestration

## Purpose

Stress the multi-agent room system: room lifecycle, room memory, realtime streaming, agent coordination, and interruption handling.

## In scope

- `server/src/routes/room/**`
- `server/src/services/chat-room-service.js`
- `server/src/services/room-*.js`
- `server/src/services/room-agents/**`
- `server/src/services/agent-identity-service.js`
- `server/src/models/ChatRoom.js`
- room client surfaces including `client/src/components/ChatRoom.jsx`, `ChatRoom.css`, and `client/src/components/chat-room/*`

## Out of scope

- workspace single-assistant runtime
- main chat conversations
- standalone Gmail and Calendar connector routes

## Entry points

- `/api/rooms/*`
- room realtime channels exposed through the shared realtime server

## External dependencies

- provider APIs and CLIs
- MongoDB room records and memory
- SSE and realtime room events

## Known shared surfaces

- shared-agent tools
- agent identities and profiles
- runtime-and-observability slice for realtime server and health
