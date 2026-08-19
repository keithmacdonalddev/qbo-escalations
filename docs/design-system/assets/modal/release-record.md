# Modal Design Release Record

## Direction

- Work and route: governed `Modal` primitive and `/docs/components/modal`
- Classification: material reusable-component release
- User request: `$design-system-component modal`, followed by approval of the isolated prototype with `passed, keep going`.
- Approved Product/UX direction or brief: user-approved `Modal-prototype-v1.png` plus the source-adjacent `Modal.md` contract; a Product/UX designer was not required because the work was material, not major.
- Direction identifier/date: Modal v1 / August 18, 2026
- Scope and approval triggers: source, controlled semantic contract, public export, canonical explanation, registry, searchable live teaching route, focused tests, sanitized evidence, and release record. Existing feature-modal adoption, business workflows, shared tokens, dependencies, and runtime control remained excluded.

## Required roles and effective capability

| Responsibility | Registered role | Separate from builder? | Effective model | Effort | Vision/render inspection | Available |
| --- | --- | --- | --- | --- | --- | --- |
| Product/UX designer (major only) | not required for material work | n/a | n/a | n/a | n/a | yes |
| Builder | root Codex session | n/a | GPT-5 Codex session model | configured session effort | yes | yes |
| Design/Experience Reviewer | `design_experience_reviewer` | yes | `gpt-5.6-sol` | high | yes | yes |

Gate unavailable reason, if any: none.

## Cheap deterministic checks

| Check | Result | Evidence reference |
| --- | --- | --- |
| Focused component and routed-docs tests | pass | 2 files, 14 tests: dismissal reasons, true-veil gesture, focus loop/return, initial-focus fallback, callback stability, inert background, scroll lock, nested-layer guard, API fallback, route/search registration, live specimens, and structural omission |
| Client production build | pass | Vite production build; 742 modules transformed |
| Explanation structure | pass | `Modal.md`: interactive-control, 4,042 words, 20 required sections, 9 evidence rows, 11 citations, 22 acceptance items, and 3 API examples |
| Release target validator | pass | component folder, controlled contract, export, registry, route, live docs, focused tests, evidence, resolved acceptance, and independent verdict agree |
| Exact-mobile overflow measurement | pass | 390px viewport, 390px document width, 366px shell, 12px left/right insets, and 40px close target |
| Long-content containment | pass | 820px shell inside 844px viewport; body client/scroll heights 657/948px; header top and footer bottom remained 13/831px before and after body scroll |
| Keyboard path and focus return | pass | Cancel → Apply change → Close loops; Shift+Tab reverses; Escape returns focus to the opening Button |
| Reduced motion | pass | reduced-motion media query true; veil and surface animation names `none`; surface transform `none` |
| Browser console | clean | no application errors; only Vite connection, hot-update, and React development information |
| Validator self-test | fail outside Modal graph | the concurrently modified Button fixture currently fails its first-viewport and docs-test expectations; this release does not edit or conceal that shared harness issue |

## Sanitized rendered evidence

| Required view/state | Sanitized? | Evidence reference | Result or n/a reason |
| --- | --- | --- | --- |
| Approved baseline | yes | `Modal-prototype-v1.png` | User-approved component-only direction with generic operational content. |
| Documentation entry and first action | yes | `Modal-docs-page-desktop-1440.png`, `Modal-docs-page-390.png` | Searchable Available route presents purpose, canonical launch, and minimal valid code before deeper reference chapters. |
| Desktop production layer | yes | `Modal-docs-desktop-1440.png` | Regular live export preserves one calm foreground shell, clear title/context, three review facts, and local action hierarchy. |
| Exact-390 production layer | yes | `Modal-docs-mobile-390.png` | 366px shell, 12px insets, 40px close target, readable body, and two reachable actions without horizontal overflow. |
| Keyboard focus and expanded overflow | yes | `Modal-docs-mobile-scrollproof-390.png` | Long body scrolls inside a stable header/footer frame; composed Button focus is visible and unclipped. |
| Reduced motion | yes | `Modal-docs-reduced-motion-390.png` | The canonical layer remains clear with every entry animation removed. |
| Loading/waiting | n/a | parent-owned | Modal does not own business progress. |
| Success/completed/partial/error/recovery | n/a | parent-owned | Workflow outcomes remain in caller content and require consumer-specific evidence during adoption. |
| Confirmation/destructive flow | n/a | separate composition | Button owns destructive tone; AlertDialog/confirmation semantics are not Modal variants. |

- Temporary private evidence used locally: no
- Private evidence committed: no
- Temporary evidence cleanup/status: permanent evidence uses generic fixture content only.

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: the separate vision-capable reviewer found that production honors the approved baseline with calm Slate hierarchy, clear bounded-task framing, restrained depth, natural desktop sizing, exact-390 edge clearance, stable identity/actions around reachable body scrolling, highly visible keyboard focus, meaningful reduced-motion rendering, and documentation that explains purpose without competing with the task.
- Correction boundary if rejected: not applicable.
- Focused correction rounds used: 0
- Direct user rejection unresolved: no; the user approved the component direction and no independent correction was requested.

## Baseline and completion

- Approved baseline retained or replaced: retained as `Modal-prototype-v1.png`; production desktop and exact-390 evidence match its governed silhouette and interaction intent.
- Regression comparison result: production replaces prototype-only measurements with the frozen 610/520px maxima, a consistent 40px close target, collision-resistant internal classes, real focus and dismissal behavior, and effective-cascade protection. It does not migrate or alter any existing feature modal.
- Reconciliation result: the public export, manifest, source, canonical explanation, registry, live routed documentation, focused tests, build, sanitized evidence, user approval, and independent affirmative verdict agree.
- Open design risk or evidence gap: consumer adoption remains intentionally unreviewed. The shared release-validator self-test has a concurrent Button-fixture failure outside the Modal graph; the Modal target validator itself passes.
- Main-agent completion decision: Modal v1 is available as a governed design-system component; no legacy feature consumer has been migrated.
- Adoption status: available; no legacy consumers
