# Observability Review

Review date: 2026-05-17

Scope: static source review of the local checkout. I did not start the app, restart services, connect to MongoDB, or exercise live browser flows. The claims below are based on the files on disk in this repo at review time.

## Platform Role

Observability is the proof layer for the operational intelligence platform. It should help the user and reviewers answer: which user, agent, provider, prompt, workflow, evidence, action, and result were involved?

This is broader than developer logging. Logs and traces should support trust, review, debugging, governance, cost control, provider comparison, prompt review, and agent accountability.

## Plain-English Summary

This app has a strong start for model observability. A durable log is a saved record that survives a terminal closing or server restart. For the main chat and parse flows, the app saves durable `AiTrace` records with request IDs, trace IDs, provider/model choices, fallback attempts, timing, token/cost summaries, image metadata, and a compact timeline of events. It also saves `UsageLog` records for token and cost tracking, and image parser runs are saved in `ImageParseResult`.

The biggest missing piece is a general audit trail. An audit trail means a saved record of who changed what, when they changed it, and what request caused the change. Settings, API keys, Gmail connect/disconnect, preferences, many playbook edits, and some workspace actions are not written to one durable audit log. Some areas have partial history, such as prompt snapshots and agent identity history, but there is no app-wide event ledger.

Request IDs and trace IDs exist, but they are not consistently end-to-end. A request ID is the short handle used to connect one HTTP request to its server work. A trace ID is the saved model-run record. The server creates `X-Request-ID`, and chat/parse traces store it, but the client does not consistently send or capture it, and downstream provider or `llm-gateway` calls do not appear to carry it as an outbound header.

Model activity means the record of what model was called, what provider handled it, whether fallback happened, how long it took, and what it cost. Main chat and parse flows are visible. Copilot, Gmail assistant, workspace, and room-agent flows have useful runtime and usage records, but they do not all get the same durable `AiTrace` timeline.

## What Logs Exist Today

