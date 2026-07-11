---
name: agent-harness-audit
description: Use when reviewing or changing coding-agent instructions, memory, hooks, skills, custom agents, provider prompts, model settings, evidence capture, permissions, or deterministic agent evaluations in qbo-escalations.
allowed-tools: Read, Grep, Glob, Bash, WebFetch
context: fork
agent: general-purpose
---

# Agent Harness Audit

Start with `AGENT_HARNESS.md` and the existing `AGENT_HARNESS_REVIEW_2026-07-09.md`. Verify current state rather than assuming the dated report is still correct.

Review these layers separately:

1. Root and scoped instructions.
2. Active settings and hooks versus unused files.
3. Curated memory, automatic memory, raw sessions, privacy, and staleness.
4. Skill triggers, frontmatter, referenced files, helper scripts, and actual output history.
5. Custom-agent tool limits, preloaded skills, models, effort, and reporting contracts.
6. In-app prompts, provider request builders, model capability rules, evidence capture, and evaluation gates.
7. Contradictions, duplicated sources, inactive experiments, and missing mechanical enforcement.

Use current official provider documentation for changing platform behavior or model claims. Lead with plain-English findings ordered by urgency, then give exact evidence and a practical action list. Do not modify files during a review unless the user also asked for fixes.
