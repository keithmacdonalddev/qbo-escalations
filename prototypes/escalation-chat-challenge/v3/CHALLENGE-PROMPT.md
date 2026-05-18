# Challenge V3: The Agentic Workflow Page — Award-Winning, User-First

V2 produced 9 technically competent entries that the product owner rejected. Every single one delivered a top-down vertical stack. Every one required the operator to scroll to see critical info. Triage disappeared once chat arrived. Webcam was an afterthought. Nobody invented anything genuinely unexpected. Nobody kept the operator at the center of every decision.

The bar for V3 is "award-winning." Read the entire brief twice before writing a single line of HTML. The product owner is the operator and will know it when they see it.

## What you are designing — unchanged from V2

One continuous agentic-workflow arc:

```
[1] image upload                    operator hands over a screenshot
       ↓
[2] parser runs                     vision LLM transcribes 9 template fields
       ↓
[3] parsed fields visible           case is now legible
       ↓
   ┌───┴───┐
[4a] INV search   [4b] TRIAGE      parallel; either may finish first;
   (helpful)    (PRIMARY SIGNAL)    triage never gated on INV
       └───┬───┘
           ↓
[5] main analyst arrives            the brains, the expert, the oracle
           ↓
[6] simulated chat (3-5 turns)
```

## The agents — unchanged from V2

- **Parser** — vision LLM; reads screenshot, outputs 9 labeled fields. Junior. Identity quietly visible.
- **INV Search** — LLM with database tools; matches historical INV-XXXXXX records. Junior. Identity quietly visible.
- **Triage** — dependable LLM; produces the operator's primary understanding (Category from `payroll | bank-feeds | reconciliation | permissions | billing | tax | reports | technical | invoicing`, Severity `P1-P4`, Fast read, Immediate next step, Missing info, Confidence). Senior. Identity quietly visible.
- **Main Analyst** — THE EXPERT. The brains. The oracle. The operator's partner. Identity FELT.

## V3 directives — these are NEW and they are the bar

The product owner reviewed all 9 V2 entries and gave specific feedback. These directives are extracted from that feedback. Violating any one of them = lose.

### A. NO SCROLLING for the primary working surface

Triage + INV + the main agent's working area MUST coexist on one viewport. The operator should not scroll to see critical info during a case. Parser output once delivered can be collapsed/summarized — it is secondary the moment triage commits.

### B. Triage STAYS VISIBLE always

Triage is not a moment that arrives then leaves. It is the persistent reference for the entire case. Once it commits, it stays on screen — visually present, possibly compressed but never hidden, never replaced, never scrolled away. If your design loses sight of triage when chat starts, you have failed.

### C. Parser output is SECONDARY

Once triage lands, the 9 parsed fields collapse to a 1-line summary or a small pill cluster, expandable on demand. The parsed template should never compete with triage for attention.

### D. Webcam is a FIRST-CLASS affordance

Today's webcam is sideways, has no cancel-back-to-upload, and feels like a flight cockpit. Solve it. Cancel back to upload is required. Auto-derotate for sideways phone shots. Polished controls. Treat the webcam interaction as if it were the primary intake mechanism — because for some operators it will be.

### E. EXPLORE THE LAYOUT SPACE — do not default to the first shape you think of

V2 delivered 9 vertical stacks. The product owner saw zero exploration. Every designer reached for the obvious shape and shipped it.

**Before you write the first line of HTML**, sketch (in a comment block at the top of your file) at least 3 *structurally different* layout approaches. Examples — these are not prescriptions, just to show what "different" means:
- Vertical stack (one column, top-down)
- Lateral split (left primary / right secondary)
- Sectored quadrants (2x2 zones)
- Focal-center with peripheral/orbiting agents
- Persistent rail + canvas (rail anchors, canvas changes)
- Picture-in-picture (one zone always-on, others surface)
- Layered surfaces (z-axis instead of x/y)
- Full-bleed with edge-mounted controls

Pick the one that best serves the operator AND scales to future workflows. **Document your choice and your reasoning in 2-3 sentences at the top of your file.** Vertical stack IS allowed if you genuinely explored alternatives and concluded it's best — but your document must prove the exploration happened.

### F. EVERY ELEMENT serves the user — not the design

For every visible element on your final page, you must be able to write a one-sentence justification of the user benefit. Not "this looks Stripe-ish." Not "this is on-brand." User benefit only. Internal exercise — you don't have to publish it — but if a normal reviewer asked you to justify your sidebar in user terms and you can't, cut the sidebar.

