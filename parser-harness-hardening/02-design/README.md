# Phase 2: Design

This phase converts the Phase 1 discovery findings into concrete proposals the user can react to. Plain English first. Every code identifier paired with a one-line description of what it does.

## Scope of Phase 2

The user wants a **Sandbox tab** on every agent profile page (13 agents total). Phase 1 of the Sandbox tab is **agent-agnostic** — the same shared component works for every agent. Phase 1.5 of the Sandbox tab adds agent-specific extensions for chat agents and workflow-event agents.

This design phase covers:

1. **Concrete isolation architecture.** Three rules — prompt, result, event — and the specific mechanism for each. The sandbox must never write to production state.
2. **Agent-agnostic MVP architecture.** What plugs in once and applies to every agent versus what slots in per agent type.
3. **A correction to a Phase 1 finding.** `Widget2ParsedTemplate.jsx` (the chat-v5 component we earlier said "has a parallel localStorage-only pass/fail log that should be retired or merged") is actually dead code — not just the logging, the whole file — and removing it would not affect any visible feature.

## File index

- `sandbox-isolation-architecture.md` — answers question 2 (prompt isolation, result isolation, event isolation). One recommendation per kind plus a one-paragraph rationale.
- `agent-agnostic-sandbox-mvp.md` — answers question 3 (the minimal architecture for a Sandbox tab that works on every profile page). Includes the 13-agent input-type bucketing and per-piece effort estimates.
- `../01-discovery/widget2-parsed-template.md` — answers question 1 (Widget2ParsedTemplate full purpose, current usage in the active app, what removing it would break).

## How Phase 2 connects to Phase 1

| Phase 1 file | Phase 2 file that builds on it |
|--------------|--------------------------------|
| `01-discovery/sandbox-tab-feasibility.md` | `02-design/agent-agnostic-sandbox-mvp.md` — converts the feasibility breakdown into a concrete shared-parent + slot-trio architecture. |
| `01-discovery/chat-area-test-route.md` (sections on `ImageParseResult` and `ImageParserTestResult`) | `02-design/sandbox-isolation-architecture.md` — explains why sandbox writes must go to a new `SandboxParseResult` collection rather than tagging the production ones. |
| `01-discovery/profile-tabs-deep-map.md` | `02-design/agent-agnostic-sandbox-mvp.md` — the universal-vs-slot split reuses several of the existing tabs' building blocks (`AgentPromptTab` textarea, `RuntimeSettingsPanel` picker, `ParserOutput` card). |
| `01-discovery/agents-roster.md` | `02-design/agent-agnostic-sandbox-mvp.md` — the 13-agent inventory drives the input-type bucketing into image, text, and event types. |

## What this phase does **not** decide

- It does not commit to the Sandbox tab. Decision D5 in `../DECISIONS.md` still says "under consideration." This phase makes that consideration concrete enough for a yes/no.
- It does not pick implementation order between the Sandbox tab and the other four committed decisions (disable cleanup function, move `sdk-image-parse`, single-click grading, collapse parser prompts).
- It does not size the Phase 1.5 chat / event slots beyond a rough estimate. Those happen if/when the user asks.

## Next step after Phase 2

If the user approves the Sandbox tab proposal, the next phase is `03-build/` — the implementation plan with file:line patch points and a build order.

Last updated: 2026-05-19
