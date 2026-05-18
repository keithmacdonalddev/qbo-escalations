# Challenge V4 — Calm. Strip everything that isn't a user goal.

V3 was rejected. The product owner said all 9 entries have cognitive overload. Better features did not mean better design — they meant more clutter. V4 is strip-mode.

This is a **basic workflow with user goals**. The page exists to serve a specialist who wants to close a case fast and quietly. Anything that does not directly serve a user goal is clutter.

## The four user goals — only these

1. **See what's wrong** — understand the case (triage delivers this)
2. **Confirm or doubt the AI** — trust the triage or revise it
3. **Get the answer** — converse with the main analyst until you have the answer
4. **Use the answer** — copy, paste, send to the phone agent

That's it. Four goals. Every visible element justifies itself against one of these or it gets deleted.

## What changed from V3 — read twice

- **MAX 2 unique features per entry.** The third feature you wanted — kill it. Three was V3's directive and produced bloat. Two is the new ceiling.
- **Strip-mode aesthetic.** If you can remove an element without losing a user goal, remove it. Calm-to-the-point-of-feeling-empty is acceptable.
- **"Showing what the AI is doing" is not a goal.** Status spines, scrubbers, pipeline visualizers, confidence meters, drift detectors — most of V3's chrome was performing the AI to the operator. The operator does not care. Show only what they need to know right now.
- **Each designer has a forced creative angle**, delivered in your individual launch message. The angle is non-negotiable. Apply it to the four user goals.
- All earlier locked principles still apply (no scroll, triage stays, parser secondary, webcam first-class, all agent identities visible at scaled weight, main analyst as a *who*, chassis for multi-workflow).

## The workflow — unchanged

```
[1] image upload
[2] parser runs
[3] parsed fields visible
[4a/4b] INV search ║ TRIAGE  (parallel; triage never gated on INV)
[5] main analyst arrives
[6] brief simulated chat (3-5 turns)
```

## Anti-patterns from V3 that lost

- Feature checklists (Evidence Pins + Drift Detector + Trust Meter + Triage Tuner + Branch + Phone Whisper + Provenance Hover...): clever individually, overwhelming collectively
- Visual density that requires the operator to study before using
- Multiple panels demanding equal attention
- Status spines / pipeline visualizers / scrubbers — performance of the AI, not user value
- Crowded triage cards listing severity + category + fast read + next step + missing info + confidence + chips + buttons all at once
- Three loud places during chat (triage + INV + chat all competing)

## Self-check — answer yes to ALL or redesign

1. Could a normal person use this with zero explanation?
2. Could the operator close their eyes for a second and not feel like they missed something?
3. Are you at 2 unique features or fewer?
4. Does your forced creative angle structurally shape the design (not bolted on)?
5. Is anything visible that doesn't serve one of the 4 user goals?
6. Does the page feel quiet at all times?
7. Is the main analyst the only "loud" thing when they are speaking?

## Deliverable

One self-contained HTML file at `prototypes/escalation-chat-challenge/v4/{your-slug}/index.html`. Inline CSS/JS, no CDN. JS interactivity for the full arc.

At the TOP of your file in a comment block:
- Your forced creative angle (from your launch message)
- Your 2 features named
- One sentence per visible region justifying it against one of the 4 user goals

## Arena

`prototypes/escalation-chat-challenge/v4/ARENA.md` — post freely. SendMessage other designers freely. Discover their forced angles via arena chatter if you want.

## What "winning" looks like

Operator opens it. Everything visible is exactly what they need. Nothing competes for their attention. They never feel overloaded. They close the case. They want to do it again tomorrow morning. Quiet, obvious, calm, done.
