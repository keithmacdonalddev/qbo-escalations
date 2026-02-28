# Backend Implementation Review - Senior Engineer #1

## Summary

Reviewed 35+ server-side files: 7 routes, 5 models, 4 services, 2 orchestrators, 1 provider registry, 1 middleware module, 3 lib modules, 10 test files, and config files. The implementation covers Phases 1-4 of the Provider Independence plan (chat fallback, parse orchestration, dev/copilot parity, parallel opinions) -- significantly beyond Phase 1 scope. The code is generally well-structured with consistent patterns, but has several bugs, security gaps, architectural issues, and missing Phase 1 planned artifacts.

---

## Critical Issues (Must Fix)

### 1. ReDoS vulnerability in template rendering
**File:** `server/src/routes/templates.js:92-93`
User-controlled `key` values from `req.body.variables` are interpolated directly into `new RegExp(...)` without escaping. An attacker can send a key like `(a+)+$` to cause catastrophic backtracking.
```js
rendered = rendered.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'gi'), value);
rendered = rendered.replace(new RegExp('\\[' + key + '\\]', 'gi'), value);
```
**Fix:** Escape regex metacharacters from `key` before constructing the RegExp, or use `String.prototype.replaceAll()` with literal strings.

### 2. ReDoS vulnerability in copilot search
**File:** `server/src/routes/copilot.js:331-339`
User-supplied `query` is passed directly into `$regex` without sanitization:
```js
{ attemptingTo: { $regex: query, $options: 'i' } },
```
Malicious regex patterns can hang the MongoDB server. Same issue in `server/src/routes/escalations.js:176`:
```js
if (req.query.agent) filter.agentName = { $regex: req.query.agent, $options: 'i' };
```
**Fix:** Escape user input before using in `$regex`, or use `$text` search exclusively.

### 3. Command injection via `shell: true` in all CLI spawns
**Files:** `server/src/services/claude.js:73-76`, `server/src/services/codex.js:70-74`, `server/src/routes/dev.js:288-293`
All `spawn()` calls use `shell: true`. While prompts are passed via CLI args, the user-supplied `message` content could contain shell metacharacters (backticks, `$()`, `&&`, etc.) that get interpreted by the shell. The `prompt` value comes from user input and is passed as a positional arg:
```js
const child = spawn('claude', args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,   // <-- DANGEROUS
  env: { ...process.env },
});
```
In `claude.js:53`, the prompt is directly in `args`: `['-p', prompt, ...]`. A prompt containing shell metacharacters could be exploited.
**Fix:** Remove `shell: true` or sanitize/quote all user-supplied args. For codex.js which uses stdin, this is less risky but `shell: true` is still unnecessary.

### 4. Copilot routes are hardcoded to Claude only -- no provider independence
**File:** `server/src/routes/copilot.js:5,28-58`
All copilot endpoints import `claude` directly and call `claude.chat()`. There is no provider parameter, no orchestrator usage, and no fallback:
```js
const claude = require('../services/claude');
// ...
cleanupFn = claude.chat({ ... });
```
This contradicts the Phase 1 plan's goals (even though copilot parity was officially Phase 3, the gap matrix notes this as a known missing feature, and the implementation should at least use the registry pattern).

---

## Bugs

### 1. `playbook.js` categories listing crashes if a file is deleted between `getCategories()` and `statSync()`
**File:** `server/src/routes/playbook.js:22-28`
`getCategories()` returns cached category names. If a category file was deleted since the last cache build, `fs.statSync(filePath)` will throw `ENOENT` and crash the request handler (Express 5 catches it, but the user gets a 500).
**Fix:** Wrap `statSync` in try/catch or verify file exists before stat.

### 2. Graceful shutdown does not close the HTTP server
**File:** `server/src/index.js:46-52`
The shutdown handler only closes the MongoDB connection but does not call `server.close()`. In-flight requests will be abruptly terminated, and active SSE streams will lose data:
```js
function shutdown(signal) {
  console.log(`\n${signal} received -- shutting down`);
  mongoose.connection.close().then(() => {
    console.log('MongoDB disconnected');
    process.exit(0);
  });
}
```
**Fix:** Store the HTTP server reference from `app.listen()`, call `server.close()` first, then close MongoDB.

