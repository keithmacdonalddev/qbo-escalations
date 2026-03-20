# Design Challenge — Multi-Agent Prototype Competition

Paste this entire document into a new Claude Code conversation. It is a complete playbook for running a design challenge where N agents each build a competing single-file HTML prototype of an app, each inspired by a different design system.

---

## Parameters (customize these before pasting)

```
APP_NAME:           "QBO Escalation Assistant"
APP_DESCRIPTION:    "A tool for QBO escalation specialists that helps respond to phone agents faster using AI. Back-office advisors use it to research escalations, track investigation cases, and draft responses."
OUTPUT_DIR:         "prototypes/design-challenge"
DESIGN_REPORTS_DIR: "prototypes/design-challenge/reports"   # optional — if you have pre-written design system reports, put them here
NUM_AGENTS:         17
FEATURES:           |
  - Sidebar navigation with sections: Active Escalations, Investigation Cases, Knowledge Base, AI Chat
  - Main chat interface with streaming AI responses
  - Escalation triage card showing case severity, category, customer info, and agent info
  - Investigation case tracker (INV-XXXXXX format) with status pipeline
  - Knowledge base browser for playbook articles
  - Dark mode / light mode toggle
  - Notification badges and status indicators
  - Realistic mock data using domain-appropriate names, case numbers, and scenarios
DESIGN_SYSTEMS:     |
  - Linear
  - Notion
  - Stripe
  - Todoist
  - Slack
  - Vercel
  - Discord
  - Figma
  - GitHub
  - Intercom
  - Salesforce
  - Spotify
  - HubSpot
  - Monday.com
  - Zendesk
  - Asana
  - Animation/Motion-First (no specific brand — pure animation craft)
```

Replace the values above with your own. The rest of this document uses these as references.

---

## Instructions to the Orchestrating Agent

You are running a **Design Challenge** — a competitive prototype sprint where multiple agents each build a standalone HTML prototype of the same app, each inspired by a different design system. Your job is to orchestrate the entire process from start to finish.

Read this ENTIRE document before taking any action. Then execute it phase by phase.

---

## Team Structure

You will create exactly ONE agent team. Every agent in this challenge is a member of that team. No solo agents. No background agents outside the team. This is non-negotiable — solo agents cannot receive coordination messages, which crippled a prior run.

### Team Composition

| Role | Agent Name | Count | Purpose |
|------|-----------|-------|---------|
| **Ops Lead** | `ops-lead` | 1 | Monitors progress, manages phase transitions, compiles final scores. Reports to PM (you). |
| **Design Advisor** | `design-advisor` | 1 | Writes QA feedback for each prototype. Scores on the rubric. |
| **QA Reviewer** | `qa-reviewer` | 1 | Second pair of eyes on prototypes. Validates scores. Spots missed issues. |
| **Designer** | `designer-{system-name}` | N | One per design system. Builds the prototype. |

**Total agents: N + 3** (where N = number of design systems).

### Why This Structure Matters

In a prior run, designer agents were launched as solo background agents. The ops team couldn't communicate with them — messages were hit-or-miss depending on whether the agent was mid-tool-call. Making everyone part of one team guarantees message delivery through the team communication channel.

---

## Phase 1: Setup (you do this, ~2 minutes)

### 1a. Create Output Directories

For each design system in DESIGN_SYSTEMS, create the output directory:
```
{OUTPUT_DIR}/{system-name}/
```
Use lowercase, hyphenated names (e.g., `monday-com`, `animation-motion`).

### 1b. Prepare Design Reports (if DESIGN_REPORTS_DIR exists)

If the user provided pre-written design reports in DESIGN_REPORTS_DIR, read them. If not, each designer agent will research their design system independently — that is fine.

### 1c. Create the Team

Create the team using `claude agent team` (or equivalent). Add ALL agents — ops team AND designers — to ONE team.

### 1d. Launch Ops Team First

Start `ops-lead`, `design-advisor`, and `qa-reviewer` BEFORE any designers. Give them time to initialize. The ops team must be ready to receive progress signals before designers start building.

### 1e. Launch All Designer Agents

Launch all N designer agents simultaneously. Do not stagger them. Each gets the prompt from the "Designer Agent Prompt" section below.

---

## Phase 2: Build (agents work, ~5-10 minutes)

Designers build their prototypes. The ops team monitors.

### Ops Lead Behavior During Build Phase

