# openai-cli Provider Harness Contract

## Summary

- **Research label vs actual app id:** "openai-cli" is the research-queue label only. The actual provider id used in this codebase for the local/login-backed OpenAI path is **`codex`** (catalog id), exposed via `transport: "codex"`. The catalog has separate model-specific ids in the same family — `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` — all of which route to the same code (`server/src/services/codex.js`). There is no provider id literally named `openai-cli` anywhere in source. There is also a distinct `openai` provider id (HTTP-API path) which is out of scope here.
- **Provider path type:** Spawned local CLI subprocess — `child_process.spawn('codex', [...], { shell: true })` — invoking the OpenAI Codex CLI binary on the host PATH. Auth is via the host's existing Codex CLI login/subscription state (e.g. ChatGPT login or Codex login); the application code does **not** pass an API key to the subprocess and does not set `OPENAI_API_KEY` for it. The single explicit env mutation on spawn is clearing `CLAUDECODE` (`codex.js:142`, `codex.js:259`, `codex.js:356`, `codex.js:523`) — a guard borrowed from the Claude CLI integration to avoid nested-session signaling. Whatever auth state `codex` finds locally is what it uses.
- **Wire format observed:** `codex exec --json` produces a newline-delimited JSON event stream on stdout. The application parses it line-by-line and pulls (a) text deltas and (b) reasoning deltas and (c) usage events. stderr is collected to a capped 10 KB buffer for failure messages. Exit code 0 = success.
- **Full package preservation status today:** **Lossy.** Each individual stdout event is JSON-parsed once for usage and once for delta extraction, then dropped. Only the joined assistant text and the most-recently-seen `usage` object survive to the caller. The full ordered event list, stderr text, exit code, command args, stdin payload, and timing are all discarded. (`codex.js:130-226`)
- **Streaming?** The CLI streams. The Node process consumes the stream and exposes it to upstream callers via `onChunk` / `onThinkingChunk` / `onDone` callbacks (`codex.js:144-194`). The chat-leg's downstream consumer treats this as a real stream; the image-parser leg buffers it. Either way, ordered events arrive at this server. None of them are persisted today.
- **Main uncertainty:** The exact, versioned JSONL event schema for `codex exec --json` is not officially published as a stable spec at a URL I could fetch. OpenAI's docs confirm `--json` exists and lists event-type categories (`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`) but no field-by-field schema. The application's parser code (`codex.js:662-742`) shows the shapes the running CLI actually emits in this project today.

## Provider IDs In This App

- **Research provider id:** `openai-cli` — exists only in `provider-harness-research/` documents (`HANDOFF.md`, `openai-cli-prompt.md`, `RESEARCH_PLAN.md`, `README.md`, `providers/README.md`). Not present in source, catalog, env, UI labels, or tests.
- **Actual app provider ids:** All from `shared/ai-provider-catalog.json`:
  - `codex` — `family: "codex"`, `transport: "codex"`, default `model: "gpt-5.5"`, label `"OpenAI Codex CLI"`, `selectable: true`, `supportsThinking: true`, `reasoningVisibility: "stream"`, `allowedEfforts: ["low","medium","high","xhigh"]` (catalog lines 60-74).
  - `gpt-5.5` — same family/transport, label `"OpenAI Codex CLI - GPT-5.5"`, `selectable: false` (lines 75-89).
  - `gpt-5.4` — same family/transport, label `"OpenAI Codex CLI - GPT-5.4"`, `selectable: false`, `model: "gpt-5.4"` (lines 104-118).
  - `gpt-5.4-mini` — same family/transport, `model: "gpt-5.4-mini"`, `selectable: false` (lines 119-133).
- **Transport string in routing code:** `'codex'` — `server/src/services/providers/registry.js:44-45`, `:66-71`, `:121`.
- **Family helper:** `getCodexProviderIds()` in `server/src/services/providers/catalog.js:137-139` returns every catalog entry whose `family === 'codex'`. Used as the source of truth for "is this a Codex/CLI provider" by `image-parser.js:69-76`.
- **Environment variables (read by `codex.js`):**
  - `CODEX_CHAT_MODEL` (default `'gpt-5.5'`) — `codex.js:12`
  - `CODEX_REASONING_EFFORT` (default `'high'`) — `codex.js:13`
  - `CODEX_CHAT_TIMEOUT_MS` (default 180000) — `codex.js:29`
  - `CODEX_PARSE_MODEL` (default = `CODEX_CHAT_MODEL`) — `codex.js:30`
  - `CODEX_PARSE_REASONING_EFFORT` — `codex.js:31`
  - `CODEX_PARSE_TIMEOUT_MS` (default 120000) — `codex.js:32`
  - `CODEX_TRANSCRIBE_TIMEOUT_MS` — `registry.js:67-71`
  - `CODEX_SUPPORTS_IMAGE_INPUT` (default `true`) — `registry.js:121-122`
  - `CODEX_DEV_MODEL` — read in `lib/usage-extractor.js:26` for an env-level model fallback
- **UI labels:** `"OpenAI Codex CLI"`, `"OpenAI Codex CLI - GPT-5.5"`, `"OpenAI Codex CLI - GPT-5.4"`, `"OpenAI Codex CLI - GPT-5.4 Mini"` (catalog). Icons: `/provider-icons/openai-dark.svg` / `/provider-icons/openai.svg`.
- **Server-side env file:** `server/.env.example` does **not** list a Codex-specific env variable. `OPENAI_API_KEY` is listed (line 36) but is used only by the `openai` HTTP-API path, not the `codex` CLI path. The Codex CLI relies on its own ambient login state.

Evidence: `shared/ai-provider-catalog.json:60-133`, `server/src/services/codex.js:12-32`, `server/src/services/providers/catalog.js:137-139`, `server/src/services/providers/registry.js:44-71, 121-126`, `server/.env.example:35-37`.

## Current App Call Sites

