# Best practices checklist

The canonical rules applied by the static audit. Each rule has an ID, a description, where it applies, severity if violated, and a source reference.

When research mode proposes a new rule or a reworded rule, it ends up here after the user reviews and accepts the change.

---

## Frontmatter rules

### F01 — Name format [MEDIUM]
**Check:** The `name` field in frontmatter is lowercase, uses hyphens only, contains no spaces, and does not use reserved words ("anthropic", "claude").
**Source:** Skill authoring best practices — Naming conventions section.

### F02 — Description has what and when [MEDIUM]
**Check:** The `description` field includes both what the skill does AND when to use it. Trigger phrases or contexts should be present.
**Source:** Skill authoring best practices — Writing effective descriptions.

### F03 — Description third person [LOW]
**Check:** Description is written in third person ("Processes Excel files") not first or second ("I can help you" / "You can use this").
**Source:** Skill authoring best practices — Writing effective descriptions.

### F04 — Description not vague [MEDIUM]
**Check:** Description is specific. Forbidden phrases include "helps with documents," "processes data," "does stuff with files." Must name the specific domain and triggers.
**Source:** Skill authoring best practices — Writing effective descriptions, anti-examples.

### F05 — Description length [LOW]
**Check:** Description is under 1024 characters. Combined description + when_to_use is under 1536 characters (Claude Code truncates at that limit).
**Source:** Claude Code skills documentation — Frontmatter reference.

### F06 — argument-hint when skill takes arguments [LOW]
**Check:** If the skill references `$ARGUMENTS` or `$N` in the body, the frontmatter has an `argument-hint` field that describes the expected input format.
**Source:** Claude Code skills documentation — Frontmatter reference.

### F07 — allowed-tools declared for tool-using skills [LOW]
**Check:** If the skill calls tools in its body (bash commands, WebFetch, etc.), the frontmatter declares those tools in `allowed-tools`.
**Source:** Claude Code skills documentation — Pre-approve tools for a skill.

### F08 — context: fork has a task, not just reference [LOW]
**Check:** If frontmatter sets `context: fork`, the skill body contains an actionable task (not just reference content). A forked subagent with only reference material produces no useful output.
**Source:** Claude Code skills documentation — Run skills in a subagent.

### F09 — Version header present [LOW]
**Check:** Immediately below the frontmatter, the SKILL.md has a version comment in the format `<!-- Version: X.Y — last edited YYYY-MM-DD -->`.
**Source:** Convention for this skill family.

---

## Body rules

### B01 — Body under 500 lines [MEDIUM]
**Check:** SKILL.md body (excluding frontmatter) is under 500 lines. Over 500 lines indicates content should be split into reference files.
**Source:** Skill authoring best practices — Token budgets.

### B02 — Steps clearly numbered [LOW]
**Check:** Multi-step workflows use numbered headings like `## Step 1: ...` or similar. Ad-hoc structure is harder for Claude to follow consistently.
**Source:** Skill authoring best practices — Use workflows for complex tasks.

### B03 — No Windows paths [MEDIUM]
**Check:** File paths use forward slashes only. Backslashes (`\`) in paths indicate Windows-style paths that break on Unix.
**Source:** Skill authoring best practices — Anti-patterns.

### B04 — No time-sensitive content [LOW]
**Check:** Body does not contain phrases like "after June 2025," "before August," or "starting next year." Such content becomes wrong as time passes.
**Source:** Skill authoring best practices — Content guidelines.

### B05 — Consistent terminology [LOW]
**Check:** The body does not mix synonyms for the same concept. Examples of common drift: "agent" vs "subagent," "endpoint" vs "URL" vs "path," "field" vs "box" vs "element."
**Source:** Skill authoring best practices — Use consistent terminology.

### B06 — Output format example present [LOW]
**Check:** If the skill produces structured output, the body contains at least one concrete example of the expected format.
**Source:** Skill authoring best practices — Template pattern.

### B07 — Single recommended path, not many options [LOW]
**Check:** Body does not present many alternatives for the same task ("you could use A, or B, or C, or..."). Provide a default with an escape hatch for exceptions.
**Source:** Skill authoring best practices — Anti-patterns.

---

## Reference file rules

### R01 — References one level deep [MEDIUM]
**Check:** Reference files are linked from SKILL.md directly. SKILL.md → ref.md → other-ref.md is a violation; Claude may partially read nested references.
**Source:** Skill authoring best practices — Avoid deeply nested references.

### R02 — No dangling references [MEDIUM]
**Check:** Every file path linked from SKILL.md or reference files actually exists in the skill folder.
**Source:** Inferred from progressive disclosure guidance.

### R03 — Long references have TOC [LOW]
**Check:** Reference files over 100 lines include a "## Contents" section near the top listing their major sections.
**Source:** Skill authoring best practices — Structure longer reference files.

---

## Sample file rules

### S01 — Sample exists for skills that produce structured output [LOW]
**Check:** If the skill produces a structured output (review, plan, audit, etc.), an `examples/` folder exists with at least one complete sample.
**Source:** Skill authoring best practices — Examples pattern.

### S02 — Sample referenced from SKILL.md [LOW]
**Check:** The SKILL.md explicitly links to the sample file, ideally in both the intro and the output-format step.
**Source:** Inferred from progressive disclosure guidance.

### S03 — Sample matches workflow [MEDIUM]
**Check:** The sample's structure reflects what SKILL.md describes as output. If SKILL.md says the report has 10 sections, the sample has 10 sections.
**Source:** Inferred — without this alignment, Claude mimics the sample over the instructions and produces drift.

---

## Script rules

### SC01 — Error handling present [MEDIUM]
**Check:** Scripts handle common failure modes (missing files, bad arguments, empty input) with clear messages instead of crashing or punting to Claude.
**Source:** Skill authoring best practices — Solve, don't punt.

### SC02 — No magic constants [LOW]
**Check:** Scripts do not use unexplained numeric literals for timeouts, retries, limits, etc. Constants should be named and documented.
**Source:** Skill authoring best practices — Ousterhout's law / magic numbers.

### SC03 — Forward slashes in script paths [LOW]
**Check:** Script file paths and references use forward slashes. Same as B03 but applied to script content.
**Source:** Skill authoring best practices — Anti-patterns.

### SC04 — Execution intent clear [LOW]
**Check:** SKILL.md is explicit about whether Claude should execute a script ("Run `x.sh`") or read it as reference ("See `x.sh` for the algorithm"). Ambiguous references cost tokens.
**Source:** Skill authoring best practices — Provide utility scripts.

---

## Cross-skill consistency rules

### X01 — Related skills section [LOW]
**Check:** Each SKILL.md in this family has a "Related skills" section that mentions the other skills and clarifies each works standalone.
**Source:** Convention for this skill family.

### X02 — Version headers across family [LOW]
**Check:** All skills in the family carry version headers with consistent format.
**Source:** Convention for this skill family.

### X03 — Canonical directories referenced consistently [LOW]
**Check:** Skills that refer to the canonical directories (`.claude/plans/`, `temp-reviews/`, `temp-audits/`) use consistent names. No drift like `reviews/` or `plans-dir/`.
**Source:** Convention for this skill family.

---

## How to add new rules

When research mode proposes a new rule, it arrives as a block under the appropriate category. Each proposed rule has a placeholder ID (F10, B08, etc.) that the user can accept as-is or renumber during review.

The user reviews proposed additions and either accepts or rejects before the rule becomes active in future static audits.
