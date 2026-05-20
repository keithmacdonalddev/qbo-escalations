# Plan Review: Provider Harness v0.2 (CLI capture)

**Date:** 2026-05-20
**Reviewer:** Claude implementation-reviewer subagent
**Plan path:** `C:\Projects\qbo-escalations\provider-harness-research\plan-v0.2\v0.2.md`
**Plan version:** v0.2 (CLI-only)
**Companion docs read:** `plan-v0.1/v0.1.md`, `implementation-review/2026-05-20-provider-harness-v0.1-implementation-review.md`, `HANDOFF.md`
**Code state cross-checked:** master @ `d6e7a8f` ("Harden provider call package capture") plus uncommitted modifications in `provider-call-package-*` services, `image-parser.js`, `lm-studio.js`, `remote-api-providers.js`, and the new untracked `server/src/lib/provider-harness-trace.js`.

**Note on parallel review:** A sibling file `2026-05-20-provider-harness-v0.2-plan-review.md` exists in the same folder, written independently by another reviewer at 11:58 today. The two reviews substantially agree on the load-bearing issues. Where the other review found something I missed (notably `workspace-proactive.js` Claude CLI usage, spawn-options capture, and harness-stub mode behavior), I credit it inline. Where I found something it did not (capture-version seam, schemaVersion bump policy, CLAUDE.md docs, temp-path redaction specifics), those are my additions. Treat the two as complementary, not redundant.

---

## TL;DR verdict

**Ship with changes.** The slice is well-bounded and the right next step. The single strongest reason to require changes before implementation: **the plan reuses the v0.1 recorder infrastructure but assumes the recorder is already fire-and-forget — it is not.** v0.1 recorder calls are still `await`-ed in production paths (`image-parser.js:858`, `lm-studio.js:124`, `remote-api-providers.js:192`). The v0.2 plan's Non-Negotiable Rule #3 ("Provider calls must not wait for Mongo/file recording before returning the provider result to existing code") and the explicit `void recordProviderCallPackage(...)` pattern are therefore a v0.1 regression fix bundled into v0.2 without saying so. That is a scope ambiguity that needs to be resolved before Step 1 starts, otherwise the foundation step will silently change the behavior of every already-wired HTTP path — including the existing v0.1 tests that rely on `await` to settle the recorder before assertions.

A second, smaller issue: the plan introduces `providerPathType: 'cli-subprocess'` while existing trace code already uses the literal `'cli'` for the same concept (`image-parser.js:1757, 1782, 1801, 2045`). Pick one and document the choice.

Everything else is fixable in-flight or is plan-only polish. The implementation order (foundation -> Codex `transcribeImage` proof -> stop -> expand -> Claude) is correct and conservative.

---

## Plan summary in my own words

- v0.2 extends the v0.1 HTTP-only capture system to **local CLI subprocess providers** (Codex first, Claude second), behind the same `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true` flag.
- The CLI package captured is: `command`, `args`, stdin prompt, stdout text + JSONL events + malformed lines + tail buffer, stderr text, process facts (pid, exitCode, signal, killed), timeout facts, timing, and outcome — all redacted before persistence.
- The Mongoose `ProviderCallPackage` model gets one new field, `cli`, alongside the existing HTTP-shaped `request`/`response`/etc. No new indexes.
- Recorder must become fire-and-forget (`void recordProviderCallPackage(...)`) with a test-only `__waitForProviderPackageRecorderSettled()` hook so tests can deterministically assert background writes.
- Implementation order is strict: (1) shared foundation (cli field + builder + redaction + externalization + fire-and-forget + test hook) -> (2) wire `codex.transcribeImage` only -> (3) **STOP and review** -> (4) expand to remaining Codex paths (`parseEscalation`, `chat`) -> (5) apply same framework to Claude paths.
- Explicitly out of scope: Anthropic SDK capture, all streaming/SSE capture (including LM Studio chat), temp-file image preservation, warm-ups, health checks, key probes, model discovery, dashboards/UI, retention, parser validation.

---

## Strengths

