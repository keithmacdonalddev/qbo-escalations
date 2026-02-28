# Claude Code Agents: Comprehensive Research Paper

**Date:** 2026-02-28
**Scope:** AGENTS.md, Custom Subagents, Agent Teams, Skills Integration, Hooks Integration, Model Override, Plugins, CLI Flags, Best Practices, Anti-Patterns, Use Cases, Performance, Limitations, Community Resources
**Sources:** Official Claude Code documentation (code.claude.com), Agent Skills specification (agentskills.io), AGENTS.md open standard (agents.md), Anthropic engineering blog, community articles, GitHub repositories

---

## Table of Contents

1. [AGENTS.md: The Open Standard](#1-agentsmd-the-open-standard)
2. [CLAUDE.md vs AGENTS.md: Relationship and Differences](#2-claudemd-vs-agentsmd-relationship-and-differences)
3. [Memory Hierarchy and Inheritance](#3-memory-hierarchy-and-inheritance)
4. [Custom Subagents: Full Specification](#4-custom-subagents-full-specification)
5. [Subagent Frontmatter Schema: Complete Field Reference](#5-subagent-frontmatter-schema-complete-field-reference)
6. [Built-in Subagents](#6-built-in-subagents)
7. [Agent Types and Model Override](#7-agent-types-and-model-override)
8. [Tool Restrictions and Permissions](#8-tool-restrictions-and-permissions)
9. [Skills Integration with Agents](#9-skills-integration-with-agents)
10. [Agent Skills: The Open Standard (agentskills.io)](#10-agent-skills-the-open-standard-agentskillsio)
11. [SKILL.md Frontmatter Schema: Complete Field Reference](#11-skillmd-frontmatter-schema-complete-field-reference)
12. [Hooks Integration with Agents](#12-hooks-integration-with-agents)
13. [Hook Events: Complete Reference](#13-hook-events-complete-reference)
14. [Hook Handler Types](#14-hook-handler-types)
15. [Agent Teams](#15-agent-teams)
16. [Plugins System](#16-plugins-system)
17. [CLI Flags and Programmatic Configuration](#17-cli-flags-and-programmatic-configuration)
18. [Persistent Agent Memory](#18-persistent-agent-memory)
19. [Subagent Execution Patterns](#19-subagent-execution-patterns)
20. [Cost Optimization and Performance](#20-cost-optimization-and-performance)
21. [30+ Use Cases](#21-30-use-cases)
22. [Best Practices](#22-best-practices)
23. [Anti-Patterns](#23-anti-patterns)
24. [Real-World Examples](#24-real-world-examples)
25. [Limitations and Known Issues](#25-limitations-and-known-issues)
26. [Pros and Cons Assessment](#26-pros-and-cons-assessment)
27. [Community Articles and Resources (All URLs)](#27-community-articles-and-resources-all-urls)
28. [Official Documentation Links](#28-official-documentation-links)
29. [Sources](#29-sources)

---

## 1. AGENTS.md: The Open Standard

### What Is AGENTS.md?

AGENTS.md is an open format for guiding AI coding agents. It functions as "a README for agents" -- a simple, plain Markdown file that provides coding agents with the extra context they need: build steps, tests, code conventions, security rules, and deployment procedures.

The specification emerged in mid-2025 from collaboration between Sourcegraph, OpenAI, Google, Cursor, and others. It is now maintained by the Agentic AI Foundation under the Linux Foundation. The pitch is simple: **one file, any agent.**

### Format

AGENTS.md is standard Markdown. There is no required schema, no YAML frontmatter, no special format. You use any headings, sections, and content structure you like. The agent simply parses the text you provide.

### Supported Agents

As of February 2026, AGENTS.md is supported by 25+ AI coding tools:

- Claude Code
- OpenAI Codex
- Google Jules / Gemini CLI
- GitHub Copilot
- Cursor
- Windsurf
- Aider
- Zed
- Warp
- RooCode
- VS Code (Copilot agent mode)
- Devin
- And others

### Hierarchy in Monorepos

For monorepos, nested AGENTS.md files in subdirectories take precedence over parent versions. The rule is: **the closest one to the file being edited takes precedence**, and explicit user prompts override everything.

### Recommended Sections

The specification suggests including:

- Project overview
- Build and test commands
- Code style guidelines
- Testing instructions
- Security considerations
- Commit message or PR guidelines
- Deployment steps
- Development environment tips

### Example AGENTS.md

```markdown
# AGENTS.md

## Project Overview
Express.js API server with React frontend.

## Build Commands
- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm test` - Run test suite

## Code Style
- Use ESLint with Airbnb config
- Prefer async/await over callbacks
- Use TypeScript strict mode

## Testing
- Write Jest unit tests for all new functions
- Integration tests required for API endpoints
- Minimum 80% code coverage

## Security
- Never hardcode API keys
- Validate all user input
- Use parameterized queries for SQL
```

---

## 2. CLAUDE.md vs AGENTS.md: Relationship and Differences

### CLAUDE.md

CLAUDE.md is Claude Code's proprietary memory file. The filename must be exactly `CLAUDE.md` (uppercase CLAUDE, lowercase .md). Claude Code looks for this specific filename when loading memory files. There is no required format -- the recommendation is to keep it concise and human-readable.

### Key Difference

CLAUDE.md is **Claude-only**. If your team uses Cursor, Copilot, or Codex alongside Claude Code, those tools will not read CLAUDE.md. That is where AGENTS.md provides value -- it is the cross-platform equivalent.

### When to Use Each

| Scenario | Use |
|:---------|:----|
| Claude Code only team | CLAUDE.md |
| Multi-tool team | AGENTS.md (or both) |
| Claude-specific instructions | CLAUDE.md |
| Universal coding conventions | AGENTS.md |

### Can You Use Both?

Yes. Claude Code reads both `CLAUDE.md` and `AGENTS.md`. Use `CLAUDE.md` for Claude-specific instructions and `AGENTS.md` for universal conventions that all tools should follow.

---

## 3. Memory Hierarchy and Inheritance

Claude Code loads memory files in a hierarchical structure. All levels combine (they do not replace each other), with more specific levels overriding on conflicts.

### Loading Order (Highest to Lowest Priority)

| Level | Location | Scope |
|:------|:---------|:------|
| Enterprise/Organization | `/etc/claude-code/CLAUDE.md` (Linux), managed policy | All users in the organization |
| Personal/Global | `~/.claude/CLAUDE.md` | All your projects |
| Project Root | `/project-root/CLAUDE.md` | The project |
| Subdirectory | `/project-root/frontend/CLAUDE.md` | Files in that directory |
| Local (gitignored) | `CLAUDE.local.md` | Personal project preferences |

### Loading Behavior

- CLAUDE.md files in the directory hierarchy **above** the working directory are loaded in full at launch.
- CLAUDE.md files in **child** directories load on demand when Claude reads files in those directories.
- Starting from the current working directory, Claude searches **upward** toward the root, loading every CLAUDE.md and CLAUDE.local.md file it finds.

### Modular Rules

Since Claude Code 2.0 (January 2026), memory files support importing modular rules via the `.claude/rules/` folder. Each rule file is a separate Markdown file that gets loaded alongside the main CLAUDE.md.

### Auto-Memory

Auto-memory is a persistent directory where Claude records learnings, patterns, and insights as it works. Unlike CLAUDE.md files that contain instructions you write for Claude, auto-memory is written by Claude itself.

---

## 4. Custom Subagents: Full Specification

### What Are Subagents?

Subagents are specialized AI assistants that handle specific types of tasks within Claude Code. Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions. When Claude encounters a task that matches a subagent's description, it delegates to that subagent, which works independently and returns results.

### Why Use Subagents?

- **Preserve context** by keeping exploration and implementation out of your main conversation
- **Enforce constraints** by limiting which tools a subagent can use
- **Reuse configurations** across projects with user-level subagents
- **Specialize behavior** with focused system prompts for specific domains
- **Control costs** by routing tasks to faster, cheaper models like Haiku

### File Format

Subagent files use YAML frontmatter for configuration, followed by the system prompt in Markdown:

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

The frontmatter defines the subagent's metadata and configuration. The body becomes the **system prompt** that guides the subagent's behavior. Subagents receive only this system prompt (plus basic environment details like working directory), not the full Claude Code system prompt.

### Subagent Scope and Priority

| Location | Scope | Priority |
|:---------|:------|:---------|
| `--agents` CLI flag | Current session only | 1 (highest) |
| `.claude/agents/` | Current project | 2 |
| `~/.claude/agents/` | All your projects | 3 |
| Plugin's `agents/` directory | Where plugin is enabled | 4 (lowest) |

When multiple subagents share the same name, the higher-priority location wins.

### Key Rules

- Subagents **cannot spawn other subagents**. If your workflow requires nested delegation, use Skills or chain subagents from the main conversation.
- Subagents are loaded at session start. If you create a subagent by manually adding a file, restart your session or use `/agents` to load it immediately.
- Project subagents (`.claude/agents/`) should be checked into version control so your team can use and improve them collaboratively.

---

## 5. Subagent Frontmatter Schema: Complete Field Reference

Every field that can appear in the YAML frontmatter of a subagent Markdown file:

| Field | Required | Type | Default | Description |
|:------|:---------|:-----|:--------|:------------|
| `name` | Yes | string | -- | Unique identifier using lowercase letters and hyphens |
| `description` | Yes | string | -- | When Claude should delegate to this subagent. Claude uses this to decide when to delegate |
| `tools` | No | string (comma-separated) | Inherits all tools | Tools the subagent can use. See [Available Tools](#8-tool-restrictions-and-permissions) |
| `disallowedTools` | No | string (comma-separated) | none | Tools to deny, removed from inherited or specified list |
| `model` | No | string | `inherit` | Model to use: `sonnet`, `opus`, `haiku`, or `inherit` |
| `permissionMode` | No | string | `default` | Permission mode: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, or `plan` |
| `maxTurns` | No | number | -- | Maximum number of agentic turns before the subagent stops |
| `skills` | No | list of strings | -- | Skills to load into the subagent's context at startup. Full skill content is injected, not just made available for invocation |
| `mcpServers` | No | list or map | -- | MCP servers available to this subagent. Each entry is either a server name referencing an already-configured server or an inline definition |
| `hooks` | No | object | -- | Lifecycle hooks scoped to this subagent |
| `memory` | No | string | -- | Persistent memory scope: `user`, `project`, or `local`. Enables cross-session learning |
| `background` | No | boolean | `false` | Set to `true` to always run this subagent as a background task |
| `isolation` | No | string | -- | Set to `worktree` to run the subagent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the subagent makes no changes |

### Permission Modes Explained

| Mode | Behavior |
|:-----|:---------|
| `default` | Standard permission checking with prompts |
| `acceptEdits` | Auto-accept file edits |
| `dontAsk` | Auto-deny permission prompts (explicitly allowed tools still work) |
| `bypassPermissions` | Skip all permission checks. **Use with caution.** |
| `plan` | Plan mode (read-only exploration) |

If the parent uses `bypassPermissions`, this takes precedence and cannot be overridden.

### Restricting Which Subagents Can Be Spawned

When an agent runs as the main thread with `claude --agent`, it can spawn subagents using the Task tool. To restrict which subagent types it can spawn, use `Task(agent_type)` syntax in the `tools` field:

```yaml
---
name: coordinator
description: Coordinates work across specialized agents
tools: Task(worker, researcher), Read, Bash
---
```

This is an allowlist: only the `worker` and `researcher` subagents can be spawned. To allow spawning any subagent without restrictions, use `Task` without parentheses. If `Task` is omitted from the `tools` list entirely, the agent cannot spawn any subagents.

This restriction only applies to agents running as the main thread with `claude --agent`. Subagents cannot spawn other subagents, so `Task(agent_type)` has no effect in subagent definitions.

---

## 6. Built-in Subagents

Claude Code includes several built-in subagents that Claude automatically uses when appropriate. Each inherits the parent conversation's permissions with additional tool restrictions.

### Explore

- **Model:** Haiku (fast, low-latency)
- **Tools:** Read-only tools (denied access to Write and Edit tools)
- **Purpose:** File discovery, code search, codebase exploration
- **Behavior:** Claude delegates to Explore when it needs to search or understand a codebase without making changes. This keeps exploration results out of your main conversation context.
- **Thoroughness levels:** `quick` (targeted lookups), `medium` (balanced exploration), `very thorough` (comprehensive analysis)

### Plan

- **Model:** Inherits from main conversation
- **Tools:** Read-only tools (denied access to Write and Edit tools)
- **Purpose:** Codebase research for planning
- **Behavior:** When you are in plan mode and Claude needs to understand your codebase, it delegates research to the Plan subagent. This prevents infinite nesting (subagents cannot spawn other subagents) while still gathering necessary context.

### General-purpose

- **Model:** Inherits from main conversation
- **Tools:** All tools
- **Purpose:** Complex research, multi-step operations, code modifications
- **Behavior:** Claude delegates to general-purpose when the task requires both exploration and modification, complex reasoning to interpret results, or multiple dependent steps.

### Other Built-in Agents

| Agent | Model | When Claude Uses It |
|:------|:------|:--------------------|
| Bash | Inherits | Running terminal commands in a separate context |
| statusline-setup | Sonnet | When you run `/statusline` to configure your status line |
| Claude Code Guide | Haiku | When you ask questions about Claude Code features |

---

## 7. Agent Types and Model Override

### Model Configuration

The `model` field controls which AI model the subagent uses:

- **`sonnet`** -- Claude Sonnet (balanced capability and speed)
- **`opus`** -- Claude Opus (highest capability, more expensive)
- **`haiku`** -- Claude Haiku (fast, low-cost)
- **`inherit`** -- Use the same model as the main conversation
- **Omitted** -- Defaults to `inherit`

### Cost Implications

| Model | Approximate Cost per Task | Best For |
|:------|:-------------------------|:---------|
| Haiku | ~$0.03/task | File search, quick questions, lightweight agents |
| Sonnet | ~$0.75/task | General development work, code review, implementation |
| Opus | ~$2.00/task | Deep reasoning, architecture decisions, complex analysis |

### Model Override at Startup

You can override the model during a session using `/model` commands or at startup with `claude --model`. The `opusplan` model alias provides a hybrid approach: Opus for complex reasoning and architecture decisions, then automatically switching to Sonnet for code generation and implementation.

### The `--agent` Flag

When you use `claude --agent <name>`, Claude Code applies the specified agent's configuration to your session:

- **System prompt:** The agent's custom instructions replace the default
- **Tool restrictions:** Only tools allowed by the agent are available
- **Model:** Uses the agent's specified model

You can also set the agent setting in your config file `.claude/settings.json`:

```json
{
  "agent": "security-reviewer"
}
```

---

## 8. Tool Restrictions and Permissions

### Available Internal Tools

Subagents can use any of Claude Code's internal tools. By default, subagents inherit all tools from the main conversation, including MCP tools.

The tools available in Claude Code include:

- `Read` -- Read file contents
- `Write` -- Create or overwrite a file
- `Edit` -- Replace strings in existing files
- `Bash` -- Execute shell commands
- `Glob` -- Find files matching a glob pattern
- `Grep` -- Search file contents with regular expressions
- `WebFetch` -- Fetch and process web content
- `WebSearch` -- Search the web
- `Task` -- Spawn a subagent
- `Skill` -- Invoke a skill
- `NotebookEdit` -- Edit Jupyter notebook cells
- MCP tools (e.g., `mcp__memory__create_entities`)

### Allowlist vs Denylist

To restrict tools, use the `tools` field (allowlist) or `disallowedTools` field (denylist):

```yaml
---
name: safe-researcher
description: Research agent with restricted capabilities
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
---
```

### Tool-Specific Permission Rules

You can allow or deny specific tool patterns using permission rules:

```text
# Allow only specific skills
Skill(commit)
Skill(review-pr *)

# Deny specific skills
Skill(deploy *)
```

Permission syntax: `Skill(name)` for exact match, `Skill(name *)` for prefix match with any arguments.

### Disabling Specific Subagents

Prevent Claude from using specific subagents by adding them to the `deny` array in your settings:

```json
{
  "permissions": {
    "deny": ["Task(Explore)", "Task(my-custom-agent)"]
  }
}
```

You can also use the `--disallowedTools` CLI flag:

```bash
claude --disallowedTools "Task(Explore)"
```

---

## 9. Skills Integration with Agents

### How Skills and Subagents Work Together

Skills and subagents work together in two directions:

| Approach | System Prompt | Task | Also Loads |
|:---------|:-------------|:-----|:-----------|
| Skill with `context: fork` | From agent type (`Explore`, `Plan`, etc.) | SKILL.md content | CLAUDE.md |
| Subagent with `skills` field | Subagent's markdown body | Claude's delegation message | Preloaded skills + CLAUDE.md |

### Preloading Skills into Subagents

Use the `skills` field to inject skill content into a subagent's context at startup. This gives the subagent domain knowledge without requiring it to discover and load skills during execution.

```yaml
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---

Implement API endpoints. Follow the conventions and patterns from the preloaded skills.
```

The **full content** of each skill is injected into the subagent's context, not just made available for invocation. Subagents do not inherit skills from the parent conversation; you must list them explicitly.

### Running Skills in a Subagent

Add `context: fork` to a skill's frontmatter to run it in isolation. The skill content becomes the prompt that drives the subagent. The `agent` field specifies which subagent configuration to use (options include built-in agents like `Explore`, `Plan`, `general-purpose`, or any custom subagent from `.claude/agents/`). If omitted, uses `general-purpose`.

```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---

Research $ARGUMENTS thoroughly:

1. Find relevant files using Glob and Grep
2. Read and analyze the code
3. Summarize findings with specific file references
```

When this skill runs:

1. A new isolated context is created
2. The subagent receives the skill content as its prompt
3. The `agent` field determines the execution environment (model, tools, and permissions)
4. Results are summarized and returned to your main conversation

### Skill Invocation Control

| Frontmatter | You Can Invoke | Claude Can Invoke | When Loaded into Context |
|:------------|:---------------|:------------------|:------------------------|
| (default) | Yes | Yes | Description always in context, full skill loads when invoked |
| `disable-model-invocation: true` | Yes | No | Description not in context, full skill loads when you invoke |
| `user-invocable: false` | No | Yes | Description always in context, full skill loads when invoked |

---

## 10. Agent Skills: The Open Standard (agentskills.io)

### Overview

Anthropic released Agent Skills as an open standard on December 18, 2025, published at agentskills.io. The standard enables cross-platform portability of skills across Claude Code, OpenAI Codex, Gemini CLI, GitHub Copilot, Cursor, VS Code, and 20+ other platforms.

### Design Philosophy

Skills transform general-purpose agents into specialized ones by packaging domain expertise into composable, reusable components. The framework treats skills similarly to "an onboarding guide for a new hire," allowing users to codify procedural knowledge.

### Progressive Disclosure

Skills use a three-tier information model:

1. **Metadata level (~100 tokens):** Skill `name` and `description` loaded at startup for all skills
2. **Full SKILL.md (<5000 tokens recommended):** Loaded when the skill is activated
3. **Linked files (as needed):** Additional context accessed only as needed (scripts, references, assets)

### Directory Structure

```
skill-name/
├── SKILL.md           # Required - main instructions
├── scripts/           # Optional - executable code
│   └── extract.py
├── references/        # Optional - additional documentation
│   ├── REFERENCE.md
│   └── FORMS.md
└── assets/            # Optional - static resources
    ├── templates/
    └── schemas/
```

---

## 11. SKILL.md Frontmatter Schema: Complete Field Reference

### Agent Skills Open Standard Fields (agentskills.io)

| Field | Required | Constraints | Description |
|:------|:---------|:------------|:------------|
| `name` | Yes | Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen. Must not contain consecutive hyphens (`--`). Must match the parent directory name. | Unique identifier for the skill |
| `description` | Yes | Max 1024 characters. Non-empty. | What the skill does and when to use it. Should include keywords that help agents identify relevant tasks |
| `license` | No | -- | License name or reference to a bundled license file |
| `compatibility` | No | Max 500 characters | Environment requirements (intended product, system packages, network access, etc.) |
| `metadata` | No | Map of string keys to string values | Arbitrary key-value mapping for additional metadata (e.g., `author`, `version`) |
| `allowed-tools` | No | Space-delimited list | Pre-approved tools the skill may use. Experimental |

### Claude Code Extension Fields

Claude Code extends the Agent Skills standard with additional frontmatter fields:

| Field | Required | Description |
|:------|:---------|:------------|
| `name` | No | Display name for the skill. If omitted, uses the directory name. Lowercase letters, numbers, and hyphens only (max 64 characters) |
| `description` | Recommended | What the skill does and when to use it. Claude uses this to decide when to apply the skill. If omitted, uses the first paragraph of markdown content |
| `argument-hint` | No | Hint shown during autocomplete to indicate expected arguments. Example: `[issue-number]` or `[filename] [format]` |
| `disable-model-invocation` | No | Set to `true` to prevent Claude from automatically loading this skill. Use for workflows you want to trigger manually with `/name`. Default: `false` |
| `user-invocable` | No | Set to `false` to hide from the `/` menu. Use for background knowledge users should not invoke directly. Default: `true` |
| `allowed-tools` | No | Tools Claude can use without asking permission when this skill is active |
| `model` | No | Model to use when this skill is active |
| `context` | No | Set to `fork` to run in a forked subagent context |
| `agent` | No | Which subagent type to use when `context: fork` is set |
| `hooks` | No | Hooks scoped to this skill's lifecycle |

### String Substitutions in Skills

| Variable | Description |
|:---------|:------------|
| `$ARGUMENTS` | All arguments passed when invoking the skill. If not present in the content, arguments are appended as `ARGUMENTS: <value>` |
| `$ARGUMENTS[N]` | Access a specific argument by 0-based index, such as `$ARGUMENTS[0]` for the first |
| `$N` | Shorthand for `$ARGUMENTS[N]`, such as `$0` for the first argument |
| `${CLAUDE_SESSION_ID}` | The current session ID. Useful for logging, creating session-specific files, or correlating output with sessions |

### Dynamic Context Injection

The `` !`command` `` syntax runs shell commands before the skill content is sent to Claude. The command output replaces the placeholder:

```yaml
---
name: pr-summary
description: Summarize changes in a pull request
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Your task
Summarize this pull request...
```

### Where Skills Live

| Location | Path | Applies To |
|:---------|:-----|:-----------|
| Enterprise | See managed settings | All users in your organization |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects |
| Project | `.claude/skills/<skill-name>/SKILL.md` | This project only |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Where plugin is enabled |

When skills share the same name across levels, higher-priority locations win: enterprise > personal > project. Plugin skills use a `plugin-name:skill-name` namespace, so they cannot conflict with other levels.

### Automatic Discovery from Nested Directories

When working with files in subdirectories, Claude Code automatically discovers skills from nested `.claude/skills/` directories. For example, editing a file in `packages/frontend/` causes Claude Code to also look for skills in `packages/frontend/.claude/skills/`. This supports monorepo setups.

### Skills from `--add-dir` Directories

Skills defined in `.claude/skills/` within directories added via `--add-dir` are loaded automatically and picked up by live change detection, so you can edit them during a session without restarting.

### Context Budget

Skill descriptions are loaded into context so Claude knows what is available. If you have many skills, they may exceed the character budget. The budget scales dynamically at **2% of the context window**, with a fallback of 16,000 characters. Run `/context` to check for a warning about excluded skills. To override the limit, set the `SLASH_COMMAND_TOOL_CHAR_BUDGET` environment variable.

---

## 12. Hooks Integration with Agents

### Hooks in Subagent Frontmatter

Hooks can be defined directly in subagent frontmatter. These hooks only run while that specific subagent is active and are cleaned up when it finishes. All hook events are supported.

The most common events for subagents:

| Event | Matcher Input | When It Fires |
|:------|:-------------|:--------------|
| `PreToolUse` | Tool name | Before the subagent uses a tool |
| `PostToolUse` | Tool name | After the subagent uses a tool |
| `Stop` | (none) | When the subagent finishes (converted to `SubagentStop` at runtime) |

Example: validate Bash commands with `PreToolUse` and lint after file edits with `PostToolUse`:

```yaml
---
name: code-reviewer
description: Review code changes with automatic linting
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh $TOOL_INPUT"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
---
```

### Project-Level Hooks for Subagent Events

Configure hooks in `settings.json` that respond to subagent lifecycle events in the main session:

| Event | Matcher Input | When It Fires |
|:------|:-------------|:--------------|
| `SubagentStart` | Agent type name | When a subagent begins execution |
| `SubagentStop` | Agent type name | When a subagent completes |

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "db-agent",
        "hooks": [
          { "type": "command", "command": "./scripts/setup-db-connection.sh" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "./scripts/cleanup-db-connection.sh" }
        ]
      }
    ]
  }
}
```

### Hooks in Skills Frontmatter

Skills can also define hooks scoped to their lifecycle, using the same configuration format as settings-based hooks:

```yaml
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

### Conditional Rules with Hooks

Use `PreToolUse` hooks to validate operations before they execute. This example creates a subagent that only allows read-only database queries:

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

The validation script:

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b' > /dev/null; then
  echo "Blocked: Only SELECT queries are allowed" >&2
  exit 2
fi

exit 0
```

---

## 13. Hook Events: Complete Reference

### Full Event List

| Event | When It Fires | Can Block? |
|:------|:-------------|:-----------|
| `SessionStart` | When a session begins or resumes | No |
| `UserPromptSubmit` | When you submit a prompt, before Claude processes it | Yes |
| `PreToolUse` | Before a tool call executes | Yes |
| `PermissionRequest` | When a permission dialog appears | Yes |
| `PostToolUse` | After a tool call succeeds | No (tool already ran) |
| `PostToolUseFailure` | After a tool call fails | No (tool already failed) |
| `Notification` | When Claude Code sends a notification | No |
| `SubagentStart` | When a subagent is spawned | No |
| `SubagentStop` | When a subagent finishes | Yes |
| `Stop` | When Claude finishes responding | Yes |
| `TeammateIdle` | When an agent team teammate is about to go idle | Yes |
| `TaskCompleted` | When a task is being marked as completed | Yes |
| `ConfigChange` | When a configuration file changes during a session | Yes (except policy_settings) |
| `WorktreeCreate` | When a worktree is being created | Yes (non-zero exit fails) |
| `WorktreeRemove` | When a worktree is being removed | No |
| `PreCompact` | Before context compaction | No |
| `SessionEnd` | When a session terminates | No |

### Matcher Patterns

| Event | What the Matcher Filters | Example Matcher Values |
|:------|:------------------------|:----------------------|
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` | Tool name | `Bash`, `Edit\|Write`, `mcp__.*` |
| `SessionStart` | How the session started | `startup`, `resume`, `clear`, `compact` |
| `SessionEnd` | Why the session ended | `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |
| `Notification` | Notification type | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| `SubagentStart`, `SubagentStop` | Agent type | `Bash`, `Explore`, `Plan`, or custom agent names |
| `PreCompact` | What triggered compaction | `manual`, `auto` |
| `ConfigChange` | Configuration source | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| `UserPromptSubmit`, `Stop`, `TeammateIdle`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove` | No matcher support | Always fires on every occurrence |

The matcher is a **regex**: `Edit|Write` matches either tool, `Notebook.*` matches any tool starting with Notebook, `mcp__memory__.*` matches all tools from the memory MCP server.

### Common Input Fields (All Events)

| Field | Description |
|:------|:------------|
| `session_id` | Current session identifier |
| `transcript_path` | Path to conversation JSON |
| `cwd` | Current working directory when the hook is invoked |
| `permission_mode` | Current permission mode: `default`, `plan`, `acceptEdits`, `dontAsk`, or `bypassPermissions` |
| `hook_event_name` | Name of the event that fired |

### Exit Code Behavior

| Exit Code | Meaning | JSON Parsed? |
|:----------|:--------|:-------------|
| **0** | Success. Claude Code parses stdout for JSON output | Yes |
| **2** | Blocking error. stderr is fed back as error message | No (JSON ignored) |
| **Other** | Non-blocking error. stderr shown in verbose mode | No |

### PreToolUse Decision Control

| Field | Description |
|:------|:------------|
| `permissionDecision` | `"allow"` bypasses permission, `"deny"` prevents tool call, `"ask"` prompts user |
| `permissionDecisionReason` | For `allow`/`ask`: shown to user. For `deny`: shown to Claude |
| `updatedInput` | Modifies tool input parameters before execution |
| `additionalContext` | String added to Claude's context before tool executes |

### PermissionRequest Decision Control

| Field | Description |
|:------|:------------|
| `behavior` | `"allow"` grants permission, `"deny"` denies it |
| `updatedInput` | For `allow` only: modifies tool input before execution |
| `updatedPermissions` | For `allow` only: applies permission rule updates |
| `message` | For `deny` only: tells Claude why permission was denied |
| `interrupt` | For `deny` only: if `true`, stops Claude |

### Universal JSON Output Fields

| Field | Default | Description |
|:------|:--------|:------------|
| `continue` | `true` | If `false`, Claude stops processing entirely. Takes precedence over event-specific decisions |
| `stopReason` | none | Message shown to user when `continue` is `false`. Not shown to Claude |
| `suppressOutput` | `false` | If `true`, hides stdout from verbose mode output |
| `systemMessage` | none | Warning message shown to the user |

---

## 14. Hook Handler Types

### Command Hooks (`type: "command"`)

Run a shell command. The script receives event JSON on stdin and communicates results through exit codes and stdout.

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | Yes | `"command"` |
| `command` | Yes | Shell command to execute |
| `timeout` | No | Seconds before canceling (default: 600) |
| `async` | No | If `true`, runs in background without blocking |
| `statusMessage` | No | Custom spinner message while hook runs |
| `once` | No | If `true`, runs only once per session (skills only) |

### HTTP Hooks (`type: "http"`)

Send the event JSON as an HTTP POST request to a URL.

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | Yes | `"http"` |
| `url` | Yes | URL to send the POST request to |
| `headers` | No | Additional HTTP headers. Values support `$VAR_NAME` interpolation |
| `allowedEnvVars` | No | Environment variable names that may be interpolated into headers |
| `timeout` | No | Seconds before canceling (default: 30) |

HTTP hooks cannot signal a blocking error through status codes alone. To block a tool call, return a 2xx response with a JSON body containing the appropriate decision fields.

### Prompt Hooks (`type: "prompt"`)

Send a prompt to a Claude model for single-turn evaluation. The model returns a yes/no decision as JSON.

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | Yes | `"prompt"` |
| `prompt` | Yes | Prompt text. Use `$ARGUMENTS` as placeholder for hook input JSON |
| `model` | No | Model to use for evaluation (defaults to a fast model) |
| `timeout` | No | Seconds before canceling (default: 30) |

### Agent Hooks (`type: "agent"`)

Spawn a subagent that can use tools like Read, Grep, and Glob to verify conditions before returning a decision.

| Field | Required | Description |
|:------|:---------|:------------|
| `type` | Yes | `"agent"` |
| `prompt` | Yes | Prompt text. Use `$ARGUMENTS` as placeholder for hook input JSON |
| `model` | No | Model to use (defaults to a fast model) |
| `timeout` | No | Seconds before canceling (default: 60) |

### Hook Locations

| Location | Scope | Shareable |
|:---------|:------|:----------|
| `~/.claude/settings.json` | All your projects | No, local to your machine |
| `.claude/settings.json` | Single project | Yes, can be committed to the repo |
| `.claude/settings.local.json` | Single project | No, gitignored |
| Managed policy settings | Organization-wide | Yes, admin-controlled |
| Plugin `hooks/hooks.json` | When plugin is enabled | Yes, bundled with the plugin |
| Skill or agent frontmatter | While the component is active | Yes, defined in the component file |

### Environment Variables for Hook Scripts

- `$CLAUDE_PROJECT_DIR` -- the project root
- `${CLAUDE_PLUGIN_ROOT}` -- the plugin's root directory
- `$CLAUDE_CODE_REMOTE` -- set to `"true"` in remote web environments
- `$CLAUDE_ENV_FILE` -- path to persist environment variables (SessionStart hooks only)

---

## 15. Agent Teams

### Overview

Agent teams are **experimental** and disabled by default. They let you coordinate multiple Claude Code instances working together. One session acts as the team lead, coordinating work, assigning tasks, and synthesizing results. Teammates work independently, each in its own context window, and communicate directly with each other.

### Enabling Agent Teams

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### Architecture

| Component | Role |
|:----------|:-----|
| **Team lead** | The main Claude Code session that creates the team, spawns teammates, and coordinates work |
| **Teammates** | Separate Claude Code instances that each work on assigned tasks |
| **Task list** | Shared list of work items that teammates claim and complete |
| **Mailbox** | Messaging system for communication between agents |

Storage locations:

- **Team config:** `~/.claude/teams/{team-name}/config.json`
- **Task list:** `~/.claude/tasks/{team-name}/`

### Agent Teams vs Subagents

| | Subagents | Agent Teams |
|:--|:---------|:------------|
| **Context** | Own context window; results return to the caller | Own context window; fully independent |
| **Communication** | Report results back to the main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list with self-coordination |
| **Best for** | Focused tasks where only the result matters | Complex work requiring discussion and collaboration |
| **Token cost** | Lower: results summarized back to main context | Higher: each teammate is a separate Claude instance |

### Display Modes

- **In-process:** All teammates run inside your main terminal. Use Shift+Down to cycle through teammates.
- **Split panes:** Each teammate gets its own pane (requires tmux or iTerm2).

### Task Management

Tasks have three states: **pending**, **in progress**, and **completed**. Tasks can depend on other tasks. Task claiming uses file locking to prevent race conditions.

### Hooks for Agent Teams

| Event | When It Fires | Exit 2 Behavior |
|:------|:-------------|:----------------|
| `TeammateIdle` | Teammate is about to go idle | Prevents idle; teammate continues working with stderr feedback |
| `TaskCompleted` | Task is being marked complete | Prevents completion; stderr feedback sent to model |

### Agent Team Limitations

- No session resumption with in-process teammates
- Task status can lag
- Shutdown can be slow
- One team per session
- No nested teams (teammates cannot spawn their own teams)
- Lead is fixed for the team's lifetime
- Permissions set at spawn (all teammates start with lead's permission mode)
- Split panes require tmux or iTerm2

---

## 16. Plugins System

### Overview

Claude Code Plugins are extension packages that bundle skills, agents, hooks, and MCP servers. Over 9,000 plugins are available as of February 2026.

### Plugin Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json       # Plugin manifest (required)
├── skills/               # Optional - skill directories
│   └── my-skill/
│       └── SKILL.md
├── agents/               # Optional - agent definitions
│   └── my-agent.md
├── hooks/                # Optional - hook configuration
│   └── hooks.json
└── mcp-servers/          # Optional - MCP server configs
```

### Plugin Manifest (plugin.json)

The manifest defines the plugin's identity: name, description, and version. Only `plugin.json` goes inside `.claude-plugin/`. All other directories must be at the plugin root level.

### Distribution

- Run `/plugin marketplace add user-or-org/repo-name` to register a marketplace
- Use `/plugin` to browse and install
- The official Anthropic marketplace is pre-configured
- If you already have skills or hooks in `.claude/`, you can convert them into a plugin for sharing

### Plugin Hooks

Plugin hooks are defined in `hooks/hooks.json` with an optional top-level `description` field. When a plugin is enabled, its hooks merge with your user and project hooks.

```json
{
  "description": "Automatic code formatting",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

---

## 17. CLI Flags and Programmatic Configuration

### `--agent` Flag

Start Claude Code with a specific agent configuration:

```bash
claude --agent security-reviewer
```

### `--agents` Flag (JSON)

Define ephemeral agents for a single session via JSON:

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

The `--agents` flag accepts JSON with the same frontmatter fields as file-based subagents: `description`, `prompt`, `tools`, `disallowedTools`, `model`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, and `memory`. Use `prompt` for the system prompt, equivalent to the markdown body in file-based subagents.

### `--disallowedTools` Flag

Deny specific tools or subagents:

```bash
claude --disallowedTools "Task(Explore)"
```

### `--model` Flag

Override the model for the session:

```bash
claude --model opus
```

### `--worktree` Flag

Run in a git worktree for isolated file changes:

```bash
claude --worktree
```

### `--add-dir` Flag

Add additional directories whose skills are loaded:

```bash
claude --add-dir /path/to/shared-skills
```

### `--teammate-mode` Flag

Force a specific display mode for agent teams:

```bash
claude --teammate-mode in-process
```

### Listing Agents from CLI

List all configured subagents without starting an interactive session:

```bash
claude agents
```

This shows agents grouped by source and indicates which are overridden by higher-priority definitions.

---

## 18. Persistent Agent Memory

### Overview

The `memory` field in subagent frontmatter gives the subagent a persistent directory that survives across conversations. The subagent uses this directory to build up knowledge over time.

### Memory Scopes

| Scope | Location | Use When |
|:------|:---------|:---------|
| `user` | `~/.claude/agent-memory/<name-of-agent>/` | The subagent should remember learnings across all projects |
| `project` | `.claude/agent-memory/<name-of-agent>/` | The knowledge is project-specific and shareable via version control |
| `local` | `.claude/agent-memory-local/<name-of-agent>/` | The knowledge is project-specific but should not be checked into version control |

### How Memory Works

When memory is enabled:

- The subagent's system prompt includes instructions for reading and writing to the memory directory
- The first 200 lines of `MEMORY.md` in the memory directory are included in the system prompt, with instructions to curate if it exceeds 200 lines
- Read, Write, and Edit tools are automatically enabled so the subagent can manage its memory files

### Tips for Persistent Memory

- `user` is the recommended default scope
- Ask the subagent to consult its memory before starting work
- Ask the subagent to update its memory after completing a task
- Include memory instructions directly in the subagent's markdown file:

```markdown
Update your agent memory as you discover codepaths, patterns, library
locations, and key architectural decisions. This builds up institutional
knowledge across conversations. Write concise notes about what you found
and where.
```

---

## 19. Subagent Execution Patterns

### Foreground vs Background

- **Foreground subagents** block the main conversation until complete. Permission prompts and clarifying questions are passed through to you.
- **Background subagents** run concurrently while you continue working. Before launching, Claude Code prompts for any tool permissions the subagent will need upfront. Once running, the subagent inherits these permissions and auto-denies anything not pre-approved.

You can press **Ctrl+B** to background a running task.

To disable all background task functionality: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`

### Parallel Research

Spawn multiple subagents to work simultaneously:

```text
Research the authentication, database, and API modules in parallel using separate subagents
```

### Chaining Subagents

For multi-step workflows, ask Claude to use subagents in sequence:

```text
Use the code-reviewer subagent to find performance issues, then use the optimizer subagent to fix them
```

### Resuming Subagents

Each subagent invocation creates a new instance with fresh context. To continue an existing subagent's work:

```text
Continue that code review and now analyze the authorization logic
```

Resumed subagents retain their full conversation history, including all previous tool calls, results, and reasoning.

### Subagent Transcripts

- Stored at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`
- Main conversation compaction does not affect subagent transcripts
- Transcripts persist within their session
- Automatic cleanup based on `cleanupPeriodDays` setting (default: 30 days)

### Auto-Compaction

Subagents support automatic compaction at approximately 95% capacity. Set `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` to a lower percentage to trigger earlier.

### When to Use Main Conversation vs Subagents

**Use main conversation when:**
- The task needs frequent back-and-forth or iterative refinement
- Multiple phases share significant context
- You are making a quick, targeted change
- Latency matters (subagents start fresh and may need time to gather context)

**Use subagents when:**
- The task produces verbose output you do not need in your main context
- You want to enforce specific tool restrictions or permissions
- The work is self-contained and can return a summary

---

## 20. Cost Optimization and Performance

### Cost Reduction Through Delegation

Sub-agent delegation can reduce costs by **85-92%** compared to all-Sonnet architecture. Parent agents (Sonnet) handle strategic work while sub-agents (Haiku) handle bounded tasks.

Real production metrics from Kaxo Technologies:

| Metric | Before | After | Reduction |
|:-------|:-------|:------|:----------|
| Data research task cost | $0.05-0.10 (Sonnet) | $0.001-0.002 (Haiku) | ~98% |
| Monthly API costs | $542 | $42 | 92% |
| Task volume | Baseline | +700% | Costs still dropped |

### Scaling Trajectory

- **Day 0:** 4 agents
- **Day 30:** 10 agents (added 6 meta-agents)
- **Day 90:** 35 agents (17 meta + 18 domain-specific)
- **Final cost:** Under $500/year vs $5,000+ for traditional architecture

### Delegation Decision Framework

**Haiku sub-agent opportunities:**
- Repetitive tasks (3+ occurrences)
- Clear input/output specifications
- No strategic judgment required
- API data fetching, file parsing, report generation

**Sonnet parent agents handle:**
- Strategic synthesis across contexts
- Pattern recognition requiring judgment
- Complex content generation
- Decision-making with ambiguous requirements

### Context Management

- Opus 4.6 and Sonnet 4.6 support a 1 million token context window
- Avoid the last 20% of context window for large refactoring and multi-file features
- Lower-sensitivity tasks tolerate higher utilization

### Model Selection Strategy

| Model | Cost per Task | When to Use |
|:------|:-------------|:------------|
| Haiku | ~$0.03 | File search, quick questions, lightweight exploration |
| Sonnet | ~$0.75 | General development, code review, implementation |
| Opus | ~$2.00 | Deep reasoning, architecture, complex analysis |
| `opusplan` | Hybrid | Opus for reasoning, then Sonnet for implementation |

### Prompt Caching

Claude Code automatically uses prompt caching to optimize performance and reduce costs. No manual configuration required.

---

## 21. 30+ Use Cases

### Code Quality and Review

1. **Code reviewer** -- Read-only subagent that reviews code for quality, security, and maintainability
2. **Security reviewer** -- Vulnerability detection before commits, focusing on sensitive code
3. **Go/Python/TypeScript reviewer** -- Language-specific code review subagents
4. **PR reviewer** -- Automated pull request review with multiple reviewers (security, performance, test coverage) using agent teams
5. **Dead code cleanup** -- Refactoring agent that identifies and removes unused code

### Development Workflow

6. **Debugger** -- Root cause analysis with both exploration and fix capabilities
7. **Build error resolver** -- Fix build and type errors when builds fail
8. **TDD guide** -- Test-driven development workflow: write test first, implement, refactor
9. **Fix GitHub issue** -- Skill that takes an issue number and implements the fix
10. **Deploy** -- Deployment skill triggered manually with `disable-model-invocation: true`
11. **Commit** -- Automated commit workflow with conventional commit format

### Architecture and Planning

12. **Planner** -- Implementation planning for complex features and refactoring
13. **Architect** -- System design and scalability decisions
14. **Database reviewer** -- PostgreSQL/Supabase schema design and query optimization
15. **API developer** -- Implement endpoints following team conventions (with preloaded skills)

### Research and Exploration

16. **Deep research** -- Forked Explore agent for thorough codebase research
17. **Codebase visualizer** -- Generate interactive HTML tree views of project structure
18. **PR summary** -- Summarize pull request changes using dynamic context injection
19. **Parallel research** -- Multiple subagents investigating different aspects simultaneously

### Data and Analysis

20. **Data scientist** -- SQL queries, BigQuery operations, data insights
21. **Database query validator** -- Read-only SQL queries with PreToolUse hook validation
22. **Log analyzer** -- Parse and analyze application logs

### Documentation

23. **Doc updater** -- Documentation and codemap maintenance
24. **API documentation generator** -- Generate API docs from code
25. **Codebase explainer** -- Explain code with diagrams, analogies, and step-by-step walkthroughs

### Agent Teams Scenarios

26. **Competing hypotheses debugging** -- Multiple teammates test different theories in parallel
27. **Cross-layer coordination** -- Frontend, backend, and test changes each owned by a different teammate
28. **New module development** -- Teammates each own a separate piece without stepping on each other
29. **Parallel code review** -- Security, performance, and test coverage reviewed simultaneously

### Security and Compliance

30. **Secret scanner** -- PreToolUse hook that blocks commits containing API keys or passwords
31. **Read-only mode** -- Skill that limits Claude to Read, Grep, Glob only
32. **Destructive command blocker** -- Hook that prevents `rm -rf` and other dangerous commands

### DevOps and CI/CD

33. **E2E test runner** -- End-to-end Playwright testing for critical user flows
34. **Configuration auditor** -- ConfigChange hook that logs all settings changes
35. **Build artifact validator** -- TeammateIdle hook that checks build output before allowing idle

### Meta-Agent Patterns

36. **Permission management** -- Meta-agent for managing permissions across a fleet
37. **Configuration synchronization** -- Meta-agent for syncing configs across agents
38. **Cost monitoring** -- Meta-agent for tracking API costs and agent utilization
39. **Error aggregation** -- Meta-agent for collecting and analyzing errors across agents

---

## 22. Best Practices

### Agent Design

1. **Design focused subagents.** Each subagent should excel at one specific task. Avoid creating "swiss army knife" agents that try to do everything.

2. **Write detailed descriptions.** Claude uses the description to decide when to delegate. Include phrases like "use proactively" to encourage automatic delegation.

3. **Limit tool access.** Grant only the tools necessary for the task. A code reviewer does not need Write/Edit access. A researcher does not need Bash.

4. **Check into version control.** Share project subagents (`.claude/agents/`) with your team via Git.

5. **Start with research and review.** If you are new to agent teams, start with tasks that have clear boundaries and do not require writing code: reviewing a PR, researching a library, or investigating a bug.

### Skill Design

6. **Keep SKILL.md under 500 lines.** Move detailed reference material to separate files in `references/` or `scripts/`.

7. **Write good descriptions.** Include specific keywords that help agents identify relevant tasks. Bad: "Helps with PDFs." Good: "Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs."

8. **Use `disable-model-invocation: true` for side effects.** Deploy, commit, and send-message skills should only be triggered manually.

9. **Use `user-invocable: false` for background knowledge.** Legacy system context and domain knowledge should be available to Claude but not as user commands.

### Hook Design

10. **Use exit code 2 for blocking.** This is the standard signal for "stop, don't do this." Stderr is fed back to Claude.

11. **Keep hooks fast.** Hooks run synchronously by default. Slow hooks block the entire session.

12. **Use async for non-blocking operations.** Set `async: true` for logging, notifications, or other operations that do not need to block.

13. **Validate at the boundary.** Use PreToolUse hooks for input validation, PostToolUse hooks for output verification.

### Agent Teams

14. **Give teammates enough context.** Include task-specific details in the spawn prompt. Teammates do not inherit the lead's conversation history.

15. **Choose appropriate team size.** Start with 3-5 teammates. Having 5-6 tasks per teammate keeps everyone productive without excessive context switching.

16. **Size tasks appropriately.** Too small: coordination overhead exceeds benefit. Too large: teammates work too long without check-ins. Aim for self-contained units.

17. **Avoid file conflicts.** Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files.

18. **Monitor and steer.** Check in on teammates' progress and redirect approaches that are not working.

### Cost Optimization

19. **Use Haiku for bounded tasks.** File search, data fetching, report generation -- tasks with clear input/output specifications.

20. **Use Sonnet as default.** Saves 80% on costs while maintaining excellent performance for 90% of development tasks.

21. **Reserve Opus for deep reasoning.** Architecture decisions, complex analysis, ambiguous requirements.

22. **Clear task specifications prevent waste.** Include four elements: input format, output format, success criteria, and error handling.

### CLAUDE.md / AGENTS.md

23. **Keep it concise.** An over-specified file causes Claude to ignore half of it as important rules get lost in the noise.

24. **Use multiple files.** Keep a general one at project root and add more specific ones in subdirectories like `/frontend` or `/backend`.

25. **Scope investigations narrowly.** The infinite exploration anti-pattern happens when you ask Claude to "investigate" without limits, causing it to read hundreds of files.

26. **Use Git branches as safety nets.** Always have Claude create a new branch for each task, which isolates work and gives you a safety net.

---

## 23. Anti-Patterns

### Agent Design Anti-Patterns

1. **The Swiss Army Knife Agent.** Creating one agent that does everything. Fix: break into focused, single-purpose agents.

2. **Missing descriptions.** Not writing a description or writing a vague one like "helpful agent." Fix: write detailed descriptions with specific trigger keywords.

3. **Inheriting all tools.** Leaving tools unspecified when the agent only needs read access. Fix: explicitly list required tools.

4. **Nested delegation attempt.** Expecting subagents to spawn other subagents. Fix: chain subagents from the main conversation instead.

### Skill Anti-Patterns

5. **Context overload.** Putting 2000+ lines in SKILL.md. Fix: keep under 500 lines, use reference files.

6. **Too many skills.** Exceeding the context budget with dozens of skill descriptions. Fix: check `/context` for warnings, set `SLASH_COMMAND_TOOL_CHAR_BUDGET`.

7. **Missing `disable-model-invocation` on deploy/commit skills.** Claude decides to deploy because your code looks ready. Fix: add `disable-model-invocation: true`.

8. **Too many custom slash commands.** The entire point of an agent like Claude is that you can type almost whatever you want. Fix: use natural language instead of creating commands for everything.

### Hook Anti-Patterns

9. **Blocking hooks on non-blocking events.** Using exit code 2 on PostToolUse or Notification events, which cannot block. Fix: check the exit code 2 behavior table.

10. **Slow synchronous hooks.** Running expensive operations (test suites, network calls) in synchronous hooks. Fix: use `async: true` or move to PostToolUse.

11. **JSON and exit code 2 mixed.** Trying to return JSON on exit code 2 (JSON is ignored). Fix: choose one approach -- exit codes alone, or exit 0 with JSON.

12. **Shell profile interference.** Shell startup scripts printing text that interferes with JSON parsing. Fix: redirect profile output to stderr.

### Agent Teams Anti-Patterns

13. **File conflicts.** Two teammates editing the same file. Fix: assign different file sets to each teammate.

14. **Lead implementing instead of delegating.** The lead starts doing tasks itself instead of waiting. Fix: tell the lead to wait.

15. **Too many teammates.** Token costs scale linearly, coordination overhead increases, diminishing returns. Fix: start with 3-5 teammates.

16. **Letting teams run unattended.** Not checking in on progress increases risk of wasted effort. Fix: monitor and steer.

### General Anti-Patterns

17. **Trust-then-verify gap.** Claude produces plausible-looking code that does not handle edge cases. Fix: always provide verification through tests, scripts, or screenshots.

18. **Infinite exploration.** Asking Claude to "investigate" without scoping. Fix: scope narrowly or use subagents.

19. **Jumping straight into code.** Skipping planning creates downstream pain: refactors, unclear PRs, brittle architecture. Fix: use plan mode first.

20. **Over-specified CLAUDE.md.** If it is too long, Claude ignores half of it. Fix: keep it concise, use modular rules in `.claude/rules/`.

---

## 24. Real-World Examples

### Example 1: Code Reviewer (Read-Only)

```markdown
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

### Example 2: Debugger (Full Access)

```markdown
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

### Example 3: Data Scientist (Domain-Specific)

```markdown
---
name: data-scientist
description: Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries.
tools: Bash, Read, Write
model: sonnet
---

You are a data scientist specializing in SQL and BigQuery analysis.

When invoked:
1. Understand the data analysis requirement
2. Write efficient SQL queries
3. Use BigQuery command line tools (bq) when appropriate
4. Analyze and summarize results
5. Present findings clearly

Key practices:
- Write optimized SQL queries with proper filters
- Use appropriate aggregations and joins
- Include comments explaining complex logic
- Format results for readability
- Provide data-driven recommendations

For each analysis:
- Explain the query approach
- Document any assumptions
- Highlight key findings
- Suggest next steps based on data

Always ensure queries are efficient and cost-effective.
```

### Example 4: Database Query Validator (Hook-Protected)

```markdown
---
name: db-reader
description: Execute read-only database queries. Use when analyzing data or generating reports.
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---

You are a database analyst with read-only access. Execute SELECT queries to answer questions about the data.

When asked to analyze data:
1. Identify which tables contain the relevant data
2. Write efficient SELECT queries with appropriate filters
3. Present results clearly with context

You cannot modify data. If asked to INSERT, UPDATE, DELETE, or modify schema, explain that you only have read access.
```

### Example 5: Code Reviewer with Persistent Memory

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
memory: user
---

You are a code reviewer. As you review code, update your agent memory with
patterns, conventions, and recurring issues you discover.
```

### Example 6: Coordinator Agent (Task Spawning Control)

```markdown
---
name: coordinator
description: Coordinates work across specialized agents
tools: Task(worker, researcher), Read, Bash
---

You coordinate work by delegating to worker and researcher agents.
Do not attempt tasks yourself -- always delegate.
```

### Example 7: PR Summary Skill with Dynamic Context

```yaml
---
name: pr-summary
description: Summarize changes in a pull request
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Your task
Summarize this pull request focusing on:
1. What changed and why
2. Potential risks or concerns
3. Testing recommendations
```

### Example 8: Everything Claude Code (13-Agent Framework)

The "everything-claude-code" repository by affaan-m demonstrates a production-ready framework with 13 specialized agents, 50+ skills, 33 commands, and automated hook workflows:

| Agent | Purpose |
|:------|:--------|
| planner | Implementation planning |
| architect | System design and scalability |
| tdd-guide | Test-driven development |
| code-reviewer | Code quality and maintainability |
| security-reviewer | Vulnerability detection |
| build-error-resolver | Fix build/type errors |
| e2e-runner | End-to-end Playwright testing |
| refactor-cleaner | Dead code cleanup |
| doc-updater | Documentation and codemaps |
| go-reviewer | Go code review |
| go-build-resolver | Go build errors |
| database-reviewer | PostgreSQL/Supabase specialist |
| python-reviewer | Python code review |

### Example 9: Agent Team for Competing Hypotheses

```text
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific
debate. Update the findings doc with whatever consensus emerges.
```

### Example 10: Cost-Optimized Fleet (Kaxo Technologies)

Scaling from 4 to 35 agents over 90 days:

- **Meta-agents (17):** Permission management, configuration synchronization, session reporting, error analysis, cost monitoring
- **Domain-specific agents (18):** Specialized for each business domain
- **Cost reduction:** 92% ($542/month to $42/month)
- **Setup time reduction:** 2 hours to 30 minutes per new agent via global context inheritance

---

## 25. Limitations and Known Issues

### Subagent Limitations

1. **Subagents cannot spawn other subagents.** If nested delegation is needed, chain subagents from the main conversation or use Skills.
2. **No conversation history inheritance.** Subagents receive only their system prompt plus basic environment details.
3. **Latency.** Subagents start fresh and may need time to gather context.
4. **Context window consumption.** When subagents complete, their results return to the main conversation and consume context.

### Agent Teams Limitations

5. **Experimental status.** Agent teams are disabled by default and have known issues.
6. **No session resumption** with in-process teammates. `/resume` and `/rewind` do not restore in-process teammates.
7. **Task status can lag.** Teammates sometimes fail to mark tasks as completed, blocking dependent tasks.
8. **Shutdown can be slow.** Teammates finish their current request before shutting down.
9. **One team per session.** Clean up the current team before starting a new one.
10. **No nested teams.** Teammates cannot spawn their own teams.
11. **Lead is fixed.** You cannot promote a teammate to lead.
12. **Permissions set at spawn.** All teammates start with the lead's permission mode.
13. **Split panes require tmux or iTerm2.** Not supported in VS Code terminal, Windows Terminal, or Ghostty.

### Skills Limitations

14. **Context budget.** Many skills may exceed the 2% of context window budget for descriptions. Check `/context` for warnings.
15. **Subagent skills are not inherited.** Subagents do not inherit skills from the parent conversation; you must list them explicitly.

### Hook Limitations

16. **Hooks are snapshots.** Settings files are captured at startup. External changes require review via `/hooks` menu.
17. **Enterprise hooks cannot be disabled.** `disableAllHooks` in user/project settings cannot disable managed hooks.
18. **Command hooks only for WorktreeCreate/WorktreeRemove.** Only `type: "command"` hooks are supported.
19. **HTTP hooks have no blocking error via status code.** Must return 2xx with JSON body to block.

### AGENTS.md Limitations

20. **No formal schema.** The AGENTS.md specification has no YAML frontmatter, no schema for tool restrictions, model overrides, or agent types. It is plain Markdown.
21. **Interpretation varies by tool.** Different agents may interpret the same AGENTS.md differently.

---

## 26. Pros and Cons Assessment

### Subagents

**Pros:**
- Preserve main conversation context
- Enforce tool restrictions and permissions
- Route tasks to cheaper/faster models
- Reusable across projects (user-level agents)
- Persistent memory across conversations
- Background execution for concurrent work
- Isolation via git worktrees

**Cons:**
- Cannot spawn other subagents (no nesting)
- Latency: start fresh, need time to gather context
- No conversation history inheritance
- Results consume main conversation context
- Configuration requires restart (or `/agents`)

### Agent Teams

**Pros:**
- True parallel execution with independent context windows
- Direct inter-agent communication
- Shared task list with self-coordination
- Effective for research, review, and debugging

**Cons:**
- Experimental status with known limitations
- Significantly higher token costs
- No session resumption for in-process teammates
- Coordination overhead increases with team size
- File conflicts when teammates edit same files
- Lead may implement instead of delegating

### Skills

**Pros:**
- Cross-platform via Agent Skills open standard
- Progressive disclosure (descriptions at startup, full content on invocation)
- Dynamic context injection with shell commands
- Supporting files for complex workflows
- Distributable via plugins

**Cons:**
- Context budget limits number of skills
- No schema enforcement (beyond basic frontmatter validation)
- `context: fork` skills cannot access conversation history

### Hooks

**Pros:**
- Four handler types (command, HTTP, prompt, agent)
- Rich decision control (allow, deny, ask, modify input)
- Scoped to skills and agents
- Async support for non-blocking operations
- MCP tool matching

**Cons:**
- Synchronous by default (slow hooks block everything)
- JSON output only on exit 0
- Shell profile can interfere with JSON parsing
- Snapshot-based (external changes require review)

---

## 27. Community Articles and Resources (All URLs)

### Official Documentation

- [Claude Code Overview](https://code.claude.com/docs/en/overview)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)
- [Manage Claude's memory](https://code.claude.com/docs/en/memory)
- [Model configuration](https://code.claude.com/docs/en/model-config)
- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Settings](https://code.claude.com/docs/en/settings)
- [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Using CLAUDE.MD files](https://claude.com/blog/using-claude-md-files)

### Open Standards

- [AGENTS.md Specification](https://agents.md/)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Agent Skills GitHub Repository](https://github.com/agentskills/agentskills)

### Anthropic Engineering Blog

- [Equipping agents for the real world with Agent Skills](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills)

### Community Guides and Blog Posts

- [The Complete Guide to AI Agent Memory Files (CLAUDE.md, AGENTS.md, and Beyond)](https://medium.com/data-science-collective/the-complete-guide-to-ai-agent-memory-files-claude-md-agents-md-and-beyond-49ea0df5c5a9)
- [How I Use Every Claude Code Feature - Shrivu Shankar](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)
- [Claude Agent Skills: A First Principles Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Scaling Claude Code: 4 to 35 Agents in 90 Days - Kaxo](https://kaxo.io/insights/scaling-claude-code-sub-agent-architecture/)
- [Creating the Perfect CLAUDE.md for Claude Code - Dometrain](https://dometrain.com/blog/creating-the-perfect-claudemd-for-claude-code/)
- [Writing a good CLAUDE.md - HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [How to Write a Good CLAUDE.md File - Builder.io](https://www.builder.io/blog/claude-md-guide)
- [My 7 essential Claude Code best practices for production-ready AI](https://www.eesel.ai/blog/claude-code-best-practices)
- [A complete guide to model configuration in Claude Code](https://www.eesel.ai/blog/model-configuration-claude-code)
- [Claude Code Tips: 10 Real Productivity Workflows for 2026](https://www.f22labs.com/blogs/10-claude-code-productivity-tips-for-every-developer/)
- [Claude Code Complete Guide 2026: From Basics to Advanced](https://www.jitendrazaa.com/blog/ai/claude-code-complete-guide-2026-from-basics-to-advanced-mcp-2/)
- [CLI Agents Part 2: Claude Code Best Practices](https://vld-bc.com/blog/cli-agents-part2-claude-code-best-practices)
- [Claude Code Best Practices for Agentic Coding](https://thoughtminds.ai/blog/claude-code-best-practices-for-agentic-coding-in-modern-software-development)
- [Claude Code: The Definitive Technical Reference](https://blakecrosley.com/en/guides/claude-code)
- [A Guide to Claude Code 2.0 and getting better at using coding agents](https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents/)
- [How to Use Claude Code: A Guide to Slash Commands, Agents, Skills, and Plug-ins](https://www.producttalk.org/how-to-use-claude-code-features/)
- [Optimizing Agentic Coding: How to Use Claude Code in 2026?](https://aimultiple.com/agentic-coding)
- [Configure Claude Code to Power Your Agent Team](https://medium.com/@haberlah/configure-claude-code-to-power-your-agent-team-90c8d3bca392)
- [Custom agents with Claude Code and Otto](https://www.ascend.io/blog/custom-agents-with-claude-code-and-otto)
- [Claude Code Plugins: The Complete Guide to the Extension System 2025](https://www.contextstudios.ai/blog/claude-code-plugins-the-complete-guide-to-the-extension-system-2025)
- [Claude Code Plugins: Best Plugins, Installation & Build Guide 2026](https://www.morphllm.com/claude-code-plugins)
- [What is the --agent Flag in Claude Code - ClaudeLog](https://claudelog.com/faqs/what-is-agent-flag-in-claude-code/)
- [How to Change Claude Code Model - ClaudeLog](https://claudelog.com/faqs/how-to-change-claude-code-model/)
- [Claude Code Models: Choose the Right AI for Every Task](https://claudefa.st/blog/models/model-selection)
- [Which Claude Model Is Best for Coding: Opus vs Sonnet vs Haiku](https://www.dataannotation.tech/developers/which-claude-model-is-best-for-coding)
- [Claude Code - Best Practices - SFEIR Institute](https://institute.sfeir.com/en/claude-code/claude-code-resources/best-practices/)
- [The CLAUDE.md Memory System - Deep Dive - SFEIR Institute](https://institute.sfeir.com/en/claude-code/claude-code-memory-system-claude-md/deep-dive/)
- [The CLAUDE.md Memory System - Optimization Guide - SFEIR Institute](https://institute.sfeir.com/en/claude-code/claude-code-memory-system-claude-md/optimization/)
- [The CLAUDE.md Memory System - Tips - SFEIR Institute](https://institute.sfeir.com/en/claude-code/claude-code-memory-system-claude-md/tips/)
- [You (probably) don't understand Claude Code memory](https://joseparreogarcia.substack.com/p/claude-code-memory-explained)
- [Claude Code's Memory: Working with AI in Large Codebases](https://thomaslandgraf.substack.com/p/claude-codes-memory-working-with)
- [Claude Code Memory - Teaching Claude Your Project's DNA](https://medium.com/@luongnv89/claude-code-memory-teaching-claude-your-projects-dna-45c4beca6121)
- [Project Memory (CLAUDE.md) - Claude Code for Product Managers](https://ccforpms.com/fundamentals/project-memory)
- [Agent Skills Overview 2026](https://www.claudepluginhub.com/skills/jamie-bitflight-plugin-creator-plugins-plugin-creator-2/claude-skills-overview-2026)
- [Agent Skills: Why SKILL.md Won't Load + Fix Guide](https://smartscope.blog/en/blog/agent-skills-guide/)
- [What Are Agent Skills and How To Use Them - Strapi](https://strapi.io/blog/what-are-agent-skills-and-how-to-use-them)
- [Building Agent Skills from Scratch - DEV Community](https://dev.to/onlyoneaman/building-agent-skills-from-scratch-lbl)
- [Agent Skills: The Open Standard for AI Capabilities](https://inference.sh/blog/skills/agent-skills-overview)
- [Agent Skills - Simon Willison](https://simonwillison.net/2025/Dec/19/agent-skills/)
- [Use Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [Shipyard: Claude Code CLI Cheatsheet](https://shipyard.build/blog/claude-code-cheat-sheet/)

### GitHub Repositories

- [everything-claude-code (affaan-m)](https://github.com/affaan-m/everything-claude-code) -- Complete Claude Code configuration collection with 13 agents, 50+ skills, 33 commands
- [awesome-claude-code-subagents (VoltAgent)](https://github.com/VoltAgent/awesome-claude-code-subagents) -- 100+ specialized Claude Code subagents
- [awesome-claude-code (hesreallyhim)](https://github.com/hesreallyhim/awesome-claude-code) -- Curated list of skills, hooks, commands, agent orchestrators, and plugins
- [claude-code-config (Trail of Bits)](https://github.com/trailofbits/claude-code-config) -- Opinionated defaults and workflows for Claude Code
- [claude-code-best-practices (awattar)](https://github.com/awattar/claude-code-best-practices) -- Best practices and examples
- [claude-code-settings (feiskyer)](https://github.com/feiskyer/claude-code-settings) -- Settings, commands, and agents for vibe coding
- [agents (wshobson)](https://github.com/wshobson/agents) -- Intelligent automation and multi-agent orchestration
- [claude-code-system-prompts (Piebald-AI)](https://github.com/Piebald-AI/claude-code-system-prompts) -- System prompts including agent prompt
- [agentskills (agentskills)](https://github.com/agentskills/agentskills) -- Official Agent Skills specification and documentation

### Ecosystem Resources

- [ClaudeLog - Docs, Guides, Tutorials](https://claudelog.com/)
- [Nader Dabit - The Complete Guide to Building Agents with Claude Agent SDK](https://nader.substack.com/p/the-complete-guide-to-building-agents)
- [Model Comparison and Selection Strategy - DeepWiki](https://deepwiki.com/FlorianBruniaux/claude-code-ultimate-guide/11.1-tier-1:-strategic-orchestration)

---

## 28. Official Documentation Links

| Topic | URL |
|:------|:----|
| Sub-agents | https://code.claude.com/docs/en/sub-agents |
| Skills | https://code.claude.com/docs/en/skills |
| Hooks reference | https://code.claude.com/docs/en/hooks |
| Hooks guide | https://code.claude.com/docs/en/hooks-guide |
| Agent teams | https://code.claude.com/docs/en/agent-teams |
| Memory (CLAUDE.md) | https://code.claude.com/docs/en/memory |
| Model configuration | https://code.claude.com/docs/en/model-config |
| Plugins | https://code.claude.com/docs/en/plugins |
| Permissions | https://code.claude.com/docs/en/permissions |
| Settings | https://code.claude.com/docs/en/settings |
| CLI reference | https://code.claude.com/docs/en/cli-reference |
| AGENTS.md standard | https://agents.md/ |
| Agent Skills spec | https://agentskills.io/specification |
| Full documentation index | https://code.claude.com/docs/llms.txt |

---

## 29. Sources

All information in this paper was gathered from the following categories of sources:

**Primary Sources (Official Documentation):**
- Claude Code documentation at code.claude.com/docs
- Agent Skills specification at agentskills.io
- AGENTS.md specification at agents.md
- Anthropic engineering blog posts

**Community Sources:**
- GitHub repositories with agent configurations and best practices
- Blog posts and technical articles from practitioners
- Stack-level guides from SFEIR Institute, Builder.io, HumanLayer, and others

**Production Case Studies:**
- Kaxo Technologies: Scaling from 4 to 35 agents over 90 days with 92% cost reduction
- everything-claude-code (affaan-m): 13-agent, 50-skill production framework
- Trail of Bits claude-code-config: Security-focused opinionated defaults

---

*Research compiled 2026-02-28. Claude Code agents ecosystem is actively evolving; check official documentation for the latest features and changes.*
