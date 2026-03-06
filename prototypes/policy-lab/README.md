# Policy Lab

`Policy Lab` is a standalone repo-aware evaluator for agentic control files.

It stays isolated inside [prototypes/policy-lab](C:/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/prototypes/policy-lab) and does not modify the production `client/` or `server/` app paths.

## What It Evaluates

The app compares `v1` vs `v2` of the same file family only:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/hooks/*`
- `.claude/skills/**/SKILL.md`
- `.claude/agents/*`
- `prompts/*`
- `playbook/system-prompt.md`
- custom uploaded agentic files

It does not compare unlike file types against each other.

## What It Uses

For each comparison, Policy Lab uses:

- the real current repo structure
- current project artifact inventory
- weighted policy scoring
- family-specific benchmark packs
- hard safety gates
- matched and missing signal evidence
- saved comparison history

## Start The App

From Git Bash:

```bash
cd /c/Users/NewAdmin/Desktop/PROJECTS/qbo-escalations/prototypes/policy-lab
npm run app
```

Then open:

```text
http://127.0.0.1:4179
```

## How To Use It

1. Pick a file family.
2. Pick a project file from the dropdown if you want the current repo version as `Current`.
3. Click `Load Selected Project File`.
4. Upload the proposed `v2` in the `Proposed` slot.
5. Or upload both files manually if neither version should come from the current repo.
6. Keep the comparison within the same file family.
7. Choose a mode:
   - `Full Comparison`
   - `Policy Scoring Only`
   - `Benchmark Pack Only`
8. Click `Run Evaluation`.

## What Gets Saved

Every comparison is written to:

- `data/runs/<timestamp>.json`

The UI reads recent history from that folder and shows the latest saved comparisons with family and target path.

## Important Limit

This app is much broader than a plain text diff, but it is still a static repo-aware evaluator. It does not yet run a live external agent end-to-end on benchmark tasks. Re-run it whenever:

- repo workflow changes materially
- hooks, skills, prompts, or agent definitions change
- process rules change
- the candidate `v2` changes again
