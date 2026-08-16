# QBO Escalations Component Library

**Status:** Canonical, evolving component contract

**Current components:** 01 `TitleBlock`, 02 `StatusIndicator`, 03 `MetadataLine`

**Production source:** `client/src/components/design-system/`
**Visual language:** Slate, defined by `DESIGN.md` and tokens in `client/src/App.css`

This document is the formal source of truth for reusable interface components in QBO Escalations. It is deliberately stricter than a gallery of attractive examples. Each entry defines the component's job, its limits, its visual reasoning, its public API, its accessibility behavior, and the conditions under which it may be extended.

The library will grow one reviewed component at a time. A page-specific pattern does not become a shared component merely because two screens look similar. Shared components exist only when their meaning and behavior remain stable across domains such as QBO work, Investments, Knowledge, agents, providers, and personal workspace tools.

---

## 1. Authority and reading order

Use these sources in this order:

1. `DESIGN.md` defines the product-wide design principles, Slate tokens, density, interaction quality, and release bar.
2. This file defines the reusable component contracts and approved composition boundaries.
3. `DESIGN.HTML` provides a plain-English visual tour of the canonical defaults.
4. `client/src/components/design-system/` is the production implementation.
5. Feature CSS may compose these components but may not silently redefine their anatomy or semantics.

When source and documentation disagree, treat the disagreement as design-system debt. Do not pick whichever version is easier. Pause the feature integration, reconcile the component contract, then update documentation and implementation together.

## 2. What qualifies as a reusable component

A component belongs here only when all of the following are true:

- It solves one recognizable interface job.
- Its name describes that job without referring to one page or provider.
- Its required content is useful in every supported context.
- Its optional content can be removed without leaving empty space.
- Its variants express real, recurring differences—not styling preferences for one screen.
- It has a semantic HTML and accessibility contract.
- It remains understandable in isolation and in a composed page.
- It uses shared Slate tokens instead of copying feature-specific values.
- Its default is the safest, quietest, most commonly correct form.
- It is difficult to misuse accidentally.

The following do **not** automatically qualify:

- A styled fragment extracted from one page.
- A wrapper whose only purpose is to move CSS into another file.
- A component with dozens of unrelated slots.
- A card that owns identity, status, actions, navigation, diagnostics, and data fetching.
- A page section renamed to sound generic.
- A component whose meaning changes depending on where it is placed.

## 3. Component design principles

### 3.1 Default to the smallest truthful object

The default component should express its entire purpose with the least visual machinery that preserves clarity. Optional surfaces, borders, shadows, descriptions, and controls must not appear because they make a prototype look more complete.

### 3.2 Composition beats catch-all APIs

When a use case adds a second job, compose a parent or define a separate component. Do not keep expanding the original primitive. This is why `StatusIndicator` does not accept a description or action: adding either changes it from a state marker into a status summary or status action.

### 3.3 Semantic props beat arbitrary styling props

Public props express intent:

- `state="connected"`, not `color="green"`
- `surface="raised"`, not `background="#1a1e2a"`
- `size="compact"`, not `fontSize={12}`
- `padding="regular"`, not `padding="12px 14px"`

This lets the design system evolve without forcing every feature to be rewritten. A semantic state also prevents two teams from assigning different colors to the same meaning.

### 3.4 Optional means structurally absent

When an optional part is omitted, the component must remove both its markup and its layout space. Empty icon wells, blank subtitle rows, reserved action columns, and invisible trailing markers are defects.

### 3.5 Green is a claim

Success color is not decoration. A green `Connected` status claims that the surrounding feature has current evidence for the connection state it names. Unknown, missing, stale, or unverified data must never fall back to success.

### 3.6 Static components remain static

Neither component in this foundation performs network requests, stores data, polls, retries, navigates, or invents click behavior. The parent owns state and actions. This keeps visual components predictable and prevents a harmless-looking primitive from becoming an authority boundary.

### 3.7 The Apple bar is a complete-experience bar

The question is not whether a component resembles an Apple screenshot. The question is whether it would feel completely at home in a premium shipped product: clear purpose, disciplined hierarchy, truthful state, familiar behavior, excellent spacing, accessible semantics, and no unfinished development machinery.

The app retains its Slate identity. It does not copy Apple branding, materials, or promotional presentation.

---

# Component 01 — `TitleBlock`

## 4. Purpose

`TitleBlock` gives a page, section, or compact panel a clear identity. It answers:

> What is this area, and what short context—if any—helps me understand it?

Its required title creates the first visual stop. An optional icon improves recognition. An optional subtitle resolves likely uncertainty. Nothing else belongs inside the primitive.

