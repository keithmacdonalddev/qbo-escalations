# QBO Knowledgebase Implementation Plan

Last updated: 2026-06-03

## Purpose

This is the implementation plan for turning the current QBO playbook and
knowledge-candidate workflow into a web-deployable internal QBO knowledgebase.

The goal is not to build "search over documents" and call it finished. The
goal is to build a trusted knowledge layer that can explain:

- what the app knows
- where that knowledge came from
- whether it is only a draft, reviewed, trusted, rejected, deprecated, or unsafe
- what evidence supports it
- who or what proposed it
- who reviewed it
- what agents are allowed to use it for
- when it changed
- when it should stop being used

This plan is intentionally grounded in the current app. The existing
`KnowledgeCandidate` flow is the seed. The implementation should evolve that
flow instead of creating a disconnected second knowledge system.

## Implementation Status

### 2026-06-02

Phase 0 is complete.

- The durable plan exists in this file.
- The implementation boundary is defined.
- The API contract is defined.
- The first backend implementation slice is defined.

Phase 1 is complete.

- Added `server/src/services/knowledgebase-service.js`.
- Added `server/src/routes/knowledge.js`.
- Mounted `/api/knowledge` in `server/src/app.js`.
- Added `server/test/knowledge-routes.test.js`.
- The API can list normalized records, return summary counts, search records,
  and provide agent-safe context.
- Focused tests prove draft and unsafe records are not returned as trusted final
  agent guidance.

Phase 2 is complete for the first backend integration slice.

- `server/src/lib/chat-context-builder.js` now calls the knowledgebase service
  for `agent-response` context in `hybrid` and `retrieval-only` modes.
- `full-playbook` remains the legacy full markdown behavior.
- If knowledgebase lookup fails, the chat context builder falls back to legacy
  markdown playbook retrieval.
- Context debug metadata now includes knowledgebase source, fallback state,
  record IDs, trust states, review states, reusable outcomes, allowed uses, and
  warnings.
- Prompt instructions now distinguish trusted database knowledge from
  legacy-trusted playbook knowledge and explicitly warn against treating
  candidate/rejected/restricted/unsafe knowledge as final guidance.
- `server/src/services/chat-request-service.js` now awaits the async context
  builder.
- The room QBO Assistant context path in
  `server/src/services/room-agents/chat-agent-def.js` now awaits the same async
  context builder.
- `server/src/services/triage.js` now requests knowledgebase context with
  `allowedUse=triage`, injects trusted/legacy-trusted records into the triage
  system prompt, and records knowledgebase trace metadata in `triageMeta`.
- Added `server/test/chat-context-builder-knowledge.test.js`.
- Added `server/test/triage-knowledge-context.test.js`.

### 2026-06-03

Phase 3 is complete for the first backend monitor/proposer slice.

- Added a built-in `knowledgebase-agent` profile in
  `server/src/services/room-agents/agent-profiles.js`.
- Added `server/src/services/knowledgebase-agent-service.js`.
- Added `/api/knowledge/agent/status`.
- Added `/api/knowledge/agent/scan`.
- The scan route can run as a dry run or persist review work.
- The scan detects:
  - finalized cases with no knowledge draft
  - draft/rejected candidates with quality issues
  - potential duplicate candidates
  - trusted published guidance that may be stale
- Every proposal includes source evidence and a recommended reviewer action.
- Persisted scan results create `knowledge-review` attention items so existing
  review surfaces can show the work.
- The agent records scan activity through the agent identity system when the
  scan is not a dry run.
- The shared knowledge review attention logic now flags missing root cause,
  low confidence, and weak source evidence in addition to missing summary,
  symptom, fix, or escalation path.
- Added `server/test/knowledgebase-agent.test.js`.

Phase 3 does not include autonomous background scheduling, a dedicated
knowledgebase UI page, automatic approval, automatic publishing, auth,
deployment permission hardening, or ontology relationship modeling. Those
remain later phases.

Phase 4 is started for the first dedicated UI slice.

- Added `#/knowledge` routing in `client/src/lib/appRoute.js`.
- Added a sidebar navigation entry for the Knowledgebase page.
- Added `client/src/api/knowledgeApi.js`.
- Added `client/src/components/KnowledgebaseView.jsx`.
- Added `client/src/components/KnowledgebaseView.css`.
- The page can load KB summary metrics, list/search normalized records, filter
  by review status, trust state, allowed use, and legacy inclusion, and open
  source escalations.