| Area | What exists now | Where | Durable? | What it proves |
| --- | --- | --- | --- | --- |
| Main chat traces | `AiTrace` saves request ID, route, service, conversation, prompt preview, provider/model config, attempts, timing, usage, events, and outcome. | `server/src/models/AiTrace.js:133`, `server/src/services/ai-traces.js:215`, `server/src/routes/chat/send.js:442` | Yes | Which provider/model handled a chat turn, what attempts ran, whether fallback happened, and how the request ended. |
| Parse traces | Parse routes create `AiTrace`, attach attempts/usage, and return `traceId` in the response. | `server/src/routes/chat/parse.js:161`, `server/src/routes/escalations.js:1729` | Yes | Which provider/model parsed an escalation, whether it succeeded, and what conversation/escalation it linked to. |
| Usage/cost logs | `UsageLog` stores request ID, provider, model, tokens, cost, service, status, latency, and conversation/escalation IDs. | `server/src/models/UsageLog.js:16`, `server/src/lib/usage-writer.js:53`, `server/src/routes/usage.js:363` | Yes, with TTL | Token/cost totals where provider usage data is available. |
| Conversation records | Messages save role, content, provider, model, mode, fallback source, trace request ID, attempt metadata, usage, and timestamps. | `server/src/models/Conversation.js:7` | Yes | The user/assistant conversation text and the request ID associated with saved chat messages. |
| Image parser history | Image parser runs save provider/model, prompt ID, image metadata, status, parsed text, timing, token counts, error code/message, and source screenshot archive. | `server/src/models/ImageParseResult.js:5`, `server/src/routes/image-parser.js:64`, `server/src/lib/image-parser-archive.js:61` | Yes | What screenshot parse ran, which parser/model was used, whether it failed, and what text was extracted. |
| Trace monitor UI | Usage dashboard exposes a Trace Monitor with recent traces, detail view, attempts, events, usage, and raw JSON. | `client/src/components/UsageDashboard.jsx:234`, `client/src/components/TraceDashboard.jsx:118` | UI over durable data | Lets the user inspect saved model traces from the browser. |
| Chat trace drawer | Conversation-level trace drawer loads traces for a conversation. | `client/src/components/chat/TraceLogsDrawer.jsx:30` | UI over durable data | Lets the user connect a conversation to its model traces. |
| Image parser UI | Image parser panel shows history, details, parsed text, status, provider/model, elapsed time, and error text. | `client/src/components/ImageParserPanel.jsx:90`, `client/src/hooks/useParserGallery.js:38` | UI over durable data | Lets the user inspect past image parse results. |
| Runtime request health | Active HTTP requests are kept in memory and surfaced through runtime health. | `server/src/services/request-runtime.js:3`, `server/src/app.js:36` | No | What is active or recently counted in this server process only. |
| AI runtime operations | Copilot/Gmail/parse/chat operations keep in-memory phase, provider, prompt preview, chunks, provider errors, and fallback count. | `server/src/services/ai-runtime.js:3`, `server/src/routes/copilot.js:133`, `server/src/routes/gmail.js:505` | No | What model operation is active right now, not what happened last week. |
| Provider health | Provider success/failure is held in an in-memory map and exposed by health route. | `server/src/services/provider-health.js:6`, `server/src/app.js:50` | No | Whether a provider is currently considered unhealthy in this process. |
| Server error pipeline | Recent server errors are kept in an in-memory ring buffer and broadcast. | `server/src/lib/server-error-pipeline.js:13`, `server/src/app.js:81` | No | Recent server errors since this process started. |
| Client network diagnostics | Client tracks request lifecycle, budget state, circuit breaker state, and recent failures in memory; request waterfall can optionally persist completed request rows to localStorage. | `client/src/api/http.js:169`, `client/src/hooks/useRequestWaterfall.js:93` | Mostly no | What the current browser session saw. |
| Workspace activity | `WorkspaceActivity` stores a 7-day activity feed for selected workspace events. | `server/src/models/WorkspaceActivity.js:4` | Yes, short retention | Selected alerts/actions/entities, but not a full audit trail. |
| Workspace action log | Workspace agent tool calls go into an in-memory ring buffer. The file explicitly says it is for live debugging, not auditing. | `server/src/services/workspace-action-log.js:3` | No | Recent workspace tool calls since server start only. |
| Agent identity history | Agent profiles, prompt edits, reviews, harness runs, runtime updates, and activity entries have saved history fields. | `server/src/models/AgentIdentity.js:16`, `server/src/routes/agent-identities.js:68`, `server/src/routes/agent-prompts.js:181` | Yes | Some agent/profile/prompt changes and review history. |
| Prompt/playbook versions | Prompt and playbook edits snapshot old content into version folders before overwrite. | `server/src/routes/agent-prompts.js:51`, `server/src/routes/playbook.js:41` | Yes, file-based | Prior prompt/playbook content, but not a full actor/request audit. |
| Gmail auth records | Connected Gmail accounts and OAuth tokens are stored in `GmailAuth`. | `server/src/models/GmailAuth.js:5`, `server/src/services/gmail.js:171` | Yes | Which Gmail accounts are currently connected and token timestamps. |

## What Logs Are Only Temporary Terminal Output

These are useful while the terminal is open, but they are not enough for later diagnosis:

| Source | Evidence | Risk |
| --- | --- | --- |
| Server fallback error handler | `server/src/app.js:81` logs unhandled API errors before reporting the in-memory pipeline. | Lost after restart unless the same error is also captured in a durable model/image/usage record. |
| Usage writer backpressure/errors | `server/src/lib/usage-writer.js:49` and `server/src/lib/usage-writer.js:121` warn or error to console. | Lost write failures make usage totals harder to trust later. |
| Gmail OAuth success/failure | `server/src/routes/gmail.js:85` logs connected account; `server/src/routes/gmail.js:88` logs callback errors. | No durable "Gmail connected/disconnected/failed" event trail. |
| Image parser verbose logs | `server/src/routes/image-parser.js:22` gates verbose parser logs. | Helpful in development, not a durable product diagnostic. |
| Workspace monitor/action logs | `server/src/services/workspace-monitor.js` and `server/src/services/workspace-action-log.js:3` include live debugging output and buffers. | Useful for current activity, weak for incident review. |
| Client debug logs | `client/src/hooks/useParserGallery.js:44` logs gallery fetch details. | Browser console output is lost for normal users. |

