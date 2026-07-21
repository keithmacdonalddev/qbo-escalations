# Claude Implementation Prompt: Evidence Completeness — Phase 2 Safe Recovery

Paste this entire file into Claude Code from the repository root **only after Phase 1 has been implemented, verified, committed, and pushed**.

## Objective

Extend the Evidence Completeness Check with safe, user-controlled recovery. When the app proves that expected workflow evidence is missing, help the user recover it without duplicating successful work, hiding the original failure, unexpectedly spending money, or overwriting valid evidence.

The result must also improve the user's quality of life: recommend the safest action in plain language, reuse information the app already has, avoid trapping the user on a waiting screen, preserve progress across navigation, and return the user to their interrupted work with a clear explanation of what changed.

## User goal

A regular user who sees “Evidence incomplete” should not be left at a dead end or forced to understand technical recovery strategies. The app should recommend what to do, explain why it is safest, reuse trustworthy information already collected, disclose time and cost, and ask only for genuinely missing input.

The user must be able to postpone recovery, leave and return after a confirmed recovery starts, compare a newly generated result when it differs, and finish with a simple answer to: “Is my work safe now, and where do I continue?”

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
- user re-entry burden, provider-readiness checks, duration estimates, and cancellation boundaries;
- how recovery progress can survive refresh, navigation, and session reopening after the user confirms it;
- when a rerun result must be compared and accepted instead of silently replacing workflow evidence;
- how multiple missing items should be grouped and ordered without overwhelming the user;
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
- whether this is the recommended strategy and a plain-language reason;
- affected stage and artifact;
- exact input source and whether it is complete;
- which trusted inputs will be reused and which genuinely missing inputs require the user;
- expected writes;
- whether an AI/provider call is required;
- provider/model and estimated or clearly unknown cost when applicable;
- provider readiness and capability-check result when a provider call is required;
- estimated or clearly unknown duration;
- whether the user may safely leave while it runs;
- the cancellation boundary, including whether cost may already be incurred;
- downstream artifacts that may become stale;
- confirmation requirement and plain-language risk explanation;
- comparison or acceptance requirement if a rerun may produce a meaningfully different result;
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
16. Recommend the safest applicable strategy from the recovery priority order. Do not make the user choose between unexplained technical options. If no strategy is safely recommendable, recommend human review.
17. Reuse trustworthy screenshots, parsed fields, case details, stage inputs, and other existing evidence. Ask the user only for input that is genuinely missing, explain why it is needed, and do not make them re-enter information merely because it lives in another existing record.
18. Before a provider rerun is confirmed, perform a no-cost readiness check using existing health and capability signals when available. Do not start a call that is already known to be unavailable or incompatible, and do not silently switch provider or model.
19. Show an honest expected duration based on existing evidence when possible; otherwise say it is unknown. Never invent precision.
20. State the cancellation boundary before confirmation. Cancelling before the provider request begins must prevent the call. After the request begins, explain that cancellation may not prevent provider cost or completion.
21. Once the user confirms a recovery, persist the recovery operation and its progress so refresh, route navigation, or reopening the session does not create a duplicate or erase its state. A confirmed operation may continue server-side after navigation, but no new recovery may start invisibly.
22. Do not force the user to remain on a waiting screen. If the current architecture cannot safely continue after navigation, say so before confirmation and protect against accidental navigation rather than pretending the work will continue.
23. Treat newly generated output as a recovery candidate until its effect is understood. If it differs meaningfully from a previously visible result or from evidence used downstream, show a plain-language comparison and require acceptance before replacing the active workflow result.
24. Let the user choose **Recover later** without losing the plan. Keep the session visibly unresolved and make the pending recovery easy to find again.
25. When multiple artifacts are missing, show one grouped recovery summary and recommend a safe order. Do not present a stack of unrelated dialogs or automatically cascade through stages.
26. After recovery, explain what changed, what is now trustworthy, what remains unresolved or stale, and where the user should continue. Return them to the affected workflow context rather than leaving them in technical recovery details.

## First production slice

