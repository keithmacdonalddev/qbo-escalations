# Review: `dev-mode-feature-flag.md`

## Verdict

Do not implement this plan as written.

The goal is valid, but the plan materially underestimates how much dev-mode code is currently pulled into the app and server at startup. The biggest problem is that it treats "not rendered" as if it were "not imported" or "not shipped." In this codebase, those are not the same thing.

## Findings

### 1. High: the client-side gating strategy runs too late to prevent dev code from loading

Plan references:
- `tmp/plans/dev-mode-feature-flag.md:44-48`
- `tmp/plans/dev-mode-feature-flag.md:149-181`

Why this is a problem:
- The plan assumes `await loadFeatureFlags()` in `main.jsx` can decide whether dev modules are imported.
- That is not how the current module graph is wired. `client/src/main.jsx` already statically imports `App` and `CrashModeAgent` before any boot-time fetch can run.
- `client/src/App.jsx` also statically imports `DevMode`, `ModelLab`, `DevMiniWidget`, and `DevAgentProvider`.

Current code evidence:
- [client/src/main.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/main.jsx#L7) imports `CrashModeAgent`.
- [client/src/main.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/main.jsx#L8) imports `App`.
- [client/src/App.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/App.jsx#L13) imports `DevMode`.
- [client/src/App.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/App.jsx#L15) imports `ModelLab`.
- [client/src/App.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/App.jsx#L16) imports `DevMiniWidget`.
- [client/src/App.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/App.jsx#L34) imports `DevAgentProvider`.

Impact:
- Step 4 and Step 6 do not achieve the stated goal of "zero dev-mode JavaScript downloaded."
- Gating `CrashModeAgent` at render time only hides it. It does not stop the module from being bundled and downloaded.
- The sample `DevAgentGate.jsx` design is also evaluated after `App` is imported, so it cannot be the first line of defense.

What the plan needs instead:
- Either dynamically import the app shell after feature flags are loaded, or
- Accept a smaller goal such as "disable dev UI and background behavior" rather than "zero dev-mode JS."

### 2. High: server route gating in `app.js` is not enough because dev modules are imported at process startup elsewhere

Plan references:
- `tmp/plans/dev-mode-feature-flag.md:93-125`
- `tmp/plans/dev-mode-feature-flag.md:264`

Why this is a problem:
- The plan assumes conditional `app.use(...)` calls in `server/src/app.js` are enough to keep dev code and dev models out of memory.
- The server currently imports dev-related modules directly from `server/src/index.js` before route registration even matters.

Current code evidence:
- [server/src/index.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/index.js#L7) imports `reportServerError`.
- [server/src/index.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/index.js#L8) imports `startCleanupSchedule`.
- [server/src/index.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/index.js#L24) imports `stopDevSessionPruning` from `routes/dev`.
- [server/src/lib/server-error-pipeline.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/lib/server-error-pipeline.js#L3) imports `DevAgentLog` at module scope.
- [server/src/lib/cleanup.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/lib/cleanup.js#L3) imports `DevConversation`.
- [server/src/lib/cleanup.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/lib/cleanup.js#L4) imports `DevAgentLog`.
- [server/src/routes/dev.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/server/src/routes/dev.js#L229) starts a dev-session prune interval at module load.

Impact:
- The plan's claim that `DevConversation`, `DevAgentLog`, and related dev infrastructure will not load is currently false.
- Even if `/api/dev` is not mounted, dev-session pruning still starts because `server/src/index.js` imports from `routes/dev` directly.
- This also conflicts with the repo instruction to avoid background jobs/watchers when a feature flag is off.

What the plan needs instead:
- Move `stopDevSessionPruning` out of `routes/dev.js` into a dedicated module that can be safely imported without loading the whole dev route.
- Audit all startup imports that pull in `DevAgentLog` and `DevConversation`.
- Gate cleanup and dev logging behavior at startup, not only at route registration.

### 3. High: the plan misses shared UI surfaces that still expose dev mode when the sidebar is hidden

Plan references:
- `tmp/plans/dev-mode-feature-flag.md:28`
- `tmp/plans/dev-mode-feature-flag.md:200-222`
- `tmp/plans/dev-mode-feature-flag.md:248-251`

Why this is a problem:
- The plan focuses on sidebar items and the main dev route.
- The app also exposes dev functionality through the global dock, which is always rendered on most views.

Current code evidence:
- [client/src/components/AgentDock.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/AgentDock.jsx#L9) defines a permanent `dev` tab in `TAB_OPTIONS`.
- [client/src/App.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/App.jsx#L315) renders `AgentDock` whenever `showGlobalDock` is true.
- [client/src/components/AgentDock.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/AgentDock.jsx#L5) statically imports `useDevAgent`.
- [client/src/components/WorkspaceAgentPanel.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/WorkspaceAgentPanel.jsx#L4) also statically imports `useDevAgent`.

Impact:
- Hiding `Sidebar` entries is not enough. Users can still see a "Dev Agent" tab in the dock.
- Because `AgentDock` and `WorkspaceAgentPanel` import `useDevAgent`, `DevAgentContext.jsx` is still part of the client bundle even if the provider is never mounted.
- The plan's statement that `client/src/context/DevAgentContext.jsx` is "never imported when off" is incorrect in the current architecture.

What the plan needs instead:
- Explicitly gate the dock's dev tab.
- Separate workspace-only behavior from dev-agent behavior if the workspace panel must remain available with dev mode disabled.
- Re-audit every static import of `useDevAgent()`, not just the top-level provider.

### 4. Medium: the plan would orphan a shared main-chat diagnostic path that currently depends on `/api/dev/health`

Plan references:
- `tmp/plans/dev-mode-feature-flag.md:22-31`
- `tmp/plans/dev-mode-feature-flag.md:216-222`
- `tmp/plans/dev-mode-feature-flag.md:269-278`

Why this is a problem:
- The plan assumes `/api/dev/*` can disappear entirely when the flag is off.
- The normal chat surface still polls `/api/dev/health` for runtime diagnostics when context debug is enabled.

Current code evidence:
- [client/src/components/chat/useChatRuntimeEffects.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/chat/useChatRuntimeEffects.js#L169) begins the runtime polling effect.
- [client/src/components/chat/useChatRuntimeEffects.js](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/components/chat/useChatRuntimeEffects.js#L180) fetches `/api/dev/health`.

Impact:
- If `/api/dev/health` becomes a 404, this shared chat diagnostic path silently loses data.
- That may be acceptable, but the plan needs to say so explicitly. Right now it presents the change as isolated to "dev mode."

What the plan needs instead:
- Either move shared runtime diagnostics to a non-dev endpoint, or
- Explicitly mark this diagnostic UI as dev-only and gate it too.

### 5. Medium: boot-time flag fetching can stall first paint, and the fail-open policy conflicts with the stated sync model

Plan references:
- `tmp/plans/dev-mode-feature-flag.md:40-48`
- `tmp/plans/dev-mode-feature-flag.md:132-144`
- `tmp/plans/dev-mode-feature-flag.md:259`

Why this is a problem:
- The proposal blocks render on `fetch('/api/health')`.
- The sample implementation has no timeout or abort path.
- The same section says the server env var keeps client and server "always in sync," then immediately adds a fail-open behavior that intentionally allows desync when the health request fails.

Current code evidence:
- [client/src/main.jsx](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/client/src/main.jsx#L23) currently renders immediately.

Impact:
- If the API is slow or unavailable, the app can sit blank while waiting for the browser fetch to resolve or time out.
- In the failure case, the client may show dev UI while the server is actually returning 403/404, which is the opposite of "single source of truth."

What the plan needs instead:
- Add a short timeout.
- Define whether the desired fallback is fail-open, fail-closed, or "use last known value."
- If local debugging is the reason for fail-open, limit that behavior to a clearly defined development-only path.

### 6. Low: the optional Vite-plugin step reintroduces config drift

Plan references:
- `tmp/plans/dev-mode-feature-flag.md:224-226`

Why this is a problem:
- The plan's earlier design decision is "server env var exposed via `/api/health`" as the source of truth.
- Step 9 then proposes reading `server/.env` directly from the Vite plugin.

Impact:
- This duplicates config parsing in two places.
- It can drift from real runtime env values injected outside `.env`.
- It requires a separate Vite restart and no longer matches the server-owned toggle model.

What the plan needs instead:
- Either keep the plugin always on and tolerate the no-op/404 behavior, or
- Use a shared config loader that both server startup and Vite config consume consistently.

## Overall Critique

The plan is directionally correct, but its risk level is understated. In the current codebase this is not a "low-risk additive gate." It touches:

- client bootstrap order
- bundle boundaries
- shared dock UI
- shared workspace surfaces
- server startup imports
- background timers
- shared runtime diagnostics

That makes this at least a medium-risk refactor.

## Recommended Rewrite

Revise the plan before implementation around these principles:

1. Reduce the promise.
Set the first milestone to "disable dev UI, routes, and background behavior when off." Do not promise "zero dev-mode JS downloaded" until the import graph is actually reworked.

2. Split server startup from dev-route code.
Extract `stopDevSessionPruning` and any other dev-session lifecycle logic out of `routes/dev.js`. Gate cleanup and dev logging modules from `server/src/index.js`, not only from `server/src/app.js`.

3. Treat the client as a bootstrap problem, not just a render problem.
If "zero dev JS" is a hard requirement, load flags before importing the dev-bearing app modules, or create a thin bootstrap shell that conditionally imports a dev-enabled app subtree.

4. Audit every shared surface.
Include `AgentDock`, `WorkspaceAgentPanel`, `CrashModeAgent`, and chat runtime diagnostics in scope. The sidebar is only one of several dev entry points.

5. Add targeted verification for both startup states.
The current checklist is UI-focused. It should also verify that startup imports, intervals, and model registration do not happen when `ENABLE_DEV_MODE=false`.

## Suggested Verification Additions

- Confirm `server/src/index.js` no longer imports `routes/dev` when `ENABLE_DEV_MODE=false`.
- Confirm no dev-session prune interval starts when `ENABLE_DEV_MODE=false`.
- Confirm `DevAgentLog` and `DevConversation` are not loaded at server startup when `ENABLE_DEV_MODE=false`.
- Confirm the global dock has no `Dev Agent` tab when `ENABLE_DEV_MODE=false`.
- Confirm shared chat runtime diagnostics still behave intentionally, either by using a replacement endpoint or by being explicitly disabled.

## Testing Notes

No tests were run for this review. This was a design critique validated against the current source tree.
