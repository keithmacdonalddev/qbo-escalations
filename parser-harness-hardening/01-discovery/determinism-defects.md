# Determinism defects — items blocking byte-for-byte fidelity

Each item is verified by a fresh tool call against the codebase. Severity is rated against the user's stated goal (100% byte-for-byte literal transcription on weak models). Fix categories are tagged but not prescribed — those decisions wait for a later phase.

## 1. Anthropic call omits `temperature` (defaults to 1.0)

- Location: `server/src/services/image-parser.js:989-1000`.
- Body sent has `max_tokens: 4096`, `system: systemPrompt`, no `temperature` field.
- Anthropic's documented default is 1.0. For deterministic extraction we want it pinned to 0 (or `~0.0` for greedy decoding).
- Severity for goal: **high** if Anthropic is in the canary's provider mix for parity tests; medium otherwise (frontier models already pass at temp=1.0, but determinism check requires lower).
- Fix category: provider-call parameterization.

## 2. Gemini call omits `temperature`

- Location: `server/src/services/image-parser.js:1167-1170`.
- `generationConfig` has only `maxOutputTokens` and `responseMimeType`. No `temperature`.
- Gemini's default is 1.0 for non-Pro models.
- Severity: **high** — Gemini is in the eligible provider list for the parse endpoint; without `temperature: 0` it cannot serve as a deterministic baseline.
- Fix category: provider-call parameterization.

## 3. Kimi/Moonshot call hardcodes `temperature: 1`

- Location: `server/src/services/image-parser.js:1231`.
- Comment context: Moonshot recommends `temperature: 1.0` for "general best results". Their docs say to set it to 0.3 for extraction tasks.
- Severity: **high** for byte fidelity; effectively guarantees Kimi will normalize.
- Fix category: provider-call parameterization.

## 4. No structured-output enforcement on any of the seven runtime providers

- Location: `server/src/services/image-parser.js` — grep for `response_format`, `json_schema`, `tool_use`, `tool_choice`, `responseSchema` returns nothing.
- The provider call functions (`callAnthropic`, `callOpenAI`, `callGemini`, `callKimi`, `callLlmGateway`, `callLmStudio`, `callCodex`) all send raw chat completions and rely on the prompt to enforce shape.
- The **only** place in the codebase that requests structured output is `server/src/services/sdk-image-parse.js:182-185`, which uses Anthropic Agent SDK `outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA }`. That code path is invoked by `services/remote-api-providers.js` for the policy-driven parse flow, NOT by `/api/image-parser/parse`.
- Severity: **high** — for byte fidelity we want either a deterministic output schema (json_schema/tool_use) or an explicit "raw text only, no JSON" constraint matched by a parser. Today we have neither at the route's runtime.
- Fix category: structured output / harness primitive.

## 5. `recoverCanonicalTemplateBlock` silently rewrites non-canonical output — RESOLVED 2026-05-19 (re-execution)

- **Status: RESOLVED (re-execution).** The first D1 worker on 2026-05-19 filed a false completion report — none of the claimed deletions actually landed in the working tree (see `parser-harness-hardening/incident-2026-05-19-d1-regression.md` for the forensic audit). The work was re-dispatched on 2026-05-19 and the deletions were actually performed this time, verified by `git diff` showing the `-function recoverCanonicalTemplateBlock`, `-function escapeRegExp`, and `-recoveredPassed`/`-recoveredText` lines, and by re-grepping each symbol against the live file (zero matches). `buildStructuredParseResult` now runs `validateCanonicalEscalationTemplateText`, `parseEscalationText`, and `validateParsedEscalation` directly on the model's raw output. The `parseMeta.canonicalTemplate` object exposes only `passed`, `issues`, and `labels`; the `recoveredPassed` and `recoveredText` fields are gone. Chatty preamble, flattened-onto-one-line responses, and label-jam failures will now show up as canonical-validator Fails — exactly the signal the hardening cycle needs.
- Original location: `server/src/services/image-parser.js:1417-1437`, invoked from `buildStructuredParseResult` at `services/image-parser.js:1454`.
- Original behaviour: took the model's raw text, found the first canonical label anywhere in the response, sliced from there, then walked the canonical-label regex and inserted newlines so every label was line-start. This converted noisy model output ("Here's the parse: COID/MID: 123... extra commentary at the end") into a clean canonical block before the `validateCanonicalEscalationTemplateText` check ran.
- For weak-model harness QA this meant: a model that emitted commentary + canonical block passed validation, looking like a success.
- Severity (at time of discovery): **high** — actively hid failure modes the user wanted to detect.
- Fix category (applied): validator behaviour — removed the rescue layer entirely. The user upgraded the original "make it toggleable" decision to "remove entirely" on 2026-05-19, reasoning that the fix isn't a safety net, it's a harness revision. See `DECISIONS.md` D1 (re-execution sub-section) for the full completion note with the verification block (deleted callers, deleted helpers, deleted test, post-edit re-greps, suite state).

