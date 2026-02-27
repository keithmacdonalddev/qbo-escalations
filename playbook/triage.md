# Rapid Triage Cheat Sheet

Use this for the first 30 seconds of any escalation. Identify the category, check for platform issues, then go to the right playbook page.

---

## Step 1: Is QBO Itself Down?

Before diagnosing anything, rule out a platform outage:
- **Intuit Status Page**: https://status.quickbooks.intuit.com
- If there is an active incident, tell the agent immediately — no further troubleshooting needed until the outage is resolved.

---

## Step 2: Identify the Category (by Keyword)

| If the agent says... | Category | Go to |
|---------------------|----------|-------|
| paycheck, payroll, W-2, 1099, direct deposit, withholding, accrual, overtime, garnishment | **Payroll** | [payroll.md](categories/payroll.md) |
| bank feed, bank connection, duplicates, matching, transactions missing, Yodlee | **Bank Feeds** | [bank-feeds.md](categories/bank-feeds.md) |
| reconcile, beginning balance, bank statement, doesn't match, cleared, uncleared | **Reconciliation** | [reconciliation.md](categories/reconciliation.md) |
| can't access, permission, invite, user, admin, accountant, role | **Permissions** | [permissions.md](categories/permissions.md) |
| charge, subscription, price, cancel, upgrade, downgrade, payment method | **Billing** | [billing.md](categories/billing.md) |
| sales tax, tax rate, exempt, 1099 (filing), tax form, tax table | **Tax** | [tax.md](categories/tax.md) |
| report, P&L, balance sheet, profit and loss, aging, cash basis, accrual | **Reports** | [reports.md](categories/reports.md) |
| slow, error, can't log in, browser, import, integration, app, white screen | **Technical** | [technical.md](categories/technical.md) |
| invoice, estimate, payment link, recurring, credit memo, email not received | **Invoicing** | [invoicing.md](categories/invoicing.md) |
| multiple categories, weird, nothing makes sense | **Edge Cases** | [edge-cases.md](edge-cases.md) |

---

## Step 3: Severity Quick-Check

| Condition | Severity | Action |
|-----------|----------|--------|
| Cannot run payroll (pay date is today/tomorrow) | **P1** | Stay on line. Escalate to Intuit Payroll if needed. |
| Cannot access QBO at all | **P1** | Check outage page, then technical troubleshooting. |
| Data loss or corruption suspected | **P1** | Document everything. Escalate immediately. |
| Major feature broken but business can continue | **P2** | Resolve or workaround during the call. |
| Minor issue, customer frustrated but functional | **P3** | Standard diagnosis and resolution. |
| How-to question | **P4** | Educate and document. |

---

## Step 4: The Five Universal Questions

Ask these BEFORE diving into category-specific diagnosis. They eliminate the most common root causes in any category:

1. **"When did it last work correctly?"** — Establishes timeline. If "never," it is a setup issue. If "yesterday," something changed.
2. **"What changed since then?"** — Software update, new employee, bank password change, browser update, someone else was in the file.
3. **"Is it affecting one thing or everything?"** — One invoice vs all invoices. One employee vs all employees. Scope determines root cause.
4. **"What exactly do you see?"** — Get the exact error message, exact screen, exact behavior. "It doesn't work" is not enough.
5. **"Has anyone else tried?"** — If another user can do it successfully, it is a permissions or browser issue, not a data issue.

---

## Step 5: Quick Wins (Try These First)

Before deep troubleshooting, these fix ~30% of all issues:

| Try This | Fixes |
|----------|-------|
| Clear browser cache + cookies for intuit.com | Stale sessions, display glitches, "something went wrong" errors |
| Try incognito/private window | Extension conflicts, cached bad state |
| Try a different browser | Browser-specific rendering or JavaScript issues |
| Sign out completely and sign back in | Session expiry, permission cache, wrong company loaded |
| Check a different user's view | Distinguishes user-specific vs company-wide issues |

---

## Seasonal Awareness

QBO issues cluster around predictable dates. Knowing the calendar helps you diagnose faster:

| Period | High-Risk Categories | Why |
|--------|---------------------|-----|
| **Jan 1-31** | Payroll, Tax | W-2/1099 generation, year-end closing, new tax tables |
| **Feb-Apr** | Tax, Reports | Tax filing season, CPA requests for reports, 1099 corrections |
| **Apr 15** | Tax | Tax deadline — last-minute filing issues spike |
| **Jun-Jul** | Billing | Mid-year subscription renewals, promo expirations |
| **Sep-Oct** | Payroll | Q3 payroll tax filings, new hire onboarding for fiscal year |
| **Nov-Dec** | Reconciliation, Reports | Year-end close preparation, accountant reviews |
| **Any 1st/15th** | Payroll | Pay date issues, direct deposit timing |
| **End of any month** | Bank Feeds, Reconciliation | Monthly bank statement reconciliation |

---

## Subscription Tier Quick-Check

Before troubleshooting a feature, verify the customer's plan supports it:

| Feature | Minimum Tier |
|---------|-------------|
| Multiple users | Essentials |
| Bill pay | Essentials |
| Time tracking | Plus |
| Inventory | Plus |
| Classes & Locations | Plus |
| Purchase orders | Plus |
| Budgets | Plus |
| Custom fields | Advanced |
| Custom user roles | Advanced |
| Batch transactions | Advanced |
| Workflows / automations | Advanced |
| Revenue recognition | Advanced |

If the customer is asking about a feature their tier doesn't support, the "fix" is an upgrade conversation, not troubleshooting.
