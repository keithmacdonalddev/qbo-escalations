# anthropic-cli Provider Harness Contract

## Summary

- **Provider path type**: Local Claude CLI subprocess path. The qbo-escalations server spawns the `claude` CLI binary as a child process via Node's `child_process.spawn`, pipes the prompt over stdin, and reads the response from the child's stdout/stderr. There is no HTTPS call made by qbo-escalations server code itself on this path — the subprocess handles its own auth (the user's Claude Max / Claude subscription, or `ANTHROPIC_API_KEY`) and its own network I/O. (The `@anthropic-ai/claude-agent-sdk` Node package is a separate code path used elsewhere in this repo — out of scope here; cited only when official docs describe the CLI's emitted output shape.)
- **Current implementation status**: Implemented and in active production use. Backed by `server/src/services/claude.js` exporting `chat`, `parseEscalation`, `prompt`, `transcribeImage`, `warmUp`. Wired into the chat/parse/triage legs via `server/src/services/providers/registry.js`. Catalog ids are `claude` and `claude-opus-4-8` — there is no provider id literally named `anthropic-cli` in the codebase.
- **Full package preservation status**: Currently the server **discards most of the package**. Only an accumulated text string (`fullResponse`) and a normalized `usage` object (`{ inputTokens, outputTokens, model, rawUsage, usageComplete }`) survive past the wrapper. The original per-line JSON events from `--output-format stream-json`, the exit code, the stderr output, the spawn options, and the CLI arg list are all consumed locally for control-flow and then dropped. No Mongo record persists the raw stdout line stream today.
- **Streaming**: `chat` uses `--output-format stream-json --verbose --include-partial-messages` and consumes newline-delimited JSON events line-by-line in real time. `parseEscalation` uses `--output-format json` (non-streaming, one JSON blob) or `--output-format text` for the transcribe sub-step. `prompt` and `transcribeImage` use `--output-format text`. So streaming is required for the chat path; the other paths are buffered.
- **Main uncertainty**: The exact, fully-versioned shape of every stream-json event the Claude CLI emits (especially `system/init`, `message_start`, `message_delta`, partial-message `stream_event` wrappers, and the terminal `result` event) is documented at a feature level in the headless docs but not as a single exhaustive type schema. The proposed Mongo shape stores raw event objects so future schema drift does not break preservation.

## Provider IDs In This App

- **Exact app ids (catalog)** — `shared/ai-provider-catalog.json:2-32`:
  - `id: "claude"` — label `"Claude CLI - Opus 4.8 (Default)"`, family `claude`, transport `claude`, model `claude-opus-4-8`, `selectable: true`, `default: true`.
  - `id: "claude-opus-4-8"` — label `"Claude CLI - Opus 4.8"`, family `claude`, transport `claude`, model `claude-opus-4-8`, `selectable: true`.
- **There is no `anthropic-cli` id in the catalog.** The closest matches are the two ids above. The handoff prompt's `anthropic-cli` label maps to the `transport: "claude"` path in this app's source.
- **Aliases this id appears under in code**:
  - Transport string `'claude'` — registry switch at `server/src/services/providers/registry.js:56-58` (the default case).
  - Default-when-unknown — `server/src/services/providers/registry.js:115` (`const transport = meta?.transport || 'claude';`) and `server/src/services/providers/catalog.js:67` (`getProviderTransport` defaults to `'claude'`).
  - Capability flag — `server/src/services/agent-health-service.js:87, 204` treats `transport === 'claude'` specially when deriving health-check behaviour.
- **UI labels** (from catalog above): "Claude CLI - Opus 4.8 (Default)" / "Claude CLI - Opus 4.8"; short label "Claude CLI Opus 4.8"; icon `/provider-icons/anthropic.png`.
- **Environment variables read by the wrapper**:
  - `CLAUDE_CHAT_TIMEOUT_MS` (default 180000 ms) — `claude.js:23`.
  - `CLAUDE_PARSE_TIMEOUT_MS` (default 300000 ms) — `claude.js:24`.
  - `CLAUDE_TRANSCRIBE_TIMEOUT_MS` (default 60000 ms) — `claude.js:1086`.
  - `CLAUDE_CHAT_MODEL` / `CLAUDE_PARSE_MODEL` — used only as a model fallback string fed into `extractClaudeUsage(..., { fallbackModel })` — `claude.js:323, 372, 575, 675, 694, 806, 824`.
  - `CLAUDE_SUPPORTS_IMAGE_INPUT` (boolean, default `false`) — gates `supportsImageInput` flag for the `claude` transport at `server/src/services/providers/registry.js:122-126`.
  - The wrapper also actively **unsets** three env vars before spawning the child, by passing them as `undefined`/empty in the child env: `CLAUDECODE`, `CLAUDE_PROJECT_DIR`, and forces `CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'` — `claude.js:48-58`. This is to prevent a nested Claude Code session from inheriting our hosting process's auto-memory / project context.
- **No `ANTHROPIC_API_KEY` is referenced by this wrapper.** The CLI binary handles its own auth (login subscription or env-supplied API key). The wrapper neither reads nor forwards an API key value — that is a property of the surrounding shell environment, not of this code.

## Current App Call Sites

All references are to current `master` HEAD (line numbers verified by Read/Grep).

### 1. Chat — `chat(...)`

- `server/src/services/claude.js:195-434` — `function chat({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onThinkingChunk, onDone, onError })`.
- Spawns `claude -p --output-format stream-json --verbose --include-partial-messages [--model X] [--effort Y] [--permission-mode bypassPermissions --add-dir <dir>...]` (`claude.js:203`, plus image-related args appended at `claude.js:119-129`).
- The shell is `spawn('claude', args, { stdio: ['pipe','pipe','pipe'], shell: true, ...buildClaudeSpawnOptions() })` — `claude.js:272-276`. `shell: true` is required on Windows where `claude` may be a `.cmd` shim.
- `cwd` is `os.tmpdir()/qbo-escalations-claude-isolated` — `claude.js:12, 38-46, 50`. The directory is created if missing.
- `child.stdin.end(stdinPrompt)` — `claude.js:291`. The entire conversation text (built from `messages` via `buildPrompt` at `claude.js:900-911`) is piped over stdin; **no user content is passed as a CLI argument**.
- `child.stdout` is read with a line-buffered JSON parser at `claude.js:312-358`. Each line is `JSON.parse`'d and routed through `extractClaudeUsage`, `extractThinking`, `extractText`, `extractFinalText`.
- `child.stderr` is captured into a 10240-byte truncated buffer at `claude.js:360-363`. It is only surfaced if the process exits non-zero with empty stdout (`claude.js:408-409`).
- Exit code is read at `claude.js:365` via `child.on('close', (code) => ...)`. Anything other than `0` is treated as failure via `didCliExitSuccessfully(code)` at `claude.js:19, 408`.
- **Timeout**: activity-based — resets on each stdout/stderr data event (`claude.js:300-310, 314, 361`). Default `CHAT_TIMEOUT_MS = 180000` ms (3 minutes of complete inactivity).
- The returned value is a `cleanup` function that, when called, sets `killed = true`, clears the timeout, sends `SIGTERM`, deletes any temp image files, and returns `{ usage: capturedUsage || null, partialResponse: fullResponse }` — `claude.js:427-433`.
- **Wired into chat orchestration** via the registry: `server/src/services/providers/registry.js:1, 56-58, 150` route `transport: 'claude'` to `claude.chat` and wrap it with the default-model adapter and `createChatAdapter(...)` at `registry.js:196`.

