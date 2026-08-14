---
name: Project Overview
description: qbo-escalations architecture, stack, and current working-policy summary
type: project
last_verified: 2026-08-14
supersedes: stale always-delegate and never-test guidance removed 2026-07-10
authority: CLAUDE.md and AGENTS.md
---

Operational-intelligence platform whose first domain is QBO escalation support. Express 5 + Mongoose 9 server (CommonJS), React 19 + Vite client (ESM). MongoDB Atlas for data. Claude CLI subprocess for AI features (image parsing, chat). The main Claude session may coordinate or implement. Delegate when separate workers or an independent review materially improve the result.

API response shape: `{ ok: true/false, ...}` with code and error on failures. The app currently has no general login/session layer protecting `/api/*`; do not assume cookies provide that protection, and preserve the documented loopback-only deployment boundary.

**Why:** Build an operational-intelligence platform where expert agents work from shared evidence and human validation, with QBO escalation support as the first proving domain.
**How to apply:** Verify claims and changed files with fresh evidence. Do not start or stop long-running services unless the user explicitly asks. Write and run focused tests in proportion to the change's risk. Deliver the complete practical outcome behind the request: use critical thinking to fill obvious gaps, but do not invent unrelated scope or make a materially different product decision without approval. Explain the practical result first and define technical terms in plain language.
