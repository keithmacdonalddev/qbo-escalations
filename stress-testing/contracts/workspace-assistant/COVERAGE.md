# Coverage — workspace-assistant

## Current status

Implemented and mapped. The slice now covers shared Workspace session creation,
SSE streaming, durable conversation history, validation failures, replay,
provider failure propagation, the Workspace-specific operating profile, and the
deterministic action-permission harness. The permission harness executes no
external Gmail or Calendar mutations.

## Contract priorities

- session start and streaming
- action-loop rounds
- memory and auto-action side effects
- briefing and alert flows
- Gmail and Calendar assisted workflows
- enabled-state and proactive-policy enforcement
- automatic versus confirmation-required action decisions
- exact approval binding and durable action evidence
- abort and busy-state behavior

## Known gaps

- connected-service reads and writes still need a broader stub matrix
- no trusted real-browser proof yet covers an inline confirmation from preview through execution receipt
- background monitor and daily briefing timing need clock-controlled stress fixtures
