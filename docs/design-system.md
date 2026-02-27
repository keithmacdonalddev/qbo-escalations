# QBO Escalation Assistant - Design System

All UI changes MUST comply with these specifications. This design system is optimized for a **professional productivity tool** used 8+ hours per day under time pressure. Every design choice prioritizes speed-to-comprehension, eye comfort, and information density.

---

## Design Philosophy

| Principle | What it means |
|-----------|---------------|
| **Speed to comprehension** | Escalation details understood in <2 seconds of looking |
| **Copy-friendly** | Response text easy to select and copy with one click |
| **Status at a glance** | Color + icon + text label for every status (never color-only) |
| **Professional calm** | Blues, grays, subtle accents. No bright colors screaming for attention |
| **Information density** | More data in less space without feeling cluttered |
| **Eye comfort** | Soft backgrounds, comfortable contrast ratios for 8+ hour use |
| **Minimal animation** | Animations inform, never decorate. Work tool, not a consumer app |

---

## Color Palette

### CSS Custom Properties (defined on `:root`)

All colors have light and dark mode variants via `prefers-color-scheme`.

#### Light Mode (default)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#f4f5f7` | App background |
| `--bg-raised` | `#ffffff` | Cards, panels, elevated surfaces |
| `--bg-sunken` | `#eceef1` | Inset areas, code blocks, input backgrounds |
| `--bg-sidebar` | `#f9fafb` | Sidebar background |
| `--ink` | `#1a1d23` | Primary text |
| `--ink-secondary` | `#5a6171` | Secondary/label text |
| `--ink-tertiary` | `#8b93a5` | Placeholder, disabled text |
| `--line` | `#d8dce5` | Borders, dividers |
| `--line-subtle` | `#e8ebf0` | Subtle separators, hover borders |
| `--accent` | `#2563c4` | Primary action, links, focus rings |
| `--accent-hover` | `#1d4fa8` | Hover state for accent |
| `--accent-subtle` | `#e8f0fe` | Accent background tint |

#### Dark Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#111318` | App background |
| `--bg-raised` | `#1a1d24` | Cards, panels |
| `--bg-sunken` | `#0d0f13` | Inset areas, code blocks |
| `--bg-sidebar` | `#14161c` | Sidebar background |
| `--ink` | `#e2e4e9` | Primary text |
| `--ink-secondary` | `#9ba1b0` | Secondary text |
| `--ink-tertiary` | `#5d6475` | Placeholder, disabled |
| `--line` | `#2a2e38` | Borders |
| `--line-subtle` | `#22252e` | Subtle separators |
| `--accent` | `#5b9cf5` | Primary action |
| `--accent-hover` | `#7db4ff` | Hover accent |
| `--accent-subtle` | `#1a2940` | Accent background tint |

### Status Colors

Used for escalation status badges and indicators. Each status uses a **color + icon + text label** for accessibility.

| Status | Light bg | Light text | Dark bg | Dark text | Icon |
|--------|----------|------------|---------|-----------|------|
| Open | `#fef3c7` | `#92400e` | `#422006` | `#fbbf24` | Circle outline |
| In Progress | `#dbeafe` | `#1e40af` | `#1e3a5f` | `#60a5fa` | Spinner/arrows |
| Resolved | `#d1fae5` | `#065f46` | `#064e3b` | `#34d399` | Checkmark |
| Escalated Further | `#fee2e2` | `#991b1b` | `#450a0a` | `#f87171` | Arrow up |

### Category Colors

Subtle tinted badges for escalation categories.

| Category | Light bg | Light text |
|----------|----------|------------|
| Payroll | `#ede9fe` | `#5b21b6` |
| Bank Feeds | `#e0f2fe` | `#075985` |
| Reconciliation | `#fef3c7` | `#92400e` |
| Permissions | `#fce7f3` | `#9d174d` |
| Billing | `#d1fae5` | `#065f46` |
| Tax | `#fee2e2` | `#991b1b` |
| Invoicing | `#e0e7ff` | `#3730a3` |
| Reporting | `#f3e8ff` | `#6b21a8` |
| General | `#f1f5f9` | `#475569` |

### Chat Bubble Colors

| Bubble | Light bg | Dark bg |
|--------|----------|---------|
| User message | `#e8f0fe` | `#1a2940` |
| Assistant message | `var(--bg-raised)` (white/card) | `var(--bg-raised)` |
| System message | `var(--bg-sunken)` | `var(--bg-sunken)` |

### Semantic Colors

