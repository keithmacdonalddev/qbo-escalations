# Newton Post-Chat Workflow Prototype

This is an isolated prototype. It does not edit or depend on production app files.

## Intent Contract

The design reference is the successful chat/image intake pipeline:

`Upload image -> Parser -> INV search -> Triage -> QBO assistant`

This prototype extends that same pattern after the chat run:

`Upload image -> Parser -> INV search -> Triage -> QBO assistant -> Case workbench -> Finish outcome -> Optional teach agents`

The primary user job is not to manage Sessions, Escalations, Attention, Knowledge, or Investigations. The primary job is to finish one escalation with expert-agent help.

## How The Failed Pages Are Reframed

- Sessions becomes `Conversation history`: only used to confirm where a run/case went.
- Escalations becomes `Case workbench`: the active case and next human action.
- Attention becomes `Decisions needed`: blocking decisions only when they affect the case.
- Knowledge becomes `Teach agents`: optional after the outcome is known.
- Investigations becomes `Known issue evidence`: pulled into the case by the INV Search Agent.

## Design Rules Used

- One visible workflow path.
- One dominant action per stage.
- The current agent owner is visible.
- The active case stays central.
- Supporting views are contextual trays, not the main mental model.
- No system dashboard is required to understand what happens next.

## What This Prototype Does Not Prove

- It does not prove the production data model is correct.
- It does not prove current API routes support this exact flow.
- It does not replace detailed accessibility, performance, or responsive QA.
- It does not claim final product correctness.

It is a product-direction prototype for the post-chat escalation experience.
