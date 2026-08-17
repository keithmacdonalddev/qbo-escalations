# Title Block V2 — Component Design Explanation

Component type: `primitive`

## Component definition

Title Block V2 is a static primitive that tells the user what area of work they are looking at and, when needed, gives one short sentence of purpose without turning orientation into a decorative banner. It is appropriate at the start of a page or a meaningful subsection where a consistent heading-and-description relationship improves scanning. It is not justified for every small card, table group, or control cluster; ordinary semantic headings remain the better choice when no reusable spacing or responsive contract is needed.

The single question it answers is: **“What work area is this, and what is it for?”** A plain heading cannot by itself govern the relationship to optional explanatory text, visual scale independent of document outline, omission spacing, long-title wrapping, and a consistent first-viewport budget. This primitive does those jobs while remaining deliberately text-led.

## Evidence and design determination

The proposal is independent by design. The current Title Block implementation, its usages, and its documentation specimen were not inspected because the user explicitly asked for a fresh direction without that component's influence. The required design foundation did contain a brief catalog mention of the older component; that mention was treated as excluded evidence and did not determine the V2 anatomy or API. Revision v2 preserves that boundary while incorporating the user's requested large fluid scale and the clarified theme-variable behavior.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| The user requested “Title Block V2” and explicitly prohibited inspecting the existing component's functionality. | The proposal must stand on first principles and current global design evidence rather than preserving accidental legacy anatomy. | Use a text-led, independently defined primitive and document the old implementation, consumers, and specimen as uninspected. | Reviewing the old component first would reduce migration risk, but it would violate the requested method and bias the new direction toward inherited choices. |
| The user requested a large title using `clamp(34px, 4.2vw, 50px)` and chose the name `fluid` after rejecting the overloaded term `display`. | The size name must be understandable inside this component and the rendered behavior must match the exact requested bounds. | Add an opt-in `scale="fluid"` treatment while keeping `page` as the canonical default and preserving the existing anatomy. | Naming the scale `display` would describe broad emphasis but could also mean a monitor, resolution, or CSS display mode; naming it `large` would hide the responsive behavior the user specifically wants. |
| `DESIGN.md:14-15` requires the Slate system and says hierarchy should match value. | A title needs clear typographic priority, but it should not gain visual weight from an ornamental card, glow, or semantic color. | Make typography, spacing, and readable ink carry hierarchy; keep the component surface transparent. | A raised panel with blue edge treatment would look more distinctive in isolation but would overstate routine orientation and consume first-viewport space. |
| `DESIGN.md:289-304` limits ordinary page headers and rejects repeating the same concept across eyebrow, title, subtitle, and card title. | The component must stay short and must not create duplicate context labels. | Require one title, allow one concise description, and exclude eyebrow, breadcrumb, badge, metadata, and repeated category copy. | A flexible header with kicker, subtitle, metadata, and trailing badge would cover more screenshots but would institutionalize duplication and cognitive load. |
| `DESIGN.md:335-342` asks for a direct page title, one short sentence only when needed, and no decorative source-of-truth eyebrow copy. | Optional explanation must disappear completely when it does not resolve uncertainty. | The canonical default is title-only; description is a plain optional string with no reserved gap when absent. | Making the description required would produce consistent geometry but force filler copy onto self-explanatory screens. |
| `client/src/App.css:30-57` defines the Inter/system font stack, dark Slate surfaces, primary and secondary ink, subtle lines, and blue accent. | The primitive should follow the app theme without accepting per-screen color or font overrides. | Use `--font-sans`, `--ink`, and `--ink-secondary`; expose no color or font-family prop and do not use accent color because the title is not an action or status. | Using `color: inherit` and `font: inherit` would follow any immediate parent styling, but it could accidentally turn one title into status color or a feature-local font instead of following the governed app theme. |
| `client/src/App.css:142-165` defines the typography, spacing, and radius scales used by Slate. | Normal sizes and spacing can be token-connected; the requested fluid size needs explicit documented bounds because no current token expresses it. | Use `--text-2xl` for page, `--text-lg` for section, existing description and spacing tokens, and the exact provisional `34px–50px` clamp only for fluid. | Reusing `--text-2xl` for the large treatment would make the new scale indistinguishable; silently adding global type tokens before approval would broaden this prototype into a shared-theme change. |
| `docs/research/apple-design-systems/apple-design-systems-research.md:234-256` describes hierarchy through clear roles and typography as infrastructure for legibility, hierarchy, accessibility, and product voice. | The most durable title treatment is a semantic text relationship, not a material effect. | Separate heading semantics from visual scale and rely on type weight, size, line height, and controlled measure. | A glass-like or elevated header treatment would imitate a visible style while ignoring the deeper hierarchy and adaptation principles. |
| `.agents/skills/design-system-component/references/component-workflow-contract.md:31-43` requires one user question, stable meaning, required anatomy, structural omission, semantic variants, isolation, and external side effects. | Reuse is justified only if the object stays smaller than the page header composition around it. | Classify V2 as a static primitive with one required title, one optional description, three governed scales, and no behavior or side effects. | A PageHeader composition with actions, status, and navigation would answer several questions at once and fail the primitive candidacy test. |

