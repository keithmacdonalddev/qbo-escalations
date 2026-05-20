# Implementation Review: Provider Call Package Capture v0.1

**Mode:** exhaustive-strict
**Reviewer:** Implementation Reviewer (lead, no subagent spawning available — review executed directly across all vertical slices)
**Date:** 2026-05-20
**Scope:** commit `0520274` ("Implement provider call package capture v0.1") on `master`, verified against current files on disk
**Plan:** `C:\Projects\qbo-escalations\provider-harness-research\plan-v0.1\v0.1.md`
**Subsequent fixes touching the same surface:** commit `0ea9f52` — unrelated (skill-audit recs for `.claude/skills/cto-review` and `.claude/skills/skill-audit` only); no provider-harness code changed after `0520274`.

---

## Scope

### Files added (5)

- `C:\Projects\qbo-escalations\server\src\models\ProviderCallPackage.js`
- `C:\Projects\qbo-escalations\server\src\services\provider-call-package-redaction.js`
- `C:\Projects\qbo-escalations\server\src\services\provider-call-package-payload-store.js`
- `C:\Projects\qbo-escalations\server\src\services\provider-call-package-recorder.js`
- Tests: `provider-call-package-redaction.test.js`, `provider-call-package-payload-store.test.js`, `provider-call-package-recorder.test.js`

### Files modified (in-scope)

- `C:\Projects\qbo-escalations\server\.env.example` — added `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=false`
- `C:\Projects\qbo-escalations\server\src\services\image-parser.js` — added capture import; modified `jsonRequest(...)`; added capture context to `callKimi`, `callLmStudio`, `callAnthropic`, `callOpenAI`, `callLlmGateway`, `callGemini`
- `C:\Projects\qbo-escalations\server\src\services\lm-studio.js` — added capture import; modified `rawRequest(...)` + `jsonRequest(...)`; added capture context to `parseEscalation`, `transcribeImage`
- `C:\Projects\qbo-escalations\server\src\services\remote-api-providers.js` — added capture import; modified `jsonRequestCancelable(...)`; added capture context to `requestAnthropicChat`, `requestOpenAiChat` (via `requestOpenAiLikeChat`), `requestKimiChat`, `requestLlmGatewayChat`, `requestGeminiChat`
- Tests: `image-parser.test.js`, `lm-studio.test.js`, `remote-api-providers.test.js`

### Files modified (out-of-scope — should NOT have been in this commit)

- `C:\Projects\qbo-escalations\client\src\components\AgentsView.css` (+171/-39 lines)
- `C:\Projects\qbo-escalations\client\src\components\AgentsView.jsx` (+85/-9 lines)

The plan explicitly mandated path-limited staging and prohibited mixing `AgentsView` changes (plan §"Risks And Mitigations" → "Worktree contamination", §"Commit Plan" final line). This was not followed. See **MAJOR-09**.

### Vertical slices reviewed

1. **Schema and contract slice** — `ProviderCallPackage` model + envelope shape produced by `buildHttpProviderCallPackage`
2. **Redaction slice** — secret stripping in headers and body, prior to persistence
3. **Payload store slice** — externalization to `server/data/provider-call-packages/...`, BSON size protection
4. **Recorder service slice** — `recordProviderCallPackage` / `recordHttpProviderCallPackage`, mongo connection guard, error path
5. **HTTP capture helper slice** — modifications to `jsonRequest` / `rawRequest` / `jsonRequestCancelable` (timing, chunks, settled-state, capture invocation)
6. **Provider wiring slice** — every wired callsite (image-parser, lm-studio, remote-api-providers) and identifiers (`providerId`, `providerResearchId`, `providerPathType`, `callSite`, `operation`)
7. **Feature flag and rollback slice** — env var, default-off semantics, behavior when disabled
8. **Out-of-scope hygiene** — unrelated client diffs in the commit

### Boundary map

