---
name: cto-review
description: Single-pass CTO production-readiness review of implemented features. Audits correctness, risk, plan fidelity, and whether the result delivers the complete practical outcome without unrelated scope. Use before shipping or when auditing an implementation.
argument-hint: '[plan-path-or-feature-name]'
allowed-tools: Read, Grep, Glob, Bash, Write
context: fork
agent: general-purpose
---

<!-- Version: 0.7 — last edited 2026-07-11 -->

# CTO Production Gate Review

Risk-focused audit of an implemented feature. No praise, no filler. Evaluate only what was implemented.

**This is a production blocker gate.** The review returns a binary Gate Decision — PASS or FAIL — alongside the scored analysis. A FAIL verdict means the feature has unresolved Critical or High findings and should not ship until they are addressed. The user can knowingly override a FAIL decision, but the purpose of the gate is to make that choice explicit rather than implicit.

The primary evaluation standard is: **does this implementation deliver the complete practical outcome behind the request?** Technical correctness is necessary but not sufficient. A technically minimal result is a finding when it omits an obvious user-facing requirement, safety need, recovery path, or acceptance criterion. Do not demand unrelated features or a materially different product decision.

If repository policy in `CLAUDE.md` or `.claude/rules/` conflicts with this skill, follow repository policy.

For the expected style, depth, and structure of the output, see [examples/sample-review.md](examples/sample-review.md).

## Step 1: Resolve input

Create the output directory first: `mkdir -p temp-reviews`.

Resolve `$ARGUMENTS` to a review target:

- If `$ARGUMENTS` ends in `.md`, treat it as the plan document path.
- If `$ARGUMENTS` is a feature name, search `.claude/plans/` for matching plan files. If multiple match, read each and pick the most relevant.
- If `$ARGUMENTS` is empty, run `git status` and `git diff --name-only` to list recent changes, then ask the user which feature to review.

Fallbacks:

- Plan file missing: report the path and fall back to git-based discovery. If the user would benefit from establishing a contract before shipping future iterations of this feature, suggest running `/implementation-plan <feature-slug>` retroactively.
- `.claude/plans/` missing or empty: fall back to git-based discovery. Note the absence in the final report under "Scope."
- No plan identifiable through any method: list recently modified files and ask the user for scope. Without a plan, the Plan Fidelity step (Step 3) cannot run and must be marked "Not available — no plan exists."

## Step 2: Assemble scope

