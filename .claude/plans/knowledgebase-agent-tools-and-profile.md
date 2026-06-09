# Knowledge Base Agent: Write Tools, Provider/Model Config, Honest Profile, and Startup

Status: DRAFT (planning only — no code changed)
Author: Architect (read-only planning pass)
Date: 2026-06-09
Pairs with: `cto-review` skill

---

## Goal

Make the Knowledge Base Agent (`knowledgebase-agent`) able to actually EDIT the open KB draft (a `KnowledgeCandidate`) — proactively and on command — instead of only proposing text it cannot save. Give it a real, working provider/model + failover picker like the other agents, an honest profile that reflects its true full role and harness, and a startup/background run path consistent with how other background work already runs. The human-gated approve/publish/deprecate/redact boundary stays absolute.

This is the first-domain proving ground for the broader product north star: governed, evidence-backed shared memory that an expert agent maintains but a human validates.

## Out of scope (do NOT touch here)

- Copy-conversation button and markdown rendering of agent messages (in progress elsewhere).
- Any change that lets the agent approve, publish, deprecate, or redact knowledge.
- Starting/stopping/restarting the server (user-owned runtime). Restart is a note only.
- The broader agent-profiles-overhaul honesty refactor of `AGENT_META` in `AgentsView.jsx` (see Risk/Overlap). We align with it; we do not do it.

---

## Verified findings (each confirmed by reading the file in this pass)

### A. The startup claim — TRUTH

The user believes agents "run on startup, like they all do." That is only partly true, and NOT in the way implied.

Evidence from `server/src/index.js` (the only process entrypoint; `start()` ~line 127, listener `onListening` ~line 218):
- On listen, gated by `resolveStartupControls` (`server/src/lib/startup-controls.js`), the server starts:
  - provider warmup (`warmClaude`, `warmCodex`),
  - `startBriefingScheduler()` -> `server/src/services/workspace-scheduler.js`,
  - `startWorkspaceMonitor()`,
  - `startAgentHealthMonitor()` -> `server/src/services/agent-health-service.js`,
  - image-parser provider availability self-check + a 5-min `setInterval` health check.
- The ONLY thing that resembles "an agent doing work on a schedule" is the **workspace morning briefing**: `workspace-scheduler.js` runs a `setInterval` (5 min) and, once per day at 08:00 local, gathers context and calls the LLM via `startChatOrchestration({ mode: 'fallback', primaryProvider: getDefaultProvider(), fallbackProvider: getAlternateProvider(...) })`, then saves a `WorkspaceBriefing`.
- `startAgentHealthMonitor()` is NOT an agent doing work — it only probes provider availability/identity snapshots for the health UI.
- There is **NO** startup or scheduled job that runs `scanKnowledgebaseAgent()` or any KB agent work. `scanKnowledgebaseAgent()` (`server/src/services/knowledgebase-agent-service.js` ~line 791) is reachable only via `POST /api/knowledge/agent/scan` (`server/src/routes/knowledge.js` ~line 121), which is manual.

Conclusion: there IS one established "agent runs on a schedule from startup" pattern — the workspace briefing scheduler — and it is a small, self-contained `setInterval` module wired in `index.js` behind a `startup-controls` flag. So Part D is **"follow an existing pattern"**, not net-new infra, as long as we copy the `workspace-scheduler.js` shape (interval + once-per-day guard + Mongo-ready guard + startup-controls flag + shutdown stop). This is lower risk than the brief feared.

### B. Tool transport — IMPORTANT CORRECTION to the brief's assumption

The brief assumed the existing tool loop uses structured `tool_use`/`tool_result` and that the CLI subprocess cannot do tools. The actual implementation is different and simpler:

- `server/src/services/agent-tool-loop.js` (`runAgentToolLoop`) does NOT use structured function-calling. It runs a **text protocol**: the model is told to emit `ACTION: {"tool": "...", "params": {...}}` lines; `parseWorkspaceActions()` (regex) extracts them from the plain-text response; `executeWorkspaceActions()` runs handlers; results are fed back as a user turn for up to 4 iterations. See `server/src/services/workspace-request-helpers.js` (`parseWorkspaceActions` ~line 182, `executeWorkspaceActions` ~line 205) and `server/src/services/shared-agent-tools.js` (`SHARED_AGENT_TOOL_LINES`, `ACTION FORMAT` block).
- Because it is plain text in/out, this loop works on **every** transport — including the Claude CLI subprocess — and it already runs through `startChatOrchestration`, which honors `primaryProvider/fallbackProvider/primaryModel/fallbackModel/mode/autoFailover/reasoningEffort` (so it ALSO honors a profile-driven provider/model + failover).

