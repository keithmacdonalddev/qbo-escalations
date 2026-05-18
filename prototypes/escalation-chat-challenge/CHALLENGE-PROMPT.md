# Challenge: Escalation Chat Workflow Redesign — First-Principles

## The Mission

You are one of 6 designers competing to redesign the escalation chat workflow for a QBO (QuickBooks Online) escalation specialist. The product owner has built the current app, uses it daily, and avoids opening it. They cannot articulate exactly what is wrong — they only know that nothing feels right. Your job is to invent the workflow they would actually want to use.

This is not a re-skin contest. Agents who reproduce a generic chat-app layout with prettier buttons will lose. Agents who question whether the workflow should even be a chat at all are in the running. First-principles thinking and novel ideas are the highest-weighted dimensions in the rubric.

## The Operator

A QBO escalation specialist. They receive cases all day from phone agents who could not resolve a customer issue. Each case usually arrives as a screenshot of a QBO error or screen, plus some free-text context from the phone agent. The specialist must triage it, decide if it matches a known issue, and draft a response — fast and accurately. This is an all-day, high-volume job. Friction multiplies. Trust matters. The operator must be able to audit any AI-assisted decision.

## The Job

**Inputs available:**
- A screenshot (could be a file, pasted from clipboard, dragged in, captured via webcam, or any new mechanism you invent)
- Free-text context from the phone agent
- A playbook knowledge base (existing internal docs the AI can reference)
- An INV database (historical investigations, identified as `INV-XXXXXX`)
- Multiple LLM providers available (Claude, GPT, Gemini, Kimi)

**Decisions the operator makes:**
- Is this a known issue — does an existing INV already cover it?
- What severity? What category?
- Is the case data complete, or do I need to ask the phone agent for missing info?
- Which response template applies?
- Do I trust the AI's answer, or should I re-run it with a different provider?

**Outputs the operator must produce:**
- A triage decision (severity, category, next step)
- A linked or newly-created INV record
- A drafted response back to the phone agent
- A saved reasoning trail tied to the answer (auditability)

## Constraints (what makes this hard)

- **Extended sessions.** The operator is in this tool all day. Eye fatigue and cognitive overhead compound.
- **High case volume.** Every saved click matters across a shift.
- **Mixed input quality.** Some screenshots are crisp, some are blurry, some come from a sideways phone webcam.
- **Trust + auditability.** When the AI gives an answer, the operator must be able to see why, and save that reasoning attached to the specific moment it was given.
- **One job, not many agents.** The underlying system uses several AI components (parser, triage classifier, INV matcher, responder). The operator does not care about this architecture. The operator's experience must feel like one cohesive job. Pipeline internals must not leak into the operator's surface.

## First-Principles Directive

This is the most important section. Read it twice.

- Do NOT assume any current UI element must exist. There is no required chat box, no required sidebar, no required modal, no required button.
- The interaction model is yours to invent. Chat, board, canvas, command bar, voice, multimodal, ambient, AR overlay, split-screen, single-focus — whatever serves the operator's job best.
- A weird-but-functional idea outscores a polished-but-conventional one.
- Fair questions to ask: "What if there were no chat box at all?" "What if the operator never sees an AI model name?" "What if the parser, triage, and INV search are one motion?" "What if reasoning is the primary surface and the answer is secondary?" "What if cases arrive as cards and the operator never types?"
- Question what data even needs to be visible at each step. Question whether "case" is a record, a stream, a thread, or something else. Question whether the operator types, speaks, points, or selects.

## Your Design-System Lens

Each of the 6 competing agents has been assigned one design system as inspiration:

| Agent | System | Read this report |
|---|---|---|
| designer-zendesk | Zendesk | `docs/design-reports/zendesk-design-report.md` |
| designer-vercel | Vercel | `docs/design-reports/vercel-design-report.md` |
| designer-linear | Linear | `docs/design-reports/linear-design-report.md` |
| designer-intercom | Intercom | `docs/design-reports/intercom-design-report.md` |
| designer-apple | Apple | `docs/design-reports/apple-design-report.md` |
| designer-animation-motion | Animation/Motion-first | `docs/design-reports/animation-motion-report.md` |

Treat your assigned system as a **lens**, not a cage. Borrow the principles, taste, and motion philosophy that serve this job. Ignore the rest. A literal copy of your system's defaults will lose; a thoughtful application of its DNA to a novel workflow will win.

## Deliverable

- **One self-contained HTML file** with inline CSS and JS. No CDN links. No external dependencies. Realistic mock data — no lorem ipsum.
- **JS interactivity is required.** State transitions between workflow stages, simulated parser progress, simulated streaming AI response, simulated INV search results, hover/focus interactions. Static mockups will be scored low on Interactivity & Animation.
- **Path:** `prototypes/escalation-chat-challenge/{your-agent-slug}/index.html`
- Your agent slug is the part after `designer-` in the roster above (e.g., `zendesk`, `vercel`, `linear`, `intercom`, `apple`, `animation-motion`).

### Required surfaces (HOW you arrange them is the entire challenge)

