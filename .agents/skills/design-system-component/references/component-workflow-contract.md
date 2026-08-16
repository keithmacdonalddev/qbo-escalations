# Design-System Component Workflow Contract

Use this reference for every component designed through the `design-system-component` skill.

## Contents

1. Outcome and authority
2. Component candidacy
3. Component taxonomy
4. Required design contract
5. Prototype image contract
6. Detailed explanation template
7. Iteration and approval rules
8. Documentation matrix
9. Production implementation contract
10. State, interaction, and accessibility matrices
11. Responsive and motion requirements
12. Evidence and acceptance
13. Adoption, versioning, and deprecation
14. Common failure modes
15. Handoff templates

## 1. Outcome and authority

The outcome is not merely an attractive image or a reusable-looking JSX file. The outcome is a stable interface object whose visual design, semantics, behavior, API, documentation, and production rendering all express the same approved intent.

The user approves the component direction. The repository's canonical design documents preserve that decision. Production code implements it. Focused checks prove the code contract. Rendered evidence proves what actually appeared. None of those sources substitutes for another.

The component must belong to QBO Escalations as a broader personal operational-intelligence platform. Its name and contract must remain useful across Investments, QBO work, Knowledge, connected providers, agents, and other future domains when those domains genuinely share the same interface job.

## 2. Component candidacy

Before designing, answer all of these questions:

| Question | Passing answer |
| --- | --- |
| What single user question does it answer? | One short sentence without naming its first page. |
| Does an approved component already answer it? | No, or the proposal is a documented material revision of that component. |
| Is the meaning stable across at least two plausible contexts? | Yes; examples differ in data, not in the component's purpose. |
| Can required anatomy remain required everywhere? | Yes. |
| Can every optional part vanish without empty layout? | Yes. |
| Are variants recurring semantic differences? | Yes; they are not arbitrary visual preferences. |
| Can the component be understood in isolation? | Yes, without hidden page context. |
| Can data and side effects remain outside by default? | Yes, unless behavior is the component's approved purpose. |
| Is the public API smaller than the feature UI it replaces? | Yes. |

If these answers fail, prefer one of the following:

- keep the UI feature-owned;
- compose approved primitives in a feature wrapper;
- define a workflow pattern instead of a primitive; or
- narrow the proposed job until it becomes stable.

## 3. Component taxonomy

### Primitive

One stable visual or semantic job. Examples: title identity, status indication, semantic value, divider, icon button.

Primitives should not fetch data, coordinate workflows, or contain unrelated actions.

### Composition

A named arrangement of two or more primitives whose relationship is stable. Examples: account identity row, metric group, connection summary.

Compositions may coordinate layout and content hierarchy. They should still receive data and callbacks from parents.

### Interactive control

A user-operated object with complete hover, focus, pressed, disabled, waiting, success, error, and keyboard behavior. Examples: selection menu, disclosure control, segmented chooser.

The control owns its local interaction contract but not unrelated product state.

### Workflow pattern

A complete multi-step experience involving state, feedback, recovery, and possibly external side effects. Examples: connect account, disconnect confirmation, snapshot synchronization.

Workflow patterns are not disguised primitives. They require a Product/UX brief and normally compose multiple library components.

## 4. Required design contract

Every proposed component must define the following before implementation.

### 4.1 Purpose

- The one user question it answers.
- The situations in which that question matters.
- Why an existing component or plain HTML element is insufficient.

### 4.2 Non-goals

List responsibilities that deliberately remain outside. Common exclusions include navigation, data fetching, timestamps, diagnostics, retry, menus, destructive actions, and domain-specific calculations.

### 4.3 Anatomy

Express the component as a small tree. Mark every node required or optional. Example:

```text
ComponentName
├─ leading visual?       optional
├─ primary content       required
│  ├─ label              required
│  └─ description?       optional
└─ trailing affordance?  optional only for interactive variant
```

For every optional node, state what closes the gap when it is absent. No invisible placeholders or reserved columns.

### 4.4 Hierarchy

State the intended reading order and visual stop sequence. Identify which element is primary, which supports it, and which is merely a reinforcing cue. If two elements communicate the same fact, justify the redundancy or remove one.