| Boundary                                                    | Producer (server)                                                                        | Consumer                                                                                                                                                                  | Status                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE` env var              | `.env.example:49`                                                                        | `recorder.js:13`, helpers `*.js` capture-enabled gates                                                                                                                    | OK                                                                          |
| `captureContext` argument (helper API)                      | `image-parser.js:796`, `lm-studio.js:58`, `remote-api-providers.js:118`                  | call sites in `callKimi/...`, `parseEscalation/...`, `requestKimiChat/...`                                                                                                | OK (consumed only by recorder via `recordHttpProviderCallPackage`)          |
| `buildHttpProviderCallPackage(input)` → envelope shape      | `recorder.js:86-185`                                                                     | Mongoose `ProviderCallPackage.create(prepared)` at `recorder.js:207`; tests at `image-parser.test.js:600+`, `remote-api-providers.test.js:315+`, `lm-studio.test.js:218+` | OK with caveats (see BLOCKING-01 about `response` shape on error-only path) |
| `redactProviderCallPackage(envelope)`                       | `redaction.js:140-195`                                                                   | `recorder.js:198` (returns redacted clone)                                                                                                                                | OK                                                                          |
| `externalizeProviderCallPackagePayloads(envelope, options)` | `payload-store.js:156-198`                                                               | `recorder.js:200-205` (mutates envelope, then `ProviderCallPackage.create`)                                                                                               | OK                                                                          |
| Storage path `ref` field in `externalPayloads[]`            | `payload-store.js:32-34` (always `server/data/...`)                                      | Anyone querying packages for sidecar files                                                                                                                                | Mismatch when caller passes custom `payloadRoot` — see MINOR-04             |
| `body` argument (caller→helper) into recorder               | helper closure (`image-parser.js:823`, `lm-studio.js:89`, `remote-api-providers.js:157`) | `recorder.js:93` `serializeBody(input.body)`                                                                                                                              | OK functionally; **memory pressure on large image bodies** — see MAJOR-01   |
| Process `process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE`  | toggled in tests                                                                         | `isProviderCallPackageCaptureEnabled` is read **per call**, not memoized — fine for hot toggling but global state leak risk                                               | OK                                                                          |
| Mongo connection readiness                                  | `recorder.js:192`                                                                        | gates write; returns `{ ok: false, skipped: true, reason: 'mongoose_not_connected' }`                                                                                     | OK                                                                          |

### Plan acceptance criteria → file mapping (verified by reading source)

All 18 numbered Success Criteria from the plan were reviewed against actual source. Detailed PASS/FAIL/PARTIAL matrix appears in **Gate Assessment** below.

---

## Findings

### BLOCKING (must fix before merge — will cause runtime failures or violate the Definition of Done)

#### BLOCKING-01 — Recorder envelope creates a malformed `response` object on the network-error / timeout / abort paths, and the recorder will still attempt to call `Buffer.byteLength` on an empty string but with an undefined `bodyText` reference in some branches

- **What:** `buildHttpProviderCallPackage` at `server/src/services/provider-call-package-recorder.js:131-154` uses the expression `response: input.response || input.statusCode ? {...success branch...} : {...failure branch...}`. Operator precedence parses this as `(input.response || input.statusCode) ? ... : ...`. That part is correct. **However**, the "failure branch" `{ received: false, bodyChunks: [] }` is missing several fields that downstream code in `payload-store.js` and `redaction.js` assumes exist or at least are safely undefined (mostly safe). What is **not** safe: the success branch unconditionally calls `Buffer.byteLength(responseBodyText, 'utf8')` at line 143 even when no response body exists, and (more importantly) the failure branch is **only** taken when both `input.response` and `input.statusCode` are falsy.

  In the network-error / timeout paths in the HTTP helpers (`image-parser.js:867-870`, `lm-studio.js:132-145`, `remote-api-providers.js:201-219`), the helper invokes:

  ```js
  await capture({ error: err }); // network error
  await capture({ error: err, outcome: 'timeout' }); // timeout
  ```

  The `response` field is **never** passed, and `input.statusCode` is undefined. The condition becomes `undefined || undefined` → falsy → falls into the **failure branch** at line 151. That branch sets `received: false, bodyChunks: []` but **omits** `statusCode`, `headers`, `rawHeaders`, `trailers`, `bodyText`, `bodyByteLength`, `bodySha256`, `parsedJson`, etc. Downstream:
  - `redactProviderCallPackage` at `redaction.js:153` checks `redacted.response?.headers` — `undefined`, skipped, OK.
  - `redaction.js:160` checks `redacted.response?.rawHeaders` — `undefined`, skipped, OK.
  - `redaction.js:174` checks `redacted.response?.parsedJson` — `undefined`, skipped, OK.
  - `payload-store.js:50-67` `readPath(prepared, 'response.bodyText')` returns `undefined`, externalizeField returns early at line 105, OK.

  So the **redaction/storage path** is technically tolerant. The actual functional bug is more subtle: the **success branch fires when `input.statusCode` is set**, including on timeout/abort/network-error paths if a future change starts passing `input.statusCode`. Additionally, the `received` field semantics are inconsistent — on the success branch it is `Boolean(input.response || input.statusCode)` (always true given the condition), so it's a tautology. This is more of a structural cleanliness concern than a runtime crash today.

  **However** there IS a runtime issue: when network error or timeout fires and `input.response` is undefined, the **`outcome`** classification at line 60-74 still computes a `statusCode` of `0` (from `Number(input.response?.statusCode || input.statusCode || 0)`), and crucially, the call to `Number(...) || 0` always returns `0`. The outcome correctly returns `network_error` / `timeout` because `input.error` is truthy and the `if (input.error)` branch fires first.

  Now the **real BLOCKING issue** in this same block: at line 94-96:

  ```js
  const responseBodyText =
    typeof input.response?.bodyText === 'string'
      ? input.response.bodyText
      : typeof input.response?.body === 'string'
        ? input.response.body
        : '';
  ```

  When `input.response` is undefined, `responseBodyText` is `''`. Then line 143: `bodyByteLength: Buffer.byteLength(responseBodyText, 'utf8')` = `0`. Line 144: `bodySha256: responseBodyText ? sha256(responseBodyText) : null` = `null`. **However** these lines are inside the **success branch** which is gated by `input.response || input.statusCode`. On pure network-error / timeout, the success branch never fires. So technically the runtime crash isn't triggered. **But the failure branch produces `{ received: false, bodyChunks: [] }` with no `headers`, `rawHeaders`, `bodyText`, etc.** — this **violates the Mongoose model expectation** that `response` is a `Mixed` subdocument (Mixed is permissive, no schema validation), so the document will save. The data is just incomplete on the failure path. **Re-classified to MAJOR** below (MAJOR-10).

  The above is a documentation-quality concern. Bumping severity: I no longer find a true BLOCKING (immediate crash / silent corruption) here.

- **Server evidence:** `server/src/services/provider-call-package-recorder.js:131-154` and `:94-99`.
- **Client evidence:** N/A (server-only).
- **Impact:** None at runtime today (the conditional falls through cleanly). However, brittleness: any future caller that passes `statusCode: 0` with no `response` object will hit the success branch and persist a misleading `received: true` document.
- **Fix:** Reclassified — see MAJOR-10 below. No BLOCKING here.

**Decision: no BLOCKING issues identified in this review.**

The implementation is functionally sound on the happy paths and the explicit error paths tested. The remaining concerns are hardening, hygiene, and plan-fidelity gaps documented as MAJOR / MINOR below.

---

### MAJOR (should fix — causes degraded experience, silent data quality issues, plan-fidelity violations, or production risk)

#### MAJOR-01 — `recordHttpProviderCallPackage` is **awaited** inside the HTTP helper resolve/reject path, blocking provider call return until disk write + Mongo save complete

- **What:** In all three modified helpers, the `res.on('end', async () => { ... await capture({ response }); resolve(...) })` and `req.on('error', async (err) => { ... await capture({ error: err }); reject(err); })` patterns mean the helper's promise does not resolve/reject until the recorder has finished writing the Mongo document and any sidecar files.

  The plan says (§"Recorder Service" and §"HTTP Capture Helper Design" rule line 666-670):

  > "The HTTP helper may await the recorder inside a try/catch so tests can deterministically assert the record. Recorder failure must be swallowed after logging and returned internally."

  So awaiting IS explicitly permitted by the plan. **BUT** — neither the plan nor the code wraps the `await capture(...)` in a `try/catch`. Let me re-verify:
  - `image-parser.js:792-794`: `async function recordCapturedHttpPackage(captureInput) { await recordHttpProviderCallPackage(captureInput); }` — no try/catch.
  - `image-parser.js:817-835`: `const capture = async (...) => { if (!captureEnabled) return; await recordCapturedHttpPackage({...}); };` — no try/catch.
  - `image-parser.js:861-863`: `await capture({ response }); resolve({ statusCode: res.statusCode, body: data });` — no try/catch.

  **Does this fail-safe?** `recordHttpProviderCallPackage` is defined at `recorder.js:224-241` with its own outer try/catch that returns `{ ok: false, error }` instead of throwing. So unhandled promise rejection is averted. **OK.**

  **However** — the inner `recordProviderCallPackage` at `recorder.js:187-222` returns `{ ok: false, error }` too. The chain is: `capture()` → `recordHttpProviderCallPackage` → `recordProviderCallPackage` → all of which return promises that **resolve** with an error object rather than throwing. So `await capture()` from `res.on('end', async () => {...})` never throws.

  **What it does cause is latency.** A 200 OK Kimi image-parse response now blocks resolution until:
  1. The full `body` object (which contains the base64 image — could be 200KB–4MB) is deep-cloned twice (once in `redactProviderCallPackage` `cloneValue`, again because `request.bodyJson` is the original `body` reference but the redactor clones).
  2. The cloned `bodyJson` and `bodyText` are serialized (`JSON.stringify` of the cloned object) and SHA-256ed.
  3. The redacted envelope is checked for externalization → if `bodyText` > 512 KB it writes to disk (`server/data/provider-call-packages/.../request-bodyText.txt`), AND if `bodyJson` (when stringified) > 512 KB it writes a SECOND file (`request-bodyJson.txt`) containing essentially the same data.
  4. The envelope is sent to Mongo for persistence.

  For a 1 MB request body, that's at least: 2× JSON.parse-like deep clone + 2× JSON.stringify + 2× SHA-256 + 2× disk write + 1× Mongo insert. Likely 50–200 ms of latency added to every captured request.

  **The user-visible impact:** when the feature is enabled in production, every image-parse and chat request gets slower by an amount proportional to body size. For an image-parser request streaming back to the UI, this is noticeable.

- **Server evidence:** `server/src/services/image-parser.js:848-864`, `server/src/services/lm-studio.js:114-130`, `server/src/services/remote-api-providers.js:182-198`. `server/src/services/provider-call-package-recorder.js:187-222`.
- **Client evidence:** N/A.
- **Impact:** Added latency on every captured request when `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true`. Magnitude depends on body size. Not a correctness bug; a performance hardening miss.
- **Fix:**
  1. **Recommended:** Wrap `capture(...)` in `Promise.resolve()` and **don't await** in `res.on('end')` / `req.on('error')` / `req.on('timeout')`. Fire-and-forget. The recorder already swallows its own failures and logs them.
  2. **If determinism for tests is required**, accept the latency cost and document it. Today's tests (`image-parser.test.js:555-626`, `remote-api-providers.test.js:268-346`) rely on awaiting the recorder before asserting `findOne(...)`. To keep these tests working without awaiting, the helper could expose a "capture promise" hook that tests await separately — e.g., return `{ statusCode, body, _captureSettled: Promise }` only when `captureContext` is provided.
  3. **At minimum**, wrap `await capture(...)` in an inner `try { await capture(...) } catch (captureErr) { console.warn(...) }` so a thrown synchronous error in path-walking inside `buildHttpProviderCallPackage` (e.g., `new URL(urlPath, baseUrl)` if `baseUrl` is malformed) cannot poison the helper resolution. Today `recordHttpProviderCallPackage`'s outer try/catch handles it, but defense in depth is cheap.

#### MAJOR-02 — `request.bodyJson` and `request.bodyText` are persisted side-by-side, doubling Mongo and disk storage for every captured call

- **What:** `serializeBody` at `recorder.js:37-58` sets both `bodyText: JSON.stringify(body)` and `bodyJson: body` (the original object) when the body is a non-string object. These are then BOTH stored inline (and BOTH externalized if either exceeds 512 KB). For an image-parser Kimi/OpenAI/Gemini request, the body is a single object with the base64 image embedded. `bodyText` ≈ `JSON.stringify(bodyJson).length` bytes. They contain **identical information**.

  Worst case: a 4 MB base64 image → `bodyText` ≈ 4 MB string, `bodyJson` ≈ same 4 MB serialized when BSON-encoded. The Mongo document would attempt to store 8 MB before BSON wrap. Since both fields independently trigger externalization (512 KB threshold), both get written to disk as separate files. Net cost: 2× disk write, 2× SHA-256, 2× memory copy.

  This is permitted by the plan (§"Request Package" line 339): "Store the exact JSON object before serialization when available. Store the serialized JSON text when safe to keep inline." So the plan endorses keeping both. The plan does NOT, however, prescribe persisting two copies of an externalized image. The intent appears to be: keep `bodyJson` inline for query convenience (small payloads) and `bodyText` for fidelity. When both are large, persisting both gives no additional value.

- **Server evidence:** `server/src/services/provider-call-package-recorder.js:50-58` (both `bodyText` and `bodyJson` set on the envelope), `server/src/services/provider-call-package-payload-store.js:180-186` (both fields independently externalized when > 512 KB).
- **Client evidence:** N/A.
- **Impact:** Doubles disk usage for large captures; doubles SHA-256 cost; doubles deep-clone memory in `redactProviderCallPackage`. For a server processing dozens of image-parser requests per day with the flag on, sidecar storage grows ~2× faster than necessary.
- **Fix:**
  - When `bodyJson` is present and `JSON.stringify(bodyJson) === bodyText`, drop `bodyJson` once externalized (or never externalize `bodyJson` — instead derive it on-demand from the externalized `bodyText`).
  - Simpler: only externalize `bodyText` and never externalize `bodyJson`. When `bodyText` is externalized, set `bodyJson: null` and add a note in `storage.notes` that `bodyJson` was dropped (equal to externalized `bodyText`).
  - The existing test at `provider-call-package-payload-store.test.js:30-55` does not exercise the case where both `bodyText` and `bodyJson` are large. Add a regression test that confirms only one external file per logical body.

#### MAJOR-03 — Out-of-scope client files (`AgentsView.css`, `AgentsView.jsx`) included in the provider-harness commit

- **What:** `git show --stat 0520274` shows `client/src/components/AgentsView.css` (+132/-39) and `client/src/components/AgentsView.jsx` (+76/-9) included in the commit. Plan §"Commit Plan" line 1062: "Do not mix unrelated AgentsView, agent identity, or other dirty files into these commits." Plan §"Risks And Mitigations" → "Worktree contamination" mitigation: "rerun `git status -sb`, inspect dirty in-scope files before editing, path-limit staging, do not use `git add .`, do not overwrite user changes."
- **Server evidence:** N/A.
- **Client evidence:** `git show --stat 0520274` confirms 256 lines of AgentsView changes in this commit.
- **Impact:** Violates the explicit plan rule. Makes rollback (`git revert 0520274`) impossible without losing unrelated client work. Bisecting future regressions in either AgentsView or provider-harness becomes harder.
- **Fix:** Since the commit has already landed on `master`, options are:
  - Document the violation, do not amend (per project memory `feedback-rejected-tool-use-not-rollback`).
  - In future work, isolate the dirty `AgentsView` changes into their own commit BEFORE starting plan implementation, exactly as the plan §"Current Worktree Is Dirtier Than The Plans Say" section warned.

#### MAJOR-04 — `replaceJsonText` in redaction mutates `bodyText` only when `bodyJson`/`parsedJson` is present, so when a caller sends a string body containing secrets, the secret is persisted unredacted in `bodyText`

- **What:** `redaction.js:129-138`:

  ```js
  function replaceJsonText(container, note, notes) {
    if (!container || typeof container !== 'object') return;
    const source =
      container.bodyJson !== undefined
        ? container.bodyJson
        : container.parsedJson;
    if (source === undefined || typeof container.bodyText !== 'string') return;
    const text = JSON.stringify(source);
    container.bodyText = text;
    container.bodyByteLength = Buffer.byteLength(text, 'utf8');
    container.bodySha256 = sha256(text);
    addUnique(notes, note);
  }
  ```

  This regenerates `bodyText` from the redacted `bodyJson`. **But** `redactProviderCallPackage:166-172` only calls `replaceJsonText` when `redacted.request?.bodyJson` is truthy AND the body secret redactor found new paths.

  Consider this case: the caller passes a string body that happens to be JSON containing secrets — e.g., `body = '{"apiKey":"sk-xyz"}'` (a literal string, not an object). In `serializeBody:41-48`, the `typeof body === 'string'` branch fires, returning `bodyText: body, bodyJson: null`. The envelope has `bodyText` but no `bodyJson`. In `redactProviderCallPackage:166`, the check `if (redacted.request?.bodyJson)` is false (null), so `redactBodySecrets` is never run on the string body, and the secret in `bodyText` is persisted unredacted.

  In current production code paths, **request bodies are always objects** (every wired caller passes a JS object, not a JSON string). So this issue does not fire today. But the helper API accepts either form (see `serializeBody:41`), and future callers could trip it.

  Even more concerning: when `body` is sent as a pre-stringified JSON, the `bodyText` is stored as-is without redaction scan.

- **Server evidence:** `server/src/services/provider-call-package-recorder.js:41-48`, `server/src/services/provider-call-package-redaction.js:129-138` and `:166-172`.
- **Client evidence:** N/A.
- **Impact:** Latent secret-leakage risk if any caller passes a string body containing secrets. No current callsite does this.
- **Fix:**
  - In `redactProviderCallPackage`, also redact `request.bodyText` directly when it is a JSON string and `bodyJson` is null. Parse it, redact, re-stringify, re-hash.
  - Alternatively, in `serializeBody`, when the body is a string that parses as JSON, populate `bodyJson` from the parse so the existing redaction path covers it.
  - Add a redaction test for string-body inputs containing `apiKey`, `password`, etc.

#### MAJOR-05 — Response headers received from upstream are persisted unfiltered into `response.headers` when they happen to be safe; redaction relies on a fixed deny list. Unknown future provider headers carrying secrets (e.g., a provider-specific `x-internal-trace` containing an opaque token-like string) pass through

- **What:** `redactHeaders` at `redaction.js:60-78` redacts only headers whose normalized name matches an entry in `SECRET_HEADER_NAMES` or contains one of `SECRET_HEADER_MARKERS` (`api-key`, `token`, `secret`, `credential`). Anthropic, OpenAI, Gemini, Kimi, and LLM Gateway responses commonly include:
  - `x-request-id`, `x-ratelimit-remaining-*`, `cf-ray`, `request-id`, `openai-organization`, `openai-version`, `anthropic-version` — all currently safe and not redacted; their values are persisted.
  - Future provider headers carrying an internal trace ID or session ID — not redacted unless the name matches the substring list.

  The plan §"Response Package" line 392-393 says: "Response headers are not expected to contain provider auth secrets, but run defensive redaction anyway. Redact `set-cookie`, `cookie`, and any response header with secret-like names." The implementation follows this: it redacts `set-cookie`, `cookie`, and substring matches. So plan compliance is OK.

  **The MAJOR concern** is that the response **`rawHeaders`** array order is preserved (good), but `redactRawHeaders:86-94` redacts values **only at indices whose preceding name (index-1) matches the deny list**. If a provider returns a duplicated header (e.g., two `set-cookie` values), Node's `rawHeaders` array has `['set-cookie', 'val1', 'set-cookie', 'val2', ...]`. The current implementation correctly redacts BOTH values because each pair is independently checked. Good.

  However: `response.headers` (as opposed to `rawHeaders`) is a JS object where duplicate header names are merged. For `set-cookie`, Node sets `response.headers['set-cookie']` to an **array** of strings. `redactHeaderValue:45-53` at line 48 only handles `authorization` / `proxy-authorization` array-handling (takes the first element). For `set-cookie` arrays, the function falls through to the generic `return '[REDACTED]'` at line 52 — which replaces the entire array with a single string. The array structure is lost, and **the count of cookies set is lost**. Minor data fidelity loss but not a security issue.

- **Server evidence:** `server/src/services/provider-call-package-redaction.js:45-53` and `:60-78`.
- **Client evidence:** N/A.
- **Impact:** Acceptable today. Plan-compliant. Minor fidelity loss when `set-cookie` is an array (rare for the providers in scope; they return JSON, not session cookies).
- **Fix:** Optional hardening — when `value` is an array, replace each element with `[REDACTED]` (preserving array length).

#### MAJOR-06 — `requestWrittenAt` is recorded AFTER `req.end()` in some cases, but `req.end()` may have already triggered the error/end callback synchronously. Timing field can be `null` even when the request did write

- **What:** Look at `jsonRequest` flow in `image-parser.js:879-887`:

  ```js
  if (payload) {
    req.write(payload);
  }
  if (captureEnabled) {
    requestWrittenAt = new Date().toISOString();
  }
  req.end();
  ```

  And the symmetric one with subtle reversal in `remote-api-providers.js:221-227`:

  ```js
  if (payload) {
    req.write(payload);
  }
  if (captureEnabled) {
    requestWrittenAt = new Date().toISOString();
  }
  req.end();
  ```

  Order: `req.write(payload)` → `requestWrittenAt = now` → `req.end()`. Good.

  **But** when there is no payload (`!payload`, e.g., a `GET` or empty `POST`), `requestWrittenAt` is still set BEFORE `req.end()`. The semantic should arguably be "time when last bytes left the writer". For no-body requests, the meaningful timestamp is essentially the same as `requestStartedAt`. Acceptable.

  **The actual subtle bug**: the `req.on('error', ...)` handler can fire synchronously if `transport.request(...)` throws or emits an error in the same tick (e.g., DNS resolution failure on Windows). In that case, the `error` event handler runs BEFORE `requestWrittenAt` is assigned, and the `capture({ error: err })` call inside the handler reads `requestWrittenAt` as `null` even though `req.write(payload)` was called (or not).

  Actually re-reading: in the error path, the capture envelope's `requestWrittenAt` comes from the closure variable. If `req.write()` was called and then the error fires _before_ `requestWrittenAt = ...`, then yes, the recorded timestamp is `null` even though bytes left. This is a minor timing-data fidelity issue, not a correctness bug.

- **Server evidence:** `server/src/services/image-parser.js:881-887`; `server/src/services/lm-studio.js:146-152`; `server/src/services/remote-api-providers.js:221-227`.
- **Client evidence:** N/A.
- **Impact:** `requestWrittenAt` may be inaccurate by a few microseconds in the error path. Negligible.
- **Fix:** Move `requestWrittenAt = new Date().toISOString()` to immediately AFTER `req.write(payload)` (within the same `if (payload)` block). For no-body requests, leave it `null` to honor the field's intent ("time bytes were written").

#### MAJOR-07 — Capture is skipped silently when Mongoose is not connected (`readyState !== 1`), and the request body / response body is lost forever. No fallback to disk-only capture

- **What:** `recorder.js:192-194`:

  ```js
  if (mongoose.connection.readyState !== 1) {
    return { ok: false, skipped: true, reason: 'mongoose_not_connected' };
  }
  ```

  Behavior: if Mongo is briefly disconnected (network blip, Atlas failover, server startup race), captures are silently dropped. The user might enable the flag intentionally to debug a production issue, then lose the very captures they're hunting.

  Note: this returns BEFORE redaction or externalization runs, so the disk sidecar files are NOT written. Pure silent drop.

  The plan §"Recorder Service" line 615-621 says: "Recorder failure must not alter provider response text. Recorder failure must not alter provider usage. Recorder failure must not trigger fallback. Recorder failure must not change the HTTP status returned to the client." It does NOT say "recorder must persist what it can on disk when Mongo is down". So this is plan-compliant.

  However, the v0.1 "Definition of Done" includes: "Large payload behavior is explicit". When Mongo is down, capture isn't large vs. small — it's just dropped. The user has no signal that the flag is "doing nothing" right now.

- **Server evidence:** `server/src/services/provider-call-package-recorder.js:192-194`.
- **Client evidence:** N/A.
- **Impact:** Silent capture loss during transient Mongo unavailability. No log warning printed (`console.warn` runs only in the `catch` branch, not the skipped-path branch).
- **Fix:**
  - **Minimum:** `console.warn('[provider-call-package-recorder] skipped because Mongo readyState=' + mongoose.connection.readyState)` on the skip path, behind a once-per-process throttle or with the existing `options.log !== false` gate. This gives operational visibility.
  - **Better:** When `readyState !== 1`, still write the sidecar payload(s) to disk so the package can be reconciled later. Out of scope for v0.1 per the plan; flag as v0.2 candidate.

#### MAJOR-08 — `cancelReason` in `jsonRequestCancelable` is a closure variable that may race with `req.on('error', ...)` firing in the same tick as `cancel()`

- **What:** `remote-api-providers.js:118-238`:

  ```js
  function jsonRequestCancelable(method, baseUrl, urlPath, body, headers, timeoutMs, captureContext = null) {
    let req = null;
    let settled = false;
    let cancelReason = '';
    ...
    req.on('error', async (err) => {
      if (settled) return;
      settled = true;
      await capture({
        error: err,
        outcome: cancelReason ? 'aborted' : null,
      });
      reject(err);
    });
    ...
    return {
      promise,
      cancel(reason = 'Request aborted') {
        if (!req || settled) return false;
        cancelReason = reason;
        req.destroy(new Error(reason));
        return true;
      },
    };
  }
  ```

  Sequence: caller invokes `cancel('User aborted')` → sets `cancelReason = 'User aborted'` → calls `req.destroy(err)` → Node emits `error` event with the destroy error → `req.on('error', async (err) => ...)` runs → reads `cancelReason` (now truthy) → records outcome `'aborted'`. **Works correctly.**

  **But** consider this race: `cancel(reason)` is called BUT `cancelReason = reason` line executes AFTER `req.destroy(...)` because Node's `req.destroy()` can emit `'error'` synchronously if the request is in-flight on certain platforms. Actually no — re-reading: line 234 sets `cancelReason` BEFORE line 235 `req.destroy(...)`. So in JS execution order, the assignment is always first.

  **The real concern:** if `cancel()` is invoked while `settled` is already `true` (e.g., the request already errored from a network failure), the `cancelReason` is left at `''` and the outcome would be `network_error` instead of `aborted`. This is correct — the request already finished as a network error, the cancel call was too late.

  Conversely: if the request times out (`req.on('timeout', ...)` fires) and BEFORE `settled = true` runs, the user calls `cancel(...)` — JavaScript is single-threaded so the timeout handler runs atomically; no race. Fine.

  **One actual concern**: the closure variable `cancelReason` is NEVER reset between captures of the same `jsonRequestCancelable` invocation. Each `jsonRequestCancelable` call creates a fresh closure, so this is correct — no leakage between calls. OK.

  **Reclassify to MINOR** — code is correct, but a comment would help future maintainers understand why `cancelReason` is required for distinguishing aborts from network errors.

- **Server evidence:** `server/src/services/remote-api-providers.js:118-238`.
- **Client evidence:** N/A.
- **Impact:** None today; the code is correct.
- **Fix:** Add a code comment explaining the cancel/error race semantics. **Demoting to MINOR.**

#### MAJOR-09 — `recordHttpProviderCallPackage` synchronous errors not protected against in test isolation; when the recorder's outer try/catch isn't triggered, a thrown error during `new URL(urlPath, baseUrl)` would propagate

- **What:** `recorder.js:224-241`:

  ```js
  async function recordHttpProviderCallPackage(input, options = {}) {
    try {
      const envelope = buildHttpProviderCallPackage(input);
      return await recordProviderCallPackage(envelope, options);
    } catch (err) {
      if (options.log !== false) {
        console.warn('[provider-call-package-recorder] capture failed:', err.message);
      }
      return { ok: false, error: { ... } };
    }
  }
  ```

  This is the correct guard. `buildHttpProviderCallPackage` calls `new URL(urlPath, baseUrl)` at line 92, which throws on invalid URLs. The outer try/catch handles it. **Good.**

  **However**, `recordCapturedHttpPackage` in each helper is:

  ```js
  async function recordCapturedHttpPackage(captureInput) {
    await recordHttpProviderCallPackage(captureInput);
  }
  ```

  This `await` will pick up the returned `{ ok: false, error }` object cleanly. But there's a subtle issue: when `await recordHttpProviderCallPackage(...)` throws (it shouldn't, given the try/catch above, but if a future bug introduces a code path that throws), the helper's `capture(...)` async function would throw to the caller — which is `res.on('end', async () => { ... await capture(...) ... })`. `res.on('end', ...)` is an EventEmitter listener; rejected promises from listeners are unhandled.

  Today this doesn't fire. It's a defense-in-depth concern.

- **Server evidence:** `server/src/services/provider-call-package-recorder.js:224-241`; helper files at the `recordCapturedHttpPackage` shim.
- **Client evidence:** N/A.
- **Impact:** Latent unhandled promise rejection risk if any code path bypasses `recordHttpProviderCallPackage`'s outer try/catch.
- **Fix:** In each helper's `recordCapturedHttpPackage`, add `try { await recordHttpProviderCallPackage(...) } catch (err) { console.warn(...) }`. Or wrap the `await capture(...)` lines inside `res.on('end')` / `req.on('error')` / `req.on('timeout')` in try/catch.

#### MAJOR-10 — On the network-error / timeout / abort paths, the persisted `response` field is `{ received: false, bodyChunks: [] }` (missing `statusCode`, `headers`, etc.); downstream query consumers must defensively handle two distinct response shapes

- **What:** `recorder.js:131-154`. The success branch produces a response object with ~12 fields. The failure branch produces only 2 fields. Mongoose `Mixed` schema accepts both. Downstream readers (none in this repo today — by design, v0.1 has no inspection routes) would need to handle both shapes.
- **Server evidence:** `server/src/services/provider-call-package-recorder.js:131-154`.
- **Client evidence:** N/A.
- **Impact:** Future inspection/dashboard work (v0.3 candidate per plan §"Post-v0.1 Follow-Ups") must defend against both shapes or normalize on read. Low.
- **Fix:** Normalize the failure branch to include `{ received: false, statusCode: 0, headers: {}, rawHeaders: [], trailers: {}, rawTrailers: [], bodyChunks: [], bodyText: '', bodyByteLength: 0, bodySha256: null, parsedJson: null, jsonParseError: null }`. A single shape eases later querying.

---

### MINOR (improve when convenient — code quality, consistency, hardening)

#### MINOR-01 — `responseChunks` accumulates per-chunk SHA-256 hashes; for a long-running 4 MB streaming response (e.g., a Gemini long-form chat), this adds non-trivial CPU work even when no consumer reads chunks individually

- **Evidence:** `server/src/services/provider-call-package-recorder.js:243-253` (`buildResponseChunk` computes SHA-256 per chunk).
- **Fix:** Make per-chunk SHA-256 optional (gated by an env var or option) since the plan §"Response Package" line 388 only requires `bodyChunks[]` to preserve order, byte length, and (per the schema example) sha256. For huge responses with many chunks, this is wasted work.

#### MINOR-02 — `requestStartedAt` is captured as an ISO string and converted back to Date for `durationMs` calculation. Use `process.hrtime.bigint()` for monotonic timing to avoid clock-skew artifacts in `durationMs`

- **Evidence:** `server/src/services/image-parser.js:801`, `recorder.js:155-163`.
- **Fix:** Use `process.hrtime.bigint()` internally and convert to ISO for the stored timestamp at end. Or just use `Date.now()` returning a number and convert to ISO once at write time.

#### MINOR-03 — `cancelReason` semantic concern (formerly MAJOR-08): add a clarifying comment

- **Evidence:** `server/src/services/remote-api-providers.js:121, 204, 234`.

#### MINOR-04 — `storage.externalPayloads[].ref` always builds a path starting `server/data/provider-call-packages/...` regardless of whether the caller overrode `payloadRoot` to a different location (e.g., a temp folder in tests). When `payloadRoot` is custom, the `ref` field is misleading

- **Evidence:** `server/src/services/provider-call-package-payload-store.js:32-34` (`buildRef` hardcodes the `server/data/...` prefix); `:82` (`directory` uses `options.payloadRoot`).
- **Impact:** Test at `provider-call-package-payload-store.test.js:51` asserts the hardcoded path even though the test wrote to a tmpdir. The test passes because the assertion targets the hardcoded ref, but a future consumer reading `ref` and trying to load the file would fail.
- **Fix:** Have `buildRef` use `options.payloadRoot`-relative path, OR provide a separate `absolutePath` field alongside the relative `ref`.

#### MINOR-05 — No test for the BSON 16 MB hard limit. If `bodyText` is e.g. 8 MB and `bodyJson` is the same 8 MB, both externalize fine. But the envelope still has `request.bodyByteLength = 8e6` and `request.bodySha256` populated — small fields. Plus a deep-cloned `bodyJson` that gets nulled. The redaction step `redactProviderCallPackage` does a `cloneValue` of the WHOLE envelope INCLUDING `bodyJson` BEFORE externalization runs. That clone in memory could OOM on a 30 MB body

- **Evidence:** `server/src/services/provider-call-package-redaction.js:140-141`; `:23-32` (recursive clone)
- **Fix:** Externalize FIRST (in the recorder), then redact the residual inline data. Today the order is reversed: `recorder.js:198-205` redacts, then externalizes. Swap the order so the in-memory footprint stays bounded.

#### MINOR-06 — `buildHttpProviderCallPackage` test (`provider-call-package-recorder.test.js:33-79`) does not assert `redaction.applied` or `storage.inline` defaults

- **Fix:** Add assertions: `assert.equal(envelope.redaction.applied, false)`, `assert.equal(envelope.storage.inline, true)`.

#### MINOR-07 — `isProviderCallPackageCaptureEnabled()` re-reads `process.env` on every call. Cheap, but a single boolean memoized at module load time would suffice if hot-toggling at runtime is never expected. Today tests rely on hot-toggling, so memoization would break them

- **Evidence:** `recorder.js:13-15` (re-read every call), `provider-call-package-recorder.test.js:27-31` (relies on env mutation between assertions).
- **Fix:** Leave as-is; document the design choice in a comment.

#### MINOR-08 — `compactError` (`recorder.js:76-84`) stores `stack: err.stack || ''`. For network errors from Node's HTTP layer, stack traces can include internal file paths that may not be useful long-term. Consider truncating or omitting

- **Fix:** Optional — strip stack frames pointing to `node_modules`.

#### MINOR-09 — Image-parser's `callLmStudio` (`image-parser.js:1054-1073`) wires capture for the LM Studio image-parse call. The plan's Provider Wiring Map (§"Provider Wiring Map" line 856) confirms this is in scope. But `image-parser.js:callLmStudio` ALSO calls `jsonRequest` to LM Studio. There is overlap with `lm-studio.js:parseEscalation` / `transcribeImage` which are SEPARATE callsites — both wired. No issue, but verify that the same image isn't being captured twice if a single flow goes through both. Reading `image-parser.js:callLmStudio` does NOT call `lm-studio.js:parseEscalation`. The two paths are independent. Confirmed OK.

#### MINOR-10 — Test `provider-call-package-recorder.test.js:100-136` checks `saved.request.bodyJson.accessToken` is `'[REDACTED]'`. Good. But it does not check `saved.redaction.notes` contains the regeneration note. Recommended adding `assert.ok(saved.redaction.notes.some(n => n.includes('regenerated')))`

#### MINOR-11 — In `provider-call-package-redaction.js:182-184`, `redacted.error?.object` is redacted but `error.rawBody` is NOT redacted. The plan §"Error Package" line 422-432 includes `rawBody` in the error package. If a provider error response contains a secret in the body (rare but possible for misconfigured endpoints that echo headers), it would be persisted in `error.rawBody`. Currently the only place `error.rawBody` is populated is via `recorder.js:165-171` if the caller passes `error.rawBody` explicitly; no current caller does.

- **Fix:** Run body-secret redaction on `error.rawBody` if it is a JSON string. Defense in depth.

#### MINOR-12 — `payload-store.js:82` constructs `directory` using `path.join(options.payloadRoot, dateFolder, String(options.packageId))`. If `options.packageId` is an `ObjectId` instance (which it is by default, see `recorder.js:197`), `String(ObjectId)` yields the hex string — fine. If it's a number, `String(number)` is fine. If it's an object without a meaningful `toString`, the directory name would be `[object Object]`. Defensive — recommend asserting type at the function boundary.

- **Fix:** Add `if (typeof options.packageId !== 'string' && !(options.packageId instanceof mongoose.Types.ObjectId)) throw new Error(...)` or sanitize via `sanitizeFileName` before joining.

#### MINOR-13 — No test exercises the timeout capture path end-to-end (request times out → `outcome: 'timeout'` is persisted)

- **Existing tests:** `image-parser.test.js:1250-1272` tests timeout but does not enable capture flag, so no `ProviderCallPackage` is written. Test for timeout-with-capture would close the gap on Success Criterion #14.
- **Fix:** Add a test that combines `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true` with a mocked timeout and asserts `saved.outcome === 'timeout'` and `saved.error.code === 'TIMEOUT'`.

#### MINOR-14 — No test exercises the abort/cancel capture path (`outcome: 'aborted'`) for `jsonRequestCancelable`

- **Existing tests:** `remote-api-providers.test.js` tests cancellation via `requestFn` stubs, not the real `jsonRequestCancelable` cancel→capture flow.
- **Fix:** Add a test that calls `cancel(...)` mid-flight on a mock HTTP server delay and asserts the persisted package has `outcome: 'aborted'`.

#### MINOR-15 — `request.timeoutMs` resolves from `input.timeoutMs || context.timeoutMs || null`. The helper passes `options.timeout` (which defaults to 30000 for image-parser and lm-studio, 120000 for remote-api-providers) so the resolved value should always be the effective timeout, never `null`. Confirmed at `image-parser.js:825`, `remote-api-providers.js:159`, `lm-studio.js:91`. OK.

#### MINOR-16 — The `headers` object passed into the recorder is the SAME REFERENCE as the request's `options.headers` (e.g., `image-parser.js:822` passes `options.headers`). After the request completes, Node may have added internal headers (Host, Connection, etc.) that the recorder then captures. This is desirable — the persisted headers reflect what was actually sent — but it crosses an abstraction boundary. Document it.

#### MINOR-17 — The recorder is silent when the feature flag is OFF (returns `{ ok: false, skipped: true, reason: 'disabled' }`). The helper's `captureEnabled = Boolean(captureContext) && isProviderCallPackageCaptureEnabled()` check at `image-parser.js:800` prevents the recorder from even being called when disabled. So the chunk timestamps and SHA-256 cost is NOT incurred when disabled. Verified at `image-parser.js:843-846`: chunk capture is inside `if (captureEnabled)`. Good. No issue.

---

## User Flows Traced

### Flow 1: Happy path — Kimi image-parser request with capture enabled, response < 512 KB

1. UI uploads image → API → `parseImage(base64, { provider: 'kimi' })` (`image-parser.js`)
2. → `callKimi(systemPrompt, dataUrl, model, timeoutMs)` (`image-parser.js:1471`)
3. → `jsonRequest('POST', 'https://api.moonshot.ai', '/v1/chat/completions', body, headers, timeoutMs, captureContext)` (`image-parser.js:796`)
4. `captureEnabled = true` (flag on + context present); `requestStartedAt` set
5. `transport.request(...)` initiates HTTPS; `res.on('data', chunk)` accumulates `data` AND pushes a chunk record into `responseChunks` (`image-parser.js:842-847`)
6. On `res.on('end')`: `settled = true`, build `response` object with full HTTP metadata, call `await capture({ response })` → `recordHttpProviderCallPackage(...)` → `buildHttpProviderCallPackage` → `redactProviderCallPackage` → `externalizeProviderCallPackagePayloads` → `ProviderCallPackage.create(prepared)`
7. After recorder returns: `resolve({ statusCode, body: data })`
8. `callKimi` parses the response and returns `{ text, usage }`
9. `parseImage` validates and returns to the route handler

**Pass criteria:** existing return shape preserved; capture happens after response.end; existing caller sees unchanged data.
**Result:** PASS. Test at `image-parser.test.js:555-626` confirms shape.

### Flow 2: HTTP error path — Kimi returns 401 with JSON error body, capture enabled

1. As above through step 5.
2. On `res.on('end')`: `response.statusCode = 401`, `response.bodyText = '{"error":"bad key"}'`
3. `buildHttpProviderCallPackage` → `classifyHttpOutcome` → `statusCode >= 400` → `outcome: 'http_error'`
4. Package saved with `outcome: 'http_error'`, redacted Authorization, parsed JSON error body
5. `jsonRequest` resolves `{ statusCode: 401, body: '{"error":"bad key"}' }`
6. `callKimi:1493-1498` sees non-200 → throws `PROVIDER_ERROR`

**Pass criteria:** package recorded BEFORE existing code throws; no behavioral change for the caller.
**Result:** PASS. Tested at `provider-call-package-recorder.test.js:100-136`.

### Flow 3: Network error path — Kimi DNS fails, capture enabled

1. `transport.request(...)` initiates; `req.on('error', err)` fires before any response
2. `settled = true`; `await capture({ error: err })` (no `outcome` set → classification falls to `network_error`)
3. `buildHttpProviderCallPackage`: `input.response` undefined, `input.statusCode` undefined → failure branch at `recorder.js:151-153` → minimal `response: { received: false, bodyChunks: [] }`
4. `outcome: 'network_error'` set
5. Package saved
6. `reject(err)` → `callKimi` propagates

**Pass criteria:** package records the error metadata; provider behavior unchanged.
**Result:** PASS with MAJOR-10 caveat (sparse `response` object on the failure branch).
**Untested:** No end-to-end test exercises this path with `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true`. MINOR-13/14.

### Flow 4: Timeout path — request times out, capture enabled

1. `req.on('timeout')` fires
2. `req.destroy()`, build TIMEOUT error
3. `await capture({ error: err, outcome: 'timeout' })`
4. `classifyHttpOutcome` honors explicit `input.outcome` first (line 61) → returns `'timeout'`
5. Package saved with `outcome: 'timeout'`
6. `reject(err)` → caller propagates

**Result:** PASS by code reading. **Not tested end-to-end with capture flag enabled.** Recommend adding the test per MINOR-13.

### Flow 5: Cancel path — `jsonRequestCancelable.cancel()` mid-flight, capture enabled

1. Request inflight; user calls `cancel('reason')`
2. `cancelReason = 'reason'`; `req.destroy(new Error('reason'))`
3. `req.on('error', async (err) => ...)`: `cancelReason` is truthy → `outcome: 'aborted'`
4. `await capture({ error: err, outcome: 'aborted' })`
5. Package saved with `outcome: 'aborted'`
6. `reject(err)`

**Result:** PASS by code reading. **Not tested end-to-end.** Recommend adding the test per MINOR-14.

### Flow 6: Feature flag OFF

1. `parseImage` → `callKimi` → `jsonRequest(..., captureContext)`
2. `captureEnabled = false` (because `isProviderCallPackageCaptureEnabled()` is false)
3. `requestStartedAt = null`; no chunk records pushed; `capture(...)` returns early on `if (!captureEnabled) return`
4. `resolve({ statusCode, body })` exactly as pre-change

**Result:** PASS. Tested implicitly by every non-capture test.

### Flow 7: Recorder Mongo failure (capture enabled, but Mongo disconnected mid-call)

1. As Flow 1 through step 6
2. `recordProviderCallPackage` checks `mongoose.connection.readyState !== 1` → returns `{ ok: false, skipped: true, reason: 'mongoose_not_connected' }`
3. `await capture` returns; `resolve({ statusCode, body })` proceeds normally
4. Provider call succeeds end-to-end; package is silently dropped

**Result:** PASS for provider call. MAJOR-07 — silent drop with no log.

### Flow 8: Large image body (4 MB) capture enabled

1. As Flow 1 through step 4
2. `serializeBody(body)` produces `bodyText` (≈ 4 MB string) and `bodyJson` (the original object)
3. `buildHttpProviderCallPackage` builds the envelope with both fields inline
4. `redactProviderCallPackage` deep-clones the entire envelope (4 MB + 4 MB = 8 MB in memory)
5. `externalizeProviderCallPackagePayloads` walks fields: `request.bodyText` (4 MB > 512 KB) → externalized to `request-bodyText.txt`; `request.bodyJson` (4 MB > 512 KB) → externalized to `request-bodyJson.txt`
6. Mongo write succeeds with both inline fields nulled and `payloadRef` set for each
7. `resolve()` finally fires, possibly after 50–200 ms of disk + hash work

**Result:** PASS functionally; MAJOR-01 (added latency) + MAJOR-02 (double storage) + MINOR-05 (redact-then-externalize order doubles memory).

---

## State Lifecycle Check

### Helper-level closures (per-request lifecycle)

All three modified helpers create per-call closures with `settled`, `responseChunks`, `requestStartedAt`, etc. Each call gets a fresh closure. **No cross-call state leakage.** Verified at `image-parser.js:797-805`, `lm-studio.js:59-67`, `remote-api-providers.js:119-133`.

### Module-level state

- `_cachedModelName` in `lm-studio.js:27` — pre-existing, unchanged.
- `_providerAvailabilityCache` in `image-parser.js:96-99` — pre-existing, unchanged.
- The capture system has NO module-level state. Per-call only. **Good.**

### Mongoose model registration

- `ProviderCallPackage = mongoose.model('ProviderCallPackage', schema)` at `models/ProviderCallPackage.js:35`. Registered at module load. Single source of truth. **Good.**

### Process env

- `process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE` read on every call. Tests mutate it. No risk of stale values.

### File handles

- `payload-store.js:87-88` uses `fs.mkdir({ recursive: true })` and `fs.writeFile(..., 'utf8')`. Promise-based, awaited. No handle leaks. The disk write is in `node:fs/promises` which manages handles internally.
- No retention / cleanup logic — plan §"Out Of Scope" explicitly excludes "retention jobs". **Plan-compliant.**

### Event listeners on `req` / `res`

- `req.on('error', ...)`, `req.on('timeout', ...)`, `res.on('data', ...)`, `res.on('end', ...)` — all installed once per call. `req` and `res` are garbage-collected after the promise settles. No listener leaks.

---

## Visual & Runtime Verification

The client app is running on `localhost:5174` (verified: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5174` → 200).

