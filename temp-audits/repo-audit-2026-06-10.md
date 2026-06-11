# Repo Audit & Improvement Plan — qbo-escalations

**Date:** 2026-06-10 · **Method:** 1 discovery agent + 5 parallel read-only audit agents (server architecture/quality, client architecture/quality, security, testing/DevEx/docs, performance/dependencies), all claims verified against current working-tree code this session. No code was modified. The only execution was the existing test suite (short-lived, nothing left running).

---

## Executive Summary

**Overall health: B−.** The core engineering is far above typical solo-project maturity — a uniform API error contract, 92 test files (~32k lines) that assert real behavior, disciplined graceful shutdown, a genuinely defense-in-depth knowledge-base safety boundary, and a hardened client HTTP layer. What drags the grade down is that the safety net isn't *watching*: the test runner stops at the first failing file and there is no CI, so 66 of 91 test files haven't run via `npm test` and four independently-red files sat invisible for days. There are **zero Critical findings at the current localhost deployment**, but one new **High security finding** (the command-injection allowlist can be bypassed through the image-parser's failover `fallbackModel` field) and one **High correctness finding** (chat image limits exceed what MongoDB can physically store).

**Top 3 risks:** (1) invisible regressions — the suite is blocked at file 26/91 by one hanging test, with no run-all mode and no CI; (2) the `fallbackModel` injection-guard bypass reaching a `shell:true` subprocess spawn; (3) duplication at contract boundaries (two ~1,100-line near-identical chat handlers, six ~95%-identical provider transports, three copies of the parse SSE client) — every fix is a multi-edit gamble.

**Top 3 opportunities:** (1) one small test fix plus a CI job re-arms the entire 32k-line safety net; (2) two pure code relocations (the provider key store and the KB-draft pipeline) dissolve the whole circular-dependency knot; (3) deleting ~10,400 lines of confirmed-dead legacy chat UI plus tracked junk shrinks the maintenance surface ~8% with zero behavior change.

---

## Phase 1 — Repo Map

**Purpose:** AI-assisted workbench for a QBO (QuickBooks Online) escalation specialist — parses escalation screenshots, triages cases, drafts responses, and grows a governed knowledge base. Per `PRODUCT_NORTH_STAR.md`, QBO is the first domain module of a broader operational-intelligence platform. Single operator, single machine, treated as personal production.

**Stack:** JavaScript only (no TypeScript). Client: Vite 7 + React 19 (ESM), no state library by design. Server: Express 5 + Mongoose 9 (CommonJS), Node with a 512MB heap cap. MongoDB Atlas. AI via two transports: (1) Claude/Codex CLI subprocesses (`server/src/services/claude.js`, `codex.js`), (2) direct provider HTTPS APIs (7 harnesses under `server/src/services/providers/`).

**Scale:** ~242k lines of app code — client 130k (of which ~54k is CSS), server 80k, tests 32k across 92 files. 131 commits over ~3.5 months.

**Main flow:** Client → `POST /api/chat` (`server/src/routes/chat/send.js`) → context build (playbook + governed knowledge) → image-parser leg, known-issue search, INV matching, triage leg → analyst leg via `chat-orchestrator.js` → provider registry → CLI subprocess or direct API → SSE stream back (SSE = server-sent events, a one-way text stream to the browser) → conversation persisted to Mongo, with usage/cost/trace/forensic-capture side channels. Image parser and triage also run as standalone harnesses.

**Key directories:** `client/` (SPA), `server/` (API + 32 Mongoose models), `playbook/` (markdown knowledge loaded as system prompt), `shared/` (provider catalog), plus ~8 tracked workspace/research dirs, 251 tracked screenshots, 198 prototype files — **~42% of tracked files are non-product artifacts**.

**Surprises from discovery:** client is bigger than the server; `routes/chat/send.js` holds two near-duplicate SSE handlers; two chat UIs ship in parallel (one is dead — see C1); no README, no CI, no linting anywhere; two junk files committed at root (a 412KB PNG and a 144KB file whose *name* is a mangled Windows temp path); `review-screenshots/` is gitignored yet 251 files are tracked.

**Lighter-review areas (honesty note):** workspace-agent subsystem internals (~20 services), room orchestrator, Gmail/Calendar service internals, `prototypes/`, and the past-phase research dirs were sampled, not deep-read. Client render performance was assessed statically only. The `getKnowledgeSummary` miscount from prior notes was *not* re-verified today.

---

## Phase 2 — Audit Report

Severity is calibrated to the actual deployment: localhost, single operator, no auth by design. FACT = verified in code/output this session; JUDGMENT = assessment.

### What improved since prior notes (verified today — do not re-fix)

- KB redaction now masks the **full record body** through a single chokepoint on every read/export path (`knowledgebase-service.js:408-459`), and redacted publishes are forced DB-only. The old "redaction doesn't mask body" blocker is **closed**. (FACT)
- `abort.test.js` and `image-parser-comprehensive.test.js` both **pass** now (15/15, 132/132) — the suite's wall has *moved*, not fallen. (FACT)
- `claude.js` stderr timer re-arm bug fixed with guard + comment (`claude.js:372-380`); `AgentIdentity` arrays capped at the service layer (`agent-identity-service.js:24-31`); 5 of 6 known client bugs fixed (token guard, toast timers, unmount aborts, room composer `apiFetch`, SSE error-channel unification). (FACT)
- All five previously-shipped security fixes hold: injection allowlist, 50MB body limit + 413 mapping, `select:false` secrets, TTL indexes, KB markdown kill-switch. (FACT)

### Security

- **S1 · HIGH (FACT): injection-allowlist bypass via image-parser failover `fallbackModel`.** `parseImage` validates only the primary model (`image-parser.js:2857`); the failover branch passes request-supplied `options.fallbackModel` unvalidated to the backup provider (`:3116-3147`). For a Claude-CLI backup, that string reaches `--model <model>` in `providers/claude-cli-provider-harness.js:314` and a `shell:true` spawn at `:551` — and that harness, unlike `claude.js`/`codex.js`, has **no** model guard. Attack path: a request with a failing primary + Claude-CLI fallback + shell metacharacters in `fallbackModel` = OS command execution. Localhost-only and the operator already has a shell, so High not Critical — but it is a concrete bypass of a documented security control, and Critical the day anything is exposed.
- **S2 · MEDIUM (FACT): no auth/CSRF; sharpest edge is unauthenticated `PUT /api/image-parser/keys`** (`routes/image-parser.js:447-457`) which stores provider API keys. Mitigating structure (JUDGMENT): JSON-only body parsing + CORS preflight + loopback-scoped origin policy (`origin-policy.js:51-58`) largely neutralizes drive-by browser CSRF. Residual surface = local processes/pages. Acceptable now; Critical if exposed.
- **S3 · MEDIUM (FACT): KB runs as ADMIN in dev.** `defaultKnowledgeRole()` returns ADMIN and `x-knowledge-role` headers are trusted whenever `NODE_ENV !== 'production'` (`knowledgebase-management-service.js:200-227`) — which is how the app actually runs. Combined with S2, any local caller can publish/redact/deprecate KB records.
- **S4 · MEDIUM (FACT): KB read routes are ungated** — `/records/:id`, `/search`, `/export`, dry-run `/agent/scan` expose draft/unsafe content to any local caller (`routes/knowledge.js:121-143` gates only writes). The crown-jewel guarantee (drafts can never reach *agents* as trusted guidance) still holds — verified again today (`applyPolicyQueryConstraints:696-728`).
- **S5 · MEDIUM (FACT): provider keys are plaintext at rest** (Mongo + `data/image-parser-keys.json` fallback, `image-parser.js:262-276`). `select:false` prevents accidental query leakage, not disk-level reads. Decision deferred to owner (lockout risk of an env-key scheme is real for this user).
- **S6 · LOW (FACT): missing path-containment assertion** in `lib/image-archive.js:339-366` — `imageId` from the route is unvalidated (`routes/chat/image-archive.js:244-249`), though exploitability is tightly constrained (only files literally named `image.*` can be returned). Prior pointer to `image-parser.js:1757` is stale; `image-parser-archive.js` path is fine.
- **S7 · LOW (FACT): WS servers check Origin but allow empty-Origin/local callers**; a loopback page can burn the operator's ElevenLabs quota via `/api/live-call-assist/stream` (`live-call-assist-server.js:171-186`).
- **Clean (FACT):** no hardcoded secrets in tracked source (only intentional redaction-test fixtures); git history has no committed `.env`; the KB agent write-tool boundary is solid (field whitelist + server-side governance strip + published-lock — prompt injection can at most scribble in one open draft's text fields); the playbook markdown writer sanitizes paths.

### Correctness & Performance

- **P1 · HIGH (FACT): chat image limits exceed MongoDB's physical document cap.** Chat accepts 20MB/image, 30MB total (`lib/chat-image.js:5-7`) and persists base64 images *inside* the Conversation document (`send.js:796-811`), but Mongo documents hard-cap at 16MB. An image over ~12MB decoded makes the conversation unsaveable; `saveConversationLenient` (`routes/chat/shared.js:22-50`) catches only `ValidationError`, so a BSON-size error becomes a 500 *after* the provider call already ran and the message is lost. Latent (typical screenshots are 0.1–2MB) but baked into config.
- **P2 · MEDIUM (FACT): forensic capture payloads leak on disk by design.** Provider-call capture is forced on every image-parser call; bodies >512KB (any large screenshot) are written under `server/data/provider-call-packages/` and **no code ever deletes them** (Mongo TTL removes only the DB docs; `payload-store.js` has zero unlink logic; `.env.example:103-106` admits it). Currently dormant (directory doesn't exist on this machine yet) but a real unbounded-disk path.
- **P3 · MEDIUM (FACT): heap math.** 512MB heap cap (`server/package.json:6-7`) vs 4–6 transient copies of a payload on the parse path (body-parser buffer, parsed string, normalized dataUrl, wire stringify, capture stringify, archive Buffer). A max-size 50MB body peaks ~200-300MB; two concurrent = OOM. Realistic screenshots are fine; the config permits what the heap cannot honor.
- **P4 · LOW-MEDIUM (FACT): `/parse` ignores client disconnect** — no `res.on('close')`/abort wiring (`routes/image-parser.js:147-412`), so an abandoned parse runs up to 120s and bills tokens. The chat route does this correctly (`send.js:848`).
- **P5 · LOW (FACT): ChatRoom.messages is unbounded** — `$push` with no cap (`chat-room-service.js:124`, `ChatRoom.js:66`), messages embed thinking/tool results/parse context; slow-burn march toward the 16MB cap in long-lived rooms.
- **P6 · LOW (FACT): agent-health monitor force-probes providers every 60s** with real metered mini-calls, duplicating a separate 5-min timer (`agent-health-service.js:26`, `index.js:282-295`). Cents/day; the issue is cadence + duplication, and reachability monitoring is a stated requirement, so tune rather than remove.
- **Clean (FACT):** Mongo read hygiene is good — 89 indexes, `lean()`/projections/`maxTimeMS` on hot lists, denormalized counts, no material N+1; chat SSE is exemplary (heartbeat, close-cleanup before first write, true streaming); schedulers have re-entrancy guards and daily caps.

### Architecture & Design

- **A1 · HIGH (FACT): two near-identical SSE chat handlers.** `POST /` (`send.js:333-1814`) and `POST /retry` (`send.js:1816-2948`): **86% of the retry handler's 1,082 substantive lines are character-identical** to the main handler. Every chat-flow fix must land twice; a missed mirror edit ships silently as a retry-only bug. A shared helper already exists (`send.js:215`) proving extraction is feasible.
- **A2 · HIGH (FACT): the provider credential store lives inside the 3,675-line image-parser god-file**, so generic infrastructure (`remote-api-providers.js:5`, `triage.js:20`, `agent-health-service.js:10`) depends on a feature service — creating the require cycle that forces 6 lazy-require workarounds.
- **A3 · HIGH (FACT): a service requires a route module.** `knowledgebase-draft-trigger.js:50` requires `routes/escalations.js` to reach the KB-draft pipeline, which lives in that 1,933-line route file (`buildKnowledgeDraftData:290` … `ensureKnowledgeDraftForEscalation:1403`). Documented as deliberate (`:3-24`) — the team knows the implementation is in the wrong layer.
- **A4 · MEDIUM (FACT): 6 explicit circular-dependency lazy-require workarounds**, all traceable to A2 + A3. Fix those two and these become deletable.
- **A5 · MEDIUM (FACT): six provider harnesses are ~95% identical transport code** (kimi vs openai `sendJsonRequest`: 230/243 lines identical) with observable drift already (error-logging and trace-field differences). The consumption-layer abstraction (`providers/registry.js`) is genuinely good; the copy-paste is confined beneath it.
- **A6 · MEDIUM (FACT/JUDGMENT): ~25% of the server (~20k lines) serves features beyond QBO escalations** (workspace agent ~10.5k, rooms ~4.6k, Gmail/Calendar ~2.6k, live-call/shipments/copilot ~2.4k) with no isolation boundary. Scope intent is an owner decision (see Open Questions).

### Code Quality

- **C1 · HIGH (FACT): ~10,400 lines of dead legacy chat UI.** `App.jsx:28` lazily imports `Chat.jsx` but `<ChatView>` is never rendered; the entire `components/chat/` graph except `ImageParserPopup.jsx` roots at it (Chat.jsx 926 + Chat.css 4,699 + ~4,800 more). Bugfixes can land there with zero runtime effect. Caution: the *engine* underneath (`hooks/useChat.js`) is **alive** (ChatMiniWidget, WorkspaceShell) — deletion scope is the view layer only.
- **C2 · HIGH (FACT): the AppHeader global provider picker is still live** (`AppHeader.jsx:695-723`, UI at `:782-856`) — a second authority competing with the agent-profile Runtime Defaults picker, directly against the standing single-source-of-truth direction.
- **C3 · HIGH (FACT): CSS architecture.** 54k CSS lines; 11 stylesheets load globally at boot (`main.jsx:10-20`); `overhaul.css` alone has **3,197 `!important`s** and its `header [class*="title"]` transparent-text trap is live (`overhaul.css:3805-3821`) — component code now *chooses class names to dodge it* (comments at `AgentsView.jsx:1978, 2355`). `AgentsView.css` (4,879 lines) is imported globally **and** by the component, defeating its lazy split.
- **C4 · MEDIUM (FACT): `safeString()` is defined 31 times with ≥3 divergent semantics** — `ai-traces.js:10` silently truncates to 400 chars under the same name others use for plain coercion.
- **C5 · MEDIUM (FACT/JUDGMENT): observability writes fail silently.** 117 inline `.catch(() => null)`s; every trace persistence call in `routes/chat/parse.js` (13 sites) swallows errors with zero logging — for a product whose proof layer *is* the evidence trail, a systemic trace-store failure would be invisible. `lib/best-effort.js` exists; adoption is partial.
- **C6 · MEDIUM (FACT): the parse SSE client is triplicated** nearly verbatim (`useStageOrchestrator.js:160-250`, `useImageParser.js:42-130`, `ChatRoomComposer.jsx:173-260`) — including the same pasted contract comment. The chat-room copy also omits the failover-intent payload (`fallbackProvider`/`agentRuntime`), so room-initiated parses plausibly skip Wave-2 failover (server default unverified).
- **C7 · MEDIUM (FACT): god components** — `AgentsView.jsx` 6,737 lines, main component ~1,351 lines with 52 `useState`; `KnowledgebaseView.jsx` and `ChatV5Container.jsx` are runners-up. Two live chat engines duplicate SSE orchestration concepts. localStorage: 26 modules, 19+ keys, and the image-parser provider resolved three different ways depending on launch surface.
- **C8 · LOW (FACT): dead/misleading files** — `chat-v5/mockData.js` is ~80% dead but exports three live STAGE_* constants and its header comment is false; `sampleScreenshot.js` fully orphaned; `lib/tool-normalizer.js` (99 lines) unreferenced; one raw `fetch` remains in `ChatRoom.jsx:484-495` duplicating `roomApi.updateRoom`.

### Testing

- **T1 · HIGH (FACT, run today): `npm test` is RED and blind.** 25 files pass, then `test/image-parser-deep.test.js` hangs forever (it never connects Mongo, while `parseImage` now requires it for forced capture — `image-parser-comprehensive.test.js:30-38` documents the exact fix it received and deep didn't), eats the 120s file timeout with zero output, and the fail-fast runner stops — **66 files never run**. Behind the wall: `kimi-provider-harness` red since 2026-06-02 (`temperature: 1` added to `callKimi` at `image-parser.js:1750`, pinning test never updated — contract drift nobody decided), `usage-integration` 12/15 (3 error-path tests stale against always-on failover), `test-runner-routes` (cascade of the hang). **Today's true baseline: 87/91 files green.**
- **T2 · MEDIUM (FACT): the runner has no run-all/summary mode** (`run-tests.js:102-113`) and passes no `--test-timeout`, so hangs are undiagnosable. This is now a proven cost, not a hypothetical.
- **T3 · MEDIUM (FACT): the workspace agent subsystem (~20 services, takes real actions) has zero dedicated tests.**
- **T4 · LOW (FACT):** the one client test passes but nothing runs it; `/knowledge/unpublish` untested. Counter-finding: `/api/chat/retry` *is* well covered.
- **Quality (JUDGMENT, evidence read): genuinely high** — behavior-level assertions, real SSE testing over real sockets, regression tests with rationale comments, ref-counted shared in-memory Mongo, and a gate that hard-blocks accidental real provider calls in tests.

### Dependencies

- **D1 (FACT):** `ws` 8.20.0 (uninitialized-memory advisory, production WS servers) — drop-in fix to 8.21.0. Vite 7.3.1 has three High dev-server advisories (fix in range). `path-to-regexp` High ReDoS via Express 5 (theoretical here). Root: shell-quote Critical via `concurrently` (dev-only launcher). **All fixable with in-range `npm audit fix`; client app deps: zero vulnerabilities.**
- **D2 (FACT, LOW):** `googleapis` is 196MB on disk for two services (scoped packages would do); `@anthropic-ai/claude-agent-sdk` pinned old but only used by an opt-in legacy path. Lockfiles present and consistent; no license risks; `sharp` is genuinely used.

### DevEx, Operations & Documentation

- **X1 · MEDIUM (FACT): no CI at all** — the other half of T1; even a free Actions job would have caught all four red files the day they landed.
- **X2 · MEDIUM (FACT): a new machine cannot be bootstrapped from anything written.** No README; CLAUDE.md never mentions the three `npm install`s, Node version (no `engines`/`.nvmrc`), the required `claude`/`codex` CLIs on PATH, or Atlas provisioning.
- **X3 · LOW (FACT):** CLAUDE.md drift (`routes/chat.js` → now `routes/chat/`; root `npm test` also runs stress-harness files); FEATURES.md (169KB) is an idea log, not docs; two junk files tracked at root; error handler logs without request IDs (`app.js:115`) despite solid request-ID middleware; no lint/format config; no deployment story (honest for localhost).
- **Strengths (FACT):** `.env.example` is exemplary (107 documented knobs incl. known gaps); nodemon ignores runtime-write dirs; the test runner's Windows process-tree kill is correct; graceful shutdown is designed, not bolted on.

### Strengths (what to preserve)

1. **Uniform `{ ok, code, error }` contract enforced end-to-end** — including the JSON 404 catch-all and 413 mapping (`app.js:100-143`).
2. **A serious, behavior-asserting test suite** (92 files) with production-grade test safety rails — 96% green once actually run.
3. **The KB crown-jewel boundary is real defense-in-depth** (field whitelist + actor-role strip + published-lock + redaction chokepoint) — verified again today.
4. **The fix loop demonstrably works**: 5 of 6 stale client leads and all prior security fixes were found *fixed, with explanatory comments at the fix site*.
5. **Self-documentation at the point of weirdness** (the service→route inversion carries a 24-line rationale; removed routes get dated tombstones) — which makes the recommended refactors unusually safe.
6. **Hardened client HTTP layer** (`api/http.js`: timeouts, retries, circuit breaker, dedupe) with only 2 raw-fetch escapes in 130k lines.

---

## Phase 3 — Improvement Strategy

**Theme 1: The safety net exists but isn't watching.**
87/91 test files are green, yet `npm test` reports red-and-blind because one hanging file + fail-fast + no CI hide everything behind it. *Target state:* every push runs the full suite to completion; failures are visible same-day. *Principle:* a test suite only protects you if it runs to the end and someone sees the result. *Done when:* `npm test` (run-all mode) reports 91/91 green and a CI job runs it on every push.

**Theme 2: Validate and bound at the boundary — on every path, not just the main one.**
The injection guard covers the primary model but not the failover model (S1); chat accepts images Mongo can't store (P1); 50MB bodies vs 512MB heap (P3); `/parse` ignores disconnects (P4); capture payloads never get pruned (P2). *Target:* every configured limit consistent with what storage/heap can honor; every spawn input validated at every call path. *Done when:* zero High findings; regression tests pin the fallback-model guard and the image-size cap.

**Theme 3: One implementation per contract.**
86%-identical dual chat handlers, 95%-identical provider transports, triplicated parse SSE client, 31 `safeString`s, two chat engines. *Target:* a single execution core per contract, with per-provider/per-path identity preserved as *parameters*, not copies. *Principle:* duplication is only acceptable where provenance demands distinct identity — and even there, only above a shared transport. *Done when:* one chat execution core serves both send and retry; one shared parse client; one `safeString`.

**Theme 4: Two misplaced responsibilities cause the architecture knots.**
The credential store inside `image-parser.js` (A2) and the KB-draft pipeline inside `routes/escalations.js` (A3) explain the cycle cluster and the worst god-file pressure. *Target:* pure relocations — `lib/provider-key-store.js` and `services/knowledgebase-draft-service.js`. *Done when:* all 6 cycle-breaking lazy requires are deleted and the modules load top-level.

**Theme 5: The product is bigger than its hygiene.**
~10,400 dead client lines, ~42% non-product tracked files, no README, dead helpers, junk commits. *Target:* ruthless deletion with explicit file-list scoping (per the standing cleanup rule), plus a 10-line bootstrap doc. *Done when:* the dead chat graph is gone, junk files untracked, and a fresh machine can reach `npm run dev` from written instructions.

**Explicitly NOT recommended now (trade-offs):**
- **No auth layer yet** — structurally mitigated CSRF + localhost makes it acceptable; it becomes the #1 blocker before any non-loopback exposure (a written pre-exposure checklist is included in M1).
- **No encryption-at-rest for keys** — the lose-the-env-key lockout risk for a non-technical operator outweighs the local threat model. Owner decision, not engineering default.
- **No TypeScript migration, no state library, no monorepo tooling** — enormous effort, marginal payoff at this maturity; the hooks-only choice is deliberate and working.
- **No CSS rewrite** — contain instead (kill the live traps, stop the global AgentsView.css import); a rewrite risks every screen for cosmetic debt.
- **No full provider-harness merge yet** — extract only the shared transport beneath per-provider identity (M3), since per-provider provenance appears deliberate.
- **No action on the 25% non-QBO scope** until the owner answers the scope question — it's a product decision, not a defect.

---

## Phase 4 — Task Plan

### Milestone 0 — Safety net (do first; everything else gets safer)

| # | Task | Effort | Risk | Depends |
|---|---|---|---|---|
| 0.1 | Fix `image-parser-deep.test.js` hang (connect in-memory Mongo like comprehensive did) | S | Low | — |
| 0.2 | Add run-all/summary mode + `--test-timeout` pass-through to `scripts/run-tests.js` | S | Low | — |
| 0.3 | Resolve kimi `temperature` contract (decide: intentional → update test; not → revert) + update 3 stale usage-integration error-path tests for always-on failover | M | Low | 0.1, OQ1 |
| 0.4 | Minimal CI: GitHub Actions job — 3 installs, run full suite on push | M | Low | 0.1–0.3 |
| 0.5 | `npm audit fix` in root/server/client (ws, vite, path-to-regexp, shell-quote — all in-range) | S | Low | — |

### Milestone 1 — Critical fixes (security & correctness)

| # | Task | Effort | Risk | Depends |
|---|---|---|---|---|
| 1.1 | Validate `fallbackModel` with the same allowlist as the primary in `parseImage`; add a spawn-site guard in `claude-cli-provider-harness.js`; regression test | S | Low | — |
| 1.2 | Reconcile chat image caps with the 16MB BSON limit (lower caps or stop inlining images in Conversation; at minimum catch BSON-size errors in `saveConversationLenient`) | M | Med | — |
| 1.3 | Path-containment assertion in `image-archive.getImageFile` + validate `imageId` route param | S | Low | — |
| 1.4 | Wire `res.on('close')` → abort signal in `/parse` (signal threading already exists internally) | M | Med | — |
| 1.5 | On-disk prune job for `provider-call-packages/` payload files (sweep older than the Mongo TTL) | M | Low | — |
| 1.6 | Diagnose why `parseImage` hangs (rather than failing loudly) when Mongo is down — runtime sibling of 0.1 | M | Low | 0.1 |
| 1.7 | Write the pre-exposure checklist into CLAUDE.md or docs/ (auth, KB least-privilege defaults, WS auth, key encryption) — documentation only | S | None | — |

### Milestone 2 — High-leverage structure

| # | Task | Effort | Risk | Depends |
|---|---|---|---|---|
| 2.1 | Extract provider key store from `image-parser.js` → `lib/provider-key-store.js`; delete the cycle lazy-requires it caused | M | Med | 0.4 |
| 2.2 | Move KB-draft pipeline from `routes/escalations.js` → `services/knowledgebase-draft-service.js`; delete the service→route require | L | Med | 0.4 |
| 2.3 | Unify `send.js` dual handlers around one execution core (retry deltas as parameters) | XL → break down | High | 0.4, tests green |
| 2.4 | Delete the dead legacy chat view graph (~10,400 lines; explicit file list; keep `useChat.js` + `ImageParserPopup`) | M | Low | — |
| 2.5 | Retire/rewire the AppHeader global provider picker (already on the follow-up list) | M | Med | — |
| 2.6 | Extract one shared parse-SSE client; give the chat-room path the failover payload (verify server default first) | M | Med | — |
| 2.7 | Consolidate `safeString` → `lib/strings.js` (two named exports: coerce + truncating variant) | M | Low | 0.4 |

### Milestone 3 — Quality & polish

| # | Task | Effort | Risk | Depends |
|---|---|---|---|---|
| 3.1 | CSS containment: remove global `AgentsView.css` import, neutralize the `[class*="title"]` trap, start an `!important` budget | L | Med | — |
| 3.2 | Cap or archive `ChatRoom.messages` | M | Med | OQ6 |
| 3.3 | Adopt `lib/best-effort.js` (warn-once) for the 13 silent trace-write swallows in `routes/chat/parse.js` | S | Low | — |
| 3.4 | Bootstrap README ("zero to `npm run dev`": 3 installs, Node version, CLI prerequisites, Atlas) + fix CLAUDE.md drift | S | None | — |
| 3.5 | Untrack junk files (root PNG, mangled-temp-path JSON); reconcile `review-screenshots/` gitignore-vs-tracked | S | None | — |
| 3.6 | Consolidate image-parser provider resolution to one path (3 today) | M | Med | 2.5 |
| 3.7 | Tests for the workspace action-loop boundary (the part that takes real actions) | L | Low | 0.4 |
| 3.8 | Fix `getKnowledgeSummary` trust-state miscount (re-verify first; not checked today) + decide KB read-gating | M | Low | OQ4 |
| 3.9 | Extract shared HTTP transport beneath the 6 provider harnesses (keep per-provider trace identity) | L | Med | 0.4 |
| 3.10 | Tune health probing: align the 60s force-probe with the 5-min timer or back off when idle | S | Low | — |

### Quick wins (S effort, high impact — can be done immediately)

**0.1** (re-arms 66 test files), **0.5** (clears every known CVE), **1.1** (closes the only High security finding), **1.3**, **3.4**, **3.5**, **3.3**.

### Implementation sketches — top 3

**0.1 — Unblock the suite.** Mirror `image-parser-comprehensive.test.js:30-38`: require `test/_mongo-helper`, `await mongo.connect()` in `before()`, disconnect in `after()`. Gotchas: the helper is ref-counted for `--test-isolation=none`, so use it (not a raw mongoose connect) or the shared instance teardown breaks; after the fix, run the *full* suite — expect `test-runner-routes` to go green as a cascade, and confirm kimi/usage-integration are the only remaining reds. Acceptance: `npm test` reaches file 91; failures (if any) are the two known contract-drift files.

**1.1 — Close the injection bypass.** In `parseImage`'s failover branch (`image-parser.js:~3116-3147`), assert the allowlist on `options.fallbackModel` before `dispatchProviderParse(backupProvider, backupModel)` — same call as `:2857`, label `'fallbackModel'` (chat already validates both at `chat-orchestrator.js:102-103`). Add a defense-in-depth `assertSafeModel` at the spawn site in `claude-cli-provider-harness.js` (mirror `claude.js:36-41`), so no future caller can regress it. Gotcha: requiring `chat-orchestrator` from `image-parser` re-enters the known cycle — follow the existing lazy-require pattern at `:3114`, or better, move `SAFE_MODEL_PATTERN`/assert into a dependency-free `lib/` module (a natural first slice of task 2.1). Regression test: malicious `fallbackModel` + failing primary → expect a 4xx `INVALID_MODEL`-class error and *no spawn* (extend `model-injection-guard.test.js`'s spy approach).

**2.3 — Unify the chat handlers (strangler approach, multiple sessions).** (1) Confirm `/retry` test coverage is green first (it exists). (2) Extract mirrored blocks bottom-up into `routes/chat/shared.js` — persistence block (`:1212↔:2521`), SSE emitters, settle/cleanup — one block per commit, full suite between commits. (3) End state: one `runChatExecution(ctx)` consumed by both handlers, with retry deltas (message rollback, `retryMessages`, skip fresh image parse) passed as options. Gotchas: both handlers thread mutable closure state (settle flags, abort guards) across 1,000+ lines — move it into an explicit context object as you extract, or the helpers will silently capture the wrong scope; SSE event *ordering* is asserted by tests, so preserve emission order exactly; never do this mid-feature.

---

## Open Questions (need the owner)

1. **Kimi `temperature: 1`** (added 2026-06-02): intentional contract change or accident? Decides whether task 0.3 updates the test or reverts the code.
2. **Scope intent:** are Gmail, Calendar, shipment tracking, and live-call-assist permanent residents of this server, or candidates for a future split/disable flag? (~25% of server code; affects how much hygiene investment they deserve.)
3. **Chat engines:** the legacy `useChat` engine still powers ChatMiniWidget and WorkspaceShell. Converge those surfaces onto the chat-v5 orchestrator eventually, or keep two engines indefinitely? (Deleting the dead *view* in 2.4 is safe either way.)
4. **Exposure timeline:** is non-localhost deployment ever planned? It flips S2/S3/S4 from Medium to Critical and makes the pre-exposure checklist (1.7) an actual milestone.
5. **Key encryption at rest** (carried from the prior backlog): accept plaintext-with-`select:false` locally, or take on the env-key lockout risk?
6. **Chat-room retention:** cap `messages` at N with archival, or hard-cap and drop? Decides task 3.2's shape.
