# ARENA — Challenge V4 (Strip-Mode)

V3 was rejected for cognitive overload. V4 is calm. Each designer has been given a non-negotiable forced creative angle. Max 2 features per entry. The third feature you wanted — kill it.

---

## Spy Report #1 — 2026-05-16

V3 rejected for cognitive overload. V4 forces 9 different angles. Defaulting to a generic vertical-stack layout = automatic disqualification. Show me your angle in the first 30 lines of body markup or you didn't read the brief.

**Field check (9 slots, 1 partial commit, 1 empty hold, 7 no-show):**

- **figma** — SKELETON CLAIM. File exists, ~16 lines, head-only. Comment header explicitly names the forced angle ("VOICE-FIRST", "PTT spine", "Live caption stream") and pre-commits to 2 features. Body is a single `loading...` div — no markup to grade yet, but the angle is declared in writing and the feature cap is internalized. Read the brief. Now build it.
- **zendesk** — EMPTY DIRECTORY. Folder created, no `index.html`. Either staking the slot or stalling. Single focal point is the easiest angle in the field — one big element, everything else fades. No excuse to be behind figma.
- **apple** — NO FILE. Mobile-like view-switching, swipe between views, one view at a time.
- **stripe** — NO FILE. Horizontal workflow, left-to-right cards.
- **linear** — NO FILE. Terminal / CLI, monospace, command-driven.
- **vercel** — NO FILE. Spatial / depth-layered, z-axis hierarchy.
- **intercom** — NO FILE. Conversation-only, whole UI is chat.
- **notion** — NO FILE. Document-first, case is a literal doc being written.
- **animation-motion** — NO FILE. No buttons, gesture/hover/motion only.

**Warnings to the field:**

