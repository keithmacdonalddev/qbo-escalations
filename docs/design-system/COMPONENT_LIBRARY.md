# QBO Escalations Component Library

**Status:** Canonical, evolving component contract

**Current components:** 01 `TitleBlock`, 02 `StatusIndicator`, 03 `MetadataLine`, 04 `Button`

**Production source:** `client/src/components/design-system/`
**Visual language:** Slate, defined by `DESIGN.md` and tokens in `client/src/App.css`

This document is the formal registry and concise inventory for reusable interface components in QBO Escalations. The authoritative detailed contract lives beside each component as `<ComponentName>.md`; a machine-readable `<ComponentName>.contract.json` keeps public props, defaults, and behavior assertions synchronized for every component created or materially revised under the current release workflow.

The library will grow one reviewed component at a time. A page-specific pattern does not become a shared component merely because two screens look similar. Shared components exist only when their meaning and behavior remain stable across domains such as QBO work, Investments, Knowledge, agents, providers, and personal workspace tools.

---

## 1. Authority and reading order

Use these sources in this order:

1. `DESIGN.md` defines the product-wide design principles, Slate tokens, density, interaction quality, and release bar.
2. Each component folder contains `<ComponentName>.md`, the authoritative source-traceable explanation that preserves design determination, rejected alternatives, safeguards, critique, and acceptance criteria.
3. This file is the registry and concise inventory for reusable contracts and approved composition boundaries.
4. New or materially revised component folders contain `<ComponentName>.contract.json`, the machine-readable prop/default/assertion contract consumed by production source, live docs, and release validation.
5. The routed `/docs/components/<slug>` experience is the polished teaching surface with live production specimens; `DESIGN.HTML` is only a migration pointer to that site.
6. `client/src/components/design-system/` is the production implementation.
7. Feature CSS may compose these components but may not silently redefine their anatomy or semantics.

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

Design-system primitives do not perform network requests, store product data, poll, retry, navigate, or invent workflow behavior. Information-display primitives remain non-interactive. Button exposes one caller-supplied native action handler but still leaves state derivation, requests, outcomes, and authority with the parent. This prevents a visually small component from becoming a hidden product or permission boundary.

### 3.7 The Apple bar is a complete-experience bar

The question is not whether a component resembles an Apple screenshot. The question is whether it would feel completely at home in a premium shipped product: clear purpose, disciplined hierarchy, truthful state, familiar behavior, excellent spacing, accessible semantics, and no unfinished development machinery.

The app retains its Slate identity. It does not copy Apple branding, materials, or promotional presentation.

---

# Component 01 — `TitleBlock`

**Status:** `available`

**Classification:** `primitive`

**Detailed contract:** `client/src/components/design-system/TitleBlock/TitleBlock.md`

**Live documentation:** `/docs/components/title-block`

## 4. Purpose

`TitleBlock` names the current page or meaningful section and may add one short sentence explaining its purpose. It answers one stable question:

> What work area is this, and what is it for?

The primitive is deliberately text-only. It does not become a page header, card, status surface, navigation object, or action group. Those responsibilities stay with the parent so TitleBlock remains predictable across QBO work, Investments, Knowledge, agent workspaces, and future operational domains.

## 5. Canonical default

The canonical default is a transparent page-scale title with no description. The caller supplies `headingLevel` deliberately, while `scale` defaults to `page`. The component owns no outer margin, fixed width, background, border, radius, elevation, icon, or animation.

Page scale is 28px on desktop and 22px below 720px. Section scale is 18px. Fluid uses `clamp(34px, 4.2vw, 50px)` and a 25-character desktop measure. TitleBlock intentionally uses the app's 600 heading weight without a weight-specific `!important`; it owns its approved measurements and narrowly protects only its tracking and semantic ink from the late density stylesheet.

## 6. Anatomy

