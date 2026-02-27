# QBO Escalation Assistant - Design System

**Identity: "Warm Authority"**

A calm, authoritative workspace for escalation specialists who spend 8+ hours daily triaging, diagnosing, and resolving QBO support issues. Warm neutrals reduce eye fatigue. Deep teal conveys decisiveness. Generous spacing aids rapid scanning.

---

## Design Philosophy

| Principle | What it means |
|-----------|---------------|
| **Speed to comprehension** | Escalation details understood in <2 seconds of looking |
| **Warm authority** | Warm stone/sand neutrals with deep teal accent -- professional without being cold |
| **Status at a glance** | Color + text label for every status (never color-only) |
| **Copy-friendly** | Response text easy to select and copy with one click |
| **Information density** | More data in less space without feeling cluttered |
| **Eye comfort** | Warm backgrounds, comfortable contrast ratios for extended use |
| **Purposeful motion** | Every animation informs. Work tool, not a consumer app |

---

## Color Palette

### Light Mode

#### Surfaces (Warm Neutral Family)
| Token | Hex | Usage |
|-------|-----|-------|
| --bg | #f6f4f1 | App background (warm paper) |
| --bg-raised | #ffffff | Cards, modals, elevated surfaces |
| --bg-sunken | #edeae5 | Inset areas, code blocks, input backgrounds |
| --bg-sidebar | #faf8f6 | Sidebar background |

#### Text (Warm Charcoal)
| Token | Hex | Usage |
|-------|-----|-------|
| --ink | #2c2620 | Primary text |
| --ink-secondary | #6b5f53 | Labels, secondary text |
| --ink-tertiary | #9e9184 | Hints, placeholders, timestamps |

#### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| --line | #d6cfc6 | Primary borders, dividers |
| --line-subtle | #e8e3dc | Subtle separators |

#### Accent (Deep Teal)
| Token | Hex | Usage |
|-------|-----|-------|
| --accent | #1a7a6d | Primary action color, links, active states |
| --accent-hover | #145f55 | Hover/pressed accent |
| --accent-subtle | #e5f3f0 | Accent background tint |
| --accent-muted | #b0d9d2 | Decorative accent |

#### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| --success | #3a8a5c | Resolved, positive actions |
| --warning | #c47c1e | Attention needed, open items |
| --danger | #c0392b | Errors, destructive actions, escalated |
| --info | #1a7a6d | Informational (same as accent) |

### Dark Mode

Warm dark palette -- never pure black. All surfaces have warm undertones.

#### Surfaces
| Token | Hex |
|-------|-----|
| --bg | #1a1714 |
| --bg-raised | #242019 |
| --bg-sunken | #13110e |
| --bg-sidebar | #1e1b17 |

#### Text
| Token | Hex |
|-------|-----|
| --ink | #ede8e1 |
| --ink-secondary | #a89d91 |
| --ink-tertiary | #6e6358 |

#### Accent
| Token | Hex |
|-------|-----|
| --accent | #4ec9b5 |
| --accent-hover | #6fd9c8 |

---

## Status Colors

| Status | Light BG | Light Text | Dot Color | Meaning |
|--------|----------|------------|-----------|---------|
| Open | #fdf0d5 | #8b5e14 | #d4941a | Needs attention (warm amber) |
| In Progress | #d5eee9 | #145f55 | #1a7a6d | Actively working (teal) |
| Resolved | #ddeee3 | #2d6b42 | #3a8a5c | Settled (sage green) |
| Escalated | #f5ddd9 | #943124 | #c0392b | Urgent (terracotta) |

## Category Badge Colors

Each QBO category has a unique tint that stays warm-compatible:

| Category | BG | Text |
|----------|-----|------|
| Payroll | #ede5f5 | #5e3d8a |
| Bank Feeds | #ddeef5 | #2a6987 |
| Reconciliation | #fdf0d5 | #8b5e14 |
| Permissions | #f5dde9 | #873555 |
| Billing | #ddeee3 | #2d6b42 |
| Tax | #f5ddd9 | #943124 |
| Invoicing | #dde0f5 | #3b3f8a |
| Reporting | #eeddf5 | #6b3587 |
| General | #edeae5 | #6b5f53 |

---

## Typography

### Font Families
- **Sans**: `'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`
- **Mono**: `'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', Consolas, monospace`

### Font Sizes
| Token | Value | Usage |
|-------|-------|-------|
| --text-xs | 11px | Eyebrows, timestamps, tertiary labels |
| --text-sm | 13px | Table cells, badges, secondary text |
| --text-base | 14.5px | Body text, inputs (slightly larger for readability) |
| --text-md | 15.5px | Card headings, emphasized body |
| --text-lg | 18px | Section titles, modal titles |
| --text-xl | 22px | Page titles |
| --text-2xl | 28px | Stat card values, hero numbers |

