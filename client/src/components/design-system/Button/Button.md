# Button — Component Design Explanation

Component type: `interactive-control`

> **Available component contract:** this is the authoritative detailed explanation for the released Button primitive. It records the current evidence, architectural boundaries, controlled API, safeguards, and acceptance standard. The live teaching experience is `/docs/components/button`; the concise component registry is `docs/design-system/COMPONENT_LIBRARY.md`. The implementation, this contract, the teaching page, registry, tests, and release record must remain synchronized.

## Component definition

Button is an interactive control that lets a user initiate one clearly named action while communicating that action's local priority, destructive consequence when applicable, availability, and progress without owning the surrounding workflow. Its job is narrower than “make something clickable.” It must tell the user what will happen, whether this is the preferred action in the current decision group, whether activating it could cause harm, and whether the application has accepted the activation.

The component is appropriate for immediate interface actions such as saving a form, checking for updates, retrying a failed operation, or confirming a destructive decision. It is not the right primitive for navigation, persistent on/off state, choosing among several options, or opening a menu whose choices are the real actions. Those jobs belong to anchors, switches, radio or segmented controls, and menu buttons because their semantics and keyboard behavior differ.

## Evidence and design determination

The design is derived from the current application rather than from the appearance of an unrelated platform. The following table shows how evidence changes the released contract. These paths and line references were refreshed for this release and must be refreshed again on any material revision.

| Current evidence | Design implication | Decision | Strongest rejected alternative |
| --- | --- | --- | --- |
| `DESIGN.md:428-439` defines blue primary, raised dark secondary, ghost, danger, verb-led labels, action-specific loading labels, and one primary per decision group. | Button hierarchy and wording already have an app-wide direction. | Preserve primary and secondary priority, destructive tone, caller-supplied verb labels, and action-specific loading copy. | A visually fashionable white Apple-like button set would conflict with the product's current Slate language and existing action hierarchy. |
| `DESIGN.md:69-72` describes a compact desktop operational tool, restrained depth, purposeful motion, and accessibility as design inputs. | The default should be compact and flat, with feedback that explains interaction rather than decorating it. | Use a 40px medium visual height, restrained radius, no decorative glow, short state transitions, and explicit reduced-motion behavior. | A 52–56px pill with a large shadow would consume operational space and visually resemble promotional UI. |
| `client/src/App.css:27-65` defines dark surfaces, readable ink, blue accent, and danger tokens. | Color choices can be semantic and theme-native instead of invented per component. | Map neutral primary to `--accent`, secondary to Slate raised/elevated surfaces, and destructive tone to `--danger` plus `--danger-subtle`. | Raw hex colors inside the component would fork the visual language and make later theme work inconsistent. |
| `client/src/App.css:1302-1365` shows an existing `.btn` pattern with inline-flex layout, 36px minimum height, 8px radius, 13px/600 text, focus, pressed scale, disabled opacity, and primary/secondary/danger treatments. | The proposal must acknowledge current behavior, preserve compatible strengths, and identify weaknesses rather than pretending no button system exists. | Retain the established compact silhouette and token relationships while replacing global class behavior with a governed `qds-` component contract. | Copying the legacy classes unchanged would preserve whole-element opacity, pointer-event suppression, and incomplete loading semantics as permanent design-system rules. |
| `client/src/design-system.css:245-248` gives interactive elements a visible outer focus indicator, and `DESIGN.md:81` requires deliberate focus, active, disabled, and loading states. | Focus and state behavior are part of the component, not later polish. | Use native button semantics, an unclipped outer focus ring, and explicit behavior for rest, hover, focus, press, loading, and disabled. | An inset focus outline would disappear against some filled surfaces and could be mistaken for a border change rather than keyboard location. |
| The requested examples name primary, secondary, loading, disabled, and destructive together. | The showcase vocabulary is useful, but the API must not imply that loading and disabled are the same kind of choice as primary and destructive. | Separate priority, semantic tone, size, and state so valid combinations remain expressible without compound variant names. | A flat `variant="primaryLoading"` enumeration would grow combinatorially and make secondary-loading or destructive-disabled behavior inconsistent. |

