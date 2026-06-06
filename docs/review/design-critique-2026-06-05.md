# Design Critique — QBO Escalation Assistant (v2, full coverage)

**Date:** 2026-06-05
**Reviewer:** Claude — live UI walkthrough (Chrome) + source audit
**Scope:** All 14 nav destinations + Settings, at desktop (1536px) **and** real 390px mobile. Cross-referenced against `client/src`.
**Benchmark:** Apple HIG, Google Material 3, Airbnb DLS, *Refactoring UI*, Nielsen-Norman heuristics, WCAG 2.2.
**Method:** Computed-style + contrast measurement from the live DOM, full-view screenshot tour, an injected 390px iframe for true mobile, and CSS/JSX source verification. Every number is measured, not estimated.

### Companion deliverables (in this folder)

- `proposed-tokens.css` — a single source-of-truth token file built from the values that actually render today, with the contrast/radius/font conflicts fixed and a migration path. Drop-in starting point for P0-1.
- `dashboard-redesign.html` — an interactive **before / after** mockup of the Escalation Dashboard (open it in a browser, toggle the two states). Demonstrates P0-2, P1-3, P1-4, P1-6 on real data.

---

## Verdict

Feature-rich and largely functional, but it presents as an **internal engineering console, not a productized tool**. The companies you named (Apple, Google, Airbnb, Tesla) win on the same three things: **one design language, ruthless hierarchy, and restraint.** This app misses all three — and most symptoms share one root cause.

**Root cause — no single source of truth for design.** Seven CSS files declare `:root` tokens, and an 8,761-line `overhaul.css` overrides the base system with **3,196 `!important` rules** (3,673 total in `client/src`). One token (`--radius-sm`) is even defined twice *in the same file* with different values. Fix this first; the rest are downstream.

A second, cross-cutting theme emerged once I toured every view: **perceived performance and empty states are weak.** Heavy views take 4–9s to paint, show only "LOADING VIEW…" or a blank canvas (no skeletons), several land on all-zero/"No data" screens, and the app constantly surfaces "Recent slow requests" banners to the user.

### Scorecard

| Dimension | Grade | One-line |
|---|---|---|
| Design-system consistency | **F** | Two token systems fight via `!important`; 19 palettes. |
| Visual hierarchy | **D** | Equal-weight stat walls; the number that matters never leads. |
| Color & contrast | **D** | Body/secondary text down to 2.3–2.8:1 (fails WCAG AA). |
| Typography | **C−** | Two sans families live at once; 25% of text < 12px; 8px badges. |
| Information architecture | **D** | 14 top-level items; cryptic labels (Sess, Attn, Tmpl). |
| Perceived performance / states | **D** | Blank/slow views, no skeletons, all-zero dashboards. |
| Interaction / touch targets | **D** | 93% of controls < 32px min dimension. |
| Content & voice | **D** | Internal jargon + dev version strings leak to UI. |
| Responsive | **B−** | Genuinely reflows to mobile (hamburger + grid) — a real strength. |
| Accessibility (semantics) | **C+** | Good: aria-labels, skip link, error boundary. Bad: contrast. |

---

## View coverage map

Every destination, visited live. "Renders" = painted its own content within a few seconds.

| View | Route | Observed state |
|---|---|---|
| Chat | `#/chat` | Renders. Dense 5-stage pipeline + 3 stacked side panels. |
| Sessions | `#/sessions` | Shell + stat cards render fast; list stuck on "Loading sessions…" past 4.5s. |
| Dashboard | `#/dashboard` | Renders. Hierarchy + contrast issues (P0-2 / P1-3). |
| Attention | `#/attention` | A Dashboard tab; during the tour it showed **Workspace** content — transition bleed. |
| Knowledge | `#/knowledge` | Renders. 7 stat cards, 6 reading `0`; heavy jargon. |
| Investigations | `#/investigations` | Renders **well** (clean list, real filters); slow load; dims on refresh. |
| Agents | `#/agents` | Renders. Provider badges truncate mid-word ("…gemini-", "No tools confi…"). |
| Playbook | `#/playbook` | Blank after 2.5s — no content, no skeleton. |
| Templates | `#/templates` | "LOADING VIEW…" still showing after 2.5s. |
| Analytics | `#/analytics` | Blank in screenshots through 9s; own content not confirmed. |
| Gallery | `#/gallery` | Blank after 3s — no empty-state message. |
| Usage | `#/usage` | Renders an **all-zero** dashboard ("0 TOTAL TOKENS, $0.00, No data" ×5). |
| Workspace | `#/workspace` | Renders (clean overview); 2 of 4 cards are "Reserved for… future". |
| Rooms | `#/rooms` | Blank — `ChatRoom` with no room selected and no empty-state guidance. |
| Settings | `#/settings` | Cleanest view in the app; gated behind a terminal-style boot overlay. |

> Cross-view bug confirmed twice: navigating `#/rooms` (and `usage → analytics`) left the *previous* view's content painted under the new route for seconds. Slow transitions are bleeding stale content across routes.

---

## P0 — Fix first (systemic)

