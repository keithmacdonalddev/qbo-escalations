# Review Report: Provider Harness v0.2 Plan

**Reviewed plan:** `provider-harness-research/plan-v0.2/v0.2.md`
**Review date:** 2026-05-20
**Review mode:** strict plan review against current files on disk
**Runtime action:** none. I did not start, stop, restart, or replace any local service.

## Verdict

The v0.2 direction is good, but the plan should be tightened before implementation.

The strongest parts are the narrow CLI-only scope, the Codex-first proof, the explicit stop-and-review gate before Claude, the default-off capture flag, and the refusal to mix parser/UI/prompt behavior into this work.

The weak parts are not the overall idea. They are implementation precision gaps that matter for subprocess capture:

- timeout, abort, cleanup, and child `close` sequencing is not specified enough to guarantee one accurate record per CLI attempt.
- `claude.parseEscalation(...)` can perform more than one subprocess call, but the plan treats it like one path.
- the fire-and-forget rule is broader than the current v0.1 HTTP implementation on disk.
- the CLI package shape does not fully align with the existing payload-store convention.
- the plan omits important correlation fields such as selected provider id, model, reasoning effort, source, and call site from the capture checklist.
- the plan does not clearly distinguish CLI stdout streaming from out-of-scope app/SSE streaming.
- `workspace-proactive.js` is an existing Claude CLI model-work spawn, but the plan does not explicitly defer it.

My recommendation: keep v0.2 as the next incremental step, but revise the plan before handing it to an implementer. Do not begin wiring Codex until the shared lifecycle/builder rules below are resolved.

## Evidence Checked

I reviewed the plan and current source directly from disk.

Important source facts:

- `ProviderCallPackage` currently has HTTP-oriented fields only and no `cli` field: `server/src/models/ProviderCallPackage.js:5-24`.
- `recordProviderCallPackage(...)` is still an async Mongo/file write path and returns a promise: `server/src/services/provider-call-package-recorder.js:212-317`.
- Existing HTTP capture helpers still await recording before resolving/rejecting provider calls:
  - `server/src/services/image-parser.js:796-805`, `849-858`, `925`, `939`, `953`
  - `server/src/services/lm-studio.js:58-67`, `115-124`, `191`, `205`, `218`
  - `server/src/services/remote-api-providers.js:118-127`, `183-192`, `259`, `275`, `293`
- Payload externalization currently attaches refs as `<fieldName>PayloadRef`, not `externalRef`: `server/src/services/provider-call-package-payload-store.js:74-80`.
- Current externalized payload refs point under `server/data/provider-call-packages/...`: `server/src/services/provider-call-package-payload-store.js:22-35`; `.gitignore:9` ignores `server/data/`.
- Codex has three model-work subprocess paths in `server/src/services/codex.js`: `chat` at `105-240`, `parseEscalation` at `291-448`, and `transcribeImage` at `464-612`. `warmUp` is separate at `242-282`.
- Claude has model-work subprocess paths in `server/src/services/claude.js`: `chat`, `parseEscalation`, `prompt`, and `transcribeImage`, plus `warmUp`.
- There is also a separate Claude CLI model-work spawn in `server/src/services/workspace-proactive.js:124-212`.
- Provider catalog ids are broader than only `codex` and `claude`: `shared/ai-provider-catalog.json:1-133` includes `claude-opus-4-8`, `codex`, `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`, all routing through CLI transports.
- Existing mocked child-process tests are available as a pattern in `server/test/provider-usage-contract.test.js:21-46`.

## What The Plan Gets Right

1. **The scope is appropriately narrow.** The plan keeps v0.2 focused on local CLI subprocess packages only. That is the right incremental move after HTTP v0.1.

2. **Codex first is the right sequence.** Codex uses one consistent `codex exec --json` shape across the main model-work paths, and `codex.transcribeImage(...)` is a good proof target because it resolves a simple `{ text, usage }` payload.

3. **The stop-and-review checkpoint is important.** The plan correctly says to inspect the first successful and failing/timeout capture before expanding to all Codex paths or touching Claude.

4. **The plan avoids the dangerous distractions.** No UI, parser validation, prompt rewrites, answer cleanup, health checks, warm-ups, key probes, dashboards, or SDK capture in this step. That is correct.

