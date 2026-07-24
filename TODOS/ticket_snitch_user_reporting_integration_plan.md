# Ticket Snitch user reporting integration plan

Status: implemented, approved local-development activation completed and dogfood-verified on 2026-07-24

Repositories in scope:

- `C:\Projects\qbo-escalations`
- `C:\Projects\ticket-snitch`

All other applications are out of scope.

## 1. User outcome

A signed-in QBO Escalations user can open a compact reporting form from the global application header, choose **Problem**, **Feature request**, or **Feedback**, enter a useful title and explanation, optionally attach one reviewed screenshot, and submit without knowing anything about Ticket Snitch.

On success, the user sees the Ticket Snitch case key and receives a private receipt under **My reports**. The user can return to public-safe status, reply, and confirm **Fixed** or **Not fixed** while Ticket Snitch keeps the human-controlled workflow for review, priority, ownership, evidence, action, verification, and closure.

## 2. Current evidence and gap

The two repositories contain the complete integration foundation:

- QBO Escalations has a dependency-free Ticket Snitch connector in `server/src/services/ticket-snitch-client.js`.
- QBO Escalations has a protected automation proxy in `server/src/routes/ticket-snitch.js`.
- Ticket Snitch accepts project-credential creation at `POST /api/v1/work-items`, requires an idempotency key, scopes credentials to one workspace/project, and returns a safe create-only confirmation containing the case ID/key/project.
- Ticket Snitch supports `problem_report`, `feature_request`, and `improvement`; it intentionally does not use a generic `feedback` work-item type.
- Ticket Snitch already prevents project credentials from declaring confirmed bugs, priority, severity, owner, target date, public summary, or decision outcome.
- Ticket Snitch already records append-only creation events and audit history inside a transaction.

The earlier completion audit found that anonymous browser continuity did not satisfy the explicit authenticated-server-context requirement, and a later compact-modal redesign removed the working **My reports** surface. The current implementation corrects both issues:

- an opt-in, first-party QBO password session owns the authenticated user ID/name/email and is the only source of reporter identity;
- reporting tokens are bound to the exact origin and current QBO session;
- opaque receipt handles are encrypted for the signed-in user and stored under a per-user, per-project browser scope;
- **My reports** restores public-safe status, replies, and reporter validation without exposing owner-only notes or authority;
- disabled authentication preserves unrelated local development behavior but keeps user reporting unavailable rather than inventing identity.

The approved local-development runtime gate is complete. Index preparation and controlled restarts passed; live case `QBO-3` proved signed-in submission, screenshot evidence, user-bound My Reports, public reply, waiting/follow-up, inert proposal and owner approval, acknowledged handoff and owner application, both reporter outcomes, and owner-only closure. Browser review found and closed expired-token retry and stale closed-next-action defects. Future environments still require their own approved configuration and runtime proof.

## 3. Product workflow

1. When first-party authentication is enabled, the user signs in to QBO Escalations with the configured local account. The password is checked only on the server against a scrypt hash; the browser receives an HttpOnly session cookie, not identity authority.
2. The authenticated user selects **Send feedback** in the global header.
3. The modal loads report availability plus a short-lived anti-forgery token bound to the authenticated session and browser origin.
4. The user selects one of three plain-language choices:
   - Problem -> Ticket Snitch `problem_report`
   - Feature request -> Ticket Snitch `feature_request`
   - Feedback -> Ticket Snitch `improvement`
5. The user enters a title and explanation.
6. The user may explicitly capture or choose one reviewed screenshot; required basic diagnostics are collected from an allow-list without a misleading opt-out.
7. QBO generates and retains one stable submission ID for this draft. Retrying the same draft reuses that ID.
8. The browser sends only user content, the stable submission ID, the session-bound anti-forgery token, and allow-listed context fields to the QBO server.
9. The QBO server verifies the authenticated session, origin, token, availability, rate limits, and input; derives reporter identity from `req.authenticatedUser`; derives project authority from private connector configuration; strips URL query/hash data; then calls the existing Ticket Snitch connector server-to-server.
10. Ticket Snitch enforces credential scope, validates the versioned contract, deduplicates by idempotency key, creates the case and append-only history transactionally, and returns a safe confirmation plus private receipt.
11. QBO shows the case key, saves only the opaque user-bound receipt handle, and exposes public-safe follow-up under **My reports**.

## 4. Human and agent responsibility

- The reporting user supplies the observation, explicitly chooses any screenshot, replies when asked, and provides outcome validation as evidence.
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
  - optional reviewed screenshot capture and a low-emphasis data-use disclosure
  - **My reports** receipt list, public-safe status/conversation, reply, and fixed/not-fixed validation
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
12. Can Ticket Snitch owners review and progress the resulting case using the existing lifecycle? **Yes**, isolated acceptance and live local case `QBO-3` prove the full owner-controlled lifecycle.
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
- This first-phase exclusion is superseded only for the explicit, user-reviewed screenshot workflow in `C:\Projects\ticket-snitch\04_QBO_SCREENSHOT_EVIDENCE_AND_CASEWORK_IMPLEMENTATION_PLAN.md`. Raw logs, Gmail data, AI transcript capture, and automatic/background screenshot collection remain out of scope.
- This first-phase operations exclusion was superseded for the explicitly authorized local development activation on 2026-07-24. Production/staging credentials, database operations, deployment, backup, restore, and customer-data actions remain out of scope.

The local development checkout has separate create-only reporting, evidence-only screenshot forwarding, and least-privilege Codex agent credentials stored only in ignored server configuration. The signed-in receipt/accountability activation is complete for this approved local environment, with database preparation, controlled restart, authenticated report/receipt/reply/validation, owner workflow, privacy/isolation checks, and browser evidence recorded. Any future environment requires its own approved password/origin/credential setup and the same runtime proof before it can be called activated.
