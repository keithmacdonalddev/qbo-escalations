# Open questions for the user

Questions the code alone cannot answer. Each is specific enough to answer in one sentence.

## Q1 — Canary model location and access pattern

Is the canary weak model `google/gemma-4-e4b` served via LM Studio at `LM_STUDIO_API_URL`, via the LLM Gateway, or via Codex CLI? (The provider list at `server/src/services/image-parser.js:69-72` supports all three local-ish entry points, and the route does not record which physical model corresponds to which abstract provider.)

## Q2 — Should hardening collapse to a single parser entry point

The route accepts three prompt ids today (`image-parser`, `escalation-template-parser`, `follow-up-chat-parser`). For the byte-fidelity goal on escalation templates, do you want to (a) keep `image-parser` as a separate looser fallback for INV lists, (b) deprecate `image-parser` entirely once the strict template parser is hardened, or (c) keep all three but make the route default the strict one instead of the looser one?

## Q3 — Is the follow-up-chat-parser in scope for this phase

The follow-up parser's correctness model includes dedupe across overlapping screenshots, which is fundamentally incompatible with byte-for-byte fidelity. Is hardening this prompt in scope for the current effort, or is it deferred until the escalation-template path is locked?

## Q4 — Ground truth source for the byte-diff validator

The harness needs a ground-truth string to diff model output against per image. Will you provide hand-typed truths (slow, authoritative), use a frontier-model "judge" as a quasi-truth (fast, biased), or both with an explicit primary truth file? This decision drives the test-bed design in `02-baseline/`.

## Q5 — Recovery layer policy for the canary

`recoverCanonicalTemplateBlock` (`services/image-parser.js:1417`) silently rewrites non-canonical output before validation. For the canary harness, do you want (a) recovery on, fidelity measured post-recovery (current behaviour); (b) recovery off, fidelity measured on raw model output; (c) recovery on but with a "rescue happened" flag and fidelity reported both ways?

## Q6 — Acceptable cost of structured output

Adding `tool_choice` / `json_schema` / `responseSchema` parameters to the provider calls will force the model down a more constrained path that typically improves shape compliance but can degrade open-ended text fidelity. Are you OK trading some flexibility for stronger shape guarantees, or do you want to keep raw-text outputs and lean on validators?

## Q7 — Does temperature pinning apply uniformly

Today three providers omit temperature (Anthropic, Gemini) or hardcode it to 1 (Kimi). Do you want all providers pinned to a near-zero temperature for the canary, or do you want to leave provider behaviour at vendor defaults and only constrain at the prompt layer?

## Q8 — Test-suite policy

The 350-line `SYSTEM_PROMPT` constant at `services/image-parser.js:664-733` is only used by tests. Is it acceptable for the hardening pass to delete the constant and rewrite `server/test/image-parser-comprehensive.test.js` to read prompts from disk via `getRenderedAgentPrompt`, or do you want to keep the constant for some other reason?

## Q9 — Snapshot directory git policy

`prompts/versions/agents/` is not listed in `.gitignore`. If a user starts editing prompts via the UI, snapshot files will start being tracked by git unintentionally. Do you want them gitignored, or do you want them committed as a permanent history?

Last updated: 2026-05-19
