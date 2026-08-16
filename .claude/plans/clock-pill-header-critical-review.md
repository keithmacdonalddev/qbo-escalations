# Critical review — Clock Pill header plan

- **Reviewed:** 2026-08-15
- **Plan reviewed:** `clock-pill-header.md`
- **Plan SHA-256:** `5F5880D164F0C705C361C3648FB8957B17E217989AB88E84B62D1633AB25401B`
- **User clarification:** the new Clock Pill replaces the existing status pill
- **Review basis:** the current working tree, including concurrent uncommitted work

## Verdict

**Revise before implementation.**

The replacement direction can produce a calmer and more useful header, and the plan contains good thinking about honest data, capability parity, accessibility, reduced motion, stable geometry, and real-browser checks. It is not implementation-ready, however. The plan does not yet include the existing status pill in its replacement boundary or map its behavior into the new pill; the effective header height is not the value assumed by the plan; the rollback promise contradicts the deletion stages; and several major Product/UX decisions are postponed until after implementation begins.

Executing the 16 stages as written would risk mounting old and replacement status systems during rollout or dropping current alert/history behavior during cutover, as well as duplicate timers and provider polling, inaccessible mobile controls, and a feature flag that cannot actually restore the old header.

## What the plan gets right

- It rejects fabricated values and limits slots to real sources.
- It explicitly protects the provider/model controls and agent actions before removing their current entry points.
- It requires non-colour status meaning, keyboard operation, focus return, reduced motion, and an honest unknown state.
- It recognizes that layout must be proven in a real browser; component tests alone cannot prove geometry.
- It treats the source prototype as design direction rather than production-ready integration code.
- It intends to keep the work reversible and staged, even though the current rollback design needs correction.

## Blocking findings

### 1. The replacement decision is clear, but the plan does not encode the replacement boundary

The user has clarified that the new Clock Pill replaces the existing status pill. Current source mounts that legacy surface as `HealthBanner` on every route (`client/src/App.jsx:366`). It shows local time, schedules a minute-aligned timeout, temporarily replaces the clock with problem/recovery messages, exposes one polite live region, and opens a portalled alert-history panel (`client/src/components/HealthBanner.jsx:8-15`, `145-190`, `612-620`). Its CSS fixes the pill at the top centre and contains measured 390px behavior (`client/src/components/HealthBanner.css:12-29`, `550-614`).

The plan's removal scope names the provider button, agent strip, and Refresh All, but it does not name the `HealthBanner` mount or map its behaviors into the replacement. That makes the implementation boundary incomplete even though the product direction is now settled.

**Why this matters:** leaving `HealthBanner` mounted on the new-pill branch produces two clocks, two status narratives, two interrupt systems, and two disclosure panels. Removing it without a behavior migration would discard request-failure history and recovery behavior that the new plan does not list in its parity contract.

**Required correction:** make the replacement explicit in scope, files, stages, and acceptance criteria:

- List `HealthBanner`, its `App.jsx` mount, CSS, tests, and alert-history dependency as legacy replacement inputs.
- Add a behavior-migration table: current behavior, new Clock Pill owner, cutover stage, and focused proof. It must cover the clock, request failure/recovery messages, alert history, clear-history action, portalled panel, keyboard/focus path, single live region, and 390px behavior.
- Under the rollout flag, render exactly one status pill: flag off means the complete legacy pill; flag on means the complete replacement. Never show both for comparison in the live header.
- Remove the old mount and legacy files only after the replacement has passed the full parity, design, and user-acceptance gates.
- Require exactly one global clock/status pill, one owner for temporary status messages, and one polite announcement region. Define how `AgentHealthBanner` and `HealthToast` coexist with the replacement; this cannot remain an open Stage 12 question.

### 2. The plan is based on the wrong effective header height and an incomplete CSS map

