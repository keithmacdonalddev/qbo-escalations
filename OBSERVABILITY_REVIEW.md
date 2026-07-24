# Observability Review

Static review of `C:\Projects\qbo-escalations` completed 2026-07-09 and refreshed for AI Management and Connected Accounts on 2026-07-21. The evidence collector ran again in read-only mode on 2026-07-23 UTC while the development-startup experience was reviewed. No application server, client server, gateway, model server, database process, or other long-running service was started or changed by that review.

## 1. Plain-English summary

The app can already prove a useful amount about chat and image-parser work. It stores AI traces with a request ID, provider and model, success or failure, fallback attempts, timing, image metadata, validation results, and usage/cost fields when the provider supplies them. It also stores provider-call evidence, usage records, image-parse history, and provider-health history. The user can see much of this through Usage > AI Traces, Sessions, Image Parser history, the request waterfall, workflow log panels, and health banners.

The 2026-07-21 settings update adds a smaller but important evidence path. AI Management now saves the automatic-check schedule, last/next check times, provider-connection results, genuinely-new model alerts, overdue official-review alerts, and whether each alert was reviewed. Connected Accounts now saves the last successful Gmail and Calendar API access for each Google account and translates the granted Google permissions into plain-English status. These records survive a terminal close, but they are operational state—not a complete actor-aware Audit Trail.

The 2026-07-23 development launcher makes the current startup easier to understand. It checks required ports before starting, waits for the API before starting Vite, translates expected restarts into one plain-English message, and stops only the process trees it started. This prevents common duplicate-process and startup-order confusion, but the output is still temporary: it does not save a durable incident record or historical process-owner snapshot.

The app cannot yet prove, in one reliable place:

- who changed a setting, API key, connected account, or most prompt/configuration values;
- that one browser action can always be followed from the client through the server into the exact provider-call package;
- the exact full assembled prompt and response for every model call, with a clear reason when capture is unavailable;
- what client and server errors happened after the process restarted; or
- what the whole local runtime layout looked like at a past moment, including orphan processes and separate gateway/model-server state.

Definitions: a durable log survives after the terminal closes; an audit trail is a durable record of who did what and when; a request ID is one label used to find the evidence for a single request; a provider is the outside AI service, CLI, gateway, or local model server that handled a model call.

The most important next fix is to make the existing evidence joinable and durable: carry one trace/request identity into provider-call records, then add durable audit and error records that the client can display. This is a hardening and product-surface task, not a greenfield logging rebuild.

## 2. What logs exist today

