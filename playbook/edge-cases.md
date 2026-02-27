# Edge Cases — Cross-Category Weirdness

Issues that span multiple categories or defy simple classification. When an escalation does not fit neatly into one category, check here.

---

## The "Everything Broke At Once" Pattern

**Symptoms:** Customer reports multiple unrelated features failing simultaneously — invoices not sending, bank feeds disconnected, reports showing wrong data.

**Likely root cause:** Almost always one of:
1. **Browser issue** — corrupted cache, problematic extension, outdated browser
2. **Session problem** — stale authentication, multiple QBO tabs open
3. **QBO outage** — check https://status.quickbooks.intuit.com
4. **Subscription lapsed** — billing failure can degrade features before full suspension

**Diagnosis path:** Start with Technical category. Do NOT chase each symptom individually until you have ruled out the common root causes above.

---

## Bank Feed + Reconciliation Death Spiral

**Symptoms:** Customer connected bank feeds mid-year. Now they have duplicate transactions (manual entries + bank feed imports), reconciliation is off, and reports show inflated revenue/expenses.

**Root cause:** Customer was manually entering transactions AND importing via bank feed for the same period.

**Resolution:**
1. Identify the overlap period (when bank feed was connected vs when manual entry stopped)
2. For each duplicate: delete the MANUAL entry, keep the bank feed entry (it has the bank reference)
3. Re-reconcile affected months from the oldest forward
4. Set up bank rules to prevent future manual entry of bank-feed-covered transactions

**Cross-refs:** [Bank Feeds](categories/bank-feeds.md), [Reconciliation](categories/reconciliation.md), [Reports](categories/reports.md)

---

## The Payroll-Permissions Mismatch

**Symptoms:** User has Admin role in QBO but cannot access payroll features. Gets "You don't have permission" or payroll menu items are missing.

**Root cause:** QBO permissions and Payroll permissions are SEPARATE systems. A user can be a QBO Admin but have no payroll access.

**Resolution:**
1. **Gear icon > Payroll Settings > [Manage payroll users]** — check if the user is listed
2. Add the user to payroll with the appropriate role (Full Access or View Only)
3. Note: Payroll roles are independent of QBO roles

**Cross-refs:** [Permissions](categories/permissions.md), [Payroll](categories/payroll.md)

---

## The "Tax Rate Changed" Cascade

**Symptoms:** Customer's invoices suddenly have wrong sales tax. Old invoices look fine, new ones have wrong rates. Customer didn't change anything.

**Likely root cause:** Intuit updated the Automated Sales Tax (AST) database. This can happen when:
- A jurisdiction changed its tax rate (new legislation)
- Intuit corrected an error in their rate database
- The customer's business address was geo-coded to a different tax jurisdiction after an AST update

**Resolution:**
1. Verify the new rate is actually correct by checking the jurisdiction's tax authority website
2. If the new rate IS correct: no fix needed, just explain the change
3. If the new rate is WRONG: override on individual invoices and report to Intuit
4. Check if the customer's business address is precisely correct (QBO uses address for geo-coding)

**Cross-refs:** [Tax](categories/tax.md), [Invoicing](categories/invoicing.md)

---

## The Multi-Company Confusion

**Symptoms:** Customer sees transactions, invoices, or settings from a different company. Data appears mixed or wrong.

**Root cause:** Customer has multiple QBO company files and:
1. Is logged into the wrong company
2. Has browser tabs open to different companies (session cookies can cross over)
3. Recently switched companies and QBO did not fully reload

**Resolution:**
1. Sign out of QBO completely (not just close the tab)
2. Clear cookies for intuit.com
3. Sign in and select ONLY the correct company
4. Do not open multiple companies in the same browser — use incognito for the second company

**Cross-refs:** [Technical](categories/technical.md)

---

## The "Accountant Broke It" Scenario

**Symptoms:** Customer reports that things changed after their accountant worked in the file. Common changes: journal entries moved money between accounts, transactions were reclassified, reconciliation was undone, chart of accounts was modified.

**Key point:** Accountants working through QBOA have FULL access — they can modify anything.

**Resolution:**
1. **Reports > Audit Log** — filter by the accountant's name to see all changes
2. Identify what was changed and whether the changes were intentional
3. Contact the accountant BEFORE reversing any changes — they may have had a valid accounting reason
4. If changes need to be reversed: undo them in reverse chronological order

**Cross-refs:** [Permissions](categories/permissions.md), [Reconciliation](categories/reconciliation.md), [Reports](categories/reports.md)

---

## The Year-End Closing Trap

**Symptoms:** Customer is in a new fiscal year but reports are showing unexpected balances. Opening balances for the new year don't match prior year ending balances. Retained Earnings is wrong.

**Root cause:** QBO does NOT have a formal "close the books" process like desktop QuickBooks. Instead:
1. Retained Earnings is calculated automatically from prior-year income/expense accounts
2. If transactions are added or modified in a closed period, Retained Earnings changes
3. The "Close the Books" setting (**Gear icon > Account and Settings > Advanced > Close the Books**) only WARNS or requires a password — it does not truly lock the period

**Resolution:**
1. Turn on Close the Books with a password: **Gear icon > Account and Settings > Advanced > Accounting > Close the books > YES > Require password**
2. Review Audit Log for changes to transactions dated before the closing date
3. Reverse any unauthorized changes to closed-period transactions
4. Verify Retained Earnings: run P&L for the prior year — net income should equal the change in Retained Earnings

**Cross-refs:** [Reports](categories/reports.md), [Reconciliation](categories/reconciliation.md), [Permissions](categories/permissions.md)

---

## The Migration Hangover

**Symptoms:** Customer recently migrated from QuickBooks Desktop to QBO. Data seems wrong — account balances off, transactions missing, chart of accounts different, or features missing.

**Key facts:**
1. Desktop-to-Online migration is lossy — not everything transfers perfectly
2. Common losses: memorized transactions (become recurring), custom reports (must be recreated), audit trail (does not transfer), attachments (may not transfer), inventory details (simplified)
3. The migration creates opening balance journal entries on the conversion date
4. Historical detail may be summarized rather than transferred transaction-by-transaction

**Resolution:**
1. Compare the last desktop Balance Sheet to the first QBO Balance Sheet on the conversion date — they should match
2. If they don't match: check Opening Balance Equity for discrepancies
3. For missing transactions: they may be in the desktop file but not transferred. Customer may need to manually re-enter or use CSV import.
4. For feature gaps: some desktop features don't exist in QBO. Set expectations.

**Cross-refs:** [Reports](categories/reports.md), [Technical](categories/technical.md)

---

## Red Flags — When to Stop and Escalate Immediately

These patterns indicate issues that are beyond standard troubleshooting:

1. **Data inconsistency**: Balance Sheet doesn't balance, or the same report shows different numbers when run twice
2. **Unauthorized access**: Customer reports transactions or changes they didn't make, and Audit Log shows an unknown user
3. **Financial loss**: Direct deposit went to wrong person, duplicate payments, customer was overcharged
4. **Legal/compliance**: Tax forms filed with wrong amounts, regulatory deadline at risk
5. **Mass impact**: Multiple customers reporting the same issue (possible QBO platform bug)

For any of these: document everything, escalate to supervisor, and notify Intuit if it appears to be a platform-level issue.