### 2. Parse — `parseEscalation(...)`

- `server/src/services/claude.js:442-857` — `async function parseEscalation(imageBase64OrText, options = {})`.
- Two modes:
  - **Image input** (detected by `data:image` prefix or 100+ base64 chars at `claude.js:449-450`): two-step pipeline.
    - Step A — Transcribe. Writes the image to a temp file via `writeTempImageFile(...)` (`claude.js:175-181`). Spawns `claude -p --output-format text [--model X] [--effort Y] --permission-mode bypassPermissions --add-dir <tempDir>` (`claude.js:517, 520`). Stdin is `transcribePrompt + 'Image attachments are available at these local file paths:\n1. <tempPath>\nAnalyze these images as part of your response.'` — `claude.js:109-117, 540`.
    - Step B — Parse the transcription text. Spawns `claude -p --output-format json --json-schema <schemaJSON> [--model X] [--effort Y]` (`claude.js:614-616`). Stdin is a long parse prompt + the transcription text — `claude.js:608-612, 638`.
    - Step B's `--output-format json` returns a **single JSON blob** containing `structured_output`, `result`, `usage`, `session_id`, etc. (see Official Response Package below). The wrapper does `JSON.parse(stdout)`, prefers `parsed.structured_output`, falls back to `parsed.result`, then to a regex match of `{...}` on raw stdout — `claude.js:673-710, 804-839`.
  - **Text input** (anything else): single-step `claude -p --output-format json --json-schema <schemaJSON> ...` — same logic as Step B above, starting at `claude.js:737-856`.
- **Timeout**: hard `setTimeout` per step (Step A gets 70% of the budget, Step B gets the remaining 30%) — `claude.js:503, 545-552, 607, 643-651, 768-776`. Default `PARSE_TIMEOUT_MS = 300000` ms.
- Schema is a hand-built `{ type: 'object', properties: {...}, required: ['category'] }` covering QBO escalation fields (`coid`, `mid`, `caseNumber`, etc.) at `claude.js:455-479`.
- The temp image file is removed in the `finally` block — `claude.js:602-604`.

### 3. One-shot prompt — `prompt(...)`

- `server/src/services/claude.js:973-1070` — `async function prompt(promptText, options = {})`.
- Spawns `claude -p --output-format text --max-turns 1 [--model X] [--effort Y]` — `claude.js:979-982, 995-999`.
- Stdin is `[System instructions:\n<systemPrompt>\n\n]<promptText>` — `claude.js:984-987, 1011`.
- On close, attempts `JSON.parse(stdout)`; if it parses, extracts `parsed.result` as text and `extractClaudeUsage(parsed)` as usage; otherwise treats raw stdout as the text — `claude.js:1044-1053`. (`--output-format text` is supposed to emit plain text, but the parser is defensive.)
- Hard timeout (`setTimeout`, no activity reset) at `claude.js:1016-1023`. Default `CHAT_TIMEOUT_MS = 180000` ms.
- **Used by** `server/src/routes/escalations.js:27` (`const { prompt: claudePrompt } = require('../services/claude')`).

### 4. Image transcription — `transcribeImage(...)`

- `server/src/services/claude.js:1088-1234` — `async function transcribeImage(imageBase64OrPath, options = {})`.
- Spawns `claude -p --output-format text --max-turns 1 [--model X] [--effort Y] --permission-mode bypassPermissions --add-dir <dir>` — `claude.js:1144-1148, 1152-1156`.
- Stdin is the transcribe prompt with `Image attachments are available at these local file paths:\n1. <path>\nAnalyze these images as part of your response.` appended — `claude.js:1168`.
- Hard timeout default `TRANSCRIBE_TIMEOUT_MS = 60000` ms — `claude.js:1086, 1174-1181`.
- Used by `server/src/lib/chat-image.js:3` (`const { transcribeImage } = require('../services/claude')`).

### 5. Warm-up — `warmUp(...)`

- `server/src/services/claude.js:862-893` — `async function warmUp()`.
- Spawns `claude -p --output-format text --max-turns 1` and pipes `'hello'` on stdin — `claude.js:869, 875`.
- Used at server boot in `server/src/index.js:228` (`const { warmClaude } = require('./services/claude')`) to reduce first-request latency.

### 6. Proactive workspace reasoning — `evaluateProactiveAction(...)`

- `server/src/services/workspace-proactive.js:124-212` — `async function evaluateProactiveAction(trigger)`.
- Spawns `claude -p --output-format text --max-turns 1 --effort low` — args assembled at `workspace-proactive.js:145, 148` and passed to `spawn` at `workspace-proactive.js:151`.
- `spawn('claude', args, { stdio: ['pipe','pipe','pipe'], shell: true, cwd: ensureIsolatedClaudeRoot(), env: { ...process.env, CLAUDECODE: undefined, CLAUDE_PROJECT_DIR: '', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } })` — `workspace-proactive.js:151-161`. Same isolated-cwd / env-override pattern as `claude.js`, but defined locally inside this module (not imported from `claude.js`).
- Stdin (`workspace-proactive.js:126, 168`): `child.stdin.end(prompt)`, where `prompt = \`${getProactiveSystemPrompt()}\n\n---\nSituation:\n${trigger.context || JSON.stringify(trigger.data, null, 2)}\``. The proactive system prompt comes from the rendered `workspace-proactive` agent prompt template (see `server/src/lib/agent-prompt-store.js:119-125`).
- Stdout/stderr capture: plain string accumulators `let stdout = ''; let stderr = '';` (`workspace-proactive.js:141-142`) appended via `child.stdout.on('data', ...)` / `child.stderr.on('data', ...)` (`workspace-proactive.js:180-186`).
- **`--output-format` is `text`, not `stream-json`.** The raw response package on this path is a **single accumulated UTF-8 string**, not a stream of newline-delimited JSON events. The `parseProactiveResponse(stdout)` helper (`workspace-proactive.js:198`) then walks that single text blob line-by-line looking for `SUGGEST:` prefixes — that is application-level parsing of plain text, not envelope JSON parsing.
- Hard `setTimeout` (no activity reset) at `workspace-proactive.js:173-178`, default `PROACTIVE_TIMEOUT_MS`. Non-zero exit with empty stdout is rejected with the first 300 chars of stderr (`workspace-proactive.js:193-194`).
- **Invoker**: `server/src/services/workspace-monitor.js:9, 168` — `const proactive = require('./workspace-proactive')` and `await proactive.evaluateProactiveAction({ type: 'alert', data: alert, context: ... })` inside the alert-handling loop at `workspace-monitor.js:165-172`. Treat as live model-work; nothing in source disables it.

### 7. Indirect — gmail route

- `server/src/routes/gmail.js:5` — `const { chat } = require('../services/claude')`. Used by the gmail endpoint to draft email replies through the chat path. This is a wrapper/route that consumes the chat spawn site — it does not spawn the CLI itself.

