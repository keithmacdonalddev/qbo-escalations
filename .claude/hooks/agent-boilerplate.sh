#!/bin/bash

# Read stdin
INPUT=$(cat 2>/dev/null || echo '{}')

# Parse agent info
if command -v jq &>/dev/null; then
  AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty' 2>/dev/null)
  AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
else
  AGENT_TYPE=$(echo "$INPUT" | grep -o '"agent_type":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
  AGENT_ID=$(echo "$INPUT" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
fi

# Debug log
echo "[$(date)] Hook fired | type=$AGENT_TYPE | id=$AGENT_ID" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null

# Skip read-only types
case "$AGENT_TYPE" in
  Explore|Plan|claude-code-guide|statusline-setup|verifier)
    echo "[$(date)] Skipped ($AGENT_TYPE)" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
    exit 0
    ;;
esac

# Write boilerplate to a known file that agents are told to read
BOILERPLATE_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/active-boilerplate.md"
cat > "$BOILERPLATE_FILE" <<'EOF'
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
EOF

echo "[$(date)] Wrote boilerplate to $BOILERPLATE_FILE" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
exit 0