```text
TitleBlock
├─ semantic heading element       required
│  └─ visible title string        required
└─ description paragraph          optional
   └─ short sentence string       required when present
```

When the description is absent or invalid, its paragraph and top margin disappear together. Title and description accept strings rather than arbitrary children, preventing badges, links, actions, status, and rich layout from entering the text stack.

## 7. Public API

```jsx
<TitleBlock
  headingLevel={1}
  title="Operations workspace"
/>
```

| Prop | Values | Default | Purpose |
| --- | --- | --- | --- |
| `title` | non-empty string | required | Visible title and accessible heading name. |
| `description` | non-empty string | none | One optional explanatory sentence. |
| `headingLevel` | 1 \| 2 \| 3 | required | Document-outline semantics independent from visual scale. |
| `scale` | section \| page \| fluid | page | Governed visual hierarchy without changing heading rank. |
| `headingId` | non-empty string | none | Optional heading identifier for a parent aria-labelledby relationship. |

The public API excludes `children`, `className`, `style`, `as`, legacy `subtitle` and `size`, icon and container props, raw color or font controls, interaction handlers, and role replacement. A wrapper owns placement. A parent landmark may reference `headingId`, but TitleBlock does not create the landmark itself.

## 8. Scales and layout

| Scale | Heading | Description | Internal gap | Intended use |
| --- | --- | --- | --- | --- |
| `page` | 28px desktop, 22px below 720px | 14px, max 68ch | 6px | Canonical page or workspace identity |
| `section` | 18px | 13px, max 62ch | 4px | Meaningful subdivision inside one route |
| `fluid` | 34px–50px clamp, max 25ch on broad layouts | 15px, max 86ch (about 695px) | 8px | Short identity-first title with deliberate space |

Heading level and visual scale are independent. An `h1` may use section scale when the document is visually compact, and an `h2` may use fluid scale inside a larger document. Scale never changes document semantics.

TitleBlock has no fixed outer width. Page and section titles use their parent's available width. Fluid alone has a 25ch desktop heading measure, released to 100% below 720px; its 86ch description measure resolves to approximately the same 695px maximum in the approved typography. All text remains visible, wraps naturally, and uses emergency breaking for unbroken identifiers rather than ellipsis or line clamping.

## 9. Visual system

The heading uses `--ink` and `--font-sans`; the description uses `--ink-secondary` and the same family. Shared `--sp-1`, `--sp-2`, and `--sp-3` values control the approved internal gaps. No color or font-family prop exists, so app-wide theme changes flow through the variables while arbitrary parent inheritance cannot recolor one title into status or action emphasis.

The component surface is transparent. Specimen frames in the prototype and documentation are teaching scaffolding, not part of TitleBlock. Adding a surface, border, shadow, padding, icon, eyebrow, or centered marketing treatment would change the primitive's job and requires a separately approved composition.

## 10. Interaction, accessibility, and content

TitleBlock is static and non-interactive. It has no hover, focus, pressed, disabled, loading, success, error, recovery, announcement, or reduced-motion state. It never enters the tab order and never attaches event handlers. The parent owns changing workflow state and any adjacent control.

`headingLevel` renders a native `h1`, `h2`, or `h3`. The visible title supplies the accessible name. The description follows in normal document order and is not forced into `aria-describedby`. Use direct sentence-case titles and one concise description only when it resolves uncertainty. Warnings, status, policy detail, implementation notes, and links belong outside the primitive.

## 11. Safeguards

- Empty or non-string titles report a development error and render nothing.
- Invalid heading levels report a development error and safely fall back to `h2`.
- Unsupported scales warn and fall back to `page`.
- Empty descriptions warn and disappear structurally; long descriptions remain visible.
- Empty heading IDs warn and are omitted.
- Styling, container, rich-content, semantic-replacement, and interaction escape hatches are ignored with development warnings.
- Long and localized strings wrap without fixed height, ellipsis, or clipping.
- Fluid keeps the exact approved clamp; callers cannot alter its bounds through props.

