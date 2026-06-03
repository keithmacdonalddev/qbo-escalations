# CTO Production Gate Review — QBO Knowledgebase (Phases 0, 1, Phase 2 backend slice)

- Reviewer: CTO production gate (single pass)
- Date: 2026-06-02 20:15
- Plan: `C:/Projects/qbo-escalations/TODOS/qbo_knowledgebase_implementation_plan.md`
- Branch: `master` @ `524f4cf` (changes uncommitted in working tree)

## 1. Summary

**Gate Decision: PASS ✓**

- **Score: 8/10** (minimum across sections)
- **Critical: 0 | High: 0 | Medium: 3 | Low: 4**
- **Intent Gate: PASS** — the trust/safety boundary is enforced with genuine defense-in-depth (two independent gates), exceeding a naive "search over documents" implementation.
- **Next step: Ready to ship.** The three Medium findings are accuracy/relevance polish, not safety or correctness blockers. Address them in a follow-up before the Phase 4 UI consumes the summary counts.

The reviewed slice is backend-only, as the plan intends. The core safety claim — *draft and unsafe records are never returned as trusted agent guidance* — is correct and is enforced at two independent layers (trust-state gate AND allowed-use gate). All 7 new tests pass, including the three that directly assert the boundary.

### Scoring rationale

The implementation is technically clean, defensively coded, and matches the plan. It does not reach 9–10 because of the trust-state summary miscount (Medium 1), which means the first piece of UI to read `byTrustState` will display wrong governance numbers — directly counter to the plan's stated purpose of explaining "whether it is only a draft, reviewed, trusted, rejected, deprecated, or unsafe." That is a correctness gap in an observability surface, capped at 8.

## 2. Scope

**Note on scope discovery:** The scope script compares against base `master` and reports "nothing to review" because the entire KB feature is uncommitted in the working tree (66 dirty files). I discovered the reviewable surface from the plan's Implementation Status section and `git status`, then read each file completely.

**In scope (the KB slice):**

| File | Status | Role |
| --- | --- | --- |
| `server/src/services/knowledgebase-service.js` | new (682 lines) | service |
| `server/src/routes/knowledge.js` | new (88 lines) | route |
| `server/src/lib/chat-context-builder.js` | modified (+160) | context |
| `server/src/services/room-agents/chat-agent-def.js` | modified (+1 `await`) | service |
| `server/src/services/triage.js` | new/untracked (KB block at 184–273, 1143–1152) | service |
| `server/src/app.js` | modified (mount `/api/knowledge`) | config |
| `server/test/knowledge-routes.test.js` | new | test |
| `server/test/chat-context-builder-knowledge.test.js` | new | test |
| `server/test/triage-knowledge-context.test.js` | new | test |

**Explicitly out of scope (acknowledged, not reviewed):**

- `chat-request-service.js` shows a **642-line deletion** and `triage.js`/`chat-triage.js`/`routes/triage.js` are part of a *separate* "triage harness rebuild" effort that happens to share `runTriage`. The KB-relevant change in `chat-request-service.js` is a single already-correct `await buildChatModelContext(...)` (line 288). I confirmed the harness rebuild does not break the KB integration but did not audit it as a feature — it has its own plan.
- Phase 3–6 (Knowledgebase Agent, dedicated UI, auth, audit log, ontology) are deferred by the plan and excluded.

## 3. Plan Fidelity

| Plan item (Phase 0/1/2) | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Durable plan in `TODOS/` | Implemented | plan file exists | — |
| `knowledgebase-service.js` normalizes candidates | Implemented | `normalizeKnowledgeCandidate` 272–316 | matches contract shape |
| Classify trust state | Implemented | `deriveTrustState` 147–156 | matches plan mapping table |
| Derive allowed uses | Implemented | `deriveAllowedUses` 158–208 | matches reusable-outcome table |
| Expose stats/counts | Implemented (with bug) | `getKnowledgeSummary` 585–664 | see Medium 1 — `restricted` omitted, `trusted` overcounted |
| Search DB candidates | Implemented | `searchKnowledge` 480–519 | regex-escaped, multi-field |
| Include legacy playbook chunks | Implemented | `normalizePlaybookChunk` 318–367 | gated as `legacy-trusted` |
| Compact agent-context excluding unsafe/unreviewed | Implemented | `buildAgentKnowledgeContext` 547–583 | two-gate enforcement |
| `routes/knowledge.js` with 4 endpoints | Implemented | summary/records/search/agent-context | all return `{ ok, ... }` |
| Mount `/api/knowledge` | Implemented | `app.js:76` | — |
| Focused tests (trusted in, draft out, unsafe out, summary counts) | Implemented | `knowledge-routes.test.js` 55–217 | all pass |
| chat context builder uses KB in hybrid/retrieval-only | Implemented | `chat-context-builder.js` 341–408 | `full-playbook` stays legacy |
| Fallback to legacy markdown on KB failure | Implemented | `buildKnowledgebaseRetrievalBlock` catch 228–244 | — |
| Context debug exposes IDs/trust/review/uses/warnings | Implemented | `debug.knowledgebase.records` 369–378 | — |
| Prompt distinguishes trusted vs legacy vs candidate | Implemented | 383–389 | explicit warning text |
| `chat-request-service` awaits async builder | Implemented | line 288 | — |
| Room QBO Assistant awaits async builder | Implemented | `chat-agent-def.js:53` | — |
| triage requests `allowedUse=triage`, injects trusted/legacy, records trace | Implemented | `triage.js` 225–273, 1143–1152, 1260 | trace in `triageMeta.knowledgeContext` |
| `chat-context-builder-knowledge.test.js` | Implemented | passes | — |
| `triage-knowledge-context.test.js` | Implemented | passes | — |

