# Slices — qbo-escalations Stress Testing

Current repo-aligned slice index.

| Slice | Wave | Summary |
|---|---|---|
| `escalation-domain` | A | escalation CRUD, search, knowledge, investigations, templates, playbook-backed workflows |
| `shipment-domain` | A | shipment CRUD, carrier detection, email scanning, context injection, workspace shipment tools |
| `image-intake-and-parse` | A | uploads, screenshot parsing, image parser history, archive, provider fallback |
| `main-chat` | B | chat send/retry, conversations, parallel decisions, chat-side tool loops |
| `workspace-assistant` | B | workspace action loop, memory, briefings, alerts, auto-actions, agent sessions |
| `room-orchestration` | B | multi-agent room runtime, realtime events, room memory, room agents |
| `connected-services` | C | Gmail, Calendar, OAuth-backed connected service flows |
| `runtime-and-observability` | C | health, traces, usage, provider/runtime health, startup/shutdown, shared config |
| `client-surfaces` | C | React shells, route transitions, SSE/WebSocket client behavior, UI churn |

Read the per-slice README before assigning harness ownership.
