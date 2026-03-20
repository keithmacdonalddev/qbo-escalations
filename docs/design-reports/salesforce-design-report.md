# Salesforce Lightning Design System (SLDS) -- Design Research Report

*Research conducted March 2026. Covers SLDS 1.x legacy patterns and SLDS 2 (Winter 26 v2.3.0, GA).*

---

## Executive Summary

Salesforce Lightning Design System is the most mature enterprise design system in production today. It powers a CRM platform used by 150,000+ organizations, many of whom employ dedicated support agents spending 8-10 hours daily inside the interface. This makes it the single most relevant design system to study for the QBO Escalation Assistant -- a tool serving the same user archetype (back-office support specialists) dealing with the same core problem (case management, triage, resolution tracking).

SLDS is not a design system optimized for beauty. It is optimized for **data density, navigational clarity, and agent productivity at scale**. Where Linear or Stripe can afford visual minimalism because their users interact with a narrow slice of data, Salesforce must render hundreds of fields, dozens of related records, and complex case histories -- all without the interface collapsing into chaos. This is exactly the problem the QBO app faces as it grows.

The key ideas worth incorporating are:

1. **Object-colored navigation** -- each record type gets a unique color, creating instant visual recognition without reading labels
2. **Highlights panel** -- the top 5-7 most critical fields for any record, always visible, never buried
3. **Density toggle** -- user-controlled compact/comfy switching, because different tasks need different information density
4. **Utility bar** -- persistent bottom toolbar for tools the agent needs constantly (chat, notes, timers, quick actions)
5. **Split view** -- list + detail side by side, so agents can scan queues without losing context on their current case
6. **AI side panel** -- Einstein/Agentforce Copilot lives in a persistent side panel, exactly like the QBO app AgentDock
7. **Related lists with lifecycle awareness** -- showing different information depending on where a case is in its lifecycle

What NOT to copy: Salesforce visual weight (it looks heavy and dated), its reliance on full-page reloads for many operations, its complex permission-layered customization model, and its tendency toward feature sprawl at the expense of coherence.


---

## 1. Salesforce Design Philosophy

### 1.1 The Four Pillars

SLDS is built on four stated principles:

- **Clarity** -- Can the user find what they are looking for? In an enterprise CRM with hundreds of objects and thousands of fields, this is the hardest problem. Salesforce solves it with consistent layout templates, object-colored icons, and a global search that understands natural language.
- **Efficiency** -- Reusable components make development faster, but more importantly, they make the user faster. Every Salesforce record page follows the same pattern: highlights panel at top, tabbed detail sections below, related lists in a predictable location. Agents build muscle memory.
- **Consistency** -- The system contains 60+ documented components and 900+ HTML blueprints with accessibility annotations. Every button looks like a button. Every data table sorts the same way. Every modal dismisses the same way. This removes decision fatigue.
- **Beauty** -- Listed last for a reason. Salesforce explicitly prioritizes function over aesthetics. The system looks professional but never tries to be gorgeous. This is a deliberate trade-off: visual restraint serves data density.

### 1.2 Enterprise Scale Thinking

Salesforce design decisions make sense only when you understand the constraints:

- **Data density is king.** A support agent managing 40 cases simultaneously cannot afford generous whitespace. Every pixel of screen real estate must earn its place. This is why Salesforce offers density toggles -- comfy mode for onboarding/training, compact mode for veterans who need maximum information per viewport.
- **Navigation must be instant.** The workspace tab model (primary tabs for major records, subtabs for related records) means an agent can have an Account tab open with Case, Contact, and Knowledge subtabs -- all accessible in one click without page navigation.
- **Color is functional, never decorative.** Object colors exist to help agents instantly identify what type of record they are looking at. The periwinkle Account icon, the coral Lead icon, the yellow Case icon -- these are learned associations that work faster than reading text labels.
- **Everything must scale to 100+ custom objects.** Salesforce cannot assume which objects exist. The design system must work whether an org has 10 objects or 500. This forces extreme modularity and consistent patterns.

