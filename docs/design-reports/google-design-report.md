# Google Material Design 3 (Material You) -- Application to QBO Escalation Tool

*Design research report -- March 20, 2026*
*Researcher: Claude (Design System Analysis Agent)*

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Design Philosophy](#design-philosophy)
3. [Key Design Patterns](#key-design-patterns)
4. [Color System](#color-system)
5. [Typography and Spacing](#typography-and-spacing)
6. [Animation and Motion](#animation-and-motion)
7. [Iconography](#iconography)
8. [Accessibility](#accessibility)
9. [Dark Mode](#dark-mode)
10. [Responsive Design](#responsive-design)
11. [QBO Escalation App Mapping](#qbo-escalation-app-mapping)
12. [What NOT to Copy](#what-not-to-copy)
13. [Implementation Priority](#implementation-priority)
14. [CSS Custom Property Definitions](#css-custom-property-definitions)
15. [Sources](#sources)

---

## Executive Summary

Material Design 3's philosophy in one sentence: **Design should be personal, adaptive, and expressive -- generating entire color schemes, shape systems, and motion languages from a single seed color so that every interface feels like it belongs to the person using it.**

The three highest-value ideas the QBO app should adopt from MD3, ranked:

1. **Tonal surface hierarchy** -- MD3 replaces flat background colors with a 5-level tonal surface system (Surface, Surface Container Low/Medium/High/Highest) derived from the primary color. This gives every layer of UI a subtle warmth that comes from the brand color itself, rather than arbitrary gray steps. For QBO's warm-authority identity, this would mean the cream/stone surfaces carry a whisper of the ember amber accent throughout, creating visual cohesion that currently only exists in the accent elements.

2. **Systematic elevation through tone, not just shadow** -- MD3 moved away from Material 2's shadow-heavy elevation to tonal differentiation: higher-elevation surfaces get lighter in light mode (more tinted) and lighter in dark mode (higher tone). The QBO app already uses multi-layered shadows well, but combining shadow *and* tonal shift for elevation would improve card/panel hierarchy, especially in dark mode where shadows become invisible.

3. **Component-level color tokens with role separation** -- MD3's three-tier token system (reference -> system -> component) means every component's colors are derived from semantic roles (primary, secondary, tertiary, surface) rather than hardcoded hex values. QBO already has good semantic tokens (`--accent`, `--success`, `--danger`), but lacks the intermediate "container" tokens that MD3 uses (`primaryContainer`, `secondaryContainer`, `tertiaryContainer`) which provide consistent low-emphasis backgrounds for grouped elements.

**Context comparison:** MD3 optimizes for consumer mobile apps -- personal devices, emotional engagement, wallpaper-derived theming, touch-first interaction. QBO optimizes for desktop-first professional tools -- 8+ hour shifts, keyboard-heavy workflows, information density, clinical accuracy. These contexts diverge significantly, which makes MD3 a fascinating study in *selective* adoption rather than wholesale theming.

**What QBO already does well:** The warm neutral palette, the multi-layered shadow system, the 4px spacing grid, the motion token system (which already incorporates M3 easing curves in `design-system-v2.css`), dark mode parity, and the `prefers-reduced-motion` coverage are all strong foundations that align with or exceed MD3's baseline.

**What QBO is missing:** Tonal surface differentiation (surfaces are static hex values rather than tonally derived), container-color tokens for semantic grouping, a formalized state layer system (hover/focus/pressed opacity overlays), and MD3's approach to dynamic theming infrastructure where an entire palette regenerates from a single seed change.

---

## Design Philosophy

### Stated Principles

Material Design 3, announced as "Material You" at Google I/O 2021 and formalized as the M3 specification at [m3.material.io](https://m3.material.io/), is built on three stated principles:

1. **Personal** -- The system adapts to individual users through dynamic color (extracting palette from wallpaper), customizable shapes, and user-generated themes. The M3 documentation states: "Material 3 enables personal, adaptive, and expressive experiences -- from dynamic color to accessible design." (Source: [m3.material.io](https://m3.material.io/))

2. **Adaptive** -- Components respond to context: device size (compact/medium/expanded window classes), input method (touch/keyboard/stylus), and accessibility needs (reduced motion, high contrast). The layout system uses canonical layouts that morph across breakpoints.

3. **Expressive** -- M3 Expressive (launched 2025-2026) pushed further into emotional design: spring-based animations, shape morphing, vibrant color, and "moments of delight." Google's blog states this was "built to meet user demand for experiences that are modern, relevant, and distinct." (Source: [blog.google](https://blog.google/products-and-platforms/platforms/android/material-3-expressive-android-wearos-launch/))

### How Principles Manifest in Product Decisions

Dynamic color is the most concrete expression: Android 12+ extracts a source color from the user's wallpaper, runs it through the HCT color space algorithm, and generates a complete 30+ token palette (5 key colors x 13 tonal stops each). Every system UI surface, button, and icon inherits from this generated palette. The practical result is that no two Android phones look the same -- the system chrome becomes personal property.

Shape is another concrete expression: M3 defines a shape scale (None/Extra Small/Small/Medium/Large/Extra Large/Full) where corner radius communicates component importance. Small, utilitarian elements like chips use Extra Small (4dp). Hero elements like FABs use Large (16dp) or Extra Large (28dp). Full creates pills. This isn't aesthetic preference -- it's a visual language where roundedness signals prominence.

### The User MD3 Optimizes For

MD3's primary user is a consumer on a mobile device -- someone who wants their phone to feel *theirs*. The personalization features (wallpaper-derived color, custom icon shapes, themed app icons) serve emotional attachment, not productivity. This is fundamentally different from QBO's escalation specialist who needs the tool to disappear -- to become invisible infrastructure for fast case resolution.

### Dark Mode Philosophy

MD3 treats dark and light as equal citizens, generated from the same tonal palette. Dark mode in M3 is not "invert and adjust" -- it's "use higher tone stops from the same HCT palette." Surface at Tone 6 in dark mode, Surface Container at Tone 12, Surface Container High at Tone 17. This ensures dark mode inherits the same color temperature as light mode, just at different luminance levels.

### Brand Identity Through Color

MD3's default baseline is purple (#6750A4) -- a deliberate choice. Purple communicates creativity, technology, and premium quality. It's Google's statement that M3 is about expression, not utility. However, the system is designed so that purple is merely the default seed -- every implementation is expected to replace it with a brand color.

### Content vs. Chrome Balance

M3 Expressive tilted the balance toward chrome -- larger touch targets, bolder shapes, more animated transitions. The original M3 (pre-Expressive) was more restrained, closer to utility. For QBO, the pre-Expressive M3 values are more relevant: clean surfaces, semantic color roles, systematic elevation, and motion that informs rather than entertains.

---

## Key Design Patterns

### 1. Navigation Architecture -- Rail/Drawer/Bar Adaptive Pattern

**What it is:** MD3 defines three navigation components that swap based on window size class. Compact (<600dp): bottom navigation bar with 3-5 destinations, icon + label, 80dp height. Medium (600-840dp): navigation rail on the leading edge, 80dp wide, icons with optional labels, FAB placement at top. Expanded (>840dp): permanent navigation drawer, 360dp wide, icon + label + section grouping.

**Why it works:** The pattern ensures navigation never fights content space. On mobile, the bottom bar preserves horizontal real estate. On desktop, the permanent drawer provides persistent wayfinding without overlay behavior.

**QBO application:** QBO already uses a left sidebar (`Sidebar.css`, `--sidebar-width: 268px`) that collapses to 52px (`--sidebar-collapsed`). The MD3 insight is the **navigation rail** concept for the collapsed state -- instead of hiding labels entirely, the rail shows icons centered in an 80dp strip with the active item indicated by a pill-shaped indicator. QBO's collapsed sidebar at 52px is close to a rail already; adopting the pill indicator pattern would improve collapsed-state usability.

### 2. Surface Container Hierarchy

**What it is:** MD3 defines five surface container levels: Surface (lowest), Surface Container Low, Surface Container (default), Surface Container High, and Surface Container Highest. Each level is a different tone value from the neutral tonal palette, tinted by the primary color. In light mode, higher containers are slightly darker; in dark mode, higher containers are slightly lighter.

**Why it works:** Instead of relying on shadows alone for depth, the background color itself communicates layer position. This works especially well in dark mode where shadows are invisible against dark backgrounds.

**QBO application:** QBO uses `--bg`, `--bg-raised`, `--bg-sunken`, and `--bg-sidebar` -- four surface levels. Adopting the MD3 naming convention and adding a fifth level (equivalent to Surface Container Highest) would give the compose card, modal overlays, and popover panels distinct surface tones, reducing reliance on shadows for elevation signaling.

### 3. State Layers -- Systematic Hover/Focus/Pressed Overlays

**What it is:** Every interactive component in MD3 has a "state layer" -- a semi-transparent overlay of the component's content color that appears on hover (8% opacity), focus (10%), pressed (10%), and dragged (16%). The overlay color matches the text/icon color, not the background.

**Why it works:** State layers create consistent feedback across every component without custom hover styles per element. A primary button gets a primary-colored overlay; a surface-level list item gets an onSurface-colored overlay.

**QBO application:** QBO handles hover states per-component: `.sidebar-nav-item:hover` in `Sidebar.css`, `.compose-card:hover` in `Chat.css`, `.escalation-card:hover` in card styles. A unified state layer system using CSS `::before` pseudo-elements with the content color at fixed opacity percentages would reduce CSS duplication and ensure consistent interactive feedback across every clickable element.

### 4. Cards with Outlined/Filled/Elevated Variants

**What it is:** MD3 defines three card variants. Elevated cards use shadow. Filled cards use a higher-tone surface color (Surface Container Highest). Outlined cards use a 1px border with Outline Variant color. Each serves a different purpose: elevated for primary content, filled for containing related groups, outlined for equal-emphasis siblings.

**Why it works:** The three variants let designers communicate card importance without relying on content alone. In a list of cards, outlined cards feel equal; one elevated card in that list draws attention.

**QBO application:** The escalation dashboard (`EscalationDashboard.css`) and compose card (`Chat.css`) both use shadow-based elevation. Adding outlined card variants for lower-emphasis items (resolved escalations, template cards) and filled variants for grouped metadata would create clearer visual hierarchy in the dashboard view.

### 5. Search Bar with Expanding Behavior

**What it is:** MD3's search bar expands from a compact pill state to a full search view with suggestions, recent searches, and filtered results. The transition uses the emphasized easing curve over 400ms, expanding from the bar's original position.

**Why it works:** The expanding pattern keeps the search affordance always visible without permanently consuming space. The animation from origin maintains spatial context.

**QBO application:** QBO's search and filtering happen within specific views. An MD3-style expanding search bar in the sidebar or header could provide universal cross-view search -- finding escalations, templates, playbook entries, and INV cases from a single entry point.

### 6. Chips for Filtering and Selection

**What it is:** MD3 chips are compact elements that represent attributes, actions, or selections. Filter chips toggle on/off with a checkmark animation. Assist chips suggest contextual actions. Input chips represent user-provided values (like tags).

**Why it works:** Chips provide glanceable, interactive metadata without the weight of full buttons. Filter chips are especially effective for multi-select filtering because their state (selected/unselected) is immediately visible.

**QBO application:** The escalation dashboard uses category badges (`.cat-*` classes in `App.css`). Converting these to interactive filter chips would let specialists filter the dashboard by category, status, or priority with direct manipulation rather than dropdown menus.

### 7. Bottom Sheets and Side Sheets

**What it is:** MD3 bottom sheets slide up from the screen bottom (mobile) or from the side (desktop) to show contextual content without navigating away. They come in standard (partially covers content) and modal (full overlay with scrim) variants.

**Why it works:** Sheets maintain context -- the parent content remains visible and accessible. This is critical for tasks where the user needs to reference the underlying view while interacting with the sheet.

**QBO application:** The escalation detail view (`EscalationDashboard.css`, `.esc-detail-columns`) uses a two-column grid layout. For the copilot panel (`CopilotPanel.css`) and investigations view (`InvestigationsView.css`), an MD3-style side sheet pattern would keep the main content visible while showing supplementary information.

### 8. Keyboard Navigation and Focus Management

**What it is:** MD3 components support full keyboard navigation: Tab moves between components, arrow keys navigate within components (lists, tabs, menus), Enter/Space activate, Escape dismisses. Focus indicators use a 3px offset outline in the focus color.

**Why it works:** Professional users who spend hours in a tool develop muscle memory for keyboard shortcuts. Consistent keyboard patterns reduce the cognitive overhead of switching between mouse and keyboard.

**QBO application:** QBO could adopt MD3's focus indicator pattern (the ring shadow system in `design-system.css` already uses `--shadow-ring-accent`) and extend keyboard navigation to the sidebar nav, escalation list, and chat message navigation.

---

## Color System

### 4.1 Complete Palette

MD3's baseline theme uses a purple primary (#6750A4). The complete palette is generated from five key colors through the HCT color space, producing tonal palettes of 13 stops each (Tones: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100).

**Baseline Light Theme Color Roles:**

| Token/Name | Hex Value | RGB | Usage |
|------------|-----------|-----|-------|
| Primary | #6750A4 | 103, 80, 164 | Prominent buttons, active indicators, FAB |
| On Primary | #FFFFFF | 255, 255, 255 | Text/icons on primary color |
| Primary Container | #EADDFF | 234, 221, 255 | Tinted backgrounds for primary elements |
| On Primary Container | #21005D | 33, 0, 93 | Text on primary container |
| Secondary | #625B71 | 98, 91, 113 | Less prominent components, filter chips |
| On Secondary | #FFFFFF | 255, 255, 255 | Text/icons on secondary |
| Secondary Container | #E8DEF8 | 232, 222, 248 | Secondary tinted backgrounds |
| On Secondary Container | #1D192B | 29, 25, 43 | Text on secondary container |
| Tertiary | #7D5260 | 125, 82, 96 | Contrasting accents, complementary elements |
| On Tertiary | #FFFFFF | 255, 255, 255 | Text/icons on tertiary |
| Tertiary Container | #FFD8E4 | 255, 216, 228 | Tertiary tinted backgrounds |
| On Tertiary Container | #31111D | 49, 17, 29 | Text on tertiary container |
| Error | #B3261E | 179, 38, 30 | Error states, destructive actions |
| On Error | #FFFFFF | 255, 255, 255 | Text on error color |
| Error Container | #F9DEDC | 249, 222, 220 | Error background tint |
| On Error Container | #410E0B | 65, 14, 11 | Text on error container |
| Surface | #FEF7FF | 254, 247, 255 | Base background |
| On Surface | #1D1B20 | 29, 27, 32 | Primary text on surface |
| On Surface Variant | #49454F | 73, 69, 79 | Secondary text on surface |
| Outline | #79747E | 121, 116, 126 | Borders, dividers |
| Outline Variant | #CAC4D0 | 202, 196, 208 | Subtle borders |
| Surface Container Lowest | #FFFFFF | 255, 255, 255 | Lowest elevation container |
| Surface Container Low | #F7F2FA | 247, 242, 250 | Low elevation container |
| Surface Container | #F3EDF7 | 243, 237, 247 | Default container |
| Surface Container High | #ECE6F0 | 236, 230, 240 | High elevation container |
| Surface Container Highest | #E6E0E9 | 230, 224, 233 | Highest elevation container |
| Inverse Surface | #322F35 | 50, 47, 53 | Snackbars, tooltips |
| Inverse On Surface | #F5EFF7 | 245, 239, 247 | Text on inverse surface |
| Inverse Primary | #D0BCFF | 208, 188, 255 | Primary on inverse surface |
| Surface Tint | #6750A4 | 103, 80, 164 | Tint overlay color |
| Scrim | #000000 | 0, 0, 0 | Modal overlay at 32% opacity |

**Baseline Dark Theme Color Roles:**

| Token/Name | Hex Value | RGB | Usage |
|------------|-----------|-----|-------|
| Primary | #D0BCFF | 208, 188, 255 | Prominent elements in dark |
| On Primary | #381E72 | 56, 30, 114 | Text on primary |
| Primary Container | #4F378B | 79, 55, 139 | Primary tinted backgrounds |
| On Primary Container | #EADDFF | 234, 221, 255 | Text on primary container |
| Secondary | #CCC2DC | 204, 194, 220 | Secondary elements |
| On Secondary | #332D41 | 51, 45, 65 | Text on secondary |
| Tertiary | #EFB8C8 | 239, 184, 200 | Tertiary elements |
| On Tertiary | #492532 | 73, 37, 50 | Text on tertiary |
| Error | #F2B8B5 | 242, 184, 181 | Error states |
| On Error | #601410 | 96, 20, 16 | Text on error |
| Surface | #141218 | 20, 18, 24 | Base dark background |
| On Surface | #E6E0E9 | 230, 224, 233 | Primary text |
| On Surface Variant | #CAC4D0 | 202, 196, 208 | Secondary text |
| Outline | #938F99 | 147, 143, 153 | Borders |
| Outline Variant | #49454F | 73, 69, 79 | Subtle borders |
| Surface Container Lowest | #0F0D13 | 15, 13, 19 | Lowest container |
| Surface Container Low | #1D1B20 | 29, 27, 32 | Low container |
| Surface Container | #211F26 | 33, 31, 38 | Default container |
| Surface Container High | #2B2930 | 43, 41, 48 | High container |
| Surface Container Highest | #36343B | 54, 52, 59 | Highest container |

### 4.2 Surface Hierarchy

**Light Mode Surface Stack:**

| Level | Hex | Tone | Usage |
|-------|-----|------|-------|
| Surface (Deepest) | #FEF7FF | 98 | Page background |
| Surface Container Lowest | #FFFFFF | 100 | Inset regions, wells |
| Surface Container Low | #F7F2FA | 96 | Low-emphasis cards |
| Surface Container | #F3EDF7 | 94 | Default cards, panels |
| Surface Container High | #ECE6F0 | 92 | Elevated cards, menus |
| Surface Container Highest | #E6E0E9 | 90 | Highest emphasis, tooltips |

**Dark Mode Surface Stack:**

| Level | Hex | Tone | Usage |
|-------|-----|------|-------|
| Surface (Deepest) | #141218 | 6 | Page background |
| Surface Container Lowest | #0F0D13 | 4 | Inset regions |
| Surface Container Low | #1D1B20 | 10 | Low-emphasis cards |
| Surface Container | #211F26 | 12 | Default cards |
| Surface Container High | #2B2930 | 17 | Elevated cards |
| Surface Container Highest | #36343B | 22 | Highest emphasis |

### 4.3 Color Architecture

**Three-Tier Token System:**

MD3 organizes color through a three-tier token hierarchy:

1. **Reference tokens** -- Raw tonal palette values. Example: `md.ref.palette.primary40` = #6750A4. These are the full 13-stop tonal palettes for each key color. Never used directly in components.

2. **System tokens** -- Semantic role assignments. Example: `md.sys.color.primary` = `md.ref.palette.primary40` in light mode, `md.ref.palette.primary80` in dark mode. These map reference tokens to light/dark mode roles.

3. **Component tokens** -- Per-component styling. Example: `md.comp.filled-button.container.color` = `md.sys.color.primary`. Components reference system tokens, not reference tokens directly.

**HCT Color Space:**

MD3 introduced HCT (Hue, Chroma, Tone) -- a perceptually uniform color space designed specifically for UI theming. Unlike HSL where "lightness: 50%" looks different for different hues, HCT's Tone dimension is perceptually uniform: Tone 50 purple and Tone 50 green appear equally bright to the human eye. HCT's three dimensions:

- **Hue**: 0-360 degrees, the color family (red, blue, green, etc.)
- **Chroma**: 0 to ~120, the colorfulness/saturation (0 = gray)
- **Tone**: 0-100, the perceived lightness (0 = black, 100 = white)

This enables the dynamic color system: given any seed color, the algorithm extracts its HCT hue and chroma, then generates tonal palettes by sweeping through tone values while maintaining hue and adjusting chroma to stay within the gamut. The result is mathematically guaranteed contrast ratios between any two tone steps.

**Theme Implementation:**

MD3 themes are implemented through CSS custom properties in web contexts (via `@material/web`), XML theme attributes in Android, and `ColorScheme` objects in Jetpack Compose. The web implementation uses a flat custom property namespace: `--md-sys-color-primary`, `--md-sys-color-on-primary`, etc.

### 4.4 Comparison with QBO App

| Concept | Material Design 3 | QBO App | Analysis |
|---------|-------------------|---------|----------|
| Background | #FEF7FF (light) / #141218 (dark) -- cool purple tint | #f5f2ed (light) / #141210 (dark) -- warm cream/obsidian | QBO's warm temperature is better for 8-hour shifts. MD3's purple tint would feel clinical in a support tool. The tonal derivation *method* is valuable even if the temperature is wrong. |
| Text Primary | #1D1B20 (light) / #E6E0E9 (dark) | #2a2420 (light) / #ede6dc (dark) | Both achieve near-black/near-white with temperature tinting. QBO's warm tint matches the surface family. MD3's cool tint matches its surfaces. Both correct within their systems. |
| Accent | #6750A4 (baseline purple) | #c76a22 (ember amber) | Completely different psychological signals. Purple = creative/premium. Amber = warm/authoritative. QBO's ember amber is correct for a professional support tool. |
| Success | Not explicitly named in baseline (tertiary sometimes serves this role) | #2E7D52 (forest green) | MD3 lacks a dedicated success color -- it relies on custom additional colors. QBO is stronger here with explicit success/warning/danger semantics needed for case status. |
| Warning | Not in baseline palette | #B8860B (golden) | Same gap as success. MD3's consumer focus doesn't need status semantics. QBO's professional context requires them. |
| Danger/Error | #B3261E (light) / #F2B8B5 (dark) | #b33025 (light) / #e05a4e (dark) | Nearly identical red values. Both use desaturated, warm-shifted reds that read as serious without being alarming. |
| Info | Uses primary | Uses accent (#c76a22) | Both alias info to the primary accent. Reasonable for both contexts. |
| Sidebar | Surface Container (same family as page bg) | #f8f6f2 (light) / #1a1714 (dark) -- distinct but harmonious | QBO differentiates sidebar from page background, which is useful for a split-panel layout. MD3's same-family approach works for mobile but loses navigational clarity on desktop. |
| Surface Hierarchy | 5 container levels, tonally derived from primary | 4 levels (bg, bg-raised, bg-sunken, bg-sidebar), manually specified | MD3's 5-level system with tonal derivation is more systematic. QBO could adopt the container naming and add a fifth level. |
| Container Tokens | primaryContainer, secondaryContainer, tertiaryContainer | No container concept -- accent-subtle serves a similar purpose | MD3's container tokens for low-emphasis grouped content would benefit QBO's category badges and status backgrounds. |

---

## Typography and Spacing

### 5.1 Typography

MD3 uses Roboto (and Roboto Flex for variable font support) as its default typeface. The complete type scale:

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| Display Large | 57px | 400 | 64px | -0.25px | Hero numbers, large counters |
| Display Medium | 45px | 400 | 52px | 0px | Section heroes |
| Display Small | 36px | 400 | 44px | 0px | Smaller heroes |
| Headline Large | 32px | 400 | 40px | 0px | Page titles |
| Headline Medium | 28px | 400 | 36px | 0px | Section titles |
| Headline Small | 24px | 400 | 32px | 0px | Subsection titles |
| Title Large | 22px | 400 | 28px | 0px | Card titles, dialog titles |
| Title Medium | 16px | 500 | 24px | 0.15px | List headers, tab labels |
| Title Small | 14px | 500 | 20px | 0.1px | Subheaders |
| Body Large | 16px | 400 | 24px | 0.5px | Primary body text |
| Body Medium | 14px | 400 | 20px | 0.25px | Secondary body text |
| Body Small | 12px | 400 | 16px | 0.4px | Captions, metadata |
| Label Large | 14px | 500 | 20px | 0.1px | Buttons, nav labels |
| Label Medium | 12px | 500 | 16px | 0.5px | Chips, badges |
| Label Small | 11px | 500 | 16px | 0.5px | Small labels, tags |

**Comparison with QBO:** QBO uses Inter (not Roboto) at a 14.5px base with negative letter-spacing on headings. Key differences:

- MD3 uses **positive** letter-spacing on body/label text (0.25-0.5px) to improve readability of Roboto's condensed metrics. QBO uses **negative** letter-spacing on headings (-0.025em to -0.006em) for the "tight authority" feel that Inter's wider metrics support. Both are correct for their typefaces.
- MD3's heading weights are predominantly Regular (400), relying on size alone for hierarchy. QBO uses SemiBold/Bold (600-700) for headings, which is better for information-dense screens where size differences alone don't create enough contrast.
- MD3's Display sizes (36-57px) are irrelevant for QBO -- they're designed for mobile hero moments. QBO's largest text is 28px (`--text-2xl`), which is appropriate for a professional tool.
- MD3 uses a 15-step type scale. QBO uses a 7-step scale (`--text-xs` through `--text-2xl`) plus semantic classes (`.text-display` through `.text-overline`). QBO's scale is more compact but sufficient -- adding MD3's granularity would introduce unused intermediate sizes.

### 5.2 Spacing

MD3 uses a 4dp (density-independent pixel) base grid for component internal spacing. The documented spacing values used across components:

| Token | Value | Usage |
|-------|-------|-------|
| 0 | 0dp | No spacing |
| 4 | 4dp | Minimum internal padding |
| 8 | 8dp | Tight internal padding, icon-text gap |
| 12 | 12dp | Standard internal padding |
| 16 | 16dp | Card padding, list item padding |
| 20 | 20dp | Section spacing |
| 24 | 24dp | Content area padding |
| 32 | 32dp | Large section breaks |
| 48 | 48dp | Page-level margins |

QBO uses a custom spacing scale (`--sp-1: 4px` through `--sp-10: 36px`) that is denser than MD3's scale. QBO's intermediate steps (6px, 14px, 28px) provide finer control for the information-dense layout -- MD3's 8dp jumps are designed for touch-target-sized components and would feel too sparse for a desktop support tool.

### 5.3 Border Radius

MD3 Shape Scale:

| Token | Value | Usage |
|-------|-------|-------|
| None | 0dp | No rounding (sharp edges) |
| Extra Small | 4dp | Chips, small badges |
| Small | 8dp | Buttons, text fields |
| Medium | 12dp | Cards, dialogs |
| Large | 16dp | FABs, navigation drawers |
| Extra Large | 28dp | Bottom sheets, large cards |
| Full | 50% | Circular avatars, dot indicators |

**QBO comparison:** QBO's radius scale (`--radius-xs: 3px` through `--radius-pill: 999px`, `--radius-full: 9999px`) maps closely. The notable difference is MD3's Extra Large at 28dp -- QBO has `--radius-2xl: 20px` which is slightly tighter. MD3's more generous top-end radius reflects its consumer-facing personality.

---

## Animation and Motion

### 6.1 Motion Philosophy

MD3's motion system is built on the principle of "informative motion" -- every animation should help the user understand spatial relationships, hierarchy changes, and state transitions. The M3 specification states that motion should be: functional (assists navigation, not decoration), responsive (reflects user input speed), and natural (uses physics-based easing).

M3 Expressive added a spring-based layer on top: components can use spring animations with configurable damping and stiffness for more organic, lively motion. This was explicitly described as making interfaces "feel even more fluid" with "natural, springy animations."

### 6.2 Duration Scale

| Category | Token | Duration | Usage |
|----------|-------|----------|-------|
| Short 1 | `md.sys.motion.duration.short1` | 50ms | Hover feedback, ripple start |
| Short 2 | `md.sys.motion.duration.short2` | 100ms | Simple state changes, icon swap |
| Short 3 | `md.sys.motion.duration.short3` | 150ms | Selection, toggle |
| Short 4 | `md.sys.motion.duration.short4` | 200ms | Standard interaction feedback |
| Medium 1 | `md.sys.motion.duration.medium1` | 250ms | Small component expand/collapse |
| Medium 2 | `md.sys.motion.duration.medium2` | 300ms | Card transitions, menu open |
| Medium 3 | `md.sys.motion.duration.medium3` | 350ms | Navigation transitions |
| Medium 4 | `md.sys.motion.duration.medium4` | 400ms | Large component transitions |
| Long 1 | `md.sys.motion.duration.long1` | 450ms | Page transitions |
| Long 2 | `md.sys.motion.duration.long2` | 500ms | Complex multi-step transitions |
| Extra Long 1 | `md.sys.motion.duration.extra-long1` | 700ms | Full-screen transitions |
| Extra Long 2 | `md.sys.motion.duration.extra-long2` | 800ms | Dramatic reveals |
| Extra Long 3 | `md.sys.motion.duration.extra-long3` | 900ms | Elaborate choreography |
| Extra Long 4 | `md.sys.motion.duration.extra-long4` | 1000ms | Maximum duration |

### 6.3 Easing Curves

| Name | Cubic Bezier | Usage |
|------|-------------|-------|
| Standard | `cubic-bezier(0.2, 0, 0, 1)` | Default for most transitions |
| Standard Decelerate | `cubic-bezier(0, 0, 0, 1)` | Elements entering the screen |
| Standard Accelerate | `cubic-bezier(0.3, 0, 1, 1)` | Elements leaving the screen |
| Emphasized | Two-curve sequence: accel then decel | Attention-drawing transitions |
| Emphasized Decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Emphasized entrance |
| Emphasized Accelerate | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Emphasized exit |

**Note on the Emphasized curve:** The full emphasized easing is not a single cubic-bezier -- it's a two-phase curve that accelerates for the first 30% of the duration and decelerates for the remaining 70%. In CSS, this is approximated by `cubic-bezier(0.2, 0, 0, 1)` or by using the decelerate variant alone.

### 6.4 Specific Animation Patterns

1. **Ripple effect** -- Touch feedback radiating from the contact point, expanding at Standard easing over 300ms. Opacity starts at 12% of the content color and fades to 0.
2. **Container transform** -- A shared-element transition where a card morphs into a detail view. The container shape, position, and size animate simultaneously using Emphasized easing at 500ms.
3. **Navigation transitions** -- Forward navigation slides content left (entering) and right (exiting). Fade crossfade at 300ms with Standard easing.
4. **FAB morph** -- The Floating Action Button can morph into a dialog, bottom sheet, or expanded surface. Shape corners animate from Full to the target shape's radius.
5. **Top app bar scroll** -- The app bar compresses from expanded (height: 152dp) to collapsed (height: 64dp) as content scrolls, with title font scaling from Headline Medium to Title Large.
6. **Bottom sheet drag** -- Responds to drag velocity with spring physics. Snaps to half-expanded or full-expanded detents with Emphasized Decelerate easing.
7. **Switch toggle** -- The thumb slides with Standard easing at 200ms while the track color crossfades. The thumb scales slightly on press (1.15x).
8. **Skeleton shimmer** -- Loading states use a gradient shimmer moving left-to-right at 1500ms with Standard easing, repeating.

### 6.5 Comparison with QBO

QBO already incorporates M3 easing curves in `design-system-v2.css`:

- `--ease-m3-standard: cubic-bezier(0.4, 0, 0.2, 1)` -- This uses the M2 standard curve, not M3. The M3 standard is `cubic-bezier(0.2, 0, 0, 1)`, which QBO has as `--ease-standard` in `App.css`. The `--ease-m3-*` tokens in v2 are labeled as M3 but use slightly different values.
- `--ease-m3-emphasized-decel: cubic-bezier(0.05, 0.7, 0.1, 1)` -- Matches M3 spec exactly.
- `--ease-m3-emphasized-accel: cubic-bezier(0.3, 0, 0.8, 0.15)` -- Matches M3 spec exactly.

QBO's duration scale in `design-system-v2.css` (`--dur-short-1: 50ms` through `--dur-long-2: 500ms`) matches M3's first 10 steps exactly. The Extra Long durations (700-1000ms) are missing, which is correct -- those durations are for mobile page transitions and would feel sluggish in a desktop tool.

QBO uses Framer Motion 12 with spring physics for component animations, which aligns with M3 Expressive's spring-based approach. The 200ms sweet spot (`--duration-normal`) matches M3's Short 4 duration for standard interactions.

---

## Iconography

### Material Symbols

MD3 uses Material Symbols as its icon system -- a variable font containing 2,500+ glyphs with four adjustable axes:

- **Fill** (0-1): 0 = outlined, 1 = filled. Outlined for navigation items in default state, filled for active/selected state. This active/inactive fill toggle is a core M3 pattern.
- **Weight** (100-700): Matches the text weight in context. A Bold heading's adjacent icon should use Weight 700.
- **Grade** (-25 to 200): Fine-tuning for dark mode. Negative grade reduces stroke weight for light-on-dark contexts where optical weight increases.
- **Optical Size** (20-48): Adjusts detail level for the rendering size. 20px icons get simplified geometry; 48px icons get finer details.

Standard icon sizes in MD3: 20dp (dense), 24dp (default), 40dp (prominent), 48dp (display). Touch targets for icons are always minimum 48dp regardless of visual icon size.

**Icon design principles:**
- Simple, geometric forms -- avoid fine details that disappear at small sizes
- Consistent 2dp stroke weight at 24dp optical size
- Sharp (not rounded) stroke terminals for clarity
- 2dp padding within the 24dp bounding box (20dp live area)

**QBO application:** QBO currently uses inline SVG icons and emoji. Adopting Material Symbols as a variable font would reduce bundle size (one font file vs. individual SVGs), enable the fill/weight/grade customization for active states, and provide a consistent icon language. The fill toggle (outlined default, filled active) would improve sidebar navigation clarity.

---

## Accessibility

### WCAG Compliance

MD3 targets WCAG 2.1 Level AA as the baseline, with several patterns that approach AAA. The HCT color space was specifically designed with accessibility in mind: the Tone dimension maps directly to perceived luminance, so the system can mathematically guarantee contrast ratios. Any two tones with a difference of 40+ meet the 4.5:1 AA contrast requirement for normal text. A difference of 50+ meets the 7:1 AAA requirement.

### Contrast Approach

MD3's color role system enforces contrast through naming conventions: every color has an "On" counterpart. `Primary` (#6750A4) is always paired with `On Primary` (#FFFFFF). `Surface` (#FEF7FF) is always paired with `On Surface` (#1D1B20). The tone difference between Surface (Tone 98) and On Surface (Tone 10) is 88 -- far exceeding the minimum 40 needed for AA.

### Focus Indicators

MD3 uses a visible focus indicator for keyboard navigation: a 3dp outline offset from the component, using the `Primary` color. This meets WCAG 2.4.7 (Focus Visible). The focus indicator does not appear on mouse/touch interaction (`:focus-visible` vs `:focus`).

QBO already implements this pattern in `design-system-v2.css`:
```css
:focus:not(:focus-visible) { outline: none; }
```

### Keyboard Navigation

MD3 components follow WAI-ARIA patterns:
- Tabs: Arrow keys navigate between tabs, Tab key moves to tab content
- Lists: Arrow keys navigate items, Enter selects
- Menus: Arrow keys navigate, Escape closes, type-ahead for item selection
- Dialogs: Tab traps focus within the dialog, Escape closes

### Screen Reader Support

MD3 components include semantic ARIA attributes: `role`, `aria-label`, `aria-selected`, `aria-expanded`, `aria-disabled`. Component documentation includes specific accessibility guidance per component (e.g., navigation bar, chips, tabs each have dedicated accessibility pages on m3.material.io).

### Reduced Motion

MD3 respects `prefers-reduced-motion: reduce` by:
- Removing all non-essential animations
- Replacing transitions with instant state changes
- Keeping functional motion (like focus indicator movement) but at reduced duration
- Maintaining layout shifts (position changes) without animation

QBO's `design-system-v2.css` already has comprehensive reduced-motion coverage with the universal `*` selector catch-all, which is more aggressive than MD3's selective approach.

### Color-Blind Considerations

MD3's tonal approach helps color-blind users because surfaces are differentiated by *tone* (lightness) not just *hue*. The Surface Container hierarchy works in grayscale because each level has a distinct tone value. However, MD3 does not use patterns, icons, or text labels as supplements to color alone for status communication -- it relies on the "On" color pairing for sufficient contrast.

QBO is stronger here: status indicators use colored dots *plus* text labels *plus* distinct background tints, providing triple redundancy for status communication.

---

## Dark Mode

### First-Class Treatment

MD3 dark mode is not a CSS inversion or a separate color specification -- it's the *same* tonal palette viewed from different tone stops. Light mode reads tones 90-100 for surfaces and 10-40 for text. Dark mode reads tones 6-30 for surfaces and 80-95 for text. The HCT color space ensures the hue and chroma remain consistent across these tone shifts, so the brand identity is preserved in dark mode.

### Theme Variants

MD3 Expressive introduced theme variants beyond light/dark: medium contrast (increased tone separation for readability) and high contrast (maximum tone separation for accessibility). These use the same tonal palette with adjusted role assignments -- no new colors, just different tone-to-role mappings.

### Surface Hierarchy in Dark Mode

Dark mode surfaces increase in tone (lightness) as elevation increases -- the opposite of light mode. This mirrors a physical metaphor: in a dark room, elevated surfaces catch more light.

| Surface Level | Dark Tone | Dark Hex | Light Tone | Light Hex |
|---------------|-----------|----------|------------|-----------|
| Surface | 6 | #141218 | 98 | #FEF7FF |
| Container Lowest | 4 | #0F0D13 | 100 | #FFFFFF |
| Container Low | 10 | #1D1B20 | 96 | #F7F2FA |
| Container | 12 | #211F26 | 94 | #F3EDF7 |
| Container High | 17 | #2B2930 | 92 | #ECE6F0 |
| Container Highest | 22 | #36343B | 90 | #E6E0E9 |

### Accent Adaptation

In dark mode, the primary accent shifts from Tone 40 (#6750A4) to Tone 80 (#D0BCFF) -- a lighter, less saturated version that maintains the hue but reduces eye strain against dark surfaces. QBO does the same: `--accent` shifts from #c76a22 (light) to #e8943a (dark), a lighter amber.

### Shadow and Border Adaptation

MD3 eliminates drop shadows in dark mode entirely, replacing them with tonal surface elevation (described above). For cases where depth needs additional reinforcement, a 1px border at `Outline Variant` color provides the edge. QBO's dark mode shadows in `App.css` use heavier rgba(0,0,0) values -- a valid approach, but MD3's shadow-elimination approach could simplify the dark mode shadow definitions.

---

## Responsive Design

### Breakpoints

MD3 defines three window size classes based on width:

| Class | Width Range | Navigation | Layout |
|-------|------------|------------|--------|
| Compact | < 600dp | Bottom navigation bar | Single column |
| Medium | 600-840dp | Navigation rail (80dp) | List-detail or supporting panel |
| Expanded | > 840dp | Navigation drawer (360dp) | Multi-column, canonical layouts |

### Canonical Layouts

MD3 defines four canonical layouts for common app patterns:

1. **List-Detail** -- Master list on the left, detail on the right. On compact screens, the detail replaces the list.
2. **Supporting Panel** -- Primary content with a supplementary panel (like QBO's copilot panel).
3. **Feed** -- Vertically scrolling content with responsive column count.
4. **Hero** -- Full-width hero with content below, primarily marketing use.

### Mobile Patterns

- Touch targets: minimum 48dp, recommended 56dp
- Bottom sheets for secondary actions (avoids reaching to top of screen)
- Swipe gestures for navigation (back, dismiss)
- Inset padding: 16dp on compact, 24dp on expanded

### QBO Application

QBO's responsive breakpoint at 900px (in `EscalationDashboard.css` and `Chat.css`) for stacking columns is close to MD3's 840dp expanded threshold. MD3's `compact` class would be relevant if QBO ever targets tablet use. The canonical list-detail layout maps directly to QBO's escalation dashboard with its two-column detail view.

---

## QBO Escalation App Mapping

This section provides ranked, actionable recommendations for adopting MD3 patterns in the QBO app. Each recommendation references specific files and CSS classes from the codebase.

### Recommendation 1: Adopt Tonal Surface Container System

**MD3 Pattern:** Five-level surface container hierarchy where each level is a distinct tone derived from the primary color, replacing arbitrary background hex values.

**QBO Current State:** Four surface tokens in `App.css` (`:root` block, lines 34-37):
- `--bg: #f5f2ed` (base)
- `--bg-raised: #fcfaf7` (cards)
- `--bg-sunken: #ebe7e0` (wells)
- `--bg-sidebar: #f8f6f2` (sidebar)

These are manually specified hex values, not tonally derived from the accent color.

**Proposed Change:** Add a fifth surface level (`--bg-elevated`) and derive all five from the ember amber accent hue. Using the warm neutral palette (#f5f2ed is approximately HCT hue 55, chroma 6, tone 95), the tonal stack would be:
- `--bg-sunken`: Tone 91 (current #ebe7e0, approximately correct)
- `--bg`: Tone 95 (current #f5f2ed, approximately correct)
- `--bg-sidebar`: Tone 96 (current #f8f6f2, approximately correct)
- `--bg-raised`: Tone 98 (current #fcfaf7, approximately correct)
- `--bg-elevated`: Tone 100 (#FFFFFF or warm-tinted white)

**Why it matters:** The compose card (`Chat.css`, `.compose-card`), modal overlays, and dropdown menus currently all use `--bg-raised`. A fifth level would let the compose card sit at `--bg-raised` while modals sit at `--bg-elevated`, creating clearer depth hierarchy without additional shadow weight.

### Recommendation 2: Implement Container Color Tokens

**MD3 Pattern:** `primaryContainer`, `secondaryContainer`, `tertiaryContainer` -- low-emphasis backgrounds derived from accent colors, each with a paired `onContainer` text color.

**QBO Current State:** `--accent-subtle: #faf0e4` in `App.css` line 51 serves as the only container-like token. Category badges use per-category variables (`.cat-payroll-bg: #ede5f5` etc., lines 107-134) that are manually specified.

**Proposed Change:** Add container tokens:
- `--accent-container: #faf0e4` (maps to current `--accent-subtle`)
- `--accent-on-container: #5a3010` (dark text on accent container)
- `--secondary-container: #ede5f5` (for grouped metadata)
- `--secondary-on-container: #3d2870`
- `--tertiary-container: #e4f2ea` (maps to current `--success-subtle`)
- `--tertiary-on-container: #1a4030`

**Why it matters:** The escalation dashboard uses category badges, status chips, and priority indicators. Container tokens would provide systematic backgrounds for these elements instead of per-category hardcoded values, making it easier to maintain consistency and add new categories.

### Recommendation 3: Unified State Layer System

**MD3 Pattern:** Every interactive element gets a semi-transparent overlay at hover (8%), focus (10%), pressed (10%), using the element's content color.

**QBO Current State:** Hover states are defined per-component:
- `Sidebar.css` line 80: `.sidebar-nav-item:hover` uses `background: var(--bg-sunken)`
- `Chat.css` line 67: `.compose-card:hover` uses a box-shadow change
- `design-system-v2.css` line 248: `.escalation-card:hover` uses `box-shadow: var(--shadow-md)`

Each component has a different hover treatment.

**Proposed Change:** Create utility classes for state layers:
```css
.state-layer { position: relative; }
.state-layer::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: currentColor;
  opacity: 0;
  transition: opacity 150ms var(--ease-standard);
  pointer-events: none;
}
.state-layer:hover::before { opacity: 0.08; }
.state-layer:focus-visible::before { opacity: 0.10; }
.state-layer:active::before { opacity: 0.10; }
```

**Why it matters:** Consistent interactive feedback across all clickable elements builds muscle memory and trust. Specialists scanning dozens of escalations need immediate visual confirmation that an element is interactive and responsive.

### Recommendation 4: Icon Fill Toggle for Navigation

**MD3 Pattern:** Navigation destinations use outlined icons in default state and filled icons when selected. The fill transition provides a clear, glanceable active-state indicator.

**QBO Current State:** `Sidebar.css` line 61: `.sidebar-nav-item` uses inline SVG icons with accent color applied to the active item. The icon shape does not change between active and inactive states.

**Proposed Change:** Adopt Material Symbols (variable icon font) or implement SVG icon pairs (outlined/filled) that swap based on the `.active` class. The sidebar nav indicator (`.sidebar-nav-indicator-bg`) already provides a background highlight -- adding icon fill change doubles the signal strength.

**Why it matters:** During a busy shift, the specialist's peripheral vision needs to quickly confirm which section they're in. A filled icon is detectable at a glance; a color-only highlight requires focus.

### Recommendation 5: Tonal Elevation for Dark Mode Cards

**MD3 Pattern:** Dark mode cards use lighter surface tones instead of shadows for elevation. Surface Container High (#2B2930) is visibly lighter than Surface (#141218).

**QBO Current State:** Dark mode in `App.css` lines 290-293 uses heavier rgba(0,0,0) shadow values. `--bg-raised: #1e1b17` is the card color, and `--shadow-md` provides depth.

**Proposed Change:** In dark mode, card backgrounds should shift to a lighter tone when elevated. Add:
- `--bg-raised` in dark mode: lighten from #1e1b17 to #252119 (Tone 14 instead of 11)
- `--bg-elevated` in dark mode: #2e2822 (Tone 17)
- Reduce shadow opacity by 30% in dark mode when tonal elevation is active

**Why it matters:** Dark mode shadows are barely visible against dark backgrounds. Specialists working night shifts or in dimmed environments need clear card separation -- tonal lightness provides this where shadows cannot.

### Recommendation 6: Formalized Shape Scale Naming

**MD3 Pattern:** Shape tokens use semantic names (None, Extra Small, Small, Medium, Large, Extra Large, Full) that communicate component importance.

**QBO Current State:** `App.css` lines 158-162 define `--radius-sm: 4px` through `--radius-pill: 999px`. `design-system.css` adds `--radius-xs: 3px`, `--radius-full: 9999px`, `--radius-2xl: 20px`. `design-system-v2.css` adds `--radius-none: 0`.

**Proposed Change:** Create semantic shape aliases that map to the existing tokens:
```css
--shape-none: var(--radius-none);     /* 0 */
--shape-xs: var(--radius-xs);         /* 3px */
--shape-sm: var(--radius-sm);         /* 4px -- chips, badges */
--shape-md: var(--radius-md);         /* 8px -- buttons, inputs */
--shape-lg: var(--radius-lg);         /* 12px -- cards */
--shape-xl: var(--radius-xl);         /* 16px -- panels, drawers */
--shape-2xl: var(--radius-2xl);       /* 20px -- modals */
--shape-full: var(--radius-full);     /* 9999px -- avatars, pills */
```

**Why it matters:** Semantic shape names enforce consistency -- when a developer creates a new card component, reaching for `--shape-lg` instead of guessing a pixel value maintains the visual language without checking the design system docs.

### Recommendation 7: Search Bar with Cross-View Search

**MD3 Pattern:** Expanding search bar that provides contextual suggestions and universal search across the entire application.

**QBO Current State:** Search functionality is scoped per view. No universal search component exists. Filtering in the escalation dashboard is done through view-specific controls.

**Proposed Change:** Add a search input to the sidebar header (above the navigation) that searches across escalations, templates, playbook entries, and INV cases. Implement the MD3 expanding behavior: collapsed to an icon in the collapsed sidebar, expanding to a full search field with results dropdown when activated. Use `--ease-m3-emphasized-decel` at 400ms for the expansion animation.

**Why it matters:** Escalation specialists frequently need to find a previous case, a template, or a playbook entry during a live call. A universal search saves the 3-5 seconds of navigating to the correct view first, which multiplies across dozens of calls per shift.

### Recommendation 8: Chips for Dashboard Filtering

**MD3 Pattern:** Filter chips are compact, toggleable elements that allow multi-select filtering with visible selection state (checkmark icon, tinted background).

**QBO Current State:** Category badges in the escalation dashboard (`.cat-*` classes, `App.css` lines 107-134) are display-only -- they show the category but are not interactive filters.

**Proposed Change:** Convert category badges to filter chips in the dashboard header. Each chip:
- Default: outlined, `--line` border, `--ink-secondary` text
- Selected: filled, `--cat-{name}-bg` background, `--cat-{name}-text` text, checkmark icon
- Multiple chips can be selected simultaneously
- "Clear all" chip at the end of the row

**Why it matters:** The escalation dashboard is the primary view for case triage. Category filtering through direct manipulation (clicking chips) is faster than dropdown menus and shows the current filter state at a glance.

### Recommendation 9: Container Transform for Escalation Detail

**MD3 Pattern:** Shared-element transition where a card morphs into its detail view. The card's position, size, and shape animate to become the detail panel.

**QBO Current State:** Escalation detail (`EscalationDashboard.css`) uses a two-column grid layout (`.esc-detail-columns`). Navigation from list to detail is a view switch without spatial continuity.

**Proposed Change:** When an escalation card is clicked in the list view, animate its position and size to become the detail header, then expand the detail content below. Use Framer Motion's `layoutId` for shared-element transitions with `type: "spring"` and `duration: 0.4`. This maintains the card's identity through the transition.

**Why it matters:** Spatial continuity reduces cognitive load. When a specialist clicks an escalation and the detail appears with a transform from the card, the mental model of "I'm looking at the details of that specific card" is reinforced visually, not just logically.

### Recommendation 10: Side Sheet for Copilot Panel

**MD3 Pattern:** Side sheets slide in from the trailing edge, showing contextual content while maintaining the parent view's visibility.

**QBO Current State:** The copilot panel (`CopilotPanel.css`) and right sidebar (`RightSidebar.jsx`) occupy persistent space or overlay content.

**Proposed Change:** Implement the copilot panel as an MD3-style side sheet that:
- Slides in from the right with Emphasized Decelerate easing at 350ms
- Uses Surface Container High background for tonal elevation
- Has a drag handle for resizing
- Can be dismissed by swiping/dragging right or pressing Escape
- Pushes main content left rather than overlaying

**Why it matters:** The copilot panel provides AI suggestions during case resolution. A side sheet that pushes content (instead of overlaying) lets the specialist reference both the case details and the AI suggestions simultaneously without losing context.

### Recommendation 11: State Color Opacity System for Status

**MD3 Pattern:** MD3 uses fixed opacity levels with accent colors for state communication: 8% for hover, 12% for container emphasis, 16% for dragged state.

**QBO Current State:** Status backgrounds (lines 82-99 in `App.css`) use manually specified hex values: `--status-open-bg: #fdf4de`, `--status-progress-bg: #f5ebe0`, etc. These are well-chosen but don't scale systematically.

**Proposed Change:** Generate status backgrounds using `color-mix()` with the status color at a fixed opacity:
```css
--status-open-bg: color-mix(in srgb, var(--warning) 12%, var(--bg));
--status-progress-bg: color-mix(in srgb, var(--accent) 12%, var(--bg));
--status-resolved-bg: color-mix(in srgb, var(--success) 12%, var(--bg));
--status-escalated-bg: color-mix(in srgb, var(--danger) 12%, var(--bg));
```

**Why it matters:** This approach automatically adapts status backgrounds to any theme or dark mode -- the 12% mix with the current `--bg` always produces the correct tint. When new themes are added (like the Arctic Aurora or Apple themes in `useTheme.js`), status backgrounds would inherit correctly without manual specification.

### Recommendation 12: Semantic Elevation Levels

**MD3 Pattern:** MD3 defines five elevation levels (0-5) with specific shadow + tonal overlay combinations per level.

**QBO Current State:** Shadows are defined as `--shadow-sm/md/lg/xl` in `App.css` (lines 165-168) with dark mode overrides (lines 290-293). No formal elevation level mapping exists -- components choose a shadow size individually.

**Proposed Change:** Define elevation levels that combine shadow and tonal shift:
```css
--elevation-0: none;                    /* Flat, surface background */
--elevation-1: var(--shadow-sm);        /* Cards at rest */
--elevation-2: var(--shadow-md);        /* Cards on hover, menus */
--elevation-3: var(--shadow-lg);        /* Drawers, side sheets */
--elevation-4: var(--shadow-xl);        /* Modals, dialogs */
```
In dark mode, each elevation level also increases the surface tone.

**Why it matters:** Named elevation levels prevent inconsistency. Instead of one developer using `--shadow-md` and another using `--shadow-lg` for the same conceptual layer, both reach for `--elevation-2` for a "floating card."

---

## What NOT to Copy

### 1. Purple Color Temperature

MD3's baseline purple (#6750A4) communicates "tech/creative" -- entirely wrong for a financial support tool. More importantly, the cool purple tint on all surfaces (Surface = #FEF7FF has a distinct purple cast) would conflict with QBO's warm authority identity. The *method* of tonal derivation is valuable; the *temperature* is not.

### 2. Consumer-Grade Animation Volume

M3 Expressive's spring animations, morphing FABs, and container transforms are designed to create "moments of delight" for consumers checking their phones 100+ times a day. In a professional tool used for 8+ hour shifts, animation volume causes fatigue. MD3's 700-1000ms "Extra Long" durations would be unbearably slow for an escalation specialist navigating between cases rapidly. Adopt the easing curves, ignore the duration ceiling.

### 3. Dynamic Color / Wallpaper Theming

Dynamic color (extracting palette from wallpaper) is MD3's signature feature, but it's counterproductive for a professional tool. Escalation specialists need a stable, predictable interface. If every workstation's colors shift based on the wallpaper, institutional knowledge about "click the amber button" breaks. The theming infrastructure (seed-to-palette generation) is interesting but the *automatic* derivation should be replaced by *deliberate* theme selection (which QBO already supports via `useTheme.js`).

### 4. Touch-First Sizing

MD3's minimum 48dp touch targets and generous padding are designed for thumb interaction. QBO is a keyboard-and-mouse desktop tool where density matters. MD3's spacing between list items (12dp padding + 48dp height = 60dp per row) would reduce the visible escalation count in the dashboard from ~12 to ~8 at the same viewport height. Do not adopt MD3 touch sizing for desktop.

### 5. Rounded Shape Extremes

MD3 Extra Large radius (28dp) and the shape morphing in M3 Expressive create a playful, bubbly aesthetic. QBO's maximum radius of 20px (`--radius-2xl`) is already generous for a professional tool. Going higher risks looking unserious in a context where financial accuracy matters.

### 6. Three-Accent-Color System

MD3 uses Primary, Secondary, and Tertiary accent colors to create visual variety. In a professional tool, one accent color with semantic variants (success, warning, danger) is clearer. Adding a secondary and tertiary accent introduces visual complexity that escalation specialists don't need -- they need to instantly distinguish between "action required" (accent), "resolved" (success), "problem" (danger), and "warning" states. Two or three accent colors would blur these distinctions.

### 7. Elevation-Only Dark Mode (No Shadows)

MD3's approach of eliminating shadows entirely in dark mode and relying only on tonal elevation is elegant but insufficient for complex desktop layouts. When multiple cards are stacked or overlapping (modal over side panel over main content), tonal elevation alone can't communicate three or four depth layers convincingly. QBO's approach of using *both* heavy dark shadows and surface tone differences is more robust for its layout complexity.

### 8. Component-Level Token Granularity

MD3's three-tier token system (reference > system > component) generates hundreds of tokens for full coverage. For a single-application codebase like QBO (not a multi-product design system), this level of indirection adds complexity without proportional benefit. QBO's flat semantic token system (`--accent`, `--bg-raised`, etc.) is the correct granularity for one app.

---

## Implementation Priority

### Tier 1: Quick Wins (< 1 day)

| Item | Description | Effort | Files |
|------|-------------|--------|-------|
| State layer utility | CSS class for consistent hover/focus/pressed feedback | 2 hours | `design-system-v2.css` |
| Shape aliases | Semantic `--shape-*` tokens mapping to existing `--radius-*` | 30 min | `App.css` |
| Elevation levels | Named `--elevation-0` through `--elevation-4` mapping to shadows | 30 min | `App.css` |
| Status bg via color-mix | Replace hardcoded status backgrounds with `color-mix()` | 1 hour | `App.css`, `useTheme.js` |
| Fifth surface level | Add `--bg-elevated` token for top-level surfaces | 30 min | `App.css` |

### Tier 2: Medium (1-3 days)

| Item | Description | Effort | Files |
|------|-------------|--------|-------|
| Container color tokens | Add `--accent-container`, `--secondary-container` etc. | 1 day | `App.css`, `useTheme.js`, component CSS |
| Dark mode tonal elevation | Lighten card backgrounds per elevation level in dark mode | 1 day | `App.css`, component CSS |
| Icon fill toggle | Implement outlined/filled icon states for sidebar nav | 1 day | `Sidebar.jsx`, `Sidebar.css` |
| Filter chips | Interactive category chips in dashboard header | 2 days | `EscalationDashboard.jsx/css` |

### Tier 3: Larger (3-7 days)

| Item | Description | Effort | Files |
|------|-------------|--------|-------|
| Universal search | Cross-view search bar with expanding behavior | 4 days | New component, `Sidebar.jsx` |
| Side sheet copilot | MD3-style slide-in panel with push behavior | 3 days | `CopilotPanel.jsx/css`, `App.jsx` |
| Container transform | Shared-element transition for escalation list-to-detail | 5 days | `EscalationDashboard.jsx`, Framer Motion |

### Tier 4: Strategic / Future

| Item | Description | Rationale |
|------|-------------|-----------|
| Tonal palette generation | Derive entire surface palette from accent seed color | Enables effortless theme creation -- any accent color generates a full, harmonious palette |
| Material Symbols adoption | Replace inline SVGs with variable icon font | Bundle size reduction, consistent icon language, fill/weight/grade customization |
| HCT-based theme engine | Port `material-color-utilities` to generate QBO themes | Would automate what is currently manual color specification in `useTheme.js` |

---

## CSS Custom Property Definitions

```css
/* ============================================================
   Material Design 3 Theme — QBO Adaptation
   Warm-shifted M3 tokens for the QBO Escalation Assistant.
   Based on MD3 baseline with ember-amber primary key color.
   ============================================================ */

:root[data-theme="material-design-3"] {
  /* ----- Surfaces — warm-tinted M3 container hierarchy ----- */
  --bg: #f7f3ee;                    /* Surface — Tone 95, warm neutral */
  --bg-raised: #fdfaf6;            /* Surface Container Low — Tone 98 */
  --bg-sunken: #ede9e3;            /* Surface Container Lowest — Tone 92 */
  --bg-sidebar: #f3efe9;           /* Surface Container — Tone 94 */
  --bg-elevated: #ffffff;          /* Surface Container High — Tone 100 */

  /* ----- Text — warm on-surface tones ----- */
  --ink: #1d1b16;                  /* On Surface — Tone 10 */
  --ink-secondary: #4a4740;        /* On Surface Variant — Tone 30 */
  --ink-tertiary: #7c7870;         /* Outline — Tone 50 */

  /* ----- Borders — outline tokens ----- */
  --line: #c8c4bc;                 /* Outline Variant — Tone 80 */
  --line-subtle: #ddd9d2;          /* Surface Container Highest border — Tone 87 */

  /* ----- Accent — ember amber as M3 primary ----- */
  --accent: #9c5a1a;              /* Primary — Tone 35, warm amber */
  --accent-hover: #7c4710;        /* Primary pressed — Tone 28 */
  --accent-subtle: #fceee0;       /* Primary Container — Tone 95 */
  --accent-muted: #e8c8a4;        /* Primary Fixed Dim — Tone 80 */

  /* ----- Container tokens (M3 specific) ----- */
  --accent-container: #fceee0;     /* Primary Container */
  --accent-on-container: #3a1e00;  /* On Primary Container */
  --secondary-container: #ede5d8;  /* Secondary Container */
  --secondary-on-container: #2e2518; /* On Secondary Container */
  --tertiary-container: #dceee4;   /* Tertiary Container */
  --tertiary-on-container: #0e2e1a; /* On Tertiary Container */

  /* ----- Semantic ----- */
  --success: #2e7d52;              /* Custom — no M3 equivalent */
  --success-subtle: #dceee4;
  --warning: #8a6508;              /* Custom — maps to tertiary role */
  --warning-subtle: #fdf4de;
  --danger: #ba1a1a;               /* Error — M3 baseline error */
  --danger-subtle: #ffdad6;        /* Error Container */
  --info: #9c5a1a;                 /* Uses primary */

  /* ----- Elevation (shadow + tonal) ----- */
  --elevation-0: none;
  --elevation-1: 0 1px 2px rgba(29, 27, 22, 0.06), 0 1px 3px rgba(29, 27, 22, 0.1);
  --elevation-2: 0 1px 2px rgba(29, 27, 22, 0.04), 0 4px 8px rgba(29, 27, 22, 0.06), 0 8px 16px rgba(29, 27, 22, 0.04);
  --elevation-3: 0 2px 4px rgba(29, 27, 22, 0.04), 0 8px 16px rgba(29, 27, 22, 0.06), 0 16px 48px rgba(29, 27, 22, 0.1);
  --elevation-4: 0 4px 8px rgba(29, 27, 22, 0.04), 0 12px 24px rgba(29, 27, 22, 0.08), 0 24px 64px rgba(29, 27, 22, 0.12);

  /* ----- Shadows (backwards compatible) ----- */
  --shadow-sm: var(--elevation-1);
  --shadow-md: var(--elevation-2);
  --shadow-lg: var(--elevation-3);
  --shadow-xl: var(--elevation-4);
  --shadow-focus: 0 0 0 2px var(--accent-subtle), 0 0 0 4px var(--accent);

  /* ----- Shape (M3 scale aliases) ----- */
  --shape-none: 0;
  --shape-xs: 4px;                 /* Extra Small — chips, badges */
  --shape-sm: 8px;                 /* Small — buttons, inputs */
  --shape-md: 12px;                /* Medium — cards */
  --shape-lg: 16px;                /* Large — FAB, drawers */
  --shape-xl: 28px;                /* Extra Large — bottom sheets */
  --shape-full: 9999px;            /* Full — avatars, pills */

  /* ----- State layer opacities ----- */
  --state-hover: 0.08;
  --state-focus: 0.10;
  --state-pressed: 0.10;
  --state-dragged: 0.16;
}

:root[data-theme="material-design-3"][data-mode="dark"] {
  /* ----- Surfaces — dark warm tonal hierarchy ----- */
  --bg: #16140f;                    /* Surface — Tone 6, warm dark */
  --bg-raised: #211e18;            /* Surface Container Low — Tone 10 */
  --bg-sunken: #0f0d09;            /* Surface Container Lowest — Tone 4 */
  --bg-sidebar: #1c1914;           /* Surface Container — Tone 8 */
  --bg-elevated: #2c2820;          /* Surface Container High — Tone 17 */

  /* ----- Text — warm light tones ----- */
  --ink: #ece6db;                  /* On Surface — Tone 90 */
  --ink-secondary: #cac4b8;        /* On Surface Variant — Tone 80 */
  --ink-tertiary: #8e887c;         /* Outline — Tone 60 */

  /* ----- Borders ----- */
  --line: #4a4540;                 /* Outline Variant — Tone 30 */
  --line-subtle: #38342e;          /* Surface Container Highest border — Tone 22 */

  /* ----- Accent — lighter ember for dark backgrounds ----- */
  --accent: #f0a850;              /* Primary — Tone 70, lifted for dark bg */
  --accent-hover: #f8c080;        /* Primary hover — Tone 80 */
  --accent-subtle: #2e1e0a;       /* Primary Container — Tone 10 */
  --accent-muted: #5a3e1a;        /* Primary Fixed Dim — Tone 25 */

  /* ----- Container tokens (dark) ----- */
  --accent-container: #5a3e1a;     /* Primary Container dark */
  --accent-on-container: #fceee0;  /* On Primary Container dark */
  --secondary-container: #3e382c;  /* Secondary Container dark */
  --secondary-on-container: #ede5d8; /* On Secondary Container dark */
  --tertiary-container: #1e3828;   /* Tertiary Container dark */
  --tertiary-on-container: #dceee4; /* On Tertiary Container dark */

  /* ----- Semantic ----- */
  --success: #6ec48a;
  --success-subtle: #1e3828;
  --warning: #daa520;
  --warning-subtle: #2e2810;
  --danger: #ffb4ab;               /* Error dark — M3 Tone 80 */
  --danger-subtle: #93000a;        /* Error Container dark */
  --info: #f0a850;

  /* ----- Elevation (dark: reduced shadows, tonal lift) ----- */
  --elevation-0: none;
  --elevation-1: 0 0 0 1px rgba(255, 255, 255, 0.05);
  --elevation-2: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.3);
  --elevation-3: 0 0 0 1px rgba(255, 255, 255, 0.07), 0 4px 16px rgba(0, 0, 0, 0.4);
  --elevation-4: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 32px rgba(0, 0, 0, 0.5);

  --shadow-sm: var(--elevation-1);
  --shadow-md: var(--elevation-2);
  --shadow-lg: var(--elevation-3);
  --shadow-xl: var(--elevation-4);
  --shadow-focus: 0 0 0 2px var(--accent-subtle), 0 0 0 4px var(--accent);
}
```

---

## Sources

### Official Documentation

- [Material Design 3 -- Overview](https://m3.material.io/)
- [M3 Color System Overview](https://m3.material.io/styles/color/overview)
- [M3 Color Roles](https://m3.material.io/styles/color/roles)
- [M3 How the Color System Works](https://m3.material.io/styles/color/system/how-the-system-works)
- [M3 Dynamic Color](https://m3.material.io/styles/color/dynamic/user-generated-source)
- [M3 Static Color / Choosing a Scheme](https://m3.material.io/styles/color/choosing-a-scheme)
- [M3 Advanced Color Customizations](https://m3.material.io/styles/color/advanced/adjust-existing-colors)
- [M3 Typography Overview](https://m3.material.io/styles/typography/overview)
- [M3 Applying Typography](https://m3.material.io/styles/typography/applying-type)
- [M3 Shape / Corner Radius Scale](https://m3.material.io/styles/shape/corner-radius-scale)
- [M3 Shape Overview](https://m3.material.io/styles/shape/overview-principles)
- [M3 Motion Overview](https://m3.material.io/styles/motion/overview/specs)
- [M3 Easing and Duration](https://m3.material.io/styles/motion/easing-and-duration)
- [M3 Easing and Duration Tokens/Specs](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- [M3 Transitions](https://m3.material.io/styles/motion/transitions)
- [M3 Icons](https://m3.material.io/styles/icons)
- [M3 Elevation / Applying Elevation](https://m3.material.io/styles/elevation/applying-elevation)
- [M3 Design Tokens](https://m3.material.io/foundations/design-tokens)
- [M3 Layout / Understanding Layout](https://m3.material.io/foundations/layout/understanding-layout/parts-of-layout)
- [M3 Layout / Applying Layout](https://m3.material.io/foundations/layout/applying-layout)
- [M3 Canonical Layouts](https://m3.material.io/foundations/layout/canonical-layouts/overview)
- [M3 Accessibility Overview](https://m3.material.io/foundations/overview/assistive-technology)
- [M3 Accessibility Designing](https://m3.material.io/foundations/designing)
- [M3 Navigation Rail](https://m3.material.io/components/navigation-rail/guidelines)
- [M3 Navigation Drawer](https://m3.material.io/components/navigation-drawer/guidelines)
- [M3 Navigation Bar](https://m3.material.io/components/navigation-bar/guidelines)
- [M3 Lists](https://m3.material.io/components/lists/overview)
- [M3 Usability / M3 Expressive](https://m3.material.io/foundations/usability/applying-m-3-expressive)

### Blog Posts and Announcements

- [Google Blog -- Material 3 Expressive Launch](https://blog.google/products-and-platforms/platforms/android/material-3-expressive-android-wearos-launch/)
- [M3 Blog -- Introducing Material Symbols](https://m3.material.io/blog/introducing-symbols/)
- [M3 Blog -- Roboto Flex on Google Fonts](https://m3.material.io/blog/roboto-flex)
- [M3 Blog -- Tone-based Surface Color in M3](https://m3.material.io/blog/tone-based-surface-color-m3/)
- [M3 Blog -- The Science of Color and Design](https://m3.material.io/blog/science-of-color-design)
- [M3 Blog -- Start Building with Material You](https://m3.material.io/blog/start-building-with-material-you)
- [M3 Blog -- Design a Material Typography Theme](https://m3.material.io/blog/design-material-theme-type)
- [M3 Blog -- Craft a Dark Theme with Material Design 3](https://m3.material.io/blog/dark-theme-design-tutorial-video)
- [M3 Blog -- Building with M3 Expressive](https://m3.material.io/blog/building-with-m3-expressive)

### GitHub Repositories

- [material-components-android -- Color Documentation](https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md)
- [material-foundation/material-color-utilities](https://github.com/material-foundation/material-color-utilities) -- HCT color space implementation
- [material-foundation/material-theme-builder](https://github.com/material-foundation/material-theme-builder) -- Theme generation tool
- [Material Symbols on Google Fonts](https://fonts.google.com/icons)

### Developer Documentation

- [Material Design 3 in Jetpack Compose](https://developer.android.com/develop/ui/compose/designsystems/material3)
- [Theming in Compose with Material 3 (Codelab)](https://developer.android.com/codelabs/jetpack-compose-theming)
- [Create an Accessible and Personalized Theme (Codelab)](https://developer.android.com/codelabs/m3-design-theming)
- [Design an Adaptive Layout with Material Design](https://developer.android.com/codelabs/adaptive-material-guidance)
- [Material Web -- Typography](https://material-web.dev/theming/typography/)

### Community Analysis

- [Material 3 Typography Cheatsheet (Medium)](https://medium.com/@vosarat1995/material-3-you-typography-cheatsheet-ffc58c540181)
- [Android Material Design Font Size Guidelines (Learn UI)](https://www.learnui.design/blog/android-material-design-font-size-guidelines.html)
- [Anvil Docs -- Custom Material Design 3 Colour Schemes](https://anvil.works/docs/how-to/creating-material-3-colour-scheme)
- [Customizing Material Color (Codelab)](https://codelabs.developers.google.com/customizing-material-color)
- [SurfaceContainer Variants in Jetpack Compose (Vainigli)](https://www.lorenzovainigli.com/blog/jetpack-compose-material3-surfacecontainer-variants/)
