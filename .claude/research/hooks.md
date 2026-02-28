# Claude Code Hooks: Complete Reference

## 1. All Hook Event Types (17 Total)

| # | Event | When It Fires | Supports Matchers? |
|---|-------|---------------|-------------------|
| 1 | **SessionStart** | Session begins, resumes, after compaction or `/clear` | Yes — `startup`, `resume`, `clear`, `compact` |
| 2 | **UserPromptSubmit** | User submits a prompt, before Claude processes it | No — always fires |
| 3 | **PreToolUse** | Before a tool call executes (can block/modify) | Yes — tool name |
| 4 | **PermissionRequest** | When a permission dialog is about to show | Yes — tool name |
| 5 | **PostToolUse** | After a tool call completes successfully | Yes — tool name |
| 6 | **PostToolUseFailure** | After a tool call fails | Yes — tool name |
| 7 | **Notification** | When Claude Code sends a notification | Yes — `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| 8 | **SubagentStart** | When a subagent is spawned | Yes — agent type |
| 9 | **SubagentStop** | When a subagent finishes | Yes — agent type |
| 10 | **Stop** | When the main Claude agent finishes responding | No — always fires |
| 11 | **TeammateIdle** | When a team teammate is about to go idle | No — always fires |
| 12 | **TaskCompleted** | When a task is being marked as completed | No — always fires |
| 13 | **ConfigChange** | When a configuration file changes during session | Yes — `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| 14 | **WorktreeCreate** | When a worktree is being created | No — always fires |
| 15 | **WorktreeRemove** | When a worktree is being removed | No — always fires |
| 16 | **PreCompact** | Before context compaction | Yes — `manual`, `auto` |
| 17 | **SessionEnd** | When a session terminates | Yes — `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |

---

## 2. Hook Configuration — Full Schema

### 2.1 Configuration File Locations (Scope Hierarchy)

| Location | Scope | Shareable? |
|----------|-------|-----------|
| `~/.claude/settings.json` | All projects (user-level) | No, local to machine |
| `.claude/settings.json` | Single project (shared) | Yes, commit to repo |
| `.claude/settings.local.json` | Single project (local) | No, gitignored |
| Managed policy settings | Organization-wide | Yes, admin-controlled |
| Plugin `hooks/hooks.json` | When plugin is enabled | Yes, bundled with plugin |
| Skill or agent YAML frontmatter | While skill/agent is active | Yes, defined in component |

### 2.2 Full JSON Schema

```json
{
  "hooks": {
    "<EventName>": [
      {
        "matcher": "<regex-string>",
        "hooks": [
          {
            // Common fields (all types)
            "type": "command" | "http" | "prompt" | "agent",
            "timeout": 600,
            "statusMessage": "Custom spinner message...",
            "once": true,  // skills only: run once per session

            // Command hook fields
            "command": "shell-command-here",
            "async": true,  // run in background, non-blocking

            // HTTP hook fields
            "url": "http://localhost:8080/hooks/endpoint",
            "headers": { "Authorization": "Bearer $MY_TOKEN" },
            "allowedEnvVars": ["MY_TOKEN"],

            // Prompt hook fields
            "prompt": "Evaluate if: $ARGUMENTS",
            "model": "claude-haiku-4-5-20250901",

            // Agent hook fields
            "prompt": "Verify tests pass: $ARGUMENTS",
            "model": "claude-sonnet-4-6"
          }
        ]
      }
    ]
  },
  "disableAllHooks": false
}
```

### 2.3 Hook Types

| Type | What It Does | Default Timeout |
|------|-------------|----------------|
| `command` | Runs a shell command | 600s (10 min) |
| `prompt` | Sends a prompt to an LLM (no tool access) | 30s |
| `agent` | Spawns a sub-agent with tool access (up to 50 tool turns) | 60s |
| `http` | Sends an HTTP request to a URL | 30s |

### 2.4 Which Events Support Which Types

**All four types** (`command`, `http`, `prompt`, `agent`):
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`
- `Stop`, `SubagentStop`, `TaskCompleted`, `UserPromptSubmit`

**Only `type: "command"`**:
- `ConfigChange`, `Notification`, `PreCompact`, `SessionEnd`, `SessionStart`
- `SubagentStart`, `TeammateIdle`, `WorktreeCreate`, `WorktreeRemove`

---

## 3. Hook Inheritance and Sub-Agents

### 3.1 Sub-Agent Behavior

Sub-agents **do inherit** project-level hooks from the parent session's settings files (they load the same `.claude/settings.json` and `.claude/settings.local.json`).

Key points:
- Sub-agents inherit the permission context from the main conversation
- Sub-agents can have their own scoped hooks via YAML frontmatter in agent definition files (`.claude/agents/<name>.md`)
- For sub-agents, `Stop` hooks defined in frontmatter are auto-converted to `SubagentStop` hooks
- **Danger**: Inheritance can cause infinite loops if a Stop hook calls a sub-agent that fires its own Stop hook. Prevention: check `stop_hook_active`

### 3.2 Agent Teams

- Teammates load the **same project context** (including `.claude/settings.json` hooks)
- Teammates do **not** inherit the lead's conversation history
- `TeammateIdle` hook fires specifically for agent team members
- `TaskCompleted` hook fires when any agent marks a task as completed
- Task files on disk and `SendMessage` are the only coordination channels

### 3.3 Skill/Agent Frontmatter Hooks

Hooks in skill or agent YAML frontmatter are **scoped to that component's lifecycle** — they only run while active:

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
          once: true  # only in skills, not agents
---
```

---

## 4. Exit Codes and Decision Control

### 4.1 Exit Codes

| Exit Code | Meaning | Effect |
|-----------|---------|--------|
| **0** | Success | Action proceeds. stdout parsed for JSON or added as context |
| **2** | Blocking error | Action is blocked. stderr fed back to Claude as feedback |
| **Any other** | Non-blocking error | Action proceeds. stderr shown only in verbose mode |

### 4.2 Decision Control by Event

| Events | Decision Pattern | Key Fields |
|--------|-----------------|------------|
| `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStop`, `ConfigChange` | Top-level `decision` | `decision: "block"`, `reason` |
| `TeammateIdle`, `TaskCompleted` | Exit code only | Exit 2 blocks; stderr is feedback |
| `PreToolUse` | `hookSpecificOutput` | `permissionDecision` (`allow`/`deny`/`ask`), `permissionDecisionReason`, `updatedInput`, `additionalContext` |
| `PermissionRequest` | `hookSpecificOutput` | `decision.behavior` (`allow`/`deny`), `decision.updatedInput`, `decision.updatedPermissions`, `decision.message`, `decision.interrupt` |
| `WorktreeCreate` | stdout path | Print absolute path; non-zero exit = failure |
| `WorktreeRemove`, `Notification`, `SessionEnd`, `PreCompact` | None | Side-effects only |

---

## 5. Context Injection

These events can inject context that Claude sees and acts on:

| Event | How to Inject |
|-------|--------------|
| `SessionStart` | stdout (plain text) or `additionalContext` in JSON |
| `UserPromptSubmit` | stdout (plain text) or `additionalContext` in JSON |
| `SubagentStart` | `additionalContext` via `hookSpecificOutput` wrapper — injected into sub-agent's context (see caveat below) |
| `PreToolUse` | `additionalContext` — added before tool execution |
| `PostToolUse` | `additionalContext` — added after tool execution |
| `PostToolUseFailure` | `additionalContext` — added alongside error |
| `Notification` | `additionalContext` — added to conversation context |

### SubagentStart hookSpecificOutput Format

The correct JSON format for SubagentStart context injection requires the `hookSpecificOutput` wrapper:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Your instructions for the sub-agent here"
  }
}
```

**Important:** Bare `{"additionalContext": "..."}` without the wrapper does NOT work. Both formats were tested in lab conditions (see Section 32: Real-World Findings).

**Lab-tested caveat (2026-02-28):** Despite using the correct `hookSpecificOutput` wrapper format, SubagentStart `additionalContext` injection was **not reliably observed** in testing. Across 3 independent tests and 8 hook firings, the hook fired every time and produced correct JSON output, but the sub-agent never received the context (0/8 success rate). This matches independent findings in obra/superpowers#237. See Section 32 for full details.

---

## 6. Input Modification