### 1.3 The Service Console Paradigm

The Lightning Service Console is Salesforce purpose-built interface for support agents. It is the single most relevant precedent for the QBO Escalation Assistant. Its key structural decisions:

- **Three-column layout**: Case details (left), highlights panel (center/top), related lists and knowledge articles (right). This creates a workflow where the agent sees the case, its key metadata, and resolution resources simultaneously.
- **Split view**: A slide-out panel showing the current list view (e.g., My Open Cases) alongside the active case detail. The agent can scan their queue without leaving the case they are working on.
- **Utility bar**: A persistent bottom toolbar providing instant access to global tools -- notes, phone, chat, timer, history. These tools are always one click away regardless of which case is active.
- **Case feed**: A chronological timeline of all case activity -- call logs, emails, status changes, internal notes -- compiled into a single scrollable feed. This is the case story.


---

## 2. Key Design Patterns

### 2.1 Record Pages

Every Salesforce record page follows a template structure. This consistency is the most powerful UX decision in the system.

**Page anatomy (top to bottom):**

1. **Highlights Panel** -- Controlled by compact layouts, displays up to 7 key fields. The first field (typically the record name) renders in an accented, larger font. Remaining fields display as label-value pairs in a horizontal row. This panel is always visible and never scrolls.

2. **Path Component** -- A horizontal step indicator showing where the record is in its lifecycle (e.g., New -> Working -> Escalated -> Resolved). Clicking a step reveals the key fields relevant to that stage. This is essentially a progress bar with contextual data.

3. **Tab Bar** -- Record content is organized into tabs: Details, Related, Activity, and optionally custom tabs. This prevents vertical scrolling fatigue by chunking information.

4. **Details Tab** -- Field sections with label-value pairs. In compact mode, labels appear to the left of values. In comfy mode, labels appear above values. Sections can have conditional visibility rules tied to field values.

5. **Related Tab** -- Related lists (child records) displayed as compact tables. Each related list shows the most recent 6 records with a View All link. Related lists are individually collapsible.

6. **Activity Tab** -- Timeline of all activities (tasks, events, emails, calls) rendered chronologically with the most recent at top.

**Application to QBO:** The escalation detail page should adopt this structure. The highlights panel pattern maps directly to showing case number, status, category, priority, and age at a glance. The tab pattern would organize the escalation details, related conversations, and activity history without vertical scroll overload.

### 2.2 Related Lists

Related lists in Salesforce are compact data tables embedded within a parent record page. They show child records (e.g., a Case related Emails, Tasks, or Knowledge Articles).

Key design decisions:

- **Default to 6 rows visible** -- enough to see recent activity, not so many that the page becomes a spreadsheet
- **Column selection is curated** -- only 3-5 columns per related list, showing the most actionable fields
- **View All expands to full table** -- clicking opens a full data table with sorting, filtering, and pagination
- **Each related list has a header** with record count and a New action button
- **Lists are individually collapsible** -- agents can hide related lists they rarely use

**Application to QBO:** The escalation detail view currently shows a two-column split layout. Adding related list patterns for Related Conversations, Linked INV Cases, and Similar Escalations would give agents quick access to contextual information without cluttering the primary detail view.

### 2.3 Global Search

Salesforce global search (enhanced by Einstein Search) sits in a persistent top bar and provides:

- **Instant results as you type** -- no need to press Enter
- **Natural language support** -- show me open cases from last week works
- **Object-scoped results** -- results are grouped by object type (Cases, Accounts, Contacts), each with its object color
- **Recent items** -- clicking the search bar immediately shows recently viewed records
- **Search layouts** -- administrators configure which columns appear in search results per object

**Application to QBO:** The app currently lacks a global search. Adding one that searches across escalations, INV cases, conversations, and playbook articles -- with results grouped by type and color-coded -- would be a significant productivity gain. The Salesforce pattern of showing recent items on focus (before typing) is particularly valuable.