The `codex` binary is spawned from six distinct call sites today, in two groups: **main model-work spawns** that send a prompt and read the model's response, and **operational probes** that do not exercise the model. Additionally, an image-parser wrapper invokes `codex.chat` without spawning the binary itself. All factual; line numbers verified against current `master`.

**Main model-work spawns** (three): `codex.chat` (chat leg), `codex.parseEscalation` (standalone image parse), `codex.transcribeImage` (image transcription) — all in `server/src/services/codex.js`.

**Operational probes** (three): `codex.warmUp` (startup warm-up spawn of `codex exec --json`), `checkCodexCliAvailability` (spawns `codex --version`), and `checkCli('codex')` in `agent-health-service.js` (spawns `codex --version` for health checks).

**Non-spawning wrappers**: `image-parser.js` `callCodex` is a Promise wrapper that calls `codex.chat` — it does not itself spawn a process. `server/src/services/providers/registry.js` and `server/src/index.js` route to / trigger these functions but do not spawn directly.

### 1. Chat leg — `codex.chat(...)` (main model-work spawn)

- **File:** `server/src/services/codex.js:105-240` (function `chat`).
- **Spawn site:** `codex.js:139-143` — `spawn('codex', args, { stdio: ['pipe','pipe','pipe'], shell: true, env: { ...process.env, CLAUDECODE: undefined } })`.
- **What it does:** Concatenates the optional `systemPrompt`, the message history, and a trailing `Assistant:` prompt (`buildPrompt`, `codex.js:614-637`); writes the result to the child's stdin; reads stdout line-by-line, splitting on `\n`; per-line, attempts `JSON.parse` and feeds three pipelines:
  1. **Usage:** `extractCodexUsage(event, { fallbackModel })` from `server/src/lib/usage-extractor.js` (`codex.js:181-183`).
  2. **Thinking deltas:** `extractThinkingFromEventLine(line, seenReasoningTextByItem)` — emits delta-only text to `onThinkingChunk` (`codex.js:184-187`, function defined at `codex.js:697-742`).
  3. **Visible text deltas:** `extractDeltaFromEventLine(line, seenAgentTextByItem)` — emits delta-only text to `onChunk` and appends to `fullResponse` (`codex.js:188-192`, function defined at `codex.js:662-695`).
- Stderr is captured to `stderrOutput` capped at 10240 bytes (`codex.js:196-199`).
- On `close`, parses the remaining `stdoutBuffer` once more for trailing usage/thinking/delta, then either calls `onError` with a `formatCliFailure(code, stderrOutput)` message (exit ≠ 0) or `onDone(fullResponse, capturedUsage)` (exit 0).
- Returns a `cleanup` function that kills the child (`SIGTERM`) and returns `{ usage, partialResponse }` (`codex.js:233-239`).
- **Routed from:** `server/src/services/providers/registry.js:44-45` (transport `'codex'` returns the `codex` service); wired into the workspace chat adapter at `registry.js:150` (`def.getChat()`).

### 2. Image-parser leg — `callCodex(...)` -> `codex.chat(...)` (non-spawning wrapper around the chat-leg spawn)

- **File:** `server/src/services/image-parser.js:1350-1405` (function `callCodex`), called from `image-parser.js:1597`.
- **What it does:** Wraps `codex.chat` in a Promise. Passes:
  - `messages: [{ role: 'user', content: 'Read the image and output only the parser result required by the system instructions.' }]`
  - `systemPrompt` (the parser prompt)
  - `images: [imageDataUrl]` — a data-URL string
  - `model`, `reasoningEffort`, `timeoutMs`
  - `onChunk` accumulates streamed text; `onThinkingChunk` feeds a coalescer that re-emits `'llm.thinking'` events on the parser eventBus.
- The Codex `chat` function then `writeImageTempFiles` decodes the base64, writes each to `os.tmpdir()` as `qbo-codex-img-<ts>-<pid>-<i>.<ext>` (`codex.js:639-654`), and adds them to the CLI args as `--image <tmpPath>` pairs (`codex.js:125-127`). Temp files are unlinked on success, error, or cleanup.

### 3. Standalone image parse — `codex.parseEscalation(...)` (main model-work spawn)

- **File:** `server/src/services/codex.js:291-448`.
- **Spawn site:** `codex.js:353-357`.
- **What it does:** Schema-driven escalation field extractor. Builds a JSON-only instruction block plus a schema example via `JSON.stringify` (`codex.js:305-331`). Detects whether the input is base64 image data or text; for image input, writes a temp file and adds `--image <tmpPath>` args. Streams stdout, accumulates deltas into `fullResponse`, then on close runs `extractJSONObject(fullResponse)` (`codex.js:744-759`) and resolves with `{ fields, usage }`. If parsing fails, falls back to `{ category: 'unknown', attemptingTo: fullResponse.slice(0, 800) }`.
- **Currently wired but selectability:** Reachable via the registry's `getParse: () => withDefaultModel(service?.parseEscalation)` (`registry.js:152`); `codex.parseEscalation` is exported (`codex.js:780`).

### 4. Image transcription — `codex.transcribeImage(...)` (main model-work spawn)

- **File:** `server/src/services/codex.js:464-612`.
- **Spawn site:** `codex.js:520-524`.
- **What it does:** "Just transcribe the text in this image" path. Accepts either base64 data, a `data:image/...` URL, or an absolute filesystem path; passes the file via `--image`. Streams stdout, accumulates deltas, on close resolves `{ text, usage }`. No JSON extraction step.

### 5. Warm-up — `codex.warmUp()` (operational probe)

- **File:** `server/src/services/codex.js:242-282`.
- **Spawn site:** `codex.js:249-260`. Invoked from `server/src/index.js:229-237` on server startup as a fire-and-forget background task.
- Pipes the literal prompt `Reply with exactly: ok` to stdin. 30-second timeout. Resolves regardless of result. Logs `'Codex CLI warm-up complete'` on close.

### 6. Availability probe — `checkCodexCliAvailability(...)` (operational probe)

