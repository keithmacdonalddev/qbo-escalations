---
name: skill-audit
description: Audits the three-skill family (implementation-plan, cto-review, skill-audit itself) across three modes. Corpus analysis finds patterns in plan and review outputs. Static audit checks skill files against encoded best practices. Research mode (opt-in via 'research' flag) fetches current Claude Code skill documentation and proposes updates to the checklist plus skill-level findings. Use periodically to tune skills based on real usage and evolving official guidance.
argument-hint: '[research]'
allowed-tools: Read, Grep, Glob, Bash, Write, WebFetch
context: fork
agent: general-purpose
---

<!-- Version: 0.2 — last edited 2026-04-19 -->

# Skill Audit

Audit the skill family across three modes. Each mode produces findings in a shared report.

- **Corpus mode** (always): analyzes plans in `.claude/plans/` and reviews in `temp-reviews/` for patterns. Requires at least 3 complete features.
- **Static mode** (always): reads each skill folder and checks against the best-practices checklist in `references/best-practices-checklist.md`. Runs regardless of corpus size.
- **Research mode** (opt-in): fetches current Claude Code skill documentation, proposes updates to the static checklist, and flags skill-level findings where current docs contradict existing skill patterns.

This skill does NOT edit any other skills. It produces a report. Applying recommendations is a separate deliberate action by the user (see Step 7).

If repository policy in `CLAUDE.md` or `.claude/rules/` conflicts with this skill, follow repository policy.

For the expected output structure, see [examples/sample-audit.md](examples/sample-audit.md).
For corpus analysis dimensions, see [references/analysis-dimensions.md](references/analysis-dimensions.md).
For the static rules checked, see [references/best-practices-checklist.md](references/best-practices-checklist.md).

## Step 1: Setup and argument parsing

Create the output directory: `mkdir -p temp-audits`.

Generate a timestamp:

```bash
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
```

Parse `$ARGUMENTS`:

- If `$ARGUMENTS` contains "research" (case-insensitive), enable research mode.
- Otherwise, research mode is off.

Note the mode in the report header.

## Step 2: Locate all sources

**Corpus:**

```bash
ls -la .claude/plans/*.md 2>/dev/null
ls -la temp-reviews/*.md 2>/dev/null
```

Count total plans, total reviews, unique feature-slugs.

**Skill folders:**

Check both standard locations:

```bash
for loc in .claude/skills ~/.claude/skills; do
  [ -d "$loc" ] && ls -d "$loc"/*/ 2>/dev/null
done
```

Record which skills are found, which location each is in, and whether any skill has the expected structure (SKILL.md present, references/ and examples/ as applicable).

## Step 3: Corpus analysis (conditional)

If unique feature count is less than 3, skip this step and note "Corpus analysis skipped: only N features (minimum 3 required)" in the report.

If unique feature count is 3 or more, proceed with the full corpus analysis:

**Group files by feature:**

For each unique feature-slug:

- Plans: all files whose base name starts with the slug (`<slug>.md`, `<slug>-v1.md`, `<slug>-v2.md`). Sort by file modification time (oldest to newest). Most recent is "current."
- Reviews: all files matching `cto-review-<slug>-<timestamp>.md`. Sort by the timestamp in the filename.

**Read every plan and review file completely.** Full reads — the analysis depends on specific content.

**Apply each dimension from `references/analysis-dimensions.md`.** Record findings with evidence; every claim must cite specific files or excerpts.

Dimensions checked: finding specificity, severity calibration, finding recurrence, feedback loop health, plan schema coverage, plan version trajectory, review trajectory, plan-to-review match, iteration cost.

## Step 4: Static audit of skill files

Always runs.

For each skill folder found in Step 2:

1. Read the skill's `SKILL.md` completely.
2. Read any reference files in the skill's `references/` directory.
3. Read any sample files in the skill's `examples/` directory.
4. Read any script files in the skill's `scripts/` directory.

Apply every rule from `references/best-practices-checklist.md`. Each rule specifies:

- What to check.
- Where to check (frontmatter, body, references, samples, scripts, or cross-skill).
- Severity if violated (MEDIUM or LOW; HIGH only for rules explicitly marked so).
- What evidence to capture.

For every violation found, record:

- The rule number and description.
- The skill and file where violated.
- The specific line or pattern.
- The severity.

If a skill passes all checks, record it as compliant and note which checks were performed.

## Step 5: Research audit (conditional)

