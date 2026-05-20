# Worker 4 Full Audit — 2026-05-19

Read-only forensic follow-up to `incident-2026-05-19-ui-revert.md`. The first
pass attributed three out-of-scope UI writes to Worker 4. This pass answers
two further questions:

1. Are there MORE out-of-scope Worker 4 writes that the first pass missed?
2. Within Worker 4's intended scope (delete `POST /api/escalations/parse`),
   did the work land correctly or is it half-done / broken?

No source files were modified during this audit. Findings only.

---

## A. Full working-tree inventory

`git status` at audit time:

```
Changes to be committed:
        deleted:    client/src/components/chat-v5/Widget2ParsedTemplate.jsx

Changes not staged for commit:
        modified:   client/src/App.jsx
        modified:   client/src/api/escalationsApi.js
        modified:   client/src/components/AgentsView.css
        modified:   client/src/components/AgentsView.jsx
        modified:   client/src/components/chat-v5/ChatV5Container.jsx
        modified:   client/src/overhaul.css
        modified:   server/src/routes/escalations.js
        modified:   server/test/integration-routes.test.js
```

Worker 4's reported run window was approximately **05:54-05:57**. Two
files (`AgentsView.jsx`, `overhaul.css`) carry timestamps NEWER than the
first forensic report (because the user hand-fixed them between the
incidents), but the prior pass already established the original Worker 4
timestamps. Two NEW files appeared in `git status` AFTER the first
forensic pass was written (06:09 cluster) — they need attribution.

| File                                                  | LastWriteTime (current)    | Plausible author                          | In Worker 4 scope?    |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------- | --------------------- |
| `server/src/routes/escalations.js`                    | 2026-05-19 05:56:20        | **Worker 4**                              | In scope              |
| `client/src/api/escalationsApi.js`                    | 2026-05-19 05:56:57        | **Worker 4**                              | In scope              |
| `server/test/integration-routes.test.js`              | 2026-05-19 05:57:46        | **Worker 4**                              | In scope              |
| `client/src/components/AgentsView.css`                | 2026-05-19 06:04:06        | Worker 4 originally (per prior forensic); user hand-fixed at 06:04 | **OUT OF SCOPE** (already documented) |
| `client/src/components/AgentsView.jsx`                | 2026-05-19 06:03:07        | Worker 4 originally (per prior forensic); user hand-fixed at 06:03 | **OUT OF SCOPE** (already documented) |
| `client/src/overhaul.css`                             | 2026-05-19 06:04:14        | Worker 4 originally (per prior forensic); user hand-fixed at 06:04 | **OUT OF SCOPE** (already documented) |
| `client/src/components/chat-v5/Widget2ParsedTemplate.jsx` (deleted, staged) | n/a                        | Worker 5                                  | Worker 5's scope      |
| `client/src/App.jsx`                                  | 2026-05-19 06:09:01        | **User** (not Worker 4)                   | Unrelated user fix    |
| `client/src/components/chat-v5/ChatV5Container.jsx`   | 2026-05-19 06:09:11        | **User** (not Worker 4)                   | Unrelated user fix    |

### New files NOT attributable to Worker 4

`client/src/App.jsx` and `client/src/components/chat-v5/ChatV5Container.jsx`
appeared modified after the first forensic pass. Their diffs are a
**single coherent two-file feature**: passing a new `isActive` prop
(short for "is this view currently visible?") from `App.jsx` into
`ChatV5Container.jsx`, then gating the floating evidence-dock button
(the round "FAB" button that pops out the evidence panel) so it only
renders when the chat view is active. This is real product work, not
a revert. Both timestamps (06:09:01 and 06:09:11) are well outside
Worker 4's 05:54-05:57 window and are 7+ minutes AFTER the first
forensic report was written (06:02:35). Attribution: **the user**, not
Worker 4.

### Conclusion for Part A

**No additional out-of-scope Worker 4 writes were found beyond the three
UI files already documented** in `incident-2026-05-19-ui-revert.md`.
Worker 4's footprint of out-of-scope damage is bounded to those three
files. Everything else in the working tree is either Worker 4's
intended-scope work, another worker's work, or unrelated user activity.