## Durable Logs And Audit Records

The repo has durable operational records, but not one complete audit trail.

| Durable record | Strength | Gap |
| --- | --- | --- |
| `AiTrace` | Strong for chat/parse model requests. | Stores `promptPreview`, not the full prompt or full response. Coverage is uneven outside chat/parse/escalation parse flows. |
| `UsageLog` | Good for token/cost accounting across chat, parse, copilot, workspace, Gmail, briefing, and room agents. | Usage records are not a full execution trace. If provider usage is missing, cost completeness is limited. |
| `ImageParseResult` | Good image parser history with parsed text, model, prompt ID, status, and source screenshot archive. | No actor/request audit for who initiated the parse beyond source fields. |
| `Conversation` | Saves user/assistant content and per-message model metadata. | Does not save the full rendered system/context prompt used for every model call. |
| `WorkspaceActivity` | Useful 7-day feed for selected workspace events. | TTL deletes it after 7 days and it is not a complete audit schema. |
| `AgentIdentity.history` | Useful for agent/profile/prompt/review events. | Actor is usually `'user'` or `'system'`, not a real authenticated user, and request IDs are not attached. |
| Prompt/playbook version files | Good content rollback mechanism. | Version snapshots do not always include actor, request ID, before/after summary, or reason. |
| `GmailAuth`, `ImageParserApiKey`, `UserPreferences` | Save current configuration state. | Current state is not the same as a change history. |

## Auth Events Tracked

There is no general app login/password system in the searched server routes. That means the app cannot prove login failures or password changes because those events do not exist as first-class app behavior in this checkout.

Gmail OAuth is tracked as current connected account state in `GmailAuth`, but connect, disconnect, account switch, refresh-token failure, and OAuth callback failure are not written to a durable audit event log. The relevant routes and services are `server/src/routes/gmail.js:60`, `server/src/routes/gmail.js:93`, `server/src/routes/gmail.js:121`, and `server/src/services/gmail.js:85`.

Agent identity edits have partial actor strings. `server/src/routes/agent-identities.js:34`, `server/src/routes/agent-identities.js:112`, and `server/src/routes/agent-identities.js:124` all pass `actor: 'user'`. That is better than nothing, but it does not identify a real person, browser session, or request ID.

## Model Activity Tracked

Main chat and parse are the strongest paths:

- `server/src/routes/chat/send.js:442` creates a trace for chat.
- `server/src/routes/chat/send.js:1321` saves attempts and usage for successful chat completion.
- `server/src/routes/chat/parse.js:161` creates a trace for parse.
- `server/src/routes/chat/parse.js:279` saves parse attempts and usage.
- `server/src/routes/escalations.js:1729` creates traces for escalation parse operations.

The trace schema captures provider/model attempts, status, latency, error code/message, validation details, tokens, and cost at `server/src/models/AiTrace.js:58`.

Other model-using paths are less complete:

- Copilot routes create in-memory AI operations and usage logs, but do not create `AiTrace` records for every action. Evidence: `server/src/routes/copilot.js:133`, `server/src/routes/copilot.js:220`, and repeated `requestId: randomUUID()` calls.
- Gmail assistant creates in-memory runtime operations and usage logs. Evidence: `server/src/routes/gmail.js:505`, `server/src/routes/gmail.js:551`.
- Workspace and room-agent calls write usage in places, but their execution timelines are mostly in runtime/session state or domain-specific records. Evidence: `server/src/services/workspace-request-helpers.js:342`, `server/src/services/room-orchestrator.js:877`, and `server/src/services/agent-session-runtime.js:3`.

## Health Checks

| Route or UI | What it shows | Limit |
| --- | --- | --- |
| `GET /api/health` | Basic server OK response. | No dependency detail. |
| `GET /api/runtime/health` | Active HTTP request counts and in-process runtime info. | Current process only. |
| `GET /api/health/providers` | In-memory provider health map. | Lost on restart. |
| `GET /api/image-parser/status` | Provider availability for image parsing. | Status check, not historical health. |
| Health banner/toast | Recent client request failures. | Current browser session only. |
| Request waterfall | Client-side request lifecycle, optional localStorage retention. | Not a server audit record. |