The plan repeatedly calls the current header 48px (`clock-pill-header.md:61`, `151`). `client/src/App.css:300-301` does declare 48px, but `overhaul.css` is loaded later (`client/src/main.jsx:11`, `19`) and applies `height: 44px !important` and `min-height: 44px !important` (`client/src/overhaul.css:7061-7063`). The same later layer also owns current header spacing, utility-strip styling, live-work sizing, and mobile agent-strip behavior.

**Why this matters:** a 36px pill has 4px above and below in the rendered 44px header, not the planned 6px. Editing only `App.css`, as the file map proposes, will leave later rules in control and makes the Stage 2 height test misleading.

**Required correction:** use 44px as the current measured baseline unless a fresh rendered check proves otherwise. Add `client/src/overhaul.css` to the inspected/modified source map or deliberately reconcile its header rules into the maintained component layer. Verify the effective result with `getComputedStyle`, not declarations in one file.

### 3. The rollback contract is internally impossible

Acceptance criterion 19 says every stage from Stage 2 onward is controlled by one flag and that flag-off restores the old header exactly (`clock-pill-header.md:78`). Stage 8 deletes the old controls and dead CSS and offers only a Git revert (`clock-pill-header.md:234`). The completion section admits flag-off works only until Stage 8 (`clock-pill-header.md:202`), and Stage 16 deletes the flag (`clock-pill-header.md:242`). All four statements cannot be true at once.

**Why this matters:** the most consequential stage removes the fallback that the acceptance criteria promise. A local-storage flag also is not an adequate prototype rollout boundary, because it mixes a user preference with release control and can leave different browsers on different shell implementations.

**Required correction:**

- Use an off-by-default environment flag such as `VITE_ENABLE_CLOCK_PILL_PROTOTYPE` while the work is a prototype, as required by the repository rules.
- Scope the grid with a conditional class so flag-off restores flex layout as well as old controls.
- Keep the legacy JSX and required CSS available through complete deterministic checks, the full design review, and user acceptance.
- Treat deletion of the legacy branch and removal of the flag as a separate, explicitly approved cleanup after acceptance. Once that cleanup happens, describe Git revert as the recovery path; do not claim a removed flag still works.

### 4. Core Product/UX decisions are incorrectly deferred until after major implementation begins

The plan correctly classifies the work as major, but it postpones the effective header height, the two default slot features, the source and ownership of interrupts, and whether mail is duplicated until Stages 2, 9, and 12 (`clock-pill-header.md:268-274`). It nevertheless says none of the questions block Stage 1.

The design gate requires the Product/UX brief before major implementation and requires exact initially visible production information, progressive disclosure, stable-frame behavior, state coverage, mobile hierarchy, and scope triggers. A hardcoded Stage 1 shell cannot validate the selected information hierarchy when the real default information is still unknown.

**Why this matters:** the builder would be making primary-chrome product decisions during implementation, and the Stage 2 design checkpoint would judge placeholder content rather than the intended experience.

**Required correction:** add a Stage 0 approval gate before code. The Product/UX designer must inspect the current rendered header and existing health pill, receive the source prototype, and resolve at least:

- the replacement pill's complete panel information architecture and migration from the old pill;
- exact default left/right content and why each deserves permanent header space;
- the relationship to mail, Live Work, request alerts, agent alerts, and toasts;
- the desktop and exact 390px hierarchy;
- the 44px-versus-new-height decision; and
- the complete initial/loading/empty/healthy/partial/error/recovery/success/resting state matrix.

The cold Design/Experience Reviewer should judge a complete slice with the required evidence. Stages 2 and 8 are not complete experiences as written, so calling them cold release-review checkpoints would guarantee rejection for missing states and missing final content. Use builder/designer inspection for early direction checks, then use the independent binary release review when the promised slice is complete.

### 5. Stage 1 does not follow the repository's prototype-isolation rule, and its design source is unavailable in the repository

