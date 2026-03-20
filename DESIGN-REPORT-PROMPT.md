# Design System Research Report — Master Prompt

You are a design system research agent. Your task is to produce an exhaustive, deeply researched design system report for **{BRAND_NAME}** ({DESIGN_SYSTEM_NAME}) and map every finding to the **QBO Escalation Assistant** — a tool for QuickBooks Online escalation specialists.

---

## Your Research Mandate

Research {BRAND_NAME}'s design system using web search, official documentation, blog posts, GitHub repos, Figma community files, third-party analysis, and your own knowledge. You must find **specific values** — exact hex codes, pixel sizes, font weights, easing curves, duration values, spacing scales, border radii. Do not write vague descriptions ("uses a blue accent") — find the actual value ("#0070F3, a medium blue at ~215° hue").

For every claim about the brand's design system, cite where the information comes from (official docs, blog post, GitHub source file, community analysis). If you cannot verify a specific value, say so explicitly rather than guessing.

---

## Report Structure (MANDATORY — follow this EXACTLY)

Your report MUST contain ALL of the following sections in this order. Each section has minimum depth requirements. Do not skip or combine sections.

### 1. Executive Summary (300-500 words)

- What makes {BRAND_NAME}'s design system distinctive — the ONE sentence philosophy
- The three highest-value ideas the QBO app should steal (ranked)
- How {BRAND_NAME}'s design context compares to the QBO escalation specialist context
- What the QBO app already does well that aligns with {BRAND_NAME}
- What the QBO app is missing that {BRAND_NAME} solves

### 2. Design Philosophy (500-800 words)

- The stated design principles (find official sources — blog posts, design system docs, conference talks)
- How those principles manifest in concrete product decisions (not abstract platitudes)
- The user they optimize for and how that maps to an escalation specialist
- Dark mode philosophy (dark-first vs light-first vs equal treatment)
- Brand identity through color (what their accent color communicates psychologically)
- Content vs. chrome balance — how much visual weight goes to the tool vs. the user's data

### 3. Key Design Patterns (800-1200 words)

Document the 6-10 most distinctive UX patterns. For each pattern:
- **What it is** — precise description with dimensions/behavior
- **Why it works** — the UX principle behind it
- **QBO application** — how this pattern maps to escalation workflow

