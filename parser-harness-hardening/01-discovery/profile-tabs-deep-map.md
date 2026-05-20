# Image parser profile page — all 10 tabs, plain English

The previous discovery deeply mapped only Prompt and Test Results. This file covers the rest.

The host component is `client/src/components/AgentsView.jsx`. Tab registry: `PROFILE_TABS` at `AgentsView.jsx:61-71`; the escalation-template-parser gets an extra Test Results tab inserted via `IMAGE_PARSER_PROFILE_TABS` at `AgentsView.jsx:73-77`. Tab rendering is a plain `if (activeTab === 'x') return <XTab />` chain at `AgentsView.jsx:1629-1660` — no `React.lazy`, no `Suspense`. Whichever tab is active mounts; the others unmount.

## 1. Overview tab — `AgentOverviewTab` (`AgentsView.jsx:1663-1700`)

**What it shows.** A read-only summary card pulling from the hardcoded persona facade `AGENT_OPERATION_META` (`AgentsView.jsx:84-205`): role, department, model label, tools, permissions, escalation policy, risk, review status, plus the Workflow Footprint, Quality & Performance metrics, Prompt Contract panel, Harness summary, and a Mark-as-Reviewed button.

**Functional or stub?** Mostly stub. The persona fields (department, owner, team, trust, risk) are static strings; the workflow lists are hardcoded; the quality metrics are static. The Mark-as-Reviewed button is real (it persists to `AgentIdentity`).

**Relevant to harness work?** Low. It's a marketing-style overview, not an operational tool.

## 2. Configuration tab — `AgentConfigurationTab` (`AgentsView.jsx:1912-1987`)

**What it shows.** A Profile Studio form (role title, agent soul, routing bias, avatar emoji, avatar prompt — all persisted to `AgentIdentity` Mongo doc), a Runtime Defaults panel (provider/model/mode picker — persisted via `PATCH /api/agent-identities/:id/runtime`), a Tool Permission Matrix, an Operating Policy summary, and a Review Workflow panel.

**Functional or stub?** Mixed. Profile Studio + Runtime Defaults are fully wired and save to the database. Tool Permission Matrix and Operating Policy are display-only from the persona facade.

**Relevant to harness work?** Medium. The Runtime Defaults panel is where you set the image parser's default provider/model — important for the hardening work because we'll want a way to lock the agent to the canary weak model.

## 3. Prompt tab — `AgentPromptTab` (`AgentsView.jsx:1989-2092`)

**What it shows.** A live markdown editor for the prompt file. Save snapshots the prior content to `prompts/versions/agents/<id>/<ts>.md`, writes the new content live, appends an audit entry. Side panel lists previous versions; clicking previews; a Restore button copies it back. Already covered in detail by `01-discovery/agents-ui.md`.

**Functional or stub?** Fully functional.

**Relevant to harness work?** Critical — this is where the harness prompt gets iterated.

## 4. Harness tab — `AgentHarnessTab` (`AgentsView.jsx:2096-2136`)

**What it shows.** Three panels:
- `HarnessSummaryPanel` — display-only persona meta (harness type, latency target, etc.).
- `HarnessResultsPanel` — calls `onRecordHarnessRun`; this is a manual log-entry form, not an automated runner.
- `RuntimeSettingsPanel` (Runtime Provider Matrix) — same widget as the Configuration tab's Runtime Defaults, persists to the same endpoint.
- A "Harness Checks" grid that consumes `operation.harnessChecks` — these are display-only stubs that come from `AGENT_OPERATION_META`. The grid renders if the array is non-empty; today it is empty for the escalation-template-parser.

**Functional or stub?** Mostly stub. The Runtime Provider Matrix is the only operational tool. There is no test runner, no sandbox, no playground — the user cannot send an image and watch the harness execute from this tab. Despite the tab being called "Harness," it does very little harness work.

**Relevant to harness work?** Important context: the tab name is suggestive but the surface is mostly empty. The proposed Sandbox tab could either replace this tab's contents or sit beside it. Either way, hardening work is **not** going to live primarily in this tab unless we expand it.

## 5. Test Results tab — `ImageParserTestResultsTab` (`AgentsView.jsx:2138-2222`) — image parser only

**What it shows.** Aggregate stats (total runs, pass rate, average elapsed time, breakdowns by provider / model / fixture image), plus a list of recent runs each with a thumbnail, metadata, and Pass / Fail buttons for re-review. Already covered by `01-discovery/agents-ui.md`.

**Functional or stub?** Fully functional, server-backed by `GET /api/pipeline-tests/parser-results`.

**Relevant to harness work?** High — this is the read-only audit dashboard. Hardening cycles will produce rows here; this is where regression visibility lives.

## 6. Workflows tab — `AgentWorkflowsTab` (`AgentsView.jsx:2289-2308`)

