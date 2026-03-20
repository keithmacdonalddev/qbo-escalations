# Vercel / Geist Design System -- Design Research Report

*Prepared 2026-03-19. Research agent: Claude Opus 4.6.*
*Sources: vercel.com/geist, github.com/vercel/geist-font, vercel.com/design, existing QBO codebase analysis.*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vercel's Design Philosophy](#2-vercels-design-philosophy)
3. [Key Design Patterns](#3-key-design-patterns)
4. [Color System](#4-color-system)
5. [Typography and Spacing](#5-typography-and-spacing)
6. [Motion and Interaction](#6-motion-and-interaction)
7. [Materials and Elevation](#7-materials-and-elevation)
8. [Accessibility](#8-accessibility)
9. [Application to the QBO Escalation Tool](#9-application-to-the-qbo-escalation-tool)
10. [What NOT to Copy](#10-what-not-to-copy)
11. [Implementation Priority](#11-implementation-priority)

---

## 1. Executive Summary

Vercel's Geist design system is the most aggressively minimal design system in production at scale. Where other systems add, Geist subtracts. Its core bet is that **in a tool where status clarity is the job, visual restraint is a feature**. Everything that does not directly communicate state, hierarchy, or action is removed.

The QBO escalation tool should not adopt Geist wholesale -- its warm, human identity ("Warm Authority") is more appropriate for a support specialist working 8-hour shifts than Vercel's cold developer aesthetic. But there are specific Geist ideas that would materially improve the app:

- **Status-first design**: Vercel's deployment status system (QUEUED, BUILDING, READY, ERROR, CANCELED) with dedicated StatusDot components is directly applicable to escalation states (Open, In Progress, Resolved, Escalated).
- **Materials system**: Geist's four-tier elevation model (Base, Small, Medium, Large for surfaces; Tooltip, Menu, Modal, Fullscreen for floating) would replace the current ad-hoc shadow layering.
- **Typography discipline**: Geist separates type into four strict categories (Heading, Label, Copy, Button) with size-specific classes. This would resolve the inconsistent font-size application across QBO's 25+ components.
- **Binary loading states**: Vercel's loading model is binary -- you are either seeing a Skeleton (content is loading) or a Spinner (your action is processing). The QBO app currently mixes shimmer skeletons, spinners, thinking dots, and streaming cursors without clear semantic rules.
- **Semantic badge system**: Geist's badge component with 8 color variants (gray, blue, purple, amber, red, pink, green, teal) plus subtle/strong modes maps directly to the QBO category badge system, which currently uses 14 hand-tuned color pairs.

The largest single improvement the QBO app could borrow from Vercel is the principle of **information density through restraint** -- making data-heavy views (Dashboard, Investigations, Gmail Inbox) more scannable by removing decorative elements rather than adding visual aids.

---

## 2. Vercel's Design Philosophy

### 2.1 Radical Simplicity

Vercel's design philosophy can be summarized as: **if you can remove it, you should**. The Vercel dashboard is one of the most visually sparse production UIs in existence. There are no gradients on surfaces, no decorative borders, no ambient glows. Surfaces are flat. Text is the interface.

This is not laziness -- it is a deliberate bet that in a deployment tool, the only things that matter are:
1. **Is my deployment working?** (status)
2. **What went wrong?** (logs)
3. **What do I do next?** (action)

Everything else is noise. The Geist design system encodes this philosophy at the token level: there is no `--shadow-glow`, no `--accent-muted`, no gradient on any button. The system does not provide tools for decoration because it does not believe decoration belongs in a professional tool.

**Contrast with QBO's "Warm Authority" identity**: The QBO app uses warm neutrals, multi-layered shadows, gradient backgrounds on buttons, and inset highlights to create a "3D tactile" feel. This is not wrong -- it serves a different purpose (reducing eye fatigue during long shifts, creating a sense of craft). But it does add visual weight that competes with content.

### 2.2 Binary Contrast

Vercel uses pure black (#000000) and pure white (#FFFFFF) as its base colors. This is unusual -- most design systems avoid pure black/white because of halation on OLED screens and perceived harshness. Vercel accepts this tradeoff because binary contrast creates the fastest possible visual parsing:

- **Light mode**: White background, black text. No warmth, no cool tint, no undertone. Paper-white.
- **Dark mode**: Black background (#000000), with #111111 for elevated surfaces. A 7% lightness step is the only differentiation between background and card.

The binary system means there is no ambiguity about what is foreground and what is background. Every pixel is either content or empty space. This is the opposite of the QBO app's warm stone palette where surfaces blend into each other through subtle gradients.

### 2.3 Status-First Design

The most transferable idea from Vercel is **status-first design**: the principle that the primary job of a professional tool's interface is to communicate the current state of things, and every other visual element exists only in service of that.

On the Vercel dashboard, when you look at a project, the single most prominent element is the deployment status. The StatusDot component has five states (QUEUED, BUILDING, ERROR, READY, CANCELED), each with a unique color and animation behavior. The building state animates. The error state uses high-visibility red (#EE0000 -- not a softened red, not a warm red, pure signal red). Ready is blue (Vercel uses blue for success rather than green, which is an unusual but deliberate choice).

This status-first approach means the interface answers the user's primary question -- "is everything okay?" -- before they even focus their eyes on any specific element.

### 2.4 Color as Semantic Signal Only

Vercel uses exactly one accent color: #0070F3 (a medium blue). This blue is used for:
- Links
- Primary CTAs
- Success states (deployment ready)
- Informational badges

Beyond this single blue, color appears only for semantic states:
- #EE0000 for errors
- #F5A623 for warnings
- #50E3C2 for secondary positive indicators

There are no decorative colors. No category tints. No provider identity colors. No gradient accents. The absence of decorative color means that when red appears, it is impossible to miss -- there is nothing else competing for chromatic attention.

---

## 3. Key Design Patterns

### 3.1 Deployment Status Cards

Vercel's project cards are the primary navigational element on the dashboard. Each card shows:
- Project name (medium weight, not bold)
- Git branch and commit info (small, monospace)
- Deployment status (StatusDot with label)
- Timestamp (relative)

The card itself is a white rectangle with a 1px #EAEAEA border. No shadow, no gradient, no hover glow. On hover, the border darkens slightly. On click, you navigate. The information density is high because there is zero decorative overhead.

**QBO applicability**: The escalation cards in `EscalationDashboard.jsx` currently use the `.esc-card` class with hover gradients, inset shadows, and multi-layered box-shadows. Simplifying to a flat card with a 1px border and status-color accent would make the dashboard more scannable when the user has 20+ open escalations.

### 3.2 Real-Time Logs

Vercel's deployment log view is a monospace terminal-style display with:
- Timestamps in a fixed-width column
- Log levels color-coded (errors in red, warnings in amber)
- Auto-scroll to bottom with a "scroll to bottom" pill that appears on scroll-up
- Collapsible log groups for build steps

The log view does not use cards or panels -- it is raw text with minimal chrome. The monospace font (Geist Mono) and tabular number alignment make timestamps scannable.

**QBO applicability**: The chat streaming view in `Chat.jsx` could benefit from Vercel's log-view patterns for the AI's reasoning output. Currently, streaming text uses the same visual treatment as completed messages. A log-style view for the "thinking" phase would clearly separate process from output.

### 3.3 Project Navigation (Sidebar)

Vercel's sidebar is notable for what it does not do:
- No animated indicators on the active item
- No hover glow or backdrop blur
- No collapsible sections with animated chevrons
- No conversation history list

It is a flat list of text links with a subtle background-color change on the active item. The sidebar background is the same as the page background in light mode (#FFFFFF) and one step up in dark mode (#111111).

The QBO sidebar, by contrast, is a rich interactive element with backdrop blur, multi-layered shadows, animated nav indicators, hover-expand behavior, collapsible sections, and a conversation history list. The QBO sidebar is more feature-rich (which is appropriate for a multi-view app), but the Geist approach suggests that the visual treatment could be stripped back significantly without losing functionality.

### 3.4 Badge and Status Components

Geist provides two key status primitives:

**StatusDot**: Five states (QUEUED, BUILDING, ERROR, READY, CANCELED). The building state has a pulsing animation. The component can render with or without a text label. This is the single most important UI component in Vercel's product.

**Badge**: Eight color variants (gray, blue, purple, amber, red, pink, green, teal), each with standard and "subtle" modes. Badges are used for categorization, not status. The semantic separation -- StatusDot for state, Badge for category -- prevents confusion.

**QBO applicability**: The QBO app currently uses `.badge` for status (open, progress, resolved, escalated) and `.cat-badge` for categories (payroll, bank-feeds, etc.). This is the right separation. But the visual treatment could adopt Geist's subtle/standard toggle -- subtle badges for secondary views, standard badges for primary views.

### 3.5 Loading State Hierarchy

Geist defines three loading primitives with distinct semantics:

1. **Skeleton**: Content is being fetched. Shows a placeholder that matches the eventual content's layout. Supports pill, rounded, and squared shapes. Has a shimmer animation. Used for initial page load.
2. **Spinner**: A user-initiated action is processing. Sizes 12px, 32px, 40px. Used inside buttons, pagination, form submissions.
3. **Loading Dots**: Background activity is happening. Used when the user has not directly triggered the action.

The QBO app currently has `.skeleton` (shimmer), `.spinner` (ring), `.thinking-dots` (three-dot pulse), and `.streaming-cursor` (blinking pipe). The semantics are not documented, and components sometimes use the wrong one. Adopting Geist's three-tier model would clarify which loading indicator to use where.

### 3.6 Table Design

Geist tables use a compound component pattern with semantic HTML. Key visual decisions:
- No hover background by default (content, not action)
- Striped mode available via prop for dense data
- Header row uses no background color -- just font-weight difference
- Cell padding is generous (the table is the content, not a decoration)

The QBO `.table` component already uses sticky headers with uppercase letter-spaced labels, which is more visually assertive than Geist's approach but appropriate for the escalation domain where scanning speed matters more than content immersion.

---

## 4. Color System

### 4.1 Core Palette

Geist uses a 10-step scale for each color hue, following this usage pattern:

| Scale Position | Usage |
|---|---|
| 1-3 | Component backgrounds (default, hover, active) |
| 4-6 | Border treatments (default, hover, active) |
| 7-8 | High-contrast backgrounds (solid fills) |
| 9-10 | Text and icon colors (secondary and primary) |

CSS variables follow the pattern `--ds-[color]-[number]`, ranging from `--ds-gray-100` through `--ds-gray-1000`.

The available color scales are:
- **Gray**: Primary neutral
- **Gray Alpha**: Semi-transparent gray variants for overlay work
- **Blue**: Links, CTAs, info, success (Vercel's only accent)
- **Red**: Errors, destructive actions
- **Amber**: Warnings
- **Green**: Secondary positive indicators
- **Teal**: Supplementary
- **Purple**: Supplementary
- **Pink**: Supplementary

Background tokens use `--ds-background-100` and `--ds-background-200` -- only two levels. This extreme simplicity forces every surface to either be the base canvas or one step above it.

### 4.2 Light/Dark Mode Strategy

Vercel uses class-based theming (`.light-theme` / `.dark-theme`) rather than `prefers-color-scheme` media queries, with system preference detection as the default. Theme persistence uses localStorage.

The dark mode approach is notable for its extremity:
- Background: Pure black #000000
- Elevated surface: #111111 (only 7% lightness)
- Card surface: #111111 (same as elevated)
- Borders: #333333

This creates an extremely high-contrast dark mode where content "floats" on a void. Most design systems use a softer dark (GitHub uses #0D1117, Discord uses #1E1F22, the QBO app uses #141210). Vercel's approach is polarizing but creates undeniable visual clarity.

### 4.3 How This Compares to QBO's Current System

The QBO app uses a warm token system with named semantic tokens:

| QBO Token | QBO Light Value | Geist Equivalent | Geist Value |
|---|---|---|---|
| `--bg` | #f5f2ed (warm cream) | `--ds-background-100` | #FFFFFF (pure white) |
| `--bg-raised` | #fcfaf7 | `--ds-background-200` | #FAFAFA |
| `--ink` | #2a2420 (warm charcoal) | Text primary | #000000 (pure black) |
| `--ink-secondary` | #6e5f52 | Text secondary | #666666 |
| `--accent` | #c76a22 (ember amber) | Accent | #0070F3 (blue) |
| `--danger` | #b33025 | Red error | #EE0000 |

The contrast is stark. QBO uses warm undertones on every surface; Geist uses no undertone at all. QBO has four surface levels (bg, bg-raised, bg-sunken, bg-sidebar); Geist has two (background-100, background-200). QBO has three text levels with warm gray tones; Geist has three text levels with pure gray tones.

**Recommendation**: Do not adopt Geist's true-neutral palette. The warm undertones in the QBO system reduce eye fatigue during 8-hour shifts and are a genuine ergonomic advantage. But do consider reducing the number of surface levels from four to three (eliminating `--bg-sunken` which creates muddiness in some components) and sharpening the contrast between surface levels.

---

## 5. Typography and Spacing

### 5.1 The Geist Font Family

Geist is Vercel's proprietary typeface, designed in collaboration with Basement Studio and Andres Briganti. The family has three members:

- **Geist Sans**: A geometric sans-serif inspired by Swiss typography principles (Univers, Suisse International, ABC Diatype). Designed for legibility at small sizes on screens. Variable weight from 100 to 900.
- **Geist Mono**: A monospace companion designed for code, terminals, and data. Draws from SF Mono, JetBrains Mono. Used for timestamps, IDs, and technical content.
- **Geist Pixel**: A display-oriented pixelated variant with five stylistic alternates. Marketing use only.

The font is open-source (SIL Open Font License) and available via npm (`npm i geist`) or direct download. It is used by 58,200+ projects on GitHub.

**QBO applicability**: The QBO app currently uses Inter as its sans-serif and JetBrains Mono for monospace. Inter and Geist Sans are in the same design lineage (both draw from Swiss grotesks, both optimized for screen legibility). Switching to Geist Sans would be a lateral move -- neither better nor worse for the QBO use case. The recommendation is to stay with Inter unless a broader visual refresh is planned.

### 5.2 Typography Scale

Geist's typography system is the most disciplined part of the design system. Text styles are organized into four strict categories, each with multiple sizes:

**Heading** (page/section titles):
- Heading 72, 64, 56, 48, 40 -- marketing only, never used in app UI
- Heading 32, 24, 20, 16, 14 -- application headings
- "Subtle" modifier available for subheadings (lighter weight)

**Label** (single-line text, ample line-height for accompanying icons):
- Label 20, 18, 16, 14, 13, 12
- "Strong" modifier for emphasis
- Mono variants at 14, 13, 12 for data/code inline
- "Tabular" modifier for numeric alignment
- "CAPS" modifier for overline-style text (Label 12 only)

**Copy** (multi-line text with higher line-height):
- Copy 24, 20, 18, 16, 14, 13
- "Strong" modifier for inline emphasis
- Mono variants for inline code

**Button** (button text only):
- Button 16, 14, 12

The strict separation means you never use a "heading" class for a label, and you never use a "copy" class for a single-line element. This prevents the common problem in the QBO app where `--text-sm` (13px) is used for both sidebar labels and paragraph text, despite those use cases having different line-height requirements.

### 5.3 Spacing

Geist does not publicly document a spacing scale in the same way as Tailwind or Material Design. The system uses Tailwind CSS utility classes internally, implying the standard Tailwind spacing scale (4px base, multiples up to 96px+). The grid system uses responsive breakpoints at xs, sm, smd, md, and lg.

The QBO app's current spacing scale (`--sp-1` through `--sp-10`, plus the design-system.css additions through `--sp-24`) is more explicit and well-documented than Geist's. No changes recommended here.

### 5.4 Specific Typography Recommendations for QBO

The QBO app would benefit from adopting Geist's category-based typography approach without adopting the actual font or sizes:

| Geist Category | QBO Application | Current QBO Approach |
|---|---|---|
| Heading | Page titles, section headers, modal titles | Uses `--text-xl`, `--text-lg` inconsistently |
| Label | Sidebar nav items, form labels, metadata, badge text, timestamps | Uses `--text-sm`, `--text-xs` without distinguishing single vs. multi-line |
| Copy | Chat messages, escalation descriptions, playbook content | Uses `--text-base` with 1.55 line-height everywhere |
| Button | Button text | Already uses `--text-sm` with font-weight 600 |

The specific improvement would be creating `.type-label` and `.type-copy` utility classes with different line-heights (1.3 for labels, 1.6 for copy) at the same font size, then auditing all components to use the correct category.

---

## 6. Motion and Interaction

### 6.1 Vercel's Motion Philosophy

Vercel's motion design is defined by what it does not do. There are no:
- Page transition animations
- Card hover lift effects
- Entrance animations on content
- Parallax or scroll-triggered effects
- Spring physics on UI elements
- Breathing/pulsing animations on idle elements

Motion in Geist exists only for:
1. **State transitions**: Active/inactive, open/closed, loading/loaded
2. **Feedback**: Button press, toggle switch, checkbox check
3. **Attention**: StatusDot pulsing during BUILDING state (the only animated element in the default dashboard view)

The duration of transitions is fast -- the system favors 100-200ms durations with standard easing. There is no "dramatic" motion tier.

### 6.2 Contrast with QBO's Motion System

The QBO app has a rich motion vocabulary:

- **Framer Motion** for page transitions, modal entrances, sidebar overlays
- **Spring physics** on the settings gear icon rotation
- **Breathing animations** on the dev agent dot and streaming indicators
- **Ripple effects** on header button streaming state
- **Hover lift** on cards (translateY(-2px)) and stat cards (translateY(-3px))
- **Scale feedback** on button press (scale(0.97))
- **Ghost-text** composition suggestions
- **Shimmer** on skeleton loading states

Most of these are well-implemented and serve a purpose. But there are opportunities to apply Geist's restraint:

**Remove**: Breathing animation on idle status dots. If the agent is idle, the dot should be static. Animation should only appear when something is actively happening (streaming, building).

**Simplify**: Card hover lift. The translateY(-2px) + shadow-lg + shadow-glow combination on `.card-clickable:hover` is three simultaneous effects. Geist would use a single border-color change. The QBO app could reduce this to translateY(-1px) + shadow-md -- still tactile, but less visually expensive.

**Keep**: The streaming cursor blink, the spinner rotation, the toast entrance animation. These are all functional motion that directly communicates state.

### 6.3 The "One Animated Thing" Rule

The most powerful motion principle from Geist is implicit: **at any given moment, only one thing on screen should be animating**. If the StatusDot is pulsing for a building deployment, nothing else moves. This creates an information hierarchy through motion -- the animated element is guaranteed to be the most important element.

The QBO app currently violates this when streaming: the dev-agent dot pulses, the streaming cursor blinks, the chat mini-widget shows a progress bar, and the FlameBar may be updating render times -- all simultaneously. Applying the "one animated thing" rule would mean the streaming cursor is the only animation during streaming, and everything else becomes static indicators.

---

## 7. Materials and Elevation

### 7.1 Geist's Materials System

Geist defines a two-tier materials system that is the most formally structured part of the design system outside of color:

**Surface Materials (on the page):**

| Level | Name | Radius | Description |
|---|---|---|---|
| 1 | Material Base | 6px | Everyday use. Default surface. |
| 2 | Material Small | 6px | Slightly raised. Cards, list items. |
| 3 | Material Medium | 12px | Further raised. Panels, sections. |
| 4 | Material Large | 12px | Further raised. Hero cards, feature blocks. |

**Floating Materials (above the page):**

| Level | Name | Radius | Description |
|---|---|---|---|
| 1 | Material Tooltip | 6px | Lightest shadow. Only floating element with a triangular stem. |
| 2 | Material Menu | 12px | Lift from page. Dropdowns, context menus. |
| 3 | Material Modal | 12px | Further lift. Dialogs, confirmation modals. |
| 4 | Material Fullscreen | 16px | Biggest lift. Full-screen overlays, lightboxes. |

The key insight is that **radius scales with elevation**. Base elements use 6px. Elevated elements use 12px. Full-screen elements use 16px. This creates a subconscious cue: rounder = higher = more important/temporary.

### 7.2 QBO's Current Elevation System

The QBO app uses four shadow tiers (`--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`) plus ambient variants, ring shadows, and inset highlights. Radius values range from 4px to 16px but are not systematically tied to elevation. For example:
- Sidebar nav items: `--radius-md` (8px) -- surface level
- Modal: `--radius-xl` (16px) -- floating level
- Compose card: `--radius-xl` (16px) -- surface level (but uses floating-level radius)
- Badge: `--radius-pill` (999px) -- inline level

The compose card using the same radius as modals is a Geist-style violation -- it makes a surface-level element look like a floating element.

**Recommendation**: Adopt Geist's radius-follows-elevation rule. Map QBO's existing radius tokens:
- Surface elements (cards, list items, badges): `--radius-sm` (4px) or `--radius-md` (8px)
- Panel elements (sidebar sections, filter bars): `--radius-md` (8px)
- Floating elements (modals, dropdowns, toasts): `--radius-lg` (12px)
- Full-screen overlays (lightbox, settings panel): `--radius-xl` (16px)

---

## 8. Accessibility

### 8.1 Geist Accessibility Approach

Geist documentation does not have a dedicated accessibility page, but accessibility is embedded throughout:

- **High contrast color system**: The 10-step scale ensures that text at positions 9-10 meets WCAG AA against backgrounds at positions 1-3.
- **Focus-visible states**: Blue border (border-blue-700) for keyboard focus, no outline on mouse click.
- **System preference detection**: Theme respects system dark/light preference, with manual override stored in localStorage.
- **StatusDot labels**: The label prop on StatusDot ensures that status is communicated through text, not just color.

### 8.2 QBO Existing Accessibility

The QBO app has strong accessibility foundations:
- `prefers-reduced-motion` respected globally
- `prefers-contrast: more` and `prefers-contrast: less` handled
- `.sr-only` utility present
- `.touch-target` utility with 44px minimum
- `focus-visible` with accent-colored ring
- `:focus:not(:focus-visible)` to suppress outline on click
- Selection styling customized
- Print media query

The QBO app accessibility layer is more comprehensive than Geist. No changes needed for accessibility compliance. The one Geist pattern worth adopting is the StatusDot required `label` prop -- ensuring that every status indicator in the QBO app has a text equivalent, not just a colored dot.
---

## 9. Application to the QBO Escalation Tool

This is the most important section. Below are the specific, actionable changes the QBO app should adopt from Geist, organized from highest to lowest impact.

### 9.1 Formalize the Status System (HIGH IMPACT)

**Current state**: Status badges (`.badge-open`, `.badge-progress`, `.badge-resolved`, `.badge-escalated`) use background tint + text color + bottom border shadow. Status dots appear in some contexts but not others.

**Vercel lesson**: Create a dedicated `<StatusIndicator>` component with:
- Five states: Open, In Progress, Resolved, Escalated, Waiting
- Dot-only mode (for compact list views)
- Dot + label mode (for detail views)
- Animation only on "In Progress" state (pulsing dot)
- Required `label` prop for accessibility

This would unify the status representation across the Dashboard, Escalation Detail, Sidebar conversation list, and Investigations view.

### 9.2 Reduce Dashboard Card Visual Weight (HIGH IMPACT)

**Current state**: `.esc-card` has a hover gradient background, inset shadow on hover, and is visually dense with category badges, status badges, timestamps, and description text all at similar visual weight.

**Vercel lesson**: Make escalation cards flatter:
- Remove the hover gradient (use a solid `var(--bg-sunken)` on hover)
- Remove inset shadows on hover
- Make the status badge the visually dominant element (larger, positioned first)
- Use a single 1px bottom border as the card separator
- Move category badge to secondary position (smaller, right-aligned)

The goal is that a user scanning 20 escalation cards can read status-category-title in that order without any other visual element competing.

### 9.3 Implement a Materials System (MEDIUM IMPACT)

**Current state**: Shadow and radius values are applied per-component without a formal elevation hierarchy.

**Vercel lesson**: Define four material levels in `design-system-v2.css`. Map surface materials (base, card, panel, hero) and floating materials (tooltip, menu, modal, overlay) to specific radius and shadow combinations. Then audit all components to use the correct material level instead of ad-hoc shadow/radius combinations.

### 9.4 Clarify Loading State Semantics (MEDIUM IMPACT)

**Current state**: Four loading indicators (skeleton, spinner, thinking-dots, streaming-cursor) used without documented rules.

**Vercel lesson**: Document and enforce three tiers:

| State | QBO Component | When to Use |
|---|---|---|
| **Skeleton** | `.skeleton` shimmer | Initial page/section load. Data is being fetched. User has not triggered it. |
| **Spinner** | `.spinner` ring | User clicked something and is waiting for a response. |
| **Streaming indicator** | `.streaming-cursor` | AI is actively generating text. Only used in chat and copilot contexts. |

Remove `.thinking-dots` as a separate concept -- merge it into the streaming indicator. When the AI is "thinking" (not yet producing visible text), show a static "Thinking..." label with no animation, then transition to the streaming cursor when text begins.

### 9.5 Adopt Subtle/Strong Badge Modes (MEDIUM IMPACT)

**Current state**: Category badges each have a hand-tuned background/text color pair. There are 14 category colors requiring 56 color tokens total (bg + text, light + dark).

**Vercel lesson**: Define a generic badge system with:
- 8 base colors (matching Geist: gray, blue, purple, amber, red, pink, green, teal)
- Two modes: `subtle` (light background, colored text) and `strong` (solid background, white text)
- Map QBO categories to the nearest base color

This would reduce the 56 category color tokens to 16 (8 colors x 2 modes).

### 9.6 Typography Category System (MEDIUM IMPACT)

**Current state**: Typography uses a size-based scale (`--text-xs` through `--text-2xl`) applied directly to components. The same `--text-sm` is used for sidebar labels and secondary paragraph text despite different line-height requirements.

**Vercel lesson**: Create four typography categories with distinct line-height:

| Category | Use Case | Line Height | Letter Spacing |
|---|---|---|---|
| `.type-heading` | Page titles, section headers | 1.2 - 1.3 | -0.02em |
| `.type-label` | Nav items, form labels, metadata, badges | 1.3 - 1.4 | 0em |
| `.type-copy` | Chat messages, descriptions, playbook content | 1.55 - 1.6 | -0.006em |
| `.type-button` | Button text | 1.0 | 0em |

The existing `.text-heading`, `.text-label`, `.text-body` classes in `design-system.css` already approximate this, but they are not consistently used across components.

### 9.7 Simplify the Chat Compose Card (LOW-MEDIUM IMPACT)

The `.compose-card` could shed its gradient background and reduce from four shadow layers to two. The focused state accent glow is effective and should stay.

### 9.8 Reduce Sidebar Visual Complexity (LOW IMPACT)

Remove backdrop blur (performance cost), reduce shadow layers from four to one, remove the gradient background (use a solid `var(--bg-sidebar)`), keep the animated nav indicator.

### 9.9 Apply One Animated Thing Rule (LOW IMPACT)

When the AI is streaming, the streaming cursor should be the only animation. Dev-agent dot: solid color (not pulsing). Chat mini-widget: static "Streaming..." label. FlameBar: continues updating numbers but without shimmer.
---

## 10. What NOT to Copy

### 10.1 Do Not Adopt Pure Black/White

Vercel uses #000000/#FFFFFF as its base. For an 8-hour daily-use tool, warm neutrals measurably reduce eye fatigue. The QBO #141210 dark background and #f5f2ed light background are better choices. Do not flatten these to pure black/white.

### 10.2 Do Not Remove All Shadows

Geist near-shadowless surfaces work because Vercel content is primarily text (deployment logs, configuration). The QBO app displays chat messages, email threads, calendar events, image galleries, and data tables -- visual contexts where shadow-based depth helps users understand spatial relationships. Keep the shadow system but consolidate to fewer tiers.

### 10.3 Do Not Reduce to One Accent Color

Vercel uses a single blue (#0070F3) because it has a single product context (deployment). The QBO app serves multiple contexts (escalation triage, AI chat, Gmail, Calendar, Investigations, Analytics) and uses accent color variation to help users orient. The provider identity colors (ember, purple, amber, emerald) are functional, not decorative -- they tell the user which AI model is speaking. Keep them.

### 10.4 Do Not Adopt Geist Font

Inter is as good as Geist Sans for the QBO use case. Both are Swiss-inspired grotesks optimized for screen legibility. Switching fonts creates churn without benefit.

### 10.5 Do Not Remove Warm Authority Identity

The Warm Authority design identity (warm neutrals, ember accent, tactile shadows) is a genuine differentiator. It makes the QBO app feel humane and intentional in a domain (customer support tooling) that is typically cold and utilitarian. Vercel coldness works for developers; the QBO warmth works for support specialists. Do not sacrifice warmth for austerity.

### 10.6 Do Not Copy Vercel Dark Mode Approach

Vercel pure-black (#000000) dark mode is controversial even among Vercel users. The QBO dark mode (#141210 with warm undertones) is more comfortable for extended use. The 7% lightness step between background and surface (#000000 to #111111) is too subtle for a tool where users need to distinguish between 3-4 surface levels.
---

## 11. Implementation Priority

Ordered by impact-to-effort ratio. Items at the top deliver the most visible improvement for the least CSS/component work.

### Tier 1: Quick Wins (1-2 hours each)

1. **Formalize loading state semantics** -- Document the three-tier model (Skeleton/Spinner/Streaming) in CSS comments. No code change needed initially.

2. **Reduce card hover effects** -- Change `.card-clickable:hover` and `.esc-card:hover` to use a single background change (no gradient, no inset shadow, no translateY). One CSS change.

3. **Apply radius-follows-elevation rule** -- Audit and correct any surface-level element using `--radius-xl` or `--radius-lg` (currently the compose card uses `--radius-xl` which should be reserved for floating elements).

### Tier 2: Moderate Effort (2-4 hours each)

4. **Create the materials system** -- Add 8 material classes (4 surface + 4 floating) to `design-system-v2.css`. Begin migrating components to use material classes.

5. **Create a StatusIndicator component** -- React component with dot/label modes, five states, animation only on In Progress. Replace inline status rendering across Dashboard, Detail, and Investigations views.

6. **Simplify the badge color system** -- Define 8 base badge colors with subtle/strong variants. Map existing 14 category colors to the nearest base. Reduce token count from 56 to 16.

### Tier 3: Larger Projects (4-8 hours each)

7. **Typography category audit** -- Create `.type-heading`, `.type-label`, `.type-copy`, `.type-button` classes with correct line-heights. Audit all 25+ components to use the right category.

8. **Sidebar visual simplification** -- Remove backdrop blur, reduce shadow layers, convert gradient to solid background. Test across all theme variants (Obsidian Ember, Apple, atmospheric themes).

9. **Compose card simplification** -- Reduce shadow layers from four to two, remove gradient background, keep focused-state accent glow.

### Tier 4: Optional Refinements (when doing a broader redesign)

10. **Evaluate Geist Sans** -- If a visual refresh is planned, test Geist Sans as a replacement for Inter. Load both fonts side-by-side and compare legibility at the QBO `--text-base` (14.5px).

11. **Single-animation-at-a-time enforcement** -- Requires changes in React component logic (not just CSS) to suppress secondary animations during streaming.
---

## Appendix A: Key Geist URLs

| Resource | URL |
|---|---|
| Geist Design System (home) | https://vercel.com/geist/introduction |
| Geist Colors | https://vercel.com/geist/colors |
| Geist Typography | https://vercel.com/geist/typography |
| Geist Components | https://vercel.com/geist/components |
| Geist Icons | https://vercel.com/geist/icons |
| Geist Materials | https://vercel.com/geist/materials |
| Geist Badge | https://vercel.com/geist/badge |
| Geist StatusDot | https://vercel.com/geist/status-dot |
| Geist Table | https://vercel.com/geist/table |
| Geist Toast | https://vercel.com/geist/toast |
| Geist Skeleton | https://vercel.com/geist/skeleton |
| Geist Spinner | https://vercel.com/geist/spinner |
| Geist Font (GitHub) | https://github.com/vercel/geist-font |
| Geist Font (npm) | https://www.npmjs.com/package/geist |
| Vercel Design | https://vercel.com/design |

## Appendix B: QBO Files Referenced

| File | Relevance |
|---|---|
| `client/src/App.css` | Core design tokens, component styles, dark mode, all shadows/radii |
| `client/src/App.jsx` | Application shell, sidebar, header, routing, dock system |
| `client/src/design-system.css` | Typography scale, motion tokens, elevation additions, accessibility |
| `client/src/design-system-v2.css` | M3 motion, Tailwind shadows, scrollbar styling, interaction patterns |
| `docs/design/design-system.md` | Design research reference (16 brand palettes including Vercel) |
| `client/src/components/Sidebar.css` | Sidebar visual treatment (blur, shadows, gradients) |
| `client/src/components/Chat.css` | Compose card styling, chat layout |
| `client/src/components/EscalationDashboard.css` | Escalation detail layout |
| `client/src/themes/apple.css` | Apple theme overlay (glass, blur, glow effects) |

---

*End of report. All findings cross-referenced against the live Geist documentation and the QBO codebase as of 2026-03-19.*
