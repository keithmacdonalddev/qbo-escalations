# Ontology-Driven Operational Intelligence Platform

**North-Star Vision Notes**
**Date:** 2026-05-04

## Purpose

This document preserves the larger product intention behind the word **ontology** so future planning, specs, coding-agent prompts, and architecture decisions do not collapse the idea into better tagging, semantic search, or MongoDB indexing.

The intended product is not a narrow QBO escalation helper. QBO escalation support may be an early domain branch or proving ground, but the larger ambition is an ontology-driven operational intelligence platform.

The platform should turn messy organizational data, communications, decisions, actions, outcomes, and institutional memory into a governed, explainable, evolving system for reasoning and execution.

## Core Product Statement

An ontology-driven operational intelligence platform uses ontology as the connective tissue between raw data, people, systems, workflows, knowledge, AI agents, and real-world decisions.

It should not merely store or search organizational data. It should model what the organization knows, how it knows it, what it is unsure about, what should happen next, and who has authority to act or validate.

In simpler terms:

> The system turns unstructured operational chaos into structured, evidence-backed, human-governed, machine-actionable intelligence.

## What Ontology Means in This Product

Ontology is not a tag library. It is not a list of categories. It is not just a search layer.

In this product, ontology means the platform’s **meaning and action layer**.

It defines and connects:

- real-world entities
- digital records
- people
- teamsa
- systems
- workflows
- claims
- observations
- evidence
- decisions
- hypotheses
- rules
- exceptions
- outcomes
- responsibilities
- permissions
- validation status
- confidence
- scope
- actions
- consequences

The ontology should help the platform answer:

- What data exists?
- What does this data mean?
- Why does it matter?
- What is connected to it?
- What evidence supports it?
- What is still uncertain?
- What action should happen next?
- Who is allowed to decide?
- What changed over time?
- What is trusted, disputed, outdated, or unverified?

This is the difference between a database and an operational intelligence platform.

## What This Is Not

This platform should not be reduced to:

- tags
- categories
- labels
- metadata
- text indexes
- embeddings
- semantic search
- RAG over documents
- MongoDB indexes
- case notes
- a knowledge base
- a chatbot

Those can be components, but they are not the platform.

### Weak Implementation

A weak implementation would say:

> We added ontology by adding tags, related terms, categories, and vector search.

That is not enough.

### Stronger Implementation

A stronger implementation would say:

> The system models concepts, relationships, claims, evidence, decisions, workflows, actions, validation, confidence, scope, and change over time.

## Why the Palantir Comparison Matters

The phrase “better than Palantir” may be exaggerated, but the intention is important.

It means the product ambition is not:

> Build a nicer support search tool.

The ambition is closer to:

> Build a platform where ontology is the operating model for data, decisions, and action.

The product should aspire toward capabilities usually associated with high-end operational data platforms:

- unified data layer
- ontology or semantic model
- operational apps
- workflow orchestration
- governed AI agents
- permissions and policy
- evidence and lineage
- human-in-the-loop validation
- real-world action execution
- feedback loops
- decision intelligence
- cross-domain extensibility

The product does not need to match an enterprise platform on day one, but the architecture should not prevent it from growing in that direction.

## Central Design Fear

The biggest risk is that future implementation will reduce the vision to a small technical substitute.

| Original Intent | Watered-Down Implementation |
|---|---|
| Ontology | Tags and categories |
| Knowledge graph | MongoDB references |
| Semantic reasoning | Vector search |
| Evidence tracking | Source URL field |
| Validation workflow | Approved boolean |
| Scope classification | Enum with no evidence |
| Agent-assisted knowledge evolution | One AI summary field |
| Operational intelligence | Chatbot response |
| Platform | QBO escalation page |

This must be prevented through clear architecture language and explicit behavioural requirements.

## Core Platform Philosophy

Everything important should become a modeled object with relationships, evidence, lifecycle, ownership, and possible action.

Not everything must be trusted. Not everything must be promoted. But the system should be able to represent uncertainty instead of flattening it.

The platform should distinguish:

- raw data
- reported claim
- agent assumption
- system observation
- tested hypothesis
- confirmed fact
- contradicted claim
- resolved issue
- generalized pattern
- official knowledge
- deprecated guidance

Without these distinctions, AI and search systems turn messy data into confident misinformation.

## Foundational Object Types

The platform should eventually model objects such as:

