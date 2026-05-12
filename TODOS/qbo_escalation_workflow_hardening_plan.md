# QBO Escalation Workflow Hardening Plan

Last updated: 2026-05-11

## Purpose

This is the living planning document for hardening the current QBO escalation workflow before building the first ontology / operational intelligence slice.

The goal is not to design a separate ontology system first. The goal is to make the existing escalation workflow reliable, traceable, reviewable, and useful enough that ontology concepts can grow from real case activity.

## Current Working Thesis

The first ontology slice should be a structured layer over the existing QBO escalation workflow.

That means the early implementation should feel like:

- a clearer escalation lifecycle
- a notification / attention center for cases needing review
- preserved evidence for parser, triage, INV matching, analyst response, resolution, and knowledge drafting
- safer knowledge candidate creation and publishing
- early ontology relationships generated from reviewed workflow facts, not model guesses

## Discussion Status

We are reviewing the hardening areas one by one before implementation.

| Area | Status | Current Direction |
| --- | --- | --- |
| 1. Canonical intake reliability | In discussion | Keep the parser agent narrow; the app/server owns the evidence envelope around its output. |
| 2. Case lifecycle consistency | First attention producers implemented | Use a durable attention queue for workflow items that need a user decision; it now covers duplicate warnings and missing finalization notes. |
| 3. Duplicate and retry safety | Durable warnings implemented | Reuse existing conversation-linked escalations on retries/re-parses; warn and create review items when different conversations or screenshot uploads look like the same real-world issue. |
| 4. Known issue / INV confidence boundaries | Initial known issue search implemented | Treat INV matches as candidates unless evidence or human review confirms them. |
| 5. Resolution discipline | First attention producer implemented | Resolved or escalated-further cases without an explanation now create review items; decide later whether the UI should hard-block. |
| 6. Knowledge candidate safety | First attention producer implemented | Keep drafts reviewable, evidence-backed, and explicitly labeled for reuse safety. |
| 7. Evidence ledger | Not yet discussed in detail | Add a thin event trail around the existing workflow. |
| 8. Ontology vertical slice | Future planning | Build only after the workflow hardening plan is clear. |

## Decision Log

### 2026-05-04

- Decided to discuss each hardening area one by one before building.
- Decided to maintain this living planning document so decisions survive long back-and-forth discussion.
- Current recommendation: harden the QBO escalation workflow before building the ontology vertical slice.
- Current ontology direction: start with an MVP trail / pathfinder inside the existing workflow, not a separate ontology product.
- Item 1 clarification: the image parser agent is treated as a narrow, tested transcriber for one screenshot template into one text template. Canonical intake reliability should not expand that agent's job.

### 2026-05-11

- Operational dependency check: `llm-gateway` was started on `127.0.0.1:4100`; LM Studio's local server was started on `127.0.0.1:1234`; QBO image-parser status reported `llm-gateway` available with `google/gemma-4-e4b`.
- Item 3 first implementation: conversation-linked escalation creation is now idempotent for manual create, `from-conversation`, parse-with-conversation, and chat-side automatic screenshot persist.
- Item 3 link safety: linking a conversation to a second escalation now returns a conflict unless the caller explicitly sends `force: true`, which makes intentional relinking visible in code.
- Item 3 second implementation: new escalation creation now returns possible-duplicate warning metadata when another escalation from a different conversation or intake path shares strong signals such as case number, COID, screenshot hash, category, symptom text, and a recent time window.
- Item 2 first implementation: duplicate warnings now create durable `EscalationAttentionItem` records and the Escalation Dashboard has an Attention tab with open/handled/separate/dismissed review states.
- Item 3 durable warning behavior: duplicate warnings remain non-blocking but can now be handled, dismissed, or marked as intentional separate escalations from the dashboard.
- Item 5 first implementation: `resolved` or `escalated-further` escalations without `resolution` or `resolutionNotes` now create durable `missing-resolution` attention items; adding an explanation auto-closes the item.
- Item 2 remaining gap: the attention queue now covers duplicate warnings, missing finalization notes, stale open cases, parser/triage review issues, agent governance failures, and knowledge-review discipline; missing links still need a review-item producer.
- Item 2 stale-case implementation: loading the attention queue with refresh now scans for `open` cases stale for 14 days and `in-progress` cases stale for 7 days, creating `stale-open` review items and closing them once the source case is no longer stale.
- Item 2 parser/triage implementation: attention refresh now scans parse metadata for validation issues, low confidence, regex fallback, provider fallback, or failed parser attempts and creates `parse-review` items until the parse metadata is corrected or the item is manually handled.
- Item 6 first implementation: generated or edited knowledge drafts now create durable `knowledge-review` attention items; approval, publish, or a rejected draft with reviewer notes closes the item.

