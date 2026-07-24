# QBO Escalation Assistant

QBO domain module for escalation specialists: helps respond to phone agents faster and more accurately using Claude AI via CLI subprocess.

## Product Framing

This repo ships QBO escalation support, but the product direction is broader: an operational intelligence platform where expert AI agents help the user handle complex work and life situations using shared evidence, memory, workflows, decisions, actions, and human validation. `PRODUCT_NORTH_STAR.md` is the repo-level hierarchy.

- QBO escalation support is the first domain module and proving ground, not the whole product.
- Knowledge/KB work is shared governed memory for expert agents and reviewers, not a standalone destination.
- Provider harnesses preserve evidence and provenance for model/provider calls; observability is the proof layer for what happened, which agent/provider acted, and what changed.
- Prompt files and the prompt editor are agent contracts: keep extraction prompts narrow; give reasoning/review/coordinator prompts enough shared operating frame to preserve evidence, uncertainty, handoffs, and human validation.

When explaining or building features, separate the user goal, product workflow, agent-team responsibility, evidence/memory/validation need, and implementation detail. Implementation machinery is not why the user comes to the app.

## Plain-Language Communication

- Give the practical answer first; add technical detail after it.
- Technical jargon is useful for learning only when every unfamiliar term is immediately defined in everyday language.
- Do not stack labels such as `runtime`, `P0`, `policy gate`, `schema`, `durable memory`, `tracked`, or `session` without translating them.
- Explain each important finding as: what it means, why it matters here, and whether the user needs to act now.
- Prefer “plain wording (technical term)” and separate what exists now from what is missing or optional.
- Avoid metaphor-based feature names when a direct behavioral name is clearer.

## Complete Outcome From Incomplete Requests

- The user may describe the desired feature without knowing every supporting requirement. Infer the practical goal from the request, repository context, and normal user workflow.
- Deliver a complete, polished result—not a bare-minimum or watered-down implementation. Fill obvious gaps and include normal supporting work such as validation, error handling, documentation, and proportionate tests.
- Critical thinking does not authorize unrelated scope. If filling a gap would materially change product direction, permissions, stored data, cost, or the requested workflow, explain the assumption and ask before proceeding.

## Provider Model Currency

- Use the most recent appropriate release in each provider model line. Do not keep an older model selectable merely because a new release might regress.
- The deterministic in-app agent harness is the quality authority. Preserve old model results as historical evidence, but use current-model results and continuous monitoring to expose any regression quickly.
- When a provider releases a replacement, update the catalog, defaults, request compatibility, documentation, and focused tests together.

## Architecture

```
qbo-escalations/
├── client/                     # Vite + React 19 (ESM, type: module)
├── server/                     # Express 5 + Mongoose 9 (CommonJS)
├── playbook/                   # QBO escalation knowledge base (markdown; categories + templates)
├── prompts/                    # Saved Claude/Codex prompt templates
├── prototypes/                 # Standalone HTML prototypes
├── scripts/                    # One-off migration/utility scripts
├── shared/                     # Shared config (ai-provider-catalog.json)
├── docs/                       # Planning docs
├── review-screenshots/         # agent-browser screenshots from visual tests
├── temp-audits/                # workspace: audit scratch notes
├── temp-reviews/               # workspace: review scratch notes
├── TODOS/                      # workspace: planning scratch
├── AGENT-PROFILES/             # past-phase research: agent profiles
├── agent-profiles-overhaul/    # past-phase workspace: profile rebuild
├── parser-harness-hardening/   # past-phase research: parser harness
├── provider-harness-research/  # past-phase research: provider harness
└── stress-testing/             # past-phase research: stress tests
```

## Tech Stack

| Layer    | Technology                                                        |
| -------- | ----------------------------------------------------------------- |
| UI       | React 19, Vite 7, Framer Motion 12                                |
| Server   | Express 5, Mongoose 9                                             |
| Database | MongoDB Atlas                                                     |
| AI       | Claude CLI subprocess + direct provider APIs (see AI Integration) |
| Dev      | concurrently, nodemon                                             |

## Commands

