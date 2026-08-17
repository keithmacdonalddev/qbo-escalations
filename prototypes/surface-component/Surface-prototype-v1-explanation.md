# Surface — Component Design Explanation

Component type: `primitive`

## Component definition

Surface is a static layout primitive that helps the user recognize related content as one group without turning that group into a clickable card, a status object, or a self-contained workflow. It answers one question: **“Which nearby content belongs together?”** That question recurs across QBO work, Investments, Knowledge, agents, provider settings, and future operational domains even when the content itself is completely different.

The use threshold is structural. Use Surface when spacing alone leaves a real grouping ambiguous and a neutral bordered background makes the reading boundary clearer. Do not use it merely to make a short block look more polished. A plain semantic section and whitespace remain better when the relationship is already obvious. Plain HTML is insufficient only because the application currently repeats the same raised-background, boundary, radius, and padding recipe with inconsistent names and measurements.

## Evidence and design determination

The proposal reconciles the documented Slate contract with the app's effective cascade rather than treating the first token declaration as the rendered truth. The prototype uses the effective values currently produced after the late stylesheet overrides, while the future component API remains token-driven so it follows a later palette hardening without a component rewrite.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| The user requested “Surface — the bordered background that groups related content.” | The stable job is visual grouping, not identity, state, action, or feature-specific content. | Define a static primitive with one required content slot and a fixed neutral bordered background. | Calling it `Card` would imply an object with identity, possible action, and richer behavior that the request does not require. |
| `DESIGN.md:16` says to prefer one organized surface over card collections and group related controls inside one panel. | The component should encourage one shared boundary and internal composition rather than container-per-item design. | Give Surface one calm in-flow treatment with no decorative elevation and document nested Surface as invalid by default. | Multiple elevated cards would make every child compete as an independent object and recreate the exact collection the design rule rejects. |
| `DESIGN.md:238` gives panels 12–16px padding; `DESIGN.md:251-256` specifies an 8px primary-panel radius, a 1px `--line` border, and no shadow for in-flow panels. | Geometry is already constrained enough to produce a disciplined canonical form. | Regular padding follows `--sp-6` (currently 14px after the effective cascade), radius follows `--radius-lg` (currently 8px), border is 1px `--line`, and shadow is absent. | A 16px radius plus routine shadow would manufacture elevation and conflict with the compact operational language. |
| `client/src/App.css:35,47,153-156,165` defines `--bg-raised`, boundaries, spacing, and radius; `client/src/overhaul.css:30,42-43,7038,7048` currently overrides the rendered background, lines, radius, and regular spacing. | A prototype using only the early Slate hex values would not reproduce today's production rendering, while hardcoding late values into production would preserve current drift forever. | Render v1 with the verified effective values, but specify production CSS through semantic variables only. | Ignoring the late cascade would create approval-to-production mismatch; hardcoding `#2c2c2e` would turn a temporary runtime result into a permanent component palette. |
| `client/src/App.css:1277-1286` already contains generic `.card` and `.card-compact` recipes with raised background, subtle border, large/medium radius, and different padding. | There is recurring visual demand, but the legacy name combines static grouping with clickable-card extensions and uses a weaker border than the current Surface request. | Keep Surface static, use the default `--line` boundary, and separate layout padding from interaction. | Promoting `.card` unchanged would inherit hover/elevation expectations and make a static group visually indistinguishable from a selectable object. |
| `client/src/settings.css:265-266,470-473,634-635,1124-1125` repeats raised backgrounds, subtle boundaries, and padding across different settings groups. | The grouping job plausibly recurs across more than one consumer and domain without requiring business-specific props. | Keep data, internal layout, headings, dividers, and actions parent-owned; Surface provides only the common boundary recipe. | A `SettingsPanel` API would bind the primitive to its first domain and invite title/action slots that do not belong in the base object. |
| `client/src/components/design-system/TitleBlock/TitleBlock.md:38,91` explicitly excludes background, border, radius, shadow, and padding and says a contained panel may compose it. | The library already identifies a missing parent-owned visual-container job. | Surface may contain TitleBlock as a child but does not absorb its heading semantics or optional description. | Adding `surface` props back to TitleBlock would reverse an approved boundary and make title appearance dependent on placement. |
| `client/src/components/design-system/MetadataLine/MetadataLine.md:56,66` keeps metadata bare and says the parent owns any surrounding surface. | Metadata and Surface are complementary primitives rather than competing variants. | MetadataLine may sit inside Surface; Surface never formats facts or gives them status color. | A metadata-card composition would combine fact rendering and grouping too early and reduce reuse. |
| `client/src/components/design-system/index.js:1-4` exports Button, MetadataLine, StatusIndicator, and TitleBlock, but no governed Surface exists. | The request does not duplicate a current public component. | Treat Surface as a valid proposed component 05, pending user approval and a later production scope. | Reusing an undocumented feature class would preserve current drift without a controlled API or acceptance contract. |

