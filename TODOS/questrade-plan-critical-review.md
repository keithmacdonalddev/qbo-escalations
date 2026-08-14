# Critical Review — Questrade Investments Integration Plan

**Reviewing:** `TODOS/questrade_investments_integration_implementation_plan.md` (1,561 lines, status: Proposed)
**Review date:** 2026-08-14
**Reviewer:** Claude Fable 5
**Method:** Full read of the plan, then independent verification of its factual claims against the working tree with fresh tool calls. External Questrade documentation claims were attempted but could not be verified (see Finding 7).

---

## Verdict

**The plan is strong and should proceed — after four fixes.**

This is a well-constructed plan. The safety philosophy is right, the staging is disciplined, and it correctly refuses to hand financial authority to an AI. Most of its claims about this repository check out.

But it has **two security gaps that the plan's own threat model misses**, and **two verified infrastructure assumptions that are currently false**. All four are fixable in hours, not weeks — but three of them need to be fixed *before* Stage 1 starts, because they change what Stage 1 builds.

| | Count |
| --- | --- |
| Blocking (fix before Stage 1) | 3 |
| Significant (fix before the stage it affects) | 4 |
| Minor / worth knowing | 5 |

---

## What the plan gets right

Credit where it's due — these are not obvious, and the plan got them right:

- **"No code path" as the trade safety boundary.** Rather than a disabled button, no trade route/tool/handler is ever written, plus a test that fails if trade-shaped code appears. Absence beats a switch that a bug could flip.
- **Deterministic math before AI.** Risk formulas ship and get hand-verified in Stage 5 *before* any agent touches portfolio data in Stage 6. When an agent later claims "you're over-concentrated," you can check it against arithmetic already proven.
- **Failed refresh preserves the last good snapshot.** The most dangerous failure mode for a financial dashboard is showing partial data as if it were current. The plan blocks publishing an incomplete snapshot at the data layer, not just the UI.
- **Currency never silently combined.** CAD and USD stay separate unless Questrade itself reports a combined figure, which gets labelled as the provider's number.
- **"Missing is unknown, not zero."** A missing balance showing as $0.00 is exactly the kind of quiet lie that costs real money.
- **User acceptance gates are blocking.** "Tests passing is not completion" is stated explicitly and enforced structurally.

The reuse claims in Section 3 are **mostly accurate** — see the verification ledger at the end.

---

## BLOCKING FINDINGS

These change what Stage 1 builds. Fix the plan before writing code.

### B1. Any website you visit can read your entire portfolio (DNS rebinding)

**Severity: High. This is the most important finding in this review.**

The plan's security section says the app is protected because it "requires an approved local browser origin" and is loopback-only (only reachable from your own machine). It names the residual risk as *"malware already running as the same Windows user."*

That understates it. There is a well-known attack called **DNS rebinding** that needs no malware at all — just you visiting a malicious web page in an ordinary browser tab.

**How it works, in plain terms.** A website you visit (`evil.com`) initially resolves to the attacker's real server. A moment later, the attacker changes their DNS record so `evil.com` now points to `127.0.0.1` — your own machine. The attacker's JavaScript, still running in your tab, then requests `http://evil.com:4000/api/investments/...`. Your browser thinks this is the *same site* it's already on, so it applies no cross-origin protection at all — and hands the response back to the attacker's script.

**Why the plan's defenses don't stop it, verified in code:**

- `server/src/lib/origin-policy.js:53` — `if (!normalizedOrigin) return true;`. Requests with no `Origin` header are always allowed. A same-origin GET sends no `Origin` header.
- Nothing anywhere validates the `Host` header. The server never checks *what name* the request arrived under.
- **No authentication exists on the server at all.** Verified: `server/package.json` has 8 direct dependencies (`@anthropic-ai/claude-agent-sdk, cors, dotenv, express, googleapis, mongoose, sharp, ws`) — no `express-session`, no `passport`, no auth library. No auth middleware appears in `server/src/app.js` or `server/src/index.js`. All ~30 `/api/*` routes are open.
- The plan's mitigation for sensitive actions — "JSON, a custom intent header, and a short-lived action intent" — protects *writes* against ordinary cross-site attacks, but **not** against rebinding, because a same-origin request can set custom headers freely with no preflight. And it does nothing for reads, which is where your portfolio lives.

