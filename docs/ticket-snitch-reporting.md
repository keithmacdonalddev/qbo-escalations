# Ticket Snitch reporting for QBO Escalations

QBO Escalations has one **Feedback and reports** control for problems, feature requests, and general feedback. It always opens a new report and does not require a QBO-specific account or a Ticket Snitch login.

The authority is split deliberately:

- the server-side Ticket Snitch project API key authorizes this QBO installation to create reports in the configured project;
- a signed anonymous browser cookie binds the short-lived form token to the browser that requested it;
- optional name and email fields identify the reporter only when the person chooses to provide them.

The anonymous cookie is continuity, not an account. It grants no Ticket Snitch owner role, project scope, or authority over report status. Optional name/email values are self-reported and unverified; they are contact metadata, not proof of identity. Ticket Snitch's normal sign-in remains only for owners and members who manage the work.

## Local development status

The Ticket Snitch API, project ID, and three scoped project keys remain only in the ignored QBO server `.env`. Anonymous browser continuity also requires a dedicated `QBO_REPORTING_SECRET`, which is present in the ignored local environment and documented as a placeholder in `server/.env.example`.

This reporting-identity adjustment adds no database collection or index. It does not require `npm run db:prepare`. The already-running QBO and Ticket Snitch services were not restarted during code verification, so the live pages continue to use their loaded code until an explicitly approved restart.

When the approved services are running, open QBO Escalations, select **Send feedback**, choose the report type, leave the contact fields blank for an anonymous report or enter a name/email for future follow-up, and submit. The confirmation shows the Ticket Snitch case key.

## Product workflow

- Problem maps to Ticket Snitch `problem_report` for human confirmation.
- Feature request maps to `feature_request`.
- Feedback maps to `improvement`.
- Blank name/email fields create an anonymous report labelled **Anonymous QBO reporter**.
- A supplied name and/or email is normalized and stored as self-reported reporter contact.
- The QBO server owns project mapping, reporter actor ID, priority, and severity. Browser-supplied authority fields are ignored.
- A short-lived form token is bound to both the exact QBO origin and the signed anonymous browser identity.
- A stable draft ID makes an explicit retry return the original case rather than creating a duplicate.
- Required basic technical metadata is submitted with every report; there is no opt-out checkbox.
- The QBO server derives the report IP address from the request. The browser cannot supply or override it.
- A screenshot is submitted only when the user explicitly captures or chooses one.
- The current modal contains no report-history tab or report-status workflow. Those are future product options, not placeholder UI.

Ticket Snitch remains responsible for human review, priority, ownership, evidence, action, verification, and closure. Neither the QBO project key, anonymous cookie, nor optional contact text can make those owner decisions.

## Security boundary

On the first reporting request, QBO creates a random browser identifier, signs it with `QBO_REPORTING_SECRET`, and returns it in an HttpOnly, SameSite=Strict cookie limited to `/api/ticket-snitch/reporting`. JavaScript cannot read the cookie. Production uses the Secure flag by default.

QBO derives a non-secret browser scope from that identifier. A form token from one browser fails in another browser.

Clearing site cookies or rotating `QBO_REPORTING_SECRET` invalidates the browser identity and its outstanding form tokens. Keep that secret stable, private, backed up with the deployment configuration, and at least 32 random characters.

Project API keys and raw Ticket Snitch receipts remain server-side. Query strings, URL fragments, cookies, tokens, authorization headers, logs, Gmail content, and arbitrary browser fields are not forwarded.

IP address handling follows the Express request boundary. By default, QBO uses the direct socket address. Set `QBO_TRUST_PROXY=1` only when QBO is directly behind one controlled reverse proxy that overwrites forwarded headers. Never enable it for an unknown or multi-hop proxy chain, because that could let a requester spoof the recorded address.

## Configuration and activation checklist

1. In Ticket Snitch, confirm the QBO Escalations project and create separate credentials:
   - reporting system: `work-items:create` only;
   - evidence forwarding system: `evidence:create` only;
   - Codex agent: `work-items:read`, `comments:create`, `evidence:create`, `transitions:create`, and `proposals:create`. Existing credentials with `work-items:update` remain migration-compatible.
2. In the approved QBO server secret environment, set:
   - `QBO_REPORTING_SECRET` to at least 32 random characters;
   - `TICKET_SNITCH_API_URL`;
   - `TICKET_SNITCH_API_KEY`;
   - `TICKET_SNITCH_EVIDENCE_API_KEY`;
   - `TICKET_SNITCH_AGENT_API_KEY`;
   - `TICKET_SNITCH_PROJECT_ID`;
   - `TICKET_SNITCH_REPORT_ALLOWED_ORIGINS` for development or any separate web origin;
   - optionally, `TICKET_SNITCH_DATA_USE_URL` when the public Ticket Snitch data-use page is not at `<TICKET_SNITCH_API_URL>/data-use`;
   - `QBO_TRUST_PROXY=1` only for a deployment directly behind one controlled reverse proxy.
3. Keep `QBO_REPORTING_COOKIE_SECURE` unset for HTTPS production. Set it to `0` only for an approved local HTTP environment.
4. Restart or deploy only the explicitly approved QBO environment. No Ticket Snitch restart or database preparation is required solely for this identity change.
5. Open **Feedback and reports** directly and submit one harmless report with blank contact fields. Verify the Ticket Snitch reporter is pseudonymous and the intended project receives it.
6. Submit another harmless report with optional name/email. Verify the values are normalized and remain ordinary reporter metadata—not an owner or member identity.
7. In a separate browser identity, prove that the original form token is refused.
8. Verify the low-emphasis **here** link opens Ticket Snitch's public data-use page in a new tab.
9. Verify internal-only details stay excluded.
10. Preserve the QBO request ID and Ticket Snitch case key as activation evidence.

No environment is considered activated until its runtime checks pass.

## Submitted data

Always submitted:

- selected report type;
- title and explanation;
- current QBO route and a page URL with query/fragment removed;
- application version and submission time;
- a request ID for troubleshooting;
- a server-derived pseudonymous reporter ID;
- browser user-agent;
- viewport size;
- browser language and timezone;
- a safe application error code when available;
- a server-derived IP address.

Submitted only when the reporter enters it:

- name;
- email address.

These contact fields are self-reported, unverified, and intended for identification and future follow-up. Leaving both blank keeps the report anonymous.

Submitted only after explicit selection and review:

- one PNG, JPEG, or WebP screenshot, limited to 5 MB in QBO;
- the safe filename and a fixed evidence description;
- no audio, OCR, background capture, or screen recording.

Never submitted by this workflow:

- passwords, access tokens, cookies, authorization headers, or Ticket Snitch credentials;
- payment information;
- raw or unrestricted logs;
- URL query strings or fragments;
- Gmail/customer content;
- AI prompts, responses, or conversation history;
- a screenshot or file the reporter did not explicitly select and review.

## Automation proxy remains separate

`TICKET_SNITCH_REPORT_PROXY_SECRET` protects trusted server-to-server status and agent operations. It is not exposed to or required by the browser form. Those routes use `TICKET_SNITCH_AGENT_API_KEY`; native browser reports use the create-only reporting key, and approved screenshots use the evidence-only key. Leaving the proxy secret unset keeps automation routes disabled without disabling native user reporting.
