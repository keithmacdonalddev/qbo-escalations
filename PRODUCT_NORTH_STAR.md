# Product North Star

This document is the product hierarchy for the repo. Narrow docs can stay narrow, but they should not redefine the product around their own feature area.

## One-Sentence Direction

Build an operational intelligence platform where expert AI agents help the user handle complex work and life situations using shared evidence, memory, workflows, decisions, actions, and human validation.

## Current First Domain

QBO escalation support is the first domain module and proving ground.

It is important, but it is not the whole product. The QBO module exists because it has the right kind of complexity: messy messages, screenshots, uncertain facts, known issues, troubleshooting steps, follow-ups, outcomes, and reusable lessons.

For the current case-to-knowledge contract, use `ESCALATION_KNOWLEDGE_LIFECYCLE.md`. That document defines how a QBO case moves from chat intake to resolved outcome to human-reviewed knowledge that agents may use.

## Product Hierarchy

1. End goal: operational intelligence platform for the user's work and life.
2. Current domain module: QBO escalation support.
3. User-facing goal in the current module: help the user solve difficult QBO escalations faster and with more confidence.
4. Agent-team goal: coordinate specialist agents around the same evidence, memory, and workflow state.
5. Intelligence layer: claims, evidence, sources, cases, hypotheses, actions, outcomes, confidence, scope, permissions, and validation.
6. Implementation components: chat, escalation records, sessions, knowledge, provider harnesses, prompt editor, observability, and agent profiles.

Implementation components are not product destinations. They exist to support the user and the coordinated agent team.

## Component Roles

| Component | Platform role | What it is not |
| --- | --- | --- |
| QBO Escalation workflow | First domain workflow for handling one difficult support situation from intake to outcome. | The whole product. |
| Escalation record | Shared working object for the current QBO case. | The user's reason for using the app. |
| Chat and Sessions | Conversation surface and continuity for agent work. | A general chatbot product. |
| Knowledge / KB | Shared governed memory for expert agents and reviewers. | A destination users should have to manage for its own sake. |
| Provider harnesses | Evidence and provenance capture for model/provider responses. | A standalone research product. |
| Prompt editor | Source of truth for individual agent instructions and contracts. | A generic text editor. |
| Agent profiles | Mission control for specialist agents, ownership, tools, review state, and handoffs. | A gallery of prompts. |
| Observability | Proof layer for what happened, which agent/provider acted, and what changed. | Developer-only logs. |
| Ontology | Meaning and action layer connecting data, people, agents, evidence, workflow, decisions, and permissions. | Tags, categories, embeddings, or search by themselves. |
| Workspace assistant | Another agent/domain surface that should plug into the same platform model. | A separate app. |

## Design Rules

When explaining, designing, or implementing a feature, keep this order:

1. User goal.
2. Product workflow.
3. Agent-team responsibility.
4. Evidence, memory, and validation needs.
5. System implementation.

Do not explain implementation machinery as the user's goal. For example, "the app needs a durable case object" may be technically true, but the user goal is to solve a difficult escalation faster and with more confidence.

## Agent Operating Frame

Not every prompt should carry the whole platform vision.

- Strict extraction agents should stay narrow. A parser should transcribe and structure evidence without trying to reason about the platform.
- Reasoning, triage, review, recommendation, knowledge, and coordinator agents should carry a small shared frame: they are specialists in a coordinated expert-agent team, working from evidence, preserving uncertainty, and handing off cleanly.
- Agents propose. Humans validate truth, risk, publication, and automation authority.

Useful shared rules for reasoning agents:

- Separate observed facts, assumptions, hypotheses, recommendations, and unresolved questions.
- Cite or name the evidence behind important claims when possible.
- Do not overclaim confidence or scope.
- Make the next action clear.
- Mark what another agent or human reviewer needs to verify.

## Narrow Work Rule

Narrow implementation docs should include a short "Role in the platform" section that answers:

1. What user or agent-team problem does this solve?
2. What evidence, memory, workflow, or decision does it improve?
3. What does it deliberately not solve?
4. How does it avoid blocking the larger platform direction?

This keeps today's small work useful without collapsing the product back into a single feature page.

## Success Feel

The product should eventually feel like:

> Here is the situation. Here is what the expert agents understand. Here is the evidence. Here are the open questions and risks. Here is what has worked before. Here is the recommended next action. Here is what changed after you acted.

It should not feel like:

> I clicked around Chat, Sessions, Escalations, Knowledge, Agents, traces, provider logs, and prompt files trying to understand what happened.
