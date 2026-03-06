The core issue is not just “many requests”; it is an unbounded pending-request accumulation loop that keeps the UI in a non-terminal state
    (Processing...) and can starve normal chat flow.

    From your screenshot pattern (conversations?limit=50&skip=0 repeated, all pending, 0 B transferred), the effective failure mode is:

    1. One conversations-list request hangs or becomes very slow.
    2. Client keeps issuing more list requests anyway.
    3. No timeout/abort/single-flight prevents overlap.
    4. Pending requests stack, and app responsiveness degrades while the prompt appears stuck.

    What I checked in your code

    - Fetch wrapper is raw passthrough with no timeout/dedupe: http.js:1.
    - Conversation list polling exists and is overlap-prone (fixed interval, no in-flight guard): Sidebar.jsx:37.
    - Multiple list loaders are active:

    1. Chat hook loads list on mount: useChat.js:236.
    2. Dev hook loads list on mount: useDevChat.js:124.

    - Chat and Dev sections are both mounted permanently (hidden with CSS only), so both hooks can stay active: App.jsx:181, App.jsx:186.
    - Regular conversations API list query:
        - Route: chat.js:1251
        - Query: find().sort(updatedAt).skip().limit() at chat.js:1268
        - Then countDocuments() at chat.js:1297
    - Conversation model does not define an updatedAt index: Conversation.js:25.
    - DevConversation does define it: DevConversation.js:40.

    Ranked hypotheses

    1. Highest likelihood: /api/conversations becomes slow/hangs under load, then Sidebar polling stacks requests.

    - Why: no single-flight + fixed interval + no fetch timeout + heavy route pattern (find + sort + count).
    - What confirms: request URL is /api/conversations...; server logs show long route duration.

    2. High likelihood: Query inefficiency on regular conversations route.

    - Why: sorting by updatedAt without explicit index on Conversation; route fetches full docs before deriving only last preview.
    - What confirms: Mongo explain shows sort/scan cost; latency rises with document/message growth.

    3. Medium likelihood: DB connectivity degradation causes long waits/buffering.

    - Why: if Mongo is unstable, pending route calls can queue; client lacks hard timeout.
    - What confirms: MongoDB disconnected logs around incident windows and long request lifetimes.

    4. Lower likelihood but relevant: chat stream request itself is blocked, while list storm is collateral.

    - Why: “Processing…” is tied to stream lifecycle; if stream never gets terminal event, spinner persists.
    - What confirms: /api/dev/chat or /api/chat request also remains pending with no SSE events.

    Troubleshooting sequence (to prove root cause, not guess)

    1. In DevTools, click one pending request and read full Request URL to disambiguate /api/conversations vs /api/dev/conversations.
    2. Check whether the stream request (/api/dev/chat or /api/chat) is also pending and whether it received any event: frames.
    3. Add temporary per-request timing logs on both list endpoints and stream endpoint start/finish.
    4. Run Mongo explain for list query and check index usage on updatedAt.

    Proposal (reasoned, prioritized)

    1. Immediate containment

    - Add request timeout + abort for list calls.
    - Add single-flight dedupe by method+url.
    - Change polling to “next poll only after prior completes.”
    - Reason: this alone stops pending pileups even if backend is unhealthy.

    2. Backend performance/safety

    - Add conversationSchema.index({ updatedAt: -1 }) for regular conversations.
    - Optimize list route to fetch only needed fields and last message slice, not full message arrays.
    - Add query maxTimeMS and explicit 503/504 handling.
    - Reason: removes core latency trigger and forces deterministic failures over hangs.

    3. Architectural cleanup

    - Consolidate conversation-list fetching to one source of truth instead of multiple independent loaders.
    - Avoid mounting inactive heavy data hooks when route is not active.
    - Reason: prevents duplicate traffic and route-coupled race conditions.

    This is the non-random diagnosis path: hanging/slow list endpoint + overlap-prone polling + no timeout/single-flight. Execution Plan: Fix Pending Conversation-Request
  Storm + Harden End-to-End Pipeline

    Current evidence from codebase aligns with your screenshot pattern (many pending conversations?limit=50&skip=0 requests):

    - apiFetch is a raw passthrough with no timeout/dedupe in client/src/api/http.js#L1.
    - Conversation polling exists in client/src/components/Sidebar.jsx#L37.
    - Chat and Dev hooks both fetch conversation lists at mount in client/src/hooks/useChat.js#L236 and client/src/hooks/useDevChat.js#L124.
    - Both Chat and Dev views are always mounted (hidden via display) in client/src/App.jsx#L181 and client/src/App.jsx#L186.
    - Backend list routes likely targeted are server/src/routes/chat.js#L1251 and server/src/routes/dev.js#L927.
  ## 1. Incident Containment (same day)

    1. Add client-side request timeout + abort for all GET /conversations* calls.
    2. Add single-flight dedupe for identical in-flight URL/method requests.
    3. Gate Sidebar polling so next tick starts only after prior request settles.
    4. Pause polling while tab is hidden and while request backlog > 0.

    Success criteria:

    1. No more than 1 in-flight request per conversations endpoint per view.
    2. Pending requests do not accumulate in DevTools.
    3. UI exits Processing... into either response or explicit error state.

    ## 2. Root Cause Confirmation (same day, before broad refactor)

    1. Distinguish endpoint path in failing session: /api/conversations vs /api/dev/conversations.
    2. Add temporary request-id and duration logs around both list routes.
    3. Capture whether the route is waiting on DB query, connection buffering, or serialization.

    Success criteria:

    1. Every pending browser request has a matching server log line with start and finish/error.
    2. You can point to one dominant failure mode with timestamps.

    ## 3. Backend Reliability Hardening (day 1-2)

    1. Wrap both list routes with explicit try/catch and return structured 5xx on failure.
    2. Enforce DB query timeout (maxTimeMS) and translate timeout to 503/504.
    3. Reduce payload cost for list endpoints by selecting only needed fields and last message preview only.
    4. Add updatedAt index for Conversation model if absent; verify query plans for sort+limit.
    5. Add connection-state guard: if DB disconnected/unready, fail fast with 503 instead of hanging.

    Success criteria:

    1. Backend never leaves request hanging without response.
    2. List route p95 latency stable under expected dataset size.
    3. Query timeouts produce deterministic JSON errors.

    ## 4. Frontend Data-Flow Stabilization (day 2)

    1. Centralize conversation list fetching into a shared cache/store to avoid duplicate fetchers (Sidebar + hooks).
    2. Convert polling to backpressure-safe loop (await completion before scheduling next fetch).
    3. Add stale-response suppression so old responses cannot overwrite newer state.
    4. Make poll interval adaptive (slow when idle, faster after writes).

    Success criteria:

    1. Navigating across tabs does not multiply list fetches.
    2. StrictMode double-mount in client/src/main.jsx#L10 no longer causes sustained duplicate traffic.
    3. Conversation list updates remain consistent after send/delete/rename.

    ## 5. End-to-End Pipeline Audit (day 2-3)

    1. Define and instrument lifecycle spans: ui_submit -> api_accept -> provider_start -> chunk_stream -> persist_done -> ui_done.
    2. Add correlation IDs across frontend request, server route, provider attempt, and DB writes.
    3. Emit explicit terminal events for every request path: success, timeout, fallback, abort, internal error.
    4. Validate abort semantics for SSE and CLI child cleanup.

    Success criteria:

    1. One trace can reconstruct a full prompt lifecycle without gaps.
    2. No “stuck processing” state without a corresponding server-side terminal state.

    ## 6. Resilience and Guardrails (day 3)

    1. Add circuit breaker/rate cap for conversation list endpoints under repeated failures.
    2. Add bounded retries with jitter only for safe idempotent GETs, never unbounded loops.
    3. Add server response timeout middleware for non-streaming routes.
    Success criteria:

    1. Failure causes graceful degradation, not request storms.
    2. Client remains interactive even when list endpoints are degraded.

    ## 7. Verification Plan (targeted, no broad test runs)

        2. Watch Network for 3 minutes.
        3. Confirm no pending buildup and proper terminal event.
    2. Targeted route verification:
        1. GET /api/conversations?limit=50&skip=0
        2. GET /api/dev/conversations?limit=50&skip=0
        3. DB-down simulation returns fast 503.
    3. Production-like load spot check:
        1. Simulate repeated navigation + polling.
        2. Ensure single-flight guarantees hold.

    Success criteria:

    1. Zero unbounded pending growth.
    2. No indefinite spinner without explicit error.
    3. Observable metrics show bounded concurrency.

    ## 8. Rollout and Rollback

    1. Rollout in two commits:
        1. Containment + observability.
        2. Backend/query and client architecture hardening.
    2. Keep a fast rollback path for polling/caching changes.
    3. Monitor first hour after deploy for in-flight request count and route latency spikes.
    If you want, next step I can convert this plan into an exact patch checklist by file and function (what to add/change in each block), then implement phase 1
    containment immediately.    
