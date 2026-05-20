# Parser Harness Hardening — Session Handoff

**Handoff date:** 2026-05-19
**Workspace root:** `C:\Projects\qbo-escalations\parser-harness-hardening\`

**Next session: read this entire file FIRST before responding to the user.** Then read `README.md`, `DECISIONS.md`, and the two design docs in `02-design/` before proposing next steps.

---

## Project goal (one paragraph)

The user (a QBO escalation specialist who built this app) is hardening the image parser's harness — the scaffolding that wraps the AI model — so that even very weak open-source vision AIs (e.g. `google/gemma-4-e4b`) produce **100% byte-for-byte literal transcription** of escalation-template images. Frontier AIs (Claude, GPT-5) already pass; medium MoE models are nearly perfect; weak models are the test bar. The user controls image quality so vision isn't the issue. The issue is AI helpfulness — models that "correct" `NA` to `N/A`, `gmail.com` to `Gmail.com`, or reformat dates. The harness must prevent this through prompt design + structured output + validation. **Scale and the INV multi-agent pipeline are OUT OF SCOPE.**

---

## How the user works (read this carefully)

- **Minimally technical.** Plain English required throughout. Pair every code identifier (function names, file paths) with a one-line description of what it does the first time you mention it.
- **Use concrete analogies:** AI = typist; harness = the form + instructions + supervisor you give the typist; structured output = pre-printed form the typist must fill (can't write outside the boxes); canary model = the worst typist on staff used as the test bar; "safety net" code = silent editor that hides typist mistakes from the supervisor.
- **Decisive and fast.** He gives short directives ("do this", "do pass/fail buttons"). Execute immediately. Don't ask unnecessary questions.
- **Strict accuracy bar.** "100% correct is the only way to get a pass." `NA → N/A` is a fail. Don't pre-emptively limit ambition.
- **He owns the decisions.** Don't second-guess after he chooses. Don't hedge with "but if the model can't do X" — he's already considered those.

---

## PM operating model (top-level agent role)

You operate as **PM/coordinator only**. The user has codified this and enforces it.

- **Do NOT directly inspect repo source files, edit code, or run dev tools.** Delegate all of that to worker agents.
- **EXCEPTION:** PM may write to the workspace (`parser-harness-hardening/`) — this handoff doc, decisions log, design docs, etc. These are coordination artifacts, not source code.
- **EXCEPTION:** PM may write to user memory at `C:\Users\NewAdmin\.claude\projects\C--Projects-qbo-escalations\memory\`.
- Use `Agent` tool to spawn workers (named — workers can be re-addressed via `SendMessage`).
- Bring back compressed summaries; keep raw repo state inside worker threads.

---

## Memory rules (already saved, auto-load next session)

These five memories are saved in `MEMORY.md` and apply automatically. **Re-read MEMORY.md when you start.**

1. **`feedback-plain-english-communication`** — user is minimally technical. Define every code identifier inline. Use analogies. Never drop jargon raw.
2. **`feedback-no-preemptive-ceilings`** — don't hedge ambitious goals with conventional-wisdom limits, especially constraints the user has already removed from scope. He pushed back hard on a caveat about "what the model can't see in the image" because he controls image quality.
3. **`feedback-cleanup-scope-must-be-explicit`** — every cleanup-worker prompt must include a strict FILE ALLOWLIST. Forbid editing anything outside it. Replace vague phrases like "hunt for stale references" with "search for references, do NOT edit anything outside the named files; flag findings instead."
4. **`feedback-rejected-tool-use-not-rollback`** — when a worker's tool call is rejected mid-flight, the rejection only blocks one tool call. Files the worker already wrote stay on disk. Always run `git status` after a rejection to see what actually landed.
5. **`feedback-verify-worker-reports-with-git-diff`** — workers can file false completion reports describing deletions that never happened. Every code-modifying worker prompt MUST require a VERIFICATION BLOCK in its report: `git status`, `git diff --stat`, per-change `+` or `-` lines from the diff, post-edit greps proving the symbols are/aren't there, test outcome. Reject reports that lack this proof.

---

## Decisions state (DECISIONS.md is authoritative)

### COMPLETED with full verification

| # | Decision | Status |
|---|---|---|
| **D1** | Remove silent cleanup function (`recoverCanonicalTemplateBlock`) entirely | **Done.** First attempt was a *false report* — the worker described 8 deletions that never happened. Re-executed with verification block on 2026-05-19. Function, helper, call site, two output fields, and one test genuinely gone. |
| **D2a** | Remove `sdk-image-parse` from chat assistant | **Done.** `sdk-image-parse.js` file preserved for D2b. |
| **D2b** | Wire `sdk-image-parse` into image parser as structured-output default for Anthropic | **Done with verification.** Anthropic now defaults to schema-enforced JSON output. Opt-out via `"structured": false` in request body. Schema patched to include `kbToolsUsed`. Adapter `buildCanonicalTextFromStructuredFields` renders SDK fields back to canonical 9-label text. 51 existing Anthropic prose-path tests updated mechanically with `structured: false`. Two new stage events for observability: `parser.structured_path_selected` and `parser.structured_path_skipped`. |
| **D3** | Pass/fail single-click buttons consistent across surfaces | **Done.** Chat-area buttons already worked (single-click, calls `PATCH /api/pipeline-tests/parser-results/:id`); aria-labels added. Test Results tab already had buttons but lacked in-flight feedback parity — added `ParserResultActions` local component with disabled-during-save and "Saving..." status. Identical visual + behavioral contract in both places. Screenshot at `review-screenshots/test-results-grading-buttons.png`. |
| **D4** | Collapse two parser prompts into one (keep strict `escalation-template-parser`, retire `image-parser`) | **Done.** Default route fallback resolves to strict prompt. 37 dual-role tests deleted across 3 test files. `ImageParseResult.parserPromptId` schema default updated. The 3rd parser prompt `follow-up-chat-parser` is STILL live for follow-up-chat content extraction. |
| **D6** | Rename misleading event `parser.template_recovered` → `parser.template_validated` | **Done.** Subscribers in `StageEventLogPanel.jsx` updated. |
| **D7** | Delete `POST /api/escalations/parse` + orphans | **Done.** Route, two client wrappers (`parseEscalation`, `quickParseEscalation`), two test cases removed. **Bonus side effect:** the pre-existing `parseRateLimit` ReferenceError bug was resolved because its only reference was inside the deleted route. One orphan helper (`resolveParseInputsFromConversation`) cleaned up in a follow-up pass. |
| **D8** | Delete `Widget2ParsedTemplate.jsx` | **Done.** File was dead-from-birth — created 2026-05-18, never imported anywhere. Its localStorage key `v5_parser_accuracy_log` had no readers. |

### PENDING

| # | Decision | Notes |
|---|---|---|
| **D5** | Sandbox MVP — agent-agnostic tab on every agent profile page | **Design complete in `02-design/`, not started.** ~900 lines of new code. Phase 1 covers the 3 image-input agents; Phase 1.5 adds text-input and event-input slot variants for the remaining 10 agents. Isolation design: scratch prompts in browser sessionStorage with explicit "Promote to live" button (the live prompt file is never touched until promote); new `SandboxParseResult` Mongoose collection (separate from production `ImageParseResult`); event-bus `scope` field for sandbox tagging. |

### Small cleanups flagged but not tackled

- **Dead `SYSTEM_PROMPT` constant (350 lines)** in `server/src/services/image-parser.js` — exported, used in tests by coincidence, not called by `parseImage()`. Even more obsolete now that structured output bypasses prose entirely.
- **`parser-harness-hardening/` directory is UNTRACKED in git.** Needs a deliberate decision: add to git, or add to `.gitignore` explicitly.
- **Canonical-text adapter is locally cloned.** `buildCanonicalTextFromStructuredFields` (the function that renders SDK fields back to canonical 9-label text) is a small local clone of similar logic that was once in the now-deleted chat-parse route. Could be lifted to a shared lib later.

### Open architectural item raised by the user at end of session — IMPORTANT

**The user's diagnosis (verbatim framing):** this app currently has *agent harnesses* (rich, per-agent: prompts, validators, persistence, UI) but does NOT have provider harnesses or model harnesses. The 7 provider call functions in `image-parser.js` are thin transport — they package and unpack HTTPS calls without shared schema enforcement, structured-output translation, retry policies, observability, or cost accounting as a coherent layer. The model layer is even thinner (model name is just a string).

This is the reason the structured-output wiring ended up at the agent level: with no real provider-level harness to host the capability, the only place to put `sdk-image-parse.js` was inside an agent's flow. The capability is at the wrong layer because that layer doesn't really exist yet as a feature surface. The refactor proposal is essentially: **build the first real provider-level harness, starting with structured output as its first feature.** Once that layer exists, future cross-cutting capabilities (retries, observability, cost limits, fallback chains, response normalization) have a natural home too.

**Recommended path forward (next session should discuss before starting D5):**
1. Build a generic "structured-output capability" interface at the provider layer — one new module
2. Migrate the existing Anthropic wiring to use that interface
3. Add LM Studio gbnf grammar-constrained decoding (highest leverage — this is where the weak-model canary lives)
4. Add OpenAI json_schema, Gemini responseSchema, Kimi, etc. as follow-ups
5. THEN ship the Sandbox MVP (D5) so it launches with structured output available across every provider it can reach

Reason: the Sandbox is designed to run the same agent against multiple providers for comparison. If only Anthropic has structured output and others use free-form prose, sandbox comparisons are apples-to-oranges. The provider-level abstraction is a prerequisite for honest cross-provider comparison in the canary workflow.

**Estimated size:** the abstraction itself is small (one module, a few hundred lines). Migrating Anthropic in is trivial. Adding LM Studio gbnf is moderate (need to convert the JSON schema to a GBNF grammar, which is a known mechanical translation). OpenAI / Gemini / Kimi adds are small each. Total likely ~600-1000 lines depending on how many providers are wired in the first pass.

**Decision pending from user:** does this go before D5 (Sandbox), or land as part of D5? Recommend BEFORE — clean foundation, then the Sandbox uses it.

---

## Repo state at handoff

- **All server tests passing:** 50/50 test files in ~80 seconds (last run after D3).
- **`git status` shows many modified files** — the cumulative D1/D2b/D3/D4/D6/D7/D8 work. **NOTHING IS COMMITTED YET.** The user controls commits.
- **`parser-harness-hardening/` is untracked** — its contents (this file included) live on disk but git doesn't track them.
- **Dev server may be running** at localhost:5174 (was running for the D3 screenshot work). Do NOT start or stop dev servers unless the user explicitly asks.

---

## Key file paths the next session will need

| Path | Purpose |
|---|---|
| `server/src/services/image-parser.js` | Main image parser. Now uses structured-output for Anthropic by default. Has `buildCanonicalTextFromStructuredFields` adapter. |
| `server/src/services/sdk-image-parse.js` | Structured-output Anthropic SDK path. Schema `OUTPUT_SCHEMA` at ~lines 22-46 (now includes `kbToolsUsed`). |
| `server/src/routes/image-parser.js` | `POST /api/image-parser/parse`. Accepts `structured` boolean in request body (default true). |
| `server/src/lib/agent-prompt-store.js` | Registry of 12 active agent prompts. (Was 13 before D4 removed `image-parser`.) |
| `server/src/lib/escalation-template-contract.js` | Canonical 9-label contract. |
| `prompts/agents/escalation-template-parser.md` | The strict prompt — now the ONLY image-parser prompt. |
| `prompts/agents/follow-up-chat-parser.md` | Still live, used by chat popup for follow-up content extraction (not the escalation parser path). |
| `server/src/models/ImageParseResult.js` | Production parse history. Default `parserPromptId` updated to `escalation-template-parser`. |
| `server/src/models/ImageParserTestResult.js` | Graded test results. The Test Results tab reads this. |
| `client/src/components/AgentsView.jsx` | All 13 agent profiles. 10 tabs. Test Results tab now has full grading parity with chat-area (D3). **High-risk file** — Worker 4 incident origin; touch with strict allowlists only. |
| `client/src/components/chat-v5/ChatV5Container.jsx` | Main chat UI. `ParserOutput` function (around line 1074) has the chat-area pass/fail buttons. |
| `client/src/components/grading/...` | Did NOT extract a shared pass/fail component — chat-area and Test Results have replicated behavior in two layouts. Both call `markParserTestResult`/`updateImageParserTestResult` which PATCH the same endpoint. |

---

## Recommended next moves

The user's next likely directive: **build the Sandbox MVP (D5).** Recommended dispatch sequence:

1. **Worker 1 — Server foundation** (~300 lines, contained, easy to verify)
   - New `SandboxParseResult` Mongoose model (same shape as `ImageParseResult` + `sandboxAgentId`, `promptOverrideUsed`, `runGroupId`, `runIndex`, `userVerdict`)
   - New `/api/sandbox/parse` and `/api/sandbox/parse-results/:id` routes
   - Add `scope` field to `createStageEventBus` in `server/src/lib/stage-events.js` for sandbox event tagging
   - Allowlist: the new model file, the new routes file, `stage-events.js`, the parser-harness-hardening docs

2. **Worker 2 — Client SandboxTab + image input + pass/fail wiring** (~600 lines)
   - Add the "Sandbox" tab to the existing 10-tab structure in `AgentsView.jsx`
   - Image-input slot for the 3 image-parser agents (the other 10 agents see a "Sandbox support coming in Phase 1.5" placeholder)
   - Reuse the `ParserResultActions` pattern from D3 for pass/fail
   - Use sessionStorage for scratch prompt, explicit "Promote to live" button
   - Allowlist: `AgentsView.jsx` (Sandbox tab section only), possibly a new component file, parser-harness-hardening docs

Both workers MUST include the verification block.

Alternative directives the user has flagged:
- Delete the dead `SYSTEM_PROMPT` constant
- Track or gitignore the `parser-harness-hardening/` directory
- Phase 1.5 of the Sandbox (text + event input slot variants)

---

## Incidents and lessons from this session

1. **Worker 4 UI-revert incident** — A worker dispatched to delete `/api/escalations/parse` had a vague "hunt for stale references" license and also reverted three UI files (`AgentsView.css`, `AgentsView.jsx`, `overhaul.css`) before being rejected. User hand-fixed them. **Outcome:** memory rule `feedback-cleanup-scope-must-be-explicit` added; every worker now gets a strict allowlist.

2. **D1 false-completion-report incident** — A worker reported deleting the silent cleanup function with 8 specific deletions; a later worker discovered NONE of them happened. The original report described intended work as if executed. **Outcome:** memory rule `feedback-verify-worker-reports-with-git-diff` added; every worker now must include a verification block with proof from `git diff`.

3. **"Rejected ≠ rollback" incident** — Worker 4's tool-call rejection didn't undo its earlier writes; the rejection only blocked one further tool call. **Outcome:** memory rule `feedback-rejected-tool-use-not-rollback` added.

These lessons compound: every code-modifying worker now gets (a) strict allowlist, (b) verification block requirement, (c) "rejected ≠ rollback" awareness. **Apply these to every future dispatch.**

---

## Communication contract with the user

- He asks crisp questions; answer in crisp prose.
- One `★ Insight ───` block per major response (per the explanatory output style active in this session).
- Don't over-narrate steps; don't apologize unless something specific went wrong.
- When dispatching workers: briefly state what you're sending and why; report results when they return.
- When he says "do X", execute — don't ask for clarification unless genuinely ambiguous; offer your best interpretation and let him redirect.

---

## What this session looked like in shape

- Discovery passes mapped the parser pipeline, the agent roster (13 agents), the Agents UI surface, the existing test-route flow, and `sdk-image-parse` wiring
- Workers landed D6, D7, D8, D4, D2b, D3, plus the re-execution of D1
- Two forensic agents resolved incidents (UI-revert attribution + D1 regression discovery)
- All workspace artifacts persisted to `parser-harness-hardening/` so the next session can land cold

Last updated: 2026-05-19