## 1. Canonical Intake Reliability

### Plain-English Meaning

The first reliable version of a case should preserve the original evidence and the structured parser result.

This is the root evidence for everything that happens later.

### Parser Agent Boundary

The parser agent should keep doing one job:

```text
one expected image template -> one expected text template
```

Canonical intake reliability should not make the parser agent responsible for app state, case lifecycle, knowledge decisions, duplicate detection, or ontology decisions.

Instead, the app should wrap the parser's deterministic output in an intake record that says where the output came from, when it was produced, which parser configuration produced it, and how it was used later.

The parser produces the text template. The app owns the surrounding context.

### Candidate Data To Preserve

- source screenshot, screenshot hash, or source conversation
- raw parsed escalation text
- structured parser fields
- parser validation issues
- parser provider and model
- triage provider and model
- parser confidence or quality score, if available
- whether the parser succeeded, partially succeeded, or failed
- whether any human correction changed the parsed fields

### Proposed Responsibility Split

- Parser agent: converts the known screenshot template into the known text template.
- Client UI: sends the parser result forward with source context, shows validation or review state, and lets the user correct fields if needed.
- Server intake layer: stores the canonical intake record, links it to conversation and escalation records, and records parser provider/model/config metadata.
- Escalation workflow: uses the canonical intake record as the source of truth for triage, INV matching, analyst response, resolution, and knowledge drafting.
- Knowledge / ontology layer: reads from the preserved intake record later; it should not ask the parser agent to remember or explain past context.

### Why It Matters

If the app later says a case belongs to a category, matches an INV, or should become reusable knowledge, the user should be able to trace that conclusion back to the original evidence.

If the parser got something wrong, that mistake should not silently become permanent knowledge.

Even if the parser is treated as 100% accurate for the tested template, the app still needs to remember the receipt around the parser output:

- which screenshot/conversation produced it
- which parser/model/config produced it
- whether the output was later edited by a human
- whether it created a new escalation or linked to an existing one
- whether later triage, INV matching, or knowledge drafting relied on it

### Open Questions

- What is the minimum required evidence before a case can become an escalation record?
- Should failed parser attempts be preserved or only successful attempts?
- Should human edits to parser fields be tracked separately from the original model output?
- Should screenshot source and conversation source use the same intake record shape?
- Should parser provider/model/config be captured on every parse even when the parser is considered deterministic and fully tested?

## 2. Case Lifecycle Consistency

### Plain-English Meaning

A case should move through clear workflow states instead of being spread across parser output, chat messages, escalation records, and knowledge drafts without a single reviewable lifecycle.

Proposed lifecycle:

```text
parsed -> triaged -> analyst answered -> escalation record linked -> resolved/escalated -> knowledge candidate
```

### Notification / Attention Center Direction

The user raised that this should probably become a notification center for things needing attention.

That is likely the right product shape.

Possible names:

- Attention Center
- Escalation Review Queue
- Needs Review
- Case Workbench

Possible attention items:

- parser failed validation
- triage used fallback
- strong INV candidate needs confirmation
- weak INV candidate needs review
- escalation record has not been linked
- possible duplicate escalation detected
- case is stale and still open
- case is resolved but missing resolution notes
- knowledge draft is ready for review
- knowledge draft was approved but not published

### Current Implementation

The first attention-center surface is intentionally narrow:

- possible duplicate escalations become durable attention items
- resolved or escalated-further escalations missing an explanation become durable attention items
- items can be filtered by open, handled, separate, and dismissed
- the dashboard links back to the source escalation and, for duplicates, the strongest duplicate candidate
- closing an item records the chosen review state instead of deleting the evidence