| Purpose | Token | Light | Dark |
|---------|-------|-------|------|
| Success | `--success` | `#059669` | `#34d399` |
| Warning | `--warning` | `#d97706` | `#fbbf24` |
| Danger | `--danger` | `#dc2626` | `#f87171` |
| Info | `--info` | `#2563c4` | `#5b9cf5` |

---

## Typography

### Font Stack

```css
--font-sans: 'Segoe UI', -apple-system, BlinkMacSystemFont, Tahoma, Geneva, Verdana, sans-serif;
--font-mono: 'Cascadia Code', 'Fira Code', 'SF Mono', 'Consolas', monospace;
```

Use `--font-mono` for: COID, case numbers, MID, technical identifiers, code snippets.

### Font Size Scale

Optimized for information density. Slightly smaller than Media Vault for dashboard use.

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | `11px` | Timestamps, meta labels, eyebrow text |
| `--text-sm` | `12.5px` | Secondary info, badges, sidebar items |
| `--text-base` | `14px` | Body text, input text, chat messages |
| `--text-md` | `15px` | Card headings, list titles |
| `--text-lg` | `17px` | Section headings |
| `--text-xl` | `20px` | Page titles |
| `--text-2xl` | `24px` | Dashboard hero numbers |

### Font Weights

| Weight | Usage |
|--------|-------|
| 400 | Body text, descriptions |
| 500 | Sidebar items, labels, secondary headings |
| 600 | Card titles, button text, badge text |
| 700 | Page titles, summary numbers, emphasis |

### Text Transforms

- Eyebrow labels: `text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--text-xs); font-weight: 600; color: var(--ink-secondary)`
- Monospace identifiers: `font-family: var(--font-mono); font-size: var(--text-sm); letter-spacing: 0.02em`

---

## Spacing Scale

Compact but breathable. Tighter than Media Vault for information density.

| Token | Value | Usage |
|-------|-------|-------|
| `--sp-1` | `4px` | Tight gaps (inline items, icon-to-text) |
| `--sp-2` | `6px` | Compact gaps (badge padding, chip rows) |
| `--sp-3` | `8px` | Standard gaps (list items, form fields, button groups) |
| `--sp-4` | `10px` | Card padding (compact), component internal |
| `--sp-5` | `12px` | List gaps, form padding, panel inner |
| `--sp-6` | `14px` | Section spacing, layout gaps |
| `--sp-7` | `16px` | App side padding, modal padding |
| `--sp-8` | `20px` | Card padding (standard), section headers |
| `--sp-9` | `24px` | Page-level spacing |
| `--sp-10` | `32px` | Major section breaks |

---

## Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | Badges, inline code, small chips |
| `--radius-md` | `6px` | Buttons, inputs, small cards |
| `--radius-lg` | `8px` | Cards, modals, panels |
| `--radius-xl` | `12px` | Main content cards, sidebar |
| `--radius-pill` | `999px` | Pill-shaped badges, status chips |

---

## Shadow Scale

Subtle shadows for light mode. Disabled in dark mode (borders used instead).

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | Buttons, inputs on hover |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.06)` | Cards, dropdowns |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.08)` | Modals, floating panels |
| `--shadow-focus` | `0 0 0 2px var(--accent-subtle), 0 0 0 4px var(--accent)` | Focus rings |

---

## Component Standards

### Cards

Standard card for escalation entries, conversation items, analytics widgets.

```css
.card {
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--sp-8);
  box-shadow: var(--shadow-md);
}
.card:hover {
  border-color: var(--line);
  box-shadow: var(--shadow-md);
}
```

Compact card variant for list items:
```css
.card-compact {
  padding: var(--sp-4) var(--sp-5);
  border-radius: var(--radius-md);
}
```

### Buttons

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| Primary | `var(--accent)` | `#ffffff` | none |
| Secondary | `transparent` | `var(--ink)` | `1px solid var(--line)` |
| Danger | `var(--danger)` | `#ffffff` | none |
| Ghost | `transparent` | `var(--ink-secondary)` | none |
| Success | `var(--success)` | `#ffffff` | none |

All buttons: `border-radius: var(--radius-md); padding: 6px 12px; font-size: var(--text-sm); font-weight: 600; cursor: pointer;`

Small buttons (copy, inline actions): `padding: 4px 8px; font-size: var(--text-xs);`

Disabled: `opacity: 0.5; cursor: not-allowed; pointer-events: none;`

### Inputs

```css
input, textarea, select {
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: var(--text-base);
  font-family: var(--font-sans);
  color: var(--ink);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}
```

Textarea for long messages: `min-height: 80px; resize: vertical;`