5. **The plan uses the right research/app id split at a high level.** `openai-cli` and `anthropic-cli` are research labels, while the app transports are `codex` and `claude`.

6. **Fire-and-forget is the right target behavior.** Provider calls should not wait on Mongo or file writes. This corrects the biggest current operational weakness in the v0.1 HTTP capture implementation.

## Blocking Plan Issues

These should be fixed in the plan before implementation starts.

### BLOCKING-01: Subprocess lifecycle is underspecified for timeout, abort, cleanup, and close

The plan says each CLI provider attempt gets exactly one outcome and that signal/kill facts should be preserved. That is right, but the current code paths make this non-trivial.

In Codex `transcribeImage`, timeout immediately kills the child and rejects the provider promise before the child `close` event necessarily arrives: `server/src/services/codex.js:557-563`. The `close` handler then exits early if already settled: `server/src/services/codex.js:586-588`. Codex `chat` has the same pattern, and its cleanup function sets `killed = true`, kills the process, and returns partial state without recording any final close signal: `server/src/services/codex.js:233-239`.

Claude has similar subprocess lifecycle patterns. `chat` returns a cleanup function at `server/src/services/claude.js:427-433`, and its timeout/error/close paths are separate.

Why this matters:

- If the implementation records at `finishErr(...)`, it may miss final `exitCode`/`signal` facts.
- If it records only on `close`, it may miss cleanup/abort paths because current close handlers intentionally return early after timeout or cleanup.
- If it waits for `close` before returning the provider error, it violates the plan's "provider behavior unchanged" rule.

Required plan correction:

- Define a reusable CLI attempt collector that starts before `spawn(...)`, records stdout/stderr as the child runs, and can be finalized in the background after provider behavior has already returned.
- Specify that timeout and cleanup may return to existing code immediately, but the capture collector should still listen for `close` afterward when possible and then write one final record.
- If final close data is unavailable, record that explicitly, for example `process.closed: false`, `process.signal: null`, and `timeout.fired: true`.
- Add an explicit abort/cleanup test for `codex.chat` and `claude.chat`, not only timeout tests.

### BLOCKING-02: `claude.parseEscalation(...)` can be more than one provider attempt

The plan lists `claude.parseEscalation(...)` as one model-work path, but the implementation has multiple subprocess calls depending on input type.

For image input, `claude.parseEscalation(...)` first spawns a Claude CLI transcription step, then spawns a second Claude CLI JSON parse step. The plan needs to count those as two provider attempts and therefore two `ProviderCallPackage` records.

Evidence:

- Image transcribe step spawns `claude`: `server/src/services/claude.js:517-524`.
- Image parse step B spawns `claude`: `server/src/services/claude.js:614-622`.
- Text parse path spawns once: `server/src/services/claude.js:737-745`.

Required plan correction:

- State that "one package record per provider attempt" means one record per child process, not one record per exported service function.
- Add done criteria for Claude image parse:
  - image input creates two records: `claude.parseEscalation.transcribe` and `claude.parseEscalation.parse`.
  - text input creates one record: `claude.parseEscalation.parse`.

### BLOCKING-03: Fire-and-forget scope conflicts with the current v0.1 HTTP code unless clarified

The v0.2 plan says:

```text
Production code must not do this:
await recordProviderCallPackage(...)
```

That rule is good for the intended final harness behavior. But current v0.1 HTTP production paths still await recorder calls before resolving provider results. This is visible in `image-parser.js`, `lm-studio.js`, and `remote-api-providers.js` as listed in the evidence section above.

Why this matters:

- If v0.2 means "all provider package recording must become fire-and-forget," Step 1 must include a v0.1 HTTP capture refactor and test updates.
- If v0.2 means "CLI capture only is fire-and-forget," the Done Criteria should not imply that all production capture paths are now non-blocking.
- If a future implementer changes only the low-level recorder and not the awaited HTTP helpers, the plan can appear satisfied while HTTP capture still blocks.

Required plan correction:

- Choose one:
  - **Option A:** make fire-and-forget a harness-wide v0.2 foundation change and explicitly include the existing HTTP helpers in Step 1.
  - **Option B:** say v0.2 only makes CLI capture fire-and-forget, and track HTTP fire-and-forget as a v0.1.1/v0.2.x follow-up.

My recommendation is Option A if this is meant to be a durable overhaul step. It fixes a known v0.1 weakness before adding more capture paths.