The component is not a complete page header. A page header may compose `TitleBlock` with sibling actions, status, navigation, or metadata, but those elements remain outside the component.

## 5. Why this shape

The component uses a horizontal icon-and-copy arrangement because it creates a strong, reusable silhouette without binding the title to one feature. The text group remains tight so title and subtitle read as one idea. Space between the optional icon and copy is larger because they are separate visual groups.

The default has no background, border, padding, or shadow. Most titles already live inside a page or panel that owns its surface. Automatically wrapping every title in a card would create nested containers, waste vertical space, and make hierarchy depend on decoration rather than typography.

The optional visual treatments still exist because some legitimate placements need them:

- A standalone compact identity block may need a raised surface.
- A bounded module may need a subtle border.
- A genuinely floating composition may need elevation.
- A full-width title block may need consistent padding when used as a contained header.

These options are controlled Slate presets, not an invitation to make every title look different.

## 6. Anatomy

```text
TitleBlock
├─ icon?       optional decorative identity
└─ copy
   ├─ heading  required semantic h1, h2, or h3
   └─ subtitle? optional supporting context
```

The icon is never the only source of identity. The title must remain meaningful if the icon fails to load or is not perceived.

## 7. Public API

```jsx
<TitleBlock
  as="h1"
  size="page"
  title="Workspace"
  subtitle="Current context"
  icon={<WorkspaceMark />}
  width="auto"
  surface="none"
  border="none"
  elevation="none"
  padding="none"
/>
```

### 7.1 Content and semantics

| Prop | Type / values | Default | Contract |
| --- | --- | --- | --- |
| `title` | React phrasing content | required | Full identity; meaningful without the icon. |
| `as` | `h1`, `h2`, `h3` | `h2` | The caller chooses the correct document heading level. |
| `headingId` | string | none | ID applied to the heading for `aria-labelledby` relationships. |
| `icon` | React element | none | Decorative; the wrapper is hidden from assistive technology. |
| `subtitle` | React phrasing content | none | One useful sentence; normally one line, at most two on narrow screens. |
| `id` | string | none | ID applied to the component root. |
| `className` | string | empty | Limited composition hook; must not redefine anatomy. |
| `style` | object | none | Escape hatch for layout placement, not component restyling. |
| `aria-*`, `data-*`, `role` | safe DOM attributes | none | Passed to the root. Event handlers are intentionally not passed through. |

`TitleBlock` does not accept `onClick`. If the surrounding identity opens another view, use a purpose-built interactive parent with a complete hover, focus, pressed, and keyboard contract.

### 7.2 Size

| Value | Heading | Subtitle | Icon frame | Typical use |
| --- | --- | --- | --- | --- |
| `page` | 22px / 1.15 | 13px / 1.4 | 36px | One page identity. |
| `section` | 18px / 1.2 | 13px / 1.4 | 28px | Major section within a page. |
| `compact` | 14px / 1.25 | 12px / 1.35 | 20px | Panel, popover, or dense module identity. |

Visual size and semantic level are independent. A visually compact title can still be an `h2`; a page title is not automatically an `h1` unless the page hierarchy calls for it.

### 7.3 Width

| Value | Behavior |
| --- | --- |
| `auto` | Shrinks to its content while never exceeding the parent. Default. |
| `full` | Fills the available parent width. |

Arbitrary width is not a public prop. The parent controls grid or flex placement. A `style` escape hatch may be used for a necessary maximum width, but a new recurring width rule should become a governed preset.

### 7.4 Surface

| Value | Meaning |
| --- | --- |
| `none` | No owned surface. Canonical default. |
| `raised` | Standard in-flow Slate raised surface. |
| `elevated` | Stronger in-flow separation for a real nested level. |
| `floating` | Floating layer only, such as an established popover or modal composition. |

Surface does not imply border or shadow. Those decisions remain explicit because they communicate different relationships.

### 7.5 Border

| Value | Meaning |
| --- | --- |
| `none` | No component-owned boundary. Default. |
| `subtle` | Quiet separation using `--line`. |
| `strong` | Deliberate boundary using `--line-strong`; use rarely. |

### 7.6 Elevation

| Value | Meaning |
| --- | --- |
| `none` | Flat. Default for in-flow content. |
| `low` | Minimal functional separation on an owned surface. |
| `floating` | Only when the component is inside a truly floating layer. |

Elevation is ignored when `surface="none"`. A shadow without a surface creates a diffuse halo around text and fails the Slate craft bar.

### 7.7 Padding

| Value | Meaning |
| --- | --- |
| `none` | Bare title content. Default. |
| `compact` | 8px internal space. |
| `regular` | 12px internal space. |

