# Escalation Workflow Premium Reveal Plan

## Purpose

The user goal is simple: before an escalation screenshot is uploaded, the escalation workflow should feel focused on one action, "upload the QBO escalation image." The downstream agent widgets should not compete for attention until the image has actually started the workflow.

The product workflow is the QBO escalation workflow: screenshot intake starts the coordinated agent team, then the Image Parser, INV Search Agent, Triage Agent, and QBO Assistant move into their working positions. This supports the broader operational-intelligence platform by making the agent team feel like it assembles around evidence, rather than looking like a static dashboard that happens to accept an image.

This plan is intentionally UI-first. It does not change parser behavior, provider runtime selection, evidence persistence, server routes, agent prompts, or the QBO business logic. It only changes how the existing workflow widgets are staged, revealed, and verified.

## Current Code State Verified

Verified in the current checkout on 2026-07-07:

- `client/src/components/chat-v5/ChatV5Container.jsx`
  - Imports `AnimatePresence` and `motion` from `framer-motion`.
  - Defines `WORKFLOW_STEPS` for parser, INV, triage, and main assistant.
  - `WorkflowLane` renders `ImageUploadCard`, a connector, then maps `workflowSteps` into `WorkflowCard` components.
  - `ImageUploadCard` handles drop, paste, click, keyboard upload, and webcam capture.
  - `captureImage` comes from `useStageOrchestrator`.
  - `step1Visible` / `step1Exiting` currently create a state-4-only animation after `parserStatus` becomes `running`.
  - `started` is currently computed as `isStarted(stageState) || imageCaptured || Object.keys(testRuns).length > 0`.
- `client/src/components/chat-v5/chat-v5.css`
  - `.v5-workflow-lane` is a horizontal flex row.
  - `.v5-upload-card` and `.v5-workflow-card` have fixed dimensions and existing hover/status styles.
  - Current late-file CSS includes `.v5-upload-card.is-exiting` and `.v5-workflow-lane.is-shifting`, which are a narrow step-1 exit animation, not the requested hidden-behind-widget reveal.
  - Existing reduced-motion handling already exists and must be extended.
- `client/src/components/chat-v5/useStageOrchestrator.js`
  - `captureImage(imageDataUrl, fileMeta)` sets `imageCaptured` and `capturedImageSrc`, emits parser events, schedules the active widget switch after 320ms, and starts the parser request.
  - `startRequestWithImage` immediately marks the parser stage as `running`.
- `client/src/utils/motion.js`
  - Provides shared Framer Motion transition presets, but no workflow-specific reveal preset yet.
- `client/package.json`
  - Already includes `framer-motion`; no new animation dependency is needed.

## Desired Behavior

### Before Upload

- The workflow lane shows one clear widget: the upload image widget.
- Parser, INV Search Agent, Triage Agent, and QBO Assistant widgets are hidden behind the upload widget.
- Hidden means:
  - They should not be visually readable.
  - They should not be keyboard-focusable.
  - Their menus and profile links should not be reachable by tabbing.
  - Their event-log click behavior should be disabled.
  - Screen readers should not announce them as available workflow controls before the workflow starts.
- A tiny premium hint is acceptable, such as a faint depth shadow or layered edge behind the upload card, but the downstream widgets must not read as separate cards yet.

### On Upload Start

The reveal should begin when the upload successfully enters `captureImage`, not after the parser finishes. This makes the interface respond instantly to the operator action.

Sequence:

1. The upload card acknowledges the screenshot.
   - Icon changes to the existing captured/check state.
   - Card gets a brief, restrained confirmation glow.
   - The upload card stays spatially anchored so the user does not feel the target slipped away.
2. The hidden stack unlocks.
   - The downstream cards move from behind the upload widget into the current row positions.
   - Cards should separate in pipeline order: Image Parser, INV Search Agent, Triage Agent, QBO Assistant.
   - The connectors reveal after the card motion begins, not before.
3. The parser card becomes active.
   - The parser status/meter should start visibly once `stageState.parser.status === 'running'`.
   - The reveal should never delay the actual API request.
4. The row settles.
   - Cards land in their current final sizes and positions.
   - No final layout should be different from the current post-upload workflow row unless explicitly needed for responsiveness.

