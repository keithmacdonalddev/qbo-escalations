# QBO Escalation Assistant — Session 1 Handoff

**Date:** 2026-02-26
**Session Type:** Initial Build — Greenfield
**Commits:** 14 commits (scaffold through feature-complete Phase 1-2)
**Status:** Feature-complete for core flow. Known bugs open. Ready for testing + polish.

---

## Session 1 Summary

Built the entire QBO Escalation Assistant from scratch in one session: project scaffold, MongoDB models,
Claude CLI subprocess integration, SSE streaming chat, escalation CRUD, template library, playbook editor,
analytics, developer mode (Claude Code in browser), co-pilot, conversation forking, and a 22-file QBO
knowledge base. The full integration loop — paste escalation, chat with Claude, save as record, resolve
with template — is wired end to end.

---

## What Was Built

### Client — `client/src/`

| File | Description |
|------|-------------|
| `App.jsx` | Hash router: 7 views (chat, dashboard, escalation-detail, playbook, templates, analytics, dev). Framer Motion page transitions with `useReducedMotion()` guard. |
| `App.css` | Full design system: CSS custom properties, card/button/chip components, layout grid, responsive breakpoints, animations, dark-mode stubs. |
| `main.jsx` | React 19 root entry point. |
| `components/Chat.jsx` | Main chat interface. SSE streaming, image upload, conversation sidebar, search, rename, export, fork, retry, response timing display. |
| `components/ChatMessage.jsx` | Individual message bubble. Role-differentiated styling, image thumbnails, markdown-like rendering. |
| `components/ConfirmModal.jsx` | Shared confirmation dialog. Used for deletes across all views. |
| `components/DevMode.jsx` | Claude Code in the browser. Streams raw `stream-json` events, renders tool-use blocks, file diffs, session resume via `--resume`, keyboard shortcuts (Ctrl+N, Esc). |
| `components/EscalationDashboard.jsx` | Escalation list with status/category filters, search, pagination, create form with auto-parse, bulk status actions. |
| `components/EscalationDetail.jsx` | Full escalation view: all fields, status transitions, linked conversation, resolution notes, link/unlink chat. |
| `components/ImageUpload.jsx` | Drag-and-drop image uploader. Base64 encoding, preview, multi-image support. |
| `components/PlaybookEditor.jsx` | View and edit playbook category `.md` files in-browser. Live edit with save, reload trigger on server. |
| `components/Sidebar.jsx` | Left navigation: links to all 7 views, conversation list for chat view, active state highlighting. |
| `components/TemplateLibrary.jsx` | Browse, copy, create, edit, and delete response templates. Usage count tracking, category filter. |
| `components/Analytics.jsx` | Charts for: total/status summary, category breakdown (bar), resolution time by category, volume over time (30-day), top agents. Uses native SVG (no chart library). |
| `hooks/useChat.js` | Chat state hook: SSE streaming via EventSource, conversation management, optimistic message display. |
| `hooks/useDevChat.js` | Developer mode hook: streams raw Claude Code events, classifies tool events, manages in-memory conversation history (no persistence yet). |
| `api/chatApi.js` | Fetch wrapper: `sendMessage`, `retryMessage`, `parseEscalation` chat endpoints. |
| `api/escalationsApi.js` | Fetch wrapper: all escalation CRUD + transition + link/parse endpoints. |
| `api/templatesApi.js` | Fetch wrapper: template CRUD + usage increment. |
| `api/playbookApi.js` | Fetch wrapper: list categories, get/put category content, reload. |
| `api/analyticsApi.js` | Fetch wrapper: summary, categories, resolution-time, volume, agents. |
| `api/devApi.js` | Fetch wrapper: dev chat (SSE), abort session, file read, file tree. |

### Server — `server/src/`

