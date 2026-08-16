# StatusIndicator — Component Design Explanation

Component type: `primitive`

> This source-adjacent document is the complete explanation for the current StatusIndicator contract. The polished live teaching page is `/docs/components/status-indicator`; the concise registry is `docs/design-system/COMPONENT_LIBRARY.md`. Those surfaces and the implementation must remain synchronized.

## Component definition

StatusIndicator is a non-interactive semantic state primitive that pairs a short visible label with a non-color symbol and an approved tone. It answers “what state is this in?” without explaining the cause, showing evidence, offering recovery, or pretending that a status is an action.

Use it when one short state phrase is enough for the user to classify a nearby object during a scan. If the user also needs a cause, timestamp, progress amount, evidence, or recovery action, compose those as siblings or choose a richer status summary. The nearest failure mode is a badge-shaped mini panel that gradually accumulates descriptions and controls; that object stops being a reliable state marker and needs its own contract.

## Evidence and design determination

The QBO Escalations interface repeatedly needs connected, delayed, attention, unavailable, failed, syncing, and unknown states. `DESIGN.md` requires state to remain readable through wording and shape, not color alone, while the operational density rules reject large badges. The resulting contract uses a restrained inline default and a contained option. The rejected alternatives were colored dots without text, which are inaccessible and ambiguous, and a business-specific provider badge, which would not generalize.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| `client/src/components/design-system/StatusIndicator/StatusIndicator.jsx:4-13` maps each governed state to label, tone, and symbol. | State meaning can be stable and non-color-dependent without caller-specific styling. | Preserve the governed vocabulary and derive tone/symbol from state. | Letting every caller choose arbitrary label, color, and icon would make the same state look different across features. |
| `client/src/components/design-system/StatusIndicator/StatusIndicator.jsx:15-18` separates size, appearance, announcement, and tone sets. | Density, visual grouping, live behavior, and semantic meaning are different axes. | Keep `regular`/`compact`, `inline`/`contained`, and `off`/`polite`/`assertive` independent. | One flat `variant` prop would combine unrelated choices and grow unpredictably. |
| `client/src/components/design-system/StatusIndicator/StatusIndicator.jsx:29-55` gives every canonical state a distinct line icon. | Color cannot be the only state cue. | Pair short visible wording with a stable currentColor symbol. | A green, orange, or red dot alone would be ambiguous in grayscale and meaningless without a legend. |
| `client/src/components/design-system/StatusIndicator/StatusIndicator.jsx:89-111` keeps the root static and makes live-region behavior explicit. | Status reporting and announcing are related but not interchangeable. | Remain non-interactive and default announcements off; opt in only from the parent. | Making every mounting indicator a live region would cause repeated dashboard chatter and false urgency. |
| `docs/design-system/COMPONENT_LIBRARY.md:349-370` defines one truthful state and rejects description/action expansion. | The small boundary is essential to reuse across providers, agents, investments, and workspace tools. | Keep explanation, evidence, timestamps, diagnostics, and recovery outside the primitive. | A universal StatusCard would make ordinary inline states heavy and bind layout to one feature pattern. |

The decisive separation is state versus presentation versus announcement. `connected` is evidence-backed meaning; `contained` is visual grouping; `polite` is assistive behavior. None should silently select the others. That architecture prevents a status from becoming louder merely because it is placed in a container or from interrupting a screen reader merely because it changed color.

## Component boundary

StatusIndicator owns the state label, symbol, tone, density, optional container, and deliberate live-announcement mode. The parent owns timestamps, explanations, diagnostics, retry actions, links, permission decisions, state derivation, and whether a change is important enough to announce.

The primitive never checks a connection, calculates freshness, polls, retries, or translates provider payloads into a state. It does not know whether “Connected” is true; the feature must supply that state only when its current evidence justifies the claim. A surrounding clickable row may include the indicator, but the row owns button/link semantics and complete interaction feedback. The indicator itself remains informational.

## Anatomy

```text
StatusIndicator
├─ semantic symbol       always present, decorative to AT
└─ visible label         always present, accessible name
```

The symbol and label form one inseparable state expression. Both are required in every rendered status, while contained background and live-region attributes are conditional. Custom state still requires explicit wording; custom icon decoration cannot become the only meaning. The root remains a `span`, so the indicator fits inline without creating another layout region.

