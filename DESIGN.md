# QBO Escalations Design System

> Source-backed product UI guidance. Last verified against the production client source on 2026-07-23. Rendered browser verification is a required release gate whenever the browser test surface is available.

## Product and interface purpose

QBO Escalations is the first operational workflow in a broader expert-agent platform. The interface exists to help one person understand work, preserve evidence, make decisions, and coordinate reliable agent action. It should feel like a calm operational console: compact enough to show the work, clear enough to trust, and never visually busier than the decision at hand.

The interface is not a marketing site and should not behave like one. Large hero copy, decorative cards, gradients, glow, and excessive whitespace reduce the amount of evidence and action visible on screen. Use visual emphasis only to improve the next decision.

## Start here: five non-negotiable rules

1. **Put the work in the first viewport.** A page title and its primary action should be followed quickly by the working surface. Explanatory copy must not push the task below the fold.
2. **Use the existing Slate system.** Use the shared dark surfaces, blue accent, semantic status colors, compact spacing, and flat borders from `client/src/App.css`.
3. **Make hierarchy match value.** Size and position communicate importance. A summary metric is compact context, not a hero card. A warning may be prominent only when the user can act on it.
4. **Prefer one organized surface over card collections.** Group related controls with dividers inside one panel. Do not give every preference its own large container.
5. **Explain at the point of uncertainty.** Use one short sentence by default. Put rare details in a tooltip, disclosure, help link, or confirmation shown when it matters.

## Interaction quality is a release gate

Functional correctness is necessary but is not enough to call UI work complete. Every changed flow must be reviewed as a rendered user experience, not only as JSX, CSS, tests, or a successful build.

- Use progressive disclosure: ask for the next required decision first, then reveal the controls that decision makes relevant.
- Keep optional information collapsed or visually secondary until the user asks for it.
- Give every interactive control intentional hover, focus-visible, active, selected, disabled, and loading behavior where those states apply.
- Use purposeful 120–180ms motion to explain selection and disclosure changes, with a reduced-motion fallback.
- Use one explicit control height within a row. Labels, inputs, icons, and helper text must align; accidental height differences are a release defect.
- Preserve 8–10px between a field label and its control unless a documented dense pattern requires otherwise.
- Apply the space/value assessment before review. Large empty containers and decorative cards must be reduced or removed when they do not help the next action.
- Inspect desktop and mobile renderings, interaction states, and browser console output before declaring the UI complete. If the browser surface is unavailable, report the visual gate as incomplete; do not infer a pass from source or tests.

User screenshots and direct usability feedback are product evidence. Repeated criticism of density, hierarchy, interaction feedback, or alignment means the design standard or review process must be corrected, not treated as a one-off styling preference.

## Source of truth and implementation map

| Concern | Primary source | Notes |
| --- | --- | --- |
| Global color and semantic tokens | `client/src/App.css` | Canonical Slate palette and component variables |
| Shared control language | `client/src/design-system.css` | Flat surfaces, states, buttons, form treatment |
| Dense operational layouts | `client/src/console-density.css` | Compact panels, gaps, rows, and controls |
| Application-wide refinement layer | `client/src/overhaul.css` | Large legacy override layer; use cautiously |
| Settings composition | `client/src/components/Settings.jsx` | Section navigation and compact control group patterns |
| Settings-specific reconciliation | `client/src/settings-v2.css` | Must alias global tokens; must not invent a second theme |
| AI catalog workspace | `client/src/components/AiManagementSettings.jsx` | Provider/model management and new-model review |
| Connected accounts | `client/src/components/SettingsAccountsSection.jsx` | Account health, permissions, repair, and purpose-specific defaults |
| AI safety controls | `client/src/components/AiAssistantSettingsPanel.jsx` | Accordion-based advanced configuration |
| Feedback and problem reporting | `client/src/components/reporting/UserReportDialog.jsx` and `.css` | Progressive type selection, report form, optional contact and evidence controls |

