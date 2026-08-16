# TitleBlock — Component Design Explanation

Component type: `primitive`

> This source-adjacent document is the complete explanation for the current TitleBlock contract. The polished live teaching page is `/docs/components/title-block`; the concise registry is `docs/design-system/COMPONENT_LIBRARY.md`. Those surfaces and the implementation must remain synchronized.

## Component definition

TitleBlock is a reusable identity primitive for naming a page, section, or compact panel and optionally pairing that heading with one short clarifying sentence and one decorative icon. It creates a predictable heading hierarchy without owning the actions, breadcrumbs, status, filters, or business content that may sit near the heading.

Use it when one semantic heading and at most one supporting sentence are enough to establish the identity of a region. The nearest failure mode is a “page header” that accumulates navigation, status, buttons, metadata, tabs, and responsive orchestration. That larger object is a composition. TitleBlock stays reusable precisely because it answers one question—what is this area?—and leaves every neighboring responsibility visible to the parent.

## Evidence and design determination

The component follows the Slate rules in `DESIGN.md`: work and identity appear early, typography supplies hierarchy before decoration, containers are optional, and responsive layouts preserve meaning rather than merely shrinking. Existing page headings varied in markup, spacing, and surface treatment, so the component governs those decisions as one semantic family. The rejected alternative was a feature-specific “header card” with built-in actions and status; it would make a simple heading dependent on unrelated workflow needs.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| `client/src/components/design-system/TitleBlock/TitleBlock.jsx:4-10` separates heading element, visual size, width, surface, border, elevation, and padding sets. | Semantic rank and visual presentation are independent decisions. | Preserve explicit controlled axes and never infer heading level from size. | One `variant="pageCard"` prop would combine markup, scale, width, and decoration into an opaque preset. |
| `client/src/components/design-system/TitleBlock/TitleBlock.jsx:34-47` derives padding and elevation from the requested container treatment. | Some visual combinations are incoherent even when each prop is individually valid. | Add regular padding to contained treatments and suppress elevation without a named surface. | Rendering every raw combination would allow bordered text to touch edges and shadows to float without a surface. |
| `client/src/components/design-system/TitleBlock/TitleBlock.jsx:69-77` renders icon, semantic heading, and optional subtitle as the complete anatomy. | Identity does not require actions, metadata, or status slots. | Keep one decorative icon and one short subtitle as the only optional content. | A universal Header component would bind a heading to one current action/status layout. |
| `client/src/components/design-system/TitleBlock/TitleBlock.css:1-31` starts from tokenized typography and no owned surface. | The heading should integrate into an existing page or panel before creating another container. | Make the bare section-scale treatment canonical and keep surfaces opt-in. | A default rounded card would create container nesting and make hierarchy depend on decoration. |
| `docs/design-system/COMPONENT_LIBRARY.md:93-103` defines identity and explicitly excludes the complete page-header job. | The reusable boundary is already governed across domains. | Keep breadcrumbs, navigation, actions, state, facts, and workflow behavior parent-owned. | Feature-specific header extraction would create multiple nearly identical components with incompatible semantics. |

The key determination is that semantic heading rank, visual scale, and container treatment cannot be one choice. A page may need an `h2` styled at section scale inside a nested document, while a visually prominent region can still require correct outline order. Keeping those axes explicit makes the component useful without allowing appearance to corrupt document semantics.

## Component boundary

TitleBlock owns heading semantics, title/subtitle spacing, optional icon alignment, governed scale, and approved container treatments. The parent owns where the block appears, which heading level is correct in the document outline, any breadcrumb or action group, loading or error states, and whether nearby information requires separate components.

It also does not navigate, collapse a section, open a menu, fetch identity data, choose a page title, format a subtitle, derive responsive action placement, or announce title changes. A parent may use `headingId` to label a surrounding region, but that region remains a separate semantic object. If the whole visual header is clickable, a purpose-built interactive parent must own focus, activation, and pressed behavior rather than attaching an event to TitleBlock.

## Anatomy

```text
TitleBlock
├─ decorative icon?          caller supplied
└─ copy
   ├─ semantic heading       required
   └─ subtitle               optional
```

The icon never replaces the title. The subtitle disappears cleanly when absent. Container treatments affect only the root surface and spacing; they never change the heading's meaning.

