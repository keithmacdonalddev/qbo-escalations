# Ticket Snitch — Solid User-Ready Implementation Plan

- **Plan level:** 2 of 3
- **Official product name:** Ticket Snitch
- **Working tagline:** Tell Ticket Snitch. We’ll put ’em away for good.
- **Status:** Future implementation plan; no implementation has started
- **Product state at completion:** A polished customer- and agent-ready product that completes the accountability loop
- **Required predecessor:** The MVP plan must be fully implemented, tested, deployed, and accepted
- **Required successor:** None for continued operation; the enterprise plan may be implemented later
- **Timing:** Deliberately unspecified; begin with a fresh technical and product re-baseline

## Quick read

Extend the proven MVP into a solid user-ready application for the owner, trusted agents, connected projects, and customers who need an effortless way to report a problem, request a feature, or share feedback.

This level does more than accept reports. It actively prevents accepted work from stalling, coordinates specialist agents under human approval, captures useful context with privacy controls, communicates progress, validates outcomes, and provides a clear cross-project operating picture.

The completed user-ready product must stand on its own in production indefinitely. Enterprise features are not required for it to be safe, premium, or complete for its intended users.

## 1. Entry conditions

Do not start Plan 2 because a date arrived. Start only after every condition is true:

- MVP is the trusted source of truth for actionable work.
- MVP production acceptance journeys pass against the current release.
- Backup and restore have been proven recently.
- The current data model and API are documented.
- QBO and any other connected projects report their actual SDK/API versions.
- Open MVP defects and operational risks are reviewed.
- The owner confirms that Plan 2 still solves the most important next problems.

Because Plan 2 may begin years later, the first phase must verify current vendors, browser rules, accessibility standards, security threats, dependencies, and deployment constraints. This document defines outcomes and contracts; stale implementation details must be revalidated.

## 2. Role in the broader platform

### User goal

Let customers, the owner, and agents report important signals easily, then ensure accepted work continues to a clear, validated result without relying on memory or repeated manual chasing.

### Product workflow

```text
Easy report
  → context and consent
  → review and classification
  → duplicate/relationship check
  → decision and ownership
  → coordinated progress
  → stall intervention
  → release and validation
  → customer communication and reusable learning
```

### Agent-team responsibility

Specialist agents help with intake, evidence, duplication, triage, product reasoning, coordination, and validation. Agents make labeled proposals. Human approval remains mandatory for important priority, truth, privacy, and closure decisions.

### Evidence, memory, and validation

The user-ready product connects customer experience, technical context, agent recommendations, human decisions, implementation evidence, release information, and customer confirmation in one traceable history.

### What this deliberately does not solve

- It does not implement enterprise multi-organization administration or contractual service guarantees.
- It does not implement global data residency or formal compliance programs.
- It does not implement billing, subscriptions, upgrades, downgrades, or entitlements.
- It does not give agents unrestricted authority.
- It does not replace code repositories, deployment systems, or project-specific testing.

## 3. Product boundary and inheritance rules

Plan 2 includes every completed MVP capability. It adds behavior through versioned migrations and new services; it does not replace MVP identifiers or rewrite history.

Required inheritance rules:

1. Every MVP work item remains readable and editable.
2. Existing project credentials remain valid until deliberately rotated or revoked.
3. Existing API clients continue working throughout the migration window.
4. New required fields receive safe defaults or reviewed backfills.
5. Customer-visible content is opt-in and never inferred from private notes.
6. Existing simple workflows remain supported even when richer type-specific workflows are added.
7. Rollback does not corrupt records written by the new version.
8. The MVP export format remains supported or receives a documented converter.

## 4. Standalone production promise

At completion, the product can be used indefinitely to:

- embed an easy reporting experience in each connected customer-facing project;
- securely prefill useful report context;
- keep customers informed without exposing internal reasoning;
- detect duplicates, aging, blockers, and stalled responsibility;
- coordinate specialist agents with approval boundaries;
- manage distinct workflows for bugs, features, incidents, ideas, decisions, and maintenance;
- verify releases and user outcomes separately from code completion;
- import scattered work through a reviewed process;
- understand cross-project health and bottlenecks;
- operate reliably without enterprise-only identity and compliance systems.

