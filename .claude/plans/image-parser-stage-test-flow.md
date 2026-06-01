# Implementation Plan: Shared Agent Test Modal and Stage 2 Image Parser Test Flow

This plan introduces one shared Agent Test Modal that owns the client UI/UX for agent tests, then migrates the Stage 2 Escalation Image Parser test into that modal first. The same test workflow must open regardless of where the operator clicks a test action: the Stage 2 card in the main chat workflow, the Escalation Image Parser profile page, or any future agent test button.

The existing parser harness should be preserved where it works: SSE stage events, random image fixture smoke test, saved `ImageParserTestResult` record, pass/fail grading, parser output preview, provider/model/cost metadata, and the AgentsView test-results dashboard. What changes is where the active test experience lives: inside the modal, not in the existing chat right dock or profile page body.

The work should be implemented in small phases. Phase 1 creates the shared modal shell, migrates the image parser test into it, and fixes backend truthfulness/coverage for that path. Phase 2 adds reproducible fixture selection and expected-answer scoring. Phase 3 adds stronger audit evidence. Phase 4 expands the parser modal to current-image testing. Phase 5 migrates future agent harnesses into the same modal.

## 1. Problem

The Stage 2 card in the chat workflow has a three-dot menu with a "Test stage" action. In the current implementation, that action:

1. Calls `runStageTest('parser')` in `client/src/components/chat-v5/ChatV5Container.jsx`.
2. Opens an SSE request to `POST /api/pipeline-tests/run` with `{ stage: 'parser' }`.
3. Server-side code in `server/src/routes/pipeline-tests.js` selects a random image from `server/fixtures/pipeline-tests/image-parser/`.
4. The server calls `parseImage()` with prompt id `escalation-template-parser`.
5. The server returns streamed stage events and a terminal test result.
6. If MongoDB is connected, the run is saved as `ImageParserTestResult`.
7. The right-side parser output panel lets the operator mark the result Pass or Fail.
8. AgentsView can list recent parser test results and aggregate pass-rate/cost data.

That is a good base, but the current user-facing and data-contract details overstate what the system proves.

Current gaps:

- Active test output is shown inside the existing workflow UI, which makes a temporary test run look like part of the current escalation workflow.
- A test launched from Chat and a test launched from an agent profile do not have a single shared client workflow.
- The UI and API copy say the test is "not saved," while the server does save an `ImageParserTestResult` when MongoDB is available.
- The test is random and has no expected-answer manifest, so it checks required 9-label format but cannot automatically prove field-level accuracy against the image.
- Saved test records do not store the exact provider package id, prompt version/hash, capture status, or streamed stage events needed for a later audit.
- The parser branch reads `server/fixtures/pipeline-tests/escalation-case.json` before checking the requested stage, so a parser-only test can be blocked by an unrelated fixture file.
- There is no dedicated route-level test coverage for the parser branch of `/api/pipeline-tests/run`, unlike the newer triage test route.
- Closing a running test does not consistently cancel the provider call.
- Marking parser Pass clears the workflow immediately, instead of simply recording the result and closing the test surface.

## 2. Goals

- Make the existing test flow truthful: if a run is saved, the UI says it is saved; if MongoDB is unavailable, the UI says it is temporary.
- Create one shared Agent Test Modal responsible for setup, live progress, stage events, output, pass/fail review, cancellation, and close behavior for agent tests.
- Make every test launch point use the same modal entrypoint and harness registry.
- Encode the future agent-test direction in the implementation itself, not only in this plan file. If this markdown is later discarded, the code should still clearly point developers toward the shared modal + harness pattern.
- Preserve the current fast smoke-test affordance from the Stage 2 workflow card, but contain the output to the modal.
- Focus first on the Escalation Image Parser harness. Current checkout also contains triage-test route work, but this plan does not require migrating triage in the first pass.
- Add deterministic fixture selection so a provider/prompt/model comparison can be reproduced.
- Add expected-answer manifests and automatic field-level scoring so the system can distinguish "format passed" from "values were correct."
- Persist enough audit evidence to explain exactly which prompt, provider call, model, fixture, and result created each saved test run.
- Keep production parsing behavior separate from test-run behavior.
- Match the testing rigor of the Stage 4 triage test route.

## 3. Non-Goals

- Do not change the live production `/api/image-parser/parse` behavior in this plan except where a shared helper is clearly safe and covered by tests.
- Do not change the parser prompt content unless a later benchmark result proves the prompt needs adjustment.
- Do not remove existing random smoke tests.
- Do not change the workflow pipeline order.
- Do not combine parser, INV, triage, and assistant tests into one end-to-end benchmark in this pass.
- Do not delete existing image fixtures unless they are duplicates or unreadable and the user approves cleanup.
- Do not migrate every future/current agent into the modal in Phase 1. Build the modal as the common host, then wire the parser first.

## 4. Current Code Map

Primary files:

- `client/src/components/chat-v5/ChatV5Container.jsx`
  - `WorkflowCardMenu` renders the three-dot menu and "Test stage" action.
  - `runStageTest()` handles parser test execution and SSE consumption.
  - `ParserOutput` renders fixture preview, parsed fields, pass/fail buttons, validation warning, and cost summary.
  - `markParserTestResult()` PATCHes pass/fail status.
- New shared modal files to create:
  - `client/src/components/agent-tests/AgentTestModal.jsx`
  - `client/src/components/agent-tests/AgentTestModal.css`
  - `client/src/components/agent-tests/AgentTestModalProvider.jsx`
  - `client/src/components/agent-tests/agentTestHarnesses.js`
- `server/src/routes/pipeline-tests.js`
  - `POST /api/pipeline-tests/run` handles parser, INV, triage, and main test branches.
  - Parser branch selects a random image fixture, calls `parseImage()`, creates `ImageParserTestResult`, and streams events.
  - `GET /api/pipeline-tests/parser-results` lists saved parser test runs and stats.
  - `PATCH /api/pipeline-tests/parser-results/:id` records operator grading.
- `server/src/models/ImageParserTestResult.js`
  - Stores fixture, provider/model, validation, parsed text, parse fields/meta, usage, API cost, fallback summary, and operator grading.
- `server/src/services/image-parser.js`
  - `parseImage()` runs the selected provider/model, resolves the live prompt, validates the required template, extracts fields, and emits stage events.
- `client/src/components/AgentsView.jsx`
  - `ImageParserTestResultsTab` renders recent parser test runs, provider/model/fixture breakdowns, reliability notes, and pass/fail controls.
  - Any parser profile "Run test" action should open the shared modal, not render a separate test workflow.
- `server/fixtures/pipeline-tests/image-parser/`
  - Current image fixture folder. Contains images only, no expected output manifests.

Related comparison files:

- `server/src/routes/triage-tests.js`
- `server/src/models/TriageTestResult.js`
- `server/test/triage-tests-routes.test.js`
- `.claude/plans/triage-test-route.md`

## 5. Architecture Guardrail: Code Must Carry the Future Direction

The implementation must not depend on this plan file surviving. The repo should make the intended future path obvious from the code structure itself.

Required guardrails:

- The shared modal must live in a neutral folder such as `client/src/components/agent-tests/`, not inside chat-v5 or the parser profile page.
- Public client entrypoint should be named generically, such as `openAgentTest({ agentId, ... })`, not `openParserTest()`.
- Harness registration should be centralized in `agentTestHarnesses.js` or an equivalent registry. Adding a future Triage/INV/Assistant test should mean adding a harness entry, not creating another modal.
- Parser-specific rendering may live in parser harness components, but modal lifecycle code must stay agent-neutral.
- Chat Stage 2 and AgentsView must both call the same modal opener. No page should own a private test workflow.
- Tests should assert shared behavior: "Chat and profile launch the same modal path." This protects the architecture after the plan file is gone.
- Backend work can continue using the existing parser route for Phase 1, but route/service names added for new shared code should use `agent-test` wording where practical.
- Any temporary parser-specific fallback should include a short code comment that names the intended generic harness direction and the condition for removing the fallback.

Review rule:

If a future agent test requires copying the parser modal, creating a second modal, or branching heavily inside Chat/AgentsView, the Phase 1 implementation failed this guardrail and should be corrected before adding that agent.

## 6. Phase 1: Shared Modal Foundation and Parser Migration

Phase 1 creates the shared modal and moves the existing Escalation Image Parser test output into it. The parser test still uses the current random image smoke-test harness, but active test output no longer appears in the chat right dock or profile page body.

### 6.1 Client architecture

Create a shared modal host:

- `client/src/components/agent-tests/AgentTestModalProvider.jsx`
- `client/src/components/agent-tests/AgentTestModal.jsx`
- `client/src/components/agent-tests/AgentTestModal.css`
- `client/src/components/agent-tests/agentTestHarnesses.js`

Mount `AgentTestModalProvider` high enough that both Chat and AgentsView can open the same modal. Recommended mount point: `client/src/App.jsx`, near other app-level providers.

This provider and the opener hook are architectural APIs. They should be named and exported as future-facing shared test infrastructure, not as parser-only helpers.

Expose an opener hook:

```js
const { openAgentTest } = useAgentTestModal();

openAgentTest({
  agentId: 'escalation-template-parser',
  stageKey: 'parser',
  launchSurface: 'chat-stage-card',
  context: {
    conversationId,
    hasCurrentImage: Boolean(imageCaptured),
  },
});
```

`agentTestHarnesses.js` should map agent ids to client harness runners:

```js
export const AGENT_TEST_HARNESSES = {
  'escalation-template-parser': {
    agentId: 'escalation-template-parser',
    label: 'Escalation Image Parser',
    stageKey: 'parser',
    supportsFixtures: true,
    supportsCurrentImage: false,
    run: runImageParserFixtureTest,
    patchResult: patchImageParserTestResult,
  },
};
```

