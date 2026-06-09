# Mill Workbench IA Prototype

This standalone prototype replaces page-first navigation with one active escalation
workbench.

## IA Position

Image #1 is treated as the reference model:

`Upload image -> Escalation Image Parser -> INV Search Agent -> Triage Agent -> QBO Assistant`

The prototype extends that model into the full post-chat lifecycle:

`Intake -> Investigate -> Triage -> Resolve -> Teach Agents`

## What Changed Conceptually

- `Sessions` becomes **History** attached to the active case.
- `Escalations` becomes the **active workbench**, not a dashboard.
- `Attention` becomes **Decisions** that block progress.
- `Investigations` becomes **Known Issues** shown during investigation.
- `Knowledge` becomes **Teach Agents**, available only after the outcome is clear.

## No-Go Patterns Captured

- Do not present system inventory as the main product.
- Do not make users visit Sessions to find where their escalation went.
- Do not make Knowledge the immediate next step after chat.
- Do not expose raw metrics before the user knows the current task.
- Do not add lifecycle cards unless they directly advance the active job.
- Do not claim a case can teach agents until the final fix is proven.
