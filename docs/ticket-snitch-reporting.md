# Ticket Snitch reporting for QBO Escalations

QBO Escalations includes a native **Send feedback** form for problems, feature requests, and feedback. The same dialog includes **My reports**, where the signed-in user can read public-safe status, reply, and confirm **Fixed** or **Not fixed** without a Ticket Snitch account. The browser sends every action to the QBO server. Only the QBO server talks to Ticket Snitch, so project credentials and raw Ticket Snitch receipt tokens are never placed in browser code.

## Local development status

The original report/screenshot integration was locally activated and verified on 2026-07-23. Its three scoped Ticket Snitch keys remain only in the ignored QBO server `.env`; this follow-up phase adds no new secret. The new Ticket Snitch collections and indexes still require the approved upgrade sequence—`npm run db:prepare`, then a Ticket Snitch/QBO service restart—before the running local applications can use **My reports**, accountability queues, handoffs, and proposals. That state-changing activation was not run as part of the code-only verification documented here.

To use it, keep one PowerShell terminal for each app and run these commands only when the apps are not already running:

```powershell
cd C:\Projects\ticket-snitch
npm run dev
```

```powershell
cd C:\Projects\qbo-escalations
npm run dev
```

After that upgrade, open QBO Escalations at `http://localhost:5174`, sign in, select **Send feedback**, optionally add a screenshot, and submit. The confirmation shows the Ticket Snitch case key and **View report status**. Later, use **Send feedback → My reports** to read owner-approved updates, reply, or confirm the outcome. Open Ticket Snitch at `http://localhost:5176` to review the case, evidence, reporter conversation, Codex proposals, handoffs, stalled-work signals, and human verification/closure controls.

## What works in code

- Problem reports map to Ticket Snitch `problem_report` items for human confirmation.
- Feature requests map to `feature_request`.
- Feedback maps to `improvement`.
- The report route requires a signed-in QBO server session and derives reporter identity only from that session.
- The QBO server owns project mapping.
- A short-lived anti-forgery token bound to the session plus an exact-origin check protects the browser endpoint.
- A stable report-draft ID makes an explicit retry return the original case instead of creating a duplicate.
- The user chooses whether basic diagnostics are included.
- The user may deliberately capture one browser-selected tab, window, or screen, add an image file, or paste an image.
- Capture never starts automatically, never requests audio, takes one still frame, and stops every sharing track immediately.
- The user can preview, remove, retake, or replace the image before sending it.
- Screenshot bytes are verified, bounded, normalized, and stripped of unnecessary metadata before Ticket Snitch stores them.
- Case and screenshot retries have separate stable identities, so a partial upload failure cannot duplicate either record.
- Query strings, URL fragments, cookies, tokens, headers, logs, Gmail content, and arbitrary browser fields are not forwarded.
- The user receives the Ticket Snitch case key when creation succeeds.
- Each successful report can issue a revocable, expiring customer receipt that grants access only to that report's public-safe projection.
- The QBO server encrypts the raw Ticket Snitch receipt into a signed-in-user-bound `qtr_` handle before it reaches browser storage.
- **My reports** excludes internal comments, evidence, audit history, owner identity, priority, severity, and other private workflow data.
- Reporter replies and outcome confirmations use stable action IDs, so retrying cannot create duplicate messages or confirmations.
- **Fixed** and **Not fixed** record customer validation evidence; they never close, reopen, or otherwise change a case automatically.

Ticket Snitch remains responsible for human review, priority, ownership, evidence, action, verification, and closure. A project credential cannot declare a confirmed bug or make those owner decisions.

## Signed-in reporting identity

QBO Escalations now supports an opt-in first-party password session for identity-bound reporting in its current single-user deployment. The password is stored only as a scrypt hash in the server secret environment. A successful login creates a random opaque session cookie that is HttpOnly, SameSite=Strict, time-bounded, Secure by default in production, and stored only as a hash in server memory. Logout or server restart invalidates it.

The report route reads the user ID, name, and optional email from the verified server session. Browser-supplied identity, role, project, workspace, owner, priority, severity, and status fields are ignored. When authentication is disabled or misconfigured, QBO remains usable under its existing local deployment boundary, but user report submission is unavailable rather than assigning an invented identity.

This is one first-party identity for the current local single-user deployment. It is not a multi-user account platform and does not claim to retrofit authorization onto every unrelated QBO route. A future hosted or multi-user deployment needs registration/invitations or an external identity provider, durable shared sessions, roles, recovery, and route-by-route authorization review.