### 1. Collapse the competing design systems into one token source
**Evidence (verified live + in source):**
- `:root` tokens are declared in **7 files**: `App.css`, `overhaul.css`, `design-system.css`, `design-system-v2.css`, `depth-effects.css`, `console-density.css`, `themes/atmospherics.css`.
- `overhaul.css` redefines the palette with `!important`: `--bg` is `#0a0a0f` in `App.css` but `#1c1c1e !important` here; `--accent` `#6ea1f7` → `#0a84ff !important`; `--ink` `#e4e4e8` → `#f5f5f7 !important`. App.css's tokens are dead code that still ships.
- `--radius-sm` is set to **8px** (overhaul.css:69) and **5px** (overhaul.css:7323) — both `!important`; 5px wins by source order, not intent.
- **3,673 `!important`** in `client/src` CSS; **3,196 in `overhaul.css`**.
- The palette also mixes metaphors: Apple blue (`--accent:#0a84ff`) + `--tesla-red:#e31937` + a purple `--premium-gradient`. Three aesthetics in one file.
- Settings → About confirms the cause: **"19 palettes"** plus a separate "Design Identity (Warm Authority)", active theme "Apple".

**Principle:** Airbnb DLS and Material both rest on one token layer everything consumes. `!important` is the symptom of a broken cascade — each one forces the next.

**Fix:** Adopt `proposed-tokens.css` (this folder) as the only `:root`; delete the other six token blocks; strip `!important` from `overhaul.css` in waves (values match what already renders, so nothing should move); trim 19 palettes to 2–3. **Target: one `:root`, zero `!important` in token defs.**

### 2. Give data screens a real hierarchy
**Evidence:** Dashboard shows five equal-weight cards — `91 OPEN` sits beside `0 IN PROGRESS / 1 RESOLVED / 0 ESCALATED / 0.1h`. Knowledge shows **seven** cards, six reading `0`. Usage shows **eight** all-zero tiles. The eye has nowhere to land.

**Principle:** *Refactoring UI* — "emphasize by de-emphasizing." Make the primary metric dominant; mute zeros.

**Fix:** See `dashboard-redesign.html` → "After": one hero metric (91), zeros demoted to a quiet inline row, empty cards muted. Files: `EscalationDashboard.jsx/.css`, `KnowledgebaseView.jsx/.css`, `UsageDashboard.jsx`.

---

## P1 — High impact

### 3. Fix text contrast (accessibility failure)
**Evidence — measured against rendered `--bg` `#1c1c1e`:**

| Text | Color | Ratio | WCAG AA (4.5:1) |
|---|---|---|---|
| Pipeline step numbers, table dates, subtitles | `#636366` (`--ink-tertiary`) | **2.84:1** | ✗ |
| Model badges "default/medium/x-high" (also **8px**) | `#0a84ff` | **3.82:1** | ✗ |
| `--ink-secondary` | `#a1a1a6` | 6.61:1 | ✓ |
| `--accent` as text | `#0a84ff` | 4.66:1 | ✓ (just) |

9 of 55 sampled on-screen text elements fell below 4.5:1.

**Fix (verified):** raise `--ink-tertiary` from `#636366` → `#8e8e93` = **5.22:1** (I computed this against the real bg). Keep the old value as `--ink-quaternary` for non-text/decorative use only. Already applied in `proposed-tokens.css`.

### 4. Typography: one family, raise the floor
**Evidence:** Four font families render at once, including **two competing sans stacks** — an SF-Pro-first stack (`overhaul.css`, `design-system-v2.css`) and an Inter-first stack (`--font-sans`, `App.css:30`) — plus a stray `Arial` on `.sidebar-collapse-btn`. **73 of 292** visible text nodes (25%) render < 12px; 22 < 11px; chat pipeline badges at **8px**.
**Fix:** one sans (Inter *or* SF) set once; min body 12–13px; 11px for micro-labels only; kill 8px. In `proposed-tokens.css` there is no token below 11px.

### 5. Reduce top-level nav from 14 to a focused set
**Evidence:** Left rail = 14 destinations; collapsed labels are cryptic: **Sess, Attn, KB, INV, Agt, Book, Tmpl, Stats, Gal, Rm**. Several destinations are empty, all-zero, or overlap (Analytics/Usage both surface usage-style data).
**Principle:** Miller's law / NN-g — ~5–7 primary items; recognition over recall.
**Fix:** group into ~5 areas (Work, Knowledge, Agents, Insights, Settings) with the rest nested. Never ship "Tmpl"/"Gal" — widen the rail or use labeled tooltips. File: `Sidebar.jsx`.

### 6. Make destructive + primary actions deliberate
**Evidence:** Every Dashboard row ends in a low-contrast ghost **"Delete"** — destructive, likely irreversible, and the quietest thing on the row. Several views stack 2–3 outline buttons (Refresh / Dry Run / Create) with no dominant primary.
**Fix:** move row Delete into a `⋯` overflow with confirm; promote exactly one filled-accent CTA per view (see mockup "After"). Files: `EscalationDashboard.jsx`, `KnowledgebaseView.jsx`.

