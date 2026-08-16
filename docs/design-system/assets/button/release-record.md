# Button Design Release Record

## Direction

- Work and route: governed `Button` primitive and `/docs/components/button`
- Classification: major
- User request: replace the rejected Button documentation layout with a component-design specification that matches the reference PDF's information pacing: identity first, visual examples second, detailed reference third.
- Approved Product/UX direction or brief: `docs/design-system/assets/button/product-ux-brief-v2.md`
- Direction identifier/date: Button documentation v2 / August 16, 2026
- Information hierarchy: the opening viewport contains only the specification label, component name, one precise sentence, and one live production Button. The next stage demonstrates intents and sizes with minimal prose. The specification map and detailed chapters begin only after those two visual stages.
- Scope and approval triggers: Button documentation source, page-specific styles, focused documentation tests, sanitized evidence, release record, and the design-system-component skill rule for reference-driven information architecture. Button behavior/API, legacy feature adoption, unrelated documentation pages, dependencies, and runtime control remained excluded.

## Required roles and effective capability

| Responsibility | Registered role | Separate from builder? | Effective model | Effort | Vision/render inspection | Available |
| --- | --- | --- | --- | --- | --- | --- |
| Product/UX designer (major only) | `product_ux_designer` | n/a | `gpt-5.6-sol` | high | yes | yes |
| Builder | root Codex session | n/a | GPT-5 Codex session model | configured session effort | yes | yes |
| Design/Experience Reviewer | `design_experience_reviewer` | yes | `gpt-5.6-sol` | high | yes | yes |

Gate unavailable reason, if any: none.

## Cheap deterministic checks

| Check | Result | Evidence reference |
| --- | --- | --- |
| Focused component and routed-docs tests | pass | 2 focused files, 23 tests: `Button.test.jsx` and `DocsApp.test.jsx` |
| Client production build | pass | Vite production build, 735 modules transformed |
| Explanation structure | pass | `Button.md`: 4,952 words, 20 required sections, 6 evidence rows/citations, 20 acceptance items, and 3 API examples |
| Release validator | pass | component folder, semantic contract, export, registry, exact route, staged live docs, tests, evidence, release record, and 21-case validator self-test |
| Loading/focus measurement | pass | width remained 173.3125px before and during loading; height remained 40px; focus stayed on the Button; `aria-busy=true` |
| Exact-mobile overflow measurement | pass | 390px viewport and 390px document scroll width; API examples scroll only inside their own bounded code surface |
| Reduced motion | pass | spinner animation becomes `none` and the progress mark becomes static and dashed while busy meaning remains visible |
| Clipboard failure recovery | pass | failed Clipboard API and fallback leave the complete minimal example visibly selected and report `Code selected` |
| Browser console | clean | no application errors; only Vite connection and React development information |

## Sanitized rendered evidence

| Required view/state | Sanitized? | Evidence reference | Result or n/a reason |
| --- | --- | --- | --- |
| Stage 1: identity and one example | yes | `Button-docs-v2-cover-desktop.png`, `Button-docs-v2-cover-390.png` | The first viewport contains one label, one title, one sentence, and one live Button specimen; no API, status, navigation rail, or implementation metadata competes with the component. |
| Stage 2: visual family | yes | `Button-docs-v2-glance-desktop.png`, `Button-docs-v2-glance-390.png` | Primary, secondary, loading, disabled, destructive, and small/medium/large specimens are demonstrated with short labels rather than explanatory paragraphs. |
| Stage 3: reference begins | yes | `Button-docs-v2-map-desktop.png`, `Button-docs-v2-map-390.png` | The semantic model and chapter map begin only after the visual introduction. |
| Detailed states and interaction | yes | `Button-docs-v2-states-desktop.png`, `Button-docs-v2-states-390.png` | State controls and live production Button stay visually subordinate to the specification chapters and remain usable at 390px. |
| Keyboard path | yes | `Button-docs-v2-map-link-focus.png`, `Button-docs-v2-fixture-control-focus.png`, `Button-docs-v2-keyboard-focus.png`, `Button-docs-v2-loading-focus.png` | Focus is unmistakable on a document jump link, fixture control, resting Button, and loading Button; activation preserves focus. |
| Completed resting state | yes | `Button-docs-v2-completed-resting.png` | The Button returns to its stable action while completion feedback remains parent-owned. |
| Error and recovery | yes | `Button-docs-v2-failure-recovery.png` | Error feedback stays outside Button and the stable action becomes `Try again`. |
| Clipboard failure and recovery | yes | `Button-docs-v2-copy-failure-recovery.png` | The full example remains readable and selected when copying is unavailable. |
| Destructive confirmation | yes | `Button-docs-v2-destructive-confirmation.png` | Consequence, safe cancel, one destructive action, keyboard containment, Escape, and focus restoration are present. |
| Reduced motion | yes | `Button-docs-v2-reduced-motion.png` | Busy state remains identifiable without animation. |
| Mobile API legibility | yes | `Button-docs-v2-api-390.png` | API content stays within the page and uses bounded internal overflow for code. |

- Approved component baseline: `Button-prototype-v2.png`
- Approved documentation direction: `product-ux-brief-v2.md`
- Temporary private evidence used locally: no
- Private evidence committed: no
- Temporary evidence cleanup/status: permanent evidence contains generic fixture content only.

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: the independent cold reviewer accepted the final identity-to-visual-family-to-reference progression as polished, responsive, and faithful to the supplied PDF. The reviewer also confirmed graceful clipboard failure and unmistakable keyboard focus across the specification map, fixture controls, resting Button, and loading Button.
- Correction boundary if rejected: the first v2 review accepted the layout direction but required explicit clipboard-failure and complete keyboard-path evidence. One focused evidence round supplied those missing states without changing the approved page hierarchy.
- Focused correction rounds used: 1
- Direct user rejection unresolved: no; the rejected layout was replaced. Final user acceptance remains the user's authority at handoff.

## Baseline and completion

- Approved baseline retained or replaced: the production component retains `Button-prototype-v2.png`; the documentation baseline is replaced by the v2 cover, visual-family, map, desktop, and exact-390 renders listed above.
- Regression comparison result: the Button component remains unchanged while its documentation now follows the reference's deliberate three-stage reveal and preserves all required technical depth below the visual introduction.
- Reconciliation result: the live route, production specimens, component explanation, semantic contract, API table, focused tests, rendered evidence, and release assertions agree. The cover does not expose implementation metadata, the second stage is visual, and the detailed specification begins at the third stage.
- Open design risk or evidence gap: existing legacy feature buttons intentionally remain separate until a named migration is authorized. Forced-colors behavior remains deterministic CSS evidence because the available browser harness does not emulate that mode.
- Main-agent completion decision: release-quality Button documentation is available at `/docs/components/button`; the Button component remains available from the design-system barrel.
- Adoption status: migration pending
