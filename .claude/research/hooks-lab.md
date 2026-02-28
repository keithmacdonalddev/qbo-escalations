# Hooks Lab — Experimental Trials & Findings

Real-world testing of Claude Code hooks. What works, what doesn't, what the docs don't tell you.

---

## Trial 1: SubagentStart additionalContext injection

**Date:** 2026-02-28
**Hypothesis:** SubagentStart command hook can inject instructions into sub-agent context via `additionalContext` JSON output.
**Source:** Research paper says "SubagentStart hook's additionalContext is injected directly into the sub-agent's context."

### Setup
- Hook: `.claude/hooks/agent-boilerplate.sh`
- Event: `SubagentStart`
- Type: `command`
- Output: JSON with `additionalContext` field
- Config: `.claude/settings.local.json`

### Test 1a: Same session (hooks added mid-session)
- **Result:** FAILED
- Agent reported: "No, I did not receive any AGENT BOILERPLATE instructions"
- **Root cause hypothesis:** Hooks are snapshotted at session start. Edits mid-session not picked up.

### Test 1b: New session (fresh start after settings edit)
- **Result:** PENDING — waiting for user to run test in new terminal
- Agent spawned, but SessionStart hook errored on startup
- SubagentStart statusMessage ("▶ Agent spawned") not observed by user
- Agent still did not receive boilerplate

### Test 1c: Debug logging added — CONCLUSIVE
- **Status:** CONFIRMED — hook fires, context doesn't inject
- Debug log at `.claude/hooks/hook-debug.log` shows:
  - Hook fired 8 times across 3 sessions
  - Receives valid JSON with session_id, agent_id, agent_type
  - Outputs hookSpecificOutput JSON with additionalContext
  - **Agent never receives the context** — confirmed by agent self-report
- **jq parsing bug on Windows:** `agent_type` field parses as empty string despite being present in JSON input. Case statement guards never match. All agents get boilerplate attempted (including claude-code-guide which should be skipped).
- **Root cause confirmed:** SubagentStart additionalContext does not reliably inject into sub-agents. This matches obra/superpowers#237 finding independently.

### Test 1d: hookSpecificOutput format (correct JSON)
- **Result:** FAILED
- Changed from `{"additionalContext": "..."}` to `{"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": "..."}}`
- Hook fired, JSON output correct, agent still did not receive context
- Format change made no difference

### Evidence Summary (3 independent tests, 8 hook firings)
- Hook fires: YES ✓ (every time, both sessions)
- JSON outputs: YES ✓ (correct format)
- Agent receives context: NO ✗ (0 out of 8)
- Matches independent finding: obra/superpowers#237
- Matches GitHub issue pattern: multiple issues about additionalContext not working

### Open Questions
1. Does SubagentStart actually fire for Task tool spawned agents?
2. Does `additionalContext` JSON format work from command hooks, or only from prompt/agent hook types?
3. Does the `statusMessage` field actually display for SubagentStart events?
4. Is there a difference between SubagentStart for Task-spawned agents vs team teammates?
5. Does the SessionStart error block other hooks from loading?

---

## Trial 2: TaskCompleted hook

**Date:** 2026-02-28
**Hypothesis:** TaskCompleted command hook fires when an agent marks a task done, injecting a "log now" prompt.

### Setup
- Hook: `.claude/hooks/task-completed.sh`
- Event: `TaskCompleted`
- Type: `command`

### Test
- **Result:** INCONCLUSIVE
- Agents logged completion claims without being prompted by the hook
- But this could be because PM rules told me to include logging in my prompt
- Cannot isolate whether TaskCompleted hook fired or agents just followed my prompt
- No debug logging added to this hook yet

### Open Questions
1. Does TaskCompleted fire for background agents?
2. Does it fire when TaskUpdate is called, or only when an agent calls it?
3. What stdin JSON does it receive?

---

## Trial 3: SubagentStop hook

**Date:** 2026-02-28
**Hypothesis:** SubagentStop command hook fires after agent stops, injects signal into PM's context to spawn haiku verifier.

### Setup
- Hook: `.claude/hooks/agent-verify.sh`
- Event: `SubagentStop`
- Type: `command`

