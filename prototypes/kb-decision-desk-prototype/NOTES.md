# KB Decision Desk Prototype Notes

## Intent

This prototype is a standalone KB-specific decision desk for human review. It does not use production app code and does not copy the image-parser workflow.

The first viewport is centered on one job: decide what the selected knowledge item can become. The reviewer can see the active item, supporting evidence, missing requirements, editable guidance fields, and the consequence for agent use without opening a dashboard or learning internal implementation labels.

## Interaction Coverage

- Select records from the left review queue.
- Search and filter records by review urgency/readiness.
- Edit summary, root cause, exact fix, scope, exclusions, and reviewer note.
- Choose trusted guidance, case history only, reject, or deprecate.
- Open evidence and audit details in a drawer.
- Toggle required publish checks.
- See the primary action become enabled or blocked based on the selected outcome and requirements.
- Apply a decision and see agent-use permissions update.

## Product Rationale

The KB is treated as governed memory for a broader expert-agent platform. The UI avoids treating the KB as the whole product and keeps human truth/risk ownership visible: agents may use knowledge only after the reviewer explicitly approves the outcome and allowed use.

