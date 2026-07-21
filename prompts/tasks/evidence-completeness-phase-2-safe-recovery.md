# Claude Implementation Prompt: Evidence Completeness — Phase 2 Safe Recovery

Paste this entire file into Claude Code from the repository root **only after Phase 1 has been implemented, verified, committed, and pushed**.

## Objective

Extend the Evidence Completeness Check with safe, user-controlled recovery. When the app proves that expected workflow evidence is missing, help the user recover it without duplicating successful work, hiding the original failure, unexpectedly spending money, or overwriting valid evidence.

## User goal

A regular user who sees “Evidence incomplete” should not be left at a dead end. The app should explain what can be recovered, what the recovery will do, what it may cost, what could be affected, and whether human review is still required.

This supports the broader platform by helping the expert-agent team restore a trustworthy shared record. It deliberately does **not** introduce invisible automatic retries, unrestricted workflow replay, or permission to repeat external actions without confirmation.

## Prerequisite gate

Before planning or editing:

1. Confirm that Phase 1 is present in the current source, not merely described in a prompt or plan.
2. Run its focused tests and confirm the evidence checker reliably distinguishes `complete`, `incomplete`, and `unknown`.
3. Inspect the final Phase 1 evidence contract and UI rather than assuming the original prompt's proposed data shape was used.
4. Confirm the Phase 1 commit is present on the current branch and that the branch/worktree state is safe.

If Phase 1 is absent, incomplete, failing, uncommitted, or too unreliable to drive recovery, stop and report the blocker. Do not build recovery on guessed or untrusted completeness results.

## Codex collaboration requirement

Use the connected Codex MCP server for substantive, bounded sub-agent work during this task. Its configured default is GPT-5.6 Sol with medium reasoning; do not override that default for ordinary delegated work.

Before every Codex call, show me:

> Using Codex (GPT-5.6 Sol, medium) for: `<short description>`

After every Codex response, show me:

> Codex returned: `<one-sentence result>`. Claude verification: pending.

Claude must independently inspect and verify Codex's evidence or edits before accepting them. Treat Codex output as a proposal, not proof. Claude remains responsible for the final recovery design, implementation, tests, and report.

Confirm that the `codex` MCP server is connected before promising to use it. If it is unavailable, stop and tell me that this Codex collaboration test cannot proceed; do not silently substitute another agent.

Start by delegating a **read-only recovery-safety audit** to Codex. Give it `C:\Projects\qbo-escalations` as its working directory and ask it to map:

- each Phase 1 missing-evidence code to possible recovery strategies;
- which recovery can reuse an already-produced result without another AI call;
- which recovery requires rerunning one AI stage;
- provider cost, duplicate-write, overwrite, race, and stale-downstream-result risks;
- how existing trace, run, attempt, and provider-evidence records can preserve the original failure and link the recovery;
- which cases must remain manual review because a safe recovery path cannot be proved.

After implementation, use Codex again for an independent destructive-action, concurrency, cost, and regression review. Verify every finding yourself.

## Safety and concurrent-work rules

1. Read `CLAUDE.md`, `PRODUCT_NORTH_STAR.md`, the finished Phase 1 implementation, and directly relevant source/tests before planning.
2. Run `git status` before editing and again before reporting.
3. Assume other sessions are modifying the worktree. Do not revert, overwrite, reformat, stage, commit, or clean up work you did not create.
4. Re-read every target file immediately before editing it.
5. If another session changes an overlapping file or edit ownership becomes unclear, stop and ask me.
6. Do not start, stop, restart, reload, kill, or replace persistent application services.
7. Do not create a duplicate `FEATURES.md` entry.
8. Do not broaden this phase into a generic workflow automation engine or automatic retry of every provider failure.

## Recovery priority order

Choose the safest recovery that can restore the missing evidence:

1. **Retry persistence only:** If the original output still exists in trustworthy live or durable evidence, save that exact output without calling an AI provider again.
2. **Rebuild a derived record:** If the missing item is a deterministic view or index that can be rebuilt exactly from durable source evidence, rebuild only that item without another AI call.
3. **Rerun one isolated agent stage:** If the original output is unavailable but the stage input is complete and trustworthy, offer a confirmed rerun of only that stage.
4. **Human review required:** If inputs are missing, the stage cannot be isolated, downstream effects are unclear, or recovery could repeat an external action, do not offer an unsafe retry.

Never choose a more expensive or destructive strategy when a safer earlier option is available.

## Recovery plan contract

Before performing recovery, produce a deterministic recovery plan using the existing Phase 1 finding. The plan should include the equivalent of:

- stable recovery-plan ID;
- conversation and pipeline-run IDs;
- missing-evidence code being addressed;
- recovery strategy: `repersist`, `rebuild`, `rerun-stage`, or `manual-review`;
- affected stage and artifact;
- exact input source and whether it is complete;
- expected writes;
- whether an AI/provider call is required;
- provider/model and estimated or clearly unknown cost when applicable;
- downstream artifacts that may become stale;
- confirmation requirement and plain-language risk explanation;
- idempotency key;
- plan status and timestamps.

Use the established project conventions rather than forcing these exact property names. Keep planning deterministic; do not ask an AI model whether a recovery is safe.

## Correctness and safety rules