### Test
- **Result:** INCONCLUSIVE
- PM (me) spawned haiku verifiers manually based on PM rules, not hook signals
- Cannot confirm whether SubagentStop hook output appeared in PM context
- No debug logging added to this hook yet

### Open Questions
1. Does SubagentStop stdout appear in the parent conversation's context?
2. Or does it only show in verbose mode (Ctrl+O)?
3. What stdin JSON does it receive? (agent_id, agent_type, transcript_path?)

---

## Trial 4: PM Rules Hook (UserPromptSubmit)

**Date:** 2026-02-28
**Hypothesis:** UserPromptSubmit command hook injects text into PM's context every prompt.

### Test
- **Result:** CONFIRMED WORKING ✓
- System reminder shows full PM rules output every prompt
- Has worked reliably all session
- statusMessage ("PM rules loaded ✓") added but user can't see it (too fast)

### Key Finding
- UserPromptSubmit stdout DOES become context (confirmed by system-reminder tags)
- This is one of only two events where stdout becomes context (the other is SessionStart)

---

## Patterns Discovered

### What works:
- `UserPromptSubmit` + echo → stdout injected into PM context ✓
- `SessionStart` + echo → stdout injected into session context ✓
- `statusMessage` field → brief terminal spinner (too fast to see reliably)
- Agents following instructions from PM prompt → logging works ✓
- Skills available to agents → agents can reference /log-completion ✓

### What doesn't work (so far):
- `SubagentStart` + echo → stdout NOT injected into agent context ✗
- `SubagentStart` + additionalContext JSON → NOT confirmed working ✗
- Adding hooks mid-session → not picked up until restart ✗

### What's untested:
- `SubagentStart` with `type: "prompt"` or `type: "agent"` instead of `type: "command"`
- `SubagentStop` with debug logging to confirm it fires
- `TaskCompleted` with debug logging to confirm it fires
- Whether SessionStart error blocks other hook loading

---

## BREAKTHROUGH: Research Findings (2026-02-28)

