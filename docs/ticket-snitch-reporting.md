# Ticket Snitch reporting for QBO Escalations

QBO Escalations has one **Send feedback** control for problems, feature requests, and general feedback. A signed-in QBO user can submit a report, receive a private receipt, return through **My reports**, read public-safe updates, reply, and confirm **Fixed** or **Not fixed** without needing a Ticket Snitch account.

Ticket Snitch remains the work system. Its signed-in owner confirms whether a report is a bug, sets priority and ownership, approves risky actions, validates evidence, and closes or reopens work. QBO reporter replies and validation are evidence for that decision; they do not make the decision automatically.

## Identity and authority

The authority boundary is deliberate:

- QBO uses an opt-in first-party password session for the current single-user local deployment.
- The configured password is stored only as a scrypt hash. The browser receives a random, opaque, HttpOnly, SameSite=Strict session cookie.
- The QBO server derives the reporter ID, name, and default email from that authenticated session. Browser-supplied actor, role, workspace, project, priority, severity, owner, status, or decision fields cannot grant authority.
- A short-lived reporting token is bound to the exact allowed origin and the current QBO session. A token from another session is rejected.
- Ticket Snitch project credentials and raw customer receipts remain server-side.
- Optional contact fields can refine the display name or email for one report, but they remain contact metadata and do not create Ticket Snitch authority.

Authentication is intentionally bounded. It supplies trusted identity for reporting; it does not claim that every unrelated QBO route has become a hosted multi-user authorization system. Sessions are stored hashed in process memory and end when the QBO server restarts.

## Product workflow

1. The user selects **Send feedback**.
2. If signed out, QBO opens its sign-in dialog and continues to the report after successful sign-in.
3. The user chooses **Report a Problem**, **Request a Feature**, or **Submit Feedback**.
4. The user enters a title and explanation, optionally adds a reviewed PNG/JPEG/WebP screenshot, and may refine the contact name/email.
5. QBO sends the report through its server using a stable submission ID.
6. Ticket Snitch returns one case key and a private receipt. Explicit retry reuses the same idempotency identity, so it does not create a duplicate case.
7. QBO stores only the opaque receipt handle in browser storage under a non-secret scope derived for the signed-in user and configured project.
8. **My reports** uses that handle through the QBO server to show only public-safe status, public summaries, public updates, and whether the team needs a reply. If the short-lived report token expires during a long session, QBO renews it and retries the same receipt action once.
9. Reporter replies become external comments in Ticket Snitch. **Fixed / Not fixed** becomes reporter validation evidence.
10. The Ticket Snitch owner remains responsible for authoritative transitions and final closure.

Type mapping:

- Problem -> Ticket Snitch `problem_report`
- Feature request -> `feature_request`
- Feedback -> `improvement`

## Privacy boundary

Always submitted:

- report type, title, and explanation;
- the signed-in QBO reporter identity;
- current QBO route and a page URL with query string and fragment removed;
- application version, observed time, request ID, browser user-agent, viewport, language, timezone, safe error code, and server-derived IP address.

Submitted only when entered or selected:

- optional contact-name/email refinements;
- one explicitly captured or selected PNG, JPEG, or WebP screenshot, limited to 5 MB by QBO.

Never submitted by this workflow:

- passwords, cookies, access tokens, authorization headers, or Ticket Snitch credentials;
- payment information;
- raw or unrestricted logs;
- URL query strings or fragments;
- Gmail/customer content;
- AI prompts, responses, or conversation history;
- background screenshots, screen recording, audio, or a file the user did not explicitly select.

QBO runtime diagnostics also retain route paths only; query strings and fragments are stripped before a request can appear in the runtime-health surface.

## Receipt security and isolation

`QBO_REPORTING_SECRET` is a stable server-only secret used to encrypt Ticket Snitch receipt tokens and derive a non-secret browser-storage scope for each signed-in QBO user and project. It is not a login password or a Ticket Snitch credential.

The raw Ticket Snitch receipt never enters browser JavaScript or local storage. Its opaque QBO handle is authenticated encryption bound to the QBO user ID. Tampering, expiry, project-secret rotation, or use by another QBO user is rejected before Ticket Snitch is called.

The 15-minute report token is intentionally shorter-lived than the private receipt. Loading, replying to, validating, or submitting from a long-open dialog renews an expired token and retries the same idempotent operation once; it does not create a second case or grant new authority.

Clearing browser storage removes the local **My reports** list but does not delete the Ticket Snitch work item. Rotating `QBO_REPORTING_SECRET` invalidates outstanding opaque handles and changes browser-storage scope, so keep it stable and private for an activated environment.

## Configuration

Generate a local password hash interactively:

```powershell
npm run auth:hash-password
```

Set these only in the approved QBO server secret environment:

```dotenv
QBO_AUTH_MODE=password
QBO_AUTH_USER_ID=qbo-local-user
QBO_AUTH_USER_NAME=QBO Escalations user
QBO_AUTH_USER_EMAIL=
QBO_AUTH_PASSWORD_HASH=scrypt$v1$<salt>$<derived-key>
QBO_AUTH_SESSION_TTL_MS=43200000
QBO_AUTH_ALLOWED_ORIGINS=http://localhost:5174,http://127.0.0.1:5174
QBO_AUTH_COOKIE_SECURE=0

QBO_REPORTING_SECRET=<at-least-32-random-characters>

TICKET_SNITCH_API_URL=http://127.0.0.1:4300/api/v1
TICKET_SNITCH_API_KEY=ts_<report-key-id>.<secret>
TICKET_SNITCH_EVIDENCE_API_KEY=ts_<evidence-key-id>.<secret>
TICKET_SNITCH_AGENT_API_KEY=ts_<agent-key-id>.<secret>
TICKET_SNITCH_PROJECT_ID=<Ticket Snitch project UUID>
TICKET_SNITCH_REPORT_ALLOWED_ORIGINS=http://localhost:5174,http://127.0.0.1:5174
```

Use `QBO_AUTH_COOKIE_SECURE=0` only for approved local HTTP. Leave it unset for HTTPS production so Secure cookies are the default.

Ticket Snitch credentials remain least-privileged:

- reporting system: `work-items:create`;
- evidence forwarder: `evidence:create`;
- QBO casework agent: `work-items:read`, `comments:create`, `evidence:create`, `transitions:create`, and `proposals:create` (legacy local keys with `work-items:update` remain migration-compatible).

`TICKET_SNITCH_REPORT_PROXY_SECRET` is separate. It protects trusted server-to-server casework routes and is never required by or exposed to the browser reporting form.

## Activation and verification checklist

No environment is activated merely because source and tests pass.

1. Verify the exact QBO and Ticket Snitch local-development database targets without printing credentials.
2. Run Ticket Snitch `npm run db:prepare` only against the explicitly approved local-development database.
3. Confirm required indexes and readiness, including customer receipt/accountability indexes.
4. Restart only the approved local Ticket Snitch and QBO services.
5. Confirm exactly one listener per configured port and healthy/readiness responses.
6. Sign in to QBO and submit one harmless report with a unique title.
7. Verify one Ticket Snitch case, correct project, correct authenticated reporter, private evidence, and one stable idempotency identity.
8. Use **My reports** to open the receipt, read public-safe status, send a reporter reply, and submit **Fixed** and **Not fixed** validation in controlled test cases.
9. From Ticket Snitch, publish a public update, request reporter information, move through waiting/follow-up/verification, and confirm QBO reflects only public-safe data.
10. Prove that a different QBO user/session cannot use another user’s reporting token or receipt handle.
11. Verify no raw receipt, credential, query string, cookie, private note, unrestricted log, or customer data appears in browser storage, browser responses, runtime diagnostics, or public updates.
12. Preserve request IDs, case key, test results, and browser screenshots as activation evidence.

### Approved local activation record — 2026-07-24

The approved local-development environment completed this checklist. Ticket Snitch index preparation and readiness passed; the four approved local listeners were restarted and rechecked; signed-in case `QBO-3` proved screenshot evidence, one user-bound **My reports** receipt, public update/reply, waiting plus due follow-up, inert agent proposal plus owner approval, acknowledged handoff plus owner application, **Not fixed**, repair, **Fixed**, and owner-only closure. QBO displayed only the public-safe projection, while Ticket Snitch displayed the screenshot and append-only owner history. Focused privacy/isolation/idempotency tests and both isolated cross-repository acceptances passed. No production, staging, deployment, backup, restore, external customer system, or unrelated repository was touched.

## Failure behavior

- Signed out or expired session: the draft remains in component state and QBO asks the user to sign in again.
- Reporting unavailable: the UI explains whether sign-in, receipt security, or the Ticket Snitch connector needs configuration.
- Offline: drafts, screenshots, replies, and validation notes remain in the browser UI for explicit retry.
- Screenshot attachment failure after case creation: the case remains safe and retry uses the original submission/evidence identity.
- Invalid, expired, revoked, tampered, wrong-user receipt: QBO refuses it before forwarding.
- Stale work-item version during reporter validation: Ticket Snitch returns a structured conflict; no hidden retry changes authoritative state.
- Expired short-lived report token: QBO renews it and retries the same idempotent action once; a truly invalid, revoked, or wrong-user receipt still fails closed.
