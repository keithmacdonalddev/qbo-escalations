# Agent Mission Control — UI surface map

## Entry point

- Route registration: `client/src/lib/appRoute.js:67-68` registers `/agents` (list) and `/agents/:agentId` (profile) under hash routing.
- Lazy-loaded component: `client/src/App.jsx:28` loads `client/src/components/AgentsView.jsx` for both routes.
- Single component, 3530 lines, file: `client/src/components/AgentsView.jsx`.
- Branded as "Agent Mission Control" in the UI header (`AgentsView.jsx:1373`).

## Modes

`AgentsView` runs in two modes off a single component:
- **List mode** (`#/agents`) — grid/list/map of all registered agents with filters by status, department, risk, review status. Stats header (totals, active, human-reviewed, needs-attention, avg trust).
- **Profile mode** (`#/agents/:agentId`) — full per-agent detail at `AgentProfileDetailPage` (`AgentsView.jsx:1308`). The same component handles both via the `agentIdFromRoute` prop.

## Profile tabs

`PROFILE_TABS` at `AgentsView.jsx:61-71`:
1. Overview
2. Configuration
3. Prompt
4. Harness
5. Workflows
6. Activity
7. Event Streams
8. Chat Sessions
9. Versions

For the escalation-template-parser only, `IMAGE_PARSER_PROFILE_TABS` at `AgentsView.jsx:73-77` inserts an extra **Test Results** tab between Harness and Workflows.

## Prompt tab — what the user can actually do

Surface at `AgentsView.jsx:2007-2092` (`AgentPromptTab`):
- Loads the live markdown via `getAgentPrompt(promptId)` → `GET /api/agent-prompts/:id` (`server/src/routes/agent-prompts.js:151`).
- Renders the raw prompt in a `<textarea className="prompt-editor">` — the user edits it inline.
- Saves via `updateAgentPrompt(promptId, content, label)` → `PUT /api/agent-prompts/:id` (`server/src/routes/agent-prompts.js:167`). Optional change-summary label sent with the save.
- Versions are listed in a side panel; clicking a version previews the snapshot; a "Restore into editor" button re-loads it into the textarea (not direct restore — that uses a separate restore route below).
- "Reload" button re-fetches from disk.

Agents whose definition has no `promptId` show "No editable prompt" empty state (`AgentsView.jsx:2016-2017`).

## Versions

- List: `GET /api/agent-prompts/:id/versions` → returns `{ ts, size, label }` array sorted newest-first (`routes/agent-prompts.js:25-49`).
- Read one: `GET /api/agent-prompts/:id/versions/:ts` returns content (`routes/agent-prompts.js:99-115`).
- Restore: `POST /api/agent-prompts/:id/restore/:ts` (`routes/agent-prompts.js:117-149`) snapshots current, writes the older snapshot in place, fires an audit log entry.
- Cap: 20 snapshots per id (`MAX_VERSIONS` at `routes/agent-prompts.js:19`); oldest pruned on overflow.

## Harness tab

Surface at `AgentsView.jsx:2096-2136` (`AgentHarnessTab`). Shows:
- A static "Harness Summary" panel driven by hardcoded `AGENT_OPERATION_META` at `AgentsView.jsx:84-205` (department, owner, harness type, latency target — these are display-only, not driven by runtime).
- A "Runtime Provider Matrix" — provider/model/reasoning-effort selectors that persist to the per-agent runtime defaults (`PATCH /api/agent-identities/:id/runtime`).
- A "Harness Checks" grid that consumes a hardcoded `operation.harnessChecks` array — currently display-only stubs.

There is no in-UI test-runner / sandbox / playground from this tab — the user cannot send a sample image and watch the harness execute. That capability lives in the chat surface's `ImageParserPopup` (`client/src/components/chat/ImageParserPopup.jsx`).

## Test Results tab (escalation-template-parser only)

Surface at `AgentsView.jsx:2138-2222` (`ImageParserTestResultsTab`). Reads from the `ImageParserTestResult` collection (`server/src/models/ImageParserTestResult.js`):
- Aggregate stats (total, pass rate, avg elapsed, by provider / model / fixture).
- Recent runs with image thumbnail + provider/model/effort/elapsed/9-label-pass plus a Pass/Fail review button per row.
- This is the closest thing to a harness regression dashboard — but rows are created by users running the parser from chat and then tagging the result pass/fail, not by an automated test bed.

## Test result lifecycle

- The `ImageParserPopup` (`client/src/components/chat/ImageParserPopup.jsx`) is the in-chat parse popup. It defaults to `escalation-template-parser` (`ImageParserPopup.jsx:30`).
- After a parse, the result lands in `ImageParseResult`; some entries also surface as `ImageParserTestResult` via the test-runner route at `server/src/routes/pipeline-tests.js`.

## What is the harness, in UI terms

Today the UI treats "the harness" as: prompt text + provider runtime defaults + a results audit. The user can:
- View the harness prompt (yes — Prompt tab).
- Edit the harness prompt (yes — Prompt tab textarea).
- Snapshot versions (yes — automatically on every save, plus manual labels).
- Restore versions (yes — Restore button).
- Configure default provider/model/reasoning effort per agent (yes — Harness tab, Runtime Provider Matrix).
- Run a one-off test against the harness (no — must be done from chat's `ImageParserPopup`).
- Compare two prompt versions side-by-side (no — only a one-version preview).
- See per-run validation diagnostics (partial — `parseMeta.issues` is persisted but not surfaced in the Prompt tab).

## Screenshots

Dev server was running at `localhost:5174` during discovery. Captured:
- `screenshots/agents-page.png` — agent list grid.
- `screenshots/agent-profile-escalation-template-parser.png` — profile page Overview tab.
- `screenshots/agent-profile-prompt-tab.png` — profile page with Prompt tab active, showing the editable prompt textarea + version side panel.

Last updated: 2026-05-19