Implication: We do NOT need to migrate to a structured-tool direct-provider SDK to get tools, and we do NOT need to abandon the CLI. The cleanest, reuse-first path is to move the KB sidebar chat off the bare `claudeChat()` call and onto `runAgentToolLoop` (or a thin KB-specific variant of the same text-ACTION loop), passing a `runtimePolicy` resolved from the agent's profile runtime. That single change gives BOTH tools AND a working provider/model/failover picker.

Caveat to confirm during implementation (flagged): `runAgentToolLoop` currently hardcodes its toolset to `WORKSPACE_TOOL_HANDLERS` + a filtered slice of `SHARED_AGENT_TOOL_HANDLERS`, and it parses `parseWorkspaceActions` / `executeWorkspaceActions` from `workspace-request-helpers` (which log to `workspace-action-log` and apply workspace verification handlers). It is NOT currently parameterized to accept a custom handler map. Two options in Phase 2 (see Decision D-1).

### C. The draft-write path is ready for an agent actor

- `updateKnowledgeRecord(recordId, payload, actorInput)` (`server/src/services/knowledgebase-management-service.js` ~line 399) calls `resolveKnowledgeActor(actorInput)` then `assertKnowledgePermission(actor, 'review')`.
- `resolveKnowledgeActor` (~line 194) accepts a direct `{ actor, role }` object. The `reviewer` role grants `['read','review','feedback','relationship','export']` and explicitly does NOT include `publish/deprecate/redact` (`ROLE_PERMISSIONS` ~line 31). So passing `{ actor: 'knowledgebase-agent', role: 'reviewer' }` authorizes draft edits while making publish/deprecate/redact structurally impossible for the agent.
- `sanitizeKnowledgePatch` (~line 303) is the safety funnel: it only writes `EDITABLE_TEXT_FIELDS` (title, customerGoal, reportedProblem, evidenceFromCase, troubleshootingTried, confirmedCause, finalOutcome, invEscalationStatus, summary, symptom, rootCause, exactFix, escalationPath, reviewNotes, category) plus a few validated enums/arrays. It DOES accept `reviewStatus` in (draft|approved|rejected). The agent tool MUST strip `reviewStatus`, `publishTarget`, `allowedUsesOverride`, `trustStateOverride` from any payload before calling (defense in depth — the agent must never set reviewStatus to approved).
- Every update already appends an `auditEvent` (`record.update`, with `fields`, `previousStatus`, `nextStatus`) and, on status change, `reviewHistory`. This gives us the audit trail for "show what changed" for free. Prior values for UNDO are not auto-captured by the service — the tool handler must read the doc's current field values BEFORE the patch and return them.
- `updateKnowledgeRecord` blocks edits when `reviewStatus === 'published'` (409). Good: the agent cannot mutate trusted records.

### D. Provider/model config wiring

