# Challenge: The Escalation Pipeline — Calm, Obvious, Award-Winning

You are one of several designers competing to redesign **a single continuous moment** in a QBO escalation specialist's day. The product owner has built today's app, uses it daily, and avoids opening it because the UI is cognitive overload. They have already rejected one round of submissions. They have never seen a design they liked for this. You are building the version they would actually want to open every morning.

The bar is "award-winning." Scope is small on purpose. There is nowhere to hide.

## What you are designing — one continuous arc

The operator drops a screenshot. Three agents work. The expert arrives. They begin to speak. That is the entire scope.

```
[1] image upload                    operator hands over a screenshot of an
                                    escalation template DM from a phone agent
       ↓
[2] parser runs                     vision LLM transcribes 9 known fields
       ↓
[3] parsed fields visible           case is now legible as structured data
       ↓
   ┌───┴───┐
[4a] INV search   [4b] TRIAGE      run in parallel; either may finish first
   (helpful)    (PRIMARY SIGNAL)
       └───┬───┘
           ↓
[5] main analyst arrives            with all context organized,
   (the expert)                     ready to speak
           ↓
[6] brief simulated chat            3-5 turns is enough — show the expert begins,
                                    the operator is now in conversation
```

That's it. That's the whole thing. No artificial seams between pipeline and chat — it is one continuous moment.

## Who is using this

A QBO escalation specialist. They sit in this tool all day. They are an expert at their job and want to stop fighting their software.

## What the agents do (and which one is the star)

- **Parser** — junior staff. Vision LLM. Reads the screenshot. Outputs 9 labeled fields (Attempting to / Expected outcome / Actual outcome / Customer info / Agent info / Steps tried / etc.). Identity quietly visible.
- **INV Search** — junior staff. LLM with database tools. Searches historical investigation records (`INV-XXXXXX` format). Returns the best-matching past case if one exists. Identity quietly visible.
- **Triage** — senior staff. **Dependable** LLM. Given the parsed template, produces the operator's primary understanding:
  - **Category** — one of nine fixed values: `payroll, bank-feeds, reconciliation, permissions, billing, tax, reports, technical, invoicing`
  - **Severity** — `P1` (broad outage / security / data loss / deadline-blocking), `P2` (time-sensitive filing / payroll / payment with imminent deadline), `P3` (single-customer block, workaround exists), `P4` (informational / cosmetic)
  - **Fast read** — one-sentence summary of what's actually wrong
  - **Immediate next step** — what the operator should do first
  - **Missing info** — what the phone agent didn't include but the case needs
  - **Confidence** — `high | medium | low`
  - Identity quietly visible.
- **Main Analyst** — THE EXPERT. The brains. The oracle. The operator's partner in conversation. Knows the full QBO playbook. Receives all context from the prep agents and arrives ready to speak. **Identity must be felt — this is a *who*, not a *what*.** Operator is meeting them.

The pipeline forks after the parser. INV Search and Triage run in parallel and race. **The design MUST handle asynchronous arrival: triage appears the moment it's ready, never gated on INV finishing.**

## The locked principles

These are not optional. Violating one = you lose.

1. **One continuous arc.** No seam between pipeline and chat. The operator never feels a handoff — they were *delivered into the presence of the expert*, who already knows their case.
2. **Triage is the primary signal.** It is the operator's moment of understanding the case. Visually dominant the second it lands. Never gated on INV finishing.
3. **Main analyst is THE brains.** Their arrival is the emotional peak — meeting an expert who already reviewed your case. Identity must be felt strongly (not a model name in 8pt grey).
4. **All progress is visible, but quiet.** Every state is always-known: parser running, parser done, INV running, INV done, triage running, triage done, analyst assembling, analyst speaking. Quiet doesn't mean hidden — it means always-known without shouting. No spinners-as-decoration; no "is something happening?" moments.
5. **All agent identities are visible.** Operator always knows *which model* is doing each job. Visibility scales with role: main analyst's identity is felt strongly; supporting agents' identities are quietly present.
6. **Calm over novel.** Zero learning curve. No new metaphors that require teaching. The operator looks at the screen for the first time and *immediately* knows what they're seeing. If you would have to explain it, you have failed.

## Required surfaces — the six moments

You must show all six. How they flow into each other — and whether the seams between them dissolve — is the whole design problem.

1. **Pre-upload.** Operator ready, no case loaded. Calm.
2. **Image intake.** File, paste, drag, OR webcam. Today's webcam has known pain (sideways stream, no cancel-back-to-upload, controls look like flight cockpit) — solve it; don't repeat it.
3. **Parser running, then parsed.** Visible state change. The 9 fields land.
4. **INV + Triage running, then arriving.** In either order. Triage is dominant when present. INV is supportive context, not a competing focal point.
5. **Main analyst arriving with context.** The expert is now here. They have read everything. They are about to speak.
6. **Brief simulated chat.** 3-5 turns. Show the conversation has started. The arc ends here.

## What kills a submission

