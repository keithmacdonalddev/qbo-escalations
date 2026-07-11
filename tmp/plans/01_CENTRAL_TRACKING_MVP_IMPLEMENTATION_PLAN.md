# Central Tracking Platform — MVP Implementation Plan

- **Plan level:** 1 of 3
- **Status:** Ready for implementation review; no implementation has started
- **Product state at completion:** A complete, polished, independently deployable base product
- **Required predecessor:** None
- **Required successor:** None for continued operation; the user-ready and enterprise plans may be implemented later
- **Timing:** Deliberately unspecified

## Quick read

Build a new central application that becomes the trusted home for actionable work across all projects. The first users are the owner and trusted AI agents. The MVP must replace scattered chat history, markdown files, Notepad files, and physical reminders with a reliable loop for capturing, organizing, assigning, progressing, proving, and closing work.

This is a **complete base product**, not a disposable experiment. It may remain the production version for an unknown length of time. It must therefore be secure, backed up, visually premium, understandable without technical knowledge, and honest about what it can and cannot automate.

The MVP deliberately stops before public customer reporting, advanced workflow automation, and enterprise organization controls. Those are additive work in Plans 2 and 3. The MVP data, identifiers, API contracts, audit history, and design system must survive those additions without a rewrite.

## 1. Role in the broader platform

### User goal

Never lose important work, know what deserves attention, know who or which agent owns the next action, and know whether a claimed result was actually completed.

### Product workflow

Turn scattered signals into accountable work:

```text
Capture → Review → Decide → Assign → Act → Verify → Close or consciously defer
```

### Agent-team responsibility

Agents may capture findings, organize evidence, suggest duplicates, and record progress. The owner remains responsible for confirming truth, setting important priorities, approving risky changes, and accepting final outcomes.

### Evidence, memory, and validation

Every important status change, decision, attachment, assignment, and completion claim must retain who did it, when it happened, and what evidence supports it. The system must distinguish an agent suggestion from an owner-approved decision.

### What this deliberately does not solve

- It does not replace project repositories, code review, deployment tools, or project-specific tests.
- It does not provide a public customer feedback widget yet.
- It does not implement billing, subscriptions, product tiers, upgrades, or downgrades.
- It does not provide multi-company enterprise administration.
- It does not allow agents to silently decide product priority or close important work.

## 2. Confirmed product decisions

1. Create a **new central application**, not a complete tracker inside every existing project.
2. Treat QBO Escalations as the first connected project, not the definition of the whole product.
3. Use one central API with project-scoped credentials rather than a different API implementation in every project.
4. Track all of these work types from the beginning:
   - problem report;
   - confirmed bug;
   - feature request;
   - improvement;
   - internal task;
   - technical maintenance;
   - incident;
   - idea;
   - decision;
   - question;
   - agent-discovered problem.
5. Keep severity and priority separate.
6. Preserve the reporter's original wording even when an agent creates a cleaner summary.
7. Make one system the official source for work status and decisions. Repositories may own code-specific execution links, but they must not maintain a competing product status.
8. Make premium design and usability an MVP requirement.
9. Use additive, versioned contracts so Plans 2 and 3 can arrive much later without invalidating MVP data.

## 3. Recommended product and repository boundary

Create a separate repository for the central product. A working name may be used until the product name is chosen.

Recommended initial structure:

```text
central-tracking-platform/
  apps/
    web/                 # React user interface
    api/                 # Express API and background coordination
  packages/
    reporting-sdk/       # Reusable connector used by projects and agents
    shared-contracts/    # Validated request, response, and event definitions
    design-system/       # Shared visual tokens and components
  docs/
    PRODUCT_NORTH_STAR.md
    DESIGN.md
    API.md
    SECURITY.md
    OPERATIONS.md
    DATA_MODEL.md
```

Recommended baseline technology, chosen to reduce learning and integration cost:

- React and Vite for the web application.
- Express for the API.
- MongoDB for persisted records.
- JavaScript initially, with runtime request validation at every API boundary.
- A package workspace so the API, web app, connector, and shared contracts use the same definitions.

