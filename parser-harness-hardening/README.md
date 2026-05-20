# Parser Harness Hardening

## What this subproject is

The QBO escalation app uses an image-parser pipeline that turns escalation-template screenshots into structured text. Frontier models (Claude, GPT-5) already pass with our current harness. The goal of this subproject is to harden the **harness** — the entire wrapper around the model: system prompt, composed skills/rules, structured-output constraints, validators, recovery layers, persistence contract, and the way the Agents UI exposes all of the above — so that **even the weakest open-source vision models** (canary: `google/gemma-4-e4b`, then step further down) produce 100% byte-for-byte literal transcription of the visible template text. No helpful normalization. `NA` must stay `NA`, never become `N/A`. `gmail.com` must not become `Gmail.com`. Date formats must not be rewritten. Any non-100% output is a broken harness.

Out of scope: scale, concurrency, the INV-agent multi-agent pipeline, image-quality concerns.

## START HERE

**Next session: read `HANDOFF.md` first. It captures the full session state, all decisions, all memory rules, and the recommended next moves.**

## Current phase status

**Phase: Implementation in progress.** Discovery (Phase 1) and Design (Phase 2) are done. Decisions D1, D2a, D2b, D3, D4, D6, D7, D8 are all complete with verification. D5 (Sandbox MVP) is designed but not started — see `02-design/`. See `HANDOFF.md` for the full state.

## Acceptance criterion (verbatim, do not soften)

"100% correct" means literal byte-for-byte fidelity to the visible text on the template — NO helpful normalization. `NA` must stay `NA`, never become `N/A`. `gmail.com` must not become `Gmail.com`. Date formats must not be rewritten. The bar is the weakest model we can push the harness down to. Improve harness until the canary weak model is 100%, then step down to weaker models and try to break it.

## File index

