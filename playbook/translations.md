# Translation Guide — What Customers Say vs What's Actually Wrong

Customers describe problems in their own words. This guide maps common customer language to the actual QBO issue, so you can diagnose faster without playing 20 questions.

---

## Payroll Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "My employee's check is wrong" | Net pay is different than expected | Tax withholding incorrect, deduction misconfigured, or hours/rate wrong | [Payroll](categories/payroll.md) |
| "Payroll won't go through" | Payroll submission failed or is stuck | Processing error, billing issue on payroll subscription, or missing employee setup | [Payroll](categories/payroll.md) |
| "The taxes are messed up" | Withholding amounts look wrong | W-4 data incorrect, wrong state, or tax table issue | [Payroll](categories/payroll.md) |
| "My direct deposit didn't hit" | Employee didn't receive payment | Bank rejection, prenote period, wrong account info, or payroll processing delay | [Payroll](categories/payroll.md) |
| "I need to fix a paycheck" | Need to void/correct a previous pay run | Cannot edit after processing — must void and reissue, or make adjustment on next run | [Payroll](categories/payroll.md) |
| "The vacation hours are wrong" | PTO accrual balance incorrect | Accrual policy misconfigured, carry-over limit reached, or policy not assigned | [Payroll](categories/payroll.md) |

## Banking Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "My bank isn't connecting" | Bank feed is disconnected | Credentials changed, bank updated their portal, MFA required, or aggregator outage | [Bank Feeds](categories/bank-feeds.md) |
| "I'm seeing double" | Duplicate transactions in QBO | Manual entry + bank feed import overlap, or bank sent duplicates | [Bank Feeds](categories/bank-feeds.md) |
| "Transactions are missing" | Expected entries not in QBO | Pending vs posted, date range filter, transactions in wrong tab (Categorized/Excluded) | [Bank Feeds](categories/bank-feeds.md) |
| "The amounts don't match" | QBO balance differs from bank statement | Unreconciled transactions, pending items, or bank feed lag | [Reconciliation](categories/reconciliation.md) |
| "My rules stopped working" | Auto-categorization not applying | Rule conditions too specific, conflicting rules, or rules don't apply retroactively | [Bank Feeds](categories/bank-feeds.md) |
| "I accidentally deleted a transaction" | Need to restore a bank feed entry | Cannot undelete — must wait for next bank feed refresh (up to 24h) or manually re-enter | [Bank Feeds](categories/bank-feeds.md) |

## Reconciliation Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "My books don't balance" | Reconciliation difference exists | Missing transactions, wrong amounts, or edited reconciled items | [Reconciliation](categories/reconciliation.md) |
| "The opening balance is wrong" | Beginning balance doesn't match statement | Previously reconciled transaction was edited or deleted | [Reconciliation](categories/reconciliation.md) |
| "I need to start over" | Want to undo a completed reconciliation | Use Undo in Reconciliation History — works backward from most recent | [Reconciliation](categories/reconciliation.md) |
| "There's money in Opening Balance Equity" | OBE account has a balance | Opening balances were set up incorrectly or need to be journaled to correct accounts | [Reconciliation](categories/reconciliation.md) |

## Permissions Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "My employee can't get in" | User invitation issue | Invite expired, wrong email, or user already has a different Intuit account | [Permissions](categories/permissions.md) |
| "They can see things they shouldn't" | Role too permissive | Wrong user role assigned, or plan doesn't support granular roles | [Permissions](categories/permissions.md) |
| "The accountant can't connect" | Accountant invite not working | Must accept via QBOA, not regular QBO. Accountant slot may be full. | [Permissions](categories/permissions.md) |
| "The owner left and we're locked out" | Need master admin transfer | Requires Intuit support if original admin is unavailable | [Permissions](categories/permissions.md) |
| "I can't see payroll" | Missing payroll access | QBO permissions and payroll permissions are separate — need both | [Permissions](categories/permissions.md) + [Payroll](categories/payroll.md) |

## Billing Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "Why did my price go up?" | Promotional pricing expired | Promo ended, full price kicked in. Can call Intuit Sales for new deal. | [Billing](categories/billing.md) |
| "I got charged twice" | Two charges on bank statement | Usually QBO sub + Payroll sub (separate charges), or auth hold + real charge | [Billing](categories/billing.md) |
| "I want to cancel" | Wants to stop subscription | Cancel via Billing settings. Data retained 1 year. Payroll must cancel separately. | [Billing](categories/billing.md) |
| "I need a receipt" | Needs invoice for accounting | Past invoices available in Billing & Subscription settings | [Billing](categories/billing.md) |