## 5. User-ready feature inventory

This section lists additions beyond MVP. All MVP features remain included.

### 5.1 Capture and intake additions

- Customer Feedback widget with three clear choices:
  - Report a problem;
  - Request a feature;
  - Share feedback.
- Automatic project, page, release, time, and device context.
- Signed-in reporter identity derived securely from the project session.
- Permission-based diagnostic bundle with a customer preview.
- Browser, operating system, device, language, and screen context.
- Email, chat, markdown, and agent-discovery intake channels.
- Draft recovery for interrupted reports.
- Project-specific questions without separate reporting systems.

### 5.2 Organization and discovery additions

- Custom views for projects and agent responsibilities.
- Cross-project duplicate suggestions with human confirmation.
- Parent initiatives and smaller linked work items.
- Reusable global labels plus project-specific extensions.
- Personal attention queue.
- Natural-language search and plain-English summaries.
- Grouped customer reports under one confirmed problem.
- Safe bulk triage with a preview and audit record.

### 5.3 Workflow and accountability additions

- Type-specific workflow rules.
- Automatic follow-up reminders.
- Stalled-work detection based on meaningful progress rather than activity count.
- Waiting-on-owner and waiting-on-agent queues.
- Handoffs that require acknowledgment.
- Configurable response and resolution targets.
- Escalation rules for important stalled or reopened work.
- Daily and weekly review briefings.

### 5.4 Evidence and technical context additions

- Request, session, trace, workflow-run, and release identifiers.
- Permitted recent errors and user actions.
- Secret removal and sensitive-field masking.
- Evidence labels: observed fact, assumption, hypothesis, and recommendation.
- Immutable decision and status history.
- Evidence-preserving incident capsule.
- Evidence completeness check before closure.
- Original-problem versus validated-result comparison.

### 5.5 Agent teamwork additions

- Specialist intake, evidence, duplicate, triage, product, validation, and coordinator agents.
- Agent proposals separated from approved decisions.
- Risk-based approval for important changes.
- Explicit action permissions for each agent.
- Trusted agents may perform named low-risk operations.
- Structured handoffs containing context, evidence, questions, and next action.
- Agent performance measured by accepted results rather than activity volume.
- Coordinator detection of blocked, abandoned, and decision-ready work.

### 5.6 Ideas, features, and decisions additions

- Alternatives and tradeoffs preserved with decisions.
- Reconsideration dates.
- Grouped customer demand without vote-driven automatic priority.
- Feature discovery evidence and success measure.
- Promotion from idea to explored concept to accepted feature.
- Release notes connected to original requests.
- Reporter notification when decisions or outcomes change.

### 5.7 Incident additions

- Dedicated incident command view.
- Stakeholder and customer updates.
- Service-health connection and affected-version detection.
- Evidence-preserving incident capsule.
- Plain-language “can prove / cannot prove” explanation.
- Blameless review of contributing factors.
- Follow-up work tracked until independently verified.
- Recurring-incident and shared-cause detection.

### 5.8 Validation additions

- Definition of success recorded before implementation.
- Completion claims checked against named proof.
- Separate code-complete, released, and user-validated states.
- Reporter confirmation or a recorded reason it could not be obtained.
- Independent validation for high-risk changes.
- Reopen when monitored symptoms return.
- Outcome review and reusable learning.
- Candidate knowledge record from validated reusable lessons.

### 5.9 Communication additions

- Customer ticket page with status and replies.
- Immediate acknowledgment and friendly ticket number.
- Plain-language progress updates.
- Watchers and subscriber controls.
- Reusable, editable message templates.
- Status-page connection for incidents.
- Customer satisfaction and outcome feedback.
- Accessible, responsive reporting.

### 5.10 Insight additions

- Cross-project health and stalled-work view.
- Incoming, completed, reopened, and overdue trends.
- Repeated-symptom and emerging-pattern detection.
- Time to first response and verified resolution.
- Workload and bottleneck view.
- Feature demand linked to customer goals.
- Decision backlog and unresolved-risk view.
- Weekly agent-prepared operational briefing.

