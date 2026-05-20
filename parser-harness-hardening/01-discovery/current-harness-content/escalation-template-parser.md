# `escalation-template-parser` — current harness content

- File: `prompts/agents/escalation-template-parser.md`
- Word count: 155 (per `wc -w`).
- Last-modified commit: `202cfe8147b92c7544b01b21c1f9b024ce9050b3` (2026-04-04, "chore: workspace update with agent teams, chat refactoring, image parser improvements, and memory consolidation").
- Role: the **strict** single-template prompt. This is the prompt that the chat UI `ImageParserPopup` sends by default (`client/src/components/chat/ImageParserPopup.jsx:30`). It is the harness most likely to be the canary's target.

## Verbatim content

```markdown
You are the Image Parser for the QBO escalation workflow.

Your job is narrow: read one screenshot of the known escalation template and output the canonical template text only.

Output exactly these labels, in this order:

COID/MID:
CASE:
CLIENT/CONTACT:
CX IS ATTEMPTING TO:
EXPECTED OUTCOME:
ACTUAL OUTCOME:
KB/TOOLS USED:
TRIED TEST ACCOUNT:
TS STEPS:

Rules:
- Output no commentary, no markdown, no bullets, and no extra headings.
- Read every visible value exactly as written.
- Preserve spelling, capitalization, punctuation, identifiers, and line breaks.
- If a value is missing, hidden, blank, or unreadable, leave the value blank after the label.
- Do not include AGENT, CATEGORY, SEVERITY, OPERATOR NOTE, or any other non-canonical field.
- Do not diagnose, summarize, rewrite, or infer what the customer means.
- If COID and MID are both visible, include both in COID/MID separated by a slash.
- TS STEPS may be multi-line and should preserve visible line breaks.
```

## Structural analysis (relative to the byte-fidelity goal)

This prompt is substantially better than `image-parser.md` for the goal — much shorter, no role-detection branching, no `[value from image]` placeholders, and an explicit list of forbidden non-canonical fields. Still, for byte-for-byte fidelity it has gaps:

- "Read every visible value exactly as written" and "Preserve spelling, capitalization, punctuation, identifiers, and line breaks" are the closest we get to anti-normalization. Both rely on the model interpreting "exactly as written" the way the user means it. Frontier models do; weaker models often interpret it as "extract the intent, normalize the form".
- No explicit prohibition on common normalisations: `NA` → `N/A`, `gmail.com` → `Gmail.com`, `1-2-2026` → `01/02/2026`, double-space collapsing, smart-quote conversion, e-mail address lowercasing, trailing-period stripping.
- No declarative output schema (the validator at `lib/escalation-template-contract.js:47` is what enforces the 9-label shape post-hoc).
- No few-shot example of correct output to anchor the model.
- "Do not include AGENT, CATEGORY, SEVERITY, OPERATOR NOTE" is good — it tells the model not to invent a tenth field — but weak models often invent a `STATUS:` or `NOTES:` row anyway; the recovery layer at `services/image-parser.js:1417` will silently strip those, so we will not see the failure unless we look at raw output.
- "TS STEPS may be multi-line and should preserve visible line breaks" but the field is treated as the terminal multi-line field by `escalation-template-contract.js:99-101`. A model that puts a non-canonical field after TS STEPS will have it swallowed into the TS STEPS value.

This is the prompt that needs the most hardening attention for the goal.

Last updated: 2026-05-19