### 7. Perceived performance + empty states
**Evidence:** Playbook/Gallery/Rooms painted **blank** (3–6s, no skeleton, no empty-state copy); Templates/Workspace sat on bare "LOADING VIEW…"; Sessions stuck on "Loading sessions…"; Usage rendered all-zeros. Stale content bled across `#/rooms` and `usage→analytics`. "Recent slow requests" banners recur constantly.
**Principle:** Apple/Material — show structure immediately (skeletons), never a blank canvas; empty states must explain and offer an action; don't expose internal latency telemetry to end users.
**Fix:** add skeleton loaders to lazy views; give every list a real empty state ("No rooms yet — start one"); demote the slow-request banner to a quiet diagnostics surface. *(See caveat — some first-load slowness is dev-only.)*

---

## P2 — Polish

### 8. Touch / click targets
**124 of 134** interactive controls (93%) have a min dimension < 32px; **51 (38%) < 24px**; header icons 28–34px. Apple HIG wants 44px, Material 48dp. Grow hit areas via padding without enlarging icons.

### 9. Cut jargon + dev leakage
User-facing: "Tab trust state", "Evidence strength", "Ontology", "Legacy sources", "Runtime not mapped". Header tooltips expose build strings: **"codex-cli 0.137.0", "2.1.162 (Claude Code)"**. A terminal boot overlay (`[boot] Initializing… [chk] Polling agent reachability`) gates Settings. Move version/debug to an About panel; make the overlay skippable. Files: `KnowledgebaseView.jsx`, `AppHeader.jsx`, `AgentBootOverlay.jsx`.

### 10. Layout / label bugs
- The "Knowledge Gaps" widget renders its count glued to the label — **"Knowledge Gaps2 need attention"** (`div.knowledge-gaps`, `EscalationDashboard`). Reproduced at desktop **and** 390px. Fix: space + a real badge (`Knowledge gaps · [2] need attention`), shown in the mockup.
- Agents provider badges truncate mid-word; header status pill truncates ("…C…"). Allow wrap or ellipsis-with-tooltip. Files: `AgentsView.css`, `AppHeader.jsx`.

### 11. Standardize breakpoints
Viewport meta present; 116 media queries across **~20 distinct breakpoints** (900, 768, 760, 600, 1100, 860, 480, 500, 1200, 1024, 980, 800, 720, 700, 640, 1180, 780, 1320, 1280, 1080). No scale. Define `--bp-sm/md/lg/xl` (in `proposed-tokens.css`) and refactor to them.

---

## What's already good (keep it)

- **Mobile genuinely works.** At 390px the rail collapses to a hamburger and the stat cards reflow to a clean 2-column grid. I verified this in a real 390px render — it's a strength my first pass under-credited.
- **Investigations and the Workspace overview are well-organized** — clear headers, real filters, sensible card layouts. Use them (and Settings) as the internal reference for fixing the rest.
- **Screen-reader semantics beat the visuals:** 0 unlabeled icon buttons (header icons carry proper `aria-label`s), plus a "Skip to main content" link and a graceful error boundary.
- **The token *structure* is sound** where it isn't duplicated — real type scale, spacing, easing, semantic colors, dark-mode weight compensation. Good bones; they just need to be unified.
- Accent (`#0a84ff`) and semantic colors are well chosen.

---

## Methodology & honest caveats

- **Verified live:** computed `:root` tokens, WCAG contrast ratios (incl. the proposed fix at 5.22:1), font sizes, control dimensions, accessible names, viewport metrics, real 390px render, and all routing/source claims.
- **Dev-build caveat:** this is a Vite dev server; lazy chunks compile on first navigation, so *some* of the 4–9s view delays are dev-only and would shrink in a production build. The design issues that remain regardless: no skeletons, blank canvases with zero feedback, all-zero empty states with no guidance, and cross-route content bleed. Confirm the perf findings against a `npm run build` preview.
- **Not a defect:** the Agents view briefly showed "KnowledgeCommandCenter is not defined" — verified to be a transient HMR/dev artifact (the component is defined at `KnowledgebaseView.jsx:876`); it renders fine. Not counted.
- **Not confirmed:** Analytics (`<Analytics/>`) never painted its own content within 9s in screenshots; I did not confirm what it renders (the "Usage Monitor" text seen under that route was stale bleed from the prior Usage visit). Worth a direct check.
- **Numbers** were sampled from the Chat and Dashboard views primarily; contrast/size ratios will be similar elsewhere given the shared (forced) token set.

## Order of attack

1. **Adopt `proposed-tokens.css`; kill `!important`** (P0-1) — unblocks everything.
2. **One font + contrast floor** (P1-3, P1-4) — fast, high visible payoff.
3. **Hierarchy on Dashboard / KB / Usage** (P0-2) — biggest "feels designed" win; see `dashboard-redesign.html`.
4. **Skeletons + empty states** (P1-7) — removes the blank-screen feel.
5. **Nav consolidation + jargon** (P1-5, P2-9), then **targets, bugs, breakpoints** (P2).
