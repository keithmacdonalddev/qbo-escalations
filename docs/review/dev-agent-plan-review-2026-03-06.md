# Dev Agent Plan Review

Date: 2026-03-06
Reviewer: Codex
Plan reviewed: `tmp/dev-agent-plan.md`

## Executive assessment

The plan is materially stronger than a generic "autonomous agent" concept doc. It is grounded in the current repository, correctly identifies the biggest existing limitation in dev mode (`useDevChat` is a single foreground state machine), and it reuses real infrastructure instead of inventing parallel abstractions that the codebase does not have today.

That said, it is still not implementation-ready for the stated vision. The document is close to being a solid Phase 1-3 delivery plan, but it is not yet extensive enough to implement the full "always-on autonomous dev agent" successfully in this codebase without additional design work.

The main issue is scope-to-architecture mismatch:

1. The vision says "always on", "works in the background continuously", and "same experience every time" (`tmp/dev-agent-plan.md:11-17`).
2. The proposed execution model is still browser-owned background work using the existing `POST /api/dev/chat` SSE path with no server-side background runtime until a deferred Phase 6b (`tmp/dev-agent-plan.md:235-257`, `tmp/dev-agent-plan.md:700-705`).
3. In the current code, dev mode lives in the React app, and active work is tied to the life of the page and the SSE connection (`client/src/App.jsx:85-86`, `client/src/App.jsx:249-252`, `server/src/routes/dev.js:976-978`).

That mismatch creates the most important gaps below.

## What the plan gets right

1. It correctly identifies the current foreground-only constraint in `useDevChat` and does not pretend background tasks can be bolted onto the existing hook without separation (`tmp/dev-agent-plan.md:149-176`; `client/src/hooks/useDevChat.js:48-91`, `client/src/hooks/useDevChat.js:217-355`).
2. It correctly avoids preemptive cancellation as a first implementation because Windows + `shell: true` makes process termination unreliable in this codebase (`tmp/dev-agent-plan.md:243-248`; `server/src/routes/dev.js:624-667`, `server/src/routes/dev.js:966-974`, `server/src/routes/dev.js:1138-1143`).
3. It correctly reuses existing assets that already exist on disk: `/api/dev/tree`, `onCircuitChange()`, TF-IDF retrieval patterns, and the existing `DevConversation` storage model (`tmp/dev-agent-plan.md:33-38`; `server/src/routes/dev.js:1323-1365`; `client/src/api/http.js:79-82`; `server/src/lib/playbook-loader.js:353-398`).
4. It correctly moves memory summarization out of the request path and keeps initial memory retrieval bounded (`tmp/dev-agent-plan.md:347-390`).

## Findings

### 1. High: the proposed browser-owned background layer does not satisfy the plan's own "always on" requirement

The plan's core promise is continuous background behavior even when the user is not actively on the dev page (`tmp/dev-agent-plan.md:13-17`). But the proposed implementation still keeps background execution in the client via `useBackgroundAgent` and `sendBackgroundDevMessage()` (`tmp/dev-agent-plan.md:153-259`), while the actual dev runtime today is tied to a live SSE request and a mounted page.

Current code evidence:

1. The dev hook is instantiated inside the React app, not in a persistent worker (`client/src/App.jsx:85-86`).
2. Dev mode is only kept alive because the component stays mounted in the SPA (`client/src/App.jsx:249-252`).
3. The server kills work when the request closes (`server/src/routes/dev.js:976-978`).

Impact:

1. Refreshing the page, closing the tab, browser sleep, or a network interruption kills background work.
2. Git watch events and auto-fixes cannot be truthfully described as "always on" if no client is connected.
3. Phase 6b is framed as optional/deferred, but for the stated product promise it is actually the durability layer.

Required plan change:

1. Either lower the product claim now to "background while the app tab is open" and keep Phase 6b deferred.
2. Or move a server-owned background executor much earlier in the sequence and make the client queue only a UI/control surface.

I would not ship the current wording and architecture together.

### 2. High: the plan has no context freshness or session invalidation strategy for resumed Claude sessions

The plan intentionally skips system prompt injection when a Claude session is resumed (`tmp/dev-agent-plan.md:88-91`). That fits the current implementation pattern, where resume is controlled only by provider family (`server/src/routes/dev.js:75-77`, `server/src/routes/dev.js:899-900`).