- **File:** `server/src/services/image-parser.js:352-440` (mainly `:373-377`).
- **What it does:** Spawns `codex --version`. 3-second timeout. Resolves `{ available, code, reason, model }`. Used by `getProviderAvailabilities` (`image-parser.js:1754-1762`) to mark every Codex catalog id as available/unavailable for the UI.

### 7. Agent-health check — `checkCli('codex')` (operational probe)

- **File:** `server/src/services/agent-health-service.js:192-193` — when `transport === 'codex'`, calls `checkCli('codex')`. The `checkCli` helper (`agent-health-service.js:127-185`) itself spawns the binary: `spawn(command, ['--version'], { stdio: ['ignore','pipe','pipe'], shell: true, env: { ...process.env, CLAUDECODE: undefined } })` with a 3s timeout. Same file at line 87 confirms the binary check applies only to `codex` and `claude` transports.

### Transport summary

Every Codex call site uses Node `child_process.spawn` with `shell: true` so a Windows `.cmd` shim works. There is no SDK wrapper, no HTTP client, and no local gateway involved in the `codex` transport. The conversation flows entirely through stdin -> child process -> stdout/stderr -> exit code.

Evidence: `server/src/services/codex.js:105-240, 242-282, 291-448, 464-612, 614-637, 639-654, 662-742, 744-759, 780-782`; `server/src/services/image-parser.js:1350-1405, 1596-1597, 352-440, 1754-1762, 69-76`; `server/src/services/providers/registry.js:44-71, 121-126, 145-165`; `server/src/services/agent-health-service.js:87, 192-193`; `server/src/index.js:229-237`.

## Request Package Sent Today

All Codex call sites assemble a near-identical command shape. The variable parts are model, reasoning effort, image temp paths, and the prompt content piped via stdin.

### Common to every spawn

- **Command:** `codex` (resolved off the host PATH; on Windows usually a `.cmd` shim, which is why `shell: true` is set — `codex.js:141, 258, 355, 522`).
- **stdio:** `['pipe','pipe','pipe']` — stdin, stdout, stderr are all piped to the Node process.
- **`shell: true`** — required on Windows so the OS resolves the `.cmd` shim.
- **`env`:** `{ ...process.env, CLAUDECODE: undefined }`. No secret values quoted. The application does **not** set `OPENAI_API_KEY` for the child; the child relies on whatever auth state the host's `codex` install already has (e.g. a prior `codex login` or ChatGPT-account-bound subscription state). This is the load-bearing reason this provider path is treated as "subscription/login-backed" rather than API-key-backed.
- **Subcommand and base args:** `exec --json --model <model> -c reasoning_effort="<effort>" --skip-git-repo-check`. Then zero or more `--image <path>` pairs. Then a literal `-` to signal "read prompt from stdin".
- **stdin:** A single UTF-8 string is written, then stdin is closed. No framing.
- **Auth mechanism name only:** Codex CLI subscription/login (ambient). No `Authorization` header, no `x-api-key`, no env var set by this app.

### Mode A — Chat (`codex.chat`)

Args assembled at `codex.js:117-128`:

```
codex exec --json --model <model> -c reasoning_effort="<effort>" --skip-git-repo-check [--image <tempPath>]* -
```

- `<model>`: `opts.model || process.env.CODEX_CHAT_MODEL || 'gpt-5.5'`.
- `<effort>`: normalized to one of `low | medium | high | xhigh` (`codex.js:14, 24-27`); default `process.env.CODEX_REASONING_EFFORT || 'high'`.
- `<tempPath>`: a file under `os.tmpdir()` whose contents are the decoded base64 of an input image, named `qbo-codex-img-<ts>-<pid>-<i>.<ext>` (`codex.js:639-654`). Extension is derived from the data-URL MIME subtype (`codex.js:40-51`).
- **stdin payload:** `buildPrompt(messages, systemPrompt)` (`codex.js:614-637`). Format:
  - Optional first block: `System instructions:\n<systemPrompt>` if a non-empty system prompt was passed.
  - If the only thing is a single message and no system prompt, sends just that message's `.content`.
  - Otherwise: `\n\n`-joined turns prefixed by `User: ` / `Assistant: ` / `System: ` based on `msg.role`, then a final `Assistant:` line to cue the next reply.
- **timeoutMs:** `opts.timeoutMs || CODEX_CHAT_TIMEOUT_MS (180000)` (`codex.js:115`). Enforced via `setTimeout` that calls `child.kill('SIGTERM')` and surfaces a `TIMEOUT` error.
- **Streaming flag:** Always streaming because `--json` is set; this is the only mode the CLI supports here.
- **No** temperature, top_p, tools, MCP config args, web-search flags, or `--output-schema` are passed.

### Mode B — Parse escalation (`codex.parseEscalation`)

Args assembled at `codex.js:338-348`. Same shape as Mode A, but:

- `<model>`: `options.model || process.env.CODEX_PARSE_MODEL || CODEX_CHAT_MODEL || 'gpt-5.5'` (`codex.js:30, 302`).
- `<effort>`: `options.reasoningEffort || process.env.CODEX_PARSE_REASONING_EFFORT || 'high'`, normalized (`codex.js:31, 303`).
- `<timeoutMs>`: `options.timeoutMs || CODEX_PARSE_TIMEOUT_MS (120000)` (`codex.js:32, 299-301`).
- **stdin payload:** Instructions block + schema example + (for text inputs only) `\n\nEscalation text:\n<text>` (`codex.js:319-335`).

### Mode C — Image transcribe (`codex.transcribeImage`)

Args at `codex.js:507-517`. Same shape. stdin payload is the multi-line `Transcribe ALL text visible in this image exactly as written.\n...` prompt (`codex.js:482-488`).

### Mode D — Warm-up

Hardcoded `codex exec --json --model <DEFAULT_MODEL> -c reasoning_effort="<DEFAULT_REASONING_EFFORT>" --skip-git-repo-check -` with stdin `'Reply with exactly: ok'` (`codex.js:249-262`). 30 s timeout.

