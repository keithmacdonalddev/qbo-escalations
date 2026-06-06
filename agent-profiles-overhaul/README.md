# Agent Profiles Overhaul — Working Folder

**Started:** 2026-05-30
**Owner:** (user) + Claude Code
**Scope:** Review and improve how agent profile pages are displayed in QBO Escalations. The review starts with the **Escalation Image Parser** (`escalation-template-parser`) profile, beginning at its **Overview** page, but findings apply to all agent profiles.

## Platform role

Agent profiles are mission-control documents for a coordinated expert-agent
system. They should show each agent's purpose, responsibilities, boundaries,
tools, memories, handoffs, runtime state, review status, and evidence of recent
behavior.

This work should not collapse into a prompt gallery. Prompt text is one part of
an agent contract, not the whole contract.

## Why this folder exists
This is a multi-session, possibly multi-agent effort. Conversations don't persist, so decisions, findings, and to-dos live here as the durable source of truth. Add more markdown files as the work grows (todos, refactor plans, per-tab reviews, etc.).

## Guiding principle
**No fabricated data on agent profiles.** The agent profile is meant to be the single source of truth for an agent's real state. Any number or diagram shown must trace to a real source, be clearly labelled as a sample, or be removed. (Aligns with the repo's "verify before stating as fact" rule.)

## Documents in this folder
- `01-overview-page-review.md` — End-to-end review of the Overview page: how it's built, which panels show real data vs. fabricated data, and our keep/fix/remove decision for each panel.
- `02-escalation-image-parser-agent-review.md` — Source-backed review of the Escalation Image Parser agent itself: prompt boundary, parser runtime, validation, persistence, chat handoff, and remaining provenance/determinism gaps.

## Status
- [x] End-to-end investigation of profile frontend + backend complete (2026-05-30)
- [ ] Overview page — panel-by-panel decisions (IN PROGRESS)
- [ ] Other tabs (Configuration, Prompt, Harness, Test Results, Event Streams, Chat Sessions, Memory, Monitoring, Workflows, Activity, Versions) — not yet reviewed
- [ ] Implementation of agreed changes — not started

## Related prior work (do not reinvent)
- `.claude/plans/agent-registry-bootstrap.md` — DRAFT, unimplemented plan to replace the hardcoded `AGENT_OPERATION_META` facade with a live registry. Directly relevant.
- `parser-harness-hardening/01-discovery/profile-tabs-deep-map.md` — earlier map of all profile tabs (stub vs functional), 2026-05-19.
- `parser-harness-hardening/01-discovery/agents-ui.md` — structural map of AgentsView.jsx.
- `TODOS/Agents Page.md` — product wishlist (e.g. "Profile as a Review Document", a real Change Review Workflow).
- NOTE: the top-level `AGENT-PROFILES/` directory is **aspirational documentation only — not read by any code.** Do not confuse it with the live agent system. (Verified 2026-05-30: zero references to "AGENT-PROFILES" anywhere under `client/` or `server/`.)