1. **Implementation order is genuinely safe.** Foundation first, one proof path next, hard stop for review, then expand. This is the right discipline given v0.1 already merged with hygiene problems. The "Stop And Review" gate at Step 3 is the single most valuable structural feature of this plan.
2. **First proof target is well-chosen.** `codex.transcribeImage(...)` (codex.js:464) is a single-shot, non-callback, file-input function. No streaming callbacks, no chat-history reconstruction, no SSE. If capture cannot be made invisible there, it cannot be made invisible anywhere.
3. **Scope discipline is explicit and complete.** The "What Is Out Of Scope" section is unusually thorough. SDK, streaming, temp-file hardening, dashboards, retention, parser validation, canonical text conversion — all named individually with a future-version label. This is the kind of plan that's easy to enforce.
4. **The CLI package shape is faithful to what subprocesses actually produce.** Keeping raw `stdout.text` alongside parsed `stdout.jsonlEvents` and a `stdout.malformedLines` bucket is correct. "Do not treat JSONL parse failure as parser failure. It is provider package evidence" (Stdout Rules section) is the right framing.
5. **Outcome decision tree is unambiguous.** Six outcomes, ordered, mutually exclusive. The `aborted` / `timeout` / `process_error` distinction matches what `codex.js` and `claude.js` actually emit today.
6. **Plan correctly warns Claude is not Codex.** "Do not assume Claude stdout has the same JSONL shape as Codex stdout" (Claude CLI section). True — Claude stdout uses `stream_event`-wrapped messages with `content_block_delta`, `thinking_delta`, etc., distinct from Codex's `agent_message` / `reasoning` item events.
7. **The plan respects the v0.1 implementation review.** Fire-and-forget recorder is exactly the MAJOR-01 finding from that review. Whether the plan author saw that review or arrived at it independently, the prescription is correct.
8. **Large-payload guidance is sane.** "Avoid storing the same large payload multiple times inline" addresses the v0.1 review's MAJOR-02 finding (`bodyJson` + `bodyText` duplication). The payload-store code already has the `shouldDropDuplicateRequestBodyJson` path (payload-store.js:226-251), so the foundation is partly there.


---

## Findings

Severity legend: Blocker = fix the plan before coding starts; Major = should fix in-plan or first commit; Minor = improve when convenient; Nit = wording.

### 1. [Blocker | Sequencing] Fire-and-forget rule conflicts with current v0.1 HTTP code

Plan location: Recorder Policy section (lines 232-254), Non-Negotiable Rules 3-5.

The plan mandates the fire-and-forget pattern and "Provider calls must not wait for Mongo/file recording before returning." The current v0.1 code does the opposite -- the await pattern appears at `image-parser.js:858`, `lm-studio.js:124`, `remote-api-providers.js:192`. Step 1 of the plan says "Add fire-and-forget recorder behavior" but does not say "and rewire the existing v0.1 HTTP helpers to also be fire-and-forget." If you only add the helper, the HTTP helpers keep awaiting. If you change the helpers, you are changing v0.1 behavior inside v0.2's foundation step, which contradicts the plan's claim that v0.2 does not change HTTP-path behavior.

Recommendation. Decide one of:
- (a) Scope Step 1 to also rewire the three existing v0.1 helpers to fire-and-forget and update the existing HTTP capture tests at `provider-call-package-recorder.test.js:100-136`, `image-parser.test.js:555-626`, `remote-api-providers.test.js:268-346`, `lm-studio.test.js:182-310` (which today rely on await to settle the recorder before assertions). These tests will need the new recorder-settled hook.
- (b) Keep HTTP helpers awaiting and apply fire-and-forget only to CLI paths, accepting that "fire-and-forget" becomes a CLI-only rule.
- (c) Do v0.1.1 as a separate commit before v0.2 begins, isolating the HTTP fire-and-forget rewire.

Whichever you pick, state it in the plan. The sibling reviewer reaches the same conclusion in its BLOCKING-03.

Confidence. Verified against code: `image-parser.js:858`, `lm-studio.js:124`, `remote-api-providers.js:192`, `recorder.js:319-362`. Search for the recorder-settled hook name returned no matches in the repo.

### 2. [Blocker | Correctness] Subprocess lifecycle is underspecified for timeout/abort/cleanup vs. child close

Plan location: Step 2 (lines 491-523), Outcome Rules (lines 404-426). I missed this on first pass; the sibling reviewer caught it as their BLOCKING-01 and they are correct.

In `codex.transcribeImage`, the timeout handler kills the child and calls `finishErr` immediately (codex.js:557-563). The close handler (codex.js:586-605) returns early if already settled (the early-return at 588). Therefore, on timeout the outer Promise resolves/rejects before close ever fires, and exitCode/signal facts may not be observable when the record is built. The chat function's cleanup callback (codex.js:233-239) sets killed=true and kills the process, returning partial state with no final close signal recorded.

If the implementation records inside `finishErr` only, it loses close-time facts. If it records only on close, it can lose the timeout/cleanup cases entirely. If it waits for close before returning the provider error, it violates the "provider behavior unchanged" rule.