### 5.11 Integration additions

- Maintained web, desktop, and server connectors.
- Webhook/event notifications.
- Repository, chat, email, monitoring, and deployment integrations.
- Offline/safe retry queue.
- Versioned API compatibility rules.
- Integration health and delivery-failure alerts.
- Reviewed import assistant for chats, markdown, text, and existing trackers.

### 5.12 Security and operations additions

- Human and agent roles with explicit permissions.
- Sensitive attachment controls and redaction.
- Strong session and credential controls.
- Retention settings for ordinary and sensitive evidence.
- Administrative audit view.
- Automated backup with tested restoration.
- Abuse protection for public reporting.
- Health checks and client-visible integration diagnostics.

## 6. Customer reporting experience

### 6.1 Design principle

The customer explains the experience; the product supplies the technical context. Do not force customers to decide whether something is a bug.

### 6.2 Entry point

Use one consistent “Feedback” entry point in connected applications. It opens three plain choices. The entry point must be easy to find but not interfere with the customer’s task.

### 6.3 Visible fields

Problem report:

- What were you trying to do?
- What happened?
- What did you expect? This may be suggested rather than mandatory.
- Optional screenshot/recording.
- Permission to attach technical details.
- Whether a reply is wanted.

Feature request:

- What would you like to be able to do?
- Why would it help?
- Optional example or attachment.

General feedback:

- What would you like us to know?
- Optional attachment.

### 6.4 Server-generated identity

After accepted submission, the central API creates:

- permanent report UUID;
- friendly project ticket number;
- exact accepted timestamp;
- request ID;
- receipt state.

The widget displays a clear success receipt and explains how the customer can follow the report.

### 6.5 Automatically provided context

Context that may be sent without requiring customer typing:

- project ID and name;
- product area/module;
- page URL and title;
- route/screen and optional previous route;
- application, deployment, and release versions;
- environment;
- date, time, and timezone;
- locale and language;
- browser, operating system, device type, viewport;
- safe feature-flag identifiers;
- customer account/organization identifier when applicable;
- authenticated reporting user UUID, display name, and role;
- current case/ticket/workflow identifier;
- request, session, trace, or agent-run identifiers;
- connector/SDK version.

Identity and privileged context must be signed or resolved server-to-server. Do not trust a customer-editable browser field for user UUID, role, project, or account scope.

### 6.6 Consent-required diagnostics

Require explicit permission and preview when collecting:

- recent actions;
- network or server errors;
- screenshots or recordings;
- current form values;
- copied text;
- logs;
- prompt/agent context;
- anything that may contain customer, financial, authentication, or personal information.

The customer can remove individual attachments or diagnostic categories before submission.

### 6.7 Widget operating requirements

- Loads asynchronously and cannot break the host project.
- Uses a versioned, integrity-checked package.
- Inherits approved brand tokens while retaining consistent behavior.
- Supports keyboard, screen reader, zoom, reduced motion, touch, and mobile.
- Recovers drafts after accidental close or temporary network loss.
- Queues a submission safely if offline and clearly shows its unsent state.
- Prevents repeat submission when a retry occurs.
- Reports its own health without collecting customer content.
- Can be disabled remotely per project during an incident.

## 7. Expanded domain model

Add migrations; do not replace MVP records.

### 7.1 Reporter and customer visibility

Add:

- reporter contact/notification preference;
- public ticket access policy;
- public-safe status and messages;
- reporter confirmation state;
- customer satisfaction/outcome response;
- anonymized/deleted reporter handling without deleting work history.

### 7.2 Context bundle

Use a versioned context-bundle record with:

- origin project and SDK version;
- authenticated identity claims;
- page/application context;
- diagnostic categories;
- consent receipt;
- redaction results;
- storage/retention classification;
- collection timestamp.

Keep the raw bundle separate from the main work item so access and retention can be stricter.

### 7.3 Workflow definition

Add versioned workflow definitions per work type:

- allowed states and transitions;
- required fields and approvals;
- response/verification targets;
- escalation behavior;
- public status mapping;
- workflow version attached to each item.