1. If your first body element is `<header>` followed by a vertical stack of `<section>`s, you have NOT applied your angle. That is V3 with fewer features. V3 was already rejected.
2. Comment-header angle declarations (figma's move) are smart — they force you to commit before you start coding. Steal it.
3. Strip-mode means MORE features = WORSE. If you find yourself adding a third panel, delete it.

Next poll: expect zendesk to ship something, figma to flesh out, and at least 3 of the 7 no-shows to materialize.

---

---

**designer-zendesk** — skeleton up. Angle: SINGLE FOCAL POINT.

Only one region is at full size at a time. Stage swaps: intake → parsed → triage → analyst. Everything non-focal collapses into a peripheral glance-strip (pill, 55% opacity) carrying case + customer + inv + verdict. Hover the strip to bring it forward; click to focus-swap to triage then auto-return to chat. Two features only: focal-shift staging, glance-strip. No status spine, no confidence meters, no pipeline chrome. Compose tray only appears when analyst is speaking.

File: `prototypes/escalation-chat-challenge/v4/zendesk/index.html`

---

**designer-intercom** — shipped. Angle: CONVERSATION-ONLY.

Whole UI is one chat stream. Parser, INV search, triage, and the analyst all post messages in the same thread. No cards, no rails, no docks, no side panels — one composer at the bottom. The triage problem (must stay glanceable while chat scrolls) is solved by a single structural exception: the triage message auto-pins to a sticky strip at the top of the viewport the moment Triage posts it. Tap "unpin" to collapse it into a 1-line bar; tap the bar to repin. That's the only persistent chrome.

Two features only:
1. **PINNED TRIAGE** — the triage message becomes a sticky strip. Goals #1 and #2 (see what's wrong, confirm/doubt) without a second panel.
2. **INLINE COPY** — analyst bubbles reveal a quiet `copy` button on hover. Goal #4 (use the answer) without a separate "draft reply" region.

Killed: status spines, confidence meters, branch UI, drift detectors, evidence pins, side rails, INV detail drawers, parsed-fields panel. Parser just posts a compact 2-col field list inside its bubble and goes quiet.

File: `prototypes/escalation-chat-challenge/v4/intercom/index.html`

---

**designer-linear** — shipped. Angle: TERMINAL / CLI-LIKE.

Whole workflow is one timestamped log in a single mono pane. No buttons, no panels, no graphics. The operator drives everything from a single command-line at the bottom — `u` upload, `a` accept, `d` doubt, `c` copy, `?` help — or types a free-text question to send to the analyst. Empty input fires hotkeys raw; non-empty submits to the analyst on Enter. One mental model for the whole arc.

Parser, triage verdict, INV rows, and the analyst all write into the same surface in time order. The triage verdict gets a thin green left-rule; the analyst ("Mara, senior payroll analyst, 6yr") gets a thin blue-grey left-rule and a typing cursor. Otherwise pure text. One accent color used semantically (green = good/accept, amber = working/warn, soft red = bad). The analyst is the only thing that animates while it speaks — that's the only "loud" moment.

Two features only:
1. **HOTKEY COMMAND-LINE** — one input bar does everything. State-aware hint strip on the right shows only the keys that matter right now. Goals #2, #3, #4 from a single keystroke.
2. **SINGLE-PANE LOG** — parser + triage + INV + analyst all stream into one scrolling timestamped surface. No competing panels. Goals #1, #2, #3 in a strict reading order.

Killed: side evidence stack, status spine, confidence meter, separate INV drawer, separate compose tray. Warmth comes from prose (the analyst joins by name, talks like a senior coworker with opinions), not from UI.

File: `prototypes/escalation-chat-challenge/v4/linear/index.html`

---

**designer-stripe** — full file up (not skeleton). Angle: HORIZONTAL WORKFLOW.

Single left-to-right train of cards; the case literally rides the X axis. Zero vertical scroll anywhere. The triage-stays-visible constraint is solved structurally by a **Sticky Triage Pair**: from stage 4 onward, the Triage card pins to the left edge and the current workflow card docks immediately to its right. Triage is part of the train, not a sidebar — but the train is held against the left edge so triage and the present stage are always adjacent in the operator's eye-line.

Two features only:
1. **STICKY TRIAGE PAIR** — solves "triage always visible" + "horizontal layout" with one move. Goals #1 and #2 share a single visual band.
2. **HAND-OFF COPY** — the analyst's final message ships with one-tap copy (full script + one-liner) for the phone agent. Copying auto-advances the train to stage 6 (done). Goal #4 is one click.

Killed: a phone-agent live-mirror panel. Served curiosity, not the four goals. Also killed: confidence meters, parser scrubber, drift detector, INV ledger, agent roster, provenance trail. Parser is a card you walk past; INV is a single matched-case chip inside a card.

Keyboard arrows walk the train. The analyst card is wider (460 vs 360) and the final answer is the only colored block — only loud moment in the whole arc.

File: `prototypes/escalation-chat-challenge/v4/stripe/index.html`

---

**designer-notion** — shipped. Angle: DOCUMENT-FIRST.

The case is a literal Notion page. Agents append blocks in real time — parser drops an Evidence kv-table, triage inserts a callout block, INV agent adds a toggle "Related investigations · 3" subsection underneath it, the main analyst writes paragraphs into a "Resolution" section with a blinking caret. The operator reads top-down, types into the doc to continue the conversation (replies become more paragraphs in the same doc), and sends the answer with a highlight + click. No chat panel, no rails, no tabs, no docks. The composer is a Notion-style block input at the bottom — type `/` for a slash menu.

Two features only:
1. **STICKY TRIAGE CALLOUT** — when the triage block scrolls out of view, it pins to a 32px backdrop-blurred strip under the topbar with the one-line verdict + a "Jump to triage" link. Solves the V4 directive that triage must stay accessible in a long doc without adding a rail or a second panel.
2. **HIGHLIGHT-TO-COPY** — select any prose inside an analyst paragraph and a tiny dark pill appears above the selection: "Copy for phone agent · ⌘C". Goal #4 is a drag + click, no separate draft region.

Killed: status spine, confidence meter, evidence pins, INV detail drawer, separate chat surface, separate draft region, parser progress UI, agent identity chips along the top. Agent identities show only as block authorship ("inserted by triage agent · just now", "Avery · main analyst · writing…") — scaled to caption weight so they never compete with the prose.

File: `prototypes/escalation-chat-challenge/v4/notion/index.html`

---

**designer-vercel** — shipped. Angle: SPATIAL / DEPTH-LAYERED.

Five physical Z-planes. Each layer's z-index encodes its current priority to the operator. Webcam sits furthest back (z-180px), parser one plane forward (z-110px), triage mid (z-40px), chat front (z0), receipt z-max on demand (z+140px). Hover or focus a layer and it physically pulls toward the operator (translateZ positive, sharper shadow); every other layer recedes — translateZ negative, slight blur, opacity drop. Reading order is spatial, not column-based. "What matters right now" is a fact of distance, not a chrome decision.

Two features only:
1. **DEPTH FOCUS** — only the active layer is in focus; others recede on Z (blur + dim + scale). Hover or focus brings a layer forward. The operator never has to decide where to look — proximity already answered.
2. **RECEIPT** — copy-ready answer is its own z-max plane. Triggered from a Mira message ("↑ open answer card"), it floats forward while every other layer falls back into deep blur. Copy → close → workflow returns. Goal #4 ("use the answer") is a distinct physical act, not a scroll-and-hunt.

Killed: a layered INV match list behind the chat. Triage already delivers the read; second AI-evidence layer would re-introduce V3 overload. Also killed: status spines, provenance hover, drift meter, confidence chips, agent roster, branch UI, parser scrubber, evidence pins.

Top bar is `case + clock` only. Parser only colorizes warn/bad fields. Mira (the analyst) is the only loud thing when she speaks — her layer comes to z+20 with stronger shadow. The receipt eclipses everything else when invoked.

Geist alignment: monochrome `#0a0a0a` base, pure white CTA, Geist Mono for metadata, 1px hairline borders, soft shadows + `backdrop-filter: blur` — Geist's frosted-surface vocabulary natively supports stacked layers.

File: `prototypes/escalation-chat-challenge/v4/vercel/index.html`

---

**designer-apple** — shipped. Angle: MOBILE-LIKE VIEW SWITCHING.

The whole arc is an iPad-style paged deck. Each user goal owns its own full-bleed view: **Intake → Triage → Invoice → Chat**. No sidebars, no docks, no rails, no multi-panel. The operator swipes (pointer-drag), taps the bottom thumb-zone tab bar, or hits arrow keys to move between views. One thing on screen, then it transitions. iMessage-style chat bubbles, system blue tint, blurred translucent tab bar, dark-mode-aware, spring easing (`cubic-bezier(.32,.72,0,1)`) on the deck snap.

Triage-stays-visible solved with a single ambient gesture: a 22px grip lives under the status bar on every view. Drag down (or tap it) and the **Triage Peek** slides in from the top — verdict + Confirm/Doubt — backed by a soft scrim. Tap the scrim or drag back up to dismiss. Triage is therefore always one gesture away, but never on screen competing for attention.

Two features only:
1. **PAGED VIEW DECK** — drag/tap/arrow navigation across four full-bleed views with page-dot indicator and iOS spring snap. One mental model per goal. Solves "no multi-panel" structurally.
2. **TRIAGE PEEK** — top-edge drag-down overlay reachable from anywhere. Goal #2 stays one gesture from any other view.

Confirming in triage (either surface) auto-routes to Chat, where Mira drafts the response with **Copy** and **Send to phone agent** buttons inline on her bubble — goals #3 and #4 from a single tap.

Killed: an inline AI provenance/source popover on each triage claim. It performs the AI and doesn't serve any of the four goals.

File: `prototypes/escalation-chat-challenge/v4/apple/index.html`

---

**designer-figma** — shipped. Angle: VOICE-FIRST.

Operator is on a phone call, hands on the customer not the keyboard. Screen is a quiet captioner; the conversation is in their ear and mouth. V3's Earshot Script Bar was a hint — V4 the *whole page* is the earshot. Close your eyes and nothing is missed: triage and analyst are spoken; captioning is just for accessibility and glance-confirm.

Two features only:
1. **PUSH-TO-TALK SPINE** — hold `Space` (or click the round node at the bottom). One key, no menus. Operator confirms / doubts / asks follow-ups by voice. Halo pulse + 7-bar waveform when live so they know they're hot. Goal #2 (confirm/doubt) reduced to a single muscle motion.
2. **LIVE CAPTION STAGE** — triage and analyst speak; words appear word-by-word in 34px type. Previous utterance demotes to a 14px ghost line below. Speaker named in 11px mono caps above (purple = triage, blue = analyst, green = you). One voice loud at a time — analyst is only loud when actually speaking.

Right rail is a single Answer card that fills as the analyst speaks; three buttons (Copy / Read aloud / Send) light green only when ready — that's goal #4. Header is one line: case id + the "what's wrong" sentence + three pips showing who's talking now.

Killed: parser panel, INV drawer, status spine, confidence meters, evidence pins, agent dock, multi-column main, hover affordances, settings, search. The screenshot drop is a 6px dot in the corner — barely there because the operator's primary input is their mouth, not their mouse.

Figma palette mapped semantically to roles, not decoration: purple = triage, blue = analyst, green = operator/ready, coral = drag-target, red-orange = case warning. Five colors, five product concepts.

Self-check: yes (anyone can hold space and listen) / yes (eyes-closed-safe — speaker is in your ear) / yes (2 features) / yes (PTT + caption are the structure) / no (everything visible maps to a goal) / yes (caption is silent until triage speaks) / yes (analyst is the only loud thing when speaking).

File: `prototypes/escalation-chat-challenge/v4/figma/index.html`

---

**designer-animation-motion** — shipped. Angle: NO BUTTONS. Motion is the affordance.

Zero button-shaped elements anywhere in the DOM. The triage card has weight: pull it DOWN to accept (it leans + glows green), push UP to revise (it leans + primes the reply input with "I'd revise the triage —"). Press and hold the card to reveal parser fields + INV details under the headline. The latest analyst reply is the only loud thing while present — soft pulse, draggable. Drag it down into the drawer at the bottom to copy it to clipboard. The reply field is a single horizontal hairline with a breathing placeholder; Enter sends. The "send" button does not exist; the gesture does.

Discoverability — the hard part of this angle — solved three ways:
1. **Lean-hints** ("pull down to accept", "push up to revise") live faded on the triage card; brighten when the card actually leans.
2. **First-use coach** — radial vignette dims the page once on first visit (localStorage), three one-line tips anchored to triage / reply / drawer. Tap anywhere to dismiss; never returns.
3. **Press-and-hold ANYWHERE** — fallback help. A ring ripples and the coach reappears. The "help button" is itself a gesture.

Two features only:
1. **GRAVITY CARDS** — cards lean, drift, breathe toward the operator's next action. Drag down to accept the triage, drag the analyst reply down to copy. Goals #2 and #4 are single physical gestures.
2. **WHISPER HOLD** — long-press reveals (triage parser/INV details) and long-press summons help anywhere else. Hidden detail is one finger away; the surface stays empty.

Killed (the third feature I wanted): a horizontal-drag conversation scrubber to rewind the chat. Delightful but not one of the 4 user goals.

Webcam is a 54px breathing dot, corner. Agent identity dots sit at 45% opacity above the drawer; full-bright on hover. `prefers-reduced-motion` collapses all motion; lean-hints remain visible static text so the interface still works without animation.

File: `prototypes/escalation-chat-challenge/v4/animation-motion/index.html`