The central determination is that Title Block V2 should be governed by **what it refuses to absorb**. It establishes identity and purpose only. This avoids the common drift where every page header becomes a unique mix of badges, actions, breadcrumbs, timestamps, and decorative containers.

## Component boundary

Title Block V2 owns the semantic heading element, the title's typography, optional description typography, the gap between those two lines, governed section, page, and fluid scales, natural wrapping, and structural removal of optional content. It also owns a safe heading-level mapping and an optional heading ID so a surrounding landmark can be labelled correctly.

The parent page or feature owns placement, available width, page-level margins, heading-outline choice, actions, navigation, breadcrumbs, status, metadata, loading, retry, data fetching, persistence, analytics, and any region that uses the title through `aria-labelledby`. The parent also owns whether a description is useful. A workflow owns success, failure, warnings, and announcements; this static primitive does not infer or display them.

The root wrapper groups the heading and optional description but is not a visual container: it owns no background, border, radius, shadow, or padding. The component does not become clickable when a page wants navigation, and it does not accept arbitrary trailing content. A parent PageHeader may place Title Block V2 beside an action group or below breadcrumbs, but those siblings remain outside the primitive so its meaning stays stable across QBO work, Investments, Knowledge, agents, and future operational domains.

## Anatomy

```text
TitleBlockV2
├─ heading element                         required
│  └─ visible title string                 required
└─ description paragraph?                  optional
   └─ visible supporting sentence string   required when paragraph exists
```

The heading is the only required visible node. When `description` is absent, empty, or whitespace-only, the paragraph and its top margin are both omitted; there is no invisible spacer. The component contains no icon column, accent bar, eyebrow row, action rail, badge slot, metadata row, or background layer.

This anatomy is intentionally strict. A title can wrap to multiple lines, but callers cannot insert a badge or button inside the text because `title` is a string rather than unrestricted children. The description is also a string so it remains short explanatory prose instead of becoming a container for links, controls, lists, or status messages.

## Core design thesis

The thesis is **orientation through disciplined typography**. The title is the first visual stop because of semantic position, readable size, tighter tracking, and stronger weight. The optional description explains purpose at a clearly subordinate size and color. No extra mark is needed to announce that a title is important.

This approach keeps the component visually calm and lets the work surface begin quickly. It also makes absence meaningful: when the title is self-explanatory, the block becomes exactly one heading with no manufactured empty space. When one sentence prevents uncertainty, it appears close enough to read as part of the same thought without becoming a hero introduction.

## Canonical default

The canonical default is a transparent, page-scale block containing one required heading and no description. It uses `--text-2xl` at a proposed 28px, approximately 660 weight, 1.16 line height, slightly tightened tracking, and `--ink`. It is content-width within the parent's available column and has no padding, border, radius, shadow, accent, icon, or animation.

Title-only is the safest default because a bare component should not invent explanatory copy, imply a surface, or claim status. The parent must pass `headingLevel` explicitly so the document outline stays deliberate; visual scale defaults to `page` because the component's most common identity job is expected to be a page-level orientation point. These values are provisional until production typography is rendered in the real app, but they are tied directly to current Slate tokens rather than freehand measurements.

