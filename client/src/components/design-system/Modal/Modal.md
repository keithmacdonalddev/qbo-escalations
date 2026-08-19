# Modal — Component Design Explanation

Component type: `interactive-control`

## Component definition

Modal is an interactive control that temporarily moves one bounded task into the foreground, contains keyboard focus while that task is active, and returns the user to the place that opened it when the task is dismissed. It answers one question: “What needs my focused attention before I continue with the underlying workspace?”

Use it for short reviews, choices, forms, and confirmations that are understandable without leaving the current context. It is not a generic floating card, a full workspace, a mobile bottom sheet, or a multi-step product workflow. Plain page content is insufficient because modality changes what can be interacted with, how focus moves, how Escape behaves, how background scrolling is handled, and where focus returns. The component therefore governs the temporary layer and its focus lifecycle while the parent supplies the actual task.

## Evidence and design determination

The approved contract comes from current repository evidence and the user-approved 1536×1024 isolated prototype. The measurements below are frozen in the production implementation and verified again through rendered release evidence.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| `DESIGN.md:13-16` requires Slate surfaces, compact spacing, and one organized surface instead of collections of cards. | The layer should read as one calm decision surface, not a miniature dashboard. | Use one bordered Slate shell with header, one scrolling body, and an optional footer. | A card mosaic inside every modal would fragment the decision and spend space on decoration rather than the task. |
| `DESIGN.md:79-117` requires progressive disclosure, content-sized modes, a stable working frame, internal scrolling, and no mobile overflow. | Modal geometry must follow the current amount of work while preventing later disclosures from clipping controls. | Keep natural height, cap it to the viewport, fix header and footer, and scroll only the body after the cap is reached. | A fixed tall shell would reserve dead space in short states and repeat the feedback-modal regression recorded in the design guide. |
| `client/src/App.css:28-57` defines the current Slate surfaces, ink, borders, and blue focus/action accent. | The component does not need a private palette or Apple-like grey theme. | Use `--bg-raised`, `--ink`, `--ink-secondary`, `--line-strong`, and `--accent` relationships shown in the bitmap. | Raw per-feature colors or a light floating sheet would fork the current product identity. |
| `client/src/App.css:150-187` defines spacing, radius, functional elevation, and 150–300ms motion tokens. | Geometry and motion can remain consistent with the app while elevation communicates a real foreground layer. | Use the 4px spacing rhythm, `--radius-xl`, `--shadow-xl`, and a restrained 180ms entry transition. | A pill silhouette, glow, or large spring movement would make a routine decision feel promotional. |
| `client/src/components/ConfirmModal.jsx:7-36` already repeats open state, initial focus, Escape, backdrop dismissal, dialog semantics, and action layout in one feature-owned component. | The behavior recurs independently of destructive confirmation content and deserves a shared boundary. | Extract the layer behavior as Modal; keep confirmation wording and destructive action choice in a parent composition. | Promoting the existing ConfirmModal unchanged would make deletion-specific copy and unsafe confirm-first focus part of the generic primitive. |
| `client/src/components/reporting/UserReportDialog.jsx:257-277` and `client/src/components/reporting/UserReportDialog.jsx:458-466` independently implement close protection, a Tab loop, a portal, dialog labelling, and a close control. | Current workflows need a common focus and dismissal contract, but their data and multi-state content differ. | Modal owns the portal, focus containment, labelled shell, dismissal request, and focus return; the reporting workflow remains feature-owned. | Moving reporting drafts, uploads, receipts, or submission state into Modal would create a catch-all workflow component. |
| `client/src/overhaul.css:242-252` and `client/src/overhaul.css:1772-1805` apply broad substring rules to classes containing modal, dialog, overlay, or backdrop. | A semantically correct generic class name would be visually unstable in the effective cascade. | Export the component as `Modal`, but use collision-resistant internal classes beginning with `qds-focus-layer` and `qds-focus-veil`. | Internal classes such as `.qds-modal` would still match the late substring selectors and inherit unrelated animation, color, radius, and veil overrides. |
| `docs/design-system/COMPONENT_LIBRARY.md:54-83` requires the smallest truthful object, composition over catch-all APIs, structural omission, and parent-owned product state. | The shared object must stop at layer behavior and named structural slots. | Require title and body, allow description and footer to disappear completely, and leave requests, validation, outcomes, and persistence to the parent. | An unrestricted shell with arbitrary headers, sidebars, navigation, diagnostics, and styling knobs would only relocate feature complexity. |
| `client/src/components/design-system/Button/Button.contract.json:14-72` and `client/src/components/design-system/Button/Button.css:1-109` separate priority, tone, size, width, and focus behavior. | Modal actions should compose the approved Button contract rather than inventing a second action language. | The footer accepts caller-supplied Button elements; Modal owns the footer surface and spacing, not button semantics. | Building primary, secondary, destructive, loading, and disabled action variants into Modal would duplicate Button and couple two contracts. |