### Chat Bubbles

User bubble:
```css
.chat-bubble-user {
  background: var(--bubble-user);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  padding: var(--sp-4) var(--sp-5);
  max-width: 85%;
  align-self: flex-end;
}
```

Assistant bubble:
```css
.chat-bubble-assistant {
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
  padding: var(--sp-5) var(--sp-6);
  max-width: 90%;
  align-self: flex-start;
}
```

### Status Badges

Pill-shaped, compact, always include icon + text.

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}
.badge-open       { background: var(--status-open-bg);      color: var(--status-open-text); }
.badge-progress   { background: var(--status-progress-bg);  color: var(--status-progress-text); }
.badge-resolved   { background: var(--status-resolved-bg);  color: var(--status-resolved-text); }
.badge-escalated  { background: var(--status-escalated-bg); color: var(--status-escalated-text); }
```

### Category Badges

Same pill shape as status but with category-specific tints:
```css
.cat-badge { /* same structure as .badge with category-specific colors */ }
```

### Image Upload Zone

```css
.upload-zone {
  border: 2px dashed var(--line);
  border-radius: var(--radius-lg);
  padding: var(--sp-8);
  text-align: center;
  color: var(--ink-tertiary);
  transition: border-color 140ms ease, background 140ms ease;
  cursor: pointer;
}
.upload-zone:hover, .upload-zone.is-dragover {
  border-color: var(--accent);
  background: var(--accent-subtle);
  color: var(--accent);
}
```

### Sidebar

```css
.sidebar {
  width: 260px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--line);
  height: 100vh;
  overflow-y: auto;
  padding: var(--sp-5) 0;
}
```

Sidebar nav items: `padding: 8px 14px; border-radius: var(--radius-md); margin: 0 8px;`

Active state: `background: var(--accent-subtle); color: var(--accent); font-weight: 600;`

### Tables (Escalation List)

```css
.table { width: 100%; border-collapse: collapse; }
.table th {
  text-align: left;
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-secondary);
  border-bottom: 1px solid var(--line);
}
.table td {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--line-subtle);
}
.table tr:hover td { background: var(--bg-sunken); }
```

### Modals

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: var(--bg-raised);
  border-radius: var(--radius-lg);
  padding: var(--sp-8);
  box-shadow: var(--shadow-lg);
  max-width: 480px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
}
```

### Toast Notifications

```css
.toast {
  position: fixed;
  bottom: 16px;
  right: 16px;
  padding: var(--sp-4) var(--sp-6);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  z-index: 2000;
  box-shadow: var(--shadow-lg);
  animation: toast-in 200ms ease;
}
.toast-success { background: var(--success); color: #fff; }
.toast-error   { background: var(--danger); color: #fff; }
.toast-info    { background: var(--accent); color: #fff; }
```

### Loading States

Skeleton shimmer for loading cards:
```css
.skeleton {
  background: var(--bg-sunken);
  border-radius: var(--radius-md);
  animation: shimmer 1.2s ease-in-out infinite;
}
```

Streaming indicator (for Claude responses):
```css
.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--accent);
  animation: cursor-blink 800ms step-end infinite;
  margin-left: 1px;
  vertical-align: text-bottom;
}
```

### Copy-to-Clipboard Button

```css
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all 140ms ease;
}
.copy-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.copy-btn.is-copied {
  border-color: var(--success);
  color: var(--success);
}
```

---

## Layout

### App Shell

```css
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.app-sidebar { /* .sidebar styles above */ }
.app-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-8);
}
```

### Chat View Layout

```
+----------+------------------------------+
| Sidebar  |  Chat Messages               |
| (260px)  |  (scrollable area)           |
|          |                              |
| Nav      |  [message]                   |
| items    |  [message]                   |
|          |  [message]                   |
| -------- |                              |
| Conv     |  --------------------------  |
| list     |  | Input bar + send btn   |  |
|          |  --------------------------  |
+----------+------------------------------+
```

Chat main area: `display: flex; flex-direction: column; height: 100%;`
Messages container: `flex: 1; overflow-y: auto; padding: var(--sp-6);`
Input area: `border-top: 1px solid var(--line); padding: var(--sp-5);`

### Dashboard View Layout

```
+----------+------------------------------+
| Sidebar  |  Filter Bar                  |
| (260px)  |  [status] [category] [search]|
|          |  ----------------------------+
|          |  Escalation List / Grid      |
|          |  [card] [card] [card]        |
|          |  [card] [card] [card]        |
+----------+------------------------------+
```