### 2.4 Utility Bar

The utility bar is a persistent strip at the bottom of the Service Console that provides quick access to tools without leaving the current context. Common utility bar items:

- **Notes** -- quick note-taking without navigating away
- **Phone/Softphone** -- integrated telephony controls
- **History** -- recently viewed records
- **Macros** -- one-click automation for repetitive tasks (e.g., send acknowledgment email and set status to Working)
- **Timer** -- case handling time tracker
- **Omni-Channel** -- agent availability and routing status

Each utility bar item opens as a docked panel at the bottom of the screen, overlaying but not replacing the current view.

**Application to QBO:** The AgentDock already fills part of this role. But a dedicated utility bar for quick actions -- Copy Case ID, Open in QBO, Start Timer, Quick Note -- would reduce friction for repetitive micro-tasks.

### 2.5 Case Management UX

Salesforce case management is the most directly applicable pattern for the QBO app.

**Case Feed:** All case activity compiled into a single chronological feed including email correspondence, internal notes, status changes, escalation events, knowledge article suggestions, and AI-generated summaries.

**Case Lifecycle Automation:** Cases follow defined stages. At each stage, different fields, actions, and components become relevant. Salesforce uses conditional visibility to show only what is needed at the current stage:
- New case: classification fields and quick-triage actions
- Working case: resolution notes, knowledge search, and timer
- Escalated case: escalation reason, target team, and SLA timer
- Resolved case: resolution summary, satisfaction survey, and close actions

**Omnichannel Routing:** Cases arrive from multiple channels (email, phone, chat, social) and are routed to agents based on skills, availability, and capacity. The unified inbox consolidates all channels into a single queue.

**Application to QBO:** The escalation detail page should adopt lifecycle-aware component visibility. When an escalation is Open, show triage tools prominently. When In Progress, surface the chat/AI tools and resolution templates. When Resolved, collapse working tools and show the resolution summary.

### 2.6 Einstein/Agentforce AI Integration

Salesforce AI integration (formerly Einstein Copilot, now Agentforce Assistant) provides:

**Side Panel Design:** The AI assistant lives in a persistent side panel accessible via an icon toggle. It supplements existing UI without replacing it. The panel can be opened and closed without disrupting workflow.

**Standard AI Actions:**
- **Summarize Record** -- generates a plain-language summary of case history and current state
- **Draft/Revise Email** -- generates email responses based on case context
- **Answer Questions with Knowledge** -- searches the knowledge base and synthesizes answers
- **Query Records** -- natural language queries against the CRM data

**Contextual Awareness:** The AI assistant is context-aware -- it knows which record the agent is viewing and can reference that record data without the agent needing to provide it.

**Application to QBO:** The app Chat and CopilotPanel already implement a similar pattern. The key Salesforce insight is **contextual pre-loading** -- when the agent opens a chat while viewing an escalation, the AI should automatically have that escalation context loaded. The Summarize Record pattern maps perfectly to auto-summarizing escalation history.


---

## 3. Color System

### 3.1 Brand and Interface Colors

Salesforce uses a carefully constrained color system:

| Token | Hex | Purpose |
|-------|-----|---------|
| Brand Primary | #0176D3 | Interactive blue -- buttons, links, focus rings |
| Brand Dark | #032D60 | Dark navy -- sidebar background, deep contrast |
| Brand Legacy | #1589EE | Classic cloud blue (pre-Lightning) |
| Text Primary | #181818 | Main text color |
| Text Secondary | #444444 | Supporting text |
| Text Muted | #706E6B | Helper text, placeholders |
| Text Inverse | #FFFFFF | Text on dark backgrounds |
| Text Link | #0176D3 | Hyperlinks (matches brand) |
| Surface Primary | #FFFFFF | Card surfaces |
| Surface Page | #F3F3F3 | Page-level background (gray-100) |
| Border Default | #C9C9C9 | Standard borders |
| Border Light | #E5E5E5 | Subtle borders |
| Border Focus | #0176D3 | Focus ring color |
| Success | #2E844A | Positive states |
| Warning | #DD7A01 | Caution states |
| Error | #C23934 | Error/destructive states |
| Info | #0176D3 | Informational (matches brand) |

