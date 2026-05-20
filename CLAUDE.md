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
| AI       | Claude CLI subprocess + direct provider APIs (see AI Integration) |
| Dev      | concurrently, nodemon                                           |

## Commands

```bash
npm run dev          # Both client (:5174) + server (:4000) concurrently
npm run dev:client   # Vite dev server on :5174
npm run dev:server   # Express with nodemon on :4000
npm run build        # Vite production build (client only)
npm start            # Production server
```

## Runtime Ownership And Server Control

The user owns local runtime control. Agents must not start, stop, restart, reload, or replace the app server, client dev server, gateway, MongoDB process, or any long-running local service unless the user explicitly asks for that runtime action in the current conversation.

This includes `npm run dev`, `npm run dev:server`, `npm --prefix server run dev`, `npm start`, `nodemon` restarts, typing `rs`, `Stop-Process`, `taskkill`, killing port owners, or launching hidden/background server processes.

Allowed without changing runtime state:

- Check ports and process owners.
- Read logs.
- Call health endpoints.
- Explain what needs to be restarted.

If a config/code change requires a restart, make the change and tell the user exactly what to restart. Do not perform the restart unless asked.

If a port conflict such as `EADDRINUSE` occurs, first identify the current port owner and whether it is serving the app. Preserve a healthy live instance by default. Ask before killing or replacing it unless the user has already explicitly said to close that process.

Test commands may run their own short-lived isolated test servers when that is part of the test runner, but do not leave persistent dev or production services running after verification.

## Key Files

| File                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `client/src/App.jsx`            | Main React component                               |
| `client/src/main.jsx`           | React root entry                                   |
| `client/vite.config.js`         | Vite config, proxies /api/\* to :4000              |
| `server/src/index.js`           | Express entry point, MongoDB connection            |
| `server/src/services/claude.js` | Claude CLI subprocess wrapper                      |
| `server/src/routes/chat.js`     | Chat API with SSE streaming                        |
| `server/src/models/`            | Mongoose models                                    |
| `playbook/`                     | QBO knowledge base loaded as system prompt context |

## AI Integration

The app uses **two independent transports** for talking to AI models. They run side by side; configure either or both.

### Transport 1 — Claude CLI subprocess

Spawns `claude -p --output-format stream-json` as a child process, authenticated via the user's Claude Max subscription. No API key needed.

- Used by: chat / triage / analyst legs of the pipeline
- Streaming via `--output-format stream-json`
- Playbook content prepended to stdin as `System instructions:`
- Images via temp files + `--add-dir` (paths appended to prompt text)
- Each request spawns a fresh process; conversation history reconstructed from MongoDB
- Wrapper: `server/src/services/claude.js`

### Transport 2 — Direct provider APIs

Server makes HTTPS calls directly to provider endpoints using stored API keys or local server URLs.

- Used by: image parser, and any agent the user picks from the provider catalog
- Providers: Anthropic, OpenAI, Gemini, Kimi, LM Studio, Codex, LLM gateway, and the user's local AI server
- Provider/model chosen via UI dropdown, persisted to `localStorage`; API keys / base URLs come from server env
- Images sent inline as base64 in the JSON request body (not via temp files)
- Provider catalog: `shared/ai-provider-catalog.json`
- Image-parser entrypoint: `server/src/services/image-parser.js`

### Mixing transports

The two transports are independent. If you only have a local API server configured (no Anthropic/OpenAI key), the CLI-subprocess legs still work via Claude Max, and the direct-API legs work against whatever providers you have keys or URLs for.

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

## More Rules

- Think before coding Don't assume. Don't hide confusion. State ambiguity explicitly. Present multiple interpretations rather than silently picking one. Push back if a simpler approach exists. Stop and ask rather than guess.
- Simplicity first. The test: would a senior engineer say this is overcomplicated? If yes, rewrite it.
- Surgical changes. Don't "improve" adjacent code. Don't refactor things that aren't broken. Match the existing style even if you'd do it differently. If you notice unrelated dead code, mention it, don't delete it. Every changed line should trace directly to the request.
- Goal-driven execution. Transform "fix the bug" into "write a test that reproduces it, then make it pass." Transform "add validation" into "write tests for invalid inputs, then make them pass." Give it success criteria and watch it loop until done.