Prototypes under `prototypes/` are deliberately excluded from the production design contract unless a later maintained change explicitly promotes them.

## Visual character

Use these words to judge a screen:

- Calm
- Operational
- Evidence-aware
- Compact
- Direct
- Trustworthy
- Dark, not black-on-black
- Blue-accented, not purple
- Flat, not glossy

Avoid:

- Marketing-page hero sections inside the app
- Decorative eyebrow copy that repeats the title
- Purple accent palettes or page-specific rebranding
- Large stat cards for small context numbers
- Gradients and glows without state meaning
- Floating controls with no current action
- A card per setting
- Long policy explanations above the main task

## Color system

The canonical values come from `client/src/App.css`. Components should reference variables rather than copy hex values.

### Surfaces

| Token | Current value | Use |
| --- | --- | --- |
| `--bg` | `#0a0a0f` | Main application canvas |
| `--bg-sunken` | `#060608` | Inputs and inset working areas |
| `--bg-sidebar` | `#12141c` | Navigation rails |
| `--bg-raised` | `#1a1e2a` | Primary panels and cards |
| `--bg-elevated` | `#242a38` | Hover, selected secondary surfaces |
| `--bg-floating` | `#2e3446` | Menus, popovers, floating action surfaces |

### Text

| Token | Current value | Use |
| --- | --- | --- |
| `--ink` | `#e4e4e8` | Primary text |
| `--ink-secondary` | `#8888a0` | Supporting descriptions |
| `--ink-tertiary` | `#555570` | Low-priority metadata and placeholders |

Do not use tertiary text for information required to complete a task. If text matters, it must retain readable contrast.

### Lines and focus

| Token | Current value | Use |
| --- | --- | --- |
| `--line-subtle` | `rgba(255,255,255,.05)` | Quiet internal divisions |
| `--line` | `rgba(255,255,255,.08)` | Default panel borders |
| `--line-strong` | `rgba(255,255,255,.14)` | Inputs and emphasized boundaries |
| `--accent` | `#6ea1f7` | Primary action, focus, current selection |
| `--accent-hover` | `#8bb7ff` | Primary hover |
| `--accent-subtle` | `rgba(110,161,247,.12)` | Selected background and quiet focus context |
| `--accent-border` | `rgba(110,161,247,.30)` | Selected borders |

### Semantic status

| Token | Current value | Meaning |
| --- | --- | --- |
| `--success` | `#5cd08e` | Confirmed healthy, connected, completed |
| `--warning` | `#f0a940` | Needs review or attention, not generic decoration |
| `--danger` | `#f06060` | Failed, blocked, destructive, or invalid |

Every semantic color needs a text label, icon, or shape. Color cannot carry meaning alone.

## Typography

The application uses the existing system sans-serif stack. Do not add a display font for Settings or operational screens.

Recommended scale:

| Role | Size | Weight | Guidance |
| --- | --- | --- | --- |
| Page title | `1.35rem` to `1.6rem` | 650–750 | One line where possible |
| Panel title | `1rem` to `1.2rem` | 650–700 | Working surface identity |
| Control title | `.69rem` to `.78rem` | 600–700 | Compact, scannable |
| Body/support | `.64rem` to `.78rem` | 400–500 | Short, direct sentences |
| Metadata | `.58rem` to `.64rem` | 400–650 | Dates, IDs, state details |
| Monospace | `.60rem` to `.68rem` | 400–600 | Model IDs, traces, technical values |

Use sentence case for page titles, control names, buttons, and status labels. Avoid all-caps eyebrow copy unless it carries information not present in the title.

## Spacing and density

The base rhythm is 4px. Common values are 4, 6, 8, 10, 12, 14, 16, 20, 24, and 32px.

Operational defaults:

- Page content inset: 18–38px desktop, 12px mobile
- Title-to-workspace distance: 14px
- Panel padding: 12–16px
- Group divider spacing: 10–14px
- Row padding: 7–10px
- Related control gap: 4–8px
- Section gap: 8–12px
- Sidebar width: about 220–236px desktop
- Form control height: 30–36px
- Small action height: 28–32px

