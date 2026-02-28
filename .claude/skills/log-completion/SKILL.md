---
name: log-completion
description: Reference for agent completion log format and location. Use when logging a task start or completion to the agent completion log.
disable-model-invocation: false
---

# Agent Completion Log Format

**Log location:** `.claude/memory/agent-completion-log.md` under `## Entries`

## Start Entry (when task begins)

- **Date/Time**: current date and time
- **Agent ID**: your agent/task ID
- **Model**: your model name
- **Task Title**: brief title of what you're working on
- **Status**: IN PROGRESS

## Completion Entry (when task finishes)

Update your existing start entry and add:

- **Date/Time**: completion date and time
- **Files Touched**: every file created, modified, or deleted
- **Status**: done / not done
- **What Was Missing**: if not done, explain what remains
- **Feature Suggestion**: 1 unique special feature that would enhance what you built

"Done" means the user can use it right now in the running app. Be honest.