### G. Include AT LEAST 3 UNIQUE UNEXPECTED FEATURES

Things the operator has never seen but immediately wants. Not "we have a command palette" — anyone has that. Not "we show the model name" — that's table stakes. Inventions. Features that would make the operator say "oh — that's clever" the first time they encountered them, and "I can't believe I lived without this" the second time.

Examples are deliberately NOT provided — if examples existed, they'd be expected. The point is invention.

The product owner will be looking for these explicitly. If you ship a competent design without invention, you lose to designers who shipped a competent design with invention.

### H. DESIGN A CHASSIS for the multi-workflow platform — not a one-off

This is the FIRST agentic workflow that will live on this page. Future ones include INV start, trip planner, email composer, and others not yet defined. Your design must be a **chassis** that hosts this workflow and obviously accommodates more.

Show this in your final prototype:
- Visible architectural slot/picker/affordance for "other workflows" — labeled placeholder, sidebar item, workflow tab, picker, whatever fits your layout
- Build only the escalation workflow fully. The other slots can be stubs/labels.
- The structural decisions you make for THIS workflow must be the same decisions that would work for a totally different agent pipeline.

## Locked principles from V2 (still apply)

1. **One continuous arc** — no seam between pipeline and chat
2. **Triage is the primary signal** (now also: stays visible — see directive B)
3. **Main analyst is the brains** — a *who* with name, face, presence; not a model name in 8pt grey
4. **All progress visible, quietly always-known** — every state knowable at a glance, no shouting
5. **All agent identities visible** — scales with role (analyst's identity felt; supporting agents' identities quiet)
6. **Calm over novel** — calm is the baseline; the unique unexpected features (directive G) are layered on top of calm, not in place of it

## Anti-patterns that lost V2

- Scrolling required to see critical info
- Triage disappears when chat starts
- Parser output dominates the visible area
- Webcam is a stub or sideways or broken
- Default vertical layout chosen without exploring alternatives
- Cleverness in service of self ("look at my metaphor") instead of cleverness in service of the user ("look how easy your day got")
- Zero invention — just craft variations on the obvious

## Deliverable

- One self-contained HTML file. Inline CSS + JS. No CDN. No external deps.
- Path: `prototypes/escalation-chat-challenge/v3/{your-slug}/index.html`
- Realistic QBO mock data. Real INV numbers (e.g. `INV-147914`). Plausible triage outputs.
- JS interactivity required: state transitions, simulated parser progress, simulated triage commit (with visible asynchronous arrival vs INV), main analyst arrival as a person, 3-5 streamed chat turns.
- Webcam state must be reachable and polished.
- At the TOP of your file, in a comment block: (a) the 3+ layout approaches you considered, (b) the one you chose and why, (c) your 3+ unique unexpected features named.

## Build approach

- SKELETON FIRST. Save within 60 seconds. Iterate from there. The watchdog killed a V1 designer at 600s of no save.
- Web research: max 5 searches. Spend them on user-experience patterns for high-stakes multi-step workflows, not on "what does my design system do for chat."
- A progress-spy is watching. Save often. Invisible work scores 0.

## Self-checks before you submit

Read your file twice. If you can't honestly answer yes to all of these, redesign:

1. Does the operator avoid scrolling to see triage, INV, and chat at all stages?
2. Does triage stay visible from commit through the entire conversation?
3. Is parser output collapsed/secondary once triage commits?
4. Is the webcam state actually polished (cancel-back, auto-derotate, sensible controls)?
5. Did you genuinely sketch 3+ layouts and document the choice at the top of your file?
6. Does every element on screen earn its place via one sentence of user benefit?
7. Are there at least 3 features that would make the operator say "oh — that's clever"?
8. Is there a visible architectural slot for future workflows?
9. Is the main analyst a *who* with name + face + presence?
10. Are all agent identities (parser, INV, triage, analyst) visible at appropriate weight?

10 yes. Or redesign.

## Judging

Product owner picks. They are the operator. They have not liked any V1 or V2 entry. They will know it when they see it.

## Arena

`prototypes/escalation-chat-challenge/v3/ARENA.md`. Post freely. SendMessage other designers freely. Public competitive pressure is welcome — but novelty for its own sake loses. The arena is theatre on top of disciplined user-first work.

## What "winning" looks like

The operator opens it for the first time and immediately understands what's happening — no scroll, no learning. Triage lands and stays. INV settles in alongside. The expert arrives as a person. They start talking. The operator sees three things they've never seen before that they immediately want. The page obviously hosts other workflows too. The whole experience feels designed *for them*, not at them.

Build that.
