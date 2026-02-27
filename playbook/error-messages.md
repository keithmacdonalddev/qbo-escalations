# Common QBO Error Messages — Quick Reference

When an agent sends a screenshot or reads an error message, look it up here for instant diagnosis.

---

## Authentication & Access Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "We're sorry, something went wrong. Please try again later." | Session expired, browser cache, or temporary server issue | Clear cache, try incognito, check status page | [Technical](categories/technical.md) |
| "You don't have permission to view this page" | User role does not include access to this feature | Check role in Manage Users, upgrade role or plan | [Permissions](categories/permissions.md) |
| "Your session has expired. Please sign in again." | Idle timeout (usually 1 hour) or cookie issues | Sign out fully, clear cookies, sign back in | [Technical](categories/technical.md) |
| "This feature is not available with your current subscription" | Feature requires a higher-tier plan | Check tier vs feature matrix, discuss upgrade | [Billing](categories/billing.md) |
| "Sign-in failed. Please check your user ID and password." | Wrong credentials, locked account, or wrong sign-in method | Reset password, check email, wait 30 min if locked | [Technical](categories/technical.md) |
| "We can't verify your identity right now" | 2FA failure — SMS not delivered, authenticator sync issue | Try backup codes, wait and retry, contact Intuit for reset | [Technical](categories/technical.md) |

## Banking & Bank Feed Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "We can't connect to your bank right now" | Aggregator issue (Yodlee/Finicity), bank maintenance, or credentials changed | Retry in 24h, update credentials, check bank's own status | [Bank Feeds](categories/bank-feeds.md) |
| "Your bank requires additional verification" | Bank added MFA step or security question | Customer must complete verification in the pop-up window | [Bank Feeds](categories/bank-feeds.md) |
| "This account is already connected" | Attempting to reconnect an account that is still linked | Disconnect first, then reconnect | [Bank Feeds](categories/bank-feeds.md) |
| "We're having trouble downloading your transactions" | Temporary download failure from bank aggregator | Wait 24h, try manual refresh, disconnect/reconnect if persistent | [Bank Feeds](categories/bank-feeds.md) |
| "Pop-up blocked" (no transactions loading) | Browser blocking the bank authentication window | Disable pop-up blocker for qbo.intuit.com, try incognito | [Technical](categories/technical.md) |

## Payroll Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "Payroll can't be processed right now" | System issue, missing tax info, or billing problem | Check payroll subscription status, verify tax setup, retry | [Payroll](categories/payroll.md) |
| "Direct deposit information is incomplete" | Missing routing/account number, or bank verification pending | Check employee's payment method settings | [Payroll](categories/payroll.md) |
| "Tax table update required" | QBO needs to refresh tax calculation tables | Usually resolves automatically; if persistent, contact Intuit | [Payroll](categories/payroll.md) |
| "This employee's tax setup is incomplete" | Missing state tax, filing status, or W-4 info | Employee > Edit > Tax withholdings — fill in all fields | [Payroll](categories/payroll.md) |
| "Payroll subscription is inactive" | Billing failure on payroll subscription (separate from QBO) | Check payroll billing, update payment method | [Billing](categories/billing.md) |

## Invoice & Sales Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "This invoice can't be sent" | Invalid customer email, email limit reached, or QB Payments issue | Verify email address, check daily send limit, try different email | [Invoicing](categories/invoicing.md) |
| "Online payments are not available for this invoice" | QB Payments not set up or payment options not enabled on this invoice | Check Payments settings, enable online payments on invoice | [Invoicing](categories/invoicing.md) |
| "Duplicate invoice number" | Invoice number already used | Change invoice number or let QBO auto-assign | [Invoicing](categories/invoicing.md) |
| "Sales tax couldn't be calculated" | AST error, invalid address, or tax setup incomplete | Check customer address, verify AST is on, check item tax category | [Tax](categories/tax.md) |

## Reconciliation Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "The beginning balance doesn't match" | Previously reconciled transaction was edited or deleted | Check Audit Log for changes to reconciled transactions | [Reconciliation](categories/reconciliation.md) |
| "This account has already been reconciled for this period" | Attempting to reconcile a period that is already complete | Check Reconciliation History, undo if re-reconciliation needed | [Reconciliation](categories/reconciliation.md) |

## Report Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "This report can't be displayed right now" | Large date range, too many transactions, or server timeout | Narrow date range, use summary instead of detail | [Reports](categories/reports.md) |
| "Report timed out" | Data volume too large for the selected date range | Break into smaller date ranges, try off-peak hours | [Reports](categories/reports.md) |
| "Export failed" | Browser issue or file too large for download | Try a different browser, reduce report scope, try PDF vs Excel | [Reports](categories/reports.md) |

## Import/Export Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "File format not supported" | Wrong file type or corrupted file | Use CSV, QFX, OFX, or QBO format. Re-download from bank if corrupted. | [Technical](categories/technical.md) |
| "Some rows could not be imported" | Data validation failure — bad dates, invalid amounts, missing required fields | Check the error detail for which rows failed, fix in the CSV, re-import | [Technical](categories/technical.md) |
| "Column mapping failed" | QBO cannot auto-detect column headers in the CSV | Manually map columns during import, or rename CSV headers to match QBO's expected names | [Technical](categories/technical.md) |

## Billing & Subscription Errors

| Error Message | Likely Cause | Quick Fix | Category |
|--------------|-------------|-----------|----------|
| "Your payment method was declined" | Card expired, insufficient funds, or bank blocked the charge | Update payment method, try different card, contact bank | [Billing](categories/billing.md) |
| "Your subscription has been suspended" | Multiple failed payment attempts | Update payment method — system retries within 24h | [Billing](categories/billing.md) |
| "You've reached the maximum number of users" | Plan user limit reached | Upgrade plan or remove inactive users | [Permissions](categories/permissions.md) |

---

## Unrecognized Error Messages

If the error message is not listed above:

1. **Note the exact text** — copy it character-for-character from the screenshot
2. **Note the URL** in the browser bar when the error appears — this tells you which QBO module is affected
3. **Check the browser console** (F12 > Console) for additional error details
4. **Search Intuit Community**: https://quickbooks.intuit.com/community/ — other users may have reported the same error
5. **If the error includes a numeric code** (e.g., "Error 101", "Error 324"), include it in the escalation documentation — Intuit engineering uses these internally

When documenting an unrecognized error, add it to the relevant category's "Known QBO Bugs" section if it recurs across multiple customers.