Before implementation, record this choice in a short architecture decision. If the stack changes, preserve the product boundaries and contracts in this plan.

## 4. Standalone production promise

At MVP completion, the owner can use the product indefinitely to:

- capture every supported kind of work;
- organize work across many projects;
- find forgotten or blocked items;
- assign the next action to the owner or an agent;
- see the full progress and decision history;
- link supporting evidence;
- prove why an item was closed;
- reopen an item without losing the old resolution;
- connect QBO Escalations and future projects through the same API;
- recover from a failed deployment or data loss using documented backups.

An MVP that only stores tickets but does not support follow-through is not acceptable.

## 5. MVP feature inventory

This inventory matches the MVP level in the approved visual maturity map. Small supporting features may be added when required for safety, clarity, accessibility, or reliable operation.

### 5.1 Capture and intake

- Manual creation for every supported work type.
- Quick capture with a plain-language title and description.
- Project and product-area selection.
- Source link back to a chat, note, file, page, or code review.
- Screenshot, document, and evidence attachments.
- Customer-friendly ticket number plus permanent UUID.
- Required-field and size validation before submission.

### 5.2 Organization and discovery

- Shared cross-project inbox.
- Type, project, status, priority, owner, and tag filters.
- Full-text search over items, notes, and decisions.
- Saved views for open, blocked, waiting, and recently changed work.
- Relationships: duplicate, related, blocks, depends on, and fixed by.
- Per-project summary with counts by status.
- Archive without deleting history.

### 5.3 Workflow and accountability

- Simple normalized lifecycle from New through Active to Closed.
- Named human or agent owner.
- Separate severity and priority.
- Concrete next action on every active item.
- Follow-up or target date.
- Blocked status with a required reason.
- Comments and progress timeline.

### 5.4 Evidence and technical context

- Expected and observed behavior stored separately where relevant.
- Reproduction steps and environment notes.
- Screenshot and file evidence.
- Links to commits, tests, releases, documents, and conversations.
- Evidence actor and timestamp.
- Resolution summary.

### 5.5 Agent teamwork

- Project-scoped API access for agents.
- Agent identity recorded on every action.
- Agent-created records visibly labeled.
- Human confirmation before an agent-discovered claim becomes a confirmed bug.
- Agent progress notes.

### 5.6 Ideas, features, and decisions

- Idea backlog separate from committed work.
- Feature request with user goal and expected value.
- Decision record with outcome and explanation.
- Accepted, rejected, deferred, and duplicate dispositions.
- Links from decisions to resulting work.

### 5.7 Incidents and reliability work

- Incident type and impact level.
- Active incident state and named owner.
- Event timeline.
- Links to affected projects and related bugs.
- Resolution and follow-up tasks.

### 5.8 Validation and closure

- Resolution category and closing note.
- Required proof link or attachment for completed work.
- Reopen with a required reason.
- Closed date and closing actor.

### 5.9 Communication

- Internal comments and mentions.
- Basic notification for assignment and important status change.
- Reporter contact preference, even though public reporting is deferred.
- Public-safe summary separate from internal notes.

### 5.10 Insight

- Counts by project, type, status, priority, and owner.
- Open and recently completed summaries.
- Aging view showing how long work has remained open.
- Export to a common, documented file format.

### 5.11 Integration platform

- One central API with project identity.
- Project-scoped credentials.
- Create, read, update, comment, and attach operations.
- Links to repository work and releases.
- A small reusable JavaScript connector.

### 5.12 Security and operations

- Signed-in owner access.
- Project-level read and write permissions.
- Private-by-default internal records.
- Backup and restore.
- Action history for status, assignment, and content changes.

## 6. Core domain model

Use separate records for current state and append-only history. “Append-only” means old history is not silently rewritten; corrections create new events.

### 6.1 Workspace

Even though MVP has one owner, every record receives a stable `workspaceId`. This is a structural boundary for later enterprise separation, not a subscription feature.