## Major Plan Issues

### MAJOR-01: "Streaming/SSE out of scope" is ambiguous because CLI chat is itself a stream

The plan excludes "streaming/SSE capture" while also planning to capture `codex.chat(...)` and `claude.chat(...)`. Those functions consume streamed stdout events from a child process:

- Codex chat reads JSONL stdout chunks and calls `onChunk` / `onThinkingChunk`: `server/src/services/codex.js:171-193`.
- Claude chat reads `stream-json` stdout lines and calls streaming callbacks: `server/src/services/claude.js:312-365`.

The plan likely means that app-level SSE and LM Studio HTTP streaming are out of scope. That is reasonable. But the plan should say that CLI stdout stream preservation is in scope as raw stdout text plus parsed views.

Recommended wording:

```text
Out of scope: app/browser SSE frame capture and LM Studio HTTP streaming capture.
In scope: local CLI stdout/stderr stream collection for Codex and Claude subprocesses.
```

### MAJOR-02: The CLI shape does not align with the existing payload-store ref convention

The plan's CLI shape uses fields like:

```js
stdout: { externalRef: null }
```

The current payload store attaches field-specific refs like `bodyTextPayloadRef`, `parsedJsonPayloadRef`, or for CLI fields it would naturally produce `textPayloadRef`, `linesPayloadRef`, `jsonlEventsPayloadRef`, etc. Evidence: `server/src/services/provider-call-package-payload-store.js:74-80`.

Why this matters:

- The implementer may create a parallel externalization convention instead of reusing the existing helper.
- Future readers may not know whether to look at `cli.stdout.externalRef` or `cli.stdout.textPayloadRef`.
- Tests may assert the wrong persisted shape.

Recommended plan correction:

- Either update the payload store to support a generic `externalRef` field for CLI subdocuments, or revise the CLI shape to use the existing `<fieldName>PayloadRef` convention.
- Be explicit that externalization of arrays like `cli.stdout.jsonlEvents` stores the whole array as JSON text and then nulls the inline field.

### MAJOR-03: Required correlation metadata is missing from the capture checklist

The plan's Step 2 capture checklist includes command/stdin/stdout/stderr/process facts, but it does not explicitly require the metadata needed to find and compare records later.

Current HTTP capture records include `providerId`, `providerResearchId`, `providerPathType`, `callSite`, `operation`, `source`, and model metadata. The CLI plan should preserve the same searchability.

Required fields for CLI attempts:

- `providerId`
- `providerResearchId`
- `providerPathType`
- `callSite`
- `operation`
- `source.file`
- `source.functionName`
- `source.helperName` or `source.spawnSite`
- `modelRequested`
- `reasoningEffort`
- selected app provider id, if known
- transport id, if different from selected provider id

Why selected provider id matters:

- The catalog includes `claude`, `claude-opus-4-8`, `codex`, `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`: `shared/ai-provider-catalog.json:1-133`.
- Registry routing maps `transport: "codex"` to the Codex service and `transport: "claude"` to the Claude service: `server/src/services/providers/registry.js:40-58`.
- If every record is only `providerId: "codex"` or `providerId: "claude"`, the harness can lose which catalog option or model-specific provider initiated the call.

Minimum acceptable compromise:

- Use `providerId: "codex"` / `"claude"` for transport-level grouping.
- Add `source.selectedProviderId` or `source.catalogProviderId` when a caller can provide it.
- Always record `modelRequested` and `reasoningEffort`.

### MAJOR-04: Existing `workspace-proactive.js` Claude CLI model work is omitted without an explicit deferral

The plan says v0.2 captures local CLI model calls, then lists Claude service methods only. Current source has another Claude CLI model-work subprocess:

- `server/src/services/workspace-proactive.js:124-212`
- It builds a prompt, runs `claude -p --output-format text --max-turns 1 --effort low`, writes stdin, reads stdout/stderr, and parses the returned text.

This may be reasonable to defer because it is not part of the core provider registry flow. But the plan should explicitly say so. Otherwise "CLI provider calls" sounds broader than the actual file scope.

Recommended correction:

```text
Deferred from v0.2: workspace-proactive Claude CLI subprocess capture.
Reason: separate proactive-monitoring path outside the provider registry. Add as v0.2.x after core claude.js paths are stable.
```