This gives the workflow a real review queue without requiring the full lifecycle model yet.

### Open Questions

- Should the attention center be its own page or part of the existing escalation dashboard?
- Which events require user action versus passive history?
- Should attention items be dismissible, resolvable, or tied to specific state transitions?
- Should the app support priorities for attention items?

## 3. Duplicate And Retry Safety

### Plain-English Meaning

Retries, refreshes, re-parses, and repeated sends should not create duplicate durable records.

The workflow should protect against duplicate:

- escalation records
- screenshot attachments
- known issue / INV links
- knowledge candidates
- attention center tasks

### Current Understanding

The app now has a first server-side guard for the strongest duplicate signal: a source conversation should point at one durable escalation record.

The guarded paths are:

- `POST /api/escalations` when a `conversationId` is supplied
- `POST /api/escalations/from-conversation`
- `POST /api/escalations/parse` when a `conversationId` is supplied
- automatic screenshot escalation persist from the main chat flow
- `POST /api/escalations/:id/link`

Repeated sends, refreshes, and re-parses from the same conversation should reuse the existing linked escalation instead of creating a second record.

The remaining risk is no longer silent server-side creation. The server now allows the separate record but returns warning metadata so the client or future attention center can make the overlap visible.

### Implemented Guard Behavior

- If a conversation already has `escalationId`, creation returns the existing escalation with duplicate safety metadata.
- If an escalation already points to the conversation but the conversation link is stale, the app reconciles the conversation back-link.
- If a link request would attach one conversation to a second escalation, the server returns a conflict unless `force: true` is supplied.
- If forced relinking is used, the old escalation is unlinked from the conversation before the new one is linked.
- If a different conversation or manual intake creates a similar escalation, the server does not block it; it returns `duplicateSafety.warnings[]` with scored candidates and the signals that matched.
- If a screenshot is attached to an escalation and another escalation already has the same normalized screenshot hash, the upload response includes the same possible-duplicate warning shape.
- Duplicate warnings are persisted as attention items so the user can handle, dismiss, or intentionally split them later instead of losing the warning after the API response.

### Candidate Duplicate Signals

- same COID
- same case number
- same screenshot hash
- same category
- same parsed actual outcome
- same attempting-to field
- same source conversation
- close time window

### Open Questions

- Should likely duplicates be blocked or shown as warnings?
- What should happen if a user intentionally wants a separate escalation for the same customer/case?
- Should duplicate detection run before escalation creation, before knowledge draft creation, or both?
- What fields are reliable enough to use for duplicate detection?

## 4. Known Issue / INV Confidence Boundaries

### Plain-English Meaning

An INV match should usually be treated as a candidate, not as confirmed truth.

The app should preserve why a known issue looked relevant and whether it was later accepted, rejected, or left uncertain.

### Candidate Match States

- proposed
- weak candidate
- strong candidate
- confirmed
- rejected
- used as search hint only

### Evidence That Could Strengthen A Match

- same product area
- same workflow
- same error text or symptom
- same form, report, or filing type
- same timing or incident window
- same workaround
- same affected customer pattern

### Evidence That Should Stay Weak

- broad category match only
- vague keyword overlap only
- same product but different behavior
- same tax/payroll area but different failure mode

### Why It Matters

Future AI or ontology logic should not say "this was caused by INV-12345" if the actual workflow only found INV-12345 as a weak candidate.

### Open Questions

- What should count as a strong INV match in this app?
- Who can confirm or reject an INV match?
- Should rejected INV candidates stay visible in the case history?
- Should confirmed INV matches affect knowledge candidate generation?

## 5. Resolution Discipline

### Plain-English Meaning

"Resolved" should not be an empty state.

A resolved escalation should have a resolution summary, resolution reason, or equivalent explanation.

### Proposed Rules

- `resolved` requires a resolution summary or reason.
- `escalated-further` requires an escalation reason or next escalation path.
- a rejected knowledge candidate requires review notes.
- an unsafe-to-reuse knowledge candidate requires a reason.

### Why It Matters