- Source
- Document
- Message
- Conversation
- Case
- User
- Customer
- Organization
- Team
- System
- Record
- Entity
- Concept
- Relationship
- Claim
- Observation
- Evidence
- Hypothesis
- Test
- Decision
- Resolution
- Pattern
- Rule
- Exception
- Workflow
- Action
- Task
- Approval
- Validation
- Scope
- Confidence
- Policy
- Permission
- Knowledge Article
- Automation
- Agent
- Outcome
- Feedback
- Version
- Event

These are not all MVP tables. They are platform-level primitives that define the kind of system being built.

## Core Ontology and Domain Ontologies

The platform should not have one giant hardcoded ontology.

It should have:

- a core ontology
- domain ontology modules
- organization-specific extensions
- user or team working knowledge

## Core Ontology

The core ontology should model concepts that apply across many branches:

- Person
- Team
- Organization
- System
- Source
- Message
- Case
- Claim
- Evidence
- Hypothesis
- Test
- Decision
- Action
- Workflow
- Resolution
- Pattern
- Validation Status
- Confidence
- Scope
- Policy
- Permission
- Knowledge
- Outcome

## Domain Ontology Modules

Different product branches add specialized concepts.

Examples:

- QBO Support Ontology
- Payroll Ontology
- Sales Tax Ontology
- Payments Ontology
- Inventory Ontology
- Engineering Defect Ontology
- Customer Operations Ontology
- Knowledge Management Ontology
- Training and QA Ontology
- Compliance Ontology
- Software Project Ontology
- Personal Knowledge Ontology

Each branch can grow independently while still connecting back to the core ontology.

## QBO as a Vertical Branch

QBO escalation support is a valuable first vertical because it is messy, high-context, domain-heavy, and full of uncertainty.

It includes:

- customer communications
- agent troubleshooting
- supervisor review
- screenshots
- incorrect answers
- partial clues
- solved cases
- known issues
- product limitations
- region-specific rules
- tax, payroll, and reporting interpretation
- workflow confusion
- escalation decisioning
- duplicate INV searches
- documentation gaps

This makes it an excellent proving ground.

But the platform should not be architected as if QBO is the entire product.

Correct framing:

> QBO support is an early domain module inside a broader ontology-driven operational intelligence platform.

## What Intelligence Means Here

Intelligence does not mean a chatbot that gives answers.

It means the system can reason over:

- meaning
- relationships
- evidence
- uncertainty
- scope
- history
- contradictions
- authority
- workflow
- action
- outcome

A useful system should be able to answer:

- What is this about?
- What does it connect to?
- What has happened before?
- What is confirmed?
- What is only suspected?
- What was ruled out?
- What changed the outcome?
- What is the safest next action?
- Who needs to approve this?
- Is this local, regional, account-specific, or global?
- Does this deserve documentation?
- Is this ready for automation?
- What should the AI not assume?

## Evidence as a First-Class Object

Evidence should not be an afterthought.

Every important claim, relationship, pattern, or recommendation should trace back to evidence.

Evidence can come from:

- raw chat text
- case notes
- screenshots
- logs
- system data
- emails
- documents
- test results
- user confirmations
- product documentation
- SME review
- engineering confirmation
- repeated solved cases
- operational outcomes

The platform should understand the difference between:

- someone said it
- someone tested it
- a system showed it
- a pattern repeated
- an SME confirmed it
- engineering confirmed it
- official documentation states it

This is the basis for trust.

## Claims, Facts, and Uncertainty

The system should store claims separately from facts.

A claim is something asserted. A fact is a claim that has enough evidence and validation for a given use.

Example claim object:

```json
{
  "claim": "This issue is caused by French UI localization",
  "claim_type": "hypothesis",
  "source": "agent note",
  "evidence_status": "partial",
  "validation_status": "unreviewed",
  "allowed_use": "investigation_hint",
  "not_allowed_use": "customer-facing explanation"
}
```

This lets the system use uncertain information safely without pretending it is proven.

## Uncertainty States

The system should model:

- unknown
- unverified
- reported
- suspected
- partially confirmed
- confirmed
- contradicted
- deprecated
- outdated
- scope-limited

Many valuable insights begin as weak signals. The platform should preserve weak signals as weak signals.

## Validation as a Workflow

Avoid reducing validation to this:

```json
{
  "isApproved": true
}
```

Prefer this:

```json
{
  "validation_status": "T2-reviewed",
  "validated_by": "reviewer_id",
  "validated_for_use": [
    "internal_troubleshooting",
    "duplicate_search",
    "agent_coaching"
  ],
  "not_validated_for_use": [
    "customer-facing explanation",
    "product defect claim",
    "official documentation"
  ],
  "evidence_summary": "",
  "review_notes": "",
  "last_reviewed": ""
}
```

