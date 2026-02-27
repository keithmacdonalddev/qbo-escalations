# Billing Escalations

## Common Issues

- Subscription charge higher than expected — price increase or promo expired
- Cannot downgrade plan — features in use require current tier
- Payment method declined — card expired, insufficient funds
- Double-charged for subscription
- Cancellation requested but service still active (or still being charged)
- Free trial ended without warning
- Payroll subscription billing separate from QBO billing — confusion
- Add-on charges not recognized (payroll, payments, time tracking)
- Need invoice/receipt for subscription payment
- Account suspended due to billing failure
- Promotional pricing ended — sticker shock at full price

## Quick Diagnosis

**Always ask first:**
1. What is the customer's current subscription? (QBO tier + any add-ons)
2. What charge are they disputing? (amount, date, description on bank statement)
3. Are they trying to change their plan? (upgrade, downgrade, cancel)
4. When did they sign up? When does the billing cycle renew?
5. Were they on a promotional rate? (common: 50% off for 3-6 months)

**Check these in order:**
1. **Gear icon > Account and Settings > Billing & Subscription** — current plan, renewal date, payment method
2. Check for add-on subscriptions: Payroll, Payments, Time Tracking (each billed separately)
3. **Gear icon > Account and Settings > Billing & Subscription > Past invoices** — billing history

## Common Resolutions

### Unexpected Price Increase
1. QBO commonly offers promotional pricing for new subscribers (50% off, 70% off for 3-6 months)
2. When the promo expires, the full price kicks in — this is the #1 cause of billing escalations
3. Check **past invoices** to see when the rate changed
4. Options for the customer:
   - Call Intuit Sales to negotiate a new promotional rate (often available if they threaten to cancel)
   - Downgrade to a lower tier if they don't need all features
   - Cancel and re-subscribe (sometimes gets a new promo, but risks data access gaps)
5. QBO sends email notices before promo expiration, but customers often miss them

### Cannot Downgrade Plan
1. QBO prevents downgrade when features exclusive to the current tier are actively in use:
   - **Plus to Essentials**: Cannot downgrade if using inventory tracking, classes, locations, budgets, or purchase orders
   - **Essentials to Simple Start**: Cannot downgrade if using bill management, multiple users (>1), or time tracking
   - **Advanced to Plus**: Cannot downgrade if using custom roles, workflows, batch transactions, or custom fields
2. To downgrade, the customer must first:
   - Turn off or remove usage of tier-exclusive features
   - For inventory: zero out all inventory items or convert to non-inventory
   - For classes/locations: cannot remove if transactions exist — contact Intuit support
3. **Gear icon > Account and Settings > Billing & Subscription > Downgrade** will show which features are blocking

### Payment Method Declined
1. **Gear icon > Account and Settings > Billing & Subscription > Update payment method**
2. Common fixes:
   - Update expiration date if card was reissued
   - Verify billing address matches what the bank has on file
   - Try a different card
   - Check if the bank is blocking the charge (Intuit charges from various merchant names)
3. If account is suspended due to payment failure:
   - Update payment method and the system will retry within 24 hours
   - If suspended for 30+ days, may need to call Intuit to reactivate

### Double-Charged
1. Check **past invoices** — look for two charges in the same billing cycle
2. Common causes of apparent double charges:
   - QBO subscription + Payroll subscription (separate charges)
   - QBO subscription + QuickBooks Payments processing fees
   - Authorization hold + actual charge (hold drops off within 3-5 business days)
   - Mid-cycle plan change causing prorated charges
3. If genuinely double-charged: customer should contact Intuit billing support for a refund. Escalation specialists cannot issue refunds directly.

### Cancellation Issues
1. To cancel: **Gear icon > Account and Settings > Billing & Subscription > Cancel**
2. After cancellation:
   - Access continues until the end of the paid billing period
   - Data is retained for 1 year (read-only access)
   - After 1 year, data is permanently deleted
3. If still being charged after cancellation:
   - Check if it is a different Intuit product (Payroll, Payments, TurboTax)
   - Verify cancellation confirmation email was received
   - Check if they canceled the wrong company file (multi-company users)
4. **Payroll must be canceled separately** — canceling QBO does not cancel the payroll subscription

### Need Invoice/Receipt
1. **Gear icon > Account and Settings > Billing & Subscription > Past invoices**
2. Each invoice can be printed or downloaded as PDF
3. If invoices are not showing: the billing contact may be a different user than the one currently logged in (billing goes to the master admin)

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

- Customer insists they were double-charged and billing history confirms it — needs refund from Intuit billing
- Account suspended for 30+ days due to payment failure — needs Intuit reactivation
- Customer cannot access cancellation option (greyed out or missing)
- Subscription shows wrong tier despite recent change
- Customer was charged after confirmed cancellation (with cancellation confirmation email as evidence)

## Cross-References

- **[Permissions](permissions.md)** — Only Master Admin or Company Admin can view/modify billing settings
- **[Payroll](payroll.md)** — Payroll is billed separately and must be canceled separately
- **[Technical](technical.md)** — Billing page not loading or payment method not saving can be browser-related
