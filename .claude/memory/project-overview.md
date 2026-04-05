---
name: Project Overview
description: qbo-escalations architecture, stack, and delegation model summary
type: project
---

QBO escalation tracking platform. Express 5 + Mongoose 9 server (CommonJS), React 19 + Vite client (ESM). MongoDB Atlas for data. Claude CLI subprocess for AI features (image parsing, chat). PM delegation model — main chat is coordinator, all implementation via agent teams.

API response shape: `{ ok: true/false, ...}` with code and error on failures. Session-based auth with HTTP-only cookies.

**Why:** Track and manage QBO customer escalations with AI-powered analysis.
**How to apply:** Always delegate implementation to agents. Verify all output. Never start/stop servers or write tests.