## Client-Side Errors Captured

The client has good local diagnostics for failed API calls:

- `client/src/api/http.js:14` defines an in-memory API error listener system.
- `client/src/api/http.js:169` tracks request lifecycle.
- `client/src/api/http.js:497` and `client/src/api/http.js:561` notify listeners for HTTP and network failures.
- `client/src/hooks/useRequestWaterfall.js:93` can persist completed request rows in localStorage.
- `client/src/components/HealthBanner.jsx:59` and `client/src/components/HealthToast.jsx:69` surface recent failures.

What is missing: a durable server-side client error ingest route for browser exceptions, unhandled promise rejections, failed fetches, and UI state errors. `client/src/lib/installRuntimeGuards.js:174` mainly watches development/HMR-style runtime issues and does not provide production-grade client error history.

## Server-Side Errors Captured

The server fallback error handler reports errors to an in-memory server error pipeline:

- `server/src/app.js:81` logs the error.
- `server/src/app.js:87` reports it to the pipeline.
- `server/src/lib/server-error-pipeline.js:13` stores recent errors in an in-memory buffer with a max of 50.

Durable server errors are only captured when a domain flow explicitly saves them, such as `AiTrace` failures, `UsageLog` failed attempts, or `ImageParseResult` failures. A generic route crash that does not happen inside one of those domain flows will not survive a restart as a durable error record.

## Request IDs And Trace IDs

The server has request ID middleware:

- `server/src/middleware/request-id.js:9` reuses inbound `x-request-id` or creates a UUID.
- `server/src/middleware/request-id.js:11` returns it as `X-Request-ID`.
- `server/src/app.js:22` installs that middleware.

The model trace system stores request IDs:

- `server/src/models/AiTrace.js:134` makes `requestId` required and unique.
- `server/src/services/ai-traces.js:232` writes the request ID into a trace.
- `server/src/routes/traces.js:455` returns request IDs in recent trace rows.

The gaps:

- `client/src/api/http.js` tracks local request IDs for UI lifecycle, but it does not consistently attach `X-Request-ID` to outbound requests or store the server's `X-Request-ID` response header.
- `server/src/services/remote-api-providers.js` builds provider HTTP requests, but the reviewed request wrapper does not show outbound `X-Request-ID` propagation to providers or `llm-gateway`.
- Some non-chat model routes create their own random usage request IDs instead of using the incoming HTTP request ID, which makes browser-to-server-to-provider correlation weaker.

## Questions The App Can Answer Now

| Question | Answer today | Evidence path |
| --- | --- | --- |
| Which provider and model answered a main chat turn? | Usually yes. | Trace Monitor, `AiTrace`, `Conversation.messages.provider/modelUsed`. |
| Did fallback happen on a traced chat/parse request? | Usually yes. | `AiTrace.attempts`, trace detail attempts table. |
| How many tokens and how much cost did a model call use? | Yes when provider usage data was available. | `UsageLog`, `AiTrace.usage`, Usage Dashboard. |
| What conversation did a trace belong to? | Yes for traced chat/parse flows. | `AiTrace.conversationId`, Trace Dashboard links. |
| Why did an image parse fail? | Often yes. | `ImageParseResult.errorCode/errorMsg`, image parser history/stats. |
| What text did an image parser extract? | Yes. | `ImageParseResult.parsedText`, image parser detail route. |
| What provider is currently unhealthy? | Yes for the current process. | `/api/health/providers`, provider-health map. |
| What request is active right now? | Yes for the current process. | `/api/runtime/health`, request runtime map. |
| Which Gmail accounts are currently connected? | Yes. | `GmailAuth`, Gmail settings/status routes. |
| What changed in an agent profile or prompt? | Partly. | `AgentIdentity.history`, prompt version snapshots. |

## Questions The App Cannot Answer Reliably Yet

