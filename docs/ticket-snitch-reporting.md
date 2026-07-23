# Ticket Snitch reporting for QBO Escalations

QBO Escalations includes a native **Send feedback** form for problems, feature requests, and feedback. The browser sends the form to the QBO server. Only the QBO server talks to Ticket Snitch, so the Ticket Snitch credential is never placed in browser code.

## What works in code

- Problem reports map to Ticket Snitch `problem_report` items for human confirmation.
- Feature requests map to `feature_request`.
- Feedback maps to `improvement`.
- The QBO server owns reporter identity and project mapping.
- A short-lived anti-forgery token and exact-origin check protect the browser endpoint.
- A stable report-draft ID makes an explicit retry return the original case instead of creating a duplicate.
- The user chooses whether basic diagnostics are included.
- Query strings, URL fragments, cookies, tokens, headers, logs, Gmail content, and arbitrary browser fields are not forwarded.
- The user receives the Ticket Snitch case key when creation succeeds.

Ticket Snitch remains responsible for human review, priority, ownership, evidence, action, verification, and closure. A project credential cannot declare a confirmed bug or make those owner decisions.

## Current identity boundary

QBO Escalations is currently a local single-user application and does not have an application account/login session. The reporting server therefore uses the configured `TICKET_SNITCH_REPORTER_ID` and `TICKET_SNITCH_REPORTER_NAME` as trusted attribution. Browser input cannot override them.

This is suitable for the current local single-user deployment. It must not be described as per-account sign-in. Before a remote or multi-user deployment, replace the configured identity with a reporter derived from that deployment's authenticated QBO server session.

Gmail OAuth accounts are connected services, not QBO application identities, and must not be used as a substitute.

## Activation steps requiring a human

Do not put live values in source control. Use the placeholders in `server/.env.example`.

1. In Ticket Snitch, confirm the QBO Escalations project and create a project credential with only `work-items:create` scope.
2. In the approved QBO server secret environment, set:
   - `TICKET_SNITCH_API_URL`
   - `TICKET_SNITCH_API_KEY`
   - `TICKET_SNITCH_PROJECT_ID`
   - `TICKET_SNITCH_REPORTER_ID`
   - `TICKET_SNITCH_REPORTER_NAME`
   - optional `TICKET_SNITCH_REPORTER_EMAIL`
   - `TICKET_SNITCH_REPORT_ALLOWED_ORIGINS` for development or any separate web origin
3. Restart or deploy only the approved QBO environment.
4. Open **Send feedback**, submit a harmless test report, and verify the returned case in the intended Ticket Snitch project.
5. Preserve the QBO request ID and Ticket Snitch case key as activation evidence.

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

Never submitted by this workflow:

- passwords, access tokens, cookies, authorization headers, or Ticket Snitch credentials
- payment information
- raw or unrestricted logs
- URL query strings or fragments
- Gmail/customer content
- AI prompts, responses, or conversation history
- screenshots or file attachments

## Automation proxy remains separate

The existing `TICKET_SNITCH_REPORT_PROXY_SECRET` protects trusted server-to-server status, agent reporting, read, update, comment, transition, and evidence operations. It is not exposed to or required by the browser form. Leaving it unset keeps those automation routes disabled without disabling native user reporting.
