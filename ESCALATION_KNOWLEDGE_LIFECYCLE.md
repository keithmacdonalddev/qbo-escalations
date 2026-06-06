# Escalation To Knowledge Lifecycle

This document is the contract for the current QBO domain module. It keeps the user-facing workflow aligned with the larger product direction in `PRODUCT_NORTH_STAR.md`.

QBO escalations are not the whole product. They are the first domain workflow inside an operational intelligence platform where specialist agents help a user handle complex work using shared evidence, memory, workflows, and human validation.

## User Purpose

The escalation workflow exists so a user can handle a real customer issue from intake to outcome with help from coordinated AI agents.

The knowledge workflow exists so the agent team can learn from resolved work without turning unreviewed guesses into future guidance.

## Lifecycle

1. Captured
   - A case exists.
   - Typical source today: the Escalation Image Parser turns an uploaded screenshot into a structured escalation template and the server saves it.
   - The chat keeps a link to the case so starting a new chat does not erase the work.

2. Working
   - The case is being investigated.
   - Agents may help with parsing, similar case search, triage, and support guidance.
   - The user still owns the final decision and outcome.

3. Resolved Or Escalated Further
   - The case has a final outcome for this workflow.
   - "Resolved" means a working fix or clear support outcome was recorded.
   - "Escalated further" means this app's team cannot finish the issue, but the handoff reason and next owner should be recorded.
   - This is the earliest point where a review draft may be created.

4. Review Draft
   - The system creates a draft lesson from the case fields, resolution notes, source evidence, and linked conversation when available.
   - The draft is not agent guidance.
   - The user must review the wording, remove speculation, confirm scope, and decide whether it is reusable.

5. Human Approved
   - A human has confirmed that the draft is accurate enough for its selected use.
   - Approved does not automatically mean agents can use it.
   - Records can remain case-history-only when they are useful context but unsafe as reusable guidance.

6. Trusted Knowledge
   - The approved record has been published for agent use.
   - Agents can retrieve it as trusted guidance according to the allowed-use scope.
   - Future outcomes should still be monitored so weak, outdated, or harmful guidance can be corrected.

## User-Facing Labels

Use these labels in UI and docs whenever possible:

- `open` -> Captured
- `in-progress` -> Working
- `resolved` -> Resolved
- `escalated-further` -> Escalated further
- `draft` -> Needs review
- `approved` -> Approved by human
- `published` -> Published for agents
- `candidate` -> Needs review
- `trusted` -> Trusted Knowledge
- `review-only` -> Human review only
- `agent-response` -> Chat agent guidance
- `triage` -> Triage guidance

Avoid exposing internal labels such as "candidate", "review-only", "KB", or "knowledge queue" without plain-English context.

## Page Responsibilities

Chat should make the linked case visible and answer:

- Did this chat create or link to a case?
- Where is that case?
- What is the next action?

Escalations should answer:

- What cases need work now?
- What is each case's status?
- Which cases are ready to become reviewed knowledge?

Knowledge should answer:

- What reviewed lessons exist?
- Which ones are still human-review-only?
- Which ones can agents use?
- Where did each record come from?
- What evidence and scope support it?

## Agent Responsibilities

Specialist agents should stay task-focused, but their prompts and profile docs should acknowledge the shared lifecycle when their output affects it.

- Parser agents capture facts from source material. They should not invent resolution or root cause.
- Triage agents identify likely direction and next action. They should not mark a case resolved.
- Knowledge enrichment agents draft reviewable knowledge. They should clearly distinguish sourced facts from inferred wording.
- Chat/support agents may use trusted knowledge, but should not treat draft or review-only records as final guidance.

## Safety Rules

- No draft becomes agent guidance until reviewed and published.
- No unresolved case should create trusted knowledge.
- If the exact fix is missing, the draft must say that instead of pretending the fix is known.
- Source case, linked conversation, reviewer state, and allowed use must remain visible to the user.
- The UI should always show the next action instead of forcing the user to infer the workflow.