### 3. Race condition: conversation save in parallel chat `onDone`
**File:** `server/src/routes/chat.js:282-334`
The `onDone` callback for parallel mode pushes multiple assistant messages and calls `conversation.save()`, but the conversation object was fetched earlier (line 140). If another request modifies the same conversation between the initial fetch and this save, messages could be lost due to Mongoose's full-document replacement behavior.
**Fix:** Use atomic `$push` operations instead of in-memory mutations + `.save()`.

### 4. Dev mode `activeSessions` map never cleaned up on successful completion
**File:** `server/src/routes/dev.js:542-579`
The `sessionKey` is added to `activeSessions` at line 549, and the `cleanup()` function at line 571-579 deletes it. However, `cleanup()` is only called on `req.on('close')` (line 581) or inside the async block on success/error. If the client keeps the connection alive (long-polling, no close event), the entry leaks in the map.
**Mitigation:** The `cleanup()` IS called on success (line 648), but the `req.on('close')` handler also calls it. The double-call is safe due to `killed` flag, but there's a window between `cleanup()` and `endStream()` where state is inconsistent.

### 5. Codex `buildPrompt` includes system prompt in stdin but Claude uses `--system-prompt` flag
**File:** `server/src/services/codex.js:323-346`
When `systemPrompt` is provided, `buildPrompt` prepends it as `System instructions:` in the prompt text. But the chat orchestrator in `chat-orchestrator.js:60-61` passes `systemPrompt` to `provider.chat()` as a separate parameter. Looking at `codex.chat()` at line 48-49, `systemPrompt` is passed to `buildPrompt` correctly. However, the system prompt gets embedded in the conversation history text, which means it counts against the user's token budget and could be treated as user-generated content by the model rather than as a system instruction.
**Impact:** Not a crash bug, but the Codex provider treats system prompts differently than Claude, potentially leading to worse QBO playbook adherence.

### 6. `deriveSourceFromPayload` crashes on null/undefined payload properties
**File:** `server/src/routes/escalations.js:33-44`
Line 40 accesses `payload.screenshotPaths` without first checking if `payload` is truthy:
```js
if (Array.isArray(payload.screenshotPaths) && payload.screenshotPaths.length > 0) {
```
If `payload` is `null` (e.g., `req.body` is null with a broken content-type), this throws. The function checks `payload &&` on lines 34 and 37, but not on line 40.
**Fix:** Add `payload &&` guard on line 40.

### 7. DevConversation model's CHAT_MODES enum doesn't include 'parallel'
**File:** `server/src/models/DevConversation.js:4`
```js
const CHAT_MODES = ['single', 'fallback'];
```
The dev route at `dev.js:486-490` resolves the policy (which can return `mode: 'parallel'`), but then tries to save the conversation message with `mode: policy.mode`. If `parallel` is returned, Mongoose will reject it because `parallel` is not in the enum. However, dev mode only supports `single` and `fallback` in the route (no parallel path). The issue is that `resolvePolicy()` could return `parallel` for an invalid request, and the validation at `dev.js:465-467` only checks `VALID_MODES.has(mode)` which includes `parallel`.
**Fix:** Either add 'parallel' to the enum or validate that dev mode does not accept parallel.

---

## Security Concerns

### 1. No authentication or authorization on any endpoint
**All route files**
The gap matrix mentions "Role-based API key auth exists for protected routes (server/src/middleware/authz.js)" but no `authz.js` middleware file exists on disk. All endpoints (CRUD, delete, playbook editing, dev mode file access) are completely open. This is acceptable for local-only use per CLAUDE.md, but the gap matrix's claim is inaccurate.

### 2. Dev mode file read exposes the entire project tree
**File:** `server/src/routes/dev.js:815-849`
The `/api/dev/file` endpoint reads any file within `PROJECT_ROOT`. While `isPathWithinRoot` prevents directory traversal above the project, it still exposes all project files (`.env`, `server/.env`, etc.) to any network client:
```js
const content = fs.readFileSync(resolved, 'utf-8');
```
**Recommendation:** Exclude `.env` files and other secrets from the file-read endpoint.

### 3. CORS is completely open
**File:** `server/src/app.js:16`
```js
app.use(cors());
```
This allows any origin. Per CLAUDE.md this is acceptable for local use, but if the server is ever exposed to a network, this is a vulnerability.

