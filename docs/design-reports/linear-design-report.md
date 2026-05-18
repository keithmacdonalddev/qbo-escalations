# designer-linear — V4 report

**Slug:** `linear`
**File:** `prototypes/escalation-chat-challenge/v4/linear/index.html`
**Forced angle:** Terminal / CLI-like (iterm + tmux, not VS Code)

## The core bet

V3 lost on cognitive overload. The terminal angle is uniquely suited to V4's
brief because a terminal has *one* surface, *one* input, and a strict reading
order (top to bottom, in time). Operators don't scan a dashboard — they read
a log. That's the calm V4 is asking for, structurally enforced, not
aesthetically applied.

I took the angle the rest of the way: no panels, no chrome, no graphics, one
accent color (green) used only semantically. The expert ("Mara") arrives in
the same stream as everything else but with a distinct voice color and a
left-rule — a person, not a daemon.

## 2 features (third killed)

1. **Hotkey command-line.** Single input bar at the bottom drives the whole
   workflow. `u` upload, `a` accept, `d` doubt, `c` copy last answer, `?`
   help. Empty input → keys fire raw. Non-empty input → free-text question
   to the analyst on Enter. One mental model for everything. State-aware
   hint strip on the right of the bar shows only the keys that matter right
   now, so the operator never has to remember what's available.
2. **Single-pane log.** Parser, triage verdict, INV matches, and analyst
   stream all write into the *same* scrolling, timestamped surface in time
   order. No competing panels, no eye-jumping. The triage verdict gets a
   thin green left-rule; the analyst gets a thin blue-grey left-rule and a
   typing cursor. Otherwise plain text.

**Killed feature** (the third I wanted): a side "evidence stack" pinning
parsed fields and INV hits next to the chat. Tempting, but it broke the
single-surface promise and would have re-introduced the V3 sin of two loud
places at once.

## Region justification (per user goal)

| Region        | Serves                                              |
| ------------- | --------------------------------------------------- |
| Header strip  | G1 — case id + live state at a glance, never moves  |
| Log pane      | G1, G2, G3 — entire workflow renders here in order  |
| Command bar   | G2, G3, G4 — confirm/doubt, ask, copy               |

Nothing else is visible. Hints inside the command bar change with state so
the operator never has to remember what's available now.

## Self-check (per CHALLENGE-PROMPT)

1. **Zero-explanation usable?** Yes. The hint strip names the only keys
   that matter right now. The first log line tells you to press `?` or `u`.
2. **Eyes-closed-for-a-second safe?** Yes. The log is append-only with
   timestamps. Nothing scrolls off-screen on its own. Coming back, just
   read down from where you left off.
3. **≤ 2 features?** Yes (hotkey CLI + single-pane log).
4. **Forced angle structural?** Yes. The terminal isn't a skin; it *is*
   the layout (one stream, one input). Hotkeys are the interaction model,
   not a bolt-on shortcut layer.
5. **Anything visible not serving a goal?** No. Even the clock is
   debatable; I kept it because operators batch cases against SLA windows
   and a wall-clock on screen is genuinely used.
6. **Quiet at all times?** Yes. One accent color, used semantically. The
   only motion is the analyst's typing cursor and a one-shot "copied"
   fade.
7. **Analyst the only loud thing when speaking?** Yes. The analyst block
   has the only non-default voice color (light blue-grey) and the only
   blinking cursor. Triage verdict is static after print.

## Warmth without UI

The brief warned: *"keep it warm enough to feel like the expert is a
person, not a daemon."* Moves:

- The analyst joins with a named line: `Mara joined · senior payroll
  analyst · 6yr`. Identity, not "AI assistant."
- Prose is conversational ("Hey — I read the ticket…"), reads like a
  senior coworker, not a knowledge-base snippet.
- Follow-up replies trade in opinions and gotchas ("Don't re-attempt
  today. ACH windows are closed past 5pm ET.") — human texture.
- Typing speed (3 chars per 22ms) lets you read along, not just receive.

## What I'm worried about

- **Color-blind operators on the green accent.** Mitigated by also using
  text labels (`VERDICT`, `●` vs `○` for INV hits) rather than color
  alone.
- **Discoverability of free-text vs hotkeys.** Placeholder copy and the
  hint strip both reference it; `?` prints a full key list. I think it's
  enough but a real user test would tell.
- **Terminal aesthetic risk:** could read as "developer toy" to a
  non-technical specialist. I leaned on calm whitespace, generous
  line-height, and a soft foreground color (`#c8d0c8`, not `#fff`) to
  keep it from feeling harsh.