### Operational probes — not model work

These call sites spawn the `claude` binary, but they do **not** send a prompt to the model. They are operational health checks. The raw response package here is a version string + exit code, not a model answer.

- `server/src/services/agent-health-service.js:127-185` — `function checkCli(command, args = ['--version'], timeoutMs = 3000)`. Spawn shape (line 139): `spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, env: { ...process.env, CLAUDECODE: undefined } })`. Note `stdio[0]` is `'ignore'` — **no stdin is written**, so no prompt is sent. Stdout/stderr each capped at 1000 bytes. Resolves a `{ available, code, reason }` payload from exit code: on exit `0`, `reason` is the first line of stdout (the CLI version banner, e.g. `claude 1.x.y`); on non-zero exit or `'error'` event, `reason` is the truncated stderr / error message.
- **Invoker**: `server/src/services/agent-health-service.js:204-205` — `if (transport === 'claude') { const cli = await checkCli('claude'); ... }` inside `checkRuntimeProvider`. Used to surface CLI availability in the agent-health endpoint.
- Because no prompt is sent and no model output is produced, this probe is **out of scope** for the model-package preservation contract proposed in `Proposed Mongo Storage Shape` below. It is documented here so the harness owner can categorize it correctly (probe, not model work).

### Call-site categorization

Verified by `rg "spawn\('claude'" server/src` (see Evidence). Counts are derived from that rg output, not estimated:

- **Main model-work spawns (send a prompt over stdin, receive model output on stdout)** — 8 spawn sites:
  - `claude.js:272` — `chat` (Mode A, stream-json).
  - `claude.js:524` — `parseEscalation` Step A image-transcribe (Mode B, text).
  - `claude.js:622` — `parseEscalation` Step B parse (Mode B, json with schema).
  - `claude.js:745` — `parseEscalation` text-input single-step (Mode C, json with schema).
  - `claude.js:869` — `warmUp` (Mode F, text, `'hello'`).
  - `claude.js:995` — `prompt` (Mode D, text, `--max-turns 1`).
  - `claude.js:1152` — `transcribeImage` (Mode E, text, `--max-turns 1`).
  - `workspace-proactive.js:151` — `evaluateProactiveAction` (text, `--max-turns 1`, `--effort low`).
  - That is 8 model-work spawn sites in total: 7 inside `claude.js` and 1 inside `workspace-proactive.js`.
- **Operational probes (CLI availability/version only, no prompt sent)** — 1 spawn site:
  - `agent-health-service.js:139` — invoked with `command = 'claude'` from line 205.
- **Non-spawning wrappers/routes (call a model-work spawn but do not spawn the CLI themselves)**:
  - `server/src/routes/escalations.js:27` — calls `prompt(...)`.
  - `server/src/routes/gmail.js:5` — calls `chat(...)`.
  - `server/src/lib/chat-image.js:3` — calls `transcribeImage(...)`.
  - `server/src/services/providers/registry.js:1, 56-58, 196-202` — routes `transport: 'claude'` through `claude.chat` / `claude.parseEscalation` / `claude.transcribeImage`.
  - `server/src/index.js:228` — boot-time call to `warmUp(...)`.
  - `server/src/services/workspace-monitor.js:9, 168` — calls `evaluateProactiveAction(...)`.

All model-work spawn sites use the same primitive: `spawn('claude', args, { stdio: ['pipe','pipe','pipe'], shell: true, cwd, env })`. The probe spawn site differs (`stdio[0] = 'ignore'`, no isolated cwd). No path uses `execFile`, `fork`, or an in-process SDK package. The `@anthropic-ai/claude-agent-sdk` Node package is consumed elsewhere in the code (`server/src/services/sdk-image-parse.js`) but **not** by `claude.js` or `workspace-proactive.js`, and is out of scope for this document.

## Request Package Sent Today

All paths share the same spawn primitive. Differences are in the args list and stdin contents.

- **Executable**: `claude` (resolved via OS `PATH`; on Windows this is typically a `.cmd` shim, which is why `shell: true` is set).
- **Working directory**: `os.tmpdir()/qbo-escalations-claude-isolated`, created on first use (`claude.js:12, 38-46`).
- **Child env**: cloned from `process.env` plus three overrides — `CLAUDECODE: undefined`, `CLAUDE_PROJECT_DIR: ''`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'` (`claude.js:51-56`). No API key is injected here; if the host shell has `ANTHROPIC_API_KEY` set, it is inherited via the `...process.env` spread.
- **Spawn options**: `{ stdio: ['pipe','pipe','pipe'], shell: true, cwd, env }`.
- **Auth mechanism**: handled entirely by the child process via its own login state (Claude Max subscription, OAuth token from `claude setup-token`, or `ANTHROPIC_API_KEY` from the inherited env). The wrapper has zero visibility into which one is used.
- **Stdin payload**: written via `child.stdin.end(<string>)`. The string is the entire prompt content. **User content is never passed as a CLI argument** (explicit comment at `claude.js:271`).

### Mode A — Chat (streaming)

- Args (`claude.js:203, 205, 207, 119-129`):
  ```
  claude -p --output-format stream-json --verbose --include-partial-messages
    [--model <model>]
    [--effort <low|medium|high|xhigh|max>]
    [--permission-mode bypassPermissions --add-dir <imageDir>] (only if images)
  ```
- Stdin (`claude.js:208-210, 266`):
  ```
  System instructions:
  <systemPrompt (playbook content) — present only when caller passes one>

  <buildPrompt(messages) — joined "User: ...\n\nAssistant: ...\n\n" lines, ending with "Assistant:" — claude.js:900-911>

  [Image attachments are available at these local file paths:
   1. <tempPath1>
   2. <tempPath2>
   Analyze these images as part of your response.]  (only if images, appended at claude.js:109-117)
  ```
- Effort values: validated against `{'low','medium','high','xhigh','max'}` at `claude.js:25-30`. Invalid values dropped silently.
- Timeout: activity-based, default 180_000 ms.

### Mode B — Parse, image input (two CLI calls)

- Step A args (`claude.js:517-520`):
  ```
  claude -p --output-format text
    [--model <model>] [--effort <effort>]
    --permission-mode bypassPermissions
    --add-dir <dirname-of-temp-image>
  ```
  Step A stdin: the transcribe prompt + the image-path footer.
- Step B args (`claude.js:614-616`):
  ```
  claude -p --output-format json --json-schema <stringified JSON Schema>
    [--model <model>] [--effort <effort>]
  ```
  Step B stdin: parse-instructions prompt + `\n\nEscalation text:\n<transcriptionText>`.
- Timeout: per-step `setTimeout`. Step A gets `round(effectiveTimeoutMs * 0.7)`; Step B gets the remainder. Default total 300_000 ms.

### Mode C — Parse, text input (single CLI call)

- Args (`claude.js:737-739`):
  ```
  claude -p --output-format json --json-schema <stringified JSON Schema>
    [--model <model>] [--effort <effort>]
  ```
- Stdin: the parse prompt + `\n\nEscalation text:\n<sourceText>`.
- Timeout: 300_000 ms default.

### Mode D — One-shot `prompt`

- Args (`claude.js:979-982`):
  ```
  claude -p --output-format text --max-turns 1
    [--model <model>] [--effort <effort>]
  ```