### On Reset / New Workflow

- Clicking `New` should return to the pre-upload stacked state.
- Any open stage log tabs are already closed by `startNewWorkflow`; the reveal state should reset in the same path.
- Pending reveal timers or animation callbacks must be cancelled so stale animation state cannot re-open old cards after a reset.

### On Resumed Sessions

- If a past conversation is opened with saved pipeline output, the UI should not pretend this is pre-upload.
- Saved runs should render the full workflow row immediately, preferably with no entrance replay.
- Rule: preflight stacked mode is only for a fresh, not-started workflow.

### On Agent Test Runs

- Running a stage test from the hidden pre-upload state should be treated as workflow activity because `started` already considers `testRuns`.
- If tests remain reachable through some other entry point, the row should show the full cards immediately. Do not hide active test state behind the upload card.

## Files To Touch

### Required Production Files

1. `client/src/components/chat-v5/ChatV5Container.jsx`
   - Add an explicit reveal state model for the workflow lane.
   - Replace the current `step1Visible` / `step1Exiting` state-4-only choreography with preflight/revealing/revealed states.
   - Pass reveal status into `WorkflowLane`.
   - Make hidden cards non-interactive before reveal.
   - Use Framer Motion layout animation for card movement and connector reveal.
   - Respect reduced motion.

2. `client/src/components/chat-v5/chat-v5.css`
   - Add preflight stack layout rules.
   - Add reveal-stage visual polish: depth, shadow, connector opacity, settle state, and responsive behavior.
   - Remove or supersede the old `.v5-upload-card.is-exiting` / `.v5-workflow-lane.is-shifting` behavior.
   - Extend `@media (prefers-reduced-motion: reduce)` so the reveal becomes an instant state change.

### Optional Shared Motion File

3. `client/src/utils/motion.js`
   - Add named workflow reveal transitions only if this keeps `ChatV5Container.jsx` readable.
   - If the reveal config is specific to this one component, keep constants in `ChatV5Container.jsx` to avoid polluting the global motion helper.

### Optional Test / Verification Files

4. `client/src/components/chat-v5/__tests__/ChatV5Container.workflowReveal.test.jsx`
   - Add only if a local test pattern already exists or can be added without introducing new test infrastructure.
   - Scope: state/class behavior and accessibility guards, not pixel-perfect animation.

5. No server files should be touched.
   - The server already receives the same image-parser/chat requests.
   - This change must not alter `/api/image-parser/parse`, `/api/chat`, `/api/pipeline-tests`, or persistence behavior.

## Implementation Plan

### Phase 1: Name The Workflow State

Add a small, explicit state machine in `ChatV5Container.jsx`:

```jsx
const WORKFLOW_REVEAL = Object.freeze({
  PREFLIGHT: 'preflight',
  REVEALING: 'revealing',
  REVEALED: 'revealed',
});
```

Use plain meanings:

- `preflight`: no workflow has started; only upload is actionable.
- `revealing`: image has been accepted; downstream cards are animating out from the stack.
- `revealed`: normal workflow row.

Initialize the reveal state as preflight, then promote it from real workflow state once the component has the current `started`, `effectiveCaseIntake`, and `pastCaseIntake` values available. This avoids referencing values before they are declared in the component body.

```jsx
const [workflowReveal, setWorkflowReveal] = useState(WORKFLOW_REVEAL.PREFLIGHT);

const workflowHasActivity = started || Boolean(effectiveCaseIntake) || Boolean(pastCaseIntake);
```

Because `workflowHasActivity` can change after async hydration, add an effect:

```jsx
useEffect(() => {
  if (workflowHasActivity) {
    setWorkflowReveal((current) => (
      current === WORKFLOW_REVEAL.PREFLIGHT ? WORKFLOW_REVEAL.REVEALED : current
    ));
  }
}, [workflowHasActivity]);
```

Important: avoid replaying the reveal when history loads. History is evidence from an earlier run; it should appear as already assembled.

Placement note: compute `workflowHasActivity` after the existing `started` constant and after `effectiveCaseIntake` is available. The hook itself can still be declared earlier only if the effect uses values that are already in scope; during implementation, keep this block near the current `started` calculation to avoid accidental hook-order or temporal-dead-zone mistakes.