The modal should be generic, while the parser harness supplies parser-specific render data.

### 6.2 Modal behavior

The modal owns the full test lifecycle:

1. **Setup**
   - Shows agent name, provider/model summary, and the harness being used.
   - For Phase 1 parser work, default action is `Run saved fixture`.
   - If the parser harness has no configured provider, show the same actionable configuration error currently used by the parser flow.
2. **Running**
   - Opens the SSE request.
   - Shows live stage events inside the modal.
   - Shows elapsed time, provider/model, and current status.
   - Disable Pass/Fail while running.
3. **Cancellation**
   - Closing the modal while a test is running cancels the client request with `AbortController`.
   - The server should listen for request close and abort/cancel provider work where the underlying provider path supports it.
   - The modal closes after cancel completes or after the client request is aborted.
4. **Result**
   - Shows selected fixture image preview.
   - Shows parsed template/fields.
   - Shows validation status, cost, provider/model, and any saved result id.
   - Shows Pass and Fail actions if a saved result id exists.
   - If the test completed and the user closes without clicking Pass or Fail, the saved result remains `pending-review`.
5. **Recording**
   - Clicking Pass or Fail PATCHes the saved test result.
   - After the PATCH succeeds, the modal closes automatically.
   - If PATCH fails, the modal stays open and shows the error.

Do not write temporary parser test output into `ParserOutput`, `EvidenceDock`, or any existing chat workflow panel. A test launched from the workflow card may show a small non-invasive "test running" indicator on the card, but all result details must stay in the modal.

### 6.3 Chat launch point

Modify `client/src/components/chat-v5/ChatV5Container.jsx`.

1. Change `WorkflowCardMenu` so parser test action calls `openAgentTest({ agentId: 'escalation-template-parser', stageKey: 'parser', launchSurface: 'chat-stage-card' })`.
2. The parser menu item can read `Run test` or `Test agent`; avoid wording that implies the test result will appear in the current chat workflow.
3. Remove or bypass `setTestRuns({ parser: ... })` for the parser launch path once the modal owns it.
4. Keep existing live pipeline behavior untouched for real escalation runs.
5. Keep Stage 3/4/5 test behavior unchanged until those agents are explicitly migrated to the modal.

### 6.4 Agent profile launch point

Modify `client/src/components/AgentsView.jsx`.

1. Add or rewire the Escalation Image Parser profile test button to call the same `openAgentTest()` API.
2. Do not duplicate parser test UI inside the profile page.
3. The profile's Test Results tab remains a history/dashboard surface. It should not be the active test runner.
4. If there are multiple profile test buttons, every one should call the same modal opener for the selected agent.

### 6.5 Backend changes

Modify `server/src/routes/pipeline-tests.js`.

1. Move `const fixture = await readCaseFixture();` out of the top of `router.post('/run')`.
2. Read `escalation-case.json` only inside the `inv`, legacy `triage`, and `main` branches that need it.
3. Keep the parser branch independent from `escalation-case.json`.
4. Change parser response copy:
   - If `savedTestResult` exists: `alert: 'Parser test saved for review.'`
   - If MongoDB is unavailable or save failed: `alert: 'Temporary parser test result - not saved because the database is unavailable.'`
5. Include explicit save-state fields in the parser response:
   - `saved: Boolean(savedTestResult)`
   - `saveStatus: 'saved' | 'not-saved'`
   - `saveReason: '' | 'db-unavailable' | 'save-failed'`
6. Preserve the existing `savedTestResultId` and `savedTestResult` fields for compatibility.
7. If save failed for reasons other than DB unavailability, log a server warning as it does now, but do not fail the parser test call.
8. Add request-close handling so a running parser test can be cancelled when the modal closes. If a provider path cannot be interrupted yet, at minimum stop streaming, mark the client-side run cancelled, and avoid writing a misleading successful UI result.

Do not change `parseImage()` in this phase unless a small `AbortSignal`/cancellation thread-through is required for the close-to-cancel behavior.

### 6.6 Tests

Create `server/test/pipeline-parser-tests-routes.test.js`.

Cover at least:

1. `POST /api/pipeline-tests/run` with `{ stage: 'parser' }` does not read `escalation-case.json`.
2. Parser branch returns SSE when `Accept: text/event-stream`.
3. SSE response includes at least one `stage_event` and one terminal `test_complete` on success.
4. JSON fallback response works when SSE is not requested.
5. Successful parser run returns `saved: true`, `saveStatus: 'saved'`, and `savedTestResultId` when DB is available.
6. Successful parser run returns `saved: false`, `saveStatus: 'not-saved'`, and no `savedTestResultId` when DB is unavailable.
7. Already-running parser test returns `409 IMAGE_PARSER_TEST_ALREADY_RUNNING`.
8. Disabled parser agent returns `409 AGENT_DISABLED`.
9. `PATCH /api/pipeline-tests/parser-results/:id` accepts `pass`, `fail`, and `pending-review`.
10. `PATCH /api/pipeline-tests/parser-results/:id` rejects invalid statuses.
11. Closing the SSE request triggers the parser-test cancellation path and does not send a terminal success result.