The canonical icon wrapper always has the same optical slot. A supplied custom icon replaces only the glyph inside that slot; it does not change geometry or add an icon well. The visible label provides the accessible name, while the symbol is hidden from assistive technology to prevent redundant “check Connected” announcements.

## Core design thesis

State should be recognizable in a fast scan and understandable without color. Each governed state therefore combines a stable word, a distinct symbol family, and a semantic tone. Visual restraint keeps the indicator subordinate to the object whose state it describes.

Truth is the first design material. A green connected treatment is not encouragement or decoration; it is a claim that the parent has current evidence. Unknown and unavailable remain neutral rather than borrowing failure red, while delayed and attention share warning tone but use different wording and symbols to communicate distinct conditions. The component is successful when its meaning survives grayscale and its shape remains quiet enough to sit beside primary work.

## Canonical default

The default is `state="neutral"`, `size="regular"`, `appearance="inline"`, and `announce="off"`, rendering “Status unknown.” Unknown is safer than inventing health. Inline is safer than automatically creating another rounded container inside cards, rows, and headers.

Regular density makes the status comfortably legible in ordinary application surfaces. The default does not reserve space for a description, timestamp, or action, and it has no background, border, shadow, or live-region role. A bare `<StatusIndicator />` is therefore truthful even before the parent has evidence. Connected, failed, or another stronger claim requires an explicit state from the feature.

## Variant, state, and size architecture

Governed states are `neutral`, `connected`, `delayed`, `attention`, `unavailable`, `failed`, `syncing`, and `custom`. Regular and compact sizes change density only. Inline and contained appearances change grouping, not semantic importance. `announce` is an accessibility behavior with `off`, `polite`, and `assertive`; it is not a visual state.

Canonical states own their label, tone, and symbol mapping. A caller may override the short visible label for scoped wording, but cannot recolor `connected` as danger or `failed` as success. `custom` is the deliberate extension point: it requires explicit wording and may select one approved tone when the recurring state vocabulary is not yet sufficient.

Compact never hides the label, and contained never makes the indicator interactive or more semantically urgent. Announcement choice also remains independent: a failed state may appear without interruption in a summary, while a user-triggered failure may be announced assertively by the parent. Selected, disabled, expanded, pressed, and loading are inapplicable. `syncing` is a status state that may animate its symbol; it is not an action-loading Button.

## Visual system

Neutral, info, success, warning, and danger tones map to Slate semantic tokens. Symbols use consistent stroke, optical size, and currentColor. Contained appearance adds a subtle surface and boundary without becoming a pill-like action. Sync motion is purposeful and removed under reduced motion.

The CSS consumes `--ink-secondary`, `--line`, `--bg-raised`, `--neutral`, `--info`, `--success`, `--warning`, `--danger`, and their subtle semantic surfaces. Regular and compact use shared text and spacing relationships rather than independent raw sizes. The symbol and label share currentColor so their meaning stays unified, while the contained boundary uses a lower-contrast token than the text.

The silhouette is compact but not a novelty pill. Inline has no owned surface. Contained adds just enough tinted background and border to separate status from a visually busy parent; it does not introduce shadow, glow, gradient, or an icon tile. Symbols use a consistent 24-unit viewBox and normalized stroke cap/weight so a warning triangle does not overpower a neutral circle.

Sync rotation is the only continuous motion because it communicates ongoing state. It uses the shared motion duration/easing relationship and becomes a static sync shape under `prefers-reduced-motion`. No state pulses, bounces, glows, or animates into view.

## Interaction and state journey

StatusIndicator has no pointer, keyboard, hover, pressed, selected, or disabled behavior. A parent updates `state` when evidence changes. Syncing can move while work is active; connected, failed, or another completed state appears when the parent knows the outcome. The indicator never starts work, retries it, or infers success from elapsed time.

Interaction states are inapplicable because the primitive exposes no user-operated control. If a user activates a neighboring retry Button, the parent may change the indicator to syncing, then to connected or failed when evidence arrives. The parent also decides whether that journey warrants an announcement, where focus remains, and how failure recovery is explained. StatusIndicator only renders the supplied truth at each point.

