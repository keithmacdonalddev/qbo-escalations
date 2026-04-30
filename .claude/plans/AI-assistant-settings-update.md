# Implementation Plan: AI Assistant Command Center Rebuild

**Slug:** `AI-assistant-settings-update`
**Created:** 2026-04-20
**Author:** Planning dialogue between user and Claude (Opus 4.7, 1M context)
**Status:** Draft — ready for implementation

---

## Problem

The AI Assistant Settings page today is a 2×2 grid of agent cards that hides the global model-default problem. Model pickers exist in 7+ places throughout the app (chat compose popover, workspace panel header, copilot panel header, image-parser panel, image-parser popup, and the settings page itself). Each picker writes directly and permanently to `localStorage`, overwriting whatever the user set elsewhere. There is no distinction between "default" (persist across sessions) and "override" (current session only). This matters to the user specifically because:

1. The user is a QBO escalation specialist advising phone agents in real-time — speed is critical.
2. The product is about to add a rapidly expanding roster of specialized agents, each of which needs independent model configuration.
3. Opus 4.6 is retired and Opus 4.7 was just released, but nothing in the app uses 4.7 yet.
4. Wiring between the settings page and the rest of the app's pickers is inconsistent — saving defaults in settings doesn't reliably propagate to the chat panel or workspace panel.

## In scope

**UI rebuild**
- Replace the 2×2 agent card grid in `AiAssistantSettingsPanel.jsx` with a compact data table: one row per registered agent. Table auto-grows as new agents are added in code (hybrid registry pattern).
- Columns (in order): **Agent | Provider | Model Override | Fallback Provider | Fallback Model | Mode | Reasoning Effort | System Prompt Override | Max Input Tokens | Max History Turns | Test**
- Each provider choice labeled with a **route badge**: `CLI`, `API`, or `LOCAL`.
- "Advanced" collapsible below the table holding the three existing accordions (Cost & Guardrails, Context & Retrieval, Memory & Debug), collapsed by default behind a single toggle.
- Capability-aware cells: disabled with "N/A" badge when the selected provider does not support the knob (e.g., reasoning effort is CLI-only for Claude/Codex; system prompt override available on all but validated per provider).

**Backend: new singleton defaults**
- New Mongoose model `AiDefaults` (singleton pattern, `_id: 'singleton'`, mirrors `UserPreferences.js`).
- New routes: `GET /api/ai-defaults` (returns full agent registry joined with singleton overrides + global settings + provider capabilities), `GET /api/ai-defaults/:agentId` (single-agent convenience), `PUT /api/ai-defaults` (full update, validated).
- Server lazily seeds the singleton from each agent's `preferredProvider` when a registered agent has no row yet.

**Default propagation (the "apply everywhere" contract)**
- New client hook `useAgentDefault(agentId)`: reads sessionStorage override first → falls back to the DB default from `/api/ai-defaults/:agentId`.
- Every in-app model picker (chat compose popover, workspace panel header, copilot panel header, image-parser panel, image-parser popup) rewired to use this hook.
- All session overrides write **only** to `sessionStorage` under key `qbo-session-override-<agentId>`. Nothing persists to `localStorage` or the server.
- Standalone server endpoints (`server/src/routes/chat/send.js`, `server/src/routes/workspace/ai.js`, `server/src/routes/copilot.js`) refactored to read provider/model from `AiDefaults` singleton when `req.body.provider` is not supplied — replacing the obsolete `aiSettings.providerStrategy` fallback. This is what makes "default applies everywhere" actually hold.

**Catalog migration (Opus 4.6 → Opus 4.7, plus route field, plus broader cleanup)**

Add new field `route: "cli" | "api" | "local"` to every catalog entry in `shared/ai-provider-catalog.json`.

Claude CLI route:
- **Add** `claude-opus-4-7` (model string `claude-opus-4-7`), mark `"default": true`, `route: "cli"`.
- **Keep** `claude-sonnet-4-6`, add `route: "cli"`.
- **Remove** legacy `claude` alias entry (points to retired opus-4-6).
- **Remove** explicit `claude-opus-4-6` entry.

Codex CLI route:
- **Keep/promote** `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-pro`, `gpt-5.4-nano`, `gpt-5-mini` with `route: "cli"`. Mark current default as `gpt-5.4` or `gpt-5.4-mini` per user preference (if unspecified, use `gpt-5.4-mini` as reasonable middle ground).
- **Remove** stale `chatgpt-5.3-codex-high` (superseded by 5.4 family).