The problem is that the system prompt is no longer static once this feature ships. After the plan lands, the effective system prompt depends on:

1. `CLAUDE.md`
2. file tree snapshot
3. memory retrieval results
4. possibly health/context behavior changes over time

If resumed sessions skip reinjection, then the agent will keep running with stale context after:

1. new memory entries are written
2. `CLAUDE.md` changes
3. file tree summary changes materially
4. auto-fixes happen in other background channels

Impact:

1. The agent will not actually be "always an expert" across long-lived sessions.
2. The same conversation can silently diverge in capability depending on whether it resumed or restarted.

Required plan change:

Add a `contextVersion` or `systemPromptHash` strategy for dev mode:

1. Hash role prompt + relevant `CLAUDE.md` content + tree snapshot generation stamp + memory selection basis.
2. Store that hash on the conversation/session.
3. Force non-resume when the hash changes materially.
4. Decide whether background channels intentionally preserve old context or rotate to fresh sessions.

Without this, memory and context phases are only partially real.

### 3. High: long-running background channels will blow up prompt/history size unless the plan adds rotation or summarization at the conversation level

The plan introduces persistent background channels for `auto-errors`, `code-reviews`, and `quality-scans` (`tmp/dev-agent-plan.md:178-193`). Those channels are meant to live across refreshes and accumulate work.

But the current server route rebuilds the full conversation history for each non-resumed Claude turn and every Codex turn:

1. `historyMessages` is built from the entire saved conversation (`server/src/routes/dev.js:902-906`).
2. `buildConversationPrompt()` serializes the entire message list (`server/src/routes/dev.js:295-312`).
3. Codex always gets a full stdin conversation prompt (`server/src/routes/dev.js:548-581`).

The plan caps system-prompt sections (`tmp/dev-agent-plan.md:381-390`) but does not cap or rotate the conversation history itself.

Impact:

1. Background channels will become slower and more expensive over time.
2. Codex channels are the most exposed because they do not have session resume and therefore keep re-sending history.
3. Auto-review and idle-scan channels are exactly the ones most likely to grow without a human clearing them.

Required plan change:

Introduce channel lifecycle rules before Phase 3/5 ship:

1. hard max turns or chars per background conversation
2. automatic channel rotation once thresholds are crossed
3. summary handoff when rotating
4. stale-channel recovery when the referenced conversation no longer exists

This is a prerequisite, not polish.

### 4. High: the queue and "only one request at a time" guarantee is only scoped per tab, but the plan turns on autonomous behaviors by default

The plan promises one request at a time across foreground and background (`tmp/dev-agent-plan.md:239-256`, `tmp/dev-agent-plan.md:559-564`). That is reasonable inside one React tree, but the codebase today runs in React `StrictMode` (`client/src/main.jsx:73-82`) and the app can be opened in multiple tabs.

Because the autonomous hooks are planned as client-side defaults:

1. each open tab would register error capture and review listeners
2. each tab could create its own background queue
3. each tab could consume the same `/api/dev/watch` events
4. each tab could submit duplicate auto-fixes or duplicate code reviews

Current evidence:

1. the dev runtime is mounted at app level (`client/src/App.jsx:85-86`)
2. the plan's background registry is localStorage-based but does not define ownership/leadership (`tmp/dev-agent-plan.md:178-193`)
3. no cross-tab coordination exists in the repository today

Required plan change:

Add explicit cross-tab coordination:

1. `BroadcastChannel` or localStorage lease/heartbeat
2. one elected "active dev agent" tab
3. passive tabs render status only
4. leader handoff on visibility change/unload

Without that, "default ON" means "duplicate ON."

### 5. High: the plan underestimates rate-limit starvation risk for user-initiated work

The existing dev endpoint is rate-limited to 8 requests per minute (`server/src/routes/dev.js:67-69`). The plan explicitly enables these by default:

1. auto-error capture (`tmp/dev-agent-plan.md:507-547`, `tmp/dev-agent-plan.md:781-786`)
2. auto-review (`tmp/dev-agent-plan.md:642-675`, `tmp/dev-agent-plan.md:781-786`)
3. idle scans (`tmp/dev-agent-plan.md:583-590`, `tmp/dev-agent-plan.md:781-786`)