**The fix is small.** Add a `Host` header allowlist middleware: reject any request whose `Host` is not `localhost:4000` / `127.0.0.1:4000` / `[::1]:4000`. About 10 lines, applied at the app level. This is the standard defense and it closes the hole completely.

**Recommended plan amendments:**
1. Add "**Host header validation**" to Section 8 → *Browser-to-local-server protection*, as a required control.
2. Add a row to the Section 8 threat matrix: *DNS rebinding from a visited website → request rejected on Host mismatch → Host-policy route test.*
3. Move it into **Stage 1** implementation (it protects the very first route you add).
4. Correct the documentation claim: the residual risk is malware **or a malicious web page**, not malware alone.

> **Side finding (doc drift):** `.claude/rules/client.md` currently states *"Auth is session-based with HTTP-only cookies."* That is **not true** — no auth exists. An implementer reading that rule file could reasonably assume the API is protected and skip this control. This rule file should be corrected regardless of whether Questrade ships.

---

### B2. Rotating the encryption key can orphan your entire financial history

**Severity: High (data loss, silent).**

The plan uses an **HMAC** (a one-way scrambler that needs a secret key) to turn your real Questrade account number into an internal ID called `accountKey`. That's a good idea — the raw account number never appears in URLs, logs, or prompts.

`accountKey` then becomes the join key for **everything**: it's in the unique index on `InvestmentAccount`, and it's how `PortfolioSnapshot`, `BrokerageActivity`, `BrokerageOrder`, `BrokerageExecution`, and `InvestmentRiskAssessment` all find their records.

**The problem:** the plan mentions HMAC exactly twice (lines 300 and 398) and **never says which key it uses**. The only key it defines is `QUESTRADE_TOKEN_ENCRYPTION_KEY`. Meanwhile Stage 8 adds *"key-version support and a documented key-rotation procedure."*

If the HMAC uses the encryption key, then rotating that key — the exact thing Stage 8 tells you to do — **changes every `accountKey`**. Your next sync creates a brand-new account record, and every snapshot, activity, order, execution, and risk assessment you've accumulated becomes unreachable orphaned data. Nothing errors. It just looks like a fresh, empty account.

**The fix:**
1. Define a **separate, never-rotated** `QUESTRADE_ACCOUNT_ID_HMAC_KEY`, documented explicitly as permanent.
2. State in Section 8 that identity-derivation keys and encryption keys have different lifecycles — encryption keys rotate, identity keys must not.
3. Add to Stage 8 verification: *"key rotation preserves `accountKey` stability; a rotation test proves existing snapshots and activities remain reachable."*

---

### B3. `QUESTRADE_TOKEN_ENCRYPTION_KEY` is described as "optional"

**Severity: High (potential plaintext credential storage).**

Section 8 line 289: *"Add `QUESTRADE_TOKEN_ENCRYPTION_KEY` as an **optional** server setting."*

Optional in what sense? The plan defines the behavior when credentials exist but the key is missing (`locked` health — good, correct). It never defines the behavior when **no key is configured and the user tries to connect**. Two possible readings:

- **Safe reading:** connecting is refused until a key is set. This is what should happen.
- **Dangerous reading:** encryption is skipped and the refresh token is stored in plaintext in MongoDB. A brokerage refresh token in plaintext is the single worst outcome in this whole plan.

An ambiguous requirement is how the dangerous reading gets built by accident.

**The fix:** change the wording to **"required to establish or use a connection."** The setting is optional only in the sense that the app runs fine without Questrade configured at all. Add a Stage 2 verification line: *"connecting without a configured encryption key is refused with `QUESTRADE_NOT_CONFIGURED`; no credential is ever written unencrypted."*

---

## SIGNIFICANT FINDINGS

Fix before the stage each one affects.

### S1. The plan requires MongoDB transactions; the test harness cannot run them

**Affects Stage 3.**

The plan requires atomic snapshot publication (line 268 "Atomically save immutable snapshot", line 745 "snapshot atomic publication") and names a **"Snapshot transaction test"** in the threat matrix (line 345).