The named `refined-clock-pill-v5-updated-standalone.html` file is not present in the current repository. The plan then proposes a dev-only preview route, but the file map contains neither the route integration nor the required off-by-default prototype flag. Repository rules instead require standalone prototype files under `prototypes/<prototype-name>/`, or fully flag-gated temporary integration with no route registration when the flag is off.

**Why this matters:** the builder cannot compare against or sanitize a missing reference, and a dev route can silently become part of the production bundle or normal review scope.

**Required correction:** place the approved reference in a stable, sanitized repository location or record an exact accessible path and content hash. Make Stage 1 a standalone `prototypes/clock-pill-header/` prototype with `index.html`, `styles.css`, and `script.js`, unless temporary React integration is explicitly chosen and correctly gated.

## High-priority design and engineering findings

### 6. The file/change map omits required owners

The proposed modification list contains only `AppHeader.jsx`, `App.css`, and `useShellPreferences.js`. Current source shows that:

- `App.jsx` is the single owner of `useShellPreferences` and passes preference state into Settings (`client/src/App.jsx:85-101`, `326`).
- `App.jsx` mounts both the existing `HealthBanner` and `AppHeader` (`client/src/App.jsx:366`, `403`).
- `Settings` must be changed to host the Stage 11 picker.
- `overhaul.css` contains the effective header geometry and responsive rules.
- `HealthBanner.jsx`, `HealthBanner.css`, its tests, and possibly `useAlertHistory.js` are in the replacement/migration boundary.
- No durable Design Release Record path is named.

**Required correction:** expand the plan's source map before implementation. At minimum, account for `App.jsx`, the relevant Settings component and tests, `overhaul.css`, the existing health-pill files and tests, an `AppHeader` characterization test, `testing/app-capabilities.json`, and a named Design Release Record. This is an impact map, not advance permission to edit every file.

### 7. The plan can create duplicate provider polling and split controller state during parity stages

`AppHeader` currently owns `useProviderStrategyHealth`, provider logs, canary execution, draft model selection, save state, and agent refresh (`client/src/components/app/AppHeader.jsx:504`, `556`, `722-864`). `useProviderStrategyHealth` installs a 60-second poll and refresh event listeners (`client/src/hooks/useProviderStrategyHealth.js:4`, `97-112`). The plan's data-flow diagram places that hook in the new health-summary path while the old provider control remains mounted through Stage 7.

**Why this matters:** mounting the hook in both old and new surfaces can duplicate timers, startup health checks, refresh reactions, and state that disagrees between the comparison controls.

**Required correction:** define one controller owner before visual migration. A single header/controller hook should own provider health, agent registry data, logs, drafts, save actions, and refresh actions; both legacy and new views should receive the same state/actions during comparison. Keep `useHealthSummary` a pure derivation where possible instead of letting it start another provider poll.

Add characterization tests for the current controls before moving them. Tests should lock down provider logs, canary, primary/fallback/model/strategy edits, all three open-agent actions, Refresh All, outside click/Escape, and the unchanged utility/live-work controls. Do not wait until Stage 16 to test behavior that is deleted in Stage 8.

### 8. Aggregate health and interrupt semantics are not defined tightly enough to implement truthfully

The plan alternates between “count of identities,” “agents monitored,” and an example whose online/degraded buckets imply enabled monitored agents. The registry exposes registered profiles, `enabled`, `bootstrapping`, `profilesError`, and health states including online, degraded, offline, disabled, and unknown (`client/src/context/AgentRegistryContext.jsx:59-63`, `275-286`, `427-434`). The plan adds healthy/degraded/critical/checking/unknown without defining the mapping or whether disabled agents count. It also feeds provider health into the summary diagram while saying provider state is not counted separately and will automatically appear through affected agents (`clock-pill-header.md:86-92`, `137`). That causal guarantee is not established in the plan.

The interrupt layer is similarly missing an event contract. “Bounded critical dwell, then hand off to the end-cap” works only if the end-cap and interrupt refer to the same durable condition. The listed candidate sources also overlap the existing request, agent, and workspace alert surfaces.