Must cover at minimum:
- Navigation architecture (sidebar, tabs, breadcrumbs, command palette)
- List/table patterns (how they display collections of items)
- Detail view patterns (how they show a single record's full information)
- Status communication (how state/progress is shown)
- Search and filtering
- Contextual panels / slide-overs / drawers
- Keyboard shortcuts and power-user features

### 4. Color System (800-1200 words)

This is the most data-intensive section. You MUST provide:

**4.1 Complete Palette with Hex Values**

Provide a table with EVERY documented color:

| Token/Name | Hex Value | RGB | Usage |
|------------|-----------|-----|-------|
| (actual values) | | | |

Cover: brand/accent colors, background surfaces (light AND dark), text colors (primary, secondary, muted), border colors, semantic colors (success, warning, error, info), any object/category-specific colors.

**4.2 Surface Hierarchy**

Show the background color stack for BOTH light and dark mode:

| Level | Light Hex | Dark Hex | Usage |
|-------|-----------|----------|-------|
| Deepest/Sunken | | | |
| Base | | | |
| Raised/Card | | | |
| Elevated/Floating | | | |

**4.3 Color Architecture**

- How colors are organized (flat list? tiered tokens? semantic + primitive split?)
- Token naming convention (show actual token names from their system)
- How themes are implemented (CSS custom properties? class-based? context-based?)
- Perceptual uniformity — do they use CIELAB, OKLCH, HSLuv, or standard HSL/RGB?

**4.4 Comparison with QBO App**

Map their color system to QBO's existing tokens:

| Concept | {BRAND_NAME} | QBO App | Analysis |
|---------|-------------|---------|----------|
| Background | | #f5f2ed (light) / #141210 (dark) | |
| Text Primary | | #2a2420 (light) / #e8dfd5 (dark) | |
| Accent | | #c76a22 (ember amber) | |
| Success | | #2E7D52 | |
| Warning | | #B8860B | |
| Danger | | #b33025 | |
| Info | | (uses accent) | |
| Sidebar | | #f8f6f2 (light) / #1a1714 (dark) | |

The QBO app uses warm neutrals ("Warm Authority" identity) — warm cream/stone in light mode, warm obsidian in dark mode. The accent is ember amber (#c76a22). Evaluate whether {BRAND_NAME}'s color temperature would work for 8+ hour support shifts.

### 5. Typography and Spacing (500-800 words)

**5.1 Typography**

| Level | Font Family | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|-------------|------|--------|-------------|----------------|-------|
| Display | | | | | | |
| Heading | | | | | | |
| Title | | | | | | |
| Body | | | | | | |
| Caption | | | | | | |
| Overline | | | | | | |

Note: The QBO app uses Inter (sans-serif) and JetBrains Mono (monospace), 14.5px base, negative letter-spacing on headings.

**5.2 Spacing System**

| Token | Value | Usage |
|-------|-------|-------|
| (their full scale) | | |

Note: The QBO app uses a 4px base grid (--sp-1: 4px through --sp-10: 36px, extended to --sp-24: 96px).

**5.3 Border Radius Scale**

| Token | Value | Usage |
|-------|-------|-------|

Note: QBO uses xs(3px), sm(4px), md(8px), lg(12px), xl(16px), 2xl(20px), pill(9999px).

### 6. Animation and Motion (500-800 words)

**6.1 Motion Philosophy** — What do they animate and why? What do they NOT animate?

**6.2 Duration Scale**

| Category | Duration | Easing | Usage |
|----------|----------|--------|-------|
| Micro-interactions | | | |
| Small transitions | | | |
| Medium transitions | | | |
| Large transitions | | | |

**6.3 Easing Curves** — Provide actual cubic-bezier values or spring configs where available.

**6.4 Specific Animation Patterns** — Document 5-8 notable animations (hover states, page transitions, loading states, status changes, panel slides, etc.)

**6.5 Comparison with QBO**

Note: QBO uses Framer Motion 12, spring physics, 200ms sweet spot, --ease-standard/decelerate/accelerate/emphasized curves, prefers-reduced-motion fully respected.

### 7. Iconography (200-400 words)

- Icon library name and style (outlined, filled, duotone, etc.)
- Icon sizes (small, medium, large)
- Stroke width
- How icons relate to the color system
- Notable icon design principles

### 8. Accessibility (400-600 words)

- WCAG compliance level (AA, AAA)
- Color contrast approach (how they ensure contrast)
- Focus indicators (describe the focus ring style — color, width, offset)
- Keyboard navigation (shortcuts, tab order, arrow key patterns)
- Screen reader support (ARIA patterns, landmarks)
- Reduced motion handling
- Color-blind considerations (do they use color alone for status?)
- High contrast / vision-need themes

Note: QBO has prefers-reduced-motion, prefers-contrast (more/less), .sr-only, .touch-target (44px), :focus-visible styling, and :focus:not(:focus-visible) suppression.

### 9. Dark Mode (300-500 words)

- Is dark mode first-class or an afterthought?
- How many theme variants exist?
- Surface hierarchy in dark mode specifically
- How accent/semantic colors adapt between modes
- How shadows/borders adapt (shadows invisible on dark? borders replace shadows?)

### 10. Responsive Design (200-400 words)

- Breakpoints
- How layouts adapt (sidebar collapse, panel stacking, density changes)
- Mobile-specific patterns
- Touch target sizes

### 11. QBO Escalation App Mapping (THIS IS THE MOST IMPORTANT SECTION — 1000-1500 words)

For EACH recommendation below, you MUST provide:
- **The {BRAND_NAME} pattern** — what they do
- **The QBO current state** — what the app does now (reference actual CSS classes, component names, file paths)
- **The proposed change** — specific, actionable, with enough detail that a developer could implement it
- **Why it matters for escalation workflow** — connect to the specialist's daily work

Provide 8-12 ranked recommendations covering:

1. **The single highest-impact structural change** inspired by {BRAND_NAME}
2. **Navigation/wayfinding improvement**
3. **Status/state communication improvement**
4. **Information density optimization**
5. **Color system refinement**
6. **Typography/readability improvement**
7. **Motion/interaction refinement**
8. **Accessibility improvement**
9-12. Additional recommendations as appropriate

Reference these QBO app files/components in your recommendations:
- `client/src/App.css` — Core design tokens, component styles, dark mode
- `client/src/App.jsx` — App shell, sidebar, header, routing
- `client/src/design-system.css` — Typography, motion, elevation, accessibility tokens
- `client/src/design-system-v2.css` — Extended M3 motion, shadows, interactions
- `client/src/components/Sidebar.css` — Navigation sidebar (uses backdrop-filter, multi-layer shadows)
- `client/src/components/Chat.css` — Compose card, chat bubbles, slash commands
- `client/src/components/EscalationDashboard.css` — Dashboard layout
- `client/src/themes/` — Theme CSS files

QBO app features that recommendations should consider:
- AI chat with Claude CLI subprocess (streaming responses)
- Escalation dashboard with status badges and category badges
- Investigation tracking (INV cases from Intuit Slack)
- Gmail inbox integration
- Calendar integration
- Analytics and usage tracking
- Agent dock (side panel with tabs)
- Copilot panel
- Settings with theme selection (20+ themes)
- Playbook (knowledge base in markdown)
- Model lab for AI provider comparison

### 12. What NOT to Copy (400-600 words)

Be honest about what would NOT work for the QBO app. Cover:

1. **Color temperature** — {BRAND_NAME}'s palette may be too cool/warm/saturated for 8-hour shifts
2. **Animation excess** — what animations would be distracting under time pressure
3. **Identity elements** — brand-specific elements that should not transfer (mascots, specific hues, etc.)
4. **Information density** — if they're too sparse or too dense for the QBO use case
5. **Audience mismatch** — patterns that work for their users but not for escalation specialists
6. **Accessibility regressions** — anything that would weaken QBO's existing accessibility
7. **Dark mode issues** — if their dark mode approach doesn't suit office environments

### 13. Implementation Priority (300-500 words)

Rank all recommendations into four tiers:

**Tier 1 — Quick Wins (< 1 day effort each)**
**Tier 2 — Medium Effort (1-3 days each)**
**Tier 3 — Larger Projects (3-7 days each)**
**Tier 4 — Strategic / Future Work**

For each item, provide: Feature name, Effort estimate, Impact rating (High/Medium/Low), and a one-line justification.

### 14. CSS Custom Property Definitions (NEW SECTION)

Provide a complete set of CSS custom properties that would implement {BRAND_NAME}'s design system if applied to the QBO app. Format as actual CSS:

```css
/* {BRAND_NAME} Design Tokens — Light Mode */
:root[data-theme="{brand-slug}"] {
  /* Backgrounds */
  --bg: {value};
  --bg-raised: {value};
  --bg-sunken: {value};
  --bg-sidebar: {value};

  /* Text */
  --ink: {value};
  --ink-secondary: {value};
  --ink-tertiary: {value};

  /* Accent */
  --accent: {value};
  --accent-hover: {value};
  --accent-subtle: {value};

  /* Semantic */
  --success: {value};
  --warning: {value};
  --danger: {value};

  /* Borders */
  --line: {value};
  --line-subtle: {value};

  /* Shadows */
  --shadow-sm: {value};
  --shadow-md: {value};
  --shadow-lg: {value};
}

/* {BRAND_NAME} Design Tokens — Dark Mode */
:root[data-theme="{brand-slug}"][data-mode="dark"] {
  /* (same structure with dark values) */
}
```

### 15. Sources (MANDATORY)

List EVERY source you referenced. Group by:
- Official documentation
- Blog posts / engineering articles
- GitHub repositories
- Community analysis / third-party articles
- Design tool files (Figma, Storybook)

---

## QBO Escalation App Context (for your reference)

The QBO Escalation Assistant is a tool for QuickBooks Online escalation specialists — back-office advisors who help phone agents resolve customer issues. The user does NOT talk to customers directly; they advise agents via text/chat.

**Tech stack:** React 19, Vite 7, Express 5, MongoDB Atlas, Claude CLI subprocess for AI.

**User context:**
- Works 8+ hour shifts
- Located in Atlantic Canada (UTC-4)
- Scans dozens of cases per shift
- Needs speed and accuracy above all
- Uses the tool all day — eye fatigue is a real concern
- Office environment with overhead lighting (not a dimly lit room)

**Current design identity: "Warm Authority"**
- Warm cream/stone backgrounds (#f5f2ed light, #141210 dark)
- Ember amber accent (#c76a22)
- Inter font family, 14.5px base
- Multi-layer shadows with inset highlights
- Gradient backgrounds on buttons and cards
- 20+ theme variants
- Category badge color system (14 categories with distinct warm-shifted colors)
- Provider identity colors (ember, purple, amber, emerald for different AI providers)

**Design tokens already in place:**
- CSS custom properties in :root with dark mode overrides
- Spacing: 4px base grid (--sp-1 through --sp-24)
- Typography: 11px to 28px scale with tracking and weight compensation
- Motion: 100ms to 700ms durations, spring physics, reduced-motion support
- Elevation: xs through 2xl shadows, ambient variants
- Accessibility: prefers-reduced-motion, prefers-contrast, focus-visible, sr-only, touch-target

---

## Quality Standards

1. **Minimum report length: 3000+ words.** Thorough analysis, not a surface skim.
2. **Every color value must be a verified hex code.** No "uses a blue" — give me "#1F73B7".
3. **Every recommendation must reference specific QBO files/components.** No vague "improve the dashboard."
4. **The QBO Escalation App Mapping section must be the longest and most detailed section.**
5. **Include at least 10 sources.** Official docs, blog posts, GitHub, community analysis.
6. **Be honest about what NOT to copy.** This section shows analytical maturity.
7. **CSS custom properties section must be complete and valid CSS.**

---

## Output

Save your completed report to: `{OUTPUT_PATH}`

The report should be a single markdown file with proper heading hierarchy, tables, code blocks, and source links. It will be used by prototype-building agents to create a working UI theme, so the CSS custom properties section is critical.
