# Coding-Agent Harness Architecture

This document explains how Claude Code and Codex are configured for this repository. `AGENTS.md`, `CLAUDE.md`, current source, and explicit user instructions remain authoritative when any memory or helper becomes stale.

## Layer Map

| Layer | Purpose | Location |
| --- | --- | --- |
| Root instructions | Durable product, workflow, safety, communication, and completion rules | `AGENTS.md`, `CLAUDE.md` |
| Scoped rules | Client- and server-specific guidance loaded only for matching files | `.claude/rules/` |
| Skills | Reusable project, planning, review, browser, and harness-audit workflows | `.agents/skills/`, `.claude/skills/` |
| Claude specialists | Worker, researcher, implementation reviewer, and harness auditor | `.claude/agents/` |
| Optional external agent tools | User-level MCP connections that let one coding agent give another a bounded task | Personal client configuration such as `~/.claude.json`; not committed |
| Hooks | Prompt reinforcement, service protection, workspace protection, and freshness warnings | `.claude/hooks/`, `.codex/hooks/` |
| Curated memory | Small reviewed project overview and Codex handoff | `.claude/memory/`, `.codex/memory/` |
| Automatic Claude agent memory | Local per-agent learning managed by Claude Code | `.claude/agent-memory/`, Gitignored |
| Local operational records | Raw sessions, hook logs, temporary state, and process IDs | Gitignored under `.claude/` and `.codex/` |

## Authority Order

1. Current user request and higher-priority platform instructions.
2. `AGENTS.md`, `CLAUDE.md`, and matching scoped rules.
3. Current source, tests, and saved deterministic harness evidence.
4. Curated project memory.
5. Automatic per-agent memory and raw local session records.

Memory helps recall; it never overrides current evidence or grants permission.

## Active Architecture

- The repeated PM hooks stay because they materially improved agent compliance.
- The Claude runtime guard blocks attempts to take over long-running services.
- The Claude workspace guard blocks destructive Git operations and direct full-file reads of common secret files.
- The session-start freshness hook reports instruction-map drift, missing harness files, and visibly stale curated memory.
- When Codex is run directly, it defaults to the main conversation and exposes only two bounded optional specialists: implementation review and harness audit.
- When delegation is useful, Claude Code prefers a separately authenticated, user-level Codex MCP server for most bounded research, implementation, and review tasks. Its ordinary delegated-work default is GPT-5.6 Sol with medium reasoning; higher effort is reserved for unusually difficult quality-first tasks. Built-in Claude specialists remain available when their preloaded skills or tool limits are the better fit. Availability is checked at runtime, Claude remains responsible for verification, and this connection is not an application-runtime dependency.
- Claude specialists preload the narrow skill they need instead of rediscovering the whole skill catalog.

## Deliberately Removed

Unused observation capture, background AI memory, session-finalization, folder-context generation, and obsolete AI-summary installation files were removed. They were not connected to the active project settings, could create stale or noisy memory, and included outdated assumptions. Raw session capture is not permanent project documentation.

## Detailed Registries

- [Hook registry](docs/agent-harness/HOOK_REGISTRY.md)
- [Memory policy](docs/agent-harness/MEMORY_POLICY.md)
- [Skill and specialist catalog](docs/agent-harness/SKILL_CATALOG.md)