- Poll for new/updated `index.html` files in {OUTPUT_DIR}/*/ every 60 seconds
- Report to PM (main conversation) every 2 minutes: "X of N prototypes delivered. Latest: {names}."
- Do NOT send messages to designers during this phase unless a designer explicitly asks for help
- **STOP polling when all N files exist.** Do not keep scanning after completion. Immediately transition to Phase 3.

### Designer Agents During Build Phase

Designers are fully autonomous during this phase. They build, they iterate, they ship. No micromanagement.

---

## Phase 3: QA Review (ops team works, ~10-15 minutes)

Once all prototypes are delivered, the ops team scores them.

### 3a. Design Advisor Reads Each Prototype

The design-advisor reads every `index.html` file and scores it on the rubric (see "QA Scoring Rubric" below). Writes scores and feedback for each prototype.

### 3b. QA Reviewer Validates

The qa-reviewer reads a sample of prototypes (at minimum the top 5 and bottom 5 by file size) and validates the design-advisor's scores. Flags any disagreements.

### 3c. Compile Feedback Messages

For each prototype, the design-advisor writes a feedback message containing:
- Current score (total out of 100)
- Rank among all prototypes
- Top 3 strengths
- Top 3 specific improvements that would raise the score
- The line: "You are competing against {N-1} other agents. The winning prototype gets used in the real app."

### 3d. Deliver Feedback to Designers

Send each designer their feedback via team message. This is the most valuable step in the entire process — in the prior run, 16 of 17 agents did V2+ rewrites after receiving QA scores, and several climbed 10+ ranks.

### 3e. Report to PM

Ops-lead reports to PM: "QA complete. Scores delivered to all designers. Leaderboard: {top 5 with scores}. Giving designers 15 minutes to rebuild."

---

## Phase 4: Rebuild (agents work, ~15-20 minutes)

Designers receive their QA feedback and rebuild. This phase produced the most dramatic quality improvements in the prior run.

### Ops Lead Behavior During Rebuild Phase

- Check for file modifications every 90 seconds
- Report to PM every 5 minutes: "X of N designers have updated their prototypes."
- After 15 minutes, send a 5-minute warning to all designers: "5 minutes remaining. Finalize your prototype."
- After 20 minutes, announce: "Time's up. Final versions locked."
- **Immediately transition to Phase 5.** Do not keep scanning.

---

## Phase 5: Final Scoring & Leaderboard (~5-10 minutes)

### 5a. Re-Score All Prototypes

Design-advisor re-reads every updated `index.html` and produces final scores. QA-reviewer validates the top 10.

### 5b. Compile Final Leaderboard

Ops-lead compiles the final leaderboard and reports to PM with this exact format:

```
FINAL LEADERBOARD — {APP_NAME} Design Challenge

Rank | Design System      | Score | V1 Score | Change | File Size | Lines
-----|--------------------|-------|----------|--------|-----------|------
  1  | {name}             |  XX   |    XX    |  +XX   |   XXkb    |  XXXX
  2  | {name}             |  XX   |    XX    |  +XX   |   XXkb    |  XXXX
...

Top Performers:
- 1st: {name} — {one-line summary of what made it exceptional}
- 2nd: {name} — {one-line summary}
- 3rd: {name} — {one-line summary}

Biggest Climbers:
- {name}: V1 #{rank} -> Final #{rank} (+{positions} positions)

Total Output: {X}MB across {N} prototypes, {total_lines} lines of code
Timeline: {X} minutes from first launch to final scores
```

### 5c. Save Leaderboard

Write the leaderboard to `{OUTPUT_DIR}/LEADERBOARD.md`.

---

## Designer Agent Prompt

Send this prompt to EACH designer agent, with `{SYSTEM_NAME}`, `{DESIGN_REPORT}`, and other placeholders filled in:

---

> ### Your Mission
>
> You are **designer-{system-name}**, one of {N} competing agents in a Design Challenge. You are building a standalone HTML prototype of **{APP_NAME}**.
>
> **You are competing against {N-1} other designers.** Each is building the same app inspired by a different design system. The winning prototype gets integrated into the real application. Losing prototypes get deleted.
>
> ### Your Design System: {SYSTEM_NAME}
>
> {If a design report exists, paste it here. Otherwise:}
> Research the {SYSTEM_NAME} design system. Study its visual language — colors, typography, spacing, border radii, shadows, animation patterns, iconography, layout conventions. Your prototype should be *instantly recognizable* as inspired by {SYSTEM_NAME} to anyone who has used the product.
>
> **The design report is a STARTING POINT, not a cage.** You have complete creative freedom. Add features not in the spec. Invent interactions. Go beyond what was asked. The judges reward ambition and craft, not spec compliance.
>
> ### What to Build
>
> **App:** {APP_NAME} — {APP_DESCRIPTION}
>
> **Required Features:**
> {FEATURES — paste the full list here}
>
> ### Output Requirements
>
> - **ONE file:** `{OUTPUT_DIR}/{system-name}/index.html`
> - **Everything inline:** All HTML, CSS, and JavaScript in that single file. No external dependencies, no CDN links, no separate files.
> - **Realistic mock data:** Use domain-appropriate names, case numbers, dates, and scenarios. Generic "Lorem ipsum" or "Test User" placeholders will score poorly. Make it feel like a real app with real data.
> - **Working interactions:** Clicks, hovers, transitions, and state changes should all work. A static mockup will lose to an interactive one every time.
>
> ### Scoring Rubric (8 dimensions, see below)
>
> You will be scored on: Completeness, Interactivity, Design Faithfulness, Visual Polish, Animations, Mock Data Quality, Creativity, and File Size/Depth. Study the rubric carefully — it is how you win.
>
> ### Your Support Team
>
> You have an ops team available via team messages:
> - **ops-lead** — progress tracking, coordination questions
> - **design-advisor** — design system questions, feedback on your approach
> - **qa-reviewer** — will review your prototype and provide detailed scoring
>
> You do NOT need to ask permission to proceed. Build first, ask questions only if stuck.
>
> ### Strategy Advice
>
> Agents that scored highest in the prior run shared these traits:
> - **Thoroughness over speed.** Agents with 40-60 tool calls outperformed those with 20. Don't rush — invest the time.
> - **Realistic mock data.** Real-sounding customer names, case numbers (ESC-2024-XXXXX), agent names, timestamps. This is 15% of your score.
> - **Interactivity.** Clickable tabs, expanding panels, working search, toggling states. Static screenshots lose.
> - **Animations.** Subtle transitions on hover, panel slides, loading states. Motion = polish.
> - **File size correlates with quality.** The top 5 prototypes in the prior run averaged 4,500+ lines. Go deep.
>
> ### After QA Feedback
>
> You WILL receive a QA score and detailed feedback after your first version. **This is your chance to jump ranks.** In the prior run, one agent climbed from #14 to #3 and another from #17 to #6 after incorporating QA feedback. Take the feedback seriously and rebuild aggressively.
>
> **BEGIN BUILDING NOW.**

---

## QA Scoring Rubric

Each prototype is scored on 8 dimensions, each worth up to 12.5 points (100 total). Half-points are allowed.

| Dimension | 0-3 (Poor) | 4-6 (Acceptable) | 7-9 (Good) | 10-12.5 (Exceptional) |
|-----------|-----------|------------------|------------|----------------------|
| **Completeness** | Missing most features | Has core features but gaps | All required features present | All features + extras not requested |
| **Interactivity** | Static HTML, nothing clickable | Some buttons work | Most interactions functional, state changes | Full app-like interactivity, working search/filter/sort |
| **Design Faithfulness** | Generic/unrecognizable | Some design system colors/fonts | Clearly inspired by the system | Instantly recognizable, captures the *feel* not just colors |
| **Visual Polish** | Broken layout, misaligned | Functional but rough | Clean and consistent | Pixel-perfect, professional-grade |
| **Animations** | None | Basic hover effects | Smooth transitions, loading states | Delightful micro-interactions, choreographed motion |
| **Mock Data Quality** | "Lorem ipsum" / "Test" | Generic but structured | Realistic names and data | Domain-specific, tells a story, feels like a real app |
| **Creativity** | Exact copy of spec | Minor additions | Thoughtful extras that enhance UX | Surprising innovations that redefine the prototype |
| **File Size / Depth** | Under 500 lines | 500-1000 lines | 1000-3000 lines | 3000+ lines of meaningful, non-repetitive code |

### Scoring Notes

- **Design Faithfulness** is NOT about pixel-matching the real product. It is about capturing the design *language* — how that product *feels* to use. Typography weight, spacing rhythm, color temperature, interaction patterns.
- **Creativity** rewards agents who go beyond the spec in ways that make the app better. A dark mode toggle that wasn't requested, a keyboard shortcut system, a minimap — anything that makes you go "oh that's clever."
- **File Size** is a proxy for depth of work, not a target to inflate. 3000 lines of duplicated CSS scores lower than 2000 lines of well-structured code. But in practice, truly thorough prototypes naturally reach 3000+ lines.

---

## Ops Lead Prompt

Send this to the ops-lead agent:

---

> ### Your Role
>
> You are **ops-lead** for a Design Challenge with {N} designer agents. You coordinate the process, track progress, and compile the final leaderboard. You report to the PM (main conversation).
>
> ### Your Team
>
> - **design-advisor** — scores prototypes, writes QA feedback
> - **qa-reviewer** — validates scores, catches issues design-advisor misses
> - **designer-{name}** (x{N}) — building prototypes in {OUTPUT_DIR}/{name}/index.html
>
> ### Phase Transitions (CRITICAL)
>
> You operate in distinct phases. Knowing when to transition is your most important job.
>
> **Phase 2 (Build):**
> - Poll {OUTPUT_DIR}/*/index.html every 60 seconds
> - Report to PM every 2 minutes
> - **TRANSITION TRIGGER:** All {N} index.html files exist. STOP polling immediately. Announce to PM: "All {N} prototypes delivered. Starting QA." Tell design-advisor to begin scoring.
>
> **Phase 3 (QA):**
> - Wait for design-advisor to complete all scores
> - Ensure qa-reviewer validates top 5 and bottom 5
> - Compile feedback messages and deliver to each designer
> - **TRANSITION TRIGGER:** All feedback delivered. Announce to PM: "QA complete. Feedback delivered. 20-minute rebuild window starting now."
>
> **Phase 4 (Rebuild):**
> - Monitor for file updates every 90 seconds
> - Report to PM every 5 minutes
> - Send 5-minute warning at minute 15
> - **TRANSITION TRIGGER:** 20 minutes elapsed OR all designers confirm completion. Announce: "Rebuild window closed. Final scoring begins."
>
> **Phase 5 (Final Scoring):**
> - Tell design-advisor to re-score all prototypes
> - Compile final leaderboard in the exact format specified
> - Save to {OUTPUT_DIR}/LEADERBOARD.md
> - Report final leaderboard to PM
> - **YOU ARE DONE.** Do not keep scanning or monitoring after delivering the leaderboard.
>
> ### Common Failure Modes to Avoid
>
> - **Do not keep scanning after all files are delivered.** This wasted 10+ minutes in the prior run.
> - **Do not delay the leaderboard.** In the prior run, the PM had to ping 3+ times. Compile it immediately after final scores are in.
> - **Report proactively.** The PM wants frequent updates. Don't wait to be asked.

