#!/bin/bash
echo ""
echo "========== PM OPERATING RULES (injected every prompt) =========="
echo "1. Prefer delegating to agents for multi-file or complex tasks. Simple reads, edits, and searches can be done directly."
echo "2. NEVER start, restart, stop, or kill servers, clients, dev processes, or browsers unless the user explicitly asks. No exceptions."
echo "3. After completing your task, suggest 1 unique special feature. Teammates should compete to suggest the best one. Search context and memory to never repeat a suggestion."
echo "4. Agent prompts MUST include user intent verbatim + 'exceed expectations' instruction."
echo "5. No tests. Never run or write tests."
echo "6. Use agent teams for collaborative work, background agents for independent tasks."
echo "7. Agent prompts must include: user intent, relevant context, and a completion checklist for multi-step tasks."
echo "8. Every agent prompt must include: 'When done, log your completion claim to .claude/memory/agent-completion-log.md with: date/time, agent ID, model, task summary, files touched, done/not done.'"
echo "9. After each agent completes, spawn a haiku verifier. Its prompt must include the full log file format and instructions from .claude/memory/agent-completion-log.md so it knows exactly how to find the agent's entry and write its review beneath it."
echo "10. Never trust an agent's self-assessment alone. The log file has post-mortem procedures for tracing issues back to root cause."
echo "11. Respond with '✓ PM rules loaded' as your FIRST line before answering."
echo ""

# Check for pending verification (written by PostToolUse on Task)
PENDING_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/pending-verification.json"
if [ -f "$PENDING_FILE" ]; then
  if command -v jq &>/dev/null; then
    V_AGENT=$(jq -r '.agent_id // "unknown"' "$PENDING_FILE" 2>/dev/null)
    V_TASK=$(jq -r '.task_summary // "unknown"' "$PENDING_FILE" 2>/dev/null)
    V_FILES=$(jq -r '.files_touched // "unknown"' "$PENDING_FILE" 2>/dev/null)
  else
    V_AGENT=$(grep -o '"agent_id"[^,}]*' "$PENDING_FILE" | sed 's/.*: *"//' | sed 's/"$//' 2>/dev/null || echo "unknown")
    V_TASK=$(grep -o '"task_summary"[^,}]*' "$PENDING_FILE" | sed 's/.*: *"//' | sed 's/"$//' 2>/dev/null || echo "unknown")
    V_FILES=$(grep -o '"files_touched"[^,}]*' "$PENDING_FILE" | sed 's/.*: *"//' | sed 's/"$//' 2>/dev/null || echo "unknown")
  fi

  echo "========== VERIFICATION NEEDED (auto-detected) =========="
  echo "Agent '$V_AGENT' completed a task and needs independent verification."
  echo "Task: $V_TASK"
  echo "Files: $V_FILES"
  echo "ACTION: Spawn a haiku verifier agent NOW. Use the verifier agent definition. Include task summary and files touched but NOT the agent's self-assessment (blind review)."
  echo "=========================================="
  echo ""

  # Consume the file so it doesn't repeat
  rm -f "$PENDING_FILE" 2>/dev/null
fi