- Stdin: `[System instructions:\n<systemPrompt>\n\n]<promptText>`.
- Timeout: hard 180_000 ms.

### Mode E — Transcribe image

- Args (`claude.js:1144-1148`):
  ```
  claude -p --output-format text --max-turns 1
    [--model <model>] [--effort <effort>]
    --permission-mode bypassPermissions
    --add-dir <dirname-of-image>
  ```
- Stdin: transcribe prompt + image-path footer.
- Timeout: hard 60_000 ms.

### Mode F — Warm-up

- Args (`claude.js:869`):
  ```
  claude -p --output-format text --max-turns 1
  ```
- Stdin: literal `'hello'`.
- Timeout: hard 30_000 ms.

### Image handling

- Inline base64 → temp file. `writeTempImageFile(input, prefix, index)` at `claude.js:175-181`:
  - Strips `data:image/<subtype>;base64,` prefix if present (`claude.js:156-158`).
  - Validates base64 charset (`claude.js:160-162`).
  - Decodes to `Buffer`, refuses empty buffers (`claude.js:164-167`).
  - Filename pattern `${prefix}-${Date.now()}-${process.pid}-${index}.${extension}` in `os.tmpdir()`.
  - Subtype-to-extension mapping at `claude.js:137-148` (handles `jpeg → jpg`, `svg+xml → svg`, `x-icon → ico`, etc.).
- The temp file's **directory** (not the file itself) is granted to the child via `--add-dir <dir>` (`claude.js:119-129`). Multiple images in the same `os.tmpdir()` collapse to a single `--add-dir` entry via the `Set` at line 121.
- `--permission-mode bypassPermissions` is added whenever any image is attached (`claude.js:120`).
- Temp files are cleaned up in `cleanupTempFiles(tempFiles)` (`claude.js:32-36`) on success, error, and abort.

### What is **not** sent

- No HTTPS endpoint URL (the child decides where to call).
- No `Authorization` / `x-api-key` headers (the child manages its own credentials).
- No `anthropic-version` header (same — child concern).
- No `max_tokens`, `temperature`, `top_p`, or any sampling control (no flag exposed; the child uses its defaults).
- No `system` / `messages` JSON body — the conversation is flattened into a single stdin string by `buildPrompt`.

## Official Response Package

Evidence labels used in this section:

- **"official Claude Code CLI docs"** — flag behaviour and CLI-level output-format guarantees, from `https://code.claude.com/docs/en/cli-reference` and the headless reference at `https://code.claude.com/docs/en/headless`.
- **"official reference context for emitted event shape"** — stream-json line shapes / inner event types, from the Claude Agent SDK streaming-output docs at `https://code.claude.com/docs/en/agent-sdk/streaming-output`. The Agent SDK and the `claude` CLI binary share the underlying message envelope, but this page is **not** a formal CLI wire schema — it documents the SDK type definitions. Field names below are quoted verbatim from that page where used. Treat any deviation between the CLI's actual stdout and these types as the CLI's behaviour, not as a documentation gap.
- **"inferred from current app source" / "app-source fact"** — anything derived from how `claude.js` parses or consumes the output, with file:line refs.

The CLI reference at `https://code.claude.com/docs/en/cli-reference` confirms flag behaviour. Field names below are quoted verbatim from those pages.

### `--output-format text` (Modes A's transcribe sub-step, D, E, F, and the proactive-workspace spawn)

Plain UTF-8 text written to stdout. No envelope, no JSON, no usage metadata. Stderr may still contain diagnostic text. Exit code `0` on success. (Source: **official Claude Code CLI docs**.)

### `--output-format json` (Modes B-step-B and C)

