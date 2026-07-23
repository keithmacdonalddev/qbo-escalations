# Ticket Snitch user reporting integration plan

Status: implementation-ready, based on source review on 2026-07-23

Repositories in scope:

- `C:\Projects\qbo-escalations`
- `C:\Projects\ticket-snitch`

All other applications are out of scope.

## 1. User outcome

A QBO Escalations user can open a short reporting form from the global application header, choose **Problem**, **Feature request**, or **Feedback**, enter a useful title and explanation, optionally approve a small allow-listed diagnostics bundle, and submit without knowing anything about Ticket Snitch.

On success, the user sees the Ticket Snitch case key. Ticket Snitch receives a project-scoped work item in the QBO Escalations project and keeps the normal human-controlled workflow for review, priority, ownership, evidence, action, verification, and closure.

## 2. Current evidence and gap

The two repositories already contain most of the integration foundation:

- QBO Escalations has a dependency-free Ticket Snitch connector in `server/src/services/ticket-snitch-client.js`.
- QBO Escalations has a protected automation proxy in `server/src/routes/ticket-snitch.js`.
- Ticket Snitch accepts project-credential creation at `POST /api/v1/work-items`, requires an idempotency key, scopes credentials to one workspace/project, and returns a safe create-only confirmation containing the case ID/key/project.
- Ticket Snitch supports `problem_report`, `feature_request`, and `improvement`; it intentionally does not use a generic `feedback` work-item type.
- Ticket Snitch already prevents project credentials from declaring confirmed bugs, priority, severity, owner, target date, public summary, or decision outcome.
- Ticket Snitch already records append-only creation events and audit history inside a transaction.

What is missing:

- There is no QBO browser reporting UI.
- The current QBO proxy requires a server-to-server proxy secret and cannot safely be called by browser code.
- The current `/report` handler does not attach a trusted reporter.
- QBO Escalations currently has no application login, account session, or authenticated `req.user`. It is a local single-user service bound to loopback by default. Gmail OAuth connections are not QBO application identities and must not be repurposed as one.

Therefore this implementation will use a server-configured reporter identity for the current local single-user deployment and will never accept identity from the browser. This is truthful server-owned attribution, but it is not a new QBO sign-in system. A future multi-user or remotely hosted deployment must supply authenticated session identity before it can claim per-account reporter attribution.

## 3. Product workflow

1. The user selects **Send feedback** in the global header.
2. The modal loads report availability plus a short-lived anti-forgery token from the QBO server.
3. The user selects one of three plain-language choices:
   - Problem -> Ticket Snitch `problem_report`
   - Feature request -> Ticket Snitch `feature_request`
   - Feedback -> Ticket Snitch `improvement`
4. The user enters a title and explanation.
5. An optional checkbox explains and controls the approved diagnostics bundle.
6. QBO generates and retains one stable submission ID for this draft. Retrying the same draft reuses that ID.
7. The browser sends only user content, the stable submission ID, the anti-forgery token, and allow-listed context fields to the QBO server.
8. The QBO server verifies origin, token, availability, rate limits, and input; derives reporter identity and project authority from server configuration; strips URL query/hash data; then calls the existing Ticket Snitch connector server-to-server.
9. Ticket Snitch enforces credential scope, validates the versioned contract, deduplicates by idempotency key, creates the case and append-only history transactionally, and returns a safe confirmation.
10. QBO shows the case key and whether a retry found the already-created case.

## 4. Human and agent responsibility

- The reporting user supplies the observation and chooses whether approved diagnostics are included.
- The QBO server owns reporter attribution, Ticket Snitch project mapping, credential custody, safe context filtering, request correlation, and retry identity.
- The Ticket Snitch credential may create reports only. It does not give the browser or reporting user Ticket Snitch access.
- A Ticket Snitch human owner confirms whether a problem is a bug and decides priority, severity, ownership, relationships, risky actions, verification, and closure.
- Connected agents may assist within their credential scope but cannot convert a user report into authoritative human truth.