The decisive improvement over a generic “dialog box” is behavioral clarity: modality, focus, dismissal, and scroll containment form one reusable job, while business actions and outcomes remain outside. The prototype also resolves an active cascade hazard rather than merely copying existing `.modal` styling.

## Component boundary

Modal owns whether its layer is rendered from the controlled `open` prop; a portal above the application; the dark focus veil; native dialog semantics; title and optional description relationships; the close control; initial focus; the Tab and Shift+Tab loop; Escape, close-button, and true-backdrop dismissal requests; background scroll locking; fixed header and optional footer; internally scrolling body; reduced-motion treatment; and restoration of focus to the captured opener after the parent closes it.

The parent or workflow owns the open state itself, body data, validation, network and storage calls, loading messages, success or failure feedback, retry and recovery, destructive consequence wording, action callbacks, permissions, analytics, audit evidence, and whether a requested dismissal may proceed. If unsaved work prevents immediate dismissal, the parent should transform the same layer into a clear confirmation state instead of opening a second Modal.

Modal does not infer a primary action, submit a form, navigate, persist a draft, or announce a business outcome. It requests dismissal with a reason; the parent decides what that means. Adoption in ConfirmModal, reporting, agent monitoring, or any other screen is a separate scope and is not authorized by this prototype.

## Anatomy

```text
Modal
├─ portal root                                  conditional while open
│  └─ focus veil                               required while open
│     └─ dialog surface                        required
│        ├─ identity header                    required
│        │  ├─ visible title                   required
│        │  ├─ supporting description          optional
│        │  └─ close control                   required
│        ├─ body                               required
│        │  └─ caller-owned task content       required
│        └─ action footer                      optional
│           └─ caller-supplied actions         required when footer exists
└─ captured opener for focus return             conditional
```

The title never disappears because it names the temporary context and labels the dialog. If description is omitted, its paragraph and five-pixel gap are absent. If footer is omitted, the footer element, divider, tinted surface, and reserved height all disappear. The close control remains because the first contract supports only safely dismissible bounded tasks. The body is always present and takes the available space; it scrolls only after the natural shell reaches its viewport cap. No icon well, status row, empty action column, or decorative banner is reserved.

## Core design thesis

The central idea is **focused interruption without lost context**. The veil makes the underlying workspace unavailable without visually erasing it. The shell is prominent through one boundary and functional shadow, not through oversized type or decorative material. Inside, the reading order is title, optional reason, task content, then actions. That hierarchy makes the interruption understandable before asking for input.

This principle also governs behavior. Focus enters deliberately, cannot leak behind the veil, and returns to the opener. Escape and the close control mean the same thing: request a safe dismissal. The body can grow without moving the identity and action regions out of reach. The component feels temporary, but the user never has to reconstruct where they were.

## Canonical default

The canonical default is a regular-width, naturally sized Modal with a required title and body, an optional one-sentence description, a visible close control, and no footer unless the parent supplies actions. The desktop maximum width is 610px. It uses 20px body insets, an 18px title, readable supporting copy, a 16px radius, a strong quiet border, and functional elevation. The approved prototype includes the optional description and footer so their relationship can be judged, but they are not silently created by the component.

