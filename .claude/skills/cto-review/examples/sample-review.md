# CTO Review: Email Change Flow — FAIL

This is a reference example showing the expected structure, tone, and depth of a CTO review output. The feature, code paths, and findings below are fictional but realistic.

---

## 1. Summary

- **Gate Decision: FAIL** — 1 Critical, 4 High findings unresolved. **Do not ship.**
- **Overall score:** 4/10 (minimum of section scores; intent gate also fails but minimum dominates)
- **Findings:** Critical: 1 | High: 4 | Medium: 2 | Low: 1
- **Intent Gate:** FAIL — implementation does not exceed user intent (score would be capped at 7 regardless)
- **Next step:** Address the 5 non-negotiable items in section 10, then re-run `/cto-review email-change-flow`. A new timestamped report will generate; the gate will re-evaluate against the fresh state.

## 2. Scope

Reviewed commits from `feat/email-change` branch, 8 files modified, all read completely.

**Planned changes:**

| File | Role | Lines changed |
| ---- | ---- | ------------- |
| `server/routes/account.js` | route | +47 |
| `server/services/emailChange.service.js` | service | +112 (new file) |
| `server/models/User.js` | model | +18 |
| `client/src/components/settings/EmailChangeForm.jsx` | component | +94 (new file) |
| `client/src/hooks/useEmailChange.js` | hook | +36 (new file) |
| `server/emails/templates/emailChangeVerify.hbs` | template | +22 (new file) |

**Unplanned changes:**

| File | Role | Lines changed | Notes |
| ---- | ---- | ------------- | ----- |
| `server/models/User.js` | model | +6 (outside planned email-change block) | Modified `updatedAt` trigger logic for all users |
| `server/middleware/auth.js` | middleware | +3 | Added a header read; unclear why it belongs to this feature |

## 3. Plan Fidelity

| Plan item | Status | Evidence | Notes |
| --------- | ------ | -------- | ----- |
| `POST /api/account/email-change` route | Implemented | `routes/account.js:23` | |
| Send verification email to new address with time-limited token | Implemented | `emailChange.service.js:34` | Token expiry 24h — plan said 1h |
| `POST /api/account/email-change/confirm` route | Implemented | `routes/account.js:58` | |
| Update User model to track pending email change | Implemented | `User.js:142` | |
| Settings-page form component | Implemented | `EmailChangeForm.jsx` | |
| Rate limit to prevent abuse | **Missing** | — | No limiter middleware on either route. See Security finding S1. |
| Log email changes for audit | **Partial** | `emailChange.service.js:89` | Log write is fire-and-forget; failures are swallowed. See Failure Modes finding F2. |
| Token expires after 1 hour | **Partial** | `emailChange.service.js:34` | Expiry set to 24h, not 1h. See Logic finding L1. |

Two Missing/Partial items that contradict the plan directly. Three findings below stem from these.

## 4. Cross-Boundary Data Flow Trace

**Path traced:** user submits new email → client hook → route → service → model → DB → verification email → user clicks link → confirm route → service → model update → response → client UI update.

```
EmailChangeForm.jsx:72 (form submit)
  ↓ sends { newEmail: string }
useEmailChange.js:18 (fetch POST /api/account/email-change)
  ↓ forwards body
routes/account.js:23 (handler)
  ↓ calls emailChangeService.request(userId, newEmail)
emailChange.service.js:34 (request)
  ↓ writes { pendingEmail, pendingToken, pendingExpiresAt } to User
User.js:142 (model)
  ↓ save() — schema allows pendingEmail without uniqueness check
DB
  ↓
emailChange.service.js:48 (send verification)
  ↓ mail transport
user's inbox
  ↓ link click → GET confirm URL
routes/account.js:58 (confirm handler)
  ↓ calls emailChangeService.confirm(token)
emailChange.service.js:78 (confirm)
  ↓ finds user by pendingToken
  ↓ updates email = pendingEmail, clears pending fields
  ↓ calls auditLog.record() fire-and-forget
  ↓ returns { ok: true }
client receives 200, shows "email updated" toast
```

**Boundary check findings:**

- Between `emailChange.service.js:34` and `User.js:142`: the service assumes only one pending change per user at a time, but the model does not enforce this. A second request overwrites `pendingToken` but the old token remains valid in the index used by `confirm()`. **→ Security finding S2, Critical.**
- Between `emailChange.service.js:89` and `auditLog.record()`: the service proceeds to return success whether or not the audit write succeeded. **→ Failure Modes finding F2, High.**

## 5. Findings by Framework Section

### Logic and API — Score: 7