**Required correction:** add two explicit tables:

1. **Health aggregation:** input state, inclusion in total, displayed bucket, aggregate severity, freshness/stale behavior, and error/empty behavior. Decide whether the number means registered agents or enabled monitored agents, and ensure displayed buckets reconcile to it.
2. **Interrupt contract:** source, stable ID, severity, deduplication, priority, routing, dwell, expiry/resolution, recovery announcement, and which persistent surface retains the condition after the temporary message disappears.

Do not claim a provider problem automatically degrades the correct agent rows until that propagation path is traced and tested.

### 9. The mobile layout can hide essential controls

The planned pill starts at `clamp(360px, 44vw, 640px)` (`clock-pill-header.md:151`). At 390px, that minimum nearly consumes the entire viewport before the sidebar toggle, Live Work control, and four utility buttons are considered. Current header source includes `liveWorkControl` in addition to the utility strip (`client/src/components/app/AppHeader.jsx:949-950`), but the plan does not include it in the layout decisions. Giving side columns `overflow: hidden` can make essential buttons disappear while still reporting the pill mathematically centred.

The current health-pill CSS already documents that the existing left and right clusters overlap a centred pill at 390px and deliberately moves/collapses the status surface (`client/src/components/HealthBanner.css:550-614`). A new grid changes those measurements and must replace that behavior intentionally.

**Required correction:** define the mobile header before Stage 2, not as Stage 15 hardening. Add exact 390px acceptance for reachability of the sidebar toggle, Live Work, inbox, feedback, test suite, and settings; no clipping or horizontal overflow; and a deliberate collapsed pill form. Every integrated stage must remain usable at 390px. Also define whether zoom cases use CSS viewport pixels or outer-window pixels so geometry results are reproducible.

### 10. The timer and feature-registry contracts contain test and React-hook traps

Acceptance criterion 4 says to grep the clock-pill directory for `setInterval`, but the planned `useClock.js` lives outside that directory. The check can pass while the actual hook uses an interval. More importantly, the already-mounted `HealthBanner` has its own minute-aligned clock, so a second correctly implemented hook still produces two global clock timers.

The registry is described as a data map containing a “data hook.” Selecting different custom hooks dynamically from a registry can break React's Rules of Hooks—the requirement that hooks run in the same order on every render—when a user changes slots.

**Required correction:** test `useClock` directly with fake timers and assert one mounted global clock owner. Search every new clock-related path, not only a directory that excludes the hook. Model slot entries as components, or load their data through one stable controller whose hooks are called unconditionally; do not dynamically invoke a different hook from the selected registry entry.

### 11. Independent preference-hook instances would not update the header reliably

`useShellPreferences` is a normal React hook backed by localStorage; it is not a shared context or external store. Calling it independently in Settings and the clock pill would create separate in-memory states. A same-tab localStorage write does not automatically update the other hook instance.

**Required correction:** keep one preference owner in `App.jsx` and pass slot values/setters to both Settings and the header, or deliberately convert preferences to a shared context/store with focused tests. Keep rollout flags separate from user preferences. The revised file map must include this state threading.

### 12. Capability parity and evidence records are underspecified

Acceptance criterion 8 lists agent diagnostics and provider actions but omits the current per-agent “open agent” actions that Stage 7 says will move. The testing plan defers all component/hook tests to Stage 16, after Stage 8 deletes the old controls. The design-gate section also does not name the required Design Release Record or the sanitized baseline decision, and `review-screenshots/` is not identified as temporary evidence versus committed fixture baseline.

**Required correction:**

- Make the parity inventory a checked table, including all three open-agent actions, the effective “Refresh All” behavior, current provider editing states, Live Work, utility controls, close/focus behavior, and outcome/error feedback.
- Add focused tests before each old capability is removed.
- Name the Design Release Record file and evidence manifest.
- State that permanent images use sanitized fixture data, private live images are temporary and never committed, and missing browser/state evidence blocks release.
- Define the browser-zoom mechanism and computed-geometry script so another reviewer can reproduce it.

