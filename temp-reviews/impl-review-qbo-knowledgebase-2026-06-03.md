# Implementation Review: QBO Knowledge Base — Full 6-Phase End-to-End

**Date:** 2026-06-03
**Verdict:** FAIL — ship-blocked on 2 fixable Phase-5 security gaps. Everything else (breadth across all 6 phases, the crown-jewel trust/safety guarantee, the UI↔API contract, KB tests) passes. The two blockers are narrow, well-localized, and each has a clear fix.
**Method:** implementation-review skill (vertical-slice agent team). Lead + 5 vertical-slice reviewers + recon. All findings read BOTH sides of every boundary; the two ship-blockers and the crown-jewel guarantee were each independently confirmed by two reviewers reading the code separately.
**Scope:** 3 commits (701fa22 Phase 1-2, c9f18ad Phase 3-4, e0bc9b3 Phase 5-6), working tree clean. ~6 server services/routes, 1,049-line client view, 15 client↔server endpoints, 6 KB test files. Both dev servers were running; read-only browser verification performed.

## Executive Summary

The feature is genuinely implemented across all six phases with real code (not placeholders), and its single most important safety property holds: drafts and `unsafe-to-reuse` records cannot reach an agent as trusted guidance on any traced path. The frontend and backend are correctly wired across all 14 UI-consumed boundaries (zero contract mismatches; confirmed both statically and on-the-wire). KB-focused tests pass. Ship is blocked solely by two Phase-5 hardening gaps — a filesystem-write kill-switch that the new publish route fails to honor, and a "redaction" feature that does not mask record body content — neither of which has test coverage, which is why they shipped.

## Crown-Jewel Safety Verdict: HOLDS (no agent-reachable leak)

Independently confirmed by the safety reviewer and the agent-integration reviewer.

- Trust state and allowed-uses are DERIVED (not stored). `trustStateOverride` is one-directional (`isRestrictiveTrustOverride`, knowledgebase-service.js:162-171) — it can only restrict, never promote; `allowedUsesOverride` is intersected with the base set (deriveAllowedUses:233-241) so it can only subtract. Both are also rejected at write time (sanitizeKnowledgePatch throws INVALID_TRUST_STATE / INVALID_ALLOWED_USE_OVERRIDE).
- Final-agent uses {agent-response, triage} and outcomes {canonical, edge-case} are enforced on BOTH the in-memory gate (filterRecordForPolicy:556) and the query gate (applyPolicyQueryConstraints:580). listKnowledgeRecords filters BEFORE pagination slice when any policy filter is active (:663-675) — pagination cannot smuggle an unfiltered row through.
- buildAgentKnowledgeContext (:766) defaults includeCandidates=false and double-filters. The includeCandidates lever is neutralized on agent paths because the gate keys off the allowedUse value, not the lever — so even a caller forcing includeCandidates=true cannot admit a draft/unsafe record into a final-agent context.
- All three live consumers use the gated path with hardcoded safe args: main chat (chat-context-builder.js:209), room QBO Assistant (chat-agent-def.js:53 → :209), standalone triage (triage.js:228). The async conversion of buildChatModelContext broke no caller — all 4 call sites await (chat-request-service.js:288 confirmed). A regression test (chat-context-builder-knowledge.test.js) asserts a published record is injected/cited as trusted while a draft is absent from both prompt and record-id list.

## Plan Fidelity (all 6 phases)