### MAJOR-05: The plan does not require mocked child-process tests

The test requirements are good conceptually, but they should state that server tests must not invoke real `codex` or `claude` binaries.

There is already a local pattern for mocked child process tests in `server/test/provider-usage-contract.test.js:21-46`. Use that pattern or a shared fake-child helper.

Required correction:

- Add "All CLI capture tests must mock `child_process.spawn`; no test should require a real Codex/Claude CLI install or live account."
- Include tests for stdin write capture, stdout chunk order, stderr truncation/full capture policy, close code, signal, spawn error, timeout, cleanup abort, and recorder failure.

### MAJOR-06: The test matrix is Codex-heavy and too thin for Claude output modes

The plan has a "Successful Codex JSONL" test, but Claude has several output modes:

- `chat`: `stream-json`
- `parseEscalation`: `json` with schema
- `prompt`: `text`
- `transcribeImage`: `text`

The plan correctly warns not to force Claude into Codex JSONL assumptions, but the tests should prove that.

Add these tests after Step 5:

- Claude chat preserves raw stream-json lines and parsed event objects.
- Claude prompt preserves plain text stdout without marking it `invalid_jsonl`.
- Claude transcribe preserves plain text stdout.
- Claude parse image input creates two records.
- Claude parse text input creates one record.

### MAJOR-07: CLI redaction needs more precise rules and tests

The current redaction helper is HTTP-shaped. It redacts HTTP headers, raw headers, JSON request/response bodies, and error objects. It does not yet know about:

- `cli.args`
- `cli.cwd`
- `cli.env`
- `cli.stdin.text`
- `cli.stdout.text`
- `cli.stdout.jsonlEvents`
- `cli.stderr.text`

The plan says to add CLI redaction coverage, which is correct. It should be more explicit because this capture will store prompt text and local filesystem paths.

Required tests:

- stdin containing `OPENAI_API_KEY=...` or `ANTHROPIC_API_KEY=...` is redacted.
- args containing a token-looking value are redacted.
- temp image paths are redacted or normalized.
- home directory paths are redacted.
- stdout/stderr containing bearer/API-key-looking text is redacted.
- parsed JSONL events are redacted consistently with raw stdout text.

Important privacy note:

The plan intentionally preserves stdin/prompt text. That means records may contain customer escalation content. The plan should say this plainly so nobody mistakes "secret redaction" for "PII/customer-data redaction." Default-off capture and ignored local storage reduce risk, but they do not remove it.

### MAJOR-08: Spawn options are part of the provider package but not represented

For Windows, `shell: true` is not incidental. Both Codex and Claude use it so `.cmd` shims resolve. The environment overrides are also important:

- Codex clears `CLAUDECODE`: `server/src/services/codex.js:139-143`, `353-357`, `520-524`.
- Claude uses isolated cwd/env overrides: `server/src/services/claude.js` and `workspace-proactive.js:151-160`.

The `cli` package should include a small, redacted spawn-options block:

```js
spawnOptions: {
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: { value: null, redacted: true },
  envOverrides: {
    CLAUDECODE: '[unset]',
    CLAUDE_PROJECT_DIR: '[redacted or empty]',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
  }
}
```

Do not store the full inherited environment.

### MAJOR-09: Harness stub mode is not mentioned

Provider functions return stubs before spawning when `HARNESS_PROVIDERS_STUBBED=1`. Evidence:

- `server/src/lib/harness-provider-gate.js:5-7`
- Codex checks stubs at the top of `chat`, `parseEscalation`, and `transcribeImage`: `server/src/services/codex.js:105-109`, `291-295`, `464-468`
- Claude does the same for its service functions.

The plan should say what happens in stubbed mode. Recommended behavior:

- No CLI package record should be written because no CLI provider attempt occurred.
- Tests should assert capture-enabled plus provider-stubbed mode does not create a fake CLI record unless a test intentionally invokes the builder directly.

## Minor Plan Issues

1. **`providerPathType` should probably be `cli-subprocess`, not mixed with current trace value `cli`.** The plan chooses `cli-subprocess`, which is good. The existing image-parser trace uses `providerPathType: "cli"` for Codex call tracing at `server/src/services/image-parser.js:1755-1763`. Make sure the persisted record uses the plan value consistently.