- The page shows Knowledgebase Agent readiness/counts and can run dry-run or
  persisted scans through `/api/knowledge/agent/scan`.
- Persisted scans link back to the existing attention center when review items
  are opened.

Phase 4 is not complete yet. The remaining UI work includes deeper record
detail editing, reviewer workflow polish, pagination, dedicated deprecated /
rejected views, and full evidence-history presentation.

## Product Direction

The QBO knowledgebase should become the trusted memory of the QBO escalation
workflow.

It should help the user answer:

- Have we seen this issue before?
- Is this a known canonical fix, an edge case, a temporary incident, or only a
  one-off case?
- What evidence supports this guidance?
- Is this guidance safe for a triage agent to use in a response?
- Is this only useful for pattern detection?
- Did an AI agent propose it or did the user approve it?
- Has this guidance become stale or contradicted by newer cases?
- What needs my review right now?

The knowledgebase is not just a new page. It is a governed backend layer that
the UI and agents both use.

## Current Code Starting Point

The repo already has several useful pieces:

- `server/src/models/KnowledgeCandidate.js`
  - Stores one draft/reviewed/published candidate per escalation.
  - Includes `reviewStatus`, `publishTarget`, `reusableOutcome`, `confidence`,
    `sourceSnapshot`, and publish metadata.

- `server/src/routes/escalations.js`
  - Has routes to generate, update, approve, publish, and unpublish knowledge
    drafts under `/api/escalations/:id/knowledge`.
  - Has `/api/escalations/knowledge-candidates`.
  - Has `/api/escalations/knowledge-gaps`.

- `server/src/lib/knowledge-promotion.js`
  - Publishes approved knowledge candidates into markdown playbook files.
  - Snapshots old playbook versions before edits.

- `server/src/lib/playbook-loader.js`
  - Loads markdown playbook files.
  - Builds the full system prompt.
  - Builds lexical retrieval chunks.

- `server/src/lib/chat-context-builder.js`
  - Injects playbook retrieval chunks into chat context.
  - Currently treats playbook retrieval as file-backed context, not as a
    governed knowledge API.

- `server/src/lib/escalation-attention.js`
  - Creates attention items for knowledge review.
  - Keeps the workflow visible to the user instead of silently changing state.

- `client/src/components/EscalationKnowledgePanel.jsx`
  - Lets the user generate, review, edit, approve, publish, or unpublish a
    knowledge candidate from an escalation detail page.

These are enough to begin. The first implementation should formalize them into
a dedicated knowledgebase surface and API contract.

## Non-Negotiable Principles

### 1. Agents Propose, Humans Validate

The knowledgebase agent can propose knowledge. It can flag contradictions. It
can recommend reuse status. It can explain why something should be reviewed.

It must not silently promote draft knowledge into trusted guidance.

### 2. Candidate Knowledge Is Not Trusted Knowledge

Drafts, AI summaries, single-case learnings, and weak patterns must not be
treated as official facts.

The app must preserve the difference between:

- draft candidate
- approved but not published
- published/trusted
- rejected
- deprecated
- contradicted
- unsafe to reuse

### 3. Every Important Knowledge Item Needs Evidence

Evidence can be:

- source escalation
- source conversation
- parsed screenshot
- parser metadata
- resolution note
- published playbook entry
- INV record
- user review note
- repeated pattern across cases

The implementation should not flatten this into one `source` string.

### 4. The Database Becomes The Web-Safe Source Of Truth

Markdown files are useful for local development and exports. They are not a
complete web-deployment source of truth.

The final deployed shape should read trusted knowledge from the database/API.
Markdown playbook files may remain as:

- seed data
- export format
- local fallback
- version snapshots
- human-readable review artifacts

### 5. Agent Context Must Be Gated

Agents should not receive every piece of knowledge by default.

Each knowledge item should declare or derive allowed uses:

- `agent-response`
- `triage`
- `similarity-search`
- `pattern-detection`
- `playbook-export`
- `review-only`
- `deprecated-warning`

If a knowledge item is not allowed for a use, the service must not hand it to
that agent path as trusted context.

### 6. The UI Must Show Work Needing Attention

The app should keep using the attention-center shape. Knowledge review should
surface as a queue, not as invisible backend state.

## Vocabulary

### Knowledge Candidate