### Mode E — Availability probe

`codex --version`. stdin ignored. 3 s timeout. (`image-parser.js:373-387`).

Evidence: `server/src/services/codex.js:12-32, 105-145, 249-262, 291-348, 464-525, 614-637, 639-654`; `server/src/services/image-parser.js:373-387`.

## Official Response Package

This section separates **official-doc facts** from **inference from current app source**.

### Official-doc facts (with source URLs)

The OpenAI Codex CLI documentation at `https://developers.openai.com/codex/cli/reference` and `https://developers.openai.com/codex/noninteractive` (both fetched during this research) confirm:

- **Invocation:** `codex exec --json` enables a JSON Lines (JSONL) event stream on stdout. From the reference: "Print newline-delimited JSON events instead of formatted text."
- **Channel separation in normal (non-`--json`) mode:** The non-interactive doc says: "Codex streams progress to `stderr` and prints only the final agent message to `stdout`." That is the documented behavior of normal-mode `codex exec`.
- **Channel separation under `--json`:** Officially, the non-interactive doc only describes stdout under `--json`: "When you enable `--json`, `stdout` becomes a JSON Lines (JSONL) stream so you can capture every event Codex emits while it's running." The official docs do **not** explicitly state what `stderr` carries when `--json` is enabled. The CLI reference page does not mention `stderr` at all. Treat any claim about stderr-under-`--json` as inference, not official-doc fact.
- **App-source fact about stderr (regardless of mode):** This app captures `child.stderr` data into a `stderrOutput` string buffer capped at 10240 bytes (`codex.js:196-199`) and uses it only to format the human-readable failure message via `formatCliFailure(code, stderrOutput)` (`codex.js:78-90`, called at `codex.js:222`). Stderr should be preserved as part of the subprocess package because (a) the app currently relies on it for failure messages, and (b) the official docs do not promise that `--json` silences stderr.
- **Event-type categories listed in the docs:** `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`.
- **Item categories listed in the docs:** agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, and plan updates. (Verbatim from the noninteractive doc: "Item types include agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, and plan updates.")
- **Final-result signaling:** A `turn.completed` event marks success. The final agent message appears as an item with `type: "agent_message"`. A `-o <path>` flag (not used by this app) can persist the final message to a separate file.
- **Usage / token metadata:** Token accounting is included on completed-turn events. The sample shown in the docs is `"usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}` — i.e. fields `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`.
- **Error events:** Failures are signaled via `error`-type events in the JSONL stream and/or `turn.failed`. The docs do not enumerate the full error sub-fields.
- **Exit codes:** The docs do not publish a stable exit-code table for `codex exec --json`. The reference notes only that if a required MCP server fails to initialize, `codex exec` exits with an error instead of continuing.

(GitHub issue-tracker context — known-incomplete behavior reported in the OpenAI Codex issue tracker — has been moved to `Gaps And Questions` and is **not** treated as official-doc fact about the response package.)

What the **published docs do not specify** at a field level (as of fetch):

- A stable JSON Schema for each event type.
- Whether or where `id` correlation fields live on item events.
- Exact shape of `error`-type event bodies (only the category is named).
- Stable list of stop / finish reasons.
- Whether `usage` always lives on `turn.completed` only, or also on `item.type === "usage"` events as well.

### Inference from current app code (what the running CLI actually emits in this project)

`server/src/lib/usage-extractor.js:98-132` and `server/src/services/codex.js:662-742` are the operational source of truth for the shapes this app observes today. They show the parser code is written to handle **multiple coexisting shapes**, all of which have been seen in practice (per comments in `usage-extractor.js`):

- **Usage events arrive in any of these shapes** (`usage-extractor.js:98-131`):
  1. `event.usage` — top-level usage object (likely on `turn.completed`).
  2. `event.item.type === 'usage'` with a nested `event.item.usage` sub-object.
  3. `event.item.type === 'usage'` with token fields flat on the item itself.
  4. `event.type === 'usage'` — direct usage event with token fields top-level.
- **Token field names observed/handled:** `input_tokens`, `output_tokens`, `prompt_tokens`, `completion_tokens` (`usage-extractor.js:180-181`).
- **Extra dimensions observed/handled:** `reasoning_tokens`, `cached_tokens` (`usage-extractor.js:18-21`), plus any `*_details` nested object containing those keys (`usage-extractor.js:46-54, 211-220`).
- **Agent-message events** carry the running assistant text as a **monotonically growing absolute string** rather than pure deltas. The parser computes the delta itself by storing the previous text per `item.id` and slicing the prefix off the new text (`codex.js:672-682`). Field-level shape inferred from the code:

```
{ item: { id: "<string>", type: "agent_message", text: "<absolute-so-far>" }, ... }
```

  This is consistent with `item.completed` of type `agent_message`.

- **Reasoning events** show two coexisting shapes (`codex.js:707-729`):
  - `{ item: { id, type: "reasoning"|"agent_reasoning", text: "<absolute-so-far>" } }`
  - `{ item: { id, type: "reasoning"|"agent_reasoning", summary: [ string | { text: string } ] } }`
  - Same monotonic-prefix behavior as agent_message.
- **Delta-only events** also exist (`codex.js:684-693`) where the line carries `delta: string`, or `delta: { text: string }`, or a `type` field containing the substring `delta` plus a `text` field. The exact `type` values are not enumerated in source.
- **Errors:** `codex.js` does not parse `error` events from the JSON stream into structured form. A non-zero exit code is the failure signal in source; stderr text (capped at 10 KB) is used to format the human-readable error message via `formatCliFailure(code, stderrOutput)` (`codex.js:78-90`), which special-cases "command not found" detection.

### Streaming chunk/event shape (live observation)

The CLI emits one JSON object per line on stdout, separated by `\n`. The parser splits on `\n` and keeps the trailing partial line in a buffer (`codex.js:171-176, 393-407, 565-579`). On `child.close`, the trailing `stdoutBuffer` is parsed one last time (`codex.js:205-220, 413-425, 586-598`).