| Area                            | Current evidence                                                                                                                                                    | Where found                                                                                                                   | Durable or temporary                                                                                               | What it proves                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Server startup and route errors | Many `console.log`, `console.warn`, and `console.error` calls; Express error handler reports errors to the server error pipeline                                    | `server/src/index.js`, `server/src/app.js`, route/service files                                                               | Mostly temporary terminal output                                                                                   | What a running process printed, plus the current in-memory server error buffer |
| Development startup             | Friendly port preflight, API-before-client readiness, concise restart/proxy explanations, and launcher-owned process-tree cleanup                                  | `scripts/dev-launcher.js`, `server/nodemon.json`, `client/vite.config.js`                                                      | Temporary terminal output                                                                                          | Why the current development run started, reused an existing stack, stopped safely, or refused to start             |
| Request tracking                | Every Express request receives or generates `req.requestId`; the response includes `X-Request-ID`                                                                   | `server/src/middleware/request-id.js:4-13`, `server/src/app.js:32-35`                                                         | Request ID itself is durable only when copied into another record                                                  | A server-side label for following a request                                    |
| AI chat and parse traces        | Mongo-backed `AiTrace` records include request ID, route, status, prompt preview, providers/models, attempts, fallbacks, timings, usage, outcomes, and stage events | `server/src/models/AiTrace.js:134-169`, `server/src/services/ai-traces.js:216-247`, `server/src/routes/traces.js`             | Durable MongoDB records                                                                                            | What the app believes happened during chat and parse operations                |
| Provider-call evidence          | Provider-specific request/response, CLI stdout/stderr/events, errors, timing, gateway request ID, and redaction metadata can be captured                            | `server/src/models/ProviderCallPackage.js:462-507`, `server/src/services/provider-call-package-recorder.js:1201-1240`         | Durable MongoDB plus possible files under `server/data/provider-call-packages`; default Mongo retention is 30 days | Detailed forensic evidence for captured provider calls                         |
| Usage and cost                  | Provider, model, request ID, attempt, tokens, calculated cost, status, and latency                                                                                  | `server/src/models/UsageLog.js:17-68`, `server/src/lib/usage-writer.js`                                                       | Durable MongoDB with a default 365-day TTL                                                                         | Usage and cost accounting when usage/rates are available                       |
| Image-parser history            | Provider/model, requested model, fallback, prompt ID, image sizes, parse output, validation, errors, provider trace/package reference, and source image metadata    | `server/src/models/ImageParseResult.js:14-87`, `server/src/routes/image-parser.js:503-662`                                    | Durable MongoDB with a default 90-day TTL; source images are archived separately                                   | Why a stored image parse succeeded, failed, or used a fallback                 |
| Provider-health history         | Provider readiness/canary snapshots, status, diagnostics, latency, usage, fallback attempts, and provider errors                                                    | `server/src/lib/provider-health-log-store.js:10-143`, `server/src/routes/agent-identities.js:292-317`                         | JSONL file, path controlled by `PROVIDER_HEALTH_LOG_PATH`                                                          | Historical provider-health checks                                              |
| Knowledge governance history    | Knowledge-candidate audit events for publish, unpublish, edits, and related governance actions                                                                      | `server/src/services/knowledgebase-management-service.js:256-268` and its audit-event call sites                              | Durable inside the knowledge record                                                                                | Governance history for the knowledge feature, not a platform-wide audit trail  |
| Prompt history                  | Prompt versions and some agent history exist; prompt restore/edit actions record `actor: 'user'` in agent history                                                   | `server/src/routes/agent-prompts.js`, `server/src/lib/agent-prompt-store.js`, `server/src/services/agent-identity-service.js` | Durable files/history, but not a unified audit record                                                              | Some prompt version history and a limited action description                   |
| AI catalog checks and alerts    | Schedule, last/next checks, connection-test results, new-model/overdue-review alerts, and review timestamps                                                         | `server/src/services/ai-management.js`, `server/src/services/ai-management-scheduler.js`                                    | Durable local JSON in `server/data/ai-management.json`                                                            | What was found, what needs review, and whether the operator reviewed it        |
| Google account access health   | Last successful Gmail and Calendar access plus granted/missing permission summaries per connected account                                                           | `server/src/models/GmailAuth.js`, `server/src/services/gmail.js`, `server/src/services/calendar.js`                         | Durable MongoDB metadata; OAuth token fields remain hidden by default                                             | Whether each account recently worked and whether required Google access exists |

## 3. What logs are only temporary terminal output

- Most server diagnostics are direct console output. This includes Gmail OAuth errors, provider warm-up messages, scheduler messages, CLI availability messages, route-specific failures, and many service errors.
- The friendly development-launcher summary is also terminal-only. Its current port/readiness decisions disappear when the terminal closes.
- `server/src/lib/server-error-pipeline.js` keeps only the latest 50 server errors in memory and broadcasts them to subscribers. It is not a durable error store.
- `client/src/lib/devTelemetry.js` keeps only the latest 50 browser breadcrumbs in memory.
- `client/src/hooks/useErrorCapture.js` can collect browser errors and unhandled promise rejections, but the current repository search found no component mounting the hook. There is therefore no confirmed active path from browser error capture to storage or a server endpoint.
- Active request and AI-operation status in `request-runtime.js` and `ai-runtime.js` disappears when the process ends.
- Provider health state in `server/src/services/provider-health.js` is an in-memory current snapshot. The separate provider-health JSONL writer provides history only when that health flow writes a snapshot.

## 4. What durable logs or audit records exist

The strongest durable records are `AiTrace`, `ProviderCallPackage`, `UsageLog`, `ImageParseResult`, provider-health JSONL, saved conversation/session data, workflow/case-intake activity, knowledge-candidate audit events, prompt version history, AI-management review state, and Google access-health metadata.

Important retention limits:

- `UsageLog` defaults to 365 days through `USAGE_LOG_TTL_DAYS`.
- `ImageParseResult` defaults to 90 days through `IMAGE_PARSE_RESULT_TTL_DAYS`.
- `ProviderCallPackage` defaults to 30 days through `PROVIDER_CALL_PACKAGE_TTL_DAYS`.
- Large provider payloads can be externalized to disk. The provider-package model explicitly notes that MongoDB TTL does not delete those external files, so an on-disk cleanup job is still missing.
- The server-error ring buffer and client breadcrumbs are not durable at all.

There is no single platform-wide event record that consistently answers: actor, action, target, old value, new value, request ID, trace ID, result, and reason.

## 5. What auth events are tracked

This repository does not contain a general application login/password/session-authentication system. The word “auth” mostly refers to connected Gmail OAuth and provider/API-key availability.

| Event                           | Current behavior                                                                                                                                                                                | What is missing                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Gmail OAuth status/connect      | Routes exist for status, consent URL, callback, reauthorization, and disconnect. OAuth tokens are stored in `GmailAuth` with secret fields excluded from normal reads; last successful Gmail/Calendar access and permission health are saved | Durable actor, timestamped connection-change event, result, reason, and request ID in a central audit trail |
| Gmail account switch/disconnect | Account operations exist and errors are printed                                                                                                                                                 | Durable “who changed what” event and before/after account state                                            |
| Image-parser API-key save/test  | Keys are stored in MongoDB with secret fields excluded by default; provider tests return a result                                                                                               | Key-change audit event, actor, reason, and safe old/new fingerprint                                        |
| Preferences/configuration       | Preferences and AI settings can be updated                                                                                                                                                      | Central audit event showing actor, changed fields, previous values, and result                             |
| Prompt edit/restore             | Version history exists; restore/edit agent history uses an actor label                                                                                                                          | Consistent request ID, authenticated identity, old/new fingerprints, and a shared audit view               |
| Knowledge governance            | Knowledge records have bounded audit-event history                                                                                                                                              | This is scoped to knowledge records and does not cover the rest of the application                         |

## 6. What model activity is tracked

The app is materially ahead of the original note here.

It can usually record:

- provider and model requested and actually used;
- primary, fallback, and parallel attempts;
- success, error, timeout, or abort status;
- provider error code/message and validation issues;
- total latency, first-thinking/first-chunk timing, and parser timing;
- image dimensions/size/preparation statistics;
- input/output/total token counts when returned;
- calculated cost when the provider/model rate is recognized; and
- gateway request ID when the gateway returns one.

`AiTrace` exposes summaries, model trends, recent traces, conversation traces, and full trace detail through `/api/traces`. The client renders these through Usage > AI Traces and session detail. Provider packages can retain the detailed HTTP or CLI request/response evidence and selected reasoning/event data, while image-parser results retain the parse result and provider-package reference.

The main limitations are:

- `AiTrace` stores a prompt preview and response character count, not necessarily the full assembled system prompt, context, and response.
- Provider-call capture is configurable and can be skipped when MongoDB is unavailable or capture is disabled.
- Provider packages have short retention and large external payloads need cleanup.
- Provider packages carry conversation/case metadata in many chat paths, but the model schema does not provide one uniform top-level link to the app’s `AiTrace` request ID.
- Token and cost values are legitimately absent when the provider does not return usage or the rate is not recognized.

## 7. What health checks exist

The server exposes:

- `/api/health` for basic process health;
- `/api/runtime/health` for active requests, active AI work, uptime, process ID, and Node version;
- `/api/health/providers` for current provider failure state;
- `/api/agent-identities/health` and `/api/agent-identities/health/stream` for agent/provider reachability;
- `/api/agent-identities/provider-strategy/health` for provider heartbeat/readiness/canary checks; and
- `/api/agent-identities/provider-strategy/health/logs` for stored provider-health snapshots.

The client already shows request health in the top health banner, agent health in the agent banner, provider status in agent/provider areas, and runtime/request information in the request waterfall and workflow panels.

Settings > AI Management now adds an operator-run “Test all connections” check with per-provider results, a saved failure alert, and a global badge on the Settings button until the alert is reviewed. Settings > Connected Accounts shows the last successful Gmail and Calendar access and warns when a required Google permission is missing.