The root container is required because it aligns icon and copy as one identity group. The semantic heading is required and is the sole source of the region's name. Icon and subtitle are optional. Border, surface, padding, and elevation are conditional presentation on the root; no internal wrapper remains for an omitted icon or subtitle. `headingId` is applied directly to the actual heading rather than to decorative copy.

## Core design thesis

Identity should be unmistakable without requiring a card. Typography is the primary signal, spacing is the second, and surface treatment is an optional contextual aid. The component therefore begins bare and only gains padding when a real surface or border needs it.

The thesis is hierarchy through proportion, not ornament. A page title earns authority through type scale, weight, measure, and placement; an icon only improves recognition and a subtitle only resolves uncertainty. The component should feel complete when stripped to its required heading. Every optional visual signal must justify its presence in the parent composition rather than compensating for weak wording or layout.

## Canonical default

The default is `as="h2"`, `size="section"`, `width="auto"`, `surface="none"`, `border="none"`, `elevation="none"`, and `padding="none"`. It is deliberately quiet and content-width so a bare TitleBlock does not invent a panel or claim page-level hierarchy.

Section scale is the broadest safe default because the component is used for more than top-level pages, while `h2` avoids silently creating multiple document-level headings. Callers must deliberately request page size and `h1` where the surrounding outline supports them. No icon or subtitle is reserved. Auto width prevents a short identity from drawing an artificial horizontal surface. The result composes naturally inside existing page gutters, cards, and panels.

## Variant, state, and size architecture

`size` supports `page`, `section`, and `compact`; `as` independently supports `h1`, `h2`, and `h3`. Visual scale never chooses semantic rank. `width` supports `auto` and `full`. Surface, border, elevation, and padding are controlled composition axes rather than business variants. TitleBlock has no loading, selected, disabled, or interactive state.

Page, section, and compact change type, subtitle scale, icon geometry, and internal gap as coordinated presets. Width changes the root's layout footprint but never its semantic importance. Raised, elevated, and floating surfaces use the established Slate layer names; subtle and strong borders control boundary contrast; low and floating elevation exist only when a named surface provides a real layer. Padding is none, compact, or regular, with contained forms protected from none.

These axes are intentionally verbose because a single `variant` would hide invalid combinations and encourage feature-specific presets. There is no status, danger, success, disabled, loading, clickable, centered, promotional, or hero variant. If recurring evidence demands one, the contract must identify a stable job rather than merely add a new visual adjective.

## Visual system

The component uses Slate text, spacing, radius, surface, line, and shadow tokens. Page is the strongest scale, section is the default, and compact supports dense side panels. Icon color remains subordinate to the title. A border or named surface introduces a contained composition; default elevation is absent because shadow is reserved for meaningful layer separation.

The CSS consumes `--ink`, `--ink-secondary`, `--accent`, `--bg-raised`, `--bg-elevated`, `--bg-floating`, `--line`, `--line-strong`, `--radius-md`, `--radius-lg`, `--shadow-low`, and shared spacing/type tokens. Titles use the strongest ink; subtitles step down without falling to placeholder contrast. Icons use currentColor and the accent relationship as a recognition cue, not a semantic state.

Page scale uses the largest approved TitleBlock type and gap; section balances normal application hierarchy; compact compresses for inspectors and dense cards. Radius appears only when a surface or border creates a bounded object. Low or floating shadow never appears on a bare heading. These constraints preserve the Slate principle that elevation describes layers rather than making routine content look premium.

Long titles wrap with a balanced measure. No automatic uppercase, truncation, gradient text, glow, backdrop material, centered marketing alignment, or decorative line is part of the primitive. Surface choices remain neutral because status and danger belong to neighboring semantic components.

## Interaction and state journey

TitleBlock is non-interactive. It has no hover, pressed, focus, busy, expanded, or selected behavior. Dynamic title or subtitle changes are ordinary document updates; the parent decides whether a separate announcement is needed. Adding pointer affordances to the root is outside the contract.

Interaction states are inapplicable because TitleBlock communicates identity and exposes no user-operated control. If a parent replaces the title after navigation or a workflow change, focus management and announcement belong to that route or workflow. The component never moves focus to itself, animates title changes, or treats the new copy as a success state.

## Responsive behavior

At narrow widths, title and subtitle wrap naturally, the icon stays aligned with the first title line, and `full` fills only its parent. The component never truncates identity by default. The parent controls surrounding action-group stacking and page gutters.