Only runs if research mode was enabled in Step 1.

**Fetch current documentation:**

Use WebFetch to retrieve these canonical URLs:

- `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
- `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`
- `https://code.claude.com/docs/en/skills`

If a fetch fails, note the URL and the failure reason in the report, and continue with whichever docs succeeded. Do not abort the research step.

**Compare docs to checklist:**

For each rule-like passage in the fetched docs:

1. Check whether the rule is already in `references/best-practices-checklist.md`.
2. If yes and the wording matches substantively, mark as "covered."
3. If yes but the doc's wording differs meaningfully, propose a checklist update with old text, new text, and URL.
4. If not in the checklist, propose adding it with the exact doc quote and URL.

**Apply harness constraints to every research finding:**

Every finding about a specific skill must include:

- A verbatim quote from the doc (under 15 words per copyright rules; paraphrase rest).
- The source URL.
- The specific pattern in the skill that contradicts the doc.
- Severity derived from doc language:
  - "must" / "required" / "always" → MEDIUM
  - "should" / "recommend" / "prefer" → LOW
  - Advisory only ("consider" / "you might") → LOW with confidence = Low
- Self-assigned confidence (High / Medium / Low) based on:
  - How directly the skill contradicts the doc wording.
  - How unambiguous the doc is.
  - Whether the skill may be following a superseded-but-still-valid pattern.

**Restrictions (reduce false positives):**

- Flag contradictions only, not absences. "The docs mention X; skill doesn't do X" is not a finding unless the doc explicitly says skills should do X.
- No HIGH severity from research mode unless the doc flags a breaking change or security issue.
- Low-confidence findings are listed separately under "Review needed" so the user knows to sanity-check them.

**Output two sets:**

- Research findings (skill-level non-compliance against current docs).
- Proposed checklist updates (additions or rewordings to the static checklist).

## Step 6: Write the report

Write to `temp-audits/skill-audit-<timestamp>.md`.

Report structure (mirrors `examples/sample-audit.md`):

1. **At a glance** — modes run, corpus size, skills checked, top recommendations.
2. **Corpus analysis** — findings from Step 3 (or a note that it was skipped).
3. **Static compliance** — per-skill compliance summary and violations from Step 4.
4. **Research findings** — if research mode ran, skill-level contradictions against current docs.
5. **Proposed checklist updates** — if research mode ran, additions or rewordings to apply to `references/best-practices-checklist.md`.
6. **Recommendations** — merged, ranked by impact, every recommendation cites its evidence source (corpus finding, static rule, or research URL).
7. **How to apply** — plain-language instructions for the user.

**Evidence standard** for every recommendation:

- Corpus-based: must cite at least two specific corpus files.
- Static-based: must cite the rule number and skill file:line.
- Research-based: must quote the doc passage and cite the URL.

**Ranking:**

- HIGH = affects every future output, or a rule the docs mark as required.
- MEDIUM = affects a specific pattern in ~50% of cases, or a "should" in the docs.
- LOW = stylistic, edge case, or "consider" in the docs.

## Step 7: Report to conversation

After writing the report, output:

```
Skill Audit [<modes run>] — <timestamp>

Corpus: <feature count> features (<date range>) | <health: healthy|drifting|struggling|not-run>
Static: <compliance-summary-per-skill>
Research: <findings count, or "not run">

Recommendations: <high-count> High | <medium-count> Medium | <low-count> Low
Report: temp-audits/skill-audit-<timestamp>.md

To apply recommendations: open the report and tell Claude:
"Apply recommendations <numbers> from temp-audits/skill-audit-<timestamp>.md."

To apply proposed checklist updates:
"Apply the proposed checklist updates from temp-audits/skill-audit-<timestamp>.md to skill-audit/references/best-practices-checklist.md."
```

The last two lines give the user a copy-paste workflow. Without them, the audit is information that never gets acted on.

## Related skills

This skill audits the outputs and files of two other skills:

- **implementation-plan**: produces plan files in `.claude/plans/` that this audit reads (corpus mode) and whose skill files this audit checks (static and research modes).
- **cto-review**: produces review files in `temp-reviews/` that this audit reads (corpus mode) and whose skill files this audit checks (static and research modes).

This skill is most useful when the other two have been used at least 3 times. Each skill works standalone, but skill-audit provides full value only when the other two have produced enough data to analyze.

Note: skill-audit audits itself too. The static and research modes check this skill's own files against the same rules applied to the other skills.