The document says background work will "naturally throttle" because it shares the same rate limit (`tmp/dev-agent-plan.md:237-239`). That is not enough. Shared throttling means autonomous traffic can consume the same quota the user needs for foreground work.

Impact:

1. A noisy error burst or frequent file changes can make the dev page hit 429s.
2. The user will experience the product as less responsive precisely when it is trying to be helpful.

Required plan change:

Add foreground reservation and backoff policy:

1. reserve a minimum number of tokens/slots per minute for manual user sends
2. demote or defer idle scans first
3. coalesce repeated auto-errors and repeated file-change batches
4. include 429 handling rules in the client queue

This needs to be designed before default-on background automation.

### 6. Medium-High: the change-detection loop will still be noisy and can race with logging/self-exclusion

The plan uses `git status --porcelain` every 15 seconds and excludes agent-authored changes by consulting recent `filesAffected` from `DevAgentLog` (`tmp/dev-agent-plan.md:648-675`). That is directionally correct, but still underspecified for this codebase.

Gaps:

1. `logAgentAction()` is intentionally fire-and-forget (`tmp/dev-agent-plan.md:341-345`), so change detection can observe a file before the exclusion record is durable.
2. The proposed tool-path extraction is partial and will miss some write paths, especially Bash-based edits and multi-file commands (`tmp/dev-agent-plan.md:277-300`; current raw tool capture at `server/src/routes/dev.js:391-443`).
3. There is no stable-working-tree debounce. Reviewing every dirty snapshot every 15s will fight ordinary user editing.
4. The server-side watch service lifecycle is not defined. The plan does not say whether one singleton detector exists process-wide or whether each SSE client creates one.

Required plan change:

1. Add a stable snapshot rule: only emit a review task when the same dirty set persists for N seconds.
2. Maintain a short in-memory recent-agent-files set synchronously at response completion, not only via async DB log.
3. Define `change-detector` as a singleton service with explicit start/stop semantics.
4. Batch and coalesce repeated changes on the same files.

Without this, Phase 5 will create unnecessary churn.

### 7. Medium: the health endpoint mixes server-observable state with client-only state

The proposed `/api/dev/health` response includes:

1. queue depth
2. background streaming state
3. circuit breaker state

See `tmp/dev-agent-plan.md:460-488`.

But in the current code:

1. `onCircuitChange()` exists only in the browser fetch layer (`client/src/api/http.js:79-82`)
2. background queue depth would live in the React app, not on the server
3. background streaming is also client-side under the current plan

So a server endpoint cannot truthfully "aggregate existing state" for those fields unless the client posts status back up or the queue is moved server-side.

Required plan change:

Split health into:

1. server health: prompt/tree/memory/session/runtime state the server actually knows
2. client health: queue depth, current stream, circuit breaker
3. widget composition: merge both in the UI

Otherwise the dashboard will show placeholders or stale lies.

### 8. Medium: background conversation lifecycle and UX are still underspecified

The plan introduces persistent background channel conversation IDs in localStorage (`tmp/dev-agent-plan.md:178-193`) and later expects the mini-widget to navigate to those channels (`tmp/dev-agent-plan.md:531-535`).

The current dev conversation UX is built around ordinary user sessions:

1. list conversations (`server/src/routes/dev.js:1162-1218`)
2. select conversation (`client/src/hooks/useDevChat.js:170-200`)
3. delete conversation (`client/src/hooks/useDevChat.js:367-389`)

Missing design decisions:

1. What title does each background conversation get?
2. Do background channels appear in the normal history list?
3. What happens if the user deletes one of those conversations?
4. How is a stale localStorage conversation ID repaired after 404?
5. Are background conversations user-editable, renameable, or pinned?
6. If quick-chat happens from the mini-widget, which conversation receives the message while a background channel is active?

Required plan change:

Add channel metadata and recovery rules:

1. server-side channel type on `DevConversation` or deterministic title convention
2. stale-ID repair path
3. UI visibility rules for background channels
4. explicit routing behavior when the mini-widget opens "auto-errors"

