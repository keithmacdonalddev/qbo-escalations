** -------------------- User Notes -------------------- **
-see if an endpoint is trending slower or just had a one-off spike.
-tool events panel, context debug viewer, maybe the copilot panel.
-automatically send bugs to in app claude developer
-find way to have in app claude monitor chrome dev tools for all issues and act immediately
** ------------------ End User Notes ------------------ **

# Unique Special Feature Ideas & Suggestions

---

## Implemented Features

Features confirmed as implemented in the codebase. Do NOT re-suggest these.

| # | Feature | Evidence |
|---|---------|----------|
| #35 | Vite Compile-Error Bridge | `client/vite-plugin-dev-agent-bridge.js` |
| #36 | Error Cascade Detector | `client/vite-plugin-dev-agent-bridge.js` (`[CASCADE]` tags) |
| #19 | Server-Side Error Pipeline | `server/src/lib/server-error-pipeline.js` |
| #31 | Agent Prompt Inspector Sidebar | `client/src/components/PromptInspector.jsx` |
| #17 | Background Task Activity Feed | `client/src/components/AgentActivityLog.jsx` |
| #4/#14 | Playbook Diff Viewer / Version Diff | `client/src/components/PlaybookEditor.jsx` (`computeDiff`) |
| -- | Flame Bar with Pause and Clear | `client/src/components/FlameBar.jsx` |
| -- | Flame Bar Heatmap Timeline (60s) | `client/src/components/FlameBar.jsx` (timeline prop) |
| -- | Session Recovery / Safe Reload | `client/src/main.jsx`, `Chat.jsx` (sessionStorage) |
| -- | Error Boundary + Crash Mode Agent | `CrashModeAgent.jsx`, `ErrorFallback.jsx` |
| -- | Request Waterfall Panel | `client/src/hooks/useRequestWaterfall.js` |
| -- | Circuit Breaker + Status Indicator | `client/src/api/http.js` |
| -- | Token Monitor with Budget States | `client/src/hooks/useTokenMonitor.js` |
| -- | Single-Flight Request Dedup | `client/src/api/http.js` (singleFlight) |
| -- | CalendarView (Google Calendar UI) | `client/src/components/CalendarView.jsx` |
| -- | GmailInbox (Gmail UI) | `client/src/components/GmailInbox.jsx` |
| -- | Conversation Fork API | `server/src/routes/chat.js` (`/fork`) |
| -- | Smart Compose (ghost-text) | `Chat.jsx`, `smartComposeSuggestions.js` |
| -- | Client Health Monitor + Heap Tracking | `useClientHealthMonitor.js` |
| -- | Dev Mini Widget | `client/src/components/DevMiniWidget.jsx` |
| -- | Workspace Agent Panel | `client/src/components/WorkspaceAgentPanel.jsx` |
| -- | LED Pulse Speed Control | `client/src/App.css` |
| #68 | Gmail Smart Folder Sync | `client/src/components/GmailInbox.jsx` (LabelSidebar) |
| #69 | Smart Unsubscribe Detector | `GmailInbox.jsx` (UnsubscribePanel), `server/src/services/gmail.js` |
| -- | Gmail Default Inbox View + Density Fix | `GmailInbox.jsx`, `App.css` |
| #70 | Gmail Tracker Pixel Shield | `gmail.js`, `gmail routes`, `GmailInbox.jsx`, `App.css` |
| -- | Multi-Gmail Account Support | `GmailAuth.js`, `gmail.js`, `gmail routes`, `GmailInbox.jsx` |
| -- | Monitor Crash Escalation | `DevAgentMonitors.jsx` (MonitorFallback → /api/dev/monitor) |

---

## Template for Adding New Features

** ADD SPECIAL FEATURES BELOW THIS LINE **

Date: todays date
Time: AST you posted the feature
Model: what model you are
Is duplicate?: yes or no
Complexity: low / medium / high
Special Feature: summarize the special feature here

> **Before adding a feature:** Check the "Implemented Features" section above
> and search the existing backlog below to avoid duplicates.
>
> **QUALITY BAR (mandatory):**
> - This is a PERSONAL app — features can be work, personal, fun, creative, experimental. Not limited to QBO escalations.
> - NO dev tooling (HMR detectors, hook linters, Vite plugins, flame bar tweaks, error boundary improvements, module staleness checks).
> - NO micro-UI polish (scroll shadows, breadcrumbs, resize handles, color dots, export buttons).
> - NO variations of existing features. If something similar already exists below, think of something completely different.
> - Think BIG, SURPRISING, and CREATIVE. "Wow, I want that" or "that's cool" is the bar. Things no other app does.
> - 2-3 sentences max. No walls of text.

---

## Backlog -- Brainstorm Ideas

Original brainstorm ideas not yet implemented, organized by area.

### Sidebar & Navigation

- Expand-on-hover behavior for collapsed sidebar (like VS Code auto-hide).
- Keyboard shortcut support (e.g., `[` to toggle collapse) with configurable Keybindings.
- "Pin" icon in hover-expanded state to permanently un-collapse.
- "Peek mode" -- Shift+hover for translucent preview of conversation list.
- Visual "slide" transition for hover expand/collapse with content fade-in.
- Drag-to-reorder sidebar navigation items, persisted to localStorage.
- "Request heatmap" overlay on nav items showing API call count per view.

### Settings & Configuration

- "Compact mode" toggle reducing padding and font sizes.
- Responsive breakpoint awareness with live badge and customizable thresholds.
- Keyboard shortcut overlay (`?` for cheat sheet like GitHub).
- Settings search/filter by keyword.
- "Settings diff" view -- "Unsaved" pill with before/after popover and "Reset to defaults."

### Chat & Conversation UI

- conversationMutated CustomEvent for sub-second sidebar refresh without polling.
- Auto-resize compose card min-height based on conversation depth.
- Character count/token estimate near send button (200+ chars).
- Message timestamp hover card with datetime, provider, tokens, cost.
- "Retry" button on orphaned user messages.
- Keyboard shortcuts for orphaned messages (R=retry, E=edit, D/Esc=delete).
- Conversation branching UI for forking from any message. *(Fork API exists, no UI.)*

### Error Handling & Recovery

- "HMR desync detected -- click to refresh" toast.
- Full conversation-ID session recovery from error boundary. *(Draft/scroll save exists, not conversation-ID.)*

### Network & Request Waterfall (Dev Panel)

- "Health pulse" status dot on sidebar header.
- "Slow query" warning banner (>3s response).
- visibilitychange listener for instant poll on tab focus.
- Request latency heatmap coloring (green/yellow/red, p50/p95).
- Request timeline ruler with auto-scaling markers.
- Request body inspector (click to expand parsed JSON).
- Endpoint performance sparklines (last 20 response times).
- Connection quality indicator (3-bar signal icon for circuit breaker).
- Network health sparkline (10 request durations as mini chart).
- Request budget indicator gauge (concurrent vs max).
- Waterfall export button (HAR-like JSON/CSV to clipboard).
- "Request replay storm" simulator (20 rapid GETs).
- Request deduplication detection (visual indicator within 100ms).
- Waterfall request diff view (side-by-side two rows).
- Request timeline heatmap (density gradient of request frequency).
- "Request timeline sparkline" on circuit breaker indicator.
- "Request fingerprint" -- unique identicon per endpoint.
- "Slow endpoint spotlight" -- pulsing amber border at p95 threshold.
- "Request replay queue" -- shift-click to queue and replay.
- Network health score (0-100 composite grade).
- Slow request auto-diagnosis (plain-English on click).
- Request replay comparison (pin, replay, compare side-by-side).

### Flame Bar & Performance Monitoring

- "Snapshot" button (segment strip as PNG to clipboard).
- Keyboard shortcuts (Ctrl+Shift+P/K/E for pause/clear/expand).
- "Last HMR reload" timestamp in stats, fading after 30s.
- Render storm alerts ("storm detected" badge, auto-pause, snapshot).
- "Hook health" indicator (hooks per render, change flagging).
- "Peak render" indicator (worst render time badge).

### Advanced Features

- "Session replay" mode rendering JSONL as interactive timeline.

---

## Backlog -- Numbered Feature Suggestions

Features submitted via template, not yet implemented.

---

### Special Feature #1

Date: 2026-03-01
Time: 10:45 AST
Model: Claude Haiku 4.5
Is duplicate?: No
Special Feature: Conversation search with AI semantic matching -- Sidebar search bar for finding past conversations by meaning using Claude CLI.

---

### Special Feature #2

Date: 2026-03-01
Time: 14:30 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Dev Mode System Prompt Editor -- collapsible panel for persistent system prompt injected on every dev Claude spawn.

---

### Special Feature #3

Date: 2026-03-01
Time: 15:05 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Escalation Replay Mode -- timeline scrubber to replay resolved escalations step-by-step for training.

---

### Special Feature #5a

Date: 2026-03-04
Time: 13:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook Confidence Heatmap -- color-coded confidence on playbook categories with "contribute" prompt for sparse areas.

---

### Special Feature #5b

Date: 2026-03-06
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Playbook Cross-Category Search -- search bar querying all categories with highlighted excerpts.

---

### Special Feature #6a

Date: 2026-03-04
Time: 14:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Skill Health Dashboard -- dev panel showing skill activation counts, ratios, token cost, dormant flags.

---

### Special Feature #6b

Date: 2026-03-06
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Playbook Version Tagging -- optional text label on save shown in History panel.

---

### Special Feature #7a

Date: 2026-03-05
Time: 10:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Skill Auto-Trigger Debugger -- dev panel showing which skills Claude considered with one-click refinement.

---

### Special Feature #7b

Date: 2026-03-06
Time: 19:37 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Health Monitor Confidence Score -- 0-100 confidence per alert. Low-confidence dimmed. Adjustable threshold.

---

### Special Feature #8

Date: 2026-03-06
Time: 11:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Escalation Knowledge Gap Detector -- weekly report analyzing resolved conversations for AI struggles vs playbook coverage.

---

### Special Feature #9

Date: 2026-03-06
Time: 09:35 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Request Dedup Hit Counter -- waterfall toolbar badge showing session dedup saves with endpoint breakdown.

---

### Special Feature #10

Date: 2026-03-06
Time: 13:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook Version Timeline -- horizontal lane-chart showing modification events per category as dots.

---

### Special Feature #11