Run the scope script, passing the plan path if one was resolved in Step 1:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/scope.sh <plan-path-or-empty>
```

The script emits a markdown scope package containing:

- **Git state** — branch, head commit, detected base branch, uncommitted-file warning.
- **Modified files table** — each file with line counts and a role classification (route, service, model, middleware, hook, context, component, styles, test, config, docs, other).
- **Unplanned file candidates** — when a plan path is provided, files in the diff whose basename does not appear in the plan.

The review covers committed and staged changes. Treat the script's output as a starting map, not truth:

- Read every modified file yourself in Step 4. If a read contradicts the script's classification, trust the read.
- The unplanned-candidates list is a hint. Plans often describe behavior, not files — a file's absence from the plan text does not guarantee it was unplanned. Verify by reading the plan for matching intent.
- Files deferred in the plan are excluded from review regardless of what the script reports.

If the script exits with "Not in a git repository" or the plan file cannot be found, fall back to the plan's file list (if available) or to manually-listed files from the user, and note the limitation in the final report.

If your project layout differs from standard MERN patterns and files are classified as "other" that shouldn't be, edit the `classify()` function in `scripts/scope.sh`. The script is meant to evolve with the codebase.

## Step 3: Plan fidelity check

Before evaluating code quality, verify the implementation matches the plan.

Read the plan document. For each distinct item in the plan, classify:

- **Implemented** — the item is present in the code changes.
- **Partial** — the item is started but incomplete (e.g., happy path coded, error handling missing; feature built but never wired into the UI).
- **Deferred** — the plan explicitly marks this for later. Excluded from the review.
- **Missing** — the item is in the plan, not marked deferred, and not present in the code.

**Every Missing item is a finding, severity HIGH minimum.** A silent skip of a plan requirement is worse than a bug — the user believes it was built.

**Every Partial item is a finding**, severity based on what the missing piece affects.

Record a Plan Fidelity table in the report:

| Plan item | Status | Evidence (file:line) | Notes |
| --------- | ------ | -------------------- | ----- |

## Step 4: Read and trace

Read every modified file completely. A change is best understood in the context of the whole file — the bug often lives in the interaction between new code and the existing surrounding code.

If more than 20 files were modified, read the top 15 by lines changed completely, and read the rest without tracing callers. Note the abbreviated files in the report.

For each modified file, note who imports it (grep the codebase for the filename) and what it imports.

After reading, trace **at least one complete data path** across file boundaries. Pick the most complex path touched by the feature and follow it end-to-end — for example, route handler → service → model → response → client fetch → component render. At each boundary, verify the producer and consumer agree on the data shape.

If unplanned changes exist, trace a second path that crosses between the planned feature and the unplanned changes.

Document the trace under "Cross-Boundary Data Flow Trace" in the final report. This trace surfaces the most significant bugs — contract mismatches, missing fields, stale references, type drift.

## Step 5: Evaluate against the framework

Apply each applicable section from [references/evaluation-framework.md](references/evaluation-framework.md) to the modified files.

**Priority order** (spend ~80% of effort on 1–3):

1. State consistency and data flow correctness
2. Intent fidelity — does the feature match what the user asked for?
3. Code quality and defensive programming
4. Performance and responsiveness
5. Observability and debugging
6. Accessibility and responsive design — report only if clearly broken, not for spec gaps

Every finding must include:

- File path and line number.
- The specific code or pattern causing the issue.
- A concrete reproduction scenario.
- A suggested fix (code-level, not vague advice).

If a section has no findings, write "No findings." Do not pad sections with observations.

**Evidence standard:** A finding requires a verified execution trace. "I believe this happens" is not a finding. "I traced file:line → file:line → file:line, and at step 3 the value is X when it should be Y" is a finding.

## Step 6: Verification gate

Before finalizing any HIGH or CRITICAL finding, verify it is real: trace the execution path from trigger to completion, and grep for every caller of the modified function.

If the complete execution path cannot be traced, downgrade from HIGH/CRITICAL to MEDIUM with the note "Potential issue — verify with runtime testing."

**Severity calibration:** Before marking any finding MEDIUM, answer: "Can a QA engineer reproduce this in under 60 seconds?" If yes, it is HIGH, not MEDIUM.

## Step 7: Practical completeness and polish assessment

This is the primary evaluation criterion, not an optional section.

Answer:

1. Would a senior engineer be impressed by this code?
2. Are error messages actionable? Would a user know what went wrong and what to do?
3. Is defensive programming comprehensive — every edge case, not just the happy path?
4. Does the architecture make future changes easier, not harder?
5. If you showed this to the user right now, would the result feel complete, polished, and ready for its intended workflow?

If the answer to #5 is "no," identify the specific missing behavior. Assign severity from its actual user or safety impact; do not create a High finding solely from a subjective feeling.

**What complete and polished means:**

- Error messages that tell users what to do, not just what went wrong.
- Edge cases handled that the plan did not mention but a user would hit.
- Code structured so the next feature is easier to add.
- Loading, empty, and error states all handled gracefully.

Include a "Recommendations for a Complete Premium Outcome" table in the report:

| Gap | Current | Complete outcome | Recommendation | Effort |
| --- | ------- | --------- | -------------- | ------ |

## Step 8: Self-check before writing the report

Before writing, confirm the report satisfies these review requirements: every finding carries `file:line`, a reproduction scenario, and a code-level fix; the cross-boundary trace is documented; the Plan Fidelity table covers every plan item; all framework sections are addressed; the overall score is the minimum of the section scores; and the completeness check is applied. Fix any gap before writing.

## Step 9: Gate Decision, score, and write the report

### Gate Decision (binary)

The Gate Decision is separate from and more important than the score. It uses hard criteria:

- **PASS**: 0 Critical findings AND 0 High findings in the current review. All previously-flagged Critical/High findings have been addressed (either fixed or explicitly downgraded with justification).
- **FAIL**: 1 or more Critical findings, OR 1 or more High findings.

Medium and Low findings do not block. They are informational.

The Gate Decision is what gatekeeps shipping. The score is a trend signal across re-reviews. A feature may pass the gate with a 7/10 score and valid Medium findings; it must not pass the gate with a 9/10 score and one unresolved High.

### Score

Score each framework section 1–10. The **overall score is the minimum** of all section scores, not the average.

| Score | Meaning                                                         |
| ----- | --------------------------------------------------------------- |
| 10    | No findings above Medium. Complete, polished, and ready.        |
| 8–9   | High findings with clear fixes, no Criticals.                   |
| 6–7   | Criticals exist but contained to this feature.                  |
| 4–5   | Multiple Criticals or architectural issues. Targeted rework.    |
| 2–3   | Fundamental design flaws. Significant rethinking needed.        |
| 1     | Non-functional or dangerous. Full rewrite.                      |

**Completeness check:** If a clear acceptance criterion or obvious practical requirement is missing, the overall score cannot exceed 7. A purely subjective desire for extra features does not trigger this cap.

### Write the report

Generate a timestamp and derive a kebab-case `<feature-slug>` from the feature name or plan filename:

```bash
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
```

Write the report to:

```
temp-reviews/cto-review-<feature-slug>-<timestamp>.md
```

The timestamp preserves history across re-reviews of the same feature — critical for verifying whether prior findings actually got resolved and for tracking the PASS/FAIL progression.

Report structure (mirrors `examples/sample-review.md`):

1. Summary — **Gate Decision (PASS/FAIL)** prominently, score, finding counts, completeness result, next step.
2. Scope — files reviewed, planned vs unplanned.
3. Plan Fidelity table.
4. Cross-boundary data flow trace.
5. Findings by framework section.
6. Practical completeness and polish assessment.
7. Recommendations for a complete premium outcome.
8. What breaks first — most likely production failure mode.
9. Production verdict.
10. Non-negotiable fixes — all Critical and High findings as an action list.

### Report to conversation

**If Gate Decision is PASS:**

```
CTO Review: <feature name> — PASS ✓
Score: <n>/10
Critical: 0 | High: 0 | Medium: <n> | Low: <n>
Completeness: <PASS | CAPPED AT 7>
Report: temp-reviews/cto-review-<feature-slug>-<timestamp>.md

