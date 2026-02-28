# Settings & Features Brainstorm — Consolidated Results

Two senior engineers independently explored the full codebase and brainstormed high-impact settings and features for the Settings area. Strong convergence on top priorities.

---

## Tier 1 — High Impact, Low Effort (build first)

### 1. Chat Defaults

**Settings sidebar name:** Chat Defaults

**What it contains:**
- Default provider picker (Claude / ChatGPT 5.3 Codex) — currently set per-chat in the Chat header but never persisted as a global preference
- Default mode picker (Single / Fallback / Parallel) — stored in localStorage per key but no unified settings UI
- Default fallback provider when mode is Fallback
- Enter key behavior: Send on Enter (Shift+Enter for newline) vs. Send on Ctrl+Enter (Enter for newline)
- Auto-parse on image upload: when an image is pasted, auto-run the parse escalation flow vs. requiring manual click
- Copy format: Copy as Markdown / Copy as Plain Text / Copy as HTML
- Auto-scroll behavior during streaming: Smooth scroll / Jump to bottom / Manual (don't auto-scroll)
- Auto-title conversations: On / Off / Ask-first
- New conversation greeting: Show / Hide the quick-prompts area and welcome text

**Why it matters:** Both engineers flagged this as #1. The localStorage keys already exist — this is just a UI that reads/writes them. Enter key behavior alone prevents dozens of accidental sends per shift. Auto-parse on image upload eliminates the most common 2-step workflow (upload screenshot → click "Parse Escalation") into a 1-step action.

**Implementation complexity:** Low — most are already localStorage values in `useChat.js`. Auto-parse requires wiring the image upload callback in `Chat.jsx` to conditionally trigger `PARSE_ESCALATION_PROMPT`.

---

### 2. AI Behavior

**Settings sidebar name:** AI Behavior

**What it contains:**
- Verbosity slider (3 levels): Concise / Balanced / Detailed — controls how much the AI explains vs. gets straight to the answer
- Tone selector: Professional / Friendly / Direct — shifts the AI's register
- Auto-structure toggle: When ON, AI always returns responses with headers, bullet points, and labeled sections (COID, Steps, Resolution). When OFF, freeform prose
- Response style toggle: Concise vs. Detailed vs. Step-by-step (injected as a system prompt modifier)
- Temperature/creativity slider (if providers support it): "Precise" to "Creative"
- Custom system prompt prefix: A text field where the specialist can prepend custom instructions to every conversation (e.g., "Always include the case number in your first line" or "I specialize in payroll escalations, prioritize payroll knowledge")

**Why it matters:** Every escalation specialist has a different communication style. Some want terse, copy-pasteable bullet points. Others want full explanations they can read to the agent. Today, everyone gets the same AI output. This lets specialists tune the AI to match their personal workflow without typing "be concise" in every message.

**Implementation complexity:** Medium — these translate to system prompt modifications injected before the playbook content in `server/src/services/claude.js`. The verbosity/tone/structure flags get mapped to prompt engineering prefixes. The custom prefix is stored in localStorage or a user preferences collection.

---

### 3. Escalation Defaults

**Settings sidebar name:** Escalation Defaults

**What it contains:**
- Default agent name (pre-fill "agentName" field on every new escalation so they don't retype their name 50 times a day)
- Default category filter on dashboard (e.g., payroll specialist only sees payroll escalations by default)
- Auto-link conversation to escalation: Always / Ask / Never (currently manual via "Link Escalation" button)
- Default escalation status after parsing: Open (current) vs. In Progress
- Required fields before status can change to "Resolved" (e.g., must have resolution notes)

**Why it matters:** An escalation specialist handles 20-40 cases per shift. Entering their own name on every single one is pointless friction. Defaulting the dashboard to their specialty category means they see relevant cases immediately instead of scrolling past irrelevant ones. These small defaults compound into significant time savings over a shift.

**Implementation complexity:** Low — all stored in localStorage. The agent name pre-fill is a simple `defaultValue` prop. Category filter default modifies the existing dashboard filter state initialization.

---

### 4. Notifications & Sound

**Settings sidebar name:** Notifications

**What it contains:**
- Streaming complete sound: play a subtle chime when AI finishes responding (critical when you tab away to read case notes while AI is generating)
- Error alert sound: distinct alert tone when a provider fails or fallback triggers
- Sound volume slider: 0-100%
- Sound selection: 3-4 preset sounds per event (Chime / Pop / Subtle / None)
- Browser desktop notification toggle: show OS-level notification when AI response completes (if tab not focused)
- Fallback notification banner duration: how long the "Fell back from Claude to ChatGPT" banner stays visible (3s / 5s / 10s / Until dismissed)
- Toast auto-dismiss timer (3s / 5s / 10s / manual dismiss)
- Escalation SLA warning: alert when an in-progress escalation has been open longer than X minutes (configurable threshold)

**Why it matters:** Specialists constantly tab away to QBO/Salesforce while waiting for AI. Without audio cues they poll the tab hundreds of times per shift. A simple chime on completion is the #1 quality-of-life improvement for multitasking.

**Implementation complexity:** Low-Medium — `Audio` API for sounds, `Notification` API for OS notifications. Stored in localStorage. Wire into the `onDone` callback in `useChat.js`. SLA warnings need a polling interval against escalation `createdAt` timestamps.

---

## Tier 2 — High Impact, Medium Effort

### 5. Keyboard Shortcuts

**Settings sidebar name:** Shortcuts & Quick Actions

**What it contains:**
- Visual reference card showing all shortcuts
- Configurable hotkeys for:
  - `Ctrl+N` — New conversation
  - `Ctrl+K` — Command palette (fuzzy search all actions)
  - `Ctrl+Enter` — Send message
  - `Esc` — Abort streaming response
  - `Ctrl+Shift+P` — Toggle provider (Claude/ChatGPT)
  - `Ctrl+1-7` — Jump to nav item (Chat, Dashboard, Playbook, Templates, Analytics, Dev Mode, Settings)
  - Copy last AI response
  - Retry last response
  - Quick Prompt 1/2/3/4
- Enable/Disable global shortcut listener
- Conflict detection if two shortcuts overlap
- Quick Actions bar toggle: Show/hide a command-palette style bar (`Ctrl+K`) that lets you fuzzy-search all actions

**Why it matters:** The app currently has zero keyboard shortcuts. Specialists are on the phone — every mouse movement is a context switch. Both engineers ranked this as the single biggest ergonomic win for power users. A single `Ctrl+K` command palette would dramatically reduce navigation friction.

**Implementation complexity:** Medium — global `useEffect` keydown listener at the `App` level. Command palette is a modal with fuzzy search over a registry of actions. localStorage persistence for rebinding.

---

### 6. Quick Prompts & Smart Compose

**Settings sidebar name:** Quick Prompts

**What it contains:**
- Editable list of the 4 current quick prompts (Parse Escalation, Draft Response, Categorize Issue, Suggest Troubleshooting) — currently hardcoded in `Chat.jsx` as `QUICK_PROMPTS`
- Add/remove/reorder custom quick prompts
- Smart Compose toggle (enable/disable the ghost text autocomplete)
- Custom smart compose entries — specialists can add their own prefix-completion pairs
- Per-prompt variable support (e.g., `{{coid}}` auto-fills from the linked escalation)

**Why it matters:** Different specialists handle different categories. A payroll specialist wants quick prompts like "Check vacation accrual calculation" and "Verify direct deposit routing" — not the generic ones. These 4 buttons are the most-clicked UI elements. Making them customizable is high leverage.

**Implementation complexity:** Medium — quick prompts need a CRUD UI with drag-reorder, plus storing to localStorage. Smart compose toggle is trivial. Custom entries need a simple key/value editor.

---

### 7. Templates & Playbook Preferences

**Settings sidebar name:** Templates & Playbook

**What it contains:**
- Favorite/pin templates: pin frequently-used templates to the top of the template library and surface them as quick actions in chat
- Default template variables: pre-fill common variables (agent name, dept, callback number) so they don't have to be entered every time
- Default signature block: appended to every template response (name, title, extension number)
- Playbook category priority: drag-to-reorder which playbook categories appear first in co-pilot suggestions (e.g., payroll specialist puts "payroll" at the top)
- Playbook auto-suggest: when typing a category keyword in chat, show a tooltip with relevant playbook entries
- Response formatting preference: Bullet points / Numbered steps / Paragraphs

**Why it matters:** The Template Library already has a variables system (`listTemplates`, `trackTemplateUsage`). But every specialist has to fill in the same personal variables every time. Pre-setting these in settings means one-click template insertion with their name, department, and contact info already populated.

**Implementation complexity:** Low-Medium — variable defaults stored in localStorage. Signature block is string concatenation at template render time. Favorite pinning needs a localStorage set of template IDs.

---

### 8. Layout & Density

**Settings sidebar name:** Layout

**What it contains:**
- Information density: Comfortable / Compact / Ultra-compact — adjusts padding, spacing, font size, and card height globally
  - Comfortable: current default, generous whitespace
  - Compact: tighter padding, smaller gaps, more content visible per screen
  - Ultra-compact: minimal padding, smaller text, maximum information density
- Sidebar behavior: Always open / Auto-collapse on narrow screens / Start collapsed
- Chat message width: Narrow (60ch) / Medium (80ch) / Wide (100ch) / Full width
- Co-pilot panel position: Right rail / Bottom panel / Floating window / Hidden
- Quick prompts position: Above input / Below input / Hidden
- Conversation list density: Compact (title only) / Default (title + time + count) / Detailed (+ first message preview)
- Default landing page: Chat (current) / Dashboard / Analytics

**Why it matters:** Specialists on 1080p monitors versus ultrawide monitors have completely different density needs. Someone on a 13" laptop wants compact mode. Someone on a 34" ultrawide wants wide messages with the co-pilot on the right rail. Compact mode shows ~60% more content per screen.

**Implementation complexity:** Medium — density maps to CSS custom property overrides (multiply spacing tokens). Sidebar behavior requires state in `App.jsx`. Chat width is a `max-width` CSS var.

---

## Tier 3 — Medium Impact, Important for Maturity

### 9. Shift & Session

**Settings sidebar name:** Shift & Session

**What it contains:**
- Shift start/end button in the top bar (configured here in settings)
- Shift duration preset: 8hr / 10hr / Custom
- Break reminder interval: Every 60min / 90min / 120min / Off — subtle visual nudge (pulsing dot, not a modal)
- Shift summary toggle: when ending shift, auto-generate a summary of escalations handled, avg resolution time, categories touched, unresolved items
- Auto-pause detection: if idle for 15+ minutes, pause the shift clock
- Session timeout: auto-logout after X minutes of inactivity (for shared workstations in call centers)

**Why it matters:** Escalation specialists work fixed shifts and need to track throughput for performance reviews and team handoffs. The shift summary is especially valuable for handoff notes ("Here's what I worked on today, here's what's still open"). Session timeout is required for shared call center workstations.

**Implementation complexity:** Medium — shift state in localStorage with a `ShiftContext` provider. Summary uses existing analytics API endpoints scoped to shift window. Break reminders are `setInterval` with a notification component.

---

### 10. Profile / Identity

**Settings sidebar name:** Profile

**What it contains:**
- Display name (used in default agent name, template variables, conversation labels)
- Role / Title (shown in About section, used in template signatures)
- Department / Team (used for analytics filtering — "show me only my team's metrics")
- Shift hours preference (what counts as "today" for night-shift workers)
- Avatar/initials (shown next to user messages in chat)

**Why it matters:** The display name flows into multiple features (agent name on escalations, template variables, analytics leaderboard). Setting it once eliminates repeated data entry across the app.

**Implementation complexity:** Low-Medium — profile data stored in localStorage. Most fields feed into existing features as default values.

---

### 11. Performance & Animations

**Settings sidebar name:** Performance

**What it contains:**
- Animation speed: Full / Reduced / None — makes `prefers-reduced-motion` an explicit user choice independent of OS
- Streaming render interval: Realtime (every chunk) / Batched (every 100ms) / Batched (every 250ms) — for slower machines
- Preload conversations: On / Off — whether to eagerly load recent conversation content or lazy-load
- Auto-scroll behavior during streaming: Smooth scroll / Jump to bottom / Manual

**Why it matters:** The app uses Framer Motion on every view transition and real-time SSE streaming that re-renders on every text chunk. On low-end machines this causes visible lag. Giving users control over animation and streaming granularity directly impacts perceived performance. The auto-scroll behavior is a specific pain point: some specialists want to read previous messages while AI is still streaming.

**Implementation complexity:** Low — animation speed maps to existing `shouldReduceMotion` logic. Streaming batch uses `setTimeout` debounce in `useChat.js` `onChunk`. Auto-scroll is a flag in the scroll-to-bottom effect.

---

### 12. Accessibility

**Settings sidebar name:** Accessibility

**What it contains:**
- Reduced motion toggle (explicit override, independent of OS setting)
- High contrast mode: overrides the selected theme with maximum-contrast colors
- Focus indicator style: Default / High-contrast ring / Bold outline
- Color blind mode: Deuteranopia / Protanopia / Tritanopia adjustments to status badge colors (red/green is problematic for ~8% of male users)
- Chat font family: System default / Monospace / Dyslexia-friendly (OpenDyslexic)
- Line spacing adjustment: Compact / Default / Relaxed (independent of text size)
- Screen reader verbosity: Standard / Verbose (announce provider, mode, response time with each message)

**Why it matters:** Escalation centers have diverse teams. Color blindness affects the red (escalated) vs. green (resolved) status badges — a critical distinction in this app. High-contrast mode helps under harsh fluorescent office lighting during long shifts. Required for enterprise ADA compliance.

**Implementation complexity:** Medium — reduced motion override is a CSS class toggle. High contrast adjusts CSS custom properties. Color blind mode requires alternative status palettes. Most changes are CSS-only.

---

### 13. Data & Privacy

**Settings sidebar name:** Data & Privacy

**What it contains:**
- Conversation auto-cleanup: Delete conversations older than X days (7 / 30 / 60 / 90 / Never)
- Export all data: download all conversations, escalations, and templates as JSON or CSV archive
- Clear all conversations (with confirmation modal)
- Clear all escalation data (with confirmation modal)
- Image retention: Keep uploaded images / Delete after processing — for sensitive customer data (COID/MID screenshots)
- Anonymize on export: auto-redact COID, MID, case numbers, customer names when exporting
- Conversation history limit: maximum messages per conversation before oldest are pruned

**Why it matters:** Over months of daily use, the database accumulates thousands of conversations with PII and financial information. Specialists need control over how long this data persists. Bulk export supports end-of-quarter reporting. Compliance teams need purge capability.

**Implementation complexity:** Medium — auto-cleanup needs a server-side TTL index or cron. Export extends existing single-conversation export. Clear-all uses existing `deleteConversation` in a batch.

---

### 14. AI Provider Health & Configuration

**Settings sidebar name:** AI Providers

**What it contains:**
- Provider health dashboard: live status of Claude CLI and ChatGPT Codex connectivity (uses existing `provider-health.js`)
- Default timeout: how long to wait before considering a provider failed (currently hardcoded)
- Fallback behavior: Automatic / Manual (ask me) / Disabled
- Parallel mode default action: Auto-pick best / Always ask me to choose
- Response length preference: Short / Medium / Long — maps to max token hints
- Provider preference by category: route payroll escalations to Claude, bank-feed escalations to ChatGPT — per-category routing

**Why it matters:** The multi-provider system is one of the app's most sophisticated features, but users have zero visibility into provider health and zero control over routing. A specialist who learned that Claude is better at payroll but ChatGPT is better at bank feeds should encode that preference once.

**Implementation complexity:** High — provider health dashboard needs a polling endpoint. Category-based routing needs a routing rules engine in `chat-orchestrator.js`. Simpler settings (fallback behavior, parallel action) are client-side state.

---

## Engineer Consensus (independently proposed by both)

These ideas appeared in both brainstorms — strongest signal:
- Chat defaults (provider/mode persistence)
- Keyboard shortcuts / command palette
- Notification sounds (chime on AI completion)
- Quick prompt customization
- Template variable pre-fills
- Accessibility overrides (reduced motion, high contrast)
- Data cleanup / export

---

## Recommended Build Order

**Phase 1 (quick wins):** Chat Defaults, AI Behavior, Escalation Defaults — all Low complexity, stored in localStorage, immediate daily impact

**Phase 2 (power users):** Keyboard Shortcuts, Notifications, Quick Prompts — transforms the workflow for 8-hour shifts

**Phase 3 (polish):** Layout & Density, Profile, Templates, Performance — makes it feel like "my workspace"

**Phase 4 (enterprise):** Shift & Session, Accessibility, Data & Privacy, Provider Health — maturity features for team adoption and compliance
