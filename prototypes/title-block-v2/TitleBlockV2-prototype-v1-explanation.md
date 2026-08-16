# Title Block V2 — Component Design Explanation

Component type: `primitive`

## Component definition

Title Block V2 is a static primitive that tells the user what area of work they are looking at and, when needed, gives one short sentence of purpose without turning orientation into a decorative banner. It is appropriate at the start of a page or a meaningful subsection where a consistent heading-and-description relationship improves scanning. It is not justified for every small card, table group, or control cluster; ordinary semantic headings remain the better choice when no reusable spacing or responsive contract is needed.

The single question it answers is: **“What work area is this, and what is it for?”** A plain heading cannot by itself govern the relationship to optional explanatory text, visual scale independent of document outline, omission spacing, long-title wrapping, and a consistent first-viewport budget. This primitive does those jobs while remaining deliberately text-led.

## Evidence and design determination

The proposal is independent by design. The current Title Block implementation, its usages, and its documentation specimen were not inspected because the user explicitly asked for a fresh direction without that component's influence. The required design foundation did contain a brief catalog mention of the older component; that mention was treated as excluded evidence and did not determine the V2 anatomy or API.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| The user requested “Title Block V2” and explicitly prohibited inspecting the existing component's functionality. | The proposal must stand on first principles and current global design evidence rather than preserving accidental legacy anatomy. | Use a text-led, independently defined primitive and document the old implementation, consumers, and specimen as uninspected. | Reviewing the old component first would reduce migration risk, but it would violate the requested method and bias the new direction toward inherited choices. |
| `DESIGN.md:14-15` requires the Slate system and says hierarchy should match value. | A title needs clear typographic priority, but it should not gain visual weight from an ornamental card, glow, or semantic color. | Make typography, spacing, and readable ink carry hierarchy; keep the component surface transparent. | A raised panel with blue edge treatment would look more distinctive in isolation but would overstate routine orientation and consume first-viewport space. |
| `DESIGN.md:289-304` limits ordinary page headers and rejects repeating the same concept across eyebrow, title, subtitle, and card title. | The component must stay short and must not create duplicate context labels. | Require one title, allow one concise description, and exclude eyebrow, breadcrumb, badge, metadata, and repeated category copy. | A flexible header with kicker, subtitle, metadata, and trailing badge would cover more screenshots but would institutionalize duplication and cognitive load. |
| `DESIGN.md:335-342` asks for a direct page title, one short sentence only when needed, and no decorative source-of-truth eyebrow copy. | Optional explanation must disappear completely when it does not resolve uncertainty. | The canonical default is title-only; description is a plain optional string with no reserved gap when absent. | Making the description required would produce consistent geometry but force filler copy onto self-explanatory screens. |
| `client/src/App.css:30-57` defines the Inter/system font stack, dark Slate surfaces, primary and secondary ink, subtle lines, and blue accent. | The primitive should inherit the existing voice and avoid a private theme. | Use `--font-sans`, `--ink`, and `--ink-secondary`; do not use accent color inside the canonical component because the title is not an action or status. | A blue title or accent rule would create instant recognition, but it would spend the action color on static orientation and could compete with the page's real primary action. |
| `client/src/App.css:142-165` defines the typography, spacing, and radius scales used by Slate. | Measurements can be token-connected instead of arbitrary, while final browser rendering remains the authority. | Propose `--text-2xl` for page scale, `--text-lg` for section scale, `--text-base`/`--text-sm` for descriptions, and `--sp-1`/`--sp-2` for internal rhythm. | Inventing a 32px hero title and bespoke 10px gap might look polished on the artboard but would fork the system and weaken density. |
| `docs/research/apple-design-systems/apple-design-systems-research.md:234-256` describes hierarchy through clear roles and typography as infrastructure for legibility, hierarchy, accessibility, and product voice. | The most durable title treatment is a semantic text relationship, not a material effect. | Separate heading semantics from visual scale and rely on type weight, size, line height, and controlled measure. | A glass-like or elevated header treatment would imitate a visible style while ignoring the deeper hierarchy and adaptation principles. |
| `.agents/skills/design-system-component/references/component-workflow-contract.md:31-43` requires one user question, stable meaning, required anatomy, structural omission, semantic variants, isolation, and external side effects. | Reuse is justified only if the object stays smaller than the page header composition around it. | Classify V2 as a static primitive with one required title, one optional description, two semantic scales, and no behavior or side effects. | A PageHeader composition with actions, status, and navigation would answer several questions at once and fail the primitive candidacy test. |