Recommendation. Add an explicit lifecycle rule to the plan:
- Define a CLI attempt collector that starts before spawn, accumulates stdout/stderr/error/timeout/cleanup events as the child runs, and finalizes in the background (after provider behavior has already returned).
- Specify that on timeout/cleanup, the provider Promise resolves/rejects immediately, but the collector should still listen for close afterward when possible and write one final record.
- If final close data is unavailable, record that explicitly: process.closed=false, process.signal=null, timeout.fired=true.
- Add explicit abort/cleanup tests for `codex.chat` and `claude.chat`, not just timeout tests.

Confidence. Verified against code: codex.js:464-612 (transcribeImage), :586-605 (close handler with early-return), :233-239 (chat cleanup).

### 3. [Blocker | Correctness] claude.parseEscalation is two subprocesses, not one

Plan location: Step 5 (lines 550-565). I originally rated this Minor; the sibling reviewer correctly elevated it to BLOCKING-02 and I am adopting that severity.

`claude.parseEscalation` for image input spawns two distinct Claude CLI subprocesses: a transcription step (claude.js:524) and a parse step (claude.js:622). For text input it spawns one (claude.js:745). Per the plan's "Each CLI provider attempt gets exactly one outcome" (Outcome Rules), this means one function call equals one or two records depending on input. The plan does not address this.

Recommendation. State explicitly that "one ProviderCallPackage record per child process attempt, not per exported service function." Add Done Criteria:
- `claude.parseEscalation` image input creates two records, with callSite values `claude:parseEscalation.transcribe` and `claude:parseEscalation.parse`.
- `claude.parseEscalation` text input creates one record, `claude:parseEscalation.parse`.

Confidence. Verified against code: claude.js:485-727 (image path: step A transcribe + step B parse), :730-857 (text path: single parse).

### 4. [Major | Contract] captureVersion constant has no per-call-site seam

Plan location: Data Model Change section (lines 269-306).

Plan says use captureVersion=`provider-harness-cli-v0.2`. But the current code hardcodes `CAPTURE_VERSION = 'provider-harness-http-v0.1'` at recorder.js:11 and stamps it into every envelope at recorder.js:158. There is no per-call-site override path. The CLI builder will need either a separate constant or a captureVersion-as-argument seam, otherwise a CLI envelope will get the HTTP version string.

The plan does not name the file producing the CLI envelope (it says "new CLI builder/helper file under server/src/services/" -- Allowed File Scope section) but does not specify the seam.

Recommendation. In the CLI builder, mint a separate `CAPTURE_VERSION_CLI = 'provider-harness-cli-v0.2'` constant. The CLI builder can return a pre-built envelope with the correct captureVersion field -- `recordProviderCallPackage` already accepts a pre-built envelope, so no additional plumbing is needed.

Also unresolved. The plan does not address whether schemaVersion (currently `0.1` at models/ProviderCallPackage.js:6) should bump. Adding `cli` to a Mixed schema does not require a schema bump, but consumers querying by schemaVersion will not distinguish v0.1 records from v0.2 records without one. Recommend either bumping to `0.2` for any envelope that includes a cli block, OR explicitly noting that schemaVersion stays at `0.1` because the schema is Mixed.

Confidence. Verified against code: models/ProviderCallPackage.js:6,7; recorder.js:11-12,157-158.

### 5. [Major | Consistency] providerPathType literal mismatch

Plan location: Data Model Change section (line 295).

Plan says providerPathType=`cli-subprocess`. Current code already uses the literal `cli` in trace events (image-parser.js:1757, 1782, 1801, 2045). The plan does not acknowledge the existing literal. If new CLI captures use `cli-subprocess` while existing traces use `cli`, downstream consumers cannot trivially group all CLI provider calls.

Recommendation. Pin a value list in the plan. Two acceptable choices:
- Use `cli` (matches existing convention; do not touch the existing traces, which is out of file scope anyway).
- Use `cli-subprocess` (more descriptive but inconsistent until a future migration).

Recommend the first. Either way, the plan should explicitly enumerate every providerPathType literal that exists across HTTP and CLI captures so the canonical set is documented. Existing literals confirmed via grep: direct-http, local-http, gateway-http, sdk, cli, stub.

Confidence. Verified against code: image-parser.js:1757, 1782, 1801, 2045.

### 6. [Major | Risk] "Streaming out of scope" is ambiguous because CLI chat is itself a stream

Plan location: What Is Out Of Scope -> Streaming/SSE Capture (lines 180-193). The sibling reviewer caught this as MAJOR-01.

