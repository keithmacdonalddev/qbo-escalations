# MetadataLine — Component Design Explanation

Component type: `primitive`

> This source-adjacent document is the complete explanation for the current MetadataLine contract. The polished live teaching page is `/docs/components/metadata-line`; the concise registry is `docs/design-system/COMPONENT_LIBRARY.md`. Those surfaces and the implementation must remain synchronized.

## Component definition

MetadataLine is a reusable presentation primitive for one to four quiet supporting facts that belong to a primary object, event, document, or section. Each fact may have a short label and must have a visible value. The component provides rhythm and separators without giving secondary context the authority of a title, status, action, or property table.

Its use threshold is intentionally narrow. Choose it when the user benefits from scanning a small, ordered set of facts inline and those facts remain understandable without a two-column property structure. The nearest failure mode is an overfilled line that forces people to methodically decode many values; at that point a definition list, detail panel, or properties grid is the truthful component. MetadataLine is a fact renderer, not a fact model, formatter, or catch-all header.

## Evidence and design determination

The operational interface repeatedly places observed times, sources, owners, versions, and similar facts near stronger content. Ad hoc rows created inconsistent gaps, punctuation, labels, and mobile behavior. Slate guidance favors compact readable context and few nested containers, so the contract uses a bare line with automatic separators and one optional shared icon. The rejected alternatives were a chip collection, which implies filtering or selection, and fixed props such as `timestamp` or `user`, which would bake one domain into the primitive.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| `client/src/components/design-system/MetadataLine/MetadataLine.jsx:4-6` limits roots and sizes and records a four-fact governance threshold. | The implementation already treats density and semantic root as controlled presentation while preserving all supplied facts. | Keep `span`/`div`, regular/compact, and the one-to-four guidance as independent controlled choices. | Automatically hiding a fifth fact would protect appearance by losing caller-supplied information. |
| `client/src/components/design-system/MetadataLine/MetadataLine.jsx:17-34` normalizes an ordered generic `items` collection. | Domain-specific props are unnecessary and would make the primitive brittle. | Retain generic `label`, `value`, `dateTime`, and `id` item fields with caller order preserved. | Fixed `timestamp`, `owner`, `source`, and `version` props would turn one current use into the component schema. |
| `client/src/components/design-system/MetadataLine/MetadataLine.jsx:73-91` inserts visual separators and semantic time markup structurally. | Consumers should not assemble punctuation strings or duplicate time semantics. | Generate only internal separators and render `<time>` when `dateTime` is supplied. | Caller-authored `"Fact • Fact"` strings would break conditional rendering, reading order, and responsive behavior. |
| `client/src/components/design-system/MetadataLine/MetadataLine.css:1-24` establishes a bare inline visual hierarchy using shared tokens. | The component is meant to compose inside existing surfaces rather than become another card. | Keep the default surface-free and use tokenized ink, type, icon, and gap relationships. | A rounded container would create nested-surface noise and make metadata resemble a button or dashboard card. |
| `docs/design-system/COMPONENT_LIBRARY.md:629-642` defines the question answered and excludes status, badge, title, action row, and card responsibilities. | Reuse depends on preserving this small semantic boundary. | Keep status, actions, formatting, prioritization, and business meaning parent-owned. | A generic “header details” component would accumulate identity, state, facts, and controls until it stopped being predictable. |

The central determination is that the component controls presentation while the parent controls meaning. That boundary is more consequential than the dot separator or exact gap because it prevents every new fact type from creating another prop, icon mapping, color rule, or conditional branch inside the primitive.

## Component boundary

MetadataLine owns ordered rendering, label/value hierarchy, separators, optional shared icon alignment, two densities, and semantic `<time>` output when `dateTime` is supplied. The parent owns facts, order, formatting, localization, priority, omission, data freshness, links, status, and any action.

It also does not poll for changing values, convert UTC to local time, compute relative time, decide whether data is stale, sort facts, infer labels, or announce updates. A parent may compose it inside a live region or link a surrounding object, but those behaviors are not inherited by the primitive. If a single fact must be interactive, that interactive object should be supplied as a neighboring control rather than hidden inside a string-value contract.

## Anatomy

```text
MetadataLine
├─ shared decorative icon?       optional
└─ facts                         one to four governed
   ├─ label?                     optional
   ├─ value                      required
   └─ separator before item?     structural, automatic
```