1. Recovery must be user-controlled. Do not silently rerun an AI stage in the background after the initial persistence window closes.
2. Show exactly what will be retried, saved, rebuilt, or left unresolved before asking for confirmation.
3. Clearly state whether another provider call may cost money. If cost cannot be estimated reliably, say that it is unknown.
4. Never rerun a successful stage merely because another stage lost evidence.
5. Never overwrite valid saved evidence without separate explicit confirmation and a preserved previous version.
6. Preserve the original failed attempt, its evidence-completeness finding, timestamps, and safe error detail. Link the recovery attempt to it.
7. Make recovery idempotent—double-clicks, browser retries, or repeated requests must not create duplicate results or provider calls.
8. Use server-side protection, not only a disabled client button, to prevent duplicate or conflicting recovery.
9. If a recovered upstream result differs from the evidence used by downstream stages, mark affected downstream output as potentially stale. Do not claim the whole workflow is complete until the user reviews it or the affected dependency is safely refreshed.
10. Do not automatically cascade through downstream agents. Present a separate recovery plan when additional reruns may be needed.
11. Do not repeat an email send, external mutation, deletion, publication, or other consequential action through this recovery feature.
12. Do not expose secrets, API keys, credentials, unrestricted raw prompts, unredacted provider payloads, or sensitive filesystem paths.
13. A failed recovery must remain visible and retryable only when another attempt is still safe.
14. Run the Phase 1 evidence-completeness check again after recovery settles. The final state must truthfully become `complete`, remain `incomplete`, or become `unknown` with an explanation.
15. Legacy `unknown` sessions do not receive a recovery button unless the app can first prove a specific missing artifact and safe recovery path.

## First production slice

Implement recovery only for Phase 1 findings that have a provably safe, isolated path in the current chat-v5 workflow.

At minimum, support:

- retrying persistence of an already-produced triage result when its trustworthy output remains available;
- rerunning only the triage stage when its original output is unavailable, its saved input is complete, and the user confirms the provider call;
- rechecking evidence completeness after either action;
- refusing recovery with a clear reason when required input is absent or downstream safety cannot be determined.

If source inspection proves a different artifact is substantially safer for the first `repersist` or `rerun-stage` path, explain the evidence and adjust the exact artifact while preserving the requirements above. Do not pretend a path is safe merely to satisfy the example.

## Minimum user experience

From an incomplete evidence finding, provide a clear recovery action such as **Review recovery options**. Do not reduce recovery to an unexplained “Retry” button.

Before confirmation, show:

- what is missing;
- why the app believes it can or cannot recover it;
- whether it will reuse an existing result or call an AI provider again;
- provider/model and possible cost when a new call is needed;
- what saved data will change;
- whether any later agent result could become stale;
- what will remain for human review.

While recovery runs, disable duplicate submission and show honest progress. Afterward, show `Recovered`, `Recovery failed`, or `Human review required`, with a plain-language explanation and trace/request links where safe.

Keep complete-run status quiet. Do not show recovery controls for complete findings or unproven legacy gaps.

## Required verification

Add focused, deterministic tests for at least:

1. Re-persisting an existing trustworthy result without making a provider call.
2. A confirmed isolated stage rerun makes exactly one provider call.
3. Double-clicks or repeated requests reuse the same recovery operation and do not duplicate writes or provider calls.
4. A valid existing artifact is not overwritten.
5. The original failure and the recovery attempt both remain reviewable and linked.
6. Missing or untrusted stage input produces `manual-review` rather than a retry.
7. Unsupported, disabled, or expired provider evidence does not produce an unsafe recovery plan.
8. A recovered upstream result that changes marks dependent downstream output potentially stale.
9. Recovery failure remains visible and does not erase the original useful workflow data.
10. Successful recovery reruns the Phase 1 check and changes status to `complete` only when all applicable evidence is truly present.
11. Partial recovery leaves the remaining missing items visible.
12. Legacy `unknown` sessions do not receive an unsafe recovery action.
13. The UI explains no-cost persistence retry, possible-cost provider rerun, failure, and manual-review states.
14. Existing Phase 1, case-intake, triage, stage-event, trace, and session tests remain passing.

Use the repository's existing test style. Run focused tests first, then the appropriate client build or static check and any wider verification justified by the changed files. Do not launch persistent services.

## Delivery process

1. Verify the Phase 1 prerequisite gate.
2. Call Codex for the bounded read-only recovery-safety audit and visibly announce the call.
3. Verify Codex's findings against current source and tests.
4. Present a concise implementation plan before editing. Explain the recovery choices, costs, overwrite protections, downstream-staleness behavior, and deliberate exclusions in plain language.
5. Implement only the safe, coherent first recovery slice.
6. Call Codex for an independent destructive-action, concurrency, cost, and regression review and visibly announce the call.
7. Verify Codex's review yourself and fix confirmed problems.
8. Run proportionate verification and inspect the final diff.
9. Update directly relevant documentation if the supported recovery behavior changed. Do not add a duplicate feature entry.
10. Report:
    - which missing evidence regular users can recover;
    - when recovery reuses an existing result versus making a provider call;
    - every confirmation and overwrite protection;
    - how original failures and recovery attempts remain reviewable;
    - how downstream stale results are handled;
    - what still requires human review;
    - each Codex task and how Claude verified it;
    - exact tests and results;
    - concurrent-work risks or unverified limitations.
11. When the work is complete and verified, commit and push only the files belonging to Phase 2. Stage explicit paths so unrelated concurrent changes are excluded.

## Definition of done

Phase 2 is done only when a regular user can review and confirm at least one genuinely safe recovery path, the app prevents duplicate or destructive recovery, provider cost is disclosed before a new call, the original failure remains visible, affected downstream evidence is handled honestly, and the Phase 1 check proves whether recovery actually restored completeness.
