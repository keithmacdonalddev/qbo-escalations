# Platform Feature Candidates

This file is the curated feature backlog for the broader operational intelligence
platform. QBO escalation support is the first domain module and proving ground,
but feature ideas should support the larger goal: expert AI agents helping the
user handle complex work and life situations with shared evidence, governed
memory, workflows, actions, and human validation.

## Feature Suggestion Rules

Before adding a feature:

- Search this file first and do not add duplicates or slight variations.
- Prefer features that improve evidence, memory, workflow, decisions, actions,
  validation, privacy, or continuity.
- Avoid dev-tooling ideas, micro-UI polish, theme-only ideas, and generic export
  buttons unless the user specifically asks for them.
- Show the feature idea to the user in chat first, then add it to the bottom of
  this file only after it is relevant to the task.
- Keep new suggestions concise: 2-3 sentences, with a clear user benefit.
- Use the template below exactly when appending new suggestions.

## New Suggestion Template

```text
Date: YYYY-MM-DD
Time: HH:MM AST
Model: model name
Is duplicate?: yes / no
Complexity: low / medium / high
Special Feature: concise feature name and 2-3 sentence description
```

## Existing Candidates

### Feature Candidate #1

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: high
Special Feature: Shift Debrief / End-of-Shift Intelligence Report - Generate a reviewed end-of-shift report from the day's escalation work: case summary by category, emerging pattern detection, unresolved handoff notes, playbook gaps, agent coaching insights, and INV trend alerts. This turns daily case handling into reusable operational intelligence rather than leaving it buried in individual chats.

### Feature Candidate #2

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: high
Special Feature: Deja Vu / Past Resolution Recall - When a new escalation starts, fingerprint the symptoms, product area, error codes, and wording, then surface similar past resolved cases with what worked, what failed, and the final outcome. This is not just search; it is personal operational memory appearing at the moment of need.

### Feature Candidate #3

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: high
Special Feature: Escalation Sonar / Emerging Pattern Detector - Watch active and recent escalation signals for repeated symptoms across multiple cases, then warn when a pattern may be forming. Example: several agents report the same bank-feed disconnect within an hour, and the app suggests creating or checking an INV before the issue becomes obvious manually.

### Feature Candidate #4

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: high
Special Feature: INV Constellation Map + Temporal Replay - Map INV investigations as connected nodes based on shared symptoms, product areas, affected institutions, timing clusters, and suspected root causes. A timeline replay lets the user watch clusters form over time, making outbreak patterns and duplicate investigations easier to see.

### Feature Candidate #5

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: medium
Special Feature: Screenshot Queue Parser - Allow the user to drop multiple escalation screenshots into the parser at once, process them sequentially, and stitch the extracted evidence together with clear source dividers. This reduces one-at-a-time screenshot friction and keeps multi-screen evidence organized.

### Feature Candidate #6

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: medium
Special Feature: Screenshot Annotator / Markup Canvas - Before sending an image to an agent, let the user draw arrows, circles, highlights, text callouts, and redactions on the screenshot. Preserve annotation coordinates alongside the image so the agent can reason about exactly what the user marked, not just the raw screenshot.

### Feature Candidate #7

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: medium
Special Feature: AI Shadow Agent for Image Parsing - Run a second provider or model behind the scenes for sensitive parsed fields such as COID, case number, INV number, dates, and dollar amounts. If the two parses disagree, show a warning badge and highlight the conflicting fields before the wrong identifier sends the user down the wrong path.

### Feature Candidate #8

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: high
Special Feature: Sensitive Data Shield Mode - Add a visible privacy mode that forces sensitive work through approved local-only providers and blocks cloud model routing until the user turns the mode off. This supports escalations containing bank, tax, payroll, or personally identifiable customer information.

### Feature Candidate #9

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: medium
Special Feature: AI Context Handoff / Park and Resume - Add a "Park" action that creates a short situation briefing for an interrupted case: what the issue is, what evidence is known, what has been tried, what is uncertain, and the next recommended action. When the user returns, "Resume" restores the mental context without digging through the full conversation.

### Feature Candidate #10

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: high
Special Feature: Escalation Replay Mode - For a resolved escalation, replay the case timeline step by step: intake, evidence, agent reasoning, playbook references, user decisions, actions taken, and final outcome. This can support training, self-review, and identifying where the workflow slowed down.

### Feature Candidate #11

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: medium
Special Feature: Voice Memo / Voice-to-Action - Let the user capture quick spoken notes during calls or busy escalation work, transcribe them, and turn clear commands into draft actions with confirmation buttons. The practical value is hands-free capture without letting voice input execute risky actions without review.

### Feature Candidate #12