These checks prove current or recently recorded health. They do not provide a complete historical snapshot of all processes on the machine, such as whether a separate gateway or LM Studio process was running, which process owned a port, or whether an orphan process was safe to preserve.

For local development, `npm run dev` now performs a preflight check and waits for `/api/health` before starting the client. This reduces false alarms and duplicate starts; it does not replace the broader saved runtime snapshot described below.

## 8. What client-side errors are captured

The client has several useful temporary surfaces:

- request waterfall state tracks pending, streaming, complete, error, aborted, duration, status, and replay information for the current browser session (`client/src/components/RequestWaterfall.jsx`);
- `HealthBanner` and `HealthToast` show current request/provider problems;
- `ErrorFallback` provides a React failure surface;
- `devTelemetry` records the latest 50 navigation, user-action, data, chat, provider, and performance breadcrumbs; and
- `useErrorCapture` contains browser `error` and `unhandledrejection` capture logic.

The gap is durability and wiring. The review found no active `useErrorCapture(...)` mount and no confirmed API/storage path for sending client errors to the server. Browser errors therefore cannot be reliably recovered after reload or matched to a server/provider record.

## 9. What server-side errors are captured

The Express error handler normalizes errors, prints them, and reports them to the in-memory server-error pipeline. Process-level uncaught exceptions and unhandled promise rejections also report there before shutdown. Domain-health code can use recent pipeline errors when calculating recent Gmail, calendar, or escalation problems.

This is useful while the process is alive, but it is not a durable Error Log. The current pipeline retains at most 50 entries in memory, with deduplication over a short window. There is no confirmed client route that lists the raw pipeline entries for a user to inspect later.

## 10. What request IDs or trace IDs exist

- The server middleware reuses a client-sent `X-Request-ID` when present or generates a UUID, then returns it in the response header.
- Chat and parse routes pass the server request ID into `AiTrace` and usage records.
- The client receives trace IDs in chat/parse responses and can open trace details.
- Gateway calls may have a separate provider/gateway request ID returned by the gateway.
- Provider packages can include conversation, case, agent, and gateway metadata, but there is not yet a guaranteed single identity that links browser request, Express request, `AiTrace`, `UsageLog`, provider package, and provider response across every path.
- The client-side HTTP layer does not show a general `X-Request-ID` generator/propagation path in the reviewed source, so ordinary browser actions are not consistently client-originated trace roots.

## 11. What questions the app can answer now

| Question                                                           | Answer                                             | Evidence                                                                               | Where the user would look                                             |
| ------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Which provider/model handled this recorded chat or parse trace?    | Usually yes                                        | `AiTrace` outcome, attempts, triage, and post-parse fields                             | Usage > AI Traces or Sessions                                         |
| Did the app use a fallback provider?                               | Yes for recorded AI traces and image-parse results | `fallbackUsed`, `fallbackFrom`, attempts, and provider trace fields                    | Usage > AI Traces, Sessions, Image Parser history                     |
| How long did the AI stages take?                                   | Yes for recorded traces                            | Outcome, stage latency, first chunk/thinking timing, and events                        | Usage > AI Traces or workflow logs                                    |
| Did image parsing validate its output?                             | Yes for stored image-parse results                 | Parse fields, validation flags, issues, source image metadata, and provider-package ID | Image Parser history / session triage                                 |
| What token/cost data was available?                                | Yes when provider usage and pricing are recognized | `AiTrace.usage` and `UsageLog`                                                         | Usage dashboard and trace detail                                      |
| What is the current server/provider health?                        | Yes at check time                                  | Health, runtime, agent-health, and provider-health endpoints                           | Health banners, Agents/provider strategy, request waterfall           |
| What was the exact detailed provider exchange for a captured call? | Often, within retention and capture limits         | `ProviderCallPackage` request/response/CLI fields                                      | Image Parser trace details or provider-package-backed detail surfaces |
| What knowledge record changed and why?                             | For knowledge governance actions                   | Candidate audit events                                                                 | Knowledge view                                                        |
| When did provider discovery last succeed and when will it run next? | Yes                                                | Saved AI-management schedule and provider discovery timestamps                         | Settings > AI Management                                              |
| Which genuinely newer models or overdue catalog reviews need attention? | Yes                                            | Deduplicated, durable AI-management notifications with review timestamps               | Settings > AI Management; Settings button alert badge                 |
| Which saved agents would be affected by disabling a provider/model? | Yes at decision time                               | Agent identity runtime assignments matched to the managed provider/model               | Settings > AI Management, before confirming the change                |
| Did each connected Google account last work for Gmail and Calendar? | Yes after a successful API operation               | `GmailAuth.lastGmailAccessAt`, `lastCalendarAccessAt`, and permission status            | Settings > Connected Accounts                                        |