### PreToolUse — Modify Before Execution

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "command": "npm run lint -- --fix"
    }
  }
}
```

### PostToolUse — Replace MCP Tool Output

Can replace MCP tool output via `updatedMCPToolOutput`.

---

## 7. Environment Variables

| Variable | Description | Available In |
|----------|-------------|-------------|
| `$CLAUDE_PROJECT_DIR` | Project root directory | All hooks (but see caveat below) |
| `${CLAUDE_PLUGIN_ROOT}` | Plugin root directory | Plugin hooks |
| `$CLAUDE_ENV_FILE` | File path for persisting env vars across session | `SessionStart` only |
| `$CLAUDE_CODE_REMOTE` | `"true"` in remote web environments | All hooks |

**Known issue ([#26429](https://github.com/anthropics/claude-code/issues/26429)):** `$CLAUDE_PROJECT_DIR` is empty/unset in subagent environments. Hooks that rely on this variable for file paths will fail silently when fired inside subagents. Workaround: use `$PWD` or hardcode the project path in hook scripts.

---

## 8. Common Input Fields (stdin JSON)

Every hook receives:

| Field | Description |
|-------|-------------|
| `session_id` | Current session identifier |
| `transcript_path` | Path to conversation JSONL file |
| `cwd` | Current working directory |
| `permission_mode` | Current mode: `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` |
| `hook_event_name` | Name of the event that fired |

---

## 9. Event-Specific Input Schemas

### SessionStart
`source` (`startup`/`resume`/`clear`/`compact`), `model`, `agent_type` (optional)

### UserPromptSubmit
`prompt` (the text submitted)

### PreToolUse / PostToolUse / PostToolUseFailure / PermissionRequest
`tool_name`, `tool_input` (varies by tool), `tool_use_id`

**Tool input schemas by tool:**
- **Bash**: `command`, `description`, `timeout`, `run_in_background`
- **Write**: `file_path`, `content`
- **Edit**: `file_path`, `old_string`, `new_string`, `replace_all`
- **Read**: `file_path`, `offset`, `limit`
- **Glob**: `pattern`, `path`
- **Grep**: `pattern`, `path`, `glob`, `output_mode`, `-i`, `multiline`
- **WebFetch**: `url`, `prompt`
- **WebSearch**: `query`, `allowed_domains`, `blocked_domains`
- **Task**: `prompt`, `description`, `subagent_type`, `model`

`PostToolUse` also receives `tool_response`.
`PostToolUseFailure` also receives `error` and `is_interrupt`.

### Stop / SubagentStop
`stop_hook_active` (boolean — critical for loop prevention), `last_assistant_message`

`SubagentStop` also: `agent_id`, `agent_type`, `agent_transcript_path`

### TeammateIdle
`teammate_name`, `team_name`

### TaskCompleted
`task_id`, `task_subject`, `task_description` (optional), `teammate_name` (optional), `team_name` (optional)

### ConfigChange
`source` (configuration type), `file_path` (optional)

### WorktreeCreate
`name` (slug identifier)

### WorktreeRemove
`worktree_path` (absolute path)

### PreCompact
`trigger` (`manual`/`auto`), `custom_instructions`

### SessionEnd
`reason` (`clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other`)

### Notification
`message`, `title` (optional), `notification_type`

### SubagentStart
`agent_id`, `agent_type`

---

## 10. Matcher System

### Syntax

Matchers are **regex strings** (not globs), case-sensitive.

| Pattern | Matches |
|---------|---------|
| `Bash` | Exact match on "Bash" |
| `Edit\|Write` | Either "Edit" or "Write" |
| `Notebook.*` | Any tool starting with "Notebook" |
| `mcp__github__.*` | All tools from "github" MCP server |
| `mcp__.*__write.*` | Any MCP tool containing "write" |
| `""` or `"*"` or omitted | Match everything |

### Built-in Tool Names (Matchable)

`Bash`, `Read`, `Edit`, `MultiEdit`, `Write`, `Glob`, `Grep`, `LS`, `WebFetch`, `WebSearch`, `Task`, `NotebookRead`, `NotebookEdit`, `TodoRead`, `TodoWrite`, `exit_plan_mode`

### MCP Tool Naming

Pattern: `mcp__<server>__<tool>` (e.g., `mcp__memory__create_entities`)

---

## 11. Universal JSON Output Fields

| Field | Default | Description |
|-------|---------|-------------|
| `continue` | `true` | If `false`, Claude stops processing entirely |
| `stopReason` | none | Message shown when `continue` is `false` |
| `suppressOutput` | `false` | Hides stdout from verbose mode |
| `systemMessage` | none | Warning message shown to user |

---

## 12. Limitations and Gotchas

### Core Limitations

1. **No undo**: `PostToolUse` fires after execution. Cannot undo writes/edits.
2. **No slash command invocation**: Hooks communicate only through stdout, stderr, exit codes.
3. **PermissionRequest hooks do NOT fire in headless mode** (`-p`/`--print`). Use `PreToolUse` instead.
4. **Stop hooks fire on every stop, not just task completion**. Do NOT fire on Ctrl+C.
5. **Async hooks cannot block or return decisions** — action has already proceeded.
6. **Async hooks only work with `type: "command"`** — prompt and agent hooks cannot be async.
7. **Each async execution creates a separate background process** with no deduplication.
8. **Async hook output delivered on next conversation turn**. If idle, waits for user interaction.
9. **Policy settings ConfigChange events cannot be blocked**.
10. **WorktreeCreate and WorktreeRemove only support `type: "command"`**.
11. **The `once` field only works in skills**, not agents or settings-level hooks.
12. **SubagentStart `additionalContext` does not reliably inject** ([#237 obra/superpowers](https://github.com/obra/superpowers/issues/237)) — hook fires, JSON outputs correctly, but sub-agent never receives context. Lab tested: 0/8 success rate across 3 sessions. Both bare `additionalContext` and `hookSpecificOutput` wrapper formats failed.
13. **SubagentStop cannot return context to parent** ([#5812](https://github.com/anthropics/claude-code/issues/5812)) — feature requested but not implemented. Hook output does not appear in parent conversation context.
14. **TaskCompleted uses exit codes only** — no `additionalContext`, no JSON control. Exit 2 sends stderr as feedback. Cannot inject context into the completing agent; only useful for side effects (file logging, notifications).
15. **PreToolUse cannot block the Task tool** ([#26923](https://github.com/anthropics/claude-code/issues/26923)) — Task tool spawned agents ignore PreToolUse and SubagentStart block attempts. Can only inject context, not prevent spawning.
16. **SubagentStop prompt hooks cannot prevent termination** ([#20221](https://github.com/anthropics/claude-code/issues/20221)) — subagent gets feedback but never gets another turn. Subagent terminates regardless of hook output.
17. **`$CLAUDE_PROJECT_DIR` empty in subagent environments** ([#26429](https://github.com/anthropics/claude-code/issues/26429)) — hooks that depend on this variable fail silently in subagent contexts.
18. **Context duplication bug** ([#14281](https://github.com/anthropics/claude-code/issues/14281)) — `additionalContext` appears twice in some configurations. Claimed fixed in v2.1 but may persist in edge cases.

### Known Issues (GitHub)

| Issue | URL | Description | Status |
|-------|-----|-------------|--------|
| #5812 | [link](https://github.com/anthropics/claude-code/issues/5812) | SubagentStop cannot return context to parent | Open — feature not implemented |
| #26923 | [link](https://github.com/anthropics/claude-code/issues/26923) | PreToolUse/SubagentStart cannot block Task tool | Open — by design |
| #20221 | [link](https://github.com/anthropics/claude-code/issues/20221) | SubagentStop prompt hooks don't prevent termination | Open |
| #7881 | [link](https://github.com/anthropics/claude-code/issues/7881) | Hook execution reliability issues in concurrent sessions | Open |
| #26429 | [link](https://github.com/anthropics/claude-code/issues/26429) | CLAUDE_PROJECT_DIR empty in subagent environments | Open |
| #14281 | [link](https://github.com/anthropics/claude-code/issues/14281) | additionalContext appears twice (context duplication) | Claimed fixed v2.1 |
| #10373 | [link](https://github.com/anthropics/claude-code/issues/10373) | Hook stdin JSON parsing failures on certain platforms | Open |
| #13650 | [link](https://github.com/anthropics/claude-code/issues/13650) | SubagentStart hook timing race conditions | Open |
| #11906 | [link](https://github.com/anthropics/claude-code/issues/11906) | Hook output not visible in non-verbose mode | Open |
| #16538 | [link](https://github.com/anthropics/claude-code/issues/16538) | Async hook result delivery unreliable across session boundaries | Open |
| #10814 | [link](https://github.com/anthropics/claude-code/issues/10814) | Claude Code Hooks Regression | Open |
| #3523 | [link](https://github.com/anthropics/claude-code/issues/3523) | Progressive Hook Duplication (10+ simultaneous processes) | Documented fix, workaround recommended |

### Critical Gotchas

**Infinite Stop Hook Loop**: Most common mistake. Stop hook blocks Claude → Claude tries to stop again → blocked again → infinite loop.

**Always check `stop_hook_active`:**

```bash
INPUT=$(cat)
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0  # Allow Claude to stop on second attempt
fi
```

**Shell Profile Contamination**: Hook commands source `~/.zshrc` or `~/.bashrc`. Unconditional `echo` statements pollute stdout and break JSON parsing. Wrap them:

```bash
if [[ $- == *i* ]]; then
  echo "Shell ready"  # Only in interactive shells