### 4. Rate limiter bypassed in test environment
**File:** `server/src/middleware/rate-limit.js:20`
```js
if (process.env.RATE_LIMIT_DISABLED === '1' || process.env.NODE_ENV === 'test') {
  return next();
}
```
This is fine for tests but `RATE_LIMIT_DISABLED=1` in production would remove all rate limiting.

### 5. Static file serving of uploads directory without access control
**File:** `server/src/app.js:17`
```js
app.use('/uploads', express.static(UPLOADS_DIR));
```
All uploaded escalation screenshots are publicly accessible at `/uploads/escalations/<id>/<hash>.jpg`. No access control.

---

## Omissions vs Phase 1 Plan

### 1. Missing: `server/src/services/providers/chat-provider.js`
The Phase 1 plan (line 55-58) calls for a formal chat adapter interface with validators. This file does not exist. The registry directly references `claude.chat` and `codex.chat` functions without a formal contract or validation layer. The providers work but lack the formal adapter contract the plan specified.

### 2. Missing: `server/test/chat-fallback-integration.test.js`
The Phase 1 plan (line 201) calls for a dedicated chat fallback integration test file. The integration tests exist in `integration-routes.test.js` but there is no dedicated fallback-focused integration test file.

### 3. Missing: Feature flags `FEATURE_CHAT_PROVIDER_PARITY` and `FEATURE_CHAT_FALLBACK_MODE`
The Phase 1 plan (lines 235-236) specifies rollout behind these feature flags. Neither flag exists in the code. The features are always enabled.

### 4. Missing: Structured server-side observability/logging
The Phase 1 plan (lines 179-191) calls for structured per-turn logging with `mode`, `providerUsed`, `fallbackUsed`, `latencyMs`, etc. The metadata is persisted in MongoDB but there is no structured logging to stdout/stderr. The only logging is `console.log` for startup events.

### 5. Missing: Provider health integration with fallback routing
The Phase 1 plan (lines 157-161) says "Prefer healthy provider in fallback mode." The `provider-health.js` module tracks health state and has a half-open circuit breaker pattern, but the chat orchestrator (`chat-orchestrator.js`) and parse orchestrator (`parse-orchestrator.js`) never consult health state when deciding attempt order. An unhealthy provider is still tried first.

### 6. Partial: Image bytes cap
Phase 1 plan (line 173): "Cap images per request and image bytes." The escalation route has `MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024` (line 20) but the chat route (`chat.js`) has no image size cap. Images are passed through unchecked to the CLI provider.

---

## Architecture Issues

### 1. Massive code duplication between `chat.js` POST `/` and POST `/retry`
**File:** `server/src/routes/chat.js:108-392 vs 638-886`
The retry handler is a near-complete copy of the main chat handler. Both have identical SSE setup, orchestration callbacks, parallel turn creation, `onDone`/`onError` logic, etc. This is ~250 lines duplicated. Any bug fix must be applied in both places.
**Recommendation:** Extract shared orchestration-to-SSE logic into a helper.

### 2. Duplicated helper functions across files
- `parsePositiveInt` is defined identically in `claude.js:6-9`, `codex.js:8-11`, and `dev.js:19-22`
- `isPathWithinRoot` is defined identically in `escalations.js:28-31` and `dev.js:44-47`
- `didCliExitSuccessfully` is in `claude.js:11-13`, `codex.js:13-15`, and `dev.js:40-42`
- `normalizeProviderError` is in `chat-orchestrator.js:29-33`, `parse-orchestrator.js:33-39`, and `dev.js:67-73`
- `toParseResponseMeta` is nearly identical in `chat.js:46-66` and `escalations.js:143-163`

### 3. Provider registry getProvider() always constructs fresh objects
**File:** `server/src/services/providers/registry.js:47-58`
Every call to `getProvider()` invokes `def.getChat()`, `def.getDefaultTimeoutMs()`, etc. and creates a new object. In the orchestrators, `getProvider()` is called multiple times per request. This isn't a major perf issue but is unnecessary overhead.

### 4. Copilot routes bypass the orchestrator entirely
**File:** `server/src/routes/copilot.js`
All 8 copilot endpoints directly call `claude.chat()` instead of going through the chat orchestrator. This means copilot never benefits from fallback, health tracking, or provider selection.