`open` is controlled and defaults to no rendered layer when false. Regular is the safe size because it accommodates a review or modest form without becoming a workspace. Natural height avoids the empty-shell failure recorded in `DESIGN.md`; the viewport cap prevents long content from pushing the close control or actions off-screen. The background remains legible only as subdued spatial context, never as an active second task.

## Variant, state, and size architecture

The API separates four concerns rather than flattening them into one `variant` prop:

- **Persistent state:** `open` is controlled by the parent. Closed means the portal is absent; open means the layer and focus contract are active.
- **Size:** `regular` is a 610px maximum and `compact` is a 520px maximum. At narrow widths both yield to the 12px viewport inset. Size changes width and modest identity density, not semantics, dismissal, or required anatomy.
- **Optional anatomy:** `description` and `footer` are independent named slots. Their omission removes structure and spacing. Compact does not automatically delete either part.
- **Transient interaction:** hover, focus-visible, press, and dismissal-request behavior belong to the close control and veil. They do not become persistent Modal variants.

There is no `wide`, `fullscreen`, `sheet`, `destructive`, `loading`, or `success` Modal in the first contract. A broad agent workspace or long writing flow should prove that it remains a bounded modal task before a wider size is added. Destructive is an action tone supplied by Button. Loading, success, partial success, error, and retry are states of the caller's workflow content. A bottom sheet changes placement, motion origin, and mobile expectations and therefore requires a separate component.

## Visual system

The shell uses `--bg-raised` so it remains a calm Slate work surface, separated from the darker veil by `--line-strong` and `--shadow-xl`. Primary text uses `--ink`; the optional description uses readable `--ink-secondary`, never tertiary ink. Internal divisions use `--line-subtle`. The close control starts transparent, uses `--bg-elevated` on hover or focus context, and receives a two-pixel `--accent` focus ring with `--accent-border` support. The footer mixes the canvas and raised surface to establish a quiet action zone without becoming another card.

Geometry follows the existing token relationships and an 8–20px rhythm. The regular title is 18px; compact and 390px use 16px. The close target is 40px at every supported width so pointer and touch use share one reliable target. Approved Button specimens remain 40px medium controls in the footer.

The veil uses a dark translucent treatment and only restrained blur to reinforce focus, not to imitate glass. No gradient, glow, pill shell, or routine colored edge appears. Entry uses approximately 180ms of small opacity, eight-pixel vertical movement, and 0.985 scale under normal motion. These measurements are provisional until the production component is rendered against the effective cascade; the public API exposes no color, radius, shadow, veil-opacity, or motion-duration knobs.

## Interaction and state journey

At rest while closed, Modal renders nothing and does not trap focus or lock scrolling. When `open` becomes true, it captures the active opener, renders through a portal, prevents background scroll, and moves keyboard focus to a valid caller-supplied `initialFocusRef`; if that target is absent, hidden, disabled, or outside the surface, focus falls back to the dialog surface so the title and description are announced before action.

While open, the close control has a quiet rest appearance, a contained hover surface, a clear focus-visible ring for keyboard focus, and immediate pressed feedback without layout shift. Tab and Shift+Tab cycle through currently enabled focusable descendants. Clicking and releasing on the true backdrop, pressing Escape, or activating close calls `onRequestClose` once with `backdrop`, `escape`, or `close-button`. A pointer that starts inside and ends on the veil must not dismiss through drag-out.

Modal itself has no disabled, waiting, loading, busy, success, completed, partial-success, error, failure, retry, or recovery presentation because those outcomes belong to the task. If the parent is busy and cannot safely close, it may reject the request, but it must keep a usable cancel or explanation path; trapping someone behind an inert close control is prohibited. Error and recovery content stay reachable in the scrolling body. When the parent changes `open` to false, scroll lock ends and focus returns to the captured opener if it still exists; otherwise the parent must place focus at the next useful location.