Date: 2026-06-11
Time: Unknown AST
Model: Codex
Is duplicate?: no
Complexity: medium
Special Feature: Clipboard Ring / Phantom Clipboard - Keep a searchable in-app history of copied case numbers, COIDs, INV IDs, template snippets, email fragments, and AI response excerpts. This reduces the common friction of losing the exact identifier or wording copied a few minutes earlier while moving between chat, Gmail, screenshots, and case notes.

## New Suggestions

Add future feature suggestions below this line using the template above.

Date: 2026-06-11
Time: Unknown AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Evidence Capability Badges - In the agent profile's provider/model picker, show honest badges for what evidence each transport+model combination can actually capture before a run: readable reasoning summary (yes/no/summary-only), image support, effort control, and token accounting. Discovered need: identical agents on different transports silently produce very different audit trails (e.g. Fable 5 reasoning is empty on default CLI args but recoverable with the right request flags), and today the user only finds out after the evidence is already missing.

Date: 2026-06-11
Time: 08:14 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Evidence Completeness Check - After every pipeline run, automatically compare what actually happened (stages executed, agents that acted, artifacts produced such as images, parsed fields, triage card, INV matches, reasoning) against what was persisted to the session record, and surface any gap as a visible warning on the session (e.g. an "evidence incomplete: triage result not saved" badge in the Audit tab). Turns silent provenance loss into an immediate alert instead of a bug discovered weeks later, and gives every future agent-harness refactor a built-in safety net for the "everything the pipeline produces gets saved" contract.

Date: 2026-06-11
Time: 08:18 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Knowledge Earn-In / Claim Graduation Engine - When a real escalation resolves, automatically check which retrieved knowledge records (governed KB or legacy playbook scraps) were actually used and confirmed by the outcome, then propose graduating confirmed legacy claims into governed KB records (operator approves) and flag contradicted ones for retirement. Turns every resolved case into a verification event, so the AI-generated playbook bootstrap is steadily replaced by evidence-backed institutional memory without a risky one-time migration.

Date: 2026-06-11
Time: 08:23 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Section-Level Authorship Blame for Knowledge Records - Track which actor last touched each section of a KB record — the operator, or a specific agent+model call (linked to its provider call package) — and show it inline during review, like git blame for governed memory. Today a draft shows only who created it; after agent edits and human edits interleave, a reviewer can't tell which claims are human-validated versus AI-authored, and this makes that visible at the exact granularity where trust decisions happen.

Date: 2026-06-11
Time: 09:01 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Duplicate Draft Coalescing - When the pipeline creates multiple knowledge drafts for the same case (already happening in live data: one case has three queued drafts created hours apart), detect the collision, group them as one queue entry, and show the operator a side-by-side diff of what each draft claims differently. The operator picks or merges a canonical draft and the others are marked superseded with lineage links preserved, so review effort isn't wasted on near-identical drafts and the governed KB never ingests conflicting records for the same case.

Date: 2026-06-11
Time: 09:26 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: high
Special Feature: Prompt-Change Regression Replay - Before any agent prompt or model change goes live, replay the proposed configuration against the corpus of operator-approved real cases and show field-level diffs of old-vs-new outputs, with a pass/fail gate the operator approves before the change ships. This is regression testing for agent behavior built entirely on real, approved evidence — catching silent extraction or triage regressions at change time instead of discovering them in live escalations.

Date: 2026-06-12
Time: Unknown AST
Model: Claude Opus 4.8
Is duplicate?: no
Complexity: medium
Special Feature: Provenance Drift Sentinel - For any governed artifact that quotes a value derived from a live source of truth (a design token, a config value, a model id, a playbook claim, an extraction-prompt assumption), store a machine-checkable pointer to that source and periodically re-read it in the background, flagging when the quoted value has drifted from the live value. This turns silent staleness — like a prompt file that hard-codes design tokens as prose and rots when the theme changes — into an explicit, reviewable alert, improving evidence quality and governance across prompts, KB records, and config.

Date: 2026-06-12
Time: Unknown AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Completion Claim Verifier - When an agent or a planning document marks a work item "done," attach a machine-checkable proof (a string that must exist or be absent in a named file, a test that must pass, a commit hash) and have the platform run those checks, badging items as verified-done versus claimed-done-but-unproven. Discovered need: a TODOS audit found a hardening item documented as complete while the code still contained the old behavior — a false completion report that sat unnoticed for weeks. Distinct from Provenance Drift Sentinel (values rotting over time): this catches done-claims that were never true at the moment they were made.

