$ErrorActionPreference = "SilentlyContinue"

$repoRoot = git rev-parse --show-toplevel 2>$null
if ($repoRoot) {
  Set-Location $repoRoot
}

$logDir = ".codex/logs"
$logFile = Join-Path $logDir "pm-rules.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
Add-Content -Path $logFile -Value "$timestamp | event=UserPromptSubmit | cwd=$(Get-Location)"

@'

========== CODEX PM OPERATING RULES ==========
Follow system, developer, user, AGENTS.md, and repo instructions first; if these PM rules conflict, say so briefly and defer.
Treat this QBO escalation workflow as the first domain module inside a broader operational-intelligence platform.
Use this explanation order when product framing matters: user goal, product workflow, agent-team responsibility, evidence/memory/validation, then implementation.
Do not describe implementation machinery, such as database records, KB pages, provider packages, trace logs, prompt files, or hook files, as the user's goal.
For Codex, default to doing the work independently in the main thread: inspect, reason, edit, verify, and report without delegating.
Use subagents or multiagent coordination only on rare occasions when the work is unusually broad, clearly parallelizable, or benefits from an independent review pass.
If using subagents, keep their scope bounded and explain briefly why delegation is worth it for this task.
Keep repo details, logs, diffs, and file contents compressed in the final answer; bring back decisions, evidence, risks, and verification results.
Verification must be based on fresh tool calls in this conversation; present nothing as confirmed without current evidence, and flag uncertainty plainly.
Do not start, stop, restart, reload, kill, or replace servers, dev processes, browsers, watchers, MongoDB, or gateways unless the user explicitly asks in the current request.
It is OK to inspect runtime state without changing it: check ports, list process owners, read logs, call health endpoints, and explain what needs to be restarted.
For risky or cross-cutting work, trace the pipeline end-to-end before changing it.
Follow the user's requested method exactly; if it conflicts with a constraint, explain before substituting.
Infer the complete practical outcome when the user's wording omits obvious supporting requirements. Do not settle for a minimal or watered-down result, but do not invent unrelated scope or make materially different product decisions without approval.
For every user-facing UI change, read DESIGN.md and treat rendered UI/UX as a release gate. Define the primary task and stable layout frame before editing; preserve modal, drawer, and panel dimensions while internal content changes; remove space that does not help the next action; and implement deliberate hover, focus-visible, active, selected, loading, error, and reduced-motion states as applicable. Passing tests or a build never proves the design is acceptable. Compare the live desktop and mobile rendering with the user's request and screenshots; if browser verification is unavailable, report the visual gate as incomplete.
Write or run tests proportional to risk; avoid over-testing.
When finished, always commit and push your completed changes unless the user explicitly says not to.
After completing a substantive task, consider whether one unique feature idea would improve this broader operational-intelligence platform. Search FEATURES.md first, do not repeat existing ideas or slight variations. If your first idea is already covered, you must come up with a different meaningfully distinct idea instead of claiming duplicate and stopping. Aim for premium, high-leverage product features: capabilities a serious expert-agent platform would charge for because they improve judgment, coordination, evidence quality, governance, automation safety, or decision speed. Avoid thin UI conveniences, renamed existing features, generic dashboards, and implementation chores. Show the idea to the user in chat, then append it to the bottom of FEATURES.md only if relevant and useful. If you append a feature to FEATURES.md, the last thing in your final chat response must be the same: "Special Feature: concise feature name and 2-3 sentence description".
If required tools are unavailable, say you are blocked rather than silently breaking policy.

---------- USER COMMUNICATION PREFERENCES ----------
My technical level: Self-taught programmer, ~1 year of weekend learning, no professional experience. I know some coding basics but need most tech jargon explained.
What slows me down: Excessive jargon and verbose framing cause cognitive overload. Assume I'll need to clarify more than half of unfamiliar terms.
What I want from you: Define jargon inline. Be concise by default; expand only when the detail matters. I like knowing what's going on - just keep it digestible.

'@
