# Sandbox isolation architecture

Question 2 from the user. The concern: "a sandbox sharing state with production is no sandbox at all." This document recommends a concrete approach for three kinds of isolation: prompt, result, and event. Plain English first. Every code identifier paired with a one-line description of what it does.

## North star

A sandbox run on any agent profile page must satisfy three rules:

1. **Prompt rule.** Whatever prompt text the user is tweaking in the sandbox must not be the prompt that anything else in the app reads. A live escalation parse that happens to fire while the user is typing must keep using the production prompt.
2. **Result rule.** A parse run launched from the sandbox must not write into the two collections the rest of the app already counts on — `ImageParseResult` (the durable parse-history collection — every production parse ends up here) and `ImageParserTestResult` (the curated grading collection — the Test Results tab reads from here). Sandbox runs may be persisted, but in a clearly separate place that is filtered out of every production view.
3. **Event rule.** Sandbox parse events must not appear in the production Event Streams tab on the agent profile page, which today reads from `listImageParserEventStreams` — the helper that lists past parser sessions from `ImageParseResult`.

## a. Prompt isolation

### Recommendation

**Sandbox session storage on the client side, plus an optional explicit "Promote to live" action.** The user types into a textarea (a multi-line input field) in the Sandbox tab. That draft is held in React component state (lives in the running browser tab only) and also mirrored to `sessionStorage` (browser-tab-scoped storage that vanishes when the tab closes) under a sandbox-scoped key like `qbo.sandbox.<agentId>.promptDraft`. When the user clicks **Run**, the draft text is sent to the server **inline in the request body** as a parameter the parse call already accepts in spirit — a `promptOverride` field — without ever being written to disk on the server. The production prompt file `prompts/agents/<agentId>.md` (the on-disk markdown the server loads as system instructions at request time) is left untouched.

Promotion to live happens through an explicit second click — a **"Save as new live version"** button that calls the existing `PUT /api/agent-prompts/:id` route (the route that writes the new prompt file and snapshots the previous one). That route already does the right thing: it copies the current file to `prompts/versions/agents/<id>/<timestamp>.md` (the per-agent version snapshot folder; up to 20 snapshots kept) before writing the new content. Promotion is opt-in, not automatic.

### Plain-English rationale (one paragraph)

The user is editing throwaway experiments most of the time. Persisting every keystroke to disk would either (a) bloat the version-snapshot history with junk drafts, or (b) require a parallel `prompts/agents/<id>.draft.md` file that adds its own load/save/cleanup story and one more chance to ship the wrong file. Keeping the draft in browser state with a `sessionStorage` mirror gets durability across page reloads and refresh, gives multi-tab support naturally (each tab has its own session), and makes the "promote scratch to live" workflow a single explicit button click that already has a battle-tested server endpoint and version history. Risk of accidentally shipping a sandbox prompt to production goes to near zero because the production prompt file is never touched until the user clicks the promotion button.

### Tradeoffs noted

- Durability across browsers and devices: zero. If the user wants to take a draft home, they copy/paste, or click promote. This is fine for the user's stated workflow ("experiment, click pass/fail, keep iterating").
- Multi-tab support: a feature, not a bug. Two tabs = two independent drafts.
- Version history of drafts: none by design. The version snapshots only cover prompts the user explicitly promoted to live.
- Backend complexity: adds one optional field `promptOverride` to the parse-endpoint request body and one early branch in the parse path that uses the inline text when present, otherwise loads from disk. No new collection, no new file lifecycle.

## b. Result isolation

### Recommendation

**New MongoDB collection `SandboxParseResult` (the Mongoose model name we will register — a fresh collection with the same shape as `ImageParseResult` plus a few sandbox-specific fields).** Sandbox runs write here. Production parses keep writing to `ImageParseResult` (the existing parse-history collection) and `ImageParserTestResult` (the existing grading collection). All read-side queries (the Test Results tab, the Event Streams tab, history tab, stats endpoint) keep their existing filters and never see sandbox rows. A new pair of read endpoints — `GET /api/sandbox/parse-results` and `GET /api/sandbox/parse-results/:id` — feeds the Sandbox tab's own list view.

Schema sketch (one Mongoose model — Mongoose is the MongoDB object modelling library):

- Same core fields as `ImageParseResult` (provider, model, parsedText, timing, token usage, stream events).
- Extra: `sandboxAgentId` (which agent profile launched the run), `promptOverrideUsed` (the literal text used — short text snapshots only; if huge, just a hash), `runGroupId` (groups N parallel runs of the same image together), `runIndex` (which slot in the parallel batch), `userVerdict` (`pass` | `fail` | `pending` — single-click grading saved here, the same way `ImageParserTestResult` does today).

### Plain-English rationale (one paragraph)

