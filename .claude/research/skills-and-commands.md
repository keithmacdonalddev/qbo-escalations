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

### Where Skills Live (Priority Order)

```
Priority 1 (Highest): --agents CLI flag (session-only)
Priority 2:           ~/.claude/agents/           (enterprise-wide)
Priority 3:           ~/.claude/skills/           (user-level, all projects)
Priority 4:           .claude/skills/             (project-level)
Priority 5 (Lowest):  Plugin's skills/ directory
```

When skills share the same name, higher priority wins.

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

### Complete Frontmatter Reference

```yaml
---
# REQUIRED
name: my-skill                   # lowercase, letters/numbers/hyphens only (max 64 chars)
description: What this does      # Claude uses this to decide when to invoke

# OPTIONAL - Invocation Control
disable-model-invocation: false  # true = only user can invoke (/skill-name)
user-invocable: true             # false = only Claude can invoke (background knowledge)
argument-hint: "[issue-number]"  # Hint shown in autocomplete

# OPTIONAL - Execution Context
context: fork                    # Run in isolated subagent instead of inline
agent: Explore                   # Which agent type to use (Explore, Plan, general-purpose)

# OPTIONAL - Tool Access
allowed-tools: Read, Grep, Bash(git *)  # Restrict tools Claude can use
model: sonnet                    # Override model for this skill

# OPTIONAL - Advanced
hooks: {}                        # Lifecycle hooks scoped to this skill
---
```

### Frontmatter Fields Explained

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `name` | string | Skill identifier (becomes `/name`) | `explain-code` |
| `description` | string | When Claude should use this | `Explains code with visual diagrams` |
| `disable-model-invocation` | boolean | If true, Claude never auto-invokes; only `/name` works | `true` for `/deploy` |
| `user-invocable` | boolean | If false, hides from `/` menu; only Claude can use | `false` for background context |
| `argument-hint` | string | Autocomplete hint for expected args | `[component] [from] [to]` |
| `context: fork` | enum | Run in isolated subagent context | `fork` |
| `agent` | string | Which subagent to use when `context: fork` | `Explore`, `Plan`, `general-purpose` |
| `allowed-tools` | string | Comma-separated list of allowed tools (allowlist) | `Read, Grep, Bash(grep *)` |
| `model` | string | Which model to use for this skill | `haiku`, `sonnet`, `opus` |
| `hooks` | object | Inline hook definitions | See hooks reference |

### String Substitutions

```yaml
Session: ${CLAUDE_SESSION_ID}
Arguments: $ARGUMENTS
First arg: $0 (same as $ARGUMENTS[0])
Second arg: $1 (same as $ARGUMENTS[1])
All args: $ARGUMENTS
```

When `$ARGUMENTS` is not present in content, Claude Code appends `ARGUMENTS: <value>` automatically.

---

## 4. Skill Invocation: How Claude Decides

### Automatic Invocation (Claude Decides)

Claude loads skill descriptions into context (at 2% of context window budget, ~16k chars fallback). When a user's request matches a skill's description, Claude automatically loads and runs it.

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

---

## 5. Supporting Files and References

Keep SKILL.md under 500 lines. Reference supporting files:

```
my-skill/
├── SKILL.md              # 200 lines: overview + navigation
├── detailed-api.md       # 1000+ lines: complete API docs
├── examples.md           # 500 lines: usage examples
└── scripts/
    └── validate.py       # Executable utility
```

When Claude loads the skill, it sees SKILL.md. When it needs details, it reads the referenced files.

---

## 6. Tool Restrictions: `allowed-tools`

### Allowlist

```yaml
allowed-tools: Read, Grep, Glob
```

Only specified tools available. Everything else blocked.

### Wildcard Patterns

```yaml
allowed-tools: Bash(git *)
```

Only git commands allowed.

### No `allowed-tools` = Inherit All

If omitted, the skill inherits all tools from the parent conversation.

---

## 7. Subagent Execution: `context: fork`

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

1. Skill content becomes the subagent's task prompt
2. The `agent` field specifies which subagent configuration to use
3. Subagent runs in isolation with fresh context
4. Results summarized and returned to main conversation

### Available Agents

- `Explore` → Fast, read-only (Haiku model)
- `Plan` → Research-focused, read-only
- `general-purpose` → Full capabilities (default)
- Custom agents from `.claude/agents/`