**What it shows.** A Workflow Footprint panel (inbound and outbound workflow chains), a Connected Workflows panel, and a Workflow Impact grid ranking workflows the agent participates in. All sourced from `AGENT_OPERATION_META.workflows`, a hardcoded array.

**Functional or stub?** Stub. Pure display from static persona data.

**Relevant to harness work?** None.

## 7. Activity tab — `AgentActivityTab` (`AgentsView.jsx:2310-2332`)

**What it shows.** A timeline list of activity entries for this agent. Source: `AgentIdentity.history` (the Mongo doc field), populated by code paths like `appendAgentHistory` in the prompt routes. Entries are things like "prompt-edit at <ts>", "prompt-restore at <ts>", "marked-reviewed at <ts>". Refreshable button at top.

**Functional or stub?** Functional. Real data, real DB read.

**Relevant to harness work?** Low. Useful for audit of prompt edits but not for live parse activity.

## 8. Event Streams tab — `AgentEventStreamsTab` (`AgentsView.jsx:2334-2404`)

**What it shows.** A table of saved workflow sessions: session title, stage, status, event count, last updated, runtime info. Clicking a row expands an `EventStreamDetail` panel that lists every recorded event in that session.

**Functional or stub?** Functional, but populated only when a workflow session writes recorded events. This is the same Mongo data that powers the post-hoc replay of pipeline runs.

**Relevant to harness work?** Medium — the existing event-stream infrastructure could host live event streaming for a Sandbox tab (every parse emits an event bus stream via `services/image-parser.js:1581`). A Sandbox tab that runs many parses could piggyback on this for live observation. Worth exploring in implementation, not blocking.

## 9. Chat Sessions tab — `AgentChatSessionsTab` (`AgentsView.jsx:2472-2544`)

**What it shows.** A table of saved chat sessions for this agent. For the image parser, this reads from a route that returns image-parse-history rows (every parse run via the chat popup writes one). Each row expands into an Input/Output detail view.

**Functional or stub?** Functional. The image parser variant explicitly checks `agentId === 'escalation-template-parser'` and renders a different detail panel (input = image, output = parsed text).

**Relevant to harness work?** Medium — this is a parallel audit trail to Test Results. Test Results stores explicitly-graded test runs; Chat Sessions stores every production parse from the chat popup. The two should not be conflated. Hardening cycles will mostly use Test Results.

## 10. Versions tab — `AgentVersionsTab` (`AgentsView.jsx:2585-2618`)

**What it shows.** A version timeline of identity-level version saves (renderable identity profile snapshots, not prompt snapshots — those live on the Prompt tab). Reads from `AgentIdentity.versions`.

**Functional or stub?** Functional, but distinct from the Prompt-tab versioning. The Prompt-tab versioning snapshots the markdown file to disk; this tab snapshots the `AgentIdentity` Mongo doc shape. Confusing because both are called "versions" — they cover different things.

**Relevant to harness work?** Low. Profile-shape versioning is not part of harness iteration.

## Tab summary table

| # | Tab | What it does | Functional? | Harness-relevant? |
| - | --- | ------------ | ----------- | ----------------- |
| 1 | Overview | Read-only persona summary | mostly stub | low |
| 2 | Configuration | Profile + runtime defaults form | functional (mixed) | medium |
| 3 | Prompt | Live markdown editor + version history for the agent's prompt file | functional | critical |
| 4 | Harness | Runtime provider matrix + display-only persona meta; no runner | stub-heavy | low (name misleading) |
| 5 | Test Results | Aggregate stats + per-row pass/fail; reads `ImageParserTestResult` | functional | high |
| 6 | Workflows | Static workflow lists from persona meta | stub | none |
| 7 | Activity | Timeline of recorded `AgentIdentity.history` entries | functional | low |
| 8 | Event Streams | Table of saved workflow sessions with per-event drill-down | functional | medium (reusable for sandbox) |
| 9 | Chat Sessions | Table of saved production chat sessions for this agent | functional | medium |
| 10 | Versions | `AgentIdentity` doc snapshots (NOT prompt versions) | functional | low |

## Implications for the hardening work

- **Where harness work belongs:** Prompt tab (iterate prompt), Configuration / Harness tab (lock runtime to canary), Test Results tab (read regression dashboard), and a new Sandbox tab (run experiments).
- **What to ignore:** Overview, Workflows, Versions, Activity. Stubby or off-topic.
- **Existing infrastructure to reuse:** the same `ImageParserTestResult` collection that the Test Results tab reads; the same `POST /api/pipeline-tests/run` + `PATCH /api/pipeline-tests/parser-results/:id` server endpoints; the same `RuntimeSettingsPanel` widget for picking provider/model.

Last updated: 2026-05-19