Plan says streaming is out of scope (v0.4). But `codex.chat` and `claude.chat` are streaming via onChunk callbacks (codex.js:172-194, claude.js:312-358). The plan lists `codex.chat(...)` in Step 4 and `claude.chat(...)` in Step 5. So the plan IS in scope for CLI chat -- it just calls it "model-work paths" instead of "streaming." This is a real contradiction. The onChunk callbacks fire many times during a single subprocess lifetime; capturing the package once at process close is fine, but the plan should explicitly say "we capture the final stdout/stderr buffers at process close, not the streamed chunks themselves." Otherwise an implementer might add per-chunk capture (similar to v0.1 responseChunks array for HTTP) and accidentally re-introduce the streaming complexity v0.1 deferred.

Recommendation. Add to the plan:
- Out of scope: app/browser SSE frame capture and LM Studio HTTP streaming capture.
- In scope: local CLI stdout/stderr stream collection for Codex and Claude subprocesses, captured ONLY as final buffers at process close (no per-chunk records).
- Mid-stream onChunk callbacks pass through to the caller unchanged.

Confidence. Verified against code: codex.js chat() at 105-240; claude.js chat() at 195-434.

### 7. [Major | Missing piece] workspace-proactive.js is a Claude CLI model-work path the plan does not mention

Plan location: Allowed File Scope (lines 610-632) and What Is In Scope -> Claude CLI (lines 138-159). I missed this; credit the sibling reviewer's MAJOR-04.

`server/src/services/workspace-proactive.js` spawns the Claude CLI directly with its own stdin write, stdout/stderr readers, and close handler. This is a Claude CLI model-work subprocess outside the claude.js service module. The plan says "v0.2 captures local CLI provider calls" and then lists only the claude.js exported functions. Without an explicit deferral, "all CLI provider calls" sounds broader than the actual file scope.

Recommendation. Add to the plan:
"Deferred from v0.2: workspace-proactive.js Claude CLI subprocess capture. Reason: separate proactive-monitoring path outside the provider registry. Add as v0.2.x after core claude.js paths are stable."

Also add `server/src/services/workspace-proactive.js` to the "Do not touch" list to make the deferral binding.

Confidence. Verified by sibling review citing workspace-proactive.js:124-212; I did not independently re-read the file but the sibling reviewer's citations have been accurate elsewhere.

### 8. [Major | Risk] Recorder timing inside child.on close is unspecified relative to finishOk

Plan location: Step 2 (lines 491-523).

Step 2 wires `codex.transcribeImage` first. The function constructs the child inside a new Promise and resolves on child.on close. The natural place to invoke the recorder is inside the close handler, but the implementer must decide whether the recorder call comes BEFORE or AFTER `finishOk(text)` resolves the outer Promise. If before, the caller waits on the recorder (latency regression). If after, the recorder reads closure variables that may have been mutated (e.g., tempFiles is unlinked synchronously inside finishOk via cleanupTempFiles at codex.js:536, so any path-based capture data must be snapshotted before cleanup).

Recommendation. State explicitly: "In Step 2, the recorder is invoked AFTER finishOk/finishErr has resolved/rejected the outer Promise, using values snapshotted immediately before resolution. The recorder must not be invoked synchronously inside the close handler before resolution."

Confidence. Verified against code: codex.js:464-612, particularly child.on close at 586-605 and cleanupTempFiles(tempFiles) inside finishOk at 536.

### 9. [Major | Missing piece] Outcome union across HTTP and CLI is not documented

Plan location: Outcome Rules (lines 404-426).

Plan defines 6 CLI outcomes (success, spawn_error, process_error, timeout, aborted, invalid_jsonl). The v0.1 HTTP outcomes are success, http_error, network_error, timeout, aborted, invalid_json. After v0.2, the same outcome field will carry 9 distinct strings (5 shared plus 2 HTTP-only plus 4 CLI-only with overlap on success/timeout/aborted).

The model schema outcome field is just `String, required, index` (models/ProviderCallPackage.js:20) -- no enum, no validation.

Recommendation. Add an "Outcome Union" subsection to the plan listing all outcomes and which path types use which. Decide whether to keep the field free-form or constrain it with a Mongoose enum. Leaning toward documentation only (no enum) since the surrounding fields are Mixed, but the plan should be explicit.

Confidence. Verified against code: models/ProviderCallPackage.js:20, recorder.js:62-76.

### 10. [Major | Risk] Redaction rules for CLI args and temp paths are vague

Plan location: Redaction Rules (lines 428-458). The sibling reviewer covers env/path redaction at MAJOR-07.