---

## B. Quality audit of Worker 4's intended-scope work

### B1. `server/src/routes/escalations.js`

| Check                                                     | Result | Detail                                                                          |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `POST /api/escalations/parse` definition gone             | YES    | Replaced with a 4-line explanatory comment block at lines 1615-1619.            |
| `POST /api/escalations/quick-parse` definition gone       | YES    | Same comment block covers both routes.                                          |
| Mode/policy helpers gone (`isValidParseMode`, `resolveParseMode`, `toParseResponseMeta`) | YES    | All three local helpers removed.                                                |
| Dead `require`s pruned (`parseEscalationText`, `validateParsedEscalation`, `parseWithPolicy`, `isValidProvider`, `getProviderModelId`, `logUsage`, `createAiOperation` / `updateAiOperation` / `recordAiEvent` / `deleteAiOperation`, `reportServerError`, 9 trace helpers, `parseRateLimit`) | YES    | All scrubbed from the top of the file. As a side effect, this also fixes the **pre-existing `ReferenceError: parseRateLimit is not defined` bug** that Worker 5 documented in DECISIONS.md D8. |
| `parseWithPolicy` preservation check                      | CORRECT | `parseWithPolicy` is still imported and called by `server/src/routes/chat/parse.js:8` (chat-side parse-escalation route). Worker 4 correctly did NOT delete it. |
| Orphan helpers left behind?                               | **ONE DEFECT** | `resolveParseInputsFromConversation` (lines 535-565, ~30 lines) is defined but no longer called by anything in live source. Its only previous caller was the deleted parse route. |
| File syntax valid                                         | YES    | `node --check` exits 0.                                                          |
| Bracket / try-catch integrity                             | YES    | Last route ends cleanly at line 1613, comment block at 1615-1619, module.exports at 1621-1622. |

### B2. `client/src/api/escalationsApi.js`

| Check                                                     | Result | Detail                                                                          |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `parseEscalation` wrapper gone                            | YES    | Replaced with a 5-line explanatory comment block at lines 102-106.              |
| `quickParseEscalation` wrapper gone                       | YES    | Same comment block covers both.                                                  |
| Orphan imports left behind?                               | NO     | `serializeJsonRequestBody` (the only import used by the deleted wrapper) is still consumed at line 189 by `updateConversationImages`. `apiFetchJson` is used throughout. |
| File syntax valid                                         | YES    | `node --check` exits 0.                                                          |
| Remaining callers of deleted wrappers anywhere in client? | NONE   | Grepped `client/src` for `parseEscalation\|quickParseEscalation` — only matches are the unrelated `parseEscalationTemplateContent` (a chat-message rendering utility) and the explanatory comment itself. |

### B3. `server/test/integration-routes.test.js`

| Check                                                     | Result | Detail                                                                          |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| User's "three test cases at ~792, 797, 1357" — actually how many? | TWO    | The user's line numbers counted three POST sites; lines 792 and 797 were **both inside the same test** ("parse with conversationId reuses..."). Line 1357 was the separate "P5: escalation parse" test. Two distinct test cases in total. |
| Both test cases removed                                   | YES    | "parse with conversationId reuses..." block at HEAD lines 774-803 → replaced with a 5-line comment block. "P5: escalation parse accepts new provider IDs" at HEAD lines 1355-1365 → replaced with a 6-line comment block. |
| Remaining references to the deleted routes               | COMMENT ONLY | Two matches in the file — both are inside the new explanatory comment blocks. No live test still POSTs to the deleted routes. |
| File syntax valid                                         | YES    | `node --check` exits 0.                                                          |

### B4. Workspace docs