Whitespace is a grouping tool, not a luxury signal. Add space to separate decisions; remove space that only makes a screen look sparse.

## Radius, borders, and elevation

- Primary panels: 8px radius
- Small controls and rows: 5–7px radius
- Pills and switches: fully rounded only when their shape explains behavior
- Default border: 1px `--line`
- Inputs: 1px `--line-strong`
- Shadows: avoid on in-flow panels; reserve a restrained shadow for floating menus, modals, and save bars
- Do not combine a large radius, gradient, and shadow on an ordinary settings panel

## The space/value assessment

Every main-viewport element must pass this assessment before release.

### 1. Name the user value

The element must do at least one of these:

- Enable the primary task
- Communicate current state required for a decision
- Prevent a meaningful mistake
- Show actionable failure or warning information
- Provide navigation the user is likely to need now

If it does none of these, remove it from the main viewport.

### 2. Match size to frequency and consequence

| Frequency/consequence | Placement |
| --- | --- |
| Frequent and consequential | First viewport, direct control |
| Infrequent but consequential | Visible summary; detail on demand |
| Frequent but reversible | Compact direct control |
| Infrequent and reversible | Secondary section or disclosure |
| Informational only | One line, tooltip, help link, or documentation |

### 3. Check the first-screen budget

On a typical 1440×768 viewport, aim for:

- Page header: at most 72px including supporting copy
- Summary/command context: at most 64px
- The working surface begins within roughly 150px of content top
- At least half the visible content area belongs to the actual task

These are design checks, not rigid CSS constants. A real critical warning may need more room; ordinary explanation does not.

### 4. Remove duplication

Do not repeat the same concept in:

- Sidebar label
- Eyebrow
- Page title
- Subtitle
- Card title

Choose the smallest combination that orients the user. Settings does not need a separate Overview page when its sidebar already is the overview.

### 5. Test overflow

Before approval, inspect desktop and mobile. Ask:

- Is the first actionable control visible without scrolling?
- Does supporting copy wrap into a wall of text?
- Are important labels truncated?
- Does disabled content dominate the screen?
- Does the mobile horizontal navigation preserve the current section?

## Application shell

The global application shell owns primary navigation. Feature pages should not introduce a second visual brand.

Settings uses a local two-column shell:

1. Compact section navigation on the left
2. One working section on the right

On narrow screens, the settings navigation becomes a horizontally scrollable row above the content. Section descriptions disappear, but labels and selection remain visible.

## Settings page pattern

### Header

Use:

- A direct page title
- One short sentence only when needed
- One primary action aligned right

Do not use:

- Decorative source-of-truth eyebrow copy
- Multi-paragraph policy explanations
- A title larger than the actual task surface

### Summary command bar

Use a compact horizontal bar when 2–4 values provide immediate context. Values are separated by lines inside one surface. A closely related global policy may occupy the end of the same bar.

Do not create individual cards for each number unless each card supports a separate action or drill-down.

### Control list

Related preferences live in one panel. Each decision group uses an internal divider, short title, optional one-line description, and its control. Disabled groups remain understandable but visually recede.

### Disclosure for advanced settings

AI Safety uses accordions because most values are infrequent and advanced. Accordion summaries should tell the user what the group changes, not restate its title.

### Save feedback

Show save UI only when there are unsaved changes or a just-completed save. An idle floating dot or empty save bar has no value and must not render.

## AI Management pattern

AI Management is a catalog workspace, not an explanatory landing page.

Priority order:

1. See whether a saved alert needs review
2. Check for new models or test all connections
3. Set the automatic-check cadence and see truthful last/next times
4. Select a provider and manage its connection, key, and models
5. See affected agents before disabling a provider/model
6. Download the release packet or read the procedure when a candidate exists

Discovery text must distinguish:

- **Reviewed catalog:** models already supported by this application
- **New candidate:** a provider ID proven newer than the newest matching catalog generation
- **Ambiguous/old:** hidden from user-facing discovery results
- **Account visibility:** proof that an account can list an ID, not proof the app can call it correctly

The primary button is “Check for new models,” not “Check provider lists,” because the former describes the user’s goal. Operator-managed gateways and local runtimes use a separate “Refresh inventory” action because arbitrary local IDs cannot be truthfully ranked by vendor generation.

Automatic checks, timestamps, notification preferences, and the review queue belong in one compact strip above the catalog workspace. They must not become another page or a tall introductory card. The Settings gear may carry a small warning badge so a background finding is visible elsewhere in the app; the detailed evidence stays in AI Management.

Impact information is shown at the moment of risk. A model row may state which agents use it, and the disable confirmation names saved primary/fallback assignments. Do not rely on a generic warning when exact affected profiles are available.

## Connected Accounts pattern

Connected Accounts answers four questions in this order: does access work, what permission is missing, which account handles each purpose, and how can access be repaired? Show each account in one compact health row with last successful Gmail/Calendar access. Translate OAuth scopes into plain-English permissions; do not claim access from a hard-coded list. Reauthorization is the repair action and must not require disconnecting first.

Inbox, sending, and calendar defaults are independent. Keep their selects together in one grid and let the same defaults guide visible UI actions and background agent calls.

## Buttons and controls

### Buttons

- Primary: blue background for the single preferred action
- Secondary: raised dark surface and border
- Ghost: low-emphasis reversible actions
- Danger: red text/background only for destructive or blocking behavior
- Labels begin with verbs: “Check for new models,” “Connect Google,” “Save,” “Remove”
- Loading labels describe current action: “Checking…”, “Saving…”

Avoid two primary buttons in the same local decision group.

### Switches

Use a switch for an immediate on/off state. Pair it with a precise label. If the consequence is unusual or risky, confirm when switching on or off rather than showing a permanent paragraph.

### Checkboxes

Use for independent options. Keep the title and one-line consequence adjacent to the box.

### Segmented controls

Use for 2–4 mutually exclusive compact choices. Use radio semantics (`role="radiogroup"`, `role="radio"`, and `aria-checked`).

A segmented control that determines the rest of a form should be the only form content shown initially. Reveal the matching form after selection, focus its first field, and keep the selector available so the user can change course. Hover and active treatments must make each segment feel clickable before selection.

### Sliders

Always show the current value. Provide a reset when the value differs from the default. Do not add a large preview if the interface itself already reflects the change.

### Inputs and selects

- Visible label required
- Helpful placeholder may illustrate format but cannot replace the label
- Focus uses the blue accent
- Errors state what happened and what the user can do next
- Secret inputs never reveal saved server values; reveal only the value currently typed
- Inputs sharing a row use the same explicit height and vertical alignment
- Optional identity or follow-up fields belong in a compact disclosure, not a full-size card that competes with required fields

## State and feedback

### Loading

Keep the page frame stable. Replace only the data-dependent surface when possible. Use short, specific text such as “Loading the AI catalog…”

### Empty

An empty state should explain why it is empty and provide the next action when one exists. “No newer models found” is a successful result, not an error.

### Warning

Warnings must be actionable. A catalog review due date, missing provider model, or failed check can use amber. Do not use amber simply to make a statistic stand out.

### Error

Preserve the last known successful evidence when a refresh fails. State that the attempt failed and what was preserved. Provide retry only when retry is safe.

### Success

Use a toast or inline status for completed actions. Do not keep a success banner indefinitely when it no longer affects the decision.

## Accessibility

- Every interactive element must be keyboard reachable
- Focus-visible treatment must remain clearly visible on dark surfaces
- Use real buttons, inputs, labels, headings, lists, and navigation landmarks
- Icon-only actions require an accessible name
- Status changes use an appropriate live region without repeating ordinary page content
- Do not communicate status with color alone
- Maintain touch targets near 40px where the layout permits; compact desktop controls may be smaller when labels remain clear and rows provide sufficient target area
- Respect `prefers-reduced-motion`
- Mobile horizontal navigation must be scrollable and retain a visible selected state