A surface or border cannot use `padding="none"`; the implementation normalizes that invalid combination to `regular` and warns in development. This guardrail prevents text and icons from touching a visible boundary.

## 8. Canonical forms

### 8.1 Bare page identity

```jsx
<TitleBlock
  as="h1"
  size="page"
  title="Investments"
  subtitle="Margin account"
  icon={<ProviderMark />}
/>
```

The surrounding page—not `TitleBlock`—positions synchronization actions and market-data state.

### 8.2 Section identity without icon

```jsx
<TitleBlock
  as="h2"
  size="section"
  title="Positions"
  subtitle="7 positions"
/>
```

Do not render an empty icon frame simply to align this title with another component.

### 8.3 Contained compact identity

```jsx
<TitleBlock
  as="h3"
  size="compact"
  title="Saved evidence"
  surface="raised"
  border="subtle"
  padding="compact"
  width="full"
/>
```

Use only when the title block itself owns the contained region. If a parent panel already has a border and background, return to the bare form.

## 9. Content guidance

### Title

- Use sentence case.
- Name the object or area directly.
- Prefer one to four words.
- Do not add decorative eyebrow copy that repeats the title.
- Do not include status, timestamps, counts, or actions in the title string.

### Subtitle

- Add it only when it changes understanding.
- Keep it specific to the current context.
- Avoid slogans and promotional copy.
- Avoid repeating the title in a longer sentence.
- Do not place implementation stages or developer fixtures in production subtitles.

Good:

- `Investments` / `Margin account`
- `Connected Accounts` / `Manage access to Google and Questrade`
- `Saved evidence` / `Latest complete portfolio copy`

Avoid:

- `Investments Workspace` / `Welcome to your powerful personal investment workspace`
- `Status` / `Status information`
- `Questrade Stage 3B` / `Development-only component verification`

## 10. Accessibility

- Choose the heading element from the actual document outline.
- Use only one page `h1` unless the document genuinely contains multiple independently named regions.
- Decorative icons are hidden from assistive technology.
- The title must carry the complete identity in text.
- Do not truncate essential headings with ellipsis.
- On narrow screens, allow title and subtitle to wrap naturally.
- Use `headingId` when a region, dialog, or panel needs `aria-labelledby`.
- `TitleBlock` is not focusable and does not invent a tab stop.

## 11. Responsive behavior

- The icon remains fixed in size.
- The copy column uses `min-width: 0` so text can wrap instead of overflowing.
- At 390px, essential text wraps; it is not removed to preserve a desktop silhouette.
- Parent actions stack or move independently. They do not compress the title block into an unreadable strip.
- Optional content disappears only because the caller omitted it—not because a breakpoint silently hides meaning.

## 12. Do / do not

### Do

- Start a page with a bare page-size TitleBlock.
- Choose heading semantics deliberately.
- Use icons when they strengthen recognition.
- Use one restrained subtitle when context matters.
- Let the parent own actions and status.

### Do not

- Put buttons, menus, tabs, breadcrumbs, or status inside TitleBlock.
- add a card surface by default.
- add shadow to an in-flow page title.
- use arbitrary colors, padding, radii, or fixed widths.
- use the component as a clickable row.
- create an empty icon well for alignment.

## 13. Acceptance checklist

- [ ] The title is meaningful without its icon.
- [ ] The heading level is correct in the full page hierarchy.
- [ ] Optional content removes its space when absent.
- [ ] Bare is used unless the component genuinely owns a surface.
- [ ] No actions, status, or navigation were pushed inside.
- [ ] No horizontal overflow occurs at 390px.
- [ ] Essential title text remains readable without truncation.
- [ ] The result uses Slate tokens and no page-specific color system.

---

# Component 02 — `StatusIndicator`

## 14. Purpose

`StatusIndicator` answers one question:

> What state is this in?

It communicates that state through one semantic icon and one short text label. The default is an inline primitive with no background, border, shadow, padding, trailing dot, description, timestamp, action, or chevron.

That boundary is intentional. Status is information, not automatically an alert, badge, button, dashboard card, or diagnostics panel.

## 15. Reconciliation of the two reference directions

The first reference established the correct primitive: compact icon plus label, quiet enough to sit beside a provider, job, service, or evidence object.

The second reference contributed two useful ideas:

- Normalize different semantic symbols in a consistent icon well.
- Let label and supporting explanation form a clear hierarchy.

Those ideas do not belong in the same base primitive. Once a description and icon well are added, the object becomes a richer `StatusSummary`. Treating that as a large StatusIndicator variant would make ordinary states too heavy and invite every feature to add more fields.

