# Harness storage and serving

## Where harnesses live

- Source of truth at runtime: **markdown files on disk** under `prompts/agents/*.md`.
- Frozen registry mapping `id → filePath`: `server/src/lib/agent-prompt-store.js:13-137`.
- No database table for the prompt content itself. The DB only stores parse *results* (`ImageParseResult`) and identity profile data (`AgentIdentity`).

## How the server loads them at runtime

- `getRenderedAgentPrompt(id)` at `server/src/lib/agent-prompt-store.js:261-263` is the only function `parseImage()` uses. It calls `readAgentPrompt(id)` which is a plain `fs.readFileSync(definition.filePath, 'utf-8')` (`agent-prompt-store.js:251-259`).
- **No cache.** Every parse request triggers a fresh disk read of the markdown file. Confirmed by `services/image-parser.js:1521`.
- A `chat-core` save triggers `reloadPlaybook()` (`agent-prompt-store.js:22`); other ids have no afterWrite hook.

## How the UI serves them

`server/src/routes/agent-prompts.js` exposes a CRUD surface mounted at `/api/agent-prompts`:

| Verb   | Path                              | Behaviour                                                                                                                          |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                              | Lists visible definitions with size + mtime metadata (`agent-prompts.js:88`).                                                       |
| GET    | `/:id`                           | Reads the live markdown content (`agent-prompts.js:151`).                                                                           |
| PUT    | `/:id`                           | Writes new content; **snapshots current content first** then writes; appends an audit-history entry (`agent-prompts.js:167-194`).   |
| GET    | `/:id/versions`                  | Lists snapshot timestamps + optional labels (`agent-prompts.js:92-97`).                                                             |
| GET    | `/:id/versions/:ts`              | Returns one snapshot's content (`agent-prompts.js:99-115`).                                                                         |
| POST   | `/:id/restore/:ts`               | Snapshots current, copies snapshot back into the live file, audit-logs the restore (`agent-prompts.js:117-149`).                    |

The client talks to those endpoints via `client/src/api/agentPromptsApi.js`.

## Versioning — confirmation/correction

Previous research said `AGENT_PROMPT_VERSIONS_ROOT` "is referenced but `getRenderedAgentPrompt` does not consult it". **That is technically true but misleading** — the runtime render path correctly does not consult versions (it always reads the live file), and a fully functional versioning system is built around it:

- `AGENT_PROMPT_VERSIONS_ROOT = prompts/versions/agents/<id>/` (`agent-prompt-store.js:10`).
- Every `PUT /api/agent-prompts/:id` call snapshots current content to `prompts/versions/agents/<id>/<timestamp>.md` and optionally writes a label sidecar `<timestamp>.label` (`routes/agent-prompts.js:51-77` via `snapshotVersion`).
- 20-snapshot cap per id (`MAX_VERSIONS` at `routes/agent-prompts.js:19`); oldest pruned automatically.
- Restore is a copy-back operation, not a rename — the snapshot stays in history.
- Versioning is NOT half-built or dead. It is live and used by the UI.

Current state on disk: `prompts/versions/agents/` exists but is empty — no edits via the UI have happened yet on this checkout. All parser prompt updates so far are git commits.

## Audit trail

Two layers:
1. **Snapshot files**: timestamped `.md` snapshots under `prompts/versions/agents/<id>/` per save (described above). Recoverable by any operator.
2. **Per-agent activity log**: `appendAgentHistory(agentId, { type: 'prompt-edit'|'prompt-restore', ... })` at `routes/agent-prompts.js:138-144, 180-188` writes to the `AgentIdentity` document's history array. Visible in the UI on the agent profile's Activity tab.
3. Git is still the durable history for the prompt files themselves (the live `.md` is committed to the repo; the snapshot directory is gitignored — verified below).

`prompts/versions/agents/` is NOT in `.gitignore` explicitly; confirmed by searching `.gitignore` (nothing matches `versions/agents`). So snapshots WILL be tracked by git if they exist when someone commits. There's no `.gitignore` filter for them — currently a non-issue because the directory is empty. Flag this in `surprises.md`.

## How an edit propagates

- User clicks "Save Prompt" in the Prompt tab.
- Client PUTs to `/api/agent-prompts/:id` with new content (and optional label).
- Server snapshots current file to `prompts/versions/agents/<id>/<ts>.md`.
- Server writes new content to live `prompts/agents/<id>.md`.
- Server appends history entry.
- Next call to `parseImage()` reads the live file fresh (no cache) and uses the new content immediately.
- No restart, no hot-reload event, no warm-up. The prompt is live on the very next request.

## What this means for hardening

- We can iterate on the prompt without restarting the server.
- Every iteration is auto-versioned for rollback.
- A future canary harness can A/B against multiple prompt versions by reading from snapshot files.
- The `SYSTEM_PROMPT` constant at `services/image-parser.js:664-733` is **not** part of this pipeline (it is only referenced by tests, see `current-harness-content/dead-system-prompt-constant.md`). The live answer is unambiguously the markdown file.

Last updated: 2026-05-19
