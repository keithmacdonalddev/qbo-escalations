# Ticket Snitch reporting for QBO Escalations

QBO Escalations includes a native **Send feedback** form for problems, feature requests, and feedback. The browser sends the form to the QBO server. Only the QBO server talks to Ticket Snitch, so the Ticket Snitch credential is never placed in browser code.

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

Ticket Snitch remains responsible for human review, priority, ownership, evidence, action, verification, and closure. A project credential cannot declare a confirmed bug or make those owner decisions.

## Signed-in reporting identity

QBO Escalations now supports an opt-in first-party password session for identity-bound reporting in its current single-user deployment. The password is stored only as a scrypt hash in the server secret environment. A successful login creates a random opaque session cookie that is HttpOnly, SameSite=Strict, time-bounded, Secure by default in production, and stored only as a hash in server memory. Logout or server restart invalidates it.

The report route reads the user ID, name, and optional email from the verified server session. Browser-supplied identity, role, project, workspace, owner, priority, severity, and status fields are ignored. When authentication is disabled or misconfigured, QBO remains usable under its existing local deployment boundary, but user report submission is unavailable rather than assigning an invented identity.

This is one first-party identity for the current local single-user deployment. It is not a multi-user account platform and does not claim to retrofit authorization onto every unrelated QBO route. A future hosted or multi-user deployment needs registration/invitations or an external identity provider, durable shared sessions, roles, recovery, and route-by-route authorization review.

Gmail OAuth accounts are connected services, not QBO application identities, and must not be used as a substitute.

## Activation steps requiring a human

Do not put live values in source control. Use the placeholders in `server/.env.example`.

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
   - Codex agent: `work-items:read`, `work-items:update`, `comments:create`, `evidence:create`, and `transitions:create`.
4. In the approved QBO server secret environment, set:
   - `TICKET_SNITCH_API_URL`
   - `TICKET_SNITCH_API_KEY`
   - `TICKET_SNITCH_EVIDENCE_API_KEY`
   - `TICKET_SNITCH_AGENT_API_KEY`
   - `TICKET_SNITCH_PROJECT_ID`
   - `TICKET_SNITCH_REPORT_ALLOWED_ORIGINS` for development or any separate web origin
5. Restart or deploy only the approved QBO environment.
6. Select the QBO account control, sign in, open **Send feedback**, submit a harmless test report, and verify the returned case and reporter in the intended Ticket Snitch project.
7. Sign out and prove that report bootstrap/submission is refused, then sign in again and preserve the QBO request ID and Ticket Snitch case key as activation evidence.

The connection is not live until this runtime check passes. Credential creation, environment writes, service restarts, database preparation, deployment, and production authentication are intentionally not performed by automated repository tests.

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
