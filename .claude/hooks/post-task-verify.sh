#!/bin/bash

# PostToolUse hook for Task tool
# Fires in PM context after an agent returns
# Writes pending-verification.json for pm-rules.sh to pick up

INPUT=$(cat 2>/dev/null || echo '{}')

# Debug log
echo "[$(date)] PostToolUse:Task fired" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null

# Parse tool_input fields
if command -v jq &>/dev/null; then
  SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
  AGENT_NAME=$(echo "$INPUT" | jq -r '.tool_input.name // empty' 2>/dev/null)
  AGENT_DESC=$(echo "$INPUT" | jq -r '.tool_input.description // empty' 2>/dev/null)
  AGENT_PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty' 2>/dev/null)
  AGENT_MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // empty' 2>/dev/null)
else
  SUBAGENT_TYPE=$(echo "$INPUT" | grep -o '"subagent_type":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
  AGENT_NAME=$(echo "$INPUT" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
  AGENT_DESC=$(echo "$INPUT" | grep -o '"description":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
  AGENT_PROMPT=""
  AGENT_MODEL=""
fi

echo "[$(date)] Parsed: type=$SUBAGENT_TYPE name=$AGENT_NAME model=$AGENT_MODEL desc=$AGENT_DESC" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null

PENDING_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/pending-verification.json"

# Guard 1: Skip verifier agents + clean up pending file (prevents infinite loop)
if echo "$AGENT_NAME" | grep -qi "verif" 2>/dev/null; then
  rm -f "$PENDING_FILE" 2>/dev/null
  echo "[$(date)] Skipped verifier ($AGENT_NAME), cleaned pending file" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
  exit 0
fi
if echo "$AGENT_DESC" | grep -qi "verif" 2>/dev/null; then
  rm -f "$PENDING_FILE" 2>/dev/null
  echo "[$(date)] Skipped verifier desc ($AGENT_DESC), cleaned pending file" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
  exit 0
fi
if echo "$AGENT_PROMPT" | grep -qi "verif" 2>/dev/null; then
  rm -f "$PENDING_FILE" 2>/dev/null
  echo "[$(date)] Skipped verifier prompt, cleaned pending file" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
  exit 0
fi

# Guard 2: Skip read-only / non-implementation agents
case "$SUBAGENT_TYPE" in
  Explore|Plan|claude-code-guide|statusline-setup)
    echo "[$(date)] Skipped ($SUBAGENT_TYPE)" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
    exit 0
    ;;
esac

# Read latest agent claim from completion log
LOG_FILE="$CLAUDE_PROJECT_DIR/.claude/memory/agent-completion-log.md"
if [ ! -f "$LOG_FILE" ]; then
  echo "[$(date)] No completion log found" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
  exit 0
fi

# Get last agent claim details (not verifier review)
AGENT_ID_LOG=$(grep "^- Agent ID:" "$LOG_FILE" | tail -1 | sed 's/.*Agent ID: //')
TASK_SUMMARY=$(grep "^- Task Summary:" "$LOG_FILE" | tail -1 | sed 's/.*Task Summary: //')
FILES_TOUCHED=$(grep "^- Files Touched:" "$LOG_FILE" | tail -1 | sed 's/.*Files Touched: //')

# Guard 3: Skip if no task summary found
if [ -z "$TASK_SUMMARY" ]; then
  echo "[$(date)] No task summary in log, skipping" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null
  exit 0
fi

echo "[$(date)] Last claim: agent=$AGENT_ID_LOG" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null

# Write pending verification file (pm-rules.sh picks this up on next UserPromptSubmit)
cat > "$PENDING_FILE" <<ENDJSON
{
  "agent_id": "$AGENT_ID_LOG",
  "task_summary": "$TASK_SUMMARY",
  "files_touched": "$FILES_TOUCHED",
  "timestamp": "$(date -Iseconds 2>/dev/null || date)"
}
ENDJSON

echo "[$(date)] Wrote pending verification: agent=$AGENT_ID_LOG" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/hook-debug.log" 2>/dev/null

# Also try direct stdout injection (may or may not work for PostToolUse)
echo ""
echo "========== VERIFICATION NEEDED =========="
echo "Agent '$AGENT_ID_LOG' completed a task and needs independent verification."
echo "Task: $TASK_SUMMARY"
echo "Files: $FILES_TOUCHED"
echo "ACTION: Spawn a haiku verifier agent NOW with these details. Do NOT include the agent's self-assessment — blind review only."
echo "=========================================="

exit 0
