# KB Evidence Canvas Prototype Notes

This prototype follows `prototypes/kb-premium-ux-brief/BRIEF.md` as a standalone KB-specific exploration.

## Product Job

The user job is to decide what a proposed KB record can safely become. The screen focuses on a single review decision:

- trusted agent guidance
- case history only
- rejected knowledge
- deprecated knowledge

## Design Lens

The lens is an evidence review canvas. The source, proposed guidance, scope, gaps, contradictions, and agent-use consequences are visible in the same working surface. Audit history exists, but it is hidden behind a secondary reveal so the first viewport does not feel like an admin dashboard.

## Deliberate Boundaries

- This does not copy the image-parser workflow.
- This does not use queues, metrics, lifecycle strips, internal model names, or database state as the primary surface.
- This is static prototype code only under `prototypes/kb-evidence-canvas-prototype/`.
- Production app files are untouched.