Ready to ship.
```

**If Gate Decision is FAIL:**

```
CTO Review: <feature name> — FAIL (BLOCKER)
Score: <n>/10
Critical: <n> | High: <n> | Medium: <n> | Low: <n>
Report: temp-reviews/cto-review-<feature-slug>-<timestamp>.md
Top finding: <one-line summary of highest-severity issue>

Next steps:
1. Address the <n> non-negotiable items in section 10 of the report.
2. Re-run: /cto-review <feature-slug>
3. A new timestamped report will be generated so you can compare progress.

Continue this loop until the gate returns PASS.
```

## Step 10: Re-review workflow

Re-reviews are the normal path, not an exception. Most features will not PASS on the first review. The timestamped-filename convention exists specifically to support this.

When a user runs `/cto-review <feature>` a second time:

- The previous review files stay intact — do not overwrite them.
- The new report starts fresh but may reference prior reports.
- Findings that were flagged previously and appear fixed can be noted in the new report as "Resolved since <prior-timestamp>."
- Findings that were flagged previously and still apply become priority items in the new report.

Track progression across the series of reviews for a feature:

- Gate Decision over time (FAIL → FAIL → PASS is a successful iteration).
- Score over time (trending up indicates real improvement).
- Finding counts over time (Critical/High going to zero is the goal).

A feature is genuinely done when: the most recent review PASSES and the user has decided to ship.

## Finding format example

**Section:** Failure Modes
**Severity:** High
**File:** `server/services/downloader.js:47`
**Issue:** No timeout on ffmpeg subprocess. If ffmpeg hangs on a corrupt HLS stream, the job blocks indefinitely with no user feedback.
**Reproduction:** Submit a job with a URL that produces a corrupt `.m3u8` manifest. The job stays in "running" state forever.
**Fix:** Add `timeout: 60000` to the ffmpeg spawn call at line 47. On timeout, mark the job failed with an actionable error message.

## Related skills

This skill works alone but is designed to pair with two others:

- **implementation-plan**: produces plan files in `.claude/plans/` that this skill reads for the Plan Fidelity check. If a feature has no plan and you want an approved checklist before implementation, run `/implementation-plan` first.
- **skill-audit**: after several reviews have accumulated in `temp-reviews/`, the audit skill can find patterns across your reviews and recommend tuning to this skill. See `/skill-audit`.

Each skill works standalone; the others are optional.
