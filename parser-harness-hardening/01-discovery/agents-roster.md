# Full agent roster

The previous research treated this as "three parser prompts." It is much larger: the prompt registry has 13 frozen definitions, plus custom-agent slots, plus auxiliary services. Below is the live inventory.

## Where the registry lives

`server/src/lib/agent-prompt-store.js:13-137` — `AGENT_PROMPT_DEFINITIONS` (frozen array of 13 entries).
`server/src/services/room-agents/agent-profiles.js:3-180` — `DEFAULT_PROFILES` registry (8 entries, the persona/avatar layer that the Agent Mission Control UI binds to identity records).
`server/src/services/agent-identity-service.js:105-114` — `AGENT_PROMPT_MAP` mapping prompt-ids to identity ids (e.g. `image-parser` → `image-analyst` persona).

## Prompt-store entries

Verified live by `GET /api/agent-prompts` against the running dev server (returns 8 visible entries; `visible: false` ones are hidden from the listing but still loaded by code that addresses them by id).

| id                            | name                          | usedBy                                              | prompt file (path)                                       | visible in UI | transport for the legs that use it             |
| ----------------------------- | ----------------------------- | --------------------------------------------------- | -------------------------------------------------------- | ------------- | ---------------------------------------------- |
| `chat-core`                   | QBO Assistant                 | Primary escalation assistant                        | `playbook/system-prompt.md`                              | yes           | Claude CLI subprocess (`services/claude.js`)   |
| `workspace-action`            | Workspace Agent               | Inbox, calendar, workspace execution                | `prompts/agents/workspace-action.md`                     | yes           | Claude CLI subprocess + tool loop              |
| `workspace-chat-only`         | Workspace Agent (Chat-Only)   | Workspace direct-response mode                      | `prompts/agents/workspace-chat-only.md`                  | no            | Claude CLI subprocess                          |
| `gmail-assistant`             | Gmail Assistant               | Inbox message reader and reply helper               | `prompts/agents/gmail-assistant.md`                      | no            | Claude CLI subprocess                          |
| `image-parser`                | Image Parser                  | Escalation screenshot **and** INV parsing           | `prompts/agents/image-parser.md`                         | yes           | direct provider APIs / Codex CLI               |
| `escalation-template-parser`  | Image Parser                  | Strict escalation template screenshot parsing       | `prompts/agents/escalation-template-parser.md`           | yes           | direct provider APIs / Codex CLI               |
| `triage-agent`                | Triage Agent                  | Fast first-pass escalation triage                   | `prompts/agents/triage-agent.md`                         | yes           | Claude CLI subprocess (`chat-orchestrator.js`) |
| `known-issue-search-agent`    | INV Search Agent              | INV investigation search before triage              | `prompts/agents/known-issue-search-agent.md`             | yes           | Claude CLI subprocess + tool loop              |
| `follow-up-chat-parser`       | Follow-Up Chat Parser         | Phone-agent follow-up screenshot transcript parsing | `prompts/agents/follow-up-chat-parser.md`                | yes           | direct provider APIs / Codex CLI               |
| `copilot-agent`               | Copilot Agent                 | Search/template/analysis/playbook review            | `prompts/agents/copilot-agent.md`                        | yes           | Claude CLI subprocess (`copilot-service.js`)   |
| `sdk-image-parse`             | Claude Screenshot Parse       | Claude fallback screenshot parser                   | `prompts/agents/sdk-image-parse.md`                      | no            | Anthropic SDK direct (`sdk-image-parse.js`)    |
| `escalation-enrichment`       | Knowledge Enrichment          | Resolved-case knowledge extraction                  | `prompts/agents/escalation-enrichment.md`                | no            | Claude CLI subprocess (used by enrichment job) |
| `workspace-proactive`         | Workspace Proactive           | Background workspace advisories                     | `prompts/agents/workspace-proactive.md`                  | no            | Claude CLI subprocess                          |

Plus a dynamic slot for **custom** agents: `prompts/agents/custom/<agentId>.md`, exposed as `custom-<agentId>` ids (`agent-prompt-store.js:198-205`). None registered today (the custom dir is empty on disk).

## Confirmation against previous research

The previous research correctly identified the three whitelisted parser ids. It missed the wider registry. The store has 13 frozen definitions; the route only whitelists 3 of them for the parse endpoint, but the other 10 are live for their own legs (chat, workspace, copilot, etc.).

## The three parser prompts

Whitelist for the parse route: `services/image-parser.js:74-78`.

- `image-parser` (default fallback) — dual-role auto-detect. See `current-harness-content/image-parser.md`.
- `escalation-template-parser` — strict single template, the one the chat UI sends. See `current-harness-content/escalation-template-parser.md`.
- `follow-up-chat-parser` — phone-agent follow-up screenshot transcript. See `current-harness-content/follow-up-chat-parser.md`.

## `sdk-image-parse` — the structured-output path

`server/src/services/sdk-image-parse.js:124` exposes `parseImageWithSDK()`. This is the **only** code path that actually requests structured JSON output from the model via `outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA }` (`sdk-image-parse.js:182-185`). Its prompt file `prompts/agents/sdk-image-parse.md` is 72 words. The function is invoked from `server/src/services/remote-api-providers.js` as a Claude fallback for the policy-driven `parseWithPolicy()` flow in `services/parse-orchestrator.js`. It is **not** invoked by the `/api/image-parser/parse` route — that route does not call the SDK path at all.

Verify: `parseImage()` at `services/image-parser.js:1518` has no reference to `parseImageWithSDK`.

## Triage / known-issue / chat agents

Loaded as system prompts for `chat-orchestrator.js` and the case-intake workflow, not the image-parse route. Touched in this discovery only enough to confirm they are not part of the byte-fidelity goal.

- `triage-agent` — `prompts/agents/triage-agent.md`, 358 words. Structured "Category:/Severity:/Fast read:/Immediate next step:/Missing info:/Confidence:/Category check:" output. Used by `services/chat-orchestrator.js`.
- `known-issue-search-agent` — `prompts/agents/known-issue-search-agent.md`, tool-using prompt. Used by `services/known-issue-search-agent.js`.

## `AGENT-PROFILES/` (top-level folder)

`AGENT-PROFILES/INV-agents/*.md` are documentation stubs for an INV multi-agent pipeline (INV Image Parser, INV Editor, Related INV Agent, INV Expert). Verified by grepping the entire codebase: nothing under `server/` or `client/` reads `AGENT-PROFILES/`. The 4 stub files are 1-2 sentences each (plus one longer paragraph for INV Expert). They are aspirational; the active prompt store is `prompts/agents/*.md`. This subproject is explicitly out of scope for the INV pipeline per user direction.

## Client-side surface

`client/src/components/AgentsView.jsx` is the only UI for agents. See `agents-ui.md`.

Last updated: 2026-05-19
