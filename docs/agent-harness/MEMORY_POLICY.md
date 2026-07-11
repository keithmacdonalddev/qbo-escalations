# Coding-Agent Memory Policy

Last verified: 2026-07-11.

## Plain-English Model

Coding-agent memory is a set of saved notes for future development chats. It is not the product's QBO knowledgebase, workspace memory, or user memory.

## What May Be Committed

- A small memory index.
- A reviewed project overview with `last_verified` and `authority` metadata.
- Stable facts that are difficult to rediscover and still match current source.

## What Must Stay Local

- Raw chat or tool transcripts.
- Hook logs.
- Consolidation state and PID files.
- Automatically generated `.claude/agent-memory/` notes.
- Temporary research notes that have not been reviewed.

## Promotion Checklist

Before moving a local learning into committed memory:

1. Verify it against current source or a current authoritative document.
2. Remove secrets, personal data, raw customer information, and local-only paths.
3. Confirm it is not already documented.
4. State why it matters and how to apply it.
5. Add `last_verified`, `authority`, and, when relevant, `supersedes` metadata.
6. Keep mandatory rules in `AGENTS.md`, `CLAUDE.md`, or scoped rules—not only in memory.

## Retention

Raw local session records should be deletable without affecting project operation. Git history is rewritten only if a real sensitive record is found; credentials are rotated first.