## Tax Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "Tax isn't showing on my invoices" | Sales tax not calculating | AST off, item not taxable, customer marked exempt, or address missing | [Tax](categories/tax.md) |
| "The tax rate changed" | Invoices showing different rate | Intuit updated AST database, jurisdiction rate changed, or address geo-coding shifted | [Tax](categories/tax.md) |
| "I need to do my 1099s" | Year-end contractor filing | Verify vendors marked as 1099, check box mapping, run 1099 detail report | [Tax](categories/tax.md) |
| "My tax report doesn't match what I filed" | Sales tax liability vs filed return discrepancy | Date range, cash vs accrual basis, or manual adjustments not on report | [Tax](categories/tax.md) |

## Reports Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "My P&L is wrong" | Profit & Loss numbers unexpected | Wrong date range, wrong basis (cash/accrual), uncategorized transactions, or undeposited funds | [Reports](categories/reports.md) |
| "The report is showing old invoices" | A/R Aging includes paid items | Payment not applied to invoice, or credit memo not applied | [Reports](categories/reports.md) |
| "I can't get it to export" | PDF or Excel export failing | Browser issue, report too large, or try different format | [Reports](categories/reports.md) |
| "My accountant says the numbers are wrong" | CPA's reports don't match QBO | Usually cash vs accrual basis mismatch, or different date ranges | [Reports](categories/reports.md) |
| "Where did this money come from?" | Unexpected amount on a report | Click the number to drill down — trace to the underlying transaction | [Reports](categories/reports.md) |

## Technical Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "It's running really slow" | QBO pages loading slowly | Browser cache, extensions, large data file, or Intuit server issue | [Technical](categories/technical.md) |
| "I keep getting kicked out" | Session expiring frequently | Browser cookies being cleared, extension interference, or VPN issues | [Technical](categories/technical.md) |
| "The screen is blank" | White screen or missing content | JavaScript error, browser compatibility, or extension blocking QBO scripts | [Technical](categories/technical.md) |
| "It says something went wrong" | Generic QBO error | Clear cache, try incognito, try different browser, check status page | [Technical](categories/technical.md) |
| "My app isn't syncing" | Third-party integration broken | OAuth token expired, reconnect the app, check Connected Apps settings | [Technical](categories/technical.md) |
| "I can't upload my file" | Data import failure | Wrong file format, bad data in CSV, encoding issue | [Technical](categories/technical.md) |

## Invoicing Translations

| Customer Says | They Probably Mean | Actual Issue | Category |
|--------------|-------------------|--------------|----------|
| "My customer didn't get the invoice" | Email delivery failure | Wrong email, spam filter, or QBO daily email limit hit | [Invoicing](categories/invoicing.md) |
| "The payment button isn't working" | Online payment link broken | QB Payments not set up, payment options not enabled, or link expired | [Invoicing](categories/invoicing.md) |
| "My recurring invoices stopped" | Recurring transaction not generating | Schedule paused, end date passed, or set to "Reminder" instead of "Scheduled" | [Invoicing](categories/invoicing.md) |
| "I need to credit a customer" | Want to apply credit or refund | Create credit memo, then apply via Receive Payment | [Invoicing](categories/invoicing.md) |

---

## Meta-Translations (Red Flags)

These phrases often indicate the customer is frustrated or the issue is more serious than it sounds:

| Customer Says | What It Really Means | Action |
|--------------|---------------------|--------|
| "I've been calling for weeks about this" | Prior escalations failed to resolve | Check case history, do NOT repeat the same steps. Escalate if needed. |
| "My accountant is furious" | Data integrity issue affecting professional work | Prioritize — accountant may bill the customer for time spent on QBO issues |
| "I might switch to Xero/FreshBooks" | Customer is at churn risk | Note for retention team. Fix the issue AND address their frustration. |
| "This worked fine on Desktop" | Recently migrated from QB Desktop | Check migration-related issues — see [edge-cases.md](edge-cases.md#the-migration-hangover) |
| "Nobody knows how to fix this" | Complex issue that's been bounced around | Take ownership. Do not pass to another team without exhausting your options. |
| "I just need it to work" | Customer doesn't care about the explanation | Lead with the fix, not the diagnosis. Explain after. |