The central determination is that Title Block V2 should be governed by **what it refuses to absorb**. It establishes identity and purpose only. This avoids the common drift where every page header becomes a unique mix of badges, actions, breadcrumbs, timestamps, and decorative containers.

## Component boundary

Title Block V2 owns the semantic heading element, the title's typography, optional description typography, the gap between those two lines, token-based page and section scales, natural wrapping, and structural removal of optional content. It also owns a safe heading-level mapping and an optional heading ID so a surrounding landmark can be labelled correctly.

The parent page or feature owns placement, available width, page-level margins, heading-outline choice, actions, navigation, breadcrumbs, status, metadata, loading, retry, data fetching, persistence, analytics, and any region that uses the title through `aria-labelledby`. The parent also owns whether a description is useful. A workflow owns success, failure, warnings, and announcements; this static primitive does not infer or display them.

The component does not become clickable when a page wants navigation, and it does not accept arbitrary trailing content. A parent PageHeader may place Title Block V2 beside an action group or below breadcrumbs, but those siblings remain outside the primitive so its meaning stays stable across QBO work, Investments, Knowledge, agents, and future operational domains.

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
- **Visual scale:** `scale` is `page` or `section`, defaulting to `page`. Page uses the stronger title scale; section uses a compact scale for major subdivisions.
- **Optional content:** `description` is absent or a plain string. It changes information density, not status or emphasis.
- **Layout integration:** `headingId` optionally connects the title to a surrounding region. Width, alignment, and outer spacing stay parent-owned.

There are no semantic tones and no persistent or transient visual states. Success, warning, error, selected, loading, disabled, and interactive states are inapplicable because a title does not change truth or operability by itself. There is no compact variant that silently deletes a provided description; callers choose whether the sentence is useful. Section scale reduces type size and description measure but preserves the same anatomy and reading order.

`headingLevel={1}` with `scale="section"` is valid when a visually compact surface is still the document's top heading, and `headingLevel={2}` with `scale="page"` is valid inside a composed document shell. Separating those axes prevents visual styling from corrupting accessibility semantics.

## Visual system

The component uses the existing Slate palette as roles. The heading uses `--ink`; the optional description uses `--ink-secondary`. The title does not use `--accent`, because blue in this interface is more valuable for actions, links, focus, and deliberate emphasis. There is no component background; the parent surface shows through. That keeps the title native on `--bg`, `--bg-raised`, or other approved Slate surfaces without stacking another card.

Page scale starts from `--text-2xl` (28px) with a proposed 1.16 line height and slightly negative letter spacing for a compact, confident heading. Section scale starts from `--text-lg` (18px) with a 1.24 line height. Descriptions use `--text-base` (14px) at page scale and `--text-sm` (13px) at section scale. The internal gap uses `--sp-2` (6px) for page scale and `--sp-1` (4px) for section scale. These values remain provisional until production rendering confirms the actual font metrics.

The description measure is capped near 68 characters at page scale and 62 at section scale, while the component itself does not impose a fixed width. This keeps explanatory prose readable without making the title column artificially narrow. Both title and description use natural wrapping plus an emergency `overflow-wrap: anywhere` safeguard for unbroken identifiers. No ellipsis is allowed because truncating a title can hide the user's location.

Borders, radii, shadows, and elevation are absent from the component. The prototype's specimen frames are explicitly presentation scaffolding and are not part of V2. This distinction is important: a contained panel may compose the primitive, but Title Block V2 does not own that layer or gain card styling through a `surface` prop.

## Interaction and state journey