| File | Description |
|------|-------------|
| `index.js` | Express entry point. Mounts all routers, MongoDB connection with DNS override, graceful shutdown, Claude CLI warm-up on start. |
| `services/claude.js` | Claude CLI subprocess wrapper. `chat()` — streaming with SSE, image temp-file handling, cleanup on disconnect. `parseEscalation()` — structured output via `--json-schema`. `warmUp()` — pre-warms CLI on server start. |
| `routes/chat.js` | `chatRouter` (POST `/api/chat`, POST `/api/chat/retry`, POST `/api/chat/parse-escalation`) + `conversationsRouter` (GET/PATCH/DELETE `/api/conversations`, GET `/api/conversations/:id/export`). SSE streaming, full conversation history reconstruction per request, auto-title generation. |
| `routes/escalations.js` | Full CRUD + `POST /transition`, `POST /link`, `POST /parse`, `POST /quick-parse`. Allowlist-based mass-assignment protection. Claude + regex fallback parsing. |
| `routes/templates.js` | Full CRUD + `POST /:id/use` (usage count increment). |
| `routes/playbook.js` | `GET/PUT /categories/:name`, `POST /reload`. Path traversal protection via `safeName()`. In-memory reload of loaded playbook. |
| `routes/analytics.js` | `GET /summary`, `/categories`, `/resolution-time`, `/volume`, `/agents`. MongoDB aggregation pipeline. Date range filters with validation. |
| `routes/copilot.js` | SSE streaming co-pilot endpoints. `POST /suggest-response` (from escalation), `POST /summarize`, `POST /identify-category`, `POST /draft-reply` (from template). Focused prompts, playbook-aware. |
| `routes/dev.js` | Developer mode backend. `POST /chat` (raw Claude Code stream-json), `POST /abort`, `GET /sessions`, `GET /file`, `GET /tree`. Path traversal protection. Event type classifier (`classifyEvent()`). |
| `models/Escalation.js` | Mongoose model: COID/MID, case number, client contact, agent name, attempting/expected/actual/tsSteps, triedTestAccount, category (enum), status (enum: open/in-progress/resolved/escalated-further), resolution, conversationId ref, source, screenshotPaths, resolvedAt, timestamps. Full-text index + compound indexes. |
| `models/Conversation.js` | Mongoose model: title, messages array (role/content/images/timestamp), escalationId ref, timestamps. |
| `models/Template.js` | Mongoose model: category, title, body, variables array, usageCount, timestamps. |
| `lib/playbook-loader.js` | Loads all `playbook/**/*.md` files at startup. Concatenates into `getSystemPrompt()`. Exposes `reloadPlaybook()` for live edits. `getCategories()` returns list of category names. |
| `lib/escalation-parser.js` | Regex-based escalation DM parser. Handles the standard QBO template format (COID/MID, CASE, AGENT, CX IS ATTEMPTING TO, etc.). Category keyword detection for auto-classification. `looksLikeEscalation()` confidence check. |

### Playbook — `playbook/`

| File | Description |
|------|-------------|
| `categories/payroll.md` | Payroll issue resolution guide |
| `categories/bank-feeds.md` | Bank feed connection + reconciliation guide |
| `categories/billing.md` | Subscription, billing, plan change guide |
| `categories/invoicing.md` | Invoice, payment link, recurring invoice guide |
| `categories/permissions.md` | User roles, access, invite/remove guide |
| `categories/reconciliation.md` | Account reconciliation guide |
| `categories/reports.md` | Reporting, export, chart of accounts guide |
| `categories/tax.md` | 1099, sales tax, VAT/GST guide |
| `categories/technical.md` | Browser errors, sync issues, performance guide |
| `templates/chat-responses.md` | Copy-paste response templates for chat DMs |
| `templates/escalation-response.md` | Full escalation response template |
| `templates/known-bug.md` | Known bug response template |
| `templates/needs-investigation.md` | Needs investigation response template |
| `templates/not-reproducible.md` | Not reproducible response template |
| `templates/workaround.md` | Workaround available response template |
| `edge-cases.md` | Edge cases and unusual scenarios guide |
| `error-messages.md` | Common QBO error message reference |
| `escalation-decision-tree.md` | Step-by-step escalation triage decision tree |
| `qbo-urls.md` | QBO URL reference for deep-linking |
| `system-prompt.md` | Claude system prompt instructions for escalation assistant role |
| `translations.md` | Spanish/French QBO term translations for bilingual agents |
| `triage.md` | Escalation triage guide and priority matrix |

---

## Architecture

