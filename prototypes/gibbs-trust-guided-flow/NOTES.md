# Gibbs Trust Guided Flow Prototype

This standalone prototype tests a workflow-first alternative to the confusing production surfaces.

## Design Contract

- The reference pattern is the successful chat/image intake pipeline: one visible pipeline, one active task, and clear agent status.
- The primary user job after image intake is to finish the case outcome.
- History, case lists, human decisions, known issues, and agent teaching are supporting views.
- Agent teaching is locked until a human records a proven outcome.
- The UI avoids making Sessions, Escalations, Attention, Knowledge, or Investigations the user's primary mental model.

## Screenshot Coverage Map

- Chat/Image Intake -> `Work now`, initial intake panel and agent lane.
- Sessions -> `History`, saved conversations and source links.
- Escalations -> `Cases`, open case work and outcome status.
- Attention Center -> `Decisions`, human review queue.
- Knowledge -> `Teach agents`, gated guidance only after proof.
- Investigations -> `Known issues`, evidence agents can compare against active cases.

## Validation Target

A reviewer should be able to answer the following from the first screen after intake:

- Was a case created?
- Is the source linked?
- What agent work happened?
- What information is missing?
- What outcome decision is required?
- Can agents use this as guidance yet?