Title Block V2 is static and deliberately non-interactive. Resting is its only intrinsic state. Hover, focus-visible, pressed, selected, open, disabled, waiting, success, failure, recovery, and focus restoration are inapplicable because the primitive exposes no action, control, or changing status. It never enters the tab order and never attaches click or keyboard handlers.

If surrounding content loads, the parent keeps the known title stable and manages the loading surface below it. If the title itself genuinely cannot be known, the parent chooses truthful copy rather than asking this component to show a skeleton or spinner. Dynamic title changes caused by navigation are handled by the routing or page system; the component does not create a live region. Reduced-motion behavior is naturally satisfied because V2 adds no animation or transition.

## Responsive behavior

The component flexes with its parent and has no fixed width. At exactly 390px, page scale steps from `--text-2xl` to `--text-xl` (22px) while preserving title weight, readable line height, and the full text. The description remains 14px and wraps naturally. Section scale remains 18px unless rendered validation shows an actual collision; shrinking it further would weaken readability for little space gain.

Long titles wrap at word boundaries and may use multiple lines. Unbroken text can break anywhere as a last resort, preventing horizontal page overflow. Descriptions are never silently truncated or removed at mobile width. The parent controls surrounding horizontal padding; the prototype uses a narrow container to prove the primitive itself does not overflow. Localization may expand both strings, so no fixed height, line clamp, or reserved one-line geometry is permitted.

## Accessibility

The component renders a native heading element chosen by required `headingLevel`. Native headings expose structure to screen readers, browser navigation shortcuts, and other assistive tools without recreating semantics through ARIA. Visual `scale` remains independent, so callers can maintain a logical document outline even when a composition needs different visual weight.

The visible title is the accessible heading text. An optional `headingId` lets a parent landmark or section reference it through `aria-labelledby`; the component does not create a landmark itself. The description follows the heading in DOM order and remains ordinary text. It is not forced into `aria-describedby`, which could cause repeated announcements when reading the page normally. A future use with a specific assistive relationship should be justified at the parent composition level.

Color is not required to understand the component. Primary and secondary ink establish hierarchy alongside size, weight, position, and wording. The proposal must be checked on every approved Slate surface, with increased contrast and browser zoom, before production availability. There is no keyboard interaction, focus style, target size, announcement, or reduced-motion alternative to implement because there is no control or motion. Responsive wrapping, full text preservation, and the absence of fixed height protect zoom, localization, and large-text use.

## Content guidance

Titles name the current work area directly: “Operations workspace,” “Evidence review,” or “Recent decisions.” Use sentence case, concrete nouns, and the fewest words that preserve meaning. Do not repeat the same category in an eyebrow, title, and description. Do not end a title with punctuation unless the title is intentionally a question.

Descriptions are optional and should be one short sentence that prevents a likely uncertainty, clarifies scope, or states the immediate purpose. They should not narrate obvious controls, advertise the product, explain implementation, contain raw identifiers, or carry warnings and status. If the explanation needs multiple paragraphs, links, examples, or policy detail, it belongs in adjacent content or a disclosure rather than this primitive.

## Public API

The proposed API keeps document semantics, visual scale, optional information, and integration identity separate:

```tsx
type TitleBlockV2Props = {
  title: string;
  description?: string;
  headingLevel: 1 | 2 | 3;
  scale?: 'page' | 'section';
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

Full composition example:

```tsx
<section aria-labelledby="evidence-review-title">
  <TitleBlockV2
    headingId="evidence-review-title"
    headingLevel={2}
    scale="section"
    title="Evidence review"
    description="Compare source quality, resolve conflicts, and preserve the reasoning behind the next decision."
  />
  <EvidenceWorkspace />