## Medium-priority corrections

### 13. Add the required platform role

`PRODUCT_NORTH_STAR.md` requires narrow work to state its role in the broader operational-intelligence platform. The plan explains the local header problem but does not say how the change helps the operator coordinate expert agents and evidence without turning the header into another generic dashboard.

Add a short “Role in the platform” section covering:

- the operator problem solved: fast, truthful situational awareness while working;
- the agent-team benefit: one consistent summary and one route to details/actions;
- what it does not solve: a full observability, notification, or work-management center; and
- how the registry/interrupt contracts remain extensible for later domain modules without showing invented data now.

### 14. Replace “ports unchanged” with measured adaptation

The plan says the prototype's overlap CSS is copied verbatim while also saying the prototype was authored without repository access. Current production has a 44px effective header, late `!important` overrides, asymmetric controls, an existing fixed health pill, and measured mobile exceptions. Prototype geometry cannot be assumed safe unchanged.

Treat those formulas as a hypothesis. Record the exact internal grid/track model after the real content and mobile hierarchy are approved, then prove it with computed geometry and sanitized renderings.

## Recommended replacement sequence

1. **Stage 0 — evidence and decisions:** attach/hash the prototype, inspect the current rendered header and legacy health pill, invoke the Product/UX designer, approve defaults/mobile/replacement behavior mapping, and complete the Product/UX brief.
2. **Stage 1 — no-visual-change foundation:** add characterization tests, define aggregation and interrupt contracts, and extract one shared controller without changing the rendered shell.
3. **Stage 2 — isolated prototype:** build under `prototypes/clock-pill-header/` or use a correctly gated React preview; use sanitized fixture states.
4. **Stage 3 — flagged complete slice:** integrate a responsive replacement with the legacy status pill available only on the flag-off branch, never simultaneously. Complete panel parity, real slots, interrupts, keyboard, reduced motion, and all applicable states before deleting controls.
5. **Stage 4 — evidence and independent decision:** run focused tests and reproducible geometry/console checks, complete the Design Release Record, and give the cold reviewer only the approved brief plus sanitized rendered evidence. Only `YES — RELEASE QUALITY` advances.
6. **Stage 5 — user-approved cutover:** after reviewer and user acceptance, switch the default and retain an explicit rollback window.
7. **Stage 6 — cleanup:** separately approve deletion of the legacy header/health implementation and removal of the rollout flag; update capability mapping and retained baselines.

## Implementation-readiness checklist

Implementation should not begin until all of these are true:

- [ ] The Clock Pill is recorded as the single replacement owner; every `HealthBanner` behavior and the remaining `AgentHealthBanner`/`HealthToast` responsibilities are mapped.
- [ ] The source prototype is accessible and hashed.
- [ ] The Product/UX brief fixes default slot content, mobile hierarchy, status panel structure, height, and state matrix.
- [ ] The effective 44px header and late CSS overrides are reflected in the source map.
- [ ] Rollout control is off by default and can genuinely restore the full legacy shell through acceptance.
- [ ] One controller owns provider polling, agent refresh, provider edits, logs, and clock timing.
- [ ] Health-count and interrupt contracts are explicit and testable.
- [ ] Preferences have one shared in-memory owner.
- [ ] Baseline parity tests exist before capability removal.
- [ ] Exact 390px reachability and zoom/geometry checks are reproducible.
- [ ] The Design Release Record and sanitized evidence locations are named.
- [ ] Deletion/flag removal is a separate post-acceptance cleanup decision.

## Bottom line

Keep the replacement direction, but rewrite the plan as an explicit migration and cutover rather than a parallel addition. Treat the existing status pill as the behavior inventory and rollback branch, establish the new Clock Pill as the single state/controller owner, resolve the mobile and default-content decisions before coding, and preserve the old branch until the complete rendered replacement is accepted.