## 12. Availability and adoption

TitleBlock is available from the public design-system barrel:

```js
import { TitleBlock } from './components/design-system/index.js';
```

The routed teaching page uses the production export and contract manifest. The release replaces the legacy TitleBlock implementation and its documentation-only examples. No production feature screens consumed the legacy export at replacement time, so availability does not silently migrate an operational workflow.

## 13. Acceptance checklist

- [x] The default is page scale with title-only anatomy.
- [x] `headingLevel` and `scale` remain independent.
- [x] Page, section, and fluid measurements match the approved contract.
- [x] Fluid uses the exact 34px–50px clamp and 25ch desktop measure.
- [x] Optional description markup and spacing disappear together.
- [x] The component has no visual container, icon, status, action, or motion.
- [x] Shared theme roles govern font family and ink.
- [x] The production CSS reconciles the late global token and heading overrides.
- [x] Invalid required and controlled values have safe behavior.
- [x] The public export remains `TitleBlock`.
- [x] The complete contract is colocated in `TitleBlock.md`.
- [x] The live production page is routed at `/docs/components/title-block`.
- [x] Focused component and documentation tests pass.
- [x] Desktop and exact-390 rendered evidence have no overflow or console errors.
- [x] The independent Design/Experience Reviewer returns `YES — RELEASE QUALITY`.

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

# Component 04 — `Button`

**Approved baseline:** `docs/design-system/assets/button/Button-prototype-v2.png`

**Complete explanation:** `client/src/components/design-system/Button/Button.md`

**Live documentation:** `/docs/components/button`

**Status:** `available`

**Classification:** `interactive-control`

## 44. Purpose and boundary

`Button` initiates one clearly named action in the current interface. It communicates local priority, destructive consequence, availability, and progress while the parent remains responsible for the surrounding workflow.

Button owns native semantics, controlled geometry, the visible label and optional icon relationship, focus and press feedback, loading presentation, native disabled presentation, and duplicate-activation protection. The parent owns permissions, validation, requests, confirmation, completion, failure, recovery, persistence, analytics, and deciding which action is locally primary.

Navigation is an anchor. Persistent selection belongs to ToggleButton. A popup trigger belongs to MenuButton. A glyph-only action belongs to IconButton. Layout across several actions belongs to ButtonGroup. These are related components, not Button modes.

## 45. Canonical default

The safe default is:

```jsx
<Button>Review details</Button>
```

It renders a content-width, medium 40px, neutral, secondary-priority native `<button type="button">`. The default has no icon, progress glyph, fixed marketing width, gradient, glow, glass, or routine shadow. A bare Button remains clearly operable without silently claiming to be the preferred action in every placement.

## 46. Semantic model

| Axis | Values | Meaning |
| --- | --- | --- |
| Priority | `primary`, `secondary` | How strongly the action competes in its immediate decision group |
| Tone | `neutral`, `destructive` | Whether the consequence is ordinary or harmful/difficult to reverse |
| State | rest, hover, focus-visible, pressed, `loading`, `disabled` | What the control is doing or whether it can currently act |
| Size | `small`, `medium`, `large` | Controlled 32px, 40px, or 48px geometry without semantic change |
| Width | content, `fullWidth` | Placement only; width never upgrades importance |

Primary, secondary, loading, disabled, and destructive appear together in the requested showcase, but they are not equivalent “variants.” Loading and disabled can apply to more than one priority and tone. Keeping the axes separate prevents compound names such as `primaryLoading` or `destructiveDisabled` and makes the contract easier to reason about.

## 47. Public API

```jsx
<Button
  priority="primary"
  tone="neutral"
  size="medium"
  loading={isSaving}
  loadingLabel="Saving changes…"
  icon={<svg viewBox="0 0 16 16"><path d={savePath} /></svg>}
  iconPosition="leading"
  fullWidth={false}
  type="button"
  onClick={saveChanges}
>
  Save changes
</Button>
```

