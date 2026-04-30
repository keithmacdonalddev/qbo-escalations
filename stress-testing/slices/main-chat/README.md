# Slice — main-chat

## Purpose

Stress the primary chat surface: send, retry, conversations, parallel comparison, persistence, and chat-side tool execution.

## In scope

- `server/src/routes/chat/index.js`
- `server/src/routes/chat/send.js`
- `server/src/routes/chat/conversations.js`
- `server/src/routes/chat/parallel.js`
- `server/src/services/chat-orchestrator.js`
- `server/src/services/chat-request-service.js`
- `server/src/services/chat-conversation-service.js`
- `server/src/services/agent-tool-loop.js`
- `server/src/services/shared-agent-tools.js`
- `server/src/models/Conversation.js`
- `server/src/models/ParallelCandidateTurn.js`
- chat client surfaces including `client/src/components/Chat.jsx`, `ChatMiniWidget.jsx`, `client/src/components/chat/*`, and chat hooks under `client/src/hooks/useChat*.js`

## Out of scope

- standalone image parser UI and routes
- workspace assistant and agent sessions
- room orchestration
- Gmail and Calendar direct connector routes

## Entry points

- `/api/chat`
- `/api/chat/retry`
- `/api/chat/parallel/*`
- `/api/conversations/*`

## External dependencies

- provider APIs and CLIs
- MongoDB conversations and parallel candidate turn data
- SSE response streams

## Known shared surfaces

- escalation linking from chat flows
- traces and usage logs
- provider and prompt configuration
- agent identity overlays and shared-agent tools