### 4.5 Canonical default

The default must be the safest, quietest, most broadly correct form. It must not imply:

- success without evidence;
- interactivity without a real action;
- elevation without a real layer;
- urgency for routine information;
- optional content that was not supplied; or
- a feature-specific brand or layout.

### 4.6 Variants

Each variant must name a recurring semantic need. For each, document:

- why the default is insufficient;
- what changes and what remains invariant;
- when to use it;
- when not to use it; and
- whether it changes accessibility or interaction behavior.

Avoid variants named after pages, providers, colors, or one-off visual preferences.

### 4.7 Semantic states

Separate state from wording. A component may expose `tone="warning"` while displaying “Delayed market data,” but it must not hardcode that phrase as the only warning state.

Document state meaning, icon, color role, motion, announcement behavior, and truth requirements. Semantic color reinforces meaning; it never carries meaning alone.

### 4.8 Ownership

State who owns:

- product data;
- loading and retry;
- network or storage calls;
- controlled versus uncontrolled state;
- navigation;
- confirmation;
- analytics or audit evidence; and
- focus restoration after a workflow closes.

The parent owns these by default. The component owns only behavior intrinsic to its approved job.

### 4.9 Public API

For every prop, define:

- type and allowed values;
- required/default status;
- semantic meaning;
- invalid combinations;
- accessibility impact; and
- whether changing it is a compatible or material contract change.

Prefer:

- `tone="warning"` over `color="#f59e0b"`;
- `size="compact"` over `fontSize={12}`;
- `surface="raised"` over arbitrary background CSS;
- named slots with one job over unrestricted `children`; and
- controlled values and callbacks over hidden state when the parent needs authority.

An escape hatch may support layout placement. It must not make the governed API optional.

### 4.10 Adjacent components

Explain how this component differs from its nearest alternatives. Examples:

- StatusIndicator versus Badge versus StatusSummary
- TitleBlock versus PageHeader versus AccountIdentity
- DisclosureControl versus Popover versus Modal

This prevents a library where every component slowly becomes the same catch-all panel.

## 5. Prototype image contract

### 5.1 What the image must prove

The image should let the user judge:

- silhouette and visual weight;
- hierarchy and spacing;
- default treatment;
- optional anatomy;
- meaningful size or state variants;
- relationship between text, icons, markers, and surface; and
- whether the component feels native to the app's Slate language.

### 5.2 What the image must not do

Do not hide a weak component inside an attractive page. Avoid:

- full application chrome;
- irrelevant navigation;
- fake charts or customer data;
- provider-specific wording when the component is generic;
- oversized marketing whitespace;
- glow, glass, gradients, or shadows that are not part of the contract;
- annotations that compete with the specimen; and
- a light-theme concept when the production system being designed is Slate dark, unless theme behavior itself is being judged.

### 5.3 Canonical specimen layout

Use this order unless the user asks for one isolated state:

1. Canonical default at comfortable size.
2. Compact form if compact is a legitimate recurring need.
3. One or two semantic variants needed to prove the system.
4. Optional treatments, shown as clearly optional rather than implied defaults.

The image is not a catalog of every prop. More variants do not mean more reuse.

### 5.4 Prototype file handling

- Use a numbered filename: `<ComponentName>-prototype-v1.png`.
- Preserve prior revisions.
- Store working images on the Desktop or requested location.
- After approval, copy only the sanitized accepted baseline into `docs/design-system/assets/<component-name>/`.
- Record the source prompt or isolated prototype source beside the approved asset when it is needed for future reproducibility.

## 6. Detailed explanation template

The explanation must be specific to the proposed component. Do not produce generic praise.

### 6.1 Practical definition

Open with one sentence:

> `<ComponentName>` is a [primitive/composition/control/pattern] that helps the user [single job] without [nearest failure mode].

### 6.2 Central design idea

Explain the one principle governing the shape. Examples include quiet hierarchy, progressive information density, action clarity, or truthful status.

### 6.3 Visual hierarchy

Describe:

- first visual stop;
- secondary information;
- reinforcement cues;
- typography roles;
- contrast decisions; and
- why borders, surfaces, shadows, or color are present or absent.

