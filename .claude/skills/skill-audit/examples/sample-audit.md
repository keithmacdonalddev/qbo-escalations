# Skill Audit [corpus + static + research] — 2026-04-19-1430

This is a reference example showing the expected structure, tone, and evidence standard of an audit report with all three modes enabled. The corpus and findings are fictional but realistic.

---

## At a glance

- **Modes run:** corpus, static, research (research flag enabled)
- **Corpus:** 10 features, 14 plans, 16 reviews. Date range: 2026-01-20 to 2026-04-18.
- **Static:** 3 skills checked (cto-review, implementation-plan, skill-audit). 2 compliant with minor issues; 1 (skill-audit v0.1) not applicable to this historical run.
- **Research:** 2 skill-level contradictions found; 3 checklist updates proposed.
- **Health:** Drifting. Core skills are functional; specific patterns are not being caught early enough.

**Top 5 recommendations:**

1. **HIGH** (corpus) — Strengthen implementation-plan's handling of error-message specificity. Recurs in 7 of 10 reviews.
2. **HIGH** (corpus) — Audit-log-on-failure pattern appears in 4 reviews; add explicit planning prompt.
3. **MEDIUM** (static) — cto-review's SKILL.md mixes "agent" and "subagent" (B05 violation).
4. **MEDIUM** (research) — Current docs recommend `when_to_use` field separately from `description`; none of the three skills use this pattern.
5. **MEDIUM** (corpus) — Sample review's finding style is inconsistent with SKILL.md's stated standard; sharpen it.

## Corpus analysis

### Feature timeline

| Feature | Plans | Reviews | First | Latest | Status |
| ------- | ----- | ------- | ----- | ------ | ------ |
| email-change-flow | 1 | 2 | 4/10 | 8/10 | complete, recovered |
| password-reset | 1 | 1 | 7/10 | 7/10 | complete, shipped |
| two-factor-auth | 2 | 2 | 5/10 | 8/10 | complete, recovered |
| account-deletion | 1 | 1 | 6/10 | 6/10 | complete, intent gate failed |
| admin-user-search | 1 | 1 | 8/10 | 8/10 | complete, shipped |
| audit-log-export | 1 | 1 | 5/10 | 5/10 | complete, intent gate failed |
| session-timeout | 1 | 1 | 9/10 | 9/10 | complete, shipped clean |
| api-rate-limiting | 2 | 3 | 3/10 | 7/10 | complete, long recovery |
| notification-prefs | 1 | 1 | 7/10 | 7/10 | complete, shipped |
| bulk-user-import | 1 | 2 | 4/10 | 7/10 | complete, recovered |

First-review average: 5.8 | Latest-review average: 7.2 | Delta: +1.4.

### Feedback loop — **partially working**

Error-message specificity was first flagged in `cto-review-email-change-flow-2026-01-22-1045.md` (finding F1, High) and again in reviews of six other features across three months.

Plans written AFTER these reviews (notification-prefs, bulk-user-import v1) do not mention error-message specificity in their "exceeds bar" section. The implementation-plan skill's Step 2 is reading `temp-reviews/` but not surfacing this pattern effectively during the planning dialogue.

Evidence:
- `temp-reviews/cto-review-password-reset-2026-02-03-1122.md` finding F2: generic "something went wrong" across all failure modes.
- `temp-reviews/cto-review-two-factor-auth-2026-02-15-0945.md` finding F1: errors don't distinguish token expired from invalid.
- `.claude/plans/bulk-user-import.md` written 2026-03-10 after both above. "Exceeds bar" reads: "Good UX on errors, loading states, accessibility." No concrete items.

### Finding specificity — **drifting**

Sampled 30 findings across 16 reviews:

- 26 had `file:line` references (good).
- 22 had reproduction scenarios (acceptable, target higher).
- 19 had code-level fixes (**below standard — SKILL.md requires 100%**).

11 findings used vague language: "consider refactoring," "could be improved," "might need attention."

### Score trajectory — **healthy**

Delta of +1.4 across first-to-latest reviews. Reviews with multiple passes show consistent improvement.

## Static compliance

### cto-review (v0.4) — 1 violation

| Rule | Severity | Where | Notes |
| ---- | -------- | ----- | ----- |
| B05 (Consistent terminology) | MEDIUM | `cto-review/SKILL.md` | Uses "agent" in some sections and "subagent" in others. Pick one. |

All other rules pass.

### implementation-plan (v0.2) — 0 violations

Fully compliant with all 23 applicable rules.

### skill-audit (v0.1 — as it existed at audit time) — not applicable

This is a historical reference example; the audit is run under v0.2 which includes this static-check step. Skills that audit themselves are checked same as any other skill.

## Research findings

Canonical docs fetched successfully:

- ✓ `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
- ✓ `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`
- ✓ `https://code.claude.com/docs/en/skills`

### R-1 — MEDIUM — All skills should declare `when_to_use` field separately

**Confidence:** Medium

**Doc evidence:** Claude Code skills documentation — Frontmatter reference now lists `when_to_use` as a separate recommended field. Quote: *"Additional context for when Claude should invoke the skill."*

**Source:** `https://code.claude.com/docs/en/skills`

**Contradiction:** All three skills combine "what" and "when" into `description`. Current docs suggest splitting this for clearer skill discovery, especially with many skills installed.

