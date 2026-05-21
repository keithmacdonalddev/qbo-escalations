# CTO Production Gate Review — Provider Harness v0.2 (CLI capture, Codex first proof)

**Date:** 2026-05-20 19:26
**Plan:** `C:\Projects\qbo-escalations\provider-harness-research\plan-v0.2\v0.2.md`
**Branch:** `master` @ head `7dea3d8`
**Review covers:** Step 1 (shared CLI foundation) + Step 2 (Codex `transcribeImage` proof). Steps 3 (Stop and review — this report IS that stop and review), Step 4 (`codex.parseEscalation` + `codex.chat`), and Step 5 (Claude) are explicitly deferred per the plan and not in scope for this review.

---

## 1. Summary

| Field | Value |
| --- | --- |
| **Gate Decision** | **PASS** |
| **Overall score** | **8/10** |
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 2 |
| Intent gate | PASS (does not exceed user intent in two specific places — see section 6) |

The work is a textbook execution of Step 1 + Step 2 of the plan. The shared CLI capture foundation is in place, Codex `transcribeImage` is wired as the first proof, capture is invisible when disabled, capture is fire-and-forget when enabled, and the tests prove the three load-bearing properties (capture-disabled silence, persisted package shape, non-blocking Mongo write). No Criticals, no Highs.

The Medium findings cluster around one real issue: on `timeout` or `process_error` paths the implementation queues the capture record *before* the child's `close` event fires, so `exitCode`, `signal`, `stdoutFinalBuffer`, and the final-line JSONL event never make it into the record on those paths. This is the exact lifecycle hole that two prior plan reviews (BLOCKING-01 / Finding #2 in both) warned about. The plan's text was not updated to specify a deferred-finalize collector, and the implementation took the simple "queue at provider-return" path instead.

This is shippable. None of the Medium findings break the Codex proof or the existing parser/UI behavior. They affect *what is in the capture record on failure paths*, not whether capture works. Recommend addressing all four Mediums before Step 4 (`codex.parseEscalation` + `codex.chat`) is wired, because the same lifecycle pattern will be duplicated 5 more times across Codex+Claude if it isn't generalized now.

**Next step:** Address Medium findings, then proceed to Step 4 with the same lifecycle pattern fixed once at the foundation level.

---

## 2. Scope

### Files reviewed (working tree, including staged + unstaged)