At exactly 390px, page and section titles reduce through the documented fluid scale while preserving their semantic level. Icon, copy, and subtitle remain one readable cluster; a very long title wraps instead of creating horizontal scroll. Contained padding tightens only through approved responsive CSS, and the parent—not TitleBlock—decides whether sibling actions move below the identity. Right-to-left flow follows logical layout order.

## Accessibility

The caller chooses the heading level that preserves a logical outline. The visible title supplies the heading name. Icons are decorative and hidden from assistive technology. `headingId` supports `aria-labelledby` relationships from surrounding regions. Empty titles produce a development warning because an unnamed heading harms both scanning and navigation.

Visual size cannot substitute for heading semantics. A page-sized `h3` is still announced as level three, and an `h1` remains level one even when compact; documentation must make that distinction explicit. The component permits only `h1`, `h2`, and `h3` because deeper ranks have not shown a recurring shared visual need. Unsupported values fall back to `h2` rather than rendering an arbitrary element.

Subtitle text remains ordinary readable copy and is not hidden from assistive technology. Icons cannot contain the only meaningful noun. The root is not focusable, receives no button role, and creates no tab stop. Contrast, text enlargement, browser zoom, forced colors, and narrow widths must preserve the full title. If a surrounding region uses `aria-labelledby`, its relationship must point to the actual `headingId`.

## Content guidance

Use a short noun phrase that names the page or section. Use the subtitle for one sentence of orientation, not a paragraph, status message, timestamp, or instruction set. Avoid punctuation-only titles, generic “Overview” labels when a more specific identity exists, and duplicated breadcrumbs.

Prefer stable identities such as “Investments,” “Provider settings,” or “Current escalations.” A subtitle may explain scope—“Current work requiring attention”—but should not report health, progress, errors, or the next action. Do not place developer stages, raw IDs, account secrets, long marketing claims, or caller-specific HTML inside the title. The component does not rewrite case or punctuation.

## Public API

```jsx
<TitleBlock
  as="h1"
  size="page"
  title="Workspace"
  subtitle="Current escalations and evidence"
  icon={<WorkspaceIcon />}
/>
```

The concrete contract is:

```tsx
type TitleBlockProps = {
  as?: 'h1' | 'h2' | 'h3';
  size?: 'page' | 'section' | 'compact';
  width?: 'auto' | 'full';
  surface?: 'none' | 'raised' | 'elevated' | 'floating';
  border?: 'none' | 'subtle' | 'strong';
  elevation?: 'none' | 'low' | 'floating';
  padding?: 'none' | 'compact' | 'regular';
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  headingId?: string;
};
```

Minimal valid example:

```jsx
<TitleBlock title="Workspace" />
```

Full example:

```jsx
<TitleBlock
  as="h1"
  size="page"
  width="full"
  surface="raised"
  border="subtle"
  padding="regular"
  title="Workspace"
  subtitle="Current work requiring attention"
  icon={<WorkspaceIcon />}
  headingId="workspace-heading"
/>
```

Controlled props are `as`, `size`, `width`, `surface`, `border`, `elevation`, `padding`, `title`, `subtitle`, `icon`, and `headingId`, plus safe identifiers/ARIA/data attributes. The ref points to the root container for legitimate measurement or parent relationships. Actions, breadcrumbs, metadata, status, navigation, tabs, click behavior, alignment modes, raw token values, icon wells, and arbitrary internal slots are excluded. Existing `className` and `style` are compatibility escape hatches for placement, not permission to restyle the heading family. A recurring exception requires evidence and material contract review instead of another feature override.

## Invalid combinations and safeguards

Unsupported controlled values fall back to their safe defaults. A border or surface with `padding="none"` receives regular padding and warns in development because a flush contained heading is visually broken. Elevation without a named surface is ignored and warned because a shadow cannot identify a real layer. Missing title warns; unsafe arbitrary DOM props are filtered.

- Unsupported heading, size, width, surface, border, elevation, or padding values use deterministic safe fallbacks instead of constructing raw classes.
- Missing title produces a development warning so unnamed headings cannot pass silently.
- A surface or border with no padding is normalized to regular padding and warned, preventing content from touching a bounded edge.
- Elevation without a named surface is suppressed and warned, preventing a shadow from inventing a floating layer around bare text.
- Optional icon and subtitle render no wrapper and reserve no gap when absent.
- Unsafe root props are filtered so click handlers and arbitrary HTML behavior cannot make the static identity interactive accidentally.
- Heading rank remains caller-selected and is never changed by visual size, preventing semantic hierarchy from drifting with styling.