- **Cognitive overload.** If a normal person can't immediately understand what's on screen, you lose.
- **Hidden pipeline state.** Mystery is not minimalism. Every step must be visible.
- **AI implementation chrome bleeding into the operator's surface.** No tokens, no dollar amounts, no "source: agent" badges, no "fallback used" warnings, no "runtime mode" displays.
- **A novel interaction model invented for its own sake.** The operator does not want to learn your invention. They want their job to feel easy.
- **Treating the main analyst as just another card in the layout.** They are the expert. The destination. Design accordingly.
- **Re-skinning a generic chat app.** This is not a chat app. It is an agentic pipeline that culminates in a conversation.
- **Showing 9 separate surfaces stitched together.** Show ONE continuous arc.

## What's NOT in scope

- Anything after the chat begins (response template picker, escalation state lifecycle, INV creation flow, follow-up DM handling, sending the response to the phone agent)
- Other entry points (starting an INV directly, trip planner, email composer) — these exist as future ideas, not this design
- A "two competing INV matchers" UI (use only LLM-based; ignore the fallback)
- Volume / dashboard / queue views — this is a single case, beginning to first AI response
- Multi-case context switching — one case at a time

## Deliverable

- **One self-contained HTML file.** Inline CSS + JS. No CDN. No external deps.
- **All six moments visible.** Use state transitions or a small demo control to walk a viewer through the arc.
- **Realistic QBO mock data.** Real-sounding parsed template fields (e.g. Attempting to: "Run unscheduled payroll for terminated employee in CA"). Plausible INV numbers (e.g. `INV-147914 — No option to select bank account when receiving payment via Android app`). Real-sounding triage outputs (e.g. Category: `payroll`, Severity: `P2`, Fast read: "Customer is mid-payroll, terminated employee's final cheque can't process — termination date is after pay period start").
- **JS interactivity required.** Simulated parsing (with visible progress), simulated INV search arrival, simulated triage arrival (dominant when present), simulated main analyst arrival, simulated chat first-response stream.
- **Path:** `prototypes/escalation-chat-challenge/v2/{your-slug}/index.html`

## Your design-system lens

You are assigned a design system as inspiration. **It is a lens for typography, density, color, motion language — not a metaphor or interaction model.** The interaction model is the brief, not your design system. You are not designing "what would Apple do for an escalation pipeline." You are designing "the calmest, most obvious version of this arc, with Apple's voice in the craft."

Your assigned system + report path will be in the message that launches you.

## Judging

The product owner picks the winner. They are the operator. They will know it when they see it. They have not liked any of the V1 entries — five different invented metaphors all produced cognitive overload.

If you must put a rubric in your head, these are six "must be yes":

- Does it feel calm at first glance? — must be yes
- Could a new operator use this without any explanation? — must be yes
- Does triage's arrival feel like understanding lands? — must be yes
- Does the main analyst's arrival feel like meeting the expert? — must be yes
- Is the design-system voice present in craft (type, spacing, motion) but absent in gimmick? — must be yes
- Do all states show progress without shouting? — must be yes

If you can't honestly say yes to all six, redesign before submitting.

## Anti-patterns from V1 (do not repeat)

The previous round produced six technically competent entries that were cognitively overwhelming. They invented:
- Case as a physical card with flip-to-reasoning faces (required learning 6 gestures)
- Case as a deployment with build-log reasoning rail (required understanding ops mental model)
- Case as a living document with margin reasoning bubbles (required learning Google-Docs-comment metaphor)
- Case as a token in a river through six stations (required reading motion as information)
- Case as verbs against an object via command palette (required memorizing commands)
- Case as a decision canvas with 14-command bottom bar (required learning 14 commands)

All technically clever. All wrong for an operator who just wants to close a case fast without thinking. **Do not invent a new mental model. The model is the brief: drop a screenshot → meet the expert.**

## Build approach

- **Skeleton first.** Save your file within 60 seconds of starting. The previous round had a designer stall and fail because they researched for 10+ minutes before writing HTML.
- **Iterate.** Save often. Invisible work scores 0.
- **Web research:** up to 5 searches. Spend them on calm-interface patterns / status visibility / agentic UI 2025-2026 / support-agent calm-mode design. Not on "what does {your system} do for chat."

## Arena

You may post freely to `prototypes/escalation-chat-challenge/v2/ARENA.md` (append-only). The arena is for ideas, taunts, alliances, deception, whatever. No cap on posts. SendMessage other designers freely if their names are addressable. Public competitive pressure is welcome — but remember: novelty for its own sake loses. The arena is theatre on top of disciplined work, not a substitute for it.

## What "winning" looks like

The operator opens it for the first time and immediately understands what's happening. They feel calm. They watch the parser do its work without anxiety. The triage arrives and they think "ah, I get it." The expert arrives and they feel like they're meeting someone. They start the conversation. The whole thing took 15 seconds and 0 cognitive effort and they want to do it again tomorrow morning.

Build that.