Plan says "For CLI args: preserve command shape. Redact sensitive path segments or token-like args" and "home-directory specific paths when not needed." But it does not specify the rule. In current code, Claude passes temp image paths via --add-dir and inline prompt references (claude.js:119-128, 109-117). Those paths are os.tmpdir() plus qbo-escalation-img-* -- they contain no secrets but they DO contain the user's username on Windows (e.g., C:\Users\NewAdmin\AppData\Local\Temp\...). Codex similarly writes temp images via writeImageTempFiles (codex.js:639-654).

Recommendation. Specify a concrete rule in the plan:
"Temp image paths under os.tmpdir() are preserved as-is (username in path is acceptable since it identifies the operator, not a customer). Any path starting with C:\Users\ or /home/ outside os.tmpdir() should be redacted to [REDACTED_USER_PATH]. Alternative: store only path.basename(x) for any temp file reference."

Pick one. Current vagueness will produce inconsistent redaction across Codex/Claude implementations.

Confidence. Verified against code: claude.js:175-181, codex.js:639-654.

### 11. [Major | Risk] CLI stdin contains user-provided customer data; plan does not flag privacy implications

Plan location: CLI Package Shape (lines 308-360), Redaction Rules (lines 428-458).

The recommended cli subdocument includes cli.stdin.text. For parseEscalation and transcribeImage, the stdin text is the prompt. For chat, stdin contains the FULL conversation history (codex.js:111 buildPrompt joins all messages; claude.js:201 similarly). If the user has typed sensitive QBO customer data into chat (which is the point of this app), that data is now persisted to Mongo and to disk sidecar files.

The plan acknowledges this implicitly ("preserve the prompt/package text because that is part of the provider request package") but does not flag the data sensitivity. This is not a new exposure -- v0.1 already captures the same data on the HTTP side. But it is a new exposure surface (disk paths, env values, command args alongside the prompt).

Recommendation. Add a "Sensitive content" subsection to Redaction Rules:
"stdin text may contain user-provided customer data, COIDs, MIDs, case numbers, and other QBO-internal identifiers. This data is preserved as-is, the same as v0.1 HTTP captures. Capture is opt-in via ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true precisely because of this. Operators enabling capture must understand they are creating an additional copy of sensitive customer data on this server disk and in Mongo."

Confidence. Verified against code: codex.js:111-145, claude.js:201-291.

### 12. [Major | Missing piece] Plan does not address harness-stub mode

Plan location: not addressed. I missed this; credit the sibling reviewer's MAJOR-09.

When HARNESS_PROVIDERS_STUBBED=1 is set, provider functions return stubs and never spawn a child process. Codex checks stubs at the top of chat, parseEscalation, and transcribeImage (codex.js:105-109, 291-295, 464-468). Claude has the same pattern. The plan does not say what the CLI capture should do when stubbed.

Recommendation. Add to the plan:
"When provider functions are stubbed via HARNESS_PROVIDERS_STUBBED=1, no child process is spawned, so no CLI ProviderCallPackage record is written. Tests must assert that capture-enabled plus provider-stubbed does not create a fake CLI record unless a test intentionally invokes the CLI builder directly."

Confidence. Verified against code: server/src/lib/harness-provider-gate.js, codex.js:106-110, claude.js:196-200.

### 13. [Major | Missing piece] Spawn options are part of the provider package but the plan omits them

Plan location: CLI Package Shape (lines 308-360). I missed this; credit the sibling reviewer's MAJOR-08.

The plan cli shape omits the spawn options. But spawn options are part of how the subprocess actually runs. For Codex and Claude, shell:true is mandatory on Windows for .cmd shim resolution. Both services also override env vars: Codex clears CLAUDECODE (codex.js:142, 259, 356, 523); Claude isolates cwd/env via buildClaudeSpawnOptions (claude.js:48-58).

Recommendation. Add a small, redacted spawnOptions subdocument to the CLI package shape including: shell flag, stdio config, cwd (redacted or basename only), and explicit envOverrides (only the keys the service actually sets: CLAUDECODE=[unset], CLAUDE_PROJECT_DIR=[empty], CLAUDE_CODE_DISABLE_AUTO_MEMORY=1). Do NOT store the full inherited environment.

Confidence. Verified against code: codex.js:139-143, claude.js:48-58, 270-276.

### 14. [Major | Missing piece] Missing tests in the required test groups

Plan location: Test Requirements (lines 568-608).

