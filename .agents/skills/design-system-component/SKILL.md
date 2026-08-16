---
name: design-system-component
description: Use when creating, revising, approving, documenting, or implementing a reusable QBO Escalations design-system component. Produces a production-faithful component-only prototype, a source-traceable professional design explanation, a controlled semantic contract, an explicit user-approval checkpoint, canonical documentation, production React/CSS/exports/focused tests, and rendered implementation evidence. Do not use it merely to restyle one page-specific feature.
---

# Design System Component

Create one governed, reusable interface component at a time. Treat the prototype, component contract, source-adjacent explanation, in-app documentation page, implementation, and real rendered result as one continuous design decision—not separate tasks that can silently drift apart.

The user is the component's approval authority. A prototype is a decision artifact, not permission to edit production code. Approval freezes the design contract; only a separately authorized, implemented, verified, and `available` component becomes importable from the shared design-system package. Availability does not automatically replace similar feature UI across the app.

## Required sources

Before designing, read these sources completely:

1. `DESIGN.md`
2. `docs/design-system/COMPONENT_LIBRARY.md`
3. `.agents/skills/design-experience-gate/SKILL.md`
4. The target component folder when it exists, the public design-system barrel, shared files, and only the neighboring components needed to decide a boundary; do not read the whole library mechanically as it grows
5. The relevant shared tokens in `client/src/App.css`
6. Any user-supplied image, explanation, critique, or approved precedent for this component

Before producing the first prototype, read these files completely:

- `references/component-workflow-contract.md` for the full component contract, prototype rules, explanation structure, documentation matrix, and implementation acceptance criteria; and
- `examples/button-component-design-explanation.md` for the minimum acceptable depth and evidence quality of a user-facing explanation.

The example is a quality floor, not a template or ceiling. Every live result must improve on it in at least one substantive, named way—such as fresher evidence, a clearer contract, a newly resolved contradiction, stronger safeguards, or tighter prototype agreement—while meeting every other quality category. Improvement never means adding unsupported API, visual novelty, or extra variants merely to look different. Extra length is not an improvement. Do not inflate the response with generic design prose.

## Workflow

### 1. Lock the requested scope

State the component goal, allowed prototype/documentation/code paths, excluded page migrations, verification limit, and conditions that require renewed approval.

Keep these scopes separate:

- **Component design:** decide what the reusable object is.
- **Component implementation:** make the approved object available to the app.
- **Feature adoption:** replace or compose it inside named screens.

Approval of one scope never silently authorizes the next except when the user explicitly requested the complete end-to-end workflow.

### 2. Prove it is a reusable component

Search the current library and relevant consumers before naming or drawing anything. Decide whether the request is:

- a **primitive** with one stable job;
- a **composition** of existing primitives;
- an **interactive control** with a complete local input and state contract;
- a **workflow pattern** with state and actions; or
- page-specific UI that should remain owned by its feature.

Name the component by its stable interface job, never by the first page, provider, or dataset that uses it. Do not extract a component merely because a fragment appears twice.

If the request is not a valid reusable component, say so plainly and propose the correct primitive or composition. Do not manufacture a generic name around page-specific behavior.

### 3. Define the contract before drawing

Write a complete working contract covering:

- purpose and user question answered;
- non-goals and composition boundary;
- required and optional anatomy;
- canonical default;
- legitimate variants and sizes;
- semantic state vocabulary;
- data, interaction, and side-effect ownership;
- responsive, keyboard, focus, announcement, and reduced-motion behavior;
- content rules and misuse cases;
- controlled public API direction; and
- how this component differs from adjacent library components.

Prefer the smallest truthful object. Optional anatomy must disappear structurally when omitted. Semantic props express intent; arbitrary styling knobs are not a substitute for design decisions.

This contract cannot remain hidden in private notes. Its decisions, evidence, rejected alternatives, and tradeoffs must appear in the user-facing explanation.

### 4. Produce the component-only prototype image

Choose the medium that can reproduce the proposed component most faithfully:

1. Use isolated HTML/CSS and render it to PNG for geometry-heavy interface components, text, exact spacing, controlled states, theme tokens, and side-by-side variants. This is the default for buttons, fields, menus, indicators, metadata, cards, and other deterministic UI.
2. Use image generation only for exploratory visual direction that benefits from synthesis, or when the user explicitly requests it. Never prefer generative variation over reproducible UI geometry.
3. Keep prototype source outside production paths and follow the repository's prototype-isolation rules.