Under reduced motion, the surface appears without translation or scale and the veil changes without animated blur. Focus, dismissal reasons, containment, completed workflow feedback, failure recovery, and focus return remain fully understandable without motion.

## Responsive behavior

On desktop, regular and compact use content width up to their governed maxima and natural height up to `calc(100dvh - 24px)`. The shell remains centered, header and optional footer stay fixed, and only the body scrolls. Scrollbar space is reserved so content does not jump when a disclosure makes scrolling necessary. Long titles and descriptions wrap; they are not ellipsized.

At exactly 390px, both sizes resolve to 366px with a 12px inset on each side. Title type becomes 16px, body padding becomes 15px, the close target becomes 40px, and the two-action footer uses the available width without horizontal overflow. The prototype keeps all three review facts rather than hiding information or using decorative placeholder bars. Additional content extends the body and scrolls inside the stable shell.

Footer actions may wrap only when localized labels cannot remain readable. DOM order remains visual and spoken order; Modal does not reverse actions. A layout that needs a bottom-anchored sheet, full-bleed camera, or 980px agent workspace is not silently transformed at 390px and must use a separately approved pattern.

## Accessibility

The surface uses `role="dialog"` with `aria-modal="true"`. A generated title ID supplies `aria-labelledby`; a description ID supplies `aria-describedby` only when description exists. The visible title is always the accessible name, so `aria-label` cannot replace it. The close control has the concise accessible name “Close,” uses a real button, and its X icon is hidden from assistive technology.

Opening moves focus inside; Tab and Shift+Tab remain contained; Escape requests dismissal; closing restores focus. The background is made unavailable through the chosen platform technique and its scroll is locked, while the portal prevents clipping by feature containers. Initial static content is not a live region. Business success, completed state, error, failure, retry, and recovery announcements are supplied by the parent only when meaningful.

Color does not carry meaning. The veil, border, readable text, visible heading, close symbol, and focus ring retain distinct roles without color alone. Forced-colors mode replaces decorative boundaries with system colors. At browser zoom and exactly 390px, content wraps and remains reachable. Reduced motion removes nonessential transforms. The desktop close target reflects the app's dense pointer context; the mobile target increases to 40px, and footer Buttons use their governed target sizes.

## Content guidance

Titles are short, sentence-case task identities such as “Review proposed change” or “Choose a review owner.” The optional description answers why the interruption exists or what must be decided; it should normally be one sentence. Body content begins with the task, not a second title or decorative eyebrow. Footer labels use specific verbs through Button, such as “Apply change,” “Save settings,” or “Cancel.”

Do not use Modal for passive notifications, background progress, long policy reading, full dashboards, raw provider payloads, or a route that the user will inhabit. Do not put a badge, status strip, repeated title, or implementation explanation in the header. Sanitized prototype copy may illustrate a generic operational decision, but the reusable component owns no business schema or account data.

## Public API

The frozen type keeps modality controlled and exposes only the integration points the component can govern:

```tsx
type ModalDismissReason = 'escape' | 'backdrop' | 'close-button';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  size?: 'compact' | 'regular';
  initialFocusRef?: React.RefObject<HTMLElement>;
  footer?: React.ReactElement | React.ReactElement[];
  children: React.ReactNode;
  onRequestClose: (reason: ModalDismissReason) => void;
}
```

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

Minimal valid use:

```jsx
<Modal open={reviewOpen} title="Review details" onRequestClose={closeReview}>
  <p>Check the proposed update before continuing.</p>
</Modal>
```

Full use:

```jsx
<Modal
  open={reviewOpen}
  title="Review proposed change"
  description="Confirm the details before this update is handed to the agent team."
  size="regular"
  initialFocusRef={cancelRef}
  onRequestClose={(reason) => requestSafeClose(reason)}
  footer={[
    <Button key="cancel" ref={cancelRef} onClick={() => requestSafeClose('close-button')}>
      Cancel
    </Button>,
    <Button key="apply" priority="primary" onClick={applyChange}>
      Apply change
    </Button>,
  ]}
>
  <ChangeReview details={details} />
</Modal>
```