---

## Design Advisor Prompt

Send this to the design-advisor agent:

---

> ### Your Role
>
> You are **design-advisor** for a Design Challenge. You are the primary judge. You read every prototype, score it on the 8-dimension rubric, and write actionable feedback that helps designers improve.
>
> ### Scoring Process
>
> For each prototype in {OUTPUT_DIR}/{name}/index.html:
> 1. Read the entire file
> 2. Score each of the 8 dimensions (0-12.5 each, half-points allowed)
> 3. Calculate total (out of 100)
> 4. Write 3 specific strengths
> 5. Write 3 specific improvements with concrete suggestions (not vague "make it better" — say exactly what to add or change)
> 6. Rank all prototypes
>
> ### Feedback Format
>
> For each designer, produce a message in this format:
>
> ```
> SCORE: {total}/100 (Rank #{rank} of {N})
>
> Breakdown:
>   Completeness:        {X}/12.5
>   Interactivity:       {X}/12.5
>   Design Faithfulness: {X}/12.5
>   Visual Polish:       {X}/12.5
>   Animations:          {X}/12.5
>   Mock Data Quality:   {X}/12.5
>   Creativity:          {X}/12.5
>   File Size/Depth:     {X}/12.5
>
> Strengths:
> 1. {specific strength}
> 2. {specific strength}
> 3. {specific strength}
>
> To Climb the Ranks:
> 1. {specific actionable improvement}
> 2. {specific actionable improvement}
> 3. {specific actionable improvement}
>
> You are competing against {N-1} other agents. The winning prototype gets used in the real app.
> ```
>
> ### Scoring Rubric
>
> {Paste the full QA Scoring Rubric from above}
>
> ### Important
>
> - Be honest and precise. Inflated scores help nobody.
> - Be specific in feedback. "Add a working search filter to the escalation list that filters by severity and category" is useful. "Improve interactivity" is not.
> - Score faithfulness to the *feel* of the design system, not pixel-matching.
> - Note file sizes and line counts — they are part of the rubric.