### Font Weights
- 400: Body text
- 500: Navigation items, secondary labels
- 600: Buttons, badges, eyebrows, card headings
- 700: Page titles, stat values, section headers

---

## Spacing Scale

4px base, generous for eye comfort:

| Token | Value | Usage |
|-------|-------|-------|
| --sp-1 | 4px | Tight gaps, badge internals |
| --sp-2 | 6px | Compact gaps (chip rows) |
| --sp-3 | 8px | Standard inner gaps |
| --sp-4 | 12px | Card inner padding, form padding |
| --sp-5 | 14px | List gaps, section spacing |
| --sp-6 | 16px | Sidebar padding, input area padding |
| --sp-7 | 20px | Section margins |
| --sp-8 | 24px | Card padding, page content padding |
| --sp-9 | 28px | Large gaps |
| --sp-10 | 36px | Empty state padding, hero spacing |

---

## Border Radius

Softly rounded -- tactile, not sharp or bubbly:

| Token | Value | Usage |
|-------|-------|-------|
| --radius-sm | 4px | Inline code, small badges |
| --radius-md | 8px | Buttons, inputs, badges |
| --radius-lg | 12px | Cards, chat bubbles, modals |
| --radius-xl | 16px | Modal containers |
| --radius-pill | 999px | Status badges, category badges |

---

## Shadows

Warm-tinted, subtle depth:

| Token | Value | Usage |
|-------|-------|-------|
| --shadow-sm | 0 1px 3px rgba(44,38,32,0.04) | Cards at rest |
| --shadow-md | 0 2px 10px rgba(44,38,32,0.06), 0 1px 3px rgba(44,38,32,0.04) | Cards on hover, dropdowns |
| --shadow-lg | 0 8px 28px rgba(44,38,32,0.08), 0 2px 6px rgba(44,38,32,0.04) | Modals, toasts |
| --shadow-focus | 0 0 0 2px accent-subtle, 0 0 0 4px accent | Focus ring |

---

## Animation

Based on universal design principles (Apple HIG, Material Design 3, Linear, Stripe):

### Motion Tokens
| Token | Value | Usage |
|-------|-------|-------|
| --ease-standard | cubic-bezier(0.2, 0, 0, 1) | Default for most transitions |
| --ease-decelerate | cubic-bezier(0, 0, 0, 1) | Elements entering the screen |
| --ease-accelerate | cubic-bezier(0.3, 0, 1, 1) | Elements exiting the screen |
| --ease-emphasized | cubic-bezier(0.05, 0.7, 0.1, 1) | Premium entrances (modals, toasts) |
| --duration-micro | 100ms | Color changes, icon swaps |
| --duration-fast | 150ms | Button states, hover effects |
| --duration-normal | 200ms | Navigation transitions, panel slides |
| --duration-emphasis | 300ms | Modal entrances, toast reveals |

### Rules
1. **Purpose over polish** -- if removing an animation doesn't hurt comprehension, remove it
2. **Transform + opacity only** -- never animate width, height, margin, padding
3. **Exit faster than enter** -- exits are 30-50% shorter than entrances
4. **Reduced motion always respected** -- `prefers-reduced-motion: reduce` removes all motion

---

## Component Standards

### Cards
`.card`: `border-radius: 12px; border: 1px solid var(--line); background: var(--bg-raised); padding: 24px; box-shadow: var(--shadow-sm)`

### Buttons
- Primary: deep teal background, white text
- Secondary: transparent with border
- Ghost: transparent, secondary text color
- Danger: terracotta background, white text
- All buttons have `:active` scale(0.97) micro-feedback

### Status Badges
Pill-shaped, semantic color pairs (bg + text). Always include text label for accessibility.

### Category Badges
Pill-shaped, unique color per QBO category. Text-transform: capitalize.

---

## Layout

### App Shell
`display: flex; height: 100vh; overflow: hidden`
- Sidebar: `width: 268px` (collapses to 52px on tablet, slides on mobile)
- Content: `flex: 1; overflow-y: auto; padding: 24px`
- Content constrained: `max-width: 1060px; margin: 0 auto`

### Chat Layout
Full-height flex column. Messages area scrollable, input area fixed at bottom with raised background.

### Responsive Breakpoints
| Breakpoint | Changes |
|------------|---------|
| <= 1200px | Sidebar collapses to icon-only |
| <= 900px | Sidebar becomes fixed overlay with toggle |
| <= 600px | Filter bars stack, modals fill width |

---

## Accessibility

- **Focus states**: 2px accent ring + accent-subtle outer ring
- **Reduced motion**: All animation/transition durations set to 0.01ms
- **Status indicators**: Always text + color (never color-only)
- **Screen reader**: `.sr-only` utility available
- **Touch targets**: Minimum 34px height on interactive elements
- **Contrast**: All text passes WCAG AA against its background