`open`, content, and close acceptance are parent-controlled. `size` is geometry only. `initialFocusRef` is an accessibility integration point and cannot target outside the dialog. `footer` is a named structural slot for approved action controls; it is not a second body. `children` owns the task content because a modal is intentionally a container composition, but it cannot replace the required title or inject another header/footer.

The component deliberately excludes `className`, `style`, raw color or shadow props, `as`, `aria-label`, arbitrary role replacement, portal-target selection, z-index, backdrop opacity, animation timing, draggable/resizable behavior, nested-layer support, and automatic form submission. Adding a size, dismissal mode, or persistent region changes the contract materially and requires new approval.

## Invalid combinations and safeguards

The implementation rules are deliberately literal: an invalid empty title renders nothing; dismissal reasons are `escape | backdrop | close-button`; Tab and Shift+Tab loop inside the layer; background content becomes inert while open; a second simultaneous Modal is blocked; and an invalid size falls back to regular. These are release-tested contract outcomes, not optional guidance.

- An empty or non-string `title` is invalid; development must warn, production must render no Modal, and focus must remain with the opener.
- `open={true}` without `onRequestClose` is rejected because the first contract guarantees a clear escape path rather than creating an accidental trap.
- An empty `description` is ignored with a development warning; its element, relationship, and spacing disappear.
- An empty `footer` array is treated as omitted; the divider, surface, and reserved footer height disappear.
- Unsupported `size` values warn and fall back to `regular`; width is still clamped to the safe viewport inset.
- `initialFocusRef` pointing outside the surface, to a hidden node, or to a disabled control is ignored with a warning and falls back to the dialog surface.
- A second Modal while one is open is prohibited. The attempted nested layer must not mount; the parent should replace content in the existing layer or use an inline confirmation.
- Backdrop dismissal requires pointer down and pointer up on the veil itself. Dragging from content onto the veil cannot close the task accidentally.
- `className`, `style`, role replacement, and raw visual props are excluded rather than silently becoming alternate theming APIs.
- If the captured opener no longer exists at close, focus restoration falls back to a caller-owned next location; Modal must not focus the document body or an unrelated action.

## Relationship to neighboring components

Modal is the modal layer and focus lifecycle. `ConfirmModal` is a feature composition that supplies consequence copy, Cancel, and a destructive or primary Button; it should eventually compose Modal only through separately approved adoption. `AlertDialog` would be a stricter confirmation component with alert-dialog semantics and safe initial focus, not a tone variant. `Popover` is anchored and non-modal. `Menu` owns option navigation. `Drawer` is edge-anchored and may preserve more page context. A mobile `Sheet` has a different origin and gesture model.

Button owns action priority, destructive tone, loading, disabled state, and activation. Modal owns the footer region that can contain Buttons. TitleBlock names pages or sections in normal document flow; Modal uses its own required heading relationship because a dialog must be labelled as one semantic object. StatusIndicator and MetadataLine may appear inside body content, but Modal does not absorb their state or facts into its shell.

## Do / don't guidance

Do:

- Use Modal for one bounded decision or short task that benefits from preserving the underlying context.
- Give it one direct title and only decision-helping description text.
- Place the task immediately in the body and keep optional detail inside controlled disclosures.
- Use approved Button elements in the optional footer and preserve one local primary action.
- Let long body content scroll while identity, close, and actions remain reachable.
- Keep dismissal reversible and restore focus to the opener.

Don't:

- Turn Modal into a full workspace, dashboard, camera experience, or route.
- add arbitrary sidebars, breadcrumbs, status bars, or multiple nested surfaces to its shell.
- Hide a dangerous action behind generic “Yes” or “Proceed” wording.
- Disable every dismissal path during a long operation without a visible explanation or safe alternative.
- Open a second Modal over the first.
- Add raw colors, z-indexes, widths, shadows, or feature class names through escape hatches.

