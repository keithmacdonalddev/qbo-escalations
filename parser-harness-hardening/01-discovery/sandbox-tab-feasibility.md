# Sandbox tab feasibility

Question C from the PM: how hard is it to add a "Sandbox" tab to the image parser profile page for live harness experimentation?

## Verdict

**Medium difficulty.** Most building blocks already exist. The tab body itself is essentially a remix of components and endpoints already shipping. The parallel-runs mode is the only piece that needs net-new code.

## How tabs are wired today

- Tab list: hardcoded array `PROFILE_TABS` at `client/src/components/AgentsView.jsx:61-71`. Image-parser variant `IMAGE_PARSER_PROFILE_TABS` at `AgentsView.jsx:73-77`.
- Render dispatch: a flat `if (activeTab === '...')` chain inside `AgentProfileWorkspace` at `AgentsView.jsx:1629-1660`. The default branch falls through to `AgentOverviewTab`.
- **Tabs are NOT lazy-loaded.** No `React.lazy`, no `Suspense`. All tab body components are imported eagerly with the parent. Whichever tab is active mounts; the others unmount when switched.
- Adding a new tab = adding one entry to the tab array + one `if` branch + one component function. Order-of-minutes, not order-of-hours.

## How big is an existing tab body

For comparison, the most feature-rich tab today is the Prompt tab.

- `AgentPromptTab` body: 104 lines (`AgentsView.jsx:1989-2092`).
- It uses 5 already-shipping building blocks: `Panel`, `EmptyState`, `InlineLoading`, `Badge`, `FormField`, plus inline `<textarea>` and `<button>` elements.
- The Test Results tab body is similar size at ~85 lines.

A Sandbox tab body of ~150-250 lines is realistic.

## What's reusable for a Sandbox tab body

| Requirement | Existing component / endpoint | Source |
| ----------- | ----------------------------- | ------ |
| Image dropzone / paste / file picker | `ImageParserPopup` already implements drag, paste, file picker, webcam | `client/src/components/chat/ImageParserPopup.jsx:207-251` — can extract dropzone subcomponent or reuse the popup itself in an embedded mode |
| Provider / model selector | `RuntimeSettingsPanel` widget (used by Configuration + Harness tabs); also the inline pickers inside `ImageParserPopup` | `AgentsView.jsx:2620+`, `ImageParserPopup.jsx:359-421` |
| "Run parse" call | `useImageParser.parse()` hook posts to `/api/image-parser/parse` | `client/src/hooks/useImageParser.js:45` |
| Result rendering | The Test Results tab's per-row card style + the chat-v5 `ParserOutput` component both render parsed text + fields | `AgentsView.jsx:2180-2222`, `ChatV5Container.jsx:1074-1255` |
| Single-click Pass/Fail buttons | Already exists in chat-v5 (`Widget2ParsedTemplate.jsx` + `ChatV5Container.jsx:1203-1222`) and Test Results tab; both call `PATCH /api/pipeline-tests/parser-results/:id` | `routes/pipeline-tests.js:660-683` |
| Persistence to the same audit collection | `createImageParserTestResultRecord()` in `routes/pipeline-tests.js:224-250` writes to `ImageParserTestResult` | reuse the existing route or refactor to a service so a Sandbox-specific endpoint can call it |
| Event stream for live progress | `services/image-parser.js:1581` already emits stage events via `eventBus`; the chat-v5 `useStageOrchestrator.js:232` consumes them via SSE | full plumbing exists; just needs subscribing |

## Blockers

None hard. Soft considerations:

1. **`/api/pipeline-tests/run` is fixture-only.** It always picks a random preloaded fixture (`pipeline-tests.js:725`). For a Sandbox tab you need either:
   - A new endpoint, e.g. `POST /api/pipeline-tests/run-adhoc`, that accepts an arbitrary image instead of selecting a fixture.
   - Or just use the existing `POST /api/image-parser/parse` (the chat popup uses it) and write the result to `ImageParserTestResult` via a thin endpoint or by extracting the persistence helper from `pipeline-tests.js` into a service so both routes call it.
   The second option is cleaner (single source of audit data) and is ~30 lines of refactor.
2. **`parserTestInFlight` is a single global flag** (`pipeline-tests.js:42`, gated at `pipeline-tests.js:715-721`). It only allows one parser test to run at a time. For parallel-runs mode (the user's "run N parallel parses" idea), this flag needs to become per-run-id, or be removed.
3. **No ground-truth field on a fixture today.** If the Sandbox tab is going to score parses automatically by byte-diffing against truth, a truth-string field needs to be added to either the fixture metadata or a sidecar file. This is its own piece of work, tracked in `open-questions.md` Q4. Not a blocker for an initial Sandbox shipping with manual Pass/Fail.
4. **Image upload size.** Server has a 50MB body limit per project docs; this is fine for screenshots and base64 expansion.
5. **Parallel runs as a feature.** Net-new code on the server: loop the parse call N times for the same image + prompt, fan-in the results, return an array. ~50-80 lines including error handling. Optionally throttle to avoid hammering local LM Studio.

## Implementation difficulty breakdown

| Piece | Difficulty | Estimate |
| ----- | ---------- | -------- |
| Wire a new "Sandbox" tab entry + render branch | trivial | 5 minutes |
| Tab body: dropzone + provider selector + run button + result panel + Pass/Fail | small | ~150 lines, mostly composition |
| Refactor the `ImageParserTestResult` persistence helper out of `pipeline-tests.js` so a new run flow can reuse it | small | ~30 lines |
| New endpoint `POST /api/pipeline-tests/run-adhoc` accepting `{ image, provider, model, promptId }`, returning the same shape as the fixture run | small | ~40 lines |
| Parallel-runs mode (server) | medium | ~80 lines + retry/error handling |
| Parallel-runs UI (live grid of N result cards) | medium | ~120 lines |

Tab core: **small/medium**, ship-able in one sitting.
Tab core + parallel-runs mode: **medium**, ship-able in one or two days of focused work.

## Recommendation

Ship the Sandbox tab in two phases:
- **Phase 1 (small):** single-run mode only. Dropzone, provider/model picker, run button, result panel with Pass/Fail. Reuses every existing piece. This alone closes the main gap the user named ("run a fresh parse from the agent profile page, not from chat").
- **Phase 2 (medium):** add N-parallel-runs mode for consistency testing.

The two-phase approach lets us harness-iterate immediately with Phase 1 while Phase 2 is in design.

Last updated: 2026-05-19