Use mocked/stubbed provider calls. Do not call live providers in automated tests.

Add frontend tests for:

1. Chat Stage 2 test action opens `AgentTestModal`.
2. AgentsView parser profile test action opens the same `AgentTestModal`.
3. Parser test output renders inside the modal, not in `ParserOutput` or the evidence dock.
4. Closing the modal while running aborts the request.
5. Closing the modal after completion without grading leaves the saved result pending.
6. Clicking Pass PATCHes the result and closes the modal automatically.
7. Clicking Fail PATCHes the result and closes the modal automatically.

### 6.7 Phase 1 acceptance criteria

1. Clicking the Stage 2 parser test action opens the shared Agent Test Modal.
2. Clicking the Escalation Image Parser profile test action opens the same modal path.
3. The modal launches the parser's appropriate harness: the saved image fixture parser test.
4. Parser test progress, events, fixture preview, output, validation, cost, and pass/fail controls are contained in the modal.
5. The chat right dock does not show temporary parser test output.
6. Closing the modal while the test is running cancels the call.
7. Closing the modal after completion without Pass/Fail leaves the saved result `pending-review`.
8. Clicking Pass records `pass` and closes the modal automatically.
9. Clicking Fail records `fail` and closes the modal automatically.
10. On success with MongoDB connected, the modal says the result was saved for review.
11. On success without MongoDB, the modal says the result is temporary and hides pass/fail controls.
12. Parser tests still stream stage events, now rendered inside the modal.
13. The parser route no longer depends on `escalation-case.json`.
14. New route and modal tests pass without calling a live provider.
15. The code contains one shared modal opener and one harness registry; there is no parser-only modal architecture.

## 7. Phase 2: Reproducible Fixture Benchmark

Phase 2 turns the random smoke test into a reproducible benchmark while preserving random mode.

### 7.1 Fixture manifest format

Add manifest JSON files alongside or under the image fixtures.

Recommended folder shape:

```text
server/fixtures/pipeline-tests/image-parser/
  images/
    payroll-deadline-001.jpeg
    bank-feeds-stale-001.jpeg
  manifests/
    payroll-deadline-001.json
    bank-feeds-stale-001.json
```

If moving existing images is too disruptive, keep images in the current folder and add matching `.json` manifests beside them. The route should support the current layout during migration.

Manifest shape:

```json
{
  "schemaVersion": 1,
  "name": "payroll-deadline-001",
  "image": "payroll-deadline-001.jpeg",
  "description": "Payroll deadline screenshot with all required fields visible.",
  "tags": ["payroll", "deadline", "all-fields"],
  "difficulty": "medium",
  "expectedFields": {
    "coid": "123456",
    "mid": "789012",
    "caseNumber": "CS-123456",
    "clientContact": "Jane Doe",
    "attemptingTo": "Run final payroll",
    "expectedOutcome": "Payroll submits successfully",
    "actualOutcome": "Submission blocked by date validation",
    "kbToolsUsed": "Payroll tax article",
    "triedTestAccount": "N/A",
    "tsSteps": "Cleared cache; reproduced in private window"
  },
  "expectedTemplate": "COID/MID: 123456 / 789012\nCASE: CS-123456\nCLIENT/CONTACT: Jane Doe\nCX IS ATTEMPTING TO: Run final payroll\nEXPECTED OUTCOME: Payroll submits successfully\nACTUAL OUTCOME: Submission blocked by date validation\nKB/TOOLS USED: Payroll tax article\nTRIED TEST ACCOUNT: N/A\nTS STEPS: Cleared cache; reproduced in private window",
  "notes": "Use exact values. Do not normalize spelling."
}
```

Rules:

- `expectedFields` is required.
- `expectedTemplate` is optional but recommended.
- Values should match what the operator expects, not necessarily model-normalized text.
- If a value is intentionally blank, use an empty string.
- If visible text is unreadable, record `expectedFields[field]` as an empty string and add a note.

### 7.2 Backend fixture loader

Modify `server/src/routes/pipeline-tests.js`.

Add helpers:

- `listImageParserFixtureManifests()`
- `readImageParserFixtureByName(name)`
- `chooseImageParserFixture(fixtures, mode)`
- `scoreParserOutput({ expectedFields, actualFields, expectedTemplate, actualText })`

Supported request fields for parser stage:

```json
{
  "stage": "parser",
  "fixture": "payroll-deadline-001",
  "fixtureMode": "random",
  "runAll": false,
  "runtime": {}
}
```

Behavior:

- If `fixture` is present, run that named fixture.
- If `fixtureMode === 'random'` or no fixture is specified, choose one random fixture.
- If no manifests exist yet, fall back to current image-only random selection and set `benchmarkMode: false`.
- If manifests exist, set `benchmarkMode: true`.
- `runAll` can be deferred until Phase 2.4 if needed, but the API contract should reserve it.

### 7.3 Scoring

Add scoring output to the parser response and saved result.

Recommended scoring fields:

```js
{
  benchmark: {
    enabled: true,
    fixtureName: 'payroll-deadline-001',
    fieldScore: 0.89,
    exactTemplateMatch: false,
    matchedFields: ['coid', 'mid', 'caseNumber'],
    mismatchedFields: [
      {
        field: 'clientContact',
        expected: 'Jane Doe',
        actual: 'Jane D.',
        reason: 'value_mismatch'
      }
    ],
    missingFields: ['kbToolsUsed'],
    extraFields: [],
    passed: false
  }
}
```

Initial scoring should be strict and simple:

- Trim only outer whitespace.
- Compare strings exactly after normalizing CRLF to LF.
- Do not fuzzy-match in the first implementation.
- Count blank expected values as correct only when actual is also blank.
- Field score = matched required fields / total required fields.
- Benchmark pass = all expected fields match and canonical 9-label contract passed.

Defer fuzzy scoring to a later plan.

### 7.4 Model updates

Modify `server/src/models/ImageParserTestResult.js`.

Add fields:

- `benchmark`: Mixed, default `null`
- `benchmarkPassed`: Boolean, default `null`, index true
- `fieldScore`: Number, default `null`
- `fixtureName`: String, default `''`, index true
- `fixtureTags`: [String], default []
- `fixtureDifficulty`: String, default `''`

Keep `fixture` for compatibility, but add first-class fields for common queries.

### 7.5 Frontend fixture picker

Add API endpoint:

- `GET /api/pipeline-tests/parser-fixtures`

Response:

```json
{
  "ok": true,
  "fixtures": [
    {
      "name": "payroll-deadline-001",
      "description": "Payroll deadline screenshot with all required fields visible.",
      "tags": ["payroll", "deadline", "all-fields"],
      "difficulty": "medium",
      "imageUrl": "/api/pipeline-tests/image-fixtures/payroll-deadline-001.jpeg",
      "hasExpectedFields": true
    }
  ]
}
```

Client changes in `AgentTestModal` and `agentTestHarnesses.js`:

- Keep external test buttons simple: they only open the modal.
- Add parser fixture selection inside the modal:
  - `Random fixture`
  - list of named fixtures
  - later: `Run all fixtures`
- Default action remains one-click random fixture test inside the modal.
- If the user selects a named fixture, call `/api/pipeline-tests/run` with `fixture`.

Client changes in the modal parser result view:

- Show benchmark pass/fail separately from 9-label contract.
- Show field score, e.g. `Field score: 8/9`.
- Render mismatches in a compact diff table:
  - Field
  - Expected
  - Actual
- Keep the raw parsed text preview.

AgentsView changes:

- Add benchmark columns/tags:
  - `benchmark passed`
  - `field score`
  - fixture difficulty/tags
- Add breakdown by benchmark pass/fail.
- Existing operator Pass/Fail should remain. It is a human review result, not the same as automatic benchmark pass/fail.
- Any active rerun/test button in AgentsView still opens the shared modal.

### 7.6 Run-all mode

Add after single named fixture works.

Request:

```json
{
  "stage": "parser",
  "runAll": true,
  "runtime": {}
}
```

Behavior:

- Runs every manifest fixture sequentially.
- Emits SSE progress per fixture.
- Saves one `ImageParserTestResult` per fixture.
- Terminal response includes aggregate summary:
  - total
  - passed
  - failed
  - average field score
  - saved result ids

Guardrails:

- Require explicit `runAll: true`.
- Do not expose `Run all` until there are at least 2 manifest fixtures.
- Keep the existing in-flight lock active for the full batch.
- Include estimated cost warning in UI before running all if pricing data is available.

### 7.7 Phase 2 acceptance criteria

1. Operator can run a random fixture as before.
2. Operator can run a named fixture and get the same fixture every time.
3. Saved test result records include benchmark metadata when a manifest exists.
4. The UI distinguishes:
   - format contract pass/fail
   - automatic field benchmark pass/fail
   - human operator pass/fail
5. A mismatch table shows expected vs actual values.
6. Existing image-only fixtures still work during migration.
7. `GET /api/pipeline-tests/parser-fixtures` lists available fixtures.
8. Tests cover manifest loading, named fixture lookup, missing fixture, field scoring, and image-only fallback.

## 8. Phase 3: Audit Evidence

Phase 3 makes every saved test result explainable after the fact.

### 8.1 Persist provider and prompt evidence

Modify `ImageParserTestResult`.

Add fields:

- `providerTrace`: Mixed, default `null`
- `providerPackageId`: String, default `''`, index true
- `providerHarness`: String, default `''`
- `captureEnabled`: Boolean, default `null`
- `packageCaptureQueued`: Boolean, default `null`
- `packageCaptureStatus`: String, default `''`
- `promptId`: String, default `'escalation-template-parser'`
- `promptVersion`: String, default `''`
- `promptHash`: String, default `''`
- `promptLength`: Number, default `0`
- `stageEvents`: [Mixed], default []
- `stageEventCount`: Number, default 0

Prompt hash:

- Compute SHA-256 of the rendered prompt text used for the test.
- Store prompt id, version if parseable from first line (`PROMPT_VERSION: P24`), prompt length, and hash.

Provider trace:

- Store the provider trace returned by `parseImage()` after redaction.
- Promote `providerTrace.providerPackageId` to first-class `providerPackageId`.

Stage events:

- Use the existing `createStageEventBus().flush()` buffer.
- Store the buffered events on the result record.
- Keep existing event clamping from `stage-events.js`; do not store unbounded event streams.

### 8.2 API and UI

Parser response:

- Include `providerPackageId`.
- Include `promptVersion`.
- Include `stageEventCount`.
- Include `auditStatus`:

```js
{
  auditStatus: {
    promptCaptured: true,
    providerTraceCaptured: true,
    providerPackageId: '...',
    stageEventsCaptured: true
  }
}
```

Agent Test Modal result view:

- Add small audit chips:
  - `Prompt P24`
  - `Provider package captured`
  - `14 events saved`
- If provider package is missing, show a warning chip only in test/audit context.

AgentsView preview modal:

- Add an Audit section:
  - provider
  - model
  - provider package id
  - prompt id/version/hash
  - capture status
  - stage event count

### 8.3 Tests

Add tests for:

1. Saved parser test result includes provider package id when `parseImage()` returns one.
2. Saved parser test result includes prompt id/version/hash.
3. Saved parser test result includes stage events from the SSE bus.
4. API serialization includes audit fields.
5. UI can render missing audit fields without crashing.

### 8.4 Phase 3 acceptance criteria

1. Every saved parser test result records prompt id and prompt hash.
2. Provider package id is saved when available.
3. Stage event count is saved and visible in the result detail.
4. AgentsView preview can answer "which provider call produced this output?"
5. No secrets or raw API keys are stored in the test result.

## 9. Phase 4: Expand Modal Inputs and Current-Image Tests

Phase 4 expands the shared modal beyond the saved-fixture parser test.

### 9.1 Parser modal input modes

Inside the Agent Test Modal for the parser harness:

- `Run saved fixture`
- `Test current image` only when the launch context includes a current screenshot
- `Run all fixtures` if Phase 2 run-all mode is complete

Behavior:

- `Run saved fixture` uses `/api/pipeline-tests/run`.
- `Test current image` should use the same parser runtime but sends the currently uploaded image.
- Current-image test can save as `ImageParserTestResult` with `fixture.source: 'current-image'`.
- Current-image test should not require an expected-answer manifest.
- If the current image came from a user escalation, label the result as ad hoc and avoid mixing it into benchmark pass-rate stats unless the operator later adds expected fields.
- External launch buttons should not expose separate current-image/saved-fixture paths. They open the modal; the modal chooses available modes from harness capabilities and launch context.

### 9.2 Cancellable test runs

Extend cancellation support for all modal-hosted tests:

- Client uses an `AbortController` for the SSE request.
- Server listens for `req.close`.
- If client disconnects, cancel/abort provider work where supported.
- For a pre-result cancel, no pass/fail result is recorded.
- If a saved record is created before cancellation, record cancellation separately from human `status`; do not overload `pass`/`fail`/`pending-review`.

If adding persistent cancellation state feels too broad, defer persistence and only support client-side abort initially.

### 9.3 Promote failed benchmark into fixture work

For failed benchmark results:

- Add an action in AgentsView: `Create fixture issue note`.
- It should not edit files automatically in this phase.
- It can copy or display a structured note containing:
  - fixture name
  - provider/model
  - prompt version/hash
  - mismatched fields
  - parsed text

### 9.4 Phase 4 acceptance criteria

1. The modal clearly separates saved-fixture testing from current-image testing.
2. Current-image testing is available only when an image exists in the launch context.
3. Current-image test results do not pollute benchmark pass-rate stats.
4. User can cancel a long parser test from the UI.
5. Failed benchmark results can be turned into a clear fixture-debug note.

## 10. Phase 5: Future Agent Harnesses

Phase 5 wires additional agents into the same modal after the parser flow is stable.

### 10.1 Harness contract

Every future agent harness should register:

- `agentId`
- `label`
- `description`
- `supportsFixtures`
- `supportsCurrentContext`
- `run(options)`
- `cancel(runId)` if server-side cancellation is available
- `patchResult(resultId, status)`
- `renderSetup(props)`
- `renderResult(props)`
- `resultHistoryHref` if an AgentsView history tab exists