No leading or trailing separator can appear. An item without a label does not reserve label space. Invalid facts disappear rather than producing empty punctuation.

The shared icon describes the line as a whole. It is not repeated per fact and is removed together with its gap when absent. Each valid fact is a complete visual unit; the separator belongs to the relationship before every fact after the first. The optional `dateTime` changes the value element from `span` to `time` without changing what the user sees. These rules keep optional anatomy structurally absent rather than visually blank.

## Core design thesis

Supporting facts should be easy to find when wanted and easy to ignore when scanning primary work. That requires readable text, disciplined spacing, and structural separators—rather than faint type, individual chips, saturated color, or independent icon tiles.

The design goal is secondary, not barely visible. Quiet metadata still has to be readable because it often contains the evidence that lets a user trust the primary object. Consistent label/value rhythm allows fast comparison without inventing columns, while the absence of a surface allows the line to inherit the cohesion of its parent. Restraint comes from hierarchy and scope, not opacity.

## Canonical default

The default is a bare inline `span`, regular density, no icon, and one or more caller-supplied facts. It renders no background, border, shadow, or interaction. This form composes inside cards, headers, rows, and panels without creating container-within-container noise.

Regular density is the starting point because the facts remain supporting information but still deserve comfortable reading. The root `span` allows the primitive to sit naturally in compact compositions without forcing a block. No label is synthesized, no semantic tone is inferred, and no width is imposed. A one-item line is complete; dots appear only when another valid fact exists. The default therefore remains useful without pretending that metadata always means a multi-field strip.

## Variant, state, and size architecture

Regular and compact are density choices; they do not omit facts or change meaning. `as` supports `span` or `div` so the parent can choose an inline or block root. The optional icon belongs to the line as a whole. MetadataLine has no priority, semantic tone, loading, disabled, selected, or interactive variant.

Content and density remain independent. Compact tightens type and spacing for a dense pointer-first context but must not remove labels, values, or time semantics. Root element and density also remain independent: a compact line may still need a block root, and a regular line may remain inline. Item count is not a variant. The one-to-four threshold is design guidance with a warning because the component cannot safely decide which caller fact is dispensable.

There is no `surface`, `appearance`, `separator`, `tone`, or per-item icon axis. Those tempting options would change the primitive into a tag group or formatting framework. If a surrounding context needs a surface, that parent owns the container. If a state needs semantic color, use StatusIndicator. If many labeled facts need columns, use a larger details composition.

## Visual system

Values use readable secondary Slate ink; labels and separators are quieter but not illegible. Icon-to-facts spacing is tighter than ordinary layout spacing. Separators are centered dots inserted structurally. Regular and compact adjust type, gaps, and icon size together. The bare component has no surface or elevation.

The CSS consumes `--ink`, `--ink-secondary`, `--line`, `--text-sm`, `--text-xs`, `--sp-1`, `--sp-2`, and `--sp-3` relationships from the shared Slate system, with local fallbacks for isolated rendering. Values receive the strongest metadata weight, labels sit one step quieter, and separators use a still quieter neutral without becoming the only boundary between facts. Icon color follows the secondary ink and uses `currentColor` so arbitrary domain colors cannot enter through the component.

Regular density keeps an approximately 13px supporting type scale with comfortable inline gaps; compact uses the shared smaller scale and tighter spacing as one coordinated preset. The component avoids gradients, shadows, radius, padding, and independent icon wells. These omissions are visual decisions: they prevent a contextual line from acquiring the object-like prominence of a control or card.

## Interaction and state journey

MetadataLine is informational. Interaction states are inapplicable because the component only renders supporting facts and exposes no user-operated control. It has no hover, focus, pressed, expanded, or selected state. Data updates come from the parent. The component does not announce changes automatically, calculate relative time, poll, sort, or decide that a fact is stale.

When the parent supplies a new item list, DOM order and visible order update together. No transition delays or animates the evidence, and no completed state appears. If the update follows a user action and would otherwise be missed, the feature owns a separate polite announcement or focused result. This avoids turning every frequently updating metadata row into a noisy live region.

## Responsive behavior

Facts wrap as meaningful units; separators remain associated with the fact they precede and do not strand at a new line start. The line preserves caller order and does not silently hide lower-priority facts. If more structure is needed on 390px, the parent chooses a details list or explicitly supplies fewer facts.