## 12. What questions the app cannot answer now

Each gap below has a repair path. “Minimum fix” means the smallest useful improvement; “better fix” means the durable product capability worth aiming for.

| Question the user may ask                                                              | Why the app cannot answer now                                                                                                                                                                       | Missing evidence                                                                                              | Minimum fix                                                                                              | Better fix                                                                                                                             | Likely files to edit                                                                                                                                                                                                                                                                               | Verification steps                                                                                                                                        |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who changed this setting, API key, Gmail connection, or agent configuration?           | There is no shared actor-aware audit writer for these actions; most routes only print errors or rely on document timestamps                                                                         | Actor identity, action, target, old/new safe values, timestamp, request ID, result, reason                    | Add server-side audit writes to preferences, key, Gmail, agent, and prompt mutation routes               | Add one Audit Trail model/service and a client screen with filters and safe before/after summaries                                     | `server/src/routes/preferences.js`, `server/src/routes/gmail.js`, `server/src/routes/image-parser.js`, `server/src/routes/agent-prompts.js`, new audit service/model, `client/src/components/Settings.jsx`                                                                                         | Perform each change, restart the process, verify the audit event remains and identifies the action safely                                                 |
| Can one browser action be followed into the exact provider call?                       | The server has request IDs and AI traces, but provider packages do not have one guaranteed uniform `AiTrace`/request link across every provider path; client request-root propagation is incomplete | Shared trace ID, provider package ID, gateway request ID, parent/child relationships                          | Pass `requestId`/`traceId` in provider capture metadata and persist the provider package ID on the trace | Build a Request Trace view that joins client, server, AI, provider, gateway, fallback, and UI events                                   | `server/src/middleware/request-id.js`, `server/src/routes/chat/send.js`, `server/src/routes/chat/parse.js`, `server/src/services/chat-orchestrator.js`, provider harnesses, `server/src/models/AiTrace.js`, `server/src/models/ProviderCallPackage.js`, `client/src/components/TraceDashboard.jsx` | Run chat, parse, fallback, and gateway requests; confirm one ID chain opens every related record                                                          |
| What exact full prompt and response was sent for every model call?                     | `AiTrace` stores a preview/count, while provider-package capture can be disabled, skipped, redacted, externalized, or expired                                                                       | Full assembled prompt/context, response, capture status/reason, prompt version, safe hashes, retention state  | Record a safe prompt/response summary plus capture status and a stable hash for every attempt            | Add governed full-evidence capture with redaction, retention controls, export, and explicit “not captured because...” explanations     | `server/src/services/ai-traces.js`, provider recorder/redaction/payload store, provider harnesses, prompt store, trace routes/UI                                                                                                                                                                   | Compare the captured evidence with the actual provider payload for chat, image parse, fallback, and capture-disabled cases                                |
| What client and server errors happened after a restart or reload?                      | Server errors are a 50-entry memory ring; client breadcrumbs are a 50-entry memory ring; browser error capture is not confirmed wired                                                               | Durable error event, client/server side, stack/detail, request/trace ID, timestamps, retention, UI visibility | Persist normalized server errors and wire `useErrorCapture` to a safe client-error endpoint              | Add Settings > Diagnostics > Logs with filters, request-trace links, export, retention, and privacy controls                           | `server/src/lib/server-error-pipeline.js`, `server/src/app.js`, new error model/service/route, `client/src/hooks/useErrorCapture.js`, `client/src/lib/devTelemetry.js`, `client/src/components/Settings.jsx`                                                                                       | Trigger client and server failures, reload/restart, and verify both events remain searchable and linked                                                   |
| What was the complete local runtime layout when the failure occurred?                  | Current health checks do not preserve port owners, process ancestry, gateway state, LM Studio state, or orphan-process decisions                                                                    | Runtime snapshot, process/port ownership, dependency status, timestamps, and preserve/restart recommendation  | Add an on-demand diagnostic snapshot that records known app dependencies and status                      | Create the broader `qbo-runtime-doctor` skill to inspect the live layout read-only and attach its report to a request/runtime incident | `server/src/app.js`, runtime/health services, `server/src/services/provider-health.js`, separate Codex skill outside this repo                                                                                                                                                                     | Run with QBO backend, client, gateway, and model server in different states; verify the report distinguishes each failure layer without killing processes |
| Are externalized provider payload files cleaned up when their database records expire? | Provider-package TTL removes Mongo documents but the model comments explicitly say it does not remove external payload files                                                                        | Cleanup result, orphan-file count, retention policy, and deletion audit                                       | Add a scheduled/on-demand cleanup job scoped to the provider-payload root                                | Add retention metrics, dry-run cleanup, failure alerts, and an operator-visible storage report                                         | `server/src/models/ProviderCallPackage.js`, `server/src/services/provider-call-package-payload-store.js`, startup/background runtime                                                                                                                                                               | Create expired test fixtures, run cleanup, verify only in-scope files are removed and metrics record the result                                           |