The prototype must:

- show the reusable component—not a feature page pretending to be generic;
- use the app's Slate visual language and approved tokens rather than unrelated light-theme marketing art;
- show the canonical default first;
- show only the variants or optional treatments necessary to judge the contract;
- make optional surface, border, elevation, width, padding, icon, or supporting content visible when those are part of the proposal;
- contain no real account, portfolio, credential, email, or customer data;
- avoid page chrome, fake navigation, unrelated controls, and decorative labels unless requested; and
- be saved to the user's requested path, or to `%USERPROFILE%\Desktop\<ComponentName>-prototype-v<N>.png` when no path is specified.

Inspect the final bitmap at original resolution before presenting it. Compare it line by line with the contract and current Slate sources. If theme, anatomy, labels, hierarchy, variants, spacing, or states contradict the contract, the prototype fails: revise it before handoff. A caveat does not make a visibly wrong prototype approval-ready.

Do not run application tests or invoke a release reviewer for a prototype-only request. The user judges the direction first.

### 5. Explain the design with professional depth

Alongside the image, provide the complete decision rationale required by `references/component-workflow-contract.md`. Explain what the component is for, how the design was determined from current evidence, why its hierarchy and anatomy work, what is optional, how it behaves through every applicable state, how it remains accessible, how it compresses, where it should not be used, and what the future React API implies.

Create `%USERPROFILE%\Desktop\<ComponentName>-prototype-v<N>-explanation.md` beside the default prototype, or an equivalent Markdown file beside a user-requested output. Present the same complete explanation in chat; a short summary or handoff block is never a substitute.

When production implementation is authorized, the explanation also becomes a required living file at `client/src/components/design-system/<ComponentName>/<ComponentName>.md`. This is not an abbreviated README. It preserves the full validated explanation—including evidence, rejected alternatives, boundaries, state model, API safeguards, critique, decision summary, and acceptance criteria—beside the code it governs. Update it whenever the component contract changes. The colocated explanation, component registry, and in-app page must agree; none may silently become a competing contract.

The explanation must:

- declare `Component type: primitive | composition | interactive-control | workflow-pattern` immediately below its title;
- use every required section in the reference's explanation quality gate;
- include a source-to-decision table with exact current repository evidence, the resulting design decision, and at least one rejected alternative;
- separate semantic intent, transient/persistent state, size/density, and layout options instead of flattening combinations into one `variant` prop;
- distinguish what the component owns from what parents, workflows, or neighboring primitives own;
- define invalid combinations and failure prevention, not merely valid examples;
- make provisional measurements visibly provisional and tie final values to tokens or rendered validation;
- identify at least one genuine weakness or tradeoff in the proposal; and
- contain no unsupported claims, generic praise, simulated business schema, or invented app precedent.

Be intellectually independent. Identify weak ideas, redundant cues, conflicting requirements, and over-generalization even when they came from a reference the user supplied. Do not agree merely to be agreeable.

Provide decision rationale and observable tradeoffs. Do not claim to reveal private hidden chain-of-thought.

Before handoff, run:

```powershell
node .agents/skills/design-system-component/scripts/validate-component-explanation.mjs <absolute-explanation-path>
```

The validator is a minimum structure and evidence check, not proof of quality. After it reports `STRUCTURE PASS`, apply the human quality rubric and original-resolution prototype audit in the reference. All categories must pass at the highest level. In the decision summary, name the substantive way this result improves on the example; word count never qualifies.

### 6. Iterate without losing accepted decisions

When the user requests a revision:

- change the named concern first;
- preserve accepted anatomy and behavior unless the new change genuinely conflicts;
- state any conflict before replacing an accepted decision;
- save a new numbered prototype instead of overwriting the accepted evidence; and
- update the proposed contract and rationale wherever the image changed.

Do not implement production code until the user explicitly approves the prototype or explicitly instructs implementation despite an unresolved prototype.

### 7. Freeze the approved contract

After explicit approval, record:

- approved prototype path and revision;
- component name and classification;
- required anatomy and canonical default;
- approved variants, states, interactions, and controlled props;
- accessibility and responsive behavior;
- non-goals and misuse boundaries; and
- authorized adoption scope.

Copy the sanitized approved baseline into `docs/design-system/assets/<component-name>/` so later changes can be compared with the accepted design.

### 8. Update the relevant design-system documentation

Update documentation and implementation as one change:

- `docs/design-system/COMPONENT_LIBRARY.md` — concise canonical registry, contract inventory, and links to deeper sources;
- `client/src/components/design-system/<ComponentName>/<ComponentName>.md` — the complete source-traceable component explanation;
- `/docs/components/<component-slug>` under `client/src/docs/` — a complete polished teaching page using the real production export;
- `DESIGN.HTML` — update only when it is still the active visual guide rather than a migration pointer to `/docs`;
- `DESIGN.md` — only when the component establishes or changes a durable app-wide rule;
- design-system exports and nearby usage examples; and
- any component status, adoption, or migration record that already governs the library.

The in-app component page is mandatory for every new production component and every material component revision. A route, title, or specimen gallery alone is incomplete. The page must teach purpose, boundary, anatomy, design determination, canonical default, approved semantic axes, all material states, sizing, interaction, content rules, accessibility, responsive and reduced-motion behavior, public API, invalid combinations, safeguards, neighboring components, availability/adoption status, tradeoffs, and acceptance evidence. Put a live production specimen and minimal valid example in the first useful viewport. Use the exported component itself—never duplicate its appearance with documentation-only CSS.

Translate strong reference-document information architecture into the current Slate documentation experience; do not copy an unrelated theme or create a wall of cards. Prefer one chaptered article with clear sections, restrained specimen/code/callout surfaces, useful on-page navigation, desktop and exactly 390px behavior, and sanitized fixture content. The page must be directly routed, searchable, included in component navigation, covered by focused documentation tests, and rendered during release verification.

When the user supplies a PDF, screenshot set, or other designed specification as the quality benchmark, inspect its rendered sequence at original resolution before designing the page. Record what the reference deliberately shows first, what its next visual chapter adds, and where detailed reading begins. Preserve that staged cognitive load unless the user approves another direction: a calm identity-first cover cannot be replaced by breadcrumbs, status badges, facts, code, navigation, or multiple specimens merely because those items are required somewhere on the complete page. Map every required topic into the later teaching sequence, and treat “all content exists” as a failed substitute for matching the reference's information hierarchy, visual breathing room, and reading progression.

Calm composition is not an empty container, but a supplied specimen frame may be essential to the reference. Preserve it when it intentionally groups the canonical specimen and its small set of decision-helping summaries. Judge the frame by its proportion, internal composition, and role in the reference—not by the mere presence of whitespace. Never translate criticism of a weak implementation into removing an accepted reference structure unless the user requested removal or the structure conflicts with the component contract.

Do not duplicate the full component contract into agent prompts, hooks, or multiple provider skills. The source-adjacent Markdown is the authoritative detailed contract, the in-app page teaches it through live examples, and `COMPONENT_LIBRARY.md` is a concise inventory/status/API summary that links to the detailed contract. Any disagreement is a release failure; do not conceal it with source-precedence language.

The page may explain hover, focus, pressed, loading, or other states, but documentation CSS must not force or recreate internal production styles. Prove interaction appearance through the actual exported component, real browser interaction, and sanitized rendered evidence. Clearly label any non-live diagram as explanatory rather than authoritative.

### 9. Implement the approved reusable component

Build each component in its own `client/src/components/design-system/<ComponentName>/` folder using the established `qds-` namespace and shared Slate tokens. Folder names use the exported PascalCase component name. Do not add new component files at the design-system root; that root owns only the public barrel and shared files that genuinely apply to more than one component.

The implementation must include:

- a focused React component with one stable job;
- `<ComponentName>.jsx`, `<ComponentName>.css`, `<ComponentName>.test.jsx`, `<ComponentName>.md`, `<ComponentName>.contract.json`, and an optional local `index.js` inside the component folder; the JSON manifest is the machine-readable identity/status/classification, exact governed-prop/default, rejected-source-boundary, and non-empty behavior-assertion contract shared by source, live docs, and the release validator, while Markdown remains the authoritative human explanation;
- controlled semantic props and safe defaults;
- complete supported states and optional-content behavior;
- correct semantic HTML and assistive-technology relationships;
- keyboard, focus, reduced-motion, and announcement behavior when applicable;
- collision-resistant CSS with no new dependency unless justified;
- a public export from `client/src/components/design-system/index.js`;
- focused component tests for the public contract; and
- examples that demonstrate valid use without binding the primitive to one feature.

Source syntax and docs file layout are implementation choices, not component semantics. A component may use a named function or arrow function, with or without `forwardRef`; the governed props must remain statically inspectable. Its docs page may live in the shared pages module or a dedicated module, and component-specific docs CSS is optional. The release gate discovers the route's page, focused tests, and docs CSS files and must not require Button's file layout.

