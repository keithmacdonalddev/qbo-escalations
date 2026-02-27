# Bank Feed Escalations

## Common Issues

- Bank feed disconnected — will not reconnect after entering credentials
- Duplicate transactions appearing in the bank feed
- Transactions missing from the bank feed (present in bank, not in QBO)
- Matching rules not working — transactions not auto-categorizing
- Wrong account connected — feed pulling from wrong bank account
- Pending transactions showing as final amounts (then changing)
- Bank feed showing transactions from wrong date range
- "Something went wrong" error when connecting bank
- Feed connected but no transactions downloading
- Manually added transactions duplicating with bank feed entries
- Transferred transactions appearing in both accounts
- Bank feed lag — transactions taking days to appear

## Quick Diagnosis

**Always ask first:**
1. Which bank/financial institution?
2. When did it last work? What changed? (bank password change, new security, bank merger)
3. Is this one account or multiple accounts from the same bank?
4. Has the customer recently changed browsers or cleared cookies?
5. Are they seeing an error message? What exactly does it say?

**Check these in order:**
1. **Banking (left nav)** — look for connection status icons (green = connected, yellow = needs attention, red = disconnected)
2. **Banking > Update** — try manual refresh first
3. **Gear icon > Account and Settings > Advanced > Other preferences** — check if bank feeds are enabled
4. **Chart of Accounts** — verify the bank account exists and is the correct type

## Common Resolutions

### Feed Disconnected / Won't Reconnect
1. Try **Banking > Link account > [Bank name]** — reconnect with credentials
2. If the bank uses multi-factor auth, customer must complete the MFA challenge in the pop-up window (some banks require SMS code, security questions, or app approval)
3. If pop-up is blocked: **disable pop-up blocker** for qbo.intuit.com
4. Try in **incognito/private browsing** window — eliminates extension conflicts
5. If bank recently changed their online banking portal or merged with another bank:
   - Search for the new bank name in the connection dialog
   - The old connection may need to be fully disconnected first: **Banking > Pencil icon on account > Edit account info > Disconnect this account on save**
6. Some banks require "QuickBooks" or "Intuit" to be added as an authorized third-party app in their online banking settings
7. **Last resort:** Disconnect, wait 24 hours, reconnect. Some bank connections need a cooling-off period.

### Duplicate Transactions
1. **Banking > For Review tab** — look for matching entries
2. Check if the customer has been both manually entering AND importing via bank feed (most common cause)
3. Check **Bank Rules** — a rule may be creating a duplicate entry
4. To fix existing duplicates:
   - Go to the register (**Chart of Accounts > View Register**)
   - Sort by amount to find matches
   - Delete the manually-entered duplicate (keep the bank feed version)
5. To prevent future duplicates:
   - Pick ONE method: manual entry OR bank feed import. Not both.
   - If customer must enter some manually (like cash transactions), use a different account
6. For transfers between two connected accounts: QBO should auto-match these. If it doesn't, use **Transfer** (not Expense/Deposit) when categorizing.

### Missing Transactions
1. Check the date range — **Banking** page shows last 90 days by default. Click the date filter.
2. Check if transactions are already in the **Categorized** or **Excluded** tabs
3. Some banks send transactions in batches — wait 24-48 hours
4. If a specific transaction is missing:
   - Verify it appears in the bank's online banking (not just the mobile app, which may show pending differently)
   - Check if it is a pending authorization vs posted transaction — QBO only imports posted transactions
5. If many transactions are missing, disconnect and reconnect the feed. On reconnect, QBO pulls the last 90 days.
6. For transactions older than 90 days: must upload via **CSV/QFX/OFX import** (**Banking > Link account > Upload from file**)

### Matching Rules Not Working
1. **Banking > Rules** — review existing rules
2. Common rule issues:
   - Rule conditions are too specific (exact amount match when amounts vary)
   - Rule is set to wrong account type
   - Multiple rules conflict — QBO applies the first match
3. Test rule logic: **Banking > For Review > Select a transaction > Create Rule** — this pre-fills from the actual transaction
4. Rule fields:
   - **Bank text contains**: matches against the bank's description field
   - **Amount**: can be exact, over, under, or between
   - **Payee**: sets the payee/vendor on the transaction
   - **Category**: sets the account (expense, income, etc.)
5. Rules apply to NEW transactions only — they do not retroactively categorize existing ones

### Wrong Account Connected
1. **Banking > Pencil icon on the account > Edit account info**
2. If the bank connection pulled in the wrong account (e.g., savings instead of checking):
   - Disconnect the wrong account
   - Reconnect and select the correct account during the setup wizard
3. If multiple accounts were connected and transactions went to the wrong one:
   - Cannot move transactions between accounts via bank feed
   - Must manually recategorize or journal-entry the corrections
4. Before disconnecting, ensure no unmatched transactions are in the **For Review** tab (they will be lost)

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

- Bank connection fails repeatedly across multiple browsers and after password reset — may be a backend aggregator issue (Yodlee/Finicity)
- Large number of transactions disappeared from QBO after a bank feed update
- Bank feed is importing transactions into the wrong company file
- Duplicate transactions exist across multiple months and bulk correction is needed
- Customer's bank is listed as unsupported or has recently changed aggregator partnerships
- Bank feed imports are showing wrong amounts (not matching bank statements)

## Cross-References

- **[Reconciliation](reconciliation.md)** — Bank feed issues often surface during reconciliation when balances don't match
- **[Payroll](payroll.md)** — Direct deposit transactions from payroll may cause matching issues in bank feeds
- **[Technical](technical.md)** — Pop-up blockers, browser cache, and extensions frequently cause bank connection failures
- **[Reports](reports.md)** — If bank feed transactions are miscategorized, reports will be inaccurate