```
Browser (React 19, Vite 7, :5174)
  |
  |-- Hash router in App.jsx (no react-router)
  |-- 7 views: chat / dashboard / escalation-detail / playbook / templates / analytics / dev
  |-- SSE streams from server for real-time Claude responses
  |
  v
Express 5 API (:4000)
  |-- /api/chat          -- SSE streaming chat + conversation CRUD
  |-- /api/conversations -- Conversation list, rename, export, delete
  |-- /api/escalations   -- CRUD + parse + transition + link
  |-- /api/templates     -- CRUD + usage tracking
  |-- /api/playbook      -- Read/write .md files in playbook/
  |-- /api/analytics     -- MongoDB aggregation pipelines
  |-- /api/copilot       -- Focused Claude prompts for specific tasks (SSE)
  |-- /api/dev           -- Raw Claude Code stream, file browser (SSE)
  |
  v
claude CLI subprocess (`claude -p --output-format stream-json`)
  |-- Uses user's Max subscription (no API key)
  |-- Streaming via stdout line-by-line JSON parsing
  |-- Images via temp files + --image flag
  |-- Structured output via --json-schema for escalation parsing
  |-- Full tool access for dev mode (reads/writes project files)
  |
  v
MongoDB Atlas
  |-- Escalation (COID/MID/case/status/category/links)
  |-- Conversation (messages array with full history)
  |-- Template (body/variables/usageCount)
```

**Data flow for a typical escalation:**
1. Agent pastes escalation DM text into chat or uploads screenshot
2. `POST /api/chat/parse-escalation` → Claude extracts fields → auto-creates Escalation record
3. Agent chats with Claude in chat view → Claude reads full playbook as system prompt → streams response
4. Agent copies suggested reply from TemplateLibrary or Claude's response
5. Escalation resolved → `POST /api/escalations/:id/transition { status: 'resolved' }` → sets `resolvedAt`
6. Analytics picks up the resolved case for resolution time tracking

---

## Features Delivered

### Chat with Claude (streaming + images + playbook context)
Full SSE streaming chat. Conversation history persisted to MongoDB. Each request reconstructs history and sends it as a formatted prompt. Playbook (all 22 `.md` files) injected as system prompt on every request. Image upload via drag-and-drop, base64 encoded, written to temp files and passed via `--image` flag to Claude CLI. Retry last message. Export conversation as text. Auto-title from first message.

### Escalation Dashboard (CRUD + filtering + status transitions)
List view with filters: status, category, COID, agent name, full-text search. Create via manual form or paste+parse (Claude or regex fallback). Status transitions: open → in-progress → resolved → escalated-further. `resolvedAt` timestamp set automatically on resolve. Link escalation to a conversation (bidirectional reference).

### Template Library (copy + usage tracking)
Browse templates by category. One-click copy to clipboard. Create/edit/delete templates. Usage count incremented on copy via `POST /api/templates/:id/use`. Templates editable directly in the browser.

### Playbook Editor (view + edit categories)
List all 9 category files. Click to view markdown content. Edit in textarea and save — writes directly to `playbook/categories/*.md` on disk and calls `reloadPlaybook()` so new content is used immediately in Claude's system prompt.

### Analytics (charts + patterns + trends)
Summary cards: total/open/in-progress/resolved/escalated counts + avg resolution time. Category breakdown bar chart (SVG). Resolution time by category chart. 30-day volume line chart. Top agents by escalation count. All charts built with raw SVG — no chart library dependency.

### Developer Mode (Claude Code in browser)
`DevMode.jsx` + `routes/dev.js`. Sends messages to Claude with full tool access (`--verbose --include-partial-messages`). Streams all raw `stream-json` events. Client classifies and renders each event type differently: text blocks, tool_use blocks (shows tool name + input), tool_result blocks (shows output), system events (session ID). Session resume support via `--resume`. Abort button. File tree browser (`GET /api/dev/tree`). File content viewer (`GET /api/dev/file`). Quick-prompt buttons for common tasks.

### Integration Loop (chat → escalation → template → resolve)
`EscalationDetail.jsx` shows the linked conversation inline. From any escalation, one click to open the linked chat. From chat, one click to create/link an escalation. Templates surfaced in chat view for copy-paste to DM agent. Full loop is wire-connected though not yet polished.

### Escalation Replay (resolved cases as training material)
Analytics view shows resolved escalations with resolution notes. The data structure supports querying resolved cases by category — foundation for a "show me similar resolved cases" feature in future sessions.

### Conversation Forking
`POST /api/conversations/:id/fork` (via `conversationsRouter`). Creates a copy of the conversation up to a selected message index. Surfaced in Chat.jsx as a fork button per message. Useful for exploring alternative Claude responses without losing the original thread.