The trailing colored dot from the reference is rejected. It repeats the icon's semantic color, reserves right-side space, and creates an unnecessary visual endpoint without adding meaning.

## 16. Anatomy

```text
StatusIndicator
├─ semantic symbol  required, decorative because text repeats meaning
└─ label            required, short and explicit
```

The icon and label always appear together. Color reinforces the state but never carries it alone.

## 17. Public API

```jsx
<StatusIndicator
  state="connected"
  label="Connected"
  size="regular"
  appearance="inline"
  announce="off"
/>
```

| Prop | Type / values | Default | Contract |
| --- | --- | --- | --- |
| `state` | governed state name | `neutral` | Invalid or absent state falls back to neutral, never success. |
| `label` | short text | canonical label | Required for `custom`; may scope a known state. |
| `size` | `regular`, `compact` | `regular` | Controlled type and icon scale. |
| `appearance` | `inline`, `contained` | `inline` | Inline is canonical; contained is a quiet bounded treatment. |
| `announce` | `off`, `polite`, `assertive` | `off` | Explicit dynamic-announcement behavior. |
| `icon` | React element | canonical icon | Controlled escape hatch when a domain symbol is more accurate. |
| `tone` | governed tone | derived | Used only with `state="custom"`. |
| `id`, `className`, `style` | standard composition hooks | none | Must not change the primitive's anatomy. |
| `aria-*`, `data-*` | safe DOM attributes | none | Passed to the root. Event handlers are intentionally not passed through. |

`StatusIndicator` does not accept behavior through `onClick`. Wrap it only in an independently designed control when the entire parent object is genuinely interactive.

## 18. Canonical state vocabulary

| State | Icon | Tone | Default label | Meaning |
| --- | --- | --- | --- | --- |
| `neutral` | circle-minus | neutral | `Status unknown` | No supported factual claim can be made. |
| `connected` | circle-check | success | `Connected` | Current evidence confirms the named connection. |
| `delayed` | clock | warning | `Delayed` | The information is available but may not be current. |
| `attention` | warning triangle | warning | `Needs attention` | The state is usable or preserved, but user awareness or repair matters. |
| `unavailable` | circle-minus | neutral | `Unavailable` | The capability cannot currently be used. |
| `failed` | circle-x | danger | `Failed` | The named operation or service failed. |
| `syncing` | sync arrows | info | `Syncing` | A bounded update is actively in progress. |
| `custom` | caller supplied or neutral | governed tone | caller required | A real recurring state not expressed by the standard vocabulary. |

Use custom labels to scope the state without inventing a new presentation:

```jsx
<StatusIndicator state="connected" label="Mail connected" />
<StatusIndicator state="syncing" label="Reconnecting" announce="polite" />
<StatusIndicator state="attention" label="Calendar needs attention" />
```

Do not add new state names for synonyms. `Reconnecting` is the syncing presentation with more precise wording, not a different color or animation.

## 19. Tone behavior

The icon carries the main semantic color. The label remains primary neutral ink so status remains readable without creating a row of brightly colored text.

| Tone | Token | Use |
| --- | --- | --- |
| `neutral` | `--ink-secondary` | Unknown, unavailable, inactive factual states. |
| `info` | `--info` / `--accent` | Active non-error process such as syncing. |
| `success` | `--success` | Verified ongoing success such as connected. |
| `warning` | `--warning` | Delayed, partial, or attention-needed states. |
| `danger` | `--danger` | Confirmed failure. |

Product code must not choose tone for governed states. The mapping lives inside the component. Only `custom` permits a governed tone override.

## 20. Size

| Size | Icon | Label | Gap | Use |
| --- | --- | --- | --- | --- |
| `regular` | 16px | 14px / 20px, weight 600 | 6px | Headers, provider rows, summary surfaces. |
| `compact` | 14px | 12px / 16px, weight 600 | 5px | Dense tables, metadata, compact navigation. |

Do not shrink the label below the compact size to fit an overcrowded parent. Fix the parent composition.

## 21. Appearance

### Inline — canonical default

- No background
- No border
- No shadow
- No padding
- No minimum width
- Occupies only the space its icon and label require

Use inline in headers, provider rows, table cells, metadata, and command bars.

### Contained — restrained option

- Quiet raised Slate surface
- 1px subtle border
- 6px radius
- Regular: minimum height 30px, 5px × 8px padding
- Compact: minimum height 24px, 3px × 6px padding
- No shadow

Contained does not mean clickable. It is appropriate when the status would otherwise lose separation against a complex background.

## 22. Interaction and motion