### Documentation links (fetched)

- `https://developers.openai.com/codex/cli/reference` — Codex CLI command-line options. Confirms `--json` flag and behavior summary.
- `https://developers.openai.com/codex/noninteractive` — Non-interactive mode. Confirms event-type categories, item categories, usage sample, and final-result signaling.
- `https://developers.openai.com/codex/cli/features` — Feature catalog (not field-level).

(Non-contract issue-tracker references — OpenAI Codex GitHub issues #2288, #10141, #15451 — appear in `Gaps And Questions`. They are not proof of the official response package and are not relied on here.)

## Streaming vs Non-Streaming

- **Current app behavior:** **Streaming.** Every Codex spawn passes `--json`, which makes stdout a JSON Lines event stream, and the Node parser consumes lines as they arrive (`codex.js:172-194, 393-407, 565-579`). The chat-leg `onChunk` callback is called for each new delta in real time; the parser leg `onChunk` accumulates the same deltas into a buffer.
- **Provider capability:** The Codex CLI also supports a non-`--json` mode (formatted text), but **the application never invokes it**. There is no `--output-schema`, no `-o <file>` argument, and no plain-text exec mode in source.
- **Final-response detection in this app:** This app does **not** key off `turn.completed` or `event.type === 'message_stop'` style markers. Final-response detection is purely the child-process `close` event with `exit code === 0` (`codex.js:201-226`). The accumulated `fullResponse` string built from per-line deltas is what gets returned to the caller. Any post-`close` parse of the remaining buffer is best-effort.
- **Storage implication for Mongo:** Streaming chunk/event preservation is **load-bearing for this provider path**, not optional. If the harness wants to be able to reconstruct what happened, it needs to capture the ordered event list as the lines arrive, not the synthetic `{ text, usage }` shape the parser exposes to the rest of the server.

Evidence: `server/src/services/codex.js:117-128, 171-194, 201-226, 393-425, 507-517, 565-598`.

## Raw Package That Reaches This Server Today

The "first observable provider response unit" inside this server is the **raw stdout byte chunks emitted on the child process's stdout stream**, plus byte chunks on stderr, plus the eventual exit code on the child's `close` event.

Exact variables from source (chat leg; other modes are equivalent):

- `child` — the `ChildProcess` returned by `spawn('codex', args, { ... })` (`codex.js:139`). All raw provider response data flows through this object.
- `data` — `Buffer` arg passed into the stdout `'data'` listener (`codex.js:172`): `child.stdout.on('data', (data) => { ... })`. This is the first raw provider byte the server sees on each chunk. The code immediately calls `data.toString()` and appends to `stdoutBuffer` (a UTF-8 string accumulator).
- `stdoutBuffer` — `string`. The line-buffered accumulator (`codex.js:171`). At any given moment it contains all bytes received so far that have not yet been split on `\n` into a complete line and consumed.
- `lines` — `string[]`. `stdoutBuffer.split('\n')` (`codex.js:175`); the trailing element is popped back into `stdoutBuffer` to preserve partial-line state.
- `line` — `string`. One JSONL frame (`codex.js:178`). This is the **canonical raw provider event** as a string. Each `line` is fed to `JSON.parse` to attempt to recover an `event` object — but the original `line` string is **not retained** anywhere after the for-loop iteration ends.
- `event` — `Object | undefined`. `JSON.parse(line)` result on a per-line basis (`codex.js:180, 400, 572`). This is the **canonical raw provider event** as a parsed JSON object. Same lifecycle — referenced inside one iteration of the per-line loop, then garbage-collected.
- `stderrOutput` — `string`. Capped-at-10240-bytes accumulator of stderr chunks (`codex.js:196-199`). Survives the whole subprocess lifetime.
- `code` — `number | null`. The child's exit code, delivered via `child.on('close', (code) => ...)` (`codex.js:201`).
- `child.on('error', (err) => ...)` — Node-level spawn errors (e.g. `ENOENT` when the binary is missing). The `err` here is an `Error`, not a Codex event.

What the **caller** of `codex.chat` actually receives:

- `onChunk(delta: string)` — called per derived text delta from `extractDeltaFromEventLine`. **Already lossy** — the delta string is not the original line; it has been pulled out of a parsed event and reduced to what is new since last time using the monotonic-prefix algorithm.
- `onThinkingChunk(delta: string)` — same pattern for reasoning text.
- `onDone(fullResponse: string, capturedUsage: object|null)` — fired once on success. `fullResponse` is the concatenation of all visible deltas. `capturedUsage` is the **last** usage object seen (later usage events overwrite earlier ones, `codex.js:181-182, 206-208`), shaped by `_buildResult` to `{ inputTokens, outputTokens, model, rawUsage, usageComplete }` (`usage-extractor.js:176-192`).
- `onError(err: Error)` — fired on timeout, non-zero exit, or spawn error. The Error message may be `formatCliFailure` concatenated stderr preview (capped at 500 chars) or a `TIMEOUT`-coded error. `err._usage` is the last seen usage object.

### What current code preserves vs discards

**Preserved past the helper:**

- The **final concatenated visible-text string** (`fullResponse`).
- The **most recent `usage` object** seen (overwrites earlier ones).
- The exit code is observed (to decide success vs error) but is **not** surfaced upward.
- A **truncated** stderr preview embedded in the Error message on failure.

**Discarded entirely:**

- The full ordered list of stdout JSON lines (every event after one parse pass — `agent_message`, `reasoning`, `agent_reasoning`, `usage`, `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `error`, `command_execution`, `mcp_tool_call`, `web_search`, etc.).
- Item `id` values, which would correlate which agent_message produced which reasoning trace.
- Reasoning-summary structured form (`item.summary[]`) — only its joined text is propagated.
- Stderr text beyond the truncated preview, and even the preview is dropped on success.
- Exit code on the success path.
- Command name, args list, and the literal stdin payload string (the prompt).
- Timestamps of the request start, the first byte, each event, and the close.
- Spawn-level metadata (pid, signal that killed on timeout).
- All non-text item types (`command_execution`, `file_change`, `mcp_tool_call`, `web_search`, plan-update items) — they pass through `extractDeltaFromEventLine`/`extractThinkingFromEventLine`, return `''`, and are silently dropped.

Evidence: `server/src/services/codex.js:139-145, 171-226, 393-425, 565-598, 662-742`; `server/src/lib/usage-extractor.js:98-192`.

## Proposed Mongo Storage Shape

Goal: preserve the full Codex CLI subprocess interaction so that a developer can later inspect (a) what was sent to the CLI, (b) every line the CLI emitted on stdout and stderr, (c) how the call terminated, and (d) the local-environment context the CLI ran in. Field naming is suggestive only.

### Required

- `providerId` — `"codex"` (or the specific model alias used: `"gpt-5.5"` / `"gpt-5.4"` / `"gpt-5.4-mini"`). Matches the catalog id chosen at request time.
- `providerFamily` — `"codex"` (matches catalog `family`).
- `transport` — `"codex"` (matches catalog `transport`).
- `callerSite` — enum: `"chat"`, `"image-parser"`, `"parse-escalation"`, `"transcribe-image"`, `"warm-up"`, `"availability-probe"`. Identifies which code path made the call.
- `command` — string, always `"codex"`.
- `args` — `string[]`. The full argv after `command`, e.g. `["exec","--json","--model","gpt-5.5","-c","reasoning_effort=\"high\"","--skip-git-repo-check","--image","/tmp/...","-"]`.
- `stdin` — the literal prompt string or an external payload reference, plus `byteLength` and `sha256`. The literal prompt is required for reproducibility but can be large (system prompt + image instructions + history).
- `subprocess` — `{ shell: true, cwd: <process.cwd()>, pid: <child.pid|null>, killedSignal: <"SIGTERM"|null> }`.
- `envContext` — sanitized snapshot of env vars that influenced behavior: `CODEX_CHAT_MODEL`, `CODEX_REASONING_EFFORT`, `CODEX_CHAT_TIMEOUT_MS`, `CODEX_PARSE_MODEL`, `CODEX_PARSE_REASONING_EFFORT`, `CODEX_PARSE_TIMEOUT_MS`, `CODEX_TRANSCRIBE_TIMEOUT_MS`, `CODEX_SUPPORTS_IMAGE_INPUT`, plus presence (boolean) of any login credential files Codex consults — never the credentials themselves. Note explicitly: `OPENAI_API_KEY` is **not** part of this auth path; if it is also set in the host env, do not assume it influenced Codex.
- `timeoutMs` — configured timeout for this call.
- `startedAt` — ISO timestamp immediately before `spawn`.
- `closedAt` — ISO timestamp on the child's `close` event.
- `durationMs` — derived.
- `exitCode` — integer or null.
- `outcome` — enum: `"success"` (exit 0, no internal timeout), `"non_zero_exit"`, `"timeout"`, `"spawn_error"`.
- `stdoutEvents` — **ordered array**. One entry per `\n`-terminated stdout line received during the run. Each entry:
  - `seq` — 0-based index.
  - `receivedAt` — ISO timestamp.
  - `rawLine` — the literal UTF-8 line (no trailing `\n`).
  - `parsed` — `JSON.parse(rawLine)` result if it parsed, otherwise `null` and `parseError`.
- `stdoutTail` — string. The trailing not-newline-terminated bytes still in `stdoutBuffer` at close time (may contain a final JSON event the CLI flushed without a newline).
- `stderrTextFull` — full stderr text. (App today caps at 10 KB; harness should preserve the full stream — flagged in storage notes.)

### Optional but high-value

- `request`:
  - `model` — effective model used.
  - `reasoningEffort` — normalized effort string actually used.
  - `images` — for each input image: `{ originalDataUrlPrefix, decodedByteLength, sha256, tempPath, extension, payloadRef? }`. The decoded bytes may be too large to inline; preserve them by external payload reference when needed.
  - `messages` — for chat/parse paths, the structured message history that fed `buildPrompt`. Reconstructable from `stdin`; useful as a request-context mirror only.
  - `systemPrompt` — present if non-empty.
- `derivedFromStdout` — the synthetic objects this app's parser produces, stored for cross-reference (not as a substitute for `stdoutEvents`):
  - `fullText` — joined visible-agent-message text.
  - `fullThinking` — joined reasoning text.
  - `lastUsage` — last `usage`-typed object observed, in the normalized `{ inputTokens, outputTokens, model, rawUsage, usageComplete }` shape from `usage-extractor.js`.
  - `usageEventCount` — number of distinct usage-bearing events seen.
- `correlation` — `{ threadStartedId, turnStartedId, agentMessageItemIds[], reasoningItemIds[] }` — populated if/when the harness chooses to read those fields out of `stdoutEvents`. Optional because the parser code does not currently read them.
- `error`:
  - `kind` — `"non_zero_exit" | "timeout" | "spawn_error" | "missing_binary"`.
  - `nodeErrorCode` — e.g. `"ENOENT"`, `"ETIMEDOUT"`.
  - `stderrPreview` — the truncated 500-char preview the app uses today, kept for parity with the thrown `Error.message`.
  - `errorEventsFromStdout` — optional derived view of stdout events whose `type === "error"` or `turn.failed`. This is not a substitute for preserving the original `stdoutEvents`.
(Caller-side context such as `chatId`, `escalationId`, `imageParseRequestId`, `userId`, route name, or eventBus correlation id is **outside the provider package** and is intentionally not part of this shape. If a future record needs to link a provider package to a caller, that linkage belongs in a separate caller-side record, not inside the provider harness package.)

### Streaming notes (Codex is always streamed in this app)

For Codex, `stdoutEvents[]` is **required**, not optional. The streaming-vs-non-streaming distinction other providers face does not apply: every Codex call in this codebase passes `--json`, so the wire format is always a stream of events. Ordering matters because agent_message and reasoning items carry monotonic absolute text; the harness cannot reconstruct deltas without the events in original order.

### Storage / size notes (not policy)

- A single `stdoutEvents[]` array for a long high-effort run can contain hundreds of entries with cumulative reasoning text in the tens or hundreds of KB. Mongo's 16 MB document limit is a factual constraint; preserve large stdout/stdin values inline or by external payload reference without choosing the storage mechanism in this research doc.
- The stdin payload for image-parser calls contains the full system prompt; image bytes are written to a tempfile and **not** embedded in stdin, so stdin itself is text. Preserve the temp-image path/metadata and the image bytes or payload reference if the harness needs the full request package.
- Stderr is currently capped at 10 KB in app code (`codex.js:198`). Full package preservation requires capturing stderr before that truncation or otherwise recording that truncation occurred; the capture mechanism is out of scope for this document.

## Gaps And Questions

### Facts vs assumptions

- Everything under **"Provider IDs In This App"**, **"Current App Call Sites"**, **"Request Package Sent Today"**, **"Raw Package That Reaches This Server Today"**, and the **"Inference from current app code"** subsection of "Official Response Package" is **fact**, confirmed by reading the named source files at the named line numbers on the current `master` HEAD.
- The **"Official-doc facts"** subsection is fact-from-official-docs, confirmed via WebFetch against `developers.openai.com/codex/...` pages on the date of this research. Re-verified during the current edit: the noninteractive doc confirms `--json`, JSONL on stdout, event categories, item categories, and the usage sample. It explicitly states the **normal-mode** stdout/stderr split ("Codex streams progress to `stderr` and prints only the final agent message to `stdout`") but does **not** explicitly state stderr's contents when `--json` is enabled. The CLI reference page does not mention stderr at all. The prior version of this document implied an explicit official statement about stderr under `--json` — that has been corrected.
- The **"Proposed Mongo Storage Shape"** is a design proposal, not fact.

### Unconfirmed / could not verify

1. **Field-level JSON Schema for `codex exec --json` events.** OpenAI's public docs list event categories (`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`) and item categories but do **not** publish a formal schema with field names and types. The shapes documented under "Inference from current app code" are the shapes the running CLI emits in this project today — they may change between Codex CLI versions.
2. **Whether `usage` is delivered only on `turn.completed` or also as standalone events.** The official doc sample shows `usage` on a completed turn; the app's parser (`usage-extractor.js:108-129`) handles four distinct positions including a standalone `event.type === 'usage'`. Both code paths exist in production, so at least one was once observed, but I cannot prove which positions the current CLI version emits.
3. **Stable exit-code mapping.** No published table. The app treats `code === 0` as success and anything else as failure.
4. **Whether the CLI's auth state may include a non-subscription path** (e.g. a `codex login --api-key` mode that internally uses an API key). The docs reference both ChatGPT-account login and API-key login. From inside this app, the distinction is invisible — the app runs whatever auth state the host machine has and never touches that state. The "subscription/login-backed" framing in the research label is approximately right but the binary is doing the actual auth.
5. **Whether the host-side `$CODEX_HOME/sessions/.../rollout-*.jsonl` file is byte-for-byte identical to the `stdoutEvents` we'd capture in Mongo.** Unknown. (See non-contract issue-tracker context below for #2288.) The harness should not assume equivalence.
6. **Behavior of `--json` under MCP/tool configurations.** See non-contract issue-tracker context below (#15451). The current parser would receive non-JSON lines if this happens; `JSON.parse` failures are silently caught per line, so `fullResponse` could come back empty and `usage` `null` with `exit code 0`. There is no defense in source against this case.
7. **`command_execution`-style item event drops.** See non-contract issue-tracker context below (#10141). This app does not use Codex tool-execution features in any visible code path; if the CLI surfaces them spontaneously, the harness storage proposed above would still catch them in `stdoutEvents[]` even though the current parser ignores them.
8. **What stderr carries under `--json`.** The official docs say stderr carries progress in normal mode but do not state what stderr carries when `--json` is enabled. The app does not parse stderr as JSON regardless. The harness should preserve stderr verbatim and not depend on it being either structured or empty.
9. **Whether `messages.length === 1 && !systemPrompt` (the `buildPrompt` short-circuit at `codex.js:624-626`) is reachable through normal callers.** All current call sites prepend a system prompt, so this branch may be dead — flagged for the harness owner if it matters to recordkeeping.
10. **No automated test asserts the exact JSONL event shape.** Tests in `server/test/` reference `extractCodexUsage` but use synthetic event objects; they prove the parser handles the documented shapes, not that the CLI emits them in any particular order.

### Non-contract issue-tracker context (NOT proof of the official response package)

These are open issues in the OpenAI Codex GitHub tracker. They describe known-incomplete behavior reported by users, not official spec. Listed only so the harness owner is aware of failure modes that could show up in captured packages; none of these should be treated as authoritative about what the response package contains, and none of them add required fields to the preservation shape above.

- `https://github.com/openai/codex/issues/15451` — Reported: `--json` (and `--output-schema`) may be silently ignored under certain MCP/tool configurations, in which case stdout could carry formatted text instead of JSONL. In this app, that would mean `JSON.parse(line)` failures get swallowed, `fullResponse` may come back empty, and `usage` `null` while `exit code 0`.
- `https://github.com/openai/codex/issues/10141` — Reported: `--json` output can drop `command_execution.aggregated_output` when only deltas are streamed.
- `https://github.com/openai/codex/issues/2288` — Reported: no first-class way to dump the entire trajectory deterministically. Mentions that Codex writes per-session JSONL rollouts to `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`. This app does not consume those files; whether their content is byte-equivalent to the `--json` stdout stream captured in-process is unknown.

### Closest related code paths (in case the harness owner later wants to research the HTTP-API sibling)

- HTTP-API OpenAI path: `server/src/services/remote-api-providers.js` (search for `openai` / `requestOpenAi*` / `OPENAI_API_KEY`). This is the `openai` catalog id (`transport: "openai"`), out of scope for this document.
- Image-parser OpenAI HTTP path: `server/src/services/image-parser.js` (function names containing `OpenAi`).

## Evidence

### Repo source (read on current `master` HEAD; line numbers verified)

- `shared/ai-provider-catalog.json:60-74` — `codex` catalog entry.
- `shared/ai-provider-catalog.json:75-89, 104-118, 119-133` — `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` (`family: "codex"`, `transport: "codex"`).
- `server/src/services/codex.js:12-13` — `DEFAULT_MODEL`, `DEFAULT_REASONING_EFFORT`.
- `server/src/services/codex.js:14, 24-27` — `CODEX_ALLOWED_EFFORTS` set and normalizer.
- `server/src/services/codex.js:29-32` — chat/parse/transcribe timeout env vars.
- `server/src/services/codex.js:78-90` — `formatCliFailure` (stderr preview, missing-binary detection).
- `server/src/services/codex.js:105-240` — `chat(...)` function (spawn, args, stdin, line parsing, callbacks, close handling, cleanup).
- `server/src/services/codex.js:117-128` — exec argv assembly for chat.
- `server/src/services/codex.js:139-143` — `spawn('codex', args, { ..., shell: true, env: { ...process.env, CLAUDECODE: undefined } })`.
- `server/src/services/codex.js:171-194` — stdout line splitter and per-line dispatch.
- `server/src/services/codex.js:196-199` — 10 KB stderr cap.
- `server/src/services/codex.js:201-226` — `close` handler.
- `server/src/services/codex.js:233-239` — `cleanup` function returning `{ usage, partialResponse }`.
- `server/src/services/codex.js:242-282` — `warmUp(...)`.
- `server/src/services/codex.js:291-448` — `parseEscalation(...)`.
- `server/src/services/codex.js:464-612` — `transcribeImage(...)`.
- `server/src/services/codex.js:614-637` — `buildPrompt` (stdin payload construction).
- `server/src/services/codex.js:639-654` — `writeImageTempFiles` (image base64 -> tmpdir).
- `server/src/services/codex.js:662-695` — `extractDeltaFromEventLine` (agent_message + delta shapes).
- `server/src/services/codex.js:697-742` — `extractThinkingFromEventLine` (reasoning shapes).
- `server/src/services/codex.js:744-759` — `extractJSONObject` (best-effort fenceless JSON parse).
- `server/src/services/codex.js:780-782` — exports.
- `server/src/lib/usage-extractor.js:18-26` — Codex extra dimensions and env model fallback.
- `server/src/lib/usage-extractor.js:98-132` — `extractCodexUsage` — four supported event positions.
- `server/src/lib/usage-extractor.js:138-143` — `CODEX_PROVIDERS` set (includes `'codex'`, `'gpt-5.5'`, `'openai'`).
- `server/src/lib/usage-extractor.js:176-192` — `_buildResult` normalized output shape.
- `server/src/services/image-parser.js:69-76` — `CODEX_IMAGE_PARSER_PROVIDER_IDS` derived from `getCodexProviderIds()`.
- `server/src/services/image-parser.js:352-440` — `checkCodexCliAvailability(model)` (`codex --version`).
- `server/src/services/image-parser.js:1350-1405` — `callCodex(...)` (image parser wrapper around `codex.chat`).
- `server/src/services/image-parser.js:1596-1597` — image-parser routes Codex-family providers to `callCodex`.
- `server/src/services/image-parser.js:1754-1762` — availability response populated for every Codex provider id.
- `server/src/services/providers/catalog.js:23` — `PREFERRED_CODEX_FALLBACK = 'codex'`.
- `server/src/services/providers/catalog.js:137-139` — `getCodexProviderIds()` (family filter).
- `server/src/services/providers/registry.js:2, 44-45` — registry imports `codex` service and routes `transport: 'codex'` to it.
- `server/src/services/providers/registry.js:66-71` — Codex per-kind timeout env var lookup.
- `server/src/services/providers/registry.js:121-126` — `supportsImageInput` for transport `'codex'` via `CODEX_SUPPORTS_IMAGE_INPUT` env (default true).
- `server/src/services/providers/registry.js:145-165` — `PROVIDER_DEFS` wiring (`getChat`, `getParse`, `getTranscribe` for each Codex id).
- `server/src/services/agent-health-service.js:87, 192-193` — Codex transport treated as a CLI-binary path; health checks via `checkCli('codex')`.
- `server/src/index.js:229-237` — startup background warm-up of Codex CLI.
- `server/.env.example:35-37` — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MOONSHOT_API_KEY` present; **no** Codex-specific key — Codex relies on its ambient login state.

### Official documentation (fetched via WebFetch)

- `https://developers.openai.com/codex/cli/reference` — confirmed `--json` flag exists and emits JSONL events on stdout.
- `https://developers.openai.com/codex/noninteractive` — confirmed event-type categories (`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`), item categories (agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, plan updates), final-result signaling via `turn.completed` + `item.completed` with `type:"agent_message"`, and the usage sample `{ input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }`.
- `https://developers.openai.com/codex/cli/features` — feature catalog (used to confirm CLI scope, not field-level shapes).
- `https://github.com/openai/codex/issues/2288` — feature request for full-trajectory dump; documents existence of per-session JSONL rollouts at `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- `https://github.com/openai/codex/issues/15451` — known bug: `--json` silently ignored under some MCP/tool configurations.
- `https://github.com/openai/codex/issues/10141` — known bug: `--json` drops `command_execution.aggregated_output` when only deltas are streamed.

### Research-only files referenced

- `provider-harness-research/HANDOFF.md`
- `provider-harness-research/RESEARCH_PLAN.md`
- `provider-harness-research/openai-cli-prompt.md`
- `provider-harness-research/providers/_template.md`
- `provider-harness-research/providers/anthropic-api.md` (sibling reference, not copied)