## Content voice

Use practical language first.

Good:

- “No newer models found.”
- “Block custom model IDs.”
- “Providers, keys, and models available to every agent.”
- “Latest check failed. Previous successful evidence is preserved.”

Avoid:

- “System source of truth” as decorative copy
- “Usable IDs returned” when the user asked for new models
- “Policy gate” without explaining the behavior
- Repeating implementation limitations before the user reaches the task

Define unfamiliar technical terms immediately in everyday language. Prefer one sentence beside the control and deeper detail in maintained documentation.

## Responsive behavior

### Desktop

- Settings sidebar remains sticky
- Main working surface uses available width up to approximately 1160px
- AI provider list remains a compact vertical rail
- Primary action aligns with page title

### Tablet

- Command bar may stack policy below summary
- Provider rail narrows
- Multi-column release steps reduce to two columns

### Mobile

- Settings sections become horizontal navigation
- Primary page action becomes full width when needed
- Provider list becomes horizontal
- Candidate review controls stack
- Range grids become one column
- No content depends on hover

## Motion

Use 120–180ms transitions for hover, focus, switching, and small disclosure changes. A short opacity-and-position reveal is appropriate when a user choice causes the next stage of a form to appear. Motion should clarify state change. Avoid entrance animations for ordinary static settings and repeated floating/pulsing treatments. Disable nonessential motion when reduced motion is requested.

## Quality checklist

Before merging a UI change:

1. Identify the user goal and primary action.
2. Apply the space/value assessment to every first-viewport element.
3. Use the canonical tokens; search for new hard-coded colors.
4. Confirm title, copy, and action hierarchy.
5. Confirm progressive disclosure: only controls needed for the current decision are prominent.
6. Check hover, focus-visible, active, selected, disabled, loading, empty, warning, error, dirty, and saved states as applicable.
7. Verify equal control heights, label gaps, alignment, keyboard focus, and accessible names.
8. Build the client and run focused interaction tests.
9. Inspect the live desktop route at a typical laptop viewport.
10. Inspect a mobile viewport.
11. Check browser console errors.
12. If visual inspection was blocked, mark the visual gate incomplete instead of declaring a visual pass.
13. Re-read changed files before reporting current state.

## Known design debt

- The client has several large CSS layers, including `settings.css` and `overhaul.css`, with high-specificity and `!important` rules. New feature CSS sometimes has to reconcile those layers. Long term, reduce override depth and move stable shared components into one maintained layer.
- Some older screens use Apple-style grey surfaces, larger radii, gradients, or custom accent colors. They are not precedent for new work when they conflict with the canonical Slate variables.
- The generated Settings reconciliation intentionally targets legacy account and AI Safety classes so the route feels coherent today. Component-level consolidation can later remove those compatibility overrides.

## Prompt guide for future Codex UI work

Use this context when requesting implementation:

> Build this as a compact operational interface using the repository's existing Slate design tokens from `client/src/App.css`. Put the user's actual task in the first viewport and use progressive disclosure so each step shows only what is relevant now. Apply the space/value assessment from `DESIGN.md` to every visible element. Prefer one organized surface with dividers over a collection of cards. Give controls deliberate hover, focus-visible, active, selected, disabled, and loading states; keep aligned inputs equal in height; and use 120–180ms purposeful motion with reduced-motion support. Verify desktop and mobile in the live app. If browser verification is unavailable, say the visual gate is incomplete rather than inferring a pass from tests or build output.

For Settings work, add:

> Keep the page header under roughly 72px and start the working surface within roughly 150px of the content top unless a real critical warning requires more room. Do not add decorative eyebrow copy, hero text, large summary cards, gradients, or purple accents.