- Client picker source of truth: `client/src/lib/agentRuntimeSettings.js` -> `AGENT_RUNTIME_DEFINITIONS` (~line 35). `knowledgebase-agent` is absent, which is the only reason it has no picker. Adding one freezing-list entry gives it the full Primary+Fallback picker (failover always on for the generic branch — see `normalizeAgentRuntimeState` ~line 288).
- Server side needs NO new id handling: `normalizeAgentRuntimeState(agentId, ...)` (`server/src/services/agent-identity-service.js` ~line 513), `listAgentRuntimeDefaults` (~line 856), and `updateAgentRuntime` (~line 1007) all key off `DEFAULT_PROFILES` (which already contains `knowledgebase-agent`) and the `IMAGE_RUNTIME_AGENT_IDS` set (~line 127, which does NOT contain it — correct, it is a normal conversational agent). The runtime-defaults route `GET /api/agent-identities/runtime-defaults?ids=...` (`server/src/routes/agent-identities.js` ~line 212) is generic. Confirmed by `server/test/agent-identities-registry.test.js`.
- Read-back at request time: image-parser/triage (Wave 2) read the saved profile runtime via `listAgentRuntimeDefaults` on the CLIENT (`client/src/components/chat-v5/pipelineRuntime.js` ~line 157, `readImageParserProfileRuntime`) and send the selection in the request body. The KB sidebar chat is **server-driven** (route calls `answerKnowledgeBaseAgentQuestion` directly with only `message`), so the cleanest mirror is to resolve the runtime **server-side** inside the KB service via `listAgentRuntimeDefaults(['knowledgebase-agent'])` and translate it into a `runtimePolicy` for `runAgentToolLoop`. Server-side resolution avoids threading runtime through the client and matches `room-agent-runtime.js` `resolveAgentRuntimePolicy` (the existing server pattern that produces exactly the `{mode, primaryProvider, primaryModel, fallbackProvider, fallbackModel, reasoningEffort, serviceTier}` shape `runAgentToolLoop` wants).
- Neutral default: when no runtime is configured, fall back to `getDefaultProvider()` + `getAlternateProvider(...)` (the catalog `DEFAULT_PROVIDER_ID`), exactly as `workspace-scheduler.js` and `room-agent-runtime.js` do. Do NOT hardcode a brand.

### E. Honest profile

- The identity profile (`server/src/services/room-agents/agent-profiles.js` ~line 70) is already complete and already says boundaries: "Does not approve, publish, hide, deprecate". Capabilities in `getKnowledgebaseAgentStatus` already report `approvesKnowledge:false, publishesKnowledge:false`. Good — no profile-identity rewrite needed.
- The DISPLAYED prompt is `prompts/agents/knowledgebase-agent.md` (mapped in `server/src/lib/agent-prompt-store.js` ~line 113), rendered by `getRenderedAgentPrompt`. It currently describes ONLY draft-field extraction and explicitly omits the sidebar/tool harness.
- The "hidden prompt" the user senses is `buildKnowledgeBaseAgentSidebarSystemPrompt()` (`server/src/services/knowledgebase-agent-context-service.js` ~line 517), appended at runtime, which contains the now-false line: "When the reviewer asks for edits, propose exact replacement text by field name. Do not claim you saved changes unless the UI/API explicitly saved them." This is the line that makes the agent say it can't save.
- The KB agent is NOT referenced in `client/src/components/AgentsView.jsx` `AGENT_META` (the hardcoded table with fabricated owners/trust scores like "Maya Patel"/"4.5"). So the KB agent profile already shows only real identity/prompt data — it does not need an AGENT_META row, and we must NOT add a fabricated one (that would fight the agent-profiles-overhaul honesty effort).

---

## Decisions

- **D-1 (transport):** Reuse the existing text-`ACTION:` tool loop rather than build structured tool calling. RECOMMENDED sub-option: add KB-specific tool handlers and run them through a small KB tool loop modeled on `runAgentToolLoop` but with its own handler map + a KB action log, OR (lighter) register the KB tools into the shared loop by parameterizing `runAgentToolLoop` to accept a `toolHandlers`/`parse`/`execute` injection. Pick the lighter one only if parameterization stays surgical; otherwise a dedicated `knowledgebase-agent-tool-loop.js` that imports `startWorkspaceCollectedChat` + `parseWorkspaceActions` (both already exported) and a KB handler map is cleaner and avoids mutating the global `WORKSPACE_TOOL_HANDLERS` map. Final choice deferred to Phase 2 spike; default = dedicated KB loop reusing the exported helpers.
- **D-2 (actor/permission):** Agent calls `updateKnowledgeRecord` with `{ actor: 'knowledgebase-agent', role: 'reviewer' }`. Reviewer role cannot publish/deprecate/redact. The tool also hard-strips status/publish/trust fields from the payload before calling.
- **D-3 (autonomy):** "Apply + show changes + undo." Enforced in BOTH layers:
  - Prompt: proactive edits only fill EMPTY or flagged fields; ASK before overwriting non-empty fields the user wrote; on explicit command, edit anything (still never status).
  - Server: the `update_draft` handler accepts a `mode: 'proactive' | 'explicit'` argument. In `proactive` mode it refuses to overwrite a field whose current value is non-empty (returns a "would-overwrite, ask first" result instead of writing). In `explicit` mode it writes. Both modes capture prior values and return them for undo.