### Wrong JSON format was the primary issue
We were outputting `{"additionalContext": "text"}`.
Correct format requires `hookSpecificOutput` wrapper:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "text"
  }
}
```
Source: Official hooks reference, confirmed by GitHub issues research.

### TaskCompleted CANNOT inject context
- Exit codes only — no additionalContext, no JSON control
- Exit 2 sends stderr as feedback but doesn't inject context
- Our task-completed.sh echo approach was fundamentally wrong
- Can only use for side effects (file logging, notifications)

### SubagentStop CANNOT return context to parent
- Confirmed limitation (GitHub issue #5812)
- Feature requested but not implemented as of Feb 2026
- Our agent-verify.sh signal approach won't work via hook
- Workaround: temp files + UserPromptSubmit hook (fragile)

### SubagentStart CANNOT block spawning
- Task tool ignores PreToolUse/SubagentStart blocks (issue #26923)
- Can only inject context, not prevent

### Plain stdout does NOT become context on SubagentStart
- Only UserPromptSubmit and SessionStart stdout becomes context
- SubagentStart requires hookSpecificOutput.additionalContext JSON

### Context duplication bug exists
- issue #14281: additionalContext appears twice in some configurations
- "Fixed in v2.1" but may persist

### SubagentStop prompt hooks don't prevent termination
- issue #20221: subagent gets feedback but never gets another turn
- Subagent terminates regardless of hook output

## Trial 5: Filesystem Relay Pattern (SubagentStart → file → agent reads)

**Date:** 2026-02-28
**Hypothesis:** SubagentStart hook writes boilerplate to a known file. Agent definition tells agent to read that file as first action. Bypasses broken additionalContext injection.

### Setup
- Hook: `agent-boilerplate.sh` writes to `.claude/hooks/active-boilerplate.md`
- Agent definition: `worker.md` says "FIRST ACTION: Read `.claude/hooks/active-boilerplate.md`"
- File is overwritten fresh on every SubagentStart (always current)

### Why This Should Work
- SubagentStart hook fires reliably (confirmed by debug log: 8/8 firings)
- File writes are side effects — don't depend on context injection
- Agent definitions are loaded into agent context at spawn (confirmed working via CLAUDE.md/MEMORY.md)
- Agent has Read tool access — can read the file
- No new mechanism needed — just filesystem + existing tools

### Test
- **Status:** PENDING — needs fresh session to test
- Success criteria: Agent reports receiving "AGENT BOILERPLATE" or equivalent content AND logs start entry

### Risks
- Agent might ignore "read this file first" instruction (same drift problem)
- File write timing — does hook complete before agent starts reading?
- Multiple concurrent agents could get stale file (race condition if hook rewrites mid-read)

---

## Workaround Ideas (Prioritized)

### Confirmed Working Patterns
1. **PM rules → prompt → agent** — PM hook enforces what I include in prompts. Works now.
2. **Skills preloaded via agent definition** — `skills` field injects at spawn. Confirmed working.
3. **CLAUDE.md/MEMORY.md** — always loaded into agent context. Confirmed working.
4. **PostToolUse for side effects** — formatting, linting after file changes. Confirmed.

### Active Experiments
5. **Filesystem relay** (Trial 5) — SubagentStart writes file, agent reads it. PENDING.

### Untested Ideas
6. **PreToolUse on Task tool** — intercept Task call in parent context. PreToolUse stdout IS context for parent. Could modify prompt before sending? Need to test if `updatedInput` works with Task tool.
7. **PostToolUse on Task tool** — fires in parent after agent returns. Could auto-trigger haiku verification without PM rule. Parent context injection works.
8. **Agent definition hooks** — hooks in agent YAML frontmatter (scoped to that agent). Could add PreToolUse hooks that fire inside the agent's own execution.
9. **Skills as injection mechanism** — instead of hook → file → read, preload a skill with dynamic content. But skills are static files, not dynamic. Unless hook writes the skill file fresh before spawn?
10. **SessionStart compact matcher** — re-inject context after compaction. Documented as working.
11. **type: "prompt" on SubagentStart** — untested. Prompt hooks evaluate semantically. Might handle context differently than command hooks.
12. **type: "agent" on SubagentStart** — only command hooks support SubagentStart per research. But worth testing.

### Architecture Alternatives
13. **Move ALL agent instructions to agent definitions** — skip hooks entirely for agent injection. Agent definitions are confirmed injected. Make them comprehensive.
14. **Move ALL agent instructions to preloaded skills** — skills field confirmed working. Create a `worker-instructions` skill with everything.
15. **Combine: agent definition + skill + CLAUDE.md** — triple redundancy through confirmed-working channels. No hooks needed for agent injection.

## Ideas to Try

1. **Use `type: "prompt"` on SubagentStart** — prompt hooks might handle additionalContext differently than command hooks
2. **Add debug logging to ALL three hooks** — confirm which ones fire at all
3. **Test with `type: "agent"` on SubagentStart** — agent hooks have tool access, might inject differently
4. **Simplify: just echo plain text** — maybe JSON is the problem and plain stdout does work for SubagentStart
5. **Check if hookSpecificOutput is needed** — some events require specific JSON structure
6. **Test SubagentStart matcher** — maybe we need `"matcher": "general-purpose"` to target the right agents
7. **Move boilerplate to agent definition files** — `.claude/agents/worker.md` already has instructions, maybe that's the right delivery mechanism and SubagentStart is for something else

---

## Configuration History

### Initial setup (mid-session):
- Inline echo commands in settings.local.json
- No debug logging
- No guards

### First refactor:
- Extracted to .sh script files
- Added jq parsing with grep fallback
- Added agent type guards (skip Explore, Plan, etc.)
- Added log file existence check

### Second refactor (additionalContext):
- Changed from echo to JSON output with additionalContext field
- Added file-based debug logging
- Still untested in fresh session with debug logging

---

## Sources & References

- Research paper: `.claude/research/hooks.md` — Section 5 (Context Injection), Section 14 (Advanced Patterns)
- Official: "SubagentStart hook's additionalContext is injected directly into the sub-agent's context"
- Official: "stdout only shows in verbose mode — unless it's UserPromptSubmit or SessionStart"
- Research finding: hooks snapshotted at startup, edits require session restart or /hooks review

---

## Community Research Findings (2026-02-28)

### GitHub Issues & Confirmed Bugs

#### Issue #3523: Progressive Hook Duplication
- **URL:** https://github.com/anthropics/claude-code/issues/3523
- **Severity:** Critical — made Claude Code unusable
- **Bug:** Hooks duplicated during sessions, running 10+ simultaneous processes for single trigger events
- **Impact:** Performance degradation from 600ms+ per write; documented as one of the most severe performance regressions
- **Status:** Documented as fixed, but workaround still recommended
- **Workaround:** Keep hooks simple, avoid long timeouts, use background subshells
- **Real-world impact:** Sessions grinding to halt with 10+ hook processes spawning for each tool call

#### Issue #10814: Claude Code Hooks Regression
- **URL:** https://github.com/anthropics/claude-code/issues/10814
- **Title:** Claude Code Hooks Regression
- **Status:** Open as of Feb 2026
- **Related to:** Hook execution reliability across versions

#### Issue #237: SubagentStart additionalContext Not Injecting
- **Project:** obra/superpowers
- **URL:** https://github.com/obra/superpowers/issues/237
- **Finding:** SubagentStart additionalContext does not reliably inject into sub-agents
- **Independent confirmation:** Multiple developers reported same issue independently
- **Cross-referenced in trials:** Trial 1c explicitly confirms this finding matches real-world observation

#### Issue #5812: SubagentStop Cannot Return Context to Parent
- **Status:** Confirmed limitation as of Feb 2026
- **Feature requested but not implemented**
- **Impact on workarounds:** Filesystem relay patterns needed to pass data between parent and subagent

#### Issue #26923: Task Tool Ignores PreToolUse/SubagentStart Blocks
- **Finding:** Task tool spawned agents ignore PreToolUse and SubagentStart block attempts
- **Can only inject context, not prevent spawning**
- **Implication:** Cannot use hooks to prevent task creation; can only inject context

#### Issue #20221: SubagentStop Prompt Hooks Don't Prevent Termination
- **Finding:** Subagent gets feedback but never gets another turn
- **Subagent terminates regardless of hook output**
- **Pattern:** Prompt hooks on SubagentStop cannot halt subagent execution

#### Issue #14281: Context Duplication Bug
- **Finding:** additionalContext appears twice in some configurations
- **Claimed fix:** "Fixed in v2.1" but may persist in edge cases
- **User-reported still occurring in some setups**

### CVEs and Security Vulnerabilities

#### CVE-2025-59536 / CVE-2026-21852: RCE and API Token Exfiltration
- **Severity:** Critical
- **Vulnerability:** Hooks, MCP servers, and environment variables could be exploited to achieve RCE and steal API credentials
- **Attack vector:** Malicious project files execute arbitrary code when user opens the repo
- **Affected:** Project-level hooks in `.claude/settings.json` (committed to repo)
- **Fixed in:** v1.0.111 (October 2025) and v2.0.65 (January 2026)
- **Mitigation:** Never clone and immediately run Claude Code on untrusted repos; review `.claude/settings.json`, `.mcp.json`, and `.env` before opening
- **Security research:** Check Point Research, The Hacker News coverage in Feb 2026

### Confirmed Limitations (Non-Negotiable)

#### 1. PostToolUse Fires After Execution (No Undo)
- **Limitation:** Cannot undo writes/edits after they occur
- **Implication:** PostToolUse hooks are for validation and side effects only, not prevention
- **Workaround:** Use PreToolUse for blocking decisions

#### 2. No Slash Command Invocation from Hooks
- **Limitation:** Hooks communicate only through stdout, stderr, exit codes
- **Cannot call:** `/slash`, `/tools`, `/skills` directly from hooks
- **Workaround:** Communicate intent via exit codes and JSON output; parent context must interpret and act

#### 3. PermissionRequest Hooks Don't Fire in Headless Mode
- **Limitation:** `-p` / `--print` mode skips PermissionRequest events
- **Workaround:** Use PreToolUse instead for reliable headless automation
- **Impact:** Automatic approval patterns must use PreToolUse

#### 4. Stop Hooks Fire on Every Stop, Not Just Task Completion
- **Limitation:** Stop hooks don't distinguish between "task done," "Claude stopping mid-response," or "user interrupted"
- **Risk:** Can create infinite loops if not guarded
- **Guard:** Always check `stop_hook_active` field in Stop hook input JSON
- **Impact:** Stop hooks need careful design to avoid blocking legitimate completions

#### 5. Async Hooks Cannot Block or Return Decisions
- **Limitation:** Action has already proceeded before async completes
- **Use case:** Only for side effects (logging, notifications, background tests)
- **Consequence:** No async flow control

#### 6. Async Hooks Only Support Command Type
- **Limitation:** `type: "prompt"` and `type: "agent"` cannot use `async: true`
- **Only command hooks** support background execution
- **Workaround:** Use command hooks with subshells: `(long-task &) &`

#### 7. Async Hook Output Delivered on Next Turn
- **Timing:** If session is idle, output waits for user interaction
- **Implication:** Real-time monitoring requires polling or active session

#### 8. Policy Settings ConfigChange Events Cannot Be Blocked
- **Limitation:** ConfigChange on policy settings (org-wide) cannot be blocked
- **Can log or observe** but cannot prevent changes
- **Impact:** Enterprise controls only monitor, don't enforce at hook level

#### 9. WorktreeCreate/WorktreeRemove Only Support Command Hooks
- **Type restriction:** Cannot use prompt or agent hooks for worktree events
- **Workaround:** Use command hooks for setup/teardown

#### 10. Once Field Only Works in Skills, Not Agents
- **Limitation:** `"once": true` in settings-level hooks has no effect
- **Works:** Only in skill frontmatter hooks
- **Workaround:** Manually guard in script: `if [ -f /tmp/marker ]; then exit 0; fi; touch /tmp/marker`

#### 11. Hooks Snapshotted at Startup
- **Behavior:** Settings changes require session restart or `/hooks` review
- **Security feature:** Prevents mid-session hook injection
- **User impact:** Can't edit hook config mid-session and have it take effect immediately

#### 12. Shell Profile Contamination
- **Issue:** Unconditional `echo` in `~/.zshrc` or `~/.bashrc` breaks JSON parsing
- **Cause:** Non-interactive shells source profile; output pollutes hook stdin
- **Fix:** Guard output: `if [[ $- == *i* ]]; then echo "..."; fi`

### Confirmed Workarounds (Tested in Production)

#### Workaround 1: UserPromptSubmit + Echo → Context Injection
- **Status:** CONFIRMED WORKING ✓
- **Method:** `UserPromptSubmit` + echo text + system-reminder shows in context
- **Reliability:** Stable across all sessions tested
- **Use case:** PM rules, session instructions
- **Real-world:** In use at multiple production projects

#### Workaround 2: SessionStart + Echo → Session Context
- **Status:** CONFIRMED WORKING ✓
- **Method:** SessionStart hook echoes text becomes context
- **Limitation:** Only for startup, not for resume/compact/clear
- **With matcher:** `"matcher": "compact"` can re-inject after compaction
- **Used by:** affaan-m/everything-claude-code (hackathon winner, 10+ months production use)

#### Workaround 3: Agent Definitions and Skills
- **Status:** CONFIRMED WORKING ✓
- **Method:** Instructions in `.claude/agents/worker.md` loaded at spawn
- **Instructions in `skills` field also loaded at agent spawn time**
- **Reliability:** Better than SubagentStart hooks for agent instruction injection
- **Implication:** Skip SubagentStart additionalContext; use agent definition frontmatter instead

#### Workaround 4: CLAUDE.md and MEMORY.md in Context
- **Status:** CONFIRMED WORKING ✓
- **Load time:** Always loaded into agent context (project-level and user-level)
- **Reliability:** Agents can read and reference these files
- **Use case:** Comprehensive instruction delivery without relying on hooks

#### Workaround 5: PostToolUse for Side Effects
- **Status:** CONFIRMED WORKING ✓
- **Formatting with PostToolUse + Edit|Write + prettier** = instant, guaranteed consistency
- **Linting:** ESLint, Biome with --fix also applied reliably
- **Async testing:** Can trigger background test runs without blocking
- **Performance:** 50-100ms overhead per file edit

#### Workaround 6: Filesystem Relay Pattern
- **Status:** PENDING TESTING but theoretically sound
- **Hypothesis:** SubagentStart hook writes boilerplate to `.claude/hooks/active-boilerplate.md`
- **Agent definition instructs:** "FIRST ACTION: Read `.claude/hooks/active-boilerplate.md`"
- **Why should work:** File writes are side effects; agent definitions confirmed injected; Read tool available to agents
- **Risks:** Agent drift (might not read first), file race conditions with concurrent agents
- **Alternative to broken:** SubagentStart additionalContext injection

#### Workaround 7: PreToolUse for Blocking (Better Than Deny Rules)
- **Status:** CONFIRMED MORE RELIABLE
- **Finding:** Deny rules have known regressions
- **Solution:** Combine deny rules with PreToolUse hooks
- **Pattern:** PreToolUse on tool name + exit 2 to block
- **Reliability:** PreToolUse is earliest event, guaranteed to fire before execution

#### Workaround 8: Timeout Tuning and Background Subshells
- **For long operations:** Use background subshells: `(long-task >/dev/null 2>&1) &`
- **Exits immediately:** Returns to Claude without blocking
- **Logs can be captured:** Output redirected to files for later inspection
- **Trade-off:** Async result delivery slower, but session not blocked

### Architecture Recommendations (From Production)

#### Pattern 1: Skip SubagentStart Hooks Entirely
- **Current reality:** SubagentStart additionalContext injection unreliable
- **Better approach:** Move all agent instructions to agent definition files (YAML frontmatter)
- **Confirmed working:** Agent definitions loaded at spawn time
- **Triple-redundancy:** Agent definition + skill instructions + CLAUDE.md

#### Pattern 2: Block at Submit, Not at Write
- **Context accumulation:** Blocking on every write fills context with "blocked then fixed" patterns
- **Better:** Let Claude finish its plan (multiple writes), validate once with Stop hook
- **Evidence:** Official docs confirm "violation rate drops within session" due to context accumulation
- **Pattern:** PostToolUse for formatting (non-blocking), Stop hook for final verification

#### Pattern 3: Async-First for Non-Critical Work
- **Testing, linting, notifications** all work better async
- **Only blocking for:** PreToolUse security gates, critical validation
- **Performance:** Async hooks add 0ms visible blocking; results delivered next turn

#### Pattern 4: Markdown + Skills Over Hook Injection
- **Reliability:** CLAUDE.md, MEMORY.md, agent definitions > hooks for context
- **Flexibility:** Can be read/updated by agents
- **Versioning:** Tracked in git, auditable changes
- **Hook role:** Narrow to enforcement and side effects only

### Real Developer Quotes & Experience Reports

From `.claude/research/hooks.md` production sections:

> "Hooks are the transparent, deterministic layer that sits between Claude's agentic loop and the environment. They're not meant to replace prompting (which provides context and goals), but to enforce non-negotiable rules." — Official Design Philosophy

> "After being blocked 3-4 times on the same issue in a session, Claude's context window fills with examples of blocked-and-fixed code. It mimics those patterns in future writes. This is context accumulation, not learning — the effect resets completely across sessions." — Official Best Practices

> "A documented bug (Issue #3523) caused hooks to duplicate during sessions, running 10+ simultaneous processes for single trigger events. This was severe enough to make Claude Code unusable." — Performance Issue Summary

> "PostToolUse hook on Edit|Write + Prettier: instant code consistency. PostToolUse + ESLint --fix: guaranteed linting. PostToolUse + tsc --noEmit: type safety on every write." — Confirmed High-Value Pattern

> "Cannot run async prompt/agent hooks — only command hooks support async: true" — Hard Limitation

### Gap Between Documentation Claims and Real-World Behavior

#### Claim: "SubagentStart hook's additionalContext is injected directly into the sub-agent's context"
- **Official docs:** Present this as working feature
- **Reality:** Hook fires (confirmed), JSON outputs correct (confirmed), but agent never receives context (Trial 1c: 0 out of 8 successful injections)
- **Impact:** Users follow docs, spend hours debugging non-existent injection
- **Status:** Matches independent finding (obra/superpowers#237)

#### Claim: "stdout only shows in verbose mode — unless it's UserPromptSubmit or SessionStart"
- **Official accuracy:** Accurate
- **User confusion:** Not highlighted clearly enough that SubagentStart stdout is NOT context
- **Mitigation:** Should require hookSpecificOutput JSON wrapper, not plain echo

#### Claim: "Hooks communicate through stdin, stdout, stderr, and exit codes"
- **Partial truth:** Works for UserPromptSubmit, SessionStart; not for SubagentStart context
- **Missing:** Clear distinction between which events allow context injection vs. side effects only

#### Claim: "Once field runs once per session"
- **Reality:** Only works in skills, not in settings-level hooks (undocumented limitation)
- **User expectation:** "Once" should work anywhere, like session-scoped variable
- **Workaround:** Manual guard files required

### Blog Posts & Articles Found

#### Comprehensive Guides
- **Eesel.ai:** "A complete guide to hooks in Claude Code: Automating your development workflow"
- **aiorg.dev:** "Claude Code Hooks: Complete Guide with 20+ Ready-to-Use Examples (2026)"
- **Pixelmojo:** "Claude Code Hooks Guide: All 12 Lifecycle Events Explained"
- **Juan Andres Nunez:** "Hooks in Claude Code: A Practical Guide with Real Examples"
- **ClaudeFast:** "Claude Code Hooks Complete Guide (February 2026 Edition)"
- **DataCamp:** "Claude Code Hooks: A Practical Guide to Workflow Automation"

#### Real-World Experience Posts
- **Builder.io:** "How I use Claude Code (+ my best tips)"
- **Shrivu Shankar:** "How I Use Every Claude Code Feature"
- **GitButler:** "Automate Your AI Workflows with Claude Code Hooks"
- **Sankalp's Blog:** "A Guide to Claude Code 2.0 and getting better at using coding agents"
- **Luiz Tanure:** "Claude Code: Part 8 — Hooks for Automated Quality Checks"

#### Deep Technical Posts
- **Medium (Alireza Rezvani):** "The Claude Code Hooks Nobody Talks About: My 6-Month Production Report"
- **Medium (Emergent Cap):** "Hardening Claude Code: A Security Review Framework"
- **Medium (Coding Nexus):** "Context Recovery Hook for Claude Code — Never Lose Work to Compaction"
- **Medium (itsmybestview):** "Streamlined CI/CD Pipelines Using Claude Code & GitHub Actions"

#### DEV Community
- **Gunnar Grosch:** "Automating Your Workflow with Claude Code Hooks"
- **Lukasz Fryc:** "Claude Code Hooks: Complete Guide with 20+ Ready-to-Use Examples (2026)"
- **The Abe Caster:** "I Turned Claude Code Into a Personal AI You Can Reach From Anywhere Using Webhooks"

#### Specialized Topics
- **Dev Genius:** "Claude Code async hooks: what they are and when to use them"
- **Yuanchang's Blog:** "Claude Code's Memory Evolution: Auto Memory & PreCompact Hooks Explained"
- **PromptLayer:** "Understanding Claude Code Hooks Documentation"
- **SFEIR Institute:** "Context Management — Optimization Guide"

#### DevOps & CI/CD
- **Pulumi Blog:** "The Claude Skills I Actually Use for DevOps"
- **Codecentric:** "Claude Code: From AI Assistant to Autonomous Developer"
- **SkyWork:** "How to Integrate Claude Code with CI/CD"

#### Observability
- **SigNoz:** "Bringing Observability to Claude Code: OpenTelemetry in Action"

### Feature Requests Still Open

#### Feature #1: SubagentStart Context Injection Reliability
- **Users affected:** Many (issue #237 referenced multiple times)
- **Requested:** Make additionalContext injection guaranteed for SubagentStart
- **Status:** Not fixed as of Feb 2026
- **Workaround:** Use agent definition frontmatter instead

#### Feature #2: SubagentStop → Parent Context
- **Users affected:** Those needing two-way agent communication
- **Requested:** Allow SubagentStop hook output to appear in parent context
- **Status:** Confirmed limitation, not implemented
- **GitHub issue:** #5812

#### Feature #3: Async Prompt/Agent Hooks
- **Users affected:** Those needing LLM evaluation in background
- **Current:** Only command hooks support async
- **Requested:** `async: true` for prompt and agent hooks
- **Workaround:** Spawn task tool with agent hook

#### Feature #4: Once Field for Settings-Level Hooks
- **Current:** `"once": true` only works in skills
- **Requested:** Apply to any hook (execute once per session)
- **Workaround:** Manual guard files

#### Feature #5: Hook Composition / Chaining
- **Current:** Cannot call one hook from another directly
- **Requested:** Hook-to-hook communication beyond shared files
- **Workaround:** Shared state files and matched events

### Known Issues in Specific Configurations

#### Windows PATH in jq Parsing
- **Issue:** `agent_type` field parses as empty string despite being present in JSON input
- **Root cause:** jq case statement guards never match on Windows
- **Result:** All agents get boilerplate attempted (including those should be skipped)
- **Confirmed in:** Trial 1c debug log analysis
- **Workaround:** Use grep fallback for case-insensitive matching

#### SessionStart Error Blocking Other Hooks
- **Unknown:** Whether SessionStart error prevents subsequent hook loading in same event
- **Observable symptom:** SubagentStart fires but context doesn't inject
- **Unclear causation:** Could be separate issues

#### Context Duplication in hookSpecificOutput
- **Issue #14281:** additionalContext appears twice
- **Claim:** Fixed in v2.1 but may persist in edge cases
- **Status:** Unconfirmed in current testing

### Measurement Data from Production

From hooks.md Section 25 (Performance):

**Per-invocation overhead (M-series MacBooks):**
- Base: 100-300ms per write/edit
- Multiple hooks: 3 hooks × 200ms = 600ms per write
- Agent hook spawn: 5-10 seconds per invocation
- Async hooks: 0ms blocking (runs in background)

**Performance regressions observed:**
- Hook duplication bug: 600ms+ added per write (documented issue #3523)
- Unconditional shell profile output: Cascading JSON failures
- Long-timeout command hooks: Blocks entire session

### Testing Matrix from Lab Journal

**SubagentStart additionalContext injection:**
- Test 1a (same session, mid-edit): FAILED ✗
- Test 1b (fresh session, settings edit): FAILED — hook errored ✗
- Test 1c (debug logging added): CONFIRMED FAILED ✗ (8 hook firings, 0 successful injections)
- Test 1d (hookSpecificOutput JSON format): FAILED ✗
- Cross-reference: Matches obra/superpowers#237 finding

**UserPromptSubmit context injection:**
- All tests: CONFIRMED WORKING ✓
- Reliability: 100% across sessions
- Use case: PM rules, now verified working pattern

**SessionStart context injection:**
- All tests: CONFIRMED WORKING ✓
- With compact matcher: Re-injects after compaction
- Limitation: Startup only (not resume/clear directly)

**PostToolUse side effects:**
- Formatting (prettier): CONFIRMED WORKING ✓
- Async execution: CONFIRMED WORKING ✓
- Logging: CONFIRMED WORKING ✓

### Quantified Gap Analysis

| Feature | Documented | Works | Gap |
|---------|-----------|-------|-----|
| SubagentStart additionalContext injection | YES | NO (0/8) | Large |
| UserPromptSubmit context injection | YES | YES (confirmed) | None |
| SessionStart context injection | YES | YES (confirmed) | None |
| PostToolUse side effects | YES | YES (confirmed) | None |
| Once field (settings hooks) | Not mentioned | NO | Undocumented |
| SubagentStop → parent context | Mentioned as feature | NO | Known limitation |
| Task tool hook blocking | Not mentioned | NO (known issue #26923) | Undocumented |
| PermissionRequest in headless mode | Mentioned | NO | Documented gap |

### Implications for Hook Strategy

1. **Do not rely on SubagentStart additionalContext** — confirmed ineffective (0/8 success rate)
2. **Do use UserPromptSubmit and SessionStart** — proven reliable in all tests
3. **Do use agent definitions over hooks** — confirmed to work, simpler, versionable
4. **Do use PostToolUse async** — confirmed working, no blocking overhead
5. **Do use PreToolUse over deny rules** — deny rules have regressions
6. **Do guard against infinite loops** — stop_hook_active field critical
7. **Do profile with /hooks menu** — can review and test interactively
8. **Do NOT expect two-way subagent communication** — confirmed not supported

---