### Phase 2: Trigger Reveal At Capture

Wrap the existing `captureImage` before passing it to `WorkflowLane` and `AnalystWorkbench`:

```jsx
const revealWorkflow = useCallback(() => {
  setWorkflowReveal((current) => (
    current === WORKFLOW_REVEAL.PREFLIGHT
      ? WORKFLOW_REVEAL.REVEALING
      : current
  ));
}, []);

const handleCaptureImage = useCallback((imageDataUrl, fileMeta) => {
  if (!imageDataUrl) return;
  revealWorkflow();
  captureImage(imageDataUrl, fileMeta);
}, [captureImage, revealWorkflow]);
```

Use `handleCaptureImage` everywhere the main chat page starts image capture:

- `WorkflowLane onCapture`
- `AnalystWorkbench onCaptureImage`

Why: a paste/drop into the center workbench and a click/drop on the upload card must produce the same reveal.

After the reveal animation finishes, transition to `revealed`:

```jsx
const revealSettleTimerRef = useRef(null);

useEffect(() => {
  if (workflowReveal !== WORKFLOW_REVEAL.REVEALING) return undefined;
  if (revealSettleTimerRef.current) clearTimeout(revealSettleTimerRef.current);
  revealSettleTimerRef.current = window.setTimeout(() => {
    revealSettleTimerRef.current = null;
    setWorkflowReveal(WORKFLOW_REVEAL.REVEALED);
  }, shouldReduceMotion ? 0 : 760);
  return () => {
    if (revealSettleTimerRef.current) {
      clearTimeout(revealSettleTimerRef.current);
      revealSettleTimerRef.current = null;
    }
  };
}, [workflowReveal, shouldReduceMotion]);
```

Use `useReducedMotion` from `framer-motion`:

```jsx
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
```

### Phase 3: Replace Old Step-1 Exit Behavior

Remove or retire these current local states:

- `step1Visible`
- `step1Exiting`
- `prevParserStatusRef`
- `step1TimerRef`
- `isState4Ref`
- the effect that only hides step 1 when state 4 is active and parser becomes running

Do not hide the upload card after upload as part of this change unless product direction changes. The requested behavior is downstream cards hidden behind widget 1 until workflow start, then moved to current places. The current screenshots show widget 1 as part of the row; after reveal, keep that current place unless the user separately asks to remove it.

### Phase 4: Update `WorkflowLane`

Change props:

```jsx
function WorkflowLane({
  ...
  revealState,
  reduceMotion,
})
```

Compute flags:

```jsx
const preflight = revealState === WORKFLOW_REVEAL.PREFLIGHT;
const revealing = revealState === WORKFLOW_REVEAL.REVEALING;
const revealed = revealState === WORKFLOW_REVEAL.REVEALED;
const cardsInteractive = !preflight;
```

Lane class:

```jsx
className={[
  'v5-workflow-lane',
  `is-${revealState}`,
  preflight ? 'is-stacked' : '',
].filter(Boolean).join(' ')}
```

Render strategy:

- Keep cards mounted in all modes so Framer Motion can animate from stacked to row layout.
- During `preflight`, downstream cards get:
  - `aria-hidden="true"`
  - `inert=""` if browser support is acceptable; otherwise manually remove focusability.
  - `tabIndex={-1}` for card wrappers.
  - profile links and menu buttons disabled from focus with `tabIndex={-1}` and `aria-hidden`.
  - `pointer-events: none` through CSS.
- During `revealing` and `revealed`, normal accessibility and click behavior return.

Recommended component signature change:

```jsx
function WorkflowCard({
  ...
  interactive = true,
  revealIndex = 0,
  revealState = WORKFLOW_REVEAL.REVEALED,
})
```

Inside `WorkflowCard`:

- Apply `aria-hidden={!interactive ? true : undefined}`.
- `role`, `tabIndex`, and `aria-label` only apply when `interactive && clickable`.
- Profile link:

```jsx
tabIndex={interactive ? 0 : -1}
aria-hidden={!interactive ? true : undefined}
onClick={!interactive ? (event) => event.preventDefault() : undefined}
```