### 5. No shared SSE helper between chat.js, copilot.js, and dev.js
Each file independently implements SSE headers, heartbeats, and event writing. The copilot has its own `initSSE()` and `streamClaude()` helpers, but these aren't reused by chat or dev.

---

## Error Handling Gaps

### 1. Unhandled promise rejections in onDone/onError SSE callbacks
**File:** `server/src/routes/chat.js:282-384`
The `onDone` callback is `async` and does `await conversation.save()` and `await ParallelCandidateTurn.findOneAndUpdate(...)`. If `conversation.save()` throws (e.g., validation error, connection lost), the rejection is not caught by the orchestrator (it just calls `onDone` and doesn't expect a return). The SSE stream would hang without sending a `done` or `error` event.
**Fix:** Wrap the body of `onDone` in a try/catch that sends an error SSE event on failure.

### 2. No global error handler in Express app
**File:** `server/src/app.js`
Express 5 auto-catches async errors, but there's no fallback error handler middleware registered. Unhandled errors will result in Express's default 500 response (HTML), not the `{ ok: false, code, error }` JSON format the app uses.
**Fix:** Add a final `app.use((err, req, res, next) => ...)` handler.

### 3. Temp file cleanup on `parseEscalation` timeout is not guaranteed
**File:** `server/src/services/claude.js:238-246`
On timeout, the `settled` flag is set and `child.kill('SIGTERM')` is called, but the child's `close` event might still fire and the `if (tmpPath)` cleanup runs. If the timeout handler runs first, it does clean up. But if the child's `close` fires between `settled = true` and the timeout handler, the `close` handler won't clean up because `settled` is true. Actually, looking more closely, the `close` handler checks `if (settled) return;` and skips cleanup. But the timeout handler does clean up. So this is fine. However, if `child.kill('SIGTERM')` fails silently (child already dead), no cleanup runs until the `close` event, which does check settled. So the flow is correct.

### 4. MongoDB reconnection is not handled
**File:** `server/src/index.js:26-32`
If MongoDB disconnects after initial connection (network blip, Atlas maintenance), there is no reconnection logic. Mongoose 9 may handle this automatically, but there are no `mongoose.connection.on('disconnected', ...)` handlers to log or react.

---

## Test Coverage Analysis

### What's Tested (10 test files)
1. **chat-orchestrator.test.js** (7 tests) - single/fallback/parallel modes, timeout behavior, sync throw, failure recovery
2. **parse-orchestrator.test.js** (7 tests) - single/fallback/parallel parse, regex fallback, validation gate
3. **provider-cli-helpers.test.js** (3 tests) - timeout parser, exit code guard
4. **escalation-parser.test.js** (5 tests) - regex parsing, category classification, looks-like detection
5. **parse-validation.test.js** (4 tests) - field normalization, category aliases, score validation
6. **rate-limit.test.js** (1 test) - basic allow/block behavior
7. **dev-route-helpers.test.js** (8 tests) - event classification, text extraction, tool events, path traversal
8. **escalations-route-helpers.test.js** (1 test) - path traversal guard
9. **sse-parser.test.js** (2 tests) - SSE decoder from client (cross-layer test)
10. **integration-routes.test.js** (12 tests) - template CRUD, conversation linking, chat SSE, parallel accept/discard, screenshot upload, parse endpoint

### What's NOT Tested
1. **Analytics routes** - Zero tests for `/api/analytics/*` (7 endpoints)
2. **Playbook routes** - Zero tests for `/api/playbook/*` (7 endpoints including file write/delete)
3. **Copilot routes** - Zero tests for `/api/copilot/*` (8 endpoints)
4. **Provider health module** - No dedicated test file (only tested indirectly via orchestrator tests)
5. **Provider registry** - No dedicated test file for `normalizeProvider`, `getProvider`, `getAlternateProvider`
6. **Conversation fork** - Not tested in integration tests
7. **Conversation export** - Not tested
8. **Escalation similar search** - Not tested
9. **Escalation transition** - Not tested
10. **Dev mode chat streaming** - Not tested (complex SSE + subprocess)
11. **Dev mode file/tree endpoints** - Not tested
12. **Image handling in chat** - Not tested (no image upload tests for chat endpoint)
13. **Conversation deletion + escalation unlinking** - Tested, but only one direction

### Missing Test Scenarios
- Network/timeout behavior for MongoDB operations
- Invalid ObjectId format handling (Express 5 catches CastError, but behavior untested)
- Concurrent parallel accept/discard race conditions
- Large payload handling (50MB body limit)
- Edge cases in playbook file watcher

---

## Performance Concerns

### 1. Full conversation messages array loaded on every chat request
**File:** `server/src/routes/chat.js:140,249-252`
Every chat request loads the entire conversation document (all messages) with `Conversation.findById()`. For long conversations with many messages, this loads potentially hundreds of KB of text into memory, serializes it to the CLI subprocess, and then re-saves the full document.
**Impact:** Memory pressure and MongoDB bandwidth increase linearly with conversation length.
**Recommendation:** Consider capping conversation length or using message pagination.

### 2. Escalation list query has no pagination cap on text search
**File:** `server/src/routes/escalations.js:177-179`
The `$text` search filter creates a query plan that could scan the full text index. Combined with `sort` and `skip`, large datasets could be slow.

### 3. `buildHashesFromPaths` reads and hashes all screenshot files synchronously
**File:** `server/src/routes/escalations.js:118-132`
This function is called during screenshot operations and reads every existing file from disk using `fs.readFileSync()`. For escalations with many screenshots, this blocks the event loop.

### 4. Playbook loaded synchronously on first request
**File:** `server/src/lib/playbook-loader.js:118-124`
The first call to `getSystemPrompt()` synchronously reads all playbook files from disk. If the playbook is large (dozens of files), this blocks the event loop during the first request.

### 5. No cap on conversation message array growth
**File:** `server/src/models/Conversation.js`
Messages are an unbounded array in the conversation document. MongoDB documents are limited to 16MB. A conversation with hundreds of long messages could approach this limit and cause write failures.

---

## Improvement Recommendations

### 1. Extract shared SSE streaming helper
Create `server/src/lib/sse.js` with:
- `initSSE(res)` - sets headers, starts heartbeat
- `writeSSEEvent(res, event, data)` - safe JSON event writer
- `endSSE(res, heartbeatHandle)` - cleanup
Reuse across chat.js, copilot.js, and dev.js.

### 2. Extract shared utility functions
Create `server/src/lib/utils.js` for:
- `parsePositiveInt(value, fallback)`
- `isPathWithinRoot(root, target)`
- `escapeRegex(str)` (for template rendering and search)

### 3. Route copilot through the chat orchestrator
Modify copilot.js to use `startChatOrchestration` instead of `claude.chat()` directly. This immediately gives copilot endpoints fallback, health tracking, and provider selection.

### 4. Add global Express error handler
```js
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, code: 'INTERNAL', error: 'Internal server error' });
});
```

### 5. Add `.env` file exclusion to dev file-read endpoint
```js
if (path.basename(resolved) === '.env' || path.basename(resolved).startsWith('.env.')) {
  return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Cannot read environment files' });
}
```

### 6. Implement conversation message trimming
When conversation length exceeds a threshold (e.g., 100 messages), trim older messages from the array sent to the CLI provider while keeping them in MongoDB for history.

### 7. Use atomic MongoDB operations for message appends
Instead of `conversation.messages.push(...); await conversation.save()`, use `Conversation.findByIdAndUpdate(id, { $push: { messages: newMsg } })` to avoid race conditions with concurrent requests.

---

## Special Features That Could Be Added

### 1. Conversation summarization before trimming
When conversations get long, use the AI provider to generate a summary of earlier messages, then trim the originals. This preserves context while keeping token usage manageable.

### 2. Provider cost tracking
The parallel mode documentation mentions cost being trackable (gap matrix line 88). Adding a field to store estimated token counts per provider response would enable cost visibility.

### 3. Webhook/notification on escalation status changes
For team environments, notifying when an escalation moves to "resolved" or "escalated-further" would be valuable.

### 4. Automated playbook gap detection
The copilot has a `playbook-check` endpoint, but it could be automated to run periodically and flag categories with low resolution rates.

### 5. Provider response quality comparison dashboard
With parallel mode storing both provider responses, building a comparison view would help evaluate which provider produces better QBO escalation guidance over time.
