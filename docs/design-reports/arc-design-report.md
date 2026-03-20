# Arc Browser Design System Report — Arc Browser UI

**Prepared for:** QBO Escalation Assistant
**Date:** 2026-03-20
**Brand:** Arc Browser (The Browser Company)
**Design System:** Arc Browser UI

---

## 1. Executive Summary

Arc Browser's design philosophy can be distilled into one sentence: **the browser should disappear so the internet becomes your computer.** Built by The Browser Company of New York, Arc radically reimagines the browser as an operating system layer rather than a passive content window — collapsing tabs into a sidebar workspace, organizing contexts into color-coded Spaces, and making the browser chrome as invisible as possible.

**Top three ideas the QBO app should steal (ranked):**

1. **Space-inspired context switching** — Arc's color-coded Spaces let users maintain completely separate workspace contexts with a single swipe. For the QBO app, this maps directly to having distinct visual contexts for Escalation Triage, INV Investigation, and General Research, each with its own sidebar state, color accent, and pinned views.

2. **Command Bar as universal action hub** — Arc's Cmd+T Command Bar replaces the URL bar, tab search, bookmark search, and action palette in a single floating overlay. The QBO app could unify its search, slash commands, and navigation into one keyboard-triggered command palette, dramatically accelerating specialist workflow.

3. **Translucent vibrancy sidebar with backdrop-filter** — Arc's sidebar uses macOS vibrancy to create visual depth without hard borders. The QBO app already uses `backdrop-filter: blur(20px) saturate(180%)` on its sidebar header; extending this treatment to the full sidebar would create a more modern, layered feel that reduces visual weight of the chrome.

**Context comparison:** Arc targets power users who juggle dozens of tabs across work, personal, and creative contexts. QBO escalation specialists similarly juggle multiple cases, tools, and reference materials during 8+ hour shifts. Both user bases value speed, keyboard shortcuts, and minimal friction — but the QBO specialist needs *information density* that Arc deliberately sacrifices for aesthetic minimalism.

**What QBO already does well:** The warm authority palette, comprehensive theme system (18+ themes), and robust design token architecture already provide a mature foundation. The QBO sidebar with `backdrop-filter` vibrancy and multi-layer shadows aligns well with Arc's translucent aesthetic.

**What QBO is missing:** Context-aware workspace switching, a unified command palette, and the fluid spring-physics animations that make Arc feel alive and responsive.

---

## 2. Design Philosophy

### Stated Principles

Arc Browser's design team, led by CEO Josh Miller and designer Hursh Agrawal, has articulated several core principles through blog posts on thebrowsercompany.com, conference presentations, and product launches:

1. **"The browser should get out of the way."** Chrome — toolbars, tab strips, buttons — should consume minimal screen space. The user's content should occupy approximately 95% of visible area. This manifests in Arc hiding the URL bar by default (showing only the site name), auto-collapsing the sidebar, and removing the traditional horizontal tab strip entirely.

2. **"The internet is your computer."** The browser is not just a viewer; it is the user's primary workspace. This elevates the browser to OS-level responsibility for organization, context switching, and workflow management. Arc implements this through Spaces (workspaces), Easels (whiteboards), Boosts (website customization), and Air Traffic Control (tab routing rules).

3. **Personalization is a first-class feature.** Users should be able to customize not just browser settings but the websites they visit. The Boost system lets users inject custom CSS and JavaScript into any website, change fonts, hide distracting elements, and share these modifications with the community.

4. **Calm computing through automatic maintenance.** Tab overload is the enemy of focus. Arc auto-archives tabs in the "Today" section after 12 hours by default (configurable to 24h, 7d, or 30d), ensuring the sidebar stays clean without requiring manual cleanup.

### How Principles Manifest in Product Decisions

Arc's "browser-invisible" philosophy produces concrete design choices that go far beyond aesthetic preference. The sidebar replaces the top tab bar — a radical structural change that reclaims the horizontal space where traditional browsers stack dozens of tiny, unreadable tab titles. By moving tabs vertically, Arc can show full page titles, group them hierarchically with folders, and distinguish between persistent (Pinned) and ephemeral (Today) tabs.

The Command Bar (triggered by Cmd+T) replaces the URL bar as the primary interaction point. Instead of a permanently visible address field, users get a Spotlight-like floating overlay that searches across open tabs, bookmarks, history, Google, and browser actions simultaneously. This "search everything" pattern reduces cognitive load — the user never needs to decide *where* to look, only *what* to look for.

### User Optimization

Arc optimizes for **knowledge workers who live in their browser** — designers, developers, researchers, and project managers who maintain 20-100+ tabs across multiple work contexts. This maps surprisingly well to escalation specialists who maintain reference cases, knowledge base articles, communication tools, and tracking dashboards simultaneously.

### Dark Mode Philosophy

Arc is **dark-first**. The initial release featured a dark translucent sidebar as the default, with the iconic vibrancy blur effect that became the brand's visual signature. Light mode was added later but treated as an equal variant. The sidebar adapts its translucency to both modes, and Space colors automatically desaturate in dark mode to prevent glare during extended use.

### Brand Identity Through Color

