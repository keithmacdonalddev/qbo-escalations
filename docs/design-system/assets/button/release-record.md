# Button Design Release Record

## Direction

- Work and route: governed `Button` primitive and `/docs/components/button`
- Classification: material correction to the major Button documentation page
- User request: restore the specimen box and make the opening look like the supplied specification PDF's first page: clear identity, exact concise summary, one substantial framed component example, and no unnecessary first-stage detail.
- Approved Product/UX direction or brief: `docs/design-system/assets/button/product-ux-brief-v4.md`
- Direction identifier/date: Button documentation cover v4 / August 16, 2026
- Information hierarchy: the opening viewport follows the supplied PDF: specification label, component name, one concise definition, and a large light showcase containing one full-width live production Button plus only the three cover summaries—Intent, State, and Size. The next stage demonstrates the visual family with minimal prose, and detailed reference begins only after those visual stages.
- Scope and approval triggers: Button cover markup, page-specific styles, focused documentation assertion, sanitized evidence, release record, and the design-system-component skill rule exposed by the rejection. Button behavior/API, the shared docs shell, later specification chapters, legacy adoption, unrelated pages, dependencies, and runtime control remained excluded.

## Required roles and effective capability

| Responsibility | Registered role | Separate from builder? | Effective model | Effort | Vision/render inspection | Available |
| --- | --- | --- | --- | --- | --- | --- |
| Product/UX designer (major only) | `product_ux_designer` | n/a | not required for this material correction | n/a | n/a | yes |
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
| Corrected cover geometry | pass | desktop showcase is wide and dominant, its live Button is 842×48px at the captured viewport, exact-390 document width remains 390px, and the focused Button is visible without clipping |

## Sanitized rendered evidence

| Required view/state | Sanitized? | Evidence reference | Result or n/a reason |
| --- | --- | --- | --- |
| Stage 1: PDF-faithful identity and framed example | yes | `Button-docs-v4-cover-desktop-1322.png`, `Button-docs-v4-cover-390.png` | The reference's light specimen frame is restored with purposeful internal composition: one full-width production Button and only Intent, State, and Size summaries beneath it. |
| Stage 2: visual family | yes | `Button-docs-v2-glance-desktop.png`, `Button-docs-v2-glance-390.png` | Primary, secondary, loading, disabled, destructive, and small/medium/large specimens are demonstrated with short labels rather than explanatory paragraphs. |
| Stage 3: reference begins | yes | `Button-docs-v2-map-desktop.png`, `Button-docs-v2-map-390.png` | The semantic model and chapter map begin only after the visual introduction. |
| Detailed states and interaction | yes | `Button-docs-v2-states-desktop.png`, `Button-docs-v2-states-390.png` | State controls and live production Button stay visually subordinate to the specification chapters and remain usable at 390px. |
| Keyboard path | yes | `Button-docs-v4-cover-keyboard-focus.png`, `Button-docs-v2-map-link-focus.png`, `Button-docs-v2-fixture-control-focus.png`, `Button-docs-v2-loading-focus.png` | Focus is unmistakable and unclipped on the light cover showcase, document jump link, fixture control, and loading Button. |
| Completed resting state | yes | `Button-docs-v2-completed-resting.png` | The Button returns to its stable action while completion feedback remains parent-owned. |
| Error and recovery | yes | `Button-docs-v2-failure-recovery.png` | Error feedback stays outside Button and the stable action becomes `Try again`. |
| Clipboard failure and recovery | yes | `Button-docs-v2-copy-failure-recovery.png` | The full example remains readable and selected when copying is unavailable. |
| Destructive confirmation | yes | `Button-docs-v2-destructive-confirmation.png` | Consequence, safe cancel, one destructive action, keyboard containment, Escape, and focus restoration are present. |
| Reduced motion | yes | `Button-docs-v2-reduced-motion.png` | Busy state remains identifiable without animation. |
| Mobile API legibility | yes | `Button-docs-v2-api-390.png` | API content stays within the page and uses bounded internal overflow for code. |

- Approved component baseline: `Button-prototype-v2.png`
- Approved documentation direction: `product-ux-brief-v4.md`
- Temporary private evidence used locally: no
- Private evidence committed: no
- Temporary evidence cleanup/status: permanent evidence contains generic fixture content only.

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: the independent cold reviewer found that the cover faithfully translates the PDF's hierarchy and substantial framed showcase into Slate. Crisp white specimen labeling, clear keyboard focus, balanced desktop composition, and clean exact-390 stacking form a coherent experience without losing the original box or wording.
- Correction boundary if rejected: the first v4 review rejected only the cover specimen's weak dark label contrast and required crisp white label ink while preserving the box, composition, wording, and responsive layout. That boundary was corrected and the same independent reviewer returned the exact affirmative verdict on the fresh evidence.
- Focused correction rounds used: 1
- Direct user rejection unresolved: no; the reference's framed composition is restored and will be independently re-reviewed. Final user acceptance remains the user's authority at handoff.

## Baseline and completion

- Approved baseline retained or replaced: the production component retains `Button-prototype-v2.png`; the rejected v3 cover baseline is replaced by `Button-docs-v4-cover-desktop-1322.png` and `Button-docs-v4-cover-390.png`. Existing v2 visual-family, map, and detailed-state evidence remains valid because those sections were unchanged.
- Regression comparison result: the Button component and later documentation chapters remain unchanged. The cover preserves the reference's three-stage reveal and its intentional framed specimen while correcting the earlier weak or missing internal composition.
- Reconciliation result: the live route, production specimen, exact PDF cover definition, focused test, exact-390 layout, keyboard evidence, skill rule, and release record agree. The cover contains no implementation metadata, status badge, document-only footer, or second example.
- Open design risk or evidence gap: existing legacy feature buttons intentionally remain separate until a named migration is authorized. Forced-colors behavior remains deterministic CSS evidence because the available browser harness does not emulate that mode.
- Main-agent completion decision: release-quality Button documentation is available at `/docs/components/button`; the Button component remains available from the design-system barrel.
- Adoption status: migration pending