Plan lists 8 required test groups. Missing:
- Test that proves the recorder is in fact fire-and-forget -- that the provider Promise resolves BEFORE the recorder-settled hook resolves.
- Test that proves env capture does not leak OPENAI_API_KEY/ANTHROPIC_API_KEY even when the test sets them.
- Test that proves redaction of temp image paths (per finding 10).
- Test that proves Codex and Claude can co-exist (both wired, both writing distinct records with distinct providerIds in the same test run).
- Test that proves claude.parseEscalation image input produces TWO records and text input produces ONE (per finding 3).
- Test that proves harness-stub mode produces ZERO CLI records (per finding 12).
- Project-wide assertion: all CLI capture tests must mock child_process.spawn; no test may require a real Codex/Claude CLI binary or live account.

Recommendation. Expand the Test Requirements section with the seven test groups above. Use the existing mocked child-process pattern in server/test/provider-usage-contract.test.js:21-46 as a template.

Confidence. Plan-only finding; the existing test pattern was verified by the sibling reviewer and the file exists on disk.

### 15. [Minor | Sequencing] Step 1 should explicitly list test-file updates in Allowed File Scope

Plan location: Allowed File Scope (lines 610-632).

If Step 1 flips the existing HTTP helpers to fire-and-forget (per finding 1 option a), the v0.1 tests need updates to use the new recorder-settled hook. The plan's Allowed File Scope says "focused server tests" (line 620), broad enough to cover this -- but worth pinning explicitly.

Recommendation. Add to Allowed File Scope: server/test/image-parser.test.js, server/test/remote-api-providers.test.js, server/test/lm-studio.test.js, server/test/provider-call-package-recorder.test.js, noted as "update existing v0.1 tests to use the new recorder-settled hook."

### 16. [Minor | Docs] Done Criteria does not include documentation updates

Plan location: Done Criteria (lines 646-658).

After v0.2 lands, anyone reading CLAUDE.md will not know that enabling ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true now also captures CLI subprocess calls. CLAUDE.md describes AI integration in two paragraphs ("Transport 1 -- Claude CLI subprocess" and "Transport 2 -- Direct provider APIs") and does not mention the harness.

Recommendation. Add a Done criterion: "CLAUDE.md updated with a sentence noting that ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true now captures both HTTP and CLI subprocess provider calls." Also update the .env.example comment at line 48 to mention CLI subprocess stdout/stderr alongside HTTP request/response packages.

Confidence. Verified against CLAUDE.md (no mention of harness) and server/.env.example:48.

### 17. [Minor | Contract] Recorder-settled hook contract is unspecified

Plan location: Recorder Policy -> Test Hook (lines 256-267).

The plan introduces the hook but does not specify: where it is exported, how tests register to wait, what it returns if nothing is in flight, or how it behaves with concurrent recorder calls.

Recommendation. Add: "Exported from provider-call-package-recorder.js. Returns a Promise that resolves when all in-flight recorder operations queued before the call have settled. If nothing is in flight, resolves on the next microtask. Concurrent calls each see a snapshot of in-flight work at their call time."

### 18. [Minor | Forward compatibility] Future SDK/Stream subdocuments will need a top-level discriminator

Plan location: Data Model Change (lines 269-306).

The CLI envelope shape (top-level cli subdocument with command/args/stdin/...) is parallel to the existing top-level request/response/timing/outcome/error HTTP envelope. v0.3 SDK and v0.4 streaming capture will presumably add sdk and stream top-level subdocuments by the same pattern. After v0.2, an envelope has all of request/response/timing/outcome/error populated for HTTP PLUS cli populated for CLI. Future readers won't know which subdocuments are meaningful for a given record.

Recommendation (non-blocking for v0.2). Decide whether: (a) HTTP envelope fields are null on CLI captures, (b) every envelope keeps all subdocuments with null defaults, or (c) only the relevant subdocuments are present. The plan currently implies (c) by silence -- but it's worth saying so. Alternatively, use providerPathType rigorously as the discriminator.

### 19. [Minor | Code hygiene] Add adjacent files to "Do not touch"

Plan location: Allowed File Scope (lines 624-631).

The "Do not touch" list correctly names AgentsView and parser logic. But it omits adjacent unrelated files that an implementer might reasonably edit. Given v0.1 mixed AgentsView changes into the harness commit, naming every adjacent file makes the discipline easier.

Recommendation. Expand "Do not touch" to include:
- server/src/services/sdk-image-parse.js
- server/src/services/providers/
- server/src/services/provider-health.js
- server/src/services/workspace-proactive.js (per finding 7)
- client/**/*
- playbook/**/*