**L1 — Medium. Token expiry is 24h, plan specified 1h.**
- File: `emailChange.service.js:34`
- Issue: `pendingExpiresAt = Date.now() + 24*60*60*1000`. Plan specified 1-hour expiry window to limit attack surface on leaked tokens.
- Reproduction: Read the plan, read line 34. Mismatch.
- Fix: Change the multiplier to `1*60*60*1000`, or factor into a `TOKEN_TTL_MS` constant documented to match the plan.

### Data Integrity — Score: 6

**D1 — High. No uniqueness check on `pendingEmail` across users.**
- File: `User.js:142`
- Issue: Two users can have the same `pendingEmail` in flight. When the first confirms, the second's pending entry still points at an email now owned by someone else. If the second confirms, the app will attempt to set a duplicate primary email.
- Reproduction: User A requests change to `shared@example.com`. User B requests change to `shared@example.com`. User A confirms (succeeds). User B confirms. Depending on email uniqueness enforcement, this either crashes the confirm handler or creates duplicate accounts.
- Fix: Add a uniqueness index on `pendingEmail` (partial index excluding null), or reject the request in the service if another user has the same pending email.

### Security — Score: 4

**S1 — High. No rate limiting on email-change request.**
- File: `routes/account.js:23`
- Issue: The plan explicitly required rate limiting. None is applied. An attacker can spam the endpoint to enumerate valid user accounts (timing) or to flood a victim's inbox with verification emails.
- Reproduction: `curl -X POST /api/account/email-change` in a loop for the same session. No throttling occurs.
- Fix: Apply the existing `rateLimiter` middleware (see `server/middleware/rateLimit.js`, already used on login). Suggested: 5 requests per hour per user, 20 per hour per IP.

**S2 — Critical. Stale pending tokens are not invalidated on new request, enabling account takeover.**
- File: `emailChange.service.js:34`
- Issue: When a user requests a second email change, the service overwrites `pendingEmail` and `pendingToken` but does not invalidate the first token. If an attacker submitted the first request (to `attacker@evil.com`), and the user then submits their own request (to `my-new@real.com`), the attacker's original token is still accepted by `confirm()` because the confirm path looks up by token and applies whatever `pendingEmail` is currently stored — which is now the user's own new email, OR, if the attacker submitted AFTER the user, the attacker's email. Either way, the attacker can trigger email transitions the user did not intend.
- Reproduction: Attacker submits change request (as the logged-in user, via XSS or session compromise) to `attacker@evil.com` — gets token T1. User notices, submits their own change to `clean@example.com` — token is overwritten to T2 but T1 remains valid. Attacker uses T1. Account email becomes `attacker@evil.com`. Password reset from the attacker email → full takeover.
- Fix: On each new email-change request, explicitly null out any previous `pendingToken` BEFORE writing the new one. Additionally, store tokens as hashed values in a child collection with an explicit invalidation field, not as a single field on User.

### Failure Modes — Score: 5

**F1 — High. Error messages to user are not actionable.**
- File: `EmailChangeForm.jsx:87`
- Issue: On any backend error, the form shows "Something went wrong. Please try again." The same message fires for expired token, invalid token, email already in use, and network failure. User has no way to self-diagnose.
- Reproduction: Click a verification link after 24 hours. Message: "Something went wrong. Please try again." Trying again will not help — the token is expired, not transient.
- Fix: The service already returns structured error codes (`TOKEN_EXPIRED`, `TOKEN_INVALID`, `EMAIL_IN_USE`). Map each to a user-facing message: e.g., "This confirmation link has expired. Please request a new email change from Settings."

**F2 — High. Audit log failure is silently swallowed.**
- File: `emailChange.service.js:89`
- Issue: `auditLog.record(...).catch(() => {})`. If the audit write fails, the email change still succeeds and the user is told everything worked. Auditor sees a user whose email changed with no log entry.
- Reproduction: Stop the audit service. Request and confirm an email change. Email updates successfully; audit collection has no entry.
- Fix: Await the audit write. If it fails, either (a) roll back the email change and return an error, or (b) write to a retry queue (preferred). Silent swallowing is not acceptable for an audit-required event.

### Performance — Score: 9

No findings.

### Regression Risk — Score: 6

**R1 — Medium. Unplanned change to `User.updatedAt` trigger affects all users.**
- File: `User.js` — changes outside the pending-email block, specifically the pre-save hook.
- Issue: The pre-save hook was modified to update `updatedAt` even when only non-user-initiated fields change. This is outside the email-change scope and affects every code path that writes to User. No mention in the plan, no test coverage added.
- Reproduction: Any write to a User document (e.g., lastLogin update) now bumps `updatedAt`. Any feature that reads `updatedAt` as a proxy for "user edited their profile" — `recent activity` tile on dashboard, for instance — will now show false positives.
- Fix: Either revert this change and open a separate PR, or document the intent in the plan and add regression tests for all features that read `updatedAt`.