| Phase | Status | Notes |
|---|---|---|
| P0 Plan/Contract | Complete | Plan + API contract present. |
| P1 Backend API | Complete | knowledgebase-service.js; routes/knowledge.js; mounted app.js:76; real trust/allowed-use derivation. |
| P2 Agent Integration | Complete | KB context via gated path; legacy fallback intact; debug exposes IDs+trust states; prompts distinguish trusted/legacy/candidate. |
| P3 KB Agent | Complete | knowledgebase-agent-service.js: scan, quality, duplicate, stale, contradiction, attention. Profile agent-profiles.js:70 (room-agents/). Status advertises approvesKnowledge:false/publishesKnowledge:false. Scan-persist gated behind `review` permission. |
| P4 Dedicated UI | Complete | KnowledgebaseView.jsx (1,049 lines, substantive); routes #/knowledge + #/knowledge/:id; tabs trusted/candidate/deprecated/rejected; coverage summary; detail panel. |
| P5 Hardening | Complete-with-caveats | Role map, audit trail, DB-first default, export endpoint, .env settings present — BUT the 2 ship-blockers are the P5 shortfall. |
| P6 Ontology | Complete as first slice | relationships REAL; contradiction detection REAL (token/heuristic); scope modeling REAL (storage+validated); evidence strength PARTIAL (aggregate falls back to 0.75/0.45 by publish state when evidenceRefs empty — the common case); action recommendations STORAGE-ONLY (no producer generates them); outcome feedback HALF-REAL (captured but nothing reads it to adjust trust — not a closed loop). |

Confirmed: NO autonomous cron/scheduler added (plan exclusion held). Deferred-models decision held (only extended KnowledgeCandidate; no first-class Article/Evidence/ReviewEvent models).

## Findings (severity-ranked)

### CRITICAL — Blocker 1: New publish route bypasses the `KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED` filesystem kill-switch. (Confirmed by 2 reviewers.)

- knowledge.js:178 passes `req.body` unguarded into publishKnowledgeRecord.
- knowledgebase-management-service.js:338 reads `exportMarkdown` straight from the client body and never consults the env flag (the `envFlag()` helper exists at :132 but is not called here). :352 `if (exportMarkdown)` → publishKnowledgeCandidate → fs.writeFileSync (knowledge-promotion.js:393).
- The LEGACY route does it correctly: escalations.js:1260-1261 forces `exportMarkdown=false` when the flag is set. The new first-class route has no such guard — proving the asymmetry.
- Reachable from the UI: KnowledgebaseView.jsx:830 "Export Markdown" button → sends `{exportMarkdown:true}` (knowledgeApi.js:60-62), enabled for any approved+publishable record.
- Impact: On a deploy with the documented DB-only setting (`KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED=true`, .env.example:19-20), one JSON field (or one button click) defeats the kill-switch and writes to the playbook/ filesystem — on a read-only/ephemeral FS this also throws a 500. Direct violation of the Phase-5 "no filesystem playbook writes on deploy" rule. Precondition: publish permission (note: real user→role auth is a deferred item, plan 182-187, so this is effectively open in the current build).
- Fix: centralize the guard inside publishKnowledgeRecord — `exportMarkdown = exportMarkdown && !envFlag('KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED')` — so neither route can bypass it.

### HIGH — Blocker 2: `redact` does not mask record body content; redacted customer data is still retrievable. (Confirmed by 2 reviewers.) NEEDS A PRODUCT-INTENT DECISION.

- redactKnowledgeRecord (knowledgebase-management-service.js:404-423) only writes a `redaction` marker object. The `redacted` flag is consulted in only two places (knowledgebase-service.js:278, :282) — masking evidence `caseNumber`/`coid` only.
- Body fields are returned RAW by normalizeKnowledgeCandidate: summary (:394), symptom (:395), rootCause (:396), exactFix (:397); resolution evidence text (:299-306) has no redaction check.
- Blast radius: GET /records/:id, /export, /search all return the unmasked body. Worse, the export payload advertises `redactionAppliedByRecord:true` (mgmt:543), overstating what happened.
- Ambiguity to resolve: if "redaction" is meant to MASK content, this is a real gap (customer data in summary/resolution stays retrievable). If it is only a "source-identifier flag for later manual scrub," then the code is fine but the naming, the UI, and the `redactionAppliedByRecord:true` claim are misleading. Either way it must not ship claiming redaction it does not perform.
- Fix: either mask body fields in the normalizer when `customerIdentifiersRedacted` is set, or re-scope/rename to "source-identifier flag" and correct the export claim + UI copy.