**Verified:** `server/test/_mongo-helper.js:34` uses `MongoMemoryServer.create()` — a **standalone** in-memory MongoDB. Multi-document transactions in MongoDB require a **replica set** (a cluster of at least one node running in replication mode). A transaction against a standalone server fails outright.

Production is fine — MongoDB Atlas is a replica set. But the test would fail on the developer's machine, which is where it's supposed to catch bugs.

**Three options, in order of preference:**

1. **Avoid transactions entirely (recommended).** A snapshot is a single document. Validate everything in memory, then do one atomic single-document `insertOne`, then flip a "latest" pointer. Single-document writes are atomic in MongoDB with no replica set needed. This is simpler *and* removes the dependency. The plan's design already leans this way — snapshots are immutable and complete-or-not-published.
2. Switch the shared helper to `MongoMemoryReplSet`. Works, but touches the helper every server test file uses (~90 files) and slows every test run.
3. Skip the test with a documented gap. Weakest — this is exactly the guarantee that protects you from partial financial data.

**Amendment:** state Option 1 explicitly in Section 9 (`PortfolioSnapshot`) and replace "Snapshot transaction test" with "single-document atomic publication test" in the threat matrix.

---

### S2. Every gate demands browser evidence that currently cannot be produced

**Affects all 8 gates.**

The plan requires browser verification at every stage — desktop viewport, 390px mobile, keyboard navigation, console check, Network panel check — and states the rule: *"treat unavailable browser verification as an incomplete gate."*

**Verified in `testing/app-capabilities.json`:**

> `knownGlobalGaps[0]`: *"The five dedicated QBO Chat V5 browser journeys are structurally implemented but have not passed repeatedly because **native browser transport cannot currently open even a static local known-good page within its hard bound**."*

Nine existing capabilities carry a `knownGaps` entry saying their browser journey "remains untrusted until repeated passing browser runs exist." The automated browser evidence path is **already broken repo-wide**, and has been since at least the 2026-08-03 review date on that file.

The plan treats this as hypothetical ("*if* the browser transport cannot run"). It is the current state. As written, `npm run verify:investments` would report `incomplete` at every gate, forever — which trains you to ignore the word "incomplete," defeating the honest-verification contract the repo works hard to maintain.

**Amendment:** split the requirement into two named things, so one can pass while the other is honestly blocked:
- **Manual rendered acceptance** (you, personally, in the dev app, following the numbered script) — this is what actually gates each stage, and it works today.
- **Automated browser evidence** (the stress slice) — declared a **known gap inherited from the existing browser transport problem**, recorded in the capability map, and not treated as a Questrade-specific failure.

Also worth noting plainly: fixing the browser transport is a separate project. Do not let Questrade inherit it.

---

### S3. The Connected Accounts component is Google-specific, not a reusable pattern

**Affects Stage 1.**

The plan says (line 73) `SettingsAccountsSection.jsx` *"already provides a compact Connected Accounts pattern with connection status, permission health, last successful access, reauthorization, and disconnect actions."*

**Verified:** it does provide that *visual pattern* — but it is **hard-wired to Google**, not a generic provider component. 302 lines, an inline `GoogleLogo` SVG component, a hard-coded "Google / Gmail & Calendar" card header, and ~20 Google-named props (`googleAuth`, `onGoogleConnect`, `onGoogleReauthorize`, `onGoogleDisconnect`, `googleConnecting`, `googleDisconnecting`, plus Gmail/Calendar default-account props).

Stage 1 step 6 says "Add a compact Questrade provider row/card under Connected Accounts" as if it were a small addition. In reality you must either:
- **(a)** extract a generic `<ConnectedAccountCard provider={...}>` and migrate Google onto it — the right long-term move, since a third provider is plausible; or
- **(b)** copy-paste a second card, accepting duplicated status/permission/error UI that will drift.

Neither is huge, but (a) means **touching and re-verifying the working Google connection UI** during Stage 1, which is a real risk the plan doesn't budget for or mention in its concurrent-work boundary.

**Amendment:** add an explicit Stage 1 step: *"Extract a provider-neutral connected-account card from the existing Google implementation; re-verify the Google connection UI is unchanged (component tests + rendered check) as part of Gate 1 acceptance."* Recommend option (a).

---

### S4. `getSymbol` gets a free pass the plan denies to `getActivities`