| Prop | Controlled values | Default | Contract |
| --- | --- | --- | --- |
| `children` | non-empty string | required | Visible action label and accessible name |
| `priority` | `primary` \| `secondary` | `secondary` | Local action hierarchy |
| `tone` | `neutral` \| `destructive` | `neutral` | Ordinary or harmful consequence |
| `size` | `small` \| `medium` \| `large` | `medium` | Governed 32/40/48px geometry |
| `loading` | boolean | `false` | Busy semantics, progress presentation, and activation guard |
| `disabled` | boolean | `false` | Native unavailable state |
| `loadingLabel` | non-empty string | visible label | Caller-named active operation |
| `icon` | one passive inline SVG tree | none | Purposeful inert glyph; interactive or opaque trees are rejected |
| `iconPosition` | `leading` \| `trailing` | `leading` | Logical icon placement |
| `fullWidth` | boolean | `false` | Container width without semantic promotion |
| `onClick` | function | none | Sole caller action handler, guarded while loading or unavailable |
| `type` | `button` \| `submit` \| `reset` | `button` | Safe native form behavior |

The ref plus explicit data, name/value/form, `id`, and descriptive ARIA attributes pass through. `onClick` is the sole action handler. Raw `className`, `style`, `as`, `href`, role or tab-order replacement, `aria-label`, `aria-hidden`, `aria-disabled`, alternate action handlers, and toggle/menu ARIA states are outside the governed contract and are ignored with development warnings.

## 48. Visual system and sizes

The Button family keeps one rounded-rectangle silhouette. Neutral primary uses the bright Slate accent with dark ink for contrast. Neutral secondary uses the raised control surface, readable primary ink, and a quiet boundary. Secondary destructive uses a restrained danger tint, danger label, and semantic border. Solid primary destructive is reserved for a focused confirmation where the harmful action is genuinely the principal decision.

| Size | Height | Inline padding | Radius | Intended context |
| --- | ---: | ---: | ---: | --- |
| Small | 32px | 14px | 6px | Dense pointer-first tools |
| Medium | 40px | 18px | 8px | Canonical application action |
| Large | 48px | 22px | 10px | Touch-first or spacious flows |

Size changes geometry, not wording, priority, consequence, width, or content visibility. Content width is canonical; `fullWidth` is an explicit independent layout choice.

## 49. State and interaction contract

- Rest presents one clear action name with no motion.
- Hover provides a restrained tonal preview and is never the only operability signal.
- Focus-visible uses a separated outer ring that remains visible on neutral, accent, and danger surfaces.
- Press feedback is immediate, small, and never delays the action handler.
- Loading keeps focus, exposes `aria-busy="true"` and unavailable semantics, blocks repeat pointer/keyboard/synthetic activation, and reserves both resting and loading measurements to prevent layout shift.
- Disabled uses native `disabled`, leaves normal focus order, removes hover/press behavior, and uses purpose-built readable tokens instead of whole-element opacity.
- Completion, partial success, failure, and recovery remain parent-owned workflow states. Button returns to an appropriate resting action; it does not turn itself into a permanent status indicator.

If `loading` and `disabled` are supplied together, development warns and loading takes deterministic precedence. Accepted work remains identifiable and keyboard focus is preserved instead of being discarded by native disabled behavior.

Under reduced motion, press transforms and spinner rotation are removed. A static dashed progress glyph, specific loading wording, busy semantics, and stable focus preserve the same meaning.

## 50. Content and hierarchy rules

- Use one primary action in an immediate decision group.
- Begin with a specific verb: `Save changes`, `Try again`, `Remove access`, or `Delete project`.
- Use secondary destructive outside a focused confirmation.
- Use primary destructive only when consequence text and a safe cancel route establish a deliberate confirmation context.
- Loading wording names the active operation and is supplied by the parent.
- Do not use generic `Button`, `Submit`, `Proceed`, `Yes`, or `Click here` specimens when a concrete result can be named.
- Do not add badges, descriptions, timestamps, keyboard hints, or status messages inside Button.