- **D-4 (runtime resolution):** Resolve server-side via `listAgentRuntimeDefaults(['knowledgebase-agent'])` -> `runtimePolicy`, default to neutral catalog default when unconfigured.
- **D-5 (startup/background):** Copy the `workspace-scheduler.js` pattern into a new `knowledgebase-agent-scheduler.js`: interval + once-per-day guard + Mongo-ready guard, wired in `index.js` behind a new `startup-controls` flag `DISABLE_KB_AGENT_SCHEDULER`. Phase 1 of scheduler runs only `scanKnowledgebaseAgent()` (read-only proposal generation, already safe). Proactive auto-fill of empty fields is a SEPARATE, later, opt-in phase (higher risk) and is gated behind its own flag, default OFF.

---

## Phases

### Phase 1 — Provider/model picker + server runtime resolution (lowest risk, do FIRST)

Purpose: Give the agent a working profile runtime and make the chat honor it, WITHOUT yet adding tools. This is independently valuable and unblocks the picker the user asked for.

Files:
- `client/src/lib/agentRuntimeSettings.js`: add to `AGENT_RUNTIME_DEFINITIONS`:
  `{ id: 'knowledgebase-agent', agentId: 'knowledgebase-agent', label: 'Knowledge Base Agent', description: 'Reviews and edits KB drafts', color: '#5e5ce6', storagePrefix: 'qbo-knowledgebase-agent', supportsReasoning: true }`. No `defaultProvider` (uses neutral catalog default), no `kind` (normal conversational agent so it gets the always-on Primary+Fallback picker).
- `server/src/services/knowledgebase-agent-context-service.js`: add a helper `resolveKbAgentRuntimePolicy()` that calls `listAgentRuntimeDefaults(['knowledgebase-agent'])`, and if `runtime.configured`, maps to a `runtimePolicy` (mirror `room-agent-runtime.js resolveAgentRuntimePolicy` output shape); else returns neutral default (`getDefaultProvider()`/`getAlternateProvider`). For Phase 1, route the existing `runKnowledgeBaseAgentCompletion` through `startChatOrchestration` (via the same helpers workspace uses) instead of bare `claudeChat`, OR keep `claudeChat` for Phase 1 and only consume the runtime in Phase 2. RECOMMENDED: defer the transport switch to Phase 2 and in Phase 1 only add the picker + the `resolveKbAgentRuntimePolicy` helper + a unit test, so Phase 1 ships no behavior change to chat (pure additive).

Acceptance criteria:
- AgentsView Configuration tab shows a Runtime Defaults picker for the Knowledge Base Agent with Primary + Fallback provider/model and reasoning effort.
- Saving runtime persists to `localStorage` and `AgentIdentity.runtime` (existing `handleSaveRuntime` path) and `GET /api/agent-identities/runtime-defaults?ids=knowledgebase-agent` returns it.
- `resolveKbAgentRuntimePolicy()` returns the configured policy when set and a neutral default when unset (unit test).

Tests (target files explicitly; full suite has a known unrelated RED at image-parser-comprehensive):
- Extend `server/test/agent-identities-registry.test.js` to assert `runtime-defaults?ids=knowledgebase-agent` round-trips a saved runtime.
- New small unit test for `resolveKbAgentRuntimePolicy` neutral-default behavior.

Risks: very low (additive list entry + read helper).

### Phase 2 — Write tools + tool loop transport (the core)

Purpose: The agent can read the draft, search the KB, self-check completeness, and APPLY edits, returning prior values for undo. Chat moves onto the text-ACTION tool loop driven by the Phase 1 runtime policy + failover.

New file: `server/src/services/knowledgebase-agent-tools.js` — KB tool handler map + tool description lines (mirror `shared-agent-tools.js` structure: a `KB_AGENT_TOOL_METADATA`, a `buildKbAgentToolLines()`, and a `KB_AGENT_TOOL_HANDLERS` object). Handlers, each scoped to the open `recordId` (closure or explicit param validated against the open record):