**Affected skills:** cto-review, implementation-plan, skill-audit.

**Proposed fix:** Move trigger phrases from `description` into a new `when_to_use` field. Keep `description` focused on what the skill does.

### R-2 — LOW — Consider adding `paths` field for path-scoped skills

**Confidence:** Low

**Doc evidence:** Claude Code docs mention a `paths` field that limits when skills auto-activate. Quote: *"Glob patterns that limit when this skill is activated."*

**Source:** `https://code.claude.com/docs/en/skills`

**Observation:** Not a contradiction — none of the three skills are clearly path-scoped. The cto-review skill activates on any feature review regardless of language or stack, so path limiting may not apply. Flagged as LOW confidence because this is more "consider" than "must."

**Proposed action:** User decision. No required fix.

## Proposed checklist updates

Three potential additions to `references/best-practices-checklist.md`. Each includes the doc quote and suggested rule text.

### Proposed F10 — `when_to_use` field

**Category:** Frontmatter rules
**Severity:** LOW
**Check:** If the skill's description contains trigger phrases (e.g., "Use when..."), consider splitting them into a separate `when_to_use` field for clearer skill discovery in a crowded skill menu.
**Source:** Quote from `https://code.claude.com/docs/en/skills` — see research finding R-1.

### Proposed R04 — Reference file cross-links

**Category:** Reference file rules
**Severity:** LOW
**Check:** Reference files can link to other reference files for cross-reference, but the full content must also be reachable directly from SKILL.md in one level. Cross-links between references are additive, not hierarchical.
**Source:** Inferred from docs' progressive-disclosure discussion; not directly quoted, flagged for user review.

### Proposed SC05 — Shell specification for cross-platform scripts

**Category:** Script rules
**Severity:** LOW
**Check:** Skills that rely on shell commands in non-standard shells (PowerShell) should declare the `shell: powershell` frontmatter field. Default is bash.
**Source:** `https://code.claude.com/docs/en/skills` — Frontmatter reference.

User reviews these and either accepts (rule gets added to checklist with its ID finalized) or rejects. Next static audit applies any accepted rules.

## Recommendations

### 1. HIGH (corpus) — Make the recurring-findings surfacing active, not passive

**Pattern:** Error messages, rate limiting, and audit logging recur across reviews but aren't getting caught at plan time.

**Evidence:**
- 7 reviews flag error-message specificity.
- 5 reviews flag missing or incomplete rate limiting.
- 4 reviews flag audit-log silent-failure.

**Proposed edit:**
- File: `implementation-plan/SKILL.md`, Step 2.
- Current: "Surface them during the dialogue in Step 3."
- Proposed: Add an explicit sub-step requiring the planner to list the 3 most-common finding categories and probe each directly in the dialogue.

**Effort:** Small.

### 2. HIGH (corpus) — Add recurring categories to default exceeds-bar prompts

**Evidence:** See recommendation 1.

**Proposed edit:**
- File: `implementation-plan/SKILL.md`, Step 3 "Exceeds bar" dialogue.
- Add default prompts about error messages and audit-log failure handling.

**Effort:** Small.

### 3. MEDIUM (static) — Resolve "agent" vs "subagent" terminology in cto-review

**Evidence:** Rule B05 violation, cto-review SKILL.md.

**Proposed edit:** Search-replace to use "subagent" consistently (matches Claude Code docs).

**Effort:** Trivial.

### 4. MEDIUM (research) — Consider splitting description into description + when_to_use

**Evidence:** Research finding R-1.

**Proposed edit:** All three skills — move trigger phrases from `description` into a `when_to_use` field.

**Effort:** Small, but affects all three skills. Defer until user confirms this is worth adopting now rather than when more skills accumulate.

### 5. MEDIUM (corpus) — Sharpen cto-review sample for code-level fix standard

**Evidence:** 11 of 30 findings sampled lacked code-level fixes.

**Proposed edit:** Add a "Standard for findings" preface to `cto-review/examples/sample-review.md` with good/bad side-by-side examples.

**Effort:** Small.

## How to apply

Pick which recommendations to apply. Then paste this into Claude:

> "Apply recommendations 1, 2, 3, and 5 from temp-audits/skill-audit-2026-04-19-1430.md. Show me each edit before saving. Bump affected skill versions and update their 'last edited' dates."

For the checklist updates (research-mode output), a separate apply step:

> "Apply proposed checklist updates F10 and SC05 from temp-audits/skill-audit-2026-04-19-1430.md to skill-audit/references/best-practices-checklist.md. Skip R04 — I don't need that one yet."

Claude will open the files, make the proposed changes, and show them to you. You can accept, reject, or modify each one before anything is written. No code editing on your part.

## Dimensions with no signal

All dimensions from `references/analysis-dimensions.md` were checked. These came back clean:

- **Severity calibration (B)** — distribution realistic. Intent gate triggered on 3 of 10 features (30%).
- **Plan-to-review match (H)** — reviews check against the plan's acceptance criteria consistently.
- **Iteration cost (I)** — average 1.6 cycles per feature.

Report these as passing so the full picture is visible, not just the problems.

## When to run again

Every 10 additional features, or every 3 months, whichever comes first. Run with the `research` flag at most every 2-3 audits — doc evolution is worth catching but fetching every time is overhead.
