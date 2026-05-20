# Widget2ParsedTemplate.jsx — what it actually is

Question 1 from the user. Plain English first. Every code identifier paired with a one-line description of what it does.

## TL;DR

The file lives at `client/src/components/chat-v5/Widget2ParsedTemplate.jsx` (164 lines). On disk it looks like a "parser output card" component for the chat-v5 stage pipeline. **It is never imported anywhere in the active app.** Nothing renders it. Removing the file would not affect any visible UI. It is dead code that survives only because nothing has pruned it.

The previous discovery noted "a parallel localStorage-only pass/fail log that should be retired or merged." That description was accurate but understated: the entire file — not just the logging — is orphaned. The Pass/Fail buttons the user already knows about on the chat parser card are produced by a **different** function in a **different** file (`ParserOutput` inside `client/src/components/chat-v5/ChatV5Container.jsx`).

## What the file says it does (read top to bottom)

- `PASS_FAIL_KEY = 'v5_parser_accuracy_log'` — name of the localStorage bucket used to remember Pass/Fail clicks (constant string).
- `readLog()` / `appendLog(entry)` — two tiny helpers that read and write a JSON array of grading entries into the browser's localStorage (browser-local, never leaves the device).
- `PLACEHOLDER_FIELDS` — a frozen list of 6 template-field labels (Attempting to, Expected outcome, Actual outcome, Client / contact, Phone agent, Steps tried) shown as empty rows while parsing is in flight.
- `Widget2ParsedTemplate({ stageState, parsedFields, caseIntake })` — the React component. It accepts the live parser status, the parsed fields, and the case-intake record (the Mongo document for the active escalation conversation).
- The render produces a card-style widget with a header "Reading template" (or "Parser failed"), a running-timer chip (`useRunningTimer`, a custom hook that updates an elapsed-time display every 100ms), an animated progress bar while running, a definition list (`<dl>`) of fields, and (when parsing is done) an "accuracy" footer with two big buttons:
  - "Pass · 100% correct" — calls `handleAccuracy('pass')` which appends one entry to localStorage and locks the buttons.
  - "Fail · anything less" — same thing with `verdict: 'fail'`.
- It uses `AgentProgressStrip` (a sibling component showing the other workflow steps as a footer strip) and Framer Motion (animation library) for fade-ins.

## What actually renders in chat-v5 today

The active chat-v5 parser card is produced by `ParserOutput` at `client/src/components/chat-v5/ChatV5Container.jsx:1074`, mounted at `ChatV5Container.jsx:1447`. That function renders:

- A test-banner row (`TestBanner`) — a small banner that appears when this card is showing a kebab-menu "Test stage" run rather than a live conversation.
- A fixture-thumbnail preview button — opens the test image in a zoomable modal.
- An inline status strip — shows the 9-label contract pass/fail result if the run was a test.
- Pass / Fail buttons (`ChatV5Container.jsx:1203-1222`) — call `markResult(status)` which calls the prop `onMarkTestResult(savedTestResultId, status)`. That prop ultimately fires `PATCH /api/pipeline-tests/parser-results/:id` and persists to the **MongoDB** `ImageParserTestResult` collection — the same collection the profile page's Test Results tab reads from.
- A `<dl>`-like list of template rows (COID/MID, CASE, CLIENT/CONTACT, CX IS ATTEMPTING TO, EXPECTED OUTCOME, ACTUAL OUTCOME, KB/TOOLS USED, TRIED TEST ACCOUNT, TS STEPS — the canonical 9 labels).
- A pre-formatted raw-text fallback for when shape validation fails.

This is the only parser card the user sees today. It is server-backed, not localStorage.

## Confirmation that Widget2ParsedTemplate is unreferenced

Searched the entire `client/src` tree (and the whole repo) for any usage of the file:

- `import` references to `Widget2ParsedTemplate` — zero matches outside the file itself.
- `from .*Widget2` — zero matches.
- `Widget2` substring anywhere in `client/src` — only the file's own `export default function Widget2ParsedTemplate(...)` declaration.
- `v5_parser_accuracy_log` (the localStorage key) — only the file's own constant. Nothing reads from this key anywhere in the codebase.

## What removing the file would break

Nothing visible. Plain English:

- No tab, button, modal, panel, or component anywhere in the running app mounts this widget.
- The browser localStorage entries it would write (`v5_parser_accuracy_log`) are not read by any other code, so no downstream view loses data. (If a developer once clicked the buttons during a previous build that did mount the widget, the JSON blob sitting in their browser is unreachable and orphaned.)
- The CSS classes it uses (`v5-widget`, `v5-widget--parsed`, `v5-accuracy`, etc.) are defined in `chat-v5.css` but no other component reads from them in this state shape — they are dead too.

The sole concrete risk of removal is git-archaeological: an older branch or merged feature once mounted it and someone could `git log -p` to find it. Not a runtime risk.

## Relationship to the Sandbox tab work

For the Sandbox tab plan (Decision D5, feasibility documented in `01-discovery/sandbox-tab-feasibility.md`), the relevant takeaway is:

- The **reusable** Pass / Fail UI lives at `ChatV5Container.jsx:1203-1222` inside the `ParserOutput` function and writes to MongoDB via the existing `PATCH /api/pipeline-tests/parser-results/:id` server hop.
- The widget at `Widget2ParsedTemplate.jsx` is **not** the reusable source. Its Pass/Fail UI writes only to localStorage and is invisible to the rest of the app.
- The earlier discovery's mention of "retire or merge the localStorage log" can be honoured by deleting the file entirely once a separate decision authorises it. The merge concept is moot because no one is reading the localStorage log.

## Recommendation (informational, not a decision)

Delete `client/src/components/chat-v5/Widget2ParsedTemplate.jsx` in a tiny cleanup commit. There is no merge step required — nothing reads what it writes, and nothing mounts what it renders. Defer this until a quiet moment; it has no harness-hardening value either way.

## Creation history

Verified with fresh `git log` commands against the file path.

- **Created:** 2026-05-18 (one day before this writeup) in commit `d69ad58` by `keithmacdonalddev <tenantbureau6@gmail.com>`.
- **Commit message:** `chore: checkpoint app updates and cleanup` — a large catch-all checkpoint commit that added several new files alongside this one (1003+ lines of new App.css, new provider icons, AgentsView refresh, new TODO docs). The commit message is generic; it does not explain why this particular widget was added.
- **Total commits touching the file:** 1 (the creation commit).
- **Most recent commit touching the file:** the same commit, 2026-05-18 — the file has never been edited since it was first added.
- **Rename history (via `git log --follow`):** none. The file was born under this name and has not moved.
- **Why it was added (best inference, not stated in the commit message):** the file was part of a broader chat-v5 stage-pipeline experiment landing in the same checkpoint commit. Given its structure — a "parser output card" with placeholder fields and a localStorage Pass/Fail log — it was likely an early prototype for the parser stage of chat-v5 that was superseded by `ParserOutput` inside `ChatV5Container.jsx` (which writes to the server-backed `ImageParserTestResult` collection) before being mounted anywhere. It was never wired into the app.

Net summary: the file is exactly one day old, has been touched exactly once (its birth), no later commit has imported, modified, or referenced it.

Last updated: 2026-05-19