Required fields:

- permanent ID;
- display name;
- default timezone;
- created and updated timestamps;
- status.

### 6.2 Project

- permanent ID and short project key;
- name and description;
- active or archived state;
- known product areas/modules;
- repository and deployment links;
- default privacy setting;
- ticket number sequence;
- integration status.

### 6.3 Actor

Represents either a human, an agent, or the system.

- permanent ID;
- actor type: human, agent, or system;
- display name;
- authentication subject or agent key reference;
- active/disabled state;
- allowed projects;
- created and updated timestamps.

Do not merge a human and an agent into one anonymous “user” field. Accountability requires the actor type and identity to remain explicit.

### 6.4 Work item

Required common fields:

- permanent UUID;
- friendly key such as `QBO-1842`;
- workspace and project IDs;
- work type;
- original report text;
- normalized title and description;
- current status and disposition;
- severity and priority;
- current owner;
- next action;
- follow-up/target date;
- reporter and source;
- public-safe summary;
- archive state;
- version number for safe concurrent editing;
- created, updated, closed, and reopened timestamps.

Type-specific details belong in validated subdocuments so a bug can store reproduction information while a decision can store rationale without forcing meaningless fields onto every record.

### 6.5 Work-item event

Record every meaningful change:

- event ID;
- work-item ID;
- event type;
- actor ID and actor type;
- before/after summary where appropriate;
- reason;
- correlation/request ID;
- source integration;
- timestamp;
- metadata allowed by the event definition.

### 6.6 Comment

- author;
- body;
- internal/public-safe visibility;
- mentions;
- edit history;
- timestamps.

### 6.7 Evidence/attachment

- attachment ID;
- work-item ID;
- original filename and safe display name;
- media type and byte size;
- storage reference rather than raw data in the main record;
- checksum for corruption detection;
- uploader;
- evidence description;
- created timestamp;
- deleted/redacted state and reason.

### 6.8 Relationship

- source and target work-item IDs;
- relationship type;
- actor who created it;
- reason/notes;
- timestamp.

Prevent circular `blocks` relationships and invalid cross-workspace links.

### 6.9 Project credential

- project ID;
- credential identifier;
- one-way hash of the secret;
- allowed actions;
- created/rotated/revoked timestamps;
- last-used timestamp;
- human-readable purpose.

Never store the plain secret after it is displayed once.

## 7. MVP workflow definitions

### 7.1 Normalized states

Use a small stable state model:

1. `new` — captured but not reviewed;
2. `needs_info` — cannot be decided without more evidence;
3. `accepted` — approved as work but not started;
4. `active` — next action is being performed;
5. `blocked` — cannot progress; reason is required;
6. `waiting` — waiting for a known person, agent, or external event;
7. `verification` — implementation/action is finished but outcome is not yet accepted;
8. `closed` — resolved, rejected, duplicate, deferred, answered, or archived with a disposition;
9. `reopened` — prior closure did not hold; reason is required.

The interface should use friendly labels and explain them. The stored values remain stable for API compatibility.

### 7.2 Required accountability rules

- `active`, `blocked`, `waiting`, and `verification` require an owner.
- `active` requires a next action.
- `blocked` requires a blocking reason.
- `waiting` requires what or whom the item is waiting on.
- `closed` requires a disposition and closing note.
- “Resolved” closures require proof; rejected/duplicate/deferred closures require a decision reason.
- Reopening requires a reason and produces a new event rather than deleting the prior closure.
- Agent-discovered problems start as unconfirmed reports, not confirmed bugs.

### 7.3 Concurrency rule

Use optimistic concurrency: the client sends the record version it edited, and the API rejects an update when another actor changed the record first. The UI then shows the conflicting change and lets the user retry safely.

## 8. Premium MVP UI/UX specification

Premium means calm, intentional, fast, accessible, and trustworthy—not decorative complexity.

### 8.1 Required design work before feature coding