### MEDIUM — getKnowledgeSummary trust-state counts are wrong (governance dashboard only; NO agent leak). (Confirmed by 2 reviewers; carried over from the 2026-06-02 review — still present.)

- knowledgebase-service.js:860-867. TRUSTED is sourced from `reviewStatus==='published'`, not deriveTrustState — so a published-but-`unsafe-to-reuse` record is counted TRUSTED. RESTRICTED/DEPRECATED counts (from separate countDocuments) OVERLAP the published/approved/draft buckets (double-counting). `total` (:871) sums only byReviewStatus, so it is inconsistent with byTrustState.
- Impact: the Phase-4 governance dashboard INFLATES trusted counts and double-books unsafe/deprecated records — the wrong direction for a trust dashboard. Counts only; no content reaches an agent.
- Fix: count buckets via deriveTrustState (one source of truth) into mutually exclusive states; reconcile total with byTrustState.

### MEDIUM — Ungated reads expose draft/unsafe content (depends on the not-yet-built auth layer).

- GET /records/:id (knowledge.js:154) has no policy filter — returns any record incl. draft/rejected/unsafe with full body. GET /records and /search default includeCandidates=true. POST /agent/scan dry-run (:114) returns source evidence with NO permission check (only persist is gated).
- These are by-design human-reviewer surfaces (not agent paths — the crown-jewel guarantee is unaffected), but with no auth layer wired yet they are open-by-default. Acceptable only behind reviewer-only auth.
- Fix: add a `read` permission assertion on records/:id, records, search, and scan (incl. dry-run), consistent with the gated mutations; or filter unsafe/rejected unless the actor has `review`.

### LOW

- Triage KB metadata omits `allowedUses` (asymmetric with chat debug). triage.js:241-249 vs chat-context-builder.js:376.
- Catch-block fallback header references TRUSTED/LEGACY-TRUSTED labels absent from the raw fallback content (cosmetic; only on a thrown exception — the common DB-not-ready case returns an empty page, not a throw). chat-context-builder.js:228-244.
- Empty/blank retrieval query returns recent trusted records regardless of relevance; reachable via an image-only first room turn (chat-agent-def.js:46 maps image-only to ''). Relevance-only impact; results are still trusted-only. knowledgebase-service.js:512-538.
- prompts/agents/triage-agent.md carries no trusted/legacy/candidate labeling language (it is runtime-injected at triage.js:219 instead). Consistent with chat; just undocumented in the static prompt.
- Idempotent publish (already-published) returns early with no audit event (mgmt:341-343); first publish IS audited.
- UI: the includeLegacy toggle silently swaps list→search (drops DB pagination; "N records" header shows the page-capped count, not the true total); and legacy chunks only appear when a query is also typed. KnowledgebaseView.jsx:253-255; searchKnowledge:714. UX polish, not correctness.
- export JSON's `redactionAppliedByRecord:true` is misleading given Blocker 2 (mgmt:543).

## UI↔API Contract Verification: PASS (14/14)

All 14 UI-consumed boundaries match exactly on both sides; boundary #15 (/agent-context) is correctly agent-only and not consumed by the dashboard. Error envelope {ok:false, code, error} is handled uniformly via http.js readApiResponse and surfaced through page-level + inline notices; no call ignores ok:false. Four mount fetches (/summary, /records, /agent/status, /ontology/summary) were additionally confirmed on-the-wire — response shapes match the client reads exactly. Loading/empty/error states all present and reachable (empty state confirmed live); debounce cleanup correct; record-detail teardown clean.

## Visual & Runtime Verification

