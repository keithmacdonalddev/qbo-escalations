#!/usr/bin/env bash
# scope.sh — Assemble scope info for the cto-review skill.
# Usage: bash scope.sh [plan-file]
# Outputs a markdown scope package to stdout.
#
# Edit the classify() function below if your project layout differs from
# the standard MERN pattern (server/routes, client/src/components, etc.).

set -uo pipefail

PLAN_FILE="${1:-}"

# Ensure we're in a git repo. If not, emit a fallback notice and exit cleanly.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "# Scope Package"
  echo ""
  echo "**Error:** Not in a git repository. Fall back to manual discovery."
  exit 0
fi

# Detect the base branch. Tries origin/HEAD, then common names, then HEAD~1.
detect_base() {
  local base
  base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's@^refs/remotes/origin/@@' || true)
  if [ -n "${base:-}" ]; then
    printf '%s' "$base"
    return
  fi
  for b in main master develop; do
    if git show-ref --verify --quiet "refs/heads/$b"; then
      printf '%s' "$b"
      return
    fi
  done
  printf '%s' "HEAD~1"
}

# Classify a file by path. Edit here to fit your project layout.
classify() {
  case "$1" in
    server/routes/*|*/routes/*)                         echo "route" ;;
    server/services/*|*/services/*)                     echo "service" ;;
    server/models/*|*/models/*)                         echo "model" ;;
    server/middleware/*|*/middleware/*)                 echo "middleware" ;;
    client/src/hooks/*|*/hooks/*)                       echo "hook" ;;
    client/src/context/*|*/context/*)                   echo "context" ;;
    client/src/components/*|*/components/*)             echo "component" ;;
    *.css|*.scss|*.sass)                                echo "styles" ;;
    *.test.*|*.spec.*|*/tests/*|*/__tests__/*)          echo "test" ;;
    *.config.*|*.yml|*.yaml|Dockerfile|package.json|tsconfig.json) echo "config" ;;
    *.md|docs/*)                                        echo "docs" ;;
    *)                                                  echo "other" ;;
  esac
}

BASE=$(detect_base)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "# Scope Package"
echo ""
echo "## Git State"
echo ""
echo "- Branch: \`$BRANCH\`"
echo "- Head commit: \`$COMMIT\`"
echo "- Base: \`$BASE\`"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "${UNCOMMITTED:-0}" -gt 0 ]; then
  echo "- **Warning:** $UNCOMMITTED uncommitted file(s) in working tree. Review covers committed + staged only."
fi

echo ""

DIFF_FILES=$(git diff --name-only "$BASE"...HEAD 2>/dev/null || true)

if [ -z "$DIFF_FILES" ]; then
  echo "## Modified Files"
  echo ""
  echo "No files differ from base (\`$BASE\`). Nothing to review against the base branch."
  echo ""
else
  echo "## Modified Files"
  echo ""
  echo "| File | +/- | Role |"
  echo "| ---- | --- | ---- |"
  git diff --numstat "$BASE"...HEAD 2>/dev/null \
    | while IFS=$'\t' read -r added removed file; do
        if [ "$added" = "-" ]; then
          stat="binary"
        else
          stat="+${added} / -${removed}"
        fi
        role=$(classify "$file")
        echo "| \`$file\` | $stat | $role |"
      done
  echo ""
fi

# Plan-based checks
if [ -n "$PLAN_FILE" ]; then
  if [ ! -f "$PLAN_FILE" ]; then
    echo "## Plan File"
    echo ""
    echo "Specified plan not found: \`$PLAN_FILE\`. Proceeding with git-only scope."
    echo ""
  else
    echo "## Unplanned File Candidates"
    echo ""
    echo "Files in the diff whose basename does not appear in the plan. This is a hint, not truth — plans often describe behavior rather than enumerate files, so a file's absence from this list does not guarantee it was planned. Verify by reading."
    echo ""
    found=0
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      fname=$(basename "$file" | sed 's/\.[^.]*$//')
      if ! grep -q -F -- "$fname" "$PLAN_FILE" 2>/dev/null; then
        echo "- \`$file\`"
        found=1
      fi
    done <<< "$DIFF_FILES"
    if [ "$found" = "0" ]; then
      echo "_(All modified files' basenames appear in the plan.)_"
    fi
    echo ""
  fi
fi

echo "## How to use this output"
echo ""
echo "This is a starting map, not the source of truth:"
echo ""
echo "- Read every modified file completely. If a read contradicts this table, trust the read."
echo "- Role classification is path-pattern based and may be wrong for unconventional layouts."
echo "- The unplanned-candidates list uses basename substring match — renamed items and file-path vs feature-name mismatches can produce false positives."