**Affects Stage 5 (and Stage 4).**

The plan is admirably careful about one external unknown. Line 122:

> *"The current scope table does not explicitly list the Activities endpoint even though Questrade documents the endpoint. Preflight records this as an external-contract ambiguity, and Stage 4 requires a safe live `read_acc` probe before promising activity import."*

That is exactly the right instinct. But then line 628 lists `getSymbol` in the transport as *"for risk-safe security classification under `read_acc`"* — asserted as settled fact, with no probe required.

These are the same class of claim. Symbol lookup is plausibly market-data territory (`read_md`), which the plan explicitly defers as optional and not requested. If `getSymbol` needs `read_md`, then **Stage 5's exclusion rules break** — the plan says to exclude "options, securities under reorganization, missing prices, and unknown security types" and to not guess leverage from a ticker name, which all require security classification data you may not have permission to fetch.

**I could not verify this independently.** `questrade.com` returns HTTP 403 to automated fetching, so the scope table could not be read in this session. That cuts both ways — it also means the plan's Activities claim is unverified here, which *reinforces* the plan's own instruction to recheck at Gate 0.

**Amendment:** apply the same rule to both. Add to Gate 0: *"Confirm which scope covers the symbol endpoint. If `read_acc` does not cover it, Stage 5 exclusion logic must degrade honestly — mark unclassifiable securities as `unknown` and exclude them visibly, rather than requesting `read_md`."*

---

## MINOR FINDINGS

- **M1 — Stage sizing is uneven.** Stage 3 bundles 3 models + decimal normalizers + a sync service + an entire new route, sidebar entry, workspace, and 8 UI states. It is roughly double Stage 1 or Stage 5. Consider splitting into **3a** (models, normalizers, sync service, snapshot API — verified via API responses and tests) and **3b** (the Investments workspace UI). Two smaller gates beat one gate you can't get through.

- **M2 — Fixtures need risk expectations two stages early.** Section 12 says each of the 22 fixtures carries *"expected normalized counts, expected risk calculations, and a safe secret canary."* But the risk engine doesn't exist until Stage 5. Either author risk expectations later (fixtures get versioned twice) or say so explicitly. A one-line note prevents confusion.

- **M3 — A decimal arithmetic library is a new dependency.** The plan requires "one reviewed decimal arithmetic library" for money math (correct — regular JavaScript numbers lose cents on repeated arithmetic). Verified: no such library is a direct server dependency today; `decimal.js`/`bignumber` appear only transitively in `server/package-lock.json`. The server has a deliberately lean 8-dependency list, so adding one should be a named, reviewed Stage 3 decision rather than an incidental install.