### 6.4 Anatomy and optionality

Explain every visible part. For each optional part, explain when it earns its place and what disappears when omitted.

### 6.5 Spacing, size, and density

Explain internal grouping, touch/click targets, compact behavior, wrapping, and how the component avoids both crowding and manufactured empty space.

### 6.6 Color and iconography

Explain whether color is semantic, branded, structural, or absent. Icons must reinforce text, normalize optical weight, and remain understandable without color.

### 6.7 Interaction and state journey

If static, say so. If interactive, cover:

- resting;
- hover;
- keyboard focus;
- pressed;
- open/selected;
- disabled or unavailable;
- waiting;
- success;
- partial success;
- failure;
- recovery; and
- focus restoration.

Never discuss hover in isolation from what happens after release/click.

### 6.8 Responsive behavior

Explain what flexes, wraps, compresses, moves, or disappears. Do not preserve desktop proportions by shrinking typography below comfortable reading sizes.

### 6.9 Accessibility

Cover semantic element choice, accessible name, color independence, contrast, keyboard operation, screen-reader announcements, reduced motion, and target sizes.

### 6.10 API implications

Show a minimal valid example and one full example. Explain which props are semantic, which are optional, and which tempting props are deliberately excluded.

### 6.11 Composition boundary

List what belongs in a parent or sibling. Give one valid composition example without adding those responsibilities to the primitive.

### 6.12 Independent critique

State at least one real tradeoff or risk. Examples:

- too much surface could turn a primitive into a card;
- a trailing dot may duplicate the icon;
- compact mode may require dropping the description;
- allowing arbitrary children may destroy hierarchy.

If the user's reference contains a weak choice, explain it and recommend the stronger direction. Agreement is not a design rationale.

### 6.13 Decision summary

End with:

- canonical default;
- optional pieces;
- non-goals;
- open decisions requiring user approval; and
- whether implementation is authorized yet.

## 7. Iteration and approval rules

### Iteration

- Number revisions.
- Preserve accepted decisions.
- Change only the requested dimension unless a dependency makes that impossible.
- Explain the dependency before widening the revision.
- Update both image and contract; visual changes without contract changes create drift.
- Do not hide unresolved problems behind a new visual style.

### Approval

Approval must be explicit. Examples:

- “Approved.”
- “Use this as the final component.”
- “Implement this version.”

Questions, partial praise, or approval of one detail do not approve the full component.

Before production work, restate the frozen contract in a short approval record. If the user changes the direction later, create a new revision rather than pretending the earlier approval never existed.

## 8. Documentation matrix

| Source | Update when | Required content |
| --- | --- | --- |
| `docs/design-system/COMPONENT_LIBRARY.md` | Every approved new component or material change | Inventory, purpose, boundary, anatomy, rationale, API, variants, states, content, accessibility, responsive behavior, do/don't, acceptance. |
| `docs/design-system/assets/<component>/` | Every approved visual baseline | Sanitized approved image and reproducibility source when applicable. |
| `DESIGN.HTML` | Every approved component | Plain-English visual specimen using the canonical default and legitimate variants. |
| `DESIGN.md` | Only for a durable cross-component rule | New product-wide rule, token, motion principle, density rule, or changed release standard. |
| `client/src/components/design-system/index.js` | Every production component | Public export. |
| Component tests | Every production component | Focused public-contract evidence. |
| Feature documentation | Only for approved adoption | How the feature composes the shared component; no duplicate component contract. |

Do not update every design document mechanically. “Relevant docs fully” means one canonical contract plus only the indexes, visual guides, and global rules that truly changed.

## 9. Production implementation contract

### 9.1 File set

Typical component files:

```text
client/src/components/design-system/
├─ ComponentName.jsx
├─ ComponentName.css
├─ ComponentName.test.jsx
└─ index.js
```

Add a fixture or specimen only when it has a maintained purpose. Keep prototypes out of production paths until approval.

### 9.2 React contract