### Co-pilot (Claude on every screen)
`routes/copilot.js` provides focused endpoints for contextual Claude calls that don't require a full conversation: `suggest-response` (from escalation fields), `summarize`, `identify-category`, `draft-reply` (from a template + escalation context). All stream SSE. The client-side co-pilot panel is wired to these endpoints from EscalationDetail and EscalationDashboard.

### 22-file Playbook Knowledge Base
Full QBO escalation knowledge base written from scratch: 9 category guides, 6 template files, triage guide, escalation decision tree, error message reference, QBO URL reference, translations (ES/FR), system prompt instructions, edge cases. All loaded at server startup and injected into every Claude request.

---

## Known Issues (Still Open)

These were identified during overseer review and are not yet fixed:

### Security

**1. Mass-assignment in `escalations.js` POST/PATCH**
The allowlist in the POST and PATCH handlers is implemented correctly (an explicit `allowed` array with a `for` loop), so true mass-assignment is blocked. However, the `source` field is included in the POST allowlist and can be set by the client to `'screenshot'`, `'manual'`, or `'cli'`, which means clients can spoof the source. Fix: remove `source` from the client-controlled allowlist; derive it server-side from whether an image was provided.

File: `server/src/routes/escalations.js` lines 42-45.

**2. XSS via `dangerouslySetInnerHTML` in `DevMode.jsx`**
DevMode renders tool event data and file content using `dangerouslySetInnerHTML` in several places for code/diff display. Since this is a local single-user tool the risk is low, but it should be replaced with a safe code renderer (e.g., escape the content before inserting, or use a `<pre><code>` block with textContent). Check `DevMode.jsx` for all `dangerouslySetInnerHTML` usages.

File: `client/src/components/DevMode.jsx`.

**3. Tool event data shape mismatch in DevMode**
The `classifyEvent()` function in `routes/dev.js` classifies `assistant` messages that contain `tool_use` blocks. However, the client `useDevChat.js` hook expects `event.data` to have a specific shape when the event type is `tool_use`. If the Claude CLI emits tool events in a slightly different structure (e.g., `content_block_start` for tool_use vs. a full `assistant` message), the rendering can break. Needs end-to-end testing with a real tool-using Claude response.

Files: `server/src/routes/dev.js` (`classifyEvent`), `client/src/hooks/useDevChat.js`.

**4. `detectEscalationFields` category normalization**
In `escalation-parser.js`, the `CATEGORY_KEYWORDS` map uses keys like `'bank-feeds'` and `'reporting'`, but the Escalation model enum includes `'reporting'` (not `'reports'`). The playbook files are named `reports.md` but the enum value is `'reporting'`. These need to be reconciled. Also, the parser returns `'reporting'` from keywords but Claude's structured output schema lists `'reporting'` — verify both paths agree.

File: `server/src/lib/escalation-parser.js` line 34 (`'reporting'`), `server/src/models/Escalation.js` line 23.

### Missing Features

**5. Screenshot manager not yet built**
The plan called for a screenshot manager that would automatically capture QBO screenshots, save them to disk, and attach them to escalations. The `screenshotPaths` field exists on the Escalation model but nothing writes to it yet. Planned endpoint: `POST /api/escalations/:id/screenshots` (multipart upload). Needs: multer, a `screenshots/` directory, and a client-side uploader component.

**6. Dev mode conversation persistence endpoints missing**
`useDevChat.js` manages conversation history entirely in-memory (local React state). If you refresh the page, all dev conversations are lost. The `/api/dev/` route has no persistence endpoints. Either add a `DevConversation` model and wire up save/load, or document clearly that dev mode is ephemeral by design. The session resume (`--resume`) does persist in Claude's own history files, but the client display is lost.

---

## Next Session Priorities

### 1. Fix remaining bugs (30 min)
- Fix `source` field spoofing in `escalations.js` POST — derive server-side
- Audit `DevMode.jsx` for `dangerouslySetInnerHTML` — replace with safe rendering
- Reconcile `'reporting'` vs `'reports'` in parser + model enum
- Test `classifyEvent` with real tool-use output from Claude CLI

### 2. Build screenshot manager (45 min)
- Install `multer` in `server/`
- Create `server/uploads/screenshots/` directory (add to `.gitignore`)
- Add `POST /api/escalations/:id/screenshots` endpoint (multipart)
- Add `DELETE /api/escalations/:id/screenshots/:filename` endpoint
- Build `ScreenshotManager.jsx` component (drag-drop, thumbnail grid, attach to escalation)
- Wire `screenshotPaths` field to be served as static files