The modal owns common chrome and behavior:

- title
- launch source
- setup/running/result/error/cancelled states
- close/cancel behavior
- Pass/Fail action placement
- auto-close after recorded Pass/Fail
- pending-review close behavior

The harness owns only agent-specific inputs and result rendering.

### 10.2 Candidate migrations

Migrate agents one at a time:

1. Escalation Image Parser: first and required by this plan.
2. Triage Agent: likely next because the current checkout already has a dedicated triage test route and result model.
3. INV Search Agent: after a stable fixture format exists for parser text/fields.
4. QBO Assistant: after assistant test outputs and pass/fail criteria are defined.

### 10.3 Phase 5 acceptance criteria

1. Adding a new agent test does not create a second modal or separate test UI pattern.
2. The same launch API works from Chat, AgentsView, and future surfaces.
3. Each agent can provide its own harness without changing modal lifecycle code.
4. Modal close/cancel/pass/fail behavior remains consistent across agents.

## 11. Data Contracts

### Modal launch request

Client-only contract for opening the shared modal:

```js
{
  agentId: 'escalation-template-parser',
  stageKey: 'parser',
  launchSurface: 'chat-stage-card' | 'agent-profile' | 'agents-dashboard',
  context: {
    conversationId: '...',
    currentImageDataUrl: null,
    hasCurrentImage: false
  }
}
```

Rules:

- `agentId` selects the harness.
- `launchSurface` is analytics/debug context only. It must not fork the test workflow.
- `context` can expose optional current-page data, but the harness decides whether it can use it.
- The same `agentId` must open the same modal workflow from every surface.

### Harness descriptor

Client harness registration shape:

```js
{
  agentId: 'escalation-template-parser',
  label: 'Escalation Image Parser',
  stageKey: 'parser',
  supportsFixtures: true,
  supportsCurrentContext: false,
  run(options) {},
  cancel(runId) {},
  patchResult(resultId, status) {},
  renderSetup(props) {},
  renderResult(props) {}
}
```

### Parser run response

Target shape after Phases 1-3:

```js
{
  ok: true,
  stage: 'parser',
  testRun: true,
  saved: true,
  saveStatus: 'saved',
  saveReason: '',
  alert: 'Parser test saved for review.',
  imageFixture: {
    name: 'payroll-deadline-001',
    url: '/api/pipeline-tests/image-fixtures/payroll-deadline-001.jpeg',
    source: 'image-fixture',
    fixtureCount: 12
  },
  benchmark: {
    enabled: true,
    passed: false,
    fieldScore: 0.89,
    matchedFields: [],
    mismatchedFields: [],
    missingFields: [],
    extraFields: [],
    exactTemplateMatch: false
  },
  savedTestResultId: '...',
  savedTestResult: {},
  providerUsed: 'openai',
  modelUsed: 'gpt-5.4-mini',
  elapsedMs: 12345,
  usage: {},
  apiCost: {},
  text: 'COID/MID: ...',
  parseFields: {},
  parseMeta: {},
  providerTrace: {},
  providerPackageId: '...',
  promptId: 'escalation-template-parser',
  promptVersion: 'P24',
  stageEventCount: 14,
  auditStatus: {
    promptCaptured: true,
    providerTraceCaptured: true,
    providerPackageId: '...',
    stageEventsCaptured: true
  },
  caseIntake: {}
}
```

### Human grading vs automatic scoring

Keep these separate:

- `status`: human review status, one of `pending-review`, `pass`, `fail`.
- `canonicalPassed`: required 9-label format result from parser validation.
- `benchmarkPassed`: automatic expected-field result from fixture manifest.
- `fieldScore`: automatic field-level score.

Do not redefine `status` to mean automatic benchmark pass/fail.

## 12. Testing Strategy

Server tests:

- `server/test/pipeline-parser-tests-routes.test.js`
- Possible helper tests for field scoring, either in that file or `server/test/pipeline-parser-fixtures.test.js`.

Important server scenarios:

- Parser branch does not need `escalation-case.json`.
- SSE success response.
- JSON fallback success response.
- DB available save path.
- DB unavailable temporary result path.
- Save failure does not fail parser response.
- Already-running lock.
- Disabled agent.
- Named fixture selection.
- Missing fixture returns clear 404 or 400.
- Image-only fallback when no manifests exist.
- Benchmark field scoring exact match.
- Benchmark field scoring mismatches/missing fields.
- Prompt hash capture.
- Provider package id capture.
- Stage event persistence.
- PATCH pass/fail/pending-review lifecycle.
- Request-close cancellation path for modal close.

Frontend tests:

- Chat Stage 2 parser test action opens `AgentTestModal`.
- Escalation Image Parser profile test action opens the same modal path.
- The modal selects the parser harness for `agentId: 'escalation-template-parser'`.
- Running state renders inside the modal.
- Saved result shows Pass/Fail controls inside the modal.
- Unsaved result hides Pass/Fail controls and shows a warning inside the modal.
- Closing while running aborts/cancels the request.
- Closing after completion without Pass/Fail leaves the saved record pending.
- Clicking Pass PATCHes the saved result and auto-closes the modal.
- Clicking Fail PATCHes the saved result and auto-closes the modal.
- The chat right dock does not render parser test output.
- The modal parser result view renders benchmark score and mismatch table.
- AgentsView renders benchmark fields and audit chips in history/detail views.

Manual verification:

1. Start app locally.
2. Open main chat page.
3. Open Stage 2 three-dot menu.
4. Click the parser test action and confirm the shared modal opens.
5. Run the saved-fixture parser test from the modal.
6. Watch parser stage events stream inside the modal.
7. Confirm the chat right dock does not show temporary parser test output.
8. Confirm the modal shows fixture name, preview, parser output, validation, cost, and save state.
9. Close the completed modal without Pass/Fail and confirm the saved result remains pending-review.
10. Run the test again, click Pass, and confirm the modal auto-closes after the PATCH succeeds.
11. Open the Escalation Image Parser profile page and click its test button. Confirm it opens the same modal workflow.
12. Open AgentsView parser test results and confirm the run appears.
13. Run named fixture twice and confirm it uses the same fixture both times.
14. Confirm benchmark mismatch output appears in the modal when expected fields differ.
15. Confirm provider package id/prompt hash/audit fields appear in result detail.

Do not use live provider calls in automated tests. Manual live-provider verification is acceptable but should be called out as cost-bearing.

## 13. Rollout Sequence

Recommended order:

1. Create `AgentTestModalProvider`, `AgentTestModal`, and parser harness registration without wiring any launch point yet.
2. Wire the Chat Stage 2 parser test action to open the modal.
3. Move parser test SSE consumption, output rendering, and Pass/Fail behavior into the modal.
4. Wire the Escalation Image Parser profile test button to the same modal opener.
5. Add close-to-cancel behavior on client and server.
6. Phase 1 backend route cleanup and response fields.
7. Phase 1 route and modal tests.
8. Phase 2 fixture manifest loader and scoring helper.
9. Add 3 starter manifests only after the loader has tests.
10. Phase 2 named fixture API and modal fixture picker.
11. Phase 2 benchmark display in the modal and AgentsView.
12. Phase 2 run-all mode in the modal or AgentsView, not the compact card menu.
13. Phase 3 audit evidence persistence.
14. Phase 3 audit display.
15. Phase 4 current-image testing and cancellation hardening.
16. Phase 5 future-agent harness migrations.

Stop after each phase for a browser check. The test flow is UI-visible and provider-sensitive, so do not batch all phases into one large change.

## 14. Rollback

Phase 1 rollback:

- Remove `AgentTestModalProvider` from `App.jsx`.
- Remove `AgentTestModal`, `AgentTestModal.css`, and `agentTestHarnesses.js`.
- Revert Chat Stage 2 parser test action to its previous local `runStageTest('parser')` behavior.
- Revert AgentsView parser profile test buttons to their previous behavior.
- Revert `pipeline-tests.js` parser response field changes and route fixture-read move.
- Remove `server/test/pipeline-parser-tests-routes.test.js`.

Phase 2 rollback:

- Remove fixture manifest endpoint and loader helpers.
- Remove benchmark scoring from route responses and saved results.
- Leave image fixtures in place.
- If schema fields were added to `ImageParserTestResult`, they can remain harmlessly unused unless a clean rollback is required.

Phase 3 rollback:

- Stop writing audit fields.
- Hide audit chips/details in UI.
- Existing saved records with audit fields can remain.

Phase 4 rollback:

- Remove current-image test mode from the modal.
- Remove cancel controls.
- Keep saved-fixture test flow unchanged.

Phase 5 rollback:

- Remove the migrated non-parser harness descriptor.
- Keep `AgentTestModal` and the parser harness in place.

No destructive database migration is required. At most, old test result documents will contain extra optional fields.

## 15. Open Decisions

Decide before Phase 2 implementation:

1. Should fixture manifests live beside images, or should images move under an `images/` subfolder?
2. Should the first benchmark be strict exact-match only, or should whitespace/case normalization be allowed?
3. Should `Run all fixtures` be exposed from the modal, AgentsView, or both?
4. For future current-image tests, should ad hoc results be saved automatically as pending-review after completion, or require explicit "Save result" confirmation?
5. Should benchmark pass/fail influence the green/yellow/red card health dots, or remain only in the test-results panel?

Recommended defaults:

1. Keep current image paths for now and add manifests beside images to reduce migration risk.
2. Use strict exact-match first.
3. Put `Run all fixtures` in the modal and AgentsView, not the compact chat card menu.
4. Persist saved-fixture parser tests automatically as pending-review; defer current-image persistence until that mode is designed.
5. Keep benchmark results separate from health dots until there is enough history to define reliability thresholds.