The primitive is non-interactive. It has no hover, pressed, selected, focus, chevron, retry, or menu state.

Only `syncing` may animate. The sync symbol rotates slowly without changing size or position. Under `prefers-reduced-motion: reduce`, it becomes static; the label still communicates the process.

Avoid:

- Pulsing dots
- Swelling capsules
- Blinking text
- Continuous glow
- Bounce
- Animated color cycling
- Layout movement during state changes

## 23. Announcements

Static status does not automatically receive `role="status"`. A page containing many indicators would otherwise announce ordinary mount behavior and background polling results.

Use:

- `announce="off"` for static or initially rendered state.
- `announce="polite"` for a meaningful change the user should hear when convenient, such as `Syncing` → `Connected`.
- `announce="assertive"` only for an urgent failure whose immediate announcement is necessary.

The parent is responsible for preventing repeated announcements on identical polling results.

## 24. State journey

A durable connection journey may be:

```text
Unavailable → Syncing → Connected
Connected → Delayed
Connected → Failed → Syncing → Connected
```

Across transitions:

- Keep the indicator in the same DOM position.
- Preserve the last truthful parent evidence.
- Do not flash success while verification is pending.
- Do not move keyboard focus.
- Do not insert repair actions into the indicator.
- Announce only meaningful transitions when explicitly configured.

## 25. Content guidance

Labels should normally remain under four words and name the affected state directly.

Good:

- `Connected`
- `Delayed`
- `Needs attention`
- `Mail connected`
- `Calendar unavailable`
- `Syncing portfolio`
- `Not configured`

Avoid:

- `All systems available` when only one service was verified.
- `Some delays detected` when the affected data can be named.
- `Provider request state: success` in a production UI.
- `Good` or `Bad`, which are vague and judgmental.
- Raw error strings such as `Failed to fetch`.

## 26. Accessibility

- The label always states the meaning in text.
- Each standard state uses a distinct symbol, not only a color change.
- Icons are decorative because the label repeats the meaning.
- The component is not focusable.
- Essential meaning does not live only in a tooltip.
- Forced-color mode restores a visible system color for the symbol and contained boundary.
- Dynamic live-region behavior is explicit, not automatic.
- A custom icon must remain understandable with the written label and must not contain focusable descendants.

## 27. Responsive behavior

- The icon does not shrink.
- The label may wrap when essential.
- The component never reserves a trailing column.
- The parent must not force the indicator into a width that makes the label unreadable.
- At 390px, the primitive remains one visual unit without horizontal overflow.

## 28. What does not belong inside

The following change the component's job and are rejected from its API:

- Description
- Timestamp
- Progress percentage
- Provider name
- Account identifier
- Retry or repair action
- Chevron or menu
- Diagnostics link
- Tooltip containing essential explanation
- Data fetching or polling
- Persistence
- A second trailing status dot
- A large icon well
- A card shadow

## 29. `StatusIndicator` versus future `StatusSummary`

Use `StatusIndicator` when icon + label fully communicates the state.

Use a separately implemented `StatusSummary` when the state needs a scoped explanatory sentence and a normalized icon well. It is a composition, not a size variant.

```text
StatusSummary (future, not part of this implementation)
├─ fixed semantic icon well
└─ text group
   ├─ status label
   └─ scoped description
```

The future summary may support a bare or subtle surface, but it will still reject timestamps, actions, diagnostics, progress bars, and provider identity. Those belong to a parent status panel.

Example:

```text
[clock] Delayed
        Market prices may be delayed.
```

Do not fake StatusSummary by adding a description beside StatusIndicator in an ungoverned wrapper. Component 03 or a later approved addition can formalize that composition if the application demonstrates a recurring need.

## 30. Acceptance checklist

- [ ] The component answers only “What state is this in?”
- [ ] It contains one icon and one short label.
- [ ] The state is explicit and evidence-backed.
- [ ] Unknown or invalid input falls back to neutral.
- [ ] Icon and label communicate meaning without color alone.
- [ ] The label remains neutral primary ink.
- [ ] There is no trailing dot, description, timestamp, action, or chevron.
- [ ] Inline is used unless contained separation is genuinely needed.
- [ ] Static states do not announce themselves automatically.
- [ ] Sync motion becomes static under reduced motion.
- [ ] The parent—not the primitive—owns recovery and diagnostics.

---

# Component 03 — `MetadataLine`

**Approved baseline:** `docs/design-system/assets/metadata-line/MetadataLine-prototype-v2.png`

**User approval:** August 16, 2026. The baseline records the governed anatomy and responsive intent; its large dark canvas is documentation framing, not component anatomy.