**No Missing items. No Partial items.** Every distinct Phase 0/1/2 deliverable in the plan is present and wired.

## 4. Cross-Boundary Data Flow Trace

Traced the highest-risk path: **triage request → KB service → trust gating → provider prompt → persisted trace.**

1. `routes/triage.js:112` `runTriage(cleanText, ...)` — text validated non-empty at `routes/triage.js:92`.
2. `triage.js:1143` `buildTriageKnowledgebaseContext(parserText, ...)`.
3. `triage.js:228` `buildAgentKnowledgeContext({ query: parserText, allowedUse: 'triage', limit: 5, includeLegacy: true, includeCandidates: false })`.
4. `knowledgebase-service.js:554` `searchKnowledge({ ...options, allowedUse:'triage', includeCandidates:false })` → `listKnowledgeRecords` (DB) + legacy chunks.
5. **Gate A (trust state):** `filterRecordForPolicy` 410–425 — with `includeCandidates:false`, only `trusted`/`legacy-trusted` survive (drafts/approved/rejected/restricted dropped).
6. **Gate B (allowed use):** same function, `allowedUse='triage'` requires `record.allowedUses.includes('triage')`. A draft's allowedUses never contain `triage` (`deriveAllowedUses` bottoms out at `[review-only]`), so even if Gate A were relaxed, Gate B blocks it.
7. `buildAgentKnowledgeContext:562-568` re-applies `filterRecordForPolicy` and maps via `toAgentContextRecord` (strips lineage/notes, keeps summary/fix/warnings).
8. `triage.js:255` `formatTriageKnowledgeContext` → `systemPrompt` (1145–1148) → `runDirectTriageProviderCall` (1210) → provider.
9. `triage.js:1260` `knowledgeContext: knowledgeContextTrace` recorded in `triageMeta`; persisted at `persistTriageResult` (1263) and asserted readable in the test (`triage-knowledge-context.test.js:159-162`).

**Producer/consumer agreement verified at every boundary.** The `query: parserText` is always non-empty here, so the empty-query relevance concern (Low 1) does not apply to triage. The record shape consumed by `formatKnowledgeContextRecord` (`triage.js:184`) matches the fields emitted by `toAgentContextRecord` (`knowledgebase-service.js:521`) — `id, title, category, trustState, reusableOutcome, summary, symptom, rootCause, exactFix, keySignals, evidence, warnings` all present.

I also traced the second boundary (chat path → KB) and the async-conversion regression surface: all three callers of the now-`async` `buildChatModelContext` correctly `await` (verified by grep across the repo, excluding node_modules). No synchronous caller was left behind — this is the single most likely regression from the change and it is clean.

## 5. Findings by Framework Section

### 5.1 State consistency and data flow correctness