This is not just UX polish; it affects correctness and recoverability.

### 9. Medium: tool-event normalization is still too shallow for its planned responsibilities

The review already improved the plan by moving file extraction into a normalizer, but the current proposal still under-specifies the actual canonical schema (`tmp/dev-agent-plan.md:268-308`).

Today the server stores tool events in a very thin form:

1. `tool`
2. `status`
3. raw `details`

See `server/src/routes/dev.js:391-443` and `server/src/models/DevConversation.js:7-31`.

The proposed extractor mostly looks for `path`/`file_path`. That is enough for some `Read`/`Write` cases, but not enough for:

1. Bash commands that edit files indirectly
2. tools with arrays of paths
3. relative paths vs absolute paths
4. Windows paths outside root or mixed separators
5. commands that create/delete/move files

Required plan change:

Normalize into a richer event shape at capture time, for example:

1. `toolFamily`
2. `operation`
3. `pathsRead`
4. `pathsWritten`
5. `raw`
6. `provider`

Then make memory, self-exclusion, and health features depend on that canonical form instead of reparsing raw event payloads later.

### 10. Medium: the plan should explicitly handle dev-route security exposure or state that local-only is a hard assumption

This repository already exposes project-level file read/tree endpoints behind only the dev-mode enable flag:

1. `/api/dev/file` (`server/src/routes/dev.js:1281-1321`)
2. `/api/dev/tree` (`server/src/routes/dev.js:1323-1365`)

`FEATURES.md` already contains a concrete "Dev Mode Auth Gate" idea (`FEATURES.md:186`), and the new feature substantially increases the power of those endpoints by making autonomous behaviors default-on and reachable from anywhere.

If this remains local-only, that assumption needs to be explicit in the plan. If not, the auth gate should be promoted from brainstorm to near-term requirement.

I do not consider this the top implementation blocker for a local tool, but it is a real gap in rollout readiness.

## Missing acceptance criteria

The plan needs a few repo-specific acceptance criteria added before implementation begins:

1. Context freshness:
   Background or resumed conversations must invalidate/reseed when context hash changes.
2. Channel growth:
   Background channels must rotate or summarize before prompt history exceeds a defined threshold.
3. Cross-tab ownership:
   Only one tab may run autonomous queues and watchers at a time.
4. Foreground protection:
   Manual `sendMessage()` requests must keep a reserved rate-limit budget.
5. Change detector stability:
   The same dirty set must be stable for a debounce window before an auto-review is emitted.
6. Stale background IDs:
   Deleted or missing background conversations must self-heal without manual localStorage cleanup.
7. Health truthfulness:
   No `/api/dev/health` field may report client-only state unless that state is explicitly sourced from the client.

## Recommended changes to implementation order

The current sequence is close, but I would adjust it:

1. Pre-req: fix `CLAUDE.md`.
2. Phase 1: identity/system prompt.
3. Add dev-context versioning and resume invalidation rules before shipping memory.
4. Phase 2.5: context provider if you still want it for prop cleanup.
5. Phase BG only if the product promise is narrowed to "while the app tab is open".
6. Add background channel lifecycle rules and cross-tab leadership before Phase 3.
7. Phase 1.5a memory.
8. Phase 2 health/context builder, but split client vs server health.
9. Phase 3 auto-error capture with explicit rate-budget rules.
10. Phase 6a queue after the ownership/budget rules exist.
11. Phase 5 change detection only after stable snapshot + self-exclusion design is complete.
12. Phase 7 quick chat.
13. Phase 4 devtools bridge.
14. Phase 6b remains deferred only if the product wording is also narrowed. If not, it moves up.

## Bottom line

The plan is directionally correct and much better than most feature plans of this size. It understands the existing dev-mode architecture, avoids a few obvious traps, and is specific enough to start implementation work on the early phases.

It is not yet extensive enough to implement the full feature successfully because five critical behaviors remain underdesigned:

1. true always-on ownership
2. resumed-session freshness
3. background conversation growth/rotation
4. cross-tab duplication control
5. background rate-budget protection for foreground work

If those are added, the plan becomes implementation-ready.

## Verification notes

No tests were run. That follows the repository instruction to avoid test execution unless explicitly requested or truly emergency.