## 13. Recommended client-visible paths

Existing paths worth keeping and strengthening:

- Usage > AI Traces: model/provider, status, latency, tokens/cost, filters, trends, and trace detail.
- Sessions > workflow logs: saved conversation, pipeline stages, reasoning/latency where available, and triage evidence.
- Image Parser > History/Trace Details: source image, parse result, validation, provider/model, fallback, and package reference.
- Top health banner and request waterfall: current request failures, slow work, status codes, and active requests.
- Agents > provider strategy/health: agent reachability and provider readiness/canary history.
- Knowledge: governance history for knowledge records.
- Settings > AI Management: automatic-check schedule, last/next checks, provider connection results, affected-agent previews, model-release review packets, and reviewable alerts.
- Settings > Connected Accounts: per-account Gmail/Calendar access time, plain-English permissions, missing-access warnings, reauthorization, and independent inbox/sending/calendar defaults.

Recommended missing or incomplete paths:

- Settings > Audit Trail: who changed what, when, why, and safe before/after values.
- Settings > Diagnostics > Logs: durable client/server errors with filters, severity, and request links.
- Settings > Runtime: current dependency status plus the latest saved runtime snapshot.
- Settings > Model Activity: one searchable list of AI traces, provider packages, usage/cost, retries, and capture state.
- Trace detail > Request Path: browser action -> server request -> AI trace -> provider package -> gateway/provider response -> persisted outcome.
- Settings > Provider Health: current status, last successes/failures, latency, key/configuration state without secrets, and retention/export controls.

## 14. Prioritized fix plan

1. **P0 — Make the existing evidence joinable.** Carry a consistent request/trace identity through the client, server, `AiTrace`, usage record, provider package, and gateway response. This closes the most important “what actually happened?” question.
2. **P0 — Add durable audit events for user-controlled changes.** Start with preferences, provider/API keys, Gmail account actions, agent runtime settings, and prompt changes. Do not store secrets; store safe fingerprints or field summaries.
3. **P0 — Persist and display errors.** Turn the current server ring buffer and client capture plan into a durable, client-visible Diagnostics/Logs path. Wire the existing client capture hook before adding more client logging.
4. **P1 — Make prompt/response capture explicit.** Record capture enabled/skipped/expired/redacted status and prompt/version hashes for every AI attempt. Decide deliberately which full payloads may be retained.
5. **P1 — Finish provider-package storage cleanup.** Remove externalized payloads according to the same retention policy as their Mongo record, with dry-run and failure reporting.
6. **P1 — Extend startup checks into the runtime-doctor workflow.** Keep the app’s health endpoints focused on app health; build on the friendly launcher with a read-only diagnostic skill that can inspect and save the multi-process local layout while preserving healthy instances by default.
7. **P2 — Improve visual QA of diagnostic surfaces.** Verify that traces, errors, runtime state, and audit information are understandable and useful in the UI, rather than merely exposing raw JSON.