Implement recovery only for Phase 1 findings that have a provably safe, isolated path in the current chat-v5 workflow.

At minimum, support:

- retrying persistence of an already-produced triage result when its trustworthy output remains available;
- rerunning only the triage stage when its original output is unavailable, its saved input is complete, and the user confirms the provider call;
- automatically reusing trustworthy saved input without asking the user to re-enter it;
- checking provider readiness and showing cost, duration, and cancellation information before a rerun;
- persisting a confirmed recovery operation so its status survives refresh and session reopening without duplicate calls;
- staging and comparing a meaningfully different rerun result before it becomes the active result;
- allowing **Recover later** while keeping the unresolved session easy to find;
- rechecking evidence completeness after either action;
- refusing recovery with a clear reason when required input is absent or downstream safety cannot be determined.

If source inspection proves a different artifact is substantially safer for the first `repersist` or `rerun-stage` path, explain the evidence and adjust the exact artifact while preserving the requirements above. Do not pretend a path is safe merely to satisfy the example.

## Minimum user experience

From an incomplete evidence finding, provide a clear recovery action such as **Review recovery options**. Do not reduce recovery to an unexplained “Retry” button or lead with a list of technical strategies.

Before confirmation, show:

- what is missing;
- one clearly recommended action and why it is safest;
- why the app believes it can or cannot recover it;
- whether it will reuse an existing result or call an AI provider again;
- which existing information will be reused and whether the user must supply anything;
- whether the selected provider is currently ready and compatible;
- provider/model and possible cost when a new call is needed;
- expected or unknown duration;
- when cancellation stops being guaranteed and when cost may begin;
- what saved data will change;
- whether any later agent result could become stale;
- whether the user may safely leave and return while recovery runs;
- what will remain for human review.

Offer **Start recovery** and **Recover later**. Use a separate advanced-details area for alternate strategies when they are genuinely safe and useful.

While recovery runs, disable duplicate submission and show honest progress. The user must be able to reopen the session and see the same operation rather than accidentally starting another one. Provide an in-app completion notice when a confirmed recovery finishes after the user navigates elsewhere.

Afterward, show `Recovered`, `Recovery failed`, or `Human review required`, with a plain-language explanation and trace/request links where safe. Explain what changed, what the user can trust now, and where to continue.

Keep complete-run status quiet. Do not show recovery controls for complete findings or unproven legacy gaps.

## Quality-of-life requirements

The recovery experience must reduce interruption, repeated entry, uncertainty, and decision fatigue—not merely expose a safe recovery endpoint.

### 1. Recommend the safest action first

Lead with one plain-language recommendation derived from the deterministic recovery plan, for example:

> Recommended: Save the existing triage result. This will not call the AI again, will not cost anything, and should take only a few seconds.

If the recommendation is a provider rerun, state that just as plainly. Keep strategy names such as `repersist` or `rerun-stage` behind technical details.

### 2. Reuse information and minimize questions

Pre-fill the recovery from trustworthy saved evidence. Do not ask the user to upload the same screenshot, paste the same case text, choose the same provider, or re-enter known case details unless reuse would be unsafe.

When input is genuinely missing, ask only for that input, explain why it is required, and preserve the user's entry if they close and reopen the recovery view.

### 3. Prevent predictable failed attempts

Before presenting the final confirmation for a provider rerun:

- check current provider readiness and required model capabilities using existing app signals;
- show provider/model, possible cost, and expected or unknown duration;
- identify the last safe point to cancel;
- block a known-impossible attempt with a useful explanation;
- never switch provider or model without explicit approval.

### 4. Let the user leave and return

After explicit confirmation, recovery progress should belong to the saved session rather than only the open browser view. The user should be able to navigate elsewhere and later see `Waiting`, `Running`, `Comparison needed`, `Recovered`, `Failed`, or `Human review required` without starting over.

Show an in-app notice when recovery completes while the user is elsewhere. Do not start an unconfirmed recovery merely because the user reopened the session.

### 5. Compare changed results before adoption

