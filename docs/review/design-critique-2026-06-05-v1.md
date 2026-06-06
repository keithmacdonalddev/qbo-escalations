# Design Critique — QBO Escalation Assistant

**Date:** 2026-06-05
**Reviewer:** Claude (live UI + source review)
**Scope:** Running app at `localhost:5174` (Chat, Dashboard, Knowledge, Agents, Settings) cross-referenced against `client/src`.
**Benchmark:** Apple HIG, Google Material 3, Airbnb DLS, *Refactoring UI*, Nielsen-Norman heuristics, WCAG 2.2.
**Method:** Live DOM measurement (computed styles, contrast ratios, element sizing) + CSS/JSX source audit. Every number below was measured this session.

---

## Verdict

The app is **functional and feature-rich, but it reads as an internal engineering console, not a productized tool**. The companies you named (Apple, Google, Airbnb, Tesla) all win on the *same* thing: **one design language, ruthless hierarchy, and restraint.** This app violates all three — and almost every visual problem traces back to a single root cause.

**Root cause: there is no single source of truth for design.** Seven CSS files define `:root` tokens, and an 8,761-line `overhaul.css` overrides the base system with **3,196 `!important` declarations**. The cascade is effectively broken — the design "system" is at war with itself. Fix this first; most other issues are symptoms.

### Scorecard

| Dimension | Grade | One-line |
|---|---|---|
| Design-system consistency | **F** | Two complete token systems fight via `!important`. |
| Visual hierarchy | **D** | Walls of equal-weight cards; the one number that matters doesn't stand out. |
| Color & contrast | **D** | Secondary/tertiary text fails WCAG AA (down to 2.3:1). |
| Typography | **C−** | Two sans families in use; 25% of text under 12px; badges at 8px. |
| Information architecture | **D** | 14 top-level destinations with cryptic labels (Sess, Attn, Tmpl). |
| Interaction / touch targets | **D** | 93% of controls are below a 32px target. |
| Content & voice | **D** | Internal jargon and dev version strings leak to the UI. |
| Responsive | **C−** | Responsive CSS exists but uses ~20 ad-hoc breakpoints, no scale. |
| Accessibility (semantics) | **C+** | Good: aria-labels, skip link, error boundary. Bad: contrast. |

---

## P0 — Fix first (systemic)

### 1. Collapse the competing design systems into one token source
**Evidence (verified):**
- 7 files declare `:root` tokens: `App.css`, `overhaul.css`, `design-system.css`, `design-system-v2.css`, `depth-effects.css`, `console-density.css`, `themes/atmospherics.css`.
- `overhaul.css` redefines the entire palette with `!important` — e.g. `--bg` is `#0a0a0f` in `App.css` but `#1c1c1e !important` in `overhaul.css`; `--accent` is `#6ea1f7` vs `#0a84ff !important`; `--ink` is `#e4e4e8` vs `#f5f5f7 !important`. The override always wins, so `App.css`'s tokens are dead code that still ships.
- Same token defined twice *in one file*: `--radius-sm` is `8px` (overhaul.css:69) and `5px` (overhaul.css:7323), both `!important`. Rendered value is `5px` — by accident of source order, not intent.
- **3,673 `!important` declarations** across `client/src` CSS; **3,196 in `overhaul.css` alone**.

**Principle:** Airbnb's DLS and Material both rest on *one* token layer that everything consumes. `!important` is a signal that the cascade has failed — it makes the next change require *another* `!important`, compounding forever.

**Fix:** Pick one file as the single token source (the active "Apple" theme values that actually render). Delete the duplicate `:root` blocks. Then remove `!important` in waves, starting with `overhaul.css`, verifying nothing regresses. Target: **zero `!important` in token definitions** and one `:root`. This is the highest-leverage change in the codebase.

> Context discovered in Settings → About: the app ships **"19 palettes"** plus a separate "Design Identity." That ambition is *why* `overhaul.css` exists. Nineteen themes is far more variation than an internal tool needs and is the source of the inconsistency. Recommend cutting to 2–3 well-tested themes (light, dark, high-contrast).

### 2. Establish real visual hierarchy on data screens
**Evidence:** On the Dashboard, five stat cards (`91 OPEN`, `0 IN PROGRESS`, `1 RESOLVED`, `0 ESCALATED`, `0.1h AVG`) have **identical visual weight** — the four zeros are as loud as the one number that matters. The Knowledgebase shows **seven cards, six of which read `0`**.

