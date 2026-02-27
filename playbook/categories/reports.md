# Reports Escalations

## Common Issues

- Profit & Loss report shows wrong amounts or unexpected categories
- Balance Sheet does not balance or shows unexpected entries
- Cash vs accrual basis confusion — report numbers differ from expectations
- Custom report not saving or not returning expected data
- Report exports (PDF, Excel) missing data or formatting incorrectly
- Accounts Receivable (A/R) Aging report shows paid invoices
- Accounts Payable (A/P) Aging report shows paid bills
- Report filters not working — includes data that should be excluded
- Class or location reports showing uncategorized transactions
- Report runs slowly or times out
- Comparative reports (this year vs last year) not aligning correctly
- Customer/vendor balance reports do not match individual records

## Quick Diagnosis

**Always ask first:**
1. Which report? (exact name from the Reports menu)
2. What date range and basis (cash or accrual)?
3. What do they expect to see vs what are they actually seeing?
4. Are they using classes, locations, or any custom filters?
5. When did the report last show correct numbers?

**Check these in order:**
1. **Reports > Standard > [Report name]** — run with default settings first
2. Check the reporting basis: **Gear icon > Account and Settings > Advanced > Accounting > Accounting method** (Cash or Accrual)
3. Click into any suspicious number to drill down to the underlying transactions
4. **Reports > Custom Reports** — check if they are running a saved custom report with filters that may be causing the issue

## Common Resolutions

### Profit & Loss Shows Wrong Amounts
1. Check the **date range** — most common error is wrong period selected
2. Check the **basis** — Cash basis only shows income when payment is received, accrual shows when invoiced
   - Toggle between Cash and Accrual at the top of the report to compare
3. Look for transactions categorized to wrong accounts:
   - Click into the suspicious amount to see all transactions
   - Reclassify any miscategorized transactions
4. Check for **undeposited funds**: income from invoices appears in Undeposited Funds until a bank deposit is created
   - On Cash basis: income does not show until the bank deposit is recorded
   - On Accrual basis: income shows when the invoice is created
5. Journal entries can move amounts between income and expense categories — check for unexpected JEs

### Balance Sheet Issues
1. The Balance Sheet MUST balance (Assets = Liabilities + Equity) — if it doesn't, this is a data integrity issue
2. Common unexpected entries:
   - **Opening Balance Equity**: created when accounts are set up with opening balances. Should be zero after initial setup — if not, opening balances need to be journaled to the correct equity accounts
   - **Uncategorized Asset/Income/Expense**: transactions that were imported but never categorized. Find and categorize them.
   - **Ask My Accountant**: default holding account for uncertain categorizations. Clean these up.
3. To investigate a specific number: click on it to drill down, then review each transaction

### Cash vs Accrual Differences
1. **Cash basis**: revenue recognized when cash is received, expenses when cash is paid
2. **Accrual basis**: revenue recognized when invoiced, expenses when billed
3. The same company will show DIFFERENT profit/loss depending on basis — this is normal
4. Common confusion:
   - Customer created invoices but hasn't received payment → shows revenue on Accrual but not Cash
   - Customer entered bills but hasn't paid them → shows expense on Accrual but not Cash
5. To compare: run the same report twice, once on each basis. The difference = unbilled/unpaid amounts.
6. **Important:** QBO's default basis is set in Account and Settings but can be overridden per report

### A/R or A/P Aging Shows Paid Items
1. Most common cause: payment was not properly applied to the invoice/bill
2. Check the payment:
   - **Sales > Invoices > [Invoice]** — is the payment linked?
   - If payment exists but is not applied: edit the payment, apply it to the correct invoice
3. Another cause: a **credit memo** exists but was not applied to the invoice
4. For bills: **Expenses > Vendors > [Vendor]** — check open bills, verify bill payments are applied
5. If a payment was applied to the wrong invoice: unapply and reapply to the correct one
6. **Reports > A/R Aging Detail** — shows each open invoice and its age. Click into any to investigate.

### Report Filters Not Working
1. Common filter issues:
   - Date range does not include the transactions they expect
   - "Cash" vs "Accrual" toggle at top of report overrides the company default
   - Class/Location filter is set, hiding transactions without a class/location
   - Customer/Vendor filter is active from a previous report run
2. Reset all filters: click **Customize** on the report, then **Reset** to clear all custom settings
3. For Class/Location reports: transactions without a class/location assigned will appear as "Not Specified" — check if this is being filtered out

### Reports Running Slowly
1. Narrow the date range — reports spanning multiple years are very resource-intensive
2. Reduce detail level: use Summary instead of Detail reports where possible
3. Remove unnecessary columns in **Customize > Columns**
4. Try a different browser or incognito mode (extensions can slow report rendering)
5. If the report consistently times out: this may be a data volume issue. Consider:
   - Running the report for smaller date ranges and combining
   - Exporting to Excel for analysis
   - If the company file has 100K+ transactions, large reports may need Intuit's "batch export" feature (Advanced plan only)

## Known QBO Bugs

<!-- Add confirmed bugs as they are encountered. Format:
### [Brief description]
- **Status**: Active / Resolved in [date]
- **Symptoms**: What the user sees
- **Workaround**: Temporary fix if available
- **Intuit Case#**: Reference number if available
-->

*No confirmed bugs documented yet. Add entries as they are identified and verified.*

## When to Escalate Further

- Balance Sheet does not balance after all manual checks — possible data corruption
- Reports show data from a different company file (multi-company account)
- Exported reports have significantly different data than on-screen reports
- Custom report that previously worked now returns no data after a QBO update
- Report data does not match the transaction register for the same account and period

## Cross-References

- **[Reconciliation](reconciliation.md)** — Balance Sheet bank account balances should match the last reconciled balance
- **[Tax](tax.md)** — Tax reports (sales tax liability, 1099 detail) have specific considerations
- **[Payroll](payroll.md)** — Payroll reports are separate from standard financial reports
- **[Bank Feeds](bank-feeds.md)** — Uncategorized bank feed transactions will appear as "Uncategorized" on reports
- **[Permissions](permissions.md)** — "Reports Only" users may see different data than admins if row-level security is configured (Advanced plan)
