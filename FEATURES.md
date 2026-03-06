** -------------------- User Notes -------------------- **
-see if an endpoint is trending slower or just had a one-off spike.
-tool events panel, context debug viewer, maybe the copilot panel.
-automatically send bugs to in app claude developer
-find way to have in app claude monitor chrome dev tools for all issues and act immediately
** ------------------ End User Notes ------------------ **

# Unique Special Feature Ideas & Suggestions

## Sidebar & Navigation

- Add a subtle expand-on-hover behavior to the collapsed sidebar — hovering over it temporarily reveals the full sidebar content (like VS Code's auto-hide sidebar) without requiring a click, then it slides back when the cursor leaves.

- Add keyboard shortcut support (e.g., `[` to toggle sidebar collapse) with a visual shortcut hint badge on the collapse button, configurable through a new Keybindings section in Settings.

- Add a "pin" icon that appears in the hover-expanded state — clicking it permanently un-collapses the sidebar (pins it open) without the user needing to understand the collapse toggle's dual behavior.

- Add a "peek mode" — holding Shift while hovering the collapsed sidebar shows a translucent preview of the conversation list without fully expanding, useful for quick glances without disrupting layout.

- Add a visual "slide" transition to the hover expand/collapse — a smooth width animation with a subtle content fade-in, so the sidebar glides open rather than snapping.

- Add drag-to-reorder for the sidebar navigation items, so users can customize which pages appear first — persisted to localStorage.

- A "request heatmap" overlay on the sidebar nav items — each view (Chat, Dashboard, etc.) could show a subtle heat gradient based on how many API calls that view triggered in the last session, so you can spot which views are the most network-hungry at a glance.

## Settings & Configuration

- Add a "compact mode" toggle in the Layout settings that reduces sidebar padding and font sizes across all nav items, giving power users more vertical real estate for the conversation list.

- Add responsive breakpoint awareness to the Layout settings — show the current active breakpoint (Desktop/Tablet/Mobile) as a live badge, and let users customize the breakpoint thresholds.

- Keyboard shortcut overlay — press `?` anywhere to see a cheat sheet of available keyboard shortcuts (like GitHub's shortcut panel), dismissible with Escape.

- Add a Settings search/filter that lets users quickly find settings by keyword (e.g., type "text" to find Typography, type "ai" to find AI Assistant). Would help power users navigate faster.

- A "settings diff" view — when you change any setting, a subtle "Unsaved" pill appears showing how many values differ from defaults, with an expandable popover listing before/after for each change and a one-click "Reset to defaults" action.

## Chat & Conversation UI

- Add a conversationMutated CustomEvent that useChat dispatches on send/delete/accept, and Sidebar listens for — gives sub-second sidebar refresh after sending a message without any polling, and lets you push the idle interval even higher (60s+).

- Auto-resize the compose card's minimum height based on context — single-line when fresh, expanding slightly when the conversation has replies so the input feels proportional to the content weight. Keeps the UI feeling light at the start and more "ready for work" mid-conversation.

- Show a faint character count or token estimate near the send button that only appears once the input gets long (e.g. 200+ chars), giving a sense of how much context is being sent without cluttering short messages.

- Add a message timestamp hover card — when you hover over the timestamp on any dev message, show a mini popover with the full datetime, provider used, token count, and cost. Gives you quick diagnostics without cluttering the default view.

- Add a "Retry" button on orphaned user messages that re-sends the exact same prompt without needing to edit. One click to just try again — useful when the abort was accidental or you just want to re-run the same prompt with a different provider.

- Add keyboard shortcuts for orphaned message actions — when an orphaned user message is showing, pressing R retries, E edits, and Escape or D deletes. Saves a click when you're in flow and just want to quickly recover from an abort.

- Add conversation branching from any message — right-click or long-press any user message to fork the conversation from that point, creating a new session with all prior context but letting you take a different direction. Like git branching for your dev chat history.

## Error Handling & Recovery

- Add a small "HMR desync detected — click to refresh" toast that catches these React hook invariant violations in dev mode and offers a one-click full reload, so you don't have to open devtools to diagnose phantom crashes.

- Add a "session recovery" layer — when the error boundary catches, serialize the current conversation ID and draft input to sessionStorage before showing the fallback, so after reload the app auto-restores the conversation they were in with their unsent message pre-filled. Turns a crash from "lost my place" into "picked up where I left off."

- Add a "safe reload" button that saves the current chat input text and scroll position to sessionStorage before reloading, then restores them on mount — so HMR recovery doesn't lose your draft message.

## Network & Request Waterfall (Dev Panel)

- Add a request waterfall visualizer to the dev panel — shows in-flight API requests with timing bars so you can spot pileups without opening browser DevTools.

- Add a "health pulse" status dot to the sidebar header — green/yellow/red based on the last 3 conversation-list response times, so you can see backend degradation at a glance before it becomes a full storm.

- Add a "slow query" warning banner that surfaces when the conversation list endpoint responds in >3s — visible to the user so they know it's backend latency, not a UI bug.

- Add a visibilitychange listener that immediately fires a poll when the tab regains focus — gives instant refresh when switching back from another tab instead of waiting for the next poll tick.

- Expose the circuit breaker state as a tiny status indicator in the sidebar footer — a dot that turns amber/red when the circuit is open, so the user knows the backend is degraded without needing DevTools.

- Add request latency heatmap coloring to the waterfall bars — instead of a uniform green/accent color for completed requests, shade the bar from green (fast) through yellow to red (slow) based on where the duration falls relative to the p50/p95 of all recorded requests. Gives you an instant visual gradient of your API health without reading individual numbers.

- Add a request timeline ruler — thin horizontal time markers at the top of the waterfall (0s, 1s, 2s...) that auto-scale with the window duration, giving you an instant sense of absolute timing without reading individual bar labels.

- Add a request body inspector — click a row to expand it and see the parsed JSON request body and response status details in a collapsible detail pane, so you can debug what was actually sent without opening browser DevTools.

- Add an endpoint performance sparkline — a tiny inline chart next to each grouped endpoint showing its last 20 response times as a mini line graph.

- Add a connection quality indicator to the edge tab — a tiny 3-bar signal strength icon (like WiFi bars) next to the LED that reflects the circuit breaker state: 3 bars = healthy, 2 = degraded (some failures), 1 = half-open, 0 = circuit open. The bars would animate in/out with the same glow treatment as the LED.

- Add a network health sparkline to the edge tab — a tiny 20px-wide inline SVG that draws the last 10 request durations as a mini line chart, giving you a quick glance at whether response times are trending up or down without opening the waterfall panel.

- Unique feature: Add a request budget indicator to the network waterfall panel — a small gauge showing "X/Y concurrent requests" with the single-flight max and circuit breaker state, so developers can see at a glance whether the containment mechanisms are active during debugging sessions.

- Add a waterfall export button — one click to copy the current request history as a HAR-like JSON or CSV to clipboard, so you can paste it into a Slack thread or performance ticket without manual transcription.

- Add a "request replay storm" simulator button to the waterfall toolbar — when clicked, it fires 20 rapid identical GET requests to /api/conversations to intentionally trigger the single-flight dedup and circuit breaker, letting developers visually verify the containment mechanisms are working without needing to reproduce the original bug conditions.

- Add request deduplication detection — if the same endpoint + method is called within 100ms, show a visual indicator (e.g., duplicate badge, color pulse) to help spot accidental double-submits. Would help catch race conditions and user double-clicks.

- Add a waterfall request diff view — select two request rows and see a side-by-side comparison of their timing breakdown (TTFB, body transfer, total), response status, and duration delta. Useful for comparing before/after when you replay a request to check if a slow endpoint has recovered.

- Add request timeline heatmap — visual mini-chart showing request frequency over time (horizontal bar with density gradient). Users can quickly see if there's a burst of requests or a steady stream, helping diagnose polling loops vs. user-triggered actions.

- Add a "request timeline sparkline" to the Sidebar's circuit breaker indicator — a tiny 60px inline SVG showing the last 30 seconds of request activity as a miniature bar chart (one bar per second, height = request count, color = success/error ratio). Gives at-a-glance API health without opening the full waterfall panel.

- A "request fingerprint" — each API endpoint gets a unique tiny geometric pattern (like a GitHub-style identicon) rendered inline in the waterfall rows, making it instantly scannable which endpoint a row belongs to without reading the text.

- A "slow endpoint spotlight" — when any grouped endpoint's p95 exceeds the slow threshold, the grouped row gets a subtle pulsing amber border and a flame icon, making performance regressions impossible to miss without opening each row.

- A "request replay queue" — shift-click multiple completed requests to queue them, then hit a "replay all" button that fires them in the original sequence with original timing gaps, useful for reproducing race conditions or load patterns.

- Network health score — a single 0-100 number at the top of the panel that combines error rate, average latency, and circuit status into one "is my app healthy?" grade. Green 80+, amber 50-79, red below 50. No dev knowledge needed to understand "87 = good."

- Slow request auto-diagnosis — when you click a red/slow row, a popover tells you in plain English what likely caused the delay: "This request sent a large image (2.4MB body)" or "The server took 1.2s — this usually means Claude AI is thinking" or "100 calls to this endpoint — the app may be calling it in a loop."

- Request replay comparison — click any row to "pin" it, then replay the same request. The pinned and replayed results appear side-by-side showing the time difference, so you can instantly see if a slow request was a fluke or a consistent problem.

## Flame Bar & Performance Monitoring

- Add a dev-only performance flame bar that shows a thin horizontal strip at the top of the viewport during each React render cycle — color-coded green/amber/red by render duration — so you can spot janky re-renders without opening devtools profiler.

- Add a "snapshot" button to the flame bar that freezes the current segment strip as a PNG to clipboard — useful for pasting into Slack/Discord when reporting a jank spike to teammates.

- Add a "pause" button to the flame bar that freezes segment collection without unmounting — useful when you want to inspect a specific burst without new renders pushing segments off the strip.

- Add a "clear" button (trash icon) to the flame controls that wipes the segment buffer and resets the stats counters — handy for starting a clean measurement session without refreshing the page.

- Add keyboard shortcuts for the flame bar controls — Ctrl+Shift+P to toggle pause, Ctrl+Shift+K to clear, Ctrl+Shift+E to expand/collapse — so you can freeze a burst without moving the mouse to the tiny buttons.

- Add a tiny "last HMR reload" timestamp in the flame bar stats area that shows when the last auto-recovery happened (e.g., "reloaded 12s ago"), fading out after 30s — gives you awareness of reload frequency without cluttering the dev console.

- Flame bar heatmap timeline — a minimap strip showing render density over the last 60 seconds, colored by tier, so you can spot render storms at a glance even after segments fade out.

- Flame bar render storm alerts — when the timeline detects 3+ consecutive red seconds, flash a subtle amber badge next to the stats that says "storm detected" with a click to auto-pause and snapshot the timeline for postmortem analysis.

- A "hook health" indicator in the FlameBar that counts total hooks per render and flags when the count changes — would've caught this instantly during dev.

- Add a "peak render" indicator — a small persistent badge showing the worst single render time in the session (e.g., "peak 142ms") that turns red and briefly pulses when a new record is set. Useful for spotting performance regressions during development without staring at the bar.

## Advanced Features

- A "session replay" mode that takes JSONL format and renders it as an interactive timeline in the browser — you could scrub through tool calls, expand/collapse responses, and see token costs per turn. Like a flight recorder for Claude Code sessions.

** ADD SPECIAL FEATURES BELOW THIS LINE **

## Use this format for adding

Date: todays date
Time: AST you posted the feature
Model: what model you are
Is duplicate?: yes or no
Special Feature: summarize the special feature here

---

### Special Feature #17

Date: 2026-03-06
Time: 14:53 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Background Task Activity Feed — a real-time scrolling feed in the DevMiniWidget showing every autonomous action the dev agent takes as it happens: errors caught, files reviewed, fixes applied, idle scans completed. Each entry is a one-line summary with timestamp and status icon. Clicking expands to show the full agent response. Unlike Agent Memory Replay (historical timeline), this is a live feed — like a CI build log for your dev agent. Shows the agent working in real-time so the user trusts it's actually doing something.

---

### Special Feature #16

Date: 2026-03-06
Time: 14:50 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Contextual Getting Started Breadcrumb Trails — when an empty state is showing on any page (no escalations, no templates, etc.), render a subtle pulsing arrow or highlight pointing toward the action that populates it (e.g., the chat input for escalations, the "New Template" button for templates). The animation uses CSS keyframes with a gentle pulse, and auto-removes itself once the first item appears. Zero-config — works purely from the existing empty state detection logic.

---

### Special Feature #15

Date: 2026-03-06
Time: 15:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook AI Summary Digest — a daily/weekly auto-generated notification summarizing all playbook changes since the last digest. Uses Claude to read git diffs of playbook/ files and produce a plain-English summary of what changed and why it matters, highlighting categories that lost content. Specialists get a 3-sentence briefing instead of reviewing diffs. Configurable frequency in Settings.

---

### Special Feature #14

Date: 2026-03-06
Time: 14:22 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Playbook Version Diff Comparison — add a "Compare" toggle in the History panel that lets the user select two versions and see a unified diff between them (reusing the existing computeDiff utility). Instead of previewing one version at a time, users can trace exactly when a specific rule was added or removed across multiple saves. Select two checkboxes, click "Compare", and see the LCS diff inline with green/red highlighting.

---

### Special Feature #13

Date: 2026-03-06
Time: 14:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Agent Memory Replay — a timeline view in the DevMode sidebar that lets you scrub through the agent's DevAgentLog chronologically. Each entry shows what triggered it (error, review, scan), what files were affected, and what the agent did. Clicking an entry opens the conversation where it happened. Like git log but for the agent's autonomous work — gives a bird's-eye view of everything the agent has done across all conversations.

---

### Special Feature #12

Date: 2026-03-06
Time: 14:10 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dev Agent Health Dashboard — a compact panel in the DevMiniWidget that shows the agent's current "awareness level": system prompt loaded (yes/no), CLAUDE.md version hash, file tree freshness (last generated timestamp), session resume active (yes/no), auto-error circuit breaker state (open/closed/trips remaining), and background task queue depth. One glance tells you whether the agent is operating at full capability or flying blind. Turns invisible infrastructure into visible confidence.

---

### Special Feature #11

Date: 2026-03-06
Time: 14:05 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Dev Mode Auth Gate — a simple passphrase/token gate middleware for all /api/dev/* endpoints. On first Dev Mode visit, the UI prompts for a passphrase (stored server-side in .env as DEV_MODE_SECRET). Valid tokens are cached in a short-lived httpOnly cookie so subsequent requests pass through silently. Prevents the critical security gap where /file and /tree endpoints expose the entire project filesystem to anyone with network access — without adding a full auth system. One env var, one middleware, zero database changes.

---

### Special Feature #10

Date: 2026-03-06
Time: 13:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook Version Timeline — a visual timeline in the PlaybookEditor showing when each playbook markdown file was last modified, by whom, and what changed. Renders as a horizontal scrollable lane-chart where each playbook category is a row and modification events are dots on the timeline. Hovering shows diff summary, clicking opens full before/after. Helps specialists spot stale escalation guidance without digging through git history.

---

### Special Feature #9

Date: 2026-03-06
Time: 09:35 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Request Dedup Hit Counter — a small badge on the waterfall panel toolbar showing how many times the single-flight dedup prevented duplicate requests in the current session. Clicking it expands a breakdown by endpoint, so developers can see which views trigger the most concurrent duplicate calls. Helps identify components that need memoization or effect cleanup, and validates that the dedup mechanism is earning its keep.

---

### Special Feature #8

Date: 2026-03-06
Time: 11:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Escalation Knowledge Gap Detector — an automated system that analyzes resolved escalation conversations to find topics where the AI assistant struggled or gave low-confidence answers. Cross-references against existing playbook categories to surface missing documentation. Generates a weekly "knowledge gap report" showing: topics with high re-escalation rates, questions where Claude hedged or disclaimed, and playbook categories with zero hits despite related escalations existing. Helps the team proactively author playbook content where it matters most.

---

### Special Feature #7

Date: 2026-03-05
Time: 10:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Skill Auto-Trigger Debugger — a dev panel overlay that shows in real-time which skills Claude considered auto-triggering for the current prompt. Displays matched description keywords, confidence score, and whether the skill was loaded or skipped. When a skill misfires (false positive) or fails to trigger (false negative), one-click buttons let you refine the description directly from the debug panel. Surfaces the invisible skill matching process so you can tune descriptions without guessing.

---

### Special Feature #6

Date: 2026-03-04
Time: 14:30 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Skill Health Dashboard — a dev-only panel that visualizes which `.claude/skills/` are actually firing in sessions. Shows activation count per skill, auto-trigger vs manual invocation ratio, average token cost per invocation, and flags skills with 0 activations in the last 7 days as candidates for removal. Helps teams prune bloated skill collections before hitting the startup performance cliff (~2.3s penalty at 100+ skills).

---

### Special Feature #5

Date: 2026-03-04
Time: 13:15 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook Confidence Heatmap — overlay the playbook categories view with a color-coded confidence score showing how well-covered each escalation topic is. Green for rich content, amber/red for sparse categories. Clicking a low-confidence category opens a "contribute" prompt for specialists to add missing knowledge. Visually identifies knowledge gaps in the escalation playbook at a glance.

---

### Special Feature #6

Date: 2026-03-06
Time: —
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Playbook Version Tagging — when the user clicks "Confirm Save" in the diff panel, show an optional short text field ("Add a note, e.g. 'added 2024 payroll rules'"). The note is stored alongside the snapshot filename (e.g. as a sidecar `<ts>.label` file). The History panel then shows human-readable labels next to each version's timestamp, making it easy to find meaningful saves without guessing from dates alone. Label is always optional — saving without one works exactly as before.

---

### Special Feature #5

Date: 2026-03-06
Time: —
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Playbook Cross-Category Search — a search bar at the top of the PlaybookEditor sidebar that queries all categories simultaneously and returns highlighted excerpts showing where the term appears across every guide. Results grouped by category with a snippet preview; clicking a result loads that category and scrolls to the match. Lets new specialists and QBs quickly find relevant guidance without knowing which category to check — especially useful when an issue spans multiple areas (e.g., "1099" might hit both payroll and tax).

---

### Special Feature #4

Date: 2026-03-04
Time: 12:00 AST
Model: Claude Opus 4.6
Is duplicate?: No
Special Feature: Playbook Diff Viewer — when a playbook markdown file is updated, show a before/after diff overlay in the PlaybookEditor so specialists can see exactly what changed in escalation guidance. Highlights added/removed lines with green/red shading, includes a "review changes" toggle, and optionally pings the chat AI to summarize the impact of the update. Helps teams stay current on evolving procedures without re-reading entire documents.

---

### Special Feature #3

Date: 2026-03-01
Time: 15:05 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Escalation Replay Mode — a timeline scrubber in EscalationDetail that lets you replay a resolved escalation step-by-step, showing agent messages, AI suggestions, and playbook hits at each moment. Useful for training new specialists by walking through how a past case was handled.

---

### Special Feature #2

Date: 2026-03-01
Time: 14:30 AST
Model: Claude Sonnet 4.6
Is duplicate?: No
Special Feature: Dev Mode System Prompt Editor — a collapsible panel in the Dev Mode UI where you can write and save a persistent system prompt that gets injected via `--system-prompt` on every dev Claude spawn. Currently, the in-app Claude has zero role awareness, no project context, and no behavioral rules. This feature fixes that: the prompt is stored in MongoDB (or localStorage), sent to the server with each `/api/dev/chat` request, and appended as `--system-prompt` to the Claude CLI invocation. Could ship with a starter template like "You are a coding assistant for this QBO escalation app. You have access to the full project at PROJECT_ROOT..."

---

### Special Feature #1

Date: 2026-03-01
Time: 10:45 AST
Model: Claude Haiku 4.5
Is duplicate?: No
Special Feature: Add conversation search with AI semantic matching — a search bar in the Sidebar that lets users find past conversations by meaning (e.g., "help with auth flow") instead of just keyword matching. Uses Claude CLI to understand search intent and rank MongoDB conversations by semantic relevance, making knowledge discovery instant without remembering exact phrases. Implemented as: search input in Sidebar header → useConversationSearch hook → POST /api/conversations/search endpoint → conversationSearch service using Claude subprocess for intent matching.
