# Claude Implementation Prompt: Evidence Completeness — Phase 1 Detection

Paste this entire file into Claude Code from the repository root.

## Objective

Implement the first production-quality slice of the existing **Evidence Completeness Check** described in `FEATURES.md`. The result must improve the user's quality of life by replacing uncertainty and manual checking with a clear answer about what was safely saved, what remains trustworthy, and what the user should do next.

## User goal

After a QBO escalation workflow finishes, the user must be able to tell whether every important result produced by the expert-agent team was actually saved, without inspecting technical records or reopening several screens. A workflow that appears successful but silently lost its triage card, parsed fields, known-issue matches, stage events, or analyst result must show a clear and useful warning.

The experience must reduce uncertainty, mental bookkeeping, repeated work, and fear of leaving the page. It should help the user continue with unaffected results instead of treating one missing artifact as if the entire workflow were useless.

This supports the broader platform by making shared workflow evidence trustworthy. It deliberately does **not** attempt automatic repair, regeneration, or server-side recovery in Phase 1. It may safely help the user copy or download an already-visible unsaved result so their work is not lost.

## Codex collaboration requirement

Use the connected Codex MCP server for substantive, bounded sub-agent work during this task. Its configured default is GPT-5.6 Sol with medium reasoning; do not override that default for ordinary delegated work.

Before every Codex call, show me:

> Using Codex (GPT-5.6 Sol, medium) for: `<short description>`

After every Codex response, show me:

> Codex returned: `<one-sentence result>`. Claude verification: pending.

Claude must then independently inspect and verify Codex's evidence or edits before accepting them. Treat Codex output as a proposal, not proof. Claude remains responsible for the final implementation, tests, and report.

Confirm that the `codex` MCP server is connected before promising to use it. If it is unavailable, stop and tell me that this Codex collaboration test cannot proceed; do not silently substitute another agent.

Start by delegating a **read-only workflow and persistence audit** to Codex. Give it `C:\Projects\qbo-escalations` as its working directory and ask it to trace:

- which artifacts the chat-v5 escalation workflow produces;
- how the app knows which stages were expected, attempted, completed, failed, or skipped;
- where each artifact is saved;
- which trace, request, run, and provider-evidence identifiers connect those records;
- where output can be produced but silently fail to persist;
- which legacy or provider-capability cases could cause false warnings.

After implementing, use Codex again for a bounded, independent regression and edge-case review. Verify every finding yourself before changing or reporting anything.

## Safety and concurrent-work rules

1. Read `CLAUDE.md`, `PRODUCT_NORTH_STAR.md`, `FEATURES.md`, and the directly relevant source and tests before planning.
2. Run `git status` before editing and again before reporting.
3. Assume other sessions are modifying this worktree. Do not revert, overwrite, reformat, stage, commit, or clean up work you did not create.
4. Re-read every target file immediately before editing it.
5. If another session changes an overlapping file or edit ownership becomes unclear, stop and ask me before proceeding.
6. Do not start, stop, restart, reload, kill, or replace the application server, client dev server, gateway, MongoDB, or another persistent process.
7. Do not create a duplicate entry in `FEATURES.md`.
8. Do not expand this task into a platform-wide audit system, automatic recovery system, or unrelated UI redesign.

## First-slice scope

Cover the primary **chat-v5 QBO escalation workflow**, its live end-of-run experience, and its saved Sessions experience. Inspect the live source before deciding exact files or data shapes.

Create one central, deterministic evidence-completeness contract. “Deterministic” means the same saved facts must always produce the same result without asking an AI model to judge completeness. Do not scatter independent completeness guesses through React components.

For one pipeline run, produce a structured result that includes the equivalent of:

- `status`: `complete`, `incomplete`, or `unknown`;
- `checkedAt`;
- a version for the evidence contract;
- stages expected and stages actually attempted;
- artifacts expected from each applicable stage;
- artifacts confirmed as saved;
- missing artifacts, each with a stable code, plain-language label, responsible stage, and explanation;
- why an artifact was not applicable or could not be verified;
- relevant conversation, pipeline-run, trace, request, or provider-package identifiers when available.

Use existing naming and data conventions when they are sound. The example above defines required meaning, not an imposed storage format.

## Evidence comparison requirement

The feature must compare what the workflow **actually produced or attempted to produce** with what the saved session contains. Checking only the final saved record is insufficient because absence alone cannot prove whether an artifact was never produced or was produced and lost.

Inspect whether the current stage events, case-intake runs, AI traces, provider-package references, or other records already provide a reliable production receipt. If they do not, add the smallest safe run receipt or artifact manifest needed to record:

- the stage and attempt;
- outcome status;
- which artifact types were produced;
- stable identifiers or safe hashes needed for comparison;
- persistence outcome;
- timestamps and relevant request/trace links.

Do not duplicate full sensitive payloads merely to perform this check.

## Correctness rules

1. Require evidence only for stages that were actually applicable and attempted.
2. A deliberately skipped, disabled, or inapplicable stage is not missing evidence.
3. A failed stage must preserve honest failure evidence, but it must not be treated as if it produced a successful artifact.
4. Distinguish these cases whenever current evidence allows it:
   - not produced;
   - produced but not saved;
   - capture unsupported by the provider or transport;
   - capture disabled by configuration;
   - retained evidence expired;
   - impossible to determine from a legacy record.
5. Do not require readable model reasoning when the selected provider or transport cannot capture it.
6. Do not label older sessions incomplete merely because they predate this contract. Return `unknown` unless a real gap can be proved.
7. Do not expose API keys, secrets, credentials, unrestricted raw prompts, unredacted provider payloads, or sensitive filesystem paths.
8. Do not invent, regenerate, or silently repair missing agent output in Phase 1.
9. An incomplete-evidence warning must not erase useful workflow results or prevent the user from opening the session.
10. Avoid timing races: do not mark a run incomplete while an expected save is still legitimately in progress. Define when a run is settled and safe to evaluate.
11. Re-evaluation must be idempotent—running the same check repeatedly must not create duplicate records or conflicting results.

## Minimum user experience

Show the evidence status where it helps the user make a decision, not only where a developer would investigate it. At minimum, cover:

- the affected stage in the live workflow;
- a brief end-of-run summary;
- the saved session row or equivalent session overview;
- the Sessions Audit tab for expanded details.

For an incomplete run, display a prominent but non-destructive warning using plain language, for example:

> Evidence incomplete: Triage completed, but its triage card was not saved.

The user must be able to see:

- exactly what evidence is missing;
- which stage or agent was responsible;
- whether the evidence failed to save, was unsupported, expired, or cannot be verified;
- which results are still safely saved and usable;
- what decision or later work could be affected by the missing result;
- what the user can safely do now;
- relevant safe trace or request identifiers in expandable technical details.

Complete runs should receive a quiet positive status rather than a distracting banner. Legacy or unverifiable runs should display a neutral `unknown` explanation rather than implying success or failure.

Do not add a working “Retry” action in Phase 1. A disabled or informational future-recovery control is acceptable only if it is genuinely helpful and clearly labeled as unavailable; otherwise omit it.

## Quality-of-life requirements

The evidence checker must reduce uncertainty and protect the user's work, not merely produce an audit status.

### 1. End-of-run confidence summary

After every settled workflow, show a brief summary such as:

> Workflow complete — 5 of 5 expected results safely saved.

For an incomplete workflow, summarize the impact rather than showing only a count:

> Workflow finished with 1 unsaved result — your analyst response is safe, but the triage priority may be lost when you leave.

The summary must come from the central evidence contract rather than a second client-only guess.

### 2. “What can I trust?” explanation

For incomplete or unknown evidence, clearly separate:

- results confirmed as saved and still usable;
- results missing or unsafe to rely on after leaving the page;
- results whose status cannot be proved;
- decisions or downstream work that could be affected;
- parts of the workflow the user does **not** need to repeat.

Prefer plain guidance such as:

> Your screenshot extraction, known-issue matches, and analyst response are saved. The triage priority was not saved. You do not need to repeat the screenshot analysis.

Do not make the user translate raw artifact codes, trace states, or provider errors to understand the practical impact.

### 3. Protect currently visible unsaved work

If a result is still visible in the current browser session but is not confirmed as saved:

- keep it visible rather than clearing it because persistence failed;
- label it clearly as **Not saved**;
- offer Copy and, when consistent with existing UI patterns, Download so the user can manually preserve the exact visible result;
- warn before route navigation, session switching, refresh, or closing when the app can reliably detect that leaving would discard the only remaining copy;
- remove the leave warning as soon as the result is safely saved, manually cleared by the user with confirmation, or no longer at risk.

Copy or Download must use the already-visible result. It must not call an AI model, regenerate content, mutate the saved session, or pretend that manual export completed server-side recovery.

If browser or platform limitations make one navigation-warning case unreliable, implement the safe cases and document the limitation instead of claiming complete protection.

### 4. Show problems in context

Do not require the user to discover an important problem later in the Audit tab. Surface it beside the affected live stage and in the end-of-run summary. Keep the saved session visibly marked so the problem is not forgotten after the user leaves the live workflow.

The Audit tab should provide deeper evidence and identifiers, not be the only place that explains whether the user's work is safe.

### 5. Give a safe next step