## Responsive behavior

The indicator remains content-width and keeps symbol plus label together. It may wrap only as a unit inside a constrained composition; labels should be short enough to avoid truncation. Compact density is selected by the parent, not automatically based on viewport width.

At exactly 390px, the icon and label remain a single scan target and contained padding stays proportional. The component does not silently abbreviate labels or switch state wording. Long custom labels wrap rather than ellipsize, but a sentence-length label is a content defect and should move into a StatusSummary. Logical inline spacing supports right-to-left flow without a separate component variant.

## Accessibility

Visible text carries meaning; symbols are `aria-hidden`. Announcement is off by default to prevent repeated status chatter in updating dashboards. `polite` maps to a status live region and `assertive` to an alert only when the feature has evidence that interruption is necessary. Color contrast, forced colors, zoom, and reduced motion are part of acceptance.

`aria-atomic="true"` ensures an opted-in announcement presents the complete short state rather than only the changed word. A custom icon must not carry its own exposed accessible name because the visible label already names the state. The root creates no tab stop, and the parent must not add click handlers to make status appear actionable without a separate control contract.

Success, warning, danger, info, neutral text, contained borders, and focus of surrounding controls must be tested on every approved Slate surface. Forced-colors mode must preserve the symbol/label relationship even when semantic hues collapse. Reduced motion removes sync rotation without removing the sync icon or wording. Browser zoom and text enlargement may wrap the indicator but cannot hide its label.

## Content guidance

Prefer short states such as “Connected,” “Delayed,” or “Needs attention.” Put causes and remedies nearby in prose. Custom labels should describe a state, not an action or sentence. Avoid “Good,” “Bad,” unexplained acronyms, timestamps, and wording that claims certainty the parent does not have.

Use scoped labels such as “Mail connected” only when several statuses need differentiation and the nearby identity does not already supply it. Do not use “Click to reconnect,” “Retry,” or “Open settings” as status wording; those are actions. Do not append progress percentages, timestamps, provider errors, or permission instructions inside the label. If the state cannot be expressed as one concise phrase, choose a richer composition.

## Public API

```jsx
<StatusIndicator state="syncing" announce="polite" />
```

The concrete contract is:

```tsx
type StatusState = 'neutral' | 'connected' | 'delayed' | 'attention' | 'unavailable' | 'failed' | 'syncing' | 'custom';
type StatusIndicatorProps = {
  state?: StatusState;
  label?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
  size?: 'regular' | 'compact';
  appearance?: 'inline' | 'contained';
  announce?: 'off' | 'polite' | 'assertive';
};
```

Minimal valid example:

```jsx
<StatusIndicator state="connected" />
```

Full example:

```jsx
<StatusIndicator
  state="custom"
  label="Awaiting verification"
  tone="info"
  icon={<VerificationIcon />}
  size="compact"
  appearance="contained"
  announce="polite"
  aria-label="Workspace status"
/>
```

Controlled props are `state`, `label`, `tone`, `icon`, `size`, `appearance`, and `announce`, plus safe identifiers and ARIA/data attributes. `tone` is honored only for `state="custom"`; governed states retain their approved tone-to-meaning mapping. The ref targets the root for legitimate parent measurement or relationships. Description, timestamp, action, href, click behavior, progress value, tooltip, per-state raw colors, padding, radius, and shadow props are excluded. Existing `className` and `style` remain compatibility escape hatches for placement, not an alternate state styling system. Recurring exceptions require evidence and a material contract review.

## Invalid combinations and safeguards

Unknown states fall back to neutral and warn. Custom without a label warns and uses “Status unknown.” Unsupported size, appearance, announcement, or custom tone falls back safely. A caller cannot recolor a governed state through `tone`. Unsafe DOM props are filtered. Announcement remains opt-in.

- Unknown state strings use the neutral model and a development warning, preventing an unrecognized value from masquerading as success.
- Custom state without visible wording warns and falls back to “Status unknown,” preventing a color/icon-only status.
- Unsupported size, appearance, announcement, and tone values use deterministic safe defaults rather than leaking raw class names.
- Tone is ignored for canonical states, preventing callers from assigning contradictory semantic color to governed meaning.
- Announcement defaults off and only adds `role`, `aria-live`, and `aria-atomic` when explicitly requested, preventing dashboard chatter.
- Unsafe DOM behavior is filtered so click handlers, hrefs, and arbitrary roles cannot make the static primitive interactive accidentally.
- Missing custom icon still receives the neutral canonical symbol, preserving the non-color cue and stable anatomy.

