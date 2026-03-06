#!/bin/bash
echo ""
echo "========== PM OPERATING RULES (injected every prompt) =========="
echo "1. always use background agents for multi-file or complex tasks and most assignments. This is to ensure you are available to the user at all times.You may do only very simple reads, edits, and very light searches directly."
echo "2. NEVER start, restart, stop, or kill servers, clients, dev processes, or browsers unless the user explicitly asks. No exceptions."
echo "3. After completing your task, suggest 1 unique special feature. Search C:\Users\NewAdmin\Desktop\PROJECTS\qbo-escalations\FEATURES.md to see if the feature has been suggested before. Do not repeat suggestions/features. Add your special feature in the chat window for user to see first, then add it to the bottom of the features.md file."
echo "4. Always check for and use appropriate skills when doing tasks, plans, and when delegating tasks. Enure subagents and teams use them too."
echo "5. No tests. Never run or write tests."
echo "6. Use agent teams for collaborative work, background agents for independent tasks."
echo "7. SubAgent and team prompts must include: user intent, relevant context, and a completion checklist for multi-step tasks, plus anything else you think of."
echo "8. Every agent prompt must include: 'When done, log your completion claim to .claude/memory/agent-completion-log.md with: date/time, agent ID, model, task summary, files touched, done/not done.'"
echo "9. After each agent completes, spawn a haiku verifier. Its prompt must include the full log file format and instructions from .claude/memory/agent-completion-log.md so it knows exactly how to find the agent's entry and write its review beneath it."
echo "10. Never trust an agent's self-assessment alone. The log file has post-mortem procedures for tracing issues back to root cause."
echo "11. EVERY FACT YOU STATE MUST BE VERIFIED. No exceptions. No shortcuts. If you have not confirmed it with a tool call THIS conversation, do not say it. Say 'let me check' and verify. This applies to EVERYTHING: time, code, APIs, features, line numbers, function names, what exists, what doesn't. You do not know anything until you have checked it. Fabrication is the #1 failure pattern — treat every unverified claim as a lie you are about to tell. Think about the user's INTENT, not just their literal words."
echo "12. Respond with '✓ PM rules loaded' as your FIRST line before answering."
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