## 31. Purpose

`MetadataLine` answers one question:

> What supporting facts help me understand the nearby object?

It presents one to four quiet facts such as observation times, verification times, record counts, currencies, storage location, or access context. It is a static primitive: compact enough to remain secondary, readable enough to be trusted, and structurally independent of the page that first uses it.

It is not a status, badge, title, key/value details grid, action row, or card. A parent may compose those objects beside it, but they do not become part of `MetadataLine`.

## 32. Why this shape

Supporting facts should be discoverable without competing with identity, state, primary values, or the next action. The canonical form therefore uses only typography and quiet punctuation. It owns no surface, border, shadow, radius, padding, semantic color, or interaction.

At normal widths, complete facts read as one natural phrase separated by centered dots. Labels use readable secondary ink; values use primary ink and a slightly stronger weight. This preserves hierarchy without relying on low-contrast tertiary text at 12–13px.

At a 390px viewport, the component becomes a compact label/value stack and removes separators. This is a deliberate reflow, not ordinary text wrapping: a separator must never be stranded at the beginning or end of a line. The parent supplies the labels and values; the component never rewrites `Stored on this computer` into `Storage / This computer` on its own.

## 33. Anatomy

```text
MetadataLine
├─ group icon?          optional decorative context for the entire line
└─ facts                1–4 governed facts
   ├─ separator?        automatic between facts at normal widths
   ├─ label?            optional qualifying text
   └─ value             required visible fact
      └─ time semantics? optional machine-readable datetime
```

When the icon is omitted, its markup and gap disappear. When a fact has no label, its value occupies the complete fact unit. Separators are visual punctuation and remain hidden from assistive technology.

## 34. Public API

```jsx
<MetadataLine
  as="span"
  size="regular"
  items={[
    {
      id: 'observed',
      label: 'Observed',
      value: '3 min ago',
      dateTime: '2026-08-16T10:54:00-03:00',
    },
    {
      id: 'fetched',
      label: 'Fetched',
      value: '2 min ago',
      dateTime: '2026-08-16T10:55:00-03:00',
    },
  ]}
/>
```

| Prop | Type / values | Default | Contract |
| --- | --- | --- | --- |
| `items` | array of fact objects | required | One to four governed facts. Invalid facts without visible values are omitted. |
| `as` | `span`, `div` | `span` | Root semantic element selected for the surrounding composition. |
| `size` | `regular`, `compact` | `regular` | Controlled typography, icon, and spacing density. |
| `icon` | React element | none | Optional decorative group icon; appropriate only when it clarifies the entire line. |
| `id` | string | none | ID applied to the component root. |
| `className` | string | empty | Placement hook; must not redefine anatomy or semantic contrast. |
| `style` | object | none | Exceptional placement hook, not an alternate styling API. |
| `aria-*`, `data-*`, `role` | safe DOM attributes | none | Passed to the root. Event handlers are intentionally not passed through. |

`MetadataLine` does not accept `onClick`, status tone, custom separators, surface, border, elevation, padding, timestamp formatting, or automatic announcements.

### 34.1 Fact object

| Field | Type | Required | Contract |
| --- | --- | --- | --- |
| `value` | string or number | yes | Complete visible fact. `0` remains valid. Empty values do not render. |
| `label` | string | no | Short qualifier such as `Observed`, `Storage`, or `Access`. |
| `dateTime` | ISO-compatible string | no | When present, the value renders as a semantic `<time>` element. |
| `id` | string or number | no | Stable React identity for dynamic parent collections. |

The parent owns wording, order, relative-time calculation, timezone, locale, and refresh cadence. The primitive renders the supplied facts; it does not reinterpret them.

### 34.2 Governed item limit

One to four facts is a binding usage boundary. More facts stop behaving like one quiet supporting line and require a larger metadata or details composition.

When more than four valid facts are supplied:

- development emits a clear warning;
- every fact still renders so the component never hides information; and
- the consumer must migrate to an appropriate larger composition instead of normalizing the misuse.

The implementation never silently truncates the fifth fact.

## 35. Canonical forms

### 35.1 Regular labeled facts

```jsx
<MetadataLine
  items={[
    { label: 'Observed', value: '3 min ago' },
    { label: 'Fetched', value: '2 min ago' },
  ]}
/>
```

Visible result:

```text
Observed 3 min ago · Fetched 2 min ago
```

This bare, icon-free form is the canonical default.

### 35.2 Compact unlabeled facts

```jsx
<MetadataLine
  size="compact"
  items={[
    { value: '7 positions' },
    { value: 'CAD and USD' },
  ]}
/>
```