A single JSON object printed to stdout once the agent completes. Documented fields (from the headless page's "Get structured output" section; **official Claude Code CLI docs**):

- `result` — string. The final text response.
- `session_id` — string. UUID for the session.
- `total_cost_usd` — number. Dollar cost of the invocation.
- Per-model cost breakdown (field name not explicitly quoted in the page, but described in prose). The wrapper does not read it.
- `usage` — object with at least `input_tokens` and `output_tokens`; may also contain `cache_creation_input_tokens`, `cache_read_input_tokens` (these are the dimensions the usage extractor checks for at `server/src/lib/usage-extractor.js:14-17`).
- `structured_output` — present when `--json-schema` is supplied. Either an object matching the schema, or a string fallback. The wrapper checks `parsed.structured_output` first at `claude.js:678, 808`.

Exit code `0` on success; non-zero on schema-validation failure, billing failure, auth failure, etc.

### `--output-format stream-json` (Mode A)

Newline-delimited JSON. Each line is a complete JSON object. The newline-delimited transport itself and the `system` event subtypes (`init`, `api_retry`, `plugin_install`, `compact_boundary`) are **official Claude Code CLI docs** (headless reference). The per-line wrapper shape (`stream_event`, `assistant`, `user`, `result`) and the inner Anthropic Messages-API event types are **official reference context for emitted event shape (Claude Agent SDK streaming-output docs); not a formal CLI wire schema**.

Documented event categories:

- **`system` events** — emitted by the CLI itself, not from the model. Subtypes documented in `headless`:
  - `subtype: "init"` — first event in the stream (unless `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` is set, in which case `plugin_install` events precede it). Fields include `cwd`, `session_id`, `tools` (array), `mcp_servers`, `model`, `permissionMode`, `apiKeySource`, plus `plugins` (array) and `plugin_errors` (array; omitted when empty).
  - `subtype: "api_retry"` — emitted before a retry. Fields: `type` (`"system"`), `subtype` (`"api_retry"`), `attempt` (int), `max_retries` (int), `retry_delay_ms` (int), `error_status` (int or null), `error` (string category: one of `authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown`), `uuid` (string), `session_id` (string).
  - `subtype: "plugin_install"` — when `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` is set. Fields: `status` (`"started"|"installed"|"failed"|"completed"`), `name` (optional), `error` (optional), `uuid`, `session_id`.
  - `subtype: "compact_boundary"` — emitted when conversation history is compacted (per the streaming-output doc's discussion of `SystemMessage` with subtype `"compact_boundary"`).

- **`stream_event` events** (only when `--include-partial-messages` is set, which qbo-escalations does set for chat). Wrapper shape (verbatim from the SDK type definitions at the streaming-output page — **official reference context, not a formal CLI wire schema**):
  ```
  {
    "type": "stream_event",
    "event": { ... raw Anthropic Messages-API SSE event ... },
    "parent_tool_use_id": <string|null>,
    "uuid": <UUID string>,
    "session_id": <string>
  }
  ```
  The inner `event` object is a raw Anthropic Messages-API streaming event (see `https://platform.claude.com/docs/en/build-with-claude/streaming`). Common inner `event.type` values documented in the streaming-output page:
  - `message_start`
  - `content_block_start` — inner has `content_block` (e.g. `{type: "text", ...}` or `{type: "tool_use", name, id}`).
  - `content_block_delta` — inner has `delta`. Delta variants:
    - `{ type: "text_delta", text: "..." }`
    - `{ type: "input_json_delta", partial_json: "..." }`
    - `{ type: "thinking_delta", thinking: "..." }` (used when extended thinking is enabled)
    - `{ type: "signature_delta", signature: "..." }`
  - `content_block_stop`
  - `message_delta` — inner has `delta` (stop_reason, stop_sequence) and `usage`.
  - `message_stop`

- **`assistant` events** — complete assistant message emitted after each turn. Fields (from the streaming-output doc, SDK type definitions — **official reference context, not a formal CLI wire schema**): `type: "assistant"`, `message` (a full Anthropic Message object with `id`, `type`, `role`, `content[]`, `model`, `stop_reason`, `stop_sequence`, `usage`), `parent_tool_use_id`, `session_id`. **Inferred from current app source** (`claude.js:949-955`): the qbo-escalations wrapper reads `msg.message.content` and joins all `b.type === 'text'` blocks.

- **`user` events** — emitted when a tool result is appended to the conversation. Same envelope shape as `assistant` but with `message.role === "user"`. The wrapper does not currently inspect these.

- **`result` events** — terminal event. Field names are **official Claude Code CLI docs** (headless `--output-format json` discussion). Which of these fields qbo-escalations actually reads is **app-source fact** at `claude.js:71-74, 956-958`:
  - `type: "result"`
  - `subtype` — typically `"success"` (or `"error_during_execution"`, etc., per the streaming-output snippet that filters on `message.subtype === "success"`).
  - `is_error` — boolean.
  - `duration_ms` — total wall time.
  - `duration_api_ms` — time spent in upstream API calls.
  - `num_turns` — number of agent turns executed.
  - `result` — string. The final text response. (Read by `claude.js:957`.)
  - `session_id` — string.
  - `total_cost_usd` — number.
  - `usage` — object: `{ input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }`. (Read by `claude.js:71-74`.)
  - `model` — string. (Read by `claude.js:72`.)

### Error and exit-code shape

- Non-zero exit means the CLI failed. Stderr typically contains the human-readable reason.
- `formatCliFailure(code, stderr, stdout)` at `claude.js:89-106` looks at the first 500 chars of stderr/stdout and detects two common cases:
  - "command not found" / "not recognized as an internal or external command" / `ENOENT` → returns `'Claude CLI command not found. Ensure `claude` is installed and available on PATH.'`
  - Otherwise: `'Claude CLI exited with code ' + code + ': ' + preview`.
- The CLI documents a kill-on-budget exit when `--max-budget-usd` is exceeded (not currently used by qbo-escalations) and a kill-on-turns exit when `--max-turns` is exceeded (used in Modes D/E/F with `--max-turns 1`).
- Retries during the run are surfaced as `system/api_retry` events on stdout (see above); they do not by themselves cause a non-zero exit.

### Reference URLs (fetched 2026-05-20 via WebFetch)

- Headless / `-p` reference: `https://code.claude.com/docs/en/headless`
- Streaming output (StreamEvent shape): `https://code.claude.com/docs/en/agent-sdk/streaming-output`
- CLI flag reference: `https://code.claude.com/docs/en/cli-reference`
- Streaming-input vs single-message modes: `https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode`
- Anthropic Messages-API streaming primitive (the wire format wrapped inside `stream_event.event`): `https://platform.claude.com/docs/en/build-with-claude/streaming`

## Streaming vs Non-Streaming

- **Chat (`chat`)** — streaming required. Args include `--output-format stream-json --verbose --include-partial-messages`. Source: `claude.js:203`. Final response detection: the wrapper does not look for `result` specifically — it accumulates `content_block_delta`/`text_delta` deltas into `fullResponse` (`claude.js:330-334, 939-941`) and treats child-process `close` with exit `0` as the terminal signal (`claude.js:365, 414`). The `extractFinalText` helper at `claude.js:949-960` is used only as a fallback when no `content_block_delta` text was seen (`claude.js:336-342, 386-392`), e.g. for `assistant`/`result` messages.
- **Parse step B / text-input parse** — non-streaming. `--output-format json` emits a single JSON object. The wrapper accumulates the full stdout buffer and `JSON.parse`s it after `close` (`claude.js:673-710, 804-839`).
- **Parse step A (image transcribe)** — non-streaming. `--output-format text` plus accumulated stdout (`claude.js:554, 577-581`).
- **`prompt`** — non-streaming. `--output-format text --max-turns 1`. Stdout accumulated, optionally `JSON.parse`d defensively (`claude.js:1044-1053`).
- **`transcribeImage`** — non-streaming. Same as `prompt` (`claude.js:1144, 1183-1212`).
- **`warmUp`** — non-streaming. Output discarded (`claude.js:869`).

Provider capability: the CLI supports streaming (`stream-json`) for all `-p` invocations, but it must be opted in by both `--output-format stream-json` and `--verbose`, and partial-message events additionally require `--include-partial-messages`. Per the CLI reference at `https://code.claude.com/docs/en/cli-reference`, `--include-partial-messages` and `--include-hook-events` both require `--output-format stream-json`. The qbo-escalations wrapper sets all three for chat and none of them for the other paths.

## Raw Package That Reaches This Server Today

The first observable response unit in server code is the **byte stream from the child's stdout `data` event**, plus the parallel stderr stream and the eventual `close` event with the numeric exit code.

For each path, the variable names are:

### Chat path (`chat`)

- `claude.js:294` — `let stdoutBuffer = '';` (line accumulator).
- `claude.js:295` — `let stderrOutput = '';` (10 KB cap).
- `claude.js:312-358` — `child.stdout.on('data', (data) => { ... })`. Each chunk: `stdoutBuffer += data.toString()`, split on `\n`, the trailing partial line is held back. Each complete line is `JSON.parse`'d into `msg`.
- The **earliest server-side raw event object** is therefore `msg` — a parsed JSON line — at `claude.js:322`. Each `msg` is then transformed:
  - `extractClaudeUsage(msg, { fallbackModel })` → `capturedUsage` (`claude.js:323-324`).
  - `extractThinking(msg)` → forwarded to `onThinkingChunk` (`claude.js:325-329, 918-927`). Only `content_block_delta` events with `delta.type === 'thinking_delta'` survive this extraction (after unwrapping the `stream_event` wrapper at `claude.js:919`).
  - `extractText(msg)` → appended to `fullResponse` and forwarded to `onChunk` (`claude.js:330-334, 936-943`). Only `content_block_delta` events with `delta.text` survive.
  - `extractFinalText(msg)` → fallback path, used only when no deltas appeared (`claude.js:336-342, 949-960`). Reads `msg.message.content` (`assistant`) or `msg.result` (`result`).
- `claude.js:365` — `child.on('close', (code) => ...)`. The trailing buffer is parsed once more, then `finishWithSuccess(fullResponse)` or `finishWithError(...)` runs.
- After `close`, the original line stream is **gone**. The only things that survived are:
  - `fullResponse` (string) — passed to `onDone` callback.
  - `capturedUsage` (normalized object: `{ inputTokens, outputTokens, model, rawUsage, usageComplete }`) — passed to `onDone` second arg.
  - On error: `formatCliFailure(code, stderrOutput, fullResponse)` — string message wrapped in `Error`.
- **`stdoutBuffer` is overwritten each chunk and only retains the trailing partial line.** Complete lines flow through `JSON.parse` and into the helpers; the source-text lines themselves are not retained anywhere.
- **stderr** is truncated at 10 KB and used only to build error messages.
- **exit code** is consumed in the close handler and not stored.

### Parse Step B / text-parse path

- `claude.js:640, 765` — `let stdout = '';` (accumulator, not line-split).
- `claude.js:641, 766` — `let stderr = '';`.
- `claude.js:656, 787` — `child.on('close', (code) => ...)` runs once with the full accumulated stdout.
- Earliest raw object: `const parsed = JSON.parse(stdout)` at `claude.js:674, 805`. Type: a JS object containing some subset of `{ structured_output, result, usage, session_id, total_cost_usd, model, ... }`.
- Fields preserved past the wrapper: `parsed.structured_output || parsed.result || parsed` flows to `resolve({ fields, usage })` at `claude.js:687, 817`. Everything else in `parsed` is dropped.

### `prompt` path

- `claude.js:1013-1014, 1025-1026` — `let stdout = ''; let stderr = '';` accumulators.
- Earliest raw object: at `claude.js:1048`, an optional `const parsed = JSON.parse(stdout)`; otherwise the raw string. Returned shape: `{ text, usage }`.

### `transcribeImage` path

- `claude.js:1171-1172` — `let stdout = ''; let stderr = '';`.
- Earliest raw object: at `claude.js:1206`, an optional `JSON.parse(stdout)`; otherwise raw text. Returned: `{ text: text.trim(), usage }`.

### Fields already discarded today (chat path)

The chat path's `msg` objects pass through quickly. The wrapper does not store, log, or forward any of the following:

- `system/init` payload (cwd, tools, mcp_servers, model, permissionMode, apiKeySource, plugins, plugin_errors).
- `system/api_retry` events (silently absorbed by the unhandled-type debug log at `claude.js:344-349`).
- `result` event's `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `session_id`, `subtype`, `is_error`.
- Per-line `uuid`, `parent_tool_use_id`, `session_id` from `stream_event` wrappers.
- Tool-use content blocks (`content_block_start` for `tool_use`, `input_json_delta` chunks). The extractor only consumes `text_delta` and `thinking_delta`.
- The `message_delta` cumulative usage updates (only the `result.usage` snapshot is kept, via `extractClaudeUsage`).
- The original stdout line string. The `stdoutBuffer` variable retains only the trailing partial line; complete lines are JSON-parsed in place and the source text is GC'd.
- Stderr bytes beyond the 10 KB cap.
- Stderr bytes when the exit was clean (only inspected on non-zero exit at `claude.js:408-409`).
- The exit code itself once the close handler returns.

## Proposed Mongo Storage Shape

Suggestive naming below — the harness may rename freely. The intent is to preserve the exact subprocess invocation and the emitted stdout/stderr package for later inspection. Fields are proposed for preservation only; this section does not design indexes, retention, external payload storage, dashboard views, background jobs, or any downstream behavior.

### Suggested record

#### Required

- `provider` — one of `"claude"`, `"claude-opus-4-8"` (the catalog id passed in).
- `transport` — `"claude"`.
- `callerSite` — string identifying which wrapper function spawned the call. Source-backed values today: `"chat"`, `"parseEscalation:image:transcribe"`, `"parseEscalation:image:parse"`, `"parseEscalation:text"`, `"prompt"`, `"transcribeImage"`, `"warmUp"`, `"workspace-proactive"`. Pins down which CLI args and stdin shape were used.
- `requestStartedAt` — timestamp captured immediately before `spawn(...)`.
- `requestFinishedAt` — timestamp captured at the `child.on('close')` callback (or when the cleanup function fires for an aborted run).
- `durationMs` — elapsed time between `requestStartedAt` and `requestFinishedAt`.
- `request`:
  - `executable` — `"claude"`.
  - `args` — the full args array passed to `spawn`, verbatim (includes `-p`, `--output-format`, `--verbose`, `--include-partial-messages`, `--max-turns`, `--model`, `--effort`, `--json-schema`, `--permission-mode`, `--add-dir`). Note that `--json-schema` inlines the schema string — store as-is.
  - `cwd` — the resolved isolated-root path.
  - `shell` — boolean (`true` on the Windows shim path).
  - `envOverrides` — the keys the wrapper rewrites: `CLAUDECODE`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. **Do not store the full child env** (would include the user's `ANTHROPIC_API_KEY`). If a sanitized snapshot of relevant inherited env is desired, store key names only with values redacted.
  - `stdin` — the exact UTF-8 string written to `child.stdin`. May be stored inline or by external payload reference if too large.
  - `stdinByteLength` — `Buffer.byteLength(stdin)`.
  - `timeoutMs` — the effective timeout used for this invocation.
  - `timeoutMode` — `"activity-reset"` (chat) or `"hard"` (others).
- `response`:
  - `exitCode` — integer or `null` (if killed before exit).
  - `signal` — string or `null` (if killed by signal).
  - `stdoutRaw` — the **complete** unparsed stdout as a UTF-8 string, exactly as received. For stream-json this is the newline-delimited JSON dump; for `text`/`json` modes this is one blob. Store inline, or by content-addressed reference if too large.
  - `stdoutByteLength` — `Buffer.byteLength(stdoutRaw)`.
  - `stderrRaw` — the complete unparsed stderr string. (The in-flight wrapper currently truncates stderr at 10 KB; preservation should capture without that truncation.)
  - `stderrByteLength`.
- `outcome` — string identifying terminal state: e.g. `"success"` (exit 0), `"cli_error"` (non-zero exit), `"timeout"` (TIMEOUT signal sent by wrapper), `"aborted"` (cleanup function called externally), `"spawn_error"` (subprocess never started, e.g. `ENOENT`).

#### Required for stream-json paths (i.e. `callerSite === "chat"`)

The chat path consumes stream-json. Preservation of the line-by-line event log preserves the package that arrived.

- `streaming`:
  - `enabled` — `true`.
  - `flags` — `{ outputFormat: "stream-json", verbose: true, includePartialMessages: true }` (echo of args).
  - `events` — ordered array. One entry per stdout line. Each element:
    - `seq` — 0-based index. Defines order.
    - `receivedAt` — timestamp when the line was completed (i.e. when the `\n` arrived).
    - `rawLine` — the literal source line string (without trailing `\n`).
    - `parsedJson` — `JSON.parse(rawLine)` if it succeeded, else `null`.
    - `parseError` — error message if `JSON.parse` failed; else absent.
    - `eventType` — denormalized convenience: `parsedJson.type` (`system`, `assistant`, `user`, `result`, `stream_event`); for `stream_event` wrappers, the inner `parsedJson.event.type`.
    - `eventSubtype` — denormalized convenience (`parsedJson.subtype` for system/result events).
  - `eventCount` — integer.
  - `terminator` — string indicating how the stream ended: e.g. `"result"` (final `type: "result"` event seen), `"close-clean"`, `"close-error"`, `"timeout"`, `"abort"`.

Note: `system/api_retry` events are part of the emitted package and are preserved as ordinary `events[]` entries. This document does not propose any retry policy, backoff strategy, or retry behavior — these events are storage payload, not behavior.

#### Optional preservation fields

- `request.flags.outputFormat` — `"stream-json" | "json" | "text"` (denormalized echo of args).
- `request.flags.model`, `request.flags.effort`, `request.flags.maxTurns` — denormalized echoes.
- `request.images` — when temp image files were attached; for each: `mediaType`, `byteLength`, `sha256Digest`, `tempPath` (the path passed in via `--add-dir`). Image bytes may be stored inline or by content-addressed reference; preserving the digest + temp path is sufficient to record the request package.
- `response.parsedJson` — for `--output-format json` paths, the result of `JSON.parse(stdoutRaw)`. Preserves the parsed form alongside the raw bytes.
- `response.normalizedUsage` — what `extractClaudeUsage` produced (`{ inputTokens, outputTokens, model, rawUsage, usageComplete }`). The wrapper already computes this; preserving it alongside the raw `usage` from `response.parsedJson` records what the wrapper actually consumed.
- `error` — when `outcome !== "success"`:
  - `kind` — `"cli_error" | "timeout" | "spawn_error" | "abort"`.
  - `wrapperMessage` — what `formatCliFailure(...)` returned, or the timeout/spawn-error message.
  - `stderrPreview`, `stdoutPreview` — first 500 chars each.
  - `nodeErrorCode` — e.g. `"ENOENT"`, `"ABORT_ERR"`.

#### Storage notes

- A Mongo BSON document has a 16 MB cap. A long chat session with `--include-partial-messages` may emit a large stream-json log; large `stdin` payloads and large `stdoutRaw` blobs may also approach the cap. Preserve such fields inline when they fit, or by external payload reference if they do not. This document does not design where that reference lives or how it is fetched.
- The wrapper currently truncates stderr at 10 KB in-flight (see `claude.js:295, 360-363`). For full preservation, that truncation would need to be removed at capture time. Whether to change the wrapper or capture via a separate path is out of scope here.

## Gaps And Questions

### Fact vs assumption

- "Provider IDs In This App", "Current App Call Sites", "Request Package Sent Today", and "Raw Package That Reaches This Server Today" are **fact** — confirmed by reading the cited files at the cited line numbers on current `master` HEAD.
- "Official Response Package" and "Streaming vs Non-Streaming" are **fact from official docs** for the parts cited to `https://code.claude.com/...` URLs. Event-type lists and `result` event fields are quoted verbatim from those pages.
- "Proposed Mongo Storage Shape" is **design proposal** — names and structure are suggestions only.

### Could not fully verify

1. **Exhaustive `system` subtype list.** The headless docs explicitly document `init`, `api_retry`, `plugin_install`, and `compact_boundary`. Other subtypes may exist in unreleased or beta builds. The shape stores `parsedJson` verbatim so new subtypes survive.
2. **Exhaustive `result.subtype` value list.** The streaming-output page only confirms `"success"`. The wrapper does not branch on subtype (`claude.js:956-958` just reads `msg.result`), so failure subtypes (e.g. `"error_during_execution"`, `"error_max_turns"`) are inferred from the SDK's prose, not from a quoted enum.
3. **Whether the qbo-escalations chat path consistently sees a `result` event.** The wrapper's chat handler does not actively detect a terminal `result` event — it waits for child-process `close`. It is possible (but not confirmed from source) that some failure modes close stdout without ever emitting `result`. The proposed Mongo `streaming.terminator` field is designed to capture this distinction.
4. **Behaviour of `--effort xhigh` / `--effort max`.** The catalog declares all five values; the wrapper validates against the same set (`claude.js:25`). The CLI reference says "available levels depend on the model" — meaning the CLI may reject one with a non-zero exit at runtime. No source code anticipates that explicit failure.
5. **Whether `CLAUDECODE: undefined` actually un-sets the env var in spawned process.** Node's `spawn` env merge treats `undefined` values as "do not include this key". The wrapper assumes this is sufficient (`claude.js:53`). I did not retest the platform-specific behaviour on Windows vs Linux.
6. **Whether `--include-hook-events` would emit additional event types.** The CLI reference says yes; the wrapper does not opt in. Not relevant for current preservation but worth flagging if the harness expands later.
7. **Whether `--bare` should be used.** The headless doc recommends `--bare` for scripted/SDK callers because it skips auto-discovery of hooks/skills/plugins/MCP/CLAUDE.md and reduces startup latency. The current code does not pass `--bare`; instead it relies on `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` plus an isolated `cwd`. This means stray `.claude/` configuration in either the isolated cwd or `~/.claude/` could still affect outputs. Documenting this is a fact; whether to flip to `--bare` is out of scope for this harness contract.
8. **Tool-use streaming.** The chat path does not currently expose any tool-use to the model (no `--allowedTools`, no MCP, the spawn happens in a clean isolated cwd). But the doc explicitly says the CLI may still emit `Bash`, `Read`, `Edit`, etc. tool-use events for internal reasons. The proposed Mongo shape captures these as ordinary `events[]` entries; nothing in `claude.js` reads them.
9. **Auth credential discoverability.** Because the CLI process is self-authenticating, the qbo-escalations server has no insight into which credentials were used (Claude Max session vs `ANTHROPIC_API_KEY`). The `system/init` event's `apiKeySource` field would surface this; storing `system/init` events (as the shape proposes) is the only way to make that visible at audit time.
10. **Windows shim quoting.** With `shell: true`, args are passed through the OS shell. Special characters in `--json-schema` JSON (notably `"` and `,`) could in principle be misquoted on Windows. The current code's `--json-schema` value contains `,`, `"`, and `{}`. I did not see a reported bug, but the safety here is shell-implementation dependent. Out of scope for the storage shape; flag for the harness owner.

## Evidence

### Repo source (read on current `master` HEAD; line numbers verified)

- `shared/ai-provider-catalog.json:2-32` — catalog entries `claude` and `claude-opus-4-8` with `transport: "claude"`.
- `server/src/services/claude.js:1-11` — module imports including `extractClaudeUsage`, `reportServerError`, harness gate helpers.
- `server/src/services/claude.js:12-46` — isolated tmpdir root, spawn helpers, env overrides.
- `server/src/services/claude.js:23-26` — timeout constants (`CHAT_TIMEOUT_MS`, `PARSE_TIMEOUT_MS`).
- `server/src/services/claude.js:25, 27-30` — effort validation set.
- `server/src/services/claude.js:48-58` — `buildClaudeSpawnOptions` (cwd + env overrides).
- `server/src/services/claude.js:68-129` — image arg/prompt preparation (`prepareImageArgs`, `appendImagePathsToPrompt`, `addCompatibilityImageAccessArgs`).
- `server/src/services/claude.js:89-106` — `formatCliFailure` (CLI exit-code error message builder).
- `server/src/services/claude.js:150-181` — base64 → temp file (`decodeImageInput`, `writeTempImageFile`).
- `server/src/services/claude.js:195-434` — `chat` (streaming chat entry point).
- `server/src/services/claude.js:203` — chat args list (`-p --output-format stream-json --verbose --include-partial-messages`).
- `server/src/services/claude.js:272-276` — chat spawn.
- `server/src/services/claude.js:291` — chat stdin write.
- `server/src/services/claude.js:300-310` — chat activity-based timeout.
- `server/src/services/claude.js:312-358` — chat stdout line consumer.
- `server/src/services/claude.js:365-416` — chat close handler.
- `server/src/services/claude.js:418-421` — chat error handler.
- `server/src/services/claude.js:442-728` — `parseEscalation` image branch (Steps A + B).
- `server/src/services/claude.js:455-479` — escalation JSON schema definition.
- `server/src/services/claude.js:517-520` — Step A args.
- `server/src/services/claude.js:614-616` — Step B args.
- `server/src/services/claude.js:730-857` — text-input parse branch.
- `server/src/services/claude.js:737-739` — text parse args.
- `server/src/services/claude.js:862-893` — `warmUp`.
- `server/src/services/claude.js:918-927` — `extractThinking` (stream_event unwrapping + thinking_delta detection).
- `server/src/services/claude.js:936-943` — `extractText` (only `content_block_delta.delta.text`).
- `server/src/services/claude.js:949-960` — `extractFinalText` (fallback to `assistant`/`result`).
- `server/src/services/claude.js:973-1070` — `prompt`.
- `server/src/services/claude.js:1086-1234` — `transcribeImage`.
- `server/src/services/claude.js:1236` — module exports.
- `server/src/lib/usage-extractor.js:14-17` — `CLAUDE_EXTRA_DIMENSIONS` (`cache_creation_input_tokens`, `cache_read_input_tokens`).
- `server/src/lib/usage-extractor.js:65-82` — `extractClaudeUsage` (reads `msg.type === 'result'` with `msg.usage`, falls back to `msg.message.usage`).
- `server/src/services/providers/registry.js:1` — `const claude = require('../claude')`.
- `server/src/services/providers/registry.js:56-58` — registry default routes `transport: 'claude'` to the `claude` service module.
- `server/src/services/providers/registry.js:102-109` — Claude timeout env var lookup.
- `server/src/services/providers/registry.js:115` — `meta?.transport || 'claude'` default.
- `server/src/services/providers/registry.js:122-126` — `CLAUDE_SUPPORTS_IMAGE_INPUT` toggle.
- `server/src/services/providers/registry.js:196-202` — chat adapter + `parseEscalation` + `transcribeImage` wiring.
- `server/src/services/providers/catalog.js:67` — `getProviderTransport` defaults to `'claude'`.
- `server/src/services/agent-health-service.js:87, 204` — health-check branching on `transport === 'claude'`.
- `server/src/index.js:228` — `const { warmUp: warmClaude } = require('./services/claude')` (boot-time warm-up).
- `server/src/routes/escalations.js:27` — `const { prompt: claudePrompt } = require('../services/claude')`.
- `server/src/routes/gmail.js:5` — `const { chat } = require('../services/claude')`.
- `server/src/lib/chat-image.js:3` — `const { transcribeImage } = require('../services/claude')`.
- `server/src/services/workspace-proactive.js:124-212` — `evaluateProactiveAction(...)`, the 8th model-work spawn site.
- `server/src/services/workspace-proactive.js:145, 148, 151-161` — args, spawn options, env overrides.
- `server/src/services/workspace-proactive.js:126, 168` — proactive stdin prompt assembly + `child.stdin.end(prompt)`.
- `server/src/services/workspace-proactive.js:141-142, 180-186` — single-string stdout/stderr accumulators (no line splitting).
- `server/src/services/workspace-proactive.js:188-203` — close handler; rejects on non-zero exit with empty stdout; otherwise parses stdout via `parseProactiveResponse`.
- `server/src/services/workspace-monitor.js:9, 165-172` — invoker that calls `evaluateProactiveAction` for new urgent alerts.
- `server/src/lib/agent-prompt-store.js:119-125` — `workspace-proactive` agent prompt template registration (rendered into the proactive system prompt).
- `server/src/services/agent-health-service.js:127-185` — `checkCli(command, args, timeoutMs)` operational probe; `stdio[0] = 'ignore'`, no stdin written.
- `server/src/services/agent-health-service.js:204-205` — `if (transport === 'claude') { const cli = await checkCli('claude'); ... }` invoker of the probe.

### Official documentation (fetched 2026-05-20 via WebFetch)

- `https://code.claude.com/docs/en/cli-reference`
  - Confirmed `--output-format` accepts `text`, `json`, `stream-json` (Mode column, row for `--output-format`).
  - Confirmed `--include-partial-messages` requires `--print` and `--output-format stream-json`.
  - Confirmed `--include-hook-events` requires `--output-format stream-json`.
  - Confirmed `--json-schema` requires `--output-format json` and is print-mode-only.
  - Confirmed `--max-turns` is print-mode-only, "no limit by default", exits with error when reached.
  - Confirmed `--effort` accepts `low`, `medium`, `high`, `xhigh`, `max`, "available levels depend on the model".
  - Confirmed `--permission-mode` accepts `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`.
  - Confirmed `--add-dir` "grants file access; most `.claude/` configuration is not discovered".
  - Confirmed `--bare` skips auto-discovery for scripted callers.
- `https://code.claude.com/docs/en/headless`
  - Confirmed `--output-format json` response includes `result`, `session_id`, `total_cost_usd`, per-model cost breakdown, and `structured_output` when `--json-schema` is supplied.
  - Confirmed `--output-format stream-json` is newline-delimited JSON, requires `--verbose`, and partial messages additionally require `--include-partial-messages`.
  - Confirmed `system/init` event reports `cwd`, `session_id`, `tools`, `mcp_servers`, `model`, `permissionMode`, `plugins`, `plugin_errors`.
  - Confirmed `system/api_retry` event fields: `type`, `subtype`, `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`, `uuid`, `session_id`. Error category enum: `authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown`.
  - Confirmed `system/plugin_install` event fields and status enum.
- `https://code.claude.com/docs/en/agent-sdk/streaming-output`
  - Confirmed `StreamEvent` / `SDKPartialAssistantMessage` wrapper shape: `{ type: "stream_event", event, parent_tool_use_id, uuid, session_id }`.
  - Confirmed inner `event.type` values: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.
  - Confirmed delta variants: `text_delta`, `input_json_delta`, `thinking_delta`, `signature_delta`.
  - Confirmed default (non-partial) message types: `SystemMessage` (subtype `init` or `compact_boundary`), `AssistantMessage`, `ResultMessage`.
  - Confirmed `ResultMessage` carries `result` field and `subtype === "success"` filter pattern.
  - Confirmed structured-output JSON appears in final `ResultMessage.structured_output`, not as streaming deltas.
- `https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode`
  - Confirmed image-attachment shape for streaming input: `{ type: "image", source: { type: "base64", media_type, data } }`. (Not used by this wrapper, which goes via `--add-dir` + temp files instead.)
- `https://code.claude.com/docs/en/agent-sdk` (overview)
  - Confirmed auth methods: `ANTHROPIC_API_KEY`, Bedrock (`CLAUDE_CODE_USE_BEDROCK`), AWS Claude Platform (`CLAUDE_CODE_USE_ANTHROPIC_AWS`), Vertex AI (`CLAUDE_CODE_USE_VERTEX`), Foundry (`CLAUDE_CODE_USE_FOUNDRY`), plus subscription login. The wrapper does not set any of these — it relies on the host shell environment.