Every incomplete state must include a plain-language next step that is valid without Phase 2. Examples include:

- copy or download an unsaved result that is still visible;
- continue using named unaffected results;
- avoid relying on a named missing result;
- keep the page open until a pending save settles;
- open the session's evidence details for investigation.

Do not imply that a manual workaround repaired the saved session. Clearly state that automatic or server-side recovery is not yet available.

### 6. Avoid alert fatigue

- Successful runs receive a quiet, temporary confirmation and a durable low-emphasis status in Sessions.
- Incomplete runs remain visibly marked until the evidence becomes complete through a later supported workflow or the user explicitly acknowledges the unresolved risk.
- Acknowledgement must not change `incomplete` to `complete` or hide the underlying finding from Audit history.
- Unknown legacy sessions receive a neutral explanation, not an alarming failure banner.
- Combine multiple missing artifacts into one understandable summary with expandable item details rather than showing repeated warnings.

### 7. Use progressive detail

Lead with three answers:

1. What happened?
2. What can I still trust?
3. What should I do now?

Keep trace IDs, request IDs, provider-package IDs, hashes, and raw error details behind an expandable **Technical details** section. These details must remain available for investigation without overwhelming a regular user.

## Required verification

Add focused, deterministic tests for at least:

1. A complete successful pipeline.
2. Triage completed but `triageCard` was not persisted.
3. Parsed fields or another applicable stage artifact was produced but not persisted.
4. A stage was deliberately skipped, disabled, or not applicable.
5. A stage failed and retained truthful failure evidence.
6. Provider reasoning capture was unsupported or disabled.
7. Evidence retention expired while the core session remains.
8. A legacy session without the new evidence contract.
9. Re-evaluating the same run does not create duplicates or conflicting state.
10. The live workflow and Sessions UI render complete, incomplete, and unknown states correctly.
11. A complete run shows a quiet end-of-run confidence summary with the correct saved/expected count.
12. An incomplete run explains which results remain trustworthy, which result is unsafe, and which work does not need to be repeated.
13. A visible unsaved result remains on screen, is labeled `Not saved`, and can be copied or downloaded without an AI or persistence call.
14. Navigation protection appears only while a known unsaved visible result is genuinely at risk and clears when that risk ends.
15. Incomplete status is visible in context and in Sessions without requiring the Audit tab, while technical identifiers remain behind expandable details.
16. Multiple missing artifacts produce one understandable summary rather than repeated warning noise.
17. Acknowledging a warning does not falsify or erase the underlying incomplete finding.
18. Existing case-intake, triage-result persistence, stage-event, trace, and session behavior remains passing.

Use the repository's existing test style. Run focused tests first, then the appropriate client build or static check and any wider test set justified by the files changed. Do not launch persistent services for verification.

## Delivery process

1. Inspect the product hierarchy, existing feature description, observability review, case-intake workflow, conversation persistence, `AiTrace`, relevant `ProviderCallPackage` links, chat-v5 stage orchestration, Sessions UI, and focused tests.
2. Call Codex for the initial bounded read-only audit and visibly announce the call.
3. Verify Codex's findings from current source.
4. Present a concise implementation plan before editing. Explain the user-visible behavior and the evidence contract in plain language.
5. Implement the smallest coherent production slice without watering down the correctness rules.
6. Call Codex for an independent regression and edge-case review and visibly announce the call.
7. Verify Codex's review yourself and fix confirmed problems.
8. Run proportionate verification and inspect the final diff.
9. Update directly relevant documentation if behavior or supported evidence changed. Do not add a duplicate feature entry.
10. Report:
    - what regular users can now see;
    - how the change reduces uncertainty, protects visible work, and prevents unnecessary repetition;
    - which workflow artifacts are checked;
    - how `complete`, `incomplete`, and `unknown` are decided;
    - what Copy, Download, or navigation protection is available for visible unsaved work;
    - how the UI answers “What can I trust?” and “What should I do now?”;
    - what remains outside Phase 1;
    - each Codex task used and how Claude verified it;
    - exact tests run and their results;
    - any concurrent-work risk or unverified limitation.
11. When the work is complete and verified, commit and push only the files belonging to this feature. Stage explicit paths so unrelated concurrent changes are excluded.

## Definition of done

Phase 1 is done only when a chat-v5 pipeline run can truthfully tell a regular user whether its expected evidence is complete, reassure them when everything is safe, explain what remains trustworthy when something is missing, protect an already-visible unsaved result from accidental loss, give a safe next step, and preserve the warning across Sessions without overwhelming them with technical details. It must pass focused regression tests and preserve all existing useful results. Automatic regeneration, retry, and server-side recovery remain a separate Phase 2 task.