## Relationship to neighboring components

Breadcrumb owns location, Button or ButtonGroup owns actions, StatusIndicator owns operational state, and MetadataLine owns supporting facts. A Card or Panel owns a larger content container. TitleBlock may sit inside those compositions but does not absorb their responsibilities.

A complete page header is a parent composition that may align TitleBlock with actions and place status or metadata below. A disclosure heading or clickable row requires a dedicated control that owns expanded state and keyboard behavior. A hero or marketing masthead may share typography tokens but has different content and spacing rules. Keeping these neighbors separate prevents the identity primitive from becoming a universal top-of-page layout.

## Do / don't guidance

Do:

- Choose semantic heading rank from the document outline.
- Choose page, section, or compact size independently from rank.
- Begin with the bare default and add a surface only for a real container need.
- Keep the title meaningful without its icon and the subtitle to one sentence.
- Use `headingId` to label a surrounding region when appropriate.

Don't:

- Use an icon as the only identity or repeat the breadcrumb as the title.
- Make the root clickable, focusable, expandable, or selectable.
- Add actions, status, metadata, tabs, or navigation inside TitleBlock.
- Use elevation without a named surface or remove padding from a bounded form.
- Change heading rank merely to obtain a different visual size.

## Acceptance criteria

- [ ] The component answers only what the page, section, or panel is.
- [ ] The heading level matches the caller's document outline.
- [ ] Visual size never changes semantic rank.
- [ ] Page, section, and compact scales remain one family.
- [ ] The canonical default is bare, section-sized, auto-width, and `h2`.
- [ ] Title remains meaningful without the icon.
- [ ] Optional icon and subtitle leave no empty markup or spacing.
- [ ] Surface, border, padding, and elevation remain independent controlled axes.
- [ ] Contained treatments receive coherent padding.
- [ ] Elevation never appears without a named surface.
- [ ] Empty titles produce a development warning.
- [ ] The component creates no interaction, focus stop, request, or announcement.
- [ ] Narrow layouts wrap without horizontal overflow or silent truncation.
- [ ] Exactly 390px preserves identity and readable subtitle measure.
- [ ] Icons are decorative and `headingId` labels the actual heading.
- [ ] Forced colors, text enlargement, and browser zoom preserve the title.
- [ ] Parent actions, state, facts, navigation, and workflow remain outside.
- [ ] Implementation, explanation, registry, live docs, tests, and rendered evidence agree.

## Independent critique

The broad container API creates a real tradeoff: it is useful across bare and bounded identities, but it can invite card-like overuse. Its safeguard is a bare canonical default and explicit warnings for incoherent surface combinations. The component also accepts `className` and `style` for compatibility with its first release; future revisions should inventory real use before deciding whether those escape hatches can be narrowed without breaking consumers. The risk is visual drift if feature teams treat compatibility as authorization.

Separating `as` from `size` adds conceptual work for callers. A simpler component could couple page size to `h1` and section size to `h2`, but that rejected direction would produce invalid outlines in nested regions and encourage teams to choose markup for appearance. The extra prop is justified only if documentation consistently teaches that one controls semantics and the other controls visual hierarchy.

The optional surface system is powerful enough to become a miniature Card API. Its limits—neutral surfaces only, no owned actions or content slots, normalization of padding, and suppression of shadow without a layer—must remain strict. If consumers routinely need complex header containers, the correct response is a governed PageHeader or PanelHeader composition rather than further expansion of TitleBlock.

## Decision summary

TitleBlock is a semantic heading composition with three governed scales, independent heading rank, one optional decorative icon, one optional subtitle, and restrained opt-in surfaces. It deliberately excludes actions, status, navigation, workflow behavior, and automatic document hierarchy.

The canonical form is an auto-width, bare section heading rendered as `h2`. Page, section, and compact control visual scale; `h1`, `h2`, and `h3` control the document outline; width and container treatments remain separate. Invalid surface combinations normalize safely and warn. This architecture accepts a slightly more explicit API in exchange for trustworthy semantics across page, section, and panel contexts.

## One-sentence definition

TitleBlock is a semantic, optionally illustrated heading composition that establishes page or section identity without absorbing nearby navigation, status, actions, or content.