At exactly 390px, the approved documentation composition demonstrates a label/value stack rather than squeezing several punctuation-separated phrases into one unreadable row. The component itself retains all facts, and the parent supplies every label needed for that reflow. Long values wrap inside their fact, numbers remain visible, and the root cannot create page-wide horizontal scrolling. Compact is never selected automatically merely because the viewport narrowed; automatic density changes would make layout behavior unpredictable.

## Accessibility

DOM order matches visual order. Separators and the shared icon are hidden from assistive technology. Visible labels and values form the readable text. A `dateTime` value renders `<time dateTime="…">` while leaving formatting to the caller. The component has no live region by default.

The text must meet contrast requirements on every approved parent surface; tertiary placeholder ink is not acceptable for facts a user may need to inspect. Meaning never depends on the dot, icon, color, or visual label weight alone. A numeric zero is preserved as real content. Machine-readable time is supplementary semantics, not a substitute for a readable local value.

Because the component is static, it creates no tab stop and does not borrow button or link roles. Safe caller-supplied `aria-*`, `data-*`, and `role` attributes may describe a deliberate surrounding semantic relationship, but the base component does not claim a list, status, or alert role automatically. Browser zoom, high contrast, right-to-left inline flow, and reading order must preserve the facts.

## Content guidance

Use concise labels and already formatted values: “Observed 3 min ago,” “Owner Operations,” or “Version 4.” Keep ordering consistent within one product context. Do not put sentences, action labels, primary status, confidential identifiers, or an entire property inventory in the line.

Labels should be short qualifiers, normally nouns or past-tense evidence words. Values should contain the complete visible fact and use the product's formatting utilities before reaching the component. Do not ask MetadataLine to convert bytes, currencies, dates, names, or relative times. Avoid labels that repeat the nearby heading and avoid internal developer stages, raw payload fragments, or identifiers that ordinary users cannot interpret.

## Public API

```jsx
<MetadataLine
  items={[
    { label: 'Observed', value: '3 min ago', dateTime: '2026-08-16T10:00:00Z' },
    { label: 'Source', value: 'Workspace' },
  ]}
/>
```

The concrete contract is:

```tsx
type MetadataFact = {
  id?: string | number;
  label?: string;
  value: string | number;
  dateTime?: string;
};

type MetadataLineProps = {
  as?: 'span' | 'div';
  size?: 'regular' | 'compact';
  icon?: React.ReactNode;
  items: MetadataFact[];
};
```

Minimal valid example:

```jsx
<MetadataLine items={[{ value: '3 min ago' }]} />
```

Full example:

```jsx
<MetadataLine
  as="div"
  size="compact"
  icon={<ClockIcon />}
  items={[
    { id: 'observed', label: 'Observed', value: '3 min ago', dateTime: '2026-08-16T10:00:00Z' },
    { id: 'source', label: 'Source', value: 'Workspace' },
  ]}
  aria-label="Supporting evidence"
/>
```

Controlled props are `items`, `icon`, `size`, and `as`, plus safe root identifiers and ARIA/data attributes. Each item accepts `id`, `label`, `value`, and `dateTime`. The ref targets the root for legitimate parent relationships or measurement. Values remain strings or numbers; arbitrary React nodes, links, buttons, raw HTML, per-item styles, per-item icons, custom separators, semantic tones, surfaces, padding, and formatter callbacks are excluded. Existing `className` and `style` are compatibility escape hatches for placement, not permission to redefine anatomy; recurring exceptions require a governed contract revision rather than another one-off override.

## Invalid combinations and safeguards

A non-array `items` value warns and renders nothing. Items without a visible value are ignored and warned. More than four valid facts are all rendered to avoid hiding information, but development warns that a larger details composition is appropriate. Unsupported root elements and sizes fall back to `span` and `regular`. Empty results render no stray wrapper.

- An invalid `items` container is rejected through normalization and a development warning rather than being iterated unpredictably.
- Empty, whitespace-only, null, or unsupported values are filtered, and the resulting line renders nothing when no valid facts remain; this prevents empty wrappers and punctuation.
- An invalid root or size uses a deterministic safe fallback and warns so production remains readable while development exposes the misuse.
- More than four facts warn but remain visible; the safeguard prevents silent information loss while directing the caller to a larger composition.
- Separators are generated only inside the valid-item map and only after the first item, structurally preventing leading, trailing, or duplicate punctuation.
- `dateTime` never formats the visible value; callers cannot accidentally expose an ISO string merely by supplying semantics.
- Unsupported arbitrary DOM props are filtered, preventing click handlers or unreviewed HTML behavior from turning the primitive interactive.

