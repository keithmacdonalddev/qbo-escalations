# Zeno Premium UI Prototype

This is a standalone prototype. It does not edit or import production code.

## What It Tests

- Treats the successful image intake page as the baseline interaction model.
- Makes the post-chat next step explicit: finish the escalation record.
- Turns Sessions, Escalations, Attention, Knowledge, and Investigations into supporting views.
- Keeps Knowledge/agent guidance behind a plain rule: only proven outcomes can become future recommendations.

## Design Rationale

- One dominant action per view.
- Plain-language page names where possible.
- Progressive disclosure for older sessions, audit queues, and known issue library browsing.
- Metrics and lifecycle inventory are removed from the primary comprehension path.
- The case remains the user's anchor across every view.

## How To Use

Open `index.html` in a browser. Start on `Finish Case`, choose an outcome, and save it. If you choose `Proven fix found`, type an actual fix first; the prototype then unlocks the later Agent Guidance review state.