Anthropic API route (NEW, `selectable: false` until `ANTHROPIC_API_KEY` is populated):
- **Add** `claude-haiku-4-5` entry with model string `claude-haiku-4-5-20251001`, `route: "api"`. (Exact ID verified against Anthropic's current API at implementation time.)
- **Remove** the stale `anthropic` entry that currently points to the retired `claude-sonnet-4-20250514`.

OpenAI API route (NEW, `selectable: false` until `OPENAI_API_KEY` is populated):
- **Add** `gpt-4.1-mini` with model string `gpt-4.1-mini`, `route: "api"`, mark as default OpenAI-API entry. (Confirmed non-deprecated: $0.40 in / $1.60 out / 1M ctx / vision.)
- **Add** `gpt-5.4-mini` with `route: "api"` (newer, $0.75 / $4.50 / 400K / vision).
- **Add** `gpt-5.4` with `route: "api"` (flagship, $2.50 / $15.00 / 1M+).
- **Add** `gpt-5.4-pro` with `route: "api"` (max performance, $30 / $180).
- **Add** `gpt-5.4-nano` with `route: "api"` (cheapest, $0.20 / $1.25 / 400K).
- **Remove** stale `gpt-4o` entry (superseded).

Gemini API route:
- **Keep** `gemini-3-flash-preview` (verified real against Google's current API docs at implementation time). Add `route: "api"`.
- Document as preview status in the `availabilityNote` field.

Kimi API route:
- **Keep** `kimi-k2.5` (verified real against Moonshot's current API docs at implementation time). Add `route: "api"`.

LM Studio route:
- **Keep** `lm-studio` entry. Add `route: "local"`.

LLM Gateway route:
- **Keep** `llm-gateway` entry (already correctly wired to the user's own `llm-gateway` project at `127.0.0.1:4100`). Add `route: "api"` (it is an HTTP API call, just targeting a local address).

**Agent migration to Opus 4.7**
- `server/src/services/room-agents/chat-agent-def.js` → `preferredProvider: 'claude-opus-4-7'`
- `server/src/services/room-agents/copilot-agent-def.js` → `preferredProvider: 'claude-opus-4-7'`
- `server/src/services/room-agents/workspace-agent-def.js` → `preferredProvider: 'claude-opus-4-7'`
- `server/src/services/room-agents/image-analyst-agent-def.js` → `preferredProvider: 'claude-opus-4-7'` (upgraded from sonnet — per user decision; revisit in TODO if too slow/expensive)
- `server/src/services/room-agents/router-agent-def.js` → `preferredProvider: 'claude-opus-4-7'` (upgraded from sonnet — same caveat)
- `server/src/services/room-agent-runtime.js` → update `FALLBACK_ROOM_AGENT_PROVIDERS` table to 4.7 for chat/workspace/copilot, keep image-analyst on 4.7

**Pricing**
- `server/src/lib/pricing.js` → add `claude-opus-4-7: { inputNanosPerToken: 5000, outputNanosPerToken: 25000 }` (same as 4.6 per user direction).
- Remove `claude-opus-4-6` pricing row.
- Add pricing rows for every NEW catalog entry (Haiku 4.5, GPT-4.1-mini, GPT-5.4-mini, GPT-5.4, GPT-5.4-pro, GPT-5.4-nano) using prices verified in the April 2026 research report.

**Dead code removal**
- Delete `client/src/components/AiAssistantProviderStrategyPanel.jsx` (unmounted).
- Delete `client/src/components/AiAssistantOverviewPanel.jsx` (stub returning null).
- Delete `client/src/components/AiAssistantSurfaceSelectors.jsx` (stub returning null).
- Remove `providerStrategy` sub-object from `DEFAULT_AI_SETTINGS` in `client/src/lib/aiSettingsStore.js` (now obsolete — standalone endpoints read from `AiDefaults` singleton).

**TODO file creation**
- Create `TODOS/ai-command-center-future.md` with deferred items listed in the "Deferred" section below.

**System prompt override semantics**
- The per-agent "System Prompt Override" text field, when non-empty, is **APPENDED** to the agent's built-in `buildContext()` system prompt at request time. Never prepends. Never replaces.

## Out of scope (explicit)

- Temperature / Max Tokens / Thinking columns — deferred to TODO (CLI providers don't accept them and HTTP providers need multi-file service refactors; not worth the effort for this phase).
- Adding new agents via the UI — engineers drop `*-agent-def.js` files in code; UI auto-picks them up.
- Per-user defaults or authentication — the app is single-user today; `AiDefaults` is a global singleton.
- Cost forecasting / budget enforcement redesign.
- Changes to the Claude CLI subprocess architecture.
- Full DB-driven agent registry (agents defined entirely in DB including prompts/tools) — deferred.
- Table search / filter / sort / grouping / bulk-edit — deferred.
- Server-side audit log of default changes — deferred (relevant post-auth).

## End-to-end data flow

1. User opens AI Assistant Settings. Client calls `GET /api/ai-defaults`.
2. Server walks the agent code registry (`server/src/services/room-agents/*.js` + image-parser), reads the `AiDefaults` singleton from Mongo, merges them, returns `{ ok: true, agents: [...], providerCapabilities: {...}, globalSettings: {...} }`. For agents with no DB row yet, the response payload is seeded from each agent-def's `preferredProvider`.
3. Client renders the data table. All edits held in local React state (unsaved draft).
4. User clicks Save → `PUT /api/ai-defaults` with the full agent config payload. Server validates every agent's provider ID exists in the catalog and every knob fits the provider's capabilities. Rejects with typed error code on failure. On success, writes the singleton and returns `{ ok: true }`.
5. Elsewhere in the app, a chat/workspace/copilot/image-parser panel mounts and calls `useAgentDefault(agentId)`. The hook checks `sessionStorage['qbo-session-override-<agentId>']` — if present, that's the effective provider/model. If absent, hook fetches `GET /api/ai-defaults/:agentId` and uses the DB default.
6. User changes the model via the panel's picker → the new value is written to `sessionStorage['qbo-session-override-<agentId>']` only. Neither `localStorage` nor the server is touched.
7. Reloading the tab preserves `sessionStorage`, so the override persists across reloads within the same tab. Opening a new browser tab gives a fresh sessionStorage and therefore a clean slate — pickers revert to DB defaults.
8. When the user makes a chat/workspace/copilot request, if the client sends `provider`/`model` in the body, the server uses those. If the body does not include them, the route handler falls back to `AiDefaults.get().agents[agentId]` — NOT to the old `aiSettings.providerStrategy` path.

## Files

### Create

- `server/src/models/AiDefaults.js` — Mongoose singleton model, schema `{ _id: 'singleton' default, agents: Map<agentId, agentConfig>, updatedAt: Date }`. Statics: `.get()` returns singleton or lazily creates, `.upsert(payload)` writes.
- `server/src/routes/ai-defaults.js` — routes: `GET /` (full registry + singleton + capabilities), `GET /:agentId` (single agent), `PUT /` (full update). Validates against catalog before writing. Returns typed error codes.
- `server/src/services/providers/capabilities.js` — helpers: `supportsReasoningEffort(catalogId)`, `supportsSystemPromptOverride(catalogId)`, `getRoute(catalogId)`, `getCapabilityBadge(catalogId, knob)`. Reads from the catalog's new capability fields.
- `client/src/hooks/useAgentDefault.js` — reads `sessionStorage['qbo-session-override-<agentId>']` → fetched default from `/api/ai-defaults/:agentId`. Exposes `{ provider, model, fallbackProvider, fallbackModel, mode, reasoningEffort, isOverride, resetToDefault() }`.
- `client/src/hooks/useAiDefaults.js` — fetch + mutate for the command-center table. Handles optimistic updates, loading/error/empty states.
- `client/src/lib/sessionModelOverride.js` — typed read/write helpers for `sessionStorage` per-agent keys.
- `client/src/components/AiCommandCenterTable.jsx` — the new data table component with all 11 columns, capability-aware cell rendering, and route badges on provider options.
- `TODOS/ai-command-center-future.md` — deferred items listed in the "Deferred" section.

### Modify

- `shared/ai-provider-catalog.json` — the catalog migration described in the In-Scope section (Claude/Codex CLI, new Anthropic API, new OpenAI API entries, Gemini/Kimi unchanged but verified, new `route` field, capability flags).
- `server/src/lib/pricing.js` — add pricing for Opus 4.7, Haiku 4.5, gpt-4.1-mini, gpt-5.4-mini, gpt-5.4, gpt-5.4-pro, gpt-5.4-nano. Remove Opus 4.6 row.
- `server/src/services/room-agents/chat-agent-def.js` — preferredProvider → opus-4-7.
- `server/src/services/room-agents/copilot-agent-def.js` — same.
- `server/src/services/room-agents/workspace-agent-def.js` — same.
- `server/src/services/room-agents/image-analyst-agent-def.js` — same.
- `server/src/services/room-agents/router-agent-def.js` — same.
- `server/src/services/room-agent-runtime.js` — `FALLBACK_ROOM_AGENT_PROVIDERS` table → opus-4-7.
- `server/src/services/room-orchestrator.js` — router invocation uses resolved opus-4-7.
- `server/src/routes/chat/send.js` — default-provider fallback reads from `AiDefaults` singleton (not `aiSettings.providerStrategy`).
- `server/src/routes/workspace/ai.js` — same fallback refactor.
- `server/src/routes/copilot.js` — same fallback refactor.
- `server/src/index.js` — mount `ai-defaults` route.
- `client/src/components/AiAssistantSettingsPanel.jsx` — replace 2×2 grid with `<AiCommandCenterTable />`. Keep Advanced collapsible below table housing the 3 existing accordions behind a single toggle.
- `client/src/hooks/useChat.js` — replace direct localStorage reads with `useAgentDefault('chat')`.
- `client/src/hooks/useWorkspaceAgentRuntime.js` — same for `'workspace'`.
- `client/src/components/CopilotPanel.jsx` — same for `'copilot'`.
- `client/src/components/ImageParserPanel.jsx` — same for `'image-parser'`.
- `client/src/components/chat/ImageParserPopup.jsx` — same for `'image-parser'`.
- `client/src/components/chat/ChatComposeControls.jsx` — on picker change, write ONLY to sessionStorage.
- `client/src/components/WorkspaceAgentPanel.jsx` — same.
- `client/src/lib/aiSettingsStore.js` — remove `providerStrategy` sub-object from `DEFAULT_AI_SETTINGS`. Update reader helpers accordingly.
- `client/src/lib/providerCatalog.js` — ensure default resolution works post-catalog-edit; thread new `route` field through to consumers.
- `server/src/services/providers/catalog.js` — same as above on the server side.
- `server/test/pricing.test.js` — update 3 assertions (lines 131, 188, 239) from opus-4-6 to opus-4-7.
- `server/test/provider-usage-contract.test.js` — update 2 mock-event assertions (lines 317, 325) from opus-4-6 to opus-4-7.
- `server/.env.example` — no behavior change; verify `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` rows still exist as empty-placeholder entries.

### Delete

- `client/src/components/AiAssistantProviderStrategyPanel.jsx` (unmounted dead code)
- `client/src/components/AiAssistantOverviewPanel.jsx` (stub)
- `client/src/components/AiAssistantSurfaceSelectors.jsx` (stub)

## Acceptance criteria

Each statement is yes/no verifiable. Implementation is complete when all criteria pass.

1. The AI Assistant Settings page renders a single data table with exactly one row per registered agent — today that is six rows: `chat`, `copilot`, `workspace`, `image-analyst`, `__router`, `image-parser`.
2. The table columns appear in this order: Agent | Provider | Model Override | Fallback Provider | Fallback Model | Mode | Reasoning Effort | System Prompt Override | Max Input Tokens | Max History Turns | Test.
3. When a provider does not support a given knob, the corresponding cell renders a disabled control with an "N/A" badge tooltip explaining why.
4. Every option in every Provider/Fallback Provider dropdown includes a route badge: `CLI`, `API`, or `LOCAL`, rendered visibly next to the model label.
5. `shared/ai-provider-catalog.json` contains a `route` field on every entry, with valid values `"cli" | "api" | "local"`.
6. Every model in `shared/ai-provider-catalog.json` has capability flags: at minimum `supportsReasoningEffort` and `supportsSystemPromptOverride`. Values are sourced from each provider's official documentation at implementation time (citation comment in the catalog JSON or companion note file).
7. Clicking Save persists the full agent-config payload to the `AiDefaults` Mongo singleton via `PUT /api/ai-defaults`. Server returns `{ ok: true }`.
8. After saving a new default and hard-refreshing the entire app in a fresh browser tab, every in-app model picker (chat compose popover, workspace panel header, copilot panel header, image-parser panel, image-parser popup) initializes to the new default.
9. Changing the model in any in-app picker writes ONLY to `sessionStorage['qbo-session-override-<agentId>']`. Inspecting `localStorage` and the server after the change shows no new writes.
10. Opening a NEW browser tab with the app URL resets all pickers to the DB default. Reloading the SAME tab preserves the sessionStorage override.
11. `shared/ai-provider-catalog.json` contains `claude-opus-4-7` as the sole entry with `"default": true`. The legacy `claude` alias entry and the explicit `claude-opus-4-6` entry are absent.
12. `shared/ai-provider-catalog.json` contains the following new entries with `selectable: false` (or matching user-configured selectability): `claude-haiku-4-5`, `gpt-4.1-mini`, `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-nano`, each with `route: "api"`.
13. The stale `anthropic` catalog entry pointing to `claude-sonnet-4-20250514` has been replaced by `claude-haiku-4-5` as described. The stale `gpt-4o` entry has been replaced by the GPT-4.1/5.4 API entries. The stale `chatgpt-5.3-codex-high` entry has been removed.
14. `server/src/lib/pricing.js` contains a `claude-opus-4-7` entry at `{ inputNanosPerToken: 5000, outputNanosPerToken: 25000 }` and no `claude-opus-4-6` entry. Pricing rows exist for every new catalog entry listed in AC-12, with values verified against vendor pricing pages at implementation time.
15. Grepping `server/src/` for the exact string `claude-opus-4-6` returns zero hits.
16. Running `npm --prefix server test` passes with no failures. The five updated test assertions (3 in `pricing.test.js`, 2 in `provider-usage-contract.test.js`) reference `claude-opus-4-7` and pass.
17. `server/src/routes/chat/send.js`, `server/src/routes/workspace/ai.js`, and `server/src/routes/copilot.js` resolve their default provider via the `AiDefaults` singleton when `req.body.provider` is absent. Verified by reading the handler code AND by observing in server logs that a request with no provider in the body matches the DB default agent config.
18. `client/src/components/AiAssistantProviderStrategyPanel.jsx`, `AiAssistantOverviewPanel.jsx`, and `AiAssistantSurfaceSelectors.jsx` are deleted. Grepping `client/src/` for any of these filenames returns zero hits.
19. When the server boots and an agent in the code registry has no corresponding row in the `AiDefaults` singleton, `GET /api/ai-defaults` returns that agent's config seeded from the agent-def's `preferredProvider` field.
20. The Advanced section below the table contains the three existing accordions (Cost & Guardrails, Context & Retrieval, Memory & Debug) behind a single collapsible "Advanced" toggle, collapsed by default.
21. The `providerStrategy` sub-object has been removed from `DEFAULT_AI_SETTINGS` in `client/src/lib/aiSettingsStore.js`. Grepping `client/src/` for `providerStrategy` returns zero hits.
22. `TODOS/ai-command-center-future.md` exists and lists all items in the Deferred section below with one-line descriptions each.
23. System prompt override text for any agent is APPENDED (not prepended, not replaced) to the agent's built-in `buildContext()` system prompt at request time. Verified by inspecting one agent-def and reading the implemented request path.
24. The "Test" button in each row fires `POST /api/agents/test-model` using that row's current (possibly unsaved) config and displays pass/fail plus round-trip latency in milliseconds inline.
25. If, at implementation time, a test request to the Gemini preview or Kimi model fails against live APIs, implementation STOPS and flags the user for direction rather than silently substituting a different model.

## Risks & edge cases

1. **Stale agentId in DB** (e.g., an agent file was deleted in code but its row still exists in the singleton) — server filters the `GET` response to currently-registered agents only. Stale DB entries are ignored but not deleted, preserving override history in case the agent is re-added later.
2. **PUT validation rejects bad input** — every provider ID must exist in the catalog; every knob must be supported by that provider's capability flags. Rejection uses typed error codes: `UNKNOWN_AGENT`, `UNKNOWN_PROVIDER`, `CAPABILITY_MISMATCH`, `VALIDATION_FAILED`. Response shape matches the app's `{ ok: false, code, error }` contract.
3. **sessionStorage is per-tab** — users may not understand this. Mitigation: every in-app picker renders a small "Session override active" badge with a reset-to-default button when sessionStorage has a value for that agentId. Tooltip explains "Resets when you open a new tab."
4. **Default flip mid-request** — if a user saves a new default while a chat request is in flight, the in-flight request keeps the model it started with. Only new sessions pick up the new default.
5. **Capability flag drift** — provider vendors may add new knobs or deprecate old ones. Mitigation: capability flag values in `shared/ai-provider-catalog.json` include a citation comment pointing to the source provider-doc URL. Skill-audit or periodic manual review catches drift.
6. **Non-selectable models** — the catalog has entries with `selectable: false` (e.g., API entries before keys land). The table's provider dropdown filters these out automatically.
7. **Router breaking under bad model** — if a user picks a model that can't reliably return JSON, the router's 15s timeout kicks in and the orchestrator falls back to responding with all agents. The existing timeout behavior is preserved. Log lines surface the fallback so it can be diagnosed.
8. **Empty `AiDefaults` on first boot** — Mongo singleton doesn't exist on a fresh DB. `GET /api/ai-defaults` must lazily create it by reading each agent's `preferredProvider` into a default payload. Must not crash.
9. **Preview model drift (Gemini/Kimi)** — both use preview-tier model IDs that can break or change without notice. Implementation runs a live test request to each preview model before marking the migration complete. If either fails, implementation STOPS and flags the user (per the user's explicit direction — no silent auto-fallback).
10. **Claude CLI subprocess knob mismatch** — the `claude -p` CLI supports `--model` and `--effort` only. It does NOT support `--temperature` or `--max-tokens`. If the table UI ever exposes those columns in a future phase, Claude rows must show "N/A (CLI)".
11. **Long-lived tab with stale sessionStorage override** — a tab left open for days continues to honor its sessionStorage override. That is by design. Documented in the UI badge tooltip.
12. **Claude API vs Claude CLI for the same model** — once the user has an Anthropic API key, the catalog will contain two entries for the same underlying Claude model (CLI route and API route). The `route` field and the UI badge prevent silent confusion. Server request routing dispatches based on the catalog entry's `transport`/`route` fields, not the model string alone.
13. **LLM Gateway port collision** — `llm-gateway` project runs on port 4100 by default, which matches qbo-escalations' default `LLM_GATEWAY_API_URL`. If the user's port conflicts with another service (unlikely given existing setup), override via env var. No code change needed.
14. **Agent migration leaves trailing references** — if a grep for `claude-opus-4-6` finds anything outside `server/src/` (e.g., in docs, FEATURES.md, or other project files), the user is notified, but AC-15 only blocks on `server/src/` cleanup. Non-code references are surfaced for user judgment.

## Exceeds bar (concrete, not aspirational)

- **Route badges on every picker option** — not just in the settings table but on every in-app model picker popover (chat, workspace, copilot, image-parser). Users always know if they're choosing a CLI, API, or LOCAL route.
- **"Session override active" indicator** on every in-app picker — small pill-style badge with a reset-to-default button. Tooltip explains the per-tab lifetime.
- **Customization indicator in the settings table** — a row is visually marked (subtle shading, or a "Custom" pill) when that agent's DB config differs from the agent-def's code-level `preferredProvider`. Lets the user see at a glance which agents have been customized.
- **Test button shows latency in ms** — not just pass/fail. Gives the user an immediate read on which models are faster.
- **Loading, empty, and error states on the table** — with actionable error text ("Couldn't reach the backend on port 4000 — check that `npm run dev:server` is running").
- **Typed error codes on the new API routes** — `UNKNOWN_AGENT`, `UNKNOWN_PROVIDER`, `CAPABILITY_MISMATCH`, `VALIDATION_FAILED` — so future client handlers can branch on `code` without regex-matching error strings.
- **Cleanup of three dead components** + `providerStrategy` obsolete sub-object — this codebase's future maintainers won't have to wonder why those exist.
- **`TODOS/ai-command-center-future.md` written alongside the implementation** — deferred items live in the repo, not in conversational memory that will be lost.
- **Capability-flag citations** — every flag value in the catalog JSON carries a citation comment linking to the vendor doc that sourced it. Drift detection becomes trivial.

## Deferred items (go in `TODOS/ai-command-center-future.md`)

- **Full DB-driven agent registry** — agents defined entirely in the DB, including system prompts and tool definitions. UI could add new agents without code changes. Not now because it's a significant architectural shift and the risk of letting users accidentally break agents via bad prompts is high.
- **Table enrichments** — search by agent name or provider, column sort, row grouping (user-facing vs. internal agents), bulk-edit ("set all to opus-4-7"). Defer until the table has enough rows to warrant it.
- **Temperature column** — requires wiring through `lm-studio.js`, `remote-api-providers.js`, and the service-level request builders for 4 providers. Defer until there's at least one agent that specifically benefits from per-agent temperature control.
- **Max Tokens column** — same dependency chain as Temperature.
- **Thinking column** — mostly relevant to Anthropic and Google models; LM Studio already hardcodes it off. Defer until relevant.
- **System prompt override mode toggle** — append vs. prepend vs. replace. Defer until at least one user hits the limitation of append-only.
- **Revisit `opus-4-7` for router and image-analyst** — opus is overkill for routing/OCR. If latency or cost becomes noticeable, demote back to `claude-sonnet-4-6`.
- **Server-side audit log of default changes** — who changed what and when. Relevant only after authentication lands.
- **Catalog capability-flag drift detection** — periodic script that fetches vendor docs and flags entries whose capability flags are out of date.
- **Bulk import/export of agent configs** — JSON or YAML file to snapshot and restore all agent defaults at once.

## Dependencies and sequencing

No hard external dependencies. Ordering for cleanest rollout:

1. **Opus 4.6 → 4.7 migration and catalog updates** — smallest blast radius, independently verifiable. Includes: catalog entries (remove 4.6, add 4.7, add API-route entries, add `route` field, add capability flags), pricing rows, agent-def `preferredProvider` updates, `FALLBACK_ROOM_AGENT_PROVIDERS` table, router orchestrator reference, 5 test-fixture assertions.
2. **Backend: `AiDefaults` model + routes** — new Mongoose model, new routes mounted in `server/src/index.js`. Server restart required. No client changes yet.
3. **Backend: standalone endpoint refactor** — `chat/send.js`, `workspace/ai.js`, `copilot.js` switch to reading from `AiDefaults` singleton. Adds a risk of affecting existing chat requests; test carefully.
4. **Client: `useAgentDefault` hook + sessionStorage lib** — no UI changes yet, just plumbing.
5. **Client: rewire existing in-app pickers** — chat compose, workspace panel header, copilot panel header, image-parser panel, image-parser popup. Each becomes a consumer of `useAgentDefault`. Each picker's on-change writes sessionStorage only.
6. **Client: rebuild settings page as command-center table** — biggest UI change, last. Includes route badges, capability-aware cells, test button wiring, Advanced collapsible.
7. **Delete dead code** — three stale components, the `providerStrategy` sub-object.
8. **Write `TODOS/ai-command-center-future.md`.**

## Testing strategy

- **Unit:** `AiDefaults` model statics (`.get()`, `.upsert()` including lazy-seed behavior). `capabilities.js` helpers given representative catalog fixtures.
- **Route:** `GET /api/ai-defaults` lazy-seed on first call. `PUT` validates provider IDs and capability fit, rejects with typed codes. `GET /api/ai-defaults/:agentId` handles unknown agentId gracefully.
- **Integration:** send a chat request to `/api/chat/send` with no `provider` in the body — verify the resolved provider matches the `AiDefaults` singleton entry for agentId `chat`. Repeat for workspace and copilot routes.
- **Update 5 existing test assertions** (3 in `pricing.test.js`, 2 in `provider-usage-contract.test.js`) from opus-4-6 to opus-4-7.
- **Provider live-test via agent-browser:** after implementation, open the app at `localhost:5174`, open settings, click the Test button on each row. Expect pass for Claude CLI (opus-4-7, sonnet-4-6), Gemini, Kimi, LM Studio (if running), LLM Gateway (if running). Expect pass-or-skip for API providers requiring keys (Anthropic API, OpenAI API) — these will either test successfully if a key is configured or show a clear "API key required" error.
- **Default-propagation manual verification:** change a default in settings → hard-refresh in a fresh tab → confirm each in-app picker (chat, workspace, copilot, image-parser) shows the new default. Override a picker → reload the tab (override preserved). Open a new tab (default restored).
- **Skip tests for:** trivial JSX changes, localStorage→sessionStorage string swaps, style-only changes, and the catalog JSON edits themselves (covered by the contract test).

---

## Plan meta

- Acceptance criteria: **25**
- Files to create: **8**
- Files to modify: **22**
- Files to delete: **3**
- Risks identified: **14**
- Deferred items: **10**