### 35.3 Optional group icon

```jsx
<MetadataLine
  icon={<ClockIcon />}
  items={[
    {
      label: 'Last verified',
      value: 'Aug 15, 2026, 3:54 PM',
      dateTime: '2026-08-15T15:54:00-03:00',
    },
    { value: 'Local evidence' },
  ]}
/>
```

The clock is valid because every fact belongs to one verification-time context. Do not add an icon merely to decorate ordinary metadata.

## 36. Size and hierarchy

| Size | Type | Line height | Typical use |
| --- | --- | --- | --- |
| `regular` | 13px | 18px | Page and panel headers, provider summaries, evidence context. |
| `compact` | 12px | 16px | Dense tables, compact list rows, narrow secondary areas. |

Labels use `--ink-secondary` at regular weight. Values use `--ink` at medium/semibold weight. Separators use secondary ink and never become colored status markers.

Do not use `--ink-tertiary` for visible facts at these sizes. Tertiary ink remains appropriate for nonessential documentation annotations or placeholders—not information the user may need to read.

## 37. Responsive behavior

### Normal widths

- Facts remain complete, non-breaking units.
- Centered dots separate facts.
- No fixed width or trailing column is reserved.
- The icon remains optically small and fixed in size.

### Exactly 390px viewport

- Separators disappear.
- Labeled facts align in a compact two-column label/value stack.
- Unlabeled values span the available width.
- The parent-supplied order remains unchanged.
- Text wraps inside its fact rather than causing horizontal overflow.
- The component does not shrink below the compact type scale.

The 390px requirement applies to the browser viewport. Actual component width may be smaller after page padding. A 320px container may be used as additional stress evidence, but it never replaces the exact-390px viewport render.

## 38. Interaction, motion, and ownership

`MetadataLine` is non-interactive. It has no hover, focus, pressed, selected, disabled, waiting, success, error, or recovery state.

It does not:

- fetch, poll, store, or format data;
- update its own clock;
- navigate;
- expose actions or links;
- claim connection health;
- create a live region by default; or
- animate.

The parent owns product data, update timing, announcements, actions, and any workflow surrounding the facts. If a fact must be clickable, compose a real link or button beside the primitive instead of turning the line into an inconsistent control.

## 39. Content guidance

### Good

- `Observed 3 min ago · Fetched 2 min ago`
- `7 positions · CAD and USD`
- `Verified just now · Local evidence`
- `Updated Aug 15 · 3 affected agents`

### Avoid

- Five or more facts compressed into one line.
- Raw IDs or payload details in ordinary product metadata.
- `Connected` or `Failed` presented as metadata instead of truthful status.
- Repeating the nearby title or primary value.
- Raw machine timestamps when a readable local value is available.
- Developer stages or fixture wording in production context.

Labels should be short nouns or past-tense facts. Values should remain concise enough to scan. If a sentence explains consequences or recovery, use supporting copy or a status composition instead.

## 40. Accessibility

- Visible text carries the complete meaning.
- Optional icons are decorative and hidden from assistive technology.
- Separators are hidden so screen readers hear natural phrases without punctuation noise.
- `dateTime` values render as semantic `<time>` elements.
- The component does not create a tab stop.
- Color does not carry meaning.
- DOM order remains the visual and spoken order at every width.
- Static metadata does not announce itself merely because it mounts.
- A parent may deliberately apply an accessible region or announcement when a user-triggered change requires it.

## 41. Adjacent components and composition boundary

| Component | Question answered |
| --- | --- |
| `TitleBlock` | What is this area? |
| `StatusIndicator` | What state is this in? |
| `MetadataLine` | What supporting facts place it in context? |
| Future `StatusSummary` | What is the state, and what one sentence explains it? |
| Future `DetailList` or `MetadataGroup` | What larger set of labeled facts should I inspect? |

A valid parent composition may contain `TitleBlock`, `StatusIndicator`, `MetadataLine`, and a primary action as siblings. None is expanded into a catch-all header.

## 42. Do / do not

### Do

- Keep the icon absent by default.
- Use labels when they clarify otherwise ambiguous values.
- Use `dateTime` for machine-readable timestamps.
- Preserve one to four facts in a stable order.
- Let the parent control the meaning and formatting.
- Use a larger composition when the fact set grows.

### Do not

- Add a card, pill, border, shadow, padding, or radius.
- Use semantic success, warning, danger, or info color.
- Insert actions, chevrons, menus, tooltips, or diagnostics.
- Use tertiary ink for facts that must be read.
- Invent labels during responsive reflow.
- Silently drop overflow facts.

## 43. Acceptance checklist

