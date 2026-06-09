# Premium KB UX Prototype Brief

## Scope

Design a premium user experience for the Knowledge / KB feature specifically.

This is not a request to copy the existing chat/image-parser workflow. The image intake screen is only a quality reference for clarity: one obvious purpose, one dominant action, visible state, low cognitive load, and complexity available only when needed.

The prototypes should explore better ways for a user to review, validate, correct, publish, reject, search, and understand knowledge that may later guide expert AI agents.

## Product Frame

The app is not just a QBO knowledge base.

QBO escalation support is the first domain module inside a broader operational intelligence platform where expert AI agents help the user handle complex work and life situations using shared evidence, governed memory, workflows, decisions, actions, and human validation.

The KB is one mechanism inside that platform. It is shared governed memory for expert agents and human reviewers. It is not the product destination by itself.

## KB User Job

The KB user is trying to answer:

- What knowledge exists?
- Where did it come from?
- Is it a draft, trusted guidance, rejected, deprecated, or only case history?
- Can agents use it?
- If agents can use it, for what purpose?
- What evidence supports it?
- What is missing?
- What needs my decision now?
- What should I correct, approve, reject, publish, deprecate, or keep as evidence only?

The user should not have to understand internal model names, database states, indexes, or backend services to make those decisions.

## Agent-Team Job

The KB must help specialist agents work better without turning AI output into unreviewed truth.

Agents need:

- trusted guidance they may use in answers
- case-history evidence they may use for similarity or investigation
- weak signals clearly marked as weak
- rejected or deprecated guidance kept out of final recommendations
- provenance, scope, confidence, and validation state
- clear boundaries on allowed use

Humans own truth, risk, publication, and permission to reuse guidance.

## What The Current UI Gets Wrong

The current and previous KB-related screens overexposed:

- dashboards
- review queues
- lifecycle strips
- metrics
- filters
- evidence scores
- trust states
- indexed claims
- agent connection panels
- attention items
- internal labels

Those concepts may exist, but they should not dominate the first viewport.

The user experience failure was not missing explanation. The failure was making the user navigate implementation machinery.

## Design Requirement

Each prototype must be KB-specific and must not copy the image-parser pipeline.

A strong KB prototype should make one of these jobs immediately obvious:

- Review this draft and decide what it can become.
- Find trusted guidance for this issue.
- Validate whether agents may use this knowledge.
- Compare evidence before approving guidance.
- Clean up the knowledge library by resolving the highest-risk items.
- Turn a proven case outcome into reusable agent guidance.

The prototype may choose any premium UI model that fits the KB job. Possible directions include, but are not limited to:

- decision desk
- evidence review canvas
- trusted guidance library
- agent guidance studio
- queue plus detail inspector
- source-to-guidance composer
- command-palette driven review
- split-pane reviewer workbench
- timeline/provenance review
- issue-centered knowledge map

Do not default to the existing dashboard/table/card layout unless it is clearly transformed into a premium, task-first experience.

## Required Capabilities To Represent

The prototype should show how the user can:

- see the most important KB work needing attention
- search or browse knowledge without knowing internal states
- select a knowledge item
- understand the source case/conversation/evidence
- see what an AI or agent proposed
- see whether the proposed knowledge is safe, unsafe, weak, stale, contradicted, or ready
- correct the summary, root cause, exact fix, scope, exclusions, and notes
- choose whether this becomes trusted agent guidance, case history only, rejected, or deprecated
- understand what agents can and cannot do with it
- view supporting evidence and audit trail without being overwhelmed
- publish or approve only when requirements are met

## First Viewport Standard

The first viewport must answer:

- What is this screen for?
- Why am I here?
- What is the most important thing to do now?
- What information is needed?
- What decision am I making?
- What happens after I decide?

If the user must read a large explanation before acting, the prototype fails.

## Visual And Interaction Standard

Aim for a premium professional tool, not a marketing page and not an admin console.

Use:

- clear hierarchy
- calm density
- one dominant primary action
- direct manipulation where useful
- progressive disclosure
- clear empty states
- clear selected states
- consistent terminology
- source/evidence clarity
- visible consequences of decisions

Avoid:

- decorative lifecycle strips
- generic metric dashboards as the primary surface
- multiple competing primary actions
- raw telemetry as primary UI
- unexplained internal labels
- long instructional copy
- giant empty hero areas
- cards inside cards
- status colors without meaning
- making users understand database or agent internals

## Relationship To Referenced Screens

Use the referenced screenshots as follows:

- Image intake screen: clarity benchmark only, not a workflow template.
- Sessions screen: anti-pattern for making users find knowledge through conversation plumbing.
- Escalations screen: anti-pattern for showing lifecycle and metrics before the task.
- Attention Center: anti-pattern for exposing workflow-engine internals.
- Knowledge screen: current target surface to improve, but do not assume its layout is correct.
- Investigations screen: useful evidence source, but not the KB mental model.

## Prototype Output

Each independent agent must create a standalone prototype in its assigned folder:

- `index.html`
- `styles.css`
- `script.js`
- optional `NOTES.md`

Do not edit production app files.

The prototype should be interactive enough to demonstrate the intended KB experience: selecting records, changing review decisions, opening evidence, searching/filtering, and seeing agent-use consequences.

## Pass / Fail Checklist

The prototype passes only if:

- it is clearly a KB-specific experience
- it does not copy the image-parser workflow
- the first viewport has one clear user job
- agent reuse is understandable without internal jargon
- evidence and provenance are available but not overwhelming
- review decisions are obvious
- the user can tell what is safe for agents and why
- advanced diagnostics are secondary
- the design could plausibly scale beyond QBO to future domains

The prototype fails if:

- it is mainly a dashboard
- it makes the user learn Sessions, Attention, or database states first
- it treats KB as the whole product
- it hides the source/evidence behind vague labels
- it has multiple conflicting next actions
- it depends on long explanatory copy
- it copies the chat/image-parser pipeline instead of designing the KB job
