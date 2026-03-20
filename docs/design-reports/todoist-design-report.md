# Todoist Design System Analysis -- Application to QBO Escalation Tool

**Date:** 2026-03-19
**Author:** Design Research Agent
**Scope:** Comprehensive analysis of Todoist design language, patterns, and philosophy with specific recommendations for the QBO Escalation Assistant.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Todoist Design Philosophy](#todoists-design-philosophy)
3. [Key Design Patterns](#key-design-patterns)
4. [Color System](#color-system)
5. [Typography and Spacing](#typography-and-spacing)
6. [Motion and Interaction](#motion-and-interaction)
7. [Accessibility](#accessibility)
8. [Application to QBO App (Primary Section)](#application-to-qbo-app)
9. [What NOT to Copy](#what-not-to-copy)
10. [Implementation Priority](#implementation-priority)
---

## Executive Summary

Todoist is one of very few productivity applications that uses red as its primary brand color. This is a calculated psychological choice: red signals urgency and importance, which aligns with the core product proposition of "your tasks matter, act on them now." The rest of the interface is deliberately stripped to near-white minimalism, creating a canvas where colored priority flags become the dominant visual signal. The entire design language serves a single purpose: reduce friction between thinking of a task and capturing it, then prioritize ruthlessly using color.

For the QBO Escalation Assistant, Todoist's most transferable ideas are not its specific colors but its deeper patterns: **priority-mapped color as the primary visual signal**, **quick-capture with inline metadata tagging**, **the psychological value of completion feedback**, and **information density managed through progressive disclosure rather than density reduction**. The QBO app already has a strong "Warm Authority" identity and a rich token system. Todoist's lessons should be layered on top, not replace what exists.

The single highest-impact adoption from Todoist would be implementing a **Quick Add escalation pattern** with natural-language parsing for case metadata (category, priority, INV numbers), inspired directly by Todoist's Q shortcut and inline symbol system. The second would be a **priority-mapped color system for escalation severity** that replaces the current status-only color coding with a heat-mapped urgency scale.

---

## Todoist Design Philosophy

### Red as Urgency -- The Foundational Decision

Todoist's primary brand color is  -- a warm, assertive red. This is unusual in productivity software. Most task managers choose calming blues (Microsoft To Do), friendly greens (Evernote), or neutral blacks (Things 3). Todoist's red is a deliberate psychological lever:

- **Red creates productive anxiety.** Not the harmful kind, but the motivational kind. When the primary CTA (the "Add task" button) pulses with red, it signals that capturing the task is urgent. The subtle implication: if you do not capture this now, you will forget it.
- **Red maps to highest priority.** Priority 1 (P1) uses the same  red as the brand. This creates a semantic loop: the brand itself IS urgency. You cannot separate "Todoist" from "get it done." This is not an accident -- it is the product's entire positioning compressed into a hex value.
- **Red against white maximizes salience.** Todoist's backgrounds are near-white ( app background,  secondary,  sidebar). Red against white is among the highest-contrast color combinations in the visible spectrum. Priority flags do not need labels -- they scream through color alone.

The design team at Doist has stated that the interface is intentionally sparse so that colored elements carry maximum meaning. When a surface is 95% white and 5% colored, every colored pixel is a signal. This is the opposite of a "colorful" interface like Monday.com, where color is ambient. In Todoist, color is informational.

### The Clean Task Canvas

Todoist's content area is one of the most visually quiet productivity interfaces in the market. The design philosophy can be summarized as: **the task list IS the UI**. There are no dashboards, no charts competing for attention, no promotional banners. When you open Todoist, you see tasks. Period.

Key canvas design decisions:

- **No chrome between tasks.** Task items are separated by single-pixel hairline dividers, not card boundaries. This creates a continuous reading flow rather than a collection of discrete objects.
- **Left-aligned, single-column content.** The task list does not use a grid or multi-column layout. It reads like a document -- top to bottom, left to right. This reduces eye scanning paths to a single vertical axis.
- **Metadata is subordinate to task names.** Due dates, labels, and project names appear in small, muted text below or beside the task name. The task name itself is the largest, darkest text element. Information hierarchy is enforced through size and weight, not decoration.
- **White space as structure.** Sections within projects are separated by generous vertical spacing and a section header, not by card borders or background color changes. The absence of visual boundaries is itself a design decision -- it prevents the interface from feeling like a database grid.
- **Sidebar as spatial anchor.** The left sidebar provides project navigation with a warm off-white background (), creating a subtle spatial divide between navigation and content. The sidebar is collapsible, and many power users hide it entirely, leaving nothing but the task list.

### Priority-Mapped Colors -- The Core Visual System

Todoist's most distinctive design pattern is its four-level priority color system:

| Priority | Color  | Hex         | Psychological Signal                    |
|----------|--------|-------------|-----------------------------------------|
| P1       | Red    |  | Fire alarm -- do this now               |
| P2       | Orange |  | Warm caution -- schedule this soon      |
| P3       | Blue   |  | Cool calm -- important but not urgent   |
| P4       | Gray   |  | Ambient -- handle whenever              |

This is a **heat map encoded as a flag system**. The colors progress from hot (red) to warm (orange) to cool (blue) to neutral (gray), mapping directly to the Eisenhower Matrix urgency axis. The progression leverages the universal association of warm colors with urgency and cool colors with calm.

Critical design detail: the priority colors appear as **small flag icons** on each task, not as background fills or card borders. This keeps the canvas clean while providing at-a-glance priority scanning. The flag is positioned consistently at the start of the task item, creating a tight visual cluster of "status + priority" information.

The priority system is **not customizable** in terms of colors or names. This is a deliberate constraint -- Todoist trades flexibility for instant comprehension.

---

## Key Design Patterns

### Quick Add -- The Zero-Friction Capture Pattern

Todoist's Quick Add is arguably the feature that defines the product's UX identity. Accessed via the  keyboard shortcut (or a global system shortcut even when the app is minimized), it opens a focused text input that uses **natural language parsing** to extract structured metadata from freeform text.

**How it works:**

1. User presses . A modal input appears immediately -- no page navigation, no context switch.
2. User types: "Review payroll changes tomorrow at 2pm p1 #Work @urgent"
3. Todoist parses this in real-time, extracting: Task name, Due date, Priority, Project, Label.
4. User presses Enter. Task is created with all metadata populated. The modal closes.

**Inline symbol system:**

| Symbol  | Function             | Example           |
|---------|----------------------|-------------------|
|      | Assign to project    |            |
|      | Apply label          |          |
|  | Set priority         |               |
|      | Set reminder         |   |
|      | Assign to person     |           |
|      | Specify section      |     |

**Design details of the Quick Add dialog:**

- It is a **floating modal**, not inline. It appears centered or near the top of the screen.
- The input field is a **single textarea** -- all metadata is entered in the same field as the task name. No separate dropdown menus. This is radical simplicity: one input, one action, full metadata.
- As the parser recognizes metadata keywords, they are **highlighted inline** with colored chips. This provides real-time feedback that parsing is working.
- If the parser misidentifies part of the task name as metadata, the user can **click the highlighted word** to cancel the parsing for that token.
- The dialog supports **file attachments** directly during quick add.

This pattern represents a fundamental insight: **metadata entry should happen during capture, not after**, and **natural language is faster than form fields** for structured data.

### Natural Language Date Parsing

Todoist's date parser handles: relative dates ("today", "tomorrow", "next Monday"), specific dates ("March 30"), times ("at 2pm"), recurring ("every Monday", "every other Tuesday"), complex recurring ("every 3rd Tuesday starting Aug 29 ending in 6 months"), duration-aware ("for 2 hours"), and contextual ("end of month", "next quarter"). The parser operates in real-time as the user types, with recognized date tokens highlighted immediately.

### Project Nesting and Sections

Todoist supports hierarchical project organization: **Projects** can be nested up to 4 levels deep. **Sections** within projects act as horizontal dividers (becoming Kanban columns in board view). **Sub-tasks** can be nested within any task. The visual treatment is minimal: nested projects are indented with a thin vertical line, sections use a bold header with generous top margin, sub-tasks are indented with a subtle left-border indicator.

### The Karma System -- Gamification Without Infantilization

Todoist's Karma system provides long-term engagement without feeling childish:

- **Points** earned by completing tasks, with higher-priority tasks worth more.
- **Daily goals** -- set a target number of completions per day.
- **Streaks** build when daily goals are met consecutively. Broken streaks reduce karma.
- **Weekly goals** add a longer cycle for variable workloads.
- **Levels** progress: Beginner, Novice, Intermediate, Professional, Expert, Master, Grandmaster, Enlightened.

Karma is displayed as a numerical score with progress bar. Historical trends use color-coded line graphs. The system is entirely opt-in and non-intrusive -- no interruptions, no celebrations, no cartoon mascots.

### Task Views -- List, Board, Calendar

Todoist offers three layout modes: **List** (default, vertical task list), **Board** (Kanban columns), **Calendar** (Pro, date grid). Switching uses a simple segmented control -- no page reload, no context loss.

### New Task View -- Two-Column Detail Layout

The 2025 task detail redesign: left column has task name, description, sub-tasks, comments; right sidebar has metadata attributes. Key decisions: written-out attribute labels (not icon-only), attributes ordered by usage frequency, unused attributes compact but visible, collapsible sections, and a small pie chart for sub-task completion progress.

---

## Color System

### Brand Palette

| Role                     | Color         | Hex         | Notes                                      |
|--------------------------|---------------|-------------|--------------------------------------------|
| Primary / Brand Red      | Red           | #DE483A     | CTAs, P1 priority, brand identity          |
| P2 Priority              | Orange        | #FF9933     | Also used for warnings                     |
| P3 Priority              | Blue          | #4073FF     | Cool counterpoint to warm priorities       |
| P4 Priority              | Gray          | #808080     | Absence of color = absence of urgency      |
| Success / Complete       | Green         | #058527     | Task completion checkmark                  |
| App Background           | White         | #FFFFFF     | Primary canvas                             |
| Secondary Background     | Off-white     | #FAFAFA     | Subtle surface differentiation             |
| Sidebar Background       | Warm cream    | #FCFAF8     | Barely perceptible warmth                  |
| Primary Text             | Near-black    | #202020     | Not pure black -- reduced eye strain       |
| Secondary Text           | Mid-gray      | #808080     | Metadata, timestamps                       |
| Muted Text               | Light gray    | #AAAAAA     | Placeholders, hints                        |
| Dark Background          | Charcoal      | #1F1F1F     | Dark mode canvas                           |
| Border (Light)           | Whisper gray  | #F0F0F0     | Nearly invisible dividers                  |
| Zeus (Brand Dark)        | Warm charcoal | #25221E     | Headers, strong text emphasis              |
| Fantasy (Brand Light)    | Warm white    | #FEFDFC     | Background canvas tone                     |

### Color Principles

1. **Warm neutrals, not cool grays.** Barely perceptible warm undertone reduces clinical feeling.
2. **Color is reserved for meaning.** Outside priority flags and brand CTA, the interface is monochromatic.
3. **Heat-mapped priority progression.** Red (hot) through orange (warm) to blue (cool) to gray (neutral). Cross-cultural, pre-linguistic thermal associations.
4. **Dark mode desaturation.** Text uses white with opacity values (87% primary, 54% secondary) rather than distinct gray hex values.
5. **Completion green is earned.** Green checkmark only appears after completion -- never in resting state. Green is a reward color.

---

## Typography and Spacing

### Typography

- **Font family**: System font stack (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif). No custom web fonts -- performance-conscious, feels native.
- **Task name**: Regular weight (400), approximately 14-15px. Reads like a document, not headlines.
- **Metadata text**: Regular weight, approximately 12px, in secondary gray.
- **Section headers**: Semi-bold (600), approximately 14px. Same size as tasks, differentiated by weight and top margin.
- **No text-transform**: Todoist does not use uppercase text anywhere in the primary interface. Contributes to "document" rather than "dashboard" feeling.

### Spacing

- **Task vertical rhythm**: 4-8px vertical space plus hairline divider. Very tight, optimized for scanning.
- **Section top margin**: 24-32px, creating clear visual breaks.
- **Sidebar item height**: 32-36px with 2-4px gaps.
- **Content padding**: 16-24px horizontal. Fills available width with maximum readable line length.
- **Sub-task indentation**: 24px per nesting level.

### Information Density Philosophy

1. **Hairline dividers instead of card boundaries.** Cards consume space with padding, borders, shadows, margins. Single-pixel dividers use the absolute minimum visual material.
2. **Inline metadata instead of separate rows.** Dates and labels on the same line as the task name saves one full line height per task.

---

## Motion and Interaction

### Completion Animation -- The Signature Micro-interaction

What happens when a task is checked off:

1. The checkbox fills with green (#058527) in a smooth radial reveal.
2. A subtle checkmark draws itself inside the circle (animated line-drawing effect).
3. Task text applies a strikethrough with a quick left-to-right animation.
4. On mobile, light haptic feedback accompanies the visual animation.
5. After approximately 500ms, the task fades out and remaining tasks collapse upward.

The completion animation is a **reward mechanism** -- a micro-dopamine hit that reinforces task completion behavior.

### General Motion Principles

- **Transitions are fast**: 150-250ms range. Never makes the user wait.
- **Task reordering uses spring physics**: surrounding items animate with spring-like easing.
- **Sidebar collapse is instantaneous**: approximately 200ms ease-out.
- **Quick Add appears instantly**: fade in with subtle scale-up (0.95 to 1.0) in under 150ms.

### Hover States

- List items: faint background fill (2-4% opacity gray).
- Buttons: slight darkening or opacity shift.
- Completion checkbox: thin colored border preview on hover.
- No scale transforms, no shadow lifts for task items. Tasks are a stable reading surface.

---

## Accessibility

### Current State

Todoist's accessibility record is mixed. Improvements include: written-out attribute labels, attribute chips with text labels, comprehensive keyboard shortcuts, and 2026 fixes for screen reader issues. However, independent assessments have found missing heading hierarchy, unlabeled images, and historical inaccessibility for blind users.

### Applicable Accessibility Patterns

1. **Text labels alongside icons.** Icons are ambiguous; text is not.
2. **Keyboard shortcut system.** Benefits power users and keyboard-only users equally.
3. **Color is never the sole indicator.** Priority uses both color AND flag icon shape.

---

## Application to QBO App

This is the most important section. The QBO Escalation Assistant has a fundamentally different use case from Todoist (real-time escalation support vs. personal task management), but several Todoist patterns translate directly to high-value improvements.

### 1. Quick Add Escalation -- The Highest-Impact Adoption

**The Todoist pattern:** Press Q to open a floating input. Type freeform text with inline symbols to capture a task with full metadata instantly.

**The QBO application:** The escalation specialist's primary workflow is receiving information from a phone agent (via text/chat), rapidly categorizing it, and either resolving it or routing it. This is fundamentally a **capture and categorize** workflow -- exactly what Quick Add is designed for.

**Proposed implementation:**

- **Global shortcut** (e.g., Ctrl+K or Q) opens a floating Quick Add panel from anywhere in the app.
- User types: "Bank feed disconnect Chase acct p1 #bank-feeds @inv-123456"
- Parser extracts: Title, Priority P1, Category bank-feeds, INV reference INV-123456.
- Pressing Enter creates the escalation with all metadata populated.

**Symbol mapping for QBO context:**

| Symbol   | QBO Meaning        | Example                        |
|----------|--------------------|--------------------------------|
| #        | Category           | #payroll, #bank-feeds          |
| p1-p4    | Priority/Severity  | p1 = critical, p4 = low       |
| @inv-    | INV case link      | @inv-123456                    |
| !        | Deadline/SLA       | !2h (2-hour SLA)              |

### 2. Priority-Mapped Severity Colors -- Heat-Mapped Escalation Urgency

**The Todoist pattern:** Four priority colors (red > orange > blue > gray) that form a heat map from urgent to ambient.

**The current QBO state:** The app uses status-based colors (Open = gold, In Progress = ember, Resolved = green, Escalated = red). These communicate **lifecycle stage**, not **urgency level**.

**Proposed enhancement -- add a severity dimension:**

| Severity    | Color        | Existing Token              | QBO Meaning                                                |
|-------------|--------------|-----------------------------|------------------------------------------------------------|
| S1 Critical | Red          | --danger (#b33025)          | System down, revenue-impacting                             |
| S2 High     | Orange/Ember | --accent (#c76a22)          | Feature broken, workaround exists                          |
| S3 Medium   | Blue         | New token (#4073FF)         | Confusion, how-to, non-blocking                            |
| S4 Low      | Gray         | --ink-tertiary (#9a8b7c)    | Documentation request, no time pressure                    |

Severity should appear as a **small colored indicator** (dot, flag, or left-border accent) on escalation cards, NOT as background fill. The existing status badges remain unchanged -- severity is an orthogonal dimension.

### 3. Chat Input Enhancement -- Inline Metadata During Capture

**The Todoist pattern:** Metadata is entered in the same text field as the content, parsed in real-time.

**Proposed enhancement:** When the user types specific prefixes in the chat input, the system recognizes them: #category tags the conversation, p1-p4 sets severity, @inv-XXXXXX cross-references an INV case, !sla 2h sets an SLA timer. Recognized tokens are highlighted inline. Tokens are stripped before sending to AI but applied to the conversation/escalation record. This transforms the chat input into a **command palette** without adding visible UI complexity.

### 4. Completion Satisfaction -- Resolution Feedback

**The Todoist pattern:** Satisfying animation when a task is checked off.

**Proposed enhancement:** When an escalation is marked Resolved: (1) status badge animates from current color to green (200ms), (2) checkmark icon draws itself inside the badge, (3) brief green pulse radiates from the badge (300ms), (4) optional "+X points" flyout if streak system exists. Total duration under 500ms. Use existing --ease-emphasized curve. This is a low-effort, high-impact change -- entirely CSS animation plus a small React state transition.

### 5. Clean Canvas Principle -- Reduce Visual Noise on Dashboard

**The Todoist pattern:** Hairline dividers instead of card boundaries. White space as structure.

**Proposed refinements:**

- **Reduce card elevation on list views.** Switch from .card (--shadow-md, border, gradient, inset highlight) to single bottom border (1px solid var(--line-subtle)) with no shadow.
- **Widen the content area.** The current .app-content-constrained maxes at 1060px. For list views, allow 1200-1400px.
- **Reduce badge visual weight.** Create .badge-inline variant without shadows/text-shadows for list use.
- **Use section headers instead of card groups.** Todoist-style bold text label with generous top margin and single hairline below.

### 6. Productivity Metrics -- Karma for Escalation Specialists

**Proposed "Resolve Streak" system:**

- **Daily resolution count** tracked per specialist session.
- **Streak counter** for consecutive days meeting the daily target.
- **Resolution rate graph** -- personal version of existing Analytics.
- **Average resolution time** trend gamified as "getting faster."
- **Category expertise badges** earned after N resolutions in a category.

Visual treatment: small productivity widget in sidebar footer, compact counter showing resolutions/target, flame or streak icon, dedicated "My Performance" view. Makes throughput targets feel like personal achievements rather than management quotas.

### 7. Board View for Escalation Workflow

**Proposed implementation:** Add board/Kanban toggle to dashboard header. Columns: Open | In Progress | Waiting | Escalated | Resolved. Cards show title, category badge, severity indicator, age timer. Drag-and-drop updates status. Cards sorted by severity (S1 at top).

### 8. Collapsible Sections in Escalation Detail

Wrap each section (Description, AI Response, Copilot Suggestions, Similar Cases, Timeline) in collapsible containers. Section headers show name, chevron toggle, and brief summary. Default expanded for most recent, collapsed for historical items. Add Todoist-style small pie chart for resolution checklist progress.

### 9. Sidebar Navigation -- Todoist's Spatial Anchoring

The current QBO sidebar already follows the warm off-white, accent-for-active, collapsible pattern well. Proposed refinements:

- **Group nav items into sections**: "WORK" (Chat, Dashboard, Investigations), "TOOLS" (Playbook, Templates, Model Lab), "MONITOR" (Analytics, Usage, Gallery).
- **Favorite/pin system**: Pin most-used views to a "Favorites" section at the top.
- **Conversation list section**: More prominent header with count badge.

---

## What NOT to Copy

Not every Todoist pattern is appropriate for the QBO Escalation Assistant.

### 1. Do Not Copy the Sparse Canvas for the Chat View

Todoist extreme minimalism works for task lists because tasks are inherently short, structured items. Chat messages are longer, more complex, and benefit from visual separation (bubble backgrounds, sender differentiation). The current QBO chat bubble design (--bubble-user, --bubble-assistant) with background fills is correct.

### 2. Do Not Copy Todoist Red as the QBO Primary Accent

The QBO app Warm Authority identity uses ember/amber (--accent: #c76a22). This communicates warmth and expertise. Switching to Todoist aggressive red (#DE483A) would shift personality from calm authority to urgent alarm. Red should be reserved for S1/Critical severity and error states.

### 3. Do Not Copy the Karma Level Names

Beginner to Enlightened would feel patronizing in a professional workplace. Use role-appropriate titles (Analyst, Expert, Master Specialist) or avoid named levels entirely.

### 4. Do Not Copy Non-Customizable Priority Colors

Todoist locks colors for universal meaning. In an escalation tool, teams may need to customize severity colors. Use CSS custom properties for flexibility.

### 5. Do Not Copy the System Font Stack

Todoist uses native system fonts for performance. The QBO app uses Inter -- a deliberate choice for long-reading comfort. Inter consistent x-height and tabular numbers are superior for data-dense UI. Keep Inter.

### 6. Do Not Copy Board View as the Default

List view with filters is the correct default for rapid scanning and sorting. Board view should be an option, not the default.

### 7. Do Not Copy Todoist Light Borders

Todoist uses #F0F0F0 borders -- nearly invisible. The QBO app uses --line: #d4cbc0 (light), which is significantly more visible. In a support tool with complex multi-section views, stronger borders provide necessary structural delineation.
---

## Implementation Priority

### Tier 1 -- High Impact, Moderate Effort (Implement First)

| Item | Description | Effort | Impact |
|------|-------------|--------|--------|
| **Quick Add Escalation** | Global shortcut (Ctrl+K) opens floating input with inline symbol parsing for category, severity, INV | 2-3 days | Transformative for capture speed |
| **Severity Color System** | Add S1-S4 severity tokens alongside existing status tokens. Small colored indicator on cards. | 0.5 day | Immediate triage improvement |
| **Resolution Animation** | CSS animation on status change to Resolved: color transition + checkmark draw + green pulse | 0.5 day | Psychological satisfaction |

### Tier 2 -- High Impact, Higher Effort

| Item | Description | Effort | Impact |
|------|-------------|--------|--------|
| **Chat Input Metadata Parsing** | Recognize #category, p1-p4, @inv-XXXXXX in chat input with inline highlighting | 2-3 days | Speeds up every conversation |
| **Dashboard Card Reduction** | Switch list items from full cards to hairline-separated rows with inline metadata | 1 day | Faster scanning on dashboard |
| **Board View for Escalations** | Kanban columns by status with severity-sorted cards | 2-3 days | Visual workflow management |

### Tier 3 -- Medium Impact, Moderate Effort

| Item | Description | Effort | Impact |
|------|-------------|--------|--------|
| **Collapsible Detail Sections** | Add chevron toggles to escalation detail sections with animated expand/collapse | 1 day | Reduces scroll fatigue |
| **Sidebar Section Grouping** | Organize nav items into WORK / TOOLS / MONITOR sections with headers | 0.5 day | Clearer navigation |
| **Inline Badge Variant** | Create .badge-inline without shadows/text-shadows for list use | 0.5 day | Cleaner list appearance |

### Tier 4 -- Nice to Have, Higher Effort

| Item | Description | Effort | Impact |
|------|-------------|--------|--------|
| **Resolve Streak System** | Daily goals, streak counter, personal resolution graph | 3-5 days | Long-term engagement |
| **Sidebar Favorites/Pins** | Allow pinning views to a Favorites section | 1-2 days | Personalization |
| **Sub-task Completion Pie** | Small progress indicator on resolution checklists | 0.5 day | Visual progress feedback |

---

## Sources

- [Todoist Brand Color Palette (Mobbin)](https://mobbin.com/colors/brand/todoist)
- [Introduction to Priorities (Todoist Help)](https://www.todoist.com/help/articles/introduction-to-priorities-Wy82Jp)
- [Use Task Quick Add in Todoist](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz)
- [Todoist Karma](https://www.todoist.com/karma)
- [Todoist Gamification Case Study (Trophy)](https://trophy.so/blog/todoist-gamification-case-study)
- [Introduction to Karma (Todoist Help)](https://www.todoist.com/help/articles/introduction-to-karma-OgWkWy)
- [Todoist New Task View](https://www.todoist.com/inspiration/todoist-new-task-view)
- [Todoist Board Layout](https://www.todoist.com/help/articles/use-the-board-layout-in-todoist-AiAVsyEI)
- [Todoist Keyboard Shortcuts](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2)
- [Todoist Priority Colours (Dribbble)](https://dribbble.com/shots/6102459-Todoist-Priority-Colours)
- [Complete Task Animation (Dribbble)](https://dribbble.com/shots/6145365-Complete-Task-Animation)
- [The Conceptual Design of Todoist](https://tuanmon.com/the-conceptual-design-of-todoist/)
- [Todoist: Shaping Productivity Through Design](https://www.tsamoudakis.com/portfolio/todoist-shaping-productivity-through-design/)
- [Doist Design Development Workflow](https://www.todoist.com/inspiration/design-development-workflow)
- [Todoist Brand Color Codes (ColorCodesHub)](https://colorcodeshub.com/brand/todoist)
- [How to Use Todoist Effectively](https://www.todoist.com/inspiration/how-to-use-todoist-effectively)
- [Natural Language in Todoist](https://thesweetsetup.com/using-natural-language-with-todoist/)