**Principle:** *Refactoring UI* — "emphasize by de-emphasizing." Apple/Google dashboards make the primary metric dominant and mute empty/zero states. Equal weight = no hierarchy = the user's eye has nowhere to land.

**Fix:** One hero metric per screen (large, high-contrast). Render zero-value cards in a muted, smaller treatment. Collapse rarely-used metrics behind a "more" affordance. Files: `EscalationDashboard.jsx/.css`, `KnowledgebaseView.jsx/.css`.

---

## P1 — High impact

### 3. Fix text contrast (accessibility failure)
**Evidence (measured against the rendered `--bg` `#1c1c1e`):**
- Pipeline step numbers (1–5), color `#636366` (`--ink-tertiary`): **2.33–2.84:1** — fails WCAG AA (needs 4.5:1) *and* the 3:1 floor for large/non-text.
- Model badges ("default", "medium", "x-high") render at **8px**, weight 800, accent blue: **3.82:1** — too small and too low.
- 9 of 55 sampled on-screen text elements fall below 4.5:1.

**Principle:** Apple HIG and WCAG both require legible contrast. "Subtle gray" on near-black is the single most common dark-UI mistake.

**Fix:** Lift `--ink-tertiary` until body-size text clears 4.5:1 on `--bg` (≈ `#9a9aa0`+). Never use tertiary ink for text below ~13px. Files: token source + `chat-v5.css` badge styles.

### 4. Typography: one font family, raise the floor
**Evidence:** Four font families render simultaneously, including **two competing sans stacks** — an SF-Pro-first stack (from `overhaul.css`/`design-system-v2.css`) and an Inter-first stack (`--font-sans`, `App.css:30`) — plus a stray `Arial` on `.sidebar-collapse-btn`. **73 of 292** visible text elements (25%) render under 12px; 22 under 11px; some badges at 8px.

**Principle:** A consistent type system is table stakes for Airbnb/Apple-grade polish. Mixed families read as unfinished.

**Fix:** Choose one (Inter *or* the SF system stack) and set it once in the token source. Set a minimum body size of 12–13px; reserve 11px for true micro-labels only; eliminate 8px. Files: token source, `chat-v5.css`.

### 5. Reduce top-level navigation from 14 to a focused set
**Evidence:** The left rail exposes 14 destinations (Chat, Sessions, Dashboard, Attention, Knowledge, Investigations, Agents, Playbook, Templates, Analytics, Gallery, Usage, Workspace, Rooms). Collapsed, they show cryptic labels: **Sess, Attn, Tmpl, Gal, Rm**.

**Principle:** Miller's law / NN/g — primary nav should be ~5–7 items. Cryptic abbreviations fail "recognition over recall." Tesla/Apple win by hiding complexity, not surfacing all of it.

**Fix:** Group into 5–6 primary areas (e.g. *Work*, *Knowledge*, *Agents*, *Insights*, *Settings*) with secondary items nested inside. Never ship a truncated label like "Tmpl" — if the rail is too narrow for "Templates," widen it or use tooltips on icon-only mode. File: `Sidebar.jsx`.

### 6. Make destructive and primary actions deliberate
**Evidence:** Every Dashboard row ends in a low-contrast ghost **"Delete"** — a destructive, likely irreversible action rendered as the *quietest* element on the row. Multiple screens also stack 2–3 outline buttons (Refresh / Dry Run / Create) with no clear primary.

**Principle:** Material & HIG — destructive actions should require intent (confirmation, or tuck behind an overflow menu), and each view should have exactly one visually dominant primary action.

**Fix:** Move row-level Delete into an overflow (`⋯`) menu with a confirm step; promote one CTA per screen to filled-accent and demote the rest to ghost. Files: `EscalationDashboard.jsx`, `KnowledgebaseView.jsx`.

---

## P2 — Polish