fi
```

**Hooks Don't Take Effect Immediately on File Edit**: Claude takes a snapshot at startup. Edits to `settings.json` while running require review in `/hooks` menu or session restart. Security measure.

**Sub-Agent Hook Inheritance**: Can create unexpected loops. Use `disableAllHooks: true` in separate settings to avoid.

**Deprecated PreToolUse Fields**: `decision` and `reason` at top level are deprecated. Use `hookSpecificOutput.permissionDecision` and `hookSpecificOutput.permissionDecisionReason`. Old `"approve"`/`"block"` map to `"allow"`/`"deny"`.

---

## 13. Security

### CVE-2025-59536
Code injection vulnerability — hooks in `.claude/settings.json` (project-level, repo-controlled) executed shell commands on any collaborator's machine without permission. Fixed in v1.0.111 (October 2025).

### CVE-2026-21852
Information disclosure — malicious `ANTHROPIC_BASE_URL` in project settings could redirect API requests, leaking API keys. Fixed in v2.0.65 (January 2026).

**Key takeaway**: Project-level hooks are executable code. Review them like scripts in code reviews.

---

## 14. Advanced Patterns

### Context Re-Injection After Compaction

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "compact",
      "hooks": [{
        "type": "command",
        "command": "echo 'Reminder: use Bun not npm. Run bun test before committing.'"
      }]
    }]
  }
}
```

### Environment Variable Persistence

```bash
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=production' >> "$CLAUDE_ENV_FILE"
  echo 'export PATH="$PATH:./node_modules/.bin"' >> "$CLAUDE_ENV_FILE"
fi
```

### LLM-as-a-Judge with Prompt Hooks

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "prompt",
        "prompt": "Analyze the conversation. Are all user-requested tasks complete? Respond {\"ok\": true} or {\"ok\": false, \"reason\": \"what remains\"}.",
        "model": "claude-haiku-4-5-20250901"
      }]
    }]
  }
}
```

### Agent Hooks for Deep Verification

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "agent",
        "prompt": "Verify all modified files have corresponding test coverage.",
        "timeout": 120
      }]
    }]
  }
}
```

### Auto-Formatting with PostToolUse

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write"
      }]
    }]
  }
}
```

### MCP Tool Auditing

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "mcp__.*",
      "hooks": [{
        "type": "command",
        "command": "jq -c '{tool: .tool_name, time: now}' >> ~/mcp-audit.log"
      }]
    }]
  }
}
```

### Input Rewriting for Safety

PreToolUse hooks can transparently sanitize commands before execution via `updatedInput`.

### Async Background Testing

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/run-tests-async.sh",
        "async": true,
        "timeout": 300
      }]
    }]
  }
}
```

### Multi-Agent Observability

Use hooks across `SubagentStart`, `SubagentStop`, `TeammateIdle`, and `TaskCompleted` to build monitoring dashboards. Note: `SubagentStart` hook's `additionalContext` is documented as being injected into the sub-agent's context, but lab testing shows this is unreliable (0/8 success rate — see Section 32). For reliable instruction delivery, use agent definition files or the filesystem relay pattern instead.

### Configuration Change Auditing

```json
{
  "hooks": {
    "ConfigChange": [{
      "hooks": [{
        "type": "command",
        "command": "jq -c '{timestamp: now | todate, source: .source, file: .file_path}' >> ~/claude-config-audit.log"
      }]
    }]
  }
}
```

### PermissionRequest Auto-Approval with Persistence

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        { "type": "toolAlwaysAllow", "tool": "Bash" }
      ]
    }
  }
}
```

---

## 15. Debugging Hooks

| Method | How |
|--------|-----|
| Verbose mode | `Ctrl+O` during session to see hook output |
| Debug mode | `claude --debug` for full execution details |
| Manual testing | `echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' \| ./my-hook.sh; echo $?` |
| `/hooks` menu | Type `/hooks` to view, add, delete hooks interactively |

---

## 16. Best Practices

