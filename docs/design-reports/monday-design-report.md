# Monday.com Design System Analysis & Application to QBO Escalation Tool

*Design research report -- March 2026*
*Sources: Monday.com Vibe design system (GitHub mondaycom/vibe), vibe.monday.com, monday.com product interface, design-system.md reference document*

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Monday.com Design Philosophy](#mondaycoms-design-philosophy)
3. [Key Design Patterns](#key-design-patterns)
4. [Color System](#color-system)
5. [Typography and Spacing](#typography-and-spacing)
6. [Motion and Interaction](#motion-and-interaction)
7. [Accessibility](#accessibility)
8. [Application to QBO App](#application-to-qbo-app)
9. [What NOT to Copy](#what-not-to-copy)
10. [Implementation Priority](#implementation-priority)

---

## Executive Summary

Monday.com's Vibe design system represents the extreme opposite end of the design spectrum from our current QBO app. Where the QBO tool embraces "Warm Authority" -- muted warm neutrals, restrained accents, long-session eye comfort -- Monday.com embraces "Vibrant Visual Engagement" -- a full rainbow of 40+ named colors, bold status indicators, and color-as-primary-navigation. Neither approach is objectively correct; each is optimized for its user's workflow.

The most valuable ideas to extract from Monday.com are NOT its loudness, but rather its structural innovations: color-coded grouping for instant visual scanning, the status column paradigm (where status is always visible without clicking), progressive disclosure through board groups, and the way color functions as a navigation and memory system rather than mere decoration. These patterns solve real problems our escalation specialists face -- particularly the need to scan dozens of cases quickly and identify stuck/urgent items without reading every line.

This report recommends selectively adopting four Monday.com patterns, adapted to our warm authority visual language: (1) color-banded category groups on the dashboard, (2) inline status columns with color indicators, (3) a board-color selector for personal workspace organization, and (4) Monday.com's productive/expressive motion split for interaction feedback.

---

## Monday.com Design Philosophy

### Vibrant Visual Engagement

Monday.com's design philosophy can be summarized as: **color is not decoration, it is structure.** Every project board, every status column, every priority level, and every team workspace gets a distinct color. This is not visual excess -- it is a deliberate strategy to make project management feel less like spreadsheet work and more like a visual, spatial activity.

The philosophy rests on three pillars:

**1. Color as Navigation Memory**
Users do not read board titles to navigate -- they recognize the purple board (Marketing), the green board (Engineering), the orange board (Sales). This leverages the human visual system's preattentive processing: color recognition is faster than text parsing by approximately 200ms. For a user managing 15+ boards, this eliminates the reading-and-comparing step entirely.

**2. Playful Professionalism**
Monday.com deliberately avoids the gray-corporate aesthetic common in enterprise PM tools. Their bet is that if work management feels visually engaging, users will actually use the tool rather than abandoning it for sticky notes and spreadsheets. The vibrant palette communicates "this is a creative, human activity" rather than "this is administrative overhead." Their primary brand color (#6161FF, a purple-blue) is warm enough to avoid clinical coldness while being saturated enough to feel energetic.

**3. Status at a Glance**
The most structurally important pattern in Monday.com is the status column -- a colored cell that communicates item state without requiring the user to open, click, or read details. Done is green (#00C875). Working on it is orange (#FDAB3D). Stuck is red (#DF2F4A). These colors are visible from across the room on a large monitor. The entire board communicates progress through its color distribution: a board that is mostly green is healthy; a board with red clusters has problems.

### How This Differs from QBO's "Warm Authority"

The QBO app's current design identity ("Warm Authority") was built for a different use case: an escalation specialist who spends 8+ hours reading detailed case information, composing careful responses, and managing complex multi-step troubleshooting. The warm cream/stone palette (#f5f2ed backgrounds, #2a2420 text) reduces eye fatigue. The single accent color (#c76a22 ember) provides clear focus without competing for attention.

Monday.com's vibrancy works because its users are scanning, not reading deeply. An escalation specialist reading a customer's bank feed reconciliation issue needs calm focus, not visual stimulation. But when that same specialist needs to scan the dashboard to find all stuck-red payroll escalations from the last 48 hours, Monday.com's color-scanning approach is genuinely superior.

The opportunity is to use Monday.com's structural color patterns in scanning/navigation contexts while preserving Warm Authority in reading/composition contexts.


---

## Key Design Patterns

### Board Groups with Color-Coded Headers

Monday.com organizes items within a board into "groups" -- collapsible sections with a bold color stripe on the left edge and a colored header row. Each group gets one of 12+ colors (purple #A25DDC, indigo #6161FF, blue #579BFC, teal #66CCFF, green #00C875, lime #9CD326, yellow #FFCB00, orange #FDAB3D, red #E2445C, magenta #FF158A, berry #BB3354, brown #7F5347).

**What makes this effective:**
- Groups are visually distinct even when collapsed to a single header row
- The color stripe provides a persistent left-edge anchor for scanning
- Users can assign semantic meaning to colors (e.g., all "urgent" groups are red, all "resolved" groups are green)
- Collapsing a group reduces it to a single colored bar, freeing screen space while maintaining visual identity

**QBO application potential:** The escalation dashboard currently lists all cases in a flat table. Grouping by category (Payroll, Bank Feeds, Billing, Tax, etc.) with a colored left stripe matching our existing category badge colors (--cat-payroll-bg, --cat-bank-feeds-bg, etc.) would let specialists scan for their category instantly. Each group could collapse to show just a count.

### Status Columns (Inline Color Cells)

The defining UI element of Monday.com. Each row has one or more status columns -- rectangular cells filled with a solid status color and a short text label. The cell background IS the status. This is structurally different from our current approach where status is a small pill badge.

Monday.com's status colors (from the Vibe light theme):
- Done: #00C875 (saturated green)
- Working on it: #FDAB3D (warm orange)
- Stuck: #DF2F4A (urgent red)
- Not started: #C4C4C4 (neutral gray)
- Critical: #333333 (near-black, impossible to miss)
- Priority High: #E2445C (rose red)
- Priority Medium: #FDAB3D (orange, same as "working")
- Priority Low: #579BFC (calm blue)

**What makes this effective:**
- The status is visible at the table level -- no need to click into a detail view
- Color fills the entire cell, making it visible from a distance
- The status label is short (1-3 words) and redundant with the color for accessibility
- Multiple status columns can coexist (e.g., "Status" + "Priority" + "Assignee Status")

**QBO application potential:** The dashboard table could replace the small badge pills with wider, color-filled status cells. This would make the open/in-progress/resolved/escalated distribution visible at a glance across the entire list.

### Timeline and Gantt Views

Monday.com provides timeline views where items are shown as horizontal bars on a date axis. Each bar is colored according to its group or status. This creates a visual map of workload distribution across time.

**QBO application potential:** Limited. Escalations are reactive, not planned, so timeline views are less useful. However, a "last 7 days" heatmap showing escalation density by category and day could use a similar visual language.

### WorkDocs (Collaborative Documents)

Monday.com embeds rich documents directly within the work management context. Documents live alongside items, not in a separate system. This reduces context-switching.

**QBO application potential:** The existing playbook editor already serves this function. No significant pattern to adopt.

### Dashboard Widgets

Monday.com dashboards use colorful widgets -- pie charts, bar graphs, counters, timelines -- all inheriting the board's color system. Each widget is a self-contained card with a clear title and a single data visualization.

**QBO application potential:** The analytics view could benefit from widget-style cards that use category colors consistently. Currently, the stat-card component exists but uses neutral styling. Adding category-colored accents (a top border or left stripe matching the escalation category) would create visual coherence with a Monday.com-inspired grouped dashboard.


---

## Color System

### The 40+ Named Color Palette

Monday.com's Vibe design system defines an extraordinarily large color palette. Unlike most design systems that provide 5-8 semantic colors, Monday.com provides 40+ named colors, each with base, hover, and selected variants. This is not excess -- it is the foundation of their color-as-structure philosophy.

**Confirmed color tokens from the Vibe light theme (packages/style/src/themes/light-theme.scss):**

#### Core UI Colors

| Token | Value | Purpose |
|-------|-------|---------|
| --primary-color | #0073EA | Interactive elements, buttons, links |
| --primary-hover-color | #0060B9 | Hover state |
| --primary-selected-color | #CCE5FF | Selected state background |
| --primary-text-color | #323338 | Primary body text |
| --secondary-text-color | #676879 | Secondary/muted text |
| --primary-background-color | #FFFFFF | App background |
| --allgrey-background-color | #F6F7FB | Secondary surface |
| --ui-border-color | #C3C6D4 | Component borders |
| --layout-border-color | #D0D4E4 | Layout dividers |

#### Semantic Colors

| Token | Value | Purpose |
|-------|-------|---------|
| --positive-color | #00854D | Success, positive |
| --positive-color-hover | #007038 | Success hover |
| --negative-color | #D83A52 | Error, destructive |
| --negative-color-hover | #B63546 | Error hover |
| --warning-color | #FFCB00 | Warning, caution |
| --warning-color-hover | #EAA15 | Warning hover |

#### Status/Board Colors (The "Rainbow")

This is the signature Monday.com palette -- 40+ named colors used for board groups, status columns, and labels:

**Greens:** grass-green #037F4C, done-green #00C875, bright-green #9CD326

**Yellows/Golds:** saladish #CAB641, egg-yolk #FFCB00

**Oranges:** working-orange #FDAB3D, dark-orange #FF6D3B

**Reds/Warm:** peach #FFADAD, sunset #FF7575, stuck-red #DF2F4A, dark-red #BB3354

**Pinks:** sofia-pink #E50073, lipstick #FF5AC4, bubble #FAA1F1, orchid #E484BD

**Purples:** purple #9D50DD, dark-purple #784BD1, berry #7E3B8A, lavender #BDA8F9, lilac #9D99B9

**Blues:** dark-indigo #401694, indigo #5559DF, navy #225091, bright-blue #579BFC, dark-blue #007EB5, royal #216EDF, steel #A9BEE8

**Cyans/Teals:** aquamarine #4ECCC6, chili-blue #66CCFF, river #74AFCC, teal #175A63, sky #A1E3F6

**Neutrals/Earth:** winter #9AADBD, explosive #C4C4C4, american-gray #757575, blackish #333333, brown #7F5347, tan #BCA58A, coffee #CD9282, pecan #563E3E

Every one of these colors has three variants: base, hover (darker/less saturated), and selected (lighter/more pastel). This creates a systematic 120+ color token set.

### Board Color System (12 Assignment Colors)

These are the 12 colors users can assign to board groups:

| Color | Hex | Approximate Hue |
|-------|-----|-----------------|
| Purple | #A25DDC | 275 |
| Indigo | #6161FF | 240 |
| Blue | #579BFC | 215 |
| Teal | #66CCFF | 200 |
| Green | #00C875 | 155 |
| Lime | #9CD326 | 80 |
| Yellow | #FFCB00 | 48 |
| Orange | #FDAB3D | 35 |
| Red | #E2445C | 350 |
| Magenta | #FF158A | 330 |
| Berry | #BB3354 | 345 |
| Brown | #7F5347 | 15 |

These 12 colors are spaced approximately evenly around the color wheel (roughly every 30 degrees of hue), which maximizes visual distinctness between any two adjacent choices.

### Dark Mode Color Adaptation

Monday.com's dark theme (--primary-background-color: #181B34, a deep navy-purple) shifts the entire palette while maintaining color identity. The dark background is NOT neutral gray or black -- it is tinted with the brand's purple-blue hue, which gives the dark theme a cohesive, intentional feel rather than a generic "inverted" look.

Key dark mode values:
- Backgrounds: #181B34 (primary), #30324E (secondary), #292F4C (surface)
- Text: #D5D8DF (primary), #9699A6 (secondary)
- Borders: #4B4E69 (layout), #797E93 (UI)
- Shadows: Heavier opacity (0.5) with near-black base (#090B19)

### The Hacker Theme

Monday.com also ships a "hacker" theme with Dracula-inspired colors:
- Primary: #FE78C6 (hot pink)
- Background: #282A36 (Dracula gray)
- Positive: #50FA7B (Dracula green)
- Negative: #FF5555 (Dracula red)
- Links: #BD93F9 (Dracula purple)

This demonstrates that the Vibe system is genuinely theme-able -- the color architecture supports radical visual changes while maintaining structural consistency.


---

## Typography and Spacing

### Typography System

Monday.com's Vibe uses a dual-font-family system:

**Body/UI font:** Figtree (with fallbacks to Roboto, Noto Sans Hebrew, Noto Kufi Arabic, Noto Sans JP, sans-serif)
- Figtree is a geometric sans-serif with a friendly, rounded character
- The extensive fallback chain shows Monday.com's internationalization commitment (Hebrew, Arabic, Japanese)

**Title/Heading font:** Poppins (same fallback chain)
- Poppins is a geometric sans-serif with more personality than Inter or Roboto
- Used specifically for H1 and heading contexts via --title-font-family

**Font weight scale:**

| Token | Value |
|-------|-------|
| --font-weight-very-light | 200 |
| --font-weight-light | 300 |
| --font-weight-normal | 400 |
| --font-weight-bold | 500 |

Note: Monday.com's "bold" is 500 (medium), not the typical 700. This creates a softer weight hierarchy that avoids the heavy/aggressive feel of true bold headings. This is a deliberate choice -- it keeps the interface feeling friendly rather than authoritative.

**Font size scale (6 steps):**

| Token | Value |
|-------|-------|
| --font-size-10 | 14px (body default) |
| --font-size-20 | 14px (alias) |
| --font-size-30 | 16px (emphasized body) |
| --font-size-40 | 18px (small headings) |
| --font-size-50 | 24px (section headings) |
| --font-size-60 | 30px (page headings) |

**Line heights:**

| Token | Value |
|-------|-------|
| --font-line-height-10 | 18px |
| --font-line-height-20 | 24px |
| --font-line-height-30 | 24px |
| --font-line-height-40 | 24px |
| --font-line-height-50 | 32px |
| --font-line-height-60 | 42px |

**Heading shortcuts:**
- H1: 500 32px/40px (Poppins), letter-spacing: -0.5px
- H2: 500 24px/30px (Poppins), letter-spacing: -0.1px
- H3: 300 18px/24px (Poppins), letter-spacing: -0.1px -- note: H3 uses light weight

**Text level composites (Figtree body):**
- text1 (bold/medium/normal): 700/600/400 at 16px/22px
- text2 (bold/medium/normal): 700/600/400 at 14px/20px
- text3 (bold/medium/normal): 700/600/400 at 12px/16px

### Spacing System

Monday.com uses a 12-step spacing scale that starts at 2px and uses non-linear increments:

| Token | Value | Usage Pattern |
|-------|-------|---------------|
| --space-2 | 2px | Micro gaps (icon-to-text inside a badge) |
| --space-4 | 4px | Tight padding (tags, chips, compact lists) |
| --space-8 | 8px | Standard element padding, small gaps |
| --space-12 | 12px | Component internal padding |
| --space-16 | 16px | Card padding, section gaps |
| --space-20 | 20px | Moderate section padding |
| --space-24 | 24px | Large component padding |
| --space-32 | 32px | Section spacing |
| --space-40 | 40px | Page-level spacing |
| --space-48 | 48px | Major section breaks |
| --space-64 | 64px | Hero/splash spacing |
| --space-80 | 80px | Maximum page spacing |

The scale is roughly geometric (each step is approximately 1.25-1.5x the previous), which creates a natural visual rhythm. Our QBO spacing scale (--sp-1 through --sp-10, ranging 4-36px) covers the tight end well but lacks the larger architectural values (40, 48, 64, 80px) that Monday.com provides. We added --sp-11 through --sp-24 in the design-system.css extension, which partially fills this gap.

### Border Radius

Monday.com's radius system is minimal -- only three tokens:

| Token | Value |
|-------|-------|
| --border-radius-small | 4px |
| --border-radius-medium | 8px |
| --border-radius-big | 16px |

This is significantly simpler than our current QBO system (which has 7 radius tokens from xs through pill). The restraint is intentional -- fewer radius choices means more visual consistency.

### Shadow System

Four elevation levels:

| Token | Value |
|-------|-------|
| --box-shadow-xs | 0px 4px 6px -4px rgba(0, 0, 0, 0.1) |
| --box-shadow-small | 0px 4px 8px rgba(0, 0, 0, 0.2) |
| --box-shadow-medium | 0px 6px 20px rgba(0, 0, 0, 0.2) |
| --box-shadow-large | 0px 15px 50px rgba(0, 0, 0, 0.3) |

Dark mode shadows use heavier opacity (0.5) with near-black base, and the hacker theme uses pure black shadows. The shadow system is simpler than ours (we have xs through 2xl plus ambient and ring variants), reflecting Monday.com's preference for flat, color-filled surfaces over elevated/shadowed cards.


---

## Motion and Interaction

### Productive vs. Expressive Motion

Monday.com's motion system splits into two categories, which is the most valuable motion concept to adopt from them:

**Productive motion** (fast, utilitarian, barely noticed):

| Token | Value |
|-------|-------|
| --motion-productive-short | 70ms |
| --motion-productive-medium | 100ms |
| --motion-productive-long | 150ms |

These are for UI feedback: button presses, checkbox toggles, hover states, menu opening. The user should not consciously perceive the animation -- it should just feel "responsive."

**Expressive motion** (slower, deliberate, conveys meaning):

| Token | Value |
|-------|-------|
| --motion-expressive-short | 250ms |
| --motion-expressive-long | 400ms |

These are for state changes that communicate something: a panel sliding open, a status changing, a group expanding/collapsing. The animation helps the user track spatial changes.

### Easing Curves

Four named curves:

| Token | Value | Purpose |
|-------|-------|---------|
| --motion-timing-enter | cubic-bezier(0, 0, 0.35, 1) | Decelerate into rest position |
| --motion-timing-exit | cubic-bezier(0.4, 0, 1, 1) | Accelerate away |
| --motion-timing-transition | cubic-bezier(0.4, 0, 0.2, 1) | Standard Material-style transition |
| --motion-timing-emphasize | cubic-bezier(0, 0, 0.2, 1.4) | Overshoot bounce for attention |

The emphasize curve (with the 1.4 overshoot) is used for attention-drawing moments -- a notification appearing, a status change, a toast. This subtle bounce says "look here."

### Comparison with QBO's Current Motion System

Our current system uses:
- --duration-micro: 100ms
- --duration-fast: 150ms
- --duration-normal: 200ms
- --duration-emphasis: 300ms

Plus easing: --ease-standard, --ease-decelerate, --ease-accelerate, --ease-emphasized.

The Monday.com system is similar in structure but makes the productive/expressive split more explicit. Our "micro" and "fast" map to their "productive" range. Our "normal" and "emphasis" map to their "expressive" range. The main insight is the naming convention -- "productive" vs "expressive" is more semantically meaningful than "fast" vs "normal," and encourages developers to think about WHY they are animating rather than just HOW FAST.

---

## Accessibility

### Built-In Accessibility Patterns

Monday.com's Vibe component library (63+ components) includes:
- Focus management (keyboard navigation through grids, lists, menus)
- ARIA attributes on all interactive components
- Color contrast compliance (the primary blue #0073EA on white provides approximately 4.6:1 contrast, passing AA)
- Reduced motion support (via prefers-reduced-motion)

### Color + Label Redundancy

Monday.com's status system always pairs color with a text label. A "Stuck" status is both red (#DF2F4A) AND has the word "Stuck" visible. This is critical for color-blind users (approximately 8% of men) and is a pattern our dashboard should maintain -- our current status badges do include text labels, which is correct.

### Theme Accessibility

The four themes (light, dark, black, hacker) provide options for different visual needs:
- Light theme: highest contrast for bright environments
- Dark theme: reduced eye strain for extended use
- Black theme: OLED-friendly, maximum contrast for dark environments
- Hacker theme: high-saturation accent colors for visibility on dark backgrounds

### Opacity-Based Disabled States

Monday.com uses a --disabled-component-opacity variable rather than hardcoded opacity values. This allows the disabled state to be tuned per-theme:

\
This is more flexible than our current opacity: 0.45 approach because it allows different opacity levels in light vs dark mode.


---

## Application to QBO App

This is the most important section. Here are specific, concrete changes to the QBO escalation tool inspired by Monday.com's patterns, adapted to work within our "Warm Authority" design language.

### 1. Color-Banded Category Groups on the Dashboard (HIGH PRIORITY)

**The Problem:** The current escalation dashboard is a flat table. When there are 30+ open escalations across 12 categories, the specialist has to visually scan every row to find payroll issues or bank feed problems. The category badge pills help, but they are small and require focused reading.

**The Monday.com Solution:** Group items by category with a colored left-edge stripe.

**Implementation for QBO:**
- Add a "Group by Category" toggle to the dashboard
- When active, escalations are grouped under collapsible headers
- Each group header has a 4px left border in the category's existing color (we already have --cat-payroll-bg, --cat-bank-feeds-bg, etc.)
- The group header shows: category name, count of open items, count of escalated items
- Groups are collapsible (start expanded by default)
- The left-edge stripe persists on every row within the group, providing a visual "rail" for scanning

This stays within our warm palette (the category colors are already warm-shifted) while adopting Monday.com's most effective scanning pattern.

### 2. Wider Inline Status Cells (HIGH PRIORITY)

**The Problem:** Status badges are small pills (3px 10px padding, 11px font). They communicate status, but at dashboard scale they require focused reading rather than peripheral scanning.

**The Monday.com Solution:** Status is a filled cell, not a badge.

**Implementation for QBO:**
- In the dashboard table, replace the small badge pill with a wider status cell (minimum 90px wide)
- The cell background is the status color at our existing muted opacity
- The text label is centered within the cell
- The cell has rounded corners (--radius-md) but is significantly larger than the current badges

This is a subtle change -- wider cells with centered text -- but it dramatically improves scanability at the table level.

### 3. Productive/Expressive Motion Split (MEDIUM PRIORITY)

**The Problem:** Our current motion system uses generic duration names (micro, fast, normal, emphasis) that do not guide developers toward appropriate animation choices.

**The Monday.com Solution:** Split motion into "productive" (barely perceptible, UI feedback) and "expressive" (deliberate, state-change communication).

**Implementation for QBO:**
Add semantic aliases to our existing tokens. Map --motion-productive-short to --duration-micro (100ms), --motion-productive-medium to --duration-fast (150ms), --motion-expressive-short to --duration-normal (200ms), and --motion-expressive-long to --duration-emphasis (300ms).

This is backwards-compatible (existing tokens remain) and provides better guidance for new code.

### 4. Board-Color Workspace Selector (MEDIUM PRIORITY)

**The Problem:** The workspace/investigations views have no personal visual identity. When a specialist has multiple investigation threads open, they all look identical.

**The Monday.com Solution:** Let users assign a color to each workspace/project.

**Implementation for QBO:**
- Add a small color-picker dot to each investigation case or workspace
- Offer 8-10 colors drawn from our existing category palette
- The selected color appears as a subtle left border or top accent on the workspace card
- Color assignment is stored in user preferences (the UserPreferences model already exists)

This is a lightweight feature that adds personal organization without requiring any structural changes.

### 5. Emphasize Easing for Status Changes (LOW PRIORITY)

**The Monday.com Solution:** Use an overshoot bounce curve (cubic-bezier(0, 0, 0.2, 1.4)) for status transitions.

**Implementation for QBO:**
When an escalation status changes (e.g., Open to In Progress), the status badge could use a subtle scale animation with the emphasize curve -- a quick scale from 0.92 to 1.04 back to 1.0 over 300ms. This draws attention to the change without being distracting. Use a toned-down 1.2 overshoot rather than Monday.com's 1.4 to keep it professional.

### 6. Collapsible Group Counts in Sidebar (LOW PRIORITY)

**The Monday.com Solution:** Board groups show item counts even when collapsed.

**Implementation for QBO:**
The sidebar navigation items could show a small count badge for items needing attention:
- Chat: unread message count (already implemented)
- Dashboard: open escalation count
- Investigations: active INV count
- Gmail: unread count (already implemented)

This is partially implemented but could be extended to more navigation items.

### 7. Dashboard Widget Cards with Category Color Accents (LOW PRIORITY)

**The Monday.com Solution:** Dashboard widgets inherit board colors.

**Implementation for QBO:**
The analytics stat cards could gain a subtle 3px top border in a relevant category color:
- "Open Escalations" card: --status-open-dot color top border
- "Resolved Today" card: --status-resolved-dot color top border
- "Avg Resolution Time" card: neutral accent

This adds visual meaning to the analytics overview without changing the card structure.

### 8. Variable Disabled Opacity per Theme (LOW PRIORITY)

**The Monday.com Solution:** Use a CSS custom property for disabled opacity rather than a hardcoded value.

**Implementation for QBO:**
Replace our current opacity: 0.45 on disabled elements with a --disabled-opacity custom property. Set it to 0.45 in light mode and 0.38 in dark mode. This allows per-theme tuning of disabled states for better visibility in different lighting conditions.


---

## What NOT to Copy

### 1. Do NOT Adopt the Full 40-Color Palette

Monday.com's 40+ named colors exist because users need to distinguish 15+ boards from each other. Our app has a fixed set of 12 escalation categories and 4 status states. Importing 40 colors would create visual noise with no functional benefit. Our existing 12 category colors and 4 status colors are sufficient.

### 2. Do NOT Use Pure Saturated Fills for Backgrounds

Monday.com uses fully saturated color fills (#00C875 green, #DF2F4A red) for status cells. In a tool used for 8+ hours of focused reading, this level of saturation would cause eye fatigue. Our implementation should use the color at reduced opacity (via color-mix or alpha) with high-contrast text, preserving the scanning benefit without the visual intensity.

### 3. Do NOT Use the Figtree/Poppins Font Stack

Monday.com's Figtree (body) and Poppins (headings) are geometric sans-serifs optimized for friendly approachability. Our Inter font stack is optimized for long-form readability and professional authority. Switching fonts would undermine the "Warm Authority" identity without meaningful benefit.

### 4. Do NOT Adopt Monday.com's "Bold = 500" Convention

Monday.com defines --font-weight-bold as 500 (medium). This works for their playful-professional identity but would feel weak in our authority-focused context. Our current use of 600-700 for emphasis is correct for the QBO use case.

### 5. Do NOT Copy the Deep Purple Dark Mode Background

Monday.com's dark background (#181B34) is tinted purple-blue, which reinforces their brand but would clash with our warm-neutral dark theme (#141210). Our warm obsidian dark mode is specifically designed for extended reading comfort. A purple-blue tint would introduce a cool tone that fights the warm text colors.

### 6. Do NOT Add a Hacker Theme

While interesting from a design-system-architecture standpoint, a Dracula-inspired theme with hot pink (#FE78C6) primary accents is inappropriate for a professional escalation support tool. Our existing theme system (Obsidian Ember, Apple, Atmospherics) provides sufficient personality while maintaining professional credibility.

### 7. Do NOT Over-Animate Status Changes

Monday.com can afford playful animations because PM tools have idle moments between board interactions. Escalation specialists are in continuous rapid-fire workflow. Animations that take 400ms (Monday.com's --motion-expressive-long) would feel sluggish in our context. Keep all animations under 300ms.

### 8. Do NOT Simplify the Shadow System

Monday.com uses only 4 shadow levels. Our existing multi-layered shadow system (xs through 2xl plus ambient/ring/glow variants) provides richer depth perception and better dark mode adaptation. Monday.com's simpler shadows work because their color-filled surfaces do most of the visual differentiation work. Our warm neutral surfaces need shadows for hierarchy.

### 9. Do NOT Reduce Border Radius Tokens

Monday.com uses only 3 radius tokens (4/8/16px). Our 7-token system (xs through pill) exists because we have a wider variety of component shapes (pill badges, rounded cards, circular avatars, subtle code blocks). Reducing to 3 would force awkward compromises.


---

## Implementation Priority

### Phase 1: Immediate Wins (1-2 days)

1. **Productive/Expressive motion aliases** -- Zero-risk CSS addition. Add semantic token aliases alongside existing duration tokens. No visual change, better developer guidance for future code.

2. **Wider status cells on dashboard** -- Replace badge pills with 90px+ inline status cells on the escalation table. Keep our existing status colors but make them more prominent. Purely CSS change to the dashboard view.

### Phase 2: Structural Improvements (3-5 days)

3. **Category-grouped dashboard** -- Add "Group by" toggle. Implement collapsible category groups with colored left stripes using existing --cat-* tokens. This is the highest-impact Monday.com pattern adapted for QBO and would fundamentally improve how specialists scan the dashboard.

4. **Stat card color accents** -- Add 3px top-border color accents to analytics stat cards based on their semantic meaning (status colors for status counts, accent for neutral metrics).

### Phase 3: Personalization (3-5 days)

5. **Investigation color assignment** -- Add a color picker for investigation cases. Store in UserPreferences model. Show as left-border accent on investigation cards in the InvestigationsView.

6. **Sidebar count badges** -- Extend the existing unread-count pattern to show live counts on more sidebar items (dashboard open count, investigations active count).

### Phase 4: Polish (2-3 days)

7. **Status change emphasis animation** -- Subtle scale bounce when status updates in real-time. Use a restrained version of Monday.com's emphasize curve (1.2 overshoot, not their 1.4).

8. **Collapsed group count summary** -- Show item counts on collapsed group headers for at-a-glance progress without expanding.

9. **Variable disabled opacity** -- CSS custom property for disabled opacity, tunable per-theme for better dark mode visibility.

---

## Appendix A: Side-by-Side Token Comparison

| Concept | Monday.com Vibe | QBO Current |
|---------|----------------|-------------|
| Primary accent | #0073EA (corporate blue) | #C76A22 (ember amber) |
| Body font | Figtree, 14px | Inter, 14.5px |
| Heading font | Poppins | Inter (same as body) |
| Bold weight | 500 | 600-700 |
| Body text color | #323338 (cool gray) | #2A2420 (warm charcoal) |
| Secondary text | #676879 (cool gray) | #6E5F52 (warm stone) |
| Background | #FFFFFF (pure white) | #F5F2ED (warm cream) |
| Dark background | #181B34 (navy purple) | #141210 (warm obsidian) |
| Border color | #C3C6D4 (cool gray) | #D4CBC0 (warm stone) |
| Shadow levels | 4 (simple single-layer) | 6+ (multi-layered) |
| Border radius tokens | 3 (4/8/16px) | 7 (3-9999px) |
| Spacing scale | 12 steps (2-80px) | 10 steps (4-36px) |
| Named colors | 40+ with hover/selected | 12 categories + 4 statuses |
| Themes | 4 (light/dark/black/hacker) | 3+ (Obsidian Ember/Apple/Atmospherics) |
| Motion split | Productive/Expressive | Micro/Fast/Normal/Emphasis |
| Status approach | Full-cell color fill | Small pill badges |
| Grouping | Color-striped collapsible groups | Flat table/list |
| Neutral temperature | Cool (gray-blue) | Warm (sand/stone) |

## Appendix B: Monday.com Vibe Component Inventory

The full Vibe component library contains 63+ components. Components most relevant to QBO patterns:

**Data Display:** Table, Badge, Counter, FormattedNumber, Label, ProgressBars, Skeleton
**Navigation:** Tabs, BreadcrumbsBar, Menu, Steps, MultiStepIndicator
**Input:** TextField, TextArea, NumberField, Search, DatePicker, Checkbox, RadioButton, Switch, Toggle, Slider, ColorPicker, Combobox, Dropdown
**Feedback:** Toast, AlertBanner, AttentionBox, Tipseen, Modal, EmptyState
**Layout:** Accordion, Divider, ExpandCollapse, List, ListItem, VirtualizedList, VirtualizedGrid
**Identity:** Avatar, AvatarGroup, Chips
**Utility:** ThemeProvider, SlideTransition, TransitionView, HiddenText, GridKeyboardNavigationContext

The components we could most directly learn from: Table (for grouped row rendering), ColorPicker (for workspace color assignment), Tabs (for their active-indicator animation), and Toast (for status-change notifications).

## Appendix C: Key Source URLs

- Vibe design system repository: https://github.com/mondaycom/vibe
- Vibe documentation: https://vibe.monday.com/
- Light theme tokens: packages/style/src/themes/light-theme.scss
- Dark theme tokens: packages/style/src/themes/dark-theme.scss
- Hacker theme tokens: packages/style/src/themes/hacker-theme.scss
- Spacing tokens: packages/style/src/spacing.scss
- Typography tokens: packages/style/src/typography.scss
- Motion tokens: packages/style/src/motion.scss
- Border radius tokens: packages/style/src/border-radius.scss
- Border tokens: packages/style/src/borders.scss
- Design system reference (local): docs/design/design-system.md (Section 2.12)
