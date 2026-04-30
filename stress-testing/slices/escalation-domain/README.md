# Slice — escalation-domain

## Purpose

Stress the persistence and retrieval paths around escalations and the knowledge workflows built on top of them.

## In scope

- `server/src/routes/escalations.js`
- `server/src/routes/copilot.js`
- `server/src/routes/investigations.js`
- `server/src/routes/templates.js`
- `server/src/routes/playbook.js`
- `server/src/routes/analytics.js`
- `server/src/models/Escalation.js`
- `server/src/models/KnowledgeCandidate.js`
- `server/src/models/Investigation.js`
- `server/src/models/Template.js`
- `server/src/lib/escalation-parser.js`
- `server/src/lib/parse-validation.js`
- `server/src/lib/knowledge-promotion.js`
- `server/src/services/copilot-service.js`
- `server/src/services/inv-matcher.js`
- `playbook/**`
- escalation-focused client views such as `client/src/components/EscalationDashboard.jsx`, `EscalationDetail.jsx`, `InvestigationsView.jsx`, `TemplateLibrary.jsx`, and `PlaybookEditor.jsx`

## Out of scope

- standalone image parser routes and history
- main chat send/retry flows
- workspace assistant and rooms
- Gmail and Calendar connector correctness
- startup/runtime health plumbing

## Entry points

- `/api/escalations/*`
- `/api/copilot/*`
- `/api/investigations/*`
- `/api/templates/*`
- `/api/playbook/*`
- `/api/analytics/*`

## Current harness coverage

- `harness/run.js` covers targeted HTTP scenarios for escalation create/update/get/filter/similar/delete.
- The same runner covers deterministic knowledge draft generation, review updates, candidate listing, and safe publish blocking for case-history-only drafts.
- It also covers investigation create/search/match/update/delete and template create/render/use/duplicate/delete.
- Runner-created Mongo records are cleaned up before the report is written.

## External dependencies

- MongoDB collections for escalations, knowledge candidates, investigations, and templates
- local playbook markdown files
- AI providers when parse and copilot paths invoke them
- screenshot files under `uploads/escalations`

## Known shared surfaces

- conversations linked from escalations
- traces and usage logs for AI-backed actions
- provider configuration and prompt store
- image-intake-and-parse slice for screenshot-derived escalation creation