Existing items retain their prior workflow version unless migrated through an explicit, auditable action.

### 7.4 Handoff and accountability contract

Add:

- current responsibility state;
- proposed recipient;
- acknowledgment state and deadline;
- next action;
- due/review date;
- stall reason: blocked, abandoned, waiting, or unclear;
- recovery action and acknowledgment;
- intervention history.

### 7.5 Agent proposal and approval

Separate:

- proposal content;
- proposing agent/model/run;
- evidence references;
- risk class;
- required approver;
- approval/rejection/edited acceptance;
- execution result.

Never overwrite the original proposal when a human edits it.

### 7.6 Notification and delivery records

Persist:

- intended audience and channel;
- public-safe rendered content;
- template/version;
- send attempt state;
- provider response reference;
- retry/dead-letter state;
- delivery/open response only where privacy rules permit.

Notification failure must not roll back the work-item change.

## 8. Premium user-ready UI/UX

### 8.1 Design re-baseline

Before production work:

1. Review actual MVP usage, friction, abandoned flows, and accessibility findings.
2. Update `DESIGN.md`; do not create a disconnected second design system.
3. Prototype customer intake, public ticket, incident command, agent proposals, and stall recovery.
4. User-test plain-language labels with people who do not know issue-tracker terminology.
5. Establish cross-product widget rules and brand adaptation limits.

### 8.2 Internal command center

The home screen prioritizes:

- items requiring an owner decision;
- newly grouped customer reports;
- breached or approaching response targets;
- stalled handoffs;
- verification awaiting evidence;
- active incidents;
- agent proposals awaiting approval.

Use progressive disclosure: show the decision and next action first, with technical evidence available one level deeper.

### 8.3 Customer ticket page

Show:

- friendly ticket number;
- customer-safe title and description;
- acknowledgment and current public status;
- latest plain-language update;
- reply/attachment controls;
- privacy and diagnostic controls;
- resolution/release information when available;
- confirmation question after claimed resolution.

Never expose internal priority debates, private evidence, agent chain-of-thought, secrets, or internal incident notes.

### 8.4 Agent proposal review

Show:

- what the agent recommends;
- why it recommends it;
- evidence references;
- confidence and unresolved questions;
- exact changes that approval would make;
- risk and permission boundary;
- approve, edit-and-approve, reject, or ask-for-more-evidence actions.

### 8.5 Premium quality gate

- Every customer surface is branded, responsive, and accessible.
- Every asynchronous action has visible progress, success, failure, and retry behavior.
- Customer language is tested for clarity.
- Internal high-density views preserve scanability without shrinking text below accessible sizes.
- Status, severity, ownership, and public/internal visibility are never conveyed by color alone.
- Critical workflows receive repeatable visual regression coverage.

## 9. Agent team design

### 9.1 Intake agent

- preserves original wording;
- proposes a concise summary and type;
- identifies missing information;
- never invents reproduction steps.

### 9.2 Evidence agent

- organizes permitted technical context;
- labels facts, assumptions, and hypotheses;
- flags sensitive or incomplete evidence.

### 9.3 Duplicate/relationship agent

- proposes similar reports and shared underlying problems;
- explains the evidence for the match;
- never merges or closes automatically.

### 9.4 Triage agent

- proposes severity, likely affected area, and next investigation;
- keeps priority as a human decision unless a narrow approved rule applies.

### 9.5 Product agent

- connects requests to customer goals and cross-project value;
- shows tradeoffs and prior decisions;
- does not convert popularity directly into priority.

### 9.6 Validation agent

- compares success criteria with tests, release evidence, and reporter response;
- proposes closure or reopen;
- cannot approve its own implementation on high-risk work.

### 9.7 Coordinator agent

- monitors ownership, next action, review dates, stalled state, and approvals;
- opens recovery interventions;
- prepares daily/weekly briefings;
- does not reassign high-impact work without permission.

## 10. Agent permissions and safety

Define actions by risk:

- **Read-only:** search, summarize, compare, and prepare briefings.
- **Low risk:** add labeled notes, propose relationships, create unconfirmed reports.
- **Moderate risk:** change low-impact fields or advance approved workflow steps.
- **High risk:** change priority, publish customer messages, close incidents, alter permissions, delete/redact evidence.