## Acceptance criteria

- [x] The first specimen shows the regular canonical shell before compact and mobile examples.
- [x] Required title and body remain present in every supported use.
- [x] Optional description removes its markup, relationship, gap, and height when omitted.
- [x] Optional footer removes its markup, divider, surface, and height when omitted.
- [x] Regular and compact change governed geometry without changing semantic purpose.
- [x] The production shell uses collision-resistant `qds-focus-layer` and `qds-focus-veil` classes.
- [x] No late substring selector changes the approved Slate surface, radius, veil, or motion.
- [x] Opening captures the opener, locks background scroll, and places focus inside.
- [x] Tab and Shift+Tab remain contained for changing enabled content.
- [x] Escape, close button, and true-backdrop activation request dismissal exactly once with the correct reason.
- [x] Dragging from dialog content onto the veil does not dismiss.
- [x] Closing restores focus to the opener or a deliberate parent fallback.
- [x] Nested Modal attempts are prevented with a clear development warning.
- [x] Header and footer remain reachable while only the capped body scrolls.
- [x] Exactly 390px retains 12px insets, a 40px close target, readable content, and no horizontal overflow.
- [x] Long and localized title, description, body, and action labels remain understandable without silent truncation.
- [x] Focus-visible is clear and unclipped on the close control and composed actions.
- [x] Reduced motion removes translation, scale, and animated blur without removing state feedback.
- [x] Forced-colors mode preserves dialog boundary, close control, and focus location.
- [x] Modal performs no fetch, storage, navigation, analytics, validation, or business-outcome announcement.
- [x] The approved Button component supplies footer action semantics instead of duplicated modal button variants.
- [x] The production component, full explanation, registry, live docs, tests, rendered desktop and exact-390 evidence, and release record agree before status becomes `available`.

## Independent critique

The main tradeoff is that a shared Modal can remove repeated accessibility work while also making it too easy to place oversized workflows in a foreground layer. Compact and regular widths are intentionally narrow, and wide, fullscreen, sheet, sidebar, and persistent workspace modes are rejected. That constraint may force some current consumers to remain feature-owned, but weakening it would turn Modal into a generic container with no trustworthy interaction threshold.

The second risk is dismissal authority. The component can report why closing was requested, but the parent may refuse because of unsaved work or a busy operation. A close button that appears to do nothing would be a failure. The correction is not a `dismissDisabled` styling prop; the workflow must respond visibly in the same layer, preserve a safe exit, and avoid nesting another Modal. This requirement deserves focused behavior tests before production availability.

The prototype began with a denser desktop close target, but production standardizes it at 40px at every width. This removes an unnecessary pointer-versus-touch distinction while retaining the compact visual glyph. Rendered evidence must still confirm the target remains comfortable at zoom and that the outer focus ring is not clipped.

## Decision summary

The released contract is a controlled, dismissible Modal interactive control with one required title, one required body, a required close control, optional description, optional Button footer, natural height, a capped scrolling body, regular and compact widths, portal rendering, complete focus containment, reasoned dismissal requests, scroll lock, reduced motion, and focus restoration. It deliberately excludes business state, destructive tone, form behavior, navigation, nested layers, wide workspaces, mobile sheet behavior, and arbitrary styling.

The user approved this v1 silhouette, 610px regular width, 520px compact width, and standard dismissal contract for production implementation on August 18, 2026. Feature adoption remains a separate approval scope and is not authorized by this release.

This result substantively improves on the Button quality-floor example by resolving a current effective-cascade contradiction specific to Modal: the public component keeps the truthful name `Modal`, while its internal `qds-focus-layer` vocabulary avoids the repository's broad modal/dialog substring overrides. It also turns the documented feedback-modal stability failure into explicit body-scroll, mobile, and dismissal safeguards rather than merely describing attractive states.

## One-sentence definition

Modal is a controlled, focus-contained foreground layer for one bounded, safely dismissible task, preserving the user's underlying context while the parent retains ownership of content, actions, outcomes, and authority.