1. Create `DESIGN.md` for the new product.
2. Define color, typography, spacing, density, borders, elevation, motion, icon, and data-visualization tokens.
3. Build a standalone clickable prototype of the main workflows.
4. Test the prototype at desktop, laptop, tablet, and narrow mobile widths.
5. Approve the information architecture before building production screens.

The existing maturity-map prototype informs scope communication, but it is not automatically the production interface.

### 8.2 Core surfaces

#### Today / attention home

- Work that needs the owner's attention now.
- Newly captured items awaiting review.
- Active and blocked work.
- Items due for follow-up.
- A short cross-project summary.

Avoid beginning with a generic analytics dashboard. The first screen should answer “What needs me now?”

#### Shared inbox

- Fast filters and saved views.
- Comfortable scanning at normal density.
- Clear type, project, priority, status, owner, and age.
- Keyboard navigation and bulk selection without hiding context.

#### Work-item detail

- Plain-language situation summary at the top.
- Current owner, next action, status, severity, and priority visible without scrolling.
- Tabs or sections for activity, evidence, relationships, decision, and resolution.
- Original report preserved and visually distinguished from agent normalization.
- Editing that prevents accidental loss.

#### Quick capture

- Open from anywhere with one button and keyboard shortcut.
- Minimal first step: title/description, type, project.
- Advanced details available without making the initial capture feel heavy.
- Draft remains available if the panel closes accidentally.

#### Project view

- Project identity and integration health.
- Open, blocked, aging, and recently resolved work.
- Links to the project repository and deployment.

### 8.3 Interaction quality requirements

- Loading, empty, error, offline, permission-denied, and stale-edit states are intentionally designed.
- Destructive actions require confirmation and explain the consequence.
- Every background save shows a trustworthy state: saving, saved, or failed.
- Motion supports orientation and respects reduced-motion settings.
- Complete keyboard operation and visible focus states.
- WCAG 2.2 AA accessibility target.
- No color-only meaning.
- Text remains usable at 200% zoom.
- Tables and filters remain usable on narrow screens.
- Dates show the user's timezone and reveal the exact timestamp when needed.
- Technical IDs are available but not allowed to dominate the interface.

### 8.4 Visual QA gate

Every production surface requires:

- approved reference screenshots;
- desktop and mobile browser review;
- light/dark theme review if both themes are included;
- keyboard walkthrough;
- empty, loading, populated, long-content, validation-error, and server-error states;
- screenshot comparison or another repeatable visual regression check for critical views.

## 9. API contract

Version the API from its first release: `/api/v1`.

### 9.1 Core endpoints

```text
POST   /api/v1/work-items
GET    /api/v1/work-items
GET    /api/v1/work-items/:id
PATCH  /api/v1/work-items/:id
POST   /api/v1/work-items/:id/comments
POST   /api/v1/work-items/:id/evidence
POST   /api/v1/work-items/:id/relationships
POST   /api/v1/work-items/:id/transitions
GET    /api/v1/work-items/:id/events

GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
POST   /api/v1/projects/:id/credentials
POST   /api/v1/projects/:id/credentials/:credentialId/rotate
POST   /api/v1/projects/:id/credentials/:credentialId/revoke

GET    /api/v1/views
POST   /api/v1/views
GET    /api/v1/insights/summary
GET    /api/v1/exports/work-items
GET    /api/v1/health
GET    /api/v1/health/readiness
```

### 9.2 Contract requirements

- Structured success and error envelopes.
- Request/correlation ID returned in response headers.
- Idempotency key on create operations so retries do not create duplicates.
- Explicit pagination, sorting, and filter definitions.
- Maximum attachment and text sizes.
- UTC timestamps in storage and API responses.
- Validation that rejects unknown unsafe fields.
- Safe rate limiting for project and agent credentials.
- OpenAPI or equivalent machine-readable documentation generated and checked in.
- Deprecation rules documented before any endpoint is published.

### 9.3 Reporting SDK

The first JavaScript connector must provide:

```text
createWorkItem()
getWorkItem()
updateWorkItem()
addComment()
attachEvidence()
linkWorkItems()
transitionWorkItem()
```

It must automatically send project identity, SDK version, request ID, and idempotency key. It must never collect diagnostics that the caller did not explicitly provide.

## 10. Authentication and permissions

### 10.1 Human access

- Use a standards-based sign-in provider or trusted OpenID Connect flow.
- Do not invent custom password storage unless there is a documented unavoidable reason.
- MVP may expose one owner/admin account, but authorization must still run on the server.

### 10.2 Agent and project access

- Separate credentials for each project and agent purpose.
- Credentials are scoped to named projects and operations.
- Disabled or rotated credentials stop working immediately.
- Agent identity is derived from the authenticated credential, not trusted from request JSON.
- Human-facing UI shows when an action came from an agent.

### 10.3 Permission checks

All reads and writes must verify workspace, project, actor, and action. Never fetch a record by ID and check scope only after returning it.

## 11. Evidence and attachment safety

- Store uploads outside the main database document.
- Generate safe filenames; never trust the uploaded path.
- Validate actual file content, not only the filename extension.
- Deny executable and unsupported formats.
- Enforce per-file and per-request limits.
- Scan or quarantine uploads before making them downloadable when deployment permits.
- Use signed, short-lived download links.
- Never expose local filesystem paths.
- Log attachment access and redaction.
- Back up attachment metadata and content consistently.

## 12. Observability and proof of operation

The MVP must be able to prove:

- which request created or changed an item;
- which human or agent acted;
- whether a notification was attempted and delivered;
- whether an attachment was stored successfully;
- whether a backup completed and a restore test succeeded;
- whether QBO or another project connector is healthy;
- whether a failed request changed data before failing.

Required operational surfaces:

- health and readiness endpoints;
- structured server logs with request IDs;
- client-visible error reference IDs;
- security-relevant audit events;
- failed-notification queue;
- integration health view;
- backup status visible to the owner;
- privacy-safe performance and error measures.

Do not treat terminal output as the only diagnostic surface.

## 13. Implementation phases

These are implementation phases, not additional product tiers. The MVP is not production-complete until every phase passes its exit gate.

### Phase 0 — Product contract and premium design

Deliver:

- new repository and package structure;
- product north star and scope boundary;
- architecture decision;
- domain vocabulary;
- `DESIGN.md` and production design tokens;
- clickable workflows for capture, inbox, detail, project, and attention home;
- accessibility and visual QA checklist;
- threat model and data classification;
- machine-readable API contract draft.

Exit gate:

- every MVP capability maps to a workflow or supporting requirement;
- major information architecture and design decisions are approved;
- no unresolved decision changes stored data, permissions, or user workflow.

### Phase 1 — Secure platform foundation

Deliver:

- API and web app skeletons;
- environment validation and fail-fast startup;
- database connection and migration mechanism;
- owner authentication;
- actor and project authorization;
- request IDs, error contract, rate limiting, health/readiness;
- structured audit event writer;
- test fixtures and isolated test database.

Exit gate:

- unauthorized cross-project access tests fail safely;
- startup fails clearly when required configuration is absent;
- audit records identify the real authenticated actor;
- no secret is exposed to the web client or logs.

### Phase 2 — Core work-item and event engine

Deliver:

- workspace, project, actor, work item, event, comment, relationship, and evidence models;
- ticket-number allocation without duplicates;
- CRUD operations with validation and concurrency protection;
- lifecycle transition service and accountability rules;
- archive, reopen, and disposition behavior;
- full audit timeline.

Exit gate:

- every state transition has automated positive and negative tests;
- concurrent edits cannot silently overwrite each other;
- event history remains complete after edits, closure, archive, and reopen;
- friendly IDs and permanent IDs remain stable.

### Phase 3 — Premium core interface

Deliver:

- attention home;
- shared inbox;
- quick capture;
- work-item detail and timeline;
- project view;
- filters, search, sorting, and saved views;
- responsive and accessible interaction states;
- reliable optimistic UI with safe failure recovery.

