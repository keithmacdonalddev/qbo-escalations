# Invoicing Escalations

## Common Issues

- Invoice not sending to customer (email delivery failure)
- Invoice customization not saving or not applying
- Recurring invoice not generating on schedule
- Payment link on invoice not working
- Invoice numbering sequence wrong or duplicated
- Estimates not converting to invoices correctly
- Customer cannot view or pay invoice online
- Credit memo not applying to outstanding invoice
- Invoice shows wrong tax amount
- Deposits/retainers not applying to final invoice
- Progress invoicing issues (Plus/Advanced only)
- Batch invoicing not working (Advanced only)
- Invoice PDF attachment looks different from the online version

## Quick Diagnosis

**Always ask first:**
1. What is the customer seeing? (email not received, payment link broken, wrong amount)
2. Is this one invoice or affecting all invoices?
3. Is the customer using custom invoice templates?
4. What payment methods are enabled? (QuickBooks Payments, manual, third-party)
5. What subscription tier? (affects available features like progress invoicing)

**Check these in order:**
1. **Sales > Invoices > [Invoice]** — review the specific invoice
2. **Gear icon > Account and Settings > Sales** — check invoice defaults, online delivery settings
3. **Gear icon > Custom Form Styles** — check template configuration
4. **Sales > Customers > [Customer]** — check customer email, payment terms, tax settings

## Common Resolutions

### Invoice Email Not Delivering
1. Check the customer email address on the invoice — typos are the #1 cause
2. Check spam/junk folder — QBO emails come from quickbooks@notification.intuit.com
3. Verify email was sent: **Sales > Invoices > [Invoice]** — check the activity log at the bottom
4. If email shows as sent but customer didn't receive:
   - Ask customer to whitelist quickbooks@notification.intuit.com
   - Some corporate email servers block Intuit emails — try an alternative email
5. QBO has daily email sending limits — if sending many invoices, some may be delayed
6. Alternative: share the invoice link directly (copy from the invoice's "Share link" option)

### Custom Invoice Template Issues
1. **Gear icon > Custom Form Styles** — edit the template
2. Common issues:
   - Logo not appearing: upload must be PNG, JPG, or GIF, under 10MB. Try re-uploading.
   - Colors/fonts not applying: clear browser cache, some template changes need a page refresh
   - Template not assigned: when creating an invoice, select the correct template from the "Customize" dropdown
3. If template was working and stopped: a QBO update may have reset some settings. Re-save the template.
4. PDF vs online view: the PDF version and the online payment page use different renderers — minor differences are expected

### Recurring Invoice Not Generating
1. **Gear icon > Recurring Transactions** — find the recurring invoice
2. Check:
   - **Status**: Must be "Scheduled" (not "Paused" or "Expired")
   - **Interval**: Verify frequency (weekly, monthly, yearly) and next date
   - **End date**: If set, may have already passed
   - **Type**: "Scheduled" auto-creates. "Reminder" only sends a reminder. "Unscheduled" requires manual creation.
3. Recurring transactions run in the background — they generate during QBO's nightly processing, not at a specific time
4. If set to "Automatically send": the customer will receive the email when it generates
5. Common trap: if the creation date falls on a weekend/holiday, QBO creates it on the next business day

### Payment Link Not Working
1. **QuickBooks Payments must be enabled** for online payments to work
2. Check: **Gear icon > Account and Settings > Payments** — verify QB Payments is set up and active
3. On the invoice: verify the "Online payments" options are checked (credit card, bank transfer/ACH)
4. If customer gets an error when clicking "Pay now":
   - The payment link may have expired (links expire after the invoice due date + 30 days)
   - The customer's browser may be blocking the payment portal — try incognito
   - Check if QB Payments account is in good standing (not suspended)
5. For customers paying by ACH: first-time ACH payments may take 7-10 business days to verify

### Credit Memo Not Applying
1. Create the credit memo: **+ New > Credit Memo** — select the same customer
2. Apply to invoice: **+ New > Receive Payment** — the credit memo appears as a credit to apply
3. If the credit memo was already created but not applied:
   - Go to the customer's record: **Sales > Customers > [Customer]**
   - Find the unapplied credit memo in the transaction list
   - Create a payment and apply both the credit and any remaining balance
4. Common mistake: credit memo was created for the wrong customer — check the customer name

## Known QBO Bugs

*No confirmed bugs documented yet. Add entries as they are identified and verified.*

## When to Escalate Further

- Payment received through QB Payments but not posting to the invoice (money taken, not applied)
- Recurring invoices generating with wrong amounts or creating duplicates
- Invoice data corrupted (line items missing, amounts changed)
- Customer reports being charged but invoice still shows as unpaid
- Batch invoicing creating hundreds of incorrect invoices

## Cross-References

- **[Tax](tax.md)** — Invoice showing wrong tax? Check the sales tax category on items and customer tax-exempt status
- **[Bank Feeds](bank-feeds.md)** — QB Payments deposits appear in bank feeds and need matching
- **[Reports](reports.md)** — A/R Aging showing paid invoices? Payment may not be applied correctly
- **[Permissions](permissions.md)** — Users need appropriate role to create/edit/send invoices
- **[Billing](billing.md)** — QB Payments has its own fee structure separate from QBO subscription