## Variant, state, and size architecture

The contract separates four concepts instead of flattening them into one `variant` prop:

- **Semantic level:** `headingLevel` is required and maps to `h1`, `h2`, or `h3`. It controls document meaning, not visual size.
- **Visual scale:** `scale` is `section`, `page`, or `fluid`, defaulting to `page`. Section is compact, page is the normal workspace title, and fluid is a large opt-in identity treatment whose heading grows within fixed bounds.
- **Optional content:** `description` is absent or a plain string. It changes information density, not status or emphasis.
- **Layout integration:** `headingId` optionally connects the title to a surrounding region. Width, alignment, and outer spacing stay parent-owned.

There are no semantic tones and no persistent or transient visual states. Success, warning, error, selected, loading, disabled, and interactive states are inapplicable because a title does not change truth or operability by itself. There is no compact variant that silently deletes a provided description; callers choose whether the sentence is useful. Section scale reduces type size and description measure. Fluid enlarges the heading and slightly increases the description size and gap, but it preserves the same anatomy, reading order, semantics, color roles, and omission behavior.

`headingLevel={1}` with `scale="section"` is valid when a visually compact surface is still the document's top heading, and `headingLevel={2}` with `scale="fluid"` is valid when a visually prominent title is nested inside a larger document. Separating those axes prevents visual styling from corrupting accessibility semantics. Fluid is not an automatic mobile mode or a synonym for `h1`; callers opt into it only when the placement can afford the larger hierarchy.

## Visual system

The component uses the existing Slate palette as roles. The heading explicitly uses `--ink`; the optional description explicitly uses `--ink-secondary`; both explicitly use `--font-sans`. There are no color or font-family props. If those shared variables change globally, every Title Block follows automatically. If a parent changes only its local `color` or `font-family`, the Title Block does not inherit that arbitrary override. The title does not use `--accent`, because blue in this interface is more valuable for actions, links, focus, and deliberate emphasis.

The root wrapper is transparent. There is no component background, so the approved parent surface shows through. This keeps the title native on `--bg`, `--bg-raised`, or other approved Slate surfaces without stacking another card. The bordered specimen frames in the prototype are documentation scaffolding, not a `container` treatment or an implied surface prop.

Page scale starts from `--text-2xl` (28px) with a proposed 1.16 line height and slightly negative letter spacing for a compact, confident heading. Section scale starts from `--text-lg` (18px) with a 1.24 line height. Fluid uses the exact requested `font-size: clamp(34px, 4.2vw, 50px)`, a tighter 1.08 line height, and `-0.035em` tracking. This means it stays at 34px below roughly 810px, grows with viewport width through the middle range, and stops at 50px above roughly 1190px.

Descriptions use `--text-base` (14px) at page scale, `--text-sm` (13px) at section scale, and `--text-md` (15px) at fluid scale. The internal gap uses `--sp-2` (6px) for page, `--sp-1` (4px) for section, and `--sp-3` (8px) for fluid. The 34px and 50px bounds are provisional component measurements requested by the user; they are not new global tokens and do not authorize changing `App.css` at the prototype stage.

The description measure is capped near 68 characters at page scale, 62 at section scale, and 60 at fluid scale, while the component itself does not impose a fixed outer width. The fluid heading uses an 18-character measure on broad layouts to prevent a 50px sentence from stretching across the screen; that measure releases at narrow width. Both title and description use natural wrapping plus an emergency `overflow-wrap: anywhere` safeguard for unbroken identifiers. No ellipsis is allowed because truncating a title can hide the user's location.

Borders, radii, shadows, and elevation are absent from the component. The prototype's specimen frames are explicitly presentation scaffolding and are not part of V2. This distinction is important: a contained panel may compose the primitive, but Title Block V2 does not own that layer or gain card styling through a `surface` prop.

## Interaction and state journey

Title Block V2 is static and deliberately non-interactive. Resting is its only intrinsic state. Hover, focus-visible, pressed, selected, open, disabled, waiting, success, failure, recovery, and focus restoration are inapplicable because the primitive exposes no action, control, or changing status. It never enters the tab order and never attaches click or keyboard handlers.

