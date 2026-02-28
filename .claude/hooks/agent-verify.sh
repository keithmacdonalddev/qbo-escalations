#!/bin/bash
set -e

# Read stdin — fallback to empty if no input
INPUT=$(cat 2>/dev/null || echo '{}')

# Parse fields with jq fallback
if command -v jq &>/dev/null; then
  AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty' 2>/dev/null)
  AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
else
  AGENT_TYPE=$(echo "$INPUT" | grep -o '"agent_type":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
  AGENT_ID=$(echo "$INPUT" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
fi

# Skip read-only and specialized types
case "$AGENT_TYPE" in
  Explore|Plan|claude-code-guide|statusline-setup)
    exit 0
    ;;
esac

# Skip if this is a verifier agent — check by agent type name
# Custom agents defined in .claude/agents/ use their filename as type
if [ "$AGENT_TYPE" = "verifier" ]; then
  exit 0
fi

# Verify the log file has an unverified entry before triggering
LOG_FILE="$CLAUDE_PROJECT_DIR/.claude/memory/agent-completion-log.md"
if [ -f "$LOG_FILE" ]; then
  # Check if there's an IN PROGRESS or done entry without a Verifier review after it
  HAS_UNVERIFIED=$(grep -c "Status: IN PROGRESS\|Status: done\|Status: not done" "$LOG_FILE" 2>/dev/null || echo "0")
  HAS_VERIFIED=$(grep -c "Verifier ID\|Assessment:" "$LOG_FILE" 2>/dev/null || echo "0")

  # If all entries are verified, skip
  if [ "$HAS_UNVERIFIED" -le "$HAS_VERIFIED" ] && [ "$HAS_UNVERIFIED" -gt 0 ]; then
    exit 0
  fi
fi

echo ""
echo "========== VERIFICATION REQUIRED =========="
echo "Worker agent $AGENT_ID just stopped."
echo ""
echo "1. Read .claude/memory/agent-completion-log.md"
echo "2. Find the most recent entry with no verifier review"
echo "3. Extract ONLY: task summary and files touched"
echo "4. Spawn a haiku verifier (model: haiku) using the verifier agent definition"
echo "5. Give haiku the task summary and files touched — NOT the self-assessment"
echo "============================================"
echo ""