Knowledge extraction needs the fix, not just the symptom.

Without a resolution summary, the app can learn what happened but not what to do next time.

### Current Implementation

- `PATCH /api/escalations/:id` and `POST /api/escalations/:id/transition` now sync a `missing-resolution` attention item.
- `resolved` without `resolution` or `resolutionNotes` opens a "Missing resolution notes" item.
- `escalated-further` without `resolution` or `resolutionNotes` opens a "Missing escalation reason" item.
- Adding a resolution explanation later auto-closes the attention item.
- This is currently review-queue behavior, not a hard block.

### Open Questions

- What is the minimum acceptable resolution note?
- Should the UI block resolution or warn and allow override?
- Should older resolved cases without notes be backfilled, flagged, or ignored?

## 6. Knowledge Candidate Safety

### Plain-English Meaning

Not every resolved case should become reusable knowledge.

The system should distinguish between a generally reusable fix and a case that should only remain searchable as history.

### Candidate Reuse Labels

- canonical reusable pattern
- edge case
- case history only
- customer-specific
- temporary incident
- unsafe to reuse

### Candidate Source Events

A knowledge draft should know whether it came from:

- parser success
- parser failure
- triage fallback
- INV match
- rejected INV match
- linked escalation creation
- resolve transition
- escalated-further transition
- manual user edit
- AI enrichment

### Proposed Safety Rules

- Do not auto-publish knowledge.
- Require human review before publishing.
- Preserve the source snapshot used to generate the draft.
- Show warnings when the exact fix or root cause is missing.
- Treat fallback triage or weak INV evidence as lower-confidence source material.
- Prevent duplicate knowledge drafts from duplicate escalation records where possible.

### Open Questions

- Which draft fields must be present before approval?
- Should AI enrichment be optional, required, or only used after a human starts the draft?
- Should low-confidence drafts default to case history only?
- Should the user be able to publish an edge case into a separate playbook section?

## 7. Thin Evidence Ledger

### Plain-English Meaning

An evidence ledger is a structured timeline of important workflow events.

It is not a blockchain and should not be a separate complicated system.

It is a receipt trail for the case.

### Example Events

```text
parse.completed
triage.completed
inv.match.proposed
inv.match.confirmed
inv.match.rejected
analyst.response.completed
escalation.linked
resolution.recorded
knowledge.draft.generated
knowledge.approved
knowledge.published
knowledge.rejected
```

### Why It Matters

The future ontology should be built from facts with sources, not loose model-generated summaries.

Example:

```text
Weak:
T4 XML issue -> fixed by payroll mapping correction

Stronger:
This relationship came from a resolved escalation, parser validation passed,
INV candidate was rejected, and the knowledge candidate was human-approved as an edge case.
```

### Open Questions

- Should the ledger be a new collection or embedded in existing conversation/escalation records?
- Which events should be immutable?
- Which events should create attention center items?
- How much model metadata should each event store?

## 8. First Ontology Vertical Slice

### Current Direction

Build this only after the workflow hardening plan is clear.

The first ontology slice should not be a standalone ontology product.

It should be a structured layer over reviewed escalation workflow facts.

### MVP Trail Concept

The early version should let the user feel the ontology idea through practical workflow improvements:

- cases have clear state
- decisions have evidence
- weak matches stay weak
- resolved cases can become reviewed knowledge
- reviewed knowledge can create structured relationships
- the app can explain where a relationship came from

### Possible First Ontology Objects

- Case
- Symptom
- Product Area
- Workflow Step
- Known Issue / INV
- Resolution
- Knowledge Candidate
- Playbook Entry
- Evidence Event

### Open Questions

- What is the smallest ontology relationship worth showing in the UI?
- Should ontology data first appear as an explanation panel, graph, search filter, or recommendation engine?
- Which relationships require human approval before becoming durable?
- What should be excluded from ontology learning?

## Running Open Questions

- What should be the first user-facing workflow improvement: attention center, evidence ledger, or stricter resolution rules?
- Should hardening be implemented as one vertical slice or several smaller phases?
- What should remain model-assisted versus deterministic code?
- What should require human approval?
- Which existing screens should change first?