Exit gate:

- the owner can complete the full loop without database or terminal access;
- common workflows pass keyboard and narrow-screen review;
- long text, no data, slow response, stale update, and server failure remain understandable;
- approved screenshots match the production result.

### Phase 4 — Evidence, decisions, validation, and insight

Deliver:

- secure attachment handling;
- evidence metadata and external links;
- idea, feature, decision, and incident-specific sections;
- resolution proof and reopen flow;
- comments, mentions, and basic notifications;
- summary, aging, and export views.

Exit gate:

- completed work cannot bypass the required resolution record;
- sensitive/private notes never appear in public-safe fields or exports unintentionally;
- export can be re-imported or independently read from its documentation;
- notification failure does not lose the underlying work-item update.

### Phase 5 — Agent API, reporting SDK, and QBO integration

Deliver:

- project and agent credential administration;
- complete `/api/v1` contract;
- JavaScript reporting SDK;
- QBO connector for agent-created reports and links back to QBO evidence;
- visible agent attribution;
- idempotent retry behavior;
- integration health and credential rotation.

Exit gate:

- QBO can create and update permitted items without direct database access;
- a replayed request does not duplicate a work item;
- a revoked credential cannot read or write;
- an agent cannot confirm its own unverified bug claim as human-approved.

### Phase 6 — Reliability, backup, security, and launch hardening

Deliver:

- backup automation and documented restore procedure;
- successful restore rehearsal in an isolated environment;
- dependency and upload security checks;
- performance budgets and query indexes;
- error and integration diagnostic screens;
- seed/import path for current scattered work;
- operator guide and incident runbook;
- release checklist and rollback procedure.

Exit gate:

- fresh production-like deployment succeeds from documentation;
- restore rehearsal meets the documented data-loss expectation;
- no critical/high security finding remains open without explicit acceptance;
- performance budgets pass with realistic data volume;
- launch checklist, rollback, and support path are complete.

### Phase 7 — Controlled production adoption

Deliver:

- owner account and real project registry;
- QBO first integration enabled;
- reviewed import of selected chat/markdown/Notepad items;
- duplicate and obsolete candidates presented for human confirmation;
- monitoring of initial production behavior;
- post-adoption review and corrections.

Exit gate:

- the tracker is the declared source of truth for new actionable work;
- imported work has an explicit state and owner or is consciously archived;
- no required daily workflow depends on an undocumented manual database action;
- the owner confirms the system is understandable and reliable enough to keep using.

## 14. Data migration and current scattered material

The MVP needs an assisted, review-first import—not a blind bulk conversion.

Supported initial sources:

- copied AI chat excerpts;
- markdown files;
- plain text files;
- manually transcribed physical notes;
- existing repository issues or TODOs through a documented import format.

Import flow:

1. preserve the original source text and source location;
2. generate candidate work items;
3. suggest type, project, summary, and possible duplicates;
4. let the owner accept, merge, edit, reject, or archive candidates;
5. create real work items only after confirmation;
6. record the import actor, batch, and decision.

Do not make AI import a launch blocker if manual review/import can achieve the trusted result.

## 15. Testing strategy

### Unit tests

- validation and normalization;
- state transition rules;
- severity/priority separation;
- authorization decisions;
- friendly ID allocation;
- concurrency version checks;
- relationship constraints;
- export formatting;
- redaction and safe filename handling.

### API integration tests

- every endpoint success and failure contract;
- human, agent, revoked, and cross-project access;
- idempotent creation;
- attachment limits and unsupported formats;
- pagination and stable ordering;
- audit-event creation;
- database unavailable and partial-failure behavior.

### User-interface tests

- full create-to-close workflow;
- blocked, waiting, verification, reopen, and archive flows;
- filter/search/saved view behavior;
- drafts and failed save recovery;
- keyboard-only use;
- responsive layout;
- accessibility scan plus manual review;
- visual regression of critical screens.