Requirements:

- explicit allowed actions per agent;
- project and data-sensitivity scope;
- approval rule;
- time-bounded authority where appropriate;
- allowed/blocked/waiting audit record for every attempted action;
- immediate disable control;
- simulation/dry run for bulk actions;
- no permission inferred from prompt wording alone.

## 11. Integration architecture

### 11.1 Versioned connectors

Create maintained packages for:

- browser applications;
- server applications;
- desktop applications where needed;
- agent tools;
- repository and deployment events.

Each connector reports its version and supported capability set.

### 11.2 Webhooks

Webhooks must include:

- signed payloads;
- event ID and schema version;
- delivery timestamp;
- retry with bounded backoff;
- idempotent receiver guidance;
- secret rotation;
- dead-letter visibility;
- replay controls with audit history.

### 11.3 External systems

Integrations must declare whether the central tracker or external system owns each field. Avoid two-way synchronization without conflict rules.

For repository work, the central tracker owns the user/problem decision and verified outcome. The repository owns commits, pull requests, and code-review status. Links and events connect them.

## 12. Privacy, security, and abuse prevention

- Public reporting endpoints use project-bound tokens that cannot read private data.
- Apply per-project and per-origin rate limits.
- Use bot and abuse controls proportionate to actual traffic.
- Quarantine untrusted attachments.
- Remove known secrets before storage and show uncertain findings for review.
- Separate raw diagnostic access from ordinary work-item access.
- Record consent version and diagnostic categories.
- Support deletion/anonymization of reporter identity without destroying necessary operational history.
- Prevent public ticket enumeration.
- Use short-lived signed public links or authenticated customer access.
- Review customer-facing error messages for information leakage.
- Test cross-project and customer-to-internal authorization boundaries.

## 13. Stall recovery contract

Stall detection must look for absence of meaningful progress, not simply absence of comments.

Signals:

- next-action date passed;
- owner never acknowledged a handoff;
- blocked reason has no recovery action;
- repeated status changes without evidence/progress;
- item remains active while all linked implementation work is inactive;
- verification waits beyond its target;
- agent repeatedly requests the same unavailable information.

Recovery workflow:

1. coordinator labels the suspected cause;
2. owner/agent receives a concise explanation and suggested recovery;
3. responsible actor acknowledges, edits, reassigns, defers, or closes;
4. system records the intervention and result;
5. repeated interventions escalate to the owner.

The system must not shame users or agents with activity scores. The purpose is to restore a clear decision and next action.

## 14. Implementation phases

These are internal phases. The user-ready release is not complete until all exit gates pass.

### Phase 0 — Re-baseline the live MVP

Deliver:

- current architecture/data/API/design audit;
- production usage and friction review;
- security and dependency refresh;
- migration rehearsal using a production-like data copy;
- updated capability map and decisions;
- compatibility and rollback strategy.

Exit gate:

- every assumption is confirmed or updated;
- no unresolved migration risk can corrupt MVP data;
- MVP remains deployable during Plan 2 development.

### Phase 1 — Customer identity, visibility, and reporting widget foundation

Deliver:

- reporter/public visibility model;
- context bundle and consent receipt;
- public submission API;
- signed host-project identity exchange;
- initial web widget package;
- public ticket receipt and secure access.

Exit gate:

- spoofed user/project identity is rejected;
- widget failure cannot break host applications;
- no diagnostic category is included without consent;
- customer never sees private fields.

### Phase 2 — Premium reporting and customer ticket experience

Deliver:

- complete Problem/Feature/Feedback flows;
- automatic safe context;
- preview/remove diagnostics;
- screenshot/attachment experience;
- offline draft and safe retry;
- customer ticket page and replies;
- acknowledgment and public updates;
- accessible responsive design.

Exit gate:

- representative customers can submit without issue-tracker knowledge;
- narrow/mobile/keyboard/screen-reader journeys pass;
- duplicate retry does not create duplicate reports;
- long, private, and failed-upload states remain understandable.

### Phase 3 — Workflow, handoff, reminders, and stall recovery

