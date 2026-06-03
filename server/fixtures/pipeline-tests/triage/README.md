# Triage Agent Test Cases — No Fixtures Here

> **This directory no longer holds runtime triage fixtures.** The 5 synthetic
> JSON fixtures that used to live here (`P1-payroll-outage.json`,
> `P2-bank-feeds-stale.json`, `P2-invoicing-missing-fields.json`,
> `P3-reports-permission.json`, `P4-reconciliation-question.json`) were removed
> on **2026-06-02**. No code reads this folder for triage anymore.

## Where triage test input comes from now

The Stage 4 (Triage Agent) test sources its input cases **exclusively from
real, operator-approved image-parser outputs** — the approved-parser-output
pool. There is no synthetic data in the triage test path.

- The pool is resolved by `server/src/lib/approved-triage-cases.js` (the single
  source of truth: it flattens each approved parser output into a runnable
  triage case with a stable id `${sourceFixtureName}#${outputIndex}`).
- `GET /api/triage-tests/cases` serves that list to the operator's pick-a-case
  UI (each entry is a short label/preview, not the full `parserText`).
- `POST /api/triage-tests/run` executes a case:
  - `{ "caseId": "<id>" }` runs that **specific** approved case.
  - **no body** runs **one approved case at random** from the pool.
  - **"Run all"** loops the case ids **client-side**, calling `/run` once per
    case in sequence (the server enforces a single-flight triage test guard, so
    runs are sequential, not parallel).

## DO NOT add fake fixtures

**Do not add synthetic / fake `*.json` fixtures here — or anywhere else in the
triage test path.** No loader reads this directory, so a dropped file would
either do nothing or, worse, mislead a future contributor into re-wiring fake
data back in. That is exactly what must not happen.

**No fake data.** Triage testing uses real, operator-approved cases only.

### To add a new triage test case

Approve a new **image-parser** output. Because the triage case pool is derived
from approved parser outputs, the new approval automatically becomes an
available triage case too — nothing needs to be added to this folder.
