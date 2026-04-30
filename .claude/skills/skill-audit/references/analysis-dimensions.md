# Analysis dimensions

The specific things the audit looks for. Each dimension has: what to measure, what signal it produces, and what kind of recommendation it might generate.

## A. Finding specificity (cto-review quality)

**What to measure:** Across all reviews, sample findings and check each for:
- Has `file:line` reference.
- Has concrete reproduction scenario (not "this might break").
- Has code-level fix (not "consider refactoring").

**Signal:**
- >90% specific = healthy.
- 70-90% = drifting; sample is teaching a looser standard than SKILL.md requires.
- <70% = the sample review or the workflow is failing to enforce the format.

**Recommendation pattern:** Sharpen the sample review's findings. Claude mimics the sample more than it mimics instructions.

## B. Severity calibration

**What to measure:** Distribution of severities across all findings. Distribution of overall scores across all reviews.

**Signal:**
- Findings cluster at MEDIUM with few HIGH/CRITICAL = underrating bias despite the calibration check.
- Scores cluster at 5-7 = regression to mean; the rubric isn't producing real discrimination.
- Intent gate never triggers across many features = too soft.
- Intent gate triggers every time = too harsh, or the "exceeds bar" threshold is unrealistic.

**Recommendation pattern:** Tighten or loosen the calibration section. Adjust wording of the "QA can reproduce in 60 seconds" test if it's being ignored.

## C. Finding recurrence across features

**What to measure:** Which finding categories appear in multiple reviews across different features? Group by topic (error messages, rate limiting, audit logging, input validation, etc.).

**Signal:** A finding category appearing in >40% of reviews is a codebase-wide pattern, not a feature-specific bug. It should be getting caught at plan time, not review time.

**Recommendation pattern:** Add explicit prompts to the implementation-plan Step 3 dialogue for recurring categories. Example: if "rate limiting missing" appears in 6 of 10 reviews, add a planning question: "Does this endpoint need rate limiting? Default to yes for any authenticated endpoint."

## D. Feedback loop health

**What to measure:** For each recurring finding from dimension C, check whether plans written AFTER those findings surfaced include the relevant item in their scope.

**Signal:**
- Pattern found in early reviews, later plans address it = feedback loop working.
- Pattern found in early reviews, later plans still miss it = the implementation-plan skill's Step 2 (read recent reviews) isn't effective.

**Recommendation pattern:** Strengthen implementation-plan Step 2. Make the recurring-findings check explicit rather than subtle. Maybe: "List the top 3 finding categories from the last 5 reviews. Ask the user directly whether each applies to this feature."

## E. Plan schema coverage

**What to measure:** For each plan, check which sections are present, thorough, or thin.

Thin indicators:
- "Risks" with only 1-2 items (schema expects at least 3).
- "Exceeds bar" with generic items ("handle errors well", "make it fast") rather than concrete ones.
- "Out of scope" empty or trivial.
- "Deferred" never used (users don't think in terms of deferrals).

**Signal:** Consistent thinness in the same section across many plans = the dialogue isn't pushing hard enough on that section.

**Recommendation pattern:** Update the specific dialogue questions in implementation-plan Step 3. Add a follow-up probe when the user tries to skip or shortcut a section.

## F. Plan version trajectory

**What to measure:** For features with multiple plan versions, compare v1 vs latest.

**Signal:**
- Later versions have more acceptance criteria, more risks, more concrete exceeds-bar items = dialogue helps on iteration.
- Later versions identical to earlier (just timestamped) = dialogue not adding value on iteration.
- Specific categories of content consistently added in v2 that should have been in v1 = systematic blind spot.

**Recommendation pattern:** Add the v2-added categories to v1 dialogue as explicit prompts.

## G. Review trajectory within a feature

**What to measure:** For features with multiple reviews, compare first-review findings to last-review findings.

**Signal:**
- Severity counts dropping across reviews = reviews drove real fixes.
- Same findings appearing in review 1 and review 3 = fixes aren't addressing root cause, or findings aren't specific enough to be actionable.
- New findings appearing in later reviews that first review missed = review depth or coverage is inconsistent.

**Recommendation pattern:** If same findings recur across reviews, sharpen fix specificity in the sample. If new findings appear late, the workflow's read-all-files or data-flow-trace step may be being shortcut.

## H. Plan-to-review match

**What to measure:** For each feature, read the final plan's acceptance criteria, then check the corresponding review's Plan Fidelity table.

**Signal:**
- Plan Fidelity items match plan's acceptance criteria = the handoff format is working.
- Plan Fidelity mentions items not in the plan = review is using something other than the plan.
- Plan's acceptance criteria ignored by review's Plan Fidelity = the section isn't actually being read.

**Recommendation pattern:** This is rare but serious. If the handoff is broken, both skills need alignment.

## I. Iteration cost

**What to measure:** For each feature, count total plan versions + reviews to reach final state.

**Signal:**
- Consistently high counts (4+) across features = plans aren't detailed enough upfront; iteration is absorbing the cost instead.
- Consistently low (1 plan + 1 review) across features = plans are strong OR reviews are too soft to require iteration.

**Recommendation pattern:** Rarely a single-skill edit. Usually indicates a process-level recommendation — either spend more time planning, or tighten review standards.

## Applying these dimensions

The audit runs every dimension. Not every dimension will produce a finding — some will come back clean. The report should list which dimensions were checked and what each found (or "no signal") so the user can see the full picture.

Recommendations are ranked by impact:
- **HIGH** = affects majority of future outputs.
- **MEDIUM** = affects a specific recurring pattern.
- **LOW** = stylistic or edge-case.

A dimension can produce no recommendation (everything checked out). That is a healthy signal and should be reported as such.