1. **Always check `stop_hook_active`** in Stop hooks to prevent infinite loops
2. **Use `PreToolUse` over `PermissionRequest`** for automated decisions — PermissionRequest doesn't fire in headless mode
3. **Keep hook commands fast** — slow hooks block the entire session
4. **Use `async: true`** for non-blocking operations (logging, testing)
5. **Test hooks manually** before deploying — pipe sample JSON to your script
6. **Scope hooks narrowly** with matchers — don't match everything unless needed
7. **Never commit sensitive data** in project-level hooks
8. **Combine deny rules with PreToolUse hooks** for reliable blocking (deny rules have known regressions)
9. **Do NOT rely on `SubagentStart` additionalContext** for critical instruction injection — lab tested at 0/8 success rate ([#237 obra/superpowers](https://github.com/obra/superpowers/issues/237)). Use agent definition files, skills, or the filesystem relay pattern instead (see Section 32)
10. **Use `SessionStart` compact matcher** to re-inject critical context after compaction

---

---

# PART 2: Best Practices, Use Cases & Practical Guide

---

## 17. Best Practices — What Makes a Great Hook

### Blocking Strategy

**Block at submit time, not write time.** The most impactful pattern is `block-at-submit`: avoid blocking at every write (which creates constant context pollution as Claude gets blocked-then-fixed patterns), instead let Claude finish its plan first, then validate the final result with a Stop hook.

**Why?** After being blocked 3-4 times on the same issue in a session, Claude's context window fills with examples of blocked-and-fixed code. It mimics those patterns in future writes. This is **context accumulation, not learning** — the effect resets completely across sessions. So the first few files always trigger more blocks. Better to let Claude work, then verify.

### Hook Sequencing Rules

1. **Command hooks** run first (deterministic, instant)
2. **Prompt hooks** run next (semantic evaluation)
3. **Agent hooks** run last (deep verification with tool access)

If a command hook blocks (exit 2), the prompt hook doesn't run. This creates a deterministic pipeline.

### Deterministic Control Philosophy

Hooks are **guarantees**, not suggestions. Unlike prompting Claude to remember to lint, a PostToolUse hook runs **every single time** without exceptions. This is why hooks are critical in enterprise repos — they're the "must-do" rules that complement CLAUDE.md's "should-do" suggestions.

### Timeout Tuning

- **120-300 seconds** for dependency checks on SessionStart
- **30-60 seconds** for quick git status checks in Stop hooks
- **30-60 seconds** for notifications after PostToolUse
- **600 seconds** (10 minutes) is the default for command hooks

If your hook consistently hits timeout, migrate it to async.

### Use Async for Side Effects

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npm run test",
            "async": true,
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

Async hooks fire, and Claude continues working. Results are delivered on the next turn if the hook produces `systemMessage` or `additionalContext`. Only **command hooks** support async — prompt and agent hooks cannot.

### Formatting is the Highest-Value Hook

PostToolUse + Edit|Write + Prettier/Biome = instant ROI. No context cost, guaranteed consistency, fire-and-forget.

---

## 18. Pros and Cons — Honest Assessment

### What Hooks Are Genuinely Good At

**Pros:**
- **Deterministic automation** — guaranteed to run every time, unlike LLM-based suggestions
- **Side effects without context pollution** — logging, metrics, notifications don't bloat the session
- **Blocking before disaster** — PreToolUse is the only event that can stop tool calls before execution
- **Context injection at scale** — PreCompact hooks can preserve critical work across compaction events
- **Low latency for formatting** — 50-100ms overhead per file edit; native linters are instant
- **Git workflow enforcement** — block commits without tests, without relying on Claude's memory
- **Scaling to teams** — shared .claude/settings.json in repo means all team members get the same guardrails

### What Hooks Fall Short On

**Cons:**
- **Cannot run async prompt/agent hooks** — only command hooks support `async: true`
- **stdout only shows in verbose mode** — unless it's UserPromptSubmit or SessionStart (then stdout becomes context)
- **Timeouts kill the session** — a 10-minute hook blocks everything; better to use background subshells
- **Performance can degrade** — bugs have caused hooks to duplicate (up to 10+ simultaneous processes), adding 600ms+ per write
- **Debugging is manual** — toggle Ctrl+O for verbose mode, read stderr, test hooks with piped JSON
- **Cannot trigger other tools directly** — hooks communicate via exit codes and JSON, not by calling Bash/Read/etc
- **Shell profile pollution** — unconditional `echo` statements in ~/.zshrc break JSON output
- **No native HTTP retry logic** — HTTP hooks fail on connection errors (non-blocking), with no retry
- **Exit code 2 only means "block"** — no nuance; you can't say "warn but proceed" at the framework level

---

## 19. Strengths vs. Alternatives Comparison

### Hooks vs. CLAUDE.md
- **CLAUDE.md:** persistent context Claude can read and act on; loaded every session
- **Hooks:** deterministic actions Claude cannot forget or ignore; run transparently
- **Best combo:** CLAUDE.md for "here's how we do things," hooks for "you cannot do this"

### Hooks vs. Skills
- **Skills:** auto-invoked knowledge providers; Claude decides when to load them
- **Hooks:** automatic actions at specific lifecycle points; no decision needed
- **Best combo:** Skills for capabilities (e.g., "API design patterns"), hooks for guardrails (e.g., "no rm -rf")

### Hooks vs. Subagents
- **Subagents:** isolated workers with their own context and tool permissions
- **Hooks:** lightweight actions that run in the main session context
- **Performance:** hooks are much faster for simple checks; subagents add 5-10 seconds
- **Best combo:** hooks for formatting, subagents for complex investigation

### Hooks vs. Direct Prompting
- **Prompting:** "Claude, please always format your code" = unreliable
- **Hooks:** guaranteed formatting with `PostToolUse` + `prettier --write` = 100% compliance
- **Cost:** hooks are cheaper (shell scripts vs. LLM tokens)
- **Best combo:** hooks for rules, prompts for context

### Comparison Table

| Task | Hooks | Skills | Subagents | Direct Prompt |
|------|-------|--------|-----------|---------------|
| **Format after write** | Best | N/A | Overkill | Wastes tokens |
| **Block dangerous commands** | Best | N/A | Slow | Unreliable |
| **Inject context on session start** | Good (async limitation) | Good | Overkill | Unreliable |
| **Verify semantic correctness** | Prompt hooks only | Better | Better | Wastes tokens |
| **Complex multi-turn verification** | Slow (agent hooks) | Better | Best | N/A |
| **Reusable knowledge base** | N/A | Best | OK | N/A |
| **Isolated task delegation** | N/A | N/A | Best | Wastes context |

---

## 20. Complete Range of Use Cases (40+)

### Frontend & Code Quality

1. **Auto-formatting** — PostToolUse + Edit|Write + Prettier: instant code consistency
2. **Linting enforcement** — ESLint, Biome, Stylelint on every write with --fix
3. **Type checking** — tsc --noEmit before commit
4. **Unused imports cleanup** — ts-unused-exports or eslint-plugin-unused-imports
5. **Component test generation** — auto-scaffold tests alongside component creation

### Backend & Infrastructure

6. **Pre-commit security scanning** — PreToolUse + Bash(git commit) → run SAST (Semgrep, Snyk)
7. **Docker image validation** — block Dockerfiles that don't follow organization standards
8. **Database migration verification** — block schema changes without rollback scripts
9. **API endpoint documentation** — auto-generate OpenAPI after route changes
10. **Configuration drift detection** — compare deployed config with repo on every Stop

### Testing & CI/CD

11. **Block commits without passing tests** — PreToolUse matcher on git commit, check /tmp/test-pass file
12. **Async test execution** — PostToolUse + async:true runs full test suite in background
13. **Coverage threshold enforcement** — block commits if coverage < 80%
14. **Integration test triggers** — PostToolUse on docker-compose changes triggers e2e tests
15. **Flaky test detection** — log test results; alert if pass rate drops

### DevOps & Deployment

16. **Terraform plan validation** — block terraform apply without plan review
17. **Helm chart dry-run** — validate Kubernetes manifests before commit
18. **Configuration secret scanning** — prevent leaking API keys, tokens, credentials
19. **Deployment readiness checks** — verify all dependencies are available before deploy
20. **Multi-region consistency** — validate infrastructure parity across regions

### Documentation & Knowledge Management

21. **README auto-update** — PreCompact hook that regenerates README TOC before compaction
22. **Changelog generation** — PostToolUse + Bash(git commit) generates conventional changelog
23. **Architecture decision records** — PostToolUse creates ADR template when docs/ changes
24. **API doc sync** — auto-update Postman/Swagger after endpoint changes

### Monitoring & Observability

25. **Session activity logging** — PostToolUse hook logs all tool calls to audit trail
26. **Agent team observability** — TeammateIdle + TaskCompleted hooks send metrics to Datadog/Prometheus
27. **Cost tracking** — SessionEnd hook logs token usage to cost tracking system
28. **Email notifications** — UserPromptSubmit hook sends digest of progress to stakeholders
29. **Slack integration** — async hook posts session summaries to Slack channels

### Compliance & Security

30. **Audit logging** — ConfigChange hook logs all setting modifications with timestamp
31. **PII detection** — block writes containing credit cards, SSNs, API keys
32. **License compliance** — block adding dependencies with GPL/AGPL licenses
33. **Code ownership enforcement** — block edits to files without codeowner approval

### Data & ML

34. **Dataset validation** — block model training if data schema has changed
35. **Feature store sync** — PostToolUse updates feature store when feature definitions change
36. **Experiment tracking** — log hyperparameters and metrics to MLflow on SessionEnd

### Team & Enterprise

37. **Onboarding enforcement** — SessionStart hook ensures developer has required tools installed
38. **Daily standup digest** — PreCompact hook generates summary of work done before context compaction
39. **Team agreement reminders** — SessionStart hook with compact matcher re-injects team agreements
40. **Code review assignment** — TaskCompleted hook in agent teams auto-assigns PR reviews

---

## 21. Anti-Patterns — What NOT To Do

### Performance Anti-Patterns

**Anti-pattern 1: Synchronous blocking on every write**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npm test" }
        ]
      }
    ]
  }
}
```
Problem: Each test run adds 10-30 seconds. After 5 writes, you've wasted 2+ minutes.

**Better:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npm test", "async": true, "timeout": 120 }
        ]
      }
    ]
  }
}
```

**Anti-pattern 2: Multiple hooks on the same event without async**
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "prettier --write" }] },
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "eslint --fix" }] },
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "tsc --noEmit" }] },
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "npm test" }] }
    ]
  }
}
```
Problem: 200ms + 300ms + 150ms + 30s = 30 seconds per write.

**Better:** Chain in a single shell script
```bash
#!/bin/bash
set -e
npx prettier --write "$1"
npx eslint --fix "$1"
npx tsc --noEmit
# Run tests async in background
npm test >/dev/null 2>&1 &
exit 0
```

**Anti-pattern 3: Long-running hooks without background subshell**
```bash
#!/bin/bash
docker build -t myapp .  # BLOCKS CLAUDE
exit 0
```

**Better:**
```bash
#!/bin/bash
(docker build -t myapp . >/dev/null 2>&1) &
exit 0
```

### Logic Anti-Patterns

**Anti-pattern 4: Blocking on every write instead of submit**
Hooks fire for every single Edit/Write. If you block on every write while Claude is drafting a feature, it gets 50 blocks across 10 writes, then learns that pattern in its context. Better to let Claude finish, then validate the whole thing once with a Stop hook.

**Anti-pattern 5: Overly strict file protection**
```json
{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "block-if-matches-pattern .env" }] }
```
Problem: Claude can't update .env even when it should. A well-written hook has escape hatches.

**Better:** Use prompt hooks for semantic decisions
```json
{ "matcher": "Edit|Write", "hooks": [{ "type": "prompt", "prompt": "Is this edit to .env justified? Return {\"ok\": true} if yes, {\"ok\": false, \"reason\": \"...\"} if no." }] }
```

**Anti-pattern 6: Prompt hooks that echo instructions back**
Prompt hooks should return `{"ok": true}` or `{"ok": false, "reason": "..."}`. If your prompt returns a reason, Claude sees it and adjusts. But if you use a prompt hook to re-explain coding standards, you're wasting tokens — use Skills for that.

**Anti-pattern 7: Agent hooks on every event**
Agent hooks spawn subagents (5-10 seconds each). Don't use them for every PostToolUse. Save them for Stop hooks or critical verification.

### Security Anti-Patterns

**Anti-pattern 8: Storing secrets in hook commands**
```json
{ "type": "command", "command": "curl https://api.example.com -H 'Authorization: Bearer $SECRET_KEY'" }
```
Problem: Settings files are often committed to git.

**Better:** Use environment variables
```bash
#!/bin/bash
if [ -z "$DEPLOYMENT_TOKEN" ]; then
  echo "Error: DEPLOYMENT_TOKEN not set" >&2
  exit 0
fi
curl https://deploy.example.com -H "Authorization: Bearer $DEPLOYMENT_TOKEN"
```

And in `.env` or `.env.local` (gitignored):
```
DEPLOYMENT_TOKEN=xyz123
```

**Anti-pattern 9: Assuming hook permissions match Claude's permissions**
Hooks run as the user running Claude Code, with all their permissions. If you're admin, a malicious hook can delete your home directory. Vet hooks carefully.

**Anti-pattern 10: Complex shell in one-liners**
```json
{ "type": "command", "command": "if [ -f /tmp/test-pass ]; then rm -rf /tmp/build; docker build -t app .; else echo 'Tests failed' >&2; exit 2; fi" }
```
This is unreadable and error-prone. Always use a separate script file in `.claude/hooks/`.

### Configuration Anti-Patterns

**Anti-pattern 11: Unconditional echo in shell profile**
```bash
# ~/.zshrc
echo "Loading shell config..."
export PATH="/usr/local/bin:$PATH"
```

Hooks run non-interactive shells that source .zshrc. The `echo` prepends to JSON output and breaks parsing.

**Better:**
```bash
# ~/.zshrc
if [[ $- == *i* ]]; then
  echo "Loading shell config..."