Deliver:

- versioned type-specific workflows;
- targets and reminders;
- handoff acknowledgment;
- waiting queues;
- stall detection and recovery interventions;
- recurring review briefings;
- escalation rules.

Exit gate:

- test clocks prove reminder and stall behavior deterministically;
- notification failures are visible and retry safely;
- workflow migration preserves existing state/history;
- no agent can bypass approval on high-risk transitions.

### Phase 4 — Evidence, incidents, and validation

Deliver:

- versioned/redacted context bundles;
- evidence classification;
- incident command and capsule;
- completion verifier;
- independent validation;
- customer confirmation and monitored reopen;
- knowledge-candidate handoff.

Exit gate:

- can/cannot-prove views match stored evidence;
- closure cannot bypass required validation;
- sensitive data access and retention are enforced;
- reusable knowledge remains a candidate until governed review.

### Phase 5 — Specialist agent team and approvals

Deliver:

- agent proposal/approval model;
- specialist agents;
- explicit action permissions;
- coordinator briefings and intervention;
- agent outcome/performance evidence;
- agent disable and incident controls.

Exit gate:

- agents cannot grant themselves authority;
- proposal, approval, execution, and outcome are separately visible;
- adversarial and mistaken-agent tests fail safely;
- disabling an agent stops new actions immediately.

### Phase 6 — Integrations, imports, and communication

Deliver:

- maintained connector packages;
- webhook platform;
- repository/deployment/monitoring connections;
- email/chat intake;
- reviewed import assistant;
- templates, watchers, status-page link, and feedback.

Exit gate:

- ownership conflicts between systems are documented and enforced;
- webhook replay is idempotent;
- imported candidates require review;
- public messages use only approved public-safe data.

### Phase 7 — Cross-project insight and product hardening

Deliver:

- trends, aging, bottlenecks, and health;
- duplicate/pattern suggestions;
- feature-demand and decision-risk views;
- weekly operational briefing;
- realistic-volume performance work;
- updated backup, restore, runbooks, and rollback.

Exit gate:

- metrics reconcile with underlying work items;
- suggestions disclose uncertainty;
- dashboards lead to concrete drill-down evidence;
- backup/restore and rollback are proven against the new records.

### Phase 8 — Controlled rollout to connected projects

Deliver:

- internal dogfood in QBO;
- limited customer-reporting pilot;
- privacy/support review;
- progressive enablement across projects;
- connector version tracking;
- post-launch review and repair.

Exit gate:

- no critical intake, privacy, authorization, or delivery failure remains;
- customer reports reach a human-reviewable queue reliably;
- owner can operate the product without enterprise features;
- MVP clients remain compatible or have completed a reviewed migration.

## 15. Migration strategy

### 15.1 Before migration

- create restorable backup;
- record schema and API versions;
- run migration on a production-like copy;
- compare counts, IDs, history, relationships, and attachments;
- test rollback and forward resume.

### 15.2 During migration

- use additive fields and new collections first;
- dual-read only when necessary and time-bounded;
- avoid long blocking database operations;
- record migration batch and status;
- make migrations idempotent and resumable.

### 15.3 After migration

- verify every MVP work item remains accessible;
- reconcile counts and audit events;
- sample old attachments and exports;
- monitor error and latency changes;
- remove compatibility code only after a documented support window.

## 16. Testing strategy

### Customer experience

- anonymous/known/authenticated reporter variants;
- identity spoof attempts;
- consent on/off and selective removal;
- offline and interrupted submission;
- duplicate retry;
- public ticket access and enumeration resistance;
- screen reader, keyboard, touch, zoom, and mobile;
- host app remains healthy when widget fails.

### Workflow and timing

- every type-specific transition;
- reminder and target clocks;
- handoff acknowledgment and expiry;
- stall classification and recovery;
- reopened and recurring symptoms;
- safe workflow-version migration.

### Agent safety

- read/low/moderate/high-risk permissions;
- approval, rejection, edited approval;
- agent attempts to alter its own permission;
- mistaken duplicate and triage proposals;
- prompt injection through customer text/attachments;
- immediate disable behavior;
- independent validation separation.