- App running: YES (API :4000, client :5174).
- Console errors on load: 0. Uncaught/page errors: 0. Network 4xx: 0. 5xx: 0.
- Dashboard rendered live Atlas data (24 legacy sources, 1 finalized escalation, 0 candidates). Screenshots: review-screenshots/kb-dashboard-initial.png, review-screenshots/kb-record-detail.png.
- No orphaned CSS classes; known global-CSS traps ([class*=title] transparent text-fill, .agent-panel header/h3) did NOT fire on this view.
- NOT verified live: interactive record-detail render — DB has 0 candidate records and seeding would mutate the live Atlas DB (out of read-only scope). Contract proven statically (boundary #5). No mutating UI actions were triggered.

## Test Results

- Command run: `npm --prefix server test -- test/knowledge-management-routes.test.js test/knowledgebase-agent.test.js test/knowledge-routes.test.js test/chat-context-builder-knowledge.test.js test/triage-knowledge-context.test.js test/integration-routes.test.js` → ALL 6 KB files PASS (~18.8s; knowledge-management-routes granular 11/11).
- Two passing tests actually ENCODE the blocker gaps: "knowledge export uses normalized redacted records" asserts only the marker (not masked body → Blocker 2 untested); "legacy escalation knowledge publish can run database-only" tests only the legacy route's kill-switch (→ Blocker 1 untested).
- Full suite `npm --prefix server test` → exits 1 (fail-fast) at test/image-parser-comprehensive.test.js with PROVIDER_PACKAGE_CAPTURE_FAILED / mongoose_not_connected. This is the image-parser provider-package-capture churn (commits 79e1b58/22a017a), NOT KB and NOT the triage-harness rebuild. Because the runner is fail-fast and KB files sort after "image-parser", ~57 files (incl. KB) did not run in the full-suite pass — so the KB-subset run above is the authoritative KB result. Separate pre-existing issue: it currently prevents a clean full-suite regression baseline.

## Regression

No KB regression from the separate triage-harness rebuild churn (chat-request-service.js −642 lines; triage.js mixed). All KB-touching tests pass; the async context-builder caller awaits correctly. The image-parser failure is unrelated to KB and to triage.

## Prior-Findings Confirm/Refute (vs 2026-06-02 cto-review)

- getKnowledgeSummary miscount: CONFIRMED still present (Medium above).
- Empty-query agent-context relevance: CONFIRMED, now shown reachable via image-only room turn; trusted-only, low impact (Low above).
- Fallback prompt label mismatch: CONFIRMED still cosmetic (Low above).
- Crown-jewel guarantee: RE-CONFIRMED holds, now across the larger Phase 3-6 surface including the includeCandidates lever and all new read endpoints.

## Could NOT Verify (flagged)

- Interactive record-detail rendering at runtime (0 candidates in DB; seeding would mutate live Atlas).
- The ~57 server test files that sort after image-parser in a single full-suite run (fail-fast halted them); KB subset was run explicitly instead.
- Findings are from static tracing + read-only runtime checks; routes were not exercised with mutating calls against the live server.

## Ship Recommendation

DO NOT SHIP until both P5 blockers are fixed:

1. (Critical) Gate `exportMarkdown` behind `KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED` inside publishKnowledgeRecord so the new route cannot write to the filesystem on a DB-only deploy. Add a regression test for the new route's kill-switch.
2. (High) Resolve redaction: either mask body fields on read, or rename/re-scope to "source-identifier flag" and fix the `redactionAppliedByRecord` claim + UI copy. Add a test asserting redacted body content is not retrievable via records/:id, export, search.

Recommended before relying on the dashboard / opening to non-reviewers:

3. (Medium) Fix getKnowledgeSummary to count via deriveTrustState.
4. (Medium) Add read-permission assertions to the ungated read/scan endpoints once the auth layer lands (plan 182-187).

Everything else is non-blocking polish. The crown-jewel safety guarantee, the full-stack contract, and KB test coverage are solid.