Date: 2026-03-06
Time: 14:05 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dev Mode Auth Gate -- passphrase middleware for /api/dev/*. httpOnly cookie. Prevents filesystem exposure.

---

### Special Feature #12

Date: 2026-03-06
Time: 14:10 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dev Agent Health Dashboard -- compact awareness-level panel (prompt loaded, version, circuit breaker, queue depth).

---

### Special Feature #13

Date: 2026-03-06
Time: 14:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Agent Memory Replay -- timeline scrub through DevAgentLog. Click to open source conversation.

---

### Special Feature #15

Date: 2026-03-06
Time: 15:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook AI Summary Digest -- daily/weekly notification of playbook changes via Claude-read git diffs.

---

### Special Feature #16a

Date: 2026-03-06
Time: 14:50 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Getting Started Breadcrumb Trails -- pulsing arrows for empty state actions. Auto-removes on first item.

---

### Special Feature #16b

Date: 2026-03-06
Time: 22:01 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Calendar Quick-Add NLP Bar -- Claude-parsed natural language event creation with preview card.

---

### Special Feature #18

Date: 2026-03-06
Time: 15:41 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Agent Autonomy Level Selector -- slider (Low/Medium/High/Full) controlling dev agent aggressiveness.

---

### Special Feature #20

Date: 2026-03-06
Time: 16:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Self-Healing Error Loop Detector -- meta-monitor auto-pausing reporting for 60s on 10+ same errors in 30s. *(Partial: useEffect loop detection exists, broader meta-monitor does not.)*

---

### Special Feature #21a

Date: 2026-03-06
Time: 19:31 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Mutation Heatmap Overlay -- DOM region highlighting by mutation frequency. Per-subtree MutationObserver.

---

### Special Feature #21b

Date: 2026-03-06
Time: 22:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Cross-Agent Context Sharing -- pub/sub bus for AI systems via shared context store (Map + MongoDB).

---

### Special Feature #22a

Date: 2026-03-06
Time: 19:32 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Startup Stabilization Window -- configurable warm-up (5-60s) suppressing health alerts during mount.

---

### Special Feature #22b

Date: 2026-03-06
Time: 23:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Calendar Event Inline Preview -- calendar chip on date/time references pulling Google Calendar events on hover.

---

### Special Feature #23

Date: 2026-03-06
Time: 19:34 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Memory Pressure Sparkline -- FlameBar sparkline of 60s JS heap usage. *(Heap monitoring exists, sparkline does not.)*

---

### Special Feature #24

Date: 2026-03-06
Time: 19:36 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Token Budget Alerts -- per-session budget with 80% amber, 95% auto-pause. *(Budget state exists, per-session setting and auto-pause do not.)*

---

### Special Feature #25a

Date: 2026-03-06
Time: 21:54 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: OAuth Scope Diff Detector -- compare scopes on Google reconnect, toast/warning for changes.

---

### Special Feature #25b

Date: 2026-03-06
Time: 23:38 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Conversation Bookmark Pins -- pin/bookmark messages with collapsible strip, click-to-scroll, MongoDB persistence.

---

### Special Feature #26a

Date: 2026-03-06
Time: 21:54 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Smart Compose Context Awareness -- weight ghost-text by active playbook chunks. *(Smart compose exists, not context-aware.)*

---

### Special Feature #26b

Date: 2026-03-06
Time: 19:41 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Flame Bar Render Source Labels -- component names from Profiler on expanded segments.

---

### Special Feature #27

Date: 2026-03-07
Time: 00:12 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Smart Retry Queue -- when AI requests (chat, copilot, background) fail due to timeout or CLI crash, auto-queue for retry with exponential backoff. Show a retry badge in the UI with attempt count and countdown timer. User can cancel or force-retry from the badge.

---

### Special Feature #27

Date: 2026-03-06
Time: 19:45 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Flame Bar Source Filter -- click source label to isolate component renders.

---

### Special Feature #28

Date: 2026-03-06
Time: 20:02 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dev Tools Master Switch -- single toggle to enable/disable all dev tools with count badge.

---

### Special Feature #29

Date: 2026-03-06
Time: 20:05 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dev Tools Presets -- named toggle combinations saved to localStorage.

---

### Special Feature #30

Date: 2026-03-07
Time: 00:18 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Background Conversation Viewer -- "View Thread" link for read-only background conversation history.

---

### Special Feature #32

Date: 2026-03-06
Time: 20:34 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Gmail Escalation Bridge -- "Create Escalation" button auto-populating from QBO-related emails.

---

### Special Feature #33

Date: 2026-03-06
Time: 21:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Gmail Offline Draft Queue -- localStorage draft save when server unreachable, banner on reconnect.

---

### Special Feature #34

Date: 2026-03-06
Time: 21:22 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Context Budget Sankey Diagram -- Sankey flow in Prompt Inspector for token budget allocation.

---

### Special Feature #37

Date: 2026-03-06
Time: 22:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Compile-Error Fix Replay -- `[COMPILE-FIXED]` confirmation with diff on error clear. *(Cascade exists, COMPILE-FIXED does not.)*

---

### Special Feature #38

Date: 2026-03-06
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Stale Data Detector -- "stale?" badge when updatedAt older than cache or identical data 3+ times.

---

### Special Feature #39

Date: 2026-03-07
Time: 00:45 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dead Import Scanner -- Vite module graph scan with one-click "Clean" in Dev Mini Widget.

---

### Special Feature #40

Date: 2026-03-07
Time: 01:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Conversation Fork Tree -- visual tree in Sidebar for fork relationships. *(Fork API exists, no UI.)*

---

### Special Feature #41

Date: 2026-03-06
Time: 22:12 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook Citation Backlinks -- superscript citation links on AI responses linking to playbook categories.

---

### Special Feature #42

Date: 2026-03-06
Time: 22:18 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Thread Viewer Live Tail -- "Live" toggle re-fetching every 5s with slide-in for real-time background agent watching.

---

### Special Feature #43

Date: 2026-03-07
Time: 01:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Calendar Drag-to-Reschedule -- drag events to reschedule with ghost preview, 15-min snap, undo toast, drag-to-resize.

---

### Special Feature #44

Date: 2026-03-07
Time: 01:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Smart HMR Recovery -- serialize full app state to sessionStorage before HMR auto-reload, restore exact context on mount.

---

### Special Feature #45

Date: 2026-03-07
Time: 01:45 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Calendar Smart Conflict Highlighter -- free/busy check on event create/edit, red warning for conflicts, cross-hatch on grid.

---

### Special Feature #46

Date: 2026-03-07
Time: 02:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Activity Log Export -- "Download" button exporting filtered entries as JSON/CSV for debugging or post-incident review.

---

### Special Feature #47

Date: 2026-03-07
Time: 03:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Prompt Inspector Quick-Copy -- "Copy to Clipboard" button in PromptInspector panel copying the full assembled prompt as plain text with clear section headers.

---

### Special Feature #48

Date: 2026-03-06
Time: 22:37 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Inspector Live Diff — when clicking Refresh in the Prompt Inspector, store the previous snapshot and diff against the new one, highlighting additions (green) and removals (red) in each section's preview text. Shows exactly what context shifted between requests — new CLAUDE.md edits, file tree changes, memory entries added/removed — without manually comparing values. A small "N changes" badge on the Refresh button indicates when a diff is available.

---

### Special Feature #49

Date: 2026-03-06
Time: 22:36 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Keyboard Shortcut Heatmap — Track which keyboard shortcuts the user actually presses in the Gmail view and surface a "Shortcut Usage" mini-dashboard in Settings. Shows a visual heatmap grid of all available shortcuts colored by frequency (cold=never used, warm=occasional, hot=daily driver). Shortcuts never pressed after 7 days get a subtle "Try this!" pulse in the ? help overlay. Helps users discover power-user workflows they're missing and lets you deprecate shortcuts nobody uses.

---

### Special Feature #50

Date: 2026-03-06
Time: 22:50 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Workspace Agent Pass-1 Live Stream — Stream the workspace agent's first Claude pass to the client in real-time instead of collecting it silently. Redact ACTION blocks as they appear (replace with a "planning actions..." chip), then show the "executing N actions..." status overlay, then stream the Pass 2 summary. Eliminates the 15-60s dead silence during Pass 1 where the user sees only a typing indicator with no feedback.

---

### Special Feature #51

Date: 2026-03-07
Time: 04:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Header View Switcher Tabs — Compact pill-shaped tab buttons in the header center (between title and icons) for the 3-4 most-used views (Chat, Dashboard, Gmail, Calendar). One-click switching without opening the sidebar. Active tab highlighted. Drag to reorder, persisted to localStorage. Eliminates the most frequent navigation friction — switching core workflow views when the sidebar is collapsed or hidden.

---

### Special Feature #52

Date: 2026-03-07
Time: 04:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Header Breadcrumb Trail — Show the current view name (and conversation title when in Chat) as a subtle breadcrumb in the header between the title and right-side icons. Clicking "QBO Escalations" navigates home to Chat. Gives constant spatial context without checking the sidebar highlight.

---

### Special Feature #53

Date: 2026-03-07
Time: 04:45 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Prompt Regression Alerts — Automatically flag when a new prompt version causes a significant char/token increase (>20% growth) and surface a warning badge on the Versions tab in the Prompt Inspector, so you can catch accidental prompt bloat before it impacts context window usage or costs.

---

### Special Feature #54

Date: 2026-03-07
Time: 05:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Header Active View Indicator — Subtle animated underline or color accent on the header title that morphs based on which view is active (teal for Chat, amber for Dev, blue for Gmail, green for Calendar). Ambient context cue without adding UI elements.

---

### Special Feature #55

Date: 2026-03-07
Time: 06:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Theme Preview Canvas — When hovering a theme in Settings, show a mini mockup card (fake chat bubbles, sidebar slice, status badges) rendered with that theme's actual colors instead of just a color swatch dot. Instantly see how the full UI looks before committing.

---

### Special Feature #56

Date: 2026-03-07
Time: 06:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Prompt Version Pinning — Pin a prompt version in the Versions tab as your baseline. When the current assembled prompt drifts from the pinned version, a visual diff alert badge appears on the Inspector button, so you always know when your prompt has changed unexpectedly without manually checking.

---

### Special Feature #56

Date: 2026-03-07
Time: 06:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Stability Audit Dashboard — A dev-only panel in Settings that statically analyzes all custom hooks at build time (via a Vite plugin), counts the total hooks per component, and flags any component with 50+ hooks or hooks that change count across HMR boundaries. Shows a table: component name, hook count, last HMR result (clean/reset/failed). Catches hook-fragile components before they crash in production.

---

### Special Feature #57

Date: 2026-03-07
Time: 07:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Theme Sound Design — Optional subtle UI sound effects per theme: warm themes get soft clicks, cool themes get crisp taps, vibrant themes get synth blips. "UI Sounds" toggle in Settings with per-theme volume. Tiny procedural audio via Web Audio API oscillators (no files needed), zero latency. Transforms theme switching from visual-only to multi-sensory.

---

### Special Feature #58

Date: 2026-03-07
Time: 05:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Memory Decay Timeline — A visual timeline in DevMode showing agent memory entries with their TTL expiry countdown and pin status. Entries approaching expiration fade in opacity, pinned entries glow with a lock icon. Click to pin/unpin directly. Gives at-a-glance awareness of what knowledge the agent is about to lose vs what's preserved permanently.

---

Date: 2026-03-07
Time: 05:50 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Route-Aware Quick Chat — The dev agent mini widget auto-detects which page/view the user is currently on (Chat, Gmail, Calendar, Dashboard, etc.) and prepends that context to every quick-chat message. The status strip shows a subtle breadcrumb like "on: Gmail" so the agent knows what you're looking at without you having to explain. When switching pages, the context tag updates instantly, letting you fire off messages like "why is this slow" and the agent already knows you mean the Gmail inbox load time, not the chat panel.

Special Feature: Theme Aura Mode — A toggle in Settings that extends theme atmospherics beyond the app window by dynamically setting the `theme-color` meta tag to match the active theme's dominant color. On supported browsers (Chrome, Edge, Safari), the browser tab bar and title bar shift to match — Dracula turns your tab bar purple, Titanium makes it dark with red accents, Apple makes it warm graphite. Creates an immersive full-browser experience where the theme "leaks" into the OS-level window decoration.

Special Feature: HMR Module Staleness Detector — A lightweight Vite plugin that tracks module version hashes on both the server and client side. When the dev agent bridge detects a runtime error referencing a symbol that doesn't exist in the current on-disk source (like `bgTransport is not defined` but the file has zero references), it recognizes this as a stale HMR module and automatically triggers a targeted module invalidation + re-import instead of a full page reload. Shows a toast like "Stale module detected in DevMiniWidget.jsx — hot-patched" so the developer knows it happened. Prevents the class of crashes where Vite serves an intermediate cached version of a file that was edited multiple times rapidly.

Special Feature: Ghost Focus Backdrop — When the quick-chat popover opens, instead of a flat dark overlay, use a radial gradient backdrop that's lighter near the panel and darker toward the opposite corner, creating a natural spotlight effect that draws the eye to the active popover. The radial center anchors to the panel's position (top-right), producing a vignette like `radial-gradient(ellipse at 90% 10%, transparent 20%, rgba(0,0,0,0.3) 100%)`. Combined with the glassmorphism panel, it creates a cinematic depth-of-field feel — the UI behind the popover doesn't just dim, it recedes. Pairs naturally with Theme Aura Mode since the gradient tint can inherit the theme's accent color at very low opacity.

---

### Special Feature #59

Date: 2026-03-07
Time: 08:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Crash Root Cause Classifier — When ErrorBoundary catches, auto-classify the error type (TDZ reference, conditional hook, missing import, stale HMR module, network timeout, etc.) and show a color-coded "likely cause" badge above the stack trace with a one-click suggested fix action. Pattern-matches error messages and stack traces against known crash signatures. Saves the dev agent from re-diagnosing the same crash patterns repeatedly and gives the user instant insight into what went wrong.

---

### Special Feature #60

Date: 2026-03-07
Time: 09:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Module Name Collision Guard — A Vite plugin that scans for local variables whose names exactly match imported module filenames (e.g., `const monitorTransport` in a file that imports from `monitorTransport.js`). During HMR transforms, Vite can confuse module-level bindings with local variables of the same name, causing Temporal Dead Zone errors. The plugin emits a dev-only warning in the console like "Variable 'monitorTransport' shadows module name 'monitorTransport.js' — rename to avoid HMR TDZ risk" and optionally auto-renames the local binding in the transformed output. Prevents an entire class of HMR-only crashes that never reproduce in production builds.

---

### Special Feature #61

Date: 2026-03-07
Time: 02:10 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Circadian Theme Scheduler — An optional "Auto Atmosphere" toggle in Settings that transitions between two user-selected themes based on sunrise/sunset times (via the Geolocation API + a sunset calculation formula). During golden hour, the theme crossfades over 30 minutes using CSS custom property interpolation — e.g., fading from Paper (light, warm) to Apple (warm graphite) as the sun sets. The current transition progress shows as a tiny sun/moon icon in the status bar. Users pick their day theme and night theme from the existing 19 themes, and the system handles the rest. No external API needed — sunrise/sunset math is a pure function of latitude + date.

---

### Special Feature #62

Date: 2026-03-07
Time: 02:25 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Workspace Task Progress Heartbeat — The workspace agent emits periodic heartbeat events (every 10 seconds) while a Claude subprocess is running, reporting metrics like elapsed time, tool calls completed so far, and last activity type. The client displays this as a subtle animated pulse with a hover tooltip ("Working... 2m 34s, 47 tool calls") in the Workspace Agent Panel. More importantly, the remediation hook uses `lastHeartbeatMs` instead of raw `ageMs` to determine staleness — a session that heartbeated 5 seconds ago is clearly alive regardless of total age, eliminating false-positive kills on long-running tasks.

---

### Special Feature #63

Date: 2026-03-07
Time: 10:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Agent Task Resumption — When a workspace agent session is killed mid-task (by auto-remediation, crash, or manual abort), capture the last known task description, files touched, and progress state to MongoDB. Surface a "Resume" button in the Workspace Agent Panel that spawns a new session with that context pre-loaded (task prompt + file list + partial progress summary), picking up where the agent left off instead of starting from scratch. Eliminates lost work from premature session kills and turns session interruptions from catastrophic to recoverable.

---

### Special Feature #64

Date: 2026-03-07
Time: 10:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Atomic Multi-File Edit Coordinator — When the dev agent needs to edit multiple client-side files in one task, it batches all file writes behind a Vite file-watcher pause (using `server.watcher.close()` / re-init or chokidar `unwatch`/`add`). After all files are written, it sends a single custom HMR event that invalidates only the changed modules, producing exactly one coordinated hot update (or one full reload if needed) instead of N cascading reloads per file save. Reduces reload storms during multi-file refactors from a barrage of partial-state reloads to a single clean update.

---

### Special Feature #65

Date: 2026-03-07
Time: 07:26 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Stream Resilience Indicator — A pulsing shield icon in the chat header that appears when a deferred Vite reload is pending, showing queue depth, elapsed deferral time, and a "Force Reload Now" escape hatch. The icon pulses gently using the theme's accent color and shows a tooltip on hover with details like "1 reload queued (12s ago)". Gives the user full visibility into deferred reloads and manual control to force one immediately if needed, complementing the HMR reload guard that auto-defers reloads during active AI streams.

### Special Feature #66

Date: 2026-03-07
Time: 08:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: HMR Hook Isolation Boundaries — A development-mode system that wraps each custom hook used in App.jsx inside a thin boundary component connected via React Context. When Vite HMR invalidates a hook module, only its boundary component remounts instead of crashing the entire App with "Should have a queue" errors. Each boundary tracks its own hook state independently, so a stale module timestamp on one hook (e.g., useRequestWaterfall) can't corrupt the fiber queue of unrelated hooks (e.g., useChat). Eliminates the recurring HMR hook mismatch crashes that currently require full page reloads.

### Special Feature #67

Date: 2026-03-07
Time: 08:45 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Pre-Crash Error Timeline — When the ErrorBoundary catches a fatal error, display a diagnostic timeline on the fallback page showing all errors that occurred in the 30 seconds before the crash (console.error captures, unhandled promise rejections, failed fetch requests, HMR events). Each entry shows timestamp, type, and message. Helps developers trace cascading failures back to the root trigger — e.g., seeing that a failed /api/health check preceded a TDZ error preceded the hook mismatch crash — instead of only seeing the final symptom.

---

### Special Feature #68

Date: 2026-03-07
Time: 07:54 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Gmail Smart Folder Sync — The GmailInbox component auto-detects Gmail labels and renders them as collapsible folder groups in the sidebar. When a new email arrives that matches no label, it suggests a folder based on sender domain patterns learned from existing label-to-sender mappings. One-click "Create filter" opens a pre-filled Gmail filter URL in a new tab. Turns the flat inbox view into an organized folder tree without leaving the app.

---

### Special Feature #69

Date: 2026-03-07
Time: 08:04 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Smart Unsubscribe Detector — Scan inbox message bodies for `List-Unsubscribe` headers and "unsubscribe" anchor text in the HTML body, then surface a batch-unsubscribe panel in the Gmail view. Shows a ranked list of subscription senders by email volume with one-click unsubscribe links. Tracks processed senders in localStorage so they don't reappear. Helps clean up inbox bloat without hunting through individual emails for tiny unsubscribe links.

---

### Special Feature #70

Date: 2026-03-07
Time: 08:16 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Gmail Tracker Pixel Shield — Detect and neutralize tracking pixels in email HTML bodies before rendering. Scan for 1x1 images, known tracking domains (mailchimp, sendgrid, hubspot pixel endpoints), and query-string-heavy image URLs. Strip or proxy them through the server to prevent open-tracking. Show a small shield icon on messages that had trackers removed, with a hover tooltip listing blocked trackers and their domains. Gives the user visibility into which senders are tracking email opens and prevents silent read-receipt leakage.

---

### Special Feature #71

Date: 2026-03-07
Time: 08:25 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Tracker Heatmap Dashboard — Aggregate tracker data across all viewed emails in the session to display a per-sender privacy score, showing which domains embed the most trackers, a breakdown by type (pixel, tracking domain, query beacon), and a running blocked count. Turns the per-email shield into inbox-wide privacy intelligence with a small dashboard accessible from the Gmail view header.

---

### Special Feature #72

Date: 2026-03-07
Time: 08:27 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Persistent Layout Memory — Remember sidebar collapsed state, workspace panel open/closed state, and panel width per view (Gmail, Calendar, Chat) in localStorage. On load, restore the exact layout the user last had instead of hardcoded defaults. Resize handles on the workspace panel save their position too. Eliminates the friction of re-arranging the UI every session.

---

### Special Feature #73

Date: 2026-03-07
Time: 08:35 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Proactive Snooze and Follow-Up Tracker — Track when the user says "remind me later" or "follow up on this" and build a lightweight follow-up queue stored in localStorage. When the workspace panel opens, surface any snoozed items whose reminder time has arrived as a pinned card at the top of the chat. Turns the workspace agent into a persistent memory companion that never lets things slip through the cracks.

---

### Special Feature #74

Date: 2026-03-07
Time: 08:44 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Unified Cross-Account Inbox View — A "Combined Inbox" mode that merges messages from all connected Gmail accounts into a single interleaved timeline, with colored dots indicating which account each message belongs to. When replying from the combined view, the system auto-selects the correct "From" account based on which account owns the thread. Toggle between per-account and combined view with a single click in the account switcher.

---

### Special Feature #75

Date: 2026-03-07
Time: 08:47 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Workspace Agent Briefing Cards — Instead of rendering briefings as a single markdown blob, parse structured agent responses into distinct collapsible card components with icons, color-coded urgency badges (red for urgent, amber for action-needed, green for FYI), countdown timers for upcoming events, and one-click action buttons (e.g., "Check in now" opens URL, "Archive" archives email). The agent outputs a structured JSON block alongside its markdown, and the client renders it as interactive cards instead of plain text.

### Special Feature #76

Date: 2026-03-07
Time: 09:08 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Workspace Alert-to-Action Pipeline — Make workspace alert banners clickable, not just dismissible. Clicking an alert auto-injects a contextual prompt into the workspace agent and sends it immediately. A "Schedule conflict" alert click sends a conflict resolution request; a "3 unread emails older than 3 days" alert click sends a triage command; a "Flight in 3 hours" alert click triggers a full travel dossier with timeline, confirmation numbers, and logistics. Turns passive notifications into one-click intelligent actions.

---

### Special Feature #77

Date: 2026-03-08
Time: 14:45 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Ambient Sound Landscapes — Extend Theme Sound Design with optional looping ambient backgrounds per theme category: warm themes play a soft crackling fireplace, cool themes play distant wind, vibrant themes play a low synth drone. Uses Web Audio API noise generators + biquad filters (still zero audio files). A second volume slider in Settings controls ambient vs UI sound balance. Creates an immersive "workspace atmosphere" that makes long escalation sessions feel less sterile.

---

### Special Feature #78

Date: 2026-03-08
Time: 14:55 AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Memory Triage Mode — Press `T` in the Memory Decay Timeline to enter a full-screen card-by-card review mode with keyboard shortcuts (`P` pin, `D` dismiss/expire, `E` extend +7d, arrow keys to navigate) and a progress bar. Turns passive viewing into an active curation workflow like email triage or flashcard review, letting users quickly decide what knowledge to preserve vs let expire.

### Special Feature #79

Date: 2026-03-08
Time: 14:47 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Categorization Learning Loop — When the workspace agent categorizes an email by user direction (e.g., user says "put that in Jobs"), persist the sender domain-to-label mapping to MongoDB so the domain map grows over time. New categorizations appear as "learned" entries distinct from the built-in defaults, with an option to promote them to permanent rules or let them decay after 90 days of inactivity. The agent progressively needs less guidance as it learns the user's organizational preferences.

---

### Special Feature #80

Date: 2026-03-08
Time: 15:20 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Smart Trip Dossier — When the entity linker detects a trip cluster (flights + hotels + car rentals grouped together), the workspace agent auto-generates a single-page travel dossier with a chronological timeline, all confirmation codes in a copy-friendly format, check-in/checkout times, terminal info, and a pre-departure checklist (passport, check-in status, parking). Triggered automatically 24 hours before the first event in the trip entity, or on-demand via "prepare my trip briefing." Turns scattered booking emails into one actionable travel document.

---

### Special Feature #81

Date: 2026-03-08
Time: 15:45 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: high
Special Feature: Proactive Morning Briefing Push — A lightweight server-side scheduler that fires at a configurable time each morning (default 8 AM user timezone), auto-generates a daily briefing using the workspace agent's full context pipeline (calendar, inbox, alerts, entities, memory), and pushes it to the client via WebSocket/SSE as a pre-rendered card waiting when the user opens the app. No user prompt needed — the EA starts the day before you do.

---

### Special Feature #82

Date: 2026-03-08
Time: 16:15 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Workspace Agent Confidence Score — After each response, the agent self-rates its confidence (high/medium/low) based on how much source data it verified vs assumed. Displayed as a subtle badge on the message. Low-confidence responses auto-trigger a follow-up search in the multi-turn loop to gather more evidence before finalizing. Over time, tracks confidence trends in the feedback model so you can see if the agent is getting more or less reliable.

---

### Special Feature #83

Date: 2026-03-08
Time: 16:45 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Split-View Dev Sessions — Double-click the "New" button in Dev Mode to open a second chat pane side-by-side within the same dev container. Each pane has its own conversation, model selector, and streaming state, but shares the same session history sidebar. Drag the divider to resize. One pane can run a build task while the other explores code — parallel agent conversations without tab-switching. Collapse back to single pane by clicking the pane's close button.

---

### Special Feature #83

Date: 2026-03-08
Time: 17:30 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Workspace Agent Response Dedup Guard — Before rendering a streamed response, the client hashes each incoming chunk against the already-displayed content buffer and silently drops exact duplicates, preventing the same briefing (or any agent response) from ever appearing twice in the chat regardless of server-side streaming bugs. Acts as a client-side safety net so duplicate chunk events never reach the UI.

---

### Special Feature #84

Date: 2026-03-08
Time: 18:19 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Smart Post-Trip Cleanup — When the workspace entity linker detects a trip entity whose return flight has landed (comparing flight date/time against current time), automatically surface a one-click "Trip Complete" action that batch-archives all related travel emails (boarding passes, receipts, feedback requests, confirmation emails), labels them under Travel, consolidates trip expenses into a summary memory note with total spend, and expires trip-specific workspace memories. Turns post-trip inbox clutter into a clean archive with zero manual sorting.

---

### Special Feature #85

Date: 2026-03-08
Time: 18:45 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Smart Tab Memory — When switching between surface tabs (chat, agents, copilot), persist each tab's scroll position and draft input state in a per-tab ref map. Restoring a tab instantly snaps back to the exact scroll offset and any unsent draft text, so users never lose their place when toggling between views mid-workflow.

---

### Special Feature #86

Date: 2026-03-08
Time: 19:15 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Proactive Intelligence Dashboard — A collapsible stats panel in the workspace sidebar showing real-time metrics for the 4-phase proactive EA system: number of emails auto-labeled this session, entity facts auto-saved, proactive AI advisories sent (with rate limit remaining), patterns detected vs proposed vs accepted, and monitor uptime/last-tick timestamp. Gives the user visibility into what the agent is doing autonomously so they can trust and tune the system.

---

### Special Feature #87

Date: 2026-03-08
Time: 19:30 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: EA Work Receipt Log — Every time the background monitor completes a tick, append a one-line timestamped summary to a persistent in-app activity feed (e.g., "22:15 — labeled 3 emails, archived 1 promo, saved trip entity"). Displayed as a collapsible footer strip in the workspace panel so the user can see proof the EA is working without opening dev tools or the chat.

---

### Special Feature #88

Date: 2026-03-08
Time: 19:36 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Adaptive Category Tab Counts — Show unread message counts as small badges on each Gmail category tab (Primary, Social, Promotions, Updates) so the user can see at a glance which categories have activity without clicking into each one. Counts update in real-time via the monitor SSE connection when the EA auto-labels or the user manually moves emails.

---

### Special Feature #89

Date: 2026-03-08
Time: 19:45 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Resizable Agent Panel Divider — A draggable handle on the left edge of the agent dock that lets users resize the panel between 280-500px width, with the preferred width persisted to localStorage. Similar to VS Code's sidebar resizer — smooth drag with a visible grip indicator on hover.

---

### Special Feature #90

Date: 2026-03-08
Time: 19:48 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Keyboard-Accessible Panel Resize — Make the agent dock resize handle focusable via Tab and support Shift+Arrow Left/Right for 20px increments, matching VS Code's keyboard resize behavior. Includes visible focus ring and aria-label for screen reader accessibility.

---

### Special Feature #91

Date: 2026-03-08
Time: 21:02 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Travel Expense Auto-Grouper — When workspace memory detects an active trip route, automatically group all receipts and transaction alerts received during that trip window into a collapsible "Trip Expenses" card in the workspace panel. Shows vendor, amount, and date for each line item (e.g., Budget rental, Tim Hortons $4.38, Capital One alerts). Includes one-click CSV export for expense reporting.

---

### Special Feature #92

Date: 2026-03-09
Time: 19:38 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: AI Vision Narration Mode — A "Live Describe" toggle in the webcam modal that periodically captures frames (every 5s) and sends them to Claude for real-time scene narration. Shows a rolling transcript of what the AI observes alongside the live video feed, useful for describing physical documents, hardware setups, or workspace layouts to the AI without manually capturing each shot.

---

### Special Feature #93

Date: 2026-03-09
Time: 19:41 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Capture Markup Layer — After capturing a webcam photo (or any attached image), show an inline annotation toolbar that lets the user draw arrows, circles, rectangles, and freehand highlights directly on the image before sending it to chat. Uses an HTML5 canvas overlay with undo/redo stack, color picker (red/yellow/white), and two stroke widths. The annotated image replaces the original in the images array as a flattened PNG. This is valuable for escalation specialists who photograph physical documents or screen issues on a second monitor — they can circle the problem area, draw an arrow to the error code, or highlight a specific line item, giving the AI agent precise spatial context about what to focus on without needing to describe it in text.

---

### Special Feature #94

Date: 2026-03-09
Time: 19:43 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Console Noise Control — A server-side log verbosity setting (quiet/normal/verbose) that controls how much background service output gets printed to the console. In "quiet" mode, only errors and warnings show. In "normal" mode, summaries like "auto-labeled 20 emails" appear but not the full JSON payload. In "verbose" mode, everything dumps (current behavior). Configurable via Settings UI or LOG_VERBOSITY env var.

---

### Special Feature #95

Date: 2026-03-09
Time: 20:18 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Welcome Back Digest Toast — When the app detects the user has been away for 1+ hours (comparing last activity timestamp in localStorage vs current time), show a toast notification summarizing EA work from the WorkspaceActivity log: "While you were away: moved 12 emails to folders, archived 4 old promos, saved 2 trip facts." One-click expands to the full activity feed in the workspace panel. Fires once per session on first load, not on every page navigation. Turns invisible background work into a visible "your EA was busy" moment.

---

Date: 2026-03-09
Time: 21:03 ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Return-to-Work Queue Prioritizer — When the workspace agent detects the user was traveling (active trip route in memory) and it's their first workday back, automatically scan the QBO escalation queue and surface a prioritized "Start Here" list sorted by SLA urgency, customer tier, and wait time. Shows a compact card in the workspace panel with the top 5 most urgent cases, time-in-queue for each, and a one-line context snippet. Eliminates the 15-minute manual triage ritual on Monday mornings or after any trip absence.

---

### Feature #96 — Briefing Quick Actions
**Date:** 2026-03-09 9:19 PM ADT
**Status:** 💡 Suggested

Inline action buttons at the end of each briefing section (e.g. "Archive this", "Add to calendar", "Reply") so you can act on briefing items without typing a message to the workspace agent.

---

### Feature #97 — Briefing Diff View
**Date:** 2026-03-09 9:22 PM ADT
**Status:** 💡 Suggested

When the briefing regenerates (e.g. after clearing a corrupted one), show a subtle "Updated since you last read" indicator with a diff highlight of what changed — so the user doesn't have to re-read the whole thing to spot new info.

---

### Special Feature #98

Date: 2026-03-09
Time: 9:20 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Gmail Sidebar Label Color Dots — Show a small colored circle next to each user label in the sidebar, derived from the label's Gmail API color (color.backgroundColor). When no color exists, auto-assign one from a deterministic hash of the label name (consistent across sessions). The same dot colors appear inline on message row label chips. Makes the 11+ label list scannable at a glance — you spot "Finance" by its green dot and "Shopping" by its purple dot without reading text. Turns the monochrome tag-icon list into a color-coded filing system.

---

### Special Feature #99

Date: 2026-03-09
Time: 9:32 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Keyboard-Navigable Gmail Sidebar — Arrow keys to move between labels, Enter to select, / to focus the search bar from anywhere in the sidebar. Active item gets a visible focus ring. Tab cycles between system labels and user labels sections. Escape returns focus to the message list. Makes the sidebar fully usable without a mouse — especially useful for power users processing high email volume.

---

### Special Feature #100

Date: 2026-03-09
Time: 9:35 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Briefing Content Guardrails — Configurable blocklist of content types the briefing LLM should never include (e.g., feature suggestions, code snippets, dev tool output). Managed in Settings with toggle chips. Injected into the briefing system prompt at generation time. Prevents the EA from leaking internal tooling context into the user-facing daily briefing.

---
Date: 2026-03-09
Time: 9:37 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Draft Decay Alerts — Drafts older than 7 days are surfaced with contextual nudges ("This draft to Tanya is 123 days old — send, update, or discard?"). Age thresholds are configurable in Settings. At 180 days (default), a final warning is shown before auto-discarding. Integrates with the EA briefing system to include stale draft summaries in daily briefings, preventing the drafts folder from becoming a graveyard of forgotten replies.

---

### Special Feature #101

Date: 2026-03-09
Time: 9:54 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Workspace Agent Personality Presets — Choose between EA personality styles in Settings: "Efficient" (terse, action-first, no filler — default), "Friendly" (warm tone, brief explanations), "Detailed" (tables, breakdowns, full context). Stored in localStorage, sent with each request, injected into the workspace system prompt. Lets the user tune how the agent communicates without editing code.

### Special Feature #100

Date: 2026-03-09
Time: 9:38 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Smart Label Grouping — Auto-group Gmail sidebar labels by frequency of use. Labels clicked most often float to the top of the labels section, with a faint separator between "frequent" and "other" groups. Frequency tracked in localStorage with a 30-day rolling window. Resets if user manually drags a label to reorder. Saves scrolling past 10+ labels to find the 2-3 used daily.

### Special Feature #102

Date: 2026-03-09
Time: 9:59 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Scroll-Reactive Depth Layers — As the user scrolls the Gmail message list or workspace chat, the header/toolbar gains a progressively stronger drop shadow (3 tiers: none at top, light at 20px scroll, deep at 100px+), giving a real "card sliding under a shelf" feel. The shadow transitions smoothly using CSS transitions triggered by a tiny scroll listener that toggles data attributes (data-scroll="top", "mid", "deep"). Applies to the Gmail header/search and the workspace agent header. Zero layout shift, pure visual depth cue that makes scroll position intuitively visible without a scrollbar.

---

### Special Feature #103

Date: 2026-03-09
Time: 10:03 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Shift Handoff Snapshot — A one-click "Hand Off" button in the workspace panel that captures a structured session snapshot: open escalations with current status, unfinished email drafts, pending calendar items, workspace agent memory highlights, and any active trip/entity context. Generates a shareable markdown card (copy or email) that a colleague or your future self can consume in 30 seconds to pick up exactly where you left off. For QBO escalation specialists who work shifts, this eliminates the "what was I working on?" cold-start problem and prevents dropped cases between shifts.

---

### Special Feature #104

Date: 2026-03-09
Time: 10:14 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Alert Reaction Heatmap — Track which alert types get clicked vs dismissed over time and render a small heatmap strip at the top of the workspace alerts section. Each cell represents an alert interaction (green = acted on, red = dismissed, gray = expired). Hovering a cell shows the alert title and timestamp. After 30+ interactions, the system auto-adjusts alert thresholds — types that are always dismissed get downgraded to lower severity, while types always acted on get promoted. Turns user behavior into a feedback loop that makes the alert system smarter without explicit configuration.

---

### Special Feature #105

Date: 2026-03-09
Time: 10:18 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Auto-Error Report Dedup & Cooldown — The auto-error reporter hashes each error by message + source file to create a signature. After firing the first [AUTO-ERROR] for a given signature, it enters a 60-second cooldown window where identical errors are silently counted but not re-reported. When the cooldown expires, if additional occurrences were suppressed, a single summary message is sent: "[AUTO-ERROR] 5 more occurrences of <signature> in the last 60s — still active." Prevents the dev agent from receiving duplicate flood reports for the same crash (e.g., the 6+ identical monitorTransport TDZ errors that filled the agent memory).

---

### Special Feature #106

Date: 2026-03-09
Time: 10:26 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Alert Reaction Pattern Export — Add a "Download Insights" button to the alert heatmap section that exports accumulated alertReactions data as a JSON file with computed severity adjustments. Review which alert types you habitually dismiss (candidates for downgrade) vs. always click on (candidates for auto-escalation), creating a portable feedback artifact between your behavior and the workspace agent's alert priority tuning.

---

### Special Feature #107

Date: 2026-03-09
Time: 10:26 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Dependency Topological Sorter — A dev-mode lint pass that statically analyzes React component files for useMemo/useCallback/useState declarations and their dependency arrays, building a dependency graph. If any hook references a variable declared later in the component (potential TDZ), it flags the line with a warning in the console: "[HOOK-ORDER] visibleAlerts (L581) references alertSeverityAdjustments (L607) — move declaration up". Catches hook ordering TDZ bugs at dev time before they crash the app.

### Special Feature #107

Date: 2026-03-09
Time: 10:26 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Ordering Lint Guard — Add a lightweight Vite plugin that statically scans React component files during HMR for const declarations used before their definition within the same function scope (TDZ violations). When detected, emit a console warning like "[TDZ-GUARD] alertSeverityAdjustments used at line 591 but defined at line 607 in WorkspaceAgentPanel.jsx" and optionally block the HMR update to prevent the ErrorBoundary from firing. This catches the exact class of bug that has crashed the monitor pipeline 3+ times — before it reaches the browser.

---

### Special Feature #108

Date: 2026-03-09
Time: 10:26 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Action Dry-Run Preview — Before the EA executes destructive actions (archive, trash, send email, delete event), show a preview card with the exact action + target in the workspace chat, requiring a single-click "Confirm" or "Skip" before execution. Non-destructive actions (search, read, star) proceed automatically. Adds a safety net for high-stakes operations without slowing down routine tasks. Toggle in Settings to auto-confirm everything for power users.

---

### Special Feature #109

Date: 2026-03-09
Time: 10:28 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Alert Priority Queue — When multiple alerts are active simultaneously, stack them in a single collapsible "priority queue" card instead of showing N separate banners. The card shows the highest-severity alert expanded with its action button, and the rest collapsed as one-line summaries below it with severity dots. Clicking a collapsed alert expands it and collapses the previous one (accordion style). A small "3 alerts" badge on the workspace panel tab glows when alerts are queued. Prevents alert fatigue from banner overload during busy periods while keeping every alert one click away.

---

### Special Feature #110

Date: 2026-03-09
Time: 10:33 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Email Navigation Arrows — Add small up/down arrow buttons to the MessageReader toolbar that let you jump to the previous/next email in the inbox list without going back first. Shows a "3 of 47" position indicator between the arrows. Keyboard shortcuts J/K already move the focused index in the list view, but there's no way to navigate between messages while inside the reader. Saves a round-trip click for users triaging emails sequentially.

---

### Special Feature #111

Date: 2026-03-09
Time: 10:51 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Scroll Position Memory — When navigating from the email list into the message reader and back, restore the exact scroll position in the inbox list so the user doesn't lose their place. Store the scroll offset per label/category tab so switching between Inbox, Starred, Sent, etc. each remembers where you left off. Reset on manual refresh.

### Special Feature #112

Date: 2026-03-09
Time: 11:13 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Declaration Linter — Add a lightweight ESM lint pass (as a Vite plugin or pre-build script) that statically detects React hooks referencing variables declared later in the same function scope. It would parse each component/hook file's AST, find all useEffect/useMemo/useCallback dependency arrays, and flag any identifier that's defined below the hook call via const/let (TDZ-prone). This catches the exact class of bug we just fixed before it hits the browser — zero runtime cost, instant feedback in the dev console.

---

### Special Feature #113

Date: 2026-03-09
Time: 11:17 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Mongoose Schema Drift Detector — On server startup (dev only), compare every Mongoose model's schema fields against the actual MongoDB collection's existing documents by sampling 10 docs. Flag any fields that exist in the DB but aren't in the schema (orphaned from migrations), or schema fields with required:true that have null/missing values in existing docs. Log warnings like "[schema-drift] WorkspaceMemory: field 'oldCategory' exists in 4/10 docs but not in schema". Catches silent data model mismatches before they become runtime errors.

### Special Feature #112

Date: 2026-03-09
Time: 11:13 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: HMR Context Staleness Detector — During Vite HMR, detect when a context provider module has been hot-replaced but consumers still hold a reference to the old context object (causing useContext to return null even though the provider is in the tree). Show a dev-mode toast: "DevAgentContext stale — full reload recommended" with a one-click reload button. Uses a monotonic version counter exported from each context module; consumers compare their captured version against the current export on each render. Prevents silent degradation where hooks return fallback values and the app appears to work but features are quietly disabled.

---

### Special Feature #113

Date: 2026-03-09
Time: 11:13 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: HMR Version Lockstep Indicator — A persistent version hash badge in the Dev Mini Widget that tracks every hot-reloaded file's disk version vs the browser's loaded module version. When they diverge (stale HMR), the badge turns amber showing "N modules stale" with a "Sync" button that triggers targeted module re-imports (or full reload as fallback). Unlike reactive approaches that detect staleness only after a crash, this proactively shows version drift in real-time so developers can see and fix stale modules before they cause TDZ errors or other ghost bugs — like the exact crash pattern where code is correct on disk but the browser is still running a previous module version.

---

### Special Feature #114

Date: 2026-03-09
Time: 11:13 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Monitor Recovery Heartbeat — After the DevAgent monitors crash and the ErrorBoundary catches, automatically retry mounting the monitor tree on a 10-second interval (max 3 attempts) instead of staying down until a manual page reload. Each retry attempt logs to the agent activity feed with a "[MONITOR-RECOVERY] Attempt N/3" entry. If all 3 attempts fail, show a persistent toast with a manual reload button. This ensures transient TDZ/HMR errors self-heal without user intervention, keeping the error pipeline online.

---

### Special Feature #115

Date: 2026-03-12
Time: 8:25 PM ADT
Model: Claude Opus 4.6
Is duplicate?: Yes (replaced — core app feature already exists)
Complexity: medium
Special Feature: Escalation Surge Radar — Track escalation volume by category in rolling 24h windows and surface an alert when any category spikes 2x+ above its 7-day average. Shows a "Payroll issues surging — 3x normal" banner with a one-click view of the recent cases, so you can spot QBO outages or product changes causing agent pain before your queue buries you.

---

### Special Feature #115

Date: 2026-03-09
Time: 11:17 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Tax Code Mis-Classification Detector — When Claude parses an escalation mentioning "Out of Scope" alongside "exempt," "exemption," or "understated" line items, automatically inject a warning banner into the triage response: "⚠ Possible Out-of-Scope vs. Exempt mix-up — these have different tax return effects." Include a collapsible tooltip explaining the difference (Out of Scope = invisible to the return, Exempt = visible as non-taxable). This catches one of the most common sales tax filing errors at triage time before the agent goes down the wrong troubleshooting path.

---

Date: 2026-03-09 11:36 PM
Source: Auto-error fix session (WebcamCapture.jsx visible state crash)
Is duplicate?: No
Complexity: medium
Special Feature: Webcam Snapshot Gallery — When users capture images via the webcam for escalation attachments, auto-save a thumbnail history strip below the viewfinder so they can quickly review, compare, or re-attach previous captures from the same session without re-taking photos. Thumbnails persist until the modal closes and include a one-click "attach this one" action.

---

## Feature #NEW — Sales Tax Filing Rollback Advisor
**Date:** 2026-03-09 11:37 PM
**Source:** Escalation triage — agent changed tax codes before undoing filing, causing double-correction
Is duplicate?: No
Complexity: medium
Special Feature: Sales Tax Filing Rollback Advisor — When an escalation involves undoing or re-filing sales tax returns, the system automatically warns about the correct sequence of operations (undo filing first, then change tax codes) and flags potential double-correction risks before the agent proceeds. Surfaces a checklist of pre-undo and post-undo steps to prevent timing pitfalls like overstated-to-understated flips.

---

### Special Feature #116

Date: 2026-03-09
Time: 11:40 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Subprocess Context Isolation Dashboard — A panel in Settings (or the Prompt Inspector) that shows exactly what each `claude -p` subprocess receives: a live diff of "intended system prompt" vs "actual loaded context" (including any auto-injected CLAUDE.md, MEMORY.md, hooks, MCP tools). When CLAUDE_CODE_SIMPLE is active, the badge shows "Isolated" in green; when full project config leaks through, it shows "Leaking N extra context sources" in amber with a one-click toggle to enable isolation. Makes invisible prompt bloat visible — catches context leaks like the 270-line CLAUDE.md+MEMORY.md leak into the workspace EA that went undetected until manual investigation.

---

### Special Feature #117

Date: 2026-03-09
Time: 11:55 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: JSX Tag Balance Pre-Check — A lightweight Vite plugin that runs a fast open/close tag balance scan on .jsx files before Babel compilation. When it detects a mismatch, it reports the exact mismatched tag with line numbers and visual nesting context, instead of the cryptic "Unterminated JSX contents" error that points to the wrong location. Saves developer time by pinpointing the actual mismatch instead of the downstream parse failure.

---

### [2026-03-09 11:58 PM]
Is duplicate?: No
Complexity: low
Special Feature: Briefing Timezone Indicator — Display the local timezone label on workspace briefing cards (e.g. "Generated at 8:00 AM AST") so the user can visually confirm the scheduler is generating briefings in the correct local timezone, preventing confusion from UTC/local mismatches.

---

### Special Feature #118

Date: 2026-03-09
Time: 11:59 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Declaration Order Linter — A dev-mode Vite plugin that statically analyzes React component files for TDZ violations in useCallback/useMemo dependency chains. It builds a dependency graph of all hook declarations and flags any useCallback that references another useCallback or useMemo defined later in the file. This catches the exact class of recurring TDZ crash (5+ incidents) before it reaches the browser, turning a runtime crash into a compile-time warning with the exact fix location.

---

### Special Feature #119

Date: 2026-03-09
Time: 11:59 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Compile Error Auto-Heal Gate — Before dispatching a compile error to the dev agent pipeline, the Vite bridge plugin re-reads the offending file from disk and re-parses it with a fast syntax check. If the file is now valid (e.g., a concurrent agent already fixed it), the error is suppressed and a "[HEALED]" info event is logged instead. This prevents agents from investigating already-resolved errors, saving tokens and avoiding stale-fix conflicts when multiple agents work concurrently.

---

### Special Feature #119

Date: 2026-03-10
Time: 12:00 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Slash Command Autocomplete Preview — When typing /attach, /effort, /tab, or any other slash command in the chat composer, show a live inline preview of what the command will do (e.g., for /effort high show "Reasoning: medium → high", for /attach show a thumbnail count of currently attached images). This turns slash commands from blind actions into visual confirmations, reducing user uncertainty and accidental invocations.

---

### Special Feature #120

Date: 2026-03-10
Time: 12:00 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: TDZ Static Order Analyzer — A Vite plugin that runs on each file save, parsing React component files to build a declaration-order graph of all const/let identifiers. If any identifier is referenced in a useCallback body, useMemo dependency, event handler, or JSX expression before the line where it's declared, the plugin emits a browser overlay warning with the exact variable name and line numbers (declared at L400, used at L350). Catches the recurring TDZ bug class (monitorTransport, alertSeverityAdjustments, scheduleRetry, handleAttachClick — 5+ crashes in 3 days) at edit time before they reach the browser and crash the app.

---

### Special Feature #112

Date: 2026-03-10
Time: 12:01 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Dependency Graph Visualizer — A dev-mode panel that renders an interactive DAG (directed acyclic graph) of all useCallback/useMemo/useEffect hooks in the currently-focused component. Each node shows the hook name, line number, and dependencies. Edges connect hooks to their deps. Nodes turn red when an out-of-order declaration is detected (used before defined), and cycles are highlighted with a pulsing animation. Clicking a node scrolls the editor to that line. Particularly useful for complex components like Chat.jsx with 30+ hooks where textual lint warnings aren't enough to reason about the dependency chain.

---

### Special Feature #121

Date: 2026-03-10
Time: 12:02 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Crash Recovery Auto-Resume — When the ErrorBoundary catches a crash, automatically snapshot the current route, unsent draft text, attached images, and scroll position to sessionStorage. On next mount after recovery, detect the snapshot and offer a one-click "Resume where you left off" toast that restores the exact pre-crash state — draft, images, scroll position, and all. Turns a hard crash from a "lose everything" moment into a seamless 2-second recovery.

---

### Special Feature #130

Date: 2026-03-10
Time: 12:03 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Hook Initialization Sentinel — A lightweight runtime guard that wraps every useCallback/useMemo in dev mode with a Proxy that throws a descriptive error ("Hook X used before initialization — defined at L390, accessed from useEffect at L352") instead of the cryptic TDZ "Cannot access before initialization" message. Unlike the Vite static analyzer (#120), this catches dynamic TDZ violations (e.g., from conditional imports, HMR reloads, or code-split boundaries) that only manifest at runtime. Integrates with the existing monitor crash escalation pipeline to auto-report the exact dependency chain that failed.

---

### Special Feature #131

Date: 2026-03-10
Time: 12:20 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Event Sovereignty Zones — Components can declare an "event sovereignty zone" via a `<EventZone keys={['ArrowUp','ArrowDown','Enter','Escape']}>` wrapper that captures specified keyboard events in the capture phase before any parent or global listener can intercept them. When a zone is active (e.g., a slash command popup is open), it owns those keys exclusively. When inactive, events pass through normally. Prevents the exact class of bug where a parent component's global keyboard listener steals events from a child's popup — like GmailInbox's arrow key handler intercepting the workspace command menu. Each zone registers/unregisters automatically on mount/unmount.

---

### Special Feature #132

Date: 2026-03-10
Time: 12:31 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Streaming Dedup Sentinel — A lightweight middleware in the Claude streaming pipeline that fingerprints each text chunk as it arrives and detects when a final `result`/`assistant` summary message duplicates already-streamed content. Instead of blindly concatenating, it compares the incoming block against the accumulated buffer and silently discards exact or near-exact duplicates, preventing the "double response" bug class entirely at the transport layer. Works as a guard in `extractText()` — if the incoming text is a prefix/suffix match of >90% of the existing `fullResponse`, it's flagged as a duplicate summary and dropped.

---

### Special Feature #133

Date: 2026-03-10
Time: 12:41 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Adaptive Tab Preload Hints — When the user hovers over a Chat/Workspace/Dev Agent/Co-pilot tab for 200ms, prefetch that tab's latest data (conversation history, workspace alerts, copilot session state) so switching tabs feels instant. Similar to Chrome's speculative link preloading — the tab content is warm in a React cache by the time the user clicks. Could reduce perceived tab-switch latency to near-zero for data-dependent views like Workspace briefings and Dev Agent session history. Implemented as a lightweight `onMouseEnter` handler on each tab button that calls the relevant API endpoint with `priority: 'low'` fetch hints.

---

### Special Feature #134

Date: 2026-03-10
Time: 12:48 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Idempotent Effect Registry — A tiny dev-mode utility that wraps side-effectful `useEffect` calls (API requests, auto-sends, timers) with an idempotency key. Before firing, the effect checks a WeakMap keyed by component instance + effect identity. If the same effect already fired for this mount cycle, it's silently skipped. Catches the entire class of "StrictMode double-fire" bugs at the pattern level instead of sprinkling ref guards into every individual effect. Could be exposed as `useIdempotentEffect(key, fn, deps)` — drop-in replacement for `useEffect` where exactly-once semantics matter.

---

### Special Feature #135

Date: 2026-03-10
Time: 1:14 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Ambient Reading Progress Bar — A thin (2px) accent-colored progress bar at the very top of the chat message area that fills left-to-right as the user scrolls through a long conversation. Inspired by longform article reading indicators (Medium, Substack). Gives instant spatial awareness of where you are in a conversation without checking scrollbar position. Uses `IntersectionObserver` on the messages container — zero scroll-event listeners, no jank. Fades out after 2 seconds of inactivity and reappears on scroll. Especially useful for long escalation conversations where you need to find a specific earlier response.

---

Special Feature: Workspace Conversation Auto-Titles — When the workspace agent finishes its first response in a new conversation, the server auto-generates a short descriptive title (e.g., "Morning briefing", "Calendar color coding", "Draft cleanup") from the first user message + assistant response using a lightweight Claude call. Stored in a title field on the WorkspaceConversation model. The history drawer shows these titles instead of raw message previews, making it much easier to identify past conversations at a glance. (2026-03-10 01:24 AM)

Special Feature: Session Reconnection with Progress Indicator — When a user closes and reopens the workspace panel while a request is in-flight, show a "Reconnecting to active session..." banner that automatically reattaches to the running agent session stream, with a subtle progress pulse so the user knows the agent is still working instead of seeing a blank panel. (2026-03-10 01:38 AM)

Special Feature: Provider Quick-Switch Keyboard Shortcut — Pressing Ctrl+Shift+M while the workspace panel is focused cycles through available providers with a brief toast notification, so power users can switch models without opening the popover menu. (2026-03-10 01:45 AM)

Special Feature: Calendar Color Legend — Auto-populated color key in the calendar sidebar that maps each visible event color swatch to its Google Calendar name (Peacock, Sage, Grape, etc.), so you can understand the color coding at a glance without opening individual events. (2026-03-10 01:47 AM)

Special Feature: Memory Confidence Scoring — Auto-extracted memories get confidence 0.7, LLM-initiated memory.save gets 1.0. When both sources confirm the same fact in one conversation, boost to 1.0 double-confirmed. Context building prioritizes high-confidence memories and deprioritizes potential regex false positives. (2026-03-10 01:51 AM)

---

### Special Feature #136

Date: 2026-03-10
Time: 1:54 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Smart Tab Overflow Collapse — When a tab bar has too many items to fit (e.g., if Gmail categories grow with custom labels), automatically collapse the overflow items into a "More..." dropdown menu instead of showing a scrollbar. Uses ResizeObserver on the tab container and an IntersectionObserver on the last visible tab to detect when items spill out, then renders a compact popover with the hidden tabs. Keeps the UI clean regardless of how many tabs exist.

---

Special Feature: Conversation Density Toggle — A toolbar button that cycles between comfortable, compact, and dense spacing modes for the workspace chat, persisted in localStorage so the preference survives sessions. (2026-03-10 01:59 AM)

---

Special Feature: Calendar Heat Density Overlay — A sidebar toggle that renders a color-coded busyness heatmap (green/amber/red) across week and month views based on cumulative event hours per day, letting users visually spot scheduling bottlenecks at a glance without reading individual events. Days with 0-2 hours show green, 2-5 hours amber, 5+ hours red, with gradient intensity scaling. (2026-03-10 01:53 AM)

---

### Special Feature #137

Date: 2026-03-10
Time: 2:05 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Alert Dedup & Dismissal Memory — When the user dismisses a workspace alert (clicks X or says "ignore this"), store the alert's sourceId in a dismissed set on the WorkspaceConversation. On subsequent briefings, skip alerts whose sourceId has been dismissed. Prevents the same known alerts from resurfacing every time the panel opens. Dismissed alerts auto-expire after 48 hours so genuinely new conflicts on the same events still surface.

---

### Special Feature #138

Date: 2026-03-10
Time: 2:07 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Agent Action Replay Log — Every action the workspace agent takes (create event, send email, delete draft, etc.) gets logged to a lightweight in-memory ring buffer with timestamp, action type, and params. A /history slash command in the workspace panel shows the last 50 agent actions in a compact timeline, so you can see exactly what the agent did, when, and catch unintended duplicates or mistakes before they compound.

---

Special Feature: Animated Message Entrance Stagger — Apply incremental animation-delay to each workspace message using CSS nth-child selectors when conversation history loads, creating a cascading card-reveal effect that makes restored conversations feel dynamic instead of static. (2026-03-10 02:06 AM)

Special Feature: Calendar Event Z-Index Priority — Allow users to click and drag overlapping calendar events to reorder their visual stacking, with the most recently interacted event always appearing on top. Stacking order persists in localStorage per-day. (2026-03-10 02:12 AM)

---

### Special Feature #139

Date: 2026-03-10
Time: 2:12 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Action Replay Anomaly Highlighter — When /history is viewed, automatically scan the action log for suspicious patterns (duplicate actions within 60s with identical params, more than 3 of the same action type in 5 minutes) and highlight them with a warning icon. Turns the passive replay log into an active anomaly detector, catching duplicate-event and alert-spam scenarios proactively.

---

Special Feature: Calendar Conflict Auto-Resolver — When the workspace agent detects overlapping events, offer a one-click "Auto-resolve" button that uses Claude to propose the optimal reschedule (based on event priority, duration, and free slots), previews the change in a diff-style before/after card, and applies it with a single confirmation tap. (2026-03-10 02:17 AM)

---

Special Feature: Event Quick-Peek Tooltip — Hovering over a calendar event block for 500ms shows a lightweight tooltip with title, time, and attendee count without opening the full popover, letting users scan event details at a glance without clicking. (2026-03-10 02:20 AM)

---

Special Feature: Cross-Day Calendar Drag-and-Drop — Extend the existing drag-to-reschedule system to detect when the cursor crosses day column boundaries in week view, allowing users to drag an event from Monday to Wednesday in a single gesture. The dragged event shows a day label ("→ Wed") alongside the time tooltip, and the ghost placeholder shifts to the target column in real-time. (2026-03-10 02:20 AM)

---

Special Feature: Agent Action Diff Overlay — After the workspace agent modifies calendar events, briefly highlight the changed event blocks with a pulsing accent border and a small "modified by agent" badge for 8 seconds, so users can instantly see what changed without comparing before/after states. (2026-03-10 02:35 AM)

### Special Feature #140

Date: 2026-03-10
Time: 2:27 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Briefing Fact-Check Pass — After the workspace agent generates a briefing response, run a lightweight verification pass that extracts every time, date, and number mentioned in the response and cross-references them against the raw calendar/email data provided in context. Any mismatches get flagged with an inline correction badge before the response is shown to the user. Catches hallucinated details at the transport layer. **UPDATE:** Implemented as agent self-verification instruction in the system prompt instead — the agent checks its own facts before responding.

---

### Special Feature #141

Date: 2026-03-10
Time: 2:28 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Agent Confidence Indicators — When the workspace agent references a specific fact (time, confirmation code, amount), it appends a tiny inline confidence marker based on source: a checkmark for data read directly from calendar/email context, a tilde for data recalled from memory, and a question mark for inferred/uncertain details. Lets the user instantly see which facts are grounded vs. which might be hallucinated.

---

Special Feature: Default Reminder Preference — Let users set a default reminder preference in workspace memory (e.g. "5 min popup for breaks, 15 min for work start") so the agent automatically applies reminders when creating future events without being asked each time. (2026-03-10 02:38 AM)

---

### Special Feature #142

Date: 2026-03-10
Time: 9:35 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Server Memory Guardian — A `/api/health/memory` endpoint that exposes real-time Node.js heap stats plus per-Map cardinality for every in-memory store (activeOperations, activeSessions, incidents, recentDomainEvents, etc.). When heap crosses 80% of max-old-space-size, auto-triggers emergency cleanup: prunes stale Map entries, forces workspace session eviction, and hints GC. The workspace dashboard shows a live memory breakdown widget so you can see exactly which in-memory store is growing and catch leaks before they crash the server.

---

### Special Feature #143

Date: 2026-03-10
Time: 9:47 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Memory Leak Canary — A lightweight background service that periodically samples `process.memoryUsage()` and computes a 5-minute rolling average heap growth rate. If growth exceeds a configurable threshold (e.g., 2MB/min sustained for 5 min), it emits a `memory-canary` event to the workspace monitor SSE stream with a breakdown of which in-memory Maps grew the most since the last sample. Acts as an early warning system that catches leaks while they're still manageable, before they escalate to OOM.

---

### Special Feature #144

Date: 2026-03-10
Time: 10:29 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Account Health Monitor — A persistent status widget in the Gmail sidebar that shows the health of each connected account's OAuth connection in real time. Displays token expiry countdown, last successful sync timestamp, and quota usage (Gmail API calls remaining). When a token is about to expire or an account goes stale (no successful fetch in 10+ minutes), it surfaces an amber/red warning badge on the account avatar with a one-click "Re-authorize" button — so the user never discovers a broken connection mid-workflow.

---

### Special Feature #145

Date: 2026-03-10
Time: 11:58 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Message Cost Heatmap — Color-code the per-message cost display across all chat bubbles so cheap messages ($0.001) show green, moderate ($0.01) show amber, and expensive ($0.05+) show red. Gives an instant visual signal when a prompt is burning through tokens without needing to read the numbers, letting you catch runaway costs at a glance.

---

### Special Feature #146

Date: 2026-03-10
Time: 12:14 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Conversation Export Formats — Long-press or right-click the copy-conversation button to open a format picker: plain text (current), Markdown with role headers and separators, or JSON with full metadata (timestamps, tokens, cost, provider per message). Useful for pasting into support tickets, documentation, or feeding conversation history into other tools.

---

### Special Feature #147

Date: 2026-03-10
Time: 12:17 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Smart Snooze with Calendar Awareness — When snoozing an email in the unified inbox, the workspace agent checks your calendar for the next free slot and suggests optimal snooze times like "After your 2pm meeting" or "Tomorrow morning before standup." If the email references a date/event (e.g., "let's discuss Friday"), it auto-suggests snoozing until that date. Snoozed emails re-surface as a workspace agent notification with the original context preserved.

---

### Special Feature #148

Date: 2026-03-10
Time: 12:55 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Cross-Account Calendar Overlay — When multiple Google accounts are connected, add a toggle to display events from ALL accounts simultaneously on the same calendar view with distinct color bands per account. The workspace agent auto-detects scheduling conflicts across accounts (e.g., work meeting overlaps with personal appointment) and flags them with a warning badge, so you can spot cross-life conflicts at a glance without switching between calendars.

---

### Special Feature #149

Date: 2026-03-10
Time: 6:01 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Action Verification Dashboard — Add a collapsible "Action Receipt" panel below each workspace agent response that shows every action taken with a traffic-light status: green (verified — the system re-read the resource and confirmed), yellow (submitted — API accepted but couldn't verify), red (failed — with error reason). Each row shows the action, target, expected outcome, and actual outcome. Clicking a row expands the raw API response. This gives the user instant visibility into what actually happened vs what the agent claims happened, eliminating the "said done but wasn't" trust gap.

---

### Special Feature #150

Date: 2026-03-10
Time: 6:11 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Action Replay Debugger — A DevMode panel that visualizes the workspace agent's action execution timeline as a waterfall chart. Each action shows tool name, params summary, duration bar, retry attempts (with delay gaps), verification status (green/yellow/red dot), and fail-fast skips. Hovering expands the raw API response. The timeline groups by iteration round with separator lines, so you can see the full multi-turn conversation loop. Powered by the existing action-log ring buffer — zero new infrastructure needed.

---
Date: March 11, 2026
Time: 12:31 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Uptime Streak Tracker — Track continuous server uptime with a "Server uptime: 14h 32m" badge in the DevMode panel that resets on restart. Persists the longest-ever streak and last 7 restart timestamps to MongoDB so you can verify memory fixes are working over time. Shows a mini spark chart of restart history to spot crash patterns (e.g., always dies around 3am = memory leak, always dies at noon = deploy). Zero overhead — just records process.uptime() on a 60s heartbeat and writes a single doc on shutdown.

---
Date: March 11, 2026
Time: 9:33 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Citation Click-to-Expand — When a specialist clicks a citation number [1] in the AI response or in the Sources footer, a popover appears showing the actual playbook excerpt text that was retrieved. The specialist can verify the source content without leaving the chat or opening a separate panel. Builds on the Playbook Citation Backlinks feature, turning passive source labels into a full inline provenance viewer with the original playbook text, section heading, and category path.

---
Date: March 11, 2026
Time: 10:04 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: OCR Confidence Overlay — After the webcam captures a photo of your work screen, run a quick client-side sharpness/readability check on the image before sending it to the AI. Display a green/yellow/red "Readability" badge on the capture preview showing estimated text clarity based on edge detection and contrast analysis. Yellow/red prompts a retake with tips ("move closer", "reduce glare", "increase screen brightness"). Prevents wasted AI tokens on blurry or washed-out captures that Claude can't parse.

---
Date: March 11, 2026
Time: 10:40 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Focus Lock Toggle — Add a "Focus Lock" button to the webcam viewfinder that freezes the current focus distance by switching from continuous to manual focus mode. Ideal for photographing a monitor at a fixed distance so the camera doesn't hunt between the screen and background objects. The focus badge shows a blue "Locked" state, and tapping the button again re-enables continuous autofocus.

---
Date: March 11, 2026
Time: 11:05 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Crop Preset Strips — Add quick-select preset buttons in the crop toolbar: "Left ⅓", "Center ⅓", "Right ⅓" that instantly set the crop region to the corresponding vertical slice of the landscape webcam feed. Perfect for the Iriun/iPhone workflow where you only want one panel of your work monitor. One tap instead of manually dragging every time.

---
Date: March 12, 2026
Time: 1:04 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Circuit Breaker Retry Coalescing — Change the failure counter in http.js so all retries for a single logical GET request count as just 1 failure instead of 1-per-attempt. Currently, a single request that fails initial + 2 retries records 3 failures, meaning only 2 failed requests trip the 5-failure threshold. With coalescing, the breaker would require 5 genuinely distinct failed requests before opening. A single `_suppressFailureCount` flag during the retry loop prevents `_recordFailure()` from incrementing until the entire retry chain exhausts, then records once. Makes the breaker far more resilient to transient blips without changing the threshold or retry count.

---
Date: March 11, 2026
Time: 11:32 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Camera Preset Profiles — Save named combinations of rotation + crop region + camera selection (e.g., "QBO Screen", "Whiteboard", "Full Monitor") and switch between them from a dropdown in the webcam toolbar. Stored in localStorage per user. Useful for specialists who regularly capture different parts of their workspace at different angles without reconfiguring every time.

---
Date: March 11, 2026
Time: 11:39 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Raw Feed PiP Thumbnail — In portrait mode, show a small draggable picture-in-picture thumbnail of the un-rotated raw camera feed in the corner of the viewfinder. Lets you see both the corrected orientation and the original simultaneously, useful for verifying rotation is correct before capturing when the camera angle is ambiguous.

---
Date: March 11, 2026
Time: 11:43 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Activity Sound Cues — Play subtle, configurable audio tones when specific Request Activity events fire (e.g., a soft chime on triage card received, a click on request accepted, a low tone on errors). Configurable per-event in Settings with volume slider and mute toggle. Uses the Web Audio API to generate tones without needing sound files. Lets specialists monitor escalation progress by ear without watching the screen.

---
Date: March 11, 2026
Time: 11:45 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Smart Bubble Timestamp Grouping — Instead of showing a timestamp on every chat bubble, group consecutive same-role messages sent within 2 minutes and display a single shared timestamp divider between groups (like iMessage/Slack). Reduces visual clutter in long conversations and makes the chat feel more natural and scannable.

---
Date: March 11, 2026
Time: 11:47 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: JSX Structure Visualizer — A dev-mode overlay (toggled via keyboard shortcut) that renders a collapsible tree of the current component's JSX nesting structure with line numbers. Makes it trivial to spot mismatched tags and nesting issues in large components like Chat.jsx (2,400+ lines), turning structural debugging from a manual scroll-hunt into a visual tree inspection.

---
Date: March 12, 2026
Time: 12:13 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Image Archive Quality Dashboard — A dedicated panel (accessible from Settings or Dev Mode) that surfaces the permanent image archive data: total archived images, grade distribution (A/B/C/D/F pie chart), per-conversation image count, and a scrollable gallery with thumbnails, triage cards, and quality grades side-by-side. Click any archived image to see its full metadata (user prompt, model parsing, structured fields, provider, token usage). Filter by grade to find low-quality parses for manual review or re-analysis. Turns the on-disk archive from a write-only log into a visible, queryable training feedback loop.

---
Date: 2026-03-12
Time: 12:57 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Dead Import Guardian — A lightweight Vite plugin that runs on each HMR update and scans for imports pointing to deleted/missing files before the build fails. When detected, it auto-comments the dead import with a // [REMOVED] marker, logs a warning to the dev console with the exact line, and fires an event to the DevMiniWidget so you see a dead import cleaned badge — preventing compile crashes like this one from blocking the app entirely.

---
Date: 2026-03-12
Time: 1:00 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Model Identity Tooltip — Hovering over the provider badge at the bottom of the chat compose area shows a tooltip with the exact model ID (e.g. "claude-opus-4-6"), transport type, and current reasoning effort level. Gives at-a-glance visibility into what's actually running without opening the full provider popover.

---
Date: 2026-03-12
Time: 1:02 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Provider Change History Log — Track every provider/model switch in a lightweight session log (sessionStorage). Accessible from the provider popover as a "Recent switches" mini-list showing timestamp, from-model, to-model. Helps you remember what you've tried when troubleshooting model behavior differences during a session.

---
Date: 2026-03-12
Time: 1:05 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Calendar Multi-Day Event Spanning Bar — Instead of repeating the same all-day event as a separate chip in each day column, render multi-day events as a single continuous bar that visually spans across the correct day columns (like Google Calendar). Use position: absolute with left/width calculated from event start/end day indices within the visible week. Makes multi-day events instantly distinguishable from single-day ones.

---
Date: 2026-03-12
Time: 1:06 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Supervisor Alert Confidence Score — Instead of binary stuck/not-stuck alerts, compute a confidence score (0-100) based on multiple signals: phase type, idle duration relative to phase-specific thresholds, historical median duration for that phase, stdout frequency pattern, and number of concurrent active sessions. Display as a colored confidence ring in the DevMode panel (green < 30, yellow 30-70, red > 70). Only fire auto-error alerts when confidence exceeds 80, dramatically reducing false positives while catching genuinely stuck sessions faster by pattern-matching against historical norms rather than flat thresholds.

---
Date: 2026-03-12
Time: 1:12 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Parsed Field Diff Review — After the two-step image parse (transcribe then parse), show a side-by-side diff panel in the EscalationDetail view comparing the raw transcription text against the structured JSON fields that were extracted. Each field row highlights the exact source substring from the transcription that it was derived from, with amber flags on fields where no matching source text was found (potential fabrication). One-click "Edit" on any field lets the specialist correct it inline with the transcription visible as reference. Catches parse errors at review time instead of after the response is sent, and builds a feedback loop for improving parse prompts.

---
Date: 2026-03-12
Time: 9:47 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Dead Code Scanner — A Dev/Settings panel that scans client and server for orphaned imports, unused component files, and stale route registrations. Surfaces removal candidates in a checklist so cleanup happens proactively instead of accumulating dead code debt.

---
Date: 2026-03-12
Time: 1:40 AM AST
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Parse Path Cost Comparator — After every image parse, log the parse path used (SDK-native vs CLI two-step) along with latency, token counts, and cost to the parse attempt metadata. In the EscalationDetail view, show a small "Parse Stats" badge that opens a popover displaying: which path was used, total latency, input/output tokens, estimated cost, and whether a fallback occurred. Over time, the Analytics panel aggregates this data into a "Parse Economics" chart showing SDK vs CLI success rates, median latency, and cumulative token savings. Gives hard numbers on whether the SDK path is actually delivering the expected quality and cost improvements.

---
Date: March 12, 2026
Time: 1:48 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Parse Confidence Heatmap — Overlay a per-field confidence indicator on the triage card, color-coded green/yellow/red based on character-level certainty from the model's structured output. Fields the model flagged as uncertain (empty strings, partial reads) show as yellow/red, while exact transcriptions show green. Fields with low confidence get a clickable "Verify" badge that expands the original image cropped to the region where that field appears, letting the specialist confirm or correct the value without re-reading the full screenshot.

---
Date: March 12, 2026
Time: 2:05 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Parse Provider Selector — Add a Settings toggle that lets the specialist choose the image parse provider: "CLI Two-Step" (current default — transcribe then schema-parse via two CLI subprocess calls), "Agent SDK" (native base64 vision via @anthropic-ai/claude-agent-sdk, higher accuracy but ~150MB memory overhead and 12s startup), or "API Direct" (future — requires separate API key for lightweight Messages API call with native vision). The active provider is stored in the AI settings and passed to `parseEscalation()` which routes accordingly. When a provider fails or is unavailable, it falls back to the next one in priority order. The Settings panel shows a live status indicator (green/amber/red) for each provider based on whether its prerequisites are met (CLI installed, SDK package present, API key configured).

---

### Special Feature #151

Date: March 12, 2026
Time: 10:11 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Endpoint Heartbeat Map — A grid of feature tiles (Chat, Email, Calendar, Workspace, etc.) accessible from a "System Health" button in the HealthBanner, where each tile shows real-time latency as a colored background pulse (green < 200ms, yellow < 1s, red > 1s, grey = no recent data). Tiles auto-sort by health status so problems float to the top. Clicking a tile expands it to show a mini sparkline of the last 50 request durations for that feature. Gives a non-technical user a single glanceable dashboard of "what's working and what's slow" without needing the full waterfall panel.

---
Date: March 12, 2026
Time: 9:57 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Config Freshness Monitor — A SessionStart hook that diffs the project's actual top-level directories and model files against what's documented in CLAUDE.md's Architecture and Key Files sections. When drift is detected (new directories, deleted files, model count mismatch), it injects a one-line warning into the session context: "CLAUDE.md may be stale — X new dirs, Y new models since last update." Keeps project docs honest without manual audits.

---
Date: March 12, 2026
Time: 10:00 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Runtime Health Canary Wall — A persistent horizontal strip below the DevMode panel header that renders one small colored dot per runtime subsystem (workspace, ai-chat, ai-copilot, ai-gmail, ai-parse, requests, background, monitor, remediation, domains). Each dot pulses green when the subsystem's health endpoint returns zero stale sessions, shifts to amber when staleCount > 0, and turns red when the subsystem throws or returns no data. Hovering a dot shows a tooltip with the subsystem name, active session count, longest active duration, and stalest idle time. Clicking a red dot auto-scrolls to the corresponding section in the full health JSON viewer and pre-populates a "Investigate [subsystem] health failure" prompt in the dev agent chat. The strip polls `/api/dev/health` on the same cadence as the existing monitors (no extra requests) and derives its state from the already-fetched health response, adding zero network overhead. Gives the specialist an always-visible, at-a-glance liveness map of every runtime layer without opening the full health panel.

---

### Special Feature #152

Date: March 12, 2026
Time: 10:13 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Diff Impact Analyzer — When an auto-review detects a large changeset (50+ files or 10K+ lines), automatically generate a dependency graph showing which changed server routes are consumed by which changed client components, highlighting "high-risk paths" where both endpoints AND consumers changed simultaneously. Render it as an interactive SVG in the WorkspaceAgentPanel where nodes are files, edges are import/fetch relationships, and color intensity reflects lines-changed magnitude. Clicking a node shows the git diff for that file inline. This turns a wall-of-text diff summary into a visual map of blast radius, helping the specialist prioritize manual review on the riskiest cross-layer changes.


---
Date: March 12, 2026
Time: 12:37 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Client-Side Stale Stream Detector — Add a heartbeat watchdog in the chat SSE hook (useChat.js) that monitors incoming events. If no SSE event (including heartbeats) arrives for 20 seconds, display a subtle "Connection may be stalled" warning banner at the top of the chat area with a one-click "Retry" button. If no event arrives for 45 seconds, auto-abort the stream and show a "Request timed out — click to retry" message. This gives users immediate visual feedback when something is stuck server-side, instead of staring at a frozen cursor for minutes. The banner uses a pulsing amber animation to draw attention without being alarming, and auto-dismisses when events resume.

---
Date: March 12, 2026
Time: 12:59 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Stream Debug Replay Mode — Add a CLAUDE_STREAM_DEBUG=1 env var that dumps every raw JSON line from Claude CLI subprocesses to a rotating log file under server/logs/stream-debug/. When a chat hang occurs, replay the exact stream offline to see what events were emitted vs what the parser extracted — no need to reproduce the issue live. Files auto-rotate at 5MB to prevent disk fill. Includes a simple CLI script (scripts/replay-stream.js) that reads a captured log and highlights which lines would be extracted vs silently dropped by the current parser.

---
Date: March 12, 2026
Time: 2:29 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Health Banner Copy Diagnostics — Add a small clipboard icon in the expanded health banner detail panel. Clicking it copies a formatted text summary of all affected features with their status codes and response times (e.g., "Calendar: 503 (1.2s), Workspace: timeout (2.4s)"), ready to paste into Slack or an escalation note for quick incident communication.

---
Date: March 12, 2026
Time: 3:14 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Camera PiP (Picture-in-Picture) Preview — When composing a chat message with a camera capture, show a small floating thumbnail of the captured image in the corner of the chat input area. Clicking the thumbnail reopens the camera modal for re-capture, and a tiny X dismisses it. This gives the user constant visual confirmation of what image they're about to send without needing to scroll up or remember what they captured.

---
Date: March 12, 2026
Time: 3:16 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Image A/B Parse Comparison — When image parsing produces a result, silently run a second parse in the background using an alternate strategy (e.g., single-pass vision vs two-step transcribe+parse). Store both results in the image archive with a diff score. Surface a small "Compare parses" link on the triage card that opens a side-by-side showing which fields each method extracted differently. Over time, the archive accumulates accuracy data per strategy so you can auto-select the best parser for different image types (webcam photos, clean screenshots, dark mode, etc.).

---
Date: March 12, 2026
Time: 3:18 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Calendar Event Quick-Clone — Right-click any calendar event to duplicate it to another day/time with a single click, pre-filling all fields (summary, description, location, attendees). Useful for recurring meeting patterns that don't follow a strict schedule, like ad-hoc standups or client calls that repeat irregularly.

---
Date: March 12, 2026
Time: 3:20 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Gmail Thread Preview Popover — hover over any Gmail thread in the inbox to see a floating preview card with the latest message body, sender, and attachment count, without navigating away from the current view.

---
Date: March 12, 2026
Time: 3:26 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Parse Queue Position Indicator — When multiple specialists submit escalation images simultaneously and the SDK semaphore is occupied, show a small inline indicator on the chat input: "Parse queued (1 ahead)" with a live countdown. As each queued parse completes, the position decrements. When it's your turn, the indicator switches to "Parsing..." with a shimmer animation. Eliminates the "is it frozen?" uncertainty during busy periods when the concurrency limiter is holding requests.

---
Date: March 12, 2026
Time: 4:15 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Image Filmstrip Timeline — A horizontal filmstrip bar (toggleable from the sidebar or conversation header) that renders every image from the current conversation as chronological thumbnails on a scrollable timeline. Hover shows the parsed triage card, click opens full-size with metadata overlay (grade, extracted fields, provider). Drag-select multiple images to compare parsed fields side-by-side in a table. Across all conversations, a global filmstrip view in Analytics shows image volume over time with grade-colored dots, making it easy to spot days with high-volume or low-quality parses at a glance.

---
Date: March 12, 2026
Time: 4:24 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Gallery Visual Text Search — Add a search box to the Image Gallery that full-text searches across all archived images' modelParsing output and parseFields structured data. Type a case number, COID, customer name, or error message and instantly find every screenshot where that text appeared in the AI parse results. Turns the gallery into a reverse-lookup tool for past escalation evidence without needing to remember which conversation contained it — especially useful when a customer calls back about a prior case.

---
Date: March 12, 2026
Time: 4:31 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Client-Side Image Pre-Enhancement Pipeline — Before sending a webcam-captured escalation photo to the server, run a quick canvas-based preprocessing pass: auto-contrast normalization, perspective deskew (detect the screen rectangle via edge detection), and adaptive sharpening for text regions. Photos of screens often have glare, tilt, and low contrast that degrade AI parsing — fixing these client-side before the image ever hits the SDK produces significantly better parse accuracy at zero additional server cost. Show a brief "Enhancing..." flash on the capture preview, and let the user toggle it off in Settings if they're already sending clean screenshots.

---
Date: March 12, 2026
Time: 4:35 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: KB/Tools Auto-Linker Schema Field — Add a kbTools field to the escalation parse schema so the "KB / Tools" line from screenshots gets captured as structured data. On the triage card, render each extracted tool name (iBoss, CS Server, Intuit Admin, etc.) as a clickable chip that deep-links to the corresponding internal tool's login/dashboard URL (configurable in Settings). Saves the specialist from manually opening each tool — one click from the triage card goes straight to the right tool for the issue.

---
Date: March 12, 2026
Time: 4:46 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Serialization Web Worker — Move JSON.stringify for image payloads entirely off the main thread using a small inline Blob-URL Web Worker. Instead of yielding with setTimeout(0) (which still blocks during the actual stringify), the worker receives the body object via structuredClone, stringifies it in a background thread, and posts the resulting string back. Makes image sends completely non-blocking regardless of payload size — zero chance of "Page Unresponsive" on any device.

---
Date: March 12, 2026
Time: 8:24 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Message Bookmarks with Quick Recall — Long-click or right-click any assistant message to bookmark it with an optional tag (e.g., "payroll fix", "bank feed workaround"). Bookmarked messages get a subtle pin icon. A new "Bookmarks" tab in the sidebar lists all pinned messages across conversations, sorted by recency, searchable by tag or content snippet. Clicking a bookmark jumps directly to that message in its original conversation. Bookmarks stored in a lightweight Mongoose model with conversationId + messageIndex + tag + timestamp. Solves the "I know the AI told me this before but I can't find it" problem that plagues long conversation histories.

---
Date: March 12, 2026
Time: 8:27 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Voice-to-Action Quick Commands — Add a small microphone icon next to the chat input that enables push-to-talk voice input using the Web Speech API. Instead of just transcribing to text, the system detects command patterns ("trash those emails", "schedule a follow-up for tomorrow", "escalate this to tier 3") and converts them to structured actions with confirmation buttons — so you speak naturally and the agent confirms with one-click quick actions before executing. Zero typing needed for common workflows. Runs entirely client-side (no server cost), falls back gracefully if the browser doesn't support it.

---
Date: March 12, 2026
Time: 8:36 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Mood Ring Mode — The app subtly shifts its entire color palette throughout the day based on your real usage patterns. Morning = crisp blues, heavy escalation load = warm ambers, idle periods = soft greens. It reads your actual activity (emails opened, escalations worked, chat volume) and the UI breathes with your workday rhythm. Not a manual theme — an ambient, living palette that reflects how your day is going. No two days look the same.

---
Date: March 12, 2026
Time: 8:39 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Replay Mode — Select any resolved escalation and watch a step-by-step animated replay of how it was handled: the initial triage, each message exchange, what playbook content was referenced, what the resolution was. Like a game replay but for support work — useful for training yourself on tough categories, spotting where you spent too long, or showing someone else how you handled a tricky case.

---
Date: March 12, 2026
Time: 8:48 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low-medium
Special Feature: Morning Pulse — Auto-surface today's unread briefing as a floating dismissible card the moment you open the app, instead of hiding it inside the workspace panel. One tap to expand full details, click to dismiss for the day. You'd start every session knowing your priorities without navigating anywhere — like a morning newspaper that meets you at the door.

---
Date: March 12, 2026
Time: 8:53 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: high
Special Feature: Playbook Flashcard Drills — The app generates quick-fire flashcard quizzes from your published playbook entries: it shows a symptom and you guess the root cause/fix before revealing the answer. Spaced repetition ensures categories you haven't seen in a while come up more often. A surprisingly effective way to stay sharp on edge cases during slow shifts without re-reading docs.

---
Date: March 13, 2026
Time: 10:45 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Mood Jukebox — Let the app detect the "vibe" of your shift based on escalation volume, resolution speed, and inbox pressure, then auto-generate a Spotify/YouTube search link for a matching playlist. Crushing it? Upbeat victory anthems. Drowning? Lo-fi focus beats. Slow day? Discovery mix. A tiny dopamine hit that acknowledges the emotional rhythm of support work instead of pretending every hour feels the same.

---
Date: March 13, 2026
Time: 10:56 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Déjà Vu Detector — When you start a new chat escalation, the AI silently fingerprints the issue (symptoms + category + error keywords) and checks if you've personally handled a near-identical case before. If it finds a match, it surfaces a ghost card: "You resolved something like this on Feb 18 — here's what worked." Turns your own escalation history into an instant expert recall system so you never re-solve the same problem from scratch.

---
Date: March 13, 2026
Time: 11:32 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: AI Rubber Duck — A tiny floating duck icon in the chat area that opens a Socratic mini-dialog. Instead of giving answers, the AI asks probing questions ("what else could cause that?", "have you ruled out...?", "walk me through what you see") to coach you through tricky escalations. Deliberately withholds solutions and pushes YOU to reason through the problem — because sometimes explaining it to a duck that keeps asking "why?" is the fastest path to the answer.

---
Date: March 13, 2026
Time: 11:41 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: low
Special Feature: Panic Button — Triple-tap Escape to instantly blank the entire screen to a neutral "Loading..." placeholder, hiding all chat content, escalation data, and customer info. Useful when someone walks up to your desk or you need to screen-share without exposing sensitive details. Press again to restore everything exactly as it was — no data lost, no navigation changed.

---
Date: March 13, 2026
Time: 11:41 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Time Machine — Paste any case number or COID into a search bar and the app reconstructs a complete timeline of everything that happened: every chat conversation about it, every image parsed, every triage card generated, every resolution note — stitched together chronologically across all your sessions. Like git log but for your support cases, so when a customer calls back 3 weeks later you have instant total recall of the full story.

---
Date: March 13, 2026
Time: 11:41 AM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Ghost Typist Mode — Toggle a mode where AI responses render character-by-character with procedurally-generated mechanical typewriter sounds (Web Audio API, zero sound files). Each letter gets a faint ink-stamp visual bloom that fades after 200ms. The clacking speed matches the actual SSE stream rate so it feels alive, not canned. Turns reading long AI responses from "wall of text appeared" into something oddly satisfying — like watching a telegram arrive in real time.

---

Date: March 13, 2026
Time: 1:15 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium-high
Special Feature: Gmail Push Notifications via Pub/Sub — Use the Gmail `users.watch()` API with Google Cloud Pub/Sub to get instant push notifications when new emails arrive (~1-2 seconds). The server receives a webhook, then pushes updates to the client via SSE — true real-time email with zero polling. No more stale inbox or 30-second delays.

---

Date: March 13, 2026
Time: 1:18 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Voice Memo Sticky Notes — Hold a button anywhere in the app to record a quick voice memo (MediaRecorder API). It gets auto-transcribed by Claude and pinned as a draggable sticky note on your workspace. Great for those moments mid-escalation when you think "I need to remember this for later" but don't want to stop typing. Notes persist across sessions and can be searched by spoken content.

---

Date: March 13, 2026
Time: 2:05 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Ambient Soundscapes — A subtle background audio player (lo-fi beats, rain, coffee shop, white noise) you can toggle from the header while working escalations. Auto-pauses when you switch tabs and remembers your last pick — turns long triage sessions into something almost cozy.

---

Date: March 13, 2026
Time: 2:20 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Investigation Constellation Map — A force-directed graph visualization where each INV is a node, color-coded by category, with nodes that share keywords or symptoms gravitating toward each other. Clusters reveal hidden patterns invisible in a flat list — like multiple unrelated INVs all involving the same financial institution or shared root cause. Click any node to expand details, drag to rearrange, zoom to explore.

---

Date: March 13, 2026
Time: 2:52 PM ADT
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Shift Scorecard — At the end of your work shift, the app auto-generates a personal performance card: escalations handled, INV matches surfaced, average response time, categories worked, and a streak counter for consecutive days using the app. Not gamification fluff — a genuine "here's what you accomplished today" snapshot you can screenshot for yourself or use in a 1:1 with your lead to show impact.

---
Date: 2026-03-14 11:23 AM
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: Spec Sheet Scanner — Drag any screenshot (product page, receipt, system info, customer environment) into the chat and the AI extracts structured specs into a formatted comparison card with key/value pairs. Works for PC hardware, QBO subscription tiers, Intuit product pages, or customer environment screenshots during escalations — instantly parse what someone is running without manual transcription.

---
Date: 2026-03-14 11:33 AM
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: medium
Special Feature: **Ambient Soundscape Engine** — A built-in ambient sound generator that plays context-aware background audio while you work. Pick from soundscapes like "rainy office," "coffee shop," or "deep focus white noise," or let it auto-select based on time of day. Uses the Web Audio API so it runs entirely in-browser with no external files needed.

---
Date: 2026-03-14 12:02 PM
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: high
Special Feature: Second Brain Knowledge Graph — Every escalation, chat, email, INV case, and playbook entry becomes a node in a force-directed graph visualization. The AI automatically discovers connections (same error codes, customer, resolution pattern, product area) and draws edges. Click any node to see its neighborhood — instantly revealing patterns like "these 4 unrelated cases all trace back to the same bank feed API bug." Obsidian's graph view but built from your actual work data, zero manual linking.

---
Date: 2026-03-14 12:38 PM
Model: Claude Opus 4.6
Is duplicate?: No
Complexity: high
Special Feature: AI Meeting Prep Briefing — 5 minutes before any calendar event with attendees, the workspace agent auto-generates a prep card: who's attending (with their last email interactions pulled from Gmail), what the meeting is about, any unresolved escalation threads with those contacts, and suggested talking points. Appears as a toast notification you can expand or dismiss — like having a personal chief of staff who whispers context in your ear before every meeting.

---
Date: 2026-03-14 12:38 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: Escalation Deja Vu Alert — When you start typing a new escalation or receive one from an agent, the system silently hashes the error codes, product area, and symptoms against your entire conversation history and flags "You solved something 87% similar on Feb 22 — here's what worked." Shows a compact card with the prior resolution steps, outcome, and a one-click "Apply same approach" button that pre-fills your response. Turns your personal experience into a searchable institutional memory without you ever having to document anything.

---
Date: 2026-03-14 12:40 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: Command Palette (Ctrl+K) — Press Ctrl+K anywhere to open a Spotlight-style floating search bar that searches everything simultaneously: conversations, escalations, INV cases, emails, playbook entries, templates, calendar events, and AI commands. Type "OL-301" and see every mention across all data sources. Type "navigate analytics" to jump to a view. Type "draft email to..." to start an action. One keystroke replaces clicking through 10 sidebar tabs — the universal entry point to your entire work universe.

---
Date: 2026-03-14 1:05 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: Live Desktop Dashboard Widgets — Pin miniature floating widgets (unread emails, next meeting countdown, open escalation count, INV case alerts) directly on your Windows desktop via a system tray Electron companion app. They hover over everything like Xbox Game Bar overlays, so you see critical info without alt-tabbing. Click any widget to deep-link straight into the relevant app view.

---
Date: 2026-03-14 1:20 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Rage Detector — Monitors your typing patterns in real-time (keypress velocity, backspace frequency, caps lock ratio, rapid message sends). When frustration signals spike, it surfaces a calm contextual intervention: "This one's tough — here's a fresh angle..." with an AI-generated alternative approach to the current escalation. A subtle pulse indicator in the chat header shifts green → amber → red as frustration builds, giving you self-awareness before it affects your responses.

---
Date: 2026-03-14 1:26 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: Ambient Soundscape Engine — The app generates a dynamic audio environment tied to your real work state. Low orchestral hum when inbox is clear. Subtle percussion ticks as new escalations arrive. A rising drone when multiple INV cases activate simultaneously. Typing speed modulates tempo. Resolving a case triggers a satisfying harmonic resolution chord. All Web Audio API with zero dependencies — your workday becomes a generative ambient composition that gives you subconscious awareness of system state without ever looking at a dashboard. Includes a small waveform visualizer in the sidebar footer and a mood dial to shift between "focus" (minimal), "flow" (rhythmic), and "alert" (percussive) profiles.

---
Date: 2026-03-14 1:28 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: AI Scenario Simulator — Select any resolved escalation and ask "what if the customer had been on Advanced instead of Plus?" or "what if the agent tried X instead of Y?" The AI reruns the case through your playbook with the altered variables and generates an alternate-timeline resolution path, highlighting where the outcome would have diverged. Turns your closed cases into an infinite training sandbox — practice decision-making against real scenarios without real consequences.

---
Date: 2026-03-14 1:29 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: AI Writing Clone — Feed the AI a dozen of your past escalation responses and it builds a "voice profile" of your writing style (sentence length, tone, vocabulary, greeting/closing habits). Toggle "Write Like Me" mode and all AI drafts come out sounding like you wrote them — not generic AI prose. Your colleagues can't tell the difference.

---
Date: 2026-03-14 1:36 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: In-App Clipboard Ring — A persistent clipboard history panel that captures everything you copy within the app (escalation IDs, case numbers, customer details, AI responses, email snippets). Access with Ctrl+Shift+V to see your last 50 clips, searchable and clickable to re-paste. Entries auto-tag by source (chat, Gmail, calendar) so you can find "that case number I copied 20 minutes ago" instantly — way faster than digging through conversation history or re-opening emails.

---

Date: 2026-03-14 1:45 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Déjà Vu — When you start typing a new escalation, the app silently fingerprints the issue description and surfaces a ghost overlay showing your own past resolution for a nearly-identical case, including what template you used and how long it took. Not a search — it's automatic pattern-matching against your history that feels like muscle memory made visible.

---
Date: 2026-03-14 1:46 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Live Translate Layer — Right-click any text in the app (email, chat message, AI response) and hit "Translate" for an instant Claude-powered inline translation to/from any language. The translation appears as a subtle overlay below the original text, not a separate window. Essential for Canadian bilingual support where French emails land alongside English ones.

---
Date: 2026-03-14 1:46 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: low
Special Feature: AI Alibi Generator — Type "/alibi" in the workspace chat and Claude crafts a polished, professional "sorry for the delay" message based on your actual calendar and inbox context (back-to-back meetings, high inbox volume, travel days). Always truthful, just elegantly worded. Saves you from the writer's block of composing the same apologetic opener for the hundredth time.

---
Date: 2026-03-14 2:18 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Daily Micro-Journal — A tiny expandable text area pinned to the bottom of the sidebar where you jot down one sentence about your day before closing the app. Entries auto-timestamp and accumulate into a private, searchable personal log stored in MongoDB. After a month, ask the AI "what was I dealing with last week?" and it synthesizes your entries into a narrative. Turns scattered workdays into a story you can actually remember.

---
Date: 2026-03-14 3:08 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Peripheral Vision Dashboard — A second-screen or picture-in-picture mini window (Browser PiP API) that floats a stripped-down status board over whatever else you're working in. Shows live escalation count, inbox unread, next calendar event, and AI availability as tiny glanceable icons that pulse on state changes. Drag it to a corner of your monitor and never alt-tab back to the app just to check if something needs attention — your peripheral vision catches it instead.

---
Date: 2026-03-15 9:41 AM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Phantom Workspace — A second, hidden workspace activated with a keyboard shortcut (Ctrl+Shift+Space) that maintains completely separate state: different open tabs, chat history, and layout. Flip between "work mode" (escalations, investigations) and "personal mode" (Gmail, calendar, webcam) instantly without closing anything. Nobody walking by sees the wrong screen, and context-switching takes zero effort.

---
Date: 2026-03-15 4:02 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: Time Machine Replay — Click any past date on the calendar and the app reconstructs that entire day: what emails arrived, what escalations were active, what meetings you had, and what the workspace chat discussed. Like scrolling through a photo reel but for your entire workday — perfect for backtracking on "what was that thing from last Tuesday?"

---
Date: 2026-03-15 4:31 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Conversation Autopilot — When an escalation email thread goes back-and-forth more than 3 times, the workspace agent auto-drafts the next reply based on the full thread context + your playbook, and pins it as a "suggested response" at the top of the thread. You just review and hit send instead of writing from scratch every time a case drags on.

---
Date: 2026-03-15 4:39 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Inbox Heatmap Sparkline — A tiny inline sparkline next to each sender name in the Gmail inbox showing their email frequency over the past 30 days (e.g., "Facebook sent 14 emails this month" as a visual bar). Instantly reveals which senders are flooding your inbox so you can prioritize unsubscribes or filters without opening the unsubscribe panel. Computed from cached message metadata — zero extra API calls.

---
Date: 2026-03-15 4:50 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Inbox Cleanup Live Scoreboard — While the workspace agent processes a bulk inbox cleanup, stream a real-time floating scoreboard overlay showing "Archived: 34 | Labeled: 12 | Trashed: 8 | Skipped: 3" with counts incrementing live as each action completes. Turns an invisible background process into a satisfying visual ticker — like watching a vending machine sort coins.

---
Date: 2026-03-15 4:41 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: small
Special Feature: Email Time-of-Day Distribution — A small bar chart overlay (accessible from the inbox header) that shows when your emails arrive grouped by hour of day across the past 7 days. Reveals your peak inbox load hours so you can schedule focused email triage windows instead of reactively checking all day. Uses the Date header from already-fetched messages — no extra API calls needed.

---
Date: 2026-03-15 6:01 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Speed Dial — Assign hotkeys (1-9) to your most common escalation categories + status transitions. When viewing any escalation, press a number key to instantly categorize, change status, or apply a saved resolution template in one keystroke. Eliminates the dropdown-click-dropdown-click dance when you're triaging a batch of cases back to back.

---
Date: 2026-03-15 6:11 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Smart Paste Intelligence — When you paste content into any text field, Claude auto-detects what it is (QBO error code, transaction ID, stack trace, customer email, phone number) and offers contextual one-click actions: paste an error code → instant playbook lookup and pre-filled response. Paste a transaction ID → search all related escalations. Paste an email address → pull up Gmail history with that contact. Turns your clipboard into a context-aware command line.

---
Date: 2026-03-15 6:33 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Live Dashboard Screensaver — After 2 minutes of inactivity, the app smoothly transitions into a full-screen ambient dashboard showing real-time stats: today's escalation count, resolution rate, inbox zero progress, next calendar event countdown, and a slowly cycling motivational quote — all with subtle animations against your current theme. Move the mouse and you're instantly back. Turns idle time into a glanceable command center instead of a dead screen.

---
Date: 2026-03-15 7:00 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Parallel Universe Drafts — When composing any response (escalation reply, email draft, workspace message), hit a hotkey to instantly generate 3 alternative versions in parallel using different personas: "Empathetic," "Direct/Technical," and "Executive Summary." All three appear side-by-side as cards you can pick from, mix-and-match paragraphs between, or dismiss — like choosing between timelines where you wrote the same message three different ways.

---
Date: 2026-03-16 10:24 AM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Devil's Advocate Mode — Toggle a mode where after every AI response, a second hidden Claude call automatically generates a brief counter-argument or "what could go wrong" critique of its own answer, shown as a collapsible red-tinted card below the response. Forces you to consider the other side before committing to a resolution — especially valuable for tricky escalations where the obvious answer isn't always the right one.

---
Date: 2026-03-16 1:14 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: high
Special Feature: Ghost Courier — Phantom Delivery Timeline — When tracking a package, the app periodically fetches the carrier's public tracking page and builds a visual animated timeline of your package's journey on a mini-map — each scan location as a glowing dot connected by a route line, with the package's current position pulsing. Ask the workspace agent "show me my GPU's journey" and it renders the full path your package has taken, updating in real-time. Turns boring tracking numbers into a visual adventure.

---

### Special Feature #158 — Screenshot Annotator (2026-03-17 12:37 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Screenshot Annotator — Before sending an image to chat, open a quick canvas overlay where you can draw circles, arrows, and highlights directly on the screenshot to point out exactly what's wrong. The AI receives both the annotated image AND the annotation coordinates, so it knows precisely where to look instead of scanning the entire screenshot trying to guess what's relevant. Turns "look at this error" from a treasure hunt into a laser pointer.

---
Date: 2026-03-17 1:44 PM
Model: Claude Opus 4.6 (1M context)
Is duplicate?: No
Complexity: medium
Special Feature: Price Watch Hawk — When the workspace agent detects a purchase/shipping email, it remembers what you paid and the retailer. During your return/price-protection window (typically 30 days), it periodically checks the product page for price drops and alerts you: "Your RTX 5060 Ti dropped $47 on Newegg — you're still in the return window. Want me to draft a price match request?" Turns your shipping tracker into a money-saving watchdog.

---

### Special Feature #159 — AI Context Handoff (2026-03-17 1:50 PM)
Is duplicate?: No
Complexity: medium
Special Feature: AI Context Handoff — When you're mid-escalation and need to step away or shift tasks, hit a "Park" button that tells the AI to generate a 3-sentence situation briefing of exactly where you left off (what the issue is, what you've tried, what the next step should be). When you come back — even days later — click "Resume" and the AI reconstructs your mental context instantly, so you never lose that "where was I?" momentum that kills productivity after interruptions.

---

### Special Feature #160 — Escalation Sonar (2026-03-17 2:53 PM)
Is duplicate?: No
Complexity: high
Special Feature: Escalation Sonar — A passive background listener that watches all your chat conversations in real-time and builds a live signal map. When 3+ different agents message you about the same symptom within an hour, a Sonar ping fires: "Possible emerging issue — 4 agents reported bank feed disconnects in the last 45 minutes. Create an INV?" Turns you from reactive (waiting for Slack INV posts) to proactive (spotting outages before they're even officially filed).

---

### Special Feature #161 — INV Constellation Map (2026-03-17 3:00 PM)
Is duplicate?: No
Complexity: high
Special Feature: INV Constellation Map — A visual graph that maps relationships between INV investigations based on shared symptoms, affected product areas, and timing clusters. Each INV is a node; edges form when the matcher detects similarity. Over time, constellations emerge: "These 4 bank feed INVs all share the same OAuth symptom cluster -- they might be one root cause." Clicking a constellation shows a unified summary and lets you propose merging them into a single master INV with combined affected user counts. Turns isolated bug tickets into pattern intelligence.

---

### Special Feature #162 — Temporal Replay Slider (2026-03-17 3:14 PM)
Is duplicate?: No
Complexity: high
Special Feature: Temporal Replay Slider — A timeline scrubber at the bottom of the Constellation Map that lets you replay clusters forming over time. Each node fades in on its reportedDate, edges appear as shared symptoms are discovered, and you watch clusters coalesce day by day — revealing outbreak patterns like "all bank-feed INVs landed within 48 hours" that are invisible in a static view.

---

### Special Feature #163 — Mood Ring Ambient Theme (2026-03-17 5:31 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Mood Ring Ambient Theme — Your app automatically shifts its color palette throughout the day based on your activity patterns. Morning = cool blues for focus mode, afternoon escalation rushes = warm ambers, quiet evening catch-up = deep purples. If you're in a long streak of closed INVs, the theme subtly celebrates with a gold tint. It's not just dark/light mode — it's a living theme that reflects your workday rhythm and makes the app feel alive.

---

### Special Feature #164 — Screenshot Markup Canvas (2026-03-19 7:31 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Screenshot Markup Canvas — Drop any screenshot into the app and get a lightweight annotation layer: arrows, circles, text callouts, and blur/redact regions. Mark up a QBO screen to show an agent exactly where to click, then send it as a single flattened annotated image. No more "see the button in the top right" — just circle it. Built-in canvas tools, no external apps needed.

---

### Special Feature #165 — Clipboard Ring (2026-03-19 8:10 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Clipboard Ring — A built-in clipboard history that captures everything you copy inside the app (AI responses, escalation text, template snippets, email fragments). Press Ctrl+Shift+V to pop open a searchable ring of your last 50 clips, click to paste. Survives page refreshes via localStorage. Kills the "wait, where did I copy that from?" moment during heavy multi-tab escalation work.

---

### Special Feature #166 — Model Lab Live Streaming Results (2026-03-19 8:39 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Model Lab Live Streaming Results — Convert the benchmark endpoint to SSE so each model's result streams to the UI the instant it finishes, instead of waiting in silence for 5-13 minutes. Watch "Sonnet 4.6: 12.4s, 847 words" appear while GPT-5.4 is still running. No more staring at a spinner wondering if it froze — results come alive one by one.

---

### Special Feature #167 — Voice Memo Quick-Capture (2026-03-19 9:01 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Voice Memo Quick-Capture — Tap a floating mic button anywhere in the app to record a quick voice memo (Web Audio API + MediaRecorder). The recording gets auto-transcribed by your AI provider and saved as a searchable text note with timestamp. Perfect for when you're on the phone getting details from an agent faster than you can type — just dictate the COID, case number, and symptoms, then paste the transcript into your template later.

---

### Special Feature #168 — Phantom Typist (2026-03-19 9:16 PM)
Is duplicate?: No
Complexity: low
Special Feature: Phantom Typist — When AI responses stream in, the app plays soft realistic keyboard typing sounds synced to the token speed — fast clacking during bursts, slowing during thinking pauses. Toggle it on/off with a speaker icon. Makes the AI feel like a real person typing your answer in real time, and it's weirdly satisfying during long waits.

---

### Special Feature #169 — Escalation Wrapped (2026-03-19 9:18 PM)
Is duplicate?: No
Complexity: high
Special Feature: Escalation Wrapped — A Spotify Wrapped-style personal recap that auto-generates at the end of each week/month. Beautiful animated cards showing: your most-resolved category, fastest resolution time, total escalations handled, your "power hour" (busiest time), longest streak, and an AI-generated "escalation personality type" based on your patterns (e.g. "The Bank Feed Whisperer"). Shareable as a screenshot, genuinely fun to review.

### Special Feature #170 — Shift Debrief: Auto-Generated End-of-Shift Intelligence Report (2026-03-19 9:34 PM)
Is duplicate?: No
Complexity: high
Special Feature: Shift Debrief — Hit a button at end-of-shift (or auto-prompted after 4+ hours of activity) and the app generates a full intelligence report: escalation summary by category, emerging pattern detection ("3 payroll escalations today all hit vacation accrual after Advanced upgrade — not a tracked INV yet, flag to your lead"), playbook gap report with auto-drafted additions from today's resolutions, agent coaching insights ("Agent Sarah Chen escalated 4x today, 3 were permissions — she may need the permissions quick-ref"), unresolved handoff notes for tomorrow's pickup, and INV trend alerts showing which investigations are heating up. Turns individual case work into institutional knowledge that compounds over time.

- [ ] **Ambient Sound Mixer** — A built-in background noise generator (rain, coffee shop, lo-fi hum, ocean waves) with a tiny floating player widget. Mix multiple sounds with individual volume sliders, save presets like "Deep Focus" or "Chill Afternoon." *(suggested 2026-03-19 9:31 PM)*

### Special Feature #171 — Walk-Away Lock (2026-03-20 12:05 AM)
Is duplicate?: No
Complexity: medium
Special Feature: Walk-Away Lock — Webcam detects when you leave your desk (face disappears for 10+ seconds) and automatically blurs the entire app with a frosted-glass overlay to protect sensitive customer data on screen. When you sit back down and your face reappears, it unlocks instantly — zero-click security using the webcam hardware you already have. Perfect for open-office back-office environments where customer account info is visible.

### Special Feature #172 — AI Déjà Vu (2026-03-20 05:16 AM)
Is duplicate?: No
Complexity: medium
Special Feature: AI Déjà Vu — When you start typing a message in chat, the AI scans your entire conversation history and silently detects if you've asked something similar before. Instead of re-answering from scratch, it surfaces a ghost card: "You asked this on March 3rd — here's what worked last time" with the previous answer, what resolution you chose, and whether it was successful. Saves you from re-researching the same tricky edge cases you've already solved but forgot about.

### Special Feature #173 — Sensitive Data Shield Mode (2026-03-22 10:14 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Sensitive Data Shield Mode — One-click "Shield" toggle in the header that forces ALL AI requests through your local LM Studio model only, blocking cloud providers entirely. A red lock icon appears and the app refuses to route to Claude/GPT until you deactivate it. Perfect for handling escalations with sensitive customer data (SSNs, bank accounts, tax info) — zero data leaves your machine. Combines the new local model capability with a genuine privacy need in back-office work.

### Special Feature #174 — Ghost Typing Preview (2026-03-22 10:30 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Ghost Typing Preview — When you're composing a response to a phone agent, the app shows a faint AI-generated "ghost completion" ahead of your cursor (like GitHub Copilot but for escalation replies). It draws from your playbook, past resolutions, and the current escalation context. Press Tab to accept, keep typing to ignore. Turns you into a speed demon without taking away control — your words, AI-assisted pacing.

---

### Special Feature #175 — Déjà Vu Escalation Pattern Detector (2026-03-22 10:41 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Déjà Vu Escalation Pattern Detector — When composing a chat message about a new escalation, the AI silently scans your last ~50 resolved cases and surfaces a floating toast if it detects a repeating pattern — like "3rd bank-feed disconnect from RBC this week" or "payroll tax filing failures spiking since Tuesday." It's not about matching a single similar case (that exists already) — it's about detecting emerging trends across multiple cases that you'd only notice by gut feel after days. One tap expands into a mini-timeline of the cluster so you can flag it to your team lead before it becomes a known issue.

### Special Feature #176 — Session Ghost Recovery (2026-03-23 12:17 AM)
Is duplicate?: No
Complexity: medium
Special Feature: Session Ghost Recovery — When a workspace agent session dies mid-stream (network drop, browser tab freeze, server restart), the app auto-detects orphaned sessions on next load, recovers any partial response text from localStorage, and presents a "pick up where you left off" card showing what was being processed when it died. Prevents lost AI work during long agent runs — no more "what was it saying before it crashed?"

### Special Feature #177 — Pomodoro Flow Timer (2026-03-23 12:17 AM)
Is duplicate?: No
Complexity: medium
Special Feature: Pomodoro Flow Timer — A built-in focus timer that integrates with your escalation workflow. Start a 25-minute session and the app auto-silences non-critical workspace alerts, dims notification badges, and tracks escalations closed per session. After the timer, a micro-break card appears with your sprint stats and a stretch reminder. Over time, Analytics shows your escalation-per-pomodoro rate — revealing your peak productivity windows and turning "just grinding" into measurable flow states.

### Special Feature #178 — Ambient Soundscape Engine (2026-03-23 12:20 AM)
Is duplicate?: No
Complexity: medium
Special Feature: Ambient Soundscape Engine — A built-in ambient sound mixer in the header — rain on a window, coffee shop murmur, lo-fi hum, white noise. It auto-reads your work tempo: when you're blazing through escalations it stays mellow, but when you've been stuck on one case for 10+ minutes it subtly shifts to a deeper focus frequency. Tiny headphone icon, drag-and-mix layers, save your own presets. Turns your escalation grind into a vibe.

### Special Feature #179 — AI Shadow Agent (2026-03-23 12:47 AM)
Is duplicate?: No
Complexity: medium
Special Feature: AI Shadow Agent — A second invisible AI runs on every image you paste into chat, using a different provider than your primary one, and silently compares both transcriptions character-by-character. If they disagree on a COID, case number, or INV number, a subtle warning badge appears on the parsed output highlighting the discrepancy — like having a second pair of eyes proofread every image parse without you doing anything. Catches the one wrong digit that could send you chasing the wrong case.

### Special Feature #180 — Ritual Lock Screen (2026-03-23 2:40 AM)
Is duplicate?: No
Complexity: medium
Special Feature: Ritual Lock Screen — When your shift starts, the app presents a full-screen question: "What's the one thing you want to accomplish today?" Your answer gets pinned as a persistent micro-banner across every view. At end-of-day, it replays your intention alongside actual metrics (escalations closed, emails handled, INVs resolved) and asks "Did you do it?" — stored in a micro-journal. Over weeks, the AI spots patterns in which goals you hit vs. abandon and starts suggesting more realistic daily intentions.

### Special Feature #181 — Escalation Voice Memo (2026-03-23 4:12 AM)
Is duplicate?: No
Complexity: medium
Special Feature: Escalation Voice Memo — Tap a mic icon in the compose area to record a quick voice note, and the app transcribes it instantly into a draft escalation response using Whisper-style speech-to-text. Perfect for when you're juggling multiple cases and typing is slower than talking — speak your resolution, the AI cleans up grammar and QBO terminology, and you review before sending. Keeps your hands free while your brain works.

### Special Feature #182 — AI Time Capsule (2026-03-23 10:19 AM)
Is duplicate?: No
Complexity: medium
Special Feature: AI Time Capsule — Once a month, the AI writes a sealed "letter to future you" summarizing your work patterns, wins, struggles, and growth — then locks it for 90 days. When it unlocks, you get a notification to read how past-you was doing, what you were wrestling with, and how far you've come. A personal retrospective no one else sees — surprisingly motivating when you realize problems that felt huge 3 months ago are now routine.

### Special Feature #183 — Provider Health Dashboard (2026-03-25 7:29 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Provider Health Dashboard — A live tile on the image parser panel that pings all configured vision providers every 30 seconds and shows real-time latency, uptime streaks, and cost-per-parse estimates side by side. When you're about to parse a batch of screenshots, glance at it to pick the fastest/cheapest provider right now — no more trial and error guessing which one is lagging today.

### 🔊 Read Aloud Mode
**Suggested:** Wed, Mar 25, 2026  7:33:29 PM
Click a button on any escalation, chat response, or email to have it narrated via browser text-to-speech. Hands-free processing while you multitask — highlight any text and hit a hotkey to hear it read aloud with adjustable speed and voice.

### Special Feature #184 — Phantom Clipboard (2026-03-25 7:37 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Phantom Clipboard — A persistent invisible clipboard that lives across all app views. Triple-tap any text (COID, case number, INV, email address) and it silently stacks onto a floating chip tray at the bottom edge. When you're composing a response or filling a form, tap any chip to paste it inline — like a clipboard with memory that never forgets what you copied 20 minutes ago, even across tab switches and panel changes.

### 🐾 Desk Pet
**Suggested:** Wed, Mar 25, 2026  7:44:52 PM
A tiny animated creature that lives in the corner of your app. It reacts to what you're doing — perks up when you resolve an escalation, naps during idle time, gets excited when emails arrive, and occasionally does random silly things. Feed it by completing tasks. Pure dopamine for long shifts.

### 🥠 Fortune Cookie Break
**Suggested:** Wed, Mar 25, 2026  8:02:06 PM
A hidden hotkey (Ctrl+Shift+F) that dims the screen and shows a beautifully animated fortune cookie that cracks open with a random piece of wisdom, funny quote, or motivational one-liner. A 5-second mental reset during a tough shift.

### Special Feature #185 — Déjà Vu Radar (2026-03-25 8:22 PM)
Is duplicate?: No
Complexity: medium
Special Feature: Déjà Vu Radar — When you paste or parse a new escalation, the AI silently fingerprints the issue description and scans your last 90 days of resolved cases for eerily similar ones. If it finds a match, a subtle "You've seen this before" toast appears with a link to your past resolution — so you can copy-paste your own winning answer instead of solving the same puzzle twice.

### Special Feature #186 — "Panic Button" Quick-Mute Mode (2026-03-26 2:25 PM)
Is duplicate?: No (existing #Panic Button at line 2257 is screen-blanking for privacy — this is activity/notification muting)
Complexity: medium
**Suggested:** Thu, Mar 26, 2026  2:25:16 PM
Special Feature: "Panic Button" Quick-Mute Mode — A single keyboard shortcut (like F9) that instantly mutes all workspace agent activity, notification sounds, and auto-scheduled tasks for a configurable cooldown period. Perfect for when you're deep in a live escalation call-assist and need zero distractions from background agent runs, calendar pings, or email alerts — then everything resumes automatically.

### Special Feature #187 — Mood Ring Status Bar (2026-03-26 3:26 PM)
Is duplicate?: No
Complexity: medium
**Suggested:** Thu, Mar 26, 2026  3:26:40 PM
Special Feature: Mood Ring Status Bar — A thin gradient bar across the top of the app that shifts color based on your work tempo in real-time: cool blue when you're cruising through escalations, warm amber when you've been stuck on one case, pulsing red when your queue is piling up. It also picks up signals from your calendar (meetings coming up) and email volume. At a glance, you know your own "vibe" without checking stats — and it subtly nudges you to take a breath when things are heating up.

### Special Feature #188 — Handwriting Scanner (2026-03-26 3:39 PM)
Is duplicate?: No
Complexity: medium
**Suggested:** Thu, Mar 26, 2026  3:39:42 PM
Special Feature: Handwriting Scanner — Point your webcam at a handwritten sticky note or whiteboard scrawl and the app uses vision AI to transcribe it into typed text, then auto-routes it: if it looks like a case number or COID it opens that escalation, if it's a to-do it adds it to your task flow, if it's a name it searches your Gmail. Your desk clutter becomes instant digital actions with zero typing.

### Special Feature #189 — Screenshot Queue Parser (2026-03-26 4:45 PM)
Is duplicate?: No
Complexity: medium
**Suggested:** Thu, Mar 26, 2026  4:45:39 PM
Special Feature: Screenshot Queue Parser — Drop 3-5 escalation screenshots into the image parser popup at once and it runs them sequentially, stitching the extracted text together with clear dividers before inserting the combined result into the compose box. Perfect for when a phone agent sends a thread of screenshots spanning multiple screens — parse the whole batch in one shot instead of one-at-a-time.

### Special Feature #190 — Smart Model Router Dashboard (2026-03-28 12:49 PM)
Is duplicate?: No
Complexity: medium
**Suggested:** Sat, Mar 28, 2026  12:49:54 PM
Special Feature: Smart Model Router Dashboard — A live panel showing which AI model handles each request as it happens, with a real-time token cost-per-second ticker. The clever part: it auto-detects when you're overspending on a task (e.g., "This image parse used Opus at $0.12 — Qwen could've done it for free") and lets you one-click reassign surfaces to cheaper models with an undo button. A money-saving copilot that watches your AI spending and actively negotiates it down.

### Special Feature #191 — Mood Lighting (2026-03-28 12:57 PM)
Is duplicate?: No
Complexity: low
**Suggested:** Sat, Mar 28, 2026  12:57:41 PM
Special Feature: Mood Lighting — Your app subtly shifts its color temperature throughout the day like f.lux but for the entire UI. Cool blue-whites in the morning for focus, warm ambers in the evening for wind-down — automatic, zero-config, and based on your local time. A small ambient touch that makes the app feel alive and easier on your eyes during late sessions.

### Special Feature #192 — Ambient Soundscapes (2026-03-28 12:59 PM)
Is duplicate?: No
Complexity: low
**Suggested:** Sat, Mar 28, 2026  12:59:21 PM
Special Feature: Ambient Soundscapes — A built-in background sound player (rain, coffee shop, lo-fi beats, white noise) that auto-pauses when you join a calendar meeting and resumes after. Helps you focus during long escalation shifts without needing a separate app or browser tab.
