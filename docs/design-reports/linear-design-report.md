# Linear Design System Analysis & Application to QBO Escalation Tool

*Design research report -- 2026-03-19*
*Prepared for the QBO Escalation Assistant project*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Linear Design Philosophy](#2-linears-design-philosophy)
3. [Key Design Patterns](#3-key-design-patterns)
4. [Color System Analysis](#4-color-system-analysis)
5. [Typography and Spacing](#5-typography-and-spacing)
6. [Motion and Interaction](#6-motion-and-interaction)
7. [Accessibility Approach](#7-accessibility-approach)
8. [Application to QBO Escalation App](#8-application-to-qbo-escalation-app)
9. [What NOT to Copy](#9-what-not-to-copy)
10. [Implementation Priority](#10-implementation-priority)

---

## 1. Executive Summary

Linear is the gold standard for keyboard-driven, information-dense professional tool design. Its product philosophy can be distilled into a single sentence: **every pixel should either show the user content or get out of the way.** Linear achieves this through dark-first theming, monochromatic surfaces with precisely placed accent color, a comprehensive keyboard shortcut system, a universal command palette (Cmd+K), and animations that serve function over decoration.

This report documents the Linear design system in depth and identifies specific, actionable changes for the QBO Escalation Assistant. The QBO app already has a strong design foundation -- the "Warm Authority" token system, comprehensive CSS custom properties, and considered dark mode support. However, it currently leans toward decorative richness (gradients, multi-layer shadows, text-shadow, glow effects) where Linear would advocate for restraint. The biggest opportunity is not visual polish but **operational speed**: a command palette, comprehensive keyboard shortcuts, and tighter information density would directly accelerate the escalation specialist workflow.

The recommendations below are ranked by impact-to-effort ratio. The top three:

1. **Command palette (Cmd+K)** -- The single highest-impact feature missing from the QBO app. An escalation specialist could jump to any case, search investigations, switch views, change AI providers, and trigger actions without ever reaching for the mouse.

2. **Keyboard shortcut layer** -- Linear maps every common action to a key. The QBO app has none. Adding shortcuts for status changes, navigation, and chat operations would transform daily efficiency.

3. **Information density tightening** -- The QBO app uses generous spacing ("slightly larger for readability during long shifts") which is a valid choice. But several areas (sidebar, dashboard cards, filter bars) have spacing that forces unnecessary scrolling. Linear proves you can be dense without being cramped.

---



## 2. Linear Design Philosophy



### 2.1 Speed as a Feature



Linear core premise is that a project management tool should feel as responsive as a native application. This manifests in several design decisions:



- **Optimistic UI updates.** Actions reflect immediately in the interface before server confirmation. Buttons do not show loading spinners for sub-second operations -- the UI just changes.

- **Animation budgets.** Transitions are budgeted at 100-200ms. Nothing in Linear takes longer than 300ms to animate. If a transition would take longer than 200ms, Linear skips the animation entirely and snaps to the final state.

- **Local-first architecture.** The UI reads from a local sync engine, not from network requests. This means lists, filters, and views render instantly. The QBO app fetches from MongoDB via Express; it cannot replicate this architecture, but it can adopt the *perception* of speed through skeleton states, optimistic updates, and transition discipline.

- **No confirmation dialogs for reversible actions.** Deleting an issue in Linear shows a brief undo toast, not a "Are you sure?" modal. This removes one click from every destructive operation.



### 2.2 Dark-First Design



Linear was designed dark-first, with light mode added later. This has concrete implications:



- **Surface hierarchy is inverted.** In dark mode, elevated elements are *lighter* than the base, creating depth through luminosity rather than shadow. Linear dark base is `#0A0A0B` (near-black), with cards at `#15151A` and elevated surfaces at `#1B1B22`.

- **Shadows are replaced by borders.** Box-shadows are invisible on dark backgrounds. Linear uses subtle `rgba(255,255,255,0.05)` borders and 1px luminous edges instead of shadow stacks.

- **Accent colors are desaturated.** The primary indigo `#5E6AD2` is not a vibrant blue -- it sits at moderate saturation to avoid eye strain on dark backgrounds.

- **Content contrast is carefully managed.** Primary text is `#EEEEEE` (not pure white), secondary is `#8A8A8E`, and muted is `#505054`. This creates three clearly distinguishable reading levels without any text being painfully bright.



### 2.3 Content Is King



Linear interface philosophy is that navigation and chrome should recede so that issue content -- titles, descriptions, status, assignees -- dominates visual weight. This is stated explicitly in their design refresh documentation: "While the parts central to the user task should stay in focus, ones that support orientation and navigation should recede."



Practical implementation:



- The sidebar was intentionally made "a few notches dimmer" in their 2025 refresh.

- Desktop tabs were made "more compact rather than spanning the full width."

- Icon scale was reduced.

- Colored team icon backgrounds were removed to decrease visual clutter.

- Borders were softened by "rounding out their edges and softening the contrast."



### 2.4 Opinionated Defaults



Linear is deliberately opinionated. It ships with a fixed workflow (Backlog > Todo > In Progress > Done > Canceled) and does not offer infinite customization. This is a design philosophy, not a limitation: by constraining options, Linear reduces the time users spend configuring the tool and increases the time spent using it.



This maps directly to the QBO app. An escalation specialist should not be configuring their workspace -- they should be resolving cases. Every settings panel, toggle, and preference is friction.

---



## 3. Key Design Patterns



### 3.1 Command Palette (Cmd+K)



The command palette is Linear most distinctive UX feature. It is a modal search interface invoked with Cmd+K (macOS) or Ctrl+K (Windows/Linux) that enables:



- **Navigation.** Type a view name ("backlog", "cycles", "settings") to jump there instantly.

- **Issue search.** Type an issue title, ID, or description fragment to find and open it.

- **Actions.** Type "assign to me", "set priority high", "move to done" to execute operations on the selected issue.

- **Contextual commands.** The available commands change based on what is currently selected or visible.

- **Fuzzy matching.** You do not need to type the exact command name. "set pri" matches "Set priority." This makes discovery natural.



The command palette pattern has been adopted by Figma, Notion, Slack, VS Code, Raycast, Vercel, and Superhuman. It is the single most impactful UX pattern for keyboard-heavy professional tools. Key design principles from Superhuman engineering blog:



- Accessible from *anywhere* in the app via the same shortcut.

- Searches across all entity types (not just navigation).

- Teaches keyboard shortcuts organically (each result shows its shortcut, so users learn them passively).

- Covers unlimited commands without consuming screen real estate.



### 3.2 Keyboard Navigation



Linear keyboard system is layered:



**Global navigation (G prefix):**



| Shortcut | Action |

|----------|--------|

| G then I | Go to Inbox |

| G then M | Go to My Issues |

| G then T | Go to Triage |

| G then A | Go to Active Issues |

| G then B | Go to Backlog |

| G then C | Go to Cycles |

| G then P | Go to Projects |

| G then S | Go to Settings |



**Issue actions (single key, context-sensitive):**



| Shortcut | Action |

|----------|--------|

| C | Create new issue |

| S | Change status |

| P | Set priority |

| L | Modify labels |

| A | Assign to someone |

| I | Assign to myself |

| E (or Alt+E) | Edit issue |

| R | Rename |

| Shift+C | Add to cycle |

| Shift+P | Add to project |



**Navigation within views:**



| Shortcut | Action |

|----------|--------|

| J / Down Arrow | Next issue |

| K / Up Arrow | Previous issue |

| X | Select/deselect current issue |

| Shift+Up/Down | Multi-select |

| Enter | Open issue detail |

| Escape | Back / close |

| ? | Show keyboard shortcut help |



The design principle is that **every action available through a button should also be available through a keyboard shortcut.** Buttons exist for discoverability; shortcuts exist for speed. The command palette sits between these as the "search for anything" fallback.



### 3.3 Status Workflow System



Linear workflow is a five-category system with customizable statuses within each category:



| Category | Default Status | Visual |

|----------|---------------|--------|

| **Backlog** | Backlog | Gray circle, dotted |

| **Unstarted** | Todo | Gray circle, empty |

| **Started** | In Progress | Yellow/amber circle, half-filled |

| **Completed** | Done | Green/purple circle, filled with checkmark |

| **Canceled** | Canceled | Red circle, with X |



Additionally, **Triage** functions as an inbox for incoming team requests that have not yet been categorized. The visual language uses small circular icons with fill states that communicate progress at a glance. Colors are muted -- they use the same monochromatic restraint as the rest of the interface. Status text accompanies the icon (never color alone), satisfying accessibility requirements.



### 3.4 Cycle Management



Cycles are time-boxed work periods (analogous to sprints). Linear UX for cycles includes a **capacity dial** showing whether the team is likely to complete all assigned work (calculated from the velocity of the previous three completed cycles), **auto-creation** of upcoming cycles, **scope tracking** that visually shows when issues are added mid-cycle, and a progress bar that fills as issues move to Done/Canceled. The design is data-forward: numbers and progress indicators dominate, with minimal chrome around them.

---



## 4. Color System Analysis



### 4.1 Monochromatic Foundation



Linear color system is deliberately monochromatic. The entire surface hierarchy uses grays -- near-black through off-white -- with a single accent color (indigo `#5E6AD2`) for interactive elements.



**Dark mode surfaces:**



| Token | Value | Usage |

|-------|-------|-------|

| Bg Base | `#0A0A0B` | Page background (near-black) |

| Bg Sidebar | `#101012` | Sidebar |

| Bg Card | `#15151A` | Cards, panels |

| Bg Elevated | `#1B1B22` | Dropdowns, popovers |

| Border | `#1F1F28` | Borders |

| Text Primary | `#EEEEEE` | Primary text |

| Text Secondary | `#8A8A8E` | Labels, metadata |

| Text Muted | `#505054` | Disabled, placeholder |



**Light mode surfaces:**



| Token | Value | Usage |

|-------|-------|-------|

| Bg Base | `#FBFBFB` | Page background |

| Bg Sidebar | `#F4F4F4` | Sidebar |

| Bg Card | `#FFFFFF` | Cards |

| Border | `#E5E5E5` | Borders |

| Text Primary | `#171717` | Primary text |

| Text Secondary | `#6E6E73` | Labels, metadata |



### 4.2 Accent Color Discipline



Linear uses `#5E6AD2` (indigo/periwinkle) as its sole accent. This color appears on active/selected navigation items, links and interactive text, focus rings, primary buttons, toggle/switch active states, and the brand mark. It does **not** appear on status indicators (those use their own semantic colors), category labels, decorative elements (there are none), or backgrounds (accent tints are extremely subtle, rgba at 5-10%).



The QBO app current approach uses amber/ember `#c76a22` as its accent, plus four provider-specific colors, plus 14 category-specific badge color pairs. This is significantly more colorful than Linear. Whether that is appropriate depends on the use case -- the QBO app multi-color category system serves a real purpose (instant visual differentiation of escalation types).



### 4.3 LCH Color Space for Theme Generation



Linear most technically interesting color system decision is using the **LCH (Lightness, Chroma, Hue) color space** instead of HSL for generating custom themes. LCH is perceptually uniform -- a red and a yellow at lightness 50 will appear equally light to the human eye, which HSL cannot guarantee. Linear simplified their theme generation to just three inputs:



1. **Base color** -- determines all surface colors

2. **Accent color** -- determines interactive elements

3. **Contrast** -- a single value that controls the overall contrast ratio, enabling high-contrast accessibility themes



Previously they maintained 98 specific variables per theme. The new system derives all 98+ tokens algorithmically from these three inputs.



### 4.4 Semantic/Status Colors



| Status | Color | Hex |

|--------|-------|-----|

| Completed/Done | Green | `#4ADE80` |

| In Review/Blocked | Amber/Warning | `#F59E0B` |

| Cancelled/Bug | Red/Error | `#EF4444` |

| Informational | Brand Indigo | `#5E6AD2` |



What differentiates Linear is how *sparingly* they are used. Status colors appear only on small status icons and badges, never on large surface areas. This prevents the "dashboard Christmas tree" effect where every card screams with its own color.

---



## 5. Typography and Spacing



### 5.1 Font Choices



Linear uses **Inter** for body text and **Inter Display** for headings. Inter was chosen for its excellent readability at small sizes, its tabular number support, and its optimization for screen rendering. Inter Display adds "more expression while maintaining readability" at heading sizes, with slightly tighter metrics and more personality.



This is relevant: the QBO app also uses Inter as its primary font (`--font-sans`). The app is already aligned with Linear on this choice.



### 5.2 Information Density



Linear defining typographic characteristic is **density**. It packs more information per square pixel than almost any competing tool. This is achieved through:



- **Tight line-height on data rows.** Issue list rows use approximately 1.2-1.3 line-height, not the 1.5-1.6 common in content-focused tools.

- **Small but legible base size.** Body text appears to be 13-14px, with metadata at 11-12px. This is smaller than the QBO app `--text-base: 14.5px`.

- **Negative letter-spacing on headings.** Linear tightens headings with `-0.02em` to `-0.025em` letter-spacing, which the QBO app design-system.css already implements.

- **Minimal vertical padding.** List items use approximately 6-8px vertical padding, not the 12-14px common in "generous spacing" systems.



The QBO app explicitly chose a different path: "Typography scale -- slightly larger for readability during long shifts" (from App.css comments). This is a valid accessibility decision. However, the current spacing values create situations where users must scroll through dashboard lists and sidebar conversations when tighter spacing would show more items without sacrificing readability. There is a middle ground.



### 5.3 Spacing System



Linear does not publish its spacing system, but inspection reveals an **8px base grid** with common increments of 4, 8, 12, 16, 24, 32, 48. The QBO app uses a 4px base (`--sp-1: 4px`) with an irregular progression (4, 6, 8, 12, 14, 16, 20, 24, 28, 36). The 6px and 14px steps break the grid, which can lead to misalignment. A cleaner progression would be 4, 8, 12, 16, 20, 24, 32, 40, 48 (multiples of 4, with some skips for larger values).



---



## 6. Motion and Interaction



### 6.1 Linear Animation Philosophy



Linear motion design follows one principle: **animation must be faster than the user expectation.** If a user clicks a button and the resulting change takes longer to animate than the user expects, the animation is slowing them down.



- **Transition budget: 100-200ms.** No transition in Linear exceeds 200ms for common operations.

- **Spring physics for spatial movement.** Elements that move position use spring-based easing rather than cubic-bezier curves.

- **Opacity-only for entrances.** New elements fade in with opacity over 100-150ms. They do not slide, scale, or bounce in.

- **No exit animations for common operations.** When an issue is moved to Done, it disappears instantly from the current list.

- **Snappy, not smooth.** A 150ms transition at `cubic-bezier(0.2, 0, 0, 1)` feels instant but not jarring.



### 6.2 Contrast with QBO App Current Approach



The QBO app motion design is more elaborate:



- `--duration-normal: 200ms` and `--duration-emphasis: 300ms` are within Linear budget.

- However, `.card-clickable:hover` has `transform: translateY(-2px)` lift effects, `.stat-card:hover` has `translateY(-3px)`, gallery thumbs use `translateY(-4px)`. These are decorative.

- Framer Motion is used extensively with AnimatePresence, spring physics, and page transitions -- architecturally sound but may produce longer-than-necessary durations for view changes.

- Compose card has a multi-layer box-shadow system with 5-6 shadow layers on focus. Linear would use a single 1px border-color change.



### 6.3 Recommended Motion Principles



| Operation | Budget | Easing |

|-----------|--------|--------|

| Hover state changes | 0-100ms | ease-out or instant |

| Status/toggle changes | 100ms | cubic-bezier(0.2, 0, 0, 1) |

| Panel open/close | 150-200ms | cubic-bezier(0.2, 0, 0, 1) |

| View transitions | 150ms | Opacity-only fade |

| Toast notifications | 200ms enter, 150ms exit | ease-out |

| Modal overlay | 200ms | Opacity fade + scale(0.98->1) |

| Destructive actions | 0ms (instant) + undo toast | n/a |

---



## 7. Accessibility Approach



### 7.1 What Linear Gets Right



**Keyboard-first design.** Every operation in Linear is keyboard-accessible, not as an afterthought but as the primary interaction mode. This exceeds WCAG 2.1.1 (keyboard accessibility) by design rather than remediation.



**Visible focus states.** Linear focus rings use a 2px indigo outline with offset, providing clear keyboard navigation indicators that satisfy WCAG 2.4.7 (Focus Visible).



**Contrast-based theming.** Linear LCH-based theme generator includes a **contrast variable** that can produce high-contrast themes automatically. Rather than maintaining separate high-contrast theme files, the contrast is a parameter of the generation algorithm.



**Status indicators use text + icon + color.** Status is never communicated through color alone. The workflow icons (empty circle, half-filled circle, checkmark circle, X circle) provide shape-based differentiation alongside color.



### 7.2 What Linear Could Do Better



**Screen reader support.** Linear keyboard shortcuts use single-letter keys (S for status, P for priority) which can conflict with screen reader navigation. There is limited public documentation on their ARIA implementation.



**Reduced motion support.** Linear animations are fast enough that `prefers-reduced-motion` users may not notice a significant difference, but the preference should still be respected (the QBO app already handles this well).



### 7.3 QBO App Current Accessibility



The QBO app has a strong accessibility foundation:



- `prefers-reduced-motion: reduce` is handled universally (design-system-v2.css)

- `prefers-contrast: more` and `prefers-contrast: less` media queries adjust borders, text weights, and contrast

- `:focus-visible` styling is implemented globally

- `.sr-only` utility class exists

- `.touch-target` utility ensures minimum 44x44px hit areas (Apple HIG)

- `:focus:not(:focus-visible)` removes outlines for mouse users



What is **missing** from the QBO app is the keyboard-first philosophy. The accessibility layer provides for users who need keyboard access, but the app is designed mouse-first with keyboard as a remediation. Linear designs keyboard-first with mouse as an alternative.

---



## 8. Application to QBO Escalation App



This is the most critical section. Every recommendation references specific files in the codebase.



### 8.1 Command Palette -- HIGHEST PRIORITY



**What:** A Cmd+K (Mac) / Ctrl+K (Windows) command palette that searches across all app entities and actions.



**Why:** An escalation specialist handles dozens of cases per shift. Currently, switching between views requires clicking sidebar items. Finding a specific escalation requires navigating to the dashboard, using the filter bar, and scrolling. A command palette collapses all of this into one keystroke + a few characters of typing.



**Scope of commands:**



- **Navigation:** "Go to Chat", "Go to Dashboard", "Go to Investigations", "Go to Settings"

- **Escalation search:** Type an escalation ID, customer name, or problem description to jump to it

- **Investigation search:** Type an INV number to open the investigation

- **Chat actions:** "New conversation", "Clear chat", "Switch to Claude", "Switch to Codex"

- **AI provider:** "Set provider to [X]", "Set reasoning effort to [high/low]"

- **Status changes:** "Mark as Resolved", "Mark as Escalated", "Mark as In Progress"

- **Utility:** "Copy response", "Export conversation", "Open Gmail", "Open Calendar"



**Implementation approach:**



- New component: `client/src/components/CommandPalette.jsx`

- Global keyboard listener in `client/src/App.jsx` (Cmd+K / Ctrl+K)

- Fuzzy search library: fuse.js (lightweight, well-tested)

- Register commands from each view component via a context provider

- Render as a modal overlay with AnimatePresence for enter/exit

- Each result shows its direct keyboard shortcut (if one exists) for passive learning



**Files to modify:**



- `client/src/App.jsx` -- Add global keydown listener and CommandPalette component

- `client/src/App.css` -- Minimal styles for palette overlay, input, results

- New: `client/src/components/CommandPalette.jsx`

- New: `client/src/components/CommandPalette.css`

- New: `client/src/context/CommandContext.jsx` -- Registry for commands from different views



### 8.2 Keyboard Shortcut Layer



**Proposed shortcuts for QBO app:**



**Global navigation:**



| Shortcut | Action |

|----------|--------|

| Cmd/Ctrl+K | Open command palette |

| G then C | Go to Chat |

| G then D | Go to Dashboard |

| G then I | Go to Investigations |

| G then P | Go to Playbook |

| G then T | Go to Templates |

| G then A | Go to Analytics |

| G then W | Go to Workspace |

| G then S | Go to Settings |

| ? | Show keyboard shortcut help |

| Escape | Close current panel/modal |



**Chat view:**



| Shortcut | Action |

|----------|--------|

| / | Focus chat input |

| Cmd/Ctrl+Enter | Send message |

| Cmd/Ctrl+Shift+N | New conversation |

| Cmd/Ctrl+Shift+C | Copy last response |

| Cmd/Ctrl+. | Abort streaming |



**Dashboard view:**



| Shortcut | Action |

|----------|--------|

| J / Down | Next escalation |

| K / Up | Previous escalation |

| Enter | Open selected escalation |

| S | Change status of selected |

| / | Focus search/filter |



**Investigation view:**



| Shortcut | Action |

|----------|--------|

| N | New investigation |

| J / K | Navigate list |

| Enter | Open selected |

| S | Change status |



**Implementation:**



- New: `client/src/hooks/useKeyboardShortcuts.js` -- Global shortcut manager

- New: `client/src/components/ShortcutHelp.jsx` -- Overlay showing all shortcuts (triggered by ?)

- Modify `client/src/App.jsx` -- Register global shortcuts

- Each view component registers its own context-sensitive shortcuts

### 8.3 Information Density Adjustments



**Sidebar (`client/src/components/Sidebar.css`):** Reduce nav item `min-height` from 38px to 34px, reduce padding from 8px 14px to 6px 12px, reduce gap between items from 2px to 1px. This would show approximately 2-3 more nav items without scrolling on a 1080p display.



**Dashboard escalation cards (`client/src/App.css`, `.esc-card`):** Reduce padding from 14px to 12px or 10px, reduce title font-size from 15.5px to 14.5px. This would show approximately 1-2 more escalation cards per screen.



**Filter bar (`client/src/App.css`, `.filter-bar`):** Reduce padding from 14px to 8px vertical, reduce gap from 8px to 6px. This recovers 12px of vertical space.



The goal is not to replicate Linear extreme density (which would hurt readability during 8+ hour shifts) but to recover space where padding exceeds its functional purpose.



### 8.4 Shadow and Decoration Reduction



Linear approach: borders over shadows, single-layer effects over multi-layer stacks.



Current QBO patterns that are more decorative than functional:



1. **`.card`** uses a gradient background + multi-layer shadow + inset-top highlight. Linear would use flat `background: var(--bg-raised); border: 1px solid var(--line);`

2. **`.compose-card`** has 6 shadow layers on focus state (in `client/src/components/Chat.css`). Linear would use `border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent);`

3. **`.btn-primary`** uses a 3-stop linear gradient + text-shadow + inset highlight. Linear would use flat `background: var(--accent); color: #fff;`

4. **`.badge`** has border-bottom, box-shadow (3 layers), and text-shadow. Linear badges are flat with just background and color.



**Recommendation:** Do NOT strip all decoration. Apply the Linear principle selectively: remove decoration from **high-frequency elements** (list items, badges, table rows) and preserve it on **low-frequency elements** (page headers, modal dialogs, the compose card).



### 8.5 Status Workflow Icons



Linear circular status icons (empty, half-filled, filled+check, X) are more information-dense than text badges. Add small SVG status icons alongside the text badges in the dashboard and escalation detail views. This provides dual encoding (icon shape + color + text) which is both more accessible and more scannable.



**Files:** New `client/src/components/StatusIcon.jsx`, modify `client/src/components/EscalationDashboard.jsx` and `client/src/components/EscalationDetail.jsx`.



### 8.6 Sidebar Refinement



Current QBO sidebar issues:



- `backdrop-filter: blur(16px) saturate(1.4)` and multi-layer box-shadow (4 layers in Sidebar.css) -- visually heavy

- Hover states use gradient background with inset shadow -- Linear uses a flat background-color change

- Section title uses `text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600` -- loudest possible treatment for a label



**Recommended changes to `client/src/components/Sidebar.css`:**



- Reduce box-shadow from 4 layers to `var(--shadow-sm)` or a single 1px right border

- Remove `backdrop-filter` -- the sidebar does not overlay content, so blur is decorative

- Simplify hover state to: `background: var(--bg-sunken);` (no gradient, no inset shadow)

- Soften section titles: remove uppercase or reduce letter-spacing to 0.04em



### 8.7 Theme Architecture -- LCH Color Generation



Linear approach of generating all theme tokens from three inputs (base, accent, contrast) is architecturally superior to maintaining separate light/dark token sets manually. The QBO app currently defines 80+ CSS custom properties per mode in App.css.



**Future recommendation:** Build a theme generator that takes three inputs and derives all tokens using CSS `color-mix()` in OKLCH. This would allow users to create custom themes by picking just an accent color, automatically generate accessible high-contrast variants, and reduce maintenance burden.



**Files:** `client/src/App.css`, `client/src/hooks/useTheme.js`, `client/src/themes/*.css`



### 8.8 Undo Over Confirmation



Replace ConfirmModal usage for low-stakes deletions (deleting a conversation, removing a template) with immediate execution + a 5-second undo toast. Keep confirmation modals for high-stakes actions (deleting an escalation record, revoking Gmail access).



**Files:** `client/src/components/Sidebar.jsx` (replace ConfirmModal for conversations), `client/src/hooks/useToast.jsx` (add undo capability).



### 8.9 Contextual Action Menus



Add right-click context menus to sidebar conversation items, escalation cards in the dashboard, investigation items, and chat messages (copy, retry, etc.). Implement as a single reusable ContextMenu component with keyboard navigation support.

---



## 9. What NOT to Copy



### 9.1 Do Not Go Full Monochrome



Linear near-monochromatic approach works for an issue tracker where issues are differentiated by text content. The QBO app handles multiple entity types (escalations, investigations, chat conversations, emails, calendar events) with different urgency levels. The existing category badge color system (`--cat-payroll-bg`, `--cat-bank-feeds-bg`, etc.) serves a real purpose: when an escalation specialist scans a dashboard, color-coded categories provide instant recognition. Removing this would harm workflow speed.



### 9.2 Do Not Abandon Warm Neutrals



The "Warm Authority" color identity (warm cream/stone in light mode, warm obsidian in dark mode) is a considered choice that differentiates the QBO app from cold developer tools. Linear cool grays work for a developer audience; they would feel sterile for a support tool used during high-stress escalation calls.



### 9.3 Do Not Strip All Shadows



The QBO app multi-layer shadow system creates depth and hierarchy. Linear "borders over shadows" approach works in dark mode but can make light-mode interfaces feel flat. The QBO app should reduce shadow *count* per element but not eliminate shadows entirely.



### 9.4 Do Not Copy Linear Sparse Empty States



Linear empty states are extremely minimal. The QBO app `empty-state-enhanced` pattern with icon + title + description + subtitle is more helpful for a tool where users may not know what to do. Keep the richer empty states.



### 9.5 Do Not Force Dark-First



QBO escalation specialists work in offices with overhead lighting, on shared workstations, and sometimes in well-lit environments where dark mode causes glare. The app should continue supporting both modes equally. Do not make light mode a second-class citizen.



### 9.6 Do Not Over-Shorten Animations



The QBO app `--duration-normal: 200ms` is already within Linear budget. The current animation timings are fine -- the issue is animation *complexity* (too many simultaneous properties animating), not duration.



---



## 10. Implementation Priority



Ranked by impact on escalation specialist workflow divided by implementation effort.



### Tier 1 -- High Impact, Moderate Effort (Do First)



| # | Feature | Impact | Effort | Notes |

|---|---------|--------|--------|-------|

| 1 | **Command Palette (Cmd+K)** | Very High | 2-3 days | Single most impactful UX addition. Transforms navigation speed. |

| 2 | **Keyboard shortcut layer** | High | 2 days | G-prefix navigation, view-specific shortcuts, ? for help overlay. |

| 3 | **Undo toasts for deletions** | Medium-High | 0.5 days | Replace ConfirmModal for conversations. Quick win for flow. |



### Tier 2 -- Medium Impact, Low Effort (Quick Wins)



| # | Feature | Impact | Effort | Notes |

|---|---------|--------|--------|-------|

| 4 | **Sidebar density reduction** | Medium | 0.5 days | Tighten padding, reduce min-height, simplify hover states. |

| 5 | **Shadow reduction on high-frequency elements** | Medium | 0.5 days | Flatten badges, list items, filter bar. Keep cards/modals rich. |

| 6 | **Status icons** | Medium | 1 day | SVG circular status indicators alongside text badges. |



### Tier 3 -- Medium Impact, Higher Effort (Plan For Later)



| # | Feature | Impact | Effort | Notes |

|---|---------|--------|--------|-------|

| 7 | **Context menus** | Medium | 2 days | Right-click menus for sidebar, dashboard, chat messages. |

| 8 | **Sidebar simplification** | Low-Medium | 1 day | Remove backdrop-filter, simplify shadows, soften section titles. |

| 9 | **Compose card simplification** | Low-Medium | 0.5 days | Reduce shadow layers on focus from 6 to 2. |



### Tier 4 -- Strategic Investment (Future Architecture)



| # | Feature | Impact | Effort | Notes |

|---|---------|--------|--------|-------|

| 10 | **LCH/OKLCH theme generator** | Medium | 3-5 days | Algorithmic theme generation from 3 inputs. Future-proof. |

| 11 | **Spacing system cleanup** | Low | 1 day | Align spacing tokens to consistent 4px multiples. |

| 12 | **Animation audit** | Low | 1 day | Remove hover-lift effects, simplify entrance animations. |



---



## Sources



- [How We Redesigned the Linear UI (Part II) -- Linear Blog](https://linear.app/now/how-we-redesigned-the-linear-ui)

- [A Calmer Interface for a Product in Motion -- Linear Blog](https://linear.app/now/behind-the-latest-design-refresh)

- [Linear Design: The SaaS Design Trend -- LogRocket Blog](https://blog.logrocket.com/ux-design/linear-design/)

- [The Rise of Linear Style Design -- Medium/Bootcamp](https://medium.com/design-bootcamp/the-rise-of-linear-style-design-origins-trends-and-techniques-4fd96aab7646)

- [Accessible Linear Design Across Light and Dark Modes -- LogRocket](https://blog.logrocket.com/how-do-you-implement-accessible-linear-design-across-light-and-dark-modes/)

- [Linear Method -- Practices for Building](https://linear.app/method)

- [Linear Keyboard Shortcuts -- shortcuts.design](https://shortcuts.design/tools/toolspage-linear/)

- [Linear Keyboard Shortcuts -- keycombiner.com](https://keycombiner.com/collections/linear/)

- [Issue Status Configuration -- Linear Docs](https://linear.app/docs/configuring-workflows)

- [Cycles -- Linear Docs](https://linear.app/docs/use-cycles)

- [Concepts -- Linear Docs](https://linear.app/docs/conceptual-model)

- [How to Build a Remarkable Command Palette -- Superhuman Blog](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)

- [Command Palette UX Patterns -- Medium](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1)

- [Linear App Case Study -- Eleken](https://www.eleken.co/blog-posts/linear-app-case-study)

- [Linear Style -- Code Editor Themes](https://linear.style/)

- [Linear App Review 2026 -- siit.io](https://www.siit.io/tools/trending/linear-app-review)



---



*This report is a living document. As Linear continues to evolve its design system (their 2025 refresh was the most recent major update), specific color values and implementation details may shift. The principles and patterns documented here are stable and have been consistent across multiple years of Linear evolution.*
