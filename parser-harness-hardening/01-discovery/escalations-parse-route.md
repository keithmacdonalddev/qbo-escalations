# POST /api/escalations/parse — is it needed, is it safe to remove?

Plain English first. Every code identifier is paired with a one-line description of what it does.

## TL;DR

The route still exists in the server and still works. **Nothing in the live client UI calls it.** The only callers are three test cases in `server/test/integration-routes.test.js` (the API contract test file). The wrapper function `parseEscalation` (the JavaScript helper that builds the HTTP request) is exported by `client/src/api/escalationsApi.js` but never imported by any other client file. The earlier discovery note that the route "could be touched by the legacy escalation UI" was a precaution; a fresh end-to-end check could not find any UI path that reaches it.

**Recommendation: option (d) — remove the entire route plus the tests.** No production client code references it. The cleanup is small.

## 1. Route handler — where it lives

- **File:** `server/src/routes/escalations.js`.
- **Registration:** `router.post('/parse', parseRateLimit, async (req, res) => { … })` at `server/src/routes/escalations.js:1678`. The router is mounted at `/api/escalations` (so the full path is `POST /api/escalations/parse`).
- **Body parameters** (plain English):
  - `image` — base64 screenshot of the escalation template (optional).
  - `text` — raw text version of the escalation (optional).
  - `conversationId` — id of an existing chat conversation; if neither image nor text was sent, the route reads them from this conversation.
  - `traceId` — id of a parent trace record for telemetry chaining.
  - `mode` — string controlling which path runs (see below).
  - `provider`, `primaryProvider`, `fallbackProvider`, `timeoutMs` — AI provider routing settings (only used by the AI path).

The route validates inputs, opens a trace record (telemetry), then branches by `mode`.

## 2. The two modes

### Mode A: `mode: 'quick'` — regex-only

Code: `server/src/routes/escalations.js:1764-1885`.

Step by step in plain English:

1. Calls `parseEscalationText(resolvedText)` — a regex parser at `server/src/lib/escalation-parser.js` that pulls COID, MID, case number, etc. out of plain text. No AI involved.
2. Calls `validateParsedEscalation(...)` — a shape-checker at `server/src/lib/parse-validation.js` that scores how well the parse hit the canonical 9-field template.
3. Builds a `parseMeta` object (provenance / scoring summary) using `toParseResponseMeta(...)`.
4. If a `conversationId` was supplied, links the new escalation to that conversation via `createLinkedEscalationFromConversation(...)`. Otherwise it just creates a fresh `Escalation` Mongo document.
5. Persists the escalation, builds a `duplicateSafety` payload (warns the user if they're about to file a duplicate), updates the trace record, and returns `{ ok: true, escalation, duplicateSafety, _meta, traceId }`.
6. Returns HTTP 201 (created) or 200 (linked to an existing escalation).

**Net effect:** regex extracts the fields, the row gets saved to Mongo, the response includes the saved row. No AI is touched; no token usage is logged.

There is a sister route `POST /api/escalations/quick-parse` at `server/src/routes/escalations.js:2170` that does the regex step **without** saving anything. The two are not the same. Nothing on the client calls `quick-parse` either (verified — only `quickParseEscalation` in `client/src/api/escalationsApi.js:137` exists as an unused wrapper).

### Mode B: anything other than `'quick'` (default) — AI path

Code: `server/src/routes/escalations.js:1887-2165`.

Step by step in plain English:

1. Builds an in-memory AI operation record (`createAiOperation`) so the runtime dashboard can show this as a live job, and registers a `res.on('close')` handler that marks the job as aborted if the client disconnects.
2. Calls `parseWithPolicy({ image, text, mode, primaryProvider, fallbackProvider, timeoutMs, allowRegexFallback: true })` — the orchestrator at `server/src/services/parse-orchestrator.js:209`. This is what runs the AI:
   - Picks the primary provider (default Claude) and runs its `parseEscalation()` method.
   - For Claude, that path passes through `claude.parseEscalation()` at `server/src/services/claude.js:518`, which historically tried `sdk-image-parse` first then fell back to the CLI subprocess. (After the chat-side cleanup recorded in `DECISIONS.md` D2, the SDK call inside `claude.parseEscalation` has already been removed; only the CLI subprocess remains. So the AI path here uses the Claude CLI subprocess transport.)
   - If the primary fails or is missing fields, tries the fallback provider.
   - If everything else fails, falls back to the regex parser (because `allowRegexFallback: true`).
3. Returns `{ fields, meta }` from the orchestrator.
4. Same persistence path as Mode A from here onward: link or create the escalation, save, build duplicate-safety, log token usage per attempt via `logUsage(...)`, update the trace, return the response.

**Net effect:** an AI provider parses the image/text into structured fields, the row gets saved, token usage is logged, the response includes the saved row.

## 3. Production callers — what currently triggers this route from the live app

**Zero.** Investigated end-to-end:

- **Wrapper function.** `parseEscalation(...)` declared at `client/src/api/escalationsApi.js:103` (exported). This is the only JavaScript helper that POSTs to `/api/escalations/parse` (line 127). Grepped the entire `client/` tree for `parseEscalation,` `, parseEscalation`, `{ parseEscalation`, `import.*parseEscalation` — **no matches**. The wrapper is exported and never imported.
- **Direct route-path references.** Grepped `client/` for `escalations/parse` — **no matches** outside the wrapper itself.
- **Direct fetch with `${BASE}/parse`.** Grepped — no matches.
- **Production callers identified by earlier worker.** The previous discovery (`sdk-image-parse-relocation.md` line 47) speculated "used by the older `EscalationForm` and possibly the legacy non-chat-v5 escalation UI." Re-verified:
  - `client/src/components/EscalationForm.jsx` imports only `transitionEscalation` and `updateEscalation` — no parse call.
  - `client/src/components/EscalationDetail.jsx` imports `getEscalation`, `uploadEscalationScreenshots`, `deleteEscalationScreenshot`, `listSimilarEscalations`, `getEscalationKnowledge`, `generateEscalationKnowledge`, `updateEscalationKnowledge`, `publishEscalationKnowledge`, `unpublishEscalationKnowledge` — no parse call.
  - `client/src/components/EscalationDashboard.jsx` imports `getKnowledgeGaps` only.
  - `client/src/hooks/useEscalations.js` imports listing/CRUD helpers only (`listEscalations`, `updateEscalation`, etc.) — no parse call.
  - `client/src/components/chat/useChatConversationState.js` imports `getEscalation` and `transitionEscalation` only.

The "active" chat-v5 escalation parse path uses `POST /api/image-parser/parse` (the image parser route), not `/api/escalations/parse`. The legacy `EscalationForm` no longer parses — it only updates resolution notes and transitions status. The Dashboard lists; Detail views and updates. There is no surviving UI path that hits this route.

## 4. Test callers

Three POSTs in one file:

- `server/test/integration-routes.test.js:792` and `:797` — paired calls inside the "deduplication on link" scenario. Both use `mode: 'quick'` (regex path) to set up an escalation document linked to a conversation, then assert the second call reuses the existing escalation. The test is really about `createLinkedEscalationFromConversation` deduplication, not the parser; it just uses this route as a convenient way to create a linked escalation.
- `server/test/integration-routes.test.js:1357` — single call in the "P5: escalation parse accepts new provider IDs" test. Sends `text: 'P5 parse test'` with a new provider id (`'gpt-5.4-mini'`) to confirm the input validator accepts the id. This test is about provider-id validation, not the parser.

Comment in `server/test/usage-integration.test.js:638` ("UsageLog coverage for AI parse traffic remains via /api/escalations/parse") is a leftover note — the file itself no longer POSTs to the route after the D2 cleanup.

## 5. Mode usage by caller

| Caller | Path | Mode | Live UI? |
| --- | --- | --- | --- |
| `client/src/api/escalationsApi.js:103` `parseEscalation` wrapper | — | accepts both | Wrapper is **declared but never imported**. Dead UI surface. |
| `client/src/api/escalationsApi.js:137` `quickParseEscalation` wrapper | `/api/escalations/quick-parse` (different route, no save) | regex | Also **declared but never imported**. Dead UI surface. |
| `integration-routes.test.js:792-797` | — | `quick` (regex) | No — test fixture. |
| `integration-routes.test.js:1357` | — | default (AI path) | No — test fixture. |

## 6. Recommendation — option (d): remove the entire route plus tests

**Rationale (one paragraph).** No production code references the route. The two client-side wrappers (`parseEscalation`, `quickParseEscalation`) are exported but never imported. The three test calls don't test the route as a feature — they use it as a convenient setup helper for unrelated assertions (deduplication, provider-id validation), so they can be either deleted or rewritten to call the underlying helpers directly. The route handler is ~490 lines of mostly trace/event/AI-operation plumbing for a feature the live UI no longer triggers. Keeping it adds attack surface, validator surface, and a permanent maintenance tax (every refactor of `parseWithPolicy`, `createLinkedEscalationFromConversation`, `toParseResponseMeta`, or the trace API has to keep this dead route compatible). Removing it is a strict cleanup with no user-visible impact and tightens the harness-hardening blast radius.

**What removal looks like:**
- Delete `router.post('/parse', …)` block (`server/src/routes/escalations.js:1674-2166`).
- Delete `router.post('/quick-parse', …)` block (`server/src/routes/escalations.js:2168-2184`) — same reasoning, never called from the client.
- Delete the wrappers `parseEscalation` (`client/src/api/escalationsApi.js:102-134`) and `quickParseEscalation` (`client/src/api/escalationsApi.js:136-143`).
- Replace the three test cases with either: (a) a direct helper-level test for the linking dedup logic (e.g. call `createLinkedEscalationFromConversation` from `server/src/lib/escalation-dedup.js` directly), or (b) delete them as they overlap with broader integration coverage. The third test (P5 provider-id validation) is unrelated to this route — move it to a route that's still in use, or delete if covered elsewhere.
- Update the leftover comment in `server/test/usage-integration.test.js:638`.

**Effort estimate: small.** Roughly 500 deleted lines, 3 tests touched, 2 client wrappers deleted, 1 comment updated. No schema changes, no client UI work, no provider catalog work.

**Coupling sanity-check.** `parseWithPolicy` (the orchestrator) still has callers — image-parser route flows and provider-strategy components still need it. So we're only deleting the route and the wrappers, not the orchestrator itself. `claude.parseEscalation()` would lose this caller but is still referenced by `parse-orchestrator.js` (via the providers registry), so leave it alone.

## Rejected alternatives and their cost

- **Option (a) — leave as-is.** Cost: zero now; ongoing maintenance tax forever. Not chosen because the route is genuinely orphaned.
- **Option (b) — remove the AI half, keep `quick` mode.** Surgical, but `quick` is also unreferenced (no production caller hits `mode: 'quick'` either). Keeping it would just leave a smaller orphan. Effort: **small** (~150 lines deleted, keep ~70). Not worth it.
- **Option (c) — remove the route plus all callers, including unwiring or fixing production callers.** There are no production callers to unwire. Equivalent to option (d). Effort: **small** (same as d).

## Verification trail

- Route definition confirmed at `server/src/routes/escalations.js:1678` (handler runs to line 2166).
- Quick-mode branch confirmed at `:1764`.
- AI branch confirmed at `:1887`.
- `parseEscalation` wrapper confirmed at `client/src/api/escalationsApi.js:103-134`.
- `quickParseEscalation` wrapper confirmed at `client/src/api/escalationsApi.js:137-143`.
- Zero importers confirmed by grep across `client/` for the symbol names and for the literal route paths.
- Test references confirmed at `server/test/integration-routes.test.js:792`, `:797`, `:1357`.
- Active chat-v5 image parse goes through `POST /api/image-parser/parse`, separately documented in `01-discovery/pipeline-map.md`.

Last updated: 2026-05-19
