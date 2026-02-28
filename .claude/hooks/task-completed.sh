#!/bin/bash
set -e

# Read stdin — fallback to empty if no input
INPUT=$(cat 2>/dev/null || echo '{}')

# Parse fields with jq fallback
if command -v jq &>/dev/null; then
  TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject // empty' 2>/dev/null)
else
  TASK_SUBJECT=$(echo "$INPUT" | grep -o '"task_subject":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
fi

# If no task subject, this isn't a real task completion — skip
if [ -z "$TASK_SUBJECT" ]; then
  exit 0
fi

echo ""
echo "========== TASK COMPLETED — LOG NOW =========="
echo "Task: $TASK_SUBJECT"
echo "Update your log entry in .claude/memory/agent-completion-log.md NOW."
echo ""
echo "Add:"
echo "  - Date/Time of completion"
echo "  - Files Touched (every file created/modified/deleted)"
echo "  - Status: done / not done"
echo "  - What Was Missing (if not done)"
echo "  - 1 unique special feature suggestion (search memory to never repeat)"
echo ""
echo "Use /log-completion skill for format reference."
echo "Do this BEFORE you stop."
echo "================================================"
echo ""
