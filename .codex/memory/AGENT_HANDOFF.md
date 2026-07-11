# Codex Agent Handoff

Last verified: 2026-07-11. Use fresh Git state and current source instead of assuming this note remains current.

## Default Workflow

1. Read `AGENTS.md` and use `AGENT_HARNESS.md` for coding-agent architecture tasks.
2. Work in the main Codex conversation by default.
3. Use the optional implementation reviewer or harness auditor only when isolation or independent challenge materially helps.
4. Preserve concurrent work and do not control persistent services.
5. Run focused verification proportional to risk.
6. Commit and push completed requested work unless the user says not to.

## Current Harness Notes

- Active Claude hooks: PM reinforcement, runtime guard, workspace guard, and freshness check.
- Unused background-memory and raw-session automation was removed from tracked source on 2026-07-11.
- Canonical Codex repository skills live under `.agents/skills/`; duplicate `.codex/skills/agent-browser` was removed.
- Raw sessions, logs, automatic per-agent memory, and process state remain local-only.