## 15. Verification checklist

- Trigger a normal chat request and confirm the request/trace ID appears in the client, server response, `AiTrace`, usage record, provider package, and gateway response where applicable.
- Trigger an image parse with a primary-provider failure and confirm the primary error, fallback attempt, final provider/model, validation result, parse result, and provider package all join together.
- Trigger a controlled server error and confirm the user-visible diagnostic and durable error record match after reload/restart.
- Trigger a browser error and unhandled promise rejection and confirm capture, safe redaction, storage, request linkage, and UI visibility.
- Connect/disconnect or switch a Gmail account and verify the audit trail includes actor, account target, timestamp, result, and reason without exposing tokens.
- Change an image-parser key, preference, agent runtime setting, and prompt; verify each has an audit event with safe before/after information.
- Trigger a provider health failure and recovery; confirm current health, stored health history, provider/model, latency, and error reason.
- Run AI Management model discovery with a genuinely newer test ID and confirm one durable alert appears, the Settings badge updates, repeated checks do not duplicate it, and reviewing it clears the badge.
- Change automatic checks to Weekly and Monthly; confirm last-success and next-scheduled times are truthful and no model is approved automatically.
- Test all provider connections; confirm each enabled provider reports pass/fail, failures remain reviewable, and no API key value is returned to the browser.
- Perform successful Gmail and Calendar reads for each connected account; confirm Settings shows the correct per-account timestamps and missing OAuth permissions in plain English.
- Set different inbox, sending, and calendar defaults; confirm UI actions and server-side agent calls use the intended account without disconnecting another account.
- Verify usage and cost fields when a provider returns usage, and verify the UI clearly says when usage or pricing is unavailable.
- Close the terminal or restart the app and confirm durable traces, usage, parse history, audit events, and errors remain according to retention policy.
- Create an expired external provider payload fixture and verify cleanup removes only the intended file and records what happened.
- Run the report scanner again after fixes and move each resolved question from “cannot answer now” to “can answer now.”

## 16. Relation to the pasted note

The note remains useful as a roadmap, but several conclusions are now stale for this repository:

- `repo-observability-reviewer` is directly applicable and has now produced this baseline report.
- `qbo-image-parser-regression-auditor` remains highly relevant because the repository already stores image-parse history, validation, provider traces, and package references; the next step is to make regression comparisons easier and more complete.
- `qbo-runtime-doctor` remains relevant, but it should complement the app’s existing health endpoints rather than replace them.
- `frontend-visual-qa` remains useful for checking whether the existing diagnostic surfaces are understandable and not cluttered.
- `provider-impact-auditor` is relevant across this repo and `llm-gateway`, but it is a cross-project/provider-governance skill, not a QBO-only feature.
- `plain-english-technical-explainer` and `recent-session-skill-miner` are personal Codex workflow skills, not QBO application features.
- `windows-assistant-phase-contract` belongs to `C:\Projects\windows-ai-assistant`, not this repository.
- The note’s recommendation to begin by adding basic structured logs is no longer the right first move here. The higher-value work is correlation, durable audit/error history, retention safety, and user-facing evidence.
- The note’s recommendation to start with `C:\Projects\llm-gateway` is still reasonable for gateway-specific auth/model logging, but it is a different repository and was not reviewed in this run.

---

Below is a raw Q and A output from a conversation with an AI model. Saving it here as a note to self.

1.  How is the existing information shown?

Currently:

- AI provider, model, errors, fallback use, timing, and token/cost information are
  shown under Usage Monitor → Trace Monitor.

- A saved conversation has tabs such as Workflow Log, Reasoning, Inputs & Outputs,
  Latency, Agents, Cost, Triage, and Audit.

- Image-parser results appear in Image Parser → Parse History, including provider,
  model, success/failure, elapsed time, and error details.

- Current request problems appear in the top health banner and request waterfall.
- Agent and provider health appear in the Agents/provider health areas.

The important limitation is that there is not one simple “What happened?” screen.
Some detailed records are saved behind the scenes but are difficult for a normal
user to find.

2. Do I mean an audit log?

Yes.

An audit log is a history showing:

- who changed something;
- what they changed;
- when they changed it;
- whether it worked; and
- sometimes the old and new values.

For example:

> Keith changed the image-parser provider from OpenAI to Claude at 2:14 PM.

The app has some audit history for Knowledge Base changes, but not one complete
audit log for settings, API keys, Gmail accounts, prompts, and agent configuration.

3. What does “one ID connecting everything” mean?

Imagine a tracking number for one action.

You click Send, and that action travels through:

1. the browser;
2. the QBO server;
3. the selected AI provider or gateway;
4. fallback providers, if needed; and
5. the saved result.

A shared request ID would let the app say:

> This browser action created this server request, which called Claude, then failed
> over to OpenAI, and produced this final response.

Without that shared ID, developers may have to guess which records belong together
based on time, conversation, or model name.

4. What does “the exact prompt and response” mean?

The prompt is everything sent to the AI model, not just the message you typed.

It may include:

- your message;
- system instructions;
- agent instructions;
- Knowledge Base information;
- previous conversation messages;
- image data;
- selected provider and model;
- fallback instructions; and
- formatting requirements.

The response is everything the model sent back.

This matters when an answer looks wrong. You may want to know:

> What exactly did the AI see, and what exactly did it return?

The app currently saves some prompt previews and detailed provider information, but
not always the complete final prompt and response in one easy-to-find record. Also,
storing complete prompts and responses requires privacy controls because they may
contain sensitive information.

5. Is error history like a bug report?

It is similar, but automatic.

A bug report is something a person writes:

> The screen went blank when I uploaded an image.

An error-history record would be created automatically and might say:

> Image upload failed at 3:21 PM. The server returned an error. Request ID: ABC123.
> Provider: Claude. Error: timeout.

The app currently shows many errors while it is running, but much of that
information disappears after a reload or restart. The goal would be an automatic
history of failures that the user can review later.

6. What does “the local system layout” mean?

It means knowing which parts of the local app were running and whether they were
healthy.

For example:

- QBO backend;
- QBO client;
- LLM gateway;
- LM Studio;
- MongoDB;
- the ports each service is using;
- whether one service cannot reach another;
- whether an old leftover process is still using a port; and
- whether the failure came from the browser, QBO server, gateway, or AI model.

For example, instead of simply saying:

> The app failed,

the diagnostic could say:

> The browser is running, but the QBO server cannot reach the LLM gateway. MongoDB
> is healthy. LM Studio is not running.

7. What does “observability review” mean?

In plain English, it means:

> Checking how well the app can explain what happened.

The review asks:

- What can the app prove?
- What information does it save?
- What disappears when the app restarts?
- Can the user see the information without opening a terminal?
- What important questions still cannot be answered?
- What should be improved first?

So an observability review is not the same as a bug report. It is more like a
health check of the app’s ability to explain its own behavior.

---

## 17. Decisions still needed from the original note

These ideas were mentioned in the original scrap-paper note but are not fully decided yet.

**Reminder to self:** Before deleting the original note, decide whether each item should be **created now**, **deferred**, or **discarded**.

| Idea | Where it belongs | What decision is needed |
| --- | --- | --- |
| `qbo-runtime-doctor` | QBO project / Codex skill | Decide whether to expand the existing startup-triage skill into a broader read-only runtime diagnostic skill. |
| `qbo-image-parser-regression-auditor` | QBO project / Codex skill | Decide whether repeated image-parser investigations justify a dedicated regression-review skill now. |
| `frontend-visual-qa` | QBO and other frontend projects / Codex skill | Decide whether visual checking should become a reusable skill instead of a manual review step. |
| `provider-impact-auditor` | Cross-project provider and account management | Decide whether vendor changes, pricing changes, credentials, and SDK usage need a reusable audit skill. |
| `windows-assistant-phase-contract` | `C:\Projects\windows-ai-assistant` | Decide whether the Windows Assistant needs a dedicated skill to keep its current phase and capabilities clear. |
| `plain-english-technical-explainer` | Personal Codex workflow | Decide whether to create a reusable helper that automatically translates technical answers into simpler language. |
| `recent-session-skill-miner` | Personal Codex workflow | Decide whether reviewing recent Codex sessions for repeated workflows is valuable enough to automate. |

`repo-observability-reviewer` is already selected and used for this QBO review, so it is not part of the pending-decision list.
