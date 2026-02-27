# Reconciliation Escalations

## Common Issues

- Beginning balance does not match bank statement opening balance
- Reconciliation difference that cannot be located
- Voided or deleted transactions causing reconciliation discrepancies
- Previously reconciled transactions were edited or deleted
- Reconciliation undo needed (started or finished incorrectly)
- Multiple months behind on reconciliation — where to start
- Credit card reconciliation balance mismatch
- Reconciliation report shows different amounts than the register
- Opening balance equity account has unexpected entries
- Bank statement balance does not match QBO ending balance after completing reconciliation

## Quick Diagnosis

**Always ask first:**
1. Which account is being reconciled? (checking, savings, credit card, loan)
2. What statement period? (beginning and ending dates)
3. What is the statement ending balance from the bank?
4. What difference amount is QBO showing?
5. Has anyone edited, voided, or deleted transactions during or after previous reconciliations?

**Check these in order:**
1. **Gear icon > Reconcile > [Account]** — look at the opening balance QBO shows vs the bank statement
2. **Reports > Standard > Reconciliation Reports** — review the last completed reconciliation
3. **Chart of Accounts > [Account] > View Register** — sort by reconciliation status (R = reconciled, C = cleared)
4. **Reports > Standard > Audit Log** — check for changes to reconciled transactions

## Common Resolutions

### Beginning Balance Mismatch
1. The beginning balance is automatically calculated from previously reconciled transactions
2. If it does not match the bank statement opening balance, a previously reconciled transaction was likely edited or deleted
3. To find the culprit:
   - **Reports > Audit Log** — filter by the account, look for edits to transactions dated before the current reconciliation period
   - Sort the register by date and look for transactions with "C" (cleared but not reconciled) status that should be "R" (reconciled)
4. If opening balance equity has an entry: someone may have changed the account's opening balance. Check **Chart of Accounts > [Account] > Edit** for the opening balance field.
5. **Fix:** Re-reconcile the affected prior period, or adjust the opening balance via a journal entry dated the last day of the prior period

### Cannot Find the Reconciliation Difference
1. Common causes of small differences:
   - Bank service charges or interest not entered in QBO
   - A transaction was entered with the wrong amount (transposition error: check for differences divisible by 9)
   - A transaction was dated in the wrong period
2. Systematic approach:
   - Sort the reconciliation screen by amount
   - Compare line by line against the bank statement
   - Look for the exact difference amount — if one transaction equals the difference, it was likely missed
   - If the difference is exactly 2x a transaction amount, that transaction may be duplicated or categorized to the wrong account
3. **Trick for finding transposition errors:** If the difference is divisible by 9 (e.g., $4.50, $9.00, $81.00), two digits were likely swapped (e.g., $54 entered as $45)

### Undoing a Completed Reconciliation
1. **Gear icon > Reconcile > History by account > [Account]**
2. Click **Undo** next to the reconciliation period to reverse
3. This changes all reconciled (R) transactions back to cleared (C) for that period
4. The customer can then re-reconcile correctly
5. **Warning:** Undoing a reconciliation does NOT undo subsequent reconciliations. If multiple periods need correction, undo from most recent backward.

### Multiple Months Behind
1. Start with the OLDEST unreconciled month first — always work forward
2. Gather all bank statements for the unreconciled period
3. For each month:
   - Set the statement ending date and balance
   - Check off transactions that appear on the bank statement
   - Enter any missing bank charges, interest, or fees
   - Finish the reconciliation before moving to the next month
4. If bank feeds are connected, many transactions may already be in QBO — just need to be matched/cleared
5. For very old periods (6+ months), suggest using **CSV import** of bank statements to bulk-load missing transactions

### Previously Reconciled Transactions Were Edited
1. QBO shows a warning when editing reconciled transactions, but does not prevent it
2. Find the change: **Reports > Audit Log** — filter by account, look for events on reconciled transactions
3. Options to fix:
   - **Reverse the edit** if possible (restore original amount/date)
   - **Adjust the current reconciliation** by creating an adjusting journal entry
   - **Undo and re-reconcile** the affected period (cleanest but most work)

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

- Opening balance equity has large unexplained entries that affect multiple accounts
- Reconciliation data appears corrupted (R status on transactions that were never reconciled)
- Customer needs to reconcile 12+ months of history — may need data services consultation
- Audit log shows system-generated changes to reconciled transactions (not user-initiated)
- Beginning balance changed after a QBO update/migration with no user edits

## Cross-References

- **[Bank Feeds](bank-feeds.md)** — Duplicate or missing bank feed transactions are the #1 cause of reconciliation discrepancies
- **[Reports](reports.md)** — Reconciliation reports vs Balance Sheet — if these disagree, investigate transaction status
- **[Permissions](permissions.md)** — Check who has permission to edit/void reconciled transactions
- **[Technical](technical.md)** — Browser issues can cause reconciliation screen to not save properly