| Question | Why not | Minimum fix | Better fix |
| --- | --- | --- | --- |
| Who changed an API key, provider setting, Gmail account, playbook entry, or preference? | Current state is stored, but there is no app-wide durable audit event with actor, request ID, before/after fields, and result. | Add `AppAuditEvent` model and log config mutations. | Make every write route call one audit helper with redaction, request ID, actor/session, target, before/after summary, and UI links. |
| What exact full prompt was sent to a model? | `AiTrace` stores `promptPreview`; conversations store user/assistant messages, but not every rendered system prompt, retrieved context, tool context, or final provider payload. | Store prompt hash and optional redacted prompt snapshot on trace. | Add policy-controlled prompt/response capture with retention, redaction, and export controls. |
| What exact full response came back from a model? | `AiTrace` stores response character counts and outcomes, while conversation records may contain final assistant text. It does not capture every raw provider response. | Store response hash and final assistant message link. | Store redacted raw response snapshots where useful, plus provider response IDs. |
| Did this client click reach `llm-gateway`, and what did the provider return? | Request ID is not consistently propagated from browser to server to provider/gateway. | Add `X-Request-ID` on client requests and outbound provider/gateway requests. | Capture upstream request IDs, response IDs, provider headers, and trace links in `AiTrace`/`UsageLog`. |
| What browser error happened yesterday? | Client errors are mostly in memory, toast state, or optional localStorage waterfall rows. | Add `/api/client-errors` ingest route and durable `ClientErrorEvent`. | Add a Diagnostics page with client/server error correlation by request ID and route. |
| What server errors happened before the last restart? | Generic server error pipeline is in-memory. | Persist server error events with request ID, route, code, and sanitized stack. | Link server errors to traces, usage rows, audit events, and client-visible incidents. |
| Who made a request? | The repo does not show a real app auth/session actor for normal requests. Many actor fields are hardcoded to `'user'` or `'system'`. | Add a stable local actor/session ID even before full auth. | Add authenticated user/session identity and require it in audit events. |
| How did provider health change over time? | Provider health is an in-memory map. | Persist provider health transitions. | Track provider incidents, attempt samples, recovery time, and affected traces. |
| What did a workspace/agent tool do last week? | Some workspace activity is durable for 7 days, but workspace action logs and agent sessions are in memory. | Persist workspace action events with tool, sanitized params, result, status, duration, and actor. | Connect workspace action events to room/chat traces, attention items, and undo/review queues. |
| Was a login failure or password change attempted? | This checkout does not appear to implement app login/password flows. | If auth is added, log auth success/failure/change events. | Add audit and security review UI for account/auth events. |

## Fix Plans

### Fix Plan 1: Add A Durable App Event Log

Create a central event model, for example `AppAuditEvent`, and a small helper such as `recordAuditEvent()`.

Minimum fields:

- `eventType`
- `actorType`
- `actorId`
- `requestId`
- `traceId`
- `route`
- `targetType`
- `targetId`
- `action`
- `status`
- `summary`
- `metadata`
- `before`
- `after`
- `createdAt`

Redact secrets before save. API keys should record provider, key source, last 4 characters if safe, and whether the key changed, not the key value.

First routes to wire:

- `server/src/routes/image-parser.js` for key updates and key tests.
- `server/src/routes/preferences.js` for default Gmail/calendar and AI assistant defaults.
- `server/src/routes/gmail.js` for OAuth connect, disconnect, callback failure, and account switch.
- `server/src/routes/playbook.js` for category/edge-case create, update, restore, and delete.
- `server/src/routes/agent-prompts.js` for prompt edit and restore.
- `server/src/routes/agent-identities.js` for profile/runtime/review/harness changes.

### Fix Plan 2: Make Request IDs End-To-End

The goal is one ID that connects browser action, server route, trace, usage row, upstream provider/gateway call, and UI error.

Minimum changes:

- Client `apiFetch` generates or reuses a request ID and sends `X-Request-ID`.
- Client stores the returned `X-Request-ID` in the waterfall row.
- Provider and `llm-gateway` calls forward the same `X-Request-ID`.
- Upstream response IDs/headers are saved on traces and usage rows where available.
- Trace Dashboard and Request Waterfall show the same ID and link to each other.

