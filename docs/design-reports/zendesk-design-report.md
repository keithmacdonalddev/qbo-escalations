# designer-zendesk — V4 design report

**Output:** `prototypes/escalation-chat-challenge/v4/zendesk/index.html`
**Forced angle:** SINGLE FOCAL POINT — only one element is at full size and active at any moment.

## The angle, structurally

V3 lost because nine entries all crowded four edges of the screen. V4 rule: at any given instant the operator's eye should land on exactly one rectangle. The workflow itself is a focus-shift: intake → parsed → triage → analyst. Each stage *replaces* the previous focal region rather than stacking beside it.

The hard constraint from directive B (triage stays accessible during chat) is solved by the **glance-strip** — a calm, peripheral pill at the bottom carrying case id, customer, INV, and triage verdict. Always there, never loud (55% opacity). Hover lifts it to 100%. Click on it during chat swaps focal to triage for ~2.4s, then auto-returns to chat. The operator never loses triage; they just don't have to fight it for attention.

## Two features (strict ceiling)

1. **Focal-shift staging.** A single `.focal` panel is centered in the stage. Other focals exist in the DOM but carry `data-hidden="true"` (opacity 0, position absolute, no pointer events). Transitions are 320ms ease with a 6px translateY rise. The result: the page literally cannot show two things at once.
2. **Glance-strip.** A bottom-centered pill that aggregates the four facts that matter at any moment (case, customer, INV, triage verdict). Peripheral by default. Acts as the persistent triage access during chat, satisfying directive B without competing for attention.

The third feature I would have added — a side-by-side "evidence" panel during chat — was killed. The glance-strip + the analyst's quoted facts in the chat body cover the same job.

## Regions and which user goal each serves

| Region | Goal | Visible when |
|--------|------|--------------|
| Focal: intake | (1) see what's wrong → seed the case | intake stage |
| Focal: parsed | (1) see what's wrong → confirm we read the screenshot right | parsed stage |
| Focal: triage | (2) confirm or doubt the AI | triage stage (and brief peek-back during chat) |
| Focal: chat | (3) get the answer, (4) use the answer | chat stage |
| Compose tray | (3) get answer, (4) use answer (Copy on the answer bubble) | only during chat |
| Glance strip | (1) + (2) peripheral, always-available | from parsed stage onward |
| Top bar | passive case identity | always (28px, mute text) |

Nothing else is in the DOM. No status spine, no parser progress bar, no confidence meter, no "agent identity wall," no pipeline visualizer. V3 anti-patterns were addressed by deletion, not redesign.

## Self-check against the prompt

1. Could a normal person use this with zero explanation? **Yes** — one rectangle at a time, with a single primary action button.
2. Could the operator close their eyes and not feel like they missed something? **Yes** — glance strip carries the only state worth tracking; everything else is paused.
3. Two unique features or fewer? **Yes** — focal-shift staging + glance-strip.
4. Does the angle structurally shape the design? **Yes** — the entire layout is "one focal rectangle"; remove that and the design collapses.
5. Anything visible that doesn't serve the four goals? **No** — top bar is 28px identity only; everything else has a goal mapping above.
6. Quiet at all times? **Yes** — warm paper background, 1px hairlines, one accent color, motion is restrained (≤320ms).
7. Main analyst the only loud thing when speaking? **Yes** — the answer is the only colored block (left accent bar, light blue tint). Their first message is plain ink; the answer-for-the-phone-agent bubble is the one place color is used.

## Notable design choices

- **Answer bubble has the Copy button inline.** Goal 4 ("use the answer") is one click away from the only colored block on the page. The button label changes to "Copied" with an OK-green color, then resets after 1.6s.
- **Doubt path is calm.** "Doesn't fit" does not pop a modal. It quietly shrinks the verdict line and brings in the analyst in override mode. The operator stays on the rails.
- **The analyst is a who.** "Maren · payroll specialist" — named, role-tagged, addressed in the second person ("Ask Maren a follow-up…"). The chat reads as a conversation, not a system response.
- **Webcam, sample, and click-to-upload share the same focal.** Intake offers three paths in one calm region, never escalating to a multi-tab UI.
- **Color discipline.** One accent (`#2d6cdf`) for the analyst, one warm (`#c87a3b`) for the triage verdict highlight, one success green (`#3a8a5a`) for the Copy confirmation and the live dot. Mute everywhere else.
- **No scroll.** `html, body { overflow: hidden }`; only the chat stream scrolls internally.

## What I deliberately did *not* do

- No confidence percentage on the triage. It's noise. The verdict is either right or wrong, and "doubt" is a one-click escape.
- No "AI is thinking" spinner spine. The page just transitions calmly between stages.
- No multi-pane comparison during chat. The glance strip handles all peripheral needs.
- No agent roster bar. Maren is named in the chat, role-tagged. That is enough identity.
- No keyboard shortcut overlay, no command palette, no settings affordance.

## Files

- `C:/Projects/qbo-escalations/prototypes/escalation-chat-challenge/v4/zendesk/index.html` — the entry
- `C:/Projects/qbo-escalations/docs/design-reports/zendesk-design-report.md` — this report
- `C:/Projects/qbo-escalations/prototypes/escalation-chat-challenge/v4/ARENA.md` — posted angle summary
