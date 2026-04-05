---
name: dev
description: Build the client and verify the project compiles cleanly. Use when checking if changes work.
allowed-tools: Bash, Read, Glob, Grep
---

# Dev Check

Run the client build to verify changes compile:

!`npm run build 2>&1 | tail -20`

After reviewing the build output:
1. If the build succeeded, report modules transformed and output sizes.
2. If it failed, identify the error and suggest a fix.
3. Check for uncommitted changes: !`git status --short`
