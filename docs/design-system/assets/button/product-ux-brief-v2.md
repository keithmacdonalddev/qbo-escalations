# Button documentation — Product/UX brief v2

**Design impact:** Major

**Direction:** Replaces the rejected first documentation layout. The user supplied the 24-page `Button Component Design Specification` PDF as the visual and information-architecture benchmark.

## User goal

Understand what Button is immediately, recognize its essential treatments and sizes visually, and only then enter the complete design specification. The page must feel like a designed component specification rather than a database of component facts.

## Required progression

The reference succeeds because it stages cognitive load. The routed page must preserve this sequence:

1. **Identity — Button.** Show only `COMPONENT DESIGN SPECIFICATION`, the `Button` title, one compressed sentence, and one excellent live production specimen. Do not show breadcrumbs, status, facts, import paths, code, navigation, or a second specimen inside the content area.
2. **Visual family — Button at a glance.** Show primary, secondary, loading, disabled, destructive, and small/medium/large as live production specimens with short labels and almost no prose.
3. **Reference — Specification map.** Only here begin information gathering: semantic model, chapter links, and the detailed specification.

The first three chapters must visibly read as **identity → visual family → reference**.

## Opening definition

> Button is a native, caller-labelled action control that keeps priority, destructive consequence, size, and progress distinct.

The opening specimen is representative, not labelled as the canonical default:

```jsx
<Button priority="primary" size="large">Save changes</Button>
```

## Detailed information architecture

After the specification map, teach:

1. Purpose, boundary, design thesis, anatomy, ownership, and source-to-decision evidence.
2. Visual system, priority, destructive consequence, sizing, geometry, typography, color, theme, and width.
3. Rest, hover, focus-visible, pressed, loading, disabled, failure, recovery, confirmation, completion, and completed resting behavior.
4. Usage, labels, icons, long wording, action groups, and destructive escalation.
5. Accessibility, keyboard, accessible naming, announcements, contrast, forced colors, zoom, 390px behavior, and reduced motion.
6. Public React API, minimal and complete examples, invalid combinations, pass-through rules, and safeguards.
7. Related components, acceptance criteria, availability, adoption, and genuine tradeoffs.

Use one continuous editorial article. Tables, code surfaces, specimen stages, and callouts should explain a real relationship; paragraphs and facts should not each become cards.

## Stable frame and continuity

The shared documentation header and desktop library navigation remain stable. Button removes its persistent right-side contents rail and provides its own specification map after the visual overview. Use normal scrolling and anchors, not scroll snapping.

Live specimen dimensions remain stable while state changes. Loading preserves width and focus. Completion and failure stay outside Button. Destructive cancel or completion restores focus to the invoking control. The page stores no user data and makes no network request.

## State coverage

- **Initial:** calm cover with identity, one sentence, one specimen.
- **Loading:** stable width, meaningful wording, preserved focus, blocked repeat activation.
- **Empty:** not applicable; this maintained specification must never render as an empty shell.
- **Healthy:** cover, visual family, map, and every detailed chapter render.
- **Partial:** failed clipboard copy does not block reading; code remains selectable.
- **Error and recovery:** a safe local fixture can fail, show `Try again`, and recover without a reload.
- **Success and completed resting:** parent-owned completion remains visible after Button returns to rest.
- **Confirmation:** harmful consequence and safe cancel route precede primary destructive action.

## Responsive and accessibility

At exactly 390px, the cover must still fit as one calm first-viewport composition with no contents row before the specimen. Treatments reflow without squeezing controls below their useful minimum. Sizes remain visually comparable. The map becomes one column. Tables become labelled vertical records. Action pairs stack through their parent. No expanded state may create horizontal overflow.

Use one H1 and sequential chapter headings. Map links and every live control receive visible keyboard focus. Loading exposes busy state without a chattering live region. Disabled uses native semantics and remains identifiable. Destructive meaning is present in wording as well as color. Reduced motion removes press translation and spinner rotation while preserving wording, focus, busy semantics, and tonal feedback.

## Visual craft

Translate the PDF's editorial discipline, not its white theme or Apple branding:

- deep Slate surfaces and the existing blue accent;
- large precise title typography and short readable measure;
- one intentionally framed specimen surface on the cover;
- generous breathing room without meaningless dead space;
- one broad specimen surface per visual lesson, divided internally;
- thin rules, compact tables, code surfaces, and limited purposeful callouts after the map;
- no gradients, glow, glass, ornamental shadows, or status pills; and
- the real exported Button for every authoritative specimen.

## Scope and renewed approval

Allowed: Button docs page and styles, focused docs tests, sanitized evidence, release record, and a narrow skill clarification requiring reference specifications to be used as actual visual and information-architecture benchmarks.

Excluded: Button behavior or API changes, feature adoption, unrelated component pages, shared docs-shell redesign, dependencies, runtime control, persistence, analytics, and network behavior.

Renewed approval is required before adding any metadata, status, document map, code, or second specimen to the cover; changing Button's approved contract; redesigning the shared docs shell; or replacing identity → visual family → reference with another progression.