Validation should specify what the knowledge is allowed to be used for.

## Knowledge Use Levels

The same information can be useful in one context and unsafe in another.

Recommended use levels:

1. Do not use
2. Use only for search
3. Use as investigation hint
4. Use as internal support pattern
5. Use as validated internal guidance
6. Use as official product behaviour
7. Use as known issue or defect
8. Use as customer-facing documentation

This prevents overclaiming.

## Knowledge Promotion Ladder

Knowledge should move through stages:

1. Raw data
2. Extracted claim
3. Observed clue
4. Candidate pattern
5. Reviewed pattern
6. Validated guidance
7. Product-confirmed truth
8. Official documentation
9. Retired, deprecated, or replaced

Each promotion should require evidence and review appropriate to the risk.

## Agent Roles

Agents should help build and maintain the platform, but they should not be treated as final authorities.

Possible agents:

- Ingestion Agent
- Extraction Agent
- Entity Resolution Agent
- Ontology Mapping Agent
- Relationship Proposal Agent
- Contradiction Detection Agent
- Pattern Detection Agent
- Scope Classification Agent
- Confidence Scoring Agent
- Documentation Candidate Agent
- Knowledge Deprecation Agent
- Workflow Recommendation Agent
- Automation Safety Agent
- Reviewer Assistant Agent

Agents propose. Humans validate. The platform records both.

## Human Roles

Even if the system is agent-assisted, humans still own truth and risk.

Human roles may include:

- Domain Owner
- Knowledge Owner
- Reviewer
- SME
- Product Owner
- Engineering Triage
- Documentation Owner
- Policy Owner
- Admin
- Operator
- End User

In a small early project, one person may wear many hats. The platform should still model the roles separately because it may evolve.

## Typed Relationships

Do not store vague “related concepts” only.

Relationships should be typed.

Examples:

- is_a
- part_of
- appears_on
- affects
- causes
- may_cause
- verified_by
- contradicted_by
- requires
- blocks
- resolves
- workaround_for
- owned_by
- approved_by
- applies_to
- does_not_apply_to
- supersedes
- depends_on
- triggers
- escalates_to

Typed relationships allow reasoning. A list of related terms does not.

## Scope as a First-Class Dimension

Scope should be modeled for patterns, claims, rules, and recommendations.

Possible scopes:

- individual user
- browser session
- device
- role or permission
- single record
- single case
- company file
- tenant
- subscription level
- language
- region
- country
- product area
- product-wide
- system-wide
- unknown

A claim without scope is dangerous.

Bad scope statement:

> This is a defect.

Better scope statement:

> Observed in two QBO Canada companies using French UI in the GST/HST filing workflow; not yet reproduced in English UI or clean test company.

## Time, Versioning, and Lineage

The ontology must evolve over time.

Concepts and relationships need:

- created_at
- updated_at
- effective_from
- effective_to
- version
- status
- deprecated_by
- replaced_by
- review_due
- source_version
- product_version

This matters because product behaviour, workflows, laws, policies, and support processes change.

The system should preserve historical context. A case from 2024 may have been correct at the time but wrong in 2026.

## Explainability

Every recommendation should be explainable.

A good recommendation should show:

- recommended action
- reason
- supporting evidence
- related concepts
- similar patterns
- confidence
- scope
- validation status
- contradictions
- what is still unknown

The system should not simply answer. It should show why the answer is allowed to be used.

## Operational Actions

The platform should eventually support actions, not just knowledge.

Actions might include:

- create task
- route case
- draft response
- flag risk
- recommend escalation
- open review item
- create KB candidate
- notify owner
- start workflow
- request missing evidence
- run diagnostic checklist
- compare cases
- mark pattern deprecated
- trigger automation with approval

Ontology connects knowledge to action.

## Governance and Permissions

A serious platform must control who can do what.

Examples:

- Who can create concepts?
- Who can approve concepts?
- Who can promote a pattern?
- Who can mark something official?
- Who can deprecate knowledge?
- Who can run an automated action?
- Who can see sensitive data?
- Who can override an agent recommendation?

Ontology should connect to authorization and governance.

## Feedback and Learning Loops

Every use of knowledge should produce feedback.

Examples:

- Was the recommendation helpful?
- Was it wrong?
- Did it resolve the issue?
- Was it escalated anyway?
- Was the scope wrong?
- Did new evidence contradict the pattern?
- Did the user correct the AI?
- Did a reviewer downgrade or promote it?