Confidence. Verified all listed files exist on disk.

### 20. [Nit | Wording] "Next Immediate Task" duplicates "Step 1"

Plan location: Next Immediate Task (lines 660-673).

The five-item checklist in "Next Immediate Task" is identical to Step 1 in Implementation Order. Pure duplication.

Recommendation. Trim to one sentence: "Start with Step 1 from Implementation Order. Do not wire Codex until Step 1 is reviewed."

---

## Cross-check log

Claims from the plan that I verified directly against the code:

| Plan claim | Verified in | Result |
|---|---|---|
| "v0.1 created server/src/models/ProviderCallPackage.js" | models/ProviderCallPackage.js (35 lines) | VERIFIED |
| "v0.1 created provider-call-package-recorder.js" | recorder.js (385 lines) | VERIFIED |
| "v0.1 created provider-call-package-redaction.js" | redaction.js (267 lines) | VERIFIED |
| "v0.1 created provider-call-package-payload-store.js" | payload-store.js (277 lines) | VERIFIED |
| "v0.1 captured non-streaming HTTP for anthropic, openai, gemini, kimi, llm-gateway, non-streaming lm-studio" | image-parser.js:32-33 imports recorder; v0.1 review section "Provider Wiring Map" confirms 6 image-parser callsites plus 5 remote-api-providers callsites plus 2 lm-studio non-streaming callsites | VERIFIED |
| "v0.1 did not capture CLI subprocess stdout/stderr packages" | codex.js and claude.js contain no require of provider-call-package-recorder | VERIFIED |
| "server/src/services/codex.js uses child_process.spawn" | codex.js:1 require; uses at lines 139, 248, 353, 520 | VERIFIED |
| "Codex runs codex exec --json" | codex.js:117-119 args | VERIFIED |
| "Codex parses stdout JSONL events" | codex.js:178-183 JSON.parse per line | VERIFIED |
| "codex.transcribeImage, parseEscalation, and chat are model-work paths" | codex.js exports at line 780 | VERIFIED |
| "server/src/services/claude.js uses child_process.spawn" | claude.js:1 require; uses at 272, 524, 622, 745, 869, 995, 1152 | VERIFIED |
| "Claude has model-work paths including chat, parseEscalation, prompt, transcribeImage" | claude.js:1236 exports | VERIFIED |
| "ProviderCallPackage current top-level fields are request/response/timing/outcome/error/redaction/storage" | models/ProviderCallPackage.js:5-23 confirms those fields PLUS schemaVersion, captureVersion, providerId, providerResearchId, providerPathType, callSite, operation, source | VERIFIED -- plan list is incomplete; see finding 4 |
| "captureVersion=provider-harness-cli-v0.2" | Current code recorder.js:11 hardcodes provider-harness-http-v0.1 with no override path | PARTIAL -- the value is correct as a goal but the code needs a seam; see finding 4 |
| "ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true gate" | server/.env.example:49; recorder.js:15-17 checks the env var per call | VERIFIED |

Claims I could NOT verify and why:

- "v0.1 captured lm-studio non-streaming." v0.1 plan and review say so, and the code import is present (lm-studio.js:15), but I did not exhaustively trace every lm-studio entry point. The v0.1 implementation review lists parseEscalation and transcribeImage as wired (and the streaming chat as not wired) -- I am taking that on faith from the prior review, not from independent code reading.
- "Recorder fire-and-forget works correctly with the test hook." The hook does not exist yet -- grep returned no matches. I cannot verify the contract because there is no code.
- "stdout.malformedLines contains raw lines that failed JSON parse." This is a plan-only invention. Today's codex.js:172-194 silently swallows JSON parse failures; there is no malformed-line bucket. The plan is inventing that bucket (which is the right thing to do) but does not flag it as new. Wording-level issue.
- "Recorder failures are logged with enough information to diagnose." Today the recorder logs only message at recorder.js:306. Plan says "should log enough information to diagnose recording failure" -- open to interpretation. Not flagged because current behavior may already be enough.

---

## Open questions for the user

