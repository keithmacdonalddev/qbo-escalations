# Chat-area image parser test route — end-to-end map

The user mentioned a flow in the chat area that runs the image parser against a preloaded template and surfaces Pass / Fail buttons. This file traces that flow with fresh tool calls.

## What the user sees

In the chat-v5 main view (the primary chat screen) there is a "workflow lane" of stage cards: Parser, INV, Triage, Main. Each stage card has a kebab-menu (three-dot) button. Opening the menu reveals a "Test stage" entry. Clicking it kicks off a one-shot test run for that stage. For the parser stage, the app picks one of 10 preloaded escalation-template images at random, sends it through the parser, then surfaces the result inline with Pass and Fail buttons.

## Trigger — client side

- Menu component: `WorkflowCardMenu` at `client/src/components/chat-v5/ChatV5Container.jsx:699`. The "Test stage" item is the popover menu's first row (`ChatV5Container.jsx:740-751`).
- Click handler chain: menu calls `onRunTest(step.key)` → flows up through `WorkflowCard` (`ChatV5Container.jsx:771`) → `WorkflowLane` (`ChatV5Container.jsx:929`) → reaches `runStageTest` at `ChatV5Container.jsx:2023-2078`.
- `runStageTest` POSTs to `/api/pipeline-tests/run` with body `{ stage: 'parser', runtime: <per-agent runtime payload> }` (`ChatV5Container.jsx:2040-2049`).

## Server route

- File: `server/src/routes/pipeline-tests.js`.
- Endpoint: `POST /api/pipeline-tests/run` at `server/src/routes/pipeline-tests.js:685`.
- Stage `parser` branch at `server/src/routes/pipeline-tests.js:708-760`. The flow:
  1. Validates the image-parser provider is configured (`pipeline-tests.js:710-713`).
  2. Guards against concurrent test runs via `parserTestInFlight` flag (`pipeline-tests.js:715-721`).
  3. Calls `readRandomImageParserFixtureDataUrl()` (`pipeline-tests.js:362-379`) which lists every image file in the fixtures folder, picks one at random, reads it as base64, and returns it as a data URL with a `fixture` metadata object.
  4. Calls `parseImage()` with `promptId: 'escalation-template-parser'` and a 150-second timeout (`pipeline-tests.js:727-732`). **Key fact:** the strict prompt is always used; the looser `image-parser` prompt is never reached from this code path.
  5. Persists the run to MongoDB via `createImageParserTestResultRecord()` (`pipeline-tests.js:224-250`). Initial status is `pending-review`.
  6. Returns a JSON response including `savedTestResultId`, `savedTestResult`, parsed text, parse fields, parse metadata, fixture details, and elapsed time.

## The 10 preloaded templates

Confirmed by listing the directory.

- Folder: `server/fixtures/pipeline-tests/image-parser/` (registered as `IMAGE_FIXTURE_DIR` at `server/src/routes/pipeline-tests.js:38`).
- Contents (10 image files, verified): all named `IMG_<uuid>.JPEG` or `.jpeg`.
- Mime types resolved from extension via `IMAGE_FIXTURE_MIME_TYPES` (`pipeline-tests.js:169-174`).
- These are **images only**. There is no companion expected-output file per image. Grading is binary (Pass / Fail) at human discretion — the test bed has no ground-truth string to diff against.
- Fallback (when the folder is empty): `readTemplateImageDataUrl()` at `pipeline-tests.js:155-167` rasterises `server/fixtures/pipeline-tests/escalation-template.svg` into a PNG and uses that. This is the original synthetic fixture; today the folder has real screenshots so the fallback rarely runs.

## Persisted shape of a test result

Model: `server/src/models/ImageParserTestResult.js`. Fields stored per run:
- `fixture` — `{ name, path, url, mimeType, source }`.
- `provider`, `providerLabel`, `model`, `modelRequested`, `reasoningEffort`, `runtime`.
- `elapsedMs`.
- `status` — `pending-review` | `pass` | `fail`.
- `canonicalPassed`, `semanticPassed`, `parserIssues`, `canonicalIssues`, `fieldsFound` — extracted from the parser's `parseMeta` (`pipeline-tests.js:212-222`).
- `parsedText`, `parseFields`, `parseMeta`, `usage`.
- `reviewedAt`, `reviewer`, `operatorNote` — populated when the user clicks Pass or Fail.

## Pass / Fail buttons — implemented today

Yes — they are real and end-to-end working.

- Button render: `ParserOutput` component at `client/src/components/chat-v5/ChatV5Container.jsx:1074-1255`. The Pass / Fail buttons live at `ChatV5Container.jsx:1203-1222`, inside an `if (savedTestResultId && status === 'done')` guard.
- Click handler: `markResult(status)` at `ChatV5Container.jsx:1165-1173`, which calls `onMarkTestResult` prop.
- Parent handler: `markParserTestResult` at `ChatV5Container.jsx:2088-2114`.
- Server hop: `PATCH /api/pipeline-tests/parser-results/:id` at `server/src/routes/pipeline-tests.js:660-683`. Validates `status ∈ {pass, fail, pending-review}` and writes to Mongo.
- Aggregation: `GET /api/pipeline-tests/parser-results` at `server/src/routes/pipeline-tests.js:630-658`, which is what the profile page's Test Results tab reads from.

## The grading-button → Test Results tab pipeline

Verified end-to-end. The chain is:
1. User clicks the kebab menu on the Parser workflow card in chat → "Test stage".
2. `POST /api/pipeline-tests/run` runs the parser, writes a row with `status: pending-review`.
3. User clicks Pass or Fail in the inline result card.
4. `PATCH /api/pipeline-tests/parser-results/:id` updates the row to `pass` or `fail`.
5. User opens `#/agents/escalation-template-parser` → Test Results tab.
6. `GET /api/pipeline-tests/parser-results` returns aggregate stats + recent rows.
7. The Test Results tab UI (`AgentsView.jsx:2138-2222`) renders the stats + per-row card. Each row also has its own Pass/Fail buttons for re-review.

## There is a separate, parallel "localStorage" pass/fail flow — flagged

`client/src/components/chat-v5/Widget2ParsedTemplate.jsx:51-60` has its own `handleAccuracy(verdict)` which appends to a localStorage log key `v5_parser_accuracy_log`. That widget renders Pass · 100% correct / Fail · anything less buttons at `Widget2ParsedTemplate.jsx:135-152`. This is a separate, client-only log — it does NOT write to MongoDB and is invisible to the Test Results tab. It runs **in parallel** with the server-backed flow above.

This is a footgun for D3 ("single source of truth for grading"). The localStorage log should either be retired or merged into the server-backed `ImageParserTestResult` collection so a single Pass/Fail click goes to one place.

## What's still off the test bed

- **No ground truth.** The 10 fixtures are images only; no per-image expected-output text. A byte-diff validator (the hardening target) needs a hand-typed truth file per fixture — see `01-discovery/open-questions.md` Q4.
- **Random selection.** Today the route picks one fixture at random per click. A hardened bench would let the operator pick a specific fixture and run it deterministically.
- **No batch mode.** No way to run all 10 fixtures and get aggregate pass/fail in one click.
- **No multi-run consistency.** No way to run the same fixture N times and inspect variance.

These gaps are what the proposed Sandbox tab would close — see `01-discovery/sandbox-tab-feasibility.md`.

Last updated: 2026-05-19
