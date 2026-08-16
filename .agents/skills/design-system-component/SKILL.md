---
name: design-system-component
description: Use when creating, revising, approving, documenting, or implementing a reusable QBO Escalations design-system component. Produces a component-only prototype image, evidence-based design rationale, a controlled semantic contract, an explicit user-approval checkpoint, canonical documentation, production React/CSS/exports/focused tests, and rendered implementation evidence. Do not use it merely to restyle one page-specific feature.
---

# Design System Component

Create one governed, reusable interface component at a time. Treat the prototype, component contract, documentation, implementation, and real rendered result as one continuous design decision—not separate tasks that can silently drift apart.

The user is the component's approval authority. A prototype is a decision artifact, not permission to edit production code. An approved component becomes immediately importable from the shared design-system package; it does not automatically replace similar feature UI across the app.

## Required sources

Before designing, read these sources completely:

1. `DESIGN.md`
2. `docs/design-system/COMPONENT_LIBRARY.md`
3. `.agents/skills/design-experience-gate/SKILL.md`
4. The existing files under `client/src/components/design-system/`
5. The relevant shared tokens in `client/src/App.css`
6. Any user-supplied image, explanation, critique, or approved precedent for this component

For the full component-contract checklist, prototype requirements, explanation structure, documentation matrix, and implementation acceptance criteria, read `references/component-workflow-contract.md` completely before producing the first prototype.

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
- a **workflow pattern** with state and actions; or
- page-specific UI that should remain owned by its feature.

Name the component by its stable interface job, never by the first page, provider, or dataset that uses it. Do not extract a component merely because a fragment appears twice.

If the request is not a valid reusable component, say so plainly and propose the correct primitive or composition. Do not manufacture a generic name around page-specific behavior.

### 3. Define the contract before drawing

Write a compact internal contract covering:

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

### 4. Produce the component-only prototype image

Create a bitmap prototype using the available image-generation capability. If image generation is unavailable, create an isolated HTML/CSS specimen outside production paths and render it to PNG.

The prototype must:

- show the reusable component—not a feature page pretending to be generic;
- use the app's Slate visual language and approved tokens rather than unrelated light-theme marketing art;
- show the canonical default first;
- show only the variants or optional treatments necessary to judge the contract;
- make optional surface, border, elevation, width, padding, icon, or supporting content visible when those are part of the proposal;
- contain no real account, portfolio, credential, email, or customer data;
- avoid page chrome, fake navigation, unrelated controls, and decorative labels unless requested; and
- be saved to the user's requested path, or to `%USERPROFILE%\Desktop\<ComponentName>-prototype-v<N>.png` when no path is specified.

Do not run application tests or invoke a release reviewer for a prototype-only request. The user judges the direction first.

### 5. Explain the design with professional depth

Alongside the image, provide the decision rationale required by `references/component-workflow-contract.md`. Explain what the component is for, why its hierarchy and anatomy work, what is optional, how it behaves, how it remains accessible, how it compresses, where it should not be used, and what the future React API implies.

Be intellectually independent. Identify weak ideas, redundant cues, conflicting requirements, and over-generalization even when they came from a reference the user supplied. Do not agree merely to be agreeable.

Provide decision rationale and observable tradeoffs. Do not claim to reveal private hidden chain-of-thought.

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

- `docs/design-system/COMPONENT_LIBRARY.md` — full canonical component contract and library inventory;
- `DESIGN.HTML` — plain-English visual specimen and approved variants;
- `DESIGN.md` — only when the component establishes or changes a durable app-wide rule;
- design-system exports and nearby usage examples; and
- any component status, adoption, or migration record that already governs the library.

Do not duplicate the full component contract into agent prompts, hooks, or multiple provider skills. This skill routes agents to the canonical documents.

### 9. Implement the approved reusable component

Build under `client/src/components/design-system/` using the established `qds-` namespace and shared Slate tokens.

The implementation must include:

- a focused React component with one stable job;
- controlled semantic props and safe defaults;
- complete supported states and optional-content behavior;
- correct semantic HTML and assistive-technology relationships;
- keyboard, focus, reduced-motion, and announcement behavior when applicable;
- collision-resistant CSS with no new dependency unless justified;
- a public export from `client/src/components/design-system/index.js`;
- focused component tests for the public contract; and
- examples that demonstrate valid use without binding the primitive to one feature.

The component must not fetch, poll, store, navigate, or mutate external state unless that behavior is the explicitly approved purpose of the component. Parents own feature data and side effects by default.

`className`, `style`, `aria-*`, and `data-*` may support placement and integration, but cannot become an ungoverned alternate styling API. If a requested use case changes the component's purpose, create a composition or a separate component instead of adding another catch-all slot.

### 10. Compare the implementation with the approval

Run the smallest focused checks that prove the new public contract. Then render the actual production component in an isolated specimen and compare it with the approved prototype.

Required visual evidence for a new component includes:

- canonical desktop state;
- exactly 390px width;
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
- focused verification results; and
- adoption status: `available`, `adopted in named consumers`, or `migration pending`.

Do not claim app-wide adoption because a component was exported. Do not migrate existing screens unless those consumers were named in the scope lock.

## Stop conditions

Pause and request direction when:

- the proposed component changes product behavior, stored data, authority, privacy, or cost;
- making it reusable requires a materially broader abstraction than requested;
- an existing canonical component already owns the job but the requested design conflicts with its approved contract;
- the user has not approved the direction and production implementation was not explicitly authorized;
- the approved prototype cannot be reproduced without changing shared tokens or another component contract; or
- adoption would require touching unnamed feature screens.

## Definition of done

A component is complete only when all requested workflow stages are complete. For the full workflow, that means: explicit user approval, approved baseline stored, canonical documentation updated, production component and public export available, focused tests passing, rendered implementation compared against the approval, required design gate satisfied, and adoption scope reported truthfully.

A polished prototype alone is **prototype complete**, not production complete. A JSX file alone is **implemented**, not design-system complete.