This feedback should update confidence and review queues.

## Platform Memory vs Chatbot Memory

This is not the same as a chatbot remembering things.

Platform memory should be:

- structured
- auditable
- source-linked
- versioned
- permissioned
- reviewable
- deprecable
- explainable
- actionable

The system should not merely remember. It should know what kind of memory it is and how it is allowed to be used.

## Technical Direction

A future technical implementation may include:

- document store
- graph layer
- vector index
- relational constraints
- event log
- workflow engine
- policy engine
- agent orchestration
- review queue
- audit log
- permission layer

MongoDB can store parts of this, but MongoDB indexes are not the ontology.

Vector search can retrieve similar material, but vector search is not the ontology.

A graph can represent relationships, but a graph alone is not enough without evidence, validation, scope, and action.

## Anti-Requirements

The system should not:

- treat all retrieved text as truth
- turn every phrase into a concept
- promote AI guesses without review
- collapse uncertainty into confidence
- hide source evidence
- erase contradiction
- merge unlike issues because wording is similar
- assume local issues are global
- assume repeated issues are defects
- assume resolved cases are universal rules
- become QBO-only by accident
- become just a chatbot
- become just search
- become just a knowledge base

## Behavioural Requirements

Any implementation claiming to support this vision should demonstrate at least some of these behaviours:

1. Ingest unstructured data.
2. Extract claims, evidence, actions, outcomes, and unresolved questions.
3. Map raw language to canonical concepts.
4. Track typed relationships between concepts.
5. Separate claims from confirmed facts.
6. Track hypothesis status.
7. Track scope and confidence.
8. Link recommendations back to evidence.
9. Detect similar patterns across differently worded cases.
10. Detect contradictions.
11. Suggest, but not automatically approve, ontology updates.
12. Maintain candidate knowledge separately from trusted knowledge.
13. Support human review and promotion.
14. Version concepts and relationships.
15. Deprecate outdated knowledge.
16. Recommend next best actions.
17. Explain why a recommendation is safe or unsafe to use.
18. Support multiple domain modules.

If a build does not do these things, it may still be useful, but it should not be described as the intended ontology system.

## How to Prompt Coding Agents

Do not ask:

> Add ontology to the app.

Ask:

> Build the first vertical slice of an ontology-driven operational intelligence layer.

Then define the non-negotiables:

- This is not tags, categories, or indexing.
- The system must model canonical concepts.
- The system must model aliases.
- The system must model typed relationships.
- The system must model claims.
- The system must model evidence.
- The system must model hypotheses.
- The system must model scope.
- The system must model confidence.
- The system must model validation status.
- The system must model source lineage.
- The system must support human review.
- The system must separate candidate knowledge from trusted knowledge.
- Search and embeddings may be used for retrieval, but they are not the ontology.

## Better Feature Names

Avoid naming the core feature only “ontology.”

Better names:

- Operational Intelligence Layer
- Ontology-Driven Intelligence Layer
- Semantic Operations Platform
- Knowledge and Action Graph
- Evidence-Backed Decision Graph
- Case Intelligence Layer
- Organizational Reasoning Layer
- Trusted Knowledge Layer
- Concept and Evidence Graph

For the early support branch:

- Support Intelligence Module
- Escalation Intelligence Module
- QBO Canada Support Intelligence Module

## Success Definition

A successful platform is not one that simply returns better search results.

A successful platform can:

- ingest messy reality
- preserve uncertainty
- detect meaning
- connect evidence
- identify patterns
- separate useful hints from validated truth
- recommend safe actions
- learn from outcomes
- support human validation
- evolve across domains

The system should eventually help answer:

- What do we know?
- How do we know it?
- Who confirmed it?
- Where does it apply?
- Where does it not apply?
- What is still uncertain?
- What should happen next?
- What has changed?
- What knowledge is outdated?
- What should become official?
- What should be automated?
- What should never be automated?

## Final Summary

The original intent behind “ontology” is high-level and platform-level.

It should not be watered down into:

- better MongoDB indexing
- semantic search
- tagging
- categories
- RAG
- QBO-only escalation support

The intended system is:

> An ontology-driven operational intelligence platform where raw data, communications, evidence, concepts, workflows, decisions, AI agents, and human validation are connected into an evolving model of organizational knowledge and action.

QBO escalation support can be the first proving ground, but the platform should be architected so that new branches can be added without rewriting the foundation.

The essential principle:

> Search retrieves information. Ontology gives information meaning. Operational intelligence turns meaning into governed action.
