# Agent-agnostic Sandbox tab MVP

Question 3 from the user. Goal: a Sandbox tab that appears on every agent profile page and works out of the box for any agent type. Phase 1 is agent-agnostic. Phase 1.5 adds agent-specific extensions. Plain English first. Every code identifier paired with a one-line description of what it does.

## Mental model

A Sandbox tab is a self-contained safe-to-experiment workbench attached to one agent's profile page. The user can:

1. See the agent's current prompt text in an editable scratchpad.
2. Pick a provider and model from the same picker the rest of the app uses.
3. Provide input (image, text, or structured event — whichever this agent type takes).
4. Click **Run**.
5. Optionally click "**Run N in parallel**" — that fans out N runs of the same input with potentially N different scratch-prompt variants, side by side.
6. See each result render in the agent-appropriate way.
7. Click **Pass** or **Fail** on each result. Single click. Persists to the sandbox grading store.
8. Optionally click "**Promote prompt to live**" to write the current scratch prompt to the real prompts file (with the standard version-snapshot trail).

Everything is **scoped** so it cannot pollute production state — see the companion document `sandbox-isolation-architecture.md` for that side of the story.

## Component architecture

### One shared parent: `SandboxTab` (new)

A single React component (`client/src/components/AgentsView.jsx` is the file we add it to — that's where every other profile tab body lives today) that takes one prop: `agent` (an object describing this profile page's agent — already passed to every existing tab body). From `agent.kind` (or a similar discriminator) it picks the agent-type-specific slot components below. Everything else — the prompt scratchpad, the provider picker, the run button, the parallel-runs toggle, the result-grid layout, the Pass/Fail buttons, the promote button — lives in this shared parent and is identical across every agent.

The parent is roughly 300-450 lines including the parallel-runs grid logic.

### Universal pieces — what's already built and where

| Piece | Status | Where today | What we add |
|-------|--------|-------------|-------------|
| **Scratch prompt editor** (a plain `<textarea>` for free-form prompt text) | Reuse | `AgentsView.jsx:2028-2033` inside `AgentPromptTab` — the existing live-prompt editor textarea | Same markup, but the value lives in component state + `sessionStorage` (per-tab browser storage that survives reload) rather than in a saved file. ~15 lines. |
| **Provider/model selector** | Reuse | `RuntimeSettingsPanel({ agent, definition, runtimeState, saveStatus, onSave })` at `AgentsView.jsx:2620` — the existing model+provider picker used by the Harness tab | Render the existing component in "sandbox mode" — pass a prop that suppresses the auto-save behaviour so picking doesn't change live runtime. ~5-line prop addition to existing component. |
| **Run button** | New (trivial) | n/a | A single `<button>` that calls a `runSandbox()` function. ~30 lines including disabled states. |
| **Parallel-runs toggle** | New | n/a | A number input (1 to e.g. 8) plus N small textareas (one per slot) so each slot can carry its own scratch prompt variant. ~80 lines. |
| **Result panel** | Reuse | The chat-v5 inline `ParserOutput` function at `ChatV5Container.jsx:1074` — the parser-card component currently visible in chat | Extract it into its own file or use as-is; render N copies side by side in parallel mode. Some refactor — see "What new code is needed" below. |
| **Single-click Pass/Fail** | Reuse | `ChatV5Container.jsx:1203-1222` inside the `ParserOutput` function — the existing Pass/Fail row | Rebound to a sandbox endpoint (`PATCH /api/sandbox/parse-results/:id`). ~5-line endpoint swap. |
| **Stage-event live stream** | Reuse | `useStageOrchestrator` in `client/src/components/chat-v5/useStageOrchestrator.js` — the React hook that consumes the SSE stream of parser stage events | Swap the URL to `POST /api/sandbox/parse` with `scope: 'sandbox'`. ~10 lines. |
| **Promote-to-live button** | Reuse | `PUT /api/agent-prompts/:id` at `server/src/routes/agent-prompts.js:167-194` — the existing prompt-save endpoint which also snapshots the previous version into `prompts/versions/agents/<id>/` | One client-side button that POSTs the scratch text. Server unchanged. ~20 lines client. |

### Agent-type-specific slot components — what plugs in

Three slot components per agent type. Each one is small. Phase 1 ships **one** complete set (the image-parser set) — that covers 3 of the 13 agents and is the harness-hardening target. Phase 1.5 adds the chat set and the workflow-event set.