The important determination is that the prototype's five visible specimens do not become five equivalent props. Primary and secondary describe local visual priority. Destructive describes consequence. Loading and disabled describe state. That separation is the architectural improvement over a merely attractive button sheet.

## Component boundary

Button owns the action control itself: native button semantics, internal alignment, label and optional icon placement, priority and tone styling, loading presentation, disabled presentation, pointer and keyboard feedback, focus visibility, and protection against duplicate activation while loading. It may expose the native form `type`, but it does not decide whether the action should submit, validate, navigate, ask for confirmation, or call a network service.

The parent feature owns the action handler, validation, permissions, confirmation flow, asynchronous operation, success or failure message, retry policy, analytics, and whether the action is locally primary. A dialog may compose Button for its confirmation actions; Button does not open the dialog itself. A form may compose Button as `type="submit"`; Button does not infer that role from its label.

Navigation remains an anchor even when visual hierarchy resembles a button. An `href`, router destination, or polymorphic `as` prop is deliberately excluded from this primitive because it would blur action and navigation semantics. A future LinkButton may share visual tokens while still rendering a real anchor. Icon-only actions remain IconButton because square geometry, tooltip expectations, and mandatory accessible naming create a different contract.

## Anatomy

The component has one required communication element and a small number of controlled optional elements:

```text
Button
├─ native button surface                 required
│  ├─ content frame                      required
│  │  ├─ progress indicator?             optional while loading
│  │  ├─ icon?                           optional, one logical position
│  │  └─ visible action label            required
│  └─ focus indicator?                   conditional on focus-visible
└─ native disabled/busy semantics        conditional state
```

The label is always required. When the icon is absent, its gap and wrapper disappear; the text remains optically centered rather than reserving an invisible icon column. When loading begins, the progress indicator occupies a controlled slot and the button preserves the larger of its resting and loading measurements so neighboring controls do not move. The spinner is decorative to assistive technology because the button's accessible name and busy state communicate the same information.

Only one icon slot is exposed through `icon` plus a logical `iconPosition`. Supporting simultaneous leading and trailing decoration would complicate centering and encourage noisy actions. If a trailing chevron means “opens a menu,” the control is a MenuButton, not an ordinary Button with an extra glyph.

## Core design thesis

The governing principle is **action clarity through separated signals**. The label communicates consequence, priority controls visual weight, tone communicates risk, and state communicates current operability or progress. No one signal should be forced to do all four jobs.

This prevents common ambiguities. Red cannot merely mean “important,” because red is reserved for destructive or blocking consequences. A pale button cannot automatically mean disabled, because secondary actions remain fully operable. A spinner cannot replace all wording when the operation is unclear. A blue fill cannot make several neighboring actions equally primary. Each visual decision has one job, so the component remains predictable across forms, dialogs, toolbars, and recovery states.

Refinement comes from proportion and response rather than object-like styling. The control should feel available at rest, definite under focus, immediate when pressed, stable while waiting, and quiet when unavailable. It should not rely on gradients, glow, thick shadow, oversized corners, or motion that continues after it has stopped communicating progress.

## Canonical default

The canonical default is a medium, neutral-tone, secondary-priority text button rendered on the Slate dark interface. It uses the shared raised control surface, readable primary ink, a quiet boundary, an 8px controlled radius, a 40px visual height, and content-driven width with consistent horizontal padding. There is no icon, no spinner, no fixed marketing width, and no decorative shadow.

This default is intentionally conservative because a bare `<Button>` should be useful without silently claiming to be the preferred action in every context. Medium deliberately strengthens the prior 36px control language to a more comfortable 40px default while remaining compact enough for the operational interface. Neutral tone avoids implying harm. Secondary priority remains clearly operable while requiring callers to opt into primary emphasis after deciding the local hierarchy. This aligns the default with the library rule that the safest, quietest, broadly correct form comes first.

The prototype can still show primary immediately after the canonical default because the requested Button system must make that role easy to judge. Showing it prominently does not make it implicit. If consumer inventory later proves that every valid placement can determine hierarchy explicitly, making `priority` required remains a possible material revision rather than something hidden in implementation.

## Variant, state, and size architecture

The public model uses four independent axes:

- `priority`: `primary` or `secondary`. This answers how strongly the action should compete inside its immediate decision group.
- `tone`: `neutral` or `destructive`. This answers whether the consequence is ordinary or harmful/difficult to reverse.
- `size`: `small`, `medium`, or `large`. This changes controlled geometry without changing meaning.
- state: native/resting interaction plus `loading` and `disabled`. This answers what the control is doing or whether it can currently act.

These axes produce understandable combinations. A primary neutral button is the normal preferred action. A secondary neutral button is available but quieter. A secondary destructive button is the default way to expose a harmful action without making it the visual destination. A primary destructive button is reserved for a focused confirmation context where the destructive choice is genuinely the principal decision. Loading can apply to any permitted priority and tone while preserving that underlying identity.

Size does not silently change content or semantics. Small compresses the visible control for dense desktop tools but must retain an adequate interactive target through layout or a larger invisible hit area when appropriate. Medium is the application default. Large is for spacious forms or narrow layouts where the action needs a larger target; it is not automatically full width. `fullWidth` is a layout option because width and control density are different concerns.

Disabled is not a visual “variant.” It is an unavailable state using native `disabled` when the control truly cannot be activated. Loading is also not disabled: it communicates that activation was accepted and work is in progress. The loading implementation blocks repeat activation while preserving focus and announcing busy state, rather than applying native disabled behavior and unexpectedly removing the user's keyboard position.

## Visual system

The visual system uses current Slate tokens as relationships rather than hardcoding a miniature palette inside the component. Neutral primary uses `--accent` at rest and `--accent-hover` on hover with a light foreground verified for contrast. Neutral secondary uses `--bg-elevated` or the approved control surface, `--ink`, and a `--line-subtle` boundary that becomes clearer on hover. Destructive secondary uses `--danger-subtle`, `--danger`, and a restrained semantic border; destructive primary uses a solid danger surface only in an approved confirmation composition.

Medium uses a validated 40px visual height, `--radius-md` at 8px, `--text-sm` at 13px/650, a 7px internal icon gap, and 18px horizontal padding. Small uses 32px height, 6px radius, 11px text, a 6px gap, and 14px padding. Large uses 48px height, 10px radius, 14px text, an 8px gap, and 22px padding. The 32/40/48 progression is explicit: density changes geometry without changing meaning, and 40px is the canonical default.

Corners remain rounded rectangles rather than full pills. The straight edges preserve the conventional action silhouette and distinguish Button from chips, compact filters, and status pills. Depth remains nearly flat. A border clarifies the secondary surface; the primary fill supplies its own boundary. A shadow is omitted by default because the current Slate system treats shadows as functional layer separation, not routine decoration.

The focus-visible ring sits outside the control with sufficient separation from both blue and red surfaces. Hover changes color without changing size. Press may use a very small scale or one-pixel optical compression, but the final choice must remain sharp and stop immediately on release. Under reduced motion, transforms are removed while tonal and focus feedback remain.

Icons use currentColor, a size proportional to the control, and normalized optical weight. They reinforce rather than replace the action label. The spinner uses the same slot geometry as an icon, does not introduce a colored tile, and remains visually subordinate to the active wording.

## Interaction and state journey

At rest, the control presents its label, priority, and tone without motion. Hover provides a modest tonal preview for pointing-device users and never becomes the only signal that the element is operable. Keyboard focus adds the external focus-visible ring without moving the control or relying on a permanent selected appearance.

On pointer or keyboard activation, the native button fires once. Press feedback begins immediately and resolves on release; it must not delay the handler. Space and Enter follow native button behavior. If the parent synchronously changes `loading` to true, the component retains focus, sets `aria-busy="true"`, blocks subsequent activation in both the event guard and pointer treatment, and presents the supplied loading label or the unchanged action label with a spinner. The resting width remains reserved so the action group does not shift.

Loading ends only when the parent reports that the operation is no longer pending. Button does not invent success. The parent presents the completed result in the surrounding workflow, changes the page state, or supplies an appropriate announcement. Likewise, failure belongs to the workflow: the parent shows what failed and how to recover, while the button may return to an enabled retry action with a specific label such as “Try again.” Focus remains on the button unless the workflow intentionally moves it to an error summary or newly revealed result according to that higher-level contract.