**Finding — Summary `byTrustState` miscounts trusted and omits restricted**
**Severity:** Medium
**File:** `server/src/services/knowledgebase-service.js:635-640`
**Issue:** `getKnowledgeSummary` derives `byTrustState` purely from the `reviewStatus` aggregation: `trusted = byReviewStatus.published`. But `deriveTrustState` (152) classifies a `published` record whose `reusableOutcome === 'unsafe-to-reuse'` as `restricted`, checked *before* the published branch. The summary therefore (a) counts published-unsafe records as `trusted`, and (b) never reports a `restricted` count at all, even though `RESTRICTED` is a first-class trust state in the contract and the per-record path.
**Reproduction:** Publish one canonical candidate and one `unsafe-to-reuse` candidate. `GET /api/knowledge/summary` returns `byTrustState.trusted = 2` and no `restricted` key. The per-record API correctly shows the second as `restricted`. A reviewer reading the dashboard believes 2 records are trusted for agent use; only 1 is.
**Fix:** Compute trust-state counts from the same derivation used per-record, e.g. add a `$group` on a derived field or aggregate `{ reviewStatus, reusableOutcome }` pairs and fold them through `deriveTrustState`:
```js
const pairCounts = await KnowledgeCandidate.aggregate([
  { $group: { _id: { reviewStatus: '$reviewStatus', reusableOutcome: '$reusableOutcome' }, count: { $sum: 1 } } },
]);
const byTrustState = { candidate: 0, reviewed: 0, trusted: 0, rejected: 0, restricted: 0 };
for (const item of pairCounts) {
  byTrustState[deriveTrustState(item._id)] += item.count;
}
```

### 5.2 Intent fidelity

No findings. The two-gate enforcement, the explicit prompt warnings separating trusted/legacy/candidate, the per-record `warnings` array (`missing_exact_fix`, `case_history_only_not_general_guidance`, etc.), and the persisted KB trace all exceed a basic retrieval implementation and directly serve the plan's "explain what the app knows and whether it is safe" goal.

### 5.3 Code quality and defensive programming

**Finding — KB-failure fallback prompt references trust labels absent from fallback content**
**Severity:** Low
**File:** `server/src/lib/chat-context-builder.js:383-389` vs `228-244`
**Issue:** When `buildAgentKnowledgeContext` throws, the catch path builds context from raw `searchPlaybookChunks` via `buildRetrievedKnowledgeText`, which tags blocks as `[CATEGORY: name :: title]`. But the static prompt header still instructs the model to distinguish `TRUSTED` / `LEGACY-TRUSTED` / `candidate` labels that only `formatKnowledgeRecordForPrompt` emits. In the fallback the labels are absent, so the instruction is slightly orphaned. Content is still legacy playbook (correctly treated as legacy), so this is cosmetic.
**Reproduction:** Force `buildAgentKnowledgeContext` to throw (e.g., DB error) with `mode='hybrid'`. The system prompt contains the trust-label instructions but the body has no `[KB ...]` tags.
**Fix:** In the catch branch, prefix fallback chunks with a `legacy-trusted` marker, or swap the header to legacy-only wording when `fallbackUsed` is true.

**Finding — `confidence` default skew between model and contract**
**Severity:** Low
**File:** `server/src/models/KnowledgeCandidate.js:69` (default `0.6`) vs plan contract example `0.85`
**Issue:** Cosmetic only — `clampConfidence` handles any value. Noted because the contract example implies 0.85; not a defect.

**Finding — Double `parseLimit` in agent-context**
**Severity:** Low
**File:** `routes/knowledge.js:23` then `knowledgebase-service.js:550`
**Issue:** Limit is parsed in the route then re-parsed in the service. Idempotent for valid input, harmless, slightly redundant. No fix required.

### 5.4 Performance and responsiveness

**Finding — Empty-query agent-context returns most-recent trusted records regardless of relevance**
**Severity:** Low (Medium if a caller ever passes empty query to a final-response path)
**File:** `server/src/services/knowledgebase-service.js:495` and `444-478`
**Issue:** Legacy retrieval is correctly skipped when `query` is empty (`if (includeLegacy && query)`), but the DB path (`buildCandidateFilter` with no search → `{}`) returns the N most-recently-updated trusted records sorted by `-updatedAt`. With an empty query, the agent receives arbitrary recent trusted records as "relevant context."
**Reproduction:** `GET /api/knowledge/agent-context?query=` returns up to 6 trusted records with no relevance filter.
**Mitigation present:** The two live agent paths never pass an empty query — triage validates non-empty text (`triage.js:1125`), and chat builds the query from user messages. So this is currently latent.
**Fix:** When `query` is empty, return `{ records: [] }` from `searchKnowledge`/`buildAgentKnowledgeContext` (DB lexical retrieval is meaningless without a query), or require a non-empty query at the route.

No other performance findings. Queries use indexed fields (`reviewStatus`, `category`, `reusableOutcome` are indexed on the model), `.lean()` is used, and `countDocuments` runs in parallel with `find`.

### 5.5 Observability and debugging

**Finding — KB fallback in chat is debuggable; triage failure trace is captured**
No findings. `debug.knowledgebase` records source/fallbackUsed/error/records, and triage emits `triage.knowledge_context_built` / `triage.knowledge_context_failed` with full trace, persisted to `TriageResult.triageMeta.knowledgeContext`. This is strong.

### 5.6 Security / trust boundary enforcement

