# Agent Prompt Alignment

Agent prompt files are individual contracts for specialist agents. They should
serve the product hierarchy in `PRODUCT_NORTH_STAR.md`, but they should not all
carry the same amount of platform framing.

## Prompt Role In The Platform

The platform direction is a coordinated expert-agent system working over shared
evidence, memory, workflows, decisions, actions, and human validation.

For the current QBO case lifecycle, use `ESCALATION_KNOWLEDGE_LIFECYCLE.md` as
the contract. Prompts that capture, triage, resolve, enrich, review, or publish
case knowledge should preserve that lifecycle instead of inventing their own
states.

Prompt files should make each agent's role clear:

- what the agent is responsible for
- what evidence it may use
- what it must preserve for another agent or reviewer
- what it must not decide
- what confidence, uncertainty, or handoff state it should expose
- what output shape the surrounding app can safely consume

## How Much Product Frame To Include

Strict extraction agents should stay narrow. For example, an image parser should
transcribe and structure visible evidence without trying to reason about the
larger platform. Extra product language can contaminate deterministic output.

Reasoning, triage, review, recommendation, knowledge, and coordinator agents
should carry a small shared frame: they are specialists in a coordinated agent
team, working from evidence, preserving uncertainty, and handing off cleanly to
humans or other agents.

## Shared Rules For Reasoning Agents

- Separate observed facts, assumptions, hypotheses, recommendations, and open
  questions.
- Name the evidence behind important claims when possible.
- Do not overstate confidence or scope.
- Make the next action clear.
- Mark what another agent or human reviewer must validate.
- Do not treat draft, unsafe, contradicted, or review-only knowledge as final
  guidance.

## Source Of Truth

These files are versioned prompt seeds and working references. If the app has a
prompt editor or persisted agent profile for an agent, verify the active prompt
surface before claiming what the live agent currently uses.

Do not rewrite strict parser prompts just to add platform language. Prefer
adding platform-aware handoff, evidence, and uncertainty requirements to agents
that reason, review, recommend, or coordinate.