A proposed reusable lesson from an escalation, conversation, INV, playbook
change, or repeated case pattern.

Current model: `KnowledgeCandidate`.

### Knowledge Record

The normalized API shape exposed by the knowledgebase service. It can wrap a
candidate, a published playbook entry, or eventually a richer article.

### Trusted Knowledge

Knowledge that has passed enough review for a specific use. Trusted does not
mean universally true. It means allowed for the stated scope.

### Legacy Playbook Knowledge

Existing markdown playbook content loaded from `playbook/`. It is useful, but
it does not yet have complete evidence, lifecycle, and review metadata.

### Evidence

The source material or event that supports a claim or recommendation.

### Allowed Use

The practical permission boundary for a knowledge item. For example, an item
may be allowed for similarity search but not allowed in a final agent answer.

## Target Architecture

```text
QBO workflow events
  -> escalation records
  -> conversations
  -> parser history
  -> INV records
  -> resolved cases
  -> knowledge candidates
  -> review queue
  -> trusted knowledge records
  -> agent-gated retrieval
  -> response citations / source summaries
```

The knowledgebase should sit between raw workflow data and agent responses.

Agents should call a knowledge service, not scrape markdown files or read every
case directly.

## Backend Architecture

### Phase 1 Backend Shape

Add a dedicated backend service:

```text
server/src/services/knowledgebase-service.js
```

Responsibilities:

- normalize `KnowledgeCandidate` documents into a stable `KnowledgeRecord`
  shape
- classify candidate trust state
- derive allowed uses
- expose stats/counts
- search database-backed knowledge candidates
- optionally include legacy playbook chunks
- build a compact agent-context payload that excludes unsafe or unreviewed
  records from trusted agent use

Add a dedicated route:

```text
server/src/routes/knowledge.js
```

Initial route surface:

```text
GET /api/knowledge/summary
GET /api/knowledge/records
GET /api/knowledge/search
GET /api/knowledge/agent-context
```

Mount it in:

```text
server/src/app.js
```

### Future Backend Shape

Later phases can add new first-class models:

```text
KnowledgeArticle
KnowledgeEvidence
KnowledgeReviewEvent
KnowledgeRelationship
KnowledgeDeprecation
KnowledgeAgentProposal
```

Do not add all of those in the first slice unless the current implementation
requires them. The current `KnowledgeCandidate` model is enough to start.

## Knowledge Record API Contract

Every normalized knowledge record should include:

```json
{
  "id": "candidate:<mongo id>",
  "sourceType": "knowledge-candidate",
  "recordType": "case-learning",
  "title": "",
  "category": "",
  "summary": "",
  "symptom": "",
  "rootCause": "",
  "exactFix": "",
  "keySignals": [],
  "confidence": 0.85,
  "trustState": "trusted",
  "reviewStatus": "published",
  "reusableOutcome": "canonical",
  "publishTarget": "category",
  "allowedUses": ["agent-response", "triage", "similarity-search"],
  "evidence": [],
  "lineage": {},
  "warnings": [],
  "updatedAt": ""
}
```

### Trust State Mapping

Initial mapping:

| Source state | Trust state | Meaning |
| --- | --- | --- |
| `published` | `trusted` | Can be used by agents for approved scopes. |
| `approved` | `reviewed` | Human-approved, but not necessarily publishable yet. |
| `draft` | `candidate` | Needs review before agent use. |
| `rejected` | `rejected` | Do not use as guidance. |
| `published` plus unsafe outcome | `restricted` | Visible as warning or pattern only. |
| legacy playbook markdown | `legacy-trusted` | Useful existing guidance, but evidence is incomplete. |

### Reusable Outcome Mapping

Initial mapping:

| Reusable outcome | Agent usage |
| --- | --- |
| `canonical` | Allowed for agent response, triage, similarity, and playbook export once trusted. |
| `edge-case` | Allowed for agent response with scope language once trusted. |
| `case-history-only` | Similarity and pattern detection only. |
| `customer-specific` | Similarity only, with customer-specific warning. |
| `temporary-incident` | Pattern detection and warning only unless linked to an active INV/incident. |
| `unsafe-to-reuse` | Review-only, never final response guidance. |

## Knowledgebase Agent

### Role

The knowledgebase agent is the curator and monitor for QBO knowledge. It should
not be the owner of truth.

### First Responsibilities

