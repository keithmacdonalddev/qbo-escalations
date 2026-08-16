# Sidebar Settings Flyout Design Release Record

## Direction

- Work and route: persistent application-sidebar Settings flyout with destinations at `#/settings` and `/docs`
- Classification: major
- User request: add a bottom-of-sidebar Settings control that opens only a VS Code-like flyout, place the documentation link there, and move the two sidebar-specific preferences out of the main Settings view
- Product/UX direction: a compact Slate-native footer menu with explicit Settings/docs destinations, local menu checkboxes, stable expanded/collapsed anchoring, exact-390px drawer placement, complete keyboard behavior, and reduced motion
- Direction identifier/date: `sidebar-settings-flyout`, 2026-08-16
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
| Focused behavior/accessibility checks | pass | `npm --prefix client test -- src/components/Sidebar.test.jsx`; six opening, link, checkbox, collapsed-frame, keyboard, Escape, and outside-dismissal checks |
| Production client build | pass | `npm --prefix client run build` |
| Overflow/clipping measurement | pass | desktop constrained height 1024x600 and exact mobile 390x844 both measured zero page-level horizontal overflow; the menu remained inside every viewport |
| Browser console | clean | no console messages or page errors after the focused interaction path |
| Reduced-motion measurement | pass | `prefers-reduced-motion: reduce` matched; the menu computed `animation-name: none` with only the global 0.01ms transition duration |
| Docs destination | pass | the flyout's semantic link opened the same-site `/docs` route |

## Sanitized rendered evidence

The review captures replaced live sidebar counts with neutral fixture values. No private screenshot, customer identifier, credential, provider payload, or operational value was sent to the reviewer or retained as a product asset.

| Required view/state | Sanitized? | Evidence reference | Result or n/a reason |
| --- | --- | --- | --- |
| Overview/entry and first action | yes | `tmp-sidebar-settings-desktop-full-sanitized.png` | full 1440x900 frame showed the persistent footer trigger and complete open menu |
| Important disclosure or primary action | yes | same desktop frame | Settings and documentation destinations were immediately visible before the preference group |
| Loading/waiting | n/a | fixed local menu | no request or asynchronous content is required to open the menu or read the preferences |
| Success feedback | yes | desktop and mobile open frames | checked state changed immediately and remained legible without a toast or layout jump |
| Completed resting state | yes | `tmp-sidebar-settings-collapsed-bottom-full-sanitized.png` | the collapsed 48px rail kept the gear 4px from the viewport bottom |
| Partial state | n/a | fixed local menu | the menu has no partial remote result; local preference setters remain usable for the current visit |
| Error and recovery | n/a | fixed local menu | destination errors belong to their routes; the menu itself makes no fallible remote request |
| Confirmation/destructive flow | n/a | no destructive action | links and display preferences cannot delete user data |
| Desktop | yes | `tmp-sidebar-settings-desktop-full-sanitized.png` | the flyout was compact, anchored, and fully inside the 1440x900 frame |
| Collapsed desktop | yes | `tmp-sidebar-settings-collapsed-open-full-sanitized.png` | the collapsed entry expanded into a stable pinned frame and kept the flyout at the same bottom anchor |
| Main Settings cleanup | yes | `tmp-sidebar-settings-main-settings-sanitized.png` | Display & Navigation retained text, hints, and header layout without duplicated sidebar preferences |
| 390px mobile | yes | `tmp-sidebar-settings-mobile-full-sanitized.png` | full exact-390x844 frame; flyout bounds x=12..211 and zero horizontal page overflow |
| Keyboard focus/path | yes | `tmp-sidebar-settings-keyboard-nav-full-sanitized.png`; `tmp-sidebar-settings-escape-return-full-sanitized.png` | Arrow navigation produced a clear focus ring; Escape dismissed and restored focus to Settings |
| Outside dismissal | yes | `tmp-sidebar-settings-outside-dismiss-full-sanitized.png` | an outside pointer interaction closed the menu without moving focus back over the clicked content |
| Expanded-state overflow/clipping | yes | desktop, constrained-height, and mobile frames | menu remained clamped to the viewport and was not clipped by sidebar overflow |
| Reduced motion | yes | `tmp-sidebar-settings-reduced-motion-full-sanitized.png` | open state remained complete while meaningful reveal motion was disabled |

- Temporary private evidence used locally: yes, for the initial self-review only
- Private evidence committed: no
- Temporary evidence cleanup/status: all raw and sanitized `tmp-sidebar-settings-*` captures were deleted after the independent verdict and were not committed

## Independent verdict

- Exact reviewer first line: `YES — RELEASE QUALITY`
- Concise evidence: the persistent footer remains stable in collapsed and expanded states; the flyout opens from the same bottom anchor, fits exact mobile, has clear keyboard focus and dismissal, respects reduced motion, and does not duplicate sidebar controls in Settings
- Correction boundary if rejected: the first round requested full-frame state evidence; the second identified and limited correction to pinning the collapsed gear at the bottom
- Focused correction rounds used: 2
- Direct user rejection unresolved: no

## Baseline and completion

- Accepted sanitized desktop/mobile baseline retained or replaced: not retained; the temporary sanitized review captures were deleted after the verdict because they are evidence, not product assets
- Regression comparison result: existing preference keys/defaults, sidebar navigation, header Settings behavior, and same-site documentation route remain unchanged
- Open design risk or evidence gap: browser-storage failure was not force-injected because no development-only failure control exists; the existing state setter still applies the choice for the current visit
- Main-agent completion decision: release quality and ready to use