### When to Use

- Complex research tasks requiring exploration
- Isolating verbose output from main conversation
- Running with restricted tools
- Delegating to a specialized agent type

### When NOT to Use

- Simple reference content (use inline instead)
- When you need frequent interaction with the skill
- Skills that provide guidelines without explicit tasks

---

## 8. Sub-Agent Access to Skills

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

### Can Subagents Use Custom Commands?

Commands are treated as skills — same rules apply. Must be listed in `skills` field.

### Can Subagents Spawn Other Subagents?

No. Subagents cannot use the Task tool. No nesting.

### Permission Inheritance

Subagents inherit permissions from parent, but with restrictions. Known issue: user-level permissions from `~/.claude/settings.json` are NOT inherited by subagents — bash commands require permission prompts even if pre-approved.

---

## 9. Scope: Project vs User vs Enterprise

### Four Levels (Priority Order)

```
1. Enterprise (~/.claude/settings.json managed by admin)
2. Project    (./.claude/skills/, ./.claude/commands/)
3. User       (~/.claude/skills/, ~/.claude/commands/)
4. Plugin     (installed plugins)
```

### Practical Guidance

- **User-level**: Generic, reusable skills (code-reviewer, explain-code)
- **Project-level**: Team-specific workflows (your API conventions, deployment process)
- **Enterprise**: Organization policies and compliance

### Nested Directory Discovery

Skills in nested `.claude/skills/` directories are auto-discovered. Monorepo-friendly.

---

## 10. Complete Examples

### Simple Reference Skill (Auto-Invoked)

```yaml
---
name: api-conventions
description: API design patterns for this codebase
---

When writing API endpoints:
- Use RESTful naming conventions
- Return consistent error formats
- Include request validation with `zod`
```

### Task Skill (User-Only)

```yaml
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
---

Deploy to production:
1. Run: npm run build
2. Run: npm run test
3. Deploy to CloudFlare Pages: npm run deploy
```

### Read-Only Analysis

```yaml
---
name: security-audit
description: Audit code for security vulnerabilities
allowed-tools: Read, Grep, Glob, Bash(npm audit)
context: fork
agent: Explore
---

Audit the codebase for security issues...
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

Shell commands execute before Claude sees the prompt.

### Skill with Preloaded Subagent Skills

```yaml
---
name: api-implementer
description: Implement API endpoints
tools: Read, Write, Edit, Bash
skills:
  - api-conventions
  - error-handling-patterns
---