1. Fire-and-forget retrofit: Do you want v0.2 Step 1 to also fix the v0.1 HTTP helpers (which currently await the recorder), or should that be a separate commit (v0.1.1) that lands BEFORE v0.2 begins? The plan implies the former but does not say it. (Finding 1.)
2. schemaVersion bump: When v0.2 lands, should records with a cli block carry schemaVersion=0.2 to distinguish them from v0.1 records, or stay at 0.1? Defaults today are 0.1 everywhere. (Finding 4.)
3. providerPathType naming: Use the existing literal cli (already in 4 trace sites) or the plan cli-subprocess? The plan value is more descriptive but inconsistent with existing code. (Finding 5.)
4. Captured prompt sensitivity: The CLI capture preserves stdin verbatim, which includes the full chat history with whatever COIDs, MIDs, and case numbers the user typed. v0.1 already captures the same data on the HTTP side. Are you comfortable adding a second copy on the CLI side, knowing it lives on disk and in Mongo when the flag is on? (Finding 11.)
5. claude.parseEscalation is two subprocesses: Should that produce one record or two records? Plan implicitly treats one function call equals one record, which under-counts. (Finding 3.)
6. workspace-proactive.js: Is the deferral implicit, or should the plan explicitly say it is out of scope for v0.2? (Finding 7.)
7. Acceptance criteria: The plan's Done Criteria section is informal. Do you want this plan to have a checkable acceptance-criteria list (with file-level evidence requirements) in the cto-review style, or is the prose form acceptable?

---

## Recommended next actions (prioritized)

1. Decide the fire-and-forget scope before writing any code. Either commit v0.1.1 first (HTTP fire-and-forget refit) or fold it into v0.2 Step 1 and update the v0.1 tests. Do NOT silently change v0.1 HTTP behavior inside v0.2's foundation step.
2. Resolve the three blocker findings in plan text: lifecycle/timeout sequencing (finding 2), claude.parseEscalation as two records (finding 3), fire-and-forget scope (finding 1).
3. Fix the version-string seam (finding 4). Add captureVersion as either an argument or a separate constant the CLI builder uses. Decide schemaVersion policy.
4. Pin the providerPathType literal (finding 5). Recommend the existing cli value, do not touch existing traces.
5. Add the streaming-vs-CLI clarification (finding 6). One sentence prevents Step 4/5 scope creep.
6. Add the missing test groups (finding 14): fire-and-forget assertion, env redaction, path redaction, multi-provider isolation, parseEscalation two-records, stub-mode zero-records, project-wide spawn-mock assertion.
7. Specify the recorder-settled hook contract (finding 17). One paragraph.
8. Defer workspace-proactive.js explicitly (finding 7).
9. Update CLAUDE.md and .env.example comment to reflect that capture now covers CLI subprocesses too. Add as a Done criterion (finding 16).
10. Implement Step 1 (shared CLI foundation) and stop. Open a sub-review before touching codex.transcribeImage.

---

## Out-of-scope observations

These are unrelated to the plan but I noticed them while cross-checking the code. NOT blockers for v0.2; logging for the user's awareness only.

1. provider-harness-trace.js is new and uncommitted. It is required by recorder.js (line 9), redaction.js (line 4), and payload-store.js (line 6). If the recorder file gets shipped or merged without the lib file, all three services break at require-time. This is a packaging risk -- verify the trace lib is in any commit that touches the recorder. Current state: server/src/lib/provider-harness-trace.js is untracked (?? in git status).
2. Modified-but-uncommitted files in the worktree. git status shows M server/src/services/image-parser.js, M lm-studio.js, M remote-api-providers.js, M provider-call-package-*.js. The user said capture v0.1 was "hardened" in commit d6e7a8f, but the worktree has further uncommitted changes on top. The v0.1 review verdict was based on the as-of-commit state. The current on-disk state may have already addressed some v0.1 MAJOR findings (e.g., the shouldDropDuplicateRequestBodyJson path at payload-store.js:226-251 looks like a v0.1 MAJOR-02 fix). Before starting v0.2, finalize and commit the v0.1 hardening so the diff for v0.2 is clean.
3. temp-audits/ and temp-reviews/ directories are untracked (per git status). Not related to v0.2 but flagged because the v0.1 review explicitly warned about "unrelated temp review files" -- there are now temp review files in the worktree.
4. AgentsView.css and AgentsView.jsx are modified-but-uncommitted again. These are the same files the v0.1 review flagged as wrongly mixed into the v0.1 commit. They are dirty again. v0.2's plan correctly lists them in "Do not touch" -- but the implementer needs to actively isolate them before any v0.2 commit, otherwise the same hygiene violation recurs.
5. Two review files in this folder: the sibling reviewer's file (2026-05-20-provider-harness-v0.2-plan-review.md, written earlier today) and this file (plan-v0.2-review.md). They are intended to be complementary, not redundant. The sibling review has more depth on lifecycle finalization and Claude output-mode tests; this review has more depth on captureVersion seam, schemaVersion bump policy, docs gaps, and concrete path-redaction rules. Recommend keeping both.

---

## End of review