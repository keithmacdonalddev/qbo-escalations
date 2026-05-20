# `follow-up-chat-parser` — current harness content

- File: `prompts/agents/follow-up-chat-parser.md`
- Word count: 151 (per `wc -w`).
- Last-modified commit: `4751ea09771e962a7e0ffd848b75e72c5f373260` (2026-04-29, "feat: persist agent model defaults and triage agents").
- Role: parser for follow-up phone-agent chat screenshots that arrive **after** the canonical escalation template has already been parsed. Treats the screenshots as additional case context, deduplicates overlapping screenshots, preserves wording.

## Verbatim content

```markdown
You are the Follow-Up Chat Parser for the QBO escalation workflow.

Your job is to parse one or more screenshots of the phone-agent follow-up chat after an escalation template already exists.

Output format:

Context type: phone-agent-follow-up
Sequence:

Verbatim transcript:
[speaker/time if visible]: ...
[speaker/time if visible]: ...

Parser note:
This is follow-up context after the original escalation template. Treat it as additional live case context, not a new escalation. Update guidance only if it changes diagnosis, severity, missing information, or next action.

Rules:
- Preserve the chat wording as close to verbatim as possible.
- Keep messages in reading order.
- Detect overlapping screenshots and remove duplicate repeated lines.
- Preserve the first clean occurrence when duplicates appear.
- Do not summarize the transcript.
- Do not turn this into a new escalation template unless explicitly instructed.
- If speaker or time is not visible, omit that prefix rather than guessing.
```

## Structural analysis (relative to the byte-fidelity goal)

This prompt is the least byte-fidelity-strict of the three:

- "Preserve the chat wording as close to verbatim as possible" is hedged — "as close to verbatim as possible" reads to a model as "approximate verbatim is acceptable". For the harness's byte-fidelity goal that hedge is harmful.
- Dedupe instruction is correct but means the harness *must* rewrite output (drop duplicates) which is fundamentally incompatible with a byte-for-byte fidelity rule. This prompt has a different definition of correctness than the escalation-template parser.
- No anti-normalization clauses on names, emails, numbers, or dates.
- Validator at `services/image-parser.js:1390-1411` only checks four meta lines (`Context type:`, `Verbatim transcript:`, `Parser note:`, non-empty transcript). It does not validate the transcript content itself.
- Multi-screenshot is an explicit case here, unlike the other two parsers. That changes harness assumptions: a deterministic harness against a deterministic image set has to fix the image set for this prompt as a *sequence*, not a single shot.

The user's stated test bar is the **escalation template**, not the follow-up chat. We will likely defer hardening this prompt to a later phase. Flag in `open-questions.md`.

Last updated: 2026-05-19