Implement API endpoints. The preloaded skills contain conventions and patterns.
```

---

## 11. Limitations and Known Issues

### Skill Limitations

- **Description character budget**: 2% of context window (~16k chars). Many skills = some excluded.
- **No environment variables in skill content**: Can't reference `$HOME`. Use hooks for dynamic behavior.
- **Subagents don't inherit parent permissions**: Bash commands in skills always require approval.
- **No skill nesting**: SKILL.md cannot include another skill.

### Known Bugs (2026)

- **Project-level shadowing bug**: Project and user skills with same name both appear instead of project shadowing user. Workaround: use unique names.
- **Permission regressions (v2.0.56, v2.0.65)**: Deny rules have regressions. Combine with PreToolUse hooks for reliable blocking.

### Security

- **CVE-2026-21852**: Hooks can exfiltrate API keys if checked into shared repo. Never commit sensitive hooks.
- Use `allowed-tools` to limit skill capabilities.
- Combine deny rules with PreToolUse hooks for reliable blocking.

---

## 12. Troubleshooting

### Skill Not Triggering

1. Check description includes keywords users would naturally say
2. Verify it appears in `/` menu
3. Try invoking directly: `/skill-name`
4. Description too vague? Make it more specific
5. Too many skills? May be excluded from context budget

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

### Permission Prompts in Skills

Subagents don't inherit parent permissions. Use `allowed-tools` to pre-approve specific commands.

---

## 13. Migrating Commands to Skills

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
2. Add frontmatter
3. Copy content from command file
4. Delete `.claude/commands/my-command.md`

---

## 14. Decision Matrix

| Use Case | Best Tool | Why |
|----------|-----------|-----|
| Reusable knowledge | CLAUDE.md or Skill | Always in context |
| Manual workflow (/deploy) | Skill (`disable-model-invocation: true`) | User-controlled |
| Auto-triggered helper | Skill (default) | Claude detects relevance |
| Background reference | Skill (`user-invocable: false`) | Claude knows about it, not a command |
| Complex isolated research | Skill (`context: fork`) | Verbose output stays isolated |
| Tool-restricted task | Skill (`allowed-tools`) | Enforced constraints |
| Parallel work | Agent Teams | Each gets own context |
| Dynamic preprocessing | Skill with backticks | Runs once at load time |

---

---

# PART 2: Best Practices, Use Cases & Practical Guide

---

## 15. Best Practices: What Makes a Great Skill

### Great Skills

- **Concise**: Keep SKILL.md under 500 lines. Only add context Claude doesn't already have. Challenge every paragraph: "Does Claude really need this?"
- **Right degree of freedom**: High-freedom tasks (code review) get guidelines; low-freedom tasks (database migrations) get exact scripts
- **Progressive disclosure**: Claude sees only metadata initially. Full SKILL.md loads on trigger. Supporting files load only when referenced
- **Test across models**: Skills work differently with Haiku (needs more guidance) vs Opus (may be over-explained)
- **Strong descriptions**: Include specific keywords, mention decision triggers ("Use when working with..."), write in third person

### Bad Skills

- **Kitchen sink**: Too many instructions = Claude ignores half. Ruthlessly prune
- **Weak descriptions**: "Helps with documents" won't trigger. Need 3+ explicit constraints and expected output
- **Overly prescriptive or too permissive**: Too many options confuse Claude. Provide a default with an escape hatch
- **Deeply nested file references**: Claude partially reads nested references. Keep one level deep from SKILL.md
- **Time-sensitive info**: Don't include "Use this before August 2025." Use "Old patterns" sections instead
- **Vague activation triggers**: Descriptions must include specific keywords Claude will naturally say

---

## 16. Pros and Cons

### Skills Excel At

- **Domain knowledge on-demand** — Inject expertise without permanent context overhead
- **Consistent, repeatable workflows** — Same procedure across teams without variation
- **Context efficiency** — Supporting files don't consume tokens until read
- **Composability** — Multiple skills stack automatically (brand guidelines + financial reporting + formatting)
- **Portability** — Same SKILL.md works across Claude Code, API, and Claude.ai
- **Auto-triggering** — Claude detects relevance and loads without manual invocation
- **Gradual expertise injection** — Skills grow with usage, iterate based on real failures

### Skills Fall Short On

- **State management** — Stateless. For multi-turn memory, use CLAUDE.md or subagents
- **Real-time data** — Hardcoded data gets stale. Use MCP servers or fetch commands instead
- **Conditional complexity** — 20+ decision branches become unwieldy. Use agents or decompose
- **Very large reference docs** — 10MB+ API specs can be slow. Break into domain-specific files
- **Ambiguous activation** — Generic descriptions trigger too often. Requires careful tuning
- **Performance-critical code** — Not optimized for speed. Use pre-built scripts instead

---

## 17. Strengths & Weaknesses vs Other Tools

| Feature | CLAUDE.md | Skills | Hooks | Agents | Direct Prompting |
|---------|-----------|--------|-------|--------|------------------|
| **Always in context** | Yes | On-demand | Executes, doesn't load | Separate | Yes |
| **Context efficiency** | Loads everything | Progressive | Zero overhead | Duplicates context | One-shot |
| **Deterministic execution** | Advisory | Claude decides | Guaranteed | Independent | Advisory |
| **Automation** | Manual request | Auto-trigger | Auto-execute | Manual spawn | Manual |
| **Side effects** | None | None | Yes (linting, commits) | Limited | None |
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

## 18. Full Range of Use Cases (25+)

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
20. **Feature Engineering** — Domain-specific transformations, feature interaction patterns

### Security & Compliance

21. **Secrets Management** — Detection patterns, rotation procedures, audit logging
22. **HIPAA/SOC2 Compliance** — Data residency rules, encryption requirements, access control
23. **Supply Chain Security** — Dependency audit, license compliance, vulnerability disclosure

### Frontend & Design

24. **Design System Compliance** — Component API conventions, spacing, color, accessibility (WCAG AA)
25. **React/Vue Component Patterns** — Naming conventions, hook rules, composition patterns
26. **Responsive Design Verification** — Mobile breakpoints, touch target validation (48px min)

### Business & Workflows

27. **Customer Escalation Response** — Phone agent context, response templates, playbook navigation
28. **Content Calendar Planning** — 30-day planning with hashtag strategy, engagement hooks

---

## 19. Anti-Patterns: What NOT to Do

1. **One-shot without iteration** — Handing Claude a vague prompt once and expecting perfection. 2-3 feedback cycles increase quality by 40%
2. **Missing atomic task breakdown** — One mega-task instead of 5-10 minute blocks
3. **Over-specified descriptions** — "Helps with documents" doesn't trigger. Need explicit constraints
4. **Voodoo constants** — Scripts with magic numbers. Comment every constant
5. **Punting error handling** — Bad: `open(path).read()`. Good: `try/except` with fallback
6. **Deeply nested file references** — Claude partially reads. Keep one level deep
7. **Assuming tools are installed** — Always show install instructions
8. **Multiple equally-valid options** — Confuses Claude. Provide default + escape hatch
9. **Skill-to-skill coupling** — Don't require other skills. They're stateless
10. **Ignoring context budget** — 2% of context window. Many skills = some excluded. Check `/context`

---

## 20. Skills for Agent Teams

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

## 21. Skills vs Agents: When to Use Which

| Decision Factor | Use Skill | Use Agent |
|-----------------|-----------|-----------|
| **Scope** | Add knowledge to current context | Delegate entire task to separate context |
| **Reusability** | Across many conversations | Task-specific investigation |
| **Information** | Domain expertise, patterns | Complex, isolated task |
| **Context isolation** | Not needed; inline | Critical; prevent context bloat |
| **Invocation** | Auto-trigger or manual `/skill-name` | Explicit delegation |
| **Feedback** | Integrated in main conversation | Summarized results returned |

---

## 22. Skill Composition

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

**Pattern: Macro skill wrapping smaller skills**
- SKILL.md references other skills by name
- Claude decides when to load each referenced skill
- Each skill remains independent and standalone

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

## 23. Performance Considerations

### How Skills Consume Tokens

1. **Metadata loading (always)**: ~50-100 tokens per skill at startup. 100+ skills = ~5,000-10,000 tokens baseline
2. **SKILL.md loading (on trigger)**: 100-2,000 tokens. Happens once per trigger
3. **Reference file loading (on demand)**: Only what's read. 10MB reference takes 0 tokens until accessed

### Optimization Strategies

- **Aggressive progressive disclosure**: Keep SKILL.md under 500 lines (~2,000 tokens). Split large content into domain-specific files. ~82% token reduction vs loading everything in CLAUDE.md
- **Budget management**: 2% of context window, fallback 16k chars. Override: `SLASH_COMMAND_TOOL_CHAR_BUDGET=32000`
- **Smart skill selection**: Use `disable-model-invocation: true` for low-trigger skills. Use `user-invocable: false` for background knowledge. Use project-scoped over global
- **Context compaction**: Auto-compact at 85%+ causes 25% quality degradation. Manually compact at 70-80% for optimal quality/cost

### Performance Anti-Patterns

- **Loading 100+ skills globally** — Slow startup, budget warnings. Use project-scoped
- **Monolithic SKILL.md (5,000+ lines)** — Claude reads entire file. Split into overview + supporting files
- **Updating skills during active session** — Changes may not pick up until next session
- **Deeply nested reference files** — Claude partially reads. Keep one level deep

---

## 24. Naming Conventions & Description Writing

### Naming

- **Recommended**: Gerund form — `processing-pdfs`, `analyzing-data`, `reviewing-code`
- **Acceptable**: Noun phrases — `pdf-processing`, `data-analysis`, `code-review`
- **Avoid**: Vague (`helper`, `utils`), generic (`documents`, `data`), reserved (`anthropic-*`, `claude-*`)
- **Constraint**: Max 64 chars, lowercase + numbers + hyphens only

### Description Writing (Critical for Auto-Trigger)

**Structure**: "What it does" + "When to use it"

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
4. Test with real prompts — will Claude naturally match these keywords?

---

## 25. Real-World Production Examples

### OWASP Security Skill

```
security-code-review/
├── SKILL.md (overview + quick checklist)
├── VULNERABILITY_PATTERNS.md (20+ pages by language)
├── examples/ (bad vs good code samples)
└── scripts/validate-cwe.py
```

### Kubernetes Deployment Skill

```yaml
---
name: deploy-kubernetes
context: fork
agent: general-purpose
---
Production checklist: security contexts, resource limits, probes, disruption budgets
Template: [K8S_TEMPLATE.yaml]
Validation: python scripts/validate_manifest.py
```

### React Component Patterns Skill

```yaml
---
name: react-component-patterns
---
Naming, hook rules, composition patterns, performance optimization
References: EXAMPLES.md, STYLE_GUIDE.md
```

---

## Sources

### Official Documentation
- [Extend Claude with Skills](https://code.claude.com/docs/en/skills.md)
- [Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices.md)
- [Features Overview](https://code.claude.com/docs/en/features-overview.md)
- [Sub-agents](https://code.claude.com/docs/en/sub-agents.md)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams.md)
- [Memory Management](https://code.claude.com/docs/en/memory.md)
- [Reduce Token Usage](https://code.claude.com/docs/en/costs.md#reduce-token-usage)
- [Introducing Agent Skills — Anthropic](https://www.anthropic.com/news/skills)
- [Equipping Agents for the Real World — Anthropic Engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [The Complete Guide to Building Skills for Claude (PDF)](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)

### Community Resources & Repos
- [awesome-claude-skills — travisvn](https://github.com/travisvn/awesome-claude-skills) — 65+ production skills
- [awesome-claude-code — hesreallyhim](https://github.com/hesreallyhim/awesome-claude-code) — Skills + hooks + agents + plugins
- [awesome-claude-skills — ComposioHQ](https://github.com/ComposioHQ/awesome-claude-skills) — Curated production skills
- [claude-code-skills — levnikolaevich](https://github.com/levnikolaevich/claude-code-skills) — 65+ full-stack skills
- [claude-code-skills — daymade](https://github.com/daymade/claude-code-skills) — Professional marketplace
- [Official Anthropic Skills Repo](https://github.com/anthropics/skills)

### Articles & Blog Posts
- [VentureBeat: How Anthropic's Skills Make Claude Faster, Cheaper, More Consistent](https://venturebeat.com/technology/how-anthropics-skills-make-claude-faster-cheaper-and-more-consistent-for)
- [Dev.to: The Age of Skills Has Begun](https://dev.to/miaoshuyo/the-age-of-skills-has-begun-why-prompts-are-fading-fast-in-2026-2e3f)
- [Towards Data Science: Using Claude Skills with Neo4j](https://towardsdatascience.com/using-claude-skills-with-neo4j/)
- [Lee Han Chung: Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Pulumi: The Claude Skills I Actually Use for DevOps](https://www.pulumi.com/blog/top-8-claude-skills-devops-2026/)
- [SFEIR Institute: Advanced Best Practices & Common Mistakes](https://institute.sfeir.com/en/claude-code/claude-code-advanced-best-practices/)
- [Substack: 36 Claude Skills Examples](https://aiblewmymind.substack.com/p/claude-skills-36-examples)
- [Substack: I Watched 100+ People Hit the Same Skills Problems](https://natesnewsletter.substack.com/p/i-watched-100-people-hit-the-same)
- [alexop.dev: Understanding Claude Code's Full Stack](https://alexop.dev/posts/understanding-claude-code-full-stack/)
- [alexop.dev: Claude Code Customization Guide](https://alexop.dev/posts/claude-code-customization-guide-claudemd-skills-subagents/)
- [SitePoint: Claude Code Agent Teams](https://www.sitepoint.com/anthropic-claude-code-agent-teams/)
- [sankalp: Getting Better at Using Coding Agents](https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents/)
- [From Tasks to Swarms: Agent Teams](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/)
- [Understanding Claude Code: Skills vs Commands vs Subagents vs Plugins](https://www.youngleaders.tech/p/claude-skills-commands-subagents-plugins)
- [SFEIR Institute: Custom Commands and Skills](https://institute.sfeir.com/en/claude-code/claude-code-custom-commands-and-skills/)