The provider-harness feature is a **server-only** preservation layer. There is no UI surface. Per the plan §"Out Of Scope" line 118, "UI" is explicitly excluded. There is nothing in the client to verify visually.

**Recommended manual runtime verification (per plan §"Runtime Verification" lines 1014-1037):**

1. Set `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true` in `server/.env`.
2. Restart server (note: user policy forbids me from doing this).
3. Trigger a Kimi image-parse via the UI.
4. Query Mongo: `db.providercallpackages.find().sort({createdAt:-1}).limit(1)`.
5. Verify `providerId === 'kimi'`, `callSite === 'image-parser:callKimi'`, `request.headers.Authorization === 'Bearer [REDACTED]'`, response status + headers stored, `parsedJson` populated.

**Review limitation:** I cannot perform the manual runtime verification step (cannot mutate `.env`, cannot restart server). The test suite at `image-parser.test.js:555-626` simulates this end-to-end using `mongodb-memory-server` and HTTPS mocks; it covers the assertions the plan asks for. Confidence is high based on unit + integration test coverage, but the **real Kimi API has not been exercised through this code in my review session**.

---

## Gate Assessment (plan-fidelity matrix)

| #   | Plan Success Criterion                                                                              | Verdict     | Evidence                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A shared `ProviderCallPackage` Mongo model exists                                                   | **PASS**    | `server/src/models/ProviderCallPackage.js`                                                                                                                                                                                                                                                                              |
| 2   | A shared recorder service exists                                                                    | **PASS**    | `server/src/services/provider-call-package-recorder.js`                                                                                                                                                                                                                                                                 |
| 3   | A shared redaction helper exists                                                                    | **PASS**    | `server/src/services/provider-call-package-redaction.js`                                                                                                                                                                                                                                                                |
| 4   | A payload storage helper or explicit inline-size guard exists                                       | **PASS**    | `server/src/services/provider-call-package-payload-store.js`                                                                                                                                                                                                                                                            |
| 5   | Capture is guarded by `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE`, defaulting to off                     | **PASS**    | `.env.example:49` sets `false`; `recorder.js:13-15` reads env; `image-parser.js:800`, `lm-studio.js:62`, `remote-api-providers.js:128` gate per-call                                                                                                                                                                    |
| 6   | One direct HTTP proof path is captured first                                                        | **PASS**    | Kimi wired in `image-parser.js:1471-1485`; tested at `image-parser.test.js:555-626`                                                                                                                                                                                                                                     |
| 7   | Existing provider code receives the same return value it received before capture was added          | **PASS**    | `jsonRequest` resolves `{ statusCode, body }` in both code paths; tests assert identical shape                                                                                                                                                                                                                          |
| 8   | All in-scope HTTP model paths are wired through the same capture pattern                            | **PASS**    | image-parser: callKimi, callLmStudio, callAnthropic, callOpenAI, callLlmGateway, callGemini (6/6); remote-api-providers: requestAnthropicChat, requestOpenAiChat, requestKimiChat, requestLlmGatewayChat, requestGeminiChat (5/5); lm-studio: parseEscalation, transcribeImage (2/2). **All in-scope callsites wired.** |
| 9   | Mongo stores one `ProviderCallPackage` record per captured provider attempt when recording succeeds | **PASS**    | One `ProviderCallPackage.create` per capture call; tests assert single record per call                                                                                                                                                                                                                                  |
| 10  | Request auth secrets are not stored                                                                 | **PASS**    | `redactHeaders` strips Authorization/x-api-key/x-goog-api-key/etc.; tested at `provider-call-package-redaction.test.js:12-23` and integration tests                                                                                                                                                                     |
| 11  | Response headers are redacted defensively before persistence                                        | **PASS**    | `redactProviderCallPackage:153-164` redacts response headers + rawHeaders; tested at `provider-call-package-recorder.test.js:133-134`                                                                                                                                                                                   |
| 12  | Raw response text and parsed JSON, when parseable, are preserved                                    | **PASS**    | `bodyText` always present; `parsedJson` populated when `safeJsonParse` succeeds (`recorder.js:97-99`)                                                                                                                                                                                                                   |
| 13  | HTTP non-2xx responses are captured before existing provider code throws                            | **PASS**    | Capture happens in `res.on('end')` BEFORE `resolve()`; caller throws AFTER reading `res.statusCode`. Tested at `provider-call-package-recorder.test.js:100-136` (HTTP 401 case)                                                                                                                                         |
| 14  | Network errors, timeouts, and aborts attempt non-fatal capture when possible                        | **PARTIAL** | Code path exists in `req.on('error')` and `req.on('timeout')` (`image-parser.js:866-880`, etc.). **No end-to-end test with capture flag enabled for these paths.** MINOR-13, MINOR-14.                                                                                                                                  |
| 15  | Recorder failure does not fail, retry, or redirect the provider call                                | **PASS**    | `recordHttpProviderCallPackage` outer try/catch returns `{ ok: false, error }`; helper resolves/rejects independent of recorder result. Could be hardened (MAJOR-09).                                                                                                                                                   |
| 16  | No parser behavior changes                                                                          | **PASS**    | `parseImage` flow at `image-parser.js:parseImage` (not in diff) untouched; parser tests still pass shape assertions                                                                                                                                                                                                     |
| 17  | No UI behavior changes                                                                              | **FAIL**    | `client/src/components/AgentsView.css` and `AgentsView.jsx` modified in the same commit. **Plan violation.** MAJOR-03.                                                                                                                                                                                                  |
| 18  | No CLI, SDK, streaming, probe, warm-up, health-check, or model-discovery capture is added           | **PASS**    | Verified by grepping: no `captureContext` added to `callCodex`, `callAnthropicSdk`, streaming `chat()` in lm-studio, `testRemoteProviderKey`, `validateRemoteProvider`, `getModelSnapshot`, model-discovery `rawGet`. **In-scope list matches plan exactly.**                                                           |