- Render one stable semantic object.
- Use controlled props for state the parent must own.
- Do not mirror props into local state without a demonstrated reason.
- Avoid effects for purely presentational behavior.
- Do not fetch or store data in primitives.
- Pass safe `aria-*` and `data-*` attributes when useful.
- Keep event handlers explicit; do not turn a static primitive into an accidental button.
- Reject or guard invalid prop combinations in development when they can mislead users.
- Keep defaults neutral and truthful.

### 9.3 CSS contract

- Prefix every class with `qds-`.
- Use canonical tokens from `client/src/App.css`.
- Avoid raw colors and duplicated magic values when a token exists.
- Avoid substring-collision names such as generic `title`, `badge`, `modal`, or `popover` classes.
- Ensure optional markup does not reserve space.
- Keep focus visible without using a permanent selection rectangle.
- Use semantic color sparingly and meet contrast requirements.
- Put motion behind canonical duration/easing tokens and `prefers-reduced-motion` behavior.
- Do not use `!important` to force the component over unrelated feature CSS; fix the boundary or specificity intentionally.

### 9.4 API control

Support the full set of approved use categories, not every imaginable styling request. A prop belongs only when:

1. at least one concrete valid use exists;
2. it preserves the component's purpose;
3. it can be documented semantically;
4. it has a deterministic visual/behavioral contract; and
5. it does not create an invalid combination explosion.

If a future use case fails those rules, create a parent composition or a new component.

### 9.5 Functional completeness

For static components, “functional” includes semantics, omission behavior, responsive layout, and safe DOM integration.

For interactive components, it additionally includes all keyboard paths, focus lifecycle, waiting/error/recovery feedback, dismissal rules, outside-click behavior when appropriate, and state ownership.

Do not add hidden network, persistence, navigation, analytics, or authority behavior merely to call a visual component “fully functional.”

## 10. State, interaction, and accessibility matrices

### 10.1 Static semantic component

| Concern | Required behavior |
| --- | --- |
| Default | Neutral, truthful, complete without optional content. |
| Missing optional content | Markup and spacing absent. |
| Long content | Wrap or truncate only according to documented content rules. |
| Unknown data | Explicit unknown/neutral treatment; never fake zero or success. |
| Screen reader | Same meaning available in text or accessible name. |
| Narrow width | Preserves hierarchy and readable type. |

### 10.2 Interactive control

| State | Required behavior |
| --- | --- |
| Rest | Clearly operable but not visually dominant without reason. |
| Hover | Subtle preview of interactivity; no layout shift. |
| Focus-visible | Strong, coherent, non-clipped keyboard focus. |
| Pressed | Brief physical response that resolves on release. |
| Open/selected | Persistent state distinct from transient focus. |
| Disabled | Reason is visible or discoverable; not merely low contrast. |
| Waiting | Prevents duplicate action; communicates progress. |
| Success | Confirms the completed outcome, not merely the click. |
| Error | Explains what failed and provides a useful recovery path. |
| Dismiss/close | Returns focus to the invoking control. |

### 10.3 Dynamic status

| Transition | Announcement rule |
| --- | --- |
| Initial static status | Do not announce automatically. |
| User-triggered meaningful change | Polite live announcement when the visual change alone is insufficient. |
| Continuous progress | Avoid repeated announcements; announce milestones or completion. |
| Failure requiring action | Announce once and move or expose focus to the recovery action appropriately. |

## 11. Responsive and motion requirements

### Desktop

- The component adapts to its container; fixed width is an explicit variant, not a default.
- Density matches the information and input method.
- Empty horizontal space strengthens hierarchy rather than separating related content across the screen.

### Exactly 390px

- No horizontal overflow.
- Primary content remains readable without microscopic type.
- Optional description wraps or disappears according to contract.
- Controls retain adequate targets.
- Trailing content does not push labels into unusable widths.
- Popovers and disclosures remain inside the viewport or become an appropriate sheet/panel pattern.

### Motion

- Motion explains origin, continuity, state change, or destination.
- Static primitives do not animate for decoration.
- Progress motion is restrained.
- Reduced-motion mode removes nonessential movement while preserving feedback.
- No content appears beneath a transient scrollbar or shifts because overflow changes during a transition.

## 12. Evidence and acceptance

### Focused deterministic checks