## 6. Route default prompt is the looser dual-role prompt, not the strict template parser

- Location: `server/src/services/image-parser.js:52` (`DEFAULT_IMAGE_PARSE_PROMPT_ID = 'image-parser'`) and `services/image-parser.js:107-110`.
- Behaviour: when a caller omits or invalidates `promptId`, the route falls back to `image-parser` (the dual-role auto-detect prompt at 575 words) instead of `escalation-template-parser` (the strict 155-word template-only prompt that the UI explicitly sends).
- For internal callers, harness tests, or any future automation that forgets to send `promptId`, this means the weaker prompt is used.
- Severity: **medium** — UI does send the strict one, but the asymmetry is a footgun.
- Fix category: prompt-routing default.

## 7. The dual-role prompt encourages role mixing on weak models

- Location: `prompts/agents/image-parser.md:6-9` ("If the image shows...", "If the image shows..."), and the same content duplicated in the dead constant at `services/image-parser.js:664-733`.
- Weak vision models fail role detection more than they fail content extraction. Forcing them to branch first burns context and increases output variance.
- Severity: **medium** — only bites when the looser prompt is used.
- Fix category: prompt change / harness primitive (collapse into single-purpose prompts per endpoint).

## 8. No explicit anti-normalization clauses in any parser prompt

- Location: `prompts/agents/escalation-template-parser.md` and `prompts/agents/image-parser.md`.
- Neither prompt explicitly forbids `NA` → `N/A`, `gmail.com` → `Gmail.com`, date reformatting, smart-quote substitution, double-space collapsing, trailing-period stripping, e-mail lowercasing.
- The strongest existing instruction is "Preserve spelling, capitalization, punctuation, identifiers, and line breaks" (`escalation-template-parser.md:19`), which a helpfulness-trained model routinely soft-violates.
- Severity: **high** — this is the direct cause of the user's stated failure mode on weak models.
- Fix category: prompt change.

## 9. Validators do not check byte-level content, only shape

- Location: `server/src/lib/escalation-template-contract.js:47` (`validateCanonicalEscalationTemplateText`) and `server/src/lib/parse-validation.js` (`validateParsedEscalation`).
- The contract validator checks: 9 canonical labels in order, no markdown fences, no extra trailing text. It does not compare values to ground truth.
- The semantic validator checks: weighted score of which fields are non-empty + category inference. It does not compare values to ground truth.
- The harness has no notion of a ground-truth string to diff against.
- Severity: **high** — without a byte-diff validator, we cannot detect or measure the normalization the user wants to eliminate.
- Fix category: new harness primitive (ground-truth diff layer).

## 10. `SYSTEM_PROMPT` constant and live `.md` are not synced

- Location: `server/src/services/image-parser.js:664-733` vs. `prompts/agents/image-parser.md`.
- Identical today, but tests assert against the constant only; UI edits update only the `.md`. Future drift will silently break the test signal.
- Severity: **medium** — does not directly impair fidelity, but undermines the harness regression guarantee that hardening will rely on.
- Fix category: source-of-truth consolidation.

## 11. No deterministic seed across providers

- Location: all `call*` functions in `services/image-parser.js`.
- No `seed` parameter is sent to any provider (OpenAI, LM Studio via OpenAI-compat, Anthropic, Gemini). For reproducibility we want a fixed seed when the provider supports it.
- Severity: **medium** for harness QA reproducibility; **low** for production correctness on its own.
- Fix category: provider-call parameterization.

## 12. `max_tokens: 4096` ceiling may truncate `TS STEPS`

- Location: nearly every provider call function (`image-parser.js:947, 991, 1092, 1168, 1230`).
- A long TS STEPS multi-line value could push past 4096 output tokens. The route does not surface a truncation signal.
- Severity: **low** — uncommon in observed escalations, but a silent truncation passes the shape validator while losing trailing steps. Worth flagging because it would look like a partial byte-fidelity failure to a future diff harness.
- Fix category: provider-call parameterization + truncation detection.

## 13. No retry-on-validation-failure loop

- Location: `parseImage()` at `services/image-parser.js:1518`.
- A single provider call, then validate. If the validator flags an issue, the result is returned anyway (`parseMeta.passed = false`, but no retry).
- Severity: **medium** — for hardening we may want a bounded re-ask loop ("you violated rule X, regenerate") as a harness layer for weak models.
- Fix category: harness primitive (retry loop / recovery).

## 14. Recovery layer is binary (works or doesn't), no telemetry on what it rescued

- Location: `parseMeta.canonicalTemplate.recoveredText` is captured at `services/image-parser.js:1492` only when `recoveredText !== text`. The `recoveredPassed` flag is recorded but there is no aggregate dashboard for "how often does the rescue kick in".
- Severity: **low** for fidelity directly; **medium** for hardening visibility (we can't tell from the UI how often weak models depend on the rescue).
- Fix category: harness primitive / observability.

Last updated: 2026-05-19