## Relationship to neighboring components

TitleBlock establishes identity, StatusIndicator communicates one state, Badge or Chip gives a value discrete identity, and a definition list or properties panel supports many methodically inspected facts. Button and Toolbar contain actions. MetadataLine remains the quiet inline context between those components.

A future MetadataGroup may support more than four facts, responsive columns, descriptions, or richer value types. That larger object should not be simulated by stacking several MetadataLines without a shared reading model. Likewise, a single state-related word inside metadata does not replace StatusIndicator when state is what the user needs to notice. These boundaries keep contextual facts subordinate and make component choice understandable.

## Do / don't guidance

Do:

- Keep the icon absent unless it clarifies the complete line.
- Supply one to four concise, already formatted facts in meaningful order.
- Use labels when otherwise similar values would be ambiguous.
- Provide `dateTime` when a visible value represents a precise timestamp.
- Move larger inventories into a definition list, DetailList, or properties panel.

Don't:

- Hardcode business fields or formatters into the primitive.
- Manually insert bullets, dots, pipes, or delimiter strings.
- Turn facts into chips, actions, filters, or status pills.
- Infer semantic color from words such as Connected or Failed.
- Hide caller facts automatically to preserve a single-line silhouette.

## Acceptance criteria

- [ ] The component answers only what supporting facts place a nearby object in context.
- [ ] One to four facts render in exact caller order.
- [ ] A fifth fact warns without losing information.
- [ ] Empty or invalid facts cannot create stray wrappers or separators.
- [ ] A one-item line looks intentional.
- [ ] Labels are optional and values are required.
- [ ] Numeric zero remains a valid visible value.
- [ ] `dateTime` produces semantic time markup without formatting logic.
- [ ] Regular and compact preserve every fact and the same identity.
- [ ] Root `span` and `div` choices do not change meaning.
- [ ] Optional icon and labels remove both markup and space when absent.
- [ ] Wrapping has no leading separator or horizontal overflow.
- [ ] Icons and separators do not create redundant announcements.
- [ ] The component creates no focus stop, live region, or interaction.
- [ ] Exactly 390px remains readable without silent fact removal.
- [ ] Visible facts use readable text tokens rather than placeholder contrast.
- [ ] Formatting, state, data behavior, ordering, and announcements stay parent-owned.
- [ ] Implementation, explanation, registry, live docs, tests, and rendered evidence agree.

## Independent critique

Restricting content to string/number values is less flexible than a `ReactNode` API, but it prevents links, badges, and feature-specific markup from turning a simple fact renderer into a loose layout slot. The one-to-four governance threshold is documented rather than enforced because hiding user-supplied information would be worse than an overfull line. Existing `className` and `style` compatibility should be reviewed only after real consumer inventory exists.

The bare visual form is another real tradeoff. It composes cleanly inside existing surfaces, yet an isolated MetadataLine can look less “finished” in a showcase than a rounded container. Adding a default surface would improve the specimen at the cost of nested-card noise throughout the application. The component accepts that showcase weakness because contextual integration, not standalone ornament, is its real job.

Responsive reflow also depends on caller quality. The primitive cannot invent missing labels when punctuation gives way to a stack, so terse unlabelled facts that work on desktop may become ambiguous in a narrow parent composition. Documentation and review must require labels when context will not survive reflow; automatic wording would create a more dangerous business-meaning failure.

## Decision summary

MetadataLine is a bare, ordered line of one to four supporting facts with optional labels, semantic time support, one shared decorative icon, structural separators, and regular or compact density. It excludes formatting, status interpretation, actions, chips, domain fields, sorting, and silent prioritization.

The canonical form is a regular inline span with no icon or surface. Caller order is authoritative, invalid facts cannot create punctuation, and a fifth valid fact remains visible with a warning. The design accepts a deliberately quiet standalone appearance in exchange for clean composition. Its complete contract is presentation-owned and meaning-agnostic: the component arranges facts; the parent decides what those facts are and whether MetadataLine remains the correct structure.

## One-sentence definition

MetadataLine is a quiet, generic row for rendering caller-supplied supporting facts with disciplined labels and separators without imposing a data model or competing with primary content.