A boolean `sandbox: true` flag in the existing collection looks simpler but is a trap. Every existing query in the codebase that hits `ImageParseResult` would then need a `sandbox: { $ne: true }` filter, and any one that forgets the filter silently mixes sandbox noise into production stats. The list of those queries is long and growing: history listing, stats aggregation, event-stream feed, the per-result image fetch, the `streamRunId` lookup, plus future routes nobody has written yet. A separate collection makes the boundary physical and impossible to forget — production code keeps using `ImageParseResult` and `ImageParserTestResult`, sandbox code uses `SandboxParseResult`. Mongo collections are cheap to add; the migration cost if we ever change our minds is a single copy-and-flag script.

### Tradeoffs noted

- Cross-day comparison ("how did my prompt do today vs. last Tuesday"): supported — the new collection has `createdAt` indexes, queries by `sandboxAgentId` work the same as any other Mongoose model.
- Ease of querying: high. Sandbox-only views can join freely without filter discipline.
- Storage growth: similar to today's parse history. The 50MB-per-request body limit (the project's image-upload cap) and per-request stream-event truncation already cap each row's footprint. Stale rows can be aged out by a future TTL index if it becomes a concern.
- Multi-collection writes: none. Each run writes to exactly one collection, decided at the route level.
- Migration cost: low. If sandbox and production ever need to merge for some unforeseen reason, a copy-with-flag script is straightforward. The reverse (split a flag-driven collection in two) is also straightforward but only after audit-trailing every existing query.
- Pass/Fail persistence: sandbox `userVerdict` lives on the same row as the parse. No second collection needed. The chat-area `ImageParserTestResult` row stays untouched.

## c. Event isolation

### Recommendation

**Scope tagging on the existing event bus, with a filtered subscription on the production side.** The event bus is created by `createStageEventBus` in `server/src/lib/stage-events.js` (the per-stage helper that fans events out to the SSE stream — Server-Sent Events, a one-way HTTP-to-browser channel — and also buffers them for persistence). Today the bus accepts `{ send, stageId, runId }`. We add one optional field: `scope: 'production' | 'sandbox'` (defaults to `'production'`). Every event emitted carries that scope.

Persistence stays mirrored to the run's collection (production events flow into `ImageParseResult.streamEvents`, sandbox events flow into `SandboxParseResult.streamEvents`) — natural isolation because the collections themselves are separate.

The Event Streams tab on the profile page (`AgentEventStreamsTab` in `client/src/components/AgentsView.jsx`, fed by `GET /api/agent-identities/:id/event-streams` → `listAgentWorkflowRunSessions` → `listImageParserEventStreams`) keeps querying only `ImageParseResult`. Sandbox runs never enter that feed because they never enter that collection. No extra filtering needed on the read side.

The Sandbox tab gets its own subscription that opens an SSE connection to the sandbox parse endpoint with `scope: 'sandbox'` and renders the events inline.

### Plain-English rationale (one paragraph)

Tagging is cheaper than a second event bus. The bus is already plumbed everywhere it needs to be (`services/image-parser.js:1581` emits, the route `routes/image-parser.js:218` constructs the bus from the SSE writer, the consumer `useStageOrchestrator.js` reads frames). Adding a `scope` field is a one-line change at construction time and a one-line change at every emit site (just pass-through). Persistence stays clean because sandbox events follow the data into the sandbox collection, and the production Event Streams tab only reads the production collection — no filter logic required on the read side, which is exactly the kind of forget-to-filter bug we want to eliminate.

### Tradeoffs noted

- Cross-cutting work: minimal. `createStageEventBus` adds one parameter; emit sites are unchanged because the scope is captured at construction.
- Future filter views: a "show all events including sandbox" admin view is easy to add later — it's a UI filter over a union of both collections. Not in scope for Phase 1.
- Real-time stream UX: identical to today (SSE per run), just keyed by scope at construction.

## Summary table

| Isolation kind | Recommendation | Reuses today | New code |
|----------------|----------------|--------------|----------|
| Prompt | Inline `promptOverride` in request body, draft held client-side, explicit "Save as new live version" promotion | Existing `PUT /api/agent-prompts/:id` + snapshot system | One optional field on the parse endpoint, one branch in the parse path |
| Result | New `SandboxParseResult` collection, mirrors `ImageParseResult` shape plus sandbox-specific fields | Mongoose model patterns, existing schema as template | One new model file, one new pair of list/get endpoints |
| Event | `scope` field on the existing event bus, sandbox events follow data into the sandbox collection | `createStageEventBus`, SSE plumbing, `useStageOrchestrator` consumer | One optional construction parameter, scope captured at construction |

## What this combines into

The sandbox is a write-only-to-its-own-collection lane that never touches the production prompt file unless the user explicitly clicks "Save as new live version", never writes to `ImageParseResult` or `ImageParserTestResult`, and never appears in production Event Streams. Three rules, three concrete mechanisms, three small additions to existing infrastructure. No production read paths change.

Last updated: 2026-05-19
