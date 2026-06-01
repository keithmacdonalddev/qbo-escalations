# CTO Review: Agent Registry Bootstrap — 2026-05-22 2015

## 1. Summary

| Field           | Value                                                |
| --------------- | ---------------------------------------------------- |
| **Gate Decision** | **PASS**                                           |
| Score           | **9/10**                                             |
| Critical        | 0                                                    |
| High            | 0                                                    |
| Medium          | 1 (M4 carried forward — unchanged since prior)       |
| Low             | 3 (L1, L2 carried forward; L3 new and minor)         |
| Intent Gate     | PASS (exceeds-intent #5 = yes)                       |
| Next step       | Ship. Optionally clean up the remaining Medium/Lows. |

The two High findings from the prior review at 2026-05-22 1936 are resolved:

- **H1 (Save-time recheck stale state):** `refreshOne` now returns the fresh single-agent payload, and `runSaveTimeRecheck` reads `fresh` directly instead of the closure-captured `agentRegistry.agents[id].health`. Verified at `client/src/context/AgentRegistryContext.jsx:277-316` and `client/src/components/AgentsView.jsx:687-749`.
- **H2 (`undefined` operational status for unknown agents):** `liveStatusByAgentId` now iterates `agents` (not `Object.keys(registryAgents)`) and routes every entry through `healthStatusToOperationalToken`, which falls back to `'idle'` for unknown/null. Verified at `client/src/components/AgentsView.jsx:498-509`.

The plan-fidelity Medium findings are also resolved: server-unreachable detection broadened (M1), periodic profile refetch added (M2), tooltip "last checked Ns ago" wired across every dot rendering site (M3). Only M4 (double health probe on mount) remains and the two prior Lows (L1 — additive recovery ticker, L2 — recovery toast for boot-offline agents) are unchanged. None of these block the gate.

The implementation as it stands genuinely exceeds the user's intent: actionable diagnostics flow end-to-end, the save-time recheck is now trustworthy, the boot overlay distinguishes server-down from agent-slow, custom agents added mid-session appear within 60s, every dot tells you how fresh its state is, and the manual Refresh All button works exactly as specified. Ship.

---

## 2. Scope

### Files reviewed (related to this feature)

**New files (uncommitted):**

- `client/src/context/AgentRegistryContext.jsx` (434 lines)
- `client/src/hooks/useAgent.js` (62 lines)
- `client/src/lib/agentStatus.js` (117 lines) — extended with `formatLastChecked` and `buildDotTooltip`
- `client/src/components/AgentBootOverlay.jsx` (658 lines)
- `client/src/components/AgentBootOverlay.css`
- `client/src/components/AgentHealthBanner.jsx` (197 lines)
- `client/src/components/AgentHealthBanner.css`
- `server/test/agent-identities-health.test.js` (253 lines)

**Modified files (related to this feature):**

- `client/src/App.jsx` (+9) — `AgentRegistryProvider` + `AgentBootOverlay` + `AgentHealthBanner` mount points
- `client/src/components/AgentsView.jsx` (+394 net) — registry wiring, save-time recheck, tooltips
- `client/src/components/HealthToast.jsx` (+45) — programmatic `showHealthToast` API via CustomEvent
- `client/src/components/app/AppHeader.jsx` (+134 net) — `useAgent` migration, tooltips, Refresh All
- `client/src/components/chat-v5/PipelineSidebar.jsx` (+60 net) — per-stage health dot + tooltip
- `client/src/hooks/useAgentHealth.js` (+4) — internal-only comment
- `server/src/services/agent-health-service.js` (+170 net) — diagnostic sharpener, forced-refresh fix

**Modified files NOT in this feature's scope (pre-existing dirty WIP, excluded from review):**

`client/src/App.css`, `client/src/components/ImageParserPanel.jsx`, `client/src/components/Tooltip.css`, `client/src/components/chat-room/ChatRoomComposer.jsx`, `client/src/components/chat-v5/ChatV5Container.jsx`, `client/src/components/chat-v5/StageEventLogPanel.*`, `client/src/components/chat-v5/useStageOrchestrator.js`, `client/src/components/chat/ImageParserPopup.jsx`, `client/src/hooks/useImageParser.js`, `client/src/hooks/useRequestWaterfall.js`, `client/src/hooks/useToast.jsx`, all `server/src/services/provider-call-package-*` and `image-parser` changes, `prompts/`, and `provider-harness-research/`.

### Unplanned files

None substantive in this review. (`client/src/lib/agentStatus.js` was previously called out as outside the plan's "Files to create" list but is justifiable shared infrastructure; it has now grown to include the `formatLastChecked` / `buildDotTooltip` helpers that fix M3.)

---

## 3. Plan Fidelity

| Plan item | Status | Evidence (file:line) | Notes |
| --------- | ------ | -------------------- | ----- |
| AgentRegistry context with `useAgent(id)` hook | Implemented | `client/src/context/AgentRegistryContext.jsx:104` ; `client/src/hooks/useAgent.js:36` | |
| Boot overlay one row per agent | Implemented | `client/src/components/AgentBootOverlay.jsx:160`, `:511-526` | |
| 8s per-agent timeout + one retry before offline | Implemented | `AgentBootOverlay.jsx:48`, `:294-317` | One-shot retry tracked in `retriedRef`; second-pass detection uses `checkedAt >= retryStartedAt - 2s skew` |
| 25s ceiling with "Enter Now" + background-load banner | Implemented | `AgentBootOverlay.jsx:485`, `:634-650` | |
| Bootstrap summary line "X/Y agents online" | Implemented | `AgentBootOverlay.jsx:549-564`, `:626-632` | |
| Terminal-style aesthetic | Implemented | `AgentBootOverlay.css:9-19` palette matches prototype | |
| `AgentsView` dot reads from registry (not `AGENT_OPERATION_META.status`) | Implemented | `AgentsView.jsx:498-509`, `:531-541` | |
| `AppHeader` switches from `useAgentHealth` to `useAgent` | Implemented | `AppHeader.jsx:524-560` | Legacy shape reconstructed via local `toLegacy` adapter |
| PipelineSidebar per-stage health dot | Implemented | `PipelineSidebar.jsx:5-11`, `:35-43`, `:71-74` | Reuses `PIPELINE_RUNTIME_IDS` |
| `AgentHealthBanner` persistent + diagnostic-bearing | Implemented | `AgentHealthBanner.jsx:70-101`, `:166-196` | |
| HealthToast fires on online↔offline edges | Implemented | `AgentHealthBanner.jsx:113-152` ; `HealthToast.jsx:65-74`, `:119-128` | Recovery toast included as exceeds-bar |
| Save-time recheck on `handleSaveRuntime` + `handleToggleAgentEnabled` | Implemented (**fixed since 1936**) | `AgentsView.jsx:661-751`, `:782`, `:848` | refreshOne return-value pattern — see H1-resolved in §5 |
| Save-time recheck does NOT fire on `handleSavePrompt` | Implemented | `AgentsView.jsx:861-883` — only `handleSaveRuntime` and `handleToggleAgentEnabled` call `runSaveTimeRecheck` | |
| 15s recovery polling for offline agents | Implemented | `AgentRegistryContext.jsx:344-400` | Additive to base poll — see L1 |
| Manual "Refresh All" button in header | Implemented | `AppHeader.jsx:639-651`, `:945-975` | |
| Per-failure diagnostic carried end-to-end | Implemented | server: `agent-health-service.js:203-262` ; client: `AgentRegistryContext.jsx:230-244`, `AgentHealthBanner.jsx:75-83` | |
| Health endpoint unreachable → "Server unreachable" + Retry | Implemented (**fixed since 1936**) | `AgentBootOverlay.jsx:379-398` | Three-signal detector now catches profiles-OK-but-health-stuck |
| Auto-detection of new agents on 60s poll | Implemented (**fixed since 1936**) | `AgentRegistryContext.jsx:173-211` | 60s `setInterval` calls `listAgentIdentities`; only swaps state when id set or `updatedAt` changes |
| Existing `HealthBanner.jsx` remains in `App.jsx` | Implemented | `App.jsx:335` | |
| Hover tooltip "Online · last checked Ns ago" | Implemented (**fixed since 1936**) | `PipelineSidebar.jsx:42`, `AgentsView.jsx:1514`, `AppHeader.jsx:567-579`, `AgentHealthBanner.jsx:100`, `:185` | All four dot-rendering sites use `buildDotTooltip` |
| Server `forceRefresh=true` invalidates cache | Implemented | `agent-health-service.js:924-943` | Test coverage in `agent-identities-health.test.js:186-223` |
| Per-agent `checkedAt` ISO timestamp | Implemented | `agent-health-service.js:818, :858, :884, :920` | Tested in `agent-identities-health.test.js:101-139` |
| Server tests for health endpoint | Implemented (4/4 passing) | `server/test/agent-identities-health.test.js` | Verified by running `node --test test/agent-identities-health.test.js` — 4 pass, 0 fail, 5.87s |
| Client tests for context + boot overlay | Skipped (policy-permitted) | n/a | `.claude/rules/client.md` — no client test framework yet |

---

## 4. Cross-Boundary Data Flow Trace

I traced the **save-time recheck path** again, end-to-end, because it was the H1 culprit in the prior review and is the most consequential cross-layer flow in this feature.

**Step 1 — User edits runtime, clicks Save**
`client/src/components/AgentsView.jsx:753` → `handleSaveRuntime(nextRuntime)`

**Step 2 — Server save**
`updateAgentRuntime(agentId, localRuntime, summary)` (line 761) → `PATCH /api/agent-identities/:id/runtime` → returns updated agent. Reducer state updates `runtimeSelections`, `runtimeSaveStatus = "Runtime defaults saved to server."`

**Step 3 — Trigger recheck (unawaited)**
`AgentsView.jsx:782` → `runSaveTimeRecheck(agentId)` (fire-and-forget — note the unawaited call is by design; recheck failures must not back out the save)

**Step 4 — Recheck function**
`AgentsView.jsx:661-751`:
- Line 669 — sets `runtimeRecheckResult = { status: 'checking', message: 'Rechecking provider...' }`.
- Line 687 — `fresh = await agentRegistry.refreshOne(agentId);`

**Step 5 — refreshOne**
`AgentRegistryContext.jsx:277-316`:
- Line 280 — `await getAgentHealth([agentId], { forceRefresh: true })`.
- Line 281 — `const single = data?.agents?.[agentId] || null;`
- Line 283 — `setLocalHealth(prev => ({ ...prev, [agentId]: single }))` to update the registry.
- **Line 296 — `return single;`** ← this is the fix that resolved H1. The caller now reads the just-fetched payload directly, not the React-scheduled stale snapshot.

**Step 6 — Back in `runSaveTimeRecheck`**
`AgentsView.jsx:715` — `const status = fresh?.status || 'unknown';`
`AgentsView.jsx:716` — `const updatedDiagnostic = fresh?.diagnostic ?? fresh?.message ?? null;`

`fresh` here is the server payload returned synchronously from the await. It uses the server's `message` field for the human-readable diagnostic, which the registry's merged shape renames to `diagnostic` — the caller reads either, so both contracts are honored.

**Step 7 — Visible UI**
`RuntimeSettingsPanel` renders the pill from `recheckResult.message`. The text matches the recheck's actual outcome.

I also traced the **boot → ceiling → server-unreachable** path to verify M1 was fixed:

`AgentBootOverlay.jsx:379-398`:
- Branch 1 — `profilesError && profilesError.length > 0` → server unreachable.
- Branch 2 — `bootstrapping && agentIds.length === 0 && elapsedMs >= 25s` → server unreachable.
- **Branch 3 (new) — `agentIds.length > 0 && elapsedMs >= 25s && no agent has a known status` → server unreachable.** This catches the previously-missed case where `/api/agent-identities/` returns but `/api/agent-identities/health` hangs.

All three branches resolve to the same UI surface (`AgentBootOverlay.jsx:579-604`) with a Retry button that calls `refreshAll()` and resets the local state via `handleRetry`.

---

## 5. Findings by framework section

### State consistency and data flow correctness

#### H1 — RESOLVED (Save-time recheck stale registry state)

The prior High finding is fixed. `refreshOne` returns the fresh single-agent payload (`AgentRegistryContext.jsx:296`, `:314`), and `runSaveTimeRecheck` reads `fresh` directly instead of `agentRegistry.agents[id].health` (`AgentsView.jsx:687, :715-716`). The closure-staleness window is closed.

Documentation in the file is exemplary — `AgentsView.jsx:678-686` warns future readers not to revert to the registry-read pattern, citing the prior cto-review finding by number.

#### H2 — RESOLVED (`liveStatusByAgentId` undefined for unknown agents)

The prior High finding is fixed. `liveStatusByAgentId` (`AgentsView.jsx:498-509`) iterates `agents` (the page's own list, never undefined) instead of `Object.keys(registryAgents)`, and routes every entry through `healthStatusToOperationalToken` which has a built-in `'idle'` fallback (`client/src/lib/agentStatus.js:39-41`). No `status-dot-undefined` class is reachable.

The fix's correctness extends to `registryHealthById` (`AgentsView.jsx:516-529`), which also iterates `agents` and defaults to `{ status: 'unknown', checkedAt: null }`.

No findings.

### Intent fidelity

#### M1 — RESOLVED (Server-unreachable detection too narrow)

The prior Medium finding is fixed. `serverUnreachable` in `AgentBootOverlay.jsx:379-398` now uses three signals; the new third branch catches profiles-loaded-but-health-hanging at 25s. Comment block at `:367-378` documents the rationale and cites the prior review.

#### M2 — RESOLVED (No periodic profile refetch)

The prior Medium finding is fixed. `AgentRegistryContext.jsx:173-211` adds a 60s `setInterval` that re-fetches the profile list and merges new agents into `profilesById`. Equality check is cheap-but-correct: same id set AND same `updatedAt` per agent. Failures are swallowed (keeps the last known good list, doesn't blank the registry on a transient network blip). Cleanup contract is explicit (`cancelled` flag + `clearInterval`).

#### M3 — RESOLVED (Dot tooltips missing "last checked Ns ago")

The prior Medium finding is fixed. `client/src/lib/agentStatus.js:83-99` adds `formatLastChecked` (5s threshold for "just now", scales to `1d+ ago` for stale tabs), and `:112-116` adds `buildDotTooltip(status, checkedAt)`. The helper is consumed at every dot site:

- `PipelineSidebar.jsx:42` — `title={healthTitle}`.
- `AgentHealthBanner.jsx:100`, `:185` — banner-level dot and per-row tooltips.
- `AgentsView.jsx:1514` — `AgentMissionCard` mission grid.
- `AppHeader.jsx:567-579` — workspace/chat/copilot agent strip; the tooltip is appended to the existing label text so the title reads "Open <Agent>. Active. Ready. — Online · last checked 12s ago".

The aria-label is deliberately kept as the un-annotated label so screen readers don't read a stale Ns-ago value (the title attribute doesn't update live; the freshness hint is hover-only). That's the right call — documented in `AppHeader.jsx:910-914`.

### Code quality and defensive programming

#### Finding M4 — Initial mount sends two health probes (MEDIUM, carried forward)

**Section:** Code quality and defensive programming
**Severity:** Medium
**File:** `client/src/context/AgentRegistryContext.jsx:115-124` ; `client/src/hooks/useAgentHealth.js:30-90`
**Issue:** Unchanged since the prior review. On first render, `profilesById = {}` → `agentIds = []` → `useAgentHealth([])` triggers a `loadHealth([])` call. The server expands empty to ALL `DEFAULT_PROFILES` ids and returns a snapshot. Then `listAgentIdentities` resolves, `profilesById` populates, `agentIds` becomes the real list — `useAgentHealth`'s internal effect re-runs and fires a second `loadHealth([...])` call.

Net: two health probes on mount during the bootstrap window where you most want responsiveness.

**Reproduction:** Open the network panel, refresh. Two `/api/agent-identities/health` requests fire within ~150ms of each other during boot.

**Fix:** Same as prior review — add a `skipEmpty` option to `useAgentHealth`. Two-line patch:

```js
// client/src/hooks/useAgentHealth.js
useEffect(() => {
  if (ids.length === 0 && options.skipEmpty === true) return undefined;
  // ... existing body
}, [ids, options.forceRefresh, options.pollMs, options.skipEmpty, refresh]);
```

Then in `AgentRegistryContext.jsx:120-124`:
```js
const { agents: polledHealth, checkedAt: polledCheckedAt, refresh: pollingRefresh }
  = useAgentHealth(agentIds, { skipEmpty: true });
```

Not blocking. Functionally correct, just slightly noisy. Carried forward at MEDIUM because the underlying mechanism hasn't changed.

**Verification standard:** Reproducible in 60s with the dev server running and the network panel open.

### Performance and responsiveness

#### Finding L1 — Recovery ticker additive to 60s base poll (LOW, carried forward)

Unchanged since the prior review. The 15s recovery ticker (`AgentRegistryContext.jsx:347-387`) runs in addition to the 60s base poll. Effective probe rate for an offline agent is ~12s. Functionally exceeds the plan's intent ("switch to 15s") and the comment at `AgentRegistryContext.jsx:332-335` is honest about it.

No fix required. Carried forward at LOW because documentation matches behavior.

### Observability and debugging

#### Finding L2 — Recovery toast for boot-time-offline agents (LOW, carried forward)

Unchanged since the prior review. `AgentHealthBanner.jsx:113-152` fires a "recovered" toast for any agent that flips offline→online, including agents that were offline at boot (the user knows they were down via the banner). The toast is informational, not erroneous; the comment at `AgentHealthBanner.jsx:118-123` documents the intentional skip rules for `unknown` and `disabled` transitions.

No fix required. Carried forward at LOW.

### Failure modes

#### Finding L3 — Registry's `profilesById` lags after `handleSaveRuntime`/`handleToggleAgentEnabled` (LOW, new)

**Section:** Failure modes / state consistency
**Severity:** Low
**Files:** `client/src/components/AgentsView.jsx:761-788`, `:822-859` ; `client/src/context/AgentRegistryContext.jsx:127-152`, `:173-211`
**Issue:** When the user saves runtime defaults or toggles enabled, AgentsView's local `agents` state updates immediately via `applyUpdatedAgent`, and the server-side health probe (via `refreshOne`) sees the new provider on the next call. BUT the registry's own `profilesById` is only refreshed by (a) the initial mount-load and (b) the new 60s `setInterval`. So for up to 60s after a save, `useAgent(id).profile` returns the pre-save profile object (display name, runtime, etc.) while `useAgent(id).health` returns the post-save health.

In practice this is benign — none of the consumers of `useAgent` read `profile.runtime` in a way that would visibly mislead the user (the agent dock and pipeline sidebar read the health side, not the runtime side). But if a future surface starts reading `useAgent(id).profile.runtime` (e.g. a "current provider" badge), it would briefly show the old provider after a save.

**Reproduction:** Change an agent's provider from `openai` to `lm-studio` via the runtime settings panel. Open a React DevTools panel pointed at `AgentRegistryProvider`. Inspect `profilesById[agentId].runtime.provider` — it reads `openai` for ~0-60s, then flips to `lm-studio` on the next periodic refetch.

**Fix:** When `applyUpdatedAgent` in `AgentsView.jsx` runs, dispatch a `agent-profile-updated` custom event (it already does via `dispatchAgentProfileUpdated`) and have the registry listen for it to merge the updated agent into `profilesById`. Roughly 10 lines in `AgentRegistryContext.jsx`. Or alternatively, expose a `refreshProfiles()` callback on the context and have AgentsView call it after a save.

Either fix is optional — no current consumer is affected.

**Verification standard:** Traced through code. Not reproducible as a user-visible defect today.

### Security and privacy

No findings.

### Accessibility and responsive design

No findings clearly broken. The boot overlay has `role="dialog"`, `aria-label`, `aria-busy`. The banner has `role="status"` + `aria-live="polite"`. The Refresh All button has `aria-busy` toggling correctly. Tooltips kept off `aria-label` to avoid stale screen-reader output (intentional, documented).

---

## 6. Exceeds expectations assessment

1. **Would a senior engineer be impressed by this code?**
   Yes. The single-source-of-truth design is sound. The diagnostic sharpener on the server is thoughtful (preserves specific upstream messages, only rewrites vague ones). The closure-staleness fix in `refreshOne` is the canonical pattern. The comments are exemplary — they cite the prior cto-review findings by ID, explain *why* the code reads `fresh` instead of the registry, and document edge cases the next reader would otherwise have to rediscover. The boot overlay's 3-signal server-unreachable detector is a clear example of defense in depth.

2. **Are error messages actionable?**
   Yes. The server sharpens vague upstream reasons ("Connection failed") into specific diagnostics ("Anthropic unreachable at api.anthropic.com"). The save-time pill reads "Saved · Provider unreachable: <diagnostic>" with the real failure detail. The banner and toast carry diagnostics through unchanged. Tested directly by `agent-identities-health.test.js`.

3. **Is defensive programming comprehensive?**
   Yes. UNKNOWN_HEALTH fallback; idle-token fallback in the operational-token mapping; per-agent retry tracking via ref (won't re-retry); recovery-ticker per-agent isolation; cleanup contracts for periodic refetch AND recovery tickers AND elapsed-time tick. Failure paths in `runSaveTimeRecheck` produce inline messages; the `catch` in `refreshOne` synthesizes an offline snapshot so the caller never gets undefined back.

4. **Does the architecture make future changes easier?**
   Yes. Adding a new status indicator anywhere in the app costs one `useAgent(id)` call. `agentStatus.js` is the single place for the dot taxonomy and tooltip formatting. The boot overlay is independently testable.

5. **If you showed this to the user right now, would they say "this exceeds what I asked for"?**
   **Yes.** The user's stated reliability principle ("reachability must be checked at every layer — save-time, per-request pre-flight, AND background monitor") is honored at every pillar: save-time recheck is now trustworthy (H1 fixed), background polling has accelerated recovery (15s ticker), and the per-request pre-flight is the existing `useAgent` read which always returns the freshest registry state. The user's "specific diagnostics, no vague offline" requirement holds end-to-end. The "exceeds bar" items from the plan (one-retry-before-offline, bootstrap summary, manual refresh, terminal aesthetic, last-checked tooltips) are all implemented and visible.

**Intent gate:** PASS. No cap applied.

---

## 7. Recommendations to exceed intent (optional polish)

| Gap | Current | Exceeding | Recommendation | Effort |
| --- | ------- | --------- | -------------- | ------ |
| Double health probe on mount | Two `/health` calls within 150ms of boot | One call after profiles load | Apply M4 fix — `skipEmpty: true` option in useAgentHealth | 15 min |
| `profilesById` 60s lag after save | Registry's profile slot updates on next 60s refetch | Registry merges the updated profile immediately when AgentsView saves | Listen for `agent-profile-updated` custom event in `AgentRegistryContext` and merge into `profilesById` | 20 min |
| Recovery ticker doubles up with base poll | Effective ~12s probe interval for offline agents | Clean 15s replacement when offline, 60s when online | Suppress base-poll inclusion of offline agents (or document the additive behavior more visibly) | 30 min |
| Boot-offline recovery toast may surprise the user | Fires "Agent recovered" for an agent the user already knew was down | Suppress recovery toast if the agent was never seen online | Track `seenOnlineRef` per agent in `AgentHealthBanner` | 15 min |

Total ~80 minutes for full polish. None of these block shipping.

---

## 8. What breaks first in production

With H1 and H2 fixed, the production failure modes from the prior review are gone:

- **Save-time recheck false positives** — no longer possible; the pill reads the actual recheck result.
- **Invisible new agents** — auto-detected within 60s via the periodic profile refetch.
- **Server-down ambiguity** — broadened detector catches profiles-OK-but-health-hanging.

The most likely remaining failure mode is a **flapping provider during the boot window**: an agent that responds, then doesn't, then responds again within the 25-second ceiling could land on either status depending on which probe wins. The retry-once-before-offline logic mitigates this — a single flap won't strand the agent at offline — but rapid flapping at boot is not specifically protected.

Mitigation: not blocking. The existing 10s `HealthToast` debounce and the registry's 30s cache absorb most flapping.

---

## 9. Production verdict

**Ship.** The architecture is correct, the wiring is correct, and the previously-flagged Highs are resolved with surgical fixes. The remaining findings are one Medium (double-probe on mount) and three Lows that are functionally fine. The exceeds-intent assessment flipped from "no" to "yes" — both because the save-time recheck is now trustworthy and because the "last checked Ns ago" tooltips are now present everywhere.

If you want to clean up M4 and L3 before shipping, it's about 35 minutes total. Otherwise this is ready as-is.

---

## 10. Non-negotiable fixes (action list)

**None.** All Critical/High findings are resolved. The remaining items in §7 are optional polish.

If you want a checklist of the polish items:

1. **M4** — `client/src/hooks/useAgentHealth.js` — add `skipEmpty: true` option and gate the empty-ids probe.
2. **L3** — `client/src/context/AgentRegistryContext.jsx` — listen for `agent-profile-updated` events and merge into `profilesById` so the registry's profile state stays in sync with AgentsView's local state.
3. **L1** — Update the comment block at `AgentRegistryContext.jsx:332-335` to be even more explicit that the 15s ticker is intentionally additive and approximate-12s-effective is by design.
4. **L2** — `client/src/components/AgentHealthBanner.jsx` — add a `seenOnlineRef` so recovery toasts only fire for agents the user has seen online at least once.

---

## Re-review progression

| Review | Gate | Score | Critical | High | Medium | Low |
| ------ | ---- | ----- | -------- | ---- | ------ | --- |
| 2026-05-22 1936 | FAIL | 6/10 | 0 | 2 | 4 | 2 |
| 2026-05-22 2015 (this review) | **PASS** | **9/10** | 0 | 0 | 1 | 3 |

Both prior Highs resolved. Three of four prior Mediums resolved. Score raised from 6 to 9 (capped by the one remaining Medium and the carried-forward Lows).