If surrounding content loads, the parent keeps the known title stable and manages the loading surface below it. If the title itself genuinely cannot be known, the parent chooses truthful copy rather than asking this component to show a skeleton or spinner. Dynamic title changes caused by navigation are handled by the routing or page system; the component does not create a live region. Reduced-motion behavior is naturally satisfied because V2 adds no animation or transition.

## Responsive behavior

The component flexes with its parent and has no fixed outer width. At exactly 390px, page scale steps from `--text-2xl` to `--text-xl` (22px) while preserving title weight, readable line height, and the full text. Section remains 18px. Fluid resolves to its 34px minimum because `4.2vw` is smaller than the lower bound at that viewport. Its 18-character desktop measure releases to the available width so narrow layouts do not become an unnecessarily thin text column.

Long titles wrap at word boundaries and may use multiple lines. Unbroken text can break anywhere as a last resort, preventing horizontal page overflow. Descriptions are never silently truncated or removed at mobile width. The parent controls surrounding horizontal padding; the prototype uses a narrow fluid specimen to prove the primitive itself does not overflow. Localization may expand both strings, so no fixed height, line clamp, or reserved one-line geometry is permitted.

Because `vw` responds to the viewport rather than the component's own container, fluid is unsafe inside a narrow sidebar on a wide desktop: it could still resolve near 50px and wrap heavily. The contract therefore restricts fluid to broad identity-first placements. If real adoption later requires container-aware scaling, that is a material revision and should use a tested container-query formula rather than silently changing this approved behavior.

## Accessibility

The component renders a native heading element chosen by required `headingLevel`. Native headings expose structure to screen readers, browser navigation shortcuts, and other assistive tools without recreating semantics through ARIA. Visual `scale` remains independent, so callers can maintain a logical document outline even when a composition needs different visual weight.

The visible title is the accessible heading text. An optional `headingId` lets a parent landmark or section reference it through `aria-labelledby`; the component does not create a landmark itself. The description follows the heading in DOM order and remains ordinary text. It is not forced into `aria-describedby`, which could cause repeated announcements when reading the page normally. A future use with a specific assistive relationship should be justified at the parent composition level.

Color is not required to understand the component. Primary and secondary ink establish hierarchy alongside size, weight, position, and wording. The proposal must be checked on every approved Slate surface, with increased contrast and browser zoom, before production availability. There is no keyboard interaction, focus style, target size, announcement, or reduced-motion alternative to implement because there is no control or motion. Responsive wrapping, full text preservation, and the absence of fixed height protect zoom, localization, and large-text use.

## Content guidance

Titles name the current work area directly: “Operations workspace,” “Evidence review,” or “Recent decisions.” Use sentence case, concrete nouns, and the fewest words that preserve meaning. Fluid titles need stricter editorial judgment because every extra word consumes substantial vertical space; use them for short identity-first statements, not instructions or full-sentence claims. Do not repeat the same category in an eyebrow, title, and description. Do not end a title with punctuation unless the title is intentionally a question.

Descriptions are optional and should be one short sentence that prevents a likely uncertainty, clarifies scope, or states the immediate purpose. They should not narrate obvious controls, advertise the product, explain implementation, contain raw identifiers, or carry warnings and status. If the explanation needs multiple paragraphs, links, examples, or policy detail, it belongs in adjacent content or a disclosure rather than this primitive.

## Public API

The proposed API keeps document semantics, visual scale, optional information, and integration identity separate:

```tsx
type TitleBlockV2Props = {
  title: string;
  description?: string;
  headingLevel: 1 | 2 | 3;
  scale?: 'section' | 'page' | 'fluid';
  headingId?: string;
};
```

Minimal valid example:

```tsx
<TitleBlockV2
  headingLevel={1}
  title="Operations workspace"
/>
```

Full fluid composition example:

```tsx
<header aria-labelledby="operations-intelligence-title">
  <TitleBlockV2
    headingId="operations-intelligence-title"
    headingLevel={1}
    scale="fluid"
    title="Operational intelligence"
    description="Understand the current situation, preserve the evidence, and move the next decision forward."
  />
</header>
```