### 3. Test full workflow end-to-end with real MongoDB data (30 min)
- Start the app (`npm run dev`)
- Create a test escalation by pasting a real DM template
- Verify Claude parses it correctly (check all fields populated)
- Open chat, ask Claude a question about the escalation
- Copy a suggested response, save resolution notes, mark resolved
- Check analytics reflect the resolved case
- Export the conversation

### 4. Test Claude integration with real escalation screenshots (20 min)
- Upload a screenshot to the chat view
- Verify Claude receives it via the `--image` temp file path
- Verify temp files are cleaned up after response
- Test `POST /api/chat/parse-escalation` with a real screenshot

### 5. Polish UI based on real usage (ongoing)
- Response rendering in `ChatMessage.jsx`: currently plain text — add basic markdown rendering (bold, code blocks, bullet lists) without a heavy library
- Copilot panel visibility — the co-pilot is wired but not always visible in the UI; consider a floating trigger button on every screen
- Mobile responsiveness: the grid layout needs testing at 768px

### 6. Add conversation pinning feature
- Add `pinned: Boolean` field to Conversation model
- `PATCH /api/conversations/:id { pinned: true }` endpoint
- Pinned conversations shown at top of sidebar list
- Useful for saving the "master escalation reference" conversation

### 7. Code-split Phase 2+ views for smaller initial bundle
- `Analytics.jsx`, `DevMode.jsx`, and `PlaybookEditor.jsx` are large components rarely needed on load
- Add `React.lazy()` + `Suspense` in `App.jsx` for those three views
- Can cut initial JS bundle by 30-40%

---

## How to Start the App

```bash
cd C:\Users\NewAdmin\Desktop\PROJECTS\qbo-escalations

# Install dependencies (first time or after package changes)
cd client && npm install && cd ..
cd server && npm install && cd ..

# Copy env file if not done
cp server/.env.example server/.env
# Edit server/.env: set MONGODB_URI

# Start both servers
npm run dev
# Client: http://localhost:5174
# Server: http://localhost:4000
# API health: http://localhost:4000/api/health
```

On first start, the server warms up the Claude CLI (fires a test `claude -p hello` in the background). This takes 10-30 seconds. You will see `Claude CLI warm-up complete` in the server console when ready.

The playbook is loaded synchronously at startup. You will see log output listing all loaded `.md` files if `console.log` is enabled in `playbook-loader.js`.

---

## Team Performance Notes

**What worked well:**

- **Incremental commit cadence** — 14 commits from scaffold to feature-complete. Each commit was a clean, working increment. No big-bang commits that made debugging hard.

- **Separation of concerns from day one** — Server routes each got their own file. Models, services, and lib were separated cleanly. This made the codebase navigable immediately.

- **SSE as the streaming primitive** — Using `text/event-stream` for all Claude responses (chat, copilot, dev mode) was the right call. It's simple, debuggable in the browser Network tab, and cleanly abortable via `req.on('close')`.

- **Regex fallback parser** — Building `escalation-parser.js` as a no-Claude fallback for text parsing was a strong defensive pattern. When Claude CLI is slow or unavailable, escalations can still be ingested quickly.

- **Playbook as live-editable system prompt** — Wiring `PlaybookEditor.jsx` directly to the disk files + `reloadPlaybook()` means the knowledge base can be iterated without a code deploy. This is the right architecture for a knowledge tool.

**Patterns to repeat in future sessions:**

- Always build the API layer first (models → routes), then the client fetch wrappers, then the UI components. The session followed this order and it worked well.

- For SSE endpoints: always include the heartbeat interval, always clean up on `req.on('close')`, always send a `start` event with IDs before streaming begins.

- For dev mode or any "raw subprocess" feature: always classify event types server-side before sending to the client. The `classifyEvent()` pattern in `dev.js` makes the client rendering logic clean.

**What to watch in future sessions:**

- The `useDevChat.js` hook is complex (220+ lines). If it grows further, split it into smaller hooks or extract a `DevConversation` class.

- `Analytics.jsx` uses raw SVG with hardcoded geometry. If more chart types are needed, consider a lightweight charting library (Recharts or Chart.js) rather than extending the custom SVG code.

- The playbook system prompt grows with every new `.md` file. Claude CLI has a token limit. Monitor prompt size — if the system prompt exceeds ~100K tokens it may need to be chunked or summarized per-category.