1. `kb.readDraft` — params `{}`. Returns current editable field values + `getCandidateQualityIssues(candidate)` warnings (reuse the exported function from `knowledgebase-agent-service.js`). Read-only.
2. `kb.searchKnowledgeBase` — params `{ query, limit? }`. Calls `searchKnowledge` (already imported in the context service) with `includeCandidates:true`. Read-only. (Could also expose via existing `web.search`/`db.*` if desired, but a KB-scoped search is clearer.)
3. `kb.checkCompleteness` — params `{}`. Returns `getCandidateQualityIssues(candidate)` + the `buildDraftHarnessChecks`-style required/optional field list. Read-only.
4. `kb.updateDraft` — params `{ fields: { <editableField>: value, ... }, mode: 'proactive'|'explicit', note? }`.
   - Validates each key is in `EDITABLE_TEXT_FIELDS` (import/re-export the constant); REJECTS any of `reviewStatus`, `publishTarget`, `reusableOutcome`->(allow? see note), `allowedUsesOverride`, `trustStateOverride`. Decision: for the crown-jewel boundary, the tool whitelists ONLY the plain `EDITABLE_TEXT_FIELDS` plus `keySignals`/`importantBoundaries` arrays; it does NOT pass `reviewStatus` ever.
   - Reads current values of the targeted fields FIRST (for undo `priorValues`).
   - In `proactive` mode, drops any field whose current value is non-empty and returns them in a `skippedNonEmpty` list with guidance to ask the user; writes only empty/flagged fields.
   - Calls `updateKnowledgeRecord(recordId, sanitizedFields, { actor: 'knowledgebase-agent', role: 'reviewer' })`.
   - Returns `{ ok, changedFields: [{ field, prior, next }], skippedNonEmpty: [...], auditEventId }` so the UI can render "what changed" + per-field UNDO.

New file (or extend): `server/src/services/knowledgebase-agent-tool-loop.js` — a KB tool loop modeled on `runAgentToolLoop`, importing the exported `startWorkspaceCollectedChat` + `parseWorkspaceActions` from `workspace-request-helpers.js` (both already exported) and executing against `KB_AGENT_TOOL_HANDLERS` (NOT the workspace handlers). Up to ~3 iterations. Uses the `runtimePolicy` from Phase 1. (If the Phase 2 spike shows `runAgentToolLoop` can be cleanly parameterized with an injected handler map without mutating the global workspace map, prefer that over a new file — see D-1.)

Edit: `server/src/services/knowledgebase-agent-context-service.js`:
- `buildKnowledgeBaseAgentSidebarSystemPrompt`: append the KB tool lines (`buildKbAgentToolLines()`), the `ACTION:` format instructions, and the autonomy rules (proactive=empty/flagged only + ask before overwrite; explicit=anything except status; after a successful `kb.updateDraft`, state exactly which fields changed). REMOVE the "propose only / Do not claim you saved" sentence.
- `answerKnowledgeBaseAgentQuestion`: replace the `runKnowledgeBaseAgentCompletion` (bare `claudeChat`) call with the KB tool loop call, passing `resolveKbAgentRuntimePolicy()` and the `recordId`/candidate so handlers are scoped. Continue to persist `kbAgentMessages` and the snapshot. Append a structured `appliedChanges` summary (from tool results) to the response payload so the client can show the changed-fields list + undo.

Edit: route `POST /api/knowledge/records/:recordId/agent-chat` (`server/src/routes/knowledge.js` ~line 196) — return value already spreads `...result`; ensure `appliedChanges` flows through. Add an UNDO route OR reuse the existing PATCH: since undo = re-applying prior values, the client can call existing `PATCH /api/knowledge/records/:recordId` with the prior values (which already requires review permission via `resolveKnowledgeActor(req)`). RECOMMENDED: reuse PATCH for undo (no new route); the agent-chat response carries `priorValues` per field. Confirm the client review permission path (dev defaults to admin via `defaultKnowledgeRole`).

Acceptance criteria:
- Asking the agent (sidebar) "fill in the customer goal" results in the field actually saved (verified by re-GET of the record) and the response lists the changed field + prior value.
- Proactive run does not overwrite a non-empty user-written field; it asks instead.
- The agent CANNOT change `reviewStatus`/publish/etc.: a crafted request to do so is rejected server-side and the field is unchanged.
- Provider/model from the Phase 1 picker is the one used (assert via the attempts/provider in the response or usage log) and failover is honored.