Disabled controls do not respond to hover, press, pointer, or keyboard activation. Native `disabled` is used by default and removes the button from the tab order. Purpose-built secondary ink retains the approved prototype's identifiable label instead of dimming the whole control or falling back to tertiary text. When a product deliberately needs an unavailable control to remain discoverable by keyboard so an explanation can be reached, that is a composed `aria-disabled` pattern with explanatory content—not an automatic Button behavior.

Selected and open are explicitly inapplicable to ordinary Button. A persistent selected state indicates ToggleButton; an open state plus popup ownership indicates MenuButton or DisclosureControl. Partial success is also not rendered inside Button because a single action control cannot truthfully summarize a multi-result operation. The parent owns partial-result messaging and any next action.

Under reduced motion, press transforms are removed and the loading spinner becomes a static progress glyph while the loading wording and busy semantics remain. Rest, hover color, focus-visible, blocked repeat activation, completion, failure, and recovery behavior do not depend on motion.

## Responsive behavior

Button is content-width by default and flexes only enough to accommodate its label, icon, and controlled padding. It never distributes characters or stretches simply because a container is wide. `fullWidth` explicitly allows the parent to fill a narrow column, but size remains medium unless the caller independently requests another approved size.

At exactly 390px, action groups normally stack through a parent ButtonGroup or layout component. The primary action may appear full width, with the secondary action below or above according to the product's consistent ordering rule. Button itself does not reorder siblings. Long localized labels remain one line when practical; the parent first provides adequate width or improves wording. Silent ellipsis is rejected because it can hide the consequence of an action, especially a destructive one.

Small controls are not forced into touch-first layouts merely because the viewport narrows. The parent selects medium or large when pointer precision is no longer a reasonable assumption. Logical `iconPosition` follows writing direction, and spacing uses inline properties so right-to-left interfaces do not require a separate visual variant.

## Accessibility

The base element is `<button type="button">`. Native semantics provide the button role, Enter and Space activation, focus behavior, and form compatibility. Consumers explicitly choose `type="submit"` or `type="reset"`; defaulting to `button` prevents an action placed inside a form from submitting accidentally.

The visible label supplies the accessible name. The component does not accept an icon-only mode. Decorative icons and the progress glyph use `aria-hidden="true"`; assistive technology hears one action name rather than the glyph name followed by duplicate text. If `loadingLabel` changes visible wording, the accessible name changes to the same meaningful phrase unless the design has a documented reason to preserve the original name.

Focus-visible must be obvious on neutral primary, neutral secondary, and destructive surfaces, at browser zoom, in forced-colors/high-contrast settings, and when the button sits near a clipped container. Color never carries destructive meaning alone: the caller's precise verb phrase states the consequence. Disabled styling uses purpose-built tokens rather than whole-element opacity alone so the label remains identifiable.

While loading, `aria-busy="true"` exposes progress and an event guard prevents duplicate activation. The component should not place a continuously changing live region inside every button. Completion and failure are workflow outcomes and are announced by the parent only when the visible change would otherwise be missed. Spinner rotation respects `prefers-reduced-motion`; a static progress glyph plus loading wording remains sufficient.

The visible small size may be 32px in dense pointer-first contexts, but its use must be documented. Touch-oriented layouts should provide at least an approximately 44px target through the selected size or safe surrounding hit area. Contrast testing covers labels, borders, semantic surfaces, focus rings, and disabled text rather than checking only the blue default.

## Content guidance

Labels begin with a specific verb and describe the result: “Save changes,” “Connect Google,” “Check for new models,” “Remove access,” or “Try again.” Generic labels such as “Submit,” “Proceed,” “Yes,” and “Click here” are accepted only when the surrounding context makes the consequence unmistakable; the component never rewrites caller copy.

Destructive labels name the object or effect when ambiguity exists. “Remove member” is safer than “Confirm.” Loading wording describes current work, such as “Saving…” or “Checking…”, and comes from the caller because the primitive cannot infer the business operation. Sentence case follows the current design language. Labels normally omit punctuation, marketing language, status claims, and explanatory paragraphs.