The component must not fetch, poll, store, navigate, or mutate external state unless that behavior is the explicitly approved purpose of the component. Parents own feature data and side effects by default.

`className`, `style`, `aria-*`, and `data-*` may support placement and integration, but cannot become an ungoverned alternate styling API. If a requested use case changes the component's purpose, create a composition or a separate component instead of adding another catch-all slot.

### 10. Compare the implementation with the approval

Before claiming `available`, perform a prototype-to-production reconciliation. Re-read the implementation, colocated explanation, registry, routed page, tests, and release record from disk; remove proposal-only or provisional wording that is no longer true; resolve every behavioral/default/API disagreement; and check every release acceptance item. An unchecked item blocks `available` unless the release record names a justified deferment and uses a truthful earlier status.

Run both validators. The explanation validator checks depth and structure. The release validator checks the component release graph and fails missing files, exports, route/search/docs-test registration, live specimen use, public-prop disagreement, unchecked available-state criteria, missing desktop/390 evidence, or a missing release-quality record:

```powershell
node .agents/skills/design-system-component/scripts/validate-component-explanation.mjs client/src/components/design-system/<ComponentName>/<ComponentName>.md
node .agents/skills/design-system-component/scripts/test-validate-component-release.mjs
node .agents/skills/design-system-component/scripts/validate-component-release.mjs <ComponentName> <component-slug>
```

The release validator and its focused self-test are deterministic synchronization floors, not visual approval. Run both before the target validation. Then run the smallest focused checks that prove the new public contract, render the actual production component in an isolated specimen, and compare it with the approved prototype.

Required visual evidence for a new component includes:

- canonical desktop state;
- exactly 390px width;
- the complete routed `/docs/components/<component-slug>` teaching page at desktop and exactly 390px;
- every materially distinct state or interactive disclosure;
- keyboard focus and pressed/open behavior when interactive;
- reduced-motion behavior when animated;
- no horizontal overflow;
- clean browser console; and
- an explicit list of any intentional difference from the approved image.

Tests and builds prove code contracts, not design quality. Apply the independent review requirements in `design-experience-gate` when the production work is material or major. The user remains the final acceptance authority.

### 11. Make it immediately usable without forcing adoption

Hand off:

- the import path;
- a minimal example;
- supported props and defaults;
- approved prototype and rendered implementation evidence;
- the colocated complete explanation and routed component documentation page;
- focused verification results; and
- adoption status: `available`, `adopted in named consumers`, or `migration pending`.

Do not claim app-wide adoption because a component was exported. Do not migrate existing screens unless those consumers were named in the scope lock.

Existing components created before this full release contract may remain `legacy-available` only when the registry lists their missing page/evidence/reconciliation work. Moving files or adding a colocated explanation counts as a material documentation revision only for the target components named in the scope lock; it does not silently require retrofitting every legacy component. A component newly created or materially revised under this skill must pass the current full contract before it may be called `available`.

## Stop conditions

Pause and request direction when:

- the proposed component changes product behavior, stored data, authority, privacy, or cost;
- making it reusable requires a materially broader abstraction than requested;
- an existing canonical component already owns the job but the requested design conflicts with its approved contract;
- the user has not approved the direction and production implementation was not explicitly authorized;
- the prototype or explanation contradicts the current design sources or each other;
- the explanation validator or human quality rubric does not pass completely;
- the release synchronization validator does not pass for an implementation claiming `available`;
- the approved prototype cannot be reproduced without changing shared tokens or another component contract; or
- adoption would require touching unnamed feature screens.

## Definition of done

A component is complete only when all requested workflow stages are complete. For the full workflow, that means: explicit user approval, approved baseline stored, one component folder created, the full explanation colocated and validated, the registry updated, a finished searchable `/docs/components/<slug>` page using live production specimens, production component and public export available, focused component and documentation tests passing, desktop and exactly 390px documentation renders checked, implementation compared against the approval, all release checklist items resolved, the cross-surface release validator passing, required design gate satisfied, a completed release record stored, and adoption scope reported truthfully.

A prototype is **prototype complete** only when its final bitmap passes original-resolution inspection, its complete explanation passes the deterministic validator and human quality rubric, and both artifacts agree with the current design evidence. It is still not production complete. A JSX file, a folder, a Markdown explanation, or a documentation route alone is **partial**, not design-system complete.