### 3.2 Object-Specific Colors

This is Salesforce most distinctive and powerful color pattern. Each standard object has a unique background color for its icon, creating instant visual recognition:

| Object | Hex | Color Name | Icon |
|--------|-----|------------|------|
| Account | #7F8DE1 | Periwinkle | Building |
| Contact | #A094ED | Lavender | Person |
| Opportunity | #FCB95B | Gold | Trophy/Lightning |
| Lead | #F88962 | Coral | Person+ |
| Case | #E3D076 | Yellow-gold | Briefcase |
| Task | #4BC076 | Green | Checkmark |
| Campaign | #F2CF5B | Warm yellow | Target |
| Report | #2ECBBE | Teal | Chart |
| Dashboard | #E87EAD | Pink | Gauge |
| Knowledge | #EB7092 | Rose | Book |
| Email | #95AEC5 | Steel blue | Envelope |

**Why this matters:** When a support agent is looking at a screen with 15 open subtabs, the object color on each tab icon tells them instantly whether they are looking at a Case, a Contact, or a Knowledge Article. This is faster than reading text labels, especially at small tab sizes. The colors are muted pastels -- saturated enough to be distinguishable but desaturated enough to not create visual noise.

**Application to QBO:** The app already uses category-specific badge colors (payroll = purple, bank-feeds = blue, tax = red, etc.). The opportunity is to extend it beyond badges:
- Sidebar navigation items for each section could have subtle color indicators
- Escalation cards in the dashboard could have a left-border color strip matching their category
- Tab icons in the AgentDock could use object colors to distinguish Chat, Workspace, and Dev tabs
- INV case cards could use a distinctive color to visually separate them from regular escalations

### 3.3 SLDS 2 Color Token Architecture

SLDS 2 replaces the older design token system with CSS custom properties called styling hooks using a --slds-g-* prefix for global hooks:

- --slds-g-color-brand -- primary brand color
- --slds-g-color-border -- default border color
- --slds-g-color-on-surface -- text on surface backgrounds
- --slds-g-spacing-* -- spacing scale
- --slds-g-font-* -- typography tokens
- --slds-g-radius-* -- border radius scale

**Application to QBO:** The app existing CSS custom property system (--accent, --bg-raised, --ink-secondary, etc.) already follows this pattern. The Salesforce insight is the separation between global tokens (used everywhere) and component tokens (scoped to specific components). The QBO app could benefit from introducing component-scoped tokens like --chat-bubble-bg, --sidebar-nav-active, --escalation-card-border.

### 3.4 Color Principles

Salesforce documents four foundational color principles:

1. **Intentionality** -- Colors convey specific meaning. Red means error. Green means success. Blue means interactive. These associations are never violated.
2. **Hierarchy** -- Higher contrast draws more attention. The contrast ladder creates a scannable visual hierarchy.
3. **Branding** -- Colors represent brand identity. Salesforce blue says trust. The QBO app ember amber says warmth and authority.
4. **Accessibility** -- The system adheres to WCAG guidelines by default. Component blueprints include contrast-passing color combinations.


---

## 4. Typography and Spacing

### 4.1 Typography

SLDS 2 uses three font families:

- **Salesforce Sans** (Regular) -- body text and UI elements, designed for legibility at small sizes on screen
- **Inter** (Google Font) -- used for navigation elements, highly legible with open apertures
- **AvantGarde for Salesforce** (400 weight) -- used for headings, adds visual distinction

The system uses a **16px root REM** value, establishing a base scale:

| Role | Size | Weight | Usage |
|------|------|--------|-------|
| Page Title | 20px (1.25rem) | 700 | Page headers |
| Section Heading | 16px comfy / 14px compact | 600 | Card/section headers |
| Body | 14px (0.875rem) | 400 | Primary content |
| Caption/Helper | 12px (0.75rem) | 400 | Metadata, timestamps |
| Label | 12px (0.75rem) | 600-700 | Form labels, eyebrow text |

In compact mode: title font size drops from 1rem to 0.875rem, line-height decreases from 1.5 to approximately 1.3, and labels move from above fields to beside fields.

A notable SLDS 2 change: the default font changed from Salesforce Sans to the system UI font stack (-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif). This aligns with platform conventions.

**Application to QBO:** The app uses Inter as its primary font with a well-defined type scale (11px-28px). The Salesforce insight worth adopting is the **dual-font strategy** -- using a distinct heading font creates stronger visual hierarchy.

### 4.2 Spacing

SLDS uses a 4px base grid with the following scale:

| Token | Value | Usage |
|-------|-------|-------|
| xxxx-small | 2px | Hairline gaps |
| xxx-small | 4px | Icon padding, tight groups |
| xx-small | 8px | Inline spacing, compact gaps |
| x-small | 12px | Card internal padding (compact) |
| small | 16px (1rem) | Standard card padding |
| medium | 20px | Section gaps |
| large | 24px (1.5rem) | Between cards/sections |
| x-large | 32px (2rem) | Page-level margins |
| xx-large | 48px (3rem) | Major section breaks |

In compact mode, vertical spacing tokens are halved (e.g., varSpacingMedium: 16px comfy -> 8px compact). Horizontal spacing remains unchanged.

**Application to QBO:** The app spacing scale (--sp-1 through --sp-10, 4px to 36px) is similar. The density toggle concept would be implemented with a --density-factor CSS custom property that scales vertical spacing: 1 for standard, 0.65 for dense.

---

## 5. Motion and Interaction

### 5.1 Motion Principles

Salesforce motion system (Salesforce Kinetics) follows three principles:

1. **Transitional motion** -- informs the user that a context change is occurring
2. **Personality/Branding motion** -- rare, reserved for moments of delight (e.g., confetti animation on Path component success)
3. **Functional motion** -- draws attention to changes (e.g., field value update highlights)

### 5.2 Timing and Easing

| Category | Duration | Usage |
|----------|----------|-------|
| Micro-interactions | 100-200ms | Button press, toggle, focus ring |
| Small transitions | 200-300ms | Dropdown open, tooltip appear |
| Medium transitions | 300-400ms | Panel slide, modal enter |
| Large transitions (2-5 objects) | 300-400ms | Multi-element choreography |
| Complex transitions (6-10 objects) | 500-700ms | Page-level state changes |

Easing guidelines: ease-out for entering elements, ease-in for exiting elements, ease-in-out for point-to-point movement, linear for opacity/color changes only.

The core principle: **subtle, short, functional.** Salesforce warns against strong flashing or large motion and emphasizes animation should increase the perceived speed of a task.

**Application to QBO:** The app motion system is already well-developed. The Salesforce insight to consider is **choreography** -- when multiple elements animate simultaneously, stagger them slightly (50-100ms offsets) so the user can track the change.

---

## 6. Accessibility

### 6.1 SLDS Accessibility Architecture

SLDS contains 900+ HTML blueprints, each annotated with required ARIA roles, keyboard interaction patterns, focus management rules, and screen reader announcements.

**Focus Management:**
- Never steal focus on component initialization unless the component is a modal/dialog
- When an inline form appears from a button click, the form must follow the button in DOM order
- When a modal closes, focus returns to the element that triggered it
- Complex components use arrow-key navigation internally, with Tab moving focus out

**Keyboard Navigation:**
- Tab/Shift+Tab for moving between interactive elements
- Arrow keys for navigating within complex components (data tables, menus, tab sets)
- Enter/Space for activation
- Escape for dismissal (modals, dropdowns, popovers)