When a rerun produces a meaningfully different triage result or other agent output:

- show the previous visible or downstream-used result beside the recovery candidate when available;
- summarize important changes in plain language;
- identify downstream work that may be affected;
- let the user accept the recovered result or keep it as an unaccepted candidate for review;
- never erase either version or the original failure evidence.

Do not force the user to compare raw JSON or technical trace payloads.

### 6. Support “Recover later” and multiple gaps

The user may postpone recovery without dismissing the problem. Keep a durable unresolved marker and make pending recoveries findable from Sessions.

When several artifacts are missing, present one summary that distinguishes:

- what can be restored without cost;
- what requires a provider call;
- what must remain human review;
- the recommended safe order.

The first production slice may execute only supported isolated recoveries, but it must not make the overall situation harder to understand.

### 7. Return the user to useful work

After recovery settles, show a short completion summary such as:

> Recovery succeeded. The triage result is now saved, all expected evidence is complete, and your analyst response remains unchanged.

If recovery is partial or changes downstream trust, say so. Provide a clear **Return to triage**, **Review comparison**, or equivalent action that takes the user back to the affected workflow context.

### 8. Use progressive detail

Lead with:

1. What does the app recommend?
2. Will this cost anything or change existing work?
3. How long might it take, and may I leave?
4. What will be trustworthy afterward?

Keep internal strategy codes, idempotency keys, trace IDs, request IDs, provider-package IDs, and raw error detail behind an expandable **Technical details** section.

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
14. The safest applicable strategy is recommended first, with plain-language reasoning, while technical alternatives remain secondary.
15. Existing trustworthy inputs are reused and the user is asked only for genuinely missing information.
16. A known-unavailable or incompatible provider is caught before confirmation and no provider call is made.
17. Cost, expected or unknown duration, and the cancellation boundary are shown before a provider rerun.
18. Cancelling before the provider-call boundary prevents the call; cancelling afterward reports the honest cost/completion limitation.
19. Refreshing, navigating away, and reopening the session resumes the same confirmed recovery status without a duplicate call.
20. A confirmed recovery that finishes while the user is elsewhere produces an in-app completion notice without starting any new operation.
21. A meaningfully different rerun result remains a candidate, displays an understandable comparison, and does not replace active workflow evidence until accepted.
22. **Recover later** preserves the unresolved marker and returns the user to the same recovery plan later.
23. Multiple missing artifacts produce one ordered summary rather than repeated dialogs or an automatic cascade.
24. Successful, partial, failed, and manual-review outcomes explain what changed, what is trustworthy, and where the user should continue.
25. Existing Phase 1, case-intake, triage, stage-event, trace, and session tests remain passing.

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
    - how the app recommends the safest action without requiring technical knowledge;
    - which existing inputs are reused and when the user must provide new information;
    - when recovery reuses an existing result versus making a provider call;
    - how readiness, duration, cost, and cancellation are communicated;
    - how recovery survives navigation or session reopening;
    - how changed rerun results are compared and accepted;
    - how **Recover later** and multiple missing artifacts are handled;
    - how the user is returned to useful work after recovery;
    - every confirmation and overwrite protection;
    - how original failures and recovery attempts remain reviewable;
    - how downstream stale results are handled;
    - what still requires human review;
    - each Codex task and how Claude verified it;
    - exact tests and results;
    - concurrent-work risks or unverified limitations.
11. When the work is complete and verified, commit and push only the files belonging to Phase 2. Stage explicit paths so unrelated concurrent changes are excluded.

## Definition of done

Phase 2 is done only when a regular user receives one understandable recommended recovery, does not re-enter trustworthy information the app already has, sees readiness/time/cost/cancellation information before a provider call, can leave and return without losing or duplicating a confirmed operation, can compare a meaningfully changed rerun before accepting it, and finishes with a clear explanation of what is trustworthy and where to continue. The app must still prevent duplicate or destructive recovery, preserve the original failure, handle downstream evidence honestly, and use the Phase 1 check to prove whether recovery actually restored completeness.