- Menu button disabled or `tabIndex={-1}` while hidden.

This prevents a common premium-UI failure: beautiful hidden controls that still receive keyboard focus.

### Phase 5: Use Layout Animation For Premium Movement

Use Framer Motion for layout-aware movement, not a hand-coded fixed `translateX` for every viewport. The lane already has variable widths because of sidebars and breakpoints, so layout animation is safer.

Recommended structure:

```jsx
<motion.div
  layout
  className={laneClassName}
  transition={reduceMotion ? { duration: 0 } : WORKFLOW_LANE_TRANSITION}
>
```

Wrap card groups:

```jsx
<motion.div
  layout
  className="v5-workflow-lane__group"
  data-reveal-index={index + 1}
  initial={false}
  animate={preflight ? 'stacked' : 'row'}
  variants={workflowGroupVariants(index)}
  transition={reduceMotion ? { duration: 0 } : workflowCardTransition(index)}
>
```

Variants:

```jsx
const workflowCardStackVariants = (index) => ({
  stacked: {
    x: -(UPLOAD_CARD_WIDTH + 14) - index * 8,
    y: index % 2 === 0 ? 2 : -2,
    scale: 0.92 - index * 0.015,
    opacity: 0,
    filter: 'blur(2px)',
    zIndex: 3 - index,
  },
  row: {
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)',
    zIndex: 1,
  },
});
```

Important: the exact `x` value should be finalized with browser screenshots. The plan target is that all downstream cards originate from the upload-card footprint, not from off-screen.

Use staggered spring timing:

- Parser: starts immediately, 0ms delay.
- INV Search: 70ms delay.
- Triage: 115ms delay.
- QBO Assistant: 160ms delay.
- Connectors: fade/scale after their left card begins moving, 110ms to 230ms.

Recommended transition:

```jsx
const WORKFLOW_CARD_REVEAL_TRANSITION = {
  type: 'spring',
  stiffness: 360,
  damping: 34,
  mass: 0.82,
};
```

The premium feel comes from:

- Movement tied to layout, not magic numbers.
- Subtle stagger, not a slow parade.
- Cards separating as a team, not popping one by one.
- No bounce-heavy toy motion.
- No delay to the real parser request.

### Phase 6: CSS For Stacked And Revealed States

Add near the existing workflow lane styles in `chat-v5.css`:

```css
.v5-workflow-lane {
  isolation: isolate;
  overflow-x: auto;
  overflow-y: visible;
}

.v5-workflow-lane.is-preflight {
  justify-content: flex-start;
  padding-left: clamp(62px, 7vw, 124px);
}

.v5-workflow-lane.is-preflight .v5-upload-card {
  z-index: 10;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.05) inset,
    0 18px 42px rgba(0, 0, 0, 0.34),
    18px 10px 36px rgba(0, 0, 0, 0.22);
}

.v5-workflow-lane.is-preflight .v5-workflow-lane__group {
  pointer-events: none;
}

.v5-workflow-lane.is-preflight .v5-workflow-card {
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.03) inset,
    0 16px 34px rgba(0, 0, 0, 0.26);
}

.v5-workflow-lane.is-revealing .v5-upload-card {
  border-color: color-mix(in srgb, var(--v5-blue) 68%, white);
  background:
    radial-gradient(circle at 50% 14%, color-mix(in srgb, var(--v5-blue) 18%, transparent), transparent 42%),
    var(--bg);
}

.v5-workflow-lane.is-preflight .v5-workflow-connector {
  opacity: 0;
  transform: scaleX(0.4);
}

.v5-workflow-lane.is-revealing .v5-workflow-connector,
.v5-workflow-lane.is-revealed .v5-workflow-connector {
  opacity: 1;
  transform: scaleX(1);
}
```

Also remove or neutralize:

```css
.v5-upload-card.is-exiting { ... }
.v5-workflow-lane.is-shifting { ... }
```

Those rules conflict with the new model because the upload card should remain the anchor, not fly away.

### Phase 7: Responsive Behavior

The reveal must work in these layouts:

- Wide desktop, right dock open.
- Wide desktop, right dock collapsed.
- State 4: left sidebar expanded and right dock open. This is the screenshot's tightest horizontal case.
- Under `1320px`.
- Under `1100px` where the evidence dock moves below.
- Under `860px` where the console scrolls vertically.

Rules:

- In preflight, keep upload centered enough to look intentional, but do not use viewport-width font scaling or unstable sizes.
- On narrow widths, the hidden stack should still originate behind upload and then reveal into the existing horizontal scroll row.
- Do not set `overflow: visible` in a way that leaks cards over the evidence dock or sidebar.
- Use `overflow-y: visible` only if needed for shadows; keep horizontal overflow controlled.
- Avoid changing final card widths. The current layout has careful width reductions for state 4.

### Phase 8: Accessibility And Reduced Motion

Reduced motion:

- If `prefers-reduced-motion: reduce`, switch directly from preflight to revealed.
- No stagger, no blur, no glow pulse, no connector scale.
- Cards should appear in final row without transform animation.

Keyboard:

- Before upload: tab order should reach upload card and its webcam button only.
- After upload: tab order should include downstream card links/actions normally.
- If the user starts the workflow with paste/drop into the central workbench, focus should not be thrown into a hidden card.

Screen readers:

- Before upload: announce the workflow lane as image intake only.
- During/after reveal: announce the full escalation workflow.
- Do not use `display: none` for cards if layout animation needs them mounted; instead use `aria-hidden`, `inert`, and focus guards.

### Phase 9: Failure And Edge Cases

1. Parser fails after upload
   - Keep full workflow row revealed.
   - Parser card shows failed state as today.
   - Do not collapse back behind upload; that would hide the error.

2. Upload is rejected because no image file exists
   - Do not trigger reveal.
   - Current `submitFile` already returns when no file is found; the wrapper must preserve that.

3. Duplicate upload while `imageCaptured` is already true
   - Existing `captureImage` returns early.
   - Reveal state should already be `revealing` or `revealed`; no duplicate animation.

4. Webcam modal
   - Opening webcam should not reveal the workflow.
   - Reveal only after `handleWebcamCapture` provides an actual image.

5. Cancel pipeline
   - If cancel uses `reset()`, return to preflight.
   - If cancel leaves failure evidence visible, keep revealed. Confirm the actual `confirmCancelPipeline` path before implementation.

6. New workflow
   - Explicit `New` should reset reveal to `preflight`.
   - Clear timers.

7. Route hydration
   - Saved sessions should load as `revealed`.
   - Avoid a reveal replay on old evidence.

8. Provider health polling
   - Health dots/status remain accurate, but hidden cards should not flash visible while health refreshes.

9. Slow machine / animation frame drops
   - Layout must end in correct final state even if animation skips frames.
   - Timer only marks "settled"; it must not be required for the cards to reach their final CSS layout.

10. Browser support for `inert`
   - Chromium supports it, but include fallback by managing `tabIndex`.

## Verification Plan

Do not start or restart the user's dev server unless explicitly asked. If a server is already running, inspect it only.

Static checks:

1. `npm --prefix client run build`
   - Confirms React/Vite compile.

Browser checks with an already-running app or after user-approved server start:

1. Fresh chat page before upload
   - Only upload widget visible.
   - Downstream widgets hidden behind it.
   - Tab order does not reach hidden profile links or menus.

2. Upload via card click
   - Reveal starts immediately after image selected.
   - Parser request is not delayed.
   - Cards animate from behind upload into current row.
   - Final card positions match the current layout.

3. Upload via paste/drop into central workbench
   - Same reveal behavior.

4. Webcam capture
   - Opening modal does not reveal.
   - Capturing image reveals.

5. Parser failure
   - Full row remains visible and parser error remains visible.

6. New workflow
   - Returns to preflight stacked state.

7. Resumed saved session
   - Full row appears without replaying the reveal.

8. Reduced motion
   - Simulate `prefers-reduced-motion: reduce`.
   - Cards appear without animation and remain accessible only after start.

9. Responsive screenshots
   - Desktop around 1880px wide.
   - State 4 around 1440px wide with both sidebars open.
   - 1100px.
   - 860px/mobile-ish.