Filter bar: `display: flex; gap: var(--sp-3); padding: var(--sp-5); border-bottom: 1px solid var(--line); flex-wrap: wrap;`

### Escalation Detail Layout

Full-width content area with optional linked conversation.

### Responsive

Content area max-width: `min(1100px, 100%)` centered within `.app-content`.

---

## Z-Index Scale

| Value | Usage |
|-------|-------|
| 1 | Sticky headers within scrollable content |
| 10 | Sidebar |
| 100 | Dropdown menus |
| 1000 | Modal overlay + modal |
| 2000 | Toast notifications |

---

## Responsive Breakpoints

| Breakpoint | Changes |
|------------|---------|
| `<= 1200px` | Sidebar collapses to icon-only (48px wide) |
| `<= 900px` | Sidebar becomes overlay, content goes full-width |
| `<= 600px` | Stack filters vertically, reduce padding |

Sidebar collapse/expand: fast slide animation (180ms ease).

---

## Animation Standards

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| instant | 0ms | - | Active state changes (selection, toggle) |
| fast | 140ms | ease | Button hover, input focus, border color |
| normal | 200ms | ease | Sidebar collapse, panel transitions |
| streaming | per-token | linear | Text token appearance in chat |

### Keyframes

| Name | Description | Duration |
|------|-------------|----------|
| `shimmer` | Loading skeleton sweep | 1.2s linear infinite |
| `cursor-blink` | Streaming text cursor blink | 800ms step-end infinite |
| `toast-in` | Toast slide + fade in from bottom-right | 200ms ease |
| `toast-out` | Toast fade out | 150ms ease |
| `fade-in` | Generic opacity 0 to 1 | 150ms ease |
| `spin` | Spinner rotation | 600ms linear infinite |

### Framer Motion Patterns

Used for page transitions and list animations:
- **Page enter**: `opacity: 0, y: 8` -> `opacity: 1, y: 0` (150ms)
- **List items**: stagger 30ms per item, same opacity/y animation
- **Always guard**: `useReducedMotion()` from Framer Motion

### Reduced Motion

All CSS animations and Framer Motion transitions respect `prefers-reduced-motion: reduce`:
- CSS `animation: none !important; transition: none !important;`
- Framer Motion: skip all motion when `useReducedMotion()` returns true

---

## Accessibility

### Focus States

All interactive elements get visible focus rings:
```css
:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
```

### Screen Reader

`.sr-only` utility class for visually hidden, accessible text:
```css
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Color-Blind Safety

Status indicators ALWAYS use icon + text label alongside color. Never rely on color alone:
- Open: Circle outline icon + "Open" text + amber background
- In Progress: Spinner icon + "In Progress" text + blue background
- Resolved: Checkmark icon + "Resolved" text + green background
- Escalated: Arrow-up icon + "Escalated" text + red background

### Keyboard Navigation

- All interactive elements reachable via Tab
- Escape closes modals and panels
- Enter submits forms and activates buttons
- Chat input: Ctrl+Enter or Cmd+Enter sends message
- Arrow keys navigate sidebar items and conversation list

### Touch Targets

Minimum 36px height for all clickable elements. Sidebar items, buttons, and list rows all meet this.

---

## Compliance Checklist

Before merging UI changes, verify:

### Colors
- [ ] Uses CSS custom properties or documented hex values
- [ ] No undocumented hardcoded colors
- [ ] Status colors match the status mapping table
- [ ] Dark mode tested (toggle `prefers-color-scheme`)
- [ ] Category badges use the documented tint palette

### Typography
- [ ] Uses `var(--font-sans)` or `var(--font-mono)` stacks
- [ ] Font sizes use documented tokens
- [ ] Uppercase + letter-spacing on eyebrow/section headers
- [ ] COID, case numbers, MID use monospace

### Spacing
- [ ] Uses documented spacing tokens
- [ ] Consistent padding within component types
- [ ] Proper gap in flex/grid layouts

### Accessibility
- [ ] Focus states visible on all interactive elements (`:focus-visible`)
- [ ] Status indicators have icon + text (not color-only)
- [ ] Reduced motion respected (CSS + Framer Motion)
- [ ] Touch targets >= 36px

### Animation
- [ ] Framer Motion uses `useReducedMotion()` guard
- [ ] CSS animations have `prefers-reduced-motion` override
- [ ] No decorative animations (work tool rule)
- [ ] Streaming text has cursor indicator

### Dark Mode
- [ ] All components tested in dark mode
- [ ] Shadows replaced with borders in dark mode
- [ ] Text contrast ratios meet WCAG AA (4.5:1 body, 3:1 large)