`title` and `headingLevel` are required. `scale` defaults to `page`; `description` and `headingId` are absent by default. `fluid` changes governed typography only—it does not add a surface, color, container, status, or interaction. Changing the allowed scales, formula or bounds, default scale, accepted heading levels, optional anatomy, or omission behavior is a material contract change requiring renewed approval. Ordinary parent composition remains compatible when it does not alter the primitive's internals.

The component deliberately excludes unrestricted `children`, `className`, `style`, raw color, color props, font-family props, arbitrary font size, padding, margin, surface, border, elevation, icon, eyebrow, badge, status, metadata, actions, links, `onClick`, polymorphic `as`, and `tone`. A wrapper owns layout placement. Excluding `className` and `style` in the first contract prevents an alternate theming API from silently replacing the governed Slate treatment. Theme changes flow through `--font-sans`, `--ink`, and `--ink-secondary`, not caller props or accidental parent inheritance.

## Invalid combinations and safeguards

The implementation contract must make misuse predictable rather than relying only on examples:

- An empty or whitespace-only `title` is rejected with a development error; the safe production fallback renders nothing rather than creating an unnamed heading.
- A whitespace-only `description` is ignored with a development warning, and the paragraph plus gap are omitted completely.
- An unsupported `headingLevel` is rejected in development; the production fallback clamps to `2` so invalid DOM such as `h0` or `h9` cannot appear.
- An unsupported `scale` warns in development and falls back to `page`, preserving the canonical visual contract.
- `scale="fluid"` always uses the governed 34px–50px clamp; callers cannot replace either bound or the `4.2vw` middle value through props.
- An empty or whitespace-only `headingId` is ignored with a development warning instead of emitting an unusable `id` attribute.
- A description longer than the content guidance warns in development but is not truncated; preserving meaning is safer than silently deleting text.
- React elements, badges, icons, buttons, and links cannot be inserted into `title` or `description` because both props accept strings only.
- Arbitrary visual styling is prohibited because `style`, `className`, raw color, and surface props are excluded from the public contract.
- Long localized or unbroken text must wrap; fixed heights, line clamps, and ellipsis are disallowed.
- Turning the root into a link or button is invalid. Navigation or action must be composed as a sibling with native semantics.

These safeguards distinguish strictness from fragility. The component prevents hierarchy-breaking inputs while preserving caller content when automatic correction would hide meaning.

## Relationship to neighboring components

Title Block V2 names one area and may explain its purpose. A plain semantic heading is preferable for local groups that do not need the shared title-description rhythm. A PageHeader is a parent composition that may arrange Title Block V2 with breadcrumbs, actions, or page-level layout. A SectionHeader may later compose the section scale with a dedicated action relationship if repeated evidence justifies it.

StatusIndicator communicates current state and proof vocabulary; it remains a sibling, not a title decoration. MetadataLine presents supporting facts and also remains outside. AccountIdentity or AgentIdentity names a domain object and may include avatar or provider identity; those are not generic title responsibilities. Breadcrumbs communicate navigation path. Keeping these boundaries separate prevents a title primitive from becoming a universal header panel.

## Do / don't guidance

Do:

- Use page scale for the primary identity of a page or workspace.
- Use section scale for a substantial subdivision with its own meaningful heading.
- Use fluid scale for a short identity-first title in a broad layout that has deliberately budgeted the extra vertical space.
- Keep the title direct and let one optional sentence resolve real uncertainty.
- Choose `headingLevel` from the document outline, not from the desired font size.
- Keep actions, status, metadata, breadcrumbs, and diagnostics in parent compositions.
- Allow long and localized copy to wrap naturally.

Don't:

- Add an eyebrow merely to repeat the sidebar or page category.
- Put the component in a decorative card just to make the title feel important.
- Use fluid inside a narrow desktop rail or on every routine operational page merely because it is visually impressive.
- Use description text as a warning, live status, policy dump, or implementation explanation.
- Insert icons, badges, counts, buttons, or links into the title line.
- Center ordinary operational page titles or turn them into marketing hero copy.
- Truncate a title or reserve empty space for omitted optional content.

## Acceptance criteria

