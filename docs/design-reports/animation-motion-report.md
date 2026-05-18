# designer-animation-motion — V4 Strip-Mode Entry Report

**Prototype:** `prototypes/escalation-chat-challenge/v4/animation-motion/index.html`
**Forced angle:** NO BUTTONS. Zero button-shaped affordances. Motion teaches the interface.
**Date:** 2026-05-16

---

## The thesis

A button is a static rectangle that asks "click me." If you replace the question with a *gesture* and let the *card* lean toward what comes next, the interface stops shouting and starts whispering. Motion is the affordance.

V3 lost because every designer covered the canvas in chrome to *prove* the AI was working. V4 strip-mode says: stop performing the AI. So I stripped further — I stripped the controls themselves. What's left has to *move* if it wants to be used.

## The 2 features (the third was killed)

1. **Gravity Cards** — every card has weight; it leans, drifts, breathes toward the operator's next action. Pulling the triage card down "accepts" it. Pushing it up "revises" it (and primes the reply input). Dragging the latest analyst reply down into the drawer "copies" it. No buttons; only weight.
2. **Whisper Hold** — press and hold the triage card to reveal parser fields and INV details. Press and hold anywhere else to summon a first-use coach. The coach appears once on first visit (via localStorage) and again on demand. After the first hold, you know everything.

(The third feature I wanted — a "scrub the conversation back in time by dragging horizontally" — would have been delightful but it isn't one of the 4 user goals. Killed.)

## The 4 user goals, each mapped to a visible region

| Goal                    | Region                                | How                                                                                       |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| See what's wrong        | Triage tile (left)                    | The biggest words on the page are the triage headline + body. Severity/INV are footnotes. |
| Confirm or doubt the AI | Triage tile gesture                   | Pull DOWN to accept (card leans + glows green). Push UP to revise (card leans + primes the reply field with "I'd revise the triage —"). |
| Get the answer          | Conversation column (right)           | Main analyst speaks; latest analyst turn is the only loud thing — softly pulsing card. Type freely, Enter to send. |
| Use the answer          | Drawer (bottom)                       | Drag the latest analyst reply into the drawer. Drawer turns green. Text is on the clipboard. |

Nothing else exists. The webcam is a 54px breathing dot in the corner (first-class but not loud). Agent identities are 6px dots above the drawer — they swell on hover, fade otherwise.

## How motion solves the discoverability problem

The brief warns: no buttons creates a learning curve. My answers:

- **Breathing affordances.** The triage card has a subtle 5.2s breath. The latest analyst reply has a 3.6s pulse. The reply field underline has a horizontal sweep on focus. The drawer arrow bobs. Anything that moves can be touched.
- **Lean hints.** "pull down to accept" and "push up to revise" live faded at the edges of the triage card. They brighten when the card actually leans that direction.
- **First-use coach.** A radial vignette dims the page once, with three one-line tips anchored to the three regions. Dismisses on tap. Never returns (localStorage).
- **Press-and-hold fallback.** Hold anywhere with no specific affordance and a ring ripples + the coach reappears. The "help button" is a gesture instead of a button.
- **Affordance asymmetry.** The latest analyst turn has a different background and a soft border. Older turns are flat text. Only the *useful* thing is touchable-looking.

## Calm checklist (V4 self-check)

1. Could a normal person use this with zero explanation? — Yes, with the once-only coach. Without the coach, the press-and-hold fallback always recovers.
2. Could the operator close their eyes for a second and not feel like they missed something? — Yes. Nothing animates faster than a 3.6s pulse. No flashes, no slides-in unless you typed.
3. ≤ 2 unique features? — Yes (Gravity Cards, Whisper Hold).
4. Forced angle structurally shapes the design? — Yes; there is literally no button-shaped element anywhere in the DOM.
5. Anything visible that doesn't serve a goal? — No. Webcam and presence dots are below 50% opacity at rest, surfacing on hover.
6. Quiet at all times? — Ambient breath + one pulse on the latest reply. That's it.
7. Main analyst the only loud thing when speaking? — Yes; the latest analyst turn is the only element with a soft tinted background and pulse.

## Risks & where this could lose

- Gestures on first contact still require the coach. If the coach is dismissed by accident before reading, the press-and-hold fallback saves them — but they may not discover it. Mitigation: the lean-hint text is *always* visible on the triage card.
- Drag-to-copy on the analyst reply means accidental tiny drags do nothing — threshold is 120px. Below that it springs back. This is intentional; copy is a deliberate gesture, not a slip.
- `prefers-reduced-motion` collapses every animation to a no-op. The lean-hints remain visible static text, so the design degrades to "read the hint, do the gesture." It still works without motion.

## File paths

- Prototype: `C:\Projects\qbo-escalations\prototypes\escalation-chat-challenge\v4\animation-motion\index.html`
- This report: `C:\Projects\qbo-escalations\docs\design-reports\animation-motion-report.md`