The substantive improvement over the Button quality-floor example is a newly resolved repository contradiction: this explanation distinguishes canonical token relationships from the values that the current late cascade actually renders. That makes the prototype production-faithful today without endorsing hardcoded runtime drift as the permanent API.

## Component boundary

Surface owns only the neutral background, one-pixel boundary, controlled radius, controlled internal padding, `min-width: 0`, and safe content wrapping at its outer edge. It does not own the spacing between arbitrary children; the child composition supplies its own stack, grid, dividers, or rows. The primitive does not inspect business content or change its presentation based on what it contains.

The parent owns semantic grouping, headings, accessible names, landmarks, content order, internal layout, dividers, actions, focus, product data, loading, empty, success, partial, error, recovery, confirmation, navigation, persistence, analytics, and side effects. A parent may use `<section aria-labelledby="…">` around Surface when the group needs named document semantics. Surface itself remains a presentational `<div>` so a visual boundary cannot silently create excessive landmarks.

Surface is not a Card. A Card represents a recognizable object and may later need identity, selection, navigation, or action behavior. Surface represents only a visual grouping boundary. It is not a Panel composition either; a Panel would normally own a heading/content relationship and perhaps actions. It is not an inset work area, floating layer, modal, popover, status summary, or form fieldset.

## Anatomy

```text
Surface
├─ neutral raised background       required
├─ one-pixel boundary              required
├─ controlled radius               required
├─ internal padding                regular | compact | none
└─ caller content                  required
```

There is no optional icon, title, description, badge, status, action rail, footer, or divider. The only controlled layout option is padding. `regular` and `compact` add their complete inset. `none` removes the inset entirely and is valid only when the direct child owns every required edge inset, as a row list or table normally does. No invisible title row or action column is reserved.

The reading order is exactly the caller's DOM order. Surface adds no first visual stop inside the group; the parent's heading or primary content remains responsible for hierarchy. The border and background are reinforcing cues only.

## Core design thesis

The thesis is **boundary without identity**. A calm background and one clear line are enough to say “these things belong together.” The component deliberately stops before it says what the group is, what state it is in, whether it can be clicked, or which action matters.

That restraint matters in this project because operational screens can easily become card collections. When every small fact receives its own rounded container, hierarchy flattens and the user must decode decoration before evidence. One neutral Surface lets the parent organize related content with internal spacing or dividers while preserving the surrounding workflow as the primary object.

## Canonical default

The canonical default is a static, full-available-width `<div>` with `padding="regular"`, `background: var(--bg-raised)`, `border: 1px solid var(--line)`, `border-radius: var(--radius-lg)`, and no shadow, hover, transform, accent, or semantic color. It does not impose a fixed width, minimum height, internal grid, or outer margin.

The prototype renders the current effective relationships as a `#2c2c2e` background, `rgba(84, 84, 88, 0.35)` line, 8px radius, and 14px regular inset. Those literal values belong only to the reproducible prototype. A production component would consume the variables so a later app-wide palette correction updates Surface together with the rest of Slate.

## Variant, state, and size architecture

