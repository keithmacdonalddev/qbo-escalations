# Coding-Agent Hook Registry

Last verified: 2026-07-11.

| Hook | Provider/event | Purpose | Side effects | Failure behavior |
| --- | --- | --- | --- | --- |
| `.claude/hooks/pm-rules.sh` | Claude `UserPromptSubmit` | Repeats critical behavior and communication rules | Appends timestamp only to `.claude/logs/pm-rules.log` | Prints no private prompt content; a hook failure does not replace root rules |
| `.claude/hooks/runtime-guard.mjs` | Claude `PreToolUse` for shell tools | Blocks common service start, restart, and kill commands | None | Fails open on malformed input |
| `.claude/hooks/workspace-guard.mjs` | Claude `PreToolUse` for shell tools | Blocks destructive Git commands and direct full reads of common secret files | None | Fails open on malformed input |
| `.claude/hooks/config-freshness.mjs` | Claude `SessionStart` | Warns about documented architecture drift, missing harness files, and stale curated memory | None | Silent on internal errors |
| `.codex/hooks/pm-rules.ps1` | Codex `UserPromptSubmit` | Repeats critical behavior and communication rules | Appends timestamp only to `.codex/logs/pm-rules.log` | Root rules remain authoritative |

## Hook Change Checklist

When adding or changing a hook:

1. Confirm the event and response format in current official documentation.
2. Keep the matcher narrow.
3. Do not log prompts, tool output, secrets, or source content.
4. Test allowed, denied, and malformed input.
5. Update this registry and the relevant settings file together.
6. Prefer deterministic code for safety checks; do not use another model to decide whether its own command is safe.
