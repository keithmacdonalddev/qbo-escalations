# Triage Agent Output Grade - Payroll Suspended Direct Deposit Case

## Scope

Reviewed the visible triage output for the escalation template screenshot, then checked the current prompt, parser, triage runtime, fallback rules, UI handoff, and focused tests on disk.

Screenshot case:

- Customer goal: pay employees via direct deposit.
- Actual outcome: payroll suspended.
- Tools/evidence: iBoss and CS Server show payroll suspended as of 12/26/2025.
- Blank/unclear fields: client/contact and expected outcome.

## Grades

- Visible triage output: **8/10**
- Triage Agent system prompt: **7/10**
- Harness/runtime around the triage agent: **6.5/10**
- Overall triage-agent part of workflow: **7/10**

## Visible Output Assessment

The output is directionally strong. Payroll is the right category, P3 is defensible from the provided template, and the next step is safe because it blocks payroll/DD processing until the suspension reason and reactivation path are verified. The quick read sticks to the supplied facts and does not hallucinate a suspension cause.

The main weakness is overconfidence. The card says confidence is high even though the template has no client/contact, no explicit expected outcome, no exact suspension code/reason, and no intended pay date. I would mark this **medium-high**: high category confidence, medium action/severity confidence.

The missing-info list is good but incomplete. It correctly asks for suspension reason, current payroll status, intended pay date, and payroll admin authorization. It should also ask for the exact suspension/hold message or internal status code, whether the direct deposit account is on hold versus the payroll subscription being suspended, affected employee/payroll count, and whether paper checks are needed if the customer must pay employees today.

The "handoff to payroll suspension/direct deposit support" step is operationally safe. It would be stronger if it included a customer-safe contingency: do not process DD until status is cleared; if payday is urgent, confirm supported paper-check fallback and disable direct deposit for that run. Intuit's public payroll docs support the importance of direct deposit lead times and, for direct-deposit blockers, paying workers by paper check when employees need to be paid today.

## Prompt Assessment

Strengths:

- The prompt is short and easy for models to follow.
- It forces the exact card fields the UI expects.
- It correctly says not to perform long research unless the harness provides tools.
- It tells the model to use the parsed template as source of truth.
- It emphasizes safe live-support handoff and smallest useful missing-info gaps.

Weaknesses:

- It does not define severity criteria. The model has to infer P1/P2/P3/P4, which makes urgency inconsistent.
- It does not define confidence criteria. The screenshot case is a good example: category confidence is high, but missing operational facts should lower overall confidence.
- It does not tell the model how to handle blank fields, stale dates, or internal-tool status language.
- It mentions optional retrieval results, but the current runtime does not pass INV matches or playbook snippets into the triage agent before it answers.
- It does not ask for a "why not P2" check when payroll/DD affects employee pay dates.

## Harness Assessment

Strengths:

- The runtime validates the expected labeled output shape and falls back to deterministic rule triage if the model output is malformed.
- Triage is emitted as a separate SSE `triage_card` artifact and saved into trace/case-intake metadata.
- Focused tests cover canonical template validation, labeled output parsing, fallback behavior, and a route-level `triage_card` event.
- The deterministic fallback prevents total workflow failure if the model fails or ignores the required format.

Weaknesses:

- The server regex parser can spill blank canonical fields into the next field. For this case shape, `CLIENT/CONTACT:` can become `CX IS ATTEMPTING TO: ...`, and blank `EXPECTED OUTCOME:` can become `ACTUAL OUTCOME: payroll suspended`. The canonical template validator allows the blank fields, so this can still pass semantic validation.
- The exact payroll suspended/direct deposit case is not covered by a golden test.
- Output validation only checks that required labels exist. It does not score whether confidence is justified, whether missing info is specific enough, or whether severity follows a policy.
- INV matching runs after triage, not before it, so the agent does not actually receive the planned "fast retrieval pack" in the current implementation.
- The plan calls for challenge/revision behavior, but the current implementation only supports initial card production and fallback, not versioned challenge handling.
- Some tests still use non-canonical fields like `AGENT`, while the canonical contract rejects non-canonical fields. That makes the contract/harness story harder to reason about.

## Highest-Value Fixes

1. Replace the server regex field extraction with the same line-by-line canonical parser approach used by the client preview, or make the regex stop after the same line for blank fields.
2. Add a golden test for this exact case: direct deposit payroll suspended in iBoss/CS Server, blank client, blank expected outcome.
3. Add explicit severity/confidence rubric to `prompts/agents/triage-agent.md`.
4. Move INV/playbook retrieval before model-backed triage and include the retrieval pack in `buildTriageAgentPromptInput`.
5. Add semantic validation for triage cards: confidence cannot be `high` when core operational fields are blank unless the card explains "high category confidence, medium action confidence."

## Verification

Commands run:

- `node --test server/test/chat-triage.test.js server/test/chat-request-triage-context.test.js server/test/escalation-parser.test.js server/test/escalation-template-contract.test.js server/test/parse-validation.test.js`
- `node --test --test-name-pattern "POST /api/chat emits triage_card for parsedEscalationText handoff" server/test/integration-routes.test.js`
- Inline Node check of this screenshot's canonical text against `parseEscalationText`, `validateParsedEscalation`, `validateCanonicalEscalationTemplateText`, `buildParserDerivedTriageContext`, and `buildServerTriageCard`.

All focused tests passed. The inline check exposed the blank-field spillover risk described above.
