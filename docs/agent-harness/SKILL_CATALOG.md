# Coding-Agent Skill And Specialist Catalog

Last verified: 2026-07-11.

## Skills

| Skill | Provider | Use it for |
| --- | --- | --- |
| `qbo-escalations-project` | Claude and Codex | Fast project orientation and routing to the smallest relevant files |
| `implementation-plan` | Claude | Turning a feature idea into an approved, testable implementation checklist |
| `cto-review` | Claude | Read-only production-readiness review against the approved plan and current code |
| `skill-audit` | Claude | Periodic static, corpus, and optional official-doc review of the planning/review skill family |
| `agent-harness-audit` | Claude and Codex | Comparing instructions, memory, hooks, agents, prompts, provider behavior, and evidence contracts |
| `agent-browser` | Codex canonical copy | Browser and Electron automation when live visual verification is authorized |

## Claude Specialists

| Agent | Tools | Preloaded skill | Use it for |
| --- | --- | --- | --- |
| `worker` | Editing and focused verification | `qbo-escalations-project` | Bounded implementation |
| `researcher` | Read-only research | `qbo-escalations-project` | Current sources and codebase investigation |
| `implementation-reviewer` | Read-only | `qbo-escalations-project` | Cross-layer contract and lifecycle review |
| `harness-auditor` | Read-only | `agent-harness-audit` | Coding-agent or in-app agent harness review |

## Maintenance Rules

- A skill must have a distinct reusable workflow, not merely a persona name.
- Keep one canonical repository copy per provider discovery path.
- Validate frontmatter, referenced files, and helper-script syntax after edits.
- Date research results; do not turn time-bound research into permanent operating truth without re-verification.
- Prefer project skills for routing and checklists; use specialist agents when isolation or read-only review is the main benefit.
