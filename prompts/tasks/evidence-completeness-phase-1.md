# Claude Implementation Prompt: Evidence Completeness — Phase 1 Detection

Paste this entire file into Claude Code from the repository root.

## Objective

Implement the first production-quality slice of the existing **Evidence Completeness Check** described in `FEATURES.md`.

## User goal

After a QBO escalation workflow finishes, the user must be able to tell whether every important result produced by the expert-agent team was actually saved. A workflow that appears successful but silently lost its triage card, parsed fields, known-issue matches, stage events, or analyst result must show a clear and useful warning.

This supports the broader platform by making shared workflow evidence trustworthy. It deliberately does **not** attempt automatic repair or recovery in Phase 1.

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

Cover the primary **chat-v5 QBO escalation workflow** and its saved Sessions experience. Inspect the live source before deciding exact files or data shapes.

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

Add an evidence status to the appropriate saved Sessions surface, preferably the Audit tab unless the live UI establishes a more suitable location.

For an incomplete run, display a prominent but non-destructive warning using plain language, for example:

> Evidence incomplete: Triage completed, but its triage card was not saved.

The user must be able to see:

- exactly what evidence is missing;
- which stage or agent was responsible;
- whether the evidence failed to save, was unsupported, expired, or cannot be verified;
- relevant safe trace or request identifiers that help investigate the problem;
- that recovery is not yet automatic and what the user can safely do now.

Complete runs should receive a quiet positive status rather than a distracting banner. Legacy or unverifiable runs should display a neutral `unknown` explanation rather than implying success or failure.

Do not add a working “Retry” action in Phase 1. A disabled or informational future-recovery control is acceptable only if it is genuinely helpful and clearly labeled as unavailable; otherwise omit it.

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
10. The Sessions UI renders complete, incomplete, and unknown states correctly.
11. Existing case-intake, triage-result persistence, stage-event, trace, and session behavior remains passing.

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
    - which workflow artifacts are checked;
    - how `complete`, `incomplete`, and `unknown` are decided;
    - what remains outside Phase 1;
    - each Codex task used and how Claude verified it;
    - exact tests run and their results;
    - any concurrent-work risk or unverified limitation.
11. When the work is complete and verified, commit and push only the files belonging to this feature. Stage explicit paths so unrelated concurrent changes are excluded.

## Definition of done

Phase 1 is done only when a saved chat-v5 pipeline run can truthfully tell a regular user whether its expected evidence is complete, identify a proven gap without false alarms, display that result in Sessions, pass focused regression tests, and preserve all existing useful results. Automatic recovery remains a separate Phase 2 task.