Recommended browser evidence:

- Before-upload screenshot.
- Mid-reveal screenshot or short capture if tooling supports it.
- After-reveal screenshot.
- Reduced-motion screenshot.

## Acceptance Criteria

- Before upload, the escalation workflow shows only the upload image widget as an actionable card.
- Downstream widgets are visually hidden behind the upload widget before workflow start.
- Downstream widgets are not keyboard-focusable before workflow start.
- Upload, paste, drop, and webcam capture all trigger the same reveal path once a real image is accepted.
- The reveal feels premium: anchored, smooth, fast, and restrained.
- The parser request begins immediately and is not delayed by animation.
- The final row lands in the current layout positions.
- Existing stage statuses, progress meters, health dots, event logs, copy buttons, and agent profile links still work after reveal.
- New/reset returns to the pre-upload state.
- Resumed sessions do not replay the reveal.
- Reduced-motion users get a clean instant state change.
- No server behavior changes.

## Risk Review

### Highest-Risk Area: Accessibility

The most likely senior-engineer blocker is hidden controls that are still reachable by keyboard or screen reader. The plan must implement both visual hiding and interaction hiding. CSS `pointer-events: none` is not enough because it does not remove keyboard focus.

Mitigation:

- Add an `interactive` prop to `WorkflowCard`.
- Guard `role`, `tabIndex`, profile links, and menu controls.
- Add browser verification with tab order.

### Second-Risk Area: State Drift

The current UI has multiple ways to enter workflow activity: fresh upload, workbench paste/drop, webcam capture, route hydration, tests, and reset. A reveal animation tied only to `parserStatus === 'running'` would miss some of these or replay at the wrong time.

Mitigation:

- Trigger reveal from accepted image capture.
- Derive immediate revealed state from saved/hydrated/test activity.
- Reset explicitly through `startNewWorkflow`.

### Third-Risk Area: Layout Breakage In State 4

The current CSS already has special width handling for state 4. A fixed transform-only reveal could break on the screenshot's tight layout.

Mitigation:

- Use Framer Motion layout animation.
- Keep final dimensions unchanged.
- Verify state 4 specifically.

### Fourth-Risk Area: Animation Feeling Decorative

The upgrade should communicate "the agent team is assembling after evidence intake," not merely perform a flashy card trick.

Mitigation:

- Keep the upload card anchored.
- Keep timings under one second.
- Use subtle depth, spring movement, connector reveal, and no excessive bounce.
- Let parser active state take over immediately after reveal begins.

## Self-Review Pass

### Review 1: Does The Plan Match The User Goal?

Yes. It hides downstream widgets behind the upload widget until image upload starts, then reveals them into their current positions. It keeps the upload widget as the first visible action and treats the reveal as part of the escalation workflow, not a generic animation.

### Review 2: Does It Name All Likely Files?

Yes for production implementation:

- `client/src/components/chat-v5/ChatV5Container.jsx`
- `client/src/components/chat-v5/chat-v5.css`
- optionally `client/src/utils/motion.js`
- optionally a focused client test file if the repo has a suitable pattern

No server files should be touched.

### Review 3: Does It Respect Current Runtime Ownership?

Yes. Verification says not to start or restart the user's dev server without explicit approval. Build and static checks are allowed. Browser verification should use an already-running app or wait for user approval to start one.

### Review 4: Does It Protect Existing Workflow Behavior?

Mostly yes. The key requirement is to make `handleCaptureImage` call the existing `captureImage` immediately after setting reveal state, so the parser request path is unchanged. The plan also keeps existing workflow cards mounted, preserving status rendering and layout animation.

### Review 5: What Still Needs Confirmation During Implementation?

- The exact cancel path should be re-read before code changes to decide whether cancel should reset to preflight or keep a visible failed/cancelled row.
- The exact final transform offsets for the stacked hidden cards should be tuned in browser screenshots.
- If `inert` causes React warnings in this toolchain, use focus guards plus `aria-hidden` instead.

Confidence after self-review: high. The plan is grounded in the current code, limits changes to the chat-v5 UI surface, preserves the real parser workflow, and identifies the main senior-review risks.