No findings — this is the strongest part of the implementation. Verified:

- **Two independent gates** (trust-state and allowed-use) in `filterRecordForPolicy`, applied in both `listKnowledgeRecords` and re-applied in `buildAgentKnowledgeContext`.
- `includeCandidates=true` (the relaxation lever on `/agent-context`) only relaxes the trust-state gate; the allowed-use gate still blocks drafts from `agent-response`/`triage` because `deriveAllowedUses` never grants those uses to non-published records. Confirmed by reasoning through every branch of `deriveAllowedUses` (158–208).
- Regex search input is escaped (`escapeRegex` 77–79) before `new RegExp`, so no ReDoS-via-metacharacter or injection via `query`.
- The in-process agent path and the HTTP `/agent-context` route both funnel through `buildAgentKnowledgeContext`, so there is no second, ungated agent entrypoint.

### 5.7 Accessibility / responsive design

Not applicable — backend-only slice.

### 5.8 Error handling

No findings. KB failures degrade gracefully (chat → legacy fallback; triage → empty KB section + recorded trace), DB-not-ready is handled (`isKnowledgeCandidateDbReady` → empty page / zeroed summary), and routes return the `{ ok, ... }` contract.

## 6. Exceeds Expectations Assessment

1. **Senior engineer impressed?** Yes — the defense-in-depth gating, the explicit `warnings` taxonomy, and the persisted provenance trace are beyond a first slice.
2. **Actionable errors?** Yes — `warnings` enumerate *why* a record is restricted (`missing_exact_fix`, `case_history_only_not_general_guidance`), which a reviewer can act on.
3. **Defensive programming comprehensive?** Largely — `safeString`/`compactText`/`clampConfidence`/`toIso`, DB-readiness guards, empty-page fallbacks. The empty-query DB behavior (Low 1) is the one uncovered edge.
4. **Architecture eases future change?** Yes — `normalizeKnowledgeCandidate` and `normalizePlaybookChunk` produce one `KnowledgeRecord` shape, so the future `KnowledgeArticle`/`KnowledgeEvidence` models can plug in behind the same contract without touching agent code.
5. **Would the user say "this exceeds what I asked for"?** Yes — the plan asked for a gated backend with tests; the slice delivers two-layer gating, a citation pipeline, and full debug/trace observability.

## 7. Recommendations to Exceed Intent

| Gap | Current | Exceeding | Recommendation | Effort |
| --- | --- | --- | --- | --- |
| Trust-state counts | Derived from reviewStatus only; `restricted` invisible | Counts match per-record derivation | Aggregate on `{reviewStatus, reusableOutcome}` and fold through `deriveTrustState` | 20 min |
| Empty-query agent-context | Returns recent trusted records | Returns nothing without a query | Short-circuit empty query in `searchKnowledge` | 10 min |
| Fallback labeling | Header references absent trust labels | Header matches fallback content | Tag fallback chunks `legacy-trusted` or switch header copy when `fallbackUsed` | 15 min |
| Summary `restricted`/`deprecated` visibility | Not surfaced | Review queue can show restricted backlog | Add `restricted` (and future `deprecated`) to summary once the count fix lands | included above |

## 8. What Breaks First

The first thing to break in production is **the Phase 4 review dashboard's trust numbers**, not agent safety. When the dedicated `#/knowledge` UI binds to `summary.candidates.byTrustState`, any published `unsafe-to-reuse` record inflates the `trusted` count and the `restricted` bucket is missing entirely — so an operator could believe an unsafe record is trusted for agent use. Agent behavior is unaffected (the gating path is independent and correct), but the *governance display* — the entire point of the feature — would mislead. This is exactly why Medium 1 should be fixed before the UI phase, even though it does not block this backend slice.

## 9. Production Verdict

**Ship the backend slice.** The safety-critical boundary is correct, double-gated, and test-covered. The three Medium findings are accuracy/relevance issues in non-safety surfaces (summary counts, empty-query relevance, fallback labeling) and are appropriate to fix in a fast follow-up before Phase 4 consumes them. No Critical or High findings exist; the gate returns PASS.

## 10. Non-Negotiable Fixes (Critical/High)

None. There are no Critical or High findings.

Recommended-before-UI (Medium, not gate-blocking):
1. Fix `getKnowledgeSummary` trust-state counts to fold `reusableOutcome` through `deriveTrustState`; add a `restricted` bucket (`knowledgebase-service.js:635-640`).
2. Short-circuit empty-query agent-context to return no records (`knowledgebase-service.js:495` / route).
3. Align the KB-fallback prompt header with the (un-labeled) fallback content (`chat-context-builder.js:383-389`).
