# TitleBlock V2 Design Release Record

## Direction

- Work and route: governed `TitleBlock` primitive and `/docs/components/title-block`
- Classification: material reusable-component release
- User request: replace the legacy TitleBlock implementation with the independently designed and approved V2, retain the accepted description spacing, add the fluid scale with `clamp(34px, 4.2vw, 50px)` and a 25ch desktop measure, and publish a thorough live component reference.
- Approved baseline: `TitleBlock-approved-prototype-v2.png` and `TitleBlock-approved-prototype-v2-390.png`, with the later user-approved 25ch source revision recorded as an intentional measure update.
- Scope boundary: the component, controlled contract, public export, registry entry, live routed documentation, focused tests, release evidence, and this record. Feature-screen adoption, shared-token cleanup, unrelated design-system components, and runtime control remain excluded.

## Required roles and effective capability

| Responsibility | Registered role | Separate from builder? | Effective model | Effort | Vision/render inspection | Available |
| --- | --- | --- | --- | --- | --- | --- |
| Product/UX designer (major only) | not required for this material component release | n/a | n/a | n/a | n/a | yes |
| Builder | root Codex session | n/a | GPT-5 Codex session model | configured session effort | yes | yes |
| Design/Experience Reviewer | `design_experience_reviewer` | yes | `gpt-5.6-sol` | high | yes | yes |

Gate unavailable reason, if any: none.

## Deterministic checks

| Check | Result | Evidence reference |
| --- | --- | --- |
| Explanation structure | pass | `TitleBlock.md`: 4,606 words, 20 required sections, 10 evidence rows, 9 citations, 22 acceptance items, and 3 API examples |
| Focused component and routed-docs tests | pass | `TitleBlock.test.jsx` and `DocsApp.test.jsx`: 2 files, 23 tests |
| Client production build | pass | Vite production build, 737 modules transformed |
| Desktop metrics | pass | fluid 50px, page 28px, section 18px; description gaps 8px, 6px, and 4px |
| Exact-mobile metrics | pass | 390x844 viewport; fluid 34px, page 22px, section 18px; zero horizontal page overflow |
| Effective cascade | pass | component-scoped production CSS preserves the approved weight, tracking, and exact sizes despite the late global heading and token overrides |
| Motion | pass | all TitleBlock elements resolve to `animation-name: none` and `transition-duration: 0s` |
| Browser console | pass | no application errors; only Vite and React development information |

## Sanitized rendered evidence

| Required view or state | Sanitized? | Evidence reference | Result |
| --- | --- | --- | --- |
| Approved desktop baseline | yes | `TitleBlock-approved-prototype-v2.png` | Approved anatomy and scale family |
| Approved compact baseline | yes | `TitleBlock-approved-prototype-v2-390.png` | Approved 390px wrapping and hierarchy |
| Production desktop opening | yes | `TitleBlock-docs-desktop-1440.png` | Live fluid identity, canonical default, and scale family |
| Production full desktop reference | yes | `TitleBlock-docs-desktop-full.png` | Complete 6,054px documentation path, including API, accessibility, and adoption |
| Production exact-390 opening | yes | `TitleBlock-docs-mobile-390.png` | 390x844 layout without horizontal overflow |
| Production full compact reference | yes | `TitleBlock-docs-mobile-full-390.png` | Complete 8,686px compact documentation path |
| Expanded compact contents | yes | `TitleBlock-docs-mobile-contents-expanded-390.png` | The mobile `On this page` disclosure and all chapter links are visible |
| Keyboard path step 1 | yes | `TitleBlock-docs-keyboard-01-skip-1440.png` | First Tab reveals and focuses `Skip to documentation` |
| Keyboard path step 2 | yes | `TitleBlock-docs-keyboard-02-content-link-1440.png` | Enter transfers focus to `#docs-main`; the next Tab visibly focuses the first specification link |

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: after one evidence-only correction, the reviewer found that the production specimens preserve the approved hierarchy, the complete reference is polished and scannable, the mobile reflow is readable and reachable without visible overflow, and the expanded contents plus keyboard path provide confident navigation.
- Correction boundary if rejected: the first review requested genuine full-page desktop and compact renders, expanded mobile contents, and a complete visible keyboard path. No redesign was requested or made.
- Focused correction rounds used: 1
- Direct user rejection unresolved: no.

## Baseline and completion

- Approved baseline retained or replaced: retained. The V2 anatomy, scales, transparency, inherited theme roles, and spacing match the approved direction; the separately approved 25ch fluid measure supersedes the earlier 18ch bitmap measure.
- Regression comparison result: the production component adds no container, icon, status, action, visual override, or motion. Native heading semantics remain independent from visual scale, and optional description markup plus spacing disappear together.
- Reconciliation result: the controlled manifest, React implementation, cascade-protected CSS, explanation, registry, routed live specimens, focused tests, rendered evidence, and independent verdict agree.
- Open design risk or evidence gap: fluid uses viewport width rather than container width, so it remains an opt-in scale for broad identity-first placements. This is documented rather than hidden.
- Main-agent completion decision: TitleBlock V2 is release-quality and available from the design-system barrel; feature adoption remains a separate approval scope.
- Adoption status: available; no legacy consumers
