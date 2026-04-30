# Implementation Plan: Email Change Flow

This is a reference example showing the expected structure and depth of a plan. The feature is fictional but realistic. Note: this plan is the one that was implemented (and subsequently reviewed) in `cto-review/examples/sample-review.md` — the pair shows a full plan-to-review loop.

---

## 1. Problem

Users cannot change the email address on their account without contacting support. Support sees roughly 40 such requests per month, each taking 1–2 business days and requiring manual identity verification. About 15% of users abandon the change due to friction. Self-service email change is a common expectation and the manual flow is expensive for both users and support staff.

## 2. Scope

### In scope
- Self-service email change initiated from Settings → Account.
- Verification email sent to the NEW address with a time-limited token.
- Invalidation of prior tokens when a new change is requested.
- Rate limiting on both request and confirm endpoints.
- Audit log entry for every successful change.

### Out of scope
- Changing email for accounts linked to SSO (requires different verification posture — separate flow).
- Bulk email migration for organization admins.
- Changing email as part of account recovery.

### Deferred
- Notification email sent to the OLD address as a security alert. `[deferred]`
- Admin-visible report of recent email changes. `[deferred]`

## 3. Acceptance criteria

1. A logged-in user can submit a new email address from Settings → Account.
2. The system sends a verification email to the new address with a link that expires after 1 hour.
3. Clicking the verification link within the expiry window updates the account email and returns the user to Settings with a confirmation toast.
4. If the user requests a second email change before confirming the first, the first token is invalidated immediately and only the most recent token is valid.
5. Both request and confirm endpoints are rate limited: 5 requests per hour per user, 20 per hour per IP.
6. Every successful email change creates an audit log entry containing old email, new email, timestamp, and requesting IP.
7. If the audit log write fails, the email change is rolled back or queued for retry — never silently discarded.
8. Distinct failure modes (expired token, invalid token, email already in use, network failure) each show a specific actionable error message to the user.

## 4. Technical approach

### Data flow

```
User submits new email in Settings form
 → client POST /api/account/email-change { newEmail }
 → server/routes/account.js (request handler, rate-limited)
 → server/services/emailChange.service.js (invalidate prior tokens, create new)
 → server/models/EmailChangeToken (new collection, stores token + expiry + userId)
 → sends verification email to newEmail
 → user clicks link in email
 → client GET /confirm?token=...
 → server/routes/account.js (confirm handler, rate-limited)
 → server/services/emailChange.service.js (validates token, updates User.email)
 → writes audit log entry (awaited)
 → returns success to client
 → Settings page shows confirmation toast
```

### Files to create
- `server/services/emailChange.service.js` — handles the request/confirm lifecycle and token invalidation.
- `server/models/EmailChangeToken.js` — new collection with expiry index and status field.
- `server/emails/templates/emailChangeVerify.hbs` — email template for the verification link.
- `client/src/components/settings/EmailChangeForm.jsx` — form UI with error-code-to-message mapping.
- `client/src/hooks/useEmailChange.js` — client-side API client for the two endpoints.

### Files to modify
- `server/routes/account.js` — add request and confirm routes, attach rate limiter.
- `client/src/pages/Settings.jsx` — mount the new EmailChangeForm component.

### Key decisions
- **Tokens live in a separate collection**, not on the User document. This supports future verification flows (phone change, 2FA reset) without schema sprawl and makes invalidation explicit. Avoids the trap of storing a single `pendingToken` field on User that can be silently overwritten.
- **Token expiry is 1 hour.** Short window limits attack surface on leaked tokens; matches acceptance criterion 2.
- **Rate limiting uses the existing `rateLimiter` middleware** already applied to the login route. No new infrastructure.

## 5. Risks and edge cases

**Race condition on concurrent requests.**
*What happens:* User submits two email-change requests within seconds. Without explicit invalidation, both tokens could briefly be valid, creating a window for account takeover if one of the requests was from an attacker.
*How we handle it:* On every new request, the service marks all prior unused tokens for this user as invalidated BEFORE writing the new one. Confirmed atomic at the DB level.

**Uniqueness conflict on the new email.**
*What happens:* User A requests a change to `shared@example.com`, but user B already has that email. If we only check at confirm time, user A proceeds through verification and fails at the last step — bad UX.
*How we handle it:* Check `User.findOne({ email: newEmail })` at request time. Return `EMAIL_IN_USE` before sending any verification email.

**Audit log service down.**
*What happens:* The audit write fails after the email has been updated. User is told "success" but no trail exists — auditor sees a mystery email change.
*How we handle it:* Await the audit write. On failure, enqueue to the retry queue. If the queue is also unavailable, roll back the email change and return an error to the user. Silent swallowing is explicitly forbidden.

**Expired or reused token.**
*What happens:* User clicks a link after 1 hour, or a token that was already consumed.
*How we handle it:* Confirm handler returns distinct error codes — `TOKEN_EXPIRED`, `TOKEN_USED`, `TOKEN_INVALID` — each mapped to a specific user-facing message per acceptance criterion 8.

## 6. Exceeds bar

- Every backend error code maps to a specific, actionable user-facing message. No generic "something went wrong." Users with expired tokens see "This confirmation link has expired. Please request a new email change from Settings."
- Settings page shows pending email change state with a "cancel" action. Users can see and abort a request in flight.
- Structured logging with correlation IDs threaded through the request handler, service, and audit log calls. Makes incident debugging tractable.
- If the user's account is SSO-linked, the form is disabled with a link to the SSO-specific flow — no silent failure or confusing error.

## Testing strategy

- **Unit tests** for the service: request lifecycle, invalidation on new request, uniqueness check, token expiry, audit rollback.
- **Integration tests** for both endpoints with a mock email transport.
- **Manual scenarios** to verify before merge:
  - Expired token shows the right message.
  - Second request invalidates the first (cannot use old link).
  - Rate limit triggers after 5 requests within an hour.
  - Audit failure rolls back the email update.
  - SSO account shows the redirect message.

## Dependencies

None required before this ships. This may slightly unblock future work on phone-number verification, which can reuse the `EmailChangeToken` pattern.