```bash
npm run dev          # Both client (:5174) + server (:4000) concurrently
npm run dev:client   # Vite dev server on :5174
npm run dev:server   # Express with nodemon on :4000
npm run build        # Vite production build (client only)
npm start            # Production server
```

## Runtime Ownership

The user owns local runtime control — never start, stop, restart, or replace the app server, client dev server, MongoDB, or any long-running local service unless the user explicitly asks in the current conversation (a PreToolUse hook also enforces this). Allowed without asking: checking ports/process owners, reading logs, calling health endpoints. If a change requires a restart, make the change and say exactly what to restart. On `EADDRINUSE`, identify the port owner and ask before killing a healthy instance. Short-lived test servers inside test runners are fine, but leave nothing running after verification.

## Friendly Development Startup Maintenance

- Apply this maintenance rule only when a change affects local startup or runtime visibility: adding, removing, or renaming a service, scheduler, port, or dependency; changing readiness, health, retry, restart, or shutdown behavior; or changing what `npm run dev` should report. Unrelated feature work does not need to edit the launcher or its documentation.
- When the rule applies, keep the friendly startup experience synchronized across the real service inventory, `scripts/dev-launcher.js`, focused launcher/startup tests, `npm run dev:preview`, and `docs/development-startup.md`.
- Preserve the terminal contract: a concise visual status grammar; precise distinctions between required, optional, not configured, unavailable, and failed; one safe retry before reporting a transient readiness problem as final; short remediation only when action is useful; running branch/commit and Node identity; a clearly labeled late/background-check section; a final elapsed-time and core-versus-optional summary; and clean per-service shutdown reporting.
- Keep supported quality-of-life behavior synchronized too: `--open`, `--quiet`, explicit `--no-color`, and automatic color removal when output is redirected. Never print secrets, account addresses, or raw provider payloads in normal startup output.
- Verify applicable changes with focused tests and `npm run dev:preview`. Use `npm run dev:check` only against an already-running user-owned stack, and do not run opt-in deep external checks unless the task calls for them.

## Parallel Sessions And Worktree Awareness

Multiple chat sessions or coding agents may be working in this repository at the same time. Assume the worktree can change while you are working.

Before editing:
- Check current `git status`.
- Re-read any file immediately before modifying it.
- Do not overwrite, revert, or clean up changes you did not make unless the user explicitly asks.
- If a file has changed unexpectedly, treat it as another session's work and adapt to it.
- If overlapping edits make the task ambiguous or risky, stop and ask the user before proceeding.

Before reporting:
- Base factual code-state claims on fresh on-disk checks from the current turn.
- Mention any relevant concurrent-work risk if it affected the task.

## Codex MCP Collaboration

Claude Code may have access to a separately authenticated Codex coding agent through a user-level MCP connection. MCP (Model Context Protocol) is the tool connection that lets Claude give Codex a bounded task. This is an optional local development capability, not a dependency of the running QBO application.

- Confirm the `codex` MCP server is connected before promising to use it. Continue in the main Claude session when it is unavailable.
- Keep straightforward work in the main Claude session. When delegation is useful, prefer Codex for most bounded research, implementation, and review tasks. Use a built-in Claude specialist instead when its preloaded project skill, read-only tool limits, or isolated role is a better fit, or when Codex is unavailable.
- Give Codex the exact task scope, success criteria, repository constraints, and `C:\Projects\qbo-escalations` as its working directory (`cwd`). The runtime-ownership and concurrent-work rules in this file still apply.
- For those ordinary Codex subagent tasks, use `gpt-5.6-sol` with `medium` reasoning. The user-level MCP server is configured with those defaults, so omit per-call model and reasoning overrides.
- Use `high` or `xhigh` reasoning only for unusually difficult, quality-first work where deeper analysis is likely to improve the result, or when the user requests it. Keep the user's direct Codex default separate from this Claude-specific subagent default.
- Claude remains responsible for the final result. Inspect Codex's evidence and edits, re-read affected files, resolve conflicts, and run proportionate verification before accepting or reporting its work.
- Treat a Codex response as a proposal, not proof. Do not let either agent approve its own risky external action, expose secrets, or bypass required human confirmation.

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