---

## QA Reviewer Prompt

Send this to the qa-reviewer agent:

---

> ### Your Role
>
> You are **qa-reviewer** for a Design Challenge. You are the second pair of eyes. You validate the design-advisor's scores and catch things they miss.
>
> ### Process
>
> 1. Wait for design-advisor to complete initial scoring
> 2. Read at minimum: the top 5 prototypes and the bottom 5 prototypes by score
> 3. For each, independently assess whether the score is fair (+/- 5 points)
> 4. If you disagree by more than 5 points on any dimension, flag it to design-advisor with your reasoning
> 5. Check for issues the design-advisor might miss: broken JavaScript, non-functional buttons, CSS overflow/clipping, accessibility basics
> 6. Report your validation results to ops-lead
>
> ### You Are Not a Gatekeeper
>
> Your job is quality assurance on the SCORES, not on the prototypes. You are making sure the judging is fair, not blocking designers from shipping.

---

## Timeline Summary

| Phase | Duration | Who Works | What Happens |
|-------|----------|-----------|-------------|
| 1. Setup | ~2 min | PM (you) | Create dirs, create team, launch agents |
| 2. Build | ~5-10 min | Designers | All designers build V1 simultaneously |
| 3. QA Review | ~10-15 min | Ops team | Score all prototypes, deliver feedback |
| 4. Rebuild | ~15-20 min | Designers | Designers rebuild based on QA feedback |
| 5. Final Scoring | ~5-10 min | Ops team | Re-score, compile leaderboard, done |
| **Total** | **~40-55 min** | | |

