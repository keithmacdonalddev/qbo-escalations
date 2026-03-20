# Figma Design System Report: Application to QBO Escalation Tool

*Design Research Report -- March 2026*
*Researcher: Design System Analysis Agent*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Figma Design Philosophy](#2-figmas-design-philosophy)
3. [Key Design Patterns](#3-key-design-patterns)
4. [Color System](#4-color-system)
5. [Typography and Spacing](#5-typography-and-spacing)
6. [Motion and Interaction](#6-motion-and-interaction)
7. [Accessibility](#7-accessibility)
8. [Application to the QBO Escalation Tool](#8-application-to-the-qbo-escalation-tool)
9. [What NOT to Copy](#9-what-not-to-copy)
10. [Implementation Priority](#10-implementation-priority)
11. [Sources](#11-sources)

---

## 1. Executive Summary

Figma is the most influential design tool of the last decade, and its influence extends far beyond the pixels it helps create. Its own interface embodies a deeply considered design philosophy that can teach any application builder -- particularly one building dense, all-day-use professional tools like this QBO escalation assistant -- profound lessons about restraint, hierarchy, and making the tool disappear so the work can shine.

This report distills Figma core design ideas across six dimensions (philosophy, patterns, color, typography, motion, accessibility) and then applies each one specifically to the QBO escalation app. The goal is not to make the QBO tool look like Figma. The goal is to steal the thinking behind Figma and translate it into a QBO specialist world -- one where an advisor stares at this screen for 8+ hours daily, triaging payroll bugs and bank-feed failures under time pressure.

**The three biggest takeaways for the QBO app:**

1. **Canvas-first information architecture.** Figma proved that moving chrome to the periphery and letting content dominate the center creates focus. The QBO chat view should be treated as a "canvas" -- the primary workspace -- with all supporting panels (INV tracker, agent dock, Gmail) as collapsible peripheral tools, not competing columns.

2. **Semantic multi-color identity as navigation shorthand.** Figma maps five brand colors to five product concepts (red = brand, purple = components, green = frames, blue = text, coral = prototyping). The QBO app already has provider colors (ember for Claude, purple for Codex) and category badge colors. Elevating these into a first-class semantic color language -- where color alone tells you "this is a payroll issue" or "this came from the Claude provider" -- would dramatically reduce cognitive load during rapid triage.

3. **Progressive disclosure over information density.** The UI3 redesign spent two years learning that showing everything at once overwhelms. The "Minimize UI" pattern -- where panels collapse but reappear contextually when you select something -- is directly applicable to the QBO app agent dock, right sidebar, and settings panel.

---

## 2. Figma Design Philosophy

### 2.1 The Invisible Tool

Figma foundational design principle is that the tool should be invisible. The user work -- their designs, their prototypes, their component libraries -- is the protagonist. Every pixel of the interface is subordinate to the content on the canvas.

This is articulated most clearly in the UI3 redesign (Config 2024), where the stated north star was: **"Your work takes center stage."** The team, led by Design Director Marcin Wichary, spent over two years iterating on the redesign, even reversing some core decisions (like floating navigation panels) after launch based on user feedback. Wichary noted: "Craft and flow do not have easy metrics, so you have to listen to users a lot, and then process feedback carefully."

The invisible-tool philosophy manifests in three concrete ways:

- **Neutral canvas background.** Figma uses #E5E5E5 (light) and #2C2C2C (dark) for the canvas -- deliberately warm-neutral grays that do not compete with any possible content color. The QBO app #f5f2ed warm cream serves an analogous purpose.
- **Chrome recession.** UI elements (toolbar, panels, status bars) use lower visual weight (lighter borders, subtler backgrounds, smaller type) than the content they frame. The hierarchy says: look at the work, not the tool.
- **Contextual appearance.** Panels appear when needed and hide when not. The "Minimize UI" shortcut (Shift+backslash) collapses all panels, but selecting an object on canvas automatically reopens the properties panel. The tool gets out of the way, then reappears precisely when context demands it.

### 2.2 Semantic Color as Product Language

The five brand colors are not decorative. They are a semantic mapping from color to product concept:

| Color | Hex | Product Concept |
|-------|-----|------------------|
| Red-Orange | #F24E1E | Brand identity, the platform itself |
| Coral | #FF7262 | Prototyping, interaction design |
| Purple | #A259FF | Components, design system objects |
| Blue | #1ABCFE | Text layers, content editing |
| Green | #0ACF83 | Frames, layout structure, success states |

This mapping extends from the logo into the product UI. When you see purple, you know you are dealing with a component. When you see green, you are looking at a frame or a success state. This consistency between brand identity and product semantics is rare and powerful -- it turns brand colors into functional wayfinding.

The logo itself consists of five overlapping circular shapes arranged in a formation resembling a stylized "F." Each circle represents a different team member or design discipline coming together in real time. The vibrant palette was a deliberate contrast against the "muted, professional tones of incumbent design tools" (Sketch, Adobe), positioning Figma as modern and accessible.

### 2.3 Collaboration-First Design

Figma was the first major design tool to make real-time multiplayer collaboration a core feature, not an add-on:

- **Named cursors with unique colors.** Each collaborator gets a distinct color-coded cursor with their name attached. Functional (see where someone is working) and social (wave your cursor to get attention).
- **Presence indicators.** Avatar clusters in the toolbar show who is viewing the file. Click an avatar to follow their viewport.
- **Conflict-free resolution.** CRDTs (Conflict-Free Replicated Data Types) ensure eventual consistency -- when two people edit the same property, the latest change wins. Tiny deltas sent instead of full file states.
- **Observation mode.** Follow another person view, seeing exactly what they see as they navigate.

The design principle: **collaboration features should be ambient, not intrusive.** Cursors float passively. Presence is shown but not announced. You are never interrupted by someone else activity unless you choose to engage.

---

## 3. Key Design Patterns

### 3.1 Canvas UX: The Center is Sacred

In UI3, the canvas occupies the maximum possible screen area. The toolbar moved from top to bottom. Properties panel floats as a collapsible sidebar. Layers panel is an optional toggle. The canvas is the default state -- everything else is an optional overlay.

**Pattern rules:**
- The center of the screen belongs to content, never to navigation or controls.
- Tools live at the edges (bottom toolbar, side panels).
- "Minimize UI" allows complete immersion -- only content visible.
- Selecting an object brings back the relevant panel automatically.

### 3.2 Properties Panel: Contextual Detail on Demand

The right-side properties panel is a masterclass in progressive disclosure:

- **Empty state:** When nothing is selected, shows file-level properties (local styles, color variables). Not blank -- useful but low-priority.
- **Selection state:** Shows the object properties grouped logically: Layout (width, height, auto-layout), Position (x, y, rotation, constraints), Appearance (fills, strokes, effects), Typography (when text is selected).
- **Contextual actions:** A header row shows actions relevant to the selection (mask, boolean operations, component creation). Changes based on what you have selected.
- **Resizable:** In UI3 the panel is resizable, accommodating long component names.

**The key insight:** The panel content is driven entirely by the user current selection. It never shows irrelevant information. This is the opposite of a dashboard that shows everything at once.

### 3.3 Layers Panel: Structural Navigation

The left-side layers panel provides a tree view of the document structure. In UI3, it was merged with the assets panel and file information. Key behaviors:

- Layers can be collapsed/expanded to manage depth.
- Selecting a layer highlights it on canvas, and vice versa.
- Supports search and filtering.
- Collapses entirely in "Minimize UI" mode.

### 3.4 Auto-Layout: Responsive by Default

- **Hug vs. Fill:** A container can "hug" its content (shrink to fit) or "fill" its parent (expand to fit). Simple two-mode model covering most layout needs.
- **Direction + Alignment + Spacing:** Three properties define auto-layout. In UI3, all three are shown together rather than scattered.
- **Nested composition:** Auto-layout frames contain other auto-layout frames for complex responsive layouts from simple building blocks.

### 3.5 Floating Panels and the Slim Toolbar

UI3 introduced two structural changes:

- **Bottom toolbar:** Moved from top to bottom, freeing the top edge for content. Slim single row of icons.
- **Floating collapsible panels:** Navigation and properties panels float over the canvas rather than consuming permanent space. Canvas can use the full viewport width.

Described as "consistent patterns like the slim toolbar and floating collapsible panels" forming "a through line across the Figma ecosystem" -- same patterns in Figma Design, Slides, and FigJam.

### 3.6 Multiplayer Cursors: Ambient Awareness

- Distinct colors per user from a preset palette.
- Name labels appear on hover or during activity.
- Smooth interpolation via delta broadcasting.
- Throttled updates to prevent performance issues.

---

## 4. Color System

### 4.1 Brand Palette

Five colors deliberately chosen to contrast with "muted, professional tones of incumbent design tools":

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Figma Red | #F24E1E | 242, 78, 30 | Brand mark, error states |
| Figma Coral | #FF7262 | 255, 114, 98 | Prototyping, secondary brand |
| Figma Purple | #A259FF | 162, 89, 255 | Components, design system |
| Figma Blue | #1ABCFE | 26, 188, 254 | Text/content, info states |
| Figma Green | #0ACF83 | 10, 207, 131 | Frames, success states |

### 4.2 Interface Palette

Deliberately neutral, receding behind user content:

| Surface | Light | Dark |
|---------|-------|------|
| Panel background | #FFFFFF | #2C2C2C |
| Secondary panels | #F5F5F5 | #383838 |
| Canvas | #E5E5E5 | ~#1E1E1E |
| Primary text | #333333 | #FFFFFF |
| Secondary text | #8C8C8C | #B3B3B3 |
| Muted/placeholder | #AAAAAA | #666666 |
| Borders | #E6E6E6 | #444444 |

### 4.3 Semantic Color Architecture (Three-Tier Model)

Three-tier architecture used internally and recommended for all design systems:

1. **Primitives (raw values):** Actual hex colors organized by hue and shade (red-100, red-200, etc.). Source of truth.
2. **Semantics (role-based aliases):** Names like color-bg-primary, color-text-secondary that describe what the color does, not what it looks like.
3. **Component tokens:** Names like button-bg, card-border that point to semantic tokens. Most specific, change per theme.

This enables theming by swapping which primitives semantic tokens point to, without changing component code. Directly analogous to the QBO app CSS custom properties -- :root defines semantic tokens (--bg, --ink, --accent) and dark mode overrides swap underlying values.

### 4.4 Color Variable Scoping

The variable system (introduced 2023, matured 2025-2026) supports scoping -- a color variable can be restricted to certain property types (fill only, stroke only, text only). Prevents misuse. Principle: **constraints prevent errors without limiting creativity.**

---

## 5. Typography and Spacing

### 5.1 Typography System

Figma uses a system font stack for its own interface. For design system typography, recommends **Inter** -- the same font the QBO app uses.

Key principles:

- **Three weights are enough.** Regular (400) for body, Medium (500) for labels, Semibold/Bold (600/700) for headings.
- **Decrease line-height as size increases.** Body text (14px) needs ~1.5. Display text (32px) needs ~1.2. The QBO design-system.css follows this.
- **Tighten letter-spacing on headings.** Negative tracking (-0.015em to -0.025em) for large text. Positive (+0.01em to +0.06em) for small text. QBO has --tracking-tight and --tracking-wide matching this.
- **Line-height values should be multiples of 4** for 8px baseline grid alignment.

### 5.2 Spacing System (8-Point Grid)

- All spacing multiples of 8: 8, 16, 24, 32, 40, 48.
- 4-point sub-grid for typography and small gaps.
- Touch targets: 44x44pt (Apple HIG) or 48x48dp (Material).

The QBO app uses 4px base (--sp-1: 4px) with scale 4, 6, 8, 12, 14, 16, 20, 24, 28, 36. Slightly irregular but provides finer granularity needed for dense UI elements. Reasonable deviation.

### 5.3 Properties Panel Typography Hierarchy

Four distinct text levels at nearly the same font size, differentiated by weight, case, tracking, and color:

- **Section headings** (e.g., "Layout"): Small, uppercase, wide-tracked, muted. Maps to QBO .eyebrow / .text-overline.
- **Property labels** (e.g., "Width"): Small, normal case, secondary color. Maps to .detail-field-label.
- **Property values** (e.g., "320"): Same size as labels, primary color, tabular-nums. The actual data.
- **Action buttons**: Small, medium weight, accent color. Interactive.

This technique maximizes information density without visual clutter. The QBO app could apply this more consistently in escalation detail and investigation views.

---

## 6. Motion and Interaction

### 6.1 Animation Philosophy

Two categories of motion:

1. **Interface motion** (the tool own UI): Subtle, fast, functional. Panel slides, hover states, selection transitions. Nearly imperceptible.
2. **Design motion** (prototyping): Expressive, customizable, physics-based. Spring animations with configurable stiffness, damping, mass.

Interface motion principles match the QBO app existing philosophy:
- 200ms sweet spot for most transitions.
- Ease-out for entrances, ease-in for exits.
- Transform and opacity only for GPU-composited animation.
- Reduced motion always respected.

### 6.2 Spring Animations

Four spring presets as mental models:

| Preset | Stiffness | Damping | Best For |
|--------|-----------|---------|----------|
| Gentle | Low | Medium | Subtle scaling, content reveals |
| Quick | High | High | Toasts, notifications |
| Bouncy | Medium | Low | Toggle switches, pills |
| Slow | Low | High | Full-screen transitions |

QBO already has --ease-spring and uses Framer Motion springs. Consider naming internal spring configs to match these categories.

### 6.3 Interaction Patterns

- **Hover lift:** translateY(-1px) on clickable elements. QBO already implements this.
- **Active press:** scale(0.97-0.98) on click. Present in QBO btn:active.
- **Selection highlight:** Colored border/outline, not background change.
- **Panel slide:** Ease-out-expo timing. QBO has --ease-out-expo.

---

## 7. Accessibility

### 7.1 Figma Accessibility Investments

- **Keyboard navigation:** Box-selection tool with arrow keys, logical Tab order, comprehensive shortcuts.
- **Screen reader support:** Object descriptions, formatted text recognition, action announcements.
- **Color contrast checker:** Built into color picker with WCAG AA/AAA compliance. Color blindness simulation dropdown.
- **Semantic HTML:** Tag elements with correct semantics for accessible output.

### 7.2 Interface Accessibility Patterns

- **Focus rings:** 2px solid accent with 2px offset. QBO matches exactly.
- **Mouse-user outline removal:** :focus:not(:focus-visible) { outline: none; }. QBO implements this.
- **Reduced motion:** Respects prefers-reduced-motion. QBO has comprehensive coverage.
- **High contrast:** QBO handles prefers-contrast: more and less.
- **Touch targets:** 44x44pt minimum. QBO has --sp-11: 44px and .touch-target.

### 7.3 Color Blindness Considerations

The five-color brand palette is distinguishable under common color vision deficiencies. Red (#F24E1E) vs. Blue (#1ABCFE) is safe for protanopia/deuteranopia. Purple (#A259FF) vs. Green (#0ACF83) is safe for most deficiencies.

The QBO app category badge system uses a wide hue range which is good, but payroll purple (#5e3d8a) and reporting purple (#6b3587) are very close -- consider differentiating further.

---

## 8. Application to the QBO Escalation Tool

This is the core section. Each subsection takes a Figma idea and translates it concretely to the QBO app.

### 8.1 Canvas-First Chat Architecture

**The Figma idea:** The canvas is sacred. Everything else floats at the edges.

**QBO application:** The Chat view is the specialist canvas. Primary workflow: receive context, ask the AI, copy the response, advise the phone agent.

**Concrete changes:**

- **Agent Dock as floating panel.** Make the Agent Dock (AgentDock.jsx) collapsible via an edge-tab (like the network waterfall tab) rather than a permanent column.
- **"Focus Mode" for Chat.** A keyboard shortcut (like Minimize UI) collapses sidebar, agent dock, and header into full-screen chat. Selecting an escalation or receiving a notification auto-restores relevant panels.
- **Contextual panel appearance.** Clicking an INV number in chat opens the INV detail panel. Gmail notification opens inbox panel. Panels arrive because context demands them.

### 8.2 Semantic Category Color Threading

**The Figma idea:** Each brand color maps to a product concept. Color becomes wayfinding.

**Concrete changes:**

- **Thread-level color coding.** A thin left-edge accent bar in chat threads adopts the category color (payroll purple, bank-feeds cyan, tax red). Analogous to the purple glow when editing a component -- the environment tells you what domain you are in.
- **Sidebar conversation badges.** Colored dots or left-border strips on sidebar items matching category. Specialist can scan and see "three payroll, two bank-feeds" without reading titles.
- **Provider identity on messages.** Subtle left-border on AI message bubbles matching the provider color (ember/purple/amber/emerald). Mirrors per-user cursor colors in multiplayer.
- **Dashboard row tinting.** Very subtle background wash on table rows matching status color for visual scanning.

### 8.3 Properties Panel for Escalation Detail

**The Figma idea:** Right panel shows contextual properties grouped logically.

**Concrete changes:**

- **Collapsible property groups.** "Identification" / "Status" / "Context" / "Resolution" sections with collapse/expand. Mirrors Layout/Position/Appearance/Typography grouping.
- **Slide-in panel from dashboard.** Clicking an escalation opens a right-side detail panel instead of navigating to a new page. Specialist stays in dashboard context.
- **Inline editing.** Click a value to edit it, Enter to save. No modal forms. Directly from the panel.

### 8.4 Layers Panel for INV Tracking

**The Figma idea:** Tree view of document structure with bidirectional selection sync.

**Concrete changes:**

- **Tree view for related INVs.** Known issues as parent nodes, child INVs as leaves. Expanding a known issue reveals child INVs.
- **Selection sync.** Click in tree highlights in main view and vice versa -- core layers panel behavior.
- **Search and filter.** Search by INV number, title, or status at tree top.

### 8.5 Multiplayer Presence for Team Collaboration

**The Figma idea:** Ambient awareness of who is present and what they are doing.

**Concrete changes:**

- **Presence indicators on escalations.** Avatar dots when another specialist has a case open. QBO equivalent of seeing a cursor near an object.
- **Ambient, not intrusive.** Small, unobtrusive indicators. Inform without interrupting.

### 8.6 Progressive Disclosure in Settings

**The Figma idea:** Show less by default, reveal on demand.

**Concrete changes:**

- **Tiered settings.** "Essentials" visible (theme, provider, model). "Advanced" behind expander (LED, flame bar, waterfall, telemetry).
- **Search in settings.** Jump to any setting instantly via search field.
- **Contextual hints.** One-line descriptions for each settings group.

### 8.7 Command Palette for Power Users

**The Figma idea:** Command search provides access to any feature from the keyboard.

**Concrete changes:**

- **Ctrl+K command palette.** Search across actions: new chat, switch provider, open escalation, find INV, navigate to view, copy last response. Fuzzy-match with keyboard navigation.

### 8.8 Three-Tier Color Token Architecture

**The Figma idea:** Separate primitives, semantics, and component tokens.

**Concrete changes:**

- **Primitive layer:** --palette-amber-500: #c76a22, etc. Never change between themes.
- **Semantic layer (existing):** --accent: var(--palette-amber-500). Change per theme.
- **Component layer:** --btn-primary-bg: var(--accent). Component-level indirection for maximum flexibility.

---

## 9. What NOT to Copy

### 9.1 Infinite Canvas
The QBO app work is textual and temporal, not spatial. An infinite canvas adds complexity without benefit. **Stick with linear, scrollable views.**

### 9.2 Floating the Primary Sidebar
The specialist references sidebar navigation alongside chat. **Keep the sidebar as a fixed, collapsible column.** Only secondary panels should float.

### 9.3 Bottom Toolbar Over Chat Compose
The chat input lives at the bottom. **A bottom toolbar conflicts with it.** Use a command palette (Ctrl+K) instead.

### 9.4 Five-Color Brand Vibrancy
The QBO "Warm Authority" amber identity is correct for stressed support specialists. **Do not replace it with Figma-level vibrancy.** Use multi-color only for semantic category coding.

### 9.5 Real-Time Cursor Sharing
Not spatial. **Presence indicators are valuable. Cursor sharing is not.** Cost-to-benefit ratio is entirely wrong.

### 9.6 Radical Minimalism Over Discoverability
QBO specialists need immediate productivity under pressure. **Do not hide essential controls behind undiscoverable gestures.** Sidebar icons should always be visible.

---

## 10. Implementation Priority

### Priority 1: Focus Mode for Chat (High Impact, Low Effort)
Keyboard shortcut collapses all chrome for full-screen chat. Directly applies "Minimize UI."
**Files:** App.jsx, App.css, Sidebar.css

### Priority 2: Semantic Category Color Threading (High Impact, Medium Effort)
Extend category colors to chat thread accents, sidebar badges, and dashboard row tints.
**Files:** Chat.css, Sidebar.css, EscalationDashboard.css

### Priority 3: Contextual Right Panel for Escalation Detail (High Impact, Medium Effort)
Slide-in properties panel from dashboard with collapsible groups and inline editing.
**Files:** EscalationDashboard.jsx, EscalationDetail.jsx, new panel component

### Priority 4: Progressive Disclosure in Settings (Medium Impact, Low Effort)
Tiered settings with search field and collapsible Advanced section.
**Files:** Settings.jsx, settings.css

### Priority 5: INV Tree View with Selection Sync (Medium Impact, Medium Effort)
Collapsible tree for investigations with bidirectional selection sync.
**Files:** InvestigationsView.jsx, InvestigationsView.css

### Priority 6: Provider Color on Message Bubbles (Medium Impact, Low Effort)
Subtle left-border tint on AI messages matching provider color.
**Files:** Chat.css, Chat.jsx

### Priority 7: Command Palette (Medium Impact, Medium Effort)
Ctrl+K overlay with fuzzy search across actions and navigation.
**Files:** New CommandPalette.jsx, App.jsx

### Priority 8: Presence Indicators on Escalations (Lower Impact, Higher Effort)
Avatar dots on escalation cards when another specialist has it open. Requires WebSocket server.
**Files:** EscalationDashboard.jsx, server routes, new WebSocket service

---

## 11. Sources

### Figma Official
- [Navigating UI3](https://help.figma.com/hc/en-us/articles/23954856027159-Navigating-UI3)
- [Our Approach to Designing UI3](https://www.figma.com/blog/our-approach-to-designing-ui3/)
- [Making the Move to UI3](https://www.figma.com/blog/making-the-move-to-ui3-a-guide-to-figmas-next-chapter/)
- [Inside the Redesigned Figma](https://www.figma.com/blog/behind-our-redesign-ui3/)
- [Multiplayer Editing](https://www.figma.com/blog/multiplayer-editing-in-figma/)
- [How Multiplayer Technology Works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Spring Animations](https://www.figma.com/blog/how-we-built-spring-animations/)
- [Prototype Easing and Spring Animations](https://help.figma.com/hc/en-us/articles/360051748654-Prototype-easing-and-spring-animations)
- [Plugin System Architecture](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
- [15+ Accessibility Improvements](https://www.figma.com/blog/introducing-screenreader-and-accessibility-features/)
- [Keyboard Accessibility](https://www.figma.com/blog/introducing-keyboard-accessibility-features/)
- [Brand Usage Guidelines](https://www.figma.com/using-the-figma-brand/)
- [Brand Refresh](https://www.figma.com/blog/figma-on-figma-evolving-our-visual-language/)
- [Typography Systems](https://www.figma.com/best-practices/typography-systems-in-figma/)
- [Color Contrast Checker](https://www.figma.com/color-contrast-checker/)
- [Widget API](https://www.figma.com/widget-docs/api/api-reference/)
- [Config 2024 Recap](https://www.figma.com/blog/config-2024-recap/)

### Third-Party Analysis
- [Figma Logo History (logotyp.us)](https://logotyp.us/logo/figma/)
- [Figma Logo (1000logos.net)](https://1000logos.net/figma-logo/)
- [Figma Brand Colors (Mobbin)](https://mobbin.com/colors/brand/figma)
- [Figma Variables 2025/2026 Playbook](https://www.designsystemscollective.com/design-system-mastery-with-figma-variables-the-2025-2026-best-practice-playbook-da0500ca0e66)
- [Building Color Systems in Figma](https://medium.com/@unofficiallummy/building-a-solid-color-system-in-figma-primitives-semantics-and-real-world-structure-cb4a4d76f03a)
- [Real-Time Collaboration Architecture](https://medium.com/frontend-simplified/deconstructing-the-magic-how-figma-achieved-seamless-real-time-multi-user-collaboration-37347f2ee292)
- [Multiplayer Cursors (mskelton.dev)](https://mskelton.dev/blog/building-figma-multiplayer-cursors)
- [UI3 Changes (Design Monks)](https://www.designmonks.co/blog/figma-ui-changes-to-enhance-your-design-workflow)
- [Config 2024 Recap (Outwitly)](https://outwitly.com/resources/config-2024-recap-figmas-newest-features-and-updates/)
- [Spacing, Grids, and Layouts](https://www.designsystems.com/space-grids-and-layouts/)

---

*This report was compiled by analyzing Figma official documentation, blog posts, help center articles, brand guidelines, and third-party design analysis. All color values were cross-referenced against multiple sources. QBO application recommendations are based on reading the codebase: App.css, App.jsx, design-system.css, design-system-v2.css, Sidebar.css, theme files, and docs/design/design-system.md.*