### Fix Plan 3: Normalize Model Trace Coverage

Make `AiTrace` the default for every model operation, not just main chat/parse.

First targets:

- Copilot actions in `server/src/routes/copilot.js`.
- Gmail assistant prompt route in `server/src/routes/gmail.js`.
- Workspace direct/chat action flows in `server/src/routes/workspace/ai.js` and `server/src/services/workspace-action-loop.js`.
- Room-agent calls in `server/src/services/room-orchestrator.js`.

### Fix Plan 4: Add Durable Client And Server Error History

Add durable records for:

- Browser exception
- Unhandled promise rejection
- Failed API call
- Server unhandled route error
- Background job failure
- Provider/gateway failure

Each record should include request ID, route, status/code, sanitized message, component/surface, timestamp, and links to trace/usage/audit records if present.

### Fix Plan 5: Decide Prompt/Response Retention Policy

Do not silently store everything forever. The app should explicitly choose what to keep:

- Always store prompt hash and response hash.
- Store `promptPreview` and `responseChars` as it does now.
- Optionally store redacted prompt/response snapshots for troubleshooting.
- Keep retention short by default.
- Add a UI switch or environment flag for full prompt capture.

## Recommended Client-Visible Paths

| Surface | What to add |
| --- | --- |
| Usage Dashboard / Trace Monitor | Keep as primary model activity view. Add links to related request waterfall row, server errors, audit events, and upstream provider IDs. |
| Settings | Add "Audit history" sections for image parser keys, Gmail accounts, provider defaults, AI assistant defaults, and playbook/prompt changes. |
| Runtime/Diagnostics page | Show `/api/runtime/health`, recent server errors, client errors, provider health transitions, and request ID search. |
| Request Waterfall | Capture server `X-Request-ID`, link to trace detail, show copied troubleshooting bundle. |
| Image Parser Panel | Add a "copy diagnostic summary" action that includes parse result ID, provider/model, prompt ID, status, error code, and source screenshot link. |
| Agent Mission Control | Keep profile/prompt history, but add request IDs and real actor/session labels. |
| Attention Center | Surface failed background jobs, failed provider attempts, and audit-worthy config changes as reviewable items. |

## Prioritized Fix Plan

1. Add durable `AppAuditEvent` and wire the highest-risk write routes: image parser API keys, Gmail connect/disconnect, preferences, playbook, prompt edits, and agent identity changes.
2. Propagate `X-Request-ID` from client to server to providers/`llm-gateway`, and store upstream IDs on traces/usage rows.
3. Expand `AiTrace` coverage to copilot, Gmail assistant, workspace, and room-agent model calls.
4. Persist generic server errors and browser errors with request IDs and UI links.
5. Add provider health history instead of only current in-memory provider health.
6. Persist workspace/agent action events that are currently ring buffers or short-lived sessions.
7. Add a troubleshooting export that bundles trace, usage, audit event, client error, server error, and request waterfall data by request ID.

## Verification Checklist

Static checks completed:

- Confirmed no existing root `OBSERVABILITY_REVIEW.md` before writing this file.
- Ran the skill evidence collector in read-only mode.
- Reviewed server request ID, runtime health, server error pipeline, trace, usage, image parser, Gmail auth, preferences, playbook, prompt, workspace, and agent identity source files.
- Reviewed client trace, usage, image parser, request waterfall, health banner/toast, and API request tracking source files.

Live checks not performed:

- I did not run `npm run dev`.
- I did not call live endpoints.
- I did not inspect real MongoDB collections.
- I did not run browser automation against the app.

Suggested live verification when requested:

- Start the app with `npm run dev`.
- Make one chat request and confirm the response includes `requestId` and `traceId`.
- Open `#/usage?tab=traces` and verify the trace detail shows attempts, events, usage, and raw JSON.
- Run one image parse and confirm it appears in image parser history with provider/model/status.
- Trigger one controlled API error and verify whether it appears only in the runtime error buffer or in a durable record.
- Change one image parser API key or preference after an audit-log implementation and verify the event has actor, route, request ID, before/after summary, and redacted metadata.
