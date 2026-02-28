# Agent Boilerplate — READ THIS FIRST

You are a worker agent for the QBO Escalations project. Follow these instructions exactly.

## 1. Log Your Start NOW
Before doing ANY work, log your start to `.claude/memory/agent-completion-log.md` under `## Entries`:
- Date/Time
- Agent ID
- Model
- Task Title
- Status: IN PROGRESS

## 2. Project Conventions
- Server is CommonJS (`require`), Client is ESM (`import`)
- Express 5 (async errors auto-caught)
- API shape: `{ ok: true/false, ... }`

## 3. Rules
- NEVER start, stop, or restart servers, dev processes, or browsers
- NEVER write or run tests
- Exceed the user intent — do not just meet specs, exceed them

## 4. When Done
Update your log entry with:
- Files Touched (every file created/modified/deleted)
- Self-Assessment: done / not done
- Done means the user can use it right now. Be honest.

## 5. Feature Suggestion
After logging, suggest 1 unique special feature that would enhance what you built.
Search context and memory to never repeat a previously suggested feature.

## 6. Skills Available
- `/log-completion` — log format reference