- watch for resolved or escalated cases that have no knowledge draft
- propose candidate drafts from finalized cases
- flag candidates with missing root cause, missing fix, low confidence, or weak
  source evidence
- recommend reusable outcome
- identify potential duplicates between candidates
- identify stale trusted knowledge
- create attention items for user review

### Later Responsibilities

- propose relationships between knowledge records
- detect contradictions
- suggest deprecation
- compare current agent answers against trusted KB guidance
- summarize KB coverage gaps by QBO category
- prepare weekly KB review briefings

### Hard Boundary

The knowledgebase agent may not:

- mark a draft as trusted
- publish into the official KB without a human approval event
- hide source evidence
- rewrite history
- silently remove deprecated guidance

## Agent Consumption Plan

### Triage Agent

The triage agent should eventually call:

```text
/api/knowledge/agent-context?query=<case text>&allowedUse=triage
```

It should receive:

- trusted canonical fixes
- trusted edge cases with scope warnings
- legacy playbook excerpts marked as legacy
- no draft candidates as trusted facts
- no rejected or unsafe-to-reuse items as guidance

### Main Chat Agent

The main chat agent should eventually use the same knowledge service instead of
only `searchPlaybookChunks`.

The response should be able to say, in plain text or debug metadata:

- which knowledge records were used
- whether each was trusted, legacy, or scoped
- whether evidence was incomplete

### Copilot / Analytics Agents

These agents may use a wider surface:

- candidates
- case-history-only records
- rejected records with notes
- deprecated records

But the usage should be labeled as analysis, not final QBO guidance.

## UI Plan

### Phase 1 UI

Keep current escalation detail knowledge panel.

Add or improve:

- knowledge queue filters
- visible trust state
- evidence summary
- allowed use badges
- warnings for case-history-only, temporary, or unsafe outcomes

### Phase 2 UI

Add a dedicated Knowledgebase page:

```text
#/knowledge
```

Primary views:

- Review Queue
- Trusted Knowledge
- Candidate Knowledge
- Deprecated / Rejected
- Coverage Gaps
- Source Evidence

### Phase 3 UI

Add knowledge record detail page:

```text
#/knowledge/:id
```

Detail sections:

- answer-ready summary
- symptoms
- root cause
- exact fix
- scope and warnings
- evidence
- linked cases
- review history
- agent proposals
- related records
- deprecation status

## Data Model Evolution

### Current Model Extension

Keep `KnowledgeCandidate` as the phase 1 storage model.

Short-term possible additions:

- `evidenceRefs`
- `allowedUses`
- `trustStateOverride`
- `reviewedBy`
- `reviewedAt`
- `deprecatedAt`
- `deprecatedReason`
- `supersededBy`
- `agentProposals`
- `reviewHistory`

Do not add these until there is a route or UI that needs them.

### Future Models

Use first-class models when the data stops fitting naturally into one candidate
document.

Likely future split:

- `KnowledgeArticle`: durable trusted article.
- `KnowledgeEvidence`: source references and support strength.
- `KnowledgeReviewEvent`: audit trail of review/publish/deprecate decisions.
- `KnowledgeRelationship`: links such as duplicate, contradicts, supersedes,
  narrows, expands, related issue, same root cause.
- `KnowledgeAgentProposal`: proposals from the knowledgebase agent that need
  review.

## Deployment Plan

The deployed app must not depend on local file writes for core KB behavior.

### Local Dev

In local development:

- markdown playbook remains useful
- existing publish-to-markdown flow can continue
- `/api/knowledge` should expose both DB candidates and legacy playbook chunks

### Web Deployment

In web deployment:

- database-backed records are the source of truth
- file writes should be optional or disabled
- publish should mean "promote in database"
- export to markdown should be a separate action
- auth should protect review/publish/deprecate operations

## Security And Privacy

The KB may contain customer/company identifiers, case numbers, screenshots, and
conversation text.

Required controls before real web deployment:

- role-based permissions
- audit log for create/update/approve/publish/deprecate
- source redaction options
- no screenshots exposed to unauthorized users
- no raw customer data in public logs
- agent context should receive only what it needs

## Testing Plan

### Unit Tests

Test:

- trust state mapping
- allowed use mapping
- evidence normalization
- record normalization
- candidate search filter construction
- agent context exclusion rules

### Route Tests

Test:

- `/api/knowledge/summary` returns counts
- `/api/knowledge/records` returns normalized records
- `/api/knowledge/search` finds candidate records
- `/api/knowledge/agent-context` includes trusted records
- `/api/knowledge/agent-context` excludes drafts and unsafe records from trusted
  agent usage

### Integration Tests

Later:

- resolved escalation -> knowledge candidate -> approval -> trusted agent
  context
- rejected draft -> attention item stays open until notes exist
- published candidate -> appears in agent context
- case-history-only candidate -> available for similarity, not final triage

## Implementation Phases

### Phase 0: Plan And Contract

Status: this document.

Deliverables:

- durable plan in `TODOS/`
- implementation boundary
- API contract
- first implementation slice defined

### Phase 1: Backend Knowledge API

Goal:

Create the first database-backed knowledgebase API without replacing existing
escalation knowledge routes.

Deliverables:

- `server/src/services/knowledgebase-service.js`
- `server/src/routes/knowledge.js`
- app route mount at `/api/knowledge`
- focused tests

Success criteria:

- existing escalation knowledge flow still works
- new API can list normalized records
- new API can provide agent-safe context
- unsafe or unreviewed items are not returned as trusted agent guidance

### Phase 2: Agent Integration

Goal:

Let agents use the KB through a controlled service instead of direct playbook
file retrieval.

Deliverables:

- chat context builder can optionally use `/api/knowledge` service internally
- triage path can request `allowedUse=triage`
- context debug shows record IDs and trust states
- prompt instructions distinguish trusted, legacy, and candidate context

Success criteria:

- agents do not treat draft candidates as facts
- responses can be traced back to knowledge records
- fallback to legacy playbook retrieval remains available

### Phase 3: Knowledgebase Agent

Goal:

Create the knowledgebase agent as a monitor and proposer.

Deliverables:

- agent identity/profile entry
- background or on-demand scan route
- candidate quality checks
- duplicate candidate detection
- stale trusted knowledge detection
- attention items for review

Success criteria:

- the agent creates review work, not final truth
- every proposal has source evidence
- the UI shows what needs user attention

### Phase 4: Dedicated Knowledge UI

Goal:

Add a first-class knowledgebase page.

Deliverables:

- `#/knowledge`
- review queue
- trusted list
- candidate list
- deprecated/rejected list
- coverage summary
- record details

Success criteria:

- user can manage KB without opening individual escalation records
- trust state and evidence are visible
- review workflow is ergonomic

### Phase 5: Web Deployment Hardening

Goal:

Make the KB safe for deployed use.

Deliverables:

- role-based permissions
- audit trail
- database-first publish flow
- markdown export instead of required file write
- redaction controls
- backup/export path

Success criteria:

- deploy does not require local filesystem playbook writes
- every high-impact action is auditable
- agents use only authorized KB context

### Phase 6: Ontology / Operational Intelligence Expansion

Goal:

Grow from a QBO KB into the first ontology-backed operational intelligence
slice.

Deliverables:

- modeled relationships
- evidence strength
- contradiction detection
- scope modeling
- action recommendations
- outcome feedback loops

Success criteria:

- the system can explain not only "what answer" but "why this answer, for this
  case, under this scope, based on this evidence"

## First Implementation Slice

This turn should begin Phase 1.

Initial code changes:

1. Add `knowledgebase-service.js`.
2. Add `knowledge.js` route.
3. Mount `/api/knowledge`.
4. Add tests proving:
   - trusted published candidates appear in `agent-context`
   - draft candidates do not appear as trusted guidance
   - unsafe candidates are excluded from final agent response context
   - summary counts are returned

This is intentionally backend-first. It gives future UI and agent work a stable
contract before changing the visible app.

## Open Questions

- Should approved but unpublished records be usable by agents if the publish
  target is `case-history-only`?
- Should legacy playbook markdown be treated as trusted until migrated, or as
  legacy guidance with incomplete evidence?
- Should published markdown remain the default local artifact, or become an
  explicit export action?
- Who is the first real reviewer identity in local mode: `user`, `keith`, or
  an auth-backed user later?
- Should the knowledgebase agent run only on demand at first, or also during
  attention queue refresh?

## Current Recommendation

Start conservative:

- database/API first
- no autonomous promotion
- no route that exposes drafts as trusted agent guidance
- keep markdown playbook compatibility
- use the existing attention queue for review work
- integrate with triage and chat only after the KB service has tests