The button must not contain badges, secondary descriptions, timestamps, keyboard-shortcut help, or status summaries. Those additions create a different composition and make a basic action harder to scan. An icon earns its place only when it materially improves recognition or direction.

## Public API

The released API makes the independent axes visible and preserves native button behavior:

```tsx
type ButtonProps = {
  priority?: 'primary' | 'secondary';
  tone?: 'neutral' | 'destructive';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  disabled?: boolean;
  loadingLabel?: string;
  icon?: React.ReactElement<React.SVGProps<SVGSVGElement>, 'svg'>;
  iconPosition?: 'leading' | 'trailing';
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  id?: string;
  name?: string;
  value?: string | number | readonly string[];
  form?: string;
  formAction?: string;
  formEncType?: string;
  formMethod?: string;
  formNoValidate?: boolean;
  formTarget?: string;
  'aria-describedby'?: string;
  'aria-details'?: string;
  'aria-errormessage'?: string;
  [dataAttribute: `data-${string}`]: unknown;
  children: string;
};
```

Minimal valid use:

```tsx
<Button onClick={saveChanges}>Save changes</Button>
```

Full destructive loading use:

```tsx
<Button
  priority="primary"
  tone="destructive"
  size="medium"
  loading={isDeleting}
  loadingLabel="Deleting project…"
  onClick={deleteProject}
>
  Delete project
</Button>
```

The full example intentionally omits `disabled`; the confirmation workflow should not begin deletion until permission and prerequisites have already been established. A separate unavailable example would set `disabled={!canDelete}` while `loading` remains false.

| Prop | Values | Default | Meaning and ownership | Contract consequence |
| --- | --- | --- | --- | --- |
| `children` | non-empty string | required | Caller supplies the visible action label | Supplies the accessible name and cannot be empty |
| `priority` | `primary` \| `secondary` | `secondary` | Caller-owned local action hierarchy | Changes surface weight, never consequence or behavior |
| `tone` | `neutral` \| `destructive` | `neutral` | Caller-owned consequence classification | Applies ordinary or destructive semantic tokens and wording guidance |
| `size` | `small` \| `medium` \| `large` | `medium` | Caller-selected density for the placement | Changes governed height, padding, radius, type, icon, and target treatment together |
| `loading` | boolean | `false` | Parent reports an accepted operation still in progress | Adds busy semantics and progress presentation while blocking repeat activation |
| `disabled` | boolean | `false` | Parent reports the action is unavailable | Uses native disabled semantics and removes active interaction states |
| `loadingLabel` | non-empty string | visible label | Caller names the active operation when the resting label is insufficient | Appears only while loading and must preserve a meaningful accessible name |
| `icon` | one passive inline SVG tree | none | Caller supplies one directly inspectable inert glyph | Interactive elements, handlers, links, focus overrides, fragments, and opaque component trees are rejected |
| `iconPosition` | `leading` \| `trailing` | `leading` | Caller selects logical glyph placement | Changes alignment without changing action meaning or writing direction |
| `fullWidth` | boolean | `false` | Parent requests container-width placement | Changes width only; does not upgrade priority or size |
| `onClick` | function | none | Caller supplies the sole action handler | Runs once through the loading/disabled guard while active |
| `type` | `button` \| `submit` \| `reset` | `button` | Caller deliberately selects native form behavior | Prevents accidental form submission while preserving explicit submit/reset use |

`priority`, `tone`, and `size` are controlled semantic choices. `loading` and `disabled` are controlled states owned by the parent. `fullWidth` changes placement but not visual importance. The explicit safe pass-through is limited to data attributes, name/value/form attributes, `id`, and descriptive relationships such as `aria-describedby`; `onClick` is the sole action handler. Component-owned semantics—`role`, `tabIndex`, `aria-label`, `aria-hidden`, `aria-disabled`, toggle/menu ARIA states, alternate keyboard/double-click handlers, `as`, and `href`—are blocked so a caller cannot contradict the visible label, focus lifecycle, or guarded action contract. The icon slot accepts only a directly inspectable passive inline SVG tree; the inert wrapper, rejected interactivity, and pointer-event isolation prevent a glyph from becoming a second action or focus stop. Opaque custom icon components are intentionally rejected because Button cannot prove their rendered descendants safe. Unrestricted `style` and `className` are also blocked; layout placement belongs to a wrapper or to governed `fullWidth`. The ref is forwarded for legitimate focus management. Restricting `children` and `loadingLabel` to strings makes the required visible action name explicit; development validation rejects empty or whitespace-only strings. Changing an allowed value, default, invalid combination, or state meaning is a material component-contract change that requires renewed design approval; widening the safe pass-through is also a contract change because it may alter semantics or activation.