- **M4 — The rotating-refresh-token crash window is unavoidable and should be documented as such.** Questrade issues a *new* refresh token every time you redeem one, invalidating the old. If the server crashes between "Questrade issued the new token" and "the new token is safely saved," the connection is permanently broken and needs manual reauthorization. The plan handles the *storage failure* case well (line 645: don't claim the old token still works, require reauthorization). It should also state plainly in the Stage 2 handoff that a crash at that exact instant requires generating a fresh token in Questrade — so it reads as a known limitation, not a bug.

- **M5 — No exit ramp before Stage 8.** Deletion and export land in Stage 8. If you abandon at Stage 4, there's no documented way to remove stored financial data and credentials. Worth adding a minimal "remove Questrade data" developer path in Stage 2 (when credentials first exist), separate from the polished Stage 8 user-facing deletion flow.

---

## Verification ledger

Every Section 3 claim in the plan, checked against the working tree this session.

| Plan claim | Result | Evidence |
| --- | --- | --- |
| `SettingsAccountsSection.jsx` provides a Connected Accounts pattern | **Partly true** | Pattern exists but Google-hard-coded; 302 lines, `GoogleLogo`, ~20 `google*` props. See S3 |
| `GmailAuth.js` demonstrates `select: false` for tokens | **Verified** | `GmailAuth.js:11-12`, both token fields |
| `server/src/app.js` mounts provider routes under `/api/*` | **Verified** | ~30 mounts, lines 74-102 |
| `stress-testing/slices/connected-services/` provides a service-stub pattern | **Verified** | `harness/run.js`, 287 lines, plus README |
| `testing/app-capabilities.json` + `check-profiles.json` + `run-app-checks.js` give honest pass/fail/incomplete | **Verified** | 17 capabilities; groups/profiles structure supports adding an `investments` profile cleanly; `requirements: ["agent-browser"]` gating mechanism already exists |
| `provider-capture-policy.js` defaults to manifest capture | **Verified** | `CAPTURE_MODES.MANIFEST` default; rich modes gated behind an allowlist of purposes |
| `DESIGN.md` requires compact operational UI | **Verified** | Line 13, "Put the work in the first viewport" |
| **Gap:** no Questrade/investment code exists | **Verified** | Only unrelated hits: `mail.questrade.com` as an email-sender category in `email-categories.js`, `gmailInboxHelpers.jsx`, `organize-gmail.js` |
| **Gap:** no Investments route exists | **Verified** | No matches in `appRoute.js`, `App.jsx`, `Sidebar.jsx` |
| **Gap:** no general login layer protects the APIs | **Verified — and worse than stated** | Zero auth dependencies or middleware. See B1 |
| **Gap:** no investments capability or verification profile | **Verified** | 17 capabilities, none investment-related; profiles are `core` / `focused-qbo` / `full` |
| Concurrent work: untracked `docs/research/apple-design-systems/` | **Verified** | Present and untracked; this review touched nothing there |
| Questrade scope table — Activities under `read_acc` | **Could not verify** | `questrade.com` returns HTTP 403 to automated fetch. Gate 0 live probe remains necessary |

Additional facts verified while reviewing:

- `MongoMemoryServer.create()` is standalone — no transaction support (`_mongo-helper.js:34`). See S1.
- Automated browser evidence is a pre-existing repo-wide gap (`app-capabilities.json` `knownGlobalGaps[0]`). See S2.
- `scripts/dev-launcher.js`, `npm run dev:preview`, and `docs/development-startup.md` all exist — Stage 7's launcher-sync requirement is correctly scoped.
- Root `package.json` has `verify:core` / `verify:qbo` / `verify:full`; adding `verify:investments` follows the existing pattern exactly.
- `.claude/rules/client.md` claims session auth exists. It does not. See the side finding under B1.

---

## Recommended amendments, in order

**Before Stage 1 begins:**

1. Add **Host header validation** as a required control (Section 8), a threat-matrix row, and a Stage 1 implementation step. *(B1)*
2. Correct `.claude/rules/client.md` — remove the false session-auth claim. *(B1 side finding)*
3. Define a **separate, never-rotated** `QUESTRADE_ACCOUNT_ID_HMAC_KEY`; document that identity keys and encryption keys rotate differently. *(B2)*
4. Change `QUESTRADE_TOKEN_ENCRYPTION_KEY` from "optional" to **"required to establish or use a connection"** with an explicit no-plaintext-fallback rule. *(B3)*
5. Split the browser requirement into **manual rendered acceptance** (gating) and **automated browser evidence** (declared known gap). *(S2)*
6. Add the provider-card extraction as an explicit Stage 1 step, including re-verifying Google. *(S3)*

**Before the affected stage:**

7. Specify single-document atomic publication instead of a MongoDB transaction. *(S1 — Stage 3)*
8. Consider splitting Stage 3 into data layer + UI. *(M1)*
9. Add the symbol-endpoint scope question to Gate 0 alongside the Activities question. *(S4)*
10. Name the decimal library as a reviewed Stage 3 dependency decision. *(M3)*
11. Document the refresh-token crash window in the Stage 2 handoff. *(M4)*
12. Add a minimal Stage 2 "remove Questrade data" developer path. *(M5)*

---

## Bottom line

The plan's *judgment* is sound — it is unusually disciplined about safety, evidence, and refusing to give an AI financial authority. Nothing here challenges its core direction or its staging model.

What it needs is a **security pass on the local-server boundary** (B1 is genuinely serious and genuinely easy to fix), **two specification ambiguities closed** before they get built the wrong way (B2, B3), and an **honest reconciliation with two pieces of infrastructure that don't currently work the way the plan assumes** (S1, S2).

Those are amendments, not a rewrite. With them applied, Gate 0 is a reasonable next step.