### 7. Touch / click targets are too small
**Evidence:** **124 of 134** interactive controls (93%) have a minimum dimension under 32px; **51 (38%) under 24px.** Header icon buttons measure 28–34px.
**Principle:** Apple HIG 44px, Material 48dp. Small targets hurt even with a mouse (Fitts's law).
**Fix:** Set a minimum hit area of 40–44px (padding can grow the target without enlarging the icon).

### 8. Cut internal jargon and dev leakage from the UI
**Evidence:** User-facing copy includes "Tab trust state," "Evidence strength," "Ontology," "Legacy sources," "Runtime not mapped." Header tooltips expose build strings: **"codex-cli 0.137.0," "2.1.162 (Claude Code)."** A terminal-style boot overlay (`[boot] Initializing… [chk] Polling agent reachability`) gates the Settings view.
**Principle:** Voice & tone — productized tools speak the user's language, not the system's. Version strings and boot logs belong in a debug panel.
**Fix:** Rewrite labels in plain language; move version/debug detail to an "About/Diagnostics" section; make the boot overlay skippable or remove it. Files: `KnowledgebaseView.jsx`, `AppHeader.jsx`, `AgentBootOverlay.jsx`.

### 9. Layout/overflow bugs
**Evidence:** On Agents, provider badges truncate mid-word ("Google Gemini API: gemini-", "No tools confi…"). The header status pill truncates ("Recent slow requests… C…"). On the Dashboard a "Knowledge Gaps need attention / 30 days" control floated **overlapping** the stat cards.
**Fix:** Allow badges to wrap or use a min-width + ellipsis with a tooltip showing the full value; verify the "Knowledge Gaps" popover anchor/z-index. Files: `AgentsView.css`, `AppHeader.jsx`, `EscalationDashboard.css`.

### 10. Standardize responsive breakpoints
**Evidence:** Viewport meta is present and there are 116 media queries — but across **~20 distinct breakpoints** (900, 768, 760, 600, 1100, 860, 480, 500, 1200, 1024, 980, 800, 720, 700, 640, 1180, 780, 1320, 1280, 1080). No shared scale.
**Principle:** A 3–4 step breakpoint scale (consumed as tokens/mixins) keeps layouts coherent. Twenty arbitrary values guarantee drift.
**Fix:** Define `--bp-sm/md/lg/xl` and refactor queries to use them.

---

## What's already good (keep it)

- **Screen-reader semantics are better than the visuals suggest:** 0 unlabeled icon buttons — header icons carry proper `aria-label`s ("Open settings," "Inbox," etc.), and a "Skip to main content" link exists.
- **Graceful error boundary** with a clear recovery UI ("Reload page" / "Try again").
- **Settings is genuinely clean** — well-grouped sub-nav and a calm About page; use it as the visual reference for the rest of the app.
- **The token *structure* (where it isn't duplicated) is sound:** real type scale, spacing, easing tokens, semantic colors, and even dark-mode weight compensation. The bones are good — they just need to be unified.
- The accent (`#0a84ff`) and semantic colors are well-chosen and on-trend.

---

## Methodology & honest caveats

- **What I measured live:** computed `:root` tokens, WCAG contrast ratios, font sizes, control dimensions, accessible names, viewport metrics — all from the running DOM this session.
- **Mobile not pixel-verified:** the browser window would not drop below 1536px here, so I could **not** capture a true phone viewport. The responsive findings are inferred from source (media queries) + the desktop-first density, not from a mobile screenshot. Treat #10 as "needs hands-on mobile testing."
- **Not a real bug:** the Agents view briefly showed "KnowledgeCommandCenter is not defined." I verified this was a **transient HMR/dev artifact** — the component *is* defined (`KnowledgebaseView.jsx:876`) and the view renders correctly on reload. Not counted against the design.
- **Coverage:** I reviewed Chat, Dashboard, Knowledge, Agents, and Settings in depth. I did **not** exhaustively audit Investigations, Sessions, Rooms, Gallery, Analytics, Playbook, Templates, Workspace, Calendar, or Gmail — though the systemic findings (tokens, hierarchy, density) almost certainly apply there too.

## Suggested order of attack

1. **Unify tokens, kill `!important`** (P0-1) — unblocks everything else.
2. **One font + contrast floor** (P1-3, P1-4) — fast, high visible payoff.
3. **Hierarchy on Dashboard + KB** (P0-2) — biggest "feels designed" win.
4. **Nav consolidation + jargon cleanup** (P1-5, P2-8) — clarity.
5. **Targets, overflow bugs, breakpoints** (P2) — final polish.