## 51. Accessibility and responsive behavior

The native element is `<button type="button">` unless the caller deliberately requests `submit` or `reset`. The visible string supplies the accessible name. Icons and the progress glyph are decorative. Destructive wording communicates consequence beyond color. Focus, boundary, text, disabled treatment, forced colors, browser zoom, and reduced motion are all part of acceptance.

At exactly 390px, the component retains the caller's requested size and sibling order. Parent layouts normally select medium or large in touch-first contexts, stack action groups, and explicitly request full width. Button uses logical inline spacing, does not silently truncate labels, and must not create page overflow.

## 52. Safeguards

- Empty visible labels render no control and warn in development.
- Unsupported controlled values use documented safe fallbacks.
- Loading and disabled cannot silently contradict each other.
- Loading behavior guards repeat activation even if visual CSS fails.
- One icon slot prevents noisy double-decoration and ambiguous menu chevrons.
- `href` and `as` are excluded so navigation cannot inherit action semantics accidentally.
- Raw visual styling escape hatches cannot fork tokens per feature.
- Primary destructive is a documented contextual boundary even though code cannot infer the containing confirmation.

## 53. Release and migration status

Button is available through the public design-system barrel and is taught with live production specimens at `/docs/components/button`. This release does not replace legacy `.btn`, feature-specific buttons, or action groups. Adoption remains a separately inventoried and approved migration scope so a component release cannot silently change existing workflows.

The production implementation, focused tests, `Button.contract.json`, `Button.md`, this registry, the routed documentation page, prototype/evidence assets, and design release record form one governed release unit. A material change to any semantic axis, default, state meaning, size, invalid-combination rule, or component boundary must update all applicable surfaces together.

## 54. Acceptance checklist

- [x] The canonical default is neutral secondary, medium 40px, content-width, and native.
- [x] Primary, secondary, loading, disabled, and destructive remain one coherent silhouette.
- [x] Priority, tone, state, size, and width are independent axes.
- [x] Small, medium, and large render at 32px, 40px, and 48px.
- [x] Loading preserves dimensions, focus, accessible wording, busy semantics, and one activation.
- [x] Disabled blocks activation and remains identifiable without whole-element opacity.
- [x] Focus-visible is unmistakable and unclipped on every approved surface.
- [x] Destructive meaning is present in wording as well as color.
- [x] Exactly 390px has no horizontal overflow or silent label truncation.
- [x] Reduced motion retains all semantic feedback without continuous rotation or press transform.
- [x] Public safeguards prevent semantic and visual escape hatches.
- [x] Production code, explanation, registry, live docs, tests, prototype, evidence, and release record agree.

---

## 55. Shared implementation rules

### 55.1 File ownership

```text
client/src/components/design-system/
├─ Button/
│  ├─ Button.jsx
│  ├─ Button.css
│  ├─ Button.test.jsx
│  ├─ Button.md
│  ├─ Button.contract.json
│  └─ index.js
├─ MetadataLine/
│  ├─ MetadataLine.jsx
│  ├─ MetadataLine.css
│  ├─ MetadataLine.test.jsx
│  ├─ MetadataLine.md
│  └─ index.js
├─ StatusIndicator/
│  ├─ StatusIndicator.jsx
│  ├─ StatusIndicator.css
│  ├─ StatusIndicator.test.jsx
│  ├─ StatusIndicator.md
│  └─ index.js
├─ TitleBlock/
│  ├─ TitleBlock.jsx
│  ├─ TitleBlock.css
│  ├─ TitleBlock.test.jsx
│  ├─ TitleBlock.md
│  └─ index.js
└─ index.js
```

Import through the public barrel when integrating:

```js
import { Button, MetadataLine, StatusIndicator, TitleBlock } from './components/design-system/index.js';
```

### 55.2 CSS namespace

All design-system classes use the `qds-` prefix. The existing client has broad legacy selectors based on class-name substrings. In particular, generic words such as `title`, `badge`, `popover`, `tooltip`, and `modal` can trigger unrelated styles.

The production classes therefore use collision-resistant names such as:

- `qds-heading-block`
- `qds-heading-block__heading`
- `qds-status-indicator`
- `qds-status-indicator__symbol`
- `qds-metadata-line`
- `qds-metadata-line__fact`
- `qds-button`
- `qds-button__content`

Do not rename them to shorter generic classes.

### 55.3 Tokens

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

### 55.4 No new icon dependency

Standard StatusIndicator symbols use small internal SVGs with `currentColor`. TitleBlock, MetadataLine, and Button receive optional icons from their parent. Do not add an icon package merely for these primitives.

### 55.5 Escape hatches

`className` and `style` exist for placement and exceptional integration—not for bypassing the contract. If multiple consumers need the same exception, stop using an escape hatch and propose a governed prop with evidence.

Button deliberately does not expose `className` or `style`; wrappers own placement and `fullWidth` covers its recurring internal width treatment. The older information-display primitives retain those compatibility props until consumer evidence justifies a separate narrowing change.

## 56. Adding component 05 and beyond

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
19. A dedicated `client/src/components/design-system/<ComponentName>/` folder
20. A complete colocated `<ComponentName>.md` explanation
21. A machine-readable `<ComponentName>.contract.json` shared by source, docs, and release validation for every new or materially revised component
22. A finished `/docs/components/<slug>` page using live production specimens

A component is not added to the library merely by creating a JSX file. Its folder, explanation, registry entry, live teaching page, production implementation, focused checks, rendered evidence, and required review move together.

## 57. Change control

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

## 58. Final release question

For every component and every integration, ask:

> Would Apple release this complete experience as part of one of its products?

The acceptable answer is an immediate, evidence-supported, unqualified yes. A technically correct primitive can still fail because it is visually weak, miscomposed, misleading, inaccessible, or used in the wrong context. A beautiful specimen can still fail because the real workflow is incomplete.

The user remains the final acceptance authority.

---

# Component 05 — `Modal`

**Status:** `available`

**Classification:** `interactive-control`

**Approved baseline:** `docs/design-system/assets/modal/Modal-prototype-v1.png`

**Detailed contract:** `client/src/components/design-system/Modal/Modal.md`

**Live documentation:** `/docs/components/modal`

**User approval:** August 18, 2026. The approved prototype freezes the regular and compact silhouette, safely dismissible interaction model, stable header/body/footer frame, and exact-390 responsive intent. Production adoption by existing feature workflows remains separate.

## 59. Purpose and boundary

`Modal` moves one bounded, safely dismissible task into the foreground while preserving the user's place in the underlying workspace. It owns the portal, focus veil, dialog labelling, close control, focus containment, dismissal reasons, scroll lock, stable shell regions, reduced motion, and focus return.

The parent owns the work: open state, content, validation, requests, persistence, actions, permissions, analytics, outcome feedback, and whether a close request proceeds. `Modal` is not a workspace, route, mobile sheet, popover, alert-dialog tone, business-state container, or generic floating card.

## 60. Anatomy and canonical default

```text
Modal
├─ portal root
│  └─ focus veil
│     └─ dialog surface
│        ├─ identity header
│        │  ├─ required title
│        │  ├─ optional description
│        │  └─ close control
│        ├─ scrolling body
│        └─ optional action footer
└─ captured opener
```

The canonical default uses the regular 610px maximum width, natural height up to `100dvh - 24px`, a required title and body, an optional one-sentence description, and no footer unless the parent supplies actions. `compact` changes the maximum width to 520px without changing semantics. Both sizes preserve 12px viewport insets.