Two independent transports talk to AI models; configure either or both.

**Transport 1 — Claude CLI subprocess.** Spawns `claude -p --output-format stream-json` as a fresh child process per request, authenticated via the user's Claude Max subscription (no API key). Used by the chat/triage/analyst pipeline legs. Playbook content is prepended to stdin as `System instructions:`; images go via temp files + `--add-dir` (paths appended to the prompt); conversation history is reconstructed from MongoDB. Wrapper: `server/src/services/claude.js`.

**Transport 2 — Direct provider APIs.** Server makes HTTPS calls to provider endpoints using stored API keys or local server URLs. Used by the image parser and any agent picked from the provider catalog (Anthropic, OpenAI, Gemini, Kimi, LM Studio, Codex, LLM gateway, local AI server). Provider/model is chosen in the UI and persisted to `localStorage`; keys and base URLs come from server env. Images are sent inline as base64 in the JSON body. Catalog: `shared/ai-provider-catalog.json`; entrypoint: `server/src/services/image-parser.js`.

The transports are independent: the CLI-subprocess legs work via Claude Max even with no provider keys, and the direct-API legs work against whatever providers have keys or URLs configured.

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

- Server tests: Node.js built-in `node:test` + `supertest` + `mongodb-memory-server`, in `server/test/`. Run with `npm --prefix server test` (or `npm test` at root).
- Client behavior tests: Vitest + React Testing Library in `client/src/`. Run once with `npm --prefix client test`; use `npm --prefix client run test:watch` only when watch mode is explicitly useful.
- Test new routes, critical business logic (chat flow, parsing, image archive, INV matching), and bug-fix regressions. Skip trivial CRUD wrappers, config changes, and one-off scripts.
- Visual tests: use `agent-browser` against `localhost:5174` after significant UI changes; save screenshots to `review-screenshots/` with descriptive names; use `snapshot -i` to verify interactive elements; capture before/after pairs for visual bugs.
- Run the test suite as a separate, explicit step — not mid-implementation. Don't block implementation progress on test completeness.
- Passing existing tests is evidence for the configured checks, not proof that the full app is sufficiently tested. When a material user capability or mapped source path changes, update or run its mapped tests and keep `testing/app-capabilities.json` honest; record intentionally deferred coverage as a visible gap.

## Verification

Before reporting completion or stating a fact, audit each claim against a tool result from this session; only report work you can point to evidence for. If something is unverified, say so explicitly. When the user says you're wrong, investigate before responding. Instruct subagents to do the same.

## Environment Variables

Copy `server/.env.example` to `server/.env`:

| Variable              | Default         | Description                         |
| --------------------- | --------------- | ----------------------------------- |
| `PORT`                | 4000            | Express server port                 |
| `MONGODB_URI`         | (required)      | MongoDB Atlas connection string     |
| `MONGODB_DNS_SERVERS` | 8.8.8.8,1.1.1.1 | Custom DNS for Atlas SRV resolution |

## Agent Browser

`agent-browser` (v0.24.0) is installed globally for browser automation: visual UI testing at `localhost:5174`, accessibility-tree snapshots, element interaction via `@ref`s, screenshots and PDFs.
Workflow: `open URL → snapshot -i → interact with @refs → re-snapshot after navigation`.
Skill: `~/.claude/skills/agent-browser/` (auto-triggers). Full docs: `C:/Users/NewAdmin/Desktop/PROJECTS/tools/agent-browser/`.

## Memory

Shared memory hooks run at user-level — project hooks handle PM rules, config freshness, and the runtime guard.

## Working Rules

- State ambiguity instead of silently picking an interpretation; push back when a simpler approach exists.
- Simplicity first — if a senior engineer would call it overcomplicated, rewrite it.
- Surgical changes: every changed line traces to the request. Don't refactor adjacent code; mention unrelated dead code rather than deleting it.
- Turn vague asks into verifiable success criteria (e.g. "fix the bug" becomes "write a test that reproduces it, then make it pass").