- [ ] The component answers only “What supporting facts place this nearby object in context?”
- [ ] The canonical default is bare and icon-free.
- [ ] One to four facts are supplied in a meaningful order.
- [ ] A fifth fact produces a development warning without data loss.
- [ ] Labels use readable secondary ink and values use primary ink.
- [ ] No surface, semantic color, shadow, or interaction was added.
- [ ] Separators are visual-only and disappear at a 390px viewport.
- [ ] Narrow label/value rows use parent-supplied wording.
- [ ] Timestamp values use `<time>` when `dateTime` is available.
- [ ] Optional icon and labels remove their markup and space when absent.
- [ ] No horizontal overflow occurs at exactly 390px.
- [ ] The parent owns formatting, state, data behavior, and announcements.

---

## 44. Shared implementation rules

### 44.1 File ownership

```text
client/src/components/design-system/
├─ TitleBlock.jsx
├─ TitleBlock.css
├─ TitleBlock.test.jsx
├─ StatusIndicator.jsx
├─ StatusIndicator.css
├─ StatusIndicator.test.jsx
├─ MetadataLine.jsx
├─ MetadataLine.css
├─ MetadataLine.test.jsx
└─ index.js
```

Import through the public barrel when integrating:

```js
import { MetadataLine, StatusIndicator, TitleBlock } from './components/design-system/index.js';
```

### 44.2 CSS namespace

All design-system classes use the `qds-` prefix. The existing client has broad legacy selectors based on class-name substrings. In particular, generic words such as `title`, `badge`, `popover`, `tooltip`, and `modal` can trigger unrelated styles.

The production classes therefore use collision-resistant names such as:

- `qds-heading-block`
- `qds-heading-block__heading`
- `qds-status-indicator`
- `qds-status-indicator__symbol`
- `qds-metadata-line`
- `qds-metadata-line__fact`

Do not rename them to shorter generic classes.

### 44.3 Tokens

Components consume canonical variables from `client/src/App.css`:

- Surfaces: `--bg-raised`, `--bg-elevated`, `--bg-floating`
- Text: `--ink`, `--ink-secondary`
- Boundaries: `--line`, `--line-strong`
- Semantic color: `--success`, `--warning`, `--danger`, `--info`, `--accent`
- Spacing: `--sp-*`
- Radius: `--radius-*`
- Motion: `--duration-*`, `--ease-*`
- Elevation: `--shadow-*`

Fallbacks exist so isolated renders remain legible, but product appearance comes from the shared tokens.

### 44.4 No new icon dependency

Standard StatusIndicator symbols use small internal SVGs with `currentColor`. TitleBlock receives an icon from its parent. Do not add an icon package merely for these primitives.

### 44.5 Escape hatches

`className` and `style` exist for placement and exceptional integration—not for bypassing the contract. If multiple consumers need the same exception, stop using an escape hatch and propose a governed prop with evidence.

## 45. Adding component 04 and beyond

Every new component entry must include:

1. Human purpose
2. Non-goals and composition boundary
3. Anatomy
4. Design reasoning
5. Required content
6. Public props and controlled values
7. Canonical default
8. Legitimate variants
9. Complete state model
10. Interaction and motion
11. Content rules
12. Accessibility
13. Desktop and exactly 390px behavior
14. Production versus development boundary
15. Do / do not examples
16. Focused verification
17. Sanitized rendered evidence
18. Independent release verdict when material or major

A component is not added to the library merely by creating a JSX file. Documentation, production implementation, focused checks, and visual evidence move together.

## 46. Change control

### Minor compatible change

Examples:

- Fixing a screen-reader relationship
- Correcting a token reference
- Adding a missing focused test
- Clarifying documentation without changing behavior

### Material contract change

Examples:

- New public prop
- New appearance or size
- New semantic state
- Changed default
- Changed motion or announcement behavior
- Changed anatomy

Material changes require a fresh design-impact classification, updated documentation, focused rendered evidence, and an independent release-quality review.

### Breaking change

Examples:

- Renaming a prop or state
- Removing a supported variant
- Changing the meaning of a state
- Making a static component interactive
- Moving responsibility between primitive and parent

Breaking changes require migration planning across every consumer. Do not quietly change the primitive and repair screens opportunistically.

## 47. Final release question

For every component and every integration, ask:

> Would Apple release this complete experience as part of one of its products?

The acceptable answer is an immediate, evidence-supported, unqualified yes. A technically correct primitive can still fail because it is visually weak, miscomposed, misleading, inaccessible, or used in the wrong context. A beautiful specimen can still fail because the real workflow is incomplete.

The user remains the final acceptance authority.