## Relationship to neighboring components

MetadataLine presents supporting facts, HealthBanner explains a larger operational condition, Button initiates recovery, ProgressIndicator communicates quantitative or extended work, and Toast announces transient events. StatusIndicator may be composed beside them but does not replace them.

A future StatusSummary owns a state plus one explanatory sentence and perhaps a scoped action. A connection panel may compose identity, StatusIndicator, MetadataLine, explanation, and Button as siblings. A badge represents classification or count rather than operational evidence. These distinctions prevent the visual convenience of a colored label from flattening several different user questions into one component.

## Do / don't guidance

Do:

- Use one short, evidence-backed state phrase.
- Preserve both visible wording and a distinct symbol.
- Let the parent derive state from current evidence.
- Choose compact or contained only for placement needs.
- Opt into polite or assertive announcements deliberately.

Don't:

- Use color, a dot, or an icon as the only meaning.
- Place descriptions, timestamps, progress, links, or actions inside the indicator.
- Make the primitive clickable or focusable.
- Use custom tone to override a governed state's meaning.
- Claim Connected, Success, or Healthy from stale or absent evidence.

## Acceptance criteria

- [ ] The component answers only what state the nearby object is in.
- [ ] Every governed state has stable wording, symbol, and tone.
- [ ] Connected and other success claims require parent-supplied evidence.
- [ ] Meaning survives grayscale and loss of semantic hue.
- [ ] Symbols are decorative and visible text remains complete.
- [ ] Inline and contained treatments remain non-interactive.
- [ ] Compact changes density without hiding the label.
- [ ] Custom requires explicit wording and only approved tones.
- [ ] Unknown inputs fall back to neutral with a development warning.
- [ ] Canonical states cannot be recolored through `tone`.
- [ ] Live announcements occur only when explicitly requested.
- [ ] Polite and assertive modes expose complete atomic wording.
- [ ] Sync motion communicates work and respects reduced motion.
- [ ] Exactly 390px has no truncation or horizontal overflow.
- [ ] Forced colors, browser zoom, and text enlargement preserve meaning.
- [ ] The component creates no action, tab stop, request, or retry.
- [ ] Parent-owned explanation and recovery remain outside the primitive.
- [ ] Implementation, explanation, registry, live docs, tests, and rendered evidence agree.

## Independent critique

A fixed state vocabulary improves consistency but can tempt features to map nuanced truth into the nearest label. Custom exists for real gaps, yet too much custom use would dissolve the system. New recurring states should be promoted only with evidence across features. The first release also accepts `className` and `style`; those compatibility escape hatches deserve later consumer review.

Contained appearance is another genuine tradeoff. It helps a small status remain legible on busy surfaces, but it can begin to look like a badge or action when overused. Inline therefore remains canonical, and contained must not gain hover, chevrons, elevation, or pointer treatment. A richer visual presence should usually signal that the component boundary has changed.

Opt-in live announcements place a consequential decision in a small prop. That flexibility is necessary because the primitive cannot know whether a state change followed a user action or occurred in a background dashboard, but misuse can interrupt users repeatedly. Feature tests and review must validate announcement frequency and urgency; the component can provide safe mechanics but cannot infer the correct product policy.

## Decision summary

StatusIndicator is a compact, non-interactive, text-plus-symbol status expression with governed operational states, restrained semantic tones, two densities, two appearances, and opt-in announcement behavior. It excludes state derivation, explanation, history, actions, and recovery.

The canonical form is regular, inline, neutral, and silent, rendering “Status unknown” until the parent supplies evidence. State controls meaning, appearance controls grouping, size controls density, and announcement controls assistive behavior. Those axes remain independent. Custom exists as a governed gap valve, not a shortcut around the canonical vocabulary or semantic tone mapping.

## One-sentence definition

StatusIndicator is a quiet text-and-symbol primitive that communicates one parent-supplied state without relying on color, inventing evidence, or becoming an action.