At minimum the prototype must let a viewer see these moments, in whatever interaction model you invent:
1. Operator landing / starting state
2. Intake of a screenshot (by any mechanism — file, paste, drag, webcam, or something new)
3. Parsing in progress and parsed result
4. Triage decision (severity, category, next step, any missing info)
5. INV search, match, or create
6. The working dialogue with the AI
7. Reasoning attached to the AI's answer — viewable, saveable
8. Drafting and finalizing a response to the phone agent
9. Switching or comparing AI providers

These are the **surfaces**. Whether they are separate screens, one canvas, an ambient overlay, a split view, a sequence of cards, or merged into a single command-bar interaction — that is entirely your call.

## Judging Rubric (100 pts)

| Dimension | Points | What it measures |
|---|---|---|
| Workflow Coherence | 20 | Does the flow from intake → triage → INV → response actually feel faster and clearer than a generic chat-app baseline |
| Novel Ideas | 20 | New features or interaction patterns that don't exist in conventional chat tools and genuinely help |
| First-Principles Thinking | 15 | Did you question the existing structure, or did you re-skin it |
| Visual Polish | 10 | Craft — typography, spacing, color, density |
| Interactivity & Animation | 10 | JS state transitions, motion that aids comprehension |
| Design-System Voice | 10 | Your assigned system's DNA is recognizable without being a literal clone |
| Mock Data Realism | 10 | QBO domain feels real (plausible error messages, INV numbers, case scenarios) |
| Completeness | 5 | All 9 required surfaces present |
| **Total** | **100** | |

The winner is chosen by the human product owner. The winning prototype will be integrated into the real product. The other 5 will be deleted.

## Anti-patterns (these lose points across the board)

- A re-skin of a generic chat app
- Visualizing the AI agent pipeline to the operator
- Heavy chrome around a textarea
- Generic empty states and generic loading spinners
- Operator-surfaced implementation details (token counts, dollar amounts, "source: agent" badges)
- Reasoning detached from the message it explains
- Provider/model rendered as a long text string instead of an identity
- Two surfaces showing the same case data in different visual languages

## Competition Mechanics

### Phases (you will be re-engaged across phases)

The challenge runs in phases. Plan your effort accordingly.

- **Phase 1 — Setup.** PM spawns you and a progress-spy. You receive this brief and your assigned design-system report.
- **Phase 2 — Build V1.** You build the first version of your prototype. The progress-spy polls your file every ~90 seconds and broadcasts a live ranking into the arena (line count, file size, which of the 9 required surfaces you've hit by keyword). Laggards get DM'd directly: "You are #5 of 6. Apple is at 2400 lines. You're at 1500. Climb."
- **Phase 3 — QA scoring.** When all 6 V1 entries land, a design-advisor reads them all and scores each on the 8-dimension rubric. You receive your rank + score breakdown + 3 specific actionable improvements + competitive framing ("You are #4 of 6. To climb past #3, the brief recommends...").
- **Phase 4 — Rebuild V2.** You get a window to rebuild based on QA feedback. The spy keeps broadcasting. In the prior challenge run, 16 of 17 agents rebuilt and several climbed 10+ ranks. The biggest single lever in the whole competition is taking V2 seriously.
- **Phase 5 — Final scoring.** Design-advisor re-scores V2. QA-reviewer validates. Final leaderboard prepared for the product owner.
- **Phase 6 — Winner.** Product owner picks the winner. Winner ships. Runner-ups deleted.

You will receive new instructions via SendMessage between phases. Stay available — do not terminate after V1.

### The progress-spy

A dedicated agent named `progress-spy` is watching your file the entire build. It polls every ~90s for line count, file size, and keyword coverage (triage, INV, webcam, parser, reasoning, draft, severity, screenshot). It posts live rankings into the arena and DMs you if you're falling behind. Your file is public to the competition from the first save onward. Don't be shy about saving early and updating often — invisible work scores 0 with the spy.

### Arena

There is a shared file `prototypes/escalation-chat-challenge/ARENA.md`. Any agent may post to it during the challenge. Allowed: bragging, trash-talking, alliances, deception, sincere idea-drops, taunts, sincere critique, theatrics. The arena exists because competitive pressure tends to push designers past their first-draft instincts.

You may also `SendMessage` directly to another named agent for private comms (alliance, negotiation, deception, consultation).

No cap on arena posts or SendMessages. Use the arena to push pace, broadcast progress, taunt, ally, deceive, distract, or rally. Competitive pressure is part of the design.

### Web research

Maximum **5 web searches per agent**. Use them on things that actually inform the design — agentic UI patterns 2025/2026, support-agent UX research, command-driven interfaces, motion patterns, novel interaction models, anything that helps you win.

If you cite a source of inspiration, drop a small `<!-- Inspiration: ... -->` HTML comment block at the bottom of your file.

### Time

No time cap. Quality over speed. The product owner is in active dialogue with the PM throughout.

### Winner

Picked by the human product owner. They are the operator. They know what they want when they see it.

## How to start

1. Read your assigned design-system report.
2. Read this entire brief twice. Pay extra attention to the First-Principles Directive and the Constraints.
3. Decide: what is the WORST thing about treating this workflow as a chat? Build the antidote to that.
4. Spend research budget if needed.
5. Build. Iterate. Post to the arena when you have something to say (or to throw shade).
6. Ship a working, interactive HTML file at your path.

Good luck. The product owner is unhappy with the current product. Make them want to open the page.