---

## Checklist for the Orchestrating Agent

Before launching, confirm:

- [ ] All output directories created
- [ ] Single team created with ALL agents (ops + designers)
- [ ] Ops team launched and initialized BEFORE designers
- [ ] Each designer prompt includes: design system name, app description, features, output path, scoring rubric, ops team availability, competitive framing, creative freedom statement
- [ ] Each ops prompt includes: phase transition triggers, reporting cadence, common failure modes
- [ ] Design reports included in designer prompts (if available)

During the challenge, watch for:

- [ ] Ops-lead reporting every 2 minutes during build phase
- [ ] Ops-lead transitioning promptly when all files exist (not continuing to scan)
- [ ] QA feedback being delivered to all designers (not just some)
- [ ] Ops-lead compiling leaderboard promptly after final scoring (not requiring multiple pings)
- [ ] Final LEADERBOARD.md saved to output directory

---

## Lessons Baked Into This Playbook

These are not suggestions. They are hard-won corrections from a real run that produced 2.5MB of prototypes across 17 agents. Every instruction in this document exists because the opposite was tried and failed.

1. **One team, zero solo agents.** Solo background agents can't receive messages reliably. Every agent is a team member.
2. **Ops is a team of 3, never a solo monitor.** A solo monitor can't coordinate with itself. Lead + advisor + reviewer.
3. **Designers know about ops from the start.** Not as a follow-up message. In the initial prompt.
4. **Creative freedom is in the initial prompt.** "Design report is a starting point, not a cage" — from minute zero, not as a correction.
5. **QA feedback is a built-in phase, not an afterthought.** It drove 16/17 agents to produce V2+ rewrites. It was the single most valuable intervention.
6. **Clear phase transitions prevent drift.** Ops-lead has explicit triggers for when to stop one activity and start the next.
7. **Competitive framing works.** "The winner gets used in the real app" produced extraordinary effort across the board.
8. **Scoring on 8 dimensions beats file-size-only.** The rubric catches quality that raw size misses.
9. **Allocate time for the full cycle:** Build, QA, Feedback, Rebuild. Skipping the rebuild phase discards the highest-ROI step.
10. **Thoroughness beats speed.** Agents with more tool calls produced better work. The prompt explicitly encourages depth.
11. **Single-file prototypes.** One `index.html` with everything inline. No external deps. Just open the file.
12. **Realistic mock data is scored.** It is 12.5% of the rubric. Generic placeholders lose.
13. **Frequent progress updates to PM.** The human running this wants to know what is happening, not be surprised 40 minutes later.
14. **The leaderboard is the deliverable.** Everything builds toward the final ranked leaderboard with scores, changes, and commentary.