</section>
```

`title` and `headingLevel` are required. `scale` defaults to `page`; `description` and `headingId` are absent by default. Changing the allowed scales, default scale, accepted heading levels, optional anatomy, or omission behavior is a material contract change requiring renewed approval. Ordinary parent composition remains compatible when it does not alter the primitive's internals.

The component deliberately excludes unrestricted `children`, `className`, `style`, raw color, arbitrary font size, padding, margin, surface, border, elevation, icon, eyebrow, badge, status, metadata, actions, links, `onClick`, polymorphic `as`, and `tone`. A wrapper owns layout placement. Excluding `className` and `style` in the first contract prevents an alternate theming API from silently replacing the governed Slate treatment.

## Invalid combinations and safeguards

The implementation contract must make misuse predictable rather than relying only on examples:

- An empty or whitespace-only `title` is rejected with a development error; the safe production fallback renders nothing rather than creating an unnamed heading.
- A whitespace-only `description` is ignored with a development warning, and the paragraph plus gap are omitted completely.
- An unsupported `headingLevel` is rejected in development; the production fallback clamps to `2` so invalid DOM such as `h0` or `h9` cannot appear.
- An unsupported `scale` warns in development and falls back to `page`, preserving the canonical visual contract.
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
- Keep the title direct and let one optional sentence resolve real uncertainty.
- Choose `headingLevel` from the document outline, not from the desired font size.
- Keep actions, status, metadata, breadcrumbs, and diagnostics in parent compositions.
- Allow long and localized copy to wrap naturally.

Don't:

- Add an eyebrow merely to repeat the sidebar or page category.
- Put the component in a decorative card just to make the title feel important.
- use description text as a warning, live status, policy dump, or implementation explanation.
- Insert icons, badges, counts, buttons, or links into the title line.
- Center ordinary operational page titles or turn them into marketing hero copy.
- truncate a title or reserve empty space for omitted optional content.

## Acceptance criteria

- [x] The canonical prototype shows page scale with only the required title first.
- [x] Optional description appears as one subordinate sentence and leaves no gap when omitted.
- [x] Page and section scales share one anatomy and remain visibly related.
- [x] Heading level and visual scale remain separate API axes in the proposed contract.
- [x] Title and description use current Slate type, ink, and spacing tokens.
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

The clearest tradeoff is that disciplined typography can feel almost too quiet when viewed in a component-only artboard. A card, icon well, accent rail, or eyebrow would make the proposal more visually memorable, but each also adds a signal that does not answer the component's user question. The risk is not lack of styling; it is that feature teams may later wrap V2 inconsistently to recover visual distinction. The correction path is to govern parent PageHeader compositions when repeated needs appear, not to pre-load this primitive with decoration.

The second risk is API strictness. String-only title and description props prevent badges, inline links, emphasized spans, and other hierarchy drift, but they also reject legitimate rich text such as a product name with special formatting. That cost is acceptable in v1 because operational titles should remain plain and scannable. If real consumers later prove a recurring need, the contract should add one narrowly named semantic capability instead of opening unrestricted children.

There is also a tension between explicit `headingLevel` and ease of use. Requiring it adds one prop to every call, yet a silent default could create multiple `h1` elements or flatten section structure. The proposal chooses correctness and visible caller intent. A higher-level PageHeader composition may later supply the page-level default safely because it owns the surrounding document structure.

## Decision summary

The canonical proposal is a transparent, text-only, page-scale title using current Slate typography and ink, with no surface or decoration. The only optional visible piece is one plain description sentence. The only visual variant is `section` scale; heading semantics, visual scale, optional content, and integration ID remain separate axes.

V2 deliberately excludes icons, eyebrows, breadcrumbs, status, metadata, actions, navigation, surfaces, arbitrary styling, data behavior, and motion. The open approval decision is whether this strict, typography-led direction is the right foundation or whether one additional identity cue genuinely earns a place. Production implementation is not authorized yet.

This result improves substantively on the Button quality-floor example by separating document semantics from visual scale as a first-class governed axis and by defining structural erasure as a verifiable contract: omitted copy removes both markup and space, while narrow-width evidence proves full content survives. The improvement is component-specific, not additional variants or word count.

## One-sentence definition

Title Block V2 is a static, typography-led heading primitive that names the current work area and optionally explains its purpose without absorbing decoration, status, navigation, or action behavior.
