# CTO Review: Agent Registry Bootstrap — 2026-05-22 1936

## 1. Summary

| Field           | Value                                                |
| --------------- | ---------------------------------------------------- |
| **Gate Decision** | **FAIL (BLOCKER)**                                 |
| Score           | **6/10**                                             |
| Critical        | 0                                                    |
| High            | 2                                                    |
| Medium          | 4                                                    |
| Low             | 2                                                    |
| Intent Gate     | CAPPED AT 7 (exceeds-intent #5 = no — see Step 7)    |
| Next step       | Address the High findings in section 10, re-run gate |

The implementation lands the core architecture cleanly — a single React context that joins agent profiles with health, a terminal-styled boot overlay that gates routes, a persistent offline banner, accelerated 15s recovery polling, sharpened server-side diagnostics, and a "Refresh All" header button. Plan fidelity is high. However, the save-time recheck has a closure-staleness bug that breaks AC#11 (the inline pill shows pre-save health, not the actual recheck result), and an edge case with custom agents added mid-session can render dots with no CSS class. Both are reachable in 60 seconds by a QA engineer.

---

## 2. Scope

### Files reviewed (related to this feature)

**New files (committed via `?? `):**

- `client/src/context/AgentRegistryContext.jsx` (353 lines)
- `client/src/hooks/useAgent.js` (61 lines)
- `client/src/lib/agentStatus.js` (64 lines)
- `client/src/components/AgentBootOverlay.jsx` (636 lines)
- `client/src/components/AgentBootOverlay.css` (238 lines)
- `client/src/components/AgentHealthBanner.jsx` (171 lines)
- `client/src/components/AgentHealthBanner.css` (105 lines)
- `server/test/agent-identities-health.test.js` (252 lines)

**Modified files (related to this feature):**

- `client/src/App.jsx` (+9 lines) — provider mount + overlay wrapper
- `client/src/components/AgentsView.jsx` (+287/-41) — registry wiring, save-time recheck
- `client/src/components/HealthToast.jsx` (+45) — programmatic `showHealthToast` API
- `client/src/components/app/AppHeader.jsx` (+98/-7) — `useAgent` migration, Refresh All button
- `client/src/components/chat-v5/PipelineSidebar.jsx` (+45/-1) — per-stage health dot
- `client/src/hooks/useAgentHealth.js` (+4) — doc comment marking it internal
- `server/src/services/agent-health-service.js` (+148/-22) — diagnostic sharpener, forced refresh fix

Modified files NOT in this feature's scope (pre-existing dirty WIP, ignored):
`client/src/App.css`, `client/src/components/AgentsView.jsx` (image-parser captures), `client/src/components/ImageParserPanel.jsx`, `client/src/components/Tooltip.css`, `client/src/components/chat-room/ChatRoomComposer.jsx`, `client/src/components/chat-v5/ChatV5Container.jsx`, `client/src/components/chat-v5/StageEventLogPanel*`, `client/src/components/chat-v5/useStageOrchestrator.js`, `client/src/components/chat/ImageParserPopup.jsx`, `client/src/hooks/useImageParser.js`, `client/src/hooks/useRequestWaterfall.js`, `client/src/hooks/useToast.jsx`, `client/src/lib/imageParserStageToasts.js`, server image-parser/provider-call-package/remote-api-providers files, the prompts and provider-harness-research changes.

The scope script was unable to compute a diff against `master` because all changes are uncommitted; I treated the plan's "Files to create" and "Files to modify" lists as the scope target and read each one directly.

### Unplanned files

None substantive. Two minor unplanned items:

- `client/src/lib/agentStatus.js` — not in the plan's "Files to create" list, but justified: it's a small shared helper consumed by AgentsView, PipelineSidebar, AgentBootOverlay, and the inline recheck pill. Centralizes the health → operational-token mapping. Net positive.
- The AgentRegistryContext was specified under `client/src/contexts/` but landed at `client/src/context/`. The existing `WorkspaceMonitorContext.jsx` already lives at `client/src/context/`, so this matches local convention. Not a deviation worth flagging.

---

## 3. Plan Fidelity

| Plan item | Status | Evidence (file:line) | Notes |
| --------- | ------ | -------------------- | ----- |
| AgentRegistry context with `useAgent(id)` hook | Implemented | `client/src/context/AgentRegistryContext.jsx:97` ; `client/src/hooks/useAgent.js:36` | |
| Boot overlay rendered at startup, one row per agent | Implemented | `client/src/components/AgentBootOverlay.jsx:160`, `:507` | |
| 8s per-agent timeout + one retry before offline | Implemented | `AgentBootOverlay.jsx:48`, `:296-318` | |
| 25s ceiling with "Enter Now" + background-load banner | Implemented | `AgentBootOverlay.jsx:464`, `:613-630` | |
| Bootstrap summary line "X/Y agents online" | Implemented | `AgentBootOverlay.jsx:528-543`, `:605-611` | |
| Terminal-style aesthetic (`bl-ok` #50e3c2, etc.) | Implemented | `AgentBootOverlay.css` palette comment at top, color classes match prototype | |
| `AgentsView` dot reads from `useAgent` (not `AGENT_OPERATION_META.status`) | Implemented | `AgentsView.jsx:487-497`, `:3536-3548` | All `meta.status` reads removed |
| `AppHeader` switches from `useAgentHealth` to `useAgent` | Implemented | `AppHeader.jsx:521-558` | Legacy shape reconstructed to keep `getAgentState` untouched |
| PipelineSidebar per-stage health dot | Implemented | `PipelineSidebar.jsx:5-11`, `:124-134`, `:33-43` | Reuses `PIPELINE_RUNTIME_IDS` mapping |
| `AgentHealthBanner` persistent + diagnostic-bearing | Implemented | `AgentHealthBanner.jsx:67-83`, `:143-167` | |
| HealthToast fires on online→offline + offline→online edges | Implemented | `AgentHealthBanner.jsx:95-134`; `HealthToast.jsx:42-72` | Recovery toast is a deliberate exceeds-bar extra |
| Save-time recheck on `handleSaveRuntime` and `handleToggleAgentEnabled` | **Partial** (broken) | `AgentsView.jsx:611-687`, `:705-727`, `:800-805` | Logic is wired but reads stale `agentRegistry` after `await refreshOne` — see Finding H1 |
| Save-time recheck does NOT fire on `handleSavePrompt` | Implemented | `AgentsView.jsx:730` onwards — only `handleSaveRuntime` and `handleToggleAgentEnabled` call `runSaveTimeRecheck` | |
| 15s recovery polling for offline agents | Implemented | `AgentRegistryContext.jsx:264-307` | Adds a ticker per offline agentId, additive to the 60s base poll |
| Manual "Refresh All" button in header | Implemented | `AppHeader.jsx:613-630`, `:913-947` | Forced refresh via `refreshAll` (`agent-health-refresh` event + `forceRefresh:true`) |
| Per-failure diagnostic carried end-to-end | Implemented | server: `agent-health-service.js:187-260` ; client: `AgentRegistryContext.jsx:168-171`, `AgentHealthBanner.jsx:75-78` | |
| Health endpoint unreachable → "Server unreachable" + Retry | **Partial** | `AgentBootOverlay.jsx:373-377` | Only triggers when `agentIds.length === 0`. If profiles loaded but `/health` hangs, the overlay shows "Enter Now" instead of "Server unreachable" — see Finding M1 |
| Auto-detection of new agents on 60s poll | Implemented (relies on `useAgentHealth` poll) | `useAgentHealth.js:71`, the registry's `agentIds` is recomputed from `profilesById` each render | Note: a newly-added DB agent only appears AFTER `listAgentIdentities` refetches, but the registry doesn't refetch `profilesById` on its own — see Finding M2 |
| Existing `HealthBanner.jsx` remains in `App.jsx` | Implemented | `App.jsx:335` | |
| Hover tooltip "Online · last checked Ns ago" | **Partial** | `PipelineSidebar.jsx:62-67`; `AgentsView` uses CSS-class `title` from existing code | The new dots have `title={healthStatusLabel(...)}` which renders "Online" but NOT the "last checked Ns ago" — see Finding M3 |
| Server `forceRefresh=true` invalidates cache | Implemented | `agent-health-service.js:932-940`, `:943` | Force-refresh path no longer reuses a non-forced in-flight refresh |
| Per-agent `checkedAt` ISO timestamp | Implemented | `agent-health-service.js:818`, `:858`, `:884`, `:920` | Tested in `agent-identities-health.test.js:101-139` |
| Server tests for health endpoint | Implemented | `server/test/agent-identities-health.test.js` | Four tests pass (checkedAt, sharpened diagnostic, forceRefresh invalidates cache, non-force reuses cache) |
| Client tests for context + boot overlay | **Skipped (policy-permitted)** | n/a | `.claude/rules/client.md` says no client test framework is installed yet — coordinate before adding one. Plan called for these but the policy permits skipping. |

---

## 4. Cross-Boundary Data Flow Trace

I traced the **save-time recheck path** end-to-end, because it crosses three layers and exposes the most consequential bug.

**Step 1 — User edits provider, clicks Save**
`AgentsView.jsx:706` → `handleSaveRuntime(nextRuntime)`

**Step 2 — Server save**
`updateAgentRuntime(agentId, localRuntime, summary)` → PATCH `/api/agent-identities/:id/runtime` → returns updated agent. Reducer state set, runtimeSaveStatus = "Runtime defaults saved to server."

**Step 3 — Trigger recheck (unawaited)**
`AgentsView.jsx:725` → `runSaveTimeRecheck(agentId)` (fire-and-forget)

**Step 4 — Recheck function**
`AgentsView.jsx:620-688`:
- Sets `runtimeRecheckResult = { status: 'checking' }` immediately.
- `await agentRegistry.refreshOne(agentId)` — this is the closure-captured `agentRegistry` from the LAST render of `AgentsView`.

**Step 5 — refreshOne in context**
`AgentRegistryContext.jsx:211-236`:
- Calls `getAgentHealth([agentId], { forceRefresh: true })` → hits `/api/agent-identities/health?ids=X&refresh=1`.
- Receives `data.agents[agentId] = single`.
- Calls `setLocalHealth(prev => ({ ...prev, [agentId]: single }))`.
- This schedules a React re-render of `AgentRegistryProvider`.
- Returns to caller. The promise resolves.

**Step 6 — BACK in `runSaveTimeRecheck`**
`AgentsView.jsx:673` — `const updatedHealth = agentRegistry?.agents?.[agentId]?.health || null;`

**This is the contract mismatch.** The provider's state has updated, but the consumer's captured `agentRegistry` value is still the **previous render's snapshot**. React batches re-renders; by the time the consumer re-renders, this function has already finished executing line 673 and committed `setRuntimeRecheckResult` with the *previous* health snapshot's status.

If the previous status was `online` and the fresh recheck reveals the provider is now `offline`, the inline pill will read **"Saved · Provider responding at NNNms"** — confidently displaying SUCCESS for a recheck that actually FAILED. AC#11 says the result is displayed inline within 8 seconds. The result that is displayed is wrong.

**Step 7 — Visible UI**
`RuntimeSettingsPanel` renders the pill from `recheckResult.message`. User sees a stale-but-confident result. The registry's *true* fresh state is read on the NEXT save (where it will reflect what THIS save should have shown).

I verified the bug shape by:

- Reading `refreshOne` (`AgentRegistryContext.jsx:211-236`) — confirmed it only calls `setLocalHealth`, no synchronous return of the fresh data.
- Reading the `agents` memo (`AgentRegistryContext.jsx:149-192`) — confirmed it depends on `localHealth`; memo only recomputes after the next render.
- Reading the call chain in AgentsView — confirmed `runSaveTimeRecheck` is not re-invoked after a re-render; the closure runs once, with the captured registry value.

The fix is straightforward: have `refreshOne` return the fresh entry (or pass it via the result of the awaited call). See Finding H1 below.

---

## 5. Findings by framework section

### State consistency and data flow correctness

#### Finding H1 — Save-time recheck reads stale registry state after `await refreshOne` (HIGH)

**Section:** State consistency and data flow correctness
**Severity:** High
**File:** `client/src/components/AgentsView.jsx:673`
**Issue:** `runSaveTimeRecheck` awaits `agentRegistry.refreshOne(agentId)`, which updates the registry's `localHealth` via `setLocalHealth`. State updates schedule a re-render but do NOT mutate the closure-captured `agentRegistry` value. The line `const updatedHealth = agentRegistry?.agents?.[agentId]?.health || null;` reads the PRE-recheck snapshot, so the inline "Saved · Provider responding at NNNms" / "Saved · Provider unreachable: ..." pill is keyed to the prior poll's status, not the just-completed forced refresh.
**Reproduction:**
1. Configure an agent with a working provider; let it settle to `online` via the boot poll.
2. Edit the provider URL to an unreachable host. Save.
3. Inline pill reads "Saved · Provider responding at NNNms" — falsely positive. The agent's REAL fresh health (offline) is what the registry's polled state will reflect on the next 60s cycle.
4. Opposite case: an agent that was `offline` and got fixed. After save, the pill still reads "Saved · Provider unreachable: <old diagnostic>" even though the recheck succeeded.
**Fix:** Change `refreshOne` to return the fresh single-agent payload, and use it in the caller. Concretely:

In `client/src/context/AgentRegistryContext.jsx:211`:
```js
const refreshOne = useCallback(async (agentId) => {
  if (!agentId) return null;
  try {
    const data = await getAgentHealth([agentId], { forceRefresh: true });
    const single = data?.agents?.[agentId] || null;
    if (single) {
      setLocalHealth((prev) => ({ ...prev, [agentId]: single }));
    }
    if (data?.checkedAt) setLocalCheckedAt(data.checkedAt);
    return single; // <-- new
  } catch (err) {
    const offlineSnapshot = {
      status: 'offline',
      diagnostic: err?.message || 'Health check failed.',
      message: err?.message || 'Health check failed.',
      checkedAt: new Date().toISOString(),
    };
    setLocalHealth((prev) => ({ ...prev, [agentId]: offlineSnapshot }));
    return offlineSnapshot; // <-- new
  }
}, []);
```

Then in `client/src/components/AgentsView.jsx:645`:
```js
const updatedHealth = await agentRegistry.refreshOne(agentId);
// ... and replace the read at line 673 with `updatedHealth`.
```

This makes the recheck observe the just-fetched data directly, independent of React's render scheduling. This pattern is the conventional fix for "I just called a setter, why doesn't the next line see the new state."

**Verification standard:** Reproduced in trace, not in runtime. The trace is mechanical (closure capture + React batching). Confidence is high.

---

#### Finding H2 — `resolveOperationalStatus` returns `undefined` for agents not in the registry (HIGH)

**Section:** State consistency and data flow correctness
**Severity:** High
**File:** `client/src/components/AgentsView.jsx:3548`, with reach through `:498-505`
**Issue:** `liveStatusByAgentId` is built by iterating `Object.keys(registryAgents)`. If `agents` (the AgentsView state from `listAgentIdentities`) contains an agentId that the registry hasn't yet observed (e.g., a custom agent added mid-session, or any agent before the registry's first poll completes), `liveStatusByAgentId[agentId]` is `undefined`. That undefined flows into `buildOperationalProfile` → `resolveOperationalStatus(meta, agent, undefined)`, which returns `undefined` (it falls through to `return liveStatus;`).

Downstream, `operationalStatus` becomes part of the operational profile and feeds the `status-dot-${status}` CSS class on the agent row. With `undefined`, you get `status-dot-undefined`, which has no CSS rule — the dot renders as an unstyled empty span.

This is reachable today: open the AgentsView page in the brief window after the boot overlay dismisses but before the recovery poll has finished pulling fresh data for a custom agent. AC#16 is the relevant criterion ("auto-detect on next 60s poll"); the safety net for that ("return a neutral 'unknown' object not undefined") only protects consumers of `useAgent`, not consumers of the `liveStatusByAgentId` map.
**Reproduction:**
1. Add a new agent to MongoDB through any means (it doesn't matter which — the bug is reproducible whenever `agents` is a superset of `registryAgents`).
2. Without refreshing, navigate to AgentsView.
3. The new agent's row renders with an unstyled dot (no color). Hovering may also show a missing tooltip if CSS sets a fallback color globally.
**Fix:** In `client/src/components/AgentsView.jsx`, default the lookup to `'idle'` for unknown agents:

```js
const liveStatusByAgentId = useMemo(() => {
  const map = {};
  const registryAgents = agentRegistry?.agents || {};
  for (const agent of agents) {
    const id = agent.agentId;
    const entry = registryAgents[id];
    map[id] = healthStatusToOperationalToken(entry?.health?.status); // returns 'idle' when undefined
  }
  return map;
}, [agentRegistry, agents]);
```

Iterating over `agents` (the page's own list) instead of `Object.keys(registryAgents)` guarantees every rendered row has a mapped operational token, and `healthStatusToOperationalToken` already falls back to `'idle'` for null/undefined input. Add `agents` to the dependency array so the memo refreshes when the page reloads agents.

Alternative: tighten `resolveOperationalStatus` to default `liveStatus || 'idle'`. Either works; pick one.

**Verification standard:** Traced through the code paths. Reproducible in 60s by manually inserting an `AgentIdentity` document.

---

### Intent fidelity

#### Finding M1 — "Server unreachable" only triggers when zero agents loaded (MEDIUM)

**Section:** Intent fidelity
**Severity:** Medium
**File:** `client/src/components/AgentBootOverlay.jsx:373-377`
**Issue:** AC#15 says "If `GET /api/agent-identities/health` does not respond within the 25-second ceiling, the boot overlay shows 'Server unreachable' with a 'Retry' button." The implementation guards on `agentIds.length === 0`:

```js
if (bootstrapping && agentIds.length === 0 && elapsedMs >= SERVER_UNREACHABLE_MS) return true;
```

So if `/api/agent-identities/` (the *profile* list) returned successfully, populating `agentIds`, but `/api/agent-identities/health` (the *health* probe) hangs indefinitely, the user does NOT see "Server unreachable" + "Retry". They see "Enter Now" instead, which is the slow-checks path.

In practice this is mostly benign — "Enter Now" still lets the user into the app, and the registry will keep polling — but the user is left without the explicit diagnostic that the *health* endpoint is the failing one.
**Reproduction:**
1. Block only the `/api/agent-identities/health` endpoint at the proxy (e.g., 30s sleep). Leave `/api/agent-identities/` responsive.
2. Refresh the app.
3. At 25s, the overlay shows "Enter Now" and "Continue loading agents in the background" instead of "Server unreachable / Retry."
**Fix:** Expand the unreachable detection to include "agents listed but no `checkedAt` after 25s":

```js
const serverUnreachable = useMemo(() => {
  if (profilesError && profilesError.length > 0) return true;
  if (bootstrapping && elapsedMs >= SERVER_UNREACHABLE_MS) {
    // Server unreachable if either profiles didn't load OR no health snapshot arrived.
    return true;
  }
  return false;
}, [profilesError, bootstrapping, elapsedMs]);
```

`bootstrapping` is already `profilesLoading || (agentIds.length > 0 && !polledCheckedAt)`, so this branch catches both scenarios.

---

#### Finding M2 — Registry never re-fetches the profile list, so AC#16 (auto-detect new agents) depends entirely on the polled health side-effect (MEDIUM)

**Section:** Intent fidelity / state consistency
**Severity:** Medium
**File:** `client/src/context/AgentRegistryContext.jsx:119-145`
**Issue:** The `listAgentIdentities()` call runs ONCE on mount. `profilesById` is then frozen for the life of the provider. Any agent added to MongoDB later will not appear in `agentIds` and therefore will not be polled or surfaced by `useAgent`. The plan's AC#16 says "When a new agent record is added to the database after boot, that agent appears in the registry on the next 60-second poll."

The 60s poll inside `useAgentHealth` only re-runs the **health** probe — it does not re-fetch the **profile list**. So a newly-added DB agent is invisible to the registry unless something else triggers a profile re-fetch (currently, nothing does).

Note: when `useAgentHealth` polls with empty `ids`, the server defaults to ALL `DEFAULT_PROFILES` ids. So newly-added DEFAULT agents would surface in the polled health, but the registry's `agents` map only iterates over `Object.keys(profilesById)` — so the extra entries are dropped. New custom DB agents are doubly invisible: not in the polled list and not in profilesById.
**Reproduction:**
1. Boot the app.
2. Manually insert a new `AgentIdentity` document via `mongo`.
3. Wait 90 seconds (more than one poll cycle).
4. `useAgent('new-agent-id')` returns `UNKNOWN_HEALTH` indefinitely. The agent never shows up in PipelineSidebar dots, AgentHealthBanner, or AgentsView.
**Fix:** Add a periodic profile re-fetch alongside the health poll. The simplest version is to call `listAgentIdentities()` from a `setInterval` parallel to the health poll, with an event-based force-refresh:

In `client/src/context/AgentRegistryContext.jsx`, after the initial profile load effect:

```js
// AC#16: re-fetch the profile list periodically so newly-added DB agents
// appear in the registry without requiring a full page refresh.
useEffect(() => {
  const REFETCH_MS = 60_000;
  const id = window.setInterval(async () => {
    try {
      const list = await listAgentIdentities();
      const byId = {};
      for (const agent of Array.isArray(list) ? list : []) {
        if (agent?.agentId) byId[agent.agentId] = agent;
      }
      setProfilesById((prev) => {
        // Only update if something changed (id set or top-level fields).
        const prevKeys = Object.keys(prev).sort().join(',');
        const nextKeys = Object.keys(byId).sort().join(',');
        if (prevKeys !== nextKeys) return byId;
        return prev;
      });
    } catch {
      // Stay with the last good list.
    }
  }, REFETCH_MS);
  return () => window.clearInterval(id);
}, []);
```

This honors AC#16 verbatim.

---

#### Finding M3 — Dot tooltips do not include "last checked Ns ago" (MEDIUM)

**Section:** Intent fidelity
**Severity:** Medium
**Files:** `client/src/components/chat-v5/PipelineSidebar.jsx:62-67` ; `client/src/components/AgentsView.jsx` (relies on existing AgentsView title attrs); `client/src/components/AgentBootOverlay.jsx` (no per-dot tooltip)
**Issue:** AC#13 says: "Hovering any agent dot shows a tooltip with the format 'Online · last checked Ns ago' or 'Offline · last checked Ns ago' sourced from `checkedAt`." The plan also lists this as an "exceeds bar" item: "Last checked Ns ago timestamp on every dot tooltip."

The implementation provides only `healthStatusLabel(status)` (e.g., "Online", "Offline") in PipelineSidebar's title attribute. The "last checked Ns ago" piece — which requires reading `health.checkedAt` and computing the diff to `Date.now()` — is missing across PipelineSidebar, AgentHealthBanner dot, AppHeader dots, and the AgentsView dots.

The `checkedAt` data IS present in the registry. The wiring is what's missing.
**Reproduction:** Hover any agent dot anywhere in the app. The tooltip shows "Online" or "Offline", but never "Online · last checked Ns ago."
**Fix:** Add a small helper to `client/src/lib/agentStatus.js` that formats a checkedAt timestamp into a relative-time string, and use it in tooltips:

```js
export function formatLastChecked(checkedAt) {
  if (!checkedAt) return null;
  const ms = Date.now() - new Date(checkedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function buildDotTooltip(healthStatus, checkedAt) {
  const label = healthStatusLabel(healthStatus);
  const ts = formatLastChecked(checkedAt);
  return ts ? `${label} · last checked ${ts}` : label;
}
```

Then in `PipelineSidebar.jsx`:
```js
const healthTitle = buildDotTooltip(agentHealth?.status, agentHealth?.checkedAt);
```

And similarly for any AgentsView dot, AgentHealthBanner dot, and AppHeader dot rendering. Note that the title will not update live (browsers don't re-render `title` until next mouseover), which is acceptable — the freshness is checked on hover.

---

### Code quality and defensive programming

#### Finding M4 — Registry's polling-engine `useAgentHealth` is invoked with an array of agent IDs whose identity changes on every profile refetch; the underlying memo key is the `.join('|')` string, but the upstream effect's `ids` dependency may trigger spurious refresh requests (MEDIUM)

**Section:** Code quality and defensive programming
**Severity:** Medium
**File:** `client/src/context/AgentRegistryContext.jsx:108-117` ; `client/src/hooks/useAgentHealth.js:30-90`
**Issue:** On the registry's first render, `profilesById = {}` → `agentIds = []` → `useAgentHealth([])` triggers an initial `loadHealth` call with no IDs. The server expands this to ALL default agent IDs. Then `listAgentIdentities()` resolves, `profilesById` populates, `agentIds` becomes the populated list — the array identity changes, so `useAgentHealth`'s internal effect re-runs and fires a second `loadHealth` call.

Net: two health probes on mount instead of one. Not catastrophic, but it doubles the load on the server during the bootstrap window where you most want responsiveness.
**Reproduction:** Open the network panel, refresh. Observe two requests to `/api/agent-identities/health` close together during the boot window.
**Fix:** Defer the health probe until profiles have loaded. In `AgentRegistryContext.jsx`, gate the hook call (or pass an empty `agentIds` AND set an `enabled` flag that `useAgentHealth` honors). Simplest: don't even pass `agentIds` until profiles arrive, but `useAgentHealth` doesn't currently support an "enabled" toggle. Two-line patch in `useAgentHealth.js`:

```js
export default function useAgentHealth(agentIds = [], options = {}) {
  // ...
  useEffect(() => {
    if (ids.length === 0 && options.skipEmpty === true) return undefined; // <-- new guard
    let cancelled = false;
    // ... existing body
  }, [ids, options.forceRefresh, options.pollMs, options.skipEmpty, refresh]);
}
```

Then call from the registry: `useAgentHealth(agentIds, { skipEmpty: true })`. The first render skips the empty probe; the second render (after profiles load) fires the only health request.

---

### Performance and responsiveness

#### Finding L1 — Recovery ticker is additive to the 60s poll, not a replacement (LOW)

**Section:** Performance and responsiveness
**Severity:** Low
**File:** `client/src/context/AgentRegistryContext.jsx:267-307`
**Issue:** The plan reads: "switch that single agent's poll interval to 15 seconds until it returns to the normal 60-second rhythm." The current implementation keeps the 60s base poll running and adds a 15s ticker on top. So an offline agent gets pinged roughly every 12s effective (the 15s tick will sometimes land between the 60s polls, sometimes coincide with them).

Functionally equivalent to the requirement, but the server logs will show extra refreshOne calls hitting `?refresh=1`. Not a correctness issue.
**Reproduction:** With one agent offline, watch the network panel. See requests to `/api/agent-identities/health?ids=X&refresh=1` every 15s plus the broader `/api/agent-identities/health` poll every 60s.
**Fix (optional):** Either accept the current behavior (it's actually more responsive to recovery, which is the user's goal), or modify the registry to suppress the base-poll inclusion of offline agents while a recovery ticker is active. The first option is simpler and probably preferred. Document the deviation in `RECOVERY_POLL_INTERVAL_MS`'s comment so a future reader doesn't think it's a bug.

---

### Observability and debugging

#### Finding L2 — Recovery toast can fire for an agent that was offline at boot, contradicting the comment "first-load offline does NOT fire a toast" (LOW)

**Section:** Observability and debugging
**Severity:** Low
**File:** `client/src/components/AgentHealthBanner.jsx:95-134`
**Issue:** The transition-detection effect intentionally skips agents whose `prevStatus === undefined` (first observation). But on the *second* registry update, when polled health arrives, an agent that was `offline` on first observation now has `prevStatus = 'offline'`. If between then and the third update the agent recovers, the recovery branch fires: "Agent recovered: X". The operator sees a "recovered" toast for an agent they never knew was down (because the boot overlay covered the offline message). Mildly confusing, not harmful.
**Reproduction:** Run a session where one agent is offline at boot. The boot overlay shows it as offline (correct). User clicks Enter Now. A few minutes later the agent recovers. A green "Agent recovered" toast fires — for an agent the user knows was already flagged in the AgentHealthBanner, so the toast is informational but slightly redundant.
**Fix (optional):** None strictly required. If you want to suppress the boot-offline recovery toast, gate the recovery branch by `prev[agentId] === 'online'` only (already the case) AND track a separate `seenOnlineRef` so the first offline→online transition only fires if you've previously seen the agent online. This is a polish detail.

---

### Failure modes

No additional findings beyond H1 and M1.

### Security and privacy

No findings.

### Accessibility and responsive design

No findings clearly broken.

The boot overlay has `role="dialog"`, `aria-label`, and `aria-busy` (`AgentBootOverlay.jsx:551-553`). The banner has `role="status" aria-live="polite"`. The "Refresh All" button has `aria-busy` toggling correctly while in flight. The summary line uses `aria-live="polite"`.

---

## 6. Exceeds expectations assessment

I went through the five questions honestly.

1. **Would a senior engineer be impressed by this code?**
   Mostly yes. The single-source-of-truth design is sound. The diagnostic sharpener on the server is thoughtful (preserves specific upstream messages, only rewrites vague ones). The HealthToast event-bus extension is the right pattern. The retry-once-then-fail logic in the boot overlay reads carefully. The migration from `AGENT_OPERATION_META.status` is complete. The comments are exceptional — most files explain the *why*, the AC mapping, and the cleanup contract.

   What a senior engineer would push back on: H1 (the closure-staleness bug); M2 (the missing periodic profile refetch that AC#16 requires); M3 (the missing "last checked Ns ago" tooltip that the plan explicitly called out as "exceeds bar"). These are all reachable in 60 seconds with the running app.

2. **Are error messages actionable?**
   Yes for the server-side path. The `sharpenProviderDiagnostic` function transforms vague "connection failed" into "Anthropic unreachable at api.anthropic.com" or "Anthropic API key rejected". The banner and toast carry these through unchanged. This is one of the strongest parts of the implementation.

   The two save-time recheck error cases (`runSaveTimeRecheck` catch branch and the disabled-agent case) produce useful inline messages. The "Server unreachable" path in the boot overlay shows the underlying error.

3. **Is defensive programming comprehensive?**
   Mostly yes — UNKNOWN_HEALTH fallbacks, frozen default context, recovery-ticker per-agent isolation, cleanup contracts for recovery tickers documented. The two gaps (H1, H2) are not defensive-programming gaps — they are design gaps in how registry state is read.

4. **Does the architecture make future changes easier?**
   Yes. `useAgent(id)` is now the single read API. Adding a new status indicator anywhere in the app costs one hook call. The `agentStatus.js` mapping helper is the single place to extend the dot color taxonomy. The boot overlay is dismountable and testable independently. Future per-failure UI (e.g., a "Diagnose" link in the banner) can be added without touching the registry.

5. **If you showed this to the user right now, would they say "this exceeds what I asked for"?**

   **No.** The reason is H1: the save-time recheck displays the wrong result. The user's most prominent memory rule is "reachability must be checked at every layer — save-time, per-request pre-flight, AND background monitor." Save-time is one of three pillars. Currently it is broken: the pill shows pre-save data dressed up as post-save data. The user will edit a config, see "Saved · Provider responding at 240ms", and confidently move on — only to discover during runtime that the new provider is unreachable. That violates the user's reliability principle.

   M3 is also relevant: the user explicitly called out "Last checked Ns ago timestamp on every dot tooltip" as an exceeds-bar feature. It's missing.

   The implementation is *close* to exceeding. Fix H1 and M3, and the assessment flips to yes.

**Intent gate:** CAPPED AT 7 (score cannot exceed 7 until H1 and M3 are addressed).

---

## 7. Recommendations to exceed intent

| Gap | Current | Exceeding | Recommendation | Effort |
| --- | ------- | --------- | -------------- | ------ |
| Save-time pill confidence | Reads stale registry value; can falsely say "Provider responding" when provider is unreachable | Pill always reflects the just-fetched recheck result | Apply H1 fix (return fresh entry from `refreshOne`, use it directly in the caller) | 15 minutes |
| New custom agents during a session | Invisible until next full refresh of the page | Appear within 60s via a periodic profile-list refetch | Apply M2 fix (add a 60s `setInterval` calling `listAgentIdentities()`) | 20 minutes |
| Tooltip freshness | Shows only the status label | Shows "Online · last checked 12s ago" everywhere | Apply M3 fix (add `formatLastChecked` helper, use `buildDotTooltip` in all four dot-rendering sites) | 30 minutes |
| Health-endpoint-down distinction | Falls to "Enter Now" if profiles loaded but health hangs | "Server unreachable" with Retry button across both failure modes | Apply M1 fix (broaden `serverUnreachable` to include profiles-loaded-but-health-stuck) | 5 minutes |
| Boot overlay leaves a dot unstyled for never-polled custom agents | Renders `status-dot-undefined` (no color) | Always renders an `idle` (gray) dot until first poll lands | Apply H2 fix (iterate over `agents` and default to `'idle'` token) | 10 minutes |
| Initial mount sends two health probes | One on empty-ids mount, one on populated-ids after profiles load | One probe after profiles load | Apply M4 fix (add `skipEmpty` option to `useAgentHealth`) | 15 minutes |

Total exceeds-bar effort: ~95 minutes.

---

## 8. What breaks first in production

**Most likely failure mode:** A user edits an agent's runtime config (e.g., switches provider from `openai` to `lm-studio`), saves, sees "Saved · Provider responding at 240ms" because the registry's previous poll still reflects `openai` as online, and confidently navigates away. Five minutes later, the next pipeline run for that agent fires against `lm-studio` and fails — but the failure surfaces deep in the pipeline (image-parser, chat) rather than at the save site. The user blames the pipeline, files a "the agent broke" support note with no actionable info, and the real cause (a misconfigured provider that the save-time recheck should have caught) is buried.

Mitigation: H1 fix.

**Second-most-likely failure mode:** Adding a new agent to MongoDB without restarting the app. The new agent is invisible to every UI surface — no dot, no banner, no AgentsView row — until someone hits Refresh in the browser. If the agent is critical and the operator assumes "I added it and the registry will pick it up", they get burned.

Mitigation: M2 fix.

---

## 9. Production verdict

**Do not ship as-is.** The architecture is correct; the wiring is mostly correct; but two High findings are reachable in 60 seconds by an operator running normal save and add-agent flows. Both have surgical fixes.

After H1, H2, and M2 are fixed (≈45 minutes of work), I would expect this to PASS on a re-review with a score of 8 or 9. M3 raises the score to 10 only if the user's stated exceeds-bar items are all satisfied.

---

## 10. Non-negotiable fixes (action list)

1. **H1** — `client/src/components/AgentsView.jsx:673` — Save-time recheck reads stale registry state. Fix `refreshOne` to return the fresh single-agent payload, and use it directly in `runSaveTimeRecheck`. (See finding for code.)
2. **H2** — `client/src/components/AgentsView.jsx:487-497` and `:3548` — `liveStatusByAgentId` returns `undefined` for agents not in the registry. Iterate over `agents` and default to `'idle'` via `healthStatusToOperationalToken`. (See finding for code.)
3. **M1** (recommended) — `client/src/components/AgentBootOverlay.jsx:373-377` — Broaden `serverUnreachable` so it triggers when profiles loaded but health hangs.
4. **M2** (recommended) — `client/src/context/AgentRegistryContext.jsx` — Add a 60s `setInterval` re-fetching `listAgentIdentities()` so AC#16 is honored.
5. **M3** (recommended) — `client/src/lib/agentStatus.js` — Add `formatLastChecked` and `buildDotTooltip` helpers; wire into PipelineSidebar dot, AgentsView dots, AgentHealthBanner dot, AppHeader dots so tooltips read "Online · last checked Ns ago".

Items 3, 4, 5 are MEDIUM and not strictly blocking the gate by severity rules, but two of them (M2, M3) are needed for plan-AC compliance and one (M1) is a quick fix. Recommend addressing all five before the next gate.