## 5. Evidence, privacy, memory, and validation

Always-safe context is limited to:

- route name or hash route without query parameters
- application version
- submission timestamp
- source QBO request ID

Optional diagnostics, included only after the user checks the consent box, are limited to:

- browser user-agent string
- viewport size
- locale
- one safe application error code, when the UI has one

Never collect or forward passwords, tokens, cookies, authorization headers, payment data, unrestricted logs, form contents outside this report, secret-bearing query strings, Gmail content, customer evidence, AI prompts/responses, or arbitrary browser/server objects.

The report and its consent flags become durable Ticket Snitch evidence. Request IDs must be preserved in the QBO response and Ticket Snitch source metadata. The same submission ID plus the same report content must resolve to the same case; reuse with changed content must fail visibly rather than silently changing history.

## 6. Implementation map

### QBO Escalations server

- Refine `server/src/services/ticket-snitch-client.js`:
  - normalize and validate only supported user-report fields
  - strip query/hash from source URLs
  - map allow-listed context into the Ticket Snitch `details.environment` and `details.consent` contract instead of placing non-contract fields in `details`
  - derive a stable idempotency key from project plus server-validated submission ID
  - keep the Ticket Snitch API key server-only
- Split browser reporting from automation operations in `server/src/routes/ticket-snitch.js`:
  - public-to-the-app `GET /api/ticket-snitch/reporting/bootstrap`
  - public-to-the-app `POST /api/ticket-snitch/reporting/reports`
  - preserve proxy-secret protection on status/read/update/comment/transition/evidence automation routes
  - exact-origin and anti-forgery validation on browser reporting
  - server-configured trusted reporter only
  - report-specific rate limit and structured errors with request IDs
- Add a small report-session/CSRF helper if separation improves testability.
- Add placeholder-only environment documentation for reporter identity and allowed origins. Never write a live secret.

### QBO Escalations client

- Add a reporting API module that does not use unsafe automatic mutation retry behavior; it retains the same stable submission ID for explicit retry.
- Add a focused `UserReportDialog` with:
  - three clear report choices
  - title and explanation labels, limits, and validation
  - optional diagnostics consent with an exact disclosure
  - loading, disabled/unconfigured, permission, offline, submitting, success, duplicate replay, validation, timeout/network, and server-error states
  - focus management, Escape/close behavior, keyboard use, live status, and mobile layout
- Add a discoverable **Send feedback** header control that opens the dialog without adding another main navigation destination.
- Reuse QBO design tokens and shell patterns; add no competing visual brand.

### Ticket Snitch

- Keep the `/api/v1/work-items` contract as the single database writer.
- Change shared contracts, OpenAPI, SDK, API handlers, or Ticket Snitch UI only if isolated compatibility tests expose an actual mismatch.
- Extend the real-HTTP QBO acceptance test to cover the user-report mappings, trusted reporter, consent/context, request ID, and duplicate replay.
- Update integration documentation/release evidence if behavior or activation steps become more precise.

## 7. Security and consistency boundaries

- Browser code never receives the Ticket Snitch API key, proxy secret, workspace ID, project authority, actor role, or reporter authority.
- Browser-supplied reporter, actor, role, project, workspace, priority, severity, owner, status, or decision fields are ignored/rejected.
- The browser reporting endpoints require a server-issued anti-forgery token and an allowed exact origin. Tokens are short-lived, bound to the browser context as far as the current local architecture permits, and never used as identity.
- Existing QBO automation endpoints remain protected by `TICKET_SNITCH_REPORT_PROXY_SECRET`.
- Ticket Snitch project credential scope, transactions, append-only events, audit history, optimistic versions, and final human authority remain unchanged.
- No database, credential, persistent service, backup, restore, deployment, or live customer-data operation is part of implementation or verification.

