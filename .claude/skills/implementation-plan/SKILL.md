---
name: implementation-plan
description: Produces a structured implementation plan for a feature before coding begins. Conducts a guided planning dialogue, then writes a plan to .claude/plans/ in a format that pairs with the cto-review skill. Use when starting a new feature, before writing code, or when thinking through scope, risks, and acceptance criteria.
argument-hint: '[feature-name]'
allowed-tools: Read, Grep, Glob, Bash, Write
---

<!-- Version: 0.2 — last edited 2026-04-19 -->

# Implementation Plan

Produce a structured plan before writing code. The goal is not paperwork — it is to surface decisions that are cheap to make now and expensive to revisit after implementation.

**The plan is a contract.** Every acceptance criterion you write here becomes a Plan Fidelity check during `cto-review` — a production blocker gate the implementation must pass before shipping. Acceptance criteria that are vague or not objectively verifiable will be flagged as Missing or Partial findings (High severity), which will FAIL the gate. Write criteria with that downstream check in mind: each one should be something a reviewer can answer yes-or-no about, without interpretation.

The plan format is designed to pair with the `cto-review` skill:

- **Acceptance criteria** become plan-fidelity items during review.
- **Files to create/modify** become the baseline for detecting unplanned changes.
- **Exceeds bar** feeds the review's Exceeds Expectations assessment.
- **Risks and edge cases** become review checkpoints for defensive programming.

If repository policy in `CLAUDE.md` or `.claude/rules/` conflicts with this skill, follow repository policy.

For the expected output structure, see [examples/sample-plan.md](examples/sample-plan.md).
For the full schema, see [references/plan-schema.md](references/plan-schema.md).

## Step 1: Resolve input

Create the output directory first: `mkdir -p .claude/plans`.

If `$ARGUMENTS` is provided, treat it as the feature name.

If `$ARGUMENTS` is empty, ask the user: "What feature are we planning? Give it a short name and a one-sentence description."

Derive a kebab-case `<feature-slug>` from the feature name.

If a plan already exists at `.claude/plans/<feature-slug>.md`, ask the user whether to update it in place, rename the existing one as `<feature-slug>-v1.md` and start fresh, or abort.

## Step 2: Gather context

Before asking planning questions, gather what you can silently.

**Check the codebase:**

- Glob for files that might relate to the feature (e.g., existing auth code when planning an auth feature).
- Read `CLAUDE.md` for architecture conventions.
- Read any existing related plans in `.claude/plans/`.

**Check review history (the "vice versa" loop):**

- If `temp-reviews/` exists, read the three most recent review files.
- Note recurring findings — patterns like "error messages not actionable," "missing rate limits," "silent audit failures."
- These reveal blind spots this codebase tends to have at the plan stage. Surface them during the dialogue in Step 3.

Do not pre-decide the plan. Use what you find to ask sharper questions.

## Step 3: Planning dialogue

Conduct a dialogue with the user. Ask questions one at a time, or in small groups where answers inform each other. Do NOT dump every question at once.

Cover these areas. Adapt wording to the feature. If an answer makes a question redundant, skip it. If an answer reveals a gap, probe deeper before moving on.

### Problem

- What problem does this solve? Describe the user's situation without this feature.
- Who is affected? How often? How costly is the current state?

### Scope

- What's the smallest version that delivers value?
- What's explicitly out of scope? What might someone assume is included but isn't?
- Are there stretch goals that would be nice but not required?

### Technical approach

- What files will be created or modified? Walk through the expected changes.
- What's the data flow? From user trigger through to the final state change.
- What existing code will this touch, depend on, or risk breaking?

### Acceptance criteria

- What must be true for this to be considered done?
- Frame them as testable statements, not vague goals. ("User can submit a new email and receive a verification link within 30 seconds" — not "email change works.")

After gathering the initial list, probe each criterion with the reviewer-objectivity test: **"Could a reviewer answer yes or no about this criterion without interpretation, just by looking at the code and behavior?"**

If a criterion fails the test, rewrite it. Vague criteria will be flagged as Missing or Partial during cto-review — that is a High-severity finding and will FAIL the gate. The time to sharpen wording is now, not at review time.

### Risks and edge cases

- What could go wrong at runtime? (Network failures, race conditions, malformed input, concurrent requests, dependency outages.)
- What assumptions are being made about the system's state?
- **Raise patterns from Step 2.** If recent reviews flagged "missing rate limits," ask directly: "Does this feature need rate limiting? If so, add it to scope now."

### Exceeds bar

- What would make this exceed what was asked, not just meet it?
- Concrete examples: actionable error messages for each failure mode, loading/empty/error states on all UI, structured logging, code organized so the next feature is easier to add.

### Dependencies and sequencing

- Does anything need to ship before this? Will this unblock anything?
- Does any existing code need to change first (refactor, migration)?

### Testing strategy

- How will you know this works in production, not just locally?
- Which scenarios need manual verification vs automated tests?

## Step 4: Draft the plan

Using the dialogue, draft the plan following the schema in `references/plan-schema.md`. Mirror the structure of `examples/sample-plan.md`.

Quality bar:

- Every acceptance criterion must be testable. "Works correctly" is not a criterion.
- File lists must be specific — actual paths, not "some route handler."
- The exceeds bar must be concrete. "Make it good" fails this check.
- Deferred items are called out explicitly with a `[deferred]` tag, not left implicit.

Show the draft to the user. Ask: "Does this capture what we discussed? Anything to add, remove, or sharpen?"

Iterate based on feedback before writing.

## Step 5: Self-check before writing

Work through this checklist. If any item fails, return to Step 3 to close the gap.

- [ ] Problem statement is concrete, not "improve X."
- [ ] In-scope and out-of-scope are both explicitly listed.
- [ ] Every acceptance criterion is a testable statement.
- [ ] Every acceptance criterion passes the reviewer-objectivity test — a reviewer can verify it yes/no without interpretation.
- [ ] Files to create and files to modify are named specifically.
- [ ] At least one end-to-end data-flow description exists.
- [ ] At least three risks or edge cases are identified with handling.
- [ ] Exceeds bar lists concrete items, not vague aspirations.
- [ ] Deferred items (if any) are called out under their own heading.
- [ ] Patterns surfaced from past reviews (Step 2) have been addressed or consciously dismissed.

## Step 6: Write and report

Write the plan to:

```
.claude/plans/<feature-slug>.md
```

After writing, output to the conversation:

```
Implementation Plan: <feature name>
Acceptance criteria: <n>
Files to modify: <n>
Risks identified: <n>
Deferred items: <n>
Plan: .claude/plans/<feature-slug>.md

Before shipping, run: /cto-review <feature-slug>
The review is a pass/fail blocker gate — ship only when it returns PASS.
Most features take multiple review cycles to reach PASS. That is normal.
```

The last three lines set expectations. The plan you wrote is the contract; the review is the gate; iteration is expected. Users who understand this going in produce better plans and don't feel blindsided when the first review returns FAIL.

## Related skills

This skill works alone but is designed to pair with two others:

- **cto-review**: the production blocker gate that checks the implementation against this plan's acceptance criteria. Plans produced here become the contract cto-review enforces. Run `/cto-review <feature-slug>` after implementation.
- **skill-audit**: after several plans and reviews have accumulated, the audit skill can find patterns across your work and recommend tuning to this skill. See `/skill-audit`.

Each skill works standalone; the others are optional.