- [x] The canonical prototype shows page scale with only the required title first.
- [x] Optional description appears as one subordinate sentence and leaves no gap when omitted.
- [x] Section, page, and fluid scales share one anatomy and remain visibly related.
- [x] Fluid uses the exact `clamp(34px, 4.2vw, 50px)` formula and stays within those bounds.
- [x] Fluid renders at 50px on the desktop evidence viewport and 34px at exactly 390px.
- [x] Heading level and visual scale remain separate API axes in the proposed contract.
- [x] Title and description use shared Slate font and ink variables with no color or font-family props.
- [x] The primitive adds no background, border, radius, elevation, accent rule, or icon.
- [x] Specimen presentation frames are visibly distinguishable from component surfaces.
- [x] Exactly 390px rendering has no horizontal overflow.
- [x] Long titles and descriptions wrap without ellipsis or clipping.
- [x] The prototype is static and never enters the keyboard tab order.
- [x] Prototype headings use native heading semantics matching the proposed structure.
- [ ] Optional `headingId` can label a surrounding region without creating a landmark.
- [x] Color is not the only hierarchy signal.
- [x] Reduced motion requires no alternate visual behavior because the prototype has zero animations.
- [x] Empty required content and invalid runtime values have deterministic proposed safeguards.
- [x] `style`, `className`, arbitrary children, polymorphism, actions, and raw visual props are excluded from the proposed API.
- [x] Original-resolution desktop and 390px images match the written anatomy and measurements.
- [x] The explanation validator reports `STRUCTURE PASS`.
- [x] Production implementation remains unstarted until the user explicitly approves this direction.
- [ ] Future production rendering is reconciled against the approved bitmap before `available` status.

## Independent critique

The clearest tradeoff is that disciplined typography can feel almost too quiet when viewed in a component-only artboard. Fluid answers part of that concern without adding decoration, but it can also become a new form of excess: a 50px title can push the working surface down just as surely as a large card. The correction is strict placement guidance—fluid is opt-in for identity-first moments, while page remains the operational default—not making the larger treatment available everywhere by convention.

The exact `4.2vw` formula is simple and easy to explain, but it is fluid only through a middle viewport band and responds to the browser width rather than the component's container. On a wide screen with a narrow content column it may resolve to 50px and wrap more than expected. That is a real limitation, not a rendering bug. The prototype accepts it because it is the user's requested behavior and visibly stress-tests wrapping; container-aware scaling would require a separately approved contract change.

The next risk is API strictness. String-only title and description props prevent badges, inline links, emphasized spans, and other hierarchy drift, but they also reject legitimate rich text such as a product name with special formatting. That cost is acceptable in v2 because operational titles should remain plain and scannable. If real consumers later prove a recurring need, the contract should add one narrowly named semantic capability instead of opening unrestricted children.

There is also a tension between explicit `headingLevel` and ease of use. Requiring it adds one prop to every call, yet a silent default could create multiple `h1` elements or flatten section structure. The proposal chooses correctness and visible caller intent. A higher-level PageHeader composition may later supply the page-level default safely because it owns the surrounding document structure.

## Decision summary

The canonical proposal remains a transparent, text-only, page-scale title using shared Slate typography and ink, with no surface or decoration. The only optional visible piece is one plain description sentence. The governed scales are `section`, `page`, and the new opt-in `fluid`; heading semantics, visual scale, optional content, and integration ID remain separate axes.

Fluid uses the exact `clamp(34px, 4.2vw, 50px)` heading size, resolves to 34px at 390px and 50px on the desktop evidence viewport, and is restricted to broad identity-first placements. V2 deliberately excludes color and font-family props, icons, eyebrows, breadcrumbs, status, metadata, actions, navigation, surfaces, arbitrary styling, data behavior, and motion. Global theme changes flow through `--font-sans`, `--ink`, and `--ink-secondary`. Production implementation is not authorized yet.

This result improves substantively on the Button quality-floor example by separating document semantics from visual scale as a first-class governed axis, defining structural erasure as a verifiable contract, and documenting the exact responsive mathematics and container-width limitation of the fluid scale rather than presenting a large screenshot as sufficient evidence. The improvement is component-specific, not additional variants or word count.

## One-sentence definition

Title Block V2 is a static, typography-led heading primitive that names the current work area and optionally explains its purpose without absorbing decoration, status, navigation, or action behavior.
