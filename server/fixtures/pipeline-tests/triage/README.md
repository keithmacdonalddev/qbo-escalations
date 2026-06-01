# Triage Agent Test Fixtures

The Stage 4 (Triage Agent) test route picks one of these JSON files at random
each time the operator clicks the workflow card's three-dot menu and chooses
"Test stage". The selected fixture supplies the `parserText` and `parseFields`
that the triage agent will reason about, so each fixture is a self-contained
representative escalation case.

## Fixture shape

Every file in this folder must be valid JSON with the following keys:

| Key            | Type                | Required | Notes                                                                                                                                                                                                                                                |
| -------------- | ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | string              | yes      | Short stable identifier shown in dashboards, e.g. `P2-bank-feeds-stale`. Operators see this in the AgentsView results breakdown.                                                                                                                      |
| `description`  | string              | yes      | One-sentence explanation of the scenario so a reviewer can understand the fixture at a glance.                                                                                                                                                       |
| `tags`         | array of strings    | yes      | Free-form labels like `severity-p1`, `category-payroll`, `deadline-today`. Used as hints in the AgentsView panel and to drive future filtering.                                                                                                       |
| `schemaVersion`| number              | yes      | Versioning hook. Always `1` today. Bump when the loader needs new required keys.                                                                                                                                                                     |
| `parserText`   | string (multiline)  | yes      | The full canonical 9-label escalation template text the parser would have returned. Treat this as if the image parser already ran.                                                                                                                  |
| `parseFields`  | object              | yes      | The structured parse fields (coid, mid, caseNumber, clientContact, attemptingTo, expectedOutcome, actualOutcome, kbToolsUsed, triedTestAccount, tsSteps, category) that the parser would have extracted from the same template.                       |

The triage agent reads `parserText` and `parseFields` together — both must
agree. If they disagree, the test is still valid (it exercises the agent's
recovery behavior) but the operator note should call that out.

## Starter fixtures

| File                              | Why it exists                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-payroll-outage.json`          | Final paycheck blocked by PSE_TERM_DATE_AFTER_PERIOD on termination day. Tests that the agent picks P1 + payroll + deadline-today framing.               |
| `P2-bank-feeds-stale.json`        | Connected bank feed stale 9 days, reconciliation deadline tomorrow. Tests P2 routing and missing-info handling where the customer already tried things.  |
| `P3-reports-permission.json`      | Permission ambiguity: admin says permissions are on, user still blocked. Exercises the `categoryCheck` path between `reports` and `permissions`.         |
| `P2-invoicing-missing-fields.json`| Recurring invoice template silently failed. `tsSteps` is the empty string, which exercises the rule-fallback path when the agent can't reach high confidence. |
| `P4-reconciliation-question.json` | Pure how-to question about a $0.01 reconciliation discrepancy. Tests that the agent produces a brief, high-confidence answer rather than over-escalating.|

## Adding a new fixture

Drop a new `*.json` file in this folder that matches the shape above. The
loader reads the directory at request time, so no server restart is needed —
the next test run will see your fixture and may pick it.

Conventions:

- File name should start with the severity (`P1`/`P2`/`P3`/`P4`) so the
  AgentsView breakdown sorts naturally.
- Keep `description` to one sentence and put the "why this fixture exists"
  detail in this README so the file itself stays small.
- Use realistic but obviously synthetic COIDs/MIDs/case numbers. Never paste
  real customer data.