## 8. User-interface states

- Loading: stable dialog frame with “Checking reporting availability…”
- Empty/unconfigured: explain that reporting is not connected on this server and that the user does not need to fix it
- Permission: explain that this installation cannot accept reports and preserve the draft
- Validation: field-level messages and focus on the first invalid field
- Offline before submit: preserve the draft and enable retry when the browser returns online
- Submitting: one disabled primary action labelled “Sending…”
- Success: case key, plain next-step explanation, close/new-report actions
- Duplicate replay: same confirmation plus “This report was already received; no duplicate was created.”
- Timeout/network/server error: preserve every field, show request ID when available, and offer safe retry
- Narrow screen: full-width action, stacked fields/options, bounded dialog viewport, no hover dependency

## 9. Acceptance criteria

1. Can a user open the report form from every normal QBO application view? **Yes** when the header control is present.
2. Can the user choose problem, feature request, or feedback in plain language? **Yes**.
3. Does a problem arrive as `problem_report`, never `bug`? **Yes**, enforced and tested server-side.
4. Does feedback map to Ticket Snitch’s supported `improvement` type? **Yes**, documented and tested.
5. Can browser input choose reporter identity, role, workspace, project, priority, severity, owner, or status? **No**, rejected or absent from the accepted payload.
6. Is the Ticket Snitch credential absent from built browser code and responses? **Yes**, checked by tests/build inspection.
7. Do explicit retries reuse one stable idempotency identity and return the original case? **Yes**, tested through the real HTTP contract.
8. Are URL queries, cookies, tokens, unrestricted logs, and unapproved diagnostics excluded? **Yes**, unit and route tests cover filtering.
9. Are request IDs present in QBO errors/confirmations and forwarded to Ticket Snitch? **Yes**.
10. Does optional context require visible user consent? **Yes**.
11. Are loading, unavailable, permission, validation, offline, submitting, success, replay, server-error, and narrow-screen states implemented? **Yes**, component tests plus build/browser acceptance where safely available.
12. Can Ticket Snitch owners review and progress the resulting case using the existing lifecycle? **Yes**, isolated API acceptance verifies creation and the existing suite covers lifecycle authority.
13. Does the implementation create a QBO sign-in system? **No**. Current attribution is server-configured for the existing local single-user architecture.
14. Can live activation be claimed without configured credentials and runtime evidence? **No**.

## 10. Verification plan

- QBO connector unit tests for payload filtering, context structure, URL stripping, trusted reporter, request IDs, and idempotency.
- QBO route tests for origin, anti-forgery token, configuration/permission, browser-field rejection, rate limiting boundary, validation, replay, and structured downstream errors.
- QBO client component/API tests for accessibility and every required state.
- QBO syntax/lint, focused server/client tests, and production client build.
- Ticket Snitch shared-contract/API focused tests as applicable.
- Ticket Snitch `npm run test:qbo-live` using its temporary API and in-memory replica set, extended to exercise the actual user-report contract and replay.
- `git diff --check` and fresh status in both repositories.

## 11. Non-goals and activation work requiring approval

- No new general QBO account/login system in this integration.
- No reporting integrations for QBO Support Lab, LLM Gateway, Windows AI Assistant, or another app.
- No public anonymous internet reporting endpoint.
- No automatic bug confirmation, triage decision, assignment, priority, severity, resolution, or closure.
- No screenshots, file attachments, raw logs, Gmail data, AI transcript capture, or background diagnostics collection in the first workflow.
- No live Ticket Snitch credential creation/rotation/revocation, `.env` write, database preparation, service restart, deployment, or production authentication.

Live activation will still require a human to create a least-privilege QBO project credential in Ticket Snitch, place placeholder-documented values into the QBO server’s secret environment, configure the trusted local reporter identity and allowed origin, and restart/deploy the exact approved environment. Runtime submission evidence is required before calling it live.