| File | Role | Status |
| --- | --- | --- |
| `server/src/models/ProviderCallPackage.js` | Model | Modified (+1 line: `cli` field) |
| `server/src/services/provider-call-package-recorder.js` | Service (foundation) | Modified (+313 lines: CLI builder, classifier, recorder, background queue, test hook) |
| `server/src/services/provider-call-package-redaction.js` | Service (foundation) | Modified (+171 lines: CLI text/args/stdout/stderr/chunks/jsonl redaction) |
| `server/src/services/provider-call-package-payload-store.js` | Service (foundation) | Modified (+32 lines: CLI stdout/stderr chunk externalization) |
| `server/src/services/codex.js` | Service (proof site) | Modified (+312 lines: capture wiring around `transcribeImage`) |
| `server/test/provider-call-package-cli.test.js` | Test (new) | Untracked (8 tests covering build/redact/persist/wire/disabled/non-blocking) |
| `provider-harness-research/plan-v0.2/v0.2.md` | Plan | Modified (literal `cli-subprocess` → `cli`, addressing prior plan review finding #5) |

### Plan files

Two prior plan-only reviews exist on disk under `provider-harness-research/plan-v0.2/REVIEW-planv-vo.2/` (committed in `7dea3d8`, and re-staged as an untracked copy in the working tree alongside a deletion of the old `provider-harness-research/REVIEW-planv-vo.2/` directory). Those reviews were *plan reviews*, not implementation reviews. This is the first implementation review of v0.2 Step 1 + Step 2.

### Out of scope for this review

- `server/src/services/claude.js` — Step 5, untouched. Correct per plan order.
- `codex.parseEscalation`, `codex.chat`, `codex.warmUp` — Step 4 / out of scope. Untouched. Correct per plan order.
- `server/src/services/workspace-proactive.js` — separate Claude CLI spawn the prior plan review flagged. Untouched. Correct (plan defers it).
- v0.1 HTTP recorder paths (`image-parser.js`, `lm-studio.js`, `remote-api-providers.js`) still `await` the recorder. The plan's Recorder Policy section literally says `Production code should do this: void recordProviderCallPackage(...)` (lines 232-254) but the implementer chose the narrower scope (CLI-only fire-and-forget). The prior plan reviews flagged this as a scope ambiguity that needed resolution. See finding M4 below — keeping the call out as a Medium because it leaves a written plan rule visibly unsatisfied.

### Files outside the plan's "Allowed File Scope" that were edited

None. All edits are inside the plan's allowed file scope.

### Unplanned file candidates

None. Every modified file is either named in the plan's `Allowed File Scope` or is a focused server test (allowed by "focused server tests" line 741).

---

## 3. Plan Fidelity

| Plan item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Add `cli` field to `ProviderCallPackage` | Implemented | `server/src/models/ProviderCallPackage.js:19` | Mixed type, default null. Correct. |
| CLI package builder | Implemented | `server/src/services/provider-call-package-recorder.js:155-264` (`buildCliProviderCallPackage`) | Produces full plan shape: command, args, env, stdin/stdout/stderr text+lines+events+malformed+finalBuffer+chunks, process facts, timeout. Adds `modelRequested`/`reasoningEffort`/`source` (prior plan review MAJOR-03 satisfied). |
| CLI redaction coverage | Implemented | `server/src/services/provider-call-package-redaction.js:303-400` | Redacts args, stdin.text, stdout.text/lines/finalBuffer/jsonlEvents/chunks, stderr.text/chunks. Plain-text secret patterns (Bearer, `*_API_KEY=…`, `sk-…`). |
| CLI payload externalization | Implemented | `server/src/services/provider-call-package-payload-store.js:182-210`; recorder hook at `provider-call-package-recorder.js:544-567` | Externalizes `cli.stdin.text`, `cli.stdout.text/lines/jsonlEvents/malformedLines/finalBuffer`, `cli.stderr.text`, plus stdout/stderr chunks when total or any chunk exceeds 512 KB. |
| Fire-and-forget recorder behavior | Implemented (for CLI) | `provider-call-package-recorder.js:638-660` (`recordCliProviderCallPackageInBackground`) | Wraps recorder in `Promise.resolve().then(...)`. Used by Codex at `codex.js:611`. HTTP path still awaits — see finding M4. |
| Test-only recorder-settled hook | Implemented | `provider-call-package-recorder.js:662-669` (`__waitForProviderPackageRecorderSettled`) | Tracks in-flight Promises in module-level `Set`, resolves when all settled. Used by tests at `provider-call-package-cli.test.js:106,271,305,339`. |
| Colored happy-path trace stages via `providerHarnessTrace(...)` | Implemented | `codex.js:541-868` (22 trace stages); `provider-call-package-recorder.js:391-484` (recorder lifecycle stages); `provider-call-package-redaction.js:235-425`; `provider-call-package-payload-store.js:110-298` | All required v0.2 trace stages present. See plan lines 326-353 cross-checked below. |
| Wire `codex.transcribeImage` first proof | Implemented | `codex.js:469-872` | One queue per provider attempt, providerId `codex`, providerResearchId `openai-cli`, providerPathType `cli`. |
| `provider behavior unchanged` (capture disabled) | Implemented | `codex.js:594` (`if (!captureEnabled || cliCaptureQueued) return`) — short-circuits when capture flag is off. Test `provider-call-package-cli.test.js:292-308` proves zero records and identical text output when disabled. | Verified. |
| `provider behavior unchanged` (capture enabled) | Implemented | Test `provider-call-package-cli.test.js:310-344` proves provider Promise resolves before `ProviderCallPackage.create` is even called (uses delayedCreate gate). | Verified. |
| Recorder failures must not fail the provider call | Implemented | Recorder catches in `provider-call-package-recorder.js:477-496`; background wrapper at `:646-654` also catches. | Verified by code reading. No dedicated test for "Mongo throws" — see finding L2. |
| One package record per provider attempt for `transcribeImage` | Implemented | `cliCaptureQueued` flag at `codex.js:583,594` ensures the queue function is idempotent. | Verified. |
| Outcome decision tree (Outcome Rules lines 516-540) | Implemented | `classifyCliOutcome` at `provider-call-package-recorder.js:136-153` | Order matches plan: spawn_error → aborted → timeout → process_error (error event) → process_error (exit≠0) → invalid_jsonl → success. Verified by `provider-call-package-cli.test.js:151-178`. |
| `captureVersion: provider-harness-cli-v0.2` | Implemented | `provider-call-package-recorder.js:12,183`; verified by `provider-call-package-cli.test.js:134,229`. | Prior plan review finding #4 (captureVersion seam) resolved. |
| `providerPathType: cli` | Implemented | `codex.js:529`; plan literal updated from `cli-subprocess` to `cli` in `v0.2.md:407,617`. | Prior plan review finding #5 resolved. |
| Required v0.2 trace stages (plan lines 326-353) | Implemented (all 22 named stages emit) | Cross-check: `codex.cli.transcribeImage.enter`, `.spawn.start`, `.spawn.done`, `.stdin.write.start`, `.stdin.write.done`, `.stdout.data`, `.stdout.jsonl_event`, `.stdout.malformed_line`, `.stdout.final_jsonl_event`, `.stdout.final_malformed_line`, `.stderr.data`, `.close`, `.package.assembled`, `.recorder.queued`, `.provider.returned`, `.timeout`, `.process.error`. Recorder envelope/redaction/payload-store/Mongo stages emit from the shared helper. | Verified line-by-line. |
| Step 4 (`codex.parseEscalation`, `codex.chat`) | **Deferred** by plan (Step 3 stop-and-review must pass first) | Not in code | Correct. Out of scope for this review. |
| Step 5 (Claude paths) | **Deferred** by plan | Not in code | Correct. Out of scope. |
| Tests group 1 (capture disabled, no record, behavior unchanged) | Implemented | `provider-call-package-cli.test.js:292-308` | |
| Tests group 2 (fire-and-forget, settled hook) | Implemented | `provider-call-package-cli.test.js:310-344` (delayed Mongo proves non-blocking) | |
| Tests group 3 (successful Codex JSONL, raw text, line order, parsed events, stderr, outcome=success) | Implemented | `provider-call-package-cli.test.js:235-290` | |
| Tests group 4 (non-JSON stdout line preserved as malformed) | **Missing as standalone test** — covered indirectly by build/classifier tests, not by a wired-Codex test that emits a malformed stdout line | See finding L1 | |
| Tests group 5 (nonzero exit preserved, stderr preserved, outcome=process_error) | **Partial** — `provider-call-package-cli.test.js:167-171` covers classifier; no wired-Codex test for the spawn-and-exit-nonzero path | See finding L1 | |
| Tests group 6 (timeout) | **Partial** — classifier tested at `:161-165`; no wired-Codex test that exercises the actual setTimeout path | See finding M1 / L1 | |
| Tests group 7 (spawn error) | **Missing** — no test that emits `child.on('error', ...)` for the wired Codex path | See finding L1 | |
| Tests group 8 (recorder failure does not fail provider) | **Missing as standalone test** — the recorder catches its own errors but no test confirms provider resolves normally when `ProviderCallPackage.create` throws | See finding L2 | |
| Tests group 9 (happy-path trace stages emit with metadata only) | **Missing** — no test asserts on trace output | Trace utility itself sanitizes per-key in `provider-harness-trace.js`, but no v0.2 test runs with `PROVIDER_HARNESS_CONSOLE_TRACE=true` and checks output | See finding M3 / L1 |
| Done Criterion: CLI stdout/stderr/exit/timeout/error facts preserved | **Partial** — success path preserves all facts. Timeout path captures `outcome: 'timeout'` but loses `exitCode`, `signal`, and `stdoutFinalBuffer` parsing because `queueCliCapture` runs before `child.on('close')` fires. | See finding M1 | |
| Done Criterion: Parser behavior unchanged | Implemented | `extractDeltaFromEventLine`, `extractJSONObject` unchanged. New code only *observes* via `handleStdoutLine` and `stdoutFinalBuffer` parsing in the close handler; nothing changes what `finishOk` returns. | Verified. |

---

## 4. Cross-Boundary Data Flow Trace

I traced the primary path: HTTP route → codex service → spawn(child) → stdout stream → CLI envelope build → redaction → payload store → Mongo. This is the load-bearing path the proof is built on.

**Step 1 — caller invokes `codex.transcribeImage(imageInput, options)`**

- Stub gate at `codex.js:470-474`: if `HARNESS_PROVIDERS_STUBBED=1`, returns immediately. No CLI spawn, no capture. (Resolves prior plan review finding #12.)
- `captureEnabled = isProviderCallPackageCaptureEnabled()` snapshotted once at function entry (`codex.js:524`). This is important — the flag is checked at provider entry time, not at queue time. Re-checking would be a race against env var changes during request.

**Step 2 — spawn**

- `child = spawn('codex', args, { shell: true, env: { ...process.env, CLAUDECODE: undefined } })` at `codex.js:563`.
- `captureContext` snapshotted with `providerId: 'codex'`, `providerResearchId: 'openai-cli'`, `providerPathType: 'cli'`, `callSite: 'codex:transcribeImage'`, `operation: 'image-transcribe'`, `source: { file, functionName, spawnSite }`.

**Step 3 — stdout stream**

- `child.stdout.on('data', ...)` at `codex.js:766-785` appends each chunk to `stdoutText`, `stdoutChunks`, and the splitting buffer.
- Each complete line goes through `handleStdoutLine` at `codex.js:701-727`:
  - Pushed to `stdoutLines`.
  - Parsed via `JSON.parse(line)`. On success → `stdoutJsonlEvents.push(event)` + `extractCodexUsage` for `capturedUsage`.
  - On parse failure → `malformedStdoutLines.push(line)`. **Plan-mandated "JSONL parse failure is not parser failure, it's provider package evidence" honored** (`v0.2.md:486`).
  - `extractDeltaFromEventLine(line, …)` extracts user-visible text into `fullResponse`. Existing parser behavior unchanged.

**Step 4 — close (happy path)**

- `child.on('close', code, signal)` at `codex.js:802-858`:
  - Sets `stdoutFinalBuffer = stdoutBuffer` (the trailing non-newline-terminated bytes).
  - Tries `JSON.parse(stdoutFinalBuffer)` → pushes to `stdoutJsonlEvents` or `malformedStdoutLines` accordingly.
  - `extractDeltaFromEventLine` runs on the tail, appended to `fullResponse`.
  - If `code === 0` → `finishOk(fullResponse, { outcome: 'success', exitCode: code, signal, closed: true })`.
  - Else → `finishErr(formatCliFailure(...), { outcome: 'process_error', exitCode: code, signal, closed: true })`.

**Step 5 — provider Promise resolves, then capture is queued**

- `finishOk` at `codex.js:666-680`: sets `settled = true`, cleans up temp files, **then calls `resolve(result)` and only then calls `queueCliCapture(meta)`**. Order is correct: caller's `.then` continuation lands in the microtask queue before `recordCliProviderCallPackageInBackground` enqueues *its* microtask (because `queueCliCapture` itself calls `Promise.resolve().then(...)` at recorder.js:645).
- `queueCliCapture` at `codex.js:593-664`:
  - Idempotent via `cliCaptureQueued` flag.
  - If `!captureEnabled`, returns silently. No Mongo, no trace.
  - Snapshots `responseCompletedAt`, `durationMs`.
  - Calls `recordCliProviderCallPackageInBackground({ captureContext, command, args, spawnOptions, env, stdinText, stdoutText, stdoutLines, stdoutJsonlEvents, malformedStdoutLines, stdoutFinalBuffer, stdoutChunks, stderrText, stderrChunks, pid, exitCode, signal, spawned, closed, killed, killSignal, timeout, requestStartedAt, stdinWrittenAt, firstStdoutAt, firstStderrAt, processClosedAt, responseCompletedAt, durationMs, error, outcome, modelRequested, reasoningEffort, expectsJsonl: true }, { log: true })`.

**Step 6 — recorder envelope build → redact → externalize → Mongo**

- `recordCliProviderCallPackageInBackground` at `recorder.js:638-660`: wraps in `Promise.resolve().then(() => recordCliProviderCallPackage(input, options))`. Tracks the promise in `inFlightBackgroundRecords` so the test hook can wait.
- `recordCliProviderCallPackage` at `recorder.js:569-618`:
  - Builds envelope via `buildCliProviderCallPackage(input)`.
  - `classifyCliOutcome` runs inside the builder. For success path: `error=null`, `exitCode=0`, `stdoutJsonlEvents.length > 0`, `expectsJsonl=true` → returns `success`.
  - Calls `recordProviderCallPackage(envelope, cliPayloadOptions(options))`.
- `recordProviderCallPackage` at `recorder.js:390-497`:
  - Capture-flag and Mongo-readyState gates.
  - Mints `_id`.
  - `redactProviderCallPackage(envelope)` → produces redacted clone with `redacted.cli.stdin.text`, `redacted.cli.stdout.text/lines/jsonlEvents/chunks/finalBuffer`, `redacted.cli.stderr.text/chunks` filtered through `redactCliText`/`redactBodySecrets`.
  - `externalizeProviderCallPackagePayloads(redacted, …)` with `fields: ['cli.stdin.text', 'cli.stdout.text', 'cli.stdout.lines', 'cli.stdout.jsonlEvents', 'cli.stdout.malformedLines', 'cli.stdout.finalBuffer', 'cli.stderr.text']`. For each field, if `byteLength > 512 KB`, writes to `server/data/provider-call-packages/<date>/<id>/<field>.txt`, replaces inline value with `null`, attaches `<fieldName>PayloadRef`.
  - `cli.stdout.chunks` and `cli.stderr.chunks` are externalized per-chunk by `externalizeCliTextChunks` when total or any individual chunk exceeds the threshold.
  - `ProviderCallPackage.create(prepared)` → Mongo insert.
- Background promise resolves with `{ ok: true, id }` (or `{ ok: false, error }` on failure). Caller of `transcribeImage` never sees this; tests use `__waitForProviderPackageRecorderSettled()` to wait.

**Contract verification at each boundary:**

- `transcribeImage` → recorder builder: producer passes flat input shape; builder accepts both flat (input.providerId) and nested (`input.captureContext.providerId`) keys. Verified at `recorder.js:155-264`.
- Builder → redactor: redactor reads `envelope.cli.*` paths defensively (`envelope.cli && typeof envelope.cli === 'object'`), every nested access guarded. Verified at `redaction.js:303-400`.
- Redactor → payload store: payload store reads `envelope.cli?.[streamName]?.chunks`, externalizes by `field` paths matching the flat dotted strings in `fields`. The dotted-path traversal in `readPath`/`writePath` at `payload-store.js:55-72` correctly handles `cli.stdout.text` etc.
- Payload store → Mongo: `ProviderCallPackage.create` with Mixed `cli` field. No enum constraint on outcome. Indexes on `providerId`, `callSite`, `outcome`, `createdAt`. Verified at `models/ProviderCallPackage.js:5-34`.

**Cross-path divergence — timeout / process_error / spawn_error:**

I traced the timeout path because it's the most complex. From `codex.js:748-764`:

1. Timeout fires → `child.kill('SIGTERM')` → calls `finishErr(timeoutErr, { outcome: 'timeout', timeoutFired: true, killed: true, killSignal: 'SIGTERM' })`.
2. `finishErr` sets `settled = true` and calls `queueCliCapture({ outcome: 'timeout', timeoutFired: true, killed: true, killSignal: 'SIGTERM', error })`.
3. **At this moment, `child.on('close')` has NOT fired.** The child process is killed but the close event is asynchronous.
4. `queueCliCapture` reads `stdoutFinalBuffer` (still empty string — only set inside close handler at `codex.js:805`), `exitCode` (not in meta → null), `signal` (not in meta → null), `closed: false`.
5. Capture queued and persists with these null/empty values.
6. Later, `child.on('close', code, signal)` fires. The handler hits `if (settled) return` at `codex.js:804` and exits **without parsing the final stdout buffer, without updating `stdoutJsonlEvents`, without invoking the recorder again** (idempotency flag also blocks a second queue).

**Result:** On timeout, the persisted record loses (a) the final JSONL event from `stdoutFinalBuffer`, (b) the actual `exitCode` and `signal` emitted by the killed child, (c) the `processClosedAt` timestamp. The plan calls these out explicitly as required v0.2 capture data ("signal/kill facts are preserved when available" in test group 6, lines 717-719). This is finding **M1** below.

Spawn error path (M2): `child.on('error', ...)` at `codex.js:860` calls `finishErr(err, { outcome: 'process_error' })`. The plan's outcome decision tree says spawn errors should map to `spawn_error`, not `process_error`. The classifier at `recorder.js:140-141` does check for `code === 'ENOENT'` or `code === 'SPAWN_ERROR'` and reclassifies to `spawn_error`, so when `err.code === 'ENOENT'` (typical missing binary), the classifier will downgrade to `spawn_error` after the fact. But the explicit `outcome: 'process_error'` in `meta` is passed first, and `classifyCliOutcome` returns `input.outcome` if set (`recorder.js:137: if (input.outcome) return input.outcome`). So the explicit `process_error` wins and the spawn-error case is mis-classified. This is finding **M2**.

---

## 5. Findings by framework section

### State consistency and data flow correctness

**Finding M1: timeout / process_error paths lose close-time facts**
**Severity:** Medium
**File:** `server/src/services/codex.js:748-764` (timeout handler) and `:802-858` (close handler)
**Issue:** When the timeout handler runs, it calls `finishErr` which calls `queueCliCapture` immediately, then `child.on('close')` fires later and short-circuits at `if (settled) return` on line 804. The capture record persists with `exitCode: null`, `signal: null`, `closed: false`, `stdoutFinalBuffer: ''`, and the final JSONL event in the trailing buffer is never parsed into `stdoutJsonlEvents`. Same hole exists on `child.on('error', ...)` at line 860 (process_error path can lose close-time facts if close happens to fire after error).
**Reproduction:** Mock spawn → emit two valid JSONL lines via `child.stdout.emit('data', ...)`, leave a third partial JSON in the buffer without a trailing newline. Trigger timeout by setting `timeoutMs: 10`. After `__waitForProviderPackageRecorderSettled()`, the persisted record has `cli.process.exitCode === null` and `cli.stdout.finalBuffer === ''`, even though the actual child would have emitted exitCode=null+signal='SIGTERM' on close.
**Fix:** Decouple the capture lifecycle from the provider-resolve lifecycle. Concrete approach:

```js
// Inside transcribeImage Promise body, replace the timeout handler:
const timeout = setTimeout(() => {
  if (settled) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  // Resolve provider IMMEDIATELY with the timeout error.
  const timeoutErr = new Error('Codex CLI transcription timed out after ' + timeoutMs + 'ms');
  timeoutErr.code = 'TIMEOUT';
  finishErr(timeoutErr, { outcome: 'timeout', timeoutFired: true, killed: true, killSignal: 'SIGTERM' });
}, timeoutMs);

// Then, change finishErr/finishOk to NOT call queueCliCapture directly.
// Instead, hook queueCliCapture into child.on('close') unconditionally, so close-time
// facts are always captured, even after provider returned:
child.on('close', (code, signal) => {
  clearTimeout(timeout);
  stdoutFinalBuffer = stdoutBuffer;
  // ... existing finalBuffer parse and tailDelta logic stays ...
  if (!settled) {
    // Pre-timeout normal completion path
    if (code !== 0 && !fullResponse.trim()) {
      finishErr(new Error(formatCliFailure(code, stderrOutput)), { outcome: 'process_error', exitCode: code, signal, closed: true });
    } else {
      finishOk(fullResponse, { outcome: code === 0 ? 'success' : 'process_error', exitCode: code, signal, closed: true });
    }
    return;
  }
  // Post-timeout / post-error: provider already resolved.
  // Now we know real exitCode/signal — re-snapshot meta and queue the capture WITH close facts.
  queueCliCaptureWithCloseFacts({ exitCode: code, signal, closed: true });
});
```

The cleanest version generalizes into a CLI lifecycle helper that both Codex and Claude will reuse, since `codex.parseEscalation`, `codex.chat`, `claude.parseEscalation` (×2 spawns), `claude.chat`, `claude.transcribeImage`, `claude.prompt` will all need it. Fixing it once at the foundation level (a `cliAttemptCollector`) before Step 4 will eliminate the duplicate work.

---

**Finding M2: spawn-error path is classified as `process_error` instead of `spawn_error`**
**Severity:** Medium
**File:** `server/src/services/codex.js:860-870`
**Issue:** When `child.on('error', ...)` fires (typical case: missing `codex` binary, ENOENT on spawn), the handler calls `finishErr(err, { outcome: 'process_error' })`. The plan's Outcome Rules step 1 mandates `spawn_error` for unspawnable children. The classifier at `recorder.js:137` short-circuits with `if (input.outcome) return input.outcome`, so the explicit `'process_error'` is honored verbatim and `spawn_error` is never selected even though `err.code === 'ENOENT'`.
**Reproduction:** Spawn a non-existent binary (or mock `child.on('error')` to emit `Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })`). Observe the persisted record: `outcome === 'process_error'`, but `cli.process.spawned === true` (default `input.spawned !== false`) and `cli.error.code === 'ENOENT'`. Three inconsistencies for a downstream consumer: outcome says process error, spawned says yes, error code says ENOENT (spawn failure).
**Fix:** In the error handler, classify the error before passing the outcome:

```js
child.on('error', (err) => {
  clearTimeout(timeout);
  providerHarnessTrace('codex.cli.transcribeImage.process.error', { /* ... */ });
  const code = String(err?.code || '').toUpperCase();
  const isSpawnFailure = code === 'ENOENT' || code === 'SPAWN_ERROR' || /spawn .* (ENOENT|EACCES)/i.test(err?.message || '');
  finishErr(err, {
    outcome: isSpawnFailure ? 'spawn_error' : 'process_error',
    spawned: !isSpawnFailure,
  });
});
```

Also pass `spawned: false` through to the builder so `cli.process.spawned` reads accurately.

---

### Intent fidelity

**Finding M3: trace-stage test coverage missing (plan-required test group 9)**
**Severity:** Medium
**File:** `server/test/provider-call-package-cli.test.js`
**Issue:** Plan test group 9 (`v0.2.md:724-728`) requires a test that proves "with `PROVIDER_HARNESS_CONSOLE_TRACE=true`, the Codex proof emits the required colored provider-harness stages" *and* "trace output contains metadata/counts only, not raw prompt, image, stdout, or stderr text" *and* "with trace disabled, provider behavior and captured Mongo records are unchanged." None of these are tested. The trace sanitizer in `provider-harness-trace.js:46-91` handles sanitization correctly, but it's never validated end-to-end through the Codex wiring with a live env-var flip.
**Reproduction:** Trace privacy is a hard plan rule (Trace Privacy Rule, lines 290-323). No automated test verifies it. A future regression where someone adds `stdin: transcribePrompt` to a trace payload (instead of `stdinBytes: Buffer.byteLength(...)`) would silently leak prompt text.
**Fix:** Add a test that:

1. Spies on `console.log` (since the trace utility uses `console.log` per `provider-harness-trace.js:178,181`).
2. Sets `PROVIDER_HARNESS_CONSOLE_TRACE=true`, runs the wired `codex.transcribeImage` with mocked spawn, asserts that:
   - At least the required v0.2 stages from plan lines 326-353 appear in `console.log` calls.
   - No call contains the raw `transcribePrompt` text, raw image base64, full stdout text, or full stderr text. (Easy assertion: stringify all captured `console.log` args and `!includes('Transcribe ALL text visible')`.)
3. Then sets the env var to `'false'`, repeats the run, asserts `console.log` is not called with `[provider-harness]` strings AND the persisted record is byte-identical to the trace-disabled run.

---

### Code quality and defensive programming

**Finding M4: plan rule 3 ("Provider calls must not wait for Mongo/file recording") is satisfied for CLI but visibly violated for HTTP**
**Severity:** Medium
**File:** `server/src/services/image-parser.js:805`, `server/src/services/lm-studio.js:67`, `server/src/services/remote-api-providers.js:127`
**Issue:** All three v0.1 HTTP recorder call sites still `await recordHttpProviderCallPackage(captureInput)`. The plan's Recorder Policy section (lines 232-254) is unambiguous: *"Production code must not do this: `await recordProviderCallPackage(...)`. Production code should do this: `void recordProviderCallPackage(...)`."* The plan's Non-Negotiable Rule #3 is global: *"Provider calls must not wait for Mongo/file recording before returning the provider result to existing code."*

The implementer correctly identified that flipping HTTP to fire-and-forget would change v0.1 behavior inside v0.2's foundation step and (correctly, defensively) scoped the change to CLI only. But the plan was not updated to match. Either the plan or the implementation needs to be reconciled. Two prior plan reviews flagged this as a Blocker for plan correctness; it's now a documentation/contract drift between plan and code.

**Reproduction:** Read the plan, read `image-parser.js:805`, see contradiction. Future implementer reading the plan as authoritative will (a) think the rule already applies to HTTP and design accordingly, or (b) "fix" HTTP to match the plan in a separate commit without realizing v0.1 tests assume awaiting behavior, and break the v0.1 test suite.
**Fix:** Pick one of:

- (a) Update `v0.2.md` lines 232-254 to scope the rule to CLI only, with explicit acknowledgement that HTTP fire-and-forget is deferred. Add a section "v0.1 HTTP fire-and-forget retrofit — deferred to v0.2.x" matching the rest of the deferral pattern.
- (b) In a separate commit *before* Step 4, flip the three HTTP `await`s to `void` and update `server/test/{image-parser,remote-api-providers,lm-studio,provider-call-package-recorder}.test.js` to use `__waitForProviderPackageRecorderSettled()`.

Pick (a) for the minimum change. The plan-implementation split is the actual finding. The implementation choice is fine.

---

### Performance and responsiveness

No findings. Capture is fire-and-forget for CLI; the existing v0.1 HTTP latency story is unchanged. The 512 KB inline-vs-external threshold for stdout/stderr is reasonable. Mongo `Mixed` schema avoids validation overhead per document.

---

### Failure modes

Largely covered above. Specific note: the recorder's `inFlightBackgroundRecords` set at `recorder.js:15` is module-scoped and grows unbounded if Mongo is hung — but the `.finally(() => inFlightBackgroundRecords.delete(promise))` at `:632,656` cleans up on settlement. On a wedged Mongo with no timeout, an in-flight Promise sits forever. Mongoose's default `serverSelectionTimeoutMS` (default 30s) limits the wedge, so this is acceptable as-is.

### Observability and debugging

**Finding L1: most CLI-failure paths lack wired-Codex tests**
**Severity:** Low
**File:** `server/test/provider-call-package-cli.test.js`
**Issue:** The builder/classifier is well-tested (`:151-178`), and the wired success path is well-tested (`:235-290`), but plan test groups 4 (non-JSON line), 5 (nonzero exit), 6 (timeout), 7 (spawn error) only exist at the classifier level — not as wired-Codex tests that exercise `codex.transcribeImage` end-to-end through the spawn mock. The wired path has its own logic (close-handler vs. timeout-handler timing) that the classifier tests don't exercise.
**Reproduction:** Imagine a regression where a future edit to `codex.js` accidentally drops `closed: true` from the close-handler meta. Builder/classifier tests still pass. Success-path wired test still passes. Failure-path wired tests don't exist, so the regression ships.
**Fix:** Add four small tests using the existing `installSpawnMock` helper:

1. Emit one malformed line + one valid JSONL + close 0 → assert `cli.stdout.malformedLines.length === 1`, `outcome === 'success'`.
2. Emit one valid JSONL, close with code 1 + stderr text → assert `outcome === 'process_error'`, `cli.process.exitCode === 1`, `cli.stderr.text` matches.
3. Set timeoutMs=10, never emit close → assert (after settled hook) `outcome === 'timeout'`, `cli.timeout.fired === true`. This test would also catch finding M1 once that's fixed.
4. Emit `child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))` → assert `outcome === 'spawn_error'`. This test would also catch finding M2 once that's fixed.

---

**Finding L2: no test for recorder-failure-does-not-fail-provider (plan test group 8)**
**Severity:** Low
**File:** `server/test/provider-call-package-cli.test.js`
**Issue:** Plan test group 8 (`v0.2.md:720-722`) requires a test proving "provider result still returns normally" when "recorder failure is logged." The code paths support this (recorder catches its own errors at `recorder.js:477-496` and the background wrapper also catches at `:646-654`), but no test forces a recorder failure and asserts the provider Promise still resolves.
**Reproduction:** Future regression: someone removes the `.catch(...)` in `recordCliProviderCallPackageInBackground` thinking "it's already wrapped in try/catch inside `recordCliProviderCallPackage`" — but the *envelope build* (`buildCliProviderCallPackage`) at `:584` runs *outside* the try block in the public function. Wait, actually it's inside the try at `:570-617`. OK, the current code is safe. But a regression on the wrapper itself would slip through.
**Fix:** Add a test that monkey-patches `ProviderCallPackage.create` to `throw new Error('boom')` and asserts:

1. `codex.transcribeImage(...)` resolves normally with the expected `{ text, usage }`.
2. After `__waitForProviderPackageRecorderSettled()`, no record exists in Mongo.
3. The recorder logged something (spy on `console.warn`).

---

### Accessibility and responsive design

Not applicable. Server-only changes.

### Security

No findings beyond the captured-content sensitivity that the plan and prior reviews already discuss. Redaction patterns at `redaction.js:23-28` cover bearer tokens, named API keys, generic key=value patterns, and `sk-…` prefixes. Header redaction is comprehensive at `:6-21`. CLI args, stdin, stdout (raw and JSONL), stderr, and per-chunk text all go through `redactCliText`. Temp file paths under `os.tmpdir()` containing the OS username are preserved as-is (prior plan review finding #10's recommended treatment). This is consistent and acceptable.

---

## 6. Exceeds expectations assessment

Walking through the five questions:

**1. Would a senior engineer be impressed by this code?**

Mostly yes. The recorder's separation of `buildCliProviderCallPackage` (pure function) from `recordCliProviderCallPackage` (side effects) from `recordCliProviderCallPackageInBackground` (fire-and-forget wrapper) is clean. The redaction surface is thorough — args, stdin, stdout text, stdout lines, stdout JSONL events, malformed lines, finalBuffer, chunks, stderr, stderr chunks, all routed through the same `redactCliText` / `redactBodySecrets` pair. The trace surface is dense and deliberate — every step in the codex.transcribeImage spawn lifecycle has its own named stage with metadata-only payloads. The `inFlightBackgroundRecords` set + `__waitForProviderPackageRecorderSettled` test hook is the right shape.

The one place a senior engineer would push back: the duplicated lifecycle scaffolding inside `codex.transcribeImage`. The function is now ~400 lines, almost all of it bespoke capture wiring. That same wiring will need to be duplicated 5+ times across `codex.parseEscalation`, `codex.chat`, `claude.transcribeImage`, `claude.parseEscalation` (×2), `claude.prompt`, `claude.chat`. The prior plan review explicitly called for a "CLI attempt collector" abstraction before Step 4. The plan was not updated to require one, and the implementation reflects that — the helper does not exist yet.

**2. Are error messages actionable?**

The Codex CLI failure formatter at `codex.js:83-95` does the right thing — explicitly mentions "Ensure `codex` is installed and available on PATH" for ENOENT. Recorder errors are logged with `name`, `message`, `code` plus the `[provider-call-package-recorder]` prefix. Trace failures fall back to `[provider-harness] trace_failed <msg>`. Acceptable.

**3. Is defensive programming comprehensive?**

Yes for the happy path and most of the unhappy paths. The lifecycle hole on timeout/error (finding M1) is the one place where the defensive story is incomplete — a senior reviewer would expect the capture record to *always* reflect the actual close-time facts, regardless of how the provider Promise resolved.

**4. Does the architecture make future changes easier, not harder?**

Partially. The shared foundation (recorder, redaction, payload store, model) is set up well for Step 4 expansion. But because the per-call-site capture wiring is open-coded inside `codex.transcribeImage` (~270 lines of scaffolding), each new call site will copy that scaffolding. Without a `cliAttemptCollector` helper, expansion grows linearly and the same M1/M2 bugs will be reproduced in every copy.

**5. If you showed this to the user right now, would they say "this exceeds what I asked for"?**

Mostly yes. The plan asked for: foundation + Codex `transcribeImage` proof + trace stages + test-only settled hook + capture-disabled invariance + fire-and-forget. All present. Plan items not implemented and not flagged in this review as findings: none — every plan item is either implemented or explicitly deferred per the plan's Step 4 / Step 5 / Step 3 stop-and-review structure.

The user would *not* say "exceeds" in two places:

- The lifecycle hole on timeout/error means the user's stated Done Criterion "CLI stdout/stderr/exit/timeout/error facts are preserved" (`v0.2.md:777`) is satisfied on success and partial on failure paths. The plan asked for facts to be preserved across all outcomes; the implementation preserves them only on `success` and `process_error`-via-close. Timeout records have null exitCode/signal.
- The plan-vs-implementation drift on fire-and-forget scope (M4) means the plan reads as if HTTP capture also became non-blocking, which it didn't.

These are reasons the intent-gate result is "PASS, capped at 8/10, not exceeding." Score is not capped at 7 because both are addressable in the next iteration without rework — they don't reflect a structural failure to meet user intent, just incomplete coverage of two specific stated rules.

---

## 7. Recommendations to exceed intent

| Gap | Current | Exceeding | Recommendation | Effort |
| --- | --- | --- | --- | --- |
| Lifecycle hole on timeout/error (M1) | Capture queued before child closes; loses exitCode/signal/finalBuffer on timeout | Capture always reflects real close-time facts; provider returns immediately | Refactor to a `cliAttemptCollector` helper that exposes `await finalize()` from `child.on('close')` regardless of provider-resolve state. Use it from `codex.transcribeImage` before Step 4 starts. | 1 day |
| Per-call-site scaffolding duplication | 270 lines of capture wiring inline in `transcribeImage` | One helper used 6+ times across Codex+Claude | Extract `withCliAttemptCapture({ captureContext, command, args, spawnOptions, timeoutMs, onSpawn, onStdoutLine, onClose }) → Promise<{ stdoutText, stdoutLines, jsonlEvents, ..., capture }>`. Wires trace, lifecycle, redaction queueing once. | 2 days (pays back over Steps 4+5) |
| Spawn-error misclassification (M2) | `child.on('error')` → `outcome: 'process_error'` always | Correct `spawn_error` for ENOENT; `process_error` for runtime errors after spawn | Inline classifier in error handler, OR remove explicit `outcome` from spawn-error meta and let `classifyCliOutcome` infer from `err.code === 'ENOENT'`. | 1 hour |
| Missing failure-path tests (L1, L2, M3) | Builder/classifier covered; success path wired-tested; failures not wired-tested | Every plan-required test group has a wired Codex test | Add 6 small tests: 4 failure paths (malformed/nonzero/timeout/spawn-error), 1 recorder-failure-does-not-fail-provider, 1 trace privacy assertion. Use existing `installSpawnMock` + console-spy patterns. | 4 hours |
| Plan/code drift on fire-and-forget scope (M4) | Plan says global, code applies to CLI only | Plan and code agree | Edit `v0.2.md:232-254` to scope the rule to CLI for v0.2; add a "v0.1 HTTP fire-and-forget retrofit" deferral section. | 15 minutes |

---

## 8. What breaks first

**Most likely production failure mode: a Codex CLI timeout during a real customer image transcription with capture enabled.**

The provider call correctly returns its error to the caller (UI sees the timeout). But the capture record persisted to Mongo is incomplete: `cli.process.exitCode === null`, `cli.process.signal === null`, `cli.process.closed === false`, `cli.stdout.finalBuffer === ''`, and any partial JSONL emitted just before the kill is lost. Downstream consumers querying for timeout records (e.g., to debug why Codex is timing out on a specific image type) will see a record that says "timeout" but provides no exit signal evidence to distinguish a clean SIGTERM kill from a hung-then-killed process. They'd have to fall back to the stderr stream (which *is* captured) and the timing fields.

This is not a critical failure — the user-facing behavior is correct, capture is best-effort by design, and the partial record is still useful. But it's the visible weak point.

Second most likely: a future implementer wiring `codex.parseEscalation` copies the `transcribeImage` capture scaffolding line-for-line, including the lifecycle bug. The bug then reproduces in every new call site until refactored.

---

## 9. Production verdict

**Ship Step 1 + Step 2.** The proof works end-to-end. Capture is invisible when disabled, fire-and-forget when enabled, fully traced, and persists a redacted record that round-trips through Mongo. The four Medium findings are all about completeness of the failure-path story and a plan-vs-code drift, not about whether the happy path is correct.

**Before starting Step 4:**

- Fix M1 (lifecycle hole) at the foundation level by extracting a `cliAttemptCollector` helper. This is the single highest-leverage cleanup because Step 4 (Codex parseEscalation + chat) and Step 5 (Claude, 4 paths) will each need the same lifecycle wiring. Doing it once now saves doing it badly 6 more times.
- Fix M2 (spawn-error classification) in the same refactor.
- Reconcile M4 (plan-vs-code drift) by editing the plan text.
- Add the missing failure-path tests (L1, L2, M3).

After those, the gate would PASS at 9/10 with finding-count Critical 0 / High 0 / Medium 0 / Low 0.

---

## 10. Non-negotiable fixes

Gate decision is PASS. There are no non-negotiable fixes blocking ship of Step 1 + Step 2.

Before Step 4 starts (recommended ordering for the loop):

1. **M1** — Extract a `cliAttemptCollector` helper and reroute `codex.transcribeImage` through it, so close-time facts always reach the capture record regardless of timeout/error path. (1 day)
2. **M2** — Reclassify `child.on('error')` outcomes by `err.code` so ENOENT maps to `spawn_error`. (1 hour, should land in same commit as M1.)
3. **M4** — Edit `v0.2.md` Recorder Policy and Non-Negotiable Rules to scope fire-and-forget to CLI for v0.2, with a separate "HTTP retrofit deferred" note. (15 minutes)
4. **M3** — Add a trace-privacy test that asserts (a) required stages emit, (b) no raw prompt/stdout text appears in any trace line. (1 hour)
5. **L1** — Add four wired-Codex failure-path tests (malformed line, nonzero exit, timeout, spawn error). (2 hours)
6. **L2** — Add a recorder-failure-does-not-fail-provider test. (30 minutes)

---

## End of review
