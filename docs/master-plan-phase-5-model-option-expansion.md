# Phase 5 Master Plan: Model Option Expansion (Keep 2-Lane Parallel)

## Mission
Add two new end-to-end selectable options across Chat and Dev Mode:
1. `claude-sonnet-4-6`
2. `gpt-5-mini`

Keep current orchestration behavior unchanged:
1. `single`
2. `fallback`
3. `parallel` with exactly two providers (`primaryProvider` + `fallbackProvider`)

## Current State (Code-Validated)
1. Provider IDs are hardcoded to two values in registry and model enums.
2. Frontend provider options are hardcoded in Chat and Dev Mode components/hooks.
3. Parallel orchestration assumes two providers in both chat and parse.
4. Dev session resume logic is tied to exact provider ID `claude`, not provider family.

## Scope

### In Scope
1. Add provider IDs `claude-sonnet-4-6` and `gpt-5-mini` to backend validation and schemas.
2. Add both options to Chat and Dev Mode selectors.
3. Preserve all existing routes and payload shapes.
4. Preserve current two-lane parallel behavior.
5. Add regression tests for provider acceptance and persistence.

### Out of Scope
1. N-way parallel (3 to 4 providers at once).
2. New endpoints.
3. Usage/cost instrumentation.

## API Contract Changes (Exact)

### Changed: Accepted Provider Values
Affected request fields:
1. `provider`
2. `primaryProvider`
3. `fallbackProvider`

New accepted values:
1. `claude`
2. `claude-sonnet-4-6`
3. `chatgpt-5.3-codex-high`
4. `gpt-5-mini`

Affected endpoints:
1. `POST /api/chat`
2. `POST /api/chat/retry`
3. `POST /api/chat/parse-escalation`
4. `POST /api/escalations/parse`
5. `POST /api/dev/chat`

### Unchanged Contracts
1. No new fields are required.
2. SSE event names and payload structure remain unchanged.
3. Parallel mode remains two-lane only.

## Data and Schema Changes
1. Expand provider enums in:
   - `Conversation`
   - `DevConversation`
   - `ParallelCandidateTurn`
2. No document migration required because existing values remain valid.
3. No index migration required.

## File-Level Work Plan

### Backend
- [ ] Update provider registry and labels in [server/src/services/providers/registry.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/services/providers/registry.js)
  - Add provider defs for `claude-sonnet-4-6` and `gpt-5-mini`.
  - Add provider metadata `family` (`claude` or `codex`) and model identifier.
  - Keep default provider unchanged.
- [ ] Update CLI service plumbing in [server/src/services/claude.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/services/claude.js) and [server/src/services/codex.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/services/codex.js)
  - Accept optional model override via options.
  - Apply model override in chat and parse calls.
- [ ] Make Dev route provider-family aware in [server/src/routes/dev.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/routes/dev.js)
  - Replace exact-ID checks for Claude session resume with family-based checks.
  - Keep fallback semantics unchanged.
- [ ] Expand enums in model files:
  - [server/src/models/Conversation.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/models/Conversation.js)
  - [server/src/models/DevConversation.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/models/DevConversation.js)
  - [server/src/models/ParallelCandidateTurn.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/models/ParallelCandidateTurn.js)

### Client
- [ ] Add new provider options in [client/src/components/Chat.jsx](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/Chat.jsx)
- [ ] Add new provider options in [client/src/components/DevMode.jsx](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/DevMode.jsx)
- [ ] Expand provider allowlists and fallback normalization in:
  - [client/src/hooks/useChat.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/hooks/useChat.js)
  - [client/src/hooks/useDevChat.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/hooks/useDevChat.js)
- [ ] Add provider labels in [client/src/components/ChatMessage.jsx](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/ChatMessage.jsx)

### Tests
- [ ] Add backend integration coverage in [server/test/integration-routes.test.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/test/integration-routes.test.js)
  - Provider validation accepts new IDs.
  - Chat/retry/parse routes accept and persist new IDs.
- [ ] Add/extend Dev helper tests in [server/test/dev-route-helpers.test.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/test/dev-route-helpers.test.js)
  - Claude-family session behavior works for `claude-sonnet-4-6`.
- [ ] Add orchestrator unit coverage in [server/test/chat-orchestrator.test.js](/C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/test/chat-orchestrator.test.js)
  - Fallback and parallel with expanded provider set remain deterministic.

## Implementation Tickets

### Backend Tickets
1. `P5-BE-01` Registry Expansion
   - Files: `server/src/services/providers/registry.js`
   - Deliverables: new provider defs, labels, family metadata.
   - Acceptance: route-level provider validation accepts 4 IDs.
2. `P5-BE-02` CLI Model Override Support
   - Files: `server/src/services/claude.js`, `server/src/services/codex.js`
   - Deliverables: optional model override for chat and parse.
   - Acceptance: selected provider uses expected model path.
3. `P5-BE-03` Dev Family Logic
   - Files: `server/src/routes/dev.js`
   - Deliverables: family-based session resume behavior.
   - Acceptance: Claude-family providers can resume; Codex-family cannot.
4. `P5-BE-04` Enum Expansion
   - Files: `server/src/models/Conversation.js`, `server/src/models/DevConversation.js`, `server/src/models/ParallelCandidateTurn.js`
   - Deliverables: enums updated without breaking existing data.
   - Acceptance: create/update docs with all 4 provider values.

### Client Tickets
1. `P5-FE-01` Chat Provider UI Expansion
   - Files: `client/src/components/Chat.jsx`, `client/src/hooks/useChat.js`
   - Deliverables: 4 selectable providers, stable fallback behavior.
   - Acceptance: user can run single/fallback/parallel with any allowed pair.
2. `P5-FE-02` Dev Provider UI Expansion
   - Files: `client/src/components/DevMode.jsx`, `client/src/hooks/useDevChat.js`
   - Deliverables: 4 selectable providers with stable session behavior.
   - Acceptance: dev chat works for all providers.
3. `P5-FE-03` Provider Labeling
   - Files: `client/src/components/ChatMessage.jsx`
   - Deliverables: readable labels for new provider IDs.
   - Acceptance: rendered badges match selected provider.

### Test Tickets
1. `P5-TEST-01` Route Contract Regression
   - Files: `server/test/integration-routes.test.js`
   - Acceptance: no 400 for valid new provider IDs.
2. `P5-TEST-02` Dev Resume Regression
   - Files: `server/test/dev-route-helpers.test.js`
   - Acceptance: family-based session behavior validated.
3. `P5-TEST-03` Orchestrator Regression
   - Files: `server/test/chat-orchestrator.test.js`
   - Acceptance: all existing mode semantics preserved.

## Migration and Rollout Steps
1. Merge backend changes first (registry, services, routes, schemas, tests).
2. Deploy backend and run smoke tests with old provider IDs.
3. Run smoke tests with new provider IDs.
4. Merge and deploy client selector updates.
5. Validate end-to-end from UI for chat/dev with each provider.
6. Keep rollback simple: hide new options in UI if needed; backend remains backward compatible.

## Verification Checklist
- [ ] `npm --prefix server test` passes.
- [ ] `npm run build` passes.
- [ ] Chat single mode works with all 4 providers.
- [ ] Chat fallback mode works across mixed families.
- [ ] Chat parallel mode still runs exactly 2 lanes.
- [ ] Dev mode works with all 4 providers.
- [ ] No schema validation regressions on old conversations.

## Exit Criteria
1. New providers are selectable in Chat and Dev Mode.
2. All affected APIs accept and persist new provider IDs.
3. Existing two-lane parallel semantics remain unchanged.
4. Test suite passes with new and legacy provider values.