The semantic intent is fixed: neutral grouping. Surface has no `tone`, `priority`, `status`, or `elevation` axis. If warning, danger, success, selection, or floating depth is the reason a boundary exists, another semantic component or composition owns that job.

Surface has no transient or persistent component states. Rest is the only state. Hover, focus-visible, pressed, selected, open, disabled, loading, success, partial success, failure, and recovery are inapplicable because Surface exposes no behavior and makes no product claim.

Surface has no size axis. Width and height come from the parent layout and content. It has one layout axis:

- `padding="regular"` — default; `--sp-6`, currently 14px in the effective runtime, for ordinary groups.
- `padding="compact"` — `--sp-3`, 8px, for short dense rows or small supporting groups.
- `padding="none"` — zero inset for edge-owning content such as a divided list or table whose rows provide their own padding.

Padding never changes border, background, radius, semantics, interaction, or content visibility. A future sunken, floating, interactive, selected, or semantic-tone treatment would be a material contract change or a different component, not another value added casually to `padding`.

## Visual system

The surface is one tonal step above the canvas and uses the normal boundary rather than the subtle internal-divider line. That makes the group legible without suggesting a floating layer. The 8px effective radius matches the current operational density rule. Shadow is absent because the object remains in normal document flow.

Text color, typography, icons, dividers, and internal spacing are not Surface styles. In the prototype they are specimen content used to prove that diverse child arrangements remain coherent; they are not anatomy. Production CSS must not select child headings, paragraphs, lists, buttons, or design-system components from inside `.qds-surface`.

The proposed collision-resistant root name is `.qds-surface`. Padding modifiers would be `.qds-surface--padding-regular`, `.qds-surface--padding-compact`, and `.qds-surface--padding-none`. No raw color, border, radius, shadow, or background prop is exposed.

## Interaction and state journey

Surface is static. It never changes on hover, never enters the tab order, and never responds to pointer or keyboard activation. A clickable Surface would be misleading because arbitrary interactive descendants can already exist inside it and nested interactive roots create invalid or confusing behavior.

If child content loads, succeeds, partially succeeds, fails, or recovers, the parent workflow updates that content and provides any needed announcement. Surface does not change color or elevation to narrate those states. If the entire grouped object is selectable or navigates, use a separately approved Card or interactive composition with a complete focus and activation contract.

No motion is present. Reduced-motion mode therefore has no alternate Surface behavior; child controls continue to follow their own contracts.

## Responsive behavior

Surface uses available inline width, `max-width: 100%`, and `min-width: 0`. It has no fixed height and grows with content. At exactly 390px, the border and 8px radius remain, regular padding stays within the 12–16px panel guidance, and long unbroken content can wrap rather than force page overflow. The component never selects compact automatically because viewport width does not determine information density.

The parent's inner layout reflows. A multi-column child grid may become one column, action groups may stack, and a table may choose an appropriate mobile pattern, but Surface does not reorder, hide, or truncate descendants. `padding="none"` remains zero at 390px; its direct edge-owning child must keep every row reachable and readable.

Localization can increase child height without changing the boundary. Right-to-left content follows normal document direction because Surface uses no directional positioning. Browser zoom and large text must expand the group naturally.

## Accessibility

The root is a neutral `<div>`. Visual grouping alone does not earn a landmark or group role. When the relationship needs to be exposed to assistive technology, the parent uses native semantics such as a labelled `<section>`, `<fieldset>`, list, table, or article around or inside Surface. This keeps document navigation useful instead of creating a landmark for every bordered box.

Surface has no accessible name of its own, no live region, no keyboard operation, no focus indicator, no target size, and no announcement behavior. It must not suppress or reorder child semantics. Border and background never carry status meaning, so color independence is satisfied intrinsically. In forced-colors mode, the boundary becomes a system-colored solid line and the background uses system Canvas; the grouping remains visible without relying on the original dark palette.

## Content guidance