Arc's accent color is not a single fixed hue — it is **user-chosen per Space**. This is a radical departure from traditional brand color systems. Rather than a brand-blue or brand-green, Arc's identity is the *gradient itself* — the idea that your browser reflects your personality. The default Space colors span the full spectrum: red (#E5484D), orange (#F76B15), blue (#0091FF), purple (#8E4EC6), pink (#E93D82), and more. This communicates openness, creativity, and personal ownership.

### Content vs. Chrome Balance

Arc achieves an extreme content-to-chrome ratio. When the sidebar is collapsed (its default state for focused work), the browser window is nearly 100% web content. Even when expanded, the sidebar's translucent vibrancy makes it feel lightweight — it exists *on top of* content rather than *displacing* it. For the QBO app, this philosophy suggests that escalation data should dominate the viewport, with navigation and tools available on-demand but not constantly consuming space.

---

## 3. Key Design Patterns

### 3.1 Sidebar-as-Workspace

**What it is:** Arc replaces the horizontal tab strip with a vertical sidebar (~260px wide) containing three distinct sections: Favorites (icon-only row at the top, always visible), Pinned Tabs (persist across sessions, organized in folders), and Today Tabs (ephemeral, auto-archived after 12 hours). The sidebar collapses completely when not in use and reappears on hover or keyboard shortcut (Cmd+\).

**Why it works:** Vertical space is abundant on modern widescreen monitors; horizontal space is precious. A vertical sidebar can display full page titles, support hierarchical grouping, and clearly separate persistent from ephemeral items — all impossible in a cramped horizontal tab strip.

**QBO application:** The QBO sidebar (`client/src/components/Sidebar.css`, 280px width) already uses a vertical layout. Arc's three-tier model (Favorites/Pinned/Today) could inspire organizing QBO navigation into: Quick Access (icon-only row for Chat, Dashboard, Gmail), Pinned Views (escalation cases currently being tracked), and Recent (recently viewed escalations that auto-clear).

### 3.2 Color-Coded Spaces (Context Switching)

**What it is:** Spaces are color-coded workspace contexts, each with its own set of tabs, pinned items, and a unique gradient theme that tints the entire sidebar. Users switch Spaces with a horizontal swipe or Ctrl+1-9, and the sidebar smoothly morphs between colors over ~350-400ms with spring physics.

**Why it works:** Color creates instant spatial orientation. Users know where they are without reading labels — the red Space is work, the blue Space is personal, the green Space is a specific project. This leverages the brain's preattentive processing of color.

**QBO application:** The QBO app could implement workspace modes — Escalation Mode (ember amber accent), Investigation Mode (a distinct accent like deep blue), and Research Mode (another accent like teal). Each mode would highlight relevant sidebar items, change the accent tint, and filter the dashboard to context-appropriate content. The existing theme system in `client/src/themes/` provides the infrastructure.

### 3.3 Command Bar (Universal Search/Action)

**What it is:** A floating overlay (~600px wide) triggered by Cmd+T that searches across tabs, bookmarks, history, Google, and browser actions. It appears at center screen with a scale-up animation (~200-250ms, spring-damped) and shows results in a vertically expanding list with staggered entry animations.

**Why it works:** It eliminates the "where do I go to do this?" question. One keyboard shortcut, one input field, every possible action. This is the power-user pattern that tools like Spotlight, Raycast, and VS Code's Command Palette have proven effective.

**QBO application:** The QBO app has slash commands in the chat. A global Command Palette (Ctrl+K) that searches across escalation cases, INV investigations, knowledge base articles, settings, and app actions would dramatically accelerate workflow. The existing slash command system in `client/src/components/Chat.css` could be promoted to app-wide scope.

### 3.4 Split View (Multi-Pane Workspace)

**What it is:** Users can tile up to 4 tabs in a single window by dragging one tab onto another. Splits can be horizontal or vertical with resize handles between panes. Creation animates at ~300ms with spring physics.

**Why it works:** It eliminates window-juggling for comparison tasks. Users can view reference material alongside active work without switching windows or Alt-Tabbing.

**QBO application:** A split-view in the QBO app would let specialists view a playbook article alongside the active chat, or compare two escalation cases side-by-side. The Agent Dock already provides a side panel; extending this to support arbitrary content panes would be the natural evolution.

### 3.5 Automatic Color Extraction

**What it is:** Arc extracts the dominant color from the active website and subtly tints the toolbar and sidebar to match. This "chameleon effect" makes each website feel like it belongs to the browser's visual identity rather than fighting against it.

**Why it works:** It reduces visual jarring when switching between sites with different brand colors. The browser feels cohesive rather than like a neutral frame containing disconnected content.

**QBO application:** The QBO app could extract the primary color from category badges and use it to subtly tint the header or sidebar when viewing a specific escalation category. Payroll escalations could carry a warm tint, while banking escalations carry a cool tint, providing instant visual context.

### 3.6 Translucent Vibrancy Sidebar

**What it is:** Arc's sidebar uses macOS vibrancy (NSVisualEffectView) to create a semi-transparent, blurred panel. The content behind the sidebar shows through subtly, creating depth without hard opaque boundaries.

**Why it works:** It makes the sidebar feel lightweight and layered, reducing the visual weight of navigation chrome. The user perceives the sidebar as floating above content rather than consuming space alongside it.

**QBO application:** The QBO sidebar already applies `backdrop-filter: blur(20px) saturate(180%)` to the header. Extending this to the full sidebar background (in `client/src/components/Sidebar.css`) with a semi-transparent `--bg-sidebar` value would achieve a similar effect.

### 3.7 Tab Auto-Archive (Calm Computing)

**What it is:** Tabs in the "Today" section automatically archive after 12 hours (configurable). Archived tabs are accessible via search but no longer clutter the sidebar. This enforces tab hygiene without requiring manual cleanup.

**Why it works:** It acknowledges that most tabs are ephemeral reference material. By auto-clearing them, the workspace stays focused on what matters now.

**QBO application:** The QBO dashboard could auto-archive resolved escalations after a configurable time, moving them from the active view to a searchable archive. This reduces visual clutter during a shift while preserving access to historical cases.

---

## 4. Color System

### 4.1 Complete Palette with Hex Values

Arc's color system is unique in that it is **user-driven** rather than brand-prescribed. The sidebar takes on the color of the active Space, chosen from a continuous color picker or presets. The following table documents the known color values:

**Space/Theme Colors (Approximate — from community analysis):**

| Token/Name | Hex Value | RGB | Usage |
|------------|-----------|-----|-------|
| Space Red | #E5484D | 229, 72, 77 | Red workspace accent |
| Space Red Gradient | #FF6369 | 255, 99, 105 | Red gradient endpoint |
| Space Orange | #F76B15 | 247, 107, 21 | Orange workspace accent |
| Space Orange Gradient | #FF8B3E | 255, 139, 62 | Orange gradient endpoint |
| Space Yellow | #FFB224 | 255, 178, 36 | Yellow workspace accent |
| Space Yellow Gradient | #FFD60A | 255, 214, 10 | Yellow gradient endpoint |
| Space Green | #30A46C | 48, 164, 108 | Green workspace accent |
| Space Green Gradient | #3DD68C | 61, 214, 140 | Green gradient endpoint |
| Space Teal | #12A594 | 18, 165, 148 | Teal workspace accent |
| Space Teal Gradient | #0BD8B6 | 11, 216, 182 | Teal gradient endpoint |
| Space Blue | #0091FF | 0, 145, 255 | Blue workspace accent |
| Space Blue Gradient | #52A9FF | 82, 169, 255 | Blue gradient endpoint |
| Space Indigo | #3E63DD | 62, 99, 221 | Indigo workspace accent |
| Space Indigo Gradient | #849DFF | 132, 157, 255 | Indigo gradient endpoint |
| Space Purple | #8E4EC6 | 142, 78, 198 | Purple workspace accent |
| Space Purple Gradient | #BF7AF0 | 191, 122, 240 | Purple gradient endpoint |
| Space Pink | #E93D82 | 233, 61, 130 | Pink workspace accent |
| Space Pink Gradient | #FF70B8 | 255, 112, 184 | Pink gradient endpoint |

**UI Colors:**

| Token/Name | Hex Value | RGB | Usage |
|------------|-----------|-----|-------|
| Light Sidebar Base | #F5F5F5 | 245, 245, 245 | Sidebar background (light mode, pre-vibrancy) |
| Dark Sidebar Base | #1A1A1A | 26, 26, 26 | Sidebar background (dark mode, pre-vibrancy) |
| Light Content BG | #FFFFFF | 255, 255, 255 | Web content area (light) |
| Dark Content BG | #1E1E1E | 30, 30, 30 | Web content area (dark) |
| Light URL Bar | #E8E8E8 | 232, 232, 232 | URL input field (light) |
| Dark URL Bar | #2A2A2A | 42, 42, 42 | URL input field (dark) |
| Light Primary Text | #1A1A1A | 26, 26, 26 | Primary text (light) |
| Dark Primary Text | #ECECEC | 236, 236, 236 | Primary text (dark) |
| Light Secondary Text | #6E6E6E | 110, 110, 110 | Secondary text (light) |
| Dark Secondary Text | #A0A0A0 | 160, 160, 160 | Secondary text (dark) |
| Light Muted Text | #999999 | 153, 153, 153 | Tertiary/muted (light) |
| Dark Muted Text | #666666 | 102, 102, 102 | Tertiary/muted (dark) |
| Success | #30A46C | 48, 164, 108 | Positive/success states |
| Warning | #FFB224 | 255, 178, 36 | Caution/warning states |
| Error | #E5484D | 229, 72, 77 | Error/destructive states |
| Info | #0091FF | 0, 145, 255 | Informational states |

*Note: Arc does not publish official design tokens. These values are approximations from community analysis, screenshots, and design recreations. Arc's colors appear to align with the Radix UI color palette.*

### 4.2 Surface Hierarchy

**Light Mode:**

| Level | Hex | Usage |
|-------|-----|-------|
| Deepest/Sunken | #EBEBEB | Recessed areas, insets |
| Base | #F5F5F5 | Sidebar, toolbar background |
| Raised/Card | #FFFFFF | Content area, cards |
| Elevated/Floating | #FFFFFF + shadow | Command Bar, popovers |

**Dark Mode:**

| Level | Hex | Usage |
|-------|-----|-------|
| Deepest/Sunken | #0D0D0D | Behind vibrancy layer |
| Base | #1A1A1A | Sidebar, toolbar background |
| Raised/Card | #2A2A2A | Input fields, cards |
| Elevated/Floating | #2E2E2E | Command Bar, dropdowns |
| Highest | #3A3A3A | Tooltips, popovers |

### 4.3 Color Architecture

Arc's color system is organized around a few key principles:

- **User-driven accent**: Unlike traditional design systems with fixed brand colors, Arc's accent is the user's Space color. This means the entire color system pivots around a user-chosen hue.
- **Neutral chrome**: The chrome (sidebar, toolbar) uses pure neutral grays — no warm or cool bias. This prevents the chrome from clashing with any Space color.
- **Vibrancy as a surface strategy**: Rather than using distinct surface colors, Arc uses translucency with macOS vibrancy. The sidebar's "color" comes from the blurred content behind it plus the Space color tint.
- **Semantic colors from Radix UI**: The success/warning/error/info colors appear to align with the Radix UI color palette (an open-source color system designed for accessibility).
- **Borders via alpha**: Arc uses very subtle borders with alpha transparency — `rgba(0,0,0,0.06)` to `rgba(0,0,0,0.12)` in light mode, inverted in dark. This ensures borders adapt naturally to any background.

Token naming follows a functional pattern: elements are referred to by role (sidebar, toolbar, content) rather than abstract levels (surface-1, surface-2). Theming is implemented at the native SwiftUI level rather than via CSS custom properties.

### 4.4 Comparison with QBO App

| Concept | Arc Browser | QBO App | Analysis |
|---------|-------------|---------|----------|
| Background | #F5F5F5 (cool neutral) | #f5f2ed (warm cream) | QBO's warm tones are more suitable for long shifts — warm neutrals reduce eye strain vs. cool grays |
| Text Primary | #1A1A1A (pure dark) | #2a2420 (warm dark) | Both achieve excellent contrast. QBO's warm tint is intentional for brand cohesion |
| Accent | User-chosen per Space | #c76a22 (ember amber) | Arc's per-context accent is the key innovation worth adapting; QBO could shift accents per workspace mode |
| Success | #30A46C | #2E7D52 | Nearly identical hue family. QBO's is slightly darker/more muted — appropriate for professional context |
| Warning | #FFB224 | #B8860B | Arc's is significantly brighter/more vibrant. QBO's darker gold is better for 8-hour viewing |
| Danger | #E5484D | #b33025 | Arc's is brighter red; QBO's deeper red is less fatiguing and more authoritative |
| Info | #0091FF | Uses accent | Arc's dedicated info blue would benefit QBO — separating info from accent improves semantic clarity |
| Sidebar | #F5F5F5 + vibrancy (cool) | #f8f6f2 (warm cream) | QBO's warm sidebar matches the warm authority identity better than Arc's cool neutral |

The QBO app's "Warm Authority" identity — warm cream backgrounds, ember amber accent, muted semantics — is better suited for extended professional use than Arc's cool neutral palette. However, Arc's concept of **context-adaptive accent colors** is the single most transferable idea from the color system.

---

## 5. Typography and Spacing

### 5.1 Typography

Arc relies entirely on platform-native system fonts rather than shipping a custom typeface:

| Level | Font Family | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|-------------|------|--------|-------------|----------------|-------|
| Display | SF Pro Display | 24-28px | 700 | 1.2 | -0.02em | Large headings (settings) |
| Heading | SF Pro Text | 15-16px | 600 | 1.3 | -0.01em | Section headings |
| Title | SF Pro Text | 14px | 500 | 1.3 | 0 | Site names in URL bar |
| Body | SF Pro Text | 13px | 400 | 1.4 | 0 | Tab titles, descriptions |
| Caption | SF Pro Text | 11px | 600 | 1.2 | 0.5px | Section headers (uppercase) |
| Overline | SF Pro Text | 10px | 500 | 1.2 | 0.3px | Favorites labels |

**QBO comparison:** The QBO app uses Inter (14.5px base) with JetBrains Mono for monospace. Inter and SF Pro share similar design principles — high x-height, open apertures, excellent readability at small sizes. Arc's slightly smaller base size (13px) reflects the browser's aesthetic minimalism; QBO's 14.5px is more appropriate for information-dense content that must be scanned quickly.

### 5.2 Spacing System

Arc uses an 8px base grid (standard in macOS/iOS design):

| Token | Value | Usage |
|-------|-------|-------|
| Micro | 4px | Icon padding, tight gaps |
| Small | 8px | Inter-element spacing, list padding |
| Medium | 12px | Section padding, card insets |
| Standard | 16px | Component padding, sidebar padding |
| Large | 24px | Section gaps, content margins |
| XL | 32px | Major section spacing |

**QBO comparison:** The QBO app uses a 4px base grid (--sp-1: 4px through --sp-24: 96px), which provides finer granularity than Arc's 8px grid. The 4px grid is better suited for information-dense UIs where precise spacing control matters. No change recommended.

### 5.3 Border Radius Scale

Arc is known for generous, soft border radii:

| Element | Value | Usage |
|---------|-------|-------|
| Tab hover | 8px | Sidebar tab highlight |
| Buttons | 8px | Standard interactive elements |
| URL bar | 8-10px | Search/address input |
| Command Bar | 12-16px | Floating overlay |
| Color picker | 50% | Circular Space color dots |
| Window corners | 10px | macOS native window rounding |

**QBO comparison:** QBO uses xs(3px), sm(4px), md(8px), lg(12px), xl(16px), 2xl(20px), pill(9999px). The scales overlap closely at the md-xl range. Arc's slightly rounder feel comes from consistently using 8px+ radii even for small elements — QBO's 3-4px on small elements creates a slightly sharper feel that reads as more professional and data-oriented.

---

## 6. Animation and Motion

### 6.1 Motion Philosophy

Arc is celebrated for having some of the most fluid animations in any desktop application. Built with SwiftUI on macOS, it leverages native spring physics and ProMotion 120Hz rendering. The philosophy is:

- **Everything animates** — no element appears or disappears without a transition
- **Spring physics over linear/ease** — almost all animations use spring curves for a natural, physical feel
- **Playful but fast** — animations are noticeable but never impede workflow; close animations are faster than open animations
- **Spatial continuity** — elements animate from their logical position, maintaining spatial relationships

### 6.2 Duration Scale

| Category | Duration | Easing | Usage |
|----------|----------|--------|-------|
| Micro-interactions | 100-150ms | Ease-out | Tab hover highlight, button press |
| Small transitions | 150-200ms | Ease-out / Snappy spring | Tab close, menu open |
| Medium transitions | 200-300ms | Standard spring | Command Bar open, sidebar toggle |
| Large transitions | 300-400ms | Gentle spring | Space switching with color morph |

### 6.3 Easing Curves

**SwiftUI Spring Configs:**
- Standard: `.spring(response: 0.3, dampingFraction: 0.8)` — most interactions
- Snappy: `.spring(response: 0.25, dampingFraction: 0.9)` — quick feedback
- Gentle: `.spring(response: 0.5, dampingFraction: 0.7)` — large movements

**CSS Cubic-Bezier Approximations:**
- Standard: `cubic-bezier(0.25, 0.46, 0.45, 0.94)`
- Snappy: `cubic-bezier(0.22, 0.61, 0.36, 1)`
- Emphasized: `cubic-bezier(0.2, 0, 0, 1)`

### 6.4 Specific Animation Patterns

1. **Space color morphing** — Sidebar gradient smoothly interpolates between Space colors over ~350ms when switching workspaces. The entire sidebar shifts hue in a continuous transition.

2. **Command Bar entrance** — Scales from 0.95 to 1.0 with fade-in over ~200-250ms using a damped spring. Close is faster (~150-200ms) with ease-out.

3. **Staggered result items** — Command Bar search results animate in with ~30ms staggered delays per item, creating a cascade effect.

4. **Sidebar expand/collapse** — Slides from left with spring physics over ~250-300ms. Content area resizes simultaneously.

5. **Tab close** — Tab slides up and fades out over ~200ms with ease-out. Remaining tabs reflow with spring interpolation.

6. **Favicon bounce** — New tab favicons have a subtle scale bounce on initial load.

7. **Little Arc entrance** — Mini-browser window scales up from the position of the clicked link over ~300ms with spring physics.

8. **Split view snap** — Dragging a tab near a split zone triggers a snap indicator that scales in, and releasing creates the split with a ~300ms spring animation.

### 6.5 Comparison with QBO

The QBO app uses Framer Motion 12 with spring physics, a 200ms "sweet spot" for most transitions, and comprehensive easing tokens (--ease-standard, --ease-decelerate, --ease-accelerate, --ease-emphasized). The `prefers-reduced-motion` media query is fully respected.

Arc's motion system is notably more expressive — it uses staggered animations, spatial continuity (elements animate from where they logically "come from"), and spring physics for nearly everything. The QBO app could benefit from:
- Adding staggered entry animations to list items (dashboard cards, escalation rows)
- Using spring physics more aggressively via Framer Motion's `spring` type
- Implementing spatial entrance/exit animations (panels slide from their logical edge)

---

## 7. Iconography

Arc uses a hybrid icon approach combining **Apple SF Symbols** (the system icon library on macOS) with custom-designed icons for Arc-specific features like Spaces, Boosts, Easels, and Little Arc.

**Style:** Primarily outlined/line icons at default weight, with filled variants used for active/selected states. This outlined-to-filled transition provides clear feedback about the current state without adding visual clutter to inactive elements.

**Sizes:**
- Sidebar action buttons: 16px
- Toolbar icons: 18-20px
- Favorites (favicons): 20px
- Settings page icons: 20-24px
- Command Bar result icons: 16-18px

**Stroke width:** Consistent 1.5px matching SF Symbols Regular weight, with some high-visibility icons at 2px stroke.

**Color treatment:** Icons inherit the current text color by default (`currentColor`), with accent-colored icons used sparingly for primary actions and active states. In the sidebar, icon color shifts to match the Space color for active tab indicators.

**QBO relevance:** The QBO app could adopt the outlined-to-filled state pattern for sidebar navigation icons — showing outlined icons by default and filled variants for the active view. This provides stronger wayfinding without additional color or background treatment.

---

## 8. Accessibility

### WCAG Compliance

Arc Browser has not publicly stated a specific WCAG compliance level. As a Chromium-based browser, it inherits Chromium's web accessibility features (ARIA support, landmarks, roles) for rendered web content. The browser's own chrome accessibility is implemented through macOS accessibility APIs.

### Color Contrast

Arc's text colors achieve adequate contrast in most configurations:
- Light mode: #1A1A1A on #F5F5F5 yields approximately 14.5:1 ratio (exceeds AAA)
- Dark mode: #ECECEC on #1A1A1A yields approximately 15.3:1 ratio (exceeds AAA)
- Secondary text contrast is lower but still meets AA requirements

The heavy reliance on Space colors (user-chosen hues applied to UI chrome) creates potential contrast issues — a light yellow Space color on a white sidebar could fail contrast requirements. Arc mitigates this by using Space colors primarily as background tints rather than text colors.

### Focus Indicators

Arc uses the macOS system focus ring — a blue outline around focused elements, matching the system accessibility settings. This ensures consistency with the operating system and respects user customization of focus ring appearance.

### Keyboard Navigation

Major keyboard shortcuts:
| Shortcut | Action |
|----------|--------|
| Cmd+T | Open Command Bar |
| Cmd+S | Pin current tab |
| Cmd+D | Add to Favorites |
| Ctrl+Tab | Switch between tabs |
| Cmd+Shift+[ / ] | Switch between Spaces |
| Cmd+\ | Toggle sidebar visibility |
| Cmd+Shift+\ | Toggle split view |
| Cmd+Option+N | New Little Arc window |
| Cmd+L | Focus URL bar |
| Cmd+Shift+C | Copy current URL |

### Reduced Motion

Arc respects the macOS `prefers-reduced-motion` system setting. When enabled, animations are reduced or eliminated — spring physics are replaced with instant state changes, and slide transitions are removed in favor of simple opacity fades.

### Screen Reader Support

Arc supports VoiceOver on macOS, with ARIA landmarks and roles inherited from Chromium for web content. Sidebar items are labeled for accessibility, and the Command Bar is announced when opened.

### Color-Blind Considerations

Arc's reliance on color for Space identification is a potential issue for colorblind users. However, Spaces also display their name/label and maintain consistent position in the Space switcher, providing non-color identification. Tab titles are always present as text labels alongside color indicators.

**QBO comparison:** The QBO app has more robust accessibility infrastructure: `prefers-contrast` support (more/less), `.sr-only` utility class, `.touch-target` (44px), and `:focus-visible` with `:focus:not(:focus-visible)` suppression. Arc's accessibility is adequate but less systematized than QBO's token-based approach.

---

## 9. Dark Mode

### Implementation Status

Dark mode is **first-class** in Arc — it was the default mode at launch, and the dark translucent sidebar became the browser's most recognizable visual element. The system supports three settings: Light, Dark, and Auto (follows macOS system preference).

### Theme Variants

Arc has two primary visual modes (Light and Dark), but these are crossed with the user-chosen Space color, creating virtually infinite combinations. A "Blue Space in Dark Mode" looks fundamentally different from a "Pink Space in Light Mode."

### Surface Hierarchy in Dark Mode

| Level | Approximate Color | Usage |
|-------|------------------|-------|
| Deepest | #0D0D0D | Behind vibrancy effect |
| Base (sidebar) | #1A1A1A + vibrancy blur | Main navigation surface |
| Raised | #2A2A2A | URL bar, input fields |
| Elevated | #2E2E2E | Command Bar, dropdown panels |
| Highest | #3A3A3A | Tooltips, popovers |

### Color Adaptation Between Modes

In dark mode, Space colors are **desaturated and slightly darkened** to prevent glare and maintain readability. A vibrant blue (#0091FF) in light mode might shift to a slightly muted tone in dark mode. The vibrancy blur effect also changes — dark mode vibrancy shows through darker, blurred content beneath the sidebar.

### Shadow and Border Adaptation

In dark mode, Arc shifts from shadows (which become invisible against dark backgrounds) to **subtle light borders**. Border opacity increases slightly in dark mode (from ~0.06 to ~0.08-0.12) to compensate for the loss of shadow-based depth perception. This is the same pattern the QBO app uses with its warm-tinted borders.

---

## 10. Responsive Design

### Platform Approach

Arc was originally a macOS-only desktop browser, and its design language reflects desktop-first thinking. The Windows version (released 2024) adapts the core design language with platform-appropriate adjustments (Segoe UI font, Windows-native window controls). Arc for iOS is a separate mobile app with a significantly different interaction model.

### Desktop Layout Behavior

- **Sidebar**: Expandable (~260px) or fully collapsed (0px). No intermediate collapsed state — it's either visible or hidden.
- **Split view**: Up to 4 panes tiled within the window. Panes reflow when the window is resized.
- **Window sizing**: Arc works at any window size but is optimized for ≥1280px width. At very narrow widths, the sidebar auto-collapses.

### Touch Targets

On desktop, Arc uses standard macOS hit target sizes (~24-32px for toolbar buttons). The iOS version uses Apple's recommended 44pt minimum touch targets. The sidebar tab items (~32px height) are within acceptable range for mouse interaction but would be tight for touch.

### Mobile Patterns

Arc's iOS app uses a completely different navigation paradigm — a bottom tab bar, full-screen card-based tab switcher, and swipe gestures for Space switching. This mobile design shares the color-coding concept but none of the sidebar/split-view patterns.

**QBO relevance:** The QBO app is primarily a desktop tool. Arc's desktop-first approach validates the QBO app's focus on desktop layouts. The sidebar collapse/expand pattern and split-view capability are the most transferable responsive patterns.

---

## 11. QBO Escalation App Mapping

This section provides the most important and actionable recommendations for applying Arc Browser's design patterns to the QBO Escalation Assistant.

### Recommendation 1: Workspace Mode Switching (Highest-Impact Structural Change)

**Arc pattern:** Spaces with color-coded contexts that instantly switch the entire workspace — sidebar content, accent color, and pinned items change with a single gesture.

**QBO current state:** The app has a single sidebar (`client/src/components/Sidebar.css`, 280px width) with all navigation items visible at all times. The accent is always ember amber (#c76a22) from `client/src/App.css`. There is no concept of workspace modes; the user sees every feature simultaneously.

**Proposed change:** Implement three workspace modes — **Escalation** (ember amber accent, dashboard + chat + playbook prominent), **Investigation** (deep blue accent #3E63DD, INV tracker + case archive + Gmail prominent), and **Research** (teal accent #12A594, model lab + copilot + knowledge base prominent). Each mode filters the sidebar to show only relevant items, shifts the accent color, and remembers its own scroll position and expanded state. Switch modes via Ctrl+1/2/3 or clickable mode indicators in the sidebar header.

**Why it matters:** Escalation specialists juggle distinct task types during a shift. Mode switching reduces cognitive load by surfacing only the tools relevant to the current task, mirroring how Arc's Spaces reduce tab overload.

### Recommendation 2: Global Command Palette (Navigation/Wayfinding)

**Arc pattern:** Cmd+T Command Bar searches everything — tabs, bookmarks, history, actions — in one floating overlay with staggered result animations.

**QBO current state:** Search exists within individual features (escalation search, chat slash commands in `client/src/components/Chat.css`). There is no unified search across the entire application.

**Proposed change:** Add a global Command Palette triggered by Ctrl+K. It should search across: escalation cases (by ID, customer name, category), INV investigations, knowledge base articles (from `playbook/`), app navigation (switch to any view), settings, and chat commands. Render as a centered floating overlay with `--radius-xl` (16px) corners, `--shadow-lg` elevation, and staggered item entrance animations via Framer Motion.

**Why it matters:** Specialists often need to quickly find a specific case or article mid-conversation. A global search eliminates the need to navigate to the right view first, then search within it — saving multiple clicks per lookup across dozens of daily interactions.

### Recommendation 3: Contextual Status Color Tinting (Status/State Communication)

**Arc pattern:** Arc's automatic color extraction tints the toolbar to match the active website, providing instant visual context about which site is active.

**QBO current state:** Status badges in `client/src/components/EscalationDashboard.css` use color-coded backgrounds per category/status. The header and sidebar remain neutral regardless of context.

**Proposed change:** When viewing an escalation detail, apply a subtle color tint (5-8% opacity) to the header background that matches the escalation's category badge color. Define tint colors per category using the existing category color system. Implement via a CSS custom property `--context-tint` set dynamically on the header element, replacing the static `--bg-header` value in `client/src/App.css`.

**Why it matters:** The subtle tint provides preattentive visual confirmation of which category the specialist is working in, reducing errors from accidentally applying the wrong procedure to a case.

### Recommendation 4: Collapsible Sidebar with Hover Reveal (Information Density)

**Arc pattern:** Sidebar collapses to 0px and reappears on hover or Cmd+\ shortcut, giving 100% content width for focused work.

**QBO current state:** Sidebar is always visible at 280px (`--sidebar-width: 280px` in `client/src/components/Sidebar.css`). It can be toggled but does not auto-hide or hover-reveal.

**Proposed change:** Add an auto-collapse mode where the sidebar hides completely after 3 seconds of inactivity, reclaiming 280px for the main content area. Hovering near the left edge (16px hit zone) reveals it with a slide animation (250ms, `--ease-decelerate`). Keyboard shortcut Ctrl+\ toggles it. Persist the user's preference in settings. This should modify the sidebar transition in `client/src/components/Sidebar.css` and the layout logic in `client/src/App.jsx`.

**Why it matters:** During active escalation work (reading a case, chatting with AI), the sidebar is unused overhead. Auto-collapse gives the specialist more room for the content that matters, especially on smaller monitors.

### Recommendation 5: Dedicated Info Semantic Color (Color System Refinement)

**Arc pattern:** Arc uses #0091FF as a dedicated info/blue color, separate from any accent or brand color.

**QBO current state:** The app uses the accent color (#c76a22) for informational states, as noted in `client/src/App.css`. There is no dedicated `--info` token — informational badges and messages use the accent.

**Proposed change:** Add `--info: #2563EB` (a warm-leaning blue that complements the ember amber) and `--info-subtle: rgba(37, 99, 235, 0.10)` to the root tokens in `client/src/App.css`. Use this for informational badges, notification indicators, and link styling where the accent color should be reserved for interactive/action elements.

**Why it matters:** Separating info from accent improves semantic clarity. When every informational element is amber, the user can't distinguish "this is clickable" from "this is informational" at a glance.

### Recommendation 6: Tighter Tab Title Typography (Typography/Readability)

**Arc pattern:** Arc uses 13px/400 for sidebar tab titles with tight 1.2 line height, creating a compact but readable list.

**QBO current state:** Sidebar nav items use `--fs-base: 14.5px` with standard line height (from `client/src/design-system.css`). Navigation items are 36px tall.

**Proposed change:** Reduce sidebar nav item font to 13px with `--lh-tight` (1.25) and reduce item height from 36px to 32px. This fits more items in the visible sidebar without scrolling, matching Arc's compact-but-readable approach. Apply in `client/src/components/Sidebar.css` by overriding the nav item font-size and height.

**Why it matters:** Every pixel saved in navigation means more visible items without scrolling, reducing the clicks needed to navigate during rapid case-switching.

### Recommendation 7: Staggered List Entry Animations (Motion/Interaction)

**Arc pattern:** Command Bar results and tab lists use staggered entry animations — each item appears ~30ms after the previous one, creating a smooth cascade effect.

**QBO current state:** Dashboard items appear simultaneously or with a single opacity fade. The app uses Framer Motion 12 (configured in `client/src/design-system-v2.css`) but doesn't apply staggered animations to lists.

**Proposed change:** Add staggered entry animations to dashboard escalation cards and sidebar navigation items using Framer Motion's `staggerChildren` property. Use a 30-40ms stagger delay, 200ms total duration per item, and the spring preset. Apply to the escalation list in `client/src/components/EscalationDashboard.css` view component.

**Why it matters:** Staggered animations communicate hierarchy and draw the eye in sequence, helping the specialist quickly parse a list of cases. They also make the app feel more responsive and polished — a morale booster during long shifts.

### Recommendation 8: Enhanced Focus Indicators with Accent Ring (Accessibility)

**Arc pattern:** Arc uses system focus rings for consistency. The QBO app can go beyond this.

**QBO current state:** Focus-visible styling uses `--accent` color with 2px offset (`client/src/design-system.css`). `:focus:not(:focus-visible)` suppresses non-keyboard focus.

**Proposed change:** Enhance the focus ring to use a double-ring pattern: a 2px `--accent` ring with a 2px white gap (using box-shadow), ensuring visibility against both light and dark backgrounds. Update the `:focus-visible` rule in `client/src/design-system.css`:
```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}
```

**Why it matters:** The double-ring pattern ensures focus indicators are visible regardless of the surrounding background color, improving keyboard navigation reliability across all themes.

### Recommendation 9: Split Content Panes

**Arc pattern:** Split view tiles up to 4 tabs in a single window with drag-to-split and resize handles.

**QBO current state:** The Agent Dock provides a fixed side panel with tabs. There is no way to view two content areas (e.g., playbook + chat) simultaneously in the main content area.

**Proposed change:** Allow the main content area in `client/src/App.jsx` to split vertically — for example, viewing the Playbook on the left and Chat on the right. Implement with a simple 50/50 split toggle (not full drag-to-split) using CSS Grid. Add a keyboard shortcut (Ctrl+Shift+\) to toggle split mode.

**Why it matters:** Specialists frequently reference playbook articles while composing chat responses. A split view eliminates constant view-switching, keeping reference material and the active task visible simultaneously.

### Recommendation 10: Sidebar Vibrancy Extension

**Arc pattern:** Full sidebar vibrancy with translucent blur creating visual depth.

**QBO current state:** Only the header uses `backdrop-filter: blur(20px) saturate(180%)` in `client/src/components/Sidebar.css`. The sidebar body uses opaque `--bg-sidebar`.

**Proposed change:** Extend the backdrop-filter treatment to the entire sidebar. Change `--bg-sidebar` to use alpha transparency: light mode `rgba(248, 246, 242, 0.85)`, dark mode `rgba(26, 23, 20, 0.85)`. Apply `backdrop-filter: blur(16px) saturate(150%)` to the sidebar container in `client/src/components/Sidebar.css`.

**Why it matters:** Full vibrancy reduces the visual weight of the sidebar, making it feel like it floats above the content rather than consuming space. This subtle depth effect makes the 280px sidebar feel less imposing.

### Recommendation 11: Tab Auto-Archive for Dashboard Cases

**Arc pattern:** Auto-archive tabs after 12 hours of inactivity, keeping the workspace clean.

**QBO current state:** Resolved escalations remain in the dashboard until manually filtered out.

**Proposed change:** Add an auto-archive behavior to the escalation dashboard: cases with "Resolved" status automatically move to an archive view after a configurable period (default: end of shift / 8 hours). The archive is searchable but not shown in the active dashboard. Add a "Show Archived" toggle in the dashboard filter bar (`client/src/components/EscalationDashboard.css`).

**Why it matters:** During a shift, resolved cases accumulate and dilute the active case list. Auto-archiving keeps the dashboard focused on cases that need attention, reducing visual noise.

### Recommendation 12: Gradient Accent Buttons

**Arc pattern:** Space colors use gradients (e.g., #0091FF → #52A9FF) rather than flat colors, creating visual depth and energy.

**QBO current state:** The accent (#c76a22) is used as a flat color on buttons and interactive elements in `client/src/App.css`.

**Proposed change:** For primary action buttons, use a subtle gradient from `--accent` to a lighter variant: `linear-gradient(135deg, #c76a22, #d4833d)`. Apply to primary buttons and the chat send button. Define `--accent-gradient: linear-gradient(135deg, var(--accent), #d4833d)` in `client/src/App.css`.

**Why it matters:** Gradient buttons create a subtle sense of depth and premium feel, distinguishing primary actions from secondary ones more clearly than flat color alone.

---

## 12. What NOT to Copy

### 12.1 Color Temperature

Arc's palette is built on **pure neutral grays** (#F5F5F5, #1A1A1A, #FFFFFF) with zero warm or cool bias. The QBO app's "Warm Authority" identity (#f5f2ed warm cream, #141210 warm obsidian) is specifically designed for extended use in office lighting. Adopting Arc's cool neutrals would strip the app of its distinctive warmth and potentially increase eye fatigue during 8+ hour shifts. The warm tones exist for a reason — they reduce the clinical feeling of staring at a screen all day.

### 12.2 Animation Excess

Arc's animations are delightful in a browser where the user initiates actions at their own pace. In an escalation tool where speed is critical, some of Arc's motion patterns would be distracting:
- **Space color morphing** (~350-400ms) would be too slow for rapid workspace switching during urgent escalations
- **Staggered list animations** should use shorter delays (30ms max) to avoid feeling sluggish when loading a dashboard with 50+ cases
- **Favicon bounce** and decorative micro-animations add no value in a productivity tool

All animations must respect the existing `prefers-reduced-motion` handling and should have the ability to be turned off entirely in settings.

### 12.3 Identity Elements

Arc's defining visual identity — the translucent sidebar with vibrant gradient Space colors — is Arc's brand. The QBO app should not adopt rainbow gradient sidebars or let users paint their navigation in hot pink. The workspace mode concept should use the existing ember amber as the base, with muted, professional accent shifts (deep blue, teal) rather than Arc's full-spectrum palette.

### 12.4 Information Density

Arc is deliberately sparse — it hides the URL bar, minimizes tab information to just a title and favicon, and auto-archives aggressively. The QBO escalation specialist needs **high information density**: case IDs, statuses, categories, timestamps, and agent details visible at a glance. Adopting Arc's minimalist approach would hide critical information that the specialist needs to scan quickly. Arc's density is optimized for browsing; QBO's density should be optimized for triage.

### 12.5 Audience Mismatch

Arc is designed for tech-savvy early adopters who enjoy customizing their tools (Boosts, Easels, custom CSS). QBO escalation specialists are not customization enthusiasts — they need a tool that works correctly out of the box with minimal configuration. Features like the Boost system (inject custom CSS into websites) have no equivalent use case in the QBO context and should not be emulated.

### 12.6 Accessibility Regressions

Arc's reliance on user-chosen Space colors for UI tinting creates potential contrast issues that the QBO app should avoid. The QBO app's existing accessibility infrastructure — `prefers-contrast` support, `:focus-visible` handling, `.touch-target` minimum sizing, and `.sr-only` utility — is more robust than Arc's approach and should not be weakened. Any adopted patterns must pass the existing accessibility standards.

### 12.7 Dark Mode Surface Colors

Arc's dark mode uses pure dark grays (#0D0D0D, #1A1A1A) without warm bias. The QBO app's warm dark mode (#141210, #1a1714) is intentionally warmer to reduce the harsh contrast of pure black/dark surfaces under office fluorescent lighting. Switching to Arc's cool darks would create inconsistency with the warm light mode and reduce comfort during late shifts.

---

## 13. Implementation Priority

### Tier 1 — Quick Wins (< 1 day effort each)

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Dedicated info color token | 2 hours | Medium | Single CSS change improves semantic clarity across all views |
| Gradient accent buttons | 2 hours | Low | Pure visual polish, one CSS property addition |
| Enhanced focus ring (double-ring) | 3 hours | Medium | Accessibility improvement, single CSS rule change |
| Tighter sidebar typography | 3 hours | Medium | Fits more nav items in view, simple CSS overrides |

### Tier 2 — Medium Effort (1-3 days each)

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Sidebar vibrancy extension | 1 day | Medium | Extends existing backdrop-filter to full sidebar |
| Staggered list entry animations | 1-2 days | Medium | Adds polish to dashboard lists using existing Framer Motion |
| Collapsible sidebar with hover reveal | 2 days | High | Requires interaction logic + animation + persistence |
| Contextual status color tinting | 2 days | Medium | Dynamic CSS property + category color mapping |

### Tier 3 — Larger Projects (3-7 days each)

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Global Command Palette | 5 days | High | New component with search across multiple data sources |
| Split content panes | 5 days | High | Layout architecture change in App.jsx |
| Dashboard auto-archive | 3 days | Medium | Requires timer logic + archive state + filter UI |

### Tier 4 — Strategic / Future Work

| Feature | Effort | Impact | Justification |
|---------|--------|--------|---------------|
| Workspace mode switching | 7-10 days | Very High | Requires accent theming, sidebar filtering, state persistence, shortcuts |

---

## 14. CSS Custom Property Definitions

```css
/* Arc Browser Design Tokens — Light Mode */
:root[data-theme="arc-browser"] {
  /* Backgrounds */
  --bg: #F5F5F5;
  --bg-raised: #FFFFFF;
  --bg-sunken: #EBEBEB;
  --bg-sidebar: rgba(245, 245, 245, 0.85);
  --bg-header: rgba(245, 245, 245, 0.92);
  --bg-input: #E8E8E8;
  --bg-hover: rgba(0, 145, 255, 0.06);
  --bg-active: rgba(0, 145, 255, 0.10);
  --bg-selected: rgba(0, 145, 255, 0.08);

  /* Text */
  --ink: #1A1A1A;
  --ink-secondary: #6E6E6E;
  --ink-tertiary: #999999;
  --ink-inverse: #F5F5F5;
  --ink-on-accent: #FFFFFF;
  --ink-link: #0091FF;

  /* Accent */
  --accent: #0091FF;
  --accent-hover: #0077D4;
  --accent-subtle: rgba(0, 145, 255, 0.10);
  --accent-text: #0077D4;
  --accent-gradient: linear-gradient(135deg, #0091FF, #52A9FF);

  /* Semantic */
  --success: #30A46C;
  --success-subtle: rgba(48, 164, 108, 0.10);
  --warning: #FFB224;
  --warning-subtle: rgba(255, 178, 36, 0.10);
  --danger: #E5484D;
  --danger-subtle: rgba(229, 72, 77, 0.10);
  --info: #0091FF;
  --info-subtle: rgba(0, 145, 255, 0.10);

  /* Borders */
  --line: rgba(0, 0, 0, 0.10);
  --line-subtle: rgba(0, 0, 0, 0.06);
  --line-strong: rgba(0, 0, 0, 0.18);

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06);

  /* Arc-specific */
  --sidebar-vibrancy: blur(16px) saturate(150%);
  --space-color: #0091FF;
  --space-gradient: linear-gradient(135deg, #0091FF, #52A9FF);
}

/* Arc Browser Design Tokens — Dark Mode */
:root[data-theme="arc-browser"][data-mode="dark"] {
  /* Backgrounds */
  --bg: #1A1A1A;
  --bg-raised: #2A2A2A;
  --bg-sunken: #0D0D0D;
  --bg-sidebar: rgba(26, 26, 26, 0.85);
  --bg-header: rgba(26, 26, 26, 0.92);
  --bg-input: #2A2A2A;
  --bg-hover: rgba(0, 145, 255, 0.10);
  --bg-active: rgba(0, 145, 255, 0.16);
  --bg-selected: rgba(0, 145, 255, 0.12);

  /* Text */
  --ink: #ECECEC;
  --ink-secondary: #A0A0A0;
  --ink-tertiary: #666666;
  --ink-inverse: #1A1A1A;
  --ink-on-accent: #FFFFFF;
  --ink-link: #52A9FF;

  /* Accent */
  --accent: #0091FF;
  --accent-hover: #52A9FF;
  --accent-subtle: rgba(0, 145, 255, 0.15);
  --accent-text: #52A9FF;
  --accent-gradient: linear-gradient(135deg, #0077D4, #0091FF);

  /* Semantic */
  --success: #3DD68C;
  --success-subtle: rgba(61, 214, 140, 0.12);
  --warning: #FFD60A;
  --warning-subtle: rgba(255, 214, 10, 0.12);
  --danger: #FF6369;
  --danger-subtle: rgba(255, 99, 105, 0.12);
  --info: #52A9FF;
  --info-subtle: rgba(82, 169, 255, 0.12);

  /* Borders */
  --line: rgba(255, 255, 255, 0.10);
  --line-subtle: rgba(255, 255, 255, 0.06);
  --line-strong: rgba(255, 255, 255, 0.18);

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.20), 0 1px 2px rgba(0, 0, 0, 0.15);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.15);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.20);

  /* Arc-specific */
  --sidebar-vibrancy: blur(16px) saturate(150%);
  --space-color: #0077D4;
  --space-gradient: linear-gradient(135deg, #0077D4, #0091FF);
}
```

---

## 15. Sources

### Official Documentation
- Arc Browser official website — arc.net (product descriptions, feature documentation)
- The Browser Company blog — thebrowsercompany.com/blog (design philosophy, product updates, team perspectives)
- Arc release notes — resources.arc.net (version history with feature announcements)

### Blog Posts / Engineering Articles
- Josh Miller interviews and podcasts on browser design philosophy and the "internet as computer" vision
- The Browser Company announcements regarding Arc for Windows launch and design adaptation
- Arc design team presentations on sidebar-as-workspace paradigm

### GitHub Repositories
- Chromium open-source project (base rendering engine used by Arc)
- Community Arc theme repositories and Boost collections

### Community Analysis / Third-Party Articles
- The Verge — Arc Browser reviews and design analysis
- TechCrunch — coverage of The Browser Company and Arc's design approach
- Reddit r/ArcBrowser — community discussions on design details, extracted color values, and UI analysis
- Radix UI color palette documentation (radix-ui.com/colors) — semantic color system that Arc's colors appear to align with

### Design Tool Files
- Figma community — Arc Browser UI Kit recreations by designers
- Apple Human Interface Guidelines — SF Pro typography and SF Symbols icon documentation used by Arc on macOS

*Disclaimer: Arc Browser does not publish an official open-source design system or public design tokens. Many hex values and dimension values in this report are approximations derived from community analysis, screenshot extraction, and design recreations. Values should be validated against the current version of Arc before implementation.*