**Contrast:**
- SLDS exceeds WCAG 2.0 AA requirements. Text colors were specifically darkened to go above and beyond standard contrast ratios.
- Brand blue (#0176D3) passes 4.5:1 contrast against white backgrounds.

**Application to QBO:** The app has solid accessibility foundations. The Salesforce pattern to adopt is **consistent focus return** -- when any overlay, modal, or panel closes, focus returns to the trigger element. The escalation dashboard data table should implement arrow-key row navigation.


---

## 7. Application to the QBO Escalation Tool

This is the most important section. Salesforce case management is directly relevant to escalation handling. Here are the specific, actionable incorporations ranked by impact.

### 7.1 Highlights Panel for Escalations (HIGH IMPACT)

**What Salesforce does:** Every record page shows the 5-7 most critical fields in a persistent, non-scrolling highlights panel at the top. The first field is rendered prominently.

**What QBO should do:** The escalation detail page should have a persistent header strip showing Case Number (large, accented font), Status (badge), Category (category badge), Priority, Age (time since creation), Assigned Agent, and Source. This strip never scrolls. It is always visible.

### 7.2 Object-Color Extended Throughout (HIGH IMPACT)

**What Salesforce does:** Each object type has a unique color visible in icons, tab indicators, and search results.

**What QBO should do:** Extend the existing category colors beyond badges:
- Sidebar nav items: subtle left-border color accent per section when active
- Escalation cards: 3px left-border color strip matching category color for scannable patterns
- AgentDock tabs: colored indicator dot or underline per tab
- INV cases: distinctive color to separate from regular escalations

### 7.3 Lifecycle-Aware Component Visibility (HIGH IMPACT)

**What Salesforce does:** Different components, fields, and actions appear/disappear based on record lifecycle stage.

**What QBO should do:** Show different tool panels based on escalation status:
- **Open**: Prominent triage controls, AI classification, category assignment
- **In Progress**: Chat/AI panel, resolution templates, knowledge search, playbook reference
- **Escalated**: Escalation path details, target team info, SLA timer
- **Resolved**: Resolution summary, similar-to suggestions, feedback/rating

This is the single most impactful Salesforce pattern for the QBO app.

### 7.4 Density Toggle (MEDIUM-HIGH IMPACT)

**What Salesforce does:** Users choose between Comfy and Compact modes. Compact shows approximately 30% more information.

**What QBO should do:** Add a density toggle with Standard (current spacing) and Dense (reduced vertical padding, smaller metadata fonts, tighter card gaps) modes. Implement via --density-factor CSS custom property: 1 for standard, 0.65 for dense.

### 7.5 Case Feed / Activity Timeline (MEDIUM-HIGH IMPACT)

**What Salesforce does:** All case activity renders in a single chronological feed.

**What QBO should do:** Add an Activity tab/section compiling chat conversation summaries, status changes (with before/after values), INV case links, image uploads, and AI-generated triage results.

### 7.6 Split View for Dashboard (MEDIUM IMPACT)

**What Salesforce does:** Split view shows list panel alongside detail panel.

**What QBO should do:** Offer a split view mode in the escalation dashboard: filtered list on left, selected escalation detail on right. Enables rapid triage without back-and-forth navigation.

### 7.7 Global Search (MEDIUM IMPACT)

**What Salesforce does:** Persistent search across all objects with recent items on focus and color-coded result grouping.

**What QBO should do:** Add Cmd+K/Ctrl+K search across escalations, INV cases, conversations, playbook articles, and Gmail threads. Group results by type with color-coded section headers. Show recent items on focus before typing.

### 7.8 Utility Bar for Quick Actions (LOW-MEDIUM IMPACT)

**What Salesforce does:** Persistent bottom bar with docked tool panels.

**What QBO should do:** Minimal utility bar with Quick Note, Timer, Copy Actions, and QBO Deep Link. Lower priority since AgentDock covers some of this.

### 7.9 Contextual AI Pre-Loading (LOW-MEDIUM IMPACT)

**What Salesforce does:** Einstein Copilot automatically has context about the current record.

**What QBO should do:** When navigating to an escalation detail page and opening Chat/AI, the AI should automatically receive escalation context (subject, category, status, conversation history, related INV cases). The chat-orchestrator should detect the active escalation from the route.

---

## 8. What NOT to Copy

Not everything Salesforce does is worth emulating. Some patterns are enterprise bloat that would harm a focused tool like the QBO app.

### 8.1 Visual Heaviness

Salesforce UI feels heavy. Thick borders, strong shadows, dense button groups, and heavy toolbar chrome create visual weight appropriate for a platform serving 150,000 organizations but oppressive for a single-user tool. The QBO app Warm Authority aesthetic -- warm neutrals, restrained shadows, generous breathing room -- is superior for a tool one person uses 8 hours a day.

### 8.2 Over-Configuration

Salesforce allows administrators to configure nearly everything: page layouts, compact layouts, record types, visibility rules, actions, related lists. This creates power but also a labyrinth. The QBO app should have opinionated defaults -- show the right thing at the right time based on context without requiring configuration.

### 8.3 Permission-Layered Complexity

Salesforce UI varies based on profiles, permission sets, roles, and sharing rules. The QBO app has one user. Do not introduce multi-user permission complexity.

### 8.4 Full-Page Navigation

Despite the Service Console tab model, many Salesforce operations still trigger full-page navigations. The QBO app SPA architecture with always-mounted Chat and smooth AnimatePresence transitions is better.

### 8.5 Salesforce Actual Color Palette

The Salesforce brand blue (#0176D3) is a standard corporate blue -- trustworthy but unremarkable. The QBO app warm ember accent (#c76a22) is more distinctive and better suited to a personal tool. Adopt the pattern of object-specific colors, not the specific colors.

### 8.6 The Cosmos Theme Aesthetic

SLDS 2 introduces the Cosmos theme with rounded elements for broad enterprise appeal. The QBO app thematic identity (Obsidian Ember, warm authority) is more personal. Adopt Salesforce structural patterns, not its visual skin.

---

## 9. Implementation Priority

Ranked by effort-to-impact ratio for the QBO Escalation Assistant:

| Priority | Pattern | Effort | Impact | Notes |
|----------|---------|--------|--------|-------|
| **P0** | Highlights panel for escalations | Low | High | CSS-only, restructure detail header |
| **P0** | Extended object/category colors | Low | High | Add left-border strips to cards, color to nav |
| **P1** | Lifecycle-aware visibility | Medium | High | Conditional rendering based on status field |
| **P1** | Case feed / activity timeline | Medium | High | New component, aggregates existing data |
| **P2** | Density toggle | Medium | Medium-High | CSS custom property multiplier + settings toggle |
| **P2** | Split view for dashboard | Medium | Medium | List+detail layout, new dashboard mode |
| **P2** | Global search (Ctrl+K) | Medium | Medium | New component, searches multiple collections |
| **P3** | Contextual AI pre-loading | Low-Medium | Medium | Route-aware context injection in chat orchestrator |
| **P3** | Utility bar quick actions | Medium | Low-Medium | New persistent bottom bar component |

### Implementation Notes

**P0 items** require no new data fetching or server changes. They are CSS and component restructuring work that immediately improves information architecture.

**P1 items** require conditional rendering logic and possibly a new timeline component, but the underlying data (status, conversations, images) already exists.

**P2 items** introduce new interaction paradigms (density switching, split view, global search) that require both UI and possibly API work.

**P3 items** are quality-of-life improvements that enhance existing workflows.

---

## 10. Summary of Key Takeaways

1. **Salesforce greatest strength is not its visual design -- it is its information architecture.** The consistent record page template, highlights panel, related lists, and lifecycle-aware visibility create a predictable, efficient workspace. The QBO app should adopt these structural patterns.

2. **Object-colored navigation is Salesforce most original contribution to enterprise UX.** Assigning unique colors to record types creates an instant visual vocabulary that works faster than text. The QBO app already does this with category badges -- extending it to navigation, cards, and tabs would amplify the effect.

3. **Density control respects the user.** A new user needs comfy mode. A veteran needs compact mode. Offering both acknowledges that the same interface serves different needs at different times.

4. **The Service Console is the closest existing precedent for the QBO app.** Its three-column layout, split view, utility bar, and case feed patterns solve exactly the problems the QBO app faces.

5. **The AI side panel is already implemented well in the QBO app.** The AgentDock pattern is very close to Salesforce Agentforce Assistant side panel. The main gap is contextual pre-loading.

6. **Do not copy Salesforce visual heaviness, configuration complexity, or corporate blue palette.** Adopt structural intelligence, not visual skin.

---

## Sources

- [Lightning Design System 2 (Official)](https://www.lightningdesignsystem.com/)
- [SLDS 2: Experience Design](https://www.salesforce.com/blog/experience-design-with-slds-2/)
- [SLDS 2: What is SLDS 2](https://www.salesforce.com/blog/what-is-slds-2/)
- [Picking Design Colors with SLDS](https://www.salesforce.com/blog/picking-design-colors-slds/)
- [SLDS Design Tokens (LWC Guide)](https://developer.salesforce.com/docs/platform/lwc/guide/create-components-css-design-tokens.html)
- [SLDS Styling Hooks (LWC Guide)](https://developer.salesforce.com/docs/platform/lwc/guide/create-components-css-custom-properties.html)
- [Lightning Density Settings](https://developer.salesforce.com/blogs/2018/08/new-density-settings-for-the-lightning-experience-ui-in-winter-19)
- [Service Console and Case Management](https://advancedcommunities.com/blog/service-console-and-case-management-with-salesforce-lightning/)
- [Service Cloud Console Features](https://www.salesforceben.com/salesforce-service-cloud-console/)
- [Designing Lightning Pages](https://www.salesforceben.com/ultimate-guide-to-designing-salesforce-lightning-pages/)
- [Salesforce UI Features](https://www.salesforceben.com/salesforce-ui-features-to-implement-in-every-org/)
- [Compact Layouts and Highlights Panel](https://trailhead.salesforce.com/content/learn/modules/lex_customization/lex_customization_compact_layouts)
- [Service Console Optimization](https://trailhead.salesforce.com/content/learn/projects/set-up-the-service-console/customize-your-lightning-service-console-pages)
- [Einstein/Agentforce Copilot](https://trailhead.salesforce.com/content/learn/modules/einstein-copilot-basics/explore-einstein-copilot)
- [SLDS Accessibility Overview](https://www.lightningdesignsystem.com/accessibility/overview/)
- [Web Accessibility on Salesforce](https://trailhead.salesforce.com/content/learn/modules/coding-for-web-accessibility/understand-accessible-navigation)
- [Salesforce Kinetics Motion System](https://trailhead.salesforce.com/content/learn/modules/motion-pattern-creation/align-motion-patterns-with-salesforce-kinetic-guidelines)
- [Data Tables Component](https://www.lightningdesignsystem.com/components/data-tables/)
- [SLDS Color System Update](https://help.salesforce.com/s/articleView?id=release-notes.rn_slds_colors.htm&language=en_US&release=232&type=5)
- [Display Density in LWC](https://developer.salesforce.com/docs/platform/lwc/guide/data-display-density.html)
- [SLDS Typography](https://www.lightningdesignsystem.com/2e1ef8501/v/0/p/93288f-typography)
- [Salesforce Transition Design](https://trailhead.salesforce.com/content/learn/modules/salesforce-kinetics-system/design-transitions-and-custom-motion)
- [Default Font Change](https://help.salesforce.com/s/articleView?id=release-notes.rn_slds_default_typeface.htm&language=en_US&release=232&type=5)