| Slot | Image-parser agents | Chat agents | Workflow-event agents |
|------|---------------------|-------------|------------------------|
| **Input renderer** — the surface the user uses to provide test input | Image dropzone with drag/paste/file-picker. Reuse from `client/src/components/chat/ImageParserPopup.jsx:207-251` — the dropzone region of the existing chat popup. ~20-line wrapper. | Multi-line text area + (optional) a "from history" picker that copies a real past message. ~40 lines. | A JSON/form editor for the structured event the agent would receive. ~80 lines (more if we add presets). |
| **Output renderer** — how the result is shown | Canonical 9-label template list + raw fallback. Reuse `ParserOutput` from `ChatV5Container.jsx:1074` (the parser card). | Chat bubble component. The user has many chat-bubble components in the chat directory; pick the simplest one. ~30-line wrapper. | A structured-event preview block (key-value rows for emitted event payload). ~60 lines. |
| **Validation rules** — automatic checks beyond user pass/fail | 9-label contract from `parserValidation` in the existing parse response. Already shipping. | Sentiment / length / forbidden-phrase checks — small. ~40 lines per check. | Schema-shape check against the event spec. ~50 lines. |

### The 13 agents, bucketed by input type

These are the 13 frozen prompt definitions in `AGENT_PROMPT_DEFINITIONS` at `server/src/lib/agent-prompt-store.js:13-137` — the master registry. Bucketing per input type, sourced directly from each prompt file's behaviour:

**Image-input agents (3 — Phase 1 target).** Input is an image; output is text.
- `image-parser` — dual-role auto-detect parser.
- `escalation-template-parser` — strict 9-label template parser. **The hardening target.**
- `follow-up-chat-parser` — phone-agent follow-up screenshot transcript parser.

**Text-input agents (8 — Phase 1.5 main bucket).** Input is one or more chat messages; output is a chat reply (or structured chat-shape response).
- `chat-core` — the primary QBO Assistant chat agent.
- `workspace-action` — Keith's executive assistant (email + calendar + workspace).
- `workspace-chat-only` — direct-response workspace mode.
- `gmail-assistant` — inbox message reader and reply helper.
- `triage-agent` — fast first-pass escalation triage (input: parsed escalation text + context).
- `known-issue-search-agent` — INV investigation search agent with tool calls.
- `copilot-agent` — operator-facing copilot for search/template/analysis.
- `escalation-enrichment` — resolved-case knowledge extractor.

**Structured-event-input agents (1 — small Phase 1.5 bucket).** Input is a workspace event payload; output is an advisory.
- `workspace-proactive` — background workspace advisories.