### Operational tests

- backup and restore rehearsal;
- credential rotation and revocation;
- log and request-ID correlation;
- degraded notification behavior;
- realistic-data performance;
- deployment and rollback rehearsal.

## 16. MVP acceptance journeys

The product is not accepted until all journeys work end to end.

### Journey A — Agent finds a problem

1. A QBO agent submits an unconfirmed problem with evidence.
2. The system attributes it to the agent and QBO project.
3. The owner reviews and confirms or rejects the bug classification.
4. The accepted item receives an owner, next action, and follow-up date.
5. Progress, proof, and closure remain visible in one timeline.

### Journey B — Forgotten idea becomes a decision

1. The owner quick-captures an idea from a note.
2. The idea remains separate from committed work.
3. Supporting notes are added over time.
4. The owner accepts, rejects, or defers it with a reason.
5. Accepted work links back to the decision.

### Journey C — Work stalls

1. An accepted item is marked blocked.
2. The blocker and owner are visible.
3. The item appears in the attention view when follow-up is due.
4. The owner updates the next action or consciously defers/closes it.

### Journey D — Completion is challenged

1. An agent reports implementation complete.
2. The item enters verification rather than closing automatically.
3. Evidence is reviewed.
4. The owner closes it or reopens it with a reason.
5. Both the completion claim and final decision remain in history.

### Journey E — Service recovery

1. A deployment or database problem occurs.
2. The owner can find the error reference and health state.
3. The documented recovery or rollback procedure is followed.
4. Work-item history is restored without silent loss.

## 17. Definition of done

MVP is complete only when:

- all feature inventory items are implemented or explicitly replaced by an approved equivalent;
- all phase exit gates pass;
- production UI has completed visual and accessibility QA;
- security review has no unaccepted critical/high finding;
- backup and restore are proven, not merely documented;
- QBO works through the public API/SDK boundary;
- the owner and agents can complete the full accountability loop;
- operational diagnostics are visible without reading terminal output;
- API, data, security, design, deployment, and owner documentation are current;
- a production release and rollback rehearsal succeeds;
- the completed system can remain in use without Plan 2.

## 18. Explicit exclusions

- Customer-facing feedback widget and portal.
- Automatic context collection from customer browsers.
- Sophisticated duplicate detection.
- Type-specific workflow builders.
- Stalled-work automation beyond due/attention views.
- Multi-agent orchestration.
- Public status pages.
- Organization management, SSO/SCIM, compliance programs, data residency, and global high availability.
- Predictive analytics and enterprise portfolio planning.
- Subscription, billing, upgrade, downgrade, or entitlement logic.

These exclusions define the boundary; they do not make the included MVP workflows incomplete.

## 19. Future-compatibility contract for Plan 2

Plan 2 may be implemented weeks or years later. MVP must therefore leave these stable seams:

- permanent workspace, project, actor, work-item, evidence, and event IDs;
- versioned `/api/v1` contracts;
- type-specific extension areas with validation;
- private/public-safe content separation;
- authenticated reporter identity and source metadata;
- event history usable by future reminder and stall-detection services;
- attachment metadata capable of later consent/redaction fields;
- project connector package with version reporting;
- design tokens and components reusable by a future customer widget;
- schema migrations that can run repeatedly and resume safely.

Do not implement Plan 2 behavior early behind hidden production code. Preserve extension points, documentation, and tests instead.

## 20. Decisions to confirm immediately before implementation

These do not block writing the plan. They must be decided before their affected phase begins:

1. Final product and repository name.
2. Deployment target and file-storage service.
3. Human identity provider.
4. Notification channel for the owner.
5. Whether MVP ships light, dark, or both visual themes.
6. Maximum attachment size and allowed file types.
7. Backup frequency and acceptable data-loss window.
8. Which current notes/chats are included in the first reviewed import.

Default recommendation: choose the simplest hosted services that meet the security and restore requirements, record the choice, and keep vendor-specific code behind small adapters.