| Check                                                     | Result | Detail                                                                          |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| D7 entry in `parser-harness-hardening/DECISIONS.md`       | **MISSING** | `DECISIONS.md` has D1-D6 then **jumps to D8** (Worker 5's Widget2 entry). No D7. The route deletion is completely undocumented in the decisions log. |
| `parser-harness-hardening/README.md` "Last updated" line refreshed | **NOT REFRESHED FOR D7** | "Last updated" only mentions D8 (Widget2 deletion) and D6 (event rename). No mention of the route deletion. |

These two doc gaps are real — Worker 4's tool calls to write the D7 entry and refresh the README would have been the last writes in its plan. Given the rejection happened mid-flight, the most likely explanation is that the rejection cut off the doc writes specifically. The source-code deletion landed, but the documentation that explains it did not.

The fact that **the source code itself contains inline comments referencing "DECISIONS.md D7"** (in three places: route file line 1616, client API line 103, two test-file comments at lines 776 and 1331) means the in-code citations now point at a phantom decision entry. A reader who follows the breadcrumbs to DECISIONS.md will find D6, D8, and no D7. This is a documentation defect, not a runtime defect.

---

## C. Compile / loader sanity

All three primary files pass `node --check`:

- `server/src/routes/escalations.js` — exit 0
- `client/src/api/escalationsApi.js` — exit 0
- `server/test/integration-routes.test.js` — exit 0

End-of-file structure of `escalations.js` confirmed intact: the `from-conversation` POST handler closes cleanly at line 1613, the explanatory comment for the deleted routes occupies 1615-1619, then `module.exports = router;` at 1621 and `module.exports._internal = { isPathWithinRoot };` at 1622.

The single dead helper `resolveParseInputsFromConversation` (lines 535-565) is syntactically valid — it just has zero callers in live source.

---

## D. Tests not run

Skipped per the audit prompt's optional-D guidance. The user is actively
editing files (App.jsx and ChatV5Container.jsx changed AFTER the first
forensic pass) so a test run now would risk being noise rather than
signal.

A separate note from D8 in `DECISIONS.md`: before Worker 4 ran, the
server test suite was already failing with
`ReferenceError: parseRateLimit is not defined at server/src/routes/escalations.js:1619`.
Worker 4's deletion of the parse route also removed the dangling
`parseRateLimit` reference, so that specific pre-existing bug should now
be resolved as a side effect. This audit did not verify that empirically
(tests not run).

---

## Defects summary

| # | Severity | Defect                                                                                   | Fix size           |
| - | -------- | ---------------------------------------------------------------------------------------- | ------------------ |
| 1 | LOW      | `resolveParseInputsFromConversation` orphan helper in `escalations.js` lines 535-565    | Delete 31 lines    |
| 2 | LOW      | D7 entry missing from `parser-harness-hardening/DECISIONS.md` (three in-code comments cite it) | Write ~20 lines    |
| 3 | LOW      | `parser-harness-hardening/README.md` "Last updated" line does not mention the route deletion | Edit one paragraph |

No HIGH or MEDIUM defects. Source code compiles. No syntactic damage.
No half-removed code blocks. No dead imports remaining. No remaining
callers of the deleted routes anywhere in client or server source.

---

## Plain-English summary

Worker 4 was supposed to delete the escalation-parse route and several
helper functions / wrappers / tests that fed it. Despite its tool use
being rejected partway through, **the deletions all landed correctly**.
The route file, client API file, and test file are syntactically clean
and the deletions are scoped precisely the way the worker was asked to
do them.

The work has three small leftover gaps:

1. One ~30-line helper function inside the route file
   (`resolveParseInputsFromConversation`) is no longer called by anything.
   Safe to delete; trivial cleanup.
2. The decisions-log file (`DECISIONS.md`) was supposed to gain a "D7"
   entry explaining the route deletion. It didn't. The route file, the
   client API file, and the test file all contain comments that point to
   "D7" but the entry doesn't exist yet.
3. The README's "Last updated" line was supposed to be refreshed to
   mention the route deletion. It wasn't.

All three gaps are **documentation/cleanup**, not bugs. The actual
intended-scope work is done. The previously-reported out-of-scope damage
(three UI files) remains the only real harm and that's already being
remediated by the user. **No part of Worker 4's intended-scope work
needs to be redone or rolled back.** Total cleanup effort to close the
three remaining gaps: roughly 5-10 minutes.
