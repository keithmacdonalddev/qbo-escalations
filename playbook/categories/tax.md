# Tax Escalations

## Common Issues

- Sales tax not calculating on invoices or sales receipts
- Sales tax rate is wrong for the customer's location
- Automated Sales Tax (AST) not matching expected rates
- 1099 contractor payments — missing contractors, wrong amounts
- Tax code mapping incorrect (products/services assigned wrong tax category)
- Sales tax liability report does not match filed returns
- Tax agency payment recorded but still showing as owed
- Sales tax for multiple states/jurisdictions — nexus confusion
- Tax exemptions not applying correctly for specific customers
- Year-end tax preparation — reports for CPA not matching expectations

## Quick Diagnosis

**Always ask first:**
1. What type of tax issue? (sales tax, payroll tax, 1099, income tax/reporting)
2. What state(s) is the business operating in?
3. Is Automated Sales Tax (AST) turned on? (most QBO subscriptions default to AST)
4. Is this a filing/payment issue or a calculation issue?
5. What is the specific transaction or report they are looking at?

**Check these in order:**
1. **Taxes (left nav) > Sales Tax** — verify tax settings, agencies, filing frequency
2. **Gear icon > Account and Settings > Sales > Sales tax** — check if AST is enabled
3. **Lists > Products and Services** — check tax category on the items being sold
4. **Customer record > Tax info** — check if customer is marked as tax-exempt

## Common Resolutions

### Sales Tax Not Calculating
1. Verify AST is enabled: **Gear icon > Account and Settings > Sales > Sales tax > Automated Sales Tax = ON**
2. Check the product/service item: **Lists > Products and Services > [Item] > Edit**
   - The "Sales tax category" must be set (not "Nontaxable")
   - Common mistake: item was set up as "Nontaxable" or tax category was never assigned
3. Check the customer record: **Sales > Customers > [Customer] > Edit > Tax info**
   - If "Tax exempt" is checked, no sales tax will calculate for this customer
   - If exempt, verify they have a valid exemption certificate on file
4. Check the invoice/sales receipt:
   - Is there a "Tax" column visible? If not, tax may be turned off for the form
   - Is the location/shipping address filled in? AST uses the destination address for rate calculation
5. If AST is OFF and using manual tax rates: **Taxes > Sales Tax > Add/edit tax rates and agencies** — verify rates exist

### Wrong Sales Tax Rate
1. AST calculates based on the **ship-to address** on the transaction. Verify the address is correct.
2. Common causes of wrong rate:
   - Shipping address is blank — QBO may default to the company address
   - Address is partially entered (missing city, state, or ZIP)
   - Customer is in a jurisdiction with special tax rules (home rule cities, tax districts)
3. If the rate is consistently wrong for a location, report to Intuit — their tax rate database may need updating
4. For manual override: edit the tax rate on the individual transaction (gear icon on the tax line)
5. For recurring transactions: update the template's address and tax settings

### 1099 Issues
1. **Reports > Vendors & AP > 1099 Transaction Detail Report** — review all payments
2. Common 1099 problems:
   - Vendor not marked as 1099 contractor: **Expenses > Vendors > [Vendor] > Edit > Track payments for 1099 = YES**
   - Tax ID (SSN/EIN) not entered on vendor record
   - Payments made via credit card, PayPal, or third-party processor should NOT be included (those are reported on 1099-K by the processor)
3. Setting up 1099 filing: **Taxes > 1099 Filings > Prepare 1099s**
4. Box mapping: verify which account categories map to which 1099 box
   - Box 1 (Rent): rent payments
   - Box 6 (Medical): medical/health payments
   - Box 7 / NEC Box 1 (Nonemployee Compensation): contractor payments
5. **Important:** QBO files 1099-NEC (not 1099-MISC) for nonemployee compensation as of tax year 2020

### Sales Tax Liability Report Mismatch
1. **Reports > Standard > Sales Tax Liability Report** — run for the filing period
2. Compare against the tax return/filing
3. Common causes of mismatch:
   - Transactions dated after the filing period are included (check date range)
   - Manual adjustments were made that do not appear on the report
   - Cash vs accrual basis difference — QBO reports can be run either way, but tax filings may use a specific basis
   - Journal entries affecting tax accounts — these do not flow through the standard sales tax reports
4. **Taxes > Sales Tax > View Tax Return** — this shows what QBO would file, compare to the liability report

### Tax Exemptions Not Working
1. **Customer record > Tax info > This customer is tax exempt = YES**
2. Must also enter the **exemption reason** and optionally the certificate number
3. Check the transaction: if the customer is marked exempt but tax still appears:
   - Check if the product/service has "Tax" forced on at the item level
   - Check if a manual tax rate was applied to the invoice line
4. Partial exemptions (exempt for some items, not others):
   - Set the exempt items as "Nontaxable" in their product/service settings
   - Or create a tax exemption reason specific to those item categories

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

- AST calculating wrong rates consistently for a specific jurisdiction — may need Intuit tax team review
- 1099 forms already filed with wrong amounts — need corrected filings
- Sales tax returns filed by QBO with incorrect amounts — need amended return
- Customer received a tax notice from a state agency related to QBO-filed returns
- Tax settings corrupted after QBO update or migration

## Cross-References

## Resolution Notes

**Resolved — Tax Configuration Corrected:**
> [Sales tax / 1099 / tax exemption] issue was caused by [incorrect item tax category / missing customer address / vendor not marked for 1099 tracking / wrong AST setting]. Corrected at [exact navigation path]. Fix applies to [new transactions only / retroactively]. Customer should verify the next [invoice / 1099 report].

**Resolved — Tax Rate Verified:**
> Customer reported tax rate of [X%] on invoices in [jurisdiction]. Verified this rate is correct per [source — jurisdiction website / AST database]. The rate changed on [date] due to [new legislation / Intuit database update / address re-geocoding]. Explained the change to customer. No action needed.

**Resolved — 1099 Filing Corrected:**
> [N] vendors were [missing from / incorrectly included in] the 1099 filing. [Marked vendors for 1099 tracking / updated tax IDs / corrected box mapping / excluded credit card payments]. Customer should re-run the 1099 Transaction Detail report to verify before filing.

**Resolved — Escalated:**
> [Tax forms already filed with wrong amounts / state tax notice / AST consistently wrong for specific jurisdiction]. Escalated to [Intuit Tax Team / CPA recommendation] with Case #[NUMBER].

## Similar Symptoms Across Categories

| Symptom | Could Also Be | How to Tell |
|---------|--------------|-------------|
| "Tax amounts are wrong on invoices" | **Invoicing** — invoice template or item setup issue | Check item tax category first, then AST settings |
| "Tax report doesn't match what I filed" | **Reports** — cash vs accrual basis mismatch | Run the report on both bases — the one matching the filing is correct |
| "1099 amounts are wrong" | **Payroll** — confusing payroll payments with contractor payments | 1099s are for contractors only — payroll has W-2s |
| "Getting charged for tax filing" | **Billing** — e-filing is a separate add-on in some states | Check billing subscription for tax add-on charges |

## Cross-References

- **[Payroll](payroll.md)** — Payroll tax issues (withholding, filings, W-2s) are in the payroll category, not here
- **[Reports](reports.md)** — Tax reports must match the basis (cash vs accrual) used for filing
- **[Reconciliation](reconciliation.md)** — Tax payments should be reconciled against the bank feed
- **[Billing](billing.md)** — QBO's e-filing and e-payment for sales tax is an add-on in some states