Date: 2026-06-12
Time: 13:21 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: high
Special Feature: Published-Knowledge Performance Ledger - Today a knowledge record's governed life ends at "Published for agents" with nothing measuring what happens after; this ledger instruments the afterlife by logging every time a pipeline agent retrieves or cites a published KB record in a live escalation — the record, the case, and the eventual case outcome — so each record accrues a help/neutral/harm performance score over time. Records that are never cited, or that correlate with bad outcomes, get flagged in the review queue for refresh or retirement, closing the knowledge lifecycle loop: earn-in governs entry, this governs continued tenure. Reviewers see "this record helped resolve 14 cases, last cited 3 days ago" right on the draft page, turning approval from a one-time gate into a managed portfolio. Distinct from Knowledge Earn-In / Claim Graduation (pre-publish entry), Provenance Drift Sentinel (source drift), and Section-Level Authorship Blame (who wrote what).

Date: 2026-06-12
Time: 13:31 AST
Model: Claude Fable 5
Is duplicate?: no
Complexity: medium
Special Feature: Test-Run Quarantine / Synthetic Evidence Tagging - Let the operator mark any pipeline run as a test/drill before sending it, tagging every artifact it produces (escalation, drafts, provider call packages, stats) as synthetic so it is fully captured for harness evaluation but excluded from the governed KB queue, pattern detection, and operational metrics. Discovered need: three test submissions of one template created three real KB review drafts, polluting the governed queue with synthetic cases indistinguishable from live work. Distinct from Duplicate Draft Coalescing (which handles collisions between real cases) — this keeps rehearsal evidence out of governed memory entirely while preserving it for evaluation.

Date: 2026-07-07
Time: 22:55 AST
Model: Codex GPT-5
Is duplicate?: no
Complexity: medium
Special Feature: Workflow Readiness Gate - Before an expert-agent workflow starts, check whether the required evidence, provider health, privacy mode, and routing assumptions are ready, then show a short readiness verdict for each agent. This keeps the operator from starting a coordinated workflow with missing evidence or unsafe routing, and turns "why did that agent not run correctly?" into a visible preflight decision instead of an after-the-fact mystery.

Date: 2026-07-09
Time: 23:56 AST
Model: Codex GPT-5.6 Sol (high)
Is duplicate?: no
Complexity: high
Special Feature: Agent Action Permissions - **Deferred pending the Workspace keep/remove decision; do not implement against the current inactive Workspace.** If a first-principles Workspace redesign introduces real write actions, the app should show and enforce exactly what an agent may change, which account or items it may touch, how long permission lasts, and whether it must ask first. Every attempted action would then be recorded as allowed, blocked, or waiting for confirmation.

Date: 2026-07-09
Time: Unknown AST
Model: Codex GPT-5.6 Sol (high)
Is duplicate?: no
Complexity: high
Special Feature: Evidence-Preserving Incident Capsule - When a serious failure occurs, automatically freeze the related trace IDs, provider evidence, health snapshot, configuration and prompt versions, and a plain-English “can/cannot prove” explanation into one reviewable incident package with a retention hold. This turns scattered diagnostics into a trustworthy handoff for human review and future agents, distinct from Evidence Completeness Check because it preserves and explains a cross-system incident after failure rather than checking whether one workflow saved its artifacts.

Date: 2026-07-11
Time: 06:34 AST
Model: Codex GPT-5
Is duplicate?: no
Complexity: medium
Special Feature: Stall Recovery Contract - Require every active work item to retain a named owner, a concrete next action, and a review date; when meaningful progress stops, the coordinator opens a visible intervention that classifies the cause as blocked, abandoned, waiting, or unclear and requires the responsible human or agent to acknowledge the recovery action. This creates accountability without measuring shallow activity, prevents “in progress” from becoming permanent storage, and gives the operator a trustworthy queue of work that genuinely needs a decision or handoff.

Date: 2026-07-11
Time: 07:25 AST
Model: Codex GPT-5
Is duplicate?: no
Complexity: medium
Special Feature: Commitment Admission Gate - Before new work is accepted into the active portfolio, compare it with current human and agent capacity, existing promises, blocked dependencies, and higher-value unfinished work, then require an explicit choice about what will be delayed, delegated, or stopped. This prevents quiet overcommitment from creating artificial stalls and preserves the evidence behind each tradeoff without turning raw activity into a performance score.

Date: 2026-07-11
Time: 08:51 AST
Model: Codex GPT-5.6 Sol (high)
Is duplicate?: no
Complexity: medium
Special Feature: Agent Harness Health Check - Provide a read-only project health view that shows which coding-agent instructions, hooks, skills, specialist agents, and memory files are active, then flags stale memory, broken skill references, duplicate rules, or disabled guards in plain English. This prevents silent configuration drift and false confidence without turning the product into a developer dashboard.
