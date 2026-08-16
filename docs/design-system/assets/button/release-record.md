# Button Design Release Record

## Direction

- Work and route: governed `Button` primitive and `/docs/components/button`
- Classification: material correction to the major Button documentation page
- User request: preserve the specimen box but remove the headache-inducing white contrast. The PDF's white frame flowed into later white pages; the dark web documentation has no such continuation, so its framed showcase must belong to Slate instead of copying the PDF's page material literally.
- Approved Product/UX direction or brief: `docs/design-system/assets/button/product-ux-brief-v5.md`
- Direction identifier/date: Button documentation cover v5 / August 16, 2026
- Information hierarchy: the opening viewport still follows the supplied PDF's staged hierarchy—specification label, component name, one concise definition, and one substantial framed showcase containing a full-width live Button plus only Intent, State, and Size. The showcase now uses a restrained raised Slate surface so it flows into the dark documentation rather than creating a white interruption.
- Scope and approval triggers: Button cover surface and nested summary contrast, focused documentation verification, sanitized versioned evidence, and the release record. Button behavior/API, cover structure or wording, the shared docs shell, later specification chapters, legacy adoption, unrelated pages, dependencies, and runtime control remained excluded.

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
| Corrected cover geometry | pass | at 1534px the showcase is 1000×294px; at exact 390px it is 348×258px; both retain the accepted box and hierarchy with no horizontal page overflow |

## Sanitized rendered evidence

| Required view/state | Sanitized? | Evidence reference | Result or n/a reason |
| --- | --- | --- | --- |
| Stage 1: PDF hierarchy translated into Slate | yes | `Button-docs-v5-cover-desktop-1534.png`, `Button-docs-v5-cover-390.png` | The accepted specimen box and internal composition remain, while the copied white continuation surface is replaced by a raised Slate panel with elevated summaries and readable ink. |
| Stage 2: visual family | yes | `Button-docs-v2-glance-desktop.png`, `Button-docs-v2-glance-390.png` | Primary, secondary, loading, disabled, destructive, and small/medium/large specimens are demonstrated with short labels rather than explanatory paragraphs. |
| Stage 3: reference begins | yes | `Button-docs-v2-map-desktop.png`, `Button-docs-v2-map-390.png` | The semantic model and chapter map begin only after the visual introduction. |
| Detailed states and interaction | yes | `Button-docs-v2-states-desktop.png`, `Button-docs-v2-states-390.png` | State controls and live production Button stay visually subordinate to the specification chapters and remain usable at 390px. |
| Keyboard path | yes | `Button-docs-v5-cover-keyboard-focus.png`, `Button-docs-v2-map-link-focus.png`, `Button-docs-v2-fixture-control-focus.png`, `Button-docs-v2-loading-focus.png` | Focus is unmistakable and unclipped on the dark cover showcase, document jump link, fixture control, and loading Button. |
| Completed resting state | yes | `Button-docs-v2-completed-resting.png` | The Button returns to its stable action while completion feedback remains parent-owned. |
| Error and recovery | yes | `Button-docs-v2-failure-recovery.png` | Error feedback stays outside Button and the stable action becomes `Try again`. |
| Clipboard failure and recovery | yes | `Button-docs-v2-copy-failure-recovery.png` | The full example remains readable and selected when copying is unavailable. |
| Destructive confirmation | yes | `Button-docs-v2-destructive-confirmation.png` | Consequence, safe cancel, one destructive action, keyboard containment, Escape, and focus restoration are present. |
| Reduced motion | yes | `Button-docs-v2-reduced-motion.png` | Busy state remains identifiable without animation. |
| Mobile API legibility | yes | `Button-docs-v2-api-390.png` | API content stays within the page and uses bounded internal overflow for code. |

- Approved component baseline: `Button-prototype-v2.png`
- Approved documentation direction: `product-ux-brief-v5.md`
- Temporary private evidence used locally: no
- Private evidence committed: no
- Temporary evidence cleanup/status: permanent evidence contains generic fixture content only.

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: the independent cold reviewer found that the corrected cover now reads as one coherent Slate documentation experience. The specimen remains substantial and clearly bounded without becoming a glaring slab; nested summaries retain readable hierarchy and contrast; desktop, exact-390 mobile, and keyboard focus remain resolved.
- Correction boundary if rejected: not applicable; the first independent review of the v5 contrast correction returned the exact affirmative verdict.
- Focused correction rounds used: 0
- Direct user rejection unresolved: no; the copied white continuation surface has been replaced while the requested box and information hierarchy remain. Final user acceptance remains the user's authority at handoff.

## Baseline and completion

- Approved baseline retained or replaced: the production component retains `Button-prototype-v2.png`; the user-rejected white v4 cover is replaced by `Button-docs-v5-cover-desktop-1534.png` and `Button-docs-v5-cover-390.png`. Existing v2 visual-family, map, and detailed-state evidence remains valid because those sections were unchanged.
- Regression comparison result: the Button component, cover structure and wording, and later documentation chapters remain unchanged. Only the cover frame and summary surfaces move from copied light-document material to canonical Slate surfaces.
- Reconciliation result: the live route, production specimen, exact cover definition, accepted box, focused test, exact-390 layout, keyboard evidence, and release record agree. The cover retains the PDF's cognitive sequence without importing the PDF's white-page continuation into a dark web document.
- Open design risk or evidence gap: existing legacy feature buttons intentionally remain separate until a named migration is authorized. Forced-colors behavior remains deterministic CSS evidence because the available browser harness does not emulate that mode.
- Main-agent completion decision: release-quality Button documentation is available at `/docs/components/button`; the Button component remains available from the design-system barrel.
- Adoption status: migration pending