**Special: structured-output backbone (1 — does not need its own slot set).**
- `sdk-image-parse` — the Claude SDK structured-output parser (per Decision D2, this becomes the image parser's backbone). Lives inside the image-input slot family — no separate slots needed.

So Phase 1.5 adds **two** new slot variants (text-input and event-input). Total slot variants in the finished system: **three**.

## Where each universal piece comes from in the existing codebase

Concrete file:line references, plain English description after each:

- **Scratch prompt editor** — `client/src/components/AgentsView.jsx:2028-2033`. The existing live-prompt textarea inside `AgentPromptTab`. Same JSX, swapped to `sessionStorage`-backed state.
- **Provider / model selector** — `client/src/components/AgentsView.jsx:2620`. `RuntimeSettingsPanel({ agent, definition, runtimeState, saveStatus, onSave })`. Already used by the Harness tab. Wire it into the Sandbox tab with a `disableAutoSave` prop.
- **Image dropzone** — `client/src/components/chat/ImageParserPopup.jsx:207-251`. Existing drag-paste-pick region. Wrap the inner DOM in a small reusable component or duplicate the few lines.
- **Run-parse hook** — `client/src/hooks/useImageParser.js:45`. The `useImageParser().parse(...)` hook. Reuse with a flag forcing `scope: 'sandbox'` and the new `/api/sandbox/parse` endpoint.
- **Server parse function** — `server/src/services/image-parser.js:1518` (`parseImage(image, opts)`). Reuse unchanged. Accepts a new optional `promptOverride` parameter the route passes through.
- **Stage event bus** — `server/src/lib/stage-events.js:82` (`createStageEventBus({ send, stageId, runId, scope? })`). Add one optional `scope` argument; sandbox runs construct with `scope: 'sandbox'`.
- **SSE consumer** — `client/src/components/chat-v5/useStageOrchestrator.js:232`. Existing client-side SSE handler. Reuse with the sandbox endpoint URL.
- **Result rendering (image)** — `client/src/components/chat-v5/ChatV5Container.jsx:1074` (`ParserOutput`). Reuse — either refactor out into its own file or render an instance per parallel slot.
- **Pass/Fail buttons** — `client/src/components/chat-v5/ChatV5Container.jsx:1203-1222`. Reuse — rebind the prop `onMarkTestResult` to `PATCH /api/sandbox/parse-results/:id`.
- **Promote to live** — `server/src/routes/agent-prompts.js:167-194` (`PUT /api/agent-prompts/:id`). Reuse unchanged.

## What new code is needed

Phase 1 (image-input agents only):

| New piece | Where | Lines |
|-----------|-------|-------|
| `SandboxTab` component (shared parent) | `client/src/components/AgentsView.jsx` (new function in this file) | ~350 |
| Image-input slot trio (input dropzone wrapper + output reuse + validation reuse) | Same file, near `SandboxTab` | ~120 |
| `SandboxParseResult` Mongoose model | `server/src/models/SandboxParseResult.js` (new file) | ~50 |
| `POST /api/sandbox/parse` route — runs one parse with optional `promptOverride`, writes to `SandboxParseResult`, streams events | `server/src/routes/sandbox-parse.js` (new file) | ~120 |
| `POST /api/sandbox/parse/parallel` route — same but fans out N concurrent runs | Same file | ~80 |
| `GET /api/sandbox/parse-results` list and `GET /:id` detail and `PATCH /:id` (Pass/Fail grade) | Same file | ~80 |
| `scope` parameter on `createStageEventBus` | `server/src/lib/stage-events.js` | ~5 |
| Tab wiring (one entry in `PROFILE_TABS` / `IMAGE_PARSER_PROFILE_TABS`, one branch in `AgentProfileWorkspace`) | `client/src/components/AgentsView.jsx:61-77,1629-1660` | ~10 |
| Sandbox-grading hook helpers + UI plumbing | Various | ~80 |

**Phase 1 total: ~900 lines.** Roughly half a sitting for someone with the file map open.

Phase 1.5 adds:

| New piece | Lines |
|-----------|-------|
| Text-input slot trio (chat textarea, chat-bubble renderer, simple validation) | ~150 |
| Event-input slot trio (JSON editor, structured-event preview, schema check) | ~250 |
| Per-agent-type endpoint variants (chat run, event run) | ~150 |

**Phase 1.5 total: ~550 lines.**

## Effort rating per piece (small / medium / large)

- Tab wiring (add entry, render branch): **small** (minutes).
- `SandboxTab` shared parent: **medium** (one sitting).
- Image-input slot trio: **small** (reuse-heavy).
- `SandboxParseResult` model + read/write routes: **small** (cookie-cutter from `ImageParseResult` and `ImageParserTestResult`).
- Parallel-runs server fan-out: **medium** (concurrency, retry behaviour, throttling on local providers).
- Parallel-runs client grid: **medium** (UI density, scrolling, comparison view, per-slot prompt variants).
- Sandbox-prompt promotion flow: **small** (one button, reuses an existing endpoint).
- `scope`-tagging the event bus: **small** (one parameter).
- Text-input slot trio (Phase 1.5): **small/medium** depending on chat-bubble reuse.
- Event-input slot trio (Phase 1.5): **medium** (JSON editor UX is fiddly).

## Universal vs agent-specific summary

**Universal — once, applies to all 13 agents:**

- Sandbox tab entry on the profile-page tab strip.
- Scratch prompt textarea (driven by `sessionStorage`).
- Provider/model picker (`RuntimeSettingsPanel` in sandbox mode).
- Run button.
- Run-N-parallel toggle + per-slot prompt variants.
- Single-click Pass/Fail row, bound to the sandbox grading endpoint.
- Promote-to-live button (calls existing prompt-save endpoint).
- `SandboxParseResult` collection.
- `scope`-tagged event bus.

**Agent-type-specific — three slot variants:**

- Image-input slot trio (Phase 1).
- Text-input slot trio (Phase 1.5).
- Event-input slot trio (Phase 1.5).

**Per individual agent:** zero. No agent-by-agent code. The discriminator `agent.kind` picks the slot trio; everything else is parameterised by `agent.id` and the existing per-agent prompt files.

Last updated: 2026-05-19