Tests (REQUIRED, target files):
- New `server/test/knowledgebase-agent-tools.test.js`: unit-test `kb.updateDraft` handler — (a) writes editable field via `updateKnowledgeRecord`, (b) returns priorValues, (c) proactive mode skips non-empty fields, (d) rejects `reviewStatus`/publish fields, (e) actor role `reviewer` cannot publish (assert `assertKnowledgePermission(actor,'publish')` throws). Use `mongodb-memory-server`.
- Extend `server/test/knowledge-management-routes.test.js` or add a route test for `agent-chat` returning `appliedChanges` (mock/stub the tool loop's chat orchestration so no real LLM call).

Risks: medium. The agent now writes to the DB. Mitigations: reviewer-role permission cap, field whitelist, proactive overwrite guard, audit events, undo via prior values. Loop-cost: cap iterations (3) and reuse the existing timeout/abort scaffolding.

### Phase 3 — Honest profile / prompt

Purpose: Make displayed contracts truthful.

Files:
- `prompts/agents/knowledgebase-agent.md`: add a "Sidebar / Tool Mode" section describing: reviews AND edits drafts via the `kb.*` tools; proactive completeness behavior (empty/flagged only, ask before overwrite); explicit-command behavior; source/evidence rules (already present); the human-gated boundary (no approve/publish/deprecate/redact); "after saving via the tool, state exactly which fields you changed." Keep the extraction section. Bump `PROMPT_VERSION` to `knowledgebase-agent-qbo-ca-v2`.
- `server/src/services/knowledgebase-agent-context-service.js`: (done in Phase 2) ensure the sidebar prompt mirrors the same truth and no longer says "propose only."
- Profile UI: NO new fabricated AGENT_META row. If a small honest surfacing is wanted, it should follow the agent-profiles-overhaul honesty pattern (show real tools list + real runtime + both prompts via existing prompt-store rendering). Defer any AgentsView change to the overhaul or do only an additive, real-data Harness/Tools panel if the overhaul has not landed.

Acceptance criteria:
- The rendered prompt for `knowledgebase-agent` describes its true edit capability and boundaries; the false "do not claim you saved" framing is gone everywhere.
- No fabricated capability/owner/trust data is introduced.

Tests: prompt-store snapshot/version check if one exists; otherwise manual verification + the existing prompt rendering tests.

Risks: low; coordinate wording with the agent-profiles-overhaul to avoid churn.

### Phase 4 — Startup + background (follow the workspace-scheduler pattern)

Purpose: KB agent does background work on startup/schedule like the briefing does.

Files:
- New `server/src/services/knowledgebase-agent-scheduler.js`: `startScheduler()/stopScheduler()` with a `setInterval` (e.g., hourly check), once-per-day guard, Mongo-ready guard, calling `scanKnowledgebaseAgent({ persistAttention:true, persistActivity:true })`. Mirror `workspace-scheduler.js` structure and logging. (Read-only proposal generation only in this phase.)
- `server/src/lib/startup-controls.js`: add `kbAgentScheduler: overrides.kbAgentScheduler ?? !parseBooleanEnv(env.DISABLE_KB_AGENT_SCHEDULER, false)`.
- `server/src/index.js`: in `onListening`, `if (startupControls.kbAgentScheduler) startKbAgentScheduler(); else console.log('[startup] KB agent scheduler disabled');`. In `shutdown()`, add `stopKbAgentScheduler()` next to `stopBriefingScheduler()`.

Acceptance criteria:
- On boot (default flags), the KB scan runs once and persists attention items; logs `[kb-agent-scheduler] ...` like the briefing.
- `DISABLE_KB_AGENT_SCHEDULER=1` disables it; shutdown stops the interval.

Tests: unit-test the scheduler `shouldRunNow`/guard logic (pure functions) like the workspace-scheduler approach; do not run real scans in tests.

Risks: low-medium. The scan already exists and is safe (read + attention items). NET-NEW-but-pattern-matched.

### Phase 5 (OPTIONAL, higher risk, default OFF) — Proactive auto-fill on schedule

Only after Phases 1-4 are validated. Have the scheduler (or a dedicated job) open drafts with empty/flagged fields and call `kb.updateDraft` in `proactive` mode (empty fields only, never overwrite, never status). Gate behind its own env flag default OFF. Requires the same audit/undo guarantees and a clear activity log. Flagged as higher-risk because it writes unattended.

---

## File-by-file change summary

- `client/src/lib/agentRuntimeSettings.js` — add `knowledgebase-agent` to `AGENT_RUNTIME_DEFINITIONS` (Phase 1).
- `server/src/services/knowledgebase-agent-context-service.js` — add `resolveKbAgentRuntimePolicy()` (P1); rewrite `buildKnowledgeBaseAgentSidebarSystemPrompt` to add tools + autonomy + remove false line (P2/P3); switch `answerKnowledgeBaseAgentQuestion` to the KB tool loop + return `appliedChanges` (P2).
- `server/src/services/knowledgebase-agent-tools.js` — NEW: `kb.readDraft`, `kb.searchKnowledgeBase`, `kb.checkCompleteness`, `kb.updateDraft` handlers + tool lines (P2).
- `server/src/services/knowledgebase-agent-tool-loop.js` — NEW (or parameterize `agent-tool-loop.js`): KB text-ACTION loop reusing `startWorkspaceCollectedChat` + `parseWorkspaceActions` (P2).
- `server/src/routes/knowledge.js` — ensure `appliedChanges`/`priorValues` flow through `agent-chat`; reuse PATCH for undo (P2).
- `prompts/agents/knowledgebase-agent.md` — add sidebar/tool-mode section, bump PROMPT_VERSION (P3).
- `server/src/services/knowledgebase-agent-scheduler.js` — NEW (P4).
- `server/src/lib/startup-controls.js` — add `kbAgentScheduler` flag (P4).
- `server/src/index.js` — start/stop the scheduler behind the flag (P4).
- Tests: `server/test/knowledgebase-agent-tools.test.js` (NEW), extend `server/test/agent-identities-registry.test.js`, extend `server/test/knowledge-management-routes.test.js`.

No server-side `agent-identity-service.js` change is required for the picker (verified: generic, keyed off `DEFAULT_PROFILES`).

---

## Risks (top)

1. Unattended/agent writes to governed knowledge. Mitigated by reviewer-role cap (no publish/deprecate/redact), `EDITABLE_TEXT_FIELDS` whitelist + explicit strip of status/publish/trust, proactive overwrite guard, audit events, undo via prior values. The crown-jewel boundary is enforced by the existing permission model, not just the prompt.
2. Tool-loop transport coupling. `runAgentToolLoop` mutates the global `WORKSPACE_TOOL_HANDLERS` map and uses workspace logging/verification. Reusing it directly for KB risks cross-contamination; a dedicated KB loop reusing only the exported chat/parse helpers is safer. Confirm in the Phase 2 spike.
3. Overlap with the in-progress agent-profiles-overhaul (the `AGENT_META` fabricated-data honesty refactor in `AgentsView.jsx`). Our Phase 3 must not add a fabricated AGENT_META row and should align wording with the overhaul. Coordinate before any AgentsView edit.

## Open questions for the user (minimally technical)

1. Proactive scope on startup: in Phase 4, should the agent only generate review items (safe, recommended first) or also auto-fill empty draft fields unattended (Phase 5, off by default)? Default plan: items only first.
2. Undo granularity: per-field undo (recommended) vs a single "undo all of this agent turn"? Plan assumes per-field.
3. When the agent edits, should the draft stay assigned to you for review (it always stays `draft` status — it can never approve), and do you want a visible "edited by Knowledge Base Agent" marker in the field list? Plan adds the changed-fields list; confirm you also want a persistent marker.
4. Default provider/model: keep the neutral app default + automatic failover when you have not picked one (recommended), or do you want to pick a specific primary now?

## Confirmations / things flagged as NOT fully verified

- The exact way `runAgentToolLoop` should be reused vs a new KB loop is a judgment call pending a short Phase 2 spike (D-1). Both are viable; default is the dedicated KB loop.
- Client review-permission for the undo PATCH relies on `defaultKnowledgeRole()` (admin in dev). In production this depends on the deployed `KNOWLEDGE_DEFAULT_ROLE`/headers; confirm the operator has at least reviewer for undo to work. Not independently verified for the user's prod config.
- I did not deep-read every line of `AgentsView.jsx` RuntimeSettingsPanel; the picker is confirmed generic via `AGENT_RUNTIME_DEFINITIONS`, but the exact render wiring should be eyeballed during Phase 1.