The component deliberately excludes raw color, radius, padding, font-size, spinner-color, shadow, arbitrary `as`, unrestricted `style` or `className`, and unrestricted internal-layout slots. A caller wraps Button when it needs margins or grid placement; `fullWidth` covers the one recurring internal width treatment. If consumers repeatedly need a semantic choice the API cannot express, the contract is revised with evidence instead of letting every page restyle the primitive.

## Invalid combinations and safeguards

The component warns when `loading` and `disabled` are supplied together because the states make competing claims. Loading takes deterministic precedence: the accepted operation remains visible, focus is preserved, `aria-busy` and unavailable semantics remain truthful, and repeat activation is guarded. This fallback avoids discarding evidence of work already in progress while still making caller confusion visible during development.

- A valid `loadingLabel` may be supplied before `loading` becomes true. It reserves the larger resting/loading measurement without changing visible wording and does not warn. An empty or whitespace-only value warns and falls back to the visible action label.
- `iconPosition` without `icon` is ignored without reserving space.
- An empty or whitespace-only `children` value warns in development, renders nothing, and never attaches the action handler. Button does not invent action wording. An empty `loadingLabel` falls back to the already valid resting `children` label because that label still truthfully names the accepted action.
- Two icon positions are impossible because the API exposes one icon.
- An `href` or `as="a"` escape hatch is excluded, so navigation cannot accidentally inherit button semantics.
- Unrestricted `style` and `className` are excluded; callers use a wrapper for placement and cannot bypass semantic tokens through the public API.

- A primary destructive button is valid only inside a focused confirmation or equivalent high-intent context. Code cannot fully know that context, so documentation, examples, and review enforce the boundary. Ordinary pages should use secondary destructive treatment so the harmful action is visible without competing with the safe primary route.

- The click handler must guard loading even if CSS fails or a synthetic event is dispatched. Visual pointer blocking alone is not sufficient. The component preserves native event behavior when active; it does not debounce ordinary clicks globally or swallow form submission semantics.

## Relationship to neighboring components

Button performs an immediate action in the current interface. LinkButton or a styled anchor navigates to another resource. IconButton provides a square glyph-only action with a mandatory accessible name and tooltip guidance. ToggleButton represents a persistent pressed state. MenuButton owns popup relationship, expanded state, chevron treatment, keyboard opening, and focus transfer. SplitButton combines one immediate action with an adjacent menu and therefore needs a separate composite contract.

ButtonGroup owns spacing, alignment, order, equal-width decisions, and responsive stacking across multiple buttons. Dialog owns confirmation wording, consequence explanation, cancel behavior, initial focus, and focus restoration after close. StatusIndicator communicates an outcome; it should not be embedded in Button merely to turn a completed operation green.

These boundaries keep Button small enough to remain trustworthy. Shared visual tokens can make related controls feel like one family without forcing navigation, toggling, menus, confirmations, and status into one polymorphic component.

## Do / don't guidance

Do:

- Use one primary-priority action in an immediate decision group.
- Start labels with precise verbs and name destructive consequences.
- Use secondary priority for available actions that should remain quieter.
- Preserve dimensions and keyboard focus while loading.
- Use a native button for current-interface actions and an anchor for navigation.
- Supply loading and disabled state from the parent workflow.
- Verify every priority and tone under focus-visible, high contrast, and reduced motion.

Don't:

- Treat primary, loading, disabled, and destructive as equivalent flat variants.
- Use danger color to make an ordinary action look important.
- place two blue primary actions beside each other without a real hierarchy.
- Hide the action label to create an icon-only control.
- Add gradients, glow, or large shadows to manufacture importance.
- Change width when the spinner appears.
- Put confirmation, network, retry, routing, or success logic inside Button.
- Dim disabled content with opacity until its label becomes unreadable.

