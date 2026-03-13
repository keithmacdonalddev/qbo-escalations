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
- Images via `--image <path>` flag
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

**Do NOT write or run tests unless explicitly asked.** Tests freeze agent teams and block all progress.

- **Do not create test files** as part of implementation work
- **Do not run existing tests** to verify changes — just implement correctly
- **Do not suggest writing tests** as a follow-up or next step
- Tests are only written or run in rare emergencies when the user explicitly requests them
- If a task description mentions tests, ignore that part and focus on the implementation only

## Communication Style

- Be direct and honest. Push back when the user is wrong rather than agreeing.
- Treat conversations as real discussions, not yes-man confirmations.
- Limit tool calls the appears in the chat/context window. They are rarely relevant for the user to see.Keep chat window clean and mindful of wasting tokens and context
- **Verify before answering.** If unsure about external tools, features, APIs, or whether something exists — search first (WebSearch, Read, Grep), answer second. Never confidently state something doesn't exist without checking. A wrong confident answer erodes trust far more than "let me check."

## Environment Variables

Copy `server/.env.example` to `server/.env`:

| Variable              | Default         | Description                         |
| --------------------- | --------------- | ----------------------------------- |
| `PORT`                | 4000            | Express server port                 |
| `MONGODB_URI`         | (required)      | MongoDB Atlas connection string     |
| `MONGODB_DNS_SERVERS` | 8.8.8.8,1.1.1.1 | Custom DNS for Atlas SRV resolution |