The internal `qds-focus-layer` and `qds-focus-veil` vocabulary is deliberate: it prevents the repository's late broad substring selectors for modal, dialog, overlay, and backdrop from mutating the governed production appearance.

## 61. Public API

| Prop | Type / values | Default | Contract |
| --- | --- | --- | --- |
| `open` | boolean | required | Controls whether the focus-contained foreground layer is mounted. |
| `title` | non-empty string | required | Visible heading and accessible name for the bounded task. |
| `description` | non-empty string | none | Optional concise context announced with the title. |
| `size` | compact \| regular | regular | Governed 520px or 610px maximum shell width. |
| `initialFocusRef` | React ref to a contained focus target | dialog surface | Optional caller-selected first focus target inside the layer. |
| `footer` | ReactElement \| ReactElement[] | none | Optional caller-owned actions, normally governed Button instances. |
| `children` | ReactNode | required | Caller-owned task content within the scrolling body region. |
| `onRequestClose` | function(reason: escape \| backdrop \| close-button) | required | Sole dismissal request boundary; the parent decides whether closing proceeds. |

The component rejects styling and semantic escape hatches, portal-target selection, raw stacking or veil values, motion timing, draggable/resizable behavior, automatic form submission, and nested layers. Adding a size, dismissal mode, persistent region, or non-dismissible state is a material contract change.

## 62. Interaction and accessibility

- Opening captures the opener, makes background content inert, locks body scrolling, and focuses a valid contained target or the dialog surface.
- Tab and Shift+Tab loop through current enabled descendants.
- Escape, true-veil pointer activation, and the close control request `escape`, `backdrop`, or `close-button` respectively.
- Veil dismissal requires pointer down and pointer up on the veil; dragging across the surface boundary never closes the task.
- Closing restores the opener when it still exists.
- A second simultaneous Modal is blocked instead of nesting focus traps.
- Reduced motion removes entry animation. Forced colors preserve the shell boundary, close control, and focus location.

Modal has no loading, success, failure, retry, disabled, or destructive presentation. Those belong to the caller's task and composed Button controls.

## 63. Responsive and content rules

At exactly 390px, the shell resolves to 366px with 12px insets, 16px title type, 15px body insets, a 40px close target, fixed identity and action regions, and no horizontal overflow. Only the body scrolls after the natural shell reaches its viewport cap. Long titles, descriptions, content, and localized actions wrap rather than truncate.

Use short sentence-case task titles and decision-specific verbs. Do not add a second header, decorative status strip, raw provider output, dashboard navigation, or implementation explanation to the component shell.

## 64. Acceptance checklist

- [x] The regular canonical shell appears before compact and mobile examples.
- [x] Required title and body remain present in every supported use.
- [x] Optional description and footer structurally disappear when omitted.
- [x] Regular and compact change only governed geometry.
- [x] Collision-resistant internal classes survive the effective cascade.
- [x] Opening contains focus, protects the background, and locks page scroll.
- [x] Every dismissal path reports exactly one governed reason.
- [x] Dragging across the surface boundary cannot become a veil dismissal.
- [x] Closing restores the opener when it remains available.
- [x] A second simultaneous Modal is blocked with a development warning.
- [x] The body scrolls while identity, close, and actions stay reachable.
- [x] Exact-390 rendering retains insets, target size, readability, and reachability.
- [x] Reduced-motion and forced-color behavior preserve meaning and focus.
- [x] The component performs no feature operation or business-state announcement.
- [x] Governed Button supplies footer action semantics.
- [x] Source, contract, explanation, live docs, focused tests, rendered evidence, and release record agree.

## 65. Adoption

`Modal` is available from the public design-system barrel. No legacy consumers were migrated in this release. `ConfirmModal`, reporting, and agent panels remain feature-owned until each workflow receives separate adoption approval and complete rendered review.