2. **`invalid_jsonl` should be scoped to JSONL paths only.** Codex paths expect JSONL. Claude text/json paths should not be classified as invalid JSONL just because stdout is plain text.

3. **`stdout.lines` needs a duplication rule.** Decide whether `stdout.lines` includes the trailing final buffer or whether `stdout.finalBuffer` is stored separately. Avoid storing the same trailing text twice for large outputs.

4. **`stderr` truncation policy should be explicit.** Current services cap some stderr buffers at 10 KB, but not all paths do it consistently. The plan says preserve stderr text; decide whether CLI capture preserves full stderr subject to externalization or keeps the current cap.

5. **`pid` may be sensitive/noisy.** It is useful for debugging but not stable. Keep it if useful, but do not index it.

6. **The plan should require line-order tests.** It says line order is preserved for Codex; add the same assertion for Claude stream-json.

7. **The review gate should name actual artifacts.** "Inspect one capture record" is good but vague. Require checking a Mongo document and any `server/data/provider-call-packages/...` sidecar created by externalization.

8. **The worktree is currently dirty.** Current `git status --short` shows modified production files and untracked provider-harness docs. The plan's "no unrelated files edited" gate should start with a fresh `git status --short` snapshot before implementation.

## Recommended Plan Edits Before Implementation

I would add this section to `v0.2.md` before coding:

```text
Lifecycle rule:
One ProviderCallPackage record is written per child process attempt. A service
function may create multiple child attempts. The capture collector starts before
spawn, observes stdout/stderr/error/timeout/cleanup/close, returns provider
behavior exactly as before, and finalizes the record in the background. Timeout
and cleanup may return before child close, but the collector should still record
close code/signal later when available.

Fire-and-forget scope:
v0.2 either upgrades all existing HTTP and new CLI capture paths to non-blocking
recording, or it explicitly limits non-blocking behavior to CLI and tracks HTTP
non-blocking as a separate follow-up. The chosen scope must be reflected in done
criteria and tests.

CLI metadata:
Every CLI record must include providerId, providerResearchId, providerPathType,
callSite, operation, source, modelRequested, reasoningEffort, command, args,
spawn options, stdin, stdout, stderr, timing, outcome, error, redaction, and
storage facts.

Deferred CLI paths:
workspace-proactive.js Claude CLI capture is intentionally deferred from v0.2
unless it is explicitly added to allowed file scope.

Tests:
All CLI tests must mock child_process.spawn and must not invoke real local
Codex/Claude binaries.
```

## Revised Acceptance Criteria

Use these instead of the current Done Criteria:

1. `ProviderCallPackage` supports `cli` without changing existing HTTP record reads.
2. CLI package builder can build success, spawn error, process error, timeout, abort, and invalid JSONL packages without a real child process.
3. CLI redaction covers args, cwd, env metadata, stdin, stdout, parsed stdout events, stderr, and error objects.
4. CLI externalization uses the same payload-store convention as existing HTTP packages, or a clearly documented new convention with tests.
5. Recording is non-blocking for the chosen v0.2 scope, with a test-only settled hook.
6. Capture disabled writes no records and preserves provider behavior.
7. Stubbed provider mode writes no CLI records because no child process is spawned.
8. Codex `transcribeImage` proof creates one record and returns the exact same `{ text, usage }` shape as before.
9. Codex timeout and spawn-error proof paths create records without changing thrown/callback error behavior.
10. Codex `parseEscalation` and `chat` create one record per child process attempt after the proof passes.
11. Chat cleanup/abort creates an `aborted` record or an explicitly documented no-record decision. I recommend recording it as `aborted`.
12. Claude text/json/stream-json output modes are all tested after Codex is stable.
13. Claude image `parseEscalation` creates two records, one for transcription and one for parse.
14. Warm-ups, health checks, key probes, model discovery, SDK, app SSE, LM Studio streaming, UI, prompt, parser, fallback, and answer-cleanup code remain untouched.
15. The implementation branch contains no unrelated UI or temp-review edits.

## Final Recommendation

Proceed with v0.2 only after the plan is revised around lifecycle finalization and per-attempt semantics.

The plan is directionally strong and appropriately incremental. It is not implementation-ready as written because subprocess capture is easy to get "mostly working" while silently losing the exact facts the harness is supposed to preserve. The fix is not to expand scope. The fix is to make the narrow scope more exact.
