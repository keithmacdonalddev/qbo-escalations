# Implementation Plan: Agent Registry Bootstrap

This plan instruments the app with a real, app-wide agent health registry at startup, replacing hardcoded status tables with live provider checks. The new bootstrap screen guarantees users see accurate agent status before entering the app, and all subsequent status indicators read from a single source of truth.

---

## 1. Problem

Today, the agent status dots on the chat page (in `client/src/components/AgentsView.jsx` at lines 1294–1298) read from a hardcoded lookup table called `AGENT_OPERATION_META` (lines 90–211), not from real provider reachability checks. A real health system exists (`client/src/hooks/useAgentHealth.js`, the `/api/agent-identities/health` endpoint, and `server/src/services/agent-health-service.js::buildAgentHealth`) but is used only in `AppHeader.jsx` for 3 agents. No app-level loading screen verifies upfront that any agent is reachable. Result: users see orange "Waiting"-like indicators that may not reflect reality, and the app can load with agents quietly broken. The user's requirement is that agent profile is the single source of truth and every status indicator must read from it.

## 2. Scope

### In scope
- New `AgentRegistry` React context mounted at the app root. Owns: list of agents from the MongoDB `AgentIdentity` collection, joined with health from `/api/agent-identities/health`, exposed via a single `useAgent(agentId)` hook. Subscribes to background poll updates.
- Boot screen overlay that runs at app startup/refresh. Lists every agent in the MongoDB `AgentIdentity` collection (auto-grows). Per-agent rows showing display name + provider + result. 8-second timeout per agent. One retry per agent on failure before declaring offline. 25-second hard ceiling, after which an "Enter Now" button appears with a banner reading "Continue loading agents in the background". Boot screen uses the terminal-style aesthetic from `prototypes/design-challenge/vercel/index.html` (`.boot-overlay`, color palette: `bl-ok` #50e3c2, `bl-info` #0070f3, `bl-warn` #f5a623, `bl-dim` #444).
- Bootstrap summary line at the end: "8/9 agents online, 1 offline" style.
- Migrate `AgentsView.jsx` dot logic from `AGENT_OPERATION_META` to `useAgent(id)`. Keep static labels/descriptions from the table; replace only the `status` field source.
- Migrate `AppHeader.jsx` to use `useAgent(id)` instead of `useAgentHealth` directly (consistency).
- Add a health dot near each agent name on each pipeline card in `client/src/components/PipelineSidebar.jsx` — independent of the stage `Waiting/Running/Done` text.
- New component `client/src/components/AgentHealthBanner.jsx`: persistent banner that appears whenever one or more agents are offline. Disappears when all agents recover. Distinct from the existing `HealthBanner.jsx` (which stays as-is).
- Reuse existing `HealthToast.jsx` to fire a one-shot toast when an agent transitions from online → offline.
- Save-time recheck: when an agent profile is edited and saved, trigger an immediate recheck of just that agent and show the result inline next to the save button. Examples: "Saved · Provider responding at 240ms" or "Saved · Provider unreachable: connection refused".
- Recovery polling: when an agent flips from online → offline, switch that single agent's poll interval to 15 seconds until it recovers, then return to the normal 60-second rhythm.
- Manual "Refresh All" button accessible from `AppHeader.jsx` — triggers a full registry refresh on demand.
- Dot hover tooltip: "Online · last checked 12s ago" / "Offline · last checked 47s ago" using `checkedAt` from the health response.
- Specific per-failure diagnostics carried through banner/toast/tooltip — e.g., "offline: connection refused at 127.0.0.1:1234", "offline: API key invalid", "offline: model not found". No vague "offline" alone.
- Edge case handling:
  - Health endpoint itself unreachable → at 25s ceiling, show "Server unreachable" with a Retry button.
  - All agents offline → boot completes normally, "Enter Now" still works, app loads with strong warning banner; user can still reach settings to fix configuration.
  - Agent added to DB after boot → registry auto-detects on next 60s poll.

### Out of scope
- Server-side rate limiting on the health endpoint.
- Replacing `HealthBanner.jsx` (existing HTTP-request-health banner stays unchanged).
- Reorganizing pipeline parallelism (the original "why agents look like they're waiting so long" question is a separate concern about pipeline gating, not health).
- Mobile-specific layout for the boot overlay.

### Deferred
None.

## 3. Acceptance criteria

1. On app startup or full refresh, the boot overlay renders before any route content is visible.
2. The boot overlay shows one row per agent record. Verified by comparing the visible row count to the number of records returned by `GET /api/agent-identities/`.
3. Each row resolves within 8 seconds, OR shows a retry attempt, OR shows an offline result with a specific diagnostic string (not generic "offline").
4. If the entire bootstrap has not settled within 25 seconds, an "Enter Now" button appears alongside a banner reading "Continue loading agents in the background".
5. Clicking "Enter Now" dismisses the overlay; background checks continue running and update dots in the now-visible app.
6. The agent dot in `AgentsView.jsx` reflects the result from `useAgent(id)`, not from `AGENT_OPERATION_META`. (Verified by changing one agent's provider to an unreachable URL, refreshing, and observing the dot turn red.)
7. The agent dot in `AppHeader.jsx` reads from `useAgent(id)`. (Verified by the same provider-mismatch test.)
8. Each pipeline card in `PipelineSidebar.jsx` shows a small health dot near the agent name, with color reflecting `useAgent(id).health.status` and independent from the stage `Waiting/Running/Done` text.
9. When any agent's health transitions from `online` to `offline`, a toast notification fires once (via existing `HealthToast`), and a persistent `AgentHealthBanner` appears at the top of the app. The banner remains visible until every agent returns to `online`.
10. The `AgentHealthBanner` carries a specific diagnostic per offline agent (e.g., "Triage Agent offline: connection refused at 127.0.0.1:1234"). No banner content reads only "offline" with no detail.
11. When a user saves a runtime-affecting agent profile edit (provider, model, fallback provider/model, mode, reasoning effort, OR the enabled flag — i.e., a save through `handleSaveRuntime` or `handleToggleAgentEnabled`), an immediate health recheck for that agent runs and the result is displayed inline next to the save button within 8 seconds. Prompt-only edits via `handleSavePrompt` do NOT trigger a recheck.
12. The offline agent's poll interval becomes 15 seconds (not 60s) until it returns to online status. (Verifiable in network panel.)
13. Hovering any agent dot shows a tooltip with the format "Online · last checked Ns ago" or "Offline · last checked Ns ago" sourced from `checkedAt`.
14. The header contains a "Refresh All" button that, when clicked, triggers a force-refresh of every agent's health. (Verifiable in network panel — a fresh call to `/api/agent-identities/health?forceRefresh=true` is observed when the button is clicked.)
15. If `GET /api/agent-identities/health` does not respond within the 25-second ceiling, the boot overlay shows "Server unreachable" with a "Retry" button.
16. When a new agent record is added to the database after boot, that agent appears in the registry on the next 60-second poll without requiring a manual refresh.
17. The existing `HealthBanner.jsx` and its HTTP-request-health behavior remain unchanged and present in `App.jsx`.

## 4. Technical approach

### Data flow

```
App mounts. AgentRegistryProvider mounts at the root.
 → Provider calls GET /api/agent-identities/ and GET /api/agent-identities/health?forceRefresh=true in parallel.
 → AgentBootOverlay subscribes to the registry; as each agent's health result arrives, it pushes a per-agent row onto the visible boot log with appropriate color (ok/warn/info).
 → Per-agent 8s timeout per check; one retry on failure before declaring offline.
 → All checks settle OR 25s ceiling hits → overlay shows summary line ("X/Y agents online") + "Enter Now" button. Background checks for any still-pending agents continue.
 → User clicks "Enter Now" → overlay dismisses; app routes load.

 useAgent(id) becomes the single read API for every consumer:
 → AgentsView dots
 → AppHeader
 → PipelineSidebar dots
 → Agent profile edit form
 → AgentHealthBanner

 Background poll runs every 60s. When an agent transitions online → offline:
 → Registry fires HealthToast (one-shot).
 → Shows AgentHealthBanner (persistent).
 → Accelerates that agent's poll interval to 15s until it returns to online.

 When a profile is edited and saved:
 → Registry triggers an immediate recheck of just that agent.
 → Surfaces the result inline at the save site.
```

### Files to create
- `client/src/contexts/AgentRegistryContext.jsx` — React context and provider managing the global list of agents, their health status, and background polling. Exposes `useAgent(agentId)` hook.
- `client/src/hooks/useAgent.js` — consumer hook to read a single agent's status, health details, and last-checked timestamp from the registry.
- `client/src/components/AgentBootOverlay.jsx` — full-screen overlay rendered on app startup, showing per-agent check rows, progress, summary line, "Enter Now" button, and "Server unreachable" error state.
- `client/src/components/AgentHealthBanner.jsx` — persistent banner that appears at the top of the app when any agent is offline. Shows the offline count, agents' names, and specific diagnostics. Disappears when all recover.
- `client/src/styles/agent-boot-overlay.css` (or co-located with component) — boot overlay styling matching the terminal-style aesthetic from the prototype: `.boot-overlay`, color palette for `bl-ok`, `bl-info`, `bl-warn`, `bl-dim`.
- `client/src/contexts/__tests__/AgentRegistryContext.test.jsx` — test suite for bootstrap lifecycle, per-agent timeout, retry behavior, recovery polling acceleration, and auto-detection of new agents.
- `server/test/agent-identities.test.js` (or matching pattern) — test suite for health endpoint returning specific diagnostics, `forceRefresh` invalidating cache, single-agent force-refresh via query param.

### Files to modify
- `client/src/App.jsx` — mount `AgentRegistryProvider` at the root ahead of all routes; mount `AgentBootOverlay` and `AgentHealthBanner` so they render before route content; ensure `HealthBanner.jsx` remains mounted.
- `client/src/components/AgentsView.jsx` — replace all reads of `AGENT_OPERATION_META[agentId].status` with `useAgent(agentId).health.status`; keep the rest of the table for static labels and descriptions.
- `client/src/components/app/AppHeader.jsx` — switch from `useAgentHealth` hook to `useAgent(id)` for consistency; add "Refresh All" button that calls registry's force-refresh method; wire it to call `/api/agent-identities/health?forceRefresh=true`.
- `client/src/components/PipelineSidebar.jsx` — for each pipeline card showing an agent, add a small health indicator dot near the agent's display name; color sourced from `useAgent(agentId).health.status`; independent from stage `Waiting/Running/Done` text.
- `client/src/hooks/useAgentHealth.js` — keep existing implementation unchanged; add a code comment noting consumers should prefer `useAgent` from the registry for new code.
- `client/src/components/AgentsView.jsx` — wire `handleSaveRuntime` (lines 551–577) and `handleToggleAgentEnabled` (lines 579–641) to trigger an immediate health recheck on save via the registry's force-refresh method. Render the inline result next to the save button inside `RuntimeSettingsPanel` (lines 2628–2827). Do NOT wire `handleSavePrompt` (lines 643–665) — prompt edits don't affect provider reachability. Do NOT wire `handleSaveProfile` (lines 529–549) unless display-name edits ever change provider routing (currently they don't).
- `client/src/api/agentIdentitiesApi.js` — if the API client doesn't already accept a callback or return a promise that lets the caller chain the recheck after `updateAgentRuntime` (line 145) or `updateAgentEnabled`, expose what's needed for the AgentsView save handlers to trigger the registry refresh after a successful save.
- `server/src/routes/agent-identities.js` — verify `forceRefresh=true` query param works for single-agent refresh; if not, add support. Verify response includes per-agent diagnostic detail.
- `server/src/services/agent-health-service.js` — ensure each agent's diagnostic message is specific, not generic. Verify `buildAgentHealth` returns per-agent `checkedAt` timestamp for tooltip rendering.

### Key decisions
- **AgentRegistry context owns the full bootstrap lifecycle and polling.** This centralizes cache invalidation, retry logic, and state subscriptions so consumers never worry about stale data or flapping toasts. Single point of truth.
- **Per-agent 8-second timeout + one retry before offline.** Balances responsiveness (25s total ceiling feels snappy) with resilience to transient network hiccups. Hard ceiling prevents user lockout.
- **15-second accelerated polling for offline agents.** Fast enough to detect recovery quickly without hammering a flaky provider; falls back to 60s once recovered. Avoids alert fatigue.
- **Specific diagnostics end-to-end.** Server emits "connection refused at 127.0.0.1:1234", client renders it unchanged in banner/toast/tooltip. No translation or generic wrapping. Directly supports user's debugging.
- **Boot overlay is distinct from route-level loading.** Routes can load in the background; overlay settles first. User never sees partial UI or half-loaded components before agents are checked.
- **Reuse existing HealthToast and HealthBanner.** Both are already in the codebase; we extend HealthToast to fire on agent transition and build AgentHealthBanner as a sibling to HealthBanner for orthogonal concerns (agents vs. HTTP).

## 5. Risks and edge cases

**Bootstrap blocking forever if health endpoint never responds.**
*What happens:* User refreshes the app. Health endpoint hangs (network partition, service down). App never shows "Enter Now". User is locked out.
*How we handle it:* Hard 25-second ceiling with deterministic settlement. After 25s, overlay shows "Server unreachable" button with a "Retry" button. Clicking "Retry" re-runs the bootstrap. User can still click "Enter Now" after ceiling to skip bootstrap entirely and use app with fallback (all agents show "unknown" until first poll returns).

**Race condition: new agents added mid-session aren't detected until next poll.**
*What happens:* User is in the app. A teammate adds a new agent to MongoDB. Consumer code calls `useAgent(newAgentId)`. Returns undefined. UI crashes or shows blank dot.
*How we handle it:* Registry's 60-second poll auto-detects new agents by comparing DB count to cached list. On detection, registry triggers a full refresh and emits a state change that forces all consumers to re-render. Within one poll cycle, the new agent appears in all consumers (AgentsView, PipelineSidebar, banner). During the window before detection, `useAgent` returns a neutral "unknown" object (not undefined) so consumers can render a "checking…" dot without crashing.

**Vague error messages hide the real problem.**
*What happens:* Agent is offline. Banner says "offline". User has no idea if it's a network problem, a configuration error, or a provider outage. Support gets "the agent is broken" tickets with no actionable info.
*How we handle it:* Every offline result from `buildAgentHealth` includes a specific diagnostic string (e.g., "connection refused at 127.0.0.1:5000", "API key 'sk-abc...' invalid", "model gpt-4 not found"). Registry carries this diagnostic unchanged through state. Banner, toast, and tooltip all render the full diagnostic. User and support have specific direction.

**Toast spam if an agent flaps online/offline rapidly.**
*What happens:* Agent becomes unreliable and bounces between online and offline every few seconds. Toast fires for every transition. User is overwhelmed by notifications.
*How we handle it:* Rely on existing `HealthToast` component's 10-second debounce per distinct message and max 3 visible toasts. Registry only fires one toast per transition (online→offline or offline→online), not per poll. Repeated same-state results do not re-fire. If rapid flapping occurs, toasts queue and surface one per 10s window.

**Stale cache vs. fresh data on profile save.**
*What happens:* User edits an agent's provider URL and saves. Registry has a 30-second cache from the last poll. The save-time recheck hits the cache instead of the new provider. User sees "saved and working" when the new provider is actually unreachable.
*How we handle it:* Save-time recheck explicitly calls the health endpoint with `forceRefresh=true` (same as bootstrap). This invalidates cache for that agent and fetches fresh data. Result is shown inline within 8 seconds.

**All agents offline at boot: should the app still load?**
*What happens:* User's environment is misconfigured. Every agent provider is unreachable at startup. Bootstrap settles with all agents offline. "Enter Now" button is shown.
*How we handle it:* Boot completes normally. "Enter Now" is always clickable, even with all agents offline. App loads with a strong AgentHealthBanner at the top showing "All agents offline: [list]". User can navigate to settings to fix configuration. This allows self-service recovery rather than locking the user out. Mirrors the "Server unreachable" path.

**FirstRender flicker: consumers briefly see undefined before first health result.**
*What happens:* App mounts. Routes render immediately. `useAgent(id)` is called. Registry hasn't finished fetching agents yet. Hook returns undefined. Consumer renders a blank dot, then it fills in. Flicker and perceived jank.
*How we handle it:* Registry exposes a `bootstrapping: true` flag during the initial fetch. AgentBootOverlay blocks route rendering until `bootstrapping` is false. Consumers can also check the flag and render a neutral "checking…" dot instead of undefined. By the time routes are visible, registry has populated initial state.

## 6. Exceeds bar

- **Specific, actionable per-failure diagnostics end-to-end.** Instead of a vague "offline" indicator, every diagnostic string (e.g., "connection refused at 127.0.0.1:5000", "API key invalid", "model not found") flows from `buildAgentHealth` through the registry to banner/toast/tooltip. Users and support can debug immediately without guessing.
- **"Last checked Ns ago" timestamp on every dot tooltip.** Builds user confidence in freshness. "Last checked 2s ago" → data is current. "Last checked 58s ago" → next poll is imminent. Supports both real-time confidence and patience.
- **One-retry-before-offline behavior in the boot.** Transient network blips don't mark an agent as permanently offline. If the first check times out and the retry succeeds, user still sees green on boot and no false warning.
- **Bootstrap summary line ("8/9 agents online, 1 offline").** Single glance tells user the aggregate health. Combined with per-agent detail in the boot log, provides both macro and micro views.
- **Manual "Refresh All" button in the header.** Gives user immediate control. No need to wait for the 60-second poll if they suspect a provider just recovered. Traces as a fresh `/api/agent-identities/health?forceRefresh=true` call in the network panel — clear and auditable.
- **Boot overlay terminal-style aesthetic matching the existing prototype.** Instead of a generic spinner or dull list, the boot screen is visually coherent with the design-challenge prototype (`bl-ok`, `bl-warn`, `bl-info`, `bl-dim` colors). Branded, professional, consistent.
- **AgentBootOverlay is a separate, dismountable component.** Not baked into App.jsx as hard-to-test logic. Can be unit-tested, visually inspected, and evolved independently.

## 7. Testing strategy

- **Server tests (high value):**
  - `/api/agent-identities/health` returns a list with one entry per agent in DB; each entry includes `agentId`, `status` (online/offline), `checkedAt` timestamp, and a specific diagnostic string.
  - When one agent provider is unreachable, the response includes that agent with `status: offline` and a diagnostic like "connection refused" or "timeout". Not a generic "offline".
  - `forceRefresh=true` query param invalidates the 30-second cache and fetches fresh data on every call.
  - Single-agent recheck via `forceRefresh=true&agentIds=abc123` (if query param is extended) or separate endpoint works and returns only that agent.
  - Verify response includes `checkedAt` timestamp (seconds since epoch or ISO string) for tooltip rendering.

- **Registry context tests (high value):**
  - Mock `/api/agent-identities/` and `/api/agent-identities/health` endpoints.
  - Verify bootstrap calls both endpoints in parallel and settles all agents within timeout.
  - Verify per-agent 8-second timeout fires and marks agent as offline if no response.
  - Verify retry logic: after first timeout, a second check is attempted before declaring offline.
  - Verify 25-second ceiling: overlay is shown after 25s with "Enter Now" button even if checks are pending.
  - Verify recovery polling: after an agent flips from online to offline, its poll interval becomes 15 seconds (not 60s) until it returns to online.
  - Verify auto-detection of new agent: after bootstrap, if a new agent is added to DB and 60s passes, registry detects it and includes it in state on next poll.
  - Verify `useAgent(id)` returns a consistent shape: `{ health: { status, diagnostic, checkedAt }, enabled, ... }`.

- **Component tests (medium value):**
  - `AgentBootOverlay` renders per-agent rows. Verify row count matches agent list length.
  - Verify "Enter Now" button appears after 25s even if checks are pending.
  - Verify "Server unreachable" message and "Retry" button appear if health endpoint hangs beyond 25s.
  - `AgentHealthBanner` does not render if all agents are online. Renders if any are offline. Shows offline agent count and names. Disappears when all return to online.
  - `AgentHealthBanner` includes specific diagnostic per offline agent (not generic "offline").
  - Verify tooltip on agent dot includes "Online · last checked Ns ago" or "Offline · last checked Ns ago".
  - Verify "Refresh All" button in AppHeader is clickable and triggers `/api/agent-identities/health?forceRefresh=true` (visible in network panel).

- **Visual verification with agent-browser (high value for UX-heavy feature):**
  - Screenshot the boot overlay on app startup with a mix of online and offline agents.
  - Screenshot the boot overlay at the 25-second ceiling with "Enter Now" button and "Continue loading in background" banner.
  - Screenshot the "Server unreachable" state if health endpoint is mocked to hang.
  - Screenshot the AgentHealthBanner when an agent is offline, showing the offline agent's name and specific diagnostic.
  - Screenshot a toast notification firing when an agent transitions from online to offline.
  - Screenshot the AppHeader "Refresh All" button and verify it resets the last-checked timestamp on all agents.
  - Screenshot PipelineSidebar showing a green health dot next to an online agent and a red dot next to an offline agent, independent of the stage `Waiting/Running/Done` text.
  - Screenshot a tooltip on an agent dot showing "Online · last checked 5s ago".
  - Save screenshots to `review-screenshots/` per repo convention.

- **Manual scenarios before merge:**
  - Refresh the app. Verify boot overlay appears before any route content loads.
  - Wait for boot to complete. Verify all agents settle (online/offline) and summary line shows "X/Y agents online".
  - Click "Enter Now" during boot. Verify overlay dismisses and routes load. Verify background checks continue and update dots as results arrive.
  - Change an agent's provider to an unreachable URL via the agent profile form. Save. Verify inline recheck result appears next to save button within 8 seconds showing the new provider is unreachable.
  - Wait for an offline agent to be fixed externally (restore the real provider). Verify the agent dot turns green within 15 seconds (accelerated poll). Verify AgentHealthBanner disappears.
  - Click "Refresh All" in the header. Verify network panel shows a fresh `/api/agent-identities/health?forceRefresh=true` call and all dots update within a few seconds.
  - Add a new agent record to MongoDB mid-session. Wait 60+ seconds. Verify the new agent appears in the registry and shows up in AgentsView, PipelineSidebar, and the boot overlay on next refresh.

- **Skip:**
  - Trivial wrapper components or pass-through hooks.
  - CSS-only changes to colors or spacing.
  - Unchanged behavior in HealthBanner.jsx or HealthToast.jsx.

## 8. Migration

None. This feature does not change schema, data structure, or configuration. The existing `useAgentHealth` hook and `/api/agent-identities/health` endpoint remain unchanged; AgentRegistry wraps them. Rollback is simple: remove AgentRegistryProvider and AgentBootOverlay from App.jsx, revert migrated components to read from `AGENT_OPERATION_META` (revert changes in AgentsView.jsx, AppHeader.jsx, PipelineSidebar.jsx). No data cleanup required.

## 9. Dependencies

None required before this ships. The health endpoint (`GET /api/agent-identities/health`) and the hook (`useAgentHealth`) already exist and work. This feature depends only on their continued availability. No upstream services need to ship first.

## 10. Rollout

Ship this as a staged migration. Each step is independently verifiable; do not begin the next step until the previous one is observably correct in the running app. This protects against any single step destabilizing the rest of the app mid-migration.

1. **Server hardening first.** Verify `GET /api/agent-identities/health` returns per-agent specific diagnostic strings (not generic "offline"). If diagnostics are vague, sharpen `buildAgentHealth` in `server/src/services/agent-health-service.js`. Confirm `forceRefresh=true` query param invalidates the cache. Confirm per-agent `checkedAt` timestamp is in the response shape. Add or update server tests.
2. **Registry foundation (no consumers yet).** Create `AgentRegistryContext`, `useAgent`, and mount `AgentRegistryProvider` in `App.jsx`. At this step the registry is wired into the tree but no UI reads from it. The app behaves exactly as before.
3. **Migrate AppHeader.** Switch `AppHeader.jsx` from `useAgentHealth` directly to `useAgent(id)`. Visual parity check: header dots look and behave the same as before.
4. **Migrate AgentsView dots.** Replace all reads of `AGENT_OPERATION_META[agentId].status` with `useAgent(agentId).health.status`. Keep the table for labels/descriptions. Visual and functional check: dots now reflect real provider reachability.
5. **PipelineSidebar dots.** Add the new health dot near each agent name on every pipeline card. Visual check.
6. **Save-time recheck.** Wire `handleSaveRuntime` and `handleToggleAgentEnabled` in `AgentsView.jsx` to trigger an immediate recheck and render the inline result next to the save button in `RuntimeSettingsPanel`. Functional check: change a provider to an unreachable URL, save, observe inline failure result.
7. **Boot overlay.** Build `AgentBootOverlay`, mount in `App.jsx` so it gates route rendering until `bootstrapping` resolves. Add 8s per-agent timeout, one retry, 25s ceiling, "Enter Now" button, summary line, "Server unreachable" recovery path.
8. **AgentHealthBanner + recovery polling.** Build `AgentHealthBanner`, mount in `App.jsx` as a sibling to the existing `HealthBanner`. Wire registry to fire `HealthToast` on online→offline transitions and switch that agent's poll interval to 15s until recovery.
9. **"Refresh All" button.** Add to `AppHeader.jsx`.
10. **Cleanup.** Confirm `AGENT_OPERATION_META.status` field is no longer read anywhere. Remove the dead `status` field from the lookup table while keeping the rest of the table intact.

No feature flag is required because each step is small enough to verify and revert independently if needed. The bootstrap ceiling provides additional protection in step 7 onward.