Gmail OAuth accounts are connected services, not QBO application identities, and must not be used as a substitute.

## Upgrade and activation checklist

The original intake and screenshot workflow completed its local activation. Run the following checklist for this follow-up phase in local development, or for the complete workflow in another approved environment. Do not put live values in source control; use the placeholders in `server/.env.example`.

1. Run `npm run auth:hash-password` locally. It prompts without echoing the password and prints a scrypt hash. Copy only the resulting hash into the approved secret environment; do not commit it.
2. Configure the QBO reporting identity:
   - `QBO_AUTH_MODE=password`
   - `QBO_AUTH_USER_ID`
   - `QBO_AUTH_USER_NAME`
   - optional `QBO_AUTH_USER_EMAIL`
   - `QBO_AUTH_PASSWORD_HASH`
   - `QBO_AUTH_ALLOWED_ORIGINS` when the browser origin differs from the API host, such as Vite development
   - leave secure cookies enabled for HTTPS production
3. In Ticket Snitch, confirm the QBO Escalations project and create three separate credentials:
   - reporting system: `work-items:create` only;
   - evidence forwarding system: `evidence:create` only;
   - Codex agent: `work-items:read`, `comments:create`, `evidence:create`, `transitions:create`, and `proposals:create`. Existing local Codex credentials with `work-items:update` remain migration-compatible, but new credentials should use `proposals:create` instead.
4. In the approved QBO server secret environment, set:
   - `TICKET_SNITCH_API_URL`
   - `TICKET_SNITCH_API_KEY`
   - `TICKET_SNITCH_EVIDENCE_API_KEY`
   - `TICKET_SNITCH_AGENT_API_KEY`
   - `TICKET_SNITCH_PROJECT_ID`
   - `TICKET_SNITCH_REPORT_ALLOWED_ORIGINS` for development or any separate web origin
5. In the specifically approved Ticket Snitch environment, run `npm run db:prepare` so the new customer-receipt, validation, handoff, proposal, and accountability indexes are present.
6. Restart or deploy only the approved Ticket Snitch and QBO environments.
7. Select the QBO account control, sign in, open **Send feedback**, submit a harmless test report, and verify the returned case and reporter in the intended Ticket Snitch project.
8. Open **Send feedback → My reports**. Verify public-safe status, an idempotent reporter reply, **Fixed** or **Not fixed** confirmation, exclusion of internal-only details, and receipt revocation from Ticket Snitch.
9. In Ticket Snitch, verify the daily/weekly operating brief, waiting/follow-up/stalled queues, acknowledged handoff flow, and owner approval/rejection of a harmless Codex proposal.
10. Sign out and prove that report bootstrap, submission, and receipt access are refused, then sign in again and preserve the QBO request ID and Ticket Snitch case key as activation evidence.

No environment is considered upgraded until its runtime checks pass. In this local checkout, the original intake/screenshot runtime remains verified and the follow-up phase is code-complete with isolated/API/component/real-HTTP verification. It remains runtime-pending until steps 5–10 are explicitly approved and performed.

## Submitted data

Always submitted:

- selected report type
- title and explanation
- current QBO route name and a page URL with query/fragment removed
- application version and submission time
- a request ID for troubleshooting
- server-owned reporter attribution

Submitted only with the user's diagnostics checkbox:

- browser user-agent
- viewport size
- browser language
- a safe application error code when one is available

Submitted only after the user explicitly chooses and reviews it:

- one PNG, JPEG, or WebP screenshot, limited to 5 MB in QBO
- the safe filename and a fixed evidence description
- no audio, OCR, background capture, or screen recording

Never submitted by this workflow:

- passwords, access tokens, cookies, authorization headers, or Ticket Snitch credentials
- payment information
- raw or unrestricted logs
- URL query strings or fragments
- Gmail/customer content
- AI prompts, responses, or conversation history
- any screenshot or file the user did not explicitly select and review

## Automation proxy remains separate

The existing `TICKET_SNITCH_REPORT_PROXY_SECRET` protects trusted server-to-server status and agent operations. It is not exposed to or required by the browser form. Those routes use `TICKET_SNITCH_AGENT_API_KEY`; the native browser report uses the create-only reporting key, and user-approved screenshots use the separate evidence-only key. Leaving the proxy secret unset keeps automation routes disabled without disabling native user reporting.