Test only the component's public contract unless a shared token/export change requires broader evidence. Typical checks:

- required content;
- optional omission;
- semantic state mapping;
- valid/invalid prop behavior;
- accessible roles/names;
- keyboard interaction;
- focus restoration;
- reduced-motion class or behavior;
- public export.

### Rendered evidence

Capture the real production component, not a screenshot of the prototype. Include:

- canonical desktop;
- exactly 390px;
- each material state;
- active disclosure or overlay;
- keyboard focus;
- reduced motion if applicable;
- no overflow measurement; and
- console/page error check.

### Prototype comparison

Record:

- what matches exactly;
- what differs due to real typography, browser rendering, or app tokens;
- why each difference is intentional; and
- whether the difference needs fresh user approval.

### Release question

Ask:

> Would Apple release this complete experience as part of one of its products?

The standard is not copied Apple branding. It is an immediate, evidence-supported, unqualified yes on purpose, hierarchy, spacing, behavior, accessibility, motion, truthful state, and integration quality.

## 13. Adoption, versioning, and deprecation

### Status vocabulary

- `proposed` — contract or prototype not yet approved.
- `approved` — user approved the design direction; production may not exist.
- `available` — production component is exported and documented.
- `adopted` — used by named approved consumers.
- `migration pending` — existing consumers are intentionally not yet moved.
- `deprecated` — replacement and migration path documented.

### Compatible change

Bug fix, accessibility repair, token correction, or documentation clarification that does not alter the public contract.

### Material change

New prop, state, variant, size, default, anatomy, motion, or announcement behavior. Requires renewed prototype/contract approval and rendered evidence.

### Breaking change

Removed or renamed prop, changed state meaning, changed ownership, static-to-interactive conversion, or removed variant. Requires consumer inventory, migration plan, and explicit authorization.

Do not silently fix all consumers while changing the primitive. Preserve working pages until the migration scope is approved.

## 14. Common failure modes

- **Page-specific component with a generic name:** the API still exposes provider, account, investment, or screen concepts.
- **Prototype as marketing art:** excessive blank space, unrelated light theme, no real app tokens, and no implementable dimensions.
- **Catch-all component:** identity, status, actions, navigation, diagnostics, and data fetching all live in one object.
- **Optional but reserved:** omitted icons or actions leave empty columns.
- **Semantic color as decoration:** green is used because it looks pleasant rather than because success is verified.
- **Hover-only design:** the design explains cursor movement but not click release, transition, open state, dismissal, or focus return.
- **Screenshot approval drift:** the coded component looks merely similar and nobody compares it with the accepted image.
- **Tests as visual proof:** unit tests pass while hierarchy, balance, or overflow remain visibly poor.
- **Uncontrolled props:** arbitrary colors, spacing, CSS, slots, and children let every consumer create a different component.
- **Automatic adoption:** creating a component triggers broad page rewrites without user approval.
- **Duplicated truth:** different component rules appear in DESIGN.md, feature docs, prompts, and code without one canonical contract.
- **Agreement without judgment:** references are copied even when they contain redundant markers, oversized surfaces, weak contrast, or unsuitable app styling.

## 15. Handoff templates

### Prototype handoff

```text
Prototype: <absolute path>
Revision: v<N>
Component type: <primitive/composition/control/pattern>
Canonical default: <one sentence>
Optional pieces: <list>
Deliberate exclusions: <list>
Open approval decisions: <list or none>
Implementation status: not started
```

### Approval record

```text
Approved by user: <date/time or turn reference>
Approved baseline: <repo-relative path>
Component: <name>
Purpose: <one sentence>
Required anatomy: <list>
Approved variants/states: <list>
Interaction owner: <component or parent>
Responsive/accessibility contract: <summary>
Authorized adoption: <none or named consumers>
```

### Production handoff

```text
Component: <name>
Status: available | adopted in <consumers> | migration pending
Import: <exact import>
Minimal example: <code>
Approved baseline: <path>
Rendered evidence: <paths>
Focused checks: <commands and results>
Intentional prototype differences: <list or none>
Design gate: <verdict or not required with reason>
Restart needed: <yes/no and exact user action>
```