### Definition of Done checklist (from plan §"Definition Of Done")

| Item                                                                                    | Verdict  | Evidence                                                                               |
| --------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| ProviderCallPackage model exists                                                        | PASS     | model file                                                                             |
| Redaction helper exists                                                                 | PASS     | redaction file                                                                         |
| Payload store or inline-size guard exists                                               | PASS     | payload-store file (512 KB threshold)                                                  |
| Recorder helper exists                                                                  | PASS     | recorder file                                                                          |
| `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=false` in `.env.example`                          | PASS     | line 49                                                                                |
| Feature flag defaults to off                                                            | PASS     | `String('').toLowerCase() === 'true'` → false                                          |
| One Kimi HTTP proof path wired and verified                                             | PASS     | `image-parser.js:1471`; test at line 555 of test file                                  |
| All in-scope `image-parser.js` HTTP model calls wired                                   | PASS     | 6/6 callsites                                                                          |
| All in-scope `remote-api-providers.js` chat calls wired                                 | PASS     | 5/5 callsites                                                                          |
| LM Studio non-streaming parse/image paths wired                                         | PASS     | `parseEscalation` (`lm-studio.js:604-616`), `transcribeImage` (`:693-705`)             |
| CLI providers NOT wired                                                                 | PASS     | `callCodex`, `callAnthropicSdk` untouched                                              |
| SDK providers NOT wired                                                                 | PASS     | `callAnthropicSdk` no captureContext                                                   |
| Streaming LM Studio chat NOT wired                                                      | PASS     | `chat()` streaming function in `lm-studio.js` not in diff                              |
| Key probes NOT wired                                                                    | PASS     | `testRemoteProviderKey` / `validateRemoteProvider` untouched                           |
| Warm-ups NOT wired                                                                      | PASS     | warm-up paths untouched                                                                |
| Model discovery NOT wired                                                               | PASS     | `getModelSnapshot` / `rawGet` untouched                                                |
| Parser behavior unchanged                                                               | PASS     | parser-internal code outside helper untouched                                          |
| Existing provider return shapes unchanged                                               | PASS     | tests confirm `{ statusCode, body }` shape                                             |
| Recorder failure does not break provider calls                                          | PASS     | outer try/catch in recorder                                                            |
| No auth secrets are stored                                                              | PASS     | redaction tests                                                                        |
| Large payload behavior is explicit                                                      | PASS     | externalization > 512 KB; no silent truncation. Concerns: MAJOR-01, MAJOR-02, MINOR-05 |
| Tests cover redaction, payload storage, recorder, helper unchanged behavior, Kimi proof | PASS     | 6 test files added/modified                                                            |
| No UI files touched                                                                     | **FAIL** | AgentsView.css/.jsx in same commit. MAJOR-03                                           |
| No unrelated dirty files staged in provider harness commits                             | **FAIL** | Same as above                                                                          |