- `HANDOFF.md` — **read this first.** Full session handoff: goal, user profile, PM rules, memory rules, decisions state, key paths, recommended next moves, incident lessons.
- `DECISIONS.md` — user-confirmed direction with completion notes per decision.
- `01-discovery/pipeline-map.md` — server-side request flow for image parsing, file:line anchors.
- `01-discovery/agents-roster.md` — complete agent registry (13 prompt definitions, not just the 3 parsers), including which are live vs aspirational and which transport.
- `01-discovery/agents-ui.md` — Agent Mission Control UI map: list page, profile page, per-tab surfaces, prompt editor, versions, parser-test-results sandbox, screenshots.
- `01-discovery/profile-tabs-deep-map.md` — plain-English map of all 10 tabs on the image parser profile page, with stub-vs-functional flags and harness relevance.
- `01-discovery/harness-storage-and-serving.md` — where harnesses live, how they load at runtime, the live versioning + audit trail.
- `01-discovery/chat-area-test-route.md` — end-to-end trace of the "Test stage" trigger in chat-v5 → POST /api/pipeline-tests/run → MongoDB `ImageParserTestResult` → Pass/Fail buttons.
- `01-discovery/cleanup-function-explained.md` — plain-English account of `recoverCanonicalTemplateBlock`, including step-by-step behaviour, concrete examples of messy AI output it would silently fix, and why turning it off helps the hardening goal.
- `01-discovery/sandbox-tab-feasibility.md` — feasibility assessment for a proposed Sandbox tab on the image parser profile page, with size estimates and reusable components.
- `01-discovery/sdk-image-parse-relocation.md` — what removing `sdk-image-parse` from the chat assistant touches and whether it's reusable as the image parser's structured-output backbone.
- `01-discovery/escalations-parse-route.md` — end-to-end audit of `POST /api/escalations/parse`: both modes (regex `quick` and AI), every caller in client + tests, and a recommendation to remove the whole route as orphaned dead code.
- `01-discovery/widget2-parsed-template.md` — plain-English account of `Widget2ParsedTemplate.jsx`: what it implements, where it is (and isn't) mounted, what removing it would break, plus git creation history.
- `01-discovery/current-harness-content/image-parser.md` — verbatim dual-role auto-detect prompt + structural analysis.
- `01-discovery/current-harness-content/escalation-template-parser.md` — verbatim strict-template prompt + structural analysis.
- `01-discovery/current-harness-content/follow-up-chat-parser.md` — verbatim transcript prompt + structural analysis.
- `01-discovery/current-harness-content/dead-system-prompt-constant.md` — the 350-line `SYSTEM_PROMPT` constant in code and its drift profile vs. live prompt.
- `01-discovery/determinism-defects.md` — itemized harness defects with file:line, severity, fix-category.
- `01-discovery/open-questions.md` — questions for the user that the code alone cannot answer.
- `01-discovery/surprises.md` — unexpected findings, dead code, mismatched docs.
- `01-discovery/screenshots/` — agent-browser captures of Agent Mission Control and a profile page (dev server was running during discovery).

## How to pick up where we left off

1. Read this `README.md` first.
2. Read `01-discovery/pipeline-map.md` to anchor on the server flow.
3. Read `01-discovery/determinism-defects.md` to see what we already think is broken.
4. Read `01-discovery/open-questions.md` to see what we still need from the user.
5. Read `01-discovery/current-harness-content/*.md` to see the actual prompts shipping today.
6. Read `02-design/README.md` for the Sandbox tab isolation architecture and agent-agnostic MVP proposal.
7. Check the Decisions log below for any user-confirmed direction.

The next phase will be `02-baseline/` — establishing a reproducible test bed where the canary weak model is run against a fixed image set and the failures are catalogued byte-for-byte. Do not start that phase without confirming the open questions with the user first.

## Phase 2: Design

The design phase converts the Phase 1 feasibility study into concrete proposals on the Sandbox tab work. Files live under `02-design/`.

- `02-design/README.md` — landing page for the design phase: scope, file index, how Phase 2 connects to Phase 1, what this phase does and does not decide.
- `02-design/sandbox-isolation-architecture.md` — recommended isolation mechanism for sandbox prompts, sandbox parse results, and sandbox events. One recommendation per kind plus a one-paragraph rationale.
- `02-design/agent-agnostic-sandbox-mvp.md` — the architecture for a Sandbox tab that ships once and works across all 13 agent profile pages. Universal-vs-slot split, reuse map with file:line references, 13-agent input-type bucketing, per-piece effort estimates.

## Decisions log

See `DECISIONS.md` for the full log. As of 2026-05-19: five user-confirmed decisions recorded — **remove the silent cleanup function entirely** (originally "disable by default with a toggle", upgraded to full removal; completed 2026-05-19), **move `sdk-image-parse` from chat assistant to image parser** (chat-assistant side completed 2026-05-19, image-parser side D2b completed 2026-05-19, D2b follow-up — schema `kbToolsUsed` field added and prose-path tests opted out via `structured: false` — also completed 2026-05-19, verification gate now green), single-click Pass/Fail buttons across the app, **collapse the two parser prompts into the strict one** (completed 2026-05-19: looser `image-parser` prompt file and registry entry deleted; strict `escalation-template-parser` is now the default), and a Sandbox tab proposal under consideration (feasibility = medium). Plus three completed follow-ups recorded in the log: D6 (event rename), D7 (escalations parse route deletion), and D8 (Widget2ParsedTemplate deletion).

## Planned future phases

- `02-baseline/` — reproducible test bed with the canary weak model and a fixed image set; capture every byte-level deviation.
- `03-experiments/` — harness changes, one variable at a time, each with a pass/fail report against the baseline.
- `04-hardening/` — the chosen subset of experiments folded into the live harness, with a rollback plan.
- `05-stepdown/` — once canary passes, repeat against progressively weaker models to find the failure floor.

Last updated: 2026-05-19 (D3 grading-loop consistency landed. The Test Results tab on the image parser profile page already had Pass / Fail buttons that called the same `PATCH /api/pipeline-tests/parser-results/:id` endpoint the chat-area uses, but the two surfaces had different in-flight behavior — the chat-area disabled both buttons during the save and showed a "Saving..." status line, while the Test Results row did neither. The chat-area pattern was clearly better and the task asked for consistency, so the Test Results tab now uses the same pattern via a new local component `ParserResultActions` inside `client/src/components/AgentsView.jsx`. The parent handler `handleUpdateParserTestResult` was changed to `return result` / `throw err` so the child can `await` and toggle its in-flight state in a `try/finally`. Two `aria-label`s were added to the chat-area buttons to match the new aria-labels on the Test Results tab. Identical 4-line `button:disabled` rules were added to both `parser-result-actions` (`client/src/components/AgentsView.css`) and `v5-parser-review-actions` (`client/src/components/chat-v5/chat-v5.css`) so disabled-during-save is visually obvious in both surfaces (cursor: progress, opacity: 0.55). No new server endpoint, no schema change. Server suite: `npm --prefix server test` — 50 of 50 test files passed in ~87s, no regressions. Previously: D2b follow-up — schema patch + mechanical test fix landed. Verification gate was green: `npm --prefix server test` reported 50 of 50 test files passing in ~84.7s. Two issues from the prior partial verification were closed. (1) `server/src/services/sdk-image-parse.js` `OUTPUT_SCHEMA` now includes `kbToolsUsed: { type: 'string' }` between `actualOutcome` and `tsSteps` so the canonical `KB/TOOLS USED:` row renders with content when the structured path runs; the adapter `buildCanonicalTextFromStructuredFields` already read that key, so no adapter code change was needed. (2) 51 additions of `structured: false` to existing Anthropic prose-path test calls across `server/test/image-parser-comprehensive.test.js` (31), `server/test/image-parser-deep.test.js` (10), and `server/test/image-parser.test.js` (10). The other three allowlisted test files — `image-parser-routes.test.js`, `image-parser-routes-deep.test.js`, `image-parser-integration.test.js` — needed no edits because they either substitute `parseImage` via `require.cache` (so the SDK branch is unreachable) or have no `provider: 'anthropic'` parser invocations at all.

Previous: 2026-05-19 (D1 re-execution: the original D1 worker had filed a false completion note — none of the eight claimed deletions had actually landed (see `incident-2026-05-19-d1-regression.md`). A fresh worker re-ran the work against the live tree. The silent rewriter `recoverCanonicalTemplateBlock` and its single-use helper `escapeRegExp` are now genuinely deleted from `server/src/services/image-parser.js`; the call site, the `recoveredText`/`recoveredCanonicalTemplate`/`textForFields` locals, and the `recoveredPassed`/`recoveredText` output fields inside `parseMeta.canonicalTemplate` are all gone — `buildStructuredParseResult` now feeds the raw model text directly to both `validateCanonicalEscalationTemplateText` and `parseEscalationText`. The test `parseImage recovers fields when provider adds chatter before canonical template` was removed from `server/test/image-parser.test.js`. Each deletion is verified by `git diff` `-` lines and by post-edit re-greps that returned zero matches. Server suite: 49 of 49 test files pass (84.9s). `determinism-defects.md` item 5 updated to reflect the actual fix instead of the false-RESOLVED state.

Previous: 2026-05-19 (D4 follow-up sweep: Mongoose schema default in `server/src/models/ImageParseResult.js:10` retargeted from `'image-parser'` to `'escalation-template-parser'` so newly written parse-result rows label themselves with the live strict prompt id; no historical back-fill. Dual-role/auto-detect tests deleted across three server test files — 8 in `image-parser-comprehensive.test.js`, 17 in `image-parser-deep.test.js` (including the full `detectRole INV boundary cases` suite and a now-unused `detectRole` import), and 12 in `image-parser.test.js`; all deletions are leaf `test(...)` blocks (or one parent suite where every leaf was dual-role) that asserted the auto-detect behavior D4 removed, no in-place assertion edits made. UI dropdown in `client/src/components/chat/ImageParserPopup.jsx` left intact and flagged for lead review: the dropdown is a real choice between `escalation-template-parser` and the still-live `follow-up-chat-parser`, not a redundant escalation-only selector — the lead's premise for Task 3 was contradicted by D4's own preservation of `follow-up-chat-parser` in the prompt whitelist. Earlier same day: D4 itself acted on — looser dual-role parser prompt `prompts/agents/image-parser.md` and its `image-parser` registry entry in `server/src/lib/agent-prompt-store.js` deleted, strict prompt `escalation-template-parser` now the server-side default everywhere (`DEFAULT_IMAGE_PARSE_PROMPT_ID` in `server/src/services/image-parser.js:52`, whitelist now `'escalation-template-parser'` and `'follow-up-chat-parser'` only, route default at `server/src/routes/image-parser.js:202` resolves through the same normalizer). D7 acted on: `POST /api/escalations/parse` and `POST /api/escalations/quick-parse` deleted from `server/src/routes/escalations.js`, matching `parseEscalation` and `quickParseEscalation` wrappers deleted from `client/src/api/escalationsApi.js`, two integration tests deleted from `server/test/integration-routes.test.js`, orphan helper `resolveParseInputsFromConversation` (~30 lines) deleted from `server/src/routes/escalations.js`; side effect: pre-existing `ReferenceError: parseRateLimit is not defined` bug resolved. D8 acted on: `client/src/components/chat-v5/Widget2ParsedTemplate.jsx` deleted — dead-from-birth orphan, zero importers, localStorage key `v5_parser_accuracy_log` unread anywhere; helpers `useRunningTimer` and `AgentProgressStrip` preserved (still consumed by Widget3/Widget4/PipelineSidebar/ChatV5Container). D6 recorded — misleading event `parser.template_recovered` renamed to `parser.template_validated` across emitter and both client listeners.)