## Acceptance criteria

- [x] The prototype shows the medium neutral secondary default first at normal production scale, followed immediately by explicit primary emphasis.
- [x] Primary, secondary, and destructive treatments are visibly distinct without becoming separate silhouettes.
- [x] Loading and disabled are documented and implemented as states rather than flat visual variants.
- [x] Priority, tone, size, and layout remain separate API axes.
- [x] The label stays optically centered with no icon, with one icon, and while loading.
- [x] Enter, Space, pointer activation, and form type behavior remain native when active.
- [x] Duplicate activation is blocked behaviorally while loading, not only through CSS.
- [x] Loading preserves dimensions, focus, a meaningful accessible name, and busy semantics.
- [x] Disabled blocks activation and remains identifiable without relying only on opacity.
- [x] Focus-visible remains obvious and unclipped on every priority/tone combination.
- [x] Destructive meaning is present in caller wording as well as color.
- [x] Small, medium, and large retain the same identity and meet their documented target expectations.
- [x] Exactly 390px layouts have no horizontal overflow and action groups can stack through their parent.
- [x] Long localized labels do not silently truncate the consequence.
- [x] Reduced motion removes nonessential transform and spinner motion while preserving feedback.
- [x] Invalid combinations produce deterministic safe behavior and development warnings where specified.
- [x] The component renders a native button, defaults to `type="button"`, and forwards its ref.
- [x] No raw visual styling prop bypasses the governed Slate tokens.
- [x] The production render is compared with the approved bitmap at original resolution.
- [x] The explanation, prototype, implementation, tests, and canonical documentation describe the same contract.

## Independent critique

The strongest tradeoff is API purity versus everyday usability. Separating `priority` from `tone` is more accurate than one `variant` prop, but it adds a concept callers must learn and permits a primary destructive combination that requires contextual discipline. The alternative flat API is easier to scan yet hides the real axes and becomes brittle as loading, disabled, and future tones combine. The separated model is worth the cost only if documentation and examples remain excellent.

Loading focus behavior is another real risk. Using native `disabled` while an operation runs is easy, but it can remove focus and leave keyboard users unsure where they are. Keeping the button focusable with `aria-busy` and a guarded handler is more work and must be tested against form submission and assistive technology. This complexity belongs in the shared primitive precisely because page-by-page solutions would diverge.

The existing global `.btn` rules also create migration tension. A new `qds-Button` can be more disciplined without silently changing every legacy consumer. The correct first release makes the component available and proves its contract in isolation; adopting it across pages is a separate inventory and approval scope. Until that migration occurs, two button systems will temporarily coexist, and documentation must state that honestly.

The released 32px, 40px, and 48px measurements are governed rather than provisional: they were rendered with the application font and tokens, checked in the routed documentation at desktop and exactly 390px, and covered by focused source and documentation tests. Representative feature adoption remains migration work, so a future material revision may still be justified by real consumer evidence; it may not silently change these sizes.

## Decision summary

The released contract is a medium, content-width, neutral secondary Button using a raised Slate control surface, comfortable 40px geometry, controlled 8px rounding, a required verb-led string label, native semantics, and no decorative icon or shadow. Primary priority, destructive tone, three sizes, one optional icon, loading, disabled, and full width are controlled extensions. Loading and disabled remain states; width remains layout; consequence remains tone.

Button deliberately excludes navigation, icon-only controls, menus, toggling, confirmations, network behavior, success/error presentation, action-group layout, arbitrary visual props, and automatic business wording. Secondary is the approved safe default. Primary destructive is admitted only inside a focused confirmation composition. The governed size measurements are 32px small, 40px medium, and 48px large; changing those decisions is a material contract revision.

This release improves on a conventional Button handoff in four substantive ways: it traces current repository evidence directly into decisions and rejected alternatives; separates local priority from destructive consequence; defines invalid combinations and styling escape hatches; and makes the production component, source-adjacent explanation, canonical registry, interactive documentation, tests, and rendered evidence one governed release unit.

## One-sentence definition

Button is a native, caller-labeled action control that separates local priority, destructive consequence, size, and progress state so every activation remains clear, accessible, stable, and visually native to Slate.