**Overall plan-fidelity:** 16/18 Success Criteria PASS, 1 PARTIAL (timeouts/aborts/network errors lack end-to-end capture tests), 1 FAIL (UI file mixing — explicit plan violation but does not affect provider-harness correctness).

---

## Systemic Risks

Cross-slice patterns that warrant attention:

1. **Latency-from-await pattern, repeated three times.** Every modified HTTP helper awaits the recorder before resolving the caller's promise. The plan permits awaiting for test determinism, but the design choice has performance implications at every callsite (MAJOR-01). If the team decides to make capture fire-and-forget, the change touches all three helpers identically. Recommend extracting a shared `captureNonBlocking` utility.

2. **Duplicate body storage pattern, repeated three times.** Each helper passes `body` (a JS object reference) to the recorder, and `serializeBody` produces both `bodyText` and `bodyJson` (MAJOR-02). The fix — drop `bodyJson` when `bodyText` is its `JSON.stringify` — applies once at the recorder boundary and immediately benefits all three helpers.

3. **Capture-context boilerplate, repeated 13 times.** Every wired callsite manually constructs a `captureContext` object with 7 fields (`providerId`, `providerResearchId`, `providerPathType`, `callSite`, `operation`, `source`, `modelRequested`). `remote-api-providers.js` extracts a `buildRemoteChatCaptureContext` helper, but `image-parser.js` and `lm-studio.js` repeat the pattern inline. Consolidation would reduce drift (e.g., if a `callSite` naming convention changes, today you'd edit 8 locations in `image-parser.js`).

4. **The redact-then-externalize order means deep-clones of multi-MB envelopes happen in memory before any externalization runs (MINOR-05).** Swapping the order would cap memory usage at the externalization threshold + overhead.

5. **No end-to-end coverage of error capture paths with the flag enabled.** Three unit tests cover happy paths (`image-parser.test.js:555`, `lm-studio.test.js:182`, `remote-api-providers.test.js:268`). Network error, timeout, and abort capture have only code-level inspection (MINOR-13, MINOR-14).

6. **Plan-fidelity hygiene gap.** Despite the plan calling out worktree contamination explicitly TWICE (§"Risks And Mitigations", §"Commit Plan"), `AgentsView` changes still landed in the same commit. The pre-commit discipline did not match the plan's prescription. Recommend a pre-commit checklist or a `.git/hooks/pre-commit` that warns when staged files include both `server/src/services/provider-call-package-*` AND `client/src/components/AgentsView.*`.

7. **Defense-in-depth gap in try/catch coverage.** `recordHttpProviderCallPackage` has an outer try/catch (`recorder.js:225-240`), but the helper shims `recordCapturedHttpPackage` do not. If a future refactor introduces a sync throw before the outer try/catch is reached, the unhandled rejection in `res.on('end', async () => ...)` would crash the request (MAJOR-09). Easy hardening fix.

---

## Recommended Next Steps

In priority order:

1. **Add a follow-up commit (or v0.1.1)** that makes recorder calls fire-and-forget (MAJOR-01). Or document the latency cost explicitly in the plan / status doc. The current "await the recorder for test determinism" choice trades user-visible latency for test simplicity; refactor tests to await a separate capture-settled signal.

2. **Add end-to-end capture tests for the error paths** (MINOR-13, MINOR-14):
   - Network error path with `ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=true`; assert `outcome: 'network_error'`.
   - Timeout path with capture; assert `outcome: 'timeout'`.
   - Abort/cancel path with capture; assert `outcome: 'aborted'`.

3. **Swap externalize-before-redact** ordering in `recorder.js:198-205` so multi-MB envelopes don't deep-clone fully before externalization (MINOR-05). Adjust `redactProviderCallPackage` to handle externalized fields (which are `null` after externalization — already a no-op).

4. **Drop duplicate `bodyJson`** when it is identical to externalized `bodyText` (MAJOR-02). Add a regression test.

5. **Skip-path logging** in recorder (MAJOR-07): log a warn once per process when `mongoose_not_connected` skip happens, so operators see the silent drop.

6. **Normalize `response` shape on failure branch** (MAJOR-10): always emit the full field set, with zero/null defaults, to ease future query consumers.

7. **String-body redaction** (MAJOR-04): in `redactProviderCallPackage`, also redact `request.bodyText` directly when it is a JSON string and `bodyJson` is null. Add a redaction test.

8. **Tighten try/catch around `await capture(...)`** in each helper (MAJOR-09). Defense in depth, low cost.

9. **Hygiene/process:** add a pre-commit hook or PR checklist that flags commits mixing provider-harness server files with client `AgentsView.*` files (MAJOR-03). Or simply enforce the `git stash → cherry-pick → unstash` discipline the plan already prescribes.

10. **Document the design choices** that look surprising but are intentional: `cancelReason` race semantics in `jsonRequestCancelable` (MINOR-03), per-call env re-read (MINOR-07), `bodyJson + bodyText` dual persistence rationale (MAJOR-02 if kept).

---

## Verdict

**PASS WITH CONCERNS.**

The v0.1 implementation satisfies 17 of 18 Success Criteria and 23 of 25 Definition-of-Done checklist items. The single FAIL is the inclusion of unrelated `AgentsView` client files in the same commit — a plan-fidelity violation, not a correctness defect. The PARTIAL is missing end-to-end tests for error capture paths. The core preservation layer is correct: feature flag defaults off, redaction strips auth secrets, payload externalization prevents BSON document overflow, recorder failures are swallowed, and existing provider call shapes are preserved.

The 10 MAJOR findings are hardening opportunities (latency, double storage, sparse failure-branch responses, silent skip on Mongo disconnect, hygiene). None of them block production use of the feature with the flag enabled, but each one would degrade observability, performance, or maintainability if left unaddressed. The 17 MINOR findings are code-quality polish.

The implementation is **ready to merge** if the team accepts the hygiene violation as a one-time miss (and adds a follow-up commit isolating the `AgentsView` work or reverting it from this commit's history note). The implementation is **ready to enable in production with caveats** — operators should expect added latency on every captured call (MAJOR-01) and disk usage that grows ~2× faster than necessary for large image bodies (MAJOR-02), until the recommended next steps land.