Place content in one Surface only when it serves one coherent local purpose. Good examples include a related preference group, a small evidence set, a compact summary with internal dividers, or a table/list that owns row spacing. Use direct headings and concise supporting text supplied by the parent.

Do not use Surface as decoration around one short sentence, every metric, every metadata line, or every control. Do not nest Surfaces to create depth. Do not place a surface around an already self-contained Card, modal, popover, input, or status container. Do not use the border to imply clickability, urgency, success, selection, or validation.

## Public API

Proposed TypeScript direction:

```tsx
type SurfaceProps = {
  children: React.ReactNode;
  padding?: 'regular' | 'compact' | 'none';
  id?: string;
  'data-testid'?: string;
};
```

Minimal valid example:

```tsx
<Surface>
  <p>Related evidence stays together.</p>
</Surface>
```

Full composition example:

```tsx
<section aria-labelledby="review-context-heading">
  <Surface padding="compact">
    <TitleBlock
      headingId="review-context-heading"
      headingLevel={2}
      scale="section"
      title="Review context"
    />
    <MetadataLine items={reviewFacts} />
  </Surface>
</section>
```

`children` is required and parent-owned. `padding` is the sole controlled visual axis and defaults to `regular`. A forwarded ref, `id`, and approved `data-*` attributes may support measurement, testing, and semantic relationships outside the primitive. Arbitrary `className`, `style`, `as`, `role`, `tabIndex`, event handlers, raw colors, background, border, radius, shadow, width, height, margin, internal gap, and overflow props are excluded. A wrapper owns placement; a child composition owns internal layout.

Changing the default, token mapping, radius, border strength, allowed padding values, root semantics, or nesting rule is a material component-contract change. Adding a safe nonvisual `data-*` integration attribute is compatible when it cannot alter behavior or presentation.

## Invalid combinations and safeguards

- Missing, null, or visually empty `children` warns in development and renders nothing; an empty bordered box is not a truthful group.
- Unsupported `padding` values warn and fall back to `regular`, preserving the canonical safe inset.
- `padding="none"` with direct bare text or controls is invalid by contract because content would touch the boundary. The direct child must own complete edge padding. Documentation specimens and focused render tests enforce this visual condition because runtime code cannot truthfully infer every child's CSS.
- A Surface nested directly inside another Surface is invalid in the first contract. A small React context can issue a development warning while still rendering content; production does not delete information. A future genuine inset need should become a distinct approved component or appearance rather than accidental nesting.
- Event handlers, `tabIndex`, button/link roles, `href`, and polymorphic roots are rejected so a static boundary cannot become an unreviewed interactive card.
- `className`, `style`, raw visual props, and arbitrary CSS variables are excluded so consumers cannot fork the governed border/background recipe.
- Surface does not accept heading, status, action, footer, icon, divider, loading, error, or tone props. Those responsibilities compose as children or belong to neighboring components.
- Overflow is not hidden by default. Clipping arbitrary children would risk unreachable evidence and focus; an edge-owning child controls its own local overflow pattern.

## Relationship to neighboring components

TitleBlock answers what an area is; Surface answers which content belongs together. MetadataLine answers which supporting facts provide context; Surface may contain it but never formats those facts. StatusIndicator communicates one truthful state; Surface remains neutral around any state. Button performs an action; Surface does not gain hover or click behavior merely because a Button is inside.

A future Panel would compose Surface with a governed heading/content relationship and perhaps an action slot. A future Card would represent one identifiable object and own its interactive or selectable contract. A fieldset groups form controls semantically and may use Surface for appearance, but Surface cannot replace the fieldset/legend relationship. A modal, popover, and menu are floating layers with focus, dismissal, and elevation contracts and therefore are not Surface variants.

## Do / don't guidance

Do:

- Use one Surface around content that serves one local purpose.
- Keep the default regular padding for ordinary work groups.
- Use compact only for genuinely dense, short content.
- Use no padding only when a list, table, or similar direct child owns every edge inset.
- Compose headings, metadata, status, and actions as independent children with their own contracts.
- Let internal dividers organize several related rows inside one Surface.

