# QBO Escalation Assistant

Tool for QBO (QuickBooks Online) escalation specialists. Helps respond to phone agents faster and more accurately using Claude AI via CLI subprocess.

## Architecture

```
qbo-escalations/
├── client/          # Vite + React 19 (ESM, type: module)
├── server/          # Express 5 + Mongoose 9 (CommonJS)
├── playbook/        # QBO escalation knowledge base (markdown files)
│   ├── categories/  # Topic-specific guides (payroll, bank-feeds, etc.)
│   └── templates/   # Response templates (acknowledgment, resolution, etc.)
├── prompts/         # Saved Claude/Codex prompt templates
├── prototypes/      # Standalone HTML prototypes
├── scripts/         # One-off migration/utility scripts
├── shared/          # Shared config (ai-provider-catalog.json)
└── docs/            # Planning docs
```

## Tech Stack

| Layer    | Technology                                                      |
| -------- | --------------------------------------------------------------- |
| UI       | React 19, Vite 7, Framer Motion 12                              |
| Server   | Express 5, Mongoose 9                                           |
| Database | MongoDB Atlas                                                   |
| AI       | Claude CLI subprocess (`claude -p --output-format stream-json`) |
| Dev      | concurrently, nodemon                                           |

## Commands

```bash
npm run dev          # Both client (:5174) + server (:4000) concurrently
npm run dev:client   # Vite dev server on :5174
npm run dev:server   # Express with nodemon on :4000
npm run build        # Vite production build (client only)
npm start            # Production server
```

## Key Files

| File                            | Purpose                                              |
| ------------------------------- | ---------------------------------------------------- |
| `client/src/App.jsx`            | Main React component                                 |
| `client/src/main.jsx`           | React root entry                                     |
| `client/vite.config.js`         | Vite config, proxies /api/\* to :4000                |
| `server/src/index.js`           | Express entry point, MongoDB connection              |
| `server/src/services/claude.js` | Claude CLI subprocess wrapper                        |
| `server/src/routes/chat.js`     | Chat API with SSE streaming                          |
| `server/src/models/`            | Mongoose models                                      |
| `playbook/`                     | QBO knowledge base loaded as system prompt context   |

## Claude Integration

Uses Claude CLI subprocess (`claude -p`) with the user's Max subscription. No API key needed.

- Streaming via `--output-format stream-json`
- Playbook content prepended to stdin as `System instructions:`
- Images via temp files + `--add-dir` (paths appended to prompt text)
- Each request spawns a fresh process; conversation history reconstructed from MongoDB

## API Response Format

All endpoints return `{ ok: true/false, ... }`. Errors include `code` and `error` fields.

## Key Patterns

- **CommonJS server / ESM client** — server uses `require()`, client uses `import`
- **No state library** — React local state + hooks only
- **Express 5** — async errors auto-caught, no try/catch + next(err) needed
- **Vite proxy** — `/api/*` proxied to localhost:4000 in dev
- **50MB body limit** — for base64 image uploads
- **Graceful shutdown** — SIGINT/SIGTERM handling

## Testing Policy

Write tests for important or high-risk parts of the application. Do not over-test trivial changes.

### Server Tests
- **Framework**: Node.js built-in `node:test` + `supertest` + `mongodb-memory-server`
- **Location**: `server/test/`
- **Run**: `npm test` (root) or `npm --prefix server test`
- **Write tests for**: new routes, critical business logic (chat flow, parsing, image archive, INV matching), bug fix regressions
- **Skip tests for**: trivial CRUD wrappers, config changes, one-off scripts

### Visual Tests (agent-browser)
- Use `agent-browser` to screenshot the UI at `localhost:5174` after significant UI changes
- Save screenshots to `review-screenshots/` using descriptive filenames (e.g., `desktop-chat-after-fix.png`)
- Use `agent-browser snapshot -i` to verify interactive elements are present and correctly labelled
- Capture before/after pairs when fixing visual bugs

### Rules
- Do not run the test suite mid-implementation — run tests as a separate, explicit step
- Do not write tests for every change — only when the change is high-risk or explicitly requested
- Never block implementation progress waiting on test completeness
- New server routes and critical logic changes should include or update a test file

## Verification — MANDATORY (hardened 3x, 7+ failures logged)

**If you have not verified it with a tool call in THIS conversation, do not state it as fact. Say "let me check." No exceptions. EVER.**

This applies to EVERYTHING — code, APIs, product specs, pricing, hardware details, general knowledge, subagent output, recommendations, advice. There is no category of information exempt from verification.

- **Do not parrot subagent/research output.** Critically review it first. Check if it accounts for user context (location, hardware, preferences).
- **Do not rely on training data for facts.** Training data is stale and wrong often enough to destroy trust.
- **When the user says you're wrong, investigate immediately.** Do not argue or repeat the same answer.
- **Flag uncertainty explicitly.** "The search found X but I haven't independently verified it" is always better than presenting something as fact.
- **Instruct ALL subagents** to verify their own findings and flag what they couldn't confirm.
- **Accuracy over speed — ALWAYS.** A slower correct answer beats a fast wrong one. Nobody asked for speed.

## Environment Variables

Copy `server/.env.example` to `server/.env`:

| Variable              | Default         | Description                         |
| --------------------- | --------------- | ----------------------------------- |
| `PORT`                | 4000            | Express server port                 |
| `MONGODB_URI`         | (required)      | MongoDB Atlas connection string     |
| `MONGODB_DNS_SERVERS` | 8.8.8.8,1.1.1.1 | Custom DNS for Atlas SRV resolution |

## Agent Browser

`agent-browser` (v0.24.0) is installed globally and available to all agents for browser automation:

- Visual UI testing of the React client at `localhost:5174`
- Accessibility tree snapshots for understanding page structure
- Element interaction (click, fill, select) using `@ref` system
- Screenshots and PDFs for review
- Automated navigation and form testing

**Skill**: installed at `~/.claude/skills/agent-browser/` — auto-triggers for browser automation requests.
**Source + full docs**: `C:/Users/NewAdmin/Desktop/PROJECTS/tools/agent-browser/`

Workflow: `open URL → snapshot -i → interact with @refs → re-snapshot after navigation`

## Claude Code

### Quick Reference
- Full dev: `npm run dev` (server + client concurrently)
- Server only: `npm run dev:server`
- Client only: `npm run dev:client`
- Build client: `npm run build`
- Image parser test: `npm run test:image-parser`

### Memory
- Shared memory hooks run at user-level — project hooks handle PM rules and config freshness only.