fi
export PATH="/usr/local/bin:$PATH"
```

**Anti-pattern 12: Matchers that are too broad**
```json
{ "matcher": ".*", "hooks": [...] }
```

Every tool call, every event. Kills performance.

**Better:** Be specific
```json
{ "matcher": "Bash|Edit|Write", "hooks": [...] }
```

---

## 22. Official Documentation Quotes & Design Philosophy

From the official [Hooks Guide](https://code.claude.com/docs/en/hooks-guide.md):

> "Hooks are user-defined shell commands that execute at specific points in Claude Code's lifecycle. They provide deterministic control over Claude Code's behavior, ensuring certain actions always happen rather than relying on the LLM to choose to run them."

> "For decisions that require judgment rather than deterministic rules, you can also use prompt-based hooks or agent-based hooks that use a Claude model to evaluate conditions."

> "The violation rate drops within a session. After being blocked a few times, Claude starts proactively writing shorter functions and using guard clauses. This is context accumulation, not learning. The model's context window fills with examples of blocked-then-fixed code, so it mimics those patterns within the session. The effect resets completely across sessions, so the first few files always trigger more blocks."

From the official [Hooks Reference](https://code.claude.com/docs/en/hooks.md):

> "Hook events fire at specific points during a Claude Code session... For command hooks, input arrives on stdin. For HTTP hooks, it arrives as the POST request body."

> "Hooks communicate with Claude Code through stdin, stdout, stderr, and exit codes. When an event fires, Claude Code passes event-specific data as JSON to your script's stdin."

**Design principle:** Hooks are the "transparent, deterministic layer" that sits between Claude's agentic loop and the environment. They're not meant to replace prompting (which provides context and goals), but to **enforce non-negotiable rules**.

---

## 23. Hooks for Agent Teams — Team-Based Patterns

### TeammateIdle Hook

**When:** A teammate is about to go idle (finish their current tasks)

**Use case:** Assign more work, check for remaining items
```json
{
  "hooks": {
    "TeammateIdle": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Check if there are more high-priority tasks for this teammate to work on. Review the task list and return {\"ok\": true} if the teammate should continue, or {\"ok\": false, \"reason\": \"all critical tasks complete\"} if they can rest.",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

### TaskCompleted Hook

**When:** A task is being marked as completed

**Use case:** Enforce quality gates (tests pass, lint checks succeed, specific acceptance criteria met)
```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify that all unit tests pass and the code compiles. Run the test suite and return {\"ok\": true} only if all tests pass.",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

**Key advantage:** No task closes with broken tests, regardless of which teammate worked on it.

### Best Patterns for Team Hooks

1. **Staggered quality gates:** TaskCompleted for unit tests, Stop hooks (on lead agent) for integration tests
2. **Work distribution:** TeammateIdle hooks that intelligently assign high-priority tasks
3. **Cross-team signaling:** Async hooks that notify other teams when milestones complete
4. **Escalation handling:** PreCompact + TaskCompleted to escalate stalled work to human

### Token Cost Optimization for Teams

- Use command hooks for simple checks (cheap)
- Use prompt hooks (Haiku) for semantic checks
- Use agent hooks only for deep verification (Sonnet or Opus)
- Run async hooks in background to not block team progress

---

## 24. Hook Composition Patterns

### Hook Chaining Pattern

You can't directly call one hook from another, but you can **compose them** through shared state:

```bash
# .claude/hooks/chain-example.sh
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path')

# Step 1: Format
npx prettier --write "$FILE"

# Step 2: Lint
npx eslint --fix "$FILE"

# Step 3: Type check
npx tsc --noEmit "$FILE"

# Step 4: Run tests async
(npm test > /tmp/test-output.txt 2>&1) &

exit 0
```

### Matcher Composition

Use regex to compose matchers:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": ".claude/hooks/multi-tool-handler.sh" }]
      }
    ]
  }
}
```

### Event-Based Orchestration

Different hooks at different events work together:

1. **PreToolUse (bash commit)** → block if tests haven't passed
2. **PostToolUse (write)** → format file
3. **Stop** → verify all requested tasks complete
4. **SessionEnd** → log session summary

Together they create a complete workflow.

### Conditional Routing

Use hook output to signal downstream behavior:

```bash
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path')

# Determine what to do based on file type
if [[ "$FILE" == *.test.ts ]]; then
  npm test "$FILE"
elif [[ "$FILE" == *.ts ]]; then
  npx tsc --noEmit "$FILE"
  npx eslint --fix "$FILE"
fi

exit 0
```

---

## 25. Performance Considerations & Optimization

### Measured Hook Overhead

Based on real-world sessions on M-series MacBooks:

- **Per-invocation overhead:** 100-300ms per write/edit
- **Multiple hooks:** 3 hooks x 200ms = 600ms per write
- **Agent hook spawn:** 5-10 seconds per agent hook
- **Async hooks:** 0ms blocking (runs in background)

### Known Performance Issues

**Bug: Progressive Hook Duplication**
A documented bug ([Issue #3523](https://github.com/anthropics/claude-code/issues/3523)) caused hooks to duplicate during sessions, running 10+ simultaneous processes for single trigger events. This was severe enough to make Claude Code unusable.

**Workaround:** Keep hooks simple and avoid long timeouts.

### Optimization Strategies

**1. Use Background Subshells for Long Tasks**
```bash
# BLOCKS: 30 seconds
docker build -t app .
exit 0

# NON-BLOCKING: returns immediately
(docker build -t app . >/dev/null 2>&1) &
exit 0
```

**2. Async-First for Non-Critical Work**
```json
{
  "type": "command",
  "command": "npm run lint:all",
  "async": true,
  "timeout": 120
}
```

**3. Lazy Initialization on SessionStart**
```bash
#!/bin/bash
# .claude/hooks/session-init.sh

# Check if dependencies are installed
if ! command -v jq &> /dev/null; then
  echo "Installing jq..."
  brew install jq  # or apt-get install jq
fi

exit 0
```

**4. Timeout Tuning by Hook Type**
- Quick checks: 10-30 seconds
- Medium checks (linting): 30-60 seconds
- Heavy checks (tests): 120-300 seconds
- Background tasks: no timeout (or 10 minutes)

### Context Impact of Hooks

If a hook outputs to stderr and you see it in verbose mode (Ctrl+O), it eats transcript lines. Don't log every tool call — that's what observability systems are for.

---

## 26. Hook Types Deep Dive — When to Use Each

### Command Hooks (`type: "command"`)

**Most reliable, most flexible.**

```json
{
  "type": "command",
  "command": "/path/to/script.sh",
  "timeout": 30,
  "async": false
}
```

**Pros:**
- Synchronous (blocks until done)
- Full shell access
- Can use any tool (grep, jq, curl, etc.)
- Fast (native execution, no LLM latency)
- Supports async mode
- Matchers work on any field

**Cons:**
- Must write shell scripts
- Debugging requires piping sample JSON

**Best for:** Formatting, linting, file validation, logging

### Prompt Hooks (`type: "prompt"`)

**Semantic decisions with LLM evaluation.**

```json
{
  "type": "prompt",
  "prompt": "Is this edit to package.json justified? Return {\"ok\": true} or {\"ok\": false, \"reason\": \"...\"}",
  "model": "claude-haiku-4-5-20250901"
}
```

**Pros:**
- Semantic understanding (can evaluate intent)
- Simple yes/no decisions
- No scripting needed
- Uses Haiku (cheap, fast)

**Cons:**
- Cannot run tools (no file inspection)
- Not async-capable
- Latency (LLM call = 0.5-2 seconds)
- Single-turn only

**Best for:** Intent checking (e.g., "Is this edit dangerous?"), semantic validation

### Agent Hooks (`type: "agent"`)

**Deep verification with tool access.**

```json
{
  "type": "agent",
  "prompt": "Verify that all tests pass. Run the test suite and check the results. $ARGUMENTS",
  "timeout": 120
}
```

**Pros:**
- Can read files with Read tool
- Can search with Grep
- Can inspect with Glob
- Multi-turn (up to 50 tool-use turns)
- Deeper reasoning

**Cons:**
- Slowest (5-10 seconds per invocation)
- Not async-capable
- Higher token cost
- Overhead for simple checks

**Best for:** Complex verification (tests, linting with context), codebase analysis

### HTTP Hooks (`type: "http"`)

**Remote endpoint integration.**

```json
{
  "type": "http",
  "url": "https://my-webhook-handler.example.com/hooks",
  "timeout": 30,
  "headers": {
    "Authorization": "Bearer $DEPLOYMENT_TOKEN"
  },
  "allowedEnvVars": ["DEPLOYMENT_TOKEN"]
}
```

**Pros:**
- Integrate with external systems (monitoring, deployment)
- No local script needed
- Can chain to other services

**Cons:**
- Network latency
- Non-blocking errors (connection fails = continues)
- No automatic retry logic
- Security: token in headers

**Best for:** Remote logging, webhooks to CI/CD, external monitoring

---

## 27. Debugging Hooks — Troubleshooting Guide

### Enabling Debug Output

**Toggle verbose mode:**
```
Ctrl+O
```
This shows hook stderr output in the transcript.

**Full debug logging:**
```bash
claude --debug
```
Shows which hooks matched, exit codes, and full output.

### Common Issues & Fixes

**Issue: Hook never fires**

Checklist:
1. Run `/hooks` — is the hook listed?
2. Check matcher regex — is it case-sensitive?
3. Verify event type — does PreToolUse fire before tool execution? (yes)
4. Check file syntax — is settings.json valid JSON?

**Solution:**
```bash
cat .claude/settings.json | jq '.'  # Validate JSON
```

**Issue: "Hook error: command not found"**

Problem: Your hook references a tool that's not in PATH.

Solution: Use absolute paths
```bash
#!/bin/bash
/usr/local/bin/jq -r '.tool_name'
# or
command -v jq >/dev/null || { echo "jq not installed" >&2; exit 1; }
```

**Issue: "JSON validation failed"**

Problem: Your shell profile echoes unconditional output.

```bash
# ~/.zshrc
echo "Shell ready"  # THIS BREAKS HOOKS
export PATH="/usr/local/bin:$PATH"
```

Solution: Only echo in interactive mode
```bash
if [[ $- == *i* ]]; then
  echo "Shell ready"
fi
```

**Issue: Hook runs forever / timeout not working**

Problem: Your hook script has an infinite loop or blocking subprocess.

Solution: Always have an escape hatch
```bash
#!/bin/bash
INPUT=$(cat)

# If the hook has already been triggered once in this event cycle, allow it
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0
fi

# Your logic here
exit 0
```

### Testing Hooks in Isolation

Test a hook script before enabling it:

```bash
# Create sample JSON input
cat > /tmp/sample-hook-input.json <<'EOF'
{
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf /" },
  "session_id": "test-123",
  "cwd": "/home/user/project"
}
EOF

# Pipe it to your hook
cat /tmp/sample-hook-input.json | ./.claude/hooks/my-hook.sh
echo "Exit code: $?"
```

### Hook Output Inspection

**Check what your hook returns:**
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | ./my-hook.sh | jq '.'
```

**Check exit codes:**
```bash
./my-hook.sh < /tmp/input.json
echo $?  # 0 = allow, 2 = block, other = logged but allowed
```

### Verbose Output Redirection

Hooks can output to stderr (shown in Ctrl+O verbose mode):

```bash
#!/bin/bash
INPUT=$(cat)
echo "Hook input received" >&2  # Goes to stderr, visible in Ctrl+O
jq '.' <<< "$INPUT"              # Goes to stdout, only in verbose or if exit 0 + JSON
```

---

## 28. Security Hardening — Beyond CVEs

### Core Security Principles

1. **Hooks execute as the user running Claude Code** — if you're admin, hooks run with admin privs
2. **Hooks are not a security boundary** — prompt injection can work around them
3. **Hooks are structured prompt injection** — they intercept tool calls at key moments

### Practical Security Hardening

**1. Don't store secrets in settings files**
```json
// BAD
{ "command": "curl https://api.example.com -H 'Authorization: Bearer YOUR_SECRET_KEY'" }
```

```bash
// GOOD
// .claude/hooks/deploy.sh
#!/bin/bash
TOKEN="${DEPLOYMENT_TOKEN}"
if [ -z "$TOKEN" ]; then
  echo "Error: DEPLOYMENT_TOKEN not set" >&2
  exit 0  # Allow, but don't deploy
fi
curl https://api.example.com -H "Authorization: Bearer $TOKEN"
```

Then set in `.env.local` (gitignored):
```
DEPLOYMENT_TOKEN=xyz123
```

**2. Use environment variable allowlists**
```json
{
  "type": "http",
  "url": "https://webhook.example.com",
  "allowedEnvVars": ["DEPLOYMENT_TOKEN"],
  "headers": { "Authorization": "Bearer $DEPLOYMENT_TOKEN" }
}
```

**3. Validate input aggressively**
```bash
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Check file exists and is within project
if [[ ! "$FILE" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
  echo "Invalid file path" >&2
  exit 0  # Deny silently
fi

if [[ "$FILE" =~ \.\./ ]]; then
  echo "Path traversal attempt blocked" >&2
  exit 2
fi
```

**4. Avoid eval and dynamic command execution**
```bash
# BAD
eval "$COMMAND"

# GOOD
case "$COMMAND" in
  "test") npm test ;;
  "build") npm run build ;;
  *) echo "Unknown command" >&2; exit 0 ;;
esac
```

**5. Run Claude Code as standard user, not admin**
Every process Claude spawns (including hooks) inherits parent permissions. Admin context = full system access via prompt injection.

**6. Disable hooks in untrusted repos**
```json
{ "disableAllHooks": true }
```

**7. Static analysis before bash execution**
Claude Code runs static analysis on bash commands to flag potentially risky operations. Commands that modify system files or access sensitive directories are flagged for explicit approval.

**8. Audit hook modifications**
Use ConfigChange hooks to log all hook modifications:
```bash
#!/bin/bash
INPUT=$(cat)
echo "[$(date)] Hook config changed: $(echo "$INPUT" | jq '.file_path')" >> ~/.claude/hook-audit.log
exit 0
```

### Documented Vulnerabilities (2025-2026)

**CVE-2025-59536 / CVE-2026-21852: RCE and API Token Exfiltration**
Hooks, MCP servers, and environment variables could be exploited to achieve RCE and steal API credentials. Attackers could craft malicious project files that execute arbitrary code when a user opens the repo.

**Mitigation:**
- Never clone and immediately run Claude Code on untrusted repos
- Review .claude/settings.json, .mcp.json, and .env before opening
- Keep Claude Code updated
- Use sandboxing if available

---

## 29. Real-World Production Repos

### Battle-Tested Configuration Repos

#### 1. [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
From an Anthropic hackathon winner with 10+ months of daily use building real products.

**Hook patterns included:**
- Memory persistence across compaction
- Multi-event orchestration hooks
- Security validation hooks
- CI/CD automation hooks
- Team coordination hooks for agent teams

**Notable hook:** `memory-persistence/pre-compact.sh` — preserves critical decisions and work summaries before context compaction.

#### 2. [ChrisWiles/claude-code-showcase](https://github.com/ChrisWiles/claude-code-showcase)
Comprehensive project configuration with hooks, skills, agents, and GitHub Actions.

**Includes:**
- JIRA/Linear integration via MCP servers with the `/ticket` command handling entire workflows
- Hooks that read tickets, implement features, update ticket status, and create new tickets for bugs
- GitHub Actions integration

#### 3. [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)
Master Claude Code hooks with clean hook architectures.

**Technique:** Uses UV single-file scripts to keep hook logic cleanly separated, with all hooks in `.claude/hooks/` as standalone Python scripts with embedded dependency declarations.

#### 4. [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
Real-time monitoring for Claude Code agents through simple hook event tracking.

**What it does:** Captures, stores, and visualizes hook events in real-time, offering complete observability into agent behavior.

#### 5. [diet103/claude-code-infrastructure-showcase](https://github.com/diet103/claude-code-infrastructure-showcase)
Production-tested infrastructure from 6 months managing a complex TypeScript microservices project.

**Includes:**
- 5 production skills with auto-activation
- 6 hooks for automation
- 10 specialized agents
- Solutions for "skills don't activate automatically" problem

#### 6. [decider/claude-hooks](https://github.com/decider/claude-hooks)
Comprehensive hooks that enforce clean code standards, prevent outdated package installation, and send task completion notifications.

**Support:** Directory-specific configurations using `.claude/hooks.json`.

#### 7. [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
Curated list of awesome skills, hooks, slash-commands, agent orchestrators, applications, and plugins for Claude Code.

#### 8. [wesammustafa/Claude-Code-Everything-You-Need-to-Know](https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know)
The ultimate all-in-one guide with step-by-step tutorials, real-world examples, and expert strategies on hooks.

#### 9. [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config)
Opinionated defaults, documentation, and workflows for Claude Code at Trail of Bits (security-focused).

#### 10. [centminmod/my-claude-code-setup](https://github.com/centminmod/my-claude-code-setup)
Starter template with hooks, slash commands, and CLAUDE.md memory bank system.

#### 11. [mvara-ai/precompact-hook](https://github.com/mvara-ai/precompact-hook)
LLM-interpreted recovery summaries before compaction.

#### 12. [luongnv89/claude-howto](https://github.com/luongnv89/claude-howto)
Visual guide with copy-paste templates.

---

## 30. Summary Table: When To Use What

| Goal | Hook Type | Event | Matcher | Async? | Est. Overhead |
|------|-----------|-------|---------|--------|----------------|
| Format code | Command | PostToolUse | Edit\|Write | No | 50-100ms |
| Block dangerous commands | Command | PreToolUse | Bash | No | 10-50ms |
| Lint on write | Command | PostToolUse | Edit\|Write | Yes | 0ms (async) |
| Run tests on file change | Command | PostToolUse | Edit\|Write | Yes | 0ms (async) |
| Check semantic intent | Prompt | UserPromptSubmit | (none) | No | 1-2s |
| Validate before commit | Command | PreToolUse | Bash(git commit) | No | 100-500ms |
| Deep codebase analysis | Agent | Stop | (none) | No | 5-10s |
| Send to monitoring system | HTTP | PostToolUse | Edit\|Write | Yes | 0ms (async) |
| Preserve context on compaction | Command | PreCompact | manual\|auto | No | 100-300ms |
| Team quality gates | Agent | TaskCompleted | (none) | No | 5-10s |
| Prevent task idling | Agent | TeammateIdle | (none) | No | 5-10s |
| Desktop notifications | Command | Notification | permission_prompt | No | 50-100ms |

---

## 31. Quick Reference: Hook Events by Phase

### Session Lifecycle
- **SessionStart** — session begins; inject context, check dependencies
- **UserPromptSubmit** — after user input; validate request, inject context
- **PreCompact** — before context compression; preserve critical data
- **SessionEnd** — session ends; log summary, cleanup

### Tool Execution
- **PreToolUse** — before tool runs; block dangerous commands
- **PostToolUse** — after success; format, lint, test
- **PostToolUseFailure** — after failure; log, retry, alert
- **PermissionRequest** — before permission dialog; auto-approve safe actions

### Notifications & Control
- **Notification** — Claude needs input; desktop notification
- **Stop** — Claude finishes response; verify completeness

### Subagents
- **SubagentStart** — subagent spawns; setup
- **SubagentStop** — subagent ends; cleanup

### Agent Teams
- **TeammateIdle** — teammate about to idle; assign more work
- **TaskCompleted** — task completion; enforce quality gates

### Configuration & Infrastructure
- **ConfigChange** — settings change; audit, prevent unauthorized changes
- **WorktreeCreate** — worktree created; custom setup
- **WorktreeRemove** — worktree removed; custom cleanup

---

## 32. Real-World Findings (Lab Tested)

Lab-tested findings from `.claude/research/hooks-lab.md` (2026-02-28). These results reflect real-world behavior observed across multiple sessions, not documentation claims.

### SubagentStart additionalContext: Confirmed Unreliable

**Test setup:** Command hook on SubagentStart event, outputting `hookSpecificOutput` JSON with `additionalContext` field. Tested with both bare `{"additionalContext": "..."}` and correct `{"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": "..."}}` wrapper.

**Results:**
- Hook fires: YES (8/8 firings confirmed via debug log)
- JSON output correct: YES (validated format)
- Agent receives context: NO (0/8 successful injections)
- Agent self-reported not receiving boilerplate in all tests
- Matches independent finding: [obra/superpowers#237](https://github.com/obra/superpowers/issues/237)

**Conclusion:** SubagentStart `additionalContext` injection is not functional as of Feb 2026, despite being documented as a working feature. Do not rely on it for critical instruction delivery.

### SubagentStop: Cannot Return Context to Parent

**Confirmed limitation** ([#5812](https://github.com/anthropics/claude-code/issues/5812)). SubagentStop hook output does not appear in parent conversation context. Feature has been requested but is not implemented.

**Impact:** Two-way parent-subagent communication through hooks is not possible. The only data flow is parent-to-subagent (via agent definitions, skills, CLAUDE.md), not subagent-to-parent through hooks.

**Workaround:** Filesystem relay — subagent writes results to a known file, parent reads it via UserPromptSubmit hook or manual prompt.

### TaskCompleted: Exit Codes Only

**Confirmed:** TaskCompleted hooks can only use exit codes for control. There is no `additionalContext` field, no JSON control beyond exit codes. Exit 2 sends stderr as feedback but does not inject context into the agent. TaskCompleted hooks are useful only for side effects: file logging, notifications, metrics.

### PreToolUse Cannot Block Task Tool

**Confirmed** ([#26923](https://github.com/anthropics/claude-code/issues/26923)). The Task tool ignores PreToolUse and SubagentStart block attempts. You can inject context into the task prompt but cannot prevent the task from being created. This is by design — the Task tool is treated as a first-class orchestration primitive.

### CLAUDE_PROJECT_DIR Empty in Subagent Environments

**Confirmed** ([#26429](https://github.com/anthropics/claude-code/issues/26429)). The `$CLAUDE_PROJECT_DIR` environment variable is empty or unset when hooks fire inside subagent environments. Hooks that construct file paths using this variable will fail silently.

**Workaround:** Use `$PWD`, hardcode the project path, or use the `cwd` field from stdin JSON input.

### Filesystem Relay Workaround Pattern

When `additionalContext` injection fails (SubagentStart) or is unavailable (SubagentStop to parent), a filesystem relay can bridge the gap:

**Pattern:**
1. SubagentStart hook writes instructions/context to a known file (e.g., `.claude/hooks/active-boilerplate.md`)
2. Agent definition (`.claude/agents/worker.md`) instructs the agent: "FIRST ACTION: Read `.claude/hooks/active-boilerplate.md`"
3. Agent uses its Read tool to load the file as its first action

**Why it works:**
- SubagentStart hook fires reliably (confirmed 8/8 in lab testing)
- File writes are side effects — independent of context injection
- Agent definitions are confirmed loaded at spawn time
- Agents have Read tool access

**Risks:**
- Agent may ignore "read this file first" instruction (prompt drift)
- File write timing — hook must complete before agent starts reading
- Race conditions with concurrent agents overwriting the same file

**FelixChan/Chorus Plugin Pattern:** A more robust variant using `flock` for file locking and `mv` for atomic writes:

```bash
#!/bin/bash
# SubagentStart hook — filesystem relay with atomic write
INPUT=$(cat)
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id')
RELAY_DIR=".claude/hooks/relay"
mkdir -p "$RELAY_DIR"

# Write to temp file, then atomically move into place
TMPFILE=$(mktemp "$RELAY_DIR/.tmp.XXXXXX")
cat > "$TMPFILE" <<EOF
## Agent Boilerplate (injected via filesystem relay)
- Agent ID: $AGENT_ID
- Follow all CLAUDE.md rules
- Log completion when done
EOF

# Atomic move prevents partial reads
mv "$TMPFILE" "$RELAY_DIR/$AGENT_ID.md"

exit 0
```

This pattern uses per-agent files (keyed by `agent_id`) to avoid race conditions between concurrent agents, and `mv` for atomic file replacement so agents never read partial content.

### Gap Analysis: Documented vs. Actual Behavior

| Feature | Documented as Working? | Actually Works? | Gap Severity |
|---------|----------------------|-----------------|-------------|
| SubagentStart `additionalContext` injection | YES | NO (0/8 success rate) | **Critical** — primary documented mechanism for agent instruction injection is non-functional |
| UserPromptSubmit stdout as context | YES | YES (100% reliable) | None |
| SessionStart stdout as context | YES | YES (100% reliable) | None |
| PostToolUse side effects (formatting, linting) | YES | YES (100% reliable) | None |
| `once` field in settings-level hooks | Not mentioned | NO (only works in skills) | Moderate — undocumented limitation |
| SubagentStop output to parent context | Mentioned as feature | NO (not implemented, [#5812](https://github.com/anthropics/claude-code/issues/5812)) | **High** — documented feature does not exist |
| PreToolUse blocking Task tool | Not mentioned | NO (by design, [#26923](https://github.com/anthropics/claude-code/issues/26923)) | Moderate — undocumented limitation |
| PermissionRequest in headless mode | Mentioned as limitation | NO (documented gap) | Low — documented |
| TaskCompleted `additionalContext` | Not explicitly documented | NO (exit codes only) | Moderate — users may assume parity with other events |
| `$CLAUDE_PROJECT_DIR` in subagents | Documented as "All hooks" | NO (empty in subagents, [#26429](https://github.com/anthropics/claude-code/issues/26429)) | **High** — hooks using this variable silently fail |

### Recommended Reliable Alternatives

Based on lab testing, these are the confirmed-reliable mechanisms for each use case:

| Goal | Do NOT Use | Use Instead |
|------|-----------|-------------|
| Inject instructions into sub-agents | SubagentStart `additionalContext` | Agent definition files (`.claude/agents/*.md`), preloaded skills, CLAUDE.md |
| Return data from sub-agent to parent | SubagentStop hook output | Filesystem relay (sub-agent writes file, parent reads) |
| Inject context every prompt | SubagentStart hooks | UserPromptSubmit hooks (confirmed 100% reliable) |
| Block task creation | PreToolUse on Task tool | Cannot be blocked; use agent definition rules to guide behavior |
| Run once per session | `once: true` in settings hooks | Manual guard files (`if [ -f /tmp/marker ]; then exit 0; fi; touch /tmp/marker`) |
| Inject context at startup | Subagent hooks | SessionStart hook with compact matcher for re-injection after compaction |

---

## Sources

### Official Documentation
- [Hooks Reference — Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Automate Workflows with Hooks — Claude Code Docs](https://code.claude.com/docs/en/hooks-guide)
- [Best Practices — Claude Code Docs](https://code.claude.com/docs/en/best-practices.md)
- [Settings — Claude Code Docs](https://code.claude.com/docs/en/settings.md)
- [Security — Claude Code Docs](https://code.claude.com/docs/en/security.md)
- [Agent Teams — Claude Code Docs](https://code.claude.com/docs/en/agent-teams.md)
- [Claude Code Power User: How to Configure Hooks](https://claude.com/blog/how-to-configure-hooks)

### CVEs and Security Research
- [CVE-2025-59536 / CVE-2026-21852 — Check Point Research](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)
- [The Hacker News: Claude Code Flaws Allow Remote Code Execution](https://thehackernews.com/2026/02/claude-code-flaws-allow-remote-code.html)
- [Backslash Security: Claude Code Security Best Practices](https://www.backslash.security/blog/claude-code-security-best-practices)

### GitHub Issues
- [SubagentStop Cannot Return Context to Parent #5812](https://github.com/anthropics/claude-code/issues/5812)
- [PreToolUse/SubagentStart Cannot Block Task Tool #26923](https://github.com/anthropics/claude-code/issues/26923)
- [SubagentStop Prompt Hooks Don't Prevent Termination #20221](https://github.com/anthropics/claude-code/issues/20221)
- [Hook Execution Reliability in Concurrent Sessions #7881](https://github.com/anthropics/claude-code/issues/7881)
- [CLAUDE_PROJECT_DIR Empty in Subagent Environments #26429](https://github.com/anthropics/claude-code/issues/26429)
- [additionalContext Duplication Bug #14281](https://github.com/anthropics/claude-code/issues/14281)
- [Hook stdin JSON Parsing Failures #10373](https://github.com/anthropics/claude-code/issues/10373)
- [SubagentStart Hook Timing Race Conditions #13650](https://github.com/anthropics/claude-code/issues/13650)
- [Hook Output Not Visible in Non-Verbose Mode #11906](https://github.com/anthropics/claude-code/issues/11906)
- [Async Hook Result Delivery Unreliable #16538](https://github.com/anthropics/claude-code/issues/16538)
- [Claude Code Hooks Regression #10814](https://github.com/anthropics/claude-code/issues/10814)
- [Progressive Hook Duplication #3523](https://github.com/anthropics/claude-code/issues/3523)
- [SubagentStart additionalContext Not Injecting — obra/superpowers#237](https://github.com/obra/superpowers/issues/237)

### Comprehensive Guides
- [Eesel.ai: A complete guide to hooks in Claude Code: Automating your development workflow](https://www.eesel.ai/blog/hooks-in-claude-code)
- [aiorg.dev: Claude Code Hooks: Complete Guide with 20+ Ready-to-Use Examples (2026)](https://aiorg.dev/blog/claude-code-hooks)
- [Pixelmojo: Claude Code Hooks Guide: All 12 Lifecycle Events Explained](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns)
- [Juan Andres Nunez: Hooks in Claude Code: A Practical Guide with Real Examples](https://wmedia.es/en/writing/claude-code-hooks-practical-guide)
- [ClaudeFast: Claude Code Hooks Complete Guide (February 2026 Edition)](https://claudefa.st/blog/tools/hooks/hooks-guide/)
- [DataCamp: Claude Code Hooks: A Practical Guide to Workflow Automation](https://www.datacamp.com/tutorial/claude-code-hooks)

### Real-World Experience Posts
- [Builder.io: How I use Claude Code (+ my best tips)](https://www.builder.io/blog/claude-code)
- [Shrivu Shankar: How I Use Every Claude Code Feature](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)
- [GitButler: Automate Your AI Workflows with Claude Code Hooks](https://blog.gitbutler.com/automate-your-ai-workflows-with-claude-code-hooks)
- [Sankalp's Blog: A Guide to Claude Code 2.0 and getting better at using coding agents](https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents)
- [Luiz Tanure: Claude Code: Part 8 — Hooks for Automated Quality Checks](https://www.letanure.dev/blog/2025-08-06--claude-code-part-8-hooks-automated-quality-checks)

### Deep Technical Posts
- [Medium: The Claude Code Hooks Nobody Talks About: My 6-Month Production Report](https://alirezarezvani.medium.com/the-claude-code-hooks-nobody-talks-about-my-6-month-production-report-30eb8b4d9b30)
- [Medium: Hardening Claude Code: A Security Review Framework](https://medium.com/@emergentcap/hardening-claude-code-a-security-review-framework-and-the-prompt-that-does-it-for-you-c546831f2cec)
- [Medium: Context Recovery Hook for Claude Code — Never Lose Work to Compaction](https://medium.com/coding-nexus/context-recovery-hook-for-claude-code-never-lose-work-to-compaction-7ee56261ee8f)
- [Medium: Streamlined CI/CD Pipelines Using Claude Code & GitHub Actions](https://medium.com/@itsmybestview/streamlined-ci-cd-pipelines-using-claude-code-github-actions-74be17e51499)

### DEV Community
- [DEV Community: Automating Your Workflow with Claude Code Hooks](https://dev.to/gunnargrosch/automating-your-workflow-with-claude-code-hooks-389h)
- [DEV Community: Claude Code Hooks: Complete Guide with 20+ Ready-to-Use Examples (2026)](https://dev.to/lukaszfryc/claude-code-hooks-complete-guide-with-20-ready-to-use-examples-2026-dcg)
- [DEV Community: How I Turned Claude Code Into a Personal AI You Can Reach From Anywhere Using Webhooks](https://dev.to/theabecaster/i-turned-claude-code-into-a-personal-ai-you-can-reach-from-anywhere-using-webhooks-45em)

### Specialized Topics
- [Dev Genius: Claude Code async hooks: what they are and when to use them](https://blog.devgenius.io/claude-code-async-hooks-what-they-are-and-when-to-use-them-61b21cd71aed)
- [Yuanchang's Blog: Claude Code's Memory Evolution: Auto Memory & PreCompact Hooks Explained](https://yuanchang.org/en/posts/claude-code-auto-memory-and-hooks/)
- [PromptLayer: Understanding Claude Code Hooks Documentation](https://blog.promptlayer.com/understanding-claude-code-hooks-documentation/)
- [SFEIR Institute: Context Management — Optimization Guide](https://institute.sfeir.com/en/claude-code/claude-code-context-management/optimization/)

### DevOps & CI/CD
- [Pulumi Blog: The Claude Skills I Actually Use for DevOps](https://www.pulumi.com/blog/top-8-claude-skills-devops-2026/)
- [Codecentric: Claude Code: From AI Assistant to Autonomous Developer](https://www.codecentric.de/en/knowledge-hub/blog/from-interactive-assistant-to-autonomous-developer-containerizing-claude-code)
- [SkyWork: How to Integrate Claude Code with CI/CD](https://skywork.ai/blog/how-to-integrate-claude-code-ci-cd-guide-2025/)

### Observability
- [SigNoz: Bringing Observability to Claude Code: OpenTelemetry in Action](https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/)

### Production Repos
- [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)
- [ChrisWiles/claude-code-showcase](https://github.com/ChrisWiles/claude-code-showcase)
- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [diet103/claude-code-infrastructure-showcase](https://github.com/diet103/claude-code-infrastructure-showcase)
- [decider/claude-hooks](https://github.com/decider/claude-hooks)
- [wesammustafa/Claude-Code-Everything-You-Need-to-Know](https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know)
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [mvara-ai/precompact-hook](https://github.com/mvara-ai/precompact-hook)
- [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config)
- [centminmod/my-claude-code-setup](https://github.com/centminmod/my-claude-code-setup)
- [luongnv89/claude-howto](https://github.com/luongnv89/claude-howto)
