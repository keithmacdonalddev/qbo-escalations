# Site-wide UI Audit and Fix Plan

Scope: audit of the 11 user-provided screenshots plus the corresponding live routes.

Status legend:
- Fixed: addressed in the current production UI pass.
- Verify: addressed in code and needs browser confirmation on the live route.
- Watch: acceptable for now, but worth revisiting if the route gets more daily use.

## Global Shell

| Area | Findings | Fix status |
| --- | --- | --- |
| Right agent dock | The dock consumes too much horizontal space on non-chat routes, causing Analytics, Usage, Calendar, Playbook, Agents, Templates, and Investigations to feel clipped. Tabs, message body, status cards, and compose controls are also too large for a persistent side panel. | Fixed |
| Page rhythm | Shared page headers, stat cards, buttons, cards, filter bars, and tables are inconsistent route-to-route. Several routes still look like landing pages instead of an operational console. | Fixed |
| Whitespace and radii | Many repeated cards use large padding, rounded corners, hover lift, and decorative shadows. This reduces information density without adding function. | Fixed |
| Inputs | Some form inputs fall back to browser-white styling on the templates page. | Fixed |

## Chat / Case Workflow

| Screenshot | Findings | Fix status |
| --- | --- | --- |
| 1, 2 | The case workflow card is still too tall and heavy; the stepper cards are oversized; the command grid clips parser, triage, and known-issue content; the decision headline is too large; internal panel gaps make the workflow look like a demo surface rather than a console. | Fixed |
| 1, 2 | Composer and message padding leave too little usable room for the case command surface. | Fixed |
| 1, 2 | Analyst strip and guidance blocks use generous spacing and large text compared with the surrounding console. | Fixed |

## Workspace

| Screenshot | Findings | Fix status |
| --- | --- | --- |
| 3 | Overview reads like a landing page: large hero copy, four oversized cards, excessive vertical whitespace, and little operational signal above the fold. | Fixed |
| 4 | Inbox is the closest route to the desired density. Main remaining issue is the global dock width and slightly tall shell header. | Fixed |
| 5 | Calendar loses working area to the sidebar and dock; header controls and left rail are too tall; week grid blocks feel oversized for the available viewport. | Fixed |

## Usage and Analytics

| Screenshot | Findings | Fix status |
| --- | --- | --- |
| 6 | Usage Monitor stat cards are too large and waste the first viewport; charts start too low; card gutters are oversized. | Fixed |
| 7 | Analytics has the same stat-card and chart-panel bulk, plus large empty chart cards that should scan as compact data panels. | Fixed |

## Templates and Playbook

| Screenshot | Findings | Fix status |
| --- | --- | --- |
| 8 | Template filters, empty state, and create panel are oversized; the form has unstyled white native inputs; the two-column layout is too wide for the right dock. | Fixed |
| 9 | Playbook sidebar category cards and center panel are too large; empty-state copy floats in too much unused space; the route should read as a compact editor/knowledge-base surface. | Fixed |

## Agents

| Screenshot | Findings | Fix status |
| --- | --- | --- |
| 10 | Agent profile hero remains oversized: large avatar, tall header, large action row, and bulky overview cards. Right dock clipping makes the profile feel constrained. | Fixed |

## Investigations

| Screenshot | Findings | Fix status |
| --- | --- | --- |
| 11 | Investigation list is mostly right, but top stat cards and filter spacing are still too large, and the dock squeezes the row content. | Fixed |

## Verification Completed

- `npm --prefix client run build` passes.
- `git diff --check` is clean except for the repository's existing CRLF warnings.
- Desktop browser check at 1868 x 869:
  - `#/workspace`
  - `#/workspace/inbox`
  - `#/workspace/calendar`
  - `#/usage`
  - `#/analytics`
  - `#/templates`
  - `#/playbook`
  - `#/agents/escalation-template-parser`
  - `#/investigations`
  - `#/chat`
- Mobile browser check at 390 x 844:
  - Same route set as above.
- Live checks confirmed:
  - No horizontal overflow on checked routes.
  - Global dock is about 304px wide on desktop.
  - Global dock moves out of the main lane on mobile.
  - Calendar fills the available center lane instead of leaving a blank column.
  - Usage, Analytics, Workspace, Templates, Playbook, Agent profile, and Investigations now use the compact card/control density.
  - White native form controls from the screenshots are removed.

Note: the current `#/chat` browser state did not expose an active case workflow card, so that specific DOM state was covered by CSS/build verification but not live state verification.

## Follow-up Hardening

| Recommendation | Implementation status |
| --- | --- |
| Move the cleanup toward a real density system. | Added `client/src/console-density.css` as the shared operational-console layer for dock modes, page rhythm, panels, stats, controls, and focus states. |
| Make the right dock route-aware. | Added route-derived dock modes: `chat`, `workspace`, `standard`, and `dense`. Dense operational routes now reserve less width than chat/workspace routes. |
| Add browser regression checks. | Added `npm run test:ui-density`, which opens the major desktop and mobile routes with `agent-browser` and asserts no horizontal overflow, expected dock mode/width, no native white controls, and no dock overlap. |
| Create a reliable active case-workflow fixture. | The UI density canary seeds a parsed escalation into the chat session, reloads the app, and verifies the active case workflow surface renders compactly. |
| Improve accessibility after shrinking controls. | Added a shared `:focus-visible` treatment for buttons, links, inputs, selects, textareas, and tab-like controls. |
