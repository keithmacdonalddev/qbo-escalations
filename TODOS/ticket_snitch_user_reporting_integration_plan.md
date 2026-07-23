# Ticket Snitch user reporting integration plan

Status: code-complete and verified in isolated tests on 2026-07-23; live activation remains human-owned

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

The first implementation supplied the UI, forwarding, privacy, idempotency, and acceptance coverage. The completion audit found one remaining authority defect:

- QBO Escalations currently has no application login, account session, or authenticated `req.user`. It is a local single-user service bound to loopback by default. Gmail OAuth connections are not QBO application identities and must not be repurposed as one.
- The implemented report route uses `TICKET_SNITCH_REPORTER_*` environment values directly. Although these values are server-owned, they do not prove which QBO user submitted a report and therefore do not satisfy the explicit authenticated-server-context requirement.

The correction will add an opt-in, first-party QBO password session for identity-bound reporting in the current single-user deployment. When enabled, the server session owns the user ID/name/email and the report route requires that authenticated session. Existing local application workflows remain under their current loopback/deployment boundary; this change does not pretend to retrofit authorization across every unrelated QBO route. When authentication is disabled, existing local development behavior remains available but user reporting must remain unavailable because no authenticated reporter exists. This avoids both a breaking default and a false identity claim.

## 3. Product workflow

1. When first-party authentication is enabled, the user signs in to QBO Escalations with the configured local account. The password is checked only on the server against a scrypt hash; the browser receives an HttpOnly session cookie, not identity authority.
2. The authenticated user selects **Send feedback** in the global header.
3. The modal loads report availability plus a short-lived anti-forgery token bound to the authenticated session and browser origin.
4. The user selects one of three plain-language choices:
   - Problem -> Ticket Snitch `problem_report`
   - Feature request -> Ticket Snitch `feature_request`
   - Feedback -> Ticket Snitch `improvement`
5. The user enters a title and explanation.
6. An optional checkbox explains and controls the approved diagnostics bundle.
7. QBO generates and retains one stable submission ID for this draft. Retrying the same draft reuses that ID.
8. The browser sends only user content, the stable submission ID, the session-bound anti-forgery token, and allow-listed context fields to the QBO server.
9. The QBO server verifies the authenticated session, origin, token, availability, rate limits, and input; derives reporter identity from `req.authenticatedUser`; derives project authority from private connector configuration; strips URL query/hash data; then calls the existing Ticket Snitch connector server-to-server.
10. Ticket Snitch enforces credential scope, validates the versioned contract, deduplicates by idempotency key, creates the case and append-only history transactionally, and returns a safe confirmation.
11. QBO shows the case key and whether a retry found the already-created case.

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

- Add a bounded first-party authentication layer using only Node built-ins:
  - opt-in `password` mode with server-configured user ID, name, optional email, and scrypt password hash
  - generic login failures, bounded rate limiting, exact-origin checks, and no password logging
  - random opaque sessions stored hashed in process memory, HttpOnly/SameSite=Strict cookies, bounded lifetime, logout/revocation, and automatic pruning
  - public session-status/login routes and authenticated reporting endpoints when password mode is enabled
  - `req.authenticatedUser` as the only reporter identity source
  - disabled mode preserves today's loopback development behavior but cannot submit user reports
- Add an interactive password-hash helper that never writes a password or `.env` file.

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
  - authenticated-session reporter only
  - report-specific rate limit and structured errors with request IDs
- Add a small report-session/CSRF helper if separation improves testability.
- Add placeholder-only environment documentation for authentication, reporter profile, cookie/origin behavior, and Ticket Snitch configuration. Never write a live secret.

### QBO Escalations client

- Add a reporting-identity provider and sign-in dialog with loading, disabled mode, invalid credentials, rate limit, configuration error, offline/network error, and narrow-screen states.
- Add a visible sign-in/signed-in-user/logout control to the global header when authentication is enabled. Selecting **Send feedback** while signed out should lead directly into sign-in and then continue to the report form.

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
- Authentication cookies are opaque, HttpOnly, SameSite=Strict, scoped to the application, time-bounded, and Secure in production. Raw session values are not stored server-side.
- Unsafe authenticated API requests require an exact allowed Origin/Referer in addition to SameSite cookie protection.
- The browser reporting endpoints require a valid QBO session, a server-issued anti-forgery token, and an allowed exact origin. Tokens are short-lived, bound to the authenticated session and origin, and never used as identity.
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
13. Does the report route derive reporter identity from a verified QBO server session rather than environment values at submission time? **Yes**, enforced and tested.
14. When reporting authentication is enabled, can an unauthenticated browser obtain a reporting token or submit a report? **No**.
15. Does disabled authentication preserve existing local development while refusing to invent an authenticated reporter? **Yes**.
16. Can live activation be claimed without configured authentication, Ticket Snitch credentials, and runtime evidence? **No**.

## 10. Verification plan

- QBO connector unit tests for payload filtering, context structure, URL stripping, trusted reporter, request IDs, and idempotency.
- QBO route tests for origin, anti-forgery token, configuration/permission, browser-field rejection, rate limiting boundary, validation, replay, and structured downstream errors.
- QBO authentication tests for configuration, scrypt verification, opaque session creation, cookie flags, expiration, logout, exact-origin mutation protection, unauthenticated API rejection, and authenticated reporter derivation.
- QBO authentication component tests for session loading, sign-in, invalid credentials, rate limit/configuration/network errors, sign-out, and the sign-in-then-report handoff.
- QBO client component/API tests for accessibility and every required state.
- QBO syntax/lint, focused server/client tests, and production client build.
- Ticket Snitch shared-contract/API focused tests as applicable.
- Ticket Snitch `npm run test:qbo-live` using its temporary API and in-memory replica set, extended to exercise the actual user-report contract and replay.
- `git diff --check` and fresh status in both repositories.

## 11. Non-goals and activation work requiring approval

- No multi-user registration, password reset, invitations, OIDC, roles, administrator UI, persistent cross-instance session store, or public hosted identity platform. This is one first-party reporting identity for the current single-user QBO deployment, not a claim that every unrelated QBO route has been converted into a hosted authorization system.
- No reporting integrations for QBO Support Lab, LLM Gateway, Windows AI Assistant, or another app.
- No public anonymous internet reporting endpoint.
- No automatic bug confirmation, triage decision, assignment, priority, severity, resolution, or closure.
- No screenshots, file attachments, raw logs, Gmail data, AI transcript capture, or background diagnostics collection in the first workflow.
- No live Ticket Snitch credential creation/rotation/revocation, `.env` write, database preparation, service restart, deployment, or production authentication.

Live activation will still require a human to generate a scrypt password hash locally, configure the QBO account profile/authentication mode and exact origin in the approved server secret environment, create a least-privilege QBO project credential in Ticket Snitch, configure the private connector values, and restart/deploy the exact approved environment. A real sign-in plus harmless report/case-key check is required before calling it live.
