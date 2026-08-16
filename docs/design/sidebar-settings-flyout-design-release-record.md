# Sidebar Settings Flyout Design Release Record

## Direction

- Work and route: persistent application-sidebar Settings flyout with destinations at `#/settings` and `/docs`
- Classification: major original feature; material owner-directed interaction correction
- User request: add a bottom-of-sidebar Settings control that opens only a VS Code-like flyout, place the documentation link there, and move the two sidebar-specific preferences out of the main Settings view
- Product/UX direction: a compact Slate-native footer menu with explicit Settings/docs destinations, local menu checkboxes, a sidebar width that remains unchanged while the menu opens or closes, stable expanded/collapsed anchoring, exact-390px drawer placement, complete keyboard behavior, and reduced motion
- Direction identifier/date: `sidebar-settings-static-width`, 2026-08-16 (supersedes the original collapsed-sidebar expansion behavior after direct owner feedback)
- Scope: sidebar footer and flyout, existing preference wiring, removal of duplicated Settings controls and stale copy, focused tests, and rendered desktop/mobile acceptance
- Approval triggers: renew approval before removing the header Settings control, changing preference semantics/defaults/storage keys, adding menu commands, changing destination behavior, or widening this into shared menu infrastructure

## Required roles and effective capability

| Responsibility | Registered role | Separate from builder? | Effective model | Effort | Vision/render inspection | Available |
| --- | --- | --- | --- | --- | --- | --- |
| Product/UX designer | `product_ux_designer` | n/a | GPT-5.6 Sol | high | yes | yes |
| Builder | primary Codex session | n/a | GPT-5 class; exact alias not surfaced | not surfaced | yes | yes |
| Design/Experience Reviewer | `design_experience_reviewer` | yes | GPT-5.6 Sol | high | yes | yes |

Gate unavailable reason, if any: none.

## Cheap deterministic checks

| Check | Result | Evidence reference |
| --- | --- | --- |
| Focused behavior/accessibility checks | pass | `npm --prefix client test -- src/components/Sidebar.test.jsx`; six checks, including a fake-timer regression proving that clicking Settings cancels pending hover expansion and preserves the collapsed frame through open and close |
| Production client build | pass | `npm --prefix client run build` |
| Overflow/clipping measurement | pass | desktop constrained height 1024x600 and exact mobile 390x844 both measured zero page-level horizontal overflow; the menu remained inside every viewport |
| Browser console | clean | no console messages or page errors after the focused interaction path |
| Reduced-motion measurement | pass | `prefers-reduced-motion: reduce` matched; the menu computed `animation-name: none` with only the global 0.01ms transition duration |
| Docs destination | pass | the flyout's semantic link opened the same-site `/docs` route |

## Sanitized rendered evidence

The review captures replaced live sidebar counts with neutral fixture values. No private screenshot, customer identifier, credential, provider payload, or operational value was sent to the reviewer or retained as a product asset.

| Required view/state | Sanitized? | Evidence reference | Result or n/a reason |
| --- | --- | --- | --- |
| Overview/entry and first action | yes | `tmp-sidebar-static-collapsed-closed-sanitized.png`; `tmp-sidebar-static-collapsed-open-sanitized.png` | the closed 48px rail opened its complete menu without changing width |
| Important disclosure or primary action | yes | collapsed open frame | Settings and documentation destinations were immediately visible before the preference group |
| Loading/waiting | n/a | fixed local menu | no request or asynchronous content is required to open the menu or read the preferences |
| Success feedback | yes | collapsed, expanded, and mobile open frames | checked state changed immediately and remained legible without a toast or layout jump |
| Completed resting state | yes | `tmp-sidebar-static-collapsed-closed-sanitized.png` | the collapsed sidebar remained a 48px rail with the footer trigger at the bottom |
| Partial state | n/a | fixed local menu | the menu has no partial remote result; local preference setters remain usable for the current visit |
| Error and recovery | n/a | fixed local menu | destination errors belong to their routes; the menu itself makes no fallible remote request |
| Confirmation/destructive flow | n/a | no destructive action | links and display preferences cannot delete user data |
| Desktop | yes | `tmp-sidebar-static-collapsed-open-sanitized.png`; `tmp-sidebar-static-expanded-open-sanitized.png` | the flyout was compact and anchored while collapsed width stayed 48px and expanded width stayed 216px |
| Collapsed desktop | yes | collapsed closed/open frames | measured 48px before opening, 48px while open, and 48px after closing; the menu appeared immediately to the rail's right |
| Main Settings cleanup | yes | retained accepted implementation | the earlier removal of duplicated sidebar preferences was unaffected by this interaction correction |
| 390px mobile | yes | `tmp-sidebar-static-mobile-open-sanitized.png` | full exact-390x844 frame; the 216px drawer remained unchanged and page-level horizontal overflow measured zero |
| Keyboard focus/path | yes | `tmp-sidebar-static-keyboard-sanitized.png` | Arrow navigation produced a clear focus ring; Escape dismissed, restored focus to Settings, and left width unchanged |
| Outside dismissal | yes | direct rendered interaction | an outside pointer interaction closed the menu without changing the sidebar frame |
| Expanded-state overflow/clipping | yes | collapsed, expanded, and exact-mobile frames | menu remained inside the viewport and was not clipped by sidebar overflow |
| Reduced motion | yes | `tmp-sidebar-static-reduced-motion-sanitized.png` | the open collapsed frame remained 48px with menu reveal animation disabled |

- Temporary private evidence used locally: yes, for the initial self-review only
- Private evidence committed: no
- Temporary evidence cleanup/status: the six sanitized `tmp-sidebar-static-*` captures were deleted after the independent verdict and were not committed

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: the Settings trigger now behaves as a pure disclosure; collapsed and expanded widths remain stable, the anchored menu fits exact mobile without overflow, keyboard focus and Escape return are preserved, and reduced motion adds no width transition
- Correction boundary if rejected: n/a; the owner-directed static-width correction passed the independent review on its initial round
- Focused correction rounds used: 0 for this owner-directed correction; the earlier acceptance was invalidated and superseded by direct owner feedback
- Direct user rejection unresolved: no

## Baseline and completion

- Accepted sanitized desktop/mobile baseline retained or replaced: not retained; the temporary sanitized review captures were deleted after the verdict because they are evidence, not product assets
- Regression comparison result: collapsed width remains 48px and expanded width remains 216px through menu open and close; existing preference keys/defaults, sidebar navigation, header Settings behavior, and same-site documentation route remain unchanged
- Open design risk or evidence gap: browser-storage failure was not force-injected because no development-only failure control exists; the existing state setter still applies the choice for the current visit
- Main-agent completion decision: release quality and ready to use
