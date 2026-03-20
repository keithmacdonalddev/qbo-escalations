# Apple Human Interface Guidelines (HIG) — Design System Analysis & Application to QBO Escalation Tool

*Design research report — 2026-03-20*
*Prepared for the QBO Escalation Assistant project*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Philosophy](#2-design-philosophy)
3. [Key Design Patterns](#3-key-design-patterns)
4. [Color System](#4-color-system)
5. [Typography and Spacing](#5-typography-and-spacing)
6. [Animation and Motion](#6-animation-and-motion)
7. [Iconography](#7-iconography)
8. [Accessibility](#8-accessibility)
9. [Dark Mode](#9-dark-mode)
10. [Responsive Design](#10-responsive-design)
11. [QBO Escalation App Mapping](#11-qbo-escalation-app-mapping)
12. [What NOT to Copy](#12-what-not-to-copy)
13. [Implementation Priority](#13-implementation-priority)
14. [CSS Custom Property Definitions](#14-css-custom-property-definitions)
15. [Sources](#15-sources)

---

## 1. Executive Summary

Apple's Human Interface Guidelines represent the most opinionated, longest-running design system in consumer technology. Its single-sentence philosophy: **technology should feel like a natural extension of the user, not a barrier between them and their task.** This manifests as interfaces that prioritize clarity (clear visual hierarchy, readable typography), deference (content over chrome, the UI recedes so data shines), and depth (layered translucent surfaces that communicate spatial relationships).

The three highest-value ideas the QBO app should steal:

1. **The semantic color system.** Apple's approach where colors have roles (systemBlue for interactive, systemRed for destructive, systemGreen for success) and automatically adapt between light/dark mode is architecturally superior to hard-coded hex pairs. The QBO app already uses CSS custom properties with dark-mode overrides — adopting Apple's role-based naming would make the system more maintainable and enable future theme variants with zero component changes.

2. **The vibrancy/materials system.** Apple's layered translucent surfaces (thin material, regular material, thick material, ultra-thin material) create spatial hierarchy through blur and luminance rather than just shadow stacking. The QBO sidebar already uses `backdrop-filter: blur(16px)` — extending this into a formal materials system would replace the current ad-hoc multi-layer shadow approach with something more systematic.

3. **Spring-based animation as the default.** Apple deprecated duration-based animation in favor of spring physics (defined by mass, stiffness, damping) because springs handle interruption gracefully — if a user triggers a new animation before the current one completes, springs smoothly redirect rather than snapping. The QBO app already uses Framer Motion springs but still has many CSS transitions with fixed durations. Migrating high-frequency interactions (sidebar toggle, panel open/close, status changes) to springs would feel more fluid.

The QBO app's "Warm Authority" identity shares philosophical DNA with Apple's approach — both prioritize readability during extended use, both use warm-shifted neutrals, and both value restraint. The gap is in **systematic rigor**: Apple enforces its principles through a token architecture that makes violations structurally impossible, while the QBO app relies on convention.

---

## 2. Design Philosophy

### 2.1 The Three Pillars: Clarity, Deference, Depth

Apple's design philosophy, articulated during the iOS 7 redesign and reinforced through every subsequent release, rests on three pillars documented in the official HIG:

**Clarity** means the interface communicates its purpose and function through visual hierarchy alone. Text is legible at every size. Icons are precise and meaningful. Adornments are subtle and purposeful. Nothing decorative competes with content. In practice: Apple uses a strict typographic scale (Large Title 34pt through Caption 2 at 11pt) where every text element has exactly one correct style. There is no ambiguity about which style to use — the HIG prescribes it per context.

**Deference** means the interface helps users understand and interact with content but never competes with it. Translucent backgrounds, minimal chrome, and full-screen content views create an experience where user data (photos, messages, documents) is the visual protagonist. The UI wraps around content in translucent layers, providing structure without demanding attention.

**Depth** means the interface uses realistic motion, layered surfaces, and spatial relationships to communicate hierarchy. Sheets slide up from below. Popovers point to their trigger. Cards lift with shadows proportional to their elevation. The layered translucency system (vibrancy) creates literal visual depth — you can see content behind the current surface, which maintains spatial orientation.

### 2.2 The Liquid Glass Evolution (2025)

In 2025, Apple introduced **Liquid Glass**, its most significant visual overhaul since iOS 7. Liquid Glass extends the translucency philosophy into a fully fluid design language where UI elements appear to be made of semi-transparent, refractive glass that responds to the content beneath it. This introduced bolder, left-aligned typography, concentricity (circular forms echoing hardware), and a unified rhythm between software and hardware design across all platforms.

### 2.3 User-Centric Philosophy

Apple designs for the user who does not want to think about the interface. Every control should be self-explanatory. Every navigation path should be reversible. Every destructive action should be confirmable. This maps directly to the QBO escalation specialist who needs to resolve cases without fighting the tool — the interface should accelerate their workflow, never slow it down.

### 2.4 Dark Mode as First-Class

Apple treats dark mode as equal to light mode. Since iOS 13, semantic colors automatically adapt between modes. The dark mode is not an inverted light mode — backgrounds use a near-black (#000000) for OLED true-black power savings, with elevated surfaces at distinct gray levels (#1C1C1E, #2C2C2E, #3A3A3C). Accent colors shift to brighter variants to maintain contrast against dark surfaces.

### 2.5 Content vs. Chrome

Apple aggressively minimizes chrome. Navigation bars are translucent. Tab bars use thin separators. Toolbars blend with content. The principle: if removing a UI element does not reduce comprehension, remove it. This contrasts with the QBO app's current approach of multi-layer shadows, gradient backgrounds, and backdrop-blur on the sidebar — all of which add visual weight that Apple would consider excessive for a productivity tool.

---

## 3. Key Design Patterns

### 3.1 Tab Bar Navigation (Bottom)

Apple's primary navigation pattern is the bottom tab bar — 5 items maximum, each with an icon and label. The active tab is highlighted with the system accent color (default: systemBlue #007AFF). The tab bar is translucent with a vibrancy effect, showing a blurred version of the content scrolling beneath it.

**QBO application:** The QBO sidebar serves the same function but is positioned on the left (appropriate for desktop). The Apple insight to adopt is the strict limit on primary navigation items — the QBO sidebar has 10+ items. Grouping into primary (Chat, Dashboard, Investigations) and secondary (collapsed behind "More") would reduce cognitive load.

### 3.2 Navigation Bar with Large Titles

iOS navigation bars use a "large title" (34pt, bold) that collapses to a standard-size title (17pt, semibold) as the user scrolls. This creates a clear page identity when arriving at a view, then gracefully reduces to maximize content space during scrolling.

**QBO application:** The current page headers in the QBO app are static. Adopting the collapsing-title pattern for the Dashboard and Investigation views would recover vertical space during scrolling while maintaining clear context.

### 3.3 Sheets and Modal Presentations

Apple uses bottom-up sheets for secondary tasks. Sheets can be half-height (detent at medium) or full-height, with a drag indicator at the top. This keeps the parent context partially visible, maintaining spatial orientation.

**QBO application:** The escalation detail view currently navigates to a full page. A sheet-style slide-up panel from the bottom (or slide-in from the right on desktop) would keep the dashboard visible, enabling rapid triage without full context switches.

### 3.4 Contextual Menus (Long Press / Right Click)

iOS contextual menus appear on long-press (touch) or right-click (mouse). They show a blurred preview of the target item with a list of contextual actions. Actions are grouped with separators. Destructive actions are red and positioned last.

**QBO application:** Adding right-click context menus to escalation cards (Open, Copy Case ID, Change Status, Mark Resolved), chat messages (Copy, Retry, Quote), and sidebar items (Rename, Delete, Pin) would accelerate keyboard/mouse workflows.

### 3.5 Search with Suggestions

Apple's search pattern: a search bar with scope tabs (e.g., "All", "Photos", "Documents"), suggestion chips that appear as the user types, and categorized results. Search bars can be placed in the navigation bar and revealed on pull-down.

**QBO application:** The app lacks a global search. A Ctrl+K command palette with scope tabs (Escalations, INV Cases, Chat, Playbook) following Apple's search-with-suggestions pattern would be the highest-impact navigation improvement.

### 3.6 Sidebar Navigation (iPadOS/macOS)

On iPad and Mac, Apple uses a three-column layout: sidebar (navigation), list (items), and detail (selected item). The sidebar collapses on narrow widths. Active items have a rounded-rect highlight with the accent color at reduced opacity.

**QBO application:** The QBO app already follows this pattern. The refinement is the active-item styling — Apple uses a rounded rectangle fill with ~12% accent opacity, not a full sidebar indicator bar. This is subtler and scales better when many items are visible.

### 3.7 Pull to Refresh

A standard iOS pattern where pulling down on a scrollable list triggers a refresh. The refresh indicator is a spinning activity indicator that disappears when loading completes.

**QBO application:** Adding pull-to-refresh to the Dashboard escalation list and Gmail inbox would match platform expectations for data refresh.

---

## 4. Color System

### 4.1 Complete Palette with Hex Values

**System Tint Colors (Light / Dark):**

| Token | Light Hex | Dark Hex | Usage |
|-------|-----------|----------|-------|
| systemBlue | #007AFF | #0A84FF | Interactive elements, links, primary buttons |
| systemGreen | #34C759 | #30D158 | Success states, positive indicators |
| systemIndigo | #5856D6 | #5E5CE6 | Alternative accent, branding |
| systemOrange | #FF9500 | #FF9F0A | Warnings, attention, notifications |
| systemPink | #FF2D55 | #FF375F | Badges, favorites, highlights |
| systemPurple | #AF52DE | #BF5AF2 | Creative tools, secondary accent |
| systemRed | #FF3B30 | #FF453A | Destructive actions, errors, alerts |
| systemTeal | #5AC8FA | #64D2FF | Informational, secondary |
| systemYellow | #FFCC00 | #FFD60A | Starred items, caution |
| systemMint | #00C7BE | #63E6E2 | Fresh indicators |
| systemCyan | #32ADE6 | #64D2FF | Links, informational |
| systemBrown | #A2845E | #AC8E68 | Earth tones, natural |

**Semantic Background Colors:**

| Token | Light Hex | Dark Hex | Usage |
|-------|-----------|----------|-------|
| systemBackground | #FFFFFF | #000000 | Primary background |
| secondarySystemBackground | #F2F2F7 | #1C1C1E | Grouped content, cards |
| tertiarySystemBackground | #FFFFFF | #2C2C2E | Elevated cards within groups |
| systemGroupedBackground | #F2F2F7 | #000000 | Grouped table background |
| secondarySystemGroupedBackground | #FFFFFF | #1C1C1E | Grouped table cells |

**Semantic Text Colors:**

| Token | Light Hex | Dark Hex | Usage |
|-------|-----------|----------|-------|
| label | #000000 | #FFFFFF | Primary text |
| secondaryLabel | #3C3C43 (60% opacity) | #EBEBF5 (60% opacity) | Secondary text |
| tertiaryLabel | #3C3C43 (30% opacity) | #EBEBF5 (30% opacity) | Tertiary text, placeholders |
| quaternaryLabel | #3C3C43 (18% opacity) | #EBEBF5 (18% opacity) | Disabled text |

**Separator and Fill Colors:**

| Token | Light Hex | Dark Hex | Usage |
|-------|-----------|----------|-------|
| separator | #3C3C43 (29% opacity) | #545458 (60% opacity) | Thin dividers |
| opaqueSeparator | #C6C6C8 | #38383A | Opaque dividers |
| systemFill | #787880 (20% opacity) | #787880 (36% opacity) | Thin fills |
| secondarySystemFill | #787880 (16% opacity) | #787880 (32% opacity) | Secondary fills |
| tertiarySystemFill | #767680 (12% opacity) | #767680 (24% opacity) | Tertiary fills |

### 4.2 Surface Hierarchy

| Level | Light Hex | Dark Hex | Usage |
|-------|-----------|----------|-------|
| Deepest (Base) | #F2F2F7 | #000000 | Page background (grouped) |
| Base | #FFFFFF | #000000 | Content background |
| Raised (Secondary) | #F2F2F7 | #1C1C1E | Cards, grouped sections |
| Elevated (Tertiary) | #FFFFFF | #2C2C2E | Elevated cards, sheets |
| Floating | Translucent + blur | Translucent + blur | Popovers, menus, overlays |

### 4.3 Color Architecture

Apple uses a **two-tier semantic system**:

1. **System colors** (systemBlue, systemRed, etc.): Fixed-role tint colors that shift lightness between modes. Darker in light mode, brighter in dark mode for contrast.
2. **Semantic colors** (label, secondaryLabel, systemBackground, separator): Role-based tokens that completely change value between modes.

Token naming convention: `UIColor.{role}` in UIKit, `Color.{role}` in SwiftUI. No numeric scales — pure semantic naming.

Themes are implemented through trait collections (UITraitCollection) that cascade through the view hierarchy. The system resolves the correct color value at render time based on the current appearance (light/dark), accessibility settings (high contrast, increased contrast), and elevation level.

Apple uses standard sRGB color space for most UI colors but supports Display P3 for content-rich contexts (photos, video).

### 4.4 Comparison with QBO App

| Concept | Apple HIG | QBO App | Analysis |
|---------|-----------|---------|----------|
| Background | #FFFFFF / #000000 | #f5f2ed / #141210 | QBO warmer — better for 8hr shifts |
| Text Primary | #000000 / #FFFFFF | #2a2420 / #e8dfd5 | QBO avoids pure black/white — reduces harshness |
| Accent | #007AFF (systemBlue) | #c76a22 (ember amber) | Different temperatures. Both valid. |
| Success | #34C759 / #30D158 | #2E7D52 | Apple brighter, QBO more muted — QBO suits long use |
| Warning | #FF9500 / #FF9F0A | #B8860B | Apple more saturated |
| Danger | #FF3B30 / #FF453A | #b33025 | Apple brighter, QBO deeper |
| Info | #007AFF (reuses accent) | Uses accent | Same pattern |
| Sidebar | Translucent + blur | #f8f6f2 / #1a1714 | Apple uses vibrancy; QBO uses solid + blur |

Apple's pure white/black backgrounds are too harsh for 8-hour support shifts. The QBO warm neutrals are a better choice. However, Apple's semantic token naming and automatic dark-mode adaptation is architecturally superior.

---

## 5. Typography and Spacing

### 5.1 Typography

Apple uses the **San Francisco** typeface family:

- **SF Pro Display** — for sizes 20pt and above (headings, titles)
- **SF Pro Text** — for sizes below 20pt (body, captions)
- **SF Pro Rounded** — rounded variant for friendly contexts
- **SF Mono** — monospace for code and data

The typeface is variable-weight (100-900) and includes optical sizing — letterforms automatically adjust for the current point size.

| Level | Font | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|------|--------|-------------|----------------|-------|
| Large Title | SF Pro Display | 34pt | Bold (700) | 41pt | 0.37px | Page titles |
| Title 1 | SF Pro Display | 28pt | Bold (700) | 34pt | 0.36px | Section headers |
| Title 2 | SF Pro Display | 22pt | Bold (700) | 28pt | 0.35px | Subsection headers |
| Title 3 | SF Pro Display | 20pt | Semibold (600) | 25pt | 0.38px | Card titles |
| Headline | SF Pro Text | 17pt | Semibold (600) | 22pt | -0.41px | List headers |
| Body | SF Pro Text | 17pt | Regular (400) | 22pt | -0.43px | Primary content |
| Callout | SF Pro Text | 16pt | Regular (400) | 21pt | -0.32px | Secondary content |
| Subhead | SF Pro Text | 15pt | Regular (400) | 20pt | -0.24px | Metadata |
| Footnote | SF Pro Text | 13pt | Regular (400) | 18pt | -0.08px | Footnotes |
| Caption 1 | SF Pro Text | 12pt | Regular (400) | 16pt | 0px | Timestamps |
| Caption 2 | SF Pro Text | 11pt | Regular (400) | 13pt | 0.07px | Minimal metadata |

Note: Letter spacing becomes negative at larger sizes (tightening) and positive at smaller sizes (loosening). This optical compensation is built into the San Francisco variable font's tracking tables. The QBO app already implements this pattern with negative tracking on headings.

### 5.2 Spacing System

Apple does not publish a formal spacing scale like Material Design's 4dp/8dp grid. Instead, Apple uses **standard margins** that vary by context:

| Context | Value | Notes |
|---------|-------|-------|
| Screen edge margin | 16pt (iPhone), 20pt (iPad) | Content inset from edges |
| Cell padding (vertical) | 11pt top, 11pt bottom | Standard table row |
| Cell padding (horizontal) | 16pt leading, 16pt trailing | Standard table row |
| Section spacing | 35pt (grouped), 20pt (plain) | Between table sections |
| Inter-element gap | 8pt | Default spacing between elements |
| Icon-to-text gap | 8pt | Label and icon spacing |
| Minimum touch target | 44x44pt | WCAG and Apple minimum |

The QBO app's 4px base grid (--sp-1 through --sp-24) provides finer granularity than Apple's approach, which is appropriate for a desktop-first web tool.

### 5.3 Border Radius Scale

Apple uses **continuous corner radius** (superellipse/squircle) rather than standard circular border-radius. The continuous curve creates a smoother transition between the flat edge and the curved corner.

| Element | Radius | Notes |
|---------|--------|-------|
| App icons | ~22.37% of icon width | Superellipse with smoothing factor |
| Cards / Grouped sections | 10pt | Standard grouping radius |
| Buttons | 8-12pt | Context-dependent |
| Text fields | 6-8pt | Subtle rounding |
| Full-width elements | 0pt | Edge-to-edge content |
| Sheets | 10pt (top corners only) | Bottom-up presentation |
| Modals | 14pt | Elevated floating elements |

In CSS, the squircle effect can be approximated using Figma's 61% corner smoothing or CSS `border-radius` with a slightly larger value plus careful padding. True superellipse rendering requires SVG clip-paths or the upcoming CSS `corner-shape: squircle` property.

---

## 6. Animation and Motion

### 6.1 Motion Philosophy

Apple's motion design follows one rule: **every animation must communicate spatial relationships and state changes.** Decorative motion is explicitly discouraged. The HIG states: "Avoid gratuitous animation. People in some contexts, like business environments, may interpret unnecessary animation as frivolous or distracting."

Apple's critical innovation: **spring-based animation as the system default.** Since iOS 17 and the WWDC 2023 session "Animate with springs," Apple recommends springs for virtually all animations because they handle interruption gracefully.

### 6.2 Duration Scale

Apple does not use fixed durations in the traditional sense. Spring animations are defined by physical properties:

| Spring Preset | Duration (perceptual) | Bounce | Usage |
|---------------|----------------------|--------|-------|
| Default (smooth) | ~0.5s | 0% | Most UI transitions |
| Snappy | ~0.3s | 0% | Quick state changes |
| Bouncy | ~0.5s | 15-25% | Playful interactions |
| Interactive | ~0.15s | 0% | Drag follow, gesture response |

For legacy/CSS contexts:

| Category | Duration | Easing | Usage |
|----------|----------|--------|-------|
| Micro-interactions | 100-200ms | ease-out | Button press, toggle |
| Standard transition | 250ms | ease-in-out | View change, sheet |
| Navigation push/pop | 350ms | ease-in-out | Screen transitions |
| Sheet presentation | 400-500ms | spring(0.5s, bounce: 0) | Bottom sheets |

### 6.3 Easing Curves

Apple's recommended easing curves (pre-spring era):

- **ease-in-out**: `cubic-bezier(0.42, 0, 0.58, 1)` — standard for most transitions
- **ease-out**: `cubic-bezier(0, 0, 0.58, 1)` — for entering elements
- **ease-in**: `cubic-bezier(0.42, 0, 1, 1)` — for exiting elements

Spring parameters (SwiftUI):
- **response**: 0.5 (perceptual duration in seconds)
- **dampingFraction**: 1.0 (critically damped — no bounce), 0.7 (slight bounce), 0.5 (bouncy)
- **blendDuration**: 0.0 (instant blend with interrupted animations)

Alternative spring config (iOS 17+):
- **duration**: Perceptual duration
- **bounce**: 0 (no bounce) to 1 (maximum bounce). Negative values increase damping.

### 6.4 Specific Animation Patterns

1. **Navigation push/pop** — New view slides in from the right (350ms, spring). Previous view slides left and scales slightly (0.95).
2. **Sheet presentation** — Slides up from bottom with spring physics. Parent view scales down and dims.
3. **Contextual menu** — Blurred preview scales up from tap point with a spring bounce. Menu items fade in with slight stagger.
4. **Tab switching** — Cross-dissolve (200ms, ease-in-out). No spatial movement.
5. **Pull to refresh** — Rubber-band physics on over-scroll. Spinner appears with spring.
6. **Swipe actions** — Actions reveal with trailing spring as the cell slides.
7. **Toggle/switch** — Knob slides with spring physics (150ms, slight bounce).
8. **Keyboard appearance** — Slides up with spring matching the keyboard frame duration (~250ms).

### 6.5 Comparison with QBO

The QBO app uses Framer Motion 12 with spring physics, which is architecturally aligned with Apple's approach. The QBO `--duration-normal: 200ms` and `--ease-standard` CSS transitions are within Apple's acceptable range. The main gap: QBO hover effects (translateY lifts, shadow escalation, gradient shifts) have no Apple equivalent — Apple hover states are subtle background-color changes only. The QBO app's breathing/pulsing animations on idle elements would violate Apple's "no gratuitous animation" principle.

---

## 7. Iconography

### SF Symbols

Apple's icon system is **SF Symbols** — a library of 6,000+ symbols designed to integrate seamlessly with the San Francisco typeface.

- **Style**: Line-based (outlined), with filled variants. Four rendering modes: monochrome, hierarchical, palette, multicolor.
- **Sizes**: Three scales relative to text — small (aligned with caption text), medium (default, aligned with body text), large (aligned with title text). Actual pixel sizes depend on the accompanying text size.
- **Stroke width**: Matches the weight of the San Francisco font at the same point size. Nine weights from ultralight to black, automatically adjusting stroke thickness.
- **Color**: Inherits from the label color by default (monochrome mode). Hierarchical mode uses primary/secondary/tertiary opacity levels of a single color. Palette mode allows distinct colors per layer. Multicolor mode uses Apple's predefined semantic colors.
- **Design principles**: Symbols are designed on a grid aligned with SF Pro's cap height, x-height, and baseline. Custom symbols must match this grid for visual harmony.

The QBO app uses inline SVG icons without a formal icon system. Adopting SF Symbols' weight-matching principle — where icon stroke weight matches the font weight of adjacent text — would improve visual cohesion.

---

## 8. Accessibility

### WCAG Compliance

Apple targets WCAG 2.1 AA as a minimum, with AAA in many contexts. The semantic color system structurally enforces contrast — label on systemBackground always passes AA, secondaryLabel on systemBackground passes AA for large text.

### Color Contrast

Apple provides "Increased Contrast" accessibility mode that strengthens all semantic colors. In increased contrast mode, separator colors become more opaque, fill colors become denser, and label colors shift toward fully opaque black/white. This is built into the semantic token system — components do not need to implement increased contrast separately.

### Focus Indicators

iOS/macOS focus indicators use a blue ring (#007AFF) with 3pt width and 2pt offset. On macOS, the focus ring follows the shape of the focused element (rounded for rounded buttons, rectangular for text fields). In dark mode, the ring brightens to #0A84FF. The QBO app already implements focus-visible rings with accent color — well-aligned with Apple's pattern.

### Keyboard Navigation

macOS applications support full keyboard access (Tab, Shift+Tab, arrow keys, Space/Enter for activation, Escape for dismissal). iOS supports external keyboard navigation with the same patterns. The QBO app should adopt Tab-between-zones, arrow-keys-within-zones consistent with Apple's full keyboard access model.

### Screen Reader Support

Apple requires: all images have accessibility labels, all interactive elements have accessibility traits, all state changes are announced via VoiceOver, headings are marked for navigation. The `.sr-only` class in the QBO app maps to Apple's `accessibilityLabel` — the pattern is aligned.

### Reduced Motion

When the user enables "Reduce Motion" in iOS Settings, all animations are replaced with cross-dissolves. No spring physics, no spatial movement, no parallax. The QBO app's `prefers-reduced-motion: reduce` CSS is the web equivalent — already implemented.

### Color-Blind Considerations

Apple always pairs color with icons and text labels. Status is never communicated through color alone. SF Symbols provides distinct icon shapes for each status type (checkmark for success, exclamation for warning, X for error). The QBO status badges include text labels — aligned with this principle.

---

## 9. Dark Mode

Apple treats dark mode as a **first-class peer** of light mode, not an inversion. Key principles:

- **True black backgrounds (#000000)** on OLED devices for power savings and visual depth
- **Elevated surfaces lighten** — dark mode surfaces get lighter as they rise in the hierarchy (opposite of light mode, where elevated = white/lighter shadow)
- **Four distinct gray levels**: #000000 (base) → #1C1C1E (secondary) → #2C2C2E (tertiary) → #3A3A3C (elevated)
- **Accent colors brighten** — systemBlue shifts from #007AFF to #0A84FF for contrast against dark backgrounds
- **Semantic colors desaturate slightly** to reduce eye strain on dark backgrounds
- **Shadows are invisible** on dark backgrounds — Apple replaces shadows with subtle border separators and luminance-based elevation (lighter = higher)
- **Vibrancy materials adapt** — the blur/luminance materials shift to darker tinting

The QBO app's dark mode (#141210 warm obsidian) is warmer than Apple's neutral dark. This is a deliberate choice for extended use comfort and is correct for the QBO use case. However, the QBO dark mode could adopt Apple's elevated-surface-lightening pattern more aggressively — currently the surface levels are too close together (4-10% lightness range vs. Apple's 0-23% range).

---

## 10. Responsive Design

### Breakpoints

Apple uses **size classes** rather than pixel breakpoints:

| Size Class | Width | Height | Examples |
|------------|-------|--------|----------|
| Compact width | < 600pt | Any | iPhone portrait, iPad split |
| Regular width | ≥ 600pt | Any | iPad full, Mac |
| Compact height | Any | < 400pt | iPhone landscape |
| Regular height | Any | ≥ 400pt | Most configurations |

### Layout Adaptation

- **Compact width**: Single column, tab bar at bottom, full-width content
- **Regular width**: Sidebar navigation, split view (list + detail), multi-column layouts
- **Sidebar collapse**: On compact width, sidebar becomes a modal overlay triggered by a hamburger/back button
- **Content density**: Apple does not change density based on screen size — content spacing remains consistent

### Touch Targets

Minimum 44x44pt for all interactive elements. This maps to the QBO app's `--sp-11: 44px` and `.touch-target` utility class. Apple enforces this as a hard minimum, not a recommendation.

---

## 11. QBO Escalation App Mapping

### 1. Semantic Color Token Architecture (HIGHEST IMPACT)

**Apple pattern:** Colors are named by role (systemBlue, label, separator), not by value. The same token resolves to different hex values in light/dark mode and accessibility modes.

**QBO current state:** The app uses aesthetic tokens (`--ink`, `--bg-raised`, `--accent`) with manual dark-mode overrides in `:root` and a dark-mode class. Token names describe appearance, not function.

**Proposed change:** Add a semantic layer above the current tokens:
- `--color-interactive` → maps to `--accent`
- `--color-destructive` → maps to `--danger`
- `--color-success` → maps to `--success`
- `--color-surface-primary` → maps to `--bg`
- `--color-surface-secondary` → maps to `--bg-raised`
- `--color-text-primary` → maps to `--ink`
- `--color-text-secondary` → maps to `--ink-secondary`
- `--color-separator` → maps to `--line`

This enables future theme variants (high contrast, color-blind) by remapping the semantic layer without touching components.

**Why it matters:** When building 20+ themes, semantic tokens prevent the exponential growth of manual overrides. Each new theme only defines the semantic mappings, not individual component colors.

### 2. Materials System for Surface Hierarchy (HIGH IMPACT)

**Apple pattern:** Surfaces use translucent materials with blur and luminance effects, creating depth through transparency rather than shadow stacking.

**QBO current state:** The sidebar uses `backdrop-filter: blur(16px) saturate(1.4)` with a 4-layer box-shadow. Cards use gradient backgrounds with inset highlights. The compose card has 6 shadow layers on focus.

**Proposed change:** Define four material levels in `design-system-v2.css`:
- `--material-thin`: `backdrop-filter: blur(8px) saturate(1.2); background: color-mix(in srgb, var(--bg) 70%, transparent)`
- `--material-regular`: `backdrop-filter: blur(16px) saturate(1.3); background: color-mix(in srgb, var(--bg) 80%, transparent)`
- `--material-thick`: `backdrop-filter: blur(24px) saturate(1.4); background: color-mix(in srgb, var(--bg) 90%, transparent)`
- `--material-ultra-thin`: `backdrop-filter: blur(4px); background: color-mix(in srgb, var(--bg) 50%, transparent)`

Apply: sidebar = thick, popovers = regular, tooltips = thin, command palette = regular.

**Why it matters:** Replaces ad-hoc shadow stacking with a systematic depth model. Reduces CSS complexity in `Sidebar.css` and `Chat.css`.

### 3. Spring Animations for High-Frequency Interactions (HIGH IMPACT)

**Apple pattern:** All animations use spring physics. Springs handle interruption gracefully.

**QBO current state:** Framer Motion springs are configured but many transitions use CSS `transition: 200ms ease`. Sidebar toggle, panel open/close, and status changes use fixed durations.

**Proposed change:** In `App.jsx`, define spring presets:
```js
const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 30, mass: 1 },
  smooth: { type: "spring", stiffness: 200, damping: 25, mass: 1 },
  bouncy: { type: "spring", stiffness: 300, damping: 10, mass: 0.5 },
};
```
Migrate sidebar toggle, agent dock open/close, modal entrance, and status badge updates from CSS transitions to Framer Motion springs.

**Why it matters:** Springs feel more natural than fixed-duration transitions. When a specialist rapidly toggles the sidebar or switches views, springs redirect smoothly rather than snapping.

### 4. Contextual Menus on All Interactive Items (MEDIUM-HIGH IMPACT)

**Apple pattern:** Right-click reveals a contextual menu with grouped actions, destructive actions in red at the bottom.

**QBO current state:** No right-click context menus on any element.

**Proposed change:** Create a reusable `<ContextMenu>` component. Apply to:
- Escalation cards: Open, Copy Case ID, Change Status, Copy Link
- Chat messages: Copy Text, Retry, Quote to New Chat
- Sidebar conversations: Rename, Delete, Pin to Top
- INV cases: Open, Copy INV Number, Link to Escalation

**Why it matters:** Eliminates the need for explicit action buttons on every element. Reduces visual noise while maintaining full functionality.

### 5. Collapsing Page Headers (MEDIUM IMPACT)

**Apple pattern:** Large Title collapses to standard title on scroll.

**QBO current state:** Page headers are fixed size. The dashboard header with filter bar consumes significant vertical space.

**Proposed change:** In Dashboard and Investigations views, implement a scroll-aware header that collapses from a large title (24px) to a compact inline title (16px) as the user scrolls, with the filter bar collapsing into a single-line compact mode.

**Files:** `client/src/App.css`, `client/src/components/EscalationDashboard.css`

**Why it matters:** Recovers 40-60px of vertical space during active scrolling, showing 1-2 more escalation cards.

### 6. Continuous Corner Radius (Squircle) (MEDIUM IMPACT)

**Apple pattern:** All rounded rectangles use continuous (superellipse) corners, not circular arcs.

**QBO current state:** Standard CSS `border-radius` with circular corners.

**Proposed change:** For the Apple theme (`client/src/themes/apple.css`), add squircle corners using SVG clip-paths or the upcoming CSS `corner-shape: squircle` property. For immediate implementation, increase border-radius values by ~15% to visually approximate the superellipse effect (e.g., 8px → 9px, 12px → 14px).

**Why it matters:** Creates the distinctive "Apple feel" that users subconsciously recognize. Small but impactful polish.

### 7. Opacity-Based Text Hierarchy (MEDIUM IMPACT)

**Apple pattern:** Secondary and tertiary text use the same base color at different opacities (#3C3C43 at 60% and 30%) rather than distinct hex values.

**QBO current state:** Text levels use distinct hex values (`--ink: #2a2420`, `--ink-secondary: #6e5f52`, `--ink-tertiary: #9a8b7c`).

**Proposed change:** For an Apple-inspired theme, define text hierarchy as opacity variants of the base ink color. This ensures all text tones share the same warm undertone.

**Files:** `client/src/themes/apple.css`

**Why it matters:** Creates more harmonious text hierarchy and simplifies theme creation — changing the base ink color automatically adjusts all secondary/tertiary levels.

### 8. Increased Contrast Accessibility Mode (MEDIUM IMPACT)

**Apple pattern:** A system toggle that strengthens all borders, text weights, and contrast ratios.

**QBO current state:** `prefers-contrast: more` media query exists in `design-system.css` but adjustments are minimal.

**Proposed change:** Expand the `prefers-contrast: more` rules to: increase border opacity to 100%, bump all font weights by one step (400→500, 500→600, 600→700), ensure all text meets AAA contrast (7:1), and double separator visibility.

**Files:** `client/src/design-system.css`

**Why it matters:** Supports users with low vision. Costs nothing in normal mode.

### 9. Sheet-Style Escalation Detail (MEDIUM IMPACT)

**Apple pattern:** Detail views as half-height sheets that preserve parent context.

**QBO current state:** Escalation detail navigates to full page.

**Proposed change:** On dashboard, clicking an escalation opens a slide-in right panel (60% width) showing the detail view. The dashboard remains visible and scrollable behind a subtle dim overlay.

**Why it matters:** Enables rapid triage — scan the list, peek at details, close, move to next.

### 10. Vibrant Sidebar with Content Bleed-Through (LOW-MEDIUM IMPACT)

**Apple pattern:** Sidebar shows a blurred version of the main content through its translucent background.

**QBO current state:** Sidebar has `backdrop-filter: blur(16px)` but also has a near-opaque background that prevents content bleed-through.

**Proposed change:** Reduce sidebar background opacity to allow ~10-15% content visibility through the blur in the Apple theme. This creates subtle visual connection between sidebar and content.

**Files:** `client/src/themes/apple.css`, `client/src/components/Sidebar.css`

---

## 12. What NOT to Copy

### 1. Pure Black/White Backgrounds
Apple uses #FFFFFF and #000000. For 8-hour support shifts under fluorescent lighting, the QBO warm neutrals (#f5f2ed / #141210) are physiologically better. Pure white causes glare; pure black on LCD panels creates a flat, depth-less feel.

### 2. System Blue as Primary Accent
Apple's systemBlue (#007AFF) is a standard corporate blue. The QBO ember amber (#c76a22) is more distinctive, warmer, and better suited to the "authority without coldness" identity. Blue would make the app feel generic.

### 3. San Francisco Font
SF Pro is designed for Apple platforms and not freely licensable for web. Inter (the QBO app's current font) is an excellent screen-optimized alternative with similar x-height, tabular numbers, and optical sizing. No reason to change.

### 4. Bottom Tab Bar Navigation
Apple's bottom tab bar is a mobile pattern. The QBO app is desktop-first with a left sidebar. Forcing a bottom tab bar would waste horizontal space and conflict with the chat compose area.

### 5. Extreme Translucency in Productivity Contexts
Apple's vibrancy works for content consumption (photos, music). In a data-entry/reading productivity tool, excessive translucency makes text harder to read because the background content creates visual noise. Use translucency sparingly — sidebar and overlays only, never on primary content surfaces.

### 6. Gratuitous Spring Bounce
Apple's bouncy spring presets (dampingFraction: 0.5) create playful, consumer-friendly motion. In a professional support tool, bouncing UI elements feel frivolous. Use critically-damped springs (dampingFraction: 1.0) or slightly underdamped (0.85-0.95) for subtle life without playfulness.

### 7. Dynamic Type Scaling
Apple's Dynamic Type lets users scale all text from 11pt to 30pt+. While accessible, implementing full Dynamic Type in a web app would require massive layout testing. The QBO app should support browser zoom (which it does by using rem/em units in some places) rather than building a custom text scaling system.

---

## 13. Implementation Priority

### Tier 1 — Quick Wins (< 1 day each)

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Increased contrast mode expansion | 2-3 hours | Medium | CSS-only, improves accessibility immediately |
| Opacity-based text hierarchy in Apple theme | 2 hours | Medium | Simple CSS change, harmonizes text tones |
| Continuous corner radius approximation | 1 hour | Low-Medium | Bump radius values 15% in Apple theme |

### Tier 2 — Medium Effort (1-3 days each)

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Semantic color token layer | 2 days | High | Foundational for all future themes |
| Spring animation migration | 2 days | High | Replaces CSS transitions for key interactions |
| Contextual menus | 2-3 days | Medium-High | New reusable component, applies everywhere |
| Materials system definition | 1 day | Medium | CSS-only, replaces ad-hoc blur/shadow |

### Tier 3 — Larger Projects (3-7 days each)

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Sheet-style escalation detail | 4-5 days | High | Structural layout change, transforms triage |
| Collapsing page headers | 3 days | Medium | Scroll-aware header with animation |
| Vibrant sidebar with content bleed | 3 days | Medium | Requires careful opacity/blur tuning per theme |

### Tier 4 — Strategic / Future

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Full squircle rendering via SVG clip-paths | 5+ days | Low | Waiting for CSS `corner-shape` specification |
| SF Symbols-style icon weight matching | 5+ days | Medium | Requires icon system overhaul |

---

## 14. CSS Custom Property Definitions

```css
/* Apple HIG Design Tokens — Light Mode */
:root[data-theme="apple-hig"] {
  /* Backgrounds */
  --bg: #FFFFFF;
  --bg-raised: #F2F2F7;
  --bg-sunken: #F2F2F7;
  --bg-sidebar: rgba(242, 242, 247, 0.85);

  /* Text */
  --ink: #000000;
  --ink-secondary: rgba(60, 60, 67, 0.6);
  --ink-tertiary: rgba(60, 60, 67, 0.3);

  /* Accent */
  --accent: #007AFF;
  --accent-hover: #0066D6;
  --accent-subtle: rgba(0, 122, 255, 0.12);

  /* Semantic */
  --success: #34C759;
  --warning: #FF9500;
  --danger: #FF3B30;

  /* Borders */
  --line: rgba(60, 60, 67, 0.29);
  --line-subtle: rgba(60, 60, 67, 0.12);

  /* Fills */
  --fill: rgba(120, 120, 128, 0.2);
  --fill-secondary: rgba(120, 120, 128, 0.16);

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.15);

  /* Materials */
  --material-regular: blur(16px) saturate(1.8);
  --material-thin: blur(8px) saturate(1.4);
  --material-thick: blur(24px) saturate(2.0);

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'JetBrains Mono', ui-monospace, monospace;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
}

/* Apple HIG Design Tokens — Dark Mode */
:root[data-theme="apple-hig"][data-mode="dark"] {
  /* Backgrounds */
  --bg: #000000;
  --bg-raised: #1C1C1E;
  --bg-sunken: #000000;
  --bg-sidebar: rgba(28, 28, 30, 0.85);

  /* Text */
  --ink: #FFFFFF;
  --ink-secondary: rgba(235, 235, 245, 0.6);
  --ink-tertiary: rgba(235, 235, 245, 0.3);

  /* Accent */
  --accent: #0A84FF;
  --accent-hover: #409CFF;
  --accent-subtle: rgba(10, 132, 255, 0.15);

  /* Semantic */
  --success: #30D158;
  --warning: #FF9F0A;
  --danger: #FF453A;

  /* Borders */
  --line: rgba(84, 84, 88, 0.6);
  --line-subtle: rgba(84, 84, 88, 0.36);

  /* Fills */
  --fill: rgba(120, 120, 128, 0.36);
  --fill-secondary: rgba(120, 120, 128, 0.32);

  /* Shadows — minimal in dark mode, use borders instead */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.5);

  /* Radii — same as light */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
}
```

---

## 15. Sources

### Official Documentation
- [Human Interface Guidelines — Apple Developer](https://developer.apple.com/design/human-interface-guidelines/)
- [Color — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/color)
- [Typography — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Motion — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/motion)
- [Dark Mode — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [SF Symbols — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)
- [Standard Colors — UIKit](https://developer.apple.com/documentation/uikit/standard-colors)
- [Designing for iOS — Apple HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)
- [Fonts — Apple Developer](https://developer.apple.com/fonts/)

### WWDC Sessions
- [Animate with Springs — WWDC23](https://developer.apple.com/videos/play/wwdc2023/10158/)
- [Get to know the new design system — WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/)
- [The details of UI typography — WWDC20](https://developer.apple.com/videos/play/wwdc2020/10175/)
- [Introducing SF Symbols — WWDC19](https://developer.apple.com/videos/play/wwdc2019/206/)

### Blog Posts / Engineering Articles
- [Apple's spring animation API: A Deep Dive — Paul Bancarel](https://medium.com/@bancarel.paul/apples-spring-animation-api-a-deep-dive-into-realistic-motion-ca68c97ce218)
- [Backwards compatibility for iOS 13 system colors — Noah Gilmore](https://noahgilmore.com/blog/dark-mode-uicolor-compatibility)
- [Dark color cheat sheet — Sarunw](https://sarunw.com/posts/dark-color-cheat-sheet/)
- [Dark Mode on iOS 13 — NSHipster](https://nshipster.com/dark-mode/)
- [The secret formula for Apple's rounded corners — Arun.is](https://arun.is/blog/apple-rounded-corners/)
- [My Quest for the Apple Icon Shape — Liam Rosenfeld](https://liamrosenfeld.com/posts/apple_icon_quest/)

### Community Analysis
- [Apple HIG Design System — designsystems.surf](https://designsystems.surf/design-systems/apple)
- [Apple Colors — Marcos Griselli](https://mar.codes/apple-colors)
- [iOS Color Palette — Design Pieces](https://www.designpieces.com/palette/ios-color-palette-hex-and-rgb/)
- [Apple HIG Colors iOS — Figma Community](https://www.figma.com/community/file/1118467272498298301/apple-hig-colors-ios)
- [Apple HIG Colors GitHub Gist](https://gist.github.com/eonist/7b5abce6979ce4a272c5de57eb0fb550)
- [iPhone App Font Size & Typography Guidelines — Learn UI Design](https://www.learnui.design/blog/ios-font-size-guidelines.html)
- [iOS Design Guidelines — Learn UI Design](https://www.learnui.design/blog/ios-design-guidelines-templates.html)

### GitHub Repositories
- [Apple HIG Colors — m3g0byt3](https://github.com/m3g0byt3/Apple-HIG-Colors)
- [UIAppleColor — Kofktu](https://github.com/Kofktu/UIAppleColor)
- [NGSystemColorComparison — noahsark769](https://github.com/noahsark769/NGSystemColorComparison)

---

*This report was compiled from Apple's official Human Interface Guidelines, WWDC session videos, developer documentation, and verified third-party analysis. All hex values were cross-referenced against multiple sources. QBO application recommendations reference actual codebase files and components.*