**R2 — Low. Auth middleware read of a new header is undocumented.**
- File: `server/middleware/auth.js`
- Issue: Three added lines read `x-email-change-token`. Unclear what this header does or why it belongs in auth middleware for this feature.
- Reproduction: Read the diff. No comment, no test, no plan reference.
- Fix: Document the intent in a comment, add a test for the behavior, or remove if dead.

### Observability — Score: 7

**O1 — Medium. No correlation ID across request → service → audit log.**
- File: `emailChange.service.js` (throughout)
- Issue: If a confirm fails partway through, tracing which request produced which log entry requires matching by timestamp and user ID alone. Project already has `requestId` in the middleware; it isn't threaded through.
- Reproduction: Trigger two parallel confirms for the same user. Look at logs. Which log line belongs to which request? No way to tell.
- Fix: Accept `requestId` as a parameter to `emailChange.service.js` methods, pass it to every log and audit call.

### State Lifecycle — Score: 7

**SL1 — Medium. Pending fields not cleared on user account deletion.**
- File: `User.js:142` (indirect — deletion flow in `account.service.js`)
- Issue: If a user with a pending email change deletes their account, the `pendingEmail` value remains in archived records. Minor data hygiene issue, but if `pendingEmail` uniqueness is later enforced (see D1 fix), archived records could block future legitimate users from claiming that email.
- Reproduction: Create user, request email change to `foo@example.com`, delete account. Attempt to register new user with email `foo@example.com` after uniqueness fix is applied. Potential conflict.
- Fix: Clear pending fields on account deletion, or scope the uniqueness index to active users only.

## 6. Exceeds Expectations Assessment

1. Would a senior engineer be impressed by this code? **No.** The happy path works but security, error handling, and plan fidelity are all below the bar.
2. Are error messages actionable? **No.** Single generic message for every failure mode.
3. Is defensive programming comprehensive? **No.** No race-condition handling, no audit rollback, no token invalidation.
4. Does the architecture make future changes easier? **Neutral.** The service extraction is fine. The single-field token storage on User will hurt when adding other verification flows.
5. If shown to the user right now, would they say "this exceeds what I asked for"? **No.** The plan was followed partially, and a critical security hole was introduced.

**Intent gate: FAIL.** Score would be capped at 7 regardless of section scores. Actual minimum is 4.

## 7. Recommendations to Exceed Intent

| Gap | Current | Exceeding | Recommendation | Effort |
| --- | ------- | --------- | -------------- | ------ |
| Single error message for all failure modes | "Something went wrong" | Each error code maps to a specific, actionable user message | Use existing error codes; add a `errorMessages.js` map on the client | 1 hour |
| Pending change state tied to a single User field | `pendingToken` on User | Child collection `pending_email_changes` with created/expired/used lifecycle | Refactor now; reuse for future verification flows (phone, 2FA reset) | 4 hours |
| No visibility into active pending changes | User has no way to see pending | Show pending state in Settings with a "cancel" action | Add UI affordance plus cancel endpoint | 3 hours |
| Audit failures swallowed | Fire-and-forget | Queue with retry; alert if queue grows | Implement audit queue (or await + fail-closed if infra doesn't exist) | 2 hours |

## 8. What Breaks First

In production, the **rate limiting gap (S1)** will be discovered first — either by a user complaining about email spam after an attacker targets them, or by an external security scan. Cost: reputational, possible email provider rate-limiting the sender domain.

The **critical takeover (S2)** will not be discovered accidentally; it requires a specific sequence. But it will be found eventually, and the blast radius is full account takeover. This is the real reason this can't ship.

## 9. Production Verdict

**Do not ship.** Required before re-review:

1. Fix S2 (stale token invalidation) — non-negotiable.
2. Add rate limiting per the plan (S1).
3. Fix F2 (audit log cannot silently fail).
4. Fix F1 (actionable error messages).
5. Decide on and document the unplanned `updatedAt` change (R1) — ship separately or revert.

Nice-to-haves before re-review: D1, L1, O1, SL1.

## 10. Non-negotiable fixes

- [ ] **S2 (Critical):** Invalidate previous `pendingToken` before writing a new one; move tokens to a separate collection with explicit lifecycle.
- [ ] **S1 (High):** Apply `rateLimiter` to both email-change routes.
- [ ] **F1 (High):** Map backend error codes to actionable user-facing messages in `EmailChangeForm.jsx`.
- [ ] **F2 (High):** Await audit writes; implement retry or fail-closed behavior.
- [ ] **D1 (High):** Add uniqueness constraint on `pendingEmail` (active users only).