Don't:

- Wrap every small fact or control in a separate Surface.
- Add hover, selection, navigation, drag, or click behavior to Surface.
- Use semantic color or accent borders to decorate routine groups.
- Nest Surface inside Surface to manufacture depth.
- pass raw background, border, radius, padding values, shadow, `className`, or `style`.
- Treat Surface as a replacement for Card, Panel, fieldset, modal, popover, or table semantics.

## Acceptance criteria

- [x] The prototype shows the canonical regular Surface first.
- [x] Border, background, radius, and no-shadow treatment match the current effective token cascade.
- [x] Regular, compact, and no-padding specimens preserve one silhouette and one meaning.
- [x] The image contains no page chrome, real account data, provider identity, credential, or customer information.
- [x] Surface itself contains no built-in heading, status, action, footer, icon, or divider anatomy.
- [x] The prototype source uses a collision-resistant `qds-` namespace.
- [x] The component is visibly static and uses no hover, focus, selected, loading, or semantic-tone treatment.
- [x] The original-resolution bitmap is checked for hierarchy, spacing, border clarity, token agreement, and clipping before handoff.
- [x] The isolated prototype reflows at exactly 390px without horizontal overflow or unreadable content.
- [x] Forced-colors treatment preserves a visible structural boundary without creating status meaning.
- [x] The explanation validator reports `STRUCTURE PASS`.
- [ ] The user explicitly approves this direction before production implementation begins.
- [ ] The approved bitmap is copied into `docs/design-system/assets/surface/` only after approval.
- [ ] Production implementation, contract manifest, registry, live docs page, focused tests, desktop/390 evidence, and independent review are completed before `available` status.
- [ ] Adoption remains limited to separately named consumers.

## Independent critique

The largest risk is that a reusable Surface makes it easier to over-containerize the interface. Consistency alone is not success: five perfectly consistent bordered boxes can still be worse than one organized region. The correction is a strict use threshold, invalid direct nesting, and adoption review that asks whether the boundary resolves real ambiguity.

The second tradeoff is unrestricted `children`. A visual container must accept varied content, but that flexibility means Surface cannot guarantee the quality of the layout inside. The contract responds by owning no descendant styling, exposing only padding, and requiring higher-level Panel or Card compositions when a stable internal relationship emerges. It does not pretend a generic slot is a complete workflow.

The third risk is palette drift. The current rendered app overrides the early Slate values, so a token-driven Surface will look like today's effective dark-grey system rather than the values printed near the top of `App.css`. The v1 prototype is honest about that runtime result. If the broader color hardening restores the original Slate palette, Surface should follow the tokens automatically; that global change would still require fresh rendered comparison because the approved bitmap would no longer match literally.

Finally, `padding="none"` is useful but easier to misuse than regular or compact. It prevents double insets around tables and row lists, yet it can create content touching the border. Keeping it is justified by recurring edge-owned content, but its acceptance requires a maintained specimen and focused test rather than relying only on prop validation.

## Decision summary

The proposed canonical Surface is a static, neutral, raised background with a one-pixel normal boundary, 8px current effective radius, regular token-driven padding, no shadow, no motion, and one required caller-content slot. Compact and no-padding are layout options only. Semantic intent, behavior, and visual treatment remain fixed.

Surface deliberately excludes identity, headings, metadata formatting, status, actions, navigation, selection, loading, outcomes, data behavior, internal layout, floating elevation, semantic tones, arbitrary styling, and feature adoption. The open approval decision is whether this quiet bordered silhouette and the three-value padding contract should become component 05. Production implementation is not authorized yet.

This result improves on the Button quality-floor example by reconciling the documented token source with the current effective CSS cascade and tying that contradiction to a reproducible prototype decision. It also defines a direct nesting safeguard for the component's most likely system-level misuse instead of only documenting valid specimens.

## One-sentence definition

Surface is a static, token-driven bordered background that visually groups related content while leaving meaning, hierarchy, interaction, and workflow behavior to its parent.
