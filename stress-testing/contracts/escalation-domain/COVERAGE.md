# Coverage — escalation-domain

## Current status

Started.

The first executable runner covers targeted HTTP-level scenarios for escalation CRUD/filter/similar lookup, deterministic knowledge draft generation and review gates, investigation create/search/update/delete, and template render/use/duplicate/delete behavior.

## Contract priorities

- escalation create/update/delete: started
- list, search, filter, and pagination: started for exact case filtering and similar category lookup
- knowledge candidate generation and publish flows: started for deterministic generation, review update, list, and non-publishable gating
- investigation matching and template workflows: started
- playbook-backed read/write behavior

## Known gaps

- no redaction/source inventory yet
- no AI-backed copilot coverage yet
- no playbook write/publish mutation coverage yet
- no burst, soak, or large-data shapes yet