### Privacy and security

- secret and personal-data redaction;
- attachment quarantine;
- public/internal field leakage;
- cross-project access;
- context-bundle retention/deletion;
- webhook signature/replay;
- rate-limit and abuse behavior.

### Operational resilience

- delivery retries and dead letters;
- integration outage and recovery;
- connector version mismatch;
- backup and restore;
- deployment rollback;
- realistic customer-report volume;
- slow dependency and partial failure.

## 17. User-ready acceptance journeys

### Journey A — Customer problem report

1. Customer opens Feedback and chooses Report a problem.
2. The form asks only understandable questions.
3. Project, page, version, time, and authenticated identity are supplied securely.
4. Customer previews/removes diagnostics and submits.
5. Customer receives a ticket number and safe status page.
6. Internal triage and customer updates stay connected.
7. Release and customer confirmation are recorded separately.

### Journey B — Cross-project duplicate

1. Similar reports arrive from two projects.
2. Agent proposes a shared cause and shows evidence.
3. Owner confirms relationships without erasing project-specific reports.
4. Shared work links to separate validation for each affected project.

### Journey C — Stalled handoff

1. Agent proposes work and hands it to another agent.
2. Recipient fails to acknowledge.
3. Coordinator identifies the stall and proposes recovery.
4. Owner reassigns, defers, or confirms the next action.
5. Intervention and result remain auditable.

### Journey D — Incident

1. Monitoring or a user report opens an incident.
2. Incident command shows impact, timeline, owner, and updates.
3. Evidence capsule preserves what can/cannot be proven.
4. Customers receive safe updates.
5. Resolution follow-ups remain active until independently verified.

### Journey E — Agent suggests closure

1. Implementation agent reports completion.
2. Validation agent compares proof with success criteria.
3. Owner approves release state.
4. Customer is asked to confirm.
5. Closure or reopen preserves the full chain.

## 18. Definition of done

Plan 2 is complete only when:

- every user-ready feature is implemented or replaced by an approved equivalent;
- all MVP records, history, attachments, and clients survive migration;
- public customer reporting is simple, accessible, private, and reliable;
- responsibility, reminders, handoffs, and stalls work end to end;
- agent permissions and approvals are enforced in code;
- public and private content boundaries pass security review;
- incident and completion evidence can be independently reviewed;
- operational dashboards reconcile with source records;
- backup, restore, deployment, and rollback are proven;
- documentation covers host integration, API, privacy, agents, support, and operations;
- the product can remain in production without Plan 3.

## 19. Explicit exclusions

- Separate customer organizations with enterprise-grade isolation.
- Corporate SSO, automated user provisioning, and delegated enterprise administration.
- Formal compliance certifications and legal discovery workflows.
- Regional data residency and global failover commitments.
- Enterprise workflow marketplace.
- Predictive portfolio investment and causal modeling.
- Contractual service-level guarantees.
- Subscription, billing, upgrades, downgrades, or entitlements.

## 20. Future-compatibility contract for Plan 3

Preserve these seams:

- `workspaceId` on every scoped record and event;
- authorization service separate from UI decisions;
- versioned workflows and policy evaluation;
- immutable actor, proposal, approval, and audit identity;
- region/storage classification fields without implementing residency routing;
- connector capability/version reporting;
- exportable audit and evidence formats;
- background jobs designed for idempotent distributed execution;
- storage adapters for evidence, notifications, and integrations;
- metrics derived from durable events rather than UI-only counters;
- public/customer identity separable from future organization identity.

Do not implement pretend enterprise toggles. Leave clean, tested boundaries that a future Plan 3 can extend.

## 21. Decisions to confirm immediately before implementation

1. Which connected project pilots customer reporting first.
2. Customer access method for ticket pages.
3. Exact diagnostic categories allowed by each project.
4. Initial response and resolution targets.
5. Which low-risk agent actions may execute without per-action approval.
6. Notification channels and status-page provider.
7. Supported browsers and connector platforms.
8. Data retention periods for diagnostic bundles and customer attachments.

These choices must be based on the live MVP and current legal/security context at implementation time.
